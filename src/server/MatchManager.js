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
  }

  attachConnection(ws) {
    const client = {
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
      default:
        this.sendError(client, "Unknown message type");
    }
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
    if (room.clients.player?.ready && room.clients.bot?.ready && !room.game) {
      this.startMatch(room);
    }
  }

  async startMatch(room) {
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
    this.broadcastState(room);
  }

  async handleIntent(client, msg) {
    const room = this.getRoom(client);
    if (!room || !room.game) {
      this.sendError(client, "Match not ready");
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

  storeAndSendPrompt(room, client, prompt) {
    if (!prompt?.promptId) return;
    room.prompts.set(prompt.promptId, { client, prompt });
    console.log("[Server] send prompt", {
      seat: client.seat,
      promptId: prompt.promptId,
      type: prompt.type,
    });
    send(client.ws, {
      type: SERVER_MESSAGE_TYPES.PROMPT_REQUEST,
      ...prompt,
    });
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
        addOption("set_spelltrap", "Set Spell/Trap", ACTION_TYPES.SET_SPELLTRAP, {
          handIndex: idx,
        });
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
        addOption(
          "switch",
          "Switch Position",
          ACTION_TYPES.SWITCH_POSITION,
          { fieldIndex: idx }
        );
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
    const promptEntry = room.prompts.get(msg.promptId);
    if (!promptEntry) {
      this.sendError(client, "Prompt not found", "action_rejected");
      return;
    }
    if (promptEntry.client !== client) {
      this.sendError(client, "Prompt not for this client", "action_rejected");
      return;
    }

    const { prompt } = promptEntry;
    room.prompts.delete(msg.promptId);

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
        const targetPrompt = this.buildTargetPrompt(room, client, prompt, choice);
        if (!targetPrompt) {
          this.sendError(client, "No valid targets", "action_rejected");
          return;
        }
        this.storeAndSendPrompt(room, client, targetPrompt);
        return;
      }
      const applyResult = await this.applyAction(
        room.game,
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
      this.broadcastState(room);
      return;
    }

    if (prompt.type === "target_select") {
      const option = prompt.targets.find((t) => t.id === msg.choice);
      if (!option) {
        this.sendError(client, "Invalid target", "action_rejected");
        return;
      }
      if (!option.actionType) {
        return;
      }
      const applyResult = await this.applyAction(
        room.game,
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
      this.broadcastState(room);
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
      if (!targets.length) return null;
      const promptId = `p_${room.id}_${++this.promptCounter}`;
      return {
        type: "target_select",
        promptId,
        title: "Select attack target",
        targets: [
          ...targets.map((t) => ({
            id: t.idx,
            label: t.card.name || `Target ${t.idx}`,
            actionType: ACTION_TYPES.DECLARE_ATTACK,
            payload: {
              attackerIndex: choice.payload?.attackerIndex,
              targetIndex: t.idx,
            },
          })),
          { id: "cancel", label: "Cancel", actionType: null, payload: null },
        ],
      };
    }

    return null;
  }

  async handleAction(client, msg) {
    const room = this.getRoom(client);
    if (!room || !room.game) {
      this.sendError(client, "Match not ready");
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
      room.game,
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

    console.log("[Server] action accepted", {
      seat: client.seat,
      actionType,
    });
    this.broadcastState(room);
  }

  async applyAction(game, seat, actionType, payload) {
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

    const ensureMainPhase = () =>
      game.phase === "main1" || game.phase === "main2";

    const mainPhaseGuard = (message = "Only in Main Phase") => {
      if (!ensureMainPhase()) {
        return { ok: false, message, hint: "Mude para Main Phase." };
      }
      return null;
    };

    const buildSelection = (payload) => {
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
        game.emit("after_summon", {
          card: summonedCard,
          player: actor,
          method: "normal",
          fromZone: "hand",
        });
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
        game.emit("after_summon", {
          card: summonedCard,
          player: actor,
          method: "normal",
          fromZone: "hand",
        });
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
        const card = actor.hand[handIndex];
        if (!card) return { ok: false, message: "No card in that hand slot" };
        if (card.cardKind !== "spell" && card.cardKind !== "trap") {
          return { ok: false, message: "Only Spell/Trap can be activated" };
        }
        const selections = buildSelection(payload);
        const result = await game.tryActivateSpell(card, handIndex, selections, {
          owner: actor,
        });
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
          return { ok: false, message: "Only monster effects can be activated" };
        }
        const selections = buildSelection(payload);
        const result = await game.tryActivateMonsterEffect(
          card,
          selections,
          "field",
          actor
        );
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
        const result = game.resolveCombat(attacker, target, {
          allowDuringSelection: true,
          allowDuringResolving: true,
        });
        if (result && result.ok === false) {
          return { ok: false, message: result.reason || "Attack not allowed" };
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

  broadcastState(room) {
    if (!room?.game) return;
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
    if (client.seat && room.clients[client.seat] === client) {
      room.clients[client.seat] = null;
    }
    const remaining =
      room.clients.player?.ws?.readyState === room.clients.player?.ws?.OPEN ||
      room.clients.bot?.ws?.readyState === room.clients.bot?.ws?.OPEN;
    if (remaining) {
      const other =
        room.clients.player?.ws?.readyState === room.clients.player?.ws?.OPEN
          ? room.clients.player
          : room.clients.bot;
      if (other) {
        this.sendError(other, "Opponent disconnected", "opponent_left");
      }
    }
    this.rooms.delete(room.id);
  }

  createRoom(id) {
    return {
      id,
      clients: { player: null, bot: null },
      game: null,
      prompts: new Map(),
    };
  }

  getRoom(client) {
    if (!client?.roomId) return null;
    return this.rooms.get(client.roomId) || null;
  }
}
