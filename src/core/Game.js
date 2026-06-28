import Player from "./Player.js";
import Bot from "./Bot.js";
import EffectEngine from "./EffectEngine.js";
import ChainSystem from "./ChainSystem.js";
import NullChainSystem from "./NullChainSystem.js";
import Card from "./Card.js";
import AutoSelector from "./AutoSelector.js";
import { createUIAdapter } from "./UIAdapter.js";

// DevTools modules (moved from inline methods)
import * as devToolsCommands from "./game/devTools/commands.js";
import * as devToolsSetup from "./game/devTools/setup.js";

// Events modules (moved from inline methods)
import * as eventBus from "./game/events/eventBus.js";
import * as eventResolver from "./game/events/eventResolver.js";

// Selection modules (moved from inline methods)
import * as selectionContract from "./game/selection/contract.js";
import * as selectionHighlighting from "./game/selection/highlighting.js";
import * as selectionSession from "./game/selection/session.js";
import * as selectionHandlers from "./game/selection/handlers.js";

// Zones modules (moved from inline methods)
import * as zonesOwnership from "./game/zones/ownership.js";
import * as zonesSnapshot from "./game/zones/snapshot.js";
import * as zonesInvariants from "./game/zones/invariants.js";
import * as zonesOperations from "./game/zones/operations.js";
import * as zonesMovement from "./game/zones/movement.js";
import * as zonesDestruction from "./game/zones/destruction.js";

// Combat modules (moved from inline methods)
import * as combatIndicators from "./game/combat/indicators.js";
import * as combatAvailability from "./game/combat/availability.js";
import * as combatDamage from "./game/combat/damage.js";
import * as combatTargeting from "./game/combat/targeting.js";
import * as combatResolution from "./game/combat/resolution.js";

// Summon modules (moved from inline methods)
import * as summonTracking from "./game/summon/tracking.js";
import * as summonExecution from "./game/summon/execution.js";
import * as summonAscension from "./game/summon/ascension.js";
import * as summonSynchro from "./game/summon/synchro.js";
import * as summonPosition from "./game/summon/position.js";
import * as summonMaterialStats from "./game/summon/materialStats.js";

// Deck modules (moved from inline methods)
import * as deckDraw from "./game/deck/draw.js";

// Graveyard modules (moved from inline methods)
import * as graveyardModal from "./game/graveyard/modal.js";

// Extra Deck modules (moved from inline methods)
import * as extraDeckModal from "./game/extraDeck/modal.js";

// Turn modules (moved from inline methods)
import * as turnScheduling from "./game/turn/scheduling.js";
import * as turnCleanup from "./game/turn/cleanup.js";
import * as turnLifecycle from "./game/turn/lifecycle.js";
import * as turnPhaseRules from "./game/turn/phaseRules.js";
import * as turnTransitions from "./game/turn/transitions.js";
import * as turnOncePerTurn from "./game/turn/oncePerTurn.js";

// Actions modules (moved from inline methods)
import * as actionsGuard from "./game/actions/guard.js";

// State modules (moved from inline methods)
import * as stateDuelReset from "./game/state/duelReset.js";
import * as stateSerialization from "./game/state/serialization.js";

// Helpers modules (moved from inline methods)
import * as helpersPlayers from "./game/helpers/players.js";
import * as helpersCards from "./game/helpers/cards.js";

// Spell/Trap modules (moved from inline methods)
import * as spellTrapSet from "./game/spellTrap/set.js";
import * as spellTrapActivation from "./game/spellTrap/activation.js";
import * as spellTrapFinalization from "./game/spellTrap/finalization.js";
import * as spellTrapVerification from "./game/spellTrap/verification.js";
import * as spellTrapTriggers from "./game/spellTrap/triggers.js";

// UI modules (moved from inline methods)
import * as uiBoard from "./game/ui/board.js";
import * as uiCardAnimations from "./game/ui/cardAnimations.js";
import * as uiIndicators from "./game/ui/indicators.js";
import * as uiModals from "./game/ui/modals.js";
import * as uiPrompts from "./game/ui/prompts.js";
import * as uiWinCondition from "./game/ui/winCondition.js";
import * as uiInteractions from "./game/ui/interactions.js";
import * as strategicReport from "./game/analytics/strategicReport.js";

// Effects modules (moved from inline methods)
import * as effectsDestructionReplacement from "./game/effects/destructionReplacement.js";
import * as effectsActivationPipeline from "./game/effects/activationPipeline.js";

