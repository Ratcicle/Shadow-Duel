import Card from "./Card.js";
import { cardDatabase } from "../data/cards.js";
import { getCardDisplayName } from "./i18n.js";
import {
  ActionHandlerRegistry,
  registerDefaultHandlers,
  handleSpecialSummonFromZone,
  handlePermanentBuffNamed,
  handleRemovePermanentBuffNamed,
  handleDestroyAttackerOnArchetypeDestruction,
  handleUpkeepPayOrSendToGrave,
  handleSpecialSummonFromDeckWithCounterLimit,
  handleDestroyTargetedCards,
} from "./ActionHandlers.js";

export default class EffectEngine {
  constructor(game) {
    this.game = game;

    // Initialize action handler registry
    this.actionHandlers = new ActionHandlerRegistry();
    registerDefaultHandlers(this.actionHandlers);

    // Track per-card counters for special summon by type (used by passives like Metal Armored Dragon)
    // Defer listener registration until game is fully initialized
    if (game && typeof game.on === "function") {
      game.on("after_summon", (payload) => {
        this.handleSpecialSummonTypeCounters(payload);
        this.handleFieldPresenceTypeSummonCounters(payload);
      });
    }
  }

  get ui() {
    return this.game?.ui || this.game?.renderer || null;
  }

  /**
   * UNIFIED SPECIAL SUMMON POSITION RESOLVER
   * Implements strict semantics for position selection in all Special Summon paths.
   *
   * Semantics:
   * - position undefined or null => treat as "choice" (player modal, bot defaults to "attack")
   * - position === "choice" => allow choice (player modal, bot defaults to "attack")
   * - position === "attack" or "defense" => FORCED position (no modal, no override)
   *
   * @param {Object} card - Card being summoned
   * @param {Object} player - Player summoning the card
   * @param {Object} options - Additional options
   * @param {string} options.position - Explicit position from action: undefined/"choice"/"attack"/"defense"
   * @returns {Promise<string>} - Resolved position ('attack' or 'defense')
   */
  async chooseSpecialSummonPosition(card, player, options = {}) {
    const actionPosition = options.position;

    // Determine if position is forced or allows choice
    const isForced =
      actionPosition === "attack" || actionPosition === "defense";
    const allowsChoice = !actionPosition || actionPosition === "choice";

    // FORCED POSITION: return immediately without modal
    if (isForced) {
      this.game?.devLog?.("SS_POSITION", {
        summary: `Forced position ${actionPosition} for ${
          card?.name || "unknown"
        }`,
        player: player?.id,
        card: card?.name,
        actionPosition,
        forced: true,
      });
      return actionPosition;
    }

    // CHOICE ALLOWED: Bot auto-selects "attack"
    if (player?.id === "bot") {
      this.game?.devLog?.("SS_POSITION", {
        summary: `Bot auto-chooses attack for ${card?.name || "unknown"}`,
        player: player?.id,
        card: card?.name,
        actionPosition,
        allowsChoice: true,
      });
      return "attack";
    }

    // CHOICE ALLOWED: Player gets modal
    if (
      this.ui &&
      typeof this.ui.showSpecialSummonPositionModal === "function"
    ) {
      return new Promise((resolve) => {
        this.ui.showSpecialSummonPositionModal(card, (choice) => {
          const resolved = choice === "defense" ? "defense" : "attack";
          this.game?.devLog?.("SS_POSITION", {
            summary: `Player chose ${resolved} for ${card?.name || "unknown"}`,
            player: player?.id,
            card: card?.name,
            actionPosition,
            playerChoice: choice,
          });
          resolve(resolved);
        });
      });
    }

    // Fallback: default to "attack" if no UI available
    this.game?.devLog?.("SS_POSITION", {
      summary: `Fallback to attack for ${card?.name || "unknown"} (no UI)`,
      player: player?.id,
      card: card?.name,
      actionPosition,
      fallback: true,
    });
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
    if (!this.game || typeof this.game.canUseOncePerTurn !== "function") {
      console.error(
        "[EffectEngine] checkOncePerTurn: Game instance or canUseOncePerTurn not available"
      );
      return { ok: false, reason: "Game not initialized" };
    }
    return this.game.canUseOncePerTurn(card, player, effect);
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
    if (!this.game || typeof this.game.markOncePerTurnUsed !== "function") {
      console.error(
        "[EffectEngine] registerOncePerTurnUsage: Game instance or markOncePerTurnUsed not available"
      );
      return;
    }
    this.game.markOncePerTurnUsed(card, player, effect);
  }

