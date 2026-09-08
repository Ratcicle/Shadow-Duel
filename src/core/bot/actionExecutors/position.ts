import type { BotRuntimePort, BotGamePort } from "../../contracts/bot.js";
import type { AIActionOf, ExtraDeckMaterialHint, AIActivationContext } from "../../contracts/ai.js";
import type { GameCard } from "../../contracts/cards.js";
export async function executePositionChangeAction(bot: BotRuntimePort, game: BotGamePort, action: AIActionOf<"position_change">): Promise<boolean> {
  const target = Number.isInteger(action.fieldIndex)
    ? bot.field?.[action.fieldIndex!]
    : (bot.field || []).find(
        (c) =>
          c &&
          (c.id === action.cardId ||
            (!action.cardId && c.name === action.cardName)),
      );
  if (!target) return false;
  const newPosition =
    action.toPosition === "defense" ? "defense" : "attack";
  if (
    typeof game?.canChangePosition === "function" &&
    !game.canChangePosition(target)
  ) {
    return false;
  }
  if (target.position === newPosition) return false;
  const result = await game.changeMonsterPosition(target, newPosition);
  return result?.ok !== false;
}
