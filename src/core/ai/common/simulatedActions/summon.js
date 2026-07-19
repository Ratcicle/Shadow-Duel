import { getEffectiveAtk } from "../cardStats.js";
import {
  canUseAsSynchroMaterial,
  getSynchroMaterialCombos,
} from "../../../game/summon/synchro.js";
import {
  checkSpecialSummonEligibility,
  establishProperSummon,
} from "../../../game/summon/eligibility.js";
import { getCounterValue, setCounterValue } from "../counters.js";
import { estimateMonsterValue, hasArchetype } from "../cardValue.js";
import {
  evaluateSimulatedConditions,
  getStoredBlueprints,
} from "../simulatedConditions.js";
import {
  buildActionFilter,
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
  storeSimActionResult,
  updateSimulatedSentToGraveMaterialMarker,
} from "./shared.js";

function emitSimulatedAfterSpecialSummon({
  options,
  state,
  player,
  card,
  action,
  fromZone = "hand",
  sourceCard = null,
}) {
  options.emitSimulatedEvent?.("after_summon", {
    card,
    player,
    method: "special",
    fromZone,
    sourceCard: sourceCard || options.sourceCard || card,
    actionContext: options.actionContext,
  });
}

function getSimCardInstanceId(card) {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? card?.simInstanceId ?? null;
}

function applySimConditionalMarkersOnSummon({
  action,
  sourceCard,
  paidCostCards,
  state,
  targetPlayer,
  options,
}) {
  const markerConfigs = Array.isArray(action?.conditionalMarkersOnSummon)
    ? action.conditionalMarkersOnSummon
    : action?.conditionalMarkersOnSummon
      ? [action.conditionalMarkersOnSummon]
      : [];
  if (!sourceCard || markerConfigs.length === 0) return;

  for (const markerConfig of markerConfigs) {
    if (!markerConfig?.key) continue;
    const filters = markerConfig.costFilters || markerConfig.filters || {};
    const matchingCostCards = (paidCostCards || []).filter((card) =>
      matchesTargetFilters(card, filters, sourceCard, "self"),
    );
    const min = Number.isFinite(markerConfig.min) ? markerConfig.min : 1;
    if (matchingCostCards.length < min) continue;

    if (!sourceCard.effectMarkers || typeof sourceCard.effectMarkers !== "object") {
      sourceCard.effectMarkers = {};
    }

    const marker = {
      key: markerConfig.key,
      sourceEffectId:
        markerConfig.sourceEffectId || options.effect?.id || action.sourceEffectId || null,
      createdOnTurn: Number(state?.turnCounter || 0),
      matchingCostCount: matchingCostCards.length,
    };

    if (markerConfig.bindToFieldPresence === true && sourceCard.fieldPresenceId) {
      marker.fieldPresenceId = sourceCard.fieldPresenceId;
    }

    if (targetPlayer?.id) {
      marker.controllerId = targetPlayer.id;
    }

    sourceCard.effectMarkers[markerConfig.key] = marker;
  }
}

function canSimSpecialSummon(card, player, summonProcedure = "special") {
  if (!card || !player) return false;
  const fromZone = [
    "hand",
    "field",
    "spellTrap",
    "graveyard",
    "banished",
    "deck",
    "extraDeck",
  ].find((zone) => Array.isArray(player[zone]) && player[zone].includes(card));
  const eligibility = checkSpecialSummonEligibility(card, {
    summonProcedure,
    fromZone: fromZone || null,
  });
  if (eligibility.ok === false) {
    return false;
  }
  const restrictions = Array.isArray(player.specialSummonRestrictions)
    ? player.specialSummonRestrictions
    : [];
  return restrictions.every((restriction) => {
    const filters = restriction?.allowedFilters;
    return !filters || matchesTargetFilters(card, filters, null, "self");
  });
}

