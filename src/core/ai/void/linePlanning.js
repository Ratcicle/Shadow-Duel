import {
  getEffectiveAtk,
  getStrongestAttackThreat,
  getStrongestBattleThreat,
} from "../common/cardStats.js";
import { evaluateBoardVoid } from "./scoring.js";
import { isVoid } from "./knowledge.js";
import { VOID_IDS } from "./combos.js";

const FINISHER_IDS = new Set([
  VOID_IDS.ARCTURUS,
  VOID_IDS.MALICIOUS_DEMON,
  VOID_IDS.HYDRA_TITAN,
  VOID_IDS.BERSERKER,
  VOID_IDS.HOLLOW_KING,
]);

const BOSS_IDS = new Set([
  ...FINISHER_IDS,
  VOID_IDS.THOUSAND_ARMS,
  VOID_IDS.COSMIC_WALKER,
  VOID_IDS.SLAYER_BRUTE,
]);

const ENGINE_ACTION_NAMES = new Set([
  "Void Lost Throne",
  "Void Conjurer",
  "Void Walker",
  "Void Hollow",
  "The Void",
  "Void Haunter",
]);

function getBotState(state) {
  return state?.bot || state?.player || {};
}

function getOpponentState(state) {
  return state?.player || state?.opponent || {};
}

function getCards(player, zone) {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return Array.isArray(player[zone]) ? player[zone].filter(Boolean) : [];
}

function countCards(player, zone, predicate) {
  return getCards(player, zone).filter(predicate).length;
}

function hasCard(player, zone, id) {
  return getCards(player, zone).some((card) => card?.id === id);
}

function hasAnyCard(player, zones, ids) {
  return zones.some((zone) => getCards(player, zone).some((card) => ids.has(card?.id)));
}

function getFaceUpMonsters(player) {
  return getCards(player, "field").filter(
    (card) => card?.cardKind === "monster" && !card.isFacedown,
  );
}

function getVoidMonsters(player, zone) {
  return getCards(player, zone).filter(
    (card) => card?.cardKind === "monster" && isVoid(card),
  );
}

function getArcturusSoloAtk(bot) {
  const field = getFaceUpMonsters(bot);
  const arcturus = field.find((card) => card?.id === VOID_IDS.ARCTURUS);
  if (!arcturus || field.length !== 1) return 0;
  const voidsInGY = countCards(bot, "graveyard", (card) => isVoid(card));
  return getEffectiveAtk(arcturus) + voidsInGY * 100;
}

function opponentThreatensLethal(bot, opponent) {
  const lp = Number(bot?.lp || 0);
  if (lp <= 0) return true;
  const totalAtk = getCards(opponent, "field").reduce((sum, card) => {
    if (!card || card.cardKind !== "monster" || card.isFacedown) return sum;
    if (card.position === "defense") return sum;
    return sum + Math.max(0, getEffectiveAtk(card));
  }, 0);
  return totalAtk >= lp;
}

function hasStarterAccess(analysis = {}) {
  const hand = analysis.hand || [];
  const graveyard = analysis.graveyard || [];
  const field = analysis.field || [];
  const handIds = new Set(hand.map((card) => card?.id));
  if (handIds.has(VOID_IDS.LOST_THRONE)) return true;
  if (handIds.has(VOID_IDS.CONJURER)) return true;
  if (handIds.has(VOID_IDS.THE_VOID) && graveyard.some((card) => isVoid(card))) return true;
  if (analysis.fieldSpell?.id === VOID_IDS.THE_VOID && graveyard.some((card) => isVoid(card))) {
    return true;
  }
  if (field.some((card) => card?.id === VOID_IDS.CONJURER)) return true;
  if (field.some((card) => card?.id === VOID_IDS.WALKER) && hand.some((card) => isVoid(card))) {
    return true;
  }
  return false;
}

