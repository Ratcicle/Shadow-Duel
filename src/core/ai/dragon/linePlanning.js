// -----------------------------------------------------------------------------
// src/core/ai/dragon/linePlanning.js
// TurnLineSearch profile for Dragon.
// -----------------------------------------------------------------------------

import { getValidBoneflameCostCandidates } from "./boneflamePolicy.js";

const DEFAULT_PROFILE = {
  enabled: false,
  mode: "off",
  turnMode: "mainOnly",
  beamWidth: 3,
  maxDepth: 4,
  nodeBudget: 220,
  candidateLimit: 8,
  reasons: [],
  critical: false,
};

const HIGH_LEVEL_DRAGON_NAMES = new Set([
  "Majestic Silver Dragon",
  "Black Bull Dragon",
  "Purified Crystal Dragon",
  "Volcanic Extreme Dragon",
  "Fire Extreme Dragon",
]);

const EXTENDER_NAMES = new Set([
  "Solar Eclipse Dragon",
  "Lunar Eclipse Dragon",
  "Stelya, Dragon Tamer",
  "Voltaic Dragon",
  "Grey Dragon",
  "Hellkite Dragon",
  "Black Bull Dragon",
]);

const PAYOFF_NAMES = new Set([
  "Solar Eclipse Dragon",
  "Lunar Eclipse Dragon",
  "Stelya, Dragon Tamer",
  "Extreme Dragon Awakening",
  "Polymerization",
  "Dragon Spirit Sanctuary",
  "Call of the Haunted",
  "Black Bull Dragon",
  "Purified Crystal Dragon",
  "Fire Extreme Dragon",
  "Volcanic Extreme Dragon",
  "Radiant Cosmic Dragon",
  "Tech-Void Dragon",
  "Jagged Peak of the Dragons",
]);

const CHEAP_DRAGON_COST_NAMES = new Set([
  "Solar Eclipse Dragon",
  "Lunar Eclipse Dragon",
  "Voltaic Dragon",
  "Grey Dragon",
  "Luminescent Dragon",
  "Armored Dragon",
]);

const CRITICAL_PAYOFF_NAMES = new Set([
  "Solar Eclipse Dragon",
  "Lunar Eclipse Dragon",
  "Stelya, Dragon Tamer",
  "Luminous Dragon",
  "Black Bull Dragon",
  "Purified Crystal Dragon",
  "Fire Extreme Dragon",
  "Volcanic Extreme Dragon",
  "Hellkite Dragon",
  "Polymerization",
  "Extreme Dragon Awakening",
  "Jagged Peak of the Dragons",
  "Dragon Spirit Sanctuary",
  "Call of the Haunted",
]);

const FIELD_IGNITION_RESPONSE_NAMES = new Set([
  "Solar Eclipse Dragon",
  "Lunar Eclipse Dragon",
  "Stelya, Dragon Tamer",
  "Majestic Silver Dragon",
  "Purified Crystal Dragon",
  "Rainbow Cosmic Dragon",
  "Hellkite Dragon",
  "Volcanic Extreme Dragon",
]);

const ARMORY_SEARCH_NAMES = new Set([
  "Solar Eclipse Dragon",
  "Lunar Eclipse Dragon",
  "Stelya, Dragon Tamer",
  "Voltaic Dragon",
  "Grey Dragon",
  "Luminescent Dragon",
  "Luminous Dragon",
  "Armored Dragon",
]);

const DRAGON_BOSS_NAMES = new Set([
  "Radiant Cosmic Dragon",
  "Tech-Void Dragon",
  "Rainbow Cosmic Dragon",
  "Purified Crystal Dragon",
  "Black Bull Dragon",
  "Volcanic Extreme Dragon",
  "Fire Extreme Dragon",
  "Hellkite Dragon",
  "Majestic Silver Dragon",
]);

function getPlayer(analysis = {}, context = {}) {
  return context.bot || analysis.bot || analysis.player || context.game?.bot || {};
}

function getOpponent(analysis = {}, context = {}) {
  return analysis.opponent || context.opponent || context.game?.player || {};
}

function getCards(player, zone) {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return Array.isArray(player[zone]) ? player[zone].filter(Boolean) : [];
}

function getAnalysisCards(analysis = {}, player = {}, zone) {
  const fromAnalysis = analysis[zone];
  if (Array.isArray(fromAnalysis)) return fromAnalysis.filter(Boolean);
  if (zone === "fieldSpell") return analysis.fieldSpell ? [analysis.fieldSpell] : getCards(player, zone);
  return getCards(player, zone);
}

function hasName(cards = [], name) {
  return (cards || []).some((card) => card?.name === name);
}

function countNamed(cards = [], name) {
  return (cards || []).filter((card) => card?.name === name).length;
}

function isDragonMonster(card) {
  return card?.cardKind === "monster" && card.type === "Dragon";
}

function isFaceupDragon(card) {
  return isDragonMonster(card) && !card.isFacedown;
}

function hasArchetype(card, archetype) {
  if (!card) return false;
  if (Array.isArray(card.archetypes)) return card.archetypes.includes(archetype);
  return card.archetype === archetype;
}

function countFaceupDragons(cards = []) {
  return (cards || []).filter(isFaceupDragon).length;
}

function countDragonMonsters(cards = []) {
  return (cards || []).filter(isDragonMonster).length;
}

function isExtremeDragon(card) {
  return isDragonMonster(card) && hasArchetype(card, "Extreme Dragons");
}

function hasExtremeFaceup(cards = []) {
  return (cards || []).some((card) => isFaceupDragon(card) && isExtremeDragon(card));
}

function hasRadiantCosmicMaterials(cards = []) {
  const dragons = (cards || []).filter(isDragonMonster);
  if (dragons.length < 3) return false;
  return dragons.some(
    (card) => String(card.attribute || "").toLowerCase() === "light",
  );
}

function hasTechVoidMaterials(cards = []) {
  const dragons = (cards || []).filter(isDragonMonster);
  return (
    dragons.some((card) => card.name === "Voltaic Dragon") &&
    dragons.some((card) => card.name !== "Voltaic Dragon" && (card.level || 0) >= 5)
  );
}

function hasHighLevelDragon(cards = []) {
  return (cards || []).some(
    (card) =>
      isDragonMonster(card) &&
      ((card.level || 0) >= 5 || HIGH_LEVEL_DRAGON_NAMES.has(card.name)),
  );
}

function hasGoodAwakeningTarget(cards = []) {
  return (cards || []).some(
    (card) => isDragonMonster(card) && (card.level || 0) >= 8,
  );
}

function hasUsefulDiscard(cards = []) {
  return (cards || []).some((card) => CHEAP_DRAGON_COST_NAMES.has(card?.name));
}

function hasRealGreyDiscardValue({ hand = [], field = [], graveyard = [] } = {}) {
  const discardableDragons = (hand || []).filter(isDragonMonster);
  if (discardableDragons.some((card) => card.name === "Voltaic Dragon")) return true;
  if (
    discardableDragons.some((card) =>
      ["Solar Eclipse Dragon", "Lunar Eclipse Dragon", "Stelya, Dragon Tamer"].includes(card.name),
    )
  ) {
    return true;
  }
  if (hasLuminousRecovery(field)) {
    return discardableDragons.some((discard) =>
      (graveyard || []).some(
        (candidate) =>
          isDragonMonster(candidate) && candidate.name !== discard.name,
      ),
    );
  }
  return false;
}

function hasCriticalPayoff(cards = []) {
  return (cards || []).some((card) => CRITICAL_PAYOFF_NAMES.has(card?.name));
}

function hasLuminousRecovery(field = []) {
  return (field || []).some(
    (card) => card?.name === "Luminous Dragon" && !card.isFacedown,
  );
}

function hasLargeOpponentThreat(opponentField = []) {
  return (opponentField || []).some(
    (card) => card?.cardKind === "monster" && Math.max(card.atk || 0, card.def || 0) >= 2200,
  );
}

function hasVolcanicGyRisk({ graveyard, opponent, opponentGraveyard }) {
  const ownDragonCount = countDragonMonsters(graveyard);
  const hasFollowUpResource =
    ownDragonCount >= 3 ||
    hasName(graveyard, "Solar Eclipse Dragon") ||
    hasName(graveyard, "Lunar Eclipse Dragon") ||
    hasName(graveyard, "Stelya, Dragon Tamer") ||
    hasName(graveyard, "Grey Dragon") ||
    hasName(graveyard, "Hellkite Dragon") ||
    hasName(graveyard, "Rainbow Cosmic Dragon") ||
    graveyard.some((card) => card?.name === "Radiant Cosmic Dragon");
  if (!hasFollowUpResource) return false;

  const totalBanished =
    (graveyard || []).filter(Boolean).length +
    (opponentGraveyard || []).filter(Boolean).length;
  const projectedBurn = totalBanished * 100;
  return projectedBurn < (opponent?.lp ?? 8000);
}

function hasRainbowRequirement(game, player) {
  const materialId = 29;
  const playerId = player?.id || "bot";
  const store =
    game?.materialDuelStats?.[playerId]?.effectActivationsByMaterialId ||
    game?._simMaterialEffectActivationsByMaterialId?.[playerId];
  if (!store) return false;
  if (typeof store.get === "function") return (store.get(materialId) || 0) >= 3;
  return (store[materialId] || store[String(materialId)] || 0) >= 3;
}

function hasPurifiedLine({ hand, field, graveyard, extraDeck, game, player }) {
  if (hasName(hand, "Purified Crystal Dragon")) {
    return graveyard.filter(isDragonMonster).length >= 3;
  }
  if (hasName(field, "Purified Crystal Dragon")) {
    const hasProtectionTarget = field.some(
      (card) => card?.name !== "Purified Crystal Dragon" && isFaceupDragon(card),
    );
    const hasRainbow =
      hasName(extraDeck, "Rainbow Cosmic Dragon") && hasRainbowRequirement(game, player);
    return hasProtectionTarget || hasRainbow;
  }
  return false;
}

