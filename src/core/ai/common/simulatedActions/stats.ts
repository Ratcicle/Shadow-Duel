import { addEffectNegation, clearEffectNegation, expireEffectNegation, normalizeNegationDuration as normalizeNegateEffectsDuration } from "../../../effects/negation.js";
import { removeTrackedDamageStepBuffs, consumeTrackedDamageStepBuffs } from "../../../game/combat/damageStep.js";
import { isSupportedSimulatedDestructionReplacement } from "./destruction.js";
import { applyMove } from "./movement.js";
import { expireFaceupDeclaredValues, restoreFaceupStatuses, trackFaceupStatus } from "../../../Card.js";
import { applyLevelModification, expireLevelModifications, applyNamedStatChange } from "../../../effects/actions/stats.js";
import { getCardEffectImmunity, isNonTargetingEffectReference } from "../../../effects/targeting/filters.js";
import { getEffectiveAtk } from "../cardStats.js";
import { expireFaceupStatBuffs, removeTrackedStatChange } from "../../../effects/actions/stats.js";
import { hasUnmodeledTemporaryPassiveSuppression, refreshEquipExtraAttackBonus, removeFieldAuraBuffContributions, suppressTemporaryDynamicStatIncreasesForDebuff } from "../../../effects/passives/passiveBuffs.js";
import { getCounterValue, setCounterValue } from "../counters.js";
import { applyGrantVoidFusionImmunity as grantFusionImmunity } from "../../../effects/actions/immunity.js";
import { estimateMonsterValue, hasArchetype } from "../cardValue.js";
import {
  evaluateSimulatedConditions,
  getStoredBlueprints,
} from "../simulatedConditions.js";
import {
  getCardInstanceId,
  getCostPreference,
  getTargetPreference,
  matchesTargetFilters,
  mergeCostPreference,
  normalizeCount,
  rankCandidates,
  selectSimulatedTargets,
} from "../targetSelection.js";
import {
  attachSimulatedEquip,
  findCardOwner,
  getZoneCards,
  moveCardToZone,
  refreshSimulatedFieldPresenceTypeSummonBuffForCard,
  refreshSimulatedFieldAuras,
  removeCardFromZones,
} from "../zones.js";
import {
  applySummonState,
  chooseRankedCards,
  getActionCandidates,
  hasOpenMonsterZone,
  hasRequiredSelections,
  markSimulatedPassiveUsed,
  pickCountForAction,
  resolveActionPlayer,
  resolveSimulatedLpCost,
  resolveTargetsForAction,
  storeSimActionResult,
  STOP_SIMULATION,
} from "./shared.js";
import type { ActionTargetScope, ContextNumberSource } from "../../../contracts/actions.js";
import type {
  AiStateShape,
  SimulatedCardState,
  SimulatedReplacementEffect,
  SimulatedPlayerState,
} from "../../../contracts/aiState.js";
import type { BattlePosition } from "../../../contracts/cards.js";
import type { CardFilter } from "../../../contracts/effects.js";
import type { CanonicalSelectionMap } from "../../../contracts/selection.js";
import type { ZoneInput } from "../../../contracts/zones.js";
import type {
  SimulatedActionHandlerContext,
  SimulatedActionOptions,
  SimulatedRuntimeState,
} from "./shared.js";

type ScopeFilterKey =
  | "cardKind"
  | "archetype"
  | "archetypes"
  | "requireFaceup"
  | "name"
  | "cardName"
  | "cardId"
  | "position";
type ScopeFilterValue = CardFilter[keyof CardFilter] | readonly string[];
type MutableScopeFilters = {
  -readonly [Key in ScopeFilterKey]?: ScopeFilterValue;
};
type LegacyTargetScope = ActionTargetScope & MutableScopeFilters;

type LegacyPositionAction = SimulatedActionHandlerContext<
  "switch_position"
>["action"] & { readonly defBoost?: number };
type LegacyBuffStatsAction = Omit<
  SimulatedActionHandlerContext<"buff_stats_temp">["action"],
  "type"
> & {
  readonly type: string;
  readonly grantSecondAttack?: boolean;
  readonly targetRestriction?: string;
};
type LegacyBuffAtkAction = SimulatedActionHandlerContext<
  "buff_atk_temp"
>["action"] & { readonly atkBoost?: number };
type ReferencedResolvedTargets = SimulatedCardState[] & CanonicalSelectionMap;
type DynamicSimulatedCard = SimulatedCardState & CanonicalSelectionMap;
type LegacyZoneCollections = SimulatedPlayerState & Partial<{
  [Zone in ZoneInput]: SimulatedCardState[];
}>;
type LegacyProtectedCard = SimulatedCardState & {
  _simReplacementProtection?: {
    uniqueKey: string;
    duration: string;
    replacementEffect: object | null;
  };
  hasChangedPosition?: boolean;
};

function asArray<Type>(
  value: Type | readonly Type[] | null | undefined,
): readonly Type[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value as readonly Type[] : [value as Type];
}

function getTargetScopeCards(
  scope: LegacyTargetScope = {},
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
): SimulatedCardState[] {
  if (!scope || typeof scope !== "object") return [];
  const ownerEntries: Array<{
    player: SimulatedPlayerState;
    role: "self" | "opponent";
  }> =
    scope.owner === "opponent"
      ? [{ player: opponent, role: "opponent" }]
      : scope.owner === "any"
        ? [
            { player: self, role: "self" },
            { player: opponent, role: "opponent" },
          ]
        : [{ player: self, role: "self" }];
  const zones = asArray(scope.zones || scope.zone || "field");
  const filters: MutableScopeFilters = {
    ...(scope.filters || {}),
  };

  for (const key of ([
    "cardKind",
    "archetype",
    "archetypes",
    "requireFaceup",
    "name",
    "cardName",
    "cardId",
    "position",
  ] as readonly ScopeFilterKey[])) {
    if (scope[key] !== undefined && filters[key] === undefined) {
      filters[key] = scope[key];
    }
  }

  return ownerEntries.flatMap(({ player, role }) =>
    zones.flatMap((zone) =>
      getZoneCards(player, zone).filter((card) =>
        matchesTargetFilters(card, filters as CardFilter, null, role),
      ),
    ),
  );
}

