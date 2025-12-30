import Game from "../core/Game.js";
import {
  ACTION_TYPES,
  CLIENT_MESSAGE_TYPES,
  SERVER_MESSAGE_TYPES,
  validateActionPayload,
} from "./MessageProtocol.js";

function send(ws, payload) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function serverRendererStub() {
  const noop = () => {};
  return {
    log: noop,
    renderHand: noop,
    renderField: noop,
    renderFieldSpell: noop,
    renderSpellTrap: noop,
    updateLP: noop,
    updatePhaseTrack: noop,
    updateTurn: noop,
    updateGYPreview: noop,
    updateExtraDeckPreview: noop,
    highlightTargetCandidates: noop,
    clearAttackIndicators: noop,
    clearAttackHighlights: noop,
    setPlayerFieldTributeable: noop,
  };
}

export class MatchManager {
  constructor() {
    this.rooms = new Map();
    this.promptCounter = 0;
    this.clientCounter = 0;
  }

  attachConnection(ws) {
    const client = {
      id: `c_${Date.now()}_${++this.clientCounter}`,
      ws,
      roomId: null,
      seat: null, // "player" | "bot"
      ready: false,
      lastSeq: 0,
      name: null,
    };

    ws.on("message", (data) => this.handleMessage(client, data));
    ws.on("close", () => this.handleDisconnect(client));
    ws.on("error", () => this.handleDisconnect(client));
  }

  async handleMessage(client, raw) {
    const msg = this.safeParse(raw);
    if (!msg || typeof msg.type !== "string") {
      this.sendError(client, "Invalid message");
      return;
    }

    switch (msg.type) {
      case CLIENT_MESSAGE_TYPES.JOIN_ROOM:
        this.handleJoin(client, msg);
        break;
      case CLIENT_MESSAGE_TYPES.READY:
        this.handleReady(client);
        break;
      case CLIENT_MESSAGE_TYPES.ACTION:
        await this.handleAction(client, msg);
        break;
      case CLIENT_MESSAGE_TYPES.INTENT_CARD_CLICK:
        await this.handleIntent(client, msg);
        break;
      case CLIENT_MESSAGE_TYPES.PROMPT_RESPONSE:
        await this.handlePromptResponse(client, msg);
        break;
      case CLIENT_MESSAGE_TYPES.REMATCH_REQUEST:
        await this.handleRematchRequest(client);
        break;
      default:
        this.sendError(client, "Unknown message type");
    }
  }

  buildActionContext(room, seat) {
    const client = room?.clients?.[seat] || null;
    const manager = this;
    return {
      roomId: room?.id || null,
      seat,
      clientId: client?.id || null,
      sendPrompt(prompt, extra = {}) {
        if (!room || !client) return;
        manager.storeAndSendPrompt(room, client, prompt, extra);
      },
      sendError(message, code = "error", hint = null) {
        if (!client) return;
        manager.sendError(client, message, code, hint);
      },
      broadcastState(reason = "action_context_broadcast") {
        if (!room) return;
        manager.commitStateUpdate(room, reason);
      },
    };
  }

  safeParse(raw) {
    try {
      return JSON.parse(raw.toString());
    } catch (err) {
      return null;
    }
  }

  handleJoin(client, msg) {
    const roomId = typeof msg.roomId === "string" ? msg.roomId : "default";
    const name = typeof msg.playerName === "string" ? msg.playerName : null;
    let room = this.rooms.get(roomId);
    if (!room) {
      room = this.createRoom(roomId);
      this.rooms.set(roomId, room);
    }

    if (client.roomId && client.roomId !== roomId) {
      this.sendError(client, "Already joined a room");
      return;
    }

    let seat = null;
    if (!room.clients.player) {
      seat = "player";
    } else if (!room.clients.bot) {
      seat = "bot";
    } else {
      this.sendError(client, "Room full", "room_full");
      return;
    }

    client.roomId = roomId;
    client.seat = seat;
    client.name = name;
    client.ready = false;
    room.clients[seat] = client;

    send(client.ws, {
      type: SERVER_MESSAGE_TYPES.MATCH_START,
      youAre: seat,
      roomId,
    });
  }

  handleReady(client) {
    const room = this.getRoom(client);
    if (!room) return;
    client.ready = true;
    console.log("[Server] ready received", {
      seat: client.seat,
      room: room.id,
      playerReady: room.clients.player?.ready,
      botReady: room.clients.bot?.ready,
    });
    if (room.clients.player?.ready && room.clients.bot?.ready && !room.game) {
      this.startMatch(room);
    }
  }

  async startMatch(room) {
    console.log("[Server] startMatch", { room: room.id });
    const renderer = serverRendererStub();
    const game = new Game({
      networkMode: true,
      disableChains: true,
      disableTraps: true,
      disableEffectActivation: false,
      renderer,
    });
    game.phaseDelayMs = 0;
    // Apply names if provided
    if (room.clients.player?.name) {
      game.player.name = room.clients.player.name;
    }
    if (room.clients.bot?.name) {
      game.bot.name = room.clients.bot.name;
    }

    // Initialize decks and draw opening hands (mirrors start() without UI bindings)
    game.player.oncePerDuelUsageByName = Object.create(null);
    game.bot.oncePerDuelUsageByName = Object.create(null);
    game.resetMaterialDuelStats?.("start");
    game.player.buildDeck();
    game.player.buildExtraDeck();
    game.bot.buildDeck();
    game.bot.buildExtraDeck();
    game.drawCards(game.player, 4);
    game.drawCards(game.bot, 4);
    game.turn = "player";
    await game.startTurn();

    room.game = game;

    // Escutar evento de fim de partida
    game.on("game_over", (payload) => {
      this.handleGameOver(room, payload);
    });

    // INVARIANTE A: Escutar mudanças de estado do Game para sincronizar clientes
    // Isso captura transições automáticas de fase (draw -> standby -> main1)
    game.on("state_changed", (payload) => {
      // Debounce: só emitir se não estiver em resolução de efeito
      // Isso evita spam durante múltiplos updateBoard() seguidos
      if (!room.isResolvingEffect) {
        this.commitStateUpdate(room, `state_changed:${payload.phase}`);
      }
    });

    this.commitStateUpdate(room, "match_start");
  }

  handleGameOver(room, payload) {
    if (!room || room.gameEnded) return;
    room.gameEnded = true;

    const { winnerId, loserId, reason } = payload;
    console.log("[Server] game_over", {
      room: room.id,
      winnerId,
      loserId,
      reason,
    });

    // Mapear seat para resultado
    const playerSeat = "player";
    const botSeat = "bot";

    const resultForSeat = (seat) => {
      const isWinner =
        (seat === playerSeat && winnerId === "player") ||
        (seat === botSeat && winnerId === "bot");
      return {
        type: SERVER_MESSAGE_TYPES.GAME_OVER,
        result: isWinner ? "victory" : "defeat",
        reason,
        winnerId,
        loserId,
      };
    };

    if (room.clients.player?.ws) {
      send(room.clients.player.ws, resultForSeat(playerSeat));
    }
    if (room.clients.bot?.ws) {
      send(room.clients.bot.ws, resultForSeat(botSeat));
    }

    // Enviar estado final também
    this.commitStateUpdate(room, "game_over");
  }

