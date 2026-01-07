// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/luminarch/priorities.js
// Decisões táticas: quando jogar spells, quando invocar, etc.
// ─────────────────────────────────────────────────────────────────────────────

import { CARD_KNOWLEDGE, isLuminarchByName, isLuminarch } from "./knowledge.js";

// Rastrear erros já logados para evitar spam
const _loggedErrors = new Set();

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
 * @param {Object} analysis - { hand, field, fieldSpell, graveyard, lp, oppField, oppLp }
 * @returns {SpellDecision}
 */
export function shouldPlaySpell(card, analysis) {
  try {
    const name = card.name;
    const knowledge = CARD_KNOWLEDGE[name];

    // Guard: validação de entrada
    if (!card || !name || !analysis) {
      return { yes: false, reason: "Dados inválidos" };
    }

    // Garantir que analysis tem arrays válidos
    analysis.field = Array.isArray(analysis.field) ? analysis.field : [];
    analysis.oppField = Array.isArray(analysis.oppField)
      ? analysis.oppField
      : [];
    analysis.hand = Array.isArray(analysis.hand) ? analysis.hand : [];
    analysis.graveyard = Array.isArray(analysis.graveyard)
      ? analysis.graveyard
      : [];

    // ═════════════════════════════════════════════════════════════════════════
    // FIELD SPELL - MÁXIMA PRIORIDADE
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Sanctum of the Luminarch Citadel") {
      if (analysis.fieldSpell) {
        return { yes: false, reason: "Já tenho field spell ativo" };
      }
      // SEMPRE ativar se não tiver field
      const luminarchCount = analysis.field.filter(
        (c) => c && isLuminarch(c)
      ).length;
      if (luminarchCount > 0) {
        return {
          yes: true,
          priority: 15,
          reason: "Field spell CORE - heal passivo + buff ativo",
        };
      }
      // Mesmo sem monstros, é importante
      return {
        yes: true,
        priority: 12,
        reason: "Field spell core (ativar antes de setup)",
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PROTEÇÃO
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Holy Shield") {
      const luminarchOnField = (analysis.field || []).filter(
        (c) => c && isLuminarch(c)
      );
      const oppHasThreats = (analysis.oppField || []).some(
        (m) => m && m.atk && m.atk >= 2000
      );

      // Usar se oponente tem ameaças fortes
      if (oppHasThreats && luminarchOnField.length >= 2) {
        return {
          yes: true,
          priority: 14,
          reason: `Proteção contra ameaças (${luminarchOnField.length} alvos) + heal`,
        };
      }

      // Ou se LP baixo
      if ((analysis.lp || 8000) <= 3000 && luminarchOnField.length >= 1) {
        return {
          yes: true,
          priority: 13,
          reason: "LP baixo - proteção + lifegain necessário",
        };
      }

      return {
        yes: false,
        reason: "Sem urgência para proteção ainda",
      };
    }

    if (name === "Luminarch Crescent Shield") {
      // Crescent Shield é equip que requer um monstro Luminarch no campo
      const luminarchMonsters = (analysis.field || []).filter(
        (c) => c && c.archetype === "Luminarch" && c.cardKind === "monster"
      );

      if (luminarchMonsters.length === 0) {
        return {
          yes: false,
          reason: "Sem monstro Luminarch no campo para equipar",
        };
      }

      // Priorizar monstros defensivos
      const aegis = luminarchMonsters.find(
        (c) => c.name === "Luminarch Aegisbearer"
      );
      const protector = luminarchMonsters.find(
        (c) => c.name === "Luminarch Sanctum Protector"
      );

      if (aegis) {
        return {
          yes: true,
          priority: 8,
          reason: "Equipar Aegisbearer (3000 DEF = wall)",
        };
      }
      if (protector) {
        return {
          yes: true,
          priority: 7,
          reason: "Equipar Sanctum Protector (3300 DEF)",
        };
      }

      // Qualquer monstro Luminarch serve como fallback
      return {
        yes: true,
        priority: 5,
        reason: `Equipar ${luminarchMonsters[0].name}`,
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // RECURSÃO
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Moonlit Blessing") {
      const gyLuminarch = (analysis.graveyard || []).filter(
        (c) => c && isLuminarch(c)
      );
      const hasCitadel =
        analysis.fieldSpell?.name?.includes("Citadel") ?? false;

      if (gyLuminarch.length === 0) {
        return { yes: false, reason: "GY vazio (sem alvos)" };
      }

      // COM CITADEL = prioridade altíssima (GY → campo direto)
      if (hasCitadel && analysis.field.length < 5) {
        const bestTarget = gyLuminarch
          .filter((c) => c.cardKind === "monster")
          .sort((a, b) => {
            // Priorizar: Aegisbearer > Valiant > outros
            if (a.name === "Luminarch Aegisbearer") return -1;
            if (b.name === "Luminarch Aegisbearer") return 1;
            if (a.name.includes("Valiant")) return -1;
            if (b.name.includes("Valiant")) return 1;
            return (b.level || 0) - (a.level || 0);
          })[0];

        return {
          yes: true,
          priority: 13,
          reason: `COM CITADEL: revive ${bestTarget?.name} direto no campo!`,
        };
      }

      // SEM CITADEL: ainda útil para mão
      if (gyLuminarch.length >= 2) {
        return {
          yes: true,
          priority: 7,
          reason: `Add da GY para mão (${gyLuminarch.length} opções)`,
        };
      }

      return { yes: false, reason: "Poucas opções na GY ainda" };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // REMOVAL
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Radiant Wave") {
      const luminarch2kPlus = (analysis.field || []).filter(
        (c) =>
          c &&
          isLuminarch(c) &&
          c.cardKind === "monster" &&
          (c.atk || 0) >= 2000
      );
      const oppThreats = (analysis.oppField || []).filter(
        (m) => m && !m.isFacedown && (m.atk || 0) >= 2200
      );

      if (luminarch2kPlus.length > 0 && oppThreats.length > 0) {
        return {
          yes: true,
          priority: 11,
          reason: `Destruir ameaça (custo: ${luminarch2kPlus[0].name})`,
        };
      }

      return {
        yes: false,
        reason: "Sem material 2000+ ATK ou sem ameaças para remover",
      };
    }

    if (name === "Luminarch Spear of Dawnfall") {
      const hasLuminarch = (analysis.field || []).some(
        (c) => c && isLuminarch(c)
      );
      const oppBiggest = (analysis.oppField || [])
        .filter((m) => m && !m.isFacedown)
        .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];

      if (hasLuminarch && oppBiggest && (oppBiggest.atk || 0) >= 2000) {
        return {
          yes: true,
          priority: 10,
          reason: `Zerar ${oppBiggest.name} (${oppBiggest.atk} ATK → 0)`,
        };
      }

      return {
        yes: false,
        reason: "Sem Luminarch no campo ou sem alvo forte",
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // BUFF
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Holy Ascension") {
      const lp = analysis.lp || 8000;
      const luminarchMonsters = (analysis.field || []).filter(
        (c) => c && isLuminarch(c) && c.cardKind === "monster"
      );
      const oppMaxAtk = Math.max(
        ...(analysis.oppField || []).map((m) => (m && m.atk) || 0),
        0
      );

      // Só usar se LP alto (custo 1000 LP é pesado)
      if (lp < 4000) {
        return { yes: false, reason: "LP muito baixo (custo 1000 LP)" };
      }

      // Usar se pode fechar jogo
      const canLethal = luminarchMonsters.some((m) => {
        const boostedAtk = (m.atk || 0) + 800;
        return boostedAtk >= (analysis.oppLp || 8000);
      });

      if (canLethal) {
        return {
          yes: true,
          priority: 12,
          reason: "Buff para LETHAL",
        };
      }

      // Ou se precisa passar por wall
      if (luminarchMonsters.length > 0 && oppMaxAtk >= 2500) {
        return {
          yes: true,
          priority: 6,
          reason: `Buff para superar wall (opp ${oppMaxAtk} ATK)`,
        };
      }

      return {
        yes: false,
        reason: "Custo alto (1000 LP) - esperar momento melhor",
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // CONTINUOUS / SITUATIONAL
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Knights Convocation") {
      const lv7Plus = (analysis.hand || []).filter(
        (c) =>
          c && isLuminarch(c) && c.cardKind === "monster" && (c.level || 0) >= 7
      );

      if (lv7Plus.length > 0) {
        return {
          yes: true,
          priority: 5,
          reason: "Continuous search (discard high-level para buscar Lv4-)",
        };
      }

      return { yes: false, reason: "Sem Lv7+ para discartar" };
    }

    if (name === "Luminarch Sacred Judgment") {
      const myField = analysis.field.length;
      const oppField = (analysis.oppField || []).length;
      const lp = analysis.lp || 8000;

      // Desperation play: campo vazio + opp 2+ monstros
      if (myField === 0 && oppField >= 2 && lp >= 3000) {
        const gyLuminarch = (analysis.graveyard || []).filter(
          (c) => c && isLuminarch(c) && c.cardKind === "monster"
        ).length;

        if (gyLuminarch >= 2) {
          return {
            yes: true,
            priority: 9,
            reason: `COMEBACK: SS ${Math.min(
              gyLuminarch,
              oppField
            )} monstros da GY (custo 2000 LP)`,
          };
        }
      }

      return {
        yes: false,
        reason: "Não é situação de desperation (precisa campo vazio + opp 2+)",
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // FALLBACK GENÉRICO
    // ═════════════════════════════════════════════════════════════════════════

    if (knowledge) {
      return {
        yes: true,
        priority: knowledge.priority || 3,
        reason: `${knowledge.role || "utility"} spell`,
      };
    }

    return { yes: true, priority: 1, reason: "Spell genérica" };
  } catch (e) {
    const errorKey = `spell_${card?.name}_${e.message}`;
    if (!_loggedErrors.has(errorKey)) {
      _loggedErrors.add(errorKey);
      console.error(
        `[shouldPlaySpell] ERRO ao avaliar ${card?.name}:`,
        e.message
      );
    }
    return { yes: false, reason: `Erro interno: ${e.message}` };
  }
}

/**
 * Decide se deve invocar um monstro e em qual posição.
 * @param {Object} card
 * @param {Object} analysis
 * @returns {SummonDecision}
 */
export function shouldSummonMonster(card, analysis) {
  try {
    const name = card.name;
    const knowledge = CARD_KNOWLEDGE[name];

    // Guard: validação de entrada
    if (!card || !name || !analysis) {
      return { yes: false, reason: "Dados inválidos" };
    }

    // Garantir que analysis tem arrays válidos
    analysis.field = Array.isArray(analysis.field) ? analysis.field : [];
    analysis.oppField = Array.isArray(analysis.oppField)
      ? analysis.oppField
      : [];
    analysis.hand = Array.isArray(analysis.hand) ? analysis.hand : [];
    analysis.graveyard = Array.isArray(analysis.graveyard)
      ? analysis.graveyard
      : [];

    if (!knowledge) {
      // Fallback genérico
      const oppStrongest = Math.max(
        ...(analysis.oppField || []).map((m) => (m && m.atk) || 0),
        0
      );
      const isSafe = (card.atk || 0) >= oppStrongest || (card.def || 0) >= 2000;

      return {
        yes: true,
        position: isSafe ? "attack" : "defense",
        priority: 3,
        reason: isSafe ? "Beater genérico" : "Defense genérica",
      };
    }

    const oppStrongest = Math.max(
      ...(analysis.oppField || []).map((m) => (m && m.atk) || 0),
      0
    );

    // ═════════════════════════════════════════════════════════════════════════
    // SEARCHERS - ALTA PRIORIDADE
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Valiant - Knight of the Dawn") {
      // Sempre invocar turn 1-2
      return {
        yes: true,
        position: "attack",
        priority: 9,
        reason: "Searcher T1 (add Aegisbearer ou outro Lv4-)",
      };
    }

    if (name === "Luminarch Sanctified Arbiter") {
      const hasCitadel =
        analysis.fieldSpell?.name?.includes("Citadel") ?? false;
      if (!hasCitadel) {
        return {
          yes: true,
          position: "attack",
          priority: 10,
          reason: "Search Sanctum Citadel (field spell core!)",
        };
      }
      return {
        yes: true,
        position: "attack",
        priority: 6,
        reason: "Search spell útil (Holy Shield, Moonlit Blessing)",
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TANKS - POSIÇÃO DEFENSIVA
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Aegisbearer") {
      // SEMPRE boa (taunt tank)
      return {
        yes: true,
        position: "defense",
        priority: 10,
        reason: "Taunt tank (força ataques) - 2000 DEF base",
      };
    }

    if (name === "Luminarch Sanctum Protector") {
      const hasAegis = analysis.field.some(
        (c) => c && c.name === "Luminarch Aegisbearer"
      );
      // Melhor com Aegis no campo (pode usar como custo)
      if (hasAegis) {
        return {
          yes: true,
          position: "defense",
          priority: 8,
          reason: "Com Aegis: pode SS usando ela como custo (2800 DEF wall)",
        };
      }
      return {
        yes: true,
        position: "defense",
        priority: 5,
        reason: "Tank 2800 DEF + negar ataque",
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // BEATERS - POSIÇÃO OFENSIVA (SE SEGURO)
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Celestial Marshal") {
      const isSafe = 2500 > oppStrongest;
      return {
        yes: true,
        position: isSafe ? "attack" : "defense",
        priority: 6,
        reason: isSafe
          ? "Boss beater 2500 ATK (seguro)"
          : "Defense até limpar board",
      };
    }

    if (name === "Luminarch Radiant Lancer") {
      const isSafe = 2600 > oppStrongest;
      return {
        yes: true,
        position: isSafe ? "attack" : "defense",
        priority: 5,
        reason: isSafe ? "Beater 2600 ATK (snowball)" : "Defense position",
      };
    }

    if (name === "Luminarch Aurora Seraph") {
      const isSafe = 2800 > oppStrongest;
      return {
        yes: true,
        position: isSafe ? "attack" : "defense",
        priority: 6,
        reason: isSafe
          ? "Boss 2800 ATK + lifegain"
          : "Defense (2400 DEF sólido)",
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // UTILITY
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Moonblade Captain") {
      const gyHasTargets = (analysis.graveyard || []).some(
        (c) =>
          c && isLuminarch(c) && c.cardKind === "monster" && (c.level || 0) <= 4
      );

      if (gyHasTargets) {
        return {
          yes: true,
          position: "attack",
          priority: 7,
          reason: "Revive Lv4- da GY + duplo ataque potencial",
        };
      }

      return {
        yes: true,
        position: "attack",
        priority: 4,
        reason: "Beater 2200 ATK",
      };
    }

    if (name === "Luminarch Magic Sickle") {
      const gyHasLuminarch = (analysis.graveyard || []).some(
        (c) => c && isLuminarch(c)
      );
      if (gyHasLuminarch) {
        return {
          yes: true,
          position: "defense",
          priority: 6,
          reason: "Recursion engine (enviar → add 2 da GY)",
        };
      }
      return {
        yes: false,
        reason: "GY sem alvos ainda",
      };
    }

    if (name === "Luminarch Enchanted Halberd") {
      // Extender - geralmente vem via efeito próprio
      return {
        yes: true,
        position: "defense",
        priority: 5,
        reason: "Extender defensivo",
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // FALLBACK
    // ═════════════════════════════════════════════════════════════════════════

    return {
      yes: true,
      position: (card.def || 0) >= (card.atk || 0) ? "defense" : "attack",
      priority: knowledge.priority || 3,
      reason: knowledge.effect || "Monstro genérico",
    };
  } catch (e) {
    const errorKey = `monster_${card?.name}_${e.message}`;
    if (!_loggedErrors.has(errorKey)) {
      _loggedErrors.add(errorKey);
      console.error(
        `[shouldSummonMonster] ERRO ao avaliar ${card?.name}:`,
        e.message
      );
    }
    return { yes: false, reason: `Erro interno: ${e.message}` };
  }
}
