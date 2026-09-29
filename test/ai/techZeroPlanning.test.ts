import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import TechZeroStrategy from "../../src/core/ai/TechZeroStrategy.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";
import { playBotMainPhase } from "../../src/core/bot/mainPhaseController.js";
import { fingerprintAction } from "../../src/core/ai/common/planningDiagnostics.js";
import { markSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { getBotDeckList, getBotExtraDeckList } from "../../src/core/bot/presets.js";
import type { AiLiveGamePort } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { AIAction, TurnLineSearchCompletion } from "../../src/core/contracts/ai.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

type Actor = "player" | "bot";
type Combo = "lancer" | "wyvern" | "raptor";

for (const actor of ["player", "bot"] as const) {
  test(`Tech-Zero preserves Final Singularity instead of tribute summoning Connector (${actor})`, async t => {
    const { bot, botGame, make } = scenario(t, actor);
    const singularity = make(517), connector = make(507);
    bot.hand = [connector]; bot.deck = []; bot.extraDeck = [];
    placeFieldCards(bot.field, singularity);
    const state = bot.cloneGameState(botGame);
    assert.equal(bot.generateMainPhaseActions(botGame).some(action => action.type === "summon"), false);
    assert.equal(bot.strategy.generateMainPhaseActions(state).some(action => action.type === "summon"), false);
    await playBotMainPhase(bot, botGame);
    assert.ok(bot.field.includes(singularity));
    assert.ok(bot.hand.includes(connector));
    assert.equal(bot.summonCount, 0);
  });

  test(`Tech-Zero rejects a stale Connector tribute in simulation and execution (${actor})`, async t => {
    const { bot, botGame, make } = scenario(t, actor);
    const singularity = make(517), connector = make(507);
    singularity.atk = 0;
    singularity.effectsNegated = true;
    bot.hand = [connector]; bot.deck = []; bot.extraDeck = [];
    placeFieldCards(bot.field, singularity);
    const action: AIAction = { type: "summon", index: 0, cardId: 507, position: "attack" };
    const state = bot.cloneGameState(botGame);
    bot.strategy.simulateMainPhaseAction(state, action);
    assert.deepEqual(state.bot.field.map(card => card.id), [517]);
    assert.deepEqual(state.bot.hand.map(card => card.id), [507]);
    assert.equal(await bot.executeMainPhaseAction(botGame, action), false);
    assert.deepEqual(bot.field, [singularity]);
    assert.deepEqual(bot.hand, [connector]);
    assert.equal(bot.summonCount, 0);
  });

  test(`Tech-Zero tributes an expendable monster beside Final Singularity (${actor})`, async t => {
    const { bot, botGame, make } = scenario(t, actor);
    const singularity = make(517), connector = make(507), prism = make(506);
    singularity.atk = 0;
    prism.atk = 10000;
    bot.hand = [connector]; bot.deck = []; bot.extraDeck = [];
    placeFieldCards(bot.field, singularity, prism);
    const action = required(bot.generateMainPhaseActions(botGame).find(entry =>
      entry.type === "summon" && entry.cardId === 507 && entry.position === "attack"));
    const state = bot.cloneGameState(botGame);
    bot.strategy.simulateMainPhaseAction(state, action);
    assert.deepEqual(state.bot.field.map(card => card.id), [517, 507]);
    assert.ok(state.bot.graveyard.some(card => card.id === 506));
    assert.equal(await bot.executeMainPhaseAction(botGame, action), true);
    assert.deepEqual(bot.field, [singularity, connector]);
    assert.ok(bot.graveyard.includes(prism));
  });
}

function scenario(t: TestContext, actor: Actor, combo: Combo = "lancer", drawIds = [518, 17]) {
  const first = new Bot("techzero");
  first.id = "player";
  const second = new Bot("techzero");
  const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true });
  game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot provides the Player runtime interface");
  t.after(() => game.dispose("tech_zero_planning_test"));
  game.turn = actor;
  game.phase = "main1";
  game.turnCounter = 2;
  game.disablePresentationDelays = true;
  game.ui.showConfirmPrompt = async () => true;
  game.ui.showTrapActivationModal = async () => true;
  const bot = actor === "player" ? first : second;
  const opponent = actor === "player" ? second : first;
  const botGame = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game,
    "Concrete Game supplies the attached Bot execution and snapshot capabilities");
  first.game = botGame;
  second.game = botGame;
  const make = (id: number) => new Card(cardDefinition(id), bot.id);
  const main = getBotDeckList("techzero").map(make);
  const take = (id: number) => {
    const index = main.findIndex(card => card.id === id);
    assert.ok(index >= 0);
    return required(main.splice(index, 1)[0]);
  };
  bot.hand.push(take(502), take(501));
  if (combo !== "lancer") bot.hand.push(take(combo === "wyvern" ? 504 : 505));
  const draws = drawIds.map(take);
  bot.deck.push(...main, ...draws.slice().reverse());
  bot.extraDeck.push(...getBotExtraDeckList("techzero").map(make));
  const threat = new Card({ ...cardDefinition(1), name: "Visible planning threat", effects: [],
    atk: combo === "lancer" ? 3000 : 3800, def: 0 }, opponent.id);
  if (combo === "lancer") opponent.lp = 6000;
  else placeFieldCards(opponent.field, threat);
  const summons: number[] = [];
  game.on("after_summon", ({ card, player }) => {
    if (player === bot && card.id != null) summons.push(card.id);
  });
  return { game, botGame, bot, opponent, draws, summons, make };
}

