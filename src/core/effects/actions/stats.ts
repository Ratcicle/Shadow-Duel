import type Game from "../../Game.js";
import type {
  ActionRuntimeCard,
  EffectContext,
  ResolvedTargetMap,
} from "../../contracts/actionRuntime.js";
import type { ActionOf } from "../../contracts/actions.js";

interface StatsRuntimeCard extends ActionRuntimeCard {
  tempAtkBoost?: number;
  tempDefBoost?: number;
}

interface StatsActionHost {
  game: Game;
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
      const deltaAtk = newAtk - currentAtk;
      card.atk = newAtk;
      card.tempAtkBoost = (card.tempAtkBoost || 0) + deltaAtk;
      deltaTotal += deltaAtk;
    }
    if (defFactor !== 1) {
      const currentDef = card.def ?? 0;
      const newDef = Math.floor(currentDef * defFactor);
      const deltaDef = newDef - currentDef;
      card.def = newDef;
      card.tempDefBoost = (card.tempDefBoost || 0) + deltaDef;
      deltaTotal += deltaDef;
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
