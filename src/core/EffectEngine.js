import Card from "./Card.js";

export default class EffectEngine {
  constructor(game) {
    this.game = game;
  }

  handleEvent(eventName, payload) {
    if (eventName === "after_summon") {
      this.handleAfterSummonEvent(payload);
    } else if (eventName === "after_battle_destroy") {
      this.handleAfterBattleDestroyEvent(payload);
    }
  }

  handleAfterSummonEvent(payload) {
    if (!payload || !payload.card || !payload.player) return;
    const { card, player, method } = payload;

    if (!card.effects || !Array.isArray(card.effects)) return;

    const ctx = {
      source: card,
      player,
      opponent: this.game.getOpponent(player),
    };

    for (const effect of card.effects) {
      if (!effect || effect.timing !== "on_event") continue;
      if (effect.event !== "after_summon") continue;

      if (effect.summonMethod) {
        const methods = Array.isArray(effect.summonMethod)
          ? effect.summonMethod
          : [effect.summonMethod];
        if (!methods.includes(method)) {
          continue;
        }
      }

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

      this.applyActions(effect.actions || [], ctx, targetResult.targets || {});
      this.game.checkWinCondition();
    }
  }

  resolveTriggeredSelection(effect, ctx, selections) {
    if (!effect) return;

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
    this.game.checkWinCondition();
  }

