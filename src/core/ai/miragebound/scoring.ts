import type { MirageboundGame, MirageboundPlayer } from "./contracts.js";
import type { SimulatedPlayerState } from "../../contracts/aiState.js";
import { MB, getMaterialEffectActivations, hasName, isFaceUpMirageboundMonster, isMiragebound } from "./knowledge.js";

import type MirageboundStrategy from "../MirageboundStrategy.js";

type EvaluateBoardPort = Pick<MirageboundStrategy, "bot" | "getOpponent">;

export function evaluateBoard(strategy: EvaluateBoardPort, gameOrState: MirageboundGame, perspectivePlayer: SimulatedPlayerState, base: number) {
  const perspective =
    (perspectivePlayer?.id ? perspectivePlayer : gameOrState?.bot || strategy.bot) as MirageboundPlayer;
  if (!perspective) return base;
  const opponent = strategy.getOpponent(gameOrState, perspective);
  const field = perspective.field || [];
  const graveyard = perspective.graveyard || [];
  const faceUpMiragebounds = field.filter(isFaceUpMirageboundMonster);
  let score = base;
  score += faceUpMiragebounds.length * 0.35;
  if (perspective.fieldSpell?.name === MB.OASIS) score += 1.4;
  if (hasName(faceUpMiragebounds, MB.GLASS_SOVEREIGN)) score += 2.6;
  if (hasName(faceUpMiragebounds, MB.DESERT_LEVIATHAN)) score += 2.4;
  if (hasName(faceUpMiragebounds, MB.SCOUT)) {
    const activations = getMaterialEffectActivations(
      gameOrState,
      perspective,
      351,
    );
    score += Math.min(2, activations) * 0.5;
  }
  if (hasName(faceUpMiragebounds, MB.GLASS_VIPER)) score += 0.8;
  if (hasName(faceUpMiragebounds, MB.REBEL)) score += 1.1;
  if (
    hasName(faceUpMiragebounds, MB.SAND_PRIESTESS) &&
    graveyard.some(isMiragebound)
  ) {
    score += 0.8;
  }
  const defenseTargets = (opponent?.field || []).filter(
    (card) => card?.position === "defense",
  ).length;
  if (hasName(faceUpMiragebounds, MB.GLASS_SOVEREIGN)) {
    score += defenseTargets * 0.35;
  }
  if (hasName(faceUpMiragebounds, MB.REBEL)) {
    score += defenseTargets * 0.25;
  }
  return score;
}
