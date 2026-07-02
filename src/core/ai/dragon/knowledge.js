// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/dragon/knowledge.js
// Knowledge base for Dragon deck cards — roles, values, synergies.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @type {Object<string, CardKnowledge>}
 */
export const CARD_KNOWLEDGE = {
  // ===== EXTREME DRAGONS (level 10 bosses) =====
  "Fire Extreme Dragon": {
    role: "boss",
    priority: 10,
    atk: 3000,
    def: 2600,
    level: 10,
    isExtremeDragon: true,
    summonCondition: "special_via_jagged_peak_or_tribute",
    effect: "Lone effect protection. Burn half opponent ATK on battle destroy. 300 burn per opponent activation.",
    synergies: ["Jagged Peak of the Dragons", "Call of the Haunted"],
    playPatterns: [
      "Best when opponent activates many effects (burn stacks)",
      "Best when alone on field (lone protection activates)",
      "High ATK 3000 wins most battles",
    ],
    situationScore: {
      opponentActivationsPressure: 3,  // Extra score when opp activates many effects
      aggressive: 2,
    },
    value: 15,
  },
  "Volcanic Extreme Dragon": {
    role: "boss",
    priority: 8,
    atk: 2600,
    def: 3000,
    level: 10,
    isExtremeDragon: true,
    summonCondition: "special_via_jagged_peak_or_tribute",
    effect: "Battle indestructible when alone. 600 burn on battle. Once per duel, banish both GYs for 100 per card burn.",
    synergies: ["Jagged Peak of the Dragons", "Extreme Dragon Awakening", "Call of the Haunted"],
    playPatterns: [
      "Best when alone (battle indestructible)",
      "Use both-GY banish effect only for lethal, a large burn swing, or to deny opponent GY value",
      "Avoid the once-per-duel effect if own GY still fuels Solar, Lunar, Stelya, Purified, Luminous, Grey, Hellkite, Call, or Radiant revive",
    ],
    situationScore: {
      alone: 2,
    },
    dangerousEffect: "gy_banish_resource_cost",
    value: 10,
  },
  "Mist Extreme Dragon": {
    role: "boss",
    priority: 5,
    atk: 2800,
    def: 2500,
    level: 10,
    isExtremeDragon: true,
    summonCondition: "special_via_jagged_peak_or_tribute",
    effect: "Opponent's newly summoned monsters can't attack. Bounce 1 opp card. On battle destroy: shuffle opp field to deck.",
    synergies: ["Jagged Peak of the Dragons"],
    playPatterns: [
      "Best when opponent just summoned multiple monsters (restricts attacks)",
      "Bounce effect removes key threats",
      "High ATK 2800 + bounce = strong control",
    ],
    situationScore: {
      opponentRecentSummon: 3,
      oppFieldHasMultiple: 2,
    },
    value: 13,
    legacyOnly: true,
    outOfPlan: true,
  },
  "Galaxy Extreme Dragon": {
    role: "boss",
    priority: 5,
    atk: 2900,
    def: 2900,
    level: 10,
    isExtremeDragon: true,
    summonCondition: "special_via_jagged_peak_or_tribute",
    effect: "Opponent GY cards are banished instead. Once per duel: self-banish to survive + banish 1 opp card.",
    synergies: ["Jagged Peak of the Dragons"],
    playPatterns: [
      "Best when opponent relies on GY (macro cosmos effect denies them)",
      "Once per duel survival is very powerful",
      "2900 ATK wins most battles",
    ],
    situationScore: {
      opponentGyDependent: 3,
      endangered: 2,  // when would be destroyed otherwise
    },
    value: 14,
    legacyOnly: true,
    outOfPlan: true,
  },
  "Forest Extreme Dragon": {
    role: "boss",
    priority: 4,
    atk: 2500,
    def: 2700,
    level: 10,
    isExtremeDragon: true,
    summonCondition: "special_via_jagged_peak_or_tribute",
    effect: "Standby: heal 200 per opp card + hand. Gain 100 LP per opp summon/effect. Quick: gain ATK = total LP gained this turn.",
    synergies: ["Jagged Peak of the Dragons"],
    playPatterns: [
      "Best in long games when opponent has large hand/field",
      "LP recovery useful when bot is losing LP",
      "ATK gain can become very high if opponent activates many effects",
    ],
    situationScore: {
      loseLP: 3,
      longGame: 2,
    },
    value: 11,
    legacyOnly: true,
    outOfPlan: true,
  },

  // ===== MAIN DECK MONSTERS =====
  "Solar Eclipse Dragon": {
    role: "eclipse_starter",
    priority: 13,
    atk: 1700,
    def: 1100,
    level: 4,
    summonCondition: "hand_ignition_discard_self_for_lunar",
    effect: "Discard self to Special Summon Lunar from hand or Deck, then reduce hand monster levels by 2. GY effect banishes self to revive a Level 4 or lower Dragon from GY.",
    synergies: ["Lunar Eclipse Dragon", "Armored Dragon", "Stelya, Dragon Tamer", "Luminescent Dragon", "Radiant Cosmic Dragon"],
    playPatterns: [
      "Primary Eclipse starter: self-discard turns on Lunar and loads Solar's GY revive",
      "Prefer the hand ignition when Lunar is available in Deck or hand and there is a monster zone",
      "GY revive extends into Armored, Lunar, Stelya, Luminescent, Voltaic, or Grey lines",
      "LIGHT Dragon body and level reducer can unlock Radiant or tribute lines after the Lunar follow-up",
    ],
    tags: ["eclipse", "hand_starter", "good_discard", "gy_revive_l4", "level_reduction", "light_material"],
    goodDiscard: true,
    eclipseEngine: true,
    currentBotCore: true,
    value: 12,
  },
  "Lunar Eclipse Dragon": {
    role: "eclipse_searcher",
    priority: 12,
    atk: 1100,
    def: 1700,
    level: 4,
    summonCondition: "normal_or_special_summon_search",
    effect: "On Normal or Special Summon, discard 1 card to add a Level 4 or lower Dragon from Deck, then optionally Special Summon Solar from hand or GY. GY effect banishes self to Special Summon a Level 4 or lower Dragon from Deck.",
    synergies: ["Solar Eclipse Dragon", "Armored Dragon", "Stelya, Dragon Tamer", "Voltaic Dragon", "Luminescent Dragon"],
    playPatterns: [
      "Best Normal Summon when hand has discard fodder and Deck has a low-level Dragon search target",
      "Special Summon from Solar to convert Solar's cost into a search plus optional Solar revive",
      "GY effect is a Deck extender and can summon another Lunar when that is the strongest available line",
      "DARK level 4 body fills Eclipse, tribute, and fusion material roles",
    ],
    tags: ["eclipse", "normal_summon_starter", "special_summon_trigger", "discard_outlet", "deck_extender_l4"],
    goodSearchTarget: "lv4_dragon",
    eclipseEngine: true,
    currentBotCore: true,
    value: 12,
  },
  "Black Bull Dragon": {
    role: "beater",
    priority: 8,
    atk: 2500,
    def: 2000,
    level: 8,
    summonCondition: "discard_2_dragons_from_hand",
    effect: "SS by discarding 2 Dragons from hand (can't attack same turn). Double attack on monsters. GY banish self to search lv7-8 Dragon.",
    synergies: ["Voltaic Dragon", "Solar Eclipse Dragon", "Lunar Eclipse Dragon", "Grey Dragon", "GY setup"],
    playPatterns: [
      "Discard Voltaic Dragon (triggers 800 burn) + another Dragon for SS cost",
      "Use as GY search engine after it's destroyed",
      "Cannot attack turn summoned — best as defense or future attacker",
    ],
    goodDiscard: true,
    value: 12,
  },
  "Luminous Dragon": {
    role: "starter",
    priority: 9,
    atk: 2000,
    def: 1600,
    level: 5,
    summonCondition: "hand_ignition_empty_field",
    effect: "SS from hand if you control no monsters. While face-up, recovers a different Dragon from GY when a Dragon is discarded from hand to GY.",
    synergies: ["Solar Eclipse Dragon", "Lunar Eclipse Dragon", "Voltaic Dragon", "Grey Dragon", "Black Bull Dragon", "Polymerization", "Extreme Dragon Awakening"],
    playPatterns: [
      "Open with Luminous on an empty field when hand has follow-up",
      "Pairs with Voltaic for a free second body",
      "Turns discard costs into recovery when it stays face-up",
      "LIGHT Dragon material for Radiant Cosmic Dragon",
    ],
    selfSummons: true,
    fusionMaterial: "radiant_light_dragon",
    value: 10,
  },
  "Purified Crystal Dragon": {
    role: "boss",
    priority: 7,
    atk: 2500,
    def: 1700,
    level: 8,
    summonCondition: "banish_3_gy_dragons",
    effect: "SS by banishing 3 GY Dragons. Heal LP on battle destroy (level×100). Protect another Dragon from effect destruction.",
    synergies: ["GY buildup", "Hellkite Dragon", "Metal Armored Dragon"],
    playPatterns: [
      "Prefer spending non-Extreme Dragons first; spend Extreme Dragons only when the body or protection matters",
      "Extreme Dragons in GY are useful, but not an automatic reason to block this summon",
      "Provides protection for another Dragon - protect the best current threat",
      "Bridge toward Rainbow Cosmic Dragon after enough Purified activations",
    ],
    value: 10,
  },
  "Abyssal Serpent Dragon": {
    role: "control",
    priority: 3,
    atk: 2200,
    def: 1400,
    level: 7,
    summonCondition: "standard",
    effect: "Main Phase: select opp monster, send both to GY; opp standby phase both return. +800 ATK if target is fusion/ascension.",
    synergies: ["Converging Stars"],
    playPatterns: [
      "Normal Summon with 2 tributes, or use Converging Stars to reduce tribute pressure",
      "Priority target for Converging Stars: saves 1 tribute",
      "Use effect to stall big threats for a turn",
      "Especially effective against Fusion/Ascension monsters (+800 ATK bonus)",
    ],
    convergingStarsPriority: true,
    value: 9,
    legacyOnly: true,
    outOfPlan: true,
  },
  "Hellkite Dragon": {
    role: "extender",
    priority: 8,
    atk: 2300,
    def: 1900,
    level: 7,
    summonCondition: "hand_ignition_send_field_dragon",
    effect: "Send 1 field Dragon to GY → SS self from hand. Field: send self to GY → SS lv7- Dragon from GY.",
    synergies: ["Stelya, Dragon Tamer", "Luminescent Dragon", "Majestic Silver Dragon", "GY recursion"],
    playPatterns: [
      "SS from hand by sending any field Dragon (including weak ones or Boneflame)",
      "Use field effect to recycle GY resources (get Luminescent, Armored, etc.)",
      "Creates GY setup when sending to GY itself",
    ],
    selfSummons: true,
    value: 11,
  },
  "Majestic Silver Dragon": {
    role: "beater",
    priority: 7,
    atk: 2500,
    def: 2400,
    level: 7,
    summonCondition: "1_dragon_tribute_or_converging",
    effect: "Alt tribute: 1 Dragon instead of 2. Once per turn: switch 1 opp monster's battle position.",
    synergies: ["Stelya, Dragon Tamer", "Black Bull Dragon", "Dragon tribute fodder"],
    playPatterns: [
      "Alt tribute: use 1 Dragon on field instead of 2 normal tributes",
      "Converging Stars makes it level 5 → 1 normal tribute (any monster)",
      "Position switch is useful to expose defense monsters or flip attackers to def",
    ],
    convergingStarsPriority: true,
    value: 10,
  },
  "Darkness Dragon": {
    role: "situational_boss",
    priority: 2,
    atk: 2000,
    def: 1700,
    level: 5,
    summonCondition: "normal_1_tribute_or_converging_0",
    effect: "On summon: destroy all other own Dragons, gain +300 ATK per destroyed. Negate opp monster effect (discard 1).",
    synergies: ["Converging Stars"],
    playPatterns: [
      "DANGER: Destroys all other Dragons on summon — heavy cost",
      "Only summon when it's the only way to surpass opponent's ATK with the buff",
      "Converging Stars → level 3 → summon with 0 tributes",
      "Negate effect is useful tool after summon to disable key monster",
    ],
    situationalOnly: true,  // Only summon when necessary to beat opponent's ATK
    value: 8,
    legacyOnly: true,
    outOfPlan: true,
  },
  "Armored Dragon": {
    role: "searcher",
    priority: 8,
    atk: 1600,
    def: 1500,
    level: 4,
    summonCondition: "normal",
    effect: "Normal Summon: search 1 lv4- Dragon from deck. Battle destroy: draw 1, if lv4- Dragon can SS it.",
    synergies: ["Solar Eclipse Dragon", "Lunar Eclipse Dragon", "Stelya, Dragon Tamer", "Grey Dragon", "Luminescent Dragon", "Voltaic Dragon", "Jagged Peak"],
    playPatterns: [
      "Normal Summon T1 to search key dragons, especially Eclipse pieces or Stelya when the hand needs a bridge",
      "When destroyed by battle, draws a card for free recovery",
      "Excellent extender and draw engine in early game",
    ],
    goodSearchTarget: "lv4_dragon",
    value: 8,
  },
  "Grey Dragon": {
    role: "beater",
    priority: 7,
    atk: 1800,
    def: 800,
    level: 4,
    summonCondition: "special",
    effect: "Cannot direct attack. Special Summon: another Dragon you control gains +500 ATK. GY ignition: discard 1 Dragon → return self to hand.",
    synergies: ["Armored Dragon", "Solar Eclipse Dragon", "Lunar Eclipse Dragon", "Black Bull Dragon", "Hellkite Dragon"],
    playPatterns: [
      "Best when Special Summoned (buff to another Dragon)",
      "GY return effect enables replaying from hand",
      "Good target for Armored Dragon's search",
    ],
    value: 7,
  },
  "Luminescent Dragon": {
    role: "extender",
    priority: 8,
    atk: 1500,
    def: 900,
    level: 4,
    summonCondition: "normal",
    effect: "Normal Summon: SS 1 lv4- Dragon from GY. GY ignition: banish self → opp monster -600 ATK/DEF until end of turn.",
    synergies: ["Armored Dragon", "Solar Eclipse Dragon", "Lunar Eclipse Dragon", "Stelya, Dragon Tamer", "Voltaic Dragon", "Grey Dragon"],
    playPatterns: [
      "Normal Summon to revive any lv4- Dragon from GY",
      "Creates instant 2-body setup with one Normal Summon",
      "GY banish debuff useful to ensure battles win",
    ],
    value: 8,
  },
  "Boneflame Dragon": {
    role: "gy_beater",
    priority: 2,
    atk: 0,
    def: 0,
    level: 3,
    summonCondition: "gy_ignition_send_field_dragon",
    effect: "Cannot be Normal Summoned. GY ignition: send 1 field Dragon to GY → SS self. +300 ATK per Dragon in GY.",
    synergies: ["GY buildup", "Hellkite Dragon", "Luminescent Dragon"],
    playPatterns: [
      "Use as GY extender when field Dragon is not needed",
      "High GY count → very high ATK (e.g., 5 Dragons in GY = 1500 ATK base)",
      "Sending a used-up Dragon to GY via cost improves GY resource density",
    ],
    value: 6,
    legacyOnly: true,
    outOfPlan: true,
  },
  "Voltaic Dragon": {
    role: "extender",
    priority: 7,
    atk: 1200,
    def: 800,
    level: 3,
    summonCondition: "hand_ignition_if_control_dragon",
    effect: "Discarded from hand: 800 damage. Hand ignition: SS self if control Dragon.",
    synergies: ["Solar Eclipse Dragon", "Lunar Eclipse Dragon", "Black Bull Dragon", "Tech-Void Dragon (fusion material)", "Luminescent Dragon"],
    playPatterns: [
      "SS from hand if control Dragon — free body on field",
      "Discard for Black Bull Dragon cost to trigger 800 burn",
      "Fusion material for Tech-Void Dragon",
    ],
    goodDiscard: true,  // Trigger burn when discarded
    value: 7,
  },
  "Stelya, Dragon Tamer": {
    role: "stelya_bridge",
    priority: 11,
    atk: 1700,
    def: 1200,
    level: 4,
    summonCondition: "hand_or_gy_ignition_banish_field_dragon",
    effect: "Counts as 2 tributes for Dragon Tribute Summons. Can Special Summon herself from hand or GY by banishing a Dragon you control. Can discard herself plus another hand card to search a Level 5+ Dragon from Deck.",
    synergies: ["Solar Eclipse Dragon", "Lunar Eclipse Dragon", "Fire Extreme Dragon", "Volcanic Extreme Dragon", "Black Bull Dragon", "Purified Crystal Dragon", "Hellkite Dragon", "Majestic Silver Dragon"],
    playPatterns: [
      "Bridge piece for high-level Dragon Tribute Summons and Level 5+ Dragon searches",
      "Hand/GY self-summon is strong when the banished field Dragon is expendable or already converted value",
      "Discard-search mode finds bosses but should preserve critical Eclipse or fusion hands when possible",
      "Treat as a Dragon bridge, not as a Synchro plan in the current list",
    ],
    tags: ["bridge_to_boss", "level5_search", "self_recur_hand_gy", "two_tributes_for_dragon", "banish_field_cost"],
    goodDiscard: true,
    isTuner: true,
    currentBotCore: true,
    value: 12,
  },

  // ===== SPELLS =====
  "Converging Stars": {
    role: "enabler",
    priority: 2,
    playCondition: "has_high_level_target_in_hand",
    effect: "Discard 1 card; reduce all hand monster levels by 2 until end of turn.",
    synergies: ["Abyssal Serpent Dragon", "Majestic Silver Dragon", "Darkness Dragon"],
    playPatterns: [
      "Priority: Darkness Dragon in hand → level 5→3, free summon",
      "Priority: Abyssal Serpent in hand → level 7→5, saves 1 tribute",
      "Priority: Majestic Silver in hand with 1 tribute available → level 7→5, 1 regular tribute instead of 1 Dragon tribute",
      "DO NOT play if only dragons that self-summon are in hand (Black Bull, Hellkite, Purified Crystal)",
    ],
    value: 9,
    legacyOnly: true,
    outOfPlan: true,
  },
  Polymerization: {
    role: "fusion_enabler",
    priority: 10,
    playCondition: "radiant_cosmic_materials_OR_tech_void_materials",
    effect: "Fusion summon Radiant Cosmic Dragon or Tech-Void Dragon from the Extra Deck.",
    synergies: ["Luminous Dragon", "Voltaic Dragon", "Radiant Cosmic Dragon", "Tech-Void Dragon"],
    playPatterns: [
      "Primary value line: 3 Dragons including 1 LIGHT -> Radiant Cosmic Dragon",
      "Pressure or lower-cost line: Voltaic Dragon + lv5+ Dragon -> Tech-Void Dragon",
      "Do not consider Metal Armored Dragon; it is Ascension-only",
    ],
    value: 12,
  },
  "Call of the Haunted": {
    role: "revival",
    priority: 7,
    playCondition: "monster_in_gy",
    effect: "Revive 1 monster from GY (set as trap first, activate later).",
    synergies: ["Solar Eclipse Dragon", "Lunar Eclipse Dragon", "Stelya, Dragon Tamer", "Extreme Dragons", "Black Bull Dragon", "Hellkite Dragon"],
    playPatterns: [
      "Set as trap to activate reactively",
      "Best revival target: Extreme Dragon from GY",
      "Good for surprise presence on opponent's turn",
    ],
    value: 8,
  },
  "Hellkite Roar": {
    role: "removal",
    priority: 8,
    playCondition: "control_lv7_plus_dragon",
    effect: "If control lv7+ Dragon: destroy up to 1 opp spell/trap. GY banish self -> search Jagged Peak from deck.",
    synergies: ["Extreme Dragons", "Jagged Peak of the Dragons", "Fire Extreme Dragon", "Volcanic Extreme Dragon", "Majestic Silver Dragon", "Hellkite Dragon"],
    playPatterns: [
      "Activate only if have lv7+ Dragon on field",
      "Use GY effect to search Jagged Peak if don't have it",
      "Removes dangerous backrow before attacking",
    ],
    value: 8,
  },
  "Jagged Peak of the Dragons": {
    role: "field_spell",
    priority: 9,
    playCondition: "core_field_spell",
    effect: "Activate: add lv4- Dragon from GY to hand. Counter per Dragon battle destroy. 5+ counters: SS any Dragon from hand/deck/GY.",
    synergies: ["All Dragon monsters", "Extreme Dragons"],
    playPatterns: [
      "Activate ASAP — it's the key resource engine",
      "On activate: recover lv4 Dragon from GY",
      "Build counters through battles",
      "5 counters: special summon any Dragon (use for Extreme Dragon)",
    ],
    value: 10,
  },
  "Extreme Dragon Awakening": {
    role: "extreme_enabler",
    priority: 11,
    playCondition: "lv8_plus_dragon_in_deck_or_hand_AND_dragon_fodder_plan",
    effect: "Continuous spell. On activation: search 1 lv8+ Dragon from Deck. Ignition (1/turn/copy): send 2 field Dragons to GY -> SS 1 lv8+ Dragon from hand.",
    synergies: ["Fire Extreme Dragon", "Volcanic Extreme Dragon", "Stelya, Dragon Tamer", "Solar Eclipse Dragon", "Lunar Eclipse Dragon", "Hellkite Dragon", "Luminescent Dragon", "Voltaic Dragon", "Armored Dragon"],
    playPatterns: [
      "Activate from hand to search a Level 8+ Dragon, then use ignition once 2 Dragon bodies are available",
      "Saves Normal Summon for Armored/Luminescent searcher",
      "Best fodder: used-up Lunar/Solar, Voltaic, Grey, used-up Armored, or expendable Stelya - preserves real value",
      "Avoid summoning a second face-up Extreme Dragon while fieldLimit would block it",
      "Pairs well with Luminescent revive / Hellkite SS to manufacture 2 fodder bodies cheaply",
    ],
    value: 13,
  },
  "Dragon Spirit Sanctuary": {
    role: "protection",
    priority: 4,
    playCondition: "has_dragon_on_field_and_hand",
    effect: "Trap: when Dragon targeted by attack/effect → return to hand, SS Dragon from hand with <= level.",
    synergies: ["Extreme Dragons", "High-level Dragon defense", "Solar Eclipse Dragon", "Lunar Eclipse Dragon"],
    playPatterns: [
      "Set in backrow, activate reactively",
      "Protects Extreme Dragons from targeted removal",
      "Returns to hand and summons smaller Dragon — maintains field presence",
    ],
    value: 6,
  },

  // ===== EXTRA DECK =====
  "Metal Armored Dragon": {
    role: "ascension_boss",
    priority: 7,
    atk: 1600,
    def: 2000,
    level: 6,
    summonCondition: "ascension_from_armored_dragon",
    effect: "Defense indestructible. Gains 100 ATK/DEF per Dragon Special Summoned while face-up.",
    synergies: ["Armored Dragon", "Dragon spam"],
    polymerizationTarget: false,
    value: 8,
  },
  "Tech-Void Dragon": {
    role: "fusion_boss",
    priority: 9,
    atk: 2500,
    def: 1000,
    level: 8,
    summonCondition: "fusion_voltaic_plus_lv5",
    effect: "On fusion summon: banish lv4- Dragon from GY, gain its ATK until EOT. If destroyed by battle: SS Voltaic from GY.",
    synergies: ["Voltaic Dragon", "Polymerization"],
    value: 12,
  },
  "Radiant Cosmic Dragon": {
    role: "fusion_boss",
    priority: 11,
    atk: 3300,
    def: 2700,
    level: 9,
    summonCondition: "fusion_3_dragons_including_light",
    effect: "On fusion summon: shuffle 1-5 cards from GY into Deck, then draw 1. Controller takes no battle damage involving it. If destroyed, revive a non-Radiant Dragon from GY.",
    synergies: ["Polymerization", "Luminous Dragon", "Purified Crystal Dragon", "Dragon GY resources"],
    playPatterns: [
      "Primary Polymerization value payoff",
      "Use as stabilizer when GY has optional recycle targets",
      "Do not over-shuffle GY cards needed for Purified, Hellkite, Boneflame, Grey, Luminous, or revive follow-up",
    ],
    value: 16,
  },
  "Rainbow Cosmic Dragon": {
    role: "ascension_boss",
    priority: 10,
    atk: 3500,
    def: 3200,
    level: 10,
    summonCondition: "ascension_from_purified_after_3_effect_activations",
    effect: "Protects a Dragon through next turn. Gains LP after battle destruction. GY effect sends up to 3 Extreme Dragons from Deck to GY.",
    synergies: ["Purified Crystal Dragon", "Call of the Haunted", "Solar Eclipse Dragon", "Lunar Eclipse Dragon", "Luminous Dragon"],
    playPatterns: [
      "Long-term boss after Purified has progressed",
      "GY effect is not an automatic win setup",
      "Use GY effect only when it creates real follow-up for Call of the Haunted, Eclipse recovery, Luminous recovery, or next turn",
    ],
    value: 15,
  },
};

