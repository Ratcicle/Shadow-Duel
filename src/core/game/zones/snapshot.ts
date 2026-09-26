/**
 * Zone snapshot utilities - capture and restore zone state.
 * Extracted from Game.js as part of B.4 modularization.
 */

import type { GameCard } from "../../contracts/cards.js";
import type {
  CardStateSnapshot,
  GameZonesHost,
  ZonePlayerSnapshot,
  ZoneSnapshot,
  SummonTransaction,
  TemporaryControlEffect,
} from "../../contracts/gameRuntime.js";
import type { GamePlayer } from "../../contracts/player.js";

interface ZoneSnapshotHost extends GameZonesHost {
  temporaryControlEffects?: TemporaryControlEffect[];
  normalizeZoneCardOwnership(
    contextLabel?: string,
    options?: { enforceZoneOwner?: boolean },
  ): void;
}

/**
 * Create a snapshot of a single card's state.
 * @param card - The card to snapshot
 * @returns Snapshot of the card state
 */
export function snapshotCardState(
  card: GameCard | null | undefined,
): CardStateSnapshot | null {
  if (!card) return null;
  const snapshot = { ...card };
  // Capture the initial epoch too, so the first rolled-back departure cannot reset soft OPT.
  snapshot.oncePerTurnResetVersion = card.oncePerTurnResetVersion || 0;
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
export function collectAllZoneCards(this: GameZonesHost & { activeSummonTransaction?: SummonTransaction | null }): GameCard[] {
  const cards = new Set<GameCard>();
  const addList = (list: GameCard[] | null | undefined) => {
    if (!Array.isArray(list)) return;
    list.forEach((card) => {
      if (card) cards.add(card);
    });
  };
  const addPlayer = (player: GamePlayer | null | undefined) => {
    if (!player) return;
    addList(player.hand);
    addList(player.field);
    addList(player.spellTrap);
    addList(player.graveyard);
    addList(player.banished);
    addList(player.deck);
    addList(player.extraDeck);
    if (player.fieldSpell) {
      cards.add(player.fieldSpell);
    }
  };
  addPlayer(this.player);
  addPlayer(this.bot);
  // Flip Summon temporarily removes its card from the compact field list.
  if (this.activeSummonTransaction?.card) cards.add(this.activeSummonTransaction.card);
  return [...cards];
}

/**
 * Capture a complete snapshot of all zones for rollback.
 * @param {string} contextLabel - Label for logging
 * @returns Snapshot object
 */
export function captureZoneSnapshot(
  this: GameZonesHost & { temporaryControlEffects?: TemporaryControlEffect[] },
  contextLabel = "zone_op",
): ZoneSnapshot {
  const snapshot: ZoneSnapshot = {
    contextLabel,
    temporaryControlEffects: (this.temporaryControlEffects || []).map((record) => ({ ...record })),
    players: {
      player: {
        hand: [...(this.player?.hand || [])],
        field: [...(this.player?.field || [])],
        spellTrap: [...(this.player?.spellTrap || [])],
        graveyard: [...(this.player?.graveyard || [])],
        banished: [...(this.player?.banished || [])],
        deck: [...(this.player?.deck || [])],
        extraDeck: [...(this.player?.extraDeck || [])],
        fieldSpell: this.player?.fieldSpell || null,
      },
      bot: {
        hand: [...(this.bot?.hand || [])],
        field: [...(this.bot?.field || [])],
        spellTrap: [...(this.bot?.spellTrap || [])],
        graveyard: [...(this.bot?.graveyard || [])],
        banished: [...(this.bot?.banished || [])],
        deck: [...(this.bot?.deck || [])],
        extraDeck: [...(this.bot?.extraDeck || [])],
        fieldSpell: this.bot?.fieldSpell || null,
      },
    },
    cardState: new Map<GameCard, CardStateSnapshot>(),
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

/** Commit completed response effects to the rollback baseline of the entrant.
 * The entrant is still in transit, so restore only its original source in the
 * snapshot, without putting it back into the live duel or undoing paid costs.
 */
export function checkpointZoneSnapshotAfterResponse(
  game: Pick<GameZonesHost, "zoneOpSnapshot" | "zoneOpDepth" | "captureZoneSnapshot">,
  entrant: GameCard,
): void {
  const before = game.zoneOpSnapshot;
  if (game.zoneOpDepth !== 1 || !before) return;
  const checkpoint = game.captureZoneSnapshot(before.contextLabel);
  const zones = ["hand", "field", "spellTrap", "graveyard", "banished", "deck", "extraDeck"] as const;
  const owners = ["player", "bot"] as const;
  const isAlreadyPlaced = owners.some((owner) => {
    const side = checkpoint.players[owner];
    return side.fieldSpell === entrant || zones.some((zone) => side[zone].includes(entrant));
  });
  if (!isAlreadyPlaced) {
    for (const owner of owners) {
      const source = before.players[owner];
      const target = checkpoint.players[owner];
      if (source.fieldSpell === entrant) target.fieldSpell = entrant;
      for (const zone of zones) {
        const index = source[zone].indexOf(entrant);
        if (index >= 0) target[zone].splice(Math.min(index, target[zone].length), 0, entrant);
      }
    }
    const sourceState = before.cardState.get(entrant);
    if (sourceState) checkpoint.cardState.set(entrant, sourceState);
    else checkpoint.cardState.delete(entrant);
  }
  game.zoneOpSnapshot = checkpoint;
}

/**
 * Restore zone state from a snapshot.
 * @param snapshot - Snapshot to restore
 */
export function restoreZoneSnapshot(
  this: ZoneSnapshotHost,
  snapshot: ZoneSnapshot | null | undefined,
) {
  if (!snapshot) return;
  this.temporaryControlEffects = snapshot.temporaryControlEffects.map((record) => ({ ...record }));
  // Newly created cards (including Tokens) may outlive references held by an
  // interrupted procedure; they must not retain an abandoned occupied slot.
  for (const card of this.collectAllZoneCards()) {
    if (!snapshot.cardState.has(card)) card.fieldSlot = null;
  }
  const restorePlayer = (
    player: GamePlayer | null | undefined,
    state: ZonePlayerSnapshot | null | undefined,
  ) => {
    if (!player || !state) return;
    player.hand = [...(state.hand || [])];
    player.field = [...(state.field || [])];
    player.spellTrap = [...(state.spellTrap || [])];
    player.graveyard = [...(state.graveyard || [])];
    player.banished = [...(state.banished || [])];
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
        Reflect.set(card, key, Reflect.get(state, key));
      });
    });
  }

  this.normalizeZoneCardOwnership("restoreZoneSnapshot", {
    enforceZoneOwner: true,
  });
}

