import type {
  CardDefinitionId,
  DuelCardId,
  PlayerId,
  RawCardDefinitionId,
} from "./primitives.js";

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

/**
 * Minimal authoring projection. Additional card schema capabilities are
 * introduced with the declarative database migration rather than collected
 * here as an open-ended property bag.
 */
export interface RawCardDefinition {
  readonly id: RawCardDefinitionId;
  readonly name: string;
  readonly cardKind: CardKind;
  readonly image: string;
  readonly description: string;
}

/**
 * The indexed projection differs from raw authoring data by its validated,
 * nominal definition identifier.
 */
export interface ValidatedCardDefinition
  extends Omit<RawCardDefinition, "id"> {
  readonly id: CardDefinitionId;
}

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
