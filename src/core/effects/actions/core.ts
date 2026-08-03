import {
  cardMatchesKind,
  getCardComparableAttribute,
} from "../../Card.js";
import { hasSynchroSummonPreviewCandidate } from "../../actionHandlers/summon/synchroEffects.js";
import { mergeCanonicalSelections } from "../../game/selection/contract.js";
import { checkSpecialSummonEligibility } from "../../game/summon/eligibility.js";
import type { ActionHandlerRegistry } from "../../actionHandlers/registry.js";
import type Game from "../../Game.js";
import type {
  ActionHandlerEnginePort,
  ActionRuntimeCard,
  ActionRuntimeGamePort,
  ActionRuntimePlayer,
  EffectContext,
  LegacyActionHandlerResult,
  NeedsSelectionResult,
  NormalizedActionExecutionResult,
  ResolvedTargetMap,
} from "../../contracts/actionRuntime.js";
import { readContextValue, writeContextValue } from "../../contracts/actionRuntime.js";
import type {
  ActionCase,
  ActionOf,
  ActionOwner,
  ActionPlayerScope,
  ActionType,
  CardAction,
  ContextNumberSource,
  SelectionCount,
} from "../../contracts/actions.js";
import type {
  CardFilter,
  EffectCondition,
  EffectTarget,
  PairedEffectTarget,
} from "../../contracts/effects.js";
import type { ZoneInput } from "../../contracts/zones.js";

type PreviewZone =
  | "deck"
  | "hand"
  | "field"
  | "graveyard"
  | "spellTrap"
  | "fieldSpell"
  | "extraDeck"
  | "banished";

interface PreviewCard extends ActionRuntimeCard {
  cannotBeSpecialSummoned?: boolean;
  lastSummonMethod?: string;
  lastSummonMethods?: readonly string[];
  lastSummonedFromZone?: string;
  lastSummonedFromZones?: readonly string[];
}

interface PreviewContext extends EffectContext {
  fieldCounterCounts?: Record<string, number>;
  activationContext?: (NonNullable<EffectContext["activationContext"]> & {
    costSelections?: ResolvedTargetMap;
    sourceRect?: unknown;
  }) | null;
}

interface PreviewFilter {
  archetype?: string;
  attribute?: string;
  cardId?: number;
  cardIds?: readonly number[];
  cardKind?: string | readonly string[];
  cardName?: string;
  destinationOwner?: "self" | "opponent";
  excludeCannotBeSpecialSummoned?: boolean;
  excludeCardId?: number;
  excludeCardIds?: readonly number[];
  excludeCardName?: string;
  excludeCardNames?: readonly string[];
  excludeId?: number;
  excludeIds?: readonly number[];
  excludeName?: string;
  excludeNames?: readonly string[];
  excludeSelf?: boolean;
  facedown?: boolean;
  filters?: CardFilter;
  isToken?: boolean;
  isTuner?: boolean;
  lastSummonMethod?: string;
  lastSummonMethods?: readonly string[];
  lastSummonedFromZone?: string;
  lastSummonedFromZones?: readonly string[];
  level?: number;
  levelOp?: "eq" | "lte" | "gte" | "lt" | "gt";
  maxAtk?: number;
  maxDef?: number;
  maxLevel?: number;
  minAtk?: number;
  minDef?: number;
  minLevel?: number;
  monsterType?: string | readonly string[];
  name?: string;
  position?: string;
  requireFaceup?: boolean;
  specialSummonProcedure?: string;
  subtype?: string | readonly string[];
  summonMethod?: string;
  summonProcedure?: string;
  summonToOwner?: "self" | "opponent";
  type?: string | readonly string[];
  zone?: ZoneInput | null;
}

interface LegacyPairComparison {
  readonly attr?: string;
  readonly attribute?: string;
  readonly pairedAttr?: string;
  readonly targetAttr?: string;
  readonly sourceAttr?: string;
  readonly refAttr?: string;
  readonly op?: string;
}

type LegacyPairedTarget = Omit<PairedEffectTarget, "compareAttribute"> & {
  readonly compareAttribute?:
    | LegacyPairComparison
    | readonly LegacyPairComparison[];
  readonly compareAttributes?: readonly LegacyPairComparison[];
  readonly excludeSameCard?: boolean;
  readonly zones?: readonly PreviewZone[];
};

interface PreviewTarget extends Omit<EffectTarget, "filters" | "pairedTarget" | "zone" | "zones"> {
  allowSelf?: boolean;
  cardIds?: readonly number[];
  excludeCardIds?: readonly number[];
  excludeCardId?: number;
  excludeCardNames?: readonly string[];
  excludeId?: number;
  excludeIds?: readonly number[];
  excludeName?: string;
  excludeNames?: readonly string[];
  facedown?: boolean;
  filters?: PreviewFilter;
  includeSelf?: boolean;
  isToken?: boolean;
  lastSummonMethod?: string;
  lastSummonMethods?: readonly string[];
  lastSummonedFromZones?: readonly string[];
  level?: number;
  levelOp?: PreviewFilter["levelOp"];
  max?: number;
  maxAtk?: number;
  min?: number;
  minDef?: number;
  pairedTarget?: LegacyPairedTarget;
  player?: ActionPlayerScope;
  position?: string;
  requiresPairedTarget?: LegacyPairedTarget;
  summonMethod?: string;
  zone?: PreviewZone;
  zones?: readonly PreviewZone[];
}

interface FieldCountSpec {
  readonly zones?: readonly PreviewZone[];
  readonly zone?: PreviewZone;
  readonly filters?: PreviewFilter;
  readonly owner?: ActionOwner;
  readonly player?: ActionPlayerScope;
  readonly multiplier?: number;
  readonly baseAmount?: number;
  readonly base?: number;
  readonly min?: number;
  readonly max?: number;
}

interface PreviewAction {
  readonly type: ActionType | string;
  readonly allowBelow?: boolean;
  readonly allowCancel?: boolean;
  readonly amount?: number;
  readonly amountFromFieldCount?: FieldCountSpec;
  readonly archetype?: string;
  readonly cardId?: number;
  readonly cardKind?: string | readonly string[];
  readonly cardName?: string;
  readonly cases?: readonly ActionCase[];
  readonly condition?: EffectCondition | { readonly type?: string; readonly zone?: PreviewZone; readonly cardName?: string; readonly typeName?: string; readonly cardType?: string };
  readonly contextKey?: string;
  readonly costFilters?: PreviewFilter;
  readonly costTargetRef?: string;
  readonly count?: number | SelectionCount;
  readonly counterMultiplier?: number;
  readonly counterType?: string;
  readonly damagePerCounter?: number;
  readonly distinctNames?: boolean;
  readonly fieldSlotsFreedBeforeSummon?: number;
  readonly filters?: PreviewFilter;
  readonly fraction?: number;
  readonly isTuner?: boolean;
  readonly level?: number;
  readonly levelOp?: PreviewFilter["levelOp"];
  readonly matchLevelRef?: string;
  readonly maxAmount?: number;
  readonly maxAtk?: number;
  readonly maxLevel?: number;
  readonly maxLevelFromContext?: ContextNumberSource | string;
  readonly maxTargets?: number;
  readonly minAmount?: number;
  readonly minAtk?: number;
  readonly minCost?: number;
  readonly minLevel?: number;
  readonly minTargets?: number;
  readonly mode?: string;
  readonly monsterType?: string | readonly string[];
  readonly optional?: boolean;
  readonly owner?: ActionOwner;
  readonly player?: ActionPlayerScope;
  readonly position?: string;
  readonly property?: string;
  readonly required?: boolean;
  readonly requireFaceup?: boolean;
  readonly requireSource?: boolean;
  readonly resultKey?: string;
  readonly scope?: string;
  readonly sourceOwner?: string;
  readonly sourceScope?: string;
  readonly sourceZone?: PreviewZone | readonly PreviewZone[];
  readonly stateKey?: string;
  readonly storeAs?: string;
  readonly subtype?: string | readonly string[];
  readonly summonToOwner?: "self" | "opponent";
  readonly targetCountFromContext?: ContextNumberSource | string;
  readonly targetRef?: string;
  readonly targets?: readonly PreviewTarget[];
  readonly to?: PreviewZone;
  readonly token?: {
    readonly name: string;
    readonly atk: number;
    readonly def: number;
    readonly level?: number;
    readonly type?: string;
    readonly attribute?: string;
    readonly archetype?: string;
    readonly archetypes?: readonly string[];
  };
  readonly toZone?: PreviewZone;
  readonly variableAmount?: boolean;
  readonly zone?: PreviewZone | readonly PreviewZone[];
  readonly zones?: readonly PreviewZone[];
}

interface PreviewMove {
  owner: ActionRuntimePlayer;
  zone: PreviewZone;
  cards: PreviewCard[];
  maxCount: number | null;
}

interface PreviewResult {
  readonly ok: boolean;
  readonly reason?: string;
}

