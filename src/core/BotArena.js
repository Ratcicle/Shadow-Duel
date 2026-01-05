import Player from "./Player.js";
import Renderer from "../ui/Renderer.js";
import { cardDatabaseById } from "../data/cards.js";

const STORAGE_DECK_KEY = "shadow_duel_deck";
const STORAGE_EXTRA_DECK_KEY = "shadow_duel_extra_deck";
const DEFAULT_MAX_TURNS = 50;
const DEFAULT_TIMEOUT_MS = 30000;

const SPEED_PRESETS = {
  "1x": {
    phaseDelayMs: 400,
    actionDelayMs: 500,
    battleDelayMs: 800,
    pollIntervalMs: 50,
    useRenderer: true,
  },
  "2x": {
    phaseDelayMs: 200,
    actionDelayMs: 250,
    battleDelayMs: 400,
    pollIntervalMs: 25,
    useRenderer: true,
  },
  "4x": {
    phaseDelayMs: 100,
    actionDelayMs: 125,
    battleDelayMs: 200,
    pollIntervalMs: 15,
    useRenderer: false,
  },
  instant: {
    phaseDelayMs: 0,
    actionDelayMs: 0,
    battleDelayMs: 0,
    pollIntervalMs: 5,
    useRenderer: false,
  },
};

function createNullRenderer() {
  const noop = () => {};
  return new Proxy(
    {},
    {
      get: () => noop,
    }
  );
}

function readStoredIds(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => Number(value))
      .filter((id) => Number.isFinite(id) && cardDatabaseById.has(id));
  } catch (err) {
    return [];
  }
}

export default class BotArena {
  constructor(GameClass, BotClass, _shadowHeartStrategy, _luminarchStrategy) {
    this.GameClass = GameClass;
    this.BotClass = BotClass;
    this.isRunning = false;
    this.stopRequested = false;
    this.activeGame = null;
    this.renderer = null;
    this.maxTurns = DEFAULT_MAX_TURNS;
    this.timeoutMs = DEFAULT_TIMEOUT_MS;
  }

  getSpeedConfig(speed) {
    return SPEED_PRESETS[speed] || SPEED_PRESETS["1x"];
  }

  loadStoredDeckData() {
    return {
      main: readStoredIds(STORAGE_DECK_KEY),
      extra: readStoredIds(STORAGE_EXTRA_DECK_KEY),
    };
  }

  applyCustomDeck(bot, deckData) {
    const main = Array.isArray(deckData?.main) ? deckData.main : [];
    const extra = Array.isArray(deckData?.extra) ? deckData.extra : [];
    bot.buildDeck = () => Player.prototype.buildDeck.call(bot, main);
    bot.buildExtraDeck = () => Player.prototype.buildExtraDeck.call(bot, extra);
  }

  createBot(preset, seatId, deckData) {
    const isDefault = preset === "default";
    const usePreset = isDefault ? "shadowheart" : preset || "shadowheart";
    const bot = new this.BotClass(usePreset);
    bot.id = seatId;
    bot.name = seatId === "player" ? "Bot 1" : "Bot 2";
    bot.controllerType = "ai";
    bot.debug = false;
    if (isDefault) {
      this.applyCustomDeck(bot, deckData);
    }
    return bot;
  }

  createGame(preset1, preset2, speedConfig, deckData) {
    const renderer = speedConfig.useRenderer
      ? this.renderer || new Renderer()
      : createNullRenderer();
    if (speedConfig.useRenderer && !this.renderer) {
      this.renderer = renderer;
    }

    const game = new this.GameClass({ renderer });
    game.phaseDelayMs = speedConfig.phaseDelayMs;
    game.aiActionDelayMs = speedConfig.actionDelayMs;
    game.aiBattleDelayMs = speedConfig.battleDelayMs;
    if (game.ui) {
      game.ui.showAlert = () => {};
    }

    game.bindCardInteractions = () => {};
    if (game.ui && typeof game.ui.bindPhaseClick === "function") {
      game.ui.bindPhaseClick = () => {};
    }

    const bot1 = this.createBot(preset1, "player", deckData);
    const bot2 = this.createBot(preset2, "bot", deckData);

    game.player = bot1;
    game.bot = bot2;
    game.player.game = game;
    game.bot.game = game;

    return game;
  }

