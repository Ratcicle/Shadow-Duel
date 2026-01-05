/**
 * GameTreeSearch.js — P2: Deep Lookahead com Minimax + Alpha-Beta Pruning
 *
 * Componente responsável por 4-6 ply lookahead estratégico.
 * Apenas acionado em decisões críticas (lethal check, defensive need).
 *
 * Filosofia:
 * - NÃO avalia cada ação: seria 1000+ simulações. Só avalia "sérias candidatas" (beam width 2-3).
 * - Usa alpha-beta pruning para podar ramos fracos.
 * - Transposition table (mapa de hash) para evitar re-avaliação.
 * - Desconto futuro: plies mais distantes = menos relevantes.
 *
 * Entrada: game state, lista de ações candidatas, perspectiva (bot/player)
 * Saída: { action, score, depth, confidence }
 */

const DEFAULT_MAX_PLY = 4;
const TRANSPOSITION_MAX_SIZE = 1000;
const ALPHA_INIT = -Infinity;
const BETA_INIT = Infinity;
const FUTURE_DISCOUNT = 0.85; // Desconto por ply: score_ply_n = score * (0.85 ^ n)

/**
 * Estado simulado do tabuleiro para cache de transposição
 */
function hashGameState(gameState) {
  try {
    // Hash simplificado: LP, field size, hand size, graveyard size
    const bot = gameState.bot || gameState.currentPlayer;
    const player = gameState.player || gameState.opponent;

    const botHash = `B:${bot?.lp || 0}|${bot?.field?.length || 0}|${
      bot?.hand?.length || 0
    }`;
    const playerHash = `P:${player?.lp || 0}|${player?.field?.length || 0}|${
      player?.hand?.length || 0
    }`;

    return `${botHash}~${playerHash}`;
  } catch {
    return `HASH_ERROR_${Math.random()}`;
  }
}

/**
 * Clona o game state para simulação profunda
 */
function cloneGameStateDeep(gameState) {
  try {
    const cloned = JSON.parse(JSON.stringify(gameState));
    // CRITICAL: Mark as simulated state to prevent infinite recursion in P2
    cloned._isPerspectiveState = true;
    return cloned;
  } catch {
    // Fallback: shallow copy se JSON falhar
    return {
      ...gameState,
      bot: { ...gameState.bot },
      player: { ...gameState.player },
      _isPerspectiveState: true,
    };
  }
}

/**
 * Avalia um estado de jogo (folha do minimax)
 * Retorna score numérico (higher = melhor para maximizer)
 */
function shouldLogWarnings(gameState, perspective) {
  if (perspective && perspective.debug === false) return false;
  if (gameState?.bot && gameState.bot.debug === false) return false;
  if (gameState?.player && gameState.player.debug === false) return false;
  return true;
}

function evaluateLeafState(gameState, perspective, maxScore = 100) {
  try {
    if (!gameState || typeof gameState !== "object") return 0;
    const persp = perspective?.id ? perspective : gameState.bot;
    const opp = perspective?.id === "bot" ? gameState.player : gameState.bot;

    if (!persp || !opp) return 0;

    let score = 0;

    // 1. Vantagem de LP (normalized)
    const lpDiff = (persp.lp || 0) - (opp.lp || 0);
    score += Math.min(lpDiff / 1000, 20); // cap em 20 pontos

    // 2. Presença de campo
    const perpFieldValue = (persp.field || []).reduce(
      (sum, m) => sum + ((m?.atk || 0) / 500),
      0
    );
    const oppFieldValue = (opp.field || []).reduce(
      (sum, m) => sum + ((m?.atk || 0) / 500),
      0
    );
    score += perpFieldValue - oppFieldValue;

    // 3. Tamanho de mão (recursos)
    const handDiff = (persp.hand?.length || 0) - (opp.hand?.length || 0);
    score += handDiff * 0.5;

    // 4. Graveyard value (Shadow-Heart suporta recursão)
    const perpGYCount = persp.graveyard?.length || 0;
    const oppGYCount = opp.graveyard?.length || 0;
    score += (perpGYCount - oppGYCount) * 0.3;

    // 5. Lethal check
    if (opp.lp <= 0) return maxScore; // Vitória
    if (persp.lp <= 0) return -maxScore; // Derrota

    return Math.min(score, maxScore);
  } catch (e) {
    if (shouldLogWarnings(gameState, perspective)) {
      console.warn(`[GameTreeSearch] evaluateLeafState erro:`, e);
    }
    return 0;
  }
}

/**
 * Simula uma ação e retorna novo estado (determinístico para core game state)
 * Nota: Game.js effects/events não são simulados; apenas board state muda
 */
