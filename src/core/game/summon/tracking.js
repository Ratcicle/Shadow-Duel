/**
 * Summon tracking utilities - special summon type counting and delayed summons.
 * Extracted from Game.js as part of B.6 modularization.
 */

/**
 * Track special summon by monster type for counting effects.
 * @param {Object} payload - Event payload with card, player, method
 */
export function _trackSpecialSummonType(payload) {
  try {
    const { card, player, method } = payload || {};
    if (!card || !player || method !== "special") return;
    const typeName = card.type || null;
    if (!typeName) return;
    const playerId = player?.id || player;
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
 * @param {Object|string} owner - Player or player ID
 * @param {string} typeName - Monster type to count
 * @returns {number} Count of special summoned monsters of that type
 */
export function getSpecialSummonedTypeCount(owner, typeName) {
  const playerId = owner?.id || owner;
  const store = this.specialSummonTypeCounts?.[playerId];
  if (!store || !(store instanceof Map)) return 0;
  return store.get(typeName) || 0;
}

/**
 * Resolve a delayed summon action.
 * Executes Special Summons with validity checks.
 * @param {Object} payload - Delayed summon payload with summons array
 */
export function resolveDelayedSummon(payload) {
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

    // Executar special summon
    void this.moveCard(card, targetPlayer, "field", {
      summonMethodOverride: "special",
    });
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