interface ActionCoreHost {
  game: Game;
  actionHandlers: ActionHandlerRegistry;
  filterTargetsByImmunity(
    action: CardAction,
    context: EffectContext,
    targets: ResolvedTargetMap,
  ): {
    readonly skipAction: boolean;
    readonly skippedCount: number;
    readonly allowedCount: number;
    readonly filteredTargets: ResolvedTargetMap;
  };
  cardMatchesFilters(card: ActionRuntimeCard, filters: object): boolean;
  findCardZone(
    player: ActionRuntimePlayer,
    card: ActionRuntimeCard,
  ): string | null;
  resolveLpCost(
    action: CardAction,
    context: EffectContext,
    baseAmount: number,
    options: { readonly consume: boolean },
  ): { readonly finalAmount?: number } | null;
  evaluateConditions(
    conditions: readonly EffectCondition[],
    context: EffectContext,
  ): { readonly ok: boolean };
  resolveTargets(
    targets: readonly EffectTarget[],
    context: EffectContext,
    options: object | null,
  ): unknown;
  checkActionPreviewRequirements(
    actions: readonly CardAction[],
    context: EffectContext,
  ): PreviewResult;
}

type EffectEngine = ActionCoreHost;

interface ActionResultOptions {
  readonly success?: boolean;
  readonly executed?: boolean;
  readonly failedAction?: ActionType | string | null;
  readonly reason?: string | null;
  readonly error?: unknown;
  readonly action?: CardAction | null;
  readonly skippedCount?: number;
}

interface LegacyNumberReference {
  readonly key?: string;
  readonly contextKey?: string;
  readonly path?: string;
  readonly resultKey?: string;
  readonly defaultValue?: unknown;
  readonly default?: unknown;
  readonly fallback?: unknown;
  readonly multiplier?: number;
  readonly divideBy?: number;
  readonly round?: "floor" | "ceil" | "round";
}

type DevLogger = (tag: string, detail?: object) => void;

