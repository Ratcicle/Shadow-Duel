import type { BotRuntimePort, BotGamePort } from "../../contracts/bot.js";
import type { AIActionOf } from "../../contracts/ai.js";
import { canResolveHandSummonProcedureActionForCurrentState, resolveHandProcedureMaterials } from "../actionValidation.js";
import { selectPayableTributes } from "../../ai/common/tributePolicy.js";
import { publicOpponentView } from "../../ai/common/planningCopy.js";

export async function executeHandSummonProcedureAction(
  bot: BotRuntimePort,
  game: BotGamePort,
  action: AIActionOf<"handSummonProcedure">,
): Promise<boolean> {
  if (!canResolveHandSummonProcedureActionForCurrentState(bot, action, game)) return false;
  const index = bot.resolveHandIndexForAction(action, "monster");
  const card = bot.hand[index];
  const materials = resolveHandProcedureMaterials(bot, action.materials, action);
  if (!card || !materials) return false;
  const result = await game.performHandSummonProcedure(card, bot, {
    materials,
    position: action.position === "defense" ? "defense" : "attack",
  });
  if (result.success !== true) return false;
  game.updateBoard();
  await game.waitForBoardPresentation?.();
  return true;
}

export async function executeSummonAction(
  bot: BotRuntimePort,
  game: BotGamePort,
  action: AIActionOf<"summon">,
): Promise<boolean> {
  const resolvedIndex = bot.resolveHandIndexForAction(action, "monster");
  if (resolvedIndex < 0) {
    console.log(
      `[Bot.executeMainPhaseAction] Invalid summon action: no matching monster in hand (index=${
        action.index
      }, card=${action.cardName || "unknown"})`,
    );
    return false;
  }
  const cardToSummon = bot.hand[resolvedIndex]!; // resolveHandIndexForAction validated this occupied slot.
  if (!bot.canResolveSummonActionForCurrentState(action, game)) {
    console.log(
      `[Bot.executeMainPhaseAction] Invalid summon action: summon requirements no longer met for ${cardToSummon?.name || action.cardName || "unknown"}`,
    );
    return false;
  }

  // Calcular tributos necessários e selecionar os melhores (piores monstros)
  const tributeInfo = bot.getTributeRequirementFor(cardToSummon, bot);
  let tributeIndices: number[] | null = null;

  if (tributeInfo.tributesNeeded > 0) {
    const opponent = bot === game.player ? game.bot : game.player;
    // The tribute policies read the opponent's field as any live decision does.
    const oppField = publicOpponentView(opponent).field;
    const selection = selectPayableTributes(bot, bot.field, game, candidates => bot.selectBestTributes(
      candidates,
      tributeInfo.tributesNeeded,
      cardToSummon,
      { oppField, game },
    ));
    tributeIndices = selection.indices;
    const tradeCheck =
      typeof bot.evaluateTributeTrade === "function"
        ? bot.evaluateTributeTrade(
            cardToSummon,
            selection.candidates,
            tributeInfo.tributesNeeded,
            {
              oppField,
              game,
            },
          )
        : { ok: true };
    if (tradeCheck?.ok === false) {
      console.log(
        `[Bot.executeMainPhaseAction] Tribute summon rejected for ${
          cardToSummon?.name || action.cardName || "unknown"
        }: ${tradeCheck.reason || "bad tribute trade"}`,
      );
      return false;
    }
  }

  const summonResult = await game.performNormalSummon(
    bot,
    resolvedIndex,
    action.position as "attack" | "defense" | undefined,
    action.facedown,
    tributeIndices,
  );
  if (summonResult?.success === true) {
    const card = summonResult.card;

    game.ui?.log(
      `Bot summons ${action.facedown ? "a monster in defense" : card!.name}`,
    );
    game.updateBoard();
    await game.waitForBoardPresentation?.();

    // Let the summon become visible before resolving on-summon triggers.
    const isFacedownSet = action.facedown === true;
    if (
      !isFacedownSet &&
      typeof game?.waitForAiPresentationStep === "function"
    ) {
      await game.waitForAiPresentationStep(bot);
    }

    game.updateBoard();
    return true;
  }
  return false;
}