// ===== EXTREME DRAGON NAMES =====
export const EXTREME_DRAGON_NAMES = [
  "Fire Extreme Dragon",
  "Volcanic Extreme Dragon",
  "Mist Extreme Dragon",
  "Galaxy Extreme Dragon",
  "Forest Extreme Dragon",
];

// ===== CURRENT DRAGON BOT LIST =====
export const CURRENT_DRAGON_BOT_CARD_NAMES = [
  "Voltaic Dragon",
  "Armored Dragon",
  "Grey Dragon",
  "Luminescent Dragon",
  "Lunar Eclipse Dragon",
  "Solar Eclipse Dragon",
  "Stelya, Dragon Tamer",
  "Luminous Dragon",
  "Hellkite Dragon",
  "Majestic Silver Dragon",
  "Black Bull Dragon",
  "Purified Crystal Dragon",
  "Fire Extreme Dragon",
  "Volcanic Extreme Dragon",
  "Polymerization",
  "Hellkite Roar",
  "Extreme Dragon Awakening",
  "Jagged Peak of the Dragons",
  "Dragon Spirit Sanctuary",
  "Call of the Haunted",
  "Tech-Void Dragon",
  "Radiant Cosmic Dragon",
  "Rainbow Cosmic Dragon",
  "Metal Armored Dragon",
];