function hasVisiblePayoff(analysis = {}) {
  if ((analysis.bestFinisherPlan?.score100 || 0) >= 72) return true;
  if ((analysis.readyCombos || []).some((entry) => (entry?.priority || 0) >= 13)) {
    return true;
  }
  const hand = analysis.hand || [];
  const field = analysis.field || [];
  if (
    hand.some((card) => card?.id === VOID_IDS.ARCTURUS) &&
    field.filter((card) => card?.cardKind === "monster").length >= 2
  ) {
    return true;
  }
  return field.some(
    (card) => FINISHER_IDS.has(card?.id) || card?.id === VOID_IDS.THOUSAND_ARMS,
  );
}

function sequenceUses(sequence = [], predicate) {
  return sequence.some((action) => predicate(action || {}));
}

function sequenceCardNames(sequence = []) {
  return sequence.map((action) => action?.cardName || action?.attackerName).filter(Boolean);
}

function countOpponentCards(player) {
  return (
    getCards(player, "field").length +
    getCards(player, "spellTrap").length +
    getCards(player, "fieldSpell").length
  );
}

function addMilestone(list, label, score, detail = null) {
  if (!Number.isFinite(score) || score === 0) return;
  list.push({ label, score, detail });
}

function lineHasRealPayoff({ finalBot, finalOpponent, initialOpponent, sequence }) {
  const finalBoss = getCards(finalBot, "field").some((card) => FINISHER_IDS.has(card?.id));
  const removedOpponentCards = countOpponentCards(initialOpponent) - countOpponentCards(finalOpponent);
  const battleStep = sequence.some((action) => action?.type === "simulatedBattle");
  return finalBoss || removedOpponentCards > 0 || battleStep;
}

export function buildVoidPlanningProfile(analysis = {}, context = {}) {
  const game = context.game || analysis.game || {};
  const bot = analysis.bot || analysis.player || game.bot || {};
  const opponent = analysis.opponent || game.player || {};
  const phase = String(analysis.phase || game.phase || "").toLowerCase();
  const manual = game?.turnLineSearchEnabled === true;
  const reasons = [];
  const weakField =
    (analysis.voidCount || 0) === 0 ||
    getStrongestBattleThreat(analysis.field || []) < getStrongestBattleThreat(analysis.oppField || []) - 400;
  const underPressure =
    (analysis.oppFieldCount || 0) > 0 || (bot.lp || 8000) <= 4000;

  if (opponentThreatensLethal(bot, opponent)) reasons.push("opponent threatens lethal");
  if ((bot.lp || 0) <= 3000 && (analysis.oppFieldCount || 0) > 0) {
    reasons.push("low LP under pressure");
  }
  if ((analysis.oppStrongestBattle || analysis.oppStrongestAtk || 0) >= 2400 && weakField) {
    reasons.push("large opposing threat");
  }
  if (weakField && underPressure && hasStarterAccess(analysis)) {
    reasons.push("weak field with starter");
  }
  if (hasVisiblePayoff(analysis)) reasons.push("visible Void finisher payoff");

  const enabled = manual || reasons.length > 0;
  const bestPlan = analysis.bestFinisherPlan || null;
  const battleNames = ["Arcturus", "Malicious", "Berserker", "Forgotten"];
  const battleDependent =
    bestPlan &&
    battleNames.some((name) => String(bestPlan.targetName || "").includes(name));
  const turnMode =
    game.turnLineSearchTurnMode ||
    (enabled && (phase === "main1" || phase === "main") && battleDependent
      ? "mainBattleMain2"
      : "mainOnly");

  return {
    enabled,
    mode: enabled ? "critical" : "off",
    turnMode,
    beamWidth: Number.isFinite(game.turnLineSearchBeamWidth)
      ? game.turnLineSearchBeamWidth
      : 3,
    maxDepth: phase.includes("main2") ? 3 : 4,
    nodeBudget: Number.isFinite(game.turnLineSearchNodeBudget)
      ? game.turnLineSearchNodeBudget
      : 200,
    candidateLimit: Number.isFinite(game.turnLineSearchCandidateLimit)
      ? game.turnLineSearchCandidateLimit
      : 6,
    reasons,
    critical: reasons.length > 0,
    bestFinisherPlan: bestPlan,
  };
}

