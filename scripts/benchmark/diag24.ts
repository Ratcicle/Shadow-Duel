import type Bot from "../../src/core/Bot.js";
import type Game from "../../src/core/Game.js";
import ShadowHeartStrategy from "../../src/core/ai/ShadowHeartStrategy.js";
import { evaluateVisibleBattle } from "../../src/core/ai/common/battleProjection.js";
import { getTributeRequirementFor, shouldSummonMonster } from "../../src/core/ai/shadowheart/summonPolicy.js";
import { getTechZeroRole } from "../../src/core/ai/techzero/knowledge.js";
import type { ArenaDuelResult } from "../../src/core/contracts/arena.js";
import type { GameCard } from "../../src/core/contracts/cards.js";
import type { GamePlayer } from "../../src/core/contracts/player.js";
import { SUMMON_METHODS, type SummonMethod } from "../../src/core/contracts/summon.js";
import { fieldHasTributeValue, getNormalSummonTributeOptions } from "../../src/core/game/summon/tributeValue.js";
import {
  DIAG24_DIFFS_PER_SAMPLE,
  DIAG24_DIVERGENCE_SAMPLES_PER_SEAT,
  DIAG24_RECORD_VERSION,
  DIAG24_SEAT_COUNTERS,
  DIAG24_TIMELINE_LIMITS,
  DIAG24_TURN_LIMIT,
  SEATS,
  canonicalJson,
  classifyFailureCode,
  compareCodeUnits,
  diag24Limits,
  digestOf,
  jsonValue,
  parseDiag24,
  type Counter,
  type Diag24BattleRole,
  type Diag24CloseReason,
  type Diag24DiffClass,
  type Diag24DiffSample,
  type Diag24DivergenceSample,
  type Diag24LpCause,
  type Diag24LpEvent,
  type Diag24PairEntry,
  type Diag24Record,
  type Diag24Seat,
  type Diag24SourceRel,
  type Diag24SummonEntry,
  type Diag24Turn,
  type JsonValue,
  type Seat,
} from "./schema.js";
import { increment, sortedCounter } from "./statistics.js";

// Phase 2.4 diagnostics plugin (A1, --preset-metrics diag24). Instrumentation
// only: every entry reads payloads and plain fields and writes only this
// collector's own state. Besides plain reads (game.aiRandomGenerator.calls is
// read as a counter, never advanced), the collector calls these read-only
// engine and policy functions during the duel; each one is safe only while it
// consumes no RNG or IDs, fills no cache, calls no clearTargetingCache, emits
// nothing, writes nothing to the console and mutates none of its inputs, so a
// change to any of them must be reviewed against this list:
// - game.getAttackAvailability (battle snapshot at G9): the same query battleController makes;
// - evaluateVisibleBattle (common/battleProjection, at G5): pure projection over the two players;
// - getTributeRequirementFor and shouldSummonMonster (shadowheart/summonPolicy, at G8): the pure
//   policy functions, called directly and not through the strategy instance;
// - getNormalSummonTributeOptions and fieldHasTributeValue (game/summon/tributeValue, at G8):
//   pure over a fresh read-only player record built here;
// - getTechZeroRole (techzero/knowledge, at the opening draw): pure lookup.
// The observer creates the collector only when the plugin is on; without it
// none of the diag24 hooks is installed and nothing here runs.
// No module-level effect: importing this file evaluates nothing of the engine.

/** Tech-Zero combo rule, injected by the observer (same function as techzero-combo). */
export interface Diag24ComboRule {
  ids: readonly number[];
  metrics: (summons: readonly Diag24ComboSummon[]) => Record<Seat, { comboTurns: number[] }>;
}

export interface Diag24ComboSummon {
  seat: Seat;
  turn: number;
  cardId: number;
  method: SummonMethod;
}

const CARD_ZONE_SUFFIXES = [".field", ".spellTrap", ".fieldSpell"] as const;
const NAME_ZONE_SUFFIXES = [".hand", ".graveyard", ".banished"] as const;
const CLASS_ORDER: readonly Diag24DiffClass[] = [
  "content", "instance_swap", "slot_swap", "order_swap", "battle_position", "face", "stats", "attachments", "compact_identical",
];
const BATTLE_UNCERTAINTIES: ReadonlySet<string> = new Set(["battle_triggers", "visible_responses", "unprojected_passive", "search_budget"]);
const EXTRA_DECK_METHODS: ReadonlySet<string> = new Set(["fusion", "synchro", "ascension"]);
const ACTIVATION_EVENTS: ReadonlySet<string> = new Set(["spell_activated", "trap_activated", "effect_activated"]);
const MAX_COPY_DEPTH = 6;

// ── Plain readers ──────────────────────────────────────────────────────────

function read(source: unknown, key: string): unknown {
  return source !== null && typeof source === "object" ? Reflect.get(source, key) : undefined;
}

function seatOf(value: unknown): Seat | null {
  const id = typeof value === "string" ? value : value !== null && typeof value === "object" ? Reflect.get(value, "id") : null;
  return id === "player" || id === "bot" ? id : null;
}

function otherSeat(seat: Seat): Seat {
  return seat === "player" ? "bot" : "player";
}

/** Same lookup as the tracker's cardName: name, cardName, then label. */
function refName(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return null;
  for (const key of ["name", "cardName", "label"]) {
    const name: unknown = Reflect.get(value, key);
    if (name) return String(name);
  }
  return null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function actionLabel(fingerprint: unknown): string | null {
  if (fingerprint === null || typeof fingerprint !== "object") return null;
  const type = textOrNull(read(fingerprint, "type")) ?? "action";
  const card = textOrNull(read(fingerprint, "cardName"));
  const target = textOrNull(read(fingerprint, "targetName"));
  return [type, card, target].filter((entry): entry is string => entry !== null).join(":");
}

/** Main Phase candidate key, with the controller's card precedence (card.name, then cardName). */
function actionKey(action: unknown): string {
  const type = textOrNull(read(action, "type")) ?? "action";
  const name = textOrNull(read(read(action, "card"), "name")) || textOrNull(read(action, "cardName")) || "-";
  return `${type}|${name}`;
}

function summonMethod(value: unknown): SummonMethod | null {
  return SUMMON_METHODS.find(method => method === value) ?? null;
}

function shortMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.split(/\r?\n/, 1)[0] ?? "").slice(0, 160);
}

/**
 * Total JSON copy of a payload value: undefined and non-finite numbers become
 * null, other non-JSON values a string, and nothing deeper than MAX_COPY_DEPTH.
 */
function toJson(value: unknown, depth = 0): JsonValue {
  if (value === undefined || value === null) return null;
  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "bigint":
    case "symbol":
      return String(value);
    case "function":
      return "[function]";
  }
  if (depth >= MAX_COPY_DEPTH) return "…";
  if (Array.isArray(value)) return Array.from(value, entry => toJson(entry, depth + 1));
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return String(value);
  const result: { [key: string]: JsonValue } = {};
  for (const key of Object.keys(value)) result[key] = toJson(Reflect.get(value, key), depth + 1);
  return result;
}

function bucket(count: number, edges: readonly [number, string][], last: string): string {
  for (const [limit, label] of edges) if (count <= limit) return label;
  return last;
}

function ageLabel(turnCounter: number, card: unknown): string {
  const setTurn = read(card, "setTurn") ?? read(card, "turnSetOn");
  if (typeof setTurn !== "number" || !Number.isFinite(setTurn)) return "unknown";
  const age = turnCounter - setTurn;
  return age <= 0 ? "0" : age === 1 ? "1" : "2+";
}

// ── T8: divergence classification and normalization ───────────────────────

type JsonCard = { [key: string]: JsonValue };

function cardList(value: JsonValue): JsonCard[] | null {
  if (!Array.isArray(value)) return null;
  const cards: JsonCard[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
    cards.push(entry);
  }
  return cards;
}

function fieldText(card: JsonCard, key: string): string {
  return canonicalJson(card[key] ?? null);
}

function multiset(cards: readonly JsonCard[], keys: readonly string[]): string {
  return cards.map(card => keys.map(key => fieldText(card, key)).join("\u0000")).sort(compareCodeUnits).join("\u0001");
}

