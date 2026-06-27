import {
  buildBloomrotPlanningProfile as buildBloomrotBattlePlanningProfile,
} from "./battle.js";
import {
  BLOOMROT_NAMES,
  buildBloomrotAnalysis,
  getSporeCount,
  isBloomrotMonster,
} from "./analysis.js";
import { getBloomrotCounterSpendSummary } from "./resourcePolicy.js";
import { evaluateBloomrotBoardBonus } from "./scoring.js";

const N = {
  SPORELING: "Bloomrot Sporeling",
  ROOTLING: "Bloomrot Rootling",
  MYCO_WEAVER: "Bloomrot Myco-Weaver",
  ROT_STAG: "Bloomrot Rot-Stag",
  CARRIONCAP: "Bloomrot Carrioncap",
  MOLDMENDER: "Bloomrot Moldmender",
  GRAVECAP_WIDOW: "Bloomrot Gravecap Widow",
  ANCIENT_HUSK: "Bloomrot Ancient Husk",
  SPORE_CLOUD: "Bloomrot Spore Cloud",
  FUNGAL_ARMOR: "Bloomrot Fungal Armor",
  OVERGROWTH: "Bloomrot Overgrowth",
  SUDDEN_GERMINATION: "Bloomrot Sudden Germination",
};

const STARTERS = new Set([
  N.SPORELING,
  N.MYCO_WEAVER,
  N.CARRIONCAP,
  N.MOLDMENDER,
  BLOOMROT_NAMES.LIVING_COLONY,
]);

