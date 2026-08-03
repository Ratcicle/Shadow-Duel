/**
 * stats.ts
 *
 * Handlers for stat modifications, status effects, and buffs.
 * Moved from ActionHandlers.js with identical behavior.
 */

import { isAI } from "../Player.js";
import type { ActionOf } from "../contracts/actions.js";
import type {
  ActionHandlerEnginePort,
  ActionMoveResult,
  ActionRuntimeCard,
  ActionRuntimeDynamicBuff,
  ActionRuntimeGamePort,
  ActionRuntimePlayer,
  EffectContext,
  NeedsSelectionResult,
  ResolvedTargetMap,
} from "../contracts/actionRuntime.js";
import type { ZoneInput } from "../contracts/zones.js";
import {
  getUI,
  normalizeNegateEffectsDuration,
  resolveContextNumber,
  resolveFieldScopeCards,
  resolveTargetCards,
  STATUS_DISPLAY_NAMES,
} from "./shared.js";

type StatName = "atk" | "def";

interface CardFeedbackOptions {
  sourceCard?: ActionRuntimeCard | null;
  ownerId?: string | null;
  targetZone?: ZoneInput;
  tone?: string;
}

interface DynamicBuffSuppressionOptions {
  temporary?: boolean;
}

interface PlayerScopeAction {
  readonly owner?: string;
  readonly player?: string;
}

interface DurationAction {
  readonly duration?: string;
  readonly expiresOnTurn?: number;
  readonly durationTurns?: number;
  readonly turns?: number;
}

interface BuffStatsActionView {
  readonly type:
    | "buff_stats_temp"
    | "reduce_self_atk"
    | "grant_second_attack"
    | "buff_stats_temp_with_second_attack";
  readonly targetRef?: string;
  readonly targetScope?: ActionOf<"buff_stats_temp">["targetScope"];
  readonly targetRestriction?: string;
  readonly amount?: number;
  readonly atkBoost?: number;
  readonly defBoost?: number;
  readonly atkBoostFromContext?: ActionOf<"buff_stats_temp">["atkBoostFromContext"];
  readonly defBoostFromContext?: ActionOf<"buff_stats_temp">["defBoostFromContext"];
  readonly atkBoostFromTarget?: ActionOf<"buff_stats_temp">["atkBoostFromTarget"];
  readonly permanent?: boolean;
  readonly grantSecondAttack?: boolean;
  readonly duration?: string;
  readonly durationTurns?: number;
  readonly turns?: number;
  readonly expiresOnTurn?: number;
  readonly sourceName?: string;
  readonly effectType?: string;
  readonly allowEmpty?: boolean;
}

interface GrantAttackAllActionView {
  readonly type: "grant_attack_all_monsters";
  readonly targetRef: string;
  readonly requireOpponentMonsters?: boolean;
  readonly attackCount?: number | "all";
}

interface SwitchPositionActionView {
  readonly atkBoost?: number;
  readonly defBoost?: number;
}

function isReadonlyArray<Value>(
  value: Value | readonly Value[],
): value is readonly Value[] {
  return Array.isArray(value);
}

function isActionMoveResult(value: unknown): value is ActionMoveResult {
  return typeof value === "object" && value !== null;
}

function isStatSourceProperty(
  value: unknown,
): value is "baseAtk" | "baseDef" | "atk" | "def" {
  return (
    value === "baseAtk" ||
    value === "baseDef" ||
    value === "atk" ||
    value === "def"
  );
}

function readCardProperty(card: ActionRuntimeCard, property: string): unknown {
  return Reflect.get(card, property);
}

function writeCardProperty(
  card: ActionRuntimeCard,
  property: string,
  value: unknown,
): boolean {
  return Reflect.set(card, property, value);
}

function deleteCardProperty(card: ActionRuntimeCard, property: string): boolean {
  return Reflect.deleteProperty(card, property);
}

function queueBanishAnimation(
  game: ActionRuntimeGamePort,
  owner: ActionRuntimePlayer | null | undefined,
  card: ActionRuntimeCard | null | undefined,
  fromZone: ZoneInput | null = null,
) {
  if (!game?.cardAnimationsReady || typeof game.queueCardAnimation !== "function") {
    return;
  }
  if (!owner || !card || card.instanceId == null) return;

  const source = game.ui?.captureCardAnimationSource?.(card, {
    ownerId: owner.id,
    zone: fromZone,
  });

  game.queueCardAnimation({
    kind: "banish",
    card,
    fromOwnerId: owner.id,
    toOwnerId: owner.id,
    fromZone,
    toZone: "banished",
    fromRect: source?.rect || null,
    fromHadCardElement: source?.hadCardElement === true,
    fromVisual: source?.visual || null,
  });
}

function queueCardFeedback(
  game: ActionRuntimeGamePort | null | undefined,
  kind: string,
  card: ActionRuntimeCard | null | undefined,
  options: CardFeedbackOptions = {},
) {
  if (typeof game?.queueVisualFeedback !== "function") return;
  if (!card) return;

  game.queueVisualFeedback({
    kind,
    sourceCard: options.sourceCard || null,
    targetCard: card,
    targetOwnerId: options.ownerId || card.owner || null,
    targetZone: options.targetZone || "field",
    tone: options.tone || "gold",
  });
}

function findCardOwner(
  game: ActionRuntimeGamePort | null | undefined,
  fallbackOwner: ActionRuntimePlayer | null | undefined,
  card: ActionRuntimeCard | null | undefined,
): ActionRuntimePlayer | null {
  if (!game || !card) return fallbackOwner || null;
  const owners: ActionRuntimePlayer[] = [game.player, game.bot].filter(
    (owner): owner is ActionRuntimePlayer => Boolean(owner),
  );
  const zones: readonly ZoneInput[] = [
    "hand",
    "field",
    "graveyard",
    "deck",
    "spellTrap",
    "extraDeck",
    "banished",
  ];

  for (const owner of owners) {
    if (owner.fieldSpell === card) return owner;
    for (const zone of zones) {
      const cards = Reflect.get(owner, zone);
      if (Array.isArray(cards) && cards.includes(card)) {
        return owner;
      }
    }
  }

  return fallbackOwner || null;
}

function asArray<Value>(
  value: Value | readonly Value[] | null | undefined,
): readonly Value[] {
  if (value === undefined || value === null) return [];
  return isReadonlyArray(value) ? value : [value];
}

function getZoneCards(
  owner: ActionRuntimePlayer | null | undefined,
  zoneName: ZoneInput | null | undefined,
): ActionRuntimeCard[] {
  if (!owner || !zoneName) return [];
  if (zoneName === "fieldSpell") {
    return owner.fieldSpell ? [owner.fieldSpell] : [];
  }
  const zone = Reflect.get(owner, zoneName) || [];
  return Array.isArray(zone) ? zone.filter(Boolean) : [];
}

function resolvePlayerScope(
  action: PlayerScopeAction,
  ctx: EffectContext,
): ActionRuntimePlayer[] {
  const rule = action.owner || action.player || "self";
  if (rule === "opponent") {
    return [ctx.opponent].filter(
      (owner): owner is ActionRuntimePlayer => Boolean(owner),
    );
  }
  if (rule === "both" || rule === "any") {
    return [ctx.player, ctx.opponent].filter(
      (owner): owner is ActionRuntimePlayer => Boolean(owner),
    );
  }
  return [ctx.player].filter(
    (owner): owner is ActionRuntimePlayer => Boolean(owner),
  );
}

function normalizeStatsList(
  value: string | readonly string[] | null | undefined,
): StatName[] {
  const list = Array.isArray(value) ? value : value ? [value] : ["atk", "def"];
  return list.filter((stat): stat is StatName => stat === "atk" || stat === "def");
}

function getBaseStat(card: ActionRuntimeCard, stat: StatName) {
  const baseKey = stat === "def" ? "baseDef" : "baseAtk";
  const base = Number(card?.[baseKey]);
  if (Number.isFinite(base)) return base;
  const current = Number(card?.[stat]);
  return Number.isFinite(current) ? current : 0;
}

function getTempBoostKey(stat: StatName): "tempAtkBoost" | "tempDefBoost" {
  return stat === "def" ? "tempDefBoost" : "tempAtkBoost";
}

function getEquipBonusKey(stat: StatName): "equipAtkBonus" | "equipDefBonus" {
  return stat === "def" ? "equipDefBonus" : "equipAtkBonus";
}

function subtractVisibleStat(
  card: ActionRuntimeCard | null | undefined,
  stat: StatName,
  amount: number,
) {
  if (!card || !Number.isFinite(amount) || amount <= 0) return 0;
  const current = Number(card[stat] || 0);
  const remove = Math.min(amount, Math.max(0, current));
  if (remove <= 0) return 0;
  card[stat] = Math.max(0, current - remove);
  return current - card[stat];
}

function sameCardReference(
  ref: unknown,
  card: ActionRuntimeCard | null | undefined,
) {
  if (!ref || !card) return false;
  if (ref === card) return true;
  if (typeof ref === "object") {
    const instanceId = Reflect.get(ref, "instanceId");
    return instanceId != null && instanceId === card.instanceId;
  }
  return card.instanceId != null && String(ref) === String(card.instanceId);
}

function findActiveEquipCards(
  game: ActionRuntimeGamePort | null | undefined,
  card: ActionRuntimeCard | null | undefined,
): ActionRuntimeCard[] {
  if (!game || !card) return [];
  const owners: ActionRuntimePlayer[] = [game.player, game.bot].filter(
    (owner): owner is ActionRuntimePlayer => Boolean(owner),
  );
  const equips: ActionRuntimeCard[] = [];
  for (const owner of owners) {
    for (const equip of owner.spellTrap || []) {
      if (
        equip &&
        equip.cardKind === "spell" &&
        equip.subtype === "equip" &&
        (sameCardReference(equip.equippedTo, card) ||
          sameCardReference(equip.equipTarget, card))
      ) {
        equips.push(equip);
      }
    }
  }
  if (Array.isArray(card.equips)) {
    for (const equip of card.equips) {
      if (equip && !equips.includes(equip)) equips.push(equip);
    }
  }
  return equips;
}

