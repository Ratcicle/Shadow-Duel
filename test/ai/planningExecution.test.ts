import { placeSimulationCards } from "../helpers/simulation.js";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";
import { playBotMainPhase } from "../../src/core/bot/mainPhaseController.js";
import { cardDefinition, record, unsafeFixture } from "../helpers/fixtures.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { AIAction, AIState } from "../../src/core/contracts/ai.js";
import { applyGenericSimulatedMainPhaseAction, normalizePlanningOwnerPolicy } from "../../src/core/ai/common/simulation.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";
import { hasPlanningExecutionContext, registerPlanningExecutionView, resolvePlanningOwnerPolicy, withPlanningExecutionContext } from "../../src/core/ai/common/planningExecution.js";
import type { SimulatedOwnerPolicy } from "../../src/core/ai/common/simulatedActions/shared.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { createPlanningOwnerPolicy } from "../../src/core/ai/common/planningOwner.js";
import { getPlanningModel } from "../../src/core/ai/PlanningStrategies.js";
import { voidCards } from "../../src/data/cards/void.js";
import { luminarchCards } from "../../src/data/cards/luminarch.js";
import { canUseSimOncePerTurn, markSimOncePerTurnUsed, canUseSimulatedEffectUsage, markSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { cardMatchesFilter } from "../../src/core/ai/common/cardFilters.js";

const monster = (id: number, name: string) => simulationCard({ id, instanceId: id, name, cardKind: "monster", atk: 1000, def: 1000, level: 4 });

test("unknown filter dependencies stay in the active branch and restore after nested failures", () => {
  const hidden = simulationCard({ _simUnknownCard: true, instanceId: 99000 });
  const outer = simulationState({ player: { deck: [hidden] } });
  const inner = simulationState({ player: { deck: [hidden] } });
  const inspect = () => cardMatchesFilter(hidden, { cardKind: "monster" });
  withPlanningExecutionContext(outer, () => null, () => {
    assert.throws(() => withPlanningExecutionContext(inner, () => null, () => {
      inspect();
      throw new Error("nested failure");
    }), /nested failure/);
    assert.equal(inner._simRequiresReplan, true);
    assert.equal(outer._simRequiresReplan, undefined);
    inspect();
    assert.equal(outer._simRequiresReplan, true);
    delete outer._simRequiresReplan;
  });
  inspect();
  assert.equal(outer._simRequiresReplan, undefined, "completed contexts do not retain branch mutation callbacks");
});

test("opponent trigger builds its own preferences instead of inheriting the actor activation", () => {
  const wrong = simulationCard({ id: 99001, name: "Actor choice", cardKind: "monster", atk: 1000, def: 1000, level: 4, counters: new Map() });
  const right = simulationCard({ id: 99002, name: "Owner choice", cardKind: "monster", atk: 1000, def: 1000, level: 4, counters: new Map() });
  const source = simulationCard({
    id: 99003, name: "Owner source", cardKind: "monster", atk: 1000, def: 1000, level: 4,
    effects: [{
      id: "choose-owner", timing: "on_event", event: "after_summon", triggerRequirement: "mandatory", triggerTiming: "if",
      requireOpponentSummon: true,
      targets: [{ id: "chosen", owner: "self", zone: "field", cardKind: "monster" }],
      actions: [{ type: "add_counter", targetRef: "chosen", counterType: "reward", amount: 1 }],
    }],
  });
  const game = simulationState({ _isPerspectiveState: true, player: { field: [wrong, right, source] }, bot: { hand: [simulationCard({ id: 99004, name: "Summoned", cardKind: "monster", atk: 1000, def: 1000, level: 4 })] } });
  let activations = 0;
  withPlanningExecutionContext(game, () => normalizePlanningOwnerPolicy({ strategy: {
    buildActivationContextForEffect() { activations++; return { actionContext: { targetPreferences: { chosen: { preferredNames: ["Owner choice"] } } } }; },
  } }), () => applyGenericSimulatedMainPhaseAction(game, { type: "summon", index: 0, cardName: "Summoned" }, {
    enableSimulatedEvents: true,
    activationContext: { actionContext: { targetPreferences: { chosen: { preferredNames: ["Actor choice"] } } } },
    strategy: { buildActivationContextForEffect() { return { actionContext: { targetPreferences: { chosen: { preferredNames: ["Owner choice"] } } } }; } },
  }));
  assert.equal(activations, 1);
  assert.equal(right.counters?.get("reward"), 1);
  assert.equal(wrong.counters?.get("reward"), undefined);
});

test("nested owner effects replace every selection and summon callback, then restore the parent policy", () => {
  const calls: string[] = [];
  const game = simulationState({
    _isPerspectiveState: true,
    bot: { hand: [monster(99101, "Summoned")] },
    player: { deck: [monster(99102, "wrong search"), monster(99103, "right search")], graveyard: [monster(99104, "wrong recruit"), monster(99105, "right recruit")] },
  });
  const owner = game.player;
  const actor = game.bot;
  const ownerSource = monster(99106, "Owner trigger");
  ownerSource.effects = [{
    id: "owner", timing: "on_event", event: "after_summon", triggerRequirement: "mandatory", triggerTiming: "if", summonMethods: ["normal"], requireOpponentSummon: true,
    actions: [{ type: "choose_action_case", cases: [
      { id: "wrong", actions: [{ type: "damage", amount: 999, player: "self" }] },
      { id: "right", actions: [
        { type: "search_any", zone: "deck", count: { min: 1, max: 1 }, player: "self" },
        { type: "special_summon_from_zone", zone: "graveyard", count: { min: 1, max: 1 }, player: "self", position: "choice" },
      ] },
    ] }],
  }];
  placeSimulationCards(owner.field, ownerSource);
  const actorSource = monster(99107, "Actor nested trigger");
  actorSource.effects = [{
    id: "actor-nested", timing: "on_event", event: "after_summon", triggerRequirement: "mandatory", triggerTiming: "if", summonMethods: ["special"], requireOpponentSummon: true,
    actions: [{ type: "heal", amount: 33, player: "self" }],
  }];
  placeSimulationCards(actor.field, actorSource);
  const ownerPolicy: SimulatedOwnerPolicy = {
    buildActivationContextForEffect() { calls.push("owner:context"); return {}; },
    chooseActionCase(cases) { calls.push("owner:case"); return cases[1]; },
    rankSearchCandidates(cards) { calls.push("owner:rank"); return cards.filter(card => card.name === "right search"); },
    evaluateRecruitCandidate(cards) { calls.push("owner:recruit"); return { best: cards.find(card => card.name === "right recruit") || null }; },
    chooseSpecialSummonPosition() { calls.push("owner:position"); return "defense"; },
    onAfterSpecialSummon() { calls.push("owner:summoned"); },
    onEffectActivated() { calls.push("owner:activated"); },
  };
  const actorPolicy: SimulatedOwnerPolicy = {
    buildActivationContextForEffect() { calls.push("actor:context"); return {}; },
    onEffectActivated() { calls.push("actor:activated"); },
  };
  const fail = () => { throw new Error("The initiating actor policy leaked into an owner trigger"); };
  withPlanningExecutionContext(game, (_state, player) => player === owner ? ownerPolicy : actorPolicy, () => {
    applyGenericSimulatedMainPhaseAction(game, { type: "summon", index: 0, cardName: "Summoned" }, {
      enableSimulatedEvents: true, chooseActionCase: fail, rankSearchCandidates: fail,
      evaluateRecruitCandidate: fail, chooseSpecialSummonPosition: fail,
      onAfterSpecialSummon: fail, onEffectActivated: fail,
    });
  });
  assert.deepEqual(owner.hand.map(card => card.name), ["right search"]);
  assert.equal(owner.field.find(card => card.name === "right recruit")?.position, "defense");
  assert.deepEqual(owner.graveyard.map(card => card.name), ["wrong recruit"]);
  assert.equal(owner.lp, 8000);
  assert.equal(actor.lp, 8033);
  assert.deepEqual(calls, ["owner:context", "owner:case", "owner:rank", "owner:recruit", "owner:position", "owner:summoned", "actor:context", "actor:activated", "owner:activated"]);
  assert.equal(resolvePlanningOwnerPolicy(game, owner), undefined);
});

test("temporary effects build the owner context and invoke its hook exactly once", () => {
  const game = simulationState({ _isPerspectiveState: true, bot: { hand: [monster(99201, "Summoned")] }, player: { field: [monster(99202, "Registrar")] } });
  const owner = game.player;
  const source = owner.field[0];
  assert.ok(source);
  const right = monster(99203, "Right target");
  const wrong = monster(99204, "Wrong target");
  right.counters = new Map();
  wrong.counters = new Map();
  placeSimulationCards(owner.field, wrong, right);
  game.temporaryEventEffects = [{
    event: "after_summon", ownerId: owner.id, sourceCardId: source.id || null, sourceName: source.name || null,
    sourceCardKind: "monster", sourceCardSubtype: null, sourceArchetype: null, sourceArchetypes: [], sourceEffectId: "temporary", sourceInstanceId: 99202,
    boundEventTargetInstanceId: null, requireBoundTargetLeavesField: false, duration: "until_consumed", createdOnTurn: 0, expiresOnTurn: null, usesRemaining: 1, declaredValues: {},
    effect: { id: "temporary", timing: "on_event", event: "after_summon", triggerRequirement: "mandatory", triggerTiming: "if", targets: [{ id: "chosen", owner: "self", zone: "field" }], actions: [{ type: "add_counter", counterType: "reward", targetRef: "chosen", amount: 1 }] },
  }];
  let contexts = 0;
  let activations = 0;
  withPlanningExecutionContext(game, (_state, player) => {
    assert.equal(player, owner);
    return {
      buildActivationContextForEffect() { contexts++; return { actionContext: { targetPreferences: { chosen: { preferredNames: ["Right target"] } } } }; },
      onEffectActivated() { activations++; },
    };
  }, () => applyGenericSimulatedMainPhaseAction(game, { type: "summon", index: 0, cardName: "Summoned" }, {
    enableSimulatedEvents: true,
    actionContext: { targetPreferences: { chosen: { preferredNames: ["Wrong target"] } } },
    onEffectActivated() { throw new Error("Parent hook leaked into temporary effect"); },
  }));
  assert.equal(contexts, 1);
  assert.equal(activations, 1);
  assert.equal(right.counters.get("reward"), 1);
  assert.equal(wrong.counters.get("reward"), undefined);
  assert.deepEqual(game.temporaryEventEffects, []);
});

test("execution contexts are external, nested and restored even when a callback throws", () => {
  const game = simulationState();
  const view = new Proxy(game, {});
  registerPlanningExecutionView(view, game);
  const keys = Object.keys(game);
  const outer: SimulatedOwnerPolicy = { archetype: "outer" };
  const inner: SimulatedOwnerPolicy = { archetype: "inner" };
  withPlanningExecutionContext(game, () => outer, () => {
    assert.equal(hasPlanningExecutionContext(view), true);
    assert.equal(resolvePlanningOwnerPolicy(view, view.bot), outer);
    assert.equal(resolvePlanningOwnerPolicy(game, game.bot), outer);
    assert.throws(() => withPlanningExecutionContext(game, () => inner, () => {
      assert.equal(resolvePlanningOwnerPolicy(game, game.bot), inner);
      throw new Error("planned failure");
    }), /planned failure/);
    assert.equal(resolvePlanningOwnerPolicy(game, game.bot), outer);
  });
  assert.equal(resolvePlanningOwnerPolicy(game, game.bot), undefined);
  assert.equal(hasPlanningExecutionContext(view), false);
  assert.equal(resolvePlanningOwnerPolicy(view, view.bot), undefined);
  assert.deepEqual(Object.keys(game), keys);
});

test("registered Dragon owner exposes its selection and activation policies", () => {
  const { state } = createGameTreeCopy(simulationState());
  const strategy = getPlanningModel("dragon").create(state);
  const policy = normalizePlanningOwnerPolicy(strategy.getPlanningSimulationOptions?.(state) || {});
  assert.equal(typeof policy.rankSearchCandidates, "function");
  assert.equal(typeof policy.evaluateRecruitCandidate, "function");
  assert.equal(typeof policy.buildActivationContextForEffect, "function");
});

for (const alreadyUsed of [false, true]) {
test(`Void owner special-summon followup respects declarative usage (already used: ${alreadyUsed})`, () => {
  const definition = voidCards.find(card => card.name === "Void Hollow");
  assert.ok(definition);
  const input = simulationState({ _isPerspectiveState: true, bot: { hand: [monster(99301, "Actor summon")] } });
  const source = monster(99302, "Owner source");
  source.effects = [{ id: "owner-followup", timing: "on_event", event: "after_summon", triggerRequirement: "mandatory", triggerTiming: "if", summonMethods: ["normal"], requireOpponentSummon: true, actions: [{ type: "special_summon_from_zone", zone: "hand", filters: { name: "Void Hollow" }, position: "attack" }] }];
  placeSimulationCards(input.player.field, source);
  input.player.hand.push(simulationCard({ ...definition, instanceId: 99303 }));
  input.player.deck.push(simulationCard({ ...definition, instanceId: 99304 }), simulationCard({ ...definition, instanceId: 99305 }));
  const { state } = createGameTreeCopy(input);
  if (alreadyUsed) markSimOncePerTurnUsed(state, "void_hollow_summon", 1, state.player.id, true);
  const models = new Map([["bot", getPlanningModel(null)], ["player", getPlanningModel("void")]]);
  withPlanningExecutionContext(state, (_graph, owner) => createPlanningOwnerPolicy(state, owner, models), () => {
    applyGenericSimulatedMainPhaseAction(state, { type: "summon", index: 0, cardName: "Actor summon" }, { enableSimulatedEvents: true });
  });
  assert.equal(state.player.field.filter(card => card.name === "Void Hollow").length, alreadyUsed ? 1 : 2);
  assert.equal(state.player.deck.length, alreadyUsed ? 2 : 1);
  assert.deepEqual(state.player.field.filter(card => card.name === "Void Hollow").map(card => card.instanceId),
    alreadyUsed ? [99303] : [99303, 99304]);
  assert.equal(canUseSimOncePerTurn(state, "void_hollow_summon", 1, state.player.id, true), false);
  assert.equal(canUseSimOncePerTurn(state, "void_hollow_summon", 1, state.bot.id, true), true);
});

test(`Luminarch owner special-summon followup respects declarative usage (already used: ${alreadyUsed})`, () => {
  const definition = luminarchCards.find(card => card.name === "Luminarch Enchanted Halberd");
  assert.ok(definition);
  const input = simulationState({ _isPerspectiveState: true, bot: { hand: [monster(99401, "Actor summon")] } });
  const source = monster(99402, "Owner source");
  source.effects = [{ id: "owner-followup", timing: "on_event", event: "after_summon", triggerRequirement: "mandatory", triggerTiming: "if", summonMethods: ["normal"], requireOpponentSummon: true, actions: [{ type: "special_summon_from_zone", zone: "graveyard", position: "attack" }] }];
  const recruit = monster(99403, "Luminarch recruit");
  recruit.archetype = "Luminarch";
  placeSimulationCards(input.player.field, source);
  input.player.graveyard.push(recruit);
  input.player.hand.push(simulationCard({ ...definition, instanceId: 99404 }), simulationCard({ ...definition, instanceId: 99405 }));
  const { state } = createGameTreeCopy(input);
  const first = state.player.hand[0];
  const effect = definition.effects[0];
  assert.ok(first && effect);
  if (alreadyUsed) markSimulatedEffectUsage(state, effect, first, state.player.id, true);
  const models = new Map([["bot", getPlanningModel(null)], ["player", getPlanningModel("luminarch")]]);
  withPlanningExecutionContext(state, (_graph, owner) => createPlanningOwnerPolicy(state, owner, models), () => {
    applyGenericSimulatedMainPhaseAction(state, { type: "summon", index: 0, cardName: "Actor summon" }, { enableSimulatedEvents: true });
  });
  const summoned = state.player.field.filter(card => card.name === "Luminarch Enchanted Halberd");
  assert.equal(summoned.length, alreadyUsed ? 1 : 2);
  assert.equal(state.player.hand.length, alreadyUsed ? 1 : 0);
  assert.equal(state._gameTreeActors?.player?._simLuminarch?.halberdSummonedThisTurn, true);
  for (const card of summoned) {
    assert.equal(card.cannotAttackThisTurn, true);
    assert.equal(canUseSimulatedEffectUsage(state, effect, card, state.player.id, true), false);
  }
  state.turnCounter++;
  assert.equal(canUseSimulatedEffectUsage(state, effect, first, state.player.id, true), true);
  assert.equal(state._simLuminarch, undefined);
});
}

function plannerControllerScenario(t: TestContext) {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  const game = unsafeFixture<Game & BotGamePort>(new Game({
    laboratoryMode: true, laboratoryUseBot: true, disableChains: true, captureReplay: false,
  }), "Concrete Game installs the EffectEngine methods required by the Bot preview port.");
  t.after(() => game.dispose("planning_execution_controller"));
  const bot = game.bot;
  assert.ok(bot instanceof Bot);
  bot.setPreset("techzero");
  game.turn = bot.id;
  game.phase = "main1";
  game.turnCounter = 2;
  game.disablePresentationDelays = true;
  game.aiSuccessfulActionDelayMs = 0;
  game.aiActionDelayMs = 0;
  game.waitForBoardPresentation = async () => {};
  game.waitForAiPresentationStep = async () => {};
  bot.strategy.shouldUseAutomaticAscensionShortcut = () => false;
  bot.strategy.getPlanningProfile = () => ({
    enabled: true, mode: "always", turnMode: "mainOnly", beamWidth: 2,
    maxDepth: 3, nodeBudget: 20, candidateLimit: 3, allowEarlyStop: true,
  });
  // These controller scenarios pair a synthetic simulator with an LP-only score.
  bot.strategy.scoreLineMilestones = () => ({ scoreDelta: 0, milestones: [] });
  bot.strategy.scoreLineTerminal = context => context?.baseScore || 0;
  bot.strategy.selectPlanningCandidates = (actions, _state, limit) => actions.slice(0, limit);
  bot.sequenceActions = actions => actions;
  bot.filterValidActionsForCurrentState = actions => actions;
  bot.field.push(new Card(cardDefinition(501), bot.id));
  bot.field.push(new Card(cardDefinition(502), bot.id));
  const progress: { kind: string; details: Record<string, unknown> }[] = [];
  Reflect.set(game, "_arenaTracker", { recordProgress(kind: string, _game: unknown, details: object) {
    progress.push({ kind, details: record(details) });
  } });
  return { game, bot, progress };
}

test("controller honors a planned stop without executing a worse fallback", async t => {
  const { game, bot, progress } = plannerControllerScenario(t);
  const action: AIAction = { type: "monsterEffect", fieldIndex: 0, effectId: "worse" };
  bot.generateMainPhaseActions = () => [action];
  bot.strategy.generateMainPhaseActions = () => [action];
  bot.strategy.evaluateBoardV2 = state => state.bot?.lp || 0;
  bot.strategy.simulateMainPhaseAction = state => { state.bot.lp -= 100; return state; };
  let executions = 0;
  bot.executeMainPhaseAction = async () => { executions++; return false; };
  await playBotMainPhase(bot, game);
  assert.equal(executions, 0);
  assert.equal(progress.find(entry => entry.kind === "ai_turn_line_search")?.details.plannerTerminationReason, "preferred_terminal");
  assert.equal(progress.filter(entry => entry.kind === "ai_main_phase_exit").at(-1)?.details.reason, "planned_stop");
});

for (const candidates of [1, 2]) {
  test(`controller propagates conservation to ${candidates === 1 ? "Greedy" : "Beam and Greedy"} when the deep planner is off`, async t => {
    const { game, bot, progress } = plannerControllerScenario(t);
    bot.strategy.getPlanningProfile = () => ({
      enabled: false, mode: "off", turnMode: "mainOnly", beamWidth: 2,
      maxDepth: 3, nodeBudget: 20, candidateLimit: 3, allowEarlyStop: true,
    });
    const actions: AIAction[] = Array.from({ length: candidates }, (_, fieldIndex) => ({ type: "monsterEffect", fieldIndex, effectId: `worse-${fieldIndex}` }));
    bot.generateMainPhaseActions = () => actions;
    bot.strategy.generateMainPhaseActions = () => actions;
    bot.strategy.evaluateBoardV2 = state => state.bot?.lp || 0;
    bot.strategy.simulateMainPhaseAction = state => { state.bot.lp -= 100; return state; };
    let executions = 0;
    bot.executeMainPhaseAction = async () => { executions++; return false; };
    await playBotMainPhase(bot, game);
    assert.equal(executions, 0, "a null search result must not authorize a raw-priority action");
    assert.equal(progress.filter(entry => entry.kind === "ai_main_phase_exit").at(-1)?.details.reason, "alternatives_exhausted");
    assert.equal(bot.lp, 8000);
  });
}

for (const changed of ["draw", "chain_result", "removed_material"] as const) {
  test(`controller searches the new snapshot after ${changed} and discards the old continuation`, async t => {
    const { game, bot, progress } = plannerControllerScenario(t);
    const action = (effectId: string): AIAction => ({ type: "monsterEffect", fieldIndex: 0, effectId });
    const generate = (state: AIState): AIAction[] => {
      const self = state.bot;
      assert.ok(self);
      if ((self.lp || 0) >= 8300) return [];
      if (self.hand?.length || self.field?.length === 1 || (self.lp || 0) >= 8100) return [action("fresh")];
      return [action(self.lp === 8000 ? "prepare" : "obsolete")];
    };
    bot.generateMainPhaseActions = generate;
    bot.strategy.generateMainPhaseActions = generate;
    bot.strategy.evaluateBoardV2 = state => state.bot?.lp || 0;
    bot.strategy.simulateMainPhaseAction = (state, planned) => {
      if (planned.type === "monsterEffect" && planned.effectId === "prepare") {
        state.bot.lp++;
        if (changed === "draw") state._simRequiresReplan = true;
      } else state.bot.lp = 8300;
      return state;
    };
    const executions: string[] = [];
    bot.executeMainPhaseAction = async (_game, selected) => {
      const effectId = selected.type === "monsterEffect" ? selected.effectId || "" : "";
      executions.push(effectId);
      if (effectId === "prepare") {
        bot.lp++;
        if (changed === "draw") bot.hand.push(new Card(cardDefinition(502), bot.id));
        if (changed === "chain_result") bot.lp = 8100;
        if (changed === "removed_material") bot.field.splice(1, 1);
      } else bot.lp = 8300;
      return true;
    };
    await playBotMainPhase(bot, game);
    assert.deepEqual(executions, ["prepare", "fresh"]);
    const searches = progress.filter(entry => entry.kind === "ai_turn_line_search");
    assert.equal(searches.length, 2);
    assert.equal(searches[0]?.details.plannedLineLength, changed === "draw" ? 1 : 2);
    assert.equal(searches[1]?.details.plannedLineLength, 1);
  });
}
