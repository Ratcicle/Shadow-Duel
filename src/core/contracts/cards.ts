import type {
  CardDefinitionId,
  DuelCardId,
  PlayerId,
  RawCardDefinitionId,
} from "./primitives.js";
import type { CardFilter, EffectDefinition } from "./effects.js";
import type { SummonMethod } from "./summon.js";
import type { CanonicalZone } from "./zones.js";

export const CARD_KINDS = Object.freeze(["monster", "spell", "trap"] as const);

export type CardKind = (typeof CARD_KINDS)[number];

/**
 * A missing monsterType represents a Main Deck monster. Only Extra Deck
 * categories with an explicit runtime marker belong to this union.
 */
export const MONSTER_TYPES = Object.freeze([
  "fusion",
  "synchro",
  "ascension",
] as const);

export type MonsterType = (typeof MONSTER_TYPES)[number];

export const BATTLE_POSITIONS = Object.freeze([
  "attack",
  "defense",
] as const);

export type BattlePosition = (typeof BATTLE_POSITIONS)[number];

/**
 * "choice" is an input sentinel used while selecting a summon position. It is
 * never a valid position stored on a card instance.
 */
export const BATTLE_POSITION_INPUTS = Object.freeze([
  ...BATTLE_POSITIONS,
  "choice",
] as const);

export type BattlePositionInput = (typeof BATTLE_POSITION_INPUTS)[number];

/** Minimal mutable carrier accepted by the duel identity allocator. */
export interface DuelCardIdentityCarrier {
  id?: RawCardDefinitionId | number | null;
  name?: string | null;
  duelCardId?: DuelCardId | number | null;
}

export const SPELL_SUBTYPES = Object.freeze([
  "normal",
  "quick",
  "continuous",
  "field",
  "equip",
] as const);

export type SpellSubtype = (typeof SPELL_SUBTYPES)[number];

export const TRAP_SUBTYPES = Object.freeze([
  "normal",
  "continuous",
  "counter",
] as const);

export type TrapSubtype = (typeof TRAP_SUBTYPES)[number];

export type CardSubtype = SpellSubtype | TrapSubtype;

export type CardAttribute =
  | "Dark"
  | "Earth"
  | "Fire"
  | "Light"
  | "Water"
  | "Wind";

export type MonsterRace =
  | "Beast"
  | "Dragon"
  | "Fairy"
  | "Fiend"
  | "Insect"
  | "Machine"
  | "Plant"
  | "Pyro"
  | "Reptile"
  | "Rock"
  | "Sea Serpent"
  | "Spellcaster"
  | "Spirit"
  | "Warrior"
  | "Winged Beast"
  | "Zombie";

export type SpecialSummonProcedure =
  | "special"
  | "card_effect"
  | "fusion"
  | "synchro"
  | "ascension"
  | "contact_fusion"
  | "graveyard_banish_fusion";

export interface BlueprintStorageDefinition {
  readonly maxSlots: number;
  readonly allowedArchetypes: readonly string[];
  readonly allowedCardKinds: readonly CardKind[];
  readonly storableEffectFlag: string;
  readonly allowOverwrite: boolean;
  readonly promptOnStore: boolean;
  readonly autoStoreForAI: boolean;
}

export interface FusionMaterialDefinition {
  readonly count?: number;
  readonly allowedZones?: readonly CanonicalZone[];
  readonly archetype?: string;
  readonly cardKind?: CardKind;
  readonly isToken?: boolean;
  readonly minLevel?: number;
  readonly name?: string;
  readonly type?: MonsterRace;
}

export interface SynchroMaterialFilters {
  readonly all?: CardFilter;
  readonly tuner?: CardFilter;
  readonly nonTuner?: CardFilter;
  readonly non_tuner?: CardFilter;
}

export interface SynchroDefinition {
  readonly tunerCount: number;
  readonly nonTunerMin: number;
  readonly nonTunerMax?: number;
  readonly position?: BattlePositionInput;
  readonly materialFilters?: SynchroMaterialFilters;
}