function suppressDynamicBuffStat(
  card: ActionRuntimeCard | null | undefined,
  key: string,
  stat: StatName,
  options: DynamicBuffSuppressionOptions = {},
) {
  if (!card || !key || !stat) return;
  const mapKey =
    options.temporary === true
      ? "temporarySuppressedDynamicBuffStatsByKey"
      : "suppressedDynamicBuffStatsByKey";
  if (!card[mapKey]) {
    card[mapKey] = {};
  }
  const current = card[mapKey][key];
  const next =
    current && typeof current === "object" && !Array.isArray(current)
      ? current
      : {};
  next[stat] = true;
  card[mapKey][key] = next;
}

function getDynamicBuffAppliedValue(
  entry: ActionRuntimeDynamicBuff,
  stat: StatName,
) {
  const stats = Array.isArray(entry?.stats) ? entry.stats : ["atk", "def"];
  if (!stats.includes(stat)) return 0;
  const appliedValues =
    entry?.appliedValues && typeof entry.appliedValues === "object"
      ? entry.appliedValues
      : null;
  const applied = Number(
    appliedValues?.[stat] ?? (stats.includes(stat) ? entry?.value : 0) ?? 0,
  );
  return Number.isFinite(applied) ? applied : 0;
}

function getPositiveDynamicStatEntries(
  card: ActionRuntimeCard | null | undefined,
  stat: StatName,
) {
  if (!card?.dynamicBuffs || typeof card.dynamicBuffs !== "object") return [];
  return Object.entries(card.dynamicBuffs)
    .map(([key, entry]) => ({
      key,
      entry,
      applied: getDynamicBuffAppliedValue(entry, stat),
    }))
    .filter(({ applied }) => applied > 0);
}

function suppressTemporaryDynamicStatIncreasesForDebuff(
  card: ActionRuntimeCard | null | undefined,
  stat: StatName,
  boost: number,
) {
  if (!card || !stat || !Number.isFinite(Number(boost)) || boost >= 0) return 0;

  const entries = getPositiveDynamicStatEntries(card, stat);
  if (entries.length === 0) return 0;

  const current = Number(card[stat] || 0);
  const dynamicTotal = entries.reduce(
    (total, { applied }) => total + applied,
    0,
  );
  if (current - dynamicTotal + boost > 0) return 0;

  let suppressed = 0;
  for (const { key, entry, applied } of entries) {
    const actual = subtractVisibleStat(card, stat, applied);
    if (actual <= 0) continue;
    suppressDynamicBuffStat(card, key, stat, { temporary: true });
    if (!entry.appliedValues || typeof entry.appliedValues !== "object") {
      entry.appliedValues = {};
    }
    entry.appliedValues[stat] = applied - actual;
    suppressed += actual;
  }
  return suppressed;
}

function consumeTrackedStatIncrease(
  card: ActionRuntimeCard,
  stat: StatName,
  remaining: number,
  game: ActionRuntimeGamePort,
) {
  let removed = 0;
  const consume = (amount: number) => {
    const targetAmount = Math.min(Math.max(0, amount || 0), remaining - removed);
    if (targetAmount <= 0) return 0;
    const actual = subtractVisibleStat(card, stat, targetAmount);
    removed += actual;
    return actual;
  };

  const tempKey = getTempBoostKey(stat);
  const tempBoost = Number(card[tempKey] || 0);
  if (tempBoost > 0 && removed < remaining) {
    const actual = consume(tempBoost);
    card[tempKey] = tempBoost - actual;
  }

  if (Array.isArray(card.turnBasedBuffs) && removed < remaining) {
    for (const buff of card.turnBasedBuffs) {
      if (removed >= remaining) break;
      if (buff?.stat !== stat || Number(buff.value || 0) <= 0) continue;
      const actual = consume(Number(buff.value || 0));
      buff.value = Number(buff.value || 0) - actual;
    }
    card.turnBasedBuffs = card.turnBasedBuffs.filter(
      (buff) => Number(buff?.value || 0) !== 0,
    );
  }

  if (card.permanentBuffsBySource && removed < remaining) {
    for (const [sourceName, buff] of Object.entries(
      card.permanentBuffsBySource,
    )) {
      if (removed >= remaining) break;
      if (!buff || Number(buff[stat] || 0) <= 0) continue;
      const actual = consume(Number(buff[stat] || 0));
      buff[stat] = Number(buff[stat] || 0) - actual;
      if (!buff.atk && !buff.def) {
        delete card.permanentBuffsBySource[sourceName];
      }
    }
    if (Object.keys(card.permanentBuffsBySource).length === 0) {
      delete card.permanentBuffsBySource;
    }
  }

  if (card.dynamicBuffs && removed < remaining) {
    for (const [key, entry] of Object.entries(card.dynamicBuffs)) {
      if (removed >= remaining) break;
      const applied = getDynamicBuffAppliedValue(entry, stat);
      if (applied <= 0) continue;
      const actual = consume(applied);
      if (actual > 0) {
        suppressDynamicBuffStat(card, key, stat);
        if (!entry.appliedValues || typeof entry.appliedValues !== "object") {
          entry.appliedValues = {};
        }
        entry.appliedValues[stat] = applied - actual;
      }
    }
  }

  const equipKey = getEquipBonusKey(stat);
  if (removed < remaining) {
    for (const equip of findActiveEquipCards(game, card)) {
      if (removed >= remaining) break;
      const bonus = Number(equip?.[equipKey] || 0);
      if (bonus <= 0) continue;
      const actual = consume(bonus);
      equip[equipKey] = bonus - actual;
    }
  }

  const hostStoredEquipBonus = Number(card[equipKey] || 0);
  if (hostStoredEquipBonus > 0 && removed < remaining) {
    const actual = consume(hostStoredEquipBonus);
    card[equipKey] = hostStoredEquipBonus - actual;
  }

  return removed;
}

function getLinkedSourceName(
  source: ActionRuntimeCard | null | undefined,
  actionType = "linked_stat_change",
) {
  const sourceId = source?.instanceId ?? source?.id ?? source?.name ?? "source";
  return `${actionType}_${sourceId}`;
}

function rememberLinkedBuffSource(
  source: ActionRuntimeCard | null | undefined,
  sourceName: string,
) {
  if (!source || !sourceName) return;
  if (!Array.isArray(source.linkedPermanentBuffSourceNames)) {
    source.linkedPermanentBuffSourceNames = [];
  }
  if (!source.linkedPermanentBuffSourceNames.includes(sourceName)) {
    source.linkedPermanentBuffSourceNames.push(sourceName);
  }
}