/**
 * Compare two zone snapshots to check for differences.
 * @param a - First snapshot
 * @param b - Second snapshot
 * @param {string} playerKey - Which player to compare ("player" or "bot")
 * @returns {boolean} True if snapshots are equal
 */
export function compareZoneSnapshot(
  a: ZoneSnapshot | null | undefined,
  b: ZoneSnapshot | null | undefined,
  playerKey: "player" | "bot" = "player",
): boolean {
  const stateA: Partial<ZonePlayerSnapshot> = a?.players?.[playerKey] || {};
  const stateB: Partial<ZonePlayerSnapshot> = b?.players?.[playerKey] || {};
  const listEqual = (
    left: readonly GameCard[] | null | undefined,
    right: readonly GameCard[] | null | undefined,
  ) => {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return false;
      const card = left[i];
      if (card && a?.cardState.get(card)?.fieldSlot !== b?.cardState.get(card)?.fieldSlot) return false;
    }
    return true;
  };
  return (
    listEqual(stateA?.hand || [], stateB?.hand || []) &&
    listEqual(stateA?.field || [], stateB?.field || []) &&
    listEqual(stateA?.spellTrap || [], stateB?.spellTrap || []) &&
    listEqual(stateA?.graveyard || [], stateB?.graveyard || []) &&
    listEqual(stateA?.banished || [], stateB?.banished || []) &&
    listEqual(stateA?.deck || [], stateB?.deck || []) &&
    listEqual(stateA?.extraDeck || [], stateB?.extraDeck || []) &&
    (stateA?.fieldSpell || null) === (stateB?.fieldSpell || null)
  );
}