function errorMessage(error: unknown, fallback: string): string {
  if (
    error !== null &&
    (typeof error === "object" || typeof error === "function")
  ) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

function isRuntimePlayer(
  value: ActionRuntimePlayer | null | undefined,
): value is ActionRuntimePlayer {
  return value !== null && value !== undefined;
}

function getRuntimeCounter(
  card: ActionRuntimeCard | null | undefined,
  counterType: string,
): number {
  if (!card) return 0;
  if (typeof card.getCounter === "function") {
    return Math.max(0, Number(card.getCounter(counterType) || 0));
  }
  if (card.counters instanceof Map) {
    return Math.max(0, Number(card.counters.get(counterType) || 0));
  }
  return Math.max(0, Number(card.counters?.[counterType] || 0));
}

/**
 * Actions Core - applyActions dispatcher and preview requirements
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

export function actionResultSucceeded(
  result: LegacyActionHandlerResult,
): boolean | null | undefined {
  if (result === true) return true;
  return (
    result &&
    typeof result === "object" &&
    result.success !== false &&
    result.needsSelection !== true
  );
}

function isActionResultFailure(
  result: LegacyActionHandlerResult,
): boolean | null | undefined {
  return (
    result === false ||
    (result &&
      typeof result === "object" &&
      result.success === false &&
      result.needsSelection !== true)
  );
}

function isActionOptionalNoop(action: PreviewAction | null | undefined): boolean {
  if (!action) return false;
  if (action.optional === true) return true;
  const min = Number(
    typeof action.count === "object" ? action.count?.min : undefined,
  );
  return Number.isFinite(min) && min <= 0;
}

function createActionResult({
  success,
  executed = false,
  failedAction = null,
  reason = null,
  error = null,
  action = null,
  skippedCount = 0,
}: ActionResultOptions = {}): NormalizedActionExecutionResult {
  const result: NormalizedActionExecutionResult = {
    success: success !== false,
    executed: executed === true,
    needsSelection: false,
  };
  if (failedAction) result.failedAction = failedAction;
  if (reason) result.reason = reason;
  if (error) result.error = error;
  if (action) result.action = action;
  if (skippedCount) result.skippedCount = skippedCount;
  return result;
}

function getTargetCards(targets: ResolvedTargetMap | null | undefined): ActionRuntimeCard[] {
  const cards: ActionRuntimeCard[] = [];
  const visit = (value: unknown): void => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (typeof value === "object" && Reflect.has(value, "card")) {
      visit(Reflect.get(value, "card"));
      return;
    }
    if (typeof value === "object") {
      cards.push(value as ActionRuntimeCard);
    }
  };

  for (const value of Object.values(targets || {})) {
    visit(value);
  }
  return cards;
}

function findOwnerForTarget(
  game: Game | null | undefined,
  fallbackOwner: ActionRuntimePlayer | null,
  card: ActionRuntimeCard,
): ActionRuntimePlayer | null {
  if (!game || !card) return fallbackOwner || null;
  const owners = [game.player, game.bot].filter(Boolean);
  const zones = [
    "field",
    "spellTrap",
    "hand",
    "graveyard",
    "deck",
    "extraDeck",
    "banished",
  ];

  for (const owner of owners) {
    if (owner.fieldSpell === card) return owner;
    for (const zone of zones) {
      const zoneCards = Reflect.get(owner, zone);
      if (Array.isArray(zoneCards) && zoneCards.includes(card)) {
        return owner;
      }
    }
  }

  const explicitOwner = owners.find(
    (owner) => owner.id === card.owner || owner.id === card.controller,
  );
  return explicitOwner || fallbackOwner || null;
}

async function emitEffectTargetedBeforeActions(
  engine: EffectEngine,
  ctx: PreviewContext,
  targets: ResolvedTargetMap,
  logDev: DevLogger | null,
): Promise<NeedsSelectionResult | null> {
  const game = engine?.game;
  const source = ctx?.source;
  const sourcePlayer = ctx?.player;
  if (!game || !source || !sourcePlayer || !targets) return null;
  if (ctx?.isPreview || ctx?.previewOnly) return null;
  let activationContext = ctx?.activationContext || null;
  if (!activationContext) {
    activationContext = {};
    ctx.activationContext = activationContext;
  }
  if (activationContext?.skipEffectTargetedEvent === true) return null;
  if (activationContext?._effectTargetedResolved === true) return null;

  const targetCards = getTargetCards(targets);
  if (targetCards.length === 0) return null;

  const emitted = new Set();
  activationContext._effectTargetedOpened = true;
  for (const target of targetCards) {
    if (!target) continue;
    const targetOwner = findOwnerForTarget(game, null, target);
    if (!targetOwner || targetOwner.id === sourcePlayer.id) continue;

    const key =
      target.instanceId ||
      `${targetOwner.id}:${target.id ?? target.name ?? "unknown"}`;
    if (emitted.has(key)) continue;
    emitted.add(key);

    logDev?.("EFFECT_TARGETED_BEFORE_ACTIONS", {
      source: source.name || null,
      target: target.name || null,
      targetOwner: targetOwner.id || null,
    });

    const result = await game.emit("effect_targeted", {
      source,
      sourceCard: source,
      sourcePlayer,
      player: sourcePlayer,
      target,
      targetOwner,
      targetId: target.id ?? null,
      effect: ctx?.effect || null,
      effectId: ctx?.effect?.id || activationContext?.effectId || null,
      actionContext:
        ctx?.actionContext || activationContext?.actionContext || null,
    });

    if (result?.needsSelection) {
      return {
        ...result,
        success: false,
        executed: false,
        selectionSource: "effect_targeted",
      };
    }
  }

  activationContext._effectTargetedResolved = true;
  return null;
}

/**
 * Main action dispatcher - applies all actions in sequence
 * @param {Array} actions - Array of action definitions
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {Promise<Object>} Normalized execution result or selection request
 */
export async function applyActions(
  this: EffectEngine,
  actions: readonly CardAction[],
  ctx: PreviewContext,
  targets: ResolvedTargetMap,
): Promise<NormalizedActionExecutionResult | NeedsSelectionResult> {
  let executed = false;
  let skippedCount = 0;
  if (!Array.isArray(actions)) {
    return createActionResult({ success: true, executed });
  }

  const logDev =
    this.game?.devLog &&
    ((tag: string, detail?: object) => this.game.devLog(tag, detail || {}));

  // Propagate selection results (from network resume) into ctx so handlers can consume them.
  const canonicalSelections = {
    ...mergeCanonicalSelections(ctx?.actionContext || undefined),
    ...mergeCanonicalSelections(ctx?.activationContext || undefined),
  };
  const selectionMap =
    ctx?.selections ||
    (Object.keys(canonicalSelections).length > 0 ? canonicalSelections : null);
  if (ctx && selectionMap && !ctx.selections) {
    ctx.selections = selectionMap;
  }
  const isTargetMap = (value: unknown): value is ResolvedTargetMap =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  let runtimeTargets = targets || {};
  if (ctx && isTargetMap(targets)) {
    const existingTargets = isTargetMap(ctx._actionTargets)
      ? ctx._actionTargets
      : {};
    runtimeTargets = { ...existingTargets, ...targets };
    ctx._actionTargets = runtimeTargets;
  } else if (ctx && isTargetMap(ctx._actionTargets)) {
    runtimeTargets = ctx._actionTargets;
  }

  try {
    for (const action of actions) {
      const actionInfo = {
        type: action?.type || "unknown",
        source: ctx?.source?.name || null,
        player: ctx?.player?.id || null,
      };

      // Filter targets by immunity before passing to handler
      // This implements the "skip_targets" default behavior (vs "skip_action")
      const immunityResult = this.filterTargetsByImmunity(
        action,
        ctx,
        runtimeTargets,
      );

      if (immunityResult.skipAction) {
        // immunityMode: "skip_action" was set and some targets were immune
        skippedCount += 1;
        logDev?.("ACTION_SKIPPED_IMMUNITY", {
          ...actionInfo,
          mode: "skip_action",
          skippedCount: immunityResult.skippedCount,
        });
        continue;
      }

      // Use filtered targets for the handler
      const filteredTargets = immunityResult.filteredTargets as ResolvedTargetMap;

      // Log if any targets were skipped
      if (immunityResult.skippedCount > 0) {
        logDev?.("ACTION_TARGETS_FILTERED", {
          ...actionInfo,
          skippedCount: immunityResult.skippedCount,
          allowedCount: immunityResult.allowedCount,
        });
      }

      logDev?.("ACTION_START", actionInfo);

      const handler = this.actionHandlers.get(action.type);
      if (!handler) {
        logDev?.("ACTION_HANDLER_MISSING", actionInfo);
        const reason = `No handler for action type "${action.type}".`;
        console.warn(reason);
        return createActionResult({
          success: false,
          executed,
          failedAction: action.type,
          reason,
          action,
          skippedCount,
        });
      }

      try {
        // Pass filtered targets to handler instead of original targets
        const result: LegacyActionHandlerResult = await Reflect.apply(
          handler,
          undefined,
          [action, ctx, filteredTargets, this],
        );

        // INVARIANTE B1: Se handler retornou needsSelection, propagar para cima
        if (result && typeof result === "object" && result.needsSelection) {
          logDev?.("ACTION_NEEDS_SELECTION", {
            ...actionInfo,
            selectionKind:
              result.selectionContract &&
              typeof result.selectionContract === "object" &&
              typeof Reflect.get(result.selectionContract, "kind") === "string"
                ? Reflect.get(result.selectionContract, "kind")
                : "unknown",
          });
          // Retornar imediatamente com o selectionContract
          return {
            ...result,
            success: result.success === true,
            executed,
          };
        }

        if (isActionResultFailure(result)) {
          const isOptional = isActionOptionalNoop(action);
          logDev?.("ACTION_HANDLER_FAILED", {
            ...actionInfo,
            optional: isOptional,
            reason:
              result && typeof result === "object" ? result.reason : null,
          });

          if (isOptional) {
            skippedCount += 1;
            continue;
          }

          return createActionResult({
            success: false,
            executed,
            failedAction: action.type,
            reason:
              (result && typeof result === "object" && result.reason) ||
              `Action "${action.type}" failed.`,
            action,
            skippedCount,
          });
        }

        executed = actionResultSucceeded(result) || executed;
        if (
          ctx &&
          isTargetMap(ctx._actionTargets) &&
          ctx._actionTargets !== runtimeTargets
        ) {
          runtimeTargets = { ...runtimeTargets, ...ctx._actionTargets };
          ctx._actionTargets = runtimeTargets;
        }
        logDev?.("ACTION_HANDLER_DONE", {
          ...actionInfo,
          handler: true,
          result: result === undefined ? "undefined" : !!result,
        });
      } catch (error) {
        logDev?.("ACTION_HANDLER_ERROR", {
          ...actionInfo,
          error: errorMessage(error, `Action "${action.type}" threw.`),
        });
        console.error(
          `Error executing registered handler for action type "${action.type}":`,
          error
        );
        console.error(`Action config:`, action);
        console.error(`Context:`, {
          player: ctx?.player?.id,
          source: ctx?.source?.name,
        });
        return createActionResult({
          success: false,
          executed,
          failedAction: action.type,
          reason: errorMessage(error, `Action "${action.type}" threw.`),
          error,
          action,
          skippedCount,
        });
      }
    }
  } catch (err) {
    console.error("Error while applying actions:", err);
    return createActionResult({
      success: false,
      executed,
      reason: errorMessage(err, "Error while applying actions."),
      error: err,
      skippedCount,
    });
  }

  return createActionResult({ success: true, executed, skippedCount });
}

function getContextPathValue(
  ctx: PreviewContext | null | undefined,
  path: string | null | undefined,
): unknown {
  if (!ctx || typeof path !== "string" || !path) return undefined;
  if (!path.includes(".")) return readContextValue(ctx, path);
  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>(
      (value, key) =>
        value === null || value === undefined || typeof value !== "object"
          ? undefined
          : Reflect.get(value, key),
      ctx,
    );
}

function resolveNumberFromContext(
  ref:
    | string
    | number
    | LegacyNumberReference
    | null
    | undefined,
  ctx: PreviewContext,
): number | null {
  if (ref === undefined || ref === null) return null;
  if (Number.isFinite(Number(ref))) return Number(ref);
  const key =
    typeof ref === "string"
      ? ref
      : typeof ref === "object"
        ? ref.key || ref.contextKey || ref.path || ref.resultKey || null
        : null;
  const fallback =
    typeof ref === "object" && ref !== null
      ? ref.defaultValue ?? ref.default ?? ref.fallback
      : undefined;
  const rawValue = getContextPathValue(ctx, key);
  const value = rawValue === undefined ? fallback : rawValue;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : null;
}

function applyContextMaxLevelFilter(
  filters: PreviewFilter,
  action: PreviewAction,
  ctx: PreviewContext,
): void {
  const maxLevel = resolveNumberFromContext(action?.maxLevelFromContext, ctx);
  if (maxLevel === null || !Number.isFinite(maxLevel)) return;
  filters.maxLevel = Number.isFinite(filters.maxLevel)
    ? Math.min(filters.maxLevel ?? maxLevel, maxLevel)
    : maxLevel;
}

function getFieldCounterContextKey(
  action: PreviewAction,
  counterType: string,
): string {
  return (
    action?.contextKey ||
    action?.storeAs ||
    action?.resultKey ||
    `field${counterType.charAt(0).toUpperCase()}${counterType.slice(1)}CounterCount`
  );
}

function writePreviewFieldCounterCount(
  engine: EffectEngine,
  action: PreviewAction,
  ctx: PreviewContext,
  player: ActionRuntimePlayer,
): void {
  if (!ctx || typeof ctx !== "object") return;
  const counterType = action?.counterType || "default";
  const total = countPreviewFieldCounters(engine, action, ctx, player);
  const contextKey = getFieldCounterContextKey(action, counterType);
  if (contextKey) writeContextValue(ctx, contextKey, total);
  ctx.lastFieldCounterCount = total;
  ctx.fieldCounterCounts = {
    ...(ctx.fieldCounterCounts || {}),
    [counterType]: total,
  };
}

function buildPreviewFilters(
  action: PreviewAction,
  ctx: PreviewContext = {},
): PreviewFilter {
  const filters = { ...(action?.filters || {}) };
  if (action?.archetype && !filters.archetype) {
    filters.archetype = action.archetype;
  }
  if (action?.cardKind && !filters.cardKind) {
    filters.cardKind = action.cardKind;
  }
  if (action?.cardName && !filters.name) {
    filters.name = action.cardName;
  }
  if (action?.monsterType && !filters.type) {
    filters.type = action.monsterType;
  }
  if (action?.isTuner !== undefined && filters.isTuner === undefined) {
    filters.isTuner = action.isTuner;
  }
  if (Number.isFinite(action?.level) && filters.level == null) {
    filters.level = action.level;
  }
  if (action?.levelOp && !filters.levelOp) {
    filters.levelOp = action.levelOp;
  }
  if (Number.isFinite(action?.minLevel) && filters.minLevel == null) {
    filters.minLevel = action.minLevel;
  }
  if (Number.isFinite(action?.maxLevel) && filters.maxLevel == null) {
    filters.maxLevel = action.maxLevel;
  }
  applyContextMaxLevelFilter(filters, action, ctx);
  if (Number.isFinite(action?.minAtk) && filters.minAtk == null) {
    filters.minAtk = action.minAtk;
  }
  if (Number.isFinite(action?.maxAtk) && filters.maxAtk == null) {
    filters.maxAtk = action.maxAtk;
  }
  return filters;
}

function buildTargetPreviewFilters(
  target: PreviewTarget | LegacyPairedTarget,
): PreviewFilter {
  const targetFilters = Reflect.get(target, "filters");
  const filters: PreviewFilter =
    targetFilters && typeof targetFilters === "object"
      ? { ...targetFilters }
      : {};
  const copyIfPresent = (
    sourceKey: string,
    filterKey: keyof PreviewFilter = sourceKey as keyof PreviewFilter,
  ): void => {
    const sourceValue = Reflect.get(target, sourceKey);
    if (sourceValue !== undefined && filters[filterKey] === undefined) {
      Reflect.set(filters, filterKey, sourceValue);
    }
  };

  copyIfPresent("cardKind");
  copyIfPresent("type");
  copyIfPresent("archetype");
  copyIfPresent("name");
  copyIfPresent("cardName", "name");
  copyIfPresent("cardId");
  copyIfPresent("cardIds");
  copyIfPresent("subtype");
  copyIfPresent("monsterType");
  copyIfPresent("level");
  copyIfPresent("levelOp");
  copyIfPresent("minLevel");
  copyIfPresent("maxLevel");
  copyIfPresent("minAtk");
  copyIfPresent("maxAtk");
  copyIfPresent("minDef");
  copyIfPresent("maxDef");
  copyIfPresent("requireFaceup");
  copyIfPresent("isToken");
  copyIfPresent("isTuner");
  copyIfPresent("lastSummonMethods");
  copyIfPresent("summonMethods");
  copyIfPresent("lastSummonMethod");
  copyIfPresent("summonMethod");
  copyIfPresent("lastSummonedFromZone");
  copyIfPresent("lastSummonedFromZones");
  copyIfPresent("excludeCardName");
  copyIfPresent("excludeCardNames");
  copyIfPresent("excludeName");
  copyIfPresent("excludeNames");
  copyIfPresent("excludeId");
  copyIfPresent("excludeIds");
  copyIfPresent("excludeCardId");
  copyIfPresent("excludeCardIds");
  copyIfPresent("position");
  copyIfPresent("facedown");
  copyIfPresent("excludeSelf");
  copyIfPresent("excludeCannotBeSpecialSummoned");

  return filters;
}

function matchesPreviewFilters(
  engine: EffectEngine,
  card: PreviewCard | null | undefined,
  filters: PreviewFilter,
  ctx: PreviewContext = {},
): boolean {
  if (!card) return false;
  if (filters.excludeCannotBeSpecialSummoned) {
    const summonProcedure =
      filters.summonProcedure || filters.specialSummonProcedure || "special";
    const eligibility = checkSpecialSummonEligibility(card, {
      summonProcedure,
      fromZone: filters.zone || null,
    });
    if (eligibility.ok === false) {
      return false;
    }
    const destinationPlayer =
      filters.summonToOwner === "opponent" ||
      filters.destinationOwner === "opponent"
        ? ctx?.opponent
        : ctx?.player;
    const restrictionCheck =
      engine?.game?.canSpecialSummonUnderRestrictions?.(
        card,
        destinationPlayer,
        {
          summonMethod: filters.summonMethod || "special",
          summonProcedure,
          fromZone: filters.zone || null,
          silent: true,
        },
      );
    if (restrictionCheck?.ok === false) return false;
  }
  if (typeof engine?.cardMatchesFilters === "function") {
    if (!engine.cardMatchesFilters(card, filters)) return false;
  }
  if (filters.excludeSelf && ctx?.source && card === ctx.source) {
    return false;
  }
  if (filters.cardKind && !cardMatchesKind(card, filters.cardKind)) {
    return false;
  }
  if (filters.cardId !== undefined && card.id !== filters.cardId) {
    return false;
  }
  if (
    Array.isArray(filters.cardIds) &&
    filters.cardIds.length > 0 &&
    !filters.cardIds.includes(card.id)
  ) {
    return false;
  }
  if (filters.type) {
    const types = Array.isArray(card.types) ? card.types : [card.type];
    const required = Array.isArray(filters.type) ? filters.type : [filters.type];
    if (!required.some((type) => types.includes(type))) return false;
  }
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  if ((filters.name || filters.cardName) && card.name !== (filters.name || filters.cardName)) {
    return false;
  }
  if (filters.requireFaceup === true && card.isFacedown) {
    return false;
  }
  if (filters.isTuner !== undefined) {
    if ((card.isTuner === true) !== Boolean(filters.isTuner)) return false;
  }
  if (filters.facedown === true && card.isFacedown !== true) {
    return false;
  }
  if (
    filters.position &&
    filters.position !== "any" &&
    card.position !== filters.position
  ) {
    return false;
  }
  if (Number.isFinite(filters.level)) {
    const cardLevel = Number(card.level || 0);
    const requiredLevel = filters.level ?? 0;
    const levelOp = filters.levelOp || "eq";
    if (levelOp === "eq" && cardLevel !== requiredLevel) return false;
    if (levelOp === "lte" && cardLevel > requiredLevel) return false;
    if (levelOp === "gte" && cardLevel < requiredLevel) return false;
    if (levelOp === "lt" && cardLevel >= requiredLevel) return false;
    if (levelOp === "gt" && cardLevel <= requiredLevel) return false;
  }
  if (
    typeof filters.minLevel === "number" &&
    (card.level || 0) < filters.minLevel
  ) {
    return false;
  }
  if (
    typeof filters.maxLevel === "number" &&
    (card.level || 0) > filters.maxLevel
  ) {
    return false;
  }
  return true;
}

function getPreviewTargetOwners(
  target: PreviewTarget,
  ctx: PreviewContext,
  player: ActionRuntimePlayer,
): ActionRuntimePlayer[] {
  const ownerRule = target?.owner || target?.player || "self";
  const opponent = ctx?.opponent;
  if (ownerRule === "opponent") return opponent ? [opponent] : [];
  if (ownerRule === "both" || ownerRule === "any") {
    return [player, opponent].filter(isRuntimePlayer);
  }
  return player ? [player] : [];
}

function getPreviewCounterOwners(
  action: Pick<PreviewAction, "owner" | "player">,
  ctx: PreviewContext,
  player: ActionRuntimePlayer,
): ActionRuntimePlayer[] {
  const ownerRule = action?.owner || action?.player || "self";
  const opponent = ctx?.opponent;
  if (ownerRule === "opponent") {
    return opponent ? [opponent] : [];
  }
  if (ownerRule === "any" || ownerRule === "both" || ownerRule === "either") {
    return [player, opponent].filter(isRuntimePlayer);
  }
  return player ? [player] : [];
}

function getPreviewZoneCards(
  owner: ActionRuntimePlayer | null | undefined,
  zone: PreviewZone,
): PreviewCard[] {
  if (!owner || !zone) return [];
  if (zone === "fieldSpell") {
    return owner.fieldSpell ? [owner.fieldSpell] : [];
  }
  const cards = owner[zone];
  return Array.isArray(cards) ? cards.filter(Boolean) : [];
}

function getPreviewTargetZones(
  target: PreviewTarget,
  fallbackZone: PreviewZone = "field",
): readonly PreviewZone[] {
  const zoneSpec = target?.zones ?? target?.zone ?? fallbackZone;
  return (Array.isArray(zoneSpec) ? zoneSpec : [zoneSpec]).filter(Boolean);
}

function getPreviewTargetMinCount(target: PreviewTarget, fallback = 1): number {
  const raw = target?.count?.min ?? target?.min ?? fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, value) : Math.max(0, fallback);
}

