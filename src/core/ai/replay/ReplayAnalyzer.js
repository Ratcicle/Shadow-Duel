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
      "target_selection", // v4: captura de seleção de alvos
    ]);
    
    // Contador para IDs únicos de digest
    this._nextDigestId = 1;
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

    // MELHORIA: Gerar ID único para o digest
    const digestId = this._nextDigestId++;

    // MELHORIA: Track availableActions completeness para métricas de qualidade
    const hasAvailableActions = !!(decision.availableActions && decision.availableActions.length > 0);
    
    // Decisões proativas (summon, spell, attack) devem ter availableActions para serem úteis para ML
    // A métrica de qualidade será reportada pelo calculateDigestQualityMetrics()

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
      id: digestId, // ID único para referência
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
      // Novos campos para contexto completo
      playerHand: snapshot?.playerHand ? [...snapshot.playerHand] : [],
      playerGraveyard: snapshot?.playerGraveyard
        ? [...snapshot.playerGraveyard]
        : [],
      botGraveyard: snapshot?.botGraveyard ? [...snapshot.botGraveyard] : [],
      playerExtraDeckCount: snapshot?.playerExtraDeckCount ?? 0,
      botExtraDeckCount: snapshot?.botExtraDeckCount ?? 0,
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
      // Contexto completo para análise precisa
      playerHand: state.playerHand,
      playerGraveyard: state.playerGraveyard,
      botGraveyard: state.botGraveyard,
      playerExtraDeckCount: state.playerExtraDeckCount,
      botExtraDeckCount: state.botExtraDeckCount,
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
    // Novos campos para contexto completo
    if (delta.playerHand !== undefined)
      state.playerHand = [...delta.playerHand];
    if (delta.playerGraveyard !== undefined)
      state.playerGraveyard = [...delta.playerGraveyard];
    if (delta.botGraveyard !== undefined)
      state.botGraveyard = [...delta.botGraveyard];
    if (delta.playerExtraDeckCount !== undefined)
      state.playerExtraDeckCount = delta.playerExtraDeckCount;
    if (delta.botExtraDeckCount !== undefined)
      state.botExtraDeckCount = delta.botExtraDeckCount;
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

      case "target_selection":
        return {
          ...base,
          sourceCardId: decision.sourceCard?.c || decision.sourceCard?.id,
          effectId: decision.effectId,
          selectedTargets: (decision.selectedTargets || []).map(t => ({
            id: t.c || t.id,
            name: t.name,
          })),
          selectedCount: decision.selectedCount || 0,
        };

      case "pass":
        return base;

      default:
        return base;
    }
  }

  /**
   * Calcula outcome da decisão (delta após 1 turno)
   * Melhorado: usa delta imediato como fallback quando snapshot futuro não está disponível
   */
  _calculateOutcome(decisions, currentIndex, actor, snapshotByTurn, replay) {
    const currentDecision = decisions[currentIndex];
    const currentTurn = currentDecision.turn || 0;

    // Buscar próxima decisão do mesmo ator ou fim
    let nextSnapshot = null;
    let foundNextTurn = false;
    let nextDecisionIndex = -1;

    for (let i = currentIndex + 1; i < decisions.length; i++) {
      const d = decisions[i];
      // Próximo turno do mesmo jogador
      if (d.actor === actor && d.turn > currentTurn) {
        nextDecisionIndex = i;
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

    // Suportar ambos formatos: normalizado (result = "win") e raw (result.winner = "human")
    const playerWon =
      replay.result === "win" ||
      replay.result?.winner === "human" ||
      replay.result?.winner === "player";

    // Para decisões do bot, inverter o resultado (bot ganhou = loss para player)
    let gameResult;
    if (actor === "bot") {
      gameResult = playerWon ? "loss" : "win"; // Do ponto de vista do bot
    } else {
      gameResult = playerWon ? "win" : "loss"; // Do ponto de vista do player
    }

    // MELHORIA: Se não encontrou snapshot futuro, tentar usar delta imediato da decisão
    if (!nextSnapshot && !foundNextTurn) {
      // Usar delta imediato da própria decisão como proxy do impacto
      const immediateDelta = currentDecision.delta;
      if (immediateDelta) {
        // Calcular impacto imediato baseado no delta
        const playerLPChange = immediateDelta.playerLP !== undefined
          ? immediateDelta.playerLP - (snapshotByTurn[currentTurn]?.playerLP || 8000)
          : 0;
        const botLPChange = immediateDelta.botLP !== undefined
          ? immediateDelta.botLP - (snapshotByTurn[currentTurn]?.botLP || 8000)
          : 0;
        
        const playerFieldChange = immediateDelta.playerField !== undefined
          ? immediateDelta.playerField.length - (snapshotByTurn[currentTurn]?.playerField?.length || 0)
          : 0;
        const botFieldChange = immediateDelta.botField !== undefined
          ? immediateDelta.botField.length - (snapshotByTurn[currentTurn]?.botField?.length || 0)
          : 0;

        return {
          gameResult,
          lpDelta: (playerLPChange !== 0 || botLPChange !== 0) ? {
            player: playerLPChange,
            bot: botLPChange,
            advantage: playerLPChange - botLPChange,
          } : null,
          boardDelta: (playerFieldChange !== 0 || botFieldChange !== 0) ? {
            player: playerFieldChange,
            bot: botFieldChange,
            advantage: playerFieldChange - botFieldChange,
          } : null,
          source: "immediate_delta", // Indicar que veio do delta imediato
        };
      }
      
      // Sem delta disponível - retornar apenas o resultado final
      return {
        gameResult,
        lpDelta: null,
        boardDelta: null,
      };
    }

    // MELHORIA: Acumular deltas se não temos snapshot exato
    // Calcular estado no momento da decisão e no próximo turno
    const currentSnapshot = snapshotByTurn[currentTurn];
    
    if (!currentSnapshot && !nextSnapshot) {
      // Fallback: acumular deltas entre a decisão atual e a próxima do mesmo ator
      if (nextDecisionIndex > currentIndex) {
        let accPlayerLP = 0, accBotLP = 0;
        let accPlayerField = 0, accBotField = 0;
        
        // Começar a partir de currentIndex + 1 para evitar acesso a índice negativo
        for (let i = currentIndex + 1; i < nextDecisionIndex; i++) {
          const d = decisions[i];
          const prev = decisions[i - 1];
          if (d.delta && prev?.delta) {
            // Se temos delta de LP, acumular a diferença
            if (d.delta.playerLP !== undefined && prev.delta.playerLP !== undefined) {
              accPlayerLP += d.delta.playerLP - prev.delta.playerLP;
            }
            if (d.delta.botLP !== undefined && prev.delta.botLP !== undefined) {
              accBotLP += d.delta.botLP - prev.delta.botLP;
            }
          }
        }
        
        if (accPlayerLP !== 0 || accBotLP !== 0) {
          return {
            gameResult: null,
            lpDelta: {
              player: accPlayerLP,
              bot: accBotLP,
              advantage: accPlayerLP - accBotLP,
            },
            boardDelta: null,
            source: "accumulated_deltas",
          };
        }
      }
      
      return {
        gameResult: null,
        lpDelta: null,
        boardDelta: null,
      };
    }

    // Cálculo normal com snapshots disponíveis
    const basePlayerLP = currentSnapshot?.playerLP ?? 8000;
    const baseBotLP = currentSnapshot?.botLP ?? 8000;
    const nextPlayerLP = nextSnapshot?.playerLP ?? basePlayerLP;
    const nextBotLP = nextSnapshot?.botLP ?? baseBotLP;

    const playerLPDelta = nextPlayerLP - basePlayerLP;
    const botLPDelta = nextBotLP - baseBotLP;

    const playerFieldDelta =
      (nextSnapshot?.playerField?.length || 0) -
      (currentSnapshot?.playerField?.length || 0);
    const botFieldDelta =
      (nextSnapshot?.botField?.length || 0) -
      (currentSnapshot?.botField?.length || 0);

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

  // ─────────────────────────────────────────────────────────────────────────
  // Digest Quality Metrics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Calcula métricas de qualidade para um conjunto de digests
   * Útil para avaliar se os dados são bons para ML
   * @param {Array} digests - Array de training digests
   * @returns {Object} Métricas de qualidade
   */
  calculateDigestQualityMetrics(digests) {
    if (!digests || digests.length === 0) {
      return { 
        totalDigests: 0,
        quality: "no_data",
        message: "Nenhum digest para analisar"
      };
    }

    // Métricas de completude
    const withAvailableActions = digests.filter(d => d.availableActions && d.availableActions.length > 0);
    const withOutcome = digests.filter(d => d.outcome?.lpDelta !== null || d.outcome?.boardDelta !== null || d.outcome?.gameResult !== null);
    const withDecisionTime = digests.filter(d => d.decisionTime !== null && d.decisionTime > 0);
    const withContext = digests.filter(d => d.context && d.context.playerLP !== undefined);

    // Decisões proativas (mais úteis para ML)
    const proactiveTypes = ['summon', 'attack', 'spell', 'effect', 'set_spell_trap'];
    const proactiveDigests = digests.filter(d => proactiveTypes.includes(d.promptType));
    const proactiveWithActions = proactiveDigests.filter(d => d.availableActions && d.availableActions.length > 0);

    // Distribuição por tipo
    const typeDistribution = {};
    digests.forEach(d => {
      typeDistribution[d.promptType] = (typeDistribution[d.promptType] || 0) + 1;
    });

    // Distribuição por actor
    const actorDistribution = {};
    digests.forEach(d => {
      actorDistribution[d.actor] = (actorDistribution[d.actor] || 0) + 1;
    });

    // Calcular score de qualidade (0-100)
    const availableActionsScore = (withAvailableActions.length / digests.length) * 30;
    const outcomeScore = (withOutcome.length / digests.length) * 25;
    const proactiveActionsScore = proactiveDigests.length > 0 
      ? (proactiveWithActions.length / proactiveDigests.length) * 25 
      : 25;
    const contextScore = (withContext.length / digests.length) * 20;
    
    const qualityScore = availableActionsScore + outcomeScore + proactiveActionsScore + contextScore;

    // Classificar qualidade
    let quality = "low";
    if (qualityScore >= 80) quality = "high";
    else if (qualityScore >= 60) quality = "good";
    else if (qualityScore >= 40) quality = "medium";

    return {
      totalDigests: digests.length,
      quality,
      qualityScore: Math.round(qualityScore),
      completeness: {
        withAvailableActions: withAvailableActions.length,
        withAvailableActionsPercent: Math.round((withAvailableActions.length / digests.length) * 100),
        withOutcome: withOutcome.length,
        withOutcomePercent: Math.round((withOutcome.length / digests.length) * 100),
        withDecisionTime: withDecisionTime.length,
        withDecisionTimePercent: Math.round((withDecisionTime.length / digests.length) * 100),
        withContext: withContext.length,
        withContextPercent: Math.round((withContext.length / digests.length) * 100),
      },
      proactiveDecisions: {
        total: proactiveDigests.length,
        withAvailableActions: proactiveWithActions.length,
        coveragePercent: proactiveDigests.length > 0 
          ? Math.round((proactiveWithActions.length / proactiveDigests.length) * 100)
          : 0,
      },
      typeDistribution,
      actorDistribution,
      recommendations: this._generateQualityRecommendations(
        withAvailableActions.length / digests.length,
        withOutcome.length / digests.length,
        proactiveDigests.length > 0 ? proactiveWithActions.length / proactiveDigests.length : 1
      ),
    };
  }

  /**
   * Gera recomendações baseadas nas métricas de qualidade
   * @private
   */
  _generateQualityRecommendations(availableActionsRatio, outcomeRatio, proactiveActionsRatio) {
    const recommendations = [];

    if (availableActionsRatio < 0.5) {
      recommendations.push({
        priority: "high",
        issue: "Baixa cobertura de availableActions",
        suggestion: "Verificar se registerAvailableActions está sendo chamado antes de cada decisão no Game.js",
      });
    }

    if (outcomeRatio < 0.3) {
      recommendations.push({
        priority: "medium",
        issue: "Muitos digests sem outcome calculado",
        suggestion: "Aumentar frequência de snapshots (SNAPSHOT_INTERVAL menor) para melhorar cálculo de outcome",
      });
    }

    if (proactiveActionsRatio < 0.6) {
      recommendations.push({
        priority: "high",
        issue: "Decisões proativas sem opções disponíveis",
        suggestion: "Emitir eventos main_phase_options e battle_phase_options no Game.js",
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        priority: "info",
        issue: "Dados de boa qualidade",
        suggestion: "Continue coletando mais replays para melhorar a confiança estatística",
      });
    }

    return recommendations;
  }
}

// Singleton
const replayAnalyzer = new ReplayAnalyzer();

export { ReplayAnalyzer, replayAnalyzer };
export default replayAnalyzer;
