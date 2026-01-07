// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/luminarch/multiTurnPlanning.js
// Planejamento multi-turno: avalia próximo turno antes de tomar decisões
// ─────────────────────────────────────────────────────────────────────────────

import { isLuminarch } from "./knowledge.js";

/**
 * Avalia o "stance" ideal baseado no campo oponente
 * @param {Object} analysis - Estado do jogo
 * @returns {{stance: string, reason: string, oppThreat: number}}
 */
export function evaluateGameStance(analysis) {
  const oppField = analysis.oppField || [];
  const ownField = analysis.field || [];
  const lp = analysis.lp || 8000;
  const oppLp = analysis.oppLp || 8000;
  const currentTurn = analysis.currentTurn || 1;

  // Calcular ameaça do oponente
  const oppStrongest = Math.max(
    ...oppField
      .filter((m) => m && m.cardKind === "monster" && !m.isFacedown)
      .map((m) => m.atk || 0),
    0
  );
  const oppMonsterCount = oppField.filter(
    (m) => m && m.cardKind === "monster"
  ).length;
  const oppTotalAtk = oppField
    .filter((m) => m && m.cardKind === "monster" && !m.isFacedown)
    .reduce((sum, m) => sum + (m.atk || 0), 0);

  // Calcular defesa própria
  const ownStrongest = Math.max(
    ...ownField
      .filter((m) => m && m.cardKind === "monster" && !m.isFacedown)
      .map((m) =>
        m.position === "defense" ? m.def || 0 : m.atk || 0
      ),
    0
  );
  const ownDefCount = ownField.filter(
    (m) =>
      m && m.cardKind === "monster" && m.position === "defense"
  ).length;

  // ═════════════════════════════════════════════════════════════════════════
  // STANCE LOGIC
  // ═════════════════════════════════════════════════════════════════════════

  // Turn 1-2: Sempre SETUP
  if (currentTurn <= 2) {
    return {
      stance: "setup",
      reason: "Early game - priorizar field spell + searchers",
      oppThreat: 0,
    };
  }

  // LP crítico: DEFENSIVE
  if (lp <= 3000) {
    return {
      stance: "defensive",
      reason: `LP crítico (${lp}) - focar sobrevivência`,
      oppThreat: 8,
    };
  }

  // Oponente muito forte: DEFENSIVE
  if (oppStrongest >= 2500 || oppMonsterCount >= 3) {
    return {
      stance: "defensive",
      reason: `Oponente forte (${oppStrongest} ATK, ${oppMonsterCount} monstros)`,
      oppThreat: 7,
    };
  }

  // Oponente fraco e temos campo: AGGRESSIVE
  if (
    oppMonsterCount === 0 ||
    (oppStrongest <= 1800 && ownStrongest >= 2000)
  ) {
    return {
      stance: "aggressive",
      reason: `Oponente fraco (${oppStrongest} ATK) - pressionar`,
      oppThreat: 2,
    };
  }

  // Oponente médio: BALANCED
  return {
    stance: "balanced",
    reason: "Situação equilibrada - jogar resources wisely",
    oppThreat: 4,
  };
}

/**
 * Estima recursos disponíveis no próximo turno
 * @param {Object} analysis
 * @returns {{nextTurnHand: number, nextTurnResources: string[]}}
 */
export function estimateNextTurnResources(analysis) {
  const hand = analysis.hand || [];
  const graveyard = analysis.graveyard || [];
  const field = analysis.field || [];
  const fieldSpell = analysis.fieldSpell;

  const resources = [];

  // Draw phase: +1 carta
  const nextTurnHandSize = hand.length + 1;
  resources.push(`Draw +1 (${nextTurnHandSize} cartas na mão)`);

  // Recursão do GY
  const luminarchInGY = graveyard.filter(
    (c) => c && isLuminarch(c) && c.cardKind === "monster"
  ).length;
  if (luminarchInGY >= 2) {
    resources.push(`GY: ${luminarchInGY} Luminarch (recursão disponível)`);
  }

  // Field spell buffs
  if (fieldSpell?.name?.includes("Citadel")) {
    resources.push("Citadel: buff +500 ATK/DEF disponível");
  }

  // Monstros no campo que geram valor
  const valueGenerators = field.filter((c) => {
    if (!c || c.cardKind !== "monster") return false;
    const name = c.name || "";
    // Detectar monstros com efeitos contínuos/ignição
    return (
      name.includes("Captain") ||
      name.includes("Sickle") ||
      name.includes("Arbiter")
    );
  });

  if (valueGenerators.length > 0) {
    resources.push(
      `${valueGenerators.length} monstros com efeitos ativos`
    );
  }

  return {
    nextTurnHand: nextTurnHandSize,
    nextTurnResources: resources,
  };
}

/**
 * Decide se vale a pena gastar recursos agora ou segurar para próximo turno
 * @param {Object} card - Carta a ser jogada
 * @param {Object} analysis - Estado do jogo
 * @param {Object} stance - Stance atual (evaluateGameStance)
 * @returns {{shouldPlay: boolean, reason: string}}
 */
