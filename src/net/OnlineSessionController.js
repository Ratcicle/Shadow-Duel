import NetworkClient from "./NetworkClient.js";

export default class OnlineSessionController {
  constructor() {
    this.client = null;
    this.seat = null;
    this.snapshot = null;
    this.connected = false;
    this.handlers = {
      state: null,
      error: null,
      start: null,
      info: null,
      prompt: null,
      status: null,
    };
  }

  setHandlers(handlers = {}) {
    this.handlers = { ...this.handlers, ...handlers };
  }

  connect(url, roomId, playerName) {
    if (this.client) {
      this.disconnect();
    }
    this.client = new NetworkClient(url);
    this.client.onStart((msg) => {
      this.seat = msg.youAre;
      this.connected = true;
      this.handlers.start?.(msg);
      this.handlers.status?.({
        connected: true,
        seat: this.seat,
        roomId: msg.roomId,
      });
    });
    this.client.onState((state) => {
      this.connected = true;
      this.snapshot = state;
      this.handlers.state?.(state, this.seat);
    });
    this.client.onError((err) => {
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
}
