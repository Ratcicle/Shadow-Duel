import { getUI } from "../shared.js";

export async function handleRestrictSpecialSummons(action, ctx, _targets, engine) {
  const game = engine?.game;
  const targetPlayer = action.player === "opponent" ? ctx?.opponent : ctx?.player;
  const allowedFilters = action.allowedFilters || null;

  if (!game || !targetPlayer || !allowedFilters) {
    return false;
  }

  const success = game.registerSpecialSummonRestriction?.(targetPlayer, {
    allowedFilters,
    duration: action.duration || "until_end_turn",
    reason: action.reason || null,
    sourceCard: ctx?.source || ctx?.card || null,
    effectId: ctx?.effect?.id || null,
  });

  if (success && action.logMessage) {
    getUI(game)?.log(action.logMessage);
  }
  return success === true;
}
