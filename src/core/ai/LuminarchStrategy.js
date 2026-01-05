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
        if (bot.field.length < tributeInfo.tributesNeeded) return;
        if (bot.field.length >= 5) return;

        // === SUICIDE CHECK ===
        const shouldSummon = this.shouldSummonMonsterSafely(
          card,
          game,
          opponent
        );
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

      if (
        game.effectEngine?.canActivateSpellFromHandPreview &&
        typeof game.effectEngine.canActivateSpellFromHandPreview === "function"
      ) {
        const preview = game.effectEngine.canActivateSpellFromHandPreview(
          card,
          bot,
          { activationContext }
        );
        if (preview && preview.ok === false) return;
      } else {
        const check = game.effectEngine?.canActivate?.(card, bot);
        if (check && !check.ok) return;
      }

      // === P1: Aplicar bônus de macro strategy ===
      let priority = 1;
      const macroBuff = calculateMacroPriorityBonus(
        "spell",
        card,
        macroStrategy
      );
      priority += macroBuff;

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
      });
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
        if (!preview || preview.ok) {
          actions.push({ type: "fieldEffect", priority: 0 });
        }
      }
    }

    // === P2: GAME TREE SEARCH (OPCIONAL, SÓ SE CRÍTICO) ===
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
    if (alt && playerState.field?.some((c) => c.name === alt.requiresName)) {
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
    if (position !== "defense") return false;
    if (!card) return true;
    if (card.mustBeAttacked || card.battleIndestructibleOncePerTurn) {
      return false;
    }
    const effects = Array.isArray(card.effects) ? card.effects : [];
    const hasSummonEffect = effects.some(
      (effect) => effect && effect.timing === "on_event" && effect.event
    );
    const hasIgnition = effects.some(
      (effect) => effect && effect.timing === "ignition"
    );
    return !(hasSummonEffect || hasIgnition);
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
   * === SUICIDE PREVENTION ===
   * Valida se é seguro summon monstro contra ameaças do oponente
   */
  shouldSummonMonsterSafely(card, game, opponent) {
    try {
      const cardATK = card.atk || 0;
      const cardDEF = card.def || 0;
      const oppField = opponent?.field || [];
      const oppStrongestATK = oppField.reduce(
        (max, m) => Math.max(max, m.atk || 0),
        0
      );
      const oppHasThreats = oppField.length > 0;

      // Se oponente tem monstro mais forte, avaliar risk
      const isSuicideSummon =
        oppHasThreats && cardATK < oppStrongestATK && cardATK > 0;
      const shouldDefensivePosition = isSuicideSummon && cardDEF >= cardATK;

      // Luminarch é mais defensivo: prefere DEF se unsafe
      if (isSuicideSummon) {
        // Opção 1: Summon em defense se DEF > ATK
        if (shouldDefensivePosition) {
          return {
            yes: true,
            position: "defense",
            priority: 2,
            reason: `DEF ${cardDEF} vs oponente ${oppStrongestATK} ATK`,
          };
        }

        // Opção 2: Skip summon se muito perigoso
        if (cardATK < oppStrongestATK - 500) {
          return {
            yes: false,
            reason: `${cardATK} ATK vs oponente ${oppStrongestATK} ATK = suicide`,
          };
        }

        // Opção 3: Summon em DEF mesmo se DEF < ATK (Luminarch é defensivo)
        return {
          yes: true,
          position: "defense",
          priority: 1,
          reason: `Posição defensiva por safety (opp ${oppStrongestATK} ATK)`,
        };
      }

      // Seguro: summon normalmente
      return {
        yes: true,
        priority: 3,
        reason: "Summon seguro",
      };
    } catch (e) {
      if (this.bot?.debug !== false) {
        console.warn(`[LuminarchStrategy] shouldSummonMonsterSafely erro:`, e);
      }
      return { yes: true, priority: 2 };
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