export const OUT_OF_PLAN_DRAGON_CARD_NAMES = [
  "Abyssal Serpent Dragon",
  "Darkness Dragon",
  "Boneflame Dragon",
  "Converging Stars",
  "Mist Extreme Dragon",
  "Galaxy Extreme Dragon",
  "Forest Extreme Dragon",
];

export const ECLIPSE_ENGINE_NAMES = [
  "Solar Eclipse Dragon",
  "Lunar Eclipse Dragon",
];

export const DRAGON_SMALL_SEARCH_NAMES = [
  "Solar Eclipse Dragon",
  "Lunar Eclipse Dragon",
  "Stelya, Dragon Tamer",
  "Armored Dragon",
  "Grey Dragon",
  "Luminescent Dragon",
  "Voltaic Dragon",
];

export const DRAGON_LEVEL5_PLUS_SEARCH_NAMES = [
  "Fire Extreme Dragon",
  "Volcanic Extreme Dragon",
  "Purified Crystal Dragon",
  "Black Bull Dragon",
  "Hellkite Dragon",
  "Majestic Silver Dragon",
  "Luminous Dragon",
];

export const CURRENT_AWAKENING_TARGET_NAMES = [
  "Fire Extreme Dragon",
  "Volcanic Extreme Dragon",
  "Purified Crystal Dragon",
  "Black Bull Dragon",
];

