import Player, { isAI } from "./Player.js";
import Bot from "./Bot.js";
import EffectEngine from "./EffectEngine.js";
import ChainSystem from "./ChainSystem.js";
import NullChainSystem from "./NullChainSystem.js";
import Card from "./Card.js";
import { cardDatabaseByName, cardDatabaseById } from "../data/cards.js";
import { getCardDisplayName } from "./i18n.js";
import AutoSelector from "./AutoSelector.js";
import { createUIAdapter } from "./UIAdapter.js";

// DevTools modules (moved from inline methods)
import * as devToolsCommands from "./game/devTools/commands.js";
import * as devToolsSanity from "./game/devTools/sanity.js";
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
import * as turnTransitions from "./game/turn/transitions.js";

// Helper to construct user-friendly cost type descriptions
function getCostTypeDescription(costFilters, count) {
  if (costFilters.archetype) {
    const baseType = costFilters.cardKind || "monster";
    const singular = `"${costFilters.archetype}" ${baseType}`;
    const plural = `"${costFilters.archetype}" ${baseType}s`;
    return count > 1 ? plural : singular;
  }

  if (costFilters.cardKind) {
    const singular = costFilters.cardKind;
    const plural = costFilters.cardKind + "s";
    return count > 1 ? plural : singular;
  }

  return count > 1 ? "cards" : "card";
}

