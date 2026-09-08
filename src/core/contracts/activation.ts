import type { GameCard } from "./cards.js";
import type {
  ChainActivationCommitment,
  ChainCostPayment,
  ChainSourceSnapshot,
  PreparedActivation,
} from "./chainRuntime.js";
import type { MaybePromise } from "./decisions.js";
import type { EffectDefinition } from "./effects.js";
import type { GamePhase } from "./game.js";
import type { GamePlayer } from "./player.js";
import type {
  CanonicalSelectionMap,
  NormalizedSelectionContract,
  RawSelectionContract,
  SelectionKind,
} from "./selection.js";
import type { CanonicalZone } from "./zones.js";

export type ActivationZone = CanonicalZone | null;

export interface ActivationCommitInfo {
  cardRef: GameCard;
  activationZone: CanonicalZone;
  fromIndex?: number | null;
  zoneIndex?: number | null;
  replacedFieldSpell?: GameCard | null;
}

export interface ActivationPipelineContext {
  fromHand?: boolean;
  activationZone?: ActivationZone;
  sourceZone?: ActivationZone;
  sourceWasFacedown?: boolean;
  selectionKind?: string;
  committed?: boolean;
  commitInfo?: ActivationCommitInfo | null;
  autoSelectSingleTarget?: boolean;
  autoSelectTargets?: boolean;
  costSelections?: CanonicalSelectionMap;
  targetSelections?: CanonicalSelectionMap;
  resolutionSelections?: CanonicalSelectionMap;
  resolvedSelectionCounts?: Readonly<Record<string, number>>;
  actionContext?: unknown;
  effectId?: string | null;
  prepareOnly?: boolean;
  preview?: boolean;
  isPreview?: boolean;
  applyingActivationCommitActions?: boolean;
  skipActivationWindow?: boolean;
  chainFinalizationHandled?: boolean;
  costsPaid?: boolean;
  costPayment?: ChainCostPayment | null;
  activationCommitment?: ChainActivationCommitment | null;
  sourceAtActivation?: ChainSourceSnapshot | null;
  sourceMoved?: boolean;
  latestSourceLocation?: ChainSourceSnapshot | null;
  chainId?: number | null;
  linkId?: number | null;
  finalizationId?: string | number | null;
}

export interface ActivationResolutionContext {
  source?: GameCard | null;
  sourceCard?: GameCard | null;
  player?: GamePlayer | null;
  opponent?: GamePlayer | null;
  effect?: EffectDefinition | null;
  activationZone?: ActivationZone;
  activationContext?: ActivationPipelineContext;
  _actionTargets?: CanonicalSelectionMap;
}

export interface ActivationPipelineResult {
  success: boolean;
  ok: boolean;
  needsSelection: boolean;
  selectionContract?: RawSelectionContract | NormalizedSelectionContract;
  reason?: string | null;
  code?: string | null;
  cancelled?: boolean;
  blockedByGuard?: boolean;
  blockedByRestriction?: boolean;
  blockedOncePerTurn?: boolean;
  activationSkipped?: boolean;
  skipActivationTracking?: boolean;
  noRollback?: boolean;
  placementOnly?: boolean;
  activationNegated?: boolean;
  fizzled?: boolean;
  committed?: boolean;
  costsPaid?: boolean;
  prepared?: boolean;
  preparedActivation?: PreparedActivation | null;
  commitInfo?: ActivationCommitInfo | null;
  activationZone?: ActivationZone;
  activationContext?: ActivationPipelineContext;
  cardRef?: GameCard | null;
  effect?: EffectDefinition | null;
  targets?: CanonicalSelectionMap;
  selections?: CanonicalSelectionMap;
  resolutionContext?: ActivationResolutionContext | null;
  chainId?: number | null;
  linkId?: number | null;
  finalizationId?: string | number | null;
}

export interface ActivationOncePerTurnConfig {
  card?: GameCard | null;
  player?: GamePlayer | null;
  effect?: EffectDefinition | null;
}

export interface ActivationPipelineFinalizeInfo {
  card: GameCard;
  owner: GamePlayer;
  activationZone: ActivationZone;
  activationContext: ActivationPipelineContext;
}

export interface ActivationPipelineConfig {
  card?: GameCard | null;
  owner?: GamePlayer | null;
  activationZone?: ActivationZone;
  activationContext?: ActivationPipelineContext | null;
  effect?: EffectDefinition | null;
  selections?: CanonicalSelectionMap | null;
  selectionKind?: SelectionKind;
  selectionMessage?: string | null;
  guardKind?: string;
  phaseReq?: GamePhase | readonly GamePhase[] | null;
  allowDuringSelection?: boolean;
  allowDuringResolving?: boolean;
  allowDuringOpponentTurn?: boolean;
  allowDuringChainWindow?: boolean;
  suppressFailureLog?: boolean;
  allowCancel?: boolean;
  preventCancel?: boolean;
  allowEmpty?: boolean;
  useFieldTargeting?: boolean;
  useAutoSelector?: boolean;
  prepareForExistingChain?: boolean;
  openActivationWindow?: boolean;
  finishOnSelection?: boolean;
  oncePerTurn?: ActivationOncePerTurnConfig | null;
  gate?: (() =>
    | ActivationPipelineResult
    | { ok: boolean; reason?: string | null; code?: string | null }
    | null
    | undefined) | null;
  preview?: (() =>
    | ActivationPipelineResult
    | { ok: boolean; reason?: string | null; code?: string | null }
    | null
    | undefined) | null;
  commit?: (() => MaybePromise<ActivationCommitInfo | null | undefined>) | null;
  activate(
    selections: CanonicalSelectionMap | null,
    context: ActivationPipelineContext,
    activationZone: ActivationZone,
    card: GameCard,
    owner: GamePlayer,
  ): MaybePromise<unknown>;
  finalize?(
    result: ActivationPipelineResult,
    info: ActivationPipelineFinalizeInfo,
  ): MaybePromise<void>;
  onSelectionStart?(): void;
  onCancel?: (() => void) | null;
  onFailure?(
    result: ActivationPipelineResult,
    context: ActivationPipelineContext,
  ): MaybePromise<void>;
  onSuccess?(
    result: ActivationPipelineResult,
    context: ActivationPipelineContext,
  ): MaybePromise<void>;
  onPreparationComplete?(
    result: ActivationPipelineResult,
    context: ActivationPipelineContext,
  ): MaybePromise<void>;
}

export type ActivationPipelineConfigInput = Omit<
  ActivationPipelineConfig,
  "activate"
> & {
  activate?: ActivationPipelineConfig["activate"];
};