function applyNamedStatChange(
  card: ActionRuntimeCard | null | undefined,
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

function ownerHasCardInZone(
  owner: ActionRuntimePlayer | null | undefined,
  zone: ZoneInput | null | undefined,
  card: ActionRuntimeCard | null | undefined,
) {
  if (!owner || !zone || !card) return false;
  if (zone === "fieldSpell") return owner.fieldSpell === card;
  const cards = Reflect.get(owner, zone);
  return Array.isArray(cards) && cards.includes(card);
}

function isProtectiveStatus(status: string) {
  return /protect|indestructible|immune|prevent|cannotBeDestroyed/i.test(
    String(status || ""),
  );
}

/**
 * Generic handler for setting stats to zero and negating effects
 * Implements the "Sealing the Void" effect pattern
 *
 * Action properties:
 * - targetRef: reference to the target monster(s)
 * - setAtkToZero: boolean (default: true)
 * - setDefToZero: boolean (default: true)
 * - negateEffects: boolean (default: true)
 * - negateEffectsDuration: "until_end_turn" | "while_faceup"
 */
export async function handleSetStatsToZeroAndNegate(
  action: ActionOf<"set_stats_to_zero_and_negate">,

  ctx: EffectContext,

  targets: ResolvedTargetMap,

  engine: ActionHandlerEnginePort,
) {
  const { player } = ctx;

  const game = engine.game;

  if (!player || !game) return false;

  const targetCards = resolveTargetCards(action, ctx, targets, {
    targetRef: action.targetRef,

    requireArray: true,
  });

  if (targetCards.length === 0) {
    getUI(game)?.log("No valid targets for stat modification.");

    return false;
  }

  const setAtkToZero = action.setAtkToZero !== false;

  const setDefToZero = action.setDefToZero !== false;

  const negateEffects = action.negateEffects !== false;
  const negateEffectsDuration = normalizeNegateEffectsDuration(action);

  let modified = false;

  const affectedCards = [];

  for (const card of targetCards) {
    if (!card || card.cardKind !== "monster") continue;

    let cardModified = false;

    // Store original stats if setting to zero

    if (setAtkToZero && card.originalAtk == null) {
      card.originalAtk = card.atk;

      card.atk = 0;

      cardModified = true;
    }

    if (setDefToZero && card.originalDef == null) {
      card.originalDef = card.def;

      card.def = 0;

      cardModified = true;
    }

    // Negate effects

    if (negateEffects) {
      card.effectsNegated = true;
      card.effectsNegatedDuration = negateEffectsDuration;

      cardModified = true;
    }

    if (cardModified) {
      modified = true;

      affectedCards.push(card.name);
      queueCardFeedback(game, "negate", card, {
        sourceCard: ctx.source,
        tone: "violet",
      });
    }
  }

  // Log a consolidated message for all affected cards

  if (modified && affectedCards.length > 0) {
    const effects = [];

    if (setAtkToZero && setDefToZero) {
      effects.push("ATK/DEF became 0");
    } else if (setAtkToZero) {
      effects.push("ATK became 0");
    } else if (setDefToZero) {
      effects.push("DEF became 0");
    }

    if (negateEffects) {
      effects.push("effects are negated");
    }

    if (effects.length > 0) {
      const cardList = affectedCards.join(", ");

      const message = `${cardList}'s ${effects.join(
        " and ",
      )}${
        negateEffectsDuration === "while_faceup"
          ? " while face-up."
          : " until end of turn."
      }`;

      getUI(game)?.log(message);
    }
  }

  if (modified) {
    game.updateBoard();
  }

  return modified;
}

/**
 * Generic handler for temporarily boosting ATK/DEF until end of turn
 *
 * Action properties:
 * - targetRef: reference to the target card(s)
 * - atkBoost: ATK boost amount (default: 0)
 * - defBoost: DEF boost amount (default: 0)
 * - untilEndOfTurn: boolean (default: true)
 * - permanent: boolean (default: false) - if true, boost is not tracked for cleanup
 */
export async function handleBuffStatsTemp(
  action: ActionOf<
    | "buff_stats_temp"
    | "reduce_self_atk"
    | "grant_second_attack"
    | "buff_stats_temp_with_second_attack"
  >,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player } = ctx;

  const game = engine.game;

  if (!player || !game) return false;

  const statsAction: BuffStatsActionView = action;

  let atkBoost = statsAction.atkBoost || 0;
  if (statsAction.atkBoostFromContext) {
    atkBoost += resolveContextNumber(statsAction.atkBoostFromContext, ctx);
  }
  if (statsAction.atkBoostFromTarget) {
    const boostSpec = statsAction.atkBoostFromTarget;
    const stat = isStatSourceProperty(boostSpec?.stat)
      ? boostSpec.stat
      : "atk";
    const boostTarget = resolveTargetCards(
      { targetRef: boostSpec?.targetRef },
      ctx,
      targets,
      { game },
    )[0];
    const boostValue = Number(boostTarget?.[stat]);
    if (!boostTarget || !Number.isFinite(boostValue)) {
      getUI(game)?.log("The referenced target is no longer valid for the stat boost.");
      return false;
    }
    atkBoost += boostValue;
  }

  let defBoost = statsAction.defBoost || 0;
  if (statsAction.defBoostFromContext) {
    defBoost += resolveContextNumber(statsAction.defBoostFromContext, ctx);
  }

  let permanent = statsAction.permanent || false;

  const grantSecondAttack =
    statsAction.grantSecondAttack === true ||
    action.type === "grant_second_attack" ||
    action.type === "buff_stats_temp_with_second_attack";

  if (action.type === "reduce_self_atk" && atkBoost === 0) {
    const amount = Math.max(0, statsAction.amount ?? 0);

    if (amount > 0) {
      atkBoost = -amount;

      permanent = true;
    }
  }

  const duration = statsAction.duration || "end_of_turn";
  const isDamageCalculationBuff = duration === "damage_calculation";
  const isEndOfDamageStepBuff = duration === "end_of_damage_step";
  const durationTurns = Number(statsAction.durationTurns ?? statsAction.turns);
  const explicitExpiresOnTurn = Number(statsAction.expiresOnTurn);
  let turnBasedExpiresOnTurn: number | null = null;
  if (!permanent && !isDamageCalculationBuff && !isEndOfDamageStepBuff) {
    if (duration === "end_of_next_turn") {
      turnBasedExpiresOnTurn = game.turnCounter! + 1;
    } else if (Number.isFinite(durationTurns) && durationTurns > 0) {
      turnBasedExpiresOnTurn = game.turnCounter! + durationTurns;
    } else if (Number.isFinite(explicitExpiresOnTurn)) {
      turnBasedExpiresOnTurn = explicitExpiresOnTurn;
    }
  }
  const useTurnBasedBuff =
    Number.isFinite(turnBasedExpiresOnTurn) &&
    typeof game.applyTurnBasedBuff === "function";
  const durationText = permanent
    ? ""
    : isDamageCalculationBuff
      ? " during damage calculation"
      : isEndOfDamageStepBuff
        ? " until the end of the Damage Step"
      : useTurnBasedBuff && duration === "end_of_next_turn"
        ? " until end of next turn"
        : useTurnBasedBuff
          ? ` until turn ${turnBasedExpiresOnTurn}`
          : " until end of turn";

  const applyStatChange = (
    card: ActionRuntimeCard,
    stat: StatName,
    boost: number,
  ) => {
    if (!boost) return 0;

    if (
      boost < 0 &&
      !permanent &&
      !useTurnBasedBuff &&
      !isDamageCalculationBuff &&
      !isEndOfDamageStepBuff
    ) {
      suppressTemporaryDynamicStatIncreasesForDebuff(card, stat, boost);
    }

    const current = Number(card?.[stat] || 0);
    const next = Math.max(0, current + boost);
    const applied = next - current;
    if (applied === 0) return 0;

    if (useTurnBasedBuff) {
      const buffId = [
        statsAction.sourceName || ctx.source?.name || action.type || "stat_buff",
        card.instanceId || card.id || "card",
        stat,
        game.turnCounter,
        Array.isArray(card.turnBasedBuffs) ? card.turnBasedBuffs.length : 0,
      ].join("_");
      game.applyTurnBasedBuff!(
        card,
        stat,
        applied,
        turnBasedExpiresOnTurn!,
        buffId,
      );
      return applied;
    }

    if (!permanent) {
      if (stat === "atk") {
        card.tempAtkBoost = (card.tempAtkBoost || 0) + applied;
      } else if (stat === "def") {
        card.tempDefBoost = (card.tempDefBoost || 0) + applied;
      }
    }

    card[stat] = next;
    return applied;
  };

  let targetCards = statsAction.targetScope
    ? resolveFieldScopeCards(statsAction.targetScope, ctx, game, { engine })
    : resolveTargetCards(action, ctx, targets, {
        defaultRef: "self",
        game,
      });
  if (
    statsAction.targetScope &&
    typeof engine.filterCardsListByImmunity === "function"
  ) {
    targetCards = engine.filterCardsListByImmunity(targetCards, ctx.player, {
      actionType: action.type,
      effectType: statsAction.effectType || engine.inferEffectType?.(action.type),
      sourceCard: ctx?.source || null,
    }).allowed;
  }

  if (targetCards.length === 0) {
    const label =
      grantSecondAttack && atkBoost === 0 && defBoost === 0
        ? "second attack"
        : "stat buff";

    getUI(game)?.log(`No valid targets for ${label}.`);

    return statsAction.allowEmpty === true || statsAction.targetScope
      ? true
      : false;
  }

  let anyBuffed = false;

  let anySecondAttack = false;

  const buffedCards = [];

  const secondAttackCards = [];

  for (const card of targetCards) {
    if (!card || card.cardKind !== "monster") continue;

    let cardBuffed = false;

    // Track original stats for replay
    const originalAtk = card.atk;
    const originalDef = card.def;
    let appliedAtkBoost = 0;
    let appliedDefBoost = 0;

    if (atkBoost !== 0) {
      appliedAtkBoost = applyStatChange(card, "atk", atkBoost);
      if (appliedAtkBoost !== 0) {
        cardBuffed = true;
        anyBuffed = true;
      }
    }

    if (defBoost !== 0) {
      appliedDefBoost = applyStatChange(card, "def", defBoost);
      if (appliedDefBoost !== 0) {
        cardBuffed = true;
        anyBuffed = true;
      }
    }

    if (cardBuffed) {
      if (isDamageCalculationBuff) {
        game.damageCalculationTempBuffs = Array.isArray(
          game.damageCalculationTempBuffs,
        )
          ? game.damageCalculationTempBuffs
          : [];
        game.damageCalculationTempBuffs.push({
          card,
          atk: appliedAtkBoost,
          def: appliedDefBoost,
        });
        if (game.battleStep === "damage" || ctx?.isDamageStep === true) {
          game.damageCalculationStatChangePending = true;
        }
      }
      if (isEndOfDamageStepBuff) {
        game.endOfDamageStepTempBuffs = Array.isArray(
          game.endOfDamageStepTempBuffs,
        )
          ? game.endOfDamageStepTempBuffs
          : [];
        game.endOfDamageStepTempBuffs.push({
          card,
          atk: appliedAtkBoost,
          def: appliedDefBoost,
        });
      }

      buffedCards.push(card.name);
      const weakensStats = appliedAtkBoost < 0 || appliedDefBoost < 0;
      queueCardFeedback(game, weakensStats ? "debuff" : "buff", card, {
        sourceCard: ctx.source,
        tone: weakensStats ? "red" : "green",
      });

      // Emit buff event for replay capture
      game.emit?.("stat_buff_applied", {
        card,
        previousAtk: originalAtk,
        newAtk: card.atk,
        previousDef: originalDef,
        newDef: card.def,
        atkChange: appliedAtkBoost,
        defChange: appliedDefBoost,
        permanent,
        duration,
        expiresOnTurn: useTurnBasedBuff ? turnBasedExpiresOnTurn : null,
        sourceCard: ctx.source,
        player: ctx.player,
      });
    }

    if (grantSecondAttack) {
      if (!player.field.includes(card)) continue;

      card.canMakeSecondAttackThisTurn = true;

      card.secondAttackUsedThisTurn = false;

      if (statsAction.targetRestriction === "monster") {
        card.extraAttackTargetRestriction = "monster";
      }

      anySecondAttack = true;

      secondAttackCards.push(card.name);
      if (!cardBuffed) {
        queueCardFeedback(game, "buff", card, {
          sourceCard: ctx.source,
          tone: "green",
        });
      }
    }
  }

  if (anyBuffed && buffedCards.length > 0) {
    const boosts = [];

    if (atkBoost !== 0)
      boosts.push(`${atkBoost > 0 ? "+" : ""}${atkBoost} ATK`);

    if (defBoost !== 0)
      boosts.push(`${defBoost > 0 ? "+" : ""}${defBoost} DEF`);

    const cardList = buffedCards.join(", ");

    const combineSecondAttack =
      action.type === "buff_stats_temp_with_second_attack" && anySecondAttack;

    if (combineSecondAttack) {
      getUI(game)?.log(
        `${cardList} gained ${boosts.join(
          " and ",
        )}${durationText} and can make a second attack!`,
      );
    } else {
      getUI(game)?.log(
        `${cardList} gained ${boosts.join(" and ")}${durationText}.`,
      );
    }
  }

  if (anySecondAttack && secondAttackCards.length > 0) {
    const cardList = secondAttackCards.join(", ");

    if (action.type !== "buff_stats_temp_with_second_attack") {
      getUI(game)?.log(`${cardList} can attack again this turn.`);
    }
  }

  if (anyBuffed || anySecondAttack) {
    game.updateBoard();
  }

  const hadValidMonsterTarget = targetCards.some(
    (card) => card?.cardKind === "monster",
  );
  return anyBuffed || anySecondAttack || hadValidMonsterTarget;
}

