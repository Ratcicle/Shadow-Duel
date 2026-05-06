const ZONES = [
  "deck",
  "hand",
  "field",
  "graveyard",
  "spellTrap",
  "fieldSpell",
  "banish",
  "banished",
];

const PLAYERS = ["self", "opponent"];
const POSITIONS = ["attack", "defense", "choice"];

export const ACTION_CATEGORIES = [
  "resources",
  "movement",
  "summon",
  "destruction",
  "stats",
  "combat",
  "counters",
  "conditional",
  "blueprint",
  "legacyProxy",
];

export const ACTION_FIELD_DEFS = {
  targetRef: {
    type: "string",
    description: "References an effect target id or a context target such as self.",
  },
  player: {
    enum: PLAYERS,
    description: 'Perspective for the action: "self" or "opponent".',
  },
  zone: {
    type: "zone",
    values: ZONES,
    description: "Source zone used by the action.",
  },
  sourceZone: {
    type: "zone",
    values: ZONES,
    description: "Alternative source zone used by some summon actions.",
  },
  fromZone: {
    type: "zone",
    values: ZONES,
    description: "Zone to read from or remove from.",
  },
  to: {
    type: "zone",
    values: ZONES,
    description: "Destination zone.",
  },
  position: {
    enum: POSITIONS,
    description: 'Battle position: "attack", "defense", or "choice".',
  },
  count: {
    type: "object",
    description: "Selection count object, usually { min, max }.",
  },
  filters: {
    type: "object",
    description: "Card filter object evaluated by the handler.",
  },
  amount: {
    type: "number",
    min: 0,
    description: "Numeric amount.",
  },
};

function field(name, overrides = {}) {
  return {
    ...(ACTION_FIELD_DEFS[name] || {}),
    ...overrides,
  };
}

function action({
  category,
  summary,
  handler,
  required = [],
  optional = [],
  fields = {},
  targetRef = "none",
  selection = "none",
  mutates = [],
  emits = [],
  updatesBoard = true,
  preview = "notNeeded",
  examples = [],
  notes = [],
}) {
  return {
    category,
    summary,
    handler,
    required,
    optional,
    fields,
    targetRef,
    selection,
    mutates,
    emits,
    updatesBoard,
    preview,
    examples,
    notes,
  };
}

const COMMON_TARGET_FIELDS = {
  targetRef: field("targetRef"),
};

const COMMON_FILTER_FIELDS = {
  zone: field("zone"),
  filters: field("filters"),
  count: field("count"),
  promptPlayer: { type: "boolean" },
  player: field("player"),
  archetype: { type: "string" },
  cardKind: { type: "stringOrArray" },
  cardName: { type: "string" },
  minAtk: { type: "number" },
  maxAtk: { type: "number" },
  minDef: { type: "number" },
  maxDef: { type: "number" },
  minLevel: { type: "number" },
  maxLevel: { type: "number" },
  requireSource: { type: "boolean" },
};

