// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/ArenaAnalytics.js
// Telemetria e analytics para BotArena — foco em métricas, não em policy.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Razões de término de duelo para categorização.
 */
export const END_REASONS = {
  LP_ZERO: "lp_zero",
  DECK_OUT: "deck_out",
  SURRENDER: "surrender",
  MAX_TURNS: "max_turns",
  TIMEOUT: "timeout",
  ERROR: "error",
  CANCELLED: "cancelled",
};

/**
 * Classe para coletar e agregar métricas de duelos.
 * Focada em analytics, não em aprendizado de policy.
 */
export class ArenaAnalytics {
  constructor(options = {}) {
    /** @type {boolean} */
    this.enabled = options.enabled !== false;

    /** @type {boolean} */
    this.trackDecisionTime = options.trackDecisionTime ?? true;

    /** @type {boolean} */
    this.trackNodesVisited = options.trackNodesVisited ?? true;

    /** @type {boolean} */
    this.trackOpeningBook = options.trackOpeningBook ?? false;

    /** @type {number} Quantos turnos iniciais rastrear para opening book */
    this.openingBookDepth = options.openingBookDepth ?? 2;

    // Reset stats
    this.reset();
  }

  /**
   * Reseta todas as métricas.
   */
  reset() {
    /** @type {DuelRecord[]} */
    this.duelRecords = [];

    /** @type {Map<string, MatchupStats>} Chave: "archetype1_vs_archetype2" */
    this.matchupStats = new Map();

    /** @type {Map<string, number>} Contagem de cartas jogadas */
    this.cardPlayCounts = new Map();

    /** @type {Map<string, number>} Contagem de ações por tipo */
    this.actionTypeCounts = new Map();

    /** @type {Map<string, {success: number, fail: number}>} Taxa de falhas por tipo de ação */
    this.actionFailureRates = new Map();

    /** @type {Object} Distribuição de duração de duelos */
    this.duelDurationDistribution = {
      veryShort: 0, // 1-5 turnos
      short: 0, // 6-10 turnos
      medium: 0, // 11-20 turnos
      long: 0, // 21-35 turnos
      veryLong: 0, // 36+ turnos
    };

    /** @type {Object} Win conditions breakdown */
    this.winConditions = {
      lpZero: 0,
      deckOut: 0,
      timeout: 0,
      maxTurns: 0,
      error: 0,
      surrender: 0,
    };

    /** @type {Object} Game phase metrics */
    this.phaseMetrics = {
      earlyGameWins: 0, // 1-7 turnos
      midGameWins: 0, // 8-15 turnos
      lateGameWins: 0, // 16+ turnos
      earlyGameLosses: 0,
      midGameLosses: 0,
      lateGameLosses: 0,
    };

    /** @type {OpeningBook} */
    this.openingBook = {
      sequences: new Map(), // "arch" -> Map<sequenceHash, { wins, total }>
    };

    /** @type {number[]} Tempos de decisão em ms */
    this.decisionTimes = [];

    /** @type {number[]} Nós visitados por turno */
    this.nodesPerTurn = [];

    /** @type {number} Timestamp de início do batch */
    this.batchStartTime = null;

    /** @type {number} Timestamp de fim do batch */
    this.batchEndTime = null;
  }

  /**
   * Inicia um novo batch de duelos.
   */
  startBatch() {
    this.batchStartTime = Date.now();
    this.batchEndTime = null;
  }

  /**
   * Finaliza o batch atual.
   */
  endBatch() {
    this.batchEndTime = Date.now();
  }

  /**
   * Registra o resultado de um duelo.
   * @param {DuelResult} result
   */
  recordDuel(result) {
    if (!this.enabled) return;

    const record = {
      duelNumber: result.duelNumber,
      timestamp: Date.now(),
      seed: result.seed ?? null,
      archetype1: result.archetype1 ?? "unknown",
      archetype2: result.archetype2 ?? "unknown",
      winner: result.winner, // "player" | "bot" | "draw"
      winnerArchetype: this.resolveWinnerArchetype(result),
      turns: result.turns ?? 0,
      endReason: result.reason ?? END_REASONS.LP_ZERO,
      finalLP: {
        player: result.finalLP?.player ?? 0,
        bot: result.finalLP?.bot ?? 0,
      },
      totalTimeMs: result.totalTimeMs ?? 0,
      avgDecisionTimeMs: result.avgDecisionTimeMs ?? null,
      totalNodesVisited: result.totalNodesVisited ?? null,
      beamWidth: result.beamWidth ?? null,
      maxDepth: result.maxDepth ?? null,
      cardsPlayed: result.cardsPlayed ?? [],
      actionsExecuted: result.actionsExecuted ?? [],
      openingSequence: result.openingSequence ?? null,
    };

    this.duelRecords.push(record);
    this.updateMatchupStats(record);
    this.updateCardCounts(record);
    this.updateActionCounts(record);
    this.updateDuelDurationDistribution(record);
    this.updateWinConditions(record);
    this.updatePhaseMetrics(record);

    if (this.trackOpeningBook && record.openingSequence) {
      this.updateOpeningBook(record);
    }
  }

