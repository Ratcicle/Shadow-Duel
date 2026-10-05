import type {
  ActionRuntimeCard,
  ActionRuntimeGamePort,
  EffectContext,
  ResolvedTargetMap,
} from "../../contracts/actionRuntime.js";
import type { ActionOf } from "../../contracts/actions.js";
import type { CardPermanentBuffMap, LevelModificationContribution } from "../../contracts/cards.js";
import { suppressTemporaryDynamicStatIncreasesForDebuff } from "../passives/passiveBuffs.js";

interface StatsRuntimeCard extends ActionRuntimeCard {
  tempAtkBoost?: number;
  tempDefBoost?: number;
}

interface StatsActionHost {
  game: ActionRuntimeGamePort;
}

interface PersistentStatsCard {
  atk?: number | undefined;
  def?: number | undefined;
  permanentBuffsBySource?: CardPermanentBuffMap | null | undefined;
}

interface LevelModificationCard {
  level?: number | undefined;
  originalLevel?: number | null | undefined;
  levelModificationContributions?: LevelModificationContribution[] | undefined;
}

/** Store actual clamped deltas; presence and turn durations expire independently. */
export function applyLevelModification(
  card: LevelModificationCard,
  nextLevel: number,
  duration: string = "while_faceup",
): void {
  const current = Number(card.level || 0);
  if (nextLevel === current) return;
  if (duration === "permanent") {
    if (card.originalLevel != null && card.levelModificationContributions?.length) {
      card.originalLevel += nextLevel - current;
    }
    card.level = nextLevel;
    return;
  }
  const contributions = card.levelModificationContributions || [];
  // Adopt existing hand-level/legacy baselines without changing their turn expiry.
  if (contributions.length === 0 && card.originalLevel != null && current !== card.originalLevel) {
    contributions.push({ amount: current - card.originalLevel, duration: "until_end_turn" });
  }
  card.originalLevel ??= current;
  contributions.push({
    amount: nextLevel - current,
    duration: duration === "while_faceup" ? "while_faceup" : "until_end_turn",
  });
  card.levelModificationContributions = contributions;
  card.level = nextLevel;
}

export function expireLevelModifications(
  card: LevelModificationCard,
  duration: LevelModificationContribution["duration"],
): void {
  const entries = card.levelModificationContributions || [];
  if (entries.length === 0) {
    if (duration === "until_end_turn" && card.originalLevel != null) {
      card.level = card.originalLevel;
      card.originalLevel = null;
    }
    return;
  }
  const expired = entries.filter(entry => entry.duration === duration);
  if (expired.length === 0) return;
  const remaining = entries.filter(entry => entry.duration !== duration);
  card.level = Math.max(1, Number(card.level || 0) - expired.reduce((sum, entry) => sum + entry.amount, 0));
  card.levelModificationContributions = remaining;
  if (remaining.length === 0) {
    if (card.originalLevel != null) card.level = card.originalLevel;
    card.originalLevel = null;
  }
}

/** A field departure ends all level changes tied to that affected presence. */
export function clearLevelModifications(card: LevelModificationCard): void {
  if (card.originalLevel != null) card.level = card.originalLevel;
  card.originalLevel = null;
  card.levelModificationContributions = [];
}

export function applyNamedStatChange(
  card: PersistentStatsCard | null | undefined,
  sourceName: string,
  atkChange = 0,
  defChange = 0,
) {
  if (!card || !sourceName) return { atk: 0, def: 0 };
  if (!card.permanentBuffsBySource) {
    card.permanentBuffsBySource = {};
  }
  if (!card.permanentBuffsBySource[sourceName]) {
    card.permanentBuffsBySource[sourceName] = {};
  }

  let appliedAtk = 0;
  let appliedDef = 0;

  if (atkChange !== 0) {
    const previous = Number(card.atk || 0);
    const next = Math.max(0, previous + atkChange);
    appliedAtk = next - previous;
    card.atk = next;
    card.permanentBuffsBySource[sourceName].atk =
      Number(card.permanentBuffsBySource[sourceName].atk || 0) + appliedAtk;
  }

  if (defChange !== 0) {
    const previous = Number(card.def || 0);
    const next = Math.max(0, previous + defChange);
    appliedDef = next - previous;
    card.def = next;
    card.permanentBuffsBySource[sourceName].def =
      Number(card.permanentBuffsBySource[sourceName].def || 0) + appliedDef;
  }

  if (
    !card.permanentBuffsBySource[sourceName].atk &&
    !card.permanentBuffsBySource[sourceName].def
  ) {
    delete card.permanentBuffsBySource[sourceName];
  }
  if (Object.keys(card.permanentBuffsBySource).length === 0) {
    delete card.permanentBuffsBySource;
  }

  return { atk: appliedAtk, def: appliedDef };
}

/** Field exit removes actual deltas, without replacing the original stats. */
export function clearPermanentStatBuffs(card: PersistentStatsCard): void {
  const buffs = Object.values(card.permanentBuffsBySource ?? {});
  for (const stat of ["atk", "def"] as const) {
    const delta = buffs.reduce((total, buff) => total + (buff[stat] || 0), 0);
    if (delta) card[stat] = Math.max(0, (card[stat] || 0) - delta);
  }
  delete card.permanentBuffsBySource;
}

