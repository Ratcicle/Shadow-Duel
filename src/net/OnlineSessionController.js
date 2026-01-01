import NetworkClient from "./NetworkClient.js";

export default class OnlineSessionController {
  constructor() {
    this.client = null;
    this.seat = null;
    this.seatCanonical = null;
    this.seatLegacy = null;
    this.snapshot = null;
    this.connected = false;
    this.gameEnded = false;
    this.handlers = {
      state: null,
      error: null,
      start: null,
      info: null,
      prompt: null,
      status: null,
      gameOver: null,
      rematchStatus: null,
    };
  }

  setHandlers(handlers = {}) {
    this.handlers = { ...this.handlers, ...handlers };
  }

  normalizeSeat(seat) {
    if (!seat) return null;
    const key = String(seat).toLowerCase();
    if (key === "player" || key === "p1") return "p1";
    if (key === "bot" || key === "p2") return "p2";
    return seat;
  }

  connect(url, roomId, playerName) {
    if (this.client) {
      this.disconnect();
    }
    this.client = new NetworkClient(url);
    this.client.onStart((msg) => {
      console.log("[OnlineSession] match_start", msg);
      this.seatCanonical = this.normalizeSeat(
        msg.youAre || msg.seat || msg.youAreLegacy
      );
      this.seatLegacy = msg.youAreLegacy || msg.youAre || null;
      this.seat = this.seatLegacy || this.seatCanonical;
      this.connected = true;
      this.handlers.start?.(msg);
      this.handlers.status?.({
        connected: true,
        seat: this.seat,
        seatCanonical: this.seatCanonical,
        seatLegacy: this.seatLegacy,
        roomId: msg.roomId,
      });
    });
    this.client.onState((state) => {
      console.log("[OnlineSession] state_update", {
        phase: state?.phase,
        turn: state?.turn,
        currentPlayer: state?.currentPlayer,
      });
      this.connected = true;
      this.snapshot = state;
      this.handlers.state?.(state, this.seat);
    });
    this.client.onError((err) => {
      console.error("[OnlineSession] error", err);
      this.handlers.error?.(err);
      if (err?.code === "opponent_left") {
        this.connected = false;
      }
      this.handlers.status?.({
        connected: this.connected,
        seat: this.seat,
        roomId,
      });
    });
    this.client.onInfo((info) => {
      this.handlers.info?.(info);
    });
    this.client.onPrompt((prompt) => {
      this.handlers.prompt?.(prompt, this.seat);
    });
    this.client.onGameOver((msg) => {
      console.log("[OnlineSession] game_over", msg);
      this.gameEnded = true;
      this.handlers.gameOver?.(msg, this.seat);
    });
    this.client.onRematchStatus((msg) => {
      console.log("[OnlineSession] rematch_status", msg);
      // Se rematch está pronto, resetar gameEnded
      if (msg.ready) {
        this.gameEnded = false;
      }
      this.handlers.rematchStatus?.(msg, this.seat);
    });

    this.client.connect(roomId, playerName);
    this.handlers.status?.({
      connected: false,
      seat: null,
      roomId,
    });
  }

  ready() {
    this.client?.send({ type: "ready" });
  }

  disconnect() {
    this.client?.disconnect();
    this.connected = false;
    this.snapshot = null;
    this.seat = null;
    this.handlers.status?.({ connected: false, seat: null, roomId: null });
  }

  sendAction(actionType, payload = {}) {
    if (!this.client) return;
    this.client.sendAction(actionType, payload);
  }

  sendIntentCardClick(zone, index) {
    this.client?.sendIntentCardClick(zone, index);
  }

  sendPromptResponse(promptId, choice) {
    this.client?.sendPromptResponse(promptId, choice);
  }

  sendRematchRequest() {
    this.client?.sendRematchRequest();
  }
}
