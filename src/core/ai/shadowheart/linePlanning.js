import {
  getEffectiveAtk,
  getStrongestBattleThreat,
} from "../common/cardStats.js";
import { getCounterCount } from "../common/counters.js";
import {
  isShadowHeart,
  isShadowHeartByName,
} from "./knowledge.js";

const SH = {
  covenant: "Shadow-Heart Covenant",
  cathedral: "Shadow-Heart Cathedral",
  valley: "Darkness Valley",
  poly: "Polymerization",
  infusion: "Shadow-Heart Infusion",
  voidMage: "Shadow-Heart Void Mage",
  imp: "Shadow-Heart Imp",
  gecko: "Shadow-Heart Gecko",
  eel: "Shadow-Heart Abyssal Eel",
  specter: "Shadow-Heart Specter",
  coward: "Shadow-Heart Coward",
  purge: "Shadow-Heart Purge",
  rage: "Shadow-Heart Rage",
  battleHymn: "Shadow-Heart Battle Hymn",
  scale: "Shadow-Heart Scale Dragon",
  arctroth: "Shadow-Heart Demon Arctroth",
  arctrothPursuer: "Shadow-Heart Arctroth Pursuer",
  devastation: "Shadow-Heart Devastation Dragon",
  deathWyrm: "Shadow-Heart Death Wyrm",
  leviathan: "Shadow-Heart Leviathan",
  demonDragon: "Shadow-Heart Demon Dragon",
  warlord: "Shadow-Heart Warlord",
  shadowHeartEquip: "The Shadow Heart",
};

const BOSS_NAMES = new Set([
  SH.scale,
  SH.arctroth,
  SH.deathWyrm,
  SH.leviathan,
  SH.demonDragon,
  SH.warlord,
  SH.arctrothPursuer,
  SH.devastation,
]);

const PREMIUM_NAMES = new Set([
  SH.scale,
  SH.arctroth,
  SH.deathWyrm,
  SH.leviathan,
  SH.demonDragon,
  SH.warlord,
  SH.arctrothPursuer,
  SH.devastation,
]);

const ENGINE_NAMES = new Set([
  SH.covenant,
  SH.cathedral,
  SH.valley,
  SH.voidMage,
  SH.imp,
  SH.gecko,
  SH.eel,
  SH.specter,
  SH.infusion,
  SH.shadowHeartEquip,
]);

function nameOf(cardOrName) {
  if (!cardOrName) return null;
  return typeof cardOrName === "string" ? cardOrName : cardOrName.name || null;
}

function getBotState(state) {
  return state?.bot || state?.player || {};
}

function getOpponentState(state) {
  if (state?.bot) return state.player || state.opponent || {};
  return state?.opponent || {};
}

function getCards(player, zone) {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return Array.isArray(player[zone]) ? player[zone].filter(Boolean) : [];
}

function getAnalysisCards(analysis, zone) {
  if (Array.isArray(analysis?.[zone])) return analysis[zone].filter(Boolean);
  return getCards(analysis?.player || analysis?.bot, zone);
}

function hasName(cards = [], name) {
  return (cards || []).some((card) => nameOf(card) === name);
}

function hasAnyName(cards = [], names = []) {
  return (cards || []).some((card) => names.includes(nameOf(card)));
}

function isShadowHeartCard(card) {
  return isShadowHeart(card) || isShadowHeartByName(nameOf(card));
}

function countOpponentCards(player) {
  return (
    getCards(player, "field").length +
    getCards(player, "spellTrap").length +
    getCards(player, "fieldSpell").length
  );
}

function countShadowHeartMonsters(cards = []) {
  return (cards || []).filter(
    (card) => card?.cardKind === "monster" && isShadowHeartCard(card),
  ).length;
}

function countBosses(cards = []) {
  return (cards || []).filter((card) => BOSS_NAMES.has(nameOf(card))).length;
}

function getAttackDamage(field = []) {
  return (field || []).reduce((sum, card) => {
    if (!card || card.cardKind !== "monster") return sum;
    if (card.isFacedown || card.position === "defense") return sum;
    if (card.cannotAttackThisTurn) return sum;
    return sum + Math.max(0, getEffectiveAtk(card));
  }, 0);
}

function isMain1Phase(phase) {
  const normalized = String(phase || "main1").toLowerCase();
  return normalized === "main1" || normalized === "main";
}

function getBattleTargetStat(card) {
  if (!card || card.cardKind !== "monster") return 0;
  if (card.isFacedown) return 1500;
  return card.position === "defense"
    ? Number(card.def || 0) + Number(card.tempDefBoost || 0)
    : getEffectiveAtk(card);
}

function isReadyBattleAttacker(card) {
  return (
    card &&
    card.cardKind === "monster" &&
    isShadowHeartCard(card) &&
    !card.isFacedown &&
    card.position !== "defense" &&
    !card.cannotAttackThisTurn &&
    !card.hasAttacked &&
    getEffectiveAtk(card) > 0
  );
}

function hasCurrentBattlePayoff(analysis = {}) {
  const field = getAnalysisCards(analysis, "field");
  const oppField = analysis.oppField || analysis.opponent?.field || [];
  const attackers = field.filter(isReadyBattleAttacker);
  if (attackers.length === 0) return false;
  const opponentLp = Number(analysis.oppLp || analysis.oppLP || 0);
  const totalDirectDamage = attackers.reduce(
    (sum, attacker) => sum + getEffectiveAtk(attacker),
    0,
  );
  if (opponentLp > 0 && totalDirectDamage >= opponentLp) return true;

  return attackers.some((attacker) => {
    const atk = getEffectiveAtk(attacker);
    return (oppField || []).some((target) => {
      if (!target || target.cardKind !== "monster") return false;
      const targetStat = getBattleTargetStat(target);
      return atk > targetStat && targetStat >= 1200;
    });
  });
}

function hasCurrentCathedralDamagePayoff(analysis = {}) {
  const field = getAnalysisCards(analysis, "field");
  const oppField = analysis.oppField || analysis.opponent?.field || [];
  if (oppField.length > 0) return false;
  return field
    .filter(isReadyBattleAttacker)
    .some((attacker) => getEffectiveAtk(attacker) >= 500);
}