function captureSimSynchroMaterialMetadata(card, player, state) {
  return {
    instanceId: getSimCardInstanceId(card),
    cardId: card?.id ?? null,
    name: card?.name || null,
    level: Number(card?.level || 0),
    isTuner: card?.isTuner === true,
    ownerId: card?.owner || player?.id || null,
    controllerId: player?.id || card?.controller || card?.owner || null,
    usedOnTurn: Number.isFinite(Number(state?.turnCounter))
      ? Number(state.turnCounter)
      : null,
  };
}

function getSimSynchroGameLike() {
  return {
    effectEngine: {
      isEffectNegated: (card) => card?.effectsNegated === true,
    },
    canUseAsSynchroMaterial,
  };
}

function getSimSynchroEntries(player, action, state) {
  const filters = {
    cardKind: "monster",
    monsterType: "synchro",
    ...(action.filters || action.candidateFilters || {}),
  };
  const gameLike = getSimSynchroGameLike();
  return (player?.extraDeck || [])
    .filter(
      (card) =>
        matchesTargetFilters(card, filters, null, "self") &&
        canSimSpecialSummon(card, player, "synchro"),
    )
    .map((card) => ({
      card,
      combos: getSynchroMaterialCombos.call(gameLike, player, card) || [],
    }))
    .filter((entry) =>
      entry.combos.some(
        (combo) => (player.field || []).length - combo.length + 1 <= 5,
      ),
    )
    .sort(
      (a, b) => estimateMonsterValue(b.card) - estimateMonsterValue(a.card),
    );
}

function emitSimulatedCardToGrave({
  options,
  player,
  card,
  fromZone,
  sourceCard,
  contextLabel,
}) {
  options.emitSimulatedEvent?.("card_moved", {
    card,
    player,
    fromZone,
    toZone: "graveyard",
    movedByEffect: false,
    wasFaceupBeforeMove: card?.isFacedown !== true,
    contextLabel,
    sourceCard,
    actionContext: options.actionContext,
  });
}

export function applyRestrictSpecialSummons(ctx) {
  const { action, options, self, opponent } = ctx;
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  if (!targetPlayer || !action.allowedFilters) return;
  targetPlayer.specialSummonRestrictions =
    targetPlayer.specialSummonRestrictions || [];
  targetPlayer.specialSummonRestrictions.push({
    allowedFilters: { ...action.allowedFilters },
    duration: action.duration || "until_end_turn",
    reason: action.reason || null,
    sourceName: options?.sourceCard?.name || null,
    sourceId: options?.sourceCard?.id || null,
  });
}

export function applySpecialSummonFromZone(ctx) {
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
  const targetPlayer =
    action.summonToOwner === "opponent"
      ? opponent
      : resolveActionPlayer(action, self, opponent);
  if (!hasOpenMonsterZone(targetPlayer)) return;
  let candidates = action.requireSource && options.sourceCard
    ? [options.sourceCard]
    : action.targetRef
      ? targets
      : null;
  if (!candidates || candidates.length === 0) {
    if (action.targetRef) return;
    const candidateAction = { ...action };
    delete candidateAction.position;
    candidates = getActionCandidates(
      targetPlayer,
      candidateAction,
      "deck",
      options,
    );
  }
  if (action.targetRef) {
    const filters = buildActionFilter(action);
    delete filters.position;
    if (Object.keys(filters).length > 0) {
      candidates = candidates.filter((card) =>
        matchesTargetFilters(card, filters, options.sourceCard, "self"),
      );
    }
  }
  candidates = candidates.filter((card) => canSimSpecialSummon(card, targetPlayer));
  const max = Math.min(
    pickCountForAction(action, 1),
    candidates.length,
    5 - (targetPlayer.field || []).length,
  );
  const chosen = chooseRankedCards(
    candidates,
    "summon",
    action,
    state,
    targetPlayer,
    options,
  ).slice(0, max);
  if (chosen.length === 0) return;
  if (action.banishCost && options.sourceCard) {
    const sourceOwner = findCardOwner(state, options.sourceCard) || targetPlayer;
    moveCardToZone(sourceOwner, options.sourceCard, "banished");
  }
  chosen.forEach((card) => {
    removeCardFromZones(targetPlayer, card);
    const fromZone = action.zone || "deck";
    applySummonState(card, action, state, targetPlayer, options);
    targetPlayer.field.push(card);
    options.onAfterSpecialSummon?.({
      state,
      player: targetPlayer,
      card,
      action,
      fromZone,
      sourceCard: options.sourceCard,
    });
    emitSimulatedAfterSpecialSummon({
      options,
      state,
      player: targetPlayer,
      card,
      action,
      fromZone,
      sourceCard: options.sourceCard,
    });
  });
  if (chosen.length > 0) {
    options.lastSpecialSummonedCards = chosen;
    options.lastSpecialSummonedCard = chosen[0] || null;
    if (options.actionContext && typeof options.actionContext === "object") {
      options.actionContext.lastSpecialSummonedCards = chosen;
      options.actionContext.lastSpecialSummonedCard = chosen[0] || null;
    }
    storeSimActionResult(action, selections, options, chosen);
  }
  return;
}

