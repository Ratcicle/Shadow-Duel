export const shadowHeartCards = [
  {
    id: 101,
    name: "Shadow-Heart Abyssal Eel",
    cardKind: "monster",
    atk: 1600,
    def: 1700,
    level: 4,
    type: "Sea Serpent",
    attribute: "Water",
    archetype: "Shadow-Heart",
    description:
      'If this card is attacked while in Defense Position: inflict 600 damage to your opponent. If this card is destroyed by battle: You can add 1 "Shadow-Heart" Spell/Trap from your Graveyard to your hand.',
    image: "assets/Shadow-Heart Abyssal Eel.png",
    effects: [
      {
        id: "shadow_heart_abyssal_eel_battle_damage",
        timing: "on_event",
        event: "attack_declared",
        requireDefenderPosition: true,
        requireSelfAsDefender: true,
        actions: [
          {
            type: "damage",
            player: "opponent",
            amount: 600,
          },
        ],
      },
      {
        id: "shadow_heart_abyssal_eel_recover",
        timing: "on_event",
        event: "battle_destroy",
        requireSelfAsDestroyed: true,
        targets: [
          {
            id: "eel_recover_target",
            owner: "self",
            zone: "graveyard",
            cardKind: ["spell", "trap"],
            archetype: "Shadow-Heart",
            count: { min: 0, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "eel_recover_target",
            player: "self",
            to: "hand",
          },
        ],
      },
    ],
  },
  {
    id: 102,
    name: "Shadow-Heart Specter",
    cardKind: "monster",
    atk: 800,
    def: 800,
    level: 2,
    type: "Spirit",
    attribute: "Dark",
    archetype: "Shadow-Heart",
    description:
      'If this card is sent to the Graveyard: You can target 1 "Shadow-Heart" monster in your Graveyard, except "Shadow-Heart Specter"; add it to your hand. You can only use this effect of "Shadow-Heart Specter" once per turn.',
    image: "assets/Shadow-Heart Specter.png",
    effects: [
      {
        id: "shadow_heart_specter_recycle",
        timing: "on_event",
        event: "card_to_grave",
        fromZone: "any",
        oncePerTurn: true,
        oncePerTurnName: "shadow_heart_specter_recycle",
        targets: [
          {
            id: "specter_recycle_target",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            archetype: "Shadow-Heart",
            excludeCardName: "Shadow-Heart Specter",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "specter_recycle_target",
            player: "self",
            to: "hand",
          },
        ],
      },
    ],
  },
  {
    id: 103,
    name: "Shadow-Heart Purge",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Shadow-Heart",
    description:
      'Discard 1 "Shadow-Heart" card, then target 1 face-up monster your opponent controls; it loses 1000 ATK until the end of this turn. If that monster\'s ATK becomes 0 by this effect, destroy it. You can only activate 1 "Shadow-Heart Purge" per turn.',
    image: "assets/Shadow-Heart Purge.png",
    effects: [
      {
        id: "shadow_heart_purge_debuff",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "shadow_heart_purge",
        targets: [
          {
            id: "purge_discard",
            owner: "self",
            zone: "hand",
            archetype: "Shadow-Heart",
            count: { min: 1, max: 1 },
          },
          {
            id: "purge_target_monster",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "purge_discard",
            player: "self",
            to: "graveyard",
          },
          {
            type: "modify_stats_temp_then_destroy_if_zeroed",
            targetRef: "purge_target_monster",
            atkChange: -1000,
            destroyIfAtkZeroedByThisEffect: true,
          },
        ],
      },
    ],
  },
  {
    id: 104,
    name: "Shadow-Heart Demon Arctroth",
    cardKind: "monster",
    atk: 2600,
    def: 1800,
    level: 8,
    type: "Fiend",
    attribute: "Dark",
    archetype: "Shadow-Heart",
    description:
      "If this card is Normal Summoned: target 1 monster your opponent controls; destroy that target.",
    image: "assets/Shadow-Heart Demon Arctroth.png",
    effects: [
      {
        id: "shadow_heart_arctroth_on_summon",
        timing: "on_event",
        event: "after_summon",
        summonMethods: ["tribute"],
        requireSelfAsSummoned: true,
        targets: [
          {
            id: "destroy_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "destroy",
            targetRef: "destroy_target",
          },
        ],
      },
    ],
  },
  {
    id: 105,
    name: "Shadow-Heart Battle Hymn",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Shadow-Heart",
    description:
      'All "Shadow-Heart" monsters you control gain 500 ATK until the end of this turn.',
    image: "assets/Shadow-Heart Battle Hymn.png", // cria esse PNG depois
    effects: [
      {
        id: "shadow_heart_battle_hymn",
        timing: "on_play",
        speed: 1,
        targets: [
          {
            id: "shadowheart_allies",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Shadow-Heart", // <<< filtro de arquÃ©tipo
            requireFaceup: true,
            count: { min: 1, max: 5 },
            autoSelect: true, // pega automaticamente todos os vÃ¡lidos
          },
        ],
        actions: [
          {
            type: "buff_atk_temp",
            targetRef: "shadowheart_allies",
            amount: 500,
          },
        ],
      },
    ],
  },
  {
    id: 106,
    name: "Shadow-Heart Covenant",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Shadow-Heart",
    description:
      'Pay 800 LP; add 1 "Shadow-Heart" card from your Deck to your hand. You must control no other cards to activate this effect. You can only activate 1 "Shadow-Heart Covenant" per turn.',
    image: "assets/Shadow-Heart Covenant.png",
    effects: [
      {
        id: "shadow_heart_covenant",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "shadow_heart_covenant",
        conditions: [
          {
            type: "control_card_filters",
            owner: "self",
            zones: ["field", "spellTrap", "fieldSpell"],
            includeFacedown: true,
            excludeSource: true,
            max: 0,
            reason: "You must control no other cards to activate this effect.",
          },
        ],
        actions: [
          {
            type: "pay_lp",
            amount: 800,
            player: "self",
          },
          {
            type: "search_any",
            archetype: "Shadow-Heart",
          },
        ],
      },
    ],
  },
  {
    id: 107,
    name: "Shadow-Heart Imp",
    cardKind: "monster",
    atk: 1500,
    def: 800,
    level: 4,
    type: "Fiend",
    attribute: "Dark",
    archetype: "Shadow-Heart",
    description:
      'When this card is Normal Summoned: You can Special Summon 1 Level 4 or lower "Shadow-Heart" monster from your hand. You can only use this effect of "Shadow-Heart Imp" once per turn.',
    image: "assets/Shadow-Heart Imp.png",
    effects: [
      {
        id: "shadow_heart_imp_on_summon",
        timing: "on_event",
        event: "after_summon",
        requireSelfAsSummoned: true,
        summonMethods: ["normal"],
        oncePerTurn: true,
        oncePerTurnName: "shadow_heart_imp_on_summon",
        targets: [
          {
            id: "imp_special_from_hand",
            owner: "self",
            zone: "hand",
            cardKind: "monster",
            archetype: "Shadow-Heart",
            maxLevel: 4,
            // limita a monstros Level 4 ou menos
            count: { min: 0, max: 1 },
          },
        ],
        actions: [
          {
            type: "special_summon_from_zone",
            targetRef: "imp_special_from_hand",
            zone: "hand",
            position: "choice",
          },
        ],
      },
    ],
  },
  {
    id: 108,
    name: "Shadow-Heart Gecko",
    cardKind: "monster",
    atk: 1000,
    def: 1000,
    level: 3,
    type: "Reptile",
    attribute: "Dark",
    archetype: "Shadow-Heart",
    description:
      'If this card is Special Summoned: You can add 1 Level 8 "Shadow-Heart" monster from your Deck to your hand. If this card is destroyed by battle: draw 1 card. You can only use each effect of "Shadow-Heart Gecko" once per turn.',
    image: "assets/Shadow-Heart Gecko.png",
    effects: [
      {
        id: "shadow_heart_gecko_special_search",
        timing: "on_event",
        event: "after_summon",
        summonMethods: ["special"],
        requireSelfAsSummoned: true,
        oncePerTurn: true,
        oncePerTurnName: "shadow_heart_gecko_special_search",
        actions: [
          {
            type: "search_any",
            player: "self",
            archetype: "Shadow-Heart",
            cardKind: "monster",
            minLevel: 8,
            maxLevel: 8,
          },
        ],
      },
      {
        id: "shadow_heart_gecko_battle_draw",
        timing: "on_event",
        event: "battle_destroy",
        requireSelfAsDestroyed: true,
        oncePerTurn: true,
        oncePerTurnName: "shadow_heart_gecko_battle_draw",
        actions: [
          {
            type: "draw",
            player: "self",
            amount: 1,
          },
        ],
      },
    ],
  },
  {
    id: 109,
    name: "Shadow-Heart Coward",
    cardKind: "monster",
    atk: 800,
    def: 1000,
    level: 3,
    type: "Fiend",
    attribute: "Dark",
    archetype: "Shadow-Heart",
    description:
      "If this card is discarded from your hand to the Graveyard: target 1 monster your opponent controls; its ATK and DEF are halved until the end of this turn.",
    image: "assets/Shadow-Heart Coward.png",
    effects: [
      {
        id: "shadow_heart_coward_discard",
        timing: "on_event",
        event: "card_to_grave",
        fromZone: "hand",
        targets: [
          {
            id: "coward_debuff_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "modify_stats_temp",
            targetRef: "coward_debuff_target",
            atkFactor: 0.5,
            defFactor: 0.5,
          },
        ],
      },
    ],
  },
  {
    id: 110,
    name: "Shadow-Heart Infusion",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Shadow-Heart",
    description:
      'Discard 2 cards from your hand, then Special Summon 1 "Shadow-Heart" monster from your Graveyard, but it cannot declare an attack this turn. You can only activate 1 "Shadow-Heart Infusion" per turn.',
    image: "assets/Shadow-Heart Infusion.png",
    effects: [
      {
        id: "shadow_heart_infusion",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "shadow_heart_infusion",
        targets: [
          {
            id: "infusion_discard",
            owner: "self",
            zone: "hand",
            count: { min: 2, max: 2 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "infusion_discard",
            player: "self",
            to: "graveyard",
          },
          {
            type: "optional_target_actions",
            allowCancel: false,
            logIfSkipped: true,
            selectionMessage:
              'Choose 1 "Shadow-Heart" monster in your Graveyard to Special Summon.',
            targets: [
              {
                id: "infusion_revive_target",
                owner: "self",
                zone: "graveyard",
                archetype: "Shadow-Heart",
                cardKind: "monster",
                count: { min: 1, max: 1 },
              },
            ],
            actions: [
              {
                type: "special_summon_from_zone",
                targetRef: "infusion_revive_target",
                zone: "graveyard",
                excludeSummonRestrict: ["shadow_heart_invocation_only"],
                position: "choice",
                cannotAttackThisTurn: true,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 111,
    name: "Shadow-Heart Scale Dragon",
    cardKind: "monster",
    atk: 3000,
    def: 2500,
    level: 8,
    type: "Dragon",
    attribute: "Dark",
    archetype: "Shadow-Heart",
    description:
      'If this card was Tribute Summoned, it gains the following effects: \n●If this card destroys an opponent\'s monster by battle: You can target 1 "Shadow-Heart" card in your Graveyard; add it to your hand. \n●If this card is destroyed by battle or by an opponent\'s card effect: You can Special Summon up to 3 "Shadow-Heart" monsters with 1600 or less ATK from your Graveyard. You can only use each effect of "Shadow-Heart Scale Dragon" once per turn.',
    image: "assets/Shadow-Heart Scale Dragon.png",
    effects: [
      {
        id: "shadow_heart_scale_dragon_recycle",
        timing: "on_event",
        event: "battle_destroy",
        requireSelfAsAttacker: true,
        requireDestroyedIsOpponent: true,
        requireSelfWasSummonedBy: "tribute",
        oncePerTurn: true,
        oncePerTurnName: "shadow_heart_scale_dragon_recycle",
        targets: [
          {
            id: "shadow_heart_recycle_target",
            owner: "self",
            zone: "graveyard",
            archetype: "Shadow-Heart",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "shadow_heart_recycle_target",
            player: "self",
            to: "hand",
          },
        ],
      },
      {
        id: "shadow_heart_scale_dragon_tribute_destroyed_revive",
        timing: "on_event",
        event: "card_to_grave",
        fromZone: "field",
        condition: { type: "destroyed_by_battle_or_effect" },
        requireSelfWasSummonedBy: "tribute",
        requireDestroyedByOpponent: true,
        oncePerTurn: true,
        oncePerTurnName: "shadow_heart_scale_dragon_tribute_destroyed_revive",
        actions: [
          {
            type: "special_summon_from_zone",
            zone: "graveyard",
            filters: {
              archetype: "Shadow-Heart",
              cardKind: "monster",
              maxAtk: 1600,
            },
            count: { min: 0, max: 3 },
            position: "choice",
          },
        ],
      },
    ],
  },
  {
    id: 112,
    name: "Shadow-Heart Rage",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Shadow-Heart",
    description:
      'Choose 1 Dragon "Shadow-Heart" monster you control; it gains 700 ATK/DEF until the end of this turn, and it can make a second attack during this Battle Phase. You cannot attack directly the turn you activate this effect.',
    image: "assets/Shadow-Heart Rage.png",
    effects: [
      {
        id: "shadow_heart_rage_dragon_buff_effect",
        timing: "on_play",
        speed: 1,
        targets: [
          {
            id: "rage_dragon_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Shadow-Heart",
            type: "Dragon",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "buff_stats_temp_with_second_attack",
            targetRef: "rage_dragon_target",
            atkBoost: 700,
            defBoost: 700,
          },
          {
            type: "forbid_direct_attack_this_turn",
            player: "self",
          },
        ],
      },
    ],
  },
  {
    id: 113,
    name: "Shadow-Heart Shield",
    cardKind: "spell",
    subtype: "equip",
    archetype: "Shadow-Heart",
    description:
      "Equip only to a monster you control. It gains 500 ATK/DEF and cannot be destroyed by battle. During each of your Standby Phases: pay 800 LP or send this card to the Graveyard.",
    image: "assets/Shadow-Heart Shield.png",
    effects: [
      {
        id: "shadow_heart_shield_equip",
        timing: "on_play",
        speed: 1,
        targets: [
          {
            id: "shield_equip_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "equip",
            targetRef: "shield_equip_target",
            atkBonus: 500,
            defBonus: 500,
            battleIndestructible: true,
          },
        ],
      },
      {
        id: "shadow_heart_shield_upkeep_effect",
        timing: "on_event",
        event: "standby_phase",
        promptUser: false,
        actions: [
          {
            type: "upkeep_pay_or_send_to_grave",
            lpCost: 800,
            failureZone: "graveyard",
          },
        ],
      },
    ],
  },
  {
    id: 114,
    name: "Shadow-Heart Griffin",
    cardKind: "monster",
    atk: 2000,
    def: 1500,
    level: 5,
    type: "Winged Beast",
    attribute: "Dark",
    archetype: "Shadow-Heart",
    altTribute: { type: "no_tribute_if_empty_field" },
    description:
      "If you control no monsters, you can Normal Summon this card without Tributing.",
    image: "assets/Shadow-Heart Griffin.png",
    effects: [],
  },
  {
    id: 115,
    name: "Darkness Valley",
    cardKind: "spell",
    subtype: "field",
    archetype: "Shadow-Heart",
    description:
      'All "Shadow-Heart" monsters you control gain 300 ATK. Once per turn, if a Level 8 or higher "Shadow-Heart" monster you control is destroyed by battle: destroy the attacking monster.',
    image: "assets/Darkness Valley.png",
    effects: [
      {
        id: "darkness_valley_on_place",
        timing: "on_play",
        actions: [
          {
            type: "permanent_buff_named",
            targetRef: "self",
            atkBoost: 300,
            sourceName: "Darkness Valley",
            cumulative: false,
            archetype: "Shadow-Heart",
            applyToAllField: true,
          },
        ],
      },
      {
        id: "darkness_valley_summon_buff",
        timing: "on_event",
        event: "after_summon",
        actions: [
          {
            type: "permanent_buff_named",
            targetRef: "summonedCard",
            atkBoost: 300,
            sourceName: "Darkness Valley",
            cumulative: false,
            archetype: "Shadow-Heart",
          },
        ],
      },
      {
        id: "darkness_valley_cleanup",
        timing: "on_event",
        event: "card_to_grave",
        fromZone: "fieldSpell",
        actions: [
          {
            type: "remove_permanent_buff_named",
            targetRef: "self",
            sourceName: "Darkness Valley",
            archetype: "Shadow-Heart",
            removeFromAllField: true,
          },
        ],
      },
      {
        id: "darkness_valley_battle_punish",
        timing: "on_event",
        event: "battle_destroy",
        requireSelfAsDestroyed: true,
        oncePerTurn: true,
        oncePerTurnName: "Darkness Valley",
        actions: [
          {
            type: "destroy_attacker_on_archetype_destruction",
            archetype: "Shadow-Heart",
            minLevel: 8,
          },
        ],
      },
    ],
  },
  {
    id: 116,
    name: "Shadow-Heart Death Wyrm",
    cardKind: "monster",
    atk: 2400,
    def: 2000,
    level: 8,
    type: "Fiend",
    attribute: "Dark",
    archetype: "Shadow-Heart",
    description:
      'Quick Effect: Once per turn, when a "Shadow-Heart" monster you control is destroyed by battle: You can Special Summon this card from your hand.',
    image: "assets/Shadow-Heart Death Wyrm.png",
    effects: [
      {
        id: "shadow_heart_death_wyrm_hand_summon",
        timing: "on_event",
        event: "battle_destroy",
        requireOwnMonsterArchetype: "Shadow-Heart",
        oncePerTurn: true,
        oncePerTurnName: "Shadow-Heart Death Wyrm",
        actions: [
          {
            type: "conditional_summon_from_hand",
            targetRef: "self",
            position: "choice",
            optional: true,
            cannotAttackThisTurn: false,
          },
        ],
      },
    ],
  },
  {
    id: 117,
    name: "Shadow-Heart Leviathan",
    cardKind: "monster",
    atk: 2200,
    def: 1800,
    level: 6,
    type: "Sea Serpent",
    attribute: "Water",
    archetype: "Shadow-Heart",
    description:
      'You can Special Summon this card from your hand by sending 1 "Shadow-Heart Abyssal Eel" you control to the GY. If this card destroys a monster by battle: inflict 500 damage to your opponent. If this card is destroyed by battle: inflict 800 damage to your opponent.',
    image: "assets/Shadow-Heart Leviathan.png",
    effects: [
      {
        id: "shadow_heart_leviathan_special_summon_hand",
        timing: "ignition",
        requireZone: "hand",
        targets: [
          {
            id: "leviathan_cost",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            cardName: "Shadow-Heart Abyssal Eel",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "special_summon_from_hand_with_cost",
            costTargetRef: "leviathan_cost",
            position: "choice",
            cannotAttackThisTurn: false,
          },
        ],
      },
      {
        id: "shadow_heart_leviathan_burn_attacker",
        timing: "on_event",
        event: "battle_destroy",
        requireSelfAsAttacker: true,
        actions: [
          {
            type: "damage",
            player: "opponent",
            amount: 500,
          },
        ],
      },
      {
        id: "shadow_heart_leviathan_burn_destroyed",
        timing: "on_event",
        event: "battle_destroy",
        requireSelfAsDestroyed: true,
        actions: [
          {
            type: "damage",
            player: "opponent",
            amount: 800,
          },
        ],
      },
    ],
  },
  {
    id: 118,
    name: "Shadow-Heart Void Mage",
    cardKind: "monster",
    atk: 1500,
    def: 1500,
    level: 4,
    type: "Spellcaster",
    attribute: "Dark",
    archetype: "Shadow-Heart",
    description:
      'If this card is Normal Summoned: You can add 1 "Shadow-Heart" Spell/Trap from your Deck to your hand. If your opponent loses LP while this card is on the field: draw 1 card. You can only use this effect of "Shadow-Heart Void Mage" once per turn.',
    image: "assets/Shadow-Heart Void Mage.png",
    effects: [
      {
        id: "shadow_heart_void_mage_search",
        timing: "on_event",
        event: "after_summon",
        summonMethods: ["normal"],
        requireSelfAsSummoned: true,
        actions: [
          {
            type: "search_any",
            player: "self",
            archetype: "Shadow-Heart",
            cardKind: ["spell", "trap"],
          },
        ],
      },
      {
        id: "shadow_heart_void_mage_draw",
        timing: "on_event",
        event: "opponent_damage",
        oncePerTurn: true,
        oncePerTurnName: "shadow_heart_void_mage_draw",
        actions: [
          {
            type: "draw",
            player: "self",
            amount: 1,
          },
        ],
      },
    ],
  },
  {
    id: 119,
    name: "Shadow-Heart Cathedral",
    cardKind: "spell",
    subtype: "continuous",
    archetype: "Shadow-Heart",
    description:
      'Each time your opponent takes 500 or more damage: place 1 Judgment Counter on this card. During your Main Phase: You can send this face-up card to the GY; Special Summon 1 "Shadow-Heart" monster from your Deck with ATK less than or equal to 500 x the number of Judgment Counters on this card. You can only use this effect of "Shadow-Heart Cathedral" once per turn.',
    image: "assets/Shadow-Heart Cathedral.png",
    effects: [
      {
        id: "shadow_heart_cathedral_add_counter",
        timing: "on_event",
        event: "opponent_damage",
        actions: [
          {
            type: "add_counter",
            counterType: "judgment_marker",
            damagePerCounter: 500,
            targetRef: "self",
          },
        ],
      },
      {
        id: "shadow_heart_cathedral_summon_effect",
        timing: "ignition",
        oncePerTurn: true,
        oncePerTurnName: "shadow_heart_cathedral_summon",
        actions: [
          {
            type: "special_summon_from_deck_with_counter_limit",
            counterType: "judgment_marker",
            counterMultiplier: 500,
            archetype: "Shadow-Heart",
            sendSourceToGraveAfter: true,
          },
        ],
      },
    ],
  },
  {
    id: 120,
    name: "The Shadow Heart",
    cardKind: "spell",
    subtype: "equip",
    archetype: "Shadow-Heart",
    description:
      'You must control no monsters to activate this effect. Target 1 "Shadow-Heart" monster in your Graveyard; Special Summon it and equip this card to it. If this card leaves the field, destroy the equipped monster.',
    image: "assets/The Shadow Heart.png",
    effects: [
      {
        id: "the_shadow_heart_summon_and_equip",
        timing: "on_play",
        oncePerTurn: true,
        oncePerTurnName: "the_shadow_heart_summon_and_equip",
        requireEmptyField: true,
        targets: [
          {
            id: "shadow_heart_gy_target",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            archetype: "Shadow-Heart",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "special_summon_from_zone",
            targetRef: "shadow_heart_gy_target",
            sourceZone: "graveyard",
            position: "choice",
          },
          {
            type: "equip",
            targetRef: "shadow_heart_gy_target",
            equippedCard: "self",
          },
        ],
      },
      {
        id: "the_shadow_heart_destroy_on_leave",
        timing: "passive",
        description:
          "If this card leaves the field, destroy the equipped monster.",
      },
    ],
  },
  {
    id: 121,
    name: "Shadow-Heart Demon Dragon",
    cardKind: "monster",
    monsterType: "fusion",
    atk: 3000,
    def: 3000,
    level: 10,
    type: "Dragon",
    attribute: "Dark",
    archetype: "Shadow-Heart",
    archetypes: ["Shadow-Heart"],
    description:
      "Shadow-Heart Scale Dragon + 1 level 8+ 'Shadow-Heart' monster. If this card is Fusion Summoned: target 1 card your opponent controls; destroy it. If this card is destroyed by battle or card effect: You can Special Summon 1 'Shadow-Heart Scale Dragon' from your GY.",
    image: "assets/Shadow-Heart Demon Dragon.png",
    fusionMaterials: [
      { name: "Shadow-Heart Scale Dragon", count: 1 },
      { archetype: "Shadow-Heart", minLevel: 8, count: 1 },
    ],
    effects: [
      {
        id: "demon_dragon_fusion_destroy",
        timing: "on_event",
        event: "after_summon",
        summonMethods: ["fusion"],
        requireSelfAsSummoned: true,
        actions: [
          {
            type: "destroy_targeted_cards",
            maxTargets: 1,
          },
        ],
      },
      {
        id: "demon_dragon_revive_scale",
        timing: "on_event",
        event: "card_to_grave",
        condition: {
          type: "destroyed_by_battle_or_effect",
        },
        actions: [
          {
            type: "special_summon_from_zone",
            targetRef: "self",
            sourceZone: "graveyard",
            zone: "graveyard",
            cardName: "Shadow-Heart Scale Dragon",
            archetype: "Shadow-Heart",
            position: "choice",
          },
        ],
      },
    ],
  },
  {
    id: 122,
    name: "Shadow-Heart Warlord",
    cardKind: "monster",
    monsterType: "fusion",
    atk: 2300,
    def: 1900,
    level: 8,
    type: "Warrior",
    attribute: "Dark",
    archetype: "Shadow-Heart",
    archetypes: ["Shadow-Heart"],
    description:
      "2 'Shadow-Heart' monsters. The first time per turn this card would be destroyed by battle, you can send 1 'Shadow-Heart' monster you control to the GY instead. If this card destroys an opponent's monster by battle: You can Special Summon 1 'Shadow-Heart' monster of Level 4 or lower from your GY, but it cannot attack this turn. You can only use this effect of 'Shadow-Heart Warlord' once per turn.",
    image: "assets/Shadow-Heart Warlord.png",
    fusionMaterials: [{ archetype: "Shadow-Heart", count: 2 }],
    effects: [
      {
        id: "shadow_heart_warlord_protect",
        timing: "passive",
        oncePerTurn: true,
        oncePerTurnName: "shadow_heart_warlord_protect",
        oncePerTurnScope: "card",
        replacementEffect: {
          type: "destruction",
          reason: "battle",
          costFilters: {
            cardKind: "monster",
            archetype: "Shadow-Heart",
          },
          costZone: "field",
          costCount: 1,
          prompt:
            "Send 1 'Shadow-Heart' monster you control to the GY to save Warlord?",
          selectionMessage:
            "Choose a 'Shadow-Heart' monster to send to the Graveyard for protection.",
        },
      },
      {
        id: "shadow_heart_warlord_revive",
        timing: "on_event",
        event: "battle_destroy",
        requireSelfAsAttacker: true,
        requireDestroyedIsOpponent: true,
        oncePerTurn: true,
        oncePerTurnName: "shadow_heart_warlord_revive",
        oncePerTurnScope: "card",
        targets: [
          {
            id: "warlord_revive_target",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            archetype: "Shadow-Heart",
            maxLevel: 4,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "special_summon_from_zone",
            targetRef: "warlord_revive_target",
            zone: "graveyard",
            position: "choice",
            cannotAttackThisTurn: true,
          },
        ],
      },
    ],
  },
  {
    id: 123,
    name: "Shadow-Heart Armored Arctroth",
    cardKind: "monster",
    archetype: "Shadow-Heart",
    attribute: "Dark",
    level: 9,
    atk: 2800,
    def: 2500,
    monsterType: "ascension",
    ascension: {
      materialId: 104,
      requirements: [
        { type: "material_destroyed_opponent_monsters", count: 2 },
      ],
      position: "choice",
    },
    description:
      "Ascension Summon: Send 1 'Shadow-Heart Demon Arctroth' you control to the Graveyard. Requirement: That monster must have destroyed 2 opponent's monsters by battle or card effect. If this card is Ascension Summoned: Target 1 monster your opponent controls; its ATK/DEF become 0. If this card attacks a Defense Position monster: change that monster to Attack Position.",
    image: "assets/Shadow-Heart Armored Arctroth.png",
    effects: [
      {
        id: "armored_arctroth_on_ascension",
        timing: "on_event",
        event: "after_summon",
        summonMethods: ["ascension"],
        requireSelfAsSummoned: true,
        targets: [
          {
            id: "armored_arctroth_zero_target",
            owner: "opponent",
            zone: "field",
            requireFaceup: true,
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "set_stats_to_zero_and_negate",
            targetRef: "armored_arctroth_zero_target",
            setAtkToZero: true,
            setDefToZero: true,
            negateEffects: false,
          },
        ],
      },
      {
        id: "armored_arctroth_force_defender_attack",
        timing: "on_event",
        event: "attack_declared",
        requireSelfAsAttacker: true,
        requireDefenderPosition: true,
        actions: [
          {
            type: "switch_defender_position_on_attack",
          },
        ],
      },
    ],
  },
  {
    id: 124,
    name: "Shadow-Heart Devastation Dragon",
    cardKind: "monster",
    archetype: "Shadow-Heart",
    attribute: "Dark",
    level: 10,
    atk: 3300,
    def: 3000,
    type: "Dragon",
    monsterType: "ascension",
    ascension: {
      materialId: 111,
      requirements: [{ type: "material_turns_on_field", count: 3 }],
      position: "choice",
    },
    description:
      'Ascension Material: "Shadow-Heart Scale Dragon". Requirement: the material must have been face-up on the field for 3 turns. If this card is Ascension Summoned: it gains 700 ATK until the end of this turn. While this card is face-up on the field, negate your opponent\'s card effects that prevent monsters from being destroyed by battle. If this card destroys a Defense Position monster by battle: destroy all Defense Position monsters your opponent controls.',
    image: "assets/Shadow-Heart Devastation Dragon.png",
    effects: [
      {
        id: "shadow_heart_devastation_dragon_ascension_boost",
        timing: "on_event",
        event: "after_summon",
        summonMethods: ["ascension"],
        requireSelfAsSummoned: true,
        actions: [
          {
            type: "buff_stats_temp",
            atkBoost: 700,
          },
        ],
      },
      {
        id: "shadow_heart_devastation_dragon_battle_protection_aura",
        timing: "passive",
        requireZone: "field",
        requireFaceup: true,
        passive: {
          type: "negate_opponent_battle_destruction_prevention",
          targetOwners: ["opponent"],
          preventedEffectOwners: ["opponent"],
          targetFilters: { cardKind: "monster" },
        },
      },
      {
        id: "shadow_heart_devastation_dragon_defense_sweep",
        timing: "on_event",
        event: "battle_destroy",
        requireZone: "field",
        requireFaceup: true,
        requireSelfAsAttacker: true,
        requireDestroyedIsOpponent: true,
        requireDestroyedPosition: "defense",
        actions: [
          {
            type: "destroy_cards_by_scope",
            optional: true,
            targetScope: {
              owner: "opponent",
              zones: ["field"],
              filters: {
                cardKind: "monster",
                position: "defense",
              },
            },
          },
        ],
      },
    ],
  },
  {
    id: 125,
    name: "Shadow-Heart Heartbearer",
    cardKind: "monster",
    atk: 1500,
    def: 1500,
    level: 4,
    type: "Fiend",
    attribute: "Dark",
    archetype: "Shadow-Heart",
    tributeValue: {
      countAs: 2,
      requireFaceup: true,
      summonMethods: ["tribute"],
      summonedCardFilters: { archetype: "Shadow-Heart" },
    },
    description:
      'This card can be treated as 2 Tributes for the Tribute Summon of a "Shadow-Heart" monster. If another "Shadow-Heart" monster you control is destroyed by battle or card effect: You can send this card to the GY; Special Summon that monster from your GY. You can only use this effect of "Shadow-Heart Heartbearer" once per turn.',
    image: "assets/Shadow-Heart Heartbearer.png",
    effects: [
      {
        id: "shadow_heart_heartbearer_revive",
        timing: "on_event",
        event: "card_to_grave",
        requireZone: "field",
        requireFaceup: true,
        fromZone: "field",
        condition: { type: "destroyed_by_battle_or_effect" },
        promptUser: true,
        eventCardFilters: {
          owner: "self",
          cardKind: "monster",
          archetype: "Shadow-Heart",
        },
        oncePerTurn: true,
        oncePerTurnName: "shadow_heart_heartbearer_revive",
        targets: [
          {
            id: "shadow_heart_heartbearer_destroyed_monster",
            targetFromContext: "eventCard",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            archetype: "Shadow-Heart",
            excludeContextCard: "source",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "self",
            player: "self",
            to: "graveyard",
            contextLabel: "shadow_heart_heartbearer_revive_cost",
          },
          {
            type: "special_summon_from_zone",
            targetRef: "shadow_heart_heartbearer_destroyed_monster",
            zone: "graveyard",
            position: "choice",
          },
        ],
      },
    ],
  },
];
