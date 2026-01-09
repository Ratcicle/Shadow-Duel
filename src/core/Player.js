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
    this.deck = [];
    this.extraDeck = [];
    this.hand = [];
    this.field = [];
    this.spellTrap = [];
    this.graveyard = [];
    this.fieldSpell = null;
    this.summonCount = 0;
    this.additionalNormalSummons = 0; // Extra normal summons granted this turn
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

  summon(
    cardIndex,
    position = "attack",
    isFacedown = false,
    tributeIndices = null
  ) {
    const card = this.hand[cardIndex];
    if (!card || card.cardKind !== "monster") {
      console.log("Only monsters can be summoned.");
      return null;
    }

    if (card.cannotBeNormalSummonedOrSet) {
      console.log(`${card.name} cannot be Normal Summoned/Set.`);
      if (this.game?.ui?.log) {
        this.game.ui.log(`${card.name} cannot be Normal Summoned/Set.`);
      }
      return null;
    }

    if (card.summonRestrict === "shadow_heart_invocation_only") {
      console.log(
        `${card.name} cannot be Normal Summoned/Set. It must be Special Summoned by "Shadow-Heart Invocation".`
      );
      return null;
    }

    if (this.summonCount >= 1 + this.additionalNormalSummons) {
      console.log("Summon limit reached for this turn.");
      return null;
    }

    if (cardIndex >= 0 && cardIndex < this.hand.length) {
      const sendToGrave = (sacrificed) => {
        if (!sacrificed) return;
        if (this.game && typeof this.game.moveCard === "function") {
          this.game.moveCard(sacrificed, this, "graveyard");
          return;
        }

        const idx = this.field.indexOf(sacrificed);
        if (idx > -1) {
          this.field.splice(idx, 1);
        }
        this.graveyard.push(sacrificed);
      };

      const tributeInfo = this.getTributeRequirement(card);
      let { tributesNeeded, usingAlt, alt } = tributeInfo;

      if (this.field.length < tributesNeeded) {
        console.log(`Not enough tributes for Level ${card.level} monster.`);
        return null;
      }

      // Calculate field state AFTER removing tributes: current field - tributes + new card must be <= 5
      const fieldAfterTributes = this.field.length - tributesNeeded + 1;
      if (fieldAfterTributes > 5) {
        console.log("Field is full (max 5 monsters).");
        if (this.game?.ui?.log) {
          this.game.ui.log("Field is full (max 5 monsters).");
        }
        return null;
      }

      if (tributesNeeded > 0) {
        if (tributeIndices && tributeIndices.length === tributesNeeded) {
          const sortedIndices = [...tributeIndices].sort((a, b) => b - a);
          const tributes = [];
          for (const idx of sortedIndices) {
            if (idx >= 0 && idx < this.field.length) {
              tributes.push(this.field[idx]);
            }
          }

          const matchesAltRequirement = (c) => {
            if (!c) return false;
            if (alt.requiresName) return c.name === alt.requiresName;
            if (alt.requiresType) {
              const types = Array.isArray(c.types) ? c.types : [c.type];
              return types.includes(alt.requiresType);
            }
            return true;
          };

          if (usingAlt && alt && !tributes.some(matchesAltRequirement)) {
            const requirementLabel = alt.requiresName || alt.requiresType;
            console.log(
              `Must tribute ${requirementLabel} to use reduced tribute.`
            );
            return null;
          }

          tributes.forEach((sacrificed) => sendToGrave(sacrificed));
        } else {
          if (usingAlt && alt) {
            const matchesAltRequirement = (c) => {
              if (!c) return false;
              if (alt.requiresName) return c.name === alt.requiresName;
              if (alt.requiresType) {
                const types = Array.isArray(c.types) ? c.types : [c.type];
                return types.includes(alt.requiresType);
              }
              return true;
            };

            const altIdx = this.field.findIndex(matchesAltRequirement);
            if (altIdx === -1) {
              const requirementLabel = alt.requiresName || alt.requiresType;
              console.log(`No ${requirementLabel} available for tribute.`);
              return null;
            }
            const sacrificed = this.field[altIdx];
            sendToGrave(sacrificed);
          } else {
            for (let i = 0; i < tributesNeeded; i++) {
              const sacrificed = this.field[0];
              sendToGrave(sacrificed);
            }
          }
        }
      }

      this.hand.splice(cardIndex, 1);
      card.position = position === "defense" ? "defense" : "attack";
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
      return card;
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
  }

  gainLP(amount) {
    // Apply LP gain multiplier (for effects like Megashield Barbarias)
    const multiplier = this.lpGainMultiplier || 1.0;
    const adjustedAmount = Math.floor(amount * multiplier);
    if (!adjustedAmount || adjustedAmount <= 0) return;
    this.lp += adjustedAmount;
    if (this.game?.ui?.showLpChange) {
      this.game.ui.showLpChange(this, adjustedAmount);
    }
  }

  /**
   * Calculate and update continuous passive effects from field cards
   * Called by Game.updateBoard()
   */
  updatePassiveEffects() {
    // Reset to defaults
    this.lpGainMultiplier = 1.0;

    // Check for Megashield Barbarias LP doubling passive
    const hasMegashieldBarbarias = (this.field || []).some(
      (card) =>
        card &&
        !card.isFacedown &&
        card.cardKind === "monster" &&
        card.name === "Luminarch Megashield Barbarias"
    );

    if (hasMegashieldBarbarias) {
      this.lpGainMultiplier = 2.0;
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
