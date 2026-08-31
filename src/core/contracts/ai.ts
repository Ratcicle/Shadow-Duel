import type { CardAction, ActionOf, ActionType } from "./actions.js";
import type {
  BattlePosition,
  BattlePositionInput,
  GameCard,
} from "./cards.js";
import type { EffectDefinition } from "./effects.js";
import type { GamePhase } from "./game.js";
import type {
  AiLiveGamePort,
  AiPlayerInput,
  AiStateInput,
  AiStateShape,
  GameTreeSimulationGameState,
  PerspectiveGameState,
  SimulatedCardState,
  SimulatedPlayerState,
  SimulationGameState,
  TurnLineSimulationGameState,
} from "./aiState.js";
import type { GamePlayer } from "./player.js";
import type { PlayerId, RawCardDefinitionId } from "./primitives.js";
import type { CanonicalSelectionMap } from "./selection.js";
import type { CanonicalZone } from "./zones.js";

export type AIState =
  | AiLiveGamePort
  | AiStateInput
  | PerspectiveGameState
  | SimulationGameState
  | GameTreeSimulationGameState;

export type AIPlanningMode = "off" | "critical" | "always";
export type AITurnPlanningMode = "mainOnly" | "mainBattleMain2";

export interface AIPlanningProfile {
  enabled: boolean;
  mode: AIPlanningMode;
  turnMode: AITurnPlanningMode;
  beamWidth: number;
  maxDepth: number;
  nodeBudget: number;
  candidateLimit: number;
}

export interface AIActivationContext {
  effect?: EffectDefinition | null;
  effectId?: string | null;
  fromHand?: boolean;
  activationZone?: CanonicalZone | null;
  sourceZone?: CanonicalZone | null;
  zone?: CanonicalZone | null;
  trapActivationFromSet?: boolean;
  autoSelectTargets?: boolean;
  autoSelectSingleTarget?: boolean;
  logTargets?: boolean;
  actionContext?: unknown;
  targetPreferences?: unknown;
  blueprintSourceCardId?: number | null;
  blueprintId?: string | null;
}

interface AIActionCommon {
  priority?: number;
  score?: number;
  reason?: string;
  card?: SimulatedCardState | GameCard | null;
  cardId?: RawCardDefinitionId | number;
  cardName?: string;
  name?: string;
  index?: number;
  effect?: EffectDefinition | null;
  effectId?: string | null;
  activationContext?: AIActivationContext;
  sourceCard?: SimulatedCardState | GameCard | null;
  sourceAction?: AIAction | null;
  p2Score?: number;
  p2Approved?: boolean;
  extra?: unknown;
}

export interface AscensionAIAction extends AIActionCommon {
  type: "ascension";
  ascensionCard?: SimulatedCardState | GameCard;
  ascensionIndex?: number;
  material?: SimulatedCardState | GameCard;
  materialIndex?: number;
  materialId?: RawCardDefinitionId | number;
  materialName?: string;
  position?: BattlePositionInput;
}

export interface ExtraDeckMaterialHint {
  index?: number;
  id?: RawCardDefinitionId | number;
  name?: string;
  instanceIds?: Array<string | number>;
}

export interface ExtraDeckProcedureAIAction extends AIActionCommon {
  type: "extraDeckProcedure";
  extraDeckCard?: SimulatedCardState | GameCard;
  extraDeckIndex?: number;
  procedureType?: string;
  materials?: ExtraDeckMaterialHint[];
  materialIndices?: number[];
  materialIds?: Array<RawCardDefinitionId | number>;
  materialNames?: string[];
  materialInstanceIds?: Array<Array<string | number>>;
  position?: BattlePositionInput;
}

export interface SanctumProtectorAIAction extends AIActionCommon {
  type: "special_summon_sanctum_protector";
  materialIndex?: number;
  position?: BattlePositionInput;
}

export interface PositionChangeAIAction extends AIActionCommon {
  type: "position_change";
  fieldIndex?: number;
  toPosition: BattlePosition;
}

export interface SummonAIAction extends AIActionCommon {
  type: "summon";
  position?: BattlePositionInput;
  facedown?: boolean;
  tributeIndices?: number[];
}

export interface SpellAIAction extends AIActionCommon {
  type: "spell";
}

export interface SetSpellTrapAIAction extends AIActionCommon {
  type: "set_spell_trap";
}

export interface SpellTrapEffectAIAction extends AIActionCommon {
  type: "spellTrapEffect";
  zoneIndex?: number;
}

