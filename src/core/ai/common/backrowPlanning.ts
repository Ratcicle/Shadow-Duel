import { buildPrioritizedAction } from "./actionGeneration.js";
import { canSetReactiveBackrowNow } from "./phaseTiming.js";
import type {
  AIStrategyBotPort,
  SetSpellTrapAIAction,
} from "../../contracts/ai.js";
import type { GameCard } from "../../contracts/cards.js";
import type { SimulatedCardState } from "../../contracts/aiState.js";

type BackrowPlanningCard = GameCard | SimulatedCardState;
type ReactiveBackrowGame = Parameters<typeof canSetReactiveBackrowNow>[1];
type ReactiveBackrowAnalysis = Parameters<typeof canSetReactiveBackrowNow>[2];

interface BackrowDecision {
  ok?: boolean;
  shouldSet?: boolean;
  yes?: boolean;
  priority?: number;
  reason?: string;
}

type BackrowPolicyDecision = boolean | BackrowDecision | null | undefined;

interface BackrowBaseContext {
  bot: AIStrategyBotPort | null | undefined;
  player: AIStrategyBotPort | null | undefined;
  hand: BackrowPlanningCard[];
  spellTrap: BackrowPlanningCard[];
  analysis: ReactiveBackrowAnalysis;
  game: ReactiveBackrowGame;
  opponent: AIStrategyBotPort | null | undefined;
  index: number;
  card: BackrowPlanningCard;
  basePriority: number;
}

interface BackrowDecisionContext extends BackrowBaseContext {
  setDecision: BackrowPolicyDecision;
}

interface BackrowPlanningPolicy {
  acceptsCard?(card: BackrowPlanningCard, context: BackrowBaseContext): boolean;
  skipIfAlreadySet?(
    card: BackrowPlanningCard,
    context: BackrowBaseContext,
  ): boolean;
  shouldSet?(
    card: BackrowPlanningCard,
    context: BackrowBaseContext,
  ): BackrowPolicyDecision;
  getPriority?(
    card: BackrowPlanningCard,
    context: BackrowDecisionContext,
  ): number | null | undefined;
  getReason?(
    card: BackrowPlanningCard,
    context: BackrowDecisionContext,
  ): string | null | undefined;
  getExtra?(
    card: BackrowPlanningCard,
    context: BackrowDecisionContext,
  ): Partial<SetSpellTrapAIAction> | null | undefined;
}

interface GenericSetBackrowInput {
  bot?: AIStrategyBotPort | null;
  player?: AIStrategyBotPort | null;
  hand?: BackrowPlanningCard[];
  spellTrap?: BackrowPlanningCard[];
  analysis?: ReactiveBackrowAnalysis;
  game?: ReactiveBackrowGame;
  opponent?: AIStrategyBotPort | null;
  alreadyUsedHandIndices?: ReadonlySet<number>;
  maxBackrow?: number;
  basePriority?: number;
  defaultReason?: string;
  policy?: BackrowPlanningPolicy;
}

function hasValue<Value>(
  value: Value | null | undefined,
): value is Value {
  return value !== undefined && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function defaultAcceptsBackrowCard(
  card: BackrowPlanningCard | null | undefined,
): boolean {
  return (
    card?.cardKind === "trap" ||
    (card?.cardKind === "spell" && card?.subtype === "quick")
  );
}

function isRejected(result: BackrowPolicyDecision): boolean {
  if (result === false) return true;
  if (!result || typeof result !== "object") return false;
  return result.ok === false || result.shouldSet === false || result.yes === false;
}

function isUsedIndex(
  indices: ReadonlySet<number> | null | undefined,
  index: number,
): boolean {
  return typeof indices?.has === "function" && indices.has(index);
}

/**
 * Build set_spell_trap actions for caller-approved backrow candidates.
 * Strategy-specific policy stays in the caller; this helper only handles
 * shared zone capacity, hand-index filtering, and action shape.
 */
export function getGenericSetBackrowActions({
  bot,
  player = bot,
  hand = player?.hand || [],
  spellTrap = player?.spellTrap || [],
  analysis,
  game,
  opponent,
  alreadyUsedHandIndices = new Set(),
  maxBackrow = 5,
  basePriority = -1,
  defaultReason = "prepare reactive backrow",
  policy = {},
}: GenericSetBackrowInput = {}): SetSpellTrapAIAction[] {
  if ((spellTrap || []).length >= maxBackrow) return [];

  const actions: SetSpellTrapAIAction[] = [];
  for (const [index, card] of (hand || []).entries()) {
    if (!card || isUsedIndex(alreadyUsedHandIndices, index)) continue;

    const baseContext = {
      bot: bot || player,
      player,
      hand,
      spellTrap,
      analysis,
      game,
      opponent,
      index,
      card,
      basePriority,
    };

    const acceptsCard =
      typeof policy.acceptsCard === "function"
        ? policy.acceptsCard(card, baseContext)
        : defaultAcceptsBackrowCard(card);
    if (!acceptsCard) continue;
    if (!canSetReactiveBackrowNow(card, game, analysis)) continue;

    if (
      typeof policy.skipIfAlreadySet === "function" &&
      policy.skipIfAlreadySet(card, baseContext)
    ) {
      continue;
    }

    const setDecision =
      typeof policy.shouldSet === "function"
        ? policy.shouldSet(card, baseContext)
        : true;
    if (isRejected(setDecision)) continue;

    const context = {
      ...baseContext,
      setDecision,
    };

    const policyPriority =
      typeof policy.getPriority === "function"
        ? policy.getPriority(card, context)
        : typeof setDecision === "object" && setDecision
          ? setDecision.priority
          : undefined;
    const priority = isFiniteNumber(policyPriority)
      ? policyPriority
      : basePriority;

    const policyReason =
      typeof policy.getReason === "function"
        ? policy.getReason(card, context)
        : typeof setDecision === "object" && setDecision
          ? setDecision.reason
          : undefined;
    const reason = hasValue(policyReason) ? policyReason : defaultReason;

    const extra =
      typeof policy.getExtra === "function"
        ? policy.getExtra(card, context)
        : {};

    actions.push(
      buildPrioritizedAction({
        type: "set_spell_trap",
        index,
        card,
        priority,
        reason,
        extra: {
          timingRole: "reactive_backrow",
          ...extra,
        },
      }),
    );
  }

  return actions;
}