function classifyCardZone(expected: readonly JsonCard[], actual: readonly JsonCard[]): { cls: Diag24DiffClass; flags: Set<string> } {
  const flags = new Set<string>();
  const content = multiset(expected, ["name", "id"]) !== multiset(actual, ["name", "id"]);
  if (content) flags.add("content");
  const sameInstances = multiset(expected, ["name", "instanceId"]) === multiset(actual, ["name", "instanceId"]);
  if (!content && !sameInstances) flags.add("instance_swap");
  // Same physical card on both sides: compare its place and its state. Cards
  // with an instanceId pair by it; cards without one (simulated tokens,
  // created cards) pair in array order by (name, id).
  const hasInstance = (card: JsonCard): boolean => (card.instanceId ?? null) !== null;
  const remaining = [...actual];
  const pairs: Array<[JsonCard, JsonCard]> = [];
  const take = (card: JsonCard, match: (other: JsonCard) => boolean): void => {
    const index = remaining.findIndex(match);
    const [other] = index < 0 ? [] : remaining.splice(index, 1);
    if (other) pairs.push([card, other]);
    else if (!hasInstance(card)) flags.add("unmatched_instances");
  };
  for (const card of expected) {
    if (hasInstance(card)) take(card, other => hasInstance(other) && fieldText(other, "instanceId") === fieldText(card, "instanceId"));
  }
  for (const card of expected) {
    if (!hasInstance(card)) {
      take(card, other => !hasInstance(other) && fieldText(other, "name") === fieldText(card, "name") &&
        fieldText(other, "id") === fieldText(card, "id"));
    }
  }
  if (remaining.some(other => !hasInstance(other))) flags.add("unmatched_instances");
  let slotSwap = false;
  for (const [card, other] of pairs) {
    if (fieldText(card, "fieldSlot") !== fieldText(other, "fieldSlot")) slotSwap = true;
    if (fieldText(card, "position") !== fieldText(other, "position")) flags.add("battle_position");
    if (fieldText(card, "faceDown") !== fieldText(other, "faceDown")) flags.add("face");
    if (["atk", "def", "tempAtk", "tempDef"].some(key => fieldText(card, key) !== fieldText(other, key))) flags.add("stats");
    if (["counters", "equips"].some(key => fieldText(card, key) !== fieldText(other, key))) flags.add("attachments");
  }
  if (slotSwap) flags.add("slot_swap");
  if (sameInstances && !slotSwap) {
    const order = (cards: readonly JsonCard[]) => cards.map(card => hasInstance(card)
      ? fieldText(card, "instanceId") : `${fieldText(card, "name")}\u0002${fieldText(card, "id")}`).join("\u0000");
    if (order(expected) !== order(actual)) flags.add("order_swap");
  }
  if (canonicalJson(expected) === canonicalJson(actual)) flags.add("compact_identical");
  const cls = CLASS_ORDER.find(entry => flags.has(entry));
  if (cls !== undefined) return { cls, flags };
  // No condition holds (only reachable with unpaired cards): "content", marked as a fallback.
  flags.add("fallback");
  return { cls: "content", flags };
}

