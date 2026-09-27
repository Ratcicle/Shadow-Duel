import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { analyzeReports } from "../../scripts/analyze_techzero_benchmark.js";
import { required } from "../helpers/fixtures.js";

function seat() {
  return { decisionCount: 1, decisionTimeMs: 10, failedActions: 0, blockedActions: 0,
    invalidByCard: [] as Array<{ name: string; count: number }>, blockedByCard: [] as Array<{ name: string; count: number }>,
    planning: { executionMismatches: 0, failedExecutions: 0, unsupportedBranches: 0, repeatedStates: 0,
      terminationReasons: [] as Array<{ name: string; count: number }> } };
}

function scenario(opponent: string, index: number, reason = "lp_zero", winner = "player") {
  const mirror = opponent === "techzero";
  const reversed = !mirror && index % 2 === 0;
  return { caseId: `${opponent}:${index}`, opponent, duelIndex: index, pairIndex: mirror ? index - 1 : Math.floor((index - 1) / 2),
    seed: 7 + (mirror ? index - 1 : Math.floor((index - 1) / 2)),
    seat1: reversed ? opponent : "techzero", seat2: reversed ? "techzero" : opponent,
    techZeroSeat: mirror ? "both" : reversed ? "bot" : "player",
    result: { winner, turns: 5, type: reason === "lp_zero" ? "completed" : "draw", reason },
    opening: { firstSeat: "player", random: { seed: 7, state: 123, calls: 45 },
      player: { hand: [501, 502, 503, 504], deck: [505], extraDeck: [515] },
      bot: { hand: [101, 102, 103, 104], deck: [105], extraDeck: [121] } },
    actualCombos: { player: { comboTurns: [] as number[], summonsById: { "503": 0, "509": 0, "515": 0, "516": 0, "517": 0 } },
      bot: { comboTurns: [] as number[], summonsById: { "503": 0, "509": 0, "515": 0, "516": 0, "517": 0 } } },
    provenLethalOpportunities: 0, unconvertedProvenLethals: 0,
    metrics: { endReason: reason, totalNodesVisited: 100, totalTimeMs: 1000, avgDecisionTimeMs: 10 },
    strategic: { participants: { player: seat(), bot: seat() }, errors: [] as string[], warnings: [] as string[] },
    consoleErrors: [] as string[], consoleWarnings: [] as string[],
    mismatchSamples: [] as Array<{ stage: string; detail: { actor: string; mismatchReason: string;
      diffs: Array<{ path: string; severity: string }> } }> };
}

function report(variant: string, cases: ReturnType<typeof scenario>[]) {
  const opponents = [...new Set(cases.map(entry => entry.opponent))];
  return { version: 1, variant, complete: true, randomSeed: 7, opponents,
    duelsPerOpponent: cases.length / opponents.length, plannedCases: cases.length, completedCases: cases.length, results: cases };
}

test("analysis excludes LP adjudication at the turn limit from normal wins and preserves seat denominators", () => {
  const specialized = report("specialized", [scenario("shadowheart", 1), scenario("shadowheart", 2, "max_turns", "bot")]);
  const fallback = report("fallback", [scenario("shadowheart", 1, "lp_zero", "bot"), scenario("shadowheart", 2, "timeout", "draw")]);
  const analysis = analyzeReports(specialized, fallback);
  assert.equal(analysis.validation.pairedCases, 2);
  const row = required(analysis.rows[0]);
  assert.equal(row.specialized.outcomes.lpZero.wins, 1);
  assert.equal(row.specialized.outcomes.maxTurns, 1);
  assert.equal(row.specialized.normalWinRatePercent, 100);
  assert.equal(row.specialized.seats.player.normalWinRatePercent, 100);
  assert.equal(row.specialized.seats.bot.normalWinRatePercent, null);
  assert.equal(row.fallback.outcomes.timeout, 1);
  assert.equal(row.fallback.outcomes.draws, 1);
  assert.equal(row.fallback.normalWinRatePercent, 0);
});

test("mirror reports both seat outcomes and leaves archetype win rate undefined", () => {
  const cases = [scenario("techzero", 1), scenario("techzero", 2, "lp_zero", "bot")];
  const row = required(analyzeReports(report("specialized", cases), report("fallback", structuredClone(cases))).rows[0]);
  assert.equal(row.specialized.normalWinRatePercent, null);
  assert.equal(row.specialized.outcomes.lpZero.wins, null);
  assert.equal(row.specialized.seats.player.normalWinRatePercent, 50);
  assert.equal(row.specialized.seats.bot.normalWinRatePercent, 50);
  assert.equal(row.specialized.decisions.count, 4);
});

