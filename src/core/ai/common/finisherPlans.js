export function clampScore100(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function toActionPriority(score100) {
  return clampScore100(score100) / 10;
}

export function createFinisherPlan({
  kind,
  targetName,
  score100,
  reason,
  preserveHollowsInGY = false,
  preserveResources = null,
  details = {},
}) {
  const normalizedScore = clampScore100(score100);
  const plan = {
    kind,
    targetName,
    score100: normalizedScore,
    actionPriority: toActionPriority(normalizedScore),
    reason,
    preserveHollowsInGY,
    details,
  };

  if (Array.isArray(preserveResources) && preserveResources.length > 0) {
    plan.preserveResources = [...preserveResources];
  }

  return plan;
}

export function rankFinisherPlans(plans = []) {
  return (plans || [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => (b.score100 || 0) - (a.score100 || 0));
}

export function getBestFinisherPlan(plans = [], predicateOrKind = null) {
  const ranked = rankFinisherPlans(plans);
  if (!predicateOrKind) return ranked[0] || null;

  const predicate =
    typeof predicateOrKind === "function"
      ? predicateOrKind
      : (plan) => plan?.kind === predicateOrKind;

  return ranked.find(predicate) || null;
}
