import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import TechZeroStrategy from "../../src/core/ai/TechZeroStrategy.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import type { CardAction } from "../../src/core/contracts/actions.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import type { AiCardInput, AiLiveGamePort } from "../../src/core/contracts/aiState.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function scenario(t: TestContext, actor: "player" | "bot") {
  const first = new Bot("techzero");
  first.id = "player";
  const second = new Bot("techzero");
  const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true });
  game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot supplies Player and snapshot interfaces");
  t.after(() => game.dispose("tech_zero_draw_planning_test"));
  game.turn = actor;
  game.phase = "main1";
  game.turnCounter = 2;
  game.disablePresentationDelays = true;
  const bot = actor === "player" ? first : second;
  const botGame = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game,
    "Concrete Game supplies Bot execution and snapshot boundaries");
  first.game = botGame;
  second.game = botGame;
  const make = (id: number) => new Card(cardDefinition(id), actor);
  return { game, bot, botGame, make };
}

for (const actor of ["player", "bot"] as const) {
  for (const mode of ["empty", "partial", "zero"] as const) {
    test(`draw planning preserves runtime ${mode} draw and its following action (${actor})`, async t => {
      const { game, bot, botGame, make } = scenario(t, actor);
      if (mode === "partial") bot.deck.push(make(518));
      const state = bot.cloneGameState(botGame);
      const actions: CardAction[] = [
        { type: "draw", player: "self", amount: mode === "zero" ? 0 : 2 },
        { type: "heal", player: "self", amount: 500 },
      ];
      const result = await game.effectEngine.applyActions(actions,
        { source: make(501), player: actor === "player" ? game.player : game.bot,
          opponent: actor === "player" ? game.bot : game.player }, {});
      applySimulatedActions({ state, actions });
      assert.equal(result.success, mode !== "empty");
      assert.equal(bot.lp, mode === "empty" ? 8000 : 8500);
      assert.equal(state.bot.lp, bot.lp, "a failed mandatory draw cannot manufacture the later heal");
      assert.equal(state.bot.hand.length, bot.hand.length);
      assert.equal(state.bot.deck.length, bot.deck.length);
      assert.equal(game.gameOver, false, "the current rules do not lose the duel for an empty Deck");
      assert.equal(state._simRequiresReplan === true, mode === "partial");
      assert.equal(state._simUnknownDrawCount || 0, mode === "partial" ? 1 : 0);
      assert.ok(state.bot.hand.every(card => card._simUnknownDraw && card.id === undefined));
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }

  for (const optional of [false, true]) {
    test(`draw matches empty draw continuation with optional=${optional} (${actor})`, async t => {
      const { game, bot, botGame, make } = scenario(t, actor);
      const state = bot.cloneGameState(botGame);
      const actions: CardAction[] = [
        unsafeFixture<CardAction>({ type: "draw", amount: 1, player: "self", optional },
          "The runtime accepts optional failures beyond draw's closed declarative schema; verify that boundary without broadening card definitions"),
        { type: "heal", player: "self", amount: 500 },
      ];
      const result = await game.effectEngine.applyActions(actions,
        { source: make(501), player: actor === "player" ? game.player : game.bot,
          opponent: actor === "player" ? game.bot : game.player }, {});
      applySimulatedActions({ state, actions });
      assert.equal(result.success, optional);
      assert.equal(state.bot.lp, bot.lp);
      assert.equal(bot.lp, optional ? 8500 : 8000);
      assert.equal(state._simRequiresReplan === true, false);
    });

    test(`draw-and-summon matches empty draw continuation with optional=${optional} (${actor})`, async t => {
      const { game, bot, botGame, make } = scenario(t, actor);
      const state = bot.cloneGameState(botGame);
      const actions: CardAction[] = [
        { type: "draw_and_summon", drawAmount: 1, optional },
        { type: "heal", player: "self", amount: 500 },
      ];
      const result = await game.effectEngine.applyActions(actions,
        { source: make(508), player: actor === "player" ? game.player : game.bot,
          opponent: actor === "player" ? game.bot : game.player }, {});
      applySimulatedActions({ state, actions });
      assert.equal(result.success, optional);
      assert.equal(state.bot.lp, bot.lp);
      assert.equal(bot.lp, optional ? 8500 : 8000);
      assert.equal(state._simRequiresReplan === true, false);
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }

  test(`a failed Core draw preserves the separate Electrocatapult revival (${actor})`, async t => {
    const { game, bot, botGame, make } = scenario(t, actor);
    const core = make(501), catapult = make(502), multimodal = make(503);
    catapult.level = 2;
    placeFieldCards(bot.field, core, catapult);
    bot.extraDeck.push(multimodal);
    const state = bot.cloneGameState(botGame);
    const strategy = new TechZeroStrategy(state.bot);
    const action = required(strategy.generateMainPhaseActions(state).find(candidate =>
      candidate.type === "synchro" && candidate.cardId === 503 && candidate.position === "attack"));
    strategy.simulateMainPhaseAction(state, action);
    assert.equal(await bot.executeMainPhaseAction(botGame, action), true);
    const board = (cards: readonly AiCardInput[]) => cards.map(card => ({
      id: card.id, level: card.level, negated: !!card.effectsNegated,
    })).sort((a, b) => (a.id || 0) - (b.id || 0));
    assert.deepEqual(board(state.bot.field), board(bot.field));
    assert.deepEqual(bot.field.map(card => card.id).sort(), [501, 503]);
    assert.equal(core.effectsNegated, true);
    assert.equal(state.bot.hand.length, 0);
    assert.equal(state._simRequiresReplan === true, false);
    assert.equal(game.gameOver, false);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });
}