export interface SynchroMaterialRoles {
  readonly nonTunerFor?: readonly CardFilter[];
}

export interface AscensionRequirement {
  readonly type:
    | "field_counters_at_least"
    | "material_effect_activations"
    | "material_turns_on_field"
    | "material_destroyed_opponent_monsters"
    | "player_lp_gte"
    | "player_lp_lte"
    | "player_hand_gte"
    | "player_graveyard_gte";
  readonly amount?: number;
  readonly count?: number;
  readonly counterType?: string;
  readonly filters?: CardFilter;
  readonly max?: number;
  readonly min?: number;
  readonly owner?: "self" | "opponent" | "any" | "both" | "either";
  readonly reason?: string;
  readonly requireFaceup?: boolean;
  readonly zone?: CanonicalZone;
  readonly zones?: readonly CanonicalZone[];
}

export interface AscensionMaterialRecord {
  instanceId: number | string | null;
  cardId: RawCardDefinitionId | CardDefinitionId | null;
  name: string | null;
  ownerId: PlayerId | string | null;
  controllerId: PlayerId | string | null;
  usedOnTurn: number | null;
}

export interface SynchroMaterialRecord {
  instanceId: number | string | null;
  cardId: RawCardDefinitionId | CardDefinitionId | null;
  name: string | null;
  level: number;
  isTuner: boolean;
  ownerId: PlayerId | string | null;
  controllerId: PlayerId | string | null;
  usedOnTurn: number | null;
}

interface AscensionDefinitionBase {
  readonly position?: BattlePositionInput;
  readonly requirements?: readonly AscensionRequirement[];
}

export type AscensionDefinition = AscensionDefinitionBase &
  (
    | {
        readonly materialId: RawCardDefinitionId;
        readonly materialFilters?: CardFilter;
      }
    | {
        readonly materialId?: RawCardDefinitionId;
        readonly materialFilters: CardFilter;
      }
  );

export interface ExtraDeckProcedureMaterial {
  readonly count: number;
  readonly archetype?: string;
  readonly cardKind?: CardKind;
  readonly name?: string;
  readonly zone?: CanonicalZone;
}

export interface ExtraDeckSummonProcedure {
  readonly type: "contact_fusion" | "graveyard_banish_fusion";
  readonly summonMethod: "fusion";
  readonly materials?: readonly ExtraDeckProcedureMaterial[];
  readonly materialDestination: CanonicalZone;
  readonly requiresManualMaterialSelection?: boolean;
  readonly usesFusionMaterials?: boolean;
}

export interface FieldLimitDefinition {
  readonly key: string;
  readonly label: string;
  readonly scope: "global" | "controller";
  readonly max?: number;
  readonly requireFaceup?: boolean;
  readonly filters: CardFilter;
}

export interface FieldPresenceRestriction {
  readonly type: "only_monster_you_control_while_faceup";
}

export interface TributeValueDefinition {
  readonly countAs: number;
  readonly requireFaceup?: boolean;
  readonly summonMethods?: readonly SummonMethod[];
  readonly summonedCardFilters?: CardFilter;
}

export type AlternateTributeDefinition =
  | {
      readonly type: "no_tribute_if_empty_field";
    }
  | {
      readonly requiresType: MonsterRace;
      readonly tributes: number;
    }
  | {
      readonly requiresName: string;
      readonly tributes: number;
    };

export interface DynamicExtraAttacksDefinition {
  readonly source: "graveyard_count";
  readonly name: string;
}

