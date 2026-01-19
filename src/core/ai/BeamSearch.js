// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/BeamSearch.js

// Configuration constants for beam search
const DECISIVE_ADVANTAGE_THRESHOLD = 10.0; // Score indicating clear win
const DECISIVE_DISADVANTAGE_THRESHOLD = -10.0; // Score indicating clear loss

/**
 * Creates a lazy player object that implements copy-on-write for zones.
 * Zones are only cloned when first accessed via getter (lazy cloning).
 * This significantly reduces memory allocations during beam search.
 *
 * @param {Object} source - Source player object to wrap
 * @returns {Object} Lazy player with copy-on-write semantics
 */
function createLazyPlayer(source) {
  const safe = source || {};
  return {
    id: safe.id || "unknown",
    lp: safe.lp || 0,
    summonCount: safe.summonCount || 0,
    // Lazy references - will be cloned on first modification
    _handRef: safe.hand || [],
    _fieldRef: safe.field || [],
    _graveyardRef: safe.graveyard || [],
    _spellTrapRef: safe.spellTrap || [],
    _fieldSpellRef: safe.fieldSpell,
    // Flags to track which zones have been cloned
    _handCloned: false,
    _fieldCloned: false,
    _graveyardCloned: false,
    _spellTrapCloned: false,
    _fieldSpellCloned: false,
    // Getters for lazy access
    get hand() {
      if (!this._handCloned) {
        this._handRef = this._handRef.map((c) => ({ ...c }));
        this._handCloned = true;
      }
      return this._handRef;
    },
    set hand(val) {
      this._handRef = val;
      this._handCloned = true;
    },
    get field() {
      if (!this._fieldCloned) {
        this._fieldRef = this._fieldRef.map((c) => ({ ...c }));
        this._fieldCloned = true;
      }
      return this._fieldRef;
    },
    set field(val) {
      this._fieldRef = val;
      this._fieldCloned = true;
    },
    get graveyard() {
      if (!this._graveyardCloned) {
        this._graveyardRef = this._graveyardRef.map((c) => ({ ...c }));
        this._graveyardCloned = true;
      }
      return this._graveyardRef;
    },
    set graveyard(val) {
      this._graveyardRef = val;
      this._graveyardCloned = true;
    },
    get spellTrap() {
      if (!this._spellTrapCloned) {
        this._spellTrapRef = this._spellTrapRef.map((c) => ({ ...c }));
        this._spellTrapCloned = true;
      }
      return this._spellTrapRef;
    },
    set spellTrap(val) {
      this._spellTrapRef = val;
      this._spellTrapCloned = true;
    },
    get fieldSpell() {
      if (!this._fieldSpellCloned && this._fieldSpellRef) {
        this._fieldSpellRef = { ...this._fieldSpellRef };
        this._fieldSpellCloned = true;
      }
      return this._fieldSpellRef;
    },
    set fieldSpell(val) {
      this._fieldSpellRef = val;
      this._fieldSpellCloned = true;
    },
  };
}

function actionRequiresHand(actionType) {
  return (
    actionType === "summon" ||
    actionType === "spell" ||
    actionType === "handIgnition" ||
    actionType === "set_spell_trap" ||
    actionType === "special_summon_sanctum_protector"
  );
}

function expectedHandKind(actionType) {
  if (
    actionType === "summon" ||
    actionType === "handIgnition" ||
    actionType === "special_summon_sanctum_protector"
  ) {
    return "monster";
  }
  if (actionType === "spell") return "spell";
  if (actionType === "set_spell_trap") return ["spell", "trap"];
  return null;
}

function actionIsValidForHand(action, hand) {
  if (!action) return false;
  if (!actionRequiresHand(action.type)) return true;
  if (!Array.isArray(hand)) return false;
  if (!Number.isInteger(action.index)) return false;
  const card = hand[action.index];
  if (!card) return false;
  const requiredKind = expectedHandKind(action.type);
  if (requiredKind) {
    const requiredKinds = Array.isArray(requiredKind)
      ? requiredKind
      : [requiredKind];
    if (!requiredKinds.includes(card.cardKind)) return false;
  }
  if (action.cardName && card.name !== action.cardName) return false;
  return true;
}

