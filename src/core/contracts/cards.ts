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
  readonly tuner?: CardFilter;
  readonly nonTuner?: CardFilter;
}

export interface SynchroDefinition {
  readonly tunerCount: number;
  readonly nonTunerMin: number;
  readonly materialFilters?: SynchroMaterialFilters;
}

export interface SynchroMaterialRoles {
  readonly nonTunerFor?: readonly CardFilter[];
}

export interface AscensionRequirement {
  readonly type:
    | "field_counters_at_least"
    | "material_effect_activations"
    | "material_turns_on_field";
  readonly count?: number;
  readonly counterType?: string;
  readonly min?: number;
  readonly owner?: "self" | "opponent" | "any";
  readonly reason?: string;
  readonly requireFaceup?: boolean;
  readonly zones?: readonly CanonicalZone[];
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
  readonly scope: "global";
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
  readonly cannotAttackDirectly?: boolean;
  readonly cannotBeNormalSummonedOrSet?: boolean;
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
  readonly effects: readonly EffectDefinition[];
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
