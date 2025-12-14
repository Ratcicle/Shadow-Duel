import Card from "./Card.js";
import { cardDatabase } from "../data/cards.js";
import {
  ActionHandlerRegistry,
  registerDefaultHandlers,
} from "./ActionHandlers.js";

export default class EffectEngine {
  constructor(game) {
    this.game = game;

    // Initialize action handler registry
    this.actionHandlers = new ActionHandlerRegistry();
    registerDefaultHandlers(this.actionHandlers);
  }

  /**
   * Helper para realizar Special Summon com escolha de posição
   * @param {Object} card - A carta a ser invocada
   * @param {Object} player - O jogador que está invocando
   * @param {Object} options - Opções adicionais
   * @param {boolean} options.cannotAttackThisTurn - Se o monstro não pode atacar neste turno
   * @param {string} options.fromZone - Zona de origem (hand, deck, graveyard)
   * @returns {Promise<string>} - A posição escolhida ('attack' ou 'defense')
   */
  async chooseSpecialSummonPosition(card, player, options = {}) {
    // Bot sempre escolhe attack
    if (player.id === "bot") {
      return "attack";
    }

    // Player: mostrar modal de escolha de posição
    if (
      this.game.renderer &&
      typeof this.game.renderer.showSpecialSummonPositionModal === "function"
    ) {
      return new Promise((resolve) => {
        this.game.renderer.showSpecialSummonPositionModal(card, (choice) => {
          resolve(choice === "defense" ? "defense" : "attack");
        });
      });
    }

    // Fallback: attack
    return "attack";
  }

  /**
   * Check if card's effects are currently negated
   * @param {Object} card - The card to check
   * @returns {boolean} - True if effects are negated
   */
  isEffectNegated(card) {
    return card && card.effectsNegated === true;
  }

  checkOncePerTurn(card, player, effect) {
    if (!effect || !effect.oncePerTurn) {
      return { ok: true };
    }

    const key = effect?.oncePerTurnName || effect?.id || card.name;
    const currentTurn = this.game?.turnCounter ?? 0;
    const useCardScope =
      effect.oncePerTurnScope === "card" || effect.oncePerTurnPerCard;

    const usageStore =
      useCardScope && card
        ? (card.oncePerTurnUsageByName = card.oncePerTurnUsageByName || {})
        : (player.oncePerTurnUsageByName = player.oncePerTurnUsageByName || {});

    const lastTurn = usageStore[key];

    if (lastTurn === currentTurn) {
      return {
        ok: false,
        reason: "Once per turn effect already used this turn.",
      };
    }

    return { ok: true };
  }

  checkOncePerDuel(card, player, effect) {
    if (!effect || !effect.oncePerDuel || !player) {
      return { ok: true };
    }

    const key = effect.oncePerDuelName || effect.id || card?.name;
    player.oncePerDuelUsageByName =
      player.oncePerDuelUsageByName || Object.create(null);
    if (player.oncePerDuelUsageByName[key]) {
      return {
        ok: false,
        reason: "Once per duel effect already used.",
      };
    }
    return { ok: true };
  }

  registerOncePerDuelUsage(card, player, effect) {
    if (!effect || !effect.oncePerDuel || !player) {
      return;
    }

    const key = effect.oncePerDuelName || effect.id || card?.name;
    player.oncePerDuelUsageByName =
      player.oncePerDuelUsageByName || Object.create(null);
    player.oncePerDuelUsageByName[key] = true;
  }

  registerOncePerTurnUsage(card, player, effect) {
    if (!effect || !effect.oncePerTurn) {
      return;
    }

    const key = effect?.oncePerTurnName || effect?.id || card.name;
    const currentTurn = this.game?.turnCounter ?? 0;
    const useCardScope =
      effect.oncePerTurnScope === "card" || effect.oncePerTurnPerCard;

    const usageStore =
      useCardScope && card
        ? (card.oncePerTurnUsageByName = card.oncePerTurnUsageByName || {})
        : (player.oncePerTurnUsageByName = player.oncePerTurnUsageByName || {});

    usageStore[key] = currentTurn;
  }

  cardMatchesFilters(card, filters = {}) {
    if (!card) return false;
    if (filters.cardKind && card.cardKind !== filters.cardKind) return false;
    if (filters.name && card.name !== filters.name) return false;
    if (filters.archetype) {
      const archetypes = Array.isArray(card.archetypes)
        ? card.archetypes
        : card.archetype
        ? [card.archetype]
        : [];
      if (!archetypes.includes(filters.archetype)) return false;
    }
    if (filters.level !== undefined) {
      const lvl = card.level || 0;
      const op = filters.levelOp || "eq";
      if (op === "eq" && lvl !== filters.level) return false;
      if (op === "lte" && lvl > filters.level) return false;
      if (op === "gte" && lvl < filters.level) return false;
      if (op === "lt" && lvl >= filters.level) return false;
      if (op === "gt" && lvl <= filters.level) return false;
    }
    return true;
  }

  evaluateConditions(conditions, ctx) {
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return { ok: true };
    }

    const player = ctx?.player;
    const opponent = ctx?.opponent || this.game?.getOpponent?.(player);

    for (const cond of conditions) {
      if (!cond || !cond.type) continue;
      switch (cond.type) {
        case "playerFieldEmpty":
          if ((player?.field?.length || 0) !== 0) {
            return { ok: false, reason: "You must control no monsters." };
          }
          break;
        case "opponentMonstersMin":
          if ((opponent?.field?.length || 0) < (cond.min ?? 1)) {
            return {
              ok: false,
              reason: `Opponent must control at least ${cond.min ?? 1} monster(s).`,
            };
          }
          break;
        case "playerLpMin":
          if ((player?.lp ?? 0) < (cond.min ?? cond.amount ?? 0)) {
            return {
              ok: false,
              reason: `Need at least ${cond.min ?? cond.amount ?? 0} LP.`,
            };
          }
          break;
        case "graveyardHasMatch": {
          const ownerKey = cond.owner === "opponent" ? "opponent" : "player";
          const owner = ownerKey === "opponent" ? opponent : player;
          const zoneName = cond.zone || "graveyard";
          const zone = owner?.[zoneName] || [];
          const found = zone.some((card) =>
            this.cardMatchesFilters(card, cond.filters || {})
          );
          if (!found) {
            return {
              ok: false,
              reason: cond.reason || "No valid cards in graveyard.",
            };
          }
          break;
        }
        default:
          break;
      }
    }

