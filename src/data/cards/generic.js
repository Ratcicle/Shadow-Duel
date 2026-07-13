export const genericCards = [
  {
    id: 1,
    name: "Nightmare Steed",
    cardKind: "monster",
    atk: 1700,
    def: 1200,
    level: 4,
    type: "Beast",
    attribute: "Dark",
    description: "A demonic horse with flaming mane.",
    image: "assets/Nightmare Steed.png",
  },
  {
    id: 2,
    name: "Arcane Surge",
    cardKind: "spell",
    subtype: "normal",
    description: "Draw 2 cards.",
    image: "assets/Arcane Surge.jpg",
    effects: [
      {
        id: "arcane_surge_draw",
        timing: "on_play",
        speed: 1,
        actions: [{ type: "draw", amount: 2, player: "self" }],
      },
    ],
  },
  {
    id: 3,
    name: "Blood Sucking Mosquito",
    cardKind: "spell",
    subtype: "normal",
    description: "Gain 1000 LP.",
    image: "assets/Blood sucking Mosquito.png",
    effects: [
      {
        id: "life_pulse_heal",
        timing: "on_play",
        speed: 1,
        actions: [{ type: "heal", amount: 1000, player: "self" }],
      },
    ],
  },
  {
    id: 4,
    name: "Cheap Necromancy",
    cardKind: "spell",
    subtype: "normal",
    description:
      'Special Summon 1 "Summoned Skeleton" Token (ATK/DEF 500). Choose its battle position.',
    image: "assets/Summoned Skeleton.jpg",
    effects: [
      {
        id: "cheap_necromancy",
        timing: "on_play",
        speed: 1,
        actions: [
          {
            type: "special_summon_token",
            player: "self",
            position: "choice",
            token: {
              name: "Summoned Skeleton",
              atk: 500,
              def: 500,
              level: 2,
              type: "Fiend",
              image: "assets/Summoned Skeleton.jpg",
              description: "A mischievous imp called from beyond.",
            },
          },
        ],
      },
    ],
  },
  {
    id: 5,
    name: "Midnight Nightmare Steed",
    cardKind: "monster",
    atk: 2600,
    def: 2000,
    level: 7,
    type: "Beast",
    attribute: "Dark",
    altTribute: { requiresName: "Nightmare Steed", tributes: 1 },
    description:
      'Can be Tribute Summoned with 1 tribute if it is "Nightmare Steed". If it destroys a monster by battle, inflict 300 damage.',
    image: "assets/Midnight Nightmare Steed.png",
    effects: [
      {
        id: "midnight_nightmare_steed_battle_damage",
        timing: "on_event",
        event: "battle_destroy",
        requireSelfAsBattleDestroyer: true,
        actions: [
          {
            type: "damage",
            player: "opponent",
            amount: 300,
          },
        ],
      },
    ],
  },
  {
    id: 6,
    name: "Infinity Searcher",
    cardKind: "spell",
    subtype: "normal",
    description: "Add 1 card from your Deck to your hand.",
    image: "assets/Infinity Searcher.png",
    effects: [
      {
        id: "infinity_searcher",
        timing: "on_play",
        speed: 1,
        actions: [{ type: "search_any" }],
      },
    ],
  },
  {
    id: 7,
    name: "Transmutate",
    cardKind: "spell",
    subtype: "normal",
    description:
      "Send 1 monster you control to the GY, then Special Summon 1 monster from your GY with the same Level.",
    image: "assets/Transmutate.png",
    effects: [
      {
        id: "transmutate_effect",
        timing: "on_play",
        speed: 1,
        targets: [
          {
            id: "transmutate_cost",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [{ type: "transmutate", targetRef: "transmutate_cost" }],
      },
    ],
  },
  {
    id: 8,
    name: "Monster Reborn",
    cardKind: "spell",
    subtype: "normal",
    description:
      "Target 1 monster in any Graveyard; Special Summon it to your field.",
    image: "assets/Monster Reborn.png",
    effects: [
      {
        id: "monster_reborn_effect",
        timing: "on_play",
        speed: 1,
        targets: [
          {
            id: "reborn_target",
            owner: "any",
            zone: "graveyard",
            cardKind: "monster",
            excludeCannotBeSpecialSummoned: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "reborn_target",
            player: "self",
            to: "field",
            isFacedown: false,
            resetAttackFlags: true,
          },
        ],
      },
    ],
  },
  {
    id: 9,
    name: "Arcane Scholar",
    cardKind: "monster",
    atk: 1500,
    def: 1200,
    level: 4,
    type: "Spellcaster",
    attribute: "Dark",
    description: "When this card is Normal Summoned: draw 1 card.",
    image: "assets/Arcane Scholar.png",
    effects: [
      {
        id: "arcane_scholar_on_normal_summon",
        timing: "on_event",
        event: "after_summon",
        requireSelfAsSummoned: true,
        summonMethods: ["normal"],
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
    id: 10,
    name: "Light-Dividing Sword",
    cardKind: "spell",
    subtype: "equip",
    description:
      "If the equipped monster destroys a monster by battle: gain 500 LP. If this card is sent to the Graveyard: target 1 Spell your opponent controls; destroy that target.",
    image: "assets/Light-Dividing Sword.png",
    effects: [
      {
        id: "light_dividing_sword_equip",
        timing: "on_play",
        speed: 1,
        targets: [
          {
            id: "lds_equip_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "equip",
            targetRef: "lds_equip_target",
          },
        ],
      },
      {
        id: "light_dividing_sword_lifegain",
        timing: "on_event",
        event: "battle_destroy",
        requireEquippedAsBattleDestroyer: true,
        actions: [
          {
            type: "heal",
            player: "self",
            amount: 500,
          },
        ],
      },
      {
        id: "light_dividing_sword_pop_backrow",
        timing: "on_event",
        event: "card_to_grave",
        fromZone: "spellTrap",
        actions: [
          {
            type: "destroy",
            targetRef: "lds_pop_target",
          },
        ],
        targets: [
          {
            id: "lds_pop_target",
            owner: "opponent",
            zone: "spellTrap",
            cardKind: "spell",
            count: { min: 1, max: 1 },
          },
        ],
      },
    ],
  },
  {
    id: 11,
    name: "Sword of Two Darks",
    cardKind: "spell",
    subtype: "equip",
    description:
      "The Equipped monster can make 1 additional attack during each Battle Phase. If this card is sent to the Graveyard: target 1 Spell/Trap your opponent controls; destroy that target.",
    image: "assets/Sword of Two Darks.png",
    effects: [
      {
        id: "sword_of_two_darks_equip",
        timing: "on_play",
        speed: 1,
        targets: [
          {
            id: "sotd_equip_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "equip",
            targetRef: "sotd_equip_target",
            extraAttacks: 1,
          },
        ],
      },
      {
        id: "sword_of_two_darks_pop_backrow",
        timing: "on_event",
        event: "card_to_grave",
        fromZone: "spellTrap",
        actions: [
          {
            type: "destroy",
            targetRef: "sotd_pop_target",
          },
        ],
        targets: [
          {
            id: "sotd_pop_target",
            owner: "opponent",
            zone: "spellTrap",
            count: { min: 1, max: 1 },
          },
        ],
      },
    ],
  },
  {
    id: 12,
    name: "Polymerization",
    cardKind: "spell",
    subtype: "normal",
    description:
      "Fusion Summon 1 Fusion Monster from your Extra Deck, using monsters from your hand or field as Fusion Material.",
    image: "assets/Polymerization.png",
    effects: [
      {
        id: "polymerization_fusion",
        timing: "on_play",
        speed: 1,
        actions: [
          {
            type: "polymerization_fusion_summon",
          },
        ],
      },
    ],
  },
  {
    id: 13,
    name: "Mirror Force",
    cardKind: "trap",
    subtype: "normal",
    speed: 2,
    description:
      "When an opponent's monster declares an attack: Destroy all Attack Position monsters your opponent controls.",
    image: "assets/Mirror Force.png",
    effects: [
      {
        id: "mirror_force_effect",
        timing: "on_event",
        event: "attack_declared",
        requireOpponentAttack: true,
        actions: [
          {
            type: "mirror_force_destroy_all",
          },
        ],
      },
    ],
  },
  {
    id: 14,
    name: "Power Force Field",
    cardKind: "trap",
    subtype: "normal",
    speed: 2,
    description:
      "When an opponent's monster declares an attack: target the attacking monster; negate the attack, then end the Battle Phase.",
    image: "assets/Power Force Field.png",
    effects: [
      {
        id: "power_force_field_negate_end_battle",
        timing: "on_event",
        event: "attack_declared",
        requireOpponentAttack: true,
        targets: [
          {
            id: "attacking_monster",
            targetFromContext: "attacker",
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "negate_attack",
          },
          {
            type: "end_battle_phase",
          },
        ],
      },
    ],
  },
  {
    id: 15,
    name: "Down of the Fool",
    cardKind: "trap",
    subtype: "normal",
    speed: 2,
    description:
      "When your opponent Normal Summons a monster with 1600 or more ATK: target that monster; destroy that target.",
    image: "assets/Down of the Fool.png",
    effects: [
      {
        id: "down_of_the_fool_destroy_summoned_monster",
        timing: "on_event",
        event: "after_summon",
        requireOpponentSummon: true,
        summonMethods: ["normal"],
        targets: [
          {
            id: "summoned_monster",
            owner: "opponent",
            targetFromContext: "summonedCard",
            cardKind: "monster",
            minAtk: 1600,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "destroy",
            targetRef: "summoned_monster",
          },
        ],
      },
    ],
  },
  {
    id: 16,
    name: "Ancient Tree Spirit",
    cardKind: "trap",
    subtype: "continuous",
    speed: 2,
    description:
      "Special Summon this card in Defense Position as an Effect Monster (Spirit/DARK/Level 4/ATK 1700/DEF 1900). This card is still treated as a Trap. If this card Special Summoned this way is destroyed by battle: inflict 500 damage to your opponent.",
    image: "assets/Ancient Tree Spirit.png",
    effects: [
      {
        id: "ancient_tree_spirit_summon",
        timing: "on_activate",
        actions: [
          {
            type: "special_summon_self_as_trap_monster",
            position: "defense",
            monster: {
              type: "Spirit",
              attribute: "Dark",
              level: 4,
              atk: 1700,
              def: 1900,
            },
            treatedAsCardKinds: ["monster", "trap"],
            summonProcedure: "trap_monster",
          },
        ],
      },
      {
        id: "ancient_tree_spirit_battle_destroy_damage",
        timing: "on_event",
        event: "battle_destroy",
        requireSelfAsDestroyed: true,
        requireSelfSummonProcedure: "trap_monster",
        promptUser: false,
        actions: [
          {
            type: "damage",
            player: "opponent",
            amount: 500,
          },
        ],
      },
    ],
  },
  {
    id: 17,
    name: "Court of the Dead",
    cardKind: "trap",
    subtype: "continuous",
    speed: 2,
    description:
      "Each time a monster is sent to either Graveyard: place 1 Funeral Counter on this card. Once per turn: You can remove 8 Funeral Counters from this card, then target 1 monster in either Graveyard; Special Summon it to your field.",
    image: "assets/Court of the Dead.png",
    effects: [
      {
        id: "court_of_the_dead_add_funeral_counter",
        timing: "on_event",
        event: "card_to_grave",
        requireZone: "spellTrap",
        requireFaceup: true,
        promptUser: false,
        eventCardFilters: {
          cardKind: "monster",
          toZone: "graveyard",
        },
        actions: [
          {
            type: "add_counter",
            targetRef: "self",
            counterType: "funeral",
            amount: 1,
          },
        ],
      },
      {
        id: "court_of_the_dead_revive",
        timing: "ignition",
        requireZone: "spellTrap",
        requireFaceup: true,
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "court_of_the_dead_revive",
        conditions: [
          {
            type: "source_counters_at_least",
            counterType: "funeral",
            min: 8,
          },
        ],
        targets: [
          {
            id: "court_revive_target",
            owner: "any",
            zone: "graveyard",
            cardKind: "monster",
            excludeCannotBeSpecialSummoned: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "remove_counter",
            targetRef: "self",
            counterType: "funeral",
            amount: 8,
            haltOnFailure: true,
          },
          {
            type: "special_summon_from_zone",
            targetRef: "court_revive_target",
            zone: "graveyard",
            scope: "both",
            position: "choice",
          },
        ],
      },
    ],
  },
  {
    id: 18,
    name: "Call of the Haunted",
    cardKind: "trap",
    subtype: "continuous",
    speed: 2,
    description:
      "Activate this card by targeting 1 monster in your GY; Special Summon that target in Attack Position. When this card leaves the field, destroy that target. When that target leaves the field, destroy this card.",
    image: "assets/Call of the Haunted.png",
    effects: [
      {
        id: "call_of_the_haunted_activate",
        timing: "on_activate",
        targets: [
          {
            id: "haunted_target",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            excludeCannotBeSpecialSummoned: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "call_of_haunted_summon_and_bind",
            targetRef: "haunted_target",
            position: "attack",
          },
        ],
        ui: {
          allowCancel: false,
        },
      },
    ],
  },
  {
    id: 19,
    name: "De-Synchro",
    cardKind: "spell",
    subtype: "normal",
    description:
      "Target 1 Synchro Monster on the field; return that target to the Extra Deck, then, if all the monsters that were used for the Synchro Summon of that monster are in your Graveyard, you can Special Summon them. You can only activate 1 \"De-Synchro\" per turn.",
    image: "assets/De-Synchro.png",
    effects: [
      {
        id: "de_synchro_activation",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "de_synchro_activation",
        targets: [
          {
            id: "de_synchro_target",
            owner: "any",
            zone: "field",
            cardKind: "monster",
            monsterType: "synchro",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "de_synchro",
            targetRef: "de_synchro_target",
            position: "choice",
            contextLabel: "de_synchro_return",
            reviveContextLabel: "de_synchro_material_summon",
          },
        ],
      },
    ],
  },
  {
    id: 20,
    name: "Fusion Recycle",
    cardKind: "spell",
    subtype: "normal",
    description:
      "Target 1 monster in your GY that was sent there as Fusion Material this turn; add it to your hand. If that monster is Level 4 or lower, you can Special Summon it in Defense Position, but negate its effects until the end of this turn. You can only activate 1 \"Fusion Recycle\" per turn.",
    image: "assets/Fusion Recycle.png",
    effects: [
      {
        id: "fusion_recycle_activation",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "fusion_recycle_activation",
        targets: [
          {
            id: "fusion_recycle_target",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            filters: {
              sentToGraveAsMaterial: "fusion",
              sentToGraveAsMaterialThisTurn: true,
              excludeMonsterTypes: ["fusion", "synchro", "ascension"],
            },
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "fusion_recycle_target",
            player: "self",
            fromZone: "graveyard",
            to: "hand",
            contextLabel: "fusion_recycle_add_to_hand",
            storeResultAs: "fusion_recycle_added_monster",
          },
          {
            type: "optional_target_actions",
            targets: [],
            actions: [
              {
                type: "special_summon_from_zone",
                targetRef: "fusion_recycle_added_monster",
                zone: "hand",
                position: "defense",
                promptPlayer: false,
                filters: {
                  cardKind: "monster",
                  maxLevel: 4,
                },
                negateEffects: true,
                negateEffectsDuration: "until_end_turn",
              },
            ],
            conditions: [
              {
                type: "targetRefMatchesFilters",
                targetRef: "fusion_recycle_added_monster",
                zones: ["hand"],
                filters: {
                  cardKind: "monster",
                  maxLevel: 4,
                },
                reason:
                  "The added monster is not a Level 4 or lower monster in your hand.",
              },
              {
                type: "playerFieldCount",
                max: 4,
                reason: "No open Monster Zone.",
              },
            ],
            optional: true,
            requireConfirmation: true,
            promptMessage:
              "Special Summon the added monster in Defense Position?",
            confirmLabel: "Special Summon",
            cancelLabel: "Keep in hand",
          },
        ],
      },
    ],
  },
  {
    id: 21,
    name: "Natural Selection",
    cardKind: "spell",
    subtype: "quick",
    speed: 2,
    description:
      "Discard 1 card, then target 1 face-up card your opponent controls; destroy that target. You can only activate 1 \"Natural Selection\" per turn.",
    image: "assets/Natural Selection.png",
    effects: [
      {
        id: "natural_selection_activation",
        timing: "on_play",
        speed: 2,
        oncePerTurn: true,
        oncePerTurnName: "natural_selection_activation",
        actions: [
          {
            type: "discard_from_hand",
            player: "self",
            count: { min: 1, max: 1 },
            contextLabel: "natural_selection_cost",
            selectionMessage: "Choose 1 card to discard for Natural Selection.",
          },
          {
            type: "destroy_targeted_cards",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            minTargets: 1,
            maxTargets: 1,
          },
        ],
      },
    ],
  },
  {
    id: 22,
    name: "Desperate Gamble",
    cardKind: "spell",
    subtype: "normal",
    description:
      "Pay half your LP; draw 2 cards. For the rest of this turn, you cannot activate effects of cards with the same names as the cards drawn by this effect. You can only activate 1 \"Desperate Gamble\" per turn.",
    image: "assets/Desperate Gamble.png",
    effects: [
      {
        id: "desperate_gamble_activation",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "desperate_gamble_activation",
        actions: [
          {
            type: "pay_lp",
            player: "self",
            fraction: 0.5,
          },
          {
            type: "draw",
            player: "self",
            amount: 2,
          },
          {
            type: "restrict_effect_activations_by_names",
            player: "self",
            nameSource: "lastDrawnCards",
            duration: "until_end_turn",
          },
        ],
      },
    ],
  },
  {
    id: 23,
    name: "Guardian Deity Visas",
    cardKind: "monster",
    atk: 1900,
    def: 1900,
    level: 5,
    type: "Fairy",
    attribute: "Light",
    description:
      'When your opponent activates a card or effect that would banish one or more cards from your field and/or GY (Quick Effect): you can Special Summon this card from your hand, and if you do, negate that effect. You can only use this effect of "Guardian Deity Visas" once per turn.',
    image: "assets/Guardian Deity Visas.png",
    effects: [
      {
        id: "guardian_deity_visas_hand_negate_banish",
        timing: "manual",
        speed: 2,
        isQuickEffect: true,
        requireZone: "hand",
        canRespondTo: ["card_activation", "effect_activation"],
        oncePerTurn: true,
        oncePerTurnName: "guardian_deity_visas",
        conditions: [
          {
            type: "activation_would_banish_cards_matching_filters",
            activationPlayer: "opponent",
            affectedPlayer: "self",
            zones: ["field", "spellTrap", "fieldSpell", "graveyard"],
            minCount: 1,
          },
        ],
        actions: [
          {
            type: "special_summon_from_zone",
            zone: "hand",
            requireSource: true,
            position: "choice",
            haltOnFailure: true,
          },
          { type: "negate_activation" },
        ],
      },
    ],
  },
  {
    id: 24,
    name: "Luminous God Hyperion",
    cardKind: "monster",
    atk: 3000,
    def: 3000,
    level: 9,
    type: "Warrior",
    attribute: "Light",
    description:
      "You can Special Summon this card from your hand by banishing 5 LIGHT monsters from your field and/or GY. If Summoned this way, this card cannot be destroyed by your opponent's card effects. During damage calculation, if this card battles an opponent's DARK monster: it gains 1000 ATK/DEF during that damage calculation only.",
    image: "assets/Luminous God Hyperion.png",
    effects: [
      {
        id: "luminous_god_hyperion_special_summon",
        timing: "ignition",
        requireZone: "hand",
        requirePhase: ["main1", "main2"],
        targets: [
          {
            id: "luminous_god_hyperion_light_banish_cost",
            owner: "self",
            zones: ["field", "graveyard"],
            cardKind: "monster",
            attribute: "Light",
            intent: "cost",
            count: { min: 5, max: 5 },
          },
        ],
        actions: [
          {
            type: "special_summon_from_hand_with_cost",
            costTargetRef: "luminous_god_hyperion_light_banish_cost",
            costDestination: "banish",
            costMovedByEffect: false,
            position: "choice",
            conditionalMarkersOnSummon: [
              {
                key: "luminous_god_hyperion_summoned_by_own_procedure",
                min: 5,
                costFilters: {
                  cardKind: "monster",
                  attribute: "Light",
                },
                bindToFieldPresence: true,
              },
            ],
          },
        ],
      },
      {
        id: "luminous_god_hyperion_grant_opponent_effect_protection",
        timing: "on_event",
        event: "after_summon",
        requireSelfAsSummoned: true,
        requireFaceup: true,
        promptUser: false,
        conditions: [
          {
            type: "summoned_card_has_marker",
            key: "luminous_god_hyperion_summoned_by_own_procedure",
            sourceEffectId: "luminous_god_hyperion_special_summon",
            minMatchingCostCount: 5,
          },
        ],
        actions: [
          {
            type: "grant_protection",
            targetRef: "self",
            protectionType: "effect_destruction",
            duration: "while_faceup",
            sourceOwner: "opponent",
            removeOnLeave: true,
          },
        ],
      },
      {
        id: "luminous_god_hyperion_attack_dark_boost",
        timing: "on_event",
        event: "battle_damage",
        requireZone: "field",
        requireFaceup: true,
        requireSelfAsAttacker: true,
        promptUser: false,
        conditions: [
          {
            type: "battle_participant_matches_filters",
            owner: "opponent",
            filters: {
              cardKind: "monster",
              attribute: "Dark",
            },
          },
        ],
        actions: [
          {
            type: "buff_stats_temp",
            targetRef: "self",
            atkBoost: 1000,
            defBoost: 1000,
            duration: "damage_calculation",
          },
        ],
      },
      {
        id: "luminous_god_hyperion_defense_dark_boost",
        timing: "on_event",
        event: "battle_damage",
        requireZone: "field",
        requireFaceup: true,
        requireSelfAsDefender: true,
        promptUser: false,
        conditions: [
          {
            type: "battle_participant_matches_filters",
            owner: "opponent",
            filters: {
              cardKind: "monster",
              attribute: "Dark",
            },
          },
        ],
        actions: [
          {
            type: "buff_stats_temp",
            targetRef: "self",
            atkBoost: 1000,
            defBoost: 1000,
            duration: "damage_calculation",
          },
        ],
      },
    ],
  },
  {
    id: 25,
    name: "Battle Between Good and Evil",
    cardKind: "spell",
    subtype: "normal",
    description:
      "Special Summon 1 Level 4 or lower LIGHT or DARK monster from your Deck, but negate its effects. For the rest of this turn after this effect resolves, you cannot activate monster effects, except monster effects with the same Attribute as the monster Summoned by this effect. You can only activate 1 \"Battle Between Good and Evil\" per turn.",
    image: "assets/Battle Between Good and Evil.png",
    effects: [
      {
        id: "battle_between_good_and_evil_activation",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "battle_between_good_and_evil_activation",
        targets: [
          {
            id: "battle_between_good_and_evil_summon_target",
            owner: "self",
            zone: "deck",
            cardKind: "monster",
            attribute: ["Light", "Dark"],
            maxLevel: 4,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "special_summon_from_zone",
            targetRef: "battle_between_good_and_evil_summon_target",
            zone: "deck",
            position: "choice",
            negateEffects: true,
            negateEffectsDuration: "while_faceup",
            storeResultAs: "battle_between_good_and_evil_summoned",
            haltOnFailure: true,
          },
          {
            type: "restrict_effect_activations_by_attribute",
            player: "self",
            attributeSourceRef: "battle_between_good_and_evil_summoned",
            restrictedCardFilters: { cardKind: "monster" },
            duration: "until_end_turn",
          },
        ],
      },
    ],
  },
  {
    id: 26,
    name: "Misty Katana Ghost Samurai",
    cardKind: "monster",
    atk: 1700,
    def: 0,
    level: 4,
    type: "Zombie",
    attribute: "Water",
    description:
      'If this card is Normal Summoned: You can send 1 Tuner monster from your Deck to the Graveyard. You can banish this card from your Graveyard, then target 1 Level 4 or lower Tuner monster in your Graveyard; Special Summon it. You can only use each effect of "Misty Katana Ghost Samurai" once per turn.',
    image: "assets/Misty Katana Ghost Samurai.png",
    effects: [
      {
        id: "misty_katana_ghost_samurai_send_tuner",
        timing: "on_event",
        event: "after_summon",
        requireSelfAsSummoned: true,
        summonMethods: ["normal"],
        promptUser: true,
        promptMessage:
          'Activate "Misty Katana Ghost Samurai" to send 1 Tuner from your Deck to the Graveyard?',
        oncePerTurn: true,
        oncePerTurnName: "misty_katana_ghost_samurai_send_tuner",
        targets: [
          {
            id: "misty_katana_ghost_samurai_deck_tuner",
            owner: "self",
            zone: "deck",
            cardKind: "monster",
            isTuner: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "misty_katana_ghost_samurai_deck_tuner",
            player: "self",
            fromZone: "deck",
            to: "graveyard",
            contextLabel: "misty_katana_ghost_samurai_send_tuner",
          },
        ],
      },
      {
        id: "misty_katana_ghost_samurai_revive_tuner",
        timing: "ignition",
        requireZone: "graveyard",
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "misty_katana_ghost_samurai_revive_tuner",
        actions: [
          {
            type: "special_summon_from_zone",
            zone: "graveyard",
            filters: {
              cardKind: "monster",
              isTuner: true,
              maxLevel: 4,
            },
            count: { min: 1, max: 1 },
            banishCost: true,
            position: "choice",
            promptPlayer: true,
          },
        ],
      },
    ],
  },
];
