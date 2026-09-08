import type { BloomrotCard, BloomrotPlayer, BloomrotAnalysis } from "./analysis.js";

type PlayerIdentity = string | { id?: string; name?: string; lp?: number };
type CardInput = BloomrotCard & { card?: BloomrotCard };
type CardContextKey = "attacker" | "attackingMonster" | "defender" | "attackTarget";
type PlayerContextKey = "attackerOwner" | "attackingPlayer" | "defenderOwner" | "defendingPlayer";
export type BloomrotDefenseContext = Partial<Record<CardContextKey, CardInput | { card: BloomrotCard } | null>> & Partial<Record<PlayerContextKey, PlayerIdentity>> & { player?: BloomrotPlayer; directAttack?: boolean; isDirectAttack?: boolean };
type DefenseOption = CardInput | { card: BloomrotCard };
import {
  getEffectiveAtk,
  getEffectiveDef,
  getPiercingDamage,
} from "../common/cardStats.js";
import {
  BLOOMROT_NAMES,
  getFreeMonsterZones,
  getSporeCount,
  isBloomrotMonster,
} from "./analysis.js";

export const BLOOMROT_DEFENSE_NAMES = {
  SUDDEN_GERMINATION: "Bloomrot Sudden Germination",
  ROTTING_GROUND: BLOOMROT_NAMES.ROTTING_GROUND,
  MOLDMENDER: "Bloomrot Moldmender",
  MYCO_WEAVER: "Bloomrot Myco-Weaver",
  ANCIENT_HUSK: "Bloomrot Ancient Husk",
  GRAVECAP_WIDOW: "Bloomrot Gravecap Widow",
  CARRIONCAP: "Bloomrot Carrioncap",
  ROT_STAG: "Bloomrot Rot-Stag",
  SPORELING: "Bloomrot Sporeling",
};

const HIGH_DAMAGE_THRESHOLD = 1500;
const BIG_ATTACKER_ATK = 2200;

function list<Value>(value: readonly Value[] | null | undefined): readonly Value[] {
  return Array.isArray(value) ? value : [];
}

function playerId(player: PlayerIdentity | null | undefined) {
  if (!player) return null;
  return typeof player === "string" ? player : player.id || player.name || null;
}

function cardControllerId(card: BloomrotCard | null | undefined) {
  const owner =
    card?.controller ||
    card?.currentController ||
    card?.owner ||
    card?.ownerId ||
    card?.controllerId ||
    null;
  return playerId(owner);
}

function contextCard(context: BloomrotDefenseContext, key: CardContextKey) {
  return (context?.[key]?.card || context?.[key] || null) as BloomrotCard | null;
}

function contextPlayerId(context: BloomrotDefenseContext, key: PlayerContextKey) {
  const value = context?.[key];
  return playerId(value);
}

function hasName(card: BloomrotCard | null | undefined, name: string) {
  return card?.name === name;
}

function isExtraDeckThreat(card: BloomrotCard | null | undefined) {
  return card?.monsterType === "fusion" || card?.monsterType === "ascension";
}

function hasActiveEffects(card: BloomrotCard | null | undefined) {
  if (card?.status?.effectsNegated || card?.effectsNegated) return false;
  return list(card?.effects).length > 0;
}

function highestBattleStat(card: BloomrotCard | null | undefined) {
  return Math.max(Number(getEffectiveAtk(card)) || 0, Number(getEffectiveDef(card)) || 0);
}

function battleStat(card: BloomrotCard | null | undefined) {
  if (!card) return 0;
  return card.position === "defense" ? Number(getEffectiveDef(card)) || 0 : Number(getEffectiveAtk(card)) || 0;
}

function isAttackPosition(card: BloomrotCard | null | undefined) {
  return card?.position !== "defense";
}

function countBloomrotFieldMonsters(analysis: BloomrotAnalysis) {
  return list(analysis?.ownMonsters).filter(isBloomrotMonster).length;
}

function countUsefulDevourerMaterials(analysis: BloomrotAnalysis) {
  return list(analysis?.ownMonsters).filter((card) => {
    if (!isBloomrotMonster(card)) return false;
    if (hasName(card, BLOOMROT_NAMES.DEVOURER)) return false;
    return true;
  }).length;
}

