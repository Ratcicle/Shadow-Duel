/**
 * Zone snapshot utilities - capture and restore zone state.
 * Extracted from Game.js as part of B.4 modularization.
 */

/**
 * Create a snapshot of a single card's state.
 * @param {Object} card - The card to snapshot
 * @returns {Object|null} Snapshot of the card state
 */
export function snapshotCardState(card) {
  if (!card) return null;
  const snapshot = { ...card };
  if (card.counters instanceof Map) {
    snapshot.counters = new Map(card.counters);
  }
  if (Array.isArray(card.equips)) {
    snapshot.equips = [...card.equips];
  }
  return snapshot;
}

/**
 * Collect all cards from all zones (player + bot).
 * @returns {Array} Array of all cards
 */
export function collectAllZoneCards() {
  const cards = new Set();
  const addList = (list) => {
    if (!Array.isArray(list)) return;
    list.forEach((card) => {
      if (card) cards.add(card);
    });
  };
  const addPlayer = (player) => {
    if (!player) return;
    addList(player.hand);
    addList(player.field);
    addList(player.spellTrap);
    addList(player.graveyard);
    addList(player.deck);
    addList(player.extraDeck);
    if (player.fieldSpell) {
      cards.add(player.fieldSpell);
    }
  };
  addPlayer(this.player);
  addPlayer(this.bot);
  return [...cards];
}

/**
 * Capture a complete snapshot of all zones for rollback.
 * @param {string} contextLabel - Label for logging
 * @returns {Object} Snapshot object
 */
export function captureZoneSnapshot(contextLabel = "zone_op") {
  const snapshot = {
    contextLabel,
    players: {
      player: {
        hand: [...(this.player?.hand || [])],
        field: [...(this.player?.field || [])],
        spellTrap: [...(this.player?.spellTrap || [])],
        graveyard: [...(this.player?.graveyard || [])],
        deck: [...(this.player?.deck || [])],
        extraDeck: [...(this.player?.extraDeck || [])],
        fieldSpell: this.player?.fieldSpell || null,
      },
      bot: {
        hand: [...(this.bot?.hand || [])],
        field: [...(this.bot?.field || [])],
        spellTrap: [...(this.bot?.spellTrap || [])],
        graveyard: [...(this.bot?.graveyard || [])],
        deck: [...(this.bot?.deck || [])],
        extraDeck: [...(this.bot?.extraDeck || [])],
        fieldSpell: this.bot?.fieldSpell || null,
      },
    },
    cardState: new Map(),
  };

  const cards = this.collectAllZoneCards();
  cards.forEach((card) => {
    const state = this.snapshotCardState(card);
    if (state) {
      snapshot.cardState.set(card, state);
    }
  });

  return snapshot;
}

/**
 * Restore zone state from a snapshot.
 * @param {Object} snapshot - Snapshot to restore
 */
export function restoreZoneSnapshot(snapshot) {
  if (!snapshot) return;
  const restorePlayer = (player, state) => {
    if (!player || !state) return;
    player.hand = [...(state.hand || [])];
    player.field = [...(state.field || [])];
    player.spellTrap = [...(state.spellTrap || [])];
    player.graveyard = [...(state.graveyard || [])];
    player.deck = [...(state.deck || [])];
    player.extraDeck = [...(state.extraDeck || [])];
    player.fieldSpell = state.fieldSpell || null;
  };

  restorePlayer(this.player, snapshot.players?.player);
  restorePlayer(this.bot, snapshot.players?.bot);

  if (snapshot.cardState) {
    snapshot.cardState.forEach((state, card) => {
      if (!card || !state) return;
      Object.keys(state).forEach((key) => {
        if (key === "counters" && state.counters instanceof Map) {
          card.counters = new Map(state.counters);
          return;
        }
        if (key === "equips" && Array.isArray(state.equips)) {
          card.equips = [...state.equips];
          return;
        }
        card[key] = state[key];
      });
    });
  }

  this.normalizeZoneCardOwnership("restoreZoneSnapshot", {
    enforceZoneOwner: true,
  });
}

/**
 * Compare two zone snapshots to check for differences.
 * @param {Object} a - First snapshot
 * @param {Object} b - Second snapshot
 * @param {string} playerKey - Which player to compare ("player" or "bot")
 * @returns {boolean} True if snapshots are equal
 */
export function compareZoneSnapshot(a, b, playerKey = "player") {
  const stateA = a?.players?.[playerKey] || {};
  const stateB = b?.players?.[playerKey] || {};
  const listEqual = (left, right) => {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  };
  return (
    listEqual(stateA.hand || [], stateB.hand || []) &&
    listEqual(stateA.field || [], stateB.field || []) &&
    listEqual(stateA.spellTrap || [], stateB.spellTrap || []) &&
    listEqual(stateA.graveyard || [], stateB.graveyard || []) &&
    listEqual(stateA.deck || [], stateB.deck || []) &&
    listEqual(stateA.extraDeck || [], stateB.extraDeck || []) &&
    (stateA.fieldSpell || null) === (stateB.fieldSpell || null)
  );
}
