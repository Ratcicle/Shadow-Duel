import {
  ActionHandlerRegistry,
  proxyEngineMethod,
} from "../../src/core/actionHandlers/registry.js";
import type {
  ActionHandler,
  ActionTargetValue,
  EffectContext,
  LegacyActionHandlerResult,
  NormalizedActionExecutionResult,
  ResolvedTargetMap,
} from "../../src/core/contracts/actionRuntime.js";

const drawHandler: ActionHandler<"draw"> = (action) =>
  Number(action.amount) > 0;
const healHandler: ActionHandler<"heal"> = (action) =>
  Number(action.amount) > 0;
const registry = new ActionHandlerRegistry();

registry.register("draw", drawHandler);
registry.register("heal", healHandler);

// contract-negative: the registry correlates each key with its own action variant
// @ts-expect-error
registry.register("draw", healHandler);

// contract-negative: handler returns keep the closed legacy result contract
// @ts-expect-error
const invalidHandler: ActionHandler<"draw"> = () => ({ status: "ok" });

const drawProxy: ActionHandler<"draw"> =
  proxyEngineMethod<"draw">("applyDraw");

// contract-negative: a proxy action cannot name another action's engine method
// @ts-expect-error
proxyEngineMethod<"draw">("applyHeal");

// contract-negative: arbitrary EffectEngine property names are not proxy methods
// @ts-expect-error
proxyEngineMethod<"draw">("missingMethod");

const inferredDrawHandler = registry.get("draw");

type InferredDrawAction = Parameters<NonNullable<typeof inferredDrawHandler>>[0];
const inferredDrawAction: InferredDrawAction = { type: "draw", amount: 1 };

const context: EffectContext = { isPreview: true };
const targets: ResolvedTargetMap = {
  selected: { id: 1, name: "Selected" },
  group: [{ id: 2, name: "Group member" }],
  envelope: { card: { id: 3, name: "Envelope member" } },
  missing: null,
};
const target: ActionTargetValue = targets.selected;
const legacyResult: LegacyActionHandlerResult = null;
const normalizedResult: NormalizedActionExecutionResult = {
  success: true,
  executed: false,
  needsSelection: false,
};

// contract-negative: resolved targets do not accept unrelated primitive values
// @ts-expect-error
const invalidTarget: ActionTargetValue = 42;

// contract-negative: selection results must carry the opaque runtime contract
// @ts-expect-error
const missingSelectionContract: LegacyActionHandlerResult = {
  needsSelection: true,
};

const invalidNormalizedResult: NormalizedActionExecutionResult = {
  success: false,
  executed: false,
  // contract-negative: normalized dispatcher results cannot request selection
  // @ts-expect-error
  needsSelection: true,
};

void invalidHandler;
void drawProxy;
void inferredDrawAction;
void context;
void target;
void legacyResult;
void normalizedResult;
void invalidTarget;
void missingSelectionContract;
void invalidNormalizedResult;
