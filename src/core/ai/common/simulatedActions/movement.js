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
    moveCardToZone(owner, card, "banished");
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
    if (moveCardToZone(owner, card, "hand")) {
      options.emitSimulatedEvent?.("card_moved", {
        card,
        player: owner,
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
  targetCards.forEach((card) => {
    const owner = findCardOwner(state, card);
    if (!owner) return;
    const to = action.to || "graveyard";
    const destPlayer =
      action.player === "opponent"
        ? opponent
        : action.player === "self"
          ? self
          : owner;
    if (to === "field" && (destPlayer?.field || []).length >= 5) {
      return;
    }
    const fromZone = findCardZone(owner, card) || action.fromZone || null;
    const wasFaceupBeforeMove = card.isFacedown !== true;
    if (moveCardToZone(destPlayer || owner, card, to)) {
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
      moved = true;
    }
  });
  if (!moved && action.allowEmpty !== true) return STOP_SIMULATION;
  return;
}
