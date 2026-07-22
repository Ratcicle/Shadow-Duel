export const luminarchCards = [
  {
    id: 151,
    name: "Luminarch Valiant - Knight of the Dawn",
    cardKind: "monster",
    atk: 1600,
    def: 1200,
    level: 4,
    type: "Warrior",
    attribute: "Light",
    archetype: "Luminarch",
    piercing: true,
    description:
      'If this card is Normal or Special Summoned: Add 1 Level 4 or lower "Luminarch" monster from your Deck to your hand. If this card battles a Defense Position monster, inflict piercing battle damage to your opponent.',
    image: "/assets/Luminarch Valiant – Knight of the Dawn.png",
    effects: [
      {
        id: "luminarch_valiant_search",
        timing: "on_event",
        triggerRequirement: "mandatory",
        triggerTiming: "if",
        event: "after_summon",
        requireSelfAsSummoned: true,
        summonMethods: ["normal", "special"],
        actions: [
          {
            type: "search_any",
            archetype: "Luminarch",
            cardKind: "monster",
            minLevel: 1,
            maxLevel: 4,
            player: "self",
          },
        ],
      },
    ],
  },
  {
    id: 152,
    name: "Luminarch Holy Shield",
    cardKind: "spell",
    subtype: "quick",
    archetype: "Luminarch",
    description:
      '(Quick Effect) Target up to 3 "Luminarch" monsters you control; until the end of this turn, they cannot be destroyed by battle, and any battle damage you would take involving those monsters is gained instead.',
    image: "/assets/Luminarch Holy Shield.png",
    effects: [
      {
        id: "luminarch_holy_shield_effect",
        timing: "on_play",
        speed: 2,
        targets: [
          {
            id: "holy_shield_targets",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Luminarch",
            requireFaceup: true,
            count: { min: 1, max: 3 },
          },
        ],
        actions: [
          {
            type: "add_status",
            targetRef: "holy_shield_targets",
            status: "tempBattleIndestructible",
            value: true,
            untilEndOfTurn: true,
          },
          {
            type: "add_status",
            targetRef: "holy_shield_targets",
            status: "battleDamageHealsControllerThisTurn",
            value: true,
            untilEndOfTurn: true,
          },
        ],
      },
    ],
  },
  {
    id: 153,
    name: "Luminarch Aegisbearer",
    cardKind: "monster",
    atk: 1000,
    def: 2000,
    level: 4,
    type: "Warrior",
    attribute: "Light",
    archetype: "Luminarch",
    mustBeAttacked: true,
    description:
      "If this card is Special Summoned: Increase its DEF by 500. While this card is face-up on the field, your opponent must prioritize this card as an attack target, if possible.",
    image: "/assets/Luminarch Aegisbearer.png",
    effects: [
      {
        id: "luminarch_aegisbearer_def_boost",
        timing: "on_event",
        triggerRequirement: "mandatory",
        triggerTiming: "if",
        event: "after_summon",
        requireSelfAsSummoned: true,
        summonMethods: ["special"],
        actions: [
          {
            type: "permanent_buff_named",
            targetRef: "self",
            defBoost: 500,
            sourceName: "aegisbearer_special_def",
          },
        ],
      },
      {
        id: "luminarch_aegisbearer_def_reset",
        timing: "on_event",
        triggerRequirement: "mandatory",
        triggerTiming: "if",
        event: "card_to_grave",
        fromZone: "field",
        actions: [
          {
            type: "remove_permanent_buff_named",
            targetRef: "self",
            sourceName: "aegisbearer_special_def",
          },
        ],
      },
    ],
  },
  {
    id: 154,
    name: "Luminarch Moonblade Captain",
    cardKind: "monster",
    atk: 2200,
    def: 1700,
    level: 6,
    type: "Warrior",
    attribute: "Light",
    archetype: "Luminarch",
    description:
      'If this card is Normal Summoned: You can target 1 Level 4 or lower "Luminarch" monster in your GY; Special Summon it. Once per turn, if this card destroys an opponent\'s monster by battle: it can make a second attack this turn.',
    image: "/assets/Luminarch Moonblade Captain.png",
    effects: [
      {
        id: "moonblade_captain_revive",
        timing: "on_event",
        triggerRequirement: "optional",
        triggerTiming: "if",
        event: "after_summon",
        summonMethods: ["normal", "tribute"],
        requireSelfAsSummoned: true,
        targets: [
          {
            id: "moonblade_revive_target",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            archetype: "Luminarch",
            maxLevel: 4,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "special_summon_from_zone",
            targetRef: "moonblade_revive_target",
            zone: "graveyard",
            position: "choice",
          },
        ],
      },
      {

        usagePolicy: "activate",
        id: "moonblade_captain_second_attack",
        timing: "on_event",
        triggerRequirement: "mandatory",
        triggerTiming: "if",
        event: "battle_destroy",
        requireSelfAsAttacker: true,
        requireDestroyedIsOpponent: true,
        oncePerTurn: true,
        oncePerTurnName: "luminarch_moonblade_second_attack",
        oncePerTurnScope: "card",
        actions: [
          {
            type: "grant_second_attack",
            targetRef: "self",
          },
        ],
      },
    ],
  },
  {
    id: 155,
    name: "Luminarch Celestial Marshal",
    cardKind: "monster",
    atk: 2100,
    def: 2500,
    level: 7,
    type: "Warrior",
    attribute: "Light",
    archetype: "Luminarch",
    battleIndestructibleOncePerTurn: true,
    description:
      "You can pay 2000 LP; Special Summon this card from your hand. Once per turn, if this card would be destroyed by battle: negate that destruction. If this card is destroyed by battle: gain 1000 LP.",
    image: "/assets/Luminarch Celestial Marshal.png",
    effects: [
      {

        activationZones: ["hand"],
        id: "luminarch_celestial_marshal_hand_summon",
        timing: "ignition",
        requirePhase: ["main1", "main2"],
        activationCosts: [
          {
            type: "pay_lp",
            amount: 2000,
          },
        ],
        actions: [
          {
            type: "conditional_summon_from_hand",
            targetRef: "self",
            position: "choice",
            optional: false,
          },
        ],
      },
      {
        id: "luminarch_celestial_marshal_battle_destroy_heal",
        timing: "on_event",
        triggerRequirement: "mandatory",
        triggerTiming: "if",
        event: "battle_destroy",
        requireSelfAsDestroyed: true,
        actions: [
          {
            type: "heal",
            player: "self",
            amount: 1000,
          },
        ],
      },
    ],
  },
  {
    id: 156,
    name: "Luminarch Magic Sickle",
    cardKind: "monster",
    atk: 1200,
    def: 1700,
    level: 3,
    type: "Warrior",
    attribute: "Light",
    archetype: "Luminarch",
    description:
      'During the Damage Step, when a "Luminarch" monster you control battles (Quick Effect): you can send this card from your hand to the GY; that monster gains 1200 ATK and 1700 DEF until the end of this turn. You can banish this card from your GY; add 1 "Luminarch" Spell from your GY to your hand. You can only use each effect of "Luminarch Magic Sickle" once per turn.',
    image: "/assets/Luminarch Magic Sickle.png",
    effects: [
      {

        usagePolicy: "use",
        id: "luminarch_magic_sickle_damage_boost",
        timing: "on_event",
        triggerRequirement: "optional",
        triggerTiming: "when",
        event: "battle_damage",
        speed: 2,
        isQuickEffect: true,
        requireZone: "hand",
        oncePerTurn: true,
        oncePerTurnName: "luminarch_magic_sickle_damage_boost",
        targets: [
          {
            id: "magic_sickle_self",
            owner: "self",
            zone: "hand",
            cardKind: "monster",
            cardName: "Luminarch Magic Sickle",
            count: { min: 1, max: 1 },
            intent: "cost",
            requireThisCard: true,
            autoSelect: true,
          },
          {
            id: "magic_sickle_battling_luminarch",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Luminarch",
            battleParticipant: true,
            requireFaceup: true,
            count: { min: 1, max: 1 },
            autoSelect: true,
          },
        ],
        activationCosts: [
          {
            type: "move",
            targetRef: "magic_sickle_self",
            to: "graveyard",
            contextLabel: "cost",
          },
        ],
        actions: [
          {
            type: "buff_stats_temp",
            targetRef: "magic_sickle_battling_luminarch",
            atkBoost: 1200,
            defBoost: 1700,
          },
        ],
      },
      {

        activationZones: ["graveyard"],

        usagePolicy: "use",
        id: "luminarch_magic_sickle_gy_spell_recovery",
        timing: "ignition",
        oncePerTurn: true,
        oncePerTurnName: "luminarch_magic_sickle_gy_spell_recovery",
        actions: [
          {
            type: "banish",
            targetRef: "self",
            fromZone: "graveyard",
          },
          {
            type: "add_from_zone_to_hand",
            zone: "graveyard",
            filters: {
              cardKind: "spell",
              archetype: "Luminarch",
            },
            count: { min: 1, max: 1 },
          },
        ],
      },
    ],
  },
  {
    id: 157,
    name: "Luminarch Sanctum Protector",
    cardKind: "monster",
    atk: 1800,
    def: 2800,
    level: 7,
    type: "Warrior",
    attribute: "Light",
    archetype: "Luminarch",
    description:
      'If you control a face-up "Luminarch Aegisbearer", you can send it to the GY; Special Summon this card from your hand. Once per turn, when an opponent\'s monster declares an attack (Quick Effect): negate that attack.',
    image: "/assets/Luminarch Sanctum Protector.png",
    effects: [
      {

        activationZones: ["hand"],
        id: "luminarch_sanctum_protector_special_summon_hand",
        timing: "ignition",
        targets: [
          {
            id: "aegisbearer_cost",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            cardName: "Luminarch Aegisbearer",
            requireFaceup: true,
            count: { min: 1, max: 1 },
            intent: "cost",
          },
        ],
        actions: [
          {
            type: "special_summon_from_hand_with_cost",
            costTargetRef: "aegisbearer_cost",
            position: "choice",
            cannotAttackThisTurn: false,
          },
        ],
      },
      {

        usagePolicy: "activate",
        id: "luminarch_sanctum_protector_negate",
        timing: "on_event",
        triggerRequirement: "optional",
        triggerTiming: "when",
        event: "attack_declared",
        speed: 2,
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "luminarch_sanctum_protector_negate",
        oncePerTurnScope: "card",
        requireOpponentAttack: true,
        requireDefenderIsSelf: true,
        actions: [{ type: "negate_attack" }],
      },
    ],
  },
  {
    id: 158,
    name: "Luminarch Radiant Lancer",
    cardKind: "monster",
    atk: 2600,
    def: 2100,
    level: 8,
    type: "Warrior",
    attribute: "Light",
    archetype: "Luminarch",
    description:
      "If this card destroys an opponent's monster by battle, it gains 100 ATK while it remains on the field. If this card is destroyed by battle, destroy 1 Spell/Trap your opponent controls.",
    image: "/assets/Luminarch Radiant Lancer.png",
    effects: [
      {

        activationLabelKey: "effects.radiantLancer.attackBoost",
        id: "luminarch_radiant_lancer_atk_boost",
        timing: "on_event",
        triggerRequirement: "mandatory",
        triggerTiming: "if",
        event: "battle_destroy",
        requireSelfAsAttacker: true,
        actions: [
          {
            type: "permanent_buff_named",
            targetRef: "self",
            atkBoost: 100,
          },
        ],
      },
      {

        activationLabelKey: "effects.radiantLancer.destroySpellTrap",
        id: "luminarch_radiant_lancer_destroy_spelltrap",
        timing: "on_event",
        triggerRequirement: "mandatory",
        triggerTiming: "if",
        event: "battle_destroy",
        requireSelfAsDestroyed: true,
        targets: [
          {
            id: "radiant_lancer_destroy_target",
            owner: "opponent",
            zones: ["spellTrap", "fieldSpell"],
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "destroy",
            targetRef: "radiant_lancer_destroy_target",
          },
        ],
      },
      {
        id: "luminarch_radiant_lancer_reset",
        timing: "on_event",
        triggerRequirement: "mandatory",
        triggerTiming: "if",
        event: "card_to_grave",
        fromZone: "field",
        actions: [
          {
            type: "remove_permanent_buff_named",
            targetRef: "self",
          },
        ],
      },
    ],
  },
  {
    id: 159,
    name: "Luminarch Aurora Seraph",
    cardKind: "monster",
    atk: 2800,
    def: 2400,
    level: 8,
    type: "Fairy",
    attribute: "Light",
    archetype: "Luminarch",
    description:
      "If this card destroys an opponent's monster by battle, gain LP equal to half that monster's ATK. Once per turn, if this card would be destroyed by battle or card effect: you can send 1 \"Luminarch\" monster you control to the GY instead.",
    image: "/assets/Luminarch Aurora Seraph.png",
    effects: [
      {
        id: "luminarch_aurora_seraph_heal",
        timing: "on_event",
        triggerRequirement: "mandatory",
        triggerTiming: "if",
        event: "battle_destroy",
        requireSelfAsAttacker: true,
        actions: [
          {
            type: "heal_from_destroyed_atk",
            fraction: 0.5,
          },
        ],
      },
      {

        usagePolicy: "use",
        id: "luminarch_aurora_seraph_protect",
        timing: "passive",
        oncePerTurn: true,
        oncePerTurnName: "luminarch_aurora_seraph_protect",
        oncePerTurnScope: "card",
        replacementEffect: {
          type: "destruction",
          reason: "any",
          costFilters: {
            cardKind: "monster",
            archetype: "Luminarch",
          },
          costZone: "field",
          costCount: 1,
          prompt:
            'Send 1 "Luminarch" monster you control to the GY to save this card?',
          selectionMessage:
            'Choose a "Luminarch" monster to send to the Graveyard for protection.',
        },
      },
    ],
  },
  {
    id: 160,
    name: "Luminarch Sanctified Arbiter",
    cardKind: "monster",
    atk: 1500,
    def: 1000,
    level: 4,
    type: "Warrior",
    attribute: "Light",
    archetype: "Luminarch",
    description:
      'If this card is Normal Summoned: You can add 1 "Luminarch" Spell/Trap from your Deck to your hand. You can only use this effect of "Luminarch Sanctified Arbiter" once per turn.',
    image: "/assets/Luminarch Sanctified Arbiter.png",
    effects: [
      {

        usagePolicy: "use",
        id: "luminarch_sanctified_arbiter_search",
        timing: "on_event",
        triggerRequirement: "optional",
        triggerTiming: "if",
        event: "after_summon",
        summonMethods: ["normal"],
        requireSelfAsSummoned: true,
        oncePerTurn: true,
        oncePerTurnName: "luminarch_sanctified_arbiter_search",
        actions: [
          {
            type: "search_any",
            player: "self",
            archetype: "Luminarch",
            cardKind: ["spell", "trap"],
          },
        ],
      },
    ],
  },
  {
    id: 161,
    name: "Luminarch Knights Convocation",
    cardKind: "spell",
    subtype: "continuous",
    archetype: "Luminarch",
    description:
      'Once per turn: discard 1 Level 5 or higher Luminarch monster; add 1 Level 4 or lower Luminarch monster from your Deck to your hand. The first time each turn a "Luminarch" monster you control would be destroyed by battle or card effect, negate that destruction.',
    image: "/assets/Luminarch Knights Convocation.png",
    effects: [
      {

        activationZones: ["spellTrap"],

        usagePolicy: "activate",
        id: "luminarch_knights_convocation_effect",
        timing: "ignition",
        oncePerTurn: true,
        oncePerTurnName: "luminarch_knights_convocation_effect",
        targets: [
          {
            id: "convocation_discard",
            owner: "self",
            zone: "hand",
            cardKind: "monster",
            archetype: "Luminarch",
            minLevel: 5,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "convocation_discard",
            player: "self",
            to: "graveyard",
          },
          {
            type: "search_any",
            player: "self",
            archetype: "Luminarch",
            cardKind: "monster",
            maxLevel: 4,
          },
        ],
      },
      {

        usagePolicy: "use",
        id: "luminarch_knights_convocation_first_destruction_guard",
        timing: "passive",
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "luminarch_knights_convocation_first_destruction_guard",
        replacementEffect: {
          type: "destruction",
          reason: "any",
          targetOwner: "self",
          targetZones: ["field"],
          targetFilters: {
            cardKind: "monster",
            archetype: "Luminarch",
          },
          targetRequireFaceup: true,
          auto: true,
          logMessage:
            "{target} avoided destruction due to {source}.",
        },
      },
    ],
  },
  {
    id: 162,
    name: "Sanctum of the Luminarch Citadel",
    cardKind: "spell",
    subtype: "field",
    archetype: "Luminarch",
    description:
      'Whenever an opponent\'s monster declares an attack: gain 500 LP. Once per turn: You can pay 1000 LP, then target 1 "Luminarch" monster you control; it gains 500 ATK/DEF until the end of this turn.',
    image: "/assets/Sanctum of the Luminarch Citadel.png",
    effects: [
      {
        id: "sanctum_luminarch_citadel_attack_heal",
        timing: "on_event",
        triggerRequirement: "mandatory",
        triggerTiming: "if",
        event: "attack_declared",
        requireOpponentAttack: true,
        promptUser: false,
        actions: [
          {
            type: "heal",
            player: "self",
            amount: 500,
          },
        ],
      },
      {

        usagePolicy: "activate",
        id: "sanctum_luminarch_citadel_buff",
        timing: "on_field_activate",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "sanctum_luminarch_citadel_buff",
        oncePerTurnScope: "card",
        targets: [
          {
            id: "sanctum_citadel_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Luminarch",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        activationCosts: [
          {
            type: "pay_lp",
            amount: 1000,
          },
        ],
        actions: [
          {
            type: "buff_stats_temp",
            targetRef: "sanctum_citadel_target",
            atkBoost: 500,
            defBoost: 500,
          },
        ],
      },
    ],
  },
  {
    id: 163,
    name: "Luminarch Holy Ascension",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Luminarch",
    description:
      'Pay 1000 LP, then target 1 "Luminarch" monster you control; it gains 800 ATK/DEF until the end of this turn.',
    image: "/assets/Luminarch Holy Ascension.png",
    effects: [
      {
        id: "luminarch_holy_ascension_boost",
        timing: "on_play",
        speed: 1,
        targets: [
          {
            id: "holy_ascension_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Luminarch",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        activationCosts: [
          {
            type: "pay_lp",
            amount: 1000,
          },
        ],
        actions: [
          {
            type: "buff_stats_temp",
            targetRef: "holy_ascension_target",
            atkBoost: 800,
            defBoost: 800,
          },
        ],
      },
    ],
  },
  {
    id: 164,
    name: "Luminarch Radiant Wave",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Luminarch",
    description:
      'If you control a "Luminarch" monster, or if there is a "Luminarch" monster in your GY: Pay 2000 LP, then target 1 card your opponent controls; destroy it. You can only activate 1 "Luminarch Radiant Wave" per turn.',
    image: "/assets/Luminarch Radiant Wave.png",
    effects: [
      {

        usagePolicy: "activate",
        id: "luminarch_radiant_wave_effect",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "luminarch_radiant_wave_activation",
        conditions: [
          {
            type: "any_of",
            conditions: [
              {
                type: "control_card_filters",
                owner: "self",
                zone: "field",
                filters: { cardKind: "monster", archetype: "Luminarch" },
                min: 1,
              },
              {
                type: "graveyardHasMatch",
                owner: "self",
                zone: "graveyard",
                filters: { cardKind: "monster", archetype: "Luminarch" },
              },
            ],
          },
        ],
        targets: [
          {
            id: "radiant_wave_destroy",
            owner: "opponent",
            zones: ["field", "spellTrap", "fieldSpell"],
            count: { min: 1, max: 1 },
          },
        ],
        activationCosts: [
          {
            type: "pay_lp",
            player: "self",
            amount: 2000,
          },
        ],
        actions: [
          {
            type: "destroy",
            targetRef: "radiant_wave_destroy",
          },
        ],
      },
    ],
  },
  {
    id: 165,
    name: "Luminarch Crescent Shield",
    cardKind: "spell",
    subtype: "equip",
    archetype: "Luminarch",
    description:
      'Equip only to a "Luminarch" monster you control. It gains 500 DEF. If the equipped monster would be destroyed by battle, send this card to the GY instead.',
    image: "/assets/Luminarch Crescent Shield.png",
    effects: [
      {
        id: "luminarch_crescent_shield_equip",
        timing: "on_play",
        speed: 1,
        targets: [
          {
            id: "crescent_shield_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Luminarch",
            count: { min: 1, max: 1 },
            requireFaceup: true,
          },
        ],
        actions: [
          {
            type: "equip",
            targetRef: "crescent_shield_target",
            defBonus: 500,
            grantCrescentShieldGuard: true,
          },
        ],
      },
    ],
  },
  {
    id: 166,
    name: "Luminarch Sunforged Blade",
    cardKind: "spell",
    subtype: "equip",
    archetype: "Luminarch",
    description:
      'Equip only to a "Luminarch" monster you control. Each time you gain LP, place 1 Solar Counter on this card. The equipped monster gains 200 ATK/DEF for each Solar Counter on this card. Once per turn, if the equipped monster would be destroyed by battle: you can pay 1000 LP; it is not destroyed. You can only control 1 "Luminarch Sunforged Blade".',
    image: "/assets/Luminarch Sunforged Blade.png",
    effects: [
      {
        id: "luminarch_sunforged_blade_equip",
        timing: "on_play",
        speed: 1,
        conditions: [
          {
            type: "control_card_max",
            zone: "spellTrap",
            max: 0,
            includeFacedown: true,
            filters: { cardId: 166 },
            excludeSource: true,
            reason:
              'You can only control 1 "Luminarch Sunforged Blade".',
          },
        ],
        targets: [
          {
            id: "sunforged_blade_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Luminarch",
            count: { min: 1, max: 1 },
            requireFaceup: true,
          },
        ],
        actions: [
          {
            type: "equip",
            targetRef: "sunforged_blade_target",
          },
        ],
      },
      {
        id: "luminarch_sunforged_blade_solar_counter",
        timing: "on_event",
        triggerRequirement: "mandatory",
        triggerTiming: "if",
        event: "lp_change",
        requireZone: "spellTrap",
        requireFaceup: true,
        triggerPlayer: "self",
        actions: [
          {
            type: "add_counter",
            targetRef: "self",
            counterType: "solar",
            amount: 1,
          },
        ],
      },
      {
        id: "luminarch_sunforged_blade_counter_buff",
        timing: "passive",
        requireZone: "spellTrap",
        requireFaceup: true,
        passive: {
          type: "equipped_counter_buff",
          counterType: "solar",
          amountPerCounter: 200,
          stats: ["atk", "def"],
          targetFilters: { archetype: "Luminarch" },
        },
      },
      {

        usagePolicy: "use",
        id: "luminarch_sunforged_blade_battle_protection",
        timing: "passive",
        requireZone: "spellTrap",
        requireFaceup: true,
        oncePerTurn: true,
        oncePerTurnName: "luminarch_sunforged_blade_battle_protection",
        oncePerTurnScope: "card",
        replacementEffect: {
          type: "destruction",
          reason: "battle",
          targetMustBeEquippedToSource: true,
          targetOwner: "self",
          targetZones: ["field"],
          targetRequireFaceup: true,
          targetFilters: {
            cardKind: "monster",
            archetype: "Luminarch",
          },
          costActions: [
            {
              type: "pay_lp",
              amount: 1000,
            },
          ],
          prompt:
            'Pay 1000 LP with Luminarch Sunforged Blade to prevent {target} from being destroyed by battle?',
          logMessage:
            "{target} avoided battle destruction due to {source}.",
        },
      },
    ],
  },
  {
    id: 167,
    name: "Luminarch Spear of Dawnfall",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Luminarch",
    description:
      'If you control a "Luminarch" monster: target 1 monster your opponent controls; its ATK and DEF become 0 until the end of this turn. You can only activate 1 "Luminarch Spear of Dawnfall" per turn.',
    image: "/assets/Luminarch Spear of Dawnfall.png",
    effects: [
      {

        usagePolicy: "activate",
        id: "luminarch_spear_dawnfall",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "luminarch_spear_dawnfall_activation",
        targets: [
          {
            id: "spear_luminarch_check",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Luminarch",
            count: { min: 1, max: 1 },
            autoSelect: true,
          },
          {
            id: "spear_zero_target",
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
            targetRef: "spear_zero_target",
            atkFactor: 0,
            defFactor: 0,
          },
        ],
      },
    ],
  },
  {
    id: 168,
    name: "Luminarch Enchanted Halberd",
    cardKind: "monster",
    atk: 1600,
    def: 1400,
    level: 4,
    type: "Warrior",
    attribute: "Light",
    archetype: "Luminarch",
    image: "/assets/Luminarch Enchanted Halberd.png",
    description:
      'Once per turn, if a "Luminarch" monster is Special Summoned to your field: You can Special Summon this card from your hand, but it cannot declare an attack this turn.',
    effects: [
      {

        usagePolicy: "activate",
        id: "luminarch_enchanted_halberd_conditional_summon",
        timing: "on_event",
        triggerRequirement: "optional",
        triggerTiming: "if",
        event: "after_summon",
        summonMethods: ["special"],
        oncePerTurn: true,
        oncePerTurnName: "luminarch_enchanted_halberd_conditional_summon",
        condition: {
          triggerArchetype: "Luminarch",
          requires: "self_in_hand",
        },
        actions: [
          {
            type: "conditional_summon_from_hand",
            targetRef: "self",
            position: "choice",
            restrictAttackThisTurn: true,
            optional: true,
          },
        ],
      },
    ],
  },
  {
    id: 169,
    name: "Luminarch Moonlit Blessing",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Luminarch",
    description:
      'Target 1 "Luminarch" monster in your Graveyard; add it to your hand, then if you control "Sanctum of the Luminarch Citadel", you can Special Summon that monster. You can only activate 1 "Luminarch Moonlit Blessing" per turn.',
    image: "/assets/Luminarch Moonlit Blessing.png",
    effects: [
      {

        usagePolicy: "activate",
        id: "luminarch_moonlit_blessing_effect",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "luminarch_moonlit_blessing",
        targets: [
          {
            id: "moonlit_blessing_target",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            archetype: "Luminarch",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "moonlit_blessing_target",
            to: "hand",
            allowExtraDeckMonsterToHandIf: {
              type: "control_card",
              cardName: "Sanctum of the Luminarch Citadel",
              zone: "fieldSpell",
            },
          },
          {
            type: "conditional_summon_from_hand",
            targetRef: "moonlit_blessing_target",
            condition: {
              type: "control_card",
              cardName: "Sanctum of the Luminarch Citadel",
              zone: "fieldSpell",
            },
            position: "choice",
            optional: true,
          },
        ],
      },
    ],
  },
  {
    id: 170,
    name: "Luminarch Sacred Judgment",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Luminarch",
    description:
      'If your opponent controls 2 or more monsters: Pay 2000 LP; Special Summon "Luminarch" monsters from your GY, up to the number of monsters your opponent controls, then gain 500 LP for each monster Special Summoned. You can only activate 1 "Luminarch Sacred Judgment" per turn.',
    image: "/assets/Luminarch Sacred Judgment.png",
    effects: [
      {

        usagePolicy: "activate",
        id: "luminarch_sacred_judgment_effect",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "luminarch_sacred_judgment",
        conditions: [
          { type: "opponentMonstersMin", min: 2 },
          { type: "playerLpMin", min: 2000 },
          {
            type: "graveyardHasMatch",
            owner: "self",
            zone: "graveyard",
            filters: { cardKind: "monster", archetype: "Luminarch" },
          },
        ],
        activationCosts: [
          {
            type: "pay_lp",
            amount: 2000,
            player: "self",
          },
        ],
        actions: [
          {
            type: "special_summon_from_zone",
            zone: "graveyard",
            filters: { cardKind: "monster", archetype: "Luminarch" },
            count: { min: 0, max: 5, maxFrom: "opponentFieldCount", cap: 5 },
            position: "choice",
            promptPlayer: true,
          },
          {
            type: "heal_per_archetype_monster",
            archetype: "Luminarch",
            amountPerMonster: 500,
            player: "self",
          },
        ],
      },
    ],
  },
  {
    id: 171,
    name: "Luminarch Megashield Barbarias",
    cardKind: "monster",
    monsterType: "fusion",
    atk: 2500,
    def: 3000,
    level: 9,
    type: "Warrior",
    attribute: "Light",
    archetype: "Luminarch",
    archetypes: ["Luminarch"],
    description:
      "'Luminarch Sanctum Protector' + 1 Level 5 or higher 'Luminarch' monster. All LP you would gain is doubled. Once per turn: You can target 1 monster you control; switch its battle position, and if you do, it gains 800 ATK until the end of this turn.",
    image: "/assets/Luminarch Megashield Barbarias.png",
    fusionMaterials: [
      { name: "Luminarch Sanctum Protector", count: 1 },
      { archetype: "Luminarch", minLevel: 5, count: 1 },
    ],
    effects: [
      {
        id: "megashield_barbarias_lp_doubling",
        timing: "passive",
        passive: {
          type: "lp_gain_multiplier",
          multiplier: 2.0,
        },
        actions: [],
      },
      {

        activationZones: ["field"],

        usagePolicy: "activate",
        id: "megashield_barbarias_switch_boost",
        timing: "ignition",
        oncePerTurn: true,
        oncePerTurnName: "megashield_barbarias_switch_boost",
        oncePerTurnScope: "card",
        targets: [
          {
            id: "barbarias_switch_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "switch_position",
            targetRef: "barbarias_switch_target",
            atkBoost: 800,
            markChanged: true,
          },
        ],
      },
    ],
  },
  {
    id: 172,
    name: "Luminarch Fortress Aegis",
    cardKind: "monster",
    monsterType: "ascension",
    atk: 1500,
    def: 2500,
    level: 6,
    type: "Warrior",
    attribute: "Light",
    archetype: "Luminarch",
    mustBeAttacked: true,
    ascension: {
      materialId: 153,
      requirements: [{ type: "material_turns_on_field", count: 2 }],
      position: "choice",
    },
    description:
      "Ascension Material: 'Luminarch Aegisbearer'. Requirement: The material must have been face-up on the field for 2 turns. Your opponent must prioritize this card as an attack target, if possible. If this card is Ascension Summoned: Gain 500 LP for each 'Luminarch' monster you control. Once per turn: You can pay 1000 LP, then target 1 'Luminarch' monster with 2000 or less DEF in your GY; Special Summon it.",
    image: "/assets/Luminarch Fortress Aegis.png",
    effects: [
      {
        id: "luminarch_fortress_aegis_heal_on_summon",
        timing: "on_event",
        triggerRequirement: "mandatory",
        triggerTiming: "if",
        event: "after_summon",
        summonMethods: ["ascension"],
        requireSelfAsSummoned: true,
        actions: [
          {
            type: "heal_per_field_count",
            player: "self",
            amountPerCard: 500,
            filters: {
              owner: "self",
              zone: "field",
              cardKind: "monster",
              archetype: "Luminarch",
            },
          },
        ],
      },
      {

        activationZones: ["field"],

        usagePolicy: "activate",
        id: "luminarch_fortress_aegis_revive",
        timing: "ignition",
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "luminarch_fortress_aegis_revive",
        oncePerTurnScope: "card",
        targets: [
          {
            id: "fortress_aegis_revive_target",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            archetype: "Luminarch",
            maxDef: 2000,
            count: { min: 1, max: 1 },
          },
        ],
        activationCosts: [
          {
            type: "pay_lp",
            amount: 1000,
          },
        ],
        actions: [
          {
            type: "special_summon_from_zone",
            zone: "graveyard",
            targetRef: "fortress_aegis_revive_target",
            position: "choice",
          },
        ],
      },
    ],
  },
  {
    id: 173,
    name: "Luminarch Pure Knight",
    cardKind: "monster",
    monsterType: "fusion",
    atk: 2000,
    def: 2000,
    level: 6,
    type: "Warrior",
    attribute: "Light",
    archetype: "Luminarch",
    archetypes: ["Luminarch"],
    description:
      "2 'Luminarch' monsters. If this card is Fusion Summoned: You can add 1 'Sanctum of the Luminarch Citadel' from your Deck to your hand. Twice per turn, when you activate the effect of a 'Luminarch' Spell/Trap that requires paying LP: reduce that cost by 1000. You can only use the Fusion Summon effect of 'Luminarch Pure Knight' once per turn.",
    image: "/assets/Luminarch Pure Knight.png",
    fusionMaterials: [{ archetype: "Luminarch", count: 2 }],
    effects: [
      {

        usagePolicy: "use",
        id: "luminarch_pure_knight_fusion_search",
        timing: "on_event",
        triggerRequirement: "optional",
        triggerTiming: "if",
        event: "after_summon",
        summonMethods: ["fusion"],
        requireSelfAsSummoned: true,
        oncePerTurn: true,
        oncePerTurnName: "luminarch_pure_knight_fusion_search",
        oncePerTurnScope: "card",
        actions: [
          {
            type: "search_any",
            cardName: "Sanctum of the Luminarch Citadel",
            cardKind: "spell",
            player: "self",
          },
        ],
      },
      {

        usagePolicy: "use",
        id: "luminarch_pure_knight_lp_discount",
        timing: "passive",
        oncePerTurn: true,
        oncePerTurnLimit: 2,
        oncePerTurnName: "luminarch_pure_knight_lp_discount",
        oncePerTurnScope: "card",
        requireFaceup: true,
        passive: {
          type: "lp_cost_reduction",
          amount: 1000,
          stackMode: "max",
          appliesTo: "self",
          actionTypes: ["pay_lp"],
          sourceFilters: {
            archetype: "Luminarch",
            cardKind: ["spell", "trap"],
          },
        },
      },
    ],
  },
  {
    id: 174,
    name: "Luminarch Ethereal Lancer",
    cardKind: "monster",
    monsterType: "ascension",
    atk: 2100,
    def: 1600,
    level: 6,
    type: "Warrior",
    attribute: "Light",
    archetype: "Luminarch",
    archetypes: ["Luminarch"],
    piercing: true,
    piercingDamageMultiplier: 2,
    ascension: {
      materialId: 151,
      position: "choice",
    },
    description:
      'Ascension Material: "Luminarch Valiant - Knight of the Dawn". If this card is Ascension Summoned: You can target 1 other face-up monster you control; it gains 500 DEF, and if it does, this card gains 500 ATK. If this card attacks a Defense Position monster, inflict double piercing battle damage to your opponent. If this card destroys an opponent\'s monster by battle: gain 1000 LP.',
    image: "/assets/Luminarch Ethereal Lancer.png",
    effects: [
      {
        id: "luminarch_ethereal_lancer_ascension_buff",
        timing: "on_event",
        triggerRequirement: "optional",
        triggerTiming: "if",
        event: "after_summon",
        summonMethods: ["ascension"],
        requireSelfAsSummoned: true,
        promptUser: true,
        targets: [
          {
            id: "ethereal_lancer_buff_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            excludeSelf: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "permanent_buff_named",
            targetRef: "ethereal_lancer_buff_target",
            defBoost: 500,
            sourceName: "luminarch_ethereal_lancer_ascension_buff",
          },
          {
            type: "permanent_buff_named",
            targetRef: "self",
            atkBoost: 500,
            sourceName: "luminarch_ethereal_lancer_ascension_buff",
          },
        ],
      },
      {
        id: "luminarch_ethereal_lancer_buff_cleanup",
        timing: "on_event",
        triggerRequirement: "mandatory",
        triggerTiming: "if",
        event: "card_to_grave",
        fromZone: "field",
        actions: [
          {
            type: "remove_permanent_buff_named",
            targetRef: "self",
            removeFromAllField: true,
            sourceName: "luminarch_ethereal_lancer_ascension_buff",
          },
        ],
      },
      {
        id: "luminarch_ethereal_lancer_battle_heal",
        timing: "on_event",
        triggerRequirement: "mandatory",
        triggerTiming: "if",
        event: "battle_destroy",
        requireSelfAsBattleDestroyer: true,
        requireDestroyedIsOpponent: true,
        promptUser: false,
        actions: [
          {
            type: "heal",
            player: "self",
            amount: 1000,
          },
        ],
      },
    ],
  },
];