export function shouldCommitResourcesNow(card, analysis, stance) {
  const cardName = card.name || "";
  const lp = analysis.lp || 8000;
  const oppLp = analysis.oppLp || 8000;
  const hand = analysis.hand || [];

  // ═════════════════════════════════════════════════════════════════════════
  // SEMPRE JOGAR: Field Spell
  // ═════════════════════════════════════════════════════════════════════════
  if (card.subtype === "field" && !analysis.fieldSpell) {
    return {
      shouldPlay: true,
      reason: "Field spell = core da estratégia",
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SEMPRE JOGAR: Searchers (geram vantagem)
  // ═════════════════════════════════════════════════════════════════════════
  if (
    cardName.includes("Valiant") ||
    cardName.includes("Arbiter") ||
    cardName.includes("Sickle")
  ) {
    return {
      shouldPlay: true,
      reason: "Searcher/recursão = vantagem de cartas",
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // STANCE: DEFENSIVE - Segurar resources ofensivos
  // ═════════════════════════════════════════════════════════════════════════
  if (stance.stance === "defensive") {
    // Spells de buff: segurar até ter lethal/necessidade
    if (
      cardName.includes("Holy Ascension") ||
      cardName.includes("Radiant Wave")
    ) {
      return {
        shouldPlay: false,
        reason: "Defensive stance - segurar buff/removal para momento crítico",
      };
    }

    // Proteção: jogar se necessário
    if (
      cardName.includes("Holy Shield") ||
      cardName.includes("Crescent Shield")
    ) {
      const hasValuableTargets = (analysis.field || []).filter(
        (c) => c && isLuminarch(c)
      ).length >= 2;
      if (hasValuableTargets) {
        return {
          shouldPlay: true,
          reason: "Defensive stance + alvos valiosos = proteção necessária",
        };
      }
    }

    // Recursão: OK se GY tem recursos
    if (cardName.includes("Moonlit Blessing")) {
      const gyHasValue = (analysis.graveyard || []).some(
        (c) =>
          c &&
          isLuminarch(c) &&
          c.cardKind === "monster" &&
          ((c.def || 0) >= 2000 || (c.atk || 0) >= 2000)
      );
      if (gyHasValue) {
        return {
          shouldPlay: true,
          reason: "GY tem recursos valiosos - recuperar",
        };
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // STANCE: AGGRESSIVE - Usar buffs para pressionar
  // ═════════════════════════════════════════════════════════════════════════
  if (stance.stance === "aggressive") {
    // Buffs: usar para fechar jogo
    if (cardName.includes("Holy Ascension")) {
      const canPush = (analysis.field || []).some(
        (c) =>
          c &&
          c.cardKind === "monster" &&
          !c.isFacedown &&
          (c.atk || 0) >= 1800
      );
      if (canPush && lp >= 4000) {
        return {
          shouldPlay: true,
          reason: "Aggressive stance + beaters = pressionar oponente",
        };
      }
    }

    // Removal: limpar caminho
    if (cardName.includes("Radiant Wave") || cardName.includes("Spear")) {
      return {
        shouldPlay: true,
        reason: "Aggressive stance - remover blockers",
      };
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // DEFAULT: Avaliar custo vs benefício
  // ═════════════════════════════════════════════════════════════════════════

  // Cartas caras (LP): avaliar situação
  if (cardName.includes("Sacred Judgment")) {
    // Sacred Judgment é carta de DESPERATION: campo vazio + opp domina
    const myField = field.length;
    const oppField = (analysis.oppField || []).length;
    
    // Se é situação crítica (campo vazio + opp 3+), permitir com LP >= 2500
    if (myField === 0 && oppField >= 3 && lp >= 2500) {
      return {
        shouldPlay: true,
        reason: "Situação crítica justifica risco (campo vazio + opp domina)",
      };
    }
    
    // Caso contrário, exigir LP >= 4500 (conservador)
    if (lp < 4500) {
      return {
        shouldPlay: false,
        reason: "LP insuficiente para custo (2000 LP) sem situação crítica",
      };
    }
  }

  if (cardName.includes("Holy Ascension") && lp < 4000) {
    return {
      shouldPlay: false,
      reason: "LP baixo para custo (1000 LP)",
    };
  }

  // Mão pequena: segurar cartas situacionais
  if (hand.length <= 2 && card.cardKind === "spell") {
    const isSituational =
      cardName.includes("Convocation") ||
      cardName.includes("Judgment") ||
      cardName.includes("Crescent Shield");

    if (isSituational) {
      return {
        shouldPlay: false,
        reason: "Mão pequena - segurar cartas situacionais",
      };
    }
  }

  // DEFAULT: OK jogar
  return {
    shouldPlay: true,
    reason: "Situação permite gastar recursos",
  };
}

/**
 * Plano de jogo para próximos turnos
 * @param {Object} analysis
 * @returns {{plan: string[], priority: string}}
 */
export function planNextTurns(analysis) {
  const stance = evaluateGameStance(analysis);
  const nextTurn = estimateNextTurnResources(analysis);
  const plan = [];

  // Plano baseado no stance
  if (stance.stance === "setup") {
    plan.push("T1-2: Ativar field spell");
    plan.push("T1-2: Invocar searchers (Valiant/Arbiter)");
    plan.push("T1-2: Buscar tanks (Aegis) ou proteção");
    plan.push("T3+: Avaliar se vai defensivo ou agressivo");
  } else if (stance.stance === "defensive") {
    plan.push("Invocar tanks (Aegis, Protector)");
    plan.push("Equipar/proteger monstros chave");
    plan.push("Usar heal do Citadel");
    plan.push("Aguardar oportunidade de contra-ataque");
    plan.push("Recursão do GY quando seguro");
  } else if (stance.stance === "aggressive") {
    plan.push("Invocar beaters (Captain, Marshal)");
    plan.push("Buffs com Holy Ascension");
    plan.push("Remover blockers (Radiant Wave)");
    plan.push("Pressionar com ataques diretos");
  } else {
    // balanced
    plan.push("Manter campo equilibrado");
    plan.push("Reagir ao campo oponente");
    plan.push("Acumular recursos para turn key");
  }

  return {
    plan,
    priority: stance.stance,
    nextTurnResources: nextTurn.nextTurnResources,
  };
}