export function applyDeSynchro(ctx) {
  const { action, targets, state, options, self, opponent } = ctx;
  const player = resolveActionPlayer(action, self, opponent);
  const synchroCard = (targets || []).find(
    (card) =>
      card?.cardKind === "monster" &&
      card.monsterType === "synchro" &&
      card.isFacedown !== true,
  );
  if (!player || !synchroCard) return;
  const owner = findCardOwner(state, synchroCard) || player;
  if (!owner.field?.includes(synchroCard)) return;

  const metadata = Array.isArray(synchroCard.synchroMaterials)
    ? synchroCard.synchroMaterials
    : [];
  const materialIds = metadata
    .map((entry) => entry?.instanceId)
    .filter((id) => id !== undefined && id !== null);
  const materials = materialIds.map((id) =>
    (player.graveyard || []).find((card) => getSimCardInstanceId(card) === id),
  );
  const targetOnOwnField = (player.field || []).includes(synchroCard);
  const freeZones = Math.max(
    0,
    5 - (player.field || []).length + (targetOnOwnField ? 1 : 0),
  );
  const canReviveAll =
    materials.length === materialIds.length &&
    materials.length > 0 &&
    materials.length <= freeZones &&
    materials.every((card) => canSimSpecialSummon(card, player, "special"));

  moveCardToZone(owner, synchroCard, "extraDeck");
  if (!canReviveAll) return;

  materials.forEach((material) => {
    moveCardToZone(player, material, "field");
    applySummonState(material, { ...action, position: action.position || "attack" }, state, player, options);
    options.emitSimulatedEvent?.("after_summon", {
      card: material,
      player,
      method: "special",
      fromZone: "graveyard",
      sourceCard: options.sourceCard,
      actionContext: options.actionContext,
    });
  });
}

export function applySynchroSummonFromExtraDeck(ctx) {
  const { action, state, options, self, opponent } = ctx;
  const player = resolveActionPlayer(action, self, opponent);
  if (!player) return;
  const entries = getSimSynchroEntries(player, action, state);
  const selected = entries[0];
  const synchroCard = selected?.card || null;
  const materials = selected?.combos?.[0] || [];
  if (!synchroCard || materials.length < 2) return;

  materials.forEach((material) => {
    const fromZone = findCardZone(player, material) || "field";
    if (moveCardToZone(player, material, "graveyard")) {
      emitSimulatedCardToGrave({
        options,
        player,
        card: material,
        fromZone,
        sourceCard: synchroCard,
        contextLabel: "synchro_material",
      });
    }
  });

  removeCardFromZones(player, synchroCard);
  applySummonState(
    synchroCard,
    { ...action, position: action.position || synchroCard.synchro?.position || "attack" },
    state,
    player,
    options,
  );
  synchroCard.summonMethod = "synchro";
  synchroCard.lastSummonMethod = "synchro";
  synchroCard.lastSummonedFromZone = "extraDeck";
  synchroCard.summonProcedure = "synchro";
  establishProperSummon(synchroCard, {
    summonProcedure: "synchro",
    sourceZone: "extraDeck",
  });
  synchroCard.synchroMaterials = materials.map((material) =>
    captureSimSynchroMaterialMetadata(material, player, state),
  );
  player.field.push(synchroCard);
  options.emitSimulatedEvent?.("after_summon", {
    card: synchroCard,
    player,
    method: "synchro",
    summonProcedure: "synchro",
    fromZone: "extraDeck",
    sourceCard: synchroCard,
    actionContext: options.actionContext,
  });
}

