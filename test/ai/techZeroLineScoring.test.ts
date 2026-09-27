import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import type { AIPlanningContext } from "../../src/core/contracts/ai.js";
import type { AiStateShape, SimulatedCardState, SimulatedPlayerState } from "../../src/core/contracts/aiState.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { TECH_ZERO_MILESTONES as M } from "../../src/core/ai/techzero/knowledge.js";
import { getTechZeroPlanningProfile, scoreTechZeroLineMilestones, scoreTechZeroLineTerminal,
  describeTechZeroPlannedLine } from "../../src/core/ai/techzero/linePlanning.js";
import { cardDefinition } from "../helpers/fixtures.js";

function card(id: number): SimulatedCardState {
  return createPlanningCopy().cloneCardForSim(new Card(cardDefinition(id), "bot"));
}
function player(id: string, changes: Partial<SimulatedPlayerState> = {}): SimulatedPlayerState {
  return { id, lp: 8000, field: [], hand: [], graveyard: [], banished: [], spellTrap: [],
    fieldSpell: null, extraDeck: [], deck: Array.from({ length: 10 }, () => card(501)),
    summonCount: 0, additionalNormalSummons: 0, ...changes };
}
function state(changes: Partial<SimulatedPlayerState> = {}, opponent: Partial<SimulatedPlayerState> = {}): AiStateShape {
  return { bot: player("bot", changes), player: player("player", opponent),
    phase: "main1", turn: "bot", turnCounter: 2 };
}
function terminal(initialState: AiStateShape, finalState: AiStateShape, changes: Partial<AIPlanningContext> = {}) {
  const context = { initialState, finalState, baseScore: 0, ...changes };
  return scoreTechZeroLineTerminal({ ...context, milestoneScore: scoreTechZeroLineMilestones(context).scoreDelta });
}
function protect(boss: SimulatedCardState) {
  boss.protectionEffects = [
    { type: "battle_destruction", source: "Tech-Zero Atomic Slasher", duration: "end_of_next_turn", grantedOnTurn: 2, expiresOnTurn: 3 },
    { type: "effect_destruction", source: "Tech-Zero Atomic Slasher", duration: "end_of_next_turn", grantedOnTurn: 2, expiresOnTurn: 3, sourceOwner: "opponent" },
  ];
  return boss;
}

test("Tech-Zero enables a bounded main-only planning profile for visible engine access", () => {
  const profile = getTechZeroPlanningProfile(state({ hand: [card(502), card(501)] }));
  assert.equal(profile.enabled, true);
  assert.equal(profile.turnMode, "mainOnly");
  assert.ok(profile.maxDepth >= 6 && profile.maxDepth <= 12);
  assert.ok(profile.nodeBudget <= 2000 && profile.nodeBudget > 0);
  assert.equal(getTechZeroPlanningProfile({ ...state(), phase: "battle" }).enabled, false);
  assert.equal(getTechZeroPlanningProfile(state()).enabled, false);
  const otherSeat = state(); otherSeat.player.hand = [card(502), card(501)]; otherSeat.turn = "player";
  assert.equal(getTechZeroPlanningProfile(otherSeat).enabled, true);
});

test("Multimodal milestone requires active M and reachable Core", () => {
  const initialState = state(), multimodal = card(503), core = card(501);
  const finalState = state({ field: [multimodal, core] });
  assert.ok(scoreTechZeroLineMilestones({ initialState, finalState }).milestones.includes(M.MACHINE_ACCESS));
  multimodal.effectsNegated = true;
  assert.ok(!scoreTechZeroLineMilestones({ initialState, finalState }).milestones.includes(M.MACHINE_ACCESS));
  multimodal.effectsNegated = false;
  finalState.bot.field = [multimodal]; finalState.bot.graveyard = [core];
  assert.ok(!scoreTechZeroLineMilestones({ initialState, finalState }).milestones.includes(M.MACHINE_ACCESS));
});

test("Portal milestone counts three useful distinct field names rather than duplicate copies or GY promises", () => {
  const initialState = state();
  const finalState = state({ field: [card(509), card(503), card(502), card(501)] });
  assert.ok(scoreTechZeroLineMilestones({ initialState, finalState }).milestones.includes(M.PORTAL_RECOVERY));
  finalState.bot.field = [card(509), card(501), card(501), card(502)];
  finalState.bot.graveyard = [card(503)];
  assert.ok(!scoreTechZeroLineMilestones({ initialState, finalState }).milestones.includes(M.PORTAL_RECOVERY));
});