function getPreviewTargetMaxCount(
  target: PreviewTarget,
  fallback: number | null = null,
): number | null {
  const raw = target?.count?.max ?? target?.max ?? fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function getEffectTargetDefinition(
  ctx: PreviewContext,
  targetRef: string,
): PreviewTarget | null {
  if (!targetRef) return null;
  const targetDefs = Array.isArray(ctx?.effect?.targets)
    ? ctx.effect.targets
    : [];
  return (
    (targetDefs.find((target) => target?.id === targetRef) as
      | PreviewTarget
      | undefined) || null
  );
}

function shouldExcludePreviewTargetCard(
  card: PreviewCard,
  target: PreviewTarget,
  ctx: PreviewContext,
  zone: PreviewZone,
): boolean {
  if (!card || card !== ctx?.source) return false;
  if (target?.includeSelf === true || target?.allowSelf === true) return false;
  if (target?.excludeSelf === true) return true;

  const sourceKind = ctx?.source?.cardKind;
  return (
    zone === "hand" &&
    ctx?.activationZone === "hand" &&
    (sourceKind === "spell" || sourceKind === "trap")
  );
}

function normalizePreviewList<Value>(
  value: Value | readonly Value[] | null | undefined,
  fallback: readonly Value[] = [],
): readonly Value[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === undefined || value === null) return fallback;
  return [value as Value];
}

function getPairedPreviewTargetSpec(
  target: PreviewTarget,
): LegacyPairedTarget | null {
  return target.pairedTarget || target.requiresPairedTarget || null;
}

function comparePairedPreviewValues(
  left: unknown,
  op: string = "eq",
  right: unknown,
): boolean {
  if (op === "eq" || op === "==" || op === "===") return left === right;
  if (op === "neq" || op === "!=" || op === "!==") return left !== right;

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return false;
  }
  if (op === "lte" || op === "<=") return leftNumber <= rightNumber;
  if (op === "lt" || op === "<") return leftNumber < rightNumber;
  if (op === "gte" || op === ">=") return leftNumber >= rightNumber;
  if (op === "gt" || op === ">") return leftNumber > rightNumber;
  return false;
}

function pairedPreviewComparisonsPass(
  sourceCard: PreviewCard,
  pairedCard: PreviewCard,
  pairSpec: LegacyPairedTarget,
): boolean {
  const comparisons = [
    ...normalizePreviewList(pairSpec.compareAttribute),
    ...normalizePreviewList(pairSpec.compareAttributes),
  ];
  if (comparisons.length === 0) return true;

  return comparisons.every((comparison) => {
    const attr = comparison.attr || comparison.attribute;
    const pairedAttr = comparison.pairedAttr || comparison.targetAttr || attr;
    const sourceAttr = comparison.sourceAttr || comparison.refAttr || attr;
    if (!pairedAttr || !sourceAttr) return false;
    return comparePairedPreviewValues(
      getCardComparableAttribute(pairedCard, pairedAttr),
      comparison.op || "eq",
      getCardComparableAttribute(sourceCard, sourceAttr),
    );
  });
}

