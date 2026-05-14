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

export function buildActivationContext({
  costPreferences,
  targetPreferences = {},
  autoSelectTargets = true,
  autoSelectSingleTarget = true,
  includeAutoSelectTargets = true,
  actionContext = {},
  ...rest
} = {}) {
  const result = {
    autoSelectSingleTarget,
    ...rest,
    actionContext: {
      ...actionContext,
      costPreferences,
      targetPreferences,
    },
  };

  if (includeAutoSelectTargets) {
    result.autoSelectTargets = autoSelectTargets;
  }

  return result;
}