test("analysis weights decision latency and classifies actual combos, invalid actions and raw mismatches", () => {
  const first = scenario("void", 1);
  first.strategic.participants.player.decisionCount = 2;
  first.strategic.participants.player.decisionTimeMs = 20;
  first.strategic.participants.player.failedActions = 1;
  first.strategic.participants.player.invalidByCard = [{ name: "Tech-Zero Core", count: 1 }];
  first.strategic.participants.player.planning.executionMismatches = 1;
  first.actualCombos.player.comboTurns = [2];
  first.actualCombos.player.summonsById["515"] = 1;
  first.provenLethalOpportunities = 2;
  first.unconvertedProvenLethals = 1;
  first.consoleErrors = ["Action failed\nstack line"];
  first.mismatchSamples = [{ stage: "ai_plan_execution_compare", detail: { actor: "player", mismatchReason: "hand_deck_mismatch",
    diffs: [{ path: "bot.deckSize", severity: "hand_deck_mismatch" }] } }];
  const second = scenario("void", 2, "lp_zero", "bot");
  second.strategic.participants.bot.decisionTimeMs = 100;
  const cases = [first, second];
  const row = required(analyzeReports(report("specialized", cases), report("fallback", structuredClone(cases))).rows[0]).specialized;
  assert.equal(row.decisions.count, 3);
  assert.equal(row.decisions.meanMs, 40);
  assert.equal(row.search.turnLineNodesAllSeats, 200);
  assert.equal(row.combos.duelsWithCombo, 1);
  assert.equal(row.combos.turnsWithCombo, 1);
  assert.equal(row.combos.summonsById["515"], 1);
  assert.deepEqual(row.lethal, { proven: 2, unconverted: 1 });
  assert.equal(row.execution.failedActions, 1);
  assert.equal(row.execution.invalidByCard["Tech-Zero Core"], 1);
  assert.equal(row.mismatches.byReason.hand_deck_mismatch, 1);
  assert.equal(row.mismatches.byDiffPath["bot.deckSize"], 1);
  assert.equal(row.errors.duelsWithErrors, 1);
  assert.equal(row.errors.consoleByMessage["Action failed"], 1);
});

test("analysis rejects unmatched cases, seeds, seat assignments, openings and unfinished reports", () => {
  const specialized = report("specialized", [scenario("void", 1), scenario("void", 2)]);
  for (const mutate of [
    (other: typeof specialized) => { other.results.pop(); },
    (other: typeof specialized) => { required(other.results[0]).seed += 1; },
    (other: typeof specialized) => { required(other.results[0]).seat1 = "dragon"; },
    (other: typeof specialized) => { required(other.results[0]).opening.player.hand.reverse(); },
    (other: typeof specialized) => { other.results[1] = required(other.results[0]); },
    (other: typeof specialized) => { other.complete = false; },
  ]) {
    const fallback = structuredClone(specialized);
    fallback.variant = "fallback";
    mutate(fallback);
    assert.throws(() => analyzeReports(specialized, fallback));
  }
});

test("analysis combines disjoint opponent reports and rejects overlapping or incompatible batches", () => {
  const first = report("specialized", [scenario("void", 1), scenario("void", 2)]);
  const second = report("specialized", [scenario("dragon", 1), scenario("dragon", 2)]);
  const baseline = [first, second].map(entry => ({ ...structuredClone(entry), variant: "fallback" }));
  const result = analyzeReports([first, second], baseline);
  assert.equal(result.validation.pairedCases, 4);
  assert.deepEqual(result.rows.map(row => row.opponent), ["void", "dragon"]);
  assert.throws(() => analyzeReports([first, first], baseline), /overlap|duplicate/i);
  assert.throws(() => analyzeReports([first, { ...second, randomSeed: 8 }], baseline), /configuration/i);
});

test("analysis CLI writes JSON and Markdown without modifying either report", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-duel-benchmark-analysis-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const specialized = report("specialized", [scenario("void", 1), scenario("void", 2)]);
  const fallback = report("fallback", structuredClone(specialized.results));
  const first = path.join(directory, "specialized.json");
  const second = path.join(directory, "fallback.json");
  const third = path.join(directory, "specialized-dragon.json");
  const fourth = path.join(directory, "fallback-dragon.json");
  const json = path.join(directory, "summary.json");
  const markdown = path.join(directory, "summary.md");
  const originals = [JSON.stringify(specialized), JSON.stringify(fallback)];
  fs.writeFileSync(first, required(originals[0]));
  fs.writeFileSync(second, required(originals[1]));
  const extra = [scenario("dragon", 1), scenario("dragon", 2)];
  fs.writeFileSync(third, JSON.stringify(report("specialized", extra)));
  fs.writeFileSync(fourth, JSON.stringify(report("fallback", extra)));
  const result = spawnSync(process.execPath, ["--import=tsx", "scripts/analyze_techzero_benchmark.ts",
    "--specialized", first, "--specialized", third, "--fallback", second, "--fallback", fourth,
    "--json", json, "--markdown", markdown], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual([fs.readFileSync(first, "utf8"), fs.readFileSync(second, "utf8")], originals);
  const summary: unknown = JSON.parse(fs.readFileSync(json, "utf8"));
  assert.ok(summary && typeof summary === "object");
  assert.deepEqual(Reflect.get(summary, "validation"), { pairedCases: 4, identicalSeeds: true,
    identicalOpenings: true, randomSeed: 7, duelsPerOpponent: 2 });
  assert.match(fs.readFileSync(markdown, "utf8"), /void/);
});
