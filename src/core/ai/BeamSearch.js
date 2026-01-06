// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/BeamSearch.js
// Beam search lookahead system — shallow tree search (2–3 plies)
// Com travas: depth fixo, budget de nós, anti-repetição
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Realiza beam search para encontrar a melhor sequência de ações.
 * @param {Object} game - Estado atual do jogo
 * @param {Object} strategy - Estratégia do bot
 * @param {Object} options - Configurações
 * @param {number} options.beamWidth - Quantas ações explorar por ply (default: 2)
 * @param {number} options.maxDepth - Profundidade máxima (default: 2)
 * @param {number} options.nodeBudget - Máximo de nós a simular (default: 100)
 * @param {boolean} options.useV2Evaluation - Usar evaluateBoardV2 (default: true)
 * @param {Array} options.preGeneratedActions - Ações pré-geradas como fallback
 * @returns {Object|null} - { action, score, sequence } ou null
 */
export async function beamSearchTurn(game, strategy, options = {}) {
  const {
    beamWidth = 2,
    maxDepth = 2,
    nodeBudget = 100,
    useV2Evaluation = true,
    preGeneratedActions = null, // BUGFIX: Fallback actions from caller
  } = options;

  let nodesEvaluated = 0;
  const perspectiveBot = strategy?.bot || (strategy?.id ? strategy : null);
  const resolveOpponent = (state) => {
    if (!state) return null;
    if (!perspectiveBot) return state.player;
    if (state._isPerspectiveState) return state.player;
    if (typeof state.getOpponent === "function") {
      return state.getOpponent(perspectiveBot);
    }
    return perspectiveBot.id === "player" ? state.bot : state.player;
  };
  const seenStates = new Set(); // Anti-repetição

  /**
   * Gera hash do estado para detecção de repetição.
   */
  function getStateHash(state) {
    const bot = state.bot || {};
    const player = state.player || {};

    const botField = (bot.field || [])
      .map((c) => c?.id || 0)
      .sort()
      .join(",");
    const oppField = (player.field || [])
      .map((c) => c?.id || 0)
      .sort()
      .join(",");
    const botLP = bot.lp || 0;
    const oppLP = player.lp || 0;

    return `${botField}|${oppField}|${botLP}|${oppLP}`;
  }

  /**
   * Avalia um estado usando evaluateBoardV2 ou fallback.
   */
  function evaluateState(state, perspectivePlayer) {
    if (useV2Evaluation && typeof strategy.evaluateBoardV2 === "function") {
      return strategy.evaluateBoardV2(state, perspectivePlayer);
    }
    // Fallback para evaluateBoard antiga
    return strategy.evaluateBoard(state, perspectivePlayer);
  }

  /**
   * Clona estado do jogo (shallow, mas funcional para simulação).
   */
  function cloneGameState(gameState) {
    const clonePlayer = (p) => {
      const safe = p || {};
      return {
        id: safe.id || "unknown",
        lp: safe.lp || 0,
        hand: (safe.hand || []).map((c) => ({ ...c })),
        field: (safe.field || []).map((c) => ({ ...c })),
        graveyard: (safe.graveyard || []).map((c) => ({ ...c })),
        fieldSpell: safe.fieldSpell ? { ...safe.fieldSpell } : null,
        spellTrap: safe.spellTrap ? safe.spellTrap.map((c) => ({ ...c })) : [],
        summonCount: safe.summonCount || 0,
      };
    };

    const isPerspectiveState = gameState && gameState._isPerspectiveState;
    const sourceBot = isPerspectiveState
      ? gameState.bot
      : perspectiveBot || gameState.bot || gameState.player;
    const sourcePlayer = isPerspectiveState
      ? gameState.player
      : resolveOpponent(gameState) || gameState.player || gameState.bot;

    return {
      player: clonePlayer(sourcePlayer),
      bot: clonePlayer(sourceBot),
      turn: gameState.turn,
      phase: gameState.phase,
      turnCounter: gameState.turnCounter || 0,
      _isPerspectiveState: true,
      _gameRef: gameState._gameRef || gameState, // Referência ao game original
    };
  }

  /**
   * Simula uma ação no estado clonado.
   */
  function simulateAction(state, action) {
    if (typeof strategy.simulateMainPhaseAction === "function") {
      strategy.simulateMainPhaseAction(state, action);
    }
    return state;
  }

  /**
   * Verifica se uma ação muda o estado de forma significativa.
   */
  function actionChangesState(stateBefore, stateAfter) {
    const hashBefore = getStateHash(stateBefore);
    const hashAfter = getStateHash(stateAfter);
    return hashBefore !== hashAfter;
  }

  /**
   * Recursive beam search.
   */
  async function search(currentState, depth, currentSequence = []) {
    // Trava 1: Depth limit
    if (depth >= maxDepth) {
      const score = evaluateState(currentState, currentState.bot);
      return { sequence: currentSequence, score, finalState: currentState };
    }

    // Trava 2: Node budget
    if (nodesEvaluated >= nodeBudget) {
      const score = evaluateState(currentState, currentState.bot);
      return { sequence: currentSequence, score, finalState: currentState };
    }

    // Gerar ações candidatas
    const candidates = strategy.generateMainPhaseActions(currentState);
    if (!candidates || candidates.length === 0) {
      const score = evaluateState(currentState, currentState.bot);
      return { sequence: currentSequence, score, finalState: currentState };
    }

    // Limitar ao beam width
    const topCandidates = candidates.slice(0, beamWidth);
    const branches = [];

    for (const action of topCandidates) {
      // Simular ação
      const newState = cloneGameState(currentState);
      const stateBeforeAction = getStateHash(newState);

      simulateAction(newState, action);
      nodesEvaluated++;

      // Trava 3: Anti-repetição
      const stateAfterAction = getStateHash(newState);
      if (seenStates.has(stateAfterAction)) {
        continue; // Skip estado já visto
      }

      // Se ação não muda nada, skip
      if (stateBeforeAction === stateAfterAction) {
        continue;
      }

      seenStates.add(stateAfterAction);

      // Avaliar este estado
      const immediateScore = evaluateState(newState, newState.bot);

      // Recursão: explorar próximo ply
      const futureResult = await search(newState, depth + 1, [
        ...currentSequence,
        action,
      ]);

      // Future discount: plies futuros valem menos
      const discountFactor = 0.8;
      const totalScore =
        immediateScore + (futureResult.score - immediateScore) * discountFactor;

      branches.push({
        action,
        sequence: futureResult.sequence,
        score: totalScore,
        finalState: futureResult.finalState,
      });
    }

    // Sem branches válidas? Retornar estado atual com primeira ação como fallback
    if (branches.length === 0) {
      const score = evaluateState(currentState, currentState.bot);
      // BUGFIX: Se temos candidatos mas nenhum branch válido, usar primeira ação como fallback
      if (topCandidates.length > 0 && currentSequence.length === 0) {
        return {
          sequence: [topCandidates[0]],
          score,
          finalState: currentState,
        };
      }
      return { sequence: currentSequence, score, finalState: currentState };
    }

    // Retornar melhor branch
    branches.sort((a, b) => b.score - a.score);
    return branches[0];
  }

  // Início da busca
  const initialState = cloneGameState(game);
  const baseScore = evaluateState(initialState, initialState.bot);
  seenStates.add(getStateHash(initialState));

  const result = await search(initialState, 0, []);

  // BUGFIX: Se não encontrou sequência mas temos candidatos, usar primeira ação como último recurso
  if (!result || !result.sequence || result.sequence.length === 0) {
    // BUGFIX: Usar preGeneratedActions primeiro, depois regenerar como último recurso
    const fallbackCandidates =
      preGeneratedActions || strategy.generateMainPhaseActions(game);
    if (fallbackCandidates && fallbackCandidates.length > 0) {
      console.log(
        `[BeamSearch] Using fallback action:`,
        fallbackCandidates[0]?.cardName || fallbackCandidates[0]?.type
      );
      return {
        action: fallbackCandidates[0],
        score: baseScore,
        sequence: [fallbackCandidates[0]],
        nodesEvaluated,
      };
    }
    return null;
  }

  // BUGFIX: Sempre retornar melhor ação encontrada, mesmo se score não melhorou muito
  // Isso evita bots ficarem presos sem ação quando BeamSearch explora mas não encontra melhoria significativa
  return {
    action: result.sequence[0], // Primeira ação da sequência
    score: result.score,
    sequence: result.sequence,
    nodesEvaluated,
  };
}