function simulateAction(gameState, action, perspective) {
  const simState = cloneGameStateDeep(gameState);
  const persp = perspective?.id ? perspective : gameState.bot;
  const resolveSimPlayer = (id) => {
    if (!simState) return null;
    if (simState.bot?.id === id) return simState.bot;
    if (simState.player?.id === id) return simState.player;
    return id === "bot" ? simState.bot : simState.player;
  };
  const simPersp = resolveSimPlayer(persp?.id);
  const simOpp =
    simPersp === simState?.bot ? simState?.player : simState?.bot;
  if (!simPersp || !simOpp) return simState;

  try {
    // Simulação simplificada: apenas atualiza board state
    // (Não simula efeitos de card, apenas movimento de cartas)

    if (action.type === "summon") {
      const card =
        action.card ||
        (Number.isInteger(action.index) ? simPersp.hand?.[action.index] : null);
      if (!card) return simState;
      if (!simPersp.field) simPersp.field = [];
      simPersp.field.push({ ...card });

      // Remove da mão
      if (simPersp.hand && Array.isArray(simPersp.hand)) {
        const idx = Number.isInteger(action.index)
          ? action.index
          : simPersp.hand.indexOf(card);
        if (idx >= 0) simPersp.hand.splice(idx, 1);
      }
    } else if (action.type === "attack") {
      const attacker = action.attacker;
      const target = action.target;
      const opp = simOpp;

      // Dano direto ou batalha
      if (!target) {
        opp.lp = Math.max(0, (opp.lp || 0) - (attacker?.atk || 0));
      } else {
        // Batalha simplificada: maior ATK vence
        const defValue = target?.def || target?.atk || 0;
        if ((attacker?.atk || 0) > defValue) {
          opp.lp = Math.max(
            0,
            (opp.lp || 0) - ((attacker?.atk || 0) - defValue)
          );
          if (opp.field && Array.isArray(opp.field)) {
            const idx = opp.field.indexOf(target);
            if (idx >= 0) opp.field.splice(idx, 1);
          }
        } else {
          // Attacker é destruído
          if (simPersp.field && Array.isArray(simPersp.field)) {
            const idx = simPersp.field.indexOf(attacker);
            if (idx >= 0) simPersp.field.splice(idx, 1);
          }
        }
      }
    }
    // Outras ações: simplemente ignorar por agora (set, spell, etc)

    return simState;
  } catch (e) {
    console.warn(`[GameTreeSearch] simulateAction erro:`, e);
    return simState;
  }
}

/**
 * Gera ações candidatas para simulação no minimax
 * Nota: usar estratégia existente generateMainPhaseActions()
 */
function generateCandidateActions(gameState, strategy, perspective) {
  try {
    // CRITICAL: Ensure gameState is marked as simulated to prevent infinite P2 recursion
    if (!gameState._isPerspectiveState) {
      gameState._isPerspectiveState = true;
    }
    // Retorna top 2-3 ações por scoring (beam width)
    const allActions = strategy.generateMainPhaseActions(gameState);
    return allActions.slice(0, 3); // Limita a 3 para reduzir branching
  } catch {
    return [];
  }
}

/**
 * Minimax com Alpha-Beta Pruning
 *
 * Parâmetros:
 * - gameState: estado atual
 * - depth: profundidade (0 = folha)
 * - isMaximizing: true = turno do bot (maximizar), false = turno do oponente (minimizar)
 * - alpha: best value maximizer pode garantir
 * - beta: best value minimizer pode garantir
 * - strategy: instância da estratégia (para gerar ações)
 * - perspective: perspectiva (bot/player)
 * - transpositions: mapa de hash para cache
 *
 * Retorno: { value: score, action: bestAction }
 */
