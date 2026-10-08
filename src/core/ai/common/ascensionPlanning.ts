import { bindPlanningActionPresence } from "./actionIdentity.js";
import { getCounterValue } from "./counters.js";
import { matchesTargetFilters } from "./targetSelection.js";
import {
  canUseAsAscensionMaterial, checkAscensionRequirements, getMaterialFieldAgeTurnCounter,
  type AscensionReadCard, type AscensionReadPlayer, type AscensionReadHost,
} from "../../game/summon/ascension.js";
import { createMaterialDuelStats } from "../../game/summon/materialStats.js";
import type {
  AscensionAIAction,
  AIStrategyBotPort,
} from "../../contracts/ai.js";
import type {
  AiStateShape,
  SimulatedCardState,
  SimulatedPlayerState,
} from "../../contracts/aiState.js";
import type { BattlePositionInput, GameCard } from "../../contracts/cards.js";

type AscensionPlanningCard = SimulatedCardState | GameCard;
type AscensionPlanningPlayer = SimulatedPlayerState | AIStrategyBotPort;

interface AscensionCheckResult {
  ok: boolean;
  reason?: string;
}

/** Adapt snapshot reads to the runtime query without attaching methods or
 * consuming counters on the snapshot. Every query card has one physical view. */
export function checkSimulatedAscension(
  state: Pick<AiStateShape, "turnCounter" | "materialDuelStats" | "bot" | "player">,
  material: SimulatedCardState,
  ascensionCard: SimulatedCardState,
): AscensionCheckResult {
  const views = new Map<SimulatedCardState, AscensionReadCard>();
  const originals = new Map<AscensionReadCard, SimulatedCardState>();
  const viewCard = (card: SimulatedCardState): AscensionReadCard => {
    const previous = views.get(card);
    if (previous) return previous;
    const view = { ...card, getCounter: (type: string) => getCounterValue(card, type) };
    views.set(card, view); originals.set(view, card);
    return view;
  };
  const viewPlayer = (player: SimulatedPlayerState): AscensionReadPlayer => ({
    id: player.id, lp: player.lp,
    hand: player.hand.map(viewCard), field: player.field.map(viewCard),
    deck: player.deck.map(viewCard), graveyard: player.graveyard.map(viewCard),
    spellTrap: player.spellTrap.map(viewCard), extraDeck: player.extraDeck.map(viewCard),
    banished: player.banished.map(viewCard), fieldSpell: player.fieldSpell ? viewCard(player.fieldSpell) : null,
  });
  const player = viewPlayer(state.bot), opponent = viewPlayer(state.player);
  const query: AscensionReadHost = {
    turnCounter: state.turnCounter || 0,
    materialDuelStats: state.materialDuelStats || createMaterialDuelStats(),
    effectEngine: { cardMatchesFilters: (card, filters) => matchesTargetFilters(originals.get(card), {
      ...filters, currentTurn: state.turnCounter || 0,
    }) },
    getOpponent: owner => owner === player ? opponent : player,
    getMaterialFieldAgeTurnCounter: card => getMaterialFieldAgeTurnCounter.call(query, card),
    devLog() {},
  };
  const materialView = viewCard(material);
  const materialCheck = canUseAsAscensionMaterial.call(query, player, materialView);
  return materialCheck.ok
    ? checkAscensionRequirements.call(query, player, viewCard(ascensionCard), materialView)
    : materialCheck;
}

interface AscensionPlanningGame {
  canUseAsAscensionMaterial?(
    player: AscensionPlanningPlayer,
    material: AscensionPlanningCard,
  ): AscensionCheckResult;
  getAscensionCandidatesForMaterial?(
    player: AscensionPlanningPlayer,
    material: AscensionPlanningCard,
  ): AscensionPlanningCard[];
  checkAscensionRequirements?(
    player: AscensionPlanningPlayer,
    ascensionCard: AscensionPlanningCard,
    material: AscensionPlanningCard,
  ): AscensionCheckResult;
}

interface AscensionPlanningContext<Player extends AscensionPlanningPlayer = AscensionPlanningPlayer, Game extends AscensionPlanningGame = AscensionPlanningGame, Analysis = unknown> {
  game?: Game | null | undefined;
  bot?: Player | null | undefined;
  player?: Player | null | undefined;
  opponent?: Player | null | undefined;
  analysis?: Analysis;
  isSimulatedState?: boolean;
}

interface AscensionCandidateContext<Card extends AscensionPlanningCard = AscensionPlanningCard, Player extends AscensionPlanningPlayer = AscensionPlanningPlayer, Game extends AscensionPlanningGame = AscensionPlanningGame, Analysis = unknown> extends AscensionPlanningContext<Player, Game, Analysis> {
  material: Card;
  materialIndex: number;
  canCheckAscension: boolean;
  ascensionCard?: Card;
}

interface PlannedAscensionAction extends AscensionAIAction {
  extraDeck: true;
}