export function applySearchThenOptionalSpecialSummonFromHand(ctx) {
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
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  const candidates = getActionCandidates(targetPlayer, action, "deck");
  const searched = chooseRankedCards(
    candidates,
    "benefit",
    action,
    state,
    targetPlayer,
    options,
  )[0];
  if (!searched) return;
  removeCardFromZones(targetPlayer, searched);
  targetPlayer.hand.push(searched);

  const canSummon =
    hasOpenMonsterZone(targetPlayer) &&
    canSimSpecialSummon(searched, targetPlayer) &&
    evaluateSimulatedConditions(action.summonCondition, {
      state,
      selfId,
      options,
    });
  if (!canSummon) return;

  removeCardFromZones(targetPlayer, searched);
  applySummonState(searched, action, state, targetPlayer, {
    ...options,
    action,
  });
  targetPlayer.field.push(searched);
  options.onAfterSpecialSummon?.({
    state,
    player: targetPlayer,
    card: searched,
    action,
    fromZone: "hand",
    sourceCard: options.sourceCard,
  });
  emitSimulatedAfterSpecialSummon({
    options,
    state,
    player: targetPlayer,
    card: searched,
    action,
    fromZone: "hand",
    sourceCard: options.sourceCard,
  });
  return;
}

export function applySpecialSummonFromHandWithCost(ctx) {
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
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  const sourceCard = options.sourceCard;
  if (!sourceCard || !targetPlayer.hand?.includes(sourceCard)) return;
  if (!canSimSpecialSummon(sourceCard, targetPlayer)) return;
  const costTargets = action.costTargetRef
    ? selections?.[action.costTargetRef] || []
    : targets;
  if (!Array.isArray(costTargets) || costTargets.length === 0) return;
  const costDestination =
    action.costDestination === "banish"
      ? "banished"
      : action.costDestination || "graveyard";
  const costFreesMonsterZone = costTargets.some((card) => {
    const owner = findCardOwner(state, card) || targetPlayer;
    return owner === targetPlayer && findCardZone(owner, card) === "field";
  });
  if (!hasOpenMonsterZone(targetPlayer) && !costFreesMonsterZone) return;
  const paidCostCards = [];
  costTargets.forEach((card) => {
    if (!card) return;
    const owner = findCardOwner(state, card) || targetPlayer;
    const fromZone = findCardZone(owner, card) || "field";
    const wasFaceupBeforeMove = card.isFacedown !== true;
    if (moveCardToZone(owner, card, costDestination)) {
      options.emitSimulatedEvent?.("card_moved", {
        card,
        player: owner,
        fromZone,
        toZone: costDestination,
        movedByEffect: action.costMovedByEffect === true,
        wasFaceupBeforeMove,
        sourceCard,
        effectId: options.effect?.id || null,
        actionContext: options.actionContext,
      });
      paidCostCards.push(card);
    }
  });
  if (!hasOpenMonsterZone(targetPlayer)) return;
  removeCardFromZones(targetPlayer, sourceCard);
  applySummonState(sourceCard, action, state, targetPlayer, options);
  targetPlayer.field.push(sourceCard);
  applySimConditionalMarkersOnSummon({
    action,
    sourceCard,
    paidCostCards,
    state,
    targetPlayer,
    options,
  });
  options.onAfterSpecialSummon?.({
    state,
    player: targetPlayer,
    card: sourceCard,
    action,
    fromZone: "hand",
    sourceCard,
  });
  emitSimulatedAfterSpecialSummon({
    options,
    state,
    player: targetPlayer,
    card: sourceCard,
    action,
    fromZone: "hand",
    sourceCard,
  });
  return;
}

