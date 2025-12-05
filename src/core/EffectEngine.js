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

    if (!player.oncePerTurnUsageByName) {
      player.oncePerTurnUsageByName = {};
    }

    const key = effect?.oncePerTurnName || effect?.id || card.name;
    const currentTurn = this.game?.turnCounter ?? 0;
    const lastTurn = player.oncePerTurnUsageByName[key];

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

    if (!player.oncePerTurnUsageByName) {
      player.oncePerTurnUsageByName = {};
    }

    const key = effect?.oncePerTurnName || effect?.id || card.name;
    const currentTurn = this.game?.turnCounter ?? 0;
    player.oncePerTurnUsageByName[key] = currentTurn;
  }

  handleEvent(eventName, payload) {
    if (eventName === "after_summon") {
      this.handleAfterSummonEvent(payload);
    } else if (eventName === "battle_destroy") {
      this.handleBattleDestroyEvent(payload);
    } else if (eventName === "card_to_grave") {
      this.handleCardToGraveEvent(payload);
    } else if (eventName === "standby_phase") {
      this.handleStandbyPhaseEvent(payload);
    }
  }

  handleAfterSummonEvent(payload) {
    if (!payload || !payload.card || !payload.player) return;
    const { card, player, method } = payload;

    const sources = [card];
    if (player.fieldSpell) {
      sources.push(player.fieldSpell);
    }

    const opponent = this.game.getOpponent(player);

    for (const sourceCard of sources) {
      if (!sourceCard.effects || !Array.isArray(sourceCard.effects)) continue;

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

        const targetResult = this.resolveTargets(effect.targets || [], ctx, null);

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

        this.applyActions(effect.actions || [], ctx, targetResult.targets || {});
        this.registerOncePerTurnUsage(sourceCard, player, effect);
        this.game.checkWinCondition();
      }
    }
  }

  handleBattleDestroyEvent(payload) {
    if (!payload || !payload.attacker || !payload.destroyed) return;

    const { player, opponent, attacker, destroyed, attackerOwner, destroyedOwner } =
      payload;

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

  activateFromHand(card, player, handIndex, selections = null) {
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

    const ctx = {
      source: card,
      player,
      opponent: this.game.getOpponent(player),
      activationZone: "hand",
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

      ctx.activationZone = "fieldSpell";
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

    if (card.cardKind === "spell" && card.subtype === "field") {
      return { success: true };
    }

    // Equip Spells serão movidas para a zona de spell/trap na própria action.
    if (card.cardKind === "spell" && card.subtype === "equip") {
      return { success: true };
    }

    if (this.game && typeof this.game.moveCard === "function") {
      this.game.moveCard(card, player, "graveyard", { fromZone: "hand" });
    } else {
      player.graveyard.push(card);
    }

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

    if (card.name === "Shadow-Heart Invocation" || card.id === 39) {
      const hand = player.hand || [];
      const gy = player.graveyard || [];

      const hasDragonInHand = hand.some(
        (c) => c && c.name === "Shadow-Heart Scale Dragon"
      );
      const hasDragonInGY = gy.some(
        (c) => c && c.name === "Shadow-Heart Scale Dragon"
      );

      if (!hasDragonInHand && !hasDragonInGY) {
        return {
          ok: false,
          reason:
            '"Shadow-Heart Scale Dragon" must be in your hand or Graveyard to activate this card.',
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
        if (
          zoneName === "hand" &&
          ctx.activationZone === "hand" &&
          card === ctx.source
        ) {
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
      case "spellTrap":
        return player.spellTrap;
      case "fieldSpell":
        return player.fieldSpell ? [player.fieldSpell] : [];
      case "field":
      default:
        return player.field;
    }
  }

  getOwnerByCard(card) {
    if (!card || !this.game) return null;
    return card.owner === "player" ? this.game.player : this.game.bot;
  }

  canUseOncePerTurn(effect, ctx) {
    if (!effect || !effect.oncePerTurn) return true;
    const player = ctx?.player;
    if (!player) return true;
    const key = effect.oncePerTurnName || effect.id || ctx?.source?.name;
    if (!key) return true;
    const usage = player.oncePerTurnUsageByName || {};
    const currentTurn = this.game?.turnCounter || 0;
    return usage[key] !== currentTurn;
  }

  markOncePerTurn(effect, ctx) {
    if (!effect || !effect.oncePerTurn) return;
    const player = ctx?.player;
    if (!player) return;
    const key = effect.oncePerTurnName || effect.id || ctx?.source?.name;
    if (!key) return;
    const currentTurn = this.game?.turnCounter || 0;
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

  applyActions(actions, ctx, targets) {
    let executed = false;
    actions.forEach((action) => {
      switch (action.type) {
        case "draw":
          executed = this.applyDraw(action, ctx) || executed;
          break;
        case "heal":
          executed = this.applyHeal(action, ctx) || executed;
          break;
        case "damage":
          executed = this.applyDamage(action, ctx) || executed;
          break;
        case "destroy":
          executed = this.applyDestroy(action, targets) || executed;
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
        case "shadow_heart_shield_upkeep":
          executed =
            this.applyShadowHeartShieldUpkeep(action, ctx) || executed;
          break;
        case "shadow_heart_ritual_summon":
          executed =
            this.applyShadowHeartRitualSummon(action, ctx, targets) || executed;
          break;
        case "revive_shadowheart_from_grave":
          executed = this.applyReviveShadowHeartFromGrave(action, ctx) || executed;
          break;
        case "forbid_attack_this_turn":
          executed = this.applyForbidAttackThisTurn(action, targets) || executed;
          break;
        case "darkness_valley_apply_existing":
          executed = this.applyDarknessValleyInitialBuff(action, ctx) || executed;
          break;
        case "darkness_valley_buff_summon":
          executed = this.applyDarknessValleySummonBuff(action, ctx) || executed;
          break;
        case "darkness_valley_cleanup":
          executed = this.applyDarknessValleyCleanup(action, ctx) || executed;
          break;
        case "darkness_valley_battle_punish":
          executed = this.applyDarknessValleyBattlePunish(action, ctx) || executed;
          break;
        case "shadow_heart_death_wyrm_special_summon":
          executed =
            this.applyShadowHeartDeathWyrmSpecialSummon(action, ctx) || executed;
          break;
        default:
          console.warn(`Unknown action type: ${action.type}`);
      }
    });
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

  applyDamage(action, ctx) {
    const targetPlayer = action.player === "self" ? ctx.player : ctx.opponent;
    const amount = action.amount ?? 0;
    targetPlayer.takeDamage(amount);
    return amount !== 0;
  }

  applyDestroy(action, targets) {
    const targetCards = targets[action.targetRef] || [];
    targetCards.forEach((card) => {
      const owner = card.owner === "player" ? this.game.player : this.game.bot;

      if (this.game && typeof this.game.moveCard === "function") {
        this.game.moveCard(card, owner, "graveyard");
        return;
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
          break;
        }
      }
    });
    return targetCards.length > 0;
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
    return true;
  }

  applyBuffAtkTemp(action, targets) {
    const targetCards = targets[action.targetRef] || [];
    const amount = action.amount ?? 0;
    targetCards.forEach((card) => {
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

    this.game.moveCard(attacker, attackerOwner, "graveyard", { fromZone: "field" });
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

    if (!target || target.cardKind !== "monster") return false;
    if (target.isFacedown) {
      console.warn("Cannot equip to a facedown monster:", target.name);
      return false;
    }

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
    }

    const maxAttacksAfterEquip = 1 + (target.extraAttacks || 0);
    target.hasAttacked =
      (target.attacksUsedThisTurn || 0) >= maxAttacksAfterEquip;
    return true;
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

      if (this.game && typeof this.game.moveCard === "function") {
        this.game.moveCard(card, destPlayer, toZone, {
          position: action.position,
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

        if (action.position) {
          card.position = action.position;
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
    });
    return moved;
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
    if (destroyedOwner !== owner && destroyedOwner?.id !== owner.id) return false;

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
}