function minimax(
  gameState,
  depth,
  isMaximizing,
  alpha,
  beta,
  strategy,
  perspective,
  transpositions = new Map()
) {
  // Base case: folha ou limite de profundidade
  if (depth === 0) {
    const leafValue = evaluateLeafState(gameState, perspective);
    return { value: leafValue, action: null };
  }

  // Verificar transposition table
  const stateHash = hashGameState(gameState);
  if (transpositions.has(stateHash)) {
    const cached = transpositions.get(stateHash);
    if (cached.depth >= depth) {
      return cached.result;
    }
  }

  const persp = perspective?.id ? perspective : gameState.bot;
  const actions = generateCandidateActions(gameState, strategy, perspective);

  let bestValue = isMaximizing ? -Infinity : Infinity;
  let bestAction = actions.length > 0 ? actions[0] : null;

  if (actions.length === 0) {
    // Sem ações: avaliar estado atual
    const leafValue = evaluateLeafState(gameState, perspective);
    return { value: leafValue, action: null };
  }

  for (const action of actions) {
    const nextState = simulateAction(gameState, action, persp);

    // Recursão com troca de perspectiva
    const nextPerspective =
      persp?.id === "bot" ? nextState.player : nextState.bot;
    const { value } = minimax(
      nextState,
      depth - 1,
      !isMaximizing,
      alpha,
      beta,
      strategy,
      nextPerspective,
      transpositions
    );

    // Aplicar desconto futuro (plies distantes menos relevantes)
    const discountedValue =
      value * Math.pow(FUTURE_DISCOUNT, DEFAULT_MAX_PLY - depth);

    if (isMaximizing) {
      if (discountedValue > bestValue) {
        bestValue = discountedValue;
        bestAction = action;
      }
      alpha = Math.max(alpha, bestValue);
    } else {
      if (discountedValue < bestValue) {
        bestValue = discountedValue;
        bestAction = action;
      }
      beta = Math.min(beta, bestValue);
    }

    // Alpha-beta pruning
    if (beta <= alpha) break;
  }

  // Cache resultado
  if (transpositions.size < TRANSPOSITION_MAX_SIZE) {
    transpositions.set(stateHash, {
      result: { value: bestValue, action: bestAction },
      depth,
    });
  }

  return { value: bestValue, action: bestAction };
}

/**
 * API Pública: Busca melhor ação via minimax
 *
 * Uso: const { action, score } = gameTreeSearch(game, strategy, perspective, maxPly);
 */
export function gameTreeSearch(
  gameState,
  strategy,
  perspective = null,
  maxPly = DEFAULT_MAX_PLY
) {
  try {
    const transpositions = new Map();
    const persp = perspective?.id ? perspective : gameState.bot;

    const { value: score, action } = minimax(
      gameState,
      maxPly,
      true, // Sempre começa com maximizing (turno do bot)
      ALPHA_INIT,
      BETA_INIT,
      strategy,
      persp,
      transpositions
    );

    return {
      action,
      score,
      depth: maxPly,
      confidence: Math.min(Math.abs(score) / 100, 1), // 0-1 confidence
      transpositionHits: transpositions.size,
    };
  } catch (e) {
    if (strategy?.bot?.debug !== false) {
      console.warn(`[GameTreeSearch] gameTreeSearch erro:`, e);
    }
    return {
      action: null,
      score: 0,
      depth: maxPly,
      confidence: 0,
      error: e.message,
    };
  }
}

/**
 * API para análise crítica: avalia se situação é "lethal checkable" ou "defense critical"
 * Retorna true se vale a pena rodar minimax pesado
 */
export function shouldUseGameTreeSearch(
  gameState,
  perspective,
  forceCritical = false
) {
  try {
    // Debug: permitir forçar via flag
    if (forceCritical) return true;

    const persp = perspective?.id ? perspective : gameState.bot;
    const opp = perspective?.id === "bot" ? gameState.player : gameState.bot;

    if (!persp || !opp) return false;

    const lpDiff = (persp.lp || 0) - (opp.lp || 0);
    const fieldPresence =
      (persp.field?.length || 0) + (persp.hand?.length || 0);
    const oppFieldPresence = opp.field?.length || 0;

    // Situação crítica REDEFINIDA (mais lenient para testes):
    // 1. LP baixo (enemy <5000 OU self <6000)
    // 2. Field presença significativa
    const isOppLowLP = opp.lp <= 5000;
    const isSelfLowLP = persp.lp <= 6000;
    const hasGoodField = fieldPresence >= 2;
    const oppHasThreatField = oppFieldPresence >= 2;

    // Aciona P2 se:
    // - Oponente em LP baixo E temos campo
    // - Somos em LP baixo E opp tem ameaças
    // - Diferença de LP > 3000 (estamos ganhando confortavelmente)
    const isLethalClose = isOppLowLP && hasGoodField;
    const isDefenseCritical = isSelfLowLP && oppHasThreatField;
    const isGrindVictory = lpDiff > 3000 && fieldPresence >= 1;

    return isLethalClose || isDefenseCritical || isGrindVictory;
  } catch {
    return false;
  }
}

/**
 * Estimativa de complexidade (para debug/logging)
 */
export function estimateSearchComplexity(maxPly, beamWidth = 3) {
  let nodes = 1;
  for (let i = 0; i < maxPly; i++) {
    nodes *= beamWidth;
  }
  return nodes;
}
