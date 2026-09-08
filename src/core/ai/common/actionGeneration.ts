/**
 * Shared AI action generation primitives.
 *
 * These helpers are intentionally strategy-neutral: they do not import
 * strategies, do not know card names, and do not apply macro/safety policy
 * unless the caller explicitly provides it.
 */

import type {
  AIActionOf,
  AIActionType,
  AIActivationContext,
} from "../../contracts/ai.js";
import type {
  AiLiveGamePort,
  SimulatedCardState,
  SimulatedPlayerState,
} from "../../contracts/aiState.js";
import type { GameCard } from "../../contracts/cards.js";
import type { EffectDefinition } from "../../contracts/effects.js";

type PlanningCard = GameCard | SimulatedCardState;
type ActionIndexKey =
  | "index"
  | "fieldIndex"
  | "zoneIndex"
  | "graveyardIndex"
  | "materialIndex";
type AIActionExtraByType = {
  [Type in AIActionType]: Partial<Omit<AIActionOf<Type>, "type">>;
};
type AIActionExtra<Type extends AIActionType> = AIActionExtraByType[Type];
type AIActionExtraInput<Type extends AIActionType> =
  | AIActionExtra<Type>
  | ((context: unknown) => AIActionExtra<Type> | null);

interface MutablePrioritizedAction {
  type: AIActionType;
  priority: number;
  index?: number;
  fieldIndex?: number;
  zoneIndex?: number;
  graveyardIndex?: number;
  materialIndex?: number;
  cardId?: number;
  cardName?: string;
  effectId?: string;
  reason?: string;
  activationContext?: AIActivationContext;
}

interface BuildPrioritizedActionInput<Type extends AIActionType = AIActionType> {
  type: Type;
  index?: number | null;
  fieldIndex?: number | null;
  zoneIndex?: number | null;
  graveyardIndex?: number | null;
  materialIndex?: number | null;
  card?: PlanningCard | null;
  priority?: number;
  reason?: string | null;
  effect?: EffectDefinition | null;
  activationContext?: AIActivationContext | null;
  extra?: AIActionExtra<NoInfer<Type>> | null;
}

interface ActionDecision {
  yes?: boolean;
  ok?: boolean;
  priority?: number;
  reason?: string;
  position?: "attack" | "defense" | "choice";
}

interface ActionAllowedResult {
  ok?: boolean;
}

interface SafetyAdjustmentResult {
  adjustment?: number;
  priority?: number;
}

interface ActionGenerationAnalysis {
  canNormalSummon?: boolean;
  fieldCapacity?: number;
}

interface HandSpellContext {
  game?: AiLiveGamePort;
  player: SimulatedPlayerState;
  analysis?: unknown;
  index: number;
  card: PlanningCard;
}

interface HandSpellOptions {
  game?: AiLiveGamePort;
  player: SimulatedPlayerState;
  hand?: PlanningCard[];
  analysis?: unknown;
  shouldPlay?(
    card: PlanningCard,
    analysis: unknown,
    context: HandSpellContext,
  ): ActionDecision;
  buildActivationContext?(
    card: PlanningCard,
    analysis: unknown,
    context: HandSpellContext & { decision: ActionDecision },
  ): AIActivationContext | null;
  canActivate?(
    context: HandSpellContext & {
      decision: ActionDecision;
      activationContext: AIActivationContext | null;
    },
  ): boolean | ActionAllowedResult | null | undefined;
  type?: Extract<AIActionType, "spell">;
  extra?: AIActionExtraInput<"spell">;
}

interface TributeInfo {
  tributesNeeded?: number;
  usingAlt?: boolean;
  alt?: unknown;
}

interface NormalSummonOptions {
  player: SimulatedPlayerState;
  hand?: PlanningCard[];
  analysis?: ActionGenerationAnalysis;
  getTributeRequirement?(
    card: PlanningCard,
    player: SimulatedPlayerState,
    context: unknown,
  ): TributeInfo;
  shouldSummon?(
    card: PlanningCard,
    analysis: ActionGenerationAnalysis,
    tributeInfo: TributeInfo,
    context: unknown,
  ): ActionDecision;
  type?: Extract<AIActionType, "summon">;
  extra?: AIActionExtraInput<"summon">;
}

interface IgnitionContext {
  game?: AiLiveGamePort;
  player: SimulatedPlayerState;
  analysis?: unknown;
  sourceIndex: number;
  card: PlanningCard;
  sourceZone?: string;
}

