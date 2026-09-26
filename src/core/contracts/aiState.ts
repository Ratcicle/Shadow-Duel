import type {
  BattlePosition,
  CardKind,
  GameCard,
} from "./cards.js";
import type {
  ChainFinalizationState,
  ChainRuntimeTriggerState,
  FastEffectState,
  SerializedChainLink,
} from "./chainRuntime.js";
import type { EffectDefinition, UsagePolicy } from "./effects.js";
import type { GamePhase } from "./game.js";
import type {
  DamageStepState,
  GameRuntimeState,
  SummonState,
} from "./gameRuntime.js";
import type {
  AdditionalNormalSummonPermission,
  EffectActivationRestriction,
  NormalSummonRecord,
  SpecialSummonRestriction,
} from "./player.js";
import type {
  DuelCardId,
  PlayerId,
  RawCardDefinitionId,
} from "./primitives.js";
import type { CanonicalGameStateSnapshot } from "./replay.js";
import type { CanonicalZone } from "./zones.js";

declare const perspectiveGameStateBrand: unique symbol;
declare const simulationGameStateBrand: unique symbol;
declare const simulatedCardStateBrand: unique symbol;

export type LiveGameState = GameRuntimeState;

/** AI state reads the shared public replay snapshot. */
export type ReplayGameState = CanonicalGameStateSnapshot;

export type SimulationCloneProfile = "gameTree" | "turnLine";
export type PerspectiveCloneProfile = "bot" | "beamGreedy";

type SimulatedCardCore = Partial<
  Omit<
    GameCard,
    | "addCounter"
    | "removeCounter"
    | "getCounter"
    | "hasCounter"
    | "equippedTo"
    | "equips"
    | "equipTarget"
    | "hasAttacked"
    | "dynamicBuffs"
    | "suppressedDynamicBuffStatsByKey"
    | "temporarySuppressedDynamicBuffStatsByKey"
    | "name"
    | "cardKind"
    | "type"
    | "attribute"
    | "level"
    | "atk"
    | "def"
    | "archetype"
    | "archetypes"
    | "position"
    | "isFacedown"
    | "battleIndestructible"
  >
>;

export interface SimulatedProtectionEffect {
  kind?: string;
  scope?: string;
  duration?: string | number | null;
  sourceName?: string | null;
  sourceId?: number | string | null;
}

export interface SimulatedReplacementEffect {
  id?: string | number;
  type?: string;
  sourceCard?: SimulatedCardState | null;
  sourcePlayerId?: PlayerId | string | null;
  targetCard?: SimulatedCardState | null;
  duration?: string | number | null;
}

/** Planning may start from a minimal projection without live replay IDs. */
export interface SimulatedTemporaryControlEffect {
  id: string;
  cardDuelCardId: DuelCardId | null;
  sourceDuelCardId: DuelCardId | null;
  cardInstanceId: string | number | null;
  fieldPresenceId: string | number | null;
  holderId: string;
  previousControllerId: string | null;
  expiresOnTurn: number;
  sourceInstanceId: string | number | null;
  createdOnTurn: number;
}

