// Luminarch spell priority decisions.

import { CARD_KNOWLEDGE, isLuminarch } from "./knowledge.js";
import {
  evaluateCardExpendability,
  evaluateFieldSpellUrgency,
} from "./cardValue.js";
import { getVisibleAtk, getVisibleDef } from "../common/cardStats.js";
import {
  getBattleReadyLuminarchAttackers,
  getBestTemporaryCombatDebuffTarget,
  hasLoggedPriorityError,
  markPriorityErrorLogged,
} from "./priorityShared.js";
import { getMoonlitTargetPlan } from "./moonlitPlanning.js";
import { evaluateKnightsConvocationPlan } from "./defensePlanning.js";

function isProtectedLuminarchCost(card) {
  const name = card?.name || "";
  return (
    name === "Luminarch Aegisbearer" ||
    name === "Luminarch Sanctum Protector" ||
    name === "Luminarch Fortress Aegis" ||
    name === "Luminarch Aurora Seraph" ||
    (name === "Luminarch Radiant Lancer" &&
      ((card.atk || 0) > 2200 || card.hasAttacked))
  );
}

function getRemovalCostScore(card, analysis) {
  const expendability = evaluateCardExpendability(card, {
    hand: analysis.hand || [],
    field: analysis.field || [],
    graveyard: analysis.graveyard || [],
    fieldSpell: analysis.fieldSpell || null,
    usedEffects: analysis.usedEffects || [],
  });

  let score = expendability.value ?? 5;
  if (expendability.expendable) score -= 2;
  if (card.usedEffectThisTurn || card.hasAttacked) score -= 1.25;
  if (card.name === "Luminarch Enchanted Halberd") score -= 1.5;
  if (card.name === "Luminarch Magic Sickle") score -= 1.25;
  if (isProtectedLuminarchCost(card)) score += 4;
  if (card.mustBeAttacked) score += 2;
  if (getVisibleDef(card) >= 2500) score += 1.5;
  return score;
}

function getRemovalTargetScore(card, analysis) {
  if (!card) return 0;
  const atk = getVisibleAtk(card);
  const def = getVisibleDef(card);
  let score = Math.max(atk, def) / 450;
  if (atk >= 2500 || def >= 2500) score += 1.5;
  if (atk >= 3000) score += 2.5;
  if ((card.name || "").includes("Extreme Dragon")) score += 3;
  if (card.monsterType === "fusion" || card.monsterType === "ascension") {
    score += 1.5;
  }
  if (card.mustBeAttacked || card.battleIndestructibleOncePerTurn) score += 1;

  const oppTotalAtk = (analysis.oppField || []).reduce(
    (sum, monster) => sum + getVisibleAtk(monster),
    0,
  );
  if (oppTotalAtk >= (analysis.lp || 8000) && atk >= 2000) score += 2;
  return score;
}

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
        const plan = getMoonlitTargetPlan(analysis);
        if (!plan.target) {
          return { yes: false, reason: "Sem monstro Luminarch valido na GY" };
        }

        return {
          yes: true,
          priority: plan.purpose === "stabilize" ? 14 : 12,
          reason: `COM CITADEL: recuperar ${plan.target.name} para ${plan.purpose} em ${plan.position}`,
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
          !c.isFacedown &&
          getVisibleAtk(c) >= 2000
      );
      const opponentTargets = (analysis.oppField || []).filter(
        (m) => m && m.cardKind === "monster" && !m.isFacedown
      );

      if (luminarch2kPlus.length > 0 && opponentTargets.length > 0) {
        const bestCost = luminarch2kPlus
          .map((card) => ({
            card,
            score: getRemovalCostScore(card, analysis),
          }))
          .sort((a, b) => a.score - b.score)[0];
        const bestTarget = opponentTargets
          .map((card) => ({
            card,
            score: getRemovalTargetScore(card, analysis),
          }))
          .sort((a, b) => b.score - a.score)[0];
        const oppTotalAtk = opponentTargets.reduce(
          (sum, card) => sum + getVisibleAtk(card),
          0
        );
        const targetAtk = getVisibleAtk(bestTarget?.card);
        const targetName = bestTarget?.card?.name || "opposing threat";
        const costName = bestCost?.card?.name || "Luminarch monster";
        const preventsLethal =
          oppTotalAtk >= (analysis.lp || 8000) && targetAtk >= 1800;
        const removesWinCondition =
          /Extreme Dragon|Bahamut|Galaxy|Malicious|Leviathan|Fire Extreme/i.test(
            targetName
          ) || bestTarget.score >= 9;
        const positiveTrade = bestTarget.score >= bestCost.score + 1.5;

        if (!positiveTrade && !preventsLethal && !removesWinCondition) {
          return {
            yes: false,
            reason: `Radiant Wave held: ${targetName} is not worth ${costName}`,
          };
        }

        return {
          yes: true,
          priority: preventsLethal || removesWinCondition ? 15 : 11,
          reason: `Destroy ${targetName} with preferred cost ${costName}`,
        };
      }

      return {
        yes: false,
        reason: "Sem material 2000+ ATK ou sem ameaças para remover",
      };
    }

    if (name === "Luminarch Spear of Dawnfall") {
      const attackers = getBattleReadyLuminarchAttackers(analysis);
      if (attackers.length === 0) {
        return {
          yes: false,
          reason: "Sem atacante Luminarch apto para aproveitar o debuff",
        };
      }

      const combatTarget = getBestTemporaryCombatDebuffTarget(analysis);
      return combatTarget.target && combatTarget.score > 0
        ? {
            yes: true,
            priority: combatTarget.score >= 100 ? 18 : 11,
            reason: `Spear em ${combatTarget.target.name}: janela real de combate`,
          }
        : {
            yes: false,
            reason: "Spear segurada: nenhum alvo gera ganho real de batalha",
          };

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
      return evaluateKnightsConvocationPlan(analysis);
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
    if (!hasLoggedPriorityError(errorKey)) {
      markPriorityErrorLogged(errorKey);
      console.error(
        `[shouldPlaySpell] ERRO ao avaliar ${card?.name}:`,
        e.message
      );
    }
    return { yes: false, reason: `Erro interno: ${e.message}` };
  }
}
