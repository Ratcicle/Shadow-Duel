import type {
  AIAction,
  AIActionOf,
  AIActionType,
  AIStrategyBotPort,
  BattleCandidate,
  StrategyRuntimePort,
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
  CardKind,
  GameCard,
} from "./cards.js";
import type { MaybePromise } from "./decisions.js";
import type { GamePhase } from "./game.js";
import type { GamePlayer } from "./player.js";
import type { PlayerId, RawCardDefinitionId } from "./primitives.js";

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

export interface BotEffectEnginePort {
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
}

export interface BotGamePort extends AiLiveGamePort {
  player: GamePlayer;
  bot: GamePlayer;
  phase: GamePhase;
  turnCounter: number;
  gameOver: boolean;
  winner?: PlayerId | "draw" | null;
  aiActionDelayMs?: number;
  effectEngine?: BotEffectEnginePort | null;
  ui?: {
    log?(message: string): void;
  };
  isDisposed?(): boolean;
  getOpponent?(player: GamePlayer): GamePlayer | null;
  canStartAction(input: {
    actor: GamePlayer;
    kind: string;
    phaseReq?: readonly GamePhase[];
  }): BotActionGuardResult;
  nextPhase(): MaybePromise<unknown>;
  updateBoard(): MaybePromise<unknown>;
  waitForBoardPresentation?(): MaybePromise<unknown>;
  waitForAiPresentationStep?(player: GamePlayer): MaybePromise<unknown>;
}

export type BotRuntimePort = Omit<
  GamePlayer,
  "strategy" | "game" | "archetype"
> &
  AIStrategyBotPort & {
    archetype: BotArchetypeId;
    strategy: StrategyRuntimePort;
    game?: BotGamePort;
    debug?: boolean;
    maxSimulationsPerPhase: number;
    maxChainedActions: number;
    resolveOpponent(game: AiLiveGamePort): GamePlayer | null;
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
    ): SimulationGameState | void;
    simulateSpellEffect(
      state: SimulationGameState,
      card: SimulatedCardState,
    ): void;
    simulateBattle(
      state: SimulationGameState,
      attacker: SimulatedCardState,
      target: SimulatedCardState | null,
    ): void;
    executeMainPhaseAction(
      game: BotGamePort,
      action: AIAction,
    ): Promise<boolean>;
    cloneGameState(game: AiLiveGamePort): BotPerspectiveGameState;
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