/** Mutable projection used only by planning; no live Card methods are required. */
export interface SimulatedCardShape extends SimulatedCardCore {
  hasAttacked?: GameCard["hasAttacked"] | undefined;
  dynamicBuffs?: GameCard["dynamicBuffs"] | undefined;
  suppressedDynamicBuffStatsByKey?: GameCard["suppressedDynamicBuffStatsByKey"] | undefined;
  temporarySuppressedDynamicBuffStatsByKey?: GameCard["temporarySuppressedDynamicBuffStatsByKey"] | undefined;
  // Analysis snapshots explicitly forward these optional card reads.
  name?: GameCard["name"] | undefined;
  cardKind?: GameCard["cardKind"] | undefined;
  type?: GameCard["type"] | undefined;
  attribute?: GameCard["attribute"] | undefined;
  level?: GameCard["level"] | undefined;
  atk?: GameCard["atk"] | undefined;
  def?: GameCard["def"] | undefined;
  archetype?: GameCard["archetype"] | undefined;
  archetypes?: GameCard["archetypes"] | undefined;
  position?: GameCard["position"] | undefined;
  isFacedown?: GameCard["isFacedown"] | undefined;
  battleIndestructible?: GameCard["battleIndestructible"] | undefined;
  permanentDefBoost?: number;
  _simPotentialBarbariasPush?: boolean;
  cannotBeDestroyedByBattle?: boolean | undefined;
  cannotBeDestroyedByCardEffects?: boolean;
  state?: { blueprintStorage?: { storedBlueprints: Array<{
    blueprintId: string; sourceCardId?: GameCard["id"]; sourceCardName?: string | undefined;
    sourceCardKind?: CardKind | undefined; sourceCardSubtype?: GameCard["subtype"] | undefined;
    displayName?: string | undefined; shortRulesText: string; effectSnapshot: EffectDefinition;
    _simStoredByGrimoire: boolean;
  }> } };
  fieldAgeTurns?: number;
  _instanceId?: number | string | null;
  uuid?: string | null;
  equippedTo?: SimulatedCardState | null;
  equips?: SimulatedCardState[];
  equipTarget?: SimulatedCardState | number | string | null;
  uid?: string | number | null;
  simInstanceId?: string | number | null;
  sourceCard?: string | SimulatedCardState | null;
  destroyedOpponentMonstersByEffect?: number;
  lastTributeMaterialNames?: string[];
  lastTributeMaterialCount?: number;
  multiAttackLimit?: number;
  permanentAtkBoost?: number;
  simDragonExtraDeckPlan?: string;
  simDragonExtraDeckScore?: number;
  simEffectDestructionProtected?: boolean;
  simFutureRevive?: boolean;
  simLevelReducedUntilEndTurn?: boolean;
  simMultiAttackPressure?: boolean;
  simProtectedBy?: string;
  simProtectedUntilNextTurn?: boolean;
  lastAiActivatedTurn?: number | null;
  goodDiscard?: boolean;
  usedEffectThisTurn?: boolean;
  __simSetAfterResolution?: boolean;
  _simArcanistApprenticeAuraAtk?: number;
  _simArcanistAzrathEquipHalveUsed?: boolean;
  _simArcanistAzrathHalvedByEquip?: boolean;
  _simArcanistAzrathSpellDebuffAtk?: number;
  _simArcanistAzrathSpellDebuffDef?: number;
  _simArcanistElementalistSpellBuffAtk?: number;
  _simArcanistLightningAtkBoost?: number;
  _simArcanistLightningAttackLock?: boolean;
  _simArcanistLightningPiercing?: boolean;
  _simBloomrotCarrioncapMarkedBattle?: boolean;
  _simBloomrotRotStagBattleBoost?: boolean;
  _simBurningWestSheriffDamageStepBoost?: number;
  _simCannotAttackByEffect?: boolean;
  _simDarknessValleyBuff?: boolean;
  _simEffectDestructionProtected?: boolean;
  _simEffectDestructionProtectedFromOpponent?: boolean;
  _simEffectDestructionProtectedFromSelf?: boolean;
  _simElementalistDestroyedOnEquip?: string | undefined;
  _simMagicSickleBattleBoost?: boolean;
  _simMasterMirrorsShuffleDraw?: boolean;
  _simMasterRevivedOnEquip?: string | undefined;
  _simProtectedByRaven?: boolean;
  _simProtection?: SimulatedProtectionEffect;
  _simProtectionEffects?: SimulatedProtectionEffect[];
  _simRecoveredOnEquip?: string | undefined;
  _simReplacementProtection?: SimulatedReplacementEffect;
  _simStoredBlueprintSource?: string | undefined;
  _simStoredByGrimoire?: boolean;
  _simBattleDestructionProtected?: boolean;
  _simulatedAegisSpecialDefApplied?: boolean;
  _simulatedBarbariasBoost?: boolean;
  _simulatedCitadelSearch?: boolean;
  _simulatedHalberdFollowUp?: boolean;
  _simulatedHalberdReason?: string;
  _simulatedLpCostReductionAvailable?: boolean;
  _simulatedLpPayoff?: boolean;
  _simulatedMarshalSelfSummon?: boolean;
  _simulatedMaterialsUsed?: Array<number | string | undefined>;
  _simulatedMoonbladeRevive?: boolean;
  _simulatedRole?: string;
  _searchedAegis?: boolean;
  _searchedSpell?: boolean;
  simBattleDestructionProtected?: boolean;
}