function hasJaggedCashout(fieldSpell) {
  return (
    fieldSpell?.name === "Jagged Peak of the Dragons" &&
    (fieldSpell.counters?.dragon_peak || 0) >= 5
  );
}

function hasHellkiteRoarToJagged({ graveyard, deck, fieldSpell }) {
  return (
    hasName(graveyard, "Hellkite Roar") &&
    fieldSpell?.name !== "Jagged Peak of the Dragons" &&
    hasName(deck, "Jagged Peak of the Dragons")
  );
}

function opponentThreatensLethal(player, opponentField = []) {
  const lp = Number(player?.lp || 0);
  if (lp <= 0) return true;
  const attack = (opponentField || []).reduce((sum, card) => {
    if (!card || card.cardKind !== "monster" || card.isFacedown) return sum;
    if (card.position === "defense") return sum;
    return sum + Math.max(0, Number(card.atk || 0));
  }, 0);
  return attack >= lp;
}

function hasThreatResponse({ hand, field, graveyard, opponentField, opponentBackrow }) {
  const threats = (opponentField || []).filter((card) => card?.cardKind === "monster");
  const hasLargeThreat = threats.some(
    (card) => Math.max(card.atk || 0, card.def || 0) >= 2200,
  );
  if (!hasLargeThreat && threats.length === 0 && opponentBackrow <= 0) return false;

  return (
    hasName(field, "Majestic Silver Dragon") ||
    hasName(field, "Volcanic Extreme Dragon") ||
    (hasName(hand, "Hellkite Roar") && opponentBackrow > 0) ||
    hasName(graveyard, "Solar Eclipse Dragon") ||
    hasName(graveyard, "Lunar Eclipse Dragon") ||
    (hasName(graveyard, "Stelya, Dragon Tamer") && field.some(isFaceupDragon))
  );
}

function hasBlackBullPressure({ hand, graveyard, deck, opponent }) {
  const opponentLp = opponent?.lp ?? 8000;
  const handDragons = hand.filter(isDragonMonster);
  const liveHandBull =
    hasName(hand, "Black Bull Dragon") && handDragons.length >= 3;
  const liveGyBull =
    hasName(graveyard, "Black Bull Dragon") &&
    deck.some(
      (card) =>
        isDragonMonster(card) &&
        (card.level || 0) >= 7 &&
        (card.level || 0) <= 8,
    );
  const pressureNeeded =
    opponentLp <= 3000 ||
    (opponent?.field || []).some((card) => (card?.atk || 0) >= 2200);
  return pressureNeeded && (liveHandBull || liveGyBull);
}

function getBattleTargetStat(card = {}) {
  if (!card || card.cardKind !== "monster") return 0;
  if (card.isFacedown || card.position === "defense") {
    return Number(card.def || 0);
  }
  return getEffectiveAtk(card);
}

function canDragonAttack(card = {}) {
  return (
    isFaceupDragon(card) &&
    card.position !== "defense" &&
    !card.cannotAttackThisTurn &&
    !card.hasAttacked &&
    getEffectiveAtk(card) > 0
  );
}

function canDestroyByBattle(attacker, target) {
  if (!canDragonAttack(attacker) || !target || target.cardKind !== "monster") {
    return false;
  }
  return getEffectiveAtk(attacker) > getBattleTargetStat(target);
}

function hasBattleRemoval({ field = [], opponentField = [] } = {}) {
  return (field || []).some((attacker) =>
    (opponentField || []).some((target) => canDestroyByBattle(attacker, target)),
  );
}

function hasDirectLethal({ field = [], opponent = {} } = {}) {
  const opponentLp = Number(opponent?.lp || 8000);
  if (opponentLp <= 0) return true;
  const damage = (field || [])
    .filter(canDragonAttack)
    .reduce((sum, card) => sum + Math.max(0, getEffectiveAtk(card)), 0);
  return damage >= opponentLp;
}

function hasBlackBullBattlePlan({ field = [], opponentField = [] } = {}) {
  const bull = (field || []).find((card) => card?.name === "Black Bull Dragon" && canDragonAttack(card));
  if (!bull) return false;
  const removable = (opponentField || []).filter((target) => canDestroyByBattle(bull, target));
  return removable.length >= 1;
}

function hasJaggedBattleCounterPlan({ field = [], opponentField = [], fieldSpell = null } = {}) {
  if (fieldSpell?.name !== "Jagged Peak of the Dragons") return false;
  const counters = Number(fieldSpell.counters?.dragon_peak || 0);
  return counters >= 4 && hasBattleRemoval({ field, opponentField });
}

function hasNamedBattlePlan({ field = [], opponentField = [] } = {}, name) {
  const attacker = (field || []).find((card) => card?.name === name && canDragonAttack(card));
  if (!attacker) return false;
  return (opponentField || []).some((target) => canDestroyByBattle(attacker, target));
}

function hasRadiantSafeBattle({ field = [], opponentField = [] } = {}) {
  const radiant = (field || []).find(
    (card) => card?.name === "Radiant Cosmic Dragon" && canDragonAttack(card),
  );
  if (!radiant) return false;
  return (
    radiant.preventsBattleDamageToController === true &&
    (opponentField || []).some((target) => getBattleTargetStat(target) >= getEffectiveAtk(radiant))
  );
}

function hasBattleMain2Payoff({ fieldSpell = null, spellTrap = [], hand = [], field = [], deck = [] } = {}) {
  if (fieldSpell?.name === "Jagged Peak of the Dragons" && Number(fieldSpell.counters?.dragon_peak || 0) >= 4) {
    return true;
  }
  if (
    spellTrap.some((card) => card?.name === "Extreme Dragon Awakening" && !card.isFacedown) &&
    countFaceupDragons(field) >= 2 &&
    hasGoodAwakeningTarget(hand)
  ) {
    return true;
  }
  if (hasName(hand, "Polymerization") && hasRadiantCosmicMaterials([...hand, ...field])) {
    return true;
  }
  if (hasName(field, "Purified Crystal Dragon") && countDragonMonsters(deck) > 0) {
    return true;
  }
  return false;
}

function hasLongLuminousPayoff({ hand, field, deck, graveyard }) {
  const hasLuminousStarter = hasName(hand, "Luminous Dragon") && field.length === 0;
  if (!hasLuminousStarter) return false;
  const hasExtender = hand.some((card) => EXTENDER_NAMES.has(card?.name));
  const hasPayoff =
    hand.some((card) => PAYOFF_NAMES.has(card?.name)) ||
    deck.some((card) => PAYOFF_NAMES.has(card?.name)) ||
    graveyard.some((card) => PAYOFF_NAMES.has(card?.name));
  return hasExtender && hasPayoff;
}

function getActionCard(action = {}, player = {}) {
  if (action.card) return action.card;
  if (action.type === "fieldEffect") return player.fieldSpell || null;
  if (action.type === "monsterEffect") return getCards(player, "field")[action.fieldIndex] || null;
  if (action.type === "graveyardMonsterEffect" || action.type === "graveyardSpellEffect") {
    return getCards(player, "graveyard")[action.graveyardIndex] || null;
  }
  if (action.type === "spellTrapEffect") return getCards(player, "spellTrap")[action.zoneIndex] || null;
  if (Number.isInteger(action.index)) return getCards(player, "hand")[action.index] || null;
  return null;
}

function actionPreferredNames(action = {}) {
  const preferences =
    action.activationContext?.actionContext?.targetPreferences ||
    action.actionContext?.targetPreferences ||
    {};
  const names = [];
  for (const preference of Object.values(preferences)) {
    if (!preference || typeof preference !== "object") continue;
    if (Array.isArray(preference.preferredNames)) names.push(...preference.preferredNames);
    if (Array.isArray(preference.offensiveNames)) names.push(...preference.offensiveNames);
    if (Array.isArray(preference.preferNames)) names.push(...preference.preferNames);
  }
  return names.filter(Boolean);
}

function actionMentionsName(action = {}, name) {
  if (!name) return false;
  if (action.cardName === name || action.card?.name === name) return true;
  return actionPreferredNames(action).includes(name);
}

function findCardsByNames(player = {}, names = []) {
  const wanted = new Set(names);
  if (wanted.size === 0) return [];
  return ["hand", "field", "graveyard", "deck", "extraDeck", "spellTrap"]
    .flatMap((zone) => getCards(player, zone))
    .concat(getCards(player, "fieldSpell"))
    .filter((card) => wanted.has(card?.name));
}

function hasExtremePreferredTarget(action = {}, player = {}) {
  return findCardsByNames(player, actionPreferredNames(action)).some(isExtremeDragon);
}

function addRetention(reasons, amount, reason) {
  reasons.push(reason);
  return amount;
}