test("Tech-Zero enables bounded turn planning without changing the shared defaults", t => {
  const { bot, botGame } = scenario(t, "bot");
  const profile = required(bot.strategy.getPlanningProfile).call(bot.strategy, botGame);
  assert.equal(profile.enabled, true);
  assert.equal(profile.turnMode, "mainOnly");
  assert.ok(profile.maxDepth >= 4 && profile.maxDepth <= 12);
  assert.ok(profile.nodeBudget > 0 && profile.nodeBudget <= 1500);
  assert.ok(profile.beamWidth > 1 && profile.candidateLimit >= profile.beamWidth);
});

test("Tech-Zero keeps face-up combo entry available beside a defensive Set", async t => {
  const { bot, botGame } = scenario(t, "bot", "wyvern");
  const actions = bot.generateMainPhaseActions(botGame).filter(action => action.type === "summon").filter(action => action.cardId === 502);
  assert.deepEqual(new Set(actions.map(action => action.position)), new Set(["attack", "defense"]));
  const action = required(actions.find(entry => entry.position === "attack"));
  assert.equal(await bot.executeMainPhaseAction(botGame, action), true);
  assert.ok(bot.field.some(card => card.id === 501), "face-up Catapult starts its summon effect despite the opposing threat");
});

test("a live-bound Tech-Zero strategy expands the current search snapshot", t => {
  const { bot, botGame } = scenario(t, "bot");
  const state = bot.cloneGameState(botGame);
  const core = required(state.bot.hand.find(card => card.id === 501));
  const machine = required(state.bot.extraDeck.find(card => card.id === 503));
  state.bot.hand = [];
  state.bot.field = [core, machine];
  state.bot.extraDeck = state.bot.extraDeck.filter(card => card !== machine);
  state.bot.summonCount = 1;
  for (const card of state.bot.field) { card.isFacedown = false; card.position = "attack"; }
  const expected = new TechZeroStrategy(state.bot).generateMainPhaseActions(state);
  assert.ok(expected.some(action => action.effectId === "tech_zero_multimodal_machine_level_mod"));
  assert.deepEqual(bot.strategy.generateMainPhaseActions(state), expected);
  assert.equal(bot.field.length, 0);
  assert.equal(bot.hand.length, 2);
});