export type SimulatedCardState = SimulatedCardShape & {
  readonly [simulatedCardStateBrand]: true;
};

export type SimulatedOptBucket = Map<string, number>;

export interface SimulatedOptLedger {
  player?: SimulatedOptBucket;
  bot?: SimulatedOptBucket;
}

/**
 * Dragon simulation still stores effect keys in legacy plain-object buckets.
 * The seat keys are closed here; bucket keys remain an unknown runtime
 * boundary and are narrowed through Reflect by the Dragon simulator.
 */
export interface SimulatedDragonOnceLedger {
  player?: unknown;
  bot?: unknown;
}

/** Per-seat legacy plain-object counters keyed by raw material card ID. */
export interface SimulatedMaterialActivationLedger {
  player?: unknown;
  bot?: unknown;
}

export interface SimulatedLuminarchLpPayment {
  cardName: string;
  cost: number;
  beforeLp: number;
  afterLp: number;
  opponentThreat: number;
  createsWall: boolean;
  createsPayoff: boolean;
  risky: boolean;
}

export interface SimulatedLuminarchBattleEvent {
  tag: string;
  type?: string;
  cardName?: string | null;
  sourceName?: string | null;
  hostName?: string | null;
  attackerName?: string | null;
  targetName?: string | null;
  counterType?: string;
  amount?: number;
  baseAmount?: number;
  beforeLp?: number;
  afterLp?: number;
  cost?: number;
  destroyedCount?: number;
  damageGain?: number;
  attackStat?: number;
  boostedAtk?: number;
  targetStat?: number;
  barbariasDoubled?: boolean;
  direct?: boolean;
  changed?: boolean;
  directLethal?: boolean;
  createsRemoval?: boolean;
  preventsAttackerLoss?: boolean;
  createsPiercingDamage?: boolean;
  destroysBefore?: boolean;
  destroysAfter?: boolean;
  attackerDiesBefore?: boolean;
  attackerDiesAfter?: boolean;
}

export interface SimulatedLuminarchState {
  lpPayments?: SimulatedLuminarchLpPayment[];
  milestones?: string[];
  battleEvents?: SimulatedLuminarchBattleEvent[];
  halberdSummonedThisTurn?: boolean;
  barbariasLpPayoff?: boolean;
  magicSickleBattleUsed?: boolean;
  pureKnightDiscountAvailable?: boolean;
  sunforgedBattleProtectionUsed?: boolean;
}

export interface SimulatedBurningWestState {
  wantedRewardUsed?: boolean;
  burningRewardUsed?: boolean;
  deadeyeRewardUsed?: boolean;
  gunslingerRewardUsed?: boolean;
  peacemakerRewardUsed?: boolean;
}

export interface SimulatedPlayerState {
  usedEffects?: number[];
  debug?: boolean;
  id: PlayerId | string;
  lp: number;
  hand: SimulatedCardState[];
  field: SimulatedCardState[];
  graveyard: SimulatedCardState[];
  deck: SimulatedCardState[];
  extraDeck: SimulatedCardState[];
  banished: SimulatedCardState[];
  fieldSpell: SimulatedCardState | null;
  spellTrap: SimulatedCardState[];
  summonCount: number;
  additionalNormalSummons: number;
  additionalNormalSummonPermissions?: AdditionalNormalSummonPermission[];
  normalSummonsThisTurn?: NormalSummonRecord[];
  specialSummonRestrictions?: SpecialSummonRestriction[];
  effectActivationRestrictions?: EffectActivationRestriction[];
  controllerType?: string | undefined;
  forbidDirectAttacksThisTurn?: boolean;
  oncePerTurnUsageByName?: GameCard["oncePerTurnUsageByName"];
  _simMaterialEffectActivationsByMaterialId?: unknown;
}

