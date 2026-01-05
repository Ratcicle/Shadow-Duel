import Player from "./Player.js";
import Renderer from "../ui/Renderer.js";
import { cardDatabaseById } from "../data/cards.js";
import {
  ArenaAnalytics,
  DuelTracker,
  END_REASONS,
} from "./ai/ArenaAnalytics.js";

const STORAGE_DECK_KEY = "shadow_duel_deck";
const STORAGE_EXTRA_DECK_KEY = "shadow_duel_extra_deck";
const DEFAULT_MAX_TURNS = 50;

/**
 * Speed presets com timeout escalável.
 * Speeds mais rápidos têm timeout proporcionalmente menor para não enviesar métricas.
 */
const SPEED_PRESETS = {
  "1x": {
    phaseDelayMs: 400,
    actionDelayMs: 500,
    battleDelayMs: 800,
    pollIntervalMs: 50,
    useRenderer: true,
    timeoutMs: 60000, // 60s para velocidade normal
    beamWidth: 2,
    maxDepth: 2,
  },
  "2x": {
    phaseDelayMs: 200,
    actionDelayMs: 250,
    battleDelayMs: 400,
    pollIntervalMs: 25,
    useRenderer: true,
    timeoutMs: 45000, // 45s
    beamWidth: 2,
    maxDepth: 2,
  },
  "4x": {
    phaseDelayMs: 100,
    actionDelayMs: 125,
    battleDelayMs: 200,
    pollIntervalMs: 15,
    useRenderer: false,
    timeoutMs: 30000, // 30s
    beamWidth: 2,
    maxDepth: 2,
  },
  instant: {
    phaseDelayMs: 0,
    actionDelayMs: 0,
    battleDelayMs: 0,
    pollIntervalMs: 5,
    useRenderer: false,
    timeoutMs: 20000, // 20s - mais agressivo para instant
    beamWidth: 2,
    maxDepth: 2,
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

    // Analytics integrado
    this.analytics = new ArenaAnalytics({
      enabled: true,
      trackDecisionTime: true,
      trackNodesVisited: true,
      trackOpeningBook: true,
      openingBookDepth: 2,
    });

    // Configurações customizáveis
    this.customTimeoutMs = null; // null = usar do speed preset
    this.customBeamWidth = null;
    this.customMaxDepth = null;
  }

  /**
   * Configura timeout customizado (sobrescreve o do speed preset).
   * @param {number|null} ms - Timeout em ms, ou null para usar default do preset
   */
  setCustomTimeout(ms) {
    this.customTimeoutMs = ms;
  }

  /**
   * Configura parâmetros de busca customizados.
   * @param {Object} options
   */
  setSearchParams(options = {}) {
    if (options.beamWidth != null) this.customBeamWidth = options.beamWidth;
    if (options.maxDepth != null) this.customMaxDepth = options.maxDepth;
  }

  /**
   * Retorna instância de analytics para acesso externo.
   * @returns {ArenaAnalytics}
   */
  getAnalytics() {
    return this.analytics;
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

    // Configurar parâmetros de busca na game (para bots usarem)
    game.arenaBeamWidth = this.customBeamWidth ?? speedConfig.beamWidth ?? 2;
    game.arenaMaxDepth = this.customMaxDepth ?? speedConfig.maxDepth ?? 2;

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

  /**
   * Resolve o timeout efetivo (custom ou do speed preset).
   * @param {Object} speedConfig
   * @returns {number}
   */
  getEffectiveTimeout(speedConfig) {
    if (this.customTimeoutMs != null) {
      return this.customTimeoutMs;
    }
    return speedConfig.timeoutMs ?? 30000;
  }

  async waitForGameEnd(game, speedConfig) {
    const pollInterval = Math.max(5, speedConfig.pollIntervalMs || 25);
    const startTime = Date.now();
    const timeoutMs = this.getEffectiveTimeout(speedConfig);

    return new Promise((resolve) => {
      const tick = () => {
        if (this.stopRequested) {
          game.gameOver = true;
          resolve({ type: "cancelled", reason: END_REASONS.CANCELLED });
          return;
        }

        if ((game.player?.lp || 0) <= 0 || (game.bot?.lp || 0) <= 0) {
          game.gameOver = true;
          resolve({ type: "completed", reason: END_REASONS.LP_ZERO });
          return;
        }

        if (game.gameOver) {
          resolve({ type: "completed", reason: END_REASONS.LP_ZERO });
          return;
        }

        if (game.turnCounter >= this.maxTurns) {
          game.gameOver = true;
          resolve({ type: "draw", reason: END_REASONS.MAX_TURNS });
          return;
        }

        if (Date.now() - startTime >= timeoutMs) {
          game.gameOver = true;
          resolve({ type: "draw", reason: END_REASONS.TIMEOUT });
          return;
        }

        setTimeout(tick, pollInterval);
      };

      setTimeout(tick, pollInterval);
    });
  }

  resolveWinner(game, outcome) {
    if (outcome.type === "cancelled") return "draw";
    
    // Se o jogo já determinou um vencedor
    if (game.winner === "player" || game.winner === "bot") {
      return game.winner;
    }
    
    // Se alguém ficou sem LP
    if ((game.player?.lp || 0) <= 0) return "bot";
    if ((game.bot?.lp || 0) <= 0) return "player";
    
    // Se terminou por MAX_TURNS ou TIMEOUT, vence quem tem mais LP
    if (outcome.reason === END_REASONS.MAX_TURNS || outcome.reason === END_REASONS.TIMEOUT) {
      const playerLP = game.player?.lp || 0;
      const botLP = game.bot?.lp || 0;
      
      if (playerLP > botLP) return "player";
      if (botLP > playerLP) return "bot";
      // Se LP igual, é empate
      return "draw";
    }
    
    return "draw";
  }

  async runDuel(preset1, preset2, speedConfig, duelNumber, deckData) {
    const game = this.createGame(preset1, preset2, speedConfig, deckData);
    this.activeGame = game;

    // Determinar arquétipos
    const arch1 = preset1 === "default" ? "custom" : preset1;
    const arch2 = preset2 === "default" ? "custom" : preset2;

    // Criar tracker para este duelo
    const tracker = new DuelTracker(duelNumber, arch1, arch2, {
      beamWidth: game.arenaBeamWidth,
      maxDepth: game.arenaMaxDepth,
    });

    // Injetar tracker no game para coleta de métricas durante execução
    game._arenaTracker = tracker;

    if (speedConfig.useRenderer) {
      const logEl = document.getElementById("action-log-list");
      if (logEl) logEl.innerHTML = "";
    }

    const duelStartTime = Date.now();
    game.start();

    const outcome = await this.waitForGameEnd(game, speedConfig);
    this.activeGame = null;

    if (outcome.type === "cancelled") {
      return { type: "cancelled", duelNumber };
    }

    const winner = this.resolveWinner(game, outcome);
    const totalTimeMs = Date.now() - duelStartTime;

    // Finalizar tracker e registrar no analytics
    const duelResult = tracker.finalize(winner, outcome.reason, {
      player: game.player?.lp ?? 0,
      bot: game.bot?.lp ?? 0,
    });
    duelResult.totalTimeMs = totalTimeMs;

    this.analytics.recordDuel(duelResult);

    return {
      duelNumber,
      winner,
      turns: game.turnCounter || 0,
      type: outcome.type,
      reason: outcome.reason || null,
      totalTimeMs,
      archetype1: arch1,
      archetype2: arch2,
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

    // Iniciar batch de analytics
    this.analytics.reset();
    this.analytics.startBatch();

    const speedConfig = this.getSpeedConfig(speed);
    const deckData = this.loadStoredDeckData();
    const stats = {
      completed: 0,
      wins1: 0,
      wins2: 0,
      draws: 0,
      drawsByTimeout: 0,
      drawsByMaxTurns: 0,
      totalTurns: 0,
      totalTimeMs: 0,
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
          reason: END_REASONS.ERROR,
          message: err?.message || "Unknown error",
          totalTimeMs: 0,
        };

        // Registrar erro no analytics
        this.analytics.recordDuel({
          duelNumber: i,
          archetype1: preset1 === "default" ? "custom" : preset1,
          archetype2: preset2 === "default" ? "custom" : preset2,
          winner: "draw",
          turns: 0,
          reason: END_REASONS.ERROR,
          finalLP: { player: 0, bot: 0 },
          totalTimeMs: 0,
        });
      }

      if (!result || result.type === "cancelled") {
        break;
      }

      stats.completed += 1;
      stats.totalTurns += result.turns || 0;
      stats.totalTimeMs += result.totalTimeMs || 0;

      if (result.winner === "player") {
        stats.wins1 += 1;
      } else if (result.winner === "bot") {
        stats.wins2 += 1;
      } else {
        stats.draws += 1;
        // Categorizar tipo de draw
        if (result.reason === END_REASONS.TIMEOUT) {
          stats.drawsByTimeout += 1;
        } else if (result.reason === END_REASONS.MAX_TURNS) {
          stats.drawsByMaxTurns += 1;
        }
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
          drawsByTimeout: stats.drawsByTimeout,
          drawsByMaxTurns: stats.drawsByMaxTurns,
          avgTurns,
          lastResult: result,
        });
      }

      if (autoPause && (result.type === "error" || result.winner === "draw")) {
        this.stopRequested = true;
        break;
      }
    }

    // Finalizar batch
    this.analytics.endBatch();
    this.isRunning = false;

    if (typeof onComplete === "function") {
      const batchStats = this.analytics.getBatchStats();
      onComplete({
        completed: stats.completed,
        wins1: stats.wins1,
        wins2: stats.wins2,
        draws: stats.draws,
        drawsByTimeout: stats.drawsByTimeout,
        drawsByMaxTurns: stats.drawsByMaxTurns,
        avgTurns: batchStats.avgTurns?.toFixed(1) ?? "-",
        avgDecisionTimeMs: batchStats.avgDecisionTimeMs,
        batchDurationMs: batchStats.batchDurationMs,
        endReasonBreakdown: batchStats.endReasonBreakdown,
        // Referência ao analytics para export
        analytics: this.analytics,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Métodos de export para acesso fácil
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Exporta resultados como CSV.
   */
  exportCSV() {
    return this.analytics.exportAsCSV();
  }

  /**
   * Exporta resultados como JSONL.
   */
  exportJSONL() {
    return this.analytics.exportAsJSONL();
  }

  /**
   * Exporta resumo agregado.
   */
  exportSummary() {
    return this.analytics.exportSummary();
  }

  /**
   * Faz download do CSV no browser.
   */
  downloadCSV(filename = "arena_results.csv") {
    this.analytics.downloadCSV(filename);
  }

  /**
   * Faz download do JSONL no browser.
   */
  downloadJSONL(filename = "arena_results.jsonl") {
    this.analytics.downloadJSONL(filename);
  }

  /**
   * Faz download do resumo no browser.
   */
  downloadSummary(filename = "arena_summary.json") {
    this.analytics.downloadSummary(filename);
  }
}