export async function handleSetOriginalStats(
  action: ActionOf<"set_original_stats">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const game = engine?.game;
  const targetCards = resolveTargetCards(action, ctx, targets, {
    defaultRef: "self",
    game,
  });
  const setAtk =
    action.atk !== undefined ||
    action.atkFromContext !== undefined ||
    action.baseAtk !== undefined;
  const setDef =
    action.def !== undefined ||
    action.defFromContext !== undefined ||
    action.baseDef !== undefined;

  if (!setAtk && !setDef) {
    getUI(game)?.log("No original stat change configured.");
    return false;
  }

  if (targetCards.length === 0) {
    getUI(game)?.log("No valid targets for original stat change.");
    return false;
  }

  const updateCurrentStats = action.updateCurrentStats !== false;
  let changed = false;

  for (const card of targetCards) {
    if (!card || card.cardKind !== "monster") continue;

    if (!card.originalStatsOverride) {
      card.originalStatsOverride = {
        baseAtk: Number(card.baseAtk || 0),
        baseDef: Number(card.baseDef || 0),
      };
    }

    const previousAtk = Number(card.atk || 0);
    const previousDef = Number(card.def || 0);
    const previousBaseAtk = Number(card.baseAtk || 0);
    const previousBaseDef = Number(card.baseDef || 0);
    let nextBaseAtk = previousBaseAtk;
    let nextBaseDef = previousBaseDef;

    if (setAtk) {
      const rawAtk =
        action.atkFromContext !== undefined
          ? resolveContextNumber(action.atkFromContext, ctx, { round: "floor" })
          : action.atk ?? action.baseAtk;
      nextBaseAtk = Math.max(0, Math.floor(Number(rawAtk) || 0));
      card.baseAtk = nextBaseAtk;
      if (updateCurrentStats) card.atk = nextBaseAtk;
    }

    if (setDef) {
      const rawDef =
        action.defFromContext !== undefined
          ? resolveContextNumber(action.defFromContext, ctx, { round: "floor" })
          : action.def ?? action.baseDef;
      nextBaseDef = Math.max(0, Math.floor(Number(rawDef) || 0));
      card.baseDef = nextBaseDef;
      if (updateCurrentStats) card.def = nextBaseDef;
    }

    changed = true;
    queueCardFeedback(game, "buff", card, {
      sourceCard: ctx.source,
      tone: "green",
    });
    getUI(game)?.log(
      `${card.name}'s original stats became ${card.baseAtk} ATK / ${card.baseDef} DEF.`,
    );
    game?.emit?.("original_stats_changed", {
      card,
      previousAtk,
      previousDef,
      previousBaseAtk,
      previousBaseDef,
      newAtk: card.atk,
      newDef: card.def,
      newBaseAtk: card.baseAtk,
      newBaseDef: card.baseDef,
      sourceCard: ctx.source,
      player: ctx.player,
    });
  }

  if (changed) {
    game?.updateBoard?.();
  }

  return changed;
}

export async function handleBuffStatsByCounter(
  action: ActionOf<"buff_stats_by_counter">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const game = engine?.game;
  if (!game) return false;

  const counterType = action.counterType || "default";
  const minCounters = Number.isFinite(Number(action.minCounters))
    ? Number(action.minCounters)
    : 0;
  const atkPerCounter = Number.isFinite(Number(action.atkPerCounter))
    ? Number(action.atkPerCounter)
    : Number.isFinite(Number(action.atkBoostPerCounter))
      ? Number(action.atkBoostPerCounter)
      : 0;
  const defPerCounter = Number.isFinite(Number(action.defPerCounter))
    ? Number(action.defPerCounter)
    : Number.isFinite(Number(action.defBoostPerCounter))
      ? Number(action.defBoostPerCounter)
      : 0;

  if (atkPerCounter === 0 && defPerCounter === 0) {
    getUI(game)?.log("No stat change configured for counter-based buff.");
    return false;
  }

  const targetCards = resolveTargetCards(action, ctx, targets, {
    defaultRef: "self",
    game,
  });

  if (targetCards.length === 0) {
    getUI(game)?.log("No valid targets for counter-based stat buff.");
    return false;
  }

  let appliedAny = false;

  for (const card of targetCards) {
    if (!card || card.cardKind !== "monster") continue;

    const counterSourceCards = action.counterSourceRef
      ? resolveTargetCards(
          { ...action, targetRef: action.counterSourceRef },
          ctx,
          targets,
          { defaultRef: "self", game },
        )
      : [card];
    const counterCount = counterSourceCards.reduce((total, counterSource) => {
      if (!counterSource || typeof counterSource.getCounter !== "function") {
        return total;
      }
      return total + Math.max(0, Number(counterSource.getCounter(counterType) || 0));
    }, 0);

    if (counterCount < minCounters) continue;

    const atkBoost = atkPerCounter * counterCount;
    const defBoost = defPerCounter * counterCount;
    if (atkBoost === 0 && defBoost === 0) continue;

    const scopedTargetRef = "__counter_stat_target";
    const scopedTargets = {
      ...(targets || {}),
      [scopedTargetRef]: [card],
    };
    const applied = await handleBuffStatsTemp(
      {
        ...action,
        type: "buff_stats_temp",
        targetRef: scopedTargetRef,
        atkBoost,
        defBoost,
        sourceName: action.sourceName || ctx?.source?.name || action.type,
      },
      ctx,
      scopedTargets,
      engine,
    );

    appliedAny = applied || appliedAny;
  }

  return appliedAny;
}

/**
 * Generic handler for temporary stat changes that can destroy a monster if
 * this action is what reduced the checked stat to 0.
 *
 * Action properties:
 * - targetRef: reference to the target card(s)
 * - atkChange: ATK change amount (default: 0)
 * - defChange: DEF change amount (default: 0)
 * - destroyIfAtkZeroedByThisEffect: destroy if ATK crossed from above 0 to 0
 * - destroyIfDefZeroedByThisEffect: destroy if DEF crossed from above 0 to 0
 * - permanent: if true, stat changes are not tracked for end-turn cleanup
 */
export async function handleModifyStatsTempThenDestroyIfZeroed(
  action: ActionOf<"modify_stats_temp_then_destroy_if_zeroed">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const atkChange = action.atkChange || 0;
  const defChange = action.defChange || 0;
  const permanent = action.permanent || false;

  const targetCards = resolveTargetCards(action, ctx, targets, {
    defaultRef: "self",
    game,
  });

  if (targetCards.length === 0) {
    getUI(game)?.log("No valid targets for stat modification.");
    return false;
  }

  let modified = false;
  let destroyed = false;

  for (const card of targetCards) {
    if (!card || card.cardKind !== "monster" || card.isFacedown) continue;

    const previousAtk = card.atk || 0;
    const previousDef = card.def || 0;
    let newAtk = previousAtk;
    let newDef = previousDef;

    if (atkChange !== 0) {
      newAtk = Math.max(0, previousAtk + atkChange);
      const appliedAtkChange = newAtk - previousAtk;
      if (!permanent) {
        card.tempAtkBoost = (card.tempAtkBoost || 0) + appliedAtkChange;
      }
      card.atk = newAtk;
    }

    if (defChange !== 0) {
      newDef = Math.max(0, previousDef + defChange);
      const appliedDefChange = newDef - previousDef;
      if (!permanent) {
        card.tempDefBoost = (card.tempDefBoost || 0) + appliedDefChange;
      }
      card.def = newDef;
    }

    const appliedAtkChange = newAtk - previousAtk;
    const appliedDefChange = newDef - previousDef;
    const cardModified = appliedAtkChange !== 0 || appliedDefChange !== 0;

    if (cardModified) {
      modified = true;
      const weakensStats = appliedAtkChange < 0 || appliedDefChange < 0;
      queueCardFeedback(game, weakensStats ? "debuff" : "buff", card, {
        sourceCard: ctx.source,
        tone: weakensStats ? "red" : "green",
      });

      game.emit?.("stat_buff_applied", {
        card,
        previousAtk,
        newAtk: card.atk,
        previousDef,
        newDef: card.def,
        atkChange: appliedAtkChange,
        defChange: appliedDefChange,
        permanent,
        sourceCard: ctx.source,
        player: ctx.player,
      });

      const changes = [];
      if (appliedAtkChange !== 0) {
        changes.push(`${appliedAtkChange > 0 ? "+" : ""}${appliedAtkChange} ATK`);
      }
      if (appliedDefChange !== 0) {
        changes.push(`${appliedDefChange > 0 ? "+" : ""}${appliedDefChange} DEF`);
      }
      const duration = permanent ? "" : " until end of turn";
      const changeVerb =
        appliedAtkChange <= 0 && appliedDefChange <= 0 ? "lost" : "gained";
      const changeText = changes
        .join(" and ")
        .replace(/-/g, changeVerb === "lost" ? "" : "-");
      getUI(game)?.log(`${card.name} ${changeVerb} ${changeText}${duration}.`);
    }

    const atkZeroedByThisEffect =
      action.destroyIfAtkZeroedByThisEffect === true &&
      previousAtk > 0 &&
      newAtk === 0 &&
      appliedAtkChange < 0;
    const defZeroedByThisEffect =
      action.destroyIfDefZeroedByThisEffect === true &&
      previousDef > 0 &&
      newDef === 0 &&
      appliedDefChange < 0;

    if (atkZeroedByThisEffect || defZeroedByThisEffect) {
      await game.destroyCard(card, {
        cause: "effect",
        sourceCard: ctx.source,
        opponent: ctx.opponent,
      });
      destroyed = true;
      getUI(game)?.log(`${card.name} was destroyed because its stats became 0.`);
    }
  }

  if (modified || destroyed) {
    game.updateBoard();
  }

  return modified || destroyed || targetCards.some((card) => card?.cardKind === "monster");
}