export const ACTION_CATALOG = {
  abyssal_serpent_delayed_summon: action({
    category: "summon",
    summary: "Schedules Abyssal Serpent Dragon's delayed return summon.",
    handler: "handleAbyssalSerpentDelayedSummon",
    optional: ["targetRef", "buffValue"],
    fields: { ...COMMON_TARGET_FIELDS, buffValue: { type: "number" } },
    targetRef: "optional",
    selection: "usesTargets",
    mutates: ["field", "graveyard"],
    emits: ["after_summon"],
    preview: "missing",
    examples: [{ type: "abyssal_serpent_delayed_summon", targetRef: "abyssal_target" }],
    notes: ["Complex legacy Dragon action; prefer generic move/summon actions for new cards."],
  }),
  activate_stored_blueprint: action({
    category: "blueprint",
    summary: "Activates an effect blueprint stored on the source card.",
    handler: "handleActivateStoredBlueprint",
    fields: {},
    mutates: ["varies"],
    preview: "covered",
    examples: [{ type: "activate_stored_blueprint" }],
  }),
  add_counter: action({
    category: "counters",
    summary: "Adds counters to a target or source card.",
    handler: "proxy:applyAddCounter",
    required: ["targetRef", "counterType"],
    optional: ["amount", "damagePerCounter"],
    fields: {
      ...COMMON_TARGET_FIELDS,
      counterType: { type: "string" },
      amount: field("amount"),
      damagePerCounter: { type: "number" },
    },
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["counters"],
    examples: [{ type: "add_counter", targetRef: "self", counterType: "ink", amount: 1 }],
  }),
  add_from_zone_to_hand: action({
    category: "resources",
    summary: "Adds selected cards from a zone to hand.",
    handler: "handleAddFromZoneToHand",
    optional: Object.keys(COMMON_FILTER_FIELDS),
    fields: COMMON_FILTER_FIELDS,
    selection: "dynamic",
    mutates: ["hand", "deck", "graveyard"],
    preview: "covered",
    examples: [
      {
        type: "add_from_zone_to_hand",
        zone: "deck",
        filters: { archetype: "Arcanist" },
        count: { min: 1, max: 1 },
      },
    ],
  }),
  add_status: action({
    category: "stats",
    summary: "Adds a named status flag to target cards.",
    handler: "handleAddStatus",
    required: ["targetRef", "status"],
    optional: ["value"],
    fields: {
      ...COMMON_TARGET_FIELDS,
      status: { type: "string" },
      value: { type: "any" },
    },
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["status"],
    examples: [{ type: "add_status", targetRef: "self", status: "battleIndestructible" }],
  }),
  allow_direct_attack_this_turn: action({
    category: "combat",
    summary: "Allows a target monster to attack directly this turn.",
    handler: "proxy:applyAllowDirectAttackThisTurn",
    required: ["targetRef"],
    fields: COMMON_TARGET_FIELDS,
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["status"],
    examples: [{ type: "allow_direct_attack_this_turn", targetRef: "ghost_self" }],
  }),
  banish: action({
    category: "destruction",
    summary: "Banishes target cards or context cards.",
    handler: "handleBanish",
    optional: ["targetRef", "fromZone"],
    fields: {
      ...COMMON_TARGET_FIELDS,
      fromZone: field("fromZone"),
    },
    targetRef: "optional",
    selection: "usesTargets",
    mutates: ["banished"],
    emits: ["card_to_grave"],
    preview: "covered",
    examples: [{ type: "banish", targetRef: "self", fromZone: "graveyard" }],
  }),
  banish_and_buff: action({
    category: "stats",
    summary: "Banishes a card and applies a buff based on the banished card.",
    handler: "handleBanishAndBuff",
    required: ["targetRef"],
    optional: ["buffMultiplier", "buffSource", "buffTarget", "buffType", "duration"],
    fields: {
      ...COMMON_TARGET_FIELDS,
      buffMultiplier: { type: "number" },
      buffSource: { type: "string" },
      buffTarget: { type: "string" },
      buffType: { type: "string" },
      duration: { type: "string" },
    },
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["banished", "stats"],
    examples: [{ type: "banish_and_buff", targetRef: "tech_void_banish_target" }],
  }),
  banish_card_from_graveyard: action({
    category: "destruction",
    summary: "Banishes a card from a graveyard using handler-side selection.",
    handler: "handleBanishCardFromGraveyard",
    optional: ["filters", "player", "count"],
    fields: {
      filters: field("filters"),
      player: field("player"),
      count: field("count"),
    },
    selection: "dynamic",
    mutates: ["graveyard", "banished"],
    examples: [{ type: "banish_card_from_graveyard", filters: { cardKind: "monster" } }],
    notes: ["Registered but not currently used by card data."],
  }),
  banish_all_graveyard_and_burn: action({
    category: "destruction",
    summary: "Banishes all cards in the controller's graveyard, then deals damage per card banished.",
    handler: "handleBanishAllGraveyardAndBurn",
    optional: ["damagePerCard", "player"],
    fields: {
      damagePerCard: field("amount"),
      player: field("player"),
    },
    selection: "none",
    mutates: ["graveyard", "banished", "lp"],
    examples: [{ type: "banish_all_graveyard_and_burn", damagePerCard: 500, player: "opponent" }],
  }),
  banish_destroyed_monster: action({
    category: "destruction",
    summary: "Banishes the monster destroyed in the current event context.",
    handler: "handleBanish",
    fields: {},
    mutates: ["graveyard", "banished"],
    examples: [{ type: "banish_destroyed_monster" }],
  }),
  bounce_and_summon: action({
    category: "summon",
    summary: "Returns a card and summons a replacement matching filters.",
    handler: "handleBounceAndSummon",
    optional: ["bounceSource", "filters", "position", "cannotAttackThisTurn"],
    fields: {
      bounceSource: { type: "any" },
      filters: field("filters"),
      position: field("position"),
      cannotAttackThisTurn: { type: "boolean" },
    },
    selection: "dynamic",
    mutates: ["hand", "field"],
    emits: ["after_summon"],
    preview: "missing",
    examples: [{ type: "bounce_and_summon", filters: { cardKind: "monster" }, position: "attack" }],
  }),
  buff_atk_temp: action({
    category: "stats",
    summary: "Temporarily modifies ATK by amount.",
    handler: "proxy:applyBuffAtkTemp",
    required: ["targetRef", "amount"],
    fields: {
      ...COMMON_TARGET_FIELDS,
      amount: field("amount"),
    },
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["stats"],
    examples: [{ type: "buff_atk_temp", targetRef: "shadowheart_allies", amount: 500 }],
  }),
  buff_stats_temp: action({
    category: "stats",
    summary: "Temporarily modifies ATK and/or DEF.",
    handler: "handleBuffStatsTemp",
    optional: ["targetRef", "atkBoost", "defBoost"],
    fields: {
      ...COMMON_TARGET_FIELDS,
      atkBoost: { type: "number" },
      defBoost: { type: "number" },
    },
    targetRef: "optional",
    selection: "usesTargets",
    mutates: ["stats"],
    examples: [{ type: "buff_stats_temp", targetRef: "sanctum_citadel_target", atkBoost: 500, defBoost: 500 }],
  }),
  modify_stats_temp_then_destroy_if_zeroed: action({
    category: "stats",
    summary:
      "Temporarily modifies ATK and/or DEF, then destroys targets whose checked stat was reduced to 0 by this action.",
    handler: "handleModifyStatsTempThenDestroyIfZeroed",
    required: ["targetRef"],
    optional: [
      "atkChange",
      "defChange",
      "destroyIfAtkZeroedByThisEffect",
      "destroyIfDefZeroedByThisEffect",
      "permanent",
    ],
    fields: {
      ...COMMON_TARGET_FIELDS,
      atkChange: { type: "number" },
      defChange: { type: "number" },
      destroyIfAtkZeroedByThisEffect: { type: "boolean" },
      destroyIfDefZeroedByThisEffect: { type: "boolean" },
      permanent: { type: "boolean" },
    },
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["stats", "field", "graveyard"],
    emits: ["stat_buff_applied", "before_destroy", "card_to_grave"],
    examples: [
      {
        type: "modify_stats_temp_then_destroy_if_zeroed",
        targetRef: "purge_target_monster",
        atkChange: -1000,
        destroyIfAtkZeroedByThisEffect: true,
      },
    ],
  }),
  buff_atk_by_lp_gained_this_turn: action({
    category: "stats",
    summary: "Temporarily boosts ATK by the player's LP gained this turn.",
    handler: "handleBuffAtkByLpGainedThisTurn",
    optional: ["targetRef"],
    fields: {
      ...COMMON_TARGET_FIELDS,
    },
    targetRef: "optional",
    selection: "usesTargets",
    mutates: ["stats"],
    examples: [{ type: "buff_atk_by_lp_gained_this_turn", targetRef: "self" }],
  }),
  reduce_hand_monster_levels: action({
    category: "stats",
    summary: "Reduces the Level of all monsters in the player's hand.",
    handler: "handleReduceHandMonsterLevels",
    fields: {},
    selection: "none",
    mutates: ["stats"],
    examples: [{ type: "reduce_hand_monster_levels" }],
  }),
  buff_stats_temp_with_second_attack: action({
    category: "stats",
    summary: "Applies a temporary stat buff and grants a second attack.",
    handler: "handleBuffStatsTemp",
    required: ["targetRef"],
    optional: ["atkBoost", "defBoost"],
    fields: {
      ...COMMON_TARGET_FIELDS,
      atkBoost: { type: "number" },
      defBoost: { type: "number" },
    },
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["stats", "status"],
    examples: [{ type: "buff_stats_temp_with_second_attack", targetRef: "rage_scale_target", atkBoost: 1000 }],
  }),
  call_of_haunted_summon_and_bind: action({
    category: "summon",
    summary: "Special Summons a target and binds it to Call of the Haunted.",
    handler: "proxy:applyCallOfTheHauntedSummon",
    required: ["targetRef"],
    fields: COMMON_TARGET_FIELDS,
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["field", "graveyard"],
    emits: ["after_summon"],
    examples: [{ type: "call_of_haunted_summon_and_bind", targetRef: "haunted_target" }],
  }),
  choose_action_case: action({
    category: "conditional",
    summary: "Prompts or chooses one case and executes its nested actions.",
    handler: "handleChooseActionCase",
    required: ["cases"],
    optional: ["selectionMessage"],
    fields: {
      cases: { type: "array" },
      selectionMessage: { type: "string" },
    },
    selection: "dynamic",
    mutates: ["varies"],
    preview: "missing",
    examples: [{ type: "choose_action_case", selectionMessage: "Choose one.", cases: [] }],
  }),
  conditional_summon_from_hand: action({
    category: "summon",
    summary: "Special Summons the source from hand when condition allows it.",
    handler: "handleConditionalSummonFromHand",
    optional: [
      "targetRef",
      "condition",
      "position",
      "optional",
      "cannotAttackThisTurn",
      "restrictAttackThisTurn",
    ],
    fields: {
      ...COMMON_TARGET_FIELDS,
      condition: { type: "object" },
      position: field("position"),
      optional: { type: "boolean" },
      cannotAttackThisTurn: { type: "boolean" },
      restrictAttackThisTurn: { type: "boolean" },
    },
    targetRef: "optional",
    selection: "usesTargets",
    mutates: ["hand", "field"],
    emits: ["after_summon"],
    preview: "covered",
    examples: [{ type: "conditional_summon_from_hand", targetRef: "self", position: "attack", optional: true }],
  }),
  conditional_target_actions: action({
    category: "conditional",
    summary: "Executes nested action cases based on a resolved target.",
    handler: "handleConditionalTargetActions",
    required: ["targetRef", "cases"],
    fields: {
      ...COMMON_TARGET_FIELDS,
      cases: { type: "array" },
    },
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["varies"],
    preview: "missing",
    examples: [{ type: "conditional_target_actions", targetRef: "lightning_magic_lance_target", cases: [] }],
  }),
  damage: action({
    category: "resources",
    summary: "Deals LP damage.",
    handler: "proxy:applyDamage",
    required: ["amount"],
    optional: ["player"],
    fields: {
      amount: field("amount"),
      player: field("player"),
    },
    mutates: ["lp"],
    examples: [{ type: "damage", player: "opponent", amount: 500 }],
  }),
  damage_from_destroyed_atk: action({
    category: "resources",
    summary: "Deals LP damage based on the destroyed monster's ATK.",
    handler: "handleDamageFromDestroyedAtk",
    optional: ["fraction", "multiplier", "player", "useBaseAtk"],
    fields: {
      fraction: { type: "number" },
      multiplier: { type: "number" },
      player: field("player"),
      useBaseAtk: { type: "boolean" },
    },
    mutates: ["lp"],
    examples: [
      {
        type: "damage_from_destroyed_atk",
        player: "opponent",
        fraction: 0.5,
        useBaseAtk: true,
      },
    ],
  }),
  destroy: action({
    category: "destruction",
    summary: "Destroys target cards.",
    handler: "proxy:applyDestroy",
    required: ["targetRef"],
    fields: COMMON_TARGET_FIELDS,
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["field", "graveyard"],
    emits: ["before_destroy", "card_to_grave"],
    examples: [{ type: "destroy", targetRef: "destroy_target" }],
  }),
  destroy_and_damage_by_target_atk: action({
    category: "destruction",
    summary: "Destroys targets and deals damage based on target ATK.",
    handler: "handleDestroyAndDamageByTargetAtk",
    optional: ["entries", "skipDamageIf"],
    fields: {
      entries: { type: "array" },
      skipDamageIf: { type: "object" },
    },
    selection: "usesTargets",
    mutates: ["field", "graveyard", "lp"],
    emits: ["before_destroy", "card_to_grave"],
    preview: "missing",
    examples: [{ type: "destroy_and_damage_by_target_atk", entries: [] }],
  }),
  destroy_attacker_on_archetype_destruction: action({
    category: "destruction",
    summary: "Destroys the attacker after archetype destruction trigger.",
    handler: "handleDestroyAttackerOnArchetypeDestruction",
    optional: ["archetype", "minLevel"],
    fields: {
      archetype: { type: "string" },
      minLevel: { type: "number" },
    },
    mutates: ["field", "graveyard"],
    emits: ["before_destroy", "card_to_grave"],
    examples: [{ type: "destroy_attacker_on_archetype_destruction", archetype: "Shadow-Heart", minLevel: 8 }],
  }),
  destroy_other_dragons_and_buff: action({
    category: "destruction",
    summary: "Destroys other Dragon-type monsters and buffs the source.",
    handler: "proxy:applyDestroyOtherDragonsAndBuff",
    optional: ["typeName", "atkPerDestroyed", "buffSourceName"],
    fields: {
      typeName: { type: "string" },
      atkPerDestroyed: { type: "number" },
      buffSourceName: { type: "string" },
    },
    mutates: ["field", "graveyard", "stats"],
    emits: ["before_destroy", "card_to_grave"],
    examples: [{ type: "destroy_other_dragons_and_buff", typeName: "Dragon", atkPerDestroyed: 500 }],
  }),
  destroy_self_monsters_and_draw: action({
    category: "destruction",
    summary: "Destroys own monsters and draws for each destroyed.",
    handler: "proxy:applyDestroyAllOthersAndDraw",
    fields: {},
    mutates: ["field", "graveyard", "hand", "deck"],
    emits: ["before_destroy", "card_to_grave"],
    examples: [{ type: "destroy_self_monsters_and_draw" }],
  }),
  destroy_targeted_cards: action({
    category: "destruction",
    summary: "Destroys selected cards from one or more zones.",
    handler: "handleDestroyTargetedCards",
    optional: ["zones", "cardKind", "minTargets", "maxTargets"],
    fields: {
      zones: { type: "array" },
      cardKind: { type: "stringOrArray" },
      minTargets: { type: "number" },
      maxTargets: { type: "number" },
    },
    selection: "dynamic",
    mutates: ["field", "spellTrap", "graveyard"],
    emits: ["before_destroy", "card_to_grave"],
    preview: "missing",
    examples: [{ type: "destroy_targeted_cards", zones: ["field"], maxTargets: 2 }],
  }),
  draw: action({
    category: "resources",
    summary: "Draws cards.",
    handler: "proxy:applyDraw",
    required: ["amount"],
    optional: ["player"],
    fields: {
      amount: field("amount", { min: 1 }),
      player: field("player"),
    },
    mutates: ["deck", "hand"],
    examples: [{ type: "draw", player: "self", amount: 2 }],
  }),
  draw_and_summon: action({
    category: "summon",
    summary: "Draws cards and may Special Summon from hand.",
    handler: "handleDrawAndSummon",
    optional: ["condition", "drawAmount", "optional", "player", "position"],
    fields: {
      condition: { type: "object" },
      drawAmount: { type: "number" },
      optional: { type: "boolean" },
      player: field("player"),
      position: field("position"),
    },
    selection: "dynamic",
    mutates: ["deck", "hand", "field"],
    emits: ["after_summon"],
    examples: [{ type: "draw_and_summon", drawAmount: 1, optional: true, position: "attack" }],
  }),
  equip: action({
    category: "stats",
    summary: "Equips a spell/trap to a target and applies equip bonuses.",
    handler: "proxy:applyEquip",
    optional: [
      "targetRef",
      "equippedCard",
      "atkBonus",
      "defBonus",
      "extraAttacks",
      "battleIndestructible",
      "grantCrescentShieldGuard",
    ],
    fields: {
      ...COMMON_TARGET_FIELDS,
      equippedCard: { type: "string" },
      atkBonus: { type: "number" },
      defBonus: { type: "number" },
      extraAttacks: { type: "number" },
      battleIndestructible: { type: "boolean" },
      grantCrescentShieldGuard: { type: "boolean" },
    },
    targetRef: "optional",
    selection: "usesTargets",
    mutates: ["spellTrap", "equip"],
    emits: ["card_equipped"],
    examples: [{ type: "equip", targetRef: "shield_equip_target", atkBonus: 300 }],
  }),
  forbid_attack_next_turn: action({
    category: "combat",
    summary: "Prevents target cards from attacking next turn.",
    handler: "proxy:applyForbidAttackNextTurn",
    required: ["targetRef"],
    optional: ["turns"],
    fields: {
      ...COMMON_TARGET_FIELDS,
      turns: { type: "number" },
    },
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["status"],
    examples: [{ type: "forbid_attack_next_turn", targetRef: "void_bone_spider_lock_target", turns: 1 }],
  }),
  forbid_attack_this_turn: action({
    category: "combat",
    summary: "Prevents the relevant card from attacking this turn.",
    handler: "proxy:applyForbidAttackThisTurn",
    fields: {},
    mutates: ["status"],
    examples: [{ type: "forbid_attack_this_turn" }],
  }),
  forbid_direct_attack_this_turn: action({
    category: "combat",
    summary: "Prevents direct attacks this turn.",
    handler: "proxy:applyForbidDirectAttackThisTurn",
    optional: ["player"],
    fields: { player: field("player") },
    mutates: ["status"],
    examples: [{ type: "forbid_direct_attack_this_turn", player: "self" }],
  }),
  grant_additional_normal_summon: action({
    category: "resources",
    summary: "Grants extra Normal Summons.",
    handler: "handleGrantAdditionalNormalSummon",
    optional: ["count"],
    fields: { count: { type: "number" } },
    mutates: ["summonState"],
    examples: [{ type: "grant_additional_normal_summon", count: 1 }],
  }),
  grant_attack_all_monsters: action({
    category: "combat",
    summary: "Allows target cards to attack all opponent monsters.",
    handler: "handleGrantAttackAllMonsters",
    required: ["targetRef"],
    fields: COMMON_TARGET_FIELDS,
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["status"],
    examples: [{ type: "grant_attack_all_monsters", targetRef: "self" }],
  }),
  grant_protection: action({
    category: "stats",
    summary: "Grants protection status to targets.",
    handler: "handleGrantProtection",
    required: ["targetRef", "protectionType"],
    optional: ["duration"],
    fields: {
      ...COMMON_TARGET_FIELDS,
      protectionType: { type: "string" },
      duration: { type: "string" },
    },
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["status"],
    examples: [{ type: "grant_protection", targetRef: "self", protectionType: "effect_destruction", duration: "while_faceup" }],
  }),
  grant_second_attack: action({
    category: "combat",
    summary: "Grants an additional attack to targets.",
    handler: "handleBuffStatsTemp",
    required: ["targetRef"],
    fields: COMMON_TARGET_FIELDS,
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["status"],
    examples: [{ type: "grant_second_attack", targetRef: "self" }],
  }),
  grant_void_fusion_immunity: action({
    category: "stats",
    summary: "Grants temporary immunity to Void Fusion monsters.",
    handler: "proxy:applyGrantVoidFusionImmunity",
    optional: ["archetype", "durationTurns"],
    fields: {
      archetype: { type: "string" },
      durationTurns: { type: "number" },
    },
    mutates: ["status"],
    examples: [{ type: "grant_void_fusion_immunity", archetype: "Void", durationTurns: 1 }],
  }),
  heal: action({
    category: "resources",
    summary: "Restores LP.",
    handler: "proxy:applyHeal",
    required: ["amount"],
    optional: ["player"],
    fields: {
      amount: field("amount"),
      player: field("player"),
    },
    mutates: ["lp"],
    examples: [{ type: "heal", player: "self", amount: 1000 }],
  }),
  heal_from_destroyed_atk: action({
    category: "resources",
    summary: "Heals based on the destroyed monster's ATK.",
    handler: "handleHealFromDestroyedAtk",
    optional: ["fraction"],
    fields: { fraction: { type: "number" } },
    mutates: ["lp"],
    examples: [{ type: "heal_from_destroyed_atk", fraction: 0.5 }],
  }),
  heal_from_destroyed_level: action({
    category: "resources",
    summary: "Heals based on the destroyed monster's level.",
    handler: "handleHealFromDestroyedLevel",
    optional: ["multiplier", "player"],
    fields: {
      multiplier: { type: "number" },
      player: field("player"),
    },
    mutates: ["lp"],
    examples: [{ type: "heal_from_destroyed_level", player: "self", multiplier: 200 }],
  }),
  heal_per_archetype_monster: action({
    category: "resources",
    summary: "Heals for each matching archetype monster.",
    handler: "proxy:applyHealPerArchetypeMonster",
    required: ["archetype", "amountPerMonster"],
    optional: ["player"],
    fields: {
      archetype: { type: "string" },
      amountPerMonster: { type: "number" },
      player: field("player"),
    },
    mutates: ["lp"],
    examples: [{ type: "heal_per_archetype_monster", player: "self", archetype: "Luminarch", amountPerMonster: 300 }],
  }),
  heal_per_field_count: action({
    category: "resources",
    summary: "Heals for each field card matching filters.",
    handler: "handleHealPerFieldCount",
    required: ["amountPerCard"],
    optional: ["filters", "player"],
    fields: {
      amountPerCard: { type: "number" },
      filters: field("filters"),
      player: field("player"),
    },
    mutates: ["lp"],
    examples: [{ type: "heal_per_field_count", player: "self", amountPerCard: 500, filters: { archetype: "Luminarch" } }],
  }),
  heal_per_opponent_cards_and_hand: action({
    category: "resources",
    summary: "Heals for each card the opponent controls plus each card in their hand.",
    handler: "handleHealPerOpponentCardsAndHand",
    required: ["amountPerCard"],
    optional: ["player"],
    fields: {
      amountPerCard: { type: "number" },
      player: field("player"),
    },
    mutates: ["lp"],
    examples: [{ type: "heal_per_opponent_cards_and_hand", player: "self", amountPerCard: 200 }],
  }),
  mirror_force_destroy_all: action({
    category: "destruction",
    summary: "Destroys all opponent attack-position monsters for Mirror Force.",
    handler: "proxy:applyMirrorForceDestroy",
    fields: {},
    mutates: ["field", "graveyard"],
    emits: ["before_destroy", "card_to_grave"],
    examples: [{ type: "mirror_force_destroy_all" }],
  }),
  modify_stats_temp: action({
    category: "stats",
    summary: "Temporarily modifies stats using factors.",
    handler: "proxy:applyModifyStatsTemp",
    required: ["targetRef"],
    optional: ["atkFactor", "defFactor"],
    fields: {
      ...COMMON_TARGET_FIELDS,
      atkFactor: { type: "number" },
      defFactor: { type: "number" },
    },
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["stats"],
    examples: [{ type: "modify_stats_temp", targetRef: "spear_zero_target", atkFactor: 0, defFactor: 0 }],
  }),
  move: action({
    category: "movement",
    summary: "Moves target cards to another zone.",
    handler: "proxy:applyMove",
    required: ["targetRef", "to"],
    optional: [
      "player",
      "isFacedown",
      "resetAttackFlags",
      "allowExtraDeckMonsterToHand",
      "allowExtraDeckMonsterToHandIf",
    ],
    fields: {
      ...COMMON_TARGET_FIELDS,
      to: field("to"),
      player: field("player"),
      isFacedown: { type: "boolean" },
      resetAttackFlags: { type: "boolean" },
      allowExtraDeckMonsterToHand: { type: "boolean" },
      allowExtraDeckMonsterToHandIf: {
        type: "object",
        description:
          "Optional condition that lets an Extra Deck monster pass through hand instead of redirecting to Extra Deck.",
      },
    },
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["zones"],
    emits: ["after_summon", "card_to_grave"],
    preview: "covered",
    examples: [{ type: "move", targetRef: "reborn_target", player: "self", to: "field", isFacedown: false }],
  }),
  negate_attack: action({
    category: "combat",
    summary: "Negates the current attack.",
    handler: "proxy:applyNegateAttack",
    fields: {},
    mutates: ["combatState"],
    examples: [{ type: "negate_attack" }],
  }),
  negate_summon_or_activation_and_destroy: action({
    category: "combat",
    summary: "Negates the current summon attempt or activation context, then destroys that card.",
    handler: "handleNegateSummonOrActivationAndDestroy",
    fields: {},
    mutates: ["chain", "field", "graveyard"],
    emits: ["card_to_grave"],
    examples: [{ type: "negate_summon_or_activation_and_destroy" }],
  }),
  pay_lp: action({
    category: "resources",
    summary: "Pays LP as a cost.",
    handler: "handlePayLP",
    required: ["amount"],
    optional: ["player"],
    fields: {
      amount: field("amount"),
      player: field("player"),
    },
    mutates: ["lp"],
    preview: "covered",
    examples: [{ type: "pay_lp", amount: 1000 }],
  }),
  permanent_buff_named: action({
    category: "stats",
    summary: "Applies a named persistent buff.",
    handler: "handlePermanentBuffNamed",
    optional: [
      "targetRef",
      "sourceName",
      "archetype",
      "atkBoost",
      "defBoost",
      "applyToAllField",
      "cumulative",
    ],
    fields: {
      ...COMMON_TARGET_FIELDS,
      sourceName: { type: "string" },
      archetype: { type: "string" },
      atkBoost: { type: "number" },
      defBoost: { type: "number" },
      applyToAllField: { type: "boolean" },
      cumulative: { type: "boolean" },
    },
    targetRef: "optional",
    selection: "usesTargets",
    mutates: ["stats"],
    examples: [{ type: "permanent_buff_named", targetRef: "self", sourceName: "Darkness Valley", atkBoost: 300 }],
  }),
  polymerization_fusion_summon: action({
    category: "summon",
    summary: "Performs Fusion Summon using valid materials.",
    handler: "proxy:applyPolymerizationFusion",
    fields: {},
    selection: "dynamic",
    mutates: ["hand", "field", "graveyard", "extraDeck"],
    emits: ["after_summon", "card_to_grave"],
    preview: "covered",
    examples: [{ type: "polymerization_fusion_summon" }],
  }),
  reduce_self_atk: action({
    category: "stats",
    summary: "Alias for temporary self ATK reduction through buff handler.",
    handler: "handleBuffStatsTemp",
    optional: ["targetRef", "atkBoost", "defBoost"],
    fields: {
      ...COMMON_TARGET_FIELDS,
      atkBoost: { type: "number" },
      defBoost: { type: "number" },
    },
    targetRef: "optional",
    selection: "usesTargets",
    mutates: ["stats"],
    examples: [{ type: "reduce_self_atk", targetRef: "self", atkBoost: -700 }],
    notes: ["Registered but not currently used by card data."],
  }),
  register_replacement_effect: action({
    category: "destruction",
    summary: "Registers a temporary replacement effect.",
    handler: "handleRegisterReplacementEffect",
    required: ["replacementEffect"],
    optional: ["duration", "sourceName", "uniqueKey", "uses"],
    fields: {
      duration: { type: "string" },
      replacementEffect: { type: "object" },
      sourceName: { type: "string" },
      uniqueKey: { type: "string" },
      uses: { type: "number" },
    },
    mutates: ["replacementEffects"],
    preview: "missing",
    examples: [{ type: "register_replacement_effect", replacementEffect: { type: "negate_destruction" } }],
  }),
  schedule_return_from_banished: action({
    category: "summon",
    summary:
      "Schedules a banished card to return to the field at a future phase (default: end of next turn).",
    handler: "handleScheduleReturnFromBanished",
    optional: ["cardRef", "returnPhase", "delayTurns"],
    fields: {
      cardRef: { type: "string" },
      returnPhase: { type: "string" },
      delayTurns: { type: "number" },
    },
    mutates: ["delayedActions"],
    preview: "missing",
    examples: [
      { type: "schedule_return_from_banished", cardRef: "self", delayTurns: 1, returnPhase: "end" },
    ],
  }),
  remove_counter: action({
    category: "counters",
    summary: "Removes counters from target or source card.",
    handler: "proxy:applyRemoveCounter",
    required: ["targetRef", "counterType", "amount"],
    fields: {
      ...COMMON_TARGET_FIELDS,
      counterType: { type: "string" },
      amount: field("amount"),
    },
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["counters"],
    examples: [{ type: "remove_counter", targetRef: "self", counterType: "ink", amount: 2 }],
  }),
  remove_permanent_buff_named: action({
    category: "stats",
    summary: "Removes a named persistent buff.",
    handler: "handleRemovePermanentBuffNamed",
    optional: ["targetRef", "sourceName", "archetype", "removeFromAllField"],
    fields: {
      ...COMMON_TARGET_FIELDS,
      sourceName: { type: "string" },
      archetype: { type: "string" },
      removeFromAllField: { type: "boolean" },
    },
    targetRef: "optional",
    selection: "usesTargets",
    mutates: ["stats"],
    examples: [{ type: "remove_permanent_buff_named", targetRef: "self", sourceName: "Darkness Valley" }],
  }),
  return_to_hand: action({
    category: "movement",
    summary: "Returns target cards to hand.",
    handler: "handleReturnToHand",
    required: ["targetRef"],
    optional: ["fromZone"],
    fields: {
      ...COMMON_TARGET_FIELDS,
      fromZone: field("fromZone"),
    },
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["hand", "field", "graveyard"],
    examples: [{ type: "return_to_hand", targetRef: "returning" }],
  }),
  shuffle_opponent_field_to_deck: action({
    category: "movement",
    summary: "Shuffles all cards the opponent controls into their Deck.",
    handler: "handleShuffleOpponentFieldToDeck",
    fields: {},
    mutates: ["field", "spellTrap", "fieldSpell", "deck"],
    examples: [{ type: "shuffle_opponent_field_to_deck" }],
  }),
  search_any: action({
    category: "resources",
    summary: "Searches the deck and adds a card to hand.",
    handler: "handleAddFromZoneToHand",
    optional: [
      "archetype",
      "cardKind",
      "cardName",
      "count",
      "filters",
      "maxLevel",
      "minLevel",
      "player",
      "promptPlayer",
    ],
    fields: {
      archetype: { type: "string" },
      cardKind: { type: "stringOrArray" },
      cardName: { type: "string" },
      count: field("count"),
      filters: field("filters"),
      maxLevel: { type: "number" },
      minLevel: { type: "number" },
      player: field("player"),
      promptPlayer: { type: "boolean" },
    },
    selection: "dynamic",
    mutates: ["deck", "hand"],
    preview: "covered",
    examples: [{ type: "search_any", archetype: "Shadow-Heart", count: { min: 1, max: 1 } }],
  }),
  selective_field_destruction: action({
    category: "destruction",
    summary: "Destroys field cards while keeping a configured number per side.",
    handler: "handleDestroyTargetedCards",
    optional: ["allowTieBreak", "keepPerSide", "modalInfoText", "modalTitle"],
    fields: {
      allowTieBreak: { type: "boolean" },
      keepPerSide: { type: "number" },
      modalInfoText: { type: "string" },
      modalTitle: { type: "string" },
    },
    selection: "dynamic",
    mutates: ["field", "graveyard"],
    emits: ["before_destroy", "card_to_grave"],
    preview: "missing",
    examples: [{ type: "selective_field_destruction", keepPerSide: 1 }],
  }),
  set_stats_to_zero_and_negate: action({
    category: "stats",
    summary: "Sets target stats to zero and optionally negates effects.",
    handler: "handleSetStatsToZeroAndNegate",
    required: ["targetRef"],
    optional: ["negateEffects", "setAtkToZero", "setDefToZero"],
    fields: {
      ...COMMON_TARGET_FIELDS,
      negateEffects: { type: "boolean" },
      setAtkToZero: { type: "boolean" },
      setDefToZero: { type: "boolean" },
    },
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["stats", "status"],
    examples: [{ type: "set_stats_to_zero_and_negate", targetRef: "armored_arctroth_zero_target", negateEffects: true }],
  }),
  shuffle_deck: action({
    category: "resources",
    summary: "Shuffles a player's deck.",
    handler: "proxy:applyShuffleDeck",
    optional: ["player"],
    fields: { player: field("player") },
    mutates: ["deck"],
    examples: [{ type: "shuffle_deck", player: "self" }],
  }),
  special_summon_from_deck_with_counter_limit: action({
    category: "summon",
    summary: "Special Summons from deck using source counters as an ATK limit.",
    handler: "handleSpecialSummonFromDeckWithCounterLimit",
    optional: ["archetype", "counterMultiplier", "counterType", "sendSourceToGraveAfter"],
    fields: {
      archetype: { type: "string" },
      counterMultiplier: { type: "number" },
      counterType: { type: "string" },
      sendSourceToGraveAfter: { type: "boolean" },
    },
    selection: "dynamic",
    mutates: ["deck", "field", "graveyard"],
    emits: ["after_summon"],
    preview: "missing",
    examples: [{ type: "special_summon_from_deck_with_counter_limit", archetype: "Shadow-Heart", counterType: "judgment_marker" }],
  }),
  special_summon_from_hand_with_cost: action({
    category: "summon",
    summary: "Special Summons source from hand by paying a target cost.",
    handler: "handleSpecialSummonFromHandWithCost",
    optional: ["costTargetRef", "costDestination", "position", "cannotAttackThisTurn"],
    fields: {
      costTargetRef: { type: "string" },
      costDestination: field("to"),
      position: field("position"),
      cannotAttackThisTurn: { type: "boolean" },
    },
    selection: "usesTargets",
    mutates: ["hand", "field", "graveyard"],
    emits: ["after_summon", "card_to_grave"],
    preview: "covered",
    examples: [{ type: "special_summon_from_hand_with_cost", costTargetRef: "cost", position: "attack" }],
  }),
  special_summon_from_hand_with_tiered_cost: action({
    category: "summon",
    summary: "Special Summons from hand with variable/tiered cost.",
    handler: "handleSpecialSummonFromHandWithCost",
    optional: ["costFilters", "maxCost", "minCost", "position", "tier1AtkBoost", "tierOptions"],
    fields: {
      costFilters: field("filters"),
      maxCost: { type: "number" },
      minCost: { type: "number" },
      position: field("position"),
      tier1AtkBoost: { type: "number" },
      tierOptions: { type: "array" },
    },
    selection: "dynamic",
    mutates: ["hand", "field", "graveyard"],
    emits: ["after_summon", "card_to_grave"],
    preview: "covered",
    examples: [{ type: "special_summon_from_hand_with_tiered_cost", minCost: 1, maxCost: 2, position: "attack" }],
  }),
  special_summon_from_zone: action({
    category: "summon",
    summary: "Special Summons cards from a configured zone.",
    handler: "handleSpecialSummonFromZone",
    optional: [
      "targetRef",
      "zone",
      "sourceZone",
      "filters",
      "count",
      "archetype",
      "cardName",
      "minAtk",
      "maxAtk",
      "minDef",
      "maxDef",
      "minLevel",
      "maxLevel",
      "position",
      "promptPlayer",
      "requireSource",
      "banishCost",
      "cannotAttackThisTurn",
      "excludeSummonRestrict",
      "negateEffects",
      "oncePerTurnName",
      "setAtkToZeroAfterSummon",
      "setDefToZeroAfterSummon",
      "atkBoostAfterSummon",
      "defBoostAfterSummon",
    ],
    fields: {
      ...COMMON_TARGET_FIELDS,
      ...COMMON_FILTER_FIELDS,
      sourceZone: field("sourceZone"),
      cardName: { type: "string" },
      maxLevel: { type: "number" },
      banishCost: { type: "any" },
      cannotAttackThisTurn: { type: "boolean" },
      excludeSummonRestrict: { type: "any" },
      negateEffects: { type: "boolean" },
      oncePerTurnName: { type: "string" },
      position: field("position"),
      setAtkToZeroAfterSummon: { type: "boolean" },
      setDefToZeroAfterSummon: { type: "boolean" },
      atkBoostAfterSummon: { type: "number" },
      defBoostAfterSummon: { type: "number" },
    },
    targetRef: "optional",
    selection: "dynamic",
    mutates: ["deck", "hand", "graveyard", "field"],
    emits: ["after_summon"],
    preview: "covered",
    examples: [{ type: "special_summon_from_zone", zone: "graveyard", filters: { cardKind: "monster" }, position: "choice" }],
  }),
  special_summon_matching_level: action({
    category: "summon",
    summary: "Special Summons a card matching another target's level.",
    handler: "handleSpecialSummonFromZone",
    required: ["matchLevelRef", "zone"],
    optional: ["position", "cannotAttackThisTurn", "negateEffects"],
    fields: {
      matchLevelRef: { type: "string" },
      zone: field("zone"),
      position: field("position"),
      cannotAttackThisTurn: { type: "boolean" },
      negateEffects: { type: "boolean" },
    },
    selection: "dynamic",
    mutates: ["graveyard", "field"],
    emits: ["after_summon"],
    preview: "covered",
    examples: [{ type: "special_summon_matching_level", matchLevelRef: "cost", zone: "graveyard", position: "choice" }],
  }),
  special_summon_token: action({
    category: "summon",
    summary: "Creates and Special Summons a token.",
    handler: "proxy:applySpecialSummonToken",
    required: ["token"],
    optional: ["player", "position"],
    fields: {
      token: { type: "object" },
      player: field("player"),
      position: field("position"),
    },
    mutates: ["field"],
    emits: ["after_summon"],
    examples: [{ type: "special_summon_token", player: "self", position: "choice", token: { name: "Token", atk: 500, def: 500 } }],
  }),
  switch_defender_position_on_attack: action({
    category: "combat",
    summary: "Switches the attacked defender's battle position.",
    handler: "handleSwitchDefenderPositionOnAttack",
    fields: {},
    mutates: ["position"],
    examples: [{ type: "switch_defender_position_on_attack" }],
  }),
  switch_position: action({
    category: "stats",
    summary: "Switches target battle position.",
    handler: "handleSwitchPosition",
    required: ["targetRef"],
    optional: ["atkBoost", "markChanged"],
    fields: {
      ...COMMON_TARGET_FIELDS,
      atkBoost: { type: "number" },
      markChanged: { type: "boolean" },
    },
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["position", "stats"],
    examples: [{ type: "switch_position", targetRef: "tera_arcanist_earth_targets" }],
  }),
  transmutate: action({
    category: "summon",
    summary: "Sends a target monster to GY and summons a monster with matching level.",
    handler: "handleTransmutate",
    required: ["targetRef"],
    fields: COMMON_TARGET_FIELDS,
    targetRef: "required",
    selection: "usesTargets",
    mutates: ["field", "graveyard"],
    emits: ["after_summon", "card_to_grave"],
    preview: "covered",
    examples: [{ type: "transmutate", targetRef: "transmutate_cost" }],
  }),
  upkeep_pay_or_send_to_grave: action({
    category: "resources",
    summary: "Pays LP upkeep or sends the source to a failure zone.",
    handler: "handleUpkeepPayOrSendToGrave",
    required: ["lpCost"],
    optional: ["failureZone"],
    fields: {
      lpCost: { type: "number" },
      failureZone: field("to"),
    },
    mutates: ["lp", "zones"],
    emits: ["card_to_grave"],
    examples: [{ type: "upkeep_pay_or_send_to_grave", lpCost: 500, failureZone: "graveyard" }],
  }),
};