  async handleRematchRequest(client) {
    const room = this.getRoom(client);
    if (!room) {
      this.sendError(client, "Not in a room");
      return;
    }
    if (!room.gameEnded) {
      this.sendError(client, "Game not ended yet");
      return;
    }

    // Marcar que este cliente quer rematch
    if (!room.rematchRequests) {
      room.rematchRequests = new Set();
    }
    room.rematchRequests.add(client.seat);

    console.log("[Server] rematch_request", {
      room: room.id,
      seat: client.seat,
      requests: Array.from(room.rematchRequests),
    });

    // Notificar ambos sobre o status do rematch
    const status = {
      type: SERVER_MESSAGE_TYPES.REMATCH_STATUS,
      playerWants: room.rematchRequests.has("player"),
      botWants: room.rematchRequests.has("bot"),
      ready: room.rematchRequests.size >= 2,
    };

    if (room.clients.player?.ws) {
      send(room.clients.player.ws, status);
    }
    if (room.clients.bot?.ws) {
      send(room.clients.bot.ws, status);
    }

    // Se ambos querem rematch, reiniciar
    if (room.rematchRequests.has("player") && room.rematchRequests.has("bot")) {
      await this.restartMatch(room);
    }
  }

  async restartMatch(room) {
    console.log("[Server] restartMatch", { room: room.id });

    // Limpar estado anterior
    room.game = null;
    room.gameEnded = false;
    room.rematchRequests = null;
    room.prompts.clear();
    // A1: Limpar prompts per-seat
    room.pendingPromptsBySeat = {
      player: null,
      bot: null,
    };

    // Reiniciar partida
    await this.startMatch(room);
  }

  async handleIntent(client, msg) {
    const room = this.getRoom(client);
    if (!room || !room.game) {
      this.sendError(client, "Match not ready");
      return;
    }

    const seat = client?.seat;
    if (!seat) {
      this.sendError(client, "Client has no seat", "invalid_action");
      return;
    }

    // A2: Input lock - bloquear card clicks se houver prompt pendente
    const pendingPrompt = room.pendingPromptsBySeat[seat];
    if (pendingPrompt) {
      console.warn("[Server] intent blocked - pending prompt", {
        seat,
        promptId: pendingPrompt.promptId,
        promptType: pendingPrompt.prompt?.type,
      });
      this.sendError(client, "Please respond to the current prompt first", "input_locked");
      return;
    }

    console.log("[Server] intent_card_click", {
      seat: client.seat,
      zone: msg.zone,
      index: msg.index,
    });
    const prompt = this.buildCardActionMenu(room, client, {
      zone: msg.zone,
      index: msg.index,
    });
    if (!prompt) {
      this.sendError(client, "No actions available", "action_rejected");
      return;
    }
    this.storeAndSendPrompt(room, client, prompt);
  }

  /**
   * INVARIANTE C2: Todo prompt tem timeout para evitar soft-lock
   * A1: Armazena prompt POR SEAT e inclui stateVersion (A3)
   * Armazena prompt e inicia timer de 30s para auto-cancel
   */
  storeAndSendPrompt(room, client, prompt, extra = {}) {
    if (!prompt?.promptId) return;

    const seat = client?.seat;
    if (!seat) {
      console.warn("[Server] storeAndSendPrompt: client has no seat");
      return;
    }

    // A1: Verificar se já existe prompt pendente para este seat
    const existingPrompt = room.pendingPromptsBySeat[seat];
    if (existingPrompt) {
      console.warn("[Server] storeAndSendPrompt: overwriting pending prompt for seat", {
        seat,
        oldPromptId: existingPrompt.promptId,
        newPromptId: prompt.promptId,
      });
      // Cancelar timeout anterior se existir
      if (existingPrompt.timeoutId) {
        clearTimeout(existingPrompt.timeoutId);
      }
    }

    // Também limpar da estrutura antiga (compatibilidade)
    const existingEntry = room.prompts.get(prompt.promptId);
    if (existingEntry?.timeoutId) {
      clearTimeout(existingEntry.timeoutId);
    }

    // Configurar timeout de 30s
    const PROMPT_TIMEOUT_MS = 30000;
    const timeoutId = setTimeout(() => {
      this.handlePromptTimeout(room, client, prompt.promptId);
    }, PROMPT_TIMEOUT_MS);

    // A3: Adicionar stateVersion ao prompt
    const stateVersion = room.stateVersion || 0;
    const enrichedPrompt = {
      ...prompt,
      stateVersion,
    };

    const promptEntry = {
      client,
      prompt: enrichedPrompt,
      promptId: prompt.promptId,
      seat,
      timeoutId,
      createdAt: Date.now(),
      stateVersion,
      ...extra,
    };

    // A1: Armazenar por seat
    room.pendingPromptsBySeat[seat] = promptEntry;

    // Manter compatibilidade com estrutura antiga
    room.prompts.set(prompt.promptId, promptEntry);
    room.pendingPromptType = prompt.type;

    console.log("[Server] send prompt", {
      seat: client.seat,
      promptId: prompt.promptId,
      type: prompt.type,
      stateVersion,
      timeoutMs: PROMPT_TIMEOUT_MS,
    });
    send(client.ws, {
      type: SERVER_MESSAGE_TYPES.PROMPT_REQUEST,
      prompt: enrichedPrompt,
    });
  }

  /**
   * INVARIANTE C2: Handler de timeout de prompt
   * A1: Limpa prompt do seat específico
   * Auto-cancela prompt após 30s para evitar soft-lock
   */
  handlePromptTimeout(room, client, promptId) {
    const seat = client?.seat;
    const promptEntry = room.prompts.get(promptId);
    if (!promptEntry) return; // Já foi respondido

    console.warn("[Server] prompt timeout", {
      promptId,
      type: promptEntry.prompt?.type,
      seat: seat || client?.seat,
    });

    // A1: Remover prompt do seat específico
    if (seat && room.pendingPromptsBySeat[seat]?.promptId === promptId) {
      room.pendingPromptsBySeat[seat] = null;
    }

    // Remover da estrutura antiga também
    room.prompts.delete(promptId);
    room.pendingPromptType = null;

    // Limpar estado de seleção se existir
    if (room.game) {
      if (typeof room.game.cancelTargetSelection === "function") {
        room.game.cancelTargetSelection();
      }
      if (room.game.selectionState) {
        room.game.selectionState = "idle";
      }
      room.game.targetSelection = null;
      room.game.isResolvingEffect = false;
      room.game.inputLocked = false;
    }
    room.isResolvingEffect = false;

    // Notificar cliente
    this.sendError(client, "Prompt timed out", "prompt_timeout");
    this.commitStateUpdate(room, "prompt_timeout_cancelled");
  }

