import { getUI } from "../shared.js";

export async function performSummonFromHand(
  card,
  handIndex,
  player,
  action,
  engine,
) {
  const game = engine.game;

  if (!card || card.cardKind !== "monster") {
    console.error(
      `[performSummonFromHand] ❌ BLOCKED: Attempted to summon non-monster "${card?.name}" (kind: ${card?.cardKind})`,
    );
    return false;
  }

  const restrictionCheck = game?.canSpecialSummonUnderRestrictions?.(card, player, {
    summonMethod: "special",
    fromZone: "hand",
    silent: false,
  });
  if (restrictionCheck?.ok === false) {
    return false;
  }

  const position = await engine.chooseSpecialSummonPosition(card, player, {
    position: action.position,
  });

  const moveResult =
    typeof game.moveCard === "function"
      ? await game.moveCard(card, player, "field", {
          fromZone: "hand",
          position,
          isFacedown: false,
          resetAttackFlags: true,
        })
      : null;

  if (moveResult && moveResult.success === false) {
    return false;
  }

  if (moveResult && moveResult.negated) {
    return false;
  }

  if (moveResult == null) {
    player.hand.splice(handIndex, 1);

    card.position = position;
    card.isFacedown = false;
    card.hasAttacked = false;
    card.owner = player.id;
    card.controller = player.id;

    player.field.push(card);
  }

  card.cannotAttackThisTurn =
    action.restrictAttackThisTurn || action.cannotAttackThisTurn || false;

  getUI(game)?.log(
    `${player.name || player.id} Special Summoned ${card.name} from hand.`,
  );

  game.updateBoard();

  if (game.finishSelection && typeof game.finishSelection === "function") {
    game.finishSelection();
  }

  return true;
}