/** Preserve the zero-floor adjustment while other registered modifiers remain. */
export function removeTrackedStatChange(
  card: PersistentStatsCard,
  stat: "atk" | "def",
  delta: number,
): void {
  const next = (card[stat] || 0) - delta;
  card[stat] = Math.max(0, next);
  const buffs = card.permanentBuffsBySource;
  if (next < 0 && buffs && Object.keys(buffs).length > 0) {
    const adjustment = buffs.stat_cleanup_floor ??= {};
    adjustment[stat] = (adjustment[stat] || 0) - next;
  }
}

/** Setting a monster ends these gains; turning it face-up cannot restore them. */
export function expireFaceupStatBuffs(card: {
  atk?: number | undefined;
  def?: number | undefined;
  permanentBuffsBySource?: CardPermanentBuffMap | null | undefined;
}): void {
  for (const [name, buff] of Object.entries(card.permanentBuffsBySource ?? {})) {
    if (buff.duration !== "while_faceup") continue;
    removeTrackedStatChange(card, "atk", buff.atk ?? 0);
    removeTrackedStatChange(card, "def", buff.def ?? 0);
    delete card.permanentBuffsBySource?.[name];
  }
}

/**
 * Stats Actions - ATK/DEF temporary modifications
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Queues renderer-only stat feedback for legacy EffectEngine stat actions.
 */
function queueStatFeedback(
  engine: StatsActionHost,
  card: StatsRuntimeCard,
  kind: string,
  tone: string,
  ctx: EffectContext,
): void {
  if (typeof engine?.game?.queueVisualFeedback !== "function") return;
  if (!card) return;

  engine.game.queueVisualFeedback({
    kind,
    sourceCard: ctx?.source || null,
    targetCard: card,
    targetOwnerId: card.owner || null,
    targetZone: "field",
    tone,
  });
}

/**
 * Apply temporary ATK buff action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether any cards were affected
 */
export function applyBuffAtkTemp(
  this: StatsActionHost,
  action: ActionOf<"buff_atk_temp">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
): boolean {
  let targetCards = targets?.[action.targetRef] || [];
  if (!Array.isArray(targetCards)) {
    targetCards = targetCards ? [targetCards as StatsRuntimeCard] : [];
  }
  const runtimeCards = targetCards as StatsRuntimeCard[];
  if (runtimeCards.length === 0) return true;
  const amount = action.amount ?? 0;
  let hadValidTarget = false;
  runtimeCards.forEach((card) => {
    if (card.isFacedown) return;
    if (card.cardKind !== "monster") return;
    hadValidTarget = true;
    card.atk = Math.max(0, (card.atk ?? 0) + amount);
    card.tempAtkBoost = (card.tempAtkBoost || 0) + amount;
    if (amount !== 0) {
      queueStatFeedback(
        this,
        card,
        amount < 0 ? "debuff" : "buff",
        amount < 0 ? "red" : "green",
        ctx,
      );
    }
  });
  return hadValidTarget;
}

/**
 * Apply temporary stat modification action (using factors)
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether any cards were affected
 */
export function applyModifyStatsTemp(
  this: StatsActionHost,
  action: ActionOf<"modify_stats_temp">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
): boolean {
  let targetCards = targets?.[action.targetRef] || [];
  if (!Array.isArray(targetCards)) {
    targetCards = targetCards ? [targetCards as StatsRuntimeCard] : [];
  }
  const runtimeCards = targetCards as StatsRuntimeCard[];
  const atkFactor = action.atkFactor ?? 1;
  const defFactor = action.defFactor ?? 1;
  let hadValidTarget = false;

  runtimeCards.forEach((card) => {
    if (card.isFacedown) return;
    if (card.cardKind !== "monster") return;
    hadValidTarget = true;
    let deltaTotal = 0;
    if (atkFactor !== 1) {
      const currentAtk = card.atk ?? 0;
      const newAtk = Math.floor(currentAtk * atkFactor);
      suppressTemporaryDynamicStatIncreasesForDebuff(card, "atk", newAtk - currentAtk);
      const deltaAtk = newAtk - (card.atk ?? 0);
      card.atk = newAtk;
      card.tempAtkBoost = (card.tempAtkBoost || 0) + deltaAtk;
      deltaTotal += newAtk - currentAtk;
    }
    if (defFactor !== 1) {
      const currentDef = card.def ?? 0;
      const newDef = Math.floor(currentDef * defFactor);
      suppressTemporaryDynamicStatIncreasesForDebuff(card, "def", newDef - currentDef);
      const deltaDef = newDef - (card.def ?? 0);
      card.def = newDef;
      card.tempDefBoost = (card.tempDefBoost || 0) + deltaDef;
      deltaTotal += newDef - currentDef;
    }
    if (deltaTotal !== 0) {
      queueStatFeedback(
        this,
        card,
        deltaTotal < 0 ? "debuff" : "buff",
        deltaTotal < 0 ? "red" : "green",
        ctx,
      );
    }
  });
  return hadValidTarget;
}
