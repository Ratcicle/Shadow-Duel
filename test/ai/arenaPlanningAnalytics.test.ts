import assert from "node:assert/strict";
import test from "node:test";
import { ArenaAnalytics, DuelTracker } from "../../src/core/ai/ArenaAnalytics.js";

test("Arena exports seed and measures decisions independently of the selected search", () => {
  const tracker = new DuelTracker(1, "techzero", "shadowheart", { seed: 0 });
  tracker.recordPlanningProgress({ stage: "ai_decision_before", actor: "player", t: 10 });
  tracker.recordPlanningProgress({ stage: "ai_turn_line_search", actor: "player", t: 28, plannedNodesEvaluated: 7 });
  tracker.recordPlanningProgress({ stage: "ai_decision_after", actor: "player", t: 30 });
  tracker.recordPlanningProgress({ stage: "ai_decision_before", actor: "bot", t: 40 });
  tracker.recordPlanningProgress({ stage: "ai_decision_after", actor: "bot", t: 45 });
  tracker.recordPlanningProgress({ stage: "ai_decision_before", actor: "player", t: 50 });
  tracker.recordPlanningProgress({ stage: "ai_main_phase_exit", actor: "player", t: 65 });
  tracker.recordPlanningProgress({ stage: "ai_main_phase_exit", actor: "player", t: 70 });
  const result = tracker.finalize("player", "lp_zero", { player: 8000, bot: 0 });
  assert.equal(result.avgDecisionTimeMs, 40 / 3);
  assert.equal(result.totalNodesVisited, 7);
  const analytics = new ArenaAnalytics(); analytics.recordDuel(result);
  const report = analytics.exportStrategicReport();
  assert.equal(report.duels[0]?.seed, 0);
  const own = requiredSeat(report.bots["player:techzero"]);
  assert.equal(own.decisionCount, 2);
  assert.equal(own.decisionTimeMs, 35);
});

function requiredSeat<T>(value: T | undefined): T { assert.ok(value); return value; }

test("Arena retains completion reasons and rejected-branch metrics for both seats, including planned stops", () => {
  const tracker = new DuelTracker(1, "techzero", "shadowheart");
  const snapshot = { turnCounter: 2, phase: "main1", turn: "player" };
  tracker.recordProgress("ai_turn_line_search", snapshot, {
    actor: "player", plannerUsed: true, plannerMode: "critical", plannerTurnMode: "mainOnly",
    plannerTerminationReason: "node_budget", plannerUnsupportedBranches: 2, plannerRepeatedStates: 3,
    plannedLineLength: 4, plannedNodesEvaluated: 20, plannedScore: 100,
    plannedFirstAction: { type: "synchro", cardName: "Tech-Zero Synchro" },
  });
  tracker.recordProgress("ai_turn_line_search", snapshot, {
    actor: "player", plannerUsed: false, plannerTerminationReason: "preferred_terminal",
    plannerUnsupportedBranches: 1, plannerRepeatedStates: 4, plannedNodesEvaluated: 8,
  });
  tracker.recordProgress("ai_turn_line_search", snapshot, {
    actor: "bot", plannerUsed: false, plannerTerminationReason: "unsupported_branches",
    plannerUnsupportedBranches: 5, plannerRepeatedStates: 0, plannedNodesEvaluated: 5,
  });
  const result = tracker.finalize("player", "lp_zero", { player: 8000, bot: 0 });
  const own = result.strategic.seats.player.planning;
  assert.equal(own.attempts, 2);
  assert.equal(own.used, 1);
  assert.deepEqual(own.terminationReasons, [{ name: "node_budget", count: 1 }, { name: "preferred_terminal", count: 1 }]);
  assert.equal(own.unsupportedBranches, 3);
  assert.equal(own.repeatedStates, 7);
  assert.equal(own.planSamples.length, 2);
  assert.deepEqual(own.planSamples.map(sample => ({
    reason: sample.terminationReason, unsupported: sample.unsupportedBranches,
    repeated: sample.repeatedStates, used: sample.used,
  })), [
    { reason: "node_budget", unsupported: 2, repeated: 3, used: true },
    { reason: "preferred_terminal", unsupported: 1, repeated: 4, used: false },
  ]);
  assert.equal(own.planSamples[1]?.firstAction, null);
  const opponent = result.strategic.seats.bot.planning;
  assert.deepEqual(opponent.terminationReasons, [{ name: "unsupported_branches", count: 1 }]);
  assert.equal(opponent.unsupportedBranches, 5);
  assert.equal(opponent.repeatedStates, 0);
});

test("Arena strategic report merges completion metrics across duels and keeps bounded plan samples", () => {
  const analytics = new ArenaAnalytics();
  for (let duel = 1; duel <= 2; duel++) {
    const tracker = new DuelTracker(duel, "shadowheart", "techzero");
    for (let attempt = 0; attempt < 4; attempt++) {
      tracker.recordProgress("ai_turn_line_search", { turnCounter: duel, phase: "main1", turn: "bot" }, {
        actor: "bot", plannerUsed: attempt % 2 === 0,
        plannerTerminationReason: attempt % 2 === 0 ? "requires_replan" : "no_candidates",
        plannerUnsupportedBranches: duel, plannerRepeatedStates: 2,
        plannedNodesEvaluated: 10, plannedLineLength: 2,
      });
    }
    analytics.recordDuel(tracker.finalize("bot", "lp_zero", { player: 0, bot: 8000 }));
  }
  const report = analytics.exportStrategicReport();
  const merged = report.bots["bot:techzero"]?.planning;
  assert.ok(merged);
  assert.equal(merged.attempts, 8);
  assert.equal(merged.used, 4);
  assert.deepEqual(merged.terminationReasons, [{ name: "no_candidates", count: 4 }, { name: "requires_replan", count: 4 }]);
  assert.equal(merged.unsupportedBranches, 12);
  assert.equal(merged.repeatedStates, 16);
  assert.equal(merged.planSamples.length, 5);
  assert.equal(merged.planSamples[1]?.terminationReason, "no_candidates");
  assert.equal(report.duels[0]?.bots.bot?.planning.unsupportedBranches, 4);
  assert.match(JSON.stringify(report), /"terminationReason":"requires_replan"/);
});

test("legacy Arena planner progress defaults absent completion metrics without losing existing samples", () => {
  const tracker = new DuelTracker(1, "shadowheart", "techzero");
  tracker.recordPlanningProgress({ stage: "ai_turn_line_search", actor: "bot", plannerUsed: true,
    plannedLineLength: 1, plannedNodesEvaluated: 5, plannerReason: "Legacy plan" });
  const planning = tracker.finalize("draw", "max_turns", { player: 8000, bot: 8000 }).strategic.seats.bot.planning;
  assert.deepEqual(planning.terminationReasons, [{ name: "unknown", count: 1 }]);
  assert.equal(planning.unsupportedBranches, 0);
  assert.equal(planning.repeatedStates, 0);
  assert.equal(planning.planSamples[0]?.terminationReason, null);
  assert.equal(planning.planSamples[0]?.reason, "Legacy plan");
});