function hasAccessibleBattlePayoff(analysis = {}) {
  const hand = getAnalysisCards(analysis, "hand");
  const field = getAnalysisCards(analysis, "field");
  const oppField = analysis.oppField || analysis.opponent?.field || [];
  const opponentLp = Number(analysis.oppLp || analysis.oppLP || 0);
  const summonableAttackers = hand.filter(
    (card) =>
      card?.cardKind === "monster" &&
      isShadowHeartCard(card) &&
      (analysis.summonAvailable !== false || hasName(field, SH.imp)),
  );
  const hasCombatSpell =
    hasName(hand, SH.battleHymn) ||
    hasName(hand, SH.rage) ||
    hasName(hand, SH.purge);
  const strongestPotentialAtk = Math.max(
    0,
    ...summonableAttackers.map((card) => getEffectiveAtk(card)),
    ...field.filter(isShadowHeartCard).map((card) => getEffectiveAtk(card)),
  );
  const strongestOpponentBattle = getStrongestBattleThreat(oppField, {
    facedownValue: 1500,
  });

  if (opponentLp > 0 && strongestPotentialAtk >= opponentLp) return true;
  if (
    oppField.length > 0 &&
    strongestOpponentBattle >= 1600 &&
    strongestPotentialAtk > strongestOpponentBattle
  ) {
    return true;
  }
  if (hasCombatSpell && (oppField.length > 0 || opponentLp <= 3500)) {
    return true;
  }
  return false;
}

function hasCathedralBattleBridgePayoff(analysis = {}) {
  const hand = getAnalysisCards(analysis, "hand");
  const spellTrap = getAnalysisCards(analysis, "spellTrap");
  const cathedralReady =
    hasName(hand, SH.cathedral) ||
    spellTrap.some(
      (card) => nameOf(card) === SH.cathedral && !card.isFacedown,
    );
  if (!cathedralReady) return false;
  if (hasCurrentCathedralDamagePayoff(analysis)) return true;
  return hasCurrentBattlePayoff(analysis) || hasAccessibleBattlePayoff(analysis);
}

function shouldUseShadowHeartBattleBridge(analysis = {}, context = {}) {
  const game = context.game || analysis.game || {};
  const phase = analysis.phase || game.phase || "main1";
  if (!isMain1Phase(phase)) return false;
  if (game.turnLineSearchTurnMode === "mainBattleMain2") return true;
  if (game.turnLineSearchTurnMode === "mainOnly") return false;

  if (hasCurrentBattlePayoff(analysis)) return true;
  if (hasCathedralBattleBridgePayoff(analysis)) return true;

  const opponentLp = Number(analysis.oppLp || analysis.oppLP || 0);
  if (opponentLp > 0 && opponentLp <= 2500 && hasAccessibleBattlePayoff(analysis)) {
    return true;
  }

  const oppStrongest = getStrongestBattleThreat(analysis.oppField || [], {
    facedownValue: 1500,
  });
  return oppStrongest >= 2200 && hasAccessibleBattlePayoff(analysis);
}

function opponentThreatensLethal(bot = {}, opponent = {}) {
  const lp = Number(bot?.lp || 0);
  if (lp <= 0) return true;
  return getAttackDamage(getCards(opponent, "field")) >= lp;
}

function getAnalysisOpponentThreatensLethal(analysis = {}) {
  const player = analysis.player || analysis.bot || {};
  const opponent = analysis.opponent || {
    field: analysis.oppField || [],
  };
  return opponentThreatensLethal(
    { ...player, lp: analysis.lp ?? player.lp },
    opponent,
  );
}

function fieldSpellName(source = {}) {
  return nameOf(source.fieldSpell) || nameOf(source.player?.fieldSpell);
}

function hasCovenantLine(analysis = {}) {
  const hand = getAnalysisCards(analysis, "hand");
  if (!hasName(hand, SH.covenant)) return false;
  const controlledCards =
    getAnalysisCards(analysis, "field").length +
    getAnalysisCards(analysis, "spellTrap").length +
    (fieldSpellName(analysis) ? 1 : 0);
  return controlledCards === 0 && (analysis.lp || 0) > 800;
}

function hasVoidMageLine(analysis = {}) {
  const hand = getAnalysisCards(analysis, "hand");
  const deck = getAnalysisCards(analysis, "deck");
  return (
    analysis.summonAvailable !== false &&
    hasName(hand, SH.voidMage) &&
    deck.some(
      (card) =>
        isShadowHeartCard(card) &&
        (card.cardKind === "spell" || card.cardKind === "trap"),
    )
  );
}

function hasImpLine(analysis = {}) {
  const hand = getAnalysisCards(analysis, "hand");
  return (
    analysis.summonAvailable !== false &&
    hasName(hand, SH.imp) &&
    hand.some(
      (card) =>
        nameOf(card) !== SH.imp &&
        card?.cardKind === "monster" &&
        isShadowHeartCard(card) &&
        (card.level || 0) <= 4,
    )
  );
}

function hasGeckoLine(analysis = {}) {
  const hand = getAnalysisCards(analysis, "hand");
  const field = getAnalysisCards(analysis, "field");
  const deck = getAnalysisCards(analysis, "deck");
  const geckoAccessible =
    hasName(hand, SH.gecko) ||
    hasName(field, SH.gecko) ||
    (hasName(hand, SH.imp) && hasName(hand, SH.gecko));
  return (
    geckoAccessible &&
    deck.some(
      (card) =>
        card?.cardKind === "monster" &&
        isShadowHeartCard(card) &&
        (card.level || 0) >= 8,
    )
  );
}

function getCathedralCounters(card) {
  return getCounterCount(card, "judgment_marker");
}

function hasCathedralLine(analysis = {}) {
  const hand = getAnalysisCards(analysis, "hand");
  const spellTrap = getAnalysisCards(analysis, "spellTrap");
  const deck = getAnalysisCards(analysis, "deck");
  if (hasName(hand, SH.cathedral)) return true;
  const cathedral = spellTrap.find((card) => nameOf(card) === SH.cathedral);
  if (!cathedral) return false;
  const limit = getCathedralCounters(cathedral) * 500;
  return (
    limit > 0 &&
    deck.some(
      (card) =>
        card?.cardKind === "monster" &&
        isShadowHeartCard(card) &&
        Number(card.atk || 0) <= limit,
    )
  );
}

function hasInfusionLine(analysis = {}) {
  const hand = getAnalysisCards(analysis, "hand");
  const graveyard = getAnalysisCards(analysis, "graveyard");
  if (!hasName(hand, SH.infusion) || hand.length < 3) return false;
  return (
    graveyard.some((card) => card?.cardKind === "monster" && isShadowHeartCard(card)) ||
    hand.some(
      (card) =>
        nameOf(card) !== SH.infusion &&
        card?.cardKind === "monster" &&
        isShadowHeartCard(card),
    )
  );
}

function hasFusionLine(analysis = {}) {
  const hand = getAnalysisCards(analysis, "hand");
  const field = getAnalysisCards(analysis, "field");
  const allCards = [...hand, ...field];
  if (!hasName(hand, SH.poly)) return false;
  const shMonsters = allCards.filter(
    (card) => card?.cardKind === "monster" && isShadowHeartCard(card),
  );
  const hasScale = hasName(shMonsters, SH.scale);
  const hasLevel8 = shMonsters.some(
    (card) => nameOf(card) !== SH.scale && (card.level || 0) >= 8,
  );
  return shMonsters.length >= 2 || (hasScale && hasLevel8);
}

