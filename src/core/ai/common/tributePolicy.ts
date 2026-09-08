import {
  fieldHasTributeValue,
  selectTributeIndicesByValue,
} from "../../game/summon/tributeValue.js";
import type { TributeCardView } from "../../game/summon/tributeValue.js";

interface TributeAlternative {
  type?: string;
  requiresName?: string | null;
  tributes?: number;
}

interface TributeSummonCard extends TributeCardView {
  altTribute?: TributeAlternative | null;
}

interface TributePlayerState {
  field?: readonly TributeSummonCard[];
}

interface TributeEvaluationContext<Evaluation extends object = object> {
  evaluationContext?: Evaluation;
}

interface TributeSelectionPolicy<Card extends TributeSummonCard, Evaluation extends object> {
  evaluateCardValue?(
    card: Card,
    evaluationContext: Evaluation,
    context: TributeEvaluationContext<Evaluation> & {
      cardToSummon: Card;
      fieldIndex: number;
    },
  ): number;
}

interface TributePayoff {
  ok: boolean;
  reason?: string;
}

interface TributeCostPolicy<Card extends TributeSummonCard, Evaluation extends object> {
  isProtectedTribute?(
    card: Card,
    evaluationContext: Evaluation,
    context: TributeEvaluationContext<Evaluation>,
  ): boolean;
  evaluateSummonPayoff?(
    cardToSummon: Card,
    tributes: readonly Card[],
    context: TributeEvaluationContext<Evaluation>,
  ): TributePayoff;
}

export function getTributeRequirementFor<Card extends TributeSummonCard>(
  card: Card,
  playerState: TributePlayerState,
) {
  let tributesNeeded = 0;
  if ((card.level as number) >= 5 && (card.level as number) <= 6) tributesNeeded = 1;
  else if ((card.level as number) >= 7) tributesNeeded = 2;

  let usingAlt = false;
  const alt: Card["altTribute"] = card.altTribute;
  if (
    alt?.type === "no_tribute_if_empty_field" &&
    (playerState.field?.length || 0) === 0 &&
    tributesNeeded > 0
  ) {
    tributesNeeded = 0;
    usingAlt = true;
  }
  if (
    alt &&
    playerState.field?.some((c) => c && c.name === alt.requiresName)
  ) {
    if (alt.tributes! < tributesNeeded) {
      tributesNeeded = alt.tributes!;
      usingAlt = true;
    }
  }

  return { tributesNeeded, usingAlt, alt };
}

export function selectBestTributes<Card extends TributeSummonCard, Evaluation extends object = object>(
  field: readonly Card[],
  tributesNeeded: number,
  cardToSummon: Card,
  context: TributeEvaluationContext<Evaluation> = {},
  policy: TributeSelectionPolicy<Card, Evaluation> = {},
): number[] {
  if (
    tributesNeeded <= 0 ||
    !fieldHasTributeValue(field || [], tributesNeeded, cardToSummon)
  ) {
    return [];
  }

  const evaluationContext = context.evaluationContext || {} as Evaluation;
  return selectTributeIndicesByValue(field || [], tributesNeeded, cardToSummon, {
    scoreCard: (monster, index) =>
      policy.evaluateCardValue
        ? policy.evaluateCardValue(monster, evaluationContext, {
            ...context,
            cardToSummon,
            fieldIndex: index,
          })
        : 0,
  });
}

export function evaluateTributeSummonCost<Card extends TributeSummonCard, Evaluation extends object = object>(
  cardToSummon: Card,
  tributes: readonly Card[],
  context: TributeEvaluationContext<Evaluation> = {},
  policy: TributeCostPolicy<Card, Evaluation> = {},
) {
  if (!Array.isArray(tributes as readonly Card[]) || tributes.length === 0) {
    return { ok: true, penalty: 0, reason: "no tribute cost" };
  }

  const evaluationContext = context.evaluationContext || {} as Evaluation;
  const protectedTributes = tributes.filter((card) =>
    policy.isProtectedTribute
      ? policy.isProtectedTribute(card, evaluationContext, context)
      : false,
  );
  if (protectedTributes.length === 0) {
    return { ok: true, penalty: 0, reason: "tributes are expendable enough" };
  }

  const payoff = policy.evaluateSummonPayoff
    ? policy.evaluateSummonPayoff(cardToSummon, tributes, context)
    : { ok: false, reason: "no immediate tactical payoff" };
  if (payoff.ok) {
    return {
      ok: true,
      penalty: -2 * protectedTributes.length,
      reason: payoff.reason,
      protectedTributes,
    };
  }

  return {
    ok: false,
    penalty: 0,
    reason: `Preserve ${protectedTributes.map((card) => card.name).join(", ")}: ${
      cardToSummon?.name || "summon"
    } has ${payoff.reason}`,
    protectedTributes,
  };
}