  /**
   * Resolve qual arquétipo venceu.
   * @private
   */
  resolveWinnerArchetype(result) {
    if (result.winner === "draw") return null;
    if (result.winner === "player") return result.archetype1;
    if (result.winner === "bot") return result.archetype2;
    return null;
  }

  /**
   * Atualiza estatísticas de matchup.
   * @private
   */
  updateMatchupStats(record) {
    const key = `${record.archetype1}_vs_${record.archetype2}`;
    const reverseKey = `${record.archetype2}_vs_${record.archetype1}`;

    if (!this.matchupStats.has(key)) {
      this.matchupStats.set(key, this.createEmptyMatchupStats());
    }

    const stats = this.matchupStats.get(key);
    stats.total += 1;
    stats.totalTurns += record.turns;

    if (record.winner === "player") {
      stats.wins1 += 1;
    } else if (record.winner === "bot") {
      stats.wins2 += 1;
    } else {
      stats.draws += 1;
    }

    // Categorizar razão de término
    stats.endReasons[record.endReason] =
      (stats.endReasons[record.endReason] || 0) + 1;

    // Decision time
    if (record.avgDecisionTimeMs != null) {
      stats.decisionTimes.push(record.avgDecisionTimeMs);
    }

    // Nodes visited
    if (record.totalNodesVisited != null) {
      stats.nodesVisited.push(record.totalNodesVisited);
    }
  }

  /**
   * Cria estrutura vazia de matchup stats.
   * @private
   */
  createEmptyMatchupStats() {
    return {
      total: 0,
      wins1: 0,
      wins2: 0,
      draws: 0,
      totalTurns: 0,
      endReasons: {},
      decisionTimes: [],
      nodesVisited: [],
    };
  }

  /**
   * Atualiza contagem de cartas jogadas.
   * @private
   */
  updateCardCounts(record) {
    for (const cardName of record.cardsPlayed || []) {
      this.cardPlayCounts.set(
        cardName,
        (this.cardPlayCounts.get(cardName) || 0) + 1
      );
    }
  }

  /**
   * Atualiza contagem de tipos de ação.
   * @private
   */
  updateActionCounts(record) {
    for (const action of record.actionsExecuted || []) {
      const actionType = action.type ?? "unknown";
      this.actionTypeCounts.set(
        actionType,
        (this.actionTypeCounts.get(actionType) || 0) + 1
      );
    }
  }

  /**
   * Atualiza distribuição de duração de duelos.
   * @private
   */
  updateDuelDurationDistribution(record) {
    const turns = record.turns || 0;
    if (turns <= 5) this.duelDurationDistribution.veryShort += 1;
    else if (turns <= 10) this.duelDurationDistribution.short += 1;
    else if (turns <= 20) this.duelDurationDistribution.medium += 1;
    else if (turns <= 35) this.duelDurationDistribution.long += 1;
    else this.duelDurationDistribution.veryLong += 1;
  }

  /**
   * Atualiza win conditions breakdown.
   * @private
   */
  updateWinConditions(record) {
    const reason = record.endReason || END_REASONS.LP_ZERO;
    if (reason === END_REASONS.LP_ZERO) this.winConditions.lpZero += 1;
    else if (reason === END_REASONS.DECK_OUT) this.winConditions.deckOut += 1;
    else if (reason === END_REASONS.TIMEOUT) this.winConditions.timeout += 1;
    else if (reason === END_REASONS.MAX_TURNS) this.winConditions.maxTurns += 1;
    else if (reason === END_REASONS.ERROR) this.winConditions.error += 1;
    else if (reason === END_REASONS.SURRENDER)
      this.winConditions.surrender += 1;
  }