function hasPurgeLine(analysis = {}) {
  const hand = getAnalysisCards(analysis, "hand");
  const discardAvailable = hand.some((card) => isShadowHeartCard(card));
  const faceUpOpponents = (analysis.oppField || []).filter(
    (card) => card?.cardKind === "monster" && !card.isFacedown,
  );
  return discardAvailable && faceUpOpponents.length > 0;
}

function hasLeviathanBridge(analysis = {}) {
  const hand = getAnalysisCards(analysis, "hand");
  const field = getAnalysisCards(analysis, "field");
  return hasName(hand, SH.leviathan) && (hasName(hand, SH.eel) || hasName(field, SH.eel));
}

function hasBossAccess(analysis = {}) {
  const hand = getAnalysisCards(analysis, "hand");
  const field = getAnalysisCards(analysis, "field");
  const tributeBodies = field.filter(
    (card) => card?.cardKind === "monster" && !card.isFacedown,
  ).length;
  if (
    analysis.summonAvailable !== false &&
    tributeBodies >= 2 &&
    hasAnyName(hand, [SH.scale, SH.arctroth, SH.deathWyrm])
  ) {
    return true;
  }
  return hasName(hand, SH.leviathan) && hasName(field, SH.eel);
}

function hasVisibleConversionPayoff(analysis = {}) {
  const bestFinisher = (analysis.finisherPlans || [])[0];
  if ((bestFinisher?.score100 || 0) >= 70) return true;
  if ((analysis.availableCombos || []).some((combo) => (combo?.priority || 0) >= 13)) {
    return true;
  }
  return (
    hasFusionLine(analysis) ||
    hasInfusionLine(analysis) ||
    hasBossAccess(analysis) ||
    hasCathedralLine(analysis)
  );
}

function hasStarterAccess(analysis = {}) {
  return (
    hasCovenantLine(analysis) ||
    hasVoidMageLine(analysis) ||
    hasImpLine(analysis) ||
    hasGeckoLine(analysis) ||
    hasInfusionLine(analysis) ||
    hasCathedralLine(analysis)
  );
}

function sequenceUses(sequence = [], predicate) {
  return (sequence || []).some((action) => predicate(action || {}));
}

function sequenceCardNames(sequence = []) {
  return (sequence || [])
    .map((action) => action?.card?.name || action?.cardName || action?.attackerName)
    .filter(Boolean);
}

