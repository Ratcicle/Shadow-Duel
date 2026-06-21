export const burningWestCards = [
  {
    id: 451,
    name: "Gunslinger of the Burning West",
    cardKind: "monster",
    atk: 1700,
    def: 1200,
    level: 4,
    type: "Pyro",
    attribute: "Fire",
    archetype: "Burning West",
    description:
      'If you control "Wanted in the Burning West": You can Special Summon this card from your hand. If this card destroys an opponent\'s monster by battle: You can discard 1 card; make your opponent discard 1 card. You can only use each effect of "Gunslinger of the Burning West" once per turn.',
    image: "assets/Gunslinger of the Burning West.png",
    effects: [
      {
        id: "burning_west_gunslinger_special_summon",
        timing: "ignition",
        requireZone: "hand",
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "burning_west_gunslinger_special_summon",
        conditions: [
          {
            type: "control_card",
            owner: "self",
            zone: "spellTrap",
            requireFaceup: true,
            filters: {
              cardId: 452,
              cardKind: "spell",
              subtype: "continuous",
            },
          },
        ],
        actions: [
          {
            type: "conditional_summon_from_hand",
            targetRef: "self",
            position: "choice",
            optional: true,
          },
        ],
      },
      {
        id: "burning_west_gunslinger_battle_discard",
        timing: "on_event",
        event: "battle_destroy",
        requireZone: "field",
        requireFaceup: true,
        requireSelfAsBattleDestroyer: true,
        requireDestroyedIsOpponent: true,
        destroyedCardFilters: {
          cardKind: "monster",
        },
        promptUser: true,
        promptMessage:
          'Activate "Gunslinger of the Burning West" to discard 1 card and make your opponent discard 1 card?',
        oncePerTurn: true,
        oncePerTurnName: "burning_west_gunslinger_battle_discard",
        actions: [
          {
            type: "discard_from_hand",
            player: "self",
            count: { min: 1, max: 1 },
            chooser: "affected",
            contextLabel: "cost",
            selectionLabel: "Discard 1 card",
          },
          {
            type: "discard_from_hand",
            player: "opponent",
            count: { min: 1, max: 1 },
            chooser: "affected",
            contextLabel: "discard",
            selectionLabel: "Discard 1 card",
          },
        ],
      },
    ],
  },
  {
    id: 452,
    name: "Wanted in the Burning West",
    cardKind: "spell",
    subtype: "continuous",
    archetype: "Burning West",
    description:
      'Once per turn: Declare 1 monster Type. Until the end of the next turn, if a "Burning West" monster you control destroys an opponent\'s monster with the declared Type by battle: You can apply 1 of these effects.\n- Special Summon 1 Level 5 or lower "Burning West" monster from your hand.\n- Target 1 "Burning West" monster you control; it gains 800 ATK until the end of the next turn.\n- Target 1 "Burning West" Spell/Trap in your GY; add it to your hand.\nYou can only use this effect of "Wanted in the Burning West" once per turn.',
    image: "assets/Wanted in the Burning West.png",
    effects: [
      {
        id: "burning_west_wanted_declare_type",
        timing: "ignition",
        requireZone: "spellTrap",
        requirePhase: ["main1", "main2"],
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "burning_west_wanted_declare_type",
        actions: [
          {
            type: "declare_card_property",
            property: "type",
            stateKey: "burning_west_wanted_type",
            choices: "monster_types_in_database",
            duration: "end_of_next_turn",
            selectionLabel: "Monster Type",
            selectionMessage:
              'Declare 1 monster Type for "Wanted in the Burning West".',
          },
        ],
      },
      {
        id: "burning_west_wanted_reward",
        timing: "on_event",
        event: "battle_destroy",
        requireZone: "spellTrap",
        requireFaceup: true,
        requireDestroyedIsOpponent: true,
        promptUser: true,
        promptMessage:
          'Activate "Wanted in the Burning West" to claim a reward?',
        oncePerTurn: true,
        oncePerTurnPerCard: true,
        oncePerTurnName: "burning_west_wanted_reward",
        conditions: [
          {
            type: "attacker_matches",
            owner: "self",
            cardKind: "monster",
            archetype: "Burning West",
          },
          {
            type: "destroyed_card_matches_declared_value",
            stateKey: "burning_west_wanted_type",
            property: "type",
          },
        ],
        actions: [
          {
            type: "choose_action_case",
            effectChoiceKey: "burning_west_wanted_reward",
            selectionMessage:
              'Choose a "Wanted in the Burning West" reward.',
            cases: [
              {
                id: "burning_west_wanted_summon",
                actions: [
                  {
                    type: "special_summon_from_zone",
                    zone: "hand",
                    filters: {
                      cardKind: "monster",
                      archetype: "Burning West",
                      level: 5,
                      levelOp: "lte",
                    },
                    count: { min: 1, max: 1 },
                    position: "choice",
                    promptPlayer: true,
                  },
                ],
              },
              {
                id: "burning_west_wanted_buff",
                targets: [
                  {
                    id: "burning_west_wanted_buff_target",
                    owner: "self",
                    zone: "field",
                    cardKind: "monster",
                    archetype: "Burning West",
                    requireFaceup: true,
                    count: { min: 1, max: 1 },
                  },
                ],
                actions: [
                  {
                    type: "buff_stats_temp",
                    targetRef: "burning_west_wanted_buff_target",
                    atkBoost: 800,
                    duration: "end_of_next_turn",
                  },
                ],
              },
              {
                id: "burning_west_wanted_recover",
                actions: [
                  {
                    type: "add_from_zone_to_hand",
                    zone: "graveyard",
                    filters: {
                      cardKind: ["spell", "trap"],
                      archetype: "Burning West",
                    },
                    count: { min: 1, max: 1 },
                    promptPlayer: true,
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
    id: 453,
    name: "Undertaker of the Burning West",
    cardKind: "monster",
    atk: 1900,
    def: 2000,
    level: 5,
    type: "Pyro",
    attribute: "Fire",
    archetype: "Burning West",
    description:
      'Once per turn: You can send 1 "Burning West" monster you control to the Graveyard; Special Summon 1 "Burning West" monster from your Graveyard with a different name from the sent monster. If this card is destroyed by battle: destroy the monster that destroyed this card. You can only use each effect of "Undertaker of the Burning West" once per turn.',
    image: "assets/Undertaker of the Burning West.png",
    effects: [
      {
        id: "burning_west_undertaker_revive",
        timing: "ignition",
        requireZone: "field",
        requirePhase: ["main1", "main2"],
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "burning_west_undertaker_revive",
        targets: [
          {
            id: "burning_west_undertaker_cost",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Burning West",
            count: { min: 1, max: 1 },
            intent: "cost",
          },
          {
            id: "burning_west_undertaker_revive_target",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            archetype: "Burning West",
            excludeNameRef: "burning_west_undertaker_cost",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "burning_west_undertaker_cost",
            player: "self",
            fromZone: "field",
            to: "graveyard",
            contextLabel: "cost",
            skipSendToGraveActionReplacement: true,
          },
          {
            type: "special_summon_from_zone",
            targetRef: "burning_west_undertaker_revive_target",
            zone: "graveyard",
            position: "choice",
            promptPlayer: true,
          },
        ],
      },
      {
        id: "burning_west_undertaker_battle_revenge",
        timing: "on_event",
        event: "battle_completed",
        requireSelfBattled: true,
        requireSelfDestroyedByBattle: true,
        oncePerTurn: true,
        oncePerTurnName: "burning_west_undertaker_battle_revenge",
        actions: [
          {
            type: "destroy",
            targetRef: "battle_opponent",
          },
        ],
      },
    ],
  },
  {
    id: 454,
    name: "Butcher of the Burning West",
    cardKind: "monster",
    atk: 1600,
    def: 1500,
    level: 4,
    type: "Pyro",
    attribute: "Fire",
    archetype: "Burning West",
    description:
      'If this card is Normal Summoned: You can add 1 Level 5 or lower "Burning West" monster from your Deck to your hand. If the monster added by this effect is Special Summoned this turn: You can add 1 "Burning West" Spell/Trap from your Deck to your hand. You can only use each effect of "Butcher of the Burning West" once per turn.',
    image: "assets/Butcher of the Burning West.png",
    effects: [
      {
        id: "burning_west_butcher_search_monster",
        timing: "on_event",
        event: "after_summon",
        requireZone: "field",
        requireFaceup: true,
        requireSelfAsSummoned: true,
        summonMethods: ["normal"],
        promptUser: true,
        oncePerTurn: true,
        oncePerTurnName: "burning_west_butcher_search_monster",
        actions: [
          {
            type: "add_from_zone_to_hand",
            zone: "deck",
            filters: {
              cardKind: "monster",
              archetype: "Burning West",
              level: 5,
              levelOp: "lte",
            },
            count: { min: 1, max: 1 },
            promptPlayer: true,
            markAddedCards: {
              key: "burning_west_butcher_added_monster",
              duration: "end_of_turn",
              bindToSource: true,
              sourceEffectId: "burning_west_butcher_search_monster",
            },
          },
        ],
      },
      {
        id: "burning_west_butcher_followup_search",
        timing: "on_event",
        event: "after_summon",
        requireZone: "field",
        requireFaceup: true,
        summonMethods: ["special"],
        promptUser: true,
        oncePerTurn: true,
        oncePerTurnName: "burning_west_butcher_followup_search",
        conditions: [
          {
            type: "summoned_card_has_marker",
            key: "burning_west_butcher_added_monster",
            sourceRef: "self",
            sourceEffectId: "burning_west_butcher_search_monster",
          },
        ],
        actions: [
          {
            type: "add_from_zone_to_hand",
            zone: "deck",
            filters: {
              cardKind: ["spell", "trap"],
              archetype: "Burning West",
            },
            count: { min: 1, max: 1 },
            promptPlayer: true,
          },
        ],
      },
    ],
  },
  {
    id: 455,
    name: "Specialist of the Burning West",
    cardKind: "monster",
    atk: 2000,
    def: 1600,
    level: 5,
    type: "Pyro",
    attribute: "Fire",
    archetype: "Burning West",
    description:
      'If this card is equipped with a "Burning West" Equip Spell, it can make 1 additional attack on monsters during each Battle Phase. Once per turn: You can target 1 monster your opponent controls; take control of it, and if you do, send all other "Burning West" monsters you control to the Graveyard. You can only use each effect of "Specialist of the Burning West" once per turn.',
    image: "assets/Specialist of the Burning West.png",
    effects: [
      {
        id: "burning_west_specialist_extra_attack",
        timing: "passive",
        requireZone: "field",
        requireFaceup: true,
        passive: {
          type: "conditional_extra_attacks",
          amount: 1,
          targetRestriction: "monster",
          equippedWithFilters: {
            archetype: "Burning West",
            subtype: "equip",
          },
        },
      },
      {
        id: "burning_west_specialist_take_control",
        timing: "ignition",
        requireZone: "field",
        requirePhase: ["main1", "main2"],
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "burning_west_specialist_take_control",
        targets: [
          {
            id: "burning_west_specialist_control_target",
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
            targetRef: "burning_west_specialist_control_target",
            player: "self",
            fromZone: "field",
            to: "field",
            preservePosition: true,
            resetAttackFlags: true,
            contextLabel: "control",
          },
          {
            type: "move",
            targetScope: {
              owner: "self",
              zones: ["field"],
              filters: {
                cardKind: "monster",
                archetype: "Burning West",
              },
              excludeSelf: true,
            },
            player: "self",
            fromZone: "field",
            to: "graveyard",
            allowEmpty: true,
            contextLabel: "effect",
          },
        ],
      },
    ],
  },
  {
    id: 456,
    name: "Burning Peacemaker",
    cardKind: "spell",
    subtype: "equip",
    archetype: "Burning West",
    description:
      'Equip only to a "Burning West" monster. It gains 500 ATK/DEF. If the equipped monster destroys an opponent\'s monster by battle: You can target 1 Spell/Trap your opponent controls; destroy it. You can banish this card from your Graveyard; add 1 "Wanted in the Burning West" from your Deck or Graveyard to your hand. You can only use this effect of "Peacemaker of the Burning West" once per turn.',
    image: "assets/Burning Peacemaker.png",
    effects: [
      {
        id: "burning_peacemaker_equip",
        timing: "on_play",
        targets: [
          {
            id: "burning_peacemaker_equip_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Burning West",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "equip",
            targetRef: "burning_peacemaker_equip_target",
            atkBonus: 500,
            defBonus: 500,
          },
        ],
      },
      {
        id: "burning_peacemaker_battle_destroy_spelltrap",
        timing: "on_event",
        event: "battle_destroy",
        requireZone: "spellTrap",
        requireFaceup: true,
        requireEquippedAsBattleDestroyer: true,
        requireDestroyedIsOpponent: true,
        destroyedCardFilters: {
          cardKind: "monster",
        },
        promptUser: true,
        promptMessage:
          'Activate "Burning Peacemaker" to destroy an opponent Spell/Trap?',
        targets: [
          {
            id: "burning_peacemaker_spelltrap_target",
            owner: "opponent",
            zone: "spellTrap",
            cardKind: ["spell", "trap"],
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "destroy",
            targetRef: "burning_peacemaker_spelltrap_target",
          },
        ],
      },
      {
        id: "burning_peacemaker_wanted_search",
        timing: "ignition",
        requireZone: "graveyard",
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "burning_peacemaker_wanted_search",
        targets: [
          {
            id: "burning_peacemaker_wanted_target",
            owner: "self",
            zones: ["deck", "graveyard"],
            cardId: 452,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "self",
            player: "self",
            fromZone: "graveyard",
            to: "banished",
            contextLabel: "cost",
          },
          {
            type: "move",
            targetRef: "burning_peacemaker_wanted_target",
            player: "self",
            to: "hand",
            contextLabel: "search",
          },
        ],
      },
    ],
  },
  {
    id: 457,
    name: "Quick Draw in the Burning West",
    cardKind: "spell",
    subtype: "quick",
    speed: 2,
    archetype: "Burning West",
    description:
      'Target 1 face-up "Burning West" monster you control and 1 face-up monster your opponent controls; until the end of this turn, if those targets battle each other, destroy the opponent\'s monster at the start of the Damage Step. After this effect resolves, if the difference between the current ATK of those targets is 500 or less, Set this card to your field instead of sending it to the Graveyard. You can only activate 1 "Quick Draw in the Burning West" per turn.',
    image: "assets/Quick Draw in the Burning West.png",
    effects: [
      {
        id: "quick_draw_in_the_burning_west",
        timing: "on_play",
        speed: 2,
        oncePerTurn: true,
        oncePerTurnName: "quick_draw_in_the_burning_west_activation",
        targets: [
          {
            id: "quick_draw_burning_west_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Burning West",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
          {
            id: "quick_draw_opponent_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "register_battle_pair_effect",
            firstTargetRef: "quick_draw_burning_west_target",
            secondTargetRef: "quick_draw_opponent_target",
            affectedTargetRef: "quick_draw_opponent_target",
            timing: "before_damage_calculation",
            duration: "end_of_turn",
            actions: [
              {
                type: "destroy",
                targetRef: "quick_draw_opponent_target",
              },
            ],
          },
          {
            type: "set_source_after_resolution_if",
            firstTargetRef: "quick_draw_burning_west_target",
            secondTargetRef: "quick_draw_opponent_target",
            atkDifferenceMax: 500,
            contextLabel: "quick_draw_set_after_resolution",
          },
        ],
      },
    ],
  },
  {
    id: 458,
    name: "Funeral at Sunset",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Burning West",
    description:
      'Send 1 "Burning West" monster from your Deck to the Graveyard; then, if you control a face-up "Burning West" monster, you can add 1 "Burning West" monster from your Graveyard to your hand, except the monster sent by this effect. You can only activate 1 "Funeral at Sunset" per turn.',
    image: "assets/Funeral at Sunset.png",
    effects: [
      {
        id: "funeral_at_sunset",
        timing: "on_play",
        oncePerTurn: true,
        oncePerTurnName: "funeral_at_sunset_activation",
        targets: [
          {
            id: "funeral_at_sunset_sent_monster",
            owner: "self",
            zone: "deck",
            cardKind: "monster",
            archetype: "Burning West",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "funeral_at_sunset_sent_monster",
            player: "self",
            fromZone: "deck",
            to: "graveyard",
            contextLabel: "effect",
          },
          {
            type: "optional_target_actions",
            optional: true,
            conditions: [
              {
                type: "control_card_filters",
                owner: "self",
                zone: "field",
                filters: {
                  cardKind: "monster",
                  archetype: "Burning West",
                },
                requireFaceup: true,
              },
            ],
            targets: [],
            actions: [
              {
                type: "add_from_zone_to_hand",
                zone: "graveyard",
                filters: {
                  cardKind: "monster",
                  archetype: "Burning West",
                },
                excludeTargetRef: "funeral_at_sunset_sent_monster",
                count: { min: 0, max: 1 },
                promptPlayer: true,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 459,
    name: "Deadeye of the Burning West",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Burning West",
    description:
      'Declare 1 monster Type. The first time this turn a "Burning West" monster you control destroys an opponent\'s monster with the declared Type by battle: draw 1 card, and if the destroyed monster is an Extra Deck monster, inflict 1000 damage to your opponent. You can only activate 1 "Deadeye of the Burning West" per turn.',
    image: "assets/Burning West Deadeye.png",
    effects: [
      {
        id: "deadeye_of_the_burning_west",
        timing: "on_play",
        oncePerTurn: true,
        oncePerTurnName: "deadeye_of_the_burning_west_activation",
        actions: [
          {
            type: "declare_card_property",
            property: "type",
            stateKey: "burning_west_deadeye_type",
            choices: "monster_types_in_database",
            duration: "end_of_turn",
            selectionLabel: "Monster Type",
            selectionMessage:
              'Declare 1 monster Type for "Deadeye of the Burning West".',
          },
          {
            type: "register_temporary_event_effect",
            event: "battle_destroy",
            duration: "end_of_turn",
            uses: 1,
            stateKey: "burning_west_deadeye_type",
            effectId: "deadeye_of_the_burning_west_reward",
            promptUser: false,
            conditions: [
              {
                type: "battle_destroyer_matches_filters",
                owner: "self",
                filters: {
                  cardKind: "monster",
                  archetype: "Burning West",
                },
              },
              {
                type: "event_card_matches_filters",
                cardRef: "destroyed",
                owner: "opponent",
                filters: {
                  cardKind: "monster",
                },
              },
              {
                type: "destroyed_card_matches_declared_value",
                stateKey: "burning_west_deadeye_type",
                property: "type",
              },
            ],
            actions: [
              {
                type: "draw",
                player: "self",
                amount: 1,
              },
              {
                type: "conditional_actions",
                conditions: [
                  {
                    type: "event_card_matches_filters",
                    cardRef: "destroyed",
                    filters: {
                      monsterType: ["fusion", "ascension"],
                    },
                  },
                ],
                actions: [
                  {
                    type: "damage",
                    player: "opponent",
                    amount: 1000,
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
    id: 460,
    name: "Preacher of the Burning West",
    cardKind: "monster",
    atk: 1500,
    def: 1300,
    level: 4,
    type: "Pyro",
    attribute: "Fire",
    archetype: "Burning West",
    description:
      'If a "Burning West" monster you control would be destroyed by battle or card effect: You can Special Summon this card from your hand, and if you do, negate that destruction. If another "Burning West" monster you control would be sent from the field to the Graveyard: You can send this card to the Graveyard; shuffle that monster into the Deck instead. You can only use each effect of "Preacher of the Burning West" once per turn.',
    image: "assets/Preacher of the Burning West.png",
    effects: [
      {
        id: "burning_west_preacher_hand_protection",
        timing: "passive",
        requireZone: "hand",
        oncePerTurn: true,
        oncePerTurnName: "burning_west_preacher_hand_protection",
        replacementEffect: {
          type: "destruction",
          reason: "any",
          targetOwner: "self",
          targetZones: ["field"],
          targetFilters: {
            cardKind: "monster",
            archetype: "Burning West",
          },
          targetRequireFaceup: true,
          prompt:
            'Special Summon "Preacher of the Burning West" from your hand to prevent {target} from being destroyed?',
          logMessage:
            "{target} avoided destruction due to {source}.",
          costActions: [
            {
              type: "special_summon_from_zone",
              zone: "hand",
              requireSource: true,
              position: "choice",
              promptPlayer: false,
            },
          ],
        },
      },
      {
        id: "burning_west_preacher_graveyard_replacement",
        timing: "passive",
        requireZone: "field",
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "burning_west_preacher_graveyard_replacement",
        replacementEffect: {
          type: "send_to_grave",
          targetOwner: "self",
          targetZones: ["field"],
          targetFilters: {
            cardKind: "monster",
            archetype: "Burning West",
          },
          targetRequireFaceup: true,
          targetMustNotBeSource: true,
          prompt:
            'Send "Preacher of the Burning West" to the Graveyard to shuffle {target} into the Deck instead?',
          logMessage:
            "{target} was shuffled into the Deck instead due to {source}.",
        },
        actions: [
          {
            type: "move",
            targetRef: "self",
            player: "self",
            fromZone: "field",
            to: "graveyard",
            contextLabel: "cost",
          },
          {
            type: "move",
            targetRef: "movedCard",
            player: "self",
            fromZone: "field",
            to: "deck",
            contextLabel: "replacement",
          },
          {
            type: "shuffle_deck",
            player: "self",
          },
        ],
      },
    ],
  },
  {
    id: 461,
    name: "Sheriff of the Burning West",
    cardKind: "monster",
    atk: 2400,
    def: 1700,
    level: 6,
    type: "Pyro",
    attribute: "Fire",
    archetype: "Burning West",
    description:
      'If this card is Tribute Summoned: Declare 1 monster Type. While this card is face-up on the field, "Burning West" monsters you control that battle opponent\'s monsters with the declared Type gain 500 ATK/DEF during the Damage Step. If this card is destroyed by battle: You can add 1 "Peacemaker of the Burning West" from your Deck to your hand.',
    image: "assets/Sheriff of the Burning West.png",
    effects: [
      {
        id: "burning_west_sheriff_declare_type",
        timing: "on_event",
        event: "after_summon",
        requireSelfAsSummoned: true,
        summonMethods: ["tribute"],
        promptUser: false,
        actions: [
          {
            type: "declare_card_property",
            property: "type",
            stateKey: "burning_west_sheriff_type",
            choices: "monster_types_in_database",
            duration: "while_faceup",
            selectionLabel: "Monster Type",
            selectionMessage:
              'Declare 1 monster Type for "Sheriff of the Burning West".',
          },
        ],
      },
      {
        id: "burning_west_sheriff_damage_step_boost",
        timing: "on_event",
        event: "battle_damage",
        requireZone: "field",
        requireFaceup: true,
        promptUser: false,
        conditions: [
          {
            type: "battle_participant_matches_filters",
            owner: "self",
            filters: {
              cardKind: "monster",
              archetype: "Burning West",
            },
          },
          {
            type: "battle_opponent_matches_declared_value",
            stateKey: "burning_west_sheriff_type",
            property: "type",
          },
        ],
        actions: [
          {
            type: "buff_stats_temp",
            targetRef: "battle_self_participant",
            atkBoost: 500,
            defBoost: 500,
            duration: "damage_calculation",
          },
        ],
      },
      {
        id: "burning_west_sheriff_battle_search_peacemaker",
        timing: "on_event",
        event: "battle_completed",
        requireSelfBattled: true,
        requireSelfDestroyedByBattle: true,
        promptUser: true,
        actions: [
          {
            type: "add_from_zone_to_hand",
            zone: "deck",
            cardId: 456,
            count: { min: 1, max: 1 },
            promptPlayer: true,
          },
        ],
      },
    ],
  },
  {
    id: 462,
    name: "Crash Town, the Burning City",
    cardKind: "spell",
    subtype: "field",
    archetype: "Burning West",
    description:
      'While you control exactly 1 monster, and it is a "Burning West" monster, and your opponent controls exactly 1 monster, face-up monsters on the field cannot be destroyed by card effects. Activations of Spells/Traps that mention "Burning West" cards cannot be negated.',
    image: "assets/Crash Town, the Burning City.png",
    effects: [
      {
        id: "crash_town_effect_destruction_protection",
        timing: "passive",
        requireZone: "fieldSpell",
        requireFaceup: true,
        passive: {
          type: "conditional_destruction_protection_aura",
          protectionType: "effect_destruction",
          targetOwners: ["self", "opponent"],
          targetZones: ["field"],
          targetRequireFaceup: true,
          targetFilters: {
            cardKind: "monster",
          },
          conditions: [
            {
              type: "field_card_count",
              owner: "self",
              zone: "field",
              filters: {
                cardKind: "monster",
                archetype: "Burning West",
              },
              requireFaceup: true,
              count: 1,
            },
            {
              type: "field_card_count",
              owner: "self",
              zone: "field",
              filters: {
                cardKind: "monster",
              },
              count: 1,
            },
            {
              type: "field_card_count",
              owner: "opponent",
              zone: "field",
              filters: {
                cardKind: "monster",
              },
              count: 1,
            },
          ],
        },
      },
      {
        id: "crash_town_burning_west_activations_unnegatable",
        timing: "passive",
        requireZone: "fieldSpell",
        requireFaceup: true,
        passive: {
          type: "activation_negation_protection",
          targetCardKinds: ["spell", "trap"],
          textIncludes: "Burning West",
        },
      },
    ],
  },
  {
    id: 463,
    name: "Ambush in Crash Town",
    cardKind: "trap",
    subtype: "normal",
    archetype: "Burning West",
    description:
      'When an opponent\'s monster declares an attack: Special Summon 1 Level 5 or lower "Burning West" monster from your hand or Graveyard, and if you do, change the attack target to it. During that battle, that monster gains 500 ATK/DEF. You can only activate 1 "Ambush in Crash Town" per turn.',
    image: "assets/Ambush in Crash Town.png",
    effects: [
      {
        id: "ambush_in_crash_town",
        timing: "on_event",
        event: "attack_declared",
        requireOpponentAttack: true,
        oncePerTurn: true,
        oncePerTurnName: "ambush_in_crash_town_activation",
        actions: [
          {
            type: "special_summon_from_zone",
            zone: ["hand", "graveyard"],
            filters: {
              cardKind: "monster",
              archetype: "Burning West",
            },
            maxLevel: 5,
            count: { min: 1, max: 1 },
            position: "choice",
            promptPlayer: true,
            resultRef: "ambush_in_crash_town_summoned",
          },
          {
            type: "redirect_current_attack_to_target",
            targetRef: "ambush_in_crash_town_summoned",
            contextLabel: "ambush_in_crash_town",
          },
          {
            type: "buff_stats_temp",
            targetRef: "ambush_in_crash_town_summoned",
            atkBoost: 500,
            defBoost: 500,
            duration: "damage_calculation",
          },
        ],
      },
    ],
  },
  {
    id: 464,
    name: "Burning Reward",
    cardKind: "trap",
    subtype: "normal",
    archetype: "Burning West",
    description:
      'If a "Burning West" monster you control destroys an opponent\'s monster by battle: Target 1 "Burning West" monster in your Graveyard; add it to your hand. Then, if the destroyed monster had a Type declared by a "Burning West" card effect you control, you can Special Summon the added card from your hand. You can only activate 1 "Burning Reward" per turn.',
    image: "assets/Burning Reward.png",
    effects: [
      {
        id: "burning_reward",
        timing: "on_event",
        event: "battle_destroy",
        oncePerTurn: true,
        oncePerTurnName: "burning_reward_activation",
        conditions: [
          {
            type: "battle_destroyer_matches_filters",
            owner: "self",
            filters: {
              cardKind: "monster",
              archetype: "Burning West",
            },
          },
          {
            type: "event_card_matches_filters",
            cardRef: "destroyed",
            owner: "opponent",
            filters: {
              cardKind: "monster",
            },
          },
        ],
        actions: [
          {
            type: "add_from_zone_to_hand",
            zone: "graveyard",
            filters: {
              cardKind: "monster",
              archetype: "Burning West",
            },
            count: { min: 1, max: 1 },
            promptPlayer: true,
            resultRef: "burning_reward_added_monster",
            selectionMessage:
              'Choose 1 "Burning West" monster in your Graveyard to add to your hand.',
          },
          {
            type: "optional_target_actions",
            optional: true,
            confirmOnly: true,
            selectionMessage: "Special Summon the added monster?",
            conditions: [
              {
                type: "event_card_matches_declared_value_from_effect_sources",
                cardRef: "destroyed",
                property: "type",
                owner: "self",
                sourceFilters: {
                  archetype: "Burning West",
                },
              },
            ],
            targets: [],
            actions: [
              {
                type: "special_summon_from_zone",
                zone: "hand",
                targetRef: "burning_reward_added_monster",
                count: { min: 1, max: 1 },
                position: "choice",
                promptPlayer: true,
              },
            ],
          },
        ],
      },
    ],
  },
];