  buildCardActionMenu(room, client, intent) {
    const game = room.game;
    const actor = client.seat === "bot" ? game.bot : game.player;
    const options = [];
    const promptId = `p_${room.id}_${++this.promptCounter}`;

    const isYourTurn = game.turn === actor.id;
    const inMain = game.phase === "main1" || game.phase === "main2";
    const inBattle = game.phase === "battle";

    const addOption = (id, label, actionType, payload, extra = {}) => {
      options.push({
        id,
        label,
        actionType,
        payload,
        ...extra,
      });
    };

    const zone = intent.zone;
    const idx = intent.index;

    if (zone === "hand") {
      const card = actor.hand?.[idx];
      if (!card) return null;
      const name = card.name || "Card";
      if (isYourTurn && inMain && card.cardKind === "monster") {
        addOption(
          "normal_summon",
          "Normal Summon",
          ACTION_TYPES.NORMAL_SUMMON,
          { handIndex: idx, position: "attack" }
        );
        addOption("set_monster", "Set", ACTION_TYPES.SET_MONSTER, {
          handIndex: idx,
        });
      }
      if (
        isYourTurn &&
        inMain &&
        (card.cardKind === "spell" || card.cardKind === "trap")
      ) {
        addOption(
          "set_spelltrap",
          "Set Spell/Trap",
          ACTION_TYPES.SET_SPELLTRAP,
          {
            handIndex: idx,
          }
        );
        const canActivate =
          game.effectEngine?.canActivateSpellFromHandPreview?.(card, actor)
            ?.ok === true;
        if (canActivate) {
          addOption("activate_spell", "Activate", ACTION_TYPES.ACTIVATE_SPELL, {
            handIndex: idx,
          });
        }
      }
      addOption("cancel", "Cancel", null, null);
      if (!options.length) return null;
      return {
        type: "card_action_menu",
        promptId,
        title: name,
        zone,
        index: idx,
        options,
        // Card data for visual rendering on client
        cardData: {
          id: card.id,
          name: card.name,
          cardKind: card.cardKind,
          subtype: card.subtype || null,
          image: card.image || null,
          atk: card.atk,
          def: card.def,
          level: card.level,
        },
      };
    }

    if (zone === "field") {
      const card = actor.field?.[idx];
      if (!card) return null;
      const name = card.name || "Card";
      if (isYourTurn && inBattle && card.cardKind === "monster") {
        addOption(
          "attack",
          "Attack",
          ACTION_TYPES.DECLARE_ATTACK,
          { attackerIndex: idx },
          { requiresTarget: true }
        );
      }
      if (isYourTurn && inMain && card.cardKind === "monster") {
        addOption("switch", "Switch Position", ACTION_TYPES.SWITCH_POSITION, {
          fieldIndex: idx,
        });
        const canEffect =
          game.effectEngine?.canActivateMonsterEffectPreview?.(
            card,
            actor,
            "field"
          )?.ok === true;
        if (canEffect) {
          addOption(
            "activate_effect",
            "Activate Effect",
            ACTION_TYPES.ACTIVATE_EFFECT,
            { fieldIndex: idx }
          );
        }
      }
      addOption("cancel", "Cancel", null, null);
      if (!options.length) return null;
      return {
        type: "card_action_menu",
        promptId,
        title: name,
        zone,
        index: idx,
        options,
        // Card data for visual rendering on client
        cardData: {
          id: card.id,
          name: card.name,
          cardKind: card.cardKind,
          subtype: card.subtype || null,
          image: card.image || null,
          atk: card.atk,
          def: card.def,
          level: card.level,
          position: card.position || "attack",
        },
      };
    }

    return null;
  }

