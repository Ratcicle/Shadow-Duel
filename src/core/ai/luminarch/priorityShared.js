// Shared helpers for Luminarch priority modules.

import {
  estimateTemporaryCombatDebuffTargetValue,
  isBattleReadyAttacker,
} from "../StrategyUtils.js";
import {
  getBattleStatForAttackTarget,
  getVisibleAtk,
  getVisibleDef,
} from "../common/cardStats.js";

// Rastrear erros ja logados para evitar spam
const _loggedErrors = new Set();

export const LUMINARCH_CORE_DEFENDERS = [
  "Luminarch Aegisbearer",
  "Luminarch Sanctum Protector",
  "Luminarch Fortress Aegis",
  "Luminarch Megashield Barbarias",
];

export const LUMINARCH_COUNTERATTACK_PAYOFFS = [
  "Luminarch Radiant Lancer",
  "Luminarch Aurora Seraph",
  "Luminarch Celestial Marshal",
  "Luminarch Moonblade Captain",
  "Luminarch Megashield Barbarias",
];

export function hasLoggedPriorityError(errorKey) {
  return _loggedErrors.has(errorKey);
}

export function markPriorityErrorLogged(errorKey) {
  _loggedErrors.add(errorKey);
}

export function getBattleStatForTarget(card) {
  return getBattleStatForAttackTarget(card, { facedownValue: 0 });
}

export function getBattleReadyLuminarchAttackers(analysis) {
  return (analysis.field || []).filter((card) =>
    isBattleReadyAttacker(card, { archetype: "Luminarch" })
  );
}

export function getBestTemporaryCombatDebuffTarget(analysis) {
  const attackers = getBattleReadyLuminarchAttackers(analysis);
  if (attackers.length === 0) return { target: null, score: 0 };

  return (analysis.oppField || [])
    .filter((card) => card && card.cardKind === "monster" && !card.isFacedown)
    .map((target) => ({
      target,
      score: estimateTemporaryCombatDebuffTargetValue(target, {
        attackers,
        opponentLp: analysis.oppLp || 0,
      }),
    }))
    .sort((a, b) => b.score - a.score)[0] || { target: null, score: 0 };
}

export function getBattleStatToAttack(card) {
  return getBattleStatForAttackTarget(card);
}

export function getThreatAtk(card) {
  if (!card || card.cardKind !== "monster") return 0;
  return card.isFacedown ? 1500 : getVisibleAtk(card);
}

export function isDefensiveLuminarch(card) {
  if (!card || card.cardKind !== "monster") return false;
  if (card.mustBeAttacked) return true;
  if ((card.def || 0) >= (card.atk || 0) + 500) return true;
  return LUMINARCH_CORE_DEFENDERS.includes(card.name);
}

export { getVisibleAtk, getVisibleDef };