export function applySwitchPosition(
  ctx: SimulatedActionHandlerContext<"switch_position">,
): boolean {
  const { action, targets, state, options, self, opponent } = ctx;
  const targetCards =
    Array.isArray(targets) && targets.length > 0
      ? targets
      : getTargetScopeCards(action.targetScope as LegacyTargetScope, self, opponent);

  let changed = false;
  targetCards.forEach((card) => {
    if (!card || card.cardKind !== "monster") return;
    const owner = findCardOwner(state, card);
    if (!owner?.field.includes(card)) return;
    if (getCardEffectImmunity({ game: { player: state.player, bot: state.bot, turnCounter: state.turnCounter || 0 } }, card, self,
      { sourceCard: options.sourceCard || null }).immune) return;
    if (card.battlePositionLocked === true) return;
    const wasFacedown = card.isFacedown === true;
    const wasFaceupBeforeChange = !wasFacedown;
    const previousPosition = (card.position || "attack") as BattlePosition;
    const nextPosition: BattlePosition = wasFacedown
      ? "attack"
      : card.position === "attack"
        ? "defense"
        : "attack";

    card.position = nextPosition;
    changed = true;
    if (wasFacedown) {
      card.isFacedown = false;
    }
    if (action.markChanged !== false) {
      (card as LegacyProtectedCard).hasChangedPosition = true;
      card.positionChangedThisTurn = true;
    }
    // Position alone does not create or clear an explicit attack restriction.
    if (Number.isFinite(action.atkBoost)) {
      card.tempAtkBoost =
        (card.tempAtkBoost || 0) + (action.atkBoost as number);
      card.atk = Math.max(0, (card.atk || 0) + (action.atkBoost as number));
    }
    if (Number.isFinite((action as LegacyPositionAction).defBoost)) {
      card.tempDefBoost =
        (card.tempDefBoost || 0) +
        ((action as LegacyPositionAction).defBoost as number);
      card.def =
        Math.max(
          0,
          (card.def || 0) +
            ((action as LegacyPositionAction).defBoost as number),
        );
    }
    refreshSimulatedFieldPresenceTypeSummonBuffForCard(card);
    refreshSimulatedFieldAuras(state);
    options.emitSimulatedEvent?.("position_change", {
      card,
      player: owner,
      fromPosition: previousPosition,
      toPosition: nextPosition,
      wasFlipped: wasFacedown,
      wasFaceupBeforeChange,
      sourceCard: options.sourceCard || null,
      effectId: options.effect?.id || null,
      actionContext: options.actionContext,
    });
  });
  return changed;
}

export function applySetFacedownDefense(
  ctx: SimulatedActionHandlerContext<"set_facedown_defense">,
): void {
  const { action, targets, state, options } = ctx;

  for (const card of targets || []) {
    const owner = findCardOwner(state, card);
    if (
      !card ||
      card.cardKind !== "monster" ||
      card.isFacedown === true ||
      !owner?.field?.includes(card)
    ) {
      continue;
    }
    const previousPosition = card.position || "attack";
    card.position = "defense";
    card.isFacedown = true;
    card.fieldPresenceSummons = [];
    expireFaceupStatBuffs(card);
    if (card.attackLimitDuration === "while_faceup") {
      delete card.attackLimitThisTurn;
      delete card.attackLimitDuration;
    }
    expireLevelModifications(card, "while_faceup");
    expireEffectNegation(card, "while_faceup");
    restoreFaceupStatuses(card);
    expireFaceupDeclaredValues(card);
    (card as LegacyProtectedCard).hasChangedPosition = true;
    card.positionChangedThisTurn = true;
    if (action.lockBattlePosition === true) {
      card.battlePositionLocked = true;
    }
    refreshSimulatedFieldPresenceTypeSummonBuffForCard(card);
    refreshSimulatedFieldAuras(state);
    options.emitSimulatedEvent?.("position_change", {
      card,
      player: owner,
      opponent: owner === state.player ? state.bot : state.player,
      sourceCard: options.sourceCard || null,
      effectId: options.effect?.id || null,
      fromPosition: previousPosition,
      toPosition: "defense",
      wasSetFacedown: true,
      battlePositionLocked: card.battlePositionLocked === true,
      actionContext: options.actionContext,
    });
  }
}

function resolveStatBoostFromContext(
  spec: ContextNumberSource | undefined,
  options: SimulatedActionOptions,
  context: { readonly self: SimulatedPlayerState; readonly opponent: SimulatedPlayerState },
): number {
  if (!spec) return 0;
  const readPath = (root: unknown): unknown => {
    let value = root;
    for (const part of spec.key.split(".").filter(Boolean)) {
      if (!value || typeof value !== "object") return undefined;
      value = Reflect.get(value, part);
    }
    return value;
  };
  const raw = readPath({ ...options, _actionTargets: options.actionResults, source: options.sourceCard, player: context.self, opponent: context.opponent }) ?? readPath(options.actionContext) ??
    readPath(options.activationContext) ?? readPath(options.activationContext?.actionContext);
  let value = Number(raw ?? 0);
  if (!Number.isFinite(value)) value = 0;
  const divisor = Number(spec.divideBy ?? 0);
  if (Number.isFinite(divisor) && divisor !== 0) value /= divisor;
  const multiplier = Number(spec.multiplier ?? 1);
  if (Number.isFinite(multiplier)) value *= multiplier;
  if (spec.round === "floor") return Math.floor(value);
  if (spec.round === "ceil") return Math.ceil(value);
  if (spec.round === "round") return Math.round(value);
  return value;
}