function addMilestone(state, label, score) {
  if (!Number.isFinite(score) || score === 0) return;
  state.score += score;
  state.milestones.push(`${score > 0 ? "+" : "-"} ${label}`);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hasRealPayoff({ finalBot, finalOpponent, initialOpponent }) {
  return (
    countBosses(getCards(finalBot, "field")) > 0 ||
    countOpponentCards(initialOpponent) > countOpponentCards(finalOpponent) ||
    getCards(finalBot, "field").some((card) => ENGINE_NAMES.has(nameOf(card)))
  );
}

function getActionLabel(action = {}) {
  if (action.type === "simulatedBattle") {
    const target = action.direct ? "direct" : action.targetName || "target";
    return `${action.attackerName || "attacker"} attacks ${target}`;
  }
  return action.card?.name || action.cardName || action.name || action.type || "action";
}

function getAllPlayerCards(player = {}) {
  return [
    ...getCards(player, "hand"),
    ...getCards(player, "field"),
    ...getCards(player, "graveyard"),
    ...getCards(player, "spellTrap"),
    ...getCards(player, "fieldSpell"),
  ];
}

function countNamedCards(cards = [], name) {
  return (cards || []).filter((card) => nameOf(card) === name).length;
}

function countCardsByNames(cards = [], names = new Set()) {
  return (cards || []).filter((card) => names.has(nameOf(card))).length;
}

function countShadowHeartCards(cards = []) {
  return (cards || []).filter(isShadowHeartCard).length;
}

function countEnginePieces(player = {}) {
  return countCardsByNames(
    [
      ...getCards(player, "field"),
      ...getCards(player, "spellTrap"),
      ...getCards(player, "fieldSpell"),
    ],
    ENGINE_NAMES,
  );
}

function countUsefulGyResources(player = {}) {
  return getCards(player, "graveyard").filter(
    (card) => isShadowHeartCard(card) && card?.cardKind === "monster",
  ).length;
}

function getTotalAttackPower(field = []) {
  return (field || []).reduce((sum, card) => {
    if (!card || card.cardKind !== "monster" || card.isFacedown) return sum;
    if (card.position === "defense" || card.cannotAttackThisTurn) return sum;
    return sum + Math.max(0, getEffectiveAtk(card));
  }, 0);
}

function hasFollowUp(player = {}) {
  return (
    countShadowHeartCards(getCards(player, "hand")) > 0 ||
    countUsefulGyResources(player) > 0 ||
    countEnginePieces(player) > 0
  );
}

function hasHandFollowUp(player = {}) {
  return countShadowHeartCards(getCards(player, "hand")) > 0;
}

function countReadyThreats(field = []) {
  return (field || []).filter((card) => {
    if (!card || card.cardKind !== "monster" || card.isFacedown) return false;
    if (card.position === "defense" || card.cannotAttackThisTurn) return false;
    return BOSS_NAMES.has(nameOf(card)) || getEffectiveAtk(card) >= 2000;
  }).length;
}

function getFieldAttackers(field = []) {
  return (field || []).filter(
    (card) =>
      card?.cardKind === "monster" &&
      !card.isFacedown &&
      card.position !== "defense" &&
      !card.cannotAttackThisTurn,
  );
}

function hasActiveCathedralWithCounters(player = {}) {
  return getCards(player, "spellTrap").some(
    (card) => nameOf(card) === SH.cathedral && getCathedralCounters(card) > 0,
  );
}

function hasValleyWithRelevantAttacker(player = {}) {
  if (fieldSpellName(player) !== SH.valley) return false;
  return getFieldAttackers(getCards(player, "field")).some(
    (card) => isShadowHeartCard(card) && getEffectiveAtk(card) >= 1800,
  );
}

function hasOpponentBackrowEngine(opponent = {}) {
  return (
    getCards(opponent, "spellTrap").length > 0 ||
    getCards(opponent, "fieldSpell").length > 0
  );
}

function usesFusionOrTribute(sequence = [], usedNames = []) {
  if (usedNames.includes(SH.poly)) return true;
  return (sequence || []).some((action) => {
    const actionName = action?.cardName || action?.card?.name;
    if (action?.type === "fusion" || action?.type === "ascension") return true;
    if (action?.type !== "summon") return false;
    return BOSS_NAMES.has(actionName) || (action?.tributeCount || 0) > 0;
  });
}

function countSequenceName(sequence = [], name) {
  return sequenceCardNames(sequence).filter((entry) => entry === name).length;
}

function lineUsedAny(sequence = [], names = []) {
  const used = sequenceCardNames(sequence);
  return names.some((name) => used.includes(name));
}

function getLineImpact(context = {}) {
  const initialBot = context.initialBot;
  const finalBot = context.finalBot;
  const initialOpponent = context.initialOpponent;
  const finalOpponent = context.finalOpponent;
  const finalField = getCards(finalBot, "field");
  const initialField = getCards(initialBot, "field");
  const finalOpponentField = getCards(finalOpponent, "field");
  const initialOpponentField = getCards(initialOpponent, "field");
  const removedOpponentCards =
    countOpponentCards(initialOpponent) - countOpponentCards(finalOpponent);
  const initialThreat = getStrongestBattleThreat(initialOpponentField, {
    facedownValue: 1500,
  });
  const finalThreat = getStrongestBattleThreat(finalOpponentField, {
    facedownValue: 1500,
  });
  const initialLethal = opponentThreatensLethal(initialBot, initialOpponent);
  const finalLethal = opponentThreatensLethal(finalBot, finalOpponent);
  const finalAttackPower = getTotalAttackPower(finalField);
  const initialAttackPower = getTotalAttackPower(initialField);
  const finalBossCount = countBosses(finalField);
  const initialBossCount = countBosses(initialField);
  const finalShMonsters = countShadowHeartMonsters(finalField);
  const initialShMonsters = countShadowHeartMonsters(initialField);
  const finalEnginePieces = countEnginePieces(finalBot);
  const initialEnginePieces = countEnginePieces(initialBot);
  const finalGyResources = countUsefulGyResources(finalBot);
  const initialGyResources = countUsefulGyResources(initialBot);
  const simulatedBattles = (context.sequence || []).filter(
    (action) => action?.type === "simulatedBattle",
  );
  const simulatedBattleDamage = simulatedBattles.reduce(
    (sum, action) => sum + Math.max(0, Number(action.damage || 0)),
    0,
  );
  const simulatedBattleRemovedOpponent = simulatedBattles.reduce(
    (sum, action) =>
      sum +
      (action.destroyedCards || []).filter((entry) => entry?.owner === "opponent")
        .length,
    0,
  );
  const simulatedBattleLostSelf = simulatedBattles.reduce(
    (sum, action) =>
      sum +
      (action.destroyedCards || []).filter((entry) => entry?.owner === "self")
        .length,
    0,
  );
  const simulatedBattleRewards = simulatedBattles.flatMap((action) =>
    Array.isArray(action.rewardNames) ? action.rewardNames : [],
  );

  return {
    initialField,
    finalField,
    initialOpponentField,
    finalOpponentField,
    initialNames: new Set(initialField.map(nameOf)),
    finalNames: new Set(finalField.map(nameOf)),
    removedOpponentCards,
    initialThreat,
    finalThreat,
    threatReduced: Math.max(0, initialThreat - finalThreat),
    initialLethal,
    finalLethal,
    finalAttackPower,
    initialAttackPower,
    attackPowerDelta: finalAttackPower - initialAttackPower,
    finalBossCount,
    initialBossCount,
    finalShMonsters,
    initialShMonsters,
    fieldDelta: finalShMonsters - initialShMonsters,
    finalEnginePieces,
    initialEnginePieces,
    engineDelta: finalEnginePieces - initialEnginePieces,
    finalGyResources,
    initialGyResources,
    gyResourceDelta: finalGyResources - initialGyResources,
    finalHasFollowUp: hasFollowUp(finalBot),
    finalOpponentCards: countOpponentCards(finalOpponent),
    initialOpponentCards: countOpponentCards(initialOpponent),
    simulatedBattles,
    simulatedBattleDamage,
    simulatedBattleRemovedOpponent,
    simulatedBattleLostSelf,
    simulatedBattleRewards,
  };
}

function scoreEngineMilestones(scoreState, context) {
  const { initialBot, finalBot, sequence, usedNames, impact } = context;
  const initialFieldSpell = fieldSpellName(initialBot);
  const finalFieldSpell = fieldSpellName(finalBot);
  const finalCathedral = getCards(finalBot, "spellTrap").find(
    (card) => nameOf(card) === SH.cathedral,
  );
  const initialCathedral = getCards(initialBot, "spellTrap").find(
    (card) => nameOf(card) === SH.cathedral,
  );
  const finalCathedralCounters = getCathedralCounters(finalCathedral);
  const initialCathedralCounters = getCathedralCounters(initialCathedral);
  const finalHand = getCards(finalBot, "hand");

  if (finalFieldSpell === SH.valley && initialFieldSpell !== SH.valley) {
    addMilestone(scoreState, "Engine: established Darkness Valley", 2.5);
  }
  if (finalCathedral && !initialCathedral) {
    addMilestone(scoreState, "Engine: established Cathedral", 2.5);
  }
  if (finalCathedral && finalCathedralCounters > initialCathedralCounters) {
    addMilestone(
      scoreState,
      "Engine: Cathedral gained counters",
      Math.min(2.5, (finalCathedralCounters - initialCathedralCounters) * 1.2),
    );
  }
  if (
    countSequenceName(sequence, SH.cathedral) > 0 &&
    !finalCathedral &&
    impact.fieldDelta > 0
  ) {
    addMilestone(scoreState, "Engine: Cathedral converted counters into body", 3.5);
  }
  if (
    usedNames.includes(SH.voidMage) &&
    finalHand.some((card) =>
      [SH.cathedral, SH.valley, SH.infusion, SH.purge, SH.shadowHeartEquip].includes(
        nameOf(card),
      ),
    )
  ) {
    addMilestone(scoreState, "Engine: Void Mage found relevant engine", 3);
  }
  if (usedNames.includes(SH.covenant) && finalHand.some(isShadowHeartCard)) {
    addMilestone(scoreState, "Engine: Covenant found a real line piece", 3);
  }
  if (impact.engineDelta > 0 && impact.finalShMonsters > 0) {
    addMilestone(scoreState, "Engine: active engine remains with board", 2);
  }
  if (impact.finalGyResources > impact.initialGyResources && impact.finalHasFollowUp) {
    addMilestone(scoreState, "Engine: GY resource bank improved", 1.5);
  }
}

function scoreConversionMilestones(scoreState, context) {
  const { initialBot, finalBot, sequence, usedNames, impact } = context;
  const finalHand = getCards(finalBot, "hand");
  const initialHand = getCards(initialBot, "hand");
  const finalAll = getAllPlayerCards(finalBot);
  const initialAll = getAllPlayerCards(initialBot);

  if (usedNames.includes(SH.infusion) && impact.fieldDelta > 0) {
    addMilestone(scoreState, "Conversion: Infusion revived useful material", 3.5);
  }
  if (
    usedNames.includes(SH.infusion) &&
    (impact.finalBossCount > impact.initialBossCount || impact.removedOpponentCards > 0)
  ) {
    addMilestone(scoreState, "Conversion: Infusion led into payoff", 2.5);
  }
  if (usedNames.includes(SH.imp) && impact.fieldDelta > 0) {
    addMilestone(scoreState, "Conversion: Imp turned hand into board", 3);
  }
  if (
    usedNames.includes(SH.gecko) &&
    finalHand.some((card) => (card?.level || 0) >= 8 && isShadowHeartCard(card))
  ) {
    addMilestone(scoreState, "Conversion: Gecko found Level 8 payoff", 3);
  }
  if (
    impact.finalBossCount > impact.initialBossCount &&
    (impact.initialShMonsters >= 2 || impact.fieldDelta > 0)
  ) {
    addMilestone(scoreState, "Conversion: small bodies became boss", 4);
  }
  if (usedNames.includes(SH.eel) && impact.finalNames.has(SH.leviathan)) {
    addMilestone(scoreState, "Conversion: Eel bridged into Leviathan", 3);
  }
  if (
    usedNames.includes(SH.specter) &&
    countShadowHeartCards(finalHand) > countShadowHeartCards(initialHand)
  ) {
    addMilestone(scoreState, "Conversion: Specter recovered resource", 2);
  }

  const premiumBefore = countCardsByNames(initialAll, PREMIUM_NAMES);
  const premiumAfter = countCardsByNames(finalAll, PREMIUM_NAMES);
  if (
    usedNames.includes(SH.infusion) &&
    premiumAfter < premiumBefore &&
    impact.finalBossCount <= impact.initialBossCount &&
    impact.removedOpponentCards <= 0
  ) {
    addMilestone(scoreState, "Conversion: premium discarded without payoff", -4);
  }
  if (usedNames.includes(SH.infusion) && impact.fieldDelta <= 0) {
    addMilestone(scoreState, "Conversion: Infusion did not improve board", -3);
  }
  if (
    lineUsedAny(sequence, [SH.imp, SH.gecko]) &&
    impact.fieldDelta <= 0 &&
    impact.finalBossCount <= impact.initialBossCount
  ) {
    addMilestone(scoreState, "Conversion: extender entered without payoff", -2.5);
  }
}

function scoreBossRemovalMilestones(scoreState, context) {
  const { usedNames, impact } = context;
  const reached = (name) => impact.finalNames.has(name) && !impact.initialNames.has(name);
  const stayedWithImpact = (name) =>
    impact.finalNames.has(name) &&
    impact.initialNames.has(name) &&
    (impact.removedOpponentCards > 0 || impact.threatReduced >= 500);

  if (reached(SH.demonDragon)) {
    addMilestone(scoreState, "Boss: Demon Dragon reached the board", 7);
  }
  if (reached(SH.warlord)) {
    addMilestone(scoreState, "Boss: Warlord reached the board", 5.5);
  }
  if (reached(SH.scale)) {
    addMilestone(scoreState, "Boss: Scale Dragon pressure established", 5);
  }
  if (reached(SH.arctroth)) {
    addMilestone(scoreState, "Boss: Demon Arctroth pressure established", 4.5);
  }
  if (reached(SH.deathWyrm)) {
    addMilestone(scoreState, "Boss: Death Wyrm recursion established", 3.5);
  }
  if (reached(SH.leviathan)) {
    addMilestone(scoreState, "Boss: Leviathan pressure established", 3.5);
  }
  if ([SH.demonDragon, SH.warlord, SH.scale, SH.arctroth].some(stayedWithImpact)) {
    addMilestone(scoreState, "Boss: existing boss converted pressure", 2);
  }
  if (impact.removedOpponentCards > 0) {
    addMilestone(
      scoreState,
      `Removal: removed ${impact.removedOpponentCards} opposing card${
        impact.removedOpponentCards > 1 ? "s" : ""
      }`,
      Math.min(7, impact.removedOpponentCards * 2.8),
    );
  }
  if (impact.threatReduced >= 500) {
    addMilestone(
      scoreState,
      "Removal: reduced opposing battle threat",
      Math.min(5.5, impact.threatReduced / 450),
    );
  }
  if (impact.initialLethal && !impact.finalLethal) {
    addMilestone(scoreState, "Removal: removed lethal threat", 7.5);
  }

  if (usedNames.includes(SH.poly) && impact.finalBossCount <= impact.initialBossCount) {
    addMilestone(scoreState, "Boss: Polymerization spent without boss", -5);
  }
  if (
    impact.finalBossCount > impact.initialBossCount &&
    impact.removedOpponentCards <= 0 &&
    impact.threatReduced < 500 &&
    impact.finalOpponentCards > 0 &&
    !impact.finalHasFollowUp
  ) {
    addMilestone(scoreState, "Boss: boss entered without impact or follow-up", -3);
  }
}

function scoreDamageClosingMilestones(scoreState, context) {
  const { initialBot, finalBot, finalOpponent, usedNames, impact } = context;
  const finalOpponentLp = Number(finalOpponent?.lp || 0);

  if (finalOpponentLp <= 0) {
    addMilestone(scoreState, "Closing: line produced lethal", 10);
    return;
  }
  if (impact.finalAttackPower >= finalOpponentLp && impact.finalOpponentField.length === 0) {
    addMilestone(scoreState, "Closing: opponent in lethal range", 5);
  }
  if (impact.attackPowerDelta >= 800) {
    addMilestone(scoreState, "Closing: attack pressure increased", 2);
  }
  if (
    usedNames.includes(SH.battleHymn) &&
    (impact.removedOpponentCards > 0 || impact.finalAttackPower >= finalOpponentLp)
  ) {
    addMilestone(scoreState, "Closing: Battle Hymn enabled pressure", 3);
  }
  if (
    usedNames.includes(SH.rage) &&
    (impact.finalNames.has(SH.scale) || impact.finalAttackPower >= finalOpponentLp)
  ) {
    addMilestone(scoreState, "Closing: Rage supported finisher", 3);
  }
  if (
    usedNames.includes(SH.purge) &&
    (impact.removedOpponentCards > 0 || impact.threatReduced >= 500)
  ) {
    addMilestone(scoreState, "Closing: Purge opened favorable combat", 3);
  }
  if (usedNames.includes(SH.purge) && impact.removedOpponentCards <= 0 && impact.threatReduced < 500) {
    addMilestone(scoreState, "Closing: Purge spent without clear payoff", -3);
  }
  if (
    lineUsedAny(context.sequence, [SH.battleHymn, SH.rage]) &&
    impact.removedOpponentCards <= 0 &&
    impact.attackPowerDelta < 500 &&
    finalOpponentLp >= (initialBot?.lp || 0)
  ) {
    addMilestone(scoreState, "Closing: combat spell spent without pressure", -3);
  }
  if (impact.finalLethal && (finalBot.lp || 0) <= 3000) {
    addMilestone(scoreState, "Closing: low LP still exposed to lethal", -6);
  }
}

function scoreBattleBridgeMilestones(scoreState, context) {
  const { impact, finalBot, sequence } = context;
  if (!impact.simulatedBattles || impact.simulatedBattles.length === 0) return;

  if (impact.simulatedBattleRemovedOpponent > 0) {
    addMilestone(
      scoreState,
      "Battle: removed opposing monster",
      Math.min(6, impact.simulatedBattleRemovedOpponent * 2.8),
    );
  }
  if (impact.simulatedBattleDamage >= 2000) {
    addMilestone(scoreState, "Battle: dealt decisive damage", 3.5);
  } else if (impact.simulatedBattleDamage >= 500) {
    addMilestone(scoreState, "Battle: dealt relevant damage", 1.5);
  }
  if (
    impact.simulatedBattleRewards.some((name) =>
      String(name || "").includes("Cathedral"),
    )
  ) {
    addMilestone(scoreState, "Battle: Cathedral gained counter", 2.5);
  }
  if (
    impact.simulatedBattleRewards.some((name) =>
      String(name || "").includes("Leviathan"),
    )
  ) {
    addMilestone(scoreState, "Battle: Leviathan converted combat into burn", 2);
  }

  if (
    impact.simulatedBattleLostSelf > 0 &&
    impact.simulatedBattleRemovedOpponent <= 0 &&
    Number(context.finalOpponent?.lp || 0) > 0
  ) {
    addMilestone(scoreState, "Battle: lost attacker without payoff", -5);
  }
  if (
    impact.simulatedBattleLostSelf > 0 &&
    !hasFollowUp(finalBot) &&
    Number(context.finalOpponent?.lp || 0) > 0
  ) {
    addMilestone(scoreState, "Battle: traded away last follow-up", -3.5);
  }
}

function scoreGlobalLinePenalties(scoreState, context) {
  const { initialBot, finalBot, finalOpponent, sequence, impact } = context;
  const finalField = getCards(finalBot, "field");
  const lineLength = sequence.filter((action) => action?.type !== "simulatedBattle").length;
  const finalHasEngine = impact.finalEnginePieces > 0;

  if (finalField.length === 0 && countOpponentCards(finalOpponent) > 0) {
    addMilestone(scoreState, "Risk: ended with empty field under pressure", -6);
  }
  if (
    lineLength >= 4 &&
    !hasRealPayoff({ finalBot, finalOpponent, initialOpponent: context.initialOpponent }) &&
    !finalHasEngine
  ) {
    addMilestone(scoreState, "Risk: long line without boss, removal or engine", -4);
  }
  const finalNames = new Set(finalField.map(nameOf));
  const premiumLost = getCards(initialBot, "field").filter(
    (card) => PREMIUM_NAMES.has(nameOf(card)) && !finalNames.has(nameOf(card)),
  );
  if (premiumLost.length > 0 && impact.removedOpponentCards <= 0 && impact.finalBossCount === 0) {
    addMilestone(scoreState, "Risk: premium monster spent without payoff", -4);
  }
}

function scoreTerminalQuality(context = {}) {
  const { initialBot, finalBot, finalOpponent, sequence, usedNames, impact } =
    context;
  const finalField = getCards(finalBot, "field");
  const finalHand = getCards(finalBot, "hand");
  const readyThreats = countReadyThreats(finalField);
  const bossCount = countBosses(finalField);
  const activeEngine = countEnginePieces(finalBot) > 0;
  let score = 0;

  if (bossCount > 0) score += Math.min(2.5, bossCount * 1.2);
  if (bossCount > 0 && activeEngine) score += 1.8;
  if (readyThreats >= 2) score += 1.8;
  if (!hasOpponentBackrowEngine(finalOpponent) && finalField.length > 0) {
    score += 0.8;
  }
  if (
    impact.finalAttackPower >= Number(finalOpponent?.lp || 0) &&
    impact.finalOpponentField.length === 0 &&
    finalOpponent?.lp > 0
  ) {
    score += 2.2;
  }
  if (impact.finalGyResources > 0) score += Math.min(1.6, impact.finalGyResources * 0.45);
  if (hasHandFollowUp(finalBot)) score += Math.min(1.4, finalHand.length * 0.35);
  if (hasActiveCathedralWithCounters(finalBot)) score += 1.2;
  if (hasValleyWithRelevantAttacker(finalBot)) score += 1.1;
  if (
    usesFusionOrTribute(sequence, usedNames) &&
    impact.finalBossCount > impact.initialBossCount &&
    hasFollowUp(finalBot)
  ) {
    score += 1.4;
  }
  if (
    impact.finalBossCount > impact.initialBossCount &&
    impact.finalShMonsters >= 1 &&
    impact.finalHasFollowUp &&
    getCards(initialBot, "field").length > finalField.length
  ) {
    score += 0.8;
  }

  return score;
}

function scoreTerminalRisk(context = {}) {
  const { initialBot, finalBot, finalOpponent, sequence, usedNames, impact } =
    context;
  const finalField = getCards(finalBot, "field");
  const finalHand = getCards(finalBot, "hand");
  const lineLength = sequence.filter((action) => action?.type !== "simulatedBattle").length;
  const finalAttackPressure = getAttackDamage(getCards(finalOpponent, "field"));
  const fusionOrTribute = usesFusionOrTribute(sequence, usedNames);
  let score = 0;

  if (finalHand.length === 0 && finalField.length === 0) score -= 7;
  if (finalField.length === 0 && finalAttackPressure > 0) score -= 6;
  if (opponentThreatensLethal(finalBot, finalOpponent) && (finalBot.lp || 0) <= 3000) {
    score -= 5;
  }
  if (
    impact.finalBossCount === 1 &&
    finalField.length === 1 &&
    !hasFollowUp(finalBot) &&
    countOpponentCards(finalOpponent) > 0
  ) {
    score -= 2.5;
  }
  if (
    impact.finalEnginePieces < impact.initialEnginePieces &&
    impact.removedOpponentCards <= 0 &&
    impact.finalBossCount <= impact.initialBossCount &&
    !impact.finalHasFollowUp
  ) {
    score -= 3.5;
  }
  if (
    fusionOrTribute &&
    getCards(initialBot, "field").length > finalField.length &&
    impact.finalBossCount <= impact.initialBossCount &&
    impact.removedOpponentCards <= 0 &&
    impact.initialLethal === impact.finalLethal
  ) {
    score -= 4;
  }
  if (
    lineLength >= 4 &&
    impact.removedOpponentCards <= 0 &&
    impact.finalBossCount <= impact.initialBossCount &&
    impact.engineDelta <= 0 &&
    impact.attackPowerDelta < 500
  ) {
    score -= 3;
  }

  return score;
}

function scoreTerminalAdjustments(context = {}) {
  return scoreTerminalQuality(context) + scoreTerminalRisk(context);
}

function getRetentionFloor(action = {}, analysis = {}) {
  const name = action.cardName || action.card?.name || null;
  const field = getAnalysisCards(analysis, "field");
  const hand = getAnalysisCards(analysis, "hand");
  const oppStrongest = getStrongestBattleThreat(analysis.oppField || [], {
    facedownValue: 1500,
  });
  const ownStrongest = getStrongestBattleThreat(field, { facedownValue: 1500 });
  const weakField = field.length === 0 || ownStrongest + 400 < oppStrongest;

  switch (name) {
    case SH.covenant:
      return hasCovenantLine(analysis)
        ? { minPriority: 18, reason: "retain live Covenant starter" }
        : null;
    case SH.poly:
      return hasFusionLine(analysis)
        ? { minPriority: 12.5, reason: "retain fusion conversion" }
        : null;
    case SH.infusion:
      return hasInfusionLine(analysis) && (weakField || hasFusionLine(analysis) || hasBossAccess(analysis))
        ? { minPriority: 10.5, reason: "retain Infusion conversion" }
        : null;
    case SH.cathedral:
      if (!hasCathedralLine(analysis)) return null;
      return {
        minPriority: action.type === "spellTrapEffect" ? 12 : 10.5,
        reason: "retain Cathedral engine",
      };
    case SH.valley:
      return !fieldSpellName(analysis) &&
        [...field, ...hand].some((card) => isShadowHeartCard(card))
        ? { minPriority: 11, reason: "retain Darkness Valley setup" }
        : null;
    case SH.voidMage:
      return hasVoidMageLine(analysis)
        ? { minPriority: 13.5, reason: "retain Void Mage search line" }
        : { minPriority: 11, reason: "retain Void Mage body/searcher" };
    case SH.imp:
      return hasImpLine(analysis)
        ? { minPriority: 11.5, reason: "retain Imp extender" }
        : null;
    case SH.gecko:
      return hasGeckoLine(analysis)
        ? { minPriority: 8.5, reason: "retain Gecko Level 8 access" }
        : null;
    case SH.eel:
      if (hasLeviathanBridge(analysis)) {
        return { minPriority: 10, reason: "retain Eel into Leviathan" };
      }
      return weakField ? { minPriority: 7.5, reason: "retain Eel pressure body" } : null;
    case SH.specter:
      return getAnalysisCards(analysis, "graveyard").some(
        (card) => isShadowHeartCard(card) && nameOf(card) !== SH.specter,
      ) || hasFusionLine(analysis) || hasBossAccess(analysis)
        ? { minPriority: 8, reason: "retain Specter resource body" }
        : null;
    case SH.purge:
      if (!hasPurgeLine(analysis)) return null;
      return oppStrongest >= 2200
        ? { minPriority: 11, reason: "retain Purge answer to threat" }
        : { minPriority: 8.5, reason: "retain Purge removal option" };
    case SH.shadowHeartEquip:
      return field.length === 0 && getAnalysisCards(analysis, "graveyard").some(
        (card) => card?.cardKind === "monster" && isShadowHeartCard(card),
      )
        ? { minPriority: 9, reason: "retain The Shadow Heart recovery" }
        : null;
    default:
      return null;
  }
}

export function applyShadowHeartCandidateRetention(actions = [], analysis = {}, context = {}) {
  if (!Array.isArray(actions) || actions.length === 0) return actions;
  const profile =
    context.profile || buildShadowHeartPlanningProfile(analysis, context);
  const active = context.isSimulatedState === true || profile?.enabled === true;
  if (!active) return actions;

  return actions.map((action) => {
    const floor = getRetentionFloor(action, analysis);
    if (!floor) return action;
    const priority = Number(action.priority || 0);
    if (priority >= floor.minPriority) return action;
    return {
      ...action,
      priority: floor.minPriority,
      retentionBonus: Number((floor.minPriority - priority).toFixed(2)),
      retentionReason: floor.reason,
    };
  });
}

export function buildShadowHeartPlanningProfile(analysis = {}, context = {}) {
  const game = context.game || analysis.game || {};
  const phase = String(analysis.phase || game.phase || "main1").toLowerCase();
  const manual = game?.turnLineSearchEnabled === true;
  const reasons = [];
  const field = getAnalysisCards(analysis, "field");
  const oppField = analysis.oppField || analysis.opponent?.field || [];
  const ownStrongest = getStrongestBattleThreat(field, { facedownValue: 1500 });
  const oppStrongest = getStrongestBattleThreat(oppField, { facedownValue: 1500 });
  const weakField = field.length === 0 || ownStrongest + 400 < oppStrongest;
  const underPressure = oppField.length > 0 || (analysis.lp || 8000) <= 4000;

  if (getAnalysisOpponentThreatensLethal(analysis)) {
    reasons.push("opponent threatens lethal");
  }
  if ((analysis.lp || 0) <= 3000 && oppField.length > 0) {
    reasons.push("low LP under pressure");
  }
  if (oppStrongest >= 2400 && weakField) {
    reasons.push("opponent controls superior threat");
  }
  if (weakField && underPressure && hasStarterAccess(analysis)) {
    reasons.push("weak field with Shadow-Heart starter");
  }
  if (hasCovenantLine(analysis)) {
    reasons.push("Covenant starter is live");
  }
  if (hasVisibleConversionPayoff(analysis)) {
    reasons.push("visible Shadow-Heart conversion payoff");
  }

  const enabled = manual || reasons.length > 0;
  const useBattleBridge =
    enabled && shouldUseShadowHeartBattleBridge(analysis, context);

  return {
    enabled,
    mode: enabled ? "critical" : "off",
    turnMode: useBattleBridge ? "mainBattleMain2" : "mainOnly",
    beamWidth: Number.isFinite(game.turnLineSearchBeamWidth)
      ? game.turnLineSearchBeamWidth
      : 3,
    maxDepth: phase.includes("main2") ? 3 : 4,
    nodeBudget: Number.isFinite(game.turnLineSearchNodeBudget)
      ? game.turnLineSearchNodeBudget
      : 200,
    candidateLimit: Number.isFinite(game.turnLineSearchCandidateLimit)
      ? game.turnLineSearchCandidateLimit
      : 8,
    reasons,
    critical: reasons.length > 0,
  };
}

function addCounter(card, counterType, amount = 1) {
  if (!card || amount <= 0) return 0;
  const current = getCounterCount(card, counterType);
  const next = current + amount;
  if (typeof card.addCounter === "function") {
    card.addCounter(counterType, amount);
  } else if (card.counters instanceof Map) {
    card.counters.set(counterType, next);
  } else {
    if (!card.counters || typeof card.counters !== "object") card.counters = {};
    card.counters[counterType] = next;
  }
  return next;
}

export function applyShadowHeartSimulatedBattleRewards({
  state,
  summary,
  bot,
} = {}) {
  const player = bot || state?.bot || {};
  const opponent = state?.player || {};
  const rewards = [];
  if (!summary) return rewards;

  const destroyedOpponentMonster = (summary.destroyedCards || []).some(
    (entry) => entry?.owner === "opponent" && entry?.cardKind === "monster",
  );
  const lostOwnMonster = (summary.destroyedCards || []).some(
    (entry) => entry?.owner === "self" && entry?.cardKind === "monster",
  );
  let opponentDamage = Math.max(0, Number(summary.damage || 0));

  if (summary.attackerName === SH.leviathan && destroyedOpponentMonster) {
    opponent.lp = Math.max(0, Number(opponent.lp || 0) - 500);
    opponentDamage += 500;
    summary.damage = Math.max(0, Number(summary.damage || 0)) + 500;
    rewards.push("Shadow-Heart Leviathan battle burn");
  }
  if (summary.attackerName === SH.leviathan && lostOwnMonster) {
    opponent.lp = Math.max(0, Number(opponent.lp || 0) - 800);
    opponentDamage += 800;
    summary.damage = Math.max(0, Number(summary.damage || 0)) + 800;
    rewards.push("Shadow-Heart Leviathan destruction burn");
  }

  if (opponentDamage >= 500) {
    const cathedrals = getCards(player, "spellTrap").filter(
      (card) => nameOf(card) === SH.cathedral && !card.isFacedown,
    );
    cathedrals.forEach((cathedral) => {
      addCounter(cathedral, "judgment_marker", 1);
      rewards.push("Shadow-Heart Cathedral counter");
    });
  }

  return rewards;
}

export function scoreShadowHeartBattleAttackCandidate(context = {}) {
  const {
    attacker,
    target,
    lethalNow = false,
    attackerSurvived = false,
    targetSurvived = false,
    bot,
  } = context;
  if (!attacker || !isShadowHeartCard(attacker)) return 0;

  const cathedralActive = getCards(bot, "spellTrap").some(
    (card) => nameOf(card) === SH.cathedral && !card.isFacedown,
  );
  const attackerAtk = getEffectiveAtk(attacker);
  const targetStat = target ? getBattleTargetStat(target) : 0;
  const destroysTarget = Boolean(target && !targetSurvived);
  let delta = 0;

  if (lethalNow) delta += 4;
  if (!target && attackerAtk >= 1500) delta += 0.7;
  if (destroysTarget && attackerSurvived) delta += 1.4;
  if (destroysTarget && BOSS_NAMES.has(nameOf(attacker))) delta += 0.8;
  if (cathedralActive && (destroysTarget || attackerAtk >= 500)) delta += 0.8;
  if (nameOf(attacker) === SH.leviathan && target) delta += 1.1;
  if (target && attackerAtk <= targetStat && !lethalNow) delta -= 2.2;
  if (!attackerSurvived && !lethalNow && PREMIUM_NAMES.has(nameOf(attacker))) {
    delta -= 1.8;
  }

  return delta;
}

export function scoreShadowHeartLineMilestones(context = {}) {
  const initialState = context.initialState || {};
  const finalState = context.finalState || {};
  const sequence = context.sequence || [];
  const initialBot = getBotState(initialState);
  const finalBot = getBotState(finalState);
  const initialOpponent = getOpponentState(initialState);
  const finalOpponent = getOpponentState(finalState);
  const scoreState = { score: 0, milestones: [] };
  const usedNames = sequenceCardNames(sequence);
  const impact = getLineImpact({
    initialBot,
    finalBot,
    initialOpponent,
    finalOpponent,
    sequence,
  });
  const scoringContext = {
    initialState,
    finalState,
    initialBot,
    finalBot,
    initialOpponent,
    finalOpponent,
    sequence,
    usedNames,
    impact,
  };

  scoreEngineMilestones(scoreState, scoringContext);
  scoreConversionMilestones(scoreState, scoringContext);
  scoreBossRemovalMilestones(scoreState, scoringContext);
  scoreDamageClosingMilestones(scoreState, scoringContext);
  scoreBattleBridgeMilestones(scoreState, scoringContext);
  scoreGlobalLinePenalties(scoreState, scoringContext);

  return {
    scoreDelta: scoreState.score,
    milestones: scoreState.milestones.slice(0, 10),
  };
}

export function scoreShadowHeartLineTerminal(context = {}) {
  const initialState = context.initialState || {};
  const finalState = context.finalState || {};
  const initialBot = getBotState(initialState);
  const finalBot = getBotState(finalState);
  if ((finalBot.lp || 0) <= 0) return -10000;

  const baseScore = Number(context.baseScore ?? context.finalScore ?? 0);
  const rawMilestoneScore = Number(context.milestoneScore || 0);
  const profile = context.profile || {};
  const cap = profile.critical || profile.mode === "critical" ? 12 : 8;
  const milestoneScore = clamp(rawMilestoneScore, -cap, cap);
  const initialOpponent = getOpponentState(initialState);
  const finalOpponent = getOpponentState(finalState);
  const sequence = context.sequence || [];
  const usedNames = sequenceCardNames(sequence);
  const impact = getLineImpact({
    initialBot,
    finalBot,
    initialOpponent,
    finalOpponent,
    sequence,
  });
  const terminalAdjustments = scoreTerminalAdjustments({
    initialBot,
    finalBot,
    initialOpponent,
    finalOpponent,
    sequence,
    usedNames,
    impact,
  });
  const terminalCap = profile.critical || profile.mode === "critical" ? 8 : 6;
  const terminalScore = clamp(terminalAdjustments, -terminalCap, terminalCap);

  return baseScore + milestoneScore + terminalScore;
}

export function describeShadowHeartPlannedLine(context = {}) {
  const sequence = context.sequence || [];
  const milestones = (context.milestones || []).slice(0, 4);
  const steps = sequence
    .slice(0, 5)
    .map(getActionLabel);
  const stepText =
    steps.length > 0
      ? steps.map((step, index) => `${index + 1}. ${step}`).join("\n")
      : "1. no action";
  const milestoneText =
    milestones.length > 0
      ? `\nMilestones:\n${milestones.join("\n")}`
      : "";
  const score = Number(context.finalScore ?? context.score ?? 0);
  const baseScore = Number(context.baseScore ?? 0);
  const milestoneScore = Number(context.milestoneScore ?? 0);
  const scoreText = Number.isFinite(score)
    ? `\nScore: ${score.toFixed(1)} (base ${baseScore.toFixed(1)}, milestones ${milestoneScore.toFixed(1)})`
    : "";
  const reasons = context.profile?.reasons || [];
  const reasonText =
    reasons.length > 0 ? `\nContext: ${reasons.slice(0, 3).join("; ")}` : "";
  return `Shadow-Heart planner:\n${stepText}${milestoneText}${scoreText}${reasonText}`;
}
