import type { SimulatedCardState } from "../../contracts/aiState.js";

const DEFAULT_RESOURCE_ZONES = ["hand", "field", "graveyard"];

type ResourceAnalysis = Partial<Record<string, SimulatedCardState[]>>;
type ResourceCounts = Record<string, number>;

interface ResourceContext {
  analysis: ResourceAnalysis;
  countsByZone: ResourceCounts;
  totalResources: number;
  enablers: object;
  accessibleByZone?: ResourceCounts;
  totalAccessibleResources?: number;
  strandedByZone?: ResourceCounts;
  totalStrandedResources?: number;
  potential?: unknown;
}

interface ResourceAccessResult {
  accessibleByZone?: ResourceCounts;
  totalAccessibleResources?: number;
  totalAccessible?: number;
  strandedByZone?: ResourceCounts;
  totalStrandedResources?: number;
  totalStranded?: number;
}

interface ResourceProfile {
  zones?: readonly string[];
  resourceName?: string;
  matchResource?(card: SimulatedCardState): boolean;
  getEnablers?(analysis: ResourceAnalysis, context: Omit<ResourceContext, "analysis" | "enablers">): object;
  computeAccessibility?(context: ResourceContext): ResourceAccessResult | null | undefined;
  computePotential?(context: ResourceContext): unknown;
  computeFlags?(context: ResourceContext): object | null | undefined;
}

function toZoneList(zones: readonly string[] | null | undefined): readonly string[] {
  return Array.isArray(zones) && zones.length > 0 ? zones : DEFAULT_RESOURCE_ZONES;
}

function getCardsInZone(
  analysis: ResourceAnalysis = {},
  zone: string,
): SimulatedCardState[] {
  const cards = analysis?.[zone];
  return Array.isArray(cards) ? cards : [];
}

function sumObjectValues(values: ResourceCounts = {}): number {
  return Object.values(values).reduce((total, value) => total + (Number(value) || 0), 0);
}

export function countResourceByZone(
  analysis: ResourceAnalysis = {},
  matchResource: ((card: SimulatedCardState) => boolean) | null | undefined,
  zones: readonly string[] = DEFAULT_RESOURCE_ZONES,
): ResourceCounts {
  const zoneNames = toZoneList(zones);
  const matcher = typeof matchResource === "function" ? matchResource : () => false;
  const countsByZone: ResourceCounts = {};

  for (const zone of zoneNames) {
    countsByZone[zone] = getCardsInZone(analysis, zone).filter((card) => card && matcher(card)).length;
  }

  return countsByZone;
}

export function analyzeResourceEconomy(
  analysis: ResourceAnalysis = {},
  profile: ResourceProfile = {},
) {
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
