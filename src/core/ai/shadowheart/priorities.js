// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/shadowheart/priorities.js
// Lógica de priorização: spell decisions, summon decisions, safety checks.
// ─────────────────────────────────────────────────────────────────────────────

import { CARD_KNOWLEDGE, isShadowHeartByName, isShadowHeart } from "./knowledge.js";

/**
 * @typedef {Object} SpellDecision
 * @property {boolean} yes
 * @property {number} [priority]
 * @property {string} reason
 */

/**
 * @typedef {Object} SummonDecision
 * @property {boolean} yes
 * @property {string} [position]
 * @property {number} [priority]
 * @property {string} reason
 */

/**
 * Decide se deve jogar uma spell.
 * @param {Object} card
 * @param {Object} analysis
 * @returns {SpellDecision}
 */
export function shouldPlaySpell(card, analysis) {
  const name = card.name;
  const knowledge = CARD_KNOWLEDGE[name];

  // Polymerization - Só se tiver setup completo
  if (name === "Polymerization") {
    const hasScaleDragon =
      analysis.field.some((c) => c.name === "Shadow-Heart Scale Dragon") ||
      analysis.hand.some((c) => c.name === "Shadow-Heart Scale Dragon");
    const hasMaterial = [...analysis.hand, ...analysis.field].some(
      (c) =>
        isShadowHeartByName(c.name) &&
        c.level >= 5 &&
        c.name !== "Shadow-Heart Scale Dragon"
    );

    if (hasScaleDragon && hasMaterial) {
      return { yes: true, priority: 12, reason: "Setup de fusão completo!" };
    }
    return { yes: false, reason: "Falta Scale Dragon ou material lv5+" };
  }

  // Darkness Valley - Primeiro se tiver monstros Shadow-Heart
  if (name === "Darkness Valley") {
    if (analysis.fieldSpell) {
      return { yes: false, reason: "Já tenho field spell" };
    }
    const shMonsters = analysis.hand.filter(
      (c) => isShadowHeartByName(c.name) && c.type === "monster"
    );
    if (
      analysis.field.some((c) => isShadowHeartByName(c.name)) ||
      shMonsters.length > 0
    ) {
      return { yes: true, priority: 9, reason: "Vai buffar meus monstros" };
    }
    return { yes: false, reason: "Sem monstros Shadow-Heart para buffar" };
  }

  // Shadow-Heart Rage - Só com Scale Dragon sozinho
  if (name === "Shadow-Heart Rage") {
    if (
      analysis.field.length === 1 &&
      analysis.field[0].name === "Shadow-Heart Scale Dragon"
    ) {
      return {
        yes: true,
        priority: 10,
        reason: "OTK potencial com Scale Dragon!",
      };
    }
    return { yes: false, reason: "Scale Dragon não está sozinho" };
  }

  // Shadow-Heart Infusion - Precisa de custo e target
  if (name === "Shadow-Heart Infusion") {
    if (analysis.hand.length < 3) {
      return { yes: false, reason: "Preciso de 2 cartas para descartar" };
    }
    const shInGY = analysis.graveyard.filter((c) => c.cardKind === "monster");
    if (shInGY.length === 0) {
      return { yes: false, reason: "Sem Shadow-Heart no GY para reviver" };
    }
    // Verificar se temos discards com valor
    const hasValueDiscard = analysis.hand.some(
      (c) =>
        c.name === "Shadow-Heart Specter" || c.name === "Shadow-Heart Coward"
    );
    return {
      yes: true,
      priority: hasValueDiscard ? 8 : 6,
      reason: `Reviver ${shInGY[0].name}`,
    };
  }

  // Shadow-Heart Covenant - Searcher genérico
  if (name === "Shadow-Heart Covenant") {
    if (analysis.lp < 1500) {
      return { yes: false, reason: "LP muito baixo para pagar 800" };
    }
    return { yes: true, priority: 7, reason: "Buscar peça chave do combo" };
  }

  // Shadow-Heart Battle Hymn - Só com múltiplos monstros
  if (name === "Shadow-Heart Battle Hymn") {
    const shOnField = analysis.field.filter((c) =>
      isShadowHeartByName(c.name)
    );
    if (shOnField.length >= 2) {
      return {
        yes: true,
        priority: 5,
        reason: `+500 ATK para ${shOnField.length} monstros`,
      };
    }
    return { yes: false, reason: "Preciso de 2+ Shadow-Heart no campo" };
  }

  // Shadow-Heart Purge - Remoção
  if (name === "Shadow-Heart Purge") {
    if (analysis.oppField.length > 0) {
      const strongestThreat = analysis.oppField.reduce(
        (max, c) => ((c.atk || 0) > (max.atk || 0) ? c : max),
        { atk: 0 }
      );
      return {
        yes: true,
        priority: 7,
        reason: `Destruir ${strongestThreat.name || "ameaça"}`,
      };
    }
    return { yes: false, reason: "Oponente sem monstros" };
  }

  // Shadow-Heart Shield - Proteção para boss
  if (name === "Shadow-Heart Shield") {
    const hasBoss = analysis.field.some((c) =>
      [
        "Shadow-Heart Scale Dragon",
        "Shadow-Heart Demon Arctroth",
        "Shadow-Heart Demon Dragon",
      ].includes(c.name)
    );
    if (hasBoss) {
      return { yes: true, priority: 6, reason: "Proteger meu boss" };
    }
    return { yes: false, reason: "Sem boss para proteger" };
  }

  // Spells genéricos com knowledge
  if (knowledge) {
    return {
      yes: true,
      priority: knowledge.priority || 3,
      reason: "Spell utilizável",
    };
  }

  return { yes: true, priority: 3, reason: "Spell genérica" };
}

