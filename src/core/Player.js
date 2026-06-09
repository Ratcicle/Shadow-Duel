import {
  cardDatabase,
  cardDatabaseById,
  cardDatabaseByName,
} from "../data/cards.js";
import Card from "./Card.js";

export default class Player {
  constructor(id, name, controllerType = "human") {
    this.id = id;
    this.name = name;
    this.controllerType = controllerType; // "human" | "ai"
    this.lp = 8000;
    this.lpGainedThisTurn = 0;
    this.deck = [];
    this.extraDeck = [];
    this.hand = [];
    this.field = [];
    this.spellTrap = [];
    this.graveyard = [];
    this.banished = [];
    this.fieldSpell = null;
    this.summonCount = 0;
    this.additionalNormalSummons = 0; // Extra normal summons granted this turn
    this.forbidDirectAttacksThisTurn = false;
    this.maxDeckSize = 30;
    this.minDeckSize = 20;
    this.maxExtraDeckSize = 10;
    this.oncePerTurnUsageByName = {};
  }

  buildDeck(deckList = null) {
    this.deck = [];
    const maxDeckSize = this.maxDeckSize;
    const minDeckSize = this.minDeckSize || maxDeckSize;
    const copies = {};

    const addCard = (data) => {
      copies[data.id] = copies[data.id] || 0;
      if (copies[data.id] >= 3 || this.deck.length >= maxDeckSize) return;
      this.deck.push(new Card(data, this.id));
      copies[data.id]++;
    };

    const fillWithDefaults = () => {
      const targetSize = Math.max(
        minDeckSize,
        Math.min(maxDeckSize, this.deck.length)
      );
      const archetype = "Shadow-Heart";
      const archetypeCards = cardDatabase.filter((c) => {
        const archetypes = Array.isArray(c.archetypes)
          ? c.archetypes
          : c.archetype
          ? [c.archetype]
          : [];
        return archetypes.includes(archetype);
      });

      for (const data of archetypeCards) {
        addCard(data);
        if (this.deck.length >= targetSize) break;
      }

      while (this.deck.length < targetSize) {
        for (const data of cardDatabase) {
          // Avoid pulling Fusion monsters into the main deck when topping up
          if (data.monsterType === "fusion" || data.monsterType === "ascension")
            continue;
          addCard(data);
          if (this.deck.length >= targetSize) break;
        }
      }
    };

    if (Array.isArray(deckList) && deckList.length > 0) {
      deckList.slice(0, maxDeckSize).forEach((cardId) => {
        const data = cardDatabaseById.get(cardId);
        if (data) {
          addCard(data);
        }
      });

      if (this.deck.length < minDeckSize) {
        fillWithDefaults();
      }
    } else {
      fillWithDefaults();
    }

    this.shuffleDeck();
  }

  buildExtraDeck(extraDeckList = null) {
    this.extraDeck = [];

    const copies = new Set();
    const pushExtraDeckMonster = (data) => {
      if (
        !data ||
        (data.monsterType !== "fusion" && data.monsterType !== "ascension")
      ) {
        return;
      }
      if (copies.has(data.id)) return;
      if (this.extraDeck.length >= this.maxExtraDeckSize) return;
      this.extraDeck.push(new Card(data, this.id));
      copies.add(data.id);
    };

    if (extraDeckList && Array.isArray(extraDeckList)) {
      extraDeckList.forEach((cardId) => {
        const data = cardDatabaseById.get(cardId);
        pushExtraDeckMonster(data);
      });
    }
  }

  shuffleDeck() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  draw() {
    if (this.deck.length > 0) {
      const card = this.deck.pop();
      this.hand.push(card);
      return card;
    }
    return null;
  }