function getRetentionAdjustment(action = {}, context = {}) {
  const analysis = context.analysis || {};
  const game = context.game || analysis.game || {};
  const player = getPlayer(analysis, context);
  const opponent = getOpponent(analysis, context);
  const hand = getAnalysisCards(analysis, player, "hand");
  const field = getAnalysisCards(analysis, player, "field");
  const graveyard = getAnalysisCards(analysis, player, "graveyard");
  const spellTrap = getAnalysisCards(analysis, player, "spellTrap");
  const deck = getCards(player, "deck");
  const extraDeck = getCards(player, "extraDeck");
  const fieldSpell = analysis.fieldSpell || player.fieldSpell || null;
  const opponentField = analysis.oppField || opponent.field || [];
  const opponentGraveyard = analysis.oppGraveyard || opponent.graveyard || [];
  const opponentBackrow =
    analysis.oppBackrow ??
    (opponent.spellTrap || []).length +
      (opponent.fieldSpell ? 1 : 0);
  const card = getActionCard(action, player);
  const actionName = action.cardName || card?.name || "";
  const allFusionMaterials = [...hand, ...field];
  const hasRadiant = hasRadiantCosmicMaterials(allFusionMaterials);
  const hasTechVoid = hasTechVoidMaterials(allFusionMaterials);
  const fieldHasExtreme = hasExtremeFaceup(field);
  const reasons = [];
  let boost = 0;

  if (actionMentionsName(action, "Supreme Bahamut Dragon") || actionName === "Supreme Bahamut Dragon") {
    boost -= addRetention(reasons, 100, "bahamut_neutralized");
  }

  if (action.type === "handIgnition" && actionName === "Luminous Dragon") {
    if (!field.some((fieldCard) => fieldCard?.cardKind === "monster")) {
      boost += addRetention(reasons, 8, "empty_field_luminous_starter");
      if (hasName(hand, "Voltaic Dragon") || hand.some((cardInHand) => PAYOFF_NAMES.has(cardInHand?.name))) {
        boost += addRetention(reasons, 2, "luminous_has_followup");
      }
    }
  }

  if (action.type === "handIgnition" && actionName === "Voltaic Dragon") {
    if (field.some(isFaceupDragon) || (!field.length && hasName(hand, "Luminous Dragon"))) {
      boost += addRetention(reasons, 7, "voltaic_extender_line");
      if (hasLuminousRecovery(field)) boost += addRetention(reasons, 2, "luminous_recovers_discard");
    }
  }

  if (action.type === "summon" && actionName === "Armored Dragon" && analysis.canNormalSummon !== false) {
    boost += addRetention(reasons, 7, "armored_normal_starter");
  }

  if (actionName === "Extreme Dragon Awakening") {
    if (action.type === "spellTrapEffect" && countFaceupDragons(field) >= 2 && hasGoodAwakeningTarget(hand)) {
      boost += addRetention(reasons, 9, "awakening_faceup_payoff");
    } else if (action.type === "spell" && (hasGoodAwakeningTarget(deck) || countFaceupDragons(field) >= 2)) {
      boost += addRetention(reasons, 7, "awakening_activation_setup");
      if (countFaceupDragons(field) >= 2) boost += addRetention(reasons, 2, "awakening_costs_ready");
    }
  }

  if (actionName === "Polymerization") {
    if (hasRadiant) {
      boost += addRetention(reasons, 9, "radiant_cosmic_fusion_available");
    } else if (hasTechVoid) {
      boost += addRetention(reasons, 7, "tech_void_fusion_available");
    }
  }

  if (actionName === "Converging Stars") {
    const heavyDragonHand = hand.filter(
      (handCard) => isDragonMonster(handCard) && (handCard.level || 0) >= 5,
    );
    if (heavyDragonHand.length > 0 && hand.length >= 3) {
      boost += addRetention(reasons, 7, "converging_unlocks_heavy_hand");
      if (hasUsefulDiscard(hand) || hasLuminousRecovery(field)) {
        boost += addRetention(reasons, 2, "converging_has_safe_discard");
      }
    }
  }

  if (actionName === "Purified Crystal Dragon") {
    if (
      (action.type === "handIgnition" && countDragonMonsters(graveyard) >= 3) ||
      action.type === "monsterEffect"
    ) {
      boost += addRetention(reasons, 7, "purified_live_payoff");
    }
    if (hasName(extraDeck, "Rainbow Cosmic Dragon") && hasRainbowRequirement(game, player)) {
      boost += addRetention(reasons, 2, "purified_unlocks_rainbow");
    }
  }

  if (actionName === "Jagged Peak of the Dragons") {
    if (action.type === "fieldEffect" && hasJaggedCashout(fieldSpell)) {
      boost += addRetention(reasons, 9, "jagged_cashout_ready");
    } else if (action.type === "spell" && (hasName(hand, "Black Bull Dragon") || hasName(graveyard, "Black Bull Dragon"))) {
      boost += addRetention(reasons, 5, "jagged_black_bull_counter_plan");
    }
  }

  if (
    action.type === "graveyardSpellEffect" &&
    actionName === "Hellkite Roar" &&
    hasHellkiteRoarToJagged({ graveyard, deck, fieldSpell })
  ) {
    boost += addRetention(reasons, 9, "hellkite_roar_fetches_jagged");
  }

  if (action.type === "monsterEffect" && FIELD_IGNITION_RESPONSE_NAMES.has(actionName)) {
    if (hasLargeOpponentThreat(opponentField) || opponentBackrow > 0) {
      boost += addRetention(reasons, 6, "field_ignition_answers_threat");
    }
    if (["Purified Crystal Dragon", "Rainbow Cosmic Dragon", "Hellkite Dragon"].includes(actionName)) {
      boost += addRetention(reasons, 3, "field_ignition_enables_payoff");
    }
  }

  if (
    action.type === "graveyardMonsterEffect" &&
    actionName === "Grey Dragon" &&
    hasRealGreyDiscardValue({ hand, field, graveyard })
  ) {
    boost += addRetention(reasons, 4, "grey_has_useful_discard");
  }

  if (
    action.type === "graveyardMonsterEffect" &&
    actionName === "Boneflame Dragon" &&
    countDragonMonsters(graveyard) >= 3 &&
    getValidBoneflameCostCandidates(
      graveyard.find((card) => card?.name === "Boneflame Dragon"),
      { field, graveyard },
    ).length > 0
  ) {
    boost += addRetention(reasons, 4, "boneflame_loaded_graveyard");
  }

  if (actionName === "Hellkite Dragon" && field.some((fieldCard) => isFaceupDragon(fieldCard) && !isExtremeDragon(fieldCard))) {
    boost += addRetention(reasons, 4, "hellkite_has_exchange_cost");
  }

  if (
    actionName === "Black Bull Dragon" &&
    (hasUsefulDiscard(hand) ||
      hasBlackBullPressure({ hand, graveyard, deck, opponent }))
  ) {
    boost += addRetention(reasons, 4, "black_bull_pressure_or_discard");
  }

  if (
    fieldHasExtreme &&
    (
      (["summon", "handIgnition"].includes(action.type) && isExtremeDragon(card)) ||
      (action.type === "spellTrapEffect" && hasExtremePreferredTarget(action, player))
    )
  ) {
    boost -= addRetention(reasons, 8, "avoid_second_faceup_extreme");
  }

  if (
    action.type === "monsterEffect" &&
    actionName === "Volcanic Extreme Dragon" &&
    hasVolcanicGyRisk({ graveyard, opponent, opponentGraveyard })
  ) {
    boost -= addRetention(reasons, 7, "volcanic_preserve_graveyard_resources");
  }

  if (
    actionName === "Polymerization" &&
    !hasRadiant &&
    hasTechVoid &&
    (hasName(hand, "Luminous Dragon") || hasName(field, "Luminous Dragon")) &&
    !hasLargeOpponentThreat(opponentField) &&
    (opponent?.lp ?? 8000) > 2500
  ) {
    boost -= addRetention(reasons, 5, "polymerization_preserve_luminous_without_payoff");
  }

  if (
    actionName === "Converging Stars" &&
    hasCriticalPayoff(hand) &&
    !hasUsefulDiscard(hand) &&
    !hasLuminousRecovery(field)
  ) {
    boost -= addRetention(reasons, 5, "converging_no_safe_discard");
  }

  if (
    action.type === "fieldEffect" &&
    actionName === "Jagged Peak of the Dragons" &&
    field.filter((fieldCard) => fieldCard?.cardKind === "monster").length >= 5
  ) {
    boost -= addRetention(reasons, 6, "jagged_cashout_field_full");
  }

  if (countNamed(extraDeck, "Supreme Bahamut Dragon") === 0 && actionMentionsName(action, "Supreme Bahamut Dragon")) {
    boost -= addRetention(reasons, 100, "bahamut_absent_from_extra");
  }

  return { boost, reasons };
}

export function applyDragonRetentionPriorities(actions = [], context = {}) {
  return (actions || [])
    .map((action, index) => {
      const basePriority = Number(action?.priority ?? 0);
      const { boost, reasons } = getRetentionAdjustment(action, context);
      const nextPriority = basePriority + boost;
      const adjustedAction =
        boost !== 0 || reasons.length > 0
          ? {
              ...action,
              dragonBasePriority: action.dragonBasePriority ?? basePriority,
              dragonRetentionBoost: (action.dragonRetentionBoost || 0) + boost,
              dragonRetentionReasons: [
                ...(action.dragonRetentionReasons || []),
                ...reasons,
              ],
              priority: nextPriority,
            }
          : action;
      return { action: adjustedAction, index };
    })
    .sort((a, b) => {
      const priorityDiff = (b.action?.priority || 0) - (a.action?.priority || 0);
      if (priorityDiff !== 0) return priorityDiff;
      const boostDiff =
        (b.action?.dragonRetentionBoost || 0) -
        (a.action?.dragonRetentionBoost || 0);
      if (boostDiff !== 0) return boostDiff;
      return a.index - b.index;
    })
    .map((entry) => entry.action);
}

function getDestroyedOpponentMonsters(summary = {}) {
  return (summary.destroyedCards || []).filter(
    (card) => card?.owner === "opponent" && card.cardKind === "monster",
  );
}

function addJaggedCounter(fieldSpell) {
  if (!fieldSpell || fieldSpell.name !== "Jagged Peak of the Dragons") return false;
  if (!fieldSpell.counters || typeof fieldSpell.counters !== "object") {
    fieldSpell.counters = {};
  }
  fieldSpell.counters.dragon_peak = Number(fieldSpell.counters.dragon_peak || 0) + 1;
  return true;
}