interface CardDefinitionBase {
  readonly id: RawCardDefinitionId;
  readonly name: string;
  readonly cardKind: CardKind;
  readonly image: string;
  readonly description: string;
  readonly archetype?: string;
  readonly archetypes?: readonly string[];
  readonly effects?: readonly EffectDefinition[];
  readonly goodDiscard?: boolean;
  /** Legacy instance-state inputs still accepted by the Card constructor. */
  readonly effectsNegated?: boolean;
  readonly effectsNegatedDuration?: string | number | null;
  readonly lastSummonMethod?: SummonMethod;
  readonly lastSummonedFromZone?: CanonicalZone;
  readonly lastSummonedTurn?: number;
  readonly lastSummonProcedure?: SpecialSummonProcedure;
  readonly originalOwner?: PlayerId;
  readonly properSummonEstablished?: boolean;
  readonly properSummonProcedure?: SpecialSummonProcedure;
}

interface MonsterDefinitionCore extends CardDefinitionBase {
  readonly cardKind: "monster";
  readonly type?: MonsterRace;
  readonly attribute?: CardAttribute;
  readonly level: number;
  readonly atk: number;
  readonly def: number;
  readonly altTribute?: AlternateTributeDefinition;
  readonly battleIndestructibleOncePerTurn?: boolean;
  readonly battleIndestructibleOncePerTurnLastUsedTurn?: number;
  readonly cannotAttackDirectly?: boolean;
  readonly cannotBeNormalSummonedOrSet?: boolean;
  readonly cannotBeSpecialSummoned?: boolean;
  readonly dynamicExtraAttacks?: DynamicExtraAttacksDefinition;
  readonly extraAttacks?: number;
  readonly extraAttackTargetRestriction?: "monster";
  readonly fieldLimit?: FieldLimitDefinition;
  readonly fieldPresenceRestriction?: FieldPresenceRestriction;
  readonly isTuner?: boolean;
  readonly mustBeAttacked?: boolean;
  readonly mustFirstBeSpecialSummonedBy?: readonly SpecialSummonProcedure[];
  readonly piercing?: boolean;
  readonly piercingDamageMultiplier?: number;
  readonly preventsBattleDamageToController?: boolean;
  readonly specialSummonOnlyBy?: readonly SpecialSummonProcedure[];
  readonly summonRestrict?: string;
  readonly synchroMaterialRoles?: SynchroMaterialRoles;
  readonly tributeValue?: TributeValueDefinition;
  readonly unaffectedByOtherCardEffects?: boolean;
}

export interface MonsterCardDefinition extends MonsterDefinitionCore {
  readonly monsterType?: never;
}

type FusionSummonMetadata =
  | {
      readonly fusionMaterials: readonly FusionMaterialDefinition[];
      readonly extraDeckSummonProcedure?: ExtraDeckSummonProcedure;
    }
  | {
      readonly fusionMaterials?: readonly FusionMaterialDefinition[];
      readonly extraDeckSummonProcedure: ExtraDeckSummonProcedure;
    };

export type FusionMonsterDefinition = MonsterDefinitionCore &
  FusionSummonMetadata & {
    readonly monsterType: "fusion";
  };

export interface SynchroMonsterDefinition extends MonsterDefinitionCore {
  readonly monsterType: "synchro";
  readonly synchro: SynchroDefinition;
}

export interface AscensionMonsterDefinition extends MonsterDefinitionCore {
  readonly monsterType: "ascension";
  readonly ascension: AscensionDefinition;
}

interface SpellTrapDefinitionCore<Subtype extends CardSubtype>
  extends CardDefinitionBase {
  readonly subtype: Subtype;
  readonly speed?: 1 | 2 | 3;
}

export interface SpellCardDefinition
  extends SpellTrapDefinitionCore<SpellSubtype> {
  readonly cardKind: "spell";
  readonly blueprintStorage?: BlueprintStorageDefinition;
}

export interface TrapCardDefinition
  extends SpellTrapDefinitionCore<TrapSubtype> {
  readonly cardKind: "trap";
}

/**
 * Minimal authoring projection. Additional card schema capabilities are
 * introduced with the declarative database migration rather than collected
 * here as an open-ended property bag.
 */