const STARTING_PLAYER_IDS = new Set(["player", "bot"]);
const EXTRA_DECK_MONSTER_TYPES = new Set(["fusion", "ascension", "synchro"]);

function resolveStartingPlayerId(startingPlayer) {
  if (STARTING_PLAYER_IDS.has(startingPlayer)) {
    return startingPlayer;
  }
  return Math.random() < 0.5 ? "player" : "bot";
}

function getStartingPlayerAnnouncement(turn) {
  return turn === "player"
    ? "Você joga primeiro"
    : "O oponente joga primeiro";
}

function createDisposedUIAdapter() {
  return new Proxy(
    {},
    {
      get: () => () => {},
    },
  );
}

export default class Game {
  constructor(options = {}) {
    // Mode flags must be ready before any subsystem or player/bot creation
    this.disableChains = !!options.disableChains;
    this.disableTraps = !!options.disableTraps;
    this.disableEffectActivation = !!options.disableEffectActivation;

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
    this.ui = createUIAdapter(this.renderer);
    this.autoSelector = new AutoSelector(this);

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
    this.damageStepTiming = null;
    this.damageCalculationStatChangePending = false;
    this.damageCalculationStatPresentationDelayMs =
      Number.isFinite(options.damageCalculationStatPresentationDelayMs)
        ? Math.max(0, options.damageCalculationStatPresentationDelayMs)
        : 500;
    this.lastAttackNegated = false;
    this.pendingSpecialSummon = null; // Track pending special summon (e.g., Leviathan from Eel)
    this.pendingTributeSummonSelection = null;
    this.isResolvingEffect = false; // Lock player actions while resolving an effect
    this.eventResolutionDepth = 0;
    this.eventResolutionCounter = 0;
    this.pendingEventSelection = null;
    this.pendingTrapWindows = [];
    this.temporaryReplacementEffects = [];
    this.temporaryBattlePairEffects = [];
    this.temporaryEventEffects = [];
    this.pendingSynchroMaterialFollowups = [];
    this.pendingSynchroMaterialTriggerContinuation = null;
    this.synchroSummonContextCounter = 0;
    this.trapPromptInProgress = false; // Avoid multiple trap prompts simultaneously
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
    this.on("after_summon", (payload) => this._trackSpecialSummonType(payload));

    // Initialize EffectEngine after eventListeners is set up
    this.effectEngine = new EffectEngine(this);

    // Initialize ChainSystem for chain windows and spell speed validation
    this.chainSystem = this.disableChains
      ? new NullChainSystem()
      : new ChainSystem(this);
  }

  isDisposed() {
    return this.disposed === true;
  }