export function applySetOriginalStats(
  ctx: SimulatedActionHandlerContext<"set_original_stats">,
): boolean {
  const { action, options, opponent } = ctx;
  const setAtk = action.atk !== undefined || action.atkFromContext !== undefined || action.baseAtk !== undefined;
  const setDef = action.def !== undefined || action.defFromContext !== undefined || action.baseDef !== undefined;
  if (!setAtk && !setDef) return false;
  const targets = action.targetRef ? ctx.targets
    : resolveTargetsForAction({ targetRef: "self" }, ctx.selections, options, opponent);
  let changed = false;
  for (const card of targets) {
    if (card.cardKind !== "monster") continue;
    card.originalStatsOverride ??= { baseAtk: Number(card.baseAtk || 0), baseDef: Number(card.baseDef || 0) };
    const previousAtk = Number(card.atk || 0), previousDef = Number(card.def || 0);
    const previousBaseAtk = Number(card.baseAtk || 0), previousBaseDef = Number(card.baseDef || 0);
    if (setAtk) {
      const raw = action.atkFromContext !== undefined ? resolveStatBoostFromContext(action.atkFromContext, options, ctx)
        : action.atk ?? action.baseAtk;
      card.baseAtk = Math.max(0, Math.floor(Number(raw) || 0));
      if (action.updateCurrentStats !== false) card.atk = card.baseAtk;
    }
    if (setDef) {
      const raw = action.defFromContext !== undefined ? resolveStatBoostFromContext(action.defFromContext, options, ctx)
        : action.def ?? action.baseDef;
      card.baseDef = Math.max(0, Math.floor(Number(raw) || 0));
      if (action.updateCurrentStats !== false) card.def = card.baseDef;
    }
    changed = true;
    options.emitSimulatedEvent?.("original_stats_changed", {
      card, previousAtk, previousDef, previousBaseAtk, previousBaseDef,
      newAtk: card.atk, newDef: card.def, newBaseAtk: card.baseAtk, newBaseDef: card.baseDef,
      sourceCard: options.sourceCard || null, player: ctx.self,
    });
  }
  return changed;
}

export function applyPermanentBuffNamed(
  ctx: SimulatedActionHandlerContext<"permanent_buff_named">,
): void | typeof STOP_SIMULATION {
  const { action, targets, options, self, opponent } = ctx;
  const source = options.sourceCard;
  if (!source) return STOP_SIMULATION;
  const ref = action.targetRef || "self";
  const fieldWideAura = ref === "self" && action.applyToAllField;
  const recipients = fieldWideAura
    ? self.field.filter(card => card.cardKind === "monster" && !card.isFacedown &&
      (!action.archetype || hasArchetype(card, action.archetype)))
    : action.targetRef ? targets
    : resolveTargetsForAction({ targetRef: "self" }, ctx.selections, options, opponent);
  const definition = options.effect?.targets?.find(target => target.id === ref);
  const sourceName = action.sourceName || source.name || "";
  const cumulative = action.cumulative !== false;
  let anyStatChanged = false;
  for (const card of recipients) {
    if (card.cardKind !== "monster" || (card.owner && card.owner !== self.id)) continue;
    if (action.duration === "while_faceup" &&
      (card.isFacedown || ![self, opponent].some(owner => owner.field.includes(card)))) continue;
    if (definition && !matchesTargetFilters(card, definition, source, self.field.includes(card) ? "self" : "opponent")) continue;
    if (action.archetype && ref === "summonedCard" && !hasArchetype(card, action.archetype)) continue;
    const buffs = card.permanentBuffsBySource ??= {};
    const buff = buffs[sourceName] ??= {};
    const atkBoost = action.atkBoost || 0;
    const defBoost = action.defBoost || 0;
    if (!cumulative && (buff.atk || 0) === atkBoost && (buff.def || 0) === defBoost) continue;
    let buffed = false;
    for (const [stat, boost] of [["atk", atkBoost], ["def", defBoost]] as const) {
      if (!boost) continue;
      const previousBuff = buff[stat] || 0;
      const nextBuff = cumulative ? previousBuff + boost : boost;
      const previous = card[stat] || 0;
      card[stat] = Math.max(0, previous + nextBuff - previousBuff);
      buff[stat] = nextBuff;
      anyStatChanged ||= card[stat] !== previous;
      buffed = true;
    }
    if (buffed && action.duration) buff.duration = action.duration;
  }
  if (action.requireStatChange && !anyStatChanged) return STOP_SIMULATION;
  if (!fieldWideAura && !recipients.some(card => card.cardKind === "monster")) return STOP_SIMULATION;
}

export function applyRemovePermanentBuffNamed(
  ctx: SimulatedActionHandlerContext<"remove_permanent_buff_named">,
): void {
  const { action, targets, options, self, opponent } = ctx;
  const source = options.sourceCard;
  if (!source) return;
  const fieldWide = (action.targetRef || "self") === "self" && action.removeFromAllField;
  const recipients = fieldWide ? self.field.filter(card => card.cardKind === "monster" &&
    (!action.archetype || hasArchetype(card, action.archetype)))
    : action.targetRef ? targets : resolveTargetsForAction({ targetRef: "self" }, ctx.selections, options, opponent);
  const name = action.sourceName || source.name || "";
  for (const card of recipients) {
    const buff = card.permanentBuffsBySource?.[name];
    if (!buff) continue;
    if (buff.atk) removeTrackedStatChange(card, "atk", buff.atk);
    if (buff.def) removeTrackedStatChange(card, "def", buff.def);
    delete card.permanentBuffsBySource?.[name];
  }
}

