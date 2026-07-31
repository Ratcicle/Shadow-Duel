import type { ActionOf, ActionType, CardAction } from "./actions.js";
import type {
  BattlePosition,
  BattlePositionInput,
  CardKind,
  MonsterType,
} from "./cards.js";
import type { EffectCondition, EffectDefinition } from "./effects.js";
import type { CanonicalZone, ZoneInput } from "./zones.js";

/** A value that may be returned immediately or after asynchronous resolution. */
export type MaybePromise<Value> = Value | PromiseLike<Value>;

/**
 * Narrow projection of the mutable card object consumed by action handlers.
 * Feature-specific mutable fields stay optional until their owning module is
 * migrated; dynamic status access must go through the Reflect helpers below.
 */
export interface ActionRuntimeCard {
  id?: number;
  name: string;
  instanceId?: number;
  _instanceId?: number;
  uuid?: string;
  simInstanceId?: number | string;
  cardKind?: CardKind;
  originalCardKind?: CardKind | null;
  treatedAsCardKinds?: CardKind[];
  subtype?: string | null;
  monsterType?: MonsterType | null;
  type?: string | null;
  types?: string[];
  attribute?: string | null;
  archetype?: string | null;
  archetypes?: string[];
  description?: string;
  image?: string;
  owner?: string;
  originalOwner?: string;
  controller?: string;
  level?: number;
  baseLevel?: number;
  originalLevel?: number;
  atk?: number;
  def?: number;
  baseAtk?: number;
  baseDef?: number;
  originalAtk?: number;
  originalDef?: number;
  position?: BattlePosition;
  isFacedown?: boolean;
  isToken?: boolean;
  isTuner?: boolean;
  effects?: readonly EffectDefinition[];
  effectsNegated?: boolean;
  effectsNegatedDuration?: string | number | null;
  ascensionMaterials?: ActionRuntimeCard[];
  declaredValues?: {
    [property: string]:
      | string
      | number
      | boolean
      | {
          property: string;
          value: string | number | boolean;
          valueLabel?: string;
          declaredOnTurn?: number;
          expiresOnTurn?: number;
          duration?: string;
        };
  };
  summonRestrict?: string | null;
  cannotAttackThisTurn?: boolean;
  hasAttacked?: boolean;
  canMakeSecondAttackThisTurn?: boolean;
  secondAttackUsedThisTurn?: boolean;
  extraAttackTargetRestriction?: string | null;
  originalStatsOverride?: {
    baseAtk: number;
    baseDef: number;
  };
  tempAtkBoost?: number;
  tempDefBoost?: number;
  equipAtkBonus?: number;
  equipDefBonus?: number;
  attackLimitThisTurn?: number | null;
  attackLimitDuration?: string | null;
  canAttackAllOpponentMonstersThisTurn?: boolean;
  attackedMonstersThisTurn?: Set<number | string>;
  multiAttackLimit?: number;
  tempStatuses?: { [status: string]: unknown };
  protectionEffects?: ActionRuntimeProtectionEffect[];
  hasChangedPosition?: boolean;
  positionChangedThisTurn?: boolean;
  battlePositionLocked?: boolean;
  revealedTurn?: number | null;
  permanentBuffsBySource?: {
    [sourceName: string]: { atk?: number; def?: number };
  };
  turnBasedBuffs?: ActionRuntimeTurnBasedBuff[];
  dynamicBuffs?: { [key: string]: ActionRuntimeDynamicBuff };
  suppressedDynamicBuffStatsByKey?: ActionRuntimeSuppressedStats;
  temporarySuppressedDynamicBuffStatsByKey?: ActionRuntimeSuppressedStats;
  linkedPermanentBuffSourceNames?: string[];
  equipTarget?: ActionRuntimeCard | number | string | null;
  counters?: Map<string, number> | { [counterType: string]: number };
  equips?: ActionRuntimeCard[];
  equippedTo?: ActionRuntimeCard | null;
  location?: CanonicalZone | null;
  zone?: CanonicalZone | null;
  addCounter?(counterType: string, amount?: number): number | boolean | void;
  getCounter?(counterType: string): number;
  removeCounter?(counterType: string, amount?: number): number | boolean;
}

