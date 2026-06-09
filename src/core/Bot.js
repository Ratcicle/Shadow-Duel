import Player from "./Player.js";
import { getStrategyFor } from "./ai/StrategyRegistry.js";
import { botLogger } from "./BotLogger.js";
import { buildBotDeck, buildBotExtraDeck } from "./bot/deckBuilder.js";
import {
  getAvailableBotPresets,
  getBotDeckList,
  getBotExtraDeckList,
} from "./bot/presets.js";
import { executeBotMainPhaseAction } from "./bot/actionExecutor.js";
import { playBotMainPhase } from "./bot/mainPhaseController.js";
import {
  isSameBattleCard as isSameBattleCardForBot,
  playBotBattlePhase,
} from "./bot/battleController.js";
import {
  getAscensionPositionPreference as getAscensionPositionPreferenceForBot,
  selectBestAscension as selectBestAscensionForBot,
  tryAscensionIfAvailable as tryAscensionIfAvailableForBot,
} from "./bot/ascensionController.js";
import {
  cloneBotGameState,
  simulateBotMainPhaseAction,
  simulateBotSpellEffect,
} from "./bot/simulationBridge.js";
import {
  canResolveSummonActionForCurrentState as canResolveSummonActionForCurrentStateForBot,
  filterValidActionsForCurrentState as filterValidActionsForCurrentStateForBot,
  resolveHandIndexForAction as resolveHandIndexForBotAction,
  tributeMatchesAltRequirement as tributeMatchesAltRequirementForBot,
} from "./bot/actionValidation.js";

export default class Bot extends Player {
  constructor(archetype = "shadowheart") {
    super("bot", "Opponent", "ai");
    this.maxSimulationsPerPhase = 20;
    this.maxChainedActions = 6; // Aumentado de 3 para 6 - permite múltiplas ações + efeitos
    this.setPreset(archetype);
  }
  static getAvailablePresets() {
    return getAvailableBotPresets();
  }

  setPreset(presetId = "shadowheart") {
    const validIds = Bot.getAvailablePresets().map((p) => p.id);
    this.archetype = validIds.includes(presetId) ? presetId : "shadowheart";

    this.strategy = getStrategyFor(this.archetype, this);
  }

  // Sobrescreve buildDeck para usar deck do arquétipo selecionado
  buildDeck() {
    buildBotDeck(this);
  }

  // Deck Shadow-Heart otimizado para combos e fusões
  getShadowHeartDeck() {
    return getBotDeckList("shadowheart");
  }

  // Deck Luminarch completo (Tank/Control/Versatility) — 30 cards
  getLuminarchDeck() {
    return getBotDeckList("luminarch");
  }

  getVoidDeck() {
    return getBotDeckList("void");
  }

  getDragonDeck() {
    return getBotDeckList("dragon");
  }

  getArcanistDeck() {
    return getBotDeckList("arcanist");
  }

  // Sobrescreve buildExtraDeck para usar fusões do arquétipo
  buildExtraDeck() {
    buildBotExtraDeck(this);
  }

  // Extra Deck Shadow-Heart
  getShadowHeartExtraDeck() {
    return getBotExtraDeckList("shadowheart");
  }

  // Extra Deck Luminarch (Fusion + Ascension)
  getLuminarchExtraDeck() {
    return getBotExtraDeckList("luminarch");
  }

  getVoidExtraDeck() {
    return getBotExtraDeckList("void");
  }

  getDragonExtraDeck() {
    return getBotExtraDeckList("dragon");
  }

  getArcanistExtraDeck() {
    return getBotExtraDeckList("arcanist");
  }

  resolveOpponent(game) {
    if (!game) return null;
    if (typeof game.getOpponent === "function") {
      return game.getOpponent(this);
    }
    return this.id === "player" ? game.bot : game.player;
  }