function scoreProtectedOwnCard(card: BloomrotCard | null | undefined, analysis: BloomrotAnalysis) {
  if (!card) return 0;
  let score = 0;

  if (hasName(card, BLOOMROT_NAMES.QUEEN) || hasName(card, BLOOMROT_NAMES.DEVOURER)) score += 22;
  if (hasName(card, BLOOMROT_NAMES.ANCIENT_MYCELIUM)) score += 16;
  if (hasName(card, BLOOMROT_DEFENSE_NAMES.ANCIENT_HUSK)) score += 13;
  if (hasName(card, BLOOMROT_DEFENSE_NAMES.GRAVECAP_WIDOW)) score += 12;
  if (hasName(card, BLOOMROT_DEFENSE_NAMES.CARRIONCAP)) score += 11;
  if (hasName(card, BLOOMROT_DEFENSE_NAMES.MYCO_WEAVER)) score += 9;
  if (hasName(card, BLOOMROT_DEFENSE_NAMES.MOLDMENDER)) score += 8;
  if (hasName(card, BLOOMROT_NAMES.TOKEN)) score += 4;

  if (isBloomrotMonster(card)) score += 4;
  if (hasActiveEffects(card)) score += 3;
  if (analysis?.queenReady && hasName(card, BLOOMROT_DEFENSE_NAMES.ANCIENT_HUSK)) score += 5;
  if (analysis?.devourerReady || analysis?.hasDevourerInExtra) {
    if (isBloomrotMonster(card)) score += 3;
    if (hasName(card, BLOOMROT_NAMES.TOKEN)) score += 4;
  }

  return score;
}

export function getIncomingBattleThreat(context: BloomrotDefenseContext = {}, analysis: BloomrotAnalysis = {}) {
  const player = analysis?.player || context?.player;
  const playerKey = playerId(player);
  const attacker = contextCard(context, "attacker") || contextCard(context, "attackingMonster");
  const defender = contextCard(context, "defender") || contextCard(context, "attackTarget");
  const directAttack = Boolean(context?.directAttack || context?.isDirectAttack || !defender);

  if (!attacker || !playerKey) {
    return { isOpponentAttack: false as const, attacker, defender, directAttack };
  }

  const attackerOwner =
    contextPlayerId(context, "attackerOwner") ||
    contextPlayerId(context, "attackingPlayer") ||
    cardControllerId(attacker);
  const defenderOwner =
    contextPlayerId(context, "defenderOwner") ||
    contextPlayerId(context, "defendingPlayer") ||
    cardControllerId(defender);

  const isOpponentAttack =
    attackerOwner ? attackerOwner !== playerKey : !list(analysis?.ownMonsters).includes(attacker);
  const targetsUs = directAttack || !defender || defenderOwner === playerKey || list(analysis?.ownMonsters).includes(defender);

  if (!isOpponentAttack || !targetsUs) {
    return { isOpponentAttack: false as const, attacker, defender, directAttack };
  }

  const attackerAtk = Number(getEffectiveAtk(attacker)) || 0;
  const defenderStat = defender ? battleStat(defender) : 0;
  const attackIntoAttack = defender && isAttackPosition(defender);
  const attackIntoDefense = defender && !isAttackPosition(defender);
  const projectedDamage = directAttack
    ? attackerAtk
    : attackIntoAttack
      ? Math.max(0, attackerAtk - defenderStat)
      : getPiercingDamage(attacker, attackerAtk, defenderStat);
  const losesDefender = Boolean(
    defender &&
      (attackerAtk > defenderStat || (attackIntoAttack && attackerAtk === defenderStat && attackerAtk > 0))
  );
  const lethal = projectedDamage >= (Number(player?.lp) || 0);
  const protectedValue = scoreProtectedOwnCard(defender, analysis);
  const attackerThreat =
    attackerAtk >= BIG_ATTACKER_ATK ||
    isExtraDeckThreat(attacker) ||
    hasActiveEffects(attacker) ||
    getSporeCount(attacker) >= 3;

  return {
    isOpponentAttack: true as const,
    attacker,
    defender,
    directAttack,
    attackerAtk,
    defenderStat,
    projectedDamage,
    losesDefender,
    lethal,
    protectedValue,
    attackerThreat,
  };
}

