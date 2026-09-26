import { appendSimulatedFieldCard } from "../zones.js";
import { restoreFieldExitStatuses } from "../../../Card.js";
import { getAvailableFieldSlots } from "../../../game/zones/placement.js";
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
  findCardZone,
  getZoneCards,
  moveCardToZone,
  removeCardFromZones,
  appendSimulatedZoneCard,
} from "../zones.js";
import type { ActionTargetScope } from "../../../contracts/actions.js";
import type {
  SimulatedCardState,
  SimulatedPlayerState,
} from "../../../contracts/aiState.js";
import type { CardFilter } from "../../../contracts/effects.js";
import type { SimulatedActionHandlerContext, SimulatedRuntimeState, SimulatedActionOptions } from "./shared.js";

type ScopeFilterKey =
  | "cardKind"
  | "cardName"
  | "name"
  | "cardId"
  | "cardIds"
  | "subtype"
  | "monsterType"
  | "type"
  | "archetype"
  | "archetypes"
  | "requireFaceup"
  | "minLevel"
  | "maxLevel"
  | "level"
  | "levelOp"
  | "minAtk"
  | "maxAtk"
  | "minDef"
  | "maxDef"
  | "position"
  | "isToken"
  | "isTuner";

type ScopeFilterValue =
  | CardFilter[keyof CardFilter]
  | readonly number[]
  | readonly string[];
type MutableScopeFilters = {
  -readonly [Key in ScopeFilterKey]?: ScopeFilterValue;
};
type LegacyActionTargetScope = ActionTargetScope & MutableScopeFilters;

function getOriginalOwner(
  state: SimulatedRuntimeState,
  card: SimulatedCardState,
  fallback: SimulatedPlayerState,
): SimulatedPlayerState {
  const originalOwnerId = card?.originalOwner || null;
  if (state?.player?.id === originalOwnerId) return state.player;
  if (state?.bot?.id === originalOwnerId) return state.bot;
  return fallback || null;
}

function setSimulatedController(
  card: SimulatedCardState,
  player: SimulatedPlayerState,
): void {
  if (!card || !player) return;
  card.owner = player.id;
  card.controller = player.id;
}

function clearSimulatedTemporaryControl(
  state: SimulatedRuntimeState,
  card: SimulatedCardState,
): void {
  if (!Array.isArray(state?.temporaryControlEffects) || !card) return;
  const instanceId = card.instanceId ?? card._instanceId ?? card.uuid ?? card.id ?? null;
  state.temporaryControlEffects = state.temporaryControlEffects.filter(
    (entry) => entry?.cardInstanceId !== instanceId,
  );
}
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
  storeSimActionResult,
  updateSimulatedSentToGraveMaterialMarker,
} from "./shared.js";

export function applyBanish(
  ctx: SimulatedActionHandlerContext<"banish">,
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
    const owner = findCardOwner(state, card);
    if (!owner) return;
    const fromZone = findCardZone(owner, card);
    const destination =
      fromZone === "field" ? getOriginalOwner(state, card, owner) : owner;
    if (fromZone === "field") clearSimulatedTemporaryControl(state, card);
    if (moveCardToZone(destination, card, "banished", owner)) {
      setSimulatedController(card, destination);
    }
  });
  return;
}

export function applyReturnToHand(
  ctx: SimulatedActionHandlerContext<"return_to_hand">,
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
    const owner = findCardOwner(state, card);
    if (!owner) return;
    const fromZone = findCardZone(owner, card) || action.fromZone || "field";
    const wasFaceupBeforeMove = card.isFacedown !== true;
    const destination =
      fromZone === "field" ? getOriginalOwner(state, card, owner) : owner;
    if (fromZone === "field") clearSimulatedTemporaryControl(state, card);
    if (moveCardToZone(destination, card, "hand", owner)) {
      setSimulatedController(card, destination);
      options.emitSimulatedEvent?.("card_moved", {
        card,
        player: destination,
        fromPlayer: owner,
        toPlayer: destination,
        fromZone,
        toZone: "hand",
        movedByEffect: true,
        wasFaceupBeforeMove,
        sourceCard: options.sourceCard || null,
        effectId: options.effect?.id || null,
        actionContext: options.actionContext,
      });
    }
  });
  return;
}

