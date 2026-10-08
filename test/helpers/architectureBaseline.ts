import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Card from "../../src/core/Card.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { PLANNING_CARD_FIELDS, PLANNING_PLAYER_FIELDS, PLANNING_STATE_FIELDS, PLANNING_ZONES } from "../../src/core/ai/common/stateFingerprint.js";
import { getBotDeckList, getBotExtraDeckList } from "../../src/core/bot/presets.js";
import type { BotArchetypeId } from "../../src/core/contracts/bot.js";
import type { GameTreeSimulationGameState } from "../../src/core/contracts/aiState.js";
import { cardDefinition, required } from "./fixtures.js";
import { simulationCard, simulationState } from "./simulation.js";

export const ARCHITECTURE_IDS = ["shadowheart", "luminarch", "void", "dragon", "arcanist", "miragebound", "bloomrot", "burningwest", "techzero"] as const satisfies readonly BotArchetypeId[];
export const ARCHITECTURE_SCENARIOS = ["starter", "scarce", "full_field", "defense", "finisher", "recovery"] as const;
export type ArchitectureScenario = typeof ARCHITECTURE_SCENARIOS[number];
type Seat = "bot" | "player";
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type References = ReadonlyMap<number | string, string>;

export function createArchitectureEncoding() {
  const blocks: Record<string, unknown> = {};
  const pack = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    const hash = createHash("sha256").update(JSON.stringify(value)).digest("hex");
    if (Object.hasOwn(blocks, hash)) return { $block: hash };
    const packed = Array.isArray(value) ? value.map(pack)
      : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, pack(entry)]));
    if (JSON.stringify(value).length < 256) return packed;
    blocks[hash] = packed;
    return { $block: hash };
  };
  return { blocks, pack };
}

export function expandArchitectureValue(value: unknown, blocks: object): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(entry => expandArchitectureValue(entry, blocks));
  const key: unknown = Reflect.get(value, "$block");
  if (typeof key === "string" && Object.keys(value).length === 1) {
    assert.ok(Object.hasOwn(blocks, key), `Missing corpus block ${key}`);
    return expandArchitectureValue(Reflect.get(blocks, key), blocks);
  }
  return Object.fromEntries(Object.entries(value).map(([property, entry]) => [property, expandArchitectureValue(entry, blocks)]));
}

export function architectureDifferences(before: unknown, after: unknown, path = ""): Array<{ path: string; before: unknown; after: unknown }> {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length)
    return before.flatMap((value, index) => architectureDifferences(value, after[index], `${path}[${index}]`));
  if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(key =>
      architectureDifferences(Reflect.get(before, key), Reflect.get(after, key), path ? `${path}.${key}` : key));
  }
  const summarize = (value: unknown): unknown => value && typeof value === "object"
    ? { type: Array.isArray(value) ? "array" : "object", entries: Object.keys(value).length,
      digest: createHash("sha256").update(JSON.stringify(value)).digest("hex") }
    : value === undefined ? { absent: true } : value;
  return [{ path, before: summarize(before), after: summarize(after) }];
}

const PIECES: Record<BotArchetypeId, { starter: number; extender: number; boss: number; support: number; recovery: number }> = {
  shadowheart: { starter: 107, extender: 108, boss: 111, support: 106, recovery: 110 },
  luminarch: { starter: 151, extender: 153, boss: 158, support: 162, recovery: 169 },
  void: { starter: 201, extender: 202, boss: 212, support: 217, recovery: 219 },
  dragon: { starter: 252, extender: 254, boss: 270, support: 262, recovery: 268 },
  arcanist: { starter: 302, extender: 307, boss: 313, support: 301, recovery: 309 },
  miragebound: { starter: 351, extender: 352, boss: 358, support: 354, recovery: 359 },
  bloomrot: { starter: 403, extender: 402, boss: 408, support: 410, recovery: 411 },
  burningwest: { starter: 451, extender: 454, boss: 461, support: 452, recovery: 458 },
  techzero: { starter: 501, extender: 502, boss: 507, support: 518, recovery: 519 },
};