function previewTargetHasPairedCandidate(
  engine: EffectEngine,
  sourceCard: PreviewCard,
  pairSpec: LegacyPairedTarget | null,
  ctx: PreviewContext,
  player: ActionRuntimePlayer,
): boolean {
  if (!pairSpec) return true;
  const zones = normalizePreviewList(pairSpec.zones ?? pairSpec.zone, ["field"]);
  const filters = buildTargetPreviewFilters(pairSpec);
  for (const owner of getPreviewTargetOwners(pairSpec as PreviewTarget, ctx, player)) {
    for (const zone of zones) {
      for (const pairedCard of getPreviewZoneCards(owner, zone as PreviewZone)) {
        if (!pairedCard) continue;
        if (
          pairSpec.excludeSameCard !== false &&
          pairedCard === sourceCard
        ) {
          continue;
        }
        if (
          pairSpec.excludeSameName === true &&
          pairedCard.name === sourceCard?.name
        ) {
          continue;
        }
        if (!matchesPreviewFilters(engine, pairedCard, filters, ctx)) continue;
        if (!pairedPreviewComparisonsPass(sourceCard, pairedCard, pairSpec)) {
          continue;
        }
        return true;
      }
    }
  }
  return false;
}

function previewTargetCandidateMatches(
  engine: EffectEngine,
  card: PreviewCard,
  target: PreviewTarget,
  ctx: PreviewContext,
  player: ActionRuntimePlayer,
): boolean {
  if (!card) return false;
  const pairSpec = getPairedPreviewTargetSpec(target);
  return previewTargetHasPairedCandidate(engine, card, pairSpec, ctx, player);
}

interface PreviewTargetEntry {
  readonly owner: ActionRuntimePlayer;
  readonly zone: PreviewZone;
  readonly card: PreviewCard;
}

function collectPreviewTargetEntries(
  engine: EffectEngine,
  target: PreviewTarget,
  ctx: PreviewContext,
  player: ActionRuntimePlayer,
): PreviewTargetEntry[] {
  const owners = getPreviewTargetOwners(target, ctx, player);
  const zones = getPreviewTargetZones(target);
  const filters = buildTargetPreviewFilters(target);
  const entries: PreviewTargetEntry[] = [];
  const seen = new Set<PreviewCard>();

  for (const owner of owners) {
    for (const zone of zones) {
      for (const card of getPreviewZoneCards(owner, zone)) {
        if (!card || seen.has(card)) continue;
        if (shouldExcludePreviewTargetCard(card, target, ctx, zone)) continue;
        if (!matchesPreviewFilters(engine, card, filters, ctx)) continue;
        if (!previewTargetCandidateMatches(engine, card, target, ctx, player)) {
          continue;
        }
        seen.add(card);
        entries.push({ owner, zone, card });
      }
    }
  }

  return entries;
}

function getPreviewMoveDestinationOwner(
  action: PreviewAction,
  ctx: PreviewContext,
  sourceOwner: ActionRuntimePlayer,
  player: ActionRuntimePlayer,
): ActionRuntimePlayer | null {
  if (action?.player === "self") return player || ctx?.player || sourceOwner;
  if (action?.player === "opponent") return ctx?.opponent || sourceOwner;
  return sourceOwner || player || ctx?.player || null;
}

function recordPreviewMoveCandidates(
  engine: EffectEngine,
  action: PreviewAction,
  ctx: PreviewContext,
  player: ActionRuntimePlayer,
  previewMoves: PreviewMove[],
): void {
  if (action?.type !== "move" || !Array.isArray(previewMoves)) return;
  const toZone = action.to || action.toZone;
  if (!toZone || !action.targetRef) return;

  const targetDef = getEffectTargetDefinition(ctx, action.targetRef);
  if (!targetDef) return;

  const sourceEntries = collectPreviewTargetEntries(
    engine,
    targetDef,
    ctx,
    player,
  );
  if (sourceEntries.length === 0) return;

  const maxCount = getPreviewTargetMaxCount(targetDef, sourceEntries.length);
  if (maxCount !== null && maxCount <= 0) return;

  for (const entry of sourceEntries) {
    const owner = getPreviewMoveDestinationOwner(
      action,
      ctx,
      entry.owner,
      player,
    );
    if (!owner) continue;
    let group = previewMoves.find(
      (candidate) => candidate.owner === owner && candidate.zone === toZone,
    );
    if (!group) {
      group = {
        owner,
        zone: toZone,
        cards: [],
        maxCount,
      };
      previewMoves.push(group);
    }
    group.cards.push(entry.card);
  }
}

function countPreviewTargetCandidates(
  engine: EffectEngine,
  target: PreviewTarget,
  ctx: PreviewContext,
  player: ActionRuntimePlayer,
  previewMoves: readonly PreviewMove[] = [],
): number {
  const owners = getPreviewTargetOwners(target, ctx, player);
  const zones = getPreviewTargetZones(target);
  const filters = buildTargetPreviewFilters(target);
  const seen = new Set<PreviewCard>();
  let count = 0;

  for (const owner of owners) {
    for (const zone of zones) {
      for (const card of getPreviewZoneCards(owner, zone)) {
        if (!card || seen.has(card)) continue;
        if (shouldExcludePreviewTargetCard(card, target, ctx, zone)) continue;
        if (!matchesPreviewFilters(engine, card, filters, ctx)) continue;
        if (!previewTargetCandidateMatches(engine, card, target, ctx, player)) {
          continue;
        }
        seen.add(card);
        count += 1;
      }

      for (const group of previewMoves) {
        if (group.owner !== owner || group.zone !== zone) continue;
        const matchingMovedCards = [];
        for (const card of group.cards || []) {
          if (!card || seen.has(card)) continue;
          if (!matchesPreviewFilters(engine, card, filters, ctx)) continue;
          if (!previewTargetCandidateMatches(engine, card, target, ctx, player)) {
            continue;
          }
          matchingMovedCards.push(card);
        }
        const allowedCount =
          group.maxCount === null
            ? matchingMovedCards.length
            : Math.min(group.maxCount, matchingMovedCards.length);
        for (let i = 0; i < allowedCount; i += 1) {
          seen.add(matchingMovedCards[i]);
          count += 1;
        }
      }
    }
  }

  return count;
}

function checkPreviewMoveTargetAvailability(
  engine: EffectEngine,
  action: PreviewAction,
  ctx: PreviewContext,
  player: ActionRuntimePlayer,
  previewMoves: readonly PreviewMove[],
): PreviewResult {
  if (action?.type !== "move") return { ok: true };
  const toZone = action.to || action.toZone;
  if (toZone === "field") {
    const destinationPlayer =
      action.player === "opponent" ? ctx?.opponent : ctx?.player || player;
    if ((destinationPlayer?.field || []).length >= 5) {
      return { ok: false, reason: "Field is full." };
    }
  }
  if (!action.targetRef) return { ok: true };
  const targetDef = getEffectTargetDefinition(ctx, action.targetRef);
  if (!targetDef) return { ok: true };

  const min = getPreviewTargetMinCount(targetDef, 1);
  if (min <= 0) return { ok: true };

  const available = countPreviewTargetCandidates(
    engine,
    targetDef,
    ctx,
    player,
    previewMoves,
  );
  if (available >= min) return { ok: true };

  const zones = getPreviewTargetZones(targetDef).join("/") || "zone";
  return {
    ok: false,
    reason: `Need ${min} valid target(s) in ${zones} for this move action.`,
  };
}

function checkRequiredOptionalTargetsPreview(
  engine: EffectEngine,
  action: PreviewAction,
  ctx: PreviewContext,
  player: ActionRuntimePlayer,
  previewMoves: readonly PreviewMove[],
): PreviewResult {
  if (action?.optional === true) return { ok: true };
  const mustResolve =
    action?.allowCancel === false || action?.required === true;
  if (!mustResolve) return { ok: true };

  const targetDefs = Array.isArray(action?.targets) ? action.targets : [];
  for (const target of targetDefs) {
    const min = getPreviewTargetMinCount(target, 1);
    if (min <= 0) continue;

    const available = countPreviewTargetCandidates(
      engine,
      target,
      ctx,
      player,
      previewMoves,
    );
    if (available < min) {
      const zones = getPreviewTargetZones(target).join("/") || "zone";
      return {
        ok: false,
        reason: `Need ${min} valid target(s) in ${zones} for the required follow-up effect.`,
      };
    }
  }

  return { ok: true };
}

function matchesCounterPreviewFilters(
  engine: EffectEngine,
  card: PreviewCard | null | undefined,
  filters: PreviewFilter = {},
): boolean {
  if (!card) return false;
  if (filters.requireFaceup === true && card.isFacedown) return false;
  if (filters.cardKind && !cardMatchesKind(card, filters.cardKind)) {
    return false;
  }
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  if (filters.type) {
    const types = Array.isArray(card.types) ? card.types : [card.type];
    if (!types.includes(filters.type as string | null | undefined)) return false;
  }
  if (filters.attribute && card.attribute !== filters.attribute) return false;
  if (filters.name && card.name !== filters.name) return false;
  if (filters.cardName && card.name !== filters.cardName) return false;
  if (filters.subtype) {
    const allowed = Array.isArray(filters.subtype)
      ? filters.subtype
      : [filters.subtype];
    if (!allowed.includes(card.subtype)) return false;
  }
  if (
    Object.keys(filters).length > 0 &&
    typeof engine?.cardMatchesFilters === "function" &&
    !engine.cardMatchesFilters(card, filters)
  ) {
    return false;
  }
  return true;
}

