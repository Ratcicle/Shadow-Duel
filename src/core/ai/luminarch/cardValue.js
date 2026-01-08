// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/luminarch/cardValue.js
// Avaliação dinâmica do valor de cartas baseado em contexto e papel cumprido
// ─────────────────────────────────────────────────────────────────────────────

import { isLuminarch } from "./knowledge.js";

/**
 * Avalia se uma carta "já cumpriu seu papel" e pode ser gastável
 * @param {Object} card
 * @param {Object} context - { field, graveyard, hand, fieldSpell, usedEffects }
 * @returns {{expendable: boolean, reason: string, value: number}}
 */
export function evaluateCardExpendability(card, context) {
  if (!card) return { expendable: false, reason: "Carta inválida", value: 10 };

  const name = card.name || "";
  const cardKind = card.cardKind;

  // ═════════════════════════════════════════════════════════════════════════
  // SEARCHERS - Após buscar, podem ser gastáveis
  // ═════════════════════════════════════════════════════════════════════════

  // Valiant: Se já buscou Lv4-, valor cai drasticamente
  if (name === "Luminarch Valiant - Knight of the Dawn") {
    const hasUsedEffect = (context.usedEffects || []).includes(card.id);
    if (hasUsedEffect) {
      return {
        expendable: true,
        reason: "Já buscou monstro - pode ser gastável (tribute, custo)",
        value: 3, // Valor baixo após usar efeito
      };
    }
    return {
      expendable: false,
      reason: "Efeito de busca ainda não usado",
      value: 9,
    };
  }

  // Arbiter: Se já buscou spell/trap, valor cai
  if (name === "Luminarch Sanctified Arbiter") {
    const hasUsedEffect = (context.usedEffects || []).includes(card.id);
    if (hasUsedEffect) {
      return {
        expendable: true,
        reason: "Já buscou spell/trap - pode morrer sem problema",
        value: 3,
      };
    }
    return {
      expendable: false,
      reason: "Efeito de busca ainda não usado",
      value: 8,
    };
  }

  // Magic Sickle: Seu PRÓPRIO efeito é se enviar ao GY para buscar
  if (name === "Luminarch Magic Sickle") {
    const gyHasTargets = (context.graveyard || []).filter(
      (c) => c && isLuminarch(c) && c.cardKind === "monster"
    ).length >= 2;
    if (gyHasTargets) {
      return {
        expendable: true,
        reason: "Efeito ativo requer se enviar - gastável para recursão",
        value: 2, // Quer ser gasto!
      };
    }
    return {
      expendable: false,
      reason: "GY sem alvos suficientes ainda",
      value: 5,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // TANKS - Nunca gastáveis enquanto protegendo
  // ═════════════════════════════════════════════════════════════════════════

  // Aegisbearer: NÚCLEO da defesa, nunca gastável (exceto para Protector)
  if (name === "Luminarch Aegisbearer") {
    const hasProtectorInHand = (context.hand || []).some(
      (c) => c && c.name === "Luminarch Sanctum Protector"
    );
    const fieldAge = card.fieldAgeTurns || 0;
    const canAscend = fieldAge >= 2;

    // Exceção 1: Material para Sanctum Protector (upgrade de tank)
    if (hasProtectorInHand) {
      return {
        expendable: true,
        reason: "Pode ser enviado para invocar Sanctum Protector (2800 DEF)",
        value: 6,
      };
    }

    // Exceção 2: Pronto para Ascension (upgrade para Fortress)
    if (canAscend) {
      return {
        expendable: true,
        reason: `Pronto para Ascension (${fieldAge} turnos) - upgrade para Fortress`,
        value: 5,
      };
    }

    // Caso contrário: NUNCA gastável
    return {
      expendable: false,
      reason: "Tank principal - protege o campo",
      value: 10,
    };
  }

  // Fortress Aegis: Boss tank, nunca gastável
  if (name === "Luminarch Fortress Aegis") {
    return {
      expendable: false,
      reason: "Boss tank com recursão - NÚCLEO da defesa",
      value: 10,
    };
  }

  // Sanctum Protector: Tank com negar ataque, valor alto
  if (name === "Luminarch Sanctum Protector") {
    return {
      expendable: false,
      reason: "Tank 2800 DEF + negar ataque - valioso",
      value: 9,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // BEATERS - Gastáveis se já cumpriram papel
  // ═════════════════════════════════════════════════════════════════════════

  // Moonblade Captain: Se já reviveu algo, valor médio
  if (name === "Luminarch Moonblade Captain") {
    const hasUsedEffect = (context.usedEffects || []).includes(card.id);
    if (hasUsedEffect) {
      return {
        expendable: true,
        reason: "Já reviveu monstro - pode ser gastável",
        value: 5,
      };
    }
    return {
      expendable: false,
      reason: "Efeito de revive ainda não usado",
      value: 7,
    };
  }

  // Radiant Lancer: SNOWBALL EFFECT - valor AUMENTA com buffs acumulados
  if (name === "Luminarch Radiant Lancer") {
    const baseAtk = 2200; // ATK original do Lancer
    const currentAtk = card.atk || baseAtk;
    const atkGain = currentAtk - baseAtk;
    const killCount = Math.floor(atkGain / 200); // +200 por kill
    
    if (atkGain > 0) {
      // Quanto mais buff acumulado, MENOS gastável
      const snowballValue = Math.min(10, 6 + killCount); // 6 base + 1 por kill, máx 10
      return {
        expendable: false,
        reason: `SNOWBALL: +${atkGain} ATK acumulado (${killCount} kills) - PROTEGER`,
        value: snowballValue,
      };
    }
    // Sem buffs ainda: valor médio, pode ser material
    return {
      expendable: true,
      reason: "Lancer sem buffs - pode ser gastável se necessário",
      value: 5,
    };
  }

  // Aurora Seraph: Boss lifegain, alto valor, mas efeito OPT
  if (name === "Luminarch Aurora Seraph") {
    const hasUsedEffect = (context.usedEffects || []).includes(card.id);
    if (hasUsedEffect) {
      // Já usou proteção este turno - valor cai um pouco
      return {
        expendable: false, // Ainda é boss 2800 ATK
        reason: "Usou proteção - ainda é boss valioso mas sem OPT",
        value: 7,
      };
    }
    return {
      expendable: false,
      reason: "Boss 2800 ATK + lifegain + proteção OPT - NÚCLEO",
      value: 9,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // HALBERD - Extender baixo valor próprio (veio de graça)
  // ═════════════════════════════════════════════════════════════════════════

  // Enchanted Halberd: Veio de SS automático - ótimo custo
  if (name === "Luminarch Enchanted Halberd") {
    return {
      expendable: true,
      reason: "Extender que veio de graça - excelente custo de sacrifício",
      value: 3,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════
  // EQUIPS - São PROTEÇÃO SACRIFICIAL (valor = absorver dano)
  // ═════════════════════════════════════════════════════════════════════════

  if (cardKind === "spell" && card.subtype === "equip") {
    if (name === "Luminarch Crescent Shield") {
      return {
        expendable: true,
        reason: "Equip QUER ser destruído no lugar do monstro (1 vida extra)",
        value: 4, // Valor é a proteção, não a carta em si
      };
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // DEFAULT: Avaliar por stats/level
  // ═════════════════════════════════════════════════════════════════════════

  if (cardKind === "monster") {
    const atk = card.atk || 0;
    const def = card.def || 0;
    const level = card.level || 0;

    // Monstros fracos: mais gastáveis
    if (atk <= 1500 && def <= 1500 && level <= 4) {
      return {
        expendable: true,
        reason: "Monstro fraco - pode ser material/custo",
        value: 4,
      };
    }

    // Monstros fortes: menos gastáveis
    if (atk >= 2500 || def >= 2500) {
      return {
        expendable: false,
        reason: "Monstro forte - valioso no campo",
        value: 8,
      };
    }
  }

  // Default: neutro
  return {
    expendable: false,
    reason: "Carta sem avaliação específica",
    value: 5,
  };
}

/**
 * Avalia prioridade de ativar field spell MESMO sem setup perfeito
 * @param {Object} analysis
 * @returns {{priority: number, reason: string}}
 */
export function evaluateFieldSpellUrgency(analysis) {
  const fieldSpell = analysis.fieldSpell;
  const field = analysis.field || [];
  const hand = analysis.hand || [];
  const lp = analysis.lp || 8000;

  // Já tem field spell ativo
  if (fieldSpell) {
    return {
      priority: 0,
      reason: "Field spell já ativo",
    };
  }

  // CRÍTICO: Field spell é a BASE da estratégia
  // Heal passivo > setup perfeito
  const luminarchCount = field.filter((c) => c && isLuminarch(c)).length;

  // Mesmo SEM monstros, field spell é prioridade
  if (luminarchCount === 0) {
    return {
      priority: 18,
      reason:
        "CORE: Ativar field spell ANTES de setup - heal passivo é crítico",
    };
  }

  // Com monstros: prioridade MÁXIMA
  return {
    priority: 20,
    reason: `CORE: ${luminarchCount} Luminarch no campo - field spell URGENTE`,
  };
}

/**
 * Detecta proteções sacrificiais disponíveis
 * @param {Object} card - Carta a proteger
 * @param {Object} context
 * @returns {{hasProtection: boolean, protections: Array, layers: number}}
 */
export function detectSacrificialProtection(card, context) {
  if (!card) return { hasProtection: false, protections: [], layers: 0 };

  const field = context.field || [];
  const hand = context.hand || [];
  const spellTrap = context.spellTrap || [];

  const protections = [];

  // Layer 1: Equips que podem morrer no lugar
  const crescentShieldEquipped = field.some(
    (c) =>
      c &&
      c.equippedTo === card.id &&
      c.name === "Luminarch Crescent Shield"
  );
  if (crescentShieldEquipped) {
    protections.push({
      type: "equip_sacrifice",
      card: "Crescent Shield",
      description: "Absorve 1 ataque (equip morre no lugar)",
    });
  }

  // Layer 2: Holy Shield na mão (Quick Spell)
  const hasHolyShield = hand.some(
    (c) => c && c.name === "Luminarch Holy Shield"
  );
  if (hasHolyShield) {
    protections.push({
      type: "quick_protection",
      card: "Holy Shield",
      description: "Pode setar e ativar no turno do oponente (indestructible + heal)",
    });
  }

  // Layer 3: Holy Shield setado
  const holyShieldSet = spellTrap.some(
    (c) => c && c.name === "Luminarch Holy Shield" && c.isFacedown
  );
  if (holyShieldSet) {
    protections.push({
      type: "set_protection",
      card: "Holy Shield",
      description: "Setado - pronto para ativar (indestructible + heal)",
    });
  }

  // Layer 4: Citadel buff (pode buffar para sobreviver)
  if (context.fieldSpell?.name?.includes("Citadel")) {
    const canUseCitadelBuff = context.lp >= 1000;
    if (canUseCitadelBuff) {
      protections.push({
        type: "buff_protection",
        card: "Citadel",
        description: "Pode buffar +500 ATK/DEF (custo 1000 LP)",
      });
    }
  }

  return {
    hasProtection: protections.length > 0,
    protections,
    layers: protections.length,
  };
}

/**
 * Avalia se vale a pena arriscar uma jogada com proteção sacrificial
 * @param {Object} action - Ação proposta (ex: invocar monstro vulnerável)
 * @param {Object} context
 * @returns {{worthRisk: boolean, reason: string, protectionLayers: number}}
 */
export function evaluateRiskWithProtection(action, context) {
  if (!action || !action.card) {
    return { worthRisk: false, reason: "Ação inválida", protectionLayers: 0 };
  }

  const card = action.card;
  const protection = detectSacrificialProtection(card, context);
  const expendability = evaluateCardExpendability(card, context);

  // Se carta já cumpriu papel + tem proteção: VALE O RISCO
  if (expendability.expendable && protection.hasProtection) {
    return {
      worthRisk: true,
      reason: `${card.name} já cumpriu papel + ${protection.layers} layer(s) de proteção`,
      protectionLayers: protection.layers,
    };
  }

  // Se carta NÃO cumpriu papel mas tem múltiplas proteções: VALE O RISCO
  if (!expendability.expendable && protection.layers >= 2) {
    return {
      worthRisk: true,
      reason: `${protection.layers} layers de proteção - risco calculado OK`,
      protectionLayers: protection.layers,
    };
  }

  // Sem proteção suficiente: NÃO VALE O RISCO
  if (protection.layers === 0) {
    return {
      worthRisk: false,
      reason: "Sem proteção - muito arriscado",
      protectionLayers: 0,
    };
  }

  // 1 layer de proteção: avaliar value da carta
  if (protection.layers === 1) {
    if (expendability.value <= 5) {
      return {
        worthRisk: true,
        reason: "1 proteção + carta de baixo valor = risco aceitável",
        protectionLayers: 1,
      };
    }
    return {
      worthRisk: false,
      reason: "1 proteção não é suficiente para carta valiosa",
      protectionLayers: 1,
    };
  }

  return { worthRisk: false, reason: "Sem análise conclusiva", protectionLayers: 0 };
}