/**
 * GameTree carries the supplied zones and legality data required by strategy
 * simulators. Its builder and brand remain distinct from other clone profiles.
 */
export interface GameTreeSimulatedPlayerState extends SimulatedPlayerState {
  name?: string | undefined;
}

/** Read-only input projection accepted before a clone establishes brands. */
export interface AiCardInput {
  fieldSlot?: GameCard["fieldSlot"];
  id?: GameCard["id"];
  instanceId?: number | string;
  _instanceId?: number | string | null;
  uid?: string | number | null;
  uuid?: string | null;
  simInstanceId?: string | number | null;
  name?: string | undefined;
  cardKind?: CardKind | string | undefined;
  atk?: number | undefined;
  def?: number | undefined;
  level?: number | undefined;
  position?: BattlePosition | string | null | undefined;
  isFacedown?: boolean | undefined;
  effects?: GameCard["effects"];
  handSummonProcedure?: GameCard["handSummonProcedure"];
  counters?: ReadonlyMap<string, number>;
  equips?: readonly AiCardInput[];
  dynamicBuffs?: GameCard["dynamicBuffs"] | undefined;
  suppressedDynamicBuffStatsByKey?: GameCard[
    "suppressedDynamicBuffStatsByKey"
  ];
  temporarySuppressedDynamicBuffStatsByKey?: GameCard[
    "temporarySuppressedDynamicBuffStatsByKey"
  ];
}

export interface AiPlayerInput {
  id?: PlayerId | string;
  lp?: number;
  hand?: readonly AiCardInput[];
  field?: readonly AiCardInput[];
  graveyard?: readonly AiCardInput[];
  deck?: readonly AiCardInput[];
  extraDeck?: readonly AiCardInput[];
  banished?: readonly AiCardInput[];
  fieldSpell?: AiCardInput | null;
  spellTrap?: readonly AiCardInput[];
  summonCount?: number;
  additionalNormalSummons?: number;
  additionalNormalSummonPermissions?: readonly AdditionalNormalSummonPermission[];
  normalSummonsThisTurn?: readonly NormalSummonRecord[];
  specialSummonRestrictions?: readonly SpecialSummonRestriction[];
  effectActivationRestrictions?: readonly EffectActivationRestriction[];
  controllerType?: string | undefined;
}

/** Small live-state boundary accepted by clone builders and strategy entrypoints. */
export interface AiLiveGamePort {
  player: AiPlayerInput;
  bot: AiPlayerInput;
  turn?: PlayerId | string | null | undefined;
  phase?: GamePhase | string | null | undefined;
  turnCounter?: number;
  effectEngine?: {
    usedThisTurn?: ReadonlyMap<string, number>;
  } | null;
  _isPerspectiveState?: boolean;
  _gameRef?: AiLiveGamePort;
}

/** Permissive read boundary retained for legacy search callers and fixtures. */
export interface AiStateInput {
  player?: AiPlayerInput | null;
  bot?: AiPlayerInput | null;
  opponent?: AiPlayerInput | null;
  turn?: PlayerId | string | null | undefined;
  phase?: GamePhase | string | null | undefined;
  turnCounter?: number;
  temporaryControlEffects?: readonly SimulatedTemporaryControlEffect[];
  _isPerspectiveState?: boolean;
  _gameRef?: AiLiveGamePort;
}

