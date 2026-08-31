interface FusionEvaluation {
  target?: string | null;
  priority?: number;
  reason?: string | null;
  plan?: unknown;
}

interface FusionPreference {
  preferredNames: string[];
  scoresByName: Record<string, number>;
  reason: string | null;
}

interface FusionContext {
  actionContext?: {
    fusionPreferences?: FusionPreference | null;
  };
}

export function buildFusionPreference({
  target,
  priority = 0,
  reason = null,
}: FusionEvaluation = {}): FusionPreference | null {
  if (!target) return null;
  return {
    preferredNames: [target],
    scoresByName: {
      [target]: priority || 0,
    },
    reason,
  };
}

export function withFusionPreferences<Context extends FusionContext>(
  baseContext: Context | null | undefined,
  fusionEval: FusionEvaluation | null | undefined,
): Context | FusionContext | null | undefined {
  if (!fusionEval?.target) return baseContext;
  return {
    ...(baseContext || {}),
    actionContext: {
      ...(baseContext?.actionContext || {}),
      fusionPreferences: buildFusionPreference({
        target: fusionEval.target,
        priority: fusionEval.priority,
        reason: fusionEval.reason,
        plan: fusionEval.plan,
      }),
    },
  };
}

export function getFusionPreferenceScore(
  context: FusionContext | null | undefined,
  targetName: string | null | undefined,
): number | undefined {
  if (!targetName) return undefined;
  return context?.actionContext?.fusionPreferences?.scoresByName?.[targetName];
}
