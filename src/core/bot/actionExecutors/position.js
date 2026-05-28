export async function executePositionChangeAction(bot, game, action) {
  const target = Number.isInteger(action.fieldIndex)
    ? bot.field?.[action.fieldIndex]
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
  game.changeMonsterPosition(target, newPosition);
  return true;
}
