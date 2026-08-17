/**
 * Summon tracking utilities - special summon type counting and delayed summons.
 * Extracted from Game.js as part of B.6 modularization.
 */

import type {
  BattlePosition,
  BattlePositionInput,
  GameCard,
  KnownCardStatusInput,
  SpecialSummonProcedure,
} from "../../contracts/cards.js";
import type {
  GameSummonHost,
  MaybePromise,
  MoveCardOptions,
  MoveCardResult,
} from "../../contracts/gameRuntime.js";
import type { GamePlayer } from "../../contracts/player.js";
import type { PlayerId } from "../../contracts/primitives.js";
import type { SummonMethod } from "../../contracts/summon.js";
import type { CanonicalZone } from "../../contracts/zones.js";
import type {
  EventCard,
  EventPlayer,
  EventZone,
} from "../../contracts/events.js";

type CardArrayZone = Exclude<CanonicalZone, "fieldSpell">;

interface SpecialSummonTrackingPayload {
  card?: EventCard | null;
  player?: EventPlayer | null;
  method?: SummonMethod | null;
  fromZone?: EventZone | null;
  summonProcedure?: SpecialSummonProcedure | string | null;
}

interface DelayedSummonEntry {
  card?: GameCard | null;
  owner: PlayerId;
  fromZone?: CardArrayZone;
  position?: BattlePositionInput;
  statusesOnSummon?: readonly KnownCardStatusInput[];
  summonMethod?: SummonMethod;
  summonProcedure?: SpecialSummonProcedure | string | null;
  getsBuffIfTargetWasFusionOrAscension?: boolean;
}

interface DelayedSummonPayload {
  summons: DelayedSummonEntry[];
}

interface SummonTrackingHost extends GameSummonHost {
  specialSummonTypeCounts: Record<PlayerId, Map<string, number>>;
  chooseSpecialSummonPosition(
    player: GamePlayer,
    card: GameCard,
    options?: { position?: BattlePositionInput },
  ): Promise<BattlePosition>;
  moveCard(
    card: GameCard,
    player: GamePlayer,
    zone: CanonicalZone,
    options?: MoveCardOptions,
  ): MaybePromise<MoveCardResult>;
  applyTurnBasedBuff(
    card: GameCard,
    stat: "atk" | "def",
    amount: number,
    expiresOnTurn: number,
  ): unknown;
  updateBoard(): unknown;
  devLog?(code: string, detail?: unknown): void;
}

/**
 * Track special summon by monster type for counting effects.
 * @param payload - Event payload with card, player, method
 */
export function _trackSpecialSummonType(
  this: SummonTrackingHost,
  payload: SpecialSummonTrackingPayload | null | undefined,
) {
  try {
    const { card, player, method } = payload || {};
    if (!card || !player) return;

    card.lastSummonMethod = method || null;
    card.lastSummonedFromZone = payload?.fromZone || null;
    card.lastSummonedTurn = this.turnCounter ?? null;
    card.lastSummonProcedure = payload?.summonProcedure || null;

    if (method !== "special") return;
    const typeName = card.type || null;
    if (!typeName) return;
    const playerId = player.id;
    if (playerId !== "player" && playerId !== "bot") return;
    const store = this.specialSummonTypeCounts?.[playerId];
    if (!store || !(store instanceof Map)) return;
    const next = (store.get(typeName) || 0) + 1;
    store.set(typeName, next);
    this.devLog?.("SS_TYPE_TRACK", {
      summary: `${playerId} special-summoned ${typeName} (${next})`,
      player: playerId,
      type: typeName,
      count: next,
    });
  } catch (err) {
    console.error("Failed to track special summon type:", err);
  }
}

/**
 * Get count of special summoned monsters of a specific type.
 * @param owner - Player or player ID
 * @param {string} typeName - Monster type to count
 * @returns {number} Count of special summoned monsters of that type
 */
export function getSpecialSummonedTypeCount(
  this: SummonTrackingHost,
  owner: GamePlayer | PlayerId,
  typeName: string,
): number {
  const playerId = typeof owner === "string" ? owner : owner.id;
  if (playerId !== "player" && playerId !== "bot") return 0;
  const store = this.specialSummonTypeCounts?.[playerId];
  if (!store || !(store instanceof Map)) return 0;
  return store.get(typeName) || 0;
}

/**
 * Resolve a delayed summon action.
 * Executes Special Summons with validity checks.
 * @param payload - Delayed summon payload with summons array
 */
export async function resolveDelayedSummon(
  this: SummonTrackingHost,
  payload: DelayedSummonPayload | null | undefined,
) {
  if (
    !payload ||
    !Array.isArray(payload.summons) ||
    payload.summons.length === 0
  ) {
    console.warn("Invalid delayed summon payload");
    return;
  }

  const { summons } = payload;
  let successCount = 0;

  for (const summonData of summons) {
    const card = summonData.card;
    const targetOwner = summonData.owner;
    const targetPlayer = targetOwner === "player" ? this.player : this.bot;

    if (!card) {
      this.ui?.log?.(`Card reference missing in delayed summon.`);
      continue;
    }

    // Verificar se carta ainda está na zona de origem esperada
    const originZone = summonData.fromZone || "graveyard";
    const zoneList = targetPlayer[originZone];
    if (!Array.isArray(zoneList) || !zoneList.includes(card)) {
      this.ui?.log?.(
        `${card.name} is no longer in ${originZone}, cannot special summon.`
      );
      continue;
    }

    // Verificar se há espaço no campo
    if (targetPlayer.field.length >= 5) {
      this.ui?.log?.(`Field is full, cannot special summon ${card.name}.`);
      continue;
    }

    const resolvedPosition =
      typeof this.chooseSpecialSummonPosition === "function"
        ? await this.chooseSpecialSummonPosition(targetPlayer, card, {
            position: summonData.position,
          })
        : summonData.position === "defense"
          ? "defense"
          : "attack";

    // Executar special summon
    const moveResult = await this.moveCard(card, targetPlayer, "field", {
      position: resolvedPosition,
      statusesOnSummon: summonData.statusesOnSummon,
      summonMethodOverride: summonData.summonMethod || "special",
      summonProcedure: summonData.summonProcedure || null,
      summonOrigin: "effect_resolution",
    });
    if (moveResult?.success === false) {
      this.ui?.log?.(
        `${card.name} could not be special summoned from delayed action.`
      );
      continue;
    }
    successCount++;

    // Aplicar buff condicional: Abyssal Serpent ganha +800 ATK se alvo era Fusion/Ascension
    if (
      summonData.getsBuffIfTargetWasFusionOrAscension &&
      card.cardKind === "monster"
    ) {
      const expiresOnTurn = this.turnCounter + 1;
      this.applyTurnBasedBuff(card, "atk", 800, expiresOnTurn);
      this.ui?.log?.(
        `${card.name} gains +800 ATK until the end of turn ${expiresOnTurn}.`
      );
    }
  }

  if (successCount > 0) {
    this.updateBoard();
    this.ui?.log?.(
      `${successCount} card(s) special summoned from delayed action.`
    );
  }
}
