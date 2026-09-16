import type {
  NormalizedActionExecutionResult,
  NeedsSelectionResult,
  ResolvedTargetMap,
} from "../../contracts/actionRuntime.js";
import type {
  ActivationPipelineContext,
  ActivationZone,
} from "../../contracts/activation.js";
import type { GameCard } from "../../contracts/cards.js";
import type { EffectDefinition } from "../../contracts/effects.js";
import type { GamePhase } from "../../contracts/game.js";
import type { GamePlayer } from "../../contracts/player.js";
import type {
  CanonicalSelectionMap,
  NormalizedSelectionContract,
  RawSelectionRequirement,
  RawSelectionContract,
} from "../../contracts/selection.js";
import type { UiRect } from "../../contracts/ui.js";
import type {
  applyActions,
  checkActionPreviewRequirements,
} from "../actions/core.js";
import type { handleBlueprintStorageAfterResolution } from "../blueprints/index.js";
import type { evaluateConditions } from "../conditions/evaluateConditions.js";
import type { resolveTargets } from "../targeting/resolution.js";
import type { commitEffectUsage } from "../triggers/registration.js";

export type ActivationCard = GameCard & {
  simInstanceId?: number | string | null;
};

export type ActivationPlayer = GamePlayer;

export interface ActivationCheckResult {
  ok: boolean;
  reason?: string | null | undefined;
  code?: string | undefined;
}

export interface ActivationPreviewResult extends ActivationCheckResult {
  needsSelection?: boolean | undefined;
  placementOnly?: boolean | undefined;
}

export interface QuickSpellWindowContext {
  legalWindow?: boolean | undefined;
  isChainWindow?: boolean | undefined;
  chainWindowOpen?: boolean | undefined;
  openState?: boolean | undefined;
  type?: string | null | undefined;
  event?: string | null | undefined;
  responseContextType?: string | null | undefined;
  respondingToChainLink?: unknown;
  activationAttempt?: unknown;
  requiredSpellSpeed?: number | undefined;
  respondingToSpellSpeed?: number | undefined;
  lastSpellSpeed?: number | undefined;
  isDamageStep?: boolean | undefined;
  damageStepTiming?: string | null | undefined;
  activationZone?: string | null | undefined;
  zone?: string | null | undefined;
  effect?: EffectDefinition | null | undefined;
  phase?: GamePhase | string | null | undefined;
}

export interface ActivationActionContext extends QuickSpellWindowContext {
  context?: QuickSpellWindowContext | null | undefined;
}

export interface ActivationRuntimeContext extends ActivationPipelineContext {
  context?: unknown;
  quickSpellContext?: unknown;
  fromSet?: boolean | undefined;
  trapActivationFromSet?: boolean | undefined;
  quickSpellActivationFromSet?: boolean | undefined;
  resolvedTargets?: ResolvedTargetMap | null | undefined;
  sourceRect?: UiRect | null | undefined;
  devFailAfterCommit?: boolean | undefined;
}

export interface ActivationEffectContext {
  source: ActivationCard;
  player: ActivationPlayer;
  opponent: ActivationPlayer | null;
  effect?: EffectDefinition | null | undefined;
  effectId?: string | null | undefined;
  activationZone: ActivationZone;
  activationContext: ActivationRuntimeContext;
  actionContext?: unknown;
  targetSelections?: CanonicalSelectionMap | undefined;
  _actionTargets?: ResolvedTargetMap | CanonicalSelectionMap | undefined;
}

type ActivationSelectionContract = Omit<
  RawSelectionContract,
  "requirements"
> & {
  requirements?: RawSelectionRequirement[] | undefined;
};

