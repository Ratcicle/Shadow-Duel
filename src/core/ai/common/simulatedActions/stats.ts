import { applyNamedStatChange } from "../../../effects/actions/stats.js";
import { getCardEffectImmunity } from "../../../effects/targeting/filters.js";
import { getEffectiveAtk } from "../cardStats.js";
import { expireFaceupStatBuffs } from "../../../effects/actions/stats.js";
import { refreshEquipExtraAttackBonus, removeFieldAuraBuffContributions, suppressTemporaryDynamicStatIncreasesForDebuff } from "../../../effects/passives/passiveBuffs.js";
import { getCounterValue, setCounterValue } from "../counters.js";
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
  STOP_SIMULATION,
} from "./shared.js";
import type { ActionTargetScope, ContextNumberSource } from "../../../contracts/actions.js";
import type {
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

interface NegateDurationShape {
  readonly negateEffectsDuration?: string;
  readonly duration?: string;
}

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
interface LegacyReplacementEffect extends SimulatedReplacementEffect {
  _sim: boolean;
  uniqueKey: string;
  playerId: string;
  sourceName: string | null;
  duration: string;
  targetRef: string | null;
  targetInstanceIds: Array<string | number | null>;
  uses: number | null;
  usesPerTarget: boolean | null;
  replacementEffect: object | null;
}
type LegacyReplacementState = {
  _simReplacementEffects?: LegacyReplacementEffect[];
} & SimulatedRuntimeState;

function normalizeNegateEffectsDuration(
  action: NegateDurationShape = {},
): "while_faceup" | "until_end_turn" {
  return action.negateEffectsDuration === "while_faceup" ||
    action.duration === "while_faceup"
    ? "while_faceup"
    : "until_end_turn";
}

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
): void {
  const { action, targets, state, options, self, opponent } = ctx;
  const targetCards =
    Array.isArray(targets) && targets.length > 0
      ? targets
      : getTargetScopeCards(action.targetScope as LegacyTargetScope, self, opponent);

  targetCards.forEach((card) => {
    if (!card || card.cardKind !== "monster") return;
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
    const owner = findCardOwner(state, card);
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
    if (
      card.effectsNegated === true &&
      card.effectsNegatedDuration === "while_faceup"
    ) {
      card.effectsNegated = false;
      card.effectsNegatedDuration = null;
    }
    (card as LegacyProtectedCard).hasChangedPosition = true;
    card.positionChangedThisTurn = true;
    if (action.lockBattlePosition === true) {
      card.battlePositionLocked = true;
    }
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
  const raw = readPath(options) ?? readPath(options.actionContext) ??
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

export function applyBuffStatsTemp(
  ctx: SimulatedActionHandlerContext<"buff_stats_temp" | "buff_stats_temp_with_second_attack">,
): void {
  const { targets, selections, state, options, self, opponent } = ctx;
  const action: SimulatedActionHandlerContext<"buff_stats_temp">["action"] = { ...ctx.action, type: "buff_stats_temp" };
  const duration = action.duration || "end_of_turn";
  if (duration === "damage_calculation" || duration === "end_of_damage_step") {
    state._simUnsupportedActions ??= [];
    state._simUnsupportedActions.push(action.type);
    return;
  }
  let atkBoost = (Number.isFinite(action.atkBoost) ? action.atkBoost! : 0) +
    resolveStatBoostFromContext(action.atkBoostFromContext, options);
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
    resolveStatBoostFromContext(action.defBoostFromContext, options);
  let expiresOnTurn: number | null = null;
  if (!action.permanent) {
    if (duration === "end_of_next_turn") expiresOnTurn = state.turnCounter + 1;
    else if (Number.isFinite(action.durationTurns) && action.durationTurns! > 0) {
      expiresOnTurn = state.turnCounter + action.durationTurns!;
    } else if (Number.isFinite(action.expiresOnTurn)) expiresOnTurn = action.expiresOnTurn!;
  }
  const recipients = action.targetScope
    ? getTargetScopeCards(action.targetScope as LegacyTargetScope, self, opponent)
    : targets;
  const changedCards: SimulatedCardState[] = [];
  recipients.forEach((card) => {
    if (card.cardKind !== "monster") return;
    if (getCardEffectImmunity({ game: {
      player: self.id === "player" ? self : opponent,
      bot: self.id === "bot" ? self : opponent,
      turnCounter: state.turnCounter,
    } }, card, self, { sourceCard: options.sourceCard || null }).immune) return;
    let changed = false;
    for (const [stat, boost] of [["atk", atkBoost], ["def", defBoost]] as const) {
      const current = Number(card[stat] || 0);
      const next = Math.max(0, current + boost);
      const applied = next - current;
      if (!applied) continue;
      changed = true;
      if (expiresOnTurn !== null) {
        card.turnBasedBuffs ??= [];
        const id = [action.sourceName || options.sourceCard?.name || action.type,
          card.instanceId || card.id || "card", stat, state.turnCounter, card.turnBasedBuffs.length].join("_");
        card.turnBasedBuffs.push({ id, stat, value: applied, expiresOnTurn });
      } else if (action.permanent) {
        const name = action.sourceName || `${action.type}_${options.sourceCard?.instanceId ?? options.sourceCard?.id ?? "source"}`;
        applyNamedStatChange(card, name, stat === "atk" ? applied : 0, stat === "def" ? applied : 0);
      } else {
        const temporaryStat = stat === "atk" ? "tempAtkBoost" : "tempDefBoost";
        card[temporaryStat] = (card[temporaryStat] || 0) + applied;
      }
      card[stat] = next;
    }
    if (changed) changedCards.push(card);
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
    if (action.duration !== "permanent" && card.originalLevel == null) card.originalLevel = current;
    card.level = next;
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
    card.attackLimitDuration = action.duration || "until_end_turn";
  });
}

export function applyRemoveStatIncreases(
  ctx: SimulatedActionHandlerContext<"remove_stat_increases">,
): void {
  const { action, targets } = ctx;
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
  if (!Array.isArray((state as LegacyReplacementState)._simReplacementEffects)) {
    (state as LegacyReplacementState)._simReplacementEffects = [];
  }
  const targetIds = targets.map(getCardInstanceId).filter((id) => id !== null);
  const uniqueKey =
    action.uniqueKey ||
    `${options.sourceCard?.name || "source"}:${action.replacementEffect?.type || "replacement"}`;
  (state as LegacyReplacementState)._simReplacementEffects =
    (state as LegacyReplacementState)._simReplacementEffects!.filter(
    (entry) =>
      entry.uniqueKey !== uniqueKey || entry.playerId !== self.id,
  );
  (state as LegacyReplacementState)._simReplacementEffects!.push({
    _sim: true,
    uniqueKey,
    playerId: self.id,
    sourceName: action.sourceName || options.sourceCard?.name || null,
    duration: action.duration || "temporary",
    targetRef: action.targetRef || null,
    targetInstanceIds: targetIds,
    uses: action.uses || null,
    usesPerTarget: action.usesPerTarget || null,
    replacementEffect: action.replacementEffect || null,
  });
  targets.forEach((card) => {
    if (!card) return;
    (card as LegacyProtectedCard)._simReplacementProtection = {
      uniqueKey,
      duration: action.duration || "temporary",
      replacementEffect: action.replacementEffect || null,
    };
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
        requiresPassiveRecalculation = true;
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
        requiresPassiveRecalculation = true;
      }
      const deltaDef = newDef - (card.def || 0);
      card.def = newDef;
      card.tempDefBoost =
        (card.tempDefBoost || 0) + deltaDef;
    }
  });
  // Immediate stats are known, but restoring suppressed auras after a move or
  // at turn end needs the runtime's passive refresh. Reject this search branch.
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
      card.effectsNegated = true;
      card.effectsNegatedDuration = normalizeNegateEffectsDuration(action);
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
  const targetCards =
    Array.isArray(targets) && targets.length > 0
      ? targets
      : getTargetScopeCards(action.targetScope as LegacyTargetScope, self, opponent);

  targetCards.forEach((card) => {
    if (!card) return;
    const status = action.status;
    if (status) {
      if (action.remove === true) {
        delete (card as DynamicSimulatedCard)[status];
        if (status === "effectsNegated") {
          card.effectsNegatedDuration = null;
        }
      } else {
        (card as DynamicSimulatedCard)[status] = action.value ?? true;
        if (status === "effectsNegated") {
          card.effectsNegatedDuration = normalizeNegateEffectsDuration(action);
        }
      }
      if (status === "effectsNegated") {
        if (card.cardKind === "spell" && card.subtype === "equip" && card.equippedTo) {
          refreshEquipExtraAttackBonus(card, card.equippedTo, card.effectsNegated !== true);
        }
        const field = [...state.player.field, ...state.bot.field];
        if (card.effectsNegated === true) removeFieldAuraBuffContributions(card, field, field.indexOf(card));
        card.effects?.forEach((effect) => {
          if (effect.timing !== "passive") return;
          const passiveType = "passive" in effect ? effect.passive?.type : undefined;
          // These rules read negation directly at attack/movement time.
          if (passiveType === "restrict_opponent_summon_turn_attack" || passiveType === "send_to_grave_replacement") return;
          if (card.effectsNegated !== true || passiveType !== "field_archetype_aura_buff") {
            state._simUnsupportedActions ??= [];
            state._simUnsupportedActions.push(`add_status:passive_recalculation:${passiveType || "unknown"}`);
            return;
          }
        });
      }
    }
  });
  return;
}
