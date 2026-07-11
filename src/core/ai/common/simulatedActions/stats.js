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

function normalizeNegateEffectsDuration(action = {}) {
  return action.negateEffectsDuration === "while_faceup"
    ? "while_faceup"
    : "until_end_turn";
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function getTargetScopeCards(scope = {}, self, opponent) {
  if (!scope || typeof scope !== "object") return [];
  const ownerEntries =
    scope.owner === "opponent"
      ? [{ player: opponent, role: "opponent" }]
      : scope.owner === "any"
        ? [
            { player: self, role: "self" },
            { player: opponent, role: "opponent" },
          ]
        : [{ player: self, role: "self" }];
  const zones = asArray(scope.zones || scope.zone || "field");
  const filters = {
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
    if (scope[key] !== undefined && filters[key] === undefined) {
      filters[key] = scope[key];
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

export function applySwitchPosition(ctx) {
  const { action, targets, state, options, self, opponent } = ctx;
  const targetCards =
    Array.isArray(targets) && targets.length > 0
      ? targets
      : getTargetScopeCards(action.targetScope, self, opponent);

  targetCards.forEach((card) => {
    if (!card || card.cardKind !== "monster") return;
    const wasFacedown = card.isFacedown === true;
    const wasFaceupBeforeChange = !wasFacedown;
    const previousPosition = card.position || "attack";
    const nextPosition = wasFacedown
      ? "attack"
      : card.position === "attack"
        ? "defense"
        : "attack";

    card.position = nextPosition;
    if (wasFacedown) {
      card.isFacedown = false;
    }
    if (action.markChanged !== false) {
      card.hasChangedPosition = true;
      card.positionChangedThisTurn = true;
    }
    if (nextPosition === "defense") {
      card.cannotAttackThisTurn = true;
    }
    if (Number.isFinite(action.atkBoost)) {
      card.tempAtkBoost = (card.tempAtkBoost || 0) + action.atkBoost;
      card.atk = Math.max(0, (card.atk || 0) + action.atkBoost);
    }
    if (Number.isFinite(action.defBoost)) {
      card.tempDefBoost = (card.tempDefBoost || 0) + action.defBoost;
      card.def = Math.max(0, (card.def || 0) + action.defBoost);
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

export function applyBuffStatsTemp(ctx) {
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
    if (Number.isFinite(action.atkBoost)) {
      card.tempAtkBoost = (card.tempAtkBoost || 0) + action.atkBoost;
      card.atk = Math.max(0, (card.atk || 0) + action.atkBoost);
    }
    if (Number.isFinite(action.defBoost)) {
      card.tempDefBoost = (card.tempDefBoost || 0) + action.defBoost;
      card.def = Math.max(0, (card.def || 0) + action.defBoost);
    }
    if (
      action.grantSecondAttack === true ||
      action.type === "grant_second_attack" ||
      action.type === "buff_stats_temp_with_second_attack"
    ) {
      card.canMakeSecondAttackThisTurn = true;
      card.secondAttackUsedThisTurn = false;
      if (action.targetRestriction === "monster") {
        card.extraAttackTargetRestriction = "monster";
      }
    }
  });
  return;
}

export function applyBuffAtkTemp(ctx) {
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
      ? action.amount
      : Number.isFinite(action.atkBoost)
        ? action.atkBoost
        : 0;
    if (amount !== 0) {
      card.tempAtkBoost = (card.tempAtkBoost || 0) + amount;
      card.atk = Math.max(0, (card.atk || 0) + amount);
    }
  });
  return;
}

export function applySetAttackLimitFromZoneCount(ctx) {
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
      const cards =
        zone === "fieldSpell"
          ? owner.fieldSpell
            ? [owner.fieldSpell]
            : []
          : Array.isArray(owner[zone])
            ? owner[zone]
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

export function applyRemoveStatIncreases(ctx) {
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

export function applyHalveTargetStatsAndGainRemoved(ctx) {
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

export function applyForbidAttackNextTurn(ctx) {
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
  const turns = Number.isFinite(action.turns) ? action.turns : 1;
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

export function applyGrantProtection(ctx) {
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
    if (!Array.isArray(card._simProtectionEffects)) {
      card._simProtectionEffects = [];
    }
    card._simProtectionEffects.push(protection);
    if (action.protectionType === "effect_destruction") {
      if (sourceOwner === "opponent") {
        card.cannotBeDestroyedByOpponentCardEffects = true;
        card._simEffectDestructionProtectedFromOpponent = true;
      } else if (sourceOwner === "self") {
        card.cannotBeDestroyedByOwnCardEffects = true;
        card._simEffectDestructionProtectedFromSelf = true;
      } else {
        card.cannotBeDestroyedByCardEffects = true;
        card._simEffectDestructionProtected = true;
      }
    } else {
      card._simProtection = protection;
    }
  });
  return;
}

export function applyRegisterReplacementEffect(ctx) {
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
  if (!Array.isArray(state._simReplacementEffects)) {
    state._simReplacementEffects = [];
  }
  const targetIds = targets.map(getCardInstanceId).filter((id) => id !== null);
  const uniqueKey =
    action.uniqueKey ||
    `${options.sourceCard?.name || "source"}:${action.replacementEffect?.type || "replacement"}`;
  state._simReplacementEffects = state._simReplacementEffects.filter(
    (entry) => entry.uniqueKey !== uniqueKey || entry.playerId !== self.id,
  );
  state._simReplacementEffects.push({
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
    card._simReplacementProtection = {
      uniqueKey,
      duration: action.duration || "temporary",
      replacementEffect: action.replacementEffect || null,
    };
  });
  return;
}

export function applyModifyStatsTemp(ctx) {
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
      const previousAtk = card.atk || 0;
      const newAtk = Math.floor(previousAtk * action.atkFactor);
      card.atk = newAtk;
      card.tempAtkBoost =
        (card.tempAtkBoost || 0) + newAtk - previousAtk;
    }
    if (Number.isFinite(action.defFactor)) {
      const previousDef = card.def || 0;
      const newDef = Math.floor(previousDef * action.defFactor);
      card.def = newDef;
      card.tempDefBoost =
        (card.tempDefBoost || 0) + newDef - previousDef;
    }
  });
  return;
}

export function applyModifyStatsTempThenDestroyIfZeroed(ctx) {
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
      const newAtk = Math.max(0, previousAtk + action.atkChange);
      card.atk = newAtk;
      card.tempAtkBoost = (card.tempAtkBoost || 0) + newAtk - previousAtk;
    }
    if (Number.isFinite(action.defChange)) {
      const newDef = Math.max(0, previousDef + action.defChange);
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

export function applySetStatsToZeroAndNegate(ctx) {
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

export function applyAddStatus(ctx) {
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
      card[status] = action.value ?? true;
    }
  });
  return;
}
