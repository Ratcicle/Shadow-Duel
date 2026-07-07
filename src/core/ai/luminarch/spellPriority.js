// Luminarch spell priority decisions.

import { CARD_KNOWLEDGE, isLuminarch } from "./knowledge.js";
import { evaluateFieldSpellUrgency } from "./cardValue.js";
import { estimateOffensiveTemporaryBuffValue } from "../StrategyUtils.js";
import {
  getBattleReadyLuminarchAttackers,
  hasLoggedPriorityError,
  markPriorityErrorLogged,
} from "./priorityShared.js";
import { getMoonlitTargetPlan } from "./moonlitPlanning.js";
import { evaluateKnightsConvocationPlan } from "./defensePlanning.js";
import {
  assessLuminarchResourceRecovery,
  getLuminarchResourcePressure,
} from "./resourceEconomy.js";
import {
  evaluateLuminarchProtectionSpell,
  evaluateLuminarchRemovalSpell,
} from "./defensePolicy.js";

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
    const resourcePressure = getLuminarchResourcePressure(analysis);

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

    const protectionDecision = evaluateLuminarchProtectionSpell(card, analysis);
    if (protectionDecision) return protectionDecision;
    // RECURSÃO
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Moonlit Blessing") {
      const gyLuminarch = (analysis.graveyard || []).filter(
        (c) => c && isLuminarch(c)
      );
      const hasCitadel =
        analysis.fieldSpell?.name?.includes("Citadel") ?? false;
      const recoveryValue = assessLuminarchResourceRecovery(analysis, {
        mode: "moonlit_blessing",
      });

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
          priority:
            (plan.purpose === "stabilize" ? 14 : 12) +
            recoveryValue.scoreDelta,
          reason: `COM CITADEL: recuperar ${plan.target.name} para ${plan.purpose} em ${plan.position}`,
        };
      }

      // SEM CITADEL: ainda útil para mão
      if (gyLuminarch.length >= 2) {
        return {
          yes: true,
          priority: 7 + recoveryValue.scoreDelta,
          reason: `Add da GY para mão (${gyLuminarch.length} opções)`,
        };
      }

      return { yes: false, reason: "Poucas opções na GY ainda" };
    }

    // ═════════════════════════════════════════════════════════════════════════
    // REMOVAL
    // ═════════════════════════════════════════════════════════════════════════

    const removalDecision = evaluateLuminarchRemovalSpell(card, analysis);
    if (removalDecision) return removalDecision;
    // BUFF
    // ═════════════════════════════════════════════════════════════════════════

    if (name === "Luminarch Holy Ascension") {
      const phase = analysis.phase || analysis.game?.phase || "main1";
      if (phase !== "main1") {
        return {
          yes: false,
          reason: "Holy Ascension segurada: buff temporario sem Battle Phase futura",
        };
      }

      const attackers = getBattleReadyLuminarchAttackers(analysis);
      if (attackers.length === 0) {
        return {
          yes: false,
          reason: "Sem atacante Luminarch em Ataque para aproveitar o buff",
        };
      }

      const lpForHolyAscension = analysis.lp || 8000;
      const finalLpAfterHolyAscension = lpForHolyAscension - 1000;
      if (finalLpAfterHolyAscension <= 0) {
        return { yes: false, reason: "LP insuficiente (custo 1000 LP)" };
      }

      const bestBuffLine = attackers
        .map((attacker) => ({
          attacker,
          score: estimateOffensiveTemporaryBuffValue(attacker, {
            atkBoost: 800,
            opponentField: analysis.oppField || [],
            opponentLp: analysis.oppLp || 0,
          }),
        }))
        .sort((a, b) => b.score - a.score)[0] || { attacker: null, score: 0 };
      const totalAtkNow = attackers.reduce(
        (sum, m) => sum + (m.atk || 0) + (m.tempAtkBoost || 0),
        0
      );
      const directLethal =
        (analysis.oppField || []).length === 0 &&
        totalAtkNow < (analysis.oppLp || 0) &&
        totalAtkNow + 800 >= (analysis.oppLp || 0);
      if (
        lpForHolyAscension <= 3000 &&
        !directLethal &&
        bestBuffLine.score < 100
      ) {
        return {
          yes: false,
          reason: "LP baixo: Holy Ascension exige payoff real",
        };
      }
      if (directLethal) {
        return {
          yes: true,
          priority: 15,
          reason: "LETHAL: Holy Ascension habilita dano direto suficiente",
        };
      }
      if (bestBuffLine.score >= 80) {
        return {
          yes: true,
          priority: bestBuffLine.score >= 100 ? 12 : 8,
          reason: `Buff em ${bestBuffLine.attacker.name} abre combate real`,
        };
      }

      return {
        yes: false,
        reason: "Holy Ascension segurada: buff nao muda nenhum combate",
      };
    }

    if (name === "Luminarch Knights Convocation") {
      return evaluateKnightsConvocationPlan(analysis);
    }

    if (name === "Luminarch Sacred Judgment") {
      const myField = analysis.field.length;
      const oppField = (analysis.oppField || []).length;
      const openMonsterZones = Math.max(0, 5 - myField);
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
      const recoveryValue = assessLuminarchResourceRecovery(analysis, {
        mode: "sacred_judgment",
      });

      // === SITUAÇÃO CRÍTICA: opp domina e GY converte em campo ===
      // Precisa: opp 2+, LP >= 2500 (sobra 500 após custo), GY com recursos
      if (
        oppField >= 2 &&
        openMonsterZones > 0 &&
        lp >= 2500 &&
        gyLuminarch.length >= 2
      ) {
        // Calcular power swing potencial
        const potentialSummons = Math.min(gyLuminarch.length, oppField, openMonsterZones, 5);
        const lpGain = potentialSummons * 500; // heal de volta
        const netLpCost = 2000 - lpGain; // custo real após heal
        const finalLp = lp - netLpCost;

        // Avaliar se é worth it
        const isCritical = oppField >= 3 || oppLp > lp + 2000 || oppField > myField; // opp domina
        const hasQuality = highValueMonsters >= 1; // pelo menos 1 bom monstro
        const survives = finalLp >= 1000; // sobrevive após custo

        if (isCritical && hasQuality && survives) {
          // Prioridade MUITO ALTA: é carta de comeback
          const priority =
            (oppField >= 4 ? 19 : oppField >= 3 ? 17 : 15) +
            recoveryValue.scoreDelta;
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
            priority: 13 + recoveryValue.scoreDelta,
            reason: `Comeback: SS ${potentialSummons} monstros da GY (LP final: ${finalLp})`,
          };
        }
      }

      // Bloquear: não é situação de desperation ou muito arriscado
      if (openMonsterZones <= 0) {
        return { yes: false, reason: "Sem zona de monstro livre para converter Sacred Judgment" };
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
        return {
          yes: false,
          reason: resourcePressure.shouldRecover
            ? "GY ainda nao tem recursos suficientes para comeback"
            : "GY sem recursos (precisa 2+ Luminarch)",
        };
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
