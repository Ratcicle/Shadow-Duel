// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/ChainAwareness.js
// Sistema genérico de chain awareness — detecta bloqueios potenciais, spell speed,
// defensive traps, e cadeias que podem ser negadas.
// ─────────────────────────────────────────────────────────────────────────────

import { getEffectSpellSpeed } from "../chain/spellSpeed.js";
import {
  buildActivationQuery,
  createSimulationLegalityAdapter,
  listLegalActivationCandidates,
} from "../chain/legality.js";
import { walkActionList } from "../actionHandlers/actionWalker.js";
import type { CardAction } from "../contracts/actions.js";
import type {
  ChainActivationCandidate,
  ChainCard,
  ChainEffect,
  ChainPlayer,
  FastEffectContextInput,
} from "../contracts/chainRuntime.js";
import type { ActivationSimulationState } from "../chain/legality.js";
import type { AiPlayerInput } from "../contracts/aiState.js";
interface AwarenessCard {
  name?: string | null;
  cardKind?: string | null;
  subtype?: string | null;
  effects?: readonly ChainEffect[];
  spellSpeed?: number;
}
type AwarenessPlayer = AiPlayerInput | ChainPlayer;
type SafetyRecommendation = "safe" | "caution" | "risky" | "very_risky";

type BlockingCategory = "activation" | "attack" | "damage" | "summon";
type TrapStrength = "weak" | "medium" | "strong";
type BlockingRiskLevel = "low" | "medium" | "high";

interface ActionTypeView {
  readonly type?: unknown;
}

export interface DefensiveTrapAnalysis {
  isDefensiveTrap: boolean;
  blocking: BlockingCategory[];
  strength: TrapStrength;
}

export interface BlockingCardSummary {
  name: string | null | undefined;
  strength: TrapStrength;
  blocking: BlockingCategory[];
}

export interface ActionBlockingRisk {
  riskLevel: BlockingRiskLevel;
  blockingCards: BlockingCardSummary[];
  negationChance: number;
}

interface AiChainPort {
  getActivatableCardsInChain?(
    player: ChainPlayer,
    context: FastEffectContextInput,
  ): ChainActivationCandidate[];
}

interface ChainActivationCandidateView {
  candidateKey: string;
  effectId: string | null;
  card: ChainCard;
  effect: ChainEffect;
  spellSpeed: number;
}

export interface ChainAwarenessState extends Omit<ActivationSimulationState, "player" | "bot"> {
  player?: AwarenessPlayer | null;
  bot?: AwarenessPlayer | null;
  chainContext?: FastEffectContextInput;
  context?: FastEffectContextInput;
  chainSystem?: AiChainPort;
}

export interface ChainableCardSummary {
  candidateKey: string;
  effectId: string | null;
  name: string | null;
  type: string;
  chainType: "fast_effect" | "spell_speed_2" | "spell_speed_1" | "none";
  spellSpeed: number;
  blocking: BlockingCategory[];
}

export interface ChainableCardsAnalysis {
  canChain: boolean;
  chainableCards: ChainableCardSummary[];
  chainDepth: number;
}

const ACTIVATION_NEGATION_ACTIONS = new Set([
  "negate_activation",
  "negate_effect",
  "negate_summon_or_activation_and_destroy",
]);
const ATTACK_BLOCKING_ACTIONS = new Set([
  "negate_attack",
  "mirror_force_destroy_all",
  "negate_opponent_battle_destruction_prevention",
]);
const DAMAGE_BLOCKING_ACTIONS = new Set([
  "prevent_damage",
  "prevent_battle_damage",
  "reduce_damage",
]);

function walkedActions(actions: readonly CardAction[] | undefined): ActionTypeView[] {
  return walkActionList(actions).visits
    .map((visit) => visit.action)
    .filter((action) => action && typeof action === "object") as ActionTypeView[];
}

function responseBlockingCategories(effect: ChainEffect): BlockingCategory[] {
  const actionTypes = new Set(
    walkedActions(effect?.actions).map((action) => action.type) as string[],
  );
  const contexts = new Set(effect?.canRespondTo || []);
  const blocking = new Set<BlockingCategory>();
  if ([...ACTIVATION_NEGATION_ACTIONS].some((type) => actionTypes.has(type))) {
    blocking.add("activation");
  }
  if ([...ATTACK_BLOCKING_ACTIONS].some((type) => actionTypes.has(type))) {
    blocking.add("attack");
  }
  if ([...DAMAGE_BLOCKING_ACTIONS].some((type) => actionTypes.has(type))) {
    blocking.add("damage");
  }
  if (contexts.has("attack_declaration")) blocking.add("attack");
  if (contexts.has("summon_attempt")) blocking.add("summon");
  return [...blocking];
}

