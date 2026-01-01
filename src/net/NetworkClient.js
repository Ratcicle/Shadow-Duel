const seatMap = {
  player: "p1",
  bot: "p2",
  p1: "p1",
  p2: "p2",
};

function normalizeSeat(seat) {
  if (!seat) return null;
  const key = String(seat).toLowerCase();
  return seatMap[key] || seat;
}

export default class NetworkClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = {
      state: null,
      error: null,
      start: null,
      info: null,
      prompt: null,
      gameOver: null,
      rematchStatus: null,
    };
    this.seq = 0;
    this.seat = null;
    this.seatCanonical = null;
    this.seatLegacy = null;
  }

  connect(roomId = "default", playerName = null) {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      console.log("[Net] WS open -> join_room", { roomId, playerName });
      this.send({
        type: "join_room",
        roomId,
        playerName,
      });
    };
    this.ws.onmessage = (evt) => this.handleMessage(evt);
    this.ws.onerror = (err) => {
      console.error("[Net] WS error", err);
      this.handlers.error?.(err);
    };
    this.ws.onclose = () => {
      console.warn("[Net] WS closed");
      this.handlers.error?.({ message: "Connection closed" });
    };
  }

  onState(handler) {
    this.handlers.state = handler;
  }

  onError(handler) {
    this.handlers.error = handler;
  }

  onStart(handler) {
    this.handlers.start = handler;
  }

  onInfo(handler) {
    this.handlers.info = handler;
  }

  onPrompt(handler) {
    this.handlers.prompt = handler;
  }

  onGameOver(handler) {
    this.handlers.gameOver = handler;
  }

  onRematchStatus(handler) {
    this.handlers.rematchStatus = handler;
  }

  sendRematchRequest() {
    console.log("[Net] -> rematch_request");
    this.send({ type: "rematch_request" });
  }

  handleMessage(evt) {
    let msg = null;
    try {
      msg = JSON.parse(evt.data);
    } catch (err) {
      console.error("[Net] Failed to parse message", err);
      return;
    }
    if (!msg || typeof msg.type !== "string") return;
    console.log("[Net] <-", msg.type, msg);
    const promptPayload =
      msg.type === "prompt_request"
        ? msg.prompt || msg
        : msg.type === "card_action_menu" ||
          msg.type === "target_select" ||
          msg.type === "selection_contract"
        ? msg
        : null;
    switch (msg.type) {
      case "match_start":
        this.seatCanonical = normalizeSeat(
          msg.youAre || msg.seat || msg.youAreLegacy
        );
        this.seatLegacy = msg.youAreLegacy || msg.youAre || null;
        // Maintain backward compatibility: seat stays legacy if provided
        this.seat = this.seatLegacy || this.seatCanonical;
        this.handlers.start?.(msg);
        break;
      case "state_update":
        this.handlers.state?.(msg.state);
        break;
      case "game_over":
        this.handlers.gameOver?.(msg);
        break;
      case "rematch_status":
        this.handlers.rematchStatus?.(msg);
        break;
      case "prompt_request":
      case "card_action_menu":
      case "target_select":
      case "selection_contract":
        this.handlers.prompt?.(promptPayload || msg);
        break;
      case "error":
        this.handlers.error?.(msg);
        break;
      case "info":
        this.handlers.info?.(msg);
        break;
      default:
        break;
    }
  }

  sendAction(actionType, payload = {}) {
    console.log("[Net] -> action", { actionType, payload });
    this.seq += 1;
    this.send({
      type: "action",
      actionType,
      seq: this.seq,
      payload,
    });
  }

  sendIntentCardClick(zone, index) {
    console.log("[Net] -> intent_card_click", { zone, index });
    this.send({
      type: "intent_card_click",
      zone,
      index,
    });
  }

  sendPromptResponse(promptId, choice) {
    console.log("[Net] -> prompt_response", { promptId, choice });
    this.send({
      type: "prompt_response",
      promptId,
      choice,
    });
  }

  disconnect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (err) {
        // ignore
      }
      this.ws = null;
    }
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}
