import type { GameCard } from "../../contracts/cards.js";
import type { SimulatedCardState } from "../../contracts/aiState.js";

const DEFAULT_RESOURCE_ZONES = ["hand", "field", "graveyard"];

export type ResourceAnalysis<Card extends object = SimulatedCardState | GameCard> = Partial<Record<"hand" | "field" | "graveyard" | "deck" | "spellTrap" | "extraDeck" | "banished" | "oppField", Card[]>>;
type ResourceCard<Analysis extends ResourceAnalysis<object>> = NonNullable<Analysis[keyof ResourceAnalysis]>[number];

type ResourceCounts = Record<string, number>;

interface ResourceContext<Analysis extends ResourceAnalysis<object>, Enablers, Potential = unknown> {
  analysis: Analysis;
  countsByZone: ResourceCounts;
  totalResources: number;
  enablers: Enablers;
  accessibleByZone?: ResourceCounts;
  totalAccessibleResources?: number;
  strandedByZone?: ResourceCounts;
  totalStrandedResources?: number;
  potential?: Potential;
}

interface ResourceAccessResult {
  accessibleByZone?: ResourceCounts;
  totalAccessibleResources?: number;
  totalAccessible?: number;
  strandedByZone?: ResourceCounts;
  totalStrandedResources?: number;
  totalStranded?: number;
}

interface ResourceProfile<Analysis extends ResourceAnalysis<object>, Enablers extends object, Potential, Flags extends object> {
  zones?: readonly string[];
  resourceName?: string;
  matchResource?(card: ResourceCard<Analysis>): boolean;
  getEnablers?(analysis: Analysis, context: { countsByZone: ResourceCounts; totalResources: number }): Enablers;
  computeAccessibility?(context: ResourceContext<Analysis, Enablers>): ResourceAccessResult | null | undefined;
  computePotential?(context: ResourceContext<Analysis, Enablers>): Potential;
  computeFlags?(context: ResourceContext<Analysis, Enablers, Potential> & { totalAccessibleResources: number; totalStrandedResources: number }): Flags | null | undefined;
}

function toZoneList(zones: readonly string[] | null | undefined): readonly string[] {
  return Array.isArray(zones) && zones.length > 0 ? zones : DEFAULT_RESOURCE_ZONES;
}

function getCardsInZone<Card extends object>(
  analysis: ResourceAnalysis<Card> = {},
  zone: string,
): Card[] {
  const cards = analysis?.[zone as keyof ResourceAnalysis];
  return Array.isArray(cards) ? cards : [];
}

function sumObjectValues(values: ResourceCounts = {}): number {
  return Object.values(values).reduce((total, value) => total + (Number(value) || 0), 0);
}

export function countResourceByZone<Card extends object>(
  analysis: ResourceAnalysis<Card> = {},
  matchResource: ((card: Card) => boolean) | null | undefined,
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

export function analyzeResourceEconomy<Analysis extends ResourceAnalysis<object> = ResourceAnalysis, Enablers extends object = object, Potential = unknown, Flags extends object = object>(
  analysis: Analysis = {} as Analysis,
  profile: ResourceProfile<Analysis, Enablers, Potential, Flags> = {},
) {
  const zones = toZoneList(profile.zones);
  const countsByZone = countResourceByZone(analysis, profile.matchResource, zones);
  const totalResources = sumObjectValues(countsByZone);
  const enablers = typeof profile.getEnablers === "function"
    ? profile.getEnablers(analysis, { countsByZone, totalResources })
    : {} as Enablers;

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
      }) || {} as Flags
    : {} as Flags;

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
