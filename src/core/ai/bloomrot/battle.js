import {
  getBattleStatForAttackTarget,
  getEffectiveAtk,
  getEffectiveDef,
} from "../common/cardStats.js";
import {
  BLOOMROT_NAMES,
  getSporeCount,
  isBloomrotMonster,
} from "./analysis.js";

const N = {
  ROT_STAG: "Bloomrot Rot-Stag",
  CARRIONCAP: "Bloomrot Carrioncap",
  GRAVECAP_WIDOW: "Bloomrot Gravecap Widow",
  ANCIENT_HUSK: "Bloomrot Ancient Husk",
  DEVOURER: BLOOMROT_NAMES.DEVOURER,
  QUEEN: BLOOMROT_NAMES.QUEEN,
};

const KEY_PIECES = new Set([
  N.GRAVECAP_WIDOW,
  N.ANCIENT_HUSK,
  N.DEVOURER,
  N.QUEEN,
]);

const DEFAULT_PROFILE = Object.freeze({
  enabled: false,
  mode: "off",
  turnMode: "mainOnly",
  beamWidth: 3,
  maxDepth: 4,
  nodeBudget: 220,
  candidateLimit: 8,
  battleStepLimit: 1,
});

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function isFaceupMonster(card) {
  return card?.cardKind === "monster" && card.isFacedown !== true;
}

function isBloomrotToken(card) {
  return card?.isToken === true || card?.name === BLOOMROT_NAMES.TOKEN;
}

function canAttack(card) {
  return (
    isFaceupMonster(card) &&
    !isBloomrotToken(card) &&
    card.position === "attack" &&
    card.cannotAttackThisTurn !== true &&
    card.hasAttacked !== true
  );
}

function battleAtk(attacker, target = null) {
  let atk = getEffectiveAtk(attacker);
  if (
    attacker?.name === N.ROT_STAG &&
    target?.cardKind === "monster" &&
    getSporeCount(target) > 0 &&
    attacker._simBloomrotRotStagBattleBoost !== true
  ) {
    atk += 500;
  }
  return atk;
}

function battleStat(target) {
  return getBattleStatForAttackTarget(target, { facedownValue: 1500 });
}

function cardThreat(card) {
  if (!card) return 0;
  if (card.cardKind !== "monster") return 0;
  return (
    Math.max(getEffectiveAtk(card), getEffectiveDef(card)) +
    Number(card.level || 0) * 120 +
    getSporeCount(card) * 180
  );
}

function targetIsMarked(target) {
  return target?.cardKind === "monster" && getSporeCount(target) > 0;
}

function wouldDestroy(attacker, target) {
  if (!attacker || !target) return false;
  return battleAtk(attacker, target) > battleStat(target);
}

function wouldSurvive(attacker, target) {
  if (!attacker || !target) return true;
  if (target.position === "defense") {
    return battleAtk(attacker, target) >= battleStat(target);
  }
  return battleAtk(attacker, target) > battleStat(target);
}

function directLethalAvailable(attackers = [], opponent = {}) {
  if (asArray(opponent.field).some((card) => card?.cardKind === "monster")) {
    return false;
  }
  const lp = Number(opponent.lp || 0);
  return attackers.some((attacker) => battleAtk(attacker, null) >= lp && lp > 0);
}

function hasTemporaryBattleStats(card) {
  return (
    Number(card?.tempAtkBoost || 0) !== 0 ||
    Number(card?.tempDefBoost || 0) !== 0 ||
    Boolean(card?.dynamicBuffs)
  );
}

function hasMeaningfulBattleSignal(analysis = {}) {
  const attackers = asArray(analysis.faceUpBloomrotField).filter(canAttack);
  if (attackers.length === 0) return false;
  const opponent = analysis.opponent || {};
  const opponentMonsters = asArray(analysis.opponentMonsters);

  if (directLethalAvailable(attackers, opponent)) return true;
  if (attackers.some(hasTemporaryBattleStats)) return true;
  if (attackers.some((card) => [N.CARRIONCAP, N.DEVOURER].includes(card.name))) {
    if (opponentMonsters.some(targetIsMarked)) return true;
  }
  if (
    attackers.some((attacker) =>
      opponentMonsters.some(
        (target) => targetIsMarked(target) && wouldDestroy(attacker, target),
      ),
    )
  ) {
    return true;
  }

  return false;
}

export function buildBloomrotPlanningProfile(analysis = {}, context = {}) {
  const game = context.game || analysis.game || {};
  const manual = game?.turnLineSearchEnabled === true;
  const phase = String(analysis.phase || game.phase || "main1").toLowerCase();
  const battleSignal = phase.includes("main1") && hasMeaningfulBattleSignal(analysis);
  const enabled = manual || battleSignal;
  const requestedTurnMode = game?.turnLineSearchTurnMode;
  const reasons = [];
  if (battleSignal) reasons.push("Bloomrot battle payoff available");

  return {
    ...DEFAULT_PROFILE,
    enabled,
    mode: manual && !battleSignal ? "manual" : enabled ? "critical" : "off",
    turnMode: requestedTurnMode || (battleSignal ? "mainBattleMain2" : "mainOnly"),
    beamWidth: Number.isFinite(game?.turnLineSearchBeamWidth)
      ? game.turnLineSearchBeamWidth
      : DEFAULT_PROFILE.beamWidth,
    maxDepth: Number.isFinite(game?.turnLineSearchMaxDepth)
      ? game.turnLineSearchMaxDepth
      : DEFAULT_PROFILE.maxDepth,
    nodeBudget: Number.isFinite(game?.turnLineSearchNodeBudget)
      ? game.turnLineSearchNodeBudget
      : DEFAULT_PROFILE.nodeBudget,
    candidateLimit: Number.isFinite(game?.turnLineSearchCandidateLimit)
      ? game.turnLineSearchCandidateLimit
      : DEFAULT_PROFILE.candidateLimit,
    battleStepLimit: Number.isFinite(game?.turnLineSearchBattleStepLimit)
      ? game.turnLineSearchBattleStepLimit
      : DEFAULT_PROFILE.battleStepLimit,
    reasons,
    critical: battleSignal,
  };
}

