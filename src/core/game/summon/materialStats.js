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

export function resetMaterialDuelStats(reason = "reset") {
  this.materialDuelStats = {
    player: {
      destroyedOpponentMonstersByMaterialId: new Map(),
      effectActivationsByMaterialId: new Map(),
    },
    bot: {
      destroyedOpponentMonstersByMaterialId: new Map(),
      effectActivationsByMaterialId: new Map(),
    },
  };
  this.devLog("MATERIAL_STATS_RESET", { summary: reason });
}

export function incrementMaterialStat(playerId, mapName, materialCardId, delta = 1) {
  const store = this.materialDuelStats?.[playerId]?.[mapName];
  if (!store || !(store instanceof Map) || !Number.isFinite(materialCardId)) {
    return;
  }
  const next = (store.get(materialCardId) || 0) + delta;
  store.set(materialCardId, next);
}

export function recordMaterialEffectActivation(player, sourceCard, meta = {}) {
  const playerId = player?.id || player;
  if (playerId !== "player" && playerId !== "bot") return;
  if (!sourceCard || sourceCard.cardKind !== "monster") return;
  if (typeof sourceCard.id !== "number") return;
  this.incrementMaterialStat(
    playerId,
    "effectActivationsByMaterialId",
    sourceCard.id,
    1,
  );
  this.devLog("MATERIAL_EFFECT_ACTIVATION", {
    summary: `${playerId}:${sourceCard.name} (${sourceCard.id})`,
    player: playerId,
    card: sourceCard.name,
    cardId: sourceCard.id,
    context: meta.contextLabel,
  });
}

export function recordMaterialDestroyedOpponentMonster(sourceCard, destroyedCard) {
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
