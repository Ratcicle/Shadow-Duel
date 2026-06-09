export const VOID_CARD_KNOWLEDGE = {
  201: { role: "starter", tags: ["swarm", "deck_extender", "reloop"] },
  202: { role: "extender", tags: ["swarm", "hand_bridge", "ascension_material"] },
  203: { role: "starter", tags: ["search", "hollow_access"] },
  204: { role: "swarm", tags: ["hollow", "material"] },
  205: { role: "recovery", tags: ["swarm", "revive", "gy_recycle"] },
  206: { role: "pressure", tags: ["direct", "finisher"] },
  208: { role: "control", tags: ["lock", "token", "cost_body"] },
  209: { role: "midrange", tags: ["removal", "hollow_scaling", "backrow"] },
  210: { role: "protector", tags: ["fusion", "hand_trap", "keep_in_hand"] },
  211: { role: "support", tags: ["scaler", "free_body", "swarm"] },
  212: { role: "boss", tags: ["banish", "berserker_material"] },
  214: { role: "boss", tags: ["hollow", "tiered_cost", "removal"] },
  221: {
    role: "ascension_material",
    tags: ["swarm", "revive", "hollow", "malicious_setup"],
  },
  207: { role: "fusion_boss", tags: ["swarm", "resilience"] },
  213: { role: "fusion_boss", tags: ["double_attack", "bounce", "pressure"] },
  215: { role: "fusion_boss", tags: ["board_conversion", "draw", "raven"] },
  222: { role: "ascension_boss", tags: ["hollow_recycler", "death_floater"] },
  223: { role: "ascension_boss", tags: ["multi_attack", "hollow_gy", "search"] },
  224: { role: "solo_finisher", tags: ["lock", "scaling", "survival"] },
  216: { role: "tempo", tags: ["extra_normal"] },
  217: { role: "field_spell", tags: ["revive"] },
  218: { role: "removal", tags: ["bounce", "tempo"] },
  219: { role: "starter", tags: ["search", "recovery", "hollow"] },
  220: { role: "trap", tags: ["response", "level_match", "tempo_defense"] },
};

export const VOID_EXTRA_DECK_IDS = [207, 213, 215, 222, 223];

export function isVoid(card) {
  if (!card) return false;
  if (Array.isArray(card.archetypes)) return card.archetypes.includes("Void");
  return card.archetype === "Void";
}

export function getVoidCardKnowledge(cardOrId) {
  const id = typeof cardOrId === "number" ? cardOrId : cardOrId?.id;
  if (!id) return null;
  return VOID_CARD_KNOWLEDGE[id] || null;
}

export function getVoidCardsByRole(role) {
  return Object.entries(VOID_CARD_KNOWLEDGE)
    .filter(([, info]) => info.role === role)
    .map(([id]) => Number(id));
}