export function applyDragonSimulatedBattleRewards(context = {}) {
  const state = context.state || {};
  const bot = context.bot || state.bot || {};
  const opponent = context.opponent || state.player || {};
  const summary = context.summary || {};
  const battlePlan = context.battlePlan || {};
  const attacker =
    battlePlan.attackerCard ||
    (Number.isInteger(battlePlan.attackerIndex)
      ? bot.field?.[battlePlan.attackerIndex]
      : null);
  if (!isFaceupDragon(attacker)) return [];

  const rewards = [];
  const destroyedOpponent = getDestroyedOpponentMonsters(summary);
  if (destroyedOpponent.length > 0 && addJaggedCounter(bot.fieldSpell)) {
    rewards.push("Jagged Peak counter");
  }

  if (attacker.name === "Volcanic Extreme Dragon" && battlePlan.targetIndex != null) {
    const burn = 600;
    opponent.lp = Math.max(0, Number(opponent.lp || 0) - burn);
    summary.damage = Number(summary.damage || 0) + burn;
    rewards.push("Volcanic battle burn");
  }

  if (attacker.name === "Rainbow Cosmic Dragon" && destroyedOpponent.length > 0) {
    const heal = destroyedOpponent.reduce(
      (sum, card) => sum + Math.max(0, Number(card.baseAtk ?? card.atk ?? 0)),
      0,
    );
    if (heal > 0) {
      bot.lp = Number(bot.lp || 0) + heal;
      rewards.push("Rainbow battle heal");
    }
  }

  if (attacker.name === "Purified Crystal Dragon" && destroyedOpponent.length > 0) {
    const heal = destroyedOpponent.reduce(
      (sum, card) => sum + Math.max(0, Number(card.level || 0)) * 100,
      0,
    );
    if (heal > 0) {
      bot.lp = Number(bot.lp || 0) + heal;
      rewards.push("Purified battle heal");
    }
  }

  if (attacker.name === "Radiant Cosmic Dragon" && attacker.preventsBattleDamageToController) {
    rewards.push("Radiant battle damage shield");
  }

  return rewards;
}

export function scoreDragonBattleAttackCandidate(context = {}) {
  const attacker = context.attacker || {};
  const target = context.target || null;
  const bot = context.bot || {};
  const opponent = context.opponent || {};
  if (!isDragonMonster(attacker)) return 0;

  const targetDestroyed = Boolean(target) && context.targetSurvived === false;
  const attackerSurvived = context.attackerSurvived !== false;
  const lethalNow = context.lethalNow === true;
  const targetThreat = Math.max(
    0,
    Number(target?.atk || 0),
    Number(target?.def || 0),
  );
  let score = 0;

  if (lethalNow) score += 8;
  if (targetDestroyed) score += 2.5 + Math.min(2.5, targetThreat / 1200);
  if (attackerSurvived && target) score += 0.8;
  if (target && !attackerSurvived && !lethalNow) {
    score -= DRAGON_BOSS_NAMES.has(attacker.name) ? 4 : 2.5;
  }

  if (attacker.name === "Black Bull Dragon") {
    if (targetDestroyed) score += context.isSecondAttack ? 2.2 : 1.6;
    else if (!target && !lethalNow) score -= 1.5;
  }

  if (targetDestroyed && bot.fieldSpell?.name === "Jagged Peak of the Dragons") {
    const counters = Number(bot.fieldSpell.counters?.dragon_peak || 0);
    score += counters >= 4 ? 3.5 : 1.2;
  }

  if (attacker.name === "Volcanic Extreme Dragon" && target) {
    score += (opponent.lp || 0) <= 600 ? 4 : 1.5;
  }
  if (attacker.name === "Rainbow Cosmic Dragon" && targetDestroyed) {
    score += (bot.lp || 8000) <= 3500 ? 2.2 : 1.2;
  }
  if (attacker.name === "Purified Crystal Dragon" && targetDestroyed) {
    score += 0.8;
  }
  if (attacker.name === "Radiant Cosmic Dragon" && target) {
    score += attacker.preventsBattleDamageToController ? 1.3 : 0.6;
  }

  if (!target && !lethalNow) score += 0.4;
  return score;
}

function getPlanningBot(state = {}) {
  return state?.bot || {};
}

function getPlanningOpponent(state = {}) {
  return state?.player || {};
}

function countZone(cards = [], predicate = () => true) {
  return (cards || []).filter((card) => card && predicate(card)).length;
}

function getAllCards(player = {}) {
  return [
    ...getCards(player, "hand"),
    ...getCards(player, "field"),
    ...getCards(player, "graveyard"),
    ...getCards(player, "banished"),
    ...getCards(player, "spellTrap"),
    ...getCards(player, "fieldSpell"),
  ];
}

function countActiveCards(player = {}) {
  return (
    getCards(player, "hand").length +
    getCards(player, "field").length +
    getCards(player, "spellTrap").length +
    getCards(player, "fieldSpell").length
  );
}

function countOpponentBoardCards(player = {}) {
  return (
    getCards(player, "field").length +
    getCards(player, "spellTrap").length +
    getCards(player, "fieldSpell").length
  );
}

function getEffectiveAtk(card = {}) {
  return Number(card?.atk || 0) + Number(card?.tempAtkBoost || 0);
}

function getStrongestAtk(cards = []) {
  return (cards || []).reduce((max, card) => {
    if (!card || card.cardKind !== "monster" || card.isFacedown) return max;
    return Math.max(max, getEffectiveAtk(card), card.def || 0);
  }, 0);
}

function getFieldDragons(player = {}) {
  return getCards(player, "field").filter(isFaceupDragon);
}

function getUsefulGyResources(player = {}) {
  return getCards(player, "graveyard").filter(
    (card) => isDragonMonster(card) || card?.name === "Hellkite Roar",
  );
}

function countDragonCardsInZone(player = {}, zone) {
  return countZone(getCards(player, zone), isDragonMonster);
}

function hasProtectedDragon(player = {}) {
  return getCards(player, "field").some(
    (card) =>
      isFaceupDragon(card) &&
      (card.simBattleDestructionProtected ||
        card.simEffectDestructionProtected ||
        card.simProtectedUntilNextTurn ||
        card.battleIndestructible ||
        card.tempBattleIndestructible),
  );
}

function hasBossOnField(player = {}) {
  return getCards(player, "field").some(
    (card) =>
      isFaceupDragon(card) &&
      (DRAGON_BOSS_NAMES.has(card.name) ||
        card.monsterType === "fusion" ||
        card.monsterType === "ascension" ||
        isExtremeDragon(card)),
  );
}

function hasAction(sequence = [], name, type = null) {
  return (sequence || []).some(
    (action) =>
      (type == null || action?.type === type) &&
      (action?.cardName === name || action?.card?.name === name || action?.attackerName === name),
  );
}

function hasActionType(sequence = [], type) {
  return (sequence || []).some((action) => action?.type === type);
}

function sequenceCardNames(sequence = []) {
  return (sequence || [])
    .map((action) => action?.cardName || action?.card?.name || action?.attackerName)
    .filter(Boolean);
}

function sequenceMentions(sequence = [], name) {
  return sequenceCardNames(sequence).includes(name);
}

function finalHandGainedFromInitialGy(initialBot = {}, finalBot = {}, predicate = () => true) {
  const initialNames = new Set(
    getCards(initialBot, "graveyard")
      .filter(predicate)
      .map((card) => card.name),
  );
  return getCards(finalBot, "hand").some(
    (card) => initialNames.has(card?.name) && predicate(card),
  );
}

function findFinalFieldCard(player = {}, name) {
  return getCards(player, "field").find((card) => card?.name === name && !card.isFacedown);
}

function addLineMilestone(entries, label, score, detail = null) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric) || numeric === 0) return;
  entries.push(detail ? { label, score: numeric, detail } : { label, score: numeric });
}

function clampScore(score, min, max) {
  return Math.max(min, Math.min(max, Number(score) || 0));
}

function getSimulatedBattleSteps(sequence = []) {
  return (sequence || []).flatMap((action) => {
    if (action?.type !== "simulatedBattle") return [];
    if (Array.isArray(action.battleSteps) && action.battleSteps.length > 0) {
      return action.battleSteps;
    }
    return [action];
  });
}

