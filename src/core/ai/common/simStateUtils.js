/**
 * Remove a card reference from a simulated player zone.
 * This intentionally avoids engine movement hooks; callers use it only on
 * cloned/perspective state during planning.
 */
export function removeFromZone(player, zoneName, card) {
  const zone = player?.[zoneName];
  if (!Array.isArray(zone)) return false;
  const index = zone.indexOf(card);
  if (index < 0) return false;
  zone.splice(index, 1);
  return true;
}

/**
 * Push a card reference into a simulated player zone, creating the zone array
 * when needed. No ownership, event, or UI side effects are applied.
 */
export function pushToZone(player, zoneName, card) {
  if (!player || !card) return;
  if (!Array.isArray(player[zoneName])) player[zoneName] = [];
  player[zoneName].push(card);
}

/**
 * Return the stable runtime instance id used by AI preference metadata.
 */
export function getCardInstanceId(card) {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uid ??
    card?.uuid ??
    card?.simInstanceId ??
    null
  );
}

function summarizePlayer(player = {}, options = {}) {
  const getSpellTrapCounters =
    typeof options.getSpellTrapCounters === "function"
      ? options.getSpellTrapCounters
      : () => 0;

  return {
    lp: player.lp || 0,
    hand: (player.hand || []).map((card) => card?.name || "?"),
    field: (player.field || []).map((card) => ({
      name: card?.name || "?",
      position: card?.position || null,
      faceDown: !!card?.isFacedown,
      atk: card?.atk || 0,
      def: card?.def || 0,
      tempAtk: card?.tempAtkBoost || 0,
      tempDef: card?.tempDefBoost || 0,
      cannotAttack: !!card?.cannotAttackThisTurn,
      piercing: !!card?.piercing,
      piercingDamageMultiplier: Number(card?.piercingDamageMultiplier || 1),
      equips: (card?.equips || []).map((equip) => equip?.name || "?"),
    })),
    spellTrap: (player.spellTrap || []).map((card) => ({
      name: card?.name || "?",
      faceDown: !!card?.isFacedown,
      counters: getSpellTrapCounters(card),
    })),
    fieldSpell: player.fieldSpell?.name || null,
    graveyard: (player.graveyard || []).map((card) => card?.name || "?"),
    banished: (player.banished || []).map((card) => card?.name || "?"),
    deck: (player.deck || []).map((card) => card?.name || "?"),
  };
}

/**
 * Build a compact, deterministic signature for detecting whether simulated
 * action application changed planning-relevant state.
 */
export function getSimStateSignature(state, options = {}) {
  const extraState =
    typeof options.extraState === "function"
      ? options.extraState(state) || {}
      : {};

  return JSON.stringify({
    bot: summarizePlayer(state?.bot, options),
    player: summarizePlayer(state?.player, options),
    ...extraState,
  });
}

/**
 * Resolve the Set used to mark one-shot simulated effects in a caller-owned
 * bucket. Array buckets from cloned states are normalized back into Sets.
 */
export function ensureSimOptSet(state, bucketName = "_simOptUsed") {
  if (!state) return new Set();
  if (Array.isArray(state[bucketName])) {
    state[bucketName] = new Set(state[bucketName]);
  }
  if (!(state[bucketName] instanceof Set)) {
    state[bucketName] = new Set();
  }
  return state[bucketName];
}

/**
 * Mark a simulated one-shot effect as used. Empty keys are treated as
 * unrestricted and therefore return true.
 */
export function useSimOpt(state, key, bucketName = "_simOptUsed") {
  if (!key) return true;
  const used = ensureSimOptSet(state, bucketName);
  if (used.has(key)) return false;
  used.add(key);
  return true;
}
