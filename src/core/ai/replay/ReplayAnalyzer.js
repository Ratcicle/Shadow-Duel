// ═══════════════════════════════════════════════════════════════════════════
// ReplayAnalyzer.js - Gera TrainingDigest e métricas a partir de replays
// Produto principal: decisões individuais com contexto e outcome
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ReplayAnalyzer - Extrai dados treináveis de replays
 *
 * Produto principal: trainingDigest[]
 *   - Cada entrada = 1 decisão com contexto compacto e outcome
 *   - Inclui availableActions quando capturado
 *   - Pronto para consumo por ML ou heurísticas
 */
class ReplayAnalyzer {
  constructor() {
    // Tipos de decisão que geram digest
    this.actionTypes = new Set([
      "summon",
      "attack",
      "effect",
      "spell",
      "set_spell_trap",
      "pass",
      "position_change",
      "position_choice",
      "chain_response",
      "fusion_summon",
      "ascension_summon",
    ]);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Training Digest Generation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Gera array de training digests a partir de um replay processado
   * @param {Object} replay - Replay com metadados (archetype, matchup, etc)
   * @returns {Array} Training digest entries
   */
  generateTrainingDigests(replay) {
    const digests = [];
    const decisions = replay.decisions || [];
    const snapshots = replay.snapshots || {};

    // Pré-computar lookup de snapshots por turno
    const snapshotByTurn = this._buildSnapshotLookup(snapshots);

    for (let i = 0; i < decisions.length; i++) {
      const decision = decisions[i];

      // Filtrar apenas tipos relevantes para treino
      if (!this.actionTypes.has(decision.type)) continue;

      // Gerar digest para esta decisão
      const digest = this._createDigestEntry(
        decision,
        replay,
        snapshotByTurn,
        decisions,
        i
      );

      if (digest) {
        digests.push(digest);
      }
    }

    return digests;
  }

  /**
   * Cria uma entrada de digest para uma decisão específica
   */
  _createDigestEntry(decision, replay, snapshotByTurn, decisions, index) {
    const turn = decision.turn || 0;
    const phase = decision.phase || "unknown";
    const actor = decision.actor || "unknown";

    // Reconstruir contexto via rolling state (snapshot + deltas acumulados)
    const context = this._extractContextRolling(
      snapshotByTurn,
      replay,
      decisions,
      index
    );

    // Extrair ação escolhida
    const chosenAction = this._extractChosenAction(decision);

    // Calcular outcome (delta até próximo turno do mesmo jogador ou fim)
    const outcome = this._calculateOutcome(
      decisions,
      index,
      actor,
      snapshotByTurn,
      replay
    );

    return {
      replayId: replay.id,
      archetype: replay.archetype,
      matchup: replay.matchup,
      turn,
      phase,
      actor,
      promptType: decision.type,
      chosenAction,
      availableActions: decision.availableActions || null, // Será preenchido quando capturado
      context,
      outcome,
      decisionTime: decision.dt || null, // Tempo de decisão em ms
    };
  }

  /**
   * Extrai contexto via reconstrução rolling (snapshot + deltas acumulados)
   * Aplica deltas sequencialmente desde o snapshot até o índice da decisão
   */
  _extractContextRolling(snapshotByTurn, replay, decisions, targetIndex) {
    const targetDecision = decisions[targetIndex];
    const targetTurn = targetDecision.turn || 0;

    // 1. Encontrar snapshot mais recente <= targetTurn
    let snapshotTurn = -1;
    for (let t = targetTurn; t >= 0; t--) {
      if (snapshotByTurn[t]) {
        snapshotTurn = t;
        break;
      }
    }

    // Estado base: snapshot ou defaults
    const snapshot = snapshotTurn >= 0 ? snapshotByTurn[snapshotTurn] : null;
    const state = {
      playerLP: snapshot?.playerLP ?? 8000,
      botLP: snapshot?.botLP ?? 8000,
      playerField: snapshot?.playerField ? [...snapshot.playerField] : [],
      botField: snapshot?.botField ? [...snapshot.botField] : [],
      playerHandCount: snapshot?.playerHandCount ?? 0,
      botHandCount: snapshot?.botHandCount ?? 0,
      playerGraveCount: snapshot?.playerGraveCount ?? 0,
      botGraveCount: snapshot?.botGraveCount ?? 0,
      playerSpellTrapCount: snapshot?.playerSpellTrapCount ?? 0,
      botSpellTrapCount: snapshot?.botSpellTrapCount ?? 0,
      playerFieldSpell: snapshot?.playerFieldSpell ?? null,
      botFieldSpell: snapshot?.botFieldSpell ?? null,
    };

    // 2. Encontrar índice da primeira decisão após o snapshot
    let startIndex = 0;
    if (snapshotTurn >= 0) {
      for (let i = 0; i < decisions.length; i++) {
        const d = decisions[i];
        // Primeira decisão após o snapshot (mesmo turno conta se após snapshot)
        if ((d.turn || 0) > snapshotTurn) {
          startIndex = i;
          break;
        }
        // Se é o mesmo turno do snapshot, usar o índice após as decisões daquele turno
        if ((d.turn || 0) === snapshotTurn) {
          startIndex = i + 1;
        }
      }
    }

    // 3. Aplicar deltas sequencialmente até ANTES da decisão atual
    // O contexto deve refletir o estado ANTES da decisão ser tomada
    for (let i = startIndex; i < targetIndex; i++) {
      const delta = decisions[i].delta;
      if (delta) {
        this._applyDelta(state, delta);
      }
    }

    // 4. Gerar contexto a partir do estado reconstruído
    const playerFieldSummary = state.playerField.map((m) =>
      this._summarizeMonster(m, replay.cardDictionary)
    );
    const botFieldSummary = state.botField.map((m) =>
      this._summarizeMonster(m, replay.cardDictionary)
    );

    return {
      playerLP: state.playerLP,
      botLP: state.botLP,
      lpDiff: state.playerLP - state.botLP,
      playerHandCount: state.playerHandCount,
      botHandCount: state.botHandCount,
      playerFieldCount: state.playerField.length,
      botFieldCount: state.botField.length,
      playerFieldSummary,
      botFieldSummary,
      playerGraveCount: state.playerGraveCount,
      botGraveCount: state.botGraveCount,
      playerSpellTrapCount: state.playerSpellTrapCount,
      botSpellTrapCount: state.botSpellTrapCount,
      playerFieldSpell: state.playerFieldSpell,
      botFieldSpell: state.botFieldSpell,
      matchup: {
        player: replay.archetype || "unknown",
        opponent: replay.botArchetype || "unknown",
      },
    };
  }

  /**
   * Aplica um delta ao estado acumulado
   */
  _applyDelta(state, delta) {
    // Aplicar apenas campos presentes no delta
    if (delta.playerLP !== undefined) state.playerLP = delta.playerLP;
    if (delta.botLP !== undefined) state.botLP = delta.botLP;
    if (delta.playerField !== undefined)
      state.playerField = [...delta.playerField];
    if (delta.botField !== undefined) state.botField = [...delta.botField];
    if (delta.playerHandCount !== undefined)
      state.playerHandCount = delta.playerHandCount;
    if (delta.botHandCount !== undefined)
      state.botHandCount = delta.botHandCount;
    if (delta.playerGraveCount !== undefined)
      state.playerGraveCount = delta.playerGraveCount;
    if (delta.botGraveCount !== undefined)
      state.botGraveCount = delta.botGraveCount;
    if (delta.playerSpellTrapCount !== undefined)
      state.playerSpellTrapCount = delta.playerSpellTrapCount;
    if (delta.botSpellTrapCount !== undefined)
      state.botSpellTrapCount = delta.botSpellTrapCount;
    if (delta.playerFieldSpell !== undefined)
      state.playerFieldSpell = delta.playerFieldSpell;
    if (delta.botFieldSpell !== undefined)
      state.botFieldSpell = delta.botFieldSpell;
  }

  /**
   * Extrai contexto compacto para uma decisão (DEPRECATED - use _extractContextRolling)
   * Mantido para retrocompatibilidade
   */
  _extractContext(turn, snapshotByTurn, replay, decision) {
    // Buscar snapshot mais recente <= turn
    let snapshot = null;
    for (let t = turn; t >= 0; t--) {
      if (snapshotByTurn[t]) {
        snapshot = snapshotByTurn[t];
        break;
      }
    }

    // Usar delta da decisão se snapshot não disponível
    const delta = decision.delta || {};

    // Combinar snapshot + delta para estado atual
    const playerLP = delta.playerLP ?? snapshot?.playerLP ?? 8000;
    const botLP = delta.botLP ?? snapshot?.botLP ?? 8000;

    const playerField = delta.playerField || snapshot?.playerField || [];
    const botField = delta.botField || snapshot?.botField || [];

    // Resumir campo (apenas id + posição + stats)
    const playerFieldSummary = playerField.map((m) =>
      this._summarizeMonster(m, replay.cardDictionary)
    );
    const botFieldSummary = botField.map((m) =>
      this._summarizeMonster(m, replay.cardDictionary)
    );

    return {
      playerLP,
      botLP,
      lpDiff: playerLP - botLP,
      playerHandCount: delta.playerHandCount ?? snapshot?.playerHandCount ?? 0,
      botHandCount: delta.botHandCount ?? snapshot?.botHandCount ?? 0,
      playerFieldCount: playerField.length,
      botFieldCount: botField.length,
      playerFieldSummary,
      botFieldSummary,
      playerGraveCount:
        delta.playerGraveCount ?? snapshot?.playerGraveCount ?? 0,
      botGraveCount: delta.botGraveCount ?? snapshot?.botGraveCount ?? 0,
      playerSpellTrapCount:
        delta.playerSpellTrapCount ?? snapshot?.playerSpellTrapCount ?? 0,
      botSpellTrapCount:
        delta.botSpellTrapCount ?? snapshot?.botSpellTrapCount ?? 0,
      playerFieldSpell:
        delta.playerFieldSpell ?? snapshot?.playerFieldSpell ?? null,
      botFieldSpell: delta.botFieldSpell ?? snapshot?.botFieldSpell ?? null,
      matchup: {
        player: replay.archetype || "unknown",
        opponent: replay.botArchetype || "unknown",
      },
    };
  }

  /**
   * Resume um monstro para o digest
   */
  _summarizeMonster(monster, cardDict) {
    if (!monster) return null;

    // Encontrar ID no dicionário se só temos nome
    let cardId = null;
    if (cardDict) {
      for (const [id, name] of Object.entries(cardDict)) {
        if (name === monster.name) {
          cardId = parseInt(id);
          break;
        }
      }
    }

    return {
      name: monster.name,
      cardId,
      atk: monster.atk,
      def: monster.def,
      position: monster.position?.[0] || monster.position, // "a" ou "d"
      isFacedown: monster.isFacedown || false,
    };
  }

  /**
   * Extrai a ação escolhida de uma decisão
   */
  _extractChosenAction(decision) {
    const base = {
      type: decision.type,
    };

    // Adicionar campos específicos por tipo
    switch (decision.type) {
      case "summon":
        return {
          ...base,
          cardId: decision.card?.c || decision.card?.id,
          summonType: decision.summonType,
          fromZone: decision.fromZone,
        };

      case "attack":
        return {
          ...base,
          attackerId: decision.attacker?.c || decision.attacker?.id,
          targetId: decision.target?.c || decision.target?.id,
          directAttack: decision.directAttack || false,
        };

      case "effect":
      case "spell":
        return {
          ...base,
          cardId: decision.card?.c || decision.card?.id,
          effectId: decision.effectId,
          timing: decision.effectTiming,
        };

      case "set_spell_trap":
        return {
          ...base,
          cardId: decision.card?.c || decision.card?.id,
        };

      case "position_change":
        return {
          ...base,
          cardId: decision.card?.c || decision.card?.id,
          fromPosition: decision.fromPosition,
          toPosition: decision.toPosition,
        };

      case "position_choice":
        return {
          ...base,
          cardId: decision.card?.c || decision.card?.id,
          chosenPosition: decision.chosenPosition,
          summonType: decision.summonType,
        };

      case "chain_response":
        return {
          ...base,
          activated: decision.activated,
          cardId: decision.card?.c || decision.card?.id,
        };

      case "pass":
        return base;

      default:
        return base;
    }
  }

  /**
   * Calcula outcome da decisão (delta após 1 turno)
   */
  _calculateOutcome(decisions, currentIndex, actor, snapshotByTurn, replay) {
    const currentDecision = decisions[currentIndex];
    const currentTurn = currentDecision.turn || 0;

    // Buscar próxima decisão do mesmo ator ou fim
    let nextSnapshot = null;
    let foundNextTurn = false;

    for (let i = currentIndex + 1; i < decisions.length; i++) {
      const d = decisions[i];
      // Próximo turno do mesmo jogador
      if (d.actor === actor && d.turn > currentTurn) {
        // Buscar snapshot desse turno
        for (let t = d.turn; t >= currentTurn + 1; t--) {
          if (snapshotByTurn[t]) {
            nextSnapshot = snapshotByTurn[t];
            foundNextTurn = true;
            break;
          }
        }
        break;
      }
    }

    // Se não encontrou próximo turno, usar resultado final
    const isWin =
      replay.result === "win" ||
      replay.result?.winner === "human" ||
      replay.result?.winner?.winner === "human";

    if (!nextSnapshot && !foundNextTurn) {
      return {
        gameResult: isWin ? "win" : "loss",
        lpDelta: null,
        boardDelta: null,
      };
    }

    // Calcular deltas
    const currentSnapshot = snapshotByTurn[currentTurn];
    if (!currentSnapshot || !nextSnapshot) {
      return {
        gameResult: null,
        lpDelta: null,
        boardDelta: null,
      };
    }

    const playerLPDelta =
      (nextSnapshot.playerLP || 8000) - (currentSnapshot.playerLP || 8000);
    const botLPDelta =
      (nextSnapshot.botLP || 8000) - (currentSnapshot.botLP || 8000);

    const playerFieldDelta =
      (nextSnapshot.playerField?.length || 0) -
      (currentSnapshot.playerField?.length || 0);
    const botFieldDelta =
      (nextSnapshot.botField?.length || 0) -
      (currentSnapshot.botField?.length || 0);

    return {
      gameResult: null, // Ainda não terminou
      lpDelta: {
        player: playerLPDelta,
        bot: botLPDelta,
        advantage: playerLPDelta - botLPDelta,
      },
      boardDelta: {
        player: playerFieldDelta,
        bot: botFieldDelta,
        advantage: playerFieldDelta - botFieldDelta,
      },
    };
  }

  /**
   * Constrói lookup de snapshots por turno
   */
  _buildSnapshotLookup(snapshots) {
    const lookup = {};
    for (const [turnStr, snapshot] of Object.entries(snapshots)) {
      lookup[parseInt(turnStr)] = snapshot;
    }
    return lookup;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Métricas por Replay
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Extrai métricas agregadas de um replay
   * @param {Object} replay
   * @returns {Object} Métricas
   */
  extractMetrics(replay) {
    const decisions = replay.decisions || [];
    const humanDecisions = decisions.filter((d) => d.actor === "human");

    // Tempo médio de decisão
    const decisionTimes = humanDecisions
      .filter((d) => d.dt && d.dt > 0)
      .map((d) => d.dt);
    const avgDecisionTime =
      decisionTimes.length > 0
        ? decisionTimes.reduce((a, b) => a + b, 0) / decisionTimes.length / 1000
        : 0;

    // Distribuição de summons
    const summons = decisions.filter(
      (d) => d.type === "summon" && d.actor === "human"
    );
    const summonDistribution = {
      normal: summons.filter((s) => s.summonType === "normal").length,
      special: summons.filter((s) => s.summonType === "special").length,
      ascension: summons.filter((s) => s.summonType === "ascension").length,
      fusion: summons.filter((s) => s.summonType === "fusion").length,
    };

    // Contagem de efeitos ativados
    const effectActivations = {};
    const effects = decisions.filter(
      (d) => d.type === "effect" && d.actor === "human"
    );
    for (const e of effects) {
      const id = e.effectId || "unknown";
      effectActivations[id] = (effectActivations[id] || 0) + 1;
    }

    // Ataques
    const attacks = decisions.filter(
      (d) => d.type === "attack" && d.actor === "human"
    );
    const directAttacks = attacks.filter((a) => a.directAttack).length;

    // Mudanças de posição
    const positionChanges = decisions.filter(
      (d) => d.type === "position_change" && d.actor === "human"
    ).length;

    // Passes
    const passes = decisions.filter(
      (d) => d.type === "pass" && d.actor === "human"
    ).length;

    return {
      totalDecisions: humanDecisions.length,
      avgDecisionTime, // em segundos
      summonDistribution,
      effectActivations,
      attackCount: attacks.length,
      directAttacks,
      positionChanges,
      passCount: passes,
      totalTurns: replay.totalTurns || replay.result?.winner?.totalTurns || 0,
    };
  }

  /**
   * Detecta combos/patterns em um replay
   * @param {Object} replay
   * @returns {Array} Patterns detectados
   */
  detectPatterns(replay) {
    const patterns = [];
    const decisions = replay.decisions || [];

    // Pattern: summon seguido de efeito no mesmo turno
    for (let i = 0; i < decisions.length - 1; i++) {
      const d1 = decisions[i];
      const d2 = decisions[i + 1];

      if (d1.type === "summon" && d2.type === "effect" && d1.turn === d2.turn) {
        patterns.push({
          type: "summon_then_effect",
          turn: d1.turn,
          cards: [d1.card?.c, d2.card?.c],
        });
      }
    }

    // Pattern: position_change antes de ataque (preparando lethal)
    for (let i = 0; i < decisions.length - 1; i++) {
      const d1 = decisions[i];
      const d2 = decisions[i + 1];

      if (
        d1.type === "position_change" &&
        d2.type === "attack" &&
        d1.turn === d2.turn
      ) {
        patterns.push({
          type: "position_before_attack",
          turn: d1.turn,
          cards: [d1.card?.c, d2.attacker?.c],
        });
      }
    }

    // Pattern: múltiplos ataques diretos no mesmo turno (lethal push)
    const attacksByTurn = {};
    for (const d of decisions) {
      if (d.type === "attack" && d.directAttack) {
        attacksByTurn[d.turn] = (attacksByTurn[d.turn] || 0) + 1;
      }
    }
    for (const [turn, count] of Object.entries(attacksByTurn)) {
      if (count >= 2) {
        patterns.push({
          type: "lethal_push",
          turn: parseInt(turn),
          attackCount: count,
        });
      }
    }

    return patterns;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Opening Analysis
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Extrai sequência de abertura (primeiros 3 turnos do jogador)
   * @param {Object} replay
   * @returns {Array} Sequência de ações
   */
  extractOpening(replay) {
    const decisions = replay.decisions || [];
    const opening = [];

    for (const d of decisions) {
      if (d.actor !== "human") continue;
      if (d.turn > 5) break; // Primeiros 5 turnos totais = ~3 turnos do jogador

      if (
        d.type === "summon" ||
        d.type === "set_spell_trap" ||
        d.type === "effect"
      ) {
        opening.push({
          type: d.type,
          cardId: d.card?.c,
          turn: d.turn,
        });
      }
    }

    return opening;
  }
}

// Singleton
const replayAnalyzer = new ReplayAnalyzer();

export { ReplayAnalyzer, replayAnalyzer };
export default replayAnalyzer;
