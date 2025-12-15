export const cardDatabase = [
  {
    id: 1,
    name: "Nightmare Steed",
    cardKind: "monster",
    atk: 1700,
    def: 1200,
    level: 4,
    type: "Beast",
    description: "A demonic horse with flaming mane.",
    image: "assets/shadow_wolf.png",
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
    description: "Special Summon 1 Summoned Imp token (ATK/DEF 500).",
    image: "assets/Summoned Imp.jpg",
    effects: [
      {
        id: "cheap_necromancy",
        timing: "on_play",
        speed: 1,
        actions: [
          {
            type: "special_summon_token",
            player: "self",
            position: "attack",
            token: {
              name: "Summoned Imp",
              atk: 500,
              def: 500,
              level: 2,
              type: "Fiend",
              image: "assets/Summoned Imp.jpg",
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
    altTribute: { requiresName: "Nightmare Steed", tributes: 1 },
    onBattleDestroy: { damage: 300 },
    description:
      'Can be Tribute Summoned with 1 tribute if it is "Nightmare Steed". If it destroys a monster by battle, inflict 300 damage.',
    image: "assets/Midnight Nightmare Steed.png",
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
    image: "assets/Transmutate.jpg",
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
    description: "When this card is Normal Summoned: draw 1 card.",
    image: "assets/Arcane Scholar.png",
    effects: [
      {
        id: "arcane_scholar_on_normal_summon",
        timing: "on_event",
        event: "after_summon",
        summonMethod: "normal",
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
      "Equip only to a monster you control. When that monster destroys a monster by battle: gain 500 LP. If this card is sent to the Graveyard: target 1 Spell your opponent controls; destroy that target.",
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
        requireEquippedAsAttacker: true,
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
      "Equip only to a monster you control. It can make 1 additional attack during each Battle Phase. If this card is sent to the Graveyard: target 1 Spell/Trap your opponent controls; destroy that target.",
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
    name: "Radiant Dragon",
    cardKind: "monster",
    atk: 2200,
    def: 1600,
    level: 6,
    type: "Dragon",
    archetype: "Radiant",
    description:
      'If this card was Normal Summoned: Add 1 "Luminarch" monster from your Deck to your hand. Once per turn, during your Standby Phase: gain 300 LP for each "Luminarch" monster you control.',
    image: "assets/Radiant Dragon.png",
    effects: [
      {
        id: "radiant_dragon_search_luminarch",
        timing: "on_event",
        event: "after_summon",
        summonMethod: ["normal", "tribute"],
        actions: [
          {
            type: "search_any",
            archetype: "Luminarch",
            cardKind: "monster",
            player: "self",
          },
        ],
      },
      {
        id: "radiant_dragon_luminarch_heal",
        timing: "on_event",
        event: "standby_phase",
        oncePerTurn: true,
        oncePerTurnName: "radiant_dragon_luminarch_heal",
        actions: [
          {
            type: "heal_per_archetype_monster",
            player: "self",
            archetype: "Luminarch",
            amountPerMonster: 300,
          },
        ],
      },
    ],
  },
  {
    id: 13,
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
    id: 14,
    name: "Mirror Force",
    cardKind: "trap",
    subtype: "normal",
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
    id: 15,
    name: "Call of the Haunted",
    cardKind: "trap",
    subtype: "continuous",
    description:
      "Activate this card by targeting 1 monster in your GY; Special Summon that target in Attack Position. When this card leaves the field, destroy that target. When that target is destroyed, destroy this card.",
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
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "call_of_haunted_summon_and_bind",
            targetRef: "haunted_target",
          },
        ],
      },
    ],
  },
  {
    id: 51,
    name: "Shadow-Heart Observer",
    cardKind: "monster",
    atk: 1000,
    def: 1000,
    level: 3,
    type: "Fiend",
    archetype: "Shadow-Heart",
    description:
      "If this card is Normal Summoned: You can target 1 monster your opponent controls with Level 4 or lower; Special Summon 1 monster from your hand with the same Level as the target.",
    image: "assets/Shadow-Heart Observer.png",
    effects: [
      {
        id: "shadow_heart_observer_special_summon",
        timing: "on_event",
        event: "after_summon",
        summonMethod: "normal",
        targets: [
          {
            id: "observer_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            maxLevel: 4,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "shadow_heart_observer_summon",
            targetRef: "observer_target",
          },
        ],
      },
    ],
  },
  {
    id: 52,
    name: "Shadow-Heart Abyssal Eel",
    cardKind: "monster",
    atk: 1600,
    def: 1700,
    level: 4,
    type: "Sea Serpent",
    archetype: "Shadow-Heart",
    description:
      'If this card is attacked while in Defense Position: inflict 600 damage to your opponent. You can send this card from the field to the GY; Special Summon 1 "Shadow-Heart Leviathan" from your hand, but it cannot attack this turn.',
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
        id: "shadow_heart_abyssal_eel_summon",
        timing: "ignition",
        oncePerTurn: true,
        oncePerTurnName: "shadow_heart_abyssal_eel_summon",
        actions: [
          {
            type: "abyssal_eel_special_summon",
          },
        ],
      },
    ],
  },
  {
    id: 53,
    name: "Shadow-Heart Specter",
    cardKind: "monster",
    atk: 800,
    def: 800,
    level: 2,
    type: "Spirit",
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
    id: 54,
    name: "Shadow-Heart Purge",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Shadow-Heart",
    description:
      "Discard 1 card; then target 1 monster your opponent controls; destroy that target.",
    image: "assets/Shadow-Heart Purge.png",
    effects: [
      {
        id: "shadow_heart_purge_destroy",
        timing: "on_play",
        speed: 1,
        targets: [
          {
            id: "purge_discard",
            owner: "self",
            zone: "hand",
            count: { min: 1, max: 1 },
          },
          {
            id: "purge_target_monster",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
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
          { type: "destroy", targetRef: "purge_target_monster" },
        ],
      },
    ],
  },
  {
    id: 55,
    name: "Shadow-Heart Coat",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Shadow-Heart",
    description:
      "Target 1 monster; it gains 600 ATK until the end of this turn.",
    image: "assets/Shadow Coat.png",
    effects: [
      {
        id: "shadow_coat_buff",
        timing: "on_play",
        speed: 1,
        targets: [
          {
            id: "buff_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          { type: "buff_atk_temp", amount: 600, targetRef: "buff_target" },
        ],
      },
    ],
  },
  {
    id: 56,
    name: "Shadow-Heart Recall",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Shadow-Heart",
    description: "Target 1 monster you control; return it to your hand.",
    image: "assets/Shadow Recall.png",
    effects: [
      {
        id: "shadow_recall_effect",
        timing: "on_play",
        speed: 1,
        targets: [
          {
            id: "bounce_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "bounce_target",
            player: "self",
            to: "hand",
          },
        ],
      },
    ],
  },
  {
    id: 57, // escolhe um id livre
    name: "Shadow-Heart Demon Arctroth",
    cardKind: "monster",
    atk: 2600,
    def: 1800,
    level: 8,
    type: "Fiend",
    archetype: "Shadow-Heart",
    description:
      "When this card is Normal Summoned: target 1 monster your opponent controls; destroy that target.",
    image: "assets/Shadow-Heart Demon Arctroth.png",
    effects: [
      {
        id: "shadow_heart_arctroth_on_summon",
        timing: "on_event",
        event: "after_summon",
        summonMethod: "tribute", // ou ["normal", "tribute"] se quiser
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
    id: 58,
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
            archetype: "Shadow-Heart", // <<< filtro de arqu├®tipo
            requireFaceup: true,
            count: { min: 1, max: 5 },
            autoSelect: true, // pega automaticamente todos os v├ílidos
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
    id: 59,
    name: "Shadow-Heart Covenant",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Shadow-Heart",
    description:
      'Pay 800 LP; add 1 "Shadow-Heart" card from your Deck to your hand. You can only activate 1 "Shadow-Heart Covenant" per turn.',
    image: "assets/Shadow-Heart Covenant.png",
    effects: [
      {
        id: "shadow_heart_covenant",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "shadow_heart_covenant",
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
    id: 60,
    name: "Shadow-Heart Imp",
    cardKind: "monster",
    atk: 1500,
    def: 800,
    level: 4,
    type: "Fiend",
    archetype: "Shadow-Heart",
    description:
      'When this card is Normal Summoned: You can Special Summon 1 Level 4 or lower "Shadow-Heart" monster from your hand. You can only use this effect of "Shadow-Heart Imp" once per turn.',
    image: "assets/Shadow-Heart Imp.png",
    effects: [
      {
        id: "shadow_heart_imp_on_summon",
        timing: "on_event",
        event: "after_summon",
        summonMethod: "normal",
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
            type: "move",
            targetRef: "imp_special_from_hand",
            player: "self",
            to: "field",
            position: "attack",
            isFacedown: false,
            resetAttackFlags: true,
          },
        ],
      },
    ],
  },
  {
    id: 61,
    name: "Shadow-Heart Gecko",
    cardKind: "monster",
    atk: 1000,
    def: 1000,
    level: 3,
    type: "Reptile",
    archetype: "Shadow-Heart",
    description:
      'If this card is Special Summoned: You can add 1 Level 8 "Shadow-Heart" monster from your Deck to your hand. If this card is destroyed by battle: draw 1 card. You can only use each effect of "Shadow-Heart Gecko" once per turn.',
    image: "assets/Shadow-Heart Gecko.png",
    effects: [
      {
        id: "shadow_heart_gecko_special_search",
        timing: "on_event",
        event: "after_summon",
        summonMethod: "special",
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
    id: 62,
    name: "Shadow-Heart Coward",
    cardKind: "monster",
    atk: 800,
    def: 1000,
    level: 3,
    type: "Fiend",
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
    id: 63,
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
            type: "revive_shadowheart_from_grave",
            player: "self",
            position: "attack",
          },
        ],
      },
    ],
  },
  {
    id: 64,
    name: "Shadow-Heart Scale Dragon",
    cardKind: "monster",
    atk: 3000,
    def: 2500,
    level: 8,
    type: "Dragon",
    archetype: "Shadow-Heart",
    requiredTributes: 3,
    description:
      'Requires 3 tributes to Normal Summon/Set. Once per turn, if this card destroys a monster by battle: You can target 1 "Shadow-Heart" card in your Graveyard; add it to your hand.',
    image: "assets/Shadow-Heart Scale Dragon.png",
    effects: [
      {
        id: "shadow_heart_scale_dragon_recycle",
        timing: "on_event",
        event: "battle_destroy",
        requireSelfAsAttacker: true,
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
    ],
  },
  {
    id: 65,
    name: "Shadow-Heart Rage",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Shadow-Heart",
    description:
      'If "Shadow-Heart Scale Dragon" is the only monster you control: It gains 700 ATK/DEF until the end of this turn, and it can make a second attack during this Battle Phase.',
    image: "assets/Shadow-Heart Rage.png",
    effects: [
      {
        id: "shadow_heart_rage_scale_buff_effect",
        timing: "on_play",
        speed: 1,
        actions: [
          {
            type: "shadow_heart_rage_scale_buff",
            atkBoost: 700,
            defBoost: 700,
          },
        ],
      },
    ],
  },
  {
    id: 66,
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
        timing: "on_event",
        event: "standby_phase",
        actions: [
          {
            type: "shadow_heart_shield_upkeep",
          },
        ],
      },
    ],
  },
  {
    id: 67,
    name: "Shadow-Heart Griffin",
    cardKind: "monster",
    atk: 2000,
    def: 1500,
    level: 5,
    type: "Winged Beast",
    archetype: "Shadow-Heart",
    altTribute: { type: "no_tribute_if_empty_field" },
    description:
      "If you control no monsters, you can Normal Summon this card without Tributing.",
    image: "assets/Shadow-Heart Griffin.png",
    effects: [],
  },
  {
    id: 68,
    name: "Darkness Valley",
    cardKind: "spell",
    subtype: "field",
    archetype: "Shadow-Heart",
    description:
      'All "Shadow-Heart" monsters you control gain 300 ATK. Once per turn, if a Level 8 or higher "Shadow-Heart" monster you control is destroyed by battle: destroy the attacking monster.',
    image: "assets/Darkness Valley.png",
    effects: [
      {
        id: "darkness_valley_activate",
        timing: "on_field_activate",
        actions: [
          {
            type: "darkness_valley_apply_existing",
            amount: 300,
            archetype: "Shadow-Heart",
          },
        ],
      },
      {
        id: "darkness_valley_summon_buff",
        timing: "on_event",
        event: "after_summon",
        actions: [
          {
            type: "darkness_valley_buff_summon",
            amount: 300,
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
            type: "darkness_valley_cleanup",
            amount: 300,
            archetype: "Shadow-Heart",
          },
        ],
      },
      {
        id: "darkness_valley_battle_punish",
        timing: "on_event",
        event: "battle_destroy",
        oncePerTurn: true,
        oncePerTurnName: "Darkness Valley",
        actions: [
          {
            type: "darkness_valley_battle_punish",
            archetype: "Shadow-Heart",
            minLevel: 8,
          },
        ],
      },
    ],
  },
  {
    id: 69,
    name: "Shadow-Heart Death Wyrm",
    cardKind: "monster",
    atk: 2400,
    def: 2000,
    level: 8,
    type: "Fiend",
    archetype: "Shadow-Heart",
    description:
      'Quick Effect: Once per turn, when a "Shadow-Heart" monster you control is destroyed by battle: You can Special Summon this card from your hand.',
    image: "assets/Shadow-Heart Death Wyrm.png",
    effects: [
      {
        id: "shadow_heart_death_wyrm_hand_summon",
        timing: "on_event",
        event: "battle_destroy",
        oncePerTurn: true,
        oncePerTurnName: "Shadow-Heart Death Wyrm",
        actions: [
          {
            type: "shadow_heart_death_wyrm_special_summon",
          },
        ],
      },
    ],
  },
  {
    id: 70,
    name: "Shadow-Heart Leviathan",
    cardKind: "monster",
    atk: 2200,
    def: 1800,
    level: 6,
    type: "Sea Serpent",
    archetype: "Shadow-Heart",
    description:
      "If this card destroys a monster by battle: inflict 500 damage to your opponent. If this card is destroyed by battle: inflict 800 damage to your opponent.",
    image: "assets/Shadow-Heart Leviathan.png",
    effects: [
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
    id: 71,
    name: "Shadow-Heart Void Mage",
    cardKind: "monster",
    atk: 1500,
    def: 1500,
    level: 4,
    type: "Spellcaster",
    archetype: "Shadow-Heart",
    description:
      'If this card is Normal Summoned: You can add 1 "Shadow-Heart" Spell/Trap from your Deck to your hand. If your opponent loses LP while this card is on the field: draw 1 card.',
    image: "assets/Shadow-Heart Void Mage.png",
    effects: [
      {
        id: "shadow_heart_void_mage_search",
        timing: "on_event",
        event: "after_summon",
        summonMethod: "normal",
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
    id: 72,
    name: "Shadow-Heart Cathedral",
    cardKind: "spell",
    subtype: "continuous",
    archetype: "Shadow-Heart",
    description:
      'Each time your opponent takes damage: place 1 Judgment Counter on this card for each 500 damage they took. During your Main Phase: You can send this face-up card to the GY; Special Summon 1 "Shadow-Heart" monster from your Deck with ATK less than or equal to 500 x the number of Judgment Counters on this card. You can only use this effect of "Shadow-Heart Cathedral" once per turn.',
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
            type: "shadow_heart_cathedral_summon",
            counterType: "judgment_marker",
            counterMultiplier: 500,
          },
        ],
      },
    ],
  },
  {
    id: 73,
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
        timing: "ignition",
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
            type: "the_shadow_heart_special_summon_and_equip",
            targetRef: "shadow_heart_gy_target",
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
    id: 74,
    name: "Shadow-Heart Demon Dragon",
    cardKind: "monster",
    monsterType: "fusion",
    atk: 3000,
    def: 3000,
    level: 10,
    type: "Dragon",
    archetype: "Shadow-Heart",
    archetypes: ["Shadow-Heart"],
    description:
      "Shadow-Heart Scale Dragon + 1 level 5+ 'Shadow-Heart' monster. If this card is Fusion Summoned: target 2 cards your opponent controls; destroy them. If this card is destroyed by battle or card effect: You can Special Summon 1 'Shadow-Heart Scale Dragon' from your GY.",
    image: "assets/Shadow-Heart Demon Dragon.png",
    fusionMaterials: [
      { name: "Shadow-Heart Scale Dragon", count: 1 },
      { archetype: "Shadow-Heart", minLevel: 5, count: 1 },
    ],
    effects: [
      {
        id: "demon_dragon_fusion_destroy",
        timing: "on_event",
        event: "after_summon",
        summonMethod: "fusion",
        actions: [
          {
            type: "demon_dragon_destroy_two",
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
            type: "demon_dragon_revive_scale_dragon",
          },
        ],
      },
    ],
  },
  {
    id: 101,
    name: "Luminarch Valiant ÔÇô Knight of the Dawn",
    cardKind: "monster",
    atk: 1600,
    def: 1200,
    level: 4,
    type: "Warrior",
    archetype: "Luminarch",
    piercing: true,
    description:
      'If this card is Normal or Special Summoned: Add 1 Level 4 or lower "Luminarch" monster from your Deck to your hand. If this card battles a Defense Position monster, inflict piercing battle damage to your opponent.',
    image: "assets/Luminarch Valiant ÔÇô Knight of the Dawn.png",
    effects: [
      {
        id: "luminarch_valiant_search",
        timing: "on_event",
        event: "after_summon",
        summonMethod: ["normal", "special"],
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
    id: 102,
    name: "Luminarch Holy Shield",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Luminarch",
    description:
      'Target up to 3 "Luminarch" monsters you control; until the end of this turn, they cannot be destroyed by battle, and any battle damage you would take involving those monsters is gained instead.',
    image: "assets/Luminarch Holy Shield.png",
    effects: [
      {
        id: "luminarch_holy_shield_effect",
        timing: "on_play",
        speed: 1,
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
          },
          {
            type: "add_status",
            targetRef: "holy_shield_targets",
            status: "battleDamageHealsControllerThisTurn",
            value: true,
          },
        ],
      },
    ],
  },
  {
    id: 103,
    name: "Luminarch Aegisbearer",
    cardKind: "monster",
    atk: 1000,
    def: 2000,
    level: 4,
    type: "Warrior",
    archetype: "Luminarch",
    mustBeAttacked: true,
    description:
      "If this card is Special Summoned: Increase its DEF by 500. While this card is face-up on the field, your opponent's attacks must target this card, if possible.",
    image: "assets/Luminarch Aegisbearer.png",
    effects: [
      {
        id: "luminarch_aegisbearer_def_boost",
        timing: "on_event",
        event: "after_summon",
        summonMethod: "special",
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
    id: 104,
    name: "Luminarch Moonblade Captain",
    cardKind: "monster",
    atk: 2200,
    def: 1700,
    level: 6,
    type: "Warrior",
    archetype: "Luminarch",
    description:
      'If this card is Normal Summoned: You can target 1 Level 4 or lower "Luminarch" monster in your GY; Special Summon it. Once per turn, if this card destroys an opponent\'s monster by battle: it can make a second attack this turn.',
    image: "assets/Luminarch Moonblade Captain.png",
    effects: [
      {
        id: "moonblade_captain_revive",
        timing: "on_event",
        event: "after_summon",
        summonMethod: ["normal", "tribute"],
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
            type: "move",
            targetRef: "moonblade_revive_target",
            player: "self",
            to: "field",
            isFacedown: false,
            resetAttackFlags: true,
          },
        ],
      },
      {
        id: "moonblade_captain_second_attack",
        timing: "on_event",
        event: "battle_destroy",
        requireSelfAsAttacker: true,
        oncePerTurn: true,
        oncePerTurnName: "luminarch_moonblade_second_attack",
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
    id: 105,
    name: "Luminarch Celestial Marshal",
    cardKind: "monster",
    atk: 2500,
    def: 2000,
    level: 7,
    type: "Warrior",
    archetype: "Luminarch",
    piercing: true,
    battleIndestructibleOncePerTurn: true,
    description:
      "If this card battles a Defense Position monster, inflict piercing battle damage to your opponent. Once per turn, this card cannot be destroyed by battle.",
    image: "assets/Luminarch Celestial Marshal.png",
    effects: [],
  },
  {
    id: 106,
    name: "Luminarch Magic Sickle",
    cardKind: "monster",
    atk: 1000,
    def: 1000,
    level: 3,
    type: "Warrior",
    archetype: "Luminarch",
    description:
      'You can send this card from the field to the GY; add up to 2 "Luminarch" monsters from your GY to your hand.',
    image: "assets/Luminarch Magic Sickle.png",
    effects: [
      {
        id: "luminarch_magic_sickle_effect",
        timing: "ignition",
        oncePerTurn: true,
        oncePerTurnName: "luminarch_magic_sickle_effect",
        targets: [
          {
            id: "magic_sickle_self",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            cardName: "Luminarch Magic Sickle",
            count: { min: 1, max: 1 },
            requireThisCard: true,
            autoSelect: true,
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "magic_sickle_self",
            to: "graveyard",
          },
          {
            type: "add_from_zone_to_hand",
            zone: "graveyard",
            filters: {
              cardKind: "monster",
              archetype: "Luminarch",
              excludeSelf: true,
            },
            count: { min: 0, max: 2 },
          },
        ],
      },
    ],
  },
  {
    id: 107,
    name: "Luminarch Sanctum Protector",
    cardKind: "monster",
    atk: 1800,
    def: 2800,
    level: 7,
    type: "Warrior",
    archetype: "Luminarch",
    description:
      'If you control a face-up "Luminarch Aegisbearer", you can send it to the GY; Special Summon this card from your hand. Once per turn, when an opponent\'s monster declares an attack (Quick Effect): negate that attack.',
    image: "assets/Luminarch Sanctum Protector.png",
    effects: [
      {
        id: "luminarch_sanctum_protector_negate",
        timing: "on_event",
        event: "attack_declared",
        speed: 2,
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
    id: 108,
    name: "Luminarch Radiant Lancer",
    cardKind: "monster",
    atk: 2600,
    def: 2000,
    level: 8,
    type: "Warrior",
    archetype: "Luminarch",
    description:
      "If this card destroys an opponent's monster by battle, it gains 200 ATK while it remains on the field. If this card is destroyed by battle, destroy 1 Spell/Trap your opponent controls.",
    image: "assets/Luminarch Radiant Lancer.png",
    effects: [
      {
        id: "luminarch_radiant_lancer_atk_boost",
        timing: "on_event",
        event: "battle_destroy",
        requireSelfAsAttacker: true,
        actions: [
          {
            type: "permanent_buff_named",
            targetRef: "self",
            atkBoost: 200,
          },
        ],
      },
      {
        id: "luminarch_radiant_lancer_destroy_spelltrap",
        timing: "on_event",
        event: "battle_destroy",
        requireSelfAsDestroyed: true,
        targets: [
          {
            id: "radiant_lancer_destroy_target",
            owner: "opponent",
            zone: "spellTrap",
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
    id: 109,
    name: "Luminarch Aurora Seraph",
    cardKind: "monster",
    atk: 2800,
    def: 2400,
    level: 8,
    type: "Fairy",
    archetype: "Luminarch",
    description:
      "If this card destroys an opponent's monster by battle, gain LP equal to half that monster's ATK. Once per turn, if this card would be destroyed by battle or card effect: you can send 1 \"Luminarch\" monster you control to the GY instead.",
    image: "assets/Luminarch Aurora Seraph.png",
    effects: [
      {
        id: "luminarch_aurora_seraph_heal",
        timing: "on_event",
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
        id: "luminarch_aurora_seraph_protect",
        timing: "passive",
        oncePerTurn: true,
        oncePerTurnName: "luminarch_aurora_seraph_protect",
        oncePerTurnScope: "card",
        replacementEffect: {
          type: "destruction",
          reason: "any", // battle or effect
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
    id: 110,
    name: "Luminarch Sanctified Arbiter",
    cardKind: "monster",
    atk: 1500,
    def: 1000,
    level: 4,
    type: "Warrior",
    archetype: "Luminarch",
    description:
      'If this card is Normal Summoned: You can add 1 "Luminarch" Spell/Trap from your Deck to your hand. You can only use this effect of "Luminarch Sanctified Arbiter" once per turn.',
    image: "assets/Luminarch Sanctified Arbiter.png",
    effects: [
      {
        id: "luminarch_sanctified_arbiter_search",
        timing: "on_event",
        event: "after_summon",
        summonMethod: "normal",
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
    id: 111,
    name: "Luminarch Knights Convocation",
    cardKind: "spell",
    subtype: "continuous",
    archetype: "Luminarch",
    description:
      "Once per turn: discard 1 Level 7 or higher Luminarch monster; add 1 Level 4 or lower Luminarch monster from your Deck to your hand.",
    image: "assets/Luminarch Knights Convocation.png",
    effects: [
      {
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
            minLevel: 7,
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
    ],
  },
  {
    id: 112,
    name: "Sanctum of the Luminarch Citadel",
    cardKind: "spell",
    subtype: "field",
    archetype: "Luminarch",
    description:
      'Whenever an opponent\'s monster declares an attack: gain 500 LP. Once per turn: You can pay 1000 LP, then target 1 "Luminarch" monster you control; it gains 500 ATK/DEF until the end of this turn.',
    image: "assets/Sanctum of the Luminarch Citadel.png",
    effects: [
      {
        id: "sanctum_luminarch_citadel_attack_heal",
        timing: "on_event",
        event: "attack_declared",
        requireOpponentAttack: true,
        actions: [
          {
            type: "heal",
            player: "self",
            amount: 500,
          },
        ],
      },
      {
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
        actions: [
          {
            type: "damage",
            player: "self",
            amount: 1000,
          },
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
    id: 113,
    name: "Luminarch Holy Ascension",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Luminarch",
    description:
      'Pay 1000 LP, then target 1 "Luminarch" monster you control; it gains 800 ATK/DEF until the end of this turn.',
    image: "assets/Luminarch Holy Ascension.png",
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
        actions: [
          {
            type: "damage",
            player: "self",
            amount: 1000,
          },
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
    id: 114,
    name: "Luminarch Radiant Wave",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Luminarch",
    description:
      'Send 1 "Luminarch" monster with 2000 or more ATK you control to the GY, then target 1 card your opponent controls; destroy it.',
    image: "assets/Luminarch Radiant Wave.png",
    effects: [
      {
        id: "luminarch_radiant_wave_effect",
        timing: "on_play",
        speed: 1,
        targets: [
          {
            id: "radiant_wave_cost",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Luminarch",
            minAtk: 2000,
            count: { min: 1, max: 1 },
          },
          {
            id: "radiant_wave_destroy",
            owner: "opponent",
            zones: ["field", "spellTrap", "fieldSpell"],
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "radiant_wave_cost",
            player: "self",
            to: "graveyard",
          },
          {
            type: "destroy",
            targetRef: "radiant_wave_destroy",
          },
        ],
      },
    ],
  },
  {
    id: 115,
    name: "Luminarch Crescent Shield",
    cardKind: "spell",
    subtype: "equip",
    archetype: "Luminarch",
    description:
      'Equip only to a "Luminarch" monster you control. It gains 500 DEF. If the equipped monster would be destroyed by battle, send this card to the GY instead.',
    image: "assets/Luminarch Crescent Shield.png",
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
    id: 116,
    name: "Luminarch Spear of Dawnfall",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Luminarch",
    description:
      'If you control a "Luminarch" monster: target 1 monster your opponent controls; its ATK and DEF become 0 until the end of this turn.',
    image: "assets/Luminarch Spear of Dawnfall.png",
    effects: [
      {
        id: "luminarch_spear_dawnfall",
        timing: "on_play",
        speed: 1,
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
    id: 117,
    name: "Luminarch Enchanted Halberd",
    cardKind: "monster",
    atk: 1600,
    def: 1400,
    level: 4,
    type: "Warrior",
    archetype: "Luminarch",
    image: "assets/Luminarch Enchanted Halberd.png",
    description:
      'Uma vez por turno, se um monstro "Luminarch" for invocado por invoca├º├úo especial no seu campo; voc├¬ pode invocar essa carta por invoca├º├úo especial da sua m├úo, mas ela n├úo pode declarar um ataque neste turno.',
    effects: [
      {
        id: "luminarch_enchanted_halberd_conditional_summon",
        timing: "on_event",
        event: "after_summon",
        summonMethod: "special",
        oncePerTurn: true,
        oncePerTurnName: "luminarch_enchanted_halberd_conditional_summon",
        condition: {
          triggerArchetype: "Luminarch",
          requires: "self_in_hand",
        },
        promptUser: true,
        promptMessage:
          "Um monstro Luminarch foi invocado por invoca├º├úo especial. Deseja invocar Luminarch Enchanted Halberd da sua m├úo?",
        actions: [
          {
            type: "conditional_special_summon_from_hand",
            restrictAttackThisTurn: true,
          },
        ],
      },
    ],
  },
  {
    id: 118,
    name: "Luminarch Moonlit Blessing",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Luminarch",
    description:
      'Target 1 "Luminarch" monster in your Graveyard; add it to your hand, then if you control "Sanctum of the Luminarch Citadel", you can Special Summon that monster. You can only activate 1 "Luminarch Moonlit Blessing" per turn.',
    image: "assets/Luminarch Moonlit Blessing.png",
    effects: [
      {
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
    id: 119,
    name: "Luminarch Sacred Judgment",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Luminarch",
    description:
      'If you control no monsters and your opponent controls 2 or more monsters: Pay 2000 LP; Special Summon "Luminarch" monsters from your GY, up to the number of monsters your opponent controls, then gain 500 LP for each monster Special Summoned. You can only activate 1 "Luminarch Sacred Judgment" per turn.',
    image: "assets/Luminarch Sacred Judgment.png",
    effects: [
      {
        id: "luminarch_sacred_judgment_effect",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "luminarch_sacred_judgment",
        conditions: [
          { type: "playerFieldEmpty" },
          { type: "opponentMonstersMin", min: 2 },
          { type: "playerLpMin", min: 2000 },
          {
            type: "graveyardHasMatch",
            owner: "self",
            zone: "graveyard",
            filters: { cardKind: "monster", archetype: "Luminarch" },
          },
        ],
        actions: [
          {
            type: "pay_lp",
            amount: 2000,
            player: "self",
          },
          {
            type: "special_summon_from_graveyard",
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
    id: 120,
    name: "Luminarch Megashield Barbarias",
    cardKind: "monster",
    monsterType: "fusion",
    atk: 2500,
    def: 3000,
    level: 9,
    type: "Warrior",
    archetype: "Luminarch",
    archetypes: ["Luminarch"],
    description:
      "'Luminarch Sanctum Protector' + 1 Level 5 or higher 'Luminarch' monster. All LP you would gain is doubled. Once per turn: You can target 1 monster you control; switch its battle position, and if you do, it gains 800 ATK until the end of this turn.",
    image: "assets/Luminarch Megashield Barbarias.png",
    fusionMaterials: [
      { name: "Luminarch Sanctum Protector", count: 1 },
      { archetype: "Luminarch", minLevel: 5, count: 1 },
    ],
    effects: [
      {
        id: "megashield_barbarias_lp_doubling",
        timing: "passive",
        actions: [],
      },
      {
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
            requireFaceup: true,
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
    id: 151,
    name: "Void Conjurer",
    cardKind: "monster",
    atk: 1700,
    def: 800,
    level: 4,
    type: "Spellcaster",
    archetype: "Void",
    description:
      "Special Summon 1 Level 4 or lower 'Void' monster from your Deck, but it cannot attack this turn. If this card is in your GY: You can send 1 'Void' monster you control to the GY; Special Summon this card. You can only use each effect of 'Void Conjurer' once per turn.",
    image: "assets/Void Conjurer.png",
    effects: [
      {
        id: "void_conjurer_field_summon",
        timing: "ignition",
        oncePerTurn: true,
        oncePerTurnName: "void_conjurer_field_summon",
        actions: [
          {
            type: "special_summon_from_deck",
            zone: "deck",
            filters: {
              archetype: "Void",
              cardKind: "monster",
              level: 4,
              levelOp: "lte",
            },
            position: "choice",
            cannotAttackThisTurn: true,
          },
        ],
      },
      {
        id: "void_conjurer_gy_revive",
        timing: "ignition",
        requireZone: "graveyard",
        oncePerTurn: true,
        oncePerTurnName: "void_conjurer_gy_revive",
        targets: [
          {
            id: "void_conjurer_cost",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Void",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "void_conjurer_cost",
            player: "self",
            to: "graveyard",
          },
          {
            type: "special_summon_from_graveyard",
            zone: "graveyard",
            requireSource: true,
            position: "choice",
            cannotAttackThisTurn: false,
          },
        ],
      },
    ],
  },
  {
    id: 152,
    name: "Void Walker",
    cardKind: "monster",
    atk: 1800,
    def: 200,
    level: 4,
    type: "Fiend",
    archetype: "Void",
    description:
      "Cannot attack the turn it is Summoned. Once per turn: You can return this card to your hand; Special Summon 1 Level 4 or lower 'Void' monster from your hand, except 'Void Walker'.",
    image: "assets/Void Walker.png",
    effects: [
      {
        id: "void_walker_no_attack_when_summoned",
        timing: "on_event",
        event: "after_summon",
        summonMethod: ["normal", "special"],
        actions: [
          {
            type: "forbid_attack_this_turn",
          },
        ],
      },
      {
        id: "void_walker_bounce_summon",
        timing: "ignition",
        oncePerTurn: true,
        oncePerTurnName: "void_walker_bounce_summon",
        actions: [
          {
            type: "bounce_and_summon",
            bounceSource: true,
            filters: {
              archetype: "Void",
              cardKind: "monster",
              level: 4,
              levelOp: "lte",
              excludeSelf: true,
            },
            position: "choice",
            cannotAttackThisTurn: false,
          },
        ],
      },
    ],
  },
  {
    id: 153,
    name: "Void Beast",
    cardKind: "monster",
    atk: 1600,
    def: 1300,
    level: 4,
    type: "Beast",
    archetype: "Void",
    description:
      "If this card destroys an opponent's monster by battle: You can add 1 'Void Hollow' from your Deck to your hand. You can only use this effect of 'Void Beast' once per turn.",
    image: "assets/Void Beast.png",
    effects: [
      {
        id: "void_beast_search",
        timing: "on_event",
        event: "battle_destroy",
        requireSelfAsAttacker: true,
        oncePerTurn: true,
        oncePerTurnName: "void_beast_search",
        actions: [
          {
            type: "search_any",
            cardName: "Void Hollow",
          },
        ],
      },
    ],
  },
  {
    id: 154,
    name: "Void Hollow",
    cardKind: "monster",
    atk: 1300,
    def: 1200,
    level: 3,
    type: "Fiend",
    archetype: "Void",
    description:
      "If this card is Special Summoned from your hand: You can Special Summon 1 'Void Hollow' from your Deck. You can only use this effect of 'Void Hollow' once per turn.",
    image: "assets/Void Hollow.png",
    effects: [
      {
        id: "void_hollow_summon",
        timing: "on_event",
        event: "after_summon",
        summonMethod: "special",
        oncePerTurn: true,
        oncePerTurnName: "void_hollow_summon",
        condition: {
          requires: "self_in_hand",
        },
        actions: [
          {
            type: "special_summon_from_deck",
            zone: "deck",
            filters: {
              name: "Void Hollow",
              cardKind: "monster",
            },
            position: "choice",
            cannotAttackThisTurn: false,
            promptPlayer: true,
          },
        ],
      },
    ],
  },
  {
    id: 155,
    name: "Void Haunter",
    cardKind: "monster",
    atk: 2100,
    def: 1500,
    level: 5,
    type: "Fiend",
    archetype: "Void",
    description:
      "You can send 1 'Void Hollow' from your field to your GY; Special Summon this card from your hand. You can banish this card from your GY, then target up to 2 'Void Hollow' in your GY; Special Summon those targets, but their ATK/DEF become 0. You can only use each effect of 'Void Haunter' once per turn.",
    image: "assets/Void Haunter.png",
    effects: [
      {
        id: "void_haunter_special_summon_hand",
        timing: "ignition",
        requireZone: "hand",
        oncePerTurn: true,
        oncePerTurnName: "void_haunter_special_summon_hand",
        targets: [
          {
            id: "void_haunter_cost",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            cardName: "Void Hollow",
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "special_summon_from_hand_with_cost",
            costTargetRef: "void_haunter_cost",
            position: "attack",
            cannotAttackThisTurn: false,
          },
        ],
      },
      {
        id: "void_haunter_gy_effect",
        timing: "ignition",
        requireZone: "graveyard",
        oncePerTurn: true,
        oncePerTurnName: "void_haunter_gy_effect",
        actions: [
          {
            type: "special_summon_from_graveyard",
            zone: "graveyard",
            requireSource: false,
            banishCost: true,
            filters: {
              name: "Void Hollow",
              cardKind: "monster",
            },
            count: { min: 0, max: 3 },
            position: "choice",
            cannotAttackThisTurn: false,
          },
        ],
      },
    ],
  },
  {
    id: 156,
    name: "Void Ghost Wolf",
    cardKind: "monster",
    atk: 1400,
    def: 600,
    level: 3,
    type: "Beast",
    archetype: "Void",
    description:
      "Once per turn: You can halve this card's ATK until the end of this turn, and if you do, it can attack directly this turn.",
    image: "assets/Void Ghost Wolf.png",
    effects: [
      {
        id: "void_ghost_wolf_direct",
        timing: "ignition",
        oncePerTurn: true,
        oncePerTurnName: "void_ghost_wolf_direct",
        targets: [
          {
            id: "ghost_self",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            cardName: "Void Ghost Wolf",
            count: { min: 1, max: 1 },
            autoSelect: true,
            requireThisCard: true,
          },
        ],
        actions: [
          {
            type: "modify_stats_temp",
            targetRef: "ghost_self",
            atkFactor: 0.5,
          },
          {
            type: "allow_direct_attack_this_turn",
            targetRef: "ghost_self",
          },
        ],
      },
    ],
  },
  {
    id: 157,
    name: "Void Hollow King",
    cardKind: "monster",
    atk: 2500,
    def: 1200,
    level: 6,
    type: "Fiend",
    archetype: "Void",
    description:
      "3 'Void Hollow' monsters. If this card is destroyed by battle or card effect: You can Special Summon up to 3 'Void Hollow' from your GY.",
    image: "assets/Void Hollow King.png",
    monsterType: "fusion",
    fusionMaterials: [{ name: "Void Hollow", count: 3 }],
    effects: [
      {
        id: "void_hollow_king_revive",
        timing: "on_event",
        event: "card_to_grave",
        requireSelfAsDestroyed: true,
        actions: [
          {
            type: "special_summon_from_graveyard",
            zone: "graveyard",
            requireSource: false,
            filters: {
              name: "Void Hollow",
              cardKind: "monster",
            },
            count: { min: 0, max: 3 },
            position: "choice",
            cannotAttackThisTurn: false,
          },
        ],
      },
    ],
  },
  {
    id: 158,
    name: "Void Bone Spider",
    cardKind: "monster",
    atk: 2200,
    def: 1400,
    level: 6,
    type: "Insect",
    archetype: "Void",
    description:
      "Target 1 monster your opponent controls; it cannot attack until the end of the next turn. If this card is sent from the field to the Graveyard: Special Summon a 'Void Little Spider' token (Level 1, 500 ATK/DEF).",
    image: "assets/Void Bone Spider.png",
    effects: [
      {
        id: "void_bone_spider_lock",
        timing: "ignition",
        oncePerTurn: true,
        oncePerTurnName: "void_bone_spider_lock",
        targets: [
          {
            id: "void_bone_spider_lock_target",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            count: { min: 1, max: 1 },
            requireFaceup: true,
          },
        ],
        actions: [
          {
            type: "forbid_attack_next_turn",
            targetRef: "void_bone_spider_lock_target",
            turns: 1,
          },
        ],
      },
      {
        id: "void_bone_spider_token",
        timing: "on_event",
        event: "card_to_grave",
        fromZone: "field",
        actions: [
          {
            type: "special_summon_token",
            player: "self",
            position: "attack",
            token: {
              name: "Void Little Spider",
              atk: 500,
              def: 500,
              level: 1,
              type: "Insect",
              image: "assets/Void Little Spider.png",
              description: "A Void token woven from the spider's bone husk.",
            },
          },
        ],
      },
    ],
  },
  {
    id: 159,
    name: "Void Forgotten Knight",
    cardKind: "monster",
    atk: 2000,
    def: 1000,
    level: 5,
    type: "Fiend",
    archetype: "Void",
    description:
      "You can send a 'Void' monster you control to the GY; Special Summon this card from your hand. You can banish this card from your GY; destroy 1 Spell/Trap your opponent controls. You can only use each effect of 'Void Forgotten Knight' once per turn.",
    image: "assets/Void Forgotten Knight.png",
    effects: [
      {
        id: "void_forgotten_knight_hand_summon",
        timing: "ignition",
        requireZone: "hand",
        oncePerTurn: true,
        oncePerTurnName: "void_forgotten_knight_hand_summon",
        targets: [
          {
            id: "void_forgotten_knight_cost",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Void",
            excludeCardName: "Void Forgotten Knight",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "special_summon_from_hand_with_cost",
            costTargetRef: "void_forgotten_knight_cost",
            position: "attack",
            cannotAttackThisTurn: false,
          },
        ],
      },
      {
        id: "void_forgotten_knight_gy_destroy",
        timing: "ignition",
        requireZone: "graveyard",
        oncePerTurn: true,
        oncePerTurnName: "void_forgotten_knight_gy_destroy",
        targets: [
          {
            id: "void_forgotten_knight_gy_self",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            cardName: "Void Forgotten Knight",
            count: { min: 1, max: 1 },
            autoSelect: true,
          },
          {
            id: "void_forgotten_knight_gy_target",
            owner: "opponent",
            zones: ["spellTrap", "fieldSpell"],
            count: { min: 1, max: 1 },
            requireFaceup: true,
          },
        ],
        actions: [
          {
            type: "banish",
            targetRef: "void_forgotten_knight_gy_self",
          },
          {
            type: "destroy",
            targetRef: "void_forgotten_knight_gy_target",
          },
        ],
      },
    ],
  },
  {
    id: 160,
    name: "Void Raven",
    cardKind: "monster",
    atk: 300,
    def: 300,
    level: 2,
    type: "Winged Beast",
    archetype: "Void",
    description:
      "Se um monstro de fus├úo 'Void' for Invocado por Invoca├º├úo-Fus├úo: voc├¬ pode descartar esta carta da m├úo; esse monstro fica imune aos efeitos de cartas do oponente at├® o final do pr├│ximo turno.",
    image: "assets/Void Raven.png",
    effects: [
      {
        id: "void_raven_fusion_immunity",
        timing: "on_event",
        event: "after_summon",
        summonMethod: "fusion",
        promptUser: true,
        promptMessage:
          "Descartar Void Raven para proteger o monstro 'Void' rec├®m-invocado?",
        oncePerTurn: true,
        oncePerTurnName: "void_raven_fusion_immunity",
        condition: {
          requires: "self_in_hand",
          triggerArchetype: "Void",
        },
        targets: [
          {
            id: "void_raven_discard_cost",
            owner: "self",
            zone: "hand",
            cardKind: "monster",
            cardName: "Void Raven",
            requireThisCard: true,
            count: { min: 1, max: 1 },
            autoSelect: true,
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "void_raven_discard_cost",
            player: "self",
            to: "graveyard",
          },
          {
            type: "grant_void_fusion_immunity",
            durationTurns: 1,
          },
        ],
      },
    ],
  },
  {
    id: 161,
    name: "Void Tenebris Horn",
    cardKind: "monster",
    atk: 1500,
    def: 800,
    level: 4,
    type: "Fiend",
    archetype: "Void",
    description:
      "Ganha 100 ATK/DEF para cada carta 'Void' no campo. Uma vez por duelo, se esta carta estiver no seu Cemit├®rio, voc├¬ pode Invoc├í-la por Invoca├º├úo-Especial.",
    image: "assets/Void Tenebris Horn.png",
    effects: [
      {
        id: "void_tenebris_horn_revive",
        timing: "ignition",
        requireZone: "graveyard",
        oncePerDuel: true,
        oncePerDuelName: "void_tenebris_horn_revive",
        targets: [
          {
            id: "void_tenebris_horn_self",
            owner: "self",
            zone: "graveyard",
            cardKind: "monster",
            cardName: "Void Tenebris Horn",
            count: { min: 1, max: 1 },
            requireThisCard: true,
            autoSelect: true,
          },
        ],
        actions: [
          {
            type: "special_summon_from_graveyard",
            zone: "graveyard",
            requireSource: true,
            position: "choice",
            cannotAttackThisTurn: false,
          },
        ],
      },
    ],
  },
  {
    id: 162,
    name: "Void Slayer Brute",
    cardKind: "monster",
    atk: 2500,
    def: 2000,
    level: 8,
    type: "Fiend",
    archetype: "Void",
    description:
      'You can Special Summon this card from your hand by sending 2 "Void" monsters you control to the GY. If this card destroys an opponent\'s monster by battle: banish that monster.',
    image: "assets/Void Slayer Brute.png",
    effects: [
      {
        id: "void_slayer_brute_hand_summon",
        timing: "ignition",
        requireZone: "hand",
        oncePerTurn: true,
        oncePerTurnName: "void_slayer_brute_hand_summon",
        targets: [
          {
            id: "void_slayer_brute_cost",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Void",
            requireFaceup: true,
            count: { min: 2, max: 2 },
          },
        ],
        actions: [
          {
            type: "special_summon_from_hand_with_cost",
            costTargetRef: "void_slayer_brute_cost",
            position: "attack",
            cannotAttackThisTurn: false,
          },
        ],
      },
      {
        id: "void_slayer_brute_banish_destroyed",
        timing: "on_event",
        event: "battle_destroy",
        requireSelfAsAttacker: true,
        requireDestroyedIsOpponent: true,
        actions: [
          {
            type: "banish_destroyed_monster",
          },
        ],
      },
    ],
  },
  {
    id: 163,
    name: "Void Berserker",
    cardKind: "monster",
    monsterType: "fusion",
    atk: 2800,
    def: 2200,
    level: 8,
    type: "Fiend",
    archetype: "Void",
    description:
      "Void Slayer Brute (on the field) + 1 'Void' monster. This card can make up to 2 attacks during each Battle Phase. Once per turn, if this card destroys an opponent's monster by battle: You can target 1 card your opponent controls; return it to the hand.",
    image: "assets/Void Berserker.png",
    fusionMaterials: [
      { name: "Void Slayer Brute", count: 1, allowedZones: ["field"] },
      { archetype: "Void", count: 1 },
    ],
    extraAttacks: 1,
    effects: [
      {
        id: "void_berserker_bounce_on_destroy",
        timing: "on_event",
        event: "battle_destroy",
        requireSelfAsAttacker: true,
        requireDestroyedIsOpponent: true,
        oncePerTurn: true,
        oncePerTurnName: "void_berserker_bounce_on_destroy",
        promptUser: true,
        promptMessage:
          "Ativar Void Berserker para devolver 1 carta do oponente para a m├úo?",
        targets: [
          {
            id: "void_berserker_bounce_target",
            owner: "opponent",
            zones: ["field", "spellTrap", "fieldSpell"],
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "move",
            targetRef: "void_berserker_bounce_target",
            player: "opponent",
            to: "hand",
          },
        ],
      },
    ],
  },
  {
    id: 164,
    name: "Void Serpent Drake",
    cardKind: "monster",
    atk: 2300,
    def: 1800,
    level: 6,
    type: "Dragon",
    archetype: "Void",
    description:
      'If this card is in your hand: You can send 1-3 "Void Hollow" you control to the GY, then Special Summon this card. Gains effects based on how many were sent: 1+: +300 ATK until end of turn; 2+: also cannot be destroyed by battle; 3: also destroy 1 card your opponent controls. You can only use this effect of "Void Serpent Drake" once per turn.',
    image: "assets/Void Serpent Drake.png",
    effects: [
      {
        id: "void_serpent_drake_hand_special",
        timing: "ignition",
        requireZone: "hand",
        oncePerTurn: true,
        oncePerTurnName: "void_serpent_drake_hand_special",
        actions: [
          {
            type: "special_summon_from_hand_with_tiered_cost",
            costFilters: { name: "Void Hollow", cardKind: "monster" },
            minCost: 1,
            maxCost: 3,
            position: "attack",
            tier1AtkBoost: 300,
            tierOptions: [
              {
                count: 1,
                label: "Tier 1",
                description: "+300 ATK until end of turn",
              },
              {
                count: 2,
                label: "Tier 2",
                description: "+300 ATK and cannot be destroyed by battle",
              },
              {
                count: 3,
                label: "Tier 3",
                description:
                  "+300 ATK, battle indestructible, destroy 1 opponent card",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 165,
    name: "Void Hydra Titan",
    cardKind: "monster",
    monsterType: "fusion",
    atk: 3500,
    def: 2900,
    level: 10,
    type: "Dragon",
    archetype: "Void",
    archetypes: ["Void"],
    description:
      "6 'Void' monsters. If this card is Fusion Summoned: destroy all other monsters you control; draw 1 card for each destroyed. Once per turn: If this card would be destroyed by battle or card effects: You can reduce its ATK by 700; negate the destruction of this card.",
    image: "assets/Void Hydra Titan.png",
    fusionMaterials: [
      {
        archetype: "Void",
        count: 6,
      },
    ],
    effects: [
      {
        id: "void_hydra_titan_summon",
        timing: "on_event",
        event: "after_summon",
        summonMethod: "fusion",
        description:
          "When Fusion Summoned: Destroy all other monsters you control; draw 1 card for each destroyed.",
        actions: [
          {
            type: "destroy_self_monsters_and_draw",
          },
        ],
      },
      {
        id: "void_hydra_titan_negate_destruction",
        timing: "on_event",
        event: "before_destroy",
        description:
          "[Once per turn]: You can negate the destruction of this card; reduce its ATK by 700.",
        oncePerTurnScope: "card",
        oncePerTurnName: "void_hydra_titan_negate_destruction",
        negationCost: [
          {
            type: "reduce_self_atk",
            amount: 700,
          },
        ],
      },
    ],
  },
  {
    id: 166,
    name: "Sealing the Void",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Void",
    description:
      "Target 1 face-up 'Void' monster you control; until the end of this turn, that monster's ATK/DEF become 0, and its effects are negated. If this effect resolves, you can conduct 1 additional Normal Summon this turn. You can only activate 1 'Sealing the Void' per turn.",
    image: "assets/Sealing the Void.png",
    effects: [
      {
        id: "sealing_the_void_effect",
        timing: "on_activate",
        oncePerTurn: true,
        oncePerTurnName: "sealing_the_void_effect",
        targets: [
          {
            id: "void_monster_target",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            archetype: "Void",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          {
            type: "set_stats_to_zero_and_negate",
            targetRef: "void_monster_target",
            setAtkToZero: true,
            setDefToZero: true,
            negateEffects: true,
          },
          {
            type: "grant_additional_normal_summon",
            count: 1,
          },
        ],
      },
    ],
  },
  {
    id: 167,
    name: "The Void",
    cardKind: "spell",
    subtype: "field",
    archetype: "Void",
    description:
      "During your Main Phase, if you control no monsters: You can Special Summon 1 Level 4 or lower 'Void' monster from your Graveyard, but its effects are negated. You can only use this effect of 'The Void' once per turn.",
    image: "assets/The Void.png",
    effects: [
      {
        id: "the_void_summon",
        timing: "on_field_activate",
        manualActivationOnly: true,
        oncePerTurn: true,
        oncePerTurnName: "the_void_summon",
        requireEmptyField: true,
        actions: [
          {
            type: "special_summon_from_deck",
            zone: "graveyard",
            filters: {
              archetype: "Void",
              cardKind: "monster",
              level: 4,
              levelOp: "lte",
            },
            position: "choice",
            negateEffects: true,
            promptPlayer: true,
          },
        ],
      },
    ],
  },
  {
    id: 168,
    name: "Void Gravitational Pull",
    cardKind: "spell",
    subtype: "continuous",
    archetype: "Void",
    description:
      "Once per turn: You can target 1 monster you control and 1 monster your opponent controls; return those targets to the hand.",
    image: "assets/Void Gravitational pull.png",
    effects: [
      {
        id: "void_gravitational_pull_bounce",
        timing: "ignition",
        requireZone: "field",
        manualActivationOnly: true,
        oncePerTurn: true,
        oncePerTurnName: "void_gravitational_pull_bounce",
        targets: [
          {
            id: "void_gravitational_self",
            owner: "self",
            zone: "field",
            cardKind: "monster",
            requireFaceup: true,
            count: { min: 1, max: 1 },
          },
          {
            id: "void_gravitational_opponent",
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
            targetRef: "void_gravitational_self",
            player: "self",
            to: "hand",
          },
          {
            type: "move",
            targetRef: "void_gravitational_opponent",
            player: "opponent",
            to: "hand",
          },
        ],
      },
    ],
  },
  {
    id: 169,
    name: "Void Lost Throne",
    cardKind: "spell",
    subtype: "normal",
    archetype: "Void",
    description:
      "Destroy as many monsters on the field as possible, except 1 monster with the highest ATK on each side of the field (in case of a tie, you choose 1 to remain on each side). You can only activate 1 'Void Lost Throne' per turn.",
    image: "assets/Void Lost Throne.png",
    effects: [
      {
        id: "void_lost_throne_effect",
        timing: "on_play",
        speed: 1,
        oncePerTurn: true,
        oncePerTurnName: "void_lost_throne",
        actions: [
          {
            type: "selective_field_destruction",
            keepPerSide: 1,
            allowTieBreak: true,
          },
        ],
      },
    ],
  },
  {
    id: 170,
    name: "Void Mirror Dimension",
    cardKind: "trap",
    subtype: "normal",
    archetype: "Void",
    description:
      "Durante a Fase Principal, se seu oponente Invocar por Invoca├º├úo-Especial um monstro: voc├¬ pode Invocar por Invoca├º├úo-Especial 1 monstro da sua m├úo com o mesmo N├¡vel que esse monstro, mas, at├® o final deste turno, seus efeitos s├úo negados. Voc├¬ s├│ pode ativar 1 'Void Mirror Dimension' por turno.",
    image: "assets/Void Mirror Dimension.png",
    effects: [
      {
        id: "void_mirror_dimension_effect",
        timing: "on_event",
        event: "after_summon",
        summonMethod: "special",
        requireOpponentSummon: true,
        requirePhase: ["main1", "main2"],
        oncePerTurn: true,
        oncePerTurnName: "void_mirror_dimension",
        actions: [
          {
            type: "special_summon_matching_level",
            negateEffects: true,
            cannotAttackThisTurn: false,
            position: "choice",
          },
        ],
      },
    ],
  },
];

// Performance optimization: Create indexed maps for O(1) lookups
export const cardDatabaseById = new Map(
  cardDatabase.map((card) => [card.id, card])
);
export const cardDatabaseByName = new Map(
  cardDatabase.map((card) => [card.name, card])
);