  async handlePromptResponse(client, msg) {
    const room = this.getRoom(client);
    if (!room || !room.game) {
      this.sendError(client, "Match not ready");
      return;
    }

    const seat = client?.seat;
    if (!seat) {
      this.sendError(client, "Client has no seat", "action_rejected");
      return;
    }

    // A1: Buscar prompt do seat específico
    const promptEntry = room.prompts.get(msg.promptId);
    if (!promptEntry) {
      this.sendError(client, "Prompt not found", "action_rejected");
      return;
    }
    if (promptEntry.client !== client) {
      this.sendError(client, "Prompt not for this client", "action_rejected");
      return;
    }

    // A3: Validar stateVersion
    if (promptEntry.stateVersion !== undefined && room.stateVersion !== promptEntry.stateVersion) {
      console.warn("[Server] prompt response stateVersion mismatch", {
        promptId: msg.promptId,
        seat,
        promptVersion: promptEntry.stateVersion,
        currentVersion: room.stateVersion,
      });
      // Rejeitar resposta e limpar prompt
      this.clearPromptForSeat(room, seat, msg.promptId);
      this.sendError(client, "Game state changed, please try again", "state_mismatch");
      this.commitStateUpdate(room, "prompt_state_mismatch");
      return;
    }

    console.log("[Server] prompt_response received", {
      promptId: msg.promptId,
      seat,
      choice: Array.isArray(msg.choice) ? `[${msg.choice.length} items]` : msg.choice,
      stateVersion: promptEntry.stateVersion,
    });

    // INVARIANTE C2: Cancelar timeout ao receber resposta
    if (promptEntry.timeoutId) {
      clearTimeout(promptEntry.timeoutId);
    }

    const { prompt } = promptEntry;

    // A1: Limpar prompt do seat após processar
    this.clearPromptForSeat(room, seat, msg.promptId);

    if (prompt.type === "card_action_menu") {
      const choice = prompt.options.find((opt) => opt.id === msg.choice);
      if (!choice) {
        this.sendError(client, "Invalid choice", "action_rejected");
        return;
      }
      if (!choice.actionType) {
        return; // cancel
      }
      if (choice.requiresTarget) {
        const targetPrompt = this.buildTargetPrompt(
          room,
          client,
          prompt,
          choice
        );
        if (!targetPrompt) {
          this.sendError(client, "No valid targets", "action_rejected");
          return;
        }
        this.storeAndSendPrompt(room, client, targetPrompt);
        return;
      }
      const applyResult = await this.applyAction(
        room,
        client.seat,
        choice.actionType,
        choice.payload || {}
      );
      if (!applyResult.ok) {
        this.sendError(
          client,
          applyResult.message || "Action failed",
          "action_rejected",
          applyResult.hint
        );
        this.sendState(client, room.game);
        return;
      }
      if (applyResult.needsSelection && applyResult.selection?.prompt) {
        const selectionInfo = applyResult.selection;
        this.storeAndSendPrompt(room, client, selectionInfo.prompt, {
          pendingSelection: {
            seat: client.seat,
            actionType: choice.actionType,
            payload: choice.payload || {},
            selectionContract: selectionInfo.contract,
            requirementId: selectionInfo.requirementId,
            resumeData: selectionInfo.resumeData,
          },
        });
        this.commitStateUpdate(room, "menu_action_needs_selection");
        return;
      }
      this.commitStateUpdate(room, "menu_action_resolved");
      return;
    }

    if (prompt.type === "selection_contract") {
      if (msg.choice === "cancel") {
        // Clear the pending selection state in the game
        if (typeof room.game.cancelTargetSelection === "function") {
          room.game.cancelTargetSelection();
        }
        // Also reset selection state directly in case targetSelection is not set
        if (room.game.selectionState) {
          room.game.selectionState = "idle";
        }
        room.game.targetSelection = null;
        this.commitStateUpdate(room, "selection_cancelled");
        return;
      }
      const pending = promptEntry.pendingSelection || {};
      const requirementId =
        pending.requirementId ||
        prompt.requirement?.id ||
        pending.selectionContract?.requirements?.[0]?.id;
      if (!requirementId) {
        this.sendError(client, "Invalid selection", "action_rejected");
        return;
      }
      const requirementDef =
        pending.selectionContract?.requirements?.find(
          (r) => r.id === requirementId
        ) || prompt.requirement;
      const min =
        requirementDef && Number.isInteger(requirementDef.min)
          ? requirementDef.min
          : 1;
      const max =
        requirementDef && Number.isInteger(requirementDef.max)
          ? requirementDef.max
          : min;
      const choiceValue = Array.isArray(msg.choice)
        ? msg.choice
        : msg.choice === undefined || msg.choice === null
        ? []
        : [msg.choice];
      if (choiceValue.length < min || choiceValue.length > max) {
        this.sendError(client, "Invalid selection size", "action_rejected");
        this.sendState(client, room.game);
        return;
      }
      const selections = { [requirementId]: choiceValue };
      const nextPayload = { ...(pending.payload || {}), selections };
      const applyResult = await this.applyAction(
        room,
        pending.seat || client.seat,
        pending.actionType,
        nextPayload,
        { pendingSelection: pending }
      );
      if (!applyResult.ok) {
        this.sendError(
          client,
          applyResult.message || "Action failed",
          "action_rejected",
          applyResult.hint
        );
        this.sendState(client, room.game);
        return;
      }
      if (applyResult.needsSelection && applyResult.selection?.prompt) {
        const selectionInfo = applyResult.selection;
        this.storeAndSendPrompt(room, client, selectionInfo.prompt, {
          pendingSelection: {
            seat: pending.seat || client.seat,
            actionType: pending.actionType,
            payload: nextPayload,
            selectionContract: selectionInfo.contract,
            requirementId: selectionInfo.requirementId,
            resumeData: selectionInfo.resumeData,
          },
        });
        this.commitStateUpdate(room, "contract_needs_more_selection");
        return;
      }
      this.commitStateUpdate(room, "contract_selection_resolved");
      return;
    }

    if (prompt.type === "target_select") {
      const option = prompt.targets.find((t) => t.id === msg.choice);
      if (!option) {
        this.sendError(client, "Invalid target", "action_rejected");
        return;
      }
      if (!option.actionType) {
        // Cancel was selected - ensure selection state is cleared
        if (typeof room.game.cancelTargetSelection === "function") {
          room.game.cancelTargetSelection();
        }
        this.commitStateUpdate(room, "target_select_cancelled");
        return;
      }
      const applyResult = await this.applyAction(
        room,
        client.seat,
        option.actionType,
        option.payload || {}
      );
      if (!applyResult.ok) {
        this.sendError(
          client,
          applyResult.message || "Action failed",
          "action_rejected",
          applyResult.hint
        );
        this.sendState(client, room.game);
        return;
      }
      if (applyResult.needsSelection && applyResult.selection?.prompt) {
        const selectionInfo = applyResult.selection;
        this.storeAndSendPrompt(room, client, selectionInfo.prompt, {
          pendingSelection: {
            seat: client.seat,
            actionType: option.actionType,
            payload: option.payload || {},
            selectionContract: selectionInfo.contract,
            requirementId: selectionInfo.requirementId,
            resumeData: selectionInfo.resumeData,
          },
        });
        this.commitStateUpdate(room, "target_action_needs_selection");
        return;
      }
      this.commitStateUpdate(room, "target_action_resolved");
      return;
    }

    // B2: Handler para card_select (search do deck/gy)
    if (prompt.type === "card_select") {
      if (msg.choice === "cancel") {
        // Limpar estado de seleção
        if (typeof room.game.cancelTargetSelection === "function") {
          room.game.cancelTargetSelection();
        }
        if (room.game.selectionState) {
          room.game.selectionState = "idle";
        }
        this.commitStateUpdate(room, "card_select_cancelled");
        return;
      }

      const pending = promptEntry.pendingSelection || {};
      const requirementId =
        pending.requirementId || prompt.requirement?.id || "search_selection";

      // B1: Validar que a escolha é um dos candidatos válidos (por key)
      const candidates = prompt.requirement?.candidates || [];
      const choiceValue = Array.isArray(msg.choice) ? msg.choice : [msg.choice];
      const min = prompt.requirement?.min ?? 1;
      const max = prompt.requirement?.max ?? 1;

      if (choiceValue.length < min || choiceValue.length > max) {
        this.sendError(client, "Invalid selection count", "action_rejected");
        this.sendState(client, room.game);
        return;
      }

      // B1: Validar que todas as escolhas são candidatos válidos (por key ou id)
      const validKeys = new Set();
      candidates.forEach((c) => {
        if (c.key) validKeys.add(c.key);
        if (c.id !== undefined) validKeys.add(c.id);
      });
      const invalidChoices = choiceValue.filter((c) => !validKeys.has(c));
      if (invalidChoices.length > 0) {
        console.warn("[Server] Invalid card_select choices", {
          choiceValue,
          validKeys: Array.from(validKeys),
          invalidChoices,
        });
        this.sendError(client, "Invalid selection", "action_rejected");
        this.sendState(client, room.game);
        return;
      }

      console.log("[Server] card_select resolved", {
        seat,
        requirementId,
        choiceValue,
        pendingActionType: pending.actionType,
      });

      // Construir seleções para o payload
      const selections = { [requirementId]: choiceValue };
      const nextPayload = { ...(pending.payload || {}), selections };

      const applyResult = await this.applyAction(
        room,
        pending.seat || client.seat,
        pending.actionType,
        nextPayload,
        { pendingSelection: pending }
      );

      if (!applyResult.ok) {
        this.sendError(
          client,
          applyResult.message || "Card selection failed",
          "action_rejected",
          applyResult.hint
        );
        this.sendState(client, room.game);
        return;
      }

      if (applyResult.needsSelection && applyResult.selection?.prompt) {
        const selectionInfo = applyResult.selection;
        this.storeAndSendPrompt(room, client, selectionInfo.prompt, {
          pendingSelection: {
            seat: pending.seat || client.seat,
            actionType: pending.actionType,
            payload: nextPayload,
            selectionContract: selectionInfo.contract,
            requirementId: selectionInfo.requirementId,
            resumeData: selectionInfo.resumeData,
          },
        });
        this.commitStateUpdate(room, "card_select_needs_more");
        return;
      }

      this.commitStateUpdate(room, "card_select_resolved");
      return;
    }
  }

  /**
   * A1: Helper para limpar prompt de um seat específico
   */
  clearPromptForSeat(room, seat, promptId) {
    // Limpar da estrutura per-seat
    if (room.pendingPromptsBySeat[seat]?.promptId === promptId) {
      room.pendingPromptsBySeat[seat] = null;
    }
    // Limpar da estrutura antiga
    room.prompts.delete(promptId);
    // Só limpar pendingPromptType se não houver outros prompts pendentes
    const hasOtherPending = Object.values(room.pendingPromptsBySeat).some((p) => p !== null);
    if (!hasOtherPending) {
      room.pendingPromptType = null;
    }
  }

    if (prompt.type === "card_action_menu") {
      const choice = prompt.options.find((opt) => opt.id === msg.choice);
      if (!choice) {
        this.sendError(client, "Invalid choice", "action_rejected");
        return;
      }
      if (!choice.actionType) {
        return; // cancel
      }
      if (choice.requiresTarget) {
        const targetPrompt = this.buildTargetPrompt(
          room,
          client,
          prompt,
          choice
        );
        if (!targetPrompt) {
          this.sendError(client, "No valid targets", "action_rejected");
          return;
        }
        this.storeAndSendPrompt(room, client, targetPrompt);
        return;
      }
      const applyResult = await this.applyAction(
        room,
        client.seat,
        choice.actionType,
        choice.payload || {}
      );
      if (!applyResult.ok) {
        this.sendError(
          client,
          applyResult.message || "Action failed",
          "action_rejected",
          applyResult.hint
        );
        this.sendState(client, room.game);
        return;
      }
      if (applyResult.needsSelection && applyResult.selection?.prompt) {
        const selectionInfo = applyResult.selection;
        this.storeAndSendPrompt(room, client, selectionInfo.prompt, {
          pendingSelection: {
            seat: client.seat,
            actionType: choice.actionType,
            payload: choice.payload || {},
            selectionContract: selectionInfo.contract,
            requirementId: selectionInfo.requirementId,
            resumeData: selectionInfo.resumeData,
          },
        });
        this.commitStateUpdate(room, "menu_action_needs_selection");
        return;
      }
      this.commitStateUpdate(room, "menu_action_resolved");
      return;
    }