export function scoreVoidLineMilestones(context = {}) {
  const initialState = context.initialState || {};
  const finalState = context.finalState || {};
  const sequence = context.sequence || [];
  const profile = context.profile || {};
  const initialBot = getBotState(initialState);
  const finalBot = getBotState(finalState);
  const initialOpponent = getOpponentState(initialState);
  const finalOpponent = getOpponentState(finalState);
  const milestones = [];
  const finalField = getCards(finalBot, "field");
  const finalNames = new Set(finalField.map((card) => card?.name));
  const usedNames = sequenceCardNames(sequence);
  const removedOpponentCards =
    countOpponentCards(initialOpponent) - countOpponentCards(finalOpponent);
  const initialThreat = getStrongestBattleThreat(getCards(initialOpponent, "field"));
  const finalThreat = getStrongestBattleThreat(getCards(finalOpponent, "field"));
  const threatReduced = Math.max(0, initialThreat - finalThreat);
  const initialLethal = opponentThreatensLethal(initialBot, initialOpponent);
  const finalLethal = opponentThreatensLethal(finalBot, finalOpponent);
  const hollowGyStart = countCards(initialBot, "graveyard", (card) => card?.id === VOID_IDS.HOLLOW);
  const hollowGyEnd = countCards(finalBot, "graveyard", (card) => card?.id === VOID_IDS.HOLLOW);
  const ravenInHand = hasCard(finalBot, "hand", VOID_IDS.RAVEN);
  const ravenOnField = hasCard(finalBot, "field", VOID_IDS.RAVEN);
  const finalHasFusionBoss = finalField.some(
    (card) => card?.monsterType === "fusion" && isVoid(card),
  );
  const realPayoff = lineHasRealPayoff({
    finalBot,
    finalOpponent,
    initialOpponent,
    sequence,
  });

  if (finalNames.has("Arcturus, Lord of the Void")) {
    const soloAtk = getArcturusSoloAtk(finalBot);
    if (soloAtk > 0) {
      addMilestone(milestones, "Arcturus solo payoff", 6 + Math.min(4, soloAtk / 1000));
    } else {
      addMilestone(milestones, "Arcturus solo buff broken", -4);
    }
  }

  if (finalNames.has("Malicious Demon of the Void")) {
    addMilestone(
      milestones,
      "Malicious Demon online",
      hollowGyEnd >= 3 ? 8 : hollowGyEnd >= 2 ? 6 : 3,
      `${hollowGyEnd} Hollows in GY`,
    );
  }
  if (finalNames.has("Void Hydra Titan")) {
    addMilestone(milestones, "Hydra stabilizer reached", 6);
  }
  if (finalNames.has("Void Berserker")) {
    addMilestone(milestones, "Berserker pressure reached", 4.5);
  }
  if (finalNames.has("Void Hollow King")) {
    addMilestone(milestones, "Hollow King resilience reached", 4);
  }

  if (profile.bestFinisherPlan?.targetName && finalNames.has(profile.bestFinisherPlan.targetName)) {
    addMilestone(milestones, "matched finisher plan", 3);
  }
  if (profile.bestFinisherPlan?.preserveHollowsInGY && hollowGyEnd >= hollowGyStart) {
    addMilestone(milestones, "preserved Hollows for finisher", 2.5);
  } else if (profile.bestFinisherPlan?.preserveHollowsInGY && hollowGyEnd < hollowGyStart) {
    addMilestone(milestones, "spent Hollows before finisher", -3);
  }

  if (removedOpponentCards > 0) {
    addMilestone(milestones, "removed opponent cards", Math.min(6, removedOpponentCards * 2.2));
  }
  if (threatReduced >= 600) {
    addMilestone(milestones, "reduced top threat", Math.min(5, threatReduced / 500));
  }
  if (initialLethal && !finalLethal) {
    addMilestone(milestones, "removed lethal threat", 7);
  }

  const usedEngine = usedNames.some((name) => ENGINE_ACTION_NAMES.has(name));
  if (usedEngine && realPayoff) {
    addMilestone(milestones, "engine converted into payoff", 3);
  } else if (usedEngine) {
    addMilestone(milestones, "engine line without payoff", -2.5);
  }

  if (sequenceUses(sequence, (action) => action.cardName === "Void Gravitational Pull")) {
    const bossStillPresent = finalField.some((card) => BOSS_IDS.has(card?.id));
    addMilestone(
      milestones,
      bossStillPresent ? "Gravitational Pull kept payoff" : "Gravitational Pull spent payoff",
      bossStillPresent ? 2 : -3,
    );
  }

  if (finalHasFusionBoss && ravenInHand) {
    addMilestone(milestones, "Raven preserved for fusion", 2.5);
  }
  if (ravenOnField && !finalLethal) {
    addMilestone(milestones, "Raven used as low-impact body", -3.5);
  }

  const initialBosses = getCards(initialBot, "field").filter((card) => BOSS_IDS.has(card?.id));
  const finalBossNames = new Set(finalField.filter((card) => BOSS_IDS.has(card?.id)).map((card) => card.name));
  initialBosses.forEach((boss) => {
    if (!finalBossNames.has(boss.name) && !realPayoff) {
      addMilestone(milestones, `lost ${boss.name} without payoff`, -4);
    }
  });

  sequence
    .filter((action) => action?.type === "simulatedBattle")
    .forEach((battle) => {
      const destroyedOpponent = (battle.destroyedCards || []).some(
        (entry) => entry?.owner === "opponent",
      );
      if (destroyedOpponent) {
        addMilestone(milestones, "battle removed threat", 3.5);
      }
      if ((battle.damage || 0) > 0) {
        addMilestone(milestones, "battle pressure", Math.min(3, battle.damage / 900));
      }
    });

  if (sequence.length >= 4 && !realPayoff) {
    addMilestone(milestones, "long line without payoff", -3);
  }
  if (getCards(finalBot, "field").length === 0 && getCards(finalOpponent, "field").length > 0) {
    addMilestone(milestones, "ended with empty board under pressure", -5);
  }

  const scoreDelta = milestones.reduce((sum, entry) => sum + entry.score, 0);
  const ordered = milestones
    .slice()
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  return {
    scoreDelta,
    milestones: ordered,
    lineImpact: {
      removedOpponentCards,
      initialThreat,
      finalThreat,
      hollowGyStart,
      hollowGyEnd,
    },
  };
}