export async function handleHalveTargetStatsAndGainRemoved(
  action: ActionOf<"halve_target_stats_and_gain_removed">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player, source } = ctx;
  const game = engine?.game;

  if (!player || !game || !source) return false;

  const targetCards = resolveTargetCards(action, ctx, targets, {
    targetRef: action.targetRef,
    game,
  });
  const gainCards = resolveTargetCards(action, ctx, targets, {
    targetRef: action.gainTargetRef || "self",
    defaultRef: "self",
    game,
  });
  const gainCard = gainCards.find((card) => card && card.cardKind === "monster");

  if (targetCards.length === 0 || !gainCard) {
    getUI(game)?.log("No valid targets for stat transfer.");
    return false;
  }

  const stats = normalizeStatsList(action.stats);
  const sourceName = action.sourceName || getLinkedSourceName(source, action.type);
  rememberLinkedBuffSource(source, sourceName);

  let anyChanged = false;

  for (const target of targetCards) {
    if (!target || target.cardKind !== "monster" || target.isFacedown) continue;

    const previousTargetAtk = Number(target.atk || 0);
    const previousTargetDef = Number(target.def || 0);
    const atkReduction = stats.includes("atk")
      ? Math.floor(previousTargetAtk / 2)
      : 0;
    const defReduction = stats.includes("def")
      ? Math.floor(previousTargetDef / 2)
      : 0;

    if (atkReduction <= 0 && defReduction <= 0) continue;

    const targetChange = applyNamedStatChange(
      target,
      sourceName,
      -atkReduction,
      -defReduction,
    );
    const removedAtk = Math.max(0, -targetChange.atk);
    const removedDef = Math.max(0, -targetChange.def);

    if (removedAtk <= 0 && removedDef <= 0) continue;

    applyNamedStatChange(gainCard, sourceName, removedAtk, removedDef);
    anyChanged = true;

    queueCardFeedback(game, "debuff", target, {
      sourceCard: source,
      tone: "red",
    });
    queueCardFeedback(game, "buff", gainCard, {
      sourceCard: source,
      tone: "green",
    });

    await game.emit?.("stat_buff_applied", {
      card: target,
      previousAtk: previousTargetAtk,
      newAtk: target.atk,
      previousDef: previousTargetDef,
      newDef: target.def,
      atkChange: targetChange.atk,
      defChange: targetChange.def,
      permanent: true,
      sourceCard: source,
      player: ctx.player,
    });
  }

  if (anyChanged) {
    getUI(game)?.log(`${source.name} drained ATK/DEF and gained that power.`);
    game.updateBoard?.();
  }

  return anyChanged || targetCards.some((card) => card?.cardKind === "monster");
}

/**
 * Temporarily boosts ATK by the amount of LP the player gained this turn.
 */
export async function handleBuffAtkByLpGainedThisTurn(
  action: ActionOf<"buff_atk_by_lp_gained_this_turn">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const atkBoost = Math.max(0, Math.floor(player.lpGainedThisTurn || 0));
  if (atkBoost <= 0) {
    getUI(game)?.log("No LP gained this turn; no ATK gained.");
    return true;
  }

  return handleBuffStatsTemp(
    {
      ...action,
      type: "buff_stats_temp",
      targetRef: action.targetRef || "self",
      atkBoost,
      defBoost: 0,
    },
    ctx,
    targets,
    engine,
  );
}

export async function handleSetAttackLimitFromZoneCount(
  action: ActionOf<"set_attack_limit_from_zone_count">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const game = engine?.game;
  if (!game) return false;

  const targetCards = resolveTargetCards(action, ctx, targets, {
    defaultRef: "self",
    game,
  }).filter((card) => card?.cardKind === "monster");

  if (targetCards.length === 0) {
    getUI(game)?.log("No valid targets for attack limit.");
    return false;
  }

  const zones = asArray(action.zone || "graveyard");
  const filters = action.filters || {};
  const owners = resolvePlayerScope(action, ctx);
  let count = 0;

  for (const owner of owners) {
    for (const zoneName of zones) {
      for (const card of getZoneCards(owner, zoneName)) {
        if (!card) continue;
        if (
          typeof engine.cardMatchesFilters === "function" &&
          !engine.cardMatchesFilters(card, filters)
        ) {
          continue;
        }
        count += 1;
      }
    }
  }

  const minAttacks = Number.isFinite(Number(action.minAttacks))
    ? Math.max(0, Math.floor(Number(action.minAttacks)))
    : 0;
  const attackLimit = Math.max(minAttacks, count);
  const duration = action.duration || "until_end_turn";

  for (const card of targetCards) {
    card.attackLimitThisTurn = attackLimit;
    card.attackLimitDuration = duration;
    queueCardFeedback(game, "buff", card, {
      sourceCard: ctx.source,
      tone: "green",
    });
  }

  const cardList = targetCards.map((card) => card.name).join(", ");
  getUI(game)?.log(
    `${cardList} can declare up to ${attackLimit} attack${
      attackLimit === 1 ? "" : "s"
    } this turn.`,
  );
  game.updateBoard?.();
  return true;
}

/**
 * Generic handler for granting ability to attack all opponent monsters this turn
 *
 * Action properties:
 * - targetRef: reference to the monster(s) that will gain the ability
 * - attackCount: how many times each target can attack (default: "all" = number of opponent monsters)
 * - requireOpponentMonsters: if true, effect fails if opponent has no monsters (default: false)
 *
 * This sets a flag on the monster that allows it to attack each opponent monster once.
 * The attack limit is dynamically calculated based on opponent's field.
 *
 * Used by future multi-attack effects.
 */
export async function handleGrantAttackAllMonsters(
  action: ActionOf<"grant_attack_all_monsters">,

  ctx: EffectContext,

  targets: ResolvedTargetMap,

  engine: ActionHandlerEnginePort,
) {
  const { player } = ctx;

  const game = engine.game;

  if (!player || !game) return false;

  const attackAction: GrantAttackAllActionView = action;

  const targetCards = resolveTargetCards(action, ctx, targets, {
    defaultRef: "self",
  });

  if (targetCards.length === 0) {
    getUI(game)?.log("No valid targets for multi-attack effect.");

    return false;
  }

  const opponent = player.id === "player" ? game.bot : game.player;

  const opponentMonsterCount = (opponent?.field || []).filter(
    (m) => m && !m.isFacedown,
  ).length;

  // Check if opponent has monsters when required

  if (attackAction.requireOpponentMonsters && opponentMonsterCount === 0) {
    getUI(game)?.log("No opponent monsters to attack.");

    return false;
  }

  let anyGranted = false;

  const grantedCards = [];

  for (const card of targetCards) {
    if (!card || card.cardKind !== "monster") continue;

    if (!player.field?.includes(card)) continue;

    if (card.isFacedown) continue;

    // Set flag for attacking all opponent monsters

    card.canAttackAllOpponentMonstersThisTurn = true;

    // Track which monsters have been attacked this turn (cleared at end of turn)

    card.attackedMonstersThisTurn = card.attackedMonstersThisTurn || new Set();

    // Calculate max attacks based on opponent's current field

    // This is recalculated dynamically in getAttackAvailability

    const attackLimit =
      attackAction.attackCount === "all"
        ? Math.max(1, opponentMonsterCount)
        : typeof attackAction.attackCount === "number"
          ? attackAction.attackCount
          : opponentMonsterCount;

    card.multiAttackLimit = attackLimit;

    anyGranted = true;

    grantedCards.push(card.name);
    queueCardFeedback(game, "buff", card, {
      sourceCard: ctx.source,
      tone: "green",
    });
  }

  if (anyGranted && grantedCards.length > 0) {
    const cardList = grantedCards.join(", ");

    if (opponentMonsterCount > 0) {
      getUI(game)?.log(
        `${cardList} can attack all opponent monsters this turn!`,
      );
    } else {
      getUI(game)?.log(
        `${cardList} gained multi-attack ability, but opponent has no monsters.`,
      );
    }

    game.updateBoard();
  }

  return anyGranted;
}

/**
 * Generic handler for adding/removing status flags
 *
 * Action properties:
 * - targetRef: reference to the target card(s)
 * - status: status flag to add/remove (e.g., "battleIndestructible", "piercing")
 * - value: value to set (default: true)
 * - remove: if true, removes the status instead (default: false)
 * - untilEndOfTurn: if true, status is cleared at end of turn (handled by Game.cleanupTempBoosts)
 */
export async function handleAddStatus(
  action: ActionOf<"add_status">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player } = ctx;

  const game = engine.game;

  if (!player || !game) return false;

  let targetCards = action.targetScope
    ? resolveFieldScopeCards(action.targetScope, ctx, game, { engine })
    : resolveTargetCards(action, ctx, targets, {
        defaultRef: "self",
      });

  const declaredTarget = Array.isArray(ctx?.effect?.targets)
    ? ctx.effect.targets.find((target) => target?.id === action.targetRef)
    : null;
  if (
    declaredTarget &&
    !declaredTarget.targetFromContext &&
    typeof engine.selectCandidates === "function"
  ) {
    const currentCandidates = engine.selectCandidates(
      declaredTarget,
      ctx,
    )?.candidates;
    if (Array.isArray(currentCandidates)) {
      const validNow = new Set(currentCandidates);
      targetCards = targetCards.filter((card) => validNow.has(card));
    }
  }

  if (targetCards.length === 0) {
    if (action.targetScope) return true;

    getUI(game)?.log("No valid targets for status change.");

    return false;
  }

  const status = action.status;

  const value = action.value !== undefined ? action.value : true;

  const remove = action.remove || false;
  const untilEndOfTurn =
    action.untilEndOfTurn === true || action.duration === "until_end_turn";

  if (!status) {
    return false;
  }

  let modified = false;

  const affectedCards = [];

  // Status properties that should be additive (sum values) instead of replacing
  const ADDITIVE_STATUS = ["extraAttacks"];

  for (const card of targetCards) {
    if (!card) continue;

    if (!remove && untilEndOfTurn) {
      if (!card.tempStatuses) {
        card.tempStatuses = {};
      }
      if (!Object.prototype.hasOwnProperty.call(card.tempStatuses, status)) {
        card.tempStatuses[status] = readCardProperty(card, status);
      }
    }

    if (remove) {
      if (readCardProperty(card, status) !== undefined) {
        // For additive status, subtract instead of delete
        if (
          ADDITIVE_STATUS.includes(status) &&
          typeof readCardProperty(card, status) === "number"
        ) {
          writeCardProperty(
            card,
            status,
            Math.max(
            0,
              Number(readCardProperty(card, status)) -
                (typeof value === "number" ? value : 1),
            ),
          );
        } else {
          deleteCardProperty(card, status);
        }

        modified = true;

        affectedCards.push(card.name);
        queueCardFeedback(game, "debuff", card, {
          sourceCard: ctx.source,
          tone: "red",
        });
      }
      if (
        card.tempStatuses &&
        Object.prototype.hasOwnProperty.call(card.tempStatuses, status)
      ) {
        delete card.tempStatuses[status];
      }
      if (status === "effectsNegated") {
        card.effectsNegatedDuration = null;
      }
    } else {
      // For additive status, sum values instead of replacing
      if (ADDITIVE_STATUS.includes(status) && typeof value === "number") {
        writeCardProperty(
          card,
          status,
          Number(readCardProperty(card, status) || 0) + value,
        );
      } else {
        writeCardProperty(card, status, value);
      }
      if (status === "effectsNegated") {
        card.effectsNegatedDuration = normalizeNegateEffectsDuration(action);
      }

      modified = true;

      affectedCards.push(card.name);
      const disablesStatus = value === false || value === 0 || value === null;
      const protective = isProtectiveStatus(status);
      const feedbackKind = disablesStatus
        ? "debuff"
        : protective
          ? "protect"
          : "buff";
      queueCardFeedback(game, feedbackKind, card, {
        sourceCard: ctx.source,
        tone: disablesStatus ? "red" : protective ? "blue" : "green",
      });
    }
  }

  if (modified && affectedCards.length > 0) {
    const knownDisplayStatus = Reflect.get(STATUS_DISPLAY_NAMES, status);
    const displayStatus =
      typeof knownDisplayStatus === "string" ? knownDisplayStatus : status;

    const cardList = affectedCards.join(", ");

    const statusText = remove
      ? `lost ${displayStatus}`
      : `gained ${displayStatus}`;

    getUI(game)?.log(`${cardList} ${statusText}.`);

    game.updateBoard();
  }

  return modified;
}