  getTributeRequirement(card) {
    let tributesNeeded = 0;
    if (card.level >= 5 && card.level <= 6) tributesNeeded = 1;
    else if (card.level >= 7) tributesNeeded = 2;

    let usingAlt = false;
    const alt = card.altTribute;

    if (
      alt?.type === "no_tribute_if_empty_field" &&
      this.field.length === 0 &&
      tributesNeeded > 0
    ) {
      tributesNeeded = 0;
      usingAlt = true;
    }

    // Check if player has specific card by name
    if (
      alt?.requiresName &&
      this.field.some((c) => c && c.name === alt.requiresName)
    ) {
      if (alt.tributes < tributesNeeded) {
        tributesNeeded = alt.tributes;
        usingAlt = true;
      }
    }

    // Check if player has card of specific type
    if (alt?.requiresType && !usingAlt) {
      const hasRequiredType = this.field.some((c) => {
        if (!c || c.isFacedown) return false;
        return Array.isArray(c.types)
          ? c.types.includes(alt.requiresType)
          : c.type === alt.requiresType;
      });

      if (hasRequiredType && alt.tributes < tributesNeeded) {
        tributesNeeded = alt.tributes;
        usingAlt = true;
      }
    }

    if (
      typeof card.requiredTributes === "number" &&
      card.requiredTributes >= 0
    ) {
      tributesNeeded = card.requiredTributes;
    }

    return { tributesNeeded, usingAlt, alt };
  }