function filterValidHandActions(actions, hand) {
  if (!Array.isArray(actions)) return [];
  if (!Array.isArray(hand)) return actions.slice();
  return actions.filter((action) => actionIsValidForHand(action, hand));
}
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
   * Clona estado do jogo usando lazy cloning pattern.
   * Zonas são copiadas apenas quando modificadas (copy-on-write).
   * Isso reduz significativamente a alocação de memória durante beam search.
   */
  function cloneGameState(gameState) {
    const isPerspectiveState = gameState && gameState._isPerspectiveState;
    const sourceBot = isPerspectiveState
      ? gameState.bot
      : perspectiveBot || gameState.bot || gameState.player;
    const sourcePlayer = isPerspectiveState
      ? gameState.player
      : resolveOpponent(gameState) || gameState.player || gameState.bot;

    return {
      player: createLazyPlayer(sourcePlayer),
      bot: createLazyPlayer(sourceBot),
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

    // Trava 3: Early termination for decisive advantage
    // If we're already winning clearly (depth > 0), no need to explore further
    if (depth > 0 && currentSequence.length > 0) {
      const currentScore = evaluateState(currentState, currentState.bot);

      if (currentScore >= DECISIVE_ADVANTAGE_THRESHOLD) {
        // Already winning, stop exploring
        return { sequence: currentSequence, score: currentScore, finalState: currentState };
      }

      if (currentScore <= DECISIVE_DISADVANTAGE_THRESHOLD) {
        // Already losing badly, this branch is unlikely to help
        return { sequence: currentSequence, score: currentScore, finalState: currentState };
      }
    }

    // Gerar ações candidatas
    let candidates = null;
    if (depth === 0 && Array.isArray(preGeneratedActions)) {
      const handForValidation = currentState?.bot?.hand || [];
      candidates = filterValidHandActions(
        preGeneratedActions,
        handForValidation
      );
    }
    if (!candidates || candidates.length === 0) {
      candidates = strategy.generateMainPhaseActions(currentState);
    }
    if (!candidates || candidates.length === 0) {
      const score = evaluateState(currentState, currentState.bot);
      return { sequence: currentSequence, score, finalState: currentState };
    }

    // Limitar ao beam width
    // MELHORIA: No primeiro ply (depth=0), explorar mais candidatos para melhor seleção inicial
    const effectiveBeamWidth =
      depth === 0 ? Math.min(beamWidth + 1, candidates.length) : beamWidth;
    const topCandidates = candidates.slice(0, effectiveBeamWidth);
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
    const handForValidation =
      perspectiveBot?.hand || game?.bot?.hand || game?.player?.hand || [];
    let fallbackCandidates = filterValidHandActions(
      preGeneratedActions,
      handForValidation
    );
    if (!fallbackCandidates.length) {
      fallbackCandidates = filterValidHandActions(
        strategy.generateMainPhaseActions(game),
        handForValidation
      );
    }
    if (fallbackCandidates && fallbackCandidates.length > 0) {
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
    const isPerspectiveState = gameState && gameState._isPerspectiveState;
    const sourceBot = isPerspectiveState
      ? gameState.bot
      : perspectiveBot || gameState.bot || gameState.player;
    const sourcePlayer = isPerspectiveState
      ? gameState.player
      : resolveOpponent(gameState) || gameState.player || gameState.bot;

    return {
      player: createLazyPlayer(sourcePlayer),
      bot: createLazyPlayer(sourceBot),
      turn: gameState.turn,
      phase: gameState.phase,
      _isPerspectiveState: true,
    };
  }

  // BUGFIX: Usar preGeneratedActions primeiro, depois regenerar como fallback
  // 🔧 FIX: Validar contra mão ORIGINAL (não simulada) para evitar index invalidation
  const originalHand =
    perspectiveBot?.hand || game?.bot?.hand || game?.player?.hand || [];
  let candidates = filterValidHandActions(preGeneratedActions, originalHand);
  if (!candidates.length) {
    candidates = filterValidHandActions(
      strategy.generateMainPhaseActions(game),
      originalHand
    );
  }
  if (!candidates.length) {
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