function computeProtectionExpiresOnTurn(
  game: ActionRuntimeGamePort | null | undefined,
  duration: string | number,
  action: DurationAction = {},
) {
  const explicit = Number(action.expiresOnTurn);
  if (Number.isFinite(explicit)) return explicit;

  const durationTurns = Number(action.durationTurns ?? action.turns);
  if (Number.isFinite(durationTurns) && durationTurns > 0) {
    return Number(game?.turnCounter || 0) + durationTurns;
  }

  if (duration === "end_of_next_turn") {
    return Number(game?.turnCounter || 0) + 1;
  }
  if (duration === "end_of_turn") {
    return Number(game?.turnCounter || 0);
  }
  if (Number.isFinite(Number(duration))) {
    return Number(duration);
  }
  return null;
}

/**
 * Handler for granting protection against destruction.
 *
 * Action properties:
 * - targetRef/targetScope: recipient(s) that receive protection
 * - protectionType: "effect_destruction", "battle_destruction", etc.
 * - duration: "while_faceup", "end_of_turn", "end_of_next_turn", or turn number
 * - sourceOwner: optional "self", "opponent", or "any" relative to the protected card
 */
export async function handleGrantProtection(
  action: ActionOf<"grant_protection">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player, source } = ctx;

  const game = engine.game;

  if (!player || !game) return false;

  const targetCards = action.targetScope
    ? resolveFieldScopeCards(action.targetScope, ctx, game, { engine })
    : resolveTargetCards(action, ctx, targets, {
        targetRef: action.targetRef,
        requireArray: true,
      });

  if (!targetCards || targetCards.length === 0) {
    getUI(game)?.log("No valid targets for protection.");

    return false;
  }

  const protectionType = action.protectionType || "effect_destruction";

  const duration = action.duration || "while_faceup";

  const expiresOnTurn = computeProtectionExpiresOnTurn(game, duration, action);
  const sourceName = source?.name || "Unknown";
  const sourceOwner = action.sourceOwner || "any";

  for (const target of targetCards) {
    if (!target) continue;

    // Initialize protectionEffects array if needed

    if (!Array.isArray(target.protectionEffects)) {
      target.protectionEffects = [];
    }

    // Add protection entry

    target.protectionEffects.push({
      type: protectionType,

      source: sourceName,

      duration,

      grantedOnTurn: game.turnCounter,

      expiresOnTurn,

      sourceOwner,

      removeOnLeave: action.removeOnLeave !== false,
    });

    const protectionText =
      protectionType === "battle_destruction"
        ? "battle"
        : sourceOwner === "opponent"
          ? "opponent's card effects"
          : "card effects";
    getUI(game)?.log(
      `${target.name} is now protected from destruction by ${protectionText}!`,
    );
    queueCardFeedback(game, "protect", target, {
      sourceCard: source,
      tone: "blue",
    });
  }

  game.updateBoard();

  return true;
}

/**
 * Generic handler for banishing cards from a zone and applying buff based on property
 *
 * This handler is flexible and can:
 * - Banish from graveyard, hand, or any zone
 * - Apply ATK/DEF buff based on atk, def, level, or fixed value
 * - Temporary buff (until end of turn) or permanent
 * - Support selection by filters (type, level, archetype, etc.)
 *
 * Action properties:
 * - targetRef: reference to the target(s) to be banished (required)
 * - buffTarget: who receives the buff ("self" = source card, or specific targetRef)
 * - buffSource: property of banished card to use ("atk", "def", "level", or fixed number)
 * - buffMultiplier: value multiplier (default: 1)
 * - buffType: "atk", "def", or "both" (default: "atk")
 * - duration: "end_of_turn" or "permanent" (default: "end_of_turn")
 * - optional: if true, player can cancel selection (default: false)
 */
export async function handleBanishAndBuff(
  action: ActionOf<"banish_and_buff">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player, source } = ctx;

  const game = engine.game;

  if (!player || !game) return false;
  if (typeof game.moveCard !== "function") return false;

  // Resolve targets to banish

  const banishTargets = resolveTargetCards(action, ctx, targets, {
    targetRef: action.targetRef,

    requireArray: true,
  });

  if (!banishTargets || banishTargets.length === 0) {
    getUI(game)?.log("No valid targets to banish.");

    return false;
  }

  const buffSource = action.buffSource || "atk";

  const buffMultiplier = action.buffMultiplier ?? 1;

  const banishEntries = [];

  for (const banishCard of banishTargets) {
    if (!banishCard) continue;

    let cardValue = 0;
    if (typeof buffSource === "number") {
      cardValue = buffSource;
    } else if (buffSource === "atk") {
      cardValue = banishCard.atk || 0;
    } else if (buffSource === "def") {
      cardValue = banishCard.def || 0;
    } else if (buffSource === "level") {
      cardValue = (banishCard.level || 0) * 100; // Convert level to points
    } else {
      cardValue = Number(readCardProperty(banishCard, buffSource) || 0);
    }

    const banishOwner = findCardOwner(game, player, banishCard);
    const fromZone =
      typeof engine.findCardZone === "function" && banishOwner
        ? engine.findCardZone(banishOwner, banishCard)
        : "graveyard";

    if (!banishOwner || !ownerHasCardInZone(banishOwner, fromZone, banishCard)) {
      getUI(game)?.log(`${banishCard.name} could not be banished.`);
      return false;
    }

    banishEntries.push({
      card: banishCard,
      owner: banishOwner,
      fromZone,
      value: Math.floor(cardValue * buffMultiplier),
    });
  }

  if (banishEntries.length === 0) {
    getUI(game)?.log("No valid targets to banish.");
    return false;
  }

  let totalBuffValue = 0;

  for (const entry of banishEntries) {
    queueBanishAnimation(game, entry.owner, entry.card, entry.fromZone);

    const moveResult = await game.moveCard(entry.card, entry.owner, "banished", {
      fromZone: entry.fromZone,
      awaitEvents: true,
      sourceCard: source,
      sourcePlayer: player,
      effectId: ctx?.effect?.id || null,
      contextLabel: "banish_and_buff",
    });

    if (isActionMoveResult(moveResult) && moveResult.needsSelection) {
      return {
        ...moveResult,
        needsSelection: true,
        success: false,
      } satisfies NeedsSelectionResult;
    }
    if (
      moveResult === false ||
      (isActionMoveResult(moveResult) && moveResult.success === false)
    ) {
      getUI(game)?.log(`${entry.card.name} could not be banished.`);
      return false;
    }

    // Keep legacy mirror for older diagnostics that still read game.banishedCards.
    if (!game.banishedCards) {
      game.banishedCards = [];
    }

    if (!game.banishedCards.includes(entry.card)) {
      game.banishedCards.push(entry.card);
    }

    totalBuffValue += entry.value;
    getUI(game)?.log(`${entry.card.name} was banished (removed from game).`);
  }

  if (totalBuffValue === 0) {
    getUI(game)?.log("Banished card(s) have 0 value, no buff applied.");

    game.updateBoard();

    return true;
  }

  // Determine who receives the buff

  const buffTargetRef = action.buffTarget || "self";

  let buffRecipients: ActionRuntimeCard[] = [];

  if (buffTargetRef === "self") {
    if (source) buffRecipients = [source];
  } else {
    buffRecipients = resolveTargetCards(action, ctx, targets, {
      targetRef: buffTargetRef,

      requireArray: true,
    });
  }

  if (buffRecipients.length === 0) {
    getUI(game)?.log("No valid recipient for buff.");

    game.updateBoard();

    return true;
  }

  // Apply buff

  const buffType = action.buffType || "atk";

  const duration = action.duration || "end_of_turn";

  const isTemporary = duration === "end_of_turn";

  for (const recipient of buffRecipients) {
    if (!recipient || recipient.cardKind !== "monster") continue;

    if (buffType === "atk" || buffType === "both") {
      recipient.atk = (recipient.atk || 0) + totalBuffValue;

      if (isTemporary) {
        recipient.tempAtkBoost = (recipient.tempAtkBoost || 0) + totalBuffValue;
      }
    }

    if (buffType === "def" || buffType === "both") {
      recipient.def = (recipient.def || 0) + totalBuffValue;

      if (isTemporary) {
        recipient.tempDefBoost = (recipient.tempDefBoost || 0) + totalBuffValue;
      }
    }

    const durationText = isTemporary ? " until end of turn" : "";

    const statText = buffType === "both" ? "ATK/DEF" : buffType.toUpperCase();

    getUI(game)?.log(
      `${recipient.name} gains ${totalBuffValue} ${statText}${durationText}!`,
    );
    queueCardFeedback(game, "buff", recipient, {
      sourceCard: source,
      tone: "green",
    });
  }

  game.updateBoard();

  return true;
}

