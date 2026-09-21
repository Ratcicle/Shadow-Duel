import assert from "node:assert/strict";
import test from "node:test";
import "../../scripts/register_node_asset_loader.js";
import Bot from "../../src/core/Bot.js";
import Game from "../../src/core/Game.js";
import Card from "../../src/core/Card.js";
import BaseStrategy from "../../src/core/ai/BaseStrategy.js";
import {
  createGameTreeModels,
  getPlanningModel,
} from "../../src/core/ai/PlanningStrategies.js";
import {
  getRegisteredStrategyIds,
  registerStrategy,
  resolveRegisteredStrategy,
} from "../../src/core/ai/StrategyRegistry.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { gameTreeSearch } from "../../src/core/ai/GameTreeSearch.js";
import type { GameTreeSimulationGameState } from "../../src/core/contracts/aiState.js";
import type { AIState, AIStrategyBotPort } from "../../src/core/contracts/ai.js";
import type { BotStrategyPort } from "../../src/core/contracts/bot.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

const { default: BotArena } = await import("../../src/core/BotArena.js");

function snapshot(): GameTreeSimulationGameState {
  const { state } = createGameTreeCopy(simulationState({
    turn: "bot", phase: "main1", turnCounter: 2,
    bot: { hand: [simulationCard({ id: 991001, name: "Planning body", cardKind: "monster", level: 4, atk: 1600, def: 1000, effects: [] })] },
  }));
  delete state._gameRef;
  return state;
}

test("every registered planning strategy is freshly bound to its own snapshot", () => {
  const ids = getRegisteredStrategyIds();
  assert.equal(ids.length, 8);
  for (const id of ids) {
    const model = getPlanningModel(id);
    const left = snapshot();
    const right = snapshot();
    const first = model.create(left);
    const second = model.create(right);
    assert.equal(model.id, id);
    assert.notEqual(first, second, id);
    assert.equal(Reflect.get(first, "bot"), left.bot, id);
    assert.equal(Reflect.get(second, "bot"), right.bot, id);
    assert.equal(Reflect.get(first, "game"), undefined, id);
    assert.equal(Reflect.get(left.bot, "game"), undefined, id);
    assert.equal(Reflect.get(left.bot, "strategy"), undefined, id);
    const actions = first.generateMainPhaseActions(left);
    assert.ok(Array.isArray(actions), id);
    if (Reflect.has(first, "currentAnalysis")) {
      assert.notEqual(Reflect.get(second, "currentAnalysis"), Reflect.get(first, "currentAnalysis"), id);
      assert.notEqual(Reflect.get(first, "thoughtProcess"), Reflect.get(second, "thoughtProcess"), id);
    }
    first.simulateMainPhaseAction(left, { type: "summon", index: 0, cardName: "Planning body" });
    assert.equal(left.bot.hand.length, 0, id);
    assert.equal(right.bot.hand.length, 1, id);
  }
});

test("planning descriptors capture the constructor without retaining a live strategy", () => {
  const original = required(resolveRegisteredStrategy("shadowheart"));
  const descriptor = getPlanningModel("shadowheart");
  try {
    registerStrategy("shadowheart", BaseStrategy);
    assert.ok(descriptor.create(snapshot()) instanceof original);
    assert.ok(Object.isFrozen(descriptor));
  } finally {
    registerStrategy("shadowheart", original);
  }
});

test("model composition uses physical participant IDs and explicit IDs only", () => {
  const participants = [{ id: "seat-left", modelId: "bloomrot" }, { id: "seat-right", modelId: "void" }];
  const models = createGameTreeModels("seat-right", participants);
  assert.equal(models.root.id, "void");
  assert.equal(models.actors.get("seat-left")?.id, "bloomrot");
  participants[0]!.modelId = "dragon";
  assert.equal(models.actors.get("seat-left")?.id, "bloomrot");
  assert.equal(getPlanningModel("missing-model").id, "generic");
  assert.equal(getPlanningModel(null).id, "generic");
  assert.equal(resolveRegisteredStrategy("missing-model"), null);
});

