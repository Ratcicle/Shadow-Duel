export const VOID_CARD_KNOWLEDGE = {
  151: { role: "extender", tags: ["swarm"] },
  152: { role: "extender", tags: ["swarm"] },
  153: { role: "beater", tags: ["search"] },
  154: { role: "swarm", tags: ["hollow"] },
  155: { role: "extender", tags: ["swarm", "revive"] },
  156: { role: "pressure", tags: ["direct"] },
  158: { role: "control", tags: ["lock"] },
  159: { role: "extender", tags: ["removal"] },
  160: { role: "protector", tags: ["fusion"] },
  161: { role: "scaler", tags: ["swarm"] },
  162: { role: "boss", tags: ["banish"] },
  164: { role: "boss", tags: ["hollow"] },
  157: { role: "fusion_boss", tags: ["swarm"] },
  163: { role: "fusion_boss", tags: ["double_attack"] },
  165: { role: "fusion_boss", tags: ["board_clear"] },
  171: { role: "ascension_boss", tags: ["swarm"] },
  166: { role: "tempo", tags: ["extra_normal"] },
  167: { role: "field_spell", tags: ["revive"] },
  168: { role: "tempo", tags: ["bounce"] },
  169: { role: "board_clear", tags: ["reset"] },
  170: { role: "trap", tags: ["response"] },
};

export const VOID_EXTRA_DECK_IDS = [157, 163, 165, 171];

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
