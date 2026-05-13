export function buildFusionPreference({ target, priority = 0, reason = null } = {}) {
  if (!target) return null;
  return {
    preferredNames: [target],
    scoresByName: {
      [target]: priority || 0,
    },
    reason,
  };
}

export function withFusionPreferences(baseContext, fusionEval) {
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

export function getFusionPreferenceScore(context, targetName) {
  if (!targetName) return undefined;
  return context?.actionContext?.fusionPreferences?.scoresByName?.[targetName];
}
