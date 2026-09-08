import type {
  BattlePosition,
  BattlePositionInput,
  CardAttribute,
  CardKind,
  GameCard,
  EffectUsageMap,
  MonsterRace,
  MonsterType,
} from "./cards.js";
import type { CardFilter, EffectDefinition } from "./effects.js";
import type { ControllerType, PlayerId, RawCardDefinitionId } from "./primitives.js";
import type {
  MoveCardResult,
  PlayerGamePort,
  SummonExecutionResult,
} from "./gameRuntime.js";
import type { ChainStrategyPort } from "./chainRuntime.js";

export interface NormalSummonFilter {
  cardKind?: CardKind | readonly CardKind[];
  cardId?: RawCardDefinitionId;
  cardIds?: readonly RawCardDefinitionId[];
  name?: string | readonly string[];
  cardName?: string;
  archetype?: string | readonly string[];
  type?: MonsterRace | string | readonly string[];
  attribute?: CardAttribute | readonly CardAttribute[];
  monsterType?: MonsterType | readonly MonsterType[];
  isTuner?: boolean;
  level?: number;
  minLevel?: number;
  maxLevel?: number;
}

export interface KnownNormalSummonRecord {
  id: RawCardDefinitionId | null | undefined;
  name: string | null;
  cardKind: CardKind | null;
  archetype: string | null;
  archetypes: string[];
  type: MonsterRace | string | null | undefined;
  attribute: CardAttribute | null;
  monsterType: MonsterType | null;
  level: number;
  isTuner: boolean;
}

export interface UnknownNormalSummonRecord {
  unknown: true;
}

export type NormalSummonRecord =
  | KnownNormalSummonRecord
  | UnknownNormalSummonRecord;

export interface AdditionalNormalSummonPermission {
  count: number;
  filters: NormalSummonFilter;
  sourceCardName?: string | null;
  effectId?: string | null;
}

export interface SpecialSummonRestriction {
  allowedFilters: CardFilter;
  duration: string;
  expiresOnTurn: number | null;
  reason: string | null;
  sourceName: string | null;
  sourceId: RawCardDefinitionId | null;
  effectId: string | null;
}

export interface EffectActivationRestriction {
  blockedNames: string[];
  allowedAttributes: string[];
  restrictedCardFilters: CardFilter;
  duration: string;
  expiresOnTurn: number | null;
  reason: string | null;
  sourceName: string | null;
  sourceId: RawCardDefinitionId | null;
  effectId: string | null;
}

export interface PlayerDamageOptions {
  suppressVisual?: boolean;
  suppressLpChangeFeedback?: boolean;
  cause?: string;
  screenShake?: boolean;
}

export interface PlayerGainLpOptions {
  cause?: string;
  sourceCard?: GameCard | null;
  sourceRect?: unknown;
}

export interface PlayerStrategyPort extends ChainStrategyPort {
  chooseSpecialSummonPosition?(
    card: GameCard,
    context: {
      game: PlayerGamePort;
      player: GamePlayer;
      actionPosition: BattlePositionInput | null | undefined;
    },
  ): BattlePosition | null | undefined;
}

export interface TributeRequirement {
  tributesNeeded: number;
  usingAlt: boolean;
  alt: GameCard["altTribute"];
}

export interface GamePlayer {
  id: PlayerId;
  name: string;
  controllerType: ControllerType;
  lp: number;
  lpGainedThisTurn: number;
  damageReceivedThisTurn: number;
  deck: GameCard[];
  extraDeck: GameCard[];
  hand: GameCard[];
  field: GameCard[];
  spellTrap: GameCard[];
  graveyard: GameCard[];
  banished: GameCard[];
  fieldSpell: GameCard | null;
  summonCount: number;
  additionalNormalSummons: number;
  additionalNormalSummonPermissions: AdditionalNormalSummonPermission[];
  normalSummonsThisTurn: NormalSummonRecord[];
  specialSummonRestrictions: SpecialSummonRestriction[];
  effectActivationRestrictions: EffectActivationRestriction[];
  forbidDirectAttacksThisTurn: boolean;
  maxDeckSize: number;
  minDeckSize: number;
  maxExtraDeckSize: number;
  oncePerTurnUsageByName: EffectUsageMap;
  oncePerDuelUsageByName?: Record<string, number | boolean>;
  lpGainMultiplier?: number;
  game?: PlayerGamePort;
  strategy?: PlayerStrategyPort | null;
  archetype?: string;
  buildDeck(deckList?: readonly RawCardDefinitionId[] | null): void;
  buildExtraDeck(deckList?: readonly RawCardDefinitionId[] | null): void;
  shuffleDeck(): void;
  draw(): GameCard | null;
  getTributeRequirement(card: GameCard): TributeRequirement;
  summon(
    cardIndex: number,
    position?: BattlePosition,
    isFacedown?: boolean,
    tributeIndices?: readonly number[] | null,
  ): Promise<SummonExecutionResult | null>;
  ensureCardOnTop(cardName: string, createNew?: boolean): GameCard | null;
  takeDamage(amount: number, options?: PlayerDamageOptions): void;
  gainLP(amount: number, options?: PlayerGainLpOptions): void;
  updatePassiveEffects(): void;
}

export interface NormalSummonCardView {
  id?: RawCardDefinitionId | null;
  name?: string | null;
  cardKind?: CardKind | null;
  archetype?: string | null;
  archetypes?: readonly string[];
  type?: MonsterRace | string | null;
  attribute?: CardAttribute | null;
  monsterType?: MonsterType | null;
  isTuner?: boolean;
  level?: number;
  effects?: readonly EffectDefinition[];
  effectsNegated?: boolean;
  isFacedown?: boolean;
}

/** Minimal mutable state consumed by the shared normal-summon slot helpers. */
export interface NormalSummonPlayerView {
  id?: PlayerId | string;
  game?: PlayerGamePort;
  summonCount?: number;
  additionalNormalSummons?: number;
  additionalNormalSummonPermissions?: AdditionalNormalSummonPermission[];
  normalSummonsThisTurn?: NormalSummonRecord[];
  field?: NormalSummonCardView[];
  spellTrap?: NormalSummonCardView[];
  fieldSpell?: NormalSummonCardView | null;
}

export type PlayerMoveResult = MoveCardResult;
