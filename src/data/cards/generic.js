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
        triggerRequirement: "mandatory",
        triggerTiming: "if",
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
        triggerRequirement: "mandatory",
        triggerTiming: "when",
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
        triggerRequirement: "mandatory",
        triggerTiming: "if",
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
        triggerRequirement: "mandatory",
        triggerTiming: "if",
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
        triggerRequirement: "mandatory",
        triggerTiming: "if",
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
        triggerRequirement: "optional",
        triggerTiming: "when",
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
        triggerRequirement: "optional",
        triggerTiming: "when",
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
        triggerRequirement: "optional",
        triggerTiming: "when",
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
        triggerRequirement: "mandatory",
        triggerTiming: "if",
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
        triggerRequirement: "mandatory",
        triggerTiming: "if",
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

        activationZones: ["spellTrap"],

        usagePolicy: "activate",
        id: "court_of_the_dead_revive",
        timing: "ignition",
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

        usagePolicy: "activate",
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

        usagePolicy: "activate",
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
        usagePolicy: "activate",
        targets: [
          {
            id: "natural_selection_cost",
            owner: "self",
            zone: "hand",
            count: { min: 1, max: 1 },
            intent: "cost",
          },
          {
            id: "natural_selection_target",
            owner: "opponent",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        activationCosts: [
          {
            type: "move",
            targetRef: "natural_selection_cost",
            player: "self",
            fromZone: "hand",
            to: "graveyard",
            contextLabel: "natural_selection_cost",
          },
        ],
        actions: [
          {
            type: "destroy_targeted_cards",
            targetRef: "natural_selection_target",
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

        usagePolicy: "activate",
        id: "desperate_gamble_activation",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "desperate_gamble_activation",
        activationCosts: [
          {
            type: "pay_lp",
            player: "self",
            fraction: 0.5,
          },
        ],
        actions: [
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

        activationZones: ["hand"],
        id: "guardian_deity_visas_hand_negate_banish",
        timing: "manual",
        speed: 2,
        isQuickEffect: true,
        canRespondTo: ["card_activation", "effect_activation"],
        oncePerTurn: true,
        oncePerTurnName: "guardian_deity_visas",
        usagePolicy: "use",
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
          { type: "negate_effect" },
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

        activationZones: ["hand"],
        id: "luminous_god_hyperion_special_summon",
        timing: "ignition",
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
        triggerRequirement: "mandatory",
        triggerTiming: "if",
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

        activationLabelKey: "effects.hyperion.attackBoost",
        id: "luminous_god_hyperion_attack_dark_boost",
        timing: "on_event",
        triggerRequirement: "mandatory",
        triggerTiming: "if",
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

        activationLabelKey: "effects.hyperion.defenseBoost",
        id: "luminous_god_hyperion_defense_dark_boost",
        timing: "on_event",
        triggerRequirement: "mandatory",
        triggerTiming: "if",
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

        usagePolicy: "activate",
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

        usagePolicy: "use",
        id: "misty_katana_ghost_samurai_send_tuner",
        timing: "on_event",
        triggerRequirement: "optional",
        triggerTiming: "if",
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

        activationZones: ["graveyard"],

        usagePolicy: "use",
        id: "misty_katana_ghost_samurai_revive_tuner",
        timing: "ignition",
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
  {
    id: 27,
    name: "Magmatic Obsidian Leviathan",
    cardKind: "monster",
    monsterType: "synchro",
    atk: 2900,
    def: 3300,
    level: 9,
    type: "Rock",
    attribute: "Earth",
    synchro: {
      tunerCount: 1,
      nonTunerMin: 1,
      materialFilters: {
        tuner: { attribute: "Earth", isTuner: true },
      },
    },
    description:
      '1 EARTH Tuner + 1+ non-Tuner monsters\nYou can discard 1 card, then target 1 face-up monster your opponent controls (Quick Effect); change it to face-down Defense Position. Monsters changed to face-down Defense Position by this effect cannot change their battle positions.\nIf this card is destroyed by battle or card effect: You can target up to 2 Level 3 or lower EARTH monsters in your Graveyard; Special Summon them.\nYou can only use each effect of "Magmatic Obsidian Leviathan" once per turn.',
    image: "assets/Magmatic Obsidian Leviathan.png",
    effects: [
      {
        id: "magmatic_obsidian_leviathan_facedown_lock",
        timing: "manual",
        speed: 2,
        isQuickEffect: true,
        activationZones: ["field"],
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "magmatic_obsidian_leviathan_facedown_lock",
        usagePolicy: "use",
        targets: [
          {
            id: "magmatic_obsidian_leviathan_discard_cost",
            owner: "self",
            zone: "hand",
            count: { min: 1, max: 1 },
            intent: "cost",
          },
          {
            id: "magmatic_obsidian_leviathan_facedown_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        activationCosts: [
          {
            type: "move",
            targetRef: "magmatic_obsidian_leviathan_discard_cost",
            player: "self",
            fromZone: "hand",
            to: "graveyard",
            contextLabel: "magmatic_obsidian_leviathan_discard_cost",
          },
        ],
        actions: [
          {
            type: "set_facedown_defense",
            targetRef: "magmatic_obsidian_leviathan_facedown_target",
            lockBattlePosition: true,
          },
        ],
      },
      {
        id: "magmatic_obsidian_leviathan_destroyed_revive",
        timing: "on_event",
        triggerRequirement: "optional",
        triggerTiming: "if",
        event: "card_to_grave",
        fromZone: "field",
        requireSelfAsDestroyed: true,
        condition: { type: "destroyed_by_battle_or_effect" },
        promptUser: true,
        promptMessage:
          'Activate "Magmatic Obsidian Leviathan" to Special Summon up to 2 Level 3 or lower EARTH monsters from your Graveyard?',
        oncePerTurn: true,
        oncePerTurnName: "magmatic_obsidian_leviathan_destroyed_revive",
        usagePolicy: "use",
        targets: [
          {
            id: "magmatic_obsidian_leviathan_revive_targets",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            attribute: "Earth",
            maxLevel: 3,
            count: { min: 1, max: 2 },
          },
        ],
        actions: [
          {
            type: "special_summon_from_zone",
            targetRef: "magmatic_obsidian_leviathan_revive_targets",
            zone: "graveyard",
            position: "choice",
          },
        ],
      },
    ],
  },
  {
    id: 28,
    name: "Rose Petal Floral Dragon",
    cardKind: "monster",
    monsterType: "synchro",
    atk: 2500,
    def: 1700,
    level: 7,
    type: "Dragon",
    attribute: "Earth",
    synchro: {
      tunerCount: 1,
      nonTunerMin: 1,
      materialFilters: {
        tuner: { type: "Plant", isTuner: true },
      },
    },
    description:
      '1 Plant Tuner + 1+ non-Tuner monsters\nIf your opponent controls more cards than you do: You can banish 1 to 3 Plant monsters from your GY; target the same number of cards your opponent controls; destroy them.\nIf this card leaves the field: You can target 1 Plant monster in your GY; add it to your hand.\nYou can only use each effect of "Rose Petal Floral Dragon" once per turn.',
    image: "assets/Rose Petal Floral Dragon.png",
    effects: [
      {
        id: "rose_petal_floral_dragon_banish_destroy",
        timing: "ignition",
        speed: 1,
        activationZones: ["field"],
        requireFaceup: true,
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "rose_petal_floral_dragon_banish_destroy",
        usagePolicy: "use",
        conditions: [
          {
            type: "field_card_count_comparison",
            leftOwner: "opponent",
            rightOwner: "self",
            operator: "gt",
            zones: ["field", "spellTrap", "fieldSpell"],
          },
        ],
        targets: [
          {
            id: "rose_petal_floral_dragon_banish_cost",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            type: "Plant",
            count: { min: 1, max: 3 },
            intent: "cost",
          },
          {
            id: "rose_petal_floral_dragon_destroy_targets",
            owner: "opponent",
            zones: ["field", "spellTrap", "fieldSpell"],
            count: { min: 1, max: 3 },
            countFromSelectionRef: "rose_petal_floral_dragon_banish_cost",
            minAtResolution: 0,
          },
        ],
        activationCosts: [
          {
            type: "banish",
            targetRef: "rose_petal_floral_dragon_banish_cost",
            fromZone: "graveyard",
          },
        ],
        actions: [
          {
            type: "destroy_targeted_cards",
            targetRef: "rose_petal_floral_dragon_destroy_targets",
          },
        ],
      },
      {
        id: "rose_petal_floral_dragon_leave_field_recover",
        timing: "on_event",
        triggerRequirement: "optional",
        triggerTiming: "if",
        event: "card_moved",
        fromZone: "field",
        toZone: "any",
        requireSelfAsMoved: true,
        requireMovedCardWasFaceup: true,
        promptUser: true,
        promptMessage:
          'Activate "Rose Petal Floral Dragon" to add 1 Plant monster from your Graveyard to your hand?',
        oncePerTurn: true,
        oncePerTurnName: "rose_petal_floral_dragon_leave_field_recover",
        usagePolicy: "use",
        targets: [
          {
            id: "rose_petal_floral_dragon_recover_target",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            type: "Plant",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "rose_petal_floral_dragon_recover_target",
            player: "self",
            fromZone: "graveyard",
            to: "hand",
          },
        ],
      },
    ],
  },
  {
    id: 29,
    name: "Cursed Rock Behemoth",
    cardKind: "monster",
    monsterType: "synchro",
    atk: 2300,
    def: 2400,
    level: 7,
    type: "Rock",
    attribute: "Earth",
    synchro: {
      tunerCount: 1,
      nonTunerMin: 1,
      materialFilters: {
        tuner: { attribute: "Earth", isTuner: true },
      },
    },
    description:
      '1 EARTH Tuner + 1+ non-Tuner monsters\nOnce per turn: You can target 1 monster your opponent controls; this card gains ATK equal to that monster\'s original DEF until the end of this turn.\nIf this card is destroyed by battle: You can target the monster that destroyed it; take control of it until the End Phase, then, when that monster leaves the field, Special Summon this card from your GY, but banish it when it leaves the field.\nYou can only use each effect of "Cursed Rock Behemoth" once per turn.',
    image: "assets/Cursed Rock Behemoth.png",
    effects: [
      {
        id: "cursed_rock_behemoth_gain_original_def",
        timing: "ignition",
        speed: 1,
        activationZones: ["field"],
        requireFaceup: true,
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "cursed_rock_behemoth_gain_original_def",
        usagePolicy: "use",
        targets: [
          {
            id: "cursed_rock_behemoth_atk_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "buff_stats_temp",
            targetRef: "self",
            atkBoostFromTarget: {
              targetRef: "cursed_rock_behemoth_atk_target",
              stat: "baseDef",
            },
            duration: "end_of_turn",
          },
        ],
      },
      {
        id: "cursed_rock_behemoth_battle_control",
        timing: "on_event",
        triggerRequirement: "optional",
        triggerTiming: "if",
        event: "battle_destroy",
        requireSelfAsDestroyed: true,
        promptUser: true,
        promptMessage:
          'Activate "Cursed Rock Behemoth" to take control of the monster that destroyed it?',
        oncePerTurn: true,
        oncePerTurnName: "cursed_rock_behemoth_battle_control",
        usagePolicy: "use",
        targets: [
          {
            id: "cursed_rock_behemoth_destroyer",
            targetFromContext: "battleDestroyer",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "take_control",
            targetRef: "cursed_rock_behemoth_destroyer",
            player: "self",
            duration: "until_end_phase",
            contextLabel: "cursed_rock_behemoth_battle_control",
          },
          {
            type: "register_temporary_event_effect",
            event: "card_moved",
            triggerRequirement: "mandatory",
            triggerTiming: "if",
            bindEventTargetRef: "cursed_rock_behemoth_destroyer",
            requireBoundTargetLeavesField: true,
            duration: "until_consumed",
            uses: 1,
            effectId: "cursed_rock_behemoth_bound_destroyer_left_field",
            actions: [
              {
                type: "special_summon_from_zone",
                targetRef: "self",
                zone: "graveyard",
                position: "choice",
                statusesOnSummon: [{ status: "banishWhenLeavesField" }],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 30,
    name: "Red Fury Horror",
    cardKind: "monster",
    monsterType: "synchro",
    atk: 2700,
    def: 1800,
    level: 8,
    type: "Fiend",
    attribute: "Earth",
    synchro: {
      tunerCount: 1,
      nonTunerMin: 1,
    },
    description:
      "1 Tuner + 1+ non-Tuner monsters\nOnce per turn, if your opponent Special Summons a monster: You can target 1 monster in their GY; banish it, and if you do, this card gains 300 ATK.",
    image: "assets/Red Fury Horror.png",
    effects: [
      {
        id: "red_fury_horror_banish_and_gain",
        timing: "on_event",
        triggerRequirement: "optional",
        triggerTiming: "if",
        event: "after_summon",
        requireZone: "field",
        requireFaceup: true,
        requireOpponentSummon: true,
        summonMethods: ["special", "fusion", "synchro", "ascension"],
        promptUser: true,
        promptMessage:
          'Activate "Red Fury Horror" to banish 1 monster from your opponent\'s Graveyard and gain 300 ATK?',
        oncePerTurn: true,
        oncePerTurnScope: "card",
        oncePerTurnName: "red_fury_horror_banish_and_gain",
        usagePolicy: "activate",
        targets: [
          {
            id: "red_fury_horror_graveyard_target",
            owner: "opponent",
            zone: "graveyard",
            cardKind: "monster",
            count: { min: 1, max: 1 },
            minAtResolution: 0,
          },
        ],
        actions: [
          {
            type: "banish",
            targetRef: "red_fury_horror_graveyard_target",
            fromZone: "graveyard",
            haltOnFailure: true,
          },
          {
            type: "permanent_buff_named",
            targetRef: "self",
            sourceName: "red_fury_horror_banish_and_gain",
            atkBoost: 300,
            cumulative: true,
          },
        ],
      },
    ],
  },
  {
    id: 31,
    name: "Iron Smasher",
    cardKind: "monster",
    monsterType: "synchro",
    atk: 2400,
    def: 2400,
    level: 6,
    type: "Warrior",
    attribute: "Earth",
    synchro: {
      tunerCount: 1,
      nonTunerMin: 1,
    },
    description:
      "1 Tuner + 1+ non-Tuner monsters\nWhile you control another EARTH monster, this card cannot be destroyed by card effects. Once per turn, when your opponent activates a card or effect that would destroy 1 or more cards you control (Quick Effect): You can target 1 face-down card they control; destroy it.",
    image: "assets/Iron Smasher.png",
    effects: [
      {
        id: "iron_smasher_effect_destruction_protection",
        timing: "passive",
        requireZone: "field",
        requireFaceup: true,
        passive: {
          type: "conditional_protection",
          protectionType: "effect_destruction",
        },
        conditions: [
          {
            type: "control_card_filters",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            attribute: "Earth",
            requireFaceup: true,
            excludeSource: true,
            min: 1,
          },
        ],
      },
      {
        id: "iron_smasher_destroy_facedown_response",
        timing: "manual",
        speed: 2,
        isQuickEffect: true,
        activationZones: ["field"],
        requireFaceup: true,
        canRespondTo: ["card_activation", "effect_activation"],
        oncePerTurn: true,
        oncePerTurnScope: "card",
        oncePerTurnName: "iron_smasher_destroy_facedown_response",
        usagePolicy: "activate",
        conditions: [
          {
            type: "activation_would_destroy_cards_matching_filters",
            activationPlayer: "opponent",
            affectedPlayer: "self",
            destroyedCardZones: ["field", "spellTrap", "fieldSpell"],
            destroyedCardFilters: {},
            minCount: 1,
          },
        ],
        targets: [
          {
            id: "iron_smasher_facedown_target",
            owner: "opponent",
            zones: ["field", "spellTrap", "fieldSpell"],
            filters: { facedown: true },
            count: { min: 1, max: 1 },
            minAtResolution: 0,
          },
        ],
        actions: [
          {
            type: "destroy_targeted_cards",
            targetRef: "iron_smasher_facedown_target",
          },
        ],
      },
    ],
  },
  {
    id: 32,
    name: "Orathus, The Fallen Angel",
    cardKind: "monster",
    monsterType: "synchro",
    atk: 3200,
    def: 2800,
    level: 10,
    type: "Warrior",
    attribute: "Earth",
    mustFirstBeSpecialSummonedBy: ["synchro"],
    mustBeAttacked: true,
    synchro: {
      tunerCount: 1,
      nonTunerMin: 1,
      materialFilters: {
        nonTuner: {
          monsterType: "synchro",
          attribute: "Earth",
        },
      },
    },
    description:
      "1 Tuner + 1+ non-Tuner EARTH Synchro Monsters\nMust first be Synchro Summoned. If this card is Synchro Summoned: You can target 1 face-up card your opponent controls; negate its effects while it remains face-up on the field. Your opponent must target this card for attacks, if able. Once per turn: You can target 1 monster your opponent controls that was Summoned from the Extra Deck; destroy it, and if you activate this effect, this card cannot attack this turn.",
    image: "assets/Orathus, The Fallen Angel.png",
    effects: [
      {
        id: "orathus_synchro_summon_negate",
        timing: "on_event",
        triggerRequirement: "optional",
        triggerTiming: "if",
        event: "after_summon",
        requireSelfAsSummoned: true,
        requireFaceup: true,
        summonMethods: ["synchro"],
        promptUser: true,
        promptMessage:
          'Activate "Orathus, The Fallen Angel" to negate 1 face-up card your opponent controls?',
        targets: [
          {
            id: "orathus_negate_target",
            owner: "opponent",
            zones: ["field", "spellTrap", "fieldSpell"],
            requireFaceup: true,
            count: { min: 1, max: 1 },
            minAtResolution: 0,
          },
        ],
        actions: [
          {
            type: "add_status",
            targetRef: "orathus_negate_target",
            status: "effectsNegated",
            value: true,
            duration: "while_faceup",
          },
        ],
      },
      {
        id: "orathus_destroy_extra_deck_summoned_monster",
        timing: "ignition",
        speed: 1,
        activationZones: ["field"],
        requireFaceup: true,
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnScope: "card",
        oncePerTurnName: "orathus_destroy_extra_deck_summoned_monster",
        usagePolicy: "activate",
        conditions: [
          {
            type: "context_number_compare",
            key: "source.attacksUsedThisTurn",
            op: "eq",
            value: 0,
            reason: "Orathus cannot activate this effect after attacking this turn.",
          },
        ],
        targets: [
          {
            id: "orathus_destroy_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            lastSummonedFromZone: "extraDeck",
            count: { min: 1, max: 1 },
            minAtResolution: 0,
          },
        ],
        activationCommitActions: [{ type: "forbid_attack_this_turn" }],
        actions: [
          {
            type: "destroy_targeted_cards",
            targetRef: "orathus_destroy_target",
          },
        ],
      },
    ],
  },
  {
    id: 33,
    name: "The Black Flame",
    cardKind: "spell",
    subtype: "normal",
    description:
      'Pay 1000 LP; for the rest of this Duel, inflict 300 damage to your opponent during each Standby Phase. You can only activate 1 "The Black Flame" per turn.',
    image: "assets/The Black Flame.png",
    effects: [
      {
        id: "the_black_flame_activation",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "the_black_flame_activation",
        usagePolicy: "activate",
        activationCosts: [
          {
            type: "pay_lp",
            player: "self",
            amount: 1000,
          },
        ],
        actions: [
          {
            type: "register_temporary_event_effect",
            event: "standby_phase",
            triggerRequirement: "mandatory",
            triggerTiming: "if",
            duration: "duel",
            unlimitedUses: true,
            effectId: "the_black_flame_standby_burn",
            promptUser: false,
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
    ],
  },
];