// ===== SELF-SUMMONING MONSTER NAMES (don't need Converging Stars) =====
export const SELF_SUMMON_MONSTERS = [
  "Black Bull Dragon",
  "Hellkite Dragon",
  "Purified Crystal Dragon",
  "Voltaic Dragon",
  "Stelya, Dragon Tamer",
  "Boneflame Dragon",
  "Luminous Dragon",
];

// ===== CONVERGING STARS PRIORITY TARGETS =====
export const CONVERGING_STARS_TARGETS = [
  "Darkness Dragon",        // lv5 -> lv3 = 0 tributes (highest benefit)
  "Abyssal Serpent Dragon", // lv7 -> lv5 = 1 tribute (saves 1 tribute)
  "Majestic Silver Dragon", // lv7 -> lv5 = 1 regular tribute (any monster)
];

/**
 * Checks if a card is an Extreme Dragon.
 * @param {Object} card
 * @returns {boolean}
 */
export function isExtremeDragon(card) {
  if (!card) return false;
  return (
    EXTREME_DRAGON_NAMES.includes(card.name) ||
    card.archetype === "Extreme Dragons" ||
    (Array.isArray(card.archetypes) && card.archetypes.includes("Extreme Dragons"))
  );
}

/**
 * Counts Extreme Dragons in the graveyard.
 * @param {Array} graveyard
 * @returns {number}
 */