function countPreviewFieldCounters(
  engine: EffectEngine,
  action: PreviewAction,
  ctx: PreviewContext,
  player: ActionRuntimePlayer,
): number {
  const counterType = action?.counterType || "default";
  const zones = Array.isArray(action?.zones)
    ? action.zones
    : [action?.zone || "field"];
  const filters = { ...(action?.filters || {}) };
  if (action?.requireFaceup === true && filters.requireFaceup == null) {
    filters.requireFaceup = true;
  }

  let total = 0;
  for (const owner of getPreviewCounterOwners(action, ctx, player)) {
    for (const zone of zones) {
      for (const card of getPreviewZoneCards(owner, zone)) {
        if (!matchesCounterPreviewFilters(engine, card, filters)) continue;
        total +=
          typeof card.getCounter === "function"
            ? Math.max(0, Number(card.getCounter(counterType) || 0))
            : 0;
      }
    }
  }
  return total;
}

function countPreviewFieldCardsForSpec(
  engine: EffectEngine,
  spec: FieldCountSpec,
  ctx: PreviewContext,
  player: ActionRuntimePlayer,
): number {
  const zones = Array.isArray(spec?.zones)
    ? spec.zones
    : [spec?.zone || "field"];
  const filters = { ...(spec?.filters || {}) };
  const actionLike = {
    owner: spec?.owner,
    player: spec?.player,
  };

  let count = 0;
  for (const owner of getPreviewCounterOwners(actionLike, ctx, player)) {
    for (const zone of zones) {
      for (const card of getPreviewZoneCards(owner, zone)) {
        if (!matchesPreviewFilters(engine, card, filters, ctx)) continue;
        count += 1;
      }
    }
  }
  return count;
}

function resolvePreviewAddCounterAmount(
  engine: EffectEngine,
  action: PreviewAction,
  ctx: PreviewContext,
  player: ActionRuntimePlayer,
): number {
  if (action?.amountFromFieldCount) {
    const spec = action.amountFromFieldCount;
    const count = countPreviewFieldCardsForSpec(engine, spec, ctx, player);
    const multiplier = Number.isFinite(Number(spec.multiplier))
      ? Number(spec.multiplier)
      : 1;
    const baseAmount = Number.isFinite(Number(spec.baseAmount ?? spec.base))
      ? Number(spec.baseAmount ?? spec.base)
      : 0;
    let amount = baseAmount + count * multiplier;
    if (Number.isFinite(Number(spec.min))) {
      amount = Math.max(Number(spec.min), amount);
    }
    if (Number.isFinite(Number(spec.max))) {
      amount = Math.min(Number(spec.max), amount);
    }
    return Math.max(0, Math.floor(amount));
  }

  if (action?.damagePerCounter && ctx?.damageAmount !== undefined) {
    return ctx.damageAmount >= action.damagePerCounter ? 1 : 0;
  }

  return Math.max(0, Math.floor(Number(action?.amount || 1)));
}

function countPreviewOpponentDestroyTargets(
  engine: EffectEngine,
  action: PreviewAction,
  ctx: PreviewContext,
): number | null {
  if (action?.targetCountFromContext) return null;

  const opponent = ctx?.opponent;
  if (!opponent) return 0;

  const zones = Array.isArray(action.zones)
    ? action.zones
    : ["field", "spellTrap", "fieldSpell"];
  const filters = { ...(action.filters || {}) };
  if (action.requireFaceup === true && filters.requireFaceup == null) {
    filters.requireFaceup = true;
  }
  const allowedKinds = action.cardKind
    ? Array.isArray(action.cardKind)
      ? action.cardKind
      : [action.cardKind]
    : null;
  const allowedSubtypes = action.subtype
    ? Array.isArray(action.subtype)
      ? action.subtype
      : [action.subtype]
    : null;
  let count = 0;

  for (const zone of zones) {
    for (const card of getPreviewZoneCards(opponent, zone)) {
      if (!card) continue;
      if (allowedKinds && !allowedKinds.includes(card.cardKind)) continue;
      if (allowedSubtypes && !allowedSubtypes.includes(card.subtype)) continue;
      if (action.position && action.position !== "any" && card.position !== action.position) {
        continue;
      }
      if (!matchesPreviewFilters(engine, card, filters)) continue;
      count += 1;
    }
  }

  return count;
}

function getSourceOwnersForPreview(
  action: PreviewAction,
  ctx: PreviewContext,
  player: ActionRuntimePlayer,
): ActionRuntimePlayer[] {
  const scope = action?.sourceOwner || action?.sourceScope || action?.scope || "self";
  const opponent = ctx?.opponent;
  if (scope === "opponent") {
    return opponent ? [opponent] : [];
  }
  if (scope === "both" || scope === "any") {
    return [player, opponent].filter(isRuntimePlayer);
  }
  return player ? [player] : [];
}

function countDistinctPreviewNames(cards: readonly PreviewCard[] = []): number {
  const names = new Set<string>();
  for (const card of cards) {
    names.add(card?.name || `id:${card?.id ?? "unknown"}`);
  }
  return names.size;
}

function getPreviewCardInstanceId(
  card: PreviewCard | null | undefined,
): number | string | null {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? card?.simInstanceId ?? null;
}

function hasAscensionMaterialPreviewCandidate(
  action: PreviewAction,
  ctx: PreviewContext,
  zoneCards: readonly PreviewCard[] = [],
): boolean | null {
  if (action?.targetRef !== "ascension_material") return null;
  const source = ctx?.source as PreviewCard | null | undefined;
  const materials = Array.isArray(source?.ascensionMaterials)
    ? source.ascensionMaterials
    : [];
  const materialInstanceIds = new Set<number | string>(
    materials
      .map((entry) => entry?.instanceId)
      .filter((value) => value !== undefined && value !== null),
  );
  if (materialInstanceIds.size === 0) return false;
  return zoneCards.some((card) => {
    const instanceId = getPreviewCardInstanceId(card);
    return instanceId !== null && materialInstanceIds.has(instanceId);
  });
}

function hasSpecialSummonCandidate(
  engine: EffectEngine,
  action: PreviewAction,
  ctx: PreviewContext,
): boolean {
  const player = ctx?.player;
  if (!player) return false;
  const source = ctx.source as PreviewCard | null | undefined;
  const destinationPlayer =
    action.summonToOwner === "opponent" ? ctx?.opponent : player;

  const zoneSpec = action.zone || action.sourceZone || "deck";
  const zoneNames = Array.isArray(zoneSpec) ? zoneSpec : [zoneSpec];
  const sourceOwners = getSourceOwnersForPreview(action, ctx, player);
  const zoneCards = sourceOwners.flatMap((owner) =>
    zoneNames.flatMap((zoneName) => getPreviewZoneCards(owner, zoneName)),
  );
  if (zoneCards.length === 0) return false;

  if (action.requireSource) {
    return source ? zoneCards.includes(source) : false;
  }
  const ascensionMaterialPreview = hasAscensionMaterialPreviewCandidate(
    action,
    ctx,
    zoneCards,
  );
  if (ascensionMaterialPreview !== null) return ascensionMaterialPreview;
  if (action.targetRef) return true;

  const filters = buildPreviewFilters(action, ctx);
  if (action.matchLevelRef) {
    const levelCard = readContextValue(ctx, action.matchLevelRef);
    const levelValue = Number(
      levelCard && typeof levelCard === "object"
        ? Reflect.get(levelCard, "level")
        : undefined,
    );
    if (!Number.isFinite(levelValue) || levelValue <= 0) return false;
    filters.level = levelValue;
    filters.levelOp = filters.levelOp || action.levelOp || "eq";
  }

  const candidates = zoneCards.filter((card) => {
    if (!card || card.cardKind !== "monster") return false;
    if (card.cannotBeSpecialSummoned) return false;
    const restrictionCheck = engine?.game?.canSpecialSummonUnderRestrictions?.(
      card,
      destinationPlayer,
      {
        summonMethod: "special",
        fromZone: Array.isArray(zoneSpec) ? null : zoneSpec,
        silent: true,
      },
    );
    if (restrictionCheck?.ok === false) return false;
    return matchesPreviewFilters(engine, card, filters);
  });
  const min = Number(
    typeof action.count === "object" ? action.count.min ?? 1 : 1,
  );
  const requiredCount = Number.isFinite(min) && min > 0 ? min : 1;
  const availableCount =
    action.distinctNames === true
      ? countDistinctPreviewNames(candidates)
      : candidates.length;

  return availableCount >= requiredCount;
}

function getGraveyardOwnersForActionScope(
  action: PreviewAction,
  ctx: PreviewContext,
): ActionRuntimePlayer[] {
  const player = ctx?.player;
  const opponent = ctx?.opponent;
  const scope = action?.scope || "self";
  if (scope === "both") {
    return [player, opponent].filter(isRuntimePlayer);
  }
  if (scope === "opponent") {
    return opponent ? [opponent] : [];
  }
  return player ? [player] : [];
}

