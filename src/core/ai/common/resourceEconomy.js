const DEFAULT_RESOURCE_ZONES = ["hand", "field", "graveyard"];

function toZoneList(zones) {
  return Array.isArray(zones) && zones.length > 0 ? zones : DEFAULT_RESOURCE_ZONES;
}

function getCardsInZone(analysis = {}, zone) {
  const cards = analysis?.[zone];
  return Array.isArray(cards) ? cards : [];
}

function sumObjectValues(values = {}) {
  return Object.values(values).reduce((total, value) => total + (Number(value) || 0), 0);
}

export function countResourceByZone(analysis = {}, matchResource, zones = DEFAULT_RESOURCE_ZONES) {
  const zoneNames = toZoneList(zones);
  const matcher = typeof matchResource === "function" ? matchResource : () => false;
  const countsByZone = {};

  for (const zone of zoneNames) {
    countsByZone[zone] = getCardsInZone(analysis, zone).filter((card) => card && matcher(card)).length;
  }

  return countsByZone;
}

export function analyzeResourceEconomy(analysis = {}, profile = {}) {
  const zones = toZoneList(profile.zones);
  const countsByZone = countResourceByZone(analysis, profile.matchResource, zones);
  const totalResources = sumObjectValues(countsByZone);
  const enablers = typeof profile.getEnablers === "function"
    ? profile.getEnablers(analysis, { countsByZone, totalResources })
    : {};

  const accessResult = typeof profile.computeAccessibility === "function"
    ? profile.computeAccessibility({
        analysis,
        countsByZone,
        totalResources,
        enablers,
      }) || {}
    : {};

  const accessibleByZone = {
    ...(accessResult.accessibleByZone || {}),
  };
  const totalAccessibleResources =
    accessResult.totalAccessibleResources ??
    accessResult.totalAccessible ??
    sumObjectValues(accessibleByZone);

  const strandedByZone = {
    ...(accessResult.strandedByZone || {}),
  };
  const totalStrandedResources =
    accessResult.totalStrandedResources ??
    accessResult.totalStranded ??
    sumObjectValues(strandedByZone);

  const potential = typeof profile.computePotential === "function"
    ? profile.computePotential({
        analysis,
        countsByZone,
        totalResources,
        enablers,
        accessibleByZone,
        totalAccessibleResources,
        strandedByZone,
        totalStrandedResources,
      })
    : undefined;

  const flags = typeof profile.computeFlags === "function"
    ? profile.computeFlags({
        analysis,
        countsByZone,
        totalResources,
        enablers,
        accessibleByZone,
        totalAccessibleResources,
        strandedByZone,
        totalStrandedResources,
        potential,
      }) || {}
    : {};

  return {
    resourceName: profile.resourceName || "resource",
    countsByZone,
    totalResources,
    enablers,
    accessibleByZone,
    totalAccessibleResources,
    strandedByZone,
    totalStrandedResources,
    potential,
    flags,
  };
}
