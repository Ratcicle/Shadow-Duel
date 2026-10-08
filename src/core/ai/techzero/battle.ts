import type { BotStrategyPort } from "../../contracts/bot.js";
import { evaluateVisibleBattle } from "../common/battleProjection.js";
export { evaluateVisibleBattle as evaluateTechZeroVisibleBattle } from "../common/battleProjection.js";
export type { VisibleBattleAttack as TechZeroBattleAttack, VisibleBattleProjection as TechZeroBattleProjection } from "../common/battleProjection.js";
export function scoreTechZeroBattleAttackCandidate(
  context: Parameters<NonNullable<BotStrategyPort["scoreBattleAttackCandidate"]>>[0],
): number {
  if (context.attacker?.instanceId == null) return -10000 - context.baseDelta;
  const projected = evaluateVisibleBattle(context.bot, context.opponent, context.game.turnCounter || 0, {
    attackerInstanceId: context.attacker.instanceId, targetInstanceId: context.target?.instanceId ?? null,
  });
  // The generic one-attack delta can read hidden identities or miss protection.
  // Replace it with the score of this public, sequential continuation.
  return projected.score - context.baseDelta;
}
