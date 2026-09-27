import assert from "node:assert/strict";
import test from "node:test";
import { BenchmarkGame, buildCases, parseBenchmarkArgs, summarizeBattles, type BattleObservation } from "../../scripts/run_techzero_benchmark.js";
import { DuelTracker } from "../../src/core/ai/ArenaAnalytics.js";
import { required } from "../helpers/fixtures.js";

test("benchmark pairs thirty games per opponent by seed and alternates Tech-Zero seats", () => {
  const cases = buildCases({ opponents: ["shadowheart", "luminarch"], duels: 30, randomSeed: 123 });
  assert.equal(cases.length, 60);
  for (const opponent of ["shadowheart", "luminarch"]) {
    const matchup = cases.filter(scenario => scenario.opponent === opponent);
    assert.equal(matchup.filter(scenario => scenario.techZeroSeat === "player").length, 15);
    assert.equal(matchup.filter(scenario => scenario.techZeroSeat === "bot").length, 15);
    assert.deepEqual(matchup.map(scenario => scenario.seed), Array.from({ length: 15 }, (_, index) => [123 + index, 123 + index]).flat());
    for (let index = 0; index < matchup.length; index += 2) {
      const first = matchup[index];
      const second = matchup[index + 1];
      assert.ok(first && second);
      assert.equal(first.seat1, second.seat2);
      assert.equal(first.seat2, second.seat1);
      assert.equal(first.pairIndex, second.pairIndex);
    }
  }
  assert.equal(new Set(cases.map(scenario => scenario.caseId)).size, 60);
});

test("mirror uses distinct seeds while uint32 wrap preserves the paired schedule", () => {
  const mirror = buildCases({ opponents: ["techzero"], duels: 30, randomSeed: 0 });
  assert.deepEqual(mirror.map(scenario => scenario.seed), Array.from({ length: 30 }, (_, index) => index));
  assert.ok(mirror.every(scenario => scenario.techZeroSeat === "both"));
  const wrap = buildCases({ opponents: ["void"], duels: 4, randomSeed: 0xffffffff });
  assert.deepEqual(wrap.map(scenario => scenario.seed), [0xffffffff, 0xffffffff, 0, 0]);
});

test("specialized and fallback variants generate identical cases and preserve seed zero", () => {
  const shared = ["--seed", "0", "--duels", "30", "--opponents", "techzero,dragon", "--out", "benchmark.json"];
  const specialized = parseBenchmarkArgs(["--variant", "specialized", ...shared]);
  const fallback = parseBenchmarkArgs(["--variant", "fallback", ...shared]);
  assert.equal(specialized.randomSeed, 0);
  assert.equal(fallback.variant, "fallback");
  assert.deepEqual(buildCases(specialized), buildCases(fallback));
  assert.equal(buildCases(parseBenchmarkArgs([])).length, 270);
});

test("benchmark rejects ambiguous scenarios and malformed command line options", () => {
  for (const args of [
    ["--variant", "other"], ["--seed", "-1"], ["--seed", "1.5"], ["--seed", "4294967296"],
    ["--seed"], ["--duels", "0"], ["--duels", "2.5"], ["--opponents", ""],
    ["--opponents", "void,void"], ["--opponents", "unknown"], ["--out"], ["--unknown"],
  ]) assert.throws(() => parseBenchmarkArgs(args));
  assert.throws(() => buildCases({ opponents: ["unknown"], duels: 1, randomSeed: 0 }));
});

test("benchmark combo counts use observed summons in one seat and turn with an actual Synchro boss", async t => {
  t.mock.method(console, "log", () => {});
  const game = new BenchmarkGame({ disableChains: true, randomSeed: 0 });
  t.after(() => game.dispose("benchmark_summon_test"));
  game.turnCounter = 2;
  for (const id of [503, 509, 515]) {
    await game.emit("after_summon", { card: { id }, player: game.player, method: "synchro", fromZone: "extraDeck" });
  }
  game.turnCounter = 3;
  for (const id of [503, 509, 516]) {
    await game.emit("after_summon", { card: { id }, player: game.bot, method: "special", fromZone: "graveyard" });
  }
  game.turnCounter = 4;
  await game.emit("after_summon", { card: { id: 517 }, player: game.bot, method: "synchro", fromZone: "extraDeck" });
  const metrics = game.comboMetrics();
  assert.deepEqual(required(metrics.player).comboTurns, [2]);
  assert.deepEqual(required(metrics.bot).comboTurns, []);
  assert.deepEqual(required(metrics.player).summonsById, { 503: 1, 509: 1, 515: 1, 516: 0, 517: 0 });
  assert.equal(game.summons.length, 7);
});

test("benchmark captures the opening and preserves mismatch details beyond the compact report limit", async t => {
  t.mock.method(console, "log", () => {});
  const game = new BenchmarkGame({ disableChains: true, randomSeed: 0 });
  t.after(() => game.dispose("benchmark_observation_test"));
  const tracker = new DuelTracker(1, "custom", "shadowheart");
  game._arenaTracker = tracker;
  await game.start();
  const opening = required(game.opening);
  assert.equal(opening.player.hand.length, 4);
  assert.equal(opening.bot.hand.length, 4);
  assert.ok(opening.player.deck.length > 0 && opening.bot.deck.length > 0);
  assert.equal(opening.random.seed, 0);
  for (let index = 0; index < 8; index += 1) {
    tracker.recordProgress("ai_plan_execution_compare", game, { actor: "player", matched: false,
      diffs: [{ index, expected: "before", actual: "after" }] });
  }
  assert.equal(game.mismatchSamples.length, 8);
  assert.deepEqual(game.mismatchSamples[7]?.detail, { actor: "player", matched: false,
    diffs: [{ index: 7, expected: "before", actual: "after" }] });
});

test("benchmark counts a proven lethal found before the budget limit and separates uncertain pressure", () => {
  const proven: BattleObservation = { seat: "player", turn: 2, damage: 8000, damageTaken: 0, destroyed: 0,
    lost: 0, score: 1, lethal: true, complete: false, uncertainties: ["search_budget"], attacks: [], nodes: 500 };
  const uncertain = { ...proven, lethal: false, uncertainties: ["hidden_cards"] };
  const wonLater = { duelNumber: 1, winner: "player", turns: 4, type: "completed", reason: "lp_zero", totalTimeMs: 0 } as const;
  const missed = summarizeBattles([proven, uncertain], wonLater);
  assert.equal(missed.provenLethalOpportunities, 1);
  assert.equal(missed.unconvertedProvenLethals, 1);
  const converted = summarizeBattles([proven, uncertain], { ...wonLater, turns: 2 });
  assert.equal(converted.unconvertedProvenLethals, 0);
  assert.equal(converted.battles[0]?.converted, true);
  for (const reason of ["max_turns", "timeout"] as const) {
    const adjudicated = summarizeBattles([proven], { ...wonLater, turns: 2, type: "draw", reason });
    assert.equal(adjudicated.unconvertedProvenLethals, 1, "LP advantage at a cutoff does not convert lethal");
    assert.equal(adjudicated.battles[0]?.converted, false);
  }
});
