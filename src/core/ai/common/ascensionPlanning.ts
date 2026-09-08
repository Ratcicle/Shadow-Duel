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

interface AscensionPlanningContext {
  game?: AscensionPlanningGame | null;
  bot?: AscensionPlanningPlayer | null;
  player?: AscensionPlanningPlayer | null;
  opponent?: AscensionPlanningPlayer | null;
  analysis?: unknown;
  isSimulatedState?: boolean;
}

interface AscensionCandidateContext extends AscensionPlanningContext {
  material: AscensionPlanningCard;
  materialIndex: number;
  canCheckAscension: boolean;
  ascensionCard?: AscensionPlanningCard;
}

interface PlannedAscensionAction extends AscensionAIAction {
  extraDeck: true;
}

interface AscensionPlanningPolicy {
  getSimulatedAscensionCandidates?(
    game: AscensionPlanningGame | null | undefined,
    bot: AscensionPlanningPlayer,
    material: AscensionPlanningCard,
    context: AscensionCandidateContext,
  ): AscensionPlanningCard[];
  shouldSkipAscension?(
    card: AscensionPlanningCard,
    material: AscensionPlanningCard,
    context: AscensionCandidateContext,
  ): boolean;
  evaluateAscensionPriority?(
    card: AscensionPlanningCard,
    material: AscensionPlanningCard,
    context: AscensionCandidateContext,
  ): number;
  chooseAscensionPosition?(
    card: AscensionPlanningCard,
    material: AscensionPlanningCard,
    context: AscensionCandidateContext,
  ): BattlePositionInput | undefined;
  decorateAction?(
    action: PlannedAscensionAction,
    card: AscensionPlanningCard,
    material: AscensionPlanningCard,
    context: AscensionCandidateContext,
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
      const action: PlannedAscensionAction = {
        type: "ascension",
        materialIndex,
        ascensionCard,
        cardName: ascensionCard?.name,
        position,
        priority,
        extraDeck: true,
      };

      const decorated =
        policy.decorateAction?.(action, ascensionCard, material, ascensionContext) ||
        action;
      actions.push(decorated);
    }
  }

  return actions;
}