export interface ActionRuntimeTurnBasedBuff {
  id?: string;
  stat: "atk" | "def";
  value: number;
  expiresOnTurn: number;
}

export interface ActionRuntimeDynamicBuff {
  stats?: readonly ("atk" | "def")[];
  value?: number;
  appliedValues?: { atk?: number; def?: number };
}

export interface ActionRuntimeSuppressedStats {
  [key: string]: { atk?: boolean; def?: boolean };
}

export interface ActionRuntimeProtectionEffect {
  type: string;
  source: string;
  duration: string;
  grantedOnTurn?: number;
  expiresOnTurn?: number | null;
  sourceOwner?: string;
  removeOnLeave?: boolean;
}

/** Minimal player projection shared by direct and proxied action handlers. */
export interface ActionRuntimePlayer {
  id: string;
  name?: string;
  controllerType?: string;
  lp: number;
  deck: ActionRuntimeCard[];
  extraDeck: ActionRuntimeCard[];
  hand: ActionRuntimeCard[];
  field: ActionRuntimeCard[];
  spellTrap: ActionRuntimeCard[];
  graveyard: ActionRuntimeCard[];
  banished: ActionRuntimeCard[];
  fieldSpell: ActionRuntimeCard | null;
  additionalNormalSummons?: number;
  additionalNormalSummonPermissions?: object[];
  lpGainedThisTurn?: number;
  strategy?: ActionRuntimeStrategyPort | null;
  draw?(count?: number): ActionRuntimeCard | null;
  gainLP(
    amount: number,
    options?: object,
  ): MaybePromise<number | boolean | void>;
  shuffleDeck?(): void;
  takeDamage(
    amount: number,
    options?: object,
  ): MaybePromise<number | boolean | void>;
}

export interface ActionRuntimeStrategyPort {
  selectCardsForEffect?(
    candidates: ActionRuntimeCard[],
    count: number,
    context?: object,
  ): MaybePromise<ActionRuntimeCard[] | null>;
  evaluateRecruitCandidate?(
    candidates: ActionRuntimeCard[],
    context?: object,
  ): {
    best?: ActionRuntimeCard | null;
    blockedAll?: boolean;
    asBotSelect?(): ActionRuntimeCard[];
  };
  rankSearchCandidates?(
    cards: readonly ActionRuntimeCard[],
    action: CardAction,
    context?: object,
  ): readonly ActionRuntimeCard[] | null | undefined;
}

export interface ActionRuntimeAutoSelectorPort {
  select?(
    selectionContract: unknown,
    options?: object,
  ): { ok?: boolean; selections?: object | null };
}

export interface ActionRuntimeUiPort {
  log?(message: string): void;
  captureCardAnimationSource?(
    card: ActionRuntimeCard,
    context?: object,
  ): {
    rect?: object | null;
    hadCardElement?: boolean;
    visual?: object | null;
  } | null;
  showConfirmPrompt?(message: string, options?: object): MaybePromise<boolean>;
  showCardGridSelectionModal?(...arguments_: unknown[]): unknown;
  showCardSelectionPrompt?(...arguments_: unknown[]): unknown;
  showCardSelectionModal?(...arguments_: unknown[]): unknown;
  showMultiSelectModal?(...arguments_: unknown[]): unknown;
  showNumberPrompt?(...arguments_: unknown[]): unknown;
  showTierChoiceModal?(...arguments_: unknown[]): unknown;
  getSearchModalElements?(): unknown;
  showSearchModalVisual?(
    modal: unknown,
    cards: readonly ActionRuntimeCard[],
    ...arguments_: unknown[]
  ): unknown;
  applyFlipAnimation?(...arguments_: unknown[]): unknown;
}

export interface ActionRuntimeCheckResult {
  ok: boolean;
  reason?: string;
}

export interface ActionRuntimeRegistration {
  id?: string;
  type?: string;
  event?: string;
  timing?: string;
  ownerId?: string;
  source?: ActionRuntimeCard | null;
  sourceCard?: ActionRuntimeCard | null;
}