interface IgnitionEffectOptions<Type extends AIActionType> {
  game?: AiLiveGamePort;
  player: SimulatedPlayerState;
  cards?: PlanningCard[];
  analysis?: unknown;
  type: Type;
  sourceZone?: string;
  indexFields?: ActionIndexKey[];
  findEffect?(
    card: PlanningCard,
    sourceZone: string | undefined,
    context: IgnitionContext,
  ): EffectDefinition | null;
  shouldActivate?(
    card: PlanningCard,
    analysis: unknown,
    context: IgnitionContext & { effect: EffectDefinition },
  ): ActionDecision;
  buildActivationContext?(
    card: PlanningCard,
    analysis: unknown,
    context: IgnitionContext & {
      effect: EffectDefinition;
      decision: ActionDecision;
    },
  ): AIActivationContext | null;
  canActivate?(context: unknown): boolean | ActionAllowedResult | null | undefined;
  cardFilter?(
    card: PlanningCard,
    zone: string | undefined,
    context: { player: SimulatedPlayerState; sourceIndex: number },
  ): boolean;
  includeEffectId?: boolean;
  extra?: AIActionExtraInput<NoInfer<Type>>;
}

interface SafetyResult {
  riskScore?: number;
  recommendation?: "safe" | "caution" | "risky" | "blocked";
}

interface SafetyPolicyMap {
  safe?: number;
  caution?: number;
  risky?: number;
  blocked?: number;
  default?: number;
}

interface MacroSafetyContext {
  priority: number;
  basePriority: number;
  actionType?: AIActionType;
  card?: PlanningCard | null;
  macroStrategy?: unknown;
  safety: SafetyResult | null;
  macroBuff: number;
  safetyScore: number | null;
}

interface MacroSafetyOptions {
  basePriority?: number;
  actionType?: AIActionType;
  card?: PlanningCard | null;
  macroStrategy?: unknown;
  safety?: SafetyResult | null;
  safetyPolicy?:
    | SafetyPolicyMap
    | ((context: MacroSafetyContext) => number | SafetyAdjustmentResult)
    | null;
  macroBonusFn?: ((
    actionType: AIActionType | undefined,
    card: PlanningCard | null | undefined,
    macroStrategy: unknown,
  ) => number) | null;
}

function hasValue<Value>(
  value: Value | null | undefined,
): value is Value {
  return value !== undefined && value !== null;
}

function finiteOr(value: unknown, fallback = 0): number {
  return Number.isFinite(value) ? value as number : fallback;
}

function applyIndex(
  action: MutablePrioritizedAction,
  key: ActionIndexKey,
  value: number | null | undefined,
): void {
  if (hasValue(value)) action[key] = value;
}

function resolveExtra<Type extends AIActionType>(
  extra: AIActionExtraInput<Type> | null | undefined,
  context: unknown,
): AIActionExtra<Type> {
  if (typeof extra === "function") return extra(context) || {};
  return extra || {};
}

function isActionAllowed(
  result: boolean | ActionAllowedResult | null | undefined,
): boolean {
  return (
    result !== false &&
    (result as ActionAllowedResult | null | undefined)?.ok !== false
  );
}

function defaultIgnitionCardFilter(
  card: PlanningCard | null | undefined,
  zone?: string,
): boolean {
  if (!card) return false;
  if (zone === "spellTrap") {
    return card.cardKind === "spell" && !card.isFacedown;
  }
  if (zone === "field") {
    return card.cardKind === "monster" && !card.isFacedown;
  }
  return true;
}

function resolveSafetyAdjustment(
  safetyPolicy: MacroSafetyOptions["safetyPolicy"],
  context: MacroSafetyContext,
): number {
  if (!safetyPolicy) return 0;

  if (typeof safetyPolicy === "function") {
    const result = safetyPolicy(context);
    if (Number.isFinite(result)) return result as number;
    if (Number.isFinite((result as SafetyAdjustmentResult)?.adjustment)) {
      return (result as SafetyAdjustmentResult).adjustment as number;
    }
    if (Number.isFinite((result as SafetyAdjustmentResult)?.priority)) {
      return (result as SafetyAdjustmentResult).priority as number - context.priority;
    }
    return 0;
  }

  const recommendation = context.safety?.recommendation;
  return hasValue(recommendation) &&
    Number.isFinite(safetyPolicy[recommendation])
    ? safetyPolicy[recommendation]!
    : finiteOr(safetyPolicy.default, 0);
}

