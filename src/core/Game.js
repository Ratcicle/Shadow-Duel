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

// Spell/Trap modules (moved from inline methods)
import * as spellTrapSet from "./game/spellTrap/set.js";
import * as spellTrapActivation from "./game/spellTrap/activation.js";
import * as spellTrapFinalization from "./game/spellTrap/finalization.js";
import * as spellTrapVerification from "./game/spellTrap/verification.js";
import * as spellTrapTriggers from "./game/spellTrap/triggers.js";

// UI modules (moved from inline methods)
import * as uiBoard from "./game/ui/board.js";
import * as uiIndicators from "./game/ui/indicators.js";
import * as uiModals from "./game/ui/modals.js";
import * as uiPrompts from "./game/ui/prompts.js";
import * as uiWinCondition from "./game/ui/winCondition.js";
import * as uiInteractions from "./game/ui/interactions.js";

// Replay capture integration
import * as replayIntegration from "./game/replay/integration.js";

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
    this.winner = null; // Will be set by checkWinCondition()
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
    this.temporaryReplacementEffects = [];
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

  resetMaterialDuelStats(reason = "reset") {
    this.materialDuelStats = {
      player: {
        destroyedOpponentMonstersByMaterialId: new Map(),
        effectActivationsByMaterialId: new Map(),
      },
    };
    this.devLog("MATERIAL_STATS_RESET", { summary: reason });
  }

  // -----------------------------------------------------------------------------
  // Summon tracking: _trackSpecialSummonType, getSpecialSummonedTypeCount
  // ? Moved to src/core/game/summon/tracking.js
  // -----------------------------------------------------------------------------

  // ? scheduleDelayedAction, processDelayedActions, resolveDelayedAction ? Moved to src/core/game/turn/scheduling.js

  // -----------------------------------------------------------------------------
  // Summon delayed: resolveDelayedSummon
  // ? Moved to src/core/game/summon/tracking.js
  // -----------------------------------------------------------------------------

  /**
   * ? FASE 4: Aplicar buff tempor�rio com expira��o baseada em turno
   * Suporta m�ltiplos buffs simult�neos com expira��o em turnos diferentes
   * @param {Object} card - Carta a receber o buff
   * @param {string} stat - Stat afetado ("atk" ou "def")
   * @param {number} value - Valor do buff
   * @param {number} expiresOnTurn - Turno em que o buff expira
   * @param {string} id - ID �nico do buff (opcional)
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

    // Aplicar modifica��o imediata ao stat
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

  // ? cleanupExpiredBuffs ? Moved to src/core/game/turn/cleanup.js

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
      1,
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
      1,
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

  // -----------------------------------------------------------------------------
  // Zones: Methods moved to src/core/game/zones/*.js
  // See: ownership.js, snapshot.js, invariants.js, operations.js, movement.js
  // -----------------------------------------------------------------------------

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
        "Finalize a selecao atual antes de iniciar outra acao.",
      );
    }

    if (resolvingActive && !allowDuringResolving) {
      return blocked(
        "BLOCKED_RESOLVING",
        "Finalize o efeito pendente antes de fazer outra acao.",
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
          "Esta acao nao pode ser usada nesta fase.",
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

  // -----------------------------------------------------------------------------
  // Events methods moved to core/game/events/
  // See: eventBus.js, eventResolver.js
  // Methods are attached to prototype after class definition
  // -----------------------------------------------------------------------------

  async start(deckList = null, extraDeckList = null) {
    // BUG #9 FIX: Reset once-per-duel usage between duels
    // This ensures effects like "once per duel" are available in new matches
    this.player.oncePerDuelUsageByName = Object.create(null);
    this.bot.oncePerDuelUsageByName = Object.create(null);

    this.resetMaterialDuelStats("start");
    this.player.buildDeck(deckList);
    this.player.buildExtraDeck(extraDeckList);
    this.bot.buildDeck();
    this.bot.buildExtraDeck();

    // Integra��o do sistema de captura de replay (se habilitado)
    replayIntegration.integrateReplayCapture(this);
    replayIntegration.startReplayCapture(this);

    if (this.testModeEnabled) {
      this.forceOpeningHand("Infinity Searcher", 4);
      this.ui.log("Modo teste: adicionando 4 Infinity Searcher a mao inicial.");
    }

    this.drawCards(this.player, 4);
    this.drawCards(this.bot, 4);

    this.updateBoard();
    await this.startTurn();
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

  /**
   * @deprecated LEGACY CODE - Hardcoded logic for "Luminarch Sanctum Protector" card.
   * This should be replaced with a declarative effect on the card using the
   * `special_summon_from_hand_with_cost` handler type.
   * TODO: Add ignition effect to "Luminarch Sanctum Protector" card definition and remove this method.
   */
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
      (c) => c && c.name === "Luminarch Aegisbearer" && !c.isFacedown,
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
    if (!card) {
      return { replaced: false };
    }

    const ownerPlayer = card.owner === "player" ? this.player : this.bot;
    if (!ownerPlayer) {
      return { replaced: false };
    }

    const cause = options.cause || options.reason || "effect";
    const fromZone =
      options.fromZone ||
      this.effectEngine?.findCardZone?.(ownerPlayer, card) ||
      null;

    // Check for Equip Spell protection (e.g., Crescent Shield Guard)
    if (cause === "battle" && card.cardKind === "monster") {
      const guardEquip = (card.equips || []).find(
        (equip) =>
          equip && equip.grantsCrescentShieldGuard && equip.equippedTo === card,
      );

      if (guardEquip) {
        this.ui.log(
          `${guardEquip.name} was destroyed to protect ${card.name}.`,
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

    const formatReplacementText = (text, sourceCardName) => {
      if (!text) return text;
      return text
        .replace("{target}", card.name)
        .replace("{source}", sourceCardName || "");
    };

    const matchesTargetFilters = (target, filters) => {
      if (!filters || Object.keys(filters).length === 0) return true;
      if (this.effectEngine?.cardMatchesFilters) {
        return this.effectEngine.cardMatchesFilters(target, filters);
      }

      const nameFilter = filters.name || filters.cardName;
      if (nameFilter && target.name !== nameFilter) return false;
      if (filters.cardKind) {
        const requiredKinds = Array.isArray(filters.cardKind)
          ? filters.cardKind
          : [filters.cardKind];
        if (!requiredKinds.includes(target.cardKind)) return false;
      }
      if (filters.subtype) {
        const requiredSubtypes = Array.isArray(filters.subtype)
          ? filters.subtype
          : [filters.subtype];
        if (!requiredSubtypes.includes(target.subtype)) return false;
      }
      if (filters.archetype) {
        const archetypes = Array.isArray(target.archetypes)
          ? target.archetypes
          : target.archetype
            ? [target.archetype]
            : [];
        if (!archetypes.includes(filters.archetype)) return false;
      }
      return true;
    };

    const tryReplacement = async (sourceCard, sourceOwner, effect) => {
      if (!sourceCard || !effect?.replacementEffect) {
        return { replaced: false };
      }

      const replacement = effect.replacementEffect;
      if (replacement.type && replacement.type !== "destruction") {
        return { replaced: false };
      }

      const sourceRequireFaceup = effect.requireFaceup !== false;
      if (sourceRequireFaceup && sourceCard.isFacedown) {
        return { replaced: false };
      }

      const targetOwnerKey =
        replacement.targetOwner ||
        replacement.appliesTo ||
        (sourceCard === card ? "self" : null);
      if (!targetOwnerKey) {
        return { replaced: false };
      }

      if (targetOwnerKey !== "any") {
        const expectedOwner =
          targetOwnerKey === "self"
            ? sourceOwner
            : this.getOpponent(sourceOwner);
        if (expectedOwner !== ownerPlayer) {
          return { replaced: false };
        }
      }

      const targetZones = replacement.targetZones
        ? replacement.targetZones
        : replacement.targetZone
          ? [replacement.targetZone]
          : null;
      if (targetZones && targetZones.length > 0) {
        if (!fromZone || !targetZones.includes(fromZone)) {
          return { replaced: false };
        }
      }

      const allowFacedown = replacement.allowFacedown === true;
      const targetRequireFaceup =
        replacement.targetRequireFaceup !== false && !allowFacedown;
      if (targetRequireFaceup && card.isFacedown) {
        return { replaced: false };
      }

      const targetFilters = replacement.targetFilters || null;
      if (targetFilters && !matchesTargetFilters(card, targetFilters)) {
        return { replaced: false };
      }

      const onceCheck = this.canUseOncePerTurn(sourceCard, sourceOwner, effect);
      if (!onceCheck.ok) {
        return { replaced: false };
      }

      if (
        replacement.reason &&
        replacement.reason !== "any" &&
        replacement.reason !== cause
      ) {
        return { replaced: false };
      }

      const costCount = replacement.costCount ?? 0;
      if (replacement.auto === true || costCount === 0) {
        this.markOncePerTurnUsed(sourceCard, sourceOwner, effect);
        const logMessage = formatReplacementText(
          replacement.logMessage,
          sourceCard.name,
        );
        if (logMessage) {
          this.ui?.log?.(logMessage);
        } else {
          this.ui?.log?.(
            `${card.name} avoided destruction due to ${sourceCard.name}.`,
          );
        }
        return { replaced: true };
      }

      const costOwnerKey = replacement.costOwner || "source";
      const costOwner = costOwnerKey === "target" ? ownerPlayer : sourceOwner;

      if (!costOwner) {
        return { replaced: false };
      }

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

        if (costFilters.name && candidate.name !== costFilters.name)
          return false;

        return true;
      };

      const costZone = replacement.costZone || "field";
      const candidateZone =
        costZone === "fieldSpell"
          ? costOwner.fieldSpell
            ? [costOwner.fieldSpell]
            : []
          : costOwner[costZone] || [];
      const candidates = candidateZone.filter(filterCandidates);

      if (candidates.length < costCount) {
        return { replaced: false };
      }

      // Bot auto-selection (lowest ATK for cost)
      if (costOwner.id !== "player") {
        const chosen = [...candidates]
          .sort((a, b) => (a.atk || 0) - (b.atk || 0))
          .slice(0, costCount);

        for (const costCard of chosen) {
          this.moveCard(costCard, costOwner, "graveyard", {
            fromZone: costZone,
          });
        }

        this.markOncePerTurnUsed(sourceCard, sourceOwner, effect);

        const costNames = chosen.map((c) => c.name).join(", ");
        const logMessage = formatReplacementText(
          replacement.logMessage,
          sourceCard.name,
        );
        if (logMessage) {
          this.ui?.log?.(logMessage);
        } else {
          this.ui?.log?.(
            `${card.name} avoided destruction by sending ${costNames} to the Graveyard.`,
          );
        }
        return { replaced: true };
      }

      const costDescription = getCostTypeDescription(costFilters, costCount);
      const prompt =
        formatReplacementText(replacement.prompt, sourceCard.name) ||
        `Send ${costCount} ${costDescription} to the GY to save ${card.name}?`;

      const wantsToReplace =
        (await this.ui?.showConfirmPrompt?.(prompt, {
          kind: "destruction_replacement",
          cardName: card.name,
        })) ?? false;
      if (!wantsToReplace) {
        return { replaced: false };
      }

      const selectionMessage =
        formatReplacementText(replacement.selectionMessage, sourceCard.name) ||
        `Choose ${costCount} ${
          costCount > 1 ? "cards" : "card"
        } to send to the Graveyard for ${card.name}'s protection.`;

      const selections = await this.askPlayerToSelectCards({
        owner: "player",
        zone: costZone,
        min: costCount,
        max: costCount,
        filter: filterCandidates,
        message: selectionMessage,
      });

      if (!selections || selections.length < costCount) {
        this.ui.log("Protection cancelled.");
        return { replaced: false };
      }

      // Pay cost
      for (const costCard of selections) {
        this.moveCard(costCard, costOwner, "graveyard", { fromZone: costZone });
      }

      this.markOncePerTurnUsed(sourceCard, sourceOwner, effect);

      const costNames = selections.map((c) => c.name).join(", ");
      const logMessage = formatReplacementText(
        replacement.logMessage,
        sourceCard.name,
      );
      if (logMessage) {
        this.ui?.log?.(logMessage);
      } else {
        this.ui.log(
          `${card.name} avoided destruction by sending ${costNames} to the Graveyard.`,
        );
      }
      return { replaced: true };
    };

    const collectSources = (player) => {
      if (!player) return [];
      const field = Array.isArray(player.field) ? player.field : [];
      const spellTrap = Array.isArray(player.spellTrap) ? player.spellTrap : [];
      const fieldSpell = player.fieldSpell ? [player.fieldSpell] : [];
      return [...field, ...spellTrap, ...fieldSpell].filter(Boolean);
    };

    const sourcePool = [
      ...collectSources(ownerPlayer),
      ...collectSources(this.getOpponent(ownerPlayer)),
    ];

    const currentTurn = this.turnCounter;
    if (Array.isArray(this.temporaryReplacementEffects)) {
      this.temporaryReplacementEffects =
        this.temporaryReplacementEffects.filter((entry) => {
          if (!entry) return false;
          if (
            Number.isFinite(entry.expiresOnTurn) &&
            currentTurn > entry.expiresOnTurn
          ) {
            return false;
          }
          if (
            Number.isFinite(entry.usesRemaining) &&
            entry.usesRemaining <= 0
          ) {
            return false;
          }
          return true;
        });

      for (const entry of this.temporaryReplacementEffects) {
        const sourceOwner =
          entry.ownerId === this.player.id ? this.player : this.bot;
        if (!sourceOwner) continue;
        const sourceCard = {
          name: entry.sourceName || "Temporary Effect",
          owner: sourceOwner.id,
          isFacedown: false,
        };
        const effect = {
          replacementEffect: entry.replacementEffect,
          requireFaceup: false,
        };
        const result = await tryReplacement(sourceCard, sourceOwner, effect);
        if (result?.replaced) {
          if (Number.isFinite(entry.usesRemaining)) {
            entry.usesRemaining -= 1;
          }
          if (
            Number.isFinite(entry.usesRemaining) &&
            entry.usesRemaining <= 0
          ) {
            this.temporaryReplacementEffects =
              this.temporaryReplacementEffects.filter((e) => e !== entry);
          }
          return result;
        }
      }
    }

    for (const sourceCard of sourcePool) {
      const sourceOwner =
        sourceCard.owner === "player" ? this.player : this.bot;
      if (!sourceOwner) continue;
      const effects = sourceCard.effects || [];
      for (const effect of effects) {
        if (!effect?.replacementEffect) continue;
        const result = await tryReplacement(sourceCard, sourceOwner, effect);
        if (result?.replaced) {
          return result;
        }
      }
    }

    return { replaced: false };
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

        // ? Check protection effects before destruction
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
              }!`,
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
            fromZone,
          },
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
      },
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

  // ? flipSummon ? Moved to src/core/game/summon/execution.js

  changeMonsterPosition(card, newPosition) {
    if (newPosition !== "attack" && newPosition !== "defense") return;
    if (!this.canChangePosition(card)) return;
    if (!card || card.position === newPosition) return;

    // Track previous position for replay capture
    const previousPosition = card.position;

    // Track reveal for Ascension timing if monster was facedown
    const wasFlipped = card.isFacedown;
    card.position = newPosition;
    card.isFacedown = false;
    if (wasFlipped) {
      card.revealedTurn = this.turnCounter;
    }
    card.positionChangedThisTurn = true;
    card.cannotAttackThisTurn = newPosition === "defense";
    this.ui.log(
      `${card.name} changes to ${
        newPosition === "attack" ? "Attack" : "Defense"
      } Position.`,
    );

    // Emit event for replay capture
    this.emit("position_change", {
      card,
      player: card.owner === "player" ? this.player : this.bot,
      fromPosition: previousPosition,
      toPosition: newPosition,
      wasFlipped,
    });

    this.updateBoard();
  }

  // ? finalizeSpellTrapActivation ? Moved to src/core/game/spellTrap/finalization.js

  async tryActivateMonsterEffect(
    card,
    selections = null,
    activationZone = "field",
    owner = this.player,
    options = {},
  ) {
    if (this.disableEffectActivation) {
      this.ui?.log?.("Effect activations are disabled.");
      return { success: false, reason: "effects_disabled" };
    }
    if (!card) return;
    console.log(
      `[Game] tryActivateMonsterEffect called for: ${card.name} (zone: ${activationZone})`,
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
        atk: card.cardKind === "monster" ? (card.atk ?? null) : null,
        def: card.cardKind === "monster" ? (card.def ?? null) : null,
        level: card.cardKind === "monster" ? (card.level ?? null) : null,
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
        oncePerTurnConfig,
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
    const explicitAutoSelectTargets =
      typeof config.activationContext?.autoSelectTargets === "boolean"
        ? config.activationContext.autoSelectTargets
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
      autoSelectTargets: explicitAutoSelectTargets,
      selections: config.selections || null,
    };

    const safeActivate = async (selections) => {
      try {
        return await config.activate(
          selections,
          activationContext,
          resolvedActivationZone,
          resolvedCard,
          owner,
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
          },
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
            (req) => Number(req.min ?? 0) === 0,
          );
        }
        // Padr�o: evitar field targeting em prompts gen�ricos (target_select),
        // a menos que o contrato pe�a explicitamente.
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
          { lockKey: oncePerTurnInfo.lockKey },
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
    const hasSelectionUi =
      !!this.ui &&
      (typeof this.ui.showTargetSelection === "function" ||
        typeof this.ui.showFieldTargetingControls === "function");
    const finishOnSelection =
      typeof config.finishOnSelection === "boolean"
        ? config.finishOnSelection
        : !hasSelectionUi;

    if (initialResult?.needsSelection === true && finishOnSelection) {
      finishOnce(initialResult);
    } else if (
      !finished &&
      (!initialResult || initialResult.needsSelection !== true)
    ) {
      finishOnce(initialResult);
    }

    return waitForFinish;
  }

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

  getOpponent(player) {
    return player.id === "player" ? this.bot : this.player;
  }

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

  showShadowHeartCathedralModal(validMonsters, maxAtk, counterCount, callback) {
    console.log(
      `[Cathedral Modal] Opening with ${validMonsters.length} valid monsters, Max ATK: ${maxAtk}, Counters: ${counterCount}`,
    );

    if (
      this.ui &&
      typeof this.ui.showShadowHeartCathedralModal === "function"
    ) {
      this.ui.showShadowHeartCathedralModal(
        validMonsters,
        maxAtk,
        counterCount,
        callback,
      );
      return;
    }

    console.log("[Cathedral Modal] Renderer unavailable; skipping modal.");
    callback(null);
  }

  // ? canActivateTrap ? Moved to src/core/game/spellTrap/verification.js

  // ? checkAndOfferTraps ? Moved to src/core/game/spellTrap/triggers.js

  // ? _mapEventToChainContext ? Moved to src/core/game/spellTrap/triggers.js

  // ? activateTrapFromZone ? Moved to src/core/game/spellTrap/triggers.js

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

  // -----------------------------------------------------------------------------
  // DevTools methods moved to core/game/devTools/
  // See: commands.js, sanity.js, setup.js
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

// -----------------------------------------------------------------------------
// Events: Attach methods from modular events/ folder
// -----------------------------------------------------------------------------

// Event Bus: on, emit, notify
Game.prototype.on = eventBus.on;
Game.prototype.emit = eventBus.emit;
Game.prototype.notify = eventBus.notify;

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

// Invariants: assertStateInvariants
Game.prototype.assertStateInvariants = zonesInvariants.assertStateInvariants;

// Operations: getZone, runZoneOp
Game.prototype.getZone = zonesOperations.getZone;
Game.prototype.runZoneOp = zonesOperations.runZoneOp;

// Movement: cleanupTokenReferences, moveCard, moveCardInternal
Game.prototype.cleanupTokenReferences = zonesMovement.cleanupTokenReferences;
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

// -----------------------------------------------------------------------------
// Turn: Attach methods from modular turn/ folder
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Spell/Trap: Attach methods from modular spellTrap/ folder
// -----------------------------------------------------------------------------

// Set: setSpellOrTrap
Game.prototype.setSpellOrTrap = spellTrapSet.setSpellOrTrap;

// Activation: tryActivateSpellTrapEffect, tryActivateSpell, activateFieldSpellEffect
Game.prototype.tryActivateSpellTrapEffect =
  spellTrapActivation.tryActivateSpellTrapEffect;
Game.prototype.tryActivateSpell = spellTrapActivation.tryActivateSpell;
Game.prototype.activateFieldSpellEffect =
  spellTrapActivation.activateFieldSpellEffect;

// Finalization: finalizeSpellTrapActivation, commitCardActivationFromHand, rollbackSpellActivation
Game.prototype.finalizeSpellTrapActivation =
  spellTrapFinalization.finalizeSpellTrapActivation;
Game.prototype.commitCardActivationFromHand =
  spellTrapFinalization.commitCardActivationFromHand;
Game.prototype.rollbackSpellActivation =
  spellTrapFinalization.rollbackSpellActivation;

// Verification: canActivateTrap, canActivatePolymerization
Game.prototype.canActivateTrap = spellTrapVerification.canActivateTrap;
Game.prototype.canActivatePolymerization =
  spellTrapVerification.canActivatePolymerization;

// Triggers: checkAndOfferTraps, _mapEventToChainContext, activateTrapFromZone
Game.prototype.checkAndOfferTraps = spellTrapTriggers.checkAndOfferTraps;
Game.prototype._mapEventToChainContext =
  spellTrapTriggers._mapEventToChainContext;
Game.prototype.activateTrapFromZone = spellTrapTriggers.activateTrapFromZone;

// -----------------------------------------------------------------------------
// UI: Attach methods from modular ui/ folder
// -----------------------------------------------------------------------------

// Board: updateBoard, highlightReadySpecialSummon
Game.prototype.updateBoard = uiBoard.updateBoard;
Game.prototype.highlightReadySpecialSummon =
  uiBoard.highlightReadySpecialSummon;

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