export function applySpecialSummonFromHandWithTieredCost(ctx) {
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
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  if (!hasOpenMonsterZone(targetPlayer)) return;
  const sourceCard = options.sourceCard;
  if (!sourceCard || !targetPlayer.hand?.includes(sourceCard)) return;
  if (!canSimSpecialSummon(sourceCard, targetPlayer)) return;
  const minCost = Number.isFinite(action.minCost)
    ? action.minCost
    : normalizeCount(action.count, 1).min;
  const maxCost = Number.isFinite(action.maxCost)
    ? action.maxCost
    : Math.max(minCost, normalizeCount(action.count, minCost).max);
  const costFilter = action.costFilters || action.filters || {};
  const costPool = (targetPlayer.field || []).filter((card) =>
    matchesTargetFilters(card, costFilter, sourceCard, "self"),
  );
  if (costPool.length < minCost) return;
  const chosenCosts = chooseRankedCards(
    costPool,
    "cost",
    { ...action, targetRef: action.costTargetRef },
    state,
    targetPlayer,
    options,
  ).slice(0, Math.min(maxCost, costPool.length));
  if (chosenCosts.length < minCost) return;
  chosenCosts.forEach((card) => moveCardToZone(targetPlayer, card, "graveyard"));
  removeCardFromZones(targetPlayer, sourceCard);
  applySummonState(sourceCard, action, state, targetPlayer, options);
  if (Number.isFinite(action.tier1AtkBoost) && chosenCosts.length >= 1) {
    sourceCard.atk = Math.max(
      0,
      (sourceCard.atk || 0) + action.tier1AtkBoost,
    );
    sourceCard.tempAtkBoost =
      (sourceCard.tempAtkBoost || 0) + action.tier1AtkBoost;
  }
  if (chosenCosts.length >= 2) {
    sourceCard.cannotBeDestroyedByBattle = true;
    sourceCard._simBattleDestructionProtected = true;
  }
  targetPlayer.field.push(sourceCard);
  options.onAfterSpecialSummon?.({
    state,
    player: targetPlayer,
    card: sourceCard,
    action,
    fromZone: "hand",
    sourceCard,
    costCount: chosenCosts.length,
  });
  emitSimulatedAfterSpecialSummon({
    options,
    state,
    player: targetPlayer,
    card: sourceCard,
    action,
    fromZone: "hand",
    sourceCard,
  });
  return;
}

export function applyBounceAndSummon(ctx) {
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
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  if (!hasOpenMonsterZone(targetPlayer)) return;
  const sourceCard = options.sourceCard;
  if (!sourceCard || !targetPlayer.field?.includes(sourceCard)) return;
  if (action.bounceSource) {
    const wasFaceupBeforeMove = sourceCard.isFacedown !== true;
    if (moveCardToZone(targetPlayer, sourceCard, "hand")) {
      options.emitSimulatedEvent?.("card_moved", {
        card: sourceCard,
        player: targetPlayer,
        fromZone: "field",
        toZone: "hand",
        movedByEffect: true,
        wasFaceupBeforeMove,
        sourceCard,
        effectId: options.effect?.id || null,
        actionContext: options.actionContext,
      });
    }
  }
  const candidates = getActionCandidates(targetPlayer, action, "hand")
    .filter(
      (card) => card !== sourceCard && canSimSpecialSummon(card, targetPlayer),
    );
  const chosen = chooseRankedCards(
    candidates,
    "summon",
    action,
    state,
    targetPlayer,
    options,
  )[0];
  if (!chosen) return;
  removeCardFromZones(targetPlayer, chosen);
  applySummonState(chosen, action, state, targetPlayer, options);
  targetPlayer.field.push(chosen);
  options.onAfterSpecialSummon?.({
    state,
    player: targetPlayer,
    card: chosen,
    action,
    fromZone: "hand",
    sourceCard,
  });
  emitSimulatedAfterSpecialSummon({
    options,
    state,
    player: targetPlayer,
    card: chosen,
    action,
    fromZone: "hand",
    sourceCard,
  });
  return;
}

