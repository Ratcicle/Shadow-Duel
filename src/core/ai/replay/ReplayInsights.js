// ═══════════════════════════════════════════════════════════════════════════
// ReplayInsights.js - Queries agregadas com filtros anti-viés
// Retorna sempre { value, confidence, sampleSize } para validação
// ═══════════════════════════════════════════════════════════════════════════

import { replayDatabase } from "./ReplayDatabase.js";

// Configuração de anti-viés
const DEFAULT_MIN_SAMPLE = 3;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

// Cache TTL (Time To Live) em ms - 5 minutos
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * ReplayInsights - Queries agregadas com métricas anti-viés
 *
 * Features:
 *   - Amostra mínima configurável
 *   - Segmentação por matchup/phase
 *   - Impact score contextual
 *   - Cache via aggregates store (invalidado por imports)
 *   - Retorna { value, confidence, sampleSize } para consumidores validarem
 */
class ReplayInsights {
  constructor(database = replayDatabase) {
    this.db = database;
    this.minSample = DEFAULT_MIN_SAMPLE;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Configuração
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Define amostra mínima para queries
   */
  setMinSample(n) {
    this.minSample = n;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cache Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Gera chave de cache para uma query
   */
  _cacheKey(queryName, params = {}) {
    const paramStr = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    return `insights:${queryName}:${paramStr}`;
  }

  /**
   * Tenta obter resultado do cache
   * @returns {Object|null} Cached result ou null se miss/dirty/expired
   */
  async _getFromCache(key) {
    try {
      const cached = await this.db.getAggregate(key);
      if (!cached) return null;

      // Verificar TTL
      if (cached._cachedAt && Date.now() - cached._cachedAt > CACHE_TTL_MS) {
        return null; // Expired
      }

      return cached;
    } catch (e) {
      console.warn("[ReplayInsights] Cache read error:", e);
      return null;
    }
  }

  /**
   * Salva resultado no cache
   */
  async _saveToCache(key, result) {
    try {
      const toCache = { ...result, _cachedAt: Date.now() };
      await this.db.saveAggregate(key, toCache);
    } catch (e) {
      console.warn("[ReplayInsights] Cache write error:", e);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Card Performance
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Retorna métricas de performance de uma carta
   * @param {string} cardName
   * @param {Object} filters - { archetype, matchup, quality }
   * @returns {Promise<Object>} { winRate, avgActivations, impactScore, confidence, sampleSize }
   */
  async getCardPerformance(cardName, filters = {}) {
    const replays = await this.db.listReplays({
      quality: filters.quality || "clean",
      ...filters,
    });

    // Filtrar replays que contêm esta carta
    const relevantReplays = replays.filter((r) => {
      const decisions = r.decisions || [];
      return decisions.some((d) => {
        const cardId = d.card?.c;
        const dict = r.cardDictionary || {};
        return dict[cardId] === cardName || d.card?.name === cardName;
      });
    });

    if (relevantReplays.length < this.minSample) {
      return {
        cardName,
        winRate: null,
        avgActivations: null,
        impactScore: null,
        confidence: 0,
        sampleSize: relevantReplays.length,
        belowMinSample: true,
      };
    }

    // Calcular métricas
    let wins = 0;
    let totalActivations = 0;
    let totalImpact = 0;

    for (const r of relevantReplays) {
      if (r.result === "win") wins++;

      // Contar ativações
      const decisions = r.decisions || [];
      const activations = decisions.filter((d) => {
        const cardId = d.card?.c;
        const dict = r.cardDictionary || {};
        return (
          (dict[cardId] === cardName || d.card?.name === cardName) &&
          (d.type === "effect" || d.type === "summon")
        );
      });

      totalActivations += activations.length;

      // Calcular impact score (simplificado: delta LP após uso)
      for (const act of activations) {
        if (act.delta) {
          const lpGain =
            (act.delta.botLP ? -act.delta.botLP : 0) +
            (act.delta.playerLP ? act.delta.playerLP - 8000 : 0);
          totalImpact += lpGain;
        }
      }
    }

    const winRate = wins / relevantReplays.length;
    const avgActivations = totalActivations / relevantReplays.length;
    const impactScore =
      totalActivations > 0 ? totalImpact / totalActivations : 0;

    // Confiança baseada em tamanho da amostra (sigmoid-like)
    const confidence = Math.min(
      1,
      relevantReplays.length / (this.minSample * 3)
    );

    return {
      cardName,
      winRate,
      avgActivations,
      impactScore,
      confidence,
      sampleSize: relevantReplays.length,
      belowMinSample: false,
    };
  }

  /**
   * Retorna top cards por win rate com anti-viés
   * @param {Object} filters
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async getTopCardsByWinRate(filters = {}, limit = 10) {
    // Tentar cache primeiro
    const cacheKey = this._cacheKey("topCardsByWinRate", {
      quality: filters.quality || "clean",
      archetype: filters.archetype,
      matchup: filters.matchup,
      limit,
    });
    const cached = await this._getFromCache(cacheKey);
    if (cached?.results) {
      console.log("[ReplayInsights] Cache hit: topCardsByWinRate");
      return cached.results;
    }

    const replays = await this.db.listReplays({
      quality: filters.quality || "clean",
      ...filters,
    });

    // Agregar por carta
    const cardStats = new Map();

    for (const r of replays) {
      const decisions = r.decisions || [];
      const dict = r.cardDictionary || {};
      const isWin = r.result === "win";
      const seenCards = new Set();

      for (const d of decisions) {
        if (d.actor !== "human") continue;

        const cardId = d.card?.c;
        let cardName = dict[cardId] || d.card?.name;
        if (!cardName) continue;

        // Só conta uma vez por replay
        if (seenCards.has(cardName)) continue;
        seenCards.add(cardName);

        if (!cardStats.has(cardName)) {
          cardStats.set(cardName, { wins: 0, total: 0 });
        }
        const stat = cardStats.get(cardName);
        stat.total++;
        if (isWin) stat.wins++;
      }
    }

    // Filtrar por amostra mínima e calcular win rate
    const results = [];
    for (const [cardName, stat] of cardStats) {
      if (stat.total < this.minSample) continue;

      const winRate = stat.wins / stat.total;
      const confidence = Math.min(1, stat.total / (this.minSample * 3));

      results.push({
        cardName,
        winRate,
        confidence,
        sampleSize: stat.total,
      });
    }

    // Ordenar por win rate * confidence (evita viés de amostra pequena)
    results.sort((a, b) => b.winRate * b.confidence - a.winRate * a.confidence);

    const finalResults = results.slice(0, limit);

    // Salvar no cache
    await this._saveToCache(cacheKey, { results: finalResults });

    return finalResults;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Opening Patterns
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Retorna padrões de abertura (primeiros 3 turnos)
   * @param {string} archetype
   * @returns {Promise<Array>}
   */
  async getOpeningPatterns(archetype) {
    // Tentar cache primeiro
    const cacheKey = this._cacheKey("openingPatterns", { archetype });
    const cached = await this._getFromCache(cacheKey);
    if (cached?.results) {
      console.log("[ReplayInsights] Cache hit: openingPatterns");
      return cached.results;
    }

    const replays = await this.db.listReplays({
      archetype,
      quality: "clean",
    });

    // Agregar sequências de abertura
    const patternStats = new Map();

    for (const r of replays) {
      const decisions = r.decisions || [];
      const opening = [];

      for (const d of decisions) {
        if (d.actor !== "human") continue;
        if (d.turn > 5) break;

        if (d.type === "summon" || d.type === "set_spell_trap") {
          const cardId = d.card?.c;
          const dict = r.cardDictionary || {};
          const cardName = dict[cardId] || d.card?.name || "unknown";
          opening.push(`${d.type}:${cardName}`);
        }
      }

      if (opening.length === 0) continue;

      // Criar key do padrão (primeiras 3 ações)
      const patternKey = opening.slice(0, 3).join(" → ");
      const isWin = r.result === "win";

      if (!patternStats.has(patternKey)) {
        patternStats.set(patternKey, {
          wins: 0,
          total: 0,
          sequence: opening.slice(0, 3),
        });
      }
      const stat = patternStats.get(patternKey);
      stat.total++;
      if (isWin) stat.wins++;
    }

    // Filtrar e calcular
    const results = [];
    for (const [key, stat] of patternStats) {
      if (stat.total < this.minSample) continue;

      results.push({
        pattern: key,
        sequence: stat.sequence,
        winRate: stat.wins / stat.total,
        frequency: stat.total / replays.length,
        confidence: Math.min(1, stat.total / (this.minSample * 3)),
        sampleSize: stat.total,
      });
    }

    results.sort((a, b) => b.winRate - a.winRate);

    // Salvar no cache
    await this._saveToCache(cacheKey, { results });

    return results;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Phase Preferences
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Retorna preferências de ação por fase
   * @param {string} archetype
   * @returns {Promise<Object>}
   */
  async getPhasePreferences(archetype) {
    // Tentar cache primeiro
    const cacheKey = this._cacheKey("phasePreferences", { archetype });
    const cached = await this._getFromCache(cacheKey);
    if (cached?.result) {
      console.log("[ReplayInsights] Cache hit: phasePreferences");
      return cached.result;
    }

    const replays = await this.db.listReplays({
      archetype,
      quality: "clean",
    });

    const phases = {
      main1: { summons: 0, effects: 0, sets: 0, count: 0 },
      battle: { attacks: 0, count: 0 },
      main2: { summons: 0, effects: 0, sets: 0, count: 0 },
      end: { passes: 0, count: 0 },
    };

    for (const r of replays) {
      const decisions = r.decisions || [];

      for (const d of decisions) {
        if (d.actor !== "human") continue;
        const phase = d.phase || "unknown";

        if (!phases[phase]) continue;
        phases[phase].count++;

        switch (d.type) {
          case "summon":
            if (phase === "main1" || phase === "main2") phases[phase].summons++;
            break;
          case "effect":
            if (phase === "main1" || phase === "main2") phases[phase].effects++;
            break;
          case "set_spell_trap":
            if (phase === "main1" || phase === "main2") phases[phase].sets++;
            break;
          case "attack":
            if (phase === "battle") phases[phase].attacks++;
            break;
          case "pass":
            phases[phase].passes++;
            break;
        }
      }
    }

    // Calcular médias
    const totalReplays = replays.length || 1;

    const result = {
      main1: {
        avgSummons: phases.main1.summons / totalReplays,
        avgEffects: phases.main1.effects / totalReplays,
        avgSets: phases.main1.sets / totalReplays,
      },
      battle: {
        avgAttacks: phases.battle.attacks / totalReplays,
      },
      main2: {
        avgSummons: phases.main2.summons / totalReplays,
        avgEffects: phases.main2.effects / totalReplays,
        avgSets: phases.main2.sets / totalReplays,
      },
      sampleSize: totalReplays,
      confidence: Math.min(1, totalReplays / (this.minSample * 3)),
    };

    // Salvar no cache
    await this._saveToCache(cacheKey, { result });

    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Action Insights (para integração com IA)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Retorna insight para uma ação específica (usado pela IA)
   * @param {Object} action - { type, cardId, cardName, ... }
   * @param {Object} gameState - Estado atual do jogo
   * @returns {Promise<Object>} { value, confidence, sampleSize }
   */
  async getActionInsight(action, gameState) {
    // Determinar archetype do jogador
    const archetype = gameState?.playerArchetype || "unknown";
    const matchup = gameState?.opponentArchetype
      ? `${archetype}_vs_${gameState.opponentArchetype}`
      : null;

    // Buscar digests similares
    const digests = await this.db.queryDigests(
      {
        archetype,
        promptType: action.type,
        actor: "human",
      },
      { limit: 500 }
    );

    if (digests.length < this.minSample) {
      return { value: 0, confidence: 0, sampleSize: digests.length };
    }

    // Filtrar por contexto similar
    const similar = digests.filter((d) => {
      // Mesmo tipo de ação
      if (d.chosenAction?.type !== action.type) return false;

      // Mesma carta (se aplicável)
      if (action.cardId && d.chosenAction?.cardId !== action.cardId)
        return false;

      // Contexto similar (LP difference range)
      if (gameState?.lpDiff !== undefined && d.context?.lpDiff !== undefined) {
        const lpDiffDelta = Math.abs(gameState.lpDiff - d.context.lpDiff);
        if (lpDiffDelta > 2000) return false; // Muito diferente
      }

      return true;
    });

    if (similar.length < this.minSample) {
      return { value: 0, confidence: 0, sampleSize: similar.length };
    }

    // Calcular score baseado em outcomes
    let positiveOutcomes = 0;
    let totalWithOutcome = 0;

    for (const d of similar) {
      if (d.outcome?.gameResult) {
        totalWithOutcome++;
        if (d.outcome.gameResult === "win") positiveOutcomes++;
      } else if (d.outcome?.lpDelta?.advantage) {
        totalWithOutcome++;
        if (d.outcome.lpDelta.advantage > 0) positiveOutcomes++;
      }
    }

    if (totalWithOutcome === 0) {
      return { value: 0, confidence: 0.3, sampleSize: similar.length };
    }

    // Value: -1 to +1 baseado em taxa de sucesso
    const successRate = positiveOutcomes / totalWithOutcome;
    const value = (successRate - 0.5) * 2; // Normaliza para [-1, +1]

    const confidence = Math.min(1, similar.length / (this.minSample * 3));

    return {
      value,
      confidence,
      sampleSize: similar.length,
      successRate,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Matchup Analysis
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Retorna win rate por matchup
   * @param {string} archetype
   * @returns {Promise<Array>}
   */
  async getMatchupStats(archetype) {
    const replays = await this.db.listReplays({
      archetype,
      quality: "clean",
    });

    const matchupStats = new Map();

    for (const r of replays) {
      const opponent = r.botArchetype || "unknown";
      const isWin = r.result === "win";

      if (!matchupStats.has(opponent)) {
        matchupStats.set(opponent, { wins: 0, total: 0 });
      }
      const stat = matchupStats.get(opponent);
      stat.total++;
      if (isWin) stat.wins++;
    }

    const results = [];
    for (const [opponent, stat] of matchupStats) {
      if (stat.total < 2) continue; // Mínimo menor para matchups

      results.push({
        opponent,
        winRate: stat.wins / stat.total,
        confidence: Math.min(1, stat.total / this.minSample),
        sampleSize: stat.total,
      });
    }

    results.sort((a, b) => b.winRate - a.winRate);
    return results;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Aggregate Stats
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Retorna estatísticas gerais com cache
   * @param {string} archetype
   * @returns {Promise<Object>}
   */
  async getAggregateStats(archetype) {
    const cacheKey = `aggregate_${archetype}`;

    // Tentar cache
    const cached = await this.db.getAggregate(cacheKey);
    if (cached) return cached;

    // Calcular
    const replays = await this.db.listReplays({ archetype, quality: "clean" });

    const stats = {
      totalReplays: replays.length,
      wins: replays.filter((r) => r.result === "win").length,
      losses: replays.filter((r) => r.result === "loss").length,
      avgTurns:
        replays.reduce((sum, r) => sum + (r.totalTurns || 0), 0) /
        (replays.length || 1),
      winRate:
        replays.length > 0
          ? replays.filter((r) => r.result === "win").length / replays.length
          : 0,
    };

    // Salvar cache
    if (replays.length >= this.minSample) {
      await this.db.saveAggregate(cacheKey, stats);
    }

    return stats;
  }
}

// Singleton
const replayInsights = new ReplayInsights();

export { ReplayInsights, replayInsights };
export default replayInsights;
