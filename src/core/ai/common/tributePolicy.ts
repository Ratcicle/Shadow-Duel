import {
  fieldHasTributeValue,
  getNormalTributeRequirement,
  selectTributeIndicesByValue,
} from "../../game/summon/tributeValue.js";
import type { TributeCardView } from "../../game/summon/tributeValue.js";
import type { AlternateTributeDefinition } from "../../contracts/cards.js";
import type { AiCardInput, AiPlayerInput, AiStateInput } from "../../contracts/aiState.js";
import { canMoveCardToZone } from "./zones.js";

/** Preserve policy ranking while excluding costs that cannot leave their current field. */
export function selectPayableTributes<Card extends AiCardInput>(
  player: AiPlayerInput,
  field: readonly Card[],
  state: Pick<AiStateInput, "bot" | "player">,
  select: (candidates: Card[]) => readonly number[],
): { candidates: Card[]; indices: number[] } {
  const candidates = field.filter(card => canMoveCardToZone(player, card, "graveyard", player, { state }));
  const indices = select(candidates).flatMap(index => {
    const card = Number.isInteger(index) ? candidates[index] : undefined;
    return card ? [field.indexOf(card)] : [];
  });
  return { candidates, indices };
}

interface TributeSummonCard extends TributeCardView {
  requiredTributes?: number | null;
  altTribute?: AlternateTributeDefinition | null;
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
  // Preserve the broad read-only policy views while asking the runtime's
  // canonical query for the requirement; no summon or material choice occurs.
  return getNormalTributeRequirement({
    level: card.level,
    altTribute: card.altTribute ?? null,
    ...(card.requiredTributes !== undefined ? { requiredTributes: card.requiredTributes } : {}),
  }, (playerState.field || []).map(monster => ({
    name: monster.name,
    type: monster.type,
    isFacedown: monster.isFacedown,
    ...(monster.types ? { types: [...monster.types] } : {}),
  })));
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
