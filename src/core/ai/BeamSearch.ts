// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/BeamSearch.js
import { resolvePerspectivePlayers } from "./StrategyUtils.js";
import { filterAiActionsForCurrentPhase } from "./common/phaseTiming.js";
import type {
  AIAction,
  AIState,
  BeamSearchOptions,
  BeamSearchResult,
  GreedySearchResult,
  AIStrategyBotPort,
  SearchStrategyPort,
} from "../contracts/ai.js";
import type {
  AiCardInput,
  AiLiveGamePort,
  AiPlayerInput,
  BeamPerspectiveGameState,
  SimulatedCardState,
  SimulatedPlayerState,
} from "../contracts/aiState.js";
import type {
  CardDynamicBuffMap,
  CardKind,
  CardSuppressedDynamicBuffStats,
  CardTurnBasedBuff,
  GameCard,
} from "../contracts/cards.js";

type SearchStrategyInput = SearchStrategyPort & Partial<AIStrategyBotPort>;
type SearchCardInput = (AiCardInput | GameCard | SimulatedCardState) & {
  archetypes?: readonly string[];
  turnBasedBuffs?: readonly CardTurnBasedBuff[];
};
type SearchPlayerInput =
  | AiPlayerInput
  | AIStrategyBotPort
  | SimulatedPlayerState
  | SearchStrategyInput;

function actionRequiresHand(actionType: AIAction["type"]): boolean {
  return (
    actionType === "summon" ||
    actionType === "spell" ||
    actionType === "handIgnition" ||
    actionType === "set_spell_trap" ||
    actionType === "special_summon_sanctum_protector"
  );
}