    return { ok: true };
  }

  handleEvent(eventName, payload) {
    if (eventName === "after_summon") {
      return this.handleAfterSummonEvent(payload);
    } else if (eventName === "battle_destroy") {
      return this.handleBattleDestroyEvent(payload);
    } else if (eventName === "card_to_grave") {
      return this.handleCardToGraveEvent(payload);
    } else if (eventName === "attack_declared") {
      return this.handleAttackDeclaredEvent(payload);
    } else if (eventName === "standby_phase") {
      return this.handleStandbyPhaseEvent(payload);
    }
    return undefined;
  }

  async handleAfterSummonEvent(payload) {
    if (!payload || !payload.card || !payload.player) return;
    const { card, player, method } = payload;

    const sources = [card];
    if (player.fieldSpell) {
      sources.push(player.fieldSpell);
    }
    // Also check cards in hand for conditional summon effects
    if (player.hand && Array.isArray(player.hand)) {
      sources.push(...player.hand);
    }

    const opponent = this.game.getOpponent(player);

    // Get current phase for trap requirements
    const currentPhase = this.game?.phase;

    for (const sourceCard of sources) {
      if (!sourceCard.effects || !Array.isArray(sourceCard.effects)) continue;

      const sourceZone = this.findCardZone(player, sourceCard);

      const ctx = {
        source: sourceCard,
        player,
        opponent,
        summonedCard: card,
        summonMethod: method,
        currentPhase,
      };

      for (const effect of sourceCard.effects) {
        if (!effect || effect.timing !== "on_event") continue;
        if (effect.event !== "after_summon") continue;

        // Skip if effects are negated
        if (this.isEffectNegated(sourceCard)) {
          console.log(
            `${sourceCard.name} effects are negated, skipping effect.`
          );
          continue;
        }

        // Only allow hand-based triggers if explicitly intended
        if (sourceZone === "hand") {
          const requiresSelfInHand =
            effect?.condition?.requires === "self_in_hand";
          const isConditionalSummonFromHand = (effect.actions || []).some(
            (a) => a?.type === "conditional_special_summon_from_hand"
          );
          if (!requiresSelfInHand && !isConditionalSummonFromHand) {
            continue;
          }
        }

        const optCheck = this.checkOncePerTurn(sourceCard, player, effect);
        if (!optCheck.ok) {
          console.log(optCheck.reason);
          continue;
        }

        const duelCheck = this.checkOncePerDuel(sourceCard, player, effect);
        if (!duelCheck.ok) {
          console.log(duelCheck.reason);
          continue;
        }

        if (effect.summonMethod) {
          const methods = Array.isArray(effect.summonMethod)
            ? effect.summonMethod
            : [effect.summonMethod];
          if (!methods.includes(method)) {
            continue;
          }
        }

        // Check phase requirement (for trap cards that only activate in specific phases)
        if (effect.requirePhase) {
          const allowedPhases = Array.isArray(effect.requirePhase)
            ? effect.requirePhase
            : [effect.requirePhase];
          if (!allowedPhases.includes(currentPhase)) {
            continue;
          }
        }

        if (effect.condition) {
          const conditionMet = this.checkEffectCondition(
            effect.condition,
            sourceCard,
            player,
            card,
            sourceZone
          );
          if (!conditionMet) continue;
        }

        const targetResult = this.resolveTargets(
          effect.targets || [],
          ctx,
          null
        );

        if (targetResult.needsSelection) {
          if (
            this.game &&
            typeof this.game.startTriggeredTargetSelection === "function"
          ) {
            this.game.startTriggeredTargetSelection(
              sourceCard,
              effect,
              ctx,
              targetResult.options
            );
          } else {
            console.warn(
              "Triggered effect requires selection but game does not support triggered targeting."
            );
          }
          return;
        }

        if (targetResult.ok === false) {
          console.warn(
            "Triggered effect has no valid targets:",
            effect.id || effect,
            targetResult.reason
          );
          continue;
        }

        if (effect.promptUser === true && player === this.game.player) {
          const shouldActivate =
            await this.game.renderer.showConditionalSummonPrompt(
              sourceCard.name,
              effect.promptMessage || `Activate ${sourceCard.name}'s effect?`
            );
          if (!shouldActivate) continue;

          if (
            effect.actions &&
            effect.actions[0]?.type === "conditional_special_summon_from_hand"
          ) {
            const summonResult =
              await this.handleConditionalSpecialSummonFromHand(
                sourceCard,
                player,
                effect
              );
            if (!summonResult?.success) continue;
            this.registerOncePerTurnUsage(sourceCard, player, effect);
            this.registerOncePerDuelUsage(sourceCard, player, effect);
            this.game.checkWinCondition();
            return;
          }
        }

        this.applyActions(
          effect.actions || [],
          ctx,
          targetResult.targets || {}
        );
        this.registerOncePerTurnUsage(sourceCard, player, effect);
        this.registerOncePerDuelUsage(sourceCard, player, effect);
        this.game.checkWinCondition();
      }
    }

    this.updateVoidTenebrisHornBuffs();
  }

  checkEffectCondition(
    condition,
    sourceCard,
    player,
    summonedCard,
    sourceZone
  ) {
    if (!condition) return true;

    if (condition.requires === "self_in_hand") {
      // Effect card must currently be in the player's hand
      if (sourceZone !== "hand") {
        return false;
      }
      if (!player?.hand?.includes(sourceCard)) {
        return false;
      }
    }

    if (condition.triggerArchetype) {
      const archetypes = summonedCard.archetypes
        ? summonedCard.archetypes
        : summonedCard.archetype
        ? [summonedCard.archetype]
        : [];
      if (!archetypes.includes(condition.triggerArchetype)) {
        return false;
      }
    }

    return true;
  }

  applyVoidTenebrisHornBoost(card, boostValue) {
    if (!card || card.cardKind !== "monster") return false;
    const previous = card.voidTenebrisBuffValue ?? 0;
    if (previous === boostValue) {
      return false;
    }
    const delta = boostValue - previous;
    card.atk += delta;
    card.def += delta;
    card.voidTenebrisBuffValue = boostValue;
    return true;
  }

  // Helper to check if a card belongs to Void archetype
  isVoidArchetype(card) {
    if (!card || card.cardKind !== "monster") return false;
    if (card.archetype === "Void") return true;
    if (Array.isArray(card.archetypes) && card.archetypes.includes("Void"))
      return true;
    return false;
  }

  // Continuous effect: Void Tenebris Horn buff system
  // Note: This could be refactored into a more generic continuous effect handler
  updateVoidTenebrisHornBuffs() {
    if (!this.game) return false;
    const allFields = [
      ...(this.game.player.field || []),
      ...(this.game.bot.field || []),
    ].filter(Boolean);

    // Single pass optimization: count voids and find horns in one loop
    let voidCount = 0;
    const horns = [];

    for (const card of allFields) {
      if (!card || card.cardKind !== "monster") continue;

      // Check if it's a Void card
      if (this.isVoidArchetype(card)) {
        voidCount++;
      }

      // Check if it's a Void Tenebris Horn
      if (card.name === "Void Tenebris Horn") {
        horns.push(card);
      }
    }

    const boostValue = voidCount * 100;

    let updated = false;
    for (const horn of horns) {
      const refreshed = this.applyVoidTenebrisHornBoost(horn, boostValue);
      if (refreshed) {
        updated = true;
      }
    }

    return updated;
  }

  isImmuneToOpponentEffects(card, sourcePlayer) {
    if (
      !card ||
      !card.immuneToOpponentEffectsUntilTurn ||
      !sourcePlayer ||
      !card.owner
    ) {
      return false;
    }

    const currentTurn = this.game?.turnCounter ?? 0;
    if (currentTurn > card.immuneToOpponentEffectsUntilTurn) {
      return false;
    }

    return card.owner !== sourcePlayer.id;
  }

  shouldSkipActionDueToImmunity(action, targets, ctx) {
    if (!action || !action.targetRef || !ctx?.player) return false;
    const targetCards = targets?.[action.targetRef];
    if (!Array.isArray(targetCards) || targetCards.length === 0) return false;

    for (const card of targetCards) {
      if (this.isImmuneToOpponentEffects(card, ctx.player)) {
        if (this.game?.renderer?.log) {
          this.game.renderer.log(
            `${card.name} está imune aos efeitos do oponente e ignora ${action.type}.`
          );
        }
        return true;
      }
    }

    return false;
  }

  async handleTriggeredEffect(sourceCard, effect, ctx) {
    const optCheck = this.checkOncePerTurn(sourceCard, ctx.player, effect);
    if (!optCheck.ok) {
      console.log(optCheck.reason);
      return { success: false, reason: optCheck.reason };
    }

    const duelCheck = this.checkOncePerDuel(sourceCard, ctx.player, effect);
    if (!duelCheck.ok) {
      console.log(duelCheck.reason);
      return { success: false, reason: duelCheck.reason };
    }

    const targetResult = this.resolveTargets(effect.targets || [], ctx, null);

    if (targetResult.needsSelection) {
      return {
        success: false,
        needsSelection: true,
        options: targetResult.options,
      };
    }

    if (targetResult.ok === false) {
      return { success: false, reason: targetResult.reason };
    }

    // Don't apply actions here for conditional_special_summon_from_hand
    // as it's handled separately in handleConditionalSpecialSummonFromHand
    const isConditionalSummon =
      effect.actions &&
      effect.actions[0]?.type === "conditional_special_summon_from_hand";

    if (!isConditionalSummon) {
      this.applyActions(effect.actions || [], ctx, targetResult.targets || {});
      this.registerOncePerTurnUsage(sourceCard, ctx.player, effect);
      this.registerOncePerDuelUsage(sourceCard, ctx.player, effect);
      this.game.checkWinCondition();
    }

    return { success: true };
  }

  async handleConditionalSpecialSummonFromHand(card, player, effect) {
    if (!card || !player || card.cardKind !== "monster") {
      return { success: false, reason: "Invalid card or player." };
    }

    if (!player.hand || !player.hand.includes(card)) {
      return { success: false, reason: "Card is not in hand." };
    }

    const opponent = this.game.getOpponent(player);
    const ctx = {
      source: card,
      player,
      opponent,
      activationZone: "hand",
    };

    const triggerResult = await this.handleTriggeredEffect(card, effect, ctx);
    if (!triggerResult.success) {
      return triggerResult;
    }

    const finishSummon = async (position) => {
      const pos = position || "attack";

      card.position = pos;
      card.isFacedown = false;
      card.hasAttacked = false;
      card.cannotAttackThisTurn = effect.restrictAttackThisTurn ? true : false;

      if (this.game && typeof this.game.moveCard === "function") {
        this.game.moveCard(card, player, "field", {
          fromZone: "hand",
          position: pos,
          isFacedown: false,
          resetAttackFlags: true,
        });
      } else {
        const idx = player.hand.indexOf(card);
        if (idx > -1) {
          player.hand.splice(idx, 1);
        }
        player.field.push(card);
      }

      if (this.game && typeof this.game.updateBoard === "function") {
        this.game.updateBoard();
      }
    };

    if (
      this.game &&
      player === this.game.player &&
      typeof this.game.chooseSpecialSummonPosition === "function"
    ) {
      const positionChoice = this.game.chooseSpecialSummonPosition(
        player,
        card
      );
      if (positionChoice && typeof positionChoice.then === "function") {
        await positionChoice.then((pos) => finishSummon(pos));
      } else {
        await finishSummon(positionChoice);
      }
    } else {
      await finishSummon("attack");
    }

    return { success: true };
  }

  async handleBattleDestroyEvent(payload) {
    if (!payload || !payload.attacker || !payload.destroyed) return;

    const {
      player,
      opponent,
      attacker,
      destroyed,
      attackerOwner,
      destroyedOwner,
    } = payload;

    const participants = [
      { owner: player, other: opponent },
      { owner: opponent, other: player },
    ];

    for (const side of participants) {
      const owner = side.owner;
      if (!owner) continue;

      const equipSpells = (owner.spellTrap || []).filter(
        (c) => c && c.subtype === "equip" && c.equippedTo
      );

      const fieldCards = [
        ...(owner.field || []),
        owner.fieldSpell,
        ...equipSpells,
      ].filter(Boolean);

      const handCards = owner.hand || [];
      const triggerSources = [...fieldCards, ...handCards];
      if (
        destroyed &&
        destroyedOwner === owner &&
        !triggerSources.includes(destroyed)
      ) {
        triggerSources.push(destroyed);
      }

      for (const card of triggerSources) {
        if (!card || !card.effects || !Array.isArray(card.effects)) continue;

        const ctx = {
          source: card,
          player: owner,
          opponent: side.other,
          attacker,
          destroyed,
          attackerOwner: attackerOwner || this.getOwnerByCard(attacker),
          destroyedOwner: destroyedOwner || this.getOwnerByCard(destroyed),
          host: card.equippedTo || null,
        };

        for (const effect of card.effects) {
          if (!effect || effect.timing !== "on_event") continue;
          if (effect.event !== "battle_destroy") continue;

          // Skip if effects are negated
          if (this.isEffectNegated(card)) {
            console.log(`${card.name} effects are negated, skipping effect.`);
            continue;
          }

          const optCheck = this.checkOncePerTurn(card, owner, effect);
          if (!optCheck.ok) {
            console.log(optCheck.reason);
            continue;
          }

          const duelCheck = this.checkOncePerDuel(card, owner, effect);
          if (!duelCheck.ok) {
            console.log(duelCheck.reason);
            continue;
          }

          if (effect.requireSelfAsAttacker && ctx.attacker !== card) continue;
          if (effect.requireSelfAsDestroyed && ctx.destroyed !== card) continue;
          if (effect.requireDestroyedIsOpponent) {
            const destroyedOwnerId =
              (ctx.destroyedOwner && ctx.destroyedOwner.id) || ctx.destroyedOwner;
            const opponentId = side.other?.id;
            if (!destroyedOwnerId || destroyedOwnerId !== opponentId) continue;
          }
          if (effect.requireEquippedAsAttacker) {
            if (!card.equippedTo) continue;
            if (ctx.attacker !== card.equippedTo) continue;
          }

          if (
            effect.promptUser === true &&
            this.game &&
            this.game.renderer &&
            typeof this.game.renderer.showConditionalSummonPrompt === "function" &&
            owner === this.game.player
          ) {
            const shouldActivate = await this.game.renderer.showConditionalSummonPrompt(
              card.name,
              effect.promptMessage || `Activate ${card.name}'s effect?`
            );
            if (!shouldActivate) continue;
          }

          const targetResult = this.resolveTargets(
            effect.targets || [],
            ctx,
            null
          );

          if (targetResult.needsSelection) {
            if (
              this.game &&
              typeof this.game.startTriggeredTargetSelection === "function"
            ) {
              this.game.startTriggeredTargetSelection(
                card,
                effect,
                ctx,
                targetResult.options
              );
            } else {
              console.warn(
                "Triggered battle_destroy effect requires selection but game does not support triggered targeting."
              );
            }
            return;
          }

          if (targetResult.ok === false) {
            console.warn(
              "Triggered battle_destroy effect has no valid targets:",
              effect.id || effect,
              targetResult.reason
            );
            continue;
          }

          this.applyActions(
            effect.actions || [],
            ctx,
            targetResult.targets || {}
          );
          this.registerOncePerTurnUsage(card, owner, effect);
          this.registerOncePerDuelUsage(card, owner, effect);
          this.game.checkWinCondition();
        }
      }
    }

    this.updateVoidTenebrisHornBuffs();
  }

  async handleAttackDeclaredEvent(payload) {
    if (
      !payload ||
      !payload.attacker ||
      !payload.attackerOwner ||
      !payload.defenderOwner
    ) {
      return;
    }

    const attackerOwner = payload.attackerOwner;
    const defenderOwner = payload.defenderOwner;

    const participants = [
      { owner: attackerOwner, other: defenderOwner },
      { owner: defenderOwner, other: attackerOwner },
    ];

    for (const side of participants) {
      const player = side.owner;
      const opponent = side.other;
      if (!player) continue;

      const sources = [...(player.field || [])];
      if (player.fieldSpell) {
        sources.push(player.fieldSpell);
      }

      for (const card of sources) {
        if (!card || !card.effects || !Array.isArray(card.effects)) continue;

        for (const effect of card.effects) {
          if (!effect || effect.timing !== "on_event") continue;
          if (effect.event !== "attack_declared") continue;

          // Skip if effects are negated
          if (this.isEffectNegated(card)) {
            console.log(`${card.name} effects are negated, skipping effect.`);
            continue;
          }

          const optCheck = this.checkOncePerTurn(card, player, effect);
          if (!optCheck.ok) {
            console.log(optCheck.reason);
            continue;
          }

          if (
            effect.requireOpponentAttack === true &&
            payload.attackerOwner?.id !== opponent?.id
          ) {
            continue;
          }

          if (
            effect.requireDefenderIsSelf === true &&
            payload.defenderOwner?.id !== player?.id
          ) {
            continue;
          }

          if (effect.requireDefenderPosition === true) {
            const defenderCard = payload.defender;
            if (!defenderCard || defenderCard.position !== "defense") {
              continue;
            }
          }

          const shouldPrompt =
            effect.speed === 2 && effect.promptOnAttackDeclared !== false;
          if (player.id === "player" && shouldPrompt) {
            let wantsToUse = true;

            // Use custom prompt if renderer provides one for this effect
            const customPromptMethod = effect.customPromptMethod;
            if (
              customPromptMethod &&
              this.game?.renderer?.[customPromptMethod]
            ) {
              wantsToUse = await this.game.renderer[customPromptMethod]();
            } else {
              wantsToUse = window.confirm(
                `Use ${card.name}'s effect to negate the attack?`
              );
            }

            if (!wantsToUse) continue;
          }

          const ctx = {
            source: card,
            player,
            opponent,
            attacker: payload.attacker,
            target: payload.target || null,
            attackerOwner: payload.attackerOwner,
            defenderOwner: payload.defenderOwner,
          };

          const targetResult = this.resolveTargets(
            effect.targets || [],
            ctx,
            null
          );

          if (targetResult?.needsSelection) {
            if (
              this.game &&
              typeof this.game.startTriggeredTargetSelection === "function"
            ) {
              this.game.startTriggeredTargetSelection(
                card,
                effect,
                ctx,
                targetResult.options
              );
            } else {
              console.warn(
                "attack_declared effect requires selection but game does not support triggered targeting."
              );
            }
            return;
          }

          if (targetResult && targetResult.ok === false) {
            console.warn(
              "Triggered attack_declared effect has no valid targets:",
              effect.id || effect,
              targetResult.reason
            );
            continue;
          }

          this.applyActions(
            effect.actions || [],
            ctx,
            targetResult?.targets || {}
          );
          this.registerOncePerTurnUsage(card, player, effect);
          this.game.checkWinCondition();
        }
      }
    }
  }

  handleCardToGraveEvent(payload) {
    const { card, player, opponent, fromZone, toZone } = payload || {};
    if (!card || !player) return;
    if (!card.effects || !Array.isArray(card.effects)) return;

    console.log(
      `[handleCardToGraveEvent] ${card.name} entered graveyard. card.owner="${card.owner}", ctx.player.id="${player.id}", ctx.opponent.id="${opponent.id}", wasDestroyed=${payload.wasDestroyed}`
    );
    console.log(
      `[handleCardToGraveEvent] ${card.name} entered graveyard from ${fromZone}. Card has ${card.effects.length} effects.`
    );

    const ctx = {
      source: card,
      player,
      opponent,
      fromZone,
      toZone,
    };

    for (const effect of card.effects) {
      if (!effect || effect.timing !== "on_event") {
        console.log(`[handleCardToGraveEvent] Skipping effect: not on_event`);
        continue;
      }
      if (effect.event !== "card_to_grave") {
        console.log(
          `[handleCardToGraveEvent] Skipping effect: event is ${effect.event}, not card_to_grave`
        );
        continue;
      }

      // Skip if effects are negated
      if (this.isEffectNegated(card)) {
        console.log(
          `[handleCardToGraveEvent] ${card.name} effects are negated, skipping effect.`
        );
        continue;
      }

      console.log(
        `[handleCardToGraveEvent] Found card_to_grave effect: ${effect.id}`
      );

      if (effect.requireSelfAsDestroyed && !payload.wasDestroyed) {
        console.log(
          `[handleCardToGraveEvent] Skipping ${effect.id}: requires destruction.`
        );
        continue;
      }

      const optCheck = this.checkOncePerTurn(card, player, effect);
      if (!optCheck.ok) {
        console.log(
          `[handleCardToGraveEvent] Once per turn check failed: ${optCheck.reason}`
        );
        continue;
      }

      const duelCheck = this.checkOncePerDuel(card, player, effect);
      if (!duelCheck.ok) {
        console.log(
          `[handleCardToGraveEvent] Once per duel check failed: ${duelCheck.reason}`
        );
        continue;
      }

      console.log(
        `[handleCardToGraveEvent] fromZone check: effect.fromZone="${effect.fromZone}", actual fromZone="${fromZone}"`
      );

      if (
        effect.fromZone &&
        effect.fromZone !== "any" &&
        effect.fromZone !== fromZone
      ) {
        console.log(
          `[handleCardToGraveEvent] Skipping: fromZone mismatch (${effect.fromZone} !== ${fromZone})`
        );
        continue;
      }

      console.log(
        `[card_to_grave] About to resolve targets for ${
          card.name
        }. Targets definition: ${JSON.stringify(effect.targets)}`
      );

      const targetResult = this.resolveTargets(effect.targets || [], ctx, null);

      console.log(
        `[card_to_grave] ${card.name} effect "${effect.id}" - needsSelection: ${
          targetResult.needsSelection
        }, ok: ${targetResult.ok}, targetResult: ${JSON.stringify(
          targetResult
        )}`
      );

      if (targetResult.needsSelection) {
        if (
          this.game &&
          typeof this.game.startTriggeredTargetSelection === "function"
        ) {
          console.log(
            `[card_to_grave] Starting triggered selection for ${card.name}`
          );
          this.game.startTriggeredTargetSelection(
            card,
            effect,
            ctx,
            targetResult.options
          );
        } else {
          console.warn(
            "card_to_grave effect requires selection but no UI is available."
          );
        }
        return;
      }

      if (targetResult.ok === false) {
        console.warn(
          "card_to_grave effect has no valid targets:",
          effect.id || effect,
          targetResult.reason
        );
        continue;
      }

      this.applyActions(effect.actions || [], ctx, targetResult.targets || {});
      this.registerOncePerTurnUsage(card, player, effect);
      this.registerOncePerDuelUsage(card, player, effect);
      this.game.checkWinCondition();
    }
  }

  handleStandbyPhaseEvent(payload) {
    if (!payload || !payload.player) return;

    const owner = payload.player;
    const opponent = payload.opponent || this.game.getOpponent(owner);

    const cards = [
      ...(owner.field || []),
      ...(owner.spellTrap || []),
      owner.fieldSpell,
    ].filter(Boolean);

    for (const card of cards) {
      if (!card.effects || !Array.isArray(card.effects)) continue;

      const ctx = {
        source: card,
        player: owner,
        opponent,
        host: card.equippedTo || null,
      };

      for (const effect of card.effects) {
        if (!effect || effect.timing !== "on_event") continue;
        if (effect.event !== "standby_phase") continue;

        // Skip if effects are negated
        if (this.isEffectNegated(card)) {
          console.log(`${card.name} effects are negated, skipping effect.`);
          continue;
        }

        const optCheck = this.checkOncePerTurn(card, owner, effect);
        if (!optCheck.ok) {
          console.log(optCheck.reason);
          continue;
        }

        const duelCheck = this.checkOncePerDuel(card, owner, effect);
        if (!duelCheck.ok) {
          console.log(duelCheck.reason);
          continue;
        }

        this.applyActions(effect.actions || [], ctx, {});
        this.registerOncePerTurnUsage(card, owner, effect);
        this.registerOncePerDuelUsage(card, owner, effect);
        this.game.checkWinCondition();
      }
    }
  }

  resolveTriggeredSelection(effect, ctx, selections) {
    if (!effect) return;

    const optCheck = this.checkOncePerTurn(ctx.source, ctx.player, effect);
    if (!optCheck.ok) {
      console.log(optCheck.reason);
      return;
    }

    const targetResult = this.resolveTargets(
      effect.targets || [],
      ctx,
      selections || null
    );

    if (targetResult.needsSelection) {
      console.warn(
        "resolveTriggeredSelection called but still needsSelection; aborting."
      );
      return;
    }

    if (targetResult.ok === false) {
      console.warn(
        "Triggered effect has no valid targets after selection:",
        effect.id || effect,
        targetResult.reason
      );
      return;
    }

    this.applyActions(effect.actions || [], ctx, targetResult.targets || {});
    this.registerOncePerTurnUsage(ctx.source, ctx.player, effect);
    this.game.checkWinCondition();
  }

  getHandActivationEffect(card) {
    if (!card || !Array.isArray(card.effects)) {
      return null;
    }
    return card.effects.find((e) => e && e.timing === "on_play") || null;
  }

  activateFromHand(
    card,
    player,
    handIndex,
    selections = null,
    activationZone = "hand"
  ) {
    const check = this.canActivate(card, player);
    if (!check.ok) {
      return { success: false, reason: check.reason };
    }

    const effect = this.getHandActivationEffect(card);
    const isFieldSpell =
      card.cardKind === "spell" && card.subtype === "field";
    const isContinuousSpell =
      card.cardKind === "spell" && card.subtype === "continuous";
    const placementOnly = !effect && (isFieldSpell || isContinuousSpell);

    if (!effect && !placementOnly) {
      return { success: false, reason: "No on_play effect defined." };
    }

    // Verificação de campo vazio para spells do tipo equip com requireEmptyField
    if (
      effect &&
      card.cardKind === "spell" &&
      card.subtype === "equip" &&
      effect.requireEmptyField
    ) {
      if (player.field && player.field.length > 0) {
        return {
          success: false,
          reason: "Você deve controlar nenhum monstro para ativar este efeito.",
        };
      }
    }

    if (effect) {
      const optCheck = this.checkOncePerTurn(card, player, effect);
      if (!optCheck.ok) {
        return { success: false, reason: optCheck.reason };
      }

      const duelCheck = this.checkOncePerDuel(card, player, effect);
      if (!duelCheck.ok) {
        return { success: false, reason: duelCheck.reason };
      }
    }

    let resolvedActivationZone = activationZone || "hand";

    const ctx = {
      source: card,
      player,
      opponent: this.game.getOpponent(player),
      activationZone: resolvedActivationZone,
    };

    if (isFieldSpell) {
      if (this.game && typeof this.game.moveCard === "function") {
        this.game.moveCard(card, player, "fieldSpell", {
          fromZone: "hand",
          isFacedown: false,
        });
      } else {
        const idx = player.hand.indexOf(card);
        if (idx > -1) {
          player.hand.splice(idx, 1);
        }
        player.fieldSpell = card;
        card.owner = player.id;
      }

      resolvedActivationZone = "fieldSpell";
      ctx.activationZone = resolvedActivationZone;
    } else if (isContinuousSpell && resolvedActivationZone === "hand") {
      if (this.game && typeof this.game.moveCard === "function") {
        this.game.moveCard(card, player, "spellTrap", {
          fromZone: "hand",
          isFacedown: false,
        });
      } else {
        const idx = player.hand.indexOf(card);
        if (idx > -1) {
          player.hand.splice(idx, 1);
        }
        player.spellTrap = player.spellTrap || [];
        player.spellTrap.push(card);
        card.owner = player.id;
        card.isFacedown = false;
      }

      resolvedActivationZone = "spellTrap";
      ctx.activationZone = resolvedActivationZone;
    }

    if (placementOnly) {
      return { success: true, placementOnly: true };
    }

    const skipImmediateResolution = effect && effect.manualActivationOnly;

    if (skipImmediateResolution) {
      return { success: true };
    }

    const targetResult = this.resolveTargets(
      effect.targets || [],
      ctx,
      selections
    );
    if (targetResult.needsSelection) {
      return {
        success: false,
        needsSelection: true,
        options: targetResult.options,
      };
    }

    if (!targetResult.ok) {
      return { success: false, reason: targetResult.reason };
    }

    this.applyActions(effect.actions || [], ctx, targetResult.targets);
    this.registerOncePerTurnUsage(card, player, effect);
    this.game.checkWinCondition();

    if (card.cardKind === "spell") {
      if (isFieldSpell || isContinuousSpell) {
        return { success: true };
      }

      // Equip Spells serão movidas para a zona de spell/trap na própria action.
      if (card.subtype === "equip") {
        return { success: true };
      }
    }

    if (this.game && typeof this.game.moveCard === "function") {
      const fromZone =
        resolvedActivationZone === "spellTrap"
          ? "spellTrap"
          : resolvedActivationZone === "fieldSpell"
          ? "fieldSpell"
          : "hand";
      this.game.moveCard(card, player, "graveyard", { fromZone });
    } else {
      player.graveyard.push(card);
    }

    return { success: true };
  }

  activateMonsterFromField(card, player, fieldIndex, selections = null) {
    if (!card || !player) {
      return { success: false, reason: "Missing card or player." };
    }
    if (this.game?.turn !== player.id) {
      return { success: false, reason: "Not your turn." };
    }
    if (this.game?.phase !== "main1" && this.game?.phase !== "main2") {
      return {
        success: false,
        reason: "Effect can only be used in Main Phase.",
      };
    }
    if (card.cardKind !== "monster") {
      return {
        success: false,
        reason: "Only monsters can activate from field.",
      };
    }
    if (card.isFacedown) {
      return {
        success: false,
        reason: "Cannot activate facedown monster effects.",
      };
    }
    if (!player.field || !player.field.includes(card)) {
      return { success: false, reason: "Monster is not on the field." };
    }

    // Check if effects are negated
    if (this.isEffectNegated(card)) {
      return {
        success: false,
        reason: "Card's effects are currently negated.",
      };
    }

    const effect = (card.effects && card.effects[0]) || null;
    if (!effect) {
      return { success: false, reason: "No effect defined." };
    }
    if (effect.timing && effect.timing !== "ignition") {
      return { success: false, reason: "Effect is not ignition timing." };
    }

    const optCheck = this.checkOncePerTurn(card, player, effect);
    if (!optCheck.ok) {
      return { success: false, reason: optCheck.reason };
    }

    const ctx = {
      source: card,
      player,
      opponent: this.game.getOpponent(player),
      activationZone: "field",
    };

    const targetResult = this.resolveTargets(
      effect.targets || [],
      ctx,
      selections
    );

    if (targetResult.needsSelection) {
      return {
        success: false,
        needsSelection: true,
        options: targetResult.options,
      };
    }

    if (!targetResult.ok) {
      return { success: false, reason: targetResult.reason };
    }

    this.applyActions(effect.actions || [], ctx, targetResult.targets);
    this.registerOncePerTurnUsage(card, player, effect);
    this.game.checkWinCondition();
    return { success: true };
  }

  activateMonsterFromGraveyard(card, player, selections = null) {
    if (!card || !player) {
      return { success: false, reason: "Missing card or player." };
    }
    if (this.game?.turn !== player.id) {
      return { success: false, reason: "Not your turn." };
    }
    if (this.game?.phase !== "main1" && this.game?.phase !== "main2") {
      return {
        success: false,
        reason: "Effect can only be used in Main Phase.",
      };
    }
    if (card.cardKind !== "monster") {
      return {
        success: false,
        reason: "Only monsters can activate from graveyard.",
      };
    }
    if (!player.graveyard || !player.graveyard.includes(card)) {
      return { success: false, reason: "Monster is not in the graveyard." };
    }

    // Busca efeito ignition com requireZone: "graveyard"
    const effect = card.effects?.find(
      (e) => e.timing === "ignition" && e.requireZone === "graveyard"
    );

    if (!effect) {
      return { success: false, reason: "No graveyard ignition effect." };
    }

    const optCheck = this.checkOncePerTurn(card, player, effect);
    if (!optCheck.ok) {
      return { success: false, reason: optCheck.reason };
    }

    const duelCheck = this.checkOncePerDuel(card, player, effect);
    if (!duelCheck.ok) {
      return { success: false, reason: duelCheck.reason };
    }

    const ctx = {
      source: card,
      player,
      opponent: this.game.getOpponent(player),
      activationZone: "graveyard",
    };

    const targetResult = this.resolveTargets(
      effect.targets || [],
      ctx,
      selections
    );

    if (targetResult.needsSelection) {
      return {
        success: false,
        needsSelection: true,
        options: targetResult.options,
      };
    }

    if (!targetResult.ok) {
      return { success: false, reason: targetResult.reason };
    }

    this.applyActions(effect.actions || [], ctx, targetResult.targets);
    this.registerOncePerTurnUsage(card, player, effect);
    this.registerOncePerDuelUsage(card, player, effect);
    this.game.checkWinCondition();
    return { success: true };
  }

  activateFieldSpell(card, player, selections = null) {
    if (!card || card.cardKind !== "spell" || card.subtype !== "field") {
      return { success: false, reason: "Not a field spell." };
    }

    const check = this.canActivate(card, player);
    if (!check.ok) {
      return { success: false, reason: check.reason };
    }

    const effect = (card.effects || []).find(
      (e) => e && e.timing === "on_field_activate"
    );

    if (!effect) {
      return { success: false, reason: "No field activation effect." };
    }

    const optCheck = this.checkOncePerTurn(card, player, effect);
    if (!optCheck.ok) {
      return { success: false, reason: optCheck.reason };
    }

    // Check requireEmptyField condition
    if (effect.requireEmptyField && player.field.length > 0) {
      return {
        success: false,
        reason: "You must control no monsters to activate this effect.",
      };
    }

    const ctx = {
      source: card,
      player,
      opponent: this.game.getOpponent(player),
      activationZone: "fieldSpell",
    };

    const targetResult = this.resolveTargets(
      effect.targets || [],
      ctx,
      selections
    );

    if (targetResult.needsSelection) {
      return {
        success: false,
        needsSelection: true,
        options: targetResult.options,
      };
    }

    if (!targetResult.ok) {
      return { success: false, reason: targetResult.reason };
    }

    this.applyActions(effect.actions || [], ctx, targetResult.targets);
    this.registerOncePerTurnUsage(card, player, effect);
    this.game.checkWinCondition();

    return { success: true };
  }

  async activateSpellTrapEffect(
    card,
    player,
    selections = null,
    activationZone = "spellTrap"
  ) {
    if (!card || !player) {
      return { success: false, reason: "Missing card or player." };
    }
    if (card.owner !== player.id) {
      return {
        success: false,
        reason: "Card does not belong to the requesting player.",
      };
    }
    if (card.cardKind !== "spell" && card.cardKind !== "trap") {
      return {
        success: false,
        reason: "Only Spell/Trap cards can use this effect.",
      };
    }
    if (card.isFacedown) {
      return { success: false, reason: "Card must be face-up to activate." };
    }
    if (this.game.turn !== player.id) {
      return { success: false, reason: "Not your turn." };
    }
    if (this.game.phase !== "main1" && this.game.phase !== "main2") {
      return {
        success: false,
        reason: "Effect can only be activated during Main Phase.",
      };
    }

    const placementOnly =
      card.subtype === "field" || card.subtype === "continuous";
    let effect = (card.effects || []).find(
      (e) =>
        e &&
        (e.timing === "ignition" ||
          (e.timing === "on_activate" && card.cardKind === "trap"))
    );
    if (!effect) {
      if (!placementOnly && card.cardKind === "spell") {
        effect = (card.effects || []).find((e) => e && e.timing === "on_play");
      } else {
        return placementOnly
          ? { success: true }
          : { success: false, reason: "No ignition effect defined." };
      }
    }

    // Check requireEmptyField condition
    if (effect.requireEmptyField && player.field.length > 0) {
      return {
        success: false,
        reason: "You must control no monsters to activate this effect.",
      };
    }

    const ctx = {
      source: card,
      player,
      opponent: this.game.getOpponent(player),
      activationZone,
    };

    const condCheck = this.evaluateConditions(effect.conditions, ctx);
    if (!condCheck.ok) {
      return { success: false, reason: condCheck.reason };
    }

    const optCheck = this.checkOncePerTurn(card, player, effect);
    if (!optCheck.ok) {
      return { success: false, reason: optCheck.reason };
    }

    console.log(`[EffectEngine] Resolving targets for ${card.name}`);
    const targetResult = this.resolveTargets(
      effect.targets || [],
      ctx,
      selections
    );
    if (targetResult.needsSelection) {
      console.log(`[EffectEngine] Needs selection`);
      return { needsSelection: true, options: targetResult.options };
    }

    if (targetResult.ok === false) {
      console.log(
        `[EffectEngine] Target resolution failed: ${targetResult.reason}`
      );
      return { success: false, reason: targetResult.reason };
    }

    await this.applyActions(
      effect.actions || [],
      ctx,
      targetResult.targets || {}
    );
    this.registerOncePerTurnUsage(card, player, effect);
    this.game.checkWinCondition();
    return { success: true };
  }

  activateMonsterEffect(
    card,
    player,
    selections = null,
    activationZone = "field"
  ) {
    if (!card || !player) {
      return { success: false, reason: "Missing card or player." };
    }
    if (card.owner !== player.id) {
      return {
        success: false,
        reason: "Card does not belong to the requesting player.",
      };
    }
    if (card.cardKind !== "monster") {
      return {
        success: false,
        reason: "Only Monster cards can use this effect.",
      };
    }
    if (card.isFacedown) {
      return { success: false, reason: "Card must be face-up to activate." };
    }
    if (this.game.turn !== player.id) {
      return { success: false, reason: "Not your turn." };
    }
    if (this.game.phase !== "main1" && this.game.phase !== "main2") {
      return {
        success: false,
        reason: "Effect can only be activated during Main Phase.",
      };
    }

    // Verify card is in the correct zone
    if (activationZone === "hand") {
      if (!player.hand || !player.hand.includes(card)) {
        return { success: false, reason: "Card is not in your hand." };
      }
    } else if (activationZone === "field") {
      if (!player.field || !player.field.includes(card)) {
        return { success: false, reason: "Card is not on the field." };
      }
    }

    // Check if effects are negated (only for cards on field)
    if (activationZone === "field" && this.isEffectNegated(card)) {
      return {
        success: false,
        reason: "Card's effects are currently negated.",
      };
    }

    // Find effect that matches activation zone
    let effect = null;
    if (activationZone === "hand") {
      // For hand effects, look for ignition effects with requireZone: "hand"
      effect = (card.effects || []).find(
        (e) => e && e.timing === "ignition" && e.requireZone === "hand"
      );
    } else {
      // For field effects, look for ignition effects without requireZone (or with requireZone: "field")
      effect = (card.effects || []).find(
        (e) =>
          e &&
          e.timing === "ignition" &&
          (!e.requireZone || e.requireZone === "field")
      );
    }

    if (!effect) {
      return {
        success: false,
        reason: "No ignition effect defined for this zone.",
      };
    }

    const ctx = {
      source: card,
      player,
      opponent: this.game.getOpponent(player),
      activationZone,
    };

    const condCheck = this.evaluateConditions(effect.conditions, ctx);
    if (!condCheck.ok) {
      return { success: false, reason: condCheck.reason };
    }

    const optCheck = this.checkOncePerTurn(card, player, effect);
    if (!optCheck.ok) {
      return { success: false, reason: optCheck.reason };
    }

    const targetResult = this.resolveTargets(
      effect.targets || [],
      ctx,
      selections
    );
    if (targetResult.needsSelection) {
      return { needsSelection: true, options: targetResult.options };
    }

    if (targetResult.ok === false) {
      return { success: false, reason: targetResult.reason };
    }

    this.applyActions(effect.actions || [], ctx, targetResult.targets || {});
    this.registerOncePerTurnUsage(card, player, effect);
    this.registerOncePerDuelUsage(card, player, effect);
    this.game.checkWinCondition();
    return { success: true };
  }

  hasActivatableGraveyardEffect(card) {
    if (!card || card.cardKind !== "monster") return false;
    return card.effects?.some(
      (e) => e.timing === "ignition" && e.requireZone === "graveyard"
    );
  }

  canActivate(card, player) {
    if (card.cardKind !== "spell") {
      return { ok: false, reason: "Card is not a spell." };
    }
    if (this.game.turn !== player.id) {
      return { ok: false, reason: "Not your turn." };
    }
    if (this.game.phase !== "main1" && this.game.phase !== "main2") {
      return { ok: false, reason: "Can only activate in Main Phase." };
    }

    // Card-specific activation requirements
    // Note: Future improvement - move to generic activation cost/requirement system
    if (card.name === "Shadow-Heart Infusion" || card.id === 37) {
      const handCount = (player.hand && player.hand.length) || 0;
      if (handCount < 2) {
        return { ok: false, reason: "Need at least 2 cards in hand." };
      }

      const gy = player.graveyard || [];
      const hasShadowHeart = gy.some((c) => {
        if (!c || c.cardKind !== "monster") return false;
        if (c.archetype === "Shadow-Heart") return true;
        if (Array.isArray(c.archetypes)) {
          return c.archetypes.includes("Shadow-Heart");
        }
        return false;
      });

      if (!hasShadowHeart) {
        return {
          ok: false,
          reason: 'No "Shadow-Heart" monsters in graveyard.',
        };
      }
    }

    return { ok: true };
  }

  /**
   * Dry-run check for activating a Spell from hand (no side effects).
   */
  canActivateSpellFromHandPreview(card, player) {
    if (!card || !player) {
      return { ok: false, reason: "Missing card or player." };
    }
    if (card.cardKind !== "spell") {
      return { ok: false, reason: "Card is not a spell." };
    }
    if (!player.hand || !player.hand.includes(card)) {
      return { ok: false, reason: "Card not in hand." };
    }

    const baseCheck = this.canActivate(card, player);
    if (!baseCheck.ok) {
      return baseCheck;
    }

    const effect = this.getHandActivationEffect(card);
    const isFieldSpell = card.subtype === "field";
    const isContinuousSpell = card.subtype === "continuous";
    const placementOnly = !effect && (isFieldSpell || isContinuousSpell);
    if (!effect) {
      return placementOnly
        ? { ok: true, placementOnly: true }
        : { ok: false, reason: "No on_play effect." };
    }

    const optCheck = this.checkOncePerTurn(card, player, effect);
    if (!optCheck.ok) return { ok: false, reason: optCheck.reason };

    const opdCheck = this.checkOncePerDuel(card, player, effect);
    if (!opdCheck.ok) return { ok: false, reason: opdCheck.reason };

    const ctx = {
      source: card,
      player,
      opponent: this.game?.getOpponent?.(player),
      activationZone: "hand",
    };

    if (effect.conditions) {
      const condResult = this.evaluateConditions(effect.conditions, ctx);
      if (!condResult.ok) {
        return { ok: false, reason: condResult.reason };
      }
    }

    if (effect.requireEmptyField && (player.field?.length || 0) > 0) {
      return { ok: false, reason: "You must control no monsters." };
    }

    const targetResult = this.resolveTargets(effect.targets || [], ctx, null);
    if (targetResult.ok === false) {
      return { ok: false, reason: targetResult.reason };
    }

    return {
      ok: true,
      needsSelection: !!targetResult.needsSelection,
    };
  }

  resolveTargets(targetDefs, ctx, selections) {
    const targetMap = {};
    const options = [];
    let needsSelection = false;

    for (const def of targetDefs) {
      const { zoneName, candidates } = this.selectCandidates(def, ctx);
      const min = Number(def.count?.min ?? 1);
      const max = Number(def.count?.max ?? min);

      if (candidates.length < min) {
        return { ok: false, reason: "No valid targets for this effect." };
      }

      const provided = selections?.[def.id];
      if (provided && provided.length >= min && provided.length <= max) {
        const chosen = provided
          .map((idx) => candidates[idx])
          .filter((c) => c !== undefined);
        if (chosen.length >= min && chosen.length <= max) {
          targetMap[def.id] = chosen;
          continue;
        }
      }

      const isHuman =
        ctx?.player && this.game && ctx.player === this.game.player;
      const isBot = !isHuman && ctx?.player && this.game && ctx.player === this.game.bot;

      const shouldAutoSelect = def.autoSelect || !!def.strategy;
      if (shouldAutoSelect) {
        const takeCount = Math.min(max, candidates.length);
        targetMap[def.id] = candidates.slice(0, takeCount);
        continue;
      }

      if (candidates.length === 1 && min === 1) {
        targetMap[def.id] = [candidates[0]];
        continue;
      }

      if (isBot) {
        const takeCount = Math.min(max, candidates.length);
        targetMap[def.id] = candidates.slice(0, takeCount);
        continue;
      }

      needsSelection = true;
      const decoratedCandidates = candidates.map((card, idx) => {
        const controller = card.owner;
        const ownerLabel = controller === ctx.player.id ? "player" : "opponent";
        const ownerPlayer =
          controller === "player" ? this.game.player : this.game.bot;
        let zoneForDisplay = zoneName;
        let zoneArr = this.getZone(ownerPlayer, zoneForDisplay) || [];
        let zoneIndex = zoneArr.indexOf(card);
        if (zoneIndex === -1) {
          const detectedZone = this.findCardZone(ownerPlayer, card);
          if (detectedZone) {
            zoneForDisplay = detectedZone;
            zoneArr = this.getZone(ownerPlayer, detectedZone) || [];
            zoneIndex = zoneArr.indexOf(card);
          }
        }
        return {
          idx,
          name: card.name,
          owner: ownerLabel,
          controller,
          zone: zoneForDisplay,
          zoneIndex,
          position: card.position,
          atk: card.atk,
          def: card.def,
          cardKind: card.cardKind,
          cardRef: card,
        };
      });
      options.push({
        id: def.id,
        min,
        max,
        zone: zoneName,
        candidates: decoratedCandidates,
      });
    }

    if (needsSelection) {
      return { needsSelection: true, options };
    }

    return { ok: true, targets: targetMap };
  }

  selectCandidates(def, ctx) {
    const zoneName = def.zone || "field";
    const zoneList =
      Array.isArray(def.zones) && def.zones.length > 0 ? def.zones : [zoneName];

    console.log(
      `[selectCandidates] Starting search for target "${def.id}": owner="${def.owner}", zone="${zoneName}", archetype="${def.archetype}", excludeCardName="${def.excludeCardName}"`
    );

    const owners = [];
    if (def.owner === "opponent") {
      owners.push(ctx.opponent);
    } else if (def.owner === "any") {
      owners.push(ctx.player, ctx.opponent);
    } else {
      owners.push(ctx.player);
    }

    let candidates = [];
    console.log(
      `[selectCandidates] Using ${owners.length} owners: ${owners
        .map((o) => o.id)
        .join(", ")}`
    );
    for (const owner of owners) {
      for (const zoneKey of zoneList) {
        const zone = this.getZone(owner, zoneKey) || [];
        console.log(
          `[selectCandidates] Checking zone "${zoneKey}" for owner ${
            owner.id
          }: ${zone.length} cards ${
            zone.length > 0 ? `(${zone.map((c) => c.name).join(", ")})` : ""
          }`
        );
        for (const card of zone) {
          console.log(
            `[selectCandidates] Evaluating card: ${card.name} (archetype: ${card.archetype}, owner: ${owner.id})`
          );
          if (def.requireThisCard && ctx?.source && card !== ctx.source) {
            console.log(
              `[selectCandidates] Rejecting: requireThisCard and card is not source`
            );
            continue;
          }
          if (
            zoneKey === "hand" &&
            ctx.activationZone === "hand" &&
            card === ctx.source
          ) {
            console.log(
              `[selectCandidates] Rejecting: card is source in hand zone`
            );
            continue;
          }
          if (def.cardKind && card.cardKind !== def.cardKind) {
            console.log(
              `[selectCandidates] Rejecting: cardKind mismatch (${card.cardKind} !== ${def.cardKind})`
            );
            continue;
          }
          if (def.requireFaceup && card.isFacedown) {
            console.log(`[selectCandidates] Rejecting: card is facedown`);
            continue;
          }
          if (
            def.position &&
            def.position !== "any" &&
            card.position !== def.position
          ) {
            console.log(
              `[selectCandidates] Rejecting: position mismatch (${card.position} !== ${def.position})`
            );
            continue;
          }
          const cardLevel = card.level || 0;
          if (def.level !== undefined && cardLevel !== def.level) {
            console.log(
              `[selectCandidates] Rejecting: level mismatch (${cardLevel} !== ${def.level})`
            );
            continue;
          }
          if (def.minLevel !== undefined && cardLevel < def.minLevel) {
            console.log(
              `[selectCandidates] Rejecting: level too low (${cardLevel} < ${def.minLevel})`
            );
            continue;
          }
          if (def.maxLevel !== undefined && cardLevel > def.maxLevel) {
            console.log(
              `[selectCandidates] Rejecting: level too high (${cardLevel} > ${def.maxLevel})`
            );
            continue;
          }
          const cardAtk = card.atk || 0;
          if (def.minAtk !== undefined && cardAtk < def.minAtk) {
            console.log(
              `[selectCandidates] Rejecting: ATK too low (${cardAtk} < ${def.minAtk})`
            );
            continue;
          }
          if (def.maxAtk !== undefined && cardAtk > def.maxAtk) {
            console.log(
              `[selectCandidates] Rejecting: ATK too high (${cardAtk} > ${def.maxAtk})`
            );
            continue;
          }

          // Counter-based ATK filter
          if (def.maxAtkByCounters && ctx.source) {
            const counterType = def.counterType || "judgment_marker";
            const multiplier = def.counterMultiplier || 500;
            const counterCount = ctx.source.getCounter
              ? ctx.source.getCounter(counterType)
              : 0;
            const maxAllowedAtk = counterCount * multiplier;
            if (cardAtk > maxAllowedAtk) {
              console.log(
                `[selectCandidates] Rejecting: counter-based ATK too high`
              );
              continue;
            }
          }

          if (def.archetype) {
            const cardArchetypes = card.archetypes
              ? card.archetypes
              : card.archetype
              ? [card.archetype]
              : [];
            if (!cardArchetypes.includes(def.archetype)) {
              console.log(
                `[selectCandidates] Rejecting: archetype mismatch (${card.archetype} doesn't include ${def.archetype})`
              );
              continue;
            }
          }

          const requiredName = def.cardName || def.name;
          if (requiredName && card.name !== requiredName) {
            console.log(
              `[selectCandidates] Rejecting: name mismatch (${card.name} !== ${requiredName})`
            );
            continue;
          }

          // Exclude by card name
          if (def.excludeCardName && card.name === def.excludeCardName) {
            console.log(
              `[selectCandidates] Excluding ${card.name} (matches excludeCardName)`
            );
            continue;
          }

          console.log(`[selectCandidates] ACCEPTED: ${card.name}`);
          candidates.push(card);
        }
      }
    }

    console.log(
      `[selectCandidates] Found ${candidates.length} candidates for target "${def.id}" (archetype: ${def.archetype}, zone: ${zoneName}, exclude: ${def.excludeCardName})`
    );

    if (def.strategy === "highest_atk") {
      candidates = [...candidates].sort((a, b) => (b.atk || 0) - (a.atk || 0));
    } else if (def.strategy === "lowest_atk") {
      candidates = [...candidates].sort((a, b) => (a.atk || 0) - (b.atk || 0));
    }

    return { zoneName, candidates };
  }

  getZone(player, zone) {
    switch (zone) {
      case "hand":
        return player.hand;
      case "graveyard":
        return player.graveyard;
      case "deck":
        return player.deck;
      case "spellTrap":
        return player.spellTrap;
      case "fieldSpell":
        return player.fieldSpell ? [player.fieldSpell] : [];
      case "field":
      default:
        return player.field;
    }
  }

  findCardZone(player, card) {
    if (!player || !card) return null;
    if (player.field && player.field.includes(card)) return "field";
    if (player.spellTrap && player.spellTrap.includes(card)) return "spellTrap";
    if (player.fieldSpell === card) return "fieldSpell";
    if (player.hand && player.hand.includes(card)) return "hand";
    if (player.graveyard && player.graveyard.includes(card)) return "graveyard";
    if (player.deck && player.deck.includes(card)) return "deck";
    return null;
  }

  getOwnerByCard(card) {
    if (!card || !this.game) return null;
    return card.owner === "player" ? this.game.player : this.game.bot;
  }

  canUseOncePerTurn(effect, ctx) {
    if (!effect || !effect.oncePerTurn) return true;
    const player = ctx?.player;
    const card = ctx?.source;
    if (!player) return true;
    const key = effect.oncePerTurnName || effect.id || ctx?.source?.name;
    if (!key) return true;
    const useCardScope =
      effect.oncePerTurnScope === "card" || effect.oncePerTurnPerCard;
    const usage = useCardScope
      ? card?.oncePerTurnUsageByName || {}
      : player.oncePerTurnUsageByName || {};
    const currentTurn = this.game?.turnCounter || 0;
    return usage[key] !== currentTurn;
  }

  markOncePerTurn(effect, ctx) {
    if (!effect || !effect.oncePerTurn) return;
    const player = ctx?.player;
    const card = ctx?.source;
    if (!player) return;
    const key = effect.oncePerTurnName || effect.id || ctx?.source?.name;
    if (!key) return;
    const useCardScope =
      effect.oncePerTurnScope === "card" || effect.oncePerTurnPerCard;
    const currentTurn = this.game?.turnCounter || 0;
    if (useCardScope && card) {
      card.oncePerTurnUsageByName = card.oncePerTurnUsageByName || {};
      card.oncePerTurnUsageByName[key] = currentTurn;
      return;
    }

    player.oncePerTurnUsageByName = player.oncePerTurnUsageByName || {};
    player.oncePerTurnUsageByName[key] = currentTurn;
  }

  addNamedPermanentAtkBuff(card, sourceName, amount) {
    if (!card || !sourceName || !amount) return false;
    card.permanentBuffsBySource = card.permanentBuffsBySource || {};
    const prev = card.permanentBuffsBySource[sourceName] || 0;
    const next = Math.max(prev, amount);
    const delta = next - prev;
    if (delta === 0) return false;
    card.atk += delta;
    card.permanentBuffsBySource[sourceName] = next;
    return true;
  }

  removeNamedPermanentAtkBuff(card, sourceName, amount) {
    if (!card || !sourceName) return false;
    const stored = card.permanentBuffsBySource?.[sourceName] || 0;
    if (!stored) return false;
    const toRemove = Math.min(stored, amount ?? stored);
    card.atk -= toRemove;
    card.permanentBuffsBySource[sourceName] = stored - toRemove;
    if (card.permanentBuffsBySource[sourceName] <= 0) {
      delete card.permanentBuffsBySource[sourceName];
    }
    return true;
  }

  removePermanentBuffFromGroup(player, sourceName, archetype, amount) {
    if (!player || !player.field) return false;
    let removedAny = false;
    player.field.forEach((monster) => {
      if (!monster || monster.cardKind !== "monster") return;
      const archetypes = monster.archetypes
        ? monster.archetypes
        : monster.archetype
        ? [monster.archetype]
        : [];
      if (archetype && !archetypes.includes(archetype)) return;
      if (this.removeNamedPermanentAtkBuff(monster, sourceName, amount)) {
        removedAny = true;
      }
    });
    return removedAny;
  }

  async applyActions(actions, ctx, targets) {
    let executed = false;
    if (!Array.isArray(actions)) {
      return executed;
    }

    try {
      for (const action of actions) {
        if (this.shouldSkipActionDueToImmunity(action, targets, ctx)) {
          continue;
        }

        // Check if there's a registered handler for this action type
        const handler = this.actionHandlers.get(action.type);
        if (handler) {
          try {
            const result = await handler(action, ctx, targets, this);
            executed = result || executed;
            continue; // Skip to next action
          } catch (error) {
            console.error(
              `Error executing registered handler for action type "${action.type}":`,
              error
            );
            console.error(`Action config:`, action);
            console.error(`Context:`, {
              player: ctx.player?.id,
              source: ctx.source?.name,
            });
            // Fall through to legacy switch statement as fallback
            console.warn(
              `Falling back to legacy switch statement for action type "${action.type}"`
            );
          }
        }

        switch (action.type) {
          case "draw":
            executed = this.applyDraw(action, ctx) || executed;
            break;
          case "heal":
            executed = this.applyHeal(action, ctx) || executed;
            break;
          case "heal_per_archetype_monster":
            executed =
              this.applyHealPerArchetypeMonster(action, ctx) || executed;
            break;
          case "damage":
            executed = this.applyDamage(action, ctx) || executed;
            break;
          case "destroy":
            executed =
              (await this.applyDestroy(action, targets, ctx)) || executed;
            break;
          case "negate_attack":
            executed = this.applyNegateAttack(action, ctx) || executed;
            break;
          case "special_summon_token":
            executed = this.applySpecialSummonToken(action, ctx) || executed;
            break;
          case "buff_atk_temp":
            executed = this.applyBuffAtkTemp(action, targets) || executed;
            break;
          case "modify_stats_temp":
            executed = this.applyModifyStatsTemp(action, targets) || executed;
            break;
          case "reduce_self_atk":
            executed = this.applyReduceSelfAtk(action, ctx) || executed;
            break;
          case "search_any":
            executed = this.applySearchAny(action, ctx) || executed;
            break;
          case "transmutate":
            executed = this.applyTransmutate(action, ctx, targets) || executed;
            break;
          case "equip":
            executed = this.applyEquip(action, ctx, targets) || executed;
            break;
          case "move":
            executed = this.applyMove(action, ctx, targets) || executed;
            break;
          case "destroy_self_monsters_and_draw":
            executed =
              (await this.applyDestroyAllOthersAndDraw(action, ctx)) ||
              executed;
            break;
          case "shadow_heart_rage_scale_buff":
            executed =
              this.applyShadowHeartRageScaleBuff(action, ctx) || executed;
            break;
          case "shadow_heart_shield_upkeep":
            executed =
              this.applyShadowHeartShieldUpkeep(action, ctx) || executed;
            break;
          case "revive_shadowheart_from_grave":
            executed =
              this.applyReviveShadowHeartFromGrave(action, ctx) || executed;
            break;
          case "forbid_attack_this_turn":
            executed =
              this.applyForbidAttackThisTurn(action, targets, ctx) || executed;
            break;
          case "forbid_attack_next_turn":
            executed =
              this.applyForbidAttackNextTurn(action, targets, ctx) || executed;
            break;
          case "grant_void_fusion_immunity":
            executed =
              this.applyGrantVoidFusionImmunity(action, ctx) || executed;
            break;
          case "darkness_valley_apply_existing":
            executed =
              this.applyDarknessValleyInitialBuff(action, ctx) || executed;
            break;
          case "darkness_valley_buff_summon":
            executed =
              this.applyDarknessValleySummonBuff(action, ctx) || executed;
            break;
          case "darkness_valley_cleanup":
            executed = this.applyDarknessValleyCleanup(action, ctx) || executed;
            break;
          case "darkness_valley_battle_punish":
            executed =
              this.applyDarknessValleyBattlePunish(action, ctx) || executed;
            break;
          case "shadow_heart_death_wyrm_special_summon":
            executed =
              this.applyShadowHeartDeathWyrmSpecialSummon(action, ctx) ||
              executed;
            break;
          case "conditional_special_summon_from_hand":
            executed =
              (await this.applyConditionalSpecialSummonFromHand(action, ctx)) ||
              executed;
            break;
          case "shadow_heart_observer_summon":
            executed =
              (await this.applyShadowHeartObserverSummon(
                action,
                ctx,
                targets
              )) || executed;
            break;
          case "add_counter":
            executed = this.applyAddCounter(action, ctx, targets) || executed;
            break;
          case "shadow_heart_cathedral_summon":
            executed =
              (await this.applyShadowHeartCathedralSummon(action, ctx)) ||
              executed;
            break;
          case "the_shadow_heart_special_summon_and_equip":
            executed =
              (await this.applyTheShadowHeartSummonAndEquip(
                action,
                ctx,
                targets
              )) || executed;
            break;
          case "abyssal_eel_special_summon":
            executed =
              (await this.applyAbyssalEelSpecialSummon(action, ctx)) ||
              executed;
            break;
          case "polymerization_fusion_summon":
            executed =
              (await this.applyPolymerizationFusion(action, ctx)) || executed;
            break;
          case "banish":
            executed = this.applyBanish(action, ctx, targets) || executed;
            break;
          case "allow_direct_attack_this_turn":
            executed =
              this.applyAllowDirectAttackThisTurn(action, ctx, targets) ||
              executed;
            break;
          case "demon_dragon_destroy_two":
            executed =
              (await this.applyDemonDragonDestroy(action, ctx)) || executed;
            break;
          case "demon_dragon_revive_scale_dragon":
            executed =
              (await this.applyDemonDragonRevive(action, ctx)) || executed;
            break;
          case "mirror_force_destroy_all":
            executed =
              (await this.applyMirrorForceDestroy(action, ctx)) || executed;
            break;
          case "call_of_haunted_summon_and_bind":
            executed =
              (await this.applyCallOfTheHauntedSummon(action, ctx, targets)) ||
              executed;
            break;
          default:
            console.warn(`Unknown action type: ${action.type}`);
        }
      }
    } catch (err) {
      console.error("Error while applying actions:", err);
    }

    return executed;
  }

  /**
   * Lightweight check to see if a monster effect could be activated from a zone,
   * without consuming OPT flags or performing actions. Used for UI pre-checks
   * (e.g., showing the Special Summon button in hand).
   */
  canActivateMonsterEffectPreview(
    card,
    player,
    activationZone = "field",
    selections = null
  ) {
    if (!card || !player) {
      return { ok: false, reason: "Missing card or player." };
    }
    if (card.owner !== player.id) {
      return { ok: false, reason: "Card does not belong to the player." };
    }
    if (card.cardKind !== "monster") {
      return { ok: false, reason: "Only Monster cards can use this effect." };
    }
    if (card.isFacedown && activationZone !== "hand") {
      return { ok: false, reason: "Card must be face-up to activate." };
    }
    if (this.game?.turn !== player.id) {
      return { ok: false, reason: "Not your turn." };
    }
    if (this.game?.phase !== "main1" && this.game?.phase !== "main2") {
      return {
        ok: false,
        reason: "Effect can only be activated during Main Phase.",
      };
    }

    if (activationZone === "hand") {
      if (!player.hand || !player.hand.includes(card)) {
        return { ok: false, reason: "Card is not in your hand." };
      }
    } else if (activationZone === "field") {
      if (!player.field || !player.field.includes(card)) {
        return { ok: false, reason: "Card is not on the field." };
      }
    }

    const effect =
      activationZone === "hand"
        ? (card.effects || []).find(
            (e) => e && e.timing === "ignition" && e.requireZone === "hand"
          )
        : (card.effects || []).find(
            (e) =>
              e &&
              e.timing === "ignition" &&
              (!e.requireZone || e.requireZone === "field")
          );

    if (!effect) {
      return { ok: false, reason: "No ignition effect defined for this zone." };
    }

    const ctx = {
      source: card,
      player,
      opponent: this.game.getOpponent(player),
      activationZone,
    };

    const optCheck = this.checkOncePerTurn(card, player, effect);
    if (!optCheck.ok) {
      return { ok: false, reason: optCheck.reason };
    }

    const targetResult = this.resolveTargets(
      effect.targets || [],
      ctx,
      selections
    );

    if (targetResult.needsSelection) {
      return { ok: true, reason: "Selection needed." };
    }

    if (targetResult.ok === false) {
      return { ok: false, reason: targetResult.reason };
    }

    return { ok: true };
  }

  applyDraw(action, ctx) {
    const targetPlayer =
      action.player === "opponent" ? ctx.opponent : ctx.player;
    const amount = action.amount ?? 1;
    for (let i = 0; i < amount; i++) {
      targetPlayer.draw();
    }
    return amount > 0;
  }

  applyHeal(action, ctx) {
    const targetPlayer =
      action.player === "opponent" ? ctx.opponent : ctx.player;
    const amount = action.amount ?? 0;

    // LP gain multiplier is now handled by Player.gainLP() based on passive effects
    targetPlayer.gainLP(amount);
    return amount !== 0;
  }

  applyHealPerArchetypeMonster(action, ctx) {
    const targetPlayer =
      action.player === "opponent" ? ctx.opponent : ctx.player;
    const archetype = action.archetype;
    const amountPerMonster = action.amountPerMonster ?? 0;

    if (!targetPlayer || amountPerMonster <= 0 || !archetype) return false;

    const count = (targetPlayer.field || []).reduce((acc, card) => {
      if (!card || card.cardKind !== "monster" || card.isFacedown) return acc;
      const archetypes = Array.isArray(card.archetypes)
        ? card.archetypes
        : card.archetype
        ? [card.archetype]
        : [];
      return archetypes.includes(archetype) ? acc + 1 : acc;
    }, 0);

    const totalHeal = count * amountPerMonster;
    if (totalHeal > 0) {
      targetPlayer.gainLP(totalHeal);
      console.log(
        `${targetPlayer.id} gained ${totalHeal} LP from ${count} ${archetype} monster(s).`
      );
      return true;
    }

    return false;
  }

  applyDamage(action, ctx) {
    const targetPlayer = action.player === "self" ? ctx.player : ctx.opponent;
    const amount = action.amount ?? 0;
    targetPlayer.takeDamage(amount);

    // Trigger effects that care about opponent losing LP
    if (amount > 0 && this.game) {
      const damaged =
        targetPlayer.id === "player" ? this.game.player : this.game.bot;
      const other = damaged.id === "player" ? this.game.bot : this.game.player;

      // Check field cards (including spellTrap zone for continuous spells)
      const fieldCards = [
        ...(other.field || []),
        ...(other.spellTrap || []).filter(
          (c) => c && c.subtype === "continuous"
        ),
      ].filter(Boolean);

      for (const card of fieldCards) {
        if (!card?.effects) continue;

        for (const effect of card.effects) {
          if (
            effect.timing !== "on_event" ||
            effect.event !== "opponent_damage"
          )
            continue;

          const optCheck = this.checkOncePerTurn(card, other, effect);
          if (!optCheck.ok) {
            console.log(optCheck.reason);
            continue;
          }

          const ctx2 = {
            source: card,
            player: other,
            opponent: damaged,
            damageAmount: amount, // Pass damage amount for counter calculation
          };

          // Apply the actual effect actions instead of hardcoding draw
          this.applyActions(effect.actions || [], ctx2, {});
          this.registerOncePerTurnUsage(card, other, effect);

          if (this.game && typeof this.game.updateBoard === "function") {
            this.game.updateBoard();
          }
        }
      }
    }

    return amount !== 0;
  }

  async applyDestroy(action, targets, ctx) {
    const targetCards = targets[action.targetRef] || [];
    let destroyedAny = false;

    for (const card of targetCards) {
      const owner = card.owner === "player" ? this.game.player : this.game.bot;
      if (!owner) continue;

      // Check for before_destroy negation handlers (e.g., destruction protection with cost)
      const negationResult = await this.checkBeforeDestroyNegations(card, ctx);
      if (negationResult?.negated) {
        continue; // Skip destruction for this card
      }

      let replaced = false;
      if (
        this.game &&
        typeof this.game.resolveDestructionWithReplacement === "function"
      ) {
        try {
          const replacement = await this.game.resolveDestructionWithReplacement(
            card,
            {
              reason: "effect",
              sourceCard: ctx?.source || null,
            }
          );
          replaced = replacement?.replaced;
        } catch (err) {
          console.error("Error resolving destruction replacement:", err);
        }
      }

      if (replaced) continue;

      if (this.game && typeof this.game.moveCard === "function") {
        this.game.moveCard(card, owner, "graveyard", {
          fromZone: "field",
          wasDestroyed: true,
        });
        destroyedAny = true;
        if (typeof this.game.updateBoard === "function") {
          this.game.updateBoard();
        }
        if (typeof this.game.checkWinCondition === "function") {
          this.game.checkWinCondition();
        }
        continue;
      }

      const zones = [
        owner.field,
        owner.hand,
        owner.deck,
        owner.spellTrap,
        owner.fieldSpell ? [owner.fieldSpell] : [],
      ];
      for (const zone of zones) {
        const idx = zone.indexOf(card);
        if (idx > -1) {
          zone.splice(idx, 1);
          owner.graveyard.push(card);
          if (owner.fieldSpell === card) {
            owner.fieldSpell = null;
          }
          destroyedAny = true;
          break;
        }
      }
    }

    return destroyedAny;
  }

  /**
   * Check if a card being destroyed has negation effects that can prevent it.
   * Allows cards to negate their own destruction by paying costs (e.g., ATK reduction).
   * @param {Card} card - Card being destroyed
   * @param {Object} ctx - Context with source, player, opponent info
   * @returns {Promise<Object>} - { negated: boolean, costPaid: boolean }
   */
  async checkBeforeDestroyNegations(card, ctx) {
    if (!card || !card.effects) {
      return { negated: false };
    }

    const owner = card.owner === "player" ? this.game.player : this.game.bot;
    if (!owner) {
      return { negated: false };
    }

    for (const effect of card.effects) {
      if (!effect || effect.timing !== "on_event") continue;
      if (effect.event !== "before_destroy") continue;

      // Check once-per-turn for negation
      const optCheck = this.checkOncePerTurn(card, owner, effect);
      if (!optCheck.ok) {
        console.log(`Negation blocked by OPT: ${optCheck.reason}`);
        continue;
      }

      // For player-controlled cards, prompt for confirmation
      if (owner === this.game.player) {
        const shouldNegate = await this.promptForDestructionNegation(
          card,
          effect
        );
        if (!shouldNegate) {
          continue;
        }
      }

      // Apply negation actions (e.g., cost payment)
      const negationCtx = {
        source: card,
        player: owner,
        opponent:
          ctx?.opponent ||
          (owner === this.game.player ? this.game.bot : this.game.player),
      };

      const costSuccess = await this.applyActions(
        effect.negationCost || [],
        negationCtx,
        {}
      );

      if (costSuccess || effect.negationCost?.length === 0) {
        // Register OPT usage for negation
        this.registerOncePerTurnUsage(card, owner, effect);

        if (this.game?.renderer?.log) {
          this.game.renderer.log(`${card.name} negated its destruction!`);
        }

        return { negated: true, costPaid: true };
      }
    }

    return { negated: false };
  }

  /**
   * Prompt the player to decide if they want to negate destruction with a cost.
   * @param {Card} card - Card offering negation
   * @param {Object} effect - Effect definition with negationCost
   * @returns {Promise<boolean>} - Whether player wants to activate negation
   */
  async promptForDestructionNegation(card, effect) {
    if (!this.game?.renderer) {
      return false;
    }

    const costDescription = this.getDestructionNegationCostDescription(effect);
    const message = `${card.name} would be destroyed. Negate destruction? Cost: ${costDescription}`;

    return new Promise((resolve) => {
      if (this.game.renderer.showDestructionNegationPrompt) {
        this.game.renderer.showDestructionNegationPrompt(
          card.name,
          costDescription,
          resolve
        );
      } else {
        // Fallback to window.confirm
        const confirm = window.confirm(message);
        resolve(confirm);
      }
    });
  }

  /**
   * Generate a human-readable description of the cost to negate destruction.
   * @param {Object} effect - Effect with negationCost array
   * @returns {string} - Cost description
   */
  getDestructionNegationCostDescription(effect) {
    if (!effect?.negationCost || !Array.isArray(effect.negationCost)) {
      return "Unknown cost";
    }

    const descriptions = [];
    for (const action of effect.negationCost) {
      if (action.type === "modify_stats_temp") {
        const baseAtk = action.baseAtk ?? 3500;
        const atkReduction = Math.floor(
          baseAtk * (1 - (action.atkFactor ?? 1))
        );
        descriptions.push(`reduce ATK by ${atkReduction}`);
      } else if (action.type === "pay_lp") {
        descriptions.push(`pay ${action.amount} LP`);
      } else if (action.type === "damage") {
        descriptions.push(`take ${action.amount} damage`);
      } else {
        descriptions.push(action.type);
      }
    }

    return descriptions.join(" and ");
  }

  /**
   * Destroy all other monsters controlled by the player and draw 1 card per destroyed monster.
   * Used by Void Hydra Titan on-summon effect.
   * @param {Object} action - Action definition
   * @param {Object} ctx - Context with source, player, opponent
   * @returns {Promise<boolean>} - Whether any cards were destroyed
   */
  async applyDestroyAllOthersAndDraw(action, ctx) {
    const player = ctx?.player;
    const sourceCard = ctx?.source;

    if (!player || !sourceCard) {
      return false;
    }

    // Collect all monsters on the field except the source card
    const othersToDestroy = (player.field || []).filter(
      (card) => card && card !== sourceCard && card.cardKind === "monster"
    );

    if (othersToDestroy.length === 0) {
      console.log("No other monsters to destroy.");
      return false;
    }

    // Count how many we're destroying
    let destroyedCount = 0;

    // Destroy all collected monsters
    for (const card of othersToDestroy) {
      // Check for negation on each card being destroyed
      const negationResult = await this.checkBeforeDestroyNegations(card, ctx);
      if (negationResult?.negated) {
        // If negated, don't destroy and don't count towards draw
        continue;
      }

      // Move card to graveyard
      let moved = false;
      if (this.game && typeof this.game.moveCard === "function") {
        this.game.moveCard(card, player, "graveyard", {
          fromZone: "field",
          wasDestroyed: true,
        });
        moved = true;
      } else {
        const idx = player.field.indexOf(card);
        if (idx > -1) {
          player.field.splice(idx, 1);
          player.graveyard.push(card);
          moved = true;
        }
      }

      if (moved) {
        destroyedCount += 1;
      }
    }

    // Draw 1 card for each monster destroyed
    for (let i = 0; i < destroyedCount; i++) {
      player.draw();
    }

    if (
      destroyedCount > 0 &&
      this.game &&
      typeof this.game.updateBoard === "function"
    ) {
      this.game.updateBoard();
    }

    if (destroyedCount > 0 && this.game?.renderer?.log) {
      this.game.renderer.log(
        `${sourceCard.name} destroyed ${destroyedCount} monster(s) and drew ${destroyedCount} card(s)!`
      );
    }

    return destroyedCount > 0;
  }

  applyNegateAttack(action, ctx) {
    if (!this.game || !ctx?.attacker) return false;
    if (typeof this.game.registerAttackNegated === "function") {
      this.game.registerAttackNegated(ctx.attacker);
      return true;
    }
    return false;
  }

  applySpecialSummonToken(action, ctx) {
    const targetPlayer =
      action.player === "opponent" ? ctx.opponent : ctx.player;
    if (!action.token) return false;
    if (targetPlayer.field.length >= 5) {
      console.log("No space to special summon token.");
      return false;
    }

    const tokenCard = new Card(
      {
        cardKind: "monster",
        name: action.token.name || "Token",
        atk: action.token.atk ?? 0,
        def: action.token.def ?? 0,
        level: action.token.level ?? 1,
        type: action.token.type || "Fiend",
        image: action.token.image || "",
        description: action.token.description || "Special Summoned by effect.",
      },
      targetPlayer.id
    );

    const finishSummon = (posChoice) => {
      const position = posChoice || action.position || "attack";

      tokenCard.position = position;
      tokenCard.isFacedown = false;
      tokenCard.hasAttacked = false;

      if (this.game && typeof this.game.moveCard === "function") {
        this.game.moveCard(tokenCard, targetPlayer, "field", {
          position,
          isFacedown: tokenCard.isFacedown,
          resetAttackFlags: true,
        });
      } else {
        targetPlayer.field.push(tokenCard);
      }

      if (this.game && typeof this.game.updateBoard === "function") {
        this.game.updateBoard();
      }
      if (this.game && typeof this.game.checkWinCondition === "function") {
        this.game.checkWinCondition();
      }
    };

    if (
      this.game &&
      targetPlayer === this.game.player &&
      typeof this.game.chooseSpecialSummonPosition === "function"
    ) {
      const positionChoice = this.game.chooseSpecialSummonPosition(
        targetPlayer,
        tokenCard
      );
      if (positionChoice && typeof positionChoice.then === "function") {
        positionChoice.then((pos) => finishSummon(pos));
      } else {
        finishSummon(positionChoice);
      }
    } else {
      finishSummon(action.position || "attack");
    }
    return true;
  }

  applyBuffAtkTemp(action, targets) {
    const targetCards = targets[action.targetRef] || [];
    const amount = action.amount ?? 0;
    targetCards.forEach((card) => {
      if (card.isFacedown) return;
      card.atk += amount;
      card.tempAtkBoost = (card.tempAtkBoost || 0) + amount;
    });
    return targetCards.length > 0 && amount !== 0;
  }

  applyModifyStatsTemp(action, targets) {
    const targetCards = targets[action.targetRef] || [];
    const atkFactor = action.atkFactor ?? 1;
    const defFactor = action.defFactor ?? 1;

    targetCards.forEach((card) => {
      if (card.isFacedown) return;
      if (atkFactor !== 1) {
        const newAtk = Math.floor((card.atk || 0) * atkFactor);
        const deltaAtk = newAtk - card.atk;
        card.atk = newAtk;
        card.tempAtkBoost = (card.tempAtkBoost || 0) + deltaAtk;
      }
      if (defFactor !== 1) {
        const newDef = Math.floor((card.def || 0) * defFactor);
        const deltaDef = newDef - card.def;
        card.def = newDef;
        card.tempDefBoost = (card.tempDefBoost || 0) + deltaDef;
      }
    });
    return targetCards.length > 0 && (atkFactor !== 1 || defFactor !== 1);
  }

  applyReduceSelfAtk(action, ctx) {
    const card = ctx?.source;
    const amount = Math.max(0, action.amount ?? 0);
    if (!card || amount <= 0) return false;

    const originalAtk = card.atk || 0;
    card.atk = Math.max(0, originalAtk - amount);

    if (this.game?.renderer?.log) {
      this.game.renderer.log(
        `${card.name} paid ${amount} ATK to negate destruction (ATK agora: ${card.atk}).`
      );
    }

    return true;
  }

  applyForbidAttackThisTurn(action, targets, ctx) {
    // Se targetRef está definido, usa os alvos selecionados
    // Caso contrário, aplica à carta fonte (self)
    let targetCards = [];
    if (action.targetRef && targets[action.targetRef]) {
      targetCards = targets[action.targetRef];
    } else if (ctx && ctx.source) {
      targetCards = [ctx.source];
    }

    targetCards.forEach((card) => {
      card.cannotAttackThisTurn = true;
    });
    return targetCards.length > 0;
  }

  applyForbidAttackNextTurn(action, targets, ctx) {
    let targetCards = [];
    if (action.targetRef && targets[action.targetRef]) {
      targetCards = targets[action.targetRef];
    } else if (ctx && ctx.source) {
      targetCards = [ctx.source];
    }

    if (targetCards.length === 0) {
      return false;
    }

    const currentTurn = this.game?.turnCounter ?? 0;
    const extraTurns = Math.max(
      1,
      Math.floor(typeof action.turns === "number" ? action.turns : 1)
    );
    const untilTurn = currentTurn + extraTurns;

    targetCards.forEach((card) => {
      card.cannotAttackThisTurn = true;
      if (
        !card.cannotAttackUntilTurn ||
        card.cannotAttackUntilTurn < untilTurn
      ) {
        card.cannotAttackUntilTurn = untilTurn;
      }
    });

    return true;
  }

  applyGrantVoidFusionImmunity(action, ctx) {
    const card = ctx?.summonedCard;
    const player = ctx?.player;
    if (
      !card ||
      !player ||
      card.cardKind !== "monster" ||
      card.monsterType !== "fusion" ||
      card.owner !== player.id
    ) {
      return false;
    }

    const archetypes = card.archetypes
      ? card.archetypes
      : card.archetype
      ? [card.archetype]
      : [];
    if (!archetypes.includes("Void")) {
      return false;
    }

    const duration = Math.max(1, action.durationTurns ?? 1);
    const untilTurn = (this.game?.turnCounter ?? 0) + duration;
    card.immuneToOpponentEffectsUntilTurn = Math.max(
      card.immuneToOpponentEffectsUntilTurn ?? 0,
      untilTurn
    );

    if (this.game?.renderer?.log) {
      this.game.renderer.log(
        `${card.name} está imune aos efeitos do oponente até o final do próximo turno.`
      );
    }

    return true;
  }

  applyDarknessValleyInitialBuff(action, ctx) {
    const amount = action.amount ?? 0;
    if (!amount || !ctx?.player) return false;
    const archetype = action.archetype || "Shadow-Heart";
    let applied = false;

    (ctx.player.field || []).forEach((monster) => {
      if (!monster || monster.cardKind !== "monster") return;
      if (monster.isFacedown) return;
      const archetypes = monster.archetypes
        ? monster.archetypes
        : monster.archetype
        ? [monster.archetype]
        : [];
      if (!archetypes.includes(archetype)) return;
      if (this.addNamedPermanentAtkBuff(monster, ctx.source.name, amount)) {
        applied = true;
      }
    });

    return applied;
  }

  applyDarknessValleySummonBuff(action, ctx) {
    const amount = action.amount ?? 0;
    const monster = ctx?.summonedCard;
    if (!amount || !monster || monster.cardKind !== "monster") return false;
    if (monster.owner !== ctx.player.id) return false;
    if (monster.isFacedown) return false;

    const archetype = action.archetype || "Shadow-Heart";
    const archetypes = monster.archetypes
      ? monster.archetypes
      : monster.archetype
      ? [monster.archetype]
      : [];

    if (!archetypes.includes(archetype)) return false;

    return this.addNamedPermanentAtkBuff(monster, ctx.source.name, amount);
  }

  applyDarknessValleyCleanup(action, ctx) {
    const amount = action.amount ?? 0;
    const archetype = action.archetype || "Shadow-Heart";
    return this.removePermanentBuffFromGroup(
      ctx.player,
      ctx.source.name,
      archetype,
      amount
    );
  }

  applyDarknessValleyBattlePunish(action, ctx) {
    const destroyed = ctx?.destroyed;
    const attacker = ctx?.attacker;
    if (!destroyed || !attacker) return false;

    const archetype = action.archetype || "Shadow-Heart";
    const minLevel = action.minLevel ?? 8;

    if (destroyed.owner !== ctx.player.id) return false;
    const destroyedArchetypes = destroyed.archetypes
      ? destroyed.archetypes
      : destroyed.archetype
      ? [destroyed.archetype]
      : [];
    if (!destroyedArchetypes.includes(archetype)) return false;
    if ((destroyed.level || 0) < minLevel) return false;

    const attackerOwner = this.getOwnerByCard(attacker);
    if (!attackerOwner || attackerOwner === ctx.player) return false;
    if (!attackerOwner.field.includes(attacker)) return false;

    this.game.moveCard(attacker, attackerOwner, "graveyard", {
      fromZone: "field",
    });
    return true;
  }

  applySearchAny(action, ctx) {
    const deck = ctx.player.deck;
    if (!deck || deck.length === 0) {
      console.log("No cards in deck to search.");
      return false;
    }

    // Opcional: filtrar por arquétipo
    let candidates = deck;
    if (action.archetype) {
      candidates = deck.filter((card) => {
        const archetypes = Array.isArray(card.archetypes)
          ? card.archetypes
          : card.archetype
          ? [card.archetype]
          : [];
        return archetypes.includes(action.archetype);
      });

      if (candidates.length === 0) {
        console.log(`No cards in deck matching archetype: ${action.archetype}`);
        return false;
      }
    }

    if (action.cardKind) {
      const kinds = Array.isArray(action.cardKind)
        ? action.cardKind
        : [action.cardKind];

      candidates = candidates.filter((card) => kinds.includes(card.cardKind));

      if (candidates.length === 0) {
        console.log(`No cards in deck matching card kind: ${action.cardKind}`);
        return false;
      }
    }

    if (action.cardName) {
      const nameToMatch = action.cardName?.toLowerCase?.() ?? "";
      candidates = candidates.filter(
        (card) => card && card.name && card.name.toLowerCase() === nameToMatch
      );
      if (candidates.length === 0) {
        console.log(`No cards in deck matching name: ${action.cardName}`);
        return false;
      }
    }

    if (typeof action.cardId === "number") {
      candidates = candidates.filter(
        (card) => card && card.id === action.cardId
      );
      if (candidates.length === 0) {
        console.log(`No cards in deck with ID: ${action.cardId}`);
        return false;
      }
    }

    if (typeof action.minLevel === "number") {
      candidates = candidates.filter(
        (card) => (card.level || 0) >= action.minLevel
      );
    }

    if (typeof action.maxLevel === "number") {
      candidates = candidates.filter(
        (card) => (card.level || 0) <= action.maxLevel
      );
    }

    if (candidates.length === 0) {
      console.log("No cards in deck matching level constraints.");
      return false;
    }

    // Bots auto-pick a candidate without prompting the user.
    if (ctx?.player?.id === "bot") {
      const best =
        candidates.reduce((top, card) => {
          if (!card) return top;
          if (!top) return card;
          const cardAtk = card.atk || 0;
          const topAtk = top.atk || 0;
          return cardAtk >= topAtk ? card : top;
        }, null) || candidates[candidates.length - 1];

      const cardIndex = deck.indexOf(best);
      if (cardIndex === -1) return false;

      const [card] = deck.splice(cardIndex, 1);
      ctx.player.hand.push(card);
      this.game.updateBoard();
      console.log(`${ctx.player.id} added ${card.name} from Deck to hand.`);
      return true;
    }

    const defaultCard = candidates[candidates.length - 1].name;
    const searchModal = this.getSearchModalElements();

    if (searchModal) {
      this.showSearchModalVisual(
        searchModal,
        candidates,
        defaultCard,
        (choice) => {
          this.finishSearchSelection(choice, candidates, ctx);
        }
      );
      return true;
    }

    // Fallback: auto-seleciona o melhor disponível
    const fallback =
      candidates.reduce((top, card) => {
        if (!card) return top;
        if (!top) return card;
        const cardAtk = card.atk || 0;
        const topAtk = top.atk || 0;
        return cardAtk >= topAtk ? card : top;
      }, null) || candidates[candidates.length - 1];

    this.finishSearchSelection(fallback?.name || defaultCard, candidates, ctx);
    return true;
  }

  getSearchModalElements() {
    const modal = document.getElementById("search-modal");
    const input = document.getElementById("search-input");
    const select = document.getElementById("search-dropdown");
    const confirmBtn = document.getElementById("search-confirm");
    const cancelBtn = document.getElementById("search-cancel");
    const closeBtn = document.getElementById("search-close");

    if (modal && input && select && confirmBtn && cancelBtn && closeBtn) {
      return { modal, input, select, confirmBtn, cancelBtn, closeBtn };
    }

    return null;
  }

  showSearchModal(elements, candidates, defaultCard, onConfirm, allCards) {
    const { modal, input, select, confirmBtn, cancelBtn, closeBtn } = elements;

    select.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Escolha uma carta";
    select.appendChild(placeholder);

    // Only show candidates, not all cards from the database
    const sortedCandidates = [...candidates].sort((a, b) => {
      const nameA = (a?.name || "").toLocaleLowerCase();
      const nameB = (b?.name || "").toLocaleLowerCase();
      return nameA.localeCompare(nameB);
    });

    sortedCandidates.forEach((card) => {
      if (!card || !card.name) return;
      const opt = document.createElement("option");
      opt.value = card.name;
      opt.textContent = card.name;
      select.appendChild(opt);
    });

    input.value = defaultCard || "";

    const cleanup = () => {
      modal.classList.add("hidden");
      confirmBtn.removeEventListener("click", confirmHandler);
      cancelBtn.removeEventListener("click", cancelHandler);
      closeBtn.removeEventListener("click", cancelHandler);
      select.removeEventListener("change", selectHandler);
      input.removeEventListener("keydown", keyHandler);
    };

    const confirmHandler = () => {
      const choice = (input.value || select.value || "").trim();
      cleanup();
      onConfirm(choice);
    };

    const cancelHandler = () => {
      const choice = (input.value || select.value || defaultCard || "").trim();
      cleanup();
      onConfirm(choice);
    };

    const selectHandler = () => {
      if (select.value) {
        input.value = select.value;
      }
    };

    const keyHandler = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        confirmHandler();
      } else if (e.key === "Escape") {
        cancelHandler();
      }
    };

    confirmBtn.addEventListener("click", confirmHandler);
    cancelBtn.addEventListener("click", cancelHandler);
    closeBtn.addEventListener("click", cancelHandler);
    select.addEventListener("change", selectHandler);
    input.addEventListener("keydown", keyHandler);

    modal.classList.remove("hidden");
    input.focus();
  }

  showSearchModalVisual(elements, candidates, defaultCard, onConfirm) {
    // Create overlay wrapper
    const overlay = document.createElement("div");
    overlay.className = "search-modal-visual";

    // Create modal content container
    const modalContent = document.createElement("div");
    modalContent.className = "modal-content";

    // Title
    const title = document.createElement("h2");
    title.textContent = "Select a card from candidates";
    modalContent.appendChild(title);

    // Hint text
    const hint = document.createElement("p");
    hint.className = "search-hint";
    hint.textContent = "Click on a card to select it";
    modalContent.appendChild(hint);

    // Cards grid
    const grid = document.createElement("div");
    grid.className = "cards-grid";

    let selectedCard = defaultCard
      ? candidates.find((c) => c.name === defaultCard) || candidates[0]
      : candidates[0];

    candidates.forEach((card) => {
      if (!card || !card.name) return;

      const cardBtn = document.createElement("button");
      cardBtn.className = "search-card-btn";
      if (selectedCard && card.name === selectedCard.name) {
        cardBtn.classList.add("selected");
      }

      // Card image
      const img = document.createElement("img");
      img.src = card.image || "assets/card-back.png";
      img.alt = card.name;
      img.className = "search-card-image";
      cardBtn.appendChild(img);

      // Card name
      const nameDiv = document.createElement("div");
      nameDiv.className = "search-card-name";
      nameDiv.textContent = card.name;
      cardBtn.appendChild(nameDiv);

      // Card type
      const typeDiv = document.createElement("div");
      typeDiv.className = "search-card-type";
      const typeText = card.type ? `${card.type}` : "Unknown";
      const levelText = card.level ? ` / L${card.level}` : "";
      typeDiv.textContent = typeText + levelText;
      cardBtn.appendChild(typeDiv);

      // Card stats
      if (card.cardKind === "monster") {
        const statsDiv = document.createElement("div");
        statsDiv.className = "search-card-stats";
        const atk = card.atk !== undefined ? card.atk : "?";
        const def = card.def !== undefined ? card.def : "?";
        statsDiv.textContent = `ATK ${atk} / DEF ${def}`;
        cardBtn.appendChild(statsDiv);
      }

      // Click handler
      cardBtn.onclick = () => {
        // Remove selected from all cards
        grid.querySelectorAll(".search-card-btn").forEach((btn) => {
          btn.classList.remove("selected");
        });
        // Add selected to this card
        cardBtn.classList.add("selected");
        selectedCard = card;
      };

      grid.appendChild(cardBtn);
    });

    modalContent.appendChild(grid);

    // Action buttons
    const actions = document.createElement("div");
    actions.className = "search-actions";

    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "Confirm";
    confirmBtn.className = "confirm";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.className = "cancel";

    const cleanup = () => {
      overlay.remove();
    };

    confirmBtn.onclick = () => {
      cleanup();
      if (selectedCard) {
        onConfirm(selectedCard.name);
      }
    };

    cancelBtn.onclick = () => {
      cleanup();
      if (defaultCard) {
        onConfirm(defaultCard);
      } else if (selectedCard) {
        onConfirm(selectedCard.name);
      }
    };

    // Click outside to close
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        cleanup();
        if (defaultCard) {
          onConfirm(defaultCard);
        } else if (selectedCard) {
          onConfirm(selectedCard.name);
        }
      }
    };

    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);
    modalContent.appendChild(actions);

    overlay.appendChild(modalContent);
    document.body.appendChild(overlay);
  }

  finishSearchSelection(choice, candidates, ctx) {
    const deck = ctx.player.deck;
    let chosenFromCandidates = null;

    if (choice) {
      const lower = choice.toLowerCase();
      chosenFromCandidates =
        candidates.find((c) => c && c.name && c.name.toLowerCase() === lower) ||
        null;
    }

    if (!chosenFromCandidates) {
      // fallback: último candidato da lista
      chosenFromCandidates = candidates[candidates.length - 1];
    }

    const cardIndex = deck.indexOf(chosenFromCandidates);
    if (cardIndex === -1) return;

    const [card] = deck.splice(cardIndex, 1);
    ctx.player.hand.push(card);
    this.game.updateBoard();
    console.log(`${ctx.player.id} added ${card.name} from Deck to hand.`);
  }

  applyTransmutate(action, ctx, targets) {
    const costTargets = targets[action.targetRef] || [];
    const sacrifice = costTargets[0];
    if (!sacrifice) return false;

    const owner =
      sacrifice.owner === "player" ? this.game.player : this.game.bot;
    if (owner !== ctx.player) {
      return false;
    }

    if (this.game && typeof this.game.moveCard === "function") {
      this.game.moveCard(sacrifice, owner, "graveyard");
    } else {
      const field = owner.field;
      const idx = field.indexOf(sacrifice);
      if (idx === -1) {
        return false;
      }
      field.splice(idx, 1);
      owner.graveyard.push(sacrifice);
    }

    const level = sacrifice.level || 0;

    this.game.updateBoard();

    setTimeout(() => {
      this.game.promptTransmutateRevive(owner, level);
    }, 350);
    return true;
  }

  applyEquip(action, ctx, targets) {
    const equipCard = ctx.source;
    const player = ctx.player;

    const targetCards = targets[action.targetRef] || [];
    if (!targetCards.length) return false;

    const target = targetCards[0];
    const detachFromPreviousHost = () => {
      const previousHost = equipCard.equippedTo;
      if (!previousHost || previousHost === target) return;

      if (Array.isArray(previousHost.equips)) {
        const idxEquip = previousHost.equips.indexOf(equipCard);
        if (idxEquip > -1) {
          previousHost.equips.splice(idxEquip, 1);
        }
      }

      if (
        typeof equipCard.equipAtkBonus === "number" &&
        equipCard.equipAtkBonus !== 0
      ) {
        previousHost.atk = Math.max(
          0,
          (previousHost.atk || 0) - equipCard.equipAtkBonus
        );
      }
      if (
        typeof equipCard.equipDefBonus === "number" &&
        equipCard.equipDefBonus !== 0
      ) {
        previousHost.def = Math.max(
          0,
          (previousHost.def || 0) - equipCard.equipDefBonus
        );
      }
      if (
        typeof equipCard.equipExtraAttacks === "number" &&
        equipCard.equipExtraAttacks !== 0
      ) {
        const currentExtra = previousHost.extraAttacks || 0;
        const nextExtra = currentExtra - equipCard.equipExtraAttacks;
        previousHost.extraAttacks = Math.max(0, nextExtra);
        const prevMaxAttacks = 1 + (previousHost.extraAttacks || 0);
        previousHost.hasAttacked =
          (previousHost.attacksUsedThisTurn || 0) >= prevMaxAttacks;
      }
      if (equipCard.grantsBattleIndestructible) {
        previousHost.battleIndestructible = false;
      }

      equipCard.equipAtkBonus = 0;
      equipCard.equipDefBonus = 0;
      equipCard.equipExtraAttacks = 0;
      equipCard.grantsBattleIndestructible = false;
      equipCard.grantsCrescentShieldGuard = false;
      equipCard.equippedTo = null;
    };

    if (!target || target.cardKind !== "monster") return false;
    if (target.isFacedown) {
      console.warn("Cannot equip to a facedown monster:", target.name);
      return false;
    }

    detachFromPreviousHost();

    if (this.game && typeof this.game.moveCard === "function") {
      const zone = this.game.getZone(player, "hand");
      if (zone && zone.includes(equipCard)) {
        this.game.moveCard(equipCard, player, "spellTrap", {
          isFacedown: false,
          resetAttackFlags: false,
        });
      }
    }

    equipCard.equippedTo = target;
    if (!Array.isArray(target.equips)) {
      target.equips = [];
    }
    if (!target.equips.includes(equipCard)) {
      target.equips.push(equipCard);
    }

    if (typeof action.atkBonus === "number") {
      equipCard.equipAtkBonus = action.atkBonus;
      target.atk += action.atkBonus;
    }
    if (typeof action.defBonus === "number") {
      equipCard.equipDefBonus = action.defBonus;
      target.def += action.defBonus;
    }
    if (typeof action.extraAttacks === "number" && action.extraAttacks !== 0) {
      equipCard.equipExtraAttacks = action.extraAttacks;
      target.extraAttacks = (target.extraAttacks || 0) + action.extraAttacks;
    }

    if (action.battleIndestructible) {
      equipCard.grantsBattleIndestructible = true;
      target.battleIndestructible = true;
    } else {
      equipCard.grantsBattleIndestructible = false;
    }

    if (action.grantCrescentShieldGuard) {
      equipCard.grantsCrescentShieldGuard = true;
    } else {
      equipCard.grantsCrescentShieldGuard = false;
    }

    const maxAttacksAfterEquip = 1 + (target.extraAttacks || 0);
    target.hasAttacked =
      (target.attacksUsedThisTurn || 0) >= maxAttacksAfterEquip;
    return true;
  }

  applyShadowHeartRageScaleBuff(action, ctx) {
    const player = ctx?.player;
    if (!player) return false;

    const faceUpMonsters = (player.field || []).filter(
      (c) => c && c.cardKind === "monster" && !c.isFacedown
    );
    if (faceUpMonsters.length !== 1) return false;

    const scale = faceUpMonsters[0];
    if (scale.name !== "Shadow-Heart Scale Dragon") return false;

    const atkBoost = action.atkBoost ?? 700;
    const defBoost = action.defBoost ?? 700;

    if (atkBoost) {
      scale.atk += atkBoost;
      scale.tempAtkBoost = (scale.tempAtkBoost || 0) + atkBoost;
    }
    if (defBoost) {
      scale.def += defBoost;
      scale.tempDefBoost = (scale.tempDefBoost || 0) + defBoost;
    }

    scale.canMakeSecondAttackThisTurn = true;
    scale.secondAttackUsedThisTurn = false;
    return true;
  }

  showSickleSelectionModal(candidates, maxSelect, onConfirm, onCancel) {
    if (
      this.game?.renderer &&
      typeof this.game.renderer.showCardGridSelectionModal === "function"
    ) {
      this.game.renderer.showCardGridSelectionModal({
        title: 'Select up to 2 "Luminarch" monsters to add to hand',
        subtitle: `Select up to ${maxSelect}.`,
        cards: candidates,
        minSelect: 0,
        maxSelect,
        confirmLabel: "Add to Hand",
        cancelLabel: "Cancel",
        overlayClass: "modal sickle-overlay",
        modalClass: "modal-content sickle-modal",
        gridClass: "sickle-list",
        cardClass: "sickle-row",
        onConfirm,
        onCancel,
        renderCard: (c) => {
          const row = document.createElement("label");
          row.classList.add("sickle-row");
          const name = document.createElement("span");
          const stats = `ATK ${c.atk || 0} / DEF ${c.def || 0} / L${
            c.level || 0
          }`;
          name.textContent = `${c.name} (${stats})`;
          row.appendChild(name);
          return row;
        },
      });
      return;
    }

    // Fallback: no auto-pick, just select up to maxSelect in order (respects manual philosophy)
    const chosen = candidates.slice(0, maxSelect);
    console.log(
      `[HEADLESS] Sickle: Auto-selecting ${chosen.length} Luminarch monsters in order.`
    );
    onConfirm(chosen);
  }

  applyMove(action, ctx, targets) {
    const targetCards = targets[action.targetRef] || [];
    if (!targetCards || targetCards.length === 0) return false;

    const toZone = action.to || action.toZone;
    if (!toZone) {
      console.warn("move action missing destination zone:", action);
      return false;
    }

    let moved = false;
    let waitingForChoice = false;

    targetCards.forEach((card) => {
      if (
        toZone === "field" &&
        card.summonRestrict === "shadow_heart_invocation_only"
      ) {
        console.log(
          `${card.name} can only be Special Summoned by "Shadow-Heart Invocation".`
        );
        return false;
      }
      let destPlayer;
      if (action.player === "self") {
        destPlayer = ctx.player;
      } else if (action.player === "opponent") {
        destPlayer = ctx.opponent;
      } else {
        destPlayer = card.owner === "player" ? this.game.player : this.game.bot;
      }

      const shouldPromptForPosition =
        toZone === "field" &&
        card.cardKind === "monster" &&
        this.game &&
        destPlayer === this.game.player &&
        typeof this.game.chooseSpecialSummonPosition === "function";

      const defaultFieldPosition =
        toZone === "field" && card.cardKind === "monster" ? "attack" : null;

      const applyMoveWithPosition = (chosenPosition) => {
        const finalPosition = shouldPromptForPosition
          ? chosenPosition ||
            action.position ||
            defaultFieldPosition ||
            "attack"
          : chosenPosition ?? action.position ?? defaultFieldPosition;

        if (this.game && typeof this.game.moveCard === "function") {
          this.game.moveCard(card, destPlayer, toZone, {
            position: finalPosition,
            isFacedown: action.isFacedown,
            resetAttackFlags: action.resetAttackFlags,
          });
        } else {
          const fromOwner =
            card.owner === "player" ? this.game.player : this.game.bot;
          const zones = ["field", "hand", "deck", "graveyard", "spellTrap"];
          for (const zoneName of zones) {
            const arr = this.getZone(fromOwner, zoneName);
            const idx = arr ? arr.indexOf(card) : -1;
            if (idx > -1) {
              arr.splice(idx, 1);
              break;
            }
          }

          const destArr = this.getZone(destPlayer, toZone);
          if (!destArr) {
            console.warn("applyMove: unknown destination zone:", toZone);
            return;
          }

          if (finalPosition) {
            card.position = finalPosition;
          }
          if (typeof action.isFacedown === "boolean") {
            card.isFacedown = action.isFacedown;
          }
          if (action.resetAttackFlags) {
            card.hasAttacked = false;
            card.cannotAttackThisTurn = false;
            card.attacksUsedThisTurn = 0;
          }

          card.owner = destPlayer.id;
          destArr.push(card);
        }
        moved = true;

        if (this.game && typeof this.game.updateBoard === "function") {
          this.game.updateBoard();
        }
        if (this.game && typeof this.game.checkWinCondition === "function") {
          this.game.checkWinCondition();
        }

        if (this.game?.renderer?.log) {
          this.game.renderer.log(`${card.name} moved to ${toZone}.`);
        }
      };

      if (shouldPromptForPosition) {
        const positionChoice = this.game.chooseSpecialSummonPosition(
          destPlayer,
          card
        );
        if (positionChoice && typeof positionChoice.then === "function") {
          waitingForChoice = true;
          positionChoice.then((resolved) => applyMoveWithPosition(resolved));
        } else {
          applyMoveWithPosition(positionChoice);
        }
      } else {
        applyMoveWithPosition(action.position);
      }
    });
    return moved || waitingForChoice;
  }

  applyShadowHeartDeathWyrmSpecialSummon(action, ctx) {
    const card = ctx?.source;
    if (!card) return false;

    const owner = ctx?.player || this.getOwnerByCard(card);
    if (!owner) return false;

    owner.hand = owner.hand || [];
    owner.field = owner.field || [];

    if (!owner.hand.includes(card)) return false;

    const destroyed = ctx?.destroyed;
    const destroyedOwner = ctx?.destroyedOwner;
    if (!destroyed || !destroyedOwner) return false;
    if (destroyedOwner !== owner && destroyedOwner?.id !== owner.id)
      return false;

    const destroyedArchetypes = destroyed.archetypes
      ? destroyed.archetypes
      : destroyed.archetype
      ? [destroyed.archetype]
      : [];
    if (!destroyedArchetypes.includes("Shadow-Heart")) return false;

    if (owner.field.length >= 5) {
      console.log("No space to Special Summon Shadow-Heart Death Wyrm.");
      return false;
    }

    if (this.game && typeof this.game.moveCard === "function") {
      this.game.moveCard(card, owner, "field", {
        fromZone: "hand",
        position: "attack",
        isFacedown: false,
        resetAttackFlags: true,
      });
    } else {
      const handIndex = owner.hand.indexOf(card);
      if (handIndex === -1) return false;
      owner.hand.splice(handIndex, 1);
      card.position = "attack";
      card.isFacedown = false;
      card.hasAttacked = false;
      card.cannotAttackThisTurn = false;
      card.attacksUsedThisTurn = 0;
      card.owner = owner.id;
      owner.field.push(card);
    }

    console.log("Shadow-Heart Death Wyrm is Special Summoned from the hand!");
    this.game?.updateBoard?.();
    return true;
  }

  applyShadowHeartShieldUpkeep(action, ctx) {
    const card = ctx?.source;
    const owner = ctx?.player || this.getOwnerByCard(card);
    if (!card || !owner) return false;

    const game = this.game;
    const renderer = game?.renderer;
    const inSpellTrap = (owner.spellTrap || []).includes(card);
    const onField =
      inSpellTrap ||
      owner.fieldSpell === card ||
      (owner.field || []).includes(card);

    if (!onField) return false;

    const sendToGrave = (logMessage) => {
      if (renderer && logMessage) {
        renderer.log(logMessage);
      }
      if (game && typeof game.moveCard === "function") {
        game.moveCard(card, owner, "graveyard", {
          fromZone: inSpellTrap ? "spellTrap" : "fieldSpell",
        });
      } else {
        const zones = [
          owner.spellTrap,
          owner.fieldSpell ? [owner.fieldSpell] : [],
          owner.field,
        ].filter(Boolean);
        for (const zone of zones) {
          const idx = zone.indexOf(card);
          if (idx > -1) {
            zone.splice(idx, 1);
            if (owner.fieldSpell === card) {
              owner.fieldSpell = null;
            }
            break;
          }
        }
        owner.graveyard.push(card);
      }
      game?.updateBoard?.();
      game?.checkWinCondition?.();
      return true;
    };

    const logMessage = (msg) => {
      if (renderer && msg) {
        renderer.log(msg);
      }
    };

    if (owner.lp < 800) {
      return sendToGrave(
        `${card.name} upkeep: not enough LP to pay 800, sent to Graveyard.`
      );
    }

    if (owner.id === "player") {
      const wantsToPay = window.confirm(
        `Pagar 800 LP para manter "${card.name}" no campo? Se não pagar, esta carta será enviada ao Cemitério.`
      );

      if (wantsToPay) {
        owner.takeDamage(800);
        logMessage(`Paid 800 LP to maintain ${card.name}.`);
        game?.updateBoard?.();
        game?.checkWinCondition?.();
        return true;
      }

      return sendToGrave(
        `You chose not to pay 800 LP for ${card.name}; it was sent to the Graveyard.`
      );
    }

    // Bot decision: pay if possible, otherwise send to Graveyard.
    if (owner.lp >= 800) {
      owner.takeDamage(800);
      logMessage(`Bot paid 800 LP to maintain ${card.name}.`);
      game?.updateBoard?.();
      game?.checkWinCondition?.();
      return true;
    }

    return sendToGrave(
      `${card.name} upkeep: bot could not pay 800 LP, sent to Graveyard.`
    );
  }

  async applyReviveShadowHeartFromGrave(action, ctx) {
    const player = action.player === "opponent" ? ctx.opponent : ctx.player;
    if (!player) return false;

    const gy = player.graveyard || [];

    const candidates = gy.filter((card) => {
      if (!card || card.cardKind !== "monster") return false;

      // Ritual boss cannot be revived by Infusion
      if (card.summonRestrict === "shadow_heart_invocation_only") return false;
      if (card.archetype === "Shadow-Heart") return true;
      if (Array.isArray(card.archetypes)) {
        return card.archetypes.includes("Shadow-Heart");
      }
      return false;
    });

    if (candidates.length === 0) {
      console.log('No "Shadow-Heart" monsters in graveyard to revive.');
      return false;
    }

    // Bot ou candidato único: auto-seleciona
    if (candidates.length === 1 || player.id === "bot") {
      const chosen = candidates[0];
      return this.finishReviveShadowHeart(chosen, gy, player, action);
    }

    // Player: modal visual
    const searchModal = this.getSearchModalElements();
    const defaultCardName = candidates[0]?.name || "";

    return new Promise((resolve) => {
      const finalizeSelection = (selectedName) => {
        const chosen =
          candidates.find((c) => c && c.name === selectedName) || candidates[0];
        const result = this.finishReviveShadowHeart(chosen, gy, player, action);
        resolve(result);
      };

      if (searchModal) {
        this.showSearchModalVisual(
          searchModal,
          candidates,
          defaultCardName,
          (choice) => finalizeSelection(choice)
        );
      } else {
        // Fallback: auto-seleciona o primeiro
        finalizeSelection(defaultCardName);
      }
    });
  }

  async finishReviveShadowHeart(chosen, gy, player, action) {
    if (!chosen) {
      console.log("No valid choice made for revival.");
      return false;
    }

    const idx = gy.indexOf(chosen);
    if (idx === -1) {
      console.warn("Chosen card is not in graveyard anymore:", chosen.name);
      return false;
    }

    gy.splice(idx, 1);

    // Escolher posição para special summon
    const position = await this.chooseSpecialSummonPosition(chosen, player);

    chosen.position = position;
    chosen.isFacedown = false;
    chosen.hasAttacked = false;
    chosen.attacksUsedThisTurn = 0;
    chosen.cannotAttackThisTurn = true;

    player.field.push(chosen);

    console.log(
      `Revived "${chosen.name}" from graveyard with Shadow-Heart Infusion in ${
        position === "defense" ? "Defense" : "Attack"
      } Position.`
    );

    if (this.game && typeof this.game.updateBoard === "function") {
      this.game.updateBoard();
    }
    return true;
  }

  async applyConditionalSpecialSummonFromHand(action, ctx) {
    const player = ctx?.player;
    if (!player) return false;

    if (!player.hand || player.hand.length === 0) return false;

    const candidates = player.hand.filter((c) => c && c.cardKind === "monster");
    if (candidates.length === 0) return false;

    // Candidato único ou bot: auto-seleciona
    if (candidates.length === 1 || player.id === "bot") {
      return this.finishConditionalSpecialSummon(candidates[0], player, action);
    }

    // Player: modal visual
    const searchModal = this.getSearchModalElements();
    const defaultCardName = candidates[0]?.name || "";

    return new Promise((resolve) => {
      const finalizeSelection = (selectedName) => {
        const chosen =
          candidates.find((c) => c && c.name === selectedName) || candidates[0];
        const result = this.finishConditionalSpecialSummon(
          chosen,
          player,
          action
        );
        resolve(result);
      };

      if (searchModal) {
        this.showSearchModalVisual(
          searchModal,
          candidates,
          defaultCardName,
          (choice) => finalizeSelection(choice)
        );
      } else {
        // Fallback: auto-seleciona o primeiro
        finalizeSelection(defaultCardName);
      }
    });
  }

  async finishConditionalSpecialSummon(targetCard, player, action) {
    // Escolher posição para special summon
    const position = await this.chooseSpecialSummonPosition(targetCard, player);

    targetCard.position = position;
    targetCard.isFacedown = false;
    targetCard.hasAttacked = false;
    targetCard.cannotAttackThisTurn = action.restrictAttackThisTurn
      ? true
      : false;

    if (this.game && typeof this.game.moveCard === "function") {
      this.game.moveCard(targetCard, player, "field", {
        fromZone: "hand",
        position,
        isFacedown: false,
        resetAttackFlags: true,
      });
    } else {
      const idx = player.hand.indexOf(targetCard);
      if (idx > -1) {
        player.hand.splice(idx, 1);
      }
      player.field.push(targetCard);
    }

    if (this.game && typeof this.game.updateBoard === "function") {
      this.game.updateBoard();
    }

    return true;
  }

  async applyShadowHeartObserverSummon(action, ctx, targets) {
    const observerCard = targets && targets[0];
    if (!observerCard || !observerCard.level) {
      console.log("No valid target for Shadow-Heart Observer.");
      return false;
    }

    const targetLevel = observerCard.level;
    const candidates = ctx.player.hand.filter(
      (c) => c.cardKind === "monster" && c.level === targetLevel
    );

    if (candidates.length === 0) {
      console.log(
        `No monsters in hand with Level ${targetLevel} to Special Summon.`
      );
      return false;
    }

    if (candidates.length === 1) {
      const card = candidates[0];
      const handIndex = ctx.player.hand.indexOf(card);
      if (handIndex === -1) return false;

      ctx.player.hand.splice(handIndex, 1);
      card.position = "attack";
      card.isFacedown = false;
      card.hasAttacked = false;
      card.attacksUsedThisTurn = 0;
      ctx.player.field.push(card);

      if (this.game && typeof this.game.updateBoard === "function") {
        this.game.updateBoard();
      }

      return true;
    }

    // Multiple candidates - show modal
    return new Promise((resolve) => {
      this.game.showCardSelectionModal(
        candidates,
        `Select 1 monster with Level ${targetLevel} to Special Summon`,
        1,
        (selected) => {
          if (selected.length === 0) {
            resolve(false);
            return;
          }

          const card = selected[0];
          const handIndex = ctx.player.hand.indexOf(card);
          if (handIndex === -1) {
            resolve(false);
            return;
          }

          ctx.player.hand.splice(handIndex, 1);
          card.position = "attack";
          card.isFacedown = false;
          card.hasAttacked = false;
          card.attacksUsedThisTurn = 0;
          ctx.player.field.push(card);

          if (this.game && typeof this.game.updateBoard === "function") {
            this.game.updateBoard();
          }

          resolve(true);
        }
      );
    });
  }

  applyAddCounter(action, ctx, targets) {
    const counterType = action.counterType || "default";
    let amount = action.amount || 1;
    const targetRef = action.targetRef || "self";

    // If damagePerCounter is specified, calculate amount based on damage
    if (action.damagePerCounter && ctx.damageAmount) {
      // Add 1 counter per instance of damage that meets the threshold
      amount = ctx.damageAmount >= action.damagePerCounter ? 1 : 0;
      if (amount <= 0) return false;
    }

    let targetCards = [];
    if (targetRef === "self") {
      targetCards = [ctx.source];
    } else if (targets[targetRef]) {
      targetCards = targets[targetRef];
    }

    if (!Array.isArray(targetCards)) {
      targetCards = [targetCards];
    }

    let added = false;
    for (const card of targetCards) {
      if (card && typeof card.addCounter === "function") {
        card.addCounter(counterType, amount);
        console.log(
          `Added ${amount} ${counterType} counter(s) to ${card.name}`
        );
        added = true;
      }
    }

    if (added && this.game && typeof this.game.updateBoard === "function") {
      this.game.updateBoard();
    }

    if (added && this.game?.renderer?.log) {
      this.game.renderer.log(
        `Added ${amount} ${counterType} counter(s) to ${
          targetCards[0]?.name || ctx.source?.name || "card"
        }.`
      );
    }

    return added;
  }

  async applyShadowHeartCathedralSummon(action, ctx) {
    console.log(`[Cathedral] applyShadowHeartCathedralSummon called`);
    if (!ctx.source || !ctx.player || !this.game) {
      console.log(
        `[Cathedral] Missing context: source=${!!ctx.source}, player=${!!ctx.player}, game=${!!this
          .game}`
      );
      return false;
    }

    const counterType = action.counterType || "judgment_marker";
    const multiplier = action.counterMultiplier || 500;
    const counterCount = ctx.source.getCounter
      ? ctx.source.getCounter(counterType)
      : 0;

    console.log(`[Cathedral] Counter count: ${counterCount}`);

    // Allow opening modal even with 0 counters to show info
    const maxAtk = counterCount * multiplier;

    // Get deck candidates
    const deck = ctx.player.deck || [];
    const validMonsters = deck.filter((card) => {
      if (card.cardKind !== "monster") return false;
      if (!card.archetype || card.archetype !== "Shadow-Heart") return false;
      const cardAtk = card.atk || 0;
      return cardAtk <= maxAtk;
    });

    console.log(
      `[Cathedral] Found ${validMonsters.length} valid monsters in deck (ATK ≤ ${maxAtk})`
    );

    if (validMonsters.length === 0) {
      console.log(
        `No Shadow-Heart monsters in deck with ATK ≤ ${maxAtk} to summon.`
      );
      // Still show info to player
      if (counterCount === 0) {
        this.game.renderer.log(
          "Shadow-Heart Cathedral has no Judgment Counters yet."
        );
      } else {
        this.game.renderer.log(
          `No valid Shadow-Heart monsters in deck with ATK ≤ ${maxAtk}.`
        );
      }
      return false;
    }

    // Show selection modal to player
    return new Promise((resolve) => {
      this.game.showShadowHeartCathedralModal(
        validMonsters,
        maxAtk,
        counterCount,
        async (selectedCard) => {
          if (!selectedCard) {
            console.log("[Cathedral] No card selected, canceling");
            resolve(false);
            return;
          }

          console.log(`[Cathedral] Card selected: ${selectedCard.name}`);

          // Remove card from deck
          const deckIndex = ctx.player.deck.indexOf(selectedCard);
          if (deckIndex !== -1) {
            ctx.player.deck.splice(deckIndex, 1);
          }

          // Check field space
          if (ctx.player.field.length >= 5) {
            console.log("Field is full, cannot Special Summon.");
            this.game.renderer.log("Your field is full!");
            // Return card to deck
            ctx.player.deck.splice(deckIndex, 0, selectedCard);
            resolve(false);
            return;
          }

          // Ask for position
          const position = await new Promise((resolvePos) => {
            this.game.renderer.showSummonModal(
              selectedCard,
              false, // not a tribute summon
              (pos) => resolvePos(pos),
              () => resolvePos(null)
            );
          });

          if (!position) {
            console.log("[Cathedral] Position selection cancelled");
            // Return card to deck
            ctx.player.deck.splice(deckIndex, 0, selectedCard);
            resolve(false);
            return;
          }

          // Special Summon to field
          selectedCard.position = position;
          selectedCard.isFacedown = position === "defense" ? true : false;
          selectedCard.hasAttacked = false;
          selectedCard.cannotAttackThisTurn = false;
          ctx.player.field.push(selectedCard);

          console.log(
            `Special Summoned ${selectedCard.name} from deck via Shadow-Heart Cathedral (${counterCount} counters, max ATK ${maxAtk}) in ${position} position.`
          );

          this.game.renderer.log(
            `Special Summoned ${selectedCard.name} from deck via Shadow-Heart Cathedral!`
          );

          // Send Cathedral to GY (zeroing counters)
          this.game.moveCard(ctx.source, ctx.player, "graveyard");
          console.log("[Cathedral] Sent to Graveyard");

          // Emit after_summon event
          this.emit("after_summon", {
            card: selectedCard,
            player: ctx.player,
            summonMethod: "special",
          });

          if (typeof this.game.updateBoard === "function") {
            this.game.updateBoard();
          }

          resolve(true);
        }
      );
    });
  }

  async applyTheShadowHeartSummonAndEquip(action, ctx, targets) {
    return new Promise((resolve) => {
      const targetRef = action.targetRef;
      const selectedCards = targets[targetRef] || [];

      if (selectedCards.length === 0) {
        console.log("No target selected for The Shadow Heart.");
        resolve(false);
        return;
      }

      const selectedCard = selectedCards[0];

      if (!selectedCard) {
        console.log("Target card not found.");
        resolve(false);
        return;
      }

      // Remove from Graveyard
      const gyIndex = ctx.player.graveyard.indexOf(selectedCard);
      if (gyIndex > -1) {
        ctx.player.graveyard.splice(gyIndex, 1);
      }

      // Check field space
      if (ctx.player.field.length >= 5) {
        console.log("Field is full, cannot Special Summon.");
        ctx.player.graveyard.push(selectedCard);
        resolve(false);
        return;
      }

      // Prepare the monster for Special Summon
      selectedCard.position = "attack";
      selectedCard.isFacedown = false;
      selectedCard.hasAttacked = false;
      selectedCard.cannotAttackThisTurn = false;
      selectedCard.owner = ctx.player.id;
      ctx.player.field.push(selectedCard);

      // Equip The Shadow Heart to the monster
      const equipCard = ctx.source; // The Shadow Heart card itself
      // Move para zona de spell/trap se estiver na mão ou em outro lugar
      if (this.game && typeof this.game.moveCard === "function") {
        const zone = this.game.getZone(ctx.player, "hand");
        if (zone && zone.includes(equipCard)) {
          this.game.moveCard(equipCard, ctx.player, "spellTrap", {
            isFacedown: false,
            resetAttackFlags: false,
          });
        }
      }
      equipCard.equippedTo = selectedCard;
      if (!Array.isArray(selectedCard.equips)) {
        selectedCard.equips = [];
      }
      if (!selectedCard.equips.includes(equipCard)) {
        selectedCard.equips.push(equipCard);
      }

      console.log(
        `Special Summoned ${selectedCard.name} from Graveyard via The Shadow Heart and equipped the spell.`
      );

      if (typeof this.game.updateBoard === "function") {
        this.game.updateBoard();
      }

      resolve(true);
    });
  }

  async applyAbyssalEelSpecialSummon(action, ctx) {
    if (!ctx.source || !ctx.player || !this.game) {
      return false;
    }

    // Find Leviathan in hand
    const hand = ctx.player.hand || [];
    const leviathanCard = hand.find(
      (card) => card && card.name === "Shadow-Heart Leviathan"
    );

    if (!leviathanCard) {
      this.game.renderer.log("No Shadow-Heart Leviathan in hand.");
      return false;
    }

    // Check field space
    if (ctx.player.field.length >= 5) {
      this.game.renderer.log("Field is full.");
      return false;
    }

    // Send Abyssal Eel to GY
    this.game.moveCard(ctx.source, ctx.player, "graveyard");

    // Set pending special summon for Leviathan and lock player actions
    this.game.pendingSpecialSummon = {
      cardName: "Shadow-Heart Leviathan",
    };
    this.game.isResolvingEffect = true;

    this.game.renderer.log(
      `${ctx.source.name} sent to Graveyard. Click ${leviathanCard.name} to Special Summon it.`
    );

    if (typeof this.game.updateBoard === "function") {
      this.game.updateBoard();
    }

    return true;
  }

  async performBotFusion(ctx, summonableFusions, availableMaterials) {
    // Bot escolhe automaticamente o melhor monstro de fusão (maior ATK)
    const bestFusion = summonableFusions.reduce((best, current) => {
      const bestAtk = best.fusion.atk || 0;
      const currentAtk = current.fusion.atk || 0;
      return currentAtk > bestAtk ? current : best;
    }, summonableFusions[0]);

    const fusionMonster = bestFusion.fusion;
    const fusionIndex = bestFusion.index;

    // Encontrar materiais válidos
    const combos = this.findFusionMaterialCombos(
      fusionMonster,
      availableMaterials,
      { maxResults: 1, player: ctx.player }
    );

    if (combos.length === 0) {
      this.game.renderer.log(
        `${ctx.player.name} failed to find valid materials.`
      );
      return false;
    }

    const selectedMaterials = combos[0];

    // Validar materiais
    const validation = this.evaluateFusionSelection(
      fusionMonster,
      selectedMaterials,
      { player: ctx.player }
    );
    if (!validation.ok) {
      this.game.renderer.log(`${ctx.player.name} selected invalid materials.`);
      return false;
    }

    // Bot sempre invoca em ataque (monstros poderosos devem atacar)
    const position = "attack";

    // Executar Fusion Summon usando o jogador correto (bot)
    const success = this.game.performFusionSummon(
      selectedMaterials,
      fusionIndex,
      position,
      validation.usedMaterials,
      ctx.player // Passa o jogador correto
    );

    if (success) {
      this.game.renderer.log(
        `${ctx.player.name} Fusion Summoned ${fusionMonster.name}!`
      );
    }

    return success;
  }

  async applyPolymerizationFusion(action, ctx) {
    if (!ctx.player || !this.game) {
      return false;
    }

    // Check if player has Extra Deck with Fusion Monsters
    if (!ctx.player.extraDeck || ctx.player.extraDeck.length === 0) {
      this.game.renderer.log("No Fusion Monsters in Extra Deck.");
      return false;
    }

    // Check field space
    if (ctx.player.field.length >= 5) {
      this.game.renderer.log("Field is full.");
      return false;
    }

    // Get available materials (hand + field)
    const availableMaterials = [
      ...(ctx.player.hand || []),
      ...(ctx.player.field || []),
    ].filter((card) => card && card.cardKind === "monster");

    if (availableMaterials.length === 0) {
      this.game.renderer.log("No monsters available for Fusion Summon.");
      return false;
    }

    // Check which Fusion Monsters can be summoned
    const summonableFusions = this.getAvailableFusions(
      ctx.player.extraDeck,
      availableMaterials,
      ctx.player
    );

    if (summonableFusions.length === 0) {
      this.game.renderer.log(
        "No Fusion Monsters can be summoned with available materials."
      );
      return false;
    }

    // BOT AUTO-FUSION: Se é o bot, executar fusão automaticamente
    if (ctx.player.id === "bot") {
      return await this.performBotFusion(
        ctx,
        summonableFusions,
        availableMaterials
      );
    }

    // Lock actions during fusion process
    this.game.isResolvingEffect = true;

    // Step 1: Show Extra Deck modal to select Fusion Monster
    this.game.renderer.showFusionTargetModal(
      summonableFusions,
      async (selectedFusionIndex) => {
        const fusionMonster = ctx.player.extraDeck[selectedFusionIndex];

        if (!fusionMonster) {
          this.game.isResolvingEffect = false;
          this.game.renderer.log("Fusion Monster not found.");
          return;
        }

        // Step 2: Highlight valid materials and wait for selection
        const requiredMaterials = this.getFusionRequirements(fusionMonster);

        this.game.renderer.showFusionMaterialSelection(
          availableMaterials,
          requiredMaterials,
          async (selectedMaterials) => {
            // Validate materials
              const validation = this.evaluateFusionSelection(
                fusionMonster,
                selectedMaterials,
                { player: ctx.player }
              );

            if (!validation.ok) {
              this.game.isResolvingEffect = false;
              this.game.renderer.log("Invalid Fusion Materials selected.");
              return;
            }

            const extraCount =
              selectedMaterials.length - validation.requiredCount;
            if (extraCount > 0) {
              this.game.renderer.log(
                `⚠️ You selected ${selectedMaterials.length} materials (requires ${validation.requiredCount}). All selected cards will be sent to the Graveyard.`
              );
            }

            // Step 3: Choose position for Fusion Summon
            const position = await this.game.chooseSpecialSummonPosition(
              ctx.player,
              fusionMonster
            );

            // Execute Fusion Summon
            const success = this.game.performFusionSummon(
              selectedMaterials,
              selectedFusionIndex,
              position,
              validation.usedMaterials
            );

            if (success) {
              this.game.renderer.log(
                `Successfully Fusion Summoned ${fusionMonster.name}!`
              );
            }

            this.game.isResolvingEffect = false;
          },
          () => {
            // Cancel callback
            this.game.isResolvingEffect = false;
            this.game.renderer.log("Fusion Summon cancelled.");
          }
        );
      },
      () => {
        this.game.isResolvingEffect = false;
        this.game.renderer.log("Fusion Summon cancelled.");
      }
    );

    return true;
  }

  getAvailableFusions(extraDeck, materials, player = null) {
    // Returns fusion monsters that can be summoned with available materials
    return extraDeck
      .map((fusion, index) => {
        const combos = this.findFusionMaterialCombos(fusion, materials, {
          maxResults: 1,
          player,
        });
        if (combos.length > 0) {
          return { fusion, index };
        }
        return null;
      })
      .filter(Boolean);
  }

  canSummonFusion(fusionMonster, materials, player = null) {
    const combos = this.findFusionMaterialCombos(fusionMonster, materials, {
      maxResults: 1,
      player,
    });
    return combos.length > 0;
  }

  matchesFusionRequirement(card, requirement, materialZone = null) {
    // Check if card matches fusion requirement
    if (!card || !requirement) return false;

    const allowedZones = Array.isArray(requirement.allowedZones)
      ? requirement.allowedZones
      : typeof requirement.zone === "string"
      ? [requirement.zone]
      : null;

    if (allowedZones) {
      if (!materialZone || !allowedZones.includes(materialZone)) {
        return false;
      }
    }

    if (requirement.name && card.name === requirement.name) {
      return true;
    }
    if (requirement.archetype) {
      const matchesArchetype = card.archetype === requirement.archetype;
      if (!matchesArchetype) return false;

      // Check minLevel if specified
      if (requirement.minLevel) {
        const cardLevel = card.level || 0;
        if (cardLevel < requirement.minLevel) return false;
      }

      if (requirement.maxLevel) {
        const cardLevel = card.level || 0;
        if (cardLevel > requirement.maxLevel) return false;
      }

      return true;
    }
    if (requirement.type && card.type === requirement.type) {
      return true;
    }
    if (requirement.attribute && card.attribute === requirement.attribute) {
      return true;
    }
    return false;
  }

  getFusionRequirements(fusionMonster) {
    if (!fusionMonster || !Array.isArray(fusionMonster.fusionMaterials)) {
      return [];
    }
    return fusionMonster.fusionMaterials.filter(Boolean);
  }

  getFusionRequiredCount(requirements) {
    return (requirements || []).reduce(
      (acc, req) => acc + (req?.count || 1),
      0
    );
  }

  findFusionMaterialCombos(fusionMonster, materials, options = {}) {
    const requirements = this.getFusionRequirements(fusionMonster);
    if (requirements.length === 0) return [];

    const maxResults = options.maxResults || 3;
    const results = [];
    const owner = options.player || null;
    const resolveZone = (card) => {
      if (!owner || !card) return null;
      if ((owner.field || []).includes(card)) return "field";
      if ((owner.hand || []).includes(card)) return "hand";
      return null;
    };
    const pool = (materials || []).map((card, idx) => ({
      card,
      idx,
      zone: resolveZone(card),
    }));

    const used = new Set();

    const chooseK = (candidates, k, start, picked, onPick) => {
      if (k === 0) {
        onPick(picked);
        return;
      }
      for (let i = start; i < candidates.length; i++) {
        picked.push(candidates[i]);
        chooseK(candidates, k - 1, i + 1, picked, onPick);
        picked.pop();
        if (results.length >= maxResults) return;
      }
    };

    const dfs = (reqIndex, current) => {
      if (results.length >= maxResults) return;
      if (reqIndex >= requirements.length) {
        results.push([...current]);
        return;
      }

      const req = requirements[reqIndex];
      const needed = req.count || 1;
      const candidates = pool.filter(
        ({ card, idx, zone }) =>
          !used.has(idx) && this.matchesFusionRequirement(card, req, zone)
      );

      if (candidates.length < needed) return;

      chooseK(candidates, needed, 0, [], (picked) => {
        picked.forEach(({ idx }) => used.add(idx));
        current.push(...picked.map((p) => p.card));
        dfs(reqIndex + 1, current);
        current.splice(current.length - picked.length, picked.length);
        picked.forEach(({ idx }) => used.delete(idx));
      });
    };

    dfs(0, []);
    return results;
  }

  evaluateFusionSelection(fusionMonster, selectedMaterials, options = {}) {
    const requirements = this.getFusionRequirements(fusionMonster);
    const requiredCount = this.getFusionRequiredCount(requirements);
    const combos = this.findFusionMaterialCombos(
      fusionMonster,
      selectedMaterials,
      {
        maxResults: 1,
        player: options.player || null,
      }
    );

    if (combos.length === 0) {
      return { ok: false, usedMaterials: [], requiredCount };
    }

    return { ok: true, usedMaterials: combos[0], requiredCount };
  }

  getRequiredMaterials(fusionMonster) {
    return this.getFusionRequirements(fusionMonster);
  }

  validateFusionMaterials(fusionMonster, selectedMaterials, player = null) {
    return this.evaluateFusionSelection(fusionMonster, selectedMaterials, {
      player,
    }).ok;
  }

  async applyDemonDragonDestroy(action, ctx) {
    if (!ctx.source || !ctx.player || !this.game) {
      return false;
    }

    const opponent = ctx.opponent || this.game.getOpponent(ctx.player);

    // Get all opponent's cards on field
    const opponentCards = [
      ...(opponent.field || []),
      ...(opponent.spellTrap || []),
    ];

    if (opponent.fieldSpell) {
      opponentCards.push(opponent.fieldSpell);
    }

    if (opponentCards.length === 0) {
      this.game.renderer.log("Opponent has no cards to destroy.");
      return false;
    }

    // Select up to 2 targets
    const maxTargets = Math.min(2, opponentCards.length);

    this.game.renderer.log(
      `${ctx.source.name}: Select up to ${maxTargets} opponent's cards to destroy.`
    );

    // Build candidates list for showTargetSelection
    const candidates = opponentCards.map((card, index) => ({
      idx: index,
      name: card.name,
      owner: opponent.id === "player" ? "Player" : "Opponent",
      position: card.position || "",
      atk: card.atk,
      def: card.def,
      cardRef: card,
    }));

    return new Promise((resolve) => {
      this.game.renderer.showTargetSelection(
        [
          {
            id: "demon_dragon_targets",
            zone: "opponent_field",
            min: maxTargets,
            max: maxTargets,
            candidates: candidates,
          },
        ],
        (selections) => {
          const selectedIndices = selections["demon_dragon_targets"] || [];
          const targets = selectedIndices.map((idx) => opponentCards[idx]);

          targets.forEach((target) => {
            this.game.renderer.log(
              `${ctx.source.name} destroyed ${target.name}!`
            );
            this.game.moveCard(target, opponent, "graveyard");
          });

          this.game.updateBoard();
          resolve(true);
        },
        () => {
          this.game.renderer.log("Target selection cancelled.");
          resolve(false);
        }
      );
    });
  }

  async applyDemonDragonRevive(action, ctx) {
    if (!ctx.card || !ctx.player || !this.game) {
      return false;
    }

    // Check if this was Demon Dragon being destroyed
    if (ctx.card.name !== "Shadow-Heart Demon Dragon") {
      return false;
    }

    // Find Scale Dragon in GY
    const scaleDragon = ctx.player.graveyard.find(
      (card) => card && card.name === "Shadow-Heart Scale Dragon"
    );

    if (!scaleDragon) {
      this.game.renderer.log("No Shadow-Heart Scale Dragon in Graveyard.");
      return false;
    }

    // Check field space
    if (ctx.player.field.length >= 5) {
      this.game.renderer.log("Field is full.");
      return false;
    }

    // Prompt to activate effect
    return new Promise((resolve) => {
      if (
        window.confirm(
          `Activate ${ctx.card.name} effect to Special Summon Shadow-Heart Scale Dragon from GY?`
        )
      ) {
        // Remove from GY
        const gyIndex = ctx.player.graveyard.indexOf(scaleDragon);
        if (gyIndex > -1) {
          ctx.player.graveyard.splice(gyIndex, 1);
        }

        // Special Summon to field
        scaleDragon.position = "attack";
        scaleDragon.isFacedown = false;
        scaleDragon.hasAttacked = false;
        scaleDragon.cannotAttackThisTurn = false;
        scaleDragon.owner = ctx.player.id;
        ctx.player.field.push(scaleDragon);

        this.game.renderer.log(
          `${ctx.card.name} effect: Special Summoned ${scaleDragon.name} from Graveyard!`
        );

        this.game.emit("after_summon", {
          card: scaleDragon,
          player: ctx.player,
          method: "special",
        });

        this.game.updateBoard();
        resolve(true);
      } else {
        resolve(false);
      }
    });
  }

  async applyCallOfTheHauntedSummon(action, ctx, targets) {
    const player = ctx.player;
    const card = ctx.source;
    const game = this.game;

    console.log(`[applyCallOfTheHauntedSummon] Called with targets:`, targets);

    if (!targets || !targets.haunted_target) {
      game.renderer.log(
        `Call of the Haunted: Nenhum alvo selecionado no cemitério.`
      );
      return false;
    }

    // targets.haunted_target pode ser um array de cartas selecionadas
    const targetArray = Array.isArray(targets.haunted_target)
      ? targets.haunted_target
      : [targets.haunted_target];

    const targetMonster = targetArray[0];
    console.log(
      `[applyCallOfTheHauntedSummon] Target monster:`,
      targetMonster?.name
    );

    if (!targetMonster || targetMonster.cardKind !== "monster") {
      game.renderer.log(`Call of the Haunted: Alvo inválido.`);
      return false;
    }

    // Remover do cemitério
    const gyIndex = player.graveyard.indexOf(targetMonster);
    if (gyIndex > -1) {
      player.graveyard.splice(gyIndex, 1);
    } else {
      console.log(
        `[applyCallOfTheHauntedSummon] Monster not found in graveyard`
      );
    }

    // Mostrar modal para escolher posição (Special Summon permite escolha)
    const chosenPosition = await new Promise((resolve) => {
      game.renderer.showSpecialSummonPositionModal(
        targetMonster,
        (position) => {
          resolve(position);
        }
      );
    });

    // Sumonizar na posição escolhida
    targetMonster.position = chosenPosition || "attack";
    targetMonster.isFacedown = false;
    targetMonster.owner = player.id;
    targetMonster.hasAttacked = true; // Não pode atacar no mesmo turno
    player.field.push(targetMonster);

    // Vincular a trap ao monstro para que se destruam mutuamente
    targetMonster.callOfTheHauntedTrap = card;
    card.callOfTheHauntedTarget = targetMonster;

    game.renderer.log(
      `Call of the Haunted: ${
        targetMonster.name
      } foi revivido do cemitério em ${
        chosenPosition === "defense" ? "Defesa" : "Ataque"
      }!`
    );
    game.updateBoard();
    return true;
  }

  async applyMirrorForceDestroy(action, ctx) {
    const { game, player, eventData } = ctx;

    // Determinar quem é o oponente
    const opponent = player.id === "player" ? game.bot : game.player;

    if (!opponent || !opponent.field) {
      return false;
    }

    // Encontrar todos os monstros em Attack Position do oponente
    const attackPositionMonsters = opponent.field.filter(
      (card) =>
        card &&
        card.cardKind === "monster" &&
        card.position === "attack" &&
        !card.isFacedown
    );

    if (attackPositionMonsters.length === 0) {
      game.renderer.log(
        `Mirror Force: Nenhum monstro em Attack Position para destruir.`
      );
      return false;
    }

    game.renderer.log(
      `Mirror Force: Destruindo ${attackPositionMonsters.length} monstro(s) em Attack Position!`
    );

    // Destruir todos os monstros em Attack Position (com substituição de destruição)
    for (const monster of attackPositionMonsters) {
      const { replaced } =
        (await game.resolveDestructionWithReplacement(monster, {
          reason: "effect",
          sourceCard: ctx.card,
        })) || {};

      if (!replaced) {
        game.moveCard(monster, opponent, "graveyard", { fromZone: "field" });
      }
    }

    // Negar o ataque que disparou a Mirror Force
    if (ctx.eventData?.attacker) {
      game.registerAttackNegated(ctx.eventData.attacker);
    } else {
      game.lastAttackNegated = true;
    }

    game.updateBoard();
    return true;
  }

  async resolveTrapEffects(card, player, eventData = {}) {
    if (!card || !card.effects || card.effects.length === 0) {
      return { ok: false, reason: "No effects to resolve" };
    }

    // Encontrar efeito que responde ao evento atual
    const relevantEffect = card.effects.find((effect) => {
      if (effect.timing === "manual") return true;
      if (effect.timing === "on_activate") return true;
      if (effect.timing !== "on_event") return false;

      // Para traps ativadas manualmente, qualquer efeito on_event pode ser relevante
      return true;
    });

    if (!relevantEffect) {
      return { ok: false, reason: "No relevant effect found" };
    }

    const opponent = this.game.getOpponent(player);

    const ctx = {
      game: this.game,
      card,
      player,
      opponent,
      eventData,
      effect: relevantEffect,
      source: card,
    };

    try {
      // Executar as ações do efeito
      for (const action of relevantEffect.actions || []) {
        await this.applyActions([action], ctx, {});
      }

      return { ok: true };
    } catch (error) {
      console.error("Error resolving trap effects:", error);
      return { ok: false, reason: error.message };
    }
  }

  async applyVoidHollowSummonFromDeck(action, ctx) {
    if (!ctx.player || !this.game) {
      return false;
    }

    const deck = ctx.player.deck;
    if (!deck || deck.length === 0) {
      this.game.renderer.log("No cards in deck.");
      return false;
    }

    // Buscar monstros 'Void Hollow'
    const candidates = deck.filter(
      (card) => card && card.name === "Void Hollow"
    );

    if (candidates.length === 0) {
      this.game.renderer.log("No 'Void Hollow' in deck.");
      return false;
    }

    // Check field space
    if (ctx.player.field.length >= 5) {
      this.game.renderer.log("Field is full.");
      return false;
    }

    // Bot auto-seleciona o primeiro
    if (ctx.player.id === "bot") {
      const card = candidates[0];
      const cardIndex = deck.indexOf(card);
      if (cardIndex === -1) return false;

      const [summonedCard] = deck.splice(cardIndex, 1);
      summonedCard.position = "attack";
      summonedCard.isFacedown = false;
      summonedCard.hasAttacked = false;
      summonedCard.cannotAttackThisTurn = false;
      summonedCard.owner = ctx.player.id;
      ctx.player.field.push(summonedCard);

      this.game.renderer.log(
        `${ctx.player.name} Special Summoned ${summonedCard.name} from Deck.`
      );

      this.game.emit("after_summon", {
        card: summonedCard,
        player: ctx.player,
        method: "special",
      });

      this.game.updateBoard();
      return true;
    }

    // Player: modal visual
    const searchModal = this.getSearchModalElements();
    const defaultCardName = candidates[0]?.name || "";

    return new Promise((resolve) => {
      const finalizeSelection = async (selectedName) => {
        const chosen =
          candidates.find((c) => c && c.name === selectedName) || candidates[0];

        if (chosen && ctx.player.field.length < 5) {
          const cardIndex = deck.indexOf(chosen);
          if (cardIndex !== -1) {
            const [summonedCard] = deck.splice(cardIndex, 1);

            // Escolher posição
            const position = await this.chooseSpecialSummonPosition(
              summonedCard,
              ctx.player
            );

            summonedCard.position = position;
            summonedCard.isFacedown = false;
            summonedCard.hasAttacked = false;
            summonedCard.cannotAttackThisTurn = false;
            summonedCard.owner = ctx.player.id;
            ctx.player.field.push(summonedCard);

            this.game.renderer.log(
              `Special Summoned ${summonedCard.name} from Deck in ${
                position === "defense" ? "Defense" : "Attack"
              } Position.`
            );

            this.game.emit("after_summon", {
              card: summonedCard,
              player: ctx.player,
              method: "special",
            });

            this.game.updateBoard();
          }
        }

        this.game.isResolvingEffect = false;
        resolve(true);
      };

      if (searchModal) {
        this.game.isResolvingEffect = true;
        this.showSearchModalVisual(
          searchModal,
          candidates,
          defaultCardName,
          (choice) => finalizeSelection(choice)
        );
      } else {
        // Fallback: auto-seleciona o primeiro
        finalizeSelection(defaultCardName);
      }
    });
  }

  async applyVoidHaunterSpecialSummon(action, ctx, targets) {
    if (!ctx.player || !this.game) {
      return false;
    }

    const voidHollowCost = targets[action.targetRef];
    if (!voidHollowCost || voidHollowCost.length === 0) {
      this.game.renderer.log("No Void Hollow selected as cost.");
      return false;
    }

    const card = voidHollowCost[0];

    // Move Void Hollow from field to GY
    const fieldIndex = ctx.player.field.indexOf(card);
    if (fieldIndex !== -1) {
      ctx.player.field.splice(fieldIndex, 1);
      ctx.player.graveyard.push(card);
    }

    // Get Void Haunter from hand
    const haunter = ctx.source;
    if (!haunter || !ctx.player.hand.includes(haunter)) {
      this.game.renderer.log("Void Haunter not in hand.");
      return false;
    }

    if (ctx.player.field.length >= 5) {
      this.game.renderer.log("Field is full.");
      return false;
    }

    // Remove from hand
    const handIndex = ctx.player.hand.indexOf(haunter);
    if (handIndex !== -1) {
      ctx.player.hand.splice(handIndex, 1);
    }

    // Special Summon
    haunter.position = "attack";
    haunter.isFacedown = false;
    haunter.hasAttacked = false;
    haunter.cannotAttackThisTurn = false;
    haunter.owner = ctx.player.id;
    ctx.player.field.push(haunter);

    this.game.renderer.log(
      `${ctx.player.name} Special Summoned ${haunter.name} from hand.`
    );

    this.game.emit("after_summon", {
      card: haunter,
      player: ctx.player,
      method: "special",
    });

    this.game.updateBoard();
    return true;
  }

  async applyVoidHaunterGYEffect(action, ctx) {
    if (!ctx.player || !this.game) {
      return false;
    }

    const haunter = ctx.source;
    if (!haunter || !ctx.player.graveyard.includes(haunter)) {
      this.game.renderer.log("Void Haunter not in graveyard.");
      return false;
    }

    // Banish Void Haunter
    const gyIndex = ctx.player.graveyard.indexOf(haunter);
    if (gyIndex !== -1) {
      ctx.player.graveyard.splice(gyIndex, 1);
    }

    // Find up to 2 Void Hollow in GY
    const voidHollows = ctx.player.graveyard.filter(
      (card) => card && card.name === "Void Hollow"
    );

    if (voidHollows.length === 0) {
      this.game.renderer.log("No Void Hollow in graveyard.");
      this.game.updateBoard();
      return true;
    }

    if (ctx.player.id === "player") {
      const maxSelect = Math.min(
        3,
        voidHollows.length,
        5 - ctx.player.field.length
      );

      if (maxSelect === 0) {
        this.game.renderer.log("Field is full, cannot Special Summon.");
        return false;
      }

      return new Promise((resolve) => {
        this.game.renderer.showMultiSelectModal(
          voidHollows,
          { min: 0, max: maxSelect },
          async (selected) => {
            if (!selected || selected.length === 0) {
              this.game.renderer.log("No Void Hollow selected.");
              resolve(false);
              return;
            }

            for (const hollow of selected) {
              if (ctx.player.field.length >= 5) break;

              const idx = ctx.player.graveyard.indexOf(hollow);
              if (idx !== -1) {
                ctx.player.graveyard.splice(idx, 1);
              }

              const position = await this.chooseSpecialSummonPosition(
                hollow,
                ctx.player
              );

              hollow.position = position;
              hollow.isFacedown = false;
              hollow.hasAttacked = false;
              hollow.cannotAttackThisTurn = false;
              hollow.owner = ctx.player.id;
              ctx.player.field.push(hollow);

              this.game.emit("after_summon", {
                card: hollow,
                player: ctx.player,
                method: "special",
              });
            }

            this.game.renderer.log(
              `Special Summoned ${selected.length} Void Hollow from Graveyard.`
            );
            this.game.updateBoard();
            resolve(true);
          }
        );
      });
    }

    const toSummon = voidHollows.slice(
      0,
      Math.min(3, 5 - ctx.player.field.length)
    );
    let summoned = 0;

    for (const hollow of toSummon) {
      if (ctx.player.field.length >= 5) break;

      const idx = ctx.player.graveyard.indexOf(hollow);
      if (idx !== -1) {
        ctx.player.graveyard.splice(idx, 1);
      }

      hollow.position = "attack";
      hollow.isFacedown = false;
      hollow.hasAttacked = false;
      hollow.cannotAttackThisTurn = false;
      hollow.owner = ctx.player.id;
      ctx.player.field.push(hollow);

      this.game.emit("after_summon", {
        card: hollow,
        player: ctx.player,
        method: "special",
      });

      summoned++;
    }

    if (summoned > 0) {
      this.game.renderer.log(
        `${ctx.player.name} Special Summoned ${summoned} Void Hollow from Graveyard.`
      );
      this.game.updateBoard();
    }

    return summoned > 0;
  }

  async applyVoidForgottenKnightSpecialSummon(action, ctx, targets) {
    if (!ctx.player || !this.game) return false;

    const costTargets = targets[action.targetRef];
    if (!Array.isArray(costTargets) || costTargets.length === 0) {
      this.game.renderer.log("No Void monster selected as cost.");
      return false;
    }

    const costCard = costTargets[0];
    const fieldIndex = ctx.player.field.indexOf(costCard);
    if (fieldIndex !== -1) {
      ctx.player.field.splice(fieldIndex, 1);
      ctx.player.graveyard.push(costCard);
    }

    const knight = ctx.source;
    if (!knight || !ctx.player.hand.includes(knight)) {
      this.game.renderer.log("Void Forgotten Knight not in hand.");
      return false;
    }

    if (ctx.player.field.length >= 5) {
      this.game.renderer.log("Field is full.");
      return false;
    }

    const handIndex = ctx.player.hand.indexOf(knight);
    if (handIndex !== -1) {
      ctx.player.hand.splice(handIndex, 1);
    }

    knight.position = "attack";
    knight.isFacedown = false;
    knight.hasAttacked = false;
    knight.cannotAttackThisTurn = false;
    knight.owner = ctx.player.id;
    ctx.player.field.push(knight);

    this.game.renderer.log(
      `${ctx.player.name} Special Summoned ${knight.name} from hand.`
    );

    this.game.emit("after_summon", {
      card: knight,
      player: ctx.player,
      method: "special",
    });

    this.game.updateBoard();
    return true;
  }

  async applyVoidTenebrisHornGraveSummon(action, ctx, targets) {
    if (!ctx.player || !this.game) return false;

    const targetCards = targets[action.targetRef] || [];
    const horn = targetCards[0];
    if (!horn) return false;

    if (ctx.player.field.length >= 5) {
      this.game.renderer.log("Field está cheio.");
      return false;
    }

    this.game.moveCard(horn, ctx.player, "field", {
      fromZone: "graveyard",
      position: "attack",
      isFacedown: false,
      resetAttackFlags: true,
    });

    horn.position = "attack";
    horn.isFacedown = false;
    horn.hasAttacked = false;
    horn.cannotAttackThisTurn = false;
    horn.owner = ctx.player.id;

    this.game.renderer.log(
      `${ctx.player.name} Special Summoned ${horn.name} from the Graveyard.`
    );

    this.game.emit("after_summon", {
      card: horn,
      player: ctx.player,
      method: "special",
    });

    this.updateVoidTenebrisHornBuffs();
    this.game.updateBoard();
    return true;
  }

  applyBanish(action, ctx, targets) {
    const targetCards = targets[action.targetRef] || [];
    if (!targetCards || targetCards.length === 0) {
      return false;
    }

    let banished = 0;

    targetCards.forEach((card) => {
      // Remove from all zones
      const zones = [
        ctx.player.field,
        ctx.player.hand,
        ctx.player.deck,
        ctx.player.graveyard,
        ctx.player.spellTrap,
      ];

      for (const zone of zones) {
        if (zone) {
          const idx = zone.indexOf(card);
          if (idx > -1) {
            zone.splice(idx, 1);
            banished++;
            break;
          }
        }
      }
    });

    if (this.game && typeof this.game.updateBoard === "function") {
      this.game.updateBoard();
    }

    if (banished > 0 && this.game?.renderer?.log) {
      this.game.renderer.log(`${banished} card(s) banished.`);
    }

    this.updateVoidTenebrisHornBuffs();
    return banished > 0;
  }

  applyAllowDirectAttackThisTurn(action, ctx, targets) {
    const targetCards =
      targets[action.targetRef] || [ctx.source].filter(Boolean);
    if (!targetCards.length) return false;

    targetCards.forEach((card) => {
      card.canAttackDirectlyThisTurn = true;
    });

    return true;
  }
}
