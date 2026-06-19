import {
  fieldHasTributeValue,
  selectTributeIndicesByValue,
} from "../../game/summon/tributeValue.js";

export function getTributeRequirementFor(card, playerState) {
  let tributesNeeded = 0;
  if (card.level >= 5 && card.level <= 6) tributesNeeded = 1;
  else if (card.level >= 7) tributesNeeded = 2;

  let usingAlt = false;
  const alt = card.altTribute;
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
    if (alt.tributes < tributesNeeded) {
      tributesNeeded = alt.tributes;
      usingAlt = true;
    }
  }

  return { tributesNeeded, usingAlt, alt };
}

export function selectBestTributes(
  field,
  tributesNeeded,
  cardToSummon,
  context = {},
  policy = {},
) {
  if (
    tributesNeeded <= 0 ||
    !fieldHasTributeValue(field || [], tributesNeeded, cardToSummon)
  ) {
    return [];
  }

  const evaluationContext = context.evaluationContext || {};
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

export function evaluateTributeSummonCost(
  cardToSummon,
  tributes,
  context = {},
  policy = {},
) {
  if (!Array.isArray(tributes) || tributes.length === 0) {
    return { ok: true, penalty: 0, reason: "no tribute cost" };
  }

  const evaluationContext = context.evaluationContext || {};
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
