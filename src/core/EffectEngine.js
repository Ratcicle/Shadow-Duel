import Card from "./Card.js";
import { cardDatabase } from "../data/cards.js";

export default class EffectEngine {
  constructor(game) {
    this.game = game;
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

    for (const sourceCard of sources) {
      if (!sourceCard.effects || !Array.isArray(sourceCard.effects)) continue;

      const sourceZone = this.findCardZone(player, sourceCard);

      const ctx = {
        source: sourceCard,
        player,
        opponent,
        summonedCard: card,
        summonMethod: method,
      };

      for (const effect of sourceCard.effects) {
        if (!effect || effect.timing !== "on_event") continue;
        if (effect.event !== "after_summon") continue;

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

        if (effect.summonMethod) {
          const methods = Array.isArray(effect.summonMethod)
            ? effect.summonMethod
            : [effect.summonMethod];
          if (!methods.includes(method)) {
            continue;
          }
        }

        if (effect.condition) {
          const conditionMet = this.checkEffectCondition(
            effect.condition,
            sourceCard,
            player,
            card
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
        this.game.checkWinCondition();
      }
    }
  }

  checkEffectCondition(condition, sourceCard, player, summonedCard) {
    if (!condition) return true;

    if (condition.requires === "self_in_hand") {
      if (!player.hand || !player.hand.includes(sourceCard)) {
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

  async handleTriggeredEffect(sourceCard, effect, ctx) {
    const optCheck = this.checkOncePerTurn(sourceCard, ctx.player, effect);
    if (!optCheck.ok) {
      console.log(optCheck.reason);
      return { success: false, reason: optCheck.reason };
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

  handleBattleDestroyEvent(payload) {
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

          const optCheck = this.checkOncePerTurn(card, owner, effect);
          if (!optCheck.ok) {
            console.log(optCheck.reason);
            continue;
          }

          if (effect.requireSelfAsAttacker && ctx.attacker !== card) continue;
          if (effect.requireSelfAsDestroyed && ctx.destroyed !== card) continue;
          if (effect.requireEquippedAsAttacker) {
            if (!card.equippedTo) continue;
            if (ctx.attacker !== card.equippedTo) continue;
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
          this.game.checkWinCondition();
        }
      }
    }
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
            if (
              this.game?.renderer?.showProtectorPrompt &&
              card.name === "Luminarch Sanctum Protector"
            ) {
              wantsToUse = await this.game.renderer.showProtectorPrompt();
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

    const ctx = {
      source: card,
      player,
      opponent,
      fromZone,
      toZone,
    };

    for (const effect of card.effects) {
      if (!effect || effect.timing !== "on_event") continue;
      if (effect.event !== "card_to_grave") continue;

      const optCheck = this.checkOncePerTurn(card, player, effect);
      if (!optCheck.ok) {
        console.log(optCheck.reason);
        continue;
      }

      if (effect.fromZone && effect.fromZone !== fromZone) continue;

      const targetResult = this.resolveTargets(effect.targets || [], ctx, null);

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

        const optCheck = this.checkOncePerTurn(card, owner, effect);
        if (!optCheck.ok) {
          console.log(optCheck.reason);
          continue;
        }

        this.applyActions(effect.actions || [], ctx, {});
        this.registerOncePerTurnUsage(card, owner, effect);
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

    const effect = (card.effects && card.effects[0]) || null;
    if (!effect) {
      return { success: false, reason: "No effect defined." };
    }

    const optCheck = this.checkOncePerTurn(card, player, effect);
    if (!optCheck.ok) {
      return { success: false, reason: optCheck.reason };
    }

    let resolvedActivationZone = activationZone || "hand";

    const ctx = {
      source: card,
      player,
      opponent: this.game.getOpponent(player),
      activationZone: resolvedActivationZone,
    };

    if (card.cardKind === "spell" && card.subtype === "field") {
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
    } else if (
      card.cardKind === "spell" &&
      card.subtype === "continuous" &&
      resolvedActivationZone === "hand"
    ) {
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
      if (card.subtype === "field") {
        return { success: true };
      }

      if (card.subtype === "continuous") {
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

  activateSpellTrapEffect(
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

    const effect = (card.effects || []).find(
      (e) => e && e.timing === "ignition"
    );
    if (!effect) {
      return { success: false, reason: "No ignition effect defined." };
    }

    const ctx = {
      source: card,
      player,
      opponent: this.game.getOpponent(player),
      activationZone,
    };

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
    this.game.checkWinCondition();
    return { success: true };
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

  resolveTargets(targetDefs, ctx, selections) {
    const targetMap = {};
    const options = [];
    let needsSelection = false;

    for (const def of targetDefs) {
      const { zoneName, candidates } = this.selectCandidates(def, ctx);
      const min = def.count?.min ?? 1;
      const max = def.count?.max ?? min;

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

      if (!isHuman) {
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

    const owners = [];
    if (def.owner === "opponent") {
      owners.push(ctx.opponent);
    } else if (def.owner === "any") {
      owners.push(ctx.player, ctx.opponent);
    } else {
      owners.push(ctx.player);
    }

    let candidates = [];
    for (const owner of owners) {
      for (const zoneKey of zoneList) {
        const zone = this.getZone(owner, zoneKey) || [];
        for (const card of zone) {
          if (
            zoneKey === "hand" &&
            ctx.activationZone === "hand" &&
            card === ctx.source
          ) {
            continue;
          }
          if (def.cardKind && card.cardKind !== def.cardKind) continue;
          if (def.requireFaceup && card.isFacedown) continue;
          if (
            def.position &&
            def.position !== "any" &&
            card.position !== def.position
          ) {
            continue;
          }
          const cardLevel = card.level || 0;
          if (def.level !== undefined && cardLevel !== def.level) continue;
          if (def.minLevel !== undefined && cardLevel < def.minLevel) continue;
          if (def.maxLevel !== undefined && cardLevel > def.maxLevel) continue;
          const cardAtk = card.atk || 0;
          if (def.minAtk !== undefined && cardAtk < def.minAtk) continue;
          if (def.maxAtk !== undefined && cardAtk > def.maxAtk) continue;
          if (def.archetype) {
            const cardArchetypes = card.archetypes
              ? card.archetypes
              : card.archetype
              ? [card.archetype]
              : [];
            if (!cardArchetypes.includes(def.archetype)) continue;
          }
          candidates.push(card);
        }
      }
    }

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
          case "luminarch_aegisbearer_def_boost":
            executed =
              this.applyLuminarchAegisbearerDefBoost(action, ctx) || executed;
            break;
          case "shadow_heart_rage_scale_buff":
            executed =
              this.applyShadowHeartRageScaleBuff(action, ctx) || executed;
            break;
          case "grant_second_attack_this_turn":
            executed =
              this.applyGrantSecondAttackThisTurn(action, ctx) || executed;
            break;
          case "luminarch_magic_sickle_recycle":
            executed =
              this.applyLuminarchMagicSickleRecycle(action, ctx) || executed;
            break;
          case "luminarch_holy_shield_apply":
            executed =
              this.applyLuminarchHolyShield(action, ctx, targets) || executed;
            break;
          case "shadow_heart_shield_upkeep":
            executed =
              this.applyShadowHeartShieldUpkeep(action, ctx) || executed;
            break;
          case "shadow_heart_ritual_summon":
            executed =
              this.applyShadowHeartRitualSummon(action, ctx, targets) ||
              executed;
            break;
          case "revive_shadowheart_from_grave":
            executed =
              this.applyReviveShadowHeartFromGrave(action, ctx) || executed;
            break;
          case "forbid_attack_this_turn":
            executed =
              this.applyForbidAttackThisTurn(action, targets) || executed;
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
          case "luminarch_radiant_lancer_atk_boost":
            executed =
              this.applyLuminarchRadiantLancerAtkBoost(action, ctx) || executed;
            break;
          case "luminarch_radiant_lancer_reset_atk":
            executed =
              this.applyLuminarchRadiantLancerResetAtk(action, ctx) || executed;
            break;
          case "luminarch_moonlit_blessing":
            executed =
              (await this.applyLuminarchMoonlitBlessing(
                action,
                ctx,
                targets
              )) || executed;
            break;
          case "luminarch_sacred_judgment_revive":
            executed =
              (await this.applyLuminarchSacredJudgmentRevive(action, ctx)) ||
              executed;
            break;
          case "luminarch_aurora_seraph_heal":
            executed = this.applyAuroraSeraphHeal(action, ctx) || executed;
            break;
          case "luminarch_citadel_atkdef_buff":
            executed =
              this.applyLuminarchCitadelAtkDefBuff(action, ctx, targets) ||
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
          default:
            console.warn(`Unknown action type: ${action.type}`);
        }
      }
    } catch (err) {
      console.error("Error while applying actions:", err);
    }

    return executed;
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
    return amount !== 0;
  }

  async applyDestroy(action, targets, ctx) {
    const targetCards = targets[action.targetRef] || [];
    let destroyedAny = false;

    for (const card of targetCards) {
      const owner = card.owner === "player" ? this.game.player : this.game.bot;
      if (!owner) continue;

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
        this.game.moveCard(card, owner, "graveyard");
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

  applyAuroraSeraphHeal(action, ctx) {
    const destroyed = ctx?.destroyed;
    const player = ctx?.player;
    if (!destroyed || !player) return false;

    const amount = Math.floor((destroyed.atk || 0) / 2);
    if (amount <= 0) return false;

    player.gainLP(amount);
    this.game?.renderer?.log(
      `${player.name} gains ${amount} LP from ${
        ctx.source?.name || "Aurora Seraph"
      }.`
    );

    return true;
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

  applyForbidAttackThisTurn(action, targets) {
    const targetCards = targets[action.targetRef] || [];
    targetCards.forEach((card) => {
      card.cannotAttackThisTurn = true;
    });
    return targetCards.length > 0;
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
      candidates = candidates.filter(
        (card) => card.cardKind === action.cardKind
      );

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
      this.showSearchModal(
        searchModal,
        candidates,
        defaultCard,
        (choice) => {
          this.finishSearchSelection(choice, candidates, ctx);
        },
        cardDatabase
      );
      return true;
    }

    const choice = window.prompt(
      "Enter the card name to add to your hand:",
      defaultCard
    );

    this.finishSearchSelection(choice, candidates, ctx);
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

    const dropdownOptions =
      Array.isArray(allCards) && allCards.length > 0 ? allCards : candidates;

    const sortedCandidates = [...dropdownOptions].sort((a, b) => {
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

  applyShadowHeartRitualSummon(action, ctx, targets) {
    console.warn(
      "applyShadowHeartRitualSummon is not implemented; skipping action.",
      action,
      targets
    );
    return false;
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

  applyLuminarchAegisbearerDefBoost(action, ctx) {
    const amount = action.amount ?? 0;
    const card = ctx?.source;
    if (!card || card.cardKind !== "monster" || amount <= 0) return false;

    const owner = card.owner === "player" ? this.game?.player : this.game?.bot;
    if (!owner || !owner.field.includes(card)) return false;

    card.def += amount;
    return true;
  }

  applyLuminarchCitadelAtkDefBuff(action, ctx, targets) {
    const amount = action.amount ?? 500;
    const targetCards = targets[action.targetRef] || [];
    if (!amount || targetCards.length === 0) return false;

    let applied = false;
    targetCards.forEach((card) => {
      if (!card || card.cardKind !== "monster" || card.isFacedown) return;
      const owner = this.getOwnerByCard(card);
      if (!owner || !owner.field || !owner.field.includes(card)) return;

      card.atk += amount;
      card.def += amount;
      card.tempAtkBoost = (card.tempAtkBoost || 0) + amount;
      card.tempDefBoost = (card.tempDefBoost || 0) + amount;
      applied = true;
    });

    return applied;
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

  applyGrantSecondAttackThisTurn(action, ctx) {
    const card = ctx?.source;
    if (!card || card.cardKind !== "monster") return false;

    const owner = this.getOwnerByCard(card);
    if (!owner || !owner.field.includes(card) || card.isFacedown) return false;

    card.canMakeSecondAttackThisTurn = true;
    card.secondAttackUsedThisTurn = false;
    return true;
  }

  applyLuminarchMagicSickleRecycle(action, ctx) {
    const card = ctx?.source;
    const player = ctx?.player;
    const game = this.game;

    if (
      !card ||
      !player ||
      !game ||
      game.turn !== player.id ||
      (game.phase !== "main1" && game.phase !== "main2") ||
      card.cardKind !== "monster" ||
      !(player.field || []).includes(card)
    ) {
      return false;
    }

    this.game.moveCard(card, player, "graveyard", { fromZone: "field" });

    const gy = player.graveyard || [];
    const luminarchMonsters = gy.filter((c) => {
      if (!c || c.cardKind !== "monster") return false;
      if (c === card) return false; // do not let Sickle retrieve itself
      const archetypes = Array.isArray(c.archetypes)
        ? c.archetypes
        : c.archetype
        ? [c.archetype]
        : [];
      return archetypes.includes("Luminarch");
    });

    const finishReturn = (chosenCards) => {
      chosenCards.forEach((c) => {
        const idx = player.graveyard.indexOf(c);
        if (idx > -1) {
          player.graveyard.splice(idx, 1);
        }
        player.hand.push(c);
      });

      if (typeof this.game.updateBoard === "function") {
        this.game.updateBoard();
      }
    };

    if (
      typeof document === "undefined" ||
      !document ||
      !document.body ||
      luminarchMonsters.length === 0
    ) {
      if (luminarchMonsters.length === 0) {
        console.log("No Luminarch monsters in GY to add.");
        return true;
      }

      const maxToReturn = Math.min(2, luminarchMonsters.length);
      const chosen = [...luminarchMonsters]
        .sort((a, b) => (b.atk || 0) - (a.atk || 0))
        .slice(0, maxToReturn);
      finishReturn(chosen);
      return true;
    }

    this.showSickleSelectionModal(
      luminarchMonsters,
      2,
      (selected) => {
        finishReturn(selected);
      },
      () => {
        finishReturn([]);
      }
    );

    return true;
  }

  showSickleSelectionModal(candidates, maxSelect, onConfirm, onCancel) {
    const overlay = document.createElement("div");
    overlay.classList.add("modal", "sickle-overlay");

    const modal = document.createElement("div");
    modal.classList.add("modal-content", "sickle-modal");

    const title = document.createElement("h3");
    title.textContent = 'Select up to 2 "Luminarch" monsters to add to hand';
    title.classList.add("modal-title");
    modal.appendChild(title);

    const list = document.createElement("div");
    list.classList.add("sickle-list");
    candidates.forEach((c, idx) => {
      const row = document.createElement("label");
      row.classList.add("sickle-row");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.index = String(idx);
      const name = document.createElement("span");
      const stats = `ATK ${c.atk || 0} / DEF ${c.def || 0} / L${c.level || 0}`;
      name.textContent = `${c.name} (${stats})`;
      row.appendChild(cb);
      row.appendChild(name);
      list.appendChild(row);
    });
    modal.appendChild(list);

    const info = document.createElement("div");
    info.classList.add("modal-hint");
    info.textContent = `Select up to ${maxSelect}.`;
    modal.appendChild(info);

    const actions = document.createElement("div");
    actions.classList.add("modal-actions");

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.classList.add("secondary");
    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "Add to Hand";

    const cleanup = () => {
      overlay.remove();
    };

    confirmBtn.onclick = () => {
      const selectedIdx = Array.from(
        modal.querySelectorAll("input[type=checkbox]:checked")
      )
        .slice(0, maxSelect)
        .map((el) => parseInt(el.dataset.index, 10))
        .filter((n) => !Number.isNaN(n));
      const chosen = selectedIdx.map((i) => candidates[i]).filter(Boolean);
      cleanup();
      onConfirm(chosen);
    };

    cancelBtn.onclick = () => {
      cleanup();
      onCancel();
    };

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    modal.appendChild(actions);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  applyLuminarchHolyShield(action, ctx, targets) {
    const targetCards = targets[action.targetRef] || [];
    if (!Array.isArray(targetCards) || targetCards.length === 0) return false;

    let applied = false;
    targetCards.forEach((card) => {
      if (!card) return;
      card.tempBattleIndestructible = true;
      card.battleDamageHealsControllerThisTurn = true;
      applied = true;
    });

    return applied;
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

  applyReviveShadowHeartFromGrave(action, ctx) {
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

    let chosen = candidates[0];

    if (candidates.length > 1 && typeof window !== "undefined") {
      const uniqueNames = [...new Set(candidates.map((c) => c.name))];
      const choice = window.prompt(
        `Choose 1 "Shadow-Heart" monster to revive:\n` + uniqueNames.join("\n")
      );
      if (choice) {
        const normalized = choice.trim().toLowerCase();
        const byName = candidates.find(
          (c) =>
            c &&
            c.name &&
            typeof c.name === "string" &&
            c.name.trim().toLowerCase() === normalized
        );
        if (byName) {
          chosen = byName;
        }
      }
    }

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

    chosen.position = action.position || "attack";
    chosen.isFacedown = false;
    chosen.hasAttacked = false;
    chosen.attacksUsedThisTurn = 0;
    chosen.cannotAttackThisTurn = true;

    player.field.push(chosen);

    console.log(
      `Revived "${chosen.name}" from graveyard with Shadow-Heart Infusion.`
    );

    if (this.game && typeof this.game.updateBoard === "function") {
      this.game.updateBoard();
    }
    return true;
  }

  applyLuminarchRadiantLancerAtkBoost(action, ctx) {
    const card = ctx?.source;
    const player = ctx?.player;
    if (!card || !player || card.cardKind !== "monster") return false;
    if (!player.field || !player.field.includes(card)) return false;
    const amount = action.amount ?? 0;
    if (amount <= 0) return false;
    const sourceName = card.name;
    const current = card.permanentBuffsBySource?.[sourceName] ?? 0;
    const nextTotal = current + amount;
    return this.addNamedPermanentAtkBuff(card, sourceName, nextTotal);
  }

  applyLuminarchRadiantLancerResetAtk(action, ctx) {
    const card = ctx?.source;
    if (!card) return false;
    return this.removeNamedPermanentAtkBuff(card, card.name);
  }

  async applyLuminarchMoonlitBlessing(action, ctx, targets) {
    const targetCards = targets[action.targetRef] || [];
    if (targetCards.length === 0) return false;

    const card = targetCards[0];
    const player = ctx?.player;
    if (!player || !card) return false;

    // Move card from GY to hand
    const gy = player.graveyard || [];
    const idx = gy.indexOf(card);
    if (idx === -1) {
      console.warn("Target card not found in graveyard:", card.name);
      return false;
    }

    gy.splice(idx, 1);
    player.hand = player.hand || [];
    player.hand.push(card);

    console.log(`Added ${card.name} from Graveyard to hand.`);

    // Check if player controls Sanctum of the Luminarch Citadel
    const hasCitadel =
      player.fieldSpell &&
      player.fieldSpell.name === "Sanctum of the Luminarch Citadel";

    if (!hasCitadel) {
      if (this.game && typeof this.game.updateBoard === "function") {
        this.game.updateBoard();
      }
      return true;
    }

    // Offer Special Summon for human player
    if (player === this.game?.player) {
      const wantsToSummon = window.confirm(
        `Você controla "Sanctum of the Luminarch Citadel". Deseja invocar por invocação especial "${card.name}" da sua mão?`
      );

      if (!wantsToSummon) {
        if (this.game && typeof this.game.updateBoard === "function") {
          this.game.updateBoard();
        }
        return true;
      }

      // Check field space
      if (player.field.length >= 5) {
        console.log("No space to Special Summon.");
        if (this.game && typeof this.game.updateBoard === "function") {
          this.game.updateBoard();
        }
        return true;
      }

      // Remove from hand
      const handIdx = player.hand.indexOf(card);
      if (handIdx === -1) {
        console.warn("Card disappeared from hand:", card.name);
        if (this.game && typeof this.game.updateBoard === "function") {
          this.game.updateBoard();
        }
        return true;
      }

      // Get position choice and summon
      const finishSummon = (position) => {
        const pos = position || "attack";
        card.position = pos;
        card.isFacedown = false;
        card.hasAttacked = false;
        card.cannotAttackThisTurn = false;

        if (this.game && typeof this.game.moveCard === "function") {
          this.game.moveCard(card, player, "field", {
            fromZone: "hand",
            position: pos,
            isFacedown: false,
            resetAttackFlags: true,
          });
        } else {
          player.hand.splice(handIdx, 1);
          player.field.push(card);
        }

        console.log(
          `Special Summoned ${card.name} in ${pos} position via Moonlit Blessing.`
        );

        if (this.game && typeof this.game.updateBoard === "function") {
          this.game.updateBoard();
        }
      };

      if (
        this.game &&
        typeof this.game.chooseSpecialSummonPosition === "function"
      ) {
        const positionChoice = this.game.chooseSpecialSummonPosition(
          player,
          card
        );
        if (positionChoice && typeof positionChoice.then === "function") {
          await positionChoice.then((pos) => finishSummon(pos));
        } else {
          finishSummon(positionChoice);
        }
      } else {
        finishSummon("attack");
      }

      return true;
    }

    // Bot always summons if possible
    if (player.field.length >= 5) {
      if (this.game && typeof this.game.updateBoard === "function") {
        this.game.updateBoard();
      }
      return true;
    }

    const handIdx = player.hand.indexOf(card);
    if (handIdx === -1) {
      if (this.game && typeof this.game.updateBoard === "function") {
        this.game.updateBoard();
      }
      return true;
    }

    player.hand.splice(handIdx, 1);
    card.position = "attack";
    card.isFacedown = false;
    card.hasAttacked = false;
    card.cannotAttackThisTurn = false;
    player.field.push(card);

    console.log(
      `Bot Special Summoned ${card.name} in attack position via Moonlit Blessing.`
    );

    if (this.game && typeof this.game.updateBoard === "function") {
      this.game.updateBoard();
    }

    return true;
  }

  async applyLuminarchSacredJudgmentRevive(action, ctx) {
    const player = ctx?.player;
    const opponent = ctx?.opponent;
    if (!player || !opponent) return false;

    // Check activation conditions
    if (player.field.length !== 0) {
      console.log("Sacred Judgment: You must control no monsters.");
      return false;
    }

    if (opponent.field.length < 2) {
      console.log("Sacred Judgment: Opponent must control 2+ monsters.");
      return false;
    }

    // Check LP cost
    if (player.lp < 2000) {
      console.log("Sacred Judgment: Not enough LP to pay cost (2000 LP).");
      return false;
    }

    // Filter Luminarch monsters in GY
    const gy = player.graveyard || [];
    const candidates = gy.filter(
      (card) =>
        card && card.cardKind === "monster" && card.archetype === "Luminarch"
    );

    if (candidates.length === 0) {
      console.log("Sacred Judgment: No Luminarch monsters in Graveyard.");
      return false;
    }

    const maxRevive = Math.min(opponent.field.length, candidates.length, 5);

    // Pay LP cost upfront
    player.takeDamage(2000);
    console.log(`${player.name} paid 2000 LP to activate Sacred Judgment.`);

    if (this.game && typeof this.game.updateBoard === "function") {
      this.game.updateBoard();
    }

    // Bot auto-selects highest ATK monsters
    if (player.id === "bot") {
      const sorted = [...candidates].sort(
        (a, b) => (b.atk || 0) - (a.atk || 0)
      );
      const toSummon = sorted.slice(0, maxRevive);

      let summoned = 0;
      for (const card of toSummon) {
        if (player.field.length >= 5) break;

        const idx = gy.indexOf(card);
        if (idx === -1) continue;

        gy.splice(idx, 1);
        card.position = "attack";
        card.isFacedown = false;
        card.hasAttacked = false;
        card.cannotAttackThisTurn = false;
        card.attacksUsedThisTurn = 0;
        player.field.push(card);
        summoned++;
      }

      const lpGain = summoned * 500;
      if (lpGain > 0) {
        player.gainLP(lpGain);
        console.log(
          `Bot Special Summoned ${summoned} monsters and gained ${lpGain} LP.`
        );
      }

      if (this.game && typeof this.game.updateBoard === "function") {
        this.game.updateBoard();
      }

      return true;
    }

    // Human player: show multi-select modal
    return new Promise((resolve) => {
      this.showSacredJudgmentSelectionModal(
        candidates,
        maxRevive,
        async (selectedCards) => {
          if (selectedCards.length === 0) {
            console.log("Sacred Judgment: No monsters selected.");
            if (this.game && typeof this.game.updateBoard === "function") {
              this.game.updateBoard();
            }
            resolve(true);
            return;
          }

          let summoned = 0;

          // Summon each card individually with position choice
          for (const card of selectedCards) {
            if (player.field.length >= 5) {
              console.log("Field is full, cannot summon more monsters.");
              break;
            }

            const idx = gy.indexOf(card);
            if (idx === -1) continue;

            // Remove from GY
            gy.splice(idx, 1);

            // Prompt for position
            const positionChoice = await this.game.chooseSpecialSummonPosition(
              player,
              card
            );
            const position = positionChoice || "attack";

            card.position = position;
            card.isFacedown = false;
            card.hasAttacked = false;
            card.cannotAttackThisTurn = false;
            card.attacksUsedThisTurn = 0;
            player.field.push(card);
            summoned++;

            console.log(
              `Special Summoned ${card.name} in ${position} position.`
            );

            if (this.game && typeof this.game.updateBoard === "function") {
              this.game.updateBoard();
            }
          }

          // Gain LP based on summoned count
          const lpGain = summoned * 500;
          if (lpGain > 0) {
            player.gainLP(lpGain);
            console.log(
              `Gained ${lpGain} LP from Sacred Judgment (${summoned} monsters).`
            );
          }

          if (this.game && typeof this.game.updateBoard === "function") {
            this.game.updateBoard();
          }

          resolve(true);
        }
      );
    });
  }

  showSacredJudgmentSelectionModal(candidates, maxSelect, onConfirm) {
    const overlay = document.createElement("div");
    overlay.classList.add("sacred-judgment-overlay");

    const backdrop = document.createElement("div");
    backdrop.classList.add("sacred-judgment-backdrop");
    overlay.appendChild(backdrop);

    const modal = document.createElement("div");
    modal.classList.add("sacred-judgment-modal");

    const title = document.createElement("h3");
    title.textContent = "Luminarch Sacred Judgment";
    modal.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.textContent = `Select up to ${maxSelect} "Luminarch" monsters to Special Summon from your Graveyard.`;
    modal.appendChild(subtitle);

    // Card grid with visual preview
    const grid = document.createElement("div");
    grid.classList.add("sacred-judgment-grid");

    const selectedIndices = new Set();

    candidates.forEach((card, idx) => {
      const cardEl = document.createElement("div");
      cardEl.classList.add("sacred-judgment-card");
      cardEl.dataset.index = String(idx);

      const imageDiv = document.createElement("div");
      imageDiv.classList.add("sacred-judgment-card-image");
      imageDiv.style.backgroundImage = `url('${card.image}')`;
      cardEl.appendChild(imageDiv);

      const infoDiv = document.createElement("div");
      infoDiv.classList.add("sacred-judgment-card-info");

      const nameDiv = document.createElement("div");
      nameDiv.classList.add("sacred-judgment-card-name");
      nameDiv.textContent = card.name;
      infoDiv.appendChild(nameDiv);

      const statsDiv = document.createElement("div");
      statsDiv.classList.add("sacred-judgment-card-stats");
      statsDiv.innerHTML = `<span>ATK ${card.atk || 0}</span><span>DEF ${
        card.def || 0
      }</span>`;
      infoDiv.appendChild(statsDiv);

      cardEl.appendChild(infoDiv);

      // Checkbox (visual)
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.classList.add("sacred-judgment-card-checkbox");
      checkbox.dataset.index = String(idx);
      cardEl.appendChild(checkbox);

      // Click handler
      cardEl.addEventListener("click", (e) => {
        if (e.target === checkbox) return; // Let checkbox handle itself
        e.preventDefault();

        if (selectedIndices.has(idx)) {
          selectedIndices.delete(idx);
          cardEl.classList.remove("selected");
          checkbox.checked = false;
        } else if (selectedIndices.size < maxSelect) {
          selectedIndices.add(idx);
          cardEl.classList.add("selected");
          checkbox.checked = true;
        }
      });

      // Checkbox change handler
      checkbox.addEventListener("change", (e) => {
        if (e.target.checked) {
          if (selectedIndices.size < maxSelect) {
            selectedIndices.add(idx);
            cardEl.classList.add("selected");
          } else {
            e.target.checked = false;
          }
        } else {
          selectedIndices.delete(idx);
          cardEl.classList.remove("selected");
        }
      });

      grid.appendChild(cardEl);
    });

    modal.appendChild(grid);

    const info = document.createElement("div");
    info.textContent = `You will choose Attack/Defense position for each monster individually. Gain 500 LP per summon.`;
    modal.appendChild(info);

    const actions = document.createElement("div");
    actions.classList.add("sacred-judgment-actions");

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.classList.add("secondary");
    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "Summon";
    confirmBtn.classList.add("primary");

    const cleanup = () => {
      overlay.remove();
    };

    confirmBtn.onclick = () => {
      const chosen = Array.from(selectedIndices)
        .map((i) => candidates[i])
        .filter(Boolean);
      cleanup();
      onConfirm(chosen);
    };

    cancelBtn.onclick = () => {
      cleanup();
      onConfirm([]);
    };

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    modal.appendChild(actions);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  async applyConditionalSpecialSummonFromHand(action, ctx) {
    const player = ctx?.player;
    if (!player) return false;

    if (!player.hand || player.hand.length === 0) return false;

    const candidates = player.hand.filter((c) => c && c.cardKind === "monster");
    if (candidates.length === 0) return false;

    let targetCard = candidates[0];
    if (candidates.length > 1) {
      const cardNames = [...new Set(candidates.map((c) => c.name))];
      const choice = window.prompt(
        `Choose a monster to special summon:\n${cardNames.join("\n")}`
      );
      if (choice) {
        const normalized = choice.trim().toLowerCase();
        const byName = candidates.find(
          (c) => c && c.name && c.name.trim().toLowerCase() === normalized
        );
        if (byName) targetCard = byName;
      }
    }

    const position = action.position || "attack";
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

  applyShadowHeartAbyssalEelDamage(action, ctx) {
    if (action.type === "damage" && action.player === "opponent") {
      const opponent = ctx.opponent;
      opponent.takeDamage(action.amount);
      console.log(`${opponent.name} took ${action.amount} damage.`);

      if (this.game && typeof this.game.updateBoard === "function") {
        this.game.updateBoard();
      }

      return true;
    }
    return false;
  }
}