/** Capture values before sequential departures, then grant the declared reward. */
export function applyBanishAndBuff(
  ctx: SimulatedActionHandlerContext<"banish_and_buff">,
): boolean {
  const { action, targets, state, options, selections, opponent } = ctx;
  if (!targets.length || targets.some(card => !findCardOwner(state, card))) return false;
  const property = action.buffSource || "atk";
  const entries = targets.map(card => ({ card, value: Math.floor(
    (typeof property === "number" ? property : property === "level"
      ? (card.level || 0) * 100 : Number(Reflect.get(card, property) || 0)) * (action.buffMultiplier ?? 1),
  ) }));
  let amount = 0;
  for (const entry of entries) {
    const result = applyMove({ ...ctx, targets: [entry.card], action: {
      type: "move", targetRef: action.targetRef, to: "banished",
      contextLabel: "banish_and_buff", requireAll: true,
    } });
    if (result === STOP_SIMULATION) return false;
    amount += entry.value;
  }
  if (amount === 0) return true;
  const recipients = resolveTargetsForAction({ targetRef: action.buffTarget || "self" }, selections, options, opponent);
  const duration = action.duration || "while_faceup";
  const type = action.buffType || "atk";
  const atk = type === "atk" || type === "both" ? amount : 0;
  const def = type === "def" || type === "both" ? amount : 0;
  for (const card of recipients) {
    if (card.cardKind !== "monster") continue;
    if (duration === "end_of_turn") {
      if (type === "atk" || type === "both") {
        card.atk = (card.atk || 0) + amount;
        card.tempAtkBoost = (card.tempAtkBoost || 0) + amount;
      }
      if (type === "def" || type === "both") {
        card.def = (card.def || 0) + amount;
        card.tempDefBoost = (card.tempDefBoost || 0) + amount;
      }
    } else {
      const source = options.sourceCard;
      const key = `${action.type}_${source?.instanceId ?? source?.id ?? source?.name ?? "source"}${duration === "while_faceup" ? ":while_faceup" : ""}`;
      applyNamedStatChange(card, key, atk, def);
      const buff = card.permanentBuffsBySource?.[key];
      if (duration === "while_faceup" && buff) buff.duration = "while_faceup";
    }
  }
  return true;
}

export function applyBuffStatsTemp(
  ctx: SimulatedActionHandlerContext<"buff_stats_temp" | "buff_stats_temp_with_second_attack">,
): void {
  const { targets, selections, state, options, self, opponent } = ctx;
  const action: SimulatedActionHandlerContext<"buff_stats_temp">["action"] = { ...ctx.action, type: "buff_stats_temp" };
  const duration = action.duration ||
    (ctx.action.type === "buff_stats_temp_with_second_attack" ? "end_of_turn" : "while_faceup");
  const isDamageStepBuff = duration === "damage_calculation" || duration === "end_of_damage_step";
  let atkBoost = (Number.isFinite(action.atkBoost) ? action.atkBoost! : 0) +
    resolveStatBoostFromContext(action.atkBoostFromContext, options, ctx);
  if (action.atkBoostFromTarget) {
    const spec = action.atkBoostFromTarget;
    const stat = ["baseAtk", "baseDef", "atk", "def"].includes(spec?.stat)
      ? spec.stat
      : "atk";
    const targetRef = spec?.targetRef;
    const reference = Array.isArray(selections?.[targetRef])
      ? (selections![targetRef] as SimulatedCardState[])[0]
      : Array.isArray(
            (options?.resolvedTargets as ReferencedResolvedTargets)?.[targetRef],
          )
        ? ((options.resolvedTargets as ReferencedResolvedTargets)[targetRef] as
            SimulatedCardState[])[0]
        : null;
    const value = Number(reference?.[stat]);
    if (!reference || !Number.isFinite(value)) return;
    atkBoost += value;
  }
  const defBoost = (Number.isFinite(action.defBoost) ? action.defBoost! : 0) +
    resolveStatBoostFromContext(action.defBoostFromContext, options, ctx);
  let expiresOnTurn: number | null = null;
  if (!action.permanent && !isDamageStepBuff) {
    if (duration === "end_of_next_turn") expiresOnTurn = state.turnCounter + 1;
    else if (Number.isFinite(action.durationTurns) && action.durationTurns! > 0) {
      expiresOnTurn = state.turnCounter + action.durationTurns!;
    } else if (Number.isFinite(action.expiresOnTurn)) expiresOnTurn = action.expiresOnTurn!;
  }
  const isFaceupBuff = !action.permanent && expiresOnTurn === null && duration === "while_faceup";
  const recipients = action.targetScope
    ? getTargetScopeCards(action.targetScope as LegacyTargetScope, self, opponent)
    : targets;
  const changedCards: SimulatedCardState[] = [];
  const effectType = action.targetScope || !action.targetRef || isNonTargetingEffectReference(options.effect, action.targetRef)
    ? null : "target";
  recipients.forEach((card) => {
    if (card.cardKind !== "monster") return;
    if (getCardEffectImmunity({ game: {
      player: self.id === "player" ? self : opponent,
      bot: self.id === "bot" ? self : opponent,
      turnCounter: state.turnCounter,
    } }, card, self, { sourceCard: options.sourceCard || null, effectType }).immune) return;
    let changed = false;
    const appliedStats = { atk: 0, def: 0 };
    for (const [stat, boost] of [["atk", atkBoost], ["def", defBoost]] as const) {
      if (boost < 0 && !action.permanent && !isFaceupBuff && expiresOnTurn === null && !isDamageStepBuff) {
        const suppressed = suppressTemporaryDynamicStatIncreasesForDebuff(card, stat, boost);
        if (suppressed > 0 && hasUnmodeledTemporaryPassiveSuppression(card)) {
          (state._simUnsupportedActions ??= []).push("buff_stats_temp:passive_recalculation");
        }
      }
      const current = Number(card[stat] || 0);
      const next = Math.max(0, current + boost);
      const applied = next - current;
      if (!applied) continue;
      changed = true;
      appliedStats[stat] = applied;
      if (expiresOnTurn !== null) {
        card.turnBasedBuffs ??= [];
        const id = [action.sourceName || options.sourceCard?.name || action.type,
          card.instanceId || card.id || "card", stat, state.turnCounter, card.turnBasedBuffs.length].join("_");
        card.turnBasedBuffs.push({ id, stat, value: applied, expiresOnTurn });
      } else if (action.permanent || isFaceupBuff) {
        const baseName = action.sourceName || `${action.type}_${options.sourceCard?.instanceId ?? options.sourceCard?.id ?? "source"}`;
        const name = isFaceupBuff ? `${baseName}:while_faceup` : baseName;
        applyNamedStatChange(card, name, stat === "atk" ? applied : 0, stat === "def" ? applied : 0);
        const buff = card.permanentBuffsBySource?.[name];
        if (isFaceupBuff && buff) buff.duration = "while_faceup";
      } else {
        const temporaryStat = stat === "atk" ? "tempAtkBoost" : "tempDefBoost";
        card[temporaryStat] = (card[temporaryStat] || 0) + applied;
      }
      card[stat] = next;
    }
    if (changed) changedCards.push(card);
    if (changed && (duration === "damage_calculation" || duration === "end_of_damage_step")) {
      const key = duration === "damage_calculation" ? "damageCalculationTempBuffs" : "endOfDamageStepTempBuffs";
      (state[key] ??= []).push({ card, ...appliedStats });
    }
    if (
      ctx.action.type === "buff_stats_temp_with_second_attack" ||
      (action as LegacyBuffStatsAction).grantSecondAttack === true ||
      (action as LegacyBuffStatsAction).type === "grant_second_attack" ||
      (action as LegacyBuffStatsAction).type ===
        "buff_stats_temp_with_second_attack"
    ) {
      card.canMakeSecondAttackThisTurn = true;
      card.secondAttackUsedThisTurn = false;
      if ((action as LegacyBuffStatsAction).targetRestriction === "monster") {
        card.extraAttackTargetRestriction = "monster";
      }
    }
  });
  if (action.storeAs && selections) selections[action.storeAs] = changedCards;
  return;
}

