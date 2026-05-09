export const PHASE_ORDER = ["draw", "standby", "main1", "battle", "main2", "end"];

function resolveTurnCounter(gameOrTurnCounter) {
  if (typeof gameOrTurnCounter === "number") {
    return gameOrTurnCounter;
  }
  return gameOrTurnCounter?.turnCounter ?? 0;
}

export function isFirstTurnOfDuel(gameOrTurnCounter = this) {
  return resolveTurnCounter(gameOrTurnCounter) === 1;
}

export function canEnterBattlePhase(gameOrTurnCounter = this) {
  return !isFirstTurnOfDuel(gameOrTurnCounter);
}

export function getNextPhase(currentPhase, gameOrTurnCounter = this) {
  if (currentPhase === "main1" && !canEnterBattlePhase(gameOrTurnCounter)) {
    return "main2";
  }
  const currentIdx = PHASE_ORDER.indexOf(currentPhase);
  return currentIdx >= 0 ? PHASE_ORDER[currentIdx + 1] || null : null;
}

export function normalizeTargetPhase(targetPhase, gameOrTurnCounter = this) {
  if (targetPhase === "battle" && !canEnterBattlePhase(gameOrTurnCounter)) {
    return {
      phase: "main2",
      redirected: true,
      reason: "Cannot enter the Battle Phase on the first turn of the duel.",
    };
  }
  return { phase: targetPhase, redirected: false, reason: null };
}