/** Replace only identity-bearing values, never scores or definition IDs. */
export function normalizeArchitectureValue(value: unknown, references: References, key = "", referenceValue = false, ancestors: ReadonlySet<object> = new Set()): JsonValue {
  if (value == null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `Non-finite corpus value at ${key}`);
    return referenceValue || /instanceId|duelCardId|^uid$|^uuid$/i.test(key) ? references.get(value) || `unresolved-instance:${value}` : value;
  }
  if (typeof value === "string") {
    if (references.has(value)) return required(references.get(value));
    // OPT and presence keys sometimes embed a process-global Card identity.
    let result = value;
    for (const [id, label] of references) result = result.replaceAll(`:card:${id}:`, `:card:${label}:`);
    return result;
  }
  if (typeof value !== "object") return null;
  if (ancestors.has(value)) return "[cycle]";
  if (key !== "$unabridgedCard" && typeof Reflect.get(value, "id") === "number" && typeof Reflect.get(value, "cardKind") === "string" && typeof Reflect.get(value, "name") === "string") {
    const complete = normalizeArchitectureValue(pickFields(value, PLANNING_CARD_FIELDS.filter(field => field !== "effects")), references, "$unabridgedCard", false, ancestors);
    // The digest retains EVERY mutable field for comparisons; the readable
    // view avoids repeating catalog metadata/empty flags for every deck card.
    const readable = pickFields(value, ["instanceId", "id", "name", "atk", "def", "level", "position", "fieldSlot", "isFacedown", "locationVersion", "counters", "oncePerTurnUsageByName", "cannotAttackThisTurn", "hasAttacked", "effectsNegated"]);
    return normalizeArchitectureValue({ $card: readable,
      planningDigest: createHash("sha256").update(JSON.stringify(complete)).digest("hex") }, references, "$cardSummary", false, ancestors);
  }
  const next = new Set(ancestors).add(value);
  if (value instanceof Map) return [...value.entries()].map(([mapKey, entry]) => [normalizeArchitectureValue(mapKey, references, key, false, next), normalizeArchitectureValue(entry, references, key, false, next)]).sort((a, b) => JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0])));
  if (value instanceof Set) return [...value].map(entry => normalizeArchitectureValue(entry, references, key, referenceValue, next)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (Array.isArray(value)) return value.map(entry => normalizeArchitectureValue(entry, references, key, referenceValue || /InstanceIds$/.test(key), next));
  const result: Record<string, JsonValue> = {};
  for (const property of Object.keys(value).sort()) {
    const entry: unknown = Reflect.get(value, property);
    if (entry === undefined || typeof entry === "function") continue;
    if (["elapsedMs", "durationMs", "thinkingTime", "searchTimeMs"].includes(property)) continue;
    const referenceContainer = key === "selections" || key === "specialSummons";
    result[property] = normalizeArchitectureValue(entry, references, property, referenceContainer, next);
  }
  return result;
}

function pickFields(source: object, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap(key => {
    const value: unknown = Reflect.get(source, key);
    return value === undefined || typeof value === "function" ? [] : [[key, value]];
  }));
}

/** Full mutable planning projection, omitting repeated static effect definitions. */
export function architectureState(state: GameTreeSimulationGameState | object, references: References): JsonValue {
  const projection = pickFields(state, [...PLANNING_STATE_FIELDS, "_simUnsupportedActions", "_simLuminarch", "_gameTreeActors"]);
  for (const seat of ["bot", "player"] as const) {
    const actor: unknown = Reflect.get(state, seat);
    assert.ok(actor && typeof actor === "object");
    const player = pickFields(actor, PLANNING_PLAYER_FIELDS);
    for (const zone of [...PLANNING_ZONES, "fieldSpell"] as const) {
      const cards: unknown = Reflect.get(actor, zone);
      const projectCard = (card: unknown) => {
        if (!card || typeof card !== "object") return null;
        return pickFields(card, PLANNING_CARD_FIELDS.filter(key => key !== "effects"));
      };
      player[zone] = Array.isArray(cards) ? cards.map(projectCard) : projectCard(cards);
    }
    projection[seat] = player;
  }
  return normalizeArchitectureValue(projection, references);
}

