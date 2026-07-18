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

function flattenActions(actions = []) {
  const result = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    if (!action || typeof action !== "object") continue;
    result.push(action);
    for (const key of ["actions", "thenActions", "elseActions"]) {
      result.push(...flattenActions(action[key]));
    }
    for (const option of Array.isArray(action.cases) ? action.cases : []) {
      result.push(...flattenActions(option?.actions));
    }
  }
  return result;
}

function responseBlockingCategories(effect) {
  const actionTypes = new Set(
    flattenActions(effect?.actions).map((action) => action.type),
  );
  const contexts = new Set(effect?.canRespondTo || []);
  const blocking = new Set();
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
 * @param {Object} effect - Efeito a analisar
 * @returns {Object} - { spellSpeed: number, canChain: boolean, chainType: 'fast_effect'|'spell_speed_2'|'spell_speed_1'|'none' }
 */
export function analyzeSpellSpeed(effect, card = null) {
  if (!effect) {
    return { spellSpeed: 1, canChain: false, chainType: "none" };
  }

  const spellSpeed = getEffectSpellSpeed(effect, card);

  let canChain = false;
  let chainType = "spell_speed_1";

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
 * @param {Object} card - Carta a analisar
 * @returns {Object} - { isDefensiveTrap: boolean, blocking: string[], strength: 'weak'|'medium'|'strong' }
 */
export function analyzeDefensiveTrap(card) {
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
    (effect) => getEffectSpellSpeed(effect, card) >= 3,
  );
  const hasNegation = (card.effects || []).some((effect) =>
    flattenActions(effect.actions).some((action) =>
      ACTIVATION_NEGATION_ACTIONS.has(action.type),
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
 * @param {Object} gameState - Estado do jogo
 * @param {Object} botPlayer - Bot player state
 * @param {Object} opponentPlayer - Opponent player state
 * @param {string} actionType - Tipo de ação que será feita (spell, summon, attack)
 * @returns {Object} - { riskLevel: 'low'|'medium'|'high', blockingCards: [], negationChance: 0.0-1.0 }
 */
export function evaluateActionBlockingRisk(
  gameState,
  botPlayer,
  opponentPlayer,
  actionType
) {
  if (!opponentPlayer || !opponentPlayer.spellTrap) {
    return { riskLevel: "low", blockingCards: [], negationChance: 0.0 };
  }

  const blockingCards = [];
  const oppSpellTraps = opponentPlayer.spellTrap || [];

  for (const card of oppSpellTraps) {
    if (!card) continue;

    const trap = analyzeDefensiveTrap(card);
    if (trap.isDefensiveTrap && trap.blocking.includes(actionType)) {
      blockingCards.push({
        name: card.name,
        strength: trap.strength,
        blocking: trap.blocking,
      });
    }
  }

  let riskLevel = "low";
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
 * @param {Object} gameState - Estado do jogo
 * @param {Object} opponentPlayer - Opponent player state
 * @returns {Object} - { canChain: boolean, chainableCards: [], chainDepth: number }
 */
export function detectChainableOpponentCards(gameState, opponentPlayer) {
  if (!opponentPlayer) {
    return { canChain: false, chainableCards: [], chainDepth: 0 };
  }

  const context = gameState?.chainContext || gameState?.context || {
    type: "effect_activation",
  };
  let legalCandidates = [];
  if (typeof gameState?.chainSystem?.getActivatableCardsInChain === "function") {
    legalCandidates = gameState.chainSystem.getActivatableCardsInChain(
      opponentPlayer,
      context,
    );
  } else {
    const query = buildActivationQuery({
      state: gameState,
      player: opponentPlayer,
      context,
    });
    legalCandidates = listLegalActivationCandidates(
      query,
      createSimulationLegalityAdapter(gameState, {
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
 * @param {Object} blockingRisk - Resultado de evaluateActionBlockingRisk
 * @returns {number} - Penalidade de prioridade (negativa, 0 a -30)
 */
export function calculateBlockingRiskPenalty(actionType, blockingRisk) {
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
 * @param {Object} gameState - Estado do jogo
 * @param {Object} botPlayer - Bot player state
 * @param {Object} opponentPlayer - Opponent player state
 * @param {string} actionType - Tipo de ação
 * @param {Object} card - Carta da ação
 * @returns {Object} - { isSafe: boolean, riskScore: 0.0-1.0, recommendation: string }
 */
export function assessActionSafety(
  gameState,
  botPlayer,
  opponentPlayer,
  actionType,
  card
) {
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

  let recommendation = "safe";
  if (riskScore >= 0.7) {
    recommendation = "very_risky";
  } else if (riskScore >= 0.5) {
    recommendation = "risky";
  } else if (riskScore >= 0.3) {
    recommendation = "caution";
  }

  return { isSafe, riskScore, recommendation };
}
