// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/luminarch/knowledge.js
// Base de conhecimento: cartas Luminarch, roles, prioridades, sinergias
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Card knowledge database para Luminarch.
 * Cada carta tem: role, priority, summonCondition, synergies, playPatterns, value.
 */
export const LUMINARCH_LINE_PACKAGES = Object.freeze({
  STARTER: "starter",
  CITADEL: "citadel",
  WALL: "wall",
  FUSION: "fusion",
  ASCENSION: "ascension",
  GRIND: "grind",
  BATTLE_CONVERSION: "battle_conversion",
  LP_PAYOFF: "lp_payoff",
  COMEBACK: "comeback",
});

export const LUMINARCH_PACKAGE_STATUS = Object.freeze({
  SUPPORTED: "supported",
  PARTIAL: "partial",
  NEEDS_ACTION_GENERATION: "needs_action_generation",
  NEEDS_SIMULATION: "needs_simulation",
  NEEDS_MAIN_BATTLE_MAIN2: "needs_mainBattleMain2",
  REACTIVE_ENGINE_ONLY: "reactive_engine_only",
});

export const LUMINARCH_CARD_ROLES = Object.freeze({
  "Luminarch Valiant - Knight of the Dawn": [
    "starter",
    "searcher",
    "finisher",
    "ascension_material",
  ],
  "Luminarch Sanctified Arbiter": ["starter", "searcher"],
  "Luminarch Aegisbearer": ["wall", "protection", "ascension_material"],
  "Luminarch Moonblade Captain": ["starter", "recursion", "battle_conversion"],
  "Luminarch Celestial Marshal": ["extender", "wall", "lp_payoff"],
  "Luminarch Magic Sickle": ["battle_trick", "recursion", "grind"],
  "Luminarch Sanctum Protector": ["wall", "protection", "fusion_material"],
  "Luminarch Radiant Lancer": ["finisher", "battle_conversion", "removal"],
  "Luminarch Aurora Seraph": ["finisher", "lp_payoff", "protection"],
  "Luminarch Enchanted Halberd": ["extender", "fusion_material"],
  "Luminarch Holy Shield": ["protection", "lp_payoff", "battle_trick"],
  "Luminarch Knights Convocation": ["starter", "searcher", "grind", "protection"],
  "Sanctum of the Luminarch Citadel": ["citadel", "wall", "protection", "lp_payoff"],
  "Luminarch Holy Ascension": ["battle_trick", "protection", "lp_payoff"],
  "Luminarch Radiant Wave": ["removal", "grind"],
  "Luminarch Crescent Shield": ["protection", "wall"],
  "Luminarch Spear of Dawnfall": ["battle_conversion", "removal", "finisher"],
  "Luminarch Moonlit Blessing": ["recursion", "grind", "extender"],
  "Luminarch Sacred Judgment": ["comeback", "recursion", "lp_payoff"],
  "Luminarch Sunforged Blade": ["lp_payoff", "battle_conversion", "finisher"],
  Polymerization: ["fusion"],
  "Luminarch Pure Knight": ["fusion_payoff", "citadel", "searcher", "lp_payoff"],
  "Luminarch Megashield Barbarias": ["fusion_payoff", "wall", "lp_payoff"],
  "Luminarch Fortress Aegis": ["ascension_payoff", "wall", "recursion"],
  "Luminarch Ethereal Lancer": [
    "ascension_payoff",
    "finisher",
    "battle_conversion",
    "lp_payoff",
  ],
});

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
    ascensionTarget: "Luminarch Ethereal Lancer",
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
    role: "defensive_boss",
    priority: 6,
    summonCondition: "mid_late_game",
    linePackages: [
      LUMINARCH_LINE_PACKAGES.WALL,
      LUMINARCH_LINE_PACKAGES.LP_PAYOFF,
    ],
    status: LUMINARCH_PACKAGE_STATUS.NEEDS_ACTION_GENERATION,
    effect:
      "Pode pagar 2000 LP para Special Summon da mão. 1x/turn: nega sua destruição em batalha. Se for destruído em batalha: ganha 1000 LP",
    synergies: [
      "Luminarch Holy Ascension",
      "Sanctum of the Luminarch Citadel",
      "Luminarch Radiant Wave",
    ],
    playPatterns: [
      "Tank de 2500 DEF com proteção",
      "Special Summon pagando LP apenas quando cria wall real, reduz lethal ou abre Fusion/Ascension",
      "Buffar com Holy Ascension para pressão ou defesa",
    ],
    lpPolicy:
      "Pagar 2000 LP só deve ser bom quando o corpo final estabiliza ou vira payoff; nunca pagar se deixar em lethal provável.",
    value: 12,
  },

  "Luminarch Magic Sickle": {
    role: "battle_trick_spell_recovery",
    priority: 7,
    summonCondition: "hold_for_battle_or_spell_recovery",
    linePackages: [
      LUMINARCH_LINE_PACKAGES.BATTLE_CONVERSION,
      LUMINARCH_LINE_PACKAGES.GRIND,
    ],
    status: LUMINARCH_PACKAGE_STATUS.PARTIAL,
    effect:
      "Da mão na Etapa de Dano: envia ao GY para buffar Luminarch batalhando. Do GY: bane para recuperar 1 Magia Luminarch",
    synergies: [
      "Luminarch Holy Shield",
      "Luminarch Spear of Dawnfall",
      "Luminarch Moonblade Captain",
    ],
    playPatterns: [
      "Segurar na mão para vencer batalha chave",
      "No GY, recuperar Magia apenas quando houver uso real, alto valor ou follow-up claro",
      "Protege ataques de valor sem ocupar campo",
      "Não é mais motor de reciclar 2 monstros; não contar como recuperação genérica",
    ],
    recoveryPolicy:
      "Banir do GY só para Moonlit, Holy Shield, Holy Ascension, Radiant Wave, Spear, Sacred Judgment, Sunforged ou Citadel quando a carta recuperada importa para o estado.",
    value: 11,
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
      "Magic Sickle agora vale mais como truque de batalha na mão do que como custo",
      "Sinergiza com LP-gain strategy",
      "Sacrificar Halberd/Sickle > Aegis/Protector como custo de proteção",
    ],
    value: 13,
    preferredSacrificeTargets: ["Luminarch Enchanted Halberd"],
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
    effect: "1x/turn: discard Lv5+ Luminarch → add Lv4- da deck; first Luminarch monster destruction each turn is negated",
    synergies: [
      "Luminarch Celestial Marshal",
      "Luminarch Sanctum Protector",
      "Luminarch Aurora Seraph",
      "Luminarch Valiant - Knight of the Dawn",
      "Luminarch Sanctified Arbiter",
    ],
    playPatterns: [
      "⚠️ BRICK ESCAPE: 2+ Lv5+ na mão sem searchers → ALTA PRIORIDADE",
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
    linePackages: [
      LUMINARCH_LINE_PACKAGES.CITADEL,
      LUMINARCH_LINE_PACKAGES.WALL,
      LUMINARCH_LINE_PACKAGES.LP_PAYOFF,
    ],
    status: LUMINARCH_PACKAGE_STATUS.SUPPORTED,
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
      "Usar buff quando LP alto ou quando o buff muda combate/ameaça",
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
    effect: "Se controlar Luminarch ou tiver Luminarch no GY: pague 2000 LP → destrua 1 carta do oponente",
    synergies: [
      "Luminarch Celestial Marshal",
      "Luminarch Radiant Lancer",
      "Luminarch Aurora Seraph",
    ],
    playPatterns: [
      "Removal targeted",
      "Usar quando o alvo compensa custo de LP",
      "Pure Knight reduz custo e melhora a troca",
      "Remover boss, floodgate ou ameaça letal",
    ],
    value: 12,
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
      "Luminarch Radiant Lancer",
    ],
    playPatterns: [
      "Remoção indireta (zerar stats)",
      "COMBO PIERCING: Zerar DEF de defender → Valiant piercing = dano direto",
      "Neutralizar boss oponente (2800+ ATK → 0)",
      "Setup para lethal quando oponente está em DEF mode",
    ],
    value: 10,
    piercingCombo: true, // Sinaliza sinergia com piercing
  },

  "Luminarch Sunforged Blade": {
    role: "lp_payoff_equip",
    priority: 5,
    linePackages: [
      LUMINARCH_LINE_PACKAGES.LP_PAYOFF,
      LUMINARCH_LINE_PACKAGES.BATTLE_CONVERSION,
    ],
    status: LUMINARCH_PACKAGE_STATUS.NEEDS_MAIN_BATTLE_MAIN2,
    effect:
      "Equipe a 1 Luminarch. Cada ganho de LP coloca Solar Counter; o equipado ganha +200 ATK/DEF por counter. 1x/turn: pague 1000 LP para impedir destruição por batalha do equipado",
    synergies: [
      "Sanctum of the Luminarch Citadel",
      "Luminarch Holy Shield",
      "Luminarch Aurora Seraph",
      "Luminarch Megashield Barbarias",
      "Luminarch Magic Sickle",
    ],
    playPatterns: [
      "Equip só escala se houver fonte real de ganho de LP",
      "Com Citadel/Holy Shield transforma ataques do oponente em stats permanentes",
      "Guardar LP para proteger o monstro equipado quando isso preservar wall/payoff real",
      "Com Barbarias o ganho de LP fica mais seguro, mas os counters continuam por evento de cura",
    ],
    value: 9,
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
      "Opp 2+ → pague 2000 LP: SS Luminarch da GY (até N monstros opp) + gain 500 LP/cada",
    synergies: [
      "Luminarch Aegisbearer",
      "Luminarch Aurora Seraph",
      "Luminarch Megashield Barbarias",
    ],
    playPatterns: [
      "Desperation play",
      "Custo MUITO alto (2000 LP)",
      "Usar quando a GY converte em campo suficiente",
    ],
    value: 5,
  },

  // ═════════════════════════════════════════════════════════════════════════
  // EXTRA DECK
  // ═════════════════════════════════════════════════════════════════════════

  "Luminarch Megashield Barbarias": {
    role: "fusion_wall_lp_payoff",
    priority: 7,
    summonCondition: "fusion_mid_late",
    linePackages: [
      LUMINARCH_LINE_PACKAGES.FUSION,
      LUMINARCH_LINE_PACKAGES.WALL,
      LUMINARCH_LINE_PACKAGES.LP_PAYOFF,
    ],
    status: LUMINARCH_PACKAGE_STATUS.PARTIAL,
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
      "Escolher via Polymerization quando a linha precisa de wall/payoff defensivo, não por prioridade fixa",
    ],
    value: 14,
    fusionMaterials: ["Luminarch Sanctum Protector", "Lv5+ Luminarch"],
  },

  "Luminarch Pure Knight": {
    role: "fusion_citadel_access",
    priority: 8,
    summonCondition: "fusion_when_need_citadel_or_lp_discount",
    linePackages: [
      LUMINARCH_LINE_PACKAGES.FUSION,
      LUMINARCH_LINE_PACKAGES.CITADEL,
      LUMINARCH_LINE_PACKAGES.LP_PAYOFF,
    ],
    status: LUMINARCH_PACKAGE_STATUS.NEEDS_ACTION_GENERATION,
    effect:
      "Materiais: 2 Luminarch. Fusion Summon → busca Citadel. 2x/turn: reduz em 1000 LP o custo de efeito de Magia/Armadilha Luminarch",
    synergies: [
      "Sanctum of the Luminarch Citadel",
      "Luminarch Holy Ascension",
      "Luminarch Radiant Wave",
      "Luminarch Sacred Judgment",
    ],
    playPatterns: [
      "Fusion barata para acessar Citadel quando Arbiter não resolve",
      "Redutor de custo para transformar PV em recurso com segurança",
      "Papel distinto de Barbarias: não é wall principal, é acesso/eficiência",
    ],
    value: 15,
    fusionMaterials: ["2 Luminarch monsters"],
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

  "Luminarch Ethereal Lancer": {
    role: "ascension_offense",
    priority: 7,
    summonCondition: "ascension_valiant",
    linePackages: [
      LUMINARCH_LINE_PACKAGES.ASCENSION,
      LUMINARCH_LINE_PACKAGES.BATTLE_CONVERSION,
      LUMINARCH_LINE_PACKAGES.LP_PAYOFF,
    ],
    status: LUMINARCH_PACKAGE_STATUS.SUPPORTED,
    effect:
      "Material: Valiant. Ascension SS buffs another face-up monster's DEF and gains ATK. Double piercing damage vs DEF. Battle destroy gains 1000 LP",
    synergies: [
      "Luminarch Valiant - Knight of the Dawn",
      "Luminarch Spear of Dawnfall",
      "Luminarch Magic Sickle",
      "Luminarch Sunforged Blade",
    ],
    playPatterns: [
      "Ascend Valiant when the line needs pressure",
      "Prefer attack position to threaten double piercing damage",
      "Pair with DEF-zeroing effects for large damage conversion",
      "Use with another face-up monster when possible to capture the summon buff",
    ],
    value: 14,
    ascensionMaterial: "Luminarch Valiant - Knight of the Dawn",
  },

  Polymerization: {
    role: "fusion_enabler",
    priority: 7,
    linePackages: [LUMINARCH_LINE_PACKAGES.FUSION],
    status: LUMINARCH_PACKAGE_STATUS.NEEDS_ACTION_GENERATION,
    effect:
      "Fusion Summon usando materiais da mão/campo. No Luminarch, deve avaliar Pure Knight e Megashield Barbarias por estado final",
    synergies: [
      "Luminarch Pure Knight",
      "Luminarch Megashield Barbarias",
    ],
    playPatterns: [
      "Pure Knight quando precisa de Citadel, redução de custo ou Fusion barata",
      "Barbarias quando precisa de wall, payoff defensivo ou conversão de ganho de LP",
      "Não limitar o conhecimento a Barbarias; escolher por estado",
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
 * Helper: lista roles estratégicos declarados para uma carta.
 */
export function getCardRoles(cardName) {
  const declared = LUMINARCH_CARD_ROLES[cardName] || [];
  const knowledge = CARD_KNOWLEDGE[cardName];
  const primary = knowledge?.role ? [knowledge.role] : [];
  return [...new Set([...primary, ...declared])];
}

/**
 * Helper: verifica se uma carta tem determinado role.
 */
export function cardHasRole(cardName, role) {
  return getCardRoles(cardName).includes(role);
}

/**
 * Helper: lista cartas por role
 */
export function getCardsByRole(role) {
  return Object.entries(CARD_KNOWLEDGE)
    .filter(([name, knowledge]) =>
      knowledge.role === role || getCardRoles(name).includes(role)
    )
    .map(([name, _]) => name);
}

/**
 * Helper: lista cartas ligadas a um pacote de linha.
 */
export function getCardsByLinePackage(linePackage) {
  return Object.entries(CARD_KNOWLEDGE)
    .filter(([_, knowledge]) => (knowledge.linePackages || []).includes(linePackage))
    .map(([name, _]) => name);
}

/**
 * Helper: prioridade de uma carta
 */
export function getCardPriority(cardName) {
  const knowledge = CARD_KNOWLEDGE[cardName];
  return knowledge ? knowledge.priority : 1;
}