export function createArchitectureFixture(id: BotArchetypeId, scenario: ArchitectureScenario, seat: Seat) {
  const pieces = PIECES[id];
  const remaining = getBotDeckList(id);
  const take = (definitionId: number) => {
    const index = remaining.indexOf(definitionId);
    assert.notEqual(index, -1, `${id}/${scenario}: card ${definitionId} exceeds the preset supply`);
    remaining.splice(index, 1);
    return simulationCard(new Card(cardDefinition(definitionId), seat));
  };
  const handIds = scenario === "recovery" ? [pieces.recovery, pieces.support]
    : scenario === "defense" || scenario === "finisher" ? [pieces.boss, pieces.support]
      : [pieces.starter, pieces.extender, pieces.boss, pieces.support];
  const hand = handIds.map(take);
  const fieldIds = scenario === "full_field"
    ? [...new Set(remaining)].filter(key => cardDefinition(key).cardKind === "monster").slice(0, 5)
    : scenario === "defense" || scenario === "finisher" ? [pieces.starter, pieces.extender]
      : [];
  const field = fieldIds.map(take);
  for (const card of field) {
    card.position = scenario === "defense" ? "defense" : "attack";
    card.isFacedown = false;
    card.lastSummonMethod = "special";
    card.lastSummonedTurn = 3;
    card.enteredFieldTurn = 3;
  }
  const graveyard = scenario === "recovery" ? [pieces.starter, pieces.extender, pieces.boss].map(take) : [];
  const actor = { hand, field, graveyard,
    deck: remaining.map(key => simulationCard(new Card(cardDefinition(key), seat))),
    extraDeck: getBotExtraDeckList(id).map(key => simulationCard(new Card(cardDefinition(key), seat))),
    lp: scenario === "scarce" ? 1800 : scenario === "recovery" ? 3500 : 8000,
    debug: false,
    summonCount: scenario === "scarce" ? 1 : 0,
  };
  const opponentSeat = seat === "bot" ? "player" : "bot";
  const threat = simulationCard(new Card(cardDefinition(scenario === "defense" || scenario === "recovery" ? 270 : 254), opponentSeat));
  threat.position = "attack";
  threat.isFacedown = false;
  const opponent = { field: scenario === "starter" || scenario === "finisher" ? [] : [threat], hand: [], deck: [], extraDeck: [], lp: scenario === "finisher" ? 1200 : 8000 };
  const setup = simulationState({ turn: seat, phase: "main1", turnCounter: 5,
    bot: seat === "bot" ? actor : opponent,
    player: seat === "player" ? actor : opponent,
  });
  const { state } = createGameTreeCopy(setup, seat === "bot" ? setup.bot : setup.player);
  delete state._gameRef;
  const references = new Map<number | string, string>();
  for (const player of [state.bot, state.player]) for (const zone of [...PLANNING_ZONES, "fieldSpell"] as const) {
    const cards = zone === "fieldSpell" ? player.fieldSpell ? [player.fieldSpell] : [] : player[zone];
    cards.forEach((card, index) => {
      for (const key of ["instanceId", "duelCardId", "_instanceId", "uid", "uuid"] as const) {
        const value: unknown = Reflect.get(card, key);
        if (typeof value === "number" || typeof value === "string") references.set(value, `${player.id}:${zone}:${index}:${card.id}`);
      }
    });
  }
  return { state, references, normalizedSetup: architectureState(state, references) };
}