export function scoreVoidLineTerminal(context = {}) {
  const baseScore = Number(context.baseScore || 0);
  const finalBot = getBotState(context.finalState || {});
  if ((finalBot.lp || 0) <= 0) return -10000;
  const cap = context.profile?.critical ? 14 : 10;
  const milestoneScore = Math.max(
    -cap,
    Math.min(cap, Number(context.milestoneScore || 0)),
  );
  return baseScore + milestoneScore;
}

export function describeVoidPlannedLine(context = {}) {
  const sequence = context.sequence || [];
  const milestones = (context.milestones || []).slice(0, 4);
  const steps = sequence
    .map((action) => {
      if (action?.type === "simulatedBattle") {
        return `battle ${action.attackerName || "attacker"} -> ${action.direct ? "direct" : action.targetName || "target"}`;
      }
      return `${action?.type || "action"} ${action?.cardName || ""}`.trim();
    })
    .filter(Boolean);
  const milestoneText = milestones
    .map((entry) => `${entry.score >= 0 ? "+" : ""}${entry.score.toFixed(1)} ${entry.label}`)
    .join("; ");
  return steps.length
    ? `Void planned line: ${steps.join(" -> ")}${milestoneText ? ` | ${milestoneText}` : ""}`
    : "Void planner found no actionable line";
}

export function evaluateVoidLineBaseScore(state) {
  return evaluateBoardVoid(state, state?.bot);
}