function isChoiceCaseAllowedInPreview(
  engine: EffectEngine,
  caseEntry: ActionCase,
  ctx: PreviewContext,
): boolean {
  const conditions = Array.isArray(caseEntry?.conditions)
    ? caseEntry.conditions
    : [];
  if (conditions.length > 0) {
    const conditionResult = engine?.evaluateConditions?.(conditions, ctx);
    if (
      !conditionResult ||
      typeof conditionResult !== "object" ||
      Reflect.get(conditionResult, "ok") !== true
    ) {
      return false;
    }
  }

  const targets = Array.isArray(caseEntry?.targets) ? caseEntry.targets : [];
  if (targets.length > 0) {
    const targetResult =
      typeof engine?.resolveTargets === "function"
        ? Reflect.apply(engine.resolveTargets, engine, [targets, ctx, null])
        : null;
    if (
      targetResult &&
      typeof targetResult === "object" &&
      Reflect.get(targetResult, "ok") === false
    ) {
      return false;
    }
  }

  const caseActions = Array.isArray(caseEntry?.actions)
    ? caseEntry.actions
    : [];
  if (caseActions.length === 0) return false;

  const actionResult =
    typeof engine?.checkActionPreviewRequirements === "function"
      ? engine.checkActionPreviewRequirements(caseActions, ctx)
      : checkActionPreviewRequirements.call(engine, caseActions, ctx);
  return actionResult?.ok !== false;
}

/**
 * Check action preview requirements without executing
 * @param {Array} actions - Array of action definitions
 * @param {Object} ctx - Context object
 * @returns {Object} Result with ok status and optional reason
 */