export function prepareBloomrotSimulatedBattle({ attacker, target } = {}) {
  if (!attacker || !isBloomrotMonster(attacker) || isBloomrotToken(attacker)) {
    return [];
  }
  const rewards = [];
  if (
    attacker.name === N.ROT_STAG &&
    target?.cardKind === "monster" &&
    getSporeCount(target) > 0
  ) {
    attacker.atk = Math.max(0, Number(attacker.atk || 0) + 500);
    attacker._simBloomrotRotStagBattleBoost = true;
    rewards.push("Rot-Stag +500 vs spored monster");
  }
  if (
    attacker.name === N.CARRIONCAP &&
    target?.cardKind === "monster" &&
    getSporeCount(target) > 0
  ) {
    attacker._simBloomrotCarrioncapMarkedBattle = true;
  }
  return rewards;
}

function bestSporeRewardTarget(opponent = {}) {
  return asArray(opponent.field)
    .filter((card) => isFaceupMonster(card))
    .sort((a, b) => cardThreat(b) - cardThreat(a))[0] || null;
}

export function applyBloomrotSimulatedBattleRewards({
  battlePlan,
  summary,
  opponent,
} = {}) {
  const attacker = battlePlan?.attackerCard;
  if (!attacker || attacker.name !== N.CARRIONCAP) return [];
  const destroyedOpponentMonster = asArray(summary?.destroyedCards).some(
    (card) => card?.owner === "opponent" && card?.cardKind === "monster",
  );
  if (!destroyedOpponentMonster || attacker._simBloomrotCarrioncapMarkedBattle !== true) {
    return [];
  }
  const target = bestSporeRewardTarget(opponent);
  if (target) {
    if (typeof target.addCounter === "function") {
      target.addCounter("spore", 1);
    } else {
      target.counters = target.counters || {};
      target.counters.spore = Math.max(0, Number(target.counters.spore || 0)) + 1;
    }
  }
  return ["Carrioncap battle spore reward"];
}

export function scoreBloomrotBattleAttackCandidate(context = {}) {
  const {
    attacker,
    target,
    lethalNow = false,
    attackerSurvived = false,
    targetSurvived = false,
    summary,
    opponent,
    opponentLpAfter,
  } = context;

  if (!attacker || !isBloomrotMonster(attacker)) return 0;
  if (isBloomrotToken(attacker)) return -100;

  const positiveDamage = Math.max(0, Number(summary?.damage || 0));
  const damageTaken = Math.max(0, -Number(summary?.damage || 0));
  const markedTarget = targetIsMarked(target);
  const predictedAtk = battleAtk(attacker, target);
  const predictedDestroy = Boolean(target && predictedAtk > battleStat(target));
  const destroyedTarget = Boolean(target && (!targetSurvived || predictedDestroy));
  const predictedSurvival = !target || wouldSurvive(attacker, target);
  const lowOpponentLp =
    Number.isFinite(opponentLpAfter) && Number(opponentLpAfter) <= 2000;
  let delta = 0;

  if (lethalNow) delta += 7;
  if (!target) {
    if (lethalNow) delta += 8;
    else if (positiveDamage >= 2000 || lowOpponentLp) delta += 1.5;
    else if (positiveDamage >= 1000) delta += 0.6;
  }

  if (markedTarget) {
    delta += 0.5 + Math.min(1.5, getSporeCount(target) * 0.25);
    if (destroyedTarget) delta += 1.6 + Math.min(2.2, cardThreat(target) / 1200);
  }

  if (attacker.name === N.ROT_STAG && markedTarget) {
    delta += predictedDestroy ? 2.2 : 0.8;
  }
  if (attacker.name === N.CARRIONCAP && markedTarget && destroyedTarget) {
    delta += 2.4;
  }
  if (attacker.name === N.DEVOURER && markedTarget) {
    delta += destroyedTarget ? 2.8 : 1.1;
  }

  if (attackerSurvived || predictedSurvival || lethalNow) delta += 0.5;
  if (!attackerSurvived && !predictedSurvival && !lethalNow) {
    delta -= KEY_PIECES.has(attacker.name) ? 3.2 : 1.5;
  }
  if (damageTaken > 0 && !destroyedTarget && !lethalNow) {
    delta -= Math.min(2.5, damageTaken / 600);
  }
  if (
    target &&
    !destroyedTarget &&
    !lethalNow &&
    markedTarget &&
    asArray(opponent?.field).some((card) => card !== target && targetIsMarked(card))
  ) {
    delta -= 0.5;
  }

  return delta;
}