  async summon(
    cardIndex,
    position = "attack",
    isFacedown = false,
    tributeIndices = null
  ) {
    const card = this.hand[cardIndex];
    const failSummon = (reason, code = "SUMMON_BLOCKED") => {
      this.game?.devLog?.("SUMMON_BLOCKED", {
        summary: reason,
        code,
        player: this.id,
        card: card?.name || null,
      });
      this.game?.ui?.log?.(reason);
      return null;
    };
    if (!card || card.cardKind !== "monster") {
      return failSummon("Only monsters can be summoned.", "NOT_MONSTER");
    }

    if (card.cannotBeNormalSummonedOrSet) {
      return failSummon(
        `${card.name} cannot be Normal Summoned/Set.`,
        "NORMAL_SUMMON_FORBIDDEN",
      );
    }

    if (card.summonRestrict === "shadow_heart_invocation_only") {
      return failSummon(
        `${card.name} cannot be Normal Summoned/Set. It must be Special Summoned by "Shadow-Heart Invocation".`,
        "SPECIAL_SUMMON_ONLY",
      );
    }

    if (this.summonCount >= 1 + this.additionalNormalSummons) {
      return failSummon(
        "Summon limit reached for this turn.",
        "SUMMON_LIMIT_REACHED",
      );
    }

    if (cardIndex >= 0 && cardIndex < this.hand.length) {
      const sendToGrave = async (sacrificed) => {
        if (!sacrificed) return { success: false };
        if (this.game && typeof this.game.moveCard === "function") {
          return await this.game.moveCard(sacrificed, this, "graveyard", {
            fromZone: "field",
            awaitCardToGraveEvent: true,
            contextLabel: "tribute_summon_cost",
          });
        }

        const idx = this.field.indexOf(sacrificed);
        if (idx > -1) {
          this.field.splice(idx, 1);
        }
        this.graveyard.push(sacrificed);
        return { success: true };
      };

      const tributeInfo = this.getTributeRequirement(card);
      let { tributesNeeded, usingAlt, alt } = tributeInfo;

      if (this.field.length < tributesNeeded) {
        return failSummon(
          `Not enough tributes for Level ${card.level} monster.`,
          "NOT_ENOUGH_TRIBUTES",
        );
      }

      // Calculate field state AFTER removing tributes: current field - tributes + new card must be <= 5
      const fieldAfterTributes = this.field.length - tributesNeeded + 1;
      if (fieldAfterTributes > 5) {
        return failSummon("Field is full (max 5 monsters).", "FIELD_FULL");
      }

      const matchesAltRequirement = (c) => {
        if (!c) return false;
        if (alt?.requiresName) return c.name === alt.requiresName;
        if (alt?.requiresType) {
          const types = Array.isArray(c.types) ? c.types : [c.type];
          return types.includes(alt.requiresType);
        }
        return true;
      };

      const tributeCards = [];
      if (tributesNeeded > 0) {
        if (tributeIndices && tributeIndices.length === tributesNeeded) {
          const sortedIndices = [...tributeIndices].sort((a, b) => b - a);
          for (const idx of sortedIndices) {
            if (idx >= 0 && idx < this.field.length) {
              tributeCards.push(this.field[idx]);
            }
          }

          if (tributeCards.length !== tributesNeeded) {
            return failSummon(
              "Invalid tribute selection.",
              "INVALID_TRIBUTE_SELECTION",
            );
          }

          if (usingAlt && alt && !tributeCards.some(matchesAltRequirement)) {
            const requirementLabel = alt.requiresName || alt.requiresType;
            return failSummon(
              `Must tribute ${requirementLabel} to use reduced tribute.`,
              "TRIBUTE_REQUIREMENT_NOT_MET",
            );
          }
        } else if (usingAlt && alt) {
          const altIdx = this.field.findIndex(matchesAltRequirement);
          if (altIdx === -1) {
            const requirementLabel = alt.requiresName || alt.requiresType;
            return failSummon(
              `No ${requirementLabel} available for tribute.`,
              "TRIBUTE_REQUIREMENT_NOT_FOUND",
            );
          }
          tributeCards.push(this.field[altIdx]);
          for (const candidate of this.field) {
            if (tributeCards.length >= tributesNeeded) break;
            if (!candidate || tributeCards.includes(candidate)) continue;
            tributeCards.push(candidate);
          }
        } else {
          for (let i = 0; i < tributesNeeded; i++) {
            tributeCards.push(this.field[i]);
          }
        }

        if (
          tributeCards.length !== tributesNeeded ||
          tributeCards.some((c) => !c)
        ) {
          return failSummon(
            `Not enough valid tributes for Level ${card.level} monster.`,
            "NOT_ENOUGH_VALID_TRIBUTES",
          );
        }
      }

      const summonPosition = position === "defense" ? "defense" : "attack";
      const willBeFacedown =
        isFacedown === true || summonPosition === "defense";
      const limitCheck = this.game?.canPlaceCardOnField?.(card, this, {
        isFacedown: willBeFacedown,
        excludeCards: tributeCards,
      });
      if (limitCheck && limitCheck.ok === false) {
        return failSummon(
          limitCheck.reason || "Field limit prevents this summon.",
          limitCheck.code || "FIELD_LIMIT",
        );
      }

      // Track tributed cards for replay/event system
      const tributedCards = [];
      for (const sacrificed of tributeCards) {
        if (sacrificed) tributedCards.push({ ...sacrificed });
        const tributeResult = await sendToGrave(sacrificed);
        if (tributeResult?.success === false) {
          return failSummon(
            `Could not tribute ${sacrificed?.name || "card"}.`,
            "TRIBUTE_FAILED",
          );
        }
      }

      this.hand.splice(cardIndex, 1);
      card.position = summonPosition;
      // REGRA DO JOGO: defense = sempre facedown (set)
      // facedown = true força defense, e defense força facedown
      card.isFacedown = isFacedown === true || card.position === "defense";
      if (card.isFacedown) {
        card.position = "defense";
      }
      card.hasAttacked = false;
      card.attacksUsedThisTurn = 0;
      card.cannotAttackThisTurn = false; // Normal Summon pode atacar no mesmo turno
      card.positionChangedThisTurn = false;
      card.summonedTurn = this.game?.turnCounter || null;
      this.field.push(card);
      this.summonCount++;

      // 🔧 FIX: Clear targeting cache after Normal Summon to ensure new monsters
      // are visible for field spell effects and other targeting
      if (this.game?.effectEngine?.clearTargetingCache) {
        this.game.effectEngine.clearTargetingCache();
      }

      // Return object with card and tributes for replay/event tracking
      return { card, tributes: tributedCards };
    }
    return null;
  }