export function scoreDragonLineMilestones(context = {}) {
  const initialState = context.initialState || {};
  const finalState = context.finalState || {};
  const sequence = Array.isArray(context.sequence) ? context.sequence : [];
  const initialBot = getPlanningBot(initialState);
  const finalBot = getPlanningBot(finalState);
  const initialOpponent = getPlanningOpponent(initialState);
  const finalOpponent = getPlanningOpponent(finalState);
  const milestones = [];

  const initialFieldDragons = getFieldDragons(initialBot);
  const finalFieldDragons = getFieldDragons(finalBot);
  const initialDragonFieldCount = initialFieldDragons.length;
  const finalDragonFieldCount = finalFieldDragons.length;
  const initialHand = getCards(initialBot, "hand");
  const finalHand = getCards(finalBot, "hand");
  const initialGraveyard = getCards(initialBot, "graveyard");
  const finalGraveyard = getCards(finalBot, "graveyard");
  const initialUsefulGy = getUsefulGyResources(initialBot).length;
  const finalUsefulGy = getUsefulGyResources(finalBot).length;
  const initialThreat = getStrongestAtk(getCards(initialOpponent, "field"));
  const finalThreat = getStrongestAtk(getCards(finalOpponent, "field"));
  const threatReduced = Math.max(0, initialThreat - finalThreat);
  const removedOpponentCards =
    countOpponentBoardCards(initialOpponent) - countOpponentBoardCards(finalOpponent);
  const initialActiveCards = countActiveCards(initialBot);
  const finalActiveCards = countActiveCards(finalBot);
  const activeCardDelta = finalActiveCards - initialActiveCards;
  const initialBanishedDragons = countDragonCardsInZone(initialBot, "banished");
  const finalBanishedDragons = countDragonCardsInZone(finalBot, "banished");
  const banishedDragonDelta = Math.max(0, finalBanishedDragons - initialBanishedDragons);
  const initialOpponentLp = initialOpponent.lp ?? 8000;
  const finalOpponentLp = finalOpponent.lp ?? initialOpponentLp;
  const damageDealt = Math.max(0, initialOpponentLp - finalOpponentLp);
  const finalStrongestOwnAtk = getStrongestAtk(getCards(finalBot, "field"));
  const finalHasProtection = hasProtectedDragon(finalBot);
  const finalHasBoss = hasBossOnField(finalBot);
  const finalHasRealThreat = finalHasBoss || finalStrongestOwnAtk >= 2400 || finalHasProtection;
  const battleSteps = getSimulatedBattleSteps(sequence);
  const battleDamage = battleSteps.reduce(
    (sum, step) => sum + Math.max(0, Number(step.damage || 0)),
    0,
  );
  const battleRemovedOpponentCards = battleSteps.reduce(
    (sum, step) =>
      sum +
      (step.destroyedCards || []).filter((card) => card?.owner === "opponent").length,
    0,
  );
  const battleLostSelfCards = battleSteps.reduce(
    (sum, step) =>
      sum +
      (step.destroyedCards || []).filter((card) => card?.owner === "self").length,
    0,
  );
  const battleRewards = battleSteps.flatMap((step) => step.rewardNames || []);
  const hasBattleBridge = battleSteps.length > 0;

  if (sequenceMentions(sequence, "Supreme Bahamut Dragon") || hasName(getAllCards(finalBot), "Supreme Bahamut Dragon")) {
    addLineMilestone(milestones, "Bahamut line excluded from Dragon plan", -100);
  }

  if (hasBattleBridge) {
    if (battleRemovedOpponentCards > 0) {
      addLineMilestone(
        milestones,
        "Battle: removed opposing monster",
        Math.min(5, battleRemovedOpponentCards * 2),
      );
    }
    if (battleDamage >= 1000) {
      addLineMilestone(
        milestones,
        "Battle: meaningful damage",
        Math.min(4, battleDamage / 1000),
      );
    }
    if (battleRewards.includes("Volcanic battle burn")) {
      addLineMilestone(milestones, "Battle: Volcanic burn mattered", 2.5);
    }
    if (battleRewards.includes("Jagged Peak counter")) {
      const finalCounters = Number(finalBot.fieldSpell?.counters?.dragon_peak || 0);
      addLineMilestone(
        milestones,
        finalCounters >= 5
          ? "Battle: Jagged Peak reached cashout"
          : "Battle: Jagged Peak gained counter",
        finalCounters >= 5 ? 4 : 1.5,
      );
    }
    if (
      battleRewards.includes("Rainbow battle heal") ||
      battleRewards.includes("Purified battle heal")
    ) {
      addLineMilestone(milestones, "Battle: Dragon gained LP", 1.8);
    }
    if (battleRewards.includes("Radiant battle damage shield")) {
      addLineMilestone(milestones, "Battle: Radiant avoided battle damage", 1.4);
    }
    if (
      battleSteps.length >= 2 &&
      battleSteps.some((step) => step.attackerName === "Black Bull Dragon")
    ) {
      addLineMilestone(milestones, "Battle: Black Bull cleared multiple attacks", 3);
    }
    if (battleLostSelfCards > 0 && battleRemovedOpponentCards === 0 && battleDamage < 1000) {
      addLineMilestone(milestones, "Penalty: weak battle bridge lost material", -4);
    }
  }

  if (
    hasAction(sequence, "Luminous Dragon", "handIgnition") &&
    initialDragonFieldCount === 0 &&
    finalDragonFieldCount > initialDragonFieldCount
  ) {
    addLineMilestone(milestones, "Engine: Luminous starter made free body", 4.5);
  }

  if (
    hasAction(sequence, "Voltaic Dragon", "handIgnition") &&
    findFinalFieldCard(finalBot, "Voltaic Dragon")
  ) {
    addLineMilestone(milestones, "Engine: Voltaic extender preserved Normal Summon", 3.5);
  }

  if (hasAction(sequence, "Armored Dragon", "summon")) {
    const finalHasArmoryTarget = finalHand.some(
      (card) => isDragonMonster(card) && (card.level || 0) <= 4 && ARMORY_SEARCH_NAMES.has(card.name),
    );
    if (finalHasArmoryTarget || getCards(finalBot, "deck").length < getCards(initialBot, "deck").length) {
      addLineMilestone(milestones, "Engine: Armored Dragon search resolved", 3.5);
    }
  }

  if (initialDragonFieldCount < 2 && finalDragonFieldCount >= 2) {
    addLineMilestone(milestones, "Engine: field reached 2 Dragons", 3);
  }
  if (initialDragonFieldCount < 3 && finalDragonFieldCount >= 3) {
    addLineMilestone(milestones, "Engine: field reached 3 Dragons", 2.5);
  }

  if (
    finalDragonFieldCount > initialDragonFieldCount &&
    (finalBot.summonCount || 0) <= (initialBot.summonCount || 0) &&
    ["handIgnition", "graveyardMonsterEffect", "graveyardSpellEffect", "spellTrapEffect", "fieldEffect"].some(
      (type) => hasActionType(sequence, type),
    )
  ) {
    addLineMilestone(milestones, "Engine: generated body before Normal Summon", 2.5);
  }

  if (
    [
      "Solar Eclipse Dragon",
      "Lunar Eclipse Dragon",
      "Stelya, Dragon Tamer",
      "Black Bull Dragon",
      "Grey Dragon",
    ].some((name) =>
      sequenceMentions(sequence, name),
    ) &&
    (damageDealt >= 800 ||
      finalHand.length >= initialHand.length ||
      finalHandGainedFromInitialGy(initialBot, finalBot, isDragonMonster))
  ) {
    addLineMilestone(milestones, "Engine: discard cost converted into value", 2.5);
  }

  const radiant = findFinalFieldCard(finalBot, "Radiant Cosmic Dragon");
  if (radiant) {
    addLineMilestone(milestones, "Payoff: Radiant Cosmic Dragon reached field", 8);
    if (finalHand.length >= initialHand.length - 1) {
      addLineMilestone(milestones, "Payoff: Radiant refund preserved hand", 2.5);
    }
    if (radiant.simFutureRevive) {
      addLineMilestone(milestones, "Payoff: Radiant death insurance online", 2);
    }
  }

  const techVoid = findFinalFieldCard(finalBot, "Tech-Void Dragon");
  if (techVoid && getEffectiveAtk(techVoid) >= 2800) {
    addLineMilestone(milestones, "Payoff: Tech-Void reached relevant ATK", 5);
  }

  if (
    sequenceMentions(sequence, "Extreme Dragon Awakening") &&
    finalFieldDragons.some((card) => (card.level || 0) >= 8)
  ) {
    addLineMilestone(milestones, "Payoff: Awakening converted bodies into boss", 5);
  }

  const purified = findFinalFieldCard(finalBot, "Purified Crystal Dragon");
  if (purified) {
    const hasFollowUp =
      finalHasProtection ||
      finalUsefulGy > 0 ||
      hasName(getCards(finalBot, "extraDeck"), "Rainbow Cosmic Dragon") ||
      finalHand.some((card) => PAYOFF_NAMES.has(card?.name));
    addLineMilestone(
      milestones,
      hasFollowUp
        ? "Payoff: Purified entered with follow-up"
        : "Payoff: Purified spent GY without follow-up",
      hasFollowUp ? 4 : -3,
    );
  }

  if (findFinalFieldCard(finalBot, "Rainbow Cosmic Dragon")) {
    addLineMilestone(
      milestones,
      finalHasProtection
        ? "Payoff: Rainbow Cosmic entered with protection"
        : "Payoff: Rainbow Cosmic entered",
      finalHasProtection ? 7 : 4,
    );
  }

  if (
    hasAction(sequence, "Jagged Peak of the Dragons", "fieldEffect") &&
    (finalDragonFieldCount > initialDragonFieldCount || finalHasBoss)
  ) {
    addLineMilestone(milestones, "Payoff: Jagged Peak summoned relevant Dragon", 5);
  }

  if (
    hasAction(sequence, "Abyssal Serpent Dragon", "monsterEffect") &&
    (removedOpponentCards > 0 || threatReduced >= 800)
  ) {
    addLineMilestone(milestones, "Control: Abyssal removed a threat", 4);
  }

  if (findFinalFieldCard(finalBot, "Darkness Dragon") && finalThreat > 0) {
    addLineMilestone(milestones, "Control: Darkness Dragon pressure available", 3);
  }

  for (const name of ["Fire Extreme Dragon", "Volcanic Extreme Dragon"]) {
    if (findFinalFieldCard(finalBot, name) && (damageDealt > 0 || finalThreat > 0 || finalHasProtection)) {
      addLineMilestone(milestones, `Control: ${name} reached suitable context`, 3);
    }
  }

  const initialSanctuarySet = getCards(initialBot, "spellTrap").some(
    (card) => card?.name === "Dragon Spirit Sanctuary",
  );
  const finalSanctuarySet = getCards(finalBot, "spellTrap").some(
    (card) => card?.name === "Dragon Spirit Sanctuary",
  );
  if (
    finalSanctuarySet &&
    finalDragonFieldCount > 0 &&
    (!initialSanctuarySet || initialDragonFieldCount === 0)
  ) {
    addLineMilestone(milestones, "Control: Dragon Spirit Sanctuary set with target", 2.5);
  }

  if (
    hasLuminousRecovery(getCards(finalBot, "field")) &&
    finalHandGainedFromInitialGy(initialBot, finalBot, isDragonMonster)
  ) {
    addLineMilestone(milestones, "Resource: Luminous recovered useful Dragon", 3);
  }

  if (hasAction(sequence, "Grey Dragon", "graveyardMonsterEffect")) {
    const greyMadeValue =
      damageDealt >= 800 ||
      finalDragonFieldCount > initialDragonFieldCount ||
      finalHandGainedFromInitialGy(initialBot, finalBot, (card) =>
        isDragonMonster(card) && card.name !== "Grey Dragon",
      );
    addLineMilestone(
      milestones,
      greyMadeValue
        ? "Resource: Grey traded discard into hand"
        : "Penalty: Grey loop without payoff",
      greyMadeValue ? 2.5 : -3,
    );
  }

  if (
    hasAction(sequence, "Black Bull Dragon", "graveyardMonsterEffect") &&
    finalHand.some((card) => isDragonMonster(card) && (card.level || 0) >= 7 && (card.level || 0) <= 8)
  ) {
    addLineMilestone(milestones, "Resource: Black Bull found Level 7/8 Dragon", 3);
  }

  if (
    sequenceMentions(sequence, "Hellkite Dragon") &&
    finalFieldDragons.some((card) => initialGraveyard.some((entry) => entry?.name === card.name))
  ) {
    addLineMilestone(milestones, "Resource: Hellkite recycled Dragon from GY", 3);
  }

  const boneflame = findFinalFieldCard(finalBot, "Boneflame Dragon");
  if (boneflame && getEffectiveAtk(boneflame) >= 2500) {
    addLineMilestone(milestones, "Resource: Boneflame became meaningful attacker", 3);
  }

  if (finalUsefulGy >= 2 && finalUsefulGy >= Math.min(initialUsefulGy, 3)) {
    addLineMilestone(milestones, "Resource: useful GY follow-up preserved", 2);
  }

  if (banishedDragonDelta >= 3 && !finalHasBoss && !finalHasProtection && damageDealt < 1500) {
    addLineMilestone(milestones, "Penalty: banished critical GY resources early", -7);
  }

  if (
    hasAction(sequence, "Purified Crystal Dragon", "handIgnition") &&
    banishedDragonDelta >= 3 &&
    !finalHasProtection &&
    finalUsefulGy === 0
  ) {
    addLineMilestone(milestones, "Penalty: Purified consumed GY without protection", -6);
  }

  if (
    radiant &&
    initialUsefulGy >= 4 &&
    finalUsefulGy <= initialUsefulGy - 4 &&
    !radiant.simFutureRevive
  ) {
    addLineMilestone(milestones, "Penalty: Radiant emptied needed GY follow-up", -3);
  }

  if (getCards(finalBot, "field").length >= 5 && !finalHasRealThreat) {
    addLineMilestone(milestones, "Penalty: field locked without real threat", -5);
  }

  if (
    hasAction(sequence, "Polymerization", "spell") &&
    techVoid &&
    !radiant &&
    hasRadiantCosmicMaterials([...initialHand, ...getCards(initialBot, "field")])
  ) {
    addLineMilestone(milestones, "Penalty: Polymerization chose inferior fusion over Radiant", -3);
  }

  if (
    sequenceMentions(sequence, "Extreme Dragon Awakening") &&
    finalFieldDragons.some((card) => (card.level || 0) >= 8 && getEffectiveAtk(card) < 2500) &&
    initialThreat >= 2200
  ) {
    addLineMilestone(milestones, "Penalty: Awakening target did not answer pressure", -3);
  }

  if (
    finalDragonFieldCount === 0 &&
    finalHand.length >= 3 &&
    getCards(finalOpponent, "field").length > 0
  ) {
    addLineMilestone(milestones, "Penalty: ended with dead hand and no field", -5);
  }

  if (sequence.length >= 4 && !finalHasBoss && removedOpponentCards <= 0 && damageDealt < 1000) {
    addLineMilestone(milestones, "Penalty: long Dragon line without payoff", -3);
  }

  if (removedOpponentCards > 0) {
    addLineMilestone(milestones, "Control: removed opposing cards", Math.min(5, removedOpponentCards * 2));
  }
  if (threatReduced >= 800) {
    addLineMilestone(milestones, "Control: reduced top battle threat", Math.min(4, threatReduced / 700));
  }
  if (damageDealt >= 1500) {
    addLineMilestone(milestones, "Pressure: meaningful damage dealt", Math.min(4, damageDealt / 1000));
  }
  if (activeCardDelta <= -3 && !finalHasBoss && removedOpponentCards <= 0) {
    addLineMilestone(milestones, "Penalty: spent many cards without payoff", -4);
  }

  const rawScore = milestones.reduce((sum, entry) => sum + entry.score, 0);
  const cap = context.profile?.critical ? 22 : 16;
  const scoreDelta = clampScore(rawScore, -18, cap);
  const ordered = milestones
    .slice()
    .sort((a, b) => {
      const abs = Math.abs(b.score) - Math.abs(a.score);
      if (abs !== 0) return abs;
      return b.score - a.score;
    });

  return {
    scoreDelta,
    milestones: ordered,
    lineImpact: {
      initialDragonFieldCount,
      finalDragonFieldCount,
      removedOpponentCards,
      threatReduced,
      damageDealt,
      initialUsefulGy,
      finalUsefulGy,
      banishedDragonDelta,
    },
  };
}