test("Tech-Zero retains different Synchro destinations before duplicate positions and materials", t => {
  const { bot, botGame } = scenario(t, "bot");
  const actions: AIAction[] = [515, 515, 514, 514, 514, 514, 512, 511].map((id, index) => ({
    type: "synchro", synchroInstanceId: id, materialInstanceIds: [index, 100 + index],
    position: index % 2 ? "attack" : "defense", priority: 10 - index,
  }));
  const select = required(bot.strategy.selectPlanningCandidates, "the domain must distribute the bounded candidate budget");
  const kept = select.call(bot.strategy, actions, botGame, 6);
  assert.equal(kept.length, 6);
  assert.ok(kept.includes(required(actions[6])), "retain Mage behind alternative Phoenix materials");
  assert.ok(kept.includes(required(actions[7])), "retain Ghost as a distinct destination");
  assert.ok(kept.every(action => actions.includes(action)), "preserve exact action and material identities");
});

test("Catapult with only Raptor in GY does not stop the controller for phantom recovery", async t => {
  const { bot, botGame, opponent, make } = scenario(t, "bot");
  bot.hand = [make(502)]; bot.graveyard = [make(505)];
  bot.deck = []; bot.extraDeck = []; opponent.lp = 8000;
  const profile = required(bot.strategy.getPlanningProfile).call(bot.strategy, botGame);
  const reports: TurnLineSearchCompletion[] = [];
  const result = await turnLineSearch(botGame, bot.strategy, { ...profile, profile, onComplete: report => reports.push(report) });
  assert.ok(result);
  assert.equal(result.action.type, "summon");
  assert.notEqual(reports[0]?.terminationReason, "preferred_terminal");
  await playBotMainPhase(bot, botGame);
  assert.equal(bot.hand.length, 0);
  assert.deepEqual(bot.field.map(card => card.id), [502]);
  assert.deepEqual(bot.graveyard.map(card => card.id), [505]);
});

test("preferred_terminal can preserve Catapult plus Prism as real recovery without a profitable conversion", async t => {
  const { bot, botGame, opponent, make } = scenario(t, "bot");
  bot.hand = [make(502)]; bot.graveyard = [make(506)];
  bot.deck = []; bot.extraDeck = []; opponent.lp = 8000;
  const profile = required(bot.strategy.getPlanningProfile).call(bot.strategy, botGame);
  const reports: TurnLineSearchCompletion[] = [];
  const result = await turnLineSearch(botGame, bot.strategy, { ...profile, profile, onComplete: report => reports.push(report) });
  assert.equal(result, null);
  assert.equal(reports[0]?.terminationReason, "preferred_terminal");
  await playBotMainPhase(bot, botGame);
  assert.deepEqual(bot.hand.map(card => card.id), [502]);
  assert.deepEqual(bot.graveyard.map(card => card.id), [506]);
  assert.equal(bot.field.length, 0);
});