export function applyMove(
  ctx: SimulatedActionHandlerContext<"move">,
): void | typeof STOP_SIMULATION {
  const {
    action,
    targets,
    selections,
    state,
    options,
    self,
    opponent,
    source,
  } = ctx;
  const resolveScopeOwners = (
    scope: LegacyActionTargetScope = {},
  ): SimulatedPlayerState[] => {
    const ownerRule = scope.owner || scope.player || "self";
    if (ownerRule === "opponent") return opponent ? [opponent] : [];
    if (ownerRule === "any" || ownerRule === "both" || ownerRule === "either") {
      return [self, opponent].filter(Boolean);
    }
    return self ? [self] : [];
  };
  const resolveScopedTargets = (
    scope: LegacyActionTargetScope = {},
  ): SimulatedCardState[] => {
    const zones = Array.isArray(scope.zones)
      ? scope.zones
      : scope.zone
        ? [scope.zone]
        : ["field"];
    const filters: MutableScopeFilters = { ...(scope.filters || {}) };
    ([
      "cardKind",
      "cardName",
      "name",
      "cardId",
      "cardIds",
      "subtype",
      "monsterType",
      "type",
      "archetype",
      "archetypes",
      "requireFaceup",
      "minLevel",
      "maxLevel",
      "level",
      "levelOp",
      "minAtk",
      "maxAtk",
      "minDef",
      "maxDef",
      "position",
      "isToken",
      "isTuner",
    ] as readonly ScopeFilterKey[]).forEach((key) => {
      if (scope[key] !== undefined && filters[key] === undefined) {
        filters[key] = scope[key];
      }
    });
    const cards: SimulatedCardState[] = [];
    const seen = new Set<string | number | SimulatedCardState>();
    resolveScopeOwners(scope).forEach((owner) => {
      zones.forEach((zone) => {
        getZoneCards(owner, zone).forEach((card) => {
          const key = getCardInstanceId(card) ?? card;
          if (!card || seen.has(key)) return;
          if (scope.excludeSelf === true && source && card === source) return;
          if (!matchesTargetFilters(card, filters as CardFilter)) return;
          seen.add(key);
          cards.push(card);
        });
      });
    });
    return cards;
  };
  const targetCards =
    Array.isArray(targets) && targets.length > 0
      ? targets
      : action.targetScope
        ? resolveScopedTargets(action.targetScope as LegacyActionTargetScope)
        : [];
  if (targetCards.length === 0) {
    return action.allowEmpty === true ? undefined : STOP_SIMULATION;
  }
  let moved = false;
  const movedCards: SimulatedCardState[] = [];
  targetCards.forEach((card) => {
    const owner = findCardOwner(state, card);
    if (!owner) return;
    const to = action.to || "graveyard";
    let destPlayer =
      action.player === "opponent"
        ? opponent
        : action.player === "self"
          ? self
          : owner;
    if (to === "field" && (destPlayer?.field || []).length >= 5) {
      return;
    }
    const fromZone = findCardZone(owner, card) || action.fromZone || null;
    if (fromZone === "field" && to !== "field") {
      destPlayer = getOriginalOwner(state, card, owner);
      clearSimulatedTemporaryControl(state, card);
    }
    const wasFaceupBeforeMove = card.isFacedown !== true;
    if (fromZone === "field" && to !== "field") {
      card.battlePositionLocked = false;
    }
    if (moveCardToZone(destPlayer || owner, card, to, owner)) {
      setSimulatedController(card, destPlayer || owner);
      if (to === "graveyard") {
        updateSimulatedSentToGraveMaterialMarker({
          card,
          state,
          player: destPlayer || owner,
          fromZone,
          contextLabel: action.contextLabel || null,
        });
      }
      if (action.resetAttackFlags) {
        card.hasAttacked = false;
        card.cannotAttackThisTurn = false;
        card.attacksUsedThisTurn = 0;
        card.canMakeSecondAttackThisTurn = false;
        card.secondAttackUsedThisTurn = false;
      }
      options.emitSimulatedEvent?.("card_moved", {
        card,
        player: destPlayer || owner,
        fromPlayer: owner,
        toPlayer: destPlayer || owner,
        fromZone,
        toZone: to,
        movedByEffect: true,
        wasFaceupBeforeMove,
        sourceCard: options.sourceCard || null,
        effectId: options.effect?.id || null,
        actionContext: options.actionContext,
      });
      movedCards.push(card);
      moved = true;
    }
  });
  if (!moved && action.allowEmpty !== true) return STOP_SIMULATION;
  if (moved) {
    storeSimActionResult(action, selections, options, movedCards);
  }
  return;
}