export interface GraveyardSpellEffectAIAction extends AIActionCommon {
  type: "graveyardSpellEffect";
  graveyardIndex?: number;
}

export interface FieldEffectAIAction extends AIActionCommon {
  type: "fieldEffect";
}

export interface MonsterEffectAIAction extends AIActionCommon {
  type: "monsterEffect";
  fieldIndex?: number;
}

export interface GraveyardMonsterEffectAIAction extends AIActionCommon {
  type: "graveyardMonsterEffect";
  graveyardIndex?: number;
}

export interface HandIgnitionAIAction extends AIActionCommon {
  type: "handIgnition";
}

export interface AIActionByType {
  ascension: AscensionAIAction;
  extraDeckProcedure: ExtraDeckProcedureAIAction;
  special_summon_sanctum_protector: SanctumProtectorAIAction;
  position_change: PositionChangeAIAction;
  summon: SummonAIAction;
  spell: SpellAIAction;
  set_spell_trap: SetSpellTrapAIAction;
  spellTrapEffect: SpellTrapEffectAIAction;
  graveyardSpellEffect: GraveyardSpellEffectAIAction;
  fieldEffect: FieldEffectAIAction;
  monsterEffect: MonsterEffectAIAction;
  graveyardMonsterEffect: GraveyardMonsterEffectAIAction;
  handIgnition: HandIgnitionAIAction;
}

export type AIActionType = keyof AIActionByType;
export type AIActionOf<Type extends AIActionType> = AIActionByType[Type];
export type AIAction = AIActionByType[AIActionType];

/** Planner-only action; it is deliberately absent from the runtime dispatcher. */
export interface SimulatedBattleAction {
  type: "simulatedBattle";
  attacker?: SimulatedCardState | null;
  attackerName?: string;
  target?: SimulatedCardState | null;
  targetName?: string | null;
  direct?: boolean;
  damage?: number;
  destroyedNames?: Array<string | { name?: string | null }>;
  rewardNames?: unknown[];
  phaseBridge?: string | null;
  priority?: number;
  reason?: string;
}

/** Battle candidates predate the main-phase discriminant and remain separate. */
export interface BattleCandidate {
  attacker: SimulatedCardState | GameCard;
  target: SimulatedCardState | GameCard | null;
  score?: number;
  reason?: string;
}

export type AIPlannedAction = AIAction | SimulatedBattleAction;

export interface AIActionFingerprint {
  type: AIPlannedAction["type"] | null;
  cardName: string | null;
  cardId?: RawCardDefinitionId | number | null;
  index?: number | null;
  fieldIndex?: number | null;
  zoneIndex?: number | null;
  graveyardIndex?: number | null;
  materialIndex?: number | null;
  position?: BattlePositionInput | null;
  targetName?: string | null;
  direct?: boolean;
  damage?: number;
  destroyedNames?: string[];
  rewardNames?: unknown[];
  phaseBridge?: string | null;
  priority: number | null;
  targetPreferenceKeys?: string[];
}

export interface PlanningCardSummary {
  name: string;
  id: RawCardDefinitionId | number | null;
  instanceId: string | number | null;
  kind: string | null;
  position: string | null;
  faceDown: boolean;
  atk: number;
  def: number;
  tempAtk: number;
  tempDef: number;
  equipAtk: number;
  equipDef: number;
  cannotAttack: boolean;
  hasAttacked: boolean;
  counters: string[];
  blueprints: Array<string | number>;
  equips: string[];
}

export interface PlanningPlayerSummary {
  id: PlayerId | string | null;
  lp: number;
  summonCount: number;
  additionalNormalSummons: number;
  hand: string[];
  handSize: number;
  field: PlanningCardSummary[];
  spellTrap: PlanningCardSummary[];
  fieldSpell: PlanningCardSummary | null;
  graveyard: string[];
  graveyardSize: number;
  banished: string[];
  banishedSize: number;
  deckSize: number;
  extraDeckSize: number;
}

export interface PlanningStateSummary {
  phase: GamePhase | string | null;
  turn: unknown;
  turnCounter: number;
  bot: PlanningPlayerSummary;
  opponent: PlanningPlayerSummary;
}

export type PlanningDiffSeverity =
  | "none"
  | "minor"
  | "missing_summary"
  | "state_mismatch"
  | "host_equip_mismatch"
  | "counter_mismatch"
  | "blueprint_mismatch"
  | "hand_deck_mismatch"
  | "opponent_reaction_mismatch";

export interface PlanningSummaryDiff {
  path: string;
  severity: PlanningDiffSeverity;
  reason?: string;
  expected: unknown;
  actual: unknown;
}

