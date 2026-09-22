import type {
  ActionRuntimeCard,
  ActionRuntimePlayer,
  EffectContext,
} from "../../contracts/actionRuntime.js";
import type {
  EffectDefinition,
  PassiveRuleDefinition,
} from "../../contracts/effects.js";
import type { RuntimeCardFilter } from "../filters/cardFilters.js";

interface ReductionRule
  extends Omit<PassiveRuleDefinition, "stackMode" | "appliesTo"> {
  readonly allowFacedown?: boolean;
  readonly appliesTo?: string | readonly string[];
  readonly affects?: string | readonly string[];
  readonly owner?: string | readonly string[];
  readonly actionType?: string | readonly string[];
  readonly sourceFilter?: RuntimeCardFilter;
  readonly reduction?: number;
  readonly value?: number;
  readonly stackMode?: "max" | "sum";
  readonly minFinalAmount?: number;
  readonly minAmount?: number;
}
type CostEffect = EffectDefinition & {
  readonly allowFacedown?: boolean;
  readonly passive?: ReductionRule;
};
type CostPlayer = Omit<ActionRuntimePlayer, "strategy">;
interface CostContext extends Omit<EffectContext, "player" | "opponent"> {
  player?: CostPlayer | null;
  opponent?: CostPlayer | null;
  preview?: boolean;
}
interface CostOptions {
  preview?: boolean;
  consume?: boolean;
}
interface CostReducer {
  card: ActionRuntimeCard;
  controller: CostPlayer;
  effect: CostEffect;
  passive: ReductionRule;
  reduction: number;
  stackMode: "max" | "sum";
}
interface LpCostHost {
  game?: {
    player: CostPlayer;
    bot: CostPlayer;
    getOpponent?(player: CostPlayer): CostPlayer | null;
  };
  cardMatchesFilters(
    card: ActionRuntimeCard,
    filters: RuntimeCardFilter,
  ): boolean;
  checkOncePerTurn(
    card: ActionRuntimeCard,
    player: CostPlayer,
    effect: CostEffect,
  ): { ok: boolean };
  markOncePerTurn(effect: CostEffect, context: CostContext): void;
}
export interface LpCostResult {
  baseAmount: number;
  finalAmount: number;
  reduction: number;
  appliedCount: number;
  appliedReducers: CostReducer[];
}

/** Base payment shared by activation preview, execution and AI simulation. */
export function getBaseLpCost(
  action: { readonly amount?: number; readonly fraction?: number },
  currentLp: number,
): number {
  return action.fraction !== undefined
    ? currentLp * action.fraction
    : (action.amount ?? 0);
}

