import { canUseNormalSummonForCard } from "../../Player.js";

export function buildStrategyAnalysis({
  bot,
  player,
  opponent,
  game,
  strategy,
} = {}) {
  const actor = player || bot || strategy?.bot || game?.bot || null;
  const resolvedOpponent =
    opponent ||
    (game && actor && strategy && typeof strategy.getOpponent === "function"
      ? strategy.getOpponent(game, actor)
      : null) ||
    (game && actor && typeof game.getOpponent === "function"
      ? game.getOpponent(actor)
      : null) ||
    (actor && game?.bot && actor === game.bot ? game?.player : game?.bot) ||
    null;
  const hand = actor?.hand || [];
  const normalSummonCandidates = hand.filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      !card.cannotBeNormalSummonedOrSet &&
      card.summonRestrict !== "shadow_heart_invocation_only" &&
      canUseNormalSummonForCard(actor, card),
  );
  const genericNormalSummonsAvailable = Math.max(
    0,
    1 +
      Math.max(0, Number(actor?.additionalNormalSummons || 0)) -
      Math.max(0, Number(actor?.summonCount || 0)),
  );
  const normalSummonsAvailable = Math.max(
    genericNormalSummonsAvailable,
    normalSummonCandidates.length > 0 ? 1 : 0,
  );

  return {
    hand,
    field: actor?.field || [],
    spellTrap: actor?.spellTrap || [],
    fieldSpell: actor?.fieldSpell || null,
    graveyard: actor?.graveyard || [],
    deck: actor?.deck || [],
    extraDeck: actor?.extraDeck || [],
    lp: actor?.lp || 8000,
    oppField: resolvedOpponent?.field || [],
    oppHand: resolvedOpponent?.hand || [],
    oppGraveyard: resolvedOpponent?.graveyard || [],
    oppSpellTrap: resolvedOpponent?.spellTrap || [],
    oppFieldSpell: resolvedOpponent?.fieldSpell || null,
    oppLp: resolvedOpponent?.lp || 8000,
    oppLP: resolvedOpponent?.lp || 8000,
    currentTurn: game?.turnCounter || 1,
    phase: game?.phase || "main1",
    player: actor,
    opponent: resolvedOpponent,
    bot: actor,
    game,
    summonAvailable: normalSummonsAvailable > 0,
    normalSummonsAvailable,
    additionalNormalSummons: actor?.additionalNormalSummons || 0,
    isSimulatedState: game?._isPerspectiveState === true,
  };
}

export function cardHasRelevantTriggerForSummonMethod(card, method) {
  if (!card || !method) return false;
  const normalizedMethod = String(method).toLowerCase();
  const methodAliases =
    normalizedMethod === "tribute"
      ? new Set(["tribute"])
      : new Set([normalizedMethod]);

  return (card.effects || []).some((effect) => {
    if (!effect) return false;

    if (
      effect.requireSelfWasSummonedBy &&
      methodAliases.has(String(effect.requireSelfWasSummonedBy).toLowerCase())
    ) {
      return true;
    }

    if (
      effect.timing === "on_event" &&
      effect.event === "after_summon" &&
      effect.requireSelfAsSummoned
    ) {
      const summonMethods = Array.isArray(effect.summonMethods)
        ? effect.summonMethods.map((entry) => String(entry).toLowerCase())
        : [];
      if (summonMethods.length === 0) return true;
      return summonMethods.some((entry) => methodAliases.has(entry));
    }

    return false;
  });
}
