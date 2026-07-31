import type {
  AscensionMonsterDefinition,
  FusionMonsterDefinition,
  MonsterCardDefinition,
  RawCardDefinition,
  SpellCardDefinition,
  SynchroMonsterDefinition,
  TrapCardDefinition,
} from "../../src/core/contracts/cards.js";
import type {
  EffectCondition,
  EffectDefinition,
  EffectTarget,
  EventTriggerEffect,
} from "../../src/core/contracts/effects.js";

const mainDeckMonster: MonsterCardDefinition = {
  id: 9001,
  name: "Schema Monster",
  cardKind: "monster",
  type: "Dragon",
  attribute: "Light",
  level: 4,
  atk: 1800,
  def: 1200,
  image: "assets/schema-monster.png",
  description: "A valid Main Deck monster.",
  effects: [],
};

const fusionMonster: FusionMonsterDefinition = {
  id: 9002,
  name: "Schema Fusion",
  cardKind: "monster",
  monsterType: "fusion",
  type: "Dragon",
  level: 8,
  atk: 2800,
  def: 2400,
  image: "assets/schema-fusion.png",
  description: "A valid Fusion monster.",
  fusionMaterials: [{ type: "Dragon", count: 2 }],
  effects: [],
};

const synchroMonster: SynchroMonsterDefinition = {
  id: 9003,
  name: "Schema Synchro",
  cardKind: "monster",
  monsterType: "synchro",
  type: "Machine",
  level: 7,
  atk: 2500,
  def: 2000,
  image: "assets/schema-synchro.png",
  description: "A valid Synchro monster.",
  synchro: { tunerCount: 1, nonTunerMin: 1 },
  effects: [],
};

const ascensionMonster: AscensionMonsterDefinition = {
  id: 9004,
  name: "Schema Ascension",
  cardKind: "monster",
  monsterType: "ascension",
  type: "Warrior",
  level: 6,
  atk: 2300,
  def: 2100,
  image: "assets/schema-ascension.png",
  description: "A valid Ascension monster.",
  ascension: { materialId: 9001, position: "choice" },
  effects: [],
};

const eventEffect: EventTriggerEffect = {
  id: "schema_event_effect",
  timing: "on_event",
  event: "after_summon",
  triggerRequirement: "optional",
  triggerTiming: "if",
  summonMethods: ["normal", "special"],
  targets: [
    {
      id: "summoned",
      targetFromContext: "summonedCard",
      cardKind: "monster",
      count: { min: 1, max: 1 },
    },
  ],
  conditions: [
    {
      type: "event_card_matches_filters",
      cardRef: "summonedCard",
      filters: { cardKind: "monster", type: "Dragon" },
    },
  ],
  actions: [{ type: "draw", amount: 1, player: "self" }],
};

const rawCards: readonly RawCardDefinition[] = [
  mainDeckMonster,
  fusionMonster,
  synchroMonster,
  ascensionMonster,
  {
    id: 9005,
    name: "Schema Spell",
    cardKind: "spell",
    subtype: "normal",
    image: "assets/schema-spell.png",
    description: "A valid Spell.",
    effects: [eventEffect],
  },
];

const attackerCondition: EffectCondition = {
  type: "attacker_matches",
  owner: "self",
  cardKind: "monster",
  attackerType: "Dragon",
};

const effectlessSpell: SpellCardDefinition = {
  id: 9006,
  name: "Effectless Spell",
  cardKind: "spell",
  subtype: "normal",
  image: "assets/effectless-spell.png",
  description: "A valid Spell without declared effects.",
};

const contextualTarget: EffectTarget = {
  id: "source",
  targetFromContext: "source",
  cardKind: ["monster", "trap"],
  count: { min: 1, max: 1 },
};

// contract-negative: Spells require a supported subtype
// @ts-expect-error
const spellWithoutSubtype: SpellCardDefinition = {
  id: 9100,
  name: "Missing subtype",
  cardKind: "spell",
  image: "assets/missing.png",
  description: "Invalid.",
  effects: [],
};

const spellWithTrapSubtype: SpellCardDefinition = {
  id: 9103,
  name: "Invalid spell subtype",
  cardKind: "spell",
  // contract-negative: counter is a Trap subtype, not a Spell subtype
  // @ts-expect-error
  subtype: "counter",
  image: "assets/missing.png",
  description: "Invalid.",
  effects: [],
};

const trapWithSpellSubtype: TrapCardDefinition = {
  id: 9104,
  name: "Invalid trap subtype",
  cardKind: "trap",
  // contract-negative: equip is a Spell subtype, not a Trap subtype
  // @ts-expect-error
  subtype: "equip",
  image: "assets/missing.png",
  description: "Invalid.",
  effects: [],
};

// contract-negative: Synchro monsters require their summon metadata
// @ts-expect-error
const synchroWithoutMetadata: SynchroMonsterDefinition = {
  id: 9101,
  name: "Missing Synchro metadata",
  cardKind: "monster",
  monsterType: "synchro",
  level: 7,
  atk: 2400,
  def: 1800,
  image: "assets/missing.png",
  description: "Invalid.",
};

const ascensionWithoutMaterial: AscensionMonsterDefinition = {
  id: 9102,
  name: "Missing Ascension material",
  cardKind: "monster",
  monsterType: "ascension",
  level: 6,
  atk: 2200,
  def: 1900,
  image: "assets/missing.png",
  description: "Invalid.",
  // contract-negative: Ascension monsters require an id or filter for material
  // @ts-expect-error
  ascension: { position: "choice" },
};

// contract-negative: on_event effects require trigger requirement and timing
// @ts-expect-error
const incompleteEventEffect: EventTriggerEffect = {
  id: "incomplete_event",
  timing: "on_event",
  event: "after_summon",
};

const targetWithUnknownField: EffectTarget = {
  id: "invalid_target",
  // contract-negative: target declarations reject unknown capabilities
  // @ts-expect-error
  unknownTargetField: true,
};

// contract-negative: condition discriminants are closed and cannot be a race
// @ts-expect-error
const duplicatedTypeCondition: EffectCondition = { type: "Dragon" };

const legacyGateWithStructuredCapability: EffectCondition = {
  type: "destroyed_by_battle",
  // contract-negative: legacy trigger gates reject structured condition fields
  // @ts-expect-error
  attackerType: "Dragon",
};

const effectWithUnknownField: EffectDefinition = {
  id: "invalid_effect",
  timing: "on_play",
  // contract-negative: effect declarations reject unknown capabilities
  // @ts-expect-error
  unknownEffectField: true,
};

void rawCards;
void attackerCondition;
void effectlessSpell;
void contextualTarget;
void spellWithoutSubtype;
void spellWithTrapSubtype;
void trapWithSpellSubtype;
void synchroWithoutMetadata;
void ascensionWithoutMaterial;
void incompleteEventEffect;
void targetWithUnknownField;
void duplicatedTypeCondition;
void legacyGateWithStructuredCapability;
void effectWithUnknownField;
