export const cardDatabase = [
  {
    id: 1,
    name: "Shadow Wolf",
    cardKind: "monster",
    atk: 1200,
    def: 800,
    level: 3,
    type: "Beast",
    description: "A wolf that hunts in the shadows.",
    image: "assets/shadow_wolf.png",
  },
  {
    id: 2,
    name: "Dark Knight",
    cardKind: "monster",
    atk: 1600,
    def: 1400,
    level: 4,
    type: "Warrior",
    description: "A warrior consumed by darkness.",
    image: "assets/dark_knight.png",
  },
  {
    id: 3,
    name: "Mystic Eye",
    cardKind: "monster",
    atk: 500,
    def: 2000,
    level: 3,
    type: "Fiend",
    description: "It sees everything.",
    image: "assets/mystic_eye.png",
  },
  {
    id: 4,
    name: "Bone Dragon",
    cardKind: "monster",
    atk: 2400,
    def: 1000,
    level: 6,
    type: "Dragon",
    description: "A dragon made of ancient bones.",
    image: "assets/bone_dragon.png",
  },
  {
    id: 5,
    name: "Phantom",
    cardKind: "monster",
    atk: 1000,
    def: 1000,
    level: 2,
    type: "Spirit",
    description: "Hard to hit.",
    image: "assets/phantom.png",
  },
  {
    id: 6,
    name: "Gargoyle",
    cardKind: "monster",
    atk: 1400,
    def: 1200,
    level: 4,
    type: "Fiend",
    description: "Turns to stone to defend.",
    image: "assets/gargoyle.png",
  },
  {
    id: 7,
    name: "Abyssal Eel",
    cardKind: "monster",
    atk: 1800,
    def: 400,
    level: 5,
    type: "Sea Serpent",
    description: "Strikes from the deep.",
    image: "assets/abyssal_eel.png",
  },
  {
    id: 8,
    name: "Void Mage",
    cardKind: "monster",
    atk: 1100,
    def: 1900,
    level: 4,
    type: "Spellcaster",
    description: "Uses void magic.",
    image: "assets/phantom.png",
  },
  {
    id: 9,
    name: "Obsidian Golem",
    cardKind: "monster",
    atk: 1000,
    def: 2200,
    level: 6,
    type: "Rock",
    description: "A massive golem made of shiny black obsidian.",
    image: "assets/gargoyle.png",
  },
  {
    id: 10,
    name: "Shadow Reaper",
    cardKind: "monster",
    atk: 2500,
    def: 1000,
    level: 7,
    type: "Fiend",
    description: "A grim reaper figure shrouded in shadows.",
    image: "assets/dark_knight.png",
  },
  {
    id: 11,
    name: "Cursed Specter",
    cardKind: "monster",
    atk: 1400,
    def: 1400,
    level: 3,
    type: "Spirit",
    description: "A floating ghostly figure with chains.",
    image: "assets/phantom.png",
  },
  {
    id: 12,
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
    id: 13,
    name: "Void Walker",
    cardKind: "monster",
    atk: 2800,
    def: 2500,
    level: 8,
    type: "Cosmic",
    description: "A cosmic entity walking through a void portal.",
    image: "assets/mystic_eye.png",
  },
  {
    id: 14,
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
    id: 15,
    name: "Shadow Purge",
    cardKind: "spell",
    subtype: "normal",
    description: "Destroy 1 opponent's monster (highest ATK).",
    image: "assets/Shadow Purge.png",
    effects: [
      {
        id: "shadow_purge_destroy",
        timing: "on_play",
        speed: 1,
        targets: [
          {
            id: "target_monster",
            owner: "opponent",
            zone: "field",
            cardKind: "monster",
            count: { min: 1, max: 1 },
            strategy: "highest_atk",
            autoSelect: true,
          },
        ],
        actions: [{ type: "destroy", targetRef: "target_monster" }],
      },
    ],
  },
  {
    id: 16,
    name: "Blood Sucking",
    cardKind: "spell",
    subtype: "normal",
    description: "Gain 1000 LP.",
    image: "assets/Blood sucking.png",
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
    id: 17,
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
    id: 18,
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
    id: 19,
    name: "Shadow Coat",
    cardKind: "spell",
    subtype: "normal",
    description:
      "Target 1 monster; it gains 1000 ATK until the end of this turn.",
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
            count: { min: 1, max: 1 },
          },
        ],
        actions: [
          { type: "buff_atk_temp", amount: 1000, targetRef: "buff_target" },
        ],
      },
    ],
  },
  {
    id: 20,
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
    id: 21,
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
    id: 22,
    name: "Monster Reborn",
    cardKind: "spell",
    subtype: "normal",
    description:
      "Target 1 monster in your Graveyard; Special Summon it to your field.",
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
            position: "attack",
            isFacedown: false,
            resetAttackFlags: true,
          },
        ],
      },
    ],
  },
  {
    id: 23,
    name: "Shadow Recall",
    cardKind: "spell",
    subtype: "normal",
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
    id: 24, // troca se já estiver usando esse número
    name: "Arcane Scholar",
    cardKind: "monster",
    atk: 1500,
    def: 1200,
    level: 4,
    type: "Spellcaster",
    description: "When this card is Normal Summoned: draw 1 card.",
    image: "assets/Arcane Scholar.png", // cria/ajusta esse arquivo de imagem
    effects: [
      {
        id: "arcane_scholar_on_normal_summon",
        timing: "on_event",
        event: "after_summon",
        // só ativa quando for Invocação-Normal (não Special)
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
    id: 31, // escolhe um id livre
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
    id: 32,
    name: "Shadow-Heart Battle Hymn",
    cardKind: "spell",
    subtype: "normal",
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
            archetype: "Shadow-Heart", // <<< filtro de arquétipo
            count: { min: 1, max: 5 },
            autoSelect: true, // pega automaticamente todos os válidos
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
    id: 33,
    name: "Shadow-Heart Covenant",
    cardKind: "spell",
    subtype: "normal",
    description: 'Add 1 "Shadow-Heart" card from your Deck to your hand.',
    image: "assets/Shadow-Heart Covenant.png",
    effects: [
      {
        id: "shadow_heart_covenant",
        timing: "on_play",
        speed: 1,
        actions: [
          {
            type: "search_any",
            archetype: "Shadow-Heart", // usa o filtro do EffectEngine
          },
        ],
      },
    ],
  },
  {
    id: 34,
    name: "Shadow-Heart Imp",
    cardKind: "monster",
    atk: 1500,
    def: 800,
    level: 4,
    type: "Fiend",
    archetype: "Shadow-Heart",
    description:
      'When this card is Normal Summoned: You can Special Summon 1 Level 4 or lower "Shadow-Heart" monster from your hand.',
    image: "assets/Shadow-Heart Imp.png",
    effects: [
      {
        id: "shadow_heart_imp_on_summon",
        timing: "on_event",
        event: "after_summon",
        summonMethod: "normal",
        targets: [
          {
            id: "imp_special_from_hand",
            owner: "self",
            zone: "hand",
            cardKind: "monster",
            archetype: "Shadow-Heart",
            // por enquanto todos os Shadow-Heart são lvl 4 ou 8;
            // se quiser travar nível no futuro, dá pra adicionar um filtro de level no motor
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
    id: 35,
    name: "Shadow-Heart Gecko",
    cardKind: "monster",
    atk: 1000,
    def: 1000,
    level: 3,
    type: "Reptile",
    archetype: "Shadow-Heart",
    description:
      "If an opponent's monster is destroyed by battle while this card is on the field: Draw 1 card.",
    image: "assets/Shadow-Heart Gecko.png",
    effects: [
      {
        id: "shadow_heart_gecko_draw",
        timing: "on_event",
        event: "battle_destroy",
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
];
