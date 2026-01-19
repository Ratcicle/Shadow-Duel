import BaseStrategy from "./BaseStrategy.js";
import {
  applySimulatedActions,
  estimateCardValue,
  estimateMonsterValue,
  hasArchetype,
  selectSimulatedTargets,
} from "./StrategyUtils.js";
import {
  detectLethalOpportunity,
  detectDefensiveNeed,
  detectComeback,
  decideMacroStrategy,
  calculateMacroPriorityBonus,
} from "./MacroPlanning.js";
import {
  evaluateActionBlockingRisk,
  calculateBlockingRiskPenalty,
  assessActionSafety,
} from "./ChainAwareness.js";
import {
  gameTreeSearch,
  shouldUseGameTreeSearch,
  estimateSearchComplexity,
} from "./GameTreeSearch.js";
import {
  analyzeOpponent,
  predictOppAction,
  estimateTurnsToOppLethal,
} from "./OpponentPredictor.js";
import {
  isLuminarch,
  getCardKnowledge,
  getCardsByRole,
} from "./luminarch/knowledge.js";
import {
  shouldPlaySpell,
  shouldSummonMonster,
} from "./luminarch/priorities.js";
import {
  detectAvailableCombos,
  shouldExecuteCombo,
  shouldPrioritizeDefense,
  canAttemptLethal,
  shouldTurtleStrategy,
} from "./luminarch/combos.js";
import {
  evaluateGameStance,
  shouldCommitResourcesNow,
  planNextTurns,
} from "./luminarch/multiTurnPlanning.js";
import { evaluateFusionPriority } from "./luminarch/fusionPriority.js";
import {
  evaluateCardExpendability,
  evaluateFieldSpellUrgency,
  detectSacrificialProtection,
  evaluateRiskWithProtection,
} from "./luminarch/cardValue.js";

// Flag para logs detalhados de avaliação por carta (muito verboso - ~6000 linhas/10 duelos)
// Desligar para logs mais limpos, ligar para debug de prioridades
const VERBOSE_EVAL = false;

export default class LuminarchStrategy extends BaseStrategy {
  evaluateBoard(gameOrState, perspectivePlayer) {
    const perspective = perspectivePlayer?.id
      ? perspectivePlayer
      : gameOrState.bot;
    const opponent = this.getOpponent(gameOrState, perspective);
    const archetype = "Luminarch";
    const fieldSpell = perspective?.fieldSpell || null;
    const preferDefense = true;

    let score = 0;
    score += ((perspective?.lp || 0) - (opponent?.lp || 0)) / 900;

    const ownMonstersValue = (perspective?.field || []).reduce(
      (sum, monster) =>
        sum +
        estimateMonsterValue(monster, {
          archetype,
          fieldSpell,
          preferDefense,
        }),
      0,
    );
    const oppMonstersValue = (opponent?.field || []).reduce(
      (sum, monster) =>
        sum +
        estimateMonsterValue(monster, {
          fieldSpell: opponent?.fieldSpell || null,
          preferDefense: false,
        }),
      0,
    );
    score += ownMonstersValue - oppMonstersValue;

    const opponentStrongest = (opponent?.field || []).reduce((max, monster) => {
      if (!monster || monster.cardKind !== "monster" || monster.isFacedown) {
        return max;
      }
      return Math.max(max, monster.atk || 0);
    }, 0);
    const exposedAttackers = (perspective?.field || []).filter(
      (monster) =>
        monster &&
        monster.cardKind === "monster" &&
        monster.position === "attack" &&
        (monster.atk || 0) + (monster.tempAtkBoost || 0) <
          Math.max(500, opponentStrongest - 200),
    ).length;
    score -= exposedAttackers * 0.25;

    const tauntValue = (perspective?.field || []).reduce((sum, monster) => {
      if (!monster || !monster.mustBeAttacked) return sum;
      return sum + (monster.def || 0) / 2000 + 0.3;
    }, 0);
    score += tauntValue;

    const overfillPenalty =
      Math.max(0, (perspective?.field || []).length - 3) * 0.3;
    score -= overfillPenalty;

    score += fieldSpell ? 0.9 : 0;
    score -= opponent?.fieldSpell ? 0.6 : 0;

    score += (perspective?.spellTrap || []).length * 0.2;
    score -= (opponent?.spellTrap || []).length * 0.15;

    score +=
      ((perspective?.hand || []).length - (opponent?.hand || []).length) * 0.25;

    const handValue = (perspective?.hand || []).reduce(
      (sum, card) =>
        sum +
        estimateCardValue(card, {
          archetype,
          fieldSpell,
          preferDefense,
        }),
      0,
    );
    score += handValue * 0.2;

    const gyValue = (perspective?.graveyard || []).reduce((sum, card) => {
      if (!card || card.cardKind !== "monster") return sum;
      if (!hasArchetype(card, archetype)) return sum;
      const value = (card.atk || 0) / 2000 + (card.level || 0) * 0.08;
      return sum + value;
    }, 0);
    score += gyValue * 0.2;

    if ((perspective?.field || []).length === 0 && opponentStrongest > 0) {
      score -= 0.4;
    }

    return score;
  }