export interface CompletedActionMoveResult {
  success?: boolean;
  needsSelection?: false;
  reason?: string | null;
  negated?: boolean;
  destroyed?: boolean;
}

export type ActionMoveResult =
  | CompletedActionMoveResult
  | (NeedsSelectionResult & {
      negated?: boolean;
      destroyed?: boolean;
    });

export interface ActionDrawResult {
  ok: boolean;
  success: boolean;
  reason?: string;
  nonFatal?: boolean;
  drawn: ActionRuntimeCard[];
}

export interface ActionRuntimeChainLink {
  id?: string | number;
  linkId?: string | number;
  chainLinkId?: string | number;
}

export interface ActionRuntimeChainPort {
  chainStack: ActionRuntimeChainLink[];
  markChainLinkActivationNegated?(
    linkReference: unknown,
    options?: object,
  ): ActionRuntimeChainLink | null;
  markChainLinkEffectNegated?(
    linkReference: unknown,
    options?: object,
  ): ActionRuntimeChainLink | null;
}

export interface ActionRuntimeActivationAttempt {
  card?: ActionRuntimeCard | null;
  linkId?: string | number | null;
  activationNegated?: boolean;
}

export interface ActionRuntimeSummonTransaction {
  card?: ActionRuntimeCard | null;
  summonId?: unknown;
}

export interface ActionNegationContext {
  activationAttempt?: ActionRuntimeActivationAttempt | null;
  summonTransaction?: ActionRuntimeSummonTransaction | null;
  card?: ActionRuntimeCard | null;
  targetCard?: ActionRuntimeCard | null;
  sourceCard?: ActionRuntimeCard | null;
  respondingToChainLink?: unknown;
  linkId?: string | number | null;
  summonId?: unknown;
  negatedBy?: ActionRuntimeCard | null;
  negatedLink?: ActionRuntimeChainLink;
  effectNegatedLink?: ActionRuntimeChainLink;
  activationNegated?: boolean;
  effectNegated?: boolean;
  effectNegatedBy?: ActionRuntimeCard | null;
  summonNegated?: boolean;
  negationProtected?: boolean;
  negationProtectionSource?: ActionRuntimeCard | null;
}

/**
 * Small host port used by action handlers. It deliberately describes only
 * operations owned by the action layer instead of mirroring the complete Game
 * class.
 */
