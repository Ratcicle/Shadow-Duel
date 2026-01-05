// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/shadowheart/knowledge.js
// Knowledge base para cartas Shadow-Heart — roles, valores, sinergias.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Banco de conhecimento sobre cada carta Shadow-Heart.
 * Organizado por nome canônico da carta.
 *
 * @type {Object<string, CardKnowledge>}
 */
export const CARD_KNOWLEDGE = {
  // ===== MONSTROS =====
  "Shadow-Heart Scale Dragon": {
    role: "boss",
    priority: 10,
    summonCondition: "3_tributes",
    effect: "Ao destruir por batalha, recupera 1 Shadow-Heart do GY",
    synergies: ["Darkness Valley", "Shadow-Heart Rage", "Polymerization"],
    playPatterns: [
      "Invocar quando tiver 3 tributos disponíveis",
      "Proteger com Shadow-Heart Shield",
      "Usar Shadow-Heart Rage para 3700 ATK + 2 ataques",
      "Usar como material para Demon Dragon Fusion",
    ],
    value: 15,
  },
  "Shadow-Heart Demon Dragon": {
    role: "fusion_boss",
    priority: 12,
    summonCondition: "fusion_scale_dragon_plus_lv5",
    effect: "Ao ser Fusion Summoned, destrói 2 cartas do oponente",
    synergies: ["Polymerization", "Shadow-Heart Scale Dragon"],
    playPatterns: [
      "Fusion Summon quando oponente tem 2+ ameaças no campo",
      "Usar efeito de destruição para limpar backrow perigoso",
      "Se destruído, revive Scale Dragon do GY",
    ],
    value: 18,
  },
  "Shadow-Heart Demon Arctroth": {
    role: "boss",
    priority: 8,
    summonCondition: "2_tributes",
    effect: "Ao ser Tribute Summoned, destrói 1 monstro do oponente",
    synergies: ["Shadow-Heart Imp", "tributes"],
    playPatterns: [
      "Tribute Summon quando oponente tem monstro forte no campo",
      "Usar Imp + outro monstro como tributo",
      "Combina remoção com presença de 2600 ATK",
    ],
    value: 10,
  },
  "Shadow-Heart Griffin": {
    role: "beater",
    priority: 7,
    summonCondition: "no_tribute_if_empty_field",
    effect: "Sem tributo se campo vazio",
    synergies: ["comeback"],
    playPatterns: [
      "Invocar sem tributo quando perdendo",
      "Bom para abrir jogo ou recuperar",
      "2000 ATK sólido para nível 5",
    ],
    value: 7,
  },
  "Shadow-Heart Imp": {
    role: "extender",
    priority: 9,
    summonCondition: "normal",
    effect:
      "Ao ser Normal Summoned, Special Summon 1 Shadow-Heart lv4 ou menor da mão",
    synergies: [
      "Shadow-Heart Gecko",
      "Shadow-Heart Specter",
      "Shadow-Heart Coward",
      "tributes",
    ],
    playPatterns: [
      "Normal Summon para gerar 2 monstros no campo",
      "Usar para preparar Tribute Summon de Arctroth",
      "Combo: Imp → Gecko → Batalha → Draw",
      "Gera recursos para fusão",
    ],
    value: 8,
  },
  "Shadow-Heart Gecko": {
    role: "draw_engine",
    priority: 6,
    summonCondition: "normal",
    effect: "Se monstro oponente é destruído por batalha, compra 1",
    synergies: ["Shadow-Heart Imp", "atacadores fortes"],
    playPatterns: [
      "Manter no campo enquanto ataca com outros monstros",
      "Gera vantagem de cartas passivamente",
      "Bom alvo para Special Summon do Imp",
    ],
    value: 5,
  },
  "Shadow-Heart Specter": {
    role: "recursion",
    priority: 7,
    summonCondition: "normal",
    effect: "Se for pro GY, adiciona 1 Shadow-Heart do GY à mão",
    synergies: ["tributes", "Shadow-Heart Infusion", "discard"],
    playPatterns: [
      "Usar como tributo para recuperar boss do GY",
      "Descartar para Infusion e recuperar outro monstro",
      "Combo: Tributa Specter → Recupera Scale Dragon do GY",
    ],
    value: 6,
    goodTribute: true, // Flag: bom tributo porque ativa efeito
  },
  "Shadow-Heart Coward": {
    role: "discard_effect",
    priority: 5,
    summonCondition: "normal",
    effect: "Se descartado, corta ATK/DEF de 1 monstro oponente pela metade",
    synergies: ["Shadow-Heart Infusion", "discard costs"],
    playPatterns: [
      "Descartar para Infusion para debuffar ameaça do oponente",
      "Transforma desvantagem em remoção soft",
      "Permite que monstros mais fracos vençam batalhas",
    ],
    value: 4,
    goodDiscard: true, // Flag: bom para descartar
  },
  "Shadow-Heart Abyssal Eel": {
    role: "utility",
    priority: 6,
    summonCondition: "normal",
    effect:
      "Se atacado em DEF: 600 dano. Pode se enviar ao GY para Special Summon Leviathan",
    synergies: ["Shadow-Heart Leviathan", "burn"],
    playPatterns: [
      "Setar em defesa para bait de ataque + burn",
      "Usar efeito ignition para Special Summon Leviathan",
      "Não desperdiçar se não tiver Leviathan na mão",
    ],
    value: 5,
  },
  "Shadow-Heart Leviathan": {
    role: "beater_burn",
    priority: 6,
    summonCondition: "special_or_normal",
    effect:
      "Queima 500 ao destruir; 800 se destruído por batalha. Ótimo alvo para Eel ou extender de mão",
    synergies: ["Shadow-Heart Abyssal Eel", "burn", "OTK setups"],
    playPatterns: [
      "Special via Eel para pressionar imediatamente",
      "Atacar monstros fracos para garantir burn e limpar campo",
      "Se estiver em risco de destruição, trocar por remoção forçada do oponente",
    ],
    value: 6,
  },
  "Shadow-Heart Death Wyrm": {
    role: "hand_trap_boss",
    priority: 7,
    summonCondition: "special_from_hand_on_battle_destroy",
    effect:
      "Quick Effect: entra da mão quando Shadow-Heart é destruído por batalha",
    synergies: ["grind games", "tempo swing", "reposição de campo"],
    playPatterns: [
      "Segurar na mão como interrupção após trades desfavoráveis",
      "Aproveitar destruição de fodders (Imp/Gecko) para trazer 2400 ATK imediato",
      "Após entrar, usar para pressionar ou tributar para Arctroth se necessário",
    ],
    value: 7,
  },

  // ===== SPELLS =====
  Polymerization: {
    role: "fusion_enabler",
    priority: 10,
    playCondition: "scale_dragon_in_field_and_lv5_material",
    effect: "Fusion Summon Demon Dragon",
    synergies: ["Shadow-Heart Scale Dragon", "Shadow-Heart Demon Dragon"],
    playPatterns: [
      "Ativar quando Scale Dragon está no campo + material lv5+",
      "Destruir 2 cartas do oponente é game-changing",
      "Não usar se oponente tem backrow suspeito que pode negar",
    ],
    value: 12,
  },
  "Darkness Valley": {
    role: "field_spell",
    priority: 9,
    playCondition: "has_shadowheart_monsters",
    effect:
      "+300 ATK para todos Shadow-Heart. Destrói atacante se boss lv8+ é destruído",
    synergies: ["todos os monstros Shadow-Heart"],
    playPatterns: [
      "Ativar PRIMEIRO antes de summonar",
      "Transforma monstros medianos em ameaças",
      "Protege bosses de trades ruins",
    ],
    value: 8,
  },
  "Shadow-Heart Rage": {
    role: "combat_trick",
    priority: 7,
    playCondition: "scale_dragon_alone_on_field",
    effect: "Scale Dragon ganha 700 ATK/DEF e pode atacar 2x",
    synergies: ["Shadow-Heart Scale Dragon"],
    playPatterns: [
      "Usar durante Battle Phase com Scale Dragon sozinho",
      "3700 ATK com 2 ataques = OTK potential",
      "Guardar para turno de lethal",
    ],
    value: 7,
  },
  "Shadow-Heart Infusion": {
    role: "graveyard_revival",
    priority: 8,
    playCondition: "2_cards_in_hand_and_shadowheart_in_gy",
    effect: "Descarta 2, revive Shadow-Heart do GY",
    synergies: ["Shadow-Heart Specter", "Shadow-Heart Coward", "bosses no GY"],
    playPatterns: [
      "Descartar Specter para recuperar 2 monstros (1 do efeito + 1 do Specter)",
      "Descartar Coward para debuffar oponente enquanto revive",
      "Reviver Scale Dragon ou Arctroth do GY",
    ],
    value: 7,
  },
  "Shadow-Heart Covenant": {
    role: "searcher",
    priority: 8,
    playCondition: "800_lp_available",
    effect: "Paga 800 LP, busca qualquer Shadow-Heart do deck",
    synergies: ["setup", "combos"],
    playPatterns: [
      "Buscar Imp para extender",
      "Buscar Scale Dragon se tiver tributos",
      "Buscar Infusion se tiver setup no GY",
    ],
    value: 6,
  },
  "Shadow-Heart Battle Hymn": {
    role: "combat_buff",
    priority: 5,
    playCondition: "has_shadowheart_monsters_on_field",
    effect: "+500 ATK para todos Shadow-Heart até fim do turno",
    synergies: ["múltiplos monstros", "batalha"],
    playPatterns: [
      "Usar antes de Battle Phase com 2+ monstros",
      "Stacka com Darkness Valley para +800 total",
    ],
    value: 4,
  },
  "Shadow-Heart Shield": {
    role: "protection",
    priority: 6,
    playCondition: "has_monster_to_protect",
    effect: "+500 ATK/DEF, indestrutível por batalha, custo 800 LP/turno",
    synergies: ["bosses", "proteção"],
    playPatterns: [
      "Equipar em Scale Dragon ou Arctroth",
      "Considerar custo de LP a longo prazo",
      "Bom se estiver ganhando e quer manter vantagem",
    ],
    value: 5,
  },
  "Shadow-Heart Purge": {
    role: "removal",
    priority: 7,
    playCondition: "opponent_has_monsters",
    effect: "Destrói 1 monstro oponente",
    synergies: ["remoção", "setup para ataque direto"],
    playPatterns: [
      "Remover ameaça antes de atacar",
      "Priorizar bosses do oponente",
      "Usar para abrir caminho para lethal",
    ],
    value: 6,
  },
};