export function evaluateTokenFollowUp(analysis: BloomrotAnalysis = {}) {
  const freeZones = Number.isFinite(analysis?.freeMonsterZones)
    ? analysis.freeMonsterZones
    : getFreeMonsterZones(analysis?.player);
  if (freeZones! <= 0) {
    return { yes: false, score: -20, reason: "no free monster zone for Bloomrot Token" };
  }

  const ownBloomrots = countBloomrotFieldMonsters(analysis);
  const devourerMaterials = countUsefulDevourerMaterials(analysis);
  const opponentMonsters = list(analysis?.opponentMonsters).length || list(analysis?.oppField).length;
  const ownMonsters = list(analysis?.ownMonsters).length || list(analysis?.ownField).length;

  let score = 4;
  const reasons = ["token keeps Bloomrot body on board"];
  if (analysis?.hasLivingColonyActive) {
    score += 4;
    reasons.push("Living Colony can add a second spore target");
  }
  if (analysis?.hasDevourerInExtra && devourerMaterials >= 3) {
    score += 8;
    reasons.push("token approaches Devourer material count");
  } else if (analysis?.hasDevourerInExtra && devourerMaterials >= 2) {
    score += 5;
    reasons.push("token improves Devourer setup");
  }
  if (analysis?.queenReady || ownBloomrots >= 2) {
    score += 3;
    reasons.push("token preserves Bloomrot board density");
  }
  if (opponentMonsters > ownMonsters) {
    score += 4;
    reasons.push("token adds defense under pressure");
  }

  return { yes: score >= 7, score, reason: reasons.join("; ") };
}

export function evaluateSuddenGerminationResponse<Option extends DefenseOption>(option: Option, analysis: BloomrotAnalysis = {}, context: BloomrotDefenseContext = {}) {
  const card = (option?.card || option) as BloomrotCard;
  if (!hasName(card, BLOOMROT_DEFENSE_NAMES.SUDDEN_GERMINATION)) return null;

  const threat = getIncomingBattleThreat(context, analysis);
  if (!threat.isOpponentAttack || !threat.attacker) return null;

  const freeZones = Number.isFinite(analysis?.freeMonsterZones)
    ? analysis.freeMonsterZones
    : getFreeMonsterZones(analysis?.player);
  if (freeZones! <= 0) {
    return {
      option,
      score: -50,
      pass: true,
      reason: "Sudden Germination has no monster zone for its Token",
      threat,
    };
  }

  const tokenFollowUp = evaluateTokenFollowUp(analysis);
  let score = 18 + tokenFollowUp.score;
  const reasons = [];

  if (threat.lethal) {
    score += 60;
    reasons.push("stops lethal attack");
  }
  if (threat.projectedDamage >= HIGH_DAMAGE_THRESHOLD) {
    score += 28;
    reasons.push("prevents high battle damage");
  } else if (threat.projectedDamage >= 900) {
    score += 12;
    reasons.push("prevents relevant battle damage");
  }
  if (threat.losesDefender) {
    score += 10 + threat.protectedValue;
    reasons.push(threat.protectedValue >= 12 ? "protects key Bloomrot piece" : "prevents monster loss");
  }
  if (threat.attackerThreat) {
    score += 10;
    reasons.push("marks a threatening attacker");
  }
  if (tokenFollowUp.yes) {
    score += 6;
    reasons.push(tokenFollowUp.reason);
  }
  if (analysis?.hasLivingColonyActive) {
    score += 4;
    reasons.push("Living Colony adds follow-up counter pressure");
  }

  const meaningful =
    threat.lethal ||
    threat.projectedDamage >= HIGH_DAMAGE_THRESHOLD ||
    (threat.losesDefender && threat.protectedValue >= 8) ||
    (threat.attackerThreat && tokenFollowUp.yes) ||
    tokenFollowUp.score >= 12;

  if (!meaningful) {
    return {
      option,
      score: Math.min(score, 24),
      pass: true,
      reason: "attack is too low value for Sudden Germination",
      threat,
      tokenFollowUp,
    };
  }

  return {
    option,
    score,
    reason: reasons.join("; ") || "use Sudden Germination defensively",
    threat,
    tokenFollowUp,
  };
}

