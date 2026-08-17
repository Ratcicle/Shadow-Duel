import Player from "./Player.js";
import Bot from "./Bot.js";
import EffectEngine from "./EffectEngine.js";
import ChainSystem from "./ChainSystem.js";
import NullChainSystem from "./NullChainSystem.js";
import Card from "./Card.js";
import AutoSelector from "./AutoSelector.js";
import { createUIAdapter } from "./UIAdapter.js";
import {
  installGameAttachments,
  type GameAttachedMethods,
} from "./game/attachments.js";
import { installReplayCommandCaptureBindings } from "./game/replay/capture.js";
import type {
  DuelCardIdentityCarrier,
  GameCard,
} from "./contracts/cards.js";
import type {
  DeterministicRandomSnapshot,
  GamePhase,
  GameOptions,
  GameRendererPort,
  StartDeckCard,
  StartWithDecksOptions,
  StartingPlayerAnnouncementOptions,
} from "./contracts/game.js";
import type {
  EffectEngineRuntimePort,
  GameRuntimeState,
  GameUiPort,
} from "./contracts/gameRuntime.js";
import type { GamePlayer } from "./contracts/player.js";
import type {
  DuelCardId,
  PlayerId,
  RawCardDefinitionId,
} from "./contracts/primitives.js";
import type {
  DecisionKind,
  DecisionRequest,
  DecisionResult,
  RecordedDecision,
} from "./contracts/decisions.js";
import type {
  CanonicalSelectionMap,
  SelectionResult,
} from "./contracts/selection.js";
import type { CanonicalZone } from "./contracts/zones.js";
import type {
  ChainAutoSelectorPort,
  ChainGamePort,
} from "./contracts/chainRuntime.js";
import type {
  ActivationPipelineContext,
  ActivationPipelineResult,
} from "./game/effects/activationPipeline.js";

// DevTools modules (moved from inline methods)

// Events modules (moved from inline methods)

// Selection modules (moved from inline methods)

// Zones modules (moved from inline methods)

// Combat modules (moved from inline methods)

// Summon modules (moved from inline methods)

// Deck modules (moved from inline methods)

// Graveyard modules (moved from inline methods)

// Extra Deck modules (moved from inline methods)

// Turn modules (moved from inline methods)

// Actions modules (moved from inline methods)

// State modules (moved from inline methods)

// Helpers modules (moved from inline methods)

// Spell/Trap modules (moved from inline methods)

// UI modules (moved from inline methods)

// Effects modules (moved from inline methods)
import { createDecisionBroker } from "./game/decisions/broker.js";
import { createDeterministicRandom } from "./game/random.js";

const STARTING_PLAYER_IDS = new Set<PlayerId>(["player", "bot"]);
const EXTRA_DECK_MONSTER_TYPES = new Set<string | null>([
  "fusion",
  "ascension",
  "synchro",
]);

function isPlayerId(value: unknown): value is PlayerId {
  return value === "player" || value === "bot";
}

function resolveStartingPlayerId(
  startingPlayer: PlayerId | null | undefined,
  random: () => number,
): PlayerId {
  if (startingPlayer && STARTING_PLAYER_IDS.has(startingPlayer)) {
    return startingPlayer;
  }
  return random() < 0.5 ? "player" : "bot";
}

function getStartingPlayerAnnouncement(turn: PlayerId): string {
  return turn === "player"
    ? "Você joga primeiro"
    : "O oponente joga primeiro";
}

function createDisposedUIAdapter(): GameUiPort {
  return new Proxy<GameUiPort>(
    {} as GameUiPort,
    {
      get: () => () => {},
    },
  );
}

type RuntimeUiAdapter = ReturnType<typeof createUIAdapter>;

function exposeGameUiPort(adapter: RuntimeUiAdapter): GameUiPort;
function exposeGameUiPort(
  adapter: RuntimeUiAdapter,
): RuntimeUiAdapter | GameUiPort {
  return adapter;
}

function exposeChainAutoSelector(selector: AutoSelector): ChainAutoSelectorPort;
function exposeChainAutoSelector(
  selector: AutoSelector,
): AutoSelector | ChainAutoSelectorPort {
  return selector;
}

function exposeAutoSelectorGame(
  game: Game,
): ConstructorParameters<typeof AutoSelector>[0];
function exposeAutoSelectorGame(game: Game): unknown {
  return game;
}