export function applyTakeControl(
  ctx: SimulatedActionHandlerContext<"take_control">,
): void {
  const { action, targets, state, self, opponent, options } = ctx;
  const destination = action.player === "opponent" ? opponent : self;
  if (!destination || !Array.isArray(targets)) return;

  for (const card of targets) {
    const previousController = findCardOwner(state, card);
    if (
      !card ||
      card.cardKind !== "monster" ||
      !previousController?.field?.includes(card) ||
      previousController === destination ||
      (destination.field || []).length >= 5
    ) {
      continue;
    }

    const index = previousController.field.indexOf(card);
    previousController.field.splice(index, 1);
    clearSimulatedTemporaryControl(state, card);
    appendSimulatedFieldCard(destination.field, card, true);
    if (!card.originalOwner) card.originalOwner = previousController.id;
    setSimulatedController(card, destination);

    if (action.duration === "until_end_phase") {
      if (!Array.isArray(state.temporaryControlEffects)) {
        state.temporaryControlEffects = [];
      }
      const nextId = Number(state._simTemporaryControlCounter || 0) + 1;
      state._simTemporaryControlCounter = nextId;
      state.temporaryControlEffects.push({
        id: `sim_temporary_control_${nextId}`,
        cardDuelCardId: card.duelCardId ?? null,
        sourceDuelCardId: options.sourceCard?.duelCardId ?? null,
        cardInstanceId:
          card.instanceId ?? card._instanceId ?? card.uuid ?? card.id ?? null,
        fieldPresenceId: card.fieldPresenceId ?? null,
        holderId: destination.id,
        previousControllerId: previousController.id,
        expiresOnTurn: Number(state.turnCounter || 0),
        sourceInstanceId:
          options?.sourceCard?.instanceId ??
          options?.sourceCard?._instanceId ??
          options?.sourceCard?.uuid ??
          null,
        createdOnTurn: Number(state.turnCounter || 0),
      });
    }

    options.emitSimulatedEvent?.("control_changed", {
      card,
      fromPlayer: previousController,
      toPlayer: destination,
      previousControllerId: previousController.id,
      controllerId: destination.id,
      originalOwnerId: card.originalOwner || null,
      sourceCard: options.sourceCard || null,
      effectId: options.effect?.id || null,
    });
  }
}

/**
 * The sole simulated consequence of an expired, still-valid control record.
 * Rule destruction bypasses effect/battle protection; ordinary failed control
 * changes and temporary banishment never enter this path.
 */