/**
 * Decide se deve invocar um monstro.
 * @param {Object} card
 * @param {Object} analysis
 * @param {Object} tributeInfo - { tributesNeeded, alt }
 * @returns {SummonDecision}
 */
export function shouldSummonMonster(card, analysis, tributeInfo) {
  const name = card.name;
  const knowledge = CARD_KNOWLEDGE[name];

  // === SAFETY CHECK: Avaliar se é seguro summon em ATK ===
  const cardATK = card.atk || 0;
  const cardDEF = card.def || 0;
  const oppStrongestATK = analysis.oppField.reduce(
    (max, m) => Math.max(max, m.atk || 0),
    0
  );
  const oppHasThreats = analysis.oppField.length > 0;

  // Se oponente tem monstro mais forte, não summon em ATK (só se for extender/combo)
  const isSuicideSummon =
    oppHasThreats && cardATK < oppStrongestATK && cardATK > 0;
  const shouldDefensivePosition = isSuicideSummon && cardDEF >= cardATK;

  // Imp - Extender de alta prioridade
  if (name === "Shadow-Heart Imp") {
    const hasTarget = analysis.hand.some(
      (c) =>
        isShadowHeartByName(c.name) &&
        c.type === "monster" &&
        (c.level || 0) <= 4 &&
        c.name !== "Shadow-Heart Imp"
    );
    if (hasTarget) {
      if (isSuicideSummon && !shouldDefensivePosition) {
        return {
          yes: false,
          reason: `Imp seria destruído por ${oppStrongestATK} ATK oponente`,
        };
      }
      return {
        yes: true,
        position: shouldDefensivePosition ? "defense" : "attack",
        priority: 9,
        reason: "Extender para 2 corpos",
      };
    }
    if (isSuicideSummon) {
      return {
        yes: false,
        reason: `Imp 1500 ATK vs oponente ${oppStrongestATK} ATK = suicide`,
      };
    }
    return {
      yes: true,
      position: "attack",
      priority: 6,
      reason: "Beater de 1500",
    };
  }

  // Scale Dragon - Boss principal
  if (name === "Shadow-Heart Scale Dragon") {
    if (tributeInfo.tributesNeeded <= analysis.field.length) {
      return {
        yes: true,
        position: "attack",
        priority: 10,
        reason: "Boss de 3000 ATK!",
      };
    }
  }

  // Demon Arctroth - Boss com remoção
  if (name === "Shadow-Heart Demon Arctroth") {
    if (
      tributeInfo.tributesNeeded <= analysis.field.length &&
      analysis.oppField.length > 0
    ) {
      return {
        yes: true,
        position: "attack",
        priority: 9,
        reason: "Destruir monstro oponente + 2600 ATK",
      };
    }
  }

  // Griffin - Sem tributo se campo vazio
  if (name === "Shadow-Heart Griffin") {
    if (analysis.field.length === 0) {
      return {
        yes: true,
        position: "attack",
        priority: 8,
        reason: "2000 ATK sem tributo!",
      };
    }
  }

  // Gecko - Draw engine
  if (name === "Shadow-Heart Gecko") {
    if (analysis.field.some((c) => (c.atk || 0) >= 1800)) {
      if (isSuicideSummon) {
        return {
          yes: true,
          position: "defense",
          priority: 4,
          reason: "Draw engine (defesa por safety)",
        };
      }
      return {
        yes: true,
        position: "attack",
        priority: 5,
        reason: "Draw engine passivo",
      };
    }
  }

  // Specter - Recursão
  if (name === "Shadow-Heart Specter") {
    if (analysis.graveyard.length > 0) {
      if (isSuicideSummon && !shouldDefensivePosition) {
        return {
          yes: false,
          reason: `Specter 1500 ATK seria destruído por ${oppStrongestATK} ATK`,
        };
      }
      return {
        yes: true,
        position: shouldDefensivePosition ? "defense" : "attack",
        priority: 5,
        reason: "Futuro recurso de GY",
      };
    }
  }

  // Abyssal Eel - CASO ESPECÍFICO (1600 ATK burn)
  if (name === "Shadow-Heart Abyssal Eel") {
    if (isSuicideSummon) {
      return {
        yes: false,
        reason: `Eel 1600 ATK vs oponente ${oppStrongestATK} ATK = perda de monstro + burn inútil`,
      };
    }
    return {
      yes: true,
      position: "attack",
      priority: 4,
      reason: "Beater 1600 + burn",
    };
  }

  // Monstro genérico
  const baseAtk = card.atk || 0;
  if (baseAtk >= 1500 && tributeInfo.tributesNeeded === 0) {
    if (isSuicideSummon) {
      if (shouldDefensivePosition) {
        return {
          yes: true,
          position: "defense",
          priority: 3,
          reason: `DEF ${cardDEF} vs oponente ${oppStrongestATK} ATK`,
        };
      }
      return {
        yes: false,
        reason: `${baseAtk} ATK vs oponente ${oppStrongestATK} ATK = suicide`,
      };
    }
    return {
      yes: true,
      position: "attack",
      priority: 4,
      reason: `Beater de ${baseAtk}`,
    };
  }

  if (
    tributeInfo.tributesNeeded > 0 &&
    tributeInfo.tributesNeeded <= analysis.field.length
  ) {
    return {
      yes: true,
      position: "attack",
      priority: 5,
      reason: `Tribute Summon de ${baseAtk}`,
    };
  }

  // Monstro fraco em defesa
  if (baseAtk < 1500) {
    return {
      yes: true,
      position: "defense",
      priority: 2,
      reason: "Defesa/material",
    };
  }

  return { yes: false, reason: "Não vale a pena agora" };
}

