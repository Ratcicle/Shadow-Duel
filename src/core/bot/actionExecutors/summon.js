export async function executeSpecialSummonSanctumProtectorAction(bot, game, action) {
  const resolvedIndex = bot.resolveHandIndexForAction(action, "monster");
  if (resolvedIndex < 0) {
    console.log(
      `[Bot.executeMainPhaseAction] Invalid Sanctum Protector action: no matching card in hand (index=${
        action.index
      }, card=${action.cardName || "unknown"})`,
    );
    return false;
  }

  const card = bot.hand[resolvedIndex];
  if (!card || card.name !== "Luminarch Sanctum Protector") {
    console.log(
      `[Bot.executeMainPhaseAction] Invalid Sanctum Protector action: card mismatch`,
    );
    return false;
  }

  const materialIndex = Number.isInteger(action.materialIndex)
    ? action.materialIndex
    : bot.field.findIndex(
        (c) => c && c.name === "Luminarch Aegisbearer" && !c.isFacedown,
      );
  const material = bot.field[materialIndex];
  if (
    !material ||
    material.name !== "Luminarch Aegisbearer" ||
    material.isFacedown
  ) {
    console.log(
      `[Bot.executeMainPhaseAction] Invalid Sanctum Protector action: no face-up Aegisbearer`,
    );
    return false;
  }

  const sendResult = await game.moveCard(material, bot, "graveyard", {
    fromZone: "field",
    contextLabel: "sanctum_protector_cost",
  });
  if (sendResult?.success === false) {
    console.log(
      `[Bot.executeMainPhaseAction] Sanctum Protector cost failed:`,
      sendResult?.reason,
    );
    return false;
  }

  const position = action.position === "attack" ? "attack" : "defense";
  const summonResult = await game.moveCard(card, bot, "field", {
    fromZone: "hand",
    position,
    isFacedown: false,
    resetAttackFlags: true,
    contextLabel: "sanctum_protector_special",
  });
  if (summonResult?.success === false) {
    console.log(
      `[Bot.executeMainPhaseAction] Sanctum Protector summon failed:`,
      summonResult?.reason,
    );
    return false;
  }

  if (game && typeof game.emit === "function") {
    await game.emit("after_summon", {
      card,
      player: bot,
      method: "special",
      fromZone: "hand",
    });
  }

  game.ui?.log(
    `Bot special summoned ${card.name} by sending ${material.name} to the GY.`,
  );
  game.updateBoard();
  return true;
}

export async function executeSummonAction(bot, game, action) {
  const resolvedIndex = bot.resolveHandIndexForAction(action, "monster");
  if (resolvedIndex < 0) {
    console.log(
      `[Bot.executeMainPhaseAction] Invalid summon action: no matching monster in hand (index=${
        action.index
      }, card=${action.cardName || "unknown"})`,
    );
    return false;
  }
  const cardToSummon = bot.hand[resolvedIndex];
  if (!bot.canResolveSummonActionForCurrentState(action, game)) {
    console.log(
      `[Bot.executeMainPhaseAction] Invalid summon action: summon requirements no longer met for ${cardToSummon?.name || action.cardName || "unknown"}`,
    );
    return false;
  }

  // Calcular tributos necessários e selecionar os melhores (piores monstros)
  const tributeInfo = bot.getTributeRequirementFor(cardToSummon, bot);
  let tributeIndices = null;

  if (tributeInfo.tributesNeeded > 0) {
    const opponent = bot === game.player ? game.bot : game.player;
    tributeIndices = bot.selectBestTributes(
      bot.field,
      tributeInfo.tributesNeeded,
      cardToSummon,
      { oppField: opponent.field, game },
    );
    const tradeCheck =
      typeof bot.evaluateTributeTrade === "function"
        ? bot.evaluateTributeTrade(cardToSummon, bot.field, tributeInfo.tributesNeeded, {
            oppField: opponent.field,
            game,
          })
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
    action.position,
    action.facedown,
    tributeIndices,
  );
  if (summonResult) {
    // Handle both old (card) and new ({card, tributes}) return formats
    const card = summonResult.card || summonResult;
    const tributes = summonResult.tributes || [];

    game.ui?.log(
      `Bot summons ${action.facedown ? "a monster in defense" : card.name}`,
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

    // Emit after_summon event for trigger effects (e.g., Void Mage search)
    // Only trigger if summoned face-up (facedown set doesn't trigger "when Normal Summoned" effects)
    if (!isFacedownSet && game && typeof game.emit === "function") {
      await game.emit("after_summon", {
        card,
        player: bot,
        method: tributeInfo.tributesNeeded > 0 ? "tribute" : "normal",
        fromZone: "hand",
        tributes: tributes,
      });
    }

    game.updateBoard();
    return true;
  }
  return false;
}