export function resolveSimulatedTemporaryControlEffects(
  state: SimulatedRuntimeState,
  options: Pick<SimulatedActionOptions, "emitSimulatedEvent"> = {},
): void {
  const expiring = (state.temporaryControlEffects || []).filter(
    entry => entry.expiresOnTurn === state.turnCounter,
  );
  const players = [state.player, state.bot];
  for (const entry of expiring) {
    // Event callbacks from an earlier return can replace a later registration.
    if (!state.temporaryControlEffects?.includes(entry)) continue;
    const holder = players.find(player => player.id === entry.holderId);
    const destination = players.find(player => player.id === entry.previousControllerId);
    const card = holder?.field.find(candidate => entry.cardDuelCardId != null
      ? candidate.duelCardId === entry.cardDuelCardId
      : (candidate.instanceId ?? candidate._instanceId ?? candidate.uuid ?? candidate.id ?? null) === entry.cardInstanceId);
    state.temporaryControlEffects = state.temporaryControlEffects.filter(record => record !== entry);
    if (!card || !holder || !destination ||
        (card.fieldPresenceId ?? null) !== entry.fieldPresenceId ||
        (card.controller != null && card.controller !== holder.id)) continue;

    if (getAvailableFieldSlots(destination.field).length > 0) {
      holder.field.splice(holder.field.indexOf(card), 1);
      clearSimulatedTemporaryControl(state, card);
      appendSimulatedFieldCard(destination.field, card, true);
      setSimulatedController(card, destination);
      options.emitSimulatedEvent?.("control_changed", {
        card, fromPlayer: holder, toPlayer: destination,
        previousControllerId: holder.id, controllerId: destination.id,
        originalOwnerId: card.originalOwner || null,
        reason: "temporary_control_expired",
      });
      continue;
    }

    const originalOwner = getOriginalOwner(state, card, holder);
    const attached = new Set([
      ...(card.equips || []),
      ...players.flatMap(player => player.spellTrap || []).filter(equip =>
        equip.equippedTo === card || equip.equipTarget === card),
    ]);
    const wasFaceupBeforeMove = card.isFacedown !== true;
    const destinationZone = card.isToken ? "void" : card.banishWhenLeavesField ? "banished" : "graveyard";
    removeCardFromZones(holder, card);
    clearSimulatedTemporaryControl(state, card);
    card.battlePositionLocked = false;
    restoreFieldExitStatuses(card);
    if (card.isTrapMonster && card.trapMonsterOriginalState) {
      Object.assign(card, card.trapMonsterOriginalState);
      card.isTrapMonster = false;
      delete card.trapMonsterOriginalState;
    }
    card.equips = [];
    card.location = destinationZone === "void" ? null : destinationZone;
    setSimulatedController(card, originalOwner);
    if (destinationZone !== "void") {
      appendSimulatedZoneCard(originalOwner[destinationZone], card);
    }
    const payload = {
      card, player: originalOwner, fromPlayer: holder, toPlayer: originalOwner,
      fromZone: "field", toZone: destinationZone, wasDestroyed: true,
      destroyCause: "rule", destroySource: null, sourceCard: null,
      movedByEffect: false, wasFaceupBeforeMove,
      contextLabel: "temporary_control_return_no_space",
    };
    if (destinationZone === "graveyard") options.emitSimulatedEvent?.("card_to_grave", payload);
    options.emitSimulatedEvent?.("card_moved", payload);
    for (const equip of attached) {
      const equipHolder = findCardOwner(state, equip);
      if (!equipHolder) continue;
      const equipOwner = getOriginalOwner(state, equip, equipHolder);
      const equipFromZone = findCardZone(equipHolder, equip);
      removeCardFromZones(equipHolder, equip);
      const equipZone = equip.banishWhenLeavesField ? "banished" : "graveyard";
      appendSimulatedZoneCard(equipOwner[equipZone], equip);
      setSimulatedController(equip, equipOwner);
      equip.location = equipZone;
      const equipPayload = { ...payload, card: equip, player: equipOwner,
        fromPlayer: equipHolder, toPlayer: equipOwner, fromZone: equipFromZone,
        toZone: equipZone, contextLabel: "equip_target_left_field" };
      if (equipZone === "graveyard") options.emitSimulatedEvent?.("card_to_grave", equipPayload);
      options.emitSimulatedEvent?.("card_moved", equipPayload);
    }
  }
}