export interface AiStateShape extends AiLiveGamePort {
  temporaryControlEffects?: SimulatedTemporaryControlEffect[];
  player: SimulatedPlayerState;
  bot: SimulatedPlayerState;
  opponent?: SimulatedPlayerState | null;
  turn: PlayerId | string | null | undefined;
  phase: GamePhase | string | null | undefined;
  turnCounter: number;
  usedThisTurn?: Map<string, number>;
  _isPerspectiveState?: true;
  _gameRef?: AiLiveGamePort;
  _suppressP2Analysis?: boolean;
  _simOncePerTurn?: SimulatedOptLedger;
  _dragonSimOnce?: SimulatedDragonOnceLedger;
  _simOptUsed?: Set<string>;
  _simArcanistOptUsed?: Set<string>;
  _simPassiveOncePerTurn?: SimulatedOptBucket;
  _simUnsupportedActions?: string[];
  _simReplacementEffects?: SimulatedReplacementEffect[];
  _simTemporaryControlCounter?: number;
  _simFieldPresenceSeq?: number;
  _simEventDepth?: number;
  _simPlanningBattleDone?: boolean;
  _simGrandLibraryBattleRewardUsed?: boolean;
  _simArcanistApprenticeSearchUsed?: boolean;
  _simArcanistSpellActivations?: number;
  _simLuminarch?: SimulatedLuminarchState;
  _simBurningWest?: SimulatedBurningWestState;
  _simMaterialEffectActivationsByMaterialId?: SimulatedMaterialActivationLedger | undefined;
  _simVoidBeastSearchUsed?: boolean;
  _simVoidHollowRecruitUsed?: boolean;
  /** GameTree-only storage for metadata otherwise bound to the current bot view. */
  _gameTreeActors?: Record<string, GameTreeActorState>;
}

export type GameTreeActorState = Pick<AiStateShape,
  | "_simOptUsed" | "_simArcanistOptUsed" | "_simLuminarch" | "_simBurningWest"
  | "_simGrandLibraryBattleRewardUsed" | "_simArcanistApprenticeSearchUsed"
  | "_simArcanistSpellActivations" | "_simVoidBeastSearchUsed" | "_simVoidHollowRecruitUsed"
>;

export interface GameTreeStateShape extends AiStateShape {
  player: GameTreeSimulatedPlayerState;
  bot: GameTreeSimulatedPlayerState;
  turn: PlayerId | string | null | undefined;
  phase: GamePhase | string | null | undefined;
  turnCounter: number;
  _isPerspectiveState: true;
  _gameRef?: AiLiveGamePort;
}

export type PerspectiveGameState<
  Profile extends PerspectiveCloneProfile = PerspectiveCloneProfile,
> = AiStateShape & {
  readonly [perspectiveGameStateBrand]: Profile;
  readonly _isPerspectiveState: true;
};

export type SimulationGameState<
  Profile extends SimulationCloneProfile = SimulationCloneProfile,
> = AiStateShape & {
  readonly [simulationGameStateBrand]: Profile;
};

export type BotPerspectiveGameState = PerspectiveGameState<"bot">;
export type BeamPerspectiveGameState = PerspectiveGameState<"beamGreedy">;
export type GameTreeSimulationGameState = GameTreeStateShape & {
  readonly [simulationGameStateBrand]: "gameTree";
};
export type TurnLineSimulationGameState = SimulationGameState<"turnLine">;

export interface PublicFieldCardState {
  duelCardId: DuelCardId | null;
  cardId: GameCard["id"] | null;
  fieldSlot: GameCard["fieldSlot"];
  owner: PlayerId | string | null;
  controller: PlayerId | string | null;
  originalOwner: PlayerId | string | null;
  locationVersion: number;
  lastSummonMethod: GameCard["lastSummonMethod"];
  lastSummonedFromZone: CanonicalZone | null;
  properSummonEstablished: boolean | null;
  properSummonProcedure: GameCard["properSummonProcedure"];
  name: string | null;
  position: BattlePosition;
  atk: number | null;
  def: number | null;
  level: number | null;
  baseLevel: number | null;
  piercing: boolean | null;
  piercingDamageMultiplier: number | null;
  isTuner: boolean | null;
  faceDown: boolean;
  status: {
    cannotAttackThisTurn: boolean | null;
    battlePositionLocked: boolean | null;
    effectsNegated: boolean | null;
    effectsNegatedDuration: string | number | null;
    canAttackAll: boolean | null;
  };
}

export interface PublicHandCardState {
  duelCardId: DuelCardId | null;
  cardId: GameCard["id"];
  name: string;
  atk: number;
  def: number;
  level: number;
  baseLevel: number;
  isTuner: boolean;
  cardKind: CardKind;
  properSummonEstablished: boolean;
  properSummonProcedure: GameCard["properSummonProcedure"];
}

