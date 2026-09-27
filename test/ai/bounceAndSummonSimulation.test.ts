import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import type { AIAction, AIActionOf } from "../../src/core/contracts/ai.js";
import type { AiLiveGamePort } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function scenario(t: TestContext, actor: "player" | "bot") {
  const first = new Bot("techzero"); first.id = "player";
  const second = new Bot("techzero");
  const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true });
  game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot supplies Player runtime and effect selections");
  t.after(() => game.dispose("bounce_and_summon_simulation_test"));
  game.turn = actor; game.phase = "main1"; game.turnCounter = 2; game.disablePresentationDelays = true;
  const bot = actor === "player" ? first : second;
  const botGame = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game,
    "Concrete Game supplies the attached Bot runtime and clone capabilities");
  first.game = botGame; second.game = botGame;
  const source = new Card(cardDefinition("Void Walker"), actor);
  const effect = required(source.effects.find(entry => entry.id === "void_walker_bounce_summon"));
  placeFieldCards(bot.field, source);
  const action: AIActionOf<"monsterEffect"> = { type: "monsterEffect", cardId: source.id,
    cardName: source.name, fieldIndex: 0, effectId: effect.id };
  return { game, botGame, bot, source, effect, action };
}

for (const actor of ["player", "bot"] as const) {
  test(`bounce and summon with no eligible hand card is absent from generation and preflight (${actor})`, async t => {
    const { bot, botGame, source, action } = scenario(t, actor);
    const unrelated = new Card(cardDefinition("Tech-Zero Prism Activator"), actor);
    bot.hand = [unrelated];
    const isSourceEffect = (candidate: AIAction) => candidate.type === "monsterEffect" && candidate.cardId === source.id;
    assert.equal(bot.generateMainPhaseActions(botGame).some(isSourceEffect), false);
    const state = bot.cloneGameState(botGame);
    Object.defineProperty(state, "_gameRef", { get() { throw new Error("simulation consulted live Game"); } });
    assert.equal(bot.strategy.generateMainPhaseActions(state).some(isSourceEffect), false);
    assert.deepEqual(bot.filterValidActionsForCurrentState([action], botGame), []);
    assert.equal(await bot.executeMainPhaseAction(botGame, action), false);
    assert.deepEqual(bot.field, [source]);
    assert.deepEqual(bot.hand, [unrelated]);
  });

  test(`bounce and summon validates its hand candidate before any movement (${actor})`, async t => {
    const { game, bot, botGame, source, effect } = scenario(t, actor);
    const unrelated = new Card(cardDefinition("Tech-Zero Electrocatapult"), actor);
    bot.hand = [unrelated];
    const state = bot.cloneGameState(botGame);
    const beforeField = [...state.bot.field]; const beforeHand = [...state.bot.hand];
    const events: string[] = [];
    applySimulatedActions({ state, actions: effect.actions, options: { sourceCard: required(state.bot.field[0]),
      emitSimulatedEvent: event => { events.push(event); } } });
    assert.deepEqual(state.bot.field, beforeField);
    assert.deepEqual(state.bot.hand, beforeHand);
    assert.deepEqual(events, []);
    game.on("card_moved", () => { assert.fail("runtime must refuse before the source moves"); });
    await game.effectEngine.applyActions(required(effect.actions), {
      player: game[actor], opponent: game[actor === "player" ? "bot" : "player"], source,
    }, {});
    assert.deepEqual(bot.field, [source]);
    assert.deepEqual(bot.hand, [unrelated]);
  });

  for (const position of ["attack", "defense"] as const) {
    test(`bounce frees a full field and summons in the selected position (${actor}, ${position})`, async t => {
      const { game, bot, botGame, source, effect, action } = scenario(t, actor);
      const target = new Card(cardDefinition("Void Beast"), actor);
      bot.hand = [target];
      placeFieldCards(bot.field, ...Array.from({ length: 4 }, () => new Card(cardDefinition("Tech-Zero Glider Wyvern"), actor)));
      bot.strategy.chooseSpecialSummonPosition = () => position;
      assert.ok(bot.generateMainPhaseActions(botGame).some(candidate => candidate.type === "monsterEffect" && candidate.cardId === source.id));
      assert.deepEqual(bot.filterValidActionsForCurrentState([action], botGame), [action]);
      const state = bot.cloneGameState(botGame);
      const simSource = required(state.bot.field[0]); const simTarget = required(state.bot.hand[0]);
      const simulatedEvents: string[] = [];
      applySimulatedActions({ state, actions: effect.actions, options: {
        sourceCard: simSource, chooseSpecialSummonPosition: () => position,
        emitSimulatedEvent(event, payload) {
          const card = Reflect.get(payload, "card");
          if (event === "card_moved") simulatedEvents.push(card === simSource ? "source_to_hand" : "target_to_field");
          if (event === "after_summon") {
            assert.equal(card, simTarget);
            assert.ok(state.bot.hand.includes(simSource));
            assert.equal(simTarget.position, position);
            simulatedEvents.push("target_summoned");
          }
        },
      } });
      const runtimeEvents: string[] = [];
      game.on("card_moved", payload => { runtimeEvents.push(payload.card === source ? "source_to_hand" : "target_to_field"); });
      game.on("after_summon", payload => { if (payload.card === target) runtimeEvents.push("target_summoned"); });
      assert.equal(await bot.executeMainPhaseAction(botGame, action), true);
      assert.deepEqual(runtimeEvents, ["source_to_hand", "target_summoned", "target_to_field"]);
      assert.deepEqual(simulatedEvents, runtimeEvents);
      assert.deepEqual(state.bot.field.map(card => card.instanceId), bot.field.map(card => card.instanceId));
      assert.deepEqual(state.bot.hand.map(card => card.instanceId), [source.instanceId]);
      assert.equal(simTarget.position, target.position);
      assert.equal(simTarget.isFacedown, false);
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }
}
