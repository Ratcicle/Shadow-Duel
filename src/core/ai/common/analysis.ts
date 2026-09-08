import { canUseNormalSummonForCard } from "../../Player.js";
import type { GameCard } from "../../contracts/cards.js";
import type {
  AIState,
  AIStrategyBotPort,
  StrategyRuntimePort,
} from "../../contracts/ai.js";
import type {
  AiStateShape,
  SimulatedCardState,
  SimulatedCardShape,
  SimulatedPlayerState,
} from "../../contracts/aiState.js";

interface StrategyAnalysisInput {
  bot?: AIStrategyBotPort | null;
  player?: AIStrategyBotPort | null;
  opponent?: AIStrategyBotPort | null;
  game?: (AIState & {
    getOpponent?(player: SimulatedPlayerState): SimulatedPlayerState | null;
  }) | null;
  strategy?: Pick<StrategyRuntimePort, "bot" | "getOpponent"> | null;
}

export type StrategyAnalysis<Player extends AIStrategyBotPort> = {
  hand: Player["hand"];
  field: Player["field"];
  spellTrap: Player["spellTrap"];
  fieldSpell: Player["fieldSpell"];
  graveyard: Player["graveyard"];
  deck: Player["deck"];
  extraDeck: Player["extraDeck"];
  lp: number;
  oppField: Player["field"];
  oppHand: Player["hand"];
  oppGraveyard: Player["graveyard"];
  oppSpellTrap: Player["spellTrap"];
  oppFieldSpell: Player["fieldSpell"];
  oppLp: number;
  oppLP: number;
  currentTurn: number;
  phase: string;
  player: Player | null;
  opponent: Player | null;
  bot: Player | null;
  game: StrategyAnalysisInput["game"];
  summonAvailable: boolean;
  normalSummonsAvailable: number;
  additionalNormalSummons: number;
  isSimulatedState: boolean;
};

type ExplicitActorAnalysisInput<Player extends AIStrategyBotPort> = Omit<
  StrategyAnalysisInput, "bot" | "player" | "opponent"
> & { opponent?: Player | null } & (
  | { player: Player; bot?: Player | null }
  | { bot: Player; player?: null }
);

export function buildStrategyAnalysis<Player extends AIStrategyBotPort>(
  input: ExplicitActorAnalysisInput<Player>,
): StrategyAnalysis<Player>;
export function buildStrategyAnalysis(
  input?: StrategyAnalysisInput,
): StrategyAnalysis<AIStrategyBotPort>;
export function buildStrategyAnalysis({
  bot,
  player,
  opponent,
  game,
  strategy,
}: StrategyAnalysisInput = {}) {
  const actor = (player || bot || strategy?.bot || game?.bot || null) as AIStrategyBotPort | null;
  const resolvedOpponent = (
    opponent ||
    (game && actor && strategy && typeof strategy.getOpponent === "function"
      ? strategy.getOpponent(game, actor as SimulatedPlayerState)
      : null) ||
    (game && actor && typeof game.getOpponent === "function"
      ? game.getOpponent(actor as SimulatedPlayerState)
      : null) ||
    (actor && game?.bot && actor === game.bot
      ? game?.player
      : game?.bot) ||
    null) as AIStrategyBotPort | null;
  const hand = actor?.hand || [];
  const normalSummonCandidates = hand.filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      !card.cannotBeNormalSummonedOrSet &&
      card.summonRestrict !== "shadow_heart_invocation_only" &&
      canUseNormalSummonForCard(actor as SimulatedPlayerState, card),
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

export function cardHasRelevantTriggerForSummonMethod(
  card: GameCard | SimulatedCardShape | null | undefined,
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