function exposeEffectEngineRuntime(
  engine: EffectEngine,
): EffectEngineRuntimePort;
function exposeEffectEngineRuntime(engine: EffectEngine): unknown {
  return engine;
}

function exposeChainGame(game: Game): ChainGamePort;
function exposeChainGame(game: Game): unknown {
  return game;
}

function createGameUIAdapter(
  renderer: GameRendererPort | null | undefined,
): GameUiPort {
  const adapter: RuntimeUiAdapter = Reflect.apply(
    createUIAdapter,
    undefined,
    [renderer],
  );
  return exposeGameUiPort(adapter);
}

function preserveGeneratedDeckEntries(
  entries: readonly StartDeckCard[] | null,
): readonly RawCardDefinitionId[] | null;
function preserveGeneratedDeckEntries(
  entries: readonly StartDeckCard[] | null,
): readonly StartDeckCard[] | null {
  return entries;
}

interface LaboratoryStartOptions {
  revealBotHand?: boolean;
  useBot?: boolean;
}

interface MonsterEffectActivationOptions {
  activationContext?: ActivationPipelineContext;
  effectId?: string | null;
  actionContext?: unknown;
}

class Game {
  constructor(options: GameOptions = {}) {
    // Mode flags must be ready before any subsystem or player/bot creation
    this.disableChains = !!options.disableChains;
    this.disableTraps = !!options.disableTraps;
    this.disableEffectActivation = !!options.disableEffectActivation;
    this.randomSeed = options.randomSeed ?? Date.now();
    this.randomGenerator = createDeterministicRandom(this.randomSeed);
    this.nextDuelCardId = 1;
    this.generatedIdCounters = new Map();
    this.captureReplayEnabled = options.captureReplay === true;
    this._canonicalReplay = null;

    this.laboratoryModeEnabled = !!options.laboratoryMode;
    this.laboratoryRevealBotHand = !!options.laboratoryRevealBotHand;
    this.player = new Player("player", options.playerName || "You", "human");
    this.botPreset = options.botPreset || "shadowheart";
    this.bot =
      options.opponentOverride ||
      (this.laboratoryModeEnabled && !options.laboratoryUseBot
        ? new Player("bot", options.opponentName || "Opponent", "human")
        : new Bot(this.botPreset));

    this.renderer = options.renderer || null;
    this.ui = createGameUIAdapter(this.renderer);
    this.autoSelector = exposeChainAutoSelector(
      new AutoSelector(exposeAutoSelectorGame(this)),
    );
    this.replayMode = options.replayMode || "live";
    this.decisionBroker = createDecisionBroker(this, {
      mode: this.replayMode === "playback" ? "replay" : "live",
    });

    // Ensure controllerType defaults (opponentOverride may not set it)
    if (!this.player.controllerType) {
      this.player.controllerType = "human";
    }
    if (!this.bot.controllerType) {
      this.bot.controllerType = "ai";
    }

    this.player.game = this;
    this.bot.game = this;

    this.turn = "player";
    this.phase = "draw";
    this.turnCounter = 0;
    this.disposed = false;
    this.gameOver = false;
    this.winner = null; // Will be set by checkWinCondition()
    this.targetSelection = null;
    this.selectionState = "idle";
    this.graveyardSelection = null;
    this.selectionSessionCounter = 0;
    this.lastSelectionSessionId = 0;
    this.eventListeners = {};
    this.phaseDelayMs = 400;
    this.aiSuccessfulActionDelayMs = 1200;
    this.aiPresentationStepDelayMs = 650;
    this.battleStep = null;
    this.damageCalculationStatChangePending = false;
    this.nextDamageStepId = 1;
    this.activeDamageStepTransaction = null;
    this.lastDamageStepTransaction = null;
    this.damageStepProcedureDepth = 0;
    this.damageCalculationTempBuffs = [];
    this.endOfDamageStepTempBuffs = [];
    this.damageCalculationStatPresentationDelayMs =
      typeof options.damageCalculationStatPresentationDelayMs === "number" &&
      Number.isFinite(options.damageCalculationStatPresentationDelayMs)
        ? Math.max(0, options.damageCalculationStatPresentationDelayMs)
        : 500;
    this.lastAttackNegated = false;
    this.pendingSpecialSummon = null; // Track pending special summon (e.g., Leviathan from Eel)
    this.nextSummonId = 1;
    this.activeSummonTransaction = null;
    this.lastSummonTransaction = null;
    this.summonProcedureDepth = 0;
    this.pendingTributeSummonSelection = null;
    this.isResolvingEffect = false; // Lock player actions while resolving an effect
    this.eventResolutionDepth = 0;
    this.eventResolutionCounter = 0;
    this.pendingEventSelection = null;
    this.pendingTriggerSelection = null;
    this.pendingChainEvents = [];
    this._flushingPendingTriggerOccurrences = false;
    this.temporaryReplacementEffects = [];
    this.temporaryBattlePairEffects = [];
    this.temporaryEventEffects = [];
    this.temporaryControlEffects = [];
    this.pendingSynchroMaterialFollowups = [];
    this.pendingSynchroMaterialTriggerContinuation = null;
    this.synchroSummonContextCounter = 0;
    this.devModeEnabled = !!options.devMode;
    this.zoneOpDepth = 0;
    this.zoneOpSnapshot = null;
    this.devFailAfterZoneMutation = false;
    this.pendingCardAnimations = [];
    this.pendingVisualFeedback = [];
    this.pendingBoardPresentationPromise = Promise.resolve(false);
    this.cardAnimationsReady = false;
    this.normalDuelStrategicReportEnabled =
      options.normalDuelStrategicReport === true;
    this.normalDuelPlayerArchetype = options.playerArchetype || "custom";
    this.normalDuelBotArchetype = options.botArchetype || this.botPreset;
    this._normalDuelStrategic = null;
    this.oncePerTurnUsage = {
      player: new Map(),
      bot: new Map(),
      card: new WeakMap(),
    };
    this.nextEffectUsageReservationId = 1;
    this.effectUsageReservations = new Map();
    this.oncePerTurnTurnCounter = this.turnCounter;
    this.resetMaterialDuelStats("init");

    // ? FASE 2: Sistema global de delayed actions
    // Estrutura gen�rica para rastrear a��es agendadas (summons, damage, etc.)
    // Cada entrada cont�m: actionType, triggerCondition, payload, scheduledTurn, priority
    this.delayedActions = [];

    // Track counts of special-summoned monsters by type per player
    this.specialSummonTypeCounts = {
      player: new Map(),
      bot: new Map(),
    };

    // Listener to record type counts on special summons
    this.on("after_summon", (payload) =>
      this._trackSpecialSummonType(
        payload as Parameters<
          GameAttachedMethods["_trackSpecialSummonType"]
        >[0],
      ),
    );

    // Initialize EffectEngine after eventListeners is set up
    this.effectEngine = exposeEffectEngineRuntime(new EffectEngine(this));

    // Initialize ChainSystem for chain windows and spell speed validation
    this.chainSystem = this.disableChains
      ? new NullChainSystem(exposeChainGame(this))
      : new ChainSystem(exposeChainGame(this), {
          responseTimeoutMs: options.chainResponseTimeoutMs,
        });
    if (this.captureReplayEnabled) {
      this.startReplayRecording({ enabled: true });
    }
  }