export function evaluateRottingGroundNegateTarget(card: BloomrotCard | null | undefined, analysis: BloomrotAnalysis = {}) {
  if (!card || card.cardKind !== "monster") {
    return { yes: false, score: 0, reason: "target is not a monster" };
  }
  const spores = getSporeCount(card);
  if (spores < 4) {
    return { yes: false, score: 0, reason: "target has fewer than 4 Spore Counters" };
  }
  if (
    card.isFacedown ||
    card.faceDown ||
    (card.position as string) === "face-down" ||
    card.faceUp === false
  ) {
    return { yes: false, score: 0, reason: "target is not face-up" };
  }
  if (card.status?.effectsNegated || card.effectsNegated) {
    return { yes: false, score: 0, reason: "target is already negated" };
  }

  const stat = highestBattleStat(card);
  const effects = hasActiveEffects(card);
  const extraDeck = isExtraDeckThreat(card);
  const boss = stat >= 2500 || extraDeck;
  const threatensBattle = stat >= BIG_ATTACKER_ATK || (isAttackPosition(card) && stat >= 1800);
  const pressure = list(analysis?.opponentMonsters).length >= list(analysis?.ownMonsters).length;

  let score = spores * 1.5 + stat / 180;
  if (effects) score += 8;
  if (extraDeck) score += 8;
  if (boss) score += 7;
  if (threatensBattle) score += 5;
  if (pressure) score += 3;

  const yes = Boolean(effects || boss || threatensBattle || score >= 18);
  return {
    yes,
    score,
    reason: yes
      ? `negate real threat with ${spores} Spore Counters`
      : "target is too trivial for Rotting Ground negation",
  };
}

export function shouldUseRottingGroundNegate(analysis: BloomrotAnalysis = {}) {
  const candidates = list(analysis?.opponentSporedMonsters4Plus)
    .map((card) => ({ card, ...evaluateRottingGroundNegateTarget(card, analysis) }))
    .filter((entry) => entry.yes)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    return { yes: false, priority: 0, reason: "no dangerous 4+ spore target for Rotting Ground" };
  }

  const best = candidates[0];
  return {
    yes: true,
    target: best.card,
    score: best.score,
    priority: Math.min(9.2, 6.8 + best.score / 10),
    reason: best.reason,
  };
}

export function shouldPrioritizeRottingGroundSet(analysis: BloomrotAnalysis = {}) {
  if (analysis?.hasRottingGroundActive) {
    return { yes: false, priority: 0, reason: "Rotting Ground is already active" };
  }

  const opponentMonsters = list(analysis?.opponentMonsters).length;
  const opponentHand = list(analysis?.opponent?.hand).length;
  const pressure =
    opponentMonsters > 0 ||
    opponentHand >= 4 ||
    list(analysis?.opponentSporedMonsters).length > 0 ||
    (Number(analysis?.player?.lp) || 8000) <= 3500;
  const priority = pressure ? 6.3 + Math.min(1.2, opponentMonsters * 0.25) : 5.1;

  return {
    yes: true,
    priority,
    reason: pressure
      ? "set Rotting Ground before opponent summon pressure"
      : "set Rotting Ground as counter-control setup",
  };
}

export function hasBloomrotDefenseResponseInChain(chainSystem: { getChainSummary?(): Array<{ cardName?: string | null; controllerId?: string | null }> } | null | undefined, player: PlayerIdentity | null | undefined) {
  const playerKey = playerId(player);
  const links = chainSystem?.getChainSummary?.() || [];

  return list(links).some((link) => {
    const name = link?.cardName;
    if (name !== BLOOMROT_DEFENSE_NAMES.SUDDEN_GERMINATION) return false;
    const controller = link?.controllerId || playerKey;
    return !playerKey || controller === playerKey;
  });
}