export interface PlanningSummaryDiffResult {
  matched: boolean;
  severity: PlanningDiffSeverity;
  diffs: PlanningSummaryDiff[];
}

export interface CompactPlanningSummaryDiff {
  path: string;
  severity: PlanningDiffSeverity;
  expected: unknown;
  actual: unknown;
}

export interface PlannerResultSummary {
  score: number | null;
  baseScore: number | null;
  milestoneScore: number | null;
  sequence: AIActionFingerprint[];
  milestones: AILineMilestone[];
  reason: string | null;
  nodesEvaluated: number;
  diagnostics: TurnLineDiagnostics | null;
}

export interface ScoredAIAction<Action extends AIPlannedAction = AIPlannedAction> {
  action: Action;
  score: number;
  reasoning?: string;
}

export interface AITributeRequirement {
  tributesNeeded: number;
  usingAlt: boolean;
  alt: GameCard["altTribute"] | null;
}

export interface AITributeTradeResult {
  ok: boolean;
  reason?: string;
  score?: number;
}

export interface AIStrategyBotPort extends AiPlayerInput {
  id: PlayerId | string;
  lp: number;
  hand: Array<GameCard | SimulatedCardState>;
  field: Array<GameCard | SimulatedCardState>;
  graveyard: Array<GameCard | SimulatedCardState>;
  deck: Array<GameCard | SimulatedCardState>;
  extraDeck: Array<GameCard | SimulatedCardState>;
  banished: Array<GameCard | SimulatedCardState>;
  fieldSpell: GameCard | SimulatedCardState | null;
  spellTrap: Array<GameCard | SimulatedCardState>;
  debug?: boolean;
}

export interface AIPlanningContext {
  profile?: AIPlanningProfile;
  phase?: GamePhase | string | null;
  turnCounter?: number;
  sequence?: AIPlannedAction[];
  initialState?: AiStateShape | null;
  finalState?: AiStateShape | null;
  baseScore?: number;
  finalScore?: number;
  milestoneScore?: number;
  milestones?: AILineMilestone[];
  reason?: string;
  options?: unknown;
  planningContext?: unknown;
}

export interface AILineMilestoneDetail {
  id?: string;
  key?: string;
  label?: string;
  type?: string;
  reason?: string;
  score?: number;
  value?: number;
}

export type AILineMilestone = string | AILineMilestoneDetail;

export interface AILineMilestoneScore {
  scoreDelta: number;
  milestones: AILineMilestone[];
}

export interface StrategyRuntimePort {
  bot: AIStrategyBotPort;
  readonly archetypeLabel?: string;
  think?(thought: string): void;
  getPlanningProfile?(
    game: AIState,
    context?: AIPlanningContext,
  ): AIPlanningProfile;
  shouldUseDeepPlanning?(
    game: AIState,
    context?: AIPlanningContext,
  ): boolean;
  scoreLineMilestones?(
    context?: AIPlanningContext,
  ): AILineMilestoneScore;
  scoreLineTerminal?(context?: AIPlanningContext): number;
  describePlannedLine?(context?: AIPlanningContext): string;
  evaluateBoard(state: AIState, perspective?: SimulatedPlayerState): number;
  evaluateBoardV2?(state: AIState, perspective?: SimulatedPlayerState): number;
  generateMainPhaseActions(state: AIState): AIAction[];
  sequenceActions?(actions: AIAction[]): AIAction[];
  simulateMainPhaseAction(
    state:
      | SimulationGameState
      | GameTreeSimulationGameState
      | PerspectiveGameState,
    action: AIPlannedAction,
  ):
    | SimulationGameState
    | GameTreeSimulationGameState
    | PerspectiveGameState
    | void;
  simulateSpellEffect?(
    state:
      | SimulationGameState
      | GameTreeSimulationGameState
      | PerspectiveGameState,
    card: SimulatedCardState,
  ): void;
  getTributeRequirementFor?(
    card: SimulatedCardState,
    player: SimulatedPlayerState,
  ): AITributeRequirement;
  selectBestTributes?(
    field: SimulatedCardState[],
    tributesNeeded: number,
    card: SimulatedCardState,
    context?: unknown,
  ): number[];
  evaluateTributeTrade?(
    card: SimulatedCardState,
    field: SimulatedCardState[],
    tributesNeeded: number,
    context?: unknown,
  ): AITributeTradeResult;
  getOpponent?(
    state: AIState,
    perspective: SimulatedPlayerState,
  ): SimulatedPlayerState | null;
}

