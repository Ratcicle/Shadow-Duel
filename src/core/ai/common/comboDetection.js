const DEFAULT_ZONE_NAMES = [
  "hand",
  "field",
  "graveyard",
  "deck",
  "extraDeck",
  "spellTrap",
  "banished",
];

export function createZoneIndex(analysis = {}, zoneNames = DEFAULT_ZONE_NAMES) {
  const zones = {};
  const idsByZone = {};
  const namesByZone = {};

  for (const zone of zoneNames) {
    const cards = Array.isArray(analysis?.[zone]) ? analysis[zone] : [];
    zones[zone] = cards;
    idsByZone[zone] = cards.map((card) => card?.id).filter(Boolean);
    namesByZone[zone] = cards.map((card) => card?.name).filter(Boolean);
  }

  return { analysis, zones, idsByZone, namesByZone };
}

export function getZoneCards(index, zone) {
  return index?.zones?.[zone] || [];
}

export function hasCardId(index, zone, id) {
  return (index?.idsByZone?.[zone] || []).includes(id);
}

export function countCardId(index, zone, id) {
  return (index?.idsByZone?.[zone] || []).filter((candidateId) => candidateId === id)
    .length;
}

export function hasCardName(index, zone, name) {
  return (index?.namesByZone?.[zone] || []).includes(name);
}

export function countCardName(index, zone, name) {
  return (index?.namesByZone?.[zone] || []).filter(
    (candidateName) => candidateName === name,
  ).length;
}

export function hasCardNameInZones(index, zones = [], name) {
  return (zones || []).some((zone) => hasCardName(index, zone, name));
}

export function countCardNameAcrossZones(index, zones = [], name) {
  return (zones || []).reduce(
    (total, zone) => total + countCardName(index, zone, name),
    0,
  );
}

export function countMatching(index, zone, predicate) {
  if (typeof predicate !== "function") return 0;
  return getZoneCards(index, zone).filter((card) => card && predicate(card)).length;
}

export function countAcrossZones(index, zones = [], predicate) {
  if (typeof predicate !== "function") return 0;
  return (zones || []).reduce(
    (total, zone) => total + countMatching(index, zone, predicate),
    0,
  );
}

export function findComboByName(comboDatabase = [], name) {
  return (comboDatabase || []).find((combo) => combo?.name === name) || null;
}

export function createDetectedCombo({
  combo,
  ready = false,
  missing = [],
  priority = 0,
  ...extra
} = {}) {
  return {
    combo,
    ready,
    missing: Array.isArray(missing) ? missing : [missing].filter(Boolean),
    priority,
    ...extra,
  };
}

export function createAvailableCombo({
  combo,
  name = null,
  priority = undefined,
  action = null,
  ...extra
} = {}) {
  const comboName = name || combo?.name || null;
  return {
    name: comboName,
    priority: Number.isFinite(priority) ? priority : combo?.priority || 0,
    ...(action ? { action } : {}),
    ...extra,
  };
}

export function finalizeDetectedCombos(detected = []) {
  return (detected || [])
    .filter((entry) => entry?.combo)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
}
