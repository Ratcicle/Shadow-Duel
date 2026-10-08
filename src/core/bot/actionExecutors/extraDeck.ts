import type { BotRuntimePort, BotGamePort } from "../../contracts/bot.js";
import type { AIActionOf } from "../../contracts/ai.js";
import { resolveSynchroActionForCurrentState, findExtraDeckCardForAction, resolveExtraDeckProcedureMaterials } from "../actionValidation.js";

export async function executeSynchroAction(
  bot: BotRuntimePort,
  game: BotGamePort,
  action: AIActionOf<"synchro">,
): Promise<boolean> {
  const resolved = resolveSynchroActionForCurrentState(bot, action, game);
  if (!resolved) return false;
  const result = await game.performSynchroSummon(bot, resolved.materials, resolved.card, {
    position: action.position,
  });
  return result.success === true;
}

export async function executeExtraDeckProcedureAction(bot: BotRuntimePort, game: BotGamePort, action: AIActionOf<"extraDeckProcedure">): Promise<boolean> {
  try {
    const card = findExtraDeckCardForAction(bot, action);
    if (!card) {
      console.log(
        `[Bot.executeMainPhaseAction] Extra Deck: card not found for ${action.cardName}`,
      );
      return false;
    }

    const materials = resolveExtraDeckProcedureMaterials(bot, action);
    if (!materials.length) {
      console.log(
        `[Bot.executeMainPhaseAction] Extra Deck: materials not found for ${card.name}`,
      );
      return false;
    }

    const result = await game.performExtraDeckSummonProcedure(card, bot, {
      materials,
      position: (action.position || "attack") as "attack" | "defense",
    });

    if (result?.success) {
      console.log(
        `[Bot.executeMainPhaseAction] Extra Deck summon successful: ${card.name}`,
      );
      game.updateBoard?.();
      return true;
    }

    console.log(
      `[Bot.executeMainPhaseAction] Extra Deck summon failed:`,
      result?.reason,
    );
    return false;
  } catch (error) {
    console.error(
      `[Bot.executeMainPhaseAction] Extra Deck summon error:`,
      (error as Error)?.message || error,
    );
    return false;
  }
}