export type SearchStrategyPort = Omit<StrategyRuntimePort, "bot"> & {
  bot?: AIStrategyBotPort;
  id?: PlayerId | string;
};

export type StrategyConstructor = new (
  bot: AIStrategyBotPort,
) => StrategyRuntimePort;

export interface BeamSearchOptions {
  beamWidth?: number;
  maxDepth?: number;
  nodeBudget?: number;
  useV2Evaluation?: boolean;
  preGeneratedActions?: AIAction[] | null;
}

export interface BeamSearchResult {
  action: AIAction;
  score: number;
  sequence: AIAction[];
  nodesEvaluated: number;
}

export interface GreedySearchResult {
  action: AIAction;
  score: number;
  sequence: AIAction[];
}

export interface GameTreeSearchResult {
  action: AIAction | null;
  score: number;
  depth: number;
  confidence: number;
  transpositionHits?: number;
  error?: string;
}

export interface TurnLineSearchOptions extends BeamSearchOptions {
  candidateLimit?: number;
  turnMode?: AITurnPlanningMode;
  profile?: AIPlanningProfile;
  planningContext?: unknown;
  evaluateState?: (
    state: TurnLineSimulationGameState,
    perspective: SimulatedPlayerState,
  ) => number;
  evaluateMilestones?: (
    context: AIPlanningContext,
  ) => AILineMilestoneScore;
  battleStepLimit?: number;
}

export interface TurnLineDiagnostics {
  rootSummary: unknown;
  firstStepSummary: unknown;
  terminalSummary: unknown;
  sequenceFingerprints: AIActionFingerprint[];
}

export interface TurnLineSearchResult {
  action: AIPlannedAction;
  score: number;
  baseScore: number;
  milestoneScore: number;
  sequence: AIPlannedAction[];
  finalState: TurnLineSimulationGameState;
  nodesEvaluated: number;
  milestones: AILineMilestone[];
  diagnostics: TurnLineDiagnostics;
  reason: string;
  used: true;
}

export interface ThreatScoreContext {
  myStrongestAtk?: number;
  hasDefenses?: boolean;
  myArchetype?: string | null;
  myLP?: number;
  oppLP?: number;
}

export interface RankedThreat {
  card: SimulatedCardState | GameCard;
  threatScore: number;
}

export interface OpponentAnalysis {
  archetype: string;
  playstyle: string;
  nextMove: {
    card?: SimulatedCardState | GameCard | null;
    role?: string | null;
  } | null;
  threat_level: number;
  strengths?: string[];
  weaknesses?: string[];
  turnsToLethal?: number;
}

export interface ChainBlockingRisk {
  canBeBlocked: boolean;
  riskLevel: number;
  reason?: string;
  blockers?: Array<SimulatedCardState | GameCard>;
}

export interface SimulatedActionApplicationOptions {
  sourceCard?: SimulatedCardState | null;
  sourceAction?: AIPlannedAction | null;
  activationContext?: AIActivationContext;
  strategy?: StrategyRuntimePort;
  actionOverrides?: object;
  enableSimulatedEvents?: boolean;
  _simEventDepth?: number;
}

export interface SimulatedActionHandlerContext<Type extends ActionType> {
  action: ActionOf<Type>;
  targets: SimulatedCardState[];
  selections: CanonicalSelectionMap;
  state: SimulationGameState;
  selfId: PlayerId | string;
  options: SimulatedActionApplicationOptions;
  self: SimulatedPlayerState;
  opponent: SimulatedPlayerState;
  applySimulatedActions(input: SimulatedActionBatch): void;
}

export interface SimulatedActionBatch {
  actions?: readonly CardAction[];
  selections?: CanonicalSelectionMap;
  state: SimulationGameState;
  selfId?: PlayerId | string;
  options?: SimulatedActionApplicationOptions;
}

export type SimulatedActionHandler<
  Type extends ActionType,
  Stop extends symbol = symbol,
> = (
  context: SimulatedActionHandlerContext<Type>,
) => void | Stop;

export type SimulatedActionHandlerManifest<
  Type extends ActionType,
  Stop extends symbol = symbol,
> = {
  [Key in Type]: SimulatedActionHandler<Key, Stop>;
};

export interface StrategyRegistryPort {
  register(id: string, constructor: StrategyConstructor): void;
  get(id: string, bot: AIStrategyBotPort): StrategyRuntimePort;
  listIds(): string[];
}

export type RuntimeGamePlayer = GamePlayer;