/** The caller preserves calculated battle numbers before retiring these deltas. */
export function clearSimulatedDamageCalculationBuffs(state: Pick<AiStateShape, "damageCalculationTempBuffs">): void {
  removeTrackedDamageStepBuffs(state.damageCalculationTempBuffs || []);
}

export function clearSimulatedEndOfDamageStepBuffs(state: Pick<AiStateShape, "endOfDamageStepTempBuffs">): void {
  removeTrackedDamageStepBuffs(state.endOfDamageStepTempBuffs || []);
}

/** Match the runtime hand-level action and its existing end-turn cleanup. */
export function applyReduceHandMonsterLevels(
  ctx: SimulatedActionHandlerContext<"reduce_hand_monster_levels">,
): void {
  const amount = Math.max(1, Number(ctx.action.amount ?? 1) || 1);
  for (const card of ctx.self.hand) {
    const current = card.level ?? 0;
    if (card.cardKind !== "monster" || current <= 1) continue;
    if (card.originalLevel == null) card.originalLevel = current;
    card.level = Math.max(1, current - amount);
  }
}

export function applyModifyLevel(
  ctx: SimulatedActionHandlerContext<"modify_level">,
): void {
  const { action, targets } = ctx;
  const amount = action.amount;
  if (!Number.isFinite(amount) || amount === 0) return;
  const minimum = Number.isFinite(Number(action.minLevel)) ? Number(action.minLevel) : 1;
  const maximum = Number.isFinite(Number(action.maxLevel)) ? Number(action.maxLevel) : null;
  for (const card of targets) {
    if (card.cardKind !== "monster") continue;
    const current = Number(card.level || 0);
    if (!Number.isFinite(current)) continue;
    let next = Math.max(minimum, current + amount);
    if (maximum !== null) next = Math.min(maximum, next);
    if (next === current) continue;
    applyLevelModification(card, next, action.duration || "while_faceup");
  }
}

export function applyBuffAtkTemp(
  ctx: SimulatedActionHandlerContext<"buff_atk_temp">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  targets.forEach((card) => {
    if (!card) return;
    const amount = Number.isFinite(action.amount)
      ? action.amount as number
      : Number.isFinite((action as LegacyBuffAtkAction).atkBoost)
        ? (action as LegacyBuffAtkAction).atkBoost as number
        : 0;
    if (amount !== 0) {
      card.tempAtkBoost = (card.tempAtkBoost || 0) + amount;
      card.atk = Math.max(0, (card.atk || 0) + amount);
    }
  });
  return;
}

export function applySetAttackLimitFromZoneCount(
  ctx: SimulatedActionHandlerContext<"set_attack_limit_from_zone_count">,
): void {
  const { action, targets, self, opponent } = ctx;
  const owners =
    action.owner === "opponent"
      ? [opponent]
      : action.owner === "both" || action.owner === "any"
        ? [self, opponent]
        : [self];
  const zones = asArray(action.zone || "graveyard");
  const filters = action.filters || {};
  let count = 0;

  for (const owner of owners.filter(Boolean)) {
    for (const zone of zones) {
      const cards = zone === "fieldSpell"
        ? owner.fieldSpell
          ? [owner.fieldSpell]
          : []
        : Array.isArray((owner as LegacyZoneCollections)[zone])
          ? (owner as LegacyZoneCollections)[zone] as SimulatedCardState[]
          : [];
      count += cards.filter((card) =>
        matchesTargetFilters(card, filters, null),
      ).length;
    }
  }

  const minAttacks = Number.isFinite(Number(action.minAttacks))
    ? Math.max(0, Math.floor(Number(action.minAttacks)))
    : 0;
  const attackLimit = Math.max(minAttacks, count);

  targets.forEach((card) => {
    if (!card || card.cardKind !== "monster") return;
    card.attackLimitThisTurn = attackLimit;
    card.attackLimitDuration = action.duration || "while_faceup";
  });
}

