interface FinisherPlanInput<Details> {
  kind: string;
  targetName?: string | null;
  score100: number;
  reason?: string | null;
  preserveHollowsInGY?: boolean;
  preserveResources?: readonly string[] | null;
  details?: Details;
}

export interface FinisherPlan<Details = unknown> {
  kind: string;
  targetName?: string | null;
  score100: number;
  actionPriority: number;
  reason?: string | null;
  preserveHollowsInGY: boolean;
  preserveResources?: string[];
  details: Details;
}

export function clampScore100(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function toActionPriority(score100: number): number {
  return clampScore100(score100) / 10;
}

export function createFinisherPlan<Details = object>({
  kind,
  targetName,
  score100,
  reason,
  preserveHollowsInGY = false,
  preserveResources = null,
  details = {} as Details,
}: FinisherPlanInput<Details>): FinisherPlan<Details> {
  const normalizedScore = clampScore100(score100);
  const plan: FinisherPlan<Details> = {
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

export function rankFinisherPlans<Plan extends FinisherPlan>(
  plans: readonly (Plan | null | undefined)[] = [],
): Plan[] {
  return ((plans || []).filter(Boolean) as Plan[])
    .slice()
    .sort((a, b) => (b.score100 || 0) - (a.score100 || 0));
}

export function getBestFinisherPlan<Plan extends FinisherPlan>(
  plans: readonly (Plan | null | undefined)[] = [],
  predicateOrKind: ((plan: Plan) => boolean) | string | null = null,
): Plan | null {
  const ranked = rankFinisherPlans(plans);
  if (!predicateOrKind) return ranked[0] || null;

  const predicate =
    typeof predicateOrKind === "function"
      ? predicateOrKind
      : (plan: Plan) => plan?.kind === predicateOrKind;

  return ranked.find(predicate) || null;
}