  /**
   * Atualiza métricas de fase do jogo.
   * @private
   */
  updatePhaseMetrics(record) {
    const turns = record.turns || 0;
    const isWin = record.winner === "player";

    if (turns <= 7) {
      if (isWin) this.phaseMetrics.earlyGameWins += 1;
      else if (record.winner === "bot") this.phaseMetrics.earlyGameLosses += 1;
    } else if (turns <= 15) {
      if (isWin) this.phaseMetrics.midGameWins += 1;
      else if (record.winner === "bot") this.phaseMetrics.midGameLosses += 1;
    } else {
      if (isWin) this.phaseMetrics.lateGameWins += 1;
      else if (record.winner === "bot") this.phaseMetrics.lateGameLosses += 1;
    }
  }

  /**
   * Atualiza opening book com sequência de abertura.
   * @private
   */
  updateOpeningBook(record) {
    const arch = record.archetype1;
    const seq = record.openingSequence;
    if (!arch || !seq) return;

    const seqHash = this.hashOpeningSequence(seq);
    const isWin = record.winner === "player";

    if (!this.openingBook.sequences.has(arch)) {
      this.openingBook.sequences.set(arch, new Map());
    }

    const archBook = this.openingBook.sequences.get(arch);
    if (!archBook.has(seqHash)) {
      archBook.set(seqHash, { sequence: seq, wins: 0, total: 0 });
    }

    const entry = archBook.get(seqHash);
    entry.total += 1;
    if (isWin) entry.wins += 1;
  }

  /**
   * Gera hash para sequência de abertura.
   * @private
   */
  hashOpeningSequence(sequence) {
    return sequence
      .map((action) => `${action.type}:${action.cardName || action.index}`)
      .join("|");
  }

  /**
   * Registra tempo de decisão individual.
   * @param {number} timeMs
   */
  recordDecisionTime(timeMs) {
    if (!this.enabled || !this.trackDecisionTime) return;
    this.decisionTimes.push(timeMs);
  }

  /**
   * Registra nós visitados em um turno.
   * @param {number} nodes
   */
  recordNodesVisited(nodes) {
    if (!this.enabled || !this.trackNodesVisited) return;
    this.nodesPerTurn.push(nodes);
  }