/**
 * Versão simplificada: beam search de 1 ply apenas (greedy melhorado).
 * @param {Object} game
 * @param {Object} strategy
 * @param {Object} options
 * @param {Array} options.preGeneratedActions - Ações pré-geradas como fallback
 * @returns {Object|null}
 */
export async function greedySearchWithEvalV2(game, strategy, options = {}) {
  const { useV2Evaluation = true, preGeneratedActions = null } = options;
  const perspectiveBot = strategy?.bot || (strategy?.id ? strategy : null);
  const resolveOpponent = (state) => {
    if (!state) return null;
    if (!perspectiveBot) return state.player;
    if (state._isPerspectiveState) return state.player;
    if (typeof state.getOpponent === "function") {
      return state.getOpponent(perspectiveBot);
    }
    return perspectiveBot.id === "player" ? state.bot : state.player;
  };

  function evaluateState(state, perspectivePlayer) {
    if (useV2Evaluation && typeof strategy.evaluateBoardV2 === "function") {
      return strategy.evaluateBoardV2(state, perspectivePlayer);
    }
    return strategy.evaluateBoard(state, perspectivePlayer);
  }

  function cloneGameState(gameState) {
    const clonePlayer = (p) => {
      const safe = p || {};
      return {
        id: safe.id || "unknown",
        lp: safe.lp || 0,
        hand: (safe.hand || []).map((c) => ({ ...c })),
        field: (safe.field || []).map((c) => ({ ...c })),
        graveyard: (safe.graveyard || []).map((c) => ({ ...c })),
        fieldSpell: safe.fieldSpell ? { ...safe.fieldSpell } : null,
        spellTrap: safe.spellTrap ? safe.spellTrap.map((c) => ({ ...c })) : [],
        summonCount: safe.summonCount || 0,
      };
    };

    const isPerspectiveState = gameState && gameState._isPerspectiveState;
    const sourceBot = isPerspectiveState
      ? gameState.bot
      : perspectiveBot || gameState.bot || gameState.player;
    const sourcePlayer = isPerspectiveState
      ? gameState.player
      : resolveOpponent(gameState) || gameState.player || gameState.bot;

    return {
      player: clonePlayer(sourcePlayer),
      bot: clonePlayer(sourceBot),
      turn: gameState.turn,
      phase: gameState.phase,
      _isPerspectiveState: true,
    };
  }

  // BUGFIX: Usar preGeneratedActions primeiro, depois regenerar como fallback
  const candidates =
    preGeneratedActions || strategy.generateMainPhaseActions(game);
  if (!candidates || candidates.length === 0) {
    return null;
  }

  const baseScore = evaluateState(game, perspectiveBot || strategy.bot);
  let bestAction = candidates[0]; // BUGFIX: Inicializar com primeira ação como fallback
  let bestScore = baseScore;

  for (const action of candidates) {
    const simState = cloneGameState(game);
    if (typeof strategy.simulateMainPhaseAction === "function") {
      strategy.simulateMainPhaseAction(simState, action);
    }
    const score = evaluateState(simState, simState.bot);

    // BUGFIX: Usar >= em vez de > para sempre ter uma ação escolhida
    if (score >= bestScore) {
      bestScore = score;
      bestAction = action;
    }
  }

  // BUGFIX: Sempre retornar melhor ação (mesmo que não melhore score)
  // Isso garante que o bot não fique preso
  return {
    action: bestAction,
    score: bestScore,
    sequence: [bestAction],
  };
}