  isDisposed(): boolean {
    return this.disposed === true;
  }

  requestDecision(): Promise<SelectionResult | null>;
  requestDecision<Kind extends DecisionKind>(
    input: DecisionRequest<Kind>,
  ): Promise<DecisionResult<Kind>>;
  requestDecision<Kind extends DecisionKind>(
    input: DecisionRequest<Kind> = {} as DecisionRequest<Kind>,
  ): Promise<DecisionResult<Kind> | SelectionResult | null> {
    return this.decisionBroker.requestDecision(input);
  }

  recordDecision(): RecordedDecision<"choice">;
  recordDecision<Kind extends DecisionKind>(
    input: DecisionRequest<Kind>,
    result?: DecisionResult<Kind>,
  ): RecordedDecision<Kind>;
  recordDecision<Kind extends DecisionKind>(
    input: DecisionRequest<Kind> = {} as DecisionRequest<Kind>,
    result: DecisionResult<Kind> | null = null,
  ): RecordedDecision<Kind> | RecordedDecision<"choice"> {
    return this.decisionBroker.recordDecision(input, result);
  }

  random(): number {
    return this.randomGenerator.next();
  }

  shuffle<Value>(items: Value[]): Value[] {
    return this.randomGenerator.shuffle(items);
  }

  getRandomState(): DeterministicRandomSnapshot {
    return this.randomGenerator.snapshot();
  }

  restoreRandomState(
    snapshot: Partial<DeterministicRandomSnapshot>,
  ): DeterministicRandomSnapshot {
    return this.randomGenerator.restore(snapshot);
  }