function compareNullable(left: JsonValue | undefined, right: JsonValue | undefined): number {
  const a = left ?? null;
  const b = right ?? null;
  if (a === null) return b === null ? 0 : -1;
  if (b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number") return -1;
  if (typeof b === "number") return 1;
  return compareCodeUnits(typeof a === "string" ? a : canonicalJson(a), typeof b === "string" ? b : canonicalJson(b));
}

function sortCards(cards: readonly JsonCard[]): JsonCard[] {
  return cards.map((card, index) => ({ card, index }))
    .sort((left, right) => compareNullable(left.card.name, right.card.name) || compareNullable(left.card.id, right.card.id) ||
      compareNullable(left.card.instanceId, right.card.instanceId) || left.index - right.index)
    .map(entry => entry.card);
}

const UNKNOWN_NAME = /^unknown:(.+)$/;

function unknownIds(names: readonly JsonValue[]): string[] {
  return names.flatMap(name => {
    const match = typeof name === "string" ? UNKNOWN_NAME.exec(name) : null;
    return match?.[1] !== undefined ? [match[1]] : [];
  }).sort((left, right) => {
    const a = Number(left);
    const b = Number(right);
    if (Number.isFinite(a) && Number.isFinite(b)) return a - b || compareCodeUnits(left, right);
    return compareCodeUnits(left, right);
  });
}

interface PreparedDiff {
  path: string;
  severity: string;
  reason: string | null;
  kind: "cards" | "names" | "scalar";
  cls: Diag24DiffClass;
  flags: string[];
  expected: JsonValue;
  actual: JsonValue;
}

function isCardZone(path: string): boolean {
  return CARD_ZONE_SUFFIXES.some(suffix => path.endsWith(suffix));
}

function isNameZone(path: string): boolean {
  return NAME_ZONE_SUFFIXES.some(suffix => path.endsWith(suffix));
}

/** fieldSpell is one card or null in the summary: it becomes a zone of 0 or 1 card. */
function singleZone(value: JsonValue): JsonValue {
  if (value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function prepareDiff(diff: unknown): PreparedDiff {
  const path = textOrNull(read(diff, "path")) ?? "unspecified";
  const severity = textOrNull(read(diff, "severity")) ?? "unknown";
  const reason = textOrNull(read(diff, "reason"));
  let expected = toJson(read(diff, "expected"));
  let actual = toJson(read(diff, "actual"));
  const extraFlags: string[] = [];
  if (path.endsWith(".fieldSpell")) {
    expected = singleZone(expected);
    actual = singleZone(actual);
    extraFlags.push("single_zone");
  }
  const identical = canonicalJson(expected) === canonicalJson(actual);
  if (isCardZone(path)) {
    const expectedCards = cardList(expected);
    const actualCards = cardList(actual);
    if (expectedCards && actualCards) {
      const { cls, flags } = classifyCardZone(expectedCards, actualCards);
      return { path, severity, reason, kind: "cards", cls, flags: [...flags, ...extraFlags].sort(compareCodeUnits),
        expected: sortCards(expectedCards), actual: sortCards(actualCards) };
    }
  }
  const kind = isNameZone(path) && Array.isArray(expected) && Array.isArray(actual) ? "names" : "scalar";
  const cls: Diag24DiffClass = identical ? "compact_identical" : kind;
  return { path, severity, reason, kind, cls, flags: [...(identical ? ["compact_identical"] : []), ...extraFlags].sort(compareCodeUnits),
    expected, actual };
}

/**
 * instanceId comes from a process-wide counter: inside one sample every raw
 * id becomes #1, #2... in a fixed order (diffs in payload order, expected
 * before actual, sorted cards before the unknown:<n> names).
 */
function normalizeSample(diffs: readonly PreparedDiff[]): Diag24DiffSample[] {
  const ordinals = new Map<string, number>();
  const ordinal = (raw: string): string => {
    let value = ordinals.get(raw);
    if (value === undefined) {
      value = ordinals.size + 1;
      ordinals.set(raw, value);
    }
    return `#${value}`;
  };
  const collect = (diff: PreparedDiff, value: JsonValue): void => {
    if (!Array.isArray(value)) return;
    if (diff.kind === "cards") {
      for (const card of cardList(value) ?? []) {
        const id = card.instanceId ?? null;
        if (id !== null) ordinal(typeof id === "string" ? id : canonicalJson(id));
      }
    } else if (diff.kind === "names") {
      for (const raw of unknownIds(value)) ordinal(raw);
    }
  };
  for (const diff of diffs) {
    collect(diff, diff.expected);
    collect(diff, diff.actual);
  }
  const rewrite = (diff: PreparedDiff, value: JsonValue): JsonValue => {
    if (!Array.isArray(value)) return value;
    if (diff.kind === "cards") {
      return (cardList(value) ?? []).map(card => {
        const id = card.instanceId ?? null;
        return { ...card, instanceId: id === null ? null : ordinal(typeof id === "string" ? id : canonicalJson(id)) };
      });
    }
    if (diff.kind === "names") {
      return value.map(name => {
        const match = typeof name === "string" ? UNKNOWN_NAME.exec(name) : null;
        return match?.[1] !== undefined ? `unknown:${ordinal(match[1])}` : name;
      }).sort((left, right) => compareNullable(left, right));
    }
    return value;
  };
  return diffs.map(diff => ({
    path: diff.path, severity: diff.severity, reason: diff.reason, class: diff.cls, flags: [...diff.flags],
    expected: rewrite(diff, diff.expected), actual: rewrite(diff, diff.actual),
  }));
}

// ── Record shapes ──────────────────────────────────────────────────────────

export function emptyDiag24Seat(preset: string): Diag24Seat {
  return {
    preset,
    divergence: { comparisons: 0, byPathClass: {}, byCardPathClass: {}, compactIdentical: 0, samples: [], samplesDropped: 0 },
    paths: { decisions: {}, executions: {}, failures: {}, failureCodes: {}, failuresByCard: {}, outside: {}, outsideByCard: {}, bridges: 0 },
    planning: { searches: 0, repeatedStates: {}, repeatedByTermination: {}, repeatedByCandidates: {} },
    offers: {
      mainPhase: { roots: 0, phases: 0, offeredByCard: {}, filteredByCard: {}, chosenByCard: {}, acceptedByCard: {},
        neverChosenByCard: {}, atExitByCardReason: {} },
      chain: { windows: {}, offeredByCard: {}, chosenByCard: {}, declinedByCard: {}, preparationFailedByCard: {}, origin: {},
        originByCard: {}, offerOriginByCard: {} },
      triggers: { hookPresent: false, offeredByCard: {}, declinedByCard: {} },
    },
    activations: { publishedByCardWindow: {}, attemptsByCardWindow: {}, targetsByCard: {} },
    summonVetoes: preset === "shadowheart" ? { generations: 0, roots: 0, byCardReason: {}, overriddenByCard: {}, drift: 0 } : null,
    extraDeck: { summonsByCardMethod: {}, bossSummonsByCard: {}, byTurnCard: {}, bossByTurnCard: {}, turns: [] },
    attacks: { battlePhases: 0, declared: 0, direct: 0, declaredByCard: {}, battleEnds: {}, legalLeftByCard: {} },
    pairEffects: { registered: 0, applied: 0, expired: {} },
    lpLoss: { ownTurn: {}, opponentTurn: {}, ownTurnBySource: {}, opponentTurnBySource: {}, battleByRole: {} },
    lethal: { projections: 0, grades: {}, converted: {}, uncertainty: {}, viewUncertaintyByGrade: {},
      hidden: { handNonEmpty: 0, faceDownMonsters: 0, faceDownBackrow: 0 } },
    backrow: { reactions: {}, reactionsByCard: {}, reactionsByCount: {}, inPlannedExecution: 0, exposure: {}, exposureByCount: {} },
    turns: [],
    techZeroOpening: null,
  };
}

/** A valid record of the same shape, used when the projection itself fails. */
export function emptyDiag24Record(errors: Counter, presets: Record<Seat, string>): Diag24Record {
  return {
    version: DIAG24_RECORD_VERSION,
    limits: diag24Limits(),
    errors: sortedCounter(errors),
    truncated: {},
    closed: null,
    fatal: null,
    timeline: { summons: [], lp: [], pairs: [] },
    seats: { player: emptyDiag24Seat(presets.player), bot: emptyDiag24Seat(presets.bot) },
  };
}

function sortedTurn(turn: Diag24Turn): Diag24Turn {
  return {
    ...turn,
    lpLost: sortedCounter(turn.lpLost),
    activationsByCard: sortedCounter(turn.activationsByCard),
    chainDeclinedByCard: sortedCounter(turn.chainDeclinedByCard),
  };
}

/** A copy of one section with only the listed Counter fields sorted; every other field is copied as is. */
function sortCounters<Key extends string>(section: Record<Key, Counter>, keys: readonly Key[]): Record<Key, Counter> {
  const result: Record<Key, Counter> = { ...section };
  for (const key of keys) result[key] = sortedCounter(section[key]);
  return result;
}

function sortedSeat(seat: Diag24Seat): Diag24Seat {
  const keys = DIAG24_SEAT_COUNTERS;
  const vetoes = seat.summonVetoes;
  const opening = seat.techZeroOpening;
  return {
    preset: seat.preset,
    divergence: {
      ...seat.divergence,
      ...sortCounters(seat.divergence, keys.divergence),
      samples: seat.divergence.samples.map(sample => ({ ...sample, diffs: sample.diffs.map(diff => ({ ...diff, flags: [...diff.flags] })) })),
    },
    paths: { ...seat.paths, ...sortCounters(seat.paths, keys.paths) },
    planning: { ...seat.planning, ...sortCounters(seat.planning, keys.planning) },
    offers: {
      mainPhase: { ...seat.offers.mainPhase, ...sortCounters(seat.offers.mainPhase, keys.mainPhase) },
      chain: { ...seat.offers.chain, ...sortCounters(seat.offers.chain, keys.chain) },
      triggers: { ...seat.offers.triggers, ...sortCounters(seat.offers.triggers, keys.triggers) },
    },
    activations: { ...seat.activations, ...sortCounters(seat.activations, keys.activations) },
    summonVetoes: vetoes ? { ...vetoes, ...sortCounters(vetoes, keys.summonVetoes) } : null,
    extraDeck: { ...seat.extraDeck, ...sortCounters(seat.extraDeck, keys.extraDeck), turns: [...seat.extraDeck.turns] },
    attacks: { ...seat.attacks, ...sortCounters(seat.attacks, keys.attacks) },
    pairEffects: { ...seat.pairEffects, ...sortCounters(seat.pairEffects, keys.pairEffects) },
    lpLoss: { ...seat.lpLoss, ...sortCounters(seat.lpLoss, keys.lpLoss) },
    lethal: { ...seat.lethal, ...sortCounters(seat.lethal, keys.lethal), hidden: { ...seat.lethal.hidden } },
    backrow: { ...seat.backrow, ...sortCounters(seat.backrow, keys.backrow) },
    turns: seat.turns.map(sortedTurn),
    techZeroOpening: opening
      ? { ...opening, handIds: [...opening.handIds], handRoles: sortedCounter(opening.handRoles),
        firstOwnTurnHandIds: opening.firstOwnTurnHandIds ? [...opening.firstOwnTurnHandIds] : null }
      : null,
  };
}

// ── Collector ──────────────────────────────────────────────────────────────

interface Diag24Timeline {
  summons: Diag24SummonEntry[];
  lp: Diag24LpEvent[];
  pairs: Diag24PairEntry[];
}

interface OpenDecision {
  actions: number | null;
  tls: boolean;
  roots: Set<string>;
}

interface OpenMainPhase {
  offered: Set<string>;
  chosen: Set<string>;
  roots: number;
}

interface PendingBattle {
  seat: Seat;
  turn: number;
  legal: Array<{ name: string; used: number }>;
  attacked: boolean;
}

interface KnownPair {
  seat: Seat | null;
  sourceCardId: number | null;
  members: unknown[];
  expiresOnTurn: number | null;
}

interface SeatState {
  data: Diag24Seat;
  decision: OpenDecision | null;
  pendingPath: string | null;
  pendingKey: string | null;
  execPath: string | null;
  execKey: string | null;
  mainPhase: OpenMainPhase | null;
  lastRootOffers: string[] | null;
  lastGeneration: string[] | null;
  generationPending: boolean;
  pendingPrep: string | null;
  rejected: boolean;
  chainHook: boolean | null;
  current: Diag24Turn | null;
  battleTurns: Set<number>;
  classifiedBattleTurns: Set<number>;
  attackedThisTurn: boolean;
  lethalGrades: Array<{ turn: number; grade: string }>;
  openingCaptured: boolean;
}

export class Diag24Collector {
  private readonly game: Game;
  private readonly presets: Record<Seat, string>;
  private readonly combo: Diag24ComboRule;
  private readonly seats: Record<Seat, SeatState>;
  private readonly errors: Counter = {};
  private readonly truncated: Counter = {};
  private readonly timeline: Diag24Timeline = { summons: [], lp: [], pairs: [] };
  private readonly publishedLinks = new Set<string>();
  private readonly knownPairs = new Map<string, KnownPair>();
  private readonly seenPairs = new Set<string>();
  private readonly attackersThisTurn = new Set<unknown>();
  private readonly comboSummons: Diag24ComboSummon[] = [];
  private closed: Diag24Record["closed"] = null;
  private fatal: Diag24LpEvent | null = null;
  private finished = false;
  private projected: Diag24Record | null = null;
  private pendingBattle: PendingBattle | null = null;
  private startSeat: Seat | null = null;
  private firstTurnSeat: Seat | null = null;
  private lastAiCalls = 0;

  constructor(game: Game, presets: Record<Seat, string>, combo: Diag24ComboRule) {
    this.game = game;
    this.presets = presets;
    this.combo = combo;
    const state = (preset: string): SeatState => ({
      data: emptyDiag24Seat(preset), decision: null, pendingPath: null, pendingKey: null, execPath: null, execKey: null,
      mainPhase: null, lastRootOffers: null, lastGeneration: null, generationPending: false, pendingPrep: null, rejected: false,
      chainHook: null, current: null, battleTurns: new Set(), classifiedBattleTurns: new Set(), attackedThisTurn: false,
      lethalGrades: [], openingCaptured: false,
    });
    this.seats = { player: state(presets.player), bot: state(presets.bot) };
  }

  // ── Guards ──

  private safe(entry: string, task: () => void): void {
    if (this.finished) return;
    try {
      task();
    } catch (error) {
      increment(this.errors, `${entry}:${shortMessage(error)}`);
    }
  }

  private player(seat: Seat): GamePlayer {
    return seat === "player" ? this.game.player : this.game.bot;
  }

  /** own|opp x main|battle|other, from the seat's point of view. */
  private windowOf(seat: Seat): string {
    const phase = this.game.phase;
    const part = phase === "main1" || phase === "main2" ? "main" : phase === "battle" ? "battle" : "other";
    return `${this.game.turn === seat ? "own" : "opp"}_${part}`;
  }

  private checkOpen(): void {
    if (!this.closed && this.game.gameOver) this.close("game_over");
  }

  private close(reason: Diag24CloseReason): void {
    if (this.closed) return;
    // A Battle Phase the duel ends inside is "duel_ended", with no leftover
    // attackers: at damage_inflicted the engine has not yet marked the attack
    // in progress as used, so a live availability snapshot would count the
    // attacker that just dealt the damage. A pending snapshot of the same seat
    // and turn survives only when no attack was declared after it (attackDeclared
    // drops it), so it still describes how the seat left the battle and is confirmed.
    const seat = seatOf(this.game.turn);
    const turn = this.game.turnCounter;
    const pending = this.pendingBattle;
    if (seat && this.game.phase === "battle" && !(pending && pending.seat === seat && pending.turn === turn)) {
      this.classifyBattle(seat, turn, "duel_ended", []);
    }
    this.confirmBattle(true);
    this.endTurnEntries();
    this.closed = { turn: this.game.turnCounter, phase: textOrNull(this.game.phase), reason };
  }

  private pushTimeline<Kind extends keyof Diag24Timeline>(kind: Kind, entry: Diag24Timeline[Kind][number]): void {
    const list: Array<Diag24Timeline[Kind][number]> = this.timeline[kind];
    if (list.length < DIAG24_TIMELINE_LIMITS[kind]) list.push(entry);
    else increment(this.truncated, `timeline:${kind}`);
  }

  private turnEntry(seat: Seat, turn = this.game.turnCounter): Diag24Turn | null {
    if (this.closed) return null;
    const state = this.seats[seat];
    if (state.current?.turn === turn) return state.current;
    for (let index = state.data.turns.length - 1; index >= 0; index -= 1) {
      const entry = state.data.turns[index];
      if (entry?.turn === turn) return entry;
    }
    return null;
  }

  private endTurnEntries(): void {
    for (const seat of SEATS) {
      const state = this.seats[seat];
      if (state.current) state.current.handAtEnd = this.player(seat).hand.length;
      state.current = null;
    }
  }

  // ── G1: progress stages ──

  onProgress(stage: string, details: unknown): void {
    this.safe("progress", () => {
      this.checkOpen();
      this.confirmBattle(false);
      switch (stage) {
        case "starting_player_selected": this.startSeat = seatOf(this.game.turn); return;
        case "opening_draw_after": this.captureOpening(); return;
        case "turn_start": this.turnStart(); return;
        case "main1_ready": this.main1Ready(); return;
      }
      const actor = seatOf(read(details, "actor"));
      if (!actor) return;
      const state = this.seats[actor];
      switch (stage) {
        case "bot_main_phase_enter":
          if (state.mainPhase) this.closeMainPhase(state, "reentered");
          state.mainPhase = { offered: new Set(), chosen: new Set(), roots: 0 };
          state.lastRootOffers = null;
          return;
        case "ai_decision_before": this.decisionBefore(state, details); return;
        case "ai_turn_line_search": this.turnLineSearch(state, details); return;
        case "ai_decision_after": this.decisionAfter(state, details); return;
        case "ai_plan_phase_bridge":
          state.data.paths.bridges += 1;
          state.pendingPath = null;
          state.pendingKey = null;
          return;
        case "ai_main_phase_exit": {
          const reason = textOrNull(read(details, "reason")) ?? "none";
          if (state.decision) {
            increment(state.data.paths.decisions, `exit_open:${reason}`);
            state.decision = null;
          }
          this.closeExecution(state);
          this.closeMainPhase(state, reason);
          return;
        }
        case "ai_main_phase_execution": {
          const accepted = read(details, "actionAccepted") === true;
          const path = state.execPath ?? "unknown";
          increment(state.data.paths.executions, `${path}|${accepted ? "accepted" : "rejected"}`);
          if (accepted && state.execKey) increment(state.data.offers.mainPhase.acceptedByCard, state.execKey);
          state.execPath = null;
          state.execKey = null;
          return;
        }
        case "ai_plan_execution_compare":
        case "ai_plan_execution_failed":
          this.divergence(actor, state, stage, details);
          return;
      }
    });
  }

  private turnStart(): void {
    for (const seat of SEATS) {
      const state = this.seats[seat];
      if (state.mainPhase) this.closeMainPhase(state, "turn_change");
    }
    if (this.closed) return;
    this.scanPairs(true);
    this.attackersThisTurn.clear();
    const turn = this.game.turnCounter;
    if (turn === 1 && this.firstTurnSeat === null) this.firstTurnSeat = seatOf(this.game.turn);
    this.endTurnEntries();
    for (const seat of SEATS) {
      const state = this.seats[seat];
      state.attackedThisTurn = false;
      if (state.data.turns.length >= DIAG24_TURN_LIMIT) {
        increment(this.truncated, `turns:${seat}`);
        continue;
      }
      const entry: Diag24Turn = {
        turn, own: this.game.turn === seat, battlePhase: false, attacksDeclared: 0, battleEnd: null, lethalGrade: null,
        lpLost: {}, activationsByCard: {}, chainDeclinedByCard: {}, handAtEnd: null,
      };
      state.data.turns.push(entry);
      state.current = entry;
    }
    this.exposureSnapshot("other");
  }

  private main1Ready(): void {
    if (this.closed) return;
    this.exposureSnapshot("main");
    const seat = seatOf(this.game.turn);
    if (!seat) return;
    const opening = this.seats[seat].data.techZeroOpening;
    if (opening && opening.firstOwnTurnHandIds === null) opening.firstOwnTurnHandIds = this.handIds(seat);
  }

  private handIds(seat: Seat): number[] {
    return this.player(seat).hand.flatMap(card => typeof card.id === "number" ? [card.id] : []).sort((a, b) => a - b);
  }

  private captureOpening(): void {
    for (const seat of SEATS) {
      const state = this.seats[seat];
      if (state.data.preset !== "techzero" || state.openingCaptured) continue;
      state.openingCaptured = true;
      const player = this.player(seat);
      const handRoles: Counter = {};
      for (const card of player.hand) increment(handRoles, getTechZeroRole(card));
      const ids = (cards: readonly GameCard[]) => cards.map(card => card.id ?? null);
      const top = player.deck[player.deck.length - 1];
      state.data.techZeroOpening = {
        // Fixed at projection from the starting seat; 2 until then.
        firstOwnTurn: 2,
        handIds: this.handIds(seat),
        // Player.draw takes deck.pop(): the next draw is the last card.
        nextDrawId: typeof top?.id === "number" ? top.id : null,
        handRoles,
        zonesDigest: digestOf({ hand: this.handIds(seat), deck: ids(player.deck), extraDeck: ids(player.extraDeck) }),
        firstOwnTurnHandIds: null,
        c1: false,
      };
    }
  }

  // ── Item 2: decision paths ──

  private closeExecution(state: SeatState): void {
    const path = state.execPath ?? state.pendingPath;
    if (path !== null) increment(state.data.paths.executions, `${path}|no_stage`);
    state.execPath = null;
    state.execKey = null;
    state.pendingPath = null;
    state.pendingKey = null;
  }

  private decisionBefore(state: SeatState, details: unknown): void {
    if (state.decision) increment(state.data.paths.decisions, "abandoned");
    this.closeExecution(state);
    const actions = read(details, "actions");
    state.decision = { actions: typeof actions === "number" ? actions : null, tls: false, roots: new Set() };
    if (state.generationPending) {
      state.generationPending = false;
      if (!this.closed && state.data.summonVetoes) state.data.summonVetoes.roots += 1;
    }
  }

  private turnLineSearch(state: SeatState, details: unknown): void {
    if (state.decision) state.decision.tls = true;
    const planning = state.data.planning;
    planning.searches += 1;
    const repeated = numberOr(read(details, "plannerRepeatedStates"), 0);
    const repeatedFlag = repeated > 0 ? "1+" : "0";
    increment(planning.repeatedStates, bucket(repeated, [[0, "0"], [1, "1"], [2, "2"]], "3+"));
    increment(planning.repeatedByTermination,
      `${textOrNull(read(details, "plannerTerminationReason")) ?? "unknown"}|${repeatedFlag}`);
    const candidates = state.decision?.actions ?? null;
    const candidateBucket = candidates === null ? "unknown" : bucket(candidates, [[1, "1"], [4, "2-4"], [8, "5-8"]], "9+");
    increment(planning.repeatedByCandidates, `${candidateBucket}|${repeatedFlag}`);
  }

  private decisionAfter(state: SeatState, details: unknown): void {
    const decision = state.decision;
    state.decision = null;
    if (read(details, "selected") !== true) {
      increment(state.data.paths.decisions, "none_selected");
      return;
    }
    const roots = decision?.roots ?? new Set<string>();
    const path = roots.has("greedy") ? (decision?.actions === 1 ? "single_candidate" : "greedy")
      : roots.has("beam") ? "beam" : decision?.tls ? "tls" : "unknown";
    increment(state.data.paths.decisions, path);
    const key = `${textOrNull(read(details, "actionType")) ?? "action"}|${textOrNull(read(details, "card")) ?? "-"}`;
    increment(state.data.offers.mainPhase.chosenByCard, key);
    state.mainPhase?.chosen.add(key);
    state.lastRootOffers = null;
    state.pendingPath = path;
    state.pendingKey = key;
  }

  /** G4: the action the controller hands to the base executor. */
  onExecute(seat: Seat, action: unknown): void {
    this.safe("execute", () => {
      this.checkOpen();
      const state = this.seats[seat];
      if (state.execPath !== null) increment(state.data.paths.executions, `${state.execPath}|no_stage`);
      if (state.pendingPath !== null) {
        state.execPath = state.pendingPath;
        state.execKey = state.pendingKey;
      } else if (!state.decision && read(action, "type") === "ascension") {
        // The automatic Ascension shortcut emits no ai_decision_before.
        increment(state.data.paths.decisions, "auto_ascension");
        state.execPath = "auto_ascension";
        state.execKey = actionKey(action);
      } else {
        state.execPath = "unknown";
        state.execKey = actionKey(action);
      }
      state.pendingPath = null;
      state.pendingKey = null;
    });
  }

  /** G7: a planning root reached the public-projection guard. */
  onProjectionGuard(seatId: unknown, root: unknown): void {
    this.safe("guard", () => {
      const seat = seatOf(seatId);
      if (!seat || (root !== "beam" && root !== "greedy")) return;
      this.seats[seat].decision?.roots.add(root);
    });
  }

  /** G2: an activation attempt (blocked = false) or a guard block (blocked = true). */
  onAttempt(data: unknown, blocked: boolean): void {
    this.safe(blocked ? "blocked" : "attempt", () => {
      this.checkOpen();
      const seat = seatOf(blocked
        ? read(data, "player") || read(data, "actor") || read(data, "seat")
        : read(data, "player") || read(data, "owner") || read(data, "seat"));
      if (!seat) return;
      const state = this.seats[seat];
      const success = !blocked && read(data, "success") === true;
      const name = blocked
        ? refName(read(data, "card")) || textOrNull(read(data, "cardName")) || textOrNull(read(data, "kind")) || "action"
        : refName(read(data, "card") || read(data, "source")) || textOrNull(read(data, "cardName")) || "unknown";
      const window = this.windowOf(seat);
      if (!this.closed) increment(state.data.activations.attemptsByCardWindow, `${name}|${window}|${success ? "ok" : "fail"}`);
      if (success) return;
      const code = textOrNull(read(data, "code"));
      const failureClass = classifyFailureCode(code);
      const paths = state.data.paths;
      if (state.execPath !== null) {
        increment(paths.failures, `${state.execPath}|${failureClass}`);
        increment(paths.failureCodes, `${state.execPath}|${code ?? "uncoded"}`);
        increment(paths.failuresByCard, `${state.execPath}|${name}|${code ?? "uncoded"}`);
      } else {
        increment(paths.outside, `${window}|${failureClass}`);
        increment(paths.outsideByCard, `${window}|${name}|${code ?? "uncoded"}`);
      }
    });
  }

  // ── Item 3: Main Phase offers ──

  /** G8: the live candidate generation of the controller. */
  onGeneration(bot: Bot, actions: readonly unknown[]): void {
    this.safe("generation", () => {
      this.checkOpen();
      const seat = seatOf(bot.id);
      if (!seat) return;
      const state = this.seats[seat];
      state.lastGeneration = actions.map(actionKey);
      state.generationPending = false;
      if (state.data.summonVetoes && !this.closed) {
        state.generationPending = true;
        this.summonVetoes(seat, bot, actions, state.data.summonVetoes);
      }
    });
  }

  /** G3: the permitted candidates of one root (context.actions). */
  onPlanningProfile(seat: Seat, context: unknown): void {
    this.safe("profile", () => {
      const state = this.seats[seat];
      const actions = read(context, "actions");
      const offered = (Array.isArray(actions) ? actions : []).map(actionKey);
      const mainPhase = state.data.offers.mainPhase;
      mainPhase.roots += 1;
      if (state.mainPhase) state.mainPhase.roots += 1;
      const remaining = new Map<string, number>();
      for (const key of offered) {
        increment(mainPhase.offeredByCard, key);
        state.mainPhase?.offered.add(key);
        remaining.set(key, (remaining.get(key) ?? 0) + 1);
      }
      for (const key of state.lastGeneration ?? []) {
        const left = remaining.get(key) ?? 0;
        if (left > 0) remaining.set(key, left - 1);
        else increment(mainPhase.filteredByCard, key);
      }
      state.lastGeneration = null;
      state.lastRootOffers = offered;
    });
  }

  private closeMainPhase(state: SeatState, reason: string): void {
    const open = state.mainPhase;
    state.mainPhase = null;
    const offers = state.lastRootOffers;
    state.lastRootOffers = null;
    if (!open) return;
    const mainPhase = state.data.offers.mainPhase;
    if (open.roots > 0) mainPhase.phases += 1;
    for (const key of open.offered) if (!open.chosen.has(key)) increment(mainPhase.neverChosenByCard, key);
    for (const key of offers ?? []) increment(mainPhase.atExitByCardReason, `${key}|${reason}`);
  }

  // ── Item 4: Shadow-Heart summon vetoes ──

  private summonVetoes(seat: Seat, bot: Bot, actions: readonly unknown[], vetoes: NonNullable<Diag24Seat["summonVetoes"]>): void {
    const strategy = bot.strategy;
    if (!(strategy instanceof ShadowHeartStrategy)) return;
    vetoes.generations += 1;
    const analysis = strategy.currentAnalysis;
    if (!analysis) return;
    const opponent = this.player(otherSeat(seat));
    const accepted = new Set<GameCard>();
    const vetoed = new Set<GameCard>();
    if (analysis.canNormalSummon) {
      // The same gates as getGenericNormalSummonActions and decideNormal, read-only.
      const summonPlayer = {
        id: bot.id, hand: bot.hand, field: bot.field, spellTrap: bot.spellTrap, fieldSpell: bot.fieldSpell,
        summonCount: bot.summonCount ?? 0, additionalNormalSummons: bot.additionalNormalSummons ?? 0,
        additionalNormalSummonPermissions: [...(bot.additionalNormalSummonPermissions || [])],
        normalSummonsThisTurn: [...(bot.normalSummonsThisTurn || [])],
      };
      for (const card of bot.hand) {
        if (!card || card.cardKind !== "monster" || card.cannotBeNormalSummonedOrSet) continue;
        if (getNormalSummonTributeOptions(summonPlayer, card).length === 0) continue;
        // ShadowHeartStrategy.getTributeRequirementFor delegates to this pure function.
        const tributeInfo = getTributeRequirementFor(card, bot);
        if (!fieldHasTributeValue(bot.field || [], tributeInfo.tributesNeeded, card)) continue;
        if (analysis.fieldCapacity <= 0 && tributeInfo.tributesNeeded <= 0) continue;
        const decision = shouldSummonMonster(card, analysis, tributeInfo, { field: bot.field || [], oppField: opponent.field || [] });
        if (decision.yes) {
          accepted.add(card);
          continue;
        }
        vetoed.add(card);
        increment(vetoes.byCardReason, `${card.name}|${String(decision.reason ?? "none").replace(/\d+/g, "#")}`);
      }
    }
    // Self-check against the generated summons.
    const generated = new Set<unknown>();
    for (const action of actions) {
      if (read(action, "type") !== "summon") continue;
      const index = read(action, "index");
      const card = read(action, "card") ?? (typeof index === "number" ? bot.hand[index] : undefined);
      generated.add(card);
      if ([...accepted].some(entry => entry === card)) continue;
      const vetoedCard = [...vetoed].find(entry => entry === card);
      if (vetoedCard && read(action, "isStalemateBreaker") === true) increment(vetoes.overriddenByCard, vetoedCard.name);
      else vetoes.drift += 1;
    }
    for (const card of accepted) if (!generated.has(card)) vetoes.drift += 1;
  }

  // ── G6: events ──

  onEvent(eventName: string, payload: unknown): void {
    this.safe("event", () => {
      this.checkOpen();
      if (this.pendingBattle) this.confirmBattle(false);
      if (!this.closed) this.scanPairs(false);
      if (ACTIVATION_EVENTS.has(eventName)) {
        this.activation(payload);
        return;
      }
      switch (eventName) {
        case "decision_made": this.decisionMade(payload); return;
        case "ai_activation_rejected": {
          const seat = seatOf(read(payload, "playerId"));
          if (seat) this.seats[seat].rejected = true;
          return;
        }
        case "fast_effect_priority": {
          const seat = seatOf(read(payload, "playerId"));
          if (!seat) return;
          const state = this.seats[seat];
          if (state.pendingPrep !== null && !this.closed && read(payload, "decision") === "pass") {
            increment(state.data.offers.chain.preparationFailedByCard, state.pendingPrep);
          }
          state.pendingPrep = null;
          return;
        }
        case "after_summon": this.summon(payload); return;
        case "attack_declared": this.attackDeclared(payload); return;
        case "damage_inflicted": this.damage(payload); return;
        case "lp_change": this.lpCost(payload); return;
      }
    });
  }

  /** Resolves a candidate key (`<duelCardId|instanceId>:<effectId>:<zone>`) by plain fields only. */
  private resolveCandidate(key: unknown): { name: string; zone: string } {
    const text = typeof key === "string" ? key : String(key);
    const first = text.indexOf(":");
    const last = text.lastIndexOf(":");
    const identity = first < 0 ? text : text.slice(0, first);
    const zone = last < 0 ? "unknown" : text.slice(last + 1) || "unknown";
    return { name: this.findCardByKeyIdentity(identity)?.name ?? "unknown", zone };
  }

  /** The first card of either player (player's zones first) that satisfies match. */
  private findCard(match: (card: GameCard) => boolean): GameCard | null {
    for (const seat of SEATS) {
      const player = this.player(seat);
      const zones: ReadonlyArray<readonly (GameCard | null | undefined)[]> = [
        player.hand, player.field, player.spellTrap, [player.fieldSpell], player.graveyard, player.banished, player.deck, player.extraDeck,
      ];
      for (const zone of zones) {
        for (const card of zone) if (card && match(card)) return card;
      }
    }
    return null;
  }

  /** The candidate key's identity, with the precedence of sourceIdentity (chain/legality.ts), from plain fields. */
  private findCardByKeyIdentity(identity: string): GameCard | null {
    return this.findCard(card => {
      const value: unknown = read(card, "duelCardId") ?? read(card, "instanceId") ?? read(card, "_instanceId") ?? read(card, "uuid") ??
        read(card, "simInstanceId") ?? read(card, "id") ?? read(card, "name") ?? "card";
      return String(value) === identity;
    });
  }

  private findCardByDuelId(id: unknown): GameCard | null {
    return typeof id === "number" ? this.findCard(card => read(card, "duelCardId") === id) : null;
  }

  private decisionMade(payload: unknown): void {
    if (this.closed) return;
    const kind = read(payload, "kind");
    const seat = seatOf(read(payload, "actorId"));
    if (!seat) return;
    const state = this.seats[seat];
    const value = read(payload, "value");
    const context = read(payload, "context");
    if (kind === "trigger_activation") {
      const card = this.findCardByDuelId(read(context, "sourceDuelCardId"));
      const effectId = read(context, "effectId");
      const effect = card ? (card.effects || []).find(entry => entry?.id === effectId) : undefined;
      const requirement = !effect ? "unknown" : effect.triggerRequirement === "optional" ? "optional" : "mandatory";
      const key = `${card?.name ?? "unknown"}|${requirement}`;
      const triggers = state.data.offers.triggers;
      increment(triggers.offeredByCard, key);
      if (read(value, "pass") === true) increment(triggers.declinedByCard, key);
      return;
    }
    if (kind !== "chain_response") return;
    const chain = state.data.offers.chain;
    const window = this.windowOf(seat);
    const chainContext = textOrNull(read(context, "type")) ?? "none";
    increment(chain.windows, `${window}|${chainContext}`);
    const calls = this.game.aiRandomGenerator.calls;
    const delta = calls - this.lastAiCalls;
    this.lastAiCalls = calls;
    const rejected = state.rejected;
    state.rejected = false;
    state.chainHook ??= typeof Reflect.get(this.player(seat).strategy ?? {}, "chooseChainResponse") === "function";
    const chosenKey = read(value, "pass") === false ? read(value, "candidateKey") : null;
    const keys = read(payload, "candidateKeys");
    const candidates = (Array.isArray(keys) ? keys : []).map(key => ({ key, ...this.resolveCandidate(key) }));
    const chosen = chosenKey === null || chosenKey === undefined ? null : candidates.find(entry => entry.key === chosenKey) ?? null;
    const origin = state.chainHook
      ? rejected ? "hook_rejected"
        : delta > 0 ? (chosen ? "hook_then_fallback_roll_activate" : "hook_then_fallback_roll_pass")
          : chosen ? "hook_choice" : "hook_pass_or_fallback_no_roll"
      : delta > 0 ? (chosen ? "fallback_roll_activate" : "fallback_roll_pass")
        : chosen ? "fallback_rule_choice" : "fallback_no_roll_pass";
    increment(chain.origin, origin);
    increment(chain.originByCard, `${chosen?.name ?? "pass"}|${origin}`);
    state.pendingPrep = null;
    const turn = this.turnEntry(seat);
    for (const candidate of candidates) {
      const offerKey = `${candidate.name}|${candidate.zone}|${window}|${chainContext}`;
      increment(chain.offeredByCard, offerKey);
      if (candidate === chosen) {
        increment(chain.chosenByCard, offerKey);
        increment(chain.offerOriginByCard, `${candidate.name}|${origin}|chosen`);
        state.pendingPrep = offerKey;
      } else {
        increment(chain.declinedByCard, offerKey);
        increment(chain.offerOriginByCard, `${candidate.name}|${origin}|declined`);
        if (turn) increment(turn.chainDeclinedByCard, `${candidate.name}|${candidate.zone}`);
      }
    }
  }

  // ── Items 3 and 9: activations and backrow reactions ──

  private activation(payload: unknown): void {
    if (this.closed) return;
    const linkId = read(payload, "linkId");
    if (linkId !== undefined && linkId !== null) {
      const key = `link:${String(linkId)}`;
      if (this.publishedLinks.has(key)) return;
      this.publishedLinks.add(key);
    }
    const seat = seatOf(read(payload, "player") || read(payload, "owner"));
    const card = read(payload, "card") || read(payload, "source");
    const name = refName(card);
    if (!seat || !name) return;
    const state = this.seats[seat];
    const window = this.windowOf(seat);
    increment(state.data.activations.publishedByCardWindow, `${name}|${window}`);
    const turn = this.turnEntry(seat);
    if (turn) increment(turn.activationsByCard, `${name}|${window}`);
    const selected = read(payload, "selectedCount");
    increment(state.data.activations.targetsByCard,
      `${name}|${textOrNull(read(payload, "effectId")) ?? "-"}|${typeof selected === "number" ? selected : 0}`);
    // Backrow reaction: activated from this seat's Spell/Trap or Field Zone.
    const owner = this.player(seat);
    const declaredZone = textOrNull(read(payload, "activationZone"));
    const zone = declaredZone ??
      (owner.fieldSpell !== null && owner.fieldSpell === card ? "fieldSpell" : owner.spellTrap.some(entry => entry === card) ? "spellTrap" : null);
    if ((zone !== "spellTrap" && zone !== "fieldSpell") || read(payload, "fromHand") === true) return;
    const wasFacedown = read(read(payload, "activationContext"), "sourceWasFacedown");
    const face = wasFacedown === true ? "down" : wasFacedown === false ? "up" : "unknown";
    const backrow = state.data.backrow;
    increment(backrow.reactions, `${window}|${zone}|${face}|${ageLabel(this.game.turnCounter, card)}`);
    increment(backrow.reactionsByCard, name);
    let down = 0;
    let up = 0;
    for (const entry of [...owner.spellTrap, ...(owner.fieldSpell ? [owner.fieldSpell] : [])]) {
      const facedown = entry === card && typeof wasFacedown === "boolean" ? wasFacedown : entry.isFacedown === true;
      if (facedown) down += 1;
      else up += 1;
    }
    increment(backrow.reactionsByCount, `${window}|${down}|${up}`);
    if (this.seats[otherSeat(seat)].execPath === "tls") backrow.inPlannedExecution += 1;
  }

  private exposureSnapshot(part: "other" | "main" | "battle"): void {
    const turnSeat = seatOf(this.game.turn);
    for (const seat of SEATS) {
      const window = `${seat === turnSeat ? "own" : "opp"}_${part}`;
      const owner = this.player(seat);
      const backrow = this.seats[seat].data.backrow;
      let down = 0;
      let up = 0;
      const cards: Array<[string, GameCard]> = [
        ...owner.spellTrap.map((card): [string, GameCard] => ["spellTrap", card]),
        ...(owner.fieldSpell ? [["fieldSpell", owner.fieldSpell] satisfies [string, GameCard]] : []),
      ];
      for (const [zone, card] of cards) {
        const facedown = card.isFacedown === true;
        if (facedown) down += 1;
        else up += 1;
        increment(backrow.exposure, `${window}|${zone}|${facedown ? "down" : "up"}|${ageLabel(this.game.turnCounter, card)}`);
      }
      increment(backrow.exposureByCount, `${window}|${down}|${up}`);
    }
  }

  // ── Item 5: Extra Deck and bosses ──

  private summon(payload: unknown): void {
    if (this.closed) return;
    const seat = seatOf(read(payload, "player"));
    const card = read(payload, "card");
    if (!seat || !card) return;
    const name = refName(card) ?? "unknown";
    const method = textOrNull(read(payload, "method")) ?? "unknown";
    const fromZone = textOrNull(read(payload, "fromZone"));
    const turn = this.game.turnCounter;
    const cardId = integerOrNull(read(card, "id"));
    const extraDeck = fromZone === "extraDeck" || EXTRA_DECK_METHODS.has(method);
    const level = read(card, "level");
    const boss = extraDeck || (typeof level === "number" && level >= 7);
    const data = this.seats[seat].data.extraDeck;
    if (extraDeck) {
      increment(data.summonsByCardMethod, `${name}|${method}`);
      increment(data.byTurnCard, `${turn}|${name}`);
      if (!data.turns.includes(turn)) data.turns.push(turn);
    }
    if (boss) {
      increment(data.bossSummonsByCard, name);
      increment(data.bossByTurnCard, `${turn}|${name}`);
    }
    if (boss || extraDeck) this.pushTimeline("summons", { turn, seat, cardId, method, fromZone, boss, extraDeck });
    const comboMethod = summonMethod(method);
    if (cardId !== null && comboMethod !== null && this.combo.ids.includes(cardId)) {
      this.comboSummons.push({ seat, turn, cardId, method: comboMethod });
    }
  }

  // ── Item 6: attacks, battle ends and pair effects ──

  private attackDeclared(payload: unknown): void {
    if (this.closed) return;
    const seat = seatOf(read(payload, "attackerOwner"));
    const attacker = read(payload, "attacker");
    if (!seat) return;
    const state = this.seats[seat];
    const attacks = state.data.attacks;
    attacks.declared += 1;
    const target = read(payload, "target");
    if (target === null || target === undefined) attacks.direct += 1;
    increment(attacks.declaredByCard, refName(attacker) ?? "unknown");
    state.attackedThisTurn = true;
    // A snapshot taken before this attack (a blocked nextPhase) no longer describes the battle end.
    if (this.pendingBattle?.seat === seat && this.pendingBattle.turn === this.game.turnCounter) this.pendingBattle = null;
    if (attacker) this.attackersThisTurn.add(attacker);
    const turn = this.turnEntry(seat);
    if (turn) turn.attacksDeclared += 1;
  }

  /** G5: once per seat and turn, before any attack. */
  onBattlePhase(seatId: unknown): void {
    this.safe("battle", () => {
      this.checkOpen();
      this.confirmBattle(false);
      const seat = seatOf(seatId);
      if (this.closed || !seat) return;
      const state = this.seats[seat];
      const turnCounter = this.game.turnCounter;
      if (state.battleTurns.has(turnCounter)) return;
      state.battleTurns.add(turnCounter);
      state.data.attacks.battlePhases += 1;
      const turn = this.turnEntry(seat);
      if (turn) turn.battlePhase = true;
      this.lethal(seat, turn);
      this.exposureSnapshot("battle");
    });
  }

  /** G9: before the original nextPhase runs; a call from battle takes the pending snapshot. */
  onNextPhase(): void {
    this.safe("nextPhase", () => {
      this.checkOpen();
      this.confirmBattle(false);
      if (this.closed || this.game.phase !== "battle") return;
      const seat = seatOf(this.game.turn);
      // Only a Battle Phase that G5 registered: soma(battleEnds) = battlePhases by construction.
      if (seat && this.seats[seat].battleTurns.has(this.game.turnCounter)) this.snapshotBattle(seat);
    });
  }

  private snapshotBattle(seat: Seat): void {
    const legal = this.player(seat).field.filter(monster => {
      if (!monster || monster.cardKind !== "monster") return false;
      if (monster.position !== "attack") return false;
      if (monster.cannotAttackThisTurn) return false;
      return this.game.getAttackAvailability(monster)?.ok ?? true;
    }).map(monster => ({ name: monster.name, used: numberOr(read(monster, "attacksUsedThisTurn"), 0) }));
    this.pendingBattle = { seat, turn: this.game.turnCounter, legal, attacked: this.seats[seat].attackedThisTurn };
  }

  private confirmBattle(force: boolean): void {
    const pending = this.pendingBattle;
    if (!pending) return;
    if (!force && this.game.phase === "battle" && this.game.turnCounter === pending.turn) return;
    this.pendingBattle = null;
    const left = pending.legal.length > 0;
    const label = pending.attacked ? (left ? "partial_with_candidate" : "attacked") : left ? "refused_with_candidate" : "no_candidate";
    this.classifyBattle(pending.seat, pending.turn, label, pending.legal);
  }

  /** Once per G5-registered Battle Phase (seat, turn); later calls for the same one are ignored. */
  private classifyBattle(seat: Seat, turnCounter: number, label: string, legal: PendingBattle["legal"]): void {
    const state = this.seats[seat];
    if (!state.battleTurns.has(turnCounter) || state.classifiedBattleTurns.has(turnCounter)) return;
    state.classifiedBattleTurns.add(turnCounter);
    const attacks = state.data.attacks;
    increment(attacks.battleEnds, label);
    for (const monster of legal) increment(attacks.legalLeftByCard, `${monster.name}|${monster.used >= 1 ? "second" : "first"}`);
    const turn = this.turnEntry(seat, turnCounter);
    if (turn) turn.battleEnd = label;
  }

  private onField(card: unknown): boolean {
    return SEATS.some(seat => this.player(seat).field.some(entry => entry === card));
  }

  private pairSeat(entry: unknown): Seat | null {
    return seatOf(read(entry, "controllerId")) ?? seatOf(this.game.turn);
  }

  /** Registered, applied (taken by the Damage Step) or expired (still present at turn_start, before the cleanup). */
  private scanPairs(atTurnStart: boolean): void {
    const raw: unknown = this.game.temporaryBattlePairEffects;
    const list = Array.isArray(raw) ? raw : [];
    if (list.length === 0 && this.knownPairs.size === 0) return;
    const present = new Map<string, unknown>();
    for (const entry of list) {
      const id = read(entry, "id");
      if (id === undefined || id === null) continue;
      present.set(String(id), entry);
    }
    const turn = this.game.turnCounter;
    for (const [id, entry] of present) {
      if (this.seenPairs.has(id)) continue;
      this.seenPairs.add(id);
      const seat = this.pairSeat(entry);
      const sourceCardId = integerOrNull(read(entry, "sourceCardId"));
      const expires = read(entry, "expiresOnTurn");
      this.knownPairs.set(id, {
        seat, sourceCardId, members: [read(entry, "firstTarget"), read(entry, "secondTarget")],
        expiresOnTurn: typeof expires === "number" ? expires : null,
      });
      if (seat) {
        this.seats[seat].data.pairEffects.registered += 1;
        this.pushTimeline("pairs", { turn, seat, outcome: "registered", reason: null, sourceCardId });
      }
    }
    for (const [id, known] of [...this.knownPairs]) {
      if (present.has(id)) {
        if (!atTurnStart || known.expiresOnTurn === null || known.expiresOnTurn >= turn) continue;
        this.knownPairs.delete(id);
        const reason = known.members.some(member => !this.onField(member)) ? "pair_left_field"
          : known.members.some(member => this.attackersThisTurn.has(member)) ? "pair_attacked_other" : "pair_no_attack";
        if (known.seat) {
          increment(this.seats[known.seat].data.pairEffects.expired, reason);
          this.pushTimeline("pairs", { turn, seat: known.seat, outcome: "expired", reason, sourceCardId: known.sourceCardId });
        }
        continue;
      }
      this.knownPairs.delete(id);
      if (known.seat) {
        this.seats[known.seat].data.pairEffects.applied += 1;
        this.pushTimeline("pairs", { turn, seat: known.seat, outcome: "applied", reason: null, sourceCardId: known.sourceCardId });
      }
    }
  }

  // ── Item 7: LP loss ──

  private sourceRel(seat: Seat, card: unknown): Diag24SourceRel {
    const owner = seatOf(read(card, "owner"));
    return owner === null ? "none" : owner === seat ? "self" : "opponent";
  }

  private damage(payload: unknown): void {
    if (this.closed) return;
    const seat = seatOf(read(payload, "target"));
    const amount = numberOr(read(payload, "amount"), 0);
    if (!seat || amount <= 0) return;
    const sourceCard = read(payload, "sourceCard");
    const transaction = this.game.activeDamageStepTransaction;
    if (transaction && transaction.timing === "damage_calculation" && sourceCard === transaction.attacker) {
      const role: Diag24BattleRole = transaction.directAttack ? "direct"
        : seatOf(transaction.attackerOwner) === seat ? "attacker" : "defender";
      const origin = role === "attacker" ? transaction.defender : transaction.attacker;
      this.lpEvent(seat, "battle", origin, role, refName(transaction.attacker), amount, this.lpAfter(seat, read(payload, "newLP")));
      return;
    }
    this.lpEvent(seat, "effect", sourceCard, null, null, amount, this.lpAfter(seat, read(payload, "newLP")));
  }

  /** The payload's LP after the change; else the player's LP field at this instant; else null (unknown). */
  private lpAfter(seat: Seat, value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const lp: unknown = this.player(seat).lp;
    return typeof lp === "number" && Number.isFinite(lp) ? lp : null;
  }

  private lpCost(payload: unknown): void {
    if (this.closed) return;
    const paid = numberOr(read(payload, "lpPaid"), 0);
    const seat = seatOf(read(payload, "player"));
    // lp_change with lpLost only was already seen as damage_inflicted.
    if (!seat || paid <= 0) return;
    this.lpEvent(seat, "cost", read(payload, "sourceCard"), null, null, paid, this.lpAfter(seat, read(payload, "after")));
  }

  private lpEvent(seat: Seat, cause: Diag24LpCause, source: unknown, battleRole: Diag24BattleRole | null,
    attackerCardName: string | null, amount: number, lpAfter: number | null): void {
    const ownTurn = this.game.turn === seat;
    const sourceRel = source ? this.sourceRel(seat, source) : "none";
    const sourceCardName = source ? refName(source) : null;
    const event: Diag24LpEvent = {
      turn: this.game.turnCounter, phase: textOrNull(this.game.phase), seat, ownTurn, cause, sourceRel,
      sourceCardId: source ? integerOrNull(read(source, "id")) : null, sourceCardName, battleRole, attackerCardName,
      amount: Math.round(amount), lpAfter: lpAfter === null ? null : Math.round(lpAfter),
    };
    const lpLoss = this.seats[seat].data.lpLoss;
    increment(ownTurn ? lpLoss.ownTurn : lpLoss.opponentTurn, `${cause}|${sourceRel}`, event.amount);
    increment(ownTurn ? lpLoss.ownTurnBySource : lpLoss.opponentTurnBySource, sourceCardName ?? "none", event.amount);
    if (battleRole) increment(lpLoss.battleByRole, `${ownTurn ? "own" : "opp"}|${battleRole}`, event.amount);
    const turn = this.turnEntry(seat);
    if (turn) increment(turn.lpLost, `${cause}|${sourceRel}`, event.amount);
    this.pushTimeline("lp", event);
    // An unknown LP after the change never closes the record.
    if (event.lpAfter !== null && event.lpAfter <= 0 && this.fatal === null) {
      this.fatal = event;
      this.close("lp_zero");
    }
  }

  // ── Item 8: graded lethal ──

  private lethal(seat: Seat, turn: Diag24Turn | null): void {
    const self = this.player(seat);
    const opponent = this.player(otherSeat(seat));
    const turnCounter = this.game.turnCounter;
    const real = evaluateVisibleBattle(self, opponent, turnCounter);
    const forbid: unknown = opponent.forbidDirectAttacksThisTurn;
    const view = {
      id: opponent.id, lp: opponent.lp, field: opponent.field, graveyard: opponent.graveyard, spellTrap: opponent.spellTrap,
      fieldSpell: opponent.fieldSpell ?? null, hand: { length: 0 },
      ...(typeof forbid === "boolean" ? { forbidDirectAttacksThisTurn: forbid } : {}),
    };
    const visible = evaluateVisibleBattle(self, view, turnCounter);
    const lp = opponent.lp || 0;
    let grade: string;
    if (real.lethal) grade = "proven";
    else if (visible.lethal) grade = "hand_only";
    else if (visible.damage >= lp && visible.uncertainties.length === 1 && visible.uncertainties[0] === "hidden_cards") grade = "facedown_only";
    else if (visible.damage >= lp && visible.uncertainties.some(reason => BATTLE_UNCERTAINTIES.has(reason))) grade = "battle_uncertain";
    else grade = "short";
    const lethal = this.seats[seat].data.lethal;
    lethal.projections += 1;
    increment(lethal.grades, grade);
    for (const reason of real.uncertainties) increment(lethal.uncertainty, reason);
    for (const reason of visible.uncertainties) increment(lethal.viewUncertaintyByGrade, `${grade}|${reason}`);
    if (real.uncertainties.includes("hidden_cards")) {
      if (opponent.hand.length > 0) lethal.hidden.handNonEmpty += 1;
      if (opponent.field.some(card => card?.isFacedown)) lethal.hidden.faceDownMonsters += 1;
      if (opponent.spellTrap.some(card => card?.isFacedown)) lethal.hidden.faceDownBackrow += 1;
    }
    this.seats[seat].lethalGrades.push({ turn: turnCounter, grade });
    if (turn) turn.lethalGrade = grade;
  }

  // ── Item 1: divergence samples ──

  private divergence(actor: Seat, state: SeatState, stage: string, details: unknown): void {
    if (this.closed) return;
    const divergence = state.data.divergence;
    divergence.comparisons += 1;
    const failed = stage === "ai_plan_execution_failed";
    if (!failed && read(details, "matched")) return;
    const severity = failed
      ? textOrNull(read(details, "mismatchReason")) ?? "action_failed"
      : textOrNull(read(details, "mismatchReason")) ?? textOrNull(read(details, "diffSeverity")) ?? "state_mismatch";
    const planned = read(details, "plannedAction");
    const plannedType = textOrNull(read(planned, "type")) ?? "-";
    const plannedCard = textOrNull(read(planned, "cardName")) ?? "-";
    const rawDiffs = read(details, "diffs");
    const prepared = (Array.isArray(rawDiffs) ? rawDiffs : []).slice(0, DIAG24_DIFFS_PER_SAMPLE).map(prepareDiff);
    for (const diff of prepared) {
      increment(divergence.byPathClass, `${diff.path}|${diff.cls}`);
      increment(divergence.byCardPathClass, `${plannedType}|${plannedCard}|${diff.path}|${diff.cls}`);
      if (diff.flags.includes("compact_identical")) divergence.compactIdentical += 1;
    }
    if (divergence.samples.length >= DIAG24_DIVERGENCE_SAMPLES_PER_SEAT) {
      divergence.samplesDropped += 1;
      increment(this.truncated, `divergence:${actor}`);
      return;
    }
    const sample: Diag24DivergenceSample = {
      turn: this.game.turnCounter, phase: textOrNull(this.game.phase), stage: failed ? "failed" : "compare", severity,
      plannedAction: actionLabel(planned), actualAction: actionLabel(read(details, "actualAction")),
      diffs: normalizeSample(prepared),
    };
    divergence.samples.push(sample);
  }

  // ── Lifecycle and projection ──

  /** Closes what is still pending; idempotent (freeze, or a projection after a guard trip). */
  freeze(): void {
    if (this.finished) return;
    try {
      this.finish();
    } catch (error) {
      increment(this.errors, `freeze:${shortMessage(error)}`);
    }
    this.finished = true;
  }

  private finish(): void {
    for (const seat of SEATS) {
      const state = this.seats[seat];
      if (state.decision) increment(state.data.paths.decisions, "open_at_end");
      state.decision = null;
      if (state.execPath !== null || state.pendingPath !== null) this.closeExecution(state);
      if (state.mainPhase) this.closeMainPhase(state, "duel_end");
    }
    if (this.closed) return;
    this.confirmBattle(true);
    this.endTurnEntries();
  }

  /**
   * The projection is computed once: the first call finalizes the collector's
   * state (unclassified battles, converted grades, hooks, opening) and later
   * calls return that same record, whatever `completed` they pass.
   */
  record(completed: ArenaDuelResult | null): Diag24Record {
    this.projected ??= this.project(completed);
    return this.projected;
  }

  private project(completed: ArenaDuelResult | null): Diag24Record {
    try {
      this.freeze();
      for (const seat of SEATS) {
        const state = this.seats[seat];
        const attacks = state.data.attacks;
        let unclassified = 0;
        for (const turn of state.battleTurns) {
          if (state.classifiedBattleTurns.has(turn)) continue;
          unclassified += 1;
          const entry = state.data.turns.find(candidate => candidate.turn === turn);
          if (entry && entry.battleEnd === null) entry.battleEnd = "unclassified";
        }
        if (unclassified > 0) increment(attacks.battleEnds, "unclassified", unclassified);
        const lethal = state.data.lethal;
        for (const { turn, grade } of state.lethalGrades) {
          const converted = completed?.type === "completed" && completed.reason === "lp_zero" &&
            completed.winner === seat && completed.turns === turn;
          if (converted) increment(lethal.converted, grade);
        }
        state.data.offers.triggers.hookPresent =
          typeof Reflect.get(this.player(seat).strategy ?? {}, "shouldActivateEffect") === "function";
        const opening = state.data.techZeroOpening;
        if (opening) {
          const starter = this.startSeat ?? this.firstTurnSeat;
          opening.firstOwnTurn = starter === seat ? 1 : 2;
          opening.c1 = this.combo.metrics(this.comboSummons)[seat].comboTurns[0] === opening.firstOwnTurn;
        }
      }
      const record: Diag24Record = {
        version: DIAG24_RECORD_VERSION,
        limits: diag24Limits(),
        errors: sortedCounter(this.errors),
        truncated: sortedCounter(this.truncated),
        closed: this.closed ? { ...this.closed } : null,
        fatal: this.fatal ? { ...this.fatal } : null,
        timeline: {
          summons: this.timeline.summons.map(entry => ({ ...entry })),
          lp: this.timeline.lp.map(entry => ({ ...entry })),
          pairs: this.timeline.pairs.map(entry => ({ ...entry })),
        },
        seats: { player: sortedSeat(this.seats.player.data), bot: sortedSeat(this.seats.bot.data) },
      };
      // Self-check: a record the parser refuses never leaves the plugin key.
      try {
        return parseDiag24(jsonValue(record, "presetMetrics.diag24"), "presetMetrics.diag24");
      } catch (error) {
        return emptyDiag24Record({ ...this.errors, [`parse:${shortMessage(error)}`]: 1 }, this.presets);
      }
    } catch (error) {
      return emptyDiag24Record({ ...this.errors, [`record:${shortMessage(error)}`]: 1 }, this.presets);
    }
  }
}