test("same Lancer with different materials survives level choices, candidate selection and turn search", async t => {
  const { bot, botGame, make } = scenario(t, "bot");
  assert.ok(bot.strategy instanceof TechZeroStrategy);
  bot.hand = []; bot.deck = []; bot.graveyard = []; bot.summonCount = 1;
  const machine = make(503), phoenix = make(514), reactor = make(515), lancer = make(516);
  for (const card of [machine, phoenix, reactor]) {
    card.properSummonEstablished = true; card.properSummonProcedure = "synchro";
  }
  placeFieldCards(bot.field, machine, phoenix, reactor);
  bot.extraDeck = [lancer];
  const actions = bot.strategy.generateMainPhaseActions(botGame);
  const synchros = actions.filter(action => action.type === "synchro");
  assert.ok(synchros.some(action => action.materialInstanceIds.includes(phoenix.instanceId)));
  assert.ok(synchros.every(action => !action.materialInstanceIds.includes(reactor.instanceId)));
  const adjustments = actions.filter(action => action.effectId === "tech_zero_multimodal_machine_level_mod");
  const targetRef = "tech_zero_multimodal_machine_level_down_1_target";
  for (const target of [machine, reactor]) {
    const adjustment = required(adjustments.find(action =>
      action.activationContext?.decisions?.selections?.[targetRef]?.includes(target.instanceId)));
    const state = bot.cloneGameState(botGame);
    await bot.strategy.simulateMainPhaseAction(state, adjustment);
    const after = bot.strategy.generateMainPhaseActions(state).filter(action => action.type === "synchro");
    assert.ok(after.some(action => action.synchroInstanceId === lancer.instanceId &&
      action.materialInstanceIds.includes(machine.instanceId) && action.materialInstanceIds.includes(reactor.instanceId)));
    assert.equal(machine.level, 3, "planning leaves the live field unchanged");
  }
  const profile = required(bot.strategy.getPlanningProfile).call(bot.strategy, botGame);
  const kept = required(bot.strategy.selectPlanningCandidates).call(bot.strategy, actions, botGame, profile.beamWidth);
  assert.ok(adjustments.every(action => kept.includes(action)));
  const levels = new Set<string>(), materials = new Set<string>();
  const score = required(bot.strategy.scoreLineTerminal).bind(bot.strategy);
  t.mock.method(bot.strategy, "scoreLineTerminal", (context: Parameters<typeof score>[0]) => {
    const field = context?.finalState?.bot.field || [];
    levels.add(`${field.find(card => card.instanceId === machine.instanceId)?.level}/${field.find(card => card.instanceId === reactor.instanceId)?.level}`);
    for (const action of context?.sequence || []) if (action.type === "synchro" && action.synchroInstanceId === lancer.instanceId)
      materials.add([...action.materialInstanceIds].sort().join(","));
    return score(context);
  });
  await turnLineSearch(botGame, bot.strategy, { ...profile, profile });
  assert.ok(levels.has("2/8") && levels.has("3/7"), "different level adjustments must not collide as repeated states");
  for (const partner of [phoenix, reactor]) assert.ok(materials.has([machine.instanceId, partner.instanceId].sort().join(",")),
    "both exact Lancer procedures must reach terminal comparison");
  const reduceMachine = required(adjustments.find(action =>
    action.activationContext?.decisions?.selections?.[targetRef]?.includes(machine.instanceId)));
  assert.equal(await bot.executeMainPhaseAction(botGame, reduceMachine), true);
  assert.equal(machine.level, 2);
  const preservePhoenix = required(bot.generateMainPhaseActions(botGame).find(action => action.type === "synchro" &&
    action.synchroInstanceId === lancer.instanceId && action.materialInstanceIds.includes(reactor.instanceId)));
  assert.equal(await bot.executeMainPhaseAction(botGame, preservePhoenix), true);
  assert.ok(bot.field.includes(phoenix));
  assert.ok(bot.field.includes(lancer));
  assert.ok(bot.graveyard.includes(reactor));
});

for (const zone of ["hand", "graveyard"] as const) {
  test(`Catapult revives non-Tuner Prism from ${zone} through the real controller for lethal`, async t => {
    const { bot, botGame, opponent, make } = scenario(t, "bot");
    bot.hand = [make(502)]; bot.graveyard = []; bot.deck = []; bot.extraDeck = [];
    const prism = make(506);
    bot[zone].push(prism);
    opponent.lp = 1000;
    await playBotMainPhase(bot, botGame);
    assert.ok(bot.field.some(card => card === prism));
    assert.ok(bot.field.some(card => card.id === 502));
    assert.equal(bot.summonCount, 1);
    assert.equal(prism.isTuner, false);
    assert.equal(prism.level, 2);
  });
}

