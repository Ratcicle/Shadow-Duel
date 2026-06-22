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
} from "./shared.js";

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
    candidates = getActionCandidates(targetPlayer, action, "deck");
  }
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
  if (!hasOpenMonsterZone(targetPlayer)) return;
  const sourceCard = options.sourceCard;
  if (!sourceCard || !targetPlayer.hand?.includes(sourceCard)) return;
  const costTargets = action.costTargetRef
    ? selections?.[action.costTargetRef] || []
    : targets;
  if (!Array.isArray(costTargets) || costTargets.length === 0) return;
  costTargets.forEach((card) => {
    if (!card) return;
    const owner = findCardOwner(state, card) || targetPlayer;
    moveCardToZone(owner, card, "graveyard");
  });
  removeCardFromZones(targetPlayer, sourceCard);
  applySummonState(sourceCard, action, state, targetPlayer, options);
  targetPlayer.field.push(sourceCard);
  options.onAfterSpecialSummon?.({
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
    moveCardToZone(targetPlayer, sourceCard, "hand");
  }
  const candidates = getActionCandidates(targetPlayer, action, "hand")
    .filter((card) => card !== sourceCard);
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
  targetPlayer.field.push({
    ...token,
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
  if (chosen) {
    removeCardFromZones(targetPlayer, chosen);
    applySummonState(chosen, action, state, targetPlayer, options);
    targetPlayer.field.push(chosen);
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
  materials.forEach((material) => moveCardToZone(targetPlayer, material, "graveyard"));
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