/**
 * Analisa spell speed e cadeia de um efeito.
 * @param {object} effect - Efeito a analisar
 * @returns {object} - { spellSpeed: number, canChain: boolean, chainType: 'fast_effect'|'spell_speed_2'|'spell_speed_1'|'none' }
 */
export function analyzeSpellSpeed(
  effect: ChainEffect | null | undefined,
  card: AwarenessCard | null = null,
): {
  spellSpeed: number;
  canChain: boolean;
  chainType: "fast_effect" | "spell_speed_2" | "spell_speed_1" | "none";
} {
  if (!effect) {
    return { spellSpeed: 1, canChain: false, chainType: "none" };
  }

  const spellSpeed = getEffectSpellSpeed(effect, card as ChainCard | undefined);

  let canChain = false;
  let chainType: "fast_effect" | "spell_speed_2" | "spell_speed_1" | "none" =
    "spell_speed_1";

  if (spellSpeed >= 3) {
    canChain = true;
    chainType = "fast_effect";
  } else if (spellSpeed === 2) {
    canChain = true;
    chainType = "spell_speed_2";
  }

  return { spellSpeed, canChain, chainType };
}

/**
 * Detecta se uma carta é uma "defensive trap" — que pode bloquear ações.
 * @param {object} card - Carta a analisar
 * @returns {object} - { isDefensiveTrap: boolean, blocking: string[], strength: 'weak'|'medium'|'strong' }
 */
export function analyzeDefensiveTrap(
  card: AwarenessCard | null | undefined,
): DefensiveTrapAnalysis {
  if (!card || card.cardKind !== "trap") {
    return { isDefensiveTrap: false, blocking: [], strength: "weak" };
  }

  const blocking = [
    ...new Set(
      (card.effects || []).flatMap((effect) =>
        responseBlockingCategories(effect),
      ),
    ),
  ];
  const hasCounterSpeed = (card.effects || []).some(
    (effect) => getEffectSpellSpeed(effect, card as ChainCard) >= 3,
  );
  const hasNegation = (card.effects || []).some((effect) =>
    walkedActions(effect.actions).some((action) =>
      ACTIVATION_NEGATION_ACTIONS.has(action.type as string)
    ),
  );
  const strength =
    hasCounterSpeed || hasNegation
      ? "strong"
      : blocking.length > 0
        ? "medium"
        : "weak";

  // Detecta padrões em descrição
  return {
    isDefensiveTrap: blocking.length > 0,
    blocking,
    strength,
  };
}

/**
 * Avalia risco de uma ação ser bloqueada por traps do oponente.
 * @param {object} gameState - Estado do jogo
 * @param {object} botPlayer - Bot player state
 * @param {object} opponentPlayer - Opponent player state
 * @param {string} actionType - Tipo de ação que será feita (spell, summon, attack)
 * @returns {object} - { riskLevel: 'low'|'medium'|'high', blockingCards: [], negationChance: 0.0-1.0 }
 */
export function evaluateActionBlockingRisk(
  gameState: ChainAwarenessState,
  botPlayer: AwarenessPlayer,
  opponentPlayer: AwarenessPlayer | null | undefined,
  actionType: string,
): ActionBlockingRisk {
  if (!opponentPlayer || !opponentPlayer.spellTrap) {
    return { riskLevel: "low", blockingCards: [], negationChance: 0.0 };
  }

  const blockingCards: BlockingCardSummary[] = [];
  const oppSpellTraps = opponentPlayer.spellTrap || [];

  for (const card of oppSpellTraps) {
    if (!card) continue;

    const trap = analyzeDefensiveTrap(card);
    if (
      trap.isDefensiveTrap &&
      trap.blocking.includes(actionType as BlockingCategory)
    ) {
      blockingCards.push({
        name: card.name,
        strength: trap.strength,
        blocking: trap.blocking,
      });
    }
  }

  let riskLevel: BlockingRiskLevel = "low";
  let negationChance = 0.0;

  if (blockingCards.length === 0) {
    riskLevel = "low";
    negationChance = 0.0;
  } else if (blockingCards.length === 1) {
    const strength = blockingCards[0].strength;
    if (strength === "strong") {
      riskLevel = "high";
      negationChance = 0.7;
    } else if (strength === "medium") {
      riskLevel = "medium";
      negationChance = 0.4;
    } else {
      riskLevel = "low";
      negationChance = 0.2;
    }
  } else {
    // Múltiplas traps = alto risco
    riskLevel = "high";
    negationChance = Math.min(0.9, blockingCards.length * 0.3);
  }

  return { riskLevel, blockingCards, negationChance };
}