export interface ActionRuntimeGamePort {
  player: ActionRuntimePlayer;
  bot: ActionRuntimePlayer;
  turn?: string;
  turnCounter?: number;
  phase?: string;
  devMode?: boolean;
  gameOver?: boolean;
  autoSelector?: ActionRuntimeAutoSelectorPort | null;
  ui?: ActionRuntimeUiPort | null;
  renderer?: ActionRuntimeUiPort | null;
  effectEngine?: ActionHandlerEnginePort;
  isResolvingEffect?: boolean;
  cardAnimationsReady?: boolean;
  banishedCards?: ActionRuntimeCard[];
  battleStep?: "start" | "battle" | "damage" | "end" | null;
  damageCalculationStatChangePending?: boolean;
  damageCalculationTempBuffs?: object[];
  endOfDamageStepTempBuffs?: object[];
  temporaryReplacementEffects?: ActionRuntimeRegistration[];
  temporaryEventEffects?: ActionRuntimeRegistration[];
  pendingSynchroMaterialFollowups?: ActionRuntimeRegistration[];
  temporaryBattlePairEffects?: ActionRuntimeRegistration[];
  chainSystem?: ActionRuntimeChainPort | null;
  getOpponent?(player: ActionRuntimePlayer): ActionRuntimePlayer | null;
  getOwnerOfCard?(card: ActionRuntimeCard): ActionRuntimePlayer | null;
  getZone?(
    player: ActionRuntimePlayer,
    zone: ZoneInput,
  ): ActionRuntimeCard[] | null;
  moveCard(
    card: ActionRuntimeCard,
    player: ActionRuntimePlayer,
    destination: ZoneInput,
    options?: object,
  ): MaybePromise<ActionMoveResult | boolean | null | undefined>;
  destroyCard(
    card: ActionRuntimeCard,
    options?: object,
  ): MaybePromise<ActionMoveResult>;
  drawCards?(
    player: ActionRuntimePlayer,
    count?: number,
    options?: object,
  ): ActionDrawResult;
  emit?(eventName: string, payload?: object): MaybePromise<unknown>;
  notify?(eventName: string, payload?: object): void;
  devLog?(tag: string, detail?: object): void;
  updateBoard(): void;
  checkWinCondition?(): MaybePromise<boolean | void>;
  shuffle?(cards: ActionRuntimeCard[]): void;
  buildSelectionCandidateKey?(candidate: object, fallbackIndex?: number): string;
  startTargetSelectionSession?(session: object): void;
  finishSelection?(): void;
  canSpecialSummonUnderRestrictions?(
    card: ActionRuntimeCard,
    player: ActionRuntimePlayer,
    options?: object,
  ): ActionRuntimeCheckResult;
  registerEffectActivationRestriction?(
    player: ActionRuntimePlayer,
    restriction?: object,
  ): boolean;
  registerSpecialSummonRestriction?(
    player: ActionRuntimePlayer,
    restriction?: object,
  ): boolean;
  takeControl?(
    card: ActionRuntimeCard,
    controller: ActionRuntimePlayer,
    options?: object,
  ): MaybePromise<ActionMoveResult>;
  registerAttackNegated?(attacker: ActionRuntimeCard): void;
  markSummonNegated?(
    summonId: unknown,
    outcome?: object,
  ): ActionRuntimeSummonTransaction | null;
  inflictDamage?(
    player: ActionRuntimePlayer,
    amount: number,
    options?: object,
  ): MaybePromise<void>;
  queueCardAnimation(intent?: object): boolean;
  queueVisualFeedback(intent?: object): boolean;
  scheduleDelayedAction(
    actionType: string,
    triggerCondition: object,
    payload: object,
    priority?: number,
  ): string | null;
  waitForPresentationDelay?(
    defaultDelayMs?: number,
    options?: object,
  ): Promise<void>;
  waitForBoardPresentation?(): Promise<void>;
  showShadowHeartCathedralModal?(
    validMonsters: ActionRuntimeCard[],
    maxAtk: number,
    counterCount: number,
    callback: (card: ActionRuntimeCard | null) => void,
  ): void;
  canUseOncePerTurn?(
    card: ActionRuntimeCard,
    player: ActionRuntimePlayer,
    effect: EffectDefinition,
    options?: object,
  ): ActionRuntimeCheckResult;
  markOncePerTurnUsed?(
    card: ActionRuntimeCard,
    player: ActionRuntimePlayer,
    effect: EffectDefinition,
    options?: object,
  ): void;
  canPlaceCardOnField?(
    card: ActionRuntimeCard,
    player: ActionRuntimePlayer,
    options?: object,
  ): ActionRuntimeCheckResult;
  canSummonSynchroCard?(
    player: ActionRuntimePlayer,
    card: ActionRuntimeCard,
    options?: object,
  ): ActionRuntimeCheckResult;
  performSynchroSummon?(
    player: ActionRuntimePlayer,
    materials: ActionRuntimeCard[],
    card: ActionRuntimeCard,
    options?: object,
  ): MaybePromise<LegacyActionHandlerResult>;
  createDeterministicId?(scope?: string): string;
  applyTurnBasedBuff?(
    card: ActionRuntimeCard,
    stat: "atk" | "def",
    amount: number,
    expiresOnTurn: number,
    sourceName?: string | null,
  ): boolean;
}

interface ActionContextState extends ActionNegationContext {
  effectId?: string | null;
  actionContext?: object | null;
  selections?: object | null;
  context?: ActionNegationContext | null;
  sourceRect?: object | null;
  synchroSummonContextId?: string | null;
  costSelections?: object | null;
  preview?: boolean;
  isPreview?: boolean;
  skipEffectTargetedEvent?: boolean;
  _effectTargetedOpened?: boolean;
  _effectTargetedResolved?: boolean;
}