export function checkActionPreviewRequirements(
  this: EffectEngine,
  actions: readonly CardAction[],
  ctx: PreviewContext,
): PreviewResult {
  if (!Array.isArray(actions) || actions.length === 0) {
    return { ok: true };
  }

  const player = ctx?.player;
  if (!player) {
    return { ok: false, reason: "Missing player." };
  }
  const previewCtx = {
    ...(ctx || {}),
    fieldCounterCounts: { ...(ctx?.fieldCounterCounts || {}) },
  };

  const hasOtherActions = (action: CardAction): boolean =>
    actions.some((candidate) => candidate && candidate !== action);
  const previewMoves: PreviewMove[] = [];

  for (const action of actions) {
    if (!action || !action.type) continue;
    if (action.type === "count_field_counters") {
      writePreviewFieldCounterCount(this, action, previewCtx, player);
      continue;
    }

    if (action.type === "choose_action_case") {
      const cases: readonly ActionCase[] = Array.isArray(action.cases)
        ? action.cases
        : [];
      const hasAllowedCase = cases.some((caseEntry) =>
        isChoiceCaseAllowedInPreview(this, caseEntry, ctx),
      );
      if (!hasAllowedCase) {
        return { ok: false, reason: "No valid options to activate this effect." };
      }
      continue;
    }

    if (action.type === "optional_target_actions") {
      const optionalTargetCheck = checkRequiredOptionalTargetsPreview(
        this,
        action,
        ctx,
        player,
        previewMoves,
      );
      if (!optionalTargetCheck.ok) {
        return optionalTargetCheck;
      }
    }

    if (action.type === "move") {
      const moveTargetCheck = checkPreviewMoveTargetAvailability(
        this,
        action,
        ctx,
        player,
        previewMoves,
      );
      if (!moveTargetCheck.ok) {
        return moveTargetCheck;
      }
    }

    if (action.type === "pay_lp") {
      let amount = Number(action.amount || 0);
      if (action.fraction) {
        amount = Math.floor((player.lp || 0) * action.fraction);
      }
      if (amount <= 0) {
        return { ok: false, reason: "LP cost must be greater than 0." };
      }
      if (amount > 0 && typeof this?.resolveLpCost === "function") {
        const costResult = this.resolveLpCost(action, ctx, amount, {
          consume: false,
        });
        if (costResult && typeof costResult.finalAmount === "number") {
          amount = costResult.finalAmount;
        }
      }
      if (amount > 0 && (player.lp || 0) < amount) {
        return { ok: false, reason: "Not enough LP to pay cost." };
      }
    }

    if (action.type === "banish_all_graveyard_and_burn") {
      const owners = getGraveyardOwnersForActionScope(action, ctx);
      const hasCards = owners.some(
        (owner) => Array.isArray(owner?.graveyard) && owner.graveyard.length > 0,
      );
      if (!hasCards) {
        return {
          ok: false,
          reason: "No cards in the selected Graveyard scope to banish.",
        };
      }
    }

    if (action.type === "remove_counters_from_field") {
      const hasRange =
        action.maxAmount !== undefined ||
        action.minAmount !== undefined ||
        action.variableAmount === true;
      const requestedAmount = hasRange
        ? Number(action.minAmount ?? 1)
        : Number(action.amount ?? action.count ?? 1);
      const amount = Number.isFinite(requestedAmount)
        ? Math.max(1, requestedAmount)
        : 1;
      const availableCounters = countPreviewFieldCounters(
        this,
        action,
        ctx,
        player,
      );
      if (availableCounters < amount) {
        return {
          ok: false,
          reason: `Need at least ${amount} ${action.counterType || "default"} counter(s) on the field.`,
        };
      }
    }

    if (action.type === "remove_counter") {
      const counterType = action.counterType || "default";
      const requestedAmount = Number(action.amount ?? 1);
      const amount = Number.isFinite(requestedAmount)
        ? Math.max(1, Math.floor(requestedAmount))
        : 1;
      const targetRef = action.targetRef || "self";
      const referencedTargets =
        previewCtx._actionTargets?.[targetRef] ||
        previewCtx.activationContext?.costSelections?.[targetRef];
      const targetCards =
        targetRef === "self"
          ? previewCtx.source
            ? [previewCtx.source]
            : []
          : getTargetCards({ referencedTargets });
      const canRemove = targetCards.some((card) => {
        const current = getRuntimeCounter(card, counterType);
        return action.allowBelow === true ? current > 0 : current >= amount;
      });
      if (!canRemove) {
        return {
          ok: false,
          reason: `Need at least ${amount} ${counterType} counter(s).`,
        };
      }
    }

    if (action.type === "add_counter") {
      const amount = resolvePreviewAddCounterAmount(this, action, ctx, player);
      if (amount <= 0 && !isActionOptionalNoop(action)) {
        return {
          ok: false,
          reason: `Need at least 1 ${action.counterType || "default"} counter to add.`,
        };
      }
    }

    if (action.type === "destroy_targeted_cards") {
      const availableTargets = countPreviewOpponentDestroyTargets(
        this,
        action,
        ctx,
      );
      if (availableTargets !== null) {
        const requestedMaxTargets = Number(action.maxTargets || 1);
        const requestedMinTargets = Number.isFinite(action.minTargets)
          ? action.minTargets
          : requestedMaxTargets;
        const minTargets = Math.max(1, requestedMinTargets);
        if (availableTargets < minTargets) {
          return {
            ok: false,
            reason: `Need ${minTargets} valid target(s) to destroy.`,
          };
        }
      }
    }

    if (
      action.type === "search_any" ||
      action.type === "add_from_zone_to_hand" ||
      action.type === "search_then_optional_special_summon_from_hand"
    ) {
      const inferredSearch =
        action.type === "search_any" ||
        action.type === "search_then_optional_special_summon_from_hand" ||
        action.mode === "search_any";
      const sourceZone = action.zone || (inferredSearch ? "deck" : "graveyard");
      const zoneValue = Reflect.get(player, String(sourceZone));
      const zone: ActionRuntimeCard[] = Array.isArray(zoneValue) ? zoneValue : [];
      const baseFilters = action.filters || {};
      const filters = { ...baseFilters };
      if (inferredSearch) {
        if (action.archetype && !filters.archetype) {
          filters.archetype = action.archetype;
        }
        if (action.cardKind && !filters.cardKind) {
          filters.cardKind = action.cardKind;
        }
        if (action.cardName && !filters.name) {
          filters.name = action.cardName;
        }
        if (Number.isFinite(action.minAtk) && filters.minAtk == null) {
          filters.minAtk = action.minAtk;
        }
        if (Number.isFinite(action.maxAtk) && filters.maxAtk == null) {
          filters.maxAtk = action.maxAtk;
        }
      }
      const count = action.count || { min: 1, max: 1 };
      const min = Math.max(
        typeof count === "object" ? count.min || 0 : Number(count || 0),
        0,
      );
      if (min > 0) {
        const hasCandidate = zone.some((card) => {
          if (!card) return false;
          if (typeof this?.cardMatchesFilters === "function") {
            if (!this.cardMatchesFilters(card, filters)) return false;
          }
          if (action.cardName) {
            const match = action.cardName.toLowerCase();
            if ((card.name || "").toLowerCase() !== match) return false;
          }
          if (typeof action.cardId === "number" && card.id !== action.cardId) {
            return false;
          }
          if (
            typeof action.minLevel === "number" &&
            (card.level || 0) < action.minLevel
          ) {
            return false;
          }
          if (
            typeof action.maxLevel === "number" &&
            (card.level || 0) > action.maxLevel
          ) {
            return false;
          }
          return true;
        });
        if (!hasCandidate) {
          return {
            ok: false,
            reason: `No valid cards in ${sourceZone} matching filters.`,
          };
        }
      }
    }

    if (action.type === "discard_from_hand") {
      const targetPlayer = action.player === "opponent" ? ctx?.opponent : player;
      const count = action.count || { min: 1, max: 1 };
      const min = Math.max(Number(count.min ?? 1), 0);
      if (min > 0) {
        const hand = targetPlayer?.hand || [];
        const filters = action.filters || {};
        const hasEnough =
          hand.filter((card) => matchesPreviewFilters(this, card, filters, ctx))
            .length >= min;
        if (!hasEnough) {
          return {
            ok: false,
            reason: "Not enough cards in hand to discard.",
          };
        }
      }
    }

    if (action.type === "declare_card_property") {
      if (!action.property || !action.stateKey) {
        return {
          ok: false,
          reason: "Invalid declaration action.",
        };
      }
    }

    if (
      action.type === "special_summon_from_zone" ||
      action.type === "special_summon_matching_level" ||
      action.type === "call_of_haunted_summon_and_bind"
    ) {
      const optionalSummon = isActionOptionalNoop(action);
      const destinationPlayer =
        action.summonToOwner === "opponent" ? ctx?.opponent : player;
      const fieldSlotsFreedBeforeSummon = Math.max(
        0,
        Number(action.fieldSlotsFreedBeforeSummon || 0),
      );
      const occupiedMonsterZones = Math.max(
        0,
        (destinationPlayer?.field || []).length - fieldSlotsFreedBeforeSummon,
      );
      if (!optionalSummon && occupiedMonsterZones >= 5) {
        return { ok: false, reason: "Field is full." };
      }
      if (
        !optionalSummon &&
        (action.type === "special_summon_from_zone" ||
          action.type === "special_summon_matching_level") &&
        !hasSpecialSummonCandidate(this, action, previewCtx)
      ) {
        return {
          ok: false,
          reason: "No valid cards available to Special Summon.",
        };
      }
    }

    if (action.type === "synchro_summon_from_extra_deck") {
      if (
        !Reflect.apply(hasSynchroSummonPreviewCandidate, undefined, [
          this,
          action,
          ctx,
        ])
      ) {
        return {
          ok: false,
          reason: "No legal Synchro Summon is available.",
        };
      }
    }

    if (action.type === "special_summon_from_deck_with_counter_limit") {
      if ((player.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }

      const source = ctx?.source;
      const counterType = action.counterType || "judgment_marker";
      const counterMultiplier = action.counterMultiplier || 500;
      const counterCount =
        getRuntimeCounter(source, counterType);
      const maxAtk = counterCount * counterMultiplier;
      if (maxAtk <= 0) {
        return {
          ok: false,
          reason: `No ${counterType} counters on ${source?.name || "source"}.`,
        };
      }

      const filters = { ...(action.filters || {}) };
      if (action.archetype && !filters.archetype) {
        filters.archetype = action.archetype;
      }
      const hasCandidate = (player.deck || []).some((card) => {
        if (!card || card.cardKind !== "monster") return false;
        if ((card.atk || 0) > maxAtk) return false;
        if (filters.archetype) {
          const archetypes = Array.isArray(card.archetypes)
            ? card.archetypes
            : card.archetype
              ? [card.archetype]
              : [];
          if (!archetypes.includes(filters.archetype)) return false;
        }
        return true;
      });

      if (!hasCandidate) {
        return {
          ok: false,
          reason: `No valid monsters in deck with ATK <= ${maxAtk}.`,
        };
      }
    }

    if (action.type === "special_summon_token") {
      const targetPlayer = action.player === "opponent" ? ctx?.opponent : player;
      if ((targetPlayer?.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }
      if (action.token) {
        const tokenPreview = {
          cardKind: "monster",
          name: action.token.name || "Token",
          atk: action.token.atk ?? 0,
          def: action.token.def ?? 0,
          level: action.token.level ?? 1,
          type: action.token.type || "Fiend",
          attribute: action.token.attribute || null,
          archetype: action.token.archetype || null,
          archetypes: action.token.archetypes,
          isToken: true,
        };
        const restrictionCheck =
          this.game?.canSpecialSummonUnderRestrictions?.(
            tokenPreview,
            targetPlayer,
            {
              summonMethod: "special",
              fromZone: "token",
              silent: true,
            },
          );
        if (restrictionCheck?.ok === false) {
          return {
            ok: false,
            reason: restrictionCheck.reason || "Token cannot be Special Summoned.",
          };
        }
      }
    }

    if (action.type === "special_summon_self_as_trap_monster") {
      if ((player.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }
      const source = ctx?.source;
      if (!source || !cardMatchesKind(source, ["spell", "trap"])) {
        return { ok: false, reason: "Source is not a Spell/Trap card." };
      }
      const sourceZone =
        typeof this?.findCardZone === "function"
          ? this.findCardZone(player, source)
          : null;
      if (sourceZone && sourceZone !== "spellTrap") {
        return { ok: false, reason: "Source must be in the Spell/Trap zone." };
      }
    }

    if (action.type === "special_summon_from_hand_with_tiered_cost") {
      if ((player.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }

      const filters = action.costFilters || {
        name: "Void Hollow",
        cardKind: "monster",
      };
      const matchesFilters = (card: ActionRuntimeCard | null): boolean => {
        if (!card) return false;
        if (filters.cardKind && !cardMatchesKind(card, filters.cardKind)) {
          return false;
        }
        if (filters.name && card.name !== filters.name) return false;
        if (filters.archetype) {
          const hasArc =
            card.archetype === filters.archetype ||
            (Array.isArray(card.archetypes) &&
              card.archetypes.includes(filters.archetype));
          if (!hasArc) return false;
        }
        return true;
      };
      const costCandidates = (player.field || []).filter(matchesFilters);
      const minCost = action.minCost ?? 1;
      if (costCandidates.length < minCost) {
        return {
          ok: false,
          reason: "Not enough cost monsters to Special Summon.",
        };
      }
    }

    if (action.type === "conditional_summon_from_hand") {
      if (action.optional !== false && hasOtherActions(action)) {
        continue;
      }

      // Check field space
      if ((player.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }

      // Check condition
      const condition = action.condition || {};
      if (condition.type === "control_card") {
        const zoneName = condition.zone || "fieldSpell";
        const cardName = condition.cardName;
        let conditionMet = false;

        if (zoneName === "fieldSpell") {
          conditionMet = player.fieldSpell?.name === cardName;
        } else {
          const zoneValue = Reflect.get(player, String(zoneName));
          const zone: ActionRuntimeCard[] = Array.isArray(zoneValue)
            ? zoneValue
            : [];
          conditionMet = zone.some((c: ActionRuntimeCard) => c && c.name === cardName);
        }

        if (!conditionMet) {
          return {
            ok: false,
            reason: `You must control "${cardName}" to activate this effect.`,
          };
        }
      } else if (condition.type === "control_card_type") {
        const zoneName = condition.zone || "field";
        const typeName = condition.typeName || condition.cardType;

        if (!typeName) {
          return { ok: false, reason: "Invalid condition configuration." };
        }

        const zoneValue = Reflect.get(player, String(zoneName));
        const zone: ActionRuntimeCard[] = Array.isArray(zoneValue)
          ? zoneValue
          : [];
        const conditionMet = zone.some((c: ActionRuntimeCard) => {
          if (!c || c.isFacedown) return false;
          if (Array.isArray(c.types)) {
            return c.types.includes(typeName);
          }
          return c.type === typeName;
        });

        if (!conditionMet) {
          return {
            ok: false,
            reason: `You must control a ${typeName} monster to activate this effect.`,
          };
        }
      }
    }

    if (action.type === "special_summon_from_hand_with_cost") {
      if ((player.field || []).length >= 5) {
        return { ok: false, reason: "Field is full." };
      }

      // Get cost target filter from effect.targets
      const costTargetRef = action.costTargetRef || "bbd_cost";
      const costEffect = ctx?.effect;
      if (!costEffect || !costEffect.targets) {
        return {
          ok: false,
          reason: "Cost targets not defined in effect.",
        };
      }

      const costTarget = costEffect.targets.find(
        (t) => t && t.id === costTargetRef
      );
      if (!costTarget) {
        return {
          ok: false,
          reason: "Cost target definition not found.",
        };
      }

      const requiredCount = Math.max(0, Number(costTarget.count?.min ?? 0));
      const zones = Array.isArray(costTarget.zones)
        ? costTarget.zones
        : [costTarget.zone || "hand"];
      const previewCostTarget = costTarget as PreviewTarget;
      const owners = getPreviewTargetOwners(previewCostTarget, ctx, player);
      if (owners.length === 0 || zones.length === 0) {
        return { ok: false, reason: "Cost zone not found." };
      }
      const zoneCards = owners.flatMap((owner) =>
        zones.flatMap((zoneName) => getPreviewZoneCards(owner, zoneName)),
      );

      const filters = buildTargetPreviewFilters(previewCostTarget);
      const validCosts = zoneCards.filter((card) =>
        matchesPreviewFilters(this, card, filters, ctx),
      );
      if (validCosts.length < requiredCount) {
        const zoneLabel = zones.join("/");
        const filterLabel =
          filters.type || filters.archetype || filters.cardKind || "card";
        return {
          ok: false,
          reason: `Need ${requiredCount} ${filterLabel}(s) in ${zoneLabel} to activate.`,
        };
      }
    }

    recordPreviewMoveCandidates(this, action, ctx, player, previewMoves);
  }

  return { ok: true };
}