  ensureCardOnTop(cardName, createNew = false) {
    if (!createNew) {
      const idx = this.deck.findIndex((card) => card.name === cardName);
      if (idx > -1) {
        const [card] = this.deck.splice(idx, 1);
        this.deck.push(card);
        return card;
      }
    }

    const data = cardDatabaseByName.get(cardName);
    if (!data) {
      return null;
    }

    if (this.deck.length >= this.maxDeckSize) {
      const targetArchetypes = Array.isArray(data.archetypes)
        ? data.archetypes
        : data.archetype
        ? [data.archetype]
        : [];

      let removeIdx = -1;
      // Prefer remover monstros sem arquétipo para não descartar spells/traps importantes (ex: Polymerization)
      const findRemovable = (preferMonsters) =>
        this.deck.findIndex((card) => {
          const archetypes = Array.isArray(card.archetypes)
            ? card.archetypes
            : card.archetype
            ? [card.archetype]
            : [];
          const archetypeMismatch =
            targetArchetypes.length === 0
              ? archetypes.length === 0
              : targetArchetypes.every((arc) => !archetypes.includes(arc));
          const isMonster = card.cardKind === "monster";
          return archetypeMismatch && (!preferMonsters || isMonster);
        });

      removeIdx = findRemovable(true);
      if (removeIdx === -1) {
        removeIdx = findRemovable(false);
      }

      if (removeIdx === -1) {
        removeIdx = 0;
      }

      this.deck.splice(removeIdx, 1);
    }

    const freshCard = new Card(data, this.id);
    this.deck.push(freshCard);
    return freshCard;
  }

  takeDamage(amount) {
    if (!amount || amount <= 0) return;
    const before = this.lp;
    this.lp -= amount;
    if (this.lp < 0) this.lp = 0;
    const actual = Math.max(0, before - this.lp);
    if (actual > 0 && this.game?.ui?.showLpChange) {
      this.game.ui.showLpChange(this, -actual);
    }
    if (actual > 0 && typeof this.game?.queueVisualFeedback === "function") {
      this.game.queueVisualFeedback({
        kind: "damage",
        targetOwnerId: this.id,
        amount: actual,
        tone: "red",
      });
    }
  }

  gainLP(amount) {
    // Apply LP gain multiplier (for effects like Megashield Barbarias)
    const multiplier = this.lpGainMultiplier || 1.0;
    const adjustedAmount = Math.floor(amount * multiplier);
    if (!adjustedAmount || adjustedAmount <= 0) return;
    this.lp += adjustedAmount;
    this.lpGainedThisTurn = (this.lpGainedThisTurn || 0) + adjustedAmount;
    if (this.game?.ui?.showLpChange) {
      this.game.ui.showLpChange(this, adjustedAmount);
    }
    if (typeof this.game?.queueVisualFeedback === "function") {
      this.game.queueVisualFeedback({
        kind: "heal",
        targetOwnerId: this.id,
        amount: adjustedAmount,
        tone: "green",
      });
    }
  }

  /**
   * Calculate and update continuous passive effects from field cards
   * Called by Game.updateBoard()
   */
  updatePassiveEffects() {
    // Reset to defaults
    this.lpGainMultiplier = 1.0;

    // Check for LP gain multiplier passive effects on field monsters
    // Generic implementation - no hardcoded card names
    for (const card of this.field || []) {
      if (!card || card.isFacedown || card.cardKind !== "monster") continue;
      
      for (const effect of card.effects || []) {
        if (!effect || effect.timing !== "passive" || !effect.passive) continue;
        
        if (effect.passive.type === "lp_gain_multiplier") {
          const multiplier = Number(effect.passive.multiplier) || 1.0;
          // Apply the highest multiplier (stacking could be added later)
          this.lpGainMultiplier = Math.max(this.lpGainMultiplier, multiplier);
        }
      }
    }

    // Future: Add more passive effects here
    // Example: this.damageReduction = ...
    // Example: this.extraDraws = ...
  }
}

// Helpers to avoid string-based bot checks
export function isAI(player) {
  return player?.controllerType === "ai";
}

export function isHuman(player) {
  return player?.controllerType !== "ai";
}