/** Known fields on the context shared across an action sequence. */
export interface EffectContext {
  player?: ActionRuntimePlayer | null;
  opponent?: ActionRuntimePlayer | null;
  source?: ActionRuntimeCard | null;
  card?: ActionRuntimeCard | null;
  target?: ActionRuntimeCard | null;
  targetedCard?: ActionRuntimeCard | null;
  targetOwner?: ActionRuntimePlayer | null;
  attacker?: ActionRuntimeCard | null;
  attackerOwner?: ActionRuntimePlayer | null;
  defender?: ActionRuntimeCard | null;
  defenderOwner?: ActionRuntimePlayer | null;
  summonedCard?: ActionRuntimeCard | null;
  destroyed?: ActionRuntimeCard | null;
  destroyedOwner?: ActionRuntimePlayer | null;
  eventCard?: ActionRuntimeCard | null;
  movedCard?: ActionRuntimeCard | null;
  changedCard?: ActionRuntimeCard | null;
  negatedActivationCard?: ActionRuntimeCard | null;
  negatedEffectCard?: ActionRuntimeCard | null;
  effect?: EffectDefinition | null;
  effectId?: string | null;
  sourceZone?: ZoneInput | null;
  activationZone?: ZoneInput | null;
  fromZone?: ZoneInput | null;
  cause?: string | null;
  damageAmount?: number;
  isDamageStep?: boolean;
  isPreview?: boolean;
  previewOnly?: boolean;
  eventData?: object | null;
  actionContext?: ActionContextState | null;
  activationContext?: ActionContextState | null;
  selections?: object | null;
  _actionTargets?: ResolvedTargetMap;
  game?: ActionRuntimeGamePort;
  host?: object | null;
  lastAddedCounterCount?: number;
  lastRemovedCounterCount?: number;
  lastFieldCounterCount?: number;
  lastAddedToHandCard?: ActionRuntimeCard | null;
  lastAddedToHandCards?: ActionRuntimeCard[];
  lastDrawnCard?: ActionRuntimeCard | null;
  lastDrawnCards?: ActionRuntimeCard[];
  lastSpecialSummonedCard?: ActionRuntimeCard | null;
  lastSpecialSummonedCards?: ActionRuntimeCard[];
  fieldCounterCounts?: { [counterType: string]: number };
}

export interface ActionTargetEnvelope {
  card: ActionRuntimeCard;
}

export type ActionTargetValue =
  | ActionRuntimeCard
  | ActionRuntimeCard[]
  | ActionTargetEnvelope
  | null
  | undefined;

/** Target references are the one intentionally dynamic dictionary boundary. */
export interface ResolvedTargetMap {
  [targetReference: string]: ActionTargetValue;
}

export interface LegacyActionResultObject {
  success?: boolean;
  executed?: boolean;
  needsSelection?: false;
  reason?: string | null;
  skipped?: boolean;
  skippedCount?: number;
  position?: BattlePositionInput | null;
}

export interface NeedsSelectionResult {
  needsSelection: true;
  selectionContract: unknown;
  success?: boolean;
  executed?: boolean;
  selectionSource?: string;
  reason?: string | null;
}

export type LegacyActionHandlerResult =
  | boolean
  | null
  | undefined
  | LegacyActionResultObject
  | NeedsSelectionResult;

/** Exact legacy EffectEngine proxy selected for each proxied action. */
export interface ProxyMethodByAction {
  readonly draw: "applyDraw";
  readonly shuffle_deck: "applyShuffleDeck";
  readonly heal: "applyHeal";
  readonly heal_per_archetype_monster: "applyHealPerArchetypeMonster";
  readonly damage: "applyDamage";
  readonly destroy: "applyDestroy";
  readonly move: "applyMove";
  readonly equip: "applyEquip";
  readonly negate_attack: "applyNegateAttack";
  readonly end_battle_phase: "applyEndBattlePhase";
  readonly buff_atk_temp: "applyBuffAtkTemp";
  readonly modify_stats_temp: "applyModifyStatsTemp";
  readonly add_counter: "applyAddCounter";
  readonly remove_counter: "applyRemoveCounter";
  readonly remove_all_counters_from_field: "applyRemoveAllCountersFromField";
  readonly remove_counters_from_field: "applyRemoveCountersFromField";
  readonly count_field_counters: "applyCountFieldCounters";
  readonly forbid_attack_this_turn: "applyForbidAttackThisTurn";
  readonly forbid_attack_next_turn: "applyForbidAttackNextTurn";
  readonly allow_direct_attack_this_turn: "applyAllowDirectAttackThisTurn";
  readonly forbid_direct_attack_this_turn: "applyForbidDirectAttackThisTurn";
  readonly special_summon_token: "applySpecialSummonToken";
  readonly special_summon_self_as_trap_monster: "applySpecialSummonSelfAsTrapMonster";
  readonly grant_void_fusion_immunity: "applyGrantVoidFusionImmunity";
  readonly destroy_self_monsters_and_draw: "applyDestroyAllOthersAndDraw";
  readonly polymerization_fusion_summon: "applyPolymerizationFusion";
  readonly call_of_haunted_summon_and_bind: "applyCallOfTheHauntedSummon";
  readonly mirror_force_destroy_all: "applyMirrorForceDestroy";
  readonly destroy_other_dragons_and_buff: "applyDestroyOtherDragonsAndBuff";
}

