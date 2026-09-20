import assert from "node:assert/strict";
import test from "node:test";
import { gameTreeSearch } from "../../src/core/ai/GameTreeSearch.js";
import { fingerprintPlanningState } from "../../src/core/ai/common/stateFingerprint.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { AiCardInput, AiStateInput } from "../../src/core/contracts/aiState.js";
import { record, required } from "../helpers/fixtures.js";

function player(id: string) {
  return {
    id, name: id, lp: 8000, hand: [] as AiCardInput[], field: [] as AiCardInput[],
    graveyard: [] as AiCardInput[], extraDeck: [] as AiCardInput[],
    spellTrap: [] as AiCardInput[], fieldSpell: null, summonCount: 0, debug: false,
  };
}

function game() {
  return { bot: player("bot"), player: player("player"), turn: "bot", phase: "main1", turnCounter: 1 };
}

const noop: AIAction = { type: "position_change", fieldIndex: 0, toPosition: "attack" };
const summonFirst: AIAction = { type: "summon", index: 0 };
const summonSecond: AIAction = { type: "summon", index: 1 };

interface CacheObservation {
  lookups: string[];
  hits: number;
  writes: Array<{ key: string; value: unknown }>;
}

// The first Map constructed by gameTreeSearch is its call-local table. Maps
// used by fingerprints, counters, or strategy code must not count as hits.
function observeCache<Result>(
  run: () => Result,
  seeds: CacheObservation["writes"] = [],
): { result: Result; cache: CacheObservation } {
  const NativeMap = globalThis.Map;
  const cache: CacheObservation = { lookups: [], hits: 0, writes: [] };
  let table: object | undefined;
  class ObservedMap<Key, Value> extends NativeMap<Key, Value> {
    constructor(entries?: Iterable<readonly [Key, Value]> | null) {
      super(entries);
      if (!table) {
        table = this;
        // Test-only injection of entries from other query contexts. Bypass
        // the observer's write counter; production still owns a fresh table.
        for (const seed of seeds) {
          Reflect.apply(NativeMap.prototype.set, this, [seed.key, seed.value]);
        }
      }
    }
    override has(key: Key): boolean {
      if (this === table) cache.lookups.push(String(key));
      return super.has(key);
    }
    override get(key: Key): Value | undefined {
      if (this === table) {
        cache.lookups.push(String(key));
        if (super.has(key)) cache.hits++;
      }
      return super.get(key);
    }
    override set(key: Key, value: Value): this {
      if (this === table) cache.writes.push({ key: String(key), value });
      return super.set(key, value);
    }
  }
  // Keep pre-existing counter Maps recognizable while observing new Maps.
  Object.defineProperty(ObservedMap, Symbol.hasInstance, {
    value: (value: unknown) => value instanceof NativeMap,
  });
  globalThis.Map = ObservedMap;
  try { return { result: run(), cache }; }
  finally { globalThis.Map = NativeMap; }
}

test("GameTree evaluates different summon compositions instead of reusing the first branch", () => {
  const input = game();
  input.bot.hand.push(
    { instanceId: 1, name: "Small", cardKind: "monster", atk: 1000 },
    { instanceId: 2, name: "Large", cardKind: "monster", atk: 3000 },
  );
  const original = structuredClone(input);
  let generationCalls = 0;
  const evaluatedCompositions: string[][] = [];
  const { result, cache } = observeCache(() => gameTreeSearch(input, {
    generateMainPhaseActions(state: AiStateInput): AIAction[] {
      generationCalls++;
      if (state.bot?.id === "bot") return [summonFirst, summonFirst, summonSecond];
      evaluatedCompositions.push((state.player?.field || []).map(card => card.name || ""));
      return [noop];
    },
  }, input.bot, 2));
  console.log("gametree-baseline compositions", JSON.stringify({ result, generationCalls, hits: cache.hits, writes: cache.writes.length, evaluatedCompositions }));
  assert.deepEqual(evaluatedCompositions, [["Small"], ["Small"], ["Large"]]);
  assert.equal(result.action, summonSecond);
  // Existing leaf evaluator: 3000 / 500 plus the remaining hand card (0.5),
  // then the unchanged discounts at remaining depths 1 and 2.
  assert.equal(result.score, 6.5 * Math.pow(0.85, 3) * Math.pow(0.85, 2));
  assert.equal(generationCalls, 4);
  assert.equal(cache.hits, 0);
  assert.equal(cache.writes.length, 4);
  // The second Small and Large queries enter with identical search context.
  // Their state fingerprints alone must keep these entries apart.
  const secondSmall = record(JSON.parse(required(cache.lookups[2])));
  const large = record(JSON.parse(required(cache.lookups[3])));
  const { state: smallState, ...smallContext } = secondSmall;
  const { state: largeState, ...largeContext } = large;
  assert.notEqual(smallState, largeState);
  assert.deepEqual(smallContext, largeContext);
  assert.deepEqual(input, original);
});