export type RawCardDefinition =
  | MonsterCardDefinition
  | FusionMonsterDefinition
  | SynchroMonsterDefinition
  | AscensionMonsterDefinition
  | SpellCardDefinition
  | TrapCardDefinition;

/**
 * The indexed projection differs from raw authoring data by its validated,
 * nominal definition identifier.
 */
type WithValidatedCardId<T> = T extends RawCardDefinition
  ? Omit<T, "id"> & { readonly id: CardDefinitionId }
  : never;

export type ValidatedCardDefinition = WithValidatedCardId<RawCardDefinition>;

/**
 * Minimal mutable duel-state projection. It intentionally excludes the many
 * feature-specific fields on Card until their owning modules are migrated.
 */
export interface CardInstance {
  instanceId: number;
  duelCardId?: DuelCardId;
  id: CardDefinitionId;
  name: string;
  cardKind: CardKind;
  monsterType: MonsterType | null;
  owner: PlayerId;
  originalOwner: PlayerId;
  controller?: PlayerId;
  position: BattlePosition;
  isFacedown: boolean;
  locationVersion: number;
}

/**
 * The constructor also accepts generated cards (notably Tokens) that do not
 * originate in the validated database. Every accepted property is named here
 * so this compatibility boundary does not become an open property bag.
 */
export interface GeneratedCardDefinition {
  readonly id?: RawCardDefinitionId | CardDefinitionId;
  readonly name: string;
  readonly cardKind?: CardKind;
  readonly subtype?: CardSubtype | string | null;
  readonly monsterType?: MonsterType | null;
  readonly isTuner?: boolean;
  readonly synchroMaterialRoles?: SynchroMaterialRoles | null;
  readonly archetypes?: readonly string[];
  readonly archetype?: string | null;
  readonly atk?: number;
  readonly def?: number;
  readonly type?: MonsterRace | string | null;
  readonly attribute?: CardAttribute | null;
  readonly level?: number;
  readonly extraAttacks?: number;
  readonly extraAttackTargetRestriction?: "monster" | null;
  readonly dynamicExtraAttacks?: DynamicExtraAttacksDefinition | null;
  readonly altTribute?: AlternateTributeDefinition | null;
  readonly tributeValue?: TributeValueDefinition | readonly TributeValueDefinition[] | null;
  readonly onBattleDestroy?: string | null;
  readonly cannotAttackDirectly?: boolean;
  readonly summonRestrict?: string | null;
  readonly fieldLimit?: FieldLimitDefinition | null;
  readonly fieldPresenceRestriction?: FieldPresenceRestriction | null;
  readonly extraDeckSummonProcedure?: ExtraDeckSummonProcedure | null;
  readonly preventsBattleDamageToController?: boolean;
  readonly battleIndestructibleOncePerTurn?: boolean;
  readonly battleIndestructibleOncePerTurnLastUsedTurn?: number | null;
  readonly mustBeAttacked?: boolean;
  readonly piercing?: boolean;
  readonly piercingDamageMultiplier?: number;
  readonly cannotBeSpecialSummoned?: boolean;
  readonly cannotBeNormalSummonedOrSet?: boolean;
  readonly specialSummonOnlyBy?:
    | SpecialSummonProcedure
    | readonly SpecialSummonProcedure[]
    | null;
  readonly mustFirstBeSpecialSummonedBy?:
    | SpecialSummonProcedure
    | readonly SpecialSummonProcedure[]
    | null;
  readonly properSummonEstablished?: boolean;
  readonly properSummonProcedure?: SpecialSummonProcedure | null;
  readonly unaffectedByOtherCardEffects?: boolean;
  readonly lastSummonMethod?: SummonMethod | null;
  readonly lastSummonedFromZone?: CanonicalZone | null;
  readonly lastSummonedTurn?: number | null;
  readonly lastSummonProcedure?: SpecialSummonProcedure | string | null;
  readonly effectsNegated?: boolean;
  readonly effectsNegatedDuration?: string | number | null;
  readonly blueprintStorage?: BlueprintStorageDefinition | null;
  readonly description?: string;
  readonly effects?: readonly EffectDefinition[];
  readonly fusionMaterials?: readonly FusionMaterialDefinition[] | null;
  readonly ascension?: AscensionDefinition | null;
  readonly synchro?: SynchroDefinition | null;
  readonly image?: string;
  readonly originalOwner?: PlayerId | string;
}