const CONTEXT_TARGET_REFS = new Set([
  "self",
  "source",
  "summonedCard",
  "destroyed",
  "attacker",
  "defender",
  "target",
  "targetedCard",
  "host",
  "opponent_field",
]);

export function listCatalogActionTypes() {
  return Object.keys(ACTION_CATALOG).sort();
}

export function getActionCatalogEntry(type) {
  return ACTION_CATALOG[type] || null;
}

function describeField(fieldDef = {}) {
  if (fieldDef.enum) return `one of ${fieldDef.enum.join(", ")}`;
  if (fieldDef.type) return fieldDef.type;
  return "value";
}

function validateFieldValue(fieldName, fieldDef, value) {
  const errors = [];
  if (!fieldDef || value === undefined || value === null) return errors;

  if (fieldDef.enum && !fieldDef.enum.includes(value)) {
    errors.push(
      `Field "${fieldName}" must be ${describeField(fieldDef)}; got "${value}".`,
    );
    return errors;
  }

  if (fieldDef.type === "number" && typeof value !== "number") {
    errors.push(`Field "${fieldName}" must be a number.`);
    return errors;
  }
  if (
    fieldDef.type === "number" &&
    typeof fieldDef.min === "number" &&
    value < fieldDef.min
  ) {
    errors.push(`Field "${fieldName}" must be >= ${fieldDef.min}.`);
  }
  if (fieldDef.type === "string" && typeof value !== "string") {
    errors.push(`Field "${fieldName}" must be a string.`);
  }
  if (
    fieldDef.type === "stringOrArray" &&
    typeof value !== "string" &&
    !Array.isArray(value)
  ) {
    errors.push(`Field "${fieldName}" must be a string or array.`);
  }
  if (fieldDef.type === "boolean" && typeof value !== "boolean") {
    errors.push(`Field "${fieldName}" must be a boolean.`);
  }
  if (
    fieldDef.type === "object" &&
    (typeof value !== "object" || Array.isArray(value))
  ) {
    errors.push(`Field "${fieldName}" must be an object.`);
  }
  if (fieldDef.type === "array" && !Array.isArray(value)) {
    errors.push(`Field "${fieldName}" must be an array.`);
  }
  if (fieldDef.type === "zone") {
    const values = Array.isArray(value) ? value : [value];
    const invalid = values.filter((zone) => !ZONES.includes(zone));
    if (invalid.length > 0) {
      errors.push(
        `Field "${fieldName}" has invalid zone value(s): ${invalid.join(", ")}.`,
      );
    }
  }

  return errors;
}

