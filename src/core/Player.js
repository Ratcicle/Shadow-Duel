import { cardDatabase } from "../data/cards.js";
import Card from "./Card.js";

export default class Player {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.lp = 8000;
    this.deck = [];
    this.hand = [];
    this.field = [];
    this.graveyard = [];
    this.summonCount = 0;
    this.maxDeckSize = 30;
  }

  buildDeck(deckList = null) {
    this.deck = [];
    const maxDeckSize = this.maxDeckSize;

    if (Array.isArray(deckList) && deckList.length > 0) {
      deckList.slice(0, maxDeckSize).forEach((cardId) => {
        const data = cardDatabase.find((c) => c.id === cardId);
        if (data) {
          this.deck.push(new Card(data, this.id));
        }
      });
    } else {
      const copies = {};
      while (this.deck.length < maxDeckSize) {
        for (const data of cardDatabase) {
          copies[data.id] = copies[data.id] || 0;
          if (copies[data.id] < 3 && this.deck.length < maxDeckSize) {
            this.deck.push(new Card(data, this.id));
            copies[data.id]++;
          }
        }
      }
    }

    this.shuffleDeck();
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
    if (alt && this.field.some((c) => c.name === alt.requiresName)) {
      if (alt.tributes < tributesNeeded) {
        tributesNeeded = alt.tributes;
        usingAlt = true;
      }
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

    if (card.summonRestrict === "shadow_heart_invocation_only") {
      console.log(
        `${card.name} cannot be Normal Summoned/Set. It must be Special Summoned by "Shadow-Heart Invocation".`
      );
      return null;
    }

    if (this.summonCount >= 1) {
      console.log("Summon limit reached for this turn.");
      return null;
    }

    if (this.field.length >= 5) {
      console.log("Field is full (max 5 monsters).");
      return null;
    }

    if (cardIndex >= 0 && cardIndex < this.hand.length) {
      const tributeInfo = this.getTributeRequirement(card);
      let { tributesNeeded, usingAlt, alt } = tributeInfo;

      if (this.field.length < tributesNeeded) {
        console.log(`Not enough tributes for Level ${card.level} monster.`);
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

          if (usingAlt && alt && !tributes.some((t) => t.name === alt.requiresName)) {
            console.log(`Must tribute ${alt.requiresName} to use reduced tribute.`);
            return null;
          }

          for (const idx of sortedIndices) {
            const sacrificed = this.field.splice(idx, 1)[0];
            this.graveyard.push(sacrificed);
          }
        } else {
          if (usingAlt && alt) {
            const altIdx = this.field.findIndex((c) => c.name === alt.requiresName);
            if (altIdx === -1) {
              console.log(`No ${alt.requiresName} available for tribute.`);
              return null;
            }
            const sacrificed = this.field.splice(altIdx, 1)[0];
            this.graveyard.push(sacrificed);
          } else {
            for (let i = 0; i < tributesNeeded; i++) {
              const sacrificed = this.field.shift();
              this.graveyard.push(sacrificed);
            }
          }
        }
      }

      this.hand.splice(cardIndex, 1);
      card.position = position;
      card.isFacedown = isFacedown;
      card.hasAttacked = false;
      this.field.push(card);
      this.summonCount++;
      return card;
    }
    return null;
  }

  ensureCardOnTop(cardName) {
    const idx = this.deck.findIndex((card) => card.name === cardName);
    if (idx > -1) {
      const [card] = this.deck.splice(idx, 1);
      this.deck.push(card);
      return card;
    }

    const data = cardDatabase.find((c) => c.name === cardName);
    if (!data) {
      return null;
    }

    if (this.deck.length >= this.maxDeckSize) {
      this.deck.shift();
    }

    const freshCard = new Card(data, this.id);
    this.deck.push(freshCard);
    return freshCard;
  }

  takeDamage(amount) {
    this.lp -= amount;
    if (this.lp < 0) this.lp = 0;
  }

  gainLP(amount) {
    this.lp += amount;
  }
}






