import type { SimulatedCardState } from "../../contracts/aiState.js";

const DEFAULT_ZONE_NAMES = [
  "hand",
  "field",
  "graveyard",
  "deck",
  "extraDeck",
  "spellTrap",
  "banished",
];

interface ZoneAnalysis {
  [zone: string]: SimulatedCardState[] | unknown;
}

interface ZoneIndex {
  analysis: ZoneAnalysis;
  zones: Record<string, SimulatedCardState[]>;
  idsByZone: Record<string, Array<number | undefined>>;
  namesByZone: Record<string, string[]>;
}

interface ComboDefinition {
  name?: string | null;
  priority?: number;
}

export interface DetectedCombo {
  combo?: ComboDefinition | null;
  ready: boolean;
  missing: unknown[];
  priority: number;
}

export function createZoneIndex<Analysis extends object = ZoneAnalysis>(
  analysis: Analysis = {} as Analysis,
  zoneNames: readonly string[] = DEFAULT_ZONE_NAMES,
): ZoneIndex {
  const zones: Record<string, SimulatedCardState[]> = {};
  const idsByZone: Record<string, Array<number | undefined>> = {};
  const namesByZone: Record<string, string[]> = {};

  for (const zone of zoneNames) {
    const cards = (Array.isArray((analysis as ZoneAnalysis)?.[zone]) ? (analysis as ZoneAnalysis)[zone] : []) as SimulatedCardState[];
    zones[zone] = cards;
    idsByZone[zone] = cards.map((card) => card?.id).filter(Boolean);
    namesByZone[zone] = cards.map((card) => card?.name).filter(Boolean) as string[];
  }

  return { analysis: analysis as ZoneAnalysis, zones, idsByZone, namesByZone };
}

export function getZoneCards(index: ZoneIndex | null | undefined, zone: string): SimulatedCardState[] {
  return index?.zones?.[zone] || [];
}

export function hasCardId(index: ZoneIndex | null | undefined, zone: string, id: number): boolean {
  return (index?.idsByZone?.[zone] || []).includes(id);
}

export function countCardId(index: ZoneIndex | null | undefined, zone: string, id: number): number {
  return (index?.idsByZone?.[zone] || []).filter((candidateId) => candidateId === id)
    .length;
}

export function hasCardName(index: ZoneIndex | null | undefined, zone: string, name: string): boolean {
  return (index?.namesByZone?.[zone] || []).includes(name);
}

export function countCardName(index: ZoneIndex | null | undefined, zone: string, name: string): number {
  return (index?.namesByZone?.[zone] || []).filter(
    (candidateName) => candidateName === name,
  ).length;
}

export function hasCardNameInZones(index: ZoneIndex | null | undefined, zones: readonly string[] = [], name: string): boolean {
  return (zones || []).some((zone) => hasCardName(index, zone, name));
}

export function countCardNameAcrossZones(index: ZoneIndex | null | undefined, zones: readonly string[] = [], name: string): number {
  return (zones || []).reduce(
    (total, zone) => total + countCardName(index, zone, name),
    0,
  );
}

export function countMatching(index: ZoneIndex | null | undefined, zone: string, predicate: ((card: SimulatedCardState) => boolean) | null | undefined): number {
  if (typeof predicate !== "function") return 0;
  return getZoneCards(index, zone).filter((card) => card && predicate(card)).length;
}

export function countAcrossZones(index: ZoneIndex | null | undefined, zones: readonly string[] = [], predicate: ((card: SimulatedCardState) => boolean) | null | undefined): number {
  if (typeof predicate !== "function") return 0;
  return (zones || []).reduce(
    (total, zone) => total + countMatching(index, zone, predicate),
    0,
  );
}

export function findComboByName<Combo extends ComboDefinition>(comboDatabase: readonly Combo[] = [], name: string): Combo | null {
  return (comboDatabase || []).find((combo) => combo?.name === name) || null;
}

export function createDetectedCombo<Combo extends ComboDefinition, Extra extends object = object>({
  combo,
  ready = false,
  missing = [],
  priority = 0,
  ...extra
}: (Partial<Omit<DetectedCombo, "combo">> & { combo?: Combo | null } & Extra) = {} as Partial<Omit<DetectedCombo, "combo">> & { combo?: Combo | null } & Extra) {
  return {
    combo,
    ready,
    missing: Array.isArray(missing) ? missing : [missing].filter(Boolean),
    priority,
    ...extra,
  };
}

export function createAvailableCombo<Action extends object = object, Extra extends object = object>({
  combo,
  name = null,
  priority = undefined,
  action = null,
  ...extra
}: {
  combo?: ComboDefinition | null;
  name?: string | null;
  priority?: number;
  action?: Action | null;
} & Extra = {} as Extra) {
  const comboName = name || combo?.name || null;
  return {
    name: comboName,
    priority: Number.isFinite(priority) ? priority : combo?.priority || 0,
    ...(action ? { action } : {}),
    ...extra,
  };
}

export function finalizeDetectedCombos<Combo extends DetectedCombo>(
  detected: readonly (Combo | null | undefined)[] = [],
): Combo[] {
  return ((detected || []).filter((entry) => entry?.combo) as Combo[])
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
}
