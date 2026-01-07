// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/ThreatEvaluation.js
// Threat scoring system — avalia ameaças contextuais sem hardcoding
// ─────────────────────────────────────────────────────────────────────────────

import {
  inferRole,
  calculateEffectUrgency,
  calculateActionImpact,
  isAdvantageEngine,
} from "./RoleAnalyzer.js";
import { hasArchetype } from "./StrategyUtils.js";

/**
 * Calcula o threat score de uma carta no contexto atual do jogo.
 * @param {Object} card - A carta a avaliar
 * @param {Object} context - Contexto do jogo
 * @param {number} context.myStrongestAtk - ATK do meu monstro mais forte
 * @param {boolean} context.hasDefenses - Tenho monstros em DEF?
 * @param {string} context.myArchetype - Meu arquétipo principal
 * @param {number} context.myLP - Meus LP
 * @param {number} context.oppLP - LP do oponente
 * @returns {number} - Threat score (0.0 a 10.0+)
 */
export function calculateThreatScore(card, context = {}) {
  if (!card) return 0;

  let score = 0;

  // 1. BASE STATS
  const atk =
    (card.atk || 0) + (card.tempAtkBoost || 0) + (card.equipAtkBonus || 0);
  // 🎭 REGRA: Não pode ver DEF real de facedown (usar estimativa)
  const def = card.isFacedown
    ? 1500
    : (card.def || 0) + (card.tempDefBoost || 0) + (card.equipDefBonus || 0);
  const stat = card.position === "defense" ? def : atk;

  score += stat / 1000; // 2000 ATK = +2.0 score
  score += (card.level || 0) * 0.08; // Level 7 = +0.56

  // 2. EFFECT URGENCY
  const effects = Array.isArray(card.effects) ? card.effects : [];
  let maxUrgency = 0;
  let totalImpact = 0;

  for (const effect of effects) {
    const urgency = calculateEffectUrgency(effect);
    if (urgency > maxUrgency) maxUrgency = urgency;

    const actions = Array.isArray(effect.actions) ? effect.actions : [];
    for (const action of actions) {
      totalImpact += calculateActionImpact(action);
    }
  }

  score += maxUrgency * 0.5; // Passive/immediate effects = +0.5
  score += totalImpact; // Draw 2 = +1.0, Destroy = +0.7, etc

  // 3. ROLE-BASED THREAT
  const role = inferRole(card);
  if (isAdvantageEngine(card)) {
    score += 1.0; // Geradores de vantagem = prioridade ALTA
  }
  if (role === "removal") {
    score += 0.8; // Pode remover minhas cartas
  }
  if (role === "disruption") {
    score += 0.6;
  }

  // 4. DEFENSE DIFFICULTY — Posso destruir facilmente?
  const myStrongestAtk = context.myStrongestAtk || 0;
  if (atk > myStrongestAtk) {
    score += 1.2; // Não posso destruir em batalha = mais perigoso
  } else if (atk > myStrongestAtk - 500) {
    score += 0.4; // Quase igual = ainda ameaça
  }

  // 5. COMBAT MECHANICS
  if (card.piercing && context.hasDefenses) {
    score += 0.4; // Ignora minhas defesas
  }
  if (card.mustBeAttacked) {
    score -= 0.5; // Taunt = pode ser contornado (menos perigoso)
  }
  if (card.battleIndestructible || card.tempBattleIndestructible) {
    score += 0.6; // Difícil de remover
  }

  // 6. OFFENSIVE URGENCY — Pode me matar em quantos turnos?
  const myLP = context.myLP || 8000;
  const oppLP = context.oppLP || 8000;

  if (myLP <= 2000 && atk >= myLP) {
    score += 2.0; // LETHAL IMMEDIATE
  } else if (myLP <= 4000 && atk >= myLP / 2) {
    score += 1.0; // Pode me matar em 2 turnos
  }

  // 7. SYNERGY WITH OPPONENT STRATEGY
  if (context.myArchetype && hasArchetype(card, context.myArchetype)) {
    // Se o oponente joga o mesmo arquétipo, há sinergia
    score += 0.3;
  }

  // 8. POSITION VULNERABILITY
  if (card.isFacedown) {
    score *= 0.7; // Desconhecido = incerto, mas potencialmente perigoso
  }
  if (card.position === "defense" && !card.piercing) {
    score *= 0.8; // Em defesa = menos ofensivo
  }

  return score;
}

/**
 * Calcula o threat score de todos os monstros oponentes e retorna ordenado.
 * @param {Object[]} opponentField - Campo do oponente
 * @param {Object} context - Contexto do jogo
 * @returns {Object[]} - Array de { card, threatScore }, ordenado por threat DESC
 */