export type ActivationTargetResult =
  | {
      ok?: boolean | undefined;
      needsSelection?: false | undefined;
      reason?: string | undefined;
      targets?: ResolvedTargetMap | undefined;
      selectionContract?:
        | ActivationSelectionContract
        | NormalizedSelectionContract
        | undefined;
    }
  | {
      ok?: boolean | undefined;
      needsSelection: true;
      reason?: string | null | undefined;
      targets?: ResolvedTargetMap | undefined;
      selectionContract:
        | ActivationSelectionContract
        | NormalizedSelectionContract;
    };

export type ActivationActionResult =
  | NormalizedActionExecutionResult
  | NeedsSelectionResult;

export interface ActivationExecutionResult {
  success: boolean;
  needsSelection: boolean;
  reason?: string | null | undefined;
  selectionContract?:
    | RawSelectionContract
    | NormalizedSelectionContract
    | undefined;
  actionResult?: ActivationActionResult | null | undefined;
  activationContext?: ActivationRuntimeContext | undefined;
  prepared?: boolean | undefined;
  placementOnly?: boolean | undefined;
  effect?: EffectDefinition | undefined;
  targets?: ResolvedTargetMap | undefined;
}

export interface SpellTrapActivationOptions {
  fromHand?: boolean | undefined;
  fromSet?: boolean | undefined;
  trapActivationFromSet?: boolean | undefined;
  activationZone?: ActivationZone | undefined;
}

export interface MonsterEffectLookupOptions {
  effectId?: string | null | undefined;
  activationContext?: ActivationRuntimeContext | null | undefined;
}

export interface ActivationPreviewOptions extends MonsterEffectLookupOptions {
  quickSpellContext?: QuickSpellWindowContext | null | undefined;
}

export interface ActivatableMonsterEffectEntry {
  effect: EffectDefinition;
  preview: ActivationPreviewResult;
}

export interface ActivationAnimationSource {
  rect?: UiRect | null | undefined;
}

export interface ActivationGamePort {
  turn?: string | null | undefined;
  phase?: GamePhase | string | null | undefined;
  turnCounter?: number | undefined;
  devModeEnabled?: boolean | undefined;
  ui?:
    | {
        captureCardAnimationSource?(
          card: ActivationCard,
          options: { ownerId: string; zone: ActivationZone },
        ): ActivationAnimationSource | null | undefined;
      }
    | null
    | undefined;
  getOpponent(player: ActivationPlayer): ActivationPlayer | null;
  canActivatePolymerization?(player: ActivationPlayer): boolean;
  canActivateTrap?(card: ActivationCard): boolean;
  canActivateCardEffectUnderRestrictions?(
    card: ActivationCard,
    player: ActivationPlayer,
    effect: EffectDefinition,
    options?: { silent?: boolean | undefined },
  ): ActivationCheckResult;
  presentSpellTrapActivationFlip?(
    card: ActivationCard,
    player: ActivationPlayer,
    activationZone?: "spellTrap" | "fieldSpell",
  ): unknown;
  queueVisualFeedback?(feedback: {
    kind: string;
    sourceCard: ActivationCard;
    ownerId: string;
    fromZone: ActivationZone;
    sourceRect: UiRect | null;
    tone: string;
  }): unknown;
  updateBoard?(): unknown;
  waitForAiPresentationStep?(player: ActivationPlayer): unknown;
  checkWinCondition(): unknown;
  devLog?(tag: string, detail?: object): void;
}

export interface ActivationGetterHost {
  getHandActivationEffect?(
    card: ActivationCard | null | undefined,
  ): EffectDefinition | null;
  getMonsterIgnitionEffects?(
    card: ActivationCard | null | undefined,
    activationZone?: ActivationZone,
  ): EffectDefinition[];
  getActivatableMonsterIgnitionEffects?(
    card: ActivationCard,
    player: ActivationPlayer,
    activationZone?: ActivationZone,
    options?: ActivationPreviewOptions,
  ): ActivatableMonsterEffectEntry[];
  canActivateMonsterEffectPreview?(
    card: ActivationCard,
    player: ActivationPlayer,
    activationZone?: ActivationZone,
    selections?: CanonicalSelectionMap | null,
    options?: ActivationPreviewOptions,
  ): ActivationPreviewResult;
}