test("generic planning performs legal summons and preserves tribute costs", () => {
  const state = snapshot();
  state.bot.hand[0]!.level = 7;
  const generic = getPlanningModel(null).create(state);
  assert.throws(() => generic.generateMainPhaseActions(state), /Planning model unavailable/);
  state.bot.field.push(
    simulationCard({ id: 991002, name: "Tribute A", cardKind: "monster", level: 1, atk: 100, def: 100 }),
    simulationCard({ id: 991003, name: "Tribute B", cardKind: "monster", level: 1, atk: 100, def: 100 }),
  );
  const summon = required(generic.generateMainPhaseActions(state).find(action => action.type === "summon"));
  generic.simulateMainPhaseAction(state, summon);
  assert.deepEqual(state.bot.field.map(card => card.name), ["Planning body"]);
  assert.deepEqual(state.bot.graveyard.map(card => card.name).sort(), ["Tribute A", "Tribute B"]);
  assert.equal(state.bot.summonCount, 1);
  assert.throws(() => generic.generateMainPhaseActions(state), /Planning model unavailable/);
});

test("generic planning sets reactive backrow and rejects unavailable spell-only modeling", () => {
  const state = snapshot();
  state.phase = "main2";
  state.bot.hand = [simulationCard({ id: 991004, name: "Reactive card", cardKind: "trap", subtype: "normal", effects: [] })];
  const generic = getPlanningModel(null).create(state);
  const set = required(generic.generateMainPhaseActions(state).find(action => action.type === "set_spell_trap"));
  generic.simulateMainPhaseAction(state, set);
  assert.equal(state.bot.spellTrap[0]?.name, "Reactive card");
  assert.equal(state.bot.hand.length, 0);
  state.bot.hand = [simulationCard(cardDefinition("Bloomrot Spore Cloud"))];
  assert.throws(() => generic.generateMainPhaseActions(state), /Planning model unavailable/);
});

test("generic planning rejects ambiguous position actions between copies with different legality", () => {
  const state = snapshot();
  state.bot.hand = [];
  state.turnCounter = 3;
  state.bot.field = [
    simulationCard({ id: 991005, instanceId: 1, name: "Copy", cardKind: "monster", position: "defense", atk: 2000, def: 1000, summonedTurn: 3 }),
    simulationCard({ id: 991005, instanceId: 2, name: "Copy", cardKind: "monster", position: "defense", atk: 2000, def: 1000, summonedTurn: 1, battlePositionLocked: true }),
  ];
  const generic = getPlanningModel(null).create(state);
  assert.throws(() => generic.generateMainPhaseActions(state), /Planning model unavailable/);
  assert.deepEqual(state.bot.field.map(card => card.position), ["defense", "defense"]);
});

test("Bot snapshots explicit preset models and custom Arena decks keep generic descriptors", () => {
  const unknown = new Bot("missing-preset");
  assert.equal(unknown.planningModelId, null);
  assert.equal(unknown.getGameTreeModels().root.id, "generic");
  unknown.setPreset("dragon");
  assert.equal(unknown.planningModelId, "dragon");
  const arena = new BotArena(Game, Bot);
  const game = arena.createGame("bloomrot", "void", arena.getSpeedConfig("instant"), { main: [], extra: [] });
  assert.ok(game.player instanceof Bot);
  const models = game.player.getGameTreeModels();
  assert.equal(models.root.id, "bloomrot");
  assert.equal(models.actors.get("bot")?.id, "void");
  const custom = arena.createBot("default", "player", { main: [], extra: [] });
  assert.equal(custom.planningModelId, null);
  assert.equal(custom.getGameTreeModels?.().root.id, "generic");
});

