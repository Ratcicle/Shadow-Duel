import { resolvePerspectivePlayers } from "./StrategyUtils.js";
import { createGameTreeCopy, withoutLiveGameReference } from "./common/gameTreeSimulation.js";
import { fingerprintPlanningState } from "./common/stateFingerprint.js";
import type {
  AIAction,
  GameTreeSearchResult,
} from "../contracts/ai.js";
import type {
  AiPlayerInput,
  AiStateInput,
  GameTreeSimulationGameState,
  SimulationGameState,
  PerspectiveGameState,
  SimulatedPlayerState,
} from "../contracts/aiState.js";
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
const TRANSPOSITION_MAX_SIZE = 2000; // Aumentado de 1000
const ALPHA_INIT = -Infinity;
const BETA_INIT = Infinity;
const FUTURE_DISCOUNT = 0.85; // Desconto por ply: score_ply_n = score * (0.85 ^ n)

type GameTreePlayerInput = (AiPlayerInput | SimulatedPlayerState) & { debug?: boolean };
interface GameTreeStateInput extends AiStateInput {
  currentPlayer?: GameTreePlayerInput | null;
  opponent?: GameTreePlayerInput | null;
}
type GameTreeState = GameTreeSimulationGameState;

interface GameTreeStrategy<State, Action extends AIAction> {
  bot?: { debug?: boolean } | undefined;
  generateMainPhaseActions(state: State): Action[];
  simulateMainPhaseAction(state: GameTreeState, action: Action): GameTreeState | SimulationGameState | PerspectiveGameState | void;
}

interface MinimaxResult<Action extends AIAction> {
  value: number;
  action: Action | null;
}

interface TranspositionEntry<Action extends AIAction> {
  result: MinimaxResult<Action>;
  depth: number;
}

function transpositionKey(
  projection: GameTreeState,
  perspective: GameTreePlayerInput | null | undefined,
  depth: number,
  isMaximizing: boolean,
  alpha: number,
  beta: number,
): string | null {
  try {
    // A cutoff result is reusable only for this exact entry window/horizon.
    // Keep search context outside the shared game-state fingerprint.
    return JSON.stringify({
      state: fingerprintPlanningState(projection),
      perspective: perspective?.id ?? null,
      depth,
      isMaximizing,
      alpha: windowBound(alpha),
      beta: windowBound(beta),
    });
  } catch {
    // An unrepresentable node may still be searchable. Never give unrelated
    // failures a shared key, nor introduce randomness into cache identity.
    return null;
  }
}

function windowBound(value: number): number | string {
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  if (Number.isNaN(value)) return "NaN";
  return Object.is(value, -0) ? "-0" : value;
}

function cloneGameStateDeep(gameState: GameTreeStateInput | GameTreeState, perspective: GameTreePlayerInput | null = null): GameTreeState {
  return createGameTreeCopy(gameState, perspective || gameState.bot).state;
}

/**
 * Avalia um estado de jogo (folha do minimax)
 * Retorna score numérico (higher = melhor para maximizer)
 */
function shouldLogWarnings(
  gameState: GameTreeStateInput | GameTreeState,
  perspective: GameTreePlayerInput | null | undefined,
): boolean {
  if (perspective && perspective.debug === false) return false;
  if (gameState?.bot && (gameState.bot as GameTreePlayerInput).debug === false) return false;
  if (gameState?.player && (gameState.player as GameTreePlayerInput).debug === false) return false;
  return true;
}

