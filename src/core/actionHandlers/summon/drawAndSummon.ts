import { isAI } from "../../Player.js";
import type { ActionOf } from "../../contracts/actions.js";
import type {
  ActionHandlerEnginePort,
  ActionRuntimeCard,
  EffectContext,
  ResolvedTargetMap,
} from "../../contracts/actionRuntime.js";
import type { CardFilter } from "../../contracts/effects.js";
import { getCardDisplayName, getUIText } from "../../i18n.js";
import { getUI } from "../shared.js";
import { performSummonFromHand } from "./fromHand.js";

type DrawConditionFilters = Omit<CardFilter, "type"> & {
  readonly type?: string | readonly string[];
};

type MutableDrawConditionFilters = {
  -readonly [Key in keyof DrawConditionFilters]: DrawConditionFilters[Key];
};

interface DrawCondition {
  readonly type?: string;
  readonly filters?: DrawConditionFilters;
  readonly typeName?: string;
  readonly cardKind?: DrawConditionFilters["cardKind"];
  readonly minLevel?: number;
  readonly maxLevel?: number;
}

function asArray<Value>(value: Value | readonly Value[]): readonly Value[] {
  return Array.isArray(value) ? value : [value as Value];
}

function valueMatchesFilter<Value>(
  value: Value,
  filterValue: Value | readonly Value[] | null | undefined,
) {
  if (filterValue === undefined || filterValue === null) return true;
  return asArray(filterValue).includes(value);
}

function buildDrawConditionFilters(
  condition: DrawCondition = {},
): DrawConditionFilters {
  const filters: MutableDrawConditionFilters =
    condition.filters && typeof condition.filters === "object"
      ? { ...condition.filters }
      : {};

  if (condition.typeName && filters.type === undefined) {
    filters.type = condition.typeName;
  }
  if (condition.cardKind && filters.cardKind === undefined) {
    filters.cardKind = condition.cardKind;
  }
  if (
    typeof condition.minLevel === "number" &&
    Number.isFinite(condition.minLevel) &&
    filters.minLevel === undefined
  ) {
    filters.minLevel = condition.minLevel;
  }
  if (
    typeof condition.maxLevel === "number" &&
    Number.isFinite(condition.maxLevel) &&
    filters.maxLevel === undefined
  ) {
    filters.maxLevel = condition.maxLevel;
  }

  return filters;
}

function fallbackCardMatchesFilters(
  card: ActionRuntimeCard,
  filters: DrawConditionFilters = {},
) {
  if (!card) return false;
  if (!valueMatchesFilter(card.cardKind, filters.cardKind)) return false;

  if (filters.type !== undefined) {
    const cardTypes = Array.isArray(card.types) ? card.types : [card.type];
    const requiredTypes = asArray(filters.type);
    if (!requiredTypes.some((typeName) => cardTypes.includes(typeName))) {
      return false;
    }
  }

  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }

  if (
    typeof filters.minLevel === "number" &&
    Number.isFinite(filters.minLevel) &&
    (Number(card.level) || 0) < filters.minLevel
  ) {
    return false;
  }
  if (
    typeof filters.maxLevel === "number" &&
    Number.isFinite(filters.maxLevel) &&
    (Number(card.level) || 0) > filters.maxLevel
  ) {
    return false;
  }

  return true;
}

function drawnCardMatchesCondition(
  card: ActionRuntimeCard,
  condition: DrawCondition = {},
  engine: ActionHandlerEnginePort,
) {
  if (!condition || Object.keys(condition).length === 0) return true;

  const usesCardPropCondition =
    condition.type === "match_card_props" || condition.filters;
  if (!usesCardPropCondition) return true;

  const filters = buildDrawConditionFilters(condition);
  if (Object.keys(filters).length === 0) return true;

  if (typeof engine?.cardMatchesFilters === "function") {
    return engine.cardMatchesFilters(card, filters);
  }
  return fallbackCardMatchesFilters(card, filters);
}

export async function handleDrawAndSummon(
  action: ActionOf<"draw_and_summon">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const drawAmount = action.drawAmount || 1;
  const condition = (action.condition || {}) as DrawCondition;
  const optional = action.optional !== false;

  const drawn = game.drawCards!(player, drawAmount);

  if (!drawn || !drawn.ok || !drawn.drawn || drawn.drawn.length === 0) {
    return false;
  }

  const drawnCard = drawn.drawn[0];
  if (!drawnCard) return false;

  game.updateBoard!();

  if (typeof game.waitForPresentationDelay === "function") {
    await game.waitForPresentationDelay(400);
  } else {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  if (!drawnCardMatchesCondition(drawnCard, condition, engine)) {
    return true;
  }

  if (player.field.length >= 5) {
    getUI(game)?.log("Field is full, cannot Special Summon.");
    return true;
  }

  const handIndex = player.hand.indexOf(drawnCard);
  if (handIndex === -1) {
    return true;
  }

  if (isAI(player)) {
    const summonResult = await performSummonFromHand(
      drawnCard,
      handIndex,
      player,
      action,
      engine,
    );
    return summonResult &&
      typeof summonResult === "object" &&
      "needsSelection" in summonResult
      ? summonResult
      : true;
  }

  if (optional) {
    const cardName = getCardDisplayName(drawnCard) || drawnCard.name;
    const wantsToSummon =
      (await getUI(game)?.showConfirmPrompt?.(
        getUIText("ui.summon.drawnPrompt", { cardName }),
        { kind: "draw_and_summon", cardName },
      )) ?? false;

    if (!wantsToSummon) {
      return true;
    }
  }

  const summonResult = await performSummonFromHand(
    drawnCard,
    handIndex,
    player,
    action,
    engine,
  );
  return summonResult &&
    typeof summonResult === "object" &&
    "needsSelection" in summonResult
    ? summonResult
    : true;
}