/**
 * Changes a face-up monster to face-down Defense Position.
 *
 * `battlePositionLocked` is deliberately an instance status: it follows a
 * monster through control changes but is cleared when it leaves the field.
 */
export async function handleSetFacedownDefense(
  action: ActionOf<"set_facedown_defense">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player } = ctx;
  const game = engine?.game;
  if (!player || !game) return false;

  const targetCards = resolveTargetCards(action, ctx, targets, {
    targetRef: action.targetRef,
    requireArray: true,
  });
  if (targetCards.length === 0) {
    getUI(game)?.log("No valid targets to set face-down.");
    return false;
  }

  let changed = false;
  for (const card of targetCards) {
    if (!card || card.cardKind !== "monster" || card.isFacedown === true) {
      continue;
    }
    const cardPlayer = findCardOwner(game, player, card);
    if (!cardPlayer?.field?.includes(card)) continue;

    const previousPosition = card.position;
    card.position = "defense";
    card.isFacedown = true;
    if (
      card.effectsNegated === true &&
      card.effectsNegatedDuration === "while_faceup"
    ) {
      card.effectsNegated = false;
      card.effectsNegatedDuration = null;
    }
    card.hasChangedPosition = true;
    card.positionChangedThisTurn = true;
    if (action.lockBattlePosition === true) {
      card.battlePositionLocked = true;
    }

    game.effectEngine?.clearTargetingCache?.();
    await game.emit?.("position_change", {
      card,
      player: cardPlayer,
      opponent: game.getOpponent?.(cardPlayer) || null,
      sourceCard: ctx.source || null,
      fromPosition: previousPosition,
      toPosition: "defense",
      wasSetFacedown: true,
      battlePositionLocked: card.battlePositionLocked === true,
      actionContext: ctx?.actionContext || null,
    });
    getUI(game)?.log(`${card.name} was changed to face-down Defense Position.`);
    queueCardFeedback(game, "position", card, {
      sourceCard: ctx.source || null,
      tone: "gold",
    });
    changed = true;
  }

  if (changed) game.updateBoard?.();
  return changed;
}

/**
 * Generic handler for switching monster position (attack <-> defense)
 *
 * Action properties:
 * - targetRef: reference to the target card(s)
 * - atkBoost: optional ATK boost after position change
 * - defBoost: optional DEF boost after position change
 * - markChanged: if true, sets hasChangedPosition (default: true)
 */
export async function handleSwitchPosition(
  action: ActionOf<"switch_position">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player } = ctx;

  const game = engine.game;

  if (!player || !game) return false;

  const switchAction: SwitchPositionActionView = action;

  const targetCards = action.targetScope
    ? resolveFieldScopeCards(action.targetScope, ctx, game, { engine })
    : resolveTargetCards(action, ctx, targets, {
        targetRef: action.targetRef,
        requireArray: true,
      });

  if (targetCards.length === 0) {
    getUI(game)?.log("No valid targets for position switch.");
    return false;
  }

  let switched = false;

  const affectedCards = [];

  for (const card of targetCards) {
    if (!card || card.cardKind !== "monster") continue;
    if (card.battlePositionLocked === true) {
      getUI(game)?.log(`${card.name} cannot change its battle position.`);
      continue;
    }

    const previousPosition = card.position;
    const wasFacedown = card.isFacedown === true;
    const ownerId = card.owner === "player" ? "player" : "bot";
    const ownerField =
      ownerId === "player" ? game.player?.field : game.bot?.field;
    const fieldIndex = Array.isArray(ownerField) ? ownerField.indexOf(card) : -1;
    const newPosition = wasFacedown
      ? "attack"
      : card.position === "attack"
        ? "defense"
        : "attack";

    card.position = newPosition;
    if (wasFacedown) {
      card.isFacedown = false;
      card.revealedTurn = game.turnCounter;
    }

    if (action.markChanged !== false) {
      card.hasChangedPosition = true;
    }

    // Apply stat boosts if specified

    if (action.atkBoost) {
      card.tempAtkBoost = (card.tempAtkBoost || 0) + action.atkBoost;

      card.atk = (card.atk || 0) + action.atkBoost;
    }

    if (switchAction.defBoost) {
      card.tempDefBoost = (card.tempDefBoost || 0) + switchAction.defBoost;

      card.def = (card.def || 0) + switchAction.defBoost;
    }

    const cardPlayer = card.owner === "player" ? game.player : game.bot;
    await game.emit?.("position_change", {
      card,
      player: cardPlayer || player,
      opponent:
        typeof game.getOpponent === "function" && (cardPlayer || player)
          ? game.getOpponent(cardPlayer || player)
          : null,
      sourceCard: ctx.source,
      fromPosition: previousPosition,
      toPosition: newPosition,
      wasFlipped: wasFacedown,
      actionContext: ctx?.actionContext || null,
    });

    switched = true;

    affectedCards.push({
      name: card.name,

      position: newPosition,
      ownerId,
      fieldIndex,
      wasFacedown,
    });
  }

  if (switched && affectedCards.length > 0) {
    for (const info of affectedCards) {
      getUI(game)?.log(
        `${info.name} switched to ${info.position.toUpperCase()} Position.`,
      );
    }

    game.updateBoard();

    affectedCards
      .filter((info) => info.wasFacedown && info.position === "attack")
      .forEach((info) => {
        getUI(game)?.applyFlipAnimation?.(info.ownerId, info.fieldIndex, {
          mode: "reveal-to-attack",
          deferFrames: 0,
        });
      });
  }

  return switched;
}

/**
 * Handler for switching defender position on attack
 * If defender is face-down, flip it first, then switch to attack position.
 */