  cardMatchesFilters(card, filters = {}) {
    if (!card) return false;
    if (filters.cardKind && card.cardKind !== filters.cardKind) return false;
    if (filters.name && card.name !== filters.name) return false;
    if (filters.type) {
      const cardType = card.type || null;
      const cardTypes = Array.isArray(card.types) ? card.types : null;
      if (Array.isArray(filters.type)) {
        const ok = cardTypes
          ? filters.type.some((t) => cardTypes.includes(t))
          : filters.type.includes(cardType);
        if (!ok) return false;
      } else {
        const ok = cardTypes
          ? cardTypes.includes(filters.type)
          : cardType === filters.type;
        if (!ok) return false;
      }
    }
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
              reason: `Opponent must control at least ${
                cond.min ?? 1
              } monster(s).`,
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
        case "control_type_min_level": {
          const zoneName = cond.zone || "field";
          const requireFaceup = cond.requireFaceup !== false; // default true
          const typeName = cond.typeName || cond.cardType;
          const minLevel = cond.minLevel ?? cond.level ?? 1;
          if (!typeName) {
            return { ok: false, reason: "Invalid condition configuration." };
          }
          const zone = player?.[zoneName] || [];
          const hasMatch = zone.some((c) => {
            if (!c) return false;
            if (c.cardKind !== "monster") return false;
            if (requireFaceup && c.isFacedown) return false;
            const lvl = c.level || 0;
            const type = c.type || null;
            const types = Array.isArray(c.types) ? c.types : null;
            const typeOk = types ? types.includes(typeName) : type === typeName;
            return typeOk && lvl >= minLevel;
          });
          if (!hasMatch) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `You must control a ${typeName} with Level ≥ ${minLevel}.`,
            };
          }
          break;
        }
        case "attacker_matches": {
          const attacker = ctx?.attacker;
          if (!attacker) {
            return { ok: false, reason: "No attacker in context." };
          }
          const ownerRule = cond.owner || "any"; // self | opponent | any
          const attackerOwner = this.getOwnerByCard(attacker);
          if (ownerRule === "self" && attackerOwner?.id !== player?.id) {
            return { ok: false, reason: "Attacker is not yours." };
          }
          if (ownerRule === "opponent" && attackerOwner?.id === player?.id) {
            return { ok: false, reason: "Attacker is not opponent's." };
          }
          // Match filters: type, cardKind, level bounds
          if (cond.cardKind && attacker.cardKind !== cond.cardKind) {
            return { ok: false, reason: "Attacker kind mismatch." };
          }
          if (cond.type) {
            const aType = attacker.type || null;
            const aTypes = Array.isArray(attacker.types)
              ? attacker.types
              : null;
            const ok = Array.isArray(cond.type)
              ? aTypes
                ? cond.type.some((t) => aTypes.includes(t))
                : cond.type.includes(aType)
              : aTypes
              ? aTypes.includes(cond.type)
              : aType === cond.type;
            if (!ok) {
              return { ok: false, reason: "Attacker type mismatch." };
            }
          }
          const lvl = attacker.level || 0;
          if (cond.minLevel !== undefined && lvl < cond.minLevel) {
            return { ok: false, reason: "Attacker level too low." };
          }
          if (cond.maxLevel !== undefined && lvl > cond.maxLevel) {
            return { ok: false, reason: "Attacker level too high." };
          }
          break;
        }
        case "source_counters_at_least": {
          const counterType = cond.counterType || "default";
          const min = Number(cond.min ?? 1);
          const source = ctx?.source;
          const count =
            typeof source?.getCounter === "function"
              ? source.getCounter(counterType)
              : 0;
          if (count < min) {
            return {
              ok: false,
              reason:
                cond.reason ||
                `Need at least ${min} ${counterType} counter(s).`,
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

  async collectEventTriggers(eventName, payload) {
    if (eventName === "after_summon") {
      return await this.collectAfterSummonTriggers(payload);
    }
    if (eventName === "battle_destroy") {
      return await this.collectBattleDestroyTriggers(payload);
    }
    if (eventName === "card_to_grave") {
      return await this.collectCardToGraveTriggers(payload);
    }
    if (eventName === "attack_declared") {
      return await this.collectAttackDeclaredTriggers(payload);
    }
    if (eventName === "standby_phase") {
      return await this.collectStandbyPhaseTriggers(payload);
    }
    return { entries: [], orderRule: "no_triggers" };
  }

  checkEffectCondition(
    condition,
    sourceCard,
    player,
    summonedCard,
    sourceZone,
    summonFromZone
  ) {
    if (!condition) return true;

    if (condition.requires === "self_in_hand") {
      const isCurrentlyInHand =
        sourceZone === "hand" && player?.hand?.includes(sourceCard);
      const wasSummonedFromHand =
        summonFromZone === "hand" && summonedCard === sourceCard;
      if (!isCurrentlyInHand && !wasSummonedFromHand) return false;
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

  cardHasArchetype(card, archetype) {
    if (!card || !archetype) return false;
    if (card.archetype === archetype) return true;
    if (Array.isArray(card.archetypes)) {
      return card.archetypes.includes(archetype);
    }
    return false;
  }

  applyPassiveBuffValue(card, effectKey, amount, stats = ["atk", "def"]) {
    if (!card) return false;
    card.dynamicBuffs = card.dynamicBuffs || {};
    const previousEntry = card.dynamicBuffs[effectKey];
    const previousValue = previousEntry?.value || 0;
    if (previousValue === amount) {
      return false;
    }

    const delta = amount - previousValue;
    for (const stat of stats) {
      if (typeof card[stat] === "number") {
        card[stat] += delta;
      }
    }

    if (amount === 0) {
      delete card.dynamicBuffs[effectKey];
      if (Object.keys(card.dynamicBuffs).length === 0) {
        card.dynamicBuffs = null;
      }
    } else {
      card.dynamicBuffs[effectKey] = { value: amount, stats };
    }

    return true;
  }

  clearPassiveBuffsForCard(card) {
    if (!card || !card.dynamicBuffs) return;
    for (const entry of Object.values(card.dynamicBuffs)) {
      if (!entry) continue;
      const value = entry.value || 0;
      const stats = entry.stats || ["atk", "def"];
      if (value === 0) continue;
      for (const stat of stats) {
        if (typeof card[stat] === "number") {
          card[stat] -= value;
        }
      }
    }
    card.dynamicBuffs = null;
  }

  handleSpecialSummonTypeCounters(payload) {
    const { card: summonedCard, player, method } = payload || {};
    if (!summonedCard || method !== "special" || !player) return;

    const typeName = summonedCard.type || null;
    if (!typeName) return;

    const controllerId = player.id || player;
    const fieldCards = player.field || [];

    for (const fieldCard of fieldCards) {
      if (!fieldCard || fieldCard.isFacedown) continue;
      if (fieldCard.cardKind !== "monster") continue;

      const effects = fieldCard.effects || [];
      for (const effect of effects) {
        if (!effect || effect.timing !== "passive") continue;
        const passive = effect.passive;
        if (!passive) continue;
        if (passive.type !== "type_special_summoned_count_buff") continue;
        if (passive.scope !== "card_state") continue; // only per-instance counters

        const passiveType = passive.typeName || passive.monsterType || null;
        if (!passiveType || passiveType !== typeName) continue;

        // Ensure state map and increment
        const state = fieldCard.state || (fieldCard.state = {});
        const map =
          state.specialSummonTypeCount || (state.specialSummonTypeCount = {});
        map[typeName] = (map[typeName] || 0) + 1;
      }
    }

    // Update passives after increment to reflect new buff values
    this.updatePassiveBuffs();
  }

  /**
   * Assign a unique field presence ID to a card when it enters the field.
   * This ID is used to track counters that should reset when the card leaves and returns.
   * The counter tracks events (like summons) that occur WHILE this specific instance is on the field.
   *
   * @param {Object} card - The card entering the field
   */
  assignFieldPresenceId(card) {
    if (!card) return;

    // Generate unique ID: card.id + timestamp + random component
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    card.fieldPresenceId = `fp_${card.id}_${timestamp}_${random}`;

    // Initialize presence-specific state for tracking counters
    if (!card.fieldPresenceState) {
      card.fieldPresenceState = {};
    }
  }

  /**
   * Clear field presence ID and associated state when a card leaves the field.
   * This ensures counters reset when the card returns to the field later.
   *
   * @param {Object} card - The card leaving the field
   */
  clearFieldPresenceId(card) {
    if (!card) return;

    // Clear presence-specific counters
    if (card.fieldPresenceState) {
      card.fieldPresenceState = null;
    }

    // Clear the presence ID
    delete card.fieldPresenceId;
  }

  /**
   * Handle field-presence-based type summon counters.
   * This tracks how many monsters of a specific type have been Special Summoned
   * WHILE a specific card is face-up on the field.
   * The counter resets when the card leaves the field.
   *
   * @param {Object} payload - Event payload from after_summon
   */
  handleFieldPresenceTypeSummonCounters(payload) {
    const { card: summonedCard, player, method } = payload || {};

    // Validate payload
    if (!summonedCard || !player) return;

    const typeName = summonedCard.type || null;
    if (!typeName) return;

    const controllerId = player.id || player;
    const fieldCards = player.field || [];

    // Find all cards with field_presence_type_summon_count_buff passives
    for (const fieldCard of fieldCards) {
      if (!fieldCard || fieldCard.isFacedown) continue;
      if (fieldCard.cardKind !== "monster") continue;
      if (!fieldCard.fieldPresenceId) continue; // Must have a presence ID

      // Don't count the card that was just summoned for itself
      // (it wasn't on the field when the summon happened)
      if (fieldCard === summonedCard) continue;

      const effects = fieldCard.effects || [];
      for (const effect of effects) {
        if (!effect || effect.timing !== "passive") continue;
        const passive = effect.passive;
        if (!passive) continue;
        if (passive.type !== "field_presence_type_summon_count_buff") continue;

        // Check if this passive tracks the summoned card's type
        const passiveType = passive.typeName || null;
        if (!passiveType || passiveType !== typeName) continue;

        // Check summon method filter
        const summonMethods = passive.summonMethods || ["special"];
        // "special" includes ascension, fusion, etc. - normalize check
        const isSpecialSummon =
          method === "special" || method === "ascension" || method === "fusion";
        if (summonMethods.includes("special") && !isSpecialSummon) continue;
        if (
          !summonMethods.includes("special") &&
          !summonMethods.includes(method)
        )
          continue;

        // Check owner filter
        const countOwner = passive.countOwner || "self";
        const summonedOwner = summonedCard.owner || null;
        if (countOwner === "self" && summonedOwner !== controllerId) continue;
        if (countOwner === "opponent" && summonedOwner === controllerId)
          continue;

        // Initialize field presence state if needed
        if (!fieldCard.fieldPresenceState) {
          fieldCard.fieldPresenceState = {};
        }

        // Initialize counter for this type
        const counterKey = `summon_count_${typeName}`;
        if (!fieldCard.fieldPresenceState[counterKey]) {
          fieldCard.fieldPresenceState[counterKey] = 0;
        }

        // Increment counter
        fieldCard.fieldPresenceState[counterKey]++;
      }
    }

    // Update passive buffs to reflect new counts
    this.updatePassiveBuffs();
  }

  updatePassiveBuffs() {
    if (!this.game) return false;

    const fieldCards = [
      ...(this.game.player.field || []),
      ...(this.game.bot.field || []),
    ].filter(Boolean);

    let updated = false;

    // BUG #11 FIX - PHASE 1: Clear ALL dynamic buffs before recalculating
    // This prevents "ghost buffs" from accumulating when effect IDs change
    // or when passive conditions are no longer met
    for (const card of fieldCards) {
      if (!card.dynamicBuffs) continue;

      // Revert all currently applied buffs
      for (const key of Object.keys(card.dynamicBuffs)) {
        const entry = card.dynamicBuffs[key];
        if (!entry) continue;

        const value = entry.value || 0;
        const stats = entry.stats || ["atk", "def"];

        if (value !== 0) {
          for (const stat of stats) {
            if (typeof card[stat] === "number") {
              // Remove buff with clamp to prevent negative stats
              card[stat] = Math.max(0, card[stat] - value);
            }
          }
          updated = true;
        }
      }

      // Clear the buffs object completely - will be rebuilt in Phase 2
      card.dynamicBuffs = {};
    }

    // PHASE 2: Recalculate fresh buffs based on current game state
    for (const card of fieldCards) {
      const effects = card.effects || [];

      effects.forEach((effect, index) => {
        if (!effect || effect.timing !== "passive") return;
        const passive = effect.passive;
        if (!passive) return;

        // Passive: position-based status (e.g., battle indestructible in defense)
        if (passive.type === "position_status") {
          const activePos = passive.activePosition || "defense";
          const statusName = passive.status || "battleIndestructible";
          const shouldHave = (card.position || "attack") === activePos;
          const hasNow = !!card[statusName];
          if (shouldHave && !hasNow) {
            card[statusName] = true;
            updated = true;
          } else if (!shouldHave && hasNow) {
            delete card[statusName];
            updated = true;
          }
          return;
        }

        // Passive: buff per count of special-summoned monsters of a given type
        // Supports per-card scope (card.state) or game-level fallback for future uses
        if (passive.type === "type_special_summoned_count_buff") {
          const typeName = passive.typeName || passive.monsterType || null;
          if (!typeName) return;

          const scope = passive.scope || passive.sourceScope || "game";
          let count = 0;

          if (scope === "card_state") {
            const state = card.state || (card.state = {});
            const map = state.specialSummonTypeCount || {};
            count = map[typeName] || 0;
          } else if (
            this.game &&
            typeof this.game.getSpecialSummonedTypeCount === "function"
          ) {
            const owners = passive.owners || passive.countOwners || ["self"];
            const ownerType = "self";
            if (owners.includes(ownerType)) {
              const ownerId = card.owner;
              count += this.game.getSpecialSummonedTypeCount(ownerId, typeName);
            }
          }

          const perCard =
            passive.amountPerCard ??
            passive.perCard ??
            passive.buffPerCard ??
            0;
          const stats = passive.stats || ["atk", "def"];
          const buffKey = effect.id || `passive_${card.id}_${index}_type_count`;
          const applied = this.applyPassiveBuffValue(
            card,
            buffKey,
            count * perCard,
            stats
          );
          if (applied) updated = true;
          return;
        }

        // Passive: field_presence_type_summon_count_buff - buff based on summons WHILE card is face-up on field
        // Uses fieldPresenceState to track summons only during this card's field presence
        if (passive.type === "field_presence_type_summon_count_buff") {
          const typeName = passive.typeName || passive.monsterType || null;
          if (!typeName) return;

          // Read counter from fieldPresenceState (set by handleFieldPresenceTypeSummonCounters)
          const counterKey = `summon_count_${typeName}`;
          const count = card.fieldPresenceState?.[counterKey] || 0;

          const perCard =
            passive.amountPerCard ??
            passive.perCard ??
            passive.buffPerCard ??
            0;
          const stats = passive.stats || ["atk", "def"];
          const buffKey =
            effect.id || `passive_${card.id}_${index}_field_presence_type`;
          const applied = this.applyPassiveBuffValue(
            card,
            buffKey,
            count * perCard,
            stats
          );
          if (applied) updated = true;
          return;
        }

        // Passive: archetype_count_buff - buff based on count of archetype cards on field
        if (passive.type !== "archetype_count_buff") return;

        const archetype = passive.archetype;
        if (!archetype) return;

        const perCard =
          passive.amountPerCard ?? passive.perCard ?? passive.buffPerCard ?? 0;
        const cardKinds = passive.cardKinds || ["monster"];
        const requireFaceup = passive.requireFaceup || false;
        const includeSelf = passive.includeSelf !== false;
        const stats = passive.stats || ["atk", "def"];
        const owners = passive.countOwners ||
          passive.owners || ["self", "opponent"];

        let count = 0;
        for (const target of fieldCards) {
          if (!target) continue;
          if (!cardKinds.includes(target.cardKind)) continue;
          if (requireFaceup && target.isFacedown) continue;
          if (!this.cardHasArchetype(target, archetype)) continue;
          const ownerType = target.owner === card.owner ? "self" : "opponent";
          if (!owners.includes(ownerType)) continue;
          if (!includeSelf && target === card) continue;
          count++;
        }

        const buffKey = effect.id || `passive_${card.id}_${index}`;
        const applied = this.applyPassiveBuffValue(
          card,
          buffKey,
          count * perCard,
          stats
        );
        if (applied) {
          updated = true;
        }
      });

      // Clean up empty dynamicBuffs object
      if (card.dynamicBuffs && Object.keys(card.dynamicBuffs).length === 0) {
        card.dynamicBuffs = null;
      }
    }

    return updated;
  }

  /**
   * Check if a card is immune to effects from a specific source player.
   * This is the central immunity check - extend this method to add new immunity types.
   *
   * @param {Object} card - The card to check immunity for
   * @param {Object} sourcePlayer - The player whose effect is targeting the card
   * @param {Object} options - Optional settings for specific immunity checks
   * @param {string} options.effectType - Type of effect (e.g., "destruction", "banish", "target")
   * @returns {{immune: boolean, reason: string|null}} Immunity status and reason
   */
  checkImmunity(card, sourcePlayer, options = {}) {
    if (!card || !sourcePlayer) {
      return { immune: false, reason: null };
    }

    // Check 1: Temporary immunity to opponent effects (turn-based)
    if (card.immuneToOpponentEffectsUntilTurn && card.owner) {
      const currentTurn = this.game?.turnCounter ?? 0;
      if (
        currentTurn <= card.immuneToOpponentEffectsUntilTurn &&
        card.owner !== sourcePlayer.id
      ) {
        return {
          immune: true,
          reason: "immune_to_opponent_effects_until_turn",
        };
      }
    }

    // Check 2: Permanent immunity to opponent effects (flag-based)
    if (card.immuneToOpponentEffects && card.owner !== sourcePlayer.id) {
      return { immune: true, reason: "immune_to_opponent_effects" };
    }

    // Check 3: Immunity to specific effect types (extensible)
    const effectType = options.effectType;
    if (effectType && card.immuneTo) {
      const immuneToList = Array.isArray(card.immuneTo)
        ? card.immuneTo
        : [card.immuneTo];
      if (immuneToList.includes(effectType)) {
        return { immune: true, reason: `immune_to_${effectType}` };
      }
    }

    // Check 4: Unaffected by opponent's card effects (Yu-Gi-Oh style)
    if (
      card.unaffectedByOpponentCardEffects &&
      card.owner !== sourcePlayer.id
    ) {
      return { immune: true, reason: "unaffected_by_opponent_card_effects" };
    }

    // Check 5: Cannot be targeted (only applies if effectType is "target")
    if (
      effectType === "target" &&
      card.cannotBeTargeted &&
      card.owner !== sourcePlayer.id
    ) {
      return { immune: true, reason: "cannot_be_targeted" };
    }

    // No immunity detected
    return { immune: false, reason: null };
  }

  /**
   * Simple boolean check for backward compatibility.
   * Use checkImmunity() for detailed immunity information.
   */
  isImmuneToOpponentEffects(card, sourcePlayer) {
    return this.checkImmunity(card, sourcePlayer).immune;
  }

  /**
   * Filter a list of target cards by immunity, returning allowed and skipped targets.
   * This is the central helper for immunity checking.
   *
   * @param {Array} cardsList - Array of cards to filter
   * @param {Object} sourcePlayer - The player whose effect is being applied
   * @param {Object} options - Optional settings
   * @param {string} options.actionType - Type of action for logging
   * @param {string} options.effectType - Type of effect for specific immunity checks
   * @param {boolean} options.logSkipped - Whether to log skipped targets (default: true in dev mode)
   * @param {Function} options.customImmunityCheck - Optional custom immunity check function
   * @returns {{allowed: Array, skipped: Array, skippedReasons: Map}} Filtered results with reasons
   */
  filterCardsListByImmunity(cardsList, sourcePlayer, options = {}) {
    const allowed = [];
    const skipped = [];
    const skippedReasons = new Map();

    if (!Array.isArray(cardsList) || cardsList.length === 0) {
      return { allowed, skipped, skippedReasons };
    }

    for (const card of cardsList) {
      if (!card) continue;

      // Use custom immunity check if provided, otherwise use standard check
      let immunityResult;
      if (typeof options.customImmunityCheck === "function") {
        immunityResult = options.customImmunityCheck(
          card,
          sourcePlayer,
          options
        );
      } else {
        immunityResult = this.checkImmunity(card, sourcePlayer, {
          effectType: options.effectType,
        });
      }

      if (immunityResult.immune) {
        skipped.push(card);
        skippedReasons.set(card, immunityResult.reason);

        // Log in dev mode or if explicitly requested
        const shouldLog = options.logSkipped ?? this.game?.devModeEnabled;
        if (shouldLog && this.ui?.log) {
          const actionDesc = options.actionType
            ? ` (${options.actionType})`
            : "";
          this.ui.log(
            `${card.name} is immune to opponent's effects${actionDesc} and was skipped.`
          );
        }
      } else {
        allowed.push(card);
      }
    }

    return { allowed, skipped, skippedReasons };
  }

  /**
   * Filter targets object by immunity for a specific action.
   * Returns a new targets object with immune cards removed from the targetRef.
   *
   * @param {Object} action - The action being applied
   * @param {Object} ctx - Effect context (player, opponent, source)
   * @param {Object} targets - The targets object with targetRef keys
   * @returns {{filteredTargets: Object, skippedCount: number, allowedCount: number, skipAction: boolean, skippedReasons: Map}}
   */
  filterTargetsByImmunity(action, ctx, targets) {
    const result = {
      filteredTargets: { ...targets },
      skippedCount: 0,
      allowedCount: 0,
      skipAction: false,
      skippedReasons: new Map(),
    };

    if (!action?.targetRef || !ctx?.player || !targets) {
      return result;
    }

    const targetCards = targets[action.targetRef];
    if (!Array.isArray(targetCards) || targetCards.length === 0) {
      return result;
    }

    // Determine effect type from action for more specific immunity checks
    const effectType = action.effectType || this.inferEffectType(action.type);

    const { allowed, skipped, skippedReasons } = this.filterCardsListByImmunity(
      targetCards,
      ctx.player,
      {
        actionType: action.type,
        effectType,
        customImmunityCheck: action.customImmunityCheck,
      }
    );

    result.skippedCount = skipped.length;
    result.allowedCount = allowed.length;
    result.skippedReasons = skippedReasons;

    // Create new targets object with filtered array
    result.filteredTargets = {
      ...targets,
      [action.targetRef]: allowed,
    };

    // Check immunityMode to determine if action should be skipped entirely
    const immunityMode = action.immunityMode || "skip_targets";

    if (immunityMode === "skip_action" && skipped.length > 0) {
      // If any target is immune and mode is skip_action, skip the entire action
      result.skipAction = true;
      if (this.ui?.log) {
        this.ui.log(
          `Action ${action.type} was cancelled because some targets are immune.`
        );
      }
    } else if (
      immunityMode === "skip_targets" &&
      allowed.length === 0 &&
      skipped.length > 0
    ) {
      // All targets were immune - action has no valid targets
      // Don't set skipAction=true, let handler deal with empty array gracefully
    }

    return result;
  }

  /**
   * Infer the effect type from an action type for immunity checking.
   * Extend this method when adding new action types.
   *
   * @param {string} actionType - The action type string
   * @returns {string|null} The inferred effect type
   */
  inferEffectType(actionType) {
    if (!actionType) return null;

    const typeMap = {
      destroy_targeted_cards: "destruction",
      destroy: "destruction",
      banish: "banish",
      banish_destroyed_monster: "banish",
      switch_position: "target",
      set_stats_to_zero_and_negate: "target",
      buff_atk_temp: "target",
      modify_stats_temp: "target",
      bounce_to_hand: "target",
      bounce_to_deck: "target",
      send_to_graveyard: "target",
      negate_effects: "negate",
    };

    return typeMap[actionType] || "target";
  }

  /**
   * @deprecated Use filterTargetsByImmunity instead for per-target filtering.
   * This method is kept for backward compatibility but now only returns true
   * when immunityMode is "skip_action" and any target is immune.
   */
  shouldSkipActionDueToImmunity(action, targets, ctx) {
    if (!action || !action.targetRef || !ctx?.player) return false;

    // Use new filtering system
    const { skipAction } = this.filterTargetsByImmunity(action, ctx, targets);
    return skipAction;
  }

  async handleTriggeredEffect(sourceCard, effect, ctx, selections = null) {
    const targetResult = this.resolveTargets(
      effect.targets || [],
      ctx,
      selections || null
    );

    if (targetResult.needsSelection) {
      return {
        success: false,
        needsSelection: true,
        selectionContract: targetResult.selectionContract,
      };
    }

    if (targetResult.ok === false) {
      return {
        success: false,
        needsSelection: false,
        reason: targetResult.reason,
      };
    }

    this.applyActions(effect.actions || [], ctx, targetResult.targets || {});

    // Record material effect activation for ascension tracking
    const owner = ctx?.player;
    if (
      owner &&
      sourceCard?.cardKind === "monster" &&
      typeof sourceCard.id === "number"
    ) {
      this.game.recordMaterialEffectActivation(owner, sourceCard, {
        contextLabel: "triggered",
        effectId: effect.id,
      });
    }

    this.game.checkWinCondition();

    return { success: true, needsSelection: false };
  }

  buildTriggerActivationContext(sourceCard, player, zoneOverride = null) {
    const activationZone =
      zoneOverride || this.findCardZone(player, sourceCard) || "field";
    return {
      fromHand: activationZone === "hand",
      activationZone,
      sourceZone: activationZone,
      committed: false,
    };
  }

  buildSelectionCandidateKey(candidate = {}, fallbackIndex = 0) {
    const zone = candidate.zone || "field";
    const zoneIndex =
      typeof candidate.zoneIndex === "number" ? candidate.zoneIndex : -1;
    const controller = candidate.controller || candidate.owner || "unknown";
    const baseId =
      candidate.cardRef?.id ||
      candidate.cardRef?.name ||
      candidate.name ||
      String(fallbackIndex);
    return `${controller}:${zone}:${zoneIndex}:${baseId}`;
  }

  buildTriggerEntry(options = {}) {
    const sourceCard = options.sourceCard;
    const owner = options.owner;
    const effect = options.effect;

    if (!sourceCard || !owner || !effect) {
      return null;
    }

    const activationContext =
      options.activationContext ||
      this.buildTriggerActivationContext(
        sourceCard,
        owner,
        options.activationZone
      );
    const selectionKind = options.selectionKind || "triggered";
    const selectionMessage =
      options.selectionMessage || "Select target(s) for the triggered effect.";
    const summary =
      options.summary ||
      `${owner.id}:${sourceCard.name}:${
        effect.id || effect.event || "trigger"
      }`;

    const baseCtx = options.ctx || {};
    const activateImpl =
      options.activate ||
      ((selections, activationCtx, resolvedCtx) =>
        this.handleTriggeredEffect(
          sourceCard,
          effect,
          resolvedCtx,
          selections
        ));

    const config = {
      card: sourceCard,
      owner,
      activationZone: activationContext.activationZone,
      activationContext,
      selectionKind,
      selectionMessage,
      allowDuringOpponentTurn: true,
      allowDuringResolving: true,
      suppressFailureLog: true,
      oncePerTurn: {
        card: sourceCard,
        player: owner,
        effect,
      },
      activate: (selections, activationCtx) => {
        const resolvedCtx = {
          ...baseCtx,
          activationZone: activationCtx.activationZone,
          activationContext: activationCtx,
        };
        return activateImpl(selections, activationCtx, resolvedCtx);
      },
      onSuccess: (result, activationCtx) => {
        this.registerOncePerTurnUsage(sourceCard, owner, effect);
        this.registerOncePerDuelUsage(sourceCard, owner, effect);
        if (typeof options.onSuccess === "function") {
          options.onSuccess(result, activationCtx);
        }
      },
    };

    return {
      summary,
      card: sourceCard,
      effect,
      owner,
      config,
    };
  }

  async collectAfterSummonTriggers(payload) {
    const entries = [];
    const orderRule =
      "summoner -> opponent; sources: summoned card -> fieldSpell -> hand";

    if (!payload || !payload.card || !payload.player) {
      return { entries, orderRule };
    }

    const {
      card,
      player: summoner,
      method,
      fromZone: summonFromZone,
    } = payload;
    const opponent = this.game?.getOpponent?.(summoner);
    const participants = [];

    if (summoner) {
      participants.push({
        owner: summoner,
        opponent,
        includeSummonedCard: true,
      });
    }
    if (opponent) {
      participants.push({
        owner: opponent,
        opponent: summoner,
        includeSummonedCard: false,
      });
    }

    const currentPhase = this.game?.phase;

    for (const side of participants) {
      const owner = side.owner;
      const other = side.opponent;
      if (!owner) continue;

      const sources = [];
      if (side.includeSummonedCard && card) {
        sources.push(card);
      }
      if (owner.fieldSpell) {
        sources.push(owner.fieldSpell);
      }
      if (Array.isArray(owner.hand)) {
        sources.push(...owner.hand);
      }

      for (const sourceCard of sources) {
        if (!sourceCard?.effects || !Array.isArray(sourceCard.effects))
          continue;

        const sourceZone = this.findCardZone(owner, sourceCard);
        const ctx = {
          source: sourceCard,
          player: owner,
          opponent: other,
          summonedCard: card,
          summonMethod: method,
          summonFromZone,
          currentPhase,
        };

        for (const effect of sourceCard.effects) {
          if (!effect || effect.timing !== "on_event") continue;
          if (effect.event !== "after_summon") continue;

          if (this.isEffectNegated(sourceCard)) {
            console.log(
              `${sourceCard.name} effects are negated, skipping effect.`
            );
            continue;
          }

          if (sourceZone === "hand") {
            const requiresSelfInHand =
              effect?.condition?.requires === "self_in_hand";
            const isConditionalSummonFromHand = (effect.actions || []).some(
              (a) => a?.type === "conditional_summon_from_hand"
            );
            if (!requiresSelfInHand && !isConditionalSummonFromHand) {
              continue;
            }
          }

          if (effect.requireOpponentSummon === true) {
            const isOpponentSummon = summoner?.id && summoner.id !== owner.id;
            if (!isOpponentSummon) continue;
          }

          const optCheck = this.checkOncePerTurn(sourceCard, owner, effect);
          if (!optCheck.ok) {
            console.log(optCheck.reason);
            continue;
          }

          const duelCheck = this.checkOncePerDuel(sourceCard, owner, effect);
          if (!duelCheck.ok) {
            console.log(duelCheck.reason);
            continue;
          }

          const summonMethods = effect.summonMethods ?? effect.summonMethod;
          const summonFrom = effect.summonFrom ?? effect.requireSummonedFrom;
          if (summonMethods) {
            const methods = Array.isArray(summonMethods)
              ? summonMethods
              : [summonMethods];
            if (!methods.includes(method)) {
              continue;
            }
          }

          if (summonFrom && summonFromZone && summonFrom !== summonFromZone) {
            continue;
          }

          if (effect.requireSelfAsSummoned && ctx.summonedCard !== sourceCard) {
            continue;
          }

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
              owner,
              card,
              sourceZone,
              summonFromZone
            );
            if (!conditionMet) continue;
          }

          const activationContext = this.buildTriggerActivationContext(
            sourceCard,
            owner,
            sourceZone
          );

          const entry = this.buildTriggerEntry({
            sourceCard,
            owner,
            effect,
            ctx,
            activationContext,
            selectionKind: "triggered",
            selectionMessage: "Select target(s) for the triggered effect.",
            activate: async (selections, activationCtx, resolvedCtx) => {
              if (
                effect.promptUser === true &&
                owner === this.game?.player &&
                selections == null
              ) {
                const promptName =
                  getCardDisplayName(sourceCard) ||
                  sourceCard?.name ||
                  "this card";
                if (
                  this.ui &&
                  typeof this.ui.showConditionalSummonPrompt === "function"
                ) {
                  const shouldActivate =
                    await this.ui.showConditionalSummonPrompt(
                      promptName,
                      effect.promptMessage || `Activate ${promptName}'s effect?`
                    );
                  if (!shouldActivate) {
                    return {
                      success: false,
                      needsSelection: false,
                      reason: "Effect activation cancelled.",
                    };
                  }
                }
              }

              return this.handleTriggeredEffect(
                sourceCard,
                effect,
                resolvedCtx,
                selections
              );
            },
          });

          if (entry) {
            entries.push(entry);
          }
        }
      }
    }

    return { entries, orderRule, onComplete: () => this.updatePassiveBuffs() };
  }

  async collectBattleDestroyTriggers(payload) {
    const entries = [];
    const orderRule =
      "attacker owner -> destroyed owner; sources: field/fieldSpell/equips -> hand -> destroyed card";

    if (!payload || !payload.attacker || !payload.destroyed) {
      return { entries, orderRule };
    }

    const attacker = payload.attacker;
    const destroyed = payload.destroyed;
    const attackerOwner =
      payload.attackerOwner || this.getOwnerByCard(attacker);
    const destroyedOwner =
      payload.destroyedOwner || this.getOwnerByCard(destroyed);

    const participants = [
      { owner: attackerOwner, other: destroyedOwner },
      { owner: destroyedOwner, other: attackerOwner },
    ];

    const processedDestroyedCard = new Set();

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

      // Add destroyed card to trigger sources only once (avoid double processing in mutual destruction)
      if (
        destroyed &&
        destroyedOwner === owner &&
        !triggerSources.includes(destroyed) &&
        !processedDestroyedCard.has(destroyed)
      ) {
        triggerSources.push(destroyed);
        processedDestroyedCard.add(destroyed);
      }

      for (const card of triggerSources) {
        if (!card || !card.effects || !Array.isArray(card.effects)) continue;

        const ctx = {
          source: card,
          player: owner,
          opponent: side.other,
          attacker,
          destroyed,
          attackerOwner,
          destroyedOwner,
          host: card.equippedTo || null,
        };

        for (const effect of card.effects) {
          if (!effect || effect.timing !== "on_event") continue;
          if (effect.event !== "battle_destroy") continue;

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
              (ctx.destroyedOwner && ctx.destroyedOwner.id) ||
              ctx.destroyedOwner;
            const opponentId = side.other?.id;
            if (!destroyedOwnerId || destroyedOwnerId !== opponentId) continue;
          }
          if (effect.requireOwnMonsterArchetype) {
            const destroyedCard = ctx.destroyed;
            const destroyedOwnerId =
              (ctx.destroyedOwner && ctx.destroyedOwner.id) ||
              ctx.destroyedOwner;
            const ownerId = owner?.id || owner;
            if (!destroyedCard || destroyedOwnerId !== ownerId) continue;
            if (destroyedCard.cardKind && destroyedCard.cardKind !== "monster")
              continue;
            const required = effect.requireOwnMonsterArchetype;
            const archetype = destroyedCard.archetype;
            const matches = Array.isArray(archetype)
              ? archetype.includes(required)
              : typeof archetype === "string" && archetype.includes(required);
            if (!matches) continue;
          }
          if (effect.requireEquippedAsAttacker) {
            if (!card.equippedTo) continue;
            if (ctx.attacker !== card.equippedTo) continue;
          }

          const activationContext = this.buildTriggerActivationContext(
            card,
            owner
          );

          const entry = this.buildTriggerEntry({
            sourceCard: card,
            owner,
            effect,
            ctx,
            activationContext,
            selectionKind: "triggered",
            selectionMessage: "Select target(s) for the triggered effect.",
          });

          if (entry) {
            entries.push(entry);
          }
        }
      }
    }

    return { entries, orderRule, onComplete: () => this.updatePassiveBuffs() };
  }

  async collectAttackDeclaredTriggers(payload) {
    const entries = [];
    const orderRule =
      "attacker owner -> defender owner; sources: field -> fieldSpell";

    if (
      !payload ||
      !payload.attacker ||
      !payload.attackerOwner ||
      !payload.defenderOwner
    ) {
      return { entries, orderRule };
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

          if (
            effect.requireSelfAsDefender === true &&
            payload.defender !== card
          ) {
            continue;
          }

          if (
            effect.requireSelfAsAttacker === true &&
            payload.attacker !== card
          ) {
            console.log(
              "[attack_declared] Skipping effect: requireSelfAsAttacker not met",
              {
                effectId: effect.id,
                cardName: card.name,
                attackerName: payload.attacker?.name,
              }
            );
            continue;
          }

          if (effect.requireDefenderPosition === true) {
            const defenderCard = payload.defender;
            if (!defenderCard || defenderCard.position !== "defense") {
              console.log(
                "[attack_declared] Skipping effect: requireDefenderPosition not met",
                {
                  effectId: effect.id,
                  cardName: card.name,
                  hasDefender: !!defenderCard,
                  defenderName: defenderCard?.name,
                  defenderPosition: defenderCard?.position,
                }
              );
              continue;
            }
          }

          const shouldPrompt =
            effect.speed === 2 && effect.promptOnAttackDeclared !== false;
          if (player.id === "player" && shouldPrompt) {
            let wantsToUse = true;

            const customPromptMethod = effect.customPromptMethod;
            if (customPromptMethod && this.ui?.[customPromptMethod]) {
              wantsToUse = await this.ui[customPromptMethod]();
            } else if (this.ui?.showConfirmPrompt) {
              const confirmResult = this.ui.showConfirmPrompt(
                `Use ${card.name}'s effect to negate the attack?`,
                { kind: "attack_negation", cardName: card.name }
              );
              wantsToUse =
                confirmResult && typeof confirmResult.then === "function"
                  ? await confirmResult
                  : !!confirmResult;
            } else {
              wantsToUse = true;
            }

            if (!wantsToUse) continue;
          }

          const ctx = {
            source: card,
            player,
            opponent,
            attacker: payload.attacker,
            defender: payload.defender || null,
            target: payload.target || null,
            attackerOwner: payload.attackerOwner,
            defenderOwner: payload.defenderOwner,
          };

          const activationContext = this.buildTriggerActivationContext(
            card,
            player
          );

          const entry = this.buildTriggerEntry({
            sourceCard: card,
            owner: player,
            effect,
            ctx,
            activationContext,
            selectionKind: "triggered",
            selectionMessage: "Select target(s) for the triggered effect.",
          });

          if (entry) {
            entries.push(entry);
          }
        }
      }
    }

    return { entries, orderRule };
  }

  async collectCardToGraveTriggers(payload) {
    const entries = [];
    const orderRule = "card owner only; source: card";

    const { card, player, opponent, fromZone, toZone } = payload || {};
    if (!card || !player) return { entries, orderRule };
    if (!card.effects || !Array.isArray(card.effects)) {
      return { entries, orderRule };
    }

    const resolvedOpponent = opponent || this.game?.getOpponent?.(player);

    console.log(
      `[handleCardToGraveEvent] ${card.name} entered graveyard. card.owner="${card.owner}", ctx.player.id="${player.id}", ctx.opponent.id="${resolvedOpponent?.id}", wasDestroyed=${payload?.wasDestroyed}`
    );
    console.log(
      `[handleCardToGraveEvent] ${card.name} entered graveyard from ${fromZone}. Card has ${card.effects.length} effects.`
    );

    const ctx = {
      source: card,
      player,
      opponent: resolvedOpponent,
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

      if (this.isEffectNegated(card)) {
        console.log(
          `[handleCardToGraveEvent] ${card.name} effects are negated, skipping effect.`
        );
        continue;
      }

      console.log(
        `[handleCardToGraveEvent] Found card_to_grave effect: ${effect.id}`
      );

      if (effect.requireSelfAsDestroyed && !payload?.wasDestroyed) {
        console.log(
          `[handleCardToGraveEvent] Skipping ${effect.id}: requires destruction.`
        );
        continue;
      }

      // ✅ Check condition for destruction type (battle vs effect)
      if (effect.condition) {
        const condType = effect.condition.type;
        const destroyCause = payload?.destroyCause;

        if (condType === "destroyed_by_battle") {
          if (destroyCause !== "battle") {
            console.log(
              `[handleCardToGraveEvent] Skipping ${effect.id}: requires destruction by battle, but cause was "${destroyCause}".`
            );
            continue;
          }
        } else if (condType === "destroyed_by_effect") {
          if (destroyCause !== "effect") {
            console.log(
              `[handleCardToGraveEvent] Skipping ${effect.id}: requires destruction by effect, but cause was "${destroyCause}".`
            );
            continue;
          }
        } else if (condType === "destroyed_by_battle_or_effect") {
          if (destroyCause !== "battle" && destroyCause !== "effect") {
            console.log(
              `[handleCardToGraveEvent] Skipping ${effect.id}: requires destruction by battle or effect, but cause was "${destroyCause}".`
            );
            continue;
          }
        }
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

      const activationContext = this.buildTriggerActivationContext(
        card,
        player,
        toZone || this.findCardZone(player, card) || "graveyard"
      );

      const entry = this.buildTriggerEntry({
        sourceCard: card,
        owner: player,
        effect,
        ctx,
        activationContext,
        selectionKind: "triggered",
        selectionMessage: "Select target(s) for the triggered effect.",
      });

      if (entry) {
        entries.push(entry);
      }
    }

    return { entries, orderRule };
  }

  async collectStandbyPhaseTriggers(payload) {
    const entries = [];
    const orderRule =
      "active player only; sources: field -> spellTrap -> fieldSpell";

    if (!payload || !payload.player) return { entries, orderRule };

    const owner = payload.player;
    const opponent = payload.opponent || this.game?.getOpponent?.(owner);

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

        const activationContext = this.buildTriggerActivationContext(
          card,
          owner
        );

        const entry = this.buildTriggerEntry({
          sourceCard: card,
          owner,
          effect,
          ctx,
          activationContext,
          selectionKind: "triggered",
          selectionMessage: "Select target(s) for the triggered effect.",
        });

        if (entry) {
          entries.push(entry);
        }
      }
    }

    return { entries, orderRule };
  }

  getHandActivationEffect(card) {
    if (!card || !Array.isArray(card.effects)) {
      return null;
    }
    return card.effects.find((e) => e && e.timing === "on_play") || null;
  }

  getSpellTrapActivationEffect(card, options = {}) {
    if (!card || !Array.isArray(card.effects)) {
      return null;
    }
    if (card.cardKind === "trap") {
      return (
        card.effects.find(
          (e) => e && (e.timing === "on_activate" || e.timing === "ignition")
        ) || null
      );
    }
    if (card.cardKind === "spell") {
      const fromHand = options.fromHand === true;
      if (fromHand) {
        return this.getHandActivationEffect(card);
      }
      return card.effects.find((e) => e && e.timing === "ignition") || null;
    }
    return null;
  }

  getMonsterIgnitionEffect(card, activationZone = "field") {
    if (!card || !Array.isArray(card.effects)) {
      return null;
    }
    if (activationZone === "graveyard") {
      return (
        card.effects.find(
          (e) => e && e.timing === "ignition" && e.requireZone === "graveyard"
        ) || null
      );
    }
    if (activationZone === "hand") {
      return (
        card.effects.find(
          (e) => e && e.timing === "ignition" && e.requireZone === "hand"
        ) || null
      );
    }
    return (
      card.effects.find(
        (e) =>
          e &&
          e.timing === "ignition" &&
          (!e.requireZone || e.requireZone === "field")
      ) || null
    );
  }

  getFieldSpellActivationEffect(card) {
    if (!card || !Array.isArray(card.effects)) {
      return null;
    }
    // Look for on_field_activate OR ignition with requireZone: "fieldSpell"
    return (
      card.effects.find(
        (e) =>
          e &&
          (e.timing === "on_field_activate" ||
            (e.timing === "ignition" && e.requireZone === "fieldSpell"))
      ) || null
    );
  }

  activateMonsterFromGraveyard(
    card,
    player,
    selections = null,
    activationContext = {}
  ) {
    if (!card || !player) {
      return {
        success: false,
        needsSelection: false,
        reason: "Missing card or player.",
      };
    }
    if (this.game?.turn !== player.id) {
      return {
        success: false,
        needsSelection: false,
        reason: "Not your turn.",
      };
    }
    if (this.game?.phase !== "main1" && this.game?.phase !== "main2") {
      return {
        success: false,
        needsSelection: false,
        reason: "Effect can only be used in Main Phase.",
      };
    }
    if (card.cardKind !== "monster") {
      return {
        success: false,
        needsSelection: false,
        reason: "Only monsters can activate from graveyard.",
      };
    }
    if (!player.graveyard || !player.graveyard.includes(card)) {
      return {
        success: false,
        needsSelection: false,
        reason: "Monster is not in the graveyard.",
      };
    }

    // Busca efeito ignition com requireZone: "graveyard"
    const effect = card.effects?.find(
      (e) => e.timing === "ignition" && e.requireZone === "graveyard"
    );

    if (!effect) {
      return {
        success: false,
        needsSelection: false,
        reason: "No graveyard ignition effect.",
      };
    }

    const optCheck = this.checkOncePerTurn(card, player, effect);
    if (!optCheck.ok) {
      return { success: false, needsSelection: false, reason: optCheck.reason };
    }

    const duelCheck = this.checkOncePerDuel(card, player, effect);
    if (!duelCheck.ok) {
      return {
        success: false,
        needsSelection: false,
        reason: duelCheck.reason,
      };
    }

    const normalizedActivationContext = {
      fromHand: activationContext?.fromHand === true,
      activationZone: "graveyard",
      sourceZone: activationContext?.sourceZone || "graveyard",
      committed: activationContext?.committed === true,
      commitInfo: activationContext?.commitInfo || null,
      autoSelectSingleTarget: activationContext?.autoSelectSingleTarget,
    };

    const ctx = {
      source: card,
      player,
      opponent: this.game.getOpponent(player),
      activationZone: "graveyard",
      activationContext: normalizedActivationContext,
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
        selectionContract: targetResult.selectionContract,
      };
    }

    if (!targetResult.ok) {
      return {
        success: false,
        needsSelection: false,
        reason: targetResult.reason,
      };
    }

    this.applyActions(effect.actions || [], ctx, targetResult.targets);
    this.registerOncePerTurnUsage(card, player, effect);
    this.registerOncePerDuelUsage(card, player, effect);
    this.game.checkWinCondition();
    return { success: true, needsSelection: false };
  }

  activateFieldSpell(card, player, selections = null, activationContext = {}) {
    if (!card || card.cardKind !== "spell" || card.subtype !== "field") {
      return {
        success: false,
        needsSelection: false,
        reason: "Not a field spell.",
      };
    }

    const check = this.canActivate(card, player);
    if (!check.ok) {
      return { success: false, needsSelection: false, reason: check.reason };
    }

    // Look for on_field_activate OR ignition with requireZone: "fieldSpell"
    const effect = (card.effects || []).find(
      (e) =>
        e &&
        (e.timing === "on_field_activate" ||
          (e.timing === "ignition" && e.requireZone === "fieldSpell"))
    );

    if (!effect) {
      return {
        success: false,
        needsSelection: false,
        reason: "No field activation effect.",
      };
    }

    const optCheck = this.checkOncePerTurn(card, player, effect);
    if (!optCheck.ok) {
      return { success: false, needsSelection: false, reason: optCheck.reason };
    }

    // Check requireEmptyField condition
    if (effect.requireEmptyField && player.field.length > 0) {
      return {
        success: false,
        needsSelection: false,
        reason: "You must control no monsters to activate this effect.",
      };
    }

    const normalizedActivationContext = {
      fromHand: activationContext?.fromHand === true,
      activationZone: "fieldSpell",
      sourceZone: activationContext?.sourceZone || "fieldSpell",
      committed: activationContext?.committed === true,
      commitInfo: activationContext?.commitInfo || null,
      autoSelectSingleTarget: activationContext?.autoSelectSingleTarget,
    };

    const ctx = {
      source: card,
      player,
      opponent: this.game.getOpponent(player),
      activationZone: "fieldSpell",
      activationContext: normalizedActivationContext,
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
        selectionContract: targetResult.selectionContract,
      };
    }

    if (!targetResult.ok) {
      return {
        success: false,
        needsSelection: false,
        reason: targetResult.reason,
      };
    }

    this.applyActions(effect.actions || [], ctx, targetResult.targets);
    this.registerOncePerTurnUsage(card, player, effect);
    this.game.checkWinCondition();

    return { success: true, needsSelection: false };
  }

  async activateSpellTrapEffect(
    card,
    player,
    selections = null,
    activationZone = "spellTrap",
    activationContext = {}
  ) {
    const logDev =
      this.game?.devLog &&
      ((tag, detail) => this.game.devLog(tag, detail || {}));
    const fail = (reason) => {
      if (logDev) {
        logDev("SPELL_TRAP_ACTIVATION_FAILED", {
          card: card?.name || "Unknown",
          player: player?.id || null,
          reason,
        });
      }
      return { success: false, needsSelection: false, reason };
    };

    if (!card || !player) {
      return fail("Missing card or player.");
    }
    if (card.owner !== player.id) {
      return fail("Card does not belong to the requesting player.");
    }
    if (card.cardKind !== "spell" && card.cardKind !== "trap") {
      return fail("Only Spell/Trap cards can use this effect.");
    }
    if (card.isFacedown) {
      return fail("Card must be face-up to activate.");
    }
    if (this.game.turn !== player.id) {
      return fail("Not your turn.");
    }
    if (this.game.phase !== "main1" && this.game.phase !== "main2") {
      return fail("Effect can only be activated during Main Phase.");
    }

    const fromHand = activationContext?.fromHand === true;
    const normalizedActivationContext = {
      fromHand,
      activationZone,
      sourceZone:
        activationContext?.sourceZone || (fromHand ? "hand" : activationZone),
      committed: activationContext?.committed === true,
      commitInfo: activationContext?.commitInfo || null,
      autoSelectSingleTarget: activationContext?.autoSelectSingleTarget,
    };
    let effect = null;

    logDev?.("SPELL_TRAP_ACTIVATION_ATTEMPT", {
      card: card.name,
      player: player.id,
      fromHand,
      activationZone,
    });

    if (
      this.game?.devModeEnabled &&
      activationContext?.devFailAfterCommit === true &&
      normalizedActivationContext.committed === true &&
      activationZone === "fieldSpell"
    ) {
      return {
        success: false,
        needsSelection: false,
        reason: "Dev forced failure.",
      };
    }

    if (card.cardKind === "trap") {
      effect = (card.effects || []).find(
        (e) => e && (e.timing === "on_activate" || e.timing === "ignition")
      );
      if (!effect) {
        return fail("No trap activation effect defined.");
      }
    } else if (card.cardKind === "spell") {
      if (fromHand) {
        effect = this.getHandActivationEffect(card);
        const placementOnly =
          !effect &&
          (card.subtype === "field" || card.subtype === "continuous");
        if (!effect) {
          if (placementOnly) {
            logDev?.("SPELL_TRAP_PLACEMENT_ONLY", {
              card: card.name,
              player: player.id,
              activationZone,
            });
            return {
              success: true,
              needsSelection: false,
              placementOnly: true,
            };
          }
          return fail("No on_play effect defined.");
        }
      } else {
        effect = (card.effects || []).find((e) => e && e.timing === "ignition");
        if (!effect) {
          return fail("No ignition effect defined.");
        }
      }
    }

    // Check requireEmptyField condition
    if (effect.requireEmptyField && player.field.length > 0) {
      return fail("You must control no monsters to activate this effect.");
    }

    const ctx = {
      source: card,
      player,
      opponent: this.game.getOpponent(player),
      activationZone,
      activationContext: normalizedActivationContext,
    };

    const condCheck = this.evaluateConditions(effect.conditions, ctx);
    if (!condCheck.ok) {
      return fail(condCheck.reason);
    }

    const optCheck = this.checkOncePerTurn(card, player, effect);
    if (!optCheck.ok) {
      return fail(optCheck.reason);
    }

    const targetResult = this.resolveTargets(
      effect.targets || [],
      ctx,
      selections
    );
    if (targetResult.needsSelection) {
      logDev?.("SPELL_TRAP_NEEDS_SELECTION", {
        card: card.name,
        player: player.id,
      });
      return {
        success: false,
        needsSelection: true,
        selectionContract: targetResult.selectionContract,
      };
    }

    if (targetResult.ok === false) {
      return fail(targetResult.reason);
    }

    logDev?.("SPELL_TRAP_ACTIONS_START", {
      card: card.name,
      player: player.id,
      actionCount: (effect.actions || []).length,
    });
    await this.applyActions(
      effect.actions || [],
      ctx,
      targetResult.targets || {}
    );
    this.registerOncePerTurnUsage(card, player, effect);
    this.game.checkWinCondition();
    logDev?.("SPELL_TRAP_ACTIVATION_RESOLVED", {
      card: card.name,
      player: player.id,
    });
    return { success: true, needsSelection: false };
  }

  activateMonsterEffect(
    card,
    player,
    selections = null,
    activationZone = "field",
    activationContext = {}
  ) {
    if (!card || !player) {
      return {
        success: false,
        needsSelection: false,
        reason: "Missing card or player.",
      };
    }
    if (card.owner !== player.id) {
      return {
        success: false,
        needsSelection: false,
        reason: "Card does not belong to the requesting player.",
      };
    }
    if (card.cardKind !== "monster") {
      return {
        success: false,
        needsSelection: false,
        reason: "Only Monster cards can use this effect.",
      };
    }
    if (card.isFacedown) {
      return {
        success: false,
        needsSelection: false,
        reason: "Card must be face-up to activate.",
      };
    }
    if (this.game.turn !== player.id) {
      return {
        success: false,
        needsSelection: false,
        reason: "Not your turn.",
      };
    }
    if (this.game.phase !== "main1" && this.game.phase !== "main2") {
      return {
        success: false,
        needsSelection: false,
        reason: "Effect can only be activated during Main Phase.",
      };
    }

    // Verify card is in the correct zone
    if (activationZone === "hand") {
      if (!player.hand || !player.hand.includes(card)) {
        return {
          success: false,
          needsSelection: false,
          reason: "Card is not in your hand.",
        };
      }
    } else if (activationZone === "field") {
      if (!player.field || !player.field.includes(card)) {
        return {
          success: false,
          needsSelection: false,
          reason: "Card is not on the field.",
        };
      }
    }

    // Check if effects are negated (only for cards on field)
    if (activationZone === "field" && this.isEffectNegated(card)) {
      return {
        success: false,
        needsSelection: false,
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
        needsSelection: false,
        reason: "No ignition effect defined for this zone.",
      };
    }

    const fromHand =
      activationContext?.fromHand === true || activationZone === "hand";
    const normalizedActivationContext = {
      fromHand,
      activationZone,
      sourceZone:
        activationContext?.sourceZone || (fromHand ? "hand" : activationZone),
      committed: activationContext?.committed === true,
      commitInfo: activationContext?.commitInfo || null,
      autoSelectSingleTarget: activationContext?.autoSelectSingleTarget,
    };

    const ctx = {
      source: card,
      player,
      opponent: this.game.getOpponent(player),
      activationZone,
      activationContext: normalizedActivationContext,
    };

    const condCheck = this.evaluateConditions(effect.conditions, ctx);
    if (!condCheck.ok) {
      return {
        success: false,
        needsSelection: false,
        reason: condCheck.reason,
      };
    }

    const optCheck = this.checkOncePerTurn(card, player, effect);
    if (!optCheck.ok) {
      return { success: false, needsSelection: false, reason: optCheck.reason };
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
        selectionContract: targetResult.selectionContract,
      };
    }

    if (targetResult.ok === false) {
      return {
        success: false,
        needsSelection: false,
        reason: targetResult.reason,
      };
    }

    this.applyActions(effect.actions || [], ctx, targetResult.targets || {});
    this.registerOncePerTurnUsage(card, player, effect);
    this.registerOncePerDuelUsage(card, player, effect);
    this.game.checkWinCondition();
    return { success: true, needsSelection: false };
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

    return { ok: true };
  }

  /**
   * Dry-run check for activating a Spell from hand (no side effects).
   */
  canActivateSpellFromHandPreview(card, player, options = {}) {
    options = options || {};
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
      activationContext: options.activationContext || {},
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
    const requirements = [];
    let needsSelection = false;
    const activationContext = ctx?.activationContext || {};
    const autoSelectSingleTarget =
      activationContext.autoSelectSingleTarget === true;
    const isBot = ctx?.player?.id === "bot";

    for (const def of targetDefs) {
      const { zoneName, candidates } = this.selectCandidates(def, ctx);
      const min = Number(def.count?.min ?? 1);
      const max = Number(def.count?.max ?? min);

      if (candidates.length < min) {
        return { ok: false, reason: "No valid targets for this effect." };
      }

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
        const candidate = {
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
        candidate.key = this.buildSelectionCandidateKey(candidate, idx);
        return candidate;
      });

      const hasSelections = selections && typeof selections === "object";
      const provided = hasSelections ? selections[def.id] : null;
      if (hasSelections) {
        const providedList = Array.isArray(provided)
          ? provided
          : provided != null
          ? [provided]
          : [];
        const chosen = [];
        const seen = new Set();
        for (const entry of providedList) {
          let candidate = null;
          if (typeof entry === "number") {
            candidate = decoratedCandidates[entry];
          } else if (typeof entry === "string") {
            candidate = decoratedCandidates.find((cand) => cand.key === entry);
          } else if (entry && typeof entry === "object") {
            if (typeof entry.key === "string") {
              candidate = decoratedCandidates.find(
                (cand) => cand.key === entry.key
              );
            } else if (
              typeof entry.zone === "string" &&
              typeof entry.index === "number"
            ) {
              candidate = decoratedCandidates.find(
                (cand) =>
                  cand.zone === entry.zone &&
                  cand.zoneIndex === entry.index &&
                  (!entry.owner ||
                    cand.controller === entry.owner ||
                    cand.owner === entry.owner)
              );
            }
          }
          if (candidate && !seen.has(candidate.key)) {
            seen.add(candidate.key);
            if (candidate.cardRef) {
              chosen.push(candidate.cardRef);
            }
          }
        }
        if (chosen.length >= min && chosen.length <= max) {
          targetMap[def.id] = chosen;
          continue;
        }
        return {
          ok: false,
          reason: "Selected targets are no longer valid.",
        };
      }

      const autoSelectExplicit = def.autoSelect === true;
      const allowAutoSelectForPlayer =
        !isBot && autoSelectSingleTarget && autoSelectExplicit;
      const allowAutoSelectForBot =
        isBot &&
        autoSelectSingleTarget &&
        (autoSelectExplicit || (min === 1 && max === 1));
      const shouldAutoSelect =
        allowAutoSelectForPlayer || allowAutoSelectForBot;
      if (shouldAutoSelect) {
        const desiredCount = autoSelectExplicit ? max : 1;
        const takeCount = Math.min(desiredCount, candidates.length);
        targetMap[def.id] = candidates.slice(0, takeCount);
        continue;
      }

      needsSelection = true;
      const zones =
        Array.isArray(def.zones) && def.zones.length > 0
          ? def.zones
          : [def.zone || zoneName];
      const owner =
        def.owner === "opponent"
          ? "opponent"
          : def.owner === "any"
          ? "either"
          : "player";
      const filters = {};
      if (def.cardKind) filters.cardKind = def.cardKind;
      if (def.archetype) filters.archetype = def.archetype;
      if (def.cardName) filters.name = def.cardName;
      if (def.subtype) filters.subtype = def.subtype;
      if (def.requireFaceup) filters.faceUp = true;
      if (def.position && def.position !== "any") {
        filters.position = def.position;
      }
      if (def.excludeCardName) {
        filters.excludeCardName = def.excludeCardName;
      }
      if (def.level !== undefined) {
        filters.level = def.level;
      }
      if (def.levelOp) {
        filters.levelOp = def.levelOp;
      }
      if (def.strategy) {
        filters.strategy = def.strategy;
      }
      if (def.requireThisCard) {
        filters.requireThisCard = true;
      }
      if (def.tags) {
        filters.tags = def.tags;
      }
      if (def.type) {
        filters.type = def.type;
      }
      if (def.excludeSelf) {
        filters.excludeSelf = true;
      }
      requirements.push({
        id: def.id,
        min,
        max,
        zones,
        owner,
        filters,
        allowSelf: def.allowSelf !== false || def.requireThisCard === true,
        distinct: def.distinct !== false,
        candidates: decoratedCandidates,
      });
    }

    if (needsSelection) {
      return {
        needsSelection: true,
        selectionContract: {
          kind: "target",
          message: null,
          requirements,
          ui: {},
          metadata: {
            sourceCardId: ctx?.source?.id,
          },
        },
      };
    }

    return { ok: true, targets: targetMap };
  }

  selectCandidates(def, ctx) {
    const logTargets = ctx?.activationContext?.logTargets !== false;
    const log = (...args) => {
      if (logTargets) {
        console.log(...args);
      }
    };
    const zoneName = def.zone || "field";
    const zoneList =
      Array.isArray(def.zones) && def.zones.length > 0 ? def.zones : [zoneName];

    log(
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
    log(
      `[selectCandidates] Using ${owners.length} owners: ${owners
        .map((o) => o.id)
        .join(", ")}`
    );
    for (const owner of owners) {
      for (const zoneKey of zoneList) {
        const zone = this.getZone(owner, zoneKey) || [];
        log(
          `[selectCandidates] Checking zone "${zoneKey}" for owner ${
            owner.id
          }: ${zone.length} cards ${
            zone.length > 0 ? `(${zone.map((c) => c.name).join(", ")})` : ""
          }`
        );
        for (const card of zone) {
          log(
            `[selectCandidates] Evaluating card: ${card.name} (archetype: ${card.archetype}, owner: ${owner.id})`
          );
          if (def.requireThisCard && ctx?.source && card !== ctx.source) {
            log(
              `[selectCandidates] Rejecting: requireThisCard and card is not source`
            );
            continue;
          }
          if (
            zoneKey === "hand" &&
            ctx.activationZone === "hand" &&
            card === ctx.source &&
            !def.requireThisCard
          ) {
            log(`[selectCandidates] Rejecting: card is source in hand zone`);
            continue;
          }
          if (def.cardKind) {
            const requiredKinds = Array.isArray(def.cardKind)
              ? def.cardKind
              : [def.cardKind];
            if (!requiredKinds.includes(card.cardKind)) {
              log(
                `[selectCandidates] Rejecting: cardKind mismatch (${
                  card.cardKind
                } !== ${requiredKinds.join(",")})`
              );
              continue;
            }
          }
          if (def.requireFaceup && card.isFacedown) {
            log(`[selectCandidates] Rejecting: card is facedown`);
            continue;
          }
          if (
            def.position &&
            def.position !== "any" &&
            card.position !== def.position
          ) {
            log(
              `[selectCandidates] Rejecting: position mismatch (${card.position} !== ${def.position})`
            );
            continue;
          }
          const cardLevel = card.level || 0;
          if (def.level !== undefined && cardLevel !== def.level) {
            log(
              `[selectCandidates] Rejecting: level mismatch (${cardLevel} !== ${def.level})`
            );
            continue;
          }
          if (def.minLevel !== undefined && cardLevel < def.minLevel) {
            log(
              `[selectCandidates] Rejecting: level too low (${cardLevel} < ${def.minLevel})`
            );
            continue;
          }
          if (def.maxLevel !== undefined && cardLevel > def.maxLevel) {
            log(
              `[selectCandidates] Rejecting: level too high (${cardLevel} > ${def.maxLevel})`
            );
            continue;
          }
          const cardAtk = card.atk || 0;
          if (def.minAtk !== undefined && cardAtk < def.minAtk) {
            log(
              `[selectCandidates] Rejecting: ATK too low (${cardAtk} < ${def.minAtk})`
            );
            continue;
          }
          if (def.maxAtk !== undefined && cardAtk > def.maxAtk) {
            log(
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
              log(`[selectCandidates] Rejecting: counter-based ATK too high`);
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
              log(
                `[selectCandidates] Rejecting: archetype mismatch (${card.archetype} doesn't include ${def.archetype})`
              );
              continue;
            }
          }

          const requiredName = def.cardName || def.name;
          if (requiredName && card.name !== requiredName) {
            log(
              `[selectCandidates] Rejecting: name mismatch (${card.name} !== ${requiredName})`
            );
            continue;
          }

          // Exclude by card name
          if (def.excludeCardName && card.name === def.excludeCardName) {
            log(
              `[selectCandidates] Excluding ${card.name} (matches excludeCardName)`
            );
            continue;
          }

          log(`[selectCandidates] ACCEPTED: ${card.name}`);
          candidates.push(card);
        }
      }
    }

    log(
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
    if (this.game && typeof this.game.canUseOncePerTurn === "function") {
      return this.game.canUseOncePerTurn(card, player, effect).ok === true;
    }
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
    if (this.game && typeof this.game.markOncePerTurnUsed === "function") {
      this.game.markOncePerTurnUsed(card, player, effect);
      return;
    }
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

  async applyActions(actions, ctx, targets) {
    let executed = false;
    if (!Array.isArray(actions)) {
      return executed;
    }

    const logDev =
      this.game?.devLog &&
      ((tag, detail) => this.game.devLog(tag, detail || {}));

    try {
      for (const action of actions) {
        const actionInfo = {
          type: action?.type || "unknown",
          source: ctx?.source?.name || null,
          player: ctx?.player?.id || null,
        };

        // Filter targets by immunity before passing to handler
        // This implements the "skip_targets" default behavior (vs "skip_action")
        const immunityResult = this.filterTargetsByImmunity(
          action,
          ctx,
          targets
        );

        if (immunityResult.skipAction) {
          // immunityMode: "skip_action" was set and some targets were immune
          logDev?.("ACTION_SKIPPED_IMMUNITY", {
            ...actionInfo,
            mode: "skip_action",
            skippedCount: immunityResult.skippedCount,
          });
          continue;
        }

        // Use filtered targets for the handler
        const filteredTargets = immunityResult.filteredTargets;

        // Log if any targets were skipped
        if (immunityResult.skippedCount > 0) {
          logDev?.("ACTION_TARGETS_FILTERED", {
            ...actionInfo,
            skippedCount: immunityResult.skippedCount,
            allowedCount: immunityResult.allowedCount,
          });
        }

        logDev?.("ACTION_START", actionInfo);

        const handler = this.actionHandlers.get(action.type);
        if (!handler) {
          logDev?.("ACTION_HANDLER_MISSING", actionInfo);
          console.warn(
            `No handler for action type "${action.type}". Action skipped.`
          );
          continue;
        }

        try {
          // Pass filtered targets to handler instead of original targets
          const result = await handler(action, ctx, filteredTargets, this);
          executed = result || executed;
          logDev?.("ACTION_HANDLER_DONE", {
            ...actionInfo,
            handler: true,
            result: !!result,
          });
        } catch (error) {
          logDev?.("ACTION_HANDLER_ERROR", {
            ...actionInfo,
            error: error.message,
          });
          console.error(
            `Error executing registered handler for action type "${action.type}":`,
            error
          );
          console.error(`Action config:`, action);
          console.error(`Context:`, {
            player: ctx.player?.id,
            source: ctx.source?.name,
          });
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
    selections = null,
    options = {}
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
      activationContext: options.activationContext || {},
    };

    const optCheck = this.checkOncePerTurn(card, player, effect);
    if (!optCheck.ok) {
      return { ok: false, reason: optCheck.reason };
    }

    const actionCheck = this.checkActionPreviewRequirements(
      effect.actions || [],
      { ...ctx, effect }
    );
    if (!actionCheck.ok) {
      return { ok: false, reason: actionCheck.reason };
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

  /**
   * Preview for Spell/Trap ignition/on_activate effects while on the field.
   */
  canActivateSpellTrapEffectPreview(
    card,
    player,
    activationZone = "spellTrap",
    selections = null,
    options = {}
  ) {
    if (!card || !player) {
      return { ok: false, reason: "Missing card or player." };
    }
    if (card.owner !== player.id) {
      return { ok: false, reason: "Card does not belong to the player." };
    }
    if (card.cardKind !== "spell" && card.cardKind !== "trap") {
      return {
        ok: false,
        reason: "Only Spell/Trap cards can use this effect.",
      };
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

    if (activationZone === "spellTrap") {
      if (!player.spellTrap || !player.spellTrap.includes(card)) {
        return { ok: false, reason: "Card is not in Spell/Trap zone." };
      }
    } else if (activationZone === "fieldSpell") {
      if (player.fieldSpell !== card) {
        return { ok: false, reason: "Card is not in Field Spell zone." };
      }
    }

    if (card.cardKind === "trap") {
      const canActivateTrap =
        typeof this.game?.canActivateTrap === "function"
          ? this.game.canActivateTrap(card)
          : card.isFacedown === true;
      if (!canActivateTrap) {
        return { ok: false, reason: "Trap cannot be activated this turn." };
      }
    } else if (card.cardKind === "spell" && card.isFacedown) {
      return { ok: false, reason: "Card must be face-up to activate." };
    }

    const effect = this.getSpellTrapActivationEffect(card, {
      fromHand: false,
    });
    if (!effect) {
      return { ok: false, reason: "No ignition effect defined for this card." };
    }

    const optCheck = this.checkOncePerTurn(card, player, effect);
    if (!optCheck.ok) return { ok: false, reason: optCheck.reason };

    const opdCheck = this.checkOncePerDuel(card, player, effect);
    if (!opdCheck.ok) return { ok: false, reason: opdCheck.reason };

    const ctx = {
      source: card,
      player,
      opponent: this.game?.getOpponent?.(player),
      activationZone,
      activationContext: options.activationContext || {},
    };

    if (effect.conditions) {
      const condResult = this.evaluateConditions(effect.conditions, ctx);
      if (!condResult.ok) {
        return { ok: false, reason: condResult.reason };
      }
    }

    const actionCheck = this.checkActionPreviewRequirements(
      effect.actions || [],
      { ...ctx, effect }
    );
    if (!actionCheck.ok) {
      return { ok: false, reason: actionCheck.reason };
    }

    const targetResult = this.resolveTargets(
      effect.targets || [],
      ctx,
      selections
    );
    if (targetResult.needsSelection) {
      return { ok: true, needsSelection: true };
    }
    if (targetResult.ok === false) {
      return { ok: false, reason: targetResult.reason };
    }

    return { ok: true };
  }

  /**
   * Preview for Field Spell effects while on the field.
   */
  canActivateFieldSpellEffectPreview(
    card,
    player,
    selections = null,
    options = {}
  ) {
    if (!card || !player) {
      return { ok: false, reason: "Missing card or player." };
    }
    if (card.owner !== player.id) {
      return { ok: false, reason: "Card does not belong to the player." };
    }
    if (card.cardKind !== "spell" || card.subtype !== "field") {
      return { ok: false, reason: "Card is not a Field Spell." };
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
    if (player.fieldSpell !== card) {
      return { ok: false, reason: "Card is not in Field Spell zone." };
    }

    const effect = this.getFieldSpellActivationEffect(card);
    if (!effect) {
      return { ok: false, reason: "No field activation effect defined." };
    }

    const optCheck = this.checkOncePerTurn(card, player, effect);
    if (!optCheck.ok) return { ok: false, reason: optCheck.reason };

    const opdCheck = this.checkOncePerDuel(card, player, effect);
    if (!opdCheck.ok) return { ok: false, reason: opdCheck.reason };

    const ctx = {
      source: card,
      player,
      opponent: this.game?.getOpponent?.(player),
      activationZone: "fieldSpell",
      activationContext: options.activationContext || {},
    };

    if (effect.conditions) {
      const condResult = this.evaluateConditions(effect.conditions, ctx);
      if (!condResult.ok) {
        return { ok: false, reason: condResult.reason };
      }
    }

    const actionCheck = this.checkActionPreviewRequirements(
      effect.actions || [],
      { ...ctx, effect }
    );
    if (!actionCheck.ok) {
      return { ok: false, reason: actionCheck.reason };
    }

    const targetResult = this.resolveTargets(
      effect.targets || [],
      ctx,
      selections
    );
    if (targetResult.needsSelection) {
      return { ok: true, needsSelection: true };
    }
    if (targetResult.ok === false) {
      return { ok: false, reason: targetResult.reason };
    }

    return { ok: true };
  }

  checkActionPreviewRequirements(actions, ctx) {
    if (!Array.isArray(actions) || actions.length === 0) {
      return { ok: true };
    }

    const player = ctx?.player;
    if (!player) {
      return { ok: false, reason: "Missing player." };
    }

    for (const action of actions) {
      if (!action || !action.type) continue;
      if (action.type === "special_summon_from_hand_with_tiered_cost") {
        if ((player.field || []).length >= 5) {
          return { ok: false, reason: "Field is full." };
        }

        const filters = action.costFilters || {
          name: "Void Hollow",
          cardKind: "monster",
        };
        const matchesFilters = (card) => {
          if (!card) return false;
          if (filters.cardKind && card.cardKind !== filters.cardKind) {
            return false;
          }
          if (filters.name && card.name !== filters.name) return false;
          if (filters.archetype) {
            const hasArc =
              card.archetype === filters.archetype ||
              (Array.isArray(card.archetypes) &&
                card.archetypes.includes(filters.archetype));
            if (!hasArc) return false;
          }
          return true;
        };
        const costCandidates = (player.field || []).filter(matchesFilters);
        const minCost = action.minCost ?? 1;
        if (costCandidates.length < minCost) {
          return {
            ok: false,
            reason: "Not enough cost monsters to Special Summon.",
          };
        }
      }

      if (action.type === "conditional_summon_from_hand") {
        // Check field space
        if ((player.field || []).length >= 5) {
          return { ok: false, reason: "Field is full." };
        }

        // Check condition
        const condition = action.condition || {};
        if (condition.type === "control_card") {
          const zoneName = condition.zone || "fieldSpell";
          const cardName = condition.cardName;
          let conditionMet = false;

          if (zoneName === "fieldSpell") {
            conditionMet = player.fieldSpell?.name === cardName;
          } else {
            const zone = player[zoneName] || [];
            conditionMet = zone.some((c) => c && c.name === cardName);
          }

          if (!conditionMet) {
            return {
              ok: false,
              reason: `You must control "${cardName}" to activate this effect.`,
            };
          }
        } else if (condition.type === "control_card_type") {
          const zoneName = condition.zone || "field";
          const typeName = condition.typeName || condition.cardType;

          if (!typeName) {
            return { ok: false, reason: "Invalid condition configuration." };
          }

          const zone = player[zoneName] || [];
          const conditionMet = zone.some((c) => {
            if (!c || c.isFacedown) return false;
            if (Array.isArray(c.types)) {
              return c.types.includes(typeName);
            }
            return c.type === typeName;
          });

          if (!conditionMet) {
            return {
              ok: false,
              reason: `You must control a ${typeName} monster to activate this effect.`,
            };
          }
        }
      }

      if (action.type === "special_summon_from_hand_with_cost") {
        if ((player.field || []).length >= 5) {
          return { ok: false, reason: "Field is full." };
        }

        // Get cost target filter from effect.targets
        const costTargetRef = action.costTargetRef || "bbd_cost";
        const costEffect = ctx?.effect;
        if (!costEffect || !costEffect.targets) {
          return {
            ok: false,
            reason: "Cost targets not defined in effect.",
          };
        }

        const costTarget = costEffect.targets.find(
          (t) => t && t.id === costTargetRef
        );
        if (!costTarget) {
          return {
            ok: false,
            reason: "Cost target definition not found.",
          };
        }

        const requiredCount = costTarget.count?.min || 0;
        const zone = costTarget.zone ? player[costTarget.zone] : player.hand;
        if (!zone) {
          return { ok: false, reason: "Cost zone not found." };
        }

        const filters = costTarget.filters || {};
        const matchesFilters = (card) => {
          if (!card) return false;
          if (filters.type) {
            if (Array.isArray(card.types)) {
              if (!card.types.includes(filters.type)) return false;
            } else if (card.type !== filters.type) {
              return false;
            }
          }
          if (filters.cardKind && card.cardKind !== filters.cardKind) {
            return false;
          }
          return true;
        };

        const validCosts = zone.filter(matchesFilters);
        if (validCosts.length < requiredCount) {
          return {
            ok: false,
            reason: `Need ${requiredCount} ${filters.type || "monster"}(s) in ${
              costTarget.zone || "hand"
            } to activate.`,
          };
        }
      }
    }

    return { ok: true };
  }

  applyDraw(action, ctx) {
    const targetPlayer =
      action.player === "opponent" ? ctx.opponent : ctx.player;
    const amount = action.amount ?? 1;
    if (this.game && typeof this.game.drawCards === "function") {
      const result = this.game.drawCards(targetPlayer, amount);
      if (ctx && result && Array.isArray(result.drawn)) {
        ctx.lastDrawnCards = result.drawn.slice();
      }
      return result?.ok || (result?.drawn?.length || 0) > 0;
    }

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

    // Apply damage to LP only if not in trigger-only mode
    // (inflictDamage from Game already applied the damage)
    if (!action.triggerOnly) {
      targetPlayer.takeDamage(amount);
    }

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

  async applyDestroy(action, ctx, targets) {
    const targetCards = targets?.[action.targetRef] || [];
    let destroyedAny = false;

    for (const card of targetCards) {
      if (!this.game?.destroyCard) continue;

      const result = await this.game.destroyCard(card, {
        cause: "effect",
        sourceCard: ctx?.source || null,
        opponent: ctx?.opponent || null,
      });

      if (result?.destroyed) {
        destroyedAny = true;
        if (typeof this.game.updateBoard === "function") {
          this.game.updateBoard();
        }
        if (typeof this.game.checkWinCondition === "function") {
          this.game.checkWinCondition();
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
        cause: ctx?.cause,
        destroySource: ctx?.source || null,
        fromZone: ctx?.fromZone || null,
      };

      const costSuccess = await this.applyActions(
        effect.negationCost || [],
        negationCtx,
        {}
      );

      if (costSuccess || effect.negationCost?.length === 0) {
        // Register OPT usage for negation
        this.registerOncePerTurnUsage(card, owner, effect);

        if (this.ui?.log) {
          this.ui.log(`${card.name} negated its destruction!`);
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
    if (!this.ui) {
      return false;
    }

    const costDescription = this.getDestructionNegationCostDescription(effect);
    const message = `${card.name} would be destroyed. Negate destruction? Cost: ${costDescription}`;

    return new Promise((resolve) => {
      if (this.ui.showDestructionNegationPrompt) {
        this.ui.showDestructionNegationPrompt(
          card.name,
          costDescription,
          resolve
        );
      } else if (this.ui.showConfirmPrompt) {
        const confirmResult = this.ui.showConfirmPrompt(message, {
          kind: "destruction_negation",
          cardName: card.name,
        });
        if (confirmResult && typeof confirmResult.then === "function") {
          confirmResult.then(resolve);
        } else {
          resolve(!!confirmResult);
        }
      } else {
        resolve(false);
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
        descriptions.push(`reduzir ATK em ${atkReduction}`);
      } else if (action.type === "reduce_self_atk") {
        descriptions.push(`reduzir ATK em ${action.amount ?? 0}`);
      } else if (action.type === "pay_lp") {
        descriptions.push(`pagar ${action.amount} LP`);
      } else if (action.type === "damage") {
        descriptions.push(`sofrer ${action.amount} de dano`);
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
      if (!this.game?.destroyCard) continue;
      const result = await this.game.destroyCard(card, {
        cause: "effect",
        sourceCard,
        opponent: ctx?.opponent || null,
      });
      if (result?.destroyed) {
        destroyedCount += 1;
      }
    }

    // Draw 1 card for each monster destroyed
    let drawnCount = 0;
    if (this.game && typeof this.game.drawCards === "function") {
      const drawResult = this.game.drawCards(player, destroyedCount);
      drawnCount = drawResult?.drawn?.length || 0;
    } else {
      for (let i = 0; i < destroyedCount; i++) {
        player.draw();
        drawnCount += 1;
      }
    }

    if (destroyedCount > 0 && this.game?.updateBoard) {
      this.game.updateBoard();
    }

    if (destroyedCount > 0 && this.ui?.log) {
      this.ui.log(
        `${sourceCard.name} destroyed ${destroyedCount} monster(s) and drew ${drawnCount} card(s)!`
      );
    }

    return destroyedCount > 0;
  }

  async applyDestroyOtherDragonsAndBuff(action, ctx) {
    const player = ctx?.player;
    const sourceCard = ctx?.source;

    if (!player || !sourceCard) {
      console.log("[applyDestroyOtherDragonsAndBuff] missing player/source", {
        player: !!player,
        source: !!sourceCard,
      });
      return false;
    }

    const typeName = action?.typeName || "Dragon";
    const atkPerDestroyed = Number.isFinite(action?.atkPerDestroyed)
      ? action.atkPerDestroyed
      : 200;

    const hasType = (card) => {
      if (!card) return false;
      if (Array.isArray(card.types)) return card.types.includes(typeName);
      return card.type === typeName;
    };

    const othersToDestroy = (player.field || []).filter(
      (card) =>
        card &&
        card !== sourceCard &&
        card.cardKind === "monster" &&
        hasType(card)
    );

    console.log("[applyDestroyOtherDragonsAndBuff] start", {
      source: sourceCard.name,
      field: player.field.map((c) => c && c.name),
      othersToDestroy: othersToDestroy.map((c) => c && c.name),
      typeName,
    });

    let destroyedCount = 0;

    for (const card of othersToDestroy) {
      if (!this.game?.destroyCard) continue;
      const result = await this.game.destroyCard(card, {
        cause: "effect",
        sourceCard,
        opponent: ctx?.opponent || null,
      });
      if (result?.destroyed) {
        destroyedCount += 1;
      }
    }

    console.log(
      "[applyDestroyOtherDragonsAndBuff] destroyedCount",
      destroyedCount
    );

    if (destroyedCount > 0 && atkPerDestroyed !== 0) {
      const atkGain = destroyedCount * atkPerDestroyed;
      const buffKey =
        action?.buffSourceName || `${sourceCard.name}-self-destroy-buff`;
      if (!sourceCard.permanentBuffsBySource) {
        sourceCard.permanentBuffsBySource = {};
      }
      const currentBuff = sourceCard.permanentBuffsBySource[buffKey]?.atk || 0;
      const newBuff = currentBuff + atkGain;
      sourceCard.permanentBuffsBySource[buffKey] = {
        ...(sourceCard.permanentBuffsBySource[buffKey] || {}),
        atk: newBuff,
      };

      const delta = newBuff - currentBuff;
      sourceCard.atk = (sourceCard.atk || 0) + delta;

      console.log("[applyDestroyOtherDragonsAndBuff] applied buff", {
        atkGain,
        destroyedCount,
        newAtk: sourceCard.atk,
      });
    }

    if (destroyedCount > 0 && this.game?.updateBoard) {
      this.game.updateBoard();
    }

    if (this.ui?.log) {
      const gainText =
        destroyedCount > 0
          ? ` and gained ${destroyedCount * atkPerDestroyed} ATK`
          : "";
      this.ui.log(
        `${sourceCard.name} destroyed ${destroyedCount} Dragon(s) you control${gainText}.`
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

  /**
   * Special Summon Token: Create and summon a token monster.
   * Unified semantics: respects action.position (undefined/choice/attack/defense).
   * Uses moveCard pipeline when possible and emits after_summon event.
   */
  async applySpecialSummonToken(action, ctx) {
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

    // Mark as token - this is the canonical flag for token identification
    // Tokens that leave the field are removed from the game entirely (handled in Game.moveCardInternal)
    tokenCard.isToken = true;
    // Optional debug info - not used for logic, only for tracing
    tokenCard.tokenSourceCard = ctx.card?.name || null;

    // UNIFIED POSITION SEMANTICS: respect action.position
    // undefined/null → "choice" (default)
    // "choice" → allow player/bot to choose
    // "attack"/"defense" → forced position
    const position = await this.chooseSpecialSummonPosition(
      tokenCard,
      targetPlayer,
      { position: action.position }
    );

    // Try moveCard first for consistent pipeline
    let moved = false;
    if (this.game && typeof this.game.moveCard === "function") {
      const moveResult = this.game.moveCard(tokenCard, targetPlayer, "field", {
        position,
        isFacedown: false,
        resetAttackFlags: true,
      });
      moved = moveResult?.success === true;
    }

    // Fallback for tokens (not present in any zone initially)
    if (!moved) {
      tokenCard.position = position;
      tokenCard.isFacedown = false;
      tokenCard.hasAttacked = false;
      tokenCard.cannotAttackThisTurn = action.cannotAttackThisTurn !== false; // Default true for tokens
      tokenCard.attacksUsedThisTurn = 0;
      tokenCard.owner = targetPlayer.id;
      tokenCard.controller = targetPlayer.id;

      // Set summonedTurn for consistency with other summons
      if (this.game?.turnCounter) {
        tokenCard.summonedTurn = this.game.turnCounter;
      }

      if (!targetPlayer.field.includes(tokenCard)) {
        targetPlayer.field.push(tokenCard);
      }

      // Emit after_summon event manually (moveCard would do this automatically)
      if (this.game && typeof this.game.emit === "function") {
        await this.game.emit("after_summon", {
          card: tokenCard,
          player: targetPlayer,
          method: "special",
          fromZone: "token",
        });
      }
    }

    if (this.game && typeof this.game.updateBoard === "function") {
      this.game.updateBoard();
    }
    if (this.game && typeof this.game.checkWinCondition === "function") {
      this.game.checkWinCondition();
    }

    return true;
  }

  applyBuffAtkTemp(action, ctx, targets) {
    const targetCards = targets?.[action.targetRef] || [];
    const amount = action.amount ?? 0;
    targetCards.forEach((card) => {
      if (card.isFacedown) return;
      card.atk += amount;
      card.tempAtkBoost = (card.tempAtkBoost || 0) + amount;
    });
    return targetCards.length > 0 && amount !== 0;
  }

  applyModifyStatsTemp(action, ctx, targets) {
    const targetCards = targets?.[action.targetRef] || [];
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

  applyForbidAttackThisTurn(action, ctx, targets) {
    // Se targetRef estÃ¡ definido, usa os alvos selecionados
    // Caso contrÃ¡rio, aplica Ã  carta fonte (self)
    let targetCards = [];
    if (action.targetRef && targets?.[action.targetRef]) {
      targetCards = targets[action.targetRef];
    } else if (ctx && ctx.source) {
      targetCards = [ctx.source];
    }

    targetCards.forEach((card) => {
      card.cannotAttackThisTurn = true;
    });
    return targetCards.length > 0;
  }

  applyForbidAttackNextTurn(action, ctx, targets) {
    let targetCards = [];
    if (action.targetRef && targets?.[action.targetRef]) {
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

    if (this.ui?.log) {
      this.ui.log(
        `${card.name} estÃ¡ imune aos efeitos do oponente atÃ© o final do prÃ³ximo turno.`
      );
    }

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

  showSickleSelectionModal(candidates, maxSelect, onConfirm, onCancel) {
    if (this.ui && typeof this.ui.showSickleSelectionModal === "function") {
      this.ui.showSickleSelectionModal(
        candidates,
        maxSelect,
        onConfirm,
        onCancel
      );
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
    // Resolve targetRef to get the actual cards
    let targetCards = targets[action.targetRef] || [];

    // If targetRef is "self", resolve from ctx.source
    if (action.targetRef === "self" && ctx?.source) {
      targetCards = [ctx.source];
    }

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
      if (this.game?.normalizeCardOwnership) {
        this.game.normalizeCardOwnership(card, ctx, {
          action,
          source: ctx?.source,
          contextLabel: "applyMove",
        });
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

        if (this.ui?.log) {
          this.ui.log(`${card.name} moved to ${toZone}.`);
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

    if (added && this.ui?.log) {
      this.ui.log(
        `Added ${amount} ${counterType} counter(s) to ${
          targetCards[0]?.name || ctx.source?.name || "card"
        }.`
      );
    }

    return added;
  }

  async performBotFusion(ctx, summonableFusions, availableMaterials) {
    // Bot escolhe automaticamente o melhor monstro de fusÃ£o (maior ATK)
    const bestFusion = summonableFusions.reduce((best, current) => {
      const bestAtk = best.fusion.atk || 0;
      const currentAtk = current.fusion.atk || 0;
      return currentAtk > bestAtk ? current : best;
    }, summonableFusions[0]);

    const fusionMonster = bestFusion.fusion;
    const fusionIndex = bestFusion.index;

    // Encontrar materiais vÃ¡lidos
    const combos = this.findFusionMaterialCombos(
      fusionMonster,
      availableMaterials,
      { maxResults: 1, player: ctx.player }
    );

    if (combos.length === 0) {
      this.ui.log(`${ctx.player.name} failed to find valid materials.`);
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
      this.ui.log(`${ctx.player.name} selected invalid materials.`);
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
      this.ui.log(`${ctx.player.name} Fusion Summoned ${fusionMonster.name}!`);
    }

    return success;
  }

  async applyPolymerizationFusion(action, ctx) {
    if (!ctx.player || !this.game) {
      return false;
    }

    // Check if player has Extra Deck with Fusion Monsters
    if (!ctx.player.extraDeck || ctx.player.extraDeck.length === 0) {
      this.ui.log("No Fusion Monsters in Extra Deck.");
      return false;
    }

    // Check field space
    if (ctx.player.field.length >= 5) {
      this.ui.log("Field is full.");
      return false;
    }

    // Get available materials (hand + field)
    const availableMaterials = [
      ...(ctx.player.hand || []),
      ...(ctx.player.field || []),
    ].filter((card) => card && card.cardKind === "monster");

    if (availableMaterials.length === 0) {
      this.ui.log("No monsters available for Fusion Summon.");
      return false;
    }

    // Check which Fusion Monsters can be summoned
    const summonableFusions = this.getAvailableFusions(
      ctx.player.extraDeck,
      availableMaterials,
      ctx.player
    );

    if (summonableFusions.length === 0) {
      this.ui.log(
        "No Fusion Monsters can be summoned with available materials."
      );
      return false;
    }

    // BOT AUTO-FUSION: Se Ã© o bot, executar fusÃ£o automaticamente
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
    this.ui.showFusionTargetModal(
      summonableFusions,
      async (selectedFusionIndex) => {
        const fusionMonster = ctx.player.extraDeck[selectedFusionIndex];

        if (!fusionMonster) {
          this.game.isResolvingEffect = false;
          this.ui.log("Fusion Monster not found.");
          return;
        }

        // Step 2: Highlight valid materials and wait for selection
        const requiredMaterials = this.getFusionRequirements(fusionMonster);

        this.ui.showFusionMaterialSelection(
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
              this.ui.log("Invalid Fusion Materials selected.");
              return;
            }

            const extraCount =
              selectedMaterials.length - validation.requiredCount;
            if (extraCount > 0) {
              this.ui.log(
                `âš ï¸ You selected ${selectedMaterials.length} materials (requires ${validation.requiredCount}). All selected cards will be sent to the Graveyard.`
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
              this.ui.log(
                `Successfully Fusion Summoned ${fusionMonster.name}!`
              );
            }

            this.game.isResolvingEffect = false;
          },
          () => {
            // Cancel callback
            this.game.isResolvingEffect = false;
            this.ui.log("Fusion Summon cancelled.");
          }
        );
      },
      () => {
        this.game.isResolvingEffect = false;
        this.ui.log("Fusion Summon cancelled.");
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
      // Check both card.archetype and card.archetypes (array)
      let hasArchetype = false;
      if (card.archetype === requirement.archetype) {
        hasArchetype = true;
      } else if (
        Array.isArray(card.archetypes) &&
        card.archetypes.includes(requirement.archetype)
      ) {
        hasArchetype = true;
      }

      if (!hasArchetype) return false;

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

  /**
   * Call of the Haunted: Special Summon monster from graveyard.
   * Unified semantics: respects action.position (undefined/choice/attack/defense).
   * Uses moveCard pipeline and emits after_summon event.
   */
  async applyCallOfTheHauntedSummon(action, ctx, targets) {
    const player = ctx.player;
    const card = ctx.source;
    const game = this.game;

    console.log(`[applyCallOfTheHauntedSummon] Called with targets:`, targets);

    if (!targets || !targets.haunted_target) {
      game.ui.log(`Call of the Haunted: Nenhum alvo selecionado no cemitério.`);
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
      game.ui.log(`Call of the Haunted: Alvo inválido.`);
      return false;
    }

    // UNIFIED POSITION SEMANTICS: respect action.position
    // undefined/null → "choice" (default for Call of the Haunted)
    // "choice" → allow player/bot to choose
    // "attack"/"defense" → forced position
    const position = await this.chooseSpecialSummonPosition(
      targetMonster,
      player,
      { position: action.position }
    );

    // Use moveCard for consistent pipeline (handles zones, flags, events)
    let usedMoveCard = false;
    if (game && typeof game.moveCard === "function") {
      const moveResult = game.moveCard(targetMonster, player, "field", {
        fromZone: "graveyard",
        position,
        isFacedown: false,
        resetAttackFlags: true,
      });
      usedMoveCard = moveResult?.success === true;
    }

    // Fallback if moveCard not available or failed
    if (!usedMoveCard) {
      // Manual removal from graveyard
      const gyIndex = player.graveyard.indexOf(targetMonster);
      if (gyIndex > -1) {
        player.graveyard.splice(gyIndex, 1);
      } else {
        console.log(
          `[applyCallOfTheHauntedSummon] Monster not found in graveyard`
        );
      }

      // Manual field addition with consistent flags
      targetMonster.position = position;
      targetMonster.isFacedown = false;
      targetMonster.hasAttacked = false;
      targetMonster.cannotAttackThisTurn = true; // Cannot attack turn summoned
      targetMonster.attacksUsedThisTurn = 0;
      targetMonster.owner = player.id;
      targetMonster.controller = player.id;

      if (!player.field.includes(targetMonster)) {
        player.field.push(targetMonster);
      }

      // Emit after_summon event manually (moveCard would do this automatically)
      if (game && typeof game.emit === "function") {
        await game.emit("after_summon", {
          card: targetMonster,
          player: player,
          method: "special",
          fromZone: "graveyard",
        });
      }
    }

    // Vincular a trap ao monstro para que se destruam mutuamente
    targetMonster.callOfTheHauntedTrap = card;
    card.callOfTheHauntedTarget = targetMonster;

    game.ui.log(
      `Call of the Haunted: ${
        targetMonster.name
      } foi revivido do cemitério em ${
        position === "defense" ? "Defesa" : "Ataque"
      }!`
    );
    game.updateBoard();
    return true;
  }

  async applyMirrorForceDestroy(action, ctx) {
    const { game, player, eventData } = ctx;

    // Determinar quem Ã© o oponente
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
      game.ui.log(
        `Mirror Force: Nenhum monstro em Attack Position para destruir.`
      );
      return false;
    }

    game.ui.log(
      `Mirror Force: Destruindo ${attackPositionMonsters.length} monstro(s) em Attack Position!`
    );

    // Destruir todos os monstros em Attack Position (com substituiÃ§Ã£o de destruiÃ§Ã£o)
    const sourceCard = ctx.source || ctx.card || null;
    for (const monster of attackPositionMonsters) {
      await game.destroyCard(monster, {
        cause: "effect",
        sourceCard,
        opponent: player,
      });
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
      // Executar as aÃ§Ãµes do efeito
      for (const action of relevantEffect.actions || []) {
        await this.applyActions([action], ctx, {});
      }

      return { ok: true };
    } catch (error) {
      console.error("Error resolving trap effects:", error);
      return { ok: false, reason: error.message };
    }
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
