import Card from "./Card.js";
import { cardDatabase } from "../data/cards.js";
import { getCardDisplayName } from "./i18n.js";
import { isAI } from "./Player.js";
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

// Effect sub-modules
import * as fusion from "./effects/fusion/index.js";
import * as targeting from "./effects/targeting/index.js";
import * as triggers from "./effects/triggers/index.js";
import * as actions from "./effects/actions/index.js";
import * as activation from "./effects/activation/index.js";

export default class EffectEngine {
  constructor(game) {
    this.game = game;

    // Initialize action handler registry
    this.actionHandlers = new ActionHandlerRegistry();
    registerDefaultHandlers(this.actionHandlers);

    // Cache de targeting para evitar buscas redundantes
    // Formato: { "cacheKey": { zoneName, candidates, timestamp } }
    this._targetingCache = new Map();
    this._targetingCacheHits = 0;
    this._targetingCacheMisses = 0;

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
   * Limpa o cache de targeting. Deve ser chamado:
   * - No início de cada turno
   * - Após ações que modificam o estado do jogo (summon, destroy, move)
   */
  clearTargetingCache() {
    if (this._targetingCache) {
      this._targetingCache.clear();
    }
  }

  /**
   * Log de estatísticas do cache (para debug).
   */
  logTargetingCacheStats() {
    const hits = this._targetingCacheHits || 0;
    const misses = this._targetingCacheMisses || 0;
    const total = hits + misses;
    if (total > 0) {
      const hitRate = ((hits / total) * 100).toFixed(1);
      console.log(
        `[TargetingCache] Hits: ${hits} | Misses: ${misses} | Hit Rate: ${hitRate}%`
      );
    }
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

    // CHOICE ALLOWED: AI auto-selects "attack"
    if (isAI(player)) {
      this.game?.devLog?.("SS_POSITION", {
        summary: `Bot auto-chooses attack for ${card?.name || "unknown"}`,
        player: player?.id,
        card: card?.name,
        actionPosition,
        allowsChoice: true,
      });
      return "attack";
    }

    // Player gets modal for position choice
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

    // Fallback: default to "attack" if no UI available (offline only)
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

        // Passive: buff based on count of a monster type in controller's graveyard
        if (passive.type === "graveyard_type_count_buff") {
          const typeName = passive.typeName || passive.monsterType || null;
          if (!typeName) return;

          const owner = this.getOwnerByCard(card);
          const gy = owner?.graveyard || [];
          const typeCount = gy.filter((c) => {
            if (!c || c.cardKind !== "monster") return false;
            const cardTypes = Array.isArray(c.types) ? c.types : [c.type];
            return cardTypes.includes(typeName);
          }).length;

          const perCard =
            passive.amountPerCard ??
            passive.perCard ??
            passive.buffPerCard ??
            0;
          const stats = passive.stats || ["atk", "def"];
          const buffKey = effect.id || `passive_${card.id}_${index}_gy_type`;
          const applied = this.applyPassiveBuffValue(
            card,
            buffKey,
            typeCount * perCard,
            stats
          );
          if (applied) updated = true;
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
}

// ============================================================
// Fusion Module - Prototype Assignments
// ============================================================
EffectEngine.prototype.matchesFusionRequirement =
  fusion.matchesFusionRequirement;
EffectEngine.prototype.getFusionRequirements = fusion.getFusionRequirements;
EffectEngine.prototype.getFusionRequiredCount = fusion.getFusionRequiredCount;
EffectEngine.prototype.getRequiredMaterialCount =
  fusion.getRequiredMaterialCount;
EffectEngine.prototype.findFusionMaterialCombos =
  fusion.findFusionMaterialCombos;
EffectEngine.prototype.evaluateFusionSelection = fusion.evaluateFusionSelection;
EffectEngine.prototype.canSummonFusion = fusion.canSummonFusion;
EffectEngine.prototype.getAvailableFusions = fusion.getAvailableFusions;
EffectEngine.prototype.performBotFusion = fusion.performBotFusion;
EffectEngine.prototype.applyPolymerizationFusion =
  fusion.applyPolymerizationFusion;

// ============================================================
// Targeting Module - Prototype Assignments
// ============================================================
EffectEngine.prototype.getZone = targeting.getZone;
EffectEngine.prototype.findCardZone = targeting.findCardZone;
EffectEngine.prototype.getOwnerByCard = targeting.getOwnerByCard;
EffectEngine.prototype.buildSelectionCandidateKey =
  targeting.buildSelectionCandidateKey;
EffectEngine.prototype.selectCandidates = targeting.selectCandidates;
EffectEngine.prototype.resolveTargets = targeting.resolveTargets;
EffectEngine.prototype.checkImmunity = targeting.checkImmunity;
EffectEngine.prototype.isImmuneToOpponentEffects =
  targeting.isImmuneToOpponentEffects;
EffectEngine.prototype.filterCardsListByImmunity =
  targeting.filterCardsListByImmunity;
EffectEngine.prototype.filterTargetsByImmunity =
  targeting.filterTargetsByImmunity;
EffectEngine.prototype.inferEffectType = targeting.inferEffectType;
EffectEngine.prototype.shouldSkipActionDueToImmunity =
  targeting.shouldSkipActionDueToImmunity;

// ============================================================
// Triggers Module - Prototype Assignments
// ============================================================
EffectEngine.prototype.registerOncePerDuelUsage =
  triggers.registerOncePerDuelUsage;
EffectEngine.prototype.registerOncePerTurnUsage =
  triggers.registerOncePerTurnUsage;
EffectEngine.prototype.handleSpecialSummonTypeCounters =
  triggers.handleSpecialSummonTypeCounters;
EffectEngine.prototype.handleFieldPresenceTypeSummonCounters =
  triggers.handleFieldPresenceTypeSummonCounters;
EffectEngine.prototype.assignFieldPresenceId = triggers.assignFieldPresenceId;
EffectEngine.prototype.clearFieldPresenceId = triggers.clearFieldPresenceId;
EffectEngine.prototype.handleTriggeredEffect = triggers.handleTriggeredEffect;
EffectEngine.prototype.buildTriggerActivationContext =
  triggers.buildTriggerActivationContext;
EffectEngine.prototype.buildTriggerEntry = triggers.buildTriggerEntry;
EffectEngine.prototype.collectEventTriggers = triggers.collectEventTriggers;
EffectEngine.prototype.collectAfterSummonTriggers =
  triggers.collectAfterSummonTriggers;
EffectEngine.prototype.collectBattleDestroyTriggers =
  triggers.collectBattleDestroyTriggers;
EffectEngine.prototype.collectAttackDeclaredTriggers =
  triggers.collectAttackDeclaredTriggers;
EffectEngine.prototype.collectEffectTargetedTriggers =
  triggers.collectEffectTargetedTriggers;
EffectEngine.prototype.collectCardToGraveTriggers =
  triggers.collectCardToGraveTriggers;
EffectEngine.prototype.collectStandbyPhaseTriggers =
  triggers.collectStandbyPhaseTriggers;

// ============================================================
// Actions Module - Prototype Assignments
// ============================================================
// Core dispatcher
EffectEngine.prototype.applyActions = actions.applyActions;
EffectEngine.prototype.checkActionPreviewRequirements =
  actions.checkActionPreviewRequirements;
// Resources
EffectEngine.prototype.applyDraw = actions.applyDraw;
EffectEngine.prototype.applyHeal = actions.applyHeal;
EffectEngine.prototype.applyHealPerArchetypeMonster =
  actions.applyHealPerArchetypeMonster;
EffectEngine.prototype.applyDamage = actions.applyDamage;
// Destroy
EffectEngine.prototype.applyDestroy = actions.applyDestroy;
EffectEngine.prototype.checkBeforeDestroyNegations =
  actions.checkBeforeDestroyNegations;
EffectEngine.prototype.promptForDestructionNegation =
  actions.promptForDestructionNegation;
EffectEngine.prototype.getDestructionNegationCostDescription =
  actions.getDestructionNegationCostDescription;
EffectEngine.prototype.applyDestroyAllOthersAndDraw =
  actions.applyDestroyAllOthersAndDraw;
EffectEngine.prototype.applyDestroyOtherDragonsAndBuff =
  actions.applyDestroyOtherDragonsAndBuff;
EffectEngine.prototype.applyMirrorForceDestroy =
  actions.applyMirrorForceDestroy;
// Combat
EffectEngine.prototype.applyNegateAttack = actions.applyNegateAttack;
EffectEngine.prototype.applyForbidAttackThisTurn =
  actions.applyForbidAttackThisTurn;
EffectEngine.prototype.applyForbidAttackNextTurn =
  actions.applyForbidAttackNextTurn;
EffectEngine.prototype.applyAllowDirectAttackThisTurn =
  actions.applyAllowDirectAttackThisTurn;
// Summon
EffectEngine.prototype.applySpecialSummonToken =
  actions.applySpecialSummonToken;
EffectEngine.prototype.applyCallOfTheHauntedSummon =
  actions.applyCallOfTheHauntedSummon;
// Stats
EffectEngine.prototype.applyBuffAtkTemp = actions.applyBuffAtkTemp;
EffectEngine.prototype.applyModifyStatsTemp = actions.applyModifyStatsTemp;
// Equip
EffectEngine.prototype.applyEquip = actions.applyEquip;
EffectEngine.prototype.showSickleSelectionModal =
  actions.showSickleSelectionModal;
// Movement
EffectEngine.prototype.applyMove = actions.applyMove;
// Counters
EffectEngine.prototype.applyAddCounter = actions.applyAddCounter;
// Immunity
EffectEngine.prototype.applyGrantVoidFusionImmunity =
  actions.applyGrantVoidFusionImmunity;

// ============================================================
// Activation Module - Prototype Assignments
// ============================================================
// Getters
EffectEngine.prototype.getHandActivationEffect =
  activation.getHandActivationEffect;
EffectEngine.prototype.getSpellTrapActivationEffect =
  activation.getSpellTrapActivationEffect;
EffectEngine.prototype.getMonsterIgnitionEffect =
  activation.getMonsterIgnitionEffect;
EffectEngine.prototype.getFieldSpellActivationEffect =
  activation.getFieldSpellActivationEffect;
// Execution
EffectEngine.prototype.activateMonsterFromGraveyard =
  activation.activateMonsterFromGraveyard;
EffectEngine.prototype.activateFieldSpell = activation.activateFieldSpell;
EffectEngine.prototype.activateSpellTrapEffect =
  activation.activateSpellTrapEffect;
EffectEngine.prototype.activateMonsterEffect = activation.activateMonsterEffect;
// Preview
EffectEngine.prototype.hasActivatableGraveyardEffect =
  activation.hasActivatableGraveyardEffect;
EffectEngine.prototype.canActivate = activation.canActivate;
EffectEngine.prototype.canActivateSpellFromHandPreview =
  activation.canActivateSpellFromHandPreview;
EffectEngine.prototype.canActivateMonsterEffectPreview =
  activation.canActivateMonsterEffectPreview;
EffectEngine.prototype.canActivateSpellTrapEffectPreview =
  activation.canActivateSpellTrapEffectPreview;
EffectEngine.prototype.canActivateFieldSpellEffectPreview =
  activation.canActivateFieldSpellEffectPreview;