/**
 * Lista de bosses Shadow-Heart (nomes).
 * @type {string[]}
 */
export const BOSS_NAMES = [
  "Shadow-Heart Scale Dragon",
  "Shadow-Heart Demon Dragon",
  "Shadow-Heart Demon Arctroth",
];

/**
 * Verifica se um card é Shadow-Heart pelo archetype.
 * @param {Object} card
 * @returns {boolean}
 */
export function isShadowHeart(card) {
  if (!card) return false;
  const archetypes = Array.isArray(card.archetypes)
    ? card.archetypes
    : card.archetype
    ? [card.archetype]
    : [];
  return archetypes.includes("Shadow-Heart");
}

/**
 * Verifica se um card é Shadow-Heart pelo nome.
 * @param {string} name
 * @returns {boolean}
 */
export function isShadowHeartByName(name) {
  return name && name.startsWith("Shadow-Heart");
}

/**
 * Retorna conhecimento de uma carta pelo nome.
 * @param {string} name
 * @returns {CardKnowledge|null}
 */
export function getCardKnowledge(name) {
  return CARD_KNOWLEDGE[name] || null;
}

/**
 * Verifica se uma carta é boss.
 * @param {string} name
 * @returns {boolean}
 */
export function isBoss(name) {
  const knowledge = CARD_KNOWLEDGE[name];
  return knowledge?.role === "boss" || knowledge?.role === "fusion_boss";
}

/**
 * Verifica se uma carta é boa para tributar.
 * @param {string} name
 * @returns {boolean}
 */
export function isGoodTribute(name) {
  const knowledge = CARD_KNOWLEDGE[name];
  return knowledge?.goodTribute === true;
}

/**
 * Verifica se uma carta é boa para descartar.
 * @param {string} name
 * @returns {boolean}
 */
export function isGoodDiscard(name) {
  const knowledge = CARD_KNOWLEDGE[name];
  return knowledge?.goodDiscard === true;
}
