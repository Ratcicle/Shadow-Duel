import Card from "./Card.js";

export default class EffectEngine {
  constructor(game) {
    this.game = game;
  }

  handleEvent(eventName, payload) {
    if (eventName === "after_summon") {
      this.handleAfterSummonEvent(payload);
    } else if (eventName === "battle_destroy") {
      this.handleBattleDestroyEvent(payload);
    } else if (eventName === "card_to_grave") {
      this.handleCardToGraveEvent(payload);
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


  handleBattleDestroyEvent(payload) {
    if (!payload || !payload.player || !payload.opponent) return;

    const { player, opponent, attacker, destroyed } = payload;
    const fieldCards = player.field ? [...player.field] : [];

    for (const card of fieldCards) {
      if (!card || !card.effects || !Array.isArray(card.effects)) continue;

      const ctx = {
        source: card,
        player,
        opponent,
        attacker,
        destroyed,
      };

      for (const effect of card.effects) {
        if (!effect || effect.timing !== "on_event") continue;
        if (effect.event !== "battle_destroy") continue;

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

        this.applyActions(effect.actions || [], ctx, targetResult.targets || {});
        this.game.checkWinCondition();
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
      activationZone: "hand",
    };

    const targetResult = this.resolveTargets(effect.targets || [], ctx, selections);
    if (targetResult.needsSelection) {
      return { success: false, needsSelection: true, options: targetResult.options };
    }

    if (!targetResult.ok) {
      return { success: false, reason: targetResult.reason };
    }

    this.applyActions(effect.actions || [], ctx, targetResult.targets);
    this.game.checkWinCondition();

    if (this.game && typeof this.game.moveCard === "function") {
      this.game.moveCard(card, player, "graveyard", { fromZone: "hand" });
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
        if (zoneName === "hand" && ctx.activationZone === "hand" && card === ctx.source) {
          continue;
        }
        if (def.cardKind && card.cardKind !== def.cardKind) continue;
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
        case "modify_stats_temp":
          this.applyModifyStatsTemp(action, targets);
          break;
        case "search_any":
          this.applySearchAny(action, ctx);
          break;
        case "transmutate":
          this.applyTransmutate(action, ctx, targets);
          break;
        case "move":
          this.applyMove(action, ctx, targets);
          break;
        case "revive_shadowheart_from_grave":
          this.applyReviveShadowHeartFromGrave(action, ctx);
          break;
        case "forbid_attack_this_turn":
          this.applyForbidAttackThisTurn(action, targets);
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

  applyModifyStatsTemp(action, targets) {
    const targetCards = targets[action.targetRef] || [];
    const atkFactor = action.atkFactor ?? 1;
    const defFactor = action.defFactor ?? 1;

    targetCards.forEach((card) => {
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
  }

  applyForbidAttackThisTurn(action, targets) {
    const targetCards = targets[action.targetRef] || [];
    targetCards.forEach((card) => {
      card.cannotAttackThisTurn = true;
    });
  }

  applySearchAny(action, ctx) {
    const deck = ctx.player.deck;
    if (!deck || deck.length === 0) {
      console.log("No cards in deck to search.");
      return;
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
        return;
      }
    }

    const defaultCard = candidates[candidates.length - 1].name;
    let choice = window.prompt(
      "Enter the card name to add to your hand:",
      defaultCard
    );

    let chosenFromCandidates = null;

    if (choice) {
      const lower = choice.toLowerCase();
      chosenFromCandidates =
        candidates.find((c) => c.name.toLowerCase() === lower) || null;
    }

    if (!chosenFromCandidates) {
      // fallback: último candidato da lista
      chosenFromCandidates = candidates[candidates.length - 1];
    }

    const cardIndex = deck.indexOf(chosenFromCandidates);
    if (cardIndex === -1) return;

    const [card] = deck.splice(cardIndex, 1);
    ctx.player.hand.push(card);
    console.log(`${ctx.player.id} added ${card.name} from Deck to hand.`);
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

  applyReviveShadowHeartFromGrave(action, ctx) {
    const player = action.player === "opponent" ? ctx.opponent : ctx.player;
    if (!player) return;

    const gy = player.graveyard || [];

    const candidates = gy.filter((card) => {
      if (!card || card.cardKind !== "monster") return false;
      if (card.archetype === "Shadow-Heart") return true;
      if (Array.isArray(card.archetypes)) {
        return card.archetypes.includes("Shadow-Heart");
      }
      return false;
    });

    if (candidates.length === 0) {
      console.log('No "Shadow-Heart" monsters in graveyard to revive.');
      return;
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
          (c) => c.name.trim().toLowerCase() === normalized
        );
        if (byName) {
          chosen = byName;
        }
      }
    }

    if (!chosen) {
      console.log("No valid choice made for revival.");
      return;
    }

    const idx = gy.indexOf(chosen);
    if (idx === -1) {
      console.warn("Chosen card is not in graveyard anymore:", chosen.name);
      return;
    }

    gy.splice(idx, 1);

    chosen.position = action.position || "attack";
    chosen.isFacedown = false;
    chosen.hasAttacked = false;
    chosen.cannotAttackThisTurn = true;

    player.field.push(chosen);

    console.log(
      `Revived "${chosen.name}" from graveyard with Shadow-Heart Infusion.`
    );

    if (this.game && typeof this.game.updateBoard === "function") {
      this.game.updateBoard();
    }
  }
}