for (const scenario of [
  {
    left: "shadowheart", right: "arcanist", root: "player",
    leftHand: ["Shadow-Heart Imp", "Shadow-Heart Gecko"],
    leftDeck: ["Shadow-Heart Demon Arctroth"],
    rightHand: ["Arcanist Apprentice"],
    rightDeck: ["Grimoire of the Apprentice Arcanist"],
  },
  {
    left: "void", right: "bloomrot", root: "bot",
    leftHand: ["Void Walker", "Void Conjurer"],
    leftDeck: [],
    rightHand: ["Bloomrot Myco-Weaver", "Bloomrot Rootling"],
    rightDeck: [],
  },
] as const) {
  test(`real Bot P2 isolates ${scenario.left} / ${scenario.right} with root ${scenario.root}`, () => {
    const arena = new BotArena(Game, Bot);
    const game = arena.createGame(scenario.left, scenario.right, arena.getSpeedConfig("instant"), { main: [], extra: [] });
    assert.ok(game instanceof Game);
    assert.ok(game.player instanceof Bot);
    assert.ok(game.bot instanceof Bot);
    const left = game.player;
    const right = game.bot;
    for (const [bot, hand, deck] of [[left, scenario.leftHand, scenario.leftDeck], [right, scenario.rightHand, scenario.rightDeck]] as const) {
      bot.hand = hand.map(name => new Card(cardDefinition(name), bot.id));
      bot.deck = deck.map(name => new Card(cardDefinition(name), bot.id));
      bot.lp = 4500;
      bot.debug = false;
    }
    game.turn = scenario.root;
    game.phase = "main1";
    game.turnCounter = 2;
    const root = scenario.root === "player" ? left : right;
    const runtime = required(root.game);
    assert.equal(runtime, game);
    const expected = new Map<string, string>([[left.id, scenario.left], [right.id, scenario.right]]);
    const generations: Array<{ id: string; model: string; field: string[]; hand: string[] }> = [];
    const generated = new Set<object>();
    const simulated = new Set<object>();
    const originals = new Map([scenario.left, scenario.right].map(id => [id, required(resolveRegisteredStrategy(id))]));
    const inspect = (strategy: BotStrategyPort, state: AIState, model: string) => {
      assert.equal(state._isPerspectiveState, true);
      assert.equal(state._gameRef, undefined);
      assert.equal(strategy.bot, state.bot);
      assert.notEqual(strategy.bot, left);
      assert.notEqual(strategy.bot, right);
      assert.equal(Reflect.get(strategy.bot, "game"), undefined);
      assert.equal(expected.get(strategy.bot.id), model);
      assert.ok(strategy.bot.hand.every(card => !(card instanceof Card)));
    };
    for (const [id, Original] of originals) {
      class Observed extends Original {
        constructor(bot: AIStrategyBotPort) {
          assert.notEqual(bot, left);
          assert.notEqual(bot, right);
          super(bot);
        }
        override generateMainPhaseActions(state: AIState) {
          inspect(this, state, id);
          assert.equal(generated.has(this), false);
          generated.add(this);
          generations.push({ id: this.bot.id, model: id, field: this.bot.field.map(card => card.name || ""), hand: this.bot.hand.map(card => card.name || "") });
          return super.generateMainPhaseActions(state);
        }
        override simulateMainPhaseAction(...args: Parameters<BotStrategyPort["simulateMainPhaseAction"]>) {
          inspect(this, args[0], id);
          assert.equal(generated.has(this), false, "simulation reused its generation strategy");
          assert.equal(simulated.has(this), false, "simulation reused a sibling strategy");
          simulated.add(this);
          return super.simulateMainPhaseAction(...args);
        }
      }
      registerStrategy(id, Observed);
    }
    const live = [left, right].map(bot => ({ bot, game: bot.game, generate: bot.strategy.generateMainPhaseActions, simulate: bot.strategy.simulateMainPhaseAction }));
    const snapshotModels = root.getGameTreeModels.bind(root);
    let planningEntries = 0;
    root.getGameTreeModels = () => {
      planningEntries++;
      const models = snapshotModels();
      for (const entry of live) {
        entry.bot.game = new Proxy(runtime, { get() { throw new Error("planning read a stale live Game"); } });
        entry.bot.strategy.generateMainPhaseActions = () => { throw new Error("planning reused live generation"); };
        entry.bot.strategy.simulateMainPhaseAction = () => { throw new Error("planning reused live simulation"); };
      }
      return models;
    };
    const before = [left, right].map(bot => ({ hand: bot.hand.slice(), field: bot.field.slice(), deck: bot.deck.slice(), lp: bot.lp }));
    try {
      const actions = root.generateMainPhaseActions(runtime);
      assert.equal(planningEntries, 1, "P2 must enter once without recursive P2");
      assert.ok(actions.some(action => action.p2Approved === true), "actual P2 did not promote a planned action");
      assert.ok(generations.some(entry => entry.id === left.id && entry.model === scenario.left));
      assert.ok(generations.some(entry => entry.id === right.id && entry.model === scenario.right));
      assert.ok(generations.some(entry => entry.field.length > 0), "later nodes did not observe simulated field changes");
      assert.ok(simulated.size >= 2);
      assert.deepEqual([left, right].map(bot => ({ hand: bot.hand, field: bot.field, deck: bot.deck, lp: bot.lp })), before);
    } finally {
      for (const [id, Original] of originals) registerStrategy(id, Original);
      for (const entry of live) {
        if (entry.game) entry.bot.game = entry.game;
        else delete entry.bot.game;
        entry.bot.strategy.generateMainPhaseActions = entry.generate;
        entry.bot.strategy.simulateMainPhaseAction = entry.simulate;
      }
      root.getGameTreeModels = snapshotModels;
    }
  });
}