function evaluateLeafState(
  gameState: GameTreeStateInput | GameTreeState,
  perspective: GameTreePlayerInput | null | undefined,
  maxScore = 100,
): number {
  try {
    if (!gameState || typeof gameState !== "object") return 0;
    const { self: persp, opponent: opp } = resolvePerspectivePlayers(
      gameState as Parameters<typeof resolvePerspectivePlayers>[0],
      perspective || gameState.bot,
    );

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

/** Execute exactly once on an isolated graph; unchanged actions are legal no-ops. */
function simulateAction<State extends GameTreeStateInput, Action extends AIAction>(
  gameState: GameTreeState, action: Action, strategy: GameTreeStrategy<State, Action>,
): GameTreeState {
  const copy = createGameTreeCopy(gameState, gameState.bot);
  // The same graph memo rebinds card references inside action preferences.
  const branchAction = copy.copyAction(action) as Action;
  const returned = withoutLiveGameReference(copy.state, () =>
    strategy.simulateMainPhaseAction(copy.state, branchAction));
  const result = returned || copy.state;
  result._isPerspectiveState = true;
  return result as GameTreeState;
}

/**
 * Gera ações candidatas para simulação no minimax
 * Nota: usar estratégia existente generateMainPhaseActions()
 */
function generateCandidateActions<State extends GameTreeStateInput, Action extends AIAction>(
  stateForActions: GameTreeState | null,
  strategy: GameTreeStrategy<State, Action>,
): Action[] {
  try {
    if (!stateForActions) return [];
    // Retorna top 2-3 ações por scoring (beam width)
    const allActions = withoutLiveGameReference(stateForActions, () =>
      strategy.generateMainPhaseActions(stateForActions as State & GameTreeState));
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
function minimax<State extends GameTreeStateInput, Action extends AIAction>(
  gameState: GameTreeStateInput | GameTreeState,
  depth: number,
  isMaximizing: boolean,
  alpha: number,
  beta: number,
  strategy: GameTreeStrategy<State, Action>,
  perspective: GameTreePlayerInput | null | undefined,
  transpositions: Map<string, TranspositionEntry<Action>> = new Map(),
): MinimaxResult<Action> {
  // Base case: folha ou limite de profundidade
  if (depth === 0) {
    const leafValue = evaluateLeafState(gameState, perspective);
    return { value: leafValue, action: null };
  }

  const { self: persp } = resolvePerspectivePlayers(
    gameState as Parameters<typeof resolvePerspectivePlayers>[0],
    perspective || gameState.bot,
  );
  // Reuse the existing candidate-generation clone for identity as well. Root
  // and descendants therefore share the GameTree projection, without another
  // deep copy, live-state reads, or changing the state used by simulation/leaves.
  let stateForActions: GameTreeState | null = null;
  try {
    if (gameState && typeof gameState === "object") {
      stateForActions = cloneGameStateDeep(gameState, persp);
    }
  } catch {
    // Preserve generation's existing failure path: no actions, then evaluate.
  }
  const stateKey = stateForActions
    ? transpositionKey(stateForActions, persp, depth, isMaximizing, alpha, beta)
    : null;
  if (stateKey !== null) {
    const cached = transpositions.get(stateKey);
    if (cached) return cached.result;
  }
  const actions = generateCandidateActions(stateForActions, strategy);

  let bestValue = isMaximizing ? -Infinity : Infinity;
  let bestAction: Action | null = actions[0] ?? null;

  if (!stateForActions || actions.length === 0) {
    // Sem ações: avaliar estado atual
    const leafValue = evaluateLeafState(gameState, perspective);
    return { value: leafValue, action: null };
  }

  for (const action of actions) {
    const nextState = simulateAction(stateForActions, action, strategy);

    // Recursão com troca de perspectiva
    const nextPerspective = nextState.player;
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
  if (stateKey !== null && transpositions.size < TRANSPOSITION_MAX_SIZE) {
    transpositions.set(stateKey, {
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
export function gameTreeSearch<
  State extends GameTreeStateInput,
  Action extends AIAction,
>(
  gameState: State,
  strategy: GameTreeStrategy<State, Action>,
  perspective: GameTreePlayerInput | null = null,
  maxPly = DEFAULT_MAX_PLY,
): Omit<GameTreeSearchResult, "action"> & { action: Action | null } {
  try {
    const transpositions = new Map<string, TranspositionEntry<Action>>();
    const { self: persp } = resolvePerspectivePlayers(
      gameState,
      perspective || gameState.bot,
    );

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
      error: (e as Error).message,
    };
  }
}

/**
 * API para análise crítica: avalia se situação é "lethal checkable" ou "defense critical"
 * Retorna true se vale a pena rodar minimax pesado
 */
export function shouldUseGameTreeSearch(
  gameState: GameTreeStateInput,
  perspective: GameTreePlayerInput | null | undefined,
  forceCritical = false,
): boolean {
  try {
    // Debug: permitir forçar via flag
    if (forceCritical) return true;

    const { self: persp, opponent: opp } = resolvePerspectivePlayers(
      gameState,
      perspective || gameState.bot,
    );

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
export function estimateSearchComplexity(maxPly: number, beamWidth = 3): number {
  let nodes = 1;
  for (let i = 0; i < maxPly; i++) {
    nodes *= beamWidth;
  }
  return nodes;
}
