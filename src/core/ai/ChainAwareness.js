// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/ChainAwareness.js
// Sistema genérico de chain awareness — detecta bloqueios potenciais, spell speed,
// defensive traps, e cadeias que podem ser negadas.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analisa spell speed e cadeia de um efeito.
 * @param {Object} effect - Efeito a analisar
 * @returns {Object} - { spellSpeed: number, canChain: boolean, chainType: 'fast_effect'|'spell_speed_2'|'spell_speed_1'|'none' }
 */
export function analyzeSpellSpeed(effect) {
  if (!effect) {
    return { spellSpeed: 1, canChain: false, chainType: "none" };
  }

  const timing = effect.timing || "";
  const spellSpeed = effect.spellSpeed || 1;

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

  const desc = (card.description || "").toLowerCase();
  const blocking = [];
  let strength = "weak";

  // Detecta padrões em descrição
  if (
    desc.includes("negate") ||
    desc.includes("block") ||
    desc.includes("prevent")
  ) {
    blocking.push("activation");
    strength = "strong";
  }

  if (desc.includes("destroy") && desc.includes("attack")) {
    blocking.push("attack");
    strength = "medium";
  }

  if (desc.includes("summon") && desc.includes("block")) {
    blocking.push("summon");
    strength = "medium";
  }

  if (desc.includes("damage") && desc.includes("negate")) {
    blocking.push("damage");
    strength = "weak";
  }

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

  const chainableCards = [];

  // Field spells e permanents com efeitos rápidos
  if (opponentPlayer.fieldSpell) {
    const field = opponentPlayer.fieldSpell;
    const effects = field.effects || [];
    for (const effect of effects) {
      const speed = analyzeSpellSpeed(effect);
      if (speed.canChain) {
        chainableCards.push({
          name: field.name,
          type: "field_spell",
          chainType: speed.chainType,
        });
      }
    }
  }

  // Monstros com efeitos rápidos
  for (const monster of opponentPlayer.field || []) {
    if (!monster) continue;
    const effects = monster.effects || [];
    for (const effect of effects) {
      const speed = analyzeSpellSpeed(effect);
      if (speed.canChain && effect.timing === "on_event") {
        chainableCards.push({
          name: monster.name,
          type: "monster",
          chainType: speed.chainType,
          event: effect.event,
        });
      }
    }
  }

  // Spells/Traps set
  for (const card of opponentPlayer.spellTrap || []) {
    if (!card) continue;
    const trap = analyzeDefensiveTrap(card);
    if (trap.isDefensiveTrap) {
      chainableCards.push({
        name: card.name,
        type: card.cardKind === "spell" ? "quick_play" : "trap",
        strength: trap.strength,
      });
    }
  }

  return {
    canChain: chainableCards.length > 0,
    chainableCards,
    chainDepth: Math.min(3, chainableCards.length), // Estimar profundidade máxima
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
