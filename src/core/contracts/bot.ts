import type {
  AIAction,
  AIActionOf,
  AIActionType,
  AIStrategyBotPort,
  BattleCandidate,
  StrategyRuntimePort,
  AITributeRequirement,
  AITributeTradeResult,
  AIState,
} from "./ai.js";
import type {
  AiLiveGamePort,
  BotPerspectiveGameState,
  SimulatedCardState,
  SimulatedPlayerState,
  SimulationGameState,
} from "./aiState.js";
import type {
  BattlePosition,
  BattlePositionInput,
  CardKind,
  GameCard,
} from "./cards.js";
import type { MaybePromise } from "./decisions.js";
import type { GamePhase } from "./game.js";
import type { GamePlayer } from "./player.js";
import type { PlayerId, RawCardDefinitionId } from "./primitives.js";
import type Game from "../Game.js";
import type { PlayerGamePort, EffectEngineRuntimePort } from "./gameRuntime.js";
import type { PlayerStrategyPort } from "./player.js";
import type { EffectDefinition } from "./effects.js";
import type { AIActivationContext } from "./ai.js";
import type { CanonicalZone } from "./zones.js";
import type { ActivationPipelineContext } from "./activation.js";
import type { BotCloneGamePort } from "../bot/simulationBridge.js";
import type { BattleCandidateScoreInput } from "../ai/TurnLineSearch.js";

type BotGameMethodName =
  | "canStartAction" | "nextPhase" | "updateBoard" | "waitForBoardPresentation"
  | "waitForAiPresentationStep" | "isDisposed" | "getOpponent"
  | "performAscensionSummon" | "performExtraDeckSummonProcedure" | "performNormalSummon"
  | "canUseAsAscensionMaterial" | "getAscensionCandidatesForMaterial" | "checkAscensionRequirements"
  | "canSummonExtraDeckCardByProcedure" | "canChangePosition" | "changeMonsterPosition"
  | "getAttackAvailability" | "isActiveAttackPriorityTarget" | "resolveCombat"
  | "commitCardActivationFromHand" | "runActivationPipeline" | "setSpellOrTrap"
  | "finalizeSpellCardActivation" | "finalizeSpellTrapActivation" | "canPlaceCardOnField";

type BotGameMethods = {
  [Key in BotGameMethodName]: OmitThisParameter<Game[Key]>;
};

export interface BotAutomaticAscensionChoice {
  material: GameCard;
  ascensionCard: GameCard;
  position?: BattlePositionInput;
  skip?: boolean;
}

export interface BotAscensionContext {
  material: GameCard;
  ascensionCard: GameCard;
  game: BotGamePort;
  bot: BotRuntimePort;
  opponent: GamePlayer | null;
}

export interface BotStrategyPort extends StrategyRuntimePort, PlayerStrategyPort {
  simulateSpellEffect: NonNullable<StrategyRuntimePort["simulateSpellEffect"]>;
  evaluateBoardV2(state: AIState, perspective?: SimulatedPlayerState): number;
  sequenceActions(actions: AIAction[]): AIAction[];
  getTributeRequirementFor(card: SimulatedCardState, player: SimulatedPlayerState): AITributeRequirement;
  selectBestTributes(field: SimulatedCardState[], count: number, card: SimulatedCardState, context?: unknown): number[];
  shouldUseAutomaticAscensionShortcut?(game: BotGamePort, bot: BotRuntimePort): boolean;
  selectAutomaticAscension?(context: Omit<BotAscensionContext, "material" | "ascensionCard"> & {
    choices: BotAutomaticAscensionChoice[];
  }): Partial<BotAutomaticAscensionChoice> | null;
  chooseAutomaticAscensionPosition?(context: BotAscensionContext): BattlePositionInput | null;
  scoreBattleAttackCandidate?(context: {
    attacker: GameCard;
    target: GameCard | null;
    baseDelta: number;
    simState: BotPerspectiveGameState;
    game: BotGamePort;
    bot: BotRuntimePort;
    opponent: GamePlayer;
    isSecondAttack: boolean;
    attackerSurvived: boolean;
    targetSurvived: boolean;
    lethalNow: boolean;
    opponentLpAfter: number;
  } | BattleCandidateScoreInput): number | { scoreDelta: number } | null;
}

export type BotArchetypeId =
  | "shadowheart"
  | "luminarch"
  | "void"
  | "dragon"
  | "arcanist"
  | "miragebound"
  | "bloomrot"
  | "burningwest";

export interface BotPresetDefinition {
  id: BotArchetypeId;
  name: string;
  description?: string;
}

export interface BotActionGuardResult {
  ok: boolean;
  reason?: string | null;
  code?: string | null;
}

export interface BotEffectEnginePort extends EffectEngineRuntimePort {
  usedThisTurn?: ReadonlyMap<string, number>;
  canActivateSpellFromHandPreview?(
    card: GameCard,
    player: GamePlayer,
    options?: unknown,
  ): BotActionGuardResult | null;
  canActivateSpellTrapEffectPreview?(
    card: GameCard,
    player: GamePlayer,
    zone: string,
    selections?: unknown,
    options?: unknown,
  ): BotActionGuardResult | null;
  canActivateMonsterEffectPreview?(
    card: GameCard,
    player: GamePlayer,
    zone: string,
    selections?: unknown,
    options?: unknown,
  ): BotActionGuardResult | null;
  canActivateFieldSpellEffectPreview?(card: GameCard, player: GamePlayer, selections?: unknown, options?: unknown): BotActionGuardResult | null;
  getSpellTrapActivationEffect?(card: GameCard, context?: AIActivationContext): EffectDefinition | null;
  getFieldSpellActivationEffect?(card: GameCard): EffectDefinition | null;
  activateSpellTrapEffect(card: GameCard, player: GamePlayer, selections: unknown, zone: CanonicalZone | null, context?: ActivationPipelineContext): MaybePromise<unknown>;
  activateMonsterFromGraveyard(card: GameCard, player: GamePlayer, selections: unknown, context?: ActivationPipelineContext): MaybePromise<unknown>;
  activateFieldSpell(card: GameCard, player: GamePlayer, selections: unknown, context?: ActivationPipelineContext): MaybePromise<unknown>;
}

