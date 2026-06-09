export const arcanistCards = [
  {
    id: 301,
    name: "Grimoire of the Apprentice Arcanist",
    cardKind: "spell",
    subtype: "equip",
    archetype: "Arcanist",
    description:
      'Equip only to an "Arcanist" monster you control.\nOnce per turn: you can activate 1 of the effects stored in this card.\nIf an "Arcanist" Spell you activated resolves: you can store that Spell\'s effect in this card (max. 1).\nIf this card already has 1 stored effect, you can store the new effect instead.\nYou can only control 1 "Grimoire of the Apprentice Arcanist".',
    image: "assets/Grimoire of the Apprentice Arcanist.png",
    blueprintStorage: {
      maxSlots: 1,
      allowedArchetypes: ["Arcanist"],
      allowedCardKinds: ["spell"],
      storableEffectFlag: "storableByGrimoire",
      allowOverwrite: true,
      promptOnStore: true,
      autoStoreForAI: true,
    },
    effects: [
      {
        id: "arcanist_grimoire_equip",
        timing: "on_play",
        speed: 1,
        conditions: [
          {
            type: "control_card_max",
            zone: "spellTrap",
            max: 0,
            includeFacedown: true,
            filters: { cardId: 301 },
            excludeSource: true,
            reason:
              'You can only control 1 "Grimoire of the Apprentice Arcanist".',
          },
        ],
        targets: [
          {
            id: "grimoire_equip_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Arcanist",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "equip",
            targetRef: "grimoire_equip_target",
          },
        ],
      },
      {
        id: "arcanist_grimoire_activate_stored",
        timing: "ignition",
        requireZone: "spellTrap",
        oncePerTurn: true,
        oncePerTurnName: "arcanist_grimoire_activate_stored",
        conditions: [{ type: "has_stored_blueprint" }],
        actions: [{ type: "activate_stored_blueprint" }],
      },
    ],
  },
  {
    id: 302,
    name: "Arcanist Apprentice",
    cardKind: "monster",
    atk: 1500,
    def: 1000,
    level: 3,
    type: "Spellcaster",
    attribute: "Light",
    archetype: "Arcanist",
    description:
      'If this card is Normal Summoned: You can add 1 "Arcanist" Spell from your Deck to your hand. If this card is equipped with an "Arcanist" Equip Spell: All "Arcanist" monsters you control gain 300 ATK while this card is face-up on the field. You can only activate each effect of "Arcanist Apprentice" once per turn.',
    image: "assets/Arcanist Apprentice.png",
    effects: [
      {
        id: "arcanist_apprentice_search_spell",
        timing: "on_event",
        event: "after_summon",
        requireSelfAsSummoned: true,
        summonMethods: ["normal"],
        oncePerTurn: true,
        oncePerTurnName: "arcanist_apprentice_search_spell",
        actions: [
          {
            type: "search_any",
            archetype: "Arcanist",
            cardKind: "spell",
            player: "self",
          },
        ],
      },
      {
        id: "arcanist_apprentice_equip_aura",
        timing: "passive",
        requireFaceup: true,
        passive: {
          type: "field_archetype_aura_buff",
          archetype: "Arcanist",
          targetOwners: ["self"],
          targetCardKinds: ["monster"],
          targetRequireFaceup: true,
          sourceFilters: {
            equippedWithFilters: {
              cardKind: "spell",
              subtype: "equip",
              archetype: "Arcanist",
            },
          },
          atkBoost: 300,
        },
      },
    ],
  },
  {
    id: 303,
    name: "Arcanist Crimson Explosion",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Arcanist",
    description:
      'Target 1 "Arcanist" monster you control and 1 monster your opponent controls; destroy those targets, and if you do, each player takes damage equal to half the ATK of the monster they controlled that was destroyed. If you control an "Arcanist" Equip Spell, you take no damage from this effect.',
    image: "assets/Arcanist Crimson Explosion.png",
    effects: [
      {
        id: "crimson_magic_explosion_effect",
        timing: "on_play",
        speed: 1,
        storableByGrimoire: true,
        targets: [
          {
            id: "crimson_magic_self_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Arcanist",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
          {
            id: "crimson_magic_opponent_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "destroy_and_damage_by_target_atk",
            entries: [
              {
                targetRef: "crimson_magic_self_target",
                damagePlayer: "owner",
                multiplier: 0.5,
              },
              {
                targetRef: "crimson_magic_opponent_target",
                damagePlayer: "owner",
                multiplier: 0.5,
              },
            ],
            skipDamageIf: {
              self: [
                {
                  type: "control_card_filters",
                  owner: "self",
                  zone: "spellTrap",
                  cardKind: "spell",
                  subtype: "equip",
                  archetype: "Arcanist",
                  requireFaceup: true,
                },
              ],
            },
          },
        ],
      },
    ],
  },
  {
    id: 304,
    name: "Arcanist Lightning Lance",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Arcanist",
    description:
      'Target 1 face-up monster on the field; apply the appropriate effect depending on who controls that target. If it is an "Arcanist" monster you control: it gains 500 ATK and if it battles a Defense Position monster this turn, inflict piercing battle damage to your opponent. If it is a monster your opponent controls: it cannot declare an attack until the end of your opponent\'s next turn. You can only activate 1 "Arcanist Lightning Lance" per turn.',
    image: "assets/Lightning Magic Lance.png",
    effects: [
      {
        id: "lightning_magic_lance_effect",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "lightning_magic_lance_effect",
        storableByGrimoire: true,
        targets: [
          {
            id: "lightning_magic_lance_target",
            owner: "any",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            anyOf: [
              { owner: "self", archetype: "Arcanist" },
              { owner: "opponent" },
            ],
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "conditional_target_actions",
            targetRef: "lightning_magic_lance_target",
            cases: [
              {
                filters: { owner: "self", archetype: "Arcanist" },
                actions: [
                  {
                    type: "buff_stats_temp",
                    targetRef: "lightning_magic_lance_target",
                    atkBoost: 500,
                    defBoost: 0,
                  },
                  {
                    type: "add_status",
                    targetRef: "lightning_magic_lance_target",
                    status: "piercing",
                    value: true,
                    untilEndOfTurn: true,
                  },
                ],
              },
              {
                filters: { owner: "opponent" },
                actions: [
                  {
                    type: "forbid_attack_next_turn",
                    targetRef: "lightning_magic_lance_target",
                    turns: 1,
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
    id: 305,
    name: "Viridis, Arcanist of Life",
    cardKind: "monster",
    atk: 1600,
    def: 1500,
    level: 4,
    type: "Spellcaster",
    attribute: "Wind",
    archetype: "Arcanist",
    description:
      'Once per turn: You can target 1 face-up Spell your opponent controls; return it to the hand, and if you do, gain 500 LP.\nIf this card becomes equipped with an "Arcanist" Equip Spell: You can target 1 Spell in your GY; add it to your hand.\nYou can only use each effect of "Viridis, Arcanist of Life" once per turn.',
    image: "assets/Viridis, Arcanist of Life.png",
    effects: [
      {
        id: "viridis_arcanist_life_bounce",
        timing: "ignition",
        oncePerTurn: true,
        oncePerTurnName: "viridis_arcanist_life_bounce",
        targets: [
          {
            id: "viridis_bounce_target",
            owner: "opponent",
            zones: ["spellTrap", "fieldSpell"],
            cardKind: "spell",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "return_to_hand",
            targetRef: "viridis_bounce_target",
          },
          {
            type: "heal",
            player: "self",
            amount: 500,
          },
        ],
      },
      {
        id: "viridis_arcanist_life_recover",
        timing: "on_event",
        event: "card_equipped",
        oncePerTurn: true,
        oncePerTurnName: "viridis_arcanist_life_recover",
        requireEquipCardFilters: {
          cardKind: "spell",
          subtype: "equip",
          archetype: "Arcanist",
        },
        targets: [
          {
            id: "viridis_recover_target",
            owner: "self",
            zone: "graveyard",
            cardKind: "spell",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "viridis_recover_target",
            player: "self",
            to: "hand",
          },
        ],
      },
    ],
  },
  {
    id: 306,
    name: "Tera, Arcanist of Earth",
    cardKind: "monster",
    atk: 1500,
    def: 1800,
    level: 4,
    type: "Spellcaster",
    attribute: "Earth",
    archetype: "Arcanist",
    description:
      'You can target 1 monster your opponent controls; change its battle position. If this card is equipped with an "Arcanist" Equip Spell, this effect can be activated as a Quick Effect. You can only use this effect of "Tera, Arcanist of Earth" once per turn.',
    image: "assets/Tera, Arcanist of Earth.png",
    effects: [
      {
        id: "tera_arcanist_earth_ignition",
        timing: "ignition",
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "tera_arcanist_earth",
        targets: [
          {
            id: "tera_arcanist_earth_targets",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "switch_position",
            targetRef: "tera_arcanist_earth_targets",
          },
        ],
      },
      {
        id: "tera_arcanist_earth_quick",
        timing: "manual",
        speed: 2,
        isQuickEffect: true,
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "tera_arcanist_earth",
        conditions: [
          {
            type: "equipped_with_filters",
            min: 1,
            filters: {
              cardKind: "spell",
              subtype: "equip",
              archetype: "Arcanist",
            },
          },
        ],
        targets: [
          {
            id: "tera_arcanist_earth_targets",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "switch_position",
            targetRef: "tera_arcanist_earth_targets",
          },
        ],
      },
    ],
  },
  {
    id: 307,
    name: "Albus, Arcanist of Ice",
    cardKind: "monster",
    atk: 1500,
    def: 1200,
    level: 4,
    type: "Spellcaster",
    attribute: "Water",
    archetype: "Arcanist",
    description:
      'If you control an "Arcanist" monster, you can Special Summon this card from your hand. If this card is equipped with an "Arcanist" Equip Spell: target 1 "Arcanist" monster in your GY; add it to your hand. You can only activate each effect of "Albus, Arcanist of Ice" once per turn.',
    image: "assets/Albus, Arcanist of Ice.png",
    effects: [
      {
        id: "albus_arcanist_ice_special_summon",
        timing: "ignition",
        requireZone: "hand",
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "albus_arcanist_ice_special_summon",
        conditions: [
          {
            type: "control_card_filters",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Arcanist",
            min: 1,
          },
        ],
        actions: [
          {
            type: "special_summon_from_zone",
            zone: "hand",
            filters: { name: "Albus, Arcanist of Ice" },
            count: { min: 0, max: 1 },
            position: "choice",
            promptPlayer: true,
            oncePerTurnName: "albus_arcanist_ice_special_summon",
          },
        ],
      },
      {
        id: "albus_arcanist_ice_recover",
        timing: "on_event",
        event: "card_equipped",
        requireZone: "field",
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "albus_arcanist_ice_recover",
        requireEquipCardFilters: {
          cardKind: "spell",
          subtype: "equip",
          archetype: "Arcanist",
        },
        promptUser: true,
        promptMessage:
          'Activate "Albus, Arcanist of Ice" to add 1 "Arcanist" monster from your GY to your hand?',
        targets: [
          {
            id: "albus_arcanist_ice_recover_target",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            archetype: "Arcanist",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "albus_arcanist_ice_recover_target",
            player: "self",
            to: "hand",
          },
        ],
      },
    ],
  },
  {
    id: 308,
    name: "Master of Mirrors Arcanist",
    cardKind: "monster",
    atk: 2200,
    def: 2200,
    level: 6,
    type: "Spellcaster",
    attribute: "Light",
    archetype: "Arcanist",
    description:
      'If this card is Normal Summoned: You can target 1 to 3 "Arcanist" Spells in your GY; shuffle them into the Deck, then draw 1 card.\nIf this card is equipped with an "Arcanist" Equip Spell: You can target 1 Level 4 or lower "Arcanist" monster in your GY; Special Summon it.\nYou can only activate each effect of "Master of Mirrors Arcanist" once per turn.',
    image: "assets/Master of Mirrors Arcanist.png",
    effects: [
      {
        id: "master_mirrors_arcanist_shuffle_draw",
        timing: "on_event",
        event: "after_summon",
        summonMethods: ["normal", "tribute"],
        requireSelfAsSummoned: true,
        oncePerTurn: true,
        oncePerTurnName: "master_mirrors_arcanist_shuffle_draw",
        promptUser: true,
        promptMessage:
          'Activate "Master of Mirrors Arcanist" to shuffle 1 to 3 "Arcanist" Spells from your GY into the Deck, then draw 1 card?',
        targets: [
          {
            id: "master_mirrors_arcanist_spell_targets",
            owner: "self",
            zone: "graveyard",
            cardKind: "spell",
            archetype: "Arcanist",
            count: { min: 1, max: 3 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "master_mirrors_arcanist_spell_targets",
            player: "self",
            to: "deck",
          },
          {
            type: "shuffle_deck",
            player: "self",
          },
          {
            type: "draw",
            player: "self",
            amount: 1,
          },
        ],
      },
      {
        id: "master_mirrors_arcanist_revive",
        timing: "on_event",
        event: "card_equipped",
        oncePerTurn: true,
        oncePerTurnName: "master_mirrors_arcanist_revive",
        requireEquipCardFilters: {
          cardKind: "spell",
          subtype: "equip",
          archetype: "Arcanist",
        },
        targets: [
          {
            id: "master_mirrors_arcanist_revive_target",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            archetype: "Arcanist",
            maxLevel: 4,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "special_summon_from_zone",
            targetRef: "master_mirrors_arcanist_revive_target",
            zone: "graveyard",
            position: "choice",
          },
        ],
      },
    ],
  },
  {
    id: 309,
    name: "Meeting of the Arcanists",
    cardKind: "spell",
    subtype: "continuous",
    archetype: "Arcanist",
    description:
      'The first time each turn an "Arcanist" Spell you control would be destroyed, it is not destroyed.\nOnce per turn: You can apply 1 of these effects;\n- Discard 2 "Arcanist" monsters; add 1 "Arcanist" Spell from your Deck to your hand.\n- Discard 2 "Arcanist" Spells; add 1 Level 4 or lower "Arcanist" monster from your Deck to your hand.',
    image: "assets/Meeting of the Arcanists.png",
    effects: [
      {
        id: "meeting_arcanists_spell_guard",
        timing: "passive",
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "meeting_arcanists_spell_guard",
        replacementEffect: {
          type: "destruction",
          reason: "any",
          targetOwner: "self",
          targetZones: ["spellTrap", "fieldSpell"],
          targetFilters: {
            cardKind: "spell",
            archetype: "Arcanist",
          },
          targetRequireFaceup: false,
          auto: true,
          logMessage:
            "An Arcanist Spell you control avoided destruction due to {source}.",
        },
      },
      {
        id: "meeting_arcanists_choose_effect",
        timing: "ignition",
        oncePerTurn: true,
        oncePerTurnName: "meeting_arcanists_choose_effect",
        conditions: [
          {
            type: "any_of",
            conditions: [
              {
                type: "control_card_filters",
                owner: "self",
                zone: "hand",
                filters: { cardKind: "monster", archetype: "Arcanist" },
                min: 2,
              },
              {
                type: "control_card_filters",
                owner: "self",
                zone: "hand",
                filters: { cardKind: "spell", archetype: "Arcanist" },
                min: 2,
              },
            ],
          },
        ],
        actions: [
          {
            type: "choose_action_case",
            selectionMessage: "Choose an effect to apply.",
            cases: [
              {
                id: "meeting_arcanists_discard_monsters",
                label: 'Discard 2 "Arcanist" monsters',
                description:
                  'Discard 2 "Arcanist" monsters; add 1 "Arcanist" Spell from your Deck to your hand.',
                targets: [
                  {
                    id: "meeting_arcanists_discard_monsters",
                    owner: "self",
                    zone: "hand",
                    cardKind: "monster",
                    archetype: "Arcanist",
                    count: { min: 2, max: 2 },
                  },
                ],
                actions: [
                  {
                    type: "move",
                    targetRef: "meeting_arcanists_discard_monsters",
                    player: "self",
                    to: "graveyard",
                  },
                  {
                    type: "search_any",
                    player: "self",
                    archetype: "Arcanist",
                    cardKind: "spell",
                  },
                ],
              },
              {
                id: "meeting_arcanists_discard_spells",
                label: 'Discard 2 "Arcanist" Spells',
                description:
                  'Discard 2 "Arcanist" Spells; add 1 Level 4 or lower "Arcanist" monster from your Deck to your hand.',
                targets: [
                  {
                    id: "meeting_arcanists_discard_spells",
                    owner: "self",
                    zone: "hand",
                    cardKind: "spell",
                    archetype: "Arcanist",
                    count: { min: 2, max: 2 },
                  },
                ],
                actions: [
                  {
                    type: "move",
                    targetRef: "meeting_arcanists_discard_spells",
                    player: "self",
                    to: "graveyard",
                  },
                  {
                    type: "search_any",
                    player: "self",
                    archetype: "Arcanist",
                    cardKind: "monster",
                    maxLevel: 4,
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
    id: 310,
    name: "Arcanist Ice Barrier",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Arcanist",
    description:
      'Target 1 "Arcanist" monster you control; until the end of the next turn, the first time that monster would be destroyed by battle, it is not destroyed. If that monster is equipped with an "Arcanist" Equip Spell when this effect resolves, instead, until the end of the next turn, the first time each "Arcanist" monster you control would be destroyed by battle or card effect, it is not destroyed. You can only activate 1 "Arcanist Ice Barrier" per turn.',
    image: "assets/Arcanist Ice Barrier.png",
    effects: [
      {
        id: "arcanist_ice_barrier_guard",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "arcanist_ice_barrier_guard",
        respectStoredEffectUsageLimits: true,
        storableByGrimoire: true,
        targets: [
          {
            id: "arcanist_ice_barrier_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Arcanist",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "conditional_target_actions",
            targetRef: "arcanist_ice_barrier_target",
            cases: [
              {
                filters: {
                  equippedWithFilters: {
                    cardKind: "spell",
                    subtype: "equip",
                    archetype: "Arcanist",
                    requireFaceup: true,
                  },
                },
                actions: [
                  {
                    type: "register_replacement_effect",
                    duration: "end_of_next_turn",
                    sourceName: "Arcanist Ice Barrier",
                    uniqueKey: "arcanist_ice_barrier_guard",
                    usesPerTarget: true,
                    replacementEffect: {
                      type: "destruction",
                      reason: "any",
                      targetOwner: "self",
                      targetZones: ["field"],
                      targetFilters: {
                        cardKind: "monster",
                        archetype: "Arcanist",
                      },
                      targetRequireFaceup: true,
                      auto: true,
                      logMessage:
                        "{target} avoided destruction due to {source}.",
                    },
                  },
                ],
              },
            ],
            defaultActions: [
              {
                type: "register_replacement_effect",
                targetRef: "arcanist_ice_barrier_target",
                duration: "end_of_next_turn",
                uses: 1,
                sourceName: "Arcanist Ice Barrier",
                uniqueKey: "arcanist_ice_barrier_guard",
                replacementEffect: {
                  type: "destruction",
                  reason: "battle",
                  targetOwner: "self",
                  targetZones: ["field"],
                  targetRequireFaceup: true,
                  auto: true,
                  logMessage:
                    "{target} avoided battle destruction due to {source}.",
                },
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 311,
    name: "Arcanist Ink River",
    cardKind: "spell",
    subtype: "continuous",
    archetype: "Arcanist",
    description:
      'Each time you activate the effect of an "Arcanist" Spell, except "Arcanist Ink River": place 1 Ink counter on this card. You can remove 2 Ink counters from this card; add 1 "Arcanist" Spell from your GY to your hand.',
    image: "assets/Arcanist Ink River.png",
    effects: [
      {
        id: "arcanist_ink_river_counter_normal_spell",
        timing: "on_event",
        event: "effect_activated",
        requireZone: "spellTrap",
        requireFaceup: true,
        promptUser: false,
        triggerPlayer: "self",
        excludeActivatedSelf: true,
        activatedCardFilters: {
          cardKind: "spell",
          subtype: "normal",
          archetype: "Arcanist",
          excludeCardNames: ["Arcanist Ink River"],
        },
        activatedEffectFilters: {
          timing: "on_play",
          placementOnly: false,
        },
        actions: [
          {
            type: "add_counter",
            targetRef: "self",
            counterType: "ink",
            amount: 1,
          },
        ],
      },
      {
        id: "arcanist_ink_river_counter_field_spell_effect",
        timing: "on_event",
        event: "effect_activated",
        requireZone: "spellTrap",
        requireFaceup: true,
        promptUser: false,
        triggerPlayer: "self",
        excludeActivatedSelf: true,
        activatedCardFilters: {
          cardKind: "spell",
          subtype: ["continuous", "field", "equip"],
          archetype: "Arcanist",
          excludeCardNames: ["Arcanist Ink River"],
        },
        activatedEffectFilters: {
          timing: "ignition",
          activationZone: ["spellTrap", "fieldSpell"],
          placementOnly: false,
        },
        actions: [
          {
            type: "add_counter",
            targetRef: "self",
            counterType: "ink",
            amount: 1,
          },
        ],
      },
      {
        id: "arcanist_ink_river_recover",
        timing: "ignition",
        requireZone: "spellTrap",
        requirePhase: ["main1", "main2"],
        conditions: [
          {
            type: "source_counters_at_least",
            counterType: "ink",
            min: 2,
          },
        ],
        actions: [
          {
            type: "remove_counter",
            targetRef: "self",
            counterType: "ink",
            amount: 2,
          },
          {
            type: "add_from_zone_to_hand",
            zone: "graveyard",
            filters: { cardKind: "spell", archetype: "Arcanist" },
            count: { min: 1, max: 1 },
            promptPlayer: true,
          },
        ],
      },
    ],
  },
  {
    id: 312,
    name: "Arcanist Grand Library",
    cardKind: "spell",
    subtype: "field",
    archetype: "Arcanist",
    description:
      'The first time each turn an "Arcanist" monster you control destroys an opponent\'s monster by battle: draw 1 card. Once per turn: You can activate 1 of these effects; If you control no monsters: pay 2000 LP; Special Summon 1 Level 4 or lower "Arcanist" monster from your Deck. If you control an "Arcanist" monster: add 1 "Arcanist" Equip Spell from your Deck to your hand.',
    image: "assets/Arcanist Grand Library.png",
    effects: [
      {
        id: "arcanist_grand_library_ignition",
        timing: "ignition",
        requireZone: "fieldSpell",
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "arcanist_grand_library_ignition",
        actions: [
          {
            type: "choose_action_case",
            selectionMessage: "Choose an Arcanist Grand Library effect.",
            cases: [
              {
                id: "arcanist_grand_library_summon",
                label: "Pay 2000 LP; Special Summon an Arcanist monster",
                description:
                  'If you control no monsters: pay 2000 LP; Special Summon 1 Level 4 or lower "Arcanist" monster from your Deck.',
                conditions: [
                  {
                    type: "control_card_filters",
                    owner: "self",
                    zone: "field",
                    cardKind: "monster",
                    includeFacedown: true,
                    max: 0,
                  },
                ],
                actions: [
                  {
                    type: "pay_lp",
                    amount: 2000,
                  },
                  {
                    type: "special_summon_from_zone",
                    zone: "deck",
                    filters: {
                      cardKind: "monster",
                      archetype: "Arcanist",
                      level: 4,
                      levelOp: "lte",
                    },
                    count: { min: 1, max: 1 },
                    position: "choice",
                    promptPlayer: true,
                  },
                ],
              },
              {
                id: "arcanist_grand_library_search_equip",
                label: 'Add an "Arcanist" Equip Spell',
                description:
                  'If you control an "Arcanist" monster: add 1 "Arcanist" Equip Spell from your Deck to your hand.',
                conditions: [
                  {
                    type: "control_card_filters",
                    owner: "self",
                    zone: "field",
                    cardKind: "monster",
                    archetype: "Arcanist",
                    requireFaceup: true,
                  },
                ],
                actions: [
                  {
                    type: "search_any",
                    player: "self",
                    zone: "deck",
                    filters: {
                      cardKind: "spell",
                      subtype: "equip",
                      archetype: "Arcanist",
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
      {
        id: "arcanist_grand_library_battle_draw",
        timing: "on_event",
        event: "battle_destroy",
        requireZone: "fieldSpell",
        requireFaceup: true,
        requireDestroyedIsOpponent: true,
        oncePerTurn: true,
        oncePerTurnName: "arcanist_grand_library_battle_draw",
        conditions: [
          {
            type: "attacker_matches",
            owner: "self",
            cardKind: "monster",
            archetype: "Arcanist",
          },
        ],
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
    id: 313,
    name: "Elementalist Master Arcanist",
    cardKind: "monster",
    atk: 2500,
    def: 2400,
    level: 9,
    type: "Spellcaster",
    attribute: "Light",
    archetype: "Arcanist",
    description:
      'Cannot be destroyed by card effects. This card gains 100 ATK for each "Arcanist" Spell activated this turn. Once per turn, if this card is equipped with an "Arcanist" Equip Spell: you can target 1 monster your opponent controls; destroy it.',
    image: "assets/Elementalist Master Arcanist.png",
    effects: [
      {
        id: "elementalist_master_protection",
        timing: "on_event",
        event: "after_summon",
        requireSelfAsSummoned: true,
        requireFaceup: true,
        promptUser: false,
        actions: [
          {
            type: "grant_protection",
            targetRef: "self",
            protectionType: "effect_destruction",
            duration: "while_faceup",
          },
        ],
      },
      {
        id: "elementalist_master_spell_buff",
        timing: "on_event",
        event: "spell_activated",
        requireZone: "field",
        requireFaceup: true,
        promptUser: false,
        activatedCardFilters: {
          cardKind: "spell",
          archetype: "Arcanist",
        },
        actions: [
          {
            type: "buff_stats_temp",
            targetRef: "self",
            atkBoost: 100,
          },
        ],
      },
      {
        id: "elementalist_master_destroy",
        timing: "on_event",
        event: "card_equipped",
        oncePerTurn: true,
        oncePerTurnName: "elementalist_master_destroy",
        requireEquipCardFilters: {
          cardKind: "spell",
          subtype: "equip",
          archetype: "Arcanist",
        },
        promptUser: true,
        promptMessage:
          "Ativar Elementalist Master Arcanist para destruir 1 monstro do oponente?",
        targets: [
          {
            id: "elementalist_destroy_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "destroy",
            targetRef: "elementalist_destroy_target",
          },
        ],
      },
    ],
  },
  {
    id: 314,
    name: "Azrath, Corrupted Arcanist",
    cardKind: "monster",
    atk: 1700,
    def: 1400,
    level: 4,
    type: "Spellcaster",
    attribute: "Dark",
    archetype: "Arcanist",
    description:
      'Monsters your opponent controls lose 100 ATK/DEF for each "Arcanist" Spell you activated until the end of this turn. If this card is equipped with an "Arcanist" Equip Spell: target 1 monster your opponent controls; halve its ATK/DEF until the end of this turn. You can only use this effect of "Azrath, Corrupted Arcanist" once per turn.',
    image: "assets/Azrath, Corrupted Arcanist.png",
    effects: [
      {
        id: "azrath_spell_debuff",
        timing: "on_event",
        event: "spell_activated",
        requireZone: "field",
        requireFaceup: true,
        triggerPlayer: "self",
        promptUser: false,
        activatedCardFilters: {
          cardKind: "spell",
          archetype: "Arcanist",
        },
        actions: [
          {
            type: "buff_stats_temp",
            targetRef: "opponent_field",
            atkBoost: -100,
            defBoost: -100,
          },
        ],
      },
      {
        id: "azrath_equip_halve",
        timing: "on_event",
        event: "card_equipped",
        oncePerTurn: true,
        oncePerTurnName: "azrath_equip_halve",
        requireZone: "field",
        requireFaceup: true,
        requireEquipCardFilters: {
          cardKind: "spell",
          subtype: "equip",
          archetype: "Arcanist",
        },
        promptUser: true,
        promptMessage:
          'Activate "Azrath, Corrupted Arcanist" to halve 1 opponent monster\'s ATK/DEF?',
        targets: [
          {
            id: "azrath_halve_target",
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
            targetRef: "azrath_halve_target",
            atkFactor: 0.5,
            defFactor: 0.5,
          },
        ],
      },
    ],
  },
  {
    id: 315,
    name: "Glyph-Destroying Tornado",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Arcanist",
    description:
      'If you control an "Arcanist" monster equipped with an "Arcanist" Equip Spell: target 1 Spell/Trap your opponent controls; destroy it.',
    image: "assets/Glyph-Destroying Tornado.png",
    effects: [
      {
        id: "glyph_destroying_tornado_effect",
        timing: "on_play",
        speed: 1,
        storableByGrimoire: true,
        conditions: [
          {
            type: "control_card_filters",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Arcanist",
            requireFaceup: true,
            reason: 'You must control an "Arcanist" monster.',
          },
          {
            type: "control_card_filters",
            owner: "self",
            zone: "spellTrap",
            cardKind: "spell",
            subtype: "equip",
            archetype: "Arcanist",
            requireFaceup: true,
            reason: 'You must control an "Arcanist" Equip Spell.',
          },
        ],
        targets: [
          {
            id: "glyph_tornado_target",
            owner: "opponent",
            zones: ["spellTrap", "fieldSpell"],
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "destroy",
            targetRef: "glyph_tornado_target",
          },
        ],
      },
    ],
  },
  {
    id: 316,
    name: "Arcanist Seismic Impact",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Arcanist",
    description:
      'If you control an "Arcanist" monster equipped with an "Arcanist" Equip Spell: send 1 "Arcanist" Equip Spell you control to the GY, then target 1 card your opponent controls; banish it. You can only activate 1 "Arcanist Seismic Impact" per turn.',
    image: "assets/Arcanist Seismic Impact.png",
    effects: [
      {
        id: "seismic_impact_effect",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "seismic_impact_effect",
        storableByGrimoire: true,
        conditions: [
          {
            type: "control_card_filters",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Arcanist",
            requireFaceup: true,
            equippedWithFilters: {
              cardKind: "spell",
              subtype: "equip",
              archetype: "Arcanist",
              requireFaceup: true,
            },
            reason:
              'You must control an "Arcanist" monster equipped with an "Arcanist" Equip Spell.',
          },
        ],
        targets: [
          {
            id: "seismic_impact_equip_cost",
            owner: "self",
            zone: "spellTrap",
            cardKind: "spell",
            subtype: "equip",
            archetype: "Arcanist",
            requireFaceup: true,
            count: { min: 1, max: 1 },
            intent: "cost",
          },
          {
            id: "seismic_impact_target",
            owner: "opponent",
            zones: ["field", "spellTrap", "fieldSpell"],
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "seismic_impact_equip_cost",
            player: "self",
            to: "graveyard",
          },
          {
            type: "banish",
            targetRef: "seismic_impact_target",
          },
        ],
      },
    ],
  },
];