export function applyRemoveStatIncreases(
  ctx: SimulatedActionHandlerContext<"remove_stat_increases">,
): void {
  const { action, targets, state } = ctx;
  const stats = Array.isArray(action.stats) && action.stats.length > 0
    ? action.stats
    : ["atk", "def"];

  targets.forEach((card) => {
    if (!card) return;
    if (stats.includes("atk")) {
      const baseAtk = Number.isFinite(Number(card.baseAtk))
        ? Number(card.baseAtk)
        : Number(card.atk || 0);
      const currentAtk = Number(card.atk || 0);
      if (currentAtk > baseAtk) {
        const reduction = currentAtk - baseAtk;
        card.atk = baseAtk;
        if (Number(card.tempAtkBoost || 0) > 0) {
          const consumed = Math.min(Number(card.tempAtkBoost || 0), reduction);
          consumeTrackedDamageStepBuffs([state.damageCalculationTempBuffs, state.endOfDamageStepTempBuffs], card, "atk", consumed);
          card.tempAtkBoost = Math.max(
            0,
            Number(card.tempAtkBoost || 0) - reduction,
          );
        }
      }
    }
    if (stats.includes("def")) {
      const baseDef = Number.isFinite(Number(card.baseDef))
        ? Number(card.baseDef)
        : Number(card.def || 0);
      const currentDef = Number(card.def || 0);
      if (currentDef > baseDef) {
        const reduction = currentDef - baseDef;
        card.def = baseDef;
        if (Number(card.tempDefBoost || 0) > 0) {
          const consumed = Math.min(Number(card.tempDefBoost || 0), reduction);
          consumeTrackedDamageStepBuffs([state.damageCalculationTempBuffs, state.endOfDamageStepTempBuffs], card, "def", consumed);
          card.tempDefBoost = Math.max(
            0,
            Number(card.tempDefBoost || 0) - reduction,
          );
        }
      }
    }
  });
  return;
}

export function applyHalveTargetStatsAndGainRemoved(
  ctx: SimulatedActionHandlerContext<"halve_target_stats_and_gain_removed">,
): void {
  const { action, targets, options, state, self, opponent } = ctx;
  const gainTargets = action.gainTargetRef === "self" && options?.sourceCard
    ? [options.sourceCard]
    : [];
  const gainCard = gainTargets[0] || options?.sourceCard || null;
  const canGain = gainCard && !gainCard.isFacedown &&
    [self, opponent].some(owner => owner.field.includes(gainCard)) &&
    !getCardEffectImmunity({ game: {
      player: self.id === "player" ? self : opponent,
      bot: self.id === "bot" ? self : opponent,
      turnCounter: state.turnCounter,
    } }, gainCard, self, { sourceCard: options.sourceCard || null }).immune;
  const stats = Array.isArray(action.stats) && action.stats.length > 0
    ? action.stats
    : ["atk", "def"];

  const name = action.sourceName || `${action.type}_${options.sourceCard?.instanceId ?? options.sourceCard?.id ?? "source"}`;
  for (const card of targets) {
    if (!card || !gainCard || card.cardKind !== "monster" || card.isFacedown) continue;
    if (getCardEffectImmunity({ game: {
      player: self.id === "player" ? self : opponent,
      bot: self.id === "bot" ? self : opponent,
      turnCounter: state.turnCounter,
    } }, card, self, { sourceCard: options.sourceCard || null }).immune) continue;
    const atk = stats.includes("atk") ? Math.floor(Number(card.atk || 0) / 2) : 0;
    const def = stats.includes("def") ? Math.floor(Number(card.def || 0) / 2) : 0;
    const applied = applyNamedStatChange(card, name, -atk, -def);
    if (canGain && (applied.atk < 0 || applied.def < 0)) applyNamedStatChange(gainCard, name, -applied.atk, -applied.def);
  }
  return;
}

export function applyForbidAttackNextTurn(
  ctx: SimulatedActionHandlerContext<"forbid_attack_next_turn">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  const turns = Number.isFinite(action.turns) ? action.turns as number : 1;
  targets.forEach((card) => {
    if (!card) return;
    card.cannotAttackThisTurn = true;
    card.cannotAttackUntilTurn = Math.max(
      card.cannotAttackUntilTurn || 0,
      (state.turnCounter || 0) + turns,
    );
    card._simCannotAttackByEffect = true;
  });
  return;
}

export function applyForbidAttackThisTurn(
  ctx: SimulatedActionHandlerContext<"forbid_attack_this_turn">,
): void {
  const cards =
    Array.isArray(ctx.targets) && ctx.targets.length > 0
      ? ctx.targets
      : [ctx.options?.sourceCard].filter(Boolean) as SimulatedCardState[];
  for (const card of cards) {
    card.cannotAttackThisTurn = true;
    card._simCannotAttackByEffect = true;
  }
}

export function applyGrantVoidFusionImmunity(
  ctx: SimulatedActionHandlerContext<"grant_void_fusion_immunity">,
): boolean {
  return grantFusionImmunity.call({ game: ctx.state, ui: null }, ctx.action, {
    player: ctx.self,
    summonedCard: ctx.options.actionContext?.summonedCard ?? null,
  });
}