export interface BotGamePort extends Omit<PlayerGamePort, keyof BotGameMethods>, BotGameMethods {
  player: GamePlayer;
  bot: GamePlayer;
  phase: GamePhase;
  turnCounter: number;
  gameOver: boolean;
  winner?: PlayerId | "draw" | null;
  aiActionDelayMs?: number;
  effectEngine: BotEffectEnginePort;
  turn: PlayerId | string | null;
  phaseDelayMs?: number;
  aiBattleDelayMs?: number;
  aiSuccessfulActionDelayMs?: number;
  turnLineSearchEnabled?: boolean;
  turnLineSearchMode?: string;
  arenaPlannerMode?: string;
  turnLineSearchTurnMode?: "mainOnly" | "mainBattleMain2" | null;
  arenaPlannerTurnMode?: "mainOnly" | "mainBattleMain2" | null;
  turnLineSearchBeamWidth?: number | null;
  arenaPlannerBeamWidth?: number | null;
  turnLineSearchMaxDepth?: number | null;
  arenaPlannerMaxDepth?: number | null;
  turnLineSearchNodeBudget?: number | null;
  arenaPlannerNodeBudget?: number | null;
  turnLineSearchCandidateLimit?: number | null;
  arenaPlannerCandidateLimit?: number | null;
  turnLineSearchBattleStepLimit?: number;
  arenaPlannerBattleStepLimit?: number;
  arenaBeamWidth?: number;
  arenaMaxDepth?: number;
  arenaNodeBudget?: number;
  _arenaTracker?: {
    recordProgress?(kind: string, game: BotGamePort, details?: object): void;
    recordPlannerDecision?(details: object): void;
  };
}

export type BotRuntimePort = Omit<
  GamePlayer,
  "strategy" | "game" | "archetype"
> &
  AIStrategyBotPort & {
    archetype: BotArchetypeId;
    strategy: BotStrategyPort;
    game?: BotGamePort;
    debug?: boolean;
    maxSimulationsPerPhase: number;
    maxChainedActions: number;
    resolveOpponent(game: BotGamePort): GamePlayer | null;
    evaluateBoard(
      game: AiLiveGamePort | SimulationGameState,
      perspective?: GamePlayer | SimulatedPlayerState,
    ): number;
    evaluateBoardV2(
      game: AiLiveGamePort | SimulationGameState,
      perspective?: GamePlayer | SimulatedPlayerState,
    ): number;
    generateMainPhaseActions(game: AiLiveGamePort): AIAction[];
    sequenceActions(actions: AIAction[]): AIAction[];
    simulateMainPhaseAction(
      state: SimulationGameState,
      action: AIAction,
    ): ReturnType<StrategyRuntimePort["simulateMainPhaseAction"]>;
    simulateSpellEffect(
      state: SimulationGameState,
      card: SimulatedCardState,
    ): void;
    simulateBattle(
      state: SimulationGameState | BotPerspectiveGameState,
      attacker: SimulatedCardState,
      target: SimulatedCardState | null | undefined,
    ): void;
    executeMainPhaseAction(
      game: BotGamePort,
      action: AIAction,
    ): Promise<boolean>;
    cloneGameState(game: BotCloneGamePort): BotPerspectiveGameState;
    resolveHandIndexForAction(action: BotHandActionHint, expectedKind?: ExpectedBotHandKind): number;
    canResolveSummonActionForCurrentState(action: AIAction, game: BotGamePort): boolean;
    filterValidActionsForCurrentState(actions: AIAction[], game: BotGamePort): AIAction[];
    getTributeRequirementFor(card: GameCard | SimulatedCardState, player: GamePlayer | SimulatedPlayerState): AITributeRequirement;
    selectBestTributes(field: Array<GameCard | SimulatedCardState>, count: number, card: GameCard | SimulatedCardState, context?: unknown): number[];
    evaluateTributeTrade(card: GameCard | SimulatedCardState, field: Array<GameCard | SimulatedCardState>, count: number, context?: unknown): AITributeTradeResult;
    getAscensionPositionPreference(card: GameCard, material: GameCard, game: BotGamePort): BattlePositionInput;
    selectBestAscension(eligible: GameCard[], material: GameCard, game: BotGamePort): GameCard;
    tryAscensionIfAvailable(game: BotGamePort): Promise<boolean>;
  };

export type BotMainPhaseActionExecutor<Type extends AIActionType> = (
  bot: BotRuntimePort,
  game: BotGamePort,
  action: AIActionOf<Type>,
) => Promise<boolean>;

export type BotMainPhaseActionExecutors = {
  [Type in AIActionType]: BotMainPhaseActionExecutor<Type>;
};

export interface BotHandActionHint {
  index?: number;
  card?: GameCard | SimulatedCardState | null;
  cardId?: RawCardDefinitionId | number;
  cardName?: string;
}

export type ExpectedBotHandKind = CardKind | readonly CardKind[];

export interface BotTributeSelectionContext {
  oppField?: readonly GameCard[];
  game?: BotGamePort;
}

export interface BotAscensionCandidate {
  card: GameCard;
  material: GameCard;
  score?: number;
  position?: BattlePosition;
}

export interface BotBattlePlan {
  candidates: BattleCandidate[];
  executed: number;
}
