import {
  getUI,
  resolveTargetCards,
  sendCardsToGraveyard,
} from "../shared.js";
import type { ActionOf } from "../../contracts/actions.js";
import type { SelectionCount } from "../../contracts/actions.js";
import type {
  ActionHandlerEnginePort,
  EffectContext,
  ResolvedTargetMap,
} from "../../contracts/actionRuntime.js";
import type { BattlePositionInput } from "../../contracts/cards.js";
import type { CardFilter } from "../../contracts/effects.js";
import type { ZoneInput } from "../../contracts/zones.js";
import { handleSpecialSummonFromZone } from "./fromZone.js";
import type { SpecialSummonFromZoneInput } from "./fromZone.js";

type TransmutateAction = ActionOf<"transmutate"> & {
  readonly costTargetRef?: string;
  readonly costFromZone?: ZoneInput;
  readonly summonFilters?: CardFilter;
  readonly filters?: CardFilter;
  readonly levelOp?: "eq" | "lte" | "gte" | "lt" | "gt";
  readonly summonZone?: ZoneInput;
  readonly zone?: ZoneInput;
  readonly count?: number | SelectionCount;
  readonly position?: BattlePositionInput;
  readonly cannotAttackThisTurn?: boolean;
  readonly negateEffects?: boolean;
  readonly promptPlayer?: boolean;
  readonly excludeSummonRestrict?: readonly string[];
};

type SummonFromZoneCallback = (
  action: SpecialSummonFromZoneInput,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) => ReturnType<typeof handleSpecialSummonFromZone>;

export async function handleTransmutate(
  action: TransmutateAction,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  return await resolveTransmutate(
    action,
    ctx,
    targets,
    engine,
    handleSpecialSummonFromZone,
  );
}

export async function resolveTransmutate(
  action: TransmutateAction,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
  summonFromZone: SummonFromZoneCallback,
) {
  const { player } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const costRef = action.costTargetRef || action.targetRef;
  const costCards = resolveTargetCards(action, ctx, targets, {
    targetRef: costRef ?? undefined,
  });

  if (costCards.length === 0) {
    getUI(game)?.log("No valid cost selected for Transmutate.");
    return false;
  }

  const costCard = costCards[0];
  const costLevel = costCard?.level ?? 0;

  if (!costLevel) {
    getUI(game)?.log("Transmutate requires a monster with a Level.");
    return false;
  }

  const fromZone =
    (typeof engine.findCardZone === "function" &&
      engine.findCardZone(player, costCard)) ||
    action.costFromZone ||
    "field";

  await sendCardsToGraveyard([costCard], player, engine, {
    fromZone,
    fallbackZone: "field",
    pushIfMissing: true,
  });

  if (typeof game.updateBoard === "function") {
    game.updateBoard();
  }

  const summonFilters = {
    ...(action.summonFilters || action.filters || {}),
  };

  if (!summonFilters.cardKind) {
    summonFilters.cardKind = "monster";
  }

  summonFilters.level = costLevel;
  summonFilters.levelOp = action.levelOp || "eq";

  const summonAction = {
    zone: action.summonZone || action.zone || "graveyard",
    filters: summonFilters,
    count: action.count || { min: 1, max: 1 },
    position: action.position || "choice",
    cannotAttackThisTurn: action.cannotAttackThisTurn || false,
    negateEffects: action.negateEffects || false,
    promptPlayer: action.promptPlayer,
    excludeSummonRestrict: action.excludeSummonRestrict || [],
  };

  return await summonFromZone(summonAction, ctx, targets, engine);
}
