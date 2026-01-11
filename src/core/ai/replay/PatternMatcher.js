// ═══════════════════════════════════════════════════════════════════════════
// PatternMatcher.js - Detecta combos e patterns em sequências de decisões
// ═══════════════════════════════════════════════════════════════════════════

/**
 * PatternMatcher - Detecta padrões estratégicos em replays
 *
 * Tipos de patterns:
 *   - Combos: sequências de ações que frequentemente aparecem juntas
 *   - Timing patterns: quando certas ações são tomadas (early/mid/late game)
 *   - Conditional patterns: ações tomadas em contextos específicos
 */
class PatternMatcher {
  constructor() {
    // Patterns conhecidos para detecção
    this.knownPatterns = new Map();
    this._registerDefaultPatterns();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Pattern Registration
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Registra um pattern customizado
   * @param {string} name - Nome do pattern
   * @param {Object} definition - { type, detector: (decisions, index) => match|null }
   */
  registerPattern(name, definition) {
    this.knownPatterns.set(name, definition);
  }

  /**
   * Registra patterns padrão do jogo
   */
  _registerDefaultPatterns() {
    // Pattern: Summon seguido de efeito da mesma carta
    this.registerPattern("summon_then_self_effect", {
      type: "combo",
      description: "Invoca monstro e ativa seu efeito no mesmo turno",
      detector: (decisions, i) => {
        const d1 = decisions[i];
        const d2 = decisions[i + 1];

        if (!d1 || !d2) return null;
        if (d1.type !== "summon") return null;
        if (d2.type !== "effect") return null;
        if (d1.turn !== d2.turn) return null;
        if (d1.card?.c !== d2.card?.c) return null;

        return {
          patternName: "summon_then_self_effect",
          turn: d1.turn,
          cards: [d1.card?.c],
          confidence: 1.0,
        };
      },
    });

    // Pattern: Position change antes de ataque (setup para lethal)
    this.registerPattern("position_before_attack", {
      type: "tactical",
      description: "Muda posição de monstro para atacar",
      detector: (decisions, i) => {
        const d1 = decisions[i];

        if (!d1 || d1.type !== "position_change") return null;
        if (d1.toPosition !== "a") return null;

        // Procurar ataque nas próximas 3 decisões do mesmo turno
        for (let j = i + 1; j < Math.min(i + 4, decisions.length); j++) {
          const d2 = decisions[j];
          if (d2.turn !== d1.turn) break;
          if (d2.type === "attack" && d2.attacker?.c === d1.card?.c) {
            return {
              patternName: "position_before_attack",
              turn: d1.turn,
              cards: [d1.card?.c],
              confidence: 1.0,
            };
          }
        }
        return null;
      },
    });

    // Pattern: Lethal push (múltiplos ataques diretos)
    this.registerPattern("lethal_push", {
      type: "tactical",
      description: "Múltiplos ataques diretos no mesmo turno",
      detector: (decisions, i) => {
        const d1 = decisions[i];

        if (!d1 || d1.type !== "attack" || !d1.directAttack) return null;

        // Contar ataques diretos no mesmo turno
        let directAttacks = 1;
        const attackers = [d1.attacker?.c];

        for (let j = i + 1; j < decisions.length; j++) {
          const d2 = decisions[j];
          if (d2.turn !== d1.turn) break;
          if (d2.type === "attack" && d2.directAttack) {
            directAttacks++;
            attackers.push(d2.attacker?.c);
          }
        }

        if (directAttacks >= 2) {
          return {
            patternName: "lethal_push",
            turn: d1.turn,
            attackCount: directAttacks,
            cards: attackers,
            confidence: 1.0,
          };
        }
        return null;
      },
    });

    // Pattern: Field control (destruir + somar)
    this.registerPattern("field_control", {
      type: "tactical",
      description: "Destrói monstro oponente e invoca no mesmo turno",
      detector: (decisions, i) => {
        const d1 = decisions[i];

        if (!d1 || d1.type !== "attack") return null;
        if (!d1.combatResult?.targetDestroyed) return null;

        // Procurar summon no mesmo turno após o ataque
        for (let j = i + 1; j < decisions.length; j++) {
          const d2 = decisions[j];
          if (d2.turn !== d1.turn) break;
          if (d2.type === "summon" && d2.actor === d1.actor) {
            return {
              patternName: "field_control",
              turn: d1.turn,
              cards: [d1.attacker?.c, d2.card?.c],
              confidence: 0.9,
            };
          }
        }
        return null;
      },
    });

    // Pattern: Defensive setup (set + pass)
    this.registerPattern("defensive_setup", {
      type: "strategic",
      description: "Seta backrow e passa sem atacar",
      detector: (decisions, i) => {
        const d1 = decisions[i];

        if (!d1 || d1.type !== "set_spell_trap") return null;

        // Verificar se não houve ataque neste turno
        let hasAttack = false;
        let hasPass = false;

        for (let j = i + 1; j < decisions.length; j++) {
          const d2 = decisions[j];
          if (d2.turn !== d1.turn) break;
          if (d2.type === "attack") hasAttack = true;
          if (d2.type === "pass" && d2.phase === "end") hasPass = true;
        }

        if (!hasAttack && hasPass) {
          return {
            patternName: "defensive_setup",
            turn: d1.turn,
            cards: [d1.card?.c],
            confidence: 0.8,
          };
        }
        return null;
      },
    });

    // Pattern: Resource management (usar LP como recurso)
    this.registerPattern("lp_as_resource", {
      type: "strategic",
      description: "Paga LP para efeito seguido de ação ofensiva",
      detector: (decisions, i) => {
        const d1 = decisions[i];

        // Detectar efeitos que pagam LP olhando actions
        if (!d1 || d1.type !== "effect") return null;
        if (!d1.actions?.includes("pay_lp")) return null;

        // Procurar ação ofensiva no mesmo turno
        for (let j = i + 1; j < decisions.length; j++) {
          const d2 = decisions[j];
          if (d2.turn !== d1.turn) break;
          if (
            d2.type === "attack" ||
            (d2.type === "summon" && d2.summonType !== "normal")
          ) {
            return {
              patternName: "lp_as_resource",
              turn: d1.turn,
              cards: [d1.card?.c, d2.card?.c || d2.attacker?.c],
              confidence: 0.9,
            };
          }
        }
        return null;
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Pattern Detection
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Detecta todos os patterns em um replay
   * @param {Object} replay
   * @returns {Array} Patterns detectados
   */
  detectPatterns(replay) {
    const decisions = replay.decisions || [];
    const patterns = [];
    const seenPatterns = new Set(); // Evitar duplicatas

    for (let i = 0; i < decisions.length; i++) {
      for (const [name, pattern] of this.knownPatterns) {
        const match = pattern.detector(decisions, i);

        if (match) {
          // Criar key única para evitar duplicatas
          const key = `${match.patternName}_${match.turn}_${match.cards?.join(
            ","
          )}`;
          if (seenPatterns.has(key)) continue;
          seenPatterns.add(key);

          patterns.push({
            ...match,
            type: pattern.type,
            description: pattern.description,
          });
        }
      }
    }

    return patterns;
  }

  /**
   * Detecta patterns em múltiplos replays e agrega estatísticas
   * @param {Array} replays
   * @returns {Object} { patterns: Map<name, stats> }
   */
  detectPatternsAggregate(replays) {
    const patternStats = new Map();

    for (const replay of replays) {
      const patterns = this.detectPatterns(replay);
      const isWin = replay.result === "win";

      for (const p of patterns) {
        if (!patternStats.has(p.patternName)) {
          patternStats.set(p.patternName, {
            name: p.patternName,
            type: p.type,
            description: p.description,
            occurrences: 0,
            inWins: 0,
            inLosses: 0,
            avgTurn: 0,
            turns: [],
          });
        }

        const stat = patternStats.get(p.patternName);
        stat.occurrences++;
        stat.turns.push(p.turn);
        if (isWin) stat.inWins++;
        else stat.inLosses++;
      }
    }

    // Calcular médias
    for (const [, stat] of patternStats) {
      stat.avgTurn = stat.turns.reduce((a, b) => a + b, 0) / stat.turns.length;
      stat.winCorrelation =
        stat.occurrences > 0 ? stat.inWins / stat.occurrences : 0;
      delete stat.turns; // Limpar dados temporários
    }

    return {
      patterns: patternStats,
      totalReplays: replays.length,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Combo Discovery (Data-driven)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Descobre combos frequentes analisando sequências de ações
   * @param {Array} replays
   * @param {Object} options - { minOccurrences, maxSequenceLength }
   * @returns {Array}
   */
  discoverCombos(replays, options = {}) {
    const { minOccurrences = 3, maxSequenceLength = 4 } = options;
    const sequenceCounts = new Map();

    for (const replay of replays) {
      const decisions = replay.decisions || [];
      const humanDecisions = decisions.filter((d) => d.actor === "human");
      const dict = replay.cardDictionary || {};

      // Agrupar por turno
      const byTurn = new Map();
      for (const d of humanDecisions) {
        const turn = d.turn || 0;
        if (!byTurn.has(turn)) byTurn.set(turn, []);
        byTurn.get(turn).push(d);
      }

      // Extrair sequências por turno
      for (const [turn, turnDecisions] of byTurn) {
        for (
          let len = 2;
          len <= Math.min(maxSequenceLength, turnDecisions.length);
          len++
        ) {
          for (let start = 0; start <= turnDecisions.length - len; start++) {
            const seq = turnDecisions.slice(start, start + len);

            // Criar key da sequência
            const seqKey = seq
              .map((d) => {
                const cardName = dict[d.card?.c] || d.card?.name || "?";
                return `${d.type}:${cardName}`;
              })
              .join(" → ");

            if (!sequenceCounts.has(seqKey)) {
              sequenceCounts.set(seqKey, {
                sequence: seqKey,
                count: 0,
                wins: 0,
                cards: seq
                  .map((d) => dict[d.card?.c] || d.card?.name)
                  .filter(Boolean),
              });
            }

            const stat = sequenceCounts.get(seqKey);
            stat.count++;
            if (replay.result === "win") stat.wins++;
          }
        }
      }
    }

    // Filtrar por ocorrências mínimas
    const combos = [];
    for (const [, stat] of sequenceCounts) {
      if (stat.count >= minOccurrences) {
        combos.push({
          ...stat,
          winRate: stat.wins / stat.count,
          frequency: stat.count / replays.length,
        });
      }
    }

    // Ordenar por frequência * winRate
    combos.sort((a, b) => b.frequency * b.winRate - a.frequency * a.winRate);

    return combos.slice(0, 20); // Top 20
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Timing Analysis
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Analisa quando certas ações são tipicamente tomadas
   * @param {Array} replays
   * @param {string} actionType - "summon", "effect", etc.
   * @returns {Object}
   */
  analyzeActionTiming(replays, actionType) {
    const timingData = {
      earlyGame: 0, // turnos 1-3
      midGame: 0, // turnos 4-8
      lateGame: 0, // turnos 9+
      total: 0,
      avgTurn: 0,
      turns: [],
    };

    for (const replay of replays) {
      const decisions = replay.decisions || [];

      for (const d of decisions) {
        if (d.type !== actionType) continue;
        if (d.actor !== "human") continue;

        const turn = d.turn || 0;
        timingData.total++;
        timingData.turns.push(turn);

        if (turn <= 3) timingData.earlyGame++;
        else if (turn <= 8) timingData.midGame++;
        else timingData.lateGame++;
      }
    }

    if (timingData.total > 0) {
      timingData.avgTurn =
        timingData.turns.reduce((a, b) => a + b, 0) / timingData.total;
      timingData.distribution = {
        early: timingData.earlyGame / timingData.total,
        mid: timingData.midGame / timingData.total,
        late: timingData.lateGame / timingData.total,
      };
    }

    delete timingData.turns;
    return timingData;
  }
}

// Singleton
const patternMatcher = new PatternMatcher();

export { PatternMatcher, patternMatcher };
export default patternMatcher;