function expectedHandKind(
  actionType: AIAction["type"],
): CardKind | readonly CardKind[] | null {
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

function actionIsValidForHand(
  action: AIAction | null | undefined,
  hand: readonly SearchCardInput[] | null | undefined,
): boolean {
  if (!action) return false;
  if (!actionRequiresHand(action.type)) return true;
  if (!Array.isArray(hand)) return false;
  if (!Number.isInteger(action.index)) return false;
  const card = hand[action.index!];
  if (!card) return false;
  const requiredKind = expectedHandKind(action.type);
  if (requiredKind) {
    const requiredKinds = Array.isArray(requiredKind)
      ? requiredKind
      : [requiredKind];
    if (!requiredKinds.includes(card.cardKind as CardKind)) return false;
  }
  if (action.cardName && card.name !== action.cardName) return false;
  return true;
}

function filterValidHandActions(
  actions: readonly AIAction[] | null | undefined,
  hand: readonly SearchCardInput[] | null | undefined,
): AIAction[] {
  if (!Array.isArray(actions)) return [];
  if (!Array.isArray(hand)) return actions.slice();
  return actions.filter((action) => actionIsValidForHand(action, hand));
}
// Beam search lookahead system — shallow tree search (2–3 plies)
// Com travas: depth fixo, budget de nós, anti-repetição
// ─────────────────────────────────────────────────────────────────────────────

// Simulation clones must detach mutable buff metadata from live cards.
function cloneDynamicBuffs(
  dynamicBuffs: CardDynamicBuffMap | null | undefined,
): CardDynamicBuffMap | null | undefined {
  if (!dynamicBuffs || typeof dynamicBuffs !== "object") return dynamicBuffs;
  return Object.fromEntries(
    Object.entries(dynamicBuffs).map(([key, entry]) => [
      key,
      {
        ...entry,
        stats: Array.isArray(entry?.stats) ? [...entry.stats] : entry?.stats,
        appliedValues:
          entry?.appliedValues && typeof entry.appliedValues === "object"
            ? { ...entry.appliedValues }
            : entry?.appliedValues,
      },
    ]),
  );
}

function cloneSuppressedDynamicBuffStats(
  suppressed: CardSuppressedDynamicBuffStats | undefined,
): CardSuppressedDynamicBuffStats | undefined {
  if (!suppressed || typeof suppressed !== "object") return suppressed;
  return Object.fromEntries(
    Object.entries(suppressed).map(([key, entry]) => [
      key,
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? { ...entry }
        : Array.isArray(entry)
          ? [...entry]
          : entry,
    ]),
  ) as CardSuppressedDynamicBuffStats;
}

function cloneCardForSim(card: SearchCardInput): SimulatedCardState;
function cloneCardForSim(
  card: SearchCardInput | null | undefined,
): SimulatedCardState | null | undefined {
  if (!card || typeof card !== "object") return card;
  const clone = { ...card };
  clone.dynamicBuffs = cloneDynamicBuffs(card.dynamicBuffs);
  clone.suppressedDynamicBuffStatsByKey = cloneSuppressedDynamicBuffStats(
    card.suppressedDynamicBuffStatsByKey,
  );
  clone.temporarySuppressedDynamicBuffStatsByKey =
    cloneSuppressedDynamicBuffStats(card.temporarySuppressedDynamicBuffStatsByKey);
  if (Array.isArray(card.archetypes)) clone.archetypes = [...card.archetypes];
  if (Array.isArray(card.effects)) clone.effects = [...card.effects];
  if (card.counters instanceof Map) clone.counters = new Map(card.counters);
  if (Array.isArray(card.equips)) clone.equips = [...card.equips];
  if (Array.isArray(card.turnBasedBuffs)) {
    clone.turnBasedBuffs = card.turnBasedBuffs.map((buff) => ({ ...buff }));
  }
  return clone as SimulatedCardState;
}

/**
 * Finds the best action sequence with bounded beam search.
 * @param {object} game - Current game state.
 * @param {object} strategy - Bot strategy.
 * @param {object} options - Search options.
 * @returns {object|null} Best action result, or null.
 */
export async function beamSearchTurn(
  game: AIState,
  strategy: SearchStrategyInput,
  options: BeamSearchOptions = {},
): Promise<BeamSearchResult | null> {
  const {
    beamWidth = 2,
    maxDepth = 2,
    nodeBudget = 100,
    useV2Evaluation = true,
    preGeneratedActions = null, // BUGFIX: Fallback actions from caller
  } = options;

  let nodesEvaluated = 0;
  const perspectiveBot = strategy?.bot || (strategy?.id ? strategy : null);
  const resolveOpponent = (state: AIState): SimulatedPlayerState | null => {
    return resolvePerspectivePlayers(state, perspectiveBot || state?.bot)
      .opponent;
  };
  const seenStates = new Set<string>(); // Anti-repetição

  /**
   * Gera hash do estado para detecção de repetição.
   */
  function getStateHash(state: AIState): string {
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
    const botHandLen = (bot.hand || []).length;
    const botSTLen = (bot.spellTrap || []).length;

    return `${botField}|${oppField}|${botLP}|${oppLP}|${botHandLen}|${botSTLen}`;
  }

  /**
   * Avalia um estado usando evaluateBoardV2 ou fallback.
   */
  function evaluateState(
    state: AIState,
    perspectivePlayer: SimulatedPlayerState,
  ): number {
    if (useV2Evaluation && typeof strategy.evaluateBoardV2 === "function") {
      return strategy.evaluateBoardV2(state, perspectivePlayer);
    }
    // Fallback para evaluateBoard antiga
    return strategy.evaluateBoard(state, perspectivePlayer);
  }

  /**
   * Clona estado do jogo (shallow, mas funcional para simulação).
   */
  function cloneGameState(gameState: AIState): BeamPerspectiveGameState {
    const clonePlayer = (
      p: SearchPlayerInput | null | undefined,
    ): SimulatedPlayerState => {
      const safe = p || {};
      return {
        id: safe.id || "unknown",
        lp: safe.lp || 0,
        hand: (safe.hand || []).map(cloneCardForSim),
        field: (safe.field || []).map(cloneCardForSim),
        graveyard: (safe.graveyard || []).map(cloneCardForSim),
        deck: (safe.deck || []).map(cloneCardForSim),
        extraDeck: (safe.extraDeck || []).map(cloneCardForSim),
        banished: (safe.banished || []).map(cloneCardForSim),
        fieldSpell: safe.fieldSpell ? cloneCardForSim(safe.fieldSpell) : null,
        spellTrap: safe.spellTrap
          ? safe.spellTrap.map(cloneCardForSim)
          : [],
        summonCount: safe.summonCount || 0,
        additionalNormalSummons: safe.additionalNormalSummons || 0,
        additionalNormalSummonPermissions:
          (safe.additionalNormalSummonPermissions || []) as SimulatedPlayerState["additionalNormalSummonPermissions"],
        normalSummonsThisTurn: (safe.normalSummonsThisTurn || []) as SimulatedPlayerState["normalSummonsThisTurn"],
        specialSummonRestrictions: (safe.specialSummonRestrictions || []) as SimulatedPlayerState["specialSummonRestrictions"],
        effectActivationRestrictions: (safe.effectActivationRestrictions || []) as SimulatedPlayerState["effectActivationRestrictions"],
        controllerType: safe.controllerType,
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
    } as BeamPerspectiveGameState;
  }

  /**
   * Simula uma ação no estado clonado.
   */
  function simulateAction(
    state: BeamPerspectiveGameState,
    action: AIAction,
  ): BeamPerspectiveGameState {
    if (typeof strategy.simulateMainPhaseAction === "function") {
      strategy.simulateMainPhaseAction(state, action);
    }
    return state;
  }

  /**
   * Verifica se uma ação muda o estado de forma significativa.
   */
  function actionChangesState(stateBefore: AIState, stateAfter: AIState): boolean {
    const hashBefore = getStateHash(stateBefore);
    const hashAfter = getStateHash(stateAfter);
    return hashBefore !== hashAfter;
  }

  /**
   * Recursive beam search.
   */
  interface BeamBranch {
    action?: AIAction;
    sequence: AIAction[];
    score: number;
    finalState: BeamPerspectiveGameState;
  }

  async function search(
    currentState: BeamPerspectiveGameState,
    depth: number,
    currentSequence: AIAction[] = [],
  ): Promise<BeamBranch> {
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
    candidates = filterAiActionsForCurrentPhase(candidates, {
      state: currentState,
      game: currentState,
      bot: currentState?.bot,
      player: currentState?.bot,
      strategy,
      analysis: {
        phase: currentState?.phase,
        turnCounter: currentState?.turnCounter,
      },
    });
    if (!candidates || candidates.length === 0) {
      const score = evaluateState(currentState, currentState.bot);
      return { sequence: currentSequence, score, finalState: currentState };
    }

    // Limitar ao beam width
    // MELHORIA: No primeiro ply (depth=0), explorar mais candidatos para melhor seleção inicial
    const effectiveBeamWidth =
      depth === 0 ? Math.min(beamWidth + 1, candidates.length) : beamWidth;
    const topCandidates = candidates.slice(0, effectiveBeamWidth);
    const branches: BeamBranch[] = [];

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
 * @param {object} game
 * @param {object} strategy
 * @param {object} options
 * @param {Array} options.preGeneratedActions - Ações pré-geradas como fallback
 * @returns {object|null}
 */
export async function greedySearchWithEvalV2(
  game: AIState,
  strategy: SearchStrategyInput,
  options: BeamSearchOptions = {},
): Promise<GreedySearchResult | null> {
  const { useV2Evaluation = true, preGeneratedActions = null } = options;
  const perspectiveBot = strategy?.bot || (strategy?.id ? strategy : null);
  const resolveOpponent = (state: AIState): SimulatedPlayerState | null => {
    return resolvePerspectivePlayers(state, perspectiveBot || state?.bot)
      .opponent;
  };

  function evaluateState(
    state: AIState,
    perspectivePlayer: SimulatedPlayerState,
  ): number {
    if (useV2Evaluation && typeof strategy.evaluateBoardV2 === "function") {
      return strategy.evaluateBoardV2(state, perspectivePlayer);
    }
    return strategy.evaluateBoard(state, perspectivePlayer);
  }

  function cloneGameState(gameState: AIState): BeamPerspectiveGameState {
    const clonePlayer = (
      p: SearchPlayerInput | null | undefined,
    ): SimulatedPlayerState => {
      const safe = p || {};
      return {
        id: safe.id || "unknown",
        lp: safe.lp || 0,
        hand: (safe.hand || []).map(cloneCardForSim),
        field: (safe.field || []).map(cloneCardForSim),
        graveyard: (safe.graveyard || []).map(cloneCardForSim),
        deck: (safe.deck || []).map(cloneCardForSim),
        extraDeck: (safe.extraDeck || []).map(cloneCardForSim),
        banished: (safe.banished || []).map(cloneCardForSim),
        fieldSpell: safe.fieldSpell ? cloneCardForSim(safe.fieldSpell) : null,
        spellTrap: safe.spellTrap
          ? safe.spellTrap.map(cloneCardForSim)
          : [],
        summonCount: safe.summonCount || 0,
        additionalNormalSummons: safe.additionalNormalSummons || 0,
        additionalNormalSummonPermissions:
          (safe.additionalNormalSummonPermissions || []) as SimulatedPlayerState["additionalNormalSummonPermissions"],
        normalSummonsThisTurn: (safe.normalSummonsThisTurn || []) as SimulatedPlayerState["normalSummonsThisTurn"],
        specialSummonRestrictions: (safe.specialSummonRestrictions || []) as SimulatedPlayerState["specialSummonRestrictions"],
        effectActivationRestrictions: (safe.effectActivationRestrictions || []) as SimulatedPlayerState["effectActivationRestrictions"],
        controllerType: safe.controllerType,
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
      _gameRef: gameState._gameRef || gameState,
    } as BeamPerspectiveGameState;
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
  candidates = filterAiActionsForCurrentPhase(candidates, {
    game,
    bot: perspectiveBot || game?.bot,
    player: perspectiveBot || game?.bot,
    strategy,
    analysis: {
      phase: game?.phase,
      turnCounter: game?.turnCounter,
    },
  });
  if (!candidates.length) {
    return null;
  }

  const baseScore = evaluateState(game, (perspectiveBot || strategy.bot) as SimulatedPlayerState);
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
