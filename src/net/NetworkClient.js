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
    };
    this.seq = 0;
    this.seat = null;
  }

  connect(roomId = "default", playerName = null) {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.send({
        type: "join_room",
        roomId,
        playerName,
      });
    };
    this.ws.onmessage = (evt) => this.handleMessage(evt);
    this.ws.onerror = (err) => this.handlers.error?.(err);
    this.ws.onclose = () =>
      this.handlers.error?.({ message: "Connection closed" });
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

  handleMessage(evt) {
    let msg = null;
    try {
      msg = JSON.parse(evt.data);
    } catch (err) {
      return;
    }
    if (!msg || typeof msg.type !== "string") return;
    switch (msg.type) {
      case "match_start":
        this.seat = msg.youAre;
        this.handlers.start?.(msg);
        break;
      case "state_update":
        this.handlers.state?.(msg.state);
        break;
      case "prompt_request":
        this.handlers.prompt?.(msg);
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
    this.seq += 1;
    this.send({
      type: "action",
      actionType,
      seq: this.seq,
      payload,
    });
  }

  sendIntentCardClick(zone, index) {
    this.send({
      type: "intent_card_click",
      zone,
      index,
    });
  }

  sendPromptResponse(promptId, choice) {
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