test("Synchro Tuner milestone uses legal boss materials, including negated M's printed Tuner role", () => {
  const initialState = state(), multimodal = card(503);
  multimodal.effectsNegated = true;
  const finalState = state({ field: [multimodal, card(514)], extraDeck: [card(516)] });
  assert.ok(scoreTechZeroLineMilestones({ initialState, finalState }).milestones.includes(M.SYNCHRO_TUNER));
  finalState.bot.field = [card(501), card(514)];
  assert.ok(!scoreTechZeroLineMilestones({ initialState, finalState }).milestones.includes(M.SYNCHRO_TUNER));
});

test("only protection on the actual boss earns the Slasher milestone and expires normally", () => {
  const initialState = state(), boss = card(517), slasher = protect(card(510));
  const finalState = state({ field: [boss], graveyard: [slasher] });
  const unprotected = terminal(initialState, finalState);
  assert.ok(!scoreTechZeroLineMilestones({ initialState, finalState }).milestones.includes(M.PROTECTED_BOSS));
  protect(boss);
  assert.ok(scoreTechZeroLineMilestones({ initialState, finalState }).milestones.includes(M.PROTECTED_BOSS));
  assert.ok(terminal(initialState, finalState) > unprotected);
  finalState.turnCounter = 4;
  assert.ok(!scoreTechZeroLineMilestones({ initialState, finalState }).milestones.includes(M.PROTECTED_BOSS));
});

test("real recovery survives in the score only while its required targets remain", () => {
  const initialState = state(), core = card(501);
  const finalState = state({ field: [card(516)], hand: [card(502)], graveyard: [core] });
  assert.ok(scoreTechZeroLineMilestones({ initialState, finalState }).milestones.includes(M.FOLLOW_UP));
  const score = terminal(initialState, finalState);
  finalState.bot.graveyard = [];
  assert.ok(!scoreTechZeroLineMilestones({ initialState, finalState }).milestones.includes(M.FOLLOW_UP));
  assert.ok(terminal(initialState, finalState) < score);
});

test("larger boss does not beat protected pressure with real reconstruction just for having a higher level", () => {
  const initialState = state();
  const protectedLancer = state({ field: [protect(card(516))], hand: [card(502)], graveyard: [card(501)] });
  const lonelySingularity = state({ field: [card(517)] });
  assert.ok(terminal(initialState, protectedLancer) > terminal(initialState, lonelySingularity));
});

test("available direct lethal beats a protected board that cannot finish the duel", () => {
  const initialState = state({}, { lp: 6000 });
  const lancer = { ...card(516), position: "attack" as const, attackLimitThisTurn: 2 };
  const lethal = state({ field: [lancer] }, initialState.player);
  const defense = state({ field: [protect(card(515)), card(509)] }, initialState.player);
  assert.ok(terminal(initialState, lethal) > terminal(initialState, defense));
  lethal.bot.forbidDirectAttacksThisTurn = true;
  assert.ok(terminal(initialState, lethal) < terminal(initialState, defense));
});

test("public attack pressure can favor Singularity over a smaller protected defensive boss", () => {
  const initialState = state({}, { field: [{ ...card(517), atk: 3800, position: "attack" }] });
  const pressure = state({ field: [{ ...card(517), position: "attack" }, card(510)] }, initialState.player);
  const defense = state({ field: [protect(card(515)), card(509)] }, initialState.player);
  assert.ok(terminal(initialState, pressure) > terminal(initialState, defense));
});

test("a boss that survives a public threat scores above an exposed combo board", () => {
  const initialState = state({}, { field: [{ ...card(517), atk: 3200, position: "attack" }] });
  const setup = state({ field: [card(509), card(503), card(501)] }, initialState.player);
  const boss = state({ field: [card(517)] }, initialState.player);
  assert.ok(terminal(initialState, boss) > terminal(initialState, setup));
});

test("one opposing attacker cannot destroy every additional combo body in one attack", () => {
  const threat = { ...card(517), atk: 3000, position: "attack" as const };
  const initialState = state({}, { field: [threat] });
  const oneBody = state({ field: [card(509)] }, initialState.player);
  const threeBodies = state({ field: [card(509), card(503), card(502)] }, initialState.player);
  assert.ok(terminal(initialState, threeBodies) > terminal(initialState, oneBody));
});