export type CardConstructorData = GeneratedCardDefinition;

export interface CardTurnBasedBuff {
  id?: string;
  stat: "atk" | "def";
  value: number;
  expiresOnTurn: number;
}

export interface CardDynamicStatFormula {
  type: "count_gy_archetype" | "count_field_archetype" | "fixed" | string;
  archetype?: string;
  perCard?: number;
  value?: number;
}

export interface CardDynamicStatBoost {
  stat: "atk" | "def";
  formula: CardDynamicStatFormula;
}

export interface CardDynamicBuffEntry {
  stats?: readonly ("atk" | "def")[];
  value?: number;
  appliedValues?: { atk?: number; def?: number };
}

export type CardDynamicBuffMap = Record<string, CardDynamicBuffEntry>;

export type CardSuppressedDynamicBuffStats = Record<
  string,
  { atk?: boolean; def?: boolean }
>;

export interface CardEffectMarker {
  key?: string;
  sourceInstanceId?: string | number | null;
  sourceCardId?: RawCardDefinitionId | CardDefinitionId | null;
  sourceEffectId?: string | null;
  controllerId?: PlayerId | string | null;
  markedOnTurn?: number;
  createdOnTurn?: number;
  expiresOnTurn?: number | null;
  matchingCostCount?: number;
  fieldPresenceId?: string | number | null;
}

export type CardEffectMarkerMap = Record<string, CardEffectMarker>;

export interface CardPassiveExtraAttackBonus {
  amount: number;
  targetRestriction: string | null;
}

export interface CardProtectionEffect {
  type: "battle_destruction" | "effect_destruction";
  source?: string;
  duration: string | number;
  expiresOnTurn?: number | null;
  grantedOnTurn?: number | null;
  sourceOwner?: "self" | "opponent" | "any";
  removeOnLeave?: boolean;
}

export interface CardPermanentStatBuff {
  atk?: number;
  def?: number;
}

export type CardPermanentBuffMap = Record<string, CardPermanentStatBuff>;

export interface CardDeclaredValueDetail {
  property: string;
  value: string | number | boolean;
  valueLabel?: string;
  declaredOnTurn?: number;
  expiresOnTurn?: number;
  duration?: string;
}

export type CardDeclaredValue =
  | string
  | number
  | boolean
  | CardDeclaredValueDetail;

export type CardDeclaredValueMap = Record<string, CardDeclaredValue>;

export interface CardOriginalStatsOverride {
  baseAtk: number;
  baseDef: number;
}

export interface SentToGraveMaterialMarker {
  type: "fusion" | "synchro" | "ascension";
  turn: number;
  thisTurn: boolean;
  ownerId: PlayerId | string | null;
  fromZone: CanonicalZone | "token" | null;
  contextLabel: string | null;
}

export type EffectUsageEntry =
  | number
  | {
      turn?: number;
      count?: number;
    };

export type EffectUsageMap = Record<string, EffectUsageEntry>;

export interface CardStatusValueMap {
  isTuner: boolean;
  effectsNegated: boolean;
  battleIndestructible: boolean;
  piercing: boolean;
  tempBattleIndestructible: boolean;
  battleDamageHealsControllerThisTurn: boolean;
  banishWhenLeavesField: boolean;
  extraAttacks: number;
  atk: number;
  def: number;
}

export type KnownCardStatusKey = keyof CardStatusValueMap;

