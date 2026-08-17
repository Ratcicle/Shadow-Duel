/**
 * cards.js
 *
 * Card-construction and card-data helpers extracted from Game.js.
 *
 * Methods:
 *  - resolveCardData
 *  - createCardForOwner
 *  - setMonsterFacing
 */

import Card from "../../Card.js";
import { cardDatabaseByName, cardDatabaseById } from "../../../data/cards.js";
import type { BattlePosition, RawCardDefinition } from "../../contracts/cards.js";
import type { GamePlayer } from "../../contracts/player.js";
import type { DuelCardId, PlayerId } from "../../contracts/primitives.js";

type CardIdentifier =
  | number
  | string
  | { id?: number; name?: string }
  | null
  | undefined;

interface CardCreationOverrides {
  duelCardId?: number;
  position?: BattlePosition;
  isFacedown?: boolean;
  facedown?: boolean;
  turnSetOn?: number;
  counters?: { readonly [counterType: string]: number };
}

interface CardHelperHost {
  nextDuelCardId: number;
  resolveCardData(identifier: CardIdentifier): RawCardDefinition | null;
  resolvePlayerById(id: PlayerId): GamePlayer;
  ensureDuelCardId?(card: Card): DuelCardId;
}

export function resolveCardData(
  this: CardHelperHost,
  identifier: CardIdentifier,
): RawCardDefinition | null {
  if (identifier && typeof identifier === "object") {
    if (typeof identifier.id === "number") {
      const found = cardDatabaseById.get(identifier.id);
      if (found) return found;
    }
    if (identifier.name) {
      return this.resolveCardData(identifier.name);
    }
  }

  if (typeof identifier === "number") {
    return cardDatabaseById.get(identifier) || null;
  }

  if (typeof identifier !== "string") {
    return null;
  }

  const trimmed = identifier.trim();
  if (!trimmed) return null;

  let data = cardDatabaseByName.get(trimmed);
  if (data) return data;

  const lower = trimmed.toLowerCase();
  for (const [name, item] of cardDatabaseByName.entries()) {
    if (typeof name === "string" && name.toLowerCase() === lower) {
      return item;
    }
  }
  return null;
}

export function createCardForOwner(
  this: CardHelperHost,
  identifier: CardIdentifier,
  owner: PlayerId | GamePlayer,
  overrides: CardCreationOverrides = {},
) {
  const player =
    typeof owner === "string" ? this.resolvePlayerById(owner) : owner;
  if (!player) return null;
  const data = this.resolveCardData(identifier);
  if (!data) return null;

  const card = new Card(data, player.id);
  const overrideDuelCardId = overrides.duelCardId;
  if (typeof overrideDuelCardId === "number" && Number.isInteger(overrideDuelCardId)) {
    Reflect.set(card, "duelCardId", overrideDuelCardId);
    this.nextDuelCardId = Math.max(
      Number(this.nextDuelCardId || 1),
      overrideDuelCardId + 1,
    );
  } else {
    this.ensureDuelCardId?.(card);
  }
  if (overrides.position) {
    card.position = overrides.position === "defense" ? "defense" : "attack";
  }
  if (typeof overrides.isFacedown === "boolean") {
    card.isFacedown = overrides.isFacedown;
  } else if (overrides.facedown === true) {
    card.isFacedown = true;
  }
  if (overrides.turnSetOn != null) {
    card.turnSetOn = overrides.turnSetOn;
  }
  if (overrides.counters && card.counters instanceof Map) {
    Object.entries(overrides.counters).forEach(([type, amount]) => {
      if (typeof amount === "number" && amount > 0) {
        card.counters.set(type, amount);
      }
    });
  }
  return card;
}

export function setMonsterFacing(
  card: Card | null | undefined,
  options: { position?: BattlePosition; facedown?: boolean } = {},
) {
  if (!card || card.cardKind !== "monster") return;
  if (options.position) {
    card.position = options.position === "defense" ? "defense" : "attack";
  }
  if (typeof options.facedown === "boolean") {
    card.isFacedown = options.facedown;
  }
  if (card.isFacedown) {
    card.position = "defense";
  }
  if (card.position !== "attack" && card.position !== "defense") {
    card.position = "attack";
  }
  if (typeof card.isFacedown !== "boolean") {
    card.isFacedown = false;
  }
}
