// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/MacroPlanning.js
// Sistema genérico de planejamento macro — lookahead N turnos para detectar
// win conditions (lethal em 2-3 turnos, defensiva necessária, aproveitamento de oportunidade)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula se o bot pode forçar lethal num número específico de turnos.
 * @param {Object} gameState - Estado clonado do jogo
 * @param {Object} botPlayer - Bot player state
 * @param {Object} opponentPlayer - Opponent player state
 * @param {number} turnsAhead - Quantos turnos procurar (1-3)
 * @returns {Object} - { canLethal: boolean, turnsNeeded: number, damage: number, confidence: 0.0-1.0 }
 */
export function detectLethalOpportunity(
  gameState,
  botPlayer,
  opponentPlayer,
  turnsAhead = 2
) {
  if (!botPlayer || !opponentPlayer) {
    return {
      canLethal: false,
      turnsNeeded: Infinity,
      damage: 0,
      confidence: 0,
    };
  }

  let totalDamage = 0;
  let turnsNeeded = Infinity;
  let confidence = 0.0;

  // Calcular dano do bot agora (campo atual)
  const directAttackers = (botPlayer.field || []).filter(
    (m) =>
      m &&
      (m.cardKind === "monster" || m.atk !== undefined) &&
      m.position === "attack" &&
      !m.hasAttacked
  );

  for (const attacker of directAttackers) {
    const atk = (attacker.atk || 0) + (attacker.tempAtkBoost || 0);
    const extraAttacks = attacker.extraAttacks || 0;
    totalDamage += atk * (1 + extraAttacks);
  }

  const oppLP = opponentPlayer.lp || 8000;

  // Verificar se já pode fazer lethal agora
  if (totalDamage >= oppLP) {
    turnsNeeded = 0;
    confidence = 1.0;
  } else if (turnsAhead >= 1) {
    // Estimar dano futuro com invocações/buffs
    const estimatedFutureMonsters = (botPlayer.hand || []).filter(
      (c) => c && c.cardKind === "monster"
    ).length;

    const avgDamagePerMonster = 1800; // Assumir média de 1800 ATK
    const estimatedDamage =
      totalDamage + estimatedFutureMonsters * avgDamagePerMonster;

    if (estimatedDamage >= oppLP) {
      turnsNeeded = 1;
      confidence = 0.6; // Menos confiança — depende de draws
    }
  }

  return {
    canLethal: turnsNeeded <= turnsAhead,
    turnsNeeded,
    damage: totalDamage,
    confidence,
  };
}

/**
 * Avalia se o bot precisa estar em modo defensivo (está em risco imediato).
 * @param {Object} gameState - Estado clonado
 * @param {Object} botPlayer - Bot player state
 * @param {Object} opponentPlayer - Opponent player state
 * @returns {Object} - { needsDefense: boolean, threatLevel: 'low'|'medium'|'high'|'critical', turnsToKill: number }
 */
export function detectDefensiveNeed(gameState, botPlayer, opponentPlayer) {
  if (!opponentPlayer) {
    return { needsDefense: false, threatLevel: "low", turnsToKill: Infinity };
  }

  const myLP = botPlayer.lp || 8000;
  const oppMonsters = (opponentPlayer.field || []).filter(
    (m) => m && (m.cardKind === "monster" || m.atk !== undefined)
  );

  let totalOppDamage = 0;
  for (const monster of oppMonsters) {
    const atk = (monster.atk || 0) + (monster.tempAtkBoost || 0);
    totalOppDamage += atk;
  }

  const turnsToKill =
    totalOppDamage > 0 ? Math.ceil(myLP / totalOppDamage) : Infinity;

  let threatLevel = "low";
  let needsDefense = false;

  if (turnsToKill === 1) {
    threatLevel = "critical";
    needsDefense = true;
  } else if (turnsToKill === 2) {
    threatLevel = "high";
    needsDefense = true;
  } else if (turnsToKill <= 4) {
    threatLevel = "medium";
    needsDefense = true;
  }

  return { needsDefense, threatLevel, turnsToKill };
}

/**
 * Detecta oportunidades de "virada" — quando bot está perdendo mas pode ganhar em N turnos.
 * @param {Object} gameState - Estado clonado
 * @param {Object} botPlayer - Bot player state
 * @param {Object} opponentPlayer - Opponent player state
 * @returns {Object} - { isVirada: boolean, turnsToWin: number, difficulty: 'easy'|'medium'|'hard' }
 */