  ensureDuelCardId(card: DuelCardIdentityCarrier): DuelCardId;
  ensureDuelCardId(card: null | undefined): null;
  ensureDuelCardId(
    card: DuelCardIdentityCarrier | null | undefined,
  ): DuelCardId | null;
  ensureDuelCardId(
    card: DuelCardIdentityCarrier | null | undefined,
  ): DuelCardId | null {
    if (!card) return null;
    if (!Number.isInteger(card.duelCardId)) {
      card.duelCardId = this.nextDuelCardId++ as DuelCardId;
    }
    return (card.duelCardId ?? null) as DuelCardId | null;
  }

  createDeterministicId(scope: string = "id"): string {
    const next = Number(this.generatedIdCounters.get(scope) || 0) + 1;
    this.generatedIdCounters.set(scope, next);
    return `${scope}_${next}`;
  }

  dispose(reason: string = "dispose"): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gameOver = true;
    this.disposeReason = reason;
    this.targetSelection = null;
    this.selectionState = "idle";
    this.graveyardSelection = null;
    this.pendingSpecialSummon = null;
    this.cleanupDamageStepTransaction?.(reason);
    this.cleanupSummonTransaction?.(reason);
    this.pendingTributeSummonSelection = null;
    this.pendingEventSelection = null;
    this.pendingTriggerSelection = null;
    this.pendingChainEvents = [];
    this._flushingPendingTriggerOccurrences = false;
    this.isResolvingEffect = false;
    this.eventResolutionDepth = 0;
    this.delayedActions = [];
    this.temporaryReplacementEffects = [];
    this.temporaryBattlePairEffects = [];
    this.temporaryEventEffects = [];
    this.temporaryControlEffects = [];
    this.pendingSynchroMaterialFollowups = [];
    this.pendingSynchroMaterialTriggerContinuation = null;
    this.pendingCardAnimations = [];
    this.pendingVisualFeedback = [];
    this.pendingBoardPresentationPromise = Promise.resolve(false);
    this.eventListeners = {};
    this.chainSystem?.cancelChain?.();
    this.ui?.updatePriorityIndicator?.(null);
    this.releaseEffectUsageReservations?.(reason);
    this.effectEngine?.clearTargetingCache?.();
    this.renderer?.destroy?.();
    this.ui = createDisposedUIAdapter();
    this.renderer = null;
  }

  // Material stats methods moved to src/core/game/summon/materialStats.js
  // applyTurnBasedBuff moved to src/core/game/turn/cleanup.js (paired with cleanupExpiredBuffs)
  // _trackSpecialSummonType, getSpecialSummonedTypeCount moved to src/core/game/summon/tracking.js
  // scheduleDelayedAction, processDelayedActions, resolveDelayedAction moved to src/core/game/turn/scheduling.js
  // resolveDelayedSummon moved to src/core/game/summon/tracking.js
  // cleanupExpiredBuffs moved to src/core/game/turn/cleanup.js

  setDevMode(enabled: boolean): void {
    this.devModeEnabled = !!enabled;
  }

  devLog(tag: string, detail?: unknown): void {
    if (!this.devModeEnabled) return;
    const prefix = `[DEV] ${tag}`;
    const logMessage =
      detail && typeof detail === "object"
        ? `${prefix}: ${
            typeof Reflect.get(detail, "summary") === "string"
              ? Reflect.get(detail, "summary")
              : JSON.stringify(detail)
          }`
        : `${prefix}: ${detail ?? ""}`;
    console.debug(logMessage);
    if (this.ui?.log) {
      this.ui.log(logMessage);
    }
  }

  // -----------------------------------------------------------------------------
  // Zones: Methods moved to src/core/game/zones/*.js
  // See: ownership.js, snapshot.js, invariants.js, operations.js, movement.js
  // -----------------------------------------------------------------------------

  // Once-per-turn methods moved to src/core/game/turn/oncePerTurn.js
  // Action guard methods moved to src/core/game/actions/guard.js

  // -----------------------------------------------------------------------------
  // Events methods moved to core/game/events/
  // See: eventBus.js, eventResolver.js
  // Methods are attached to prototype after class definition
  // -----------------------------------------------------------------------------

  async start(
    deckList: readonly RawCardDefinitionId[] | null = null,
    extraDeckList: readonly RawCardDefinitionId[] | null = null,
  ): Promise<void> {
    if (this.isDisposed()) return;
    this._arenaTracker?.recordProgress?.("game_start_enter", this);
    await this.startWithDecks({
      playerDeck: deckList,
      playerExtraDeck: extraDeckList,
    });
    if (this.isDisposed()) return;
    this._arenaTracker?.recordProgress?.("game_start_exit", this);
  }

  async startWithDecks(options: StartWithDecksOptions = {}): Promise<void> {
    if (this.isDisposed()) return;
    this._arenaTracker?.recordProgress?.("start_with_decks_enter", this);
    const {
      playerDeck = null,
      playerExtraDeck = null,
      botDeck = null,
      botExtraDeck = null,
      exactDecks = false,
      startAtDrawPhase = false,
      laboratoryMode = this.laboratoryModeEnabled,
      revealBotHand,
      startingPlayer = null,
      firstTurnPlayer = null,
      announceStartingPlayer = true,
      preserveDeckOrder = false,
      initializeOnly = false,
      initialRandomState = null,
    } = options;

    this.laboratoryModeEnabled = laboratoryMode === true;
    if (revealBotHand !== undefined) {
      this.laboratoryRevealBotHand = !!revealBotHand;
    }
    if (this.player.controllerType !== "ai") {
      this.player.controllerType = "human";
    }

    this.resetDuelState("startWithDecks");
    this._arenaTracker?.recordProgress?.("deck_build_before", this, {
      exactDecks,
    });
    if (exactDecks) {
      this.buildExactDeckForPlayer(this.player, playerDeck, { preserveDeckOrder });
      this.buildExactExtraDeckForPlayer(this.player, playerExtraDeck);
      this.buildExactDeckForPlayer(this.bot, botDeck, { preserveDeckOrder });
      this.buildExactExtraDeckForPlayer(this.bot, botExtraDeck);
    } else {
      this.player.buildDeck(preserveGeneratedDeckEntries(playerDeck));
      this.player.buildExtraDeck(preserveGeneratedDeckEntries(playerExtraDeck));
      this.bot.buildDeck(preserveGeneratedDeckEntries(botDeck));
      this.bot.buildExtraDeck(preserveGeneratedDeckEntries(botExtraDeck));
    }
    this._arenaTracker?.recordProgress?.("deck_build_after", this, {
      playerDeckSize: this.player?.deck?.length || 0,
      botDeckSize: this.bot?.deck?.length || 0,
      playerExtraDeckSize: this.player?.extraDeck?.length || 0,
      botExtraDeckSize: this.bot?.extraDeck?.length || 0,
    });

    const requestedStartingPlayer = isPlayerId(firstTurnPlayer)
      ? firstTurnPlayer
      : startingPlayer;
    this.turn = resolveStartingPlayerId(
      requestedStartingPlayer,
      () => this.random(),
    );
    if (initialRandomState) this.restoreRandomState(initialRandomState);
    this.captureReplaySetup?.();
    this._arenaTracker?.recordProgress?.("starting_player_selected", this, {
      startingPlayer: this.turn,
    });

    // Normal duel strategic telemetry is opt-in; Bot Arena owns its tracker.
    this.startNormalDuelStrategicReport?.();

    this._arenaTracker?.recordProgress?.("opening_draw_before", this);
    this.drawCards(this.player, 4);
    this.drawCards(this.bot, 4);
    if (this.isDisposed()) return;
    if (initializeOnly) {
      this.updateBoard();
      return;
    }
    this._arenaTracker?.recordProgress?.("opening_draw_after", this, {
      playerHandSize: this.player?.hand?.length || 0,
      botHandSize: this.bot?.hand?.length || 0,
      playerDeckSize: this.player?.deck?.length || 0,
      botDeckSize: this.bot?.deck?.length || 0,
    });

    if (startAtDrawPhase) {
      this.phase = "draw";
      this.turnCounter = 1;
      this.resetOncePerTurnUsage("start_turn");
      this.player.lpGainedThisTurn = 0;
      this.bot.lpGainedThisTurn = 0;
      this.effectEngine?.clearTargetingCache?.();
      this.effectEngine?.updatePassiveBuffs?.();
      this.updateBoard();
      await this.showStartingPlayerAnnouncement({
        enabled: announceStartingPlayer,
      });
      if (this.isDisposed()) return;
      this.ui.bindPhaseClick((phase) => {
        if (this.isDisposed()) return;
        const activePlayer = this.turn === "player" ? this.player : this.bot;
        if (this.laboratoryModeEnabled) {
          if (activePlayer.controllerType !== "human") return;
          this.skipToPhase(phase);
          return;
        }
        if (this.turn === "player") {
          this.skipToPhase(phase);
        }
      });
      this.bindCardInteractions();
      this._arenaTracker?.recordProgress?.("start_with_decks_draw_phase_ready", this);
      return;
    }

    this.updateBoard();
    await this.showStartingPlayerAnnouncement({
      enabled: announceStartingPlayer,
    });
    if (this.isDisposed()) return;
    this._arenaTracker?.recordProgress?.("start_turn_before", this);
    await this.startTurn();
    if (this.isDisposed()) return;
    this._arenaTracker?.recordProgress?.("start_turn_after", this);
    this.ui.bindPhaseClick((phase) => {
      if (this.isDisposed()) return;
      const activePlayer = this.turn === "player" ? this.player : this.bot;
      if (this.laboratoryModeEnabled) {
        if (activePlayer.controllerType !== "human") return;
        this.skipToPhase(phase);
        return;
      } else if (this.turn !== "player") {
        return;
      }
      if (
        this.phase === "main1" ||
        this.phase === "battle" ||
        this.phase === "main2"
      ) {
        this.skipToPhase(phase);
      }
    });
    this.bindCardInteractions();
  }

  async showStartingPlayerAnnouncement(
    options: StartingPlayerAnnouncementOptions = {},
  ): Promise<void> {
    if (options.enabled === false) return;
    const message = getStartingPlayerAnnouncement(this.turn);
    this.ui?.log?.(message);

    if (typeof this.ui?.showDuelStartAnnouncement === "function") {
      await this.ui.showDuelStartAnnouncement(message, {
        durationMs: options.durationMs,
      });
    }
  }

  buildExactDeckForPlayer(
    player: GamePlayer,
    deckList: readonly StartDeckCard[] | null = [],
    options: { preserveDeckOrder?: boolean } = {},
  ): void {
    player.deck = [];
    player.hand = [];
    player.field = [];
    player.spellTrap = [];
    player.graveyard = [];
    player.banished = [];
    player.fieldSpell = null;
    player.oncePerTurnUsageByName = {};
    if (!Array.isArray(deckList)) return;

    deckList.forEach((entry) => {
      const card = this.createCardForOwner(entry, player, entry);
      if (!card || EXTRA_DECK_MONSTER_TYPES.has(card.monsterType)) {
        return;
      }
      player.deck.push(card);
    });
    if (options.preserveDeckOrder !== true) player.shuffleDeck();
  }

  buildExactExtraDeckForPlayer(
    player: GamePlayer,
    extraDeckList: readonly StartDeckCard[] | null = [],
  ): void {
    player.extraDeck = [];
    if (!Array.isArray(extraDeckList)) return;

    extraDeckList.forEach((entry) => {
      const card = this.createCardForOwner(entry, player, entry);
      if (!card || !EXTRA_DECK_MONSTER_TYPES.has(card.monsterType)) {
        return;
      }
      player.extraDeck.push(card);
    });
  }

  async startLaboratory(
    setup: Parameters<GameAttachedMethods["applyScenarioSetup"]>[0] = {},
    labOptions: LaboratoryStartOptions = {},
  ): Promise<void> {
    this.laboratoryModeEnabled = true;
    if (labOptions.revealBotHand !== undefined) {
      this.laboratoryRevealBotHand = !!labOptions.revealBotHand;
    }
    this.player.controllerType = "human";
    const useBot = labOptions.useBot || false;
    this.bot.controllerType = useBot ? "ai" : "human";
    this.resetDuelState("laboratory_start", {
      phase: "main1",
      turnCounter: 1,
      turn: "player",
    });
    if (useBot && typeof this.bot.buildDeck === "function") {
      this.bot.buildDeck();
      this.bot.buildExtraDeck();
      // controllerType is already "ai" from Bot constructor
    }

    this.applyScenarioSetup?.(setup, {
      logMessage: "Laboratory setup applied.",
      updateBoard: false,
      immediateActions: true,
    });
    this.resetOncePerTurnUsage("laboratory_start");
    this.effectEngine?.clearTargetingCache?.();
    this.effectEngine?.updatePassiveBuffs?.();
    this.updateBoard();
    this.ui.bindPhaseClick((phase) => {
      const activePlayer = this.turn === "player" ? this.player : this.bot;
      if (activePlayer.controllerType !== "human") return;
      if (
        this.phase === "main1" ||
        this.phase === "battle" ||
        this.phase === "main2"
      ) {
        this.skipToPhase(phase);
      }
    });
    this.bindCardInteractions();
  }

  // ? drawCards ? Moved to src/core/game/deck/draw.js
  // ? forceOpeningHand ? Moved to src/core/game/deck/draw.js

  // ? updateBoard ? Moved to src/core/game/ui/board.js
  // ? highlightReadySpecialSummon ? Moved to src/core/game/ui/board.js

  // ? updateActivationIndicators ? Moved to src/core/game/ui/indicators.js
  // ? buildActivationIndicatorsForPlayer ? Moved to src/core/game/ui/indicators.js

  // -----------------------------------------------------------------------------
  // Combat indicators: updateAttackIndicators, clearAttackReadyIndicators,
  // applyAttackResolutionIndicators, clearAttackResolutionIndicators
  // ? Moved to src/core/game/combat/indicators.js
  // -----------------------------------------------------------------------------

  // ? chooseSpecialSummonPosition ? Moved to src/core/game/ui/prompts.js

  // -----------------------------------------------------------------------------
  // Combat damage: inflictDamage
  // ? Moved to src/core/game/combat/damage.js
  // -----------------------------------------------------------------------------

  // ? startTurn, endTurn, waitForPhaseDelay ? Moved to src/core/game/turn/lifecycle.js
  // ? nextPhase, skipToPhase ? Moved to src/core/game/turn/transitions.js

  // ? showIgnitionActivateModal ? Moved to src/core/game/ui/modals.js

  // ? bindCardInteractions ? Moved to src/core/game/ui/interactions.js

  // resolveDestructionWithReplacement moved to src/core/game/effects/destructionReplacement.js
  // destroyCard moved to src/core/game/zones/destruction.js
  // canFlipSummon, canChangePosition, changeMonsterPosition moved to src/core/game/summon/position.js
  // flipSummon ? Moved to src/core/game/summon/execution.js
  // finalizeSpellTrapActivation ? Moved to src/core/game/spellTrap/finalization.js

  async tryActivateMonsterEffect(
    card: GameCard | null | undefined,
    selections: CanonicalSelectionMap | null = null,
    activationZone: CanonicalZone = "field",
    owner: GamePlayer | null | undefined = this.player,
    options: MonsterEffectActivationOptions = {},
  ): Promise<ActivationPipelineResult> {
    if (this.disableEffectActivation) {
      this.ui?.log?.("Effect activations are disabled.");
      return this.createActionResult({
        reason: "effects_disabled",
        code: "EFFECTS_DISABLED",
      });
    }
    if (!card) {
      return this.createActionResult({
        reason: "invalid_card",
        code: "INVALID_CARD",
      });
    }
    if (!owner) {
      return this.createActionResult({
        reason: "invalid_owner",
        code: "INVALID_OWNER",
      });
    }
    this.devLog("MONSTER_EFFECT_ACTIVATION_ATTEMPT", {
      summary: `${card.name} (${activationZone})`,
      card: card.name,
      activationZone,
      owner: owner.id || null,
    });
    const baseActivationContext = options.activationContext || {};
    const activationContext = {
      ...baseActivationContext,
      fromHand: activationZone === "hand",
      activationZone,
      sourceZone: activationZone,
      effectId: options.effectId || baseActivationContext.effectId || null,
      committed: false,
      actionContext: options.actionContext || baseActivationContext.actionContext || null,
    };
    const activationEffect = this.effectEngine?.getMonsterIgnitionEffect?.(
      card,
      activationZone,
      { effectId: activationContext.effectId },
    );
    const manualFieldQuickEffect =
      activationZone === "field" &&
      (activationEffect?.isQuickEffect === true ||
        Number(activationEffect?.speed) === 2);
    const phaseReq: readonly GamePhase[] = manualFieldQuickEffect
      ? ["main1", "battle", "main2"]
      : ["main1", "main2"];

    const pipelineResult = await this.runActivationPipeline({
      card,
      owner,
      activationZone,
      activationContext,
      selections,
      selectionKind: "monsterEffect",
      selectionMessage: "Select target(s) for the monster effect.",
      guardKind: "monster_effect",
      phaseReq,
      oncePerTurn: {
        card,
        player: owner,
        effect: activationEffect,
      },
      activate: (chosen, ctx, zone) =>
        this.effectEngine.activateMonsterEffect(card, owner, chosen, zone, ctx),
      finalize: () => {
        this.ui.log(`${card.name} effect activated.`);
        this.queueVisualFeedback?.({
          kind: "effect-activation",
          sourceCard: card,
          ownerId: owner.id,
          fromZone: activationZone,
          tone: "violet",
        });
        this.updateBoard();
      },
    });
    return pipelineResult;
  }

  // ? tryActivateSpellTrapEffect ? Moved to src/core/game/spellTrap/activation.js

  // -----------------------------------------------------------------------------
  // Selection: Methods moved to src/core/game/selection/*.js
  // See: contract.js, highlighting.js, session.js, handlers.js
  // -----------------------------------------------------------------------------

  // getPublicState moved to src/core/game/state/serialization.js

  // normalizeActivationResult moved to src/core/game/effects/activationPipeline.js
  // runActivationPipeline + runActivationPipelineWait moved to src/core/game/effects/activationPipeline.js
  // ? activateFieldSpellEffect ? Moved to src/core/game/spellTrap/activation.js

  // -----------------------------------------------------------------------------
  // Combat targeting: startAttackTargetSelection
  // ? Moved to src/core/game/combat/targeting.js
  // -----------------------------------------------------------------------------

  // ? openGraveyardModal, closeGraveyardModal ? Moved to src/core/game/graveyard/modal.js
  // ? openExtraDeckModal, closeExtraDeckModal ? Moved to src/core/game/extraDeck/modal.js
  // ? getMaterialFieldAgeTurnCounter, getAscensionCandidatesForMaterial, checkAscensionRequirements, canUseAsAscensionMaterial, performAscensionSummon, tryAscensionSummon ? Moved to src/core/game/summon/ascension.js

  // -----------------------------------------------------------------------------
  // Combat availability: getAttackAvailability, markAttackUsed, registerAttackNegated, canDestroyByBattle
  // ? Moved to src/core/game/combat/availability.js
  // -----------------------------------------------------------------------------

  // -----------------------------------------------------------------------------
  // Combat resolution: resolveCombat
  // ? Moved to src/core/game/combat/resolution.js
  // -----------------------------------------------------------------------------

  // ? performFusionSummon ? Moved to src/core/game/summon/execution.js

  // ? performSpecialSummon ? Moved to src/core/game/summon/execution.js

  // ? canActivatePolymerization ? Moved to src/core/game/spellTrap/verification.js

  // getOpponent moved to src/core/game/helpers/players.js
  // ? cleanupTempBoosts ? Moved to src/core/game/turn/cleanup.js

  // -----------------------------------------------------------------------------
  // Zone methods (ownership, snapshot, invariants, operations, movement)
  // ? Moved to src/core/game/zones/*.js
  // -----------------------------------------------------------------------------

  // -----------------------------------------------------------------------------
  // ? Moved to src/core/game/combat/resolution.js
  // -----------------------------------------------------------------------------

  // ? setSpellOrTrap ? Moved to src/core/game/spellTrap/set.js

  // ? tryActivateSpell ? Moved to src/core/game/spellTrap/activation.js

  // ? rollbackSpellActivation ? Moved to src/core/game/spellTrap/finalization.js

  // ? commitCardActivationFromHand ? Moved to src/core/game/spellTrap/finalization.js

  // showShadowHeartCathedralModal moved to src/core/game/ui/modals.js (was already shadowed)
  // ? canActivateTrap ? Moved to src/core/game/spellTrap/verification.js

  // ? checkAndOfferTraps ? Moved to src/core/game/spellTrap/triggers.js

  // ? _mapEventToChainContext ? Moved to src/core/game/spellTrap/triggers.js

  // ? activateTrapFromZone ? Moved to src/core/game/spellTrap/triggers.js

  // resolvePlayerById moved to src/core/game/helpers/players.js
  // resolveCardData, createCardForOwner, setMonsterFacing moved to src/core/game/helpers/cards.js

  // -----------------------------------------------------------------------------
  // DevTools methods moved to core/game/devTools/
  // See: commands.js, setup.js
  // Methods are attached to prototype after class definition
  // -----------------------------------------------------------------------------
}

interface Game extends GameAttachedMethods, GameRuntimeState {}

installGameAttachments(Game.prototype);
installReplayCommandCaptureBindings(Game.prototype);

export default Game;