test("Wyvern's unavailable optional removal does not invalidate a legal Synchro line", t => {
  const { bot, botGame } = scenario(t, "bot", "wyvern");
  const state = bot.cloneGameState(botGame);
  const wyvern = required(state.bot.hand.find(card => card.id === 504));
  const machine = required(state.bot.extraDeck.find(card => card.id === 503));
  state.bot.hand = [];
  state.bot.field = [machine, wyvern];
  state.bot.extraDeck = state.bot.extraDeck.filter(card => card !== machine);
  for (const card of state.bot.field) { card.position = "attack"; card.isFacedown = false; }
  const action = required(bot.strategy.generateMainPhaseActions(state).find(entry => entry.type === "synchro" && entry.cardId === 514));
  bot.strategy.simulateMainPhaseAction(state, action);
  assert.deepEqual(state._simUnsupportedActions || [], []);
  assert.ok(state.bot.field.some(card => card.id === 514));
});

for (const actor of ["player", "bot"] as const) {
  test(`Tech-Zero ends an exhausted position without recycling a spent HOPT (${actor})`, async t => {
    const { bot, botGame } = scenario(t, actor);
    const state = bot.cloneGameState(botGame);
    const core = required(state.bot.hand.find(card => card.id === 501));
    const machine = required(state.bot.extraDeck.find(card => card.id === 503));
    state.bot.hand = [];
    state.bot.deck = [];
    state.bot.field = [core, machine];
    state.bot.extraDeck = state.bot.extraDeck.filter(card => card.id === 509);
    state.bot.summonCount = 1;
    for (const card of state.bot.field) { card.isFacedown = false; card.position = "attack"; }
    const effect = required(machine.effects?.find(entry => entry.id === "tech_zero_multimodal_machine_level_mod"));
    markSimulatedEffectUsage(state, effect, machine, state.bot.id, true);
    assert.deepEqual(bot.strategy.generateMainPhaseActions(state), []);
    const reports: TurnLineSearchCompletion[] = [];
    const profile = required(bot.strategy.getPlanningProfile).call(bot.strategy, state);
    const result = await turnLineSearch(state, bot.strategy, { ...profile, profile, onComplete: report => reports.push(report) });
    assert.equal(result, null);
    assert.deepEqual(reports, [{ terminationReason: "no_candidates", nodesEvaluated: 0,
      unsupportedBranches: 0, repeatedStates: 0 }]);
    assert.equal(state.bot.lp, 8000, "empty Deck is nonfatal under the current rules");
  });

  test(`Tech-Zero returns an executable opening at its node limit (${actor})`, async t => {
    const { bot, botGame } = scenario(t, actor);
    bot.deck.push(...bot.hand.splice(1));
    const profile = { ...required(bot.strategy.getPlanningProfile).call(bot.strategy, botGame), nodeBudget: 1 };
    const result = required(await turnLineSearch(botGame, bot.strategy, { ...profile, profile }));
    assert.equal(result.completion.terminationReason, "node_budget");
    assert.equal(result.nodesEvaluated, 1);
    assert.deepEqual(result.finalState?._simUnsupportedActions || [], []);
    assert.equal(bot.field.length, 0, "bounded search must not mutate the live board");
    assert.ok(result.action.type !== "simulatedBattle");
    assert.equal(await bot.executeMainPhaseAction(botGame, result.action), true);
  });

  for (const trapId of [520, 17]) {
    test(`Tech-Zero prepares its reactive backrow before stopping (${actor}, ${trapId})`, async t => {
      const { game, bot, botGame, make } = scenario(t, actor);
      game.phase = "main2";
      bot.hand = [make(trapId)];
      bot.summonCount = 1;
      placeFieldCards(bot.field, make(516));
      bot.extraDeck = [];
      const profile = required(bot.strategy.getPlanningProfile).call(bot.strategy, botGame);
      const result = required(await turnLineSearch(botGame, bot.strategy, { ...profile, profile }));
      assert.equal(result.action.type, "set_spell_trap");
      assert.equal(await bot.executeMainPhaseAction(botGame, result.action), true);
      assert.equal(bot.hand.length, 0);
      assert.equal(bot.spellTrap[0]?.id, trapId);
    });
  }

  test(`Tech-Zero's first decision ignores hidden deck order and opposing identities (${actor})`, async t => {
    const { bot, botGame, opponent, make } = scenario(t, actor, "wyvern");
    const secret = make(501); secret.owner = opponent.id; secret.isFacedown = true; secret.position = "defense";
    opponent.field = [secret];
    opponent.hand = [make(501)];
    const first = bot.cloneGameState(botGame), second = bot.cloneGameState(botGame);
    second.bot.deck.reverse();
    const replacement = required(second.bot.extraDeck.find(card => card.id === 517));
    second.player.field = [{ ...replacement, instanceId: secret.instanceId, owner: opponent.id, isFacedown: true, position: "defense" }];
    second.player.hand = [{ ...replacement, owner: opponent.id }];
    const profile = required(bot.strategy.getPlanningProfile).call(bot.strategy, botGame);
    const left = required(await turnLineSearch(first, bot.strategy, { ...profile, profile }));
    const right = required(await turnLineSearch(second, bot.strategy, { ...profile, profile }));
    assert.deepEqual(fingerprintAction(left.action), fingerprintAction(right.action));
    assert.equal(left.score, right.score);
    assert.deepEqual(left.sequence.map(fingerprintAction), right.sequence.map(fingerprintAction));
    assert.deepEqual(first.bot.deck.map(card => card.instanceId), bot.deck.map(card => card.instanceId), "search leaves its input untouched");
  });

  for (const combo of ["lancer", "wyvern", "raptor"] as const) {
    for (const drawIds of combo === "lancer" ? [[518, 17], [519, 520]] : [[518, 17]]) {
    test(`Tech-Zero searches and executes ${combo} from its opening (${actor}, draws ${drawIds})`, async t => {
      const { game, botGame, bot, draws, summons } = scenario(t, actor, combo, drawIds);
      const decisions: string[] = [];
      const target = combo === "lancer" ? 516 : 517;
      for (let step = 0; step < 16 && !bot.field.some(card => card.id === target); step++) {
        const profile = required(bot.strategy.getPlanningProfile).call(bot.strategy, botGame);
        const result = await turnLineSearch(botGame, bot.strategy, {
          ...profile, profile, preGeneratedActions: bot.generateMainPhaseActions(botGame),
        });
        assert.ok(result?.action, `no plan: field=${bot.field.map(card => `${card.id}:${card.level}`)}; actions=${decisions}`);
        assert.ok(result.nodesEvaluated <= profile.nodeBudget);
        assert.deepEqual(result.finalState?._simUnsupportedActions || [], []);
        if (result.finalState?._simRequiresReplan) {
          assert.equal(result.completion.terminationReason, "requires_replan");
        }
        const action = result.action;
        assert.ok(action.type !== "simulatedBattle", "this profile plans Main Phase actions only");
        decisions.push(`${action.type}:${action.cardId || action.effectId || ""}`);
        assert.equal(await bot.executeMainPhaseAction(botGame, action), true, result.reason);
      }
      assert.ok(bot.field.some(card => card.id === target), `${combo} did not reach its useful boss: ${decisions}`);
      assert.ok(summons.includes(503) && summons.includes(509), "the search retains the low-ATK M/Portal route");
      assert.ok(draws.every(card => bot.hand.includes(card)), "the line does not spend its two unknown draws");
      assert.equal(game.turn, actor);
      const boss = required(bot.field.find(card => card.id === target));
      if (combo === "lancer") assert.ok((boss.attackLimitThisTurn || 0) >= 2, "Lancer offers the intended offensive payoff");
      if (combo === "wyvern") assert.ok(bot.field.some(card => card.id === 510) ||
        bot.field.some(card => card.id === 509) && game.isBattleDestructionProtected(boss),
        "keep Slasher's pressure or convert its direct protection while preserving Portal");
      if (combo === "raptor") {
        assert.ok(bot.field.some(card => card.id === 501), "preserve revived Core beside the protected boss");
        assert.equal(game.isBattleDestructionProtected(boss), true);
      }
    });
    }
  }
}