  evaluateBoardV2(gameOrState, perspectivePlayer) {
    const perspective = perspectivePlayer?.id
      ? perspectivePlayer
      : gameOrState.bot;
    const opponent = this.getOpponent(gameOrState, perspective);
    if (!perspective || !opponent) return 0;

    const archetype = "Luminarch";
    const fieldSpell = perspective.fieldSpell || null;
    const preferDefense = true;

    const myLP = perspective.lp || 0;
    const oppLP = opponent.lp || 0;
    const myField = perspective.field || [];
    const oppField = opponent.field || [];
    const myBackrow = perspective.spellTrap || [];
    const oppBackrow = opponent.spellTrap || [];
    const myHand = perspective.hand || [];
    const oppHand = opponent.hand || [];
    const myGY = perspective.graveyard || [];

    let score = 0;

    // LP matters more for a defensive/control archetype.
    score += (myLP - oppLP) / 550;
    if (myLP <= 2000) score -= 3.2;
    else if (myLP <= 3000) score -= 2.0;
    else if (myLP <= 4000) score -= 1.0;
    if (oppLP <= 2000) score += 2.0;
    else if (oppLP <= 3000) score += 1.0;

    const ownMonstersValue = myField.reduce(
      (sum, monster) =>
        sum +
        estimateMonsterValue(monster, {
          archetype,
          fieldSpell,
          preferDefense,
        }),
      0,
    );
    const oppMonstersValue = oppField.reduce(
      (sum, monster) =>
        sum +
        estimateMonsterValue(monster, {
          fieldSpell: opponent.fieldSpell || null,
          preferDefense: false,
        }),
      0,
    );
    score += ownMonstersValue - oppMonstersValue * 0.9;

    const opponentStrongestAtk = oppField.reduce((max, monster) => {
      if (!monster || monster.cardKind !== "monster") return max;
      const atk = monster.isFacedown ? 1500 : monster.atk || 0;
      return Math.max(max, atk);
    }, 0);

    const myStrongestDef = myField.reduce((max, monster) => {
      if (!monster || monster.cardKind !== "monster") return max;
      const def =
        (monster.def || 0) +
        (monster.tempDefBoost || 0) +
        (monster.equipDefBonus || 0);
      return Math.max(max, def);
    }, 0);

    const defenseCount = myField.filter(
      (monster) =>
        monster &&
        monster.cardKind === "monster" &&
        monster.position === "defense",
    ).length;
    score += defenseCount * 0.25;

    const tauntWalls = myField.filter(
      (monster) =>
        monster &&
        monster.cardKind === "monster" &&
        !monster.isFacedown &&
        monster.mustBeAttacked,
    );
    if (tauntWalls.length > 0) {
      const bestTauntDef = tauntWalls.reduce((max, monster) => {
        const def = (monster.def || 0) + (monster.tempDefBoost || 0);
        return Math.max(max, def);
      }, 0);
      score += opponentStrongestAtk > 0 ? 0.6 : 0.2;
      if (opponentStrongestAtk > 0) {
        if (bestTauntDef >= opponentStrongestAtk) score += 0.6;
        else if (bestTauntDef >= opponentStrongestAtk - 300) score += 0.3;
      }
    }

    if (myStrongestDef > 0 && opponentStrongestAtk > 0) {
      if (myStrongestDef >= opponentStrongestAtk + 300) score += 0.7;
      else if (myStrongestDef >= opponentStrongestAtk) score += 0.4;
    }

    const exposedAttackers = myField.filter((monster) => {
      if (!monster || monster.cardKind !== "monster") return false;
      if (monster.position !== "attack") return false;
      const atk = (monster.atk || 0) + (monster.tempAtkBoost || 0);
      return atk < Math.max(500, opponentStrongestAtk - 200);
    }).length;
    score -= exposedAttackers * 0.45;

    const hasCitadel = fieldSpell?.name?.includes("Citadel") ?? false;
    if (fieldSpell) {
      score += hasCitadel ? 1.4 : 0.6;
    }
    if (hasCitadel) {
      const luminarchCount = myField.filter((c) => c && isLuminarch(c)).length;
      score += Math.min(1.2, luminarchCount * 0.2);
      if (myField.some((c) => c && c.name === "Luminarch Aegisbearer")) {
        score += 0.8;
      }
      if (myField.some((c) => c && c.name === "Luminarch Fortress Aegis")) {
        score += 0.6;
      }
      if (
        myField.some((c) => c && c.name === "Luminarch Megashield Barbarias")
      ) {
        score += 0.5;
      }
    }

    // SIMULATION BONUS: Searchers que buscaram cartas
    // Valiant que buscou Aegis = +1.5 (Aegis é peça core do arquétipo)
    const searchedAegis = myField.some((c) => c && c._searchedAegis);
    if (searchedAegis) {
      score += 1.5;
    }
    // Arbiter que buscou spell = +1.0 (spell utility/field spell)
    const searchedSpell = myField.some((c) => c && c._searchedSpell);
    if (searchedSpell) {
      score += 1.0;
    }

    if (opponent.fieldSpell) score -= 0.9;

    score += myBackrow.length * 0.35;
    score -= oppBackrow.length * 0.25;

    score += (myHand.length - oppHand.length) * 0.3;
    const handValue = myHand.reduce(
      (sum, card) =>
        sum +
        estimateCardValue(card, {
          archetype,
          fieldSpell,
          preferDefense,
        }),
      0,
    );
    score += handValue * 0.12;

    const gyLuminarch = myGY.filter(
      (card) => card && card.cardKind === "monster" && isLuminarch(card),
    );
    score += gyLuminarch.length * 0.18;
    if (gyLuminarch.length >= 2) score += 0.35;

    const hasLuminarchOnField = myField.some(
      (card) => card && isLuminarch(card),
    );
    const hasHolyShieldInHand = myHand.some(
      (card) => card && card.name === "Luminarch Holy Shield",
    );
    const hasHolyShieldSet = myBackrow.some(
      (card) =>
        card && card.name === "Luminarch Holy Shield" && card.isFacedown,
    );
    const hasCrescentShield = myBackrow.some(
      (card) => card && card.name === "Luminarch Crescent Shield",
    );
    if (hasLuminarchOnField && (hasHolyShieldInHand || hasHolyShieldSet)) {
      score += 0.6;
    }
    if (hasLuminarchOnField && hasCrescentShield) score += 0.3;

    const overfillPenalty = Math.max(0, myField.length - 3) * 0.35;
    score -= overfillPenalty;

    if (myField.length === 0 && oppField.length > 0) {
      score -= 2.6;
    } else if (oppField.length === 0 && myField.length > 0) {
      score += 0.6;
    }

    return score;
  }