function sumDragonAtk(player = {}) {
  return getFieldDragons(player).reduce(
    (sum, card) => sum + Math.max(0, getEffectiveAtk(card)),
    0,
  );
}

function scoreBossQuality(player = {}) {
  let score = 0;
  for (const card of getFieldDragons(player)) {
    let value = 0;
    if (card.name === "Rainbow Cosmic Dragon") value = 7;
    else if (card.name === "Radiant Cosmic Dragon") value = 6.5;
    else if (card.name === "Tech-Void Dragon") value = 5.2;
    else if (card.name === "Purified Crystal Dragon") value = 4.5;
    else if (card.name === "Black Bull Dragon") value = 4;
    else if (isExtremeDragon(card)) value = 3.8;
    else if (card.monsterType === "fusion" || card.monsterType === "ascension") value = 4;

    if (value > 0) {
      value += Math.min(1.5, Math.max(0, getEffectiveAtk(card) - 2500) / 1200);
      if (card.simFutureRevive) value += 0.8;
      if (card.simMultiAttackPressure && !card.cannotAttackThisTurn) value += 0.8;
      score = Math.max(score, value);
    }
  }
  return Math.min(8, score);
}

function countProtectedDragons(player = {}) {
  return getFieldDragons(player).filter(
    (card) =>
      card.simBattleDestructionProtected ||
      card.simEffectDestructionProtected ||
      card.simProtectedUntilNextTurn ||
      card.battleIndestructible ||
      card.tempBattleIndestructible ||
      card.preventsBattleDamageToController,
  ).length;
}

function hasHandFollowUp(player = {}) {
  return getCards(player, "hand").some(
    (card) =>
      PAYOFF_NAMES.has(card?.name) ||
      card?.name === "Call of the Haunted" ||
      card?.name === "Dragon Spirit Sanctuary" ||
      card?.name === "Luminous Dragon" ||
      card?.name === "Solar Eclipse Dragon" ||
      card?.name === "Lunar Eclipse Dragon" ||
      card?.name === "Stelya, Dragon Tamer" ||
      card?.name === "Voltaic Dragon" ||
      card?.name === "Grey Dragon",
  );
}

function hasGraveyardFollowUp(player = {}) {
  const graveyard = getCards(player, "graveyard");
  if (graveyard.some((card) => card?.name === "Solar Eclipse Dragon")) return true;
  if (graveyard.some((card) => card?.name === "Lunar Eclipse Dragon")) return true;
  if (graveyard.some((card) => card?.name === "Stelya, Dragon Tamer")) return true;
  if (graveyard.some((card) => card?.name === "Grey Dragon")) return true;
  if (graveyard.some((card) => card?.name === "Black Bull Dragon")) return true;
  if (graveyard.some((card) => card?.name === "Hellkite Roar")) return true;
  if (graveyard.some((card) => card?.name === "Rainbow Cosmic Dragon")) return true;
  if (graveyard.some((card) => card?.name === "Radiant Cosmic Dragon")) return true;
  return countDragonMonsters(graveyard) >= 2;
}

function scoreJaggedSetup(player = {}) {
  const fieldSpell = player.fieldSpell;
  if (fieldSpell?.name !== "Jagged Peak of the Dragons") return 0;
  const counters = fieldSpell.counters?.dragon_peak || 0;
  return 1.4 + Math.min(3.2, counters * 0.45);
}

function scorePurifiedRainbowSetup(player = {}) {
  const graveyardDragonCount = countDragonCardsInZone(player, "graveyard");
  const hasPurified =
    hasName(getCards(player, "hand"), "Purified Crystal Dragon") ||
    hasName(getCards(player, "field"), "Purified Crystal Dragon");
  const hasRainbow =
    hasName(getCards(player, "extraDeck"), "Rainbow Cosmic Dragon") ||
    hasName(getCards(player, "field"), "Rainbow Cosmic Dragon");
  let score = 0;
  if (hasPurified && graveyardDragonCount >= 3) score += 2.5;
  else if (hasPurified && graveyardDragonCount >= 2) score += 1;
  if (hasRainbow && hasPurified) score += 1.5;
  if (findFinalFieldCard(player, "Rainbow Cosmic Dragon") && hasProtectedDragon(player)) {
    score += 2;
  }
  return Math.min(5, score);
}