  dispose(reason = "dispose") {
    if (this.disposed) return;
    this.disposed = true;
    this.gameOver = true;
    this.disposeReason = reason;
    this.targetSelection = null;
    this.selectionState = "idle";
    this.graveyardSelection = null;
    this.pendingSpecialSummon = null;
    this.pendingTributeSummonSelection = null;
    this.pendingEventSelection = null;
    this.pendingTrapWindows = [];
    this.isResolvingEffect = false;
    this.eventResolutionDepth = 0;
    this.trapPromptInProgress = false;
    this.delayedActions = [];
    this.temporaryReplacementEffects = [];
    this.temporaryBattlePairEffects = [];
    this.temporaryEventEffects = [];
    this.pendingSynchroMaterialFollowups = [];
    this.pendingSynchroMaterialTriggerContinuation = null;
    this.pendingCardAnimations = [];
    this.pendingVisualFeedback = [];
    this.pendingBoardPresentationPromise = Promise.resolve(false);
    this.eventListeners = {};
    this.chainSystem?.cancelChain?.();
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

  setDevMode(enabled) {
    this.devModeEnabled = !!enabled;
  }

  devLog(tag, detail) {
    if (!this.devModeEnabled) return;
    const prefix = `[DEV] ${tag}`;
    const logMessage =
      detail && typeof detail === "object"
        ? `${prefix}: ${
            typeof detail.summary === "string"
              ? detail.summary
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

  async start(deckList = null, extraDeckList = null) {
    if (this.isDisposed()) return;
    this._arenaTracker?.recordProgress?.("game_start_enter", this);
    await this.startWithDecks({
      playerDeck: deckList,
      playerExtraDeck: extraDeckList,
    });
    if (this.isDisposed()) return;
    this._arenaTracker?.recordProgress?.("game_start_exit", this);
  }

  async startWithDecks(options = {}) {
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
      this.buildExactDeckForPlayer(this.player, playerDeck);
      this.buildExactExtraDeckForPlayer(this.player, playerExtraDeck);
      this.buildExactDeckForPlayer(this.bot, botDeck);
      this.buildExactExtraDeckForPlayer(this.bot, botExtraDeck);
    } else {
      this.player.buildDeck(playerDeck);
      this.player.buildExtraDeck(playerExtraDeck);
      this.bot.buildDeck(botDeck);
      this.bot.buildExtraDeck(botExtraDeck);
    }
    this._arenaTracker?.recordProgress?.("deck_build_after", this, {
      playerDeckSize: this.player?.deck?.length || 0,
      botDeckSize: this.bot?.deck?.length || 0,
      playerExtraDeckSize: this.player?.extraDeck?.length || 0,
      botExtraDeckSize: this.bot?.extraDeck?.length || 0,
    });

    const requestedStartingPlayer = STARTING_PLAYER_IDS.has(firstTurnPlayer)
      ? firstTurnPlayer
      : startingPlayer;
    this.turn = resolveStartingPlayerId(requestedStartingPlayer);
    this._arenaTracker?.recordProgress?.("starting_player_selected", this, {
      startingPlayer: this.turn,
    });

    // Normal duel strategic telemetry is opt-in; Bot Arena owns its tracker.
    this.startNormalDuelStrategicReport?.();

    this._arenaTracker?.recordProgress?.("opening_draw_before", this);
    this.drawCards(this.player, 4);
    this.drawCards(this.bot, 4);
    if (this.isDisposed()) return;
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

  async showStartingPlayerAnnouncement(options = {}) {
    if (options.enabled === false) return;
    const message = getStartingPlayerAnnouncement(this.turn);
    this.ui?.log?.(message);

    if (typeof this.ui?.showDuelStartAnnouncement === "function") {
      await this.ui.showDuelStartAnnouncement(message, {
        durationMs: options.durationMs,
      });
    }
  }

  buildExactDeckForPlayer(player, deckList = []) {
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
    player.shuffleDeck();
  }

  buildExactExtraDeckForPlayer(player, extraDeckList = []) {
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

  async startLaboratory(setup = {}, labOptions = {}) {
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
    card,
    selections = null,
    activationZone = "field",
    owner = this.player,
    options = {},
  ) {
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
    const activationContext = {
      fromHand: activationZone === "hand",
      activationZone,
      sourceZone: activationZone,
      committed: false,
      actionContext: options.actionContext || null,
    };
    const activationEffect = this.effectEngine?.getMonsterIgnitionEffect?.(
      card,
      activationZone,
    );

    const pipelineResult = await this.runActivationPipeline({
      card,
      owner,
      activationZone,
      activationContext,
      selections,
      selectionKind: "monsterEffect",
      selectionMessage: "Select target(s) for the monster effect.",
      guardKind: "monster_effect",
      phaseReq: ["main1", "main2"],
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
  // Combat resolution: resolveCombat, finishCombat
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
  // Combat applyBattleDestroyEffect
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

// -----------------------------------------------------------------------------
// DevTools: Attach methods from modular devTools/ folder
// -----------------------------------------------------------------------------

// Commands: devDraw, devGiveCard, devForcePhase, devGetSelectionCleanupState,
//           devForceTargetCleanup, devAutoConfirmTargetSelection
Game.prototype.devDraw = devToolsCommands.devDraw;
Game.prototype.devGiveCard = devToolsCommands.devGiveCard;
Game.prototype.devForcePhase = devToolsCommands.devForcePhase;
Game.prototype.devGetSelectionCleanupState =
  devToolsCommands.devGetSelectionCleanupState;
Game.prototype.devForceTargetCleanup = devToolsCommands.devForceTargetCleanup;
Game.prototype.devAutoConfirmTargetSelection =
  devToolsCommands.devAutoConfirmTargetSelection;

// Setup: applyManualSetup
Game.prototype.applyManualSetup = devToolsSetup.applyManualSetup;
Game.prototype.applyScenarioSetup = devToolsSetup.applyScenarioSetup;

// -----------------------------------------------------------------------------
// Events: Attach methods from modular events/ folder
// -----------------------------------------------------------------------------

// Event Bus: on, emit, notify
Game.prototype.on = eventBus.on;
Game.prototype.emit = eventBus.emit;
Game.prototype.notify = eventBus.notify;
Game.prototype.emitEffectActivated = eventBus.emitEffectActivated;

// Event Resolver: resolveEvent, resolveEventEntries, resumePendingEventSelection
Game.prototype.resolveEvent = eventResolver.resolveEvent;
Game.prototype.resolveEventEntries = eventResolver.resolveEventEntries;
Game.prototype.resumePendingEventSelection =
  eventResolver.resumePendingEventSelection;

// -----------------------------------------------------------------------------
// Selection: Attach methods from modular selection/ folder
// -----------------------------------------------------------------------------

// Contract: buildSelectionCandidateKey, normalizeSelectionContract, canUseFieldTargeting
Game.prototype.buildSelectionCandidateKey =
  selectionContract.buildSelectionCandidateKey;
Game.prototype.normalizeSelectionContract =
  selectionContract.normalizeSelectionContract;
Game.prototype.canUseFieldTargeting = selectionContract.canUseFieldTargeting;

// Highlighting: clearTargetHighlights, setSelectionDimming, updateFieldTargetingProgress, highlightTargetCandidates
Game.prototype.clearTargetHighlights =
  selectionHighlighting.clearTargetHighlights;
Game.prototype.setSelectionDimming = selectionHighlighting.setSelectionDimming;
Game.prototype.updateFieldTargetingProgress =
  selectionHighlighting.updateFieldTargetingProgress;
Game.prototype.highlightTargetCandidates =
  selectionHighlighting.highlightTargetCandidates;

// Session: setSelectionState, forceClearTargetSelection, startTargetSelectionSession, advanceTargetSelection, finishTargetSelection, cancelTargetSelection
Game.prototype.setSelectionState = selectionSession.setSelectionState;
Game.prototype.forceClearTargetSelection =
  selectionSession.forceClearTargetSelection;
Game.prototype.startTargetSelectionSession =
  selectionSession.startTargetSelectionSession;
Game.prototype.advanceTargetSelection = selectionSession.advanceTargetSelection;
Game.prototype.finishTargetSelection = selectionSession.finishTargetSelection;
Game.prototype.cancelTargetSelection = selectionSession.cancelTargetSelection;

// Handlers: handleTargetSelectionClick, askPlayerToSelectCards
Game.prototype.handleTargetSelectionClick =
  selectionHandlers.handleTargetSelectionClick;
Game.prototype.askPlayerToSelectCards =
  selectionHandlers.askPlayerToSelectCards;

// -----------------------------------------------------------------------------
// Zones: Attach methods from modular zones/ folder
// -----------------------------------------------------------------------------

// Ownership: normalizeRelativePlayerId, normalizeCardOwnership, normalizeZoneCardOwnership
Game.prototype.normalizeRelativePlayerId =
  zonesOwnership.normalizeRelativePlayerId;
Game.prototype.normalizeCardOwnership = zonesOwnership.normalizeCardOwnership;
Game.prototype.normalizeZoneCardOwnership =
  zonesOwnership.normalizeZoneCardOwnership;

// Snapshot: snapshotCardState, collectAllZoneCards, captureZoneSnapshot, restoreZoneSnapshot, compareZoneSnapshot
Game.prototype.snapshotCardState = zonesSnapshot.snapshotCardState;
Game.prototype.collectAllZoneCards = zonesSnapshot.collectAllZoneCards;
Game.prototype.captureZoneSnapshot = zonesSnapshot.captureZoneSnapshot;
Game.prototype.restoreZoneSnapshot = zonesSnapshot.restoreZoneSnapshot;
Game.prototype.compareZoneSnapshot = zonesSnapshot.compareZoneSnapshot;

// Invariants: assertStateInvariants, inspectZoneNullishCards, recoverNullishZoneCards
Game.prototype.assertStateInvariants = zonesInvariants.assertStateInvariants;
Game.prototype.inspectZoneNullishCards =
  zonesInvariants.inspectZoneNullishCards;
Game.prototype.recoverNullishZoneCards =
  zonesInvariants.recoverNullishZoneCards;

// Operations: getZone, runZoneOp
Game.prototype.getZone = zonesOperations.getZone;
Game.prototype.runZoneOp = zonesOperations.runZoneOp;

// Destruction: destroyCard (orchestrates protection, negation, replacement, move-to-grave)
Game.prototype.destroyCard = zonesDestruction.destroyCard;

// -----------------------------------------------------------------------------
// Effects: Attach methods from modular effects/ folder
// -----------------------------------------------------------------------------

// Destruction replacement: resolveDestructionWithReplacement
Game.prototype.resolveDestructionWithReplacement =
  effectsDestructionReplacement.resolveDestructionWithReplacement;

// Activation pipeline: normalizeActivationResult, createActionResult, runActivationPipeline, runActivationPipelineWait
Game.prototype.normalizeActivationResult =
  effectsActivationPipeline.normalizeActivationResult;
Game.prototype.createActionResult = effectsActivationPipeline.createActionResult;
Game.prototype.runActivationPipeline =
  effectsActivationPipeline.runActivationPipeline;
Game.prototype.runActivationPipelineWait =
  effectsActivationPipeline.runActivationPipelineWait;

// Movement: cleanupTokenReferences, field-limit checks, moveCard, moveCardInternal
Game.prototype.cleanupTokenReferences = zonesMovement.cleanupTokenReferences;
Game.prototype.registerSpecialSummonRestriction =
  zonesMovement.registerSpecialSummonRestriction;
Game.prototype.cleanupExpiredSpecialSummonRestrictions =
  zonesMovement.cleanupExpiredSpecialSummonRestrictions;
Game.prototype.canSpecialSummonUnderRestrictions =
  zonesMovement.canSpecialSummonUnderRestrictions;
Game.prototype.canPlaceCardOnField = zonesMovement.canPlaceCardOnField;
Game.prototype.applyPendingSynchroMaterialFollowups =
  zonesMovement.applyPendingSynchroMaterialFollowups;
Game.prototype.moveCard = zonesMovement.moveCard;
Game.prototype.moveCardInternal = zonesMovement.moveCardInternal;

// -----------------------------------------------------------------------------
// Combat: Attach methods from modular combat/ folder
// -----------------------------------------------------------------------------

// Indicators: updateAttackIndicators, clearAttackReadyIndicators, applyAttackResolutionIndicators, clearAttackResolutionIndicators
Game.prototype.updateAttackIndicators = combatIndicators.updateAttackIndicators;
Game.prototype.clearAttackReadyIndicators =
  combatIndicators.clearAttackReadyIndicators;
Game.prototype.applyAttackResolutionIndicators =
  combatIndicators.applyAttackResolutionIndicators;
Game.prototype.clearAttackResolutionIndicators =
  combatIndicators.clearAttackResolutionIndicators;

// Availability: getAttackAvailability, markAttackUsed, registerAttackNegated, canDestroyByBattle
Game.prototype.getAttackAvailability = combatAvailability.getAttackAvailability;
Game.prototype.getMonsterAttackLimit = combatAvailability.getMonsterAttackLimit;
Game.prototype.hasExplicitAttackLimitThisTurn =
  combatAvailability.hasExplicitAttackLimitThisTurn;
Game.prototype.isActiveAttackPriorityTarget =
  combatAvailability.isActiveAttackPriorityTarget;
Game.prototype.markAttackUsed = combatAvailability.markAttackUsed;
Game.prototype.registerAttackNegated = combatAvailability.registerAttackNegated;
Game.prototype.isBattleDestructionPreventionNegated =
  combatAvailability.isBattleDestructionPreventionNegated;
Game.prototype.canDestroyByBattle = combatAvailability.canDestroyByBattle;

// Damage: inflictDamage
Game.prototype.inflictDamage = combatDamage.inflictDamage;

// Targeting: startAttackTargetSelection
Game.prototype.startAttackTargetSelection =
  combatTargeting.startAttackTargetSelection;

// Resolution: resolveCombat, finishCombat, applyBattleDestroyEffect
Game.prototype.resolveCombat = combatResolution.resolveCombat;
Game.prototype.finishCombat = combatResolution.finishCombat;
Game.prototype.applyBattleDestroyEffect =
  combatResolution.applyBattleDestroyEffect;

// -----------------------------------------------------------------------------
// Summon: Attach methods from modular summon/ folder
// -----------------------------------------------------------------------------

// Tracking: _trackSpecialSummonType, getSpecialSummonedTypeCount, resolveDelayedSummon
Game.prototype._trackSpecialSummonType = summonTracking._trackSpecialSummonType;
Game.prototype.getSpecialSummonedTypeCount =
  summonTracking.getSpecialSummonedTypeCount;
Game.prototype.resolveDelayedSummon = summonTracking.resolveDelayedSummon;

// Execution: flipSummon, performFusionSummon, performSpecialSummon
Game.prototype.flipSummon = summonExecution.flipSummon;
Game.prototype.offerSummonAttempt = summonExecution.offerSummonAttempt;
Game.prototype.performNormalSummon = summonExecution.performNormalSummon;
Game.prototype.performFusionSummon = summonExecution.performFusionSummon;
Game.prototype.performSpecialSummon = summonExecution.performSpecialSummon;

// Position: canFlipSummon, canChangePosition, changeMonsterPosition
Game.prototype.canFlipSummon = summonPosition.canFlipSummon;
Game.prototype.canChangePosition = summonPosition.canChangePosition;
Game.prototype.changeMonsterPosition = summonPosition.changeMonsterPosition;

// Material stats: tracking material-aware effect counters
Game.prototype.resetMaterialDuelStats =
  summonMaterialStats.resetMaterialDuelStats;
Game.prototype.incrementMaterialStat = summonMaterialStats.incrementMaterialStat;
Game.prototype.recordMaterialEffectActivation =
  summonMaterialStats.recordMaterialEffectActivation;
Game.prototype.recordMaterialDestroyedOpponentMonster =
  summonMaterialStats.recordMaterialDestroyedOpponentMonster;

// Ascension: getMaterialFieldAgeTurnCounter, getAscensionCandidatesForMaterial, checkAscensionRequirements, canUseAsAscensionMaterial, performAscensionSummon, tryAscensionSummon
Game.prototype.getMaterialFieldAgeTurnCounter =
  summonAscension.getMaterialFieldAgeTurnCounter;
Game.prototype.getAscensionCandidatesForMaterial =
  summonAscension.getAscensionCandidatesForMaterial;
Game.prototype.checkAscensionRequirements =
  summonAscension.checkAscensionRequirements;
Game.prototype.canUseAsAscensionMaterial =
  summonAscension.canUseAsAscensionMaterial;
Game.prototype.performAscensionSummon = summonAscension.performAscensionSummon;
Game.prototype.tryAscensionSummon = summonAscension.tryAscensionSummon;

// Synchro: classic one-Tuner + non-Tuner foundation
Game.prototype.canUseAsSynchroMaterial =
  summonSynchro.canUseAsSynchroMaterial;
Game.prototype.getSynchroMaterialCombos =
  summonSynchro.getSynchroMaterialCombos;
Game.prototype.canSummonSynchroCard =
  summonSynchro.canSummonSynchroCard;
Game.prototype.performSynchroSummon = summonSynchro.performSynchroSummon;
Game.prototype.performSynchroSummonFromExtraDeck =
  summonSynchro.performSynchroSummonFromExtraDeck;
Game.prototype.finishPendingSynchroMaterialTriggerContinuation =
  summonSynchro.finishPendingSynchroMaterialTriggerContinuation;

// -----------------------------------------------------------------------------
// Deck: Attach methods from modular deck/ folder
// -----------------------------------------------------------------------------

// Draw: drawCards, forceOpeningHand
Game.prototype.drawCards = deckDraw.drawCards;
Game.prototype.forceOpeningHand = deckDraw.forceOpeningHand;

// -----------------------------------------------------------------------------
// Graveyard: Attach methods from modular graveyard/ folder
// -----------------------------------------------------------------------------

// Modal: openGraveyardModal, closeGraveyardModal
Game.prototype.openGraveyardModal = graveyardModal.openGraveyardModal;
Game.prototype.closeGraveyardModal = graveyardModal.closeGraveyardModal;

// -----------------------------------------------------------------------------
// Extra Deck: Attach methods from modular extraDeck/ folder
// -----------------------------------------------------------------------------

// Modal: openExtraDeckModal, closeExtraDeckModal
Game.prototype.openExtraDeckModal = extraDeckModal.openExtraDeckModal;
Game.prototype.closeExtraDeckModal = extraDeckModal.closeExtraDeckModal;
Game.prototype.canSummonExtraDeckCardByProcedure =
  extraDeckModal.canSummonExtraDeckCardByProcedure;
Game.prototype.performExtraDeckSummonProcedure =
  extraDeckModal.performExtraDeckSummonProcedure;
Game.prototype.canSummonAscensionCardFromExtraDeck =
  extraDeckModal.canSummonAscensionCardFromExtraDeck;
Game.prototype.performAscensionSummonFromExtraDeck =
  extraDeckModal.performAscensionSummonFromExtraDeck;
Game.prototype.canSummonExtraDeckCard = extraDeckModal.canSummonExtraDeckCard;

// -----------------------------------------------------------------------------
// Turn: Attach methods from modular turn/ folder
// -----------------------------------------------------------------------------

// Scheduling: scheduleDelayedAction, processDelayedActions, resolveDelayedAction
Game.prototype.scheduleDelayedAction = turnScheduling.scheduleDelayedAction;
Game.prototype.processDelayedActions = turnScheduling.processDelayedActions;
Game.prototype.resolveDelayedAction = turnScheduling.resolveDelayedAction;

// Cleanup: applyTurnBasedBuff, cleanupExpiredBuffs, cleanupExpiredDeclaredValues, cleanupExpiredEffectMarkers, cleanupTempBoosts
Game.prototype.applyTurnBasedBuff = turnCleanup.applyTurnBasedBuff;
Game.prototype.cleanupExpiredBuffs = turnCleanup.cleanupExpiredBuffs;
Game.prototype.cleanupExpiredDeclaredValues =
  turnCleanup.cleanupExpiredDeclaredValues;
Game.prototype.cleanupExpiredEffectMarkers =
  turnCleanup.cleanupExpiredEffectMarkers;
Game.prototype.cleanupExpiredTemporaryBattlePairEffects =
  turnCleanup.cleanupExpiredTemporaryBattlePairEffects;
Game.prototype.cleanupExpiredTemporaryEventEffects =
  turnCleanup.cleanupExpiredTemporaryEventEffects;
Game.prototype.cleanupTempBoosts = turnCleanup.cleanupTempBoosts;

// Once-per-turn: usage tracking for oncePerTurn effects
Game.prototype.resetOncePerTurnUsage = turnOncePerTurn.resetOncePerTurnUsage;
Game.prototype.ensureOncePerTurnUsageFresh =
  turnOncePerTurn.ensureOncePerTurnUsageFresh;
Game.prototype.getOncePerTurnLockKey = turnOncePerTurn.getOncePerTurnLockKey;
Game.prototype.getOncePerTurnStore = turnOncePerTurn.getOncePerTurnStore;
Game.prototype.canUseOncePerTurn = turnOncePerTurn.canUseOncePerTurn;
Game.prototype.markOncePerTurnUsed = turnOncePerTurn.markOncePerTurnUsed;

// -----------------------------------------------------------------------------
// Actions: Attach methods from modular actions/ folder
// -----------------------------------------------------------------------------

// Guard: canStartAction, guardActionStart
Game.prototype.canStartAction = actionsGuard.canStartAction;
Game.prototype.guardActionStart = actionsGuard.guardActionStart;

// -----------------------------------------------------------------------------
// State: Attach methods from modular state/ folder
// -----------------------------------------------------------------------------

// Reset: duel/player state reset helpers
Game.prototype.resetPlayerDuelState = stateDuelReset.resetPlayerDuelState;
Game.prototype.resetDuelState = stateDuelReset.resetDuelState;

// Serialization: getPublicState
Game.prototype.getPublicState = stateSerialization.getPublicState;

// -----------------------------------------------------------------------------
// Helpers: Attach methods from modular helpers/ folder
// -----------------------------------------------------------------------------

// Players: getOpponent, resolvePlayerById
Game.prototype.getOpponent = helpersPlayers.getOpponent;
Game.prototype.resolvePlayerById = helpersPlayers.resolvePlayerById;

// Cards: resolveCardData, createCardForOwner, setMonsterFacing
Game.prototype.resolveCardData = helpersCards.resolveCardData;
Game.prototype.createCardForOwner = helpersCards.createCardForOwner;
Game.prototype.setMonsterFacing = helpersCards.setMonsterFacing;

// Lifecycle: startTurn, endTurn, waitForPhaseDelay
Game.prototype.startTurn = turnLifecycle.startTurn;
Game.prototype.endTurn = turnLifecycle.endTurn;
Game.prototype.waitForPhaseDelay = turnLifecycle.waitForPhaseDelay;

// Transitions: nextPhase, skipToPhase
Game.prototype.nextPhase = turnTransitions.nextPhase;
Game.prototype.skipToPhase = turnTransitions.skipToPhase;

// Phase rules: first-turn battle lock and phase order helpers
Game.prototype.isFirstTurnOfDuel = turnPhaseRules.isFirstTurnOfDuel;
Game.prototype.canEnterBattlePhase = turnPhaseRules.canEnterBattlePhase;
Game.prototype.getNextPhase = turnPhaseRules.getNextPhase;

// -----------------------------------------------------------------------------
// Spell/Trap: Attach methods from modular spellTrap/ folder
// -----------------------------------------------------------------------------

// Set: setSpellOrTrap
Game.prototype.setSpellOrTrap = spellTrapSet.setSpellOrTrap;

// Activation: tryActivateSpellTrapEffect, tryActivateSpell, activateFieldSpellEffect
Game.prototype.tryActivateSpellTrapEffect =
  spellTrapActivation.tryActivateSpellTrapEffect;
Game.prototype.finalizeSpellCardActivation =
  spellTrapActivation.finalizeSpellCardActivation;
Game.prototype.tryActivateSpell = spellTrapActivation.tryActivateSpell;
Game.prototype.activateFieldSpellEffect =
  spellTrapActivation.activateFieldSpellEffect;
Game.prototype.presentSpellTrapActivationFlip =
  spellTrapActivation.presentSpellTrapActivationFlip;

// Finalization: finalizeSpellTrapActivation, commitCardActivationFromHand, rollback helpers
Game.prototype.finalizeSpellTrapActivation =
  spellTrapFinalization.finalizeSpellTrapActivation;
Game.prototype.resolvePendingSpellTrapFinalization =
  spellTrapFinalization.resolvePendingSpellTrapFinalization;
Game.prototype.commitCardActivationFromHand =
  spellTrapFinalization.commitCardActivationFromHand;
Game.prototype.rollbackSpellActivation =
  spellTrapFinalization.rollbackSpellActivation;
Game.prototype.rollbackFieldSpellTrapActivation =
  spellTrapFinalization.rollbackFieldSpellTrapActivation;

// Verification: canActivateTrap, canActivatePolymerization
Game.prototype.canActivateTrap = spellTrapVerification.canActivateTrap;
Game.prototype.canActivatePolymerization =
  spellTrapVerification.canActivatePolymerization;

// Triggers: checkAndOfferTraps, _mapEventToChainContext, activateTrapFromZone
Game.prototype.checkAndOfferTraps = spellTrapTriggers.checkAndOfferTraps;
Game.prototype._mapEventToChainContext =
  spellTrapTriggers._mapEventToChainContext;
Game.prototype.activateTrapFromZone = spellTrapTriggers.activateTrapFromZone;
Game.prototype.queuePendingTrapWindow = spellTrapTriggers.queuePendingTrapWindow;
Game.prototype.flushPendingTrapWindows = spellTrapTriggers.flushPendingTrapWindows;

// -----------------------------------------------------------------------------
// UI: Attach methods from modular ui/ folder
// -----------------------------------------------------------------------------

// Board: updateBoard, highlightReadySpecialSummon
Game.prototype.updateBoard = uiBoard.updateBoard;
Game.prototype.highlightReadySpecialSummon =
  uiBoard.highlightReadySpecialSummon;
Game.prototype.queueCardAnimation = uiCardAnimations.queueCardAnimation;
Game.prototype.queueVisualFeedback = uiCardAnimations.queueVisualFeedback;
Game.prototype.waitForAiPresentationStep =
  uiCardAnimations.waitForAiPresentationStep;
Game.prototype.waitForPresentationDelay =
  uiCardAnimations.waitForPresentationDelay;
Game.prototype.waitForBoardPresentation =
  uiCardAnimations.waitForBoardPresentation;

// Indicators: updateActivationIndicators, buildActivationIndicatorsForPlayer
Game.prototype.updateActivationIndicators =
  uiIndicators.updateActivationIndicators;
Game.prototype.buildActivationIndicatorsForPlayer =
  uiIndicators.buildActivationIndicatorsForPlayer;

// Modals: showIgnitionActivateModal, showShadowHeartCathedralModal
Game.prototype.showIgnitionActivateModal = uiModals.showIgnitionActivateModal;
Game.prototype.showShadowHeartCathedralModal =
  uiModals.showShadowHeartCathedralModal;

// Prompts: chooseSpecialSummonPosition
Game.prototype.chooseSpecialSummonPosition =
  uiPrompts.chooseSpecialSummonPosition;

// WinCondition: checkWinCondition
Game.prototype.checkWinCondition = uiWinCondition.checkWinCondition;

// Interactions: bindCardInteractions
Game.prototype.bindCardInteractions = uiInteractions.bindCardInteractions;

// Strategic report: normal duel analytics export
Game.prototype.startNormalDuelStrategicReport =
  strategicReport.startNormalDuelStrategicReport;
Game.prototype.finalizeNormalDuelStrategicReport =
  strategicReport.finalizeNormalDuelStrategicReport;
Game.prototype.hasStrategicReport = strategicReport.hasStrategicReport;
Game.prototype.exportStrategicReport = strategicReport.exportStrategicReport;
Game.prototype.buildStrategicReportFilename =
  strategicReport.buildStrategicReportFilename;
Game.prototype.downloadStrategicReport =
  strategicReport.downloadStrategicReport;
