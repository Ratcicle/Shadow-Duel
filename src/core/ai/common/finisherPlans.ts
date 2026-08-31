interface FinisherPlanInput {
  kind: string;
  targetName?: string | null;
  score100: number;
  reason?: string | null;
  preserveHollowsInGY?: boolean;
  preserveResources?: readonly string[] | null;
  details?: unknown;
}

export interface FinisherPlan {
  kind: string;
  targetName?: string | null;
  score100: number;
  actionPriority: number;
  reason?: string | null;
  preserveHollowsInGY: boolean;
  preserveResources?: string[];
  details: unknown;
}

export function clampScore100(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function toActionPriority(score100: number): number {
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
}: FinisherPlanInput): FinisherPlan {
  const normalizedScore = clampScore100(score100);
  const plan: FinisherPlan = {
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

export function rankFinisherPlans(
  plans: readonly (FinisherPlan | null | undefined)[] = [],
): FinisherPlan[] {
  return (plans || [])
    .filter((plan): plan is FinisherPlan => plan !== null && plan !== undefined)
    .slice()
    .sort((a, b) => (b.score100 || 0) - (a.score100 || 0));
}

export function getBestFinisherPlan(
  plans: readonly (FinisherPlan | null | undefined)[] = [],
  predicateOrKind: ((plan: FinisherPlan) => boolean) | string | null = null,
): FinisherPlan | null {
  const ranked = rankFinisherPlans(plans);
  if (!predicateOrKind) return ranked[0] || null;

  const predicate =
    typeof predicateOrKind === "function"
      ? predicateOrKind
      : (plan: FinisherPlan) => plan?.kind === predicateOrKind;

  return ranked.find(predicate) || null;
}
