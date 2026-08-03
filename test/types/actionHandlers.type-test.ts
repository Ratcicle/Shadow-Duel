import { ActionHandlerRegistry } from "../../src/core/actionHandlers/registry.js";
import {
  ACTION_BINDINGS,
  getActionBindingLabel,
} from "../../src/core/actionHandlers/actionBindings.js";
import type {
  ActionBindingByType,
  ActionBindingLabelByType,
  CompatibleEffectEngineMethodFor,
  ProxyActionBinding,
} from "../../src/core/actionHandlers/actionBindings.js";
import { handleBuffStatsTemp } from "../../src/core/actionHandlers/stats.js";
import EffectEngine from "../../src/core/EffectEngine.js";
import type { ActionCatalogEntry } from "../../src/core/contracts/actions.js";
import type {
  ActionHandler,
  ActionHandlerEnginePort,
  LegacyActionHandlerResult,
} from "../../src/core/contracts/actionRuntime.js";

declare const drawHandler: ActionHandler<"draw">;
declare const healHandler: ActionHandler<"heal">;
declare const onlyBuffStatsHandler: ActionHandler<"buff_stats_temp">;
declare const engine: EffectEngine;
declare const actionEngine: ActionHandlerEnginePort;

const registry = new ActionHandlerRegistry();
registry.register("draw", drawHandler);
const correlatedDrawHandler: ActionHandler<"draw"> | null =
  registry.get("draw");

// contract-negative: a handler for another action cannot be registered as draw.
// @ts-expect-error
registry.register("draw", healHandler);

const buffAliases: ActionHandler<
  | "buff_stats_temp"
  | "reduce_self_atk"
  | "grant_second_attack"
  | "buff_stats_temp_with_second_attack"
> = handleBuffStatsTemp;

void buffAliases;
void correlatedDrawHandler;

// contract-negative: buff aliases do not accept an unrelated action variant.
// @ts-expect-error
handleBuffStatsTemp({ type: "draw", amount: 1 }, {}, {}, actionEngine);

// contract-negative: an alias handler must accept every variant in its alias group.
// @ts-expect-error
const incompleteBuffAliases: typeof buffAliases = onlyBuffStatsHandler;
void incompleteBuffAliases;

const drawProxyMethod: CompatibleEffectEngineMethodFor<"draw"> = "applyDraw";
void drawProxyMethod;

// contract-negative: a proxy action cannot name an incompatible engine method.
// @ts-expect-error
const invalidDrawProxyMethod: CompatibleEffectEngineMethodFor<"draw"> =
  "applyHeal";
void invalidDrawProxyMethod;

const drawProxy: ProxyActionBinding<"draw"> = {
  kind: "proxy",
  method: "applyDraw",
};
void drawProxy;

const invalidDrawProxy: ProxyActionBinding<"draw"> = {
  kind: "proxy",
  // contract-negative: proxy bindings reject incompatible method names.
  // @ts-expect-error
  method: "applyHeal",
};
void invalidDrawProxy;

const missingDrawProxy: ProxyActionBinding<"draw"> = {
  kind: "proxy",
  // contract-negative: a proxy binding cannot reference a nonexistent engine method.
  // @ts-expect-error
  method: "applyMissingMethod",
};
void missingDrawProxy;

// contract-negative: the binding manifest cannot omit ActionByType keys.
// @ts-expect-error
const incompleteBindings = {} satisfies ActionBindingByType;
void incompleteBindings;

const bindingsWithExtraKey = {
  ...ACTION_BINDINGS,
  // contract-negative: the binding manifest cannot introduce keys outside ActionByType.
  // @ts-expect-error
  imaginary_action: ACTION_BINDINGS.draw,
} satisfies ActionBindingByType;
void bindingsWithExtraKey;

const validLegacyResult: LegacyActionHandlerResult = {
  success: true,
  executed: false,
};
void validLegacyResult;

// contract-negative: migration does not introduce a status-based result shape.
// @ts-expect-error
const statusResult: LegacyActionHandlerResult = { status: "ok" };
void statusResult;

// contract-negative: numeric handler returns are outside the legacy contract.
// @ts-expect-error
const numericResult: LegacyActionHandlerResult = 1;
void numericResult;

// contract-negative: handlers cannot return values outside the legacy result contract.
// @ts-expect-error
const numericResultHandler: ActionHandler<"draw"> = () => 1;
void numericResultHandler;

type DrawCatalogEntry = ActionCatalogEntry<
  "draw",
  ActionBindingLabelByType["draw"]
>;
declare const drawCatalogEntry: DrawCatalogEntry;
const exactDrawLabel: "proxy:applyDraw" = drawCatalogEntry.handler;
const exactRuntimeDrawLabel: "proxy:applyDraw" =
  getActionBindingLabel("draw");

// contract-negative: catalog labels are tied to the canonical binding for the action.
// @ts-expect-error
const invalidDrawLabel: DrawCatalogEntry["handler"] = "applyDraw";

void exactDrawLabel;
void exactRuntimeDrawLabel;
void invalidDrawLabel;

const attachedDraw: typeof engine.applyDraw = engine.applyDraw;
void attachedDraw;
