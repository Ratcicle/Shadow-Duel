import assert from "node:assert/strict";
import test from "node:test";
import VoidStrategy from "../../src/core/ai/VoidStrategy.js";
import type { AIAction, AIState } from "../../src/core/contracts/ai.js";
import type { VoidAnalysisInput } from "../../src/core/ai/void/types.js";
import { cardDefinition } from "../helpers/fixtures.js";
import { simulationCard, simulationState, placeSimulationCards } from "../helpers/simulation.js";

class ObservedVoidStrategy extends VoidStrategy {
  calls: string[] = [];
  emitted: AIAction[] = [];
  override analyzeGameState(game: AIState) {
    this.calls.push("analysis");
    return super.analyzeGameState(game);
  }
  override analyzeSwarmPayoffs(analysis: Pick<VoidAnalysisInput, "hand" | "field" | "graveyard" | "extraDeck">) {
    this.calls.push("swarm");
    return super.analyzeSwarmPayoffs(analysis);
  }
  override decideMacroStrategy(analysis: VoidAnalysisInput) {
    this.calls.push("macro");
    return super.decideMacroStrategy(analysis);
  }
  override calculateComboBoosts(analysis: VoidAnalysisInput) {
    this.calls.push("boosts");
    return super.calculateComboBoosts(analysis);
  }
  override sequenceActions(actions: AIAction[]) {
    this.calls.push("sequence");
    this.emitted = [...actions];
    return super.sequenceActions(actions);
  }
  override integrateP2IntoActionSelection(_game: AIState, actions: AIAction[], _analysis: unknown = null) {
    this.calls.push("p2");
    return actions;
  }
}