export interface PublicSpellTrapCardState {
  duelCardId: DuelCardId | null;
  cardId: GameCard["id"] | null;
  fieldSlot: GameCard["fieldSlot"];
  name: string | null;
  faceDown: boolean;
  cardKind: CardKind | null;
  subtype: GameCard["subtype"];
  effectsNegated: boolean | null;
  effectsNegatedDuration: string | number | null;
}

export interface PublicGraveyardCardState {
  duelCardId: DuelCardId | null;
  cardId: GameCard["id"];
  name: string;
  cardKind: CardKind;
  subtype: GameCard["subtype"];
  atk: number | null;
  def: number | null;
  level: number | null;
  baseLevel: number | null;
  isTuner: boolean | null;
  lastSummonMethod: GameCard["lastSummonMethod"];
  lastSummonedFromZone: CanonicalZone | null;
  properSummonEstablished: boolean | null;
  properSummonProcedure: GameCard["properSummonProcedure"];
}

export interface PublicPlayerState {
  id: PlayerId;
  name: string;
  lp: number;
  damageReceivedThisTurn: number;
  specialSummonRestrictions: Array<{
    allowedFilters: SpecialSummonRestriction["allowedFilters"];
    duration: string | null;
    expiresOnTurn: number | null;
    reason: string | null;
    sourceName: string | null;
    sourceId: RawCardDefinitionId | null;
  }>;
  effectActivationRestrictions: Array<{
    blockedNames: string[];
    duration: string | null;
    expiresOnTurn: number | null;
    allowedAttributes: string[];
    restrictedCardFilters: EffectActivationRestriction["restrictedCardFilters"];
    reason: string | null;
    sourceName: string | null;
    sourceId: RawCardDefinitionId | null;
  }>;
  hand: PublicHandCardState[] | { count: number };
  handCount: number;
  field: Array<PublicFieldCardState | null>;
  spellTrap: Array<PublicSpellTrapCardState | null>;
  fieldSpell: {
    cardId: GameCard["id"];
    name: string | null;
    faceDown: boolean;
    effectsNegated: boolean;
    effectsNegatedDuration: string | number | null;
  } | null;
  graveyardCount: number;
  graveyard: PublicGraveyardCardState[];
}

export interface PublicEffectUsageReservation {
  reservationId: number;
  policy: UsagePolicy;
  status: "reserved" | "consumed" | "released";
  playerId: string;
  turnKey: string | null;
  duelKey: string | null;
  oncePerTurn: boolean;
  oncePerDuel: boolean;
  chainId: number | null;
  linkId: number | null;
  effectId: string | null;
  sourceInstanceId: number | null;
}

export interface PublicTemporaryControlState {
  id: string;
  cardDuelCardId: DuelCardId;
  sourceDuelCardId: DuelCardId | null;
  fieldPresenceId: number | string | null;
  cardInstanceId: number | string | null;
  holderId: string;
  previousControllerId: string | null;
  expiresOnTurn: number;
  sourceInstanceId: number | string | null;
  createdOnTurn: number;
}

export interface PublicTemporaryEventState {
  id: string | number;
  event: string;
  ownerId: PlayerId | string;
  sourceInstanceId: number | string | null;
  boundEventTargetInstanceId: number | string | null;
  requireBoundTargetLeavesField: boolean;
  duration: string | null;
  expiresOnTurn: number | null;
  usesRemaining: number | null;
}

export interface PublicGameState {
  schemaVersion: 2;
  turn: PlayerId;
  phase: GamePhase;
  turnCounter: number;
  currentPlayer: PlayerId;
  chain: {
    chainId: number | null;
    windowOpen: boolean;
    resolving: boolean;
    links: SerializedChainLink[];
    timing: FastEffectState | null;
    triggers: ChainRuntimeTriggerState | null;
    finalization: ChainFinalizationState | null;
  };
  summon: SummonState;
  usage: {
    nextReservationId: number | null;
    reservations: PublicEffectUsageReservation[];
  };
  combat: {
    battleStep: string | null;
    damageStep: DamageStepState;
  };
  temporaryEffects: {
    event: PublicTemporaryEventState[];
    control: PublicTemporaryControlState[];
  };
  players: {
    self: PublicPlayerState;
    opponent: PublicPlayerState;
  };
}