function scoreTerminalAdjustments(context = {}) {
  const initialBot = getPlanningBot(context.initialState || {});
  const finalBot = getPlanningBot(context.finalState || {});
  const initialOpponent = getPlanningOpponent(context.initialState || {});
  const finalOpponent = getPlanningOpponent(context.finalState || {});

  const finalFieldDragons = getFieldDragons(finalBot);
  const totalAtk = sumDragonAtk(finalBot);
  const dragonCount = finalFieldDragons.length;
  const protectedCount = countProtectedDragons(finalBot);
  const removedOpponentCards =
    countOpponentBoardCards(initialOpponent) - countOpponentBoardCards(finalOpponent);
  const initialThreat = getStrongestAtk(getCards(initialOpponent, "field"));
  const finalThreat = getStrongestAtk(getCards(finalOpponent, "field"));
  const threatReduced = Math.max(0, initialThreat - finalThreat);
  const damageDealt = Math.max(0, (initialOpponent.lp ?? 8000) - (finalOpponent.lp ?? 8000));
  const handCount = getCards(finalBot, "hand").length;
  const usefulGyCount = getUsefulGyResources(finalBot).length;
  const extremeGyCount = getCards(finalBot, "graveyard").filter(isExtremeDragon).length;

  let score = 0;

  score += Math.min(5, totalAtk / 1200);
  score += Math.min(4, dragonCount * 1.1);
  score += scoreBossQuality(finalBot);
  score += Math.min(4, protectedCount * 1.6);
  score += Math.min(4.5, Math.max(0, removedOpponentCards) * 1.5 + threatReduced / 900);
  score += Math.min(3.5, damageDealt / 1200);
  score += Math.min(3, handCount * 0.55);
  score += Math.min(3, usefulGyCount * 0.45);
  score += Math.min(1.2, extremeGyCount * 0.35);
  score += scoreJaggedSetup(finalBot);
  score += scorePurifiedRainbowSetup(finalBot);
  if (hasHandFollowUp(finalBot)) score += 1.8;
  if (hasGraveyardFollowUp(finalBot)) score += 1.4;

  if (dragonCount === 0 && countOpponentBoardCards(finalOpponent) > 0) score -= 6;
  if (handCount === 0 && dragonCount === 0) score -= 4;
  if (getCards(finalBot, "field").length >= 5 && !hasBossOnField(finalBot) && totalAtk < 5000) {
    score -= 4;
  }
  if (usefulGyCount === 0 && !hasHandFollowUp(finalBot) && !hasBossOnField(finalBot)) {
    score -= 3;
  }
  if (finalThreat >= Math.max(2600, totalAtk) && !hasProtectedDragon(finalBot)) {
    score -= 3.5;
  }
  if ((finalBot.lp || 0) <= 2000 && finalThreat >= finalBot.lp) {
    score -= 5;
  }

  return score;
}

export function scoreDragonLineTerminal(context = {}) {
  const finalBot = getPlanningBot(context.finalState || {});
  const finalOpponent = getPlanningOpponent(context.finalState || {});
  if ((finalBot.lp || 0) <= 0) return -10000;
  if ((finalOpponent.lp || 0) <= 0) return 10000;

  const baseScore = Number(context.baseScore ?? context.finalScore ?? 0);
  const profile = context.profile || {};
  const critical = profile.critical || profile.mode === "critical";
  const milestoneCap = critical ? 18 : 12;
  const terminalCap = critical ? 12 : 8;
  const milestoneScore = clampScore(
    Number(context.milestoneScore || 0),
    -milestoneCap,
    milestoneCap,
  );
  const terminalScore = clampScore(
    scoreTerminalAdjustments(context),
    -terminalCap,
    terminalCap,
  );

  return baseScore + milestoneScore + terminalScore;
}

function actionLabel(action = {}) {
  if (!action) return "";
  if (action.type === "simulatedBattle") {
    if (Array.isArray(action.battleSteps) && action.battleSteps.length > 1) {
      const attacker = action.battleSteps[0]?.attackerName || action.attackerName || "attacker";
      const targets = action.battleSteps
        .map((step) => (step.direct ? "direct" : step.targetName || "target"))
        .filter(Boolean)
        .join(" + ");
      return `Battle ${attacker} > ${targets}`;
    }
    const target = action.direct ? "direct" : action.targetName || "target";
    return `Battle ${action.attackerName || "attacker"} > ${target}`;
  }
  return action.cardName || action.card?.name || action.name || action.type || "";
}

function compactActionStep(action = {}) {
  const label = actionLabel(action);
  if (!label) return "";
  if (action.type === "handIgnition") return `${label} hand effect`;
  if (action.type === "graveyardMonsterEffect" || action.type === "graveyardSpellEffect") {
    return `${label} GY effect`;
  }
  if (action.type === "spellTrapEffect" || action.type === "fieldEffect" || action.type === "monsterEffect") {
    return `${label} effect`;
  }
  if (action.type === "spell") return `activate ${label}`;
  if (action.type === "summon") return `summon ${label}`;
  if (action.type === "set_spell_trap") return `set ${label}`;
  return label;
}

function milestoneLabel(entry = {}) {
  if (typeof entry === "string") return entry;
  return entry.label || entry.name || entry.reason || "";
}

function finalFieldNames(player = {}) {
  return getCards(player, "field")
    .filter((card) => card && !card.isFacedown)
    .map((card) => card.name);
}

function findFinalPayoffName(finalBot = {}, preferred = []) {
  const fieldNames = finalFieldNames(finalBot);
  for (const name of preferred) {
    if (fieldNames.includes(name)) return name;
  }
  const boss = getCards(finalBot, "field").find(
    (card) =>
      isFaceupDragon(card) &&
      (DRAGON_BOSS_NAMES.has(card.name) ||
        card.monsterType === "fusion" ||
        card.monsterType === "ascension" ||
        isExtremeDragon(card)),
  );
  return boss?.name || null;
}

function inferDragonLineHeadline(context = {}) {
  const sequence = Array.isArray(context.sequence) ? context.sequence : [];
  const initialBot = getPlanningBot(context.initialState || {});
  const finalBot = getPlanningBot(context.finalState || {});
  const milestones = (context.milestones || []).map(milestoneLabel).filter(Boolean);
  const usedNames = sequenceCardNames(sequence);
  const hasUsed = (name, type = null) =>
    sequence.some(
      (action) =>
        (type == null || action?.type === type) &&
        (action?.cardName === name || action?.card?.name === name),
    );
  const finalPayoff = findFinalPayoffName(finalBot, [
    "Rainbow Cosmic Dragon",
    "Radiant Cosmic Dragon",
    "Tech-Void Dragon",
    "Fire Extreme Dragon",
    "Volcanic Extreme Dragon",
    "Black Bull Dragon",
    "Purified Crystal Dragon",
  ]);

  if (usedNames.includes("Supreme Bahamut Dragon")) {
    return "Bahamut line rejected";
  }

  const battleSteps = getSimulatedBattleSteps(sequence);
  if (battleSteps.length > 0) {
    const rewards = battleSteps.flatMap((step) => step.rewardNames || []);
    if (battleSteps.some((step) => step.attackerName === "Black Bull Dragon")) {
      return battleSteps.length >= 2
        ? "Black Bull clears battle path into Main 2"
        : "Black Bull pressure opens Main 2";
    }
    if (rewards.includes("Jagged Peak counter")) {
      return "Battle charges Jagged Peak for Main 2";
    }
    if (battleSteps.some((step) => step.attackerName === "Volcanic Extreme Dragon")) {
      return "Volcanic battle burn into Main 2";
    }
    if (battleSteps.some((step) => step.attackerName === "Radiant Cosmic Dragon")) {
      return "Radiant Cosmic safe battle bridge";
    }
    return "Battle bridge opens Main 2";
  }

  if (
    hasUsed("Luminous Dragon", "handIgnition") &&
    hasUsed("Voltaic Dragon", "handIgnition")
  ) {
    return "Luminous starter into Voltaic extender";
  }

  if (hasUsed("Extreme Dragon Awakening")) {
    const target =
      findFinalPayoffName(finalBot, [
        "Fire Extreme Dragon",
        "Volcanic Extreme Dragon",
        "Black Bull Dragon",
        "Purified Crystal Dragon",
        "Radiant Cosmic Dragon",
      ]) || "Level 8+ Dragon";
    return `Awakening converts two Dragons into ${target}`;
  }

  if (hasUsed("Polymerization", "spell")) {
    if (finalFieldNames(finalBot).includes("Radiant Cosmic Dragon")) {
      return "Radiant fusion line with LIGHT material";
    }
    if (finalFieldNames(finalBot).includes("Tech-Void Dragon")) {
      return "Tech-Void fusion pressure line";
    }
    return "Polymerization line toward Dragon fusion";
  }

  if (hasUsed("Converging Stars", "spell")) {
    const highLevel = getCards(finalBot, "field").find(
      (card) => isFaceupDragon(card) && (card.level || 0) >= 5,
    );
    return highLevel
      ? `Converging unlocks ${highLevel.name}`
      : "Converging unlocks high-level Dragon";
  }

  if (hasUsed("Jagged Peak of the Dragons", "fieldEffect")) {
    return finalPayoff
      ? `Jagged Peak cashout for ${finalPayoff}`
      : "Jagged Peak cashout for boss Dragon";
  }

  if (hasUsed("Purified Crystal Dragon")) {
    if (
      finalFieldNames(finalBot).includes("Rainbow Cosmic Dragon") ||
      hasName(getCards(finalBot, "extraDeck"), "Rainbow Cosmic Dragon") ||
      milestones.some((entry) => entry.includes("Rainbow"))
    ) {
      return "Purified setup toward Rainbow";
    }
    return "Purified Crystal Dragon setup line";
  }

  const controlNames = ["Majestic Silver Dragon", "Volcanic Extreme Dragon", "Fire Extreme Dragon"];
  const controlUsed = controlNames.filter((name) => usedNames.includes(name));
  if (controlUsed.length > 0) {
    return `Control line with ${controlUsed.join("/")}`;
  }

  if (usedNames.includes("Volcanic Extreme Dragon")) {
    return "Volcanic Extreme Dragon burn/control line";
  }

  if (usedNames.includes("Hellkite Roar") && hasName(getCards(finalBot, "hand"), "Jagged Peak of the Dragons")) {
    return "Hellkite Roar retrieves Jagged Peak";
  }

  if (usedNames.includes("Hellkite Dragon")) {
    return "Hellkite Dragon recycles GY Dragon";
  }

  if (usedNames.includes("Black Bull Dragon")) {
    return "Black Bull pressure and Level 7/8 access";
  }

  if (
    usedNames.includes("Solar Eclipse Dragon") ||
    usedNames.includes("Lunar Eclipse Dragon") ||
    usedNames.includes("Stelya, Dragon Tamer") ||
    usedNames.includes("Grey Dragon")
  ) {
    return "GY resource loop into board presence";
  }

  if (hasUsed("Armored Dragon", "summon")) {
    return "Armored Dragon starter search";
  }

  if (hasUsed("Luminescent Dragon", "summon")) {
    return "Luminescent Dragon recursion starter";
  }

  if (usedNames.includes("Call of the Haunted")) {
    return "Call of the Haunted defensive setup";
  }

  if (hasActionType(sequence, "set_spell_trap")) {
    const setAction = sequence.find((action) => action?.type === "set_spell_trap");
    return `${actionLabel(setAction)} defensive setup`;
  }

  if (
    hasUsed("Luminous Dragon", "handIgnition") &&
    (getCards(initialBot, "field").length === 0 || getCards(finalBot, "field").length > getCards(initialBot, "field").length)
  ) {
    return "Luminous starter creates first Dragon";
  }

  if (finalPayoff) return `Dragon line reaches ${finalPayoff}`;
  if (milestones.length > 0) return milestones[0];
  const firstStep = actionLabel(sequence[0]);
  return firstStep ? `${firstStep} setup line` : "Dragon setup line";
}

