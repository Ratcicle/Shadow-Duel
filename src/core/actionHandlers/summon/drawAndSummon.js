import { isAI } from "../../Player.js";
import { getCardDisplayName, getUIText } from "../../i18n.js";
import { getUI } from "../shared.js";
import { performSummonFromHand } from "./fromHand.js";

export async function handleDrawAndSummon(action, ctx, targets, engine) {
  const { player } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const drawAmount = action.drawAmount || 1;
  const condition = action.condition || {};
  const optional = action.optional !== false;

  const drawn = game.drawCards(player, drawAmount);

  if (!drawn || !drawn.ok || !drawn.drawn || drawn.drawn.length === 0) {
    return false;
  }

  const drawnCard = drawn.drawn[0];
  if (!drawnCard) return false;

  game.updateBoard();

  if (typeof game.waitForPresentationDelay === "function") {
    await game.waitForPresentationDelay(400);
  } else {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  let conditionMet = false;

  if (condition.type === "match_card_props") {
    const typeName = condition.typeName || null;
    const minLevel = Number.isFinite(condition.minLevel)
      ? condition.minLevel
      : null;
    const maxLevel = Number.isFinite(condition.maxLevel)
      ? condition.maxLevel
      : null;
    const requireKind = condition.cardKind || null;

    let ok = true;

    if (typeName) {
      const types = Array.isArray(drawnCard.types) ? drawnCard.types : null;
      const cardType = drawnCard.type || null;
      ok = types ? types.includes(typeName) : cardType === typeName;
    }

    if (ok && requireKind) {
      ok = drawnCard.cardKind === requireKind;
    }

    if (ok && minLevel !== null) {
      ok = (drawnCard.level || 0) >= minLevel;
    }

    if (ok && maxLevel !== null) {
      ok = (drawnCard.level || 0) <= maxLevel;
    }

    conditionMet = ok;
  } else {
    conditionMet = true;
  }

  if (!conditionMet) {
    return false;
  }

  if (player.field.length >= 5) {
    getUI(game)?.log("Field is full, cannot Special Summon.");
    return false;
  }

  const handIndex = player.hand.indexOf(drawnCard);
  if (handIndex === -1) {
    return false;
  }

  if (isAI(player)) {
    return await performSummonFromHand(
      drawnCard,
      handIndex,
      player,
      action,
      engine,
    );
  }

  if (optional) {
    const cardName = getCardDisplayName(drawnCard) || drawnCard.name;
    const wantsToSummon =
      (await getUI(game)?.showConfirmPrompt?.(
        getUIText("ui.summon.drawnPrompt", { cardName }),
        { kind: "draw_and_summon", cardName },
      )) ?? false;

    if (!wantsToSummon) {
      return false;
    }
  }

  return await performSummonFromHand(
    drawnCard,
    handIndex,
    player,
    action,
    engine,
  );
}

