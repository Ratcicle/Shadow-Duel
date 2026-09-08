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

type BackrowPlayer<Card extends BackrowPlanningCard> = Omit<AIStrategyBotPort, "hand" | "spellTrap"> & {hand: Card[]; spellTrap: Card[]};

interface BackrowBaseContext<Card extends BackrowPlanningCard> {
  bot: BackrowPlayer<Card> | null | undefined;
  player: BackrowPlayer<Card> | null | undefined;
  hand: Card[];
  spellTrap: Card[];
  analysis: ReactiveBackrowAnalysis;
  game: ReactiveBackrowGame;
  opponent: AIStrategyBotPort | null | undefined;
  index: number;
  card: Card;
  basePriority: number;
}

interface BackrowDecisionContext<Card extends BackrowPlanningCard, Decision extends BackrowPolicyDecision> extends BackrowBaseContext<Card> {
  setDecision: Decision;
}

interface BackrowPlanningPolicy<Card extends BackrowPlanningCard, Decision extends BackrowPolicyDecision> {
  acceptsCard?(card: Card, context: BackrowBaseContext<Card>): boolean;
  skipIfAlreadySet?(
    card: Card,
    context: BackrowBaseContext<Card>,
  ): boolean;
  shouldSet?(
    card: Card,
    context: BackrowBaseContext<Card>,
  ): Decision;
  getPriority?(
    card: Card,
    context: BackrowDecisionContext<Card, Decision>,
  ): number | null | undefined;
  getReason?(
    card: Card,
    context: BackrowDecisionContext<Card, Decision>,
  ): string | null | undefined;
  getExtra?(
    card: Card,
    context: BackrowDecisionContext<Card, Decision>,
  ): Partial<SetSpellTrapAIAction> | null | undefined;
}

interface GenericSetBackrowInput<Card extends BackrowPlanningCard, Decision extends BackrowPolicyDecision> {
  bot?: BackrowPlayer<Card> | null;
  player?: BackrowPlayer<Card> | null;
  hand?: Card[];
  spellTrap?: Card[];
  analysis?: ReactiveBackrowAnalysis;
  game?: ReactiveBackrowGame;
  opponent?: AIStrategyBotPort | null;
  alreadyUsedHandIndices?: ReadonlySet<number | undefined>;
  maxBackrow?: number;
  basePriority?: number;
  defaultReason?: string;
  policy?: BackrowPlanningPolicy<Card, Decision>;
}

function hasValue<Value>(
  value: Value | null | undefined,
): value is Value {
  return value !== undefined && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value as number);
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
  return result === false ||
    (result as BackrowDecision | null | undefined)?.ok === false ||
    (result as BackrowDecision | null | undefined)?.shouldSet === false ||
    (result as BackrowDecision | null | undefined)?.yes === false;
}

function isUsedIndex(
  indices: ReadonlySet<number | undefined> | null | undefined,
  index: number,
): boolean {
  return typeof indices?.has === "function" && indices.has(index);
}

/**
 * Build set_spell_trap actions for caller-approved backrow candidates.
 * Strategy-specific policy stays in the caller; this helper only handles
 * shared zone capacity, hand-index filtering, and action shape.
 */
export function getGenericSetBackrowActions<Card extends BackrowPlanningCard, Decision extends BackrowPolicyDecision>(
  input: GenericSetBackrowInput<Card, Decision> & {
    policy: BackrowPlanningPolicy<Card, Decision> & {shouldSet: NonNullable<BackrowPlanningPolicy<Card, Decision>["shouldSet"]>};
  },
): SetSpellTrapAIAction[];
export function getGenericSetBackrowActions<Card extends BackrowPlanningCard = BackrowPlanningCard>(
  input?: GenericSetBackrowInput<Card, true> & {
    policy?: Omit<BackrowPlanningPolicy<Card, true>, "shouldSet"> & {shouldSet?: undefined};
  },
): SetSpellTrapAIAction[];
export function getGenericSetBackrowActions<Card extends BackrowPlanningCard, Decision extends BackrowPolicyDecision>({
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
}: GenericSetBackrowInput<Card, Decision> = {}): SetSpellTrapAIAction[] {
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
      setDecision: setDecision as Decision,
    };

    const policyPriority =
      typeof policy.getPriority === "function"
        ? policy.getPriority(card, context)
        : (setDecision as BackrowDecision | null | undefined)?.priority;
    const priority = isFiniteNumber(policyPriority)
      ? policyPriority
      : basePriority;

    const policyReason =
      typeof policy.getReason === "function"
        ? policy.getReason(card, context)
        : (setDecision as BackrowDecision | null | undefined)?.reason;
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
