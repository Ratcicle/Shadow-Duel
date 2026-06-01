export function buildCostPreferences({
  archetype = null,
  hand = [],
  field = [],
  protectedNames = [],
  preferNames = [],
  preserveNames = [],
  forceNames = [],
  offensivePayoffNames = [],
  preserveLastOffensivePayoff = true,
  availableOffensivePayoffs,
  extra = {},
} = {}) {
  const preferSet = new Set(preferNames || []);
  const preserveSet = new Set(preserveNames || []);

  for (const card of [...(hand || []), ...(field || [])]) {
    if (card?.name && protectedNames.includes(card.name)) {
      preserveSet.add(card.name);
    }
  }

  const payoffNames = [...(offensivePayoffNames || [])];
  const computedPayoffs = [...(hand || []), ...(field || [])].filter((card) =>
    payoffNames.includes(card?.name),
  ).length;

  const result = {
    archetype,
    preferNames: [...preferSet],
    preserveNames: [...preserveSet],
    offensivePayoffNames: payoffNames,
    preserveLastOffensivePayoff,
    availableOffensivePayoffs: Number.isFinite(availableOffensivePayoffs)
      ? availableOffensivePayoffs
      : computedPayoffs,
    ...extra,
  };

  if (Array.isArray(forceNames) && forceNames.length > 0) {
    result.forceNames = [...forceNames];
  }

  return result;
}

export function buildTargetPreferences({
  costPreferences = null,
  targetProfiles = {},
} = {}) {
  const preferences = {};
  for (const [key, profile] of Object.entries(targetProfiles || {})) {
    const resolved =
      typeof profile === "function" ? profile(costPreferences) : profile;
    if (resolved) preferences[key] = resolved;
  }
  return preferences;
}

export function buildAutoActivationContext({
  zone = null,
  fromHand = false,
  sourceZone = zone,
  activationZone = zone,
  autoSelectTargets = true,
  autoSelectSingleTarget = true,
  includeAutoSelectTargets = true,
  includeActionContext = true,
  logTargets = false,
  actionContext = {},
  costPreferences = null,
  targetPreferences = null,
  specialSummonPositions = null,
  fusionPositions = null,
  fusionPreferences = null,
  extra = {},
} = {}) {
  const mergedActionContext = {
    ...(actionContext || {}),
  };

  if (costPreferences) mergedActionContext.costPreferences = costPreferences;
  if (targetPreferences) mergedActionContext.targetPreferences = targetPreferences;
  if (specialSummonPositions) {
    mergedActionContext.specialSummonPositions = specialSummonPositions;
  }
  if (fusionPositions) mergedActionContext.fusionPositions = fusionPositions;
  if (fusionPreferences) mergedActionContext.fusionPreferences = fusionPreferences;

  const result = {
    fromHand,
    activationZone,
    sourceZone,
    autoSelectSingleTarget,
    logTargets,
    ...extra,
  };

  if (includeAutoSelectTargets) {
    result.autoSelectTargets = autoSelectTargets;
  }

  if (includeActionContext) {
    result.actionContext = mergedActionContext;
  }

  return result;
}

export function mergeActivationActionContext(baseContext = {}, patch = {}) {
  return {
    ...(baseContext || {}),
    actionContext: {
      ...(baseContext?.actionContext || {}),
      ...(patch || {}),
    },
  };
}

export function buildActivationContext({
  costPreferences,
  targetPreferences = {},
  specialSummonPositions = null,
  fusionPositions = null,
  fusionPreferences = null,
  autoSelectTargets = true,
  autoSelectSingleTarget = true,
  includeAutoSelectTargets = true,
  actionContext = {},
  ...rest
} = {}) {
  const mergedActionContext = {
    ...actionContext,
    costPreferences,
    targetPreferences,
  };

  if (specialSummonPositions) {
    mergedActionContext.specialSummonPositions = specialSummonPositions;
  }
  if (fusionPositions) mergedActionContext.fusionPositions = fusionPositions;
  if (fusionPreferences) mergedActionContext.fusionPreferences = fusionPreferences;

  const result = {
    autoSelectSingleTarget,
    ...rest,
    actionContext: mergedActionContext,
  };

  if (includeAutoSelectTargets) {
    result.autoSelectTargets = autoSelectTargets;
  }

  return result;
}