test("actual Base P2 preserves custom physical IDs with a reversed root", () => {
  const left: AIStrategyBotPort = {
    ...snapshot().bot,
    id: "seat-east",
    hand: ["Arcanist Apprentice", "Grimoire of the Apprentice Arcanist"].map(name => simulationCard(cardDefinition(name))),
    deck: [simulationCard(cardDefinition("Grimoire of the Apprentice Arcanist"))],
    lp: 4500,
    debug: false,
  };
  const right: AIStrategyBotPort = {
    ...snapshot().bot,
    id: "seat-west",
    hand: ["Shadow-Heart Imp", "Shadow-Heart Gecko"].map(name => simulationCard(cardDefinition(name))),
    deck: [simulationCard(cardDefinition("Shadow-Heart Demon Arctroth"))],
    lp: 4500,
    debug: false,
  };
  const models = createGameTreeModels(left.id, [
    { id: left.id, modelId: "arcanist" },
    { id: right.id, modelId: "shadowheart" },
  ]);
  let entries = 0;
  left.getGameTreeModels = () => { entries++; return models; };
  const Strategy = required(resolveRegisteredStrategy("arcanist"));
  const strategy = new Strategy(left);
  assert.ok(strategy instanceof BaseStrategy);
  const input = { player: left, bot: right, phase: "main1", turn: left.id, turnCounter: 2 };
  const initial = [left, right].map(actor => ({ id: actor.id, hand: actor.hand.slice(), field: actor.field.slice(), lp: actor.lp }));
  const result = strategy.evaluateCriticalSituationWithGameTree(input);
  assert.equal(result?.action?.cardName, "Arcanist Apprentice");
  assert.equal(result?.error, undefined);
  assert.equal(entries, 1);
  assert.deepEqual([left, right].map(actor => ({ id: actor.id, hand: actor.hand, field: actor.field, lp: actor.lp })), initial);
});

test("unavailable generic responses return an error without a promotable P2 action", () => {
  const actor = snapshot().bot;
  actor.debug = false;
  actor.hand = [simulationCard(cardDefinition("Bloomrot Spore Cloud"))];
  const opponent = snapshot().player;
  const input = { bot: actor, player: opponent, phase: "main1", turn: actor.id, turnCounter: 2 };
  const models = createGameTreeModels(actor.id, [{ id: actor.id, modelId: null }, { id: opponent.id, modelId: "void" }]);
  const result = gameTreeSearch(input, new BaseStrategy(actor), actor, 1, models);
  assert.equal(result.action, null);
  assert.equal(result.confidence, 0);
  assert.match(result.error || "", /Planning model unavailable/);
});
