// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/luminarch/knowledge.js
// Base de conhecimento: cartas Luminarch, roles, prioridades, sinergias
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Card knowledge database para Luminarch.
 * Cada carta tem: role, priority, summonCondition, synergies, playPatterns, value.
 */
export const CARD_KNOWLEDGE = {
  // ═════════════════════════════════════════════════════════════════════════
  // MONSTROS
  // ═════════════════════════════════════════════════════════════════════════

  "Luminarch Valiant - Knight of the Dawn": {
    role: "searcher",
    priority: 9,
    summonCondition: "turn1_or_early",
    effect:
      "Normal/Special Summon → add Lv4- Luminarch. Piercing damage vs DEF",
    synergies: [
      "Luminarch Aegisbearer",
      "Luminarch Sanctified Arbiter",
      "Luminarch Enchanted Halberd",
    ],
    playPatterns: [
      "Turn 1 opener: search Aegisbearer",
      "Search Arbiter se já tem field spell",
      "Piercing útil para limpar defenders",
    ],
    value: 18, // Searcher crucial
    searchTargets: [
      "Luminarch Aegisbearer",
      "Luminarch Sanctified Arbiter",
      "Luminarch Enchanted Halberd",
      "Luminarch Magic Sickle",
    ],
  },

  "Luminarch Aegisbearer": {
    role: "taunt_tank",
    priority: 10,
    summonCondition: "asap_defensive",
    effect: "Special Summon → +500 DEF. Oponente deve atacar esta carta",
    synergies: [
      "Sanctum of the Luminarch Citadel",
      "Luminarch Holy Shield",
      "Luminarch Sanctum Protector",
      "Luminarch Crescent Shield",
    ],
    playPatterns: [
      "Special summon sempre que possível (+500 DEF = 2500 total)",
      "Com Citadel: ganha +500 LP por ataque recebido",
      "Com Holy Shield: dano vira heal",
      "Material para Sanctum Protector",
      "Material de Ascensão para Fortress Aegis (2 turnos no campo)",
    ],
    value: 20, // Tank principal do deck
    ascensionTarget: "Luminarch Fortress Aegis",
  },

  "Luminarch Moonblade Captain": {
    role: "recursion_beater",
    priority: 7,
    summonCondition: "mid_game_with_gy",
    effect: "Normal Summon → revive Lv4- da GY. Destrói monstro → ataque extra",
    synergies: [
      "Luminarch Aegisbearer",
      "Luminarch Valiant - Knight of the Dawn",
      "Luminarch Enchanted Halberd",
      "Luminarch Magic Sickle",
    ],
    playPatterns: [
      "Reviver Aegisbearer para taunt imediato",
      "Duplo ataque para limpar board",
      "COMBO: Captain revive Lv4- → Halberd auto-SS = 3 monstros em 1 turno!",
      "Boa no mid-game quando GY tem recursos",
    ],
    value: 14,
    comboWith: ["Luminarch Enchanted Halberd"],
  },

  "Luminarch Celestial Marshal": {
    role: "boss_beater",
    priority: 6,
    summonCondition: "mid_late_game",
    effect: "Piercing. 1x/turn: não pode ser destruído em batalha",
    synergies: [
      "Luminarch Holy Ascension",
      "Sanctum of the Luminarch Citadel",
      "Luminarch Radiant Wave",
    ],
    playPatterns: [
      "Beater de 2500 ATK com proteção",
      "Piercing limpa defenders",
      "Buffar com Holy Ascension para 3300 ATK",
    ],
    value: 12,
  },

  "Luminarch Magic Sickle": {
    role: "recursion_engine",
    priority: 8,
    summonCondition: "when_gy_has_2plus",
    effect: "Enviar do campo → add até 2 Luminarch da GY para mão",
    synergies: [
      "Luminarch Moonlit Blessing",
      "Luminarch Sanctum Protector",
      "Luminarch Moonblade Captain",
    ],
    playPatterns: [
      "Cycle: campo → GY → mão (2 cartas)",
      "Recovery após trade",
      "Setup para Moonlit Blessing",
    ],
    value: 15,
  },

  "Luminarch Sanctum Protector": {
    role: "defense_controller",
    priority: 8,
    summonCondition: "when_aegis_on_field",
    effect:
      "Envie Aegisbearer → Special Summon da mão. 1x/turn: negue 1 ataque",
    synergies: [
      "Luminarch Aegisbearer",
      "Sanctum of the Luminarch Citadel",
      "Luminarch Holy Shield",
      "Luminarch Megashield Barbarias",
    ],
    playPatterns: [
      "Usar Aegisbearer como custo = SS grátis de 2800 DEF",
      "Negar ataques chave",
      "Material para Megashield Barbarias",
    ],
    value: 16,
    fusionMaterial: true,
  },

  "Luminarch Radiant Lancer": {
    role: "beater_removal",
    priority: 5,
    summonCondition: "when_ahead",
    effect: "Destrói monstro → +200 ATK. Destruído → pop backrow oponente",
    synergies: [
      "Luminarch Holy Ascension",
      "Sanctum of the Luminarch Citadel",
      "Luminarch Spear of Dawnfall",
    ],
    playPatterns: [
      "Snowball ATK ao destruir (+200 permanente)",
      "Floating effect (pop backrow)",
      "Pressão em board control",
      "PROTEGER após buffs - quanto mais tempo vivo, mais forte",
      "Combinar com Spear para garantir kills em defenders",
    ],
    value: 10,
    snowballPotential: true, // Bot deve valorizar manter vivo
  },

  "Luminarch Aurora Seraph": {
    role: "lifegain_boss",
    priority: 6,
    summonCondition: "when_lp_matters",
    effect:
      "Destrói monstro → heal metade do ATK dele. 1x/turn: substituição de destruição",
    synergies: [
      "Sanctum of the Luminarch Citadel",
      "Luminarch Holy Shield",
      "Luminarch Megashield Barbarias",
      "Luminarch Magic Sickle",
    ],
    playPatterns: [
      "Lifegain engine ao destruir",
      "Proteção built-in (mandar ally para GY)",
      "PREFERIR Magic Sickle como substituto (vai para GY → recicla 2 cartas)",
      "Sinergiza com LP-gain strategy",
      "Sacrificar Halberd/Sickle > Aegis/Protector como custo de proteção",
    ],
    value: 13,
    preferredSacrificeTargets: ["Luminarch Magic Sickle", "Luminarch Enchanted Halberd"],
  },

  "Luminarch Sanctified Arbiter": {
    role: "spell_searcher",
    priority: 8,
    summonCondition: "turn1_or_when_need_spell",
    effect: "Normal Summon → search Luminarch spell/trap. 1x/turn",
    synergies: [
      "Sanctum of the Luminarch Citadel",
      "Luminarch Holy Shield",
      "Luminarch Moonlit Blessing",
    ],
    playPatterns: [
      "Search Citadel turn 1",
      "Search Holy Shield quando precisa proteção",
      "Search Moonlit Blessing para recursão",
    ],
    value: 17, // Spell searcher crucial
    searchTargets: [
      "Sanctum of the Luminarch Citadel",
      "Luminarch Holy Shield",
      "Luminarch Moonlit Blessing",
      "Luminarch Radiant Wave",
    ],
  },

  "Luminarch Enchanted Halberd": {
    role: "extender",
    priority: 7,
    summonCondition: "when_ss_happens",
    effect:
      "Luminarch SS → pode SS esta carta da mão (não pode atacar este turno)",
    synergies: [
      "Luminarch Aegisbearer",
      "Luminarch Moonblade Captain",
      "Luminarch Moonlit Blessing",
    ],
    playPatterns: [
      "Extender após SS de Aegisbearer",
      "Body extra para defesa",
      "Setup para próximo turno",
    ],
    value: 11,
  },

  // ═════════════════════════════════════════════════════════════════════════
  // SPELLS
  // ═════════════════════════════════════════════════════════════════════════

  "Luminarch Holy Shield": {
    role: "protection_heal",
    priority: 10,
    effect:
      "Até 3 Luminarch → indestructível + dano de batalha vira heal (este turno)",
    synergies: [
      "Luminarch Aegisbearer",
      "Sanctum of the Luminarch Citadel",
      "Luminarch Aurora Seraph",
    ],
    playPatterns: [
      "Resposta a OTK",
      "Combo com Citadel: heal massivo",
      "Proteção em BP oponente",
    ],
    value: 20, // Proteção crítica
  },

  "Luminarch Knights Convocation": {
    role: "continuous_search",
    priority: 5,
    effect: "1x/turn: discard Lv7+ Luminarch → add Lv4- da deck",
    synergies: [
      "Luminarch Celestial Marshal",
      "Luminarch Sanctum Protector",
      "Luminarch Aurora Seraph",
      "Luminarch Valiant - Knight of the Dawn",
      "Luminarch Sanctified Arbiter",
    ],
    playPatterns: [
      "⚠️ BRICK ESCAPE: 2+ Lv7+ na mão sem searchers → ALTA PRIORIDADE",
      "Discard boss → search Valiant/Arbiter → iniciar combo principal",
      "Bosses na GY = setup para Moonlit Blessing recursão",
      "Continuous searcher para mid-game",
      "Dump high-levels para GY recursion",
    ],
    value: 8,
    brickEscape: true, // Sinaliza papel de escape para mãos ruins
  },

  "Sanctum of the Luminarch Citadel": {
    role: "field_spell_core",
    priority: 10,
    effect:
      "Oponente ataca → +500 LP. 1x/turn: pague 1000 LP → +500 ATK/DEF a 1 Luminarch",
    synergies: [
      "Luminarch Aegisbearer",
      "Luminarch Holy Shield",
      "Luminarch Aurora Seraph",
      "Luminarch Megashield Barbarias",
    ],
    playPatterns: [
      "SEMPRE ativar turn 1-2",
      "Combo Aegis: heal 500 LP por ataque",
      "Usar buff quando LP alto",
      "Synergy com lifegain doubles de Megashield",
    ],
    value: 22, // Field spell CENTRAL
  },

  "Luminarch Holy Ascension": {
    role: "buff_spell",
    priority: 4,
    effect: "Pague 1000 LP → 1 Luminarch ganha +800 ATK/DEF (até end)",
    synergies: [
      "Luminarch Celestial Marshal",
      "Luminarch Radiant Lancer",
      "Luminarch Aurora Seraph",
    ],
    playPatterns: [
      "Custo alto (1000 LP) = situational",
      "Usar quando pode fechar jogo",
      "Ou quando LP alto (8000+)",
    ],
    value: 7,
  },

  "Luminarch Radiant Wave": {
    role: "removal",
    priority: 7,
    effect: "Envie Luminarch 2000+ ATK do campo → destrua 1 carta do oponente",
    synergies: [
      "Luminarch Celestial Marshal",
      "Luminarch Radiant Lancer",
      "Luminarch Aurora Seraph",
    ],
    playPatterns: [
      "Removal targeted",
      "PREFERIR boss que JÁ USOU EFEITO como custo (gerou valor)",
      "Trade favorável",
      "Boss menor que ameaça = bom custo",
    ],
    value: 12,
    preferUsedBossesAsCost: true,
  },

  "Luminarch Crescent Shield": {
    role: "equip_protection",
    priority: 5,
    effect: "Equip Luminarch → +500 DEF. Destruído em batalha → envie isto",
    synergies: ["Luminarch Aegisbearer", "Luminarch Sanctum Protector"],
    playPatterns: [
      "Proteger Aegisbearer (3000 DEF total)",
      "Battle protection",
      "Slow play",
    ],
    value: 8,
  },

  "Luminarch Spear of Dawnfall": {
    role: "debuff",
    priority: 6,
    effect: "Controle Luminarch → ATK/DEF de 1 monstro oponente vira 0",
    synergies: [
      "Luminarch Valiant - Knight of the Dawn",
      "Luminarch Celestial Marshal",
      "Luminarch Radiant Lancer",
    ],
    playPatterns: [
      "Remoção indireta (zerar stats)",
      "COMBO PIERCING: Zerar DEF de defender → Valiant/Marshal piercing = dano direto",
      "Neutralizar boss oponente (2800+ ATK → 0)",
      "Setup para lethal quando oponente está em DEF mode",
    ],
    value: 10,
    piercingCombo: true, // Sinaliza sinergia com piercing
  },

  "Luminarch Moonlit Blessing": {
    role: "recursion",
    priority: 9,
    effect: "1 Luminarch da GY → mão. Com Citadel: pode SS. 1x/turn ativação",
    synergies: [
      "Sanctum of the Luminarch Citadel",
      "Luminarch Magic Sickle",
      "Luminarch Aegisbearer",
    ],
    playPatterns: [
      "COM CITADEL: GY → campo direto (insano)",
      "SEM CITADEL: ainda útil para recursão",
      "Recovery após trade",
    ],
    value: 18, // Recursão forte
  },

  "Luminarch Sacred Judgment": {
    role: "comeback_tool",
    priority: 3,
    effect:
      "Campo vazio + opp 2+ → pague 2000 LP: SS Luminarch da GY (até N monstros opp) + gain 500 LP/cada",
    synergies: [
      "Luminarch Aegisbearer",
      "Luminarch Aurora Seraph",
      "Luminarch Megashield Barbarias",
    ],
    playPatterns: [
      "Desperation play",
      "Custo MUITO alto (2000 LP)",
      "Só em board wipe scenarios",
    ],
    value: 5,
  },

  // ═════════════════════════════════════════════════════════════════════════
  // EXTRA DECK
  // ═════════════════════════════════════════════════════════════════════════

  "Luminarch Megashield Barbarias": {
    role: "fusion_tank",
    priority: 7,
    summonCondition: "fusion_mid_late",
    effect:
      "Materiais: Sanctum Protector + Lv5+. Lifegain dobrado. 1x/turn: switch + buff ATK",
    synergies: [
      "Sanctum of the Luminarch Citadel",
      "Luminarch Aurora Seraph",
      "Luminarch Holy Shield",
    ],
    playPatterns: [
      "Lifegain x2 = insano com Citadel/Aurora",
      "3000 DEF = wall forte",
      "Switch position = flexibilidade",
    ],
    value: 14,
    fusionMaterials: ["Luminarch Sanctum Protector", "Lv5+ Luminarch"],
  },

  "Luminarch Fortress Aegis": {
    role: "ascension_tank",
    priority: 6,
    summonCondition: "ascension_aegisbearer_2turns",
    effect:
      "Material: Aegisbearer (2 turnos). Taunt. Ascension SS → +500 LP/Luminarch. 1x/turn: pague 1000 LP → revive DEF 2000-",
    synergies: [
      "Luminarch Aegisbearer",
      "Sanctum of the Luminarch Citadel",
      "Luminarch Magic Sickle",
    ],
    playPatterns: [
      "Ascender Aegisbearer após 2 turnos",
      "Heal ao entrar + revive recursivo",
      "Taunt mantém proteção",
    ],
    value: 13,
  },
};

/**
 * Helper: verifica se carta é do arquétipo Luminarch
 */
export function isLuminarchByName(name) {
  if (!name) return false;
  return name.includes("Luminarch") || name.includes("Sanctum");
}

/**
 * Helper: verifica se carta é Luminarch (via objeto)
 */
export function isLuminarch(card) {
  if (!card) return false;
  return card.archetype === "Luminarch" || isLuminarchByName(card.name);
}

/**
 * Helper: pega knowledge de uma carta
 */
export function getCardKnowledge(cardName) {
  return CARD_KNOWLEDGE[cardName] || null;
}

/**
 * Helper: lista cartas por role
 */
export function getCardsByRole(role) {
  return Object.entries(CARD_KNOWLEDGE)
    .filter(([_, knowledge]) => knowledge.role === role)
    .map(([name, _]) => name);
}

/**
 * Helper: prioridade de uma carta
 */
export function getCardPriority(cardName) {
  const knowledge = CARD_KNOWLEDGE[cardName];
  return knowledge ? knowledge.priority : 1;
}