/**
 * Build a prioritized action while preserving the existing action shape.
 * Optional fields are only included when provided; `extra` is applied last so
 * callers can opt into exact per-strategy fields or overrides.
 */
export function buildPrioritizedAction<Type extends AIActionType>({
  type,
  index,
  fieldIndex,
  zoneIndex,
  graveyardIndex,
  materialIndex,
  card,
  priority = 0,
  reason = null,
  effect = null,
  activationContext = null,
  extra = {} as AIActionExtra<Type>,
}: BuildPrioritizedActionInput<Type> = {} as BuildPrioritizedActionInput<Type>): AIActionOf<Type> {
  const action: MutablePrioritizedAction = {
    type,
    priority,
  };

  applyIndex(action, "index", index);
  applyIndex(action, "fieldIndex", fieldIndex);
  applyIndex(action, "zoneIndex", zoneIndex);
  applyIndex(action, "graveyardIndex", graveyardIndex);
  applyIndex(action, "materialIndex", materialIndex);

  if (hasValue(card?.id)) action.cardId = card!.id as number;
  if (hasValue(card?.name)) action.cardName = card!.name as string;
  if (hasValue(effect?.id)) action.effectId = effect!.id as string;
  if (hasValue(reason)) action.reason = reason as string;
  if (hasValue(activationContext)) {
    action.activationContext = activationContext as AIActivationContext;
  }

  return {
    ...action,
    ...(extra || {}),
  } as AIActionOf<Type>;
}

/**
 * Build hand spell actions using caller-owned policy, context and preview.
 */
export function getGenericHandSpellActions({
  game,
  player,
  hand = player?.hand || [],
  analysis,
  shouldPlay,
  buildActivationContext,
  canActivate,
  type = "spell",
  extra = {},
}: HandSpellOptions = {} as HandSpellOptions): AIActionOf<"spell">[] {
  const actions: AIActionOf<"spell">[] = [];
  for (const [index, card] of (hand || []).entries()) {
    if (!card || card.cardKind !== "spell") continue;

    const context = { game, player, analysis, index, card };
    const decision =
      typeof shouldPlay === "function"
        ? shouldPlay(card, analysis, context)
        : { yes: true };
    if (!decision?.yes) continue;

    const activationContext =
      typeof buildActivationContext === "function"
        ? buildActivationContext(card, analysis, { ...context, decision })
        : null;
    const canUse =
      typeof canActivate === "function"
        ? canActivate({ ...context, decision, activationContext })
        : true;
    if (!isActionAllowed(canUse)) continue;

    actions.push(
      buildPrioritizedAction({
        type,
        index,
        card,
        priority: decision.priority || 1,
        reason: decision.reason,
        activationContext,
        extra: resolveExtra(extra, {
          ...context,
          decision,
          activationContext,
        }),
      }),
    );
  }
  return actions;
}

/**
 * Build normal summon actions using caller-owned tribute and summon policy.
 */
export function getGenericNormalSummonActions({
  player,
  hand = player?.hand || [],
  analysis,
  getTributeRequirement,
  shouldSummon,
  type = "summon",
  extra = {},
}: NormalSummonOptions = {} as NormalSummonOptions): AIActionOf<"summon">[] {
  const actions: AIActionOf<"summon">[] = [];
  if (!analysis?.canNormalSummon || (analysis.fieldCapacity as number) <= 0) {
    return actions;
  }

  for (const [index, card] of (hand || []).entries()) {
    if (!card || card.cardKind !== "monster") continue;
    if (card.cannotBeNormalSummonedOrSet) continue;

    const context = { player, analysis, index, card };
    const tributeInfo =
      typeof getTributeRequirement === "function"
        ? getTributeRequirement(card, player, context)
        : {};
    const decision =
      typeof shouldSummon === "function"
        ? shouldSummon(card, analysis, tributeInfo, {
            ...context,
            tributeInfo,
          })
        : { yes: true };
    if (!decision?.yes) continue;

    actions.push(
      buildPrioritizedAction({
        type,
        index,
        card,
        priority: decision.priority || 1,
        reason: decision.reason,
        extra: {
          position: decision.position || "attack",
          facedown: false,
          ...resolveExtra(extra, {
            ...context,
            tributeInfo,
            decision,
          }),
        },
      }),
    );
  }

  return actions;
}

/**
 * Build ignition-style effect actions with caller-owned discovery and preview.
 */
