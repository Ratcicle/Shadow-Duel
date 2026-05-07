// Luminarch monster summon priority decisions.

import { CARD_KNOWLEDGE, isLuminarch } from "./knowledge.js";
import { getVisibleAtk } from "../common/cardStats.js";
import {
  getBattleStatForTarget,
  hasLoggedPriorityError,
  isDefensiveLuminarch,
  markPriorityErrorLogged,
} from "./priorityShared.js";
import { evaluateRadiantLancerBattlePlan } from "./lancerPlanning.js";

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
    const hasSanctumProtectorInHand = analysis.hand.some(
      (c) => c && c.name === "Luminarch Sanctum Protector"
    );
    const hasFieldSpell = !!analysis.fieldSpell;
    const hasAegisInHand = analysis.hand.some(
      (c) => c && c.name === "Luminarch Aegisbearer"
    );
    const hasProtection = [
      ...(analysis.hand || []),
      ...(analysis.spellTrap || []),
    ].some(
      (c) =>
        c &&
        (c.name === "Luminarch Holy Shield" ||
          c.name === "Luminarch Crescent Shield" ||
          c.name === "Luminarch Moonlit Blessing")
    );
    const oppMonsterCount = (analysis.oppField || []).filter(
      (c) => c && c.cardKind === "monster"
    ).length;
    const underHeavyPressure = oppStrongest >= 2200 || oppMonsterCount >= 2;
    const shouldAvoidExposedSearcher =
      underHeavyPressure && !hasTank && !hasProtection;

    // ═════════════════════════════════════════════════════════════════════════
    // TANKS - PRIORIDADE MÁXIMA NO EARLY GAME
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Aegisbearer") {
      // Aegisbearer é SEMPRE prioridade máxima se não temos tank
      if (!hasTank) {
        const opensProtectorLine = hasSanctumProtectorInHand;
        return {
          yes: true,
          position: opensProtectorLine ? "attack" : "defense",
          priority: 12, // Máxima prioridade
          reason: opensProtectorLine
            ? "Abrir face-up para descer Sanctum Protector imediatamente"
            : "Setup defensivo CRÍTICO - baixar Aegisbearer para sobreviver e virar depois",
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
        if (
          shouldAvoidExposedSearcher &&
          (hasAegisInHand || hasSanctumProtectorInHand || oppStrongest >= 2400)
        ) {
          return {
            yes: false,
            reason:
              "Board inimigo forte: priorizar tank/protecao antes de expor Arbiter",
          };
        }
        return {
          yes: true,
          position: "attack", // SEMPRE attack para buscar!
          priority: shouldAvoidExposedSearcher ? 4 : 10,
          reason:
            "Buscar Sanctum Citadel (field spell core!) - FACE-UP para trigger",
        };
      }
      // Já tem field spell - buscar proteção se não temos
      const hasProtectionInHand = (analysis.hand || []).some(
        (c) =>
          c &&
          (c.name === "Luminarch Holy Shield" ||
            c.name === "Luminarch Crescent Shield")
      );
      if (!hasProtectionInHand) {
        if (
          shouldAvoidExposedSearcher &&
          (hasAegisInHand || hasSanctumProtectorInHand)
        ) {
          return {
            yes: false,
            reason:
              "Board inimigo forte: proteger campo antes de buscar utility com Arbiter",
          };
        }
        return {
          yes: true,
          position: "attack", // SEMPRE attack para buscar!
          priority: shouldAvoidExposedSearcher ? 3 : 7,
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
          priority: shouldAvoidExposedSearcher ? 3 : 7,
          reason: shouldAvoidExposedSearcher
            ? "Buscar Aegisbearer, mas com risco alto de expor Valiant"
            : "Buscar Aegisbearer (setup) - FACE-UP para trigger",
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
      const lancerPlan = evaluateRadiantLancerBattlePlan(card, analysis);
      const lancerAtk = getVisibleAtk(card) || card.atk || 2600;
      const oppStrongestBattleStat = Math.max(
        ...(analysis.oppField || []).map((monster) =>
          getBattleStatForTarget(monster)
        ),
        0,
      );
      const isSafeAttacker = lancerAtk > oppStrongestBattleStat;
      const hasDefensiveField = analysis.field.some(
        (c) => c && c.cardKind === "monster" && isDefensiveLuminarch(c)
      );

      if (lancerPlan.hasLine && lancerPlan.improvesThreatMatchup) {
        const priority = lancerPlan.survivesNextThreat
          ? 8
          : lancerPlan.tradesNextThreat
            ? 7
            : 6;
        return {
          yes: true,
          position: "attack",
          priority,
          reason: lancerPlan.reason,
          lancerPlan,
        };
      }

      if (isSafeAttacker) {
        return {
          yes: true,
          position: "attack",
          priority: 5,
          reason: "Radiant Lancer can attack over current visible threats",
          lancerPlan,
        };
      }

      if (hasDefensiveField) {
        return {
          yes: false,
          reason: "Hold Radiant Lancer: defensive field is better than a no-payoff summon",
          lancerPlan,
        };
      }

      if (fieldCount === 0 && oppStrongestBattleStat > 0) {
        return {
          yes: true,
          position: "defense",
          priority: 2,
          reason: "Emergency body only: no defensive field available",
          lancerPlan,
        };
      }

      return {
        yes: false,
        reason: "Hold Radiant Lancer until it has a real offensive line",
        lancerPlan,
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
    if (!hasLoggedPriorityError(errorKey)) {
      markPriorityErrorLogged(errorKey);
      console.error(
        `[shouldSummonMonster] ERRO ao avaliar ${card?.name}:`,
        e.message
      );
    }
    return { yes: false, reason: `Erro interno: ${e.message}` };
  }
}