export function resolveLpCost(
  this: LpCostHost,
  action: { type?: string } | null | undefined,
  ctx: CostContext,
  baseAmount = 0,
  options: CostOptions | null = {},
): LpCostResult {
  options = options || {};
  const resolvedBase = Number(baseAmount) || 0;
  const previewOnly =
    options.preview === true ||
    options.consume === false ||
    ctx?.preview === true ||
    ctx?.isPreview === true ||
    ctx?.activationContext?.preview === true ||
    ctx?.activationContext?.isPreview === true;
  const shouldConsume = !previewOnly;
  const result: LpCostResult = {
    baseAmount: resolvedBase,
    finalAmount: resolvedBase,
    reduction: 0,
    appliedCount: 0,
    appliedReducers: [],
  };

  if (!this.game || !ctx?.player || resolvedBase <= 0) {
    return result;
  }

  const player = ctx.player;
  const opponent = ctx.opponent || this.game?.getOpponent?.(player);
  const source = ctx.source || null;

  const boards = [player, opponent].filter((board): board is CostPlayer =>
    Boolean(board),
  );
  const reducers: CostReducer[] = [];

  for (const board of boards) {
    const zoneCards = [
      ...(board.field || []),
      ...(board.spellTrap || []),
      board.fieldSpell,
    ].filter(Boolean);

    for (const card of zoneCards) {
      if (!card?.effects || !Array.isArray(card.effects)) continue;

      for (const effect of card.effects as readonly CostEffect[]) {
        if (!effect || effect.timing !== "passive") continue;
        const passive: ReductionRule | undefined = effect.passive;
        if (!passive || passive.type !== "lp_cost_reduction") continue;

        const allowFacedown =
          effect.allowFacedown === true || passive.allowFacedown === true;
        if (!allowFacedown && card.isFacedown) continue;
        if (effect.requireFaceup === true && card.isFacedown) continue;

        const controllerId = card.controller || card.owner;
        const controller =
          controllerId === "player" ? this.game.player : this.game.bot;
        const relation = controller?.id === player.id ? "self" : "opponent";

        const appliesToRaw =
          passive.appliesTo || passive.affects || passive.owner || "self";
        const appliesTo = Array.isArray(appliesToRaw)
          ? appliesToRaw
          : [appliesToRaw];
        if (!appliesTo.includes("any") && !appliesTo.includes(relation)) {
          continue;
        }

        const actionTypes = passive.actionTypes || passive.actionType;
        if (actionTypes) {
          const allowedTypes: readonly unknown[] = Array.isArray(actionTypes)
            ? actionTypes
            : [actionTypes];
          if (!allowedTypes.includes(action?.type)) continue;
        }

        const sourceFilters =
          passive.sourceFilters || passive.sourceFilter || null;
        if (sourceFilters) {
          if (!source) continue;
          const normalizedFilters = { ...sourceFilters };
          if (normalizedFilters.cardName && !normalizedFilters.name) {
            normalizedFilters.name = normalizedFilters.cardName;
          }
          if (!this.cardMatchesFilters(source, normalizedFilters)) continue;
        }

        const optCheck = this.checkOncePerTurn(card, controller, effect);
        if (!optCheck.ok) continue;

        const reductionValue = Number(
          passive.amount ?? passive.reduction ?? passive.value ?? 0,
        );
        if (reductionValue <= 0) continue;

        reducers.push({
          card,
          controller,
          effect,
          passive,
          reduction: reductionValue,
          stackMode: passive.stackMode || "max",
        });
      }
    }
  }

  if (reducers.length === 0) {
    return result;
  }

  let maxReducer = null;
  let maxReduction = 0;
  let sumReduction = 0;
  const sumReducers: CostReducer[] = [];

  for (const reducer of reducers) {
    if (reducer.stackMode === "sum") {
      sumReduction += reducer.reduction;
      sumReducers.push(reducer);
      continue;
    }

    if (reducer.reduction > maxReduction) {
      maxReduction = reducer.reduction;
      maxReducer = reducer;
    }
  }

  let minFinalAmount = 0;
  if (maxReducer) {
    minFinalAmount = Math.max(
      minFinalAmount,
      Number(
        maxReducer.passive.minFinalAmount ?? maxReducer.passive.minAmount ?? 0,
      ),
    );
  }
  for (const reducer of sumReducers) {
    minFinalAmount = Math.max(
      minFinalAmount,
      Number(reducer.passive.minFinalAmount ?? reducer.passive.minAmount ?? 0),
    );
  }

  const totalReduction = sumReduction + maxReduction;
  const finalAmount = Math.max(minFinalAmount, resolvedBase - totalReduction);

  if (finalAmount >= resolvedBase) {
    return result;
  }

  result.finalAmount = finalAmount;
  result.reduction = resolvedBase - finalAmount;

  if (maxReducer && maxReduction > 0) {
    result.appliedReducers.push(maxReducer);
  }

  for (const reducer of sumReducers) {
    if (reducer.reduction <= 0) continue;
    result.appliedReducers.push(reducer);
  }

  if (shouldConsume && maxReducer && maxReduction > 0) {
    this.markOncePerTurn(maxReducer.effect, {
      player: maxReducer.controller,
      source: maxReducer.card,
    });
  }

  if (shouldConsume) {
    for (const reducer of sumReducers) {
      if (reducer.reduction <= 0) continue;
      this.markOncePerTurn(reducer.effect, {
        player: reducer.controller,
        source: reducer.card,
      });
    }
  }

  result.appliedCount = result.appliedReducers.length;
  return result;
}
