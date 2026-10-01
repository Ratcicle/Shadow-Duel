import type EffectEngine from "../../src/core/EffectEngine.js";
import type {
  NeedsSelectionResult,
  NormalizedActionExecutionResult,
} from "../../src/core/contracts/actionRuntime.js";
import type { RawSelectionContract } from "../../src/core/contracts/selection.js";
import type { handleTriggeredEffect } from "../../src/core/effects/triggers/core.js";
import type {
  BuildTriggerEntryOptions,
  TriggerActivationContext,
  TriggerCollectorHost,
  TriggerContext,
  TriggerEffectLike,
} from "../../src/core/effects/triggers/runtime.js";

type CoreTriggerResult = Awaited<ReturnType<typeof handleTriggeredEffect>>;
type HostTriggerResult = Awaited<
  ReturnType<TriggerCollectorHost["handleTriggeredEffect"]>
>;
type EngineTriggerResult = Awaited<
  ReturnType<EffectEngine["handleTriggeredEffect"]>
>;

declare const selectionContract: RawSelectionContract;
declare const resolutionContext: TriggerContext;
declare const activationContext: TriggerActivationContext;
declare const effect: TriggerEffectLike;

const selectedLater: CoreTriggerResult = {
  success: false,
  needsSelection: true,
  selectionContract,
  resolutionContext,
};
const prepared: CoreTriggerResult = {
  success: true,
  needsSelection: false,
  prepared: true,
  effect,
  targets: {},
  activationContext,
  resolutionContext,
};
const completed: CoreTriggerResult = {
  success: true,
  needsSelection: false,
};
const skipped: CoreTriggerResult = {
  success: false,
  needsSelection: false,
  activationSkipped: true,
  reason: "Trigger source is no longer legal.",
};

// contract-negative: deferred trigger targeting must preserve its event resolution context.
// @ts-expect-error
const missingSelectionContext: CoreTriggerResult = { success: false, needsSelection: true, selectionContract };

// contract-negative: an undefined context cannot replace the live trigger context.
// @ts-expect-error
const undefinedSelectionContext: CoreTriggerResult = { success: false, needsSelection: true, selectionContract, resolutionContext: undefined };

// contract-negative: a fully prepared trigger also needs its event resolution context.
// @ts-expect-error
const missingPreparedContext: CoreTriggerResult = { success: true, needsSelection: false, prepared: true, effect, targets: {}, activationContext };

const actionSelection: NeedsSelectionResult = {
  success: false,
  needsSelection: true,
  selectionContract,
};

// contract-negative: a typed action suspension must not bypass the core trigger context requirement.
// @ts-expect-error
const actionSelectionAsTrigger: CoreTriggerResult = actionSelection;

// contract-negative: the collector port must preserve the same strict trigger result as its implementation.
// @ts-expect-error
const actionSelectionAsHostTrigger: HostTriggerResult = actionSelection;

// contract-negative: the attached engine method must not widen the trigger result back to bare action results.
// @ts-expect-error
const actionSelectionAsEngineTrigger: EngineTriggerResult = actionSelection;

const normalizedAction: NormalizedActionExecutionResult = {
  success: true,
  executed: true,
  needsSelection: false,
};
const preparedActionWithoutContext = {
  ...normalizedAction,
  success: true as const,
  prepared: true as const,
  effect,
  targets: {},
  activationContext,
};

// contract-negative: a typed prepared result cannot enter through the completed-action branch without context.
// @ts-expect-error
const preparedActionAsTrigger: CoreTriggerResult = preparedActionWithoutContext;

const completedActionAsTrigger: CoreTriggerResult = normalizedAction;
const actionSelectionWithContext: CoreTriggerResult = {
  ...actionSelection,
  resolutionContext,
};
const customActionTrigger: NonNullable<BuildTriggerEntryOptions["activate"]> =
  () => actionSelection;
const customLegacyTrigger: NonNullable<BuildTriggerEntryOptions["activate"]> =
  () => true;

void selectedLater;
void prepared;
void completed;
void skipped;
void missingSelectionContext;
void undefinedSelectionContext;
void missingPreparedContext;
void actionSelectionAsTrigger;
void actionSelectionAsHostTrigger;
void actionSelectionAsEngineTrigger;
void preparedActionAsTrigger;
void completedActionAsTrigger;
void actionSelectionWithContext;
void customActionTrigger;
void customLegacyTrigger;