export function describeDragonPlannedLine(context = {}) {
  const sequence = Array.isArray(context.sequence) ? context.sequence : [];
  if (!sequence.length) return "Dragon planner: no actionable line";

  const headline = inferDragonLineHeadline(context);
  const steps = sequence
    .slice(0, 5)
    .map(compactActionStep)
    .filter(Boolean);
  const milestoneText = (context.milestones || [])
    .map(milestoneLabel)
    .filter(Boolean)
    .slice(0, 3)
    .join("; ");

  const pathText = steps.length ? ` | ${steps.join(" -> ")}` : "";
  const milestonesText = milestoneText ? ` | ${milestoneText}` : "";
  return `Dragon planner: ${headline}${pathText}${milestonesText}`;
}

export function buildDragonPlanningProfile(analysis = {}, context = {}) {
  const game = context.game || analysis.game || {};
  const player = getPlayer(analysis, context);
  const opponent = getOpponent(analysis, context);
  const hand = getAnalysisCards(analysis, player, "hand");
  const field = getAnalysisCards(analysis, player, "field");
  const graveyard = getAnalysisCards(analysis, player, "graveyard");
  const spellTrap = getAnalysisCards(analysis, player, "spellTrap");
  const deck = getCards(player, "deck");
  const extraDeck = getCards(player, "extraDeck");
  const fieldSpell = analysis.fieldSpell || player.fieldSpell || null;
  const opponentField = analysis.oppField || opponent.field || [];
  const opponentBackrow =
    analysis.oppBackrow ??
    (opponent.spellTrap || []).length +
      (opponent.fieldSpell ? 1 : 0);
  const phase = String(analysis.phase || game.phase || "main1").toLowerCase();
  const manual = game?.turnLineSearchEnabled === true;
  const dragonState = analysis.dragonState || {};
  const reasons = [];

  if (
    dragonState.hasSolarInHand &&
    (dragonState.hasLunarInDeck || dragonState.hasLunarInHand) &&
    dragonState.opt?.solarHand?.canUse !== false
  ) {
    reasons.push("Eclipse starter live");
  }
  if (
    (dragonState.hasLunarInHand || dragonState.hasLunarInGY) &&
    dragonState.hasUsefulLunarDiscard &&
    dragonState.lunarDeckTargets?.length > 0
  ) {
    reasons.push("Lunar search has discard and Deck target");
  }
  if (
    (dragonState.hasStelyaInHand || dragonState.hasStelyaInGY) &&
    dragonState.hasDragonFieldBodyForStelya
  ) {
    reasons.push("Stelya bridge live");
  }
  if (dragonState.hasTwoDragonsForAwakening) {
    reasons.push("Awakening has two Dragon bodies");
  }
  if (dragonState.gyResources?.length > 0) {
    reasons.push("Dragon GY follow-up available");
  }

  if (hasName(hand, "Luminous Dragon") && hasName(hand, "Voltaic Dragon")) {
    reasons.push("Luminous + Voltaic starter");
  }
  if (hasName(hand, "Luminous Dragon") && hasName(hand, "Extreme Dragon Awakening")) {
    reasons.push("Luminous + Awakening starter");
  }
  if (hasName(hand, "Polymerization")) {
    const fusionCards = [...hand, ...field];
    if (hasRadiantCosmicMaterials(fusionCards) || hasTechVoidMaterials(fusionCards)) {
      reasons.push("Polymerization has Radiant/Tech materials");
    }
  }
  if (hasName(hand, "Converging Stars") && hasHighLevelDragon(hand)) {
    reasons.push("Converging Stars can reduce high-level Dragon");
  }
  if (
    (
      hasName(hand, "Extreme Dragon Awakening") ||
      spellTrap.some(
        (card) => card?.name === "Extreme Dragon Awakening" && !card.isFacedown,
      )
    ) &&
    countFaceupDragons(field) >= 2 &&
    (hasGoodAwakeningTarget(hand) || hasGoodAwakeningTarget(deck))
  ) {
    reasons.push("Awakening has field costs and Level 8+ target");
  }
  if (hasPurifiedLine({ hand, field, graveyard, extraDeck, game, player })) {
    reasons.push("Purified Crystal Dragon line is live");
  }
  if (hasJaggedCashout(fieldSpell)) {
    reasons.push("Jagged Peak has 5+ counters");
  }
  if (hasHellkiteRoarToJagged({ graveyard, deck, fieldSpell })) {
    reasons.push("Hellkite Roar can access Jagged Peak");
  }
  if (
    opponentThreatensLethal(player, opponentField) ||
    hasThreatResponse({ hand, field, graveyard, opponentField, opponentBackrow })
  ) {
    reasons.push("Dragon removal/protection response is relevant");
  }
  if (hasBlackBullPressure({ hand, graveyard, deck, opponent })) {
    reasons.push("Black Bull pressure line is live");
  }

  const main1Phase = phase === "main1" || phase === "main";
  const blackBullBattlePlan = hasBlackBullBattlePlan({ field, opponentField });
  const battleBridge =
    main1Phase &&
    (
      hasDirectLethal({ field, opponent }) ||
      hasBattleRemoval({ field, opponentField }) ||
      blackBullBattlePlan ||
      hasJaggedBattleCounterPlan({ field, opponentField, fieldSpell }) ||
      hasNamedBattlePlan({ field, opponentField }, "Volcanic Extreme Dragon") ||
      hasNamedBattlePlan({ field, opponentField }, "Rainbow Cosmic Dragon") ||
      hasNamedBattlePlan({ field, opponentField }, "Purified Crystal Dragon") ||
      hasRadiantSafeBattle({ field, opponentField }) ||
      hasBattleMain2Payoff({ fieldSpell, spellTrap, hand, field, deck })
    );
  if (battleBridge) {
    if (blackBullBattlePlan) {
      reasons.push("Black Bull can convert battle into Main 2");
    } else if (hasJaggedBattleCounterPlan({ field, opponentField, fieldSpell })) {
      reasons.push("Battle can charge Jagged Peak for Main 2");
    } else {
      reasons.push("Dragon battle bridge has Main 2 value");
    }
  }

  const enabled = manual || reasons.length > 0;
  const longLine = hasLongLuminousPayoff({ hand, field, deck, graveyard });
  const requestedTurnMode = game?.turnLineSearchTurnMode;
  const battleStepLimit = blackBullBattlePlan ? 2 : 1;
  const maxDepth = phase.includes("main2") ? 3 : longLine ? 5 : 4;

  return {
    ...DEFAULT_PROFILE,
    enabled,
    mode: manual && reasons.length === 0 ? "manual" : enabled ? "critical" : "off",
    turnMode: requestedTurnMode || (battleBridge ? "mainBattleMain2" : "mainOnly"),
    battleStepLimit,
    beamWidth: Number.isFinite(game?.turnLineSearchBeamWidth)
      ? game.turnLineSearchBeamWidth
      : DEFAULT_PROFILE.beamWidth,
    maxDepth: Number.isFinite(game?.turnLineSearchMaxDepth)
      ? game.turnLineSearchMaxDepth
      : maxDepth,
    nodeBudget: Number.isFinite(game?.turnLineSearchNodeBudget)
      ? game.turnLineSearchNodeBudget
      : DEFAULT_PROFILE.nodeBudget + (battleBridge ? 40 : 0),
    candidateLimit: Number.isFinite(game?.turnLineSearchCandidateLimit)
      ? game.turnLineSearchCandidateLimit
      : DEFAULT_PROFILE.candidateLimit,
    reasons,
    critical: reasons.length > 0,
  };
}