    if (prompt.type === "selection_contract") {
      if (msg.choice === "cancel") {
        // Clear the pending selection state in the game
        if (typeof room.game.cancelTargetSelection === "function") {
          room.game.cancelTargetSelection();
        }
        // Also reset selection state directly in case targetSelection is not set
        if (room.game.selectionState) {
          room.game.selectionState = "idle";
        }
        room.game.targetSelection = null;
        this.commitStateUpdate(room, "selection_cancelled");
        return;
      }
      const pending = promptEntry.pendingSelection || {};
      const requirementId =
        pending.requirementId ||
        prompt.requirement?.id ||
        pending.selectionContract?.requirements?.[0]?.id;
      if (!requirementId) {
        this.sendError(client, "Invalid selection", "action_rejected");
        return;
      }
      const requirementDef =
        pending.selectionContract?.requirements?.find(
          (r) => r.id === requirementId
        ) || prompt.requirement;
      const min =
        requirementDef && Number.isInteger(requirementDef.min)
          ? requirementDef.min
          : 1;
      const max =
        requirementDef && Number.isInteger(requirementDef.max)
          ? requirementDef.max
          : min;
      const choiceValue = Array.isArray(msg.choice)
        ? msg.choice
        : msg.choice === undefined || msg.choice === null
        ? []
        : [msg.choice];
      if (choiceValue.length < min || choiceValue.length > max) {
        this.sendError(client, "Invalid selection size", "action_rejected");
        this.sendState(client, room.game);
        return;
      }
      const selections = { [requirementId]: choiceValue };
      const nextPayload = { ...(pending.payload || {}), selections };
      const applyResult = await this.applyAction(
        room,
        pending.seat || client.seat,
        pending.actionType,
        nextPayload,
        { pendingSelection: pending }
      );
      if (!applyResult.ok) {
        this.sendError(
          client,
          applyResult.message || "Action failed",
          "action_rejected",
          applyResult.hint
        );
        this.sendState(client, room.game);
        return;
      }
      if (applyResult.needsSelection && applyResult.selection?.prompt) {
        const selectionInfo = applyResult.selection;
        this.storeAndSendPrompt(room, client, selectionInfo.prompt, {
          pendingSelection: {
            seat: pending.seat || client.seat,
            actionType: pending.actionType,
            payload: nextPayload,
            selectionContract: selectionInfo.contract,
            requirementId: selectionInfo.requirementId,
            resumeData: selectionInfo.resumeData,
          },
        });
        this.commitStateUpdate(room, "contract_needs_more_selection");
        return;
      }
      this.commitStateUpdate(room, "contract_selection_resolved");
      return;
    }

    if (prompt.type === "target_select") {
      const option = prompt.targets.find((t) => t.id === msg.choice);
      if (!option) {
        this.sendError(client, "Invalid target", "action_rejected");
        return;
      }
      if (!option.actionType) {
        // Cancel was selected - ensure selection state is cleared
        if (typeof room.game.cancelTargetSelection === "function") {
          room.game.cancelTargetSelection();
        }
        this.commitStateUpdate(room, "target_select_cancelled");
        return;
      }
      const applyResult = await this.applyAction(
        room,
        client.seat,
        option.actionType,
        option.payload || {}
      );
      if (!applyResult.ok) {
        this.sendError(
          client,
          applyResult.message || "Action failed",
          "action_rejected",
          applyResult.hint
        );
        this.sendState(client, room.game);
        return;
      }
      if (applyResult.needsSelection && applyResult.selection?.prompt) {
        const selectionInfo = applyResult.selection;
        this.storeAndSendPrompt(room, client, selectionInfo.prompt, {
          pendingSelection: {
            seat: client.seat,
            actionType: option.actionType,
            payload: option.payload || {},
            selectionContract: selectionInfo.contract,
            requirementId: selectionInfo.requirementId,
            resumeData: selectionInfo.resumeData,
          },
        });
        this.commitStateUpdate(room, "target_action_needs_selection");
        return;
      }
      this.commitStateUpdate(room, "target_action_resolved");
      return;
    }

