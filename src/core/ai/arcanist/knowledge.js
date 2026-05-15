export const ARCANIST_IDS = {
  GRIMOIRE: 201,
  APPRENTICE: 202,
  CRIMSON_EXPLOSION: 203,
  LIGHTNING_LANCE: 204,
  VIRIDIS: 205,
  TERA: 206,
  ALBUS: 207,
  MASTER_OF_MIRRORS: 208,
  MEETING: 209,
  ICE_BARRIER: 210,
  INK_RIVER: 211,
  GRAND_LIBRARY: 212,
  ELEMENTALIST: 213,
  AZRATH: 214,
  SEISMIC_IMPACT: 216,
};

export const ARCANIST_NAMES = {
  GRIMOIRE: "Grimoire of the Apprentice Arcanist",
  APPRENTICE: "Arcanist Apprentice",
  CRIMSON_EXPLOSION: "Arcanist Crimson Explosion",
  LIGHTNING_LANCE: "Arcanist Lightning Lance",
  VIRIDIS: "Viridis, Arcanist of Life",
  TERA: "Tera, Arcanist of Earth",
  ALBUS: "Albus, Arcanist of Ice",
  MASTER_OF_MIRRORS: "Master of Mirrors Arcanist",
  MEETING: "Meeting of the Arcanists",
  ICE_BARRIER: "Arcanist Ice Barrier",
  INK_RIVER: "Arcanist Ink River",
  GRAND_LIBRARY: "Arcanist Grand Library",
  ELEMENTALIST: "Elementalist Master Arcanist",
  AZRATH: "Azrath, Corrupted Arcanist",
  SEISMIC_IMPACT: "Arcanist Seismic Impact",
};

export const CARD_KNOWLEDGE = {
  [ARCANIST_NAMES.APPRENTICE]: {
    role: "starter",
    value: 9,
    tags: ["normal_search", "equip_aura"],
  },
  [ARCANIST_NAMES.ALBUS]: {
    role: "extender",
    value: 7,
    tags: ["hand_summon", "monster_recovery"],
  },
  [ARCANIST_NAMES.AZRATH]: {
    role: "control_host",
    value: 10,
    tags: ["grimoire_host", "stat_zero", "spell_debuff"],
  },
  [ARCANIST_NAMES.TERA]: {
    role: "tempo_control",
    value: 7,
    tags: ["position_control", "quick_when_equipped"],
  },
  [ARCANIST_NAMES.VIRIDIS]: {
    role: "spell_recovery",
    value: 7,
    tags: ["spell_bounce", "spell_recovery"],
  },
  [ARCANIST_NAMES.MASTER_OF_MIRRORS]: {
    role: "grind_engine",
    value: 9,
    tags: ["spell_recycle", "revive_when_equipped"],
  },
  [ARCANIST_NAMES.ELEMENTALIST]: {
    role: "finisher",
    value: 12,
    tags: ["effect_protected", "destroy_when_equipped"],
  },
  [ARCANIST_NAMES.GRAND_LIBRARY]: {
    role: "field_engine",
    value: 12,
    tags: ["starter", "equip_search", "battle_draw"],
  },
  [ARCANIST_NAMES.GRIMOIRE]: {
    role: "equip_engine",
    value: 11,
    tags: ["equip", "stored_blueprint"],
  },
  [ARCANIST_NAMES.SEISMIC_IMPACT]: {
    role: "premium_removal",
    value: 10,
    tags: ["equip_cost", "banish"],
  },
  [ARCANIST_NAMES.INK_RIVER]: {
    role: "resource_engine",
    value: 8,
    tags: ["spell_counter", "spell_recovery"],
  },
  [ARCANIST_NAMES.LIGHTNING_LANCE]: {
    role: "combat_trick",
    value: 6,
    tags: ["atk_buff", "piercing", "attack_lock"],
  },
  [ARCANIST_NAMES.ICE_BARRIER]: {
    role: "protection",
    value: 6,
    tags: ["destruction_replacement"],
  },
  [ARCANIST_NAMES.CRIMSON_EXPLOSION]: {
    role: "trade_removal",
    value: 7,
    tags: ["destroy", "burn"],
  },
  [ARCANIST_NAMES.MEETING]: {
    role: "hand_converter",
    value: 6,
    tags: ["search", "spell_guard"],
  },
};

