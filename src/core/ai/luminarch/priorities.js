// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/luminarch/priorities.js
// Decisões táticas: quando jogar spells, quando invocar, etc.
// ─────────────────────────────────────────────────────────────────────────────

import { CARD_KNOWLEDGE, isLuminarchByName, isLuminarch } from "./knowledge.js";
import { evaluateFieldSpellUrgency } from "./cardValue.js";

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

      // Usar sistema de avaliação de urgência
      const urgency = evaluateFieldSpellUrgency(analysis);

      return {
        yes: true,
        priority: urgency.priority,
        reason: urgency.reason,
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PROTEÇÃO
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Holy Shield") {
      const luminarchOnField = (analysis.field || []).filter(
        (c) => c && isLuminarch(c)
      );

      // CRITICAL: Sem monstros no campo = NÃO PODE ATIVAR (requer targets)
      if (luminarchOnField.length === 0) {
        return {
          yes: false,
          reason: "Sem monstros Luminarch no campo para proteger",
        };
      }

      const oppHasThreats = (analysis.oppField || []).some(
        (m) => m && m.atk && m.atk >= 2000
      );

      // CRÍTICO: Holy Shield agora é QUICK SPELL (speed 2)
      // Ideal é SETAR e ativar no turno do oponente como reação
      // Só ativar proativamente em Main Phase se situação desesperadora

      // Situação desesperadora: LP crítico + múltiplas ameaças
      const lpCritical = (analysis.lp || 8000) <= 2000;
      const multipleThreats =
        (analysis.oppField || []).filter((m) => m && m.atk && m.atk >= 1800)
          .length >= 2;

      if (lpCritical && multipleThreats && luminarchOnField.length >= 2) {
        return {
          yes: true,
          priority: 16,
          reason: `LP crítico + ${luminarchOnField.length} alvos - ativar AGORA`,
        };
      }

      // Caso contrário: SEGURAR para uso reativo
      // A IA deve SET esta carta para usar no turno do oponente
      return {
        yes: false,
        reason:
          "Quick Spell - segurar para ativar no turno do oponente (uso reativo)",
      };
    }

    if (name === "Luminarch Crescent Shield") {
      // Crescent Shield é equip que requer um monstro Luminarch no campo
      const luminarchMonsters = (analysis.field || []).filter(
        (c) =>
          c &&
          c.archetype === "Luminarch" &&
          c.cardKind === "monster" &&
          !c.isFacedown
      );

      if (luminarchMonsters.length === 0) {
        return {
          yes: false,
          reason: "Sem monstro Luminarch face-up para equipar",
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
        // NOVO: Priorizar bosses que já usaram efeitos OPT como custo
        // Esses já geraram valor e são melhores custos que bosses frescos
        const usedBosses = luminarch2kPlus.filter((c) => c.usedEffectThisTurn);
        const expendableBosses = luminarch2kPlus.filter((c) => {
          // Bosses que são bons custos: já usaram efeito OU são menores que o alvo
          const alreadyActed = c.usedEffectThisTurn || c.hasAttacked;
          const smallerThanThreat = (c.atk || 0) < (oppThreats[0]?.atk || 0);
          return alreadyActed || smallerThanThreat;
        });

        const bestCost =
          usedBosses[0] || expendableBosses[0] || luminarch2kPlus[0];
        const costReason =
          usedBosses.length > 0
            ? `${bestCost.name} (já usou efeito = bom custo)`
            : expendableBosses.length > 0
            ? `${bestCost.name} (expendable)`
            : `${bestCost.name} (2000+ ATK)`;

        return {
          yes: true,
          priority: 11,
          reason: `Destruir ameaça ${oppThreats[0]?.name} (custo: ${costReason})`,
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
      const oppDefenders = (analysis.oppField || []).filter(
        (m) => m && m.position === "defense"
      );

      // NOVO: Prioridade alta se tem monstros com Piercing e oponente em DEF
      const piercingMonsters = (analysis.field || []).filter(
        (c) => c && c.cardKind === "monster" && !c.isFacedown && c.piercing
      );
      const hasPiercingSetup =
        piercingMonsters.length > 0 && oppDefenders.length > 0;

      if (hasLuminarch && hasPiercingSetup) {
        const totalPiercingAtk = piercingMonsters.reduce(
          (sum, m) => sum + (m.atk || 0),
          0
        );
        const oppLp = analysis.oppLp || 8000;
        const canLethal = totalPiercingAtk >= oppLp;

        return {
          yes: true,
          priority: canLethal ? 18 : 12, // LETHAL = máxima prioridade
          reason: canLethal
            ? `LETHAL! Spear → Zerar DEF → Piercing ${totalPiercingAtk} = WIN`
            : `Piercing setup: zerar DEF de defender → ${piercingMonsters
                .map((m) => m.name?.split(" - ")[0])
                .join(", ")} (${totalPiercingAtk} dmg)`,
        };
      }

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
      const oppLp = analysis.oppLp || 8000;
      const luminarchMonsters = (analysis.field || []).filter(
        (c) => c && isLuminarch(c) && c.cardKind === "monster" && !c.isFacedown
      );
      const oppMaxAtk = Math.max(
        ...(analysis.oppField || []).map(
          (m) => (m && !m.isFacedown && m.atk) || 0
        ),
        0
      );

      // CRITICAL: Holy Ascension custa 1000 LP - gerenciar budget
      // Só usar se LP alto (custo 1000 LP é pesado)
      if (lp < 4000) {
        return { yes: false, reason: "LP muito baixo (custo 1000 LP)" };
      }

      // Prioridade 1: LETHAL
      // Se pode fechar jogo com buff, SEMPRE usar
      const totalAtk = luminarchMonsters.reduce(
        (sum, m) => sum + (m.atk || 0),
        0
      );
      const buffedAtk = totalAtk + luminarchMonsters.length * 800;
      const directDamage = Math.max(
        buffedAtk -
          oppMaxAtk *
            Math.min(analysis.oppField.length, luminarchMonsters.length),
        0
      );

      if (directDamage >= oppLp) {
        return {
          yes: true,
          priority: 15,
          reason: `LETHAL! ${directDamage} damage = WIN (custo 1000 LP OK)`,
        };
      }

      // Prioridade 2: Fechar gap crítico
      // Se pode ultrapassar wall defensiva forte e tem LP sobrando
      if (lp >= 5000 && luminarchMonsters.length > 0 && oppMaxAtk >= 2500) {
        const wouldWin = luminarchMonsters.some((m) => {
          const boostedAtk = (m.atk || 0) + 800;
          return boostedAtk > oppMaxAtk + 300;
        });

        if (wouldWin) {
          return {
            yes: true,
            priority: 8,
            reason: `Buff para superar wall ${oppMaxAtk} ATK (LP saudável: ${lp})`,
          };
        }
      }

      // Prioridade 3: Setup de comeback
      // Se LP crítico mas pode virar jogo
      if (lp <= 3000 && lp >= 2000 && oppLp <= 3000) {
        const canPush = luminarchMonsters.length >= 2;
        if (canPush) {
          return {
            yes: true,
            priority: 6,
            reason: "ALL-IN: ambos LP baixo, buff para push final",
          };
        }
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

      // NOVO: Detectar situação de BRICK (muitos Lv7+ sem searchers)
      const hasSearcherInHand = (analysis.hand || []).some(
        (c) => c && (c.name?.includes("Valiant") || c.name?.includes("Arbiter"))
      );
      const isBricked = lv7Plus.length >= 2 && !hasSearcherInHand;

      if (isBricked) {
        return {
          yes: true,
          priority: 14, // Alta prioridade - resolver brick é crítico
          reason: `BRICK ESCAPE: ${lv7Plus.length}x Lv7+ na mão sem searchers → discard boss → search Valiant/Arbiter`,
        };
      }

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
      const oppLp = analysis.oppLp || 8000;

      // Avaliação: qualidade dos monstros no GY
      const gyLuminarch = (analysis.graveyard || []).filter(
        (c) => c && isLuminarch(c) && c.cardKind === "monster"
      );

      const highValueMonsters = gyLuminarch.filter((c) => {
        // Aegisbearer (tank), Protector (DEF high), Aurora (LP gain), Fortress (Ascension boss)
        return (
          c.name?.includes("Aegisbearer") ||
          c.name?.includes("Sanctum Protector") ||
          c.name?.includes("Aurora Seraph") ||
          c.name?.includes("Fortress Aegis") ||
          (c.def && c.def >= 2000) ||
          (c.atk && c.atk >= 2000)
        );
      }).length;

      // === SITUAÇÃO CRÍTICA: Campo vazio + opp domina ===
      // Precisa: campo vazio, opp 2+, LP >= 2500 (sobra 500 após custo), GY com recursos
      if (
        myField === 0 &&
        oppField >= 2 &&
        lp >= 2500 &&
        gyLuminarch.length >= 2
      ) {
        // Calcular power swing potencial
        const potentialSummons = Math.min(gyLuminarch.length, oppField, 5);
        const lpGain = potentialSummons * 500; // heal de volta
        const netLpCost = 2000 - lpGain; // custo real após heal
        const finalLp = lp - netLpCost;

        // Avaliar se é worth it
        const isCritical = oppField >= 3 || oppLp > lp + 2000; // opp domina
        const hasQuality = highValueMonsters >= 1; // pelo menos 1 bom monstro
        const survives = finalLp >= 1000; // sobrevive após custo

        if (isCritical && hasQuality && survives) {
          // Prioridade MUITO ALTA: é carta de comeback
          const priority = oppField >= 4 ? 19 : oppField >= 3 ? 17 : 15;
          return {
            yes: true,
            priority,
            reason: `COMEBACK CRÍTICO: SS ${potentialSummons} monstros (${highValueMonsters} high-value), net cost ${netLpCost} LP, final ${finalLp} LP`,
          };
        }

        if (survives && gyLuminarch.length >= 3) {
          // Situação menos crítica mas ainda válida
          return {
            yes: true,
            priority: 13,
            reason: `Comeback: SS ${potentialSummons} monstros da GY (LP final: ${finalLp})`,
          };
        }
      }

      // Bloquear: não é situação de desperation ou muito arriscado
      if (myField > 0) {
        return { yes: false, reason: "Precisa campo vazio (situação crítica)" };
      }
      if (oppField < 2) {
        return { yes: false, reason: "Opp precisa ter 2+ monstros" };
      }
      if (lp < 2500) {
        return {
          yes: false,
          reason: "LP insuficiente (precisa 2500+ para sobreviver custo)",
        };
      }
      if (gyLuminarch.length < 2) {
        return { yes: false, reason: "GY sem recursos (precisa 2+ Luminarch)" };
      }

      return {
        yes: false,
        reason: "Não justifica risco (falta criticalidade ou qualidade no GY)",
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
    // LUMINARCH STRATEGY: DEFENSIVE CONTROL
    // Early game: Setup defenses (Aegisbearer, Sanctum Protector)
    // Mid game: Accumulate resources (spells, hand advantage)
    // Late game: Push with buffed monsters or Marshal
    // ═════════════════════════════════════════════════════════════════════════

    // Calcular fase do jogo baseado em recursos
    // Early game: campo vazio/1 monstro E poucos recursos usados (graveyard pequeno)
    const gyCount = analysis.graveyard?.length || 0;
    const fieldCount = analysis.field.length;
    const isEarlyGame = fieldCount <= 1 && gyCount <= 2;
    const hasTank = analysis.field.some(
      (c) =>
        c &&
        (c.name === "Luminarch Aegisbearer" ||
          c.name === "Luminarch Sanctum Protector")
    );
    const hasFieldSpell = !!analysis.fieldSpell;

    // ═════════════════════════════════════════════════════════════════════════
    // TANKS - PRIORIDADE MÁXIMA NO EARLY GAME
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Aegisbearer") {
      // Aegisbearer é SEMPRE prioridade máxima se não temos tank
      if (!hasTank) {
        return {
          yes: true,
          position: "defense",
          priority: 12, // Máxima prioridade
          reason: "Setup defensivo CRÍTICO - 2000 DEF + taunt",
        };
      }

      // Verificar se deve ser mantido para Ascension
      const aegisOnField = analysis.field.find(
        (c) => c && c.name === "Luminarch Aegisbearer"
      );
      if (aegisOnField) {
        const fieldAge = aegisOnField.fieldAgeTurns || 0;
        if (fieldAge >= 1) {
          // Já tem um Aegis veterano - não invocar outro (diluir field)
          return {
            yes: false,
            reason: `Aegis no campo (${fieldAge}/2 turnos para Ascension) - preservar field`,
          };
        }
      }

      // Já tem tank, ainda é bom mas menor prioridade
      return {
        yes: true,
        position: "defense",
        priority: 7,
        reason: "Reforço defensivo (já tem tank)",
      };
    }

    if (name === "Luminarch Sanctum Protector") {
      // Sanctum Protector é o tank definitivo - 2800 DEF + negar ataque
      if (!hasTank) {
        return {
          yes: true,
          position: "defense",
          priority: 11,
          reason: "Wall máximo - 2800 DEF + negar ataque",
        };
      }
      // Combo com Aegis: pode usar SS effect
      const hasAegis = analysis.field.some(
        (c) => c && c.name === "Luminarch Aegisbearer"
      );
      if (hasAegis) {
        return {
          yes: true,
          position: "defense",
          priority: 9,
          reason: "SS grátis via Aegis (wall supremo)",
        };
      }
      return {
        yes: true,
        position: "defense",
        priority: 6,
        reason: "Tank extra (já estável)",
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SEARCHERS - CONTEXTUAIS
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Sanctified Arbiter") {
      // ═══════════════════════════════════════════════════════════════════════
      // CRÍTICO: Arbiter DEVE ser invocado face-UP (attack) para ativar busca!
      // Face-down = sem trigger = valor perdido. O search vale mais que DEF.
      // ═══════════════════════════════════════════════════════════════════════

      // Arbiter busca SPELL/TRAP - priorizar se não temos field spell
      if (!hasFieldSpell) {
        return {
          yes: true,
          position: "attack", // SEMPRE attack para buscar!
          priority: 10,
          reason:
            "Buscar Sanctum Citadel (field spell core!) - FACE-UP para trigger",
        };
      }
      // Já tem field spell - buscar proteção se não temos
      const hasProtection = (analysis.hand || []).some(
        (c) =>
          c &&
          (c.name === "Luminarch Holy Shield" ||
            c.name === "Luminarch Crescent Shield")
      );
      if (!hasProtection) {
        return {
          yes: true,
          position: "attack", // SEMPRE attack para buscar!
          priority: 7,
          reason: "Buscar spell de proteção - FACE-UP para trigger",
        };
      }
      // Low priority se já temos setup (mas ainda busca algo útil)
      return {
        yes: true,
        position: "attack", // SEMPRE attack para buscar!
        priority: 4,
        reason: "Buscar spell utility",
      };
    }

    if (name === "Luminarch Valiant - Knight of the Dawn") {
      // Valiant busca MONSTRO Lv4- (geralmente Aegisbearer ou Arbiter)

      // CRITICAL: Se não temos field spell E não temos Arbiter na mão,
      // preferir invocar Arbiter primeiro (se tiver) ou aceitar Valiant como plano B
      const currentTurn = analysis.currentTurn || 1;
      const isVeryEarly = currentTurn <= 2;

      if (!hasFieldSpell && isVeryEarly) {
        const hasArbiterInHand = (analysis.hand || []).some(
          (c) => c && c.name === "Luminarch Sanctified Arbiter"
        );

        // Se temos Arbiter na mão, preferir invocar ele ao invés de Valiant
        if (hasArbiterInHand) {
          return {
            yes: false,
            reason:
              "T1-2: Tenho Arbiter na mão - invocar ele primeiro (busca field spell)",
          };
        }

        // Se não temos Arbiter nem Citadel, invocar Valiant é aceitável
        // (buscar Aegisbearer é melhor que passar o turno sem fazer nada)
      }

      // Se não temos tank, Valiant pode buscar Aegisbearer
      // ═══════════════════════════════════════════════════════════════════════
      // CRÍTICO: Valiant DEVE ser invocado face-UP (attack) para ativar busca!
      // Face-down = sem trigger = valor perdido. O search vale mais que DEF.
      // ═══════════════════════════════════════════════════════════════════════
      if (!hasTank && isEarlyGame) {
        const hasAegisInHand = (analysis.hand || []).some(
          (c) => c && c.name === "Luminarch Aegisbearer"
        );
        if (hasAegisInHand) {
          // Já temos Aegis na mão, não precisamos de Valiant
          return {
            yes: false,
            reason: "Já tenho Aegisbearer na mão - invocar ele primeiro",
          };
        }
        // Não temos Aegis - Valiant busca - SEMPRE attack para trigger!
        return {
          yes: true,
          position: "attack", // SEMPRE attack para buscar!
          priority: 7,
          reason: "Buscar Aegisbearer (setup) - FACE-UP para trigger",
        };
      }

      // Mid/late game: Valiant é bom para manter recursos
      if (hasTank) {
        return {
          yes: true,
          position: "attack",
          priority: 5,
          reason: "Buscar monstro (já estável)",
        };
      }

      // Fallback: ainda busca algo útil
      return {
        yes: true,
        position: "attack", // SEMPRE attack para buscar!
        priority: 4,
        reason: "Searcher conservador",
      };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // BEATERS - SÓ QUANDO SEGURO
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Celestial Marshal") {
      // Marshal é 2500 ATK / 2300 DEF com proteção de batalha
      const isSafeAttack = (card.atk || 2500) > oppStrongest + 100;
      const isSafeDefense = (card.def || 2300) >= oppStrongest - 200;

      // CRITICAL: Se opp tem ameaças fortes e não temos defesa, não suicide
      if (oppStrongest >= 2600 && !hasTank) {
        return {
          yes: false,
          reason: `Oponente tem ${oppStrongest} ATK - preciso de tank primeiro`,
        };
      }

      return {
        yes: true,
        position: isSafeAttack ? "attack" : "defense",
        priority: isSafeAttack ? 7 : 5,
        reason: isSafeAttack
          ? "Boss beater 2500 ATK (seguro)"
          : "Defense até limpar board",
      };
    }

    if (name === "Luminarch Radiant Lancer") {
      const isSafe = (card.atk || 2600) > oppStrongest;
      const hasSnowball = analysis.field.some(
        (c) => c && c.cardKind === "monster" && c.position === "attack"
      );

      // Lancer ganha ATK ao destruir - avaliar potencial
      if (isSafe && hasSnowball) {
        return {
          yes: true,
          position: "attack",
          priority: 6,
          reason: "Beater 2600 ATK (snowball após destroy)",
        };
      }

      return {
        yes: true,
        position: isSafe ? "attack" : "defense",
        priority: 4,
        reason: isSafe ? "Beater 2600 ATK" : "Defense position",
      };
    }

    if (name === "Luminarch Aurora Seraph") {
      // Seraph é 2800 ATK / 2400 DEF + heal on summon
      const isSafe = (card.atk || 2800) > oppStrongest + 100;
      return {
        yes: true,
        position: isSafe ? "attack" : "defense",
        priority: isSafe ? 7 : 5,
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

    // EMERGENCY FALLBACK: Campo vazio T1-2 e monstro Lv4- = SEMPRE summon em DEF
    // Previne situação onde bot tem monstros na mão mas gera 0 actions
    const currentTurn = analysis.currentTurn || 1;
    const isVeryEarly = currentTurn <= 2;
    const isLowLevel = (card.level || 0) <= 4;

    if (analysis.field.length === 0 && isVeryEarly && isLowLevel) {
      return {
        yes: true,
        position: "defense",
        priority: 9,
        reason:
          "EMERGENCY T1-2: Campo vazio + Lv4- = summon em DEF (melhor que passar turno vazio)",
      };
    }

    // EMERGENCY FALLBACK geral: Campo vazio = SEMPRE summon
    if (analysis.field.length === 0 && isLowLevel) {
      return {
        yes: true,
        position: "defense",
        priority: 8,
        reason: "EMERGENCY: Campo vazio, summon para não passar turno vazio",
      };
    }

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

// ═══════════════════════════════════════════════════════════════════════════
// REPLAY INSIGHTS INTEGRATION (v4)
// Ajusta scores baseado em dados de replays com guardrails
// ═══════════════════════════════════════════════════════════════════════════

// Cache de insights para evitar queries repetidas
let _insightsCache = null;
let _insightsCacheTime = 0;
const INSIGHTS_CACHE_TTL = 60000; // 1 minuto

/**
 * Obtém modificador de score baseado em insights de replays
 * Com guardrails: caps, confidence check, feature flag
 *
 * @param {Object} action - { type, card, cardId, cardName, ... }
 * @param {Object} gameState - Estado atual do jogo
 * @returns {number} Modificador entre -0.1 e +0.1 (±10%)
 */
export async function getReplayModifier(action, gameState) {
  // 1. Check feature flag
  if (typeof localStorage !== "undefined") {
    const enabled = localStorage.getItem("shadow_duel_replay_insights");
    if (enabled !== "true") return 0;
  } else {
    return 0;
  }

  // 2. Lazy load insights (evita import circular)
  let replayInsights;
  try {
    const module = await import("../replay/ReplayInsights.js");
    replayInsights = module.replayInsights;
  } catch (e) {
    console.warn(
      "[getReplayModifier] Não foi possível carregar ReplayInsights:",
      e.message
    );
    return 0; // Fallback: sem modificação
  }

  // 3. Try get insight (com fallback)
  let insight;
  try {
    insight = await replayInsights.getActionInsight(action, {
      playerArchetype: "Luminarch",
      opponentArchetype: gameState?.opponentArchetype,
      lpDiff: (gameState?.playerLP || 8000) - (gameState?.opponentLP || 8000),
    });
  } catch (e) {
    console.warn("[getReplayModifier] Erro ao consultar insights:", e.message);
    return 0; // Fallback: sem modificação
  }

  // 4. Validate confidence
  if (!insight || insight.sampleSize < 5 || insight.confidence < 0.6) {
    return 0;
  }

  // 5. Apply with cap (±10% máximo)
  const rawModifier = insight.value; // -1.0 to +1.0
  const cappedModifier = Math.max(-0.1, Math.min(0.1, rawModifier * 0.1));

  if (Math.abs(cappedModifier) > 0.01) {
    console.log(
      `[ReplayInsights] Action ${action.type}:${
        action.card?.name || action.cardId
      } → modifier: ${(cappedModifier * 100).toFixed(1)}% (confidence: ${(
        insight.confidence * 100
      ).toFixed(0)}%, samples: ${insight.sampleSize})`
    );
  }

  return cappedModifier;
}

/**
 * Versão síncrona que usa cache (para uso em hot paths)
 * @param {Object} action
 * @param {Object} gameState
 * @returns {number}
 */
export function getReplayModifierSync(action, gameState) {
  // Feature flag check
  if (typeof localStorage !== "undefined") {
    const enabled = localStorage.getItem("shadow_duel_replay_insights");
    if (enabled !== "true") return 0;
  }

  // Se não tem cache válido, retorna 0 (versão async vai preencher depois)
  const now = Date.now();
  if (!_insightsCache || now - _insightsCacheTime > INSIGHTS_CACHE_TTL) {
    return 0;
  }

  // Tentar usar cache
  const cacheKey = `${action.type}_${action.card?.name || action.cardId}`;
  const cached = _insightsCache.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  return 0;
}

/**
 * Pré-carrega insights comuns para cache
 * @param {string} archetype
 */
export async function preloadReplayInsights(archetype = "Luminarch") {
  if (typeof localStorage !== "undefined") {
    const enabled = localStorage.getItem("shadow_duel_replay_insights");
    if (enabled !== "true") return;
  }

  try {
    const module = await import("../replay/ReplayInsights.js");
    const replayInsights = module.replayInsights;

    // Pré-carregar top cards
    const topCards = await replayInsights.getTopCardsByWinRate(
      { archetype },
      20
    );

    _insightsCache = new Map();
    for (const card of topCards) {
      const modifier = Math.max(
        -0.1,
        Math.min(0.1, (card.winRate - 0.5) * 0.2)
      );
      _insightsCache.set(`summon_${card.cardName}`, modifier);
      _insightsCache.set(`effect_${card.cardName}`, modifier);
    }

    _insightsCacheTime = Date.now();
    console.log(`[ReplayInsights] Cache preloaded: ${topCards.length} cards`);
  } catch (e) {
    console.warn("[preloadReplayInsights] Erro:", e.message);
  }
}