    // B2: Handler para card_select (search do deck/gy)
    if (prompt.type === "card_select") {
      if (msg.choice === "cancel") {
        // Limpar estado de seleção
        if (typeof room.game.cancelTargetSelection === "function") {
          room.game.cancelTargetSelection();
        }
        if (room.game.selectionState) {
          room.game.selectionState = "idle";
        }
        this.commitStateUpdate(room, "card_select_cancelled");
        return;
      }

      const pending = promptEntry.pendingSelection || {};
      const requirementId =
        pending.requirementId || prompt.requirement?.id || "search_selection";

      // Validar que a escolha é um dos candidatos válidos
      const candidates = prompt.requirement?.candidates || [];
      const choiceValue = Array.isArray(msg.choice) ? msg.choice : [msg.choice];
      const min = prompt.requirement?.min ?? 1;
      const max = prompt.requirement?.max ?? 1;

      if (choiceValue.length < min || choiceValue.length > max) {
        this.sendError(client, "Invalid selection count", "action_rejected");
        this.sendState(client, room.game);
        return;
      }

      // Validar que todas as escolhas são candidatos válidos
      const validIds = new Set(candidates.map((c) => c.id));
      const invalidChoices = choiceValue.filter((c) => !validIds.has(c));
      if (invalidChoices.length > 0) {
        this.sendError(client, "Invalid selection", "action_rejected");
        this.sendState(client, room.game);
        return;
      }

      // Construir seleções para o payload
      const selections = { [requirementId]: choiceValue };
      const nextPayload = { ...(pending.payload || {}), selections };

      const applyResult = await this.applyAction(
        room,
        pending.seat || client.seat,
        pending.actionType,
        nextPayload,
        { pendingSelection: pending }
      );

      if (!applyResult.ok) {
        this.sendError(
          client,
          applyResult.message || "Card selection failed",
          "action_rejected",
          applyResult.hint
        );
        this.sendState(client, room.game);
        return;
      }

      if (applyResult.needsSelection && applyResult.selection?.prompt) {
        const selectionInfo = applyResult.selection;
        this.storeAndSendPrompt(room, client, selectionInfo.prompt, {
          pendingSelection: {
            seat: pending.seat || client.seat,
            actionType: pending.actionType,
            payload: nextPayload,
            selectionContract: selectionInfo.contract,
            requirementId: selectionInfo.requirementId,
            resumeData: selectionInfo.resumeData,
          },
        });
        this.commitStateUpdate(room, "card_select_needs_more");
        return;
      }

      this.commitStateUpdate(room, "card_select_resolved");
      return;
    }
  }

  buildTargetPrompt(room, client, sourcePrompt, choice) {
    const game = room.game;
    const actor = client.seat === "bot" ? game.bot : game.player;
    const opponent = actor === game.player ? game.bot : game.player;

    if (choice.actionType === ACTION_TYPES.DECLARE_ATTACK) {
      const targets = (opponent.field || [])
        .map((card, idx) => ({ card, idx }))
        .filter(
          (entry) =>
            entry.card &&
            entry.card.cardKind === "monster" &&
            entry.card.isFacedown !== true
        );

      const promptId = `p_${room.id}_${++this.promptCounter}`;
      const targetOptions = [];

      // Adicionar monstros face-up como alvos
      targets.forEach((t) => {
        targetOptions.push({
          id: t.idx,
          label: t.card.name || `Target ${t.idx}`,
          actionType: ACTION_TYPES.DECLARE_ATTACK,
          payload: {
            attackerIndex: choice.payload?.attackerIndex,
            targetIndex: t.idx,
          },
        });
      });

      // Se não há monstros face-up, oferecer ataque direto
      if (targets.length === 0) {
        targetOptions.push({
          id: "direct",
          label: "Direct Attack",
          actionType: ACTION_TYPES.DIRECT_ATTACK,
          payload: {
            attackerIndex: choice.payload?.attackerIndex,
          },
        });
      }

      targetOptions.push({
        id: "cancel",
        label: "Cancel",
        actionType: null,
        payload: null,
      });

      return {
        type: "target_select",
        promptId,
        title:
          targets.length > 0 ? "Select attack target" : "No monsters to attack",
        targets: targetOptions,
      };
    }

    return null;
  }

  buildSelectionPrompt(room, client, selectionResult, actionContext = {}) {
    const contract = selectionResult?.selectionContract;
    if (!contract || !Array.isArray(contract.requirements)) {
      return null;
    }
    const requirement = contract.requirements[0];
    if (!requirement || !Array.isArray(requirement.candidates)) {
      return null;
    }
    const promptId = `p_${room.id}_${++this.promptCounter}`;

    // Determinar tipo de prompt baseado no kind do contrato
    const contractKind = contract.kind || "selection_contract";
    const isCardSelect = contractKind === "card_select";

    const candidates = requirement.candidates.map((cand, idx) => ({
      id: cand.key ?? idx,
      label: cand.name || `Target ${idx + 1}`,
      zone: cand.zone || null,
      controller: cand.controller || cand.owner || null,
      zoneIndex: cand.zoneIndex ?? null,
      // Campos extras para card_select (search)
      cardId: cand.cardId ?? null,
      cardKind: cand.cardKind ?? null,
      atk: cand.atk ?? null,
      def: cand.def ?? null,
      level: cand.level ?? null,
    }));

    return {
      type: isCardSelect ? "card_select" : "selection_contract",
      promptId,
      title: contract.message || "Select target(s)",
      requirement: {
        id: requirement.id || "selection",
        min: requirement.min ?? 1,
        max: requirement.max ?? 1,
        candidates,
      },
      actionType: actionContext.actionType || null,
      sourceZone: selectionResult.sourceZone || null,
    };
  }

  async handleAction(client, msg) {
    const room = this.getRoom(client);
    if (!room || !room.game) {
      this.sendError(client, "Match not ready");
      return;
    }

    const seat = client?.seat;
    if (!seat) {
      this.sendError(client, "Client has no seat", "invalid_action");
      return;
    }

    // A2: Input lock - bloquear novas ações se houver prompt pendente para este seat
    const pendingPrompt = room.pendingPromptsBySeat[seat];
    if (pendingPrompt) {
      console.warn("[Server] action blocked - pending prompt", {
        seat,
        promptId: pendingPrompt.promptId,
        promptType: pendingPrompt.prompt?.type,
      });
      this.sendError(client, "Please respond to the current prompt first", "input_locked");
      return;
    }

    const seq = Number(msg.seq);
    if (!Number.isInteger(seq) || seq <= client.lastSeq) {
      this.sendError(client, "Invalid sequence", "invalid_seq");
      this.sendState(client, room.game);
      return;
    }

    client.lastSeq = seq;

    const { actionType, payload = {} } = msg;
    console.log("[Server] action received", {
      seat: client.seat,
      actionType,
      payload,
      seq,
    });
    const validation = validateActionPayload(actionType, payload);
    if (!validation.ok) {
      this.sendError(client, validation.message || "Invalid action");
      this.sendState(client, room.game);
      return;
    }

    const applyResult = await this.applyAction(
      room,
      client.seat,
      actionType,
      payload
    );
    if (!applyResult.ok) {
      console.warn("[Server] action rejected", {
        seat: client.seat,
        actionType,
        reason: applyResult.message,
        hint: applyResult.hint,
      });
      this.sendError(
        client,
        applyResult.message || "Action failed",
        "action_rejected",
        applyResult.hint
      );
      this.sendState(client, room.game);
      return;
    }

    if (applyResult.needsSelection && applyResult.selection?.prompt) {
      const selectionInfo = applyResult.selection;
      this.storeAndSendPrompt(room, client, selectionInfo.prompt, {
        pendingSelection: {
          seat: client.seat,
          actionType,
          payload,
          selectionContract: selectionInfo.contract,
          requirementId: selectionInfo.requirementId,
          resumeData: selectionInfo.resumeData,
        },
      });
      this.commitStateUpdate(room, "action_needs_selection");
      return;
    }

    console.log("[Server] action accepted", {
      seat: client.seat,
      actionType,
    });
    this.commitStateUpdate(room, `action_${actionType.toLowerCase()}`);
  }

  /**
   * INVARIANTE C1: EffectResolutionGuard
   * Wrapper que garante cleanup em caso de erro durante resolução de efeitos.
   * Toda execução de efeito passa por aqui para evitar soft-locks.
   */
  async applyAction(room, seat, actionType, payload, context = null) {
    const game = room?.game;
    if (!game) {
      return { ok: false, message: "Match not ready" };
    }
    const actor = seat === "bot" ? game.bot : game.player;
    const opponent = seat === "bot" ? game.player : game.bot;
    if (!actor) {
      return { ok: false, message: "Invalid player" };
    }
    if (game.gameOver) {
      return { ok: false, message: "Game over" };
    }
    if (game.turn !== actor.id) {
      return { ok: false, message: "Not your turn" };
    }

    // INVARIANTE C1: Marcar que estamos resolvendo
    room.isResolvingEffect = true;
    room.pendingPromptType = null;
    let hadError = false;
    const actionContext = this.buildActionContext(room, seat);

    try {
      return await this._executeAction(
        room,
        actor,
        opponent,
        actionType,
        payload,
        context,
        seat,
        actionContext
      );
    } catch (error) {
      hadError = true;
      console.error("[Server] applyAction error", {
        actionType,
        seat,
        error: error.message || error,
      });
      if (error?.stack) {
        console.error("[Server] applyAction stack", error.stack);
      }
      return {
        ok: false,
        message: "Action failed due to internal error",
        hint: error.message || null,
      };
    } finally {
      // INVARIANTE C1: SEMPRE limpar estado de resolução
      room.isResolvingEffect = false;
      // Limpar pendingPrompt se não houve needsSelection
      // (se houve, o prompt será gerenciado pelo fluxo de prompts)
      if (game.selectionState === "idle" || !game.selectionState) {
        room.pendingPromptType = null;
      }
      if (hadError) {
        if (typeof game.cancelTargetSelection === "function") {
          game.cancelTargetSelection();
        }
        game.selectionState = "idle";
        game.targetSelection = null;
        game.trapPromptInProgress = false;
        game.pendingEventSelection = null;
      }
      // Garantir que locks do game são liberados
      if (game.isResolvingEffect) {
        game.isResolvingEffect = false;
      }
      if (game.inputLocked) {
        game.inputLocked = false;
      }
    }
  }

  async _executeAction(
    room,
    actor,
    opponent,
    actionType,
    payload,
    context,
    seat,
    actionContext
  ) {
    const game = room.game;

    const ensureMainPhase = () =>
      game.phase === "main1" || game.phase === "main2";

    const mainPhaseGuard = (message = "Only in Main Phase") => {
      if (!ensureMainPhase()) {
        return { ok: false, message, hint: "Mude para Main Phase." };
      }
      return null;
    };

    const buildSelection = (payload) => {
      if (
        payload?.selections &&
        typeof payload.selections === "object" &&
        !Array.isArray(payload.selections)
      ) {
        return payload.selections;
      }
      const selections = {};
      if (payload?.targetIndex !== undefined && payload?.targetIndex !== null) {
        selections.targetIndex = payload.targetIndex;
      }
      if (payload?.effectId !== undefined && payload?.effectId !== null) {
        selections.effectId = payload.effectId;
      }
      return Object.keys(selections).length ? selections : null;
    };

    switch (actionType) {
      case ACTION_TYPES.NORMAL_SUMMON: {
        const guard = mainPhaseGuard("Summon only in Main Phase");
        if (guard) return guard;
        const { handIndex, position } = payload;
        const card = actor.hand[handIndex];
        if (!card) return { ok: false, message: "No card in that hand slot" };
        if (card.cardKind !== "monster") {
          return { ok: false, message: "Only monsters can be Normal Summoned" };
        }
        const before = actor.field.length;
        const summoned = actor.summon(
          handIndex,
          position === "defense" ? "defense" : "attack",
          false
        );
        if (!summoned && actor.field.length === before) {
          return { ok: false, message: "Summon failed" };
        }
        const summonedCard = actor.field[actor.field.length - 1];
        summonedCard.summonedTurn = game.turnCounter;
        summonedCard.positionChangedThisTurn = false;
        summonedCard.setTurn = summonedCard.isFacedown
          ? game.turnCounter
          : null;

        // IMPORTANTE: Aguardar resolução de efeitos after_summon
        const emitResult = await game.emit("after_summon", {
          card: summonedCard,
          player: actor,
          method: "normal",
          fromZone: "hand",
          actionContext,
        });

        // Verificar se algum efeito precisa de seleção
        if (emitResult?.needsSelection && emitResult.selectionContract) {
          const prompt = this.buildSelectionPrompt(room, { seat }, emitResult, {
            actionType: "RESUME_EVENT_SELECTION",
          });
          if (prompt) {
            return {
              ok: true,
              needsSelection: true,
              selection: {
                prompt,
                contract: emitResult.selectionContract,
                requirementId:
                  prompt?.requirement?.id ||
                  emitResult.selectionContract?.requirements?.[0]?.id ||
                  "selection",
                resumeData: emitResult.resumeData || null,
              },
            };
          }
        }

        game.updateBoard();
        return { ok: true };
      }
      case ACTION_TYPES.SET_MONSTER: {
        const guard = mainPhaseGuard("Set only in Main Phase");
        if (guard) return guard;
        const { handIndex } = payload;
        const card = actor.hand[handIndex];
        if (!card) return { ok: false, message: "No card in that hand slot" };
        if (card.cardKind !== "monster") {
          return { ok: false, message: "Only monsters can be Set" };
        }
        const before = actor.field.length;
        const summoned = actor.summon(handIndex, "defense", true);
        if (!summoned && actor.field.length === before) {
          return { ok: false, message: "Set failed" };
        }
        const summonedCard = actor.field[actor.field.length - 1];
        summonedCard.summonedTurn = game.turnCounter;
        summonedCard.positionChangedThisTurn = false;
        summonedCard.setTurn = game.turnCounter;

        // IMPORTANTE: Aguardar resolução de efeitos after_summon (mesmo para set)
        const emitResult = await game.emit("after_summon", {
          card: summonedCard,
          player: actor,
          method: "normal",
          fromZone: "hand",
          actionContext,
        });

        // Verificar se algum efeito precisa de seleção
        if (emitResult?.needsSelection && emitResult.selectionContract) {
          const prompt = this.buildSelectionPrompt(room, { seat }, emitResult, {
            actionType: "RESUME_EVENT_SELECTION",
          });
          if (prompt) {
            return {
              ok: true,
              needsSelection: true,
              selection: {
                prompt,
                contract: emitResult.selectionContract,
                requirementId:
                  prompt?.requirement?.id ||
                  emitResult.selectionContract?.requirements?.[0]?.id ||
                  "selection",
                resumeData: emitResult.resumeData || null,
              },
            };
          }
        }

        game.updateBoard();
        return { ok: true };
      }
      case ACTION_TYPES.SWITCH_POSITION: {
        const { fieldIndex } = payload;
        const card = actor.field[fieldIndex];
        if (!card) return { ok: false, message: "No monster in that slot" };
        const newPos = card.position === "attack" ? "defense" : "attack";
        game.changeMonsterPosition(card, newPos);
        return { ok: true };
      }
      case ACTION_TYPES.SET_SPELLTRAP: {
        const guard = mainPhaseGuard("Set only in Main Phase");
        if (guard) return guard;
        const { handIndex } = payload;
        const card = actor.hand[handIndex];
        if (!card) return { ok: false, message: "No card in that hand slot" };
        if (card.cardKind !== "spell" && card.cardKind !== "trap") {
          return { ok: false, message: "Only Spell/Trap can be set" };
        }
        const result = game.setSpellOrTrap(card, handIndex, actor);
        if (!result || result.ok === false) {
          return {
            ok: false,
            message: result?.reason || "Set failed",
          };
        }
        return { ok: true };
      }
      case ACTION_TYPES.ACTIVATE_SPELL: {
        const guard = mainPhaseGuard("Activate only in Main Phase");
        if (guard) return guard;
        const { handIndex } = payload;
        const resumeInfo = context?.pendingSelection?.resumeData || null;
        const resumeCardRef =
          resumeInfo?.commitInfo?.cardRef ||
          resumeInfo?.activationContext?.commitInfo?.cardRef ||
          null;
        let card = actor.hand[handIndex];
        if (!card && resumeCardRef) {
          card = resumeCardRef;
        }
        if (!card) return { ok: false, message: "No card in that hand slot" };
        if (card.cardKind !== "spell" && card.cardKind !== "trap") {
          return { ok: false, message: "Only Spell/Trap can be activated" };
        }
        const selections = buildSelection(payload);
        const result = await game.tryActivateSpell(
          card,
          handIndex,
          selections,
          {
            owner: actor,
            resume: context?.pendingSelection?.resumeData || null,
            actionContext,
          }
        );
        if (result?.needsSelection && result.selectionContract) {
          const prompt = this.buildSelectionPrompt(room, { seat }, result, {
            actionType,
          });
          return {
            ok: true,
            needsSelection: true,
            selection: {
              prompt,
              contract: result.selectionContract,
              requirementId:
                prompt?.requirement?.id ||
                result.selectionContract?.requirements?.[0]?.id ||
                "selection",
              resumeData: {
                commitInfo: result.commitInfo || null,
                activationZone: result.activationZone || null,
                activationContext: result.activationContext || null,
              },
            },
          };
        }
        if (!result || result.success === false) {
          return {
            ok: false,
            message: result?.reason || "Activation failed",
            hint: result?.hint,
          };
        }
        return { ok: true };
      }
      case ACTION_TYPES.ACTIVATE_EFFECT: {
        const guard = mainPhaseGuard("Activate only in Main Phase");
        if (guard) return guard;
        const { fieldIndex } = payload;
        const card = actor.field[fieldIndex];
        if (!card) return { ok: false, message: "No monster in that slot" };
        if (card.cardKind !== "monster") {
          return {
            ok: false,
            message: "Only monster effects can be activated",
          };
        }
        const selections = buildSelection(payload);
        const result = await game.tryActivateMonsterEffect(
          card,
          selections,
          "field",
          actor,
          {
            actionContext,
          }
        );
        if (result?.needsSelection && result.selectionContract) {
          const prompt = this.buildSelectionPrompt(room, { seat }, result, {
            actionType,
          });
          return {
            ok: true,
            needsSelection: true,
            selection: {
              prompt,
              contract: result.selectionContract,
              requirementId:
                prompt?.requirement?.id ||
                result.selectionContract?.requirements?.[0]?.id ||
                "selection",
              resumeData: null,
            },
          };
        }
        if (!result || result.success === false) {
          return {
            ok: false,
            message: result?.reason || "Effect activation failed",
            hint: result?.hint,
          };
        }
        return { ok: true };
      }
      case ACTION_TYPES.DECLARE_ATTACK: {
        if (game.phase !== "battle") {
          return { ok: false, message: "Attacks only in Battle Phase" };
        }
        const { attackerIndex, targetIndex } = payload;
        const attacker = actor.field[attackerIndex];
        if (!attacker || attacker.cardKind !== "monster") {
          return { ok: false, message: "Invalid attacker" };
        }
        const target = opponent.field[targetIndex];
        if (!target || target.cardKind !== "monster") {
          return { ok: false, message: "Invalid target" };
        }
        if (target.isFacedown) {
          return { ok: false, message: "Target must be face-up" };
        }
        const result = await game.resolveCombat(attacker, target, {
          allowDuringSelection: true,
          allowDuringResolving: true,
        });
        if (result && result.ok === false) {
          return { ok: false, message: result.reason || "Attack not allowed" };
        }
        return { ok: true };
      }
      case "RESUME_EVENT_SELECTION": {
        const selections = payload?.selections || null;
        if (!selections || typeof selections !== "object") {
          return { ok: false, message: "Missing selections" };
        }
        const resumeResult = await game.resumePendingEventSelection(
          selections,
          { actionContext }
        );
        if (resumeResult?.needsSelection && resumeResult.selectionContract) {
          const prompt = this.buildSelectionPrompt(room, { seat }, resumeResult, {
            actionType: "RESUME_EVENT_SELECTION",
          });
          if (prompt) {
            return {
              ok: true,
              needsSelection: true,
              selection: {
                prompt,
                contract: resumeResult.selectionContract,
                requirementId:
                  prompt?.requirement?.id ||
                  resumeResult.selectionContract?.requirements?.[0]?.id ||
                  "selection",
                resumeData: null,
              },
            };
          }
        }
        if (!resumeResult?.ok) {
          return {
            ok: false,
            message: resumeResult?.reason || "Event resolution failed",
          };
        }
        game.updateBoard();
        return { ok: true };
      }
      case ACTION_TYPES.DIRECT_ATTACK: {
        if (game.phase !== "battle") {
          return { ok: false, message: "Attacks only in Battle Phase" };
        }
        const { attackerIndex } = payload;
        const attacker = actor.field[attackerIndex];
        if (!attacker || attacker.cardKind !== "monster") {
          return { ok: false, message: "Invalid attacker" };
        }
        // Verificar se oponente realmente não tem monstros face-up
        const hasTargets = (opponent.field || []).some(
          (c) => c && c.cardKind === "monster" && !c.isFacedown
        );
        if (hasTargets) {
          return {
            ok: false,
            message: "Cannot direct attack: opponent has monsters",
          };
        }
        // Passar null como target para indicar ataque direto
        const result = await game.resolveCombat(attacker, null, {
          allowDuringSelection: true,
          allowDuringResolving: true,
        });
        if (result && result.ok === false) {
          return {
            ok: false,
            message: result.reason || "Direct attack not allowed",
          };
        }
        return { ok: true };
      }
      case ACTION_TYPES.NEXT_PHASE: {
        const res = game.nextPhase();
        if (res && res.ok === false) {
          return { ok: false, message: res.reason || "Cannot change phase" };
        }
        return { ok: true };
      }
      case ACTION_TYPES.END_TURN: {
        const res = game.endTurn();
        if (res && res.ok === false) {
          return { ok: false, message: res.reason || "Cannot end turn" };
        }
        return { ok: true };
      }
      default:
        return { ok: false, message: "Unsupported action" };
    }
  }

  /**
   * INVARIANTE A: Toda mutação de estado relevante passa por aqui.
   * Incrementa stateVersion e broadcast para ambos os jogadores.
   * @param {Object} room - The room object
   * @param {string} reason - Why state is being committed (for debugging)
   */
  commitStateUpdate(room, reason = "unknown") {
    if (!room?.game) return;
    room.stateVersion = (room.stateVersion || 0) + 1;
    console.log("[Server] commitStateUpdate", {
      room: room.id,
      version: room.stateVersion,
      phase: room.game.phase,
      turn: room.game.turn,
      reason,
    });
    const payloadForSeat = (seat) => ({
      type: SERVER_MESSAGE_TYPES.STATE_UPDATE,
      state: {
        ...room.game.getPublicState(seat),
        stateVersion: room.stateVersion,
        isResolvingEffect: room.isResolvingEffect || false,
        pendingPromptType: room.pendingPromptType || null,
      },
    });
    if (room.clients.player) {
      send(room.clients.player.ws, payloadForSeat("player"));
    }
    if (room.clients.bot) {
      send(room.clients.bot.ws, payloadForSeat("bot"));
    }
  }

  broadcastState(room) {
    if (!room?.game) return;
    console.log("[Server] broadcast state", {
      room: room.id,
      phase: room.game.phase,
      turn: room.game.turn,
    });
    const payloadForSeat = (seat) => ({
      type: SERVER_MESSAGE_TYPES.STATE_UPDATE,
      state: room.game.getPublicState(seat),
    });
    if (room.clients.player) {
      send(room.clients.player.ws, payloadForSeat("player"));
    }
    if (room.clients.bot) {
      send(room.clients.bot.ws, payloadForSeat("bot"));
    }
  }

  sendState(client, game) {
    if (!client?.ws || !game) return;
    send(client.ws, {
      type: SERVER_MESSAGE_TYPES.STATE_UPDATE,
      state: game.getPublicState(client.seat || "player"),
    });
  }

  sendError(client, message, code = "error", hint = null) {
    if (!client?.ws) return;
    send(client.ws, {
      type: SERVER_MESSAGE_TYPES.ERROR,
      message,
      code,
      hint,
    });
  }

  handleDisconnect(client) {
    const room = this.getRoom(client);
    if (!room) return;

    const disconnectedSeat = client.seat;

    // Identificar o outro jogador ANTES de remover o cliente
    const otherSeat = disconnectedSeat === "player" ? "bot" : "player";
    const otherClient = room.clients[otherSeat];

    // Remover o cliente que desconectou
    if (disconnectedSeat && room.clients[disconnectedSeat] === client) {
      room.clients[disconnectedSeat] = null;
    }

    // Notificar o outro jogador se ainda estiver conectado
    if (otherClient?.ws?.readyState === otherClient?.ws?.OPEN) {
      this.sendError(otherClient, "Opponent disconnected", "opponent_left");
    }

    this.rooms.delete(room.id);
  }

  createRoom(id) {
    return {
      id,
      clients: { player: null, bot: null },
      game: null,
      prompts: new Map(),
      // A1: Per-seat prompt tracking to prevent overwriting prompts
      pendingPromptsBySeat: {
        player: null,
        bot: null,
      },
      stateVersion: 0,
      isResolvingEffect: false,
      pendingPromptType: null,
    };
  }

  getRoom(client) {
    if (!client?.roomId) return null;
    return this.rooms.get(client.roomId) || null;
  }
}