export const GRIMOIRE_HOST_ORDER = [
  ARCANIST_NAMES.AZRATH,
  ARCANIST_NAMES.ELEMENTALIST,
  ARCANIST_NAMES.MASTER_OF_MIRRORS,
  ARCANIST_NAMES.APPRENTICE,
  ARCANIST_NAMES.VIRIDIS,
  ARCANIST_NAMES.ALBUS,
  ARCANIST_NAMES.TERA,
];

export const ARCANIST_SPELL_RECOVERY_ORDER = [
  ARCANIST_NAMES.SEISMIC_IMPACT,
  ARCANIST_NAMES.CRIMSON_EXPLOSION,
  ARCANIST_NAMES.ICE_BARRIER,
  ARCANIST_NAMES.LIGHTNING_LANCE,
  ARCANIST_NAMES.GRIMOIRE,
  ARCANIST_NAMES.GRAND_LIBRARY,
  ARCANIST_NAMES.INK_RIVER,
  ARCANIST_NAMES.MEETING,
];

export const ARCANIST_MONSTER_RECOVERY_ORDER = [
  ARCANIST_NAMES.AZRATH,
  ARCANIST_NAMES.APPRENTICE,
  ARCANIST_NAMES.ALBUS,
  ARCANIST_NAMES.TERA,
  ARCANIST_NAMES.VIRIDIS,
  ARCANIST_NAMES.MASTER_OF_MIRRORS,
  ARCANIST_NAMES.ELEMENTALIST,
];

export function getCardKnowledge(cardOrName) {
  const name =
    typeof cardOrName === "string" ? cardOrName : cardOrName?.name || "";
  return CARD_KNOWLEDGE[name] || null;
}

export function hasArchetype(card, archetype) {
  if (!card || !archetype) return false;
  return (
    card.archetype === archetype ||
    (Array.isArray(card.archetypes) && card.archetypes.includes(archetype))
  );
}

export function isArcanist(card) {
  return hasArchetype(card, "Arcanist");
}

export function isArcanistMonster(card) {
  return !!card && card.cardKind === "monster" && isArcanist(card);
}

export function isArcanistSpell(card) {
  return !!card && card.cardKind === "spell" && isArcanist(card);
}

export function isArcanistEquip(card) {
  return isArcanistSpell(card) && card.subtype === "equip";
}

export function isFaceUp(card) {
  return !!card && !card.isFacedown;
}

export function hasArcanistEquip(card) {
  if (!card || !Array.isArray(card.equips)) return false;
  return card.equips.some((equip) => isFaceUp(equip) && isArcanistEquip(equip));
}

export function hasFaceUpArcanistMonster(player) {
  return (player?.field || []).some(
    (card) => isArcanistMonster(card) && isFaceUp(card),
  );
}

export function controlsArcanistEquip(player) {
  return (player?.spellTrap || []).some(
    (card) => isFaceUp(card) && isArcanistEquip(card),
  );
}

export function getInkCounters(card) {
  if (!card) return 0;
  if (card.counters instanceof Map) return card.counters.get("ink") || 0;
  if (card.counters && typeof card.counters === "object") {
    return card.counters.ink || card.counters.INK || 0;
  }
  return 0;
}

export function getStoredBlueprintCount(card) {
  const storage = card?.state?.blueprintStorage || card?.blueprintStorage;
  const blueprints = storage?.storedBlueprints;
  return Array.isArray(blueprints) ? blueprints.length : 0;
}

export function getNameRank(name, order, fallback = 999) {
  const index = order.indexOf(name);
  return index >= 0 ? index : fallback;
}

export function sortByNameOrder(cards, order) {
  return [...(cards || [])].sort((a, b) => {
    const rankA = getNameRank(a?.name, order);
    const rankB = getNameRank(b?.name, order);
    if (rankA !== rankB) return rankA - rankB;
    return (b?.atk || 0) - (a?.atk || 0);
  });
}
