export const mirageboundCards = [
  {
    id: 351,
    name: "Miragebound Scout",
    cardKind: "monster",
    atk: 1400,
    def: 1000,
    level: 3,
    type: "Spellcaster",
    archetype: "Miragebound",
    description:
      'If this card is Normal Summoned: Add 1 "Miragebound" Spell/Trap from your Deck to your hand. Once per turn: You can target 1 face-up monster your opponent controls; change its battle position. You can only use each effect of "Miragebound Scout" once per turn.',
    image: "assets/Miragebound Scout.png",
    effects: [
      {
        id: "miragebound_scout_search_spell_trap",
        timing: "on_event",
        event: "after_summon",
        requireSelfAsSummoned: true,
        summonMethods: ["normal"],
        oncePerTurn: true,
        oncePerTurnName: "miragebound_scout_search_spell_trap",
        actions: [
          {
            type: "add_from_zone_to_hand",
            zone: "deck",
            filters: {
              cardKind: ["spell", "trap"],
              archetype: "Miragebound",
            },
            count: { min: 1, max: 1 },
          },
        ],
      },
      {
        id: "miragebound_scout_switch_position",
        timing: "ignition",
        requireZone: "field",
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "miragebound_scout_switch_position",
        targets: [
          {
            id: "miragebound_scout_position_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "switch_position",
            targetRef: "miragebound_scout_position_target",
          },
        ],
      },
    ],
  },
  {
    id: 352,
    name: "Miragebound Dancer",
    cardKind: "monster",
    atk: 1600,
    def: 1200,
    level: 4,
    type: "Spellcaster",
    archetype: "Miragebound",
    description:
      'If you control a "Miragebound" monster: You can Special Summon this card from your hand. Once per turn: You can target 1 other "Miragebound" monster you control; return it to the hand, and if you do, this card gains 600 ATK until the end of this turn. You can only use each effect of "Miragebound Dancer" once per turn.',
    image: "assets/Miragebound Dancer.png",
    effects: [
      {
        id: "miragebound_dancer_special_summon",
        timing: "ignition",
        requireZone: "hand",
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "miragebound_dancer_special_summon",
        conditions: [
          {
            type: "control_card_filters",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Miragebound",
            min: 1,
          },
        ],
        actions: [
          {
            type: "special_summon_from_zone",
            zone: "hand",
            requireSource: true,
            position: "choice",
            promptPlayer: true,
            oncePerTurnName: "miragebound_dancer_special_summon",
          },
        ],
      },
      {
        id: "miragebound_dancer_bounce_buff",
        timing: "ignition",
        requireZone: "field",
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "miragebound_dancer_bounce_buff",
        targets: [
          {
            id: "miragebound_dancer_bounce_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Miragebound",
            excludeSelf: true,
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "return_to_hand",
            targetRef: "miragebound_dancer_bounce_target",
            haltOnFailure: true,
          },
          {
            type: "buff_stats_temp",
            targetRef: "self",
            atkBoost: 600,
            defBoost: 0,
          },
        ],
      },
    ],
  },
  {
    id: 353,
    name: "Miragebound Jackal",
    cardKind: "monster",
    atk: 1700,
    def: 800,
    level: 4,
    type: "Beast",
    archetype: "Miragebound",
    description:
      'If this card battles an opponent\'s monster: At the end of the Damage Step, change that opponent\'s monster\'s battle position, if it is still on the field. If this card is sent from the field to the GY: Target 1 monster your opponent controls; change its battle position. You can only use each effect of "Miragebound Jackal" once per turn.',
    image: "assets/Miragebound Jackal.png",
    effects: [
      {
        id: "miragebound_jackal_battle_completed_shift",
        timing: "on_event",
        event: "battle_completed",
        requireSelfBattled: true,
        promptUser: false,
        oncePerTurn: true,
        oncePerTurnName: "miragebound_jackal_battle_completed_shift",
        actions: [
          {
            type: "switch_position",
            targetRef: "battle_opponent",
          },
        ],
      },
      {
        id: "miragebound_jackal_field_to_grave_shift",
        timing: "on_event",
        event: "card_to_grave",
        fromZone: "field",
        promptUser: true,
        promptMessage:
          'Activate "Miragebound Jackal" to change an opponent monster\'s battle position?',
        oncePerTurn: true,
        oncePerTurnName: "miragebound_jackal_field_to_grave_shift",
        targets: [
          {
            id: "miragebound_jackal_grave_shift_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "switch_position",
            targetRef: "miragebound_jackal_grave_shift_target",
          },
        ],
      },
    ],
  },
  {
    id: 354,
    name: "Miragebound Oasis",
    cardKind: "spell",
    subtype: "field",
    archetype: "Miragebound",
    description:
      'Each time a face-up monster your opponent controls changes its battle position, it loses 400 ATK/DEF until the end of the next turn. Once per turn: You can choose 1 of these effects. - Target 1 "Miragebound" monster you control; return it to the hand, then add 1 "Miragebound" monster with a different name from your Deck to your hand. - Target 1 face-up monster your opponent controls; change its battle position.',
    image: "assets/Miragebound Oasis.png",
    effects: [
      {
        id: "miragebound_oasis_position_debuff",
        timing: "on_event",
        event: "position_change",
        requireZone: "fieldSpell",
        requireFaceup: true,
        changedCardOwner: "opponent",
        changedCardRequireFaceup: true,
        promptUser: false,
        targets: [
          {
            id: "miragebound_oasis_position_debuff_target",
            targetFromContext: "changedCard",
            owner: "opponent",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "buff_stats_temp",
            targetRef: "miragebound_oasis_position_debuff_target",
            atkBoost: -400,
            defBoost: -400,
            duration: "end_of_next_turn",
            sourceName: "Miragebound Oasis",
          },
        ],
      },
      {
        id: "miragebound_oasis_ignition",
        timing: "ignition",
        requireZone: "fieldSpell",
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "miragebound_oasis_ignition",
        actions: [
          {
            type: "choose_action_case",
            selectionMessage: "Choose a Miragebound Oasis effect.",
            cases: [
              {
                id: "miragebound_oasis_recycle_search",
                label: 'Return a "Miragebound" monster; add a different one',
                description:
                  'Target 1 "Miragebound" monster you control; return it to the hand, then add 1 "Miragebound" monster with a different name from your Deck to your hand.',
                targets: [
                  {
                    id: "miragebound_oasis_return_target",
                    owner: "self",
                    zone: "field",
                    cardKind: "monster",
                    archetype: "Miragebound",
                    requireFaceup: true,
                    count: { min: 1, max: 1 },
                  },
                ],
                actions: [
                  {
                    type: "return_to_hand",
                    targetRef: "miragebound_oasis_return_target",
                    haltOnFailure: true,
                  },
                  {
                    type: "add_from_zone_to_hand",
                    zone: "deck",
                    filters: {
                      cardKind: "monster",
                      archetype: "Miragebound",
                    },
                    excludeNameRef: "miragebound_oasis_return_target",
                    count: { min: 1, max: 1 },
                    promptPlayer: true,
                  },
                ],
              },
              {
                id: "miragebound_oasis_shift_weaken",
                label: "Change an opponent monster's position",
                description:
                  "Target 1 face-up monster your opponent controls; change its battle position.",
                targets: [
                  {
                    id: "miragebound_oasis_weaken_target",
                    owner: "opponent",
                    zone: "field",
                    cardKind: "monster",
                    requireFaceup: true,
                    count: { min: 1, max: 1 },
                  },
                ],
                actions: [
                  {
                    type: "switch_position",
                    targetRef: "miragebound_oasis_weaken_target",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 355,
    name: "Miragebound Glass Sovereign",
    cardKind: "monster",
    monsterType: "ascension",
    atk: 2400,
    def: 2200,
    level: 7,
    type: "Spellcaster",
    archetype: "Miragebound",
    piercing: true,
    ascension: {
      materialId: 351,
      requirements: [{ type: "material_effect_activations", count: 2 }],
      position: "choice",
    },
    description:
      'Ascension Material: "Miragebound Scout". Requirement: The material must have activated its effects 2 times this Duel. If this card is Ascension Summoned: Target up to 2 face-up monsters your opponent controls; change their battle positions. Once per turn: Target 1 other "Miragebound" monster you control and 1 card your opponent controls; return those targets to the hand. If this card attacks a Defense Position monster, inflict piercing battle damage.',
    image: "assets/Miragebound Glass Sovereign.png",
    effects: [
      {
        id: "miragebound_glass_sovereign_ascension_shift",
        timing: "on_event",
        event: "after_summon",
        summonMethods: ["ascension"],
        requireSelfAsSummoned: true,
        promptUser: true,
        promptMessage:
          'Activate "Miragebound Glass Sovereign" to change up to 2 face-up opponent monsters\' battle positions?',
        targets: [
          {
            id: "miragebound_glass_sovereign_shift_targets",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 2 },
          },
        ],
        actions: [
          {
            type: "switch_position",
            targetRef: "miragebound_glass_sovereign_shift_targets",
          },
        ],
      },
      {
        id: "miragebound_glass_sovereign_bounce",
        timing: "ignition",
        requireZone: "field",
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "miragebound_glass_sovereign_bounce",
        targets: [
          {
            id: "miragebound_glass_sovereign_return_self_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Miragebound",
            excludeSelf: true,
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
          {
            id: "miragebound_glass_sovereign_return_opponent_target",
            owner: "opponent",
            zones: ["field", "spellTrap", "fieldSpell"],
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "return_to_hand",
            targetRef: "miragebound_glass_sovereign_return_self_target",
          },
          {
            type: "return_to_hand",
            targetRef: "miragebound_glass_sovereign_return_opponent_target",
          },
        ],
      },
    ],
  },
  {
    id: 356,
    name: "Miragebound Glass Viper",
    cardKind: "monster",
    atk: 1000,
    def: 1600,
    level: 3,
    type: "Reptile",
    archetype: "Miragebound",
    description:
      'If this card is returned from the field to the hand by a card effect: You can Special Summon this card from your hand, but banish it when it leaves the field. If this card is Special Summoned: You can target 1 face-up monster your opponent controls; it loses 500 ATK/DEF until the end of this turn. You can only use each effect of "Miragebound Glass Viper" once per turn.',
    image: "assets/Miragebound Glass Viper.png",
    effects: [
      {
        id: "miragebound_glass_viper_returned_to_hand",
        timing: "on_event",
        event: "card_moved",
        requireSelfAsMoved: true,
        fromZone: "field",
        toZone: "hand",
        movedByEffect: true,
        promptUser: true,
        promptMessage:
          'Activate "Miragebound Glass Viper" to Special Summon it from your hand?',
        oncePerTurn: true,
        oncePerTurnName: "miragebound_glass_viper_returned_to_hand",
        actions: [
          {
            type: "special_summon_from_zone",
            zone: "hand",
            requireSource: true,
            position: "choice",
            statusesOnSummon: [{ status: "banishWhenLeavesField" }],
          },
        ],
      },
      {
        id: "miragebound_glass_viper_special_summon_debuff",
        timing: "on_event",
        event: "after_summon",
        summonMethods: ["special"],
        requireSelfAsSummoned: true,
        promptUser: true,
        promptMessage:
          'Activate "Miragebound Glass Viper" to weaken an opponent monster?',
        oncePerTurn: true,
        oncePerTurnName: "miragebound_glass_viper_special_summon_debuff",
        targets: [
          {
            id: "miragebound_glass_viper_debuff_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "buff_stats_temp",
            targetRef: "miragebound_glass_viper_debuff_target",
            atkBoost: -500,
            defBoost: -500,
          },
        ],
      },
    ],
  },
  {
    id: 357,
    name: "Miragebound Sand Priestess",
    cardKind: "monster",
    atk: 1300,
    def: 1800,
    level: 4,
    type: "Spellcaster",
    archetype: "Miragebound",
    description:
      'You can target 1 "Miragebound" monster in your Graveyard; add it to your hand. The first time each turn a face-up monster your opponent controls changes its battle position: that monster loses 500 ATK/DEF until the end of the next turn. You can only use each effect of "Miragebound Sand Priestess" once per turn.',
    image: "assets/Miragebound Sand Priestess.png",
    effects: [
      {
        id: "miragebound_sand_priestess_recover",
        timing: "ignition",
        requireZone: "field",
        requireFaceup: true,
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "miragebound_sand_priestess_recover",
        targets: [
          {
            id: "miragebound_sand_priestess_recover_target",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            archetype: "Miragebound",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "miragebound_sand_priestess_recover_target",
            player: "self",
            to: "hand",
            contextLabel: "miragebound_sand_priestess_recover",
          },
        ],
      },
      {
        id: "miragebound_sand_priestess_position_debuff",
        timing: "on_event",
        event: "position_change",
        requireZone: "field",
        requireFaceup: true,
        changedCardOwner: "opponent",
        changedCardRequireFaceup: true,
        promptUser: false,
        oncePerTurn: true,
        oncePerTurnName: "miragebound_sand_priestess_position_debuff",
        targets: [
          {
            id: "miragebound_sand_priestess_debuff_target",
            targetFromContext: "changedCard",
            owner: "opponent",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "buff_stats_temp",
            targetRef: "miragebound_sand_priestess_debuff_target",
            atkBoost: -500,
            defBoost: -500,
            duration: "end_of_next_turn",
            sourceName: "Miragebound Sand Priestess",
          },
        ],
      },
    ],
  },
  {
    id: 358,
    name: "Miragebound False King",
    cardKind: "monster",
    atk: 2200,
    def: 1800,
    level: 6,
    type: "Fiend",
    archetype: "Miragebound",
    description:
      'You can Special Summon this card from your hand by returning 1 "Miragebound" monster you control to the hand. You can target 1 monster your opponent controls; change its battle position. You can only use each effect of "Miragebound False King" once per turn.',
    image: "assets/Miragebound False King.png",
    effects: [
      {
        id: "miragebound_false_king_special_summon",
        timing: "ignition",
        requireZone: "hand",
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "miragebound_false_king_special_summon",
        targets: [
          {
            id: "miragebound_false_king_return_cost",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Miragebound",
            requireFaceup: true,
            intent: "cost",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "special_summon_from_hand_with_cost",
            costTargetRef: "miragebound_false_king_return_cost",
            costDestination: "hand",
            position: "choice",
          },
        ],
      },
      {
        id: "miragebound_false_king_field_shift",
        timing: "ignition",
        requireZone: "field",
        requireFaceup: true,
        requirePhase: ["main1", "main2"],
        promptUser: true,
        promptMessage:
          'Activate "Miragebound False King" to change an opponent monster\'s battle position?',
        oncePerTurn: true,
        oncePerTurnName: "miragebound_false_king_field_shift",
        targets: [
          {
            id: "miragebound_false_king_shift_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "switch_position",
            targetRef: "miragebound_false_king_shift_target",
          },
        ],
      },
    ],
  },
  {
    id: 359,
    name: "Miragebound Mirror Path",
    cardKind: "spell",
    subtype: "continuous",
    archetype: "Miragebound",
    description:
      'The first time each turn a "Miragebound" monster you control would be destroyed by battle, you can return it to the hand instead. You can only control 1 "Miragebound Mirror Path".',
    image: "assets/Miragebound Mirror Path.png",
    effects: [
      {
        id: "miragebound_mirror_path_control_limit",
        timing: "on_play",
        speed: 1,
        conditions: [
          {
            type: "control_card_max",
            zone: "spellTrap",
            max: 0,
            includeFacedown: true,
            filters: { cardId: 359 },
            excludeSource: true,
            reason: 'You can only control 1 "Miragebound Mirror Path".',
          },
        ],
        actions: [],
      },
      {
        id: "miragebound_mirror_path_battle_return",
        timing: "passive",
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "miragebound_mirror_path_battle_return",
        replacementEffect: {
          type: "destruction",
          reason: "battle",
          targetOwner: "self",
          targetZones: ["field"],
          targetFilters: {
            cardKind: "monster",
            archetype: "Miragebound",
          },
          targetRequireFaceup: true,
          prompt:
            'Return {target} to the hand with "Miragebound Mirror Path" instead of destroying it by battle?',
          logMessage:
            "{target} returned to the hand instead of being destroyed due to {source}.",
          costActions: [
            {
              type: "return_to_hand",
              targetRef: "destroyed",
              fromZone: "field",
            },
          ],
        },
      },
    ],
  },
  {
    id: 360,
    name: "Miragebound False Horizon",
    cardKind: "trap",
    subtype: "normal",
    speed: 2,
    archetype: "Miragebound",
    description:
      'When an opponent\'s monster declares an attack: Target 1 monster your opponent controls; change its battle position. Then, you can return 1 "Miragebound" monster you control to the hand. You can only activate 1 "Miragebound False Horizon" per turn.',
    image: "assets/Miragebound False Horizon.png",
    effects: [
      {
        id: "miragebound_false_horizon_attack",
        timing: "on_event",
        event: "attack_declared",
        speed: 2,
        requireOpponentAttack: true,
        oncePerTurn: true,
        oncePerTurnName: "miragebound_false_horizon",
        targets: [
          {
            id: "miragebound_false_horizon_position_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
          {
            id: "miragebound_false_horizon_return_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Miragebound",
            requireFaceup: true,
            optional: true,
            count: { min: 0, max: 1 },
          },
        ],
        actions: [
          {
            type: "switch_position",
            targetRef: "miragebound_false_horizon_position_target",
          },
          {
            type: "return_to_hand",
            targetRef: "miragebound_false_horizon_return_target",
          },
        ],
      },
    ],
  },
  {
    id: 361,
    name: "Miragebound Vanishing Step",
    cardKind: "spell",
    subtype: "quick",
    speed: 2,
    archetype: "Miragebound",
    description:
      'Target 1 "Miragebound" monster you control; return it to the hand, then target 1 monster your opponent controls; change its battle position, and if you do, it loses 500 ATK/DEF until the end of this turn. You can only activate 1 "Miragebound Vanishing Step" per turn.',
    image: "assets/Miragebound Vanishing Step.png",
    effects: [
      {
        id: "miragebound_vanishing_step",
        timing: "on_play",
        speed: 2,
        oncePerTurn: true,
        oncePerTurnName: "miragebound_vanishing_step",
        targets: [
          {
            id: "miragebound_vanishing_step_return_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Miragebound",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
          {
            id: "miragebound_vanishing_step_position_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "return_to_hand",
            targetRef: "miragebound_vanishing_step_return_target",
            fromZone: "field",
            haltOnFailure: true,
          },
          {
            type: "switch_position",
            targetRef: "miragebound_vanishing_step_position_target",
          },
          {
            type: "buff_stats_temp",
            targetRef: "miragebound_vanishing_step_position_target",
            atkBoost: -500,
            defBoost: -500,
          },
        ],
      },
    ],
  },
  {
    id: 362,
    name: "Miragebound Heat Haze",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Miragebound",
    description:
      'If you control a "Miragebound" monster: Target 1 monster your opponent controls; change its battle position. Then, if that monster is in Defense Position, you can target 1 "Miragebound" monster in your Graveyard; add it to your hand. You can only activate 1 "Miragebound Heat Haze" per turn.',
    image: "assets/Miragebound Heat Haze.png",
    effects: [
      {
        id: "miragebound_heat_haze",
        timing: "on_play",
        oncePerTurn: true,
        oncePerTurnName: "miragebound_heat_haze",
        conditions: [
          {
            type: "control_card_filters",
            zone: "field",
            requireFaceup: true,
            filters: {
              cardKind: "monster",
              archetype: "Miragebound",
            },
            min: 1,
            reason: 'You must control a face-up "Miragebound" monster.',
          },
        ],
        targets: [
          {
            id: "miragebound_heat_haze_position_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "switch_position",
            targetRef: "miragebound_heat_haze_position_target",
          },
          {
            type: "conditional_target_actions",
            targetRef: "miragebound_heat_haze_position_target",
            defaultActions: [],
            cases: [
              {
                filters: {
                  position: "defense",
                },
                actions: [
                  {
                    type: "add_from_zone_to_hand",
                    zone: "graveyard",
                    filters: {
                      cardKind: "monster",
                      archetype: "Miragebound",
                    },
                    count: { min: 0, max: 1 },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 363,
    name: "Miragebound Desert Leviathan",
    cardKind: "monster",
    monsterType: "fusion",
    atk: 2400,
    def: 2500,
    level: 8,
    type: "Beast",
    attribute: "Earth",
    archetype: "Miragebound",
    specialSummonOnlyBy: ["contact_fusion"],
    extraDeckSummonProcedure: {
      type: "contact_fusion",
      summonMethod: "fusion",
      materialDestination: "graveyard",
      usesFusionMaterials: true,
    },
    fusionMaterials: [
      {
        name: "Miragebound Glass Viper",
        cardKind: "monster",
        allowedZones: ["field"],
      },
      {
        archetype: "Miragebound",
        cardKind: "monster",
        allowedZones: ["field"],
      },
    ],
    description:
      '"Miragebound Glass Viper" + 1 "Miragebound" monster. You can Fusion Summon this card from your Extra Deck by sending the above materials you control to the GY. If this card is Fusion Summoned: change the battle positions of all monsters your opponent controls. While this card is face-up on the field, each time a monster your opponent controls changes its battle position by a "Miragebound" card effect, it loses 300 ATK/DEF until the end of this turn. If this card would be destroyed by battle: you can return it to the Extra Deck instead.',
    image: "assets/Miragebound Desert Leviathan.png",
    effects: [
      {
        id: "miragebound_desert_leviathan_fusion_shift_all",
        timing: "on_event",
        event: "after_summon",
        summonMethods: ["fusion"],
        requireSelfAsSummoned: true,
        promptUser: false,
        actions: [
          {
            type: "switch_position",
            targetScope: {
              owner: "opponent",
              zones: ["field"],
              filters: { cardKind: "monster" },
            },
          },
        ],
      },
      {
        id: "miragebound_desert_leviathan_position_debuff",
        timing: "on_event",
        event: "position_change",
        requireZone: "field",
        requireFaceup: true,
        changedCardOwner: "opponent",
        changedCardRequireFaceup: true,
        positionChangeSourceFilters: {
          archetype: "Miragebound",
        },
        promptUser: false,
        targets: [
          {
            id: "miragebound_desert_leviathan_debuff_target",
            targetFromContext: "changedCard",
            owner: "opponent",
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "buff_stats_temp",
            targetRef: "miragebound_desert_leviathan_debuff_target",
            atkBoost: -300,
            defBoost: -300,
            duration: "end_of_turn",
            sourceName: "Miragebound Desert Leviathan",
          },
        ],
      },
      {
        id: "miragebound_desert_leviathan_battle_return_extra",
        timing: "passive",
        requireZone: "field",
        requireFaceup: true,
        replacementEffect: {
          type: "destruction",
          reason: "battle",
          targetMustBeSource: true,
          targetOwner: "self",
          targetZones: ["field"],
          targetRequireFaceup: true,
          prompt:
            'Return {target} to the Extra Deck with "Miragebound Desert Leviathan" instead of destroying it by battle?',
          logMessage:
            "{target} returned to the Extra Deck instead of being destroyed due to {source}.",
          costActions: [
            {
              type: "move",
              targetRef: "destroyed",
              player: "self",
              to: "extraDeck",
              contextLabel: "miragebound_desert_leviathan_battle_return_extra",
            },
          ],
        },
      },
    ],
  },
];