/**
 * Avalia melhor tributos para um Tribute Summon.
 * Menor valor = melhor tributo.
 * @param {Array} field
 * @param {number} tributesNeeded
 * @param {Object} [cardToSummon]
 * @returns {number[]} Índices dos monstros a tributar
 */
export function selectBestTributes(field, tributesNeeded, cardToSummon = null) {
  if (tributesNeeded <= 0 || !field || field.length < tributesNeeded) {
    return [];
  }

  const monstersWithValue = field.map((monster, index) => {
    let value = 0;
    const knowledge = CARD_KNOWLEDGE[monster.name];

    // Valor base
    value += (monster.atk || 0) / 400;
    value += (monster.level || 0) * 0.15;

    // Monstros importantes: NÃO tributar
    if (knowledge?.role === "boss" || knowledge?.role === "fusion_boss")
      value += 20;
    if (monster.name === "Shadow-Heart Scale Dragon") value += 15;
    if (monster.name === "Shadow-Heart Gecko") value += 3;
    if (monster.name === "Shadow-Heart Leviathan") value += 6;
    if (monster.name === "Shadow-Heart Death Wyrm") value += 8;

    // Specter é BOM tributo (ativa efeito)
    if (monster.name === "Shadow-Heart Specter") value -= 5;

    // Tokens são ótimos tributos
    if (monster.isToken || monster.name.includes("Token")) value -= 10;

    // Monstros que já atacaram valem menos
    if (monster.hasAttacked) value -= 2;

    return { monster, index, value };
  });

  monstersWithValue.sort((a, b) => a.value - b.value);
  return monstersWithValue.slice(0, tributesNeeded).map((t) => t.index);
}

/**
 * Calcula requisito de tributos para um card.
 * @param {Object} card
 * @param {Object} playerState
 * @returns {{ tributesNeeded: number, alt: Object|null }}
 */
export function getTributeRequirementFor(card, playerState) {
  let tributesNeeded = 0;
  if (card.level >= 5 && card.level <= 6) tributesNeeded = 1;
  else if (card.level >= 7 && card.level <= 8) tributesNeeded = 2;
  else if (card.level >= 9) tributesNeeded = card.requiredTributes || 3;

  // Alt tribute conditions
  const alt = card.altTribute;
  if (
    alt?.type === "no_tribute_if_empty_field" &&
    (playerState.field?.length || 0) === 0
  ) {
    tributesNeeded = 0;
  }

  return { tributesNeeded, alt };
}