test("GameTree reuses equivalent clones only when the entry query context matches", () => {
  const input = game();
  let generationCalls = 0;
  const { result, cache } = observeCache(() => gameTreeSearch(input, {
    generateMainPhaseActions(): AIAction[] { generationCalls++; return [noop, noop, noop]; },
  }, input.bot, 2));
  console.log("gametree-baseline equivalent", JSON.stringify({ result, generationCalls, hits: cache.hits, writes: cache.writes.length }));
  assert.equal(result.action, noop);
  assert.equal(result.score, 0);
  // First child enters with alpha=-Infinity; the next two enter with alpha=0.
  // Only the third child has an actually equivalent stored query.
  assert.equal(generationCalls, 3);
  assert.equal(cache.hits, 1);
  assert.equal(cache.writes.length, 3);
  assert.equal(result.transpositionHits, 3); // public legacy name = table size
  const queries = cache.lookups.map(key => record(JSON.parse(key)));
  assert.equal(queries[0]?.alpha, "-Infinity");
  assert.equal(queries[0]?.beta, "Infinity");
  assert.deepEqual(queries.slice(1).map(query => query.alpha), ["-Infinity", 0, 0]);
  // The root write retains its entry window, not the alpha=0 left by the loop.
  assert.equal(required(cache.writes.at(-1)).key, cache.lookups[0]);
});

for (const [field, other] of [
  ["perspective", "player"], ["depth", 3], ["isMaximizing", false],
  ["alpha", 0], ["beta", 0], ["alpha", "Infinity"], ["beta", "-Infinity"],
] as const) {
  test(`GameTree ignores a stored result with different ${field}=${other}`, () => {
    const input = game();
    let generationCalls = 0;
    const run = () => gameTreeSearch(input, {
      generateMainPhaseActions(): AIAction[] { generationCalls++; return [noop, noop, noop]; },
    }, input.bot, 2);
    const original = observeCache(run);
    const root = required(original.cache.writes.at(-1));
    const context = record(JSON.parse(root.key));
    assert.ok(Object.hasOwn(context, field));
    assert.notEqual(context[field], other);
    generationCalls = 0;
    const poisoned = observeCache(run, [{
      key: JSON.stringify({ ...context, [field]: other }),
      value: { result: { value: 999, action: summonFirst }, depth: 99 },
    }]);
    assert.equal(poisoned.result.score, 0);
    assert.equal(poisoned.result.action, noop);
    assert.equal(generationCalls, 3);
    assert.equal(poisoned.cache.hits, 1); // only the third equivalent child

    generationCalls = 0;
    const exact = observeCache(run, [root]);
    assert.equal(generationCalls, 0);
    assert.equal(exact.cache.hits, 1);
    assert.equal(exact.cache.writes.length, 0);
    assert.equal(exact.result.score, original.result.score);
    assert.equal(exact.result.action, original.result.action);
  });
}

test("GameTree fingerprints the same reduced projection at root and descendants", () => {
  const input = game();
  input.bot.id = "custom-self";
  input.player.id = "custom-opponent";
  input.turn = input.bot.id;
  input.bot.field.push({ instanceId: 1, name: "Host", atk: 1000, counters: new Map([["charge", 2]]) });
  const projected: string[] = [];
  const run = () => gameTreeSearch(input, {
    generateMainPhaseActions(state: AiStateInput): AIAction[] {
      projected.push(fingerprintPlanningState(state));
      return [noop];
    },
  }, input.bot, 3);
  const first = observeCache(run);
  assert.deepEqual(first.cache.lookups.map(key => record(JSON.parse(key)).state), projected);
  assert.equal(projected.length, 3);
  assert.deepEqual(first.cache.lookups.map(key => {
    const query = record(JSON.parse(key));
    return [query.perspective, query.depth, query.isMaximizing];
  }), [
    ["custom-self", 3, true],
    ["custom-opponent", 2, false],
    ["custom-self", 1, true],
  ]);

  const host = required(input.bot.field[0]);
  Object.assign(host, { equippedTo: host, equipTarget: host, equips: [host], boundMonsterTarget: host, boundTrapSource: host });
  // These properties are not in the GameTree clone. A read would prove that
  // root cache identity accidentally inspected more than its search profile.
  const forbidden = () => { throw new Error("outside GameTree projection"); };
  for (const key of ["deck", "banished", "additionalNormalSummonPermissions", "effectActivationRestrictions"]) {
    Object.defineProperty(input.bot, key, { get: forbidden, enumerable: true });
  }
  for (const key of ["effectEngine", "usedThisTurn", "temporaryEventEffects", "ui"]) {
    Object.defineProperty(input, key, { get: forbidden, enumerable: true });
  }
  projected.length = 0;
  const second = observeCache(run);
  assert.deepEqual(second.cache.lookups, first.cache.lookups);
  assert.deepEqual(second.result, first.result);
  assert.deepEqual(second.cache.lookups.map(key => record(JSON.parse(key)).state), projected);
});