  async makeMove(game) {
    if (!game || game.gameOver || game.isDisposed?.()) return;

    try {
      game._arenaTracker?.recordProgress?.("bot_make_move_enter", game, {
        actor: this.id,
      });
      game._arenaTracker?.recordProgress?.("bot_make_move_guard_before", game, {
        actor: this.id,
      });
      const guard = game.canStartAction({ actor: this, kind: "bot_turn" });
      console.log(`[Bot.makeMove] Guard check:`, guard);
      game._arenaTracker?.recordProgress?.("bot_make_move_guard_after", game, {
        actor: this.id,
        ok: !!guard.ok,
        reason: guard.reason || null,
      });
      if (!guard.ok) {
        console.log(`[Bot.makeMove] ❌ Guard blocked: ${guard.reason}`);
        return;
      }

      const phase = game.phase;
      console.log(`[Bot.makeMove] Phase: ${phase}`);
      game._arenaTracker?.recordProgress?.("bot_make_move_phase", game, {
        actor: this.id,
        phase,
      });

      if (phase === "main1" || phase === "main2") {
        await this.playMainPhase(game);
        game._arenaTracker?.recordProgress?.("bot_make_move_after_main_phase", game, {
          actor: this.id,
          phase,
        });
        if (!game.gameOver && !game.isDisposed?.() && game.phase === phase) {
          const actionDelayMs = Number.isFinite(game?.aiActionDelayMs)
            ? game.aiActionDelayMs
            : 500;
          setTimeout(() => {
            if (!game.isDisposed?.()) game.nextPhase();
          }, actionDelayMs);
        }
        return;
      }

      if (phase === "battle") {
        this.playBattlePhase(game);
        game._arenaTracker?.recordProgress?.("bot_make_move_after_battle_phase", game, {
          actor: this.id,
        });
        return;
      }

      if (phase === "end") {
        game.endTurn();
      }
    } catch (error) {
      game._arenaTracker?.recordProgress?.("bot_make_move_error", game, {
        actor: this.id,
        error: error?.message || String(error),
      });
      console.error(
        `[Bot.makeMove] ❌ FATAL ERROR in ${game.phase} phase:`,
        error,
      );
      console.error("[Bot.makeMove] Stack trace:", error.stack);
      // Fallback: forçar nextPhase para não travar o jogo
      if (
        !game.gameOver &&
        !game.isDisposed?.() &&
        typeof game.nextPhase === "function"
      ) {
        console.log("[Bot.makeMove] ⚠️ Forcing nextPhase() after error");
        game.nextPhase();
      }
    }
  }

  async playMainPhase(game) {
    return playBotMainPhase(this, game);
  }

  isSameBattleCard(candidate, original) {
    return isSameBattleCardForBot(candidate, original);
  }

  playBattlePhase(game) {
    return playBotBattlePhase(this, game);
  }

  evaluateBoard(gameOrState, perspectivePlayer) {
    return this.strategy.evaluateBoard(gameOrState, perspectivePlayer);
  }

  evaluateBoardV2(gameOrState, perspectivePlayer) {
    return this.strategy.evaluateBoardV2(gameOrState, perspectivePlayer);
  }

  generateMainPhaseActions(game) {
    const actions = this.strategy.generateMainPhaseActions(game);

    // 📊 Log de geração de ações
    if (botLogger) {
      const hand = this.hand || [];
      const field = this.field || [];
      const summonAvailable = (this.summonCount || 0) < 1;
      botLogger.logActionGeneration(
        this.id,
        game.turnCounter || 0,
        game.phase || "unknown",
        hand,
        field,
        summonAvailable,
        actions || [],
      );
    }

    return actions;
  }

  sequenceActions(actions) {
    return this.strategy.sequenceActions(actions);
  }

  getTributeRequirementFor(card, playerState) {
    return this.strategy.getTributeRequirementFor(card, playerState);
  }

  // Seleciona os melhores monstros para usar como tributo (os PIORES do campo)
  selectBestTributes(field, tributesNeeded, cardToSummon, context) {
    return this.strategy.selectBestTributes(
      field,
      tributesNeeded,
      cardToSummon,
      context,
    );
  }

  simulateMainPhaseAction(state, action) {
    return simulateBotMainPhaseAction(this, state, action);
  }

  simulateSpellEffect(state, card) {
    return simulateBotSpellEffect(this, state, card);
  }

