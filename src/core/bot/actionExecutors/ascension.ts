import { resolveAscensionActionForCurrentState } from "../actionValidation.js";
import type { BotRuntimePort, BotGamePort } from "../../contracts/bot.js";
import type { AIActionOf } from "../../contracts/ai.js";
export async function executeAscensionAction(bot: BotRuntimePort, game: BotGamePort, action: AIActionOf<"ascension">): Promise<boolean> {
  try {
    const resolved = resolveAscensionActionForCurrentState(bot, action);
    if (!resolved) {
      console.log(
        `[Bot.executeMainPhaseAction] ❌ Ascension: material not found at index ${action.materialIndex}`,
      );
      return false;
    }

    const { material, card } = resolved;
    console.log(
      `[Bot.executeMainPhaseAction] 🔥 Attempting Ascension: ${material.name} → ${action.ascensionCard!.name}`,
    );

    const result = await game.performAscensionSummonFromExtraDeck(
      card,
      bot,
      {
        material,
        position:
          action.position ||
          bot.getAscensionPositionPreference(
            card,
            material,
            game,
          ),
      },
    );

    if (result?.success) {
      console.log(
        `[Bot.executeMainPhaseAction] ✅ Ascension successful: ${action.ascensionCard!.name}`,
      );
      game.updateBoard();
      return true;
    } else {
      console.log(
        `[Bot.executeMainPhaseAction] ❌ Ascension failed:`,
        result?.reason,
      );
      return false;
    }
  } catch (e) {
    console.error(
      `[Bot.executeMainPhaseAction] ❌ Ascension error:`,
      (e as Error).message,
    );
    return false;
  }
}