export interface ActivationEngineHost extends ActivationGetterHost {
  readonly game: ActivationGamePort;
  getHandActivationEffect(
    card: ActivationCard | null | undefined,
  ): EffectDefinition | null;
  getSpellTrapActivationEffect(
    card: ActivationCard | null | undefined,
    options?: SpellTrapActivationOptions,
  ): EffectDefinition | null;
  getMonsterIgnitionEffects(
    card: ActivationCard | null | undefined,
    activationZone?: ActivationZone,
  ): EffectDefinition[];
  getMonsterIgnitionEffect(
    card: ActivationCard | null | undefined,
    activationZone?: ActivationZone,
    options?: MonsterEffectLookupOptions | string,
  ): EffectDefinition | null;
  getActivatableMonsterIgnitionEffects(
    card: ActivationCard,
    player: ActivationPlayer,
    activationZone?: ActivationZone,
    options?: ActivationPreviewOptions,
  ): ActivatableMonsterEffectEntry[];
  getFirstActivatableMonsterIgnitionEffect(
    card: ActivationCard,
    player: ActivationPlayer,
    activationZone?: ActivationZone,
    options?: ActivationPreviewOptions,
  ): ActivatableMonsterEffectEntry | null;
  getFieldSpellActivationEffect(
    card: ActivationCard | null | undefined,
  ): EffectDefinition | null;
  canActivate(
    card: ActivationCard,
    player: ActivationPlayer,
  ): ActivationCheckResult;
  canActivateMonsterEffectPreview(
    card: ActivationCard,
    player: ActivationPlayer,
    activationZone?: ActivationZone,
    selections?: CanonicalSelectionMap | null,
    options?: ActivationPreviewOptions,
  ): ActivationPreviewResult;
  canActivateSpellTrapEffectPreview(
    card: ActivationCard,
    player: ActivationPlayer,
    activationZone?: ActivationZone,
    selections?: CanonicalSelectionMap | null,
    options?: ActivationPreviewOptions,
  ): ActivationPreviewResult;
  checkOncePerTurn(
    card: ActivationCard,
    player: ActivationPlayer,
    effect: EffectDefinition,
  ): ActivationCheckResult;
  checkOncePerDuel(
    card: ActivationCard,
    player: ActivationPlayer,
    effect: EffectDefinition,
  ): ActivationCheckResult;
  evaluateConditions: OmitThisParameter<typeof evaluateConditions>;
  resolveTargets: OmitThisParameter<typeof resolveTargets>;
  checkActionPreviewRequirements: OmitThisParameter<
    typeof checkActionPreviewRequirements
  >;
  applyActions: OmitThisParameter<typeof applyActions>;
  commitEffectUsage: OmitThisParameter<typeof commitEffectUsage>;
  handleBlueprintStorageAfterResolution: OmitThisParameter<
    typeof handleBlueprintStorageAfterResolution
  >;
}

export type ActivationConditionContext = Parameters<
  ActivationEngineHost["evaluateConditions"]
>[1];
export type ActivationTargetResolutionContext = Parameters<
  ActivationEngineHost["resolveTargets"]
>[1];
export type ActivationActionPreviewContext = Parameters<
  ActivationEngineHost["checkActionPreviewRequirements"]
>[1];
export type ActivationActionExecutionContext = Parameters<
  ActivationEngineHost["applyActions"]
>[1];
export type ActivationBlueprintContext = Parameters<
  ActivationEngineHost["handleBlueprintStorageAfterResolution"]
>[2];

export type ActivationPhaseRequirement = GamePhase | readonly GamePhase[];

export function asQuickSpellWindowContext(
  value: unknown,
): QuickSpellWindowContext {
  return Object(value) as QuickSpellWindowContext;
}
