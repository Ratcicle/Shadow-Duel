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
} from "../zones.js";

function getOriginalOwner(state, card, fallback) {
  const originalOwnerId = card?.originalOwner || null;
  if (state?.player?.id === originalOwnerId) return state.player;
  if (state?.bot?.id === originalOwnerId) return state.bot;
  return fallback || null;
}

function setSimulatedController(card, player) {
  if (!card || !player) return;
  card.owner = player.id;
  card.controller = player.id;
}

function clearSimulatedTemporaryControl(state, card) {
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

export function applyBanish(ctx) {
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
    if (moveCardToZone(destination, card, "banished")) {
      setSimulatedController(card, destination);
    }
  });
  return;
}

export function applyReturnToHand(ctx) {
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
    if (moveCardToZone(destination, card, "hand")) {
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

export function applyMove(ctx) {
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
  const resolveScopeOwners = (scope = {}) => {
    const ownerRule = scope.owner || scope.player || "self";
    if (ownerRule === "opponent") return opponent ? [opponent] : [];
    if (ownerRule === "any" || ownerRule === "both" || ownerRule === "either") {
      return [self, opponent].filter(Boolean);
    }
    return self ? [self] : [];
  };
  const resolveScopedTargets = (scope = {}) => {
    const zones = Array.isArray(scope.zones)
      ? scope.zones
      : scope.zone
        ? [scope.zone]
        : ["field"];
    const filters = { ...(scope.filters || {}) };
    [
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
    ].forEach((key) => {
      if (scope[key] !== undefined && filters[key] === undefined) {
        filters[key] = scope[key];
      }
    });
    const cards = [];
    const seen = new Set();
    resolveScopeOwners(scope).forEach((owner) => {
      zones.forEach((zone) => {
        getZoneCards(owner, zone).forEach((card) => {
          const key = getCardInstanceId(card) ?? card;
          if (!card || seen.has(key)) return;
          if (scope.excludeSelf === true && source && card === source) return;
          if (!matchesTargetFilters(card, filters)) return;
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
        ? resolveScopedTargets(action.targetScope)
        : [];
  if (targetCards.length === 0) {
    return action.allowEmpty === true ? undefined : STOP_SIMULATION;
  }
  let moved = false;
  const movedCards = [];
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
    if (moveCardToZone(destPlayer || owner, card, to)) {
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

export function applyTakeControl(ctx) {
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
    destination.field.push(card);
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
        cardInstanceId:
          card.instanceId ?? card._instanceId ?? card.uuid ?? card.id ?? null,
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
