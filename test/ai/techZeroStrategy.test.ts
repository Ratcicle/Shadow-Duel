import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import { getPlanningModel } from "../../src/core/ai/PlanningStrategies.js";
import { resolveRegisteredStrategy } from "../../src/core/ai/StrategyRegistry.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { AiLiveGamePort, AiPlayerInput } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function scenario(t: TestContext, actor: "player" | "bot") {
  const first = new Bot("techzero");
  first.id = "player";
  const second = new Bot("techzero");
  const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true });
  game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot supplies the Player runtime and clone interface");
  t.after(() => game.dispose("tech_zero_strategy_test"));
  game.turn = actor;
  game.phase = "main1";
  game.turnCounter = 2;
  game.disablePresentationDelays = true;
  game.ui.showConfirmPrompt = async () => true;
  game.ui.showTrapActivationModal = async () => true;
  const bot = actor === "player" ? first : second;
  const botGame = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game,
    "Concrete Game satisfies the attached Bot runtime and snapshot boundaries");
  first.game = botGame;
  second.game = botGame;
  const make = (id: number) => new Card(cardDefinition(id), bot.id);
  return { game, bot, botGame, make };
}

function board(player: AiPlayerInput) {
  return {
    field: player.field?.map(card => ({ id: card.id, instanceId: card.instanceId, level: card.level,
      negated: !!card.effectsNegated, position: card.position })).sort((a, b) => (a.id || 0) - (b.id || 0)),
    graveyard: player.graveyard?.map(card => card.id).sort(),
    extraDeck: player.extraDeck?.map(card => card.id).sort(),
    hand: player.hand?.length, deck: player.deck?.length, normals: player.summonCount,
  };
}

test("Tech-Zero uses its registered strategy and snapshot planning model", () => {
  const strategy = required(resolveRegisteredStrategy("techzero"));
  const bot = new Bot("techzero");
  assert.ok(bot.strategy instanceof strategy);
  assert.equal(strategy.name, "TechZeroStrategy");
  assert.equal(getPlanningModel("techzero").id, "techzero");
});

for (const actor of ["player", "bot"] as const) {
  test(`Tech-Zero preserves direct lethal and spends reserved resources to defend (${actor})`, t => {
    const { game, bot, botGame, make } = scenario(t, actor);
    assert.ok(resolveRegisteredStrategy("techzero"));
    const opponent = actor === "player" ? game.bot : game.player;
    bot.hand.push(make(519));
    bot.graveyard.push(make(501), make(503));
    bot.graveyard[1]!.properSummonEstablished = true;
    bot.deck.push(make(502));
    const lancer = make(516);
    placeFieldCards(bot.field, lancer);
    opponent.lp = 500;
    assert.equal(bot.strategy.generateMainPhaseActions(botGame).some(action => action.type === "spell" && action.cardId === 519), false);
    bot.field.length = 0;
    bot.lp = 500;
    opponent.lp = 8000;
    const threat = new Card(cardDefinition(516), opponent.id);
    placeFieldCards(opponent.field, threat);
    const action = required(bot.strategy.generateMainPhaseActions(botGame).find(entry => entry.type === "spell" && entry.cardId === 519));
    assert.equal(action.activationContext?.decisions?.selections?.tech_zero_assembly_line_banish_cost?.length, 2);
  });

  test(`Tech-Zero decisions execute the opening through Portal without selection overrides (${actor})`, async t => {
    const { game, bot, botGame, make } = scenario(t, actor);
    assert.ok(resolveRegisteredStrategy("techzero"));
    const core = make(501), catapult = make(502), multimodal = make(503), portal = make(509);
    bot.hand.push(catapult, core);
    bot.extraDeck.push(multimodal, portal);
    bot.deck.push(make(518), make(520));
    const pick = (actions: AIAction[], step: number) => required(actions.find(action => step === 0
      ? action.type === "summon" && action.cardId === 502
      : step === 1 ? action.type === "synchro" && action.synchroInstanceId === multimodal.instanceId && action.position === "attack"
      : step === 2 ? action.type === "monsterEffect" && action.effectId === "tech_zero_multimodal_machine_level_mod"
      : action.type === "synchro" && action.synchroInstanceId === portal.instanceId && action.position === "attack"));
    for (let step = 0; step < 4; step++) {
      const liveActions = bot.strategy.generateMainPhaseActions(botGame);
      const action = pick(liveActions, step);
      const state = bot.cloneGameState(botGame);
      const strategy = new (required(resolveRegisteredStrategy("techzero")))(state.bot);
      const planned = pick(strategy.generateMainPhaseActions(state), step);
      assert.deepEqual(planned.activationContext?.decisions, action.activationContext?.decisions, "preview and clone choose identical instances");
      strategy.simulateMainPhaseAction(state, planned);
      assert.equal(await bot.executeMainPhaseAction(botGame, action), true, `step ${step}`);
      assert.deepEqual(board(state.bot), board(bot), `step ${step}`);
      assert.deepEqual(state._simUnsupportedActions || [], []);
      if (step === 0) assert.equal(catapult.level, 2);
      if (step === 2) assert.equal(multimodal.level, 1);
    }
    assert.deepEqual(bot.field.map(card => card.id).sort(), [501, 502, 503, 509]);
    assert.equal(game.turn, actor);
  });

  test(`Tech-Zero generates reusable Electrocatapult material choices after negated M revival (${actor})`, async t => {
    const { bot, botGame, make } = scenario(t, actor);
    assert.ok(resolveRegisteredStrategy("techzero"));
    const catapult = make(502), core = make(501), multimodal = make(503), slasher = make(510);
    multimodal.properSummonEstablished = true;
    placeFieldCards(bot.field, catapult, core);
    bot.graveyard.push(multimodal);
    bot.extraDeck.push(slasher);
    bot.deck.push(make(518));
    const action = required(bot.strategy.generateMainPhaseActions(botGame).find(entry => entry.type === "synchro" && entry.cardId === 510 && entry.position === "attack"));
    const state = bot.cloneGameState(botGame);
    const strategy = new (required(resolveRegisteredStrategy("techzero")))(state.bot);
    strategy.simulateMainPhaseAction(state, action);
    assert.equal(await bot.executeMainPhaseAction(botGame, action), true);
    assert.deepEqual(board(state.bot), board(bot));
    assert.ok(bot.field.includes(multimodal));
    assert.equal(multimodal.effectsNegated, true);
  });
}
