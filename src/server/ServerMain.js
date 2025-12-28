import { WebSocketServer } from "ws";
import { MatchManager } from "./MatchManager.js";

const PORT = process.env.PORT || 8080;
const manager = new MatchManager();

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  manager.attachConnection(ws);
});

wss.on("listening", () => {
  console.log(`[Shadow Duel] WS server listening on ws://localhost:${PORT}`);
});

wss.on("error", (err) => {
  console.error("[Shadow Duel] WS server error:", err);
});