export function validateActionShape(actionDef, context = {}) {
  const errors = [];
  const warnings = [];

  if (!actionDef || typeof actionDef !== "object") {
    return { errors: ["Action must be an object."], warnings };
  }

  const type = actionDef.type;
  const entry = getActionCatalogEntry(type);
  if (!entry) {
    warnings.push(`Action type "${type}" is registered but missing from ACTION_CATALOG.`);
    return { errors, warnings };
  }

  const fields = entry.fields || {};
  const allowedFields = new Set(["type", ...Object.keys(fields)]);
  for (const requiredField of entry.required || []) {
    if (actionDef[requiredField] === undefined) {
      errors.push(
        `Action "${type}" is missing required field "${requiredField}".`,
      );
    }
  }

  for (const key of Object.keys(actionDef)) {
    if (!allowedFields.has(key)) {
      warnings.push(`Action "${type}" has unknown field "${key}".`);
      continue;
    }
    errors.push(...validateFieldValue(key, fields[key], actionDef[key]));
  }

  const targetRefMode = entry.targetRef || "none";
  const targetRef = actionDef.targetRef;
  if (targetRefMode === "required" && !targetRef) {
    errors.push(`Action "${type}" requires targetRef.`);
  }
  if (targetRef && typeof targetRef !== "string") {
    errors.push(`Action "${type}" targetRef must be a string.`);
  }
  if (targetRef && typeof targetRef === "string") {
    const targetIds = context.targetIds || new Set();
    if (!targetIds.has(targetRef) && !CONTEXT_TARGET_REFS.has(targetRef)) {
      errors.push(
        `Action "${type}" targetRef "${targetRef}" does not match any effect target id.`,
      );
    }
  }

  return { errors, warnings };
}