export function rankOpponentThreats(opponentField, context = {}) {
  if (!Array.isArray(opponentField)) return [];

  const threats = opponentField
    .filter((card) => card && card.cardKind === "monster")
    .map((card) => ({
      card,
      threatScore: calculateThreatScore(card, context),
    }))
    .sort((a, b) => b.threatScore - a.threatScore);

  return threats;
}

/**
 * Identifica a ameaça #1 no campo oponente.
 * @param {Object[]} opponentField
 * @param {Object} context
 * @returns {Object|null} - { card, threatScore } ou null
 */
export function getTopThreat(opponentField, context = {}) {
  const threats = rankOpponentThreats(opponentField, context);
  return threats.length > 0 ? threats[0] : null;
}

/**
 * Calcula o "valor de recurso" de uma carta na mão/campo para AI.
 * Usado para decisões de custo (discard, tribute, etc).
 * @param {Object} card
 * @param {Object} context
 * @returns {number} - Resource value (menor = mais barato de sacrificar)
 */
export function calculateResourceValue(card, context = {}) {
  if (!card) return 0;

  let value = 0;

  // Base stats
  const atk = (card.atk || 0) + (card.tempAtkBoost || 0);
  // 🎭 REGRA: Não pode ver DEF real de facedown
  const def = card.isFacedown ? 1500 : (card.def || 0) + (card.tempDefBoost || 0);
  value += Math.max(atk, def) / 1000;
  value += (card.level || 0) * 0.1;

  // Role importance
  const role = inferRole(card);
  if (isAdvantageEngine(card)) {
    value += 1.2; // Geradores de vantagem = ALTO custo de sacrificar
  }
  if (role === "removal") {
    value += 0.8;
  }
  if (role === "recursion") {
    value += 0.6; // Recursão pode voltar, mas ainda valioso
  }

  // Effect impact
  const effects = Array.isArray(card.effects) ? card.effects : [];
  for (const effect of effects) {
    const actions = Array.isArray(effect.actions) ? effect.actions : [];
    for (const action of actions) {
      value += calculateActionImpact(action) * 0.5;
    }
  }

  // Context: Se vai pro GY e tem efeito de GY, MENOS custo
  const hasGYEffect = effects.some(
    (eff) => eff.timing === "on_event" && eff.event === "card_to_grave"
  );
  if (hasGYEffect && context.isDiscardCost) {
    value -= 0.8; // Descartar Specter = bom (efeito ativa)
  }

  // Vanilla monsters = low value
  if (card.cardKind === "monster" && effects.length === 0) {
    value *= 0.6;
  }

  return value;
}

/**
 * Ordena cartas por resource value (para escolher qual descartar/tributar).
 * @param {Object[]} cards
 * @param {Object} context
 * @param {boolean} ascending - true = menor valor primeiro (descartável), false = maior primeiro
 * @returns {Object[]}
 */
export function rankByResourceValue(cards, context = {}, ascending = true) {
  if (!Array.isArray(cards)) return [];

  const ranked = cards.map((card) => ({
    card,
    resourceValue: calculateResourceValue(card, context),
  }));

  ranked.sort((a, b) => {
    return ascending
      ? a.resourceValue - b.resourceValue
      : b.resourceValue - a.resourceValue;
  });

  return ranked.map((entry) => entry.card);
}

/**
 * Estima quantos turnos um monstro precisa para me matar.
 * @param {Object} card - Monstro oponente
 * @param {number} myLP - Meus LP atuais
 * @returns {number} - Turnos até lethal (Infinity se não pode)
 */
export function estimateTurnsToKill(card, myLP = 8000) {
  if (!card || card.cardKind !== "monster") return Infinity;
  if (card.position !== "attack") return Infinity;

  const atk =
    (card.atk || 0) + (card.tempAtkBoost || 0) + (card.equipAtkBonus || 0);
  if (atk <= 0) return Infinity;

  const extraAttacks = (card.extraAttacks || 0) + (card.equipExtraAttacks || 0);
  const attacksPerTurn = 1 + extraAttacks;
  const damagePerTurn = atk * attacksPerTurn;

  return Math.ceil(myLP / damagePerTurn);
}

/**
 * Verifica se um monstro pode matar em 1 turno (lethal check).
 * @param {Object[]} opponentField
 * @param {number} myLP
 * @returns {boolean}
 */
export function canOpponentLethal(opponentField, myLP = 8000) {
  if (!Array.isArray(opponentField)) return false;

  let totalDamage = 0;
  for (const card of opponentField) {
    if (!card || card.cardKind !== "monster") continue;
    if (card.position !== "attack") continue;

    const atk =
      (card.atk || 0) + (card.tempAtkBoost || 0) + (card.equipAtkBonus || 0);
    const extraAttacks =
      (card.extraAttacks || 0) + (card.equipExtraAttacks || 0);
    const attacksPerTurn = 1 + extraAttacks;

    totalDamage += atk * attacksPerTurn;
  }

  return totalDamage >= myLP;
}
