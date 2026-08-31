import { canUseNormalSummonForCard } from "../../Player.js";
import type {
  AIState,
  StrategyRuntimePort,
} from "../../contracts/ai.js";
import type {
  AiStateShape,
  SimulatedCardState,
  SimulatedPlayerState,
} from "../../contracts/aiState.js";

interface StrategyAnalysisInput {
  bot?: SimulatedPlayerState | null;
  player?: SimulatedPlayerState | null;
  opponent?: SimulatedPlayerState | null;
  game?: (AiStateShape & {
    getOpponent?(player: SimulatedPlayerState): SimulatedPlayerState | null;
  }) | null;
  strategy?: StrategyRuntimePort | null;
}

export function buildStrategyAnalysis({
  bot,
  player,
  opponent,
  game,
  strategy,
}: StrategyAnalysisInput = {}) {
  const actor = player || bot || strategy?.bot || game?.bot || null;
  const projectedActor = actor ? actor as SimulatedPlayerState : null;
  const resolvedOpponent =
    opponent ||
    (game && projectedActor && strategy && typeof strategy.getOpponent === "function"
      ? strategy.getOpponent(game, projectedActor)
      : null) ||
    (game && projectedActor && typeof game.getOpponent === "function"
      ? game.getOpponent(projectedActor)
      : null) ||
    (projectedActor && game?.bot && projectedActor === game.bot
      ? game?.player
      : game?.bot) ||
    null;
  const hand = projectedActor?.hand || [];
  const normalSummonCandidates = hand.filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      !card.cannotBeNormalSummonedOrSet &&
      card.summonRestrict !== "shadow_heart_invocation_only" &&
      canUseNormalSummonForCard(projectedActor, card),
  );
  const genericNormalSummonsAvailable = Math.max(
    0,
    1 +
      Math.max(0, Number(projectedActor?.additionalNormalSummons || 0)) -
      Math.max(0, Number(projectedActor?.summonCount || 0)),
  );
  const normalSummonsAvailable = Math.max(
    genericNormalSummonsAvailable,
    normalSummonCandidates.length > 0 ? 1 : 0,
  );

  return {
    hand,
    field: projectedActor?.field || [],
    spellTrap: projectedActor?.spellTrap || [],
    fieldSpell: projectedActor?.fieldSpell || null,
    graveyard: projectedActor?.graveyard || [],
    deck: projectedActor?.deck || [],
    extraDeck: projectedActor?.extraDeck || [],
    lp: projectedActor?.lp || 8000,
    oppField: resolvedOpponent?.field || [],
    oppHand: resolvedOpponent?.hand || [],
    oppGraveyard: resolvedOpponent?.graveyard || [],
    oppSpellTrap: resolvedOpponent?.spellTrap || [],
    oppFieldSpell: resolvedOpponent?.fieldSpell || null,
    oppLp: resolvedOpponent?.lp || 8000,
    oppLP: resolvedOpponent?.lp || 8000,
    currentTurn: game?.turnCounter || 1,
    phase: game?.phase || "main1",
    player: projectedActor,
    opponent: resolvedOpponent,
    bot: projectedActor,
    game,
    summonAvailable: normalSummonsAvailable > 0,
    normalSummonsAvailable,
    additionalNormalSummons: projectedActor?.additionalNormalSummons || 0,
    isSimulatedState: game?._isPerspectiveState === true,
  };
}

export function cardHasRelevantTriggerForSummonMethod(
  card: SimulatedCardState | null | undefined,
  method: string | null | undefined,
): boolean {
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