export function countExtremeInGY(graveyard) {
  if (!Array.isArray(graveyard)) return 0;
  return graveyard.filter((c) => isExtremeDragon(c)).length;
}

/**
 * Counts non-Extreme Dragons in the graveyard.
 * @param {Array} graveyard
 * @returns {number}
 */
export function countSafeBanishTargets(graveyard) {
  if (!Array.isArray(graveyard)) return 0;
  return graveyard.filter((c) => c && c.cardKind === "monster" && !isExtremeDragon(c)).length;
}

/**
 * Returns knowledge for a card by name.
 * @param {string} name
 * @returns {CardKnowledge|null}
 */
export function getCardKnowledge(name) {
  return CARD_KNOWLEDGE[name] || null;
}

/**
 * Selects the best Extreme Dragon to summon given the current game state.
 * @param {Array} extremesInHand - Extreme Dragon cards available in hand
 * @param {Object} analysis - Current game analysis
 * @returns {Object|null} Best Extreme Dragon card
 */
export function selectBestExtremeDragon(extremesInHand, analysis) {
  if (!extremesInHand || extremesInHand.length === 0) return null;
  if (extremesInHand.length === 1) return extremesInHand[0];

  const oppField = analysis.oppField || [];
  const oppHand = analysis.oppHand || 0;
  const myLp = analysis.lp || 8000;
  const oppLp = analysis.oppLp || 8000;
  const gyCount = analysis.graveyard?.length || 0;

  const scores = extremesInHand.map((card) => {
    let score = CARD_KNOWLEDGE[card.name]?.priority || 5;

    if (card.name === "Fire Extreme Dragon") {
      // Best when aggressive — opponent has many effects or low LP
      score += oppHand >= 3 ? 2 : 0;
      score += oppLp <= 4000 ? 2 : 0;  // Burn stacks matter more vs low LP
    }
    if (card.name === "Volcanic Extreme Dragon") {
      // Strong when burn pressure matters, but its once-per-duel GY banish stays situational.
      score += oppLp <= 3000 ? 2 : 0;
    }
    if (card.name === "Mist Extreme Dragon") {
      // Best when opponent has multiple monsters
      score += oppField.length >= 2 ? 3 : 0;
    }
    if (card.name === "Galaxy Extreme Dragon") {
      // Best when losing or need survival
      score += myLp <= 3000 ? 3 : 0;
      score += oppField.some((c) => !c.isFacedown && (c.atk || 0) >= 2500) ? 2 : 0;
    }
    if (card.name === "Forest Extreme Dragon") {
      // Best in long games with many opp cards
      score += (oppField.length + oppHand) >= 6 ? 3 : 0;
      score += gyCount >= 6 ? 1 : 0;  // Long game indicator
    }

    return { card, score };
  });

  scores.sort((a, b) => b.score - a.score);
  return scores[0].card;
}