  generateMainPhaseActions(game) {
    const actions = [];
    const bot = this.bot;
    const opponent = this.getOpponent(game, bot);
    const activationContext = {
      autoSelectSingleTarget: true,
      logTargets: false,
    };
    const spellIndicesActivated = new Set();

    if (bot?.debug) {
      console.log(
        `\n[LuminarchStrategy] 🎴 Avaliando ${bot.hand.length} cartas na mão:`,
      );
      bot.hand.forEach((c, i) => {
        console.log(
          `  [${i}] ${c.name} (${c.cardKind}${
            c.cardKind === "monster"
              ? ` Lv${c.level || "?"}`
              : c.subtype
                ? ` ${c.subtype}`
                : ""
          })`,
        );
      });
    }

    // Declarar variáveis no escopo da função
    let gameStance = { stance: "balanced", reason: "default" };
    let turnPlan = { plan: ["Jogar normalmente"] };
    let fusionOpportunity = null;

    // === COMBO DETECTION ===
    try {
      const analysis = {
        hand: bot?.hand || [],
        field: bot?.field || [],
        fieldSpell: bot?.fieldSpell || null,
        graveyard: bot?.graveyard || [],
        extraDeck: bot?.extraDeck || [],
        lp: bot?.lp || 8000,
        oppField: opponent?.field || [],
        oppLp: opponent?.lp || 8000,
        currentTurn: game?.turnCounter || 1,
      };

      // === MULTI-TURN PLANNING ===
      gameStance = evaluateGameStance(analysis);
      turnPlan = planNextTurns(analysis);

      if (bot?.debug) {
        console.log(
          `[LuminarchStrategy] 🎯 Stance: ${gameStance.stance.toUpperCase()} - ${
            gameStance.reason
          }`,
        );
        console.log(`[LuminarchStrategy] 📋 Plano:`, turnPlan.plan[0]);
      }

      // === FUSION PRIORITY EVALUATION ===
      fusionOpportunity = evaluateFusionPriority({
        hand: analysis.hand,
        field: analysis.field,
        opponent: {
          field: analysis.oppField,
          lp: analysis.oppLp,
        },
      });

      if (fusionOpportunity && bot?.debug) {
        console.log(
          `[LuminarchStrategy] 🔮 Fusão detectada: ${fusionOpportunity.fusionName} - ${fusionOpportunity.decision.reason}`,
        );
      }

      const availableCombos = detectAvailableCombos(analysis);
      if (availableCombos.length > 0 && bot?.debug) {
        console.log(
          `[LuminarchStrategy] 🎯 Combos detectados:`,
          availableCombos.map((c) => `${c.name} (priority ${c.priority})`),
        );
      }

      // Detectar se deve priorizar defesa ou tentar lethal
      const shouldDefend = shouldPrioritizeDefense(analysis);
      const canLethal = canAttemptLethal(analysis);
      const turtleAnalysis = shouldTurtleStrategy(analysis);

      if (bot?.debug) {
        console.log(
          `[LuminarchStrategy] Situação: ${
            canLethal
              ? "⚔️ LETHAL POSSIBLE"
              : turtleAnalysis.shouldTurtle
                ? `🐢 TURTLE MODE: ${turtleAnalysis.reason}`
                : shouldDefend
                  ? "🛡️ DEFENSIVE"
                  : "⚖️ BALANCED"
          }`,
        );
      }
    } catch (e) {
      console.warn(
        `[LuminarchStrategy] Erro na detecção de combos:`,
        e.message,
        e.stack,
      );
    }

    // === P1: MACRO PLANNING ===
    const macroStrategy = this.evaluateMacroStrategy(game);

    // === P1: CHAIN AWARENESS ===
    const chainRisks = {
      spell: evaluateActionBlockingRisk(
        { bot, player: opponent },
        bot,
        opponent,
        "spell",
      ),
      summon: evaluateActionBlockingRisk(
        { bot, player: opponent },
        bot,
        opponent,
        "summon",
      ),
    };

    // === SUMMON ACTIONS ===
    if (bot.summonCount < 1) {
      bot.hand.forEach((card, index) => {
        if (card.cardKind !== "monster") return;
        const tributeInfo = this.getTributeRequirementFor(card, bot);
        if (VERBOSE_EVAL && bot?.debug) {
          console.log(
            `\n[LuminarchStrategy] 🔍 Avaliando monstro: ${card.name}`,
          );
          console.log(
            `  Tributos necessários: ${tributeInfo.tributesNeeded}, Field atual: ${bot.field.length}`,
          );
        }
        if (bot.field.length < tributeInfo.tributesNeeded) {
          if (VERBOSE_EVAL && bot?.debug) {
            console.log(
              `  ❌ REJEITADO: Tributos insuficientes (precisa ${tributeInfo.tributesNeeded}, tem ${bot.field.length})`,
            );
          }
          return;
        }
        const projectedFieldCount =
          (bot.field?.length || 0) - tributeInfo.tributesNeeded + 1;
        if (projectedFieldCount > 5) {
          if (VERBOSE_EVAL && bot?.debug) {
            console.log(
              `  ❌ REJEITADO: Sem espaço após tributos (${bot.field.length}/5)`,
            );
          }
          return;
        }

        // === SUICIDE CHECK ===
        const shouldSummon = this.shouldSummonMonsterSafely(
          card,
          game,
          opponent,
        );
        if (VERBOSE_EVAL && bot?.debug) {
          console.log(
            `  Safety check: ${
              shouldSummon.yes ? "✅ APROVADO" : "❌ REJEITADO"
            } - ${shouldSummon.reason || "sem motivo"}`,
          );
        }
        if (!shouldSummon.yes) return;

        const preferredPosition =
          shouldSummon.position || this.chooseSummonPosition(card, game);
        const facedown = this.shouldSetFacedown(card, preferredPosition);

        // === P1: Aplicar bônus de macro strategy ===
        let priority = shouldSummon.priority || 2;
        const macroBuff = calculateMacroPriorityBonus(
          "summon",
          card,
          macroStrategy,
        );
        priority += macroBuff;

        // === P1: Penalidade de chain risk ===
        const summonSafety = assessActionSafety(
          { bot, player: opponent },
          bot,
          opponent,
          "summon",
          card,
        );
        if (summonSafety.recommendation === "very_risky") {
          priority -= 10;
        }

        actions.push({
          type: "summon",
          index,
          cardId: card.id,
          position: preferredPosition,
          facedown,
          priority,
          cardName: card.name,
          macroBuff,
          safetyScore: summonSafety.riskScore,
        });
      });
    }

    // === SPECIAL SUMMON: SANCTUM PROTECTOR (Aegisbearer -> Protector) ===
    const protectorIndices = [];
    bot.hand.forEach((card, index) => {
      if (card && card.name === "Luminarch Sanctum Protector") {
        protectorIndices.push(index);
      }
    });

    if (protectorIndices.length > 0) {
      const aegisCandidates = (bot.field || [])
        .map((card, fieldIndex) => ({ card, fieldIndex }))
        .filter(
          (entry) =>
            entry.card &&
            entry.card.name === "Luminarch Aegisbearer" &&
            !entry.card.isFacedown,
        );

      const canCheckAscension =
        typeof game?.canUseAsAscensionMaterial === "function" &&
        typeof game?.getAscensionCandidatesForMaterial === "function" &&
        typeof game?.checkAscensionRequirements === "function";

      const isAscensionReady = (material) => {
        if (!canCheckAscension) return false;
        const check = game.canUseAsAscensionMaterial(bot, material);
        if (!check?.ok) return false;
        const candidates = game.getAscensionCandidatesForMaterial(
          bot,
          material,
        );
        if (!Array.isArray(candidates) || candidates.length === 0) return false;
        return candidates.some(
          (asc) => game.checkAscensionRequirements(bot, asc)?.ok,
        );
      };

      const usableAegis = aegisCandidates.filter(
        (entry) => !isAscensionReady(entry.card),
      );

      if (usableAegis.length > 0) {
        const chosenAegis = usableAegis[0];
        const protectorIndex = protectorIndices[0];
        const protectorCard = bot.hand[protectorIndex];

        const oppStrongest = (opponent?.field || []).reduce((max, monster) => {
          if (!monster || monster.cardKind !== "monster") return max;
          const atk = monster.isFacedown ? 1500 : monster.atk || 0;
          return Math.max(max, atk);
        }, 0);

        const hasOtherTank = (bot.field || []).some(
          (card) =>
            card &&
            card.cardKind === "monster" &&
            !card.isFacedown &&
            card.name !== "Luminarch Aegisbearer" &&
            ((card.def || 0) >= 2500 ||
              card.name === "Luminarch Sanctum Protector" ||
              card.name === "Luminarch Fortress Aegis"),
        );

        let priority = 7;
        if (!hasOtherTank) priority += 1;
        if (oppStrongest >= 2200) priority += 2;
        if (oppStrongest >= 2600) priority += 1;
        if ((bot.lp || 0) <= 4000) priority += 1;
        if ((opponent?.field || []).length === 0) priority -= 2;

        const macroBuff = calculateMacroPriorityBonus(
          "summon",
          protectorCard,
          macroStrategy,
        );
        priority += macroBuff;

        actions.push({
          type: "special_summon_sanctum_protector",
          index: protectorIndex,
          cardId: protectorCard?.id,
          materialIndex: chosenAegis.fieldIndex,
          position: "defense",
          priority,
          cardName: protectorCard?.name || "Luminarch Sanctum Protector",
          macroBuff,
          reason: "upgrade_tank",
        });
      } else if (bot?.debug && aegisCandidates.length > 0) {
        console.log(
          "[LuminarchStrategy] Skip Protector SS: ascension ready for Aegis",
        );
      }
    }

    // === SPELL ACTIONS ===
    bot.hand.forEach((card, index) => {
      if (card.cardKind !== "spell") return;

      try {
        if (VERBOSE_EVAL && bot?.debug) {
          console.log(
            `\n[LuminarchStrategy] 🔍 Avaliando spell: ${card.name} (${
              card.subtype || "normal"
            })`,
          );
        }

        if (
          game.effectEngine?.canActivateSpellFromHandPreview &&
          typeof game.effectEngine.canActivateSpellFromHandPreview ===
            "function"
        ) {
          const preview = game.effectEngine.canActivateSpellFromHandPreview(
            card,
            bot,
            { activationContext },
          );
          if (VERBOSE_EVAL && bot?.debug) {
            console.log(
              `  Preview: ${preview?.ok ? "✅" : "❌"} ${preview?.reason || ""}`,
            );
          }
          if (preview && preview.ok === false) return;
        } else {
          const check = game.effectEngine?.canActivate?.(card, bot);
          if (VERBOSE_EVAL && bot?.debug && check) {
            console.log(
              `  CanActivate: ${check.ok ? "✅" : "❌"} ${check.reason || ""}`,
            );
          }
          if (check && !check.ok) return;
        }

        // === USO DO MÓDULO DE PRIORIDADES ===
        const analysis = {
          hand: bot?.hand || [],
          field: bot?.field || [],
          fieldSpell: bot?.fieldSpell || null,
          graveyard: bot?.graveyard || [],
          lp: bot?.lp || 8000,
          oppField: opponent?.field || [],
          oppLp: opponent?.lp || 8000,
          currentTurn: game?.turnCounter || 1,
        };

        const decision = shouldPlaySpell(card, analysis);
        if (VERBOSE_EVAL && bot?.debug) {
          console.log(
            `  shouldPlaySpell: ${decision.yes ? "✅" : "❌"} ${
              decision.reason || ""
            }`,
          );
        }

        if (!decision.yes) {
          // Módulo bloqueou a ativação (ex: Citadel já tem field spell)
          return;
        }

        // === MULTI-TURN: Avaliar se deve gastar recursos agora ===
        const resourceCheck = shouldCommitResourcesNow(
          card,
          analysis,
          gameStance,
        );
        if (VERBOSE_EVAL && bot?.debug) {
          console.log(
            `  shouldCommitResourcesNow: ${
              resourceCheck.shouldPlay ? "✅" : "⏳"
            } ${resourceCheck.reason || ""}`,
          );
        }
        if (!resourceCheck.shouldPlay) {
          return; // Segurar carta para próximo turno
        }

        // === P1: Aplicar bônus de macro strategy ===
        let priority = decision.priority || 1;
        const macroBuff = calculateMacroPriorityBonus(
          "spell",
          card,
          macroStrategy,
        );
        priority += macroBuff;

        // === FUSION PRIORITY: Override para Polymerization ===
        if (card.name === "Polymerization" && fusionOpportunity) {
          if (fusionOpportunity.decision.shouldPrioritize) {
            priority = fusionOpportunity.decision.priority;
            if (bot?.debug) {
              console.log(
                `[LuminarchStrategy] 🔮 Polymerization priority override: ${priority} (${fusionOpportunity.decision.reason})`,
              );
            }
          }
        }

        // === P1: Penalidade de chain risk ===
        const spellSafety = assessActionSafety(
          { bot, player: opponent },
          bot,
          opponent,
          "spell",
          card,
        );
        if (spellSafety.recommendation === "very_risky") {
          priority -= 15;
        } else if (spellSafety.recommendation === "risky") {
          priority -= 8;
        }

        actions.push({
          type: "spell",
          index,
          cardId: card.id,
          priority,
          cardName: card.name,
          macroBuff,
          safetyScore: spellSafety.riskScore,
          reason: decision.reason,
        });
        spellIndicesActivated.add(index);
      } catch (e) {
        // Silent spell evaluation error
      }
    });

    // === SPELL/TRAP ZONE SPELL ACTIVATIONS ===
    (bot.spellTrap || []).forEach((card, index) => {
      if (!card || card.cardKind !== "spell") return;
      if (card.subtype === "field") return;

      try {
        if (
          game.effectEngine?.canActivateSpellTrapEffectPreview &&
          typeof game.effectEngine.canActivateSpellTrapEffectPreview ===
            "function"
        ) {
          const preview = game.effectEngine.canActivateSpellTrapEffectPreview(
            card,
            bot,
            "spellTrap",
            null,
            { activationContext },
          );
          if (preview && preview.ok === false) return;
        }

        const analysis = {
          hand: bot?.hand || [],
          field: bot?.field || [],
          fieldSpell: bot?.fieldSpell || null,
          graveyard: bot?.graveyard || [],
          lp: bot?.lp || 8000,
          oppField: opponent?.field || [],
          oppLp: opponent?.lp || 8000,
          currentTurn: game?.turnCounter || 1,
        };

        const decision = shouldPlaySpell(card, analysis);
        if (!decision.yes) return;

        const resourceCheck = shouldCommitResourcesNow(
          card,
          analysis,
          gameStance,
        );
        if (!resourceCheck.shouldPlay) return;

        let priority = decision.priority || 1;
        const macroBuff = calculateMacroPriorityBonus(
          "spell",
          card,
          macroStrategy,
        );
        priority += macroBuff;

        const spellSafety = assessActionSafety(
          { bot, player: opponent },
          bot,
          opponent,
          "spell",
          card,
        );
        if (spellSafety.recommendation === "very_risky") {
          priority -= 15;
        } else if (spellSafety.recommendation === "risky") {
          priority -= 8;
        }

        actions.push({
          type: "spellTrapEffect",
          index,
          zoneIndex: index,
          cardId: card.id,
          priority,
          cardName: card.name,
          macroBuff,
          safetyScore: spellSafety.riskScore,
          reason: decision.reason,
        });
      } catch (e) {
        // Silent spell/trap evaluation error
      }
    });

    // === SPELL/TRAP SET ACTIONS (fallback setup) ===
    // 📋 REGRA: Só faz sentido setar cartas que podem ser ativadas no turno do oponente
    //   - Quick-Spells (speed 2): Holy Shield
    //   - Traps: qualquer trap
    //   - NÃO setar: Normal spells, Continuous spells, Equip spells, Field spells
    const canSetSpellTrap = (bot.spellTrap || []).length < 5;
    if (canSetSpellTrap) {
      const baseSetPriority = -1;

      bot.hand.forEach((card, index) => {
        if (!card) return;

        // ✅ Traps sempre podem ser setados
        if (card.cardKind === "trap") {
          // OK, continua
        }
        // ✅ Quick-Spells (speed 2) podem ser setados para uso no turno do oponente
        else if (card.cardKind === "spell" && card.subtype === "quick") {
          // OK, continua
        }
        // ❌ Todas outras spells devem ser ativadas diretamente da mão
        else {
          return; // Skip: normal, continuous, equip, field spells
        }

        if (spellIndicesActivated.has(index)) return;

        const valueEstimate = estimateCardValue(card, {
          archetype: "Luminarch",
          fieldSpell: bot?.fieldSpell || null,
          preferDefense: true,
        });
        const setPriority = baseSetPriority + valueEstimate * 0.2;

        actions.push({
          type: "set_spell_trap",
          index,
          cardId: card.id,
          priority: setPriority,
          cardName: card.name,
          reason: "setup_backrow",
        });
      });
    }

    // === FIELD EFFECT ===
    if (bot.fieldSpell) {
      const effect = (bot.fieldSpell.effects || []).find(
        (e) => e.timing === "on_field_activate",
      );
      if (effect) {
        const preview = game.effectEngine?.canActivateFieldSpellEffectPreview?.(
          bot.fieldSpell,
          bot,
          null,
          { activationContext },
        );
        let shouldUseFieldEffect = true;
        if (bot.fieldSpell?.name?.includes("Citadel")) {
          const myMonsters = (bot.field || []).filter(
            (card) =>
              card &&
              card.cardKind === "monster" &&
              !card.isFacedown &&
              isLuminarch(card),
          );
          if (!myMonsters.length) {
            shouldUseFieldEffect = false;
          } else {
            const oppField = opponent?.field || [];
            const oppLP = opponent?.lp || 0;
            const oppStrongestAtk = oppField.reduce((max, monster) => {
              if (!monster || monster.cardKind !== "monster") return max;
              const atk = monster.isFacedown ? 1500 : monster.atk || 0;
              return Math.max(max, atk);
            }, 0);
            const lp = bot.lp || 0;
            const canPay = lp > 1000;
            const wouldBeCritical = lp <= 2000;

            const getAtk = (card) =>
              (card.atk || 0) +
              (card.tempAtkBoost || 0) +
              (card.equipAtkBonus || 0);
            const getDef = (card) =>
              (card.def || 0) +
              (card.tempDefBoost || 0) +
              (card.equipDefBonus || 0);

            const bestAtk = Math.max(...myMonsters.map(getAtk), 0);
            const lethalWithBuff =
              oppField.length === 0 && bestAtk + 500 >= oppLP;

            const improvesMatchup = myMonsters.some((monster) => {
              const atk = getAtk(monster);
              const def = getDef(monster);
              const atkImproves =
                atk <= oppStrongestAtk && atk + 500 > oppStrongestAtk;
              const defImproves =
                def <= oppStrongestAtk && def + 500 > oppStrongestAtk;
              return atkImproves || defImproves;
            });

            shouldUseFieldEffect =
              canPay &&
              (lethalWithBuff || improvesMatchup) &&
              !(wouldBeCritical && !lethalWithBuff);
          }
        }

        if (preview && preview.ok && shouldUseFieldEffect) {
          actions.push({
            type: "fieldEffect",
            priority: 0,
            cardName: bot.fieldSpell.name,
          });
        }
      }
    }

    const positionActions = this.getPositionChangeActions(game, bot, opponent);
    if (positionActions.length > 0) {
      actions.push(...positionActions);
    }

    // === ASCENSION SUMMONS ===
    // Detectar materiais prontos para Ascension (especialmente Fortress Aegis)
    try {
      const ascensionActions = this.detectAscensionOpportunities(game, bot);
      if (ascensionActions.length > 0 && bot?.debug) {
        console.log(
          `[LuminarchStrategy] 🔥 Ascension opportunities:`,
          ascensionActions.map((a) => `${a.cardName} (pri ${a.priority})`),
        );
      }
      actions.push(...ascensionActions);
    } catch (e) {
      // Silent ascension detection error
    }

    // === FUSION SUMMONS ===
    // Detectar oportunidades de fusão (Megashield Barbarias)
    try {
      const fusionActions = this.detectFusionOpportunities(game, bot);
      if (fusionActions.length > 0 && bot?.debug) {
        console.log(
          `[LuminarchStrategy] ⚡ Fusion opportunities:`,
          fusionActions.map((a) => `${a.cardName} (pri ${a.priority})`),
        );
      }
      actions.push(...fusionActions);
    } catch (e) {
      // Silent fusion detection error
    }

    // === P2: GAME TREE SEARCH (OPCIONAL, SÓ SE CRÍTICO) ===
    // CRITICAL: Não chamar P2 recursivamente durante simulação de árvore de jogo
    if (game._isPerspectiveState) {
      // Estamos dentro de uma simulação - apenas retornar ações ordenadas sem P2
      return this.sequenceActions(actions);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FALLBACK: Se nenhuma ação foi gerada, reavaliar cartas de emergência
    // ═══════════════════════════════════════════════════════════════════════
    if (actions.length === 0) {
      if (VERBOSE_EVAL && bot?.debug) {
        console.log(
          `[LuminarchStrategy] 🆘 Fallback: reavaliando cartas de emergência...`,
        );
      }

      // === FALLBACK 1: Spells de buff/removal ignorando shouldCommitResourcesNow ===
      const emergencySpellNames = [
        "Luminarch Radiant Wave",
        "Luminarch Holy Ascension",
      ];
      bot.hand.forEach((card, index) => {
        if (card.cardKind !== "spell") return;
        if (!emergencySpellNames.includes(card.name)) return;

        try {
          // Verificar se o EffectEngine permite a ativação
          if (
            game.effectEngine?.canActivateSpellFromHandPreview &&
            typeof game.effectEngine.canActivateSpellFromHandPreview ===
              "function"
          ) {
            const preview = game.effectEngine.canActivateSpellFromHandPreview(
              card,
              bot,
              { activationContext },
            );
            if (preview && preview.ok === false) return;
          }

          // Adicionar com prioridade baixa/moderada
          const priority = card.name.includes("Radiant Wave") ? 3 : 2;
          actions.push({
            type: "spell",
            index,
            cardId: card.id,
            priority,
            cardName: card.name,
            reason: "emergency_fallback",
          });
        } catch (e) {
          // Silent fallback error
        }
      });

      // === FALLBACK 2: Summon defensivo se ainda não invocou ===
      if (actions.length === 0 && bot.summonCount < 1) {
        const defensiveSummonNames = [
          "Luminarch Aegisbearer",
          "Luminarch Sanctified Arbiter",
        ];

        for (const targetName of defensiveSummonNames) {
          const cardIndex = bot.hand.findIndex(
            (c) => c && c.name === targetName,
          );
          if (cardIndex === -1) continue;

          const card = bot.hand[cardIndex];
          const tributeInfo = this.getTributeRequirementFor(card, bot);

          // Verificar tributos e espaço
          if (bot.field.length < tributeInfo.tributesNeeded) continue;
          const projectedFieldCount =
            (bot.field?.length || 0) - tributeInfo.tributesNeeded + 1;
          if (projectedFieldCount > 5) continue;

          // Adicionar summon defensivo
          actions.push({
            type: "summon",
            index: cardIndex,
            cardId: card.id,
            position: "defense",
            facedown: true,
            priority: 1,
            cardName: card.name,
            reason: "defensive_fallback",
          });

          break; // Apenas um summon fallback
        }
      }
    }

    if (bot?.debug) {
      console.log(
        `\n[LuminarchStrategy] 📊 Resumo: ${bot.hand.length} cartas avaliadas → ${actions.length} ações geradas`,
      );
      if (actions.length > 0) {
        console.log("  Ações:");
        actions.forEach((a) => {
          console.log(
            `    - ${a.type}: ${a.cardName || `index ${a.index}`} (priority: ${
              a.priority || 0
            })`,
          );
        });
      } else {
        console.log("  ⚠️ NENHUMA AÇÃO GERADA");
      }
    }

    const finalActions = this.integrateP2IntoActionSelection(
      game,
      this.sequenceActions(actions),
    );

    return finalActions;
  }

  sequenceActions(actions) {
    // Ordena por prioridade (P1 priority bonuses aplicados)
    const sorted = actions.sort((a, b) => {
      const priorityA = a.priority ?? 0;
      const priorityB = b.priority ?? 0;
      if (priorityA !== priorityB) return priorityB - priorityA; // Maior priority primeiro

      // Fallback: tipo
      const typePriority = {
        fieldEffect: 0,
        spell: 1,
        spellTrapEffect: 2,
        position_change: 2.5,
        summon: 3,
        special_summon_sanctum_protector: 3,
        set_spell_trap: 4,
      };
      const typeA = typePriority[a.type] ?? 9;
      const typeB = typePriority[b.type] ?? 9;
      return typeA - typeB;
    });

    return sorted;
  }

  getTributeRequirementFor(card, playerState) {
    let tributesNeeded = 0;
    if (card.level >= 5 && card.level <= 6) tributesNeeded = 1;
    else if (card.level >= 7) tributesNeeded = 2;

    let usingAlt = false;
    const alt = card.altTribute;
    if (
      alt?.type === "no_tribute_if_empty_field" &&
      (playerState.field?.length || 0) === 0 &&
      tributesNeeded > 0
    ) {
      tributesNeeded = 0;
      usingAlt = true;
    }
    if (
      alt &&
      playerState.field?.some((c) => c && c.name === alt.requiresName)
    ) {
      if (alt.tributes < tributesNeeded) {
        tributesNeeded = alt.tributes;
        usingAlt = true;
      }
    }

    return { tributesNeeded, usingAlt, alt };
  }

  selectBestTributes(field, tributesNeeded, cardToSummon, context = {}) {
    if (tributesNeeded <= 0 || !field || field.length < tributesNeeded) {
      return [];
    }

    const botState = this.bot || {};
    const evaluationContext = {
      field: field || [],
      graveyard: botState.graveyard || [],
      hand: botState.hand || [],
      spellTrap: botState.spellTrap || [],
      fieldSpell: botState.fieldSpell || null,
      usedEffects: botState.usedEffects || [],
    };

    const oppField = Array.isArray(context.oppField) ? context.oppField : [];
    const oppStrongest = oppField.reduce((max, monster) => {
      if (!monster || monster.cardKind !== "monster") return max;
      return Math.max(max, monster.atk || 0);
    }, 0);

    const monstersWithValue = (field || [])
      .map((monster, index) => {
        if (!monster || monster.cardKind !== "monster") return null;

        const atk = (monster.atk || 0) + (monster.tempAtkBoost || 0);
        const def = (monster.def || 0) + (monster.tempDefBoost || 0);
        const hiddenDef = monster.isFacedown ? 1500 : 0;
        const combatStat = Math.max(atk, def, hiddenDef);

        const expendability = evaluateCardExpendability(
          monster,
          evaluationContext,
        );

        // keepScore alto = queremos manter; ordenar ASC para tributar o menor
        let keepScore = combatStat / 1000;
        keepScore += (monster.level || 0) * 0.12;
        keepScore += (expendability.value ?? 5) * 0.4;
        if (!expendability.expendable) keepScore += 1.0;
        if (monster.mustBeAttacked) keepScore += 1.2;

        const solidDefender =
          monster.position === "defense" &&
          def >= Math.max(1800, oppStrongest - 200);
        if (solidDefender) keepScore += 0.6;

        if (monster.isFacedown) keepScore -= 0.5;

        return { monster, index, keepScore };
      })
      .filter(Boolean);

    monstersWithValue.sort((a, b) => a.keepScore - b.keepScore);
    return monstersWithValue.slice(0, tributesNeeded).map((t) => t.index);
  }

  chooseSummonPosition(card, game) {
    const opponent = game?.player || { field: [] };
    const opponentStrongest = (opponent.field || []).reduce((max, monster) => {
      if (!monster || monster.cardKind !== "monster" || monster.isFacedown) {
        return max;
      }
      return Math.max(max, monster.atk || 0);
    }, 0);

    const atk = card.atk || 0;
    const def = card.def || 0;
    const isTaunt = !!card.mustBeAttacked;
    const canPierce = !!card.piercing;

    if (opponentStrongest <= 0) return "attack";
    if (isTaunt && def >= atk) return "defense";
    if (def >= opponentStrongest + 300) return "defense";
    if (atk >= opponentStrongest + 200) return "attack";
    if (canPierce && atk >= opponentStrongest) return "attack";
    if (def >= atk && opponentStrongest > atk) return "defense";
    return "attack";
  }

  shouldSetFacedown(card, position) {
    // REGRA DO JOGO: Defesa = sempre facedown (set)
    // Não existe "invocar em defesa face-up" em Shadow Duel
    if (position !== "defense") return false;
    return true;
  }

  getOpponent(gameOrState, perspectivePlayer) {
    if (typeof gameOrState.getOpponent === "function") {
      return gameOrState.getOpponent(perspectivePlayer);
    }
    return gameOrState.player && perspectivePlayer?.id === "bot"
      ? gameOrState.player
      : gameOrState.bot;
  }

  simulateMainPhaseAction(state, action) {
    if (!action) return state;

    // 🔍 DEBUG: Log se state é o jogo real ou simulado
    if (!state._isPerspectiveState && state.player && state.bot) {
      console.error(
        `[🚨 LuminarchStrategy.simulateMainPhaseAction] CRITICAL: Simulating on REAL game state!`,
        {
          action: action.type,
          card: action.cardName || state.bot?.hand?.[action.index]?.name,
        },
      );
    }

    switch (action.type) {
      case "summon": {
        const player = state.bot;
        const card = player.hand[action.index];
        if (!card) break;
        const tributeInfo = this.getTributeRequirementFor(card, player);
        const tributesNeeded = tributeInfo.tributesNeeded;

        const tributeIndices = this.selectBestTributes(
          player.field,
          tributesNeeded,
          card,
        );

        tributeIndices.sort((a, b) => b - a);
        tributeIndices.forEach((idx) => {
          const t = player.field[idx];
          if (t) {
            player.graveyard.push(t);
            player.field.splice(idx, 1);
          }
        });

        player.hand.splice(action.index, 1);
        const newCard = { ...card };
        newCard.position = action.position;
        newCard.isFacedown = action.facedown;
        newCard.hasAttacked = false;
        newCard.attacksUsedThisTurn = 0;
        // 🚨 VALIDATION: Only monsters can go to field
        if (newCard.cardKind !== "monster") {
          console.error(
            `[🚨 LuminarchStrategy] BLOCKED sim: ${newCard.cardKind} "${newCard.name}" tried to enter field!`,
          );
          player.graveyard.push(newCard); // Send to GY instead
        } else {
          player.field.push(newCard);

          // SIMULATE ON-SUMMON EFFECTS (searchers)
          // Valiant busca Aegisbearer quando Normal Summoned
          if (
            card.name === "Luminarch Valiant - Knight of the Dawn" &&
            !action.facedown
          ) {
            // Simular busca do Aegisbearer do deck para mão
            // (simplificado: apenas adicionar valor à avaliação implicitamente)
            // Na simulação, marcamos que o efeito foi usado
            newCard._searchedAegis = true;
          }

          // Arbiter busca spell Luminarch quando Normal Summoned
          if (
            card.name === "Luminarch Sanctified Arbiter" &&
            !action.facedown
          ) {
            newCard._searchedSpell = true;
          }
        }
        player.summonCount = (player.summonCount || 0) + 1;
        break;
      }
      case "special_summon_sanctum_protector": {
        const player = state.bot;
        const handIndex = Number.isInteger(action.index)
          ? action.index
          : player.hand.findIndex(
              (c) => c && c.name === "Luminarch Sanctum Protector",
            );
        if (handIndex < 0) break;
        const materialIndex = Number.isInteger(action.materialIndex)
          ? action.materialIndex
          : player.field.findIndex(
              (c) => c && c.name === "Luminarch Aegisbearer" && !c.isFacedown,
            );
        if (materialIndex < 0) break;

        const material = player.field[materialIndex];
        if (material) {
          player.field.splice(materialIndex, 1);
          player.graveyard.push(material);
        }

        const protector = player.hand[handIndex];
        player.hand.splice(handIndex, 1);
        const newCard = { ...protector };
        newCard.position = action.position || "defense";
        newCard.isFacedown = false;
        newCard.hasAttacked = false;
        newCard.attacksUsedThisTurn = 0;
        // 🚨 VALIDATION: Only monsters can go to field
        if (newCard.cardKind !== "monster") {
          console.error(
            `[🚨 LuminarchStrategy] BLOCKED sim protector: ${newCard.cardKind} "${newCard.name}" tried to enter field!`,
          );
          player.graveyard.push(newCard);
        } else {
          player.field.push(newCard);
        }
        break;
      }
      case "position_change": {
        const player = state.bot;
        const target = (player.field || []).find(
          (c) =>
            c &&
            (c.id === action.cardId ||
              (!action.cardId && c.name === action.cardName)),
        );
        if (!target) break;
        if (target.isFacedown) break;
        if (target.positionChangedThisTurn) break;
        if (target.hasAttacked) break;
        const newPosition =
          action.toPosition === "defense" ? "defense" : "attack";
        if (target.position === newPosition) break;
        target.position = newPosition;
        target.positionChangedThisTurn = true;
        target.cannotAttackThisTurn = newPosition === "defense";
        break;
      }
      case "spell": {
        const player = state.bot;
        const card = player.hand[action.index];
        if (!card) break;
        player.hand.splice(action.index, 1);
        const placedCard = { ...card };
        this.simulateSpellEffect(state, placedCard);
        const placement = this.placeSpellCard(state, placedCard);
        if (!placement.placed) {
          player.graveyard.push(placedCard);
        }
        break;
      }
      case "set_spell_trap": {
        const player = state.bot;
        const card = player.hand[action.index];
        if (!card) break;
        if (card.cardKind === "spell" && card.subtype === "field") break;
        player.hand.splice(action.index, 1);
        const setCard = { ...card, isFacedown: true };
        if (typeof state.turnCounter === "number") {
          setCard.turnSetOn = state.turnCounter;
        }
        player.spellTrap = player.spellTrap || [];
        if (player.spellTrap.length < 5) {
          player.spellTrap.push(setCard);
        } else {
          player.graveyard.push(setCard);
        }
        break;
      }
      case "spellTrapEffect": {
        const player = state.bot;
        const zoneIndex = Number.isInteger(action.zoneIndex)
          ? action.zoneIndex
          : action.index;
        const card = player.spellTrap?.[zoneIndex];
        if (!card) break;
        card.isFacedown = false;

        const effect = (card.effects || []).find(
          (entry) =>
            entry &&
            (entry.timing === "ignition" || entry.timing === "on_play"),
        );
        if (effect) {
          const selections = selectSimulatedTargets({
            targets: effect.targets || [],
            actions: effect.actions || [],
            state,
            sourceCard: card,
            selfId: "bot",
            options: { archetype: "Luminarch", preferDefense: true },
          });
          applySimulatedActions({
            actions: effect.actions || [],
            selections,
            state,
            selfId: "bot",
            options: { archetype: "Luminarch", preferDefense: true },
          });
        }

        if (
          card.cardKind === "spell" &&
          (card.subtype === "normal" ||
            card.subtype === "quick" ||
            card.subtype === "quick-play")
        ) {
          player.graveyard.push(card);
          if (Array.isArray(player.spellTrap)) {
            player.spellTrap.splice(zoneIndex, 1);
          }
        }
        break;
      }
      case "fieldEffect": {
        const player = state.bot;
        const fieldSpell = player.fieldSpell;
        if (!fieldSpell) break;
        const effect = (fieldSpell.effects || []).find(
          (entry) => entry && entry.timing === "on_field_activate",
        );
        if (!effect) break;
        const selections = selectSimulatedTargets({
          targets: effect.targets || [],
          actions: effect.actions || [],
          state,
          sourceCard: fieldSpell,
          selfId: "bot",
          options: { archetype: "Luminarch", preferDefense: true },
        });
        applySimulatedActions({
          actions: effect.actions || [],
          selections,
          state,
          selfId: "bot",
          options: { archetype: "Luminarch", preferDefense: true },
        });
        break;
      }
      default:
        break;
    }

    return state;
  }

  simulateSpellEffect(state, card) {
    if (!card || !Array.isArray(card.effects)) return;
    const effect = card.effects.find(
      (entry) => entry && entry.timing === "on_play",
    );
    if (!effect) return;
    const selections = selectSimulatedTargets({
      targets: effect.targets || [],
      actions: effect.actions || [],
      state,
      sourceCard: card,
      selfId: "bot",
      options: { archetype: "Luminarch", preferDefense: true },
    });
    applySimulatedActions({
      actions: effect.actions || [],
      selections,
      state,
      selfId: "bot",
      options: { archetype: "Luminarch", preferDefense: true },
    });
  }

  /**
   * === P1: MACRO STRATEGY ===
   * Avalia situação do jogo e decide estratégia macro (lethal, defend, setup, grind)
   */
  evaluateMacroStrategy(game) {
    try {
      const bot = this.bot;
      const opponent = this.getOpponent(game, bot);

      if (!bot || !opponent) {
        return { strategy: "grind", priority: 30, detail: {} };
      }

      // Detectar oportunidades
      const lethal = detectLethalOpportunity(game, bot, opponent);
      const defensive = detectDefensiveNeed(game, bot, opponent);
      const comeback = detectComeback(game, bot, opponent);

      // Decidir estratégia
      const macro = decideMacroStrategy(lethal, defensive, comeback);

      return macro;
    } catch (e) {
      if (this.bot?.debug !== false) {
        console.warn(`[LuminarchStrategy] evaluateMacroStrategy erro:`, e);
      }
      return { strategy: "grind", priority: 30, detail: {} };
    }
  }

  /**
   * === FUSION DETECTION ===
   * Detecta oportunidades de Fusion Summons (Megashield Barbarias).
   */
  detectFusionOpportunities(game, bot) {
    const actions = [];
    const opponent = this.getOpponent(game, bot);

    try {
      // Verificar se tem Polymerization na mão
      const polyInHand = bot.hand.findIndex(
        (c) => c && c.name === "Polymerization",
      );
      if (polyInHand === -1) return actions;
      const polyCard = bot.hand[polyInHand];
      if (!polyCard) return actions;

      // Verificar se tem Megashield no Extra Deck
      const megashield = bot.extraDeck.find(
        (c) => c && c.name === "Luminarch Megashield Barbarias",
      );
      if (!megashield) return actions;

      if (game?.effectEngine?.canSummonFusion) {
        const handMaterials = (bot.hand || [])
          .filter((c) => c && c.cardKind === "monster")
          .map((card) => ({ card, zone: "hand" }));
        const fieldMaterials = (bot.field || [])
          .filter((c) => c && c.cardKind === "monster")
          .map((card) => ({ card, zone: "field" }));
        const combined = [...handMaterials, ...fieldMaterials];
        const materials = combined.map((entry) => entry.card);
        const materialInfo = combined.map((entry) => ({ zone: entry.zone }));
        const canFuse = game.effectEngine.canSummonFusion(
          megashield,
          materials,
          bot,
          { materialInfo },
        );
        if (!canFuse) return actions;
      }

      if (game?.effectEngine?.canActivateSpellFromHandPreview) {
        const activationContext = {
          autoSelectSingleTarget: true,
          logTargets: false,
        };
        const preview = game.effectEngine.canActivateSpellFromHandPreview(
          polyCard,
          bot,
          { activationContext },
        );
        if (preview && preview.ok === false) return actions;
      }

      // Megashield precisa: Luminarch Sanctum Protector + Luminarch Lv5+
      const hasProtector = bot.field.some(
        (c) => c && c.name === "Luminarch Sanctum Protector",
      );
      const lv5Plus = bot.field.filter(
        (c) =>
          c &&
          c.cardKind === "monster" &&
          c.archetype === "Luminarch" &&
          (c.level || 0) >= 5,
      );

      if (hasProtector && lv5Plus.length > 0) {
        const priority = this.evaluateFusionPriority(
          "Luminarch Megashield Barbarias",
          bot,
          opponent,
          game,
        );

        if (priority > 0) {
          actions.push({
            type: "spell", // Polymerization é tratado como spell normal
            index: polyInHand,
            priority: priority,
            cardName: "Polymerization",
            fusionTarget: "Luminarch Megashield Barbarias",
            reason: `Fusion para Megashield (3000 DEF tank)`,
          });
        }
      }
    } catch (e) {
      console.warn(
        `[LuminarchStrategy] detectFusionOpportunities error:`,
        e.message,
      );
    }

    return actions;
  }

  /**
   * Avalia prioridade de uma Fusion específica.
   */
  evaluateFusionPriority(fusionName, bot, opponent, game) {
    // MEGASHIELD BARBARIAS - 3000 DEF tank + lifegain x2
    if (fusionName === "Luminarch Megashield Barbarias") {
      // Prioridade BASE: 10 (alta, tanque supremo)
      let priority = 10;

      // Boost se LP MUITO baixo (desesperado por tank)
      const lp = bot.lp || 8000;
      if (lp <= 2000)
        priority += 4; // 14
      else if (lp <= 3500) priority += 2; // 12

      // Boost se oponente dominando board
      const oppStrength = (opponent?.field || []).reduce(
        (sum, m) => sum + (m && m.atk ? m.atk : 0),
        0,
      );
      if (oppStrength >= 8000)
        priority += 3; // Opp overwhelmingly strong
      else if (oppStrength >= 6000) priority += 1;

      // Boost se tem Citadel ativo (lifegain dobrado: 500 → 1000)
      const hasCitadel = bot.fieldSpell?.name?.includes("Citadel");
      if (hasCitadel) priority += 2; // Synergy suprema

      // Penalty se já tem tank forte no campo
      const hasFortress = bot.field.some(
        (c) => c && c.name === "Luminarch Fortress Aegis",
      );
      const has2800Tank = bot.field.some(
        (c) =>
          c &&
          c.cardKind === "monster" &&
          c.position === "defense" &&
          (c.def || 0) >= 2800,
      );
      if (hasFortress || has2800Tank) priority -= 3; // Já tem wall supremo

      // Penalty se vai sacrificar material importante
      const willLoseProtector = bot.field.some(
        (c) => c && c.name === "Luminarch Sanctum Protector",
      );
      const protectorAge = willLoseProtector
        ? bot.field.find((c) => c && c.name === "Luminarch Sanctum Protector")
            ?.fieldAgeTurns || 0
        : 0;
      if (protectorAge >= 2) priority -= 1; // Protector veterano é valioso

      return priority;
    }

    // Fallback
    return 6;
  }

  /**
   * === ASCENSION DETECTION ===
   * Detecta materiais prontos para Ascension e avalia prioridade.
   */
  detectAscensionOpportunities(game, bot) {
    const actions = [];
    const opponent = this.getOpponent(game, bot);

    try {
      // Iterar pelos monstros no campo
      bot.field.forEach((material, fieldIndex) => {
        if (!material || material.cardKind !== "monster") return;

        // Verificar se pode ser usado como material
        const canUse = game.canUseAsAscensionMaterial?.(bot, material);
        if (!canUse?.ok) return;

        // Obter candidatos à Ascension
        const candidates =
          game.getAscensionCandidatesForMaterial?.(bot, material) || [];
        if (candidates.length === 0) return;

        // Filtrar por requirements
        const eligible = candidates.filter(
          (asc) => game.checkAscensionRequirements?.(bot, asc)?.ok,
        );
        if (eligible.length === 0) return;

        // Avaliar prioridade de cada Ascension elegível
        eligible.forEach((ascensionCard) => {
          const priority = this.evaluateAscensionPriority(
            material,
            ascensionCard,
            bot,
            opponent,
            game,
          );

          if (priority > 0) {
            actions.push({
              type: "ascension",
              materialIndex: fieldIndex,
              ascensionCard: ascensionCard,
              priority: priority,
              cardName: ascensionCard.name,
              materialName: material.name,
            });
          }
        });
      });
    } catch (e) {
      console.warn(
        `[LuminarchStrategy] detectAscensionOpportunities error:`,
        e.message,
      );
    }

    return actions;
  }

  /**
   * Avalia prioridade de uma Ascension específica.
   */
  evaluateAscensionPriority(material, ascensionCard, bot, opponent, game) {
    const name = ascensionCard.name;
    const materialAge = material.fieldAgeTurns || 0;

    // FORTRESS AEGIS - Tank supremo 2500 DEF + recursion
    if (name === "Luminarch Fortress Aegis") {
      // Prioridade BASE: 11 (alta, mas não bloqueia setup crítico)
      let priority = 11;

      // Boost se LP baixo (precisa de tank sustain)
      const lp = bot.lp || 8000;
      if (lp <= 3000)
        priority += 3; // 14
      else if (lp <= 5000) priority += 1; // 12

      // Boost se oponente tem board forte (precisa de wall)
      const oppStrength = (opponent?.field || []).reduce(
        (sum, m) => sum + (m && m.atk ? m.atk : 0),
        0,
      );
      if (oppStrength >= 6000) priority += 2; // +2 se opp muito forte

      // Boost se material está veterano (3+ turnos) - aproveitar antes de perder
      if (materialAge >= 3) priority += 2;

      // Penalty se ainda temos poucas opções de recursion na GY
      const gyLuminarch = (bot.graveyard || []).filter(
        (c) =>
          c &&
          c.cardKind === "monster" &&
          c.archetype === "Luminarch" &&
          (c.def || 0) <= 2000,
      ).length;
      if (gyLuminarch < 2) priority -= 2; // Fortress precisa de GY setup

      return priority;
    }

    // MEGASHIELD BARBARIAS - Fusion tank 3000 DEF
    if (name === "Luminarch Megashield Barbarias") {
      let priority = 9;

      const lp = bot.lp || 8000;
      if (lp <= 2500) priority += 3; // Desesperado por tank

      const oppStrength = (opponent?.field || []).reduce(
        (sum, m) => sum + (m && m.atk ? m.atk : 0),
        0,
      );
      if (oppStrength >= 7000) priority += 2;

      return priority;
    }

    // Fallback genérico
    const ascDef = ascensionCard.def || 0;
    const ascAtk = ascensionCard.atk || 0;
    const isTank = ascDef >= 2500;

    return isTank ? 8 : 6;
  }

  /**
   * === SUICIDE PREVENTION ===
   * Valida se é seguro summon monstro contra ameaças do oponente
   */
  shouldSummonMonsterSafely(card, game, opponent) {
    try {
      // === USO DO MÓDULO DE PRIORIDADES ===
      const bot = this.bot || game.bot;
      const analysis = {
        hand: bot?.hand || [],
        field: bot?.field || [],
        fieldSpell: bot?.fieldSpell || null,
        graveyard: bot?.graveyard || [],
        lp: bot?.lp || 8000,
        oppField: opponent?.field || [],
        oppLp: opponent?.lp || 8000,
        currentTurn: game?.turnCounter || 1,
      };

      const decision = shouldSummonMonster(card, analysis);

      if (!decision.yes) {
        return {
          yes: false,
          reason: decision.reason || "Priorities module blocked summon",
        };
      }

      return {
        yes: true,
        position: decision.position || "defense",
        priority: decision.priority || 3,
        reason: decision.reason || "Priorities module approved",
      };
    } catch (e) {
      if (this.bot?.debug !== false) {
        console.warn(`[LuminarchStrategy] shouldSummonMonsterSafely erro:`, e);
      }
      // Fallback: Luminarch prefere defesa
      const cardDEF = card.def || 0;
      const oppStrongestATK = (opponent?.field || []).reduce(
        (max, m) => Math.max(max, m.atk || 0),
        0,
      );
      const safePosition =
        cardDEF >= oppStrongestATK - 300 ? "defense" : "defense";
      return { yes: true, priority: 2, position: safePosition };
    }
  }

  /**
   * === P2: GAME TREE SEARCH ===
   * Acionado apenas em situações críticas (lethal check, defensive emergency)
   */
  evaluateCriticalSituationWithGameTree(game) {
    try {
      const opponent = this.getOpponent(game, this.bot) || game.opponent;
      if (!opponent) return null;

      // Verificar se vale a pena rodar minimax pesado
      if (!shouldUseGameTreeSearch(game, this.bot)) {
        return null;
      }

      // Rodar minimax
      const result = gameTreeSearch(game, this, this.bot, 4);

      if (result.action) {
        return result;
      }

      return null;
    } catch (e) {
      if (this.bot?.debug !== false) {
        console.warn(`[LuminarchStrategy] Game Tree Search erro:`, e);
      }
      return null;
    }
  }

  /**
   * === P2: OPPONENT ANALYSIS ===
   */
  analyzeOpponentPosition(game) {
    try {
      const opponent = this.getOpponent(game, this.bot) || game.opponent;
      if (!opponent) return null;

      const analysis = analyzeOpponent(opponent, this.bot);
      const turnsToKill = estimateTurnsToOppLethal(
        opponent,
        this.bot.lp || 8000,
      );

      return {
        ...analysis,
        turnsToLethal: turnsToKill,
      };
    } catch (e) {
      if (this.bot?.debug !== false) {
        console.warn(`[LuminarchStrategy] Opponent Analysis erro:`, e);
      }
      return null;
    }
  }

  /**
   * === P2: INTEGRAÇÃO ===
   */
  integrateP2IntoActionSelection(game, actions) {
    try {
      if (!actions || actions.length === 0) return actions;

      // Análise crítica
      const oppAnalysis = this.analyzeOpponentPosition(game);
      if (!oppAnalysis) return actions;

      // Game Tree Search apenas se crítico
      const gameTreeResult = this.evaluateCriticalSituationWithGameTree(game);
      if (!gameTreeResult || !gameTreeResult.action) {
        return actions;
      }

      // Se Game Tree encontrou ação melhor: priorizar
      const gameTreeAction = gameTreeResult.action;
      const gameTreeScore = gameTreeResult.score;

      // Encontrar ação Game Tree nos actions P0/P1 e mover para frente
      const indexInActions = actions.findIndex(
        (a) =>
          a.type === gameTreeAction.type && a.index === gameTreeAction.index,
      );

      if (indexInActions >= 0) {
        const action = actions[indexInActions];
        action.p2Score = gameTreeScore;
        action.p2Approved = true;
        actions.splice(indexInActions, 1);
        actions.unshift(action);
      }

      return actions;
    } catch (e) {
      if (this.bot?.debug !== false) {
        console.warn(`[LuminarchStrategy] P2 Integration erro:`, e);
      }
      return actions;
    }
  }
}
