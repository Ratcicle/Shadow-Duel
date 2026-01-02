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
      bot: {
        destroyedOpponentMonstersByMaterialId: new Map(),
        effectActivationsByMaterialId: new Map(),
      },
    };
    this.devLog("MATERIAL_STATS_RESET", { summary: reason });
  }

  _trackSpecialSummonType(payload) {
    try {
      const { card, player, method } = payload || {};
      if (!card || !player || method !== "special") return;
      const typeName = card.type || null;
      if (!typeName) return;
      const playerId = player?.id || player;
      const store = this.specialSummonTypeCounts?.[playerId];
      if (!store || !(store instanceof Map)) return;
      const next = (store.get(typeName) || 0) + 1;
      store.set(typeName, next);
      this.devLog?.("SS_TYPE_TRACK", {
        summary: `${playerId} special-summoned ${typeName} (${next})`,
        player: playerId,
        type: typeName,
        count: next,
      });
    } catch (err) {
      console.error("Failed to track special summon type:", err);
    }
  }

  getSpecialSummonedTypeCount(owner, typeName) {
    const playerId = owner?.id || owner;
    const store = this.specialSummonTypeCounts?.[playerId];
    if (!store || !(store instanceof Map)) return 0;
    return store.get(typeName) || 0;
  }

  /**
   * ✅ FASE 2: Adicionar ação agendada (delayed action)
   * Suporta qualquer tipo de ação futura: summons, damage, draw, etc.
   * @param {string} actionType - Tipo de ação (ex: "delayed_summon")
   * @param {Object} triggerCondition - Condição de trigger (ex: {phase: "standby", player: "opponent"})
   * @param {Object} payload - Dados da ação
   * @param {number} priority - Prioridade de execução (padrão: 0)
   * @returns {number} ID da ação agendada
   */
  scheduleDelayedAction(actionType, triggerCondition, payload, priority = 0) {
    if (!actionType || !triggerCondition || !payload) {
      console.error("Invalid delayed action parameters");
      return null;
    }

    const action = {
      id: Math.random().toString(36).substr(2, 9),
      actionType,
      triggerCondition,
      payload,
      scheduledTurn: this.turnCounter,
      priority,
    };

    this.delayedActions.push(action);
    this.devLog?.("DELAYED_ACTION_SCHEDULED", {
      summary: `${actionType} scheduled for ${triggerCondition.phase} (${triggerCondition.player})`,
      actionType,
      trigger: triggerCondition,
      turn: this.turnCounter,
    });

    return action.id;
  }

  /**
   * ✅ FASE 2: Processar delayed actions que devem ser resolvidas agora
   * Filtra ações pelo trigger atual e executa resolvers apropriados
   * @param {string} phase - Fase atual (ex: "standby")
   * @param {string} activePlayer - Player ativo ("player" ou "bot")
   */
  processDelayedActions(phase, activePlayer) {
    if (
      !Array.isArray(this.delayedActions) ||
      this.delayedActions.length === 0
    ) {
      return;
    }

    // Filtrar ações que devem ser resolvidas nesta fase/player
    const actionsToResolve = this.delayedActions.filter((action) => {
      const trigger = action.triggerCondition;
      if (!trigger) return false;

      // Verificar se a fase corresponde
      if (trigger.phase && trigger.phase !== phase) return false;

      // Verificar se o player corresponde
      if (trigger.player) {
        const triggerPlayer =
          trigger.player === "opponent"
            ? activePlayer === "player"
              ? "bot"
              : "player"
            : trigger.player;
        if (triggerPlayer !== activePlayer) return false;
      }

      return true;
    });

    // Ordenar por prioridade e executar
    actionsToResolve.sort((a, b) => b.priority - a.priority);

    for (const action of actionsToResolve) {
      this.resolveDelayedAction(action);
    }

    // Remover ações resolvidas
    this.delayedActions = this.delayedActions.filter(
      (action) => !actionsToResolve.includes(action)
    );
  }

  /**
   * ✅ FASE 2: Resolver uma ação agendada individual
   * Chama o resolver apropriado baseado no tipo de ação
   * @param {Object} action - Ação a resolver
   */
  resolveDelayedAction(action) {
    try {
      switch (action.actionType) {
        case "delayed_summon":
          this.resolveDelayedSummon(action.payload);
          break;
        // Futuros tipos de ações podem ser adicionados aqui
        default:
          console.warn(`Unknown delayed action type: ${action.actionType}`);
      }
    } catch (err) {
      console.error("Error resolving delayed action:", err);
    }
  }

  /**
   * ✅ FASE 5: Resolver delayed summon específico
   * Executa Special Summons agendadas com verificações de validade
   * @param {Object} payload - Dados do delayed summon
   */
  resolveDelayedSummon(payload) {
    if (
      !payload ||
      !Array.isArray(payload.summons) ||
      payload.summons.length === 0
    ) {
      console.warn("Invalid delayed summon payload");
      return;
    }

    const { summons, owners } = payload;
    let successCount = 0;

    for (const summonData of summons) {
      const card = summonData.card;
      const targetOwner = summonData.owner;
      const targetPlayer = targetOwner === "player" ? this.player : this.bot;

      if (!card) {
        this.ui?.log?.(`Card reference missing in delayed summon.`);
        continue;
      }

      // Verificar se carta ainda está na zona de origem esperada
      const originZone = summonData.fromZone || "graveyard";
      const zoneList = targetPlayer[originZone];
      if (!Array.isArray(zoneList) || !zoneList.includes(card)) {
        this.ui?.log?.(
          `${card.name} is no longer in ${originZone}, cannot special summon.`
        );
        continue;
      }

      // Verificar se há espaço no campo
      if (targetPlayer.field.length >= 5) {
        this.ui?.log?.(`Field is full, cannot special summon ${card.name}.`);
        continue;
      }

      // Executar special summon
      void this.moveCard(card, targetPlayer, "field", {
        summonMethodOverride: "special",
      });
      successCount++;

      // Aplicar buff condicional: Abyssal Serpent ganha +800 ATK se alvo era Fusion/Ascension
      if (
        summonData.getsBuffIfTargetWasFusionOrAscension &&
        card.cardKind === "monster"
      ) {
        const expiresOnTurn = this.turnCounter + 1;
        this.applyTurnBasedBuff(card, "atk", 800, expiresOnTurn);
        this.ui?.log?.(
          `${card.name} gains +800 ATK until the end of turn ${expiresOnTurn}.`
        );
      }
    }

    if (successCount > 0) {
      this.updateBoard();
      this.ui?.log?.(
        `${successCount} card(s) special summoned from delayed action.`
      );
    }
  }

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

  /**
   * ✅ FASE 4: Limpar buffs temporários expirados
   * Chamado no início de startTurn() para remover buffs cujo turno de expiração foi atingido
   */
  cleanupExpiredBuffs() {
    const allMonsters = [
      ...(this.player?.field || []),
      ...(this.bot?.field || []),
    ].filter(Boolean);

    for (const card of allMonsters) {
      if (
        !Array.isArray(card.turnBasedBuffs) ||
        card.turnBasedBuffs.length === 0
      ) {
        continue;
      }

      const expiredBuffs = card.turnBasedBuffs.filter(
        (buff) => this.turnCounter > buff.expiresOnTurn
      );

      for (const buff of expiredBuffs) {
        // Remover valor do stat
        if (buff.stat === "atk") {
          card.atk = Math.max(0, card.atk - buff.value);
        } else if (buff.stat === "def") {
          card.def = Math.max(0, card.def - buff.value);
        }

        this.devLog?.("TURN_BASED_BUFF_EXPIRED", {
          summary: `${card.name} buff expired (${buff.id})`,
          card: card.name,
          buffId: buff.id,
          stat: buff.stat,
        });
      }

      // Remover buffs expirados da lista
      card.turnBasedBuffs = card.turnBasedBuffs.filter(
        (buff) => this.turnCounter <= buff.expiresOnTurn
      );
    }
  }

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

  normalizeRelativePlayerId(value, ctx, meta = {}) {
    if (value !== "self" && value !== "opponent") return value;
    const selfId = ctx?.player?.id ?? meta.selfId ?? null;
    const opponentId = ctx?.opponent?.id ?? meta.opponentId ?? null;
    const mapped = value === "self" ? selfId : opponentId;
    if (this.devModeEnabled) {
      const cardName = meta.card?.name || meta.cardName || "unknown";
      const actionName = meta.action?.id || meta.action?.type || meta.action;
      const summary = `Normalized ${meta.field || "id"} ${value} -> ${
        mapped || "unknown"
      } for ${cardName}`;
      this.devLog("RELATIVE_OWNER_NORMALIZED", {
        summary,
        field: meta.field,
        raw: value,
        mapped,
        card: cardName,
        action: actionName,
        context: meta.contextLabel,
      });
      console.warn("[DEV] RELATIVE_OWNER_NORMALIZED", {
        field: meta.field,
        raw: value,
        mapped,
        card: cardName,
        action: actionName,
        context: meta.contextLabel,
        stack: new Error().stack,
      });
    }
    return mapped ?? value;
  }

  normalizeCardOwnership(card, ctx, meta = {}) {
    if (!card) return;
    const owner = this.normalizeRelativePlayerId(card.owner, ctx, {
      ...meta,
      field: "owner",
      card,
    });
    if (owner && card.owner !== owner) {
      card.owner = owner;
    }
    const controller = this.normalizeRelativePlayerId(card.controller, ctx, {
      ...meta,
      field: "controller",
      card,
    });
    if (controller && card.controller !== controller) {
      card.controller = controller;
    }

    if (meta.enforceZoneOwner && meta.zoneOwnerId) {
      const zoneOwnerId = meta.zoneOwnerId;
      if (card.owner !== zoneOwnerId) {
        if (this.devModeEnabled) {
          this.devLog("ZONE_OWNER_CORRECTED", {
            summary: `Owner corrected to ${zoneOwnerId} for ${card.name}`,
            card: card.name,
            from: card.owner,
            to: zoneOwnerId,
            zone: meta.zone,
            context: meta.contextLabel,
          });
        }
        card.owner = zoneOwnerId;
      }
      if (card.controller !== zoneOwnerId) {
        if (this.devModeEnabled) {
          this.devLog("ZONE_CONTROLLER_CORRECTED", {
            summary: `Controller corrected to ${zoneOwnerId} for ${card.name}`,
            card: card.name,
            from: card.controller,
            to: zoneOwnerId,
            zone: meta.zone,
            context: meta.contextLabel,
          });
        }
        card.controller = zoneOwnerId;
      }
    }
  }

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

  forceClearTargetSelection(reason = "invariant_cleanup") {
    if (!this.targetSelection) return;
    this.devLog("SELECTION_FORCE_CLEAR", {
      summary: `Selection cleared (${reason})`,
    });
    this.clearTargetHighlights();
    this.setSelectionDimming(false);
    if (this.ui && typeof this.ui.hideFieldTargetingControls === "function") {
      this.ui.hideFieldTargetingControls();
    }
    if (this.targetSelection?.closeModal) {
      this.targetSelection.closeModal();
    }
    this.targetSelection = null;
    this.setSelectionState("idle");
  }

  snapshotCardState(card) {
    if (!card) return null;
    const snapshot = { ...card };
    if (card.counters instanceof Map) {
      snapshot.counters = new Map(card.counters);
    }
    if (Array.isArray(card.equips)) {
      snapshot.equips = [...card.equips];
    }
    return snapshot;
  }

  collectAllZoneCards() {
    const cards = new Set();
    const addList = (list) => {
      if (!Array.isArray(list)) return;
      list.forEach((card) => {
        if (card) cards.add(card);
      });
    };
    const addPlayer = (player) => {
      if (!player) return;
      addList(player.hand);
      addList(player.field);
      addList(player.spellTrap);
      addList(player.graveyard);
      addList(player.deck);
      addList(player.extraDeck);
      if (player.fieldSpell) {
        cards.add(player.fieldSpell);
      }
    };
    addPlayer(this.player);
    addPlayer(this.bot);
    return [...cards];
  }

  captureZoneSnapshot(contextLabel = "zone_op") {
    const snapshot = {
      contextLabel,
      players: {
        player: {
          hand: [...(this.player?.hand || [])],
          field: [...(this.player?.field || [])],
          spellTrap: [...(this.player?.spellTrap || [])],
          graveyard: [...(this.player?.graveyard || [])],
          deck: [...(this.player?.deck || [])],
          extraDeck: [...(this.player?.extraDeck || [])],
          fieldSpell: this.player?.fieldSpell || null,
        },
        bot: {
          hand: [...(this.bot?.hand || [])],
          field: [...(this.bot?.field || [])],
          spellTrap: [...(this.bot?.spellTrap || [])],
          graveyard: [...(this.bot?.graveyard || [])],
          deck: [...(this.bot?.deck || [])],
          extraDeck: [...(this.bot?.extraDeck || [])],
          fieldSpell: this.bot?.fieldSpell || null,
        },
      },
      cardState: new Map(),
    };

    const cards = this.collectAllZoneCards();
    cards.forEach((card) => {
      const state = this.snapshotCardState(card);
      if (state) {
        snapshot.cardState.set(card, state);
      }
    });

    return snapshot;
  }

  restoreZoneSnapshot(snapshot) {
    if (!snapshot) return;
    const restorePlayer = (player, state) => {
      if (!player || !state) return;
      player.hand = [...(state.hand || [])];
      player.field = [...(state.field || [])];
      player.spellTrap = [...(state.spellTrap || [])];
      player.graveyard = [...(state.graveyard || [])];
      player.deck = [...(state.deck || [])];
      player.extraDeck = [...(state.extraDeck || [])];
      player.fieldSpell = state.fieldSpell || null;
    };

    restorePlayer(this.player, snapshot.players?.player);
    restorePlayer(this.bot, snapshot.players?.bot);

    if (snapshot.cardState) {
      snapshot.cardState.forEach((state, card) => {
        if (!card || !state) return;
        Object.keys(state).forEach((key) => {
          if (key === "counters" && state.counters instanceof Map) {
            card.counters = new Map(state.counters);
            return;
          }
          if (key === "equips" && Array.isArray(state.equips)) {
            card.equips = [...state.equips];
            return;
          }
          card[key] = state[key];
        });
      });
    }

    this.normalizeZoneCardOwnership("restoreZoneSnapshot", {
      enforceZoneOwner: true,
    });
  }

  normalizeZoneCardOwnership(contextLabel = "zone_state", options = {}) {
    const seen = new Set();
    const enforceZoneOwner = options.enforceZoneOwner === true;
    const addList = (player, opponent, zoneName, list) => {
      if (!Array.isArray(list)) return;
      list.forEach((card) => {
        if (!card || seen.has(card)) return;
        seen.add(card);
        this.normalizeCardOwnership(
          card,
          { player, opponent },
          {
            contextLabel,
            zone: zoneName,
            zoneOwnerId: player?.id,
            enforceZoneOwner,
          }
        );
      });
    };
    const applyForPlayer = (player) => {
      if (!player) return;
      const opponent = this.getOpponent(player);
      addList(player, opponent, "hand", player.hand);
      addList(player, opponent, "field", player.field);
      addList(player, opponent, "spellTrap", player.spellTrap);
      addList(player, opponent, "graveyard", player.graveyard);
      addList(player, opponent, "deck", player.deck);
      addList(player, opponent, "extraDeck", player.extraDeck);
      if (player.fieldSpell) {
        addList(player, opponent, "fieldSpell", [player.fieldSpell]);
      }
    };
    applyForPlayer(this.player);
    applyForPlayer(this.bot);
  }

  compareZoneSnapshot(a, b, playerKey = "player") {
    const stateA = a?.players?.[playerKey] || {};
    const stateB = b?.players?.[playerKey] || {};
    const listEqual = (left, right) => {
      if (!Array.isArray(left) || !Array.isArray(right)) return false;
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i += 1) {
        if (left[i] !== right[i]) return false;
      }
      return true;
    };
    return (
      listEqual(stateA.hand || [], stateB.hand || []) &&
      listEqual(stateA.field || [], stateB.field || []) &&
      listEqual(stateA.spellTrap || [], stateB.spellTrap || []) &&
      listEqual(stateA.graveyard || [], stateB.graveyard || []) &&
      listEqual(stateA.deck || [], stateB.deck || []) &&
      listEqual(stateA.extraDeck || [], stateB.extraDeck || []) &&
      (stateA.fieldSpell || null) === (stateB.fieldSpell || null)
    );
  }

  assertStateInvariants(contextLabel = "state_check", options = {}) {
    const failFast =
      options.failFast !== undefined ? options.failFast : this.devModeEnabled;
    const normalize = options.normalize !== false;
    const issues = [];

    if (normalize) {
      this.normalizeZoneCardOwnership(contextLabel, {
        enforceZoneOwner: true,
      });
    }
    const addIssue = (message, detail) => {
      issues.push({ message, detail });
    };
    const normalizeZone = (player, zoneName, list) => {
      if (!Array.isArray(list)) return;
      const hasHoles = list.some((item) => !item);
      if (hasHoles) {
        addIssue("zone_has_empty_slots", {
          player: player?.id,
          zone: zoneName,
        });
        if (normalize) {
          const filtered = list.filter((item) => item);
          if (player && Array.isArray(player[zoneName])) {
            player[zoneName] = filtered;
          }
        }
      }
    };

    const checkZoneLimit = (player, zoneName, max) => {
      const list = player?.[zoneName];
      if (Array.isArray(list) && list.length > max) {
        addIssue("zone_limit_exceeded", {
          player: player?.id,
          zone: zoneName,
          length: list.length,
          max,
        });
      }
    };

    const collectZones = (player) => [
      { name: "hand", list: player?.hand || [] },
      { name: "field", list: player?.field || [] },
      { name: "spellTrap", list: player?.spellTrap || [] },
      { name: "graveyard", list: player?.graveyard || [] },
      { name: "deck", list: player?.deck || [] },
      { name: "extraDeck", list: player?.extraDeck || [] },
    ];

    [this.player, this.bot].forEach((player) => {
      if (!player) return;
      checkZoneLimit(player, "field", 5);
      checkZoneLimit(player, "spellTrap", 5);
      collectZones(player).forEach(({ name, list }) =>
        normalizeZone(player, name, list)
      );
    });

    const locationMap = new Map();
    const registerCard = (card, playerId, zoneName) => {
      if (!card) return;
      if (!locationMap.has(card)) {
        locationMap.set(card, []);
      }
      locationMap.get(card).push({ playerId, zoneName });
    };

    [this.player, this.bot].forEach((player) => {
      if (!player) return;
      collectZones(player).forEach(({ name, list }) => {
        list.forEach((card) => registerCard(card, player.id, name));
      });
      if (player.fieldSpell) {
        registerCard(player.fieldSpell, player.id, "fieldSpell");
      }
    });

    locationMap.forEach((locations, card) => {
      if (locations.length > 1) {
        addIssue("card_in_multiple_zones", {
          card: card?.name,
          locations,
        });
      }
      locations.forEach((entry) => {
        if (card?.owner && card.owner !== entry.playerId) {
          addIssue("owner_mismatch", {
            card: card?.name,
            owner: card.owner,
            zoneOwner: entry.playerId,
            zone: entry.zoneName,
          });
        }
        if (card?.controller && card.controller !== entry.playerId) {
          addIssue("controller_mismatch", {
            card: card?.name,
            controller: card.controller,
            zoneOwner: entry.playerId,
            zone: entry.zoneName,
          });
        }
      });
    });

    [this.player, this.bot].forEach((player) => {
      if (!player?.fieldSpell) return;
      const fieldSpell = player.fieldSpell;
      const locs = locationMap.get(fieldSpell) || [];
      if (locs.length > 1) {
        addIssue("field_spell_in_multiple_zones", {
          card: fieldSpell.name,
          locations: locs,
        });
      }
    });

    const selectionState = this.selectionState || "idle";
    if (this.targetSelection && selectionState === "idle") {
      addIssue("selection_stale", { state: selectionState });
      this.forceClearTargetSelection("stale_selection");
    } else if (!this.targetSelection) {
      if (selectionState === "selecting" || selectionState === "confirming") {
        addIssue("selection_state_mismatch", { state: selectionState });
        this.setSelectionState("idle");
      } else if (selectionState === "resolving") {
        const resolvingContext =
          this.isResolvingEffect || this.eventResolutionDepth > 0;
        if (!resolvingContext) {
          this.setSelectionState("idle");
        }
      }
    }

    const nonCriticalIssues = new Set([
      "selection_stale",
      "selection_state_mismatch",
      "resolving_state_stale",
    ]);
    const hasCritical = issues.some(
      (issue) => !nonCriticalIssues.has(issue.message)
    );
    const criticalIssues = issues.filter(
      (issue) => !nonCriticalIssues.has(issue.message)
    );

    if (issues.length) {
      const summary = `[Game] State invariants failed (${contextLabel})`;
      const log = hasCritical ? console.error : console.warn;
      log(summary, issues);
      if (failFast && hasCritical) {
        throw new Error(`${summary} issues=${issues.length}`);
      }
    }

    return { ok: issues.length === 0, issues, hasCritical, criticalIssues };
  }

  runZoneOp(opLabel, fn, options = {}) {
    const contextLabel = options.contextLabel || opLabel;
    const root = this.zoneOpDepth === 0;
    if (root) {
      this.zoneOpSnapshot = this.captureZoneSnapshot(contextLabel);
    }
    this.zoneOpDepth += 1;
    this.devLog("ZONE_OP_START", {
      summary: opLabel,
      opLabel,
      contextLabel,
      card: options.card?.name,
      fromZone: options.fromZone,
      toZone: options.toZone,
      depth: this.zoneOpDepth,
    });

    const rollback = (error) => {
      if (root && this.zoneOpSnapshot) {
        this.restoreZoneSnapshot(this.zoneOpSnapshot);
      }
      if (root) {
        this.forceClearTargetSelection("zone_op_rollback");
        this.updateBoard();
        this.assertStateInvariants(`${contextLabel}_rollback`, {
          failFast: false,
        });
      }
      this.devLog("ZONE_OP_ROLLBACK", {
        summary: opLabel,
        opLabel,
        contextLabel,
        card: options.card?.name,
        fromZone: options.fromZone,
        toZone: options.toZone,
        reason: error?.message || "unknown",
      });
    };

    const finalizeFailure = (error) => {
      this.zoneOpDepth = Math.max(0, this.zoneOpDepth - 1);
      rollback(error);
      if (root && this.zoneOpSnapshot) {
        this.zoneOpSnapshot = null;
      }
      if (!root) {
        throw error;
      }
      return {
        success: false,
        reason: error?.message || "zone_op_error",
        rolledBack: true,
      };
    };

    const finalizeSuccess = (result) => {
      try {
        this.normalizeZoneCardOwnership(contextLabel, {
          enforceZoneOwner: true,
        });
        const invariantResult = this.assertStateInvariants(contextLabel, {
          failFast: false,
        });
        if (invariantResult?.hasCritical) {
          throw new Error("STATE_INVARIANTS_FAILED");
        }
      } catch (err) {
        return finalizeFailure(err);
      }
      this.zoneOpDepth = Math.max(0, this.zoneOpDepth - 1);
      if (root) {
        this.devLog("ZONE_OP_COMMIT", {
          summary: opLabel,
          opLabel,
          contextLabel,
          card: options.card?.name,
          fromZone: options.fromZone,
          toZone: options.toZone,
        });
        this.zoneOpSnapshot = null;
      }
      return result;
    };

    try {
      const result = fn();
      if (result && typeof result.then === "function") {
        return result.then(finalizeSuccess).catch(finalizeFailure);
      }
      return finalizeSuccess(result);
    } catch (error) {
      return finalizeFailure(error);
    }
  }

  on(eventName, handler) {
    if (!this.eventListeners[eventName]) {
      this.eventListeners[eventName] = [];
    }
    this.eventListeners[eventName].push(handler);
  }

  async emit(eventName, payload) {
    const list = this.eventListeners[eventName];
    if (list) {
      for (const fn of list) {
        try {
          fn(payload);
        } catch (err) {
          console.error("Error in event handler for " + eventName + ":", err);
        }
      }
    }
    return await this.resolveEvent(eventName, payload);
  }

  async resolveEvent(eventName, payload) {
    if (!eventName) {
      return { ok: false, reason: "missing_event" };
    }

    this.eventResolutionDepth += 1;
    this.eventResolutionCounter += 1;
    const eventCounter = this.eventResolutionCounter;
    const eventId = `${eventName}:${eventCounter}`;
    const depth = this.eventResolutionDepth;

    this.devLog("EVENT_START", {
      summary: `${eventName} (#${eventCounter})`,
      event: eventName,
      depth,
      id: eventId,
    });

    let triggerPackage = null;
    try {
      if (
        this.effectEngine &&
        typeof this.effectEngine.collectEventTriggers === "function"
      ) {
        triggerPackage = await this.effectEngine.collectEventTriggers(
          eventName,
          payload
        );
      }
    } catch (err) {
      console.error(
        `[Game] Failed to collect triggers for "${eventName}":`,
        err
      );
    }

    let entries = [];
    let orderRule = null;
    let onComplete = null;
    if (Array.isArray(triggerPackage)) {
      entries = triggerPackage;
    } else if (triggerPackage && typeof triggerPackage === "object") {
      entries = Array.isArray(triggerPackage.entries)
        ? triggerPackage.entries
        : [];
      orderRule =
        typeof triggerPackage.orderRule === "string"
          ? triggerPackage.orderRule
          : null;
      onComplete =
        typeof triggerPackage.onComplete === "function"
          ? triggerPackage.onComplete
          : null;
    }

    const order = entries
      .map((entry) => entry?.summary)
      .filter((value) => typeof value === "string" && value.trim().length > 0);

    this.devLog("TRIGGERS_COLLECTED", {
      summary: `${eventName} (${entries.length})`,
      event: eventName,
      count: entries.length,
      order,
      orderRule,
      depth,
    });

    let resolutionResult = null;
    try {
      resolutionResult = await this.resolveEventEntries(
        eventName,
        payload,
        entries,
        {
          onComplete,
          orderRule,
        }
      );
    } catch (err) {
      console.error(`[Game] Error resolving event "${eventName}":`, err);
    } finally {
      this.eventResolutionDepth = Math.max(0, this.eventResolutionDepth - 1);

      if (this.devModeEnabled) {
        const cleanupState = this.devGetSelectionCleanupState();
        if (
          cleanupState.selectionActive ||
          cleanupState.controlsVisible ||
          cleanupState.highlightCount > 0
        ) {
          this.devLog("EVENT_CLEANUP_FORCED", {
            summary: `${eventName} cleanup`,
            cleanupState,
          });
          this.devForceTargetCleanup();
        }
      }

      this.assertStateInvariants(`event_${eventName}`, { failFast: false });

      this.devLog("EVENT_END", {
        summary: `${eventName} (#${eventCounter})`,
        event: eventName,
        depth: this.eventResolutionDepth,
        id: eventId,
      });
    }

    return (
      resolutionResult || {
        ok: true,
        triggerCount: entries.length,
        results: [],
      }
    );
  }

  async resolveEventEntries(
    eventName,
    payload,
    entries,
    {
      onComplete = null,
      orderRule = null,
      startIndex = 0,
      results = [],
      selections = null,
    } = {}
  ) {
    const resolvedResults = Array.isArray(results) ? results : [];
    const start = Math.max(0, startIndex);

    for (let i = start; i < entries.length; i += 1) {
      const entry = entries[i];
      const config = entry?.config || entry?.pipeline || entry;
      if (!config || typeof config.activate !== "function") {
        continue;
      }
      const result = await this.runActivationPipelineWait({
        ...config,
        selections: i === start ? selections : null,
      });
      resolvedResults.push({
        id: entry?.summary || entry?.effect?.id || entry?.card?.name || null,
        success: result?.success === true,
        needsSelection: result?.needsSelection === true,
        selectionContract: result?.selectionContract || null,
      });
      if (result?.needsSelection && result?.selectionContract) {
        this.pendingEventSelection = {
          eventName,
          payload,
          entries,
          entryIndex: i,
          results: resolvedResults,
          orderRule,
          onComplete,
        };
        return {
          ok: true,
          triggerCount: entries.length,
          results: resolvedResults,
          needsSelection: true,
          selectionContract: result.selectionContract,
        };
      }
    }

    this.devLog("TRIGGERS_DONE", {
      summary: `${eventName} (${entries.length})`,
      event: eventName,
      count: entries.length,
      depth: this.eventResolutionDepth,
    });

    if (typeof onComplete === "function") {
      try {
        onComplete();
      } catch (err) {
        console.error(
          `[Game] Error running onComplete for "${eventName}":`,
          err
        );
      }
    }

    if (eventName === "after_summon" && payload?.player) {
      const isOpponentSummon = payload.player.id !== "player";
      await this.checkAndOfferTraps(eventName, {
        ...payload,
        isOpponentSummon,
      });
    } else if (eventName === "attack_declared") {
      const defenderOwner = payload?.defenderOwner || null;
      if (defenderOwner === this.player) {
        // Determine if opponent is attacking by checking if attacker owner differs from defender (player)
        const attackerOwnerId = payload?.attackerOwner?.id;
        await this.checkAndOfferTraps(eventName, {
          ...payload,
          isOpponentAttack:
            attackerOwnerId && attackerOwnerId !== this.player.id,
        });
      }
    }

    return {
      ok: true,
      triggerCount: entries.length,
      results: resolvedResults,
    };
  }

  async resumePendingEventSelection(selections, { actionContext } = {}) {
    const pending = this.pendingEventSelection;
    console.log("[Game] resumePendingEventSelection called", {
      hasPending: !!pending,
      selectionsKeys: selections ? Object.keys(selections) : null,
      entryCount: pending?.entries?.length || 0,
      eventName: pending?.eventName,
    });
    if (!pending) {
      return { ok: false, reason: "No pending event selection." };
    }

    this.pendingEventSelection = null;
    this.eventResolutionDepth += 1;
    this.eventResolutionCounter += 1;
    const eventCounter = this.eventResolutionCounter;
    const eventId = `${pending.eventName}:${eventCounter}`;

    this.devLog("EVENT_RESUME_START", {
      summary: `${pending.eventName} (resume #${eventCounter})`,
      event: pending.eventName,
      depth: this.eventResolutionDepth,
      id: eventId,
    });

    let resolutionResult = null;
    try {
      const payload = {
        ...(pending.payload || {}),
        actionContext: actionContext || pending.payload?.actionContext || null,
      };
      resolutionResult = await this.resolveEventEntries(
        pending.eventName,
        payload,
        pending.entries || [],
        {
          onComplete: pending.onComplete || null,
          orderRule: pending.orderRule || null,
          startIndex: pending.entryIndex || 0,
          results: pending.results || [],
          selections,
        }
      );
    } catch (err) {
      console.error(`[Game] Error resuming event "${pending.eventName}":`, err);
    } finally {
      this.eventResolutionDepth = Math.max(0, this.eventResolutionDepth - 1);
      this.devLog("EVENT_RESUME_END", {
        summary: `${pending.eventName} (resume #${eventCounter})`,
        event: pending.eventName,
        depth: this.eventResolutionDepth,
        id: eventId,
      });
    }

    // After resolving the event, check if there's a pending tie destruction to continue
    if (
      this.pendingTieDestruction &&
      resolutionResult?.ok &&
      !resolutionResult?.needsSelection
    ) {
      const tieInfo = this.pendingTieDestruction;
      this.pendingTieDestruction = null;
      console.log(
        "[Game] Resuming pending tie destruction for target:",
        tieInfo.target?.name
      );

      // Continue the combat by destroying the target
      const tieResult = await this.finishCombat(
        tieInfo.attacker,
        tieInfo.target,
        {
          resumeFromTie: true,
        }
      );

      // If this also needs selection, return that
      if (tieResult?.needsSelection) {
        return tieResult;
      }
    }

    return (
      resolutionResult || {
        ok: true,
        triggerCount: pending.entries?.length || 0,
        results: pending.results || [],
      }
    );
  }

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

  drawCards(player, count = 1, options = {}) {
    if (!player) {
      return { ok: false, reason: "invalid_player", drawn: [] };
    }

    const drawCount = Math.max(0, Number(count) || 0);
    if (drawCount === 0) {
      return { ok: true, drawn: [] };
    }

    const drawn = [];
    for (let i = 0; i < drawCount; i += 1) {
      const card = player.draw();
      if (!card) {
        if (!options.silent && this.ui?.log) {
          this.ui.log(options.message || "Deck is empty.");
        }
        this.devLog("DRAW_FAIL", {
          summary: `${player.id} deck empty`,
          player: player.id,
          requested: drawCount,
          drawn: drawn.length,
        });
        return { ok: false, reason: "deck_empty", drawn };
      }
      drawn.push(card);
    }

    return { ok: true, drawn };
  }

  forceOpeningHand(cardName, count) {
    if (!cardName || count <= 0) return;
    const data = cardDatabaseByName.get(cardName);
    if (!data || !this.player || !Array.isArray(this.player.deck)) return;

    const ensured = [];
    for (let i = 0; i < count; i++) {
      const idx = this.player.deck.findIndex((card) => card?.name === cardName);
      if (idx !== -1) {
        ensured.push(this.player.deck.splice(idx, 1)[0]);
      } else {
        ensured.push(new Card(data, this.player.id));
      }
    }

    ensured.forEach((card) => this.player.deck.push(card));
  }

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

  updateAttackIndicators() {
    this.clearAttackReadyIndicators();

    const selectionState = this.selectionState || "idle";
    const hasActiveSelection = selectionState !== "idle";
    if (
      this.turn !== "player" ||
      this.phase !== "battle" ||
      hasActiveSelection ||
      this.isResolvingEffect ||
      this.eventResolutionDepth > 0
    ) {
      return;
    }

    const field = this.player.field || [];
    const readyIndices = [];
    field.forEach((card, index) => {
      if (!card || card.cardKind !== "monster") return;
      const availability = this.getAttackAvailability(card);
      if (!availability.ok) return;
      if (card.isFacedown) return;
      readyIndices.push(index);
    });
    if (this.ui && typeof this.ui.applyAttackReadyIndicators === "function") {
      this.ui.applyAttackReadyIndicators("player", readyIndices);
    }
  }

  clearAttackReadyIndicators() {
    if (this.ui && typeof this.ui.clearAttackReadyIndicators === "function") {
      this.ui.clearAttackReadyIndicators();
    }
  }

  applyAttackResolutionIndicators(attacker, target) {
    const attackerOwner = attacker?.owner === "player" ? "player" : "bot";
    const attackerField =
      attackerOwner === "player" ? this.player.field : this.bot.field;
    const attackerIndex = attackerField.indexOf(attacker);
    const targetOwner = target?.owner === "player" ? "player" : "bot";
    const targetField =
      targetOwner === "player" ? this.player.field : this.bot.field;
    const targetIndex = target ? targetField.indexOf(target) : -1;

    if (
      this.ui &&
      typeof this.ui.applyAttackResolutionIndicators === "function"
    ) {
      this.ui.applyAttackResolutionIndicators({
        attackerOwner,
        attackerIndex,
        targetOwner,
        targetIndex,
        directAttack: !target,
      });
    }
  }

  clearAttackResolutionIndicators() {
    if (
      this.ui &&
      typeof this.ui.clearAttackResolutionIndicators === "function"
    ) {
      this.ui.clearAttackResolutionIndicators();
    }
  }

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

  /**
   * UNIFIED DAMAGE APPLICATION
   * Centralizes all damage to trigger opponent_damage effects consistently.
   * Should be used instead of direct player.takeDamage() calls.
   *
   * @param {Object} player - Player taking damage
   * @param {number} amount - Damage amount
   * @param {Object} options - Additional context (cause, sourceCard, etc.)
   */
  inflictDamage(player, amount, options = {}) {
    if (!player || !amount || amount <= 0) return;

    // Apply the damage to player LP
    player.takeDamage(amount);

    // Trigger opponent_damage effects via EffectEngine
    if (
      this.effectEngine &&
      typeof this.effectEngine.applyDamage === "function"
    ) {
      const opponent = player === this.player ? this.bot : this.player;
      const ctx = {
        player: opponent, // The one whose effects will trigger
        opponent: player, // The one taking damage
        source: options.sourceCard || null,
      };
      const action = {
        type: "damage",
        player: "opponent", // From opponent's perspective
        amount: amount,
        triggerOnly: true, // Don't apply damage again, just trigger effects
      };

      // This will trigger all opponent_damage effects
      this.effectEngine.applyDamage(action, ctx);
    }
  }

  async startTurn() {
    this.turnCounter += 1;
    this.resetOncePerTurnUsage("start_turn");

    // ✅ FASE 4: Limpar buffs temporários expirados no início do turno
    this.cleanupExpiredBuffs();

    this.phase = "draw";

    const activePlayer = this.turn === "player" ? this.player : this.bot;
    const opponent = activePlayer === this.player ? this.bot : this.player;
    activePlayer.field.forEach((card) => {
      card.hasAttacked = false;
      card.attacksUsedThisTurn = 0;
      card.positionChangedThisTurn = false;
      card.canMakeSecondAttackThisTurn = false;
      card.secondAttackUsedThisTurn = false;
      card.battleIndestructibleOncePerTurnUsed = false;

      const shouldRestrictAttack =
        card.cannotAttackUntilTurn &&
        this.turnCounter <= card.cannotAttackUntilTurn;
      card.cannotAttackThisTurn = shouldRestrictAttack;

      if (!shouldRestrictAttack && card.cannotAttackUntilTurn) {
        card.cannotAttackUntilTurn = null;
      }
      if (
        card.immuneToOpponentEffectsUntilTurn &&
        this.turnCounter > card.immuneToOpponentEffectsUntilTurn
      ) {
        card.immuneToOpponentEffectsUntilTurn = null;
      }
    });
    activePlayer.summonCount = 0;
    activePlayer.additionalNormalSummons = 0;

    this.updateBoard();

    this.drawCards(activePlayer, 1);
    this.updateBoard();
    await this.waitForPhaseDelay();

    this.phase = "standby";

    // ✅ FASE 2 & 5: Processar delayed actions na standby phase ANTES de emitir o evento
    this.processDelayedActions("standby", activePlayer.id || this.turn);

    this.updateBoard();
    await this.emit("standby_phase", { player: activePlayer, opponent });
    await this.waitForPhaseDelay();

    this.phase = "main1";
    this.updateBoard();
    if (
      isAI(this.bot) &&
      this.turn === "bot" &&
      !this.gameOver &&
      typeof this.bot?.makeMove === "function"
    ) {
      this.bot.makeMove(this);
    }
  }

  waitForPhaseDelay() {
    return new Promise((resolve) =>
      setTimeout(resolve, this.phaseDelayMs || 0)
    );
  }

  async nextPhase() {
    if (this.gameOver) return;
    const actor = this.turn === "player" ? this.player : this.bot;
    const guard = this.guardActionStart(
      { actor, kind: "phase_change" },
      actor === this.player
    );
    if (!guard.ok) return guard;

    // Oferecer ativacao de traps genericas no final da fase atual
    await this.checkAndOfferTraps("phase_end", {
      currentPhase: this.phase,
    });

    const order = ["draw", "standby", "main1", "battle", "main2", "end"];
    const idx = order.indexOf(this.phase);
    if (idx === -1) return;
    const next = order[idx + 1];
    if (!next) {
      this.endTurn();
      return;
    }
    this.phase = next;

    // Clear attack indicators when leaving battle phase
    this.clearAttackResolutionIndicators();
    this.clearAttackReadyIndicators();

    this.updateBoard();

    if (
      isAI(this.bot) &&
      this.turn === "bot" &&
      !this.gameOver &&
      typeof this.bot?.makeMove === "function"
    ) {
      this.bot.makeMove(this);
    }
  }

  endTurn() {
    const actor = this.turn === "player" ? this.player : this.bot;
    const guard = this.guardActionStart(
      { actor, kind: "phase_change" },
      actor === this.player
    );
    if (!guard.ok) return guard;
    this.cleanupTempBoosts(this.player);
    this.cleanupTempBoosts(this.bot);

    // Clear all attack indicators at end of turn
    this.clearAttackResolutionIndicators();
    this.clearAttackReadyIndicators();

    this.turn = this.turn === "player" ? "bot" : "player";
    this.startTurn();
  }

  showIgnitionActivateModal(card, onActivate) {
    if (this.ui && typeof this.ui.showIgnitionActivateModal === "function") {
      this.ui.showIgnitionActivateModal(card, onActivate);
    }
  }

  skipToPhase(targetPhase) {
    const guard = this.guardActionStart({
      actor: this.player,
      kind: "phase_change",
    });
    if (!guard.ok) return guard;
    const order = ["draw", "standby", "main1", "battle", "main2", "end"];
    const currentIdx = order.indexOf(this.phase);
    const targetIdx = order.indexOf(targetPhase);
    if (currentIdx === -1 || targetIdx === -1) return;
    if (targetIdx <= currentIdx) return;
    this.phase = targetPhase;

    // Clear attack indicators when skipping phases
    this.clearAttackResolutionIndicators();
    this.clearAttackReadyIndicators();

    if (this.phase === "end") {
      this.endTurn();
      return;
    }
    this.updateBoard();
    if (
      isAI(this.bot) &&
      this.turn === "bot" &&
      this.phase !== "draw" &&
      !this.gameOver &&
      typeof this.bot?.makeMove === "function"
    ) {
      this.bot.makeMove(this);
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

  flipSummon(card) {
    if (!this.canFlipSummon(card)) return;
    card.isFacedown = false;
    card.position = "attack";
    card.positionChangedThisTurn = true;
    card.cannotAttackThisTurn = true;
    this.ui.log(`${card.name} is Flip Summoned!`);

    this.emit("after_summon", {
      card,
      player: card.owner === "player" ? this.player : this.bot,
      method: "flip",
    });

    this.updateBoard();
  }

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

  buildSelectionCandidateKey(candidate = {}, fallbackIndex = 0) {
    const zone = candidate.zone || "field";
    const zoneIndex =
      typeof candidate.zoneIndex === "number" ? candidate.zoneIndex : -1;
    const controller = candidate.controller || candidate.owner || "unknown";
    const baseId =
      candidate.cardRef?.id ||
      candidate.cardRef?.name ||
      candidate.name ||
      String(fallbackIndex);
    return `${controller}:${zone}:${zoneIndex}:${baseId}`;
  }

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

  normalizeSelectionContract(contract, overrides = {}) {
    const base =
      contract && typeof contract === "object" && !Array.isArray(contract)
        ? contract
        : {};
    const contractKind = base.kind || overrides.kind || "target";
    const rawRequirements = Array.isArray(base.requirements)
      ? base.requirements
      : base.requirements
      ? [base.requirements]
      : [];
    const normalizedRequirements = [];

    for (let i = 0; i < rawRequirements.length; i += 1) {
      const req = rawRequirements[i];
      if (!req || typeof req !== "object") {
        return { ok: false, reason: "Invalid selection requirements." };
      }

      const min = Number(req.min ?? req.count?.min ?? 1);
      const max = Number(req.max ?? req.count?.max ?? min);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
        return { ok: false, reason: "Selection requirements are invalid." };
      }

      let zones = Array.isArray(req.zones)
        ? req.zones.filter(Boolean)
        : req.zone
        ? [req.zone]
        : [];
      // Tentativa de inferir zona a partir dos candidatos quando o contrato
      // chega sem zones explícitas (ex.: prompts gerados no servidor).
      if (zones.length === 0 && Array.isArray(req.candidates)) {
        const inferred = req.candidates
          .map((cand) => cand?.zone || cand?.zoneName)
          .filter((z) => typeof z === "string" && z.length > 0);
        if (inferred.length > 0) {
          zones = Array.from(new Set(inferred));
        }
      }
      if (zones.length === 0 && contractKind === "position_select") {
        zones = ["field"];
      }
      if (zones.length === 0) {
        return { ok: false, reason: "Selection requirements missing zones." };
      }

      const ownerRaw = req.owner || "player";
      const owner =
        ownerRaw === "opponent"
          ? "opponent"
          : ownerRaw === "either" || ownerRaw === "any"
          ? "either"
          : "player";

      const candidates = Array.isArray(req.candidates)
        ? req.candidates
            .map((cand, idx) => {
              if (!cand || typeof cand !== "object") return null;
              if (!cand.key) {
                cand.key = this.buildSelectionCandidateKey(cand, idx);
              }
              return cand;
            })
            .filter(Boolean)
        : [];

      const normalized = {
        id: req.id || `selection_${i + 1}`,
        min,
        max,
        zones,
        owner,
        filters:
          req.filters && typeof req.filters === "object"
            ? { ...req.filters }
            : {},
        allowSelf: req.allowSelf !== false,
        distinct: req.distinct !== false,
        candidates,
      };

      normalizedRequirements.push(normalized);
    }

    if (normalizedRequirements.length === 0) {
      return { ok: false, reason: "Selection contract missing requirements." };
    }

    const uiBase = base.ui && typeof base.ui === "object" ? base.ui : {};
    const overrideUi =
      overrides.ui && typeof overrides.ui === "object" ? overrides.ui : {};

    const normalizedContract = {
      kind: contractKind,
      message: overrides.message ?? base.message ?? null,
      requirements: normalizedRequirements,
      ui: {
        allowCancel: overrideUi.allowCancel ?? uiBase.allowCancel ?? true,
        preventCancel:
          overrideUi.preventCancel ?? uiBase.preventCancel ?? false,
        useFieldTargeting:
          overrideUi.useFieldTargeting ?? uiBase.useFieldTargeting,
        allowEmpty: overrideUi.allowEmpty ?? uiBase.allowEmpty,
      },
      metadata:
        base.metadata && typeof base.metadata === "object"
          ? { ...base.metadata }
          : {},
    };

    return { ok: true, contract: normalizedContract };
  }

  canUseFieldTargeting(requirements) {
    const list = Array.isArray(requirements)
      ? requirements
      : requirements?.requirements || [];
    if (!list || list.length === 0) return false;
    const allowedZones = new Set(["field", "spellTrap", "fieldSpell"]);
    return list.every((req) => {
      if (!Array.isArray(req.candidates) || req.candidates.length === 0) {
        return false;
      }
      return req.candidates.every(
        (cand) =>
          (allowedZones.has(cand.zone) || cand.isDirectAttack === true) &&
          (cand.controller === "player" || cand.controller === "bot")
      );
    });
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

  startTargetSelectionSession(session) {
    if (!session || !session.selectionContract) return;

    const normalizedContract = this.normalizeSelectionContract(
      session.selectionContract,
      {
        kind: session.kind,
        message: session.message,
        ui: {
          allowCancel: session.allowCancel,
          preventCancel: session.preventCancel,
          useFieldTargeting: session.useFieldTargeting,
          allowEmpty: session.allowEmpty,
        },
      }
    );

    if (!normalizedContract.ok) {
      console.warn("[Game] Invalid selection contract:", normalizedContract);
      return;
    }

    const selectionContract = normalizedContract.contract;

    this.cancelTargetSelection();
    if (this.targetSelection) {
      return;
    }

    // Por padrão, evitamos field-targeting em prompts genéricos de alvo,
    // exceto quando explicitamente habilitado pelo contrato (ex.: combate).
    const usingFieldTargeting =
      typeof selectionContract.ui.useFieldTargeting === "boolean"
        ? selectionContract.ui.useFieldTargeting
        : false;
    selectionContract.ui.useFieldTargeting = usingFieldTargeting;

    this.selectionSessionCounter += 1;
    this.lastSelectionSessionId = this.selectionSessionCounter;
    this.targetSelection = {
      ...session,
      selectionContract,
      requirements: selectionContract.requirements,
      selections: {},
      currentRequirement: 0,
      sessionId: this.lastSelectionSessionId,
      usingFieldTargeting,
      allowCancel: selectionContract.ui.allowCancel !== false,
      allowEmpty: selectionContract.ui.allowEmpty === true,
      autoAdvanceOnMax:
        typeof session.autoAdvanceOnMax === "boolean"
          ? session.autoAdvanceOnMax
          : !usingFieldTargeting,
    };
    this.setSelectionState("selecting");

    if (usingFieldTargeting) {
      if (this.ui && typeof this.ui.showFieldTargetingControls === "function") {
        const allowCancel =
          this.targetSelection.allowCancel !== false &&
          !this.targetSelection.preventCancel;
        const controlsHandle = this.ui.showFieldTargetingControls(
          () => this.advanceTargetSelection(),
          allowCancel ? () => this.cancelTargetSelection() : null,
          { allowCancel }
        );
        this.targetSelection.controlsHandle = controlsHandle || null;
      }
      this.setSelectionDimming(true);
    } else if (this.ui && typeof this.ui.showTargetSelection === "function") {
      const allowCancel =
        this.targetSelection.allowCancel !== false &&
        !this.targetSelection.preventCancel;
      const modalHandle = this.ui.showTargetSelection(
        selectionContract,
        (chosenMap) => {
          if (!this.targetSelection) return;
          this.setSelectionState("confirming");
          this.targetSelection.selections = chosenMap || {};
          this.targetSelection.currentRequirement =
            this.targetSelection.requirements.length;
          this.finishTargetSelection();
        },
        allowCancel ? () => this.cancelTargetSelection() : null,
        {
          allowCancel,
          allowEmpty: this.targetSelection.allowEmpty === true,
        }
      );
      if (modalHandle && typeof modalHandle.close === "function") {
        this.targetSelection.closeModal = modalHandle.close;
      }
    }

    if (selectionContract.message) {
      this.ui.log(selectionContract.message);
    }
    if (usingFieldTargeting) {
      this.highlightTargetCandidates();
      this.updateFieldTargetingProgress();
    }
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

  startAttackTargetSelection(attacker, candidates) {
    if (!attacker || !Array.isArray(candidates)) return;

    // ✅ CORREÇÃO:  Detecta extra attacks consistentemente com bindCardInteractions
    // Extra attacks (2nd, 3rd, etc.) cannot be direct
    // Multi-attack mode allows multiple attacks but cannot attack directly
    const attacksUsed = attacker.attacksUsedThisTurn || 0;
    const isMultiAttackMode = attacker.canAttackAllOpponentMonstersThisTurn;
    const isExtraAttack = attacksUsed > 0 && !isMultiAttackMode;
    const canDirect =
      !attacker.cannotAttackDirectly &&
      !isExtraAttack && // Extra attacks cannot be direct
      !isMultiAttackMode && // Multi-attack can only target monsters, not direct
      (attacker.canAttackDirectlyThisTurn === true || candidates.length === 0);

    if (candidates.length === 0 && !canDirect) return;
    const decorated = candidates.map((card, idx) => {
      const ownerLabel = card.owner === "player" ? "player" : "opponent";
      const ownerPlayer = card.owner === "player" ? this.player : this.bot;
      const zoneArr = this.getZone(ownerPlayer, "field") || [];
      const zoneIndex = zoneArr.indexOf(card);
      const candidate = {
        idx,
        name: card.name,
        owner: ownerLabel,
        controller: card.owner,
        zone: "field",
        zoneIndex,
        position: card.position,
        atk: card.atk,
        def: card.def,
        cardKind: card.cardKind,
        cardRef: card,
      };
      candidate.key = this.buildSelectionCandidateKey(candidate, idx);
      return candidate;
    });

    // Adiciona alvo de ataque direto (clicar na mao do oponente) quando permitido
    if (canDirect) {
      decorated.push({
        idx: decorated.length,
        name: "Direct Attack",
        owner: "opponent",
        controller: this.bot.id,
        zone: "hand",
        zoneIndex: -1,
        position: "attack",
        atk: 0,
        def: 0,
        cardKind: "direct",
        cardRef: null,
        isDirectAttack: true,
        key: this.buildSelectionCandidateKey(
          {
            controller: this.bot.id,
            zone: "hand",
            zoneIndex: -1,
            name: "Direct Attack",
          },
          decorated.length
        ),
      });
    }

    const requirement = {
      id: "attack_target",
      min: 1,
      max: 1,
      zones: [...new Set(decorated.map((cand) => cand.zone).filter(Boolean))],
      owner: "opponent",
      filters: {},
      allowSelf: true,
      distinct: true,
      candidates: decorated,
    };
    const selectionContract = {
      kind: "choice",
      message: "Select a monster to attack.",
      requirements: [requirement],
      ui: { useFieldTargeting: true },
      metadata: { context: "attack" },
    };

    this.startTargetSelectionSession({
      kind: "attack",
      attacker,
      selectionContract,
      execute: (selections) => {
        const chosenKeys = selections[requirement.id] || [];
        const chosenKey = chosenKeys[0];
        const chosenCandidate = requirement.candidates.find(
          (cand) => cand.key === chosenKey
        );
        if (chosenCandidate?.isDirectAttack) {
          this.resolveCombat(attacker, null, {
            allowDuringSelection: true,
            allowDuringResolving: true,
          }).catch((err) => console.error(err));
        } else if (chosenCandidate?.cardRef) {
          this.resolveCombat(attacker, chosenCandidate.cardRef, {
            allowDuringSelection: true,
            allowDuringResolving: true,
          }).catch((err) => console.error(err));
        }
        return { success: true, needsSelection: false };
      },
    });
  }

  askPlayerToSelectCards(config = {}) {
    const owner = config.owner === "player" ? this.player : null;
    if (!owner) return Promise.resolve([]);

    const zoneName = config.zone || "field";
    let candidates = this.getZone(owner, zoneName) || [];

    const filter = config.filter;
    if (filter) {
      if (typeof filter === "function") {
        candidates = candidates.filter(filter);
      } else if (typeof filter === "object") {
        candidates = candidates.filter((card) => {
          return Object.entries(filter).every(([key, value]) => {
            if (!card) return false;
            if (Array.isArray(value)) {
              return value.includes(card[key]);
            }
            return card[key] === value;
          });
        });
      }
    }

    const min = Math.max(1, config.min ?? 1);
    const max = Math.min(config.max ?? min, candidates.length);

    if (candidates.length < min) {
      return Promise.resolve([]);
    }

    const decorated = candidates.map((card, idx) => {
      const ownerLabel = card.owner === "player" ? "player" : "opponent";
      const ownerPlayer = card.owner === "player" ? this.player : this.bot;
      const zoneArr = this.getZone(ownerPlayer, zoneName) || [];
      const zoneIndex = zoneArr.indexOf(card);
      return {
        idx,
        name: card.name,
        owner: ownerLabel,
        controller: card.owner,
        zone: zoneName,
        zoneIndex,
        position: card.position,
        atk: card.atk,
        def: card.def,
        cardKind: card.cardKind,
        cardRef: card,
      };
    });

    return new Promise((resolve) => {
      const candidatesWithKeys = decorated.map((cand, idx) => {
        if (!cand.key) {
          cand.key = this.buildSelectionCandidateKey(cand, idx);
        }
        return cand;
      });
      const requirement = {
        id: "custom_select",
        min,
        max,
        zones: [zoneName],
        owner: "player",
        filters: {},
        allowSelf: true,
        distinct: true,
        candidates: candidatesWithKeys,
      };
      const selectionContract = {
        kind: "choice",
        message:
          config.message ||
          "Select card(s) by clicking the highlighted targets.",
        requirements: [requirement],
        ui: { useFieldTargeting: true },
        metadata: { context: "custom" },
      };

      this.startTargetSelectionSession({
        kind: "custom",
        selectionContract,
        resolve,
        execute: (selections) => {
          const chosenKeys = selections[requirement.id] || [];
          const chosen = chosenKeys
            .map((key) =>
              requirement.candidates.find((cand) => cand.key === key)
            )
            .map((cand) => cand?.cardRef)
            .filter(Boolean);
          resolve(chosen);
          return { success: true, needsSelection: false };
        },
      });
    });
  }

  highlightTargetCandidates() {
    this.clearTargetHighlights();
    if (!this.targetSelection) {
      console.log("[Game] No target selection active");
      return;
    }
    if (!this.targetSelection.usingFieldTargeting) {
      return;
    }
    if (
      this.targetSelection.state &&
      this.targetSelection.state !== "selecting"
    ) {
      return;
    }
    const requirement =
      this.targetSelection.requirements[
        this.targetSelection.currentRequirement
      ];
    if (!requirement) {
      console.log("[Game] No option to highlight");
      return;
    }

    let attackerHighlight = null;
    if (
      this.targetSelection.kind === "attack" &&
      this.targetSelection.attacker
    ) {
      const attacker = this.targetSelection.attacker;
      const attackerOwner = attacker.owner === "player" ? "player" : "bot";
      const attackerField =
        attackerOwner === "player" ? this.player.field : this.bot.field;
      const attackerIndex = attackerField.indexOf(attacker);
      if (attackerIndex > -1) {
        attackerHighlight = { owner: attackerOwner, index: attackerIndex };
      }
    }

    console.log("[Game] Highlighting targets:", {
      kind: this.targetSelection.kind,
      optionId: requirement.id,
      candidatesCount: requirement.candidates?.length,
      min: requirement.min,
      max: requirement.max,
    });

    const selected = this.targetSelection.selections[requirement.id] || [];
    const selectedSet = new Set(selected);
    const highlightTargets = requirement.candidates.map((cand) => ({
      key: cand.key,
      zone: cand.zone,
      controller: cand.controller,
      zoneIndex: cand.zoneIndex,
      name: cand.name,
      isDirectAttack: !!cand.isDirectAttack,
      isSelected: selectedSet.has(cand.key),
      isAttackTarget:
        this.targetSelection.kind === "attack" && selectedSet.has(cand.key),
    }));

    if (this.ui && typeof this.ui.applyTargetHighlights === "function") {
      this.ui.applyTargetHighlights({
        targets: highlightTargets,
        attackerHighlight,
      });
    }
    this.updateFieldTargetingProgress();
  }

  clearTargetHighlights() {
    if (this.ui && typeof this.ui.clearTargetHighlights === "function") {
      this.ui.clearTargetHighlights();
    }
  }

  setSelectionDimming(active) {
    if (this.ui && typeof this.ui.setSelectionDimming === "function") {
      this.ui.setSelectionDimming(!!active);
    }
  }

  updateFieldTargetingProgress() {
    if (!this.targetSelection || !this.targetSelection.usingFieldTargeting) {
      return;
    }
    const handle = this.targetSelection.controlsHandle;
    if (!handle || typeof handle.updateState !== "function") return;
    const requirement =
      this.targetSelection.requirements[
        this.targetSelection.currentRequirement
      ];
    if (!requirement) return;
    const selections = this.targetSelection.selections[requirement.id] || [];
    const min = Number(requirement.min ?? 0);
    const max = Number(requirement.max ?? min);
    handle.updateState({
      selected: selections.length,
      min,
      max,
      allowEmpty: this.targetSelection.allowEmpty === true,
    });
  }

  handleTargetSelectionClick(ownerId, cardIndex, cardEl, location = null) {
    if (!this.targetSelection) return false;
    if (!this.targetSelection.usingFieldTargeting) return false;
    if (
      this.targetSelection.state &&
      this.targetSelection.state !== "selecting"
    ) {
      return false;
    }

    console.log("[Game] Target selection click:", {
      ownerId,
      cardIndex,
      currentRequirement: this.targetSelection.currentRequirement,
      requirementsLength: this.targetSelection.requirements?.length,
    });

    const requirement =
      this.targetSelection.requirements[
        this.targetSelection.currentRequirement
      ];
    if (!requirement) {
      console.log("[Game] No option found");
      return false;
    }

    const ownerPlayer = ownerId === "player" ? this.player : this.bot;
    let card = null;
    const zoneHint = location || requirement.zones?.[0] || "field";

    if (zoneHint === "fieldSpell") {
      card = ownerPlayer.fieldSpell;
    } else if (zoneHint === "spellTrap") {
      card = ownerPlayer.spellTrap[cardIndex];
    } else {
      card = ownerPlayer.field[cardIndex];
    }

    if (!card) {
      console.log("[Game] Card not found at index:", cardIndex);
      return true;
    }

    console.log("[Game] Looking for candidate:", {
      cardName: card.name,
      cardIndex: cardIndex,
      candidatesCount: requirement.candidates.length,
      candidateNames: requirement.candidates.map(
        (c) => `${c.name} [idx:${c.zoneIndex}]`
      ),
    });

    // Find candidate by matching card reference (most reliable method)
    // NOTE: We use cardRef identity match instead of zoneIndex because
    // zoneIndex can become stale if the board is re-rendered between
    // when decoratedCandidates were created and when the click occurs
    const candidate = requirement.candidates.find(
      (cand) => cand.cardRef === card
    );

    if (!candidate) {
      console.log("[Game] Candidate not found. Checking references:");
      requirement.candidates.forEach((cand, i) => {
        console.log(`  Candidate ${i}:`, {
          name: cand.name,
          zoneIndex: cand.zoneIndex,
          cardIndex: cardIndex,
          refMatch: cand.cardRef === card,
        });
      });
      return true;
    }

    const selections = this.targetSelection.selections[requirement.id] || [];
    const max = Number(requirement.max ?? 0);
    const existing = selections.indexOf(candidate.key);
    if (existing > -1) {
      selections.splice(existing, 1);
      console.log("[Game] Deselected card");
    } else {
      if (max > 0 && selections.length >= max) {
        console.log("[Game] Max selections reached");
        return true;
      }
      selections.push(candidate.key);
      console.log(
        "[Game] Selected card, total:",
        selections.length,
        "/",
        max || requirement.max
      );
    }
    this.targetSelection.selections[requirement.id] = selections;

    const shouldAutoAdvance = this.targetSelection.autoAdvanceOnMax !== false;

    if (shouldAutoAdvance && max > 0 && selections.length >= max) {
      console.log("[Game] Max reached, advancing selection");
      this.advanceTargetSelection();
    }
    this.highlightTargetCandidates();
    this.updateFieldTargetingProgress();

    return true;
  }

  advanceTargetSelection() {
    if (!this.targetSelection) return;
    if (
      this.targetSelection.state &&
      this.targetSelection.state !== "selecting"
    ) {
      return;
    }
    const requirement =
      this.targetSelection.requirements[
        this.targetSelection.currentRequirement
      ];
    if (!requirement) return;

    const selections = this.targetSelection.selections[requirement.id] || [];
    if (selections.length < requirement.min) {
      return;
    }

    this.targetSelection.currentRequirement++;
    if (
      this.targetSelection.currentRequirement >=
      this.targetSelection.requirements.length
    ) {
      this.setSelectionState("confirming");
      this.finishTargetSelection();
    } else {
      this.highlightTargetCandidates();
      this.updateFieldTargetingProgress();
    }
  }

  async finishTargetSelection() {
    if (!this.targetSelection) return;
    const selection = this.targetSelection;
    this.setSelectionState("resolving");
    this.targetSelection = null;
    this.graveyardSelection = null;
    this.clearTargetHighlights();
    this.setSelectionDimming(false);
    if (this.ui && typeof this.ui.hideFieldTargetingControls === "function") {
      this.ui.hideFieldTargetingControls();
    }
    if (selection?.closeModal) {
      selection.closeModal();
    }

    let normalized = {
      success: false,
      needsSelection: false,
      reason: "Selection failed.",
    };

    try {
      if (typeof selection.execute !== "function") {
        console.warn("[Game] Selection missing execute handler:", selection);
      } else {
        const result = await selection.execute(selection.selections || {});
        normalized = this.normalizeActivationResult(result);
      }

      if (
        selection.rollback &&
        selection.activationContext?.committed === true &&
        !normalized.needsSelection &&
        !normalized.success
      ) {
        try {
          selection.rollback();
        } catch (err) {
          console.error("[Game] Rollback failed:", err);
        }
      }

      if (typeof selection.onResult === "function") {
        const result = selection.onResult(normalized);
        if (result && typeof result.then === "function") {
          await result;
        }
      }
    } catch (err) {
      console.error("[Game] Error resolving selection:", err);
    } finally {
      if (!this.targetSelection) {
        this.setSelectionState("idle");
      }
    }
  }

  setSelectionState(state) {
    this.selectionState = state;
    if (this.targetSelection) {
      this.targetSelection.state = state;
    }
  }

  cancelTargetSelection() {
    if (!this.targetSelection) return;
    if (this.targetSelection.preventCancel) {
      return;
    }
    const selection = this.targetSelection;
    if (typeof selection.onCancel === "function") {
      selection.onCancel();
    }
    if (selection?.resolve) {
      selection.resolve([]);
    }
    this.clearTargetHighlights();
    this.setSelectionDimming(false);
    if (this.ui && typeof this.ui.hideFieldTargetingControls === "function") {
      this.ui.hideFieldTargetingControls();
    }
    if (selection?.closeModal) {
      selection.closeModal();
    }
    this.targetSelection = null;
    this.setSelectionState("idle");
  }
  openGraveyardModal(player, options = {}) {
    if (options.selectable) {
      this.graveyardSelection = { onCancel: options.onCancel || null };
    } else {
      this.graveyardSelection = null;
    }

    // Se não está em modo de seleção, mostrar indicador de efeitos ativáveis
    if (
      !options.selectable &&
      player.id === "player" &&
      this.turn === "player"
    ) {
      options.showActivatable = true;
      options.isActivatable = (card) => {
        return this.effectEngine.hasActivatableGraveyardEffect(card);
      };

      // Se não tem onSelect customizado, usar o padrão para ativar efeitos
      if (!options.onSelect) {
        options.onSelect = (card) => {
          if (!this.effectEngine.hasActivatableGraveyardEffect(card)) {
            return;
          }
          const activationContext = {
            fromHand: false,
            activationZone: "graveyard",
            sourceZone: "graveyard",
            committed: false,
          };
          const activationEffect =
            this.effectEngine?.getMonsterIgnitionEffect?.(card, "graveyard");
          this.runActivationPipeline({
            card,
            owner: player,
            activationZone: "graveyard",
            activationContext,
            selectionKind: "graveyardEffect",
            selectionMessage: "Select target(s) for the graveyard effect.",
            guardKind: "graveyard_effect",
            phaseReq: ["main1", "main2"],
            oncePerTurn: {
              card,
              player,
              effect: activationEffect,
            },
            onSelectionStart: () => this.closeGraveyardModal(false),
            activate: (chosen, ctx) =>
              this.effectEngine.activateMonsterFromGraveyard(
                card,
                player,
                chosen,
                ctx
              ),
            finalize: () => {
              this.closeGraveyardModal(false);
              this.ui.log(`${card.name} activates from the Graveyard.`);
              this.updateBoard();
            },
          });
        };
        options.selectable = true;
      }
    }

    this.ui.renderGraveyardModal(player.graveyard, options);
    this.ui.toggleModal(true);
  }

  closeGraveyardModal(triggerCancel = true) {
    this.ui.toggleModal(false);
    if (triggerCancel && this.graveyardSelection?.onCancel) {
      this.graveyardSelection.onCancel();
    }
    this.graveyardSelection = null;
  }

  openExtraDeckModal(player) {
    this.ui.renderExtraDeckModal(player.extraDeck);
    this.ui.toggleExtraDeckModal(true);
  }

  closeExtraDeckModal() {
    this.ui.toggleExtraDeckModal(false);
  }

  getMaterialFieldAgeTurnCounter(card) {
    if (!card) return this.turnCounter;
    const entered = card.enteredFieldTurn ?? null;
    const summoned = card.summonedTurn ?? null;
    const setTurn = card.setTurn ?? null;
    const values = [entered, summoned, setTurn].filter((v) =>
      Number.isFinite(v)
    );
    if (values.length === 0) return this.turnCounter;
    return Math.max(...values);
  }

  getAscensionCandidatesForMaterial(player, materialCard) {
    if (!player || !materialCard) return [];
    if (!Array.isArray(player.extraDeck)) return [];
    if (typeof materialCard.id !== "number") return [];

    const candidates = player.extraDeck.filter((card) => {
      const asc = card?.ascension;
      if (!card || card.cardKind !== "monster") return false;
      if (card.monsterType !== "ascension") return false;
      if (!asc || typeof asc !== "object") return false;
      return asc.materialId === materialCard.id;
    });

    this.devLog("ASCENSION_CANDIDATES", {
      summary: `Material ${materialCard.name} (ID: ${materialCard.id}) -> ${candidates.length} candidates`,
      materialId: materialCard.id,
      materialName: materialCard.name,
      candidates: candidates.map((c) => ({
        name: c.name,
        id: c.id,
        requiredMaterial: c.ascension?.materialId,
      })),
    });

    return candidates;
  }

  checkAscensionRequirements(player, ascensionCard) {
    const asc = ascensionCard?.ascension;
    if (!player || !ascensionCard || !asc) {
      return { ok: false, reason: "Invalid ascension card." };
    }
    const materialId = asc.materialId;
    if (typeof materialId !== "number") {
      return { ok: false, reason: "Missing ascension materialId." };
    }

    const reqs = Array.isArray(asc.requirements) ? asc.requirements : [];
    for (const req of reqs) {
      if (!req || !req.type) continue;
      switch (req.type) {
        case "material_destroyed_opponent_monsters": {
          const need = Math.max(0, req.count ?? req.min ?? 0);
          const got =
            this.materialDuelStats?.[
              player.id
            ]?.destroyedOpponentMonstersByMaterialId?.get?.(materialId) || 0;
          if (got < need) {
            return {
              ok: false,
              reason: `Ascension requirement not met: ${need} opponent monster(s) destroyed (current: ${got}).`,
            };
          }
          break;
        }
        case "material_effect_activations": {
          const need = Math.max(0, req.count ?? req.min ?? 0);
          const got =
            this.materialDuelStats?.[
              player.id
            ]?.effectActivationsByMaterialId?.get?.(materialId) || 0;
          this.devLog("ASCENSION_REQUIREMENT_CHECK", {
            summary: `Material ID ${materialId} effect activations: ${got}/${need}`,
            requirementType: "material_effect_activations",
            materialId,
            need,
            got,
            passed: got >= need,
          });
          if (got < need) {
            return {
              ok: false,
              reason: `Ascension requirement not met: material effect activated ${need} time(s) (current: ${got}).`,
            };
          }
          break;
        }
        case "player_lp_gte": {
          const need = Math.max(0, req.amount ?? req.min ?? 0);
          if ((player.lp ?? 0) < need) {
            return { ok: false, reason: `Need at least ${need} LP.` };
          }
          break;
        }
        case "player_lp_lte": {
          const need = Math.max(0, req.amount ?? req.max ?? 0);
          if ((player.lp ?? 0) > need) {
            return { ok: false, reason: `Need at most ${need} LP.` };
          }
          break;
        }
        case "player_hand_gte": {
          const need = Math.max(0, req.count ?? req.min ?? 0);
          if ((player.hand?.length || 0) < need) {
            return {
              ok: false,
              reason: `Need at least ${need} card(s) in hand.`,
            };
          }
          break;
        }
        case "player_graveyard_gte": {
          const need = Math.max(0, req.count ?? req.min ?? 0);
          if ((player.graveyard?.length || 0) < need) {
            return {
              ok: false,
              reason: `Need at least ${need} card(s) in graveyard.`,
            };
          }
          break;
        }
        default:
          break;
      }
    }

    return { ok: true };
  }

  canUseAsAscensionMaterial(player, materialCard) {
    if (!player || !materialCard) {
      return { ok: false, reason: "Missing material." };
    }
    if (!player.field?.includes(materialCard)) {
      return { ok: false, reason: "Material must be on the field." };
    }
    if (materialCard.cardKind !== "monster") {
      return { ok: false, reason: "Material must be a monster." };
    }
    if (materialCard.isFacedown) {
      return { ok: false, reason: "Material must be face-up." };
    }

    const enteredTurn = this.getMaterialFieldAgeTurnCounter(materialCard);
    if (this.turnCounter <= enteredTurn) {
      return {
        ok: false,
        reason: "Material must have been on the field for at least 1 turn.",
      };
    }

    return { ok: true };
  }

  async performAscensionSummon(player, materialCard, ascensionCard) {
    const game = this;
    if (!player || !materialCard || !ascensionCard) {
      return {
        success: false,
        needsSelection: false,
        reason: "Invalid summon.",
      };
    }

    const materialCheck = this.canUseAsAscensionMaterial(player, materialCard);
    if (!materialCheck.ok) {
      return {
        success: false,
        needsSelection: false,
        reason: materialCheck.reason,
      };
    }

    const reqCheck = this.checkAscensionRequirements(player, ascensionCard);
    if (!reqCheck.ok) {
      return { success: false, needsSelection: false, reason: reqCheck.reason };
    }

    if ((player.field?.length || 0) >= 5) {
      return {
        success: false,
        needsSelection: false,
        reason: "Field is full.",
      };
    }

    const positionPref = ascensionCard.ascension?.position || "choice";
    const resolvedPosition =
      positionPref === "choice" &&
      typeof this.effectEngine?.chooseSpecialSummonPosition === "function"
        ? await this.effectEngine.chooseSpecialSummonPosition(
            ascensionCard,
            player
          )
        : positionPref === "defense"
        ? "defense"
        : "attack";

    const result = await this.runZoneOp(
      "ASCENSION_SUMMON",
      async () => {
        const sendResult = await this.moveCard(
          materialCard,
          player,
          "graveyard",
          {
            fromZone: "field",
            contextLabel: "ascension_material",
            wasDestroyed: false,
          }
        );
        if (sendResult?.success === false) {
          return {
            success: false,
            needsSelection: false,
            reason: "Failed to pay material.",
          };
        }

        const summonResult = await this.moveCard(
          ascensionCard,
          player,
          "field",
          {
            fromZone: "extraDeck",
            position: resolvedPosition,
            isFacedown: false,
            resetAttackFlags: true,
            summonMethodOverride: "ascension",
            contextLabel: "ascension_summon",
          }
        );
        if (summonResult?.success === false) {
          return {
            success: false,
            needsSelection: false,
            reason: summonResult.reason || "Ascension summon failed.",
          };
        }

        // Propagar needsSelection do after_summon
        if (summonResult.needsSelection) {
          return {
            success: true,
            needsSelection: true,
            selectionContract: summonResult.selectionContract,
          };
        }

        return { success: true, needsSelection: false };
      },
      {
        contextLabel: "ascension_summon",
        card: ascensionCard,
        fromZone: "extraDeck",
        toZone: "field",
      }
    );

    if (result?.success) {
      game.ui.log(
        `${player.name || player.id} Ascension Summoned ${
          ascensionCard.name
        } by sending ${materialCard.name} to the Graveyard.`
      );
      game.updateBoard();
    } else if (result?.reason) {
      game.ui.log(result.reason);
    }

    return (
      result || {
        success: false,
        needsSelection: false,
        reason: "Ascension summon failed.",
      }
    );
  }

  async tryAscensionSummon(materialCard, options = {}) {
    const player = this.player;
    const guard = this.guardActionStart({
      actor: player,
      kind: "ascension_summon",
      phaseReq: ["main1", "main2"],
    });
    if (!guard.ok) return guard;

    const materialCheck = this.canUseAsAscensionMaterial(player, materialCard);
    if (!materialCheck.ok) {
      this.ui.log(materialCheck.reason);
      return { success: false, reason: materialCheck.reason };
    }

    const allAscensions = this.getAscensionCandidatesForMaterial(
      player,
      materialCard
    );
    if (allAscensions.length === 0) {
      let hint = "";
      try {
        const extra = Array.isArray(player.extraDeck) ? player.extraDeck : [];
        const ascInExtra = extra.filter(
          (c) => c && c.cardKind === "monster" && c.monsterType === "ascension"
        );
        if (ascInExtra.length === 0) {
          hint = " No ascension monsters in Extra Deck.";
        } else {
          const missingMeta = ascInExtra.filter((c) => !c.ascension).length;
          const wrongMaterial = ascInExtra.filter(
            (c) => c.ascension && c.ascension.materialId !== materialCard.id
          ).length;
          if (missingMeta > 0) {
            hint += ` ${missingMeta} ascension card(s) missing metadata.`;
          }
          if (wrongMaterial > 0) {
            hint += ` ${wrongMaterial} ascension card(s) require a different material.`;
          }
        }
      } catch (_) {
        // best-effort diagnostics only
      }

      const reason =
        `No Ascension monsters available for this material.${hint}`.trim();
      this.ui.log(reason);
      return { success: false, reason };
    }

    const eligible = [];
    let lastFailure = null;
    for (const asc of allAscensions) {
      const req = this.checkAscensionRequirements(player, asc);
      if (req.ok) {
        eligible.push(asc);
      } else {
        lastFailure = req.reason;
      }
    }

    if (eligible.length === 0) {
      const reason = lastFailure || "Ascension requirements not met.";
      this.ui.log(reason);
      return { success: false, reason };
    }

    if (eligible.length === 1) {
      return await this.performAscensionSummon(
        player,
        materialCard,
        eligible[0]
      );
    }

    const candidates = eligible
      .map((card) => {
        const zoneIndex = player.extraDeck.indexOf(card);
        return {
          name: card.name,
          owner: "player",
          controller: player.id,
          zone: "extraDeck",
          zoneIndex,
          atk: card.atk || 0,
          def: card.def || 0,
          level: card.level || 0,
          cardKind: card.cardKind,
          cardRef: card,
        };
      })
      .map((cand, idx) => ({
        ...cand,
        key: this.buildSelectionCandidateKey(cand, idx),
      }));

    return new Promise((resolve) => {
      const requirementId = "ascension_choice";
      const requirement = {
        id: requirementId,
        min: 1,
        max: 1,
        zones: ["extraDeck"],
        owner: "player",
        filters: {},
        allowSelf: true,
        distinct: true,
        candidates,
      };
      const selectionContract = {
        kind: "choice",
        message: "Select an Ascension Monster to Summon.",
        requirements: [requirement],
        ui: { useFieldTargeting: false, allowCancel: true },
        metadata: { context: "ascension_choice" },
      };

      this.startTargetSelectionSession({
        kind: "ascension",
        selectionContract,
        onCancel: () =>
          resolve({ success: false, reason: "Ascension cancelled." }),
        execute: async (selections) => {
          const chosenKey = (selections?.[requirementId] || [])[0];
          const chosenCard =
            candidates.find((cand) => cand.key === chosenKey)?.cardRef || null;
          if (!chosenCard) {
            return {
              success: false,
              needsSelection: false,
              reason: "No Ascension selected.",
            };
          }
          const res = await this.performAscensionSummon(
            player,
            materialCard,
            chosenCard
          );
          resolve(res);
          return res;
        },
      });
    });
  }

  getAttackAvailability(attacker) {
    if (!attacker) {
      return { ok: false, reason: "No attacker selected." };
    }
    if (attacker.cannotAttackThisTurn) {
      return {
        ok: false,
        reason: `${attacker.name} cannot attack this turn.`,
      };
    }
    if (attacker.position === "defense") {
      return {
        ok: false,
        reason: "Defense position monsters cannot attack!",
      };
    }

    const extraAttacks = attacker.extraAttacks || 0;
    const maxAttacks = 1 + extraAttacks;
    const attacksUsed = attacker.attacksUsedThisTurn || 0;
    const canUseSecondAttack =
      attacker.canMakeSecondAttackThisTurn &&
      !attacker.secondAttackUsedThisTurn;

    // Check for multi-attack ability (attack all opponent monsters)
    if (attacker.canAttackAllOpponentMonstersThisTurn) {
      const opponent = attacker.owner === "player" ? this.bot : this.player;
      const opponentMonsters = (opponent?.field || []).filter(
        (m) => m && !m.isFacedown
      );
      const opponentMonsterCount = opponentMonsters.length;

      // Filter out already attacked monsters
      const attackedMonsters = attacker.attackedMonstersThisTurn || new Set();
      const unattackedMonsters = opponentMonsters.filter((m) => {
        const cardId = m.instanceId || m.id || m.name;
        return !attackedMonsters.has(cardId);
      });

      // Can still attack if there are unattacked monsters
      if (unattackedMonsters.length > 0) {
        return {
          ok: true,
          maxAttacks: opponentMonsterCount,
          attacksUsed,
          isMultiAttack: true,
          remainingTargets: unattackedMonsters.length,
        };
      }

      // All monsters attacked - no more attacks in multi-attack mode
      return {
        ok: false,
        reason: `${attacker.name} has attacked all opponent monsters this turn.`,
      };
    }

    if (attacksUsed >= maxAttacks && !canUseSecondAttack) {
      return {
        ok: false,
        reason: `${attacker.name} has already attacked the maximum number of times this turn.`,
      };
    }

    return { ok: true, maxAttacks, attacksUsed };
  }

  markAttackUsed(attacker, target = null) {
    if (!attacker) return;
    const extraAttacks = attacker.extraAttacks || 0;
    const maxAttacks = 1 + extraAttacks;
    attacker.attacksUsedThisTurn = (attacker.attacksUsedThisTurn || 0) + 1;

    // Track attacked monsters for multi-attack effects
    if (attacker.canAttackAllOpponentMonstersThisTurn && target) {
      attacker.attackedMonstersThisTurn =
        attacker.attackedMonstersThisTurn || new Set();
      // Use unique identifier for the target (id or reference)
      const targetId = target.instanceId || target.id || target.name;
      attacker.attackedMonstersThisTurn.add(targetId);
    }

    if (
      attacker.attacksUsedThisTurn > maxAttacks &&
      attacker.canMakeSecondAttackThisTurn &&
      !attacker.secondAttackUsedThisTurn
    ) {
      attacker.secondAttackUsedThisTurn = true;
    }

    // For multi-attack mode, don't set hasAttacked until all opponent monsters are attacked
    if (attacker.canAttackAllOpponentMonstersThisTurn) {
      // In multi-attack mode, check if there are still unattacked monsters
      const opponent = attacker.owner === "player" ? this.bot : this.player;
      const opponentMonsters = (opponent?.field || []).filter(
        (m) => m && !m.isFacedown
      );
      const attackedMonsters = attacker.attackedMonstersThisTurn || new Set();
      const unattackedCount = opponentMonsters.filter((m) => {
        const cardId = m.instanceId || m.id || m.name;
        return !attackedMonsters.has(cardId);
      }).length;

      // Only mark as hasAttacked when all monsters have been attacked
      attacker.hasAttacked = unattackedCount === 0;
    } else if (attacker.attacksUsedThisTurn >= maxAttacks) {
      attacker.hasAttacked = true;
    } else {
      attacker.hasAttacked = false;
    }
  }

  registerAttackNegated(attacker) {
    this.lastAttackNegated = true;
    if (attacker?.name) {
      this.ui.log(`The attack of ${attacker.name} was negated!`);
    } else {
      this.ui.log("The attack was negated!");
    }
  }

  canDestroyByBattle(card) {
    if (!card) return false;
    if (card.battleIndestructible) return false;
    if (card.tempBattleIndestructible) return false;
    if (
      card.battleIndestructibleOncePerTurn &&
      !card.battleIndestructibleOncePerTurnUsed
    ) {
      card.battleIndestructibleOncePerTurnUsed = true;
      return false;
    }
    return true;
  }

  async resolveCombat(attacker, target, options = {}) {
    if (!attacker) return;
    const attackerOwner = attacker.owner === "player" ? this.player : this.bot;
    const guard = this.guardActionStart(
      {
        actor: attackerOwner,
        kind: "attack",
        phaseReq: "battle",
        allowDuringSelection: options.allowDuringSelection === true,
        allowDuringResolving: options.allowDuringResolving === true,
      },
      attackerOwner === this.player
    );
    if (!guard.ok) return guard;

    const availability = this.getAttackAvailability(attacker);
    if (!availability.ok) return;

    this.applyAttackResolutionIndicators(attacker, target);

    const attacksUsed =
      availability.attacksUsed ?? attacker.attacksUsedThisTurn ?? 0;
    const baseMaxAttacks = 1 + (attacker.extraAttacks || 0);
    const maxAttacks = availability.maxAttacks ?? baseMaxAttacks;
    const usingSecondAttack =
      attacker.canMakeSecondAttackThisTurn &&
      !attacker.secondAttackUsedThisTurn &&
      attacksUsed >= maxAttacks;

    if (usingSecondAttack) {
      attacker.secondAttackUsedThisTurn = true;
    }

    this.lastAttackNegated = false;

    this.ui.log(
      `${attacker.name} attacks ${target ? target.name : "directly"}!`
    );

    const defenderOwner = target
      ? target.owner === "player"
        ? this.player
        : this.bot
      : attacker.owner === "player"
      ? this.bot
      : this.player;
    const targetOwner = defenderOwner;

    await this.emit("attack_declared", {
      attacker,
      target: target || null,
      defender: target || null,
      attackerOwner,
      defenderOwner,
      targetOwner,
    });

    if (this.lastAttackNegated) {
      attacker.attacksUsedThisTurn = (attacker.attacksUsedThisTurn || 0) + 1;
      // For multi-attack mode, don't block further attacks when one is negated
      if (!attacker.canAttackAllOpponentMonstersThisTurn) {
        attacker.hasAttacked = true;
      }
      this.clearAttackResolutionIndicators();
      this.updateBoard();
      this.checkWinCondition();
      return { ok: true };
    }

    if (!target) {
      const defender = attacker.owner === "player" ? this.bot : this.player;
      this.inflictDamage(defender, attacker.atk, {
        sourceCard: attacker,
        cause: "battle",
      });
      this.markAttackUsed(attacker, null); // Direct attack, no target
      this.checkWinCondition();
      this.clearAttackResolutionIndicators();
      this.updateBoard();
      return { ok: true };
    }

    const needsFlip = target.isFacedown;

    if (needsFlip) {
      const targetOwner = target.owner === "player" ? "player" : "bot";
      const targetField =
        target.owner === "player" ? this.player.field : this.bot.field;
      const targetIndex = targetField.indexOf(target);

      if (this.ui && typeof this.ui.applyFlipAnimation === "function") {
        this.ui.applyFlipAnimation(targetOwner, targetIndex);
      }

      target.isFacedown = false;
      this.ui.log(`${target.name} was flipped!`);

      this.updateBoard();
      this.applyAttackResolutionIndicators(attacker, target);

      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    const combatResult = await this.finishCombat(attacker, target);
    // Propagate needsSelection from battle_destroy effects
    if (combatResult?.needsSelection && combatResult?.selectionContract) {
      return combatResult;
    }
    return { ok: true };
  }

  async finishCombat(attacker, target, options = {}) {
    // Capture healing flags at the start of combat resolution to avoid race conditions
    const attackerHealsOnBattleDamage =
      attacker?.battleDamageHealsControllerThisTurn || false;
    const defenderHealsOnBattleDamage =
      target?.battleDamageHealsControllerThisTurn || false;

    // Check if we're resuming from a pending tie destruction
    const resumeFromTie = options.resumeFromTie === true;
    const skipAttackerDestruction = resumeFromTie;
    const battleDestroyResults = [];

    const applyBattleDamage = (
      player,
      cardInvolved,
      amount,
      shouldHeal = false
    ) => {
      if (!player || amount <= 0) return;
      if (shouldHeal && player.id === cardInvolved?.owner) {
        player.gainLP(amount);
      } else {
        this.inflictDamage(player, amount, {
          sourceCard: cardInvolved,
          cause: "battle",
        });
      }
    };

    const logBattleResult = (message) => {
      if (message) {
        this.ui.log(message);
      }
    };

    const logBattleDestroyCheck = (context) => {
      const formatCard = (card, label) => {
        if (!card) return `${label}: (none)`;
        const flags = `bi=${!!card.battleIndestructible}, tempBi=${!!card.tempBattleIndestructible}, once=${!!card.battleIndestructibleOncePerTurn}, onceUsed=${!!card.battleIndestructibleOncePerTurnUsed}`;
        return `${label}: ${card.name} ATK:${card.atk} DEF:${card.def} ${flags}`;
      };
      console.debug(
        `[Battle] canDestroyByBattle check (${context}) | ${formatCard(
          attacker,
          "attacker"
        )} | ${formatCard(target, "target")}`
      );
    };

    if (target.position === "attack") {
      if (attacker.atk > target.atk) {
        const defender = target.owner === "player" ? this.player : this.bot;
        const damage = attacker.atk - target.atk;
        applyBattleDamage(
          defender,
          target,
          damage,
          defenderHealsOnBattleDamage
        );
        logBattleResult(
          `${attacker.name} destroyed ${target.name} and dealt ${damage} damage.`
        );

        logBattleDestroyCheck("attacker over atk target");
        if (this.canDestroyByBattle(target)) {
          const result = await this.destroyCard(target, {
            cause: "battle",
            sourceCard: attacker,
          });
          if (result?.destroyed) {
            const bdResult = await this.applyBattleDestroyEffect(
              attacker,
              target
            );
            if (bdResult) battleDestroyResults.push(bdResult);
          }
          if (result?.needsSelection) {
            this.markAttackUsed(attacker, target);
            this.clearAttackResolutionIndicators();
            this.updateBoard();
            return {
              ok: true,
              needsSelection: true,
              selectionContract: result.selectionContract,
            };
          }
        }
      } else if (attacker.atk < target.atk) {
        const attPlayer = attacker.owner === "player" ? this.player : this.bot;
        const damage = target.atk - attacker.atk;
        applyBattleDamage(
          attPlayer,
          attacker,
          damage,
          attackerHealsOnBattleDamage
        );
        logBattleResult(
          `${attacker.name} was destroyed by ${target.name} and took ${damage} damage.`
        );

        logBattleDestroyCheck("attacker loses to atk target");
        if (this.canDestroyByBattle(attacker)) {
          const result = await this.destroyCard(attacker, {
            cause: "battle",
            sourceCard: target,
          });
          if (result?.destroyed) {
            const bdResult = await this.applyBattleDestroyEffect(
              attacker,
              attacker
            );
            if (bdResult) battleDestroyResults.push(bdResult);
          }
          if (result?.needsSelection) {
            this.markAttackUsed(attacker, target);
            this.clearAttackResolutionIndicators();
            this.updateBoard();
            return {
              ok: true,
              needsSelection: true,
              selectionContract: result.selectionContract,
            };
          }
        }
      } else {
        // to allow each triggered effect to be resolved before the next
        logBattleDestroyCheck("tie - attacker destruction check");
        if (!skipAttackerDestruction && this.canDestroyByBattle(attacker)) {
          const result = await this.destroyCard(attacker, {
            cause: "battle",
            sourceCard: target,
          });
          if (result?.destroyed) {
            const bdResult = await this.applyBattleDestroyEffect(
              attacker,
              attacker
            );
            if (bdResult) battleDestroyResults.push(bdResult);
          }
          // we need to pause and let that resolve before destroying target
          if (result?.needsSelection) {
            // Store pending tie info so we can resume after selection
            this.pendingTieDestruction = {
              attacker,
              target,
              attackerHealsOnBattleDamage,
              defenderHealsOnBattleDamage,
            };
            this.markAttackUsed(attacker, target);
            this.clearAttackResolutionIndicators();
            this.updateBoard();
            return {
              ok: true,
              needsSelection: true,
              selectionContract: result.selectionContract,
              pendingTieDestruction: true,
            };
          }
        }

        logBattleDestroyCheck("tie - target destruction check");
        if (this.canDestroyByBattle(target)) {
          const result = await this.destroyCard(target, {
            cause: "battle",
            sourceCard: attacker,
          });
          if (result?.destroyed) {
            const bdResult = await this.applyBattleDestroyEffect(
              attacker,
              target
            );
            if (bdResult) battleDestroyResults.push(bdResult);
          }
          // If target destruction also needs selection, return it
          if (result?.needsSelection) {
            this.markAttackUsed(attacker, target);
            this.clearAttackResolutionIndicators();
            this.updateBoard();
            return {
              ok: true,
              needsSelection: true,
              selectionContract: result.selectionContract,
            };
          }
        }
        // Clear pending tie destruction if we completed successfully
        this.pendingTieDestruction = null;
        logBattleResult(
          `${attacker.name} and ${target.name} destroyed each other.`
        );
      }
    } else {
      const defender = target.owner === "player" ? this.player : this.bot;
      if (attacker.atk > target.def) {
        if (attacker.piercing) {
          const damage = attacker.atk - target.def;
          applyBattleDamage(
            defender,
            target,
            damage,
            defenderHealsOnBattleDamage
          );
          logBattleResult(
            `${attacker.name} pierced ${target.name} for ${damage} damage.`
          );
        }
        logBattleDestroyCheck("defense target destruction check");
        if (this.canDestroyByBattle(target)) {
          const result = await this.destroyCard(target, {
            cause: "battle",
            sourceCard: attacker,
          });
          if (result?.destroyed) {
            const bdResult = await this.applyBattleDestroyEffect(
              attacker,
              target
            );
            if (bdResult) battleDestroyResults.push(bdResult);
          }
          if (result?.needsSelection) {
            this.markAttackUsed(attacker, target);
            this.clearAttackResolutionIndicators();
            this.updateBoard();
            return {
              ok: true,
              needsSelection: true,
              selectionContract: result.selectionContract,
            };
          }
        }
        if (!attacker.piercing) {
          logBattleResult(`${attacker.name} destroyed ${target.name}.`);
        }
      } else if (attacker.atk < target.def) {
        const attPlayer = attacker.owner === "player" ? this.player : this.bot;
        const damage = target.def - attacker.atk;
        applyBattleDamage(
          attPlayer,
          attacker,
          damage,
          attackerHealsOnBattleDamage
        );
        logBattleResult(
          `${attacker.name} took ${damage} damage attacking ${target.name}.`
        );
      } else {
        logBattleResult(
          `${attacker.name} could not break ${target.name}'s defense.`
        );
      }
    }

    this.markAttackUsed(attacker, target);
    this.checkWinCondition();
    this.clearAttackResolutionIndicators();
    this.updateBoard();
    const pendingResult = battleDestroyResults.find(
      (r) => r?.needsSelection && r?.selectionContract
    );
    if (pendingResult) {
      return pendingResult;
    }

    return { ok: true };
  }

  performFusionSummon(
    materials,
    fusionMonsterIndex,
    position = "attack",
    requiredSubset = null,
    player = null
  ) {
    // Usa o jogador passado ou default para this.player
    const activePlayer = player || this.player;

    // Validate inputs
    if (!materials || materials.length === 0) {
      this.ui.log("No materials selected for Fusion Summon.");
      return false;
    }

    const fusionMonster = activePlayer.extraDeck[fusionMonsterIndex];
    if (!fusionMonster) {
      this.ui.log("Fusion Monster not found in Extra Deck.");
      return false;
    }

    // Check field space
    if (activePlayer.field.length >= 5) {
      this.ui.log("Field is full (max 5 monsters).");
      return false;
    }

    const requiredMaterials =
      requiredSubset && requiredSubset.length ? requiredSubset : materials;
    const requiredSet = new Set(requiredMaterials);
    const extraMaterials = materials.filter((mat) => !requiredSet.has(mat));

    // Send materials to GY
    materials.forEach((material) => {
      this.moveCard(material, activePlayer, "graveyard");
    });

    // Remove fusion monster from Extra Deck
    activePlayer.extraDeck.splice(fusionMonsterIndex, 1);

    // Add to field
    fusionMonster.position = position;
    fusionMonster.isFacedown = false;
    fusionMonster.hasAttacked = false;
    fusionMonster.cannotAttackThisTurn = false;
    fusionMonster.owner = activePlayer.id;
    fusionMonster.summonedTurn = this.turnCounter;
    activePlayer.field.push(fusionMonster);

    const requiredNames = requiredMaterials.map((c) => c.name).join(", ");
    const extraNames = extraMaterials.map((c) => c.name).join(", ");
    const extraNote =
      extraMaterials.length > 0
        ? ` Extra materials also sent to GY: ${extraNames}.`
        : "";

    this.ui.log(
      `Fusion Summoned ${fusionMonster.name} using ${
        requiredNames || "selected materials"
      }.${extraNote}`
    );

    // Emit after_summon event
    this.emit("after_summon", {
      card: fusionMonster,
      player: activePlayer,
      method: "fusion",
      fromZone: "extraDeck",
    });

    this.updateBoard();
    return true;
  }

  performSpecialSummon(handIndex, position) {
    const card = this.player.hand[handIndex];
    if (!card) return;

    // Remove from hand
    this.player.hand.splice(handIndex, 1);

    // Add to field
    const isFacedown = position === "defense";
    card.position = position;
    card.isFacedown = false;
    card.hasAttacked = false;
    card.cannotAttackThisTurn = true; // Cannot attack this turn (from Eel effect)
    card.owner = "player";
    this.player.field.push(card);

    this.ui.log(`Special Summoned ${card.name} from hand.`);

    // Clear pending special summon and unlock actions
    this.pendingSpecialSummon = null;
    this.isResolvingEffect = false;

    // Remove highlight from all hand cards
    if (this.ui && typeof this.ui.applyHandTargetableIndices === "function") {
      this.ui.applyHandTargetableIndices("player", []);
    }

    // Emit after_summon for special summons performed directly from hand
    this.emit("after_summon", {
      card,
      player: this.player,
      opponent: this.bot,
      method: "special",
      fromZone: "hand",
    });

    this.updateBoard();
  }

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

  cleanupTempBoosts(player) {
    player.field.forEach((card) => {
      if (card.tempAtkBoost) {
        card.atk -= card.tempAtkBoost;
        if (card.atk < 0) card.atk = 0;
        card.tempAtkBoost = 0;
      }
      if (card.tempDefBoost) {
        card.def -= card.tempDefBoost;
        if (card.def < 0) card.def = 0;
        card.tempDefBoost = 0;
      }

      // Restore stats if they were set to zero
      if (card.originalAtk != null) {
        card.atk = card.originalAtk;
        card.originalAtk = null;
      }
      if (card.originalDef != null) {
        card.def = card.originalDef;
        card.originalDef = null;
      }

      // Remove effect negation
      card.effectsNegated = false;

      card.tempBattleIndestructible = false;
      card.battleDamageHealsControllerThisTurn = false;
      card.canAttackDirectlyThisTurn = false;

      // Reset multi-attack flags
      delete card.canAttackAllOpponentMonstersThisTurn;
      delete card.attackedMonstersThisTurn;
    });
  }

  /**
   * Cleanup references that might point to a token being removed from the game.
   * Called when a token leaves the field (tokens cannot exist outside the field).
   * This prevents stale pointers from equips, Call of the Haunted, etc.
   * Also sends attached equip spells to the graveyard (same as regular monster cleanup).
   */
  cleanupTokenReferences(token, tokenOwner) {
    if (!token) return;

    // Find and process equip spells attached to this token (same logic as monster cleanup)
    const equipZone = this.getZone(tokenOwner, "spellTrap") || [];
    const attachedEquips = equipZone.filter(
      (eq) =>
        eq &&
        eq.cardKind === "spell" &&
        eq.subtype === "equip" &&
        (eq.equippedTo === token || eq.equipTarget === token)
    );

    // Process equips: clear refs and send to GY
    for (const equip of attachedEquips) {
      // Clear equip references
      if (equip.equippedTo === token) {
        equip.equippedTo = null;
      }
      if (equip.equipTarget === token) {
        equip.equipTarget = null;
      }
      // Reset equip bonuses (they were applied to the token which is being removed)
      equip.equipAtkBonus = 0;
      equip.equipDefBonus = 0;
      equip.equipExtraAttacks = 0;
      equip.grantsBattleIndestructible = false;
      equip.grantsCrescentShieldGuard = false;

      // Move equip to graveyard - refs already cleared, so equip's cleanup block will be skipped
      this.moveCard(equip, tokenOwner, "graveyard", {
        fromZone: "spellTrap",
      });
    }

    // Clear the token's equips array
    if (Array.isArray(token.equips)) {
      token.equips = [];
    }

    // If this token was revived by Call of the Haunted, clear that reference
    // and destroy the trap
    if (token.callOfTheHauntedTrap) {
      const trap = token.callOfTheHauntedTrap;
      if (trap.callOfTheHauntedTarget === token) {
        trap.callOfTheHauntedTarget = null;
      }
      token.callOfTheHauntedTrap = null;

      // Destroy the Call of the Haunted trap (fire-and-forget, ref already cleared)
      this.destroyCard(trap, {
        cause: "effect",
        sourceCard: token,
        opponent: this.getOpponent(tokenOwner),
      }).then((result) => {
        if (result?.destroyed) {
          this.ui.log(
            `${trap.name} was destroyed as ${token.name} (Token) was removed from the game.`
          );
          this.updateBoard();
        }
      });
    }

    // If this token is equipped to something (unlikely but possible), clean up
    if (token.equippedTo) {
      const host = token.equippedTo;
      if (Array.isArray(host.equips)) {
        const idx = host.equips.indexOf(token);
        if (idx > -1) host.equips.splice(idx, 1);
      }
      token.equippedTo = null;
    }
    if (token.equipTarget) {
      token.equipTarget = null;
    }

    // Clear any passive buff tracking
    this.effectEngine?.clearPassiveBuffsForCard(token);

    // Clear temporary stat modifiers
    token.tempAtkBoost = 0;
    token.tempDefBoost = 0;
    delete token.permanentBuffsBySource;
  }

  getZone(player, zone) {
    switch (zone) {
      case "hand":
        return player.hand;
      case "deck":
        return player.deck;
      case "extraDeck":
        return player.extraDeck;
      case "spellTrap":
        return player.spellTrap;
      case "graveyard":
        return player.graveyard;
      case "fieldSpell":
        return player.fieldSpell ? [player.fieldSpell] : [];
      case "field":
      default:
        return player.field;
    }
  }

  moveCard(card, destPlayer, toZone, options = {}) {
    return this.runZoneOp(
      "MOVE_CARD",
      () => this.moveCardInternal(card, destPlayer, toZone, options),
      {
        contextLabel: options.contextLabel || "moveCard",
        card,
        fromZone: options.fromZone,
        toZone,
      }
    );
  }

  async moveCardInternal(card, destPlayer, toZone, options = {}) {
    if (!card || !destPlayer || !toZone) {
      return { success: false, reason: "invalid_args" };
    }

    const destArr = this.getZone(destPlayer, toZone);
    if (!destArr) {
      console.warn("moveCard: destination zone not found", toZone);
      return { success: false, reason: "invalid_zone" };
    }

    if (toZone === "field" && destArr.length >= 5) {
      this.ui.log("Field is full (max 5 cards).");
      return { success: false, reason: "field_full" };
    }
    if (toZone === "spellTrap" && destArr.length >= 5) {
      this.ui.log("Spell/Trap zone is full (max 5 cards).");
      return { success: false, reason: "spell_trap_full" };
    }

    const zones = [
      "field",
      "hand",
      "deck",
      "graveyard",
      "spellTrap",
      "fieldSpell",
      "extraDeck",
    ];
    let fromOwner = null;
    let fromZone = null;

    const removeFromZone = (owner, zoneName) => {
      if (!owner) return false;
      if (zoneName === "fieldSpell") {
        if (owner.fieldSpell === card) {
          owner.fieldSpell = null;
          return true;
        }
        return false;
      }
      const arr = this.getZone(owner, zoneName) || [];
      let removed = false;
      for (let i = arr.length - 1; i >= 0; i -= 1) {
        if (arr[i] === card) {
          arr.splice(i, 1);
          removed = true;
          break; // Remove only the first occurrence found (iterating backwards)
        }
      }
      return removed;
    };

    const locateAndRemove = (preferredZone = null) => {
      const players = [this.player, this.bot];
      const markFrom = (owner, zoneName) => {
        if (!fromOwner && !fromZone) {
          fromOwner = owner;
          fromZone = zoneName;
        }
      };
      let removedAny = false;
      if (preferredZone) {
        for (const player of players) {
          if (removeFromZone(player, preferredZone)) {
            removedAny = true;
            markFrom(player, preferredZone);
          }
        }
      }

      for (const player of players) {
        for (const zoneName of zones) {
          if (zoneName === preferredZone) continue;
          if (removeFromZone(player, zoneName)) {
            removedAny = true;
            markFrom(player, zoneName);
          }
        }
      }
      return removedAny;
    };

    locateAndRemove(options.fromZone || null);

    if (!fromZone || !fromOwner) {
      return { success: false, reason: "card_not_found" };
    }

    // TOKEN RULE: Tokens cannot exist outside the field.
    // If a token is leaving the field to any other zone, remove it from the game entirely.
    // This handles: destruction, bounce to hand, banish, shuffle to deck, tribute, etc.
    if (card.isToken === true && fromZone === "field" && toZone !== "field") {
      // Clean up any references that might point to this token
      this.cleanupTokenReferences(card, fromOwner);

      // Log the removal
      this.ui.log(`${card.name} (Token) was removed from the game.`);

      // Update board to reflect removal
      this.updateBoard();

      // Return success with tokenRemoved flag - token is NOT added to any zone
      return { success: true, tokenRemoved: true, fromZone, toZone: null };
    }

    if (card.owner !== fromOwner.id) {
      card.owner = fromOwner.id;
    }

    if (fromZone === "field" && card.cardKind === "monster") {
      card.summonedTurn = null;
      card.setTurn = null;
      card.positionChangedThisTurn = false;
      card.cannotAttackThisTurn = false;
      card.cannotAttackUntilTurn = null;
      card.immuneToOpponentEffectsUntilTurn = null;

      // Clean up temporary stat modifiers from effects (e.g., Shadow-Heart Coward debuff)
      if (card.tempAtkBoost) {
        card.atk -= card.tempAtkBoost;
        if (card.atk < 0) card.atk = 0;
        card.tempAtkBoost = 0;
      }
      if (card.tempDefBoost) {
        card.def -= card.tempDefBoost;
        if (card.def < 0) card.def = 0;
        card.tempDefBoost = 0;
      }

      // Remove permanent named buffs when the monster leaves the field
      if (toZone !== "field" && card.permanentBuffsBySource) {
        let totalAtkBuff = 0;
        let totalDefBuff = 0;
        Object.values(card.permanentBuffsBySource).forEach((buff) => {
          if (buff?.atk) totalAtkBuff += buff.atk;
          if (buff?.def) totalDefBuff += buff.def;
        });
        if (totalAtkBuff) {
          card.atk -= totalAtkBuff;
          if (card.atk < 0) card.atk = 0;
        }
        if (totalDefBuff) {
          card.def -= totalDefBuff;
          if (card.def < 0) card.def = 0;
        }
        delete card.permanentBuffsBySource;
      }
      this.effectEngine?.clearPassiveBuffsForCard(card);

      // Clear field presence ID for field_presence_type_summon_count_buff tracking
      // This resets the counter when the card leaves the field
      if (toZone !== "field") {
        if (
          this.effectEngine &&
          typeof this.effectEngine.clearFieldPresenceId === "function"
        ) {
          this.effectEngine.clearFieldPresenceId(card);
        }

        // ✅ Clear protection effects when card leaves field (duration "while_faceup")
        if (Array.isArray(card.protectionEffects)) {
          card.protectionEffects = card.protectionEffects.filter(
            (p) => p.duration !== "while_faceup"
          );
        }
      }
    }

    // Se um equip spell está saindo da spell/trap zone, limpar seus efeitos no monstro
    // NOTE: This block only runs if equippedTo is still set (not already cleaned by host's cleanup)
    if (
      fromZone === "spellTrap" &&
      card.cardKind === "spell" &&
      card.subtype === "equip" &&
      card.equippedTo
    ) {
      const host = card.equippedTo;

      // Clear equip reference immediately to prevent stale pointers
      card.equippedTo = null;

      // Also clear equipTarget if it points to the same host
      if (card.equipTarget === host) {
        card.equipTarget = null;
      }

      // Remove from host's equips array
      if (host && Array.isArray(host.equips)) {
        const idxEquip = host.equips.indexOf(card);
        if (idxEquip > -1) {
          host.equips.splice(idxEquip, 1);
        }
      }

      // Remove stat bonuses (clamp to 0 to prevent negative stats)
      if (host) {
        if (
          typeof card.equipAtkBonus === "number" &&
          card.equipAtkBonus !== 0
        ) {
          host.atk = Math.max(0, (host.atk || 0) - card.equipAtkBonus);
          card.equipAtkBonus = 0;
        }

        if (
          typeof card.equipDefBonus === "number" &&
          card.equipDefBonus !== 0
        ) {
          host.def = Math.max(0, (host.def || 0) - card.equipDefBonus);
          card.equipDefBonus = 0;
        }

        if (
          typeof card.equipExtraAttacks === "number" &&
          card.equipExtraAttacks !== 0
        ) {
          const currentExtra = host.extraAttacks || 0;
          const nextExtra = currentExtra - card.equipExtraAttacks;
          host.extraAttacks = Math.max(0, nextExtra);
          card.equipExtraAttacks = 0;
        }

        const maxAttacksAfterEquipChange = 1 + (host.extraAttacks || 0);
        host.hasAttacked =
          (host.attacksUsedThisTurn || 0) >= maxAttacksAfterEquipChange;

        if (card.grantsBattleIndestructible) {
          host.battleIndestructible = false;
          card.grantsBattleIndestructible = false;
        }

        if (card.grantsCrescentShieldGuard) {
          card.grantsCrescentShieldGuard = false;
        }
      }

      // Special case: "The Shadow Heart" - if it leaves the field, destroy the equipped monster
      // Process this AFTER removing bonuses to ensure clean state
      // State is already consistent (refs cleared, bonuses removed), so destroy result doesn't affect cleanup
      if (card.name === "The Shadow Heart" && host) {
        const hostOwner = host.owner === "player" ? this.player : this.bot;
        this.destroyCard(host, {
          cause: "effect",
          sourceCard: card,
          opponent: this.getOpponent(hostOwner),
        }).then((result) => {
          if (result?.destroyed) {
            this.ui.log(
              `${host.name} is destroyed as ${card.name} left the field.`
            );
            this.updateBoard();
          }
        });
      }
    }

    if (toZone === "fieldSpell") {
      if (destPlayer.fieldSpell) {
        this.moveCard(destPlayer.fieldSpell, destPlayer, "graveyard", {
          fromZone: "fieldSpell",
        });
      }

      if (options.position) {
        card.position = options.position;
      }
      if (typeof options.isFacedown === "boolean") {
        card.isFacedown = options.isFacedown;
      }

      card.owner = destPlayer.id;
      card.controller = destPlayer.id;
      destPlayer.fieldSpell = card;
      if (this.devModeEnabled && this.devFailAfterZoneMutation) {
        this.devFailAfterZoneMutation = false;
        throw new Error("DEV_ZONE_MUTATION_FAIL");
      }
      return { success: true, fromZone, toZone };
    }

    // STATE-BASED CLEANUP: If a monster leaves the field to ANY other zone,
    // send attached equip spells to the graveyard (state-based rule).
    if (
      fromZone === "field" &&
      toZone !== "field" &&
      card.cardKind === "monster"
    ) {
      const equipZone = this.getZone(fromOwner, "spellTrap") || [];
      const attachedEquips = equipZone.filter(
        (eq) =>
          eq &&
          eq.cardKind === "spell" &&
          eq.subtype === "equip" &&
          (eq.equippedTo === card || eq.equipTarget === card)
      );

      // Process equips synchronously to ensure deterministic state
      // IMPORTANT: Remove bonuses and clear refs BEFORE moving equips to GY
      // This prevents the equip's own moveCard path from trying to cleanup again
      for (const equip of attachedEquips) {
        // Remove bonuses from host (with clamp) - do this BEFORE clearing refs
        if (
          typeof equip.equipAtkBonus === "number" &&
          equip.equipAtkBonus !== 0
        ) {
          card.atk = Math.max(0, (card.atk || 0) - equip.equipAtkBonus);
          equip.equipAtkBonus = 0;
        }
        if (
          typeof equip.equipDefBonus === "number" &&
          equip.equipDefBonus !== 0
        ) {
          card.def = Math.max(0, (card.def || 0) - equip.equipDefBonus);
          equip.equipDefBonus = 0;
        }
        if (
          typeof equip.equipExtraAttacks === "number" &&
          equip.equipExtraAttacks !== 0
        ) {
          const currentExtra = card.extraAttacks || 0;
          card.extraAttacks = Math.max(
            0,
            currentExtra - equip.equipExtraAttacks
          );
          equip.equipExtraAttacks = 0;
        }
        if (equip.grantsBattleIndestructible) {
          card.battleIndestructible = false;
          equip.grantsBattleIndestructible = false;
        }
        if (equip.grantsCrescentShieldGuard) {
          equip.grantsCrescentShieldGuard = false;
        }

        // Remove from host's equips array
        if (Array.isArray(card.equips)) {
          const idx = card.equips.indexOf(equip);
          if (idx > -1) card.equips.splice(idx, 1);
        }

        // Clear equip references AFTER removing bonuses
        if (equip.equippedTo === card) {
          equip.equippedTo = null;
        }
        if (equip.equipTarget === card) {
          equip.equipTarget = null;
        }

        // Move equip to graveyard - refs already cleared, so equip's cleanup block will be skipped
        this.moveCard(equip, fromOwner, "graveyard", {
          fromZone: "spellTrap",
        });
      }

      // Se o monstro foi revivido por Call of the Haunted, destruir a trap também
      if (card.callOfTheHauntedTrap) {
        const callTrap = card.callOfTheHauntedTrap;
        card.callOfTheHauntedTrap = null; // Clear reference before destroy

        // Destroy trap - refs already cleared, state is consistent regardless of result
        this.destroyCard(callTrap, {
          cause: "effect",
          sourceCard: card,
          opponent: this.getOpponent(fromOwner),
        }).then((result) => {
          if (result?.destroyed) {
            this.ui.log(
              `${callTrap.name} was destroyed as ${card.name} left the field.`
            );
            this.updateBoard();
          }
        });
      }
    }

    // Se Call of the Haunted sai do campo (para qualquer destino), destruir o monstro revivido
    // Generalized: trap leaving spellTrap to ANY zone triggers cleanup (consistent with equip rules)
    if (
      fromZone === "spellTrap" &&
      toZone !== "spellTrap" &&
      card.cardKind === "trap" &&
      card.subtype === "continuous" &&
      card.name === "Call of the Haunted" &&
      card.callOfTheHauntedTarget
    ) {
      const revivedMonster = card.callOfTheHauntedTarget;
      card.callOfTheHauntedTarget = null; // Clear reference BEFORE destroy - state is consistent

      const monsterOwner =
        revivedMonster.owner === "player" ? this.player : this.bot;
      // Destroy is fire-and-forget but safe - ref already cleared, state is consistent
      this.destroyCard(revivedMonster, {
        cause: "effect",
        sourceCard: card,
        opponent: this.getOpponent(monsterOwner),
      }).then((result) => {
        if (result?.destroyed) {
          this.ui.log(
            `${revivedMonster.name} was destroyed as ${card.name} left the field.`
          );
          this.updateBoard();
        }
      });
    }

    if (options.position) {
      card.position = options.position;
    }
    if (typeof options.isFacedown === "boolean") {
      card.isFacedown = options.isFacedown;
    }
    if (options.resetAttackFlags) {
      card.hasAttacked = false;
      card.cannotAttackThisTurn = false;
      card.attacksUsedThisTurn = 0;
      card.canMakeSecondAttackThisTurn = false;
      card.secondAttackUsedThisTurn = false;
    }

    card.owner = destPlayer.id;
    card.controller = destPlayer.id;

    // Special case: Extra Deck monsters returning to hand go back to Extra Deck instead
    if (
      toZone === "hand" &&
      (card.monsterType === "fusion" || card.monsterType === "ascension")
    ) {
      const extraDeck = this.getZone(destPlayer, "extraDeck");
      if (extraDeck) {
        extraDeck.push(card);
        this.ui.log(`${card.name} returned to Extra Deck.`);
        if (this.devModeEnabled && this.devFailAfterZoneMutation) {
          this.devFailAfterZoneMutation = false;
          throw new Error("DEV_ZONE_MUTATION_FAIL");
        }
        return { success: true, fromZone, toZone: "extraDeck" };
      }
    }

    destArr.push(card);

    if (this.devModeEnabled && this.devFailAfterZoneMutation) {
      this.devFailAfterZoneMutation = false;
      throw new Error("DEV_ZONE_MUTATION_FAIL");
    }

    if (
      toZone === "field" &&
      card.cardKind === "monster" &&
      fromZone !== "field"
    ) {
      card.enteredFieldTurn = this.turnCounter;
      card.summonedTurn = this.turnCounter;
      card.positionChangedThisTurn = false;
      if (card.isFacedown) {
        card.setTurn = this.turnCounter;
      } else {
        card.setTurn = null;
      }

      // Assign field presence ID for field_presence_type_summon_count_buff tracking
      if (
        this.effectEngine &&
        typeof this.effectEngine.assignFieldPresenceId === "function"
      ) {
        this.effectEngine.assignFieldPresenceId(card);
      }

      const ownerPlayer = card.owner === "player" ? this.player : this.bot;
      const otherPlayer = ownerPlayer === this.player ? this.bot : this.player;
      const summonMethod = options.summonMethodOverride || "special";
      void this.emit("after_summon", {
        card,
        player: ownerPlayer,
        opponent: otherPlayer,
        method: summonMethod,
        fromZone,
      });
    }

    if (toZone === "graveyard") {
      // Don't emit card_to_grave if the card is already in graveyard (moving within same zone)
      // This prevents infinite loops where effects like Specter trigger repeatedly
      if (fromZone === "graveyard") {
        return { success: true, fromZone, toZone };
      }

      const ownerPlayer = card.owner === "player" ? this.player : this.bot;
      const otherPlayer = ownerPlayer === this.player ? this.bot : this.player;

      console.log(
        `[moveCard] Emitting card_to_grave event for ${card.name} (fromZone: ${fromZone})`
      );
      void this.emit("card_to_grave", {
        card,
        fromZone: fromZone || options.fromZone || null,
        toZone: "graveyard",
        player: ownerPlayer,
        opponent: otherPlayer,
        wasDestroyed: options.wasDestroyed || false,
        destroyCause: options.destroyCause || null,
      });
    }

    return { success: true, fromZone, toZone };
  }

  async applyBattleDestroyEffect(attacker, destroyed) {
    // Legacy: onBattleDestroy direct damage effects tied to the attacker
    if (
      attacker &&
      attacker.onBattleDestroy &&
      attacker.onBattleDestroy.damage
    ) {
      const defender = attacker.owner === "player" ? this.bot : this.player;
      this.inflictDamage(defender, attacker.onBattleDestroy.damage, {
        sourceCard: attacker,
        cause: "effect",
      });
      this.ui.log(
        `${attacker.name} inflicts an extra ${attacker.onBattleDestroy.damage} damage!`
      );
      this.checkWinCondition();
      this.updateBoard();
    }

    // New: global battle_destroy event for cards like Shadow-Heart Gecko
    if (!destroyed) {
      return { ok: true };
    }

    const destroyedOwner =
      destroyed.owner === "player" ? this.player : this.bot;
    const attackerOwner = attacker.owner === "player" ? this.player : this.bot;

    const emitResult = await this.emit("battle_destroy", {
      player: attackerOwner, // o dono do atacante (quem causou a destruição)
      opponent: destroyedOwner, // o jogador que perdeu o monstro
      attacker,
      destroyed,
      attackerOwner,
      destroyedOwner,
    });

    return emitResult || { ok: true };
  }

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