export async function handleSwitchDefenderPositionOnAttack(
  action: ActionOf<"switch_defender_position_on_attack">,

  ctx: EffectContext,

  targets: ResolvedTargetMap,

  engine: ActionHandlerEnginePort,
) {
  const { player, defender } = ctx;

  const game = engine.game;

  if (!defender || defender.cardKind !== "monster") {
    getUI(game)?.log("No valid defender to switch position.");

    return false;
  }
  if (defender.battlePositionLocked === true) {
    getUI(game)?.log(`${defender.name} cannot change its battle position.`);
    return false;
  }

  // If face-down, flip it first
  if (defender.isFacedown) {
    const defenderOwner = defender.owner === "player" ? "player" : "bot";
    const defenderField =
      defender.owner === "player" ? game.player.field : game.bot.field;
    const defenderIndex = defenderField.indexOf(defender);

    if (game.ui && typeof game.ui.applyFlipAnimation === "function") {
      game.ui.applyFlipAnimation(defenderOwner, defenderIndex);
    }

    defender.isFacedown = false;
    defender.revealedTurn = game.turnCounter;
    game.effectEngine?.clearTargetingCache?.();
    getUI(game)?.log(`${defender.name} was flipped!`);
    game.updateBoard();

    // Small delay for animation; skipped in instant/headless Arena.
    if (typeof game.waitForPresentationDelay === "function") {
      await game.waitForPresentationDelay(300);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  if (defender.position !== "defense") {
    getUI(game)?.log(`${defender.name} is already in attack position.`);

    return true; // Not an error, just already in attack
  }

  // Switch position to attack

  defender.position = "attack";

  defender.hasChangedPosition = true;

  getUI(game)?.log(`${defender.name} switched to ATTACK Position.`);

  game.updateBoard();

  return true;
}

/**
 * Removes visible positive ATK/DEF increases from target monsters.
 *
 * This consumes tracked stat sources in a stable order and suppresses removed
 * passive dynamic buff keys so continuous buffs do not immediately reapply
 * while the affected card remains on the field.
 */
export async function handleRemoveStatIncreases(
  action: ActionOf<"remove_stat_increases">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const game = engine?.game;
  if (!game) return false;

  const targetCards = resolveTargetCards(action, ctx, targets, {
    defaultRef: "self",
    game,
  });
  const stats = normalizeStatsList(action.stats);
  if (targetCards.length === 0 || stats.length === 0) return false;

  let anyRemoved = false;

  for (const card of targetCards) {
    if (!card || card.cardKind !== "monster") continue;

    const removedByStat: Partial<{ [Key in StatName]: number }> = {};
    for (const stat of stats) {
      const current = Number(card[stat] || 0);
      const base = getBaseStat(card, stat);
      const visibleIncrease = Math.max(0, current - base);
      if (visibleIncrease <= 0) continue;

      const removed = consumeTrackedStatIncrease(
        card,
        stat,
        visibleIncrease,
        game,
      );
      if (removed > 0) {
        removedByStat[stat] = removed;
        anyRemoved = true;
      }
    }

    if (Object.keys(removedByStat).length > 0) {
      queueCardFeedback(game, "debuff", card, {
        sourceCard: ctx?.source || null,
        tone: "red",
      });
      await game.emit?.("stat_increases_removed", {
        card,
        sourceCard: ctx?.source || null,
        removedByStat,
        player: ctx?.player || null,
      });
    }
  }

  if (anyRemoved) {
    getUI(game)?.log(
      `${ctx?.source?.name || "An effect"} removed visible stat increases.`,
    );
    game.updateBoard?.();
  }

  return anyRemoved || targetCards.some((card) => card?.cardKind === "monster");
}

/**
 * Generic handler for permanent ATK/DEF buffs with named tracking
 * This allows stackable buffs that persist while the card is on the field
 *
 * Action properties:
 * - targetRef: reference to the target card (default: "self")
 * - atkBoost: ATK boost amount (default: 0)
 * - defBoost: DEF boost amount (default: 0)
 * - sourceName: identifier for this buff source (default: source card name)
 * - cumulative: if true, adds to existing buff; if false, sets total (default: true)
 * - applyToAllField: if true, applies to all monsters on player's field matching filters
 * - archetype: if specified, only buff monsters of this archetype
 * - summonedCard: special targetRef that refers to ctx.summonedCard
 */
export async function handlePermanentBuffNamed(
  action: ActionOf<"permanent_buff_named">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player, source } = ctx;

  const game = engine.game;

  if (!player || !game || !source) return false;

  const targetRef = action.targetRef || "self";
  const fieldWideAura = targetRef === "self" && action.applyToAllField;

  let targetCards: ActionRuntimeCard[] = [];

  // Special handling for summonedCard

  if (targetRef === "summonedCard") {
    const summonedCard = ctx.summonedCard;

    if (summonedCard) {
      targetCards = [summonedCard];
    }
  } else if (fieldWideAura) {
    // Apply to all monsters on field matching archetype

    targetCards = (player.field || []).filter((card) => {
      if (!card || card.cardKind !== "monster") return false;

      if (card.isFacedown) return false;

      // Check archetype filter

      if (action.archetype) {
        const cardArchetypes = Array.isArray(card.archetypes)
          ? card.archetypes
          : card.archetype
            ? [card.archetype]
            : [];

        if (!cardArchetypes.includes(action.archetype)) return false;
      }

      return true;
    });
  } else {
    targetCards = resolveTargetCards(action, ctx, targets, {
      targetRef,

      defaultRef: "self",
    });
  }

  if (targetCards.length === 0) {
    return fieldWideAura;
  }

  const atkBoost = action.atkBoost || 0;

  const defBoost = action.defBoost || 0;

  const sourceName = action.sourceName || source.name;

  const cumulative = action.cumulative !== false;

  let anyBuffed = false;

  for (const card of targetCards) {
    if (!card || card.cardKind !== "monster") continue;

    // Check archetype filter again for summoned card scenario

    if (action.archetype && targetRef === "summonedCard") {
      const cardArchetypes = Array.isArray(card.archetypes)
        ? card.archetypes
        : card.archetype
          ? [card.archetype]
          : [];

      if (!cardArchetypes.includes(action.archetype)) continue;
    }

    // Check if card owner matches

    if (card.owner && card.owner !== player.id) continue;

    // Initialize permanent buffs tracking

    if (!card.permanentBuffsBySource) {
      card.permanentBuffsBySource = {};
    }

    // If cumulative is false and card already has this buff, skip it
    if (!cumulative && card.permanentBuffsBySource[sourceName]) {
      const existingAtk = card.permanentBuffsBySource[sourceName]?.atk || 0;
      const existingDef = card.permanentBuffsBySource[sourceName]?.def || 0;

      // Already has the exact buff, skip
      if (existingAtk === atkBoost && existingDef === defBoost) {
        continue;
      }
    }

    let cardBuffed = false;

    if (atkBoost !== 0) {
      const currentBuff = card.permanentBuffsBySource[sourceName]?.atk || 0;

      const newBuff = cumulative ? currentBuff + atkBoost : atkBoost;

      if (!card.permanentBuffsBySource[sourceName]) {
        card.permanentBuffsBySource[sourceName] = {};
      }

      card.permanentBuffsBySource[sourceName].atk = newBuff;

      // Apply to actual stat (calculate delta and apply, clamp to 0)

      const delta = newBuff - currentBuff;

      card.atk = Math.max(0, (card.atk || 0) + delta);

      cardBuffed = true;
    }

    if (defBoost !== 0) {
      const currentBuff = card.permanentBuffsBySource[sourceName]?.def || 0;

      const newBuff = cumulative ? currentBuff + defBoost : defBoost;

      if (!card.permanentBuffsBySource[sourceName]) {
        card.permanentBuffsBySource[sourceName] = {};
      }

      card.permanentBuffsBySource[sourceName].def = newBuff;

      // Apply to actual stat (calculate delta and apply, clamp to 0)

      const delta = newBuff - currentBuff;

      card.def = Math.max(0, (card.def || 0) + delta);

      cardBuffed = true;
    }

    if (cardBuffed) {
      anyBuffed = true;
      const weakensStats = atkBoost < 0 || defBoost < 0;
      queueCardFeedback(game, weakensStats ? "debuff" : "buff", card, {
        sourceCard: source,
        tone: weakensStats ? "red" : "green",
      });
    }
  }

  if (anyBuffed) {
    const boosts = [];

    if (atkBoost !== 0)
      boosts.push(`${atkBoost > 0 ? "+" : ""}${atkBoost} ATK`);

    if (defBoost !== 0)
      boosts.push(`${defBoost > 0 ? "+" : ""}${defBoost} DEF`);

    getUI(game)?.log(`${source.name} applied ${boosts.join(" and ")} buff.`);

    game.updateBoard();
  }

  return (
    anyBuffed ||
    fieldWideAura ||
    targetCards.some((card) => card?.cardKind === "monster")
  );
}

/**
 * Generic handler for removing permanent named buffs
 * Removes all buffs associated with a specific source name
 *
 * Action properties:
 * - targetRef: reference to the target card (default: "self")
 * - sourceName: identifier for the buff source to remove (default: source card name)
 * - removeFromAllField: if true, removes buff from all monsters on player's field
 * - archetype: if specified, only remove buffs from monsters of this archetype
 */
export async function handleRemovePermanentBuffNamed(
  action: ActionOf<"remove_permanent_buff_named">,

  ctx: EffectContext,

  targets: ResolvedTargetMap,

  engine: ActionHandlerEnginePort,
) {
  const { player, source } = ctx;

  const game = engine.game;

  if (!source || !game || !player) return false;

  const targetRef = action.targetRef || "self";
  const fieldWideAuraRemoval =
    targetRef === "self" && action.removeFromAllField;

  let targetCards: ActionRuntimeCard[] = [];

  if (fieldWideAuraRemoval) {
    // Remove from all monsters on field matching archetype

    targetCards = (player.field || []).filter((card) => {
      if (!card || card.cardKind !== "monster") return false;

      // Check archetype filter

      if (action.archetype) {
        const cardArchetypes = Array.isArray(card.archetypes)
          ? card.archetypes
          : card.archetype
            ? [card.archetype]
            : [];

        if (!cardArchetypes.includes(action.archetype)) return false;
      }

      return true;
    });
  } else {
    targetCards = resolveTargetCards(action, ctx, targets, {
      targetRef,

      defaultRef: "self",
    });
  }

  if (targetCards.length === 0) return fieldWideAuraRemoval;

  const sourceName = action.sourceName || source.name;

  let anyRemoved = false;

  for (const card of targetCards) {
    if (!card || !card.permanentBuffsBySource) continue;

    const buffData = card.permanentBuffsBySource[sourceName];

    if (!buffData) continue;

    // Remove buffs from stats (clamp to 0)

    if (buffData.atk) {
      card.atk = Math.max(0, (card.atk || 0) - buffData.atk);
    }

    if (buffData.def) {
      card.def = Math.max(0, (card.def || 0) - buffData.def);
    }

    // Remove buff tracking

    delete card.permanentBuffsBySource[sourceName];

    anyRemoved = true;
    queueCardFeedback(game, "debuff", card, {
      sourceCard: source,
      tone: "red",
    });
  }

  if (anyRemoved) {
    getUI(game)?.log(`${sourceName} buffs removed.`);

    game.updateBoard();
  }

  return anyRemoved || fieldWideAuraRemoval;
}

export async function handleModifyLevel(
  action: ActionOf<"modify_level">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const game = engine?.game;
  if (!game) return false;

  const amount = resolveContextNumber(action.amount, ctx, {
    defaultValue: 0,
  });
  if (!Number.isFinite(amount) || amount === 0) {
    return false;
  }

  const targetsToModify = resolveTargetCards(action, ctx, targets, {
    game,
    targetRef: action.targetRef,
    filter: (card) => card?.cardKind === "monster",
  });
  if (targetsToModify.length === 0) {
    getUI(game)?.log("No valid monster to modify Level.");
    return false;
  }

  const duration = action.duration || "until_end_turn";
  const minLevel = Number.isFinite(Number(action.minLevel))
    ? Number(action.minLevel)
    : 1;
  const maxLevel = Number.isFinite(Number(action.maxLevel))
    ? Number(action.maxLevel)
    : null;

  let modified = false;
  for (const card of targetsToModify) {
    const currentLevel = Number(card.level || 0);
    if (!Number.isFinite(currentLevel)) continue;

    let nextLevel = currentLevel + amount;
    nextLevel = Math.max(minLevel, nextLevel);
    if (maxLevel !== null) {
      nextLevel = Math.min(maxLevel, nextLevel);
    }
    if (nextLevel === currentLevel) continue;

    if (duration !== "permanent" && card.originalLevel == null) {
      card.originalLevel = currentLevel;
    }
    card.level = nextLevel;
    modified = true;
    queueCardFeedback(game, amount > 0 ? "buff" : "debuff", card, {
      sourceCard: ctx?.source || null,
      tone: amount > 0 ? "gold" : "blue",
    });
  }

  if (modified) {
    const direction = amount > 0 ? "increased" : "decreased";
    getUI(game)?.log(
      `Level ${direction} by ${Math.abs(amount)} until the end of the turn.`,
    );
    game.effectEngine?.clearTargetingCache?.();
    game.updateBoard?.();
  }
  return modified;
}

export async function handleReduceHandMonsterLevels(
  action: ActionOf<"reduce_hand_monster_levels">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player } = ctx;
  const game = engine.game;
  if (!player || !game) return false;

  const amount = Math.max(1, Number(action.amount ?? 1) || 1);
  const handMonsters = player.hand.filter((c) => c && c.cardKind === "monster");
  if (handMonsters.length === 0) return false;

  let modified = false;
  for (const card of handMonsters) {
    if (card.level! <= 1) continue;
    if (card.originalLevel == null) card.originalLevel = card.level;
    card.level = Math.max(1, card.level! - amount);
    modified = true;
  }

  if (modified) {
    getUI(game)?.log(
      `Nível dos monstros na mão reduzido em ${amount} até o fim do turno.`
    );
    game.effectEngine?.clearTargetingCache?.();
    game.updateBoard();
  }
  return modified;
}