interface AscensionPlanningPolicy<Card extends AscensionPlanningCard = AscensionPlanningCard, Player extends AscensionPlanningPlayer = AscensionPlanningPlayer, Game extends AscensionPlanningGame = AscensionPlanningGame, Analysis = unknown> {
  getSimulatedAscensionCandidates?(
    game: Game | null | undefined,
    bot: Player,
    material: Card,
    context: AscensionCandidateContext<Card, Player, Game, Analysis>,
  ): Card[];
  shouldSkipAscension?(
    card: Card,
    material: Card,
    context: AscensionCandidateContext<Card, Player, Game, Analysis>,
  ): boolean;
  evaluateAscensionPriority?(
    card: Card,
    material: Card,
    context: AscensionCandidateContext<Card, Player, Game, Analysis>,
  ): number;
  chooseAscensionPosition?(
    card: Card,
    material: Card,
    context: AscensionCandidateContext<Card, Player, Game, Analysis>,
  ): BattlePositionInput | undefined;
  decorateAction?(
    action: PlannedAscensionAction,
    card: Card,
    material: Card,
    context: AscensionCandidateContext<Card, Player, Game, Analysis>,
  ): PlannedAscensionAction | null | undefined;
}

function hasAscensionEngineChecks(
  game: AscensionPlanningGame | null | undefined,
): game is Required<AscensionPlanningGame> {
  return (
    typeof game?.canUseAsAscensionMaterial === "function" &&
    typeof game?.getAscensionCandidatesForMaterial === "function" &&
    typeof game?.checkAscensionRequirements === "function"
  );
}

function isFaceupMonster(
  card: AscensionPlanningCard | null | undefined,
): card is AscensionPlanningCard {
  return (card && card.cardKind === "monster" && !card.isFacedown) as boolean;
}

function getRealAscensionCandidates(
  game: Required<AscensionPlanningGame>,
  player: AscensionPlanningPlayer,
  material: AscensionPlanningCard,
): AscensionPlanningCard[] {
  const materialCheck = game.canUseAsAscensionMaterial(player, material);
  if (!materialCheck?.ok) return [];

  const candidates = game.getAscensionCandidatesForMaterial(player, material) || [];
  return candidates.filter(
    (ascensionCard) =>
      game.checkAscensionRequirements(player, ascensionCard, material)?.ok,
  );
}

function resolvePriority(value: number | undefined): number {
  return Number.isFinite(value) ? value as number : 0;
}

/**
 * Build generic Ascension actions while keeping strategy policy external.
 *
 * The helper only handles shared candidate discovery and action shape. It does
 * not import strategy code, card ids, or use buildPrioritizedAction so callers
 * can preserve existing Ascension action contracts exactly.
 */
export function getGenericAscensionActions<Player extends AscensionPlanningPlayer, Game extends AscensionPlanningGame, Analysis>(
  context: AscensionPlanningContext<Player, Game, Analysis>,
  policy?: AscensionPlanningPolicy<Player["field"][number], Player, Game, Analysis>,
): PlannedAscensionAction[];
export function getGenericAscensionActions(
  context: AscensionPlanningContext = {},
  policy: AscensionPlanningPolicy = {},
): PlannedAscensionAction[] {
  const { game, bot, opponent, analysis, isSimulatedState = false } = context;
  const canCheckAscension = hasAscensionEngineChecks(game);

  if (!canCheckAscension && !isSimulatedState) return [];

  const actions: PlannedAscensionAction[] = [];
  const materials = (bot?.field || []).filter(isFaceupMonster);

  for (const material of materials) {
    const materialIndex = (bot!.field as readonly AscensionPlanningCard[])
      .indexOf(material);
    const materialContext = {
      ...context,
      game,
      bot,
      player: bot,
      opponent,
      analysis,
      isSimulatedState,
      material,
      materialIndex,
      canCheckAscension,
    };

    const eligible = canCheckAscension
      ? getRealAscensionCandidates(game, bot!, material)
      : policy.getSimulatedAscensionCandidates?.(game, bot!, material, materialContext) || [];

    for (const ascensionCard of eligible) {
      const ascensionContext = {
        ...materialContext,
        ascensionCard,
      };

      if (policy.shouldSkipAscension?.(ascensionCard, material, ascensionContext)) {
        continue;
      }

      const priority = resolvePriority(
        policy.evaluateAscensionPriority?.(
          ascensionCard,
          material,
          ascensionContext,
        ),
      );
      const position = policy.chooseAscensionPosition?.(
        ascensionCard,
        material,
        ascensionContext,
      );
      const action: PlannedAscensionAction = bindPlanningActionPresence({
        type: "ascension",
        materialIndex,
        ascensionCard,
        cardName: ascensionCard?.name,
        position,
        priority,
        extraDeck: true,
      }, ascensionCard, bot!.id, "extraDeck", isSimulatedState ? undefined : game, [{ card: material, zone: "field" }]);

      const decorated =
        policy.decorateAction?.(action, ascensionCard, material, ascensionContext) ||
        action;
      actions.push(decorated);
    }
  }

  return actions;
}
