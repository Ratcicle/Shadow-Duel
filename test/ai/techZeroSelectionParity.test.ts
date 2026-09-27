import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import type { AiLiveGamePort, AiPlayerInput } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function scenario(t: TestContext, actor: "player" | "bot") {
  const first = new Bot("techzero"); first.id = "player";
  const second = new Bot("techzero");
  const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true });
  game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot supplies the Player runtime and clone interface");
  t.after(() => game.dispose("tech_zero_selection_parity_test"));
  game.turn = actor; game.phase = "main1"; game.turnCounter = 2; game.disablePresentationDelays = true;
  const bot = actor === "player" ? first : second;
  const botGame = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game,
    "Concrete Game supplies attached Bot runtime and snapshot boundaries");
  first.game = botGame; second.game = botGame;
  return { game, botGame, bot, make: (id: number) => new Card(cardDefinition(id), bot.id) };
}

function zones(player: AiPlayerInput) {
  return { field: player.field?.map(card => ({ id: card.id, instanceId: card.instanceId,
    position: card.position, level: card.level, negated: !!card.effectsNegated })).sort((a, b) => (a.id || 0) - (b.id || 0)),
  graveyard: player.graveyard?.map(card => card.instanceId).sort() };
}

for (const actor of ["player", "bot"] as const) {
  test(`Mage nested revival retains its previously selected cost in simulation (${actor})`, async t => {
    const { bot, botGame, make } = scenario(t, actor);
    const machine = make(503), mage = make(512), ghost = make(511), catapult = make(502);
    placeFieldCards(bot.field, machine, mage, ghost); bot.graveyard.push(catapult);
    const action = required(bot.strategy.generateMainPhaseActions(botGame).find(candidate =>
      candidate.effectId === "tech_zero_battle_mage_recycle_revive"));
    const state = bot.cloneGameState(botGame);
    bot.strategy.simulateMainPhaseAction(state, action);
    assert.equal(await bot.executeMainPhaseAction(botGame, action), true);
    assert.ok(bot.field.includes(catapult)); assert.ok(bot.graveyard.includes(machine));
    assert.deepEqual(zones(state.bot), zones(bot));
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  test(`Ghost resolves known material revival and recovery around an unknown draw (${actor})`, async t => {
    const { bot, botGame, make } = scenario(t, actor);
    const core = make(501), catapult = make(502), machine = make(503), ghost = make(511);
    core.level = 2; core.originalLevel = 1; machine.properSummonEstablished = true;
    placeFieldCards(bot.field, make(517), core, catapult);
    bot.graveyard.push(machine); bot.extraDeck.push(ghost); bot.deck.push(make(518), make(520));
    const action = required(bot.strategy.generateMainPhaseActions(botGame).find(candidate =>
      candidate.type === "synchro" && candidate.cardId === 511 && candidate.position === "attack"));
    const state = bot.cloneGameState(botGame);
    bot.strategy.simulateMainPhaseAction(state, action);
    assert.equal(await bot.executeMainPhaseAction(botGame, action), true);
    assert.ok(bot.field.includes(machine)); assert.ok(bot.hand.includes(core));
    assert.deepEqual(zones(state.bot), zones(bot));
    assert.equal(state.bot.hand.length, bot.hand.length);
    assert.equal(state._simRequiresReplan, true);
  });
}
