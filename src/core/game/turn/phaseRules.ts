import type { GamePhase } from "../../contracts/game.js";

export const PHASE_ORDER: GamePhase[] = [
  "draw",
  "standby",
  "main1",
  "battle",
  "main2",
  "end",
];

export interface TurnCounterView {
  turnCounter?: number;
}

export type TurnCounterInput = number | TurnCounterView | null | undefined;

export interface NormalizedTargetPhase {
  phase: GamePhase | string;
  redirected: boolean;
  reason: string | null;
}

function resolveTurnCounter(gameOrTurnCounter: TurnCounterInput): number {
  if (typeof gameOrTurnCounter === "number") {
    return gameOrTurnCounter;
  }
  return gameOrTurnCounter?.turnCounter ?? 0;
}

export function isFirstTurnOfDuel(
  this: TurnCounterView | void,
  gameOrTurnCounter: TurnCounterInput = this === undefined ? undefined : this,
): boolean {
  return resolveTurnCounter(gameOrTurnCounter) === 1;
}

export function canEnterBattlePhase(
  this: TurnCounterView | void,
  gameOrTurnCounter: TurnCounterInput = this === undefined ? undefined : this,
): boolean {
  return !isFirstTurnOfDuel(gameOrTurnCounter);
}

export function getNextPhase(
  this: TurnCounterView | void,
  currentPhase: GamePhase | string,
  gameOrTurnCounter: TurnCounterInput = this === undefined ? undefined : this,
): GamePhase | null {
  if (currentPhase === "main1" && !canEnterBattlePhase(gameOrTurnCounter)) {
    return "main2";
  }
  const currentIdx = PHASE_ORDER.indexOf(currentPhase as GamePhase);
  return currentIdx >= 0 ? PHASE_ORDER[currentIdx + 1] || null : null;
}

export function normalizeTargetPhase(
  this: TurnCounterView | void,
  targetPhase: GamePhase | string,
  gameOrTurnCounter: TurnCounterInput = this === undefined ? undefined : this,
): NormalizedTargetPhase {
  if (targetPhase === "battle" && !canEnterBattlePhase(gameOrTurnCounter)) {
    return {
      phase: "main2",
      redirected: true,
      reason: "Cannot enter the Battle Phase on the first turn of the duel.",
    };
  }
  return { phase: targetPhase, redirected: false, reason: null };
}
