export const bloomrotCards = [
  {
    id: 401,
    name: "Bloomrot Sporeling",
    cardKind: "monster",
    atk: 700,
    def: 1200,
    level: 2,
    type: "Plant",
    attribute: "Earth",
    archetype: "Bloomrot",
    description:
      'If this card is Normal Summoned: You can Special Summon 1 "Bloomrot Rootling" from your hand or Deck in Defense Position, and if you do, place 1 Spore Counter on 1 face-up card your opponent controls. If this card leaves the field: You can add 1 "Bloomrot" Spell from your Deck to your hand. You can only use each effect of "Bloomrot Sporeling" once per turn.',
    image: "assets/Bloomrot Sporeling.png",
    effects: [
      {
        id: "bloomrot_sporeling_normal_summon_rootling",
        timing: "on_event",
        event: "after_summon",
        summonMethods: ["normal"],
        requireSelfAsSummoned: true,
        promptUser: true,
        promptMessage:
          'Activate "Bloomrot Sporeling" to Special Summon 1 "Bloomrot Rootling"?',
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_sporeling_normal_summon_rootling",
        actions: [
          {
            type: "special_summon_from_zone",
            zone: ["hand", "deck"],
            cardName: "Bloomrot Rootling",
            filters: {
              cardKind: "monster",
            },
            count: { min: 1, max: 1 },
            position: "defense",
            promptPlayer: true,
            haltOnFailure: true,
          },
          {
            type: "optional_target_actions",
            optional: true,
            allowCancel: false,
            selectionMessage:
              'Select 1 face-up opponent card for "Bloomrot Sporeling".',
            targets: [
              {
                id: "bloomrot_sporeling_spore_target",
                owner: "opponent",
                zones: ["field", "spellTrap", "fieldSpell"],
                requireFaceup: true,
                count: { min: 1, max: 1 },
              },
            ],
            actions: [
              {
                type: "add_counter",
                targetRef: "bloomrot_sporeling_spore_target",
                counterType: "spore",
                amount: 1,
              },
            ],
          },
        ],
      },
      {
        id: "bloomrot_sporeling_leave_field_search_spell",
        timing: "on_event",
        event: "card_moved",
        fromZone: "field",
        toZone: "any",
        requireSelfAsMoved: true,
        promptUser: true,
        promptMessage:
          'Activate "Bloomrot Sporeling" to add 1 "Bloomrot" Spell from your Deck to your hand?',
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_sporeling_leave_field_search_spell",
        actions: [
          {
            type: "add_from_zone_to_hand",
            zone: "deck",
            filters: {
              cardKind: "spell",
              archetype: "Bloomrot",
            },
            count: { min: 1, max: 1 },
            promptPlayer: true,
          },
        ],
      },
    ],
  },
  {
    id: 402,
    name: "Bloomrot Rootling",
    cardKind: "monster",
    atk: 1200,
    def: 1600,
    level: 3,
    type: "Plant",
    attribute: "Earth",
    archetype: "Bloomrot",
    description:
      'If you control a "Bloomrot Token", you can Special Summon this card from your hand. Once per turn: You can target 1 face-up card your opponent controls; place 1 Spore Counter on it. If this card is destroyed by battle or card effect: You can place 1 Spore Counter on 1 face-up card your opponent controls. You can only use each effect of "Bloomrot Rootling" once per turn.',
    image: "assets/Bloomrot Rootling.png",
    effects: [
      {
        id: "bloomrot_rootling_special_summon_hand",
        timing: "ignition",
        requireZone: "hand",
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_rootling_special_summon_hand",
        conditions: [
          {
            type: "control_card_filters",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            cardName: "Bloomrot Token",
            min: 1,
            reason: 'You must control a "Bloomrot Token".',
          },
        ],
        actions: [
          {
            type: "conditional_summon_from_hand",
            targetRef: "self",
            position: "choice",
            optional: true,
            condition: {
              type: "control_card",
              zone: "field",
              cardName: "Bloomrot Token",
            },
          },
        ],
      },
      {
        id: "bloomrot_rootling_ignition_spore_counter",
        timing: "ignition",
        requireZone: "field",
        requireFaceup: true,
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_rootling_ignition_spore_counter",
        targets: [
          {
            id: "bloomrot_rootling_spore_target",
            owner: "opponent",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "add_counter",
            targetRef: "bloomrot_rootling_spore_target",
            counterType: "spore",
            amount: 1,
          },
        ],
      },
      {
        id: "bloomrot_rootling_destroyed_spore_counter",
        timing: "on_event",
        event: "card_to_grave",
        fromZone: "field",
        requireSelfAsDestroyed: true,
        condition: { type: "destroyed_by_battle_or_effect" },
        promptUser: true,
        promptMessage:
          'Activate "Bloomrot Rootling" to place 1 Spore Counter on a face-up card your opponent controls?',
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_rootling_destroyed_spore_counter",
        targets: [
          {
            id: "bloomrot_rootling_destroyed_spore_target",
            owner: "opponent",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "add_counter",
            targetRef: "bloomrot_rootling_destroyed_spore_target",
            counterType: "spore",
            amount: 1,
          },
        ],
      },
    ],
  },
  {
    id: 403,
    name: "Bloomrot Myco-Weaver",
    cardKind: "monster",
    atk: 1400,
    def: 1500,
    level: 3,
    type: "Plant",
    attribute: "Earth",
    archetype: "Bloomrot",
    description:
      'If this card is Normal or Special Summoned: Special Summon 1 "Bloomrot Token" (Plant/EARTH/Level 1/ATK 0/DEF 0) in Defense Position. Once per turn: You can send 1 "Bloomrot" monster you control to the Graveyard; target 1 face-up card your opponent controls; place 2 Spore Counters on it.',
    image: "assets/Bloomrot Myco-Weaver.png",
    effects: [
      {
        id: "bloomrot_myco_weaver_summon_token",
        timing: "on_event",
        event: "after_summon",
        summonMethods: ["normal", "special"],
        requireSelfAsSummoned: true,
        actions: [
          {
            type: "special_summon_token",
            player: "self",
            position: "defense",
            token: {
              name: "Bloomrot Token",
              atk: 0,
              def: 0,
              level: 1,
              type: "Plant",
              attribute: "Earth",
              archetype: "Bloomrot",
              image: "assets/Bloomrot Token.png",
              description: "A Bloomrot token grown from lingering spores.",
            },
          },
        ],
      },
      {
        id: "bloomrot_myco_weaver_send_bloomrot_spore_counters",
        timing: "ignition",
        requireZone: "field",
        requireFaceup: true,
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnScope: "card",
        targets: [
          {
            id: "bloomrot_myco_weaver_cost",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Bloomrot",
            count: { min: 1, max: 1 },
          },
          {
            id: "bloomrot_myco_weaver_spore_target",
            owner: "opponent",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "bloomrot_myco_weaver_cost",
            player: "self",
            to: "graveyard",
            fromZone: "field",
            contextLabel: "bloomrot_myco_weaver_cost",
          },
          {
            type: "add_counter",
            targetRef: "bloomrot_myco_weaver_spore_target",
            counterType: "spore",
            amount: 2,
          },
        ],
      },
    ],
  },
  {
    id: 404,
    name: "Bloomrot Rot-Stag",
    cardKind: "monster",
    atk: 2000,
    def: 1900,
    level: 5,
    type: "Plant",
    attribute: "Earth",
    archetype: "Bloomrot",
    description:
      "You can Special Summon this card from your hand by removing 2 Spore Counters from the field. If this card is Special Summoned: target 1 face-up card your opponent controls; place 1 Spore Counter on it. If this card battles a monster with a Spore Counter, this card gains 500 ATK during damage calculation. You can only use each effect of \"Bloomrot Rot-Stag\" once per turn.",
    image: "assets/Bloomrot Rot-Stag.png",
    effects: [
      {
        id: "bloomrot_rot_stag_special_summon_hand",
        timing: "ignition",
        requireZone: "hand",
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_rot_stag_special_summon_hand",
        conditions: [
          {
            type: "playerFieldCount",
            max: 4,
            reason: "You need an open Monster Zone.",
          },
          {
            type: "field_counters_at_least",
            owner: "any",
            zones: ["field", "spellTrap", "fieldSpell"],
            counterType: "spore",
            min: 2,
            requireFaceup: true,
            reason: "There must be at least 2 Spore Counters on the field.",
          },
        ],
        actions: [
          {
            type: "remove_counters_from_field",
            counterType: "spore",
            amount: 2,
            owner: "any",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            selectionMessage:
              "Select card(s) to remove 2 Spore Counters from the field.",
            haltOnFailure: true,
          },
          {
            type: "conditional_summon_from_hand",
            targetRef: "self",
            position: "choice",
            optional: false,
          },
        ],
      },
      {
        id: "bloomrot_rot_stag_special_summon_spore_counter",
        timing: "on_event",
        event: "after_summon",
        summonMethods: ["special"],
        requireSelfAsSummoned: true,
        oncePerTurn: true,
        oncePerTurnName:
          "bloomrot_rot_stag_special_summon_spore_counter",
        targets: [
          {
            id: "bloomrot_rot_stag_spore_target",
            owner: "opponent",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "add_counter",
            targetRef: "bloomrot_rot_stag_spore_target",
            counterType: "spore",
            amount: 1,
          },
        ],
      },
      {
        id: "bloomrot_rot_stag_attack_spore_boost",
        timing: "on_event",
        event: "battle_damage",
        requireZone: "field",
        requireFaceup: true,
        requireSelfAsAttacker: true,
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_rot_stag_battle_spore_boost",
        targets: [
          {
            id: "bloomrot_rot_stag_battle_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            battleParticipant: true,
            counterType: "spore",
            minCounters: 1,
            autoSelect: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "buff_stats_temp",
            targetRef: "self",
            atkBoost: 500,
            duration: "damage_calculation",
          },
        ],
      },
      {
        id: "bloomrot_rot_stag_defense_spore_boost",
        timing: "on_event",
        event: "battle_damage",
        requireZone: "field",
        requireFaceup: true,
        requireSelfAsDefender: true,
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_rot_stag_battle_spore_boost",
        targets: [
          {
            id: "bloomrot_rot_stag_battle_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            battleParticipant: true,
            counterType: "spore",
            minCounters: 1,
            autoSelect: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "buff_stats_temp",
            targetRef: "self",
            atkBoost: 500,
            duration: "damage_calculation",
          },
        ],
      },
    ],
  },
  {
    id: 405,
    name: "Bloomrot Carrioncap",
    cardKind: "monster",
    atk: 1600,
    def: 900,
    level: 4,
    type: "Plant",
    attribute: "Earth",
    archetype: "Bloomrot",
    description:
      'Once per turn: You can target 1 face-up monster your opponent controls; place 1 Spore Counter on it, then that monster loses 300 ATK/DEF for each Spore Counter on it until the end of this turn. If this card destroys a monster with a Spore Counter by battle: place 1 Spore Counter on 1 face-up card your opponent controls. You can only use each effect of "Bloomrot Carrioncap" once per turn.',
    image: "assets/Bloomrot Carrioncap.png",
    effects: [
      {
        id: "bloomrot_carrioncap_ignition_spore_debuff",
        timing: "ignition",
        requireZone: "field",
        requireFaceup: true,
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName:
          "bloomrot_carrioncap_ignition_spore_debuff",
        targets: [
          {
            id: "bloomrot_carrioncap_spore_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "add_counter",
            targetRef: "bloomrot_carrioncap_spore_target",
            counterType: "spore",
            amount: 1,
          },
          {
            type: "buff_stats_by_counter",
            targetRef: "bloomrot_carrioncap_spore_target",
            counterType: "spore",
            atkPerCounter: -300,
            defPerCounter: -300,
            duration: "end_of_turn",
          },
        ],
      },
      {
        id: "bloomrot_carrioncap_battle_destroy_spore_counter",
        timing: "on_event",
        event: "battle_destroy",
        requireZone: "field",
        requireFaceup: true,
        requireSelfAsAttacker: true,
        requireDestroyedIsOpponent: true,
        destroyedCardFilters: {
          cardKind: "monster",
          counterType: "spore",
          minCounters: 1,
        },
        oncePerTurn: true,
        oncePerTurnName:
          "bloomrot_carrioncap_battle_destroy_spore_counter",
        targets: [
          {
            id: "bloomrot_carrioncap_battle_spore_target",
            owner: "opponent",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "add_counter",
            targetRef: "bloomrot_carrioncap_battle_spore_target",
            counterType: "spore",
            amount: 1,
          },
        ],
      },
    ],
  },
  {
    id: 406,
    name: "Bloomrot Moldmender",
    cardKind: "monster",
    atk: 500,
    def: 1800,
    level: 2,
    type: "Plant",
    attribute: "Earth",
    archetype: "Bloomrot",
    description:
      'Before damage calculation, if this card is being attacked by an opponent\'s monster: place 2 Spore Counters on the attacking monster. If this card is destroyed by battle: Special Summon 1 "Bloomrot Token" (Plant/EARTH/Level 1/ATK 0/DEF 0) in Defense Position. You can only use each effect of "Bloomrot Moldmender" once per turn.',
    image: "assets/Bloomrot Moldmender.png",
    effects: [
      {
        id: "bloomrot_mold_mender_attack_spores",
        timing: "on_event",
        event: "battle_damage",
        allowDamageStepActivation: true,
        requireZone: "field",
        requireFaceup: true,
        requireOpponentAttack: true,
        requireSelfAsDefender: true,
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_mold_mender_attack_spores",
        targets: [
          {
            id: "bloomrot_mold_mender_attacker",
            targetFromContext: "attacker",
            owner: "opponent",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "add_counter",
            targetRef: "bloomrot_mold_mender_attacker",
            counterType: "spore",
            amount: 2,
          },
        ],
      },
      {
        id: "bloomrot_mold_mender_battle_destroy_token",
        timing: "on_event",
        event: "card_to_grave",
        fromZone: "field",
        requireSelfAsDestroyed: true,
        condition: { type: "destroyed_by_battle" },
        oncePerTurn: true,
        oncePerTurnName:
          "bloomrot_mold_mender_battle_destroy_token",
        actions: [
          {
            type: "special_summon_token",
            player: "self",
            position: "defense",
            token: {
              name: "Bloomrot Token",
              atk: 0,
              def: 0,
              level: 1,
              type: "Plant",
              attribute: "Earth",
              archetype: "Bloomrot",
              image: "assets/Bloomrot Token.png",
              description: "A Bloomrot token grown from lingering spores.",
            },
          },
        ],
      },
    ],
  },
  {
    id: 407,
    name: "Bloomrot Gravecap Widow",
    cardKind: "monster",
    atk: 2100,
    def: 2100,
    level: 6,
    type: "Plant",
    attribute: "Earth",
    archetype: "Bloomrot",
    description:
      'You can Special Summon this card from your hand by removing 2 Spore Counters from the field. If this card is Summoned: target 1 monster with a Spore Counter your opponent controls; destroy it. Once per turn, if a monster with a Spore Counter your opponent controls is destroyed: place 1 Spore Counter on 1 face-up card on the field. You can only use each effect of "Bloomrot Gravecap Widow" once per turn.',
    image: "assets/Bloomrot Gravecap Widow.png",
    effects: [
      {
        id: "bloomrot_gravecap_widow_special_summon_hand",
        timing: "ignition",
        requireZone: "hand",
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName:
          "bloomrot_gravecap_widow_special_summon_hand",
        conditions: [
          {
            type: "playerFieldCount",
            max: 4,
            reason: "You need an open Monster Zone.",
          },
          {
            type: "field_counters_at_least",
            owner: "any",
            zones: ["field", "spellTrap", "fieldSpell"],
            counterType: "spore",
            min: 2,
            requireFaceup: true,
            reason: "There must be at least 2 Spore Counters on the field.",
          },
        ],
        actions: [
          {
            type: "remove_counters_from_field",
            counterType: "spore",
            amount: 2,
            owner: "any",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            selectionMessage:
              "Select card(s) to remove 2 Spore Counters from the field.",
            haltOnFailure: true,
          },
          {
            type: "conditional_summon_from_hand",
            targetRef: "self",
            position: "choice",
            optional: false,
          },
        ],
      },
      {
        id: "bloomrot_gravecap_widow_summon_destroy_infected",
        timing: "on_event",
        event: "after_summon",
        requireSelfAsSummoned: true,
        oncePerTurn: true,
        oncePerTurnName:
          "bloomrot_gravecap_widow_summon_destroy_infected",
        targets: [
          {
            id: "bloomrot_gravecap_widow_destroy_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            counterType: "spore",
            minCounters: 1,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "destroy",
            targetRef: "bloomrot_gravecap_widow_destroy_target",
          },
        ],
      },
      {
        id: "bloomrot_gravecap_widow_destroyed_infected_spore",
        timing: "on_event",
        event: "card_to_grave",
        requireZone: "field",
        requireFaceup: true,
        fromZone: "field",
        condition: { type: "destroyed_by_battle_or_effect" },
        eventCardFilters: {
          owner: "opponent",
          cardKind: "monster",
          counterType: "spore",
          minCounters: 1,
        },
        oncePerTurn: true,
        oncePerTurnName:
          "bloomrot_gravecap_widow_destroyed_infected_spore",
        targets: [
          {
            id: "bloomrot_gravecap_widow_spore_target",
            owner: "any",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "add_counter",
            targetRef: "bloomrot_gravecap_widow_spore_target",
            counterType: "spore",
            amount: 1,
          },
        ],
      },
    ],
  },
  {
    id: 408,
    name: "Bloomrot Ancient Husk",
    cardKind: "monster",
    atk: 2200,
    def: 2600,
    level: 7,
    type: "Plant",
    attribute: "Earth",
    archetype: "Bloomrot",
    description:
      'You can Special Summon this card from your hand by removing 4 Spore Counters from the field. Once per turn: place 1 Spore Counter on up to 2 face-up monsters your opponent controls. If a monster with a Spore Counter is destroyed: place 1 Spore Counter on up to 2 face-up monsters your opponent controls. You can only use each effect of "Bloomrot Ancient Husk" once per turn.',
    image: "assets/Bloomrot Ancient Husk.png",
    effects: [
      {
        id: "bloomrot_ancient_husk_special_summon_hand",
        timing: "ignition",
        requireZone: "hand",
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_ancient_husk_special_summon_hand",
        conditions: [
          {
            type: "playerFieldCount",
            max: 4,
            reason: "You need an open Monster Zone.",
          },
          {
            type: "field_counters_at_least",
            owner: "any",
            zones: ["field", "spellTrap", "fieldSpell"],
            counterType: "spore",
            min: 4,
            requireFaceup: true,
            reason: "There must be at least 4 Spore Counters on the field.",
          },
        ],
        actions: [
          {
            type: "remove_counters_from_field",
            counterType: "spore",
            amount: 4,
            owner: "any",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            selectionMessage:
              "Select card(s) to remove 4 Spore Counters from the field.",
            haltOnFailure: true,
          },
          {
            type: "conditional_summon_from_hand",
            targetRef: "self",
            position: "choice",
            optional: false,
          },
        ],
      },
      {
        id: "bloomrot_ancient_husk_ignition_spore_counters",
        timing: "ignition",
        requireZone: "field",
        requireFaceup: true,
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName:
          "bloomrot_ancient_husk_ignition_spore_counters",
        targets: [
          {
            id: "bloomrot_ancient_husk_spore_targets",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 2 },
          },
        ],
        actions: [
          {
            type: "add_counter",
            targetRef: "bloomrot_ancient_husk_spore_targets",
            counterType: "spore",
            amount: 1,
          },
        ],
      },
      {
        id: "bloomrot_ancient_husk_destroyed_infected_spore",
        timing: "on_event",
        event: "card_to_grave",
        requireZone: "field",
        requireFaceup: true,
        fromZone: "field",
        condition: { type: "destroyed_by_battle_or_effect" },
        eventCardFilters: {
          cardKind: "monster",
          counterType: "spore",
          minCounters: 1,
        },
        oncePerTurn: true,
        oncePerTurnName:
          "bloomrot_ancient_husk_destroyed_infected_spore",
        targets: [
          {
            id: "bloomrot_ancient_husk_destroy_spore_targets",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 2 },
          },
        ],
        actions: [
          {
            type: "add_counter",
            targetRef: "bloomrot_ancient_husk_destroy_spore_targets",
            counterType: "spore",
            amount: 1,
          },
        ],
      },
    ],
  },
  {
    id: 409,
    name: "Bloomrot Spore Cloud",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Bloomrot",
    description:
      'Target up to 2 face-up monsters your opponent controls; place 2 Spore Counters on each of them. Then, those monsters lose 500 ATK/DEF until the end of this turn. You can only activate 1 "Bloomrot Spore Cloud" per turn.',
    image: "assets/Bloomrot Spore Cloud.png",
    effects: [
      {
        id: "bloomrot_spore_cloud_activation",
        timing: "on_play",
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_spore_cloud_activation",
        targets: [
          {
            id: "bloomrot_spore_cloud_targets",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 2 },
          },
        ],
        actions: [
          {
            type: "add_counter",
            targetRef: "bloomrot_spore_cloud_targets",
            counterType: "spore",
            amount: 2,
          },
          {
            type: "buff_stats_temp",
            targetRef: "bloomrot_spore_cloud_targets",
            atkBoost: -500,
            defBoost: -500,
            duration: "end_of_turn",
          },
        ],
      },
    ],
  },
  {
    id: 410,
    name: "Bloomrot Living Colony",
    cardKind: "spell",
    subtype: "field",
    archetype: "Bloomrot",
    description:
      'When this card is activated: add 1 Level 4 or lower "Bloomrot" monster from your Deck to your hand. Once per turn: target 1 face-up monster on the field; place 1 Spore Counter on it. Monsters your opponent controls lose 100 ATK/DEF for each Spore Counter on them. Each time one or more Spore Counters are removed from the field: Special Summon 1 "Bloomrot Token" (Plant/EARTH/Level 1/ATK 0/DEF 0) in Defense Position. You can only activate 1 "Bloomrot Living Colony" per turn.',
    image: "assets/Bloomrot Living Colony.png",
    effects: [
      {
        id: "bloomrot_living_colony_activation_search",
        timing: "on_play",
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_living_colony_activation",
        actions: [
          {
            type: "add_from_zone_to_hand",
            zone: "deck",
            filters: { cardKind: "monster", archetype: "Bloomrot" },
            maxLevel: 4,
            count: { min: 1, max: 1 },
            promptPlayer: true,
          },
        ],
      },
      {
        id: "bloomrot_living_colony_ignition_spore_counter",
        timing: "ignition",
        requireZone: "fieldSpell",
        requireFaceup: true,
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName:
          "bloomrot_living_colony_ignition_spore_counter",
        targets: [
          {
            id: "bloomrot_living_colony_spore_target",
            owner: "any",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "add_counter",
            targetRef: "bloomrot_living_colony_spore_target",
            counterType: "spore",
            amount: 1,
          },
        ],
      },
      {
        id: "bloomrot_living_colony_spore_debuff",
        timing: "passive",
        requireZone: "fieldSpell",
        requireFaceup: true,
        passive: {
          type: "field_counter_stat_aura",
          counterType: "spore",
          amountPerCounter: -100,
          stats: ["atk", "def"],
          targetOwners: ["opponent"],
          targetCardKinds: ["monster"],
          targetRequireFaceup: true,
        },
      },
      {
        id: "bloomrot_living_colony_counter_removed_token",
        timing: "on_event",
        event: "counter_removed",
        requireZone: "fieldSpell",
        requireFaceup: true,
        counterType: "spore",
        minAmount: 1,
        requireRemovedFromField: true,
        actions: [
          {
            type: "special_summon_token",
            player: "self",
            position: "defense",
            token: {
              name: "Bloomrot Token",
              atk: 0,
              def: 0,
              level: 1,
              type: "Plant",
              attribute: "Earth",
              archetype: "Bloomrot",
              image: "assets/Bloomrot Token.png",
              description: "A Bloomrot token grown from lingering spores.",
            },
          },
        ],
      },
    ],
  },
  {
    id: 411,
    name: "Bloomrot Compost Ritual",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Bloomrot",
    description:
      'Target 1 face-up card your opponent controls; place 1 Spore Counter on it, then place 1 additional Spore Counter on it for each "Bloomrot" monster you control. Then, gain 300 LP for each Spore Counter placed by this effect. You can only activate 1 "Bloomrot Compost Ritual" per turn.',
    image: "assets/Bloomrot Compost Ritual.png",
    effects: [
      {
        id: "bloomrot_compost_ritual_activation",
        timing: "on_play",
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_compost_ritual_activation",
        targets: [
          {
            id: "bloomrot_compost_ritual_target",
            owner: "opponent",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "add_counter",
            targetRef: "bloomrot_compost_ritual_target",
            counterType: "spore",
            contextKey: "bloomrotCompostRitualPlacedCounterCount",
            amountFromFieldCount: {
              baseAmount: 1,
              owner: "self",
              zone: "field",
              filters: {
                cardKind: "monster",
                archetype: "Bloomrot",
                requireFaceup: true,
              },
            },
          },
          {
            type: "heal",
            player: "self",
            amountFromContext: {
              key: "bloomrotCompostRitualPlacedCounterCount",
              multiplier: 300,
            },
          },
        ],
      },
    ],
  },
  {
    id: 412,
    name: "Bloomrot Root Network",
    cardKind: "spell",
    subtype: "continuous",
    archetype: "Bloomrot",
    description:
      'Monsters your opponent controls with 5 or more Spore Counters cannot declare attacks. Once per turn: You can remove 3 Spore Counters from either side of the field; add 1 "Bloomrot" card from your Graveyard to your hand. If this card would be destroyed by an opponent\'s card effect, you can remove 2 Spore Counters from the field instead.',
    image: "assets/Bloomrot Root Network.png",
    effects: [
      {
        id: "bloomrot_root_network_attack_lock",
        timing: "passive",
        requireZone: "spellTrap",
        requireFaceup: true,
        passive: {
          type: "counter_attack_lock",
          counterType: "spore",
          minCounters: 5,
          targetOwners: ["opponent"],
          targetFilters: {
            cardKind: "monster",
            requireFaceup: true,
          },
          reason:
            "Monsters with 5 or more Spore Counters cannot declare attacks.",
        },
      },
      {
        id: "bloomrot_root_network_recover",
        timing: "ignition",
        requireZone: "spellTrap",
        requireFaceup: true,
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_root_network_recover",
        conditions: [
          {
            type: "field_counters_at_least",
            owner: "any",
            zones: ["field", "spellTrap", "fieldSpell"],
            counterType: "spore",
            min: 3,
            requireFaceup: true,
            reason: "There must be at least 3 Spore Counters on the field.",
          },
        ],
        actions: [
          {
            type: "remove_counters_from_field",
            counterType: "spore",
            amount: 3,
            owner: "any",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            selectionMessage:
              "Select card(s) to remove 3 Spore Counters from the field.",
            haltOnFailure: true,
          },
          {
            type: "add_from_zone_to_hand",
            zone: "graveyard",
            filters: { archetype: "Bloomrot" },
            count: { min: 1, max: 1 },
            promptPlayer: true,
          },
        ],
      },
      {
        id: "bloomrot_root_network_effect_protection",
        timing: "passive",
        requireZone: "spellTrap",
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_root_network_effect_protection",
        replacementEffect: {
          type: "destruction",
          reason: "effect",
          sourceOwner: "opponent",
          targetMustBeSource: true,
          targetOwner: "self",
          targetZones: ["spellTrap"],
          targetRequireFaceup: true,
          costActions: [
            {
              type: "remove_counters_from_field",
              counterType: "spore",
              amount: 2,
              owner: "any",
              zones: ["field", "spellTrap", "fieldSpell"],
              requireFaceup: true,
              selectionMessage:
                "Select card(s) to remove 2 Spore Counters from the field.",
              haltOnFailure: true,
            },
          ],
          prompt:
            "Remove 2 Spore Counters from the field instead of destroying {target}?",
          logMessage:
            "{target} avoided destruction by removing 2 Spore Counters from the field.",
        },
      },
    ],
  },
  {
    id: 413,
    name: "Bloomrot Fungal Armor",
    cardKind: "spell",
    subtype: "equip",
    archetype: "Bloomrot",
    description:
      'Equip only to a "Bloomrot" monster you control. The equipped monster gains 500 DEF and 100 ATK for each Spore Counter on the field. Once per turn, if the equipped monster would be destroyed by battle or card effect, you can remove 1 Spore Counter from the field instead. If this card is sent from the field to the Graveyard: place 1 Spore Counter on 1 face-up monster on the field.',
    image: "assets/Bloomrot Fungal Armor.png",
    effects: [
      {
        id: "bloomrot_fungal_armor_equip",
        timing: "on_play",
        targets: [
          {
            id: "bloomrot_fungal_armor_equip_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Bloomrot",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "equip",
            targetRef: "bloomrot_fungal_armor_equip_target",
            defBonus: 500,
          },
        ],
      },
      {
        id: "bloomrot_fungal_armor_field_counter_atk",
        timing: "passive",
        requireZone: "spellTrap",
        requireFaceup: true,
        passive: {
          type: "equipped_field_counter_buff",
          counterType: "spore",
          amountPerCounter: 100,
          stats: ["atk"],
          counterOwners: ["self", "opponent"],
          counterZones: ["field", "spellTrap", "fieldSpell"],
          counterFilters: {
            requireFaceup: true,
          },
          targetFilters: {
            cardKind: "monster",
            archetype: "Bloomrot",
          },
          targetRequireFaceup: true,
        },
      },
      {
        id: "bloomrot_fungal_armor_equipped_protection",
        timing: "passive",
        requireZone: "spellTrap",
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_fungal_armor_equipped_protection",
        replacementEffect: {
          type: "destruction",
          reason: "any",
          targetMustBeEquippedToSource: true,
          targetOwner: "self",
          targetZones: ["field"],
          targetRequireFaceup: true,
          targetFilters: {
            cardKind: "monster",
            archetype: "Bloomrot",
          },
          costActions: [
            {
              type: "remove_counters_from_field",
              counterType: "spore",
              amount: 1,
              owner: "any",
              zones: ["field", "spellTrap", "fieldSpell"],
              requireFaceup: true,
              selectionMessage:
                "Select a card to remove 1 Spore Counter from the field.",
              haltOnFailure: true,
            },
          ],
          prompt:
            "Remove 1 Spore Counter from the field instead of destroying {target}?",
          logMessage:
            "{target} avoided destruction by removing 1 Spore Counter from the field.",
        },
      },
      {
        id: "bloomrot_fungal_armor_grave_spore_counter",
        timing: "on_event",
        event: "card_to_grave",
        fromZone: "spellTrap",
        targets: [
          {
            id: "bloomrot_fungal_armor_spore_target",
            owner: "any",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "add_counter",
            targetRef: "bloomrot_fungal_armor_spore_target",
            counterType: "spore",
            amount: 1,
          },
        ],
      },
    ],
  },
  {
    id: 414,
    name: "Bloomrot Harvest",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Bloomrot",
    description:
      'Remove all Spore Counters from the field, then target 1 card your opponent controls for every 4 Spore Counters removed; destroy them. "Bloomrot" monsters you control gain 100 ATK/DEF until the end of this turn for each Spore Counter removed. You can only activate 1 "Bloomrot Harvest" per turn.',
    image: "assets/Bloomrot Harvest.png",
    effects: [
      {
        id: "bloomrot_harvest_activation",
        timing: "on_play",
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_harvest_activation",
        conditions: [
          {
            type: "field_counters_at_least",
            owner: "any",
            zones: ["field", "spellTrap", "fieldSpell"],
            counterType: "spore",
            min: 1,
            requireFaceup: true,
            reason: "There must be at least 1 Spore Counter on the field.",
          },
        ],
        actions: [
          {
            type: "remove_all_counters_from_field",
            counterType: "spore",
            owner: "any",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            contextKey: "removedSporeCounterCount",
            haltOnFailure: true,
          },
          {
            type: "destroy_targeted_cards",
            zones: ["field", "spellTrap", "fieldSpell"],
            targetCountFromContext: {
              key: "removedSporeCounterCount",
              divideBy: 4,
              round: "floor",
            },
          },
          {
            type: "buff_stats_temp",
            targetScope: {
              owner: "self",
              zones: ["field"],
              filters: {
                cardKind: "monster",
                archetype: "Bloomrot",
                requireFaceup: true,
              },
            },
            atkBoostFromContext: {
              key: "removedSporeCounterCount",
              multiplier: 100,
            },
            defBoostFromContext: {
              key: "removedSporeCounterCount",
              multiplier: 100,
            },
            duration: "end_of_turn",
          },
        ],
      },
    ],
  },
  {
    id: 415,
    name: "Bloomrot Overgrowth",
    cardKind: "spell",
    subtype: "equip",
    archetype: "Bloomrot",
    description:
      "Target 1 face-up monster your opponent controls; place 1 Spore Counter on it, then equip this card to it. During each Standby Phase, place 1 Spore Counter on the equipped monster. If the equipped monster is destroyed: place 1 Spore Counter on each face-up card your opponent controls.",
    image: "assets/Bloomrot Overgrowth.png",
    effects: [
      {
        id: "bloomrot_overgrowth_equip",
        timing: "on_play",
        targets: [
          {
            id: "bloomrot_overgrowth_equip_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "add_counter",
            targetRef: "bloomrot_overgrowth_equip_target",
            counterType: "spore",
            amount: 1,
          },
          {
            type: "equip",
            targetRef: "bloomrot_overgrowth_equip_target",
          },
        ],
      },
      {
        id: "bloomrot_overgrowth_standby_spore_counter",
        timing: "on_event",
        event: "standby_phase",
        requireZone: "spellTrap",
        requireFaceup: true,
        standbyPlayer: "any",
        targets: [
          {
            id: "bloomrot_overgrowth_equipped_monster",
            targetFromContext: "host",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "add_counter",
            targetRef: "bloomrot_overgrowth_equipped_monster",
            counterType: "spore",
            amount: 1,
          },
        ],
      },
      {
        id: "bloomrot_overgrowth_destroyed_host_spread",
        timing: "on_event",
        event: "card_to_grave",
        requireZone: "spellTrap",
        requireFaceup: true,
        condition: { type: "destroyed_by_battle_or_effect" },
        eventCardFilters: {
          cardKind: "monster",
          eventCardIsEquippedToSource: true,
        },
        actions: [
          {
            type: "add_counter",
            targetScope: {
              owner: "opponent",
              zones: ["field", "spellTrap", "fieldSpell"],
              filters: {
                requireFaceup: true,
              },
            },
            counterType: "spore",
            amount: 1,
          },
        ],
      },
    ],
  },
  {
    id: 416,
    name: "Bloomrot Sudden Germination",
    cardKind: "trap",
    subtype: "normal",
    speed: 2,
    archetype: "Bloomrot",
    description:
      'When an opponent\'s monster declares an attack: place 1 Spore Counter on that monster, negate the attack, and Special Summon 1 "Bloomrot Token" (Plant/EARTH/Level 1/ATK 0/DEF 0) in Defense Position. If you control "Bloomrot Living Colony", you can place 1 Spore Counter on 1 other face-up monster your opponent controls. You can only activate 1 "Bloomrot Sudden Germination" per turn.',
    image: "assets/Bloomrot Sudden Germination.png",
    effects: [
      {
        id: "bloomrot_sudden_germination_attack",
        timing: "on_event",
        event: "attack_declared",
        speed: 2,
        requireOpponentAttack: true,
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_sudden_germination_activation",
        conditions: [
          {
            type: "playerFieldCount",
            max: 4,
            reason: "You need an open Monster Zone.",
          },
        ],
        targets: [
          {
            id: "bloomrot_sudden_germination_attacker",
            targetFromContext: "attacker",
            owner: "opponent",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "add_counter",
            targetRef: "bloomrot_sudden_germination_attacker",
            counterType: "spore",
            amount: 1,
          },
          {
            type: "negate_attack",
          },
          {
            type: "special_summon_token",
            player: "self",
            position: "defense",
            token: {
              name: "Bloomrot Token",
              atk: 0,
              def: 0,
              level: 1,
              type: "Plant",
              attribute: "Earth",
              archetype: "Bloomrot",
              image: "assets/Bloomrot Token.png",
              description: "A Bloomrot token grown from lingering spores.",
            },
          },
          {
            type: "optional_target_actions",
            selectionMessage:
              'Select 1 other face-up opponent monster for "Bloomrot Sudden Germination".',
            conditions: [
              {
                type: "control_card_filters",
                owner: "self",
                zones: ["fieldSpell"],
                filters: {
                  cardKind: "spell",
                  subtype: "field",
                  name: "Bloomrot Living Colony",
                },
                min: 1,
                requireFaceup: true,
              },
            ],
            targets: [
              {
                id: "bloomrot_sudden_germination_bonus_target",
                owner: "opponent",
                zone: "field",
                cardKind: "monster",
                requireFaceup: true,
                excludeContextCard: "attacker",
                count: { min: 1, max: 1 },
              },
            ],
            actions: [
              {
                type: "add_counter",
                targetRef: "bloomrot_sudden_germination_bonus_target",
                counterType: "spore",
                amount: 1,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 417,
    name: "Bloomrot Rotting Ground",
    cardKind: "trap",
    subtype: "continuous",
    speed: 2,
    archetype: "Bloomrot",
    description:
      'Once per turn, when your opponent Summons a monster: place 1 Spore Counter on that monster. Monsters your opponent controls with a Spore Counter are unaffected by other card effects, except "Bloomrot" cards. Once per turn: target 1 monster your opponent controls with 4 or more Spore Counters; negate its effects until the end of this turn.',
    image: "assets/Bloomrot Rotting Ground.png",
    effects: [
      {
        id: "bloomrot_rotting_ground_summon_spore_counter",
        timing: "on_event",
        event: "after_summon",
        requireZone: "spellTrap",
        requireFaceup: true,
        requireOpponentSummon: true,
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_rotting_ground_summon_spore_counter",
        targets: [
          {
            id: "bloomrot_rotting_ground_summoned_monster",
            targetFromContext: "summonedCard",
            owner: "opponent",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "add_counter",
            targetRef: "bloomrot_rotting_ground_summoned_monster",
            counterType: "spore",
            amount: 1,
          },
        ],
      },
      {
        id: "bloomrot_rotting_ground_conditional_immunity",
        timing: "passive",
        requireZone: "spellTrap",
        requireFaceup: true,
        passive: {
          type: "conditional_unaffected_by_effects",
          targetOwners: ["opponent"],
          targetZones: ["field"],
          targetFilters: {
            cardKind: "monster",
            requireFaceup: true,
            counterType: "spore",
            minCounters: 1,
          },
          exceptSourceArchetypes: ["Bloomrot"],
          reason:
            "This monster is unaffected by non-Bloomrot card effects while it has a Spore Counter.",
        },
      },
      {
        id: "bloomrot_rotting_ground_negate_infected",
        timing: "ignition",
        requireZone: "spellTrap",
        requireFaceup: true,
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_rotting_ground_negate_infected",
        targets: [
          {
            id: "bloomrot_rotting_ground_negate_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            counterType: "spore",
            minCounters: 4,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "add_status",
            targetRef: "bloomrot_rotting_ground_negate_target",
            status: "effectsNegated",
            value: true,
            untilEndOfTurn: true,
          },
        ],
      },
    ],
  },
  {
    id: 418,
    name: "Bloomrot Ancient Mycelium",
    cardKind: "monster",
    monsterType: "ascension",
    atk: 2100,
    def: 2600,
    level: 6,
    type: "Plant",
    attribute: "Earth",
    archetype: "Bloomrot",
    ascension: {
      materialFilters: {
        cardKind: "monster",
        archetype: "Bloomrot",
      },
      requirements: [{ type: "material_effect_activations", count: 2 }],
      position: "choice",
    },
    description:
      'Ascension Material: 1 "Bloomrot" monster. Requirement: The material must have activated its effect 2 times this Duel. If this card is Ascension Summoned: place 1 Spore Counter on all face-up monsters your opponent controls. Once per turn: You can remove 2 Spore Counters from the field; target 1 Defense Position monster your opponent controls; destroy that target.',
    image: "assets/Bloomrot Ancient Mycelium.png",
    effects: [
      {
        id: "bloomrot_ancient_mycelium_ascension_spores",
        timing: "on_event",
        event: "after_summon",
        summonMethods: ["ascension"],
        requireSelfAsSummoned: true,
        actions: [
          {
            type: "add_counter",
            targetScope: {
              owner: "opponent",
              zones: ["field"],
              filters: {
                cardKind: "monster",
                requireFaceup: true,
              },
            },
            counterType: "spore",
            amount: 1,
          },
        ],
      },
      {
        id: "bloomrot_ancient_mycelium_destroy_defense",
        timing: "ignition",
        requireZone: "field",
        requireFaceup: true,
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_ancient_mycelium_destroy_defense",
        conditions: [
          {
            type: "field_counters_at_least",
            owner: "any",
            zones: ["field", "spellTrap", "fieldSpell"],
            counterType: "spore",
            min: 2,
            requireFaceup: true,
            reason: "There must be at least 2 Spore Counters on the field.",
          },
        ],
        actions: [
          {
            type: "remove_counters_from_field",
            counterType: "spore",
            amount: 2,
            owner: "any",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            selectionMessage:
              'Select card(s) to remove 2 Spore Counters for "Bloomrot Ancient Mycelium".',
            haltOnFailure: true,
          },
          {
            type: "destroy_targeted_cards",
            zones: ["field"],
            cardKind: "monster",
            position: "defense",
            minTargets: 1,
            maxTargets: 1,
          },
        ],
      },
    ],
  },
  {
    id: 419,
    name: "Bloomrot Queen of the Hollow Grove",
    cardKind: "monster",
    monsterType: "ascension",
    atk: 2500,
    def: 3000,
    level: 8,
    type: "Plant",
    attribute: "Earth",
    archetype: "Bloomrot",
    ascension: {
      materialFilters: {
        cardKind: "monster",
        archetype: "Bloomrot",
        minLevel: 5,
      },
      requirements: [
        {
          type: "field_counters_at_least",
          owner: "any",
          zones: ["field", "spellTrap", "fieldSpell"],
          counterType: "spore",
          min: 8,
          requireFaceup: true,
          reason: "There must be at least 8 Spore Counters on the field.",
        },
      ],
      position: "choice",
    },
    description:
      'Ascension Material: 1 Level 5 or higher "Bloomrot" monster. Requirement: There must be at least 8 Spore Counters on the field. If this card is Ascension Summoned: monsters your opponent controls lose 100 ATK/DEF for each Spore Counter on the field. You can remove up to 3 Spore Counters from the field; gain 500 LP for each counter removed. If this card leaves the field: place 1 Spore Counter on each face-up card your opponent controls. You can only use each effect of "Bloomrot Queen of the Hollow Grove" once per turn.',
    image: "assets/Bloomrot Queen of the Hollow Grove.png",
    effects: [
      {
        id: "bloomrot_queen_hollow_grove_ascension_debuff",
        timing: "on_event",
        event: "after_summon",
        summonMethods: ["ascension"],
        requireSelfAsSummoned: true,
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_queen_hollow_grove_ascension_debuff",
        actions: [
          {
            type: "count_field_counters",
            counterType: "spore",
            owner: "any",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            contextKey: "fieldSporeCounterCount",
            log: false,
          },
          {
            type: "buff_stats_temp",
            targetScope: {
              owner: "opponent",
              zones: ["field"],
              filters: {
                cardKind: "monster",
                requireFaceup: true,
              },
            },
            atkBoostFromContext: {
              key: "fieldSporeCounterCount",
              multiplier: -100,
            },
            defBoostFromContext: {
              key: "fieldSporeCounterCount",
              multiplier: -100,
            },
            permanent: true,
          },
        ],
      },
      {
        id: "bloomrot_queen_hollow_grove_remove_and_heal",
        timing: "ignition",
        requireZone: "field",
        requireFaceup: true,
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_queen_hollow_grove_remove_and_heal",
        conditions: [
          {
            type: "field_counters_at_least",
            owner: "any",
            zones: ["field", "spellTrap", "fieldSpell"],
            counterType: "spore",
            min: 1,
            requireFaceup: true,
            reason: "There must be at least 1 Spore Counter on the field.",
          },
        ],
        actions: [
          {
            type: "remove_counters_from_field",
            counterType: "spore",
            minAmount: 1,
            maxAmount: 3,
            defaultAmount: 3,
            owner: "any",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            contextKey: "removedSporeCounterCount",
            amountPrompt:
              'Choose how many Spore Counters to remove for "Bloomrot Queen of the Hollow Grove" (1-3).',
            selectionMessage:
              'Select card(s) to remove Spore Counters for "Bloomrot Queen of the Hollow Grove".',
            haltOnFailure: true,
          },
          {
            type: "heal",
            player: "self",
            amountFromContext: {
              key: "removedSporeCounterCount",
              multiplier: 500,
            },
          },
        ],
      },
      {
        id: "bloomrot_queen_hollow_grove_leave_spores",
        timing: "on_event",
        event: "card_moved",
        requireSelfAsMoved: true,
        requireMovedCardWasFaceup: true,
        fromZone: "field",
        toZone: "any",
        oncePerTurn: true,
        oncePerTurnName: "bloomrot_queen_hollow_grove_leave_spores",
        actions: [
          {
            type: "add_counter",
            targetScope: {
              owner: "opponent",
              zones: ["field", "spellTrap", "fieldSpell"],
              filters: {
                requireFaceup: true,
              },
            },
            counterType: "spore",
            amount: 1,
          },
        ],
      },
    ],
  },
  {
    id: 420,
    name: "Bloomrot Devourer of Dead Roots",
    cardKind: "monster",
    monsterType: "fusion",
    atk: 0,
    def: 3000,
    level: 11,
    type: "Plant",
    attribute: "Dark",
    archetype: "Bloomrot",
    fusionMaterials: [
      {
        archetype: "Bloomrot",
        cardKind: "monster",
        isToken: true,
        allowedZones: ["field"],
        count: 1,
      },
      {
        archetype: "Bloomrot",
        cardKind: "monster",
        count: 3,
      },
    ],
    description:
      'Fusion Materials: 4 "Bloomrot" monsters, including 1 Token. If this card is Fusion Summoned: this card\'s original ATK becomes the number of Spore Counters on the field x500. Once per turn: You can destroy all monsters with Spore Counters your opponent controls. If this card is destroyed by battle or card effect: Special Summon up to 2 "Bloomrot" monsters from your Graveyard, except "Bloomrot Devourer of Dead Roots".',
    image: "assets/Bloomrot Devourer of Dead Roots.png",
    effects: [
      {
        id: "bloomrot_devourer_dead_roots_fusion_atk",
        timing: "on_event",
        event: "after_summon",
        summonMethods: ["fusion"],
        requireSelfAsSummoned: true,
        actions: [
          {
            type: "count_field_counters",
            counterType: "spore",
            owner: "any",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            contextKey: "fieldSporeCounterCount",
            log: false,
          },
          {
            type: "set_original_stats",
            targetRef: "self",
            atkFromContext: {
              key: "fieldSporeCounterCount",
              multiplier: 500,
            },
          },
        ],
      },
      {
        id: "bloomrot_devourer_dead_roots_destroy_spored_monsters",
        timing: "ignition",
        requireZone: "field",
        requireFaceup: true,
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName:
          "bloomrot_devourer_dead_roots_destroy_spored_monsters",
        conditions: [
          {
            type: "field_counters_at_least",
            owner: "opponent",
            zones: ["field"],
            filters: {
              cardKind: "monster",
            },
            counterType: "spore",
            min: 1,
            requireFaceup: true,
            reason:
              "Your opponent must control a face-up monster with a Spore Counter.",
          },
        ],
        actions: [
          {
            type: "destroy_cards_by_scope",
            targetScope: {
              owner: "opponent",
              zones: ["field"],
              filters: {
                cardKind: "monster",
                requireFaceup: true,
                counterType: "spore",
                minCounters: 1,
              },
            },
          },
        ],
      },
      {
        id: "bloomrot_devourer_dead_roots_destroyed_revive",
        timing: "on_event",
        event: "card_to_grave",
        fromZone: "field",
        requireFaceup: true,
        requireSelfAsDestroyed: true,
        condition: { type: "destroyed_by_battle_or_effect" },
        actions: [
          {
            type: "special_summon_from_zone",
            zone: "graveyard",
            filters: {
              cardKind: "monster",
              archetype: "Bloomrot",
              isToken: false,
              excludeCardName: "Bloomrot Devourer of Dead Roots",
            },
            count: { min: 0, max: 2 },
            position: "choice",
          },
        ],
      },
    ],
  },
];