export type ProxyActionType = keyof ProxyMethodByAction;

export interface NormalizedActionExecutionResult {
  success: boolean;
  executed: boolean;
  needsSelection: false;
  failedAction?: ActionType | string;
  reason?: string;
  error?: unknown;
  action?: CardAction;
  skippedCount?: number;
}

export interface ActionConditionResult {
  ok: boolean;
  reason?: string;
  failedCondition?: EffectCondition;
}

export interface CompletedActionTargetResolution {
  ok?: boolean;
  needsSelection?: false;
  targets?: ResolvedTargetMap;
  reason?: string;
}

export type ActionTargetResolution =
  | CompletedActionTargetResolution
  | (NeedsSelectionResult & {
      ok?: boolean;
      targets?: ResolvedTargetMap;
    });

export interface ActionCandidateSelection {
  zoneName: string;
  candidates: ActionRuntimeCard[];
}

export interface LpCostResolution {
  baseAmount: number;
  finalAmount: number;
  reduction: number;
  appliedCount: number;
  appliedReducers: object[];
}

export interface ActionImmunityFilterResult {
  allowed: ActionRuntimeCard[];
  skipped: ActionRuntimeCard[];
  skippedReasons: Map<ActionRuntimeCard, string | null | undefined>;
}

/** Action-facing subset of EffectEngine; dynamic proxy calls use Reflect. */
export type ActionEngineMethod<Type extends ActionType> = (
  action: ActionOf<Type> | Omit<ActionOf<Type>, "type">,
  context: EffectContext,
  targets?: ResolvedTargetMap,
) => MaybePromise<LegacyActionHandlerResult>;

export interface ActionHandlerEnginePort {
  game: ActionRuntimeGamePort;
  activateStoredBlueprint?: ActionEngineMethod<"activate_stored_blueprint">;
  applyActions(
    actions: readonly CardAction[],
    context: EffectContext,
    targets: ResolvedTargetMap,
  ): MaybePromise<NormalizedActionExecutionResult | NeedsSelectionResult>;
  getOpponent?(player: ActionRuntimePlayer): ActionRuntimePlayer | null;
  getOwnerByCard(card: ActionRuntimeCard): ActionRuntimePlayer | null;
  getOwnerOfCard?(card: ActionRuntimeCard): ActionRuntimePlayer | null;
  chooseSpecialSummonPosition?(
    card: ActionRuntimeCard,
    player: ActionRuntimePlayer,
    options?: { position?: BattlePositionInput },
  ): MaybePromise<BattlePosition>;
  findCardZone?(
    player: ActionRuntimePlayer,
    card: ActionRuntimeCard,
  ): CanonicalZone | null;
  cardMatchesFilters?(card: ActionRuntimeCard, filters?: object): boolean;
  evaluateConditions?(
    conditions: readonly EffectCondition[],
    context: EffectContext,
  ): ActionConditionResult;
  checkActionPreviewRequirements?(
    actions: readonly CardAction[],
    context: EffectContext,
  ): ActionRuntimeCheckResult;
  filterCardsListByImmunity(
    cards: ActionRuntimeCard[],
    activatingPlayer: ActionRuntimePlayer | null | undefined,
    options?: object,
  ): ActionImmunityFilterResult;
  isImmuneToOpponentEffects(
    card: ActionRuntimeCard,
    sourcePlayer: ActionRuntimePlayer | null | undefined,
  ): boolean;
  clearTargetingCache(): void;
  resolveLpCost?(
    action: CardAction,
    context: EffectContext,
    baseAmount?: number,
    options?: object,
  ): LpCostResolution;
  resolveTargets?(
    targetDefinitions: readonly unknown[],
    context: EffectContext,
    selections?: object | null,
  ): ActionTargetResolution;
  selectCandidates(
    definition: object,
    context: EffectContext,
  ): ActionCandidateSelection;
  inferEffectType?(actionType: ActionType): string;