  async waitForGameEnd(game, speedConfig) {
    const pollInterval = Math.max(5, speedConfig.pollIntervalMs || 25);
    const startTime = Date.now();

    return new Promise((resolve) => {
      const tick = () => {
        if (this.stopRequested) {
          game.gameOver = true;
          resolve({ type: "cancelled", reason: "stopped" });
          return;
        }

        if ((game.player?.lp || 0) <= 0 || (game.bot?.lp || 0) <= 0) {
          game.gameOver = true;
          resolve({ type: "completed", reason: "lp_zero" });
          return;
        }

        if (game.gameOver) {
          resolve({ type: "completed" });
          return;
        }

        if (game.turnCounter >= this.maxTurns) {
          game.gameOver = true;
          resolve({ type: "draw", reason: "max_turns" });
          return;
        }

        if (Date.now() - startTime >= this.timeoutMs) {
          game.gameOver = true;
          resolve({ type: "draw", reason: "timeout" });
          return;
        }

        setTimeout(tick, pollInterval);
      };

      setTimeout(tick, pollInterval);
    });
  }

  resolveWinner(game, outcome) {
    if (outcome.type === "cancelled") return "draw";
    if (game.winner === "player" || game.winner === "bot") {
      return game.winner;
    }
    if ((game.player?.lp || 0) <= 0) return "bot";
    if ((game.bot?.lp || 0) <= 0) return "player";
    return "draw";
  }

  async runDuel(preset1, preset2, speedConfig, duelNumber, deckData) {
    const game = this.createGame(preset1, preset2, speedConfig, deckData);
    this.activeGame = game;

    if (speedConfig.useRenderer) {
      const logEl = document.getElementById("action-log-list");
      if (logEl) logEl.innerHTML = "";
    }

    game.start();

    const outcome = await this.waitForGameEnd(game, speedConfig);
    this.activeGame = null;

    if (outcome.type === "cancelled") {
      return { type: "cancelled", duelNumber };
    }

    const winner = this.resolveWinner(game, outcome);
    return {
      duelNumber,
      winner,
      turns: game.turnCounter || 0,
      type: outcome.type,
      reason: outcome.reason || null,
    };
  }

  stop() {
    this.stopRequested = true;
    if (this.activeGame) {
      this.activeGame.gameOver = true;
    }
  }

  async startArena(
    preset1,
    preset2,
    numDuels,
    speed,
    autoPause,
    onProgress,
    onComplete
  ) {
    this.isRunning = true;
    this.stopRequested = false;

    const speedConfig = this.getSpeedConfig(speed);
    const deckData = this.loadStoredDeckData();
    const stats = {
      completed: 0,
      wins1: 0,
      wins2: 0,
      draws: 0,
      totalTurns: 0,
    };

    for (let i = 1; i <= numDuels; i += 1) {
      if (this.stopRequested) break;

      let result;
      try {
        result = await this.runDuel(
          preset1,
          preset2,
          speedConfig,
          i,
          deckData
        );
      } catch (err) {
        result = {
          duelNumber: i,
          winner: "draw",
          turns: 0,
          type: "error",
          message: err?.message || "Unknown error",
        };
      }

      if (!result || result.type === "cancelled") {
        break;
      }

      stats.completed += 1;
      stats.totalTurns += result.turns || 0;

      if (result.winner === "player") {
        stats.wins1 += 1;
      } else if (result.winner === "bot") {
        stats.wins2 += 1;
      } else {
        stats.draws += 1;
      }

      const avgTurns =
        stats.completed > 0
          ? (stats.totalTurns / stats.completed).toFixed(1)
          : "-";

      if (typeof onProgress === "function") {
        onProgress({
          completed: stats.completed,
          wins1: stats.wins1,
          wins2: stats.wins2,
          draws: stats.draws,
          avgTurns,
          lastResult: result,
        });
      }

      if (autoPause && (result.type === "error" || result.winner === "draw")) {
        this.stopRequested = true;
        break;
      }
    }

    this.isRunning = false;

    if (typeof onComplete === "function") {
      const avgTurns =
        stats.completed > 0
          ? (stats.totalTurns / stats.completed).toFixed(1)
          : "-";
      onComplete({
        completed: stats.completed,
        wins1: stats.wins1,
        wins2: stats.wins2,
        draws: stats.draws,
        avgTurns,
      });
    }
  }
}
