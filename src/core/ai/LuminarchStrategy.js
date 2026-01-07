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
import {
  evaluateFusionPriority,
} from "./luminarch/fusionPriority.js";
import {
  evaluateCardExpendability,
  evaluateFieldSpellUrgency,
  detectSacrificialProtection,
  evaluateRiskWithProtection,
} from "./luminarch/cardValue.js";

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
      0
    );
    const oppMonstersValue = (opponent?.field || []).reduce(
      (sum, monster) =>
        sum +
        estimateMonsterValue(monster, {
          fieldSpell: opponent?.fieldSpell || null,
          preferDefense: false,
        }),
      0
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
          Math.max(500, opponentStrongest - 200)
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
      0
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

  generateMainPhaseActions(game) {
    const actions = [];
    const bot = this.bot;
    const opponent = this.getOpponent(game, bot);
    const activationContext = {
      autoSelectSingleTarget: true,
      logTargets: false,
    };

    if (bot?.debug) {
      console.log(
        `\n[LuminarchStrategy] 🎴 Avaliando ${bot.hand.length} cartas na mão:`
      );
      bot.hand.forEach((c, i) => {
        console.log(
          `  [${i}] ${c.name} (${c.cardKind}${c.cardKind === "monster" ? ` Lv${c.level || "?"}` : c.subtype ? ` ${c.subtype}` : ""})`
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
          `[LuminarchStrategy] 🎯 Stance: ${gameStance.stance.toUpperCase()} - ${gameStance.reason}`
        );
        console.log(`[LuminarchStrategy] 📋 Plano:`, turnPlan.plan[0]);
      }

      // === FUSION PRIORITY EVALUATION ===
      fusionOpportunity = evaluateFusionPriority({
        hand: analysis.hand,
        field: analysis.field,
        opponent: {
          field: analysis.oppField,
          lp: analysis.oppLp
        }
      });

      if (fusionOpportunity && bot?.debug) {
        console.log(
          `[LuminarchStrategy] 🔮 Fusão detectada: ${fusionOpportunity.fusionName} - ${fusionOpportunity.decision.reason}`
        );
      }

      const availableCombos = detectAvailableCombos(analysis);
      if (availableCombos.length > 0 && bot?.debug) {
        console.log(
          `[LuminarchStrategy] 🎯 Combos detectados:`,
          availableCombos.map((c) => `${c.name} (priority ${c.priority})`)
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
          }`
        );
      }
    } catch (e) {
      console.warn(
        `[LuminarchStrategy] Erro na detecção de combos:`,
        e.message,
        e.stack
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
        "spell"
      ),
      summon: evaluateActionBlockingRisk(
        { bot, player: opponent },
        bot,
        opponent,
        "summon"
      ),
    };

    // === SUMMON ACTIONS ===
    if (bot.summonCount < 1) {
      bot.hand.forEach((card, index) => {
        if (card.cardKind !== "monster") return;
        const tributeInfo = this.getTributeRequirementFor(card, bot);
        if (bot?.debug) {
          console.log(
            `\n[LuminarchStrategy] 🔍 Avaliando monstro: ${card.name}`
          );
          console.log(
            `  Tributos necessários: ${tributeInfo.tributesNeeded}, Field atual: ${bot.field.length}`
          );
        }
        if (bot.field.length < tributeInfo.tributesNeeded) {
          if (bot?.debug) {
            console.log(
              `  ❌ REJEITADO: Tributos insuficientes (precisa ${tributeInfo.tributesNeeded}, tem ${bot.field.length})`
            );
          }
          return;
        }
        if (bot.field.length >= 5) {
          if (bot?.debug) {
            console.log(
              `  ❌ REJEITADO: Campo cheio (${bot.field.length}/5)`
            );
          }
          return;
        }

        // === SUICIDE CHECK ===
        const shouldSummon = this.shouldSummonMonsterSafely(
          card,
          game,
          opponent
        );
        if (bot?.debug) {
          console.log(
            `  Safety check: ${shouldSummon.yes ? "✅ APROVADO" : "❌ REJEITADO"} - ${shouldSummon.reason || "sem motivo"}`
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
          macroStrategy
        );
        priority += macroBuff;

        // === P1: Penalidade de chain risk ===
        const summonSafety = assessActionSafety(
          { bot, player: opponent },
          bot,
          opponent,
          "summon",
          card
        );
        if (summonSafety.recommendation === "very_risky") {
          priority -= 10;
        }

        actions.push({
          type: "summon",
          index,
          position: preferredPosition,
          facedown,
          priority,
          cardName: card.name,
          macroBuff,
          safetyScore: summonSafety.riskScore,
        });
      });
    }

    // === SPELL ACTIONS ===
    bot.hand.forEach((card, index) => {
      if (card.cardKind !== "spell") return;

      try {
        if (bot?.debug) {
          console.log(
            `\n[LuminarchStrategy] 🔍 Avaliando spell: ${card.name} (${card.subtype || "normal"})`
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
            { activationContext }
          );
          if (bot?.debug) {
            console.log(
              `  Preview: ${preview?.ok ? "✅" : "❌"} ${preview?.reason || ""}`
            );
          }
          if (preview && preview.ok === false) return;
        } else {
          const check = game.effectEngine?.canActivate?.(card, bot);
          if (bot?.debug && check) {
            console.log(
              `  CanActivate: ${check.ok ? "✅" : "❌"} ${check.reason || ""}`
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
        if (bot?.debug) {
          console.log(
            `  shouldPlaySpell: ${decision.yes ? "✅" : "❌"} ${decision.reason || ""}`
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
          gameStance
        );
        if (bot?.debug) {
          console.log(
            `  shouldCommitResourcesNow: ${resourceCheck.shouldPlay ? "✅" : "⏳"} ${resourceCheck.reason || ""}`
          );
        }
        if (!resourceCheck.shouldPlay) {
          if (bot?.debug) {
            console.log(
              `[LuminarchStrategy] ⏳ Segurar ${card.name}: ${resourceCheck.reason}`
            );
          }
          return; // Segurar carta para próximo turno
        }

        // === P1: Aplicar bônus de macro strategy ===
        let priority = decision.priority || 1;
        const macroBuff = calculateMacroPriorityBonus(
          "spell",
          card,
          macroStrategy
        );
        priority += macroBuff;

        // === FUSION PRIORITY: Override para Polymerization ===
        if (card.name === "Polymerization" && fusionOpportunity) {
          if (fusionOpportunity.decision.shouldPrioritize) {
            priority = fusionOpportunity.decision.priority;
            if (bot?.debug) {
              console.log(
                `[LuminarchStrategy] 🔮 Polymerization priority override: ${priority} (${fusionOpportunity.decision.reason})`
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
          card
        );
        if (spellSafety.recommendation === "very_risky") {
          priority -= 15;
        } else if (spellSafety.recommendation === "risky") {
          priority -= 8;
        }

        actions.push({
          type: "spell",
          index,
          priority,
          cardName: card.name,
          macroBuff,
          safetyScore: spellSafety.riskScore,
          reason: decision.reason,
        });
      } catch (e) {
        if (bot?.debug) {
          console.warn(
            `[LuminarchStrategy] ⚠️ Erro ao avaliar spell ${card.name}: ${e.message}`
          );
        }
        // NÃO adicionar ao actions - pular esta carta completamente
      }
    });

    // === FIELD EFFECT ===
    if (bot.fieldSpell) {
      const effect = (bot.fieldSpell.effects || []).find(
        (e) => e.timing === "on_field_activate"
      );
      if (effect) {
        const preview = game.effectEngine?.canActivateFieldSpellEffectPreview?.(
          bot.fieldSpell,
          bot,
          null,
          { activationContext }
        );
        // DEBUG: Log preview result
        if (bot?.debug) {
          console.log(`[LuminarchStrategy] Field Effect Preview:`, preview);
        }
        if (preview && preview.ok) {
          actions.push({
            type: "fieldEffect",
            priority: 0,
            cardName: bot.fieldSpell.name,
          });
        }
      }
    }

    // === ASCENSION SUMMONS ===
    // Detectar materiais prontos para Ascension (especialmente Fortress Aegis)
    try {
      const ascensionActions = this.detectAscensionOpportunities(game, bot);
      if (ascensionActions.length > 0 && bot?.debug) {
        console.log(
          `[LuminarchStrategy] 🔥 Ascension opportunities:`,
          ascensionActions.map((a) => `${a.cardName} (pri ${a.priority})`)
        );
      }
      actions.push(...ascensionActions);
    } catch (e) {
      if (bot?.debug) {
        console.warn(
          `[LuminarchStrategy] Erro ao detectar Ascensions:`,
          e.message
        );
      }
    }

    // === FUSION SUMMONS ===
    // Detectar oportunidades de fusão (Megashield Barbarias)
    try {
      const fusionActions = this.detectFusionOpportunities(game, bot);
      if (fusionActions.length > 0 && bot?.debug) {
        console.log(
          `[LuminarchStrategy] ⚡ Fusion opportunities:`,
          fusionActions.map((a) => `${a.cardName} (pri ${a.priority})`)
        );
      }
      actions.push(...fusionActions);
    } catch (e) {
      if (bot?.debug) {
        console.warn(
          `[LuminarchStrategy] Erro ao detectar Fusions:`,
          e.message
        );
      }
    }

    // === P2: GAME TREE SEARCH (OPCIONAL, SÓ SE CRÍTICO) ===
    // CRITICAL: Não chamar P2 recursivamente durante simulação de árvore de jogo
    if (game._isPerspectiveState) {
      // Estamos dentro de uma simulação - apenas retornar ações ordenadas sem P2
      return this.sequenceActions(actions);
    }

    if (bot?.debug) {
      console.log(
        `\n[LuminarchStrategy] 📊 Resumo: ${bot.hand.length} cartas avaliadas → ${actions.length} ações geradas`
      );
      if (actions.length > 0) {
        console.log("  Ações:");
        actions.forEach((a) => {
          console.log(
            `    - ${a.type}: ${a.cardName || `index ${a.index}`} (priority: ${a.priority || 0})`
          );
        });
      } else {
        console.log("  ⚠️ NENHUMA AÇÃO GERADA");
      }
    }

    const finalActions = this.integrateP2IntoActionSelection(
      game,
      this.sequenceActions(actions)
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
        summon: 2,
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

  selectBestTributes(field, tributesNeeded, cardToSummon) {
    if (tributesNeeded <= 0 || !field || field.length < tributesNeeded) {
      return [];
    }

    const monstersWithValue = field.map((monster, index) => {
      const value = estimateMonsterValue(monster, {
        archetype: "Luminarch",
        fieldSpell: this.bot.fieldSpell,
        preferDefense: true,
      });
      return { monster, index, value };
    });

    monstersWithValue.sort((a, b) => a.value - b.value);
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
          card
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
        player.field.push(newCard);
        player.summonCount = (player.summonCount || 0) + 1;
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
      case "fieldEffect": {
        const player = state.bot;
        const fieldSpell = player.fieldSpell;
        if (!fieldSpell) break;
        const effect = (fieldSpell.effects || []).find(
          (entry) => entry && entry.timing === "on_field_activate"
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
      (entry) => entry && entry.timing === "on_play"
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
        (c) => c && c.name === "Polymerization"
      );
      if (polyInHand === -1) return actions;

      // Verificar se tem Megashield no Extra Deck
      const hasMegashield = bot.extraDeck.some(
        (c) => c && c.name === "Luminarch Megashield Barbarias"
      );
      if (!hasMegashield) return actions;

      // Megashield precisa: Luminarch Sanctum Protector + Luminarch Lv5+
      const hasProtector = bot.field.some(
        (c) => c && c.name === "Luminarch Sanctum Protector"
      );
      const lv5Plus = bot.field.filter(
        (c) =>
          c &&
          c.cardKind === "monster" &&
          c.archetype === "Luminarch" &&
          (c.level || 0) >= 5
      );

      if (hasProtector && lv5Plus.length > 0) {
        const priority = this.evaluateFusionPriority(
          "Luminarch Megashield Barbarias",
          bot,
          opponent,
          game
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
        e.message
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
      if (lp <= 2000) priority += 4; // 14
      else if (lp <= 3500) priority += 2; // 12

      // Boost se oponente dominando board
      const oppStrength = (opponent?.field || []).reduce(
        (sum, m) => sum + (m && m.atk ? m.atk : 0),
        0
      );
      if (oppStrength >= 8000) priority += 3; // Opp overwhelmingly strong
      else if (oppStrength >= 6000) priority += 1;

      // Boost se tem Citadel ativo (lifegain dobrado: 500 → 1000)
      const hasCitadel = bot.fieldSpell?.name?.includes("Citadel");
      if (hasCitadel) priority += 2; // Synergy suprema

      // Penalty se já tem tank forte no campo
      const hasFortress = bot.field.some(
        (c) => c && c.name === "Luminarch Fortress Aegis"
      );
      const has2800Tank = bot.field.some(
        (c) =>
          c &&
          c.cardKind === "monster" &&
          c.position === "defense" &&
          (c.def || 0) >= 2800
      );
      if (hasFortress || has2800Tank) priority -= 3; // Já tem wall supremo

      // Penalty se vai sacrificar material importante
      const willLoseProtector = bot.field.some(
        (c) => c && c.name === "Luminarch Sanctum Protector"
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
          (asc) => game.checkAscensionRequirements?.(bot, asc)?.ok
        );
        if (eligible.length === 0) return;

        // Avaliar prioridade de cada Ascension elegível
        eligible.forEach((ascensionCard) => {
          const priority = this.evaluateAscensionPriority(
            material,
            ascensionCard,
            bot,
            opponent,
            game
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
        e.message
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
      if (lp <= 3000) priority += 3; // 14
      else if (lp <= 5000) priority += 1; // 12

      // Boost se oponente tem board forte (precisa de wall)
      const oppStrength = (opponent?.field || []).reduce(
        (sum, m) => sum + (m && m.atk ? m.atk : 0),
        0
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
          (c.def || 0) <= 2000
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
        0
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
        0
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
        this.bot.lp || 8000
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
          a.type === gameTreeAction.type && a.index === gameTreeAction.index
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
