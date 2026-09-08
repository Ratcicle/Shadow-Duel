import type { BotRuntimePort, BotGamePort } from "../../contracts/bot.js";
import type { AIActionOf, ExtraDeckMaterialHint, AIActivationContext } from "../../contracts/ai.js";
import type { GameCard } from "../../contracts/cards.js";
export async function executeAscensionAction(bot: BotRuntimePort, game: BotGamePort, action: AIActionOf<"ascension">): Promise<boolean> {
  try {
    const material = bot.field[action.materialIndex!];
    if (!material) {
      console.log(
        `[Bot.executeMainPhaseAction] ❌ Ascension: material not found at index ${action.materialIndex}`,
      );
      return false;
    }

    console.log(
      `[Bot.executeMainPhaseAction] 🔥 Attempting Ascension: ${material.name} → ${action.ascensionCard!.name}`,
    );

    const result = await game.performAscensionSummon(
      bot,
      material,
      action.ascensionCard! as GameCard,
      {
        position:
          action.position ||
          bot.getAscensionPositionPreference(
            action.ascensionCard! as GameCard,
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