/**
 * Detecta se oponente pode entrar em cadeia (chain window aberto).
 * @param {object} gameState - Estado do jogo
 * @param {object} opponentPlayer - Opponent player state
 * @returns {object} - { canChain: boolean, chainableCards: [], chainDepth: number }
 */
export function detectChainableOpponentCards(
  gameState: ChainAwarenessState,
  opponentPlayer: AwarenessPlayer | null | undefined,
): ChainableCardsAnalysis {
  if (!opponentPlayer) {
    return { canChain: false, chainableCards: [], chainDepth: 0 };
  }

  const context = gameState?.chainContext || gameState?.context || {
    type: "effect_activation",
  };
  let legalCandidates: readonly ChainActivationCandidateView[] = [];
  if (typeof gameState?.chainSystem?.getActivatableCardsInChain === "function") {
    legalCandidates = gameState.chainSystem.getActivatableCardsInChain(
      opponentPlayer as ChainPlayer,
      context,
    );
  } else {
    const query = buildActivationQuery({
      state: gameState as ActivationSimulationState,
      player: opponentPlayer as ChainPlayer,
      context,
    });
    legalCandidates = listLegalActivationCandidates(
      query,
      createSimulationLegalityAdapter(gameState as ActivationSimulationState, {
        effectCheck: ({ card, effect }) => {
          const spellSpeed = getEffectSpellSpeed(effect, card);
          const responseContexts = Array.isArray(effect.canRespondTo)
            ? effect.canRespondTo
            : [];
          return (
            spellSpeed >= 2 &&
            (responseContexts.length === 0 ||
              responseContexts.includes(context.type))
          );
        },
      }),
    );
  }
  const canonicalCards = legalCandidates.map((candidate) => ({
    candidateKey: candidate.candidateKey,
    effectId: candidate.effectId,
    name: candidate.card?.name || null,
    type:
      candidate.card?.cardKind === "spell"
        ? "quick_play"
        : candidate.card?.cardKind || "effect",
    chainType: analyzeSpellSpeed(candidate.effect, candidate.card).chainType,
    spellSpeed: candidate.spellSpeed,
    blocking: responseBlockingCategories(candidate.effect),
  }));
  return {
    canChain: canonicalCards.length > 0,
    chainableCards: canonicalCards,
    chainDepth: Math.min(3, canonicalCards.length),
  };
}

/**
 * Calcula penalidade de prioridade para uma ação que pode ser bloqueada.
 * @param {string} actionType - Tipo de ação
 * @param {object} blockingRisk - Resultado de evaluateActionBlockingRisk
 * @returns {number} - Penalidade de prioridade (negativa, 0 a -30)
 */
export function calculateBlockingRiskPenalty(
  actionType: string,
  blockingRisk: ActionBlockingRisk,
): number {
  const { riskLevel, negationChance } = blockingRisk;

  let basePenalty = 0;

  if (riskLevel === "high") {
    basePenalty = -20;
  } else if (riskLevel === "medium") {
    basePenalty = -10;
  }

  // Ajustar por chance de negação
  const chancePenalty = negationChance * -15;

  return Math.round(basePenalty + chancePenalty);
}

/**
 * Determina segurança total de executar uma ação considerando cadeia/traps oponente.
 * @param {object} gameState - Estado do jogo
 * @param {object} botPlayer - Bot player state
 * @param {object} opponentPlayer - Opponent player state
 * @param {string} actionType - Tipo de ação
 * @param {object} card - Carta da ação
 * @returns {object} - { isSafe: boolean, riskScore: 0.0-1.0, recommendation: string }
 */
export function assessActionSafety(
  gameState: ChainAwarenessState,
  botPlayer: AwarenessPlayer,
  opponentPlayer: AwarenessPlayer | null | undefined,
  actionType: string,
  card: AwarenessCard,
): { isSafe: boolean; riskScore: number; recommendation: SafetyRecommendation } {
  const blockingRisk = evaluateActionBlockingRisk(
    gameState,
    botPlayer,
    opponentPlayer,
    actionType
  );

  const chainable = detectChainableOpponentCards(gameState, opponentPlayer);

  let riskScore = blockingRisk.negationChance * 0.7;

  if (chainable.canChain && actionType === "spell") {
    riskScore += chainable.chainDepth * 0.05;
  }

  riskScore = Math.min(1.0, riskScore);

  const isSafe = riskScore < 0.4;

  let recommendation: SafetyRecommendation = "safe";
  if (riskScore >= 0.7) {
    recommendation = "very_risky";
  } else if (riskScore >= 0.5) {
    recommendation = "risky";
  } else if (riskScore >= 0.3) {
    recommendation = "caution";
  }

  return { isSafe, riskScore, recommendation };
}