  activateFromHand(card, player, handIndex, selections = null) {
    const check = this.canActivate(card, player);
    if (!check.ok) {
      return { success: false, reason: check.reason };
    }

    const effect = (card.effects && card.effects[0]) || null;
    if (!effect) {
      return { success: false, reason: "No effect defined." };
    }

    const ctx = {
      source: card,
      player,
      opponent: this.game.getOpponent(player),
    };

    const targetResult = this.resolveTargets(effect.targets || [], ctx, selections);
    if (targetResult.needsSelection) {
      return { success: false, needsSelection: true, options: targetResult.options };
    }

    if (!targetResult.ok) {
      return { success: false, reason: targetResult.reason };
    }

    player.hand.splice(handIndex, 1);

    this.applyActions(effect.actions || [], ctx, targetResult.targets);
    this.game.checkWinCondition();

    if (this.game && typeof this.game.moveCard === "function") {
      this.game.moveCard(card, player, "graveyard");
    } else {
      player.graveyard.push(card);
    }

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

      const shouldAutoSelect = def.autoSelect || !!def.strategy;
      if (shouldAutoSelect) {
        targetMap[def.id] = candidates.slice(0, min);
        continue;
      }

      if (candidates.length === 1 && min === 1) {
        targetMap[def.id] = [candidates[0]];
        continue;
      }

      needsSelection = true;
      const decoratedCandidates = candidates.map((card, idx) => {
        const controller = card.owner;
        const ownerLabel = controller === ctx.player.id ? "player" : "opponent";
        const ownerPlayer =
          controller === "player" ? this.game.player : this.game.bot;
        const zoneArr = this.getZone(ownerPlayer, zoneName) || [];
        const zoneIndex = zoneArr.indexOf(card);
        return {
          idx,
          name: card.name,
          owner: ownerLabel,
          controller,
          zone: zoneName,
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
      const zone = this.getZone(owner, zoneName) || [];
      for (const card of zone) {
        if (def.cardKind && card.cardKind !== def.cardKind) continue;
        if (
          def.position &&
          def.position !== "any" &&
          card.position !== def.position
        ) {
          continue;
        }
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
      case "field":
      default:
        return player.field;
    }
  }

  applyActions(actions, ctx, targets) {
    actions.forEach((action) => {
      switch (action.type) {
        case "draw":
          this.applyDraw(action, ctx);
          break;
        case "heal":
          this.applyHeal(action, ctx);
          break;
        case "damage":
          this.applyDamage(action, ctx);
          break;
        case "destroy":
          this.applyDestroy(action, targets);
          break;
        case "special_summon_token":
          this.applySpecialSummonToken(action, ctx);
          break;
        case "buff_atk_temp":
          this.applyBuffAtkTemp(action, targets);
          break;
        case "search_any":
          this.applySearchAny(ctx);
          break;
        case "transmutate":
          this.applyTransmutate(action, ctx, targets);
          break;
        case "move":
          this.applyMove(action, ctx, targets);
          break;
        case "shadow_heart_ritual_summon":
          this.applyShadowHeartRitualSummon(action, ctx, targets);
          break;
        default:
          console.warn(`Unknown action type: ${action.type}`);
      }
    });
  }

  applyDraw(action, ctx) {
    const targetPlayer = action.player === "opponent" ? ctx.opponent : ctx.player;
    const amount = action.amount ?? 1;
    for (let i = 0; i < amount; i++) {
      targetPlayer.draw();
    }
  }

  applyHeal(action, ctx) {
    const targetPlayer = action.player === "opponent" ? ctx.opponent : ctx.player;
    const amount = action.amount ?? 0;
    targetPlayer.gainLP(amount);
  }

  applyDamage(action, ctx) {
    const targetPlayer = action.player === "self" ? ctx.player : ctx.opponent;
    const amount = action.amount ?? 0;
    targetPlayer.takeDamage(amount);
  }

  applyDestroy(action, targets) {
    const targetCards = targets[action.targetRef] || [];
    targetCards.forEach((card) => {
      const owner = card.owner === "player" ? this.game.player : this.game.bot;

      if (this.game && typeof this.game.moveCard === "function") {
        this.game.moveCard(card, owner, "graveyard");
        return;
      }

      const zones = [owner.field, owner.hand, owner.deck];
      for (const zone of zones) {
        const idx = zone.indexOf(card);
        if (idx > -1) {
          zone.splice(idx, 1);
          owner.graveyard.push(card);
          break;
        }
      }
    });
  }

  applySpecialSummonToken(action, ctx) {
    const targetPlayer = action.player === "opponent" ? ctx.opponent : ctx.player;
    if (!action.token) return;
    if (targetPlayer.field.length >= 5) {
      console.log("No space to special summon token.");
      return;
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

    tokenCard.position = action.position || "attack";
    tokenCard.isFacedown = false;
    tokenCard.hasAttacked = false;

    if (this.game && typeof this.game.moveCard === "function") {
      this.game.moveCard(tokenCard, targetPlayer, "field", {
        position: tokenCard.position,
        isFacedown: tokenCard.isFacedown,
        resetAttackFlags: true,
      });
    } else {
      targetPlayer.field.push(tokenCard);
    }
  }

  applyBuffAtkTemp(action, targets) {
    const targetCards = targets[action.targetRef] || [];
    const amount = action.amount ?? 0;
    targetCards.forEach((card) => {
      card.atk += amount;
      card.tempAtkBoost = (card.tempAtkBoost || 0) + amount;
    });
  }

  applySearchAny(ctx) {
    if (ctx.player.deck.length === 0) return;
    const defaultCard = ctx.player.deck[ctx.player.deck.length - 1].name;
    let choice = window.prompt("Enter the card name to add to your hand:", defaultCard);
    let cardIndex = -1;
    if (choice) {
      const lower = choice.toLowerCase();
      cardIndex = ctx.player.deck.findIndex((card) => card.name.toLowerCase() === lower);
    }
    if (cardIndex === -1) {
      cardIndex = ctx.player.deck.length - 1;
    }
    const [card] = ctx.player.deck.splice(cardIndex, 1);
    ctx.player.hand.push(card);
  }

  applyTransmutate(action, ctx, targets) {
    const costTargets = targets[action.targetRef] || [];
    const sacrifice = costTargets[0];
    if (!sacrifice) return;

    const owner = sacrifice.owner === "player" ? this.game.player : this.game.bot;
    if (owner !== ctx.player) {
      return;
    }

    if (this.game && typeof this.game.moveCard === "function") {
      this.game.moveCard(sacrifice, owner, "graveyard");
    } else {
      const field = owner.field;
      const idx = field.indexOf(sacrifice);
      if (idx === -1) {
        return;
      }
      field.splice(idx, 1);
      owner.graveyard.push(sacrifice);
    }

    const level = sacrifice.level || 0;

    this.game.updateBoard();

    setTimeout(() => {
      this.game.promptTransmutateRevive(owner, level);
    }, 350);
  }

  applyMove(action, ctx, targets) {
    const targetCards = targets[action.targetRef] || [];
    if (!targetCards || targetCards.length === 0) return;

    const toZone = action.to || action.toZone;
    if (!toZone) {
      console.warn("move action missing destination zone:", action);
      return;
    }

    targetCards.forEach((card) => {
      if (
        toZone === "field" &&
        card.summonRestrict === "shadow_heart_invocation_only" &&
        !action.allowShadowHeartInvocationBypass
      ) {
        console.log(
          `${card.name} can only be Special Summoned by "Shadow-Heart Invocation".`
        );
        return;
      }

      let destPlayer;
      if (action.player === "self") {
        destPlayer = ctx.player;
      } else if (action.player === "opponent") {
        destPlayer = ctx.opponent;
      } else {
        destPlayer = card.owner === "player" ? this.game.player : this.game.bot;
      }

      if (this.game && typeof this.game.moveCard === "function") {
        this.game.moveCard(card, destPlayer, toZone, {
          position: action.position,
          isFacedown: action.isFacedown,
          resetAttackFlags: action.resetAttackFlags,
        });
      } else {
        const fromOwner =
          card.owner === "player" ? this.game.player : this.game.bot;
        const zones = ["field", "hand", "deck", "graveyard"];
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

        if (action.position) {
          card.position = action.position;
        }
        if (typeof action.isFacedown === "boolean") {
          card.isFacedown = action.isFacedown;
        }
        if (action.resetAttackFlags) {
          card.hasAttacked = false;
        }

        card.owner = destPlayer.id;
        destArr.push(card);
      }
    });
  }
}
