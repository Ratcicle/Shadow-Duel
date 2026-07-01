import { buildPrioritizedAction } from "./actionGeneration.js";
import { canSetReactiveBackrowNow } from "./phaseTiming.js";

function hasValue(value) {
  return value !== undefined && value !== null;
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function defaultAcceptsBackrowCard(card) {
  return (
    card?.cardKind === "trap" ||
    (card?.cardKind === "spell" && card?.subtype === "quick")
  );
}

function isRejected(result) {
  return (
    result === false ||
    result?.ok === false ||
    result?.shouldSet === false ||
    result?.yes === false
  );
}

function isUsedIndex(indices, index) {
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
} = {}) {
  if ((spellTrap || []).length >= maxBackrow) return [];

  const actions = [];
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
        : setDecision?.priority;
    const priority = isFiniteNumber(policyPriority)
      ? policyPriority
      : basePriority;

    const policyReason =
      typeof policy.getReason === "function"
        ? policy.getReason(card, context)
        : setDecision?.reason;
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