export function detectComeback(gameState, botPlayer, opponentPlayer) {
  if (!opponentPlayer || !botPlayer) {
    return { isVirada: false, turnsToWin: Infinity, difficulty: "hard" };
  }

  const myLP = botPlayer.lp || 8000;
  const oppLP = opponentPlayer.lp || 8000;

  // Virada = eu tenho menos LP
  if (myLP >= oppLP) {
    return { isVirada: false, turnsToWin: Infinity, difficulty: "hard" };
  }

  // Calcular quantos turnos preciso para fazer lethal
  const lethalOpp = detectLethalOpportunity(
    gameState,
    botPlayer,
    opponentPlayer,
    3
  );

  if (lethalOpp.canLethal && lethalOpp.turnsNeeded <= 2) {
    const difficulty =
      lethalOpp.confidence >= 0.8
        ? "easy"
        : lethalOpp.confidence >= 0.5
        ? "medium"
        : "hard";
    return { isVirada: true, turnsToWin: lethalOpp.turnsNeeded, difficulty };
  }

  return { isVirada: false, turnsToWin: Infinity, difficulty: "hard" };
}

/**
 * Valida e prioriza estratégia macro baseado em win condition análise.
 * @param {Object} gameState - Estado do jogo
 * @param {Object} botPlayer - Bot player state
 * @param {Object} opponentPlayer - Opponent player state
 * @returns {Object} - { strategy: 'lethal'|'defend'|'setup'|'grind', priority: number }
 */
export function decideMacroStrategy(gameState, botPlayer, opponentPlayer) {
  const lethal = detectLethalOpportunity(
    gameState,
    botPlayer,
    opponentPlayer,
    2
  );
  const defense = detectDefensiveNeed(gameState, botPlayer, opponentPlayer);
  const comeback = detectComeback(gameState, botPlayer, opponentPlayer);

  // Prioridade 1: Lethal imediato ou muito próximo
  if (lethal.canLethal && lethal.turnsNeeded === 0) {
    return { strategy: "lethal", priority: 100, detail: "immediate_kill" };
  }

  if (lethal.canLethal && lethal.turnsNeeded === 1) {
    return { strategy: "lethal", priority: 95, detail: "lethal_next_turn" };
  }

  // Prioridade 2: Defensiva crítica (risco de perder em 1 turno)
  if (defense.threatLevel === "critical") {
    return { strategy: "defend", priority: 90, detail: "critical_threat" };
  }

  // Prioridade 3: Virada possível
  if (comeback.isVirada && comeback.difficulty !== "hard") {
    return { strategy: "lethal", priority: 85, detail: "comeback_win" };
  }

  // Prioridade 4: Defensiva alta
  if (defense.threatLevel === "high") {
    return { strategy: "defend", priority: 70, detail: "high_threat" };
  }

  // Prioridade 5: Setup para lethal futuro
  if (lethal.turnsNeeded <= 3 && lethal.confidence >= 0.6) {
    return { strategy: "setup", priority: 60, detail: "setup_lethal" };
  }

  // Prioridade 6: Defensiva média
  if (defense.threatLevel === "medium") {
    return { strategy: "defend", priority: 50, detail: "medium_threat" };
  }

  // Default: Grind/buildup
  return { strategy: "grind", priority: 30, detail: "buildup" };
}

/**
 * Calcula bônus de prioridade para uma ação com base em macro strategy.
 * @param {string} actionType - Tipo de ação (spell, summon, etc)
 * @param {Object} card - Carta sendo avaliada
 * @param {string} macroStrategy - Estratégia macro decidida
 * @returns {number} - Bônus de prioridade (0 a +20)
 */
export function calculateMacroPriorityBonus(actionType, card, macroStrategy) {
  let bonus = 0;

  if (macroStrategy === "lethal") {
    // Ações que aumentam ATK/dano
    if (actionType === "spell" && card.effects) {
      for (const effect of card.effects) {
        if (effect.actions) {
          for (const action of effect.actions) {
            if (action.type === "buff_stats_temp" && action.stat === "atk") {
              bonus += 15;
            }
          }
        }
      }
    }
    // Monstros high ATK como invocações prioritárias
    if (actionType === "summon" && card.atk >= 2000) {
      bonus += 12;
    }
  } else if (macroStrategy === "defend") {
    // Ações defensivas
    if (actionType === "spell" && card.effects) {
      for (const effect of card.effects) {
        const desc = (card.description || "").toLowerCase();
        if (desc.includes("protect") || desc.includes("defense")) {
          bonus += 15;
        }
      }
    }
    // Monstros com DEF alta
    if (actionType === "summon" && card.def >= 2000) {
      bonus += 10;
    }
  } else if (macroStrategy === "setup") {
    // Ações que preparam combos
    if (actionType === "spell" && card.effects) {
      for (const effect of card.effects) {
        if (effect.actions) {
          for (const action of effect.actions) {
            if (action.type === "add_from_zone_to_hand") {
              bonus += 12; // Buscas são importantes para setup
            }
          }
        }
      }
    }
  }

  return bonus;
}