export function applyGrantProtection(
  ctx: SimulatedActionHandlerContext<"grant_protection">,
): void {
  const { action, targets, state, options, self, opponent } = ctx;
  const protectionType = action.protectionType || "effect_destruction";
  if (protectionType !== "battle_destruction" && protectionType !== "effect_destruction") {
    state._simUnsupportedActions ??= [];
    state._simUnsupportedActions.push(action.type);
    return;
  }
  const recipients = action.targetScope
    ? getTargetScopeCards(action.targetScope as LegacyTargetScope, self, opponent) : targets;
  const duration = action.duration || "while_faceup";
  const currentTurn = Number(state.turnCounter || 0);
  const expiresOnTurn = duration === "end_of_next_turn" ? currentTurn + 1 :
    duration === "end_of_turn" ? currentTurn :
      Number.isFinite(Number(duration)) ? Number(duration) : null;
  for (const card of recipients) {
    card.protectionEffects ??= [];
    card.protectionEffects.push({
      type: protectionType, source: options.sourceCard?.name || "Unknown", duration,
      grantedOnTurn: currentTurn, expiresOnTurn,
      sourceOwner: action.sourceOwner === "self" || action.sourceOwner === "opponent" ? action.sourceOwner : "any",
      removeOnLeave: action.removeOnLeave !== false,
    });
  }
}

export function applyRegisterReplacementEffect(
  ctx: SimulatedActionHandlerContext<"register_replacement_effect">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  state._simReplacementEffects ??= [];
  const uniqueKey = action.uniqueKey;
  if (uniqueKey) state._simReplacementEffects = state._simReplacementEffects.filter(entry =>
    entry.uniqueKey !== uniqueKey || entry.sourcePlayerId !== self.id);
  state._simReplacementEffects.push({
    ...(uniqueKey ? { uniqueKey } : {}), sourcePlayerId: self.id, sourceCard: options.sourceCard || null,
    duration: action.duration || null,
    expiresOnTurn: action.duration === "end_of_turn" ? (state.turnCounter || 0) :
      action.duration === "end_of_next_turn" ? (state.turnCounter || 0) + 1 : null,
    usesRemaining: action.uses ?? null,
    targetPresences: targets.map(card => ({ instanceId: getCardInstanceId(card), locationVersion: card.locationVersion || 0, fieldPresenceId: card.fieldPresenceId || null })),
    replacementEffect: action.replacementEffect || null,
  });
  return;
}

export function applyModifyStatsTemp(
  ctx: SimulatedActionHandlerContext<"modify_stats_temp">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  let requiresPassiveRecalculation = false;
  targets.forEach((card) => {
    if (!card) return;
    if (Number.isFinite(action.atkFactor)) {
      const previousAtk = card.atk || 0;
      const newAtk = Math.floor(previousAtk * (action.atkFactor as number));
      if (suppressTemporaryDynamicStatIncreasesForDebuff(card, "atk", newAtk - previousAtk) > 0) {
        requiresPassiveRecalculation ||= hasUnmodeledTemporaryPassiveSuppression(card);
      }
      const deltaAtk = newAtk - (card.atk || 0);
      card.atk = newAtk;
      card.tempAtkBoost =
        (card.tempAtkBoost || 0) + deltaAtk;
    }
    if (Number.isFinite(action.defFactor)) {
      const previousDef = card.def || 0;
      const newDef = Math.floor(previousDef * (action.defFactor as number));
      if (suppressTemporaryDynamicStatIncreasesForDebuff(card, "def", newDef - previousDef) > 0) {
        requiresPassiveRecalculation ||= hasUnmodeledTemporaryPassiveSuppression(card);
      }
      const deltaDef = newDef - (card.def || 0);
      card.def = newDef;
      card.tempDefBoost =
        (card.tempDefBoost || 0) + deltaDef;
    }
    requiresPassiveRecalculation ||= hasUnmodeledTemporaryPassiveSuppression(card);
  });
  // Unknown origin cannot promise correct restoration after moves or End Phase.
  if (requiresPassiveRecalculation) {
    (state._simUnsupportedActions ??= []).push("modify_stats_temp:passive_recalculation");
  }
  return;
}

export function applyModifyStatsTempThenDestroyIfZeroed(
  ctx: SimulatedActionHandlerContext<"modify_stats_temp_then_destroy_if_zeroed">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  targets.forEach((card) => {
    if (!card) return;
    const previousAtk = card.atk || 0;
    const previousDef = card.def || 0;
    if (Number.isFinite(action.atkChange)) {
      const newAtk = Math.max(0, previousAtk + (action.atkChange as number));
      card.atk = newAtk;
      card.tempAtkBoost = (card.tempAtkBoost || 0) + newAtk - previousAtk;
    }
    if (Number.isFinite(action.defChange)) {
      const newDef = Math.max(0, previousDef + (action.defChange as number));
      card.def = newDef;
      card.tempDefBoost = (card.tempDefBoost || 0) + newDef - previousDef;
    }
    const atkZeroed =
      action.destroyIfAtkZeroedByThisEffect === true &&
      previousAtk > 0 &&
      (card.atk || 0) === 0;
    const defZeroed =
      action.destroyIfDefZeroedByThisEffect === true &&
      previousDef > 0 &&
      (card.def || 0) === 0;
    if (atkZeroed || defZeroed) {
      const owner = findCardOwner(state, card);
      if (owner) moveCardToZone(owner, card, "graveyard");
    }
  });
  return;
}

export function applySetStatsToZeroAndNegate(
  ctx: SimulatedActionHandlerContext<"set_stats_to_zero_and_negate">,
): void {
  const { action, targets } = ctx;
  const setAtkToZero = action.setAtkToZero !== false;
  const setDefToZero = action.setDefToZero !== false;
  targets.forEach((card) => {
    if (!card || card.cardKind !== "monster") return;
    if (!card.isFacedown && (setAtkToZero || setDefToZero)) {
      applyModifyStatsTemp({
        ...ctx,
        action: {
          type: "modify_stats_temp",
          targetRef: action.targetRef,
          atkFactor: setAtkToZero ? 0 : 1,
          defFactor: setDefToZero ? 0 : 1,
        },
        targets: [card],
      });
    }
    if (action.negateEffects !== false) {
      addEffectNegation(card, normalizeNegateEffectsDuration(action), ctx.options.sourceCard, ctx.options.effect);
      refreshSimulatedFieldPresenceTypeSummonBuffForCard(card);
    }
  });
  return;
}

