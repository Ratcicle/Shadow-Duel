import { getUI } from "../shared.js";
import type { ActionOf } from "../../contracts/actions.js";
import type {
  ActionHandlerEnginePort,
  ActionRuntimeCard,
  ActionRuntimePlayer,
  LegacyActionHandlerResult,
} from "../../contracts/actionRuntime.js";

type SummonFromHandAction = ActionOf<
  "conditional_summon_from_hand" | "draw_and_summon"
> & {
  readonly restrictAttackThisTurn?: boolean;
  readonly cannotAttackThisTurn?: boolean;
};

export async function performSummonFromHand(
  card: ActionRuntimeCard,
  handIndex: number,
  player: ActionRuntimePlayer,
  action: SummonFromHandAction,
  engine: ActionHandlerEnginePort,
): Promise<LegacyActionHandlerResult> {
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

  const position = await Reflect.apply(
    engine.chooseSpecialSummonPosition!,
    engine,
    [card, player, { position: action.position }],
  );

  const moveResult =
    typeof game.moveCard === "function"
      ? await game.moveCard(card, player, "field", {
          fromZone: "hand",
          position,
          isFacedown: false,
          resetAttackFlags: true,
          summonOrigin: "effect_resolution",
          summonMethodOverride: "special",
          summonProcedure: "card_effect",
        })
      : null;

  if (
    moveResult &&
    typeof moveResult === "object" &&
    moveResult.success === false
  ) {
    return false;
  }

  if (moveResult && typeof moveResult === "object" && moveResult.negated) {
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

  game.updateBoard!();

  if (game.finishSelection && typeof game.finishSelection === "function") {
    game.finishSelection();
  }

  return true;
}