test("milestones compare final against initial, so a restored state cannot farm combo credit", () => {
  const finalState = state({ field: [card(509), card(503), card(502), card(501)] });
  const sequence: NonNullable<AIPlanningContext["sequence"]> = Array.from({ length: 6 }, () => ({ type: "monsterEffect", cardName: "Tech-Zero Multimodal Machine" }));
  assert.equal(scoreTechZeroLineMilestones({ initialState: finalState, finalState, sequence }).scoreDelta, 0);
  assert.ok(terminal(finalState, finalState, { sequence }) < terminal(finalState, finalState));
  assert.equal(scoreTechZeroLineMilestones({ initialState: state(), finalState, sequence }).scoreDelta,
    scoreTechZeroLineMilestones({ initialState: state(), finalState, sequence: sequence.slice(0, 1) }).scoreDelta);
});

test("unknown draws carry hand quantity without an invented card role or hidden deck order", () => {
  const initialState = state();
  const a = state({ hand: [{ ...card(501), _simUnknownDraw: true }] });
  const b = state({ hand: [{ ...card(517), _simUnknownDraw: true }] });
  a.bot.deck.reverse();
  b.bot.deck = a.bot.deck.map(() => card(517));
  assert.equal(terminal(initialState, a), terminal(initialState, b));
  assert.ok(terminal(initialState, a) > terminal(initialState, state()));
  assert.deepEqual(scoreTechZeroLineMilestones({ initialState, finalState: a }), scoreTechZeroLineMilestones({ initialState, finalState: b }));
});

test("opponent hidden identities cannot change line scoring", () => {
  const initialState = state();
  const first = state({ field: [card(516)] }, { hand: [card(501)], field: [{ ...card(501), isFacedown: true }], spellTrap: [{ ...card(520), isFacedown: true }] });
  const second = state(first.bot, { hand: [card(517)], field: [{ ...card(517), isFacedown: true }], spellTrap: [{ ...card(518), isFacedown: true }] });
  assert.equal(terminal(initialState, first), terminal(initialState, second));
});

test("depleted draw supply reduces future resources without inventing a deckout loss", () => {
  const initialState = state();
  const healthy = state({ field: [card(516)] });
  const empty = state({ field: [card(516)], deck: [] });
  assert.ok(terminal(initialState, healthy) > terminal(initialState, empty));
  assert.ok(terminal(initialState, empty) > -10000);
  const refilled = state({ field: [card(516)], deck: [card(501), card(502)] });
  assert.ok(terminal(empty, refilled) > terminal(empty, empty));
});

test("terminal score ignores generic base scores that can contain hidden card identity", () => {
  const initialState = state(), finalState = state({ field: [card(516)] });
  assert.equal(terminal(initialState, finalState, { baseScore: 1 }),
    terminal(initialState, finalState, { baseScore: 2000 }));
});

test("unsupported branches receive no milestone or terminal gain even after lethal", () => {
  const initialState = state();
  const finalState = state({ field: [protect(card(517))] }, { lp: 0 });
  finalState._simUnsupportedActions = ["unknown_effect"];
  assert.ok(scoreTechZeroLineMilestones({ initialState, finalState }).scoreDelta <= 0);
  assert.ok(terminal(initialState, finalState) <= -10000);
});

test("terminal score uses current ATK once and values actual damage ahead of an unfinished setup", () => {
  const initialState = state(), boss = card(516);
  const finalState = state({ field: [boss] });
  const score = terminal(initialState, finalState);
  boss.tempAtkBoost = 1200; boss.equipAtkBonus = 900;
  assert.equal(terminal(initialState, finalState), score);
  finalState.player.lp = 0;
  assert.ok(terminal(initialState, finalState) > 1000);
});

test("line explanation exposes actions, milestones and the reveal boundary", () => {
  const finalState = state(); finalState._simRequiresReplan = true;
  const explanation = describeTechZeroPlannedLine({ finalState, milestones: [M.PORTAL_RECOVERY],
    sequence: [{ type: "monsterEffect", cardName: "Tech-Zero Multimodal Machine" }] });
  assert.match(explanation, /Tech-Zero Multimodal Machine/);
  assert.match(explanation, /Portal/);
  assert.match(explanation, /replan/i);
});