export function applyAddStatus(
  ctx: SimulatedActionHandlerContext<"add_status">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  const changedCards: SimulatedCardState[] = [];
  storeSimActionResult(action, selections, options, changedCards);
  const recipients = action.targetScope
    ? getTargetScopeCards(action.targetScope as LegacyTargetScope, self, opponent)
    : action.targetRef ? targets : options.sourceCard ? [options.sourceCard] : [];
  const payingCosts = options.payingActivationCosts ?? options.effect?.activationCosts?.includes(action) === true;
  const costReference = payingCosts && options.effect?.targets?.some(definition =>
    definition.id === action.targetRef && definition.intent === "cost") === true;
  const effectType = action.targetScope || !action.targetRef || isNonTargetingEffectReference(options.effect, action.targetRef)
    ? null : "target";
  const targetCards = costReference ? recipients : recipients.filter(card => !getCardEffectImmunity({ game: {
    player: self.id === "player" ? self : opponent,
    bot: self.id === "bot" ? self : opponent,
    turnCounter: state.turnCounter,
  } }, card, self, { sourceCard: options.sourceCard || null, effectType }).immune);
  const immunityPolicy = action as typeof action & { readonly immunityMode?: "skip_targets" | "skip_action" };
  if (immunityPolicy.immunityMode === "skip_action" && targetCards.length !== recipients.length) return;

  targetCards.forEach((card) => {
    if (!card) return;
    const status = action.status;
    if (status) {
      const previousValue = status === "effectsNegated"
        ? card.effectsNegated === true : Reflect.get(card, status);
      if (!action.untilEndOfTurn && action.duration !== "until_end_turn" && status !== "effectsNegated" && action.remove !== true) {
        trackFaceupStatus(card, status);
        if (status === "piercing") trackFaceupStatus(card, "piercingGrantedByEffect");
      }
      if ((action.untilEndOfTurn || action.duration === "until_end_turn") && status !== "effectsNegated" && action.remove !== true) {
        card.tempStatuses ??= {};
        if (!Object.prototype.hasOwnProperty.call(card.tempStatuses, status)) {
          Reflect.set(card.tempStatuses, status, Reflect.get(card, status));
        }
        if (status === "piercing" && !Object.hasOwn(card.tempStatuses, "piercingGrantedByEffect")) {
          card.tempStatuses.piercingGrantedByEffect = card.piercingGrantedByEffect;
        }
      }
      if (action.remove === true) {
        if (card.faceupStatuses) Reflect.deleteProperty(card.faceupStatuses, status);
        delete (card as DynamicSimulatedCard)[status];
        if (status === "effectsNegated") {
          clearEffectNegation(card);
        }
        if (card.tempStatuses) Reflect.deleteProperty(card.tempStatuses, status);
        if (status === "piercing") {
          delete card.piercingGrantedByEffect;
          if (card.faceupStatuses) delete card.faceupStatuses.piercingGrantedByEffect;
          if (card.tempStatuses) delete card.tempStatuses.piercingGrantedByEffect;
        }
      } else {
        if (status === "effectsNegated") {
          if (action.value === undefined || action.value === true) addEffectNegation(card, normalizeNegateEffectsDuration(action), options.sourceCard, options.effect);
          else clearEffectNegation(card);
        } else (card as DynamicSimulatedCard)[status] = action.value ?? true;
        if (status === "piercing") card.piercingGrantedByEffect = (action.value ?? true) === true;
      }
      if (status === "effectsNegated") {
        refreshSimulatedFieldPresenceTypeSummonBuffForCard(card);
        if (card.cardKind === "spell" && card.subtype === "equip" && card.equippedTo) {
          refreshEquipExtraAttackBonus(card, card.equippedTo, card.effectsNegated !== true);
        }
        const field = [...state.player.field, ...state.bot.field];
        if (card.effectsNegated === true) removeFieldAuraBuffContributions(card, field, field.indexOf(card));
        card.effects?.forEach((effect) => {
          if (effect.timing !== "passive") return;
          if ("replacementEffect" in effect && isSupportedSimulatedDestructionReplacement(effect.replacementEffect)) return;
          const passiveType = "passive" in effect ? effect.passive?.type : undefined;
          // These stat families are reconciled by their declared producers.
          if (passiveType === "field_presence_type_summon_count_buff" || passiveType === "activated_card_count_buff" ||
              passiveType === "archetype_count_buff" || passiveType === "graveyard_card_count_buff" || passiveType === "graveyard_archetype_count_buff" || passiveType === "graveyard_type_count_buff" ||
              passiveType === "equipped_field_counter_buff" || passiveType === "equipped_counter_buff" || passiveType === "field_counter_stat_aura") return;
          // These rules read negation directly at attack/movement time.
          if (passiveType === "restrict_opponent_summon_turn_attack" || passiveType === "counter_attack_lock" || passiveType === "send_to_grave_replacement" ||
              passiveType === "conditional_protection" || passiveType === "field_archetype_aura_buff" || passiveType === "event_actions") return;
          state._simUnsupportedActions ??= [];
          state._simUnsupportedActions.push(`add_status:passive_recalculation:${passiveType || "unknown"}`);
        });
      }
      const nextValue = status === "effectsNegated"
        ? card.effectsNegated === true : Reflect.get(card, status);
      const changed = status === "effectsNegated"
        ? previousValue !== true && nextValue === true : !Object.is(previousValue, nextValue);
      if (changed && !changedCards.includes(card)) changedCards.push(card);
    }
  });
  storeSimActionResult(action, selections, options, changedCards);
  return;
}
