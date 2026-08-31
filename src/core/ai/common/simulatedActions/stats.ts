import { getEffectiveAtk } from "../cardStats.js";
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
import type { ActionTargetScope } from "../../../contracts/actions.js";
import type {
  SimulatedCardState,
  SimulatedPlayerState,
} from "../../../contracts/aiState.js";
import type { BattlePosition } from "../../../contracts/cards.js";
import type { CardFilter } from "../../../contracts/effects.js";
import type { CanonicalSelectionValue } from "../../../contracts/selection.js";
import type { ZoneInput } from "../../../contracts/zones.js";
import type { SimulatedActionHandlerContext } from "./shared.js";

function normalizeNegateEffectsDuration(action: object): "while_faceup" | "until_end_turn" {
  return Reflect.get(action, "negateEffectsDuration") === "while_faceup" ||
    Reflect.get(action, "duration") === "while_faceup"
    ? "while_faceup"
    : "until_end_turn";
}

function asZoneArray(
  value: ZoneInput | readonly ZoneInput[] | null | undefined,
): ZoneInput[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return [...value];
  return typeof value === "string" ? [value] : [];
}

function readFiniteNumber(source: object, key: string): number | null {
  const value = Reflect.get(source, key);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isSimulatedCard(value: unknown): value is SimulatedCardState {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstSimulatedCard(
  value: CanonicalSelectionValue,
): SimulatedCardState | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (!isSimulatedCard(first)) return null;
  if ("card" in first && isSimulatedCard(first.card)) return first.card;
  return first;
}

function getTargetScopeCards(
  scope: ActionTargetScope | undefined,
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
): SimulatedCardState[] {
  if (!scope) return [];
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
  const zones = asZoneArray(scope.zones || scope.zone || "field");
  const filters: CardFilter = {
    ...(scope.filters || {}),
  };

  for (const key of [
    "cardKind",
    "archetype",
    "archetypes",
    "requireFaceup",
    "name",
    "cardName",
    "cardId",
    "position",
  ]) {
    const scopeValue = Reflect.get(scope, key);
    if (scopeValue !== undefined && Reflect.get(filters, key) === undefined) {
      Reflect.set(filters, key, scopeValue);
    }
  }

  return ownerEntries.flatMap(({ player, role }) =>
    zones.flatMap((zone) =>
      getZoneCards(player, zone).filter((card) =>
        matchesTargetFilters(card, filters, null, role),
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
      : getTargetScopeCards(action.targetScope, self, opponent);

  targetCards.forEach((card) => {
    if (!card || card.cardKind !== "monster") return;
    if (card.battlePositionLocked === true) return;
    const wasFacedown = card.isFacedown === true;
    const wasFaceupBeforeChange = !wasFacedown;
    const previousPosition: BattlePosition = card.position === "defense"
      ? "defense"
      : "attack";
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
      Reflect.set(card, "hasChangedPosition", true);
      card.positionChangedThisTurn = true;
    }
    // Position alone does not create or clear an explicit attack restriction.
    if (Number.isFinite(action.atkBoost)) {
      const atkBoost = action.atkBoost ?? 0;
      card.tempAtkBoost = (card.tempAtkBoost || 0) + atkBoost;
      card.atk = Math.max(0, (card.atk || 0) + atkBoost);
    }
    const defBoost = readFiniteNumber(action, "defBoost");
    if (defBoost !== null) {
      card.tempDefBoost = (card.tempDefBoost || 0) + defBoost;
      card.def = Math.max(0, (card.def || 0) + defBoost);
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
    if (
      card.effectsNegated === true &&
      card.effectsNegatedDuration === "while_faceup"
    ) {
      card.effectsNegated = false;
      card.effectsNegatedDuration = null;
    }
    Reflect.set(card, "hasChangedPosition", true);
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

export function applyBuffStatsTemp(
  ctx: SimulatedActionHandlerContext<"buff_stats_temp">,
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
  let atkBoost =
    typeof action.atkBoost === "number" && Number.isFinite(action.atkBoost)
      ? action.atkBoost
      : 0;
  if (action.atkBoostFromTarget) {
    const spec = action.atkBoostFromTarget;
    const stat = ["baseAtk", "baseDef", "atk", "def"].includes(spec?.stat)
      ? spec.stat
      : "atk";
    const targetRef = spec?.targetRef;
    const selected = targetRef ? selections[targetRef] : undefined;
    const reference = firstSimulatedCard(selected);
    const value = Number(reference ? Reflect.get(reference, stat) : undefined);
    if (!reference || !Number.isFinite(value)) return;
    atkBoost += value;
  }
  targets.forEach((card) => {
    if (!card) return;
    if (atkBoost !== 0) {
      card.tempAtkBoost = (card.tempAtkBoost || 0) + atkBoost;
      card.atk = Math.max(0, (card.atk || 0) + atkBoost);
    }
    if (Number.isFinite(action.defBoost)) {
      const defBoost = action.defBoost ?? 0;
      card.tempDefBoost = (card.tempDefBoost || 0) + defBoost;
      card.def = Math.max(0, (card.def || 0) + defBoost);
    }
    if (
      Reflect.get(action, "grantSecondAttack") === true ||
      String(action.type) === "grant_second_attack" ||
      String(action.type) === "buff_stats_temp_with_second_attack"
    ) {
      card.canMakeSecondAttackThisTurn = true;
      card.secondAttackUsedThisTurn = false;
      if (Reflect.get(action, "targetRestriction") === "monster") {
        card.extraAttackTargetRestriction = "monster";
      }
    }
  });
  return;
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
    const legacyAtkBoost = readFiniteNumber(action, "atkBoost");
    const amount = Number.isFinite(action.amount)
      ? action.amount
      : legacyAtkBoost ?? 0;
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
  const zones = asZoneArray(action.zone || "graveyard");
  const filters = action.filters || {};
  let count = 0;

  for (const owner of owners.filter(Boolean)) {
    for (const zone of zones) {
      const cards = getZoneCards(owner, zone);
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
  const { action, targets, options } = ctx;
  const gainTargets = action.gainTargetRef === "self" && options?.sourceCard
    ? [options.sourceCard]
    : [];
  const gainCard = gainTargets[0] || options?.sourceCard || null;
  const stats = Array.isArray(action.stats) && action.stats.length > 0
    ? action.stats
    : ["atk", "def"];

  targets.forEach((card) => {
    if (!card || !gainCard) return;
    if (stats.includes("atk")) {
      const reduction = Math.floor(Number(card.atk || 0) / 2);
      if (reduction > 0) {
        card.atk = Math.max(0, Number(card.atk || 0) - reduction);
        card.tempAtkBoost = Number(card.tempAtkBoost || 0) - reduction;
        gainCard.atk = Math.max(0, Number(gainCard.atk || 0) + reduction);
        gainCard.tempAtkBoost = Number(gainCard.tempAtkBoost || 0) + reduction;
      }
    }
    if (stats.includes("def")) {
      const reduction = Math.floor(Number(card.def || 0) / 2);
      if (reduction > 0) {
        card.def = Math.max(0, Number(card.def || 0) - reduction);
        card.tempDefBoost = Number(card.tempDefBoost || 0) - reduction;
        gainCard.def = Math.max(0, Number(gainCard.def || 0) + reduction);
        gainCard.tempDefBoost = Number(gainCard.tempDefBoost || 0) + reduction;
      }
    }
  });
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
  const turns =
    typeof action.turns === "number" && Number.isFinite(action.turns)
      ? action.turns
      : 1;
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
      : ctx.options.sourceCard
        ? [ctx.options.sourceCard]
        : [];
  for (const card of cards) {
    card.cannotAttackThisTurn = true;
    card._simCannotAttackByEffect = true;
  }
}

export function applyGrantProtection(
  ctx: SimulatedActionHandlerContext<"grant_protection">,
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
    const protectionType = action.protectionType || "generic";
    const sourceOwner = action.sourceOwner || "any";
    const protection = {
      type: protectionType,
      duration: action.duration || "temporary",
      sourceOwner,
      removeOnLeave: action.removeOnLeave !== false,
      sourceName: options?.sourceCard?.name || null,
    };
    const existingProtections = Reflect.get(card, "_simProtectionEffects");
    const protectionEffects: object[] = Array.isArray(existingProtections)
      ? existingProtections.filter(
          (entry): entry is object =>
            typeof entry === "object" && entry !== null,
        )
      : [];
    protectionEffects.push(protection);
    Reflect.set(card, "_simProtectionEffects", protectionEffects);
    if (action.protectionType === "effect_destruction") {
      if (sourceOwner === "opponent") {
        Reflect.set(card, "cannotBeDestroyedByOpponentCardEffects", true);
        card._simEffectDestructionProtectedFromOpponent = true;
      } else if (sourceOwner === "self") {
        Reflect.set(card, "cannotBeDestroyedByOwnCardEffects", true);
        card._simEffectDestructionProtectedFromSelf = true;
      } else {
        Reflect.set(card, "cannotBeDestroyedByCardEffects", true);
        card._simEffectDestructionProtected = true;
      }
    } else {
      Reflect.set(card, "_simProtection", protection);
    }
  });
  return;
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
  const existingEffects = Reflect.get(state, "_simReplacementEffects");
  const replacementEffects: object[] = Array.isArray(existingEffects)
    ? existingEffects.filter(
        (entry): entry is object =>
          typeof entry === "object" && entry !== null,
      )
    : [];
  const targetIds = targets.map(getCardInstanceId).filter((id) => id !== null);
  const uniqueKey =
    action.uniqueKey ||
    `${options.sourceCard?.name || "source"}:${action.replacementEffect?.type || "replacement"}`;
  const retainedEffects = replacementEffects.filter(
    (entry) =>
      Reflect.get(entry, "uniqueKey") !== uniqueKey ||
      Reflect.get(entry, "playerId") !== self.id,
  );
  retainedEffects.push({
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
  Reflect.set(state, "_simReplacementEffects", retainedEffects);
  targets.forEach((card) => {
    if (!card) return;
    Reflect.set(card, "_simReplacementProtection", {
      uniqueKey,
      duration: action.duration || "temporary",
      replacementEffect: action.replacementEffect || null,
    });
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
  targets.forEach((card) => {
    if (!card) return;
    if (Number.isFinite(action.atkFactor)) {
      const atkFactor = action.atkFactor ?? 1;
      const previousAtk = card.atk || 0;
      const newAtk = Math.floor(previousAtk * atkFactor);
      card.atk = newAtk;
      card.tempAtkBoost =
        (card.tempAtkBoost || 0) + newAtk - previousAtk;
    }
    if (Number.isFinite(action.defFactor)) {
      const defFactor = action.defFactor ?? 1;
      const previousDef = card.def || 0;
      const newDef = Math.floor(previousDef * defFactor);
      card.def = newDef;
      card.tempDefBoost =
        (card.tempDefBoost || 0) + newDef - previousDef;
    }
  });
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
      const newAtk = Math.max(0, previousAtk + (action.atkChange ?? 0));
      card.atk = newAtk;
      card.tempAtkBoost = (card.tempAtkBoost || 0) + newAtk - previousAtk;
    }
    if (Number.isFinite(action.defChange)) {
      const newDef = Math.max(0, previousDef + (action.defChange ?? 0));
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
    if (action.setAtkToZero) {
      card.atk = 0;
      card.tempAtkBoost = 0;
    }
    if (action.setDefToZero) {
      card.def = 0;
      card.tempDefBoost = 0;
    }
    if (action.negateEffects) {
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
      : getTargetScopeCards(action.targetScope, self, opponent);

  targetCards.forEach((card) => {
    if (!card) return;
    const status = action.status;
    if (status) {
      if (action.remove === true) {
        Reflect.deleteProperty(card, status);
        if (status === "effectsNegated") {
          card.effectsNegatedDuration = null;
        }
      } else {
        Reflect.set(card, status, action.value ?? true);
        if (status === "effectsNegated") {
          card.effectsNegatedDuration = normalizeNegateEffectsDuration(action);
        }
      }
    }
  });
  return;
}