  simulateBattle(state, attacker, target) {
    if (!attacker) return;
    if (attacker.cannotAttackThisTurn) return;
    if (attacker.position === "defense") return;

    let _extra = attacker.extraAttacks || 0;
    if (attacker.dynamicExtraAttacks?.source === "graveyard_count") {
      const dea = attacker.dynamicExtraAttacks;
      _extra = (state.bot?.graveyard || []).filter(c => c && c.name === dea.name).length;
      _extra -= 1;
    }
    const maxAttacks = 1 + _extra;
    const usedAttacks = attacker.attacksUsedThisTurn || 0;

    // Multi-attack mode allows more attacks
    const isMultiAttackMode = attacker.canAttackAllOpponentMonstersThisTurn;
    const multiAttackLimit = attacker.multiAttackLimit || 1;

    if (!isMultiAttackMode && usedAttacks >= maxAttacks) return;
    if (isMultiAttackMode && usedAttacks >= multiAttackLimit) return;

    const attackerOwner = state.bot;
    const defenderOwner = state.player;

    const attackStat = attacker.atk || 0;
    if (!target) {
      if (
        usedAttacks > 0 &&
        attacker.extraAttackTargetRestriction === "monster"
      ) {
        return;
      }
      defenderOwner.lp -= attackStat;
      attacker.attacksUsedThisTurn = usedAttacks + 1;
      // Multi-attack mode uses different limit
      const effectiveMax = isMultiAttackMode ? multiAttackLimit : maxAttacks;
      attacker.hasAttacked = attacker.attacksUsedThisTurn >= effectiveMax;
      return;
    }

    // 🎭 REGRA: Bot não pode ver DEF de monstros facedown
    // Estimar DEF baseado em média (1500) ao invés de usar valor real
    const targetStat =
      target.position === "attack"
        ? target.atk || 0
        : target.isFacedown
          ? 1500 // Estimativa: DEF médio de monstros
          : target.def || 0;
    if (target.position === "attack") {
      if (attackStat > targetStat) {
        defenderOwner.lp -= attackStat - targetStat;
        defenderOwner.graveyard.push(target);
        defenderOwner.field.splice(defenderOwner.field.indexOf(target), 1);
      } else if (attackStat < targetStat) {
        attackerOwner.lp -= targetStat - attackStat;
        attackerOwner.graveyard.push(attacker);
        attackerOwner.field.splice(attackerOwner.field.indexOf(attacker), 1);
      } else {
        attackerOwner.graveyard.push(attacker);
        defenderOwner.graveyard.push(target);
        attackerOwner.field.splice(attackerOwner.field.indexOf(attacker), 1);
        defenderOwner.field.splice(defenderOwner.field.indexOf(target), 1);
      }
    } else {
      // BUG #12 FIX: Target in defense position - consider piercing damage
      if (attackStat > targetStat) {
        // Attacker wins - destroy defender
        defenderOwner.graveyard.push(target);
        defenderOwner.field.splice(defenderOwner.field.indexOf(target), 1);
        // Check for piercing damage (inflict excess damage to LP)
        if (attacker.piercing) {
          const piercingDamage = attackStat - targetStat;
          defenderOwner.lp -= piercingDamage;
        }
      } else if (attackStat < targetStat) {
        // Attacker loses - take reflect damage
        attackerOwner.lp -= targetStat - attackStat;
      }
      // If attackStat === targetStat: tie, no damage, no destruction
    }
    attacker.attacksUsedThisTurn = usedAttacks + 1;
    // Multi-attack mode uses different limit
    const effectiveMax = isMultiAttackMode ? multiAttackLimit : maxAttacks;
    attacker.hasAttacked = attacker.attacksUsedThisTurn >= effectiveMax;
  }

  resolveHandIndexForAction(action, expectedKind) {
    return resolveHandIndexForBotAction(this, action, expectedKind);
  }

  tributeMatchesAltRequirement(card, alt) {
    return tributeMatchesAltRequirementForBot(card, alt);
  }

  canResolveSummonActionForCurrentState(action, game) {
    return canResolveSummonActionForCurrentStateForBot(this, action, game);
  }

  filterValidActionsForCurrentState(actions, game) {
    return filterValidActionsForCurrentStateForBot(this, actions, game);
  }

  async executeMainPhaseAction(game, action) {
    return executeBotMainPhaseAction(this, game, action);
  }

  cloneGameState(game) {
    return cloneBotGameState(this, game);
  }

  async tryAscensionIfAvailable(game) {
    return tryAscensionIfAvailableForBot(this, game);
  }

  /**
   * Seleciona a melhor Ascensão baseada no contexto do jogo.
   * @param {Array} eligible - Lista de ascensões elegíveis
   * @param {Object} material - Monstro material
   * @param {Object} game - Instância do jogo
   * @returns {Object} Melhor ascensão
   */
  selectBestAscension(eligible, material, game) {
    return selectBestAscensionForBot(this, eligible, material, game);
  }

  getAscensionPositionPreference(ascensionCard, material, game) {
    return getAscensionPositionPreferenceForBot(
      this,
      ascensionCard,
      material,
      game,
    );
  }
}