  /**
   * Calcula métrica de aggressiveness baseado em duração de duelos.
   * @private
   * @returns {Object}
   */
  calculateAggressiveness() {
    const total = this.duelRecords.length;
    if (total === 0) return { score: 0, rating: "unknown" };

    const dist = this.duelDurationDistribution;
    const shortGames = dist.veryShort + dist.short;
    const longGames = dist.long + dist.veryLong;

    // Score: quanto menor a duração média, mais agressivo
    const avgTurns =
      this.duelRecords.reduce((sum, r) => sum + (r.turns || 0), 0) / total;
    const score = Math.max(0, 100 - avgTurns * 3); // 10 turnos = 70 score

    let rating = "balanced";
    if (score >= 80) rating = "very_aggressive";
    else if (score >= 60) rating = "aggressive";
    else if (score >= 40) rating = "balanced";
    else if (score >= 20) rating = "defensive";
    else rating = "very_defensive";

    return {
      score: score.toFixed(1),
      rating,
      avgTurns: avgTurns.toFixed(1),
      shortGamesPercent: ((shortGames / total) * 100).toFixed(1),
      longGamesPercent: ((longGames / total) * 100).toFixed(1),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Getters de métricas agregadas
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Retorna estatísticas agregadas do batch atual.
   * @returns {BatchStats}
   */
  getBatchStats() {
    const total = this.duelRecords.length;
    if (total === 0) {
      return {
        total: 0,
        wins1: 0,
        wins2: 0,
        draws: 0,
        winRate1: 0,
        winRate2: 0,
        avgTurns: 0,
        avgDecisionTimeMs: null,
        avgNodesPerTurn: null,
        batchDurationMs: 0,
        endReasonBreakdown: {},
      };
    }

    let wins1 = 0;
    let wins2 = 0;
    let draws = 0;
    let totalTurns = 0;
    const endReasons = {};

    for (const record of this.duelRecords) {
      if (record.winner === "player") wins1 += 1;
      else if (record.winner === "bot") wins2 += 1;
      else draws += 1;

      totalTurns += record.turns;
      endReasons[record.endReason] = (endReasons[record.endReason] || 0) + 1;
    }

    const avgDecision =
      this.decisionTimes.length > 0
        ? this.decisionTimes.reduce((a, b) => a + b, 0) /
          this.decisionTimes.length
        : null;

    const avgNodes =
      this.nodesPerTurn.length > 0
        ? this.nodesPerTurn.reduce((a, b) => a + b, 0) /
          this.nodesPerTurn.length
        : null;

    return {
      total,
      wins1,
      wins2,
      draws,
      winRate1: (wins1 / total) * 100,
      winRate2: (wins2 / total) * 100,
      avgTurns: totalTurns / total,
      avgDecisionTimeMs: avgDecision,
      avgNodesPerTurn: avgNodes,
      batchDurationMs:
        this.batchEndTime && this.batchStartTime
          ? this.batchEndTime - this.batchStartTime
          : null,
      endReasonBreakdown: endReasons,
      duelDurationDistribution: { ...this.duelDurationDistribution },
      winConditionsBreakdown: { ...this.winConditions },
      phaseMetrics: { ...this.phaseMetrics },
      aggressiveness: this.calculateAggressiveness(),
    };
  }

  /**
   * Retorna estatísticas por matchup.
   * @param {string} archetype1
   * @param {string} archetype2
   * @returns {MatchupStats|null}
   */
  getMatchupStats(archetype1, archetype2) {
    const key = `${archetype1}_vs_${archetype2}`;
    return this.matchupStats.get(key) || null;
  }

  /**
   * Retorna todas as estatísticas de matchup.
   * @returns {Object<string, MatchupStats>}
   */
  getAllMatchupStats() {
    const result = {};
    for (const [key, stats] of this.matchupStats.entries()) {
      result[key] = {
        ...stats,
        winRate1:
          stats.total > 0 ? ((stats.wins1 / stats.total) * 100).toFixed(1) : 0,
        winRate2:
          stats.total > 0 ? ((stats.wins2 / stats.total) * 100).toFixed(1) : 0,
        avgTurns:
          stats.total > 0 ? (stats.totalTurns / stats.total).toFixed(1) : 0,
        avgDecisionTimeMs:
          stats.decisionTimes.length > 0
            ? (
                stats.decisionTimes.reduce((a, b) => a + b, 0) /
                stats.decisionTimes.length
              ).toFixed(1)
            : null,
      };
    }
    return result;
  }

  /**
   * Retorna top N cartas mais jogadas.
   * @param {number} n
   * @returns {Array<{card: string, count: number}>}
   */
  getTopPlayedCards(n = 10) {
    const sorted = [...this.cardPlayCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);

    return sorted.map(([card, count]) => ({ card, count }));
  }

  /**
   * Retorna top N ações mais frequentes.
   * @param {number} n
   * @returns {Array<{action: string, count: number}>}
   */
  getTopActions(n = 10) {
    const sorted = [...this.actionTypeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);

    return sorted.map(([action, count]) => ({ action, count }));
  }

  /**
   * Retorna melhores sequências de abertura para um arquétipo.
   * @param {string} archetype
   * @param {number} minGames - Mínimo de jogos para considerar
   * @returns {Array<{sequence: Array, winRate: number, total: number}>}
   */
  getBestOpenings(archetype, minGames = 3) {
    if (!this.openingBook.sequences.has(archetype)) {
      return [];
    }

    const archBook = this.openingBook.sequences.get(archetype);
    const results = [];

    for (const [, data] of archBook.entries()) {
      if (data.total >= minGames) {
        results.push({
          sequence: data.sequence,
          winRate: (data.wins / data.total) * 100,
          wins: data.wins,
          total: data.total,
        });
      }
    }

    return results.sort((a, b) => b.winRate - a.winRate);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Export de dados
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Exporta todos os registros como JSONL (JSON Lines).
   * @returns {string}
   */
  exportAsJSONL() {
    return this.duelRecords.map((record) => JSON.stringify(record)).join("\n");
  }

  /**
   * Exporta todos os registros como CSV.
   * @returns {string}
   */
  exportAsCSV() {
    if (this.duelRecords.length === 0) return "";

    const headers = [
      "duelNumber",
      "timestamp",
      "seed",
      "archetype1",
      "archetype2",
      "winner",
      "winnerArchetype",
      "turns",
      "endReason",
      "finalLP_player",
      "finalLP_bot",
      "totalTimeMs",
      "avgDecisionTimeMs",
      "totalNodesVisited",
      "beamWidth",
      "maxDepth",
    ];

    const rows = [headers.join(",")];

    for (const record of this.duelRecords) {
      const row = [
        record.duelNumber,
        record.timestamp,
        record.seed ?? "",
        record.archetype1,
        record.archetype2,
        record.winner,
        record.winnerArchetype ?? "",
        record.turns,
        record.endReason,
        record.finalLP.player,
        record.finalLP.bot,
        record.totalTimeMs,
        record.avgDecisionTimeMs ?? "",
        record.totalNodesVisited ?? "",
        record.beamWidth ?? "",
        record.maxDepth ?? "",
      ];
      rows.push(row.join(","));
    }

    return rows.join("\n");
  }

  /**
   * Exporta resumo agregado.
   * @returns {Object}
   */
  exportSummary() {
    return {
      batchStats: this.getBatchStats(),
      matchupStats: this.getAllMatchupStats(),
      topCards: this.getTopPlayedCards(15),
      topActions: this.getTopActions(10),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Faz download do CSV no browser.
   * @param {string} filename
   */
  downloadCSV(filename = "arena_results.csv") {
    const csv = this.exportAsCSV();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /**
   * Faz download do JSONL no browser.
   * @param {string} filename
   */
  downloadJSONL(filename = "arena_results.jsonl") {
    const jsonl = this.exportAsJSONL();
    const blob = new Blob([jsonl], {
      type: "application/x-ndjson;charset=utf-8;",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /**
   * Faz download do resumo JSON no browser.
   * @param {string} filename
   */
  downloadSummary(filename = "arena_summary.json") {
    const summary = this.exportSummary();
    const blob = new Blob([JSON.stringify(summary, null, 2)], {
      type: "application/json;charset=utf-8;",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton para uso global (opcional)
// ─────────────────────────────────────────────────────────────────────────────

let globalAnalytics = null;

/**
 * Retorna instância global de analytics.
 * @returns {ArenaAnalytics}
 */
export function getGlobalAnalytics() {
  if (!globalAnalytics) {
    globalAnalytics = new ArenaAnalytics();
  }
  return globalAnalytics;
}

/**
 * Reseta instância global.
 */
export function resetGlobalAnalytics() {
  if (globalAnalytics) {
    globalAnalytics.reset();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers para coleta durante duelo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria um DuelTracker para coletar métricas durante um duelo.
 * Usar .finalize() ao fim do duelo para obter o resultado completo.
 */
export class DuelTracker {
  constructor(duelNumber, archetype1, archetype2, options = {}) {
    this.duelNumber = duelNumber;
    this.archetype1 = archetype1;
    this.archetype2 = archetype2;
    this.seed = options.seed ?? null;
    this.beamWidth = options.beamWidth ?? null;
    this.maxDepth = options.maxDepth ?? null;

    this.startTime = Date.now();
    this.cardsPlayed = [];
    this.actionsExecuted = [];
    this.decisionTimes = [];
    this.nodesVisited = [];
    this.openingSequence = [];
    this.openingTurnLimit = options.openingBookDepth ?? 2;
    this.currentTurn = 0;
  }

  /**
   * Registra uma carta jogada.
   */
  recordCardPlayed(cardName) {
    this.cardsPlayed.push(cardName);
  }

  /**
   * Registra uma ação executada.
   */
  recordAction(action) {
    this.actionsExecuted.push(action);

    // Opening book: só primeiros N turnos
    if (this.currentTurn <= this.openingTurnLimit) {
      this.openingSequence.push({
        type: action.type,
        cardName: action.cardName ?? null,
        index: action.index ?? null,
      });
    }
  }

  /**
   * Registra tempo de uma decisão.
   */
  recordDecision(timeMs, nodesVisited = null) {
    this.decisionTimes.push(timeMs);
    if (nodesVisited != null) {
      this.nodesVisited.push(nodesVisited);
    }
  }

  /**
   * Avança o contador de turno.
   */
  nextTurn() {
    this.currentTurn += 1;
  }

  /**
   * Finaliza o tracker e retorna resultado para registro.
   * @param {string} winner - "player" | "bot" | "draw"
   * @param {string} reason - END_REASONS.*
   * @param {Object} finalLP - { player: number, bot: number }
   * @returns {DuelResult}
   */
  finalize(winner, reason, finalLP) {
    const totalTimeMs = Date.now() - this.startTime;
    const avgDecisionTimeMs =
      this.decisionTimes.length > 0
        ? this.decisionTimes.reduce((a, b) => a + b, 0) /
          this.decisionTimes.length
        : null;
    const totalNodesVisited =
      this.nodesVisited.length > 0
        ? this.nodesVisited.reduce((a, b) => a + b, 0)
        : null;

    return {
      duelNumber: this.duelNumber,
      seed: this.seed,
      archetype1: this.archetype1,
      archetype2: this.archetype2,
      winner,
      turns: this.currentTurn,
      reason,
      finalLP,
      totalTimeMs,
      avgDecisionTimeMs,
      totalNodesVisited,
      beamWidth: this.beamWidth,
      maxDepth: this.maxDepth,
      cardsPlayed: this.cardsPlayed,
      actionsExecuted: this.actionsExecuted,
      openingSequence:
        this.openingSequence.length > 0 ? this.openingSequence : null,
    };
  }
}
