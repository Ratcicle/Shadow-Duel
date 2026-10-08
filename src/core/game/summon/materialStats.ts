/**
 * materialStats.js
 *
 * Material duel-stats tracking extracted from Game.js.
 * Tracks per-material counters used by material-aware effects:
 * how many opponent monsters a material destroyed, how many times
 * its effect activated, etc.
 *
 * State owned by Game (kept on `this`):
 *  - materialDuelStats: { player: {...Maps}, bot: {...Maps} }
 *
 * Methods:
 *  - resetMaterialDuelStats
 *  - incrementMaterialStat
 *  - recordMaterialEffectActivation
 *  - recordMaterialDestroyedOpponentMonster
 */

import type { GameCard } from "../../contracts/cards.js";
import type { GameCoreHost, MaterialDuelStats, MaterialStatsForPlayer } from "../../contracts/gameRuntime.js";
import type { GamePlayer } from "../../contracts/player.js";
import type { PlayerId } from "../../contracts/primitives.js";

type MaterialStatMapName =
  | "destroyedOpponentMonstersByMaterialId"
  | "effectActivationsByMaterialId";

interface MaterialStatMeta {
  contextLabel?: string;
  effectId?: string;
}

interface MaterialStatsHost extends GameCoreHost {
  materialDuelStats: Record<PlayerId, MaterialStatsForPlayer>;
  devLog(code: string, detail?: unknown): void;
  incrementMaterialStat(
    playerId: PlayerId,
    mapName: MaterialStatMapName,
    materialCardId: number,
    delta?: number,
  ): void;
}

export function createMaterialDuelStats(): MaterialDuelStats {
  return {
    player: {
      destroyedOpponentMonstersByMaterialId: new Map(),
      effectActivationsByMaterialId: new Map(),
      activatedEffectIdsByMaterialId: new Map(),
    },
    bot: {
      destroyedOpponentMonstersByMaterialId: new Map(),
      effectActivationsByMaterialId: new Map(),
      activatedEffectIdsByMaterialId: new Map(),
    },
  };
}

export function resetMaterialDuelStats(this: MaterialStatsHost, reason = "reset") {
  this.materialDuelStats = createMaterialDuelStats();
  this.devLog("MATERIAL_STATS_RESET", { summary: reason });
}

export function incrementMaterialStat(
  this: MaterialStatsHost,
  playerId: PlayerId,
  mapName: MaterialStatMapName,
  materialCardId: number,
  delta = 1,
) {
  incrementMaterialStatInStats(this.materialDuelStats, playerId, mapName, materialCardId, delta);
}

/** Shared mutation over the canonical ledger; callers own the surrounding events. */
export function incrementMaterialStatInStats(
  stats: MaterialDuelStats | undefined,
  playerId: PlayerId,
  mapName: MaterialStatMapName,
  materialCardId: number,
  delta = 1,
): void {
  const store = stats?.[playerId]?.[mapName];
  if (!store || !(store instanceof Map) || !Number.isFinite(materialCardId)) return;
  store.set(materialCardId, (store.get(materialCardId) || 0) + delta);
}

/** A successfully resolved monster effect records both count and distinct ID. */
export function recordMaterialEffectActivationInStats(
  stats: MaterialDuelStats | undefined,
  playerId: string,
  sourceCard: {
    readonly id?: GameCard["id"] | null | undefined;
    readonly cardKind?: GameCard["cardKind"] | null | undefined;
  } | null | undefined,
  effectId: string | null | undefined,
  increment?: (playerId: PlayerId, materialCardId: number) => void,
): void {
  if (playerId !== "player" && playerId !== "bot") return;
  if (!sourceCard || sourceCard.cardKind !== "monster" || typeof sourceCard.id !== "number") return;
  recordMaterialEffectIdentity(stats, playerId, sourceCard, effectId);
  if (increment) increment(playerId, sourceCard.id);
  else incrementMaterialStatInStats(stats, playerId, "effectActivationsByMaterialId", sourceCard.id);
}

export function recordMaterialEffectActivation(
  this: MaterialStatsHost,
  player: GamePlayer | PlayerId,
  sourceCard: GameCard | null | undefined,
  meta: MaterialStatMeta = {},
) {
  const playerId = typeof player === "string" ? player : player.id;
  if (playerId !== "player" && playerId !== "bot") return;
  if (!sourceCard || sourceCard.cardKind !== "monster") return;
  if (typeof sourceCard.id !== "number") return;
  recordMaterialEffectActivationInStats(this.materialDuelStats, playerId, sourceCard, meta.effectId,
    (ownerId, materialId) => this.incrementMaterialStat(ownerId, "effectActivationsByMaterialId", materialId, 1));
  this.devLog("MATERIAL_EFFECT_ACTIVATION", {
    summary: `${playerId}:${sourceCard.name} (${sourceCard.id})`,
    player: playerId,
    card: sourceCard.name,
    cardId: sourceCard.id,
    context: meta.contextLabel,
  });
}

/** Distinct activation history is independent of successful-resolution counts. */
export function recordMaterialEffectIdentity(
  stats: MaterialDuelStats | undefined,
  playerId: string,
  sourceCard: {
    readonly id?: GameCard["id"] | null | undefined;
    readonly cardKind?: GameCard["cardKind"] | null | undefined;
  },
  effectId: string | null | undefined,
): void {
  if (playerId !== "player" && playerId !== "bot") return;
  if (sourceCard.cardKind !== "monster" || typeof sourceCard.id !== "number" || !effectId) return;
  const history = stats?.[playerId].activatedEffectIdsByMaterialId;
  if (!history) return;
  const activated = history.get(sourceCard.id) || new Set<string>();
  activated.add(effectId);
  history.set(sourceCard.id, activated);
}

export function recordMaterialDestroyedOpponentMonster(
  this: MaterialStatsHost,
  sourceCard: GameCard | null | undefined,
  destroyedCard: GameCard | null | undefined,
) {
  if (!sourceCard || !destroyedCard) return;
  if (sourceCard.cardKind !== "monster") return;
  if (destroyedCard.cardKind !== "monster") return;
  if (typeof sourceCard.id !== "number") return;

  const sourcePlayerId = sourceCard.controller || sourceCard.owner;
  const destroyedPlayerId = destroyedCard.controller || destroyedCard.owner;
  if (sourcePlayerId !== "player" && sourcePlayerId !== "bot") return;
  if (destroyedPlayerId !== "player" && destroyedPlayerId !== "bot") return;
  if (sourcePlayerId === destroyedPlayerId) return;

  this.incrementMaterialStat(
    sourcePlayerId,
    "destroyedOpponentMonstersByMaterialId",
    sourceCard.id,
    1,
  );
  this.devLog("MATERIAL_DESTROY_COUNT", {
    summary: `${sourcePlayerId}:${sourceCard.name} -> ${destroyedCard.name}`,
    player: sourcePlayerId,
    source: sourceCard.name,
    sourceId: sourceCard.id,
    destroyed: destroyedCard.name,
  });
}
