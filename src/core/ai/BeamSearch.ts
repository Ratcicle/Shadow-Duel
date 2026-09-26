// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/BeamSearch.js
import { createPlanningCopy } from "./common/planningCopy.js";
import { resolvePerspectivePlayers } from "./StrategyUtils.js";
import { filterAiActionsForCurrentPhase } from "./common/phaseTiming.js";
import {
  fingerprintPlanningState, PLANNING_PLAYER_FIELDS, PLANNING_STATE_FIELDS,
} from "./common/stateFingerprint.js";
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
  CardKind,
  CardTurnBasedBuff,
  GameCard,
} from "../contracts/cards.js";

type SearchStrategyInput = SearchStrategyPort & Partial<AIStrategyBotPort>;
type SearchCardInput = (AiCardInput | GameCard | SimulatedCardState) & {
  archetypes?: readonly string[] | undefined;
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
    actionType === "handSummonProcedure" ||
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
    actionType === "handSummonProcedure" ||
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
    const { cloneCardForSim, copyFields } = createPlanningCopy();
    const clonePlayer = (
      p: SearchPlayerInput | null | undefined,
    ): SimulatedPlayerState => {
      const safe = p || {};
      const clone = {
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
          (safe.additionalNormalSummonPermissions || []) as NonNullable<SimulatedPlayerState["additionalNormalSummonPermissions"]>,
        normalSummonsThisTurn: (safe.normalSummonsThisTurn || []) as NonNullable<SimulatedPlayerState["normalSummonsThisTurn"]>,
        specialSummonRestrictions: (safe.specialSummonRestrictions || []) as NonNullable<SimulatedPlayerState["specialSummonRestrictions"]>,
        effectActivationRestrictions: (safe.effectActivationRestrictions || []) as NonNullable<SimulatedPlayerState["effectActivationRestrictions"]>,
        controllerType: safe.controllerType,
      };
      copyFields(safe, clone, PLANNING_PLAYER_FIELDS);
      return clone;
    };

    const isPerspectiveState = gameState && gameState._isPerspectiveState;
    const sourceBot = isPerspectiveState
      ? gameState.bot
      : perspectiveBot || gameState.bot || gameState.player;
    const sourcePlayer = isPerspectiveState
      ? gameState.player
      : resolveOpponent(gameState) || gameState.player || gameState.bot;

    const clone = {
      player: clonePlayer(sourcePlayer),
      bot: clonePlayer(sourceBot),
      turn: gameState.turn,
      phase: gameState.phase,
      turnCounter: gameState.turnCounter || 0,
      _isPerspectiveState: true,
      _gameRef: gameState._gameRef || gameState, // Referência ao game original
    } as BeamPerspectiveGameState;
    copyFields(gameState, clone, PLANNING_STATE_FIELDS.filter(key => key !== "_isPerspectiveState"));
    copyFields(gameState, clone, ["_simLuminarch"]);
    return clone;
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
      const stateBeforeAction = fingerprintPlanningState(newState);

      simulateAction(newState, action);
      nodesEvaluated++;

      // Trava 3: Anti-repetição
      const stateAfterAction = fingerprintPlanningState(newState);
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
      const firstCandidate = topCandidates[0];
      if (firstCandidate && currentSequence.length === 0) {
        return {
          sequence: [firstCandidate],
          score,
          finalState: currentState,
        };
      }
      return { sequence: currentSequence, score, finalState: currentState };
    }

    // Retornar melhor branch
    branches.sort((a, b) => b.score - a.score);
    const bestBranch = branches[0];
    if (!bestBranch) {
      return { sequence: currentSequence, score: evaluateState(currentState, currentState.bot), finalState: currentState };
    }
    return bestBranch;
  }

  // Início da busca
  const initialState = cloneGameState(game);
  const baseScore = evaluateState(initialState, initialState.bot);
  seenStates.add(fingerprintPlanningState(initialState));

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
    const fallbackAction = fallbackCandidates[0];
    if (fallbackAction) {
      return {
        action: fallbackAction,
        score: baseScore,
        sequence: [fallbackAction],
        nodesEvaluated,
      };
    }
    return null;
  }

  // BUGFIX: Sempre retornar melhor ação encontrada, mesmo se score não melhorou muito
  // Isso evita bots ficarem presos sem ação quando BeamSearch explora mas não encontra melhoria significativa
  if (!result.sequence[0]) return null;
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
    const { cloneCardForSim, copyFields } = createPlanningCopy();
    const clonePlayer = (
      p: SearchPlayerInput | null | undefined,
    ): SimulatedPlayerState => {
      const safe = p || {};
      const clone = {
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
          (safe.additionalNormalSummonPermissions || []) as NonNullable<SimulatedPlayerState["additionalNormalSummonPermissions"]>,
        normalSummonsThisTurn: (safe.normalSummonsThisTurn || []) as NonNullable<SimulatedPlayerState["normalSummonsThisTurn"]>,
        specialSummonRestrictions: (safe.specialSummonRestrictions || []) as NonNullable<SimulatedPlayerState["specialSummonRestrictions"]>,
        effectActivationRestrictions: (safe.effectActivationRestrictions || []) as NonNullable<SimulatedPlayerState["effectActivationRestrictions"]>,
        controllerType: safe.controllerType,
      };
      copyFields(safe, clone, PLANNING_PLAYER_FIELDS);
      return clone;
    };

    const isPerspectiveState = gameState && gameState._isPerspectiveState;
    const sourceBot = isPerspectiveState
      ? gameState.bot
      : perspectiveBot || gameState.bot || gameState.player;
    const sourcePlayer = isPerspectiveState
      ? gameState.player
      : resolveOpponent(gameState) || gameState.player || gameState.bot;

    const clone = {
      player: clonePlayer(sourcePlayer),
      bot: clonePlayer(sourceBot),
      turn: gameState.turn,
      phase: gameState.phase,
      turnCounter: gameState.turnCounter || 0,
      _isPerspectiveState: true,
      _gameRef: gameState._gameRef || gameState,
    } as BeamPerspectiveGameState;
    copyFields(gameState, clone, PLANNING_STATE_FIELDS.filter(key => key !== "_isPerspectiveState"));
    copyFields(gameState, clone, ["_simLuminarch"]);
    return clone;
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
  if (!bestAction) return null;
  return {
    action: bestAction,
    score: bestScore,
    sequence: [bestAction],
  };
}
