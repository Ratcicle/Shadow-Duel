export const VOID_CARD_KNOWLEDGE = {
  151: { role: "starter", tags: ["swarm", "deck_extender", "reloop"] },
  152: { role: "extender", tags: ["swarm", "hand_bridge", "ascension_material"] },
  153: { role: "starter", tags: ["search", "hollow_access"] },
  154: { role: "swarm", tags: ["hollow", "material"] },
  155: { role: "recovery", tags: ["swarm", "revive", "gy_recycle"] },
  156: { role: "pressure", tags: ["direct", "finisher"] },
  158: { role: "control", tags: ["lock", "token", "cost_body"] },
  159: { role: "midrange", tags: ["removal", "hollow_scaling", "backrow"] },
  160: { role: "protector", tags: ["fusion", "hand_trap", "keep_in_hand"] },
  161: { role: "support", tags: ["scaler", "free_body", "swarm"] },
  162: { role: "boss", tags: ["banish", "berserker_material"] },
  164: { role: "boss", tags: ["hollow", "tiered_cost", "removal"] },
  172: {
    role: "ascension_material",
    tags: ["swarm", "revive", "hollow", "malicious_setup"],
  },
  157: { role: "fusion_boss", tags: ["swarm", "resilience"] },
  163: { role: "fusion_boss", tags: ["double_attack", "bounce", "pressure"] },
  165: { role: "fusion_boss", tags: ["board_conversion", "draw", "raven"] },
  171: { role: "ascension_boss", tags: ["hollow_recycler", "death_floater"] },
  173: { role: "ascension_boss", tags: ["multi_attack", "hollow_gy", "search"] },
  258: { role: "solo_finisher", tags: ["lock", "scaling", "survival"] },
  166: { role: "tempo", tags: ["extra_normal"] },
  167: { role: "field_spell", tags: ["revive"] },
  168: { role: "removal", tags: ["bounce", "tempo"] },
  169: { role: "starter", tags: ["search", "recovery", "hollow"] },
  170: { role: "trap", tags: ["response", "level_match", "tempo_defense"] },
};

export const VOID_EXTRA_DECK_IDS = [157, 163, 165, 171, 173];

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