const PAYOFFS = new Set([
  N.ROT_STAG,
  N.GRAVECAP_WIDOW,
  N.ANCIENT_HUSK,
  BLOOMROT_NAMES.HARVEST,
  BLOOMROT_NAMES.ROOT_NETWORK,
  BLOOMROT_NAMES.ROTTING_GROUND,
  BLOOMROT_NAMES.ANCIENT_MYCELIUM,
  BLOOMROT_NAMES.QUEEN,
  BLOOMROT_NAMES.DEVOURER,
]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function faceUp(card) {
  return card && card.isFacedown !== true;
}

function getBotState(state = {}) {
  return state.bot || state.player || {};
}

function getOpponentState(state = {}) {
  return state.player || state.opponent || {};
}

function getCards(player, zone) {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return asArray(player[zone]);
}

function hasName(cards = [], name) {
  return asArray(cards).some((card) => card?.name === name);
}

function countOpponentCards(player = {}) {
  return (
    getCards(player, "field").length +
    getCards(player, "spellTrap").length +
    (player.fieldSpell ? 1 : 0)
  );
}

function isBloomrotToken(card) {
  return card?.isToken === true || card?.name === BLOOMROT_NAMES.TOKEN;
}

function countFaceUpBloomrots(player = {}) {
  return getCards(player, "field").filter(
    (card) => isBloomrotMonster(card) && faceUp(card) && !isBloomrotToken(card),
  ).length;
}

function countTokens(player = {}) {
  return getCards(player, "field").filter(isBloomrotToken).length;
}

function buildStateAnalysis(state = {}) {
  const bot = getBotState(state);
  const opponent = getOpponentState(state);
  const baseAnalysis = {
    hand: getCards(bot, "hand"),
    field: getCards(bot, "field"),
    spellTrap: getCards(bot, "spellTrap"),
    fieldSpell: bot.fieldSpell || null,
    graveyard: getCards(bot, "graveyard"),
    deck: getCards(bot, "deck"),
    extraDeck: getCards(bot, "extraDeck"),
    lp: bot.lp || 8000,
    oppField: getCards(opponent, "field"),
    oppHand: getCards(opponent, "hand"),
    oppGraveyard: getCards(opponent, "graveyard"),
    oppSpellTrap: getCards(opponent, "spellTrap"),
    oppFieldSpell: opponent.fieldSpell || null,
    oppLp: opponent.lp || 8000,
    oppLP: opponent.lp || 8000,
    phase: state.phase || "main1",
    currentTurn: state.turnCounter || 1,
    player: bot,
    opponent,
    bot,
    game: state,
    summonAvailable: Number(bot.summonCount || 0) < 1,
    normalSummonsAvailable: Math.max(0, 1 - Number(bot.summonCount || 0)),
    isSimulatedState: state._isPerspectiveState === true,
  };
  return buildBloomrotAnalysis({
    bot,
    opponent,
    game: state,
    baseAnalysis,
  });
}

function actionName(action = {}) {
  return action.cardName || action.card?.name || action.name || action.sourceName || "";
}

function sequenceNames(sequence = []) {
  return asArray(sequence).map(actionName).filter(Boolean);
}

function sequenceUses(sequence = [], predicate) {
  return asArray(sequence).some(predicate);
}

function addMilestone(entries, label, score, detail = "") {
  if (!Number.isFinite(score) || score === 0) return;
  entries.push({ label, score, detail });
}

function thresholdCrossed(start, end, threshold) {
  return start < threshold && end >= threshold;
}

function thresholdBroken(start, end, threshold) {
  return start >= threshold && end < threshold;
}

function isUnderPressure(analysis = {}) {
  const opponentMonsters = asArray(analysis.opponentMonsters);
  const ownMonsters = asArray(analysis.field).filter((card) => card?.cardKind === "monster");
  return (
    opponentMonsters.length > ownMonsters.length ||
    (analysis.lp || analysis.player?.lp || 8000) <= 3500 ||
    opponentMonsters.some((card) => {
      const atk =
        Number(card?.atk || 0) +
        Number(card?.tempAtkBoost || 0) +
        Number(card?.equipAtkBonus || 0);
      return atk >= 2200;
    })
  );
}

function hasStarterAccess(analysis = {}) {
  const zones = [
    ...asArray(analysis.hand),
    ...asArray(analysis.field),
    ...asArray(analysis.spellTrap),
    analysis.fieldSpell,
  ].filter(Boolean);
  return zones.some((card) => STARTERS.has(card?.name));
}

function hasPayoffAccess(analysis = {}) {
  const zones = [
    ...asArray(analysis.hand),
    ...asArray(analysis.field),
    ...asArray(analysis.spellTrap),
    analysis.fieldSpell,
    ...asArray(analysis.extraDeck),
  ].filter(Boolean);
  return zones.some((card) => PAYOFFS.has(card?.name));
}

function canApproachThreshold(analysis = {}) {
  const total = Number(analysis.fieldSporeTotal || 0);
  if ([3, 4, 7].includes(total)) return true;
  if (total >= 2 && hasPayoffAccess(analysis)) return true;
  return hasStarterAccess(analysis) && asArray(analysis.opponentMonsters).some(faceUp);
}

function hasControlEngineSignal(analysis = {}) {
  return (
    analysis.hasLivingColonyActive ||
    analysis.hasRootNetworkActive ||
    analysis.hasRottingGroundActive ||
    hasName(analysis.hand, BLOOMROT_NAMES.LIVING_COLONY) ||
    hasName(analysis.spellTrap, BLOOMROT_NAMES.ROTTING_GROUND) ||
    hasName(analysis.spellTrap, BLOOMROT_NAMES.ROOT_NETWORK)
  );
}

function hasRemovalPayoff(analysis = {}) {
  return (
    (hasName(analysis.hand, BLOOMROT_NAMES.HARVEST) && (analysis.fieldSporeTotal || 0) >= 4) ||
    (hasName(analysis.hand, N.GRAVECAP_WIDOW) && asArray(analysis.opponentSporedMonsters).length > 0) ||
    asArray(analysis.opponentSporedMonsters4Plus).length > 0
  );
}

function hasExtraDeckSignal(analysis = {}) {
  return (
    analysis.queenReady ||
    analysis.devourerReady ||
    (analysis.hasQueenInExtra && (analysis.fieldSporeTotal || 0) >= 6) ||
    (analysis.hasDevourerInExtra && analysis.hasBloomrotToken && asArray(analysis.bloomrotFusionMaterialPool).length >= 3) ||
    (analysis.hasAncientMyceliumInExtra && asArray(analysis.faceUpBloomrotField).length > 0)
  );
}

export function buildBloomrotPlanningProfile(analysis = {}, context = {}) {
  const game = context.game || analysis.game || {};
  const battleProfile = buildBloomrotBattlePlanningProfile(analysis, context);
  const manual = game?.turnLineSearchEnabled === true;
  const reasons = [...asArray(battleProfile.reasons)];

  if (hasStarterAccess(analysis) && asArray(analysis.field).length === 0) {
    reasons.push("Bloomrot starter access");
  }
  if (canApproachThreshold(analysis)) reasons.push("Bloomrot threshold line available");
  if (hasControlEngineSignal(analysis)) reasons.push("Bloomrot control engine active/available");
  if (hasRemovalPayoff(analysis)) reasons.push("Bloomrot counter payoff available");
  if (hasExtraDeckSignal(analysis)) reasons.push("Bloomrot Extra Deck window");
  if (isUnderPressure(analysis)) reasons.push("Bloomrot defensive pressure");

  const enabled = manual || reasons.length > 0 || battleProfile.enabled === true;
  const battleBridge = battleProfile.turnMode === "mainBattleMain2";

  return {
    ...battleProfile,
    enabled,
    mode: manual && reasons.length === 0 ? "manual" : enabled ? "critical" : "off",
    turnMode:
      game?.turnLineSearchTurnMode ||
      (battleBridge ? "mainBattleMain2" : "mainOnly"),
    beamWidth: Number.isFinite(game?.turnLineSearchBeamWidth)
      ? game.turnLineSearchBeamWidth
      : 3,
    maxDepth: Number.isFinite(game?.turnLineSearchMaxDepth)
      ? game.turnLineSearchMaxDepth
      : String(analysis.phase || game.phase || "main1").toLowerCase().includes("main2")
        ? 3
        : 4,
    nodeBudget: Number.isFinite(game?.turnLineSearchNodeBudget)
      ? game.turnLineSearchNodeBudget
      : 220,
    candidateLimit: Number.isFinite(game?.turnLineSearchCandidateLimit)
      ? game.turnLineSearchCandidateLimit
      : 8,
    battleStepLimit: Number.isFinite(game?.turnLineSearchBattleStepLimit)
      ? game.turnLineSearchBattleStepLimit
      : battleProfile.battleStepLimit || 1,
    reasons,
    critical: reasons.length > 0 || battleProfile.critical === true,
  };
}

function lineHasRealPayoff({
  initialAnalysis,
  finalAnalysis,
  sequence,
  removedOpponentCards,
  finalBot,
} = {}) {
  if (removedOpponentCards > 0) return true;
  if ((finalAnalysis.fieldSporeTotal || 0) > (initialAnalysis.fieldSporeTotal || 0)) return true;
  if (finalAnalysis.queenReady || finalAnalysis.devourerReady) return true;
  if (
    getCards(finalBot, "field").some((card) =>
      [
        BLOOMROT_NAMES.ANCIENT_MYCELIUM,
        BLOOMROT_NAMES.QUEEN,
        BLOOMROT_NAMES.DEVOURER,
      ].includes(card?.name),
    )
  ) {
    return true;
  }
  return sequenceUses(sequence, (action) => action?.type === "simulatedBattle" && Number(action.damage || 0) > 0);
}

export function scoreBloomrotLineMilestones(context = {}) {
  const initialState = context.initialState || {};
  const finalState = context.finalState || {};
  const sequence = asArray(context.sequence);
  const initialBot = getBotState(initialState);
  const finalBot = getBotState(finalState);
  const initialOpponent = getOpponentState(initialState);
  const finalOpponent = getOpponentState(finalState);
  const initialAnalysis = buildStateAnalysis(initialState);
  const finalAnalysis = buildStateAnalysis(finalState);
  const entries = [];
  const usedNames = new Set(sequenceNames(sequence));

  const initialSpores = Number(initialAnalysis.fieldSporeTotal || 0);
  const finalSpores = Number(finalAnalysis.fieldSporeTotal || 0);
  const opponentSporeDelta =
    asArray(finalAnalysis.opponentSporedMonsters).reduce((sum, card) => sum + getSporeCount(card), 0) -
    asArray(initialAnalysis.opponentSporedMonsters).reduce((sum, card) => sum + getSporeCount(card), 0);
  const removedOpponentCards = Math.max(
    0,
    countOpponentCards(initialOpponent) - countOpponentCards(finalOpponent),
  );
  const initialTokens = countTokens(initialBot);
  const finalTokens = countTokens(finalBot);
  const initialFaceUpBloomrots = countFaceUpBloomrots(initialBot);
  const finalFaceUpBloomrots = countFaceUpBloomrots(finalBot);

  if (opponentSporeDelta > 0) {
    addMilestone(entries, "grew opponent Spore Counters", Math.min(4.5, opponentSporeDelta * 0.45));
  }
  for (const threshold of [4, 5, 8]) {
    if (thresholdCrossed(initialSpores, finalSpores, threshold)) {
      addMilestone(entries, `crossed ${threshold} Spore threshold`, threshold === 8 ? 3.5 : 2);
    }
  }

  if (!initialAnalysis.hasLivingColonyActive && finalAnalysis.hasLivingColonyActive) {
    addMilestone(entries, "Living Colony online", 3);
  }
  if (!initialAnalysis.hasRootNetworkActive && finalAnalysis.hasRootNetworkActive) {
    addMilestone(entries, "Root Network online", 2);
  }
  if (!initialAnalysis.hasRottingGroundActive && finalAnalysis.hasRottingGroundActive) {
    addMilestone(entries, "Rotting Ground online", 2);
  }

  if (finalTokens > initialTokens) {
    const devourerSetup = finalAnalysis.hasDevourerInExtra && finalTokens > 0;
    addMilestone(entries, "Bloomrot Token economy gained", devourerSetup ? 2.4 : 1.4);
  }
  if (finalFaceUpBloomrots > initialFaceUpBloomrots) {
    addMilestone(entries, "more face-up Bloomrot bodies", Math.min(2.5, (finalFaceUpBloomrots - initialFaceUpBloomrots) * 0.8));
  }

  if (finalAnalysis.queenReady && !initialAnalysis.queenReady) {
    addMilestone(entries, "Queen threshold ready", 3.5);
  }
  if (finalAnalysis.devourerReady && !initialAnalysis.devourerReady) {
    addMilestone(entries, "Devourer fusion ready", 3.2);
  }
  for (const bossName of [BLOOMROT_NAMES.ANCIENT_MYCELIUM, BLOOMROT_NAMES.QUEEN, BLOOMROT_NAMES.DEVOURER]) {
    if (!hasName(getCards(initialBot, "field"), bossName) && hasName(getCards(finalBot, "field"), bossName)) {
      addMilestone(entries, `${bossName} reached`, bossName === BLOOMROT_NAMES.DEVOURER ? 5 : 4);
    }
  }

  if (removedOpponentCards > 0) {
    addMilestone(entries, "removed opponent cards", Math.min(6, removedOpponentCards * 2.2));
  }
  if (usedNames.has(BLOOMROT_NAMES.HARVEST)) {
    addMilestone(
      entries,
      removedOpponentCards > 0 ? "Harvest converted counters" : "Harvest spent counters without removal",
      removedOpponentCards > 0 ? 2.5 : -3.2,
    );
  }
  if (usedNames.has(N.GRAVECAP_WIDOW)) {
    addMilestone(
      entries,
      removedOpponentCards > 0 ? "Gravecap Widow removed a threat" : "Widow line without removal",
      removedOpponentCards > 0 ? 2.6 : -2,
    );
  }
  if (usedNames.has(BLOOMROT_NAMES.ROOT_NETWORK) && asArray(finalAnalysis.bloomrotGraveyard).length > 0) {
    addMilestone(entries, "Root Network grind value", 1.4);
  }

  const realPayoff = lineHasRealPayoff({
    initialAnalysis,
    finalAnalysis,
    sequence,
    removedOpponentCards,
    finalBot,
  });

  const protectedStart = getBloomrotCounterSpendSummary(initialAnalysis);
  const protectedEnd = getBloomrotCounterSpendSummary(finalAnalysis);
  if (
    thresholdBroken(initialSpores, finalSpores, 8) &&
    !realPayoff &&
    protectedStart.queenReady
  ) {
    addMilestone(entries, "broke Queen threshold without payoff", -5);
  }
  if (
    (initialAnalysis.hasRootNetworkActive || initialAnalysis.hasRottingGroundActive) &&
    protectedEnd.protectedSporeCount < protectedStart.protectedSporeCount &&
    !realPayoff
  ) {
    addMilestone(entries, "spent protected control counters", -3.5);
  }
  if (
    getCards(finalBot, "field").length >= 5 &&
    !finalAnalysis.queenReady &&
    !finalAnalysis.devourerReady &&
    removedOpponentCards === 0
  ) {
    addMilestone(entries, "field clogged without payoff", -3);
  }
  if (finalFaceUpBloomrots === 0 && asArray(finalAnalysis.opponentMonsters).length > 0) {
    addMilestone(entries, "ended without Bloomrot body under pressure", -4.5);
  }
  if (sequence.length >= 4 && !realPayoff) {
    addMilestone(entries, "long Bloomrot line without payoff", -3);
  }

  sequence
    .filter((action) => action?.type === "simulatedBattle")
    .forEach((battle) => {
      if (Number(battle.damage || 0) > 0) {
        addMilestone(entries, "battle pressure converted", Math.min(3, Number(battle.damage || 0) / 900));
      }
      if (asArray(battle.destroyedCards).some((entry) => entry?.owner === "opponent")) {
        addMilestone(entries, "battle removed marked threat", 2.8);
      }
    });

  const scoreDelta = entries.reduce((sum, entry) => sum + entry.score, 0);
  entries.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  return {
    scoreDelta,
    milestones: entries,
    lineImpact: {
      initialSpores,
      finalSpores,
      opponentSporeDelta,
      removedOpponentCards,
      initialFaceUpBloomrots,
      finalFaceUpBloomrots,
      boardBonusDelta:
        evaluateBloomrotBoardBonus(finalState, finalBot) -
        evaluateBloomrotBoardBonus(initialState, initialBot),
    },
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function scoreBloomrotLineTerminal(context = {}) {
  const finalBot = getBotState(context.finalState || {});
  if ((finalBot.lp || 0) <= 0) return -10000;
  const baseScore = Number(context.baseScore || 0);
  const milestoneScore = Number(context.milestoneScore || 0);
  const profile = context.profile || context.planningContext?.profile || {};
  const cap = profile.critical ? 14 : 10;
  return baseScore + clamp(milestoneScore, -cap, cap);
}

export function describeBloomrotPlannedLine(context = {}) {
  const sequence = asArray(context.sequence);
  const steps = sequence
    .map((action) => {
      if (action?.type === "simulatedBattle") {
        return `battle ${action.attackerName || "attacker"} -> ${action.direct ? "direct" : action.targetName || "target"}`;
      }
      return `${action?.type || "action"} ${actionName(action)}`.trim();
    })
    .filter(Boolean);
  const milestones = asArray(context.milestones)
    .slice(0, 4)
    .map((entry) => {
      if (typeof entry === "string") return entry;
      const score = Number(entry.score || 0);
      return `${score >= 0 ? "+" : ""}${score.toFixed(1)} ${entry.label}`;
    })
    .join("; ");
  if (!steps.length) return "Bloomrot planner found no line";
  return `Bloomrot planned line: ${steps.join(" -> ")}${milestones ? ` | ${milestones}` : ""}`;
}