export type KnownCardStatusEntry = {
  [Key in KnownCardStatusKey]: {
    readonly status: Key;
    readonly value?: CardStatusValueMap[Key];
    readonly restoreOnFieldExit?: boolean;
  };
}[KnownCardStatusKey];

export type KnownCardStatusInput = KnownCardStatusKey | KnownCardStatusEntry;

/** Closed known portion of the dynamic runtime status registry. */
export type CardStatusRegistry = Partial<CardStatusValueMap>;

export interface TrapMonsterOriginalState {
  cardKind: CardKind | null;
  subtype: CardSubtype | string | null;
  monsterType: MonsterType | null;
  isTuner: boolean;
  synchroMaterialRoles: SynchroMaterialRoles | null;
  type: MonsterRace | string | null;
  types: string[] | null;
  attribute: CardAttribute | null;
  level: number;
  baseLevel: number;
  baseAtk: number;
  baseDef: number;
  atk: number;
  def: number;
}

/**
 * Complete mutable card shape used by the live duel. Feature-owned dynamic
 * dictionaries remain `unknown` and are accessed through local Reflect
 * boundaries instead of granting every property name to every consumer.
 */
export interface GameCard {
  instanceId: number;
  _instanceId?: number | string | null;
  uuid?: string | null;
  locationVersion: number;
  id: RawCardDefinitionId | CardDefinitionId | undefined;
  duelCardId?: DuelCardId;
  name: string;
  cardKind: CardKind;
  originalCardKind?: CardKind | null;
  treatedAsCardKinds?: CardKind[];
  subtype: CardSubtype | string | null;
  monsterType: MonsterType | null;
  isTuner: boolean;
  synchroMaterialRoles: SynchroMaterialRoles | null;
  archetypes: string[];
  archetype: string | null;
  baseAtk: number;
  baseDef: number;
  atk: number;
  def: number;
  type: MonsterRace | string | null | undefined;
  types?: string[];
  attribute: CardAttribute | null;
  level: number;
  baseLevel: number;
  originalLevel?: number | null;
  position: BattlePosition;
  previousPosition?: BattlePosition | null;
  positionChangedThisTurn?: boolean;
  revealedTurn?: number | null;
  isFacedown: boolean;
  battlePositionLocked: boolean;
  hasAttacked: boolean;
  extraAttacks: number;
  baseExtraAttackTargetRestriction: "monster" | null;
  extraAttackTargetRestriction: string | null;
  dynamicExtraAttacks: DynamicExtraAttacksDefinition | null;
  attackLimitThisTurn?: number | null;
  attackLimitDuration?: string | number | null;
  attacksUsedThisTurn: number;
  tempAtkBoost: number;
  tempDefBoost: number;
  cannotAttackThisTurn: boolean;
  cannotAttackUntilTurn: number | null;
  immuneToOpponentEffectsUntilTurn: number | null;
  altTribute: AlternateTributeDefinition | null;
  tributeValue: TributeValueDefinition | readonly TributeValueDefinition[] | null;
  onBattleDestroy: string | null;
  canAttackDirectlyThisTurn: boolean;
  cannotAttackDirectly: boolean;
  equippedTo: GameCard | null;
  equips: GameCard[];
  equipTarget?: GameCard | number | string | null;
  summonRestrict: string | null;
  fieldLimit: FieldLimitDefinition | null;
  fieldPresenceRestriction: FieldPresenceRestriction | null;
  extraDeckSummonProcedure: ExtraDeckSummonProcedure | null;
  equipAtkBonus: number;
  equipDefBonus: number;
  equipExtraAttacks: number;
  grantsBattleIndestructible: boolean;
  battleIndestructible: boolean;
  tempBattleIndestructible: boolean;
  battleDamageHealsControllerThisTurn: boolean;
  preventsBattleDamageToController: boolean;
  battleIndestructibleOncePerTurn: boolean;
  battleIndestructibleOncePerTurnUsed: boolean;
  battleIndestructibleOncePerTurnLastUsedTurn: number | null;
  mustBeAttacked: boolean;
  piercing: boolean;
  piercingDamageMultiplier: number;
  canMakeSecondAttackThisTurn: boolean;
  secondAttackUsedThisTurn: boolean;
  dynamicBuffs: CardDynamicBuffMap | null;
  suppressedDynamicBuffStatsByKey?: CardSuppressedDynamicBuffStats;
  temporarySuppressedDynamicBuffStatsByKey?: CardSuppressedDynamicBuffStats;
  passiveExtraAttackBonuses?: Record<string, CardPassiveExtraAttackBonus>;
  passiveExtraAttackTargetRestriction?: string | null;
  cannotBeSpecialSummoned: boolean;
  cannotBeNormalSummonedOrSet: boolean;
  specialSummonOnlyBy: SpecialSummonProcedure[] | null;
  mustFirstBeSpecialSummonedBy: SpecialSummonProcedure[] | null;
  properSummonEstablished: boolean;
  properSummonProcedure: SpecialSummonProcedure | null;
  unaffectedByOtherCardEffects: boolean;
  lastSummonMethod: SummonMethod | null;
  lastSummonedFromZone: CanonicalZone | null;
  lastSummonedTurn: number | null;
  lastSummonProcedure: SpecialSummonProcedure | string | null;
  turnBasedBuffs: CardTurnBasedBuff[];
  tempStatuses: CardStatusRegistry;
  fieldExitStatuses: CardStatusRegistry;
  fieldPresenceId: string | number | null;
  fieldPresenceState: unknown;
  effectsNegated: boolean;
  effectsNegatedDuration: string | number | null;
  originalAtk: number | null;
  originalDef: number | null;
  counters: Map<string, number>;
  blueprintStorage: BlueprintStorageDefinition | null;
  description: string | undefined;
  effects: readonly EffectDefinition[];
  fusionMaterials: readonly FusionMaterialDefinition[] | null;
  ascension: AscensionDefinition | null;
  ascensionMaterials?: AscensionMaterialRecord[];
  synchro: SynchroDefinition | null;
  synchroMaterials?: SynchroMaterialRecord[];
  image: string | undefined;
  owner: PlayerId | string;
  originalOwner: PlayerId | string;
  controller?: PlayerId | string;
  location?: CanonicalZone | null;
  zone?: CanonicalZone | null;
  isToken?: boolean;
  tokenSourceCard?: string | null;
  isTrapMonster?: boolean;
  trapMonsterOriginalState?: TrapMonsterOriginalState;
  trapMonsterSummonProcedure?: string;
  setTurn?: number | null;
  turnSetOn?: number | null;
  enteredFieldTurn?: number | null;
  summonedTurn?: number | null;
  summonPending?: boolean;
  requiredTributes?: number;
  lpGainMultiplier?: number;
  declaredValues?: CardDeclaredValueMap;
  oncePerTurnUsageByName?: EffectUsageMap;
  effectMarkers?: CardEffectMarkerMap;
  protectionEffects?: CardProtectionEffect[];
  permanentBuffsBySource?: CardPermanentBuffMap;
  linkedPermanentBuffSourceNames?: string[];
  originalStatsOverride?: CardOriginalStatsOverride;
  banishWhenLeavesField?: boolean;
  boundTrapSource?: GameCard | null;
  boundMonsterTarget?: GameCard | null;
  grantsCrescentShieldGuard?: boolean;
  lastSentToGraveAsMaterial?: SentToGraveMaterialMarker;
  graveyardEffectActivating?: boolean;
  attackedMonstersThisTurn?: Set<number | string>;
  canAttackAllOpponentMonstersThisTurn?: boolean;
  dynamicStatBoosts?: CardDynamicStatBoost[];
  addCounter(counterType: string, amount?: number): void;
  removeCounter(counterType: string, amount?: number): void;
  getCounter(counterType: string): number;
  hasCounter(counterType: string): boolean;
}