  applyDraw: ActionEngineMethod<"draw">;
  applyShuffleDeck: ActionEngineMethod<"shuffle_deck">;
  applyHeal: ActionEngineMethod<"heal">;
  applyHealPerArchetypeMonster: ActionEngineMethod<"heal_per_archetype_monster">;
  applyDamage: ActionEngineMethod<"damage">;
  applyDestroy: ActionEngineMethod<"destroy">;
  applyMove: ActionEngineMethod<"move">;
  applyEquip: ActionEngineMethod<"equip">;
  applyNegateAttack: ActionEngineMethod<"negate_attack">;
  applyEndBattlePhase: ActionEngineMethod<"end_battle_phase">;
  applyBuffAtkTemp: ActionEngineMethod<"buff_atk_temp">;
  applyModifyStatsTemp: ActionEngineMethod<"modify_stats_temp">;
  applyAddCounter: ActionEngineMethod<"add_counter">;
  applyRemoveCounter: ActionEngineMethod<"remove_counter">;
  applyRemoveAllCountersFromField: ActionEngineMethod<"remove_all_counters_from_field">;
  applyRemoveCountersFromField: ActionEngineMethod<"remove_counters_from_field">;
  applyCountFieldCounters: ActionEngineMethod<"count_field_counters">;
  applyForbidAttackThisTurn: ActionEngineMethod<"forbid_attack_this_turn">;
  applyForbidAttackNextTurn: ActionEngineMethod<"forbid_attack_next_turn">;
  applyAllowDirectAttackThisTurn: ActionEngineMethod<"allow_direct_attack_this_turn">;
  applyForbidDirectAttackThisTurn: ActionEngineMethod<"forbid_direct_attack_this_turn">;
  applySpecialSummonToken: ActionEngineMethod<"special_summon_token">;
  applySpecialSummonSelfAsTrapMonster: ActionEngineMethod<"special_summon_self_as_trap_monster">;
  applyGrantVoidFusionImmunity: ActionEngineMethod<"grant_void_fusion_immunity">;
  applyDestroyAllOthersAndDraw: ActionEngineMethod<"destroy_self_monsters_and_draw">;
  applyPolymerizationFusion: ActionEngineMethod<"polymerization_fusion_summon">;
  applyCallOfTheHauntedSummon: ActionEngineMethod<"call_of_haunted_summon_and_bind">;
  applyMirrorForceDestroy: ActionEngineMethod<"mirror_force_destroy_all">;
  applyDestroyOtherDragonsAndBuff: ActionEngineMethod<"destroy_other_dragons_and_buff">;
}

export type ActionHandler<Type extends ActionType> = (
  action: ActionOf<Type>,
  context: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) => MaybePromise<LegacyActionHandlerResult>;

/** Read a dynamic action result without opening EffectContext's keyset. */
export function readContextValue(
  context: EffectContext | null | undefined,
  key: string | null | undefined,
): unknown {
  if (!context || typeof key !== "string" || key.length === 0) {
    return undefined;
  }
  return Reflect.get(context, key);
}

/** Write a dynamic action result without opening EffectContext's keyset. */
export function writeContextValue(
  context: EffectContext | null | undefined,
  key: string | null | undefined,
  value: unknown,
): boolean {
  if (!context || typeof key !== "string" || key.length === 0) {
    return false;
  }
  return Reflect.set(context, key, value);
}