export function getGenericIgnitionEffectActions<Type extends AIActionType>({
  game,
  player,
  cards = [],
  analysis,
  type,
  sourceZone,
  indexFields = ["index"],
  findEffect,
  shouldActivate,
  buildActivationContext,
  canActivate,
  cardFilter = defaultIgnitionCardFilter,
  includeEffectId = false,
  extra = {} as AIActionExtra<Type>,
}: IgnitionEffectOptions<Type> = {} as IgnitionEffectOptions<Type>): AIActionOf<Type>[] {
  const actions: AIActionOf<Type>[] = [];
  for (const [sourceIndex, card] of (cards || []).entries()) {
    if (!card || !cardFilter(card, sourceZone, { player, sourceIndex })) {
      continue;
    }

    const context = {
      game,
      player,
      analysis,
      sourceIndex,
      card,
      sourceZone,
    };
    const effect =
      typeof findEffect === "function"
        ? findEffect(card, sourceZone, context)
        : null;
    if (!effect) continue;

    const decision =
      typeof shouldActivate === "function"
        ? shouldActivate(card, analysis, { ...context, effect })
        : { yes: true };
    if (!decision?.yes) continue;

    const activationContext =
      typeof buildActivationContext === "function"
        ? buildActivationContext(card, analysis, {
            ...context,
            effect,
            decision,
          })
        : null;
    const canUse =
      typeof canActivate === "function"
        ? canActivate({
            ...context,
            effect,
            decision,
            activationContext,
          })
        : true;
    if (!isActionAllowed(canUse)) continue;

    const indexes: Partial<Pick<MutablePrioritizedAction, ActionIndexKey>> = {};
    for (const field of indexFields || []) {
      indexes[field] = sourceIndex;
    }

    actions.push(
      buildPrioritizedAction({
        type,
        ...indexes,
        card,
        effect: includeEffectId ? effect : null,
        priority: decision.priority || 1,
        reason: decision.reason,
        activationContext,
        extra: resolveExtra(extra, {
          ...context,
          effect,
          decision,
          activationContext,
        }),
      }),
    );
  }

  return actions;
}

/**
 * Combine opt-in macro and safety adjustments for action priority.
 * The helper never computes safety itself; callers pass precomputed safety and
 * policy when they want those metadata reflected.
 */
export function applyMacroAndSafety({
  basePriority = 0,
  actionType,
  card,
  macroStrategy,
  safety = null,
  macroBonusFn = null,
  safetyPolicy = null,
}: MacroSafetyOptions = {}) {
  const normalizedBasePriority = finiteOr(basePriority, 0);
  let priority = normalizedBasePriority;
  let macroBuff = 0;

  if (typeof macroBonusFn === "function") {
    macroBuff = finiteOr(macroBonusFn(actionType, card, macroStrategy), 0);
    priority += macroBuff;
  }

  const safetyScore = Number.isFinite(safety?.riskScore)
    ? safety!.riskScore as number
    : null;
  const safetyAdjustment = resolveSafetyAdjustment(safetyPolicy, {
    priority,
    basePriority: normalizedBasePriority,
    actionType,
    card,
    macroStrategy,
    safety,
    macroBuff,
    safetyScore,
  });

  priority += safetyAdjustment;

  return {
    priority,
    macroBuff,
    safetyScore,
    safetyAdjustment,
  };
}

/**
 * Create a shallow shared context for action-generation helpers.
 * `extra` is applied last so future callers can add or override fields without
 * changing this helper's core contract.
 */
export function createActionGenerationContext<Extra extends object>({
  game,
  strategy,
  bot,
  opponent,
  analysis,
  actualGame,
  isSimulatedState,
  macroStrategy,
  activationContext,
  log,
  extra = {} as Extra,
}: {
  game?: AiLiveGamePort;
  strategy?: unknown;
  bot?: SimulatedPlayerState;
  opponent?: SimulatedPlayerState;
  analysis?: unknown;
  actualGame?: AiLiveGamePort;
  isSimulatedState?: boolean;
  macroStrategy?: unknown;
  activationContext?: AIActivationContext;
  log?: ((message: string) => void) | null;
  extra?: Extra;
} = {}) {
  return {
    game,
    strategy,
    bot,
    opponent,
    analysis,
    actualGame,
    isSimulatedState,
    macroStrategy,
    activationContext,
    log,
    ...(extra || {}),
  };
}