export function applySpecialSummonToken(ctx) {
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
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  if ((targetPlayer.field || []).length >= 5) return;
  const token = action.token || { name: "Token", atk: 0, def: 0 };
  const tokenCard = {
    ...token,
    cardKind: "monster",
    isToken: true,
  };
  if (!canSimSpecialSummon(tokenCard, targetPlayer)) return;
  targetPlayer.field.push({
    ...tokenCard,
    cardKind: "monster",
    position: action.position || "attack",
    isFacedown: false,
    hasAttacked: false,
    attacksUsedThisTurn: 0,
    isToken: true,
  });
  return;
}

export function applyConditionalSummonFromHand(ctx) {
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
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  if ((targetPlayer.field || []).length >= 5) return;
  if (
    action.condition &&
    !evaluateSimulatedConditions(action.condition, { state, selfId, options })
  ) return;
  const chosen = targets[0];
  if (chosen && canSimSpecialSummon(chosen, targetPlayer)) {
    removeCardFromZones(targetPlayer, chosen);
    applySummonState(chosen, action, state, targetPlayer, options);
    targetPlayer.field.push(chosen);
    emitSimulatedAfterSpecialSummon({
      options,
      state,
      player: targetPlayer,
      card: chosen,
      action,
      fromZone: "hand",
      sourceCard: options.sourceCard,
    });
  }
  return;
}

export function applyPolymerizationFusionSummon(ctx) {
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
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  if (!hasOpenMonsterZone(targetPlayer)) return;
  const materialPool = rankCandidates([
    ...(targetPlayer.field || []),
    ...(targetPlayer.hand || []),
  ].filter((card) => card?.cardKind === "monster"), "cost", {
    ...options,
    fieldSpell: targetPlayer.fieldSpell,
    targetPreference: mergeCostPreference(
      getTargetPreference(options, action.targetRef || action.id),
      getCostPreference(options),
    ),
  });
  const canPayMaterials = (fusionCard) => {
    const remaining = materialPool.slice();
    const picked = [];
    for (const requirement of fusionCard.fusionMaterials || []) {
      const count = Number(requirement.count || 1);
      for (let i = 0; i < count; i += 1) {
        const index = remaining.findIndex((candidate) =>
          matchesTargetFilters(candidate, requirement, fusionCard, "self"),
        );
        if (index < 0) return null;
        picked.push(remaining[index]);
        remaining.splice(index, 1);
      }
    }
    return picked;
  };
  const fusionEntries = (targetPlayer.extraDeck || [])
    .filter((card) => card?.monsterType === "fusion")
    .filter((card) => canSimSpecialSummon(card, targetPlayer, "fusion"))
    .map((fusionCard) => ({
      fusionCard,
      materials: canPayMaterials(fusionCard),
    }))
    .filter((entry) => Array.isArray(entry.materials));
  if (fusionEntries.length === 0) return;
  const hint = options.sourceAction?.fusionTargetHint;
  fusionEntries.sort((a, b) => {
    if (hint) {
      if (a.fusionCard.name === hint) return -1;
      if (b.fusionCard.name === hint) return 1;
    }
    return estimateMonsterValue(b.fusionCard) - estimateMonsterValue(a.fusionCard);
  });
  const { fusionCard, materials } = fusionEntries[0];
  materials.forEach((material) => {
    const fromZone = findCardZone(targetPlayer, material) || "field";
    if (moveCardToZone(targetPlayer, material, "graveyard")) {
      updateSimulatedSentToGraveMaterialMarker({
        card: material,
        state,
        player: targetPlayer,
        fromZone,
        contextLabel: "fusion_material",
      });
    }
  });
  removeCardFromZones(targetPlayer, fusionCard);
  applySummonState(
    fusionCard,
    { ...action, position: action.position || "attack" },
    state,
    targetPlayer,
    options,
  );
  fusionCard.summonMethod = "fusion";
  targetPlayer.field.push(fusionCard);
  options.onFusionSummon?.({
    state,
    player: targetPlayer,
    fusionCard,
    materials,
    action,
    sourceCard: options.sourceCard,
  });
  return;
}