function card(id: number, instanceId: number) { return simulationCard({ ...cardDefinition(id), instanceId }); }
for (const seat of ["bot", "player"] as const) {
  test(`Void delegated spell/trap policy retains an explicit zero priority (${seat})`, () => {
    class ZeroPriorityVoid extends ObservedVoidStrategy {
      override evaluateGravitationalPull() { return { shouldActivate: true, priority: 0, reason: "zero priority control" }; }
    }
    const source = card(218, 31301);
    source.effects = [{ id: "architecture_gravitational_ignition_control", timing: "ignition", activationZones: ["spellTrap"],
      actions: [{ type: "draw", amount: 1, player: "self" }] }];
    const state = simulationState({ _isPerspectiveState: true, turn: seat, phase: "main1", turnCounter: 4,
      bot: { id: seat, spellTrap: [source] }, player: { id: seat === "bot" ? "player" : "bot" } });
    const strategy = new ZeroPriorityVoid(state.bot);
    strategy.generateMainPhaseActions(state);
    const activation = strategy.emitted.find(action => action.type === "spellTrapEffect");
    assert.ok(activation);
    assert.equal(activation.priority, 0);
    assert.equal(activation.zoneIndex, 0);
    assert.equal(activation.cardId, source.id);
    assert.equal("effectId" in activation, false);
    assert.equal("reason" in activation, false);
  });

  test(`Void shared basic analysis retains facedown and defensive threat policies (${seat})`, () => {
    const own = card(201, 31401); own.atk = 1750; own.isFacedown = true;
    const defense = card(201, 31402); defense.position = "defense"; defense.atk = 500; defense.def = 2300;
    const hidden = card(201, 31403); hidden.isFacedown = true; hidden.atk = 5000; hidden.def = 5000;
    const state = simulationState({ _isPerspectiveState: true, turn: seat, phase: "main1", turnCounter: 4,
      bot: { id: seat, field: [own] }, player: { id: seat === "bot" ? "player" : "bot", field: [defense, hidden] } });
    const analysis = new VoidStrategy(state.bot).analyzeGameState(state);
    assert.equal(analysis.oppStrongestAtk, 1500);
    assert.equal(analysis.oppStrongestBattle, 2300);
    assert.equal(analysis.myStrongestAtk, 1750);
    assert.equal(analysis.field, state.bot.field);
    assert.equal(analysis.oppField, state.player.field);
    assert.equal("currentTurn" in analysis, false);
    assert.equal("normalSummonsAvailable" in analysis, false);
  });

  test(`Void delegation retains dynamic hooks, hand interleaving and physical indices (${seat})`, () => {
    const hand = [card(201, 31001), card(219, 31002), card(220, 31003), card(201, 31004), card(217, 31005)];
    const state = simulationState({ _isPerspectiveState: true, turn: seat, phase: "main1", turnCounter: 4,
      bot: { id: seat, hand, deck: [card(204, 31006), card(202, 31007)] },
      player: { id: seat === "bot" ? "player" : "bot", hand: [card(201, 31008)] } });
    const strategy = new ObservedVoidStrategy(state.bot);
    strategy.thoughtProcess.push("previous evaluation");
    const before = JSON.stringify(state);
    const generated = strategy.generateMainPhaseActions(state);
    assert.deepEqual(strategy.calls, ["analysis", "swarm", "macro", "boosts", "sequence", "p2"]);
    assert.deepEqual(strategy.emitted.filter(action => action.index !== undefined).map(action => [action.type, action.index]),
      [["summon", 0], ["spell", 1], ["set_spell_trap", 2], ["summon", 3], ["spell", 4]]);
    assert.ok(generated.some(action => action.type === "summon" && action.index === 0));
    assert.ok(generated.some(action => action.type === "summon" && action.index === 3));
    assert.equal(strategy.currentAnalysis?.hand, state.bot.hand);
    assert.equal(strategy.currentAnalysis?.hand[0], hand[0]);
    assert.equal(strategy.currentAnalysis?.hand[3], hand[3]);
    assert.notEqual(hand[0], hand[3]);
    assert.deepEqual(strategy.thoughtProcess, []);
    assert.equal(JSON.stringify(state), before);
  });

  test(`Void full-field Normal veto still aborts that hand card's later ignition (${seat})`, () => {
    const incoming = card(201, 31101);
    incoming.effects = [{ id: "architecture_void_hand_control", timing: "ignition", activationZones: ["hand"],
      actions: [{ type: "damage", amount: 1, player: "opponent" }] }];
    const state = simulationState({ _isPerspectiveState: true, turn: seat, phase: "main1", turnCounter: 4,
      bot: { id: seat, hand: [incoming], deck: [card(204, 31102)] },
      player: { id: seat === "bot" ? "player" : "bot" } });
    placeSimulationCards(state.bot.field, ...[201, 201, 201, 201, 201].map((id, index) => card(id, 31110 + index)));
    const strategy = new ObservedVoidStrategy(state.bot);
    strategy.generateMainPhaseActions(state);
    assert.equal(strategy.emitted.some(action => action.type === "summon" || action.type === "handIgnition"), false);
    state.bot.field.pop();
    strategy.generateMainPhaseActions(state);
    assert.deepEqual(strategy.emitted.filter(action => action.index === 0).map(action => action.type), ["summon", "handIgnition"]);
  });

  test(`Void sequencing retains in-place sort, category weights and stable duplicate ties (${seat})`, () => {
    const strategy = new VoidStrategy(simulationState({ bot: { id: seat } }).bot);
    const spell: AIAction = { type: "spell", index: 0, priority: 4 };
    const first: AIAction = { type: "summon", index: 1, priority: 4 };
    const second: AIAction = { type: "summon", index: 2, priority: 4 };
    const ignition: AIAction = { type: "handIgnition", index: 3, priority: 4 };
    const position: AIAction = { type: "position_change", fieldIndex: 4, toPosition: "defense", priority: 4 };
    const extra: AIAction = { type: "spell", index: 5, priority: 1, extraDeck: true };
    const finisher: AIAction = { type: "spell", index: 6, priority: 0, finisherPlanRank: 99 };
    const input = [spell, first, second, ignition, position, extra, finisher];
    assert.equal(strategy.sequenceActions(input), input);
    assert.deepEqual(input, [finisher, extra, first, second, ignition, spell, position]);
  });

  test(`Void later hand-ignition cost veto retains the Normal candidate already emitted (${seat})`, () => {
    const incoming = card(212, 31201);
    incoming.requiredTributes = 0;
    incoming.atk = 10000; incoming.def = 10000;
    const state = simulationState({ _isPerspectiveState: true, turn: seat, phase: "main1", turnCounter: 4,
      bot: { id: seat, hand: [incoming] }, player: { id: seat === "bot" ? "player" : "bot" } });
    const protectedCosts = [card(224, 31202), card(215, 31203)];
    for (const candidate of protectedCosts) { candidate.atk = 0; candidate.def = 0; }
    placeSimulationCards(state.bot.field, ...protectedCosts);
    const strategy = new ObservedVoidStrategy(state.bot);
    strategy.generateMainPhaseActions(state);
    assert.equal(strategy.emitted.some(action => action.type === "summon" && action.index === 0), true);
    assert.equal(strategy.emitted.some(action => action.type === "handIgnition" && action.index === 0), false,
      "preserved bosses are not viable ignition costs even though they are physical Void monsters");
  });
}