test("GameTree fingerprint failure bypasses every cache lookup and write without randomness", () => {
  const input = game();
  const cycle = {};
  Object.assign(cycle, { cycle });
  const host = { instanceId: 1, name: "Host", atk: 1000, effectMarkers: cycle };
  input.bot.field.push(host);
  const before = structuredClone(input);
  let generationCalls = 0;
  const random = Math.random;
  let randomCalls = 0;
  Math.random = () => { randomCalls++; throw new Error("unexpected randomness"); };
  try {
    const { result, cache } = observeCache(() => gameTreeSearch(input, {
      generateMainPhaseActions(): AIAction[] { generationCalls++; return [noop, noop, noop]; },
    }, input.bot, 2));
    assert.equal(result.action, noop);
    assert.equal(result.score, 2 * Math.pow(0.85, 3) * Math.pow(0.85, 2));
    assert.equal(result.transpositionHits, 0);
    assert.equal(generationCalls, 4);
    assert.deepEqual(cache.lookups, []);
    assert.deepEqual(cache.writes, []);
    assert.equal(randomCalls, 0);
    assert.deepEqual(input, before);
  } finally { Math.random = random; }
});

test("GameTree tables remain local to each public search invocation", () => {
  const input = game();
  const counts: number[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let calls = 0;
    const { cache } = observeCache(() => gameTreeSearch(input, {
      generateMainPhaseActions(): AIAction[] { calls++; return [noop, noop, noop]; },
    }, input.bot, 2));
    counts.push(calls);
    assert.equal(cache.hits, 1);
    assert.equal(cache.writes.length, 3);
  }
  assert.deepEqual(counts, [3, 3]);
});

test("GameTree preserves public error handling for an unsearchable input", () => {
  const input = game();
  Object.defineProperty(input, "bot", { get() { throw new Error("invalid player projection"); } });
  const { result, cache } = observeCache(() => gameTreeSearch(input, {
    bot: { debug: false },
    generateMainPhaseActions(): AIAction[] { assert.fail("invalid state must not generate"); },
  }, null, 2));
  assert.deepEqual(result, {
    action: null, score: 0, depth: 2, confidence: 0, error: "invalid player projection",
  });
  assert.deepEqual(cache.lookups, []);
  assert.deepEqual(cache.writes, []);
});

for (const [name, change] of [
  ["stats", (card: AiCardInput) => { card.atk = 1500; }],
  ["level", (card: AiCardInput) => { card.level = 5; }],
  ["position", (card: AiCardInput) => { card.position = "defense"; }],
  ["face down", (card: AiCardInput) => { card.isFacedown = true; }],
  ["counter distribution", (card: AiCardInput) => { card.counters = new Map([["charge", 1], ["spore", 2]]); }],
  ["instance", (card: AiCardInput) => { card.instanceId = 2; }],
] as const) {
  test(`GameTree keys retain ${name} already represented by its clone`, () => {
    const input = game();
    const host: AiCardInput = { instanceId: 1, name: "Host", atk: 1000, level: 4, position: "attack", isFacedown: false, counters: new Map([["charge", 2], ["spore", 1]]) };
    input.bot.field.push(host);
    const run = () => gameTreeSearch(input, {
      generateMainPhaseActions(): AIAction[] { return [noop]; },
    }, input.bot, 1);
    const first = observeCache(run);
    change(host);
    const changedInput = structuredClone(input);
    const second = observeCache(run);
    assert.notEqual(second.cache.lookups[0], first.cache.lookups[0]);
    assert.deepEqual(input, changedInput);
  });
}
