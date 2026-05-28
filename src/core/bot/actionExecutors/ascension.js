export async function executeAscensionAction(bot, game, action) {
  try {
    const material = bot.field[action.materialIndex];
    if (!material) {
      console.log(
        `[Bot.executeMainPhaseAction] ❌ Ascension: material not found at index ${action.materialIndex}`,
      );
      return false;
    }

    console.log(
      `[Bot.executeMainPhaseAction] 🔥 Attempting Ascension: ${material.name} → ${action.ascensionCard.name}`,
    );

    const result = await game.performAscensionSummon(
      bot,
      material,
      action.ascensionCard,
      {
        position:
          action.position ||
          bot.getAscensionPositionPreference(
            action.ascensionCard,
            material,
            game,
          ),
      },
    );

    if (result?.success) {
      console.log(
        `[Bot.executeMainPhaseAction] ✅ Ascension successful: ${action.ascensionCard.name}`,
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
      e.message,
    );
    return false;
  }
}