export default class Game {
  constructor(options = {}) {
    // Mode flags must be ready before any subsystem or player/bot creation
    this.disableChains = !!options.disableChains;
    this.disableTraps = !!options.disableTraps;
    this.disableEffectActivation = !!options.disableEffectActivation;

    this.player = new Player("player", options.playerName || "You", "human");
    this.botPreset = options.botPreset || "shadowheart";
    this.bot = options.opponentOverride || new Bot(this.botPreset);

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
    this.gameOver = false;
    this.targetSelection = null;
    this.selectionState = "idle";
    this.graveyardSelection = null;
    this.selectionSessionCounter = 0;
    this.lastSelectionSessionId = 0;
    this.eventListeners = {};
    this.phaseDelayMs = 400;
    this.lastAttackNegated = false;
    this.pendingSpecialSummon = null; // Track pending special summon (e.g., Leviathan from Eel)
    this.isResolvingEffect = false; // Lock player actions while resolving an effect
    this.eventResolutionDepth = 0;
    this.eventResolutionCounter = 0;
    this.pendingEventSelection = null;
    this.trapPromptInProgress = false; // Avoid multiple trap prompts simultaneously
    this.testModeEnabled = false;
    this.devModeEnabled = !!options.devMode;
    this.zoneOpDepth = 0;
    this.zoneOpSnapshot = null;
    this.devFailAfterZoneMutation = false;
    this.oncePerTurnUsage = {
      player: new Map(),
      bot: new Map(),
      card: new WeakMap(),
    };
    this.oncePerTurnTurnCounter = this.turnCounter;
    this.resetMaterialDuelStats("init");

    // ✅ FASE 2: Sistema global de delayed actions
    // Estrutura genérica para rastrear ações agendadas (summons, damage, etc.)
    // Cada entrada contém: actionType, triggerCondition, payload, scheduledTurn, priority
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

  resetMaterialDuelStats(reason = "reset") {
    this.materialDuelStats = {
      player: {
        destroyedOpponentMonstersByMaterialId: new Map(),
        effectActivationsByMaterialId: new Map(),
      },
    };
    this.devLog("MATERIAL_STATS_RESET", { summary: reason });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Summon tracking: _trackSpecialSummonType, getSpecialSummonedTypeCount
  // → Moved to src/core/game/summon/tracking.js
  // ─────────────────────────────────────────────────────────────────────────────

  // → scheduleDelayedAction, processDelayedActions, resolveDelayedAction → Moved to src/core/game/turn/scheduling.js

  // ─────────────────────────────────────────────────────────────────────────────
  // Summon delayed: resolveDelayedSummon
  // → Moved to src/core/game/summon/tracking.js
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * ✅ FASE 4: Aplicar buff temporário com expiração baseada em turno
   * Suporta múltiplos buffs simultâneos com expiração em turnos diferentes
   * @param {Object} card - Carta a receber o buff
   * @param {string} stat - Stat afetado ("atk" ou "def")
   * @param {number} value - Valor do buff
   * @param {number} expiresOnTurn - Turno em que o buff expira
   * @param {string} id - ID único do buff (opcional)
   */
  applyTurnBasedBuff(card, stat, value, expiresOnTurn, id = null) {
    if (
      !card ||
      !stat ||
      !Number.isFinite(value) ||
      !Number.isFinite(expiresOnTurn)
    ) {
      return false;
    }

    if (!Array.isArray(card.turnBasedBuffs)) {
      card.turnBasedBuffs = [];
    }

    const buffId =
      id || `buff_${card.id}_${Math.random().toString(36).substr(2, 9)}`;
    const buffEntry = {
      id: buffId,
      stat,
      value,
      expiresOnTurn,
    };

    card.turnBasedBuffs.push(buffEntry);

    // Aplicar modificação imediata ao stat
    if (stat === "atk") {
      card.atk += value;
    } else if (stat === "def") {
      card.def += value;
    }

    this.devLog?.("TURN_BASED_BUFF_APPLIED", {
      summary: `${card.name} +${value} ${stat} (expires turn ${expiresOnTurn})`,
      card: card.name,
      stat,
      value,
      expiresOnTurn,
    });

    return true;
  }

  // → cleanupExpiredBuffs → Moved to src/core/game/turn/cleanup.js

  incrementMaterialStat(playerId, mapName, materialCardId, delta = 1) {
    const store = this.materialDuelStats?.[playerId]?.[mapName];
    if (!store || !(store instanceof Map) || !Number.isFinite(materialCardId)) {
      return;
    }
    const next = (store.get(materialCardId) || 0) + delta;
    store.set(materialCardId, next);
  }

  recordMaterialEffectActivation(player, sourceCard, meta = {}) {
    const playerId = player?.id || player;
    if (playerId !== "player" && playerId !== "bot") return;
    if (!sourceCard || sourceCard.cardKind !== "monster") return;
    if (typeof sourceCard.id !== "number") return;
    this.incrementMaterialStat(
      playerId,
      "effectActivationsByMaterialId",
      sourceCard.id,
      1
    );
    this.devLog("MATERIAL_EFFECT_ACTIVATION", {
      summary: `${playerId}:${sourceCard.name} (${sourceCard.id})`,
      player: playerId,
      card: sourceCard.name,
      cardId: sourceCard.id,
      context: meta.contextLabel,
    });
  }

  recordMaterialDestroyedOpponentMonster(sourceCard, destroyedCard) {
    if (!sourceCard || !destroyedCard) return;
    if (sourceCard.cardKind !== "monster") return;
    if (destroyedCard.cardKind !== "monster") return;
    if (typeof sourceCard.id !== "number") return;

    const sourcePlayerId = sourceCard.controller || sourceCard.owner;
    const destroyedPlayerId = destroyedCard.controller || destroyedCard.owner;
    if (sourcePlayerId !== "player" && sourcePlayerId !== "bot") return;
    if (destroyedPlayerId !== "player" && destroyedPlayerId !== "bot") return;
    if (sourcePlayerId === destroyedPlayerId) return;

    this.incrementMaterialStat(
      sourcePlayerId,
      "destroyedOpponentMonstersByMaterialId",
      sourceCard.id,
      1
    );
    this.devLog("MATERIAL_DESTROY_COUNT", {
      summary: `${sourcePlayerId}:${sourceCard.name} -> ${destroyedCard.name}`,
      player: sourcePlayerId,
      source: sourceCard.name,
      sourceId: sourceCard.id,
      destroyed: destroyedCard.name,
    });
  }

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

  // ─────────────────────────────────────────────────────────────────────────────
  // Zones: Methods moved to src/core/game/zones/*.js
  // See: ownership.js, snapshot.js, invariants.js, operations.js, movement.js
  // ─────────────────────────────────────────────────────────────────────────────

  resetOncePerTurnUsage(reason = "reset") {
    this.oncePerTurnUsage = {
      player: new Map(),
      bot: new Map(),
      card: new WeakMap(),
    };
    this.oncePerTurnTurnCounter = this.turnCounter;
    this.devLog("OPT_RESET", { summary: reason, turn: this.turnCounter });
  }

  ensureOncePerTurnUsageFresh() {
    if (this.oncePerTurnTurnCounter !== this.turnCounter) {
      this.resetOncePerTurnUsage("turn_change");
    }
  }

  getOncePerTurnLockKey(card, effect, options = {}) {
    const explicit = options.lockKey || options.key || null;
    if (explicit) {
      return explicit.startsWith("once_per_turn:")
        ? explicit
        : `once_per_turn:${explicit}`;
    }

    const base =
      effect?.oncePerTurnName ||
      effect?.id ||
      options.actionId ||
      card?.name ||
      "effect";
    return `once_per_turn:${base}`;
  }

  getOncePerTurnStore(card, player, effect, options = {}) {
    const useCardScope =
      effect?.oncePerTurnScope === "card" ||
      effect?.oncePerTurnPerCard === true;
    if (useCardScope && card) {
      let store = this.oncePerTurnUsage.card.get(card);
      if (!store) {
        store = new Map();
        this.oncePerTurnUsage.card.set(card, store);
      }
      return store;
    }

    const playerId = player?.id || "player";
    if (!this.oncePerTurnUsage[playerId]) {
      this.oncePerTurnUsage[playerId] = new Map();
    }
    return this.oncePerTurnUsage[playerId];
  }

  canUseOncePerTurn(card, player, effect, options = {}) {
    if (!effect || !effect.oncePerTurn) {
      return { ok: true };
    }
    this.ensureOncePerTurnUsageFresh();
    const lockKey = this.getOncePerTurnLockKey(card, effect, options);
    const store = this.getOncePerTurnStore(card, player, effect, options);
    const currentTurn = this.turnCounter;
    const lastTurn = store.get(lockKey);
    if (lastTurn === currentTurn) {
      return {
        ok: false,
        reason: "Efeito 1/turn ja usado neste turno.",
        lockKey,
      };
    }
    return { ok: true, lockKey };
  }

  markOncePerTurnUsed(card, player, effect, options = {}) {
    if (!effect || !effect.oncePerTurn) {
      return;
    }
    this.ensureOncePerTurnUsageFresh();
    const lockKey = this.getOncePerTurnLockKey(card, effect, options);
    const store = this.getOncePerTurnStore(card, player, effect, options);
    store.set(lockKey, this.turnCounter);
    this.devLog("OPT_MARK_USED", {
      summary: lockKey,
      card: card?.name,
      player: player?.id,
      turn: this.turnCounter,
    });
  }

  canStartAction(options = {}) {
    const actor = options.actor || null;
    const kind = options.kind || "action";
    const silent = options.silent === true;
    const allowDuringSelection =
      options.allowDuringSelection === true || kind === "selection_interaction";
    const allowDuringResolving =
      options.allowDuringResolving === true || kind === "selection_interaction";
    const allowDuringOpponentTurn = options.allowDuringOpponentTurn === true;
    const phaseReq = options.phaseReq || null;
    const selectionState = this.selectionState || "idle";
    const selectionInteractive =
      !!this.targetSelection ||
      selectionState === "selecting" ||
      selectionState === "confirming";
    const resolvingActive =
      this.isResolvingEffect ||
      selectionState === "resolving" ||
      this.eventResolutionDepth > 0;

    const blocked = (code, reason) => {
      const result = { ok: false, code, reason };
      if (!silent) {
        this.devLog("ACTION_GUARD_BLOCKED", {
          summary: code,
          kind,
          reason,
          phase: this.phase,
          turn: this.turn,
          actor: actor?.id,
          selectionState: this.selectionState,
          resolving: this.isResolvingEffect,
          eventDepth: this.eventResolutionDepth,
        });
      }
      return result;
    };

    if (selectionInteractive && !allowDuringSelection) {
      return blocked(
        "BLOCKED_SELECTION_ACTIVE",
        "Finalize a selecao atual antes de iniciar outra acao."
      );
    }

    if (resolvingActive && !allowDuringResolving) {
      return blocked(
        "BLOCKED_RESOLVING",
        "Finalize o efeito pendente antes de fazer outra acao."
      );
    }

    if (
      actor &&
      actor.id &&
      actor.id !== this.turn &&
      !allowDuringOpponentTurn
    ) {
      return blocked("BLOCKED_NOT_YOUR_TURN", "Nao e o seu turno.");
    }

    if (phaseReq) {
      const phases = Array.isArray(phaseReq) ? phaseReq : [phaseReq];
      if (!phases.includes(this.phase)) {
        return blocked(
          "BLOCKED_WRONG_PHASE",
          "Esta acao nao pode ser usada nesta fase."
        );
      }
    }

    return { ok: true };
  }

  guardActionStart(options = {}, logToRenderer = true) {
    const result = this.canStartAction(options);
    if (!result.ok && logToRenderer && result.reason && this.ui?.log) {
      this.ui.log(result.reason);
    }
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Events methods moved to core/game/events/
  // See: eventBus.js, eventResolver.js
  // Methods are attached to prototype after class definition
  // ─────────────────────────────────────────────────────────────────────────────

  start(deckList = null, extraDeckList = null) {
    // BUG #9 FIX: Reset once-per-duel usage between duels
    // This ensures effects like "once per duel" are available in new matches
    this.player.oncePerDuelUsageByName = Object.create(null);
    this.bot.oncePerDuelUsageByName = Object.create(null);

    this.resetMaterialDuelStats("start");
    this.player.buildDeck(deckList);
    this.player.buildExtraDeck(extraDeckList);
    this.bot.buildDeck();
    this.bot.buildExtraDeck();
    if (this.testModeEnabled) {
      this.forceOpeningHand("Infinity Searcher", 4);
      this.ui.log("Modo teste: adicionando 4 Infinity Searcher a mao inicial.");
    }

    this.drawCards(this.player, 4);
    this.drawCards(this.bot, 4);

    this.updateBoard();
    this.startTurn();
    this.ui.bindPhaseClick((phase) => {
      if (this.turn !== "player") return;
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

  // → drawCards → Moved to src/core/game/deck/draw.js
  // → forceOpeningHand → Moved to src/core/game/deck/draw.js

  updateBoard() {
    // Update passive effects before rendering
    this.effectEngine?.updatePassiveBuffs();
    if (typeof this.player.updatePassiveEffects === "function") {
      this.player.updatePassiveEffects();
    }
    if (typeof this.bot.updatePassiveEffects === "function") {
      this.bot.updatePassiveEffects();
    }

    this.ui.renderHand(this.player);
    this.ui.renderField(this.player);
    this.ui.renderFieldSpell(this.player);

    if (typeof this.ui.renderSpellTrap === "function") {
      this.ui.renderSpellTrap(this.player);
      this.ui.renderSpellTrap(this.bot);
    } else {
      console.warn("Renderer missing renderSpellTrap implementation.");
    }

    this.ui.renderHand(this.bot);
    this.ui.renderField(this.bot);
    this.ui.renderFieldSpell(this.bot);
    this.ui.updateLP(this.player);
    this.ui.updateLP(this.bot);
    this.ui.updatePhaseTrack(this.phase);
    this.ui.updateTurn(this.turn === "player" ? this.player : this.bot);
    this.ui.updateGYPreview(this.player);
    this.ui.updateGYPreview(this.bot);

    if (typeof this.ui.updateExtraDeckPreview === "function") {
      this.ui.updateExtraDeckPreview(this.player);
      this.ui.updateExtraDeckPreview(this.bot);
    }

    if (this.targetSelection?.usingFieldTargeting) {
      this.highlightTargetCandidates();
    }

    // Highlight cards ready for special summon after rendering
    if (this.pendingSpecialSummon) {
      this.highlightReadySpecialSummon();
    }

    this.updateActivationIndicators();
    this.updateAttackIndicators();
  }

  updateActivationIndicators() {
    if (!this.ui || typeof this.ui.applyActivationIndicators !== "function") {
      return;
    }

    const indicators = this.buildActivationIndicatorsForPlayer(this.player);
    if (!indicators) return;
    this.ui.applyActivationIndicators("player", indicators);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Combat indicators: updateAttackIndicators, clearAttackReadyIndicators,
  // applyAttackResolutionIndicators, clearAttackResolutionIndicators
  // → Moved to src/core/game/combat/indicators.js
  // ─────────────────────────────────────────────────────────────────────────────

  buildActivationIndicatorsForPlayer(player) {
    if (!player || player.id !== "player") return null;

    const activationContext = {
      autoSelectSingleTarget: false,
      logTargets: false,
    };

    const mapGuardHint = (guard) => {
      if (!guard || guard.ok) return null;
      if (guard.code === "BLOCKED_WRONG_PHASE") {
        return "bloqueado por fase";
      }
      if (guard.code === "BLOCKED_NOT_YOUR_TURN") {
        return "fora do seu turno";
      }
      return null;
    };

    const mapReasonHint = (reason) => {
      if (!reason) return null;
      const lower = reason.toLowerCase();
      if (lower.includes("1/turn") || lower.includes("once per turn")) {
        return "1/turn ja usado";
      }
      if (lower.includes("main phase") || lower.includes("phase")) {
        return "bloqueado por fase";
      }
      if (lower.includes("no valid targets")) {
        return "sem alvos validos";
      }
      if (lower.includes("not your turn")) {
        return "fora do seu turno";
      }
      return null;
    };

    const canStart = (kind, phaseReq) =>
      this.canStartAction({
        actor: player,
        kind,
        phaseReq,
        silent: true,
      });

    const buildHint = (guard, preview, readyLabel) => {
      const guardHint = mapGuardHint(guard);
      if (guardHint) {
        return { canActivate: false, label: guardHint };
      }
      if (!preview) return null;
      if (preview.ok) {
        return { canActivate: true, label: readyLabel };
      }
      const reasonHint = mapReasonHint(preview.reason);
      if (reasonHint) {
        return { canActivate: false, label: reasonHint };
      }
      return null;
    };

    const indicators = {
      hand: {},
      field: {},
      spellTrap: {},
      fieldSpell: null,
    };

    (player.hand || []).forEach((card, index) => {
      if (!card) return;
      if (card.cardKind === "spell") {
        const guard = canStart("spell_from_hand", ["main1", "main2"]);
        const preview = this.effectEngine?.canActivateSpellFromHandPreview?.(
          card,
          player,
          {
            activationContext,
          }
        ) || { ok: false };
        let ok = !!preview.ok;
        if (ok && card.name === "Polymerization") {
          ok = this.canActivatePolymerization();
        }
        const previewResult = { ...preview, ok };
        const hint = buildHint(guard, previewResult, "ativacao disponivel");
        if (!hint && card.name === "Polymerization" && !ok) {
          indicators.hand[index] = {
            canActivate: false,
            label: "sem alvos validos",
          };
          return;
        }
        if (hint) {
          indicators.hand[index] = hint;
        }
      } else if (card.cardKind === "monster") {
        const guard = canStart("monster_effect", ["main1", "main2"]);
        const preview = this.effectEngine?.canActivateMonsterEffectPreview?.(
          card,
          player,
          "hand",
          null,
          { activationContext }
        ) || { ok: false };
        const hint = buildHint(guard, preview, "ignition disponivel");
        if (hint) {
          indicators.hand[index] = hint;
        }
      }
    });

    (player.field || []).forEach((card, index) => {
      if (!card || card.cardKind !== "monster") return;
      const guard = canStart("monster_effect", ["main1", "main2"]);
      const preview = this.effectEngine?.canActivateMonsterEffectPreview?.(
        card,
        player,
        "field",
        null,
        { activationContext }
      ) || { ok: false };
      const hint = buildHint(guard, preview, "ignition disponivel");
      if (hint) {
        indicators.field[index] = hint;
      }
    });

    (player.spellTrap || []).forEach((card, index) => {
      if (!card) return;
      const guard = canStart("spelltrap_effect", ["main1", "main2"]);
      const preview = this.effectEngine?.canActivateSpellTrapEffectPreview?.(
        card,
        player,
        "spellTrap",
        null,
        { activationContext }
      ) || { ok: false };
      const hint = buildHint(guard, preview, "ignition disponivel");
      if (hint) {
        indicators.spellTrap[index] = hint;
      }
    });

    if (player.fieldSpell) {
      const guard = canStart("fieldspell_effect", ["main1", "main2"]);
      const preview = this.effectEngine?.canActivateFieldSpellEffectPreview?.(
        player.fieldSpell,
        player,
        null,
        { activationContext }
      ) || { ok: false };
      const hint = buildHint(guard, preview, "ignition disponivel");
      if (hint) {
        indicators.fieldSpell = hint;
      }
    }

    return indicators;
  }

  /**
   * WRAPPER for unified Special Summon position resolver.
   * Delegates to EffectEngine.chooseSpecialSummonPosition for consistent behavior.
   *
   * @param {Object} player - Player summoning the card
   * @param {Object} card - Card being summoned (optional)
   * @param {Object} options - Position options (position: undefined/"choice"/"attack"/"defense")
   * @returns {Promise<string>} - Resolved position ('attack' or 'defense')
   */
  chooseSpecialSummonPosition(player, card = null, options = {}) {
    if (
      this.effectEngine &&
      typeof this.effectEngine.chooseSpecialSummonPosition === "function"
    ) {
      return this.effectEngine.chooseSpecialSummonPosition(
        card,
        player,
        options
      );
    }

    // Fallback if EffectEngine not available
    const actionPosition = options.position;
    if (actionPosition === "attack" || actionPosition === "defense") {
      return Promise.resolve(actionPosition);
    }
    // AI defaults to "attack", human also defaults to "attack" in this fallback
    return Promise.resolve("attack");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Combat damage: inflictDamage
  // → Moved to src/core/game/combat/damage.js
  // ─────────────────────────────────────────────────────────────────────────────

  // → startTurn, endTurn, waitForPhaseDelay → Moved to src/core/game/turn/lifecycle.js
  // → nextPhase, skipToPhase → Moved to src/core/game/turn/transitions.js

  showIgnitionActivateModal(card, onActivate) {
    if (this.ui && typeof this.ui.showIgnitionActivateModal === "function") {
      this.ui.showIgnitionActivateModal(card, onActivate);
    }
  }

  bindCardInteractions() {
    this.devLog("BIND_INTERACTIONS", {
      summary: "Binding card interaction handlers",
    });

    let tributeSelectionMode = false;
    let selectedTributes = [];
    let pendingSummon = null;

    if (this.ui && typeof this.ui.bindPlayerHandClick === "function") {
      this.ui.bindPlayerHandClick((e, cardEl, index) => {
        if (this.targetSelection) return;

        if (tributeSelectionMode) return;
        const card = this.player.hand[index];

        if (!card) return;

        // If resolving an effect, only allow the specific pending action
        if (this.isResolvingEffect) {
          if (
            this.pendingSpecialSummon &&
            card.name === this.pendingSpecialSummon.cardName
          ) {
            // Use unified position resolver
            this.chooseSpecialSummonPosition(this.player, card, {})
              .then((position) => {
                this.performSpecialSummon(index, position);
              })
              .catch(() => {
                this.performSpecialSummon(index, "attack");
              });
          } else {
            this.ui.log(
              "Finalize o efeito pendente antes de fazer outra acao."
            );
          }
          return;
        }

        if (card.cardKind === "monster") {
          const guard = this.guardActionStart({
            actor: this.player,
            kind: "summon",
            phaseReq: ["main1", "main2"],
          });
          if (!guard.ok) return;

          const canSanctumSpecialFromAegis =
            card.name === "Luminarch Sanctum Protector" &&
            this.player.field.length < 5 &&
            this.player.field.some(
              (c) => c && c.name === "Luminarch Aegisbearer" && !c.isFacedown
            );

          const tributeInfo = this.player.getTributeRequirement(card);
          const tributesNeeded = tributeInfo.tributesNeeded;

          const handEffect = (card.effects || []).find(
            (e) => e && e.timing === "ignition" && e.requireZone === "hand"
          );

          // Generic pre-check for hand effects (filters, OPT, targets, phase/turn)
          const handEffectPreview = handEffect
            ? this.effectEngine.canActivateMonsterEffectPreview(
                card,
                this.player,
                "hand"
              )
            : { ok: false };

          const canUseHandEffect = handEffectPreview.ok;
          const handEffectLabel = "Special Summon";

          if (
            !canUseHandEffect &&
            tributesNeeded > 0 &&
            this.player.field.length < tributesNeeded &&
            !canSanctumSpecialFromAegis
          ) {
            this.ui.log(`Not enough tributes for Level ${card.level} monster.`);
            return;
          }

          this.ui.showSummonModal(
            index,
            (choice) => {
              if (choice === "special_from_aegisbearer") {
                this.specialSummonSanctumProtectorFromHand(index);
                return;
              }

              if (choice === "special_from_void_forgotten") {
                this.tryActivateMonsterEffect(card, null, "hand");
                return;
              }

              if (choice === "special_from_hand_effect") {
                console.log("[Game] Activating hand effect for:", card.name);
                this.tryActivateMonsterEffect(card, null, "hand");
                return;
              }
              if (choice === "attack" || choice === "defense") {
                const position = choice;
                const isFacedown = choice === "defense";

                if (tributesNeeded > 0) {
                  tributeSelectionMode = true;
                  selectedTributes = [];
                  pendingSummon = {
                    cardIndex: index,
                    position,
                    isFacedown,
                    tributesNeeded,
                    altTribute: tributeInfo.usingAlt ? tributeInfo.alt : null,
                  };

                  // Filter tributeable monsters based on altTribute requirements
                  let tributeableIndices = this.player.field
                    .map((card, idx) => (card ? idx : null))
                    .filter((idx) => idx !== null);

                  // If using alt tribute with type requirement, only allow that type
                  if (tributeInfo.usingAlt && tributeInfo.alt?.requiresType) {
                    const requiredType = tributeInfo.alt.requiresType;
                    tributeableIndices = tributeableIndices.filter((idx) => {
                      const fieldCard = this.player.field[idx];
                      if (!fieldCard || fieldCard.isFacedown) return false;
                      if (Array.isArray(fieldCard.types)) {
                        return fieldCard.types.includes(requiredType);
                      }
                      return fieldCard.type === requiredType;
                    });
                  }

                  pendingSummon.tributeableIndices = tributeableIndices;
                  if (
                    this.ui &&
                    typeof this.ui.setPlayerFieldTributeable === "function"
                  ) {
                    this.ui.setPlayerFieldTributeable(
                      pendingSummon.tributeableIndices
                    );
                  }

                  this.ui.log(
                    `Select ${tributesNeeded} monster(s) to tribute.`
                  );
                } else {
                  const before = this.player.field.length;
                  const result = this.player.summon(
                    index,
                    position,
                    isFacedown
                  );
                  if (!result && this.player.field.length === before) {
                    this.updateBoard();
                    return;
                  }
                  const summonedCard =
                    this.player.field[this.player.field.length - 1];
                  summonedCard.summonedTurn = this.turnCounter;
                  summonedCard.positionChangedThisTurn = false;
                  if (summonedCard.isFacedown) {
                    summonedCard.setTurn = this.turnCounter;
                  } else {
                    summonedCard.setTurn = null;
                  }
                  this.emit("after_summon", {
                    card: summonedCard,
                    player: this.player,
                    method: "normal",
                    fromZone: "hand",
                  });
                  this.updateBoard();
                }
              }
            },
            {
              canSanctumSpecialFromAegis,
              specialSummonFromHand: false,
              specialSummonFromHandEffect: canUseHandEffect,
              specialSummonFromHandEffectLabel: handEffectLabel,
            }
          );
          return;
        }

        if (card.cardKind === "spell") {
          const guard = this.guardActionStart({
            actor: this.player,
            kind: "spell_from_hand",
            phaseReq: ["main1", "main2"],
          });
          if (!guard.ok) return;

          // Special check for Polymerization
          const spellPreview =
            this.effectEngine?.canActivateSpellFromHandPreview(
              card,
              this.player
            ) || { ok: true };
          let canActivateFromHand = !!spellPreview.ok;

          if (card.name === "Polymerization") {
            if (!this.canActivatePolymerization()) {
              canActivateFromHand = false;
            }
          }

          const handleSpellChoice = (choice) => {
            if (choice === "activate") {
              this.tryActivateSpell(card, index);
            } else if (choice === "set") {
              this.setSpellOrTrap(card, index);
            }
          };

          if (this.ui && typeof this.ui.showSpellChoiceModal === "function") {
            this.ui.showSpellChoiceModal(index, handleSpellChoice, {
              canActivate: canActivateFromHand,
            });
          } else {
            const shouldActivate =
              this.ui?.showConfirmPrompt?.(
                "OK: Activate this Spell. Cancel: Set it face-down in your Spell/Trap Zone.",
                { kind: "spell_choice", cardName: card.name }
              ) ?? false;
            handleSpellChoice(shouldActivate ? "activate" : "set");
          }
          return;
        }

        if (card.cardKind === "trap") {
          const guard = this.guardActionStart({
            actor: this.player,
            kind: "set_trap",
            phaseReq: ["main1", "main2"],
          });
          if (!guard.ok) return;
          this.setSpellOrTrap(card, index);
          return;
        }
      });
    }

    if (this.ui && typeof this.ui.bindPlayerFieldClick === "function") {
      this.ui.bindPlayerFieldClick(async (e, cardEl, index) => {
        if (
          this.targetSelection &&
          this.handleTargetSelectionClick("player", index, cardEl, "field")
        ) {
          return;
        }

        if (tributeSelectionMode && pendingSummon) {
          const allowed = pendingSummon.tributeableIndices || [];
          if (!allowed.includes(index)) return;

          if (selectedTributes.includes(index)) {
            selectedTributes = selectedTributes.filter((i) => i !== index);
            if (
              this.ui &&
              typeof this.ui.setPlayerFieldSelected === "function"
            ) {
              this.ui.setPlayerFieldSelected(index, false);
            }
          } else if (selectedTributes.length < pendingSummon.tributesNeeded) {
            selectedTributes.push(index);
            if (
              this.ui &&
              typeof this.ui.setPlayerFieldSelected === "function"
            ) {
              this.ui.setPlayerFieldSelected(index, true);
            }
          }

          if (selectedTributes.length === pendingSummon.tributesNeeded) {
            if (
              this.ui &&
              typeof this.ui.clearPlayerFieldTributeable === "function"
            ) {
              this.ui.clearPlayerFieldTributeable();
            }

            const before = this.player.field.length;
            const result = this.player.summon(
              pendingSummon.cardIndex,
              pendingSummon.position,
              pendingSummon.isFacedown,
              selectedTributes
            );

            if (!result && this.player.field.length === before) {
              tributeSelectionMode = false;
              selectedTributes = [];
              pendingSummon = null;
              this.updateBoard();
              return;
            }

            const summonedCard =
              this.player.field[this.player.field.length - 1];
            summonedCard.summonedTurn = this.turnCounter;
            summonedCard.positionChangedThisTurn = false;
            if (summonedCard.isFacedown) {
              summonedCard.setTurn = this.turnCounter;
            } else {
              summonedCard.setTurn = null;
            }

            this.emit("after_summon", {
              card: summonedCard,
              player: this.player,
              method: pendingSummon.tributesNeeded > 0 ? "tribute" : "normal",
              fromZone: "hand",
            });

            tributeSelectionMode = false;
            selectedTributes = [];
            pendingSummon = null;

            this.updateBoard();
          }
          return;
        }

        if (
          this.turn === "player" &&
          (this.phase === "main1" || this.phase === "main2")
        ) {
          const guard = this.guardActionStart({
            actor: this.player,
            kind: "monster_action",
            phaseReq: ["main1", "main2"],
          });
          if (!guard.ok) return;

          const card = this.player.field[index];
          if (!card || card.cardKind !== "monster") return;

          // Verificar se tem efeito ignition ativavel
          const hasIgnition =
            card.effects &&
            card.effects.some((eff) => eff && eff.timing === "ignition");

          const canFlip = this.canFlipSummon(card);
          const canPosChange = this.canChangePosition(card);

          // Verificar se pode fazer Ascension Summon
          let hasAscension = false;
          const materialCheck = this.canUseAsAscensionMaterial(
            this.player,
            card
          );
          if (materialCheck.ok) {
            const candidates = this.getAscensionCandidatesForMaterial(
              this.player,
              card
            );
            hasAscension = candidates.some(
              (asc) => this.checkAscensionRequirements(this.player, asc).ok
            );
          }

          // Se tem qualquer opcao disponivel, mostrar o modal unificado
          if (hasIgnition || canFlip || canPosChange || hasAscension) {
            if (e && typeof e.stopImmediatePropagation === "function") {
              e.stopImmediatePropagation();
            }

            this.ui.showPositionChoiceModal(
              cardEl,
              card,
              (choice) => {
                if (choice === "flip" && canFlip) {
                  this.flipSummon(card);
                } else if (
                  choice === "to_attack" &&
                  canPosChange &&
                  card.position !== "attack"
                ) {
                  this.changeMonsterPosition(card, "attack");
                } else if (
                  choice === "to_defense" &&
                  canPosChange &&
                  card.position !== "defense"
                ) {
                  this.changeMonsterPosition(card, "defense");
                }
              },
              {
                canFlip,
                canChangePosition: canPosChange,
                hasIgnitionEffect: hasIgnition,
                onActivateEffect: hasIgnition
                  ? () => this.tryActivateMonsterEffect(card)
                  : null,
                hasAscensionSummon: hasAscension,
                onAscensionSummon: hasAscension
                  ? () => this.tryAscensionSummon(card)
                  : null,
              }
            );
            return;
          }
        }

        if (this.turn !== "player" || this.phase !== "battle") return;

        const attacker = this.player.field[index];

        if (attacker) {
          const guard = this.guardActionStart({
            actor: this.player,
            kind: "attack",
            phaseReq: "battle",
          });
          if (!guard.ok) return;

          const availability = this.getAttackAvailability(attacker);
          if (!availability.ok) {
            this.ui.log(availability.reason);
            return;
          }

          const canUseSecondAttack =
            attacker.canMakeSecondAttackThisTurn &&
            !attacker.secondAttackUsedThisTurn;

          // Multi-attack mode bypasses the hasAttacked check
          const isMultiAttackMode =
            attacker.canAttackAllOpponentMonstersThisTurn;

          if (
            attacker.hasAttacked &&
            !canUseSecondAttack &&
            !isMultiAttackMode
          ) {
            this.ui.log("This monster has already attacked!");
            return;
          }

          const opponentTargets = this.bot.field.filter(
            (card) => card && card.cardKind === "monster"
          );

          let attackCandidates =
            opponentTargets.filter((card) => card && card.mustBeAttacked)
              .length > 0
              ? opponentTargets.filter((card) => card && card.mustBeAttacked)
              : opponentTargets;

          // For multi-attack mode, filter out monsters already attacked this turn
          if (attacker.canAttackAllOpponentMonstersThisTurn) {
            const attackedMonsters =
              attacker.attackedMonstersThisTurn || new Set();
            attackCandidates = attackCandidates.filter((card) => {
              const cardId = card.instanceId || card.id || card.name;
              return !attackedMonsters.has(cardId);
            });
          }

          // ✅ CORREÇÃO: Detecta extra attacks para AMBOS os sistemas (extraAttacks E canMakeSecondAttackThisTurn)
          // Um ataque é considerado "extra" se o monstro já atacou antes neste turno
          // Multi-attack mode allows multiple attacks, so it's not considered "extra" for direct attack purposes
          const attacksUsed = attacker.attacksUsedThisTurn || 0;
          const isExtraAttack = attacksUsed > 0 && !isMultiAttackMode;
          const canDirect =
            !attacker.cannotAttackDirectly &&
            !isExtraAttack && // Extra attacks (2nd, 3rd, etc.) cannot be direct
            !isMultiAttackMode && // Multi-attack can only target monsters, not direct
            (attacker.canAttackDirectlyThisTurn === true ||
              attackCandidates.length === 0);

          // Always start selection; "Direct Attack" option added when allowed
          if (!canDirect && attackCandidates.length === 0) {
            this.ui.log("No valid attack targets and cannot attack directly!");
            return;
          }
          this.startAttackTargetSelection(attacker, attackCandidates);
        }
      });
    }

    if (this.ui && typeof this.ui.bindPlayerSpellTrapClick === "function") {
      this.ui.bindPlayerSpellTrapClick(async (e, cardEl, index) => {
        console.log(`[Game] Spell/Trap zone clicked! Target:`, e.target);

        if (this.targetSelection) {
          const handled = this.handleTargetSelectionClick(
            "player",
            index,
            cardEl,
            "spellTrap"
          );
          if (handled) return;
          console.log(`[Game] Returning: targetSelection active`);
          return;
        }

        const card = this.player.spellTrap[index];
        if (!card) return;

        console.log(
          `[Game] Clicked spell/trap: ${card.name}, isFacedown: ${card.isFacedown}, cardKind: ${card.cardKind}`
        );

        // Handle traps - can be activated on opponent's turn and during battle phase
        if (card.cardKind === "trap") {
          const guard = this.guardActionStart({
            actor: this.player,
            kind: "trap_activation",
            phaseReq: ["main1", "battle", "main2"],
            allowDuringOpponentTurn: true,
          });
          if (!guard.ok) return;

          const hasActivateEffect = (card.effects || []).some(
            (e) => e && e.timing === "on_activate"
          );

          if (hasActivateEffect) {
            // Check if trap can be activated (waited at least 1 turn)
            if (!this.canActivateTrap(card)) {
              this.ui.log("Esta armadilha nao pode ser ativada neste turno.");
              return;
            }

            console.log(`[Game] Activating trap: ${card.name}`);
            await this.tryActivateSpellTrapEffect(card);
          }
          return;
        }

        // Spells can only be activated on your turn during Main Phase
        const guard = this.guardActionStart({
          actor: this.player,
          kind: "spelltrap_zone",
          phaseReq: ["main1", "main2"],
        });
        if (!guard.ok) return;

        // For spells, don't allow clicking facedown cards
        if (card.isFacedown) return;

        // Handle continuous spells and ignition effects
        if (card.cardKind === "spell") {
          const hasIgnition = (card.effects || []).some(
            (e) => e.timing === "ignition"
          );
          if (hasIgnition) {
            console.log(
              `[Game] Clicking continuous spell/ignition: ${card.name}`
            );
            await this.tryActivateSpellTrapEffect(card);
          }
        }
      });
    }

    if (this.ui && typeof this.ui.bindBotFieldClick === "function") {
      this.ui.bindBotFieldClick((e, cardEl, index) => {
        if (!this.targetSelection) return;
        this.handleTargetSelectionClick("bot", index, cardEl, "field");
      });
    }

    // Direcionar ataque direto: clicar na mao do oponente quando houver alvo "Direct Attack"
    if (this.ui && typeof this.ui.bindBotSpellTrapClick === "function") {
      this.ui.bindBotSpellTrapClick((e, cardEl, index) => {
        if (!this.targetSelection) return;
        this.handleTargetSelectionClick("bot", index, cardEl, "spellTrap");
      });
    }

    if (this.ui && typeof this.ui.bindBotHandClick === "function") {
      this.ui.bindBotHandClick((e) => {
        if (!this.targetSelection) return;
        if (this.targetSelection.kind !== "attack") return;
        const requirement = this.targetSelection.requirements?.[0];
        if (!requirement) return;

        const directCandidate = requirement.candidates.find(
          (c) => c && c.isDirectAttack
        );
        if (!directCandidate) return;

        // Seleciona o indice do ataque direto e finaliza selecao
        this.targetSelection.selections[requirement.id] = [directCandidate.key];
        this.targetSelection.currentRequirement =
          this.targetSelection.requirements.length;
        this.setSelectionState("confirming");
        this.finishTargetSelection();
        e.stopPropagation();
      });
    }

    // Field spell effects for player
    if (this.ui && typeof this.ui.bindPlayerFieldSpellClick === "function") {
      this.ui.bindPlayerFieldSpellClick((e, cardEl) => {
        if (this.targetSelection) {
          this.handleTargetSelectionClick("player", 0, cardEl, "fieldSpell");
          return;
        }
        const card = this.player.fieldSpell;
        if (card) {
          this.activateFieldSpellEffect(card);
        }
      });
    }

    if (this.ui && typeof this.ui.bindBotFieldSpellClick === "function") {
      this.ui.bindBotFieldSpellClick((e, cardEl) => {
        if (!this.targetSelection) return;
        this.handleTargetSelectionClick("bot", 0, cardEl, "fieldSpell");
      });
    }
    this.ui.bindCardHover((owner, location, index) => {
      let card = null;
      const playerObj = owner === "player" ? this.player : this.bot;

      if (location === "hand") {
        card = playerObj.hand[index];
      } else if (location === "field") {
        card = playerObj.field[index];
      } else if (location === "spellTrap") {
        card = playerObj.spellTrap[index];
      } else if (location === "fieldSpell") {
        card = playerObj.fieldSpell;
      }

      if (card) {
        if (card.isFacedown && owner === "bot") {
          this.ui.renderPreview(null);
        } else {
          this.ui.renderPreview(card);
        }
      }
    });

    const showGY = (player) => {
      this.openGraveyardModal(player);
    };

    if (this.ui && typeof this.ui.bindPlayerGraveyardClick === "function") {
      this.ui.bindPlayerGraveyardClick(() => showGY(this.player));
    }
    if (this.ui && typeof this.ui.bindBotGraveyardClick === "function") {
      this.ui.bindBotGraveyardClick(() => showGY(this.bot));
    }

    const showExtraDeck = (player) => {
      if (player.id !== "player") return; // Only player can view their Extra Deck
      this.openExtraDeckModal(player);
    };

    if (this.ui && typeof this.ui.bindPlayerExtraDeckClick === "function") {
      this.ui.bindPlayerExtraDeckClick(() => showExtraDeck(this.player));
    }

    if (this.ui && typeof this.ui.bindGraveyardModalClose === "function") {
      this.ui.bindGraveyardModalClose(() => {
        this.closeGraveyardModal();
      });
    }

    if (this.ui && typeof this.ui.bindExtraDeckModalClose === "function") {
      this.ui.bindExtraDeckModalClose(() => {
        this.closeExtraDeckModal();
      });
    }

    if (this.ui && typeof this.ui.bindModalOverlayClick === "function") {
      this.ui.bindModalOverlayClick((modalKind) => {
        if (modalKind === "graveyard") {
          this.closeGraveyardModal();
        }
        if (modalKind === "extradeck") {
          this.closeExtraDeckModal();
        }
      });
    }

    if (this.ui && typeof this.ui.bindGlobalKeydown === "function") {
      this.ui.bindGlobalKeydown((e) => {
        if (e.key === "Escape") {
          if (this.graveyardSelection) {
            this.closeGraveyardModal();
          } else {
            this.cancelTargetSelection();
          }
        }
      });
    }
  }

  specialSummonSanctumProtectorFromHand(handIndex) {
    const guard = this.guardActionStart({
      actor: this.player,
      kind: "special_summon",
      phaseReq: ["main1", "main2"],
    });
    if (!guard.ok) return guard;
    if (this.player.field.length >= 5) {
      this.ui.log("Field is full (max 5 monsters).");
      return;
    }

    const card = this.player.hand[handIndex];
    if (!card || card.name !== "Luminarch Sanctum Protector") return;

    const aegis = this.player.field.find(
      (c) => c && c.name === "Luminarch Aegisbearer" && !c.isFacedown
    );

    if (!aegis) {
      this.ui.log('No face-up "Luminarch Aegisbearer" to send.');
      return;
    }

    this.moveCard(aegis, this.player, "graveyard", { fromZone: "field" });

    const idxInHand = this.player.hand.indexOf(card);
    if (idxInHand === -1) return;
    this.player.hand.splice(idxInHand, 1);

    const finalizeSummon = (positionChoice) => {
      const position = positionChoice === "defense" ? "defense" : "attack";
      card.position = position;
      card.isFacedown = false;
      card.hasAttacked = false;
      card.cannotAttackThisTurn = false;
      card.attacksUsedThisTurn = 0;
      card.positionChangedThisTurn = false;
      card.summonedTurn = this.turnCounter;
      card.setTurn = null;
      card.owner = this.player.id;

      this.player.field.push(card);

      this.emit("after_summon", {
        card,
        player: this.player,
        method: "special",
        fromZone: "hand",
      });

      this.updateBoard();
    };

    const positionChoice = this.chooseSpecialSummonPosition(this.player, card);
    if (positionChoice && typeof positionChoice.then === "function") {
      positionChoice.then((resolved) => finalizeSummon(resolved));
    } else {
      finalizeSummon(positionChoice);
    }
  }

  async resolveDestructionWithReplacement(card, options = {}) {
    if (!card || card.cardKind !== "monster") {
      return { replaced: false };
    }

    const ownerPlayer = card.owner === "player" ? this.player : this.bot;
    if (!ownerPlayer) {
      return { replaced: false };
    }

    const cause = options.cause || options.reason || "effect";

    // Check for Equip Spell protection (e.g., Crescent Shield Guard)
    if (cause === "battle") {
      const guardEquip = (card.equips || []).find(
        (equip) =>
          equip && equip.grantsCrescentShieldGuard && equip.equippedTo === card
      );

      if (guardEquip) {
        this.ui.log(
          `${guardEquip.name} was destroyed to protect ${card.name}.`
        );
        const guardResult = await this.destroyCard(guardEquip, {
          cause,
          sourceCard: card,
          opponent: this.getOpponent(ownerPlayer),
          fromZone: "spellTrap",
        });
        if (guardResult?.destroyed) {
          guardEquip.grantsCrescentShieldGuard = false;
          return { replaced: true };
        }
        return { replaced: false };
      }
    }

    // Generic destruction replacement system
    // Look for effects with replacementEffect property
    const replacementEffect = (card.effects || []).find(
      (eff) =>
        eff.replacementEffect && eff.replacementEffect.type === "destruction"
    );

    if (!replacementEffect) {
      return { replaced: false };
    }

    const replacement = replacementEffect.replacementEffect;

    // Check once per turn
    const onceCheck = this.canUseOncePerTurn(
      card,
      ownerPlayer,
      replacementEffect
    );
    if (!onceCheck.ok) {
      return { replaced: false };
    }

    // Check if reason matches (battle/effect/any)
    if (
      replacement.reason &&
      replacement.reason !== "any" &&
      replacement.reason !== cause
    ) {
      return { replaced: false };
    }

    // Build filter function for cost candidates
    const costFilters = replacement.costFilters || {};
    const filterCandidates = (candidate) => {
      if (!candidate || candidate === card) return false;

      if (costFilters.cardKind && candidate.cardKind !== costFilters.cardKind)
        return false;

      if (costFilters.archetype) {
        const hasArchetype =
          candidate.archetype === costFilters.archetype ||
          (Array.isArray(candidate.archetypes) &&
            candidate.archetypes.includes(costFilters.archetype));
        if (!hasArchetype) return false;
      }

      if (costFilters.name && candidate.name !== costFilters.name) return false;

      return true;
    };

    // Find candidates in the specified zone (default: field)
    const costZone = replacement.costZone || "field";
    const candidateZone = ownerPlayer[costZone] || [];
    const candidates = candidateZone.filter(filterCandidates);

    const costCount = replacement.costCount || 1;

    if (candidates.length < costCount) {
      return { replaced: false };
    }

    // Bot auto-selection (lowest ATK for cost)
    if (ownerPlayer.id !== "player") {
      const chosen = [...candidates]
        .sort((a, b) => (a.atk || 0) - (b.atk || 0))
        .slice(0, costCount);

      for (const costCard of chosen) {
        this.moveCard(costCard, ownerPlayer, "graveyard", {
          fromZone: costZone,
        });
      }

      this.markOncePerTurnUsed(card, ownerPlayer, replacementEffect);

      const costNames = chosen.map((c) => c.name).join(", ");
      this.ui.log(
        `${card.name} avoided destruction by sending ${costNames} to the Graveyard.`
      );
      return { replaced: true };
    }

    // Player confirmation
    const costDescription = getCostTypeDescription(costFilters, costCount);
    const prompt =
      replacement.prompt ||
      `Send ${costCount} ${costDescription} to the GY to save ${card.name}?`;

    const wantsToReplace =
      this.ui?.showConfirmPrompt?.(prompt, {
        kind: "destruction_replacement",
        cardName: card.name,
      }) ?? false;
    if (!wantsToReplace) {
      return { replaced: false };
    }

    // Player selection
    const selections = await this.askPlayerToSelectCards({
      owner: "player",
      zone: costZone,
      min: costCount,
      max: costCount,
      filter: filterCandidates,
      message:
        replacement.selectionMessage ||
        `Choose ${costCount} ${
          costCount > 1 ? "cards" : "card"
        } to send to the Graveyard for ${card.name}'s protection.`,
    });

    if (!selections || selections.length < costCount) {
      this.ui.log("Protection cancelled.");
      return { replaced: false };
    }

    // Pay cost
    for (const costCard of selections) {
      this.moveCard(costCard, ownerPlayer, "graveyard", { fromZone: costZone });
    }

    this.markOncePerTurnUsed(card, ownerPlayer, replacementEffect);

    const costNames = selections.map((c) => c.name).join(", ");
    this.ui.log(
      `${card.name} avoided destruction by sending ${costNames} to the Graveyard.`
    );
    return { replaced: true };
  }

  async destroyCard(card, options = {}) {
    const result = await this.runZoneOp(
      "DESTROY_CARD",
      async () => {
        if (!card) {
          return { destroyed: false, reason: "invalid_card" };
        }

        const owner = card.owner === "player" ? this.player : this.bot;
        if (!owner) {
          return { destroyed: false, reason: "missing_owner" };
        }

        const cause = options.cause || options.reason || "effect";
        const sourceCard = options.sourceCard || options.source || null;
        const opponent = options.opponent || this.getOpponent(owner);
        const fromZone =
          options.fromZone ||
          this.effectEngine?.findCardZone?.(owner, card) ||
          null;

        if (!fromZone) {
          return { destroyed: false, reason: "not_in_zone" };
        }

        // ✅ Check protection effects before destruction
        if (
          Array.isArray(card.protectionEffects) &&
          card.protectionEffects.length > 0
        ) {
          const protectionType =
            cause === "battle" ? "battle_destruction" : "effect_destruction";

          const activeProtection = card.protectionEffects.find((p) => {
            if (p.type !== protectionType) return false;

            // Check duration validity
            if (p.duration === "while_faceup") {
              return !card.isFacedown;
            }
            if (p.duration === "end_of_turn") {
              return this.turnCounter === p.grantedOnTurn;
            }
            if (typeof p.duration === "number") {
              return this.turnCounter <= p.duration;
            }
            return true; // "permanent" or unknown duration
          });

          if (activeProtection) {
            this.ui?.log?.(
              `${card.name} is protected from destruction by ${
                cause === "battle" ? "battle" : "card effects"
              }!`
            );
            return { destroyed: false, reason: "protected", protectionType };
          }
        }

        if (this.effectEngine?.checkBeforeDestroyNegations) {
          const negationResult =
            await this.effectEngine.checkBeforeDestroyNegations(card, {
              source: sourceCard,
              player: owner,
              opponent,
              cause,
              fromZone,
            });
          if (negationResult?.negated) {
            return { destroyed: false, negated: true };
          }
        }

        const { replaced } = (await this.resolveDestructionWithReplacement(
          card,
          {
            cause,
            sourceCard,
          }
        )) || { replaced: false };

        if (replaced) {
          return { destroyed: false, replaced: true };
        }

        const moveResult = await this.moveCard(card, owner, "graveyard", {
          fromZone: fromZone || undefined,
          wasDestroyed: true,
          destroyCause: cause,
        });

        if (!moveResult || moveResult.success === false) {
          return {
            destroyed: false,
            reason: moveResult?.reason || "move_failed",
          };
        }

        // Propagar needsSelection se o moveCard retornou isso
        if (moveResult.needsSelection) {
          return {
            destroyed: true,
            needsSelection: true,
            selectionContract: moveResult.selectionContract,
          };
        }

        return { destroyed: true };
      },
      {
        contextLabel: options.contextLabel || "destroyCard",
        card,
        fromZone: options.fromZone,
        toZone: "graveyard",
      }
    );
    if (result?.destroyed) {
      const sourceCard = options.sourceCard || options.source || null;
      this.recordMaterialDestroyedOpponentMonster(sourceCard, card);
    }
    return result;
  }

  canFlipSummon(card) {
    if (!card) return false;
    const isTurnPlayer = card.owner === this.turn;
    const isMainPhase = this.phase === "main1" || this.phase === "main2";
    if (!isTurnPlayer || !isMainPhase) return false;
    if (!card.isFacedown) return false;
    if (card.positionChangedThisTurn) return false;

    const setTurn = card.setTurn ?? card.summonedTurn ?? 0;
    if (this.turnCounter <= setTurn) return false;

    return true;
  }

  canChangePosition(card) {
    if (!card) return false;
    const isTurnPlayer = card.owner === this.turn;
    const isMainPhase = this.phase === "main1" || this.phase === "main2";
    if (!isTurnPlayer || !isMainPhase) return false;
    if (card.isFacedown) return false;
    if (card.positionChangedThisTurn) return false;
    if (card.summonedTurn && this.turnCounter <= card.summonedTurn)
      return false;
    if (card.hasAttacked) return false;

    return true;
  }

  // → flipSummon → Moved to src/core/game/summon/execution.js

  changeMonsterPosition(card, newPosition) {
    if (newPosition !== "attack" && newPosition !== "defense") return;
    if (!this.canChangePosition(card)) return;
    if (!card || card.position === newPosition) return;

    card.position = newPosition;
    card.isFacedown = false;
    card.positionChangedThisTurn = true;
    card.cannotAttackThisTurn = newPosition === "defense";
    this.ui.log(
      `${card.name} changes to ${
        newPosition === "attack" ? "Attack" : "Defense"
      } Position.`
    );
    this.updateBoard();
  }

  finalizeSpellTrapActivation(card, owner, activationZone = null) {
    if (!card || !owner) return;
    const subtype = card.subtype || "";
    const kind = card.cardKind || "";
    const shouldSendToGY =
      (kind === "spell" &&
        (subtype === "normal" || subtype === "quick-play")) ||
      (kind === "trap" && subtype === "normal");

    if (shouldSendToGY) {
      this.moveCard(card, owner, "graveyard", { fromZone: activationZone });
    }
  }

  async tryActivateMonsterEffect(
    card,
    selections = null,
    activationZone = "field",
    owner = this.player,
    options = {}
  ) {
    if (this.disableEffectActivation) {
      this.ui?.log?.("Effect activations are disabled.");
      return { success: false, reason: "effects_disabled" };
    }
    if (!card) return;
    console.log(
      `[Game] tryActivateMonsterEffect called for: ${card.name} (zone: ${activationZone})`
    );
    const activationContext = {
      fromHand: activationZone === "hand",
      activationZone,
      sourceZone: activationZone,
      committed: false,
      actionContext: options.actionContext || null,
    };
    const activationEffect = this.effectEngine?.getMonsterIgnitionEffect?.(
      card,
      activationZone
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
        this.updateBoard();
      },
    });
    return pipelineResult;
  }

  async tryActivateSpellTrapEffect(card, selections = null) {
    if (this.disableEffectActivation || this.disableTraps) {
      this.ui?.log?.("Spell/Trap activations are disabled in network mode.");
      return { success: false, reason: "effects_disabled" };
    }
    if (!card) return;
    console.log(`[Game] tryActivateSpellTrapEffect called for: ${card.name}`);

    // Traps can be activated on opponent's turn and during battle phase
    const isTrap = card.cardKind === "trap";
    const guardConfig = isTrap
      ? {
          actor: this.player,
          kind: "trap_activation",
          phaseReq: ["main1", "battle", "main2"],
          allowDuringOpponentTurn: true,
        }
      : {
          actor: this.player,
          kind: "spelltrap_effect",
          phaseReq: ["main1", "main2"],
        };

    const guard = this.guardActionStart(guardConfig);
    if (!guard.ok) return guard;

    // If it's a trap, show confirmation modal first
    if (card.cardKind === "trap") {
      const confirmed = await this.ui.showTrapActivationModal(
        card,
        "manual_activation"
      );

      if (!confirmed) {
        console.log(`[Game] User cancelled trap activation`);
        return;
      }

      // Flip the trap face-up after confirmation
      if (card.isFacedown) {
        card.isFacedown = false;
        this.ui.log(`${this.player.name} ativa ${card.name}!`);
        this.updateBoard();
      }
    }

    const activationContext = {
      fromHand: false,
      activationZone: "spellTrap",
      sourceZone: "spellTrap",
      committed: false,
    };
    const activationEffect = this.effectEngine?.getSpellTrapActivationEffect?.(
      card,
      { fromHand: false }
    );

    const pipelinePhaseReq = isTrap
      ? ["main1", "battle", "main2"]
      : ["main1", "main2"];

    const pipelineResult = await this.runActivationPipeline({
      card,
      owner: this.player,
      activationZone: "spellTrap",
      activationContext,
      selections,
      selectionKind: "spellTrapEffect",
      selectionMessage: "Select target(s) for the continuous spell effect.",
      guardKind: isTrap ? "trap_activation" : "spelltrap_effect",
      phaseReq: pipelinePhaseReq,
      allowDuringOpponentTurn: isTrap,
      oncePerTurn: {
        card,
        player: this.player,
        effect: activationEffect,
      },
      activate: (chosen, ctx, zone) =>
        this.effectEngine.activateSpellTrapEffect(
          card,
          this.player,
          chosen,
          zone,
          ctx
        ),
      finalize: (result, info) => {
        if (result.placementOnly) {
          this.ui.log(`${card.name} is placed on the field.`);
        } else {
          this.finalizeSpellTrapActivation(
            card,
            this.player,
            info.activationZone
          );
          this.ui.log(`${card.name} effect activated.`);
        }
        this.updateBoard();
      },
    });
    return pipelineResult;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Selection: Methods moved to src/core/game/selection/*.js
  // See: contract.js, highlighting.js, session.js, handlers.js
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Build a serialized, public-safe snapshot of the current game state.
   * Hides opponent hand contents and face-down card details.
   * @param {"player"|"bot"} forPlayerId
   * @returns {Object} snapshot JSON
   */
  getPublicState(forPlayerId = "player") {
    const viewPlayer =
      forPlayerId === this.bot.id || forPlayerId === "bot"
        ? this.bot
        : this.player;
    const opp = viewPlayer === this.player ? this.bot : this.player;

    const serializeField = (owner, isSelf) =>
      (owner.field || []).map((card) => {
        if (!card) return null;
        const hidden = card.isFacedown && !isSelf;
        return {
          cardId: card.id,
          name: hidden ? null : card.name,
          position: card.position,
          atk: hidden ? null : card.atk,
          def: hidden ? null : card.def,
          level: hidden ? null : card.level,
          faceDown: !!card.isFacedown,
          status: {
            cannotAttackThisTurn: !!card.cannotAttackThisTurn,
            effectsNegated: !!card.effectsNegated,
            canAttackAll: !!card.canAttackAllOpponentMonstersThisTurn,
          },
        };
      });

    const serializeHand = (owner, isSelf) =>
      isSelf
        ? (owner.hand || []).map((card) => ({
            cardId: card.id,
            name: card.name,
            atk: card.atk,
            def: card.def,
            level: card.level,
            cardKind: card.cardKind,
          }))
        : { count: (owner.hand || []).length };

    const serializeSpells = (owner, isSelf) =>
      (owner.spellTrap || []).map((card) => {
        if (!card) return null;
        const hidden = card.isFacedown && !isSelf;
        return {
          cardId: card.id,
          name: hidden ? null : card.name,
          faceDown: !!card.isFacedown,
          cardKind: card.cardKind,
          subtype: hidden ? null : card.subtype,
        };
      });

    const serializeGraveyard = (owner) =>
      (owner.graveyard || []).map((card) => ({
        cardId: card.id,
        name: card.name,
        cardKind: card.cardKind,
        subtype: card.subtype ?? null,
        atk: card.cardKind === "monster" ? card.atk ?? null : null,
        def: card.cardKind === "monster" ? card.def ?? null : null,
        level: card.cardKind === "monster" ? card.level ?? null : null,
      }));

    const buildPlayerView = (owner, isSelf) => ({
      id: owner.id,
      name: owner.name,
      lp: owner.lp,
      hand: serializeHand(owner, isSelf),
      handCount: (owner.hand || []).length,
      field: serializeField(owner, isSelf),
      spellTrap: serializeSpells(owner, isSelf),
      fieldSpell: owner.fieldSpell
        ? {
            cardId: owner.fieldSpell.id,
            name:
              isSelf || !owner.fieldSpell.isFacedown
                ? owner.fieldSpell.name
                : null,
            faceDown: !!owner.fieldSpell.isFacedown,
          }
        : null,
      graveyardCount: (owner.graveyard || []).length,
      graveyard: serializeGraveyard(owner),
    });

    return {
      turn: this.turn,
      phase: this.phase,
      turnCounter: this.turnCounter,
      currentPlayer: this.turn === "player" ? this.player.id : this.bot.id,
      players: {
        self: buildPlayerView(viewPlayer, true),
        opponent: buildPlayerView(opp, false),
      },
    };
  }

  normalizeActivationResult(result) {
    const base =
      result && typeof result === "object" && !Array.isArray(result)
        ? result
        : {};
    const needsSelection = base.needsSelection === true;
    const success = needsSelection ? false : base.success === true;
    const selectionContract = base.selectionContract;

    return { ...base, success, needsSelection, selectionContract };
  }

  async runActivationPipeline(config = {}) {
    if (!config || typeof config.activate !== "function") return null;

    const owner = config.owner || this.player;
    let resolvedCard = config.card;
    if (!owner || !resolvedCard) return null;

    const selectionKind = config.selectionKind || "activation";
    let resolvedZone =
      config.activationZone || config.activationContext?.activationZone || null;

    const logPipeline = (tag, detail = {}) => {
      if (typeof this.devLog !== "function") return;
      const summaryBase = [
        resolvedCard?.name,
        selectionKind,
        resolvedZone || "zone",
      ]
        .filter(Boolean)
        .join(" | ");
      const summary =
        typeof detail.summary === "string" ? detail.summary : summaryBase;
      this.devLog(tag, { summary, ...detail });
    };

    const guardResult = this.canStartAction({
      actor: owner,
      kind: config.guardKind || selectionKind || "activation",
      phaseReq: config.phaseReq || null,
      allowDuringSelection: config.allowDuringSelection === true,
      allowDuringResolving: config.allowDuringResolving === true,
      allowDuringOpponentTurn: config.allowDuringOpponentTurn === true,
    });
    if (!guardResult.ok) {
      logPipeline("PIPELINE_GUARD_BLOCKED", {
        reason: guardResult.reason,
        code: guardResult.code,
      });
      if (
        guardResult.reason &&
        config.suppressFailureLog !== true &&
        this.ui?.log
      ) {
        this.ui.log(guardResult.reason);
      }
      return {
        success: false,
        needsSelection: false,
        reason: guardResult.reason,
        code: guardResult.code,
        blockedByGuard: true,
      };
    }

    if (typeof config.gate === "function") {
      const gateResult = config.gate();
      if (gateResult && gateResult.ok === false) {
        logPipeline("PIPELINE_PREVIEW_FAIL", { reason: gateResult.reason });
        if (gateResult.reason) {
          this.ui.log(gateResult.reason);
        }
        return gateResult;
      }
    }

    if (typeof config.preview === "function") {
      const previewResult = config.preview();
      if (previewResult && previewResult.ok === false) {
        logPipeline("PIPELINE_PREVIEW_FAIL", { reason: previewResult.reason });
        if (previewResult.reason) {
          this.ui.log(previewResult.reason);
        }
        return previewResult;
      }
      logPipeline("PIPELINE_PREVIEW_OK");
    } else {
      logPipeline("PIPELINE_PREVIEW_OK");
    }

    const oncePerTurnConfig = config.oncePerTurn || null;
    let oncePerTurnInfo = null;
    if (oncePerTurnConfig?.effect && oncePerTurnConfig.effect.oncePerTurn) {
      const optCard = oncePerTurnConfig.card || resolvedCard;
      const optPlayer = oncePerTurnConfig.player || owner;
      const optCheck = this.canUseOncePerTurn(
        optCard,
        optPlayer,
        oncePerTurnConfig.effect,
        oncePerTurnConfig
      );
      if (!optCheck.ok) {
        logPipeline("PIPELINE_OPT_BLOCKED", {
          reason: optCheck.reason,
          lockKey: optCheck.lockKey,
        });
        if (optCheck.reason) {
          this.ui.log(optCheck.reason);
        }
        return {
          success: false,
          needsSelection: false,
          reason: optCheck.reason,
          blockedOncePerTurn: true,
        };
      }
      oncePerTurnInfo = {
        card: optCard,
        player: optPlayer,
        effect: oncePerTurnConfig.effect,
        lockKey: optCheck.lockKey,
      };
    }

    let commitInfo = null;
    if (typeof config.commit === "function") {
      commitInfo = config.commit();
      if (!commitInfo || !commitInfo.cardRef) {
        return null;
      }
      resolvedCard = commitInfo.cardRef;
      resolvedZone = commitInfo.activationZone || resolvedZone;
      logPipeline("PIPELINE_COMMIT", {
        activationZone: resolvedZone,
        fromIndex: commitInfo.fromIndex,
        replacedFieldSpell: commitInfo.replacedFieldSpell?.name || null,
      });
    }

    const committed =
      config.activationContext?.committed === true || !!commitInfo;
    const fromHand =
      config.activationContext?.fromHand === true || !!commitInfo;
    const resolvedActivationZone =
      resolvedZone || config.activationContext?.activationZone || null;
    const explicitAutoSelect =
      typeof config.activationContext?.autoSelectSingleTarget === "boolean"
        ? config.activationContext.autoSelectSingleTarget
        : isAI(owner);
    const activationContext = {
      ...(config.activationContext || {}),
      fromHand,
      activationZone: resolvedActivationZone,
      sourceZone:
        config.activationContext?.sourceZone ||
        (fromHand ? "hand" : resolvedActivationZone),
      committed,
      commitInfo: config.activationContext?.commitInfo || commitInfo || null,
      autoSelectSingleTarget: explicitAutoSelect,
      selections: config.selections || null,
    };

    const safeActivate = async (selections) => {
      try {
        return await config.activate(
          selections,
          activationContext,
          resolvedActivationZone,
          resolvedCard,
          owner
        );
      } catch (err) {
        console.error("[Game] Activation pipeline error:", err);
        return {
          success: false,
          needsSelection: false,
          reason: "Resolution failed.",
        };
      }
    };

    const handleResult = async (result, fromSelection = false) => {
      const normalized = this.normalizeActivationResult(result);
      normalized.commitInfo =
        normalized.commitInfo || activationContext.commitInfo || commitInfo;
      normalized.activationZone =
        normalized.activationZone ||
        resolvedActivationZone ||
        activationContext.activationZone ||
        null;
      normalized.activationContext =
        normalized.activationContext || activationContext;
      normalized.cardRef = normalized.cardRef || resolvedCard;

      if (fromSelection) {
        logPipeline("PIPELINE_SELECTION_FINISH", {
          success: normalized.success,
          needsSelection: normalized.needsSelection,
        });
      }

      if (normalized.needsSelection) {
        const selectionContract = normalized.selectionContract;
        if (!selectionContract) {
          const selectionFailure = {
            success: false,
            needsSelection: false,
            reason: "Target selection failed.",
          };
          return handleResult(selectionFailure, true);
        }

        const allowCancel =
          activationContext.committed || config.preventCancel === true
            ? false
            : typeof config.allowCancel === "boolean"
            ? config.allowCancel
            : true;

        const normalizedContract = this.normalizeSelectionContract(
          selectionContract,
          {
            kind: selectionKind,
            message:
              config.selectionMessage || selectionContract.message || null,
            ui: {
              allowCancel,
              preventCancel:
                activationContext.committed || config.preventCancel === true,
              useFieldTargeting: config.useFieldTargeting,
              allowEmpty: config.allowEmpty,
            },
          }
        );

        if (!normalizedContract.ok) {
          const selectionFailure = {
            success: false,
            needsSelection: false,
            reason: normalizedContract.reason || "Target selection failed.",
          };
          return handleResult(selectionFailure, true);
        }

        const contract = normalizedContract.contract;
        if (typeof contract.ui.allowEmpty !== "boolean") {
          contract.ui.allowEmpty = contract.requirements.some(
            (req) => Number(req.min ?? 0) === 0
          );
        }
        // Padrão: evitar field targeting em prompts genéricos (target_select),
        // a menos que o contrato peça explicitamente.
        const usingFieldTargeting =
          typeof contract.ui.useFieldTargeting === "boolean"
            ? contract.ui.useFieldTargeting
            : false;
        contract.ui.useFieldTargeting = usingFieldTargeting;

        if (typeof config.onSelectionStart === "function") {
          config.onSelectionStart();
        }

        logPipeline("PIPELINE_SELECTION_START", {
          mode: usingFieldTargeting ? "field" : "modal",
          committed: activationContext.committed,
          requirementCount: contract.requirements.length,
        });

        const shouldAutoSelect = config.useAutoSelector === true || isAI(owner);

        if (shouldAutoSelect) {
          const autoResult = this.autoSelector?.select(contract, {
            owner,
            activationContext,
            selectionKind,
          });
          if (!autoResult?.ok) {
            const selectionFailure = {
              success: false,
              needsSelection: false,
              reason: autoResult?.reason || "Auto selection failed.",
            };
            return handleResult(selectionFailure, true);
          }
          const nextResult = await safeActivate(autoResult.selections || {});
          const normalizedNext = this.normalizeActivationResult(nextResult);
          if (normalizedNext.needsSelection) {
            const selectionFailure = {
              success: false,
              needsSelection: false,
              reason: "Auto selection failed.",
            };
            return handleResult(selectionFailure, true);
          }
          return handleResult(normalizedNext, true);
        }

        try {
          this.startTargetSelectionSession({
            kind: selectionKind,
            card: resolvedCard,
            owner,
            selectionContract: contract,
            activationZone: resolvedActivationZone,
            activationContext,
            preventCancel: contract.ui.preventCancel,
            allowCancel: contract.ui.allowCancel,
            message: contract.message,
            execute: (selections) => safeActivate(selections),
            onResult: (nextResult) => handleResult(nextResult, true),
            onCancel: allowCancel ? config.onCancel : null,
          });
        } catch (err) {
          console.error("[Game] Failed to start target selection:", err);
          if (this.targetSelection?.closeModal) {
            this.targetSelection.closeModal();
          }
          this.clearTargetHighlights();
          if (
            this.ui &&
            typeof this.ui.hideFieldTargetingControls === "function"
          ) {
            this.ui.hideFieldTargetingControls();
          }
          this.targetSelection = null;
          this.setSelectionState("idle");
          const selectionFailure = {
            success: false,
            needsSelection: false,
            reason: "Target selection failed.",
          };
          return handleResult(selectionFailure, true);
        }

        return normalized;
      }

      if (!normalized.success) {
        if (normalized.reason && config.suppressFailureLog !== true) {
          this.ui.log(normalized.reason);
        }
        if (activationContext.committed && activationContext.commitInfo) {
          this.rollbackSpellActivation(owner, activationContext.commitInfo);
          logPipeline("PIPELINE_ROLLBACK", {
            activationZone: resolvedActivationZone,
          });
        }
        if (typeof config.onFailure === "function") {
          config.onFailure(normalized, activationContext);
        }
        return normalized;
      }

      if (typeof config.finalize === "function") {
        config.finalize(normalized, {
          card: resolvedCard,
          owner,
          activationZone: resolvedActivationZone,
          activationContext,
        });
      }

      const shouldCountMaterialActivation =
        resolvedCard?.cardKind === "monster" &&
        (selectionKind === "monsterEffect" ||
          selectionKind === "graveyardEffect");
      if (shouldCountMaterialActivation) {
        this.recordMaterialEffectActivation(owner, resolvedCard, {
          contextLabel: selectionKind,
        });
      }
      if (oncePerTurnInfo) {
        this.markOncePerTurnUsed(
          oncePerTurnInfo.card,
          oncePerTurnInfo.player,
          oncePerTurnInfo.effect,
          { lockKey: oncePerTurnInfo.lockKey }
        );
      }
      logPipeline("PIPELINE_FINALIZE", {
        activationZone: resolvedActivationZone,
      });
      if (typeof config.onSuccess === "function") {
        config.onSuccess(normalized, activationContext);
      }
      return normalized;
    };

    const initialResult = await safeActivate(config.selections || null);
    return handleResult(initialResult, false);
  }

  async runActivationPipelineWait(config = {}) {
    let finished = false;
    let resolvePromise = null;

    const waitForFinish = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    const finishOnce = (result) => {
      if (finished) return;
      finished = true;
      if (typeof resolvePromise === "function") {
        resolvePromise(result);
      }
    };

    const wrappedConfig = {
      ...config,
      onSuccess: (result, ctx) => {
        if (typeof config.onSuccess === "function") {
          config.onSuccess(result, ctx);
        }
        finishOnce(result);
      },
      onFailure: (result, ctx) => {
        if (typeof config.onFailure === "function") {
          config.onFailure(result, ctx);
        }
        finishOnce(result);
      },
      onCancel: () => {
        if (typeof config.onCancel === "function") {
          config.onCancel();
        }
        finishOnce({
          success: false,
          needsSelection: false,
          reason: "Selection cancelled.",
        });
      },
    };

    const initialResult = await this.runActivationPipeline(wrappedConfig);
    // O servidor vai gerar o prompt e a Promise não deve ficar pendente
    if (initialResult?.needsSelection === true) {
      finishOnce(initialResult);
    } else if (
      !finished &&
      (!initialResult || initialResult.needsSelection !== true)
    ) {
      finishOnce(initialResult);
    }

    return waitForFinish;
  }

  activateFieldSpellEffect(card) {
    const owner = card.owner === "player" ? this.player : this.bot;
    const guard = this.guardActionStart(
      {
        actor: owner,
        kind: "fieldspell_effect",
        phaseReq: ["main1", "main2"],
      },
      owner === this.player
    );
    if (!guard.ok) return guard;
    const activationContext = {
      fromHand: false,
      activationZone: "fieldSpell",
      sourceZone: "fieldSpell",
      committed: false,
    };
    const activationEffect =
      this.effectEngine?.getFieldSpellActivationEffect?.(card);
    const pipelineResult = this.runActivationPipeline({
      card,
      owner,
      activationZone: "fieldSpell",
      activationContext,
      selectionKind: "fieldSpell",
      selectionMessage: "Select target(s) for the field spell effect.",
      guardKind: "fieldspell_effect",
      phaseReq: ["main1", "main2"],
      oncePerTurn: {
        card,
        player: owner,
        effect: activationEffect,
      },
      activate: (selections, ctx) =>
        this.effectEngine.activateFieldSpell(card, owner, selections, ctx),
      finalize: () => {
        this.ui.log(`${card.name} field effect activated.`);
        this.updateBoard();
      },
    });
    return pipelineResult;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Combat targeting: startAttackTargetSelection
  // → Moved to src/core/game/combat/targeting.js
  // ─────────────────────────────────────────────────────────────────────────────

  // → openGraveyardModal, closeGraveyardModal → Moved to src/core/game/graveyard/modal.js
  // → openExtraDeckModal, closeExtraDeckModal → Moved to src/core/game/extraDeck/modal.js
  // → getMaterialFieldAgeTurnCounter, getAscensionCandidatesForMaterial, checkAscensionRequirements, canUseAsAscensionMaterial, performAscensionSummon, tryAscensionSummon → Moved to src/core/game/summon/ascension.js

  // ─────────────────────────────────────────────────────────────────────────────
  // Combat availability: getAttackAvailability, markAttackUsed, registerAttackNegated, canDestroyByBattle
  // → Moved to src/core/game/combat/availability.js
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // Combat resolution: resolveCombat, finishCombat
  // → Moved to src/core/game/combat/resolution.js
  // ─────────────────────────────────────────────────────────────────────────────

  // → performFusionSummon → Moved to src/core/game/summon/execution.js

  // → performSpecialSummon → Moved to src/core/game/summon/execution.js

  canActivatePolymerization() {
    // Check if player has Extra Deck with Fusion Monsters
    if (!this.player.extraDeck || this.player.extraDeck.length === 0) {
      return false;
    }

    // Check field space
    if (this.player.field.length >= 5) {
      return false;
    }

    // Get available materials (hand + field)
    const availableMaterials = [
      ...(this.player.hand || []),
      ...(this.player.field || []),
    ].filter((card) => card && card.cardKind === "monster");

    if (availableMaterials.length === 0) {
      return false;
    }

    // Check if at least one Fusion Monster can be summoned
    for (const fusion of this.player.extraDeck) {
      if (
        this.effectEngine.canSummonFusion(
          fusion,
          availableMaterials,
          this.player
        )
      ) {
        return true;
      }
    }

    return false;
  }

  highlightReadySpecialSummon() {
    // Find and highlight the card ready for special summon in hand
    if (!this.pendingSpecialSummon) return;
    const indices = [];
    this.player.hand.forEach((card, index) => {
      if (card && card.name === this.pendingSpecialSummon.cardName) {
        indices.push(index);
      }
    });
    if (this.ui && typeof this.ui.applyHandTargetableIndices === "function") {
      this.ui.applyHandTargetableIndices("player", indices);
    }
  }

  checkWinCondition() {
    if (this.gameOver) return; // Já terminou

    if (this.player.lp <= 0) {
      this.ui?.showAlert?.("Game Over! You Lost.");
      this.gameOver = true;
      this.emit("game_over", {
        winner: this.bot,
        winnerId: this.bot.id,
        loser: this.player,
        loserId: this.player.id,
        reason: "lp_zero",
      });
    } else if (this.bot.lp <= 0) {
      this.ui?.showAlert?.("Victory! You Won.");
      this.gameOver = true;
      this.emit("game_over", {
        winner: this.player,
        winnerId: this.player.id,
        loser: this.bot,
        loserId: this.bot.id,
        reason: "lp_zero",
      });
    }
  }

  getOpponent(player) {
    return player.id === "player" ? this.bot : this.player;
  }

  // → cleanupTempBoosts → Moved to src/core/game/turn/cleanup.js

  // ─────────────────────────────────────────────────────────────────────────────
  // Zone methods (ownership, snapshot, invariants, operations, movement)
  // → Moved to src/core/game/zones/*.js
  // ─────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────
  // Combat applyBattleDestroyEffect
  // → Moved to src/core/game/combat/resolution.js
  // ─────────────────────────────────────────────────────────────────────────────

  setSpellOrTrap(card, handIndex, actor = this.player) {
    const guard = this.guardActionStart({
      actor,
      kind: "set_spell_trap",
      phaseReq: ["main1", "main2"],
    });
    if (!guard.ok) return guard;
    if (!card) return { ok: false, reason: "no_card" };
    if (card.cardKind !== "spell" && card.cardKind !== "trap") {
      return { ok: false, reason: "not_spell_trap" };
    }

    if (card.cardKind === "spell" && card.subtype === "field") {
      this.ui.log("Field Spells cannot be Set.");
      return { ok: false, reason: "cannot_set_field_spell" };
    }

    const zone = actor.spellTrap;
    if (zone.length >= 5) {
      this.ui.log("Spell/Trap zone is full (max 5 cards).");
      return { ok: false, reason: "zone_full" };
    }

    card.isFacedown = true;
    card.turnSetOn = this.turnCounter;

    if (typeof this.moveCard === "function") {
      this.moveCard(card, actor, "spellTrap", { fromZone: "hand" });
    } else {
      if (handIndex >= 0 && handIndex < actor.hand.length) {
        actor.hand.splice(handIndex, 1);
      }
      actor.spellTrap.push(card);
    }

    this.updateBoard();
    return { ok: true, success: true, card };
  }

  async tryActivateSpell(card, handIndex, selections = null, options = {}) {
    const owner = options.owner || this.player;
    const resume = options.resume || null;
    const actionContext = options.actionContext || null;
    const activationEffect = this.effectEngine?.getSpellTrapActivationEffect?.(
      card,
      { fromHand: true }
    );

    const resumeCommitInfo = resume?.commitInfo || null;
    const resolvedActivationZone =
      resume?.activationZone || resumeCommitInfo?.activationZone || null;
    const baseActivationContext = resume?.activationContext || {
      fromHand: true,
      activationZone: resolvedActivationZone,
      sourceZone: "hand",
      committed: false,
      commitInfo: resumeCommitInfo,
      actionContext,
    };

    const pipelineResult = await this.runActivationPipeline({
      card,
      owner,
      selections,
      selectionKind: "spellTrapEffect",
      selectionMessage: "Select target(s) for the continuous spell effect.",
      guardKind: "spell_from_hand",
      phaseReq: ["main1", "main2"],
      preview: resume
        ? null
        : () =>
            this.effectEngine?.canActivateSpellFromHandPreview?.(card, owner),
      commit: resume
        ? () =>
            resumeCommitInfo || {
              cardRef: card,
              activationZone: resolvedActivationZone || "spellTrap",
              fromIndex: handIndex,
            }
        : () => this.commitCardActivationFromHand(owner, handIndex),
      activationContext: {
        ...baseActivationContext,
        committed: resume ? true : baseActivationContext.committed,
        activationZone:
          resolvedActivationZone || baseActivationContext.activationZone,
        sourceZone: baseActivationContext.sourceZone || "hand",
        commitInfo:
          baseActivationContext.commitInfo || resumeCommitInfo || null,
        actionContext,
      },
      oncePerTurn: {
        card,
        player: owner,
        effect: activationEffect,
      },
      activate: (chosen, ctx, zone, resolvedCard) =>
        this.effectEngine.activateSpellTrapEffect(
          resolvedCard,
          owner,
          chosen,
          zone,
          ctx
        ),
      finalize: async (result, info) => {
        if (result.placementOnly) {
          this.ui.log(`${info.card.name} is placed on the field.`);
        } else {
          this.finalizeSpellTrapActivation(
            info.card,
            owner,
            info.activationZone
          );
          this.ui.log(`${info.card.name} effect activated.`);

          // Offer chain window for opponent to respond to spell activation
          await this.checkAndOfferTraps("card_activation", {
            card: info.card,
            player: owner,
            activationType: "spell",
          });
        }
        this.updateBoard();
      },
    });
    return pipelineResult;
  }

  rollbackSpellActivation(player, commitInfo) {
    if (!player || !commitInfo || !commitInfo.cardRef) return;
    const { cardRef, activationZone, fromIndex, replacedFieldSpell } =
      commitInfo;
    const sourceZone = activationZone || "spellTrap";
    this.moveCard(cardRef, player, "hand", { fromZone: sourceZone });

    if (
      typeof fromIndex === "number" &&
      fromIndex >= 0 &&
      fromIndex < player.hand.length
    ) {
      const currentIndex = player.hand.indexOf(cardRef);
      if (currentIndex > -1 && currentIndex !== fromIndex) {
        player.hand.splice(currentIndex, 1);
        player.hand.splice(fromIndex, 0, cardRef);
      }
    }

    if (
      activationZone === "fieldSpell" &&
      replacedFieldSpell &&
      player.graveyard?.includes(replacedFieldSpell)
    ) {
      this.moveCard(replacedFieldSpell, player, "fieldSpell", {
        fromZone: "graveyard",
      });
    }

    this.updateBoard();
    this.assertStateInvariants("rollbackSpellActivation", { failFast: false });
  }

  /**
   * Move a Spell/Trap from hand to the appropriate zone before resolving
   * activation. Returns the committed card reference and activation zone.
   */
  commitCardActivationFromHand(player, handIndex) {
    if (!player || handIndex == null) return null;
    const card = player.hand?.[handIndex];
    if (!card) return null;
    if (card.cardKind !== "spell" && card.cardKind !== "trap") return null;

    const isFieldSpell = card.subtype === "field";
    const activationZone = isFieldSpell ? "fieldSpell" : "spellTrap";
    const replacedFieldSpell = isFieldSpell ? player.fieldSpell : null;

    // Check zone capacity
    if (!isFieldSpell && player.spellTrap.length >= 5) {
      this.ui.log("Spell/Trap zone is full (max 5 cards).");
      return null;
    }

    // Ensure face-up when placed
    card.isFacedown = false;

    // Move to destination
    if (typeof this.moveCard === "function") {
      this.moveCard(card, player, activationZone, { fromZone: "hand" });
    } else {
      // Fallback (should not happen)
      player.hand.splice(handIndex, 1);
      if (isFieldSpell) {
        player.fieldSpell = card;
      } else {
        player.spellTrap.push(card);
      }
    }

    // Determine zone index if in S/T array
    const zoneIndex =
      activationZone === "spellTrap" ? player.spellTrap.indexOf(card) : null;

    this.updateBoard();

    return {
      cardRef: card,
      activationZone,
      zoneIndex,
      fromIndex: handIndex,
      replacedFieldSpell,
    };
  }

  showShadowHeartCathedralModal(validMonsters, maxAtk, counterCount, callback) {
    console.log(
      `[Cathedral Modal] Opening with ${validMonsters.length} valid monsters, Max ATK: ${maxAtk}, Counters: ${counterCount}`
    );

    if (
      this.ui &&
      typeof this.ui.showShadowHeartCathedralModal === "function"
    ) {
      this.ui.showShadowHeartCathedralModal(
        validMonsters,
        maxAtk,
        counterCount,
        callback
      );
      return;
    }

    console.log("[Cathedral Modal] Renderer unavailable; skipping modal.");
    callback(null);
  }

  canActivateTrap(card) {
    console.log(
      `[canActivateTrap] Checking: ${card?.name}, cardKind: ${card?.cardKind}, isFacedown: ${card?.isFacedown}, turnSetOn: ${card?.turnSetOn}, currentTurn: ${this.turnCounter}`
    );
    if (!card || card.cardKind !== "trap") return false;
    if (!card.isFacedown) return false;
    if (!card.turnSetOn) return false;

    // Trap só pode ser ativada a partir do próximo turno
    const result = this.turnCounter > card.turnSetOn;
    console.log(
      `[canActivateTrap] Result: ${result} (${this.turnCounter} > ${card.turnSetOn})`
    );
    return result;
  }

  async checkAndOfferTraps(event, eventData = {}) {
    if (!this.player || this.disableTraps || this.disableChains) return;

    // Evitar reentrância: se já existe um modal de trap aberto, não abrir outro
    if (this.trapPromptInProgress) return;

    // Se o ChainSystem já está resolvendo, não interromper
    if (this.chainSystem?.isChainResolving()) return;

    // Prevenir abrir nova chain window enquanto outra já está aberta
    if (this.chainSystem?.isChainWindowOpen?.()) return;

    this.trapPromptInProgress = true;

    try {
      // Mapear evento para contexto de chain
      const contextType = this._mapEventToChainContext(event);

      // Usar ChainSystem para abrir chain window
      const attacker = eventData.attacker || null;
      const defender = eventData.defender ?? eventData.target ?? null;
      const attackerOwner =
        eventData.attackerOwner ??
        (attacker
          ? attacker.owner === "player"
            ? this.player
            : this.bot
          : null);
      const defenderOwner =
        eventData.defenderOwner ??
        (defender
          ? defender.owner === "player"
            ? this.player
            : this.bot
          : null);

      const context = {
        type: contextType,
        event,
        ...eventData,
        attacker,
        defender,
        target: defender ?? eventData.target ?? null,
        attackerOwner,
        defenderOwner,
        targetOwner: eventData.targetOwner ?? defenderOwner ?? null,
        isOpponentAttack:
          eventData.isOpponentAttack ??
          (attackerOwner && defenderOwner
            ? attackerOwner.id !== defenderOwner.id &&
              defenderOwner.id === "player"
            : false),
        triggerPlayer:
          attackerOwner ||
          eventData.player ||
          (this.turn === "player" ? this.player : this.bot),
      };

      // Verificar se há cartas ativáveis antes de abrir chain window
      const playerActivatable = this.chainSystem.getActivatableCardsInChain(
        this.player,
        context
      );
      const botActivatable = this.chainSystem.getActivatableCardsInChain(
        this.bot,
        context
      );

      if (playerActivatable.length === 0 && botActivatable.length === 0) {
        return; // Nenhuma carta pode responder
      }

      // Abrir chain window através do ChainSystem
      await this.chainSystem.openChainWindow(context);
    } finally {
      this.trapPromptInProgress = false;
      this.testModeEnabled = false;
    }
  }

  /**
   * Map game events to chain context types
   * @param {string} event
   * @returns {string}
   */
  _mapEventToChainContext(event) {
    const eventToContext = {
      attack_declared: "attack_declaration",
      after_summon: "summon",
      phase_end: "phase_change",
      phase_start: "phase_change",
      card_activation: "card_activation",
      effect_activation: "effect_activation",
      battle_damage: "battle_damage",
      effect_targeted: "effect_targeted",
    };
    return eventToContext[event] || "card_activation";
  }

  async activateTrapFromZone(card, eventData = {}) {
    if (!card || card.cardKind !== "trap") return;

    const trapIndex = this.player.spellTrap.indexOf(card);
    if (trapIndex === -1) return;

    const guard = this.guardActionStart({
      actor: this.player,
      kind: "trap_activation",
      allowDuringOpponentTurn: true,
      allowDuringResolving: true,
    });
    if (!guard.ok) return guard;

    // Virar a carta face-up
    card.isFacedown = false;
    this.ui.log(`${this.player.name} ativa ${card.name}!`);

    // Resolver efeitos
    const result = await this.effectEngine.resolveTrapEffects(
      card,
      this.player,
      eventData
    );

    // Se for trap normal, mover para o cemitério após resolver
    if (card.subtype === "normal") {
      this.moveCard(card, this.player, "graveyard", { fromZone: "spellTrap" });
    }
    // Se for continuous, permanece no campo face-up

    this.updateBoard();
    return result;
  }

  resolvePlayerById(id = "player") {
    return id === "bot" ? this.bot : this.player;
  }

  resolveCardData(identifier) {
    if (identifier && typeof identifier === "object") {
      if (typeof identifier.id === "number") {
        const found = cardDatabaseById.get(identifier.id);
        if (found) return found;
      }
      if (identifier.name) {
        return this.resolveCardData(identifier.name);
      }
    }

    if (typeof identifier === "number") {
      return cardDatabaseById.get(identifier) || null;
    }

    if (typeof identifier !== "string") {
      return null;
    }

    const trimmed = identifier.trim();
    if (!trimmed) return null;

    let data = cardDatabaseByName.get(trimmed);
    if (data) return data;

    const lower = trimmed.toLowerCase();
    for (const [name, item] of cardDatabaseByName.entries()) {
      if (typeof name === "string" && name.toLowerCase() === lower) {
        return item;
      }
    }
    return null;
  }

  createCardForOwner(identifier, owner, overrides = {}) {
    const player =
      typeof owner === "string" ? this.resolvePlayerById(owner) : owner;
    if (!player) return null;
    const data = this.resolveCardData(identifier);
    if (!data) return null;

    const card = new Card(data, player.id);
    if (overrides.position) {
      card.position = overrides.position === "defense" ? "defense" : "attack";
    }
    if (typeof overrides.isFacedown === "boolean") {
      card.isFacedown = overrides.isFacedown;
    } else if (overrides.facedown === true) {
      card.isFacedown = true;
    }
    if (overrides.turnSetOn != null) {
      card.turnSetOn = overrides.turnSetOn;
    }
    if (overrides.counters && card.counters instanceof Map) {
      Object.entries(overrides.counters).forEach(([type, amount]) => {
        if (typeof amount === "number" && amount > 0) {
          card.counters.set(type, amount);
        }
      });
    }
    return card;
  }

  setMonsterFacing(card, options = {}) {
    if (!card || card.cardKind !== "monster") return;
    if (options.position) {
      card.position = options.position === "defense" ? "defense" : "attack";
    }
    if (typeof options.facedown === "boolean") {
      card.isFacedown = options.facedown;
    }
    if (card.isFacedown) {
      card.position = "defense";
    }
    if (card.position !== "attack" && card.position !== "defense") {
      card.position = "attack";
    }
    if (typeof card.isFacedown !== "boolean") {
      card.isFacedown = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DevTools methods moved to core/game/devTools/
  // See: commands.js, sanity.js, setup.js
  // Methods are attached to prototype after class definition
  // ─────────────────────────────────────────────────────────────────────────────
}

// ─────────────────────────────────────────────────────────────────────────────
// DevTools: Attach methods from modular devTools/ folder
// ─────────────────────────────────────────────────────────────────────────────

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

// Sanity tests: devRunSanityA through devRunSanityO
Game.prototype.devRunSanityA = devToolsSanity.devRunSanityA;
Game.prototype.devRunSanityB = devToolsSanity.devRunSanityB;
Game.prototype.devRunSanityC = devToolsSanity.devRunSanityC;
Game.prototype.devRunSanityD = devToolsSanity.devRunSanityD;
Game.prototype.devRunSanityE = devToolsSanity.devRunSanityE;
Game.prototype.devRunSanityF = devToolsSanity.devRunSanityF;
Game.prototype.devRunSanityG = devToolsSanity.devRunSanityG;
Game.prototype.devRunSanityH = devToolsSanity.devRunSanityH;
Game.prototype.devRunSanityI = devToolsSanity.devRunSanityI;
Game.prototype.devRunSanityJ = devToolsSanity.devRunSanityJ;
Game.prototype.devRunSanityK = devToolsSanity.devRunSanityK;
Game.prototype.devRunSanityL = devToolsSanity.devRunSanityL;
Game.prototype.devRunSanityM = devToolsSanity.devRunSanityM;
Game.prototype.devRunSanityN = devToolsSanity.devRunSanityN;
Game.prototype.devRunSanityO = devToolsSanity.devRunSanityO;

// Setup: applyManualSetup
Game.prototype.applyManualSetup = devToolsSetup.applyManualSetup;

// ─────────────────────────────────────────────────────────────────────────────
// Events: Attach methods from modular events/ folder
// ─────────────────────────────────────────────────────────────────────────────

// Event Bus: on, emit
Game.prototype.on = eventBus.on;
Game.prototype.emit = eventBus.emit;

// Event Resolver: resolveEvent, resolveEventEntries, resumePendingEventSelection
Game.prototype.resolveEvent = eventResolver.resolveEvent;
Game.prototype.resolveEventEntries = eventResolver.resolveEventEntries;
Game.prototype.resumePendingEventSelection =
  eventResolver.resumePendingEventSelection;

// ─────────────────────────────────────────────────────────────────────────────
// Selection: Attach methods from modular selection/ folder
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Zones: Attach methods from modular zones/ folder
// ─────────────────────────────────────────────────────────────────────────────

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

// Invariants: assertStateInvariants
Game.prototype.assertStateInvariants = zonesInvariants.assertStateInvariants;

// Operations: getZone, runZoneOp
Game.prototype.getZone = zonesOperations.getZone;
Game.prototype.runZoneOp = zonesOperations.runZoneOp;

// Movement: cleanupTokenReferences, moveCard, moveCardInternal
Game.prototype.cleanupTokenReferences = zonesMovement.cleanupTokenReferences;
Game.prototype.moveCard = zonesMovement.moveCard;
Game.prototype.moveCardInternal = zonesMovement.moveCardInternal;

// ─────────────────────────────────────────────────────────────────────────────
// Combat: Attach methods from modular combat/ folder
// ─────────────────────────────────────────────────────────────────────────────

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
Game.prototype.markAttackUsed = combatAvailability.markAttackUsed;
Game.prototype.registerAttackNegated = combatAvailability.registerAttackNegated;
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

// ─────────────────────────────────────────────────────────────────────────────
// Summon: Attach methods from modular summon/ folder
// ─────────────────────────────────────────────────────────────────────────────

// Tracking: _trackSpecialSummonType, getSpecialSummonedTypeCount, resolveDelayedSummon
Game.prototype._trackSpecialSummonType = summonTracking._trackSpecialSummonType;
Game.prototype.getSpecialSummonedTypeCount =
  summonTracking.getSpecialSummonedTypeCount;
Game.prototype.resolveDelayedSummon = summonTracking.resolveDelayedSummon;

// Execution: flipSummon, performFusionSummon, performSpecialSummon
Game.prototype.flipSummon = summonExecution.flipSummon;
Game.prototype.performFusionSummon = summonExecution.performFusionSummon;
Game.prototype.performSpecialSummon = summonExecution.performSpecialSummon;

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

// ─────────────────────────────────────────────────────────────────────────────
// Deck: Attach methods from modular deck/ folder
// ─────────────────────────────────────────────────────────────────────────────

// Draw: drawCards, forceOpeningHand
Game.prototype.drawCards = deckDraw.drawCards;
Game.prototype.forceOpeningHand = deckDraw.forceOpeningHand;

// ─────────────────────────────────────────────────────────────────────────────
// Graveyard: Attach methods from modular graveyard/ folder
// ─────────────────────────────────────────────────────────────────────────────

// Modal: openGraveyardModal, closeGraveyardModal
Game.prototype.openGraveyardModal = graveyardModal.openGraveyardModal;
Game.prototype.closeGraveyardModal = graveyardModal.closeGraveyardModal;

// ─────────────────────────────────────────────────────────────────────────────
// Extra Deck: Attach methods from modular extraDeck/ folder
// ─────────────────────────────────────────────────────────────────────────────

// Modal: openExtraDeckModal, closeExtraDeckModal
Game.prototype.openExtraDeckModal = extraDeckModal.openExtraDeckModal;
Game.prototype.closeExtraDeckModal = extraDeckModal.closeExtraDeckModal;

// ─────────────────────────────────────────────────────────────────────────────
// Turn: Attach methods from modular turn/ folder
// ─────────────────────────────────────────────────────────────────────────────

// Scheduling: scheduleDelayedAction, processDelayedActions, resolveDelayedAction
Game.prototype.scheduleDelayedAction = turnScheduling.scheduleDelayedAction;
Game.prototype.processDelayedActions = turnScheduling.processDelayedActions;
Game.prototype.resolveDelayedAction = turnScheduling.resolveDelayedAction;

// Cleanup: cleanupExpiredBuffs, cleanupTempBoosts
Game.prototype.cleanupExpiredBuffs = turnCleanup.cleanupExpiredBuffs;
Game.prototype.cleanupTempBoosts = turnCleanup.cleanupTempBoosts;

// Lifecycle: startTurn, endTurn, waitForPhaseDelay
Game.prototype.startTurn = turnLifecycle.startTurn;
Game.prototype.endTurn = turnLifecycle.endTurn;
Game.prototype.waitForPhaseDelay = turnLifecycle.waitForPhaseDelay;

// Transitions: nextPhase, skipToPhase
Game.prototype.nextPhase = turnTransitions.nextPhase;
Game.prototype.skipToPhase = turnTransitions.skipToPhase;
