/**
 * Zone ownership utilities - player ID normalization and card ownership.
 * Extracted from Game.js as part of B.4 modularization.
 */

import type { GameCard } from "../../contracts/cards.js";
import type { GameCoreHost } from "../../contracts/gameRuntime.js";
import type { GamePlayer } from "../../contracts/player.js";
import type { CanonicalZone } from "../../contracts/zones.js";

type RelativePlayerId = string | null | undefined;

interface OwnershipHost extends GameCoreHost {
  devModeEnabled: boolean;
  devLog(code: string, detail?: unknown): void;
  getOpponent(player: GamePlayer | null): GamePlayer | null;
  normalizeRelativePlayerId(
    value: RelativePlayerId,
    context: OwnershipContext,
    meta?: OwnershipMeta,
  ): RelativePlayerId;
  normalizeCardOwnership(
    card: GameCard | null | undefined,
    context: OwnershipContext,
    meta?: OwnershipMeta,
  ): void;
}

interface OwnershipContext {
  player?: GamePlayer | null;
  opponent?: GamePlayer | null;
}

interface OwnershipActionReference {
  id?: string;
  type?: string;
}

interface OwnershipMeta {
  selfId?: string | null;
  opponentId?: string | null;
  card?: GameCard | null;
  cardName?: string;
  action?: OwnershipActionReference | string | null;
  field?: string;
  contextLabel?: string;
  enforceZoneOwner?: boolean;
  zoneOwnerId?: string | null;
  zone?: CanonicalZone;
}

interface NormalizeZoneOwnershipOptions {
  enforceZoneOwner?: boolean;
}

/**
 * Normalize relative player IDs ("self"/"opponent") to concrete IDs.
 * @param {string} value - The value to normalize
 * @param ctx - Context with player/opponent references
 * @param meta - Metadata for logging
 * @returns {string} Normalized player ID
 */
export function normalizeRelativePlayerId(
  this: OwnershipHost,
  value: RelativePlayerId,
  ctx: OwnershipContext,
  meta: OwnershipMeta = {},
): RelativePlayerId {
  if (value !== "self" && value !== "opponent") return value;
  const selfId = ctx?.player?.id ?? meta.selfId ?? null;
  const opponentId = ctx?.opponent?.id ?? meta.opponentId ?? null;
  const mapped = value === "self" ? selfId : opponentId;
  if (this.devModeEnabled) {
    const cardName = meta.card?.name || meta.cardName || "unknown";
    const actionName =
      typeof meta.action === "object" && meta.action !== null
        ? meta.action.id || meta.action.type
        : meta.action;
    const summary = `Normalized ${meta.field || "id"} ${value} -> ${
      mapped || "unknown"
    } for ${cardName}`;
    this.devLog("RELATIVE_OWNER_NORMALIZED", {
      summary,
      field: meta.field,
      raw: value,
      mapped,
      card: cardName,
      action: actionName,
      context: meta.contextLabel,
    });
    console.warn("[DEV] RELATIVE_OWNER_NORMALIZED", {
      field: meta.field,
      raw: value,
      mapped,
      card: cardName,
      action: actionName,
      context: meta.contextLabel,
      stack: new Error().stack,
    });
  }
  return mapped ?? value;
}

/**
 * Normalize owner/controller of a single card.
 * @param card - The card to normalize
 * @param ctx - Context with player/opponent references
 * @param meta - Metadata for logging and zone enforcement
 */
export function normalizeCardOwnership(
  this: OwnershipHost,
  card: GameCard | null | undefined,
  ctx: OwnershipContext,
  meta: OwnershipMeta = {},
) {
  if (!card) return;
  const owner = this.normalizeRelativePlayerId(card.owner, ctx, {
    ...meta,
    field: "owner",
    card,
  });
  if (owner && card.owner !== owner) {
    card.owner = owner;
  }
  const controller = this.normalizeRelativePlayerId(card.controller, ctx, {
    ...meta,
    field: "controller",
    card,
  });
  if (controller && card.controller !== controller) {
    card.controller = controller;
  }

  if (meta.enforceZoneOwner && meta.zoneOwnerId) {
    const zoneOwnerId = meta.zoneOwnerId;
    if (card.owner !== zoneOwnerId) {
      if (this.devModeEnabled) {
        this.devLog("ZONE_OWNER_CORRECTED", {
          summary: `Owner corrected to ${zoneOwnerId} for ${card.name}`,
          card: card.name,
          from: card.owner,
          to: zoneOwnerId,
          zone: meta.zone,
          context: meta.contextLabel,
        });
      }
      card.owner = zoneOwnerId;
    }
    if (card.controller !== zoneOwnerId) {
      if (this.devModeEnabled) {
        this.devLog("ZONE_CONTROLLER_CORRECTED", {
          summary: `Controller corrected to ${zoneOwnerId} for ${card.name}`,
          card: card.name,
          from: card.controller,
          to: zoneOwnerId,
          zone: meta.zone,
          context: meta.contextLabel,
        });
      }
      card.controller = zoneOwnerId;
    }
  }
}

/**
 * Normalize owner/controller of all cards in all zones.
 * @param {string} contextLabel - Label for logging
 * @param options - Options (enforceZoneOwner)
 */
export function normalizeZoneCardOwnership(
  this: OwnershipHost,
  contextLabel = "zone_state",
  options: NormalizeZoneOwnershipOptions = {},
) {
  const seen = new Set<GameCard>();
  const enforceZoneOwner = options.enforceZoneOwner === true;
  const addList = (
    player: GamePlayer,
    opponent: GamePlayer | null,
    zoneName: CanonicalZone,
    list: GameCard[] | null | undefined,
  ) => {
    if (!Array.isArray(list)) return;
    list.forEach((card) => {
      if (!card || seen.has(card)) return;
      seen.add(card);
      this.normalizeCardOwnership(
        card,
        { player, opponent },
        {
          contextLabel,
          zone: zoneName,
          zoneOwnerId: player?.id,
          enforceZoneOwner,
        }
      );
    });
  };
  const applyForPlayer = (player: GamePlayer | null | undefined) => {
    if (!player) return;
    const opponent = this.getOpponent(player);
    addList(player, opponent, "hand", player.hand);
    addList(player, opponent, "field", player.field);
    addList(player, opponent, "spellTrap", player.spellTrap);
    addList(player, opponent, "graveyard", player.graveyard);
    addList(player, opponent, "banished", player.banished);
    addList(player, opponent, "deck", player.deck);
    addList(player, opponent, "extraDeck", player.extraDeck);
    if (player.fieldSpell) {
      addList(player, opponent, "fieldSpell", [player.fieldSpell]);
    }
  };
  applyForPlayer(this.player);
  applyForPlayer(this.bot);
}
