import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { AiLiveGamePort } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function scenario(t: TestContext, actor: "player" | "bot") {
  const first = new Bot("techzero"); first.id = "player";
  const second = new Bot("techzero");
  const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true });
  game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot supplies Player runtime and clone capabilities");
  t.after(() => game.dispose("tribute_event_parity_test"));
  game.turn = actor; game.phase = "main1"; game.turnCounter = 2; game.disablePresentationDelays = true;
  const botGame = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game,
    "Concrete Game supplies attached Bot runtime and snapshot boundaries");
  first.game = botGame; second.game = botGame;
  const bot = actor === "player" ? first : second;
  for (const player of [first, second]) {
    const court = new Card(cardDefinition(17), player.id);
    court.isFacedown = false;
    placeFieldCards(player.spellTrap, court);
  }
  return { game, botGame, bot, make: (id: number) => new Card(cardDefinition(id), bot.id) };
}

for (const actor of ["player", "bot"] as const) {
  test(`tribute costs and the summoned monster share one trigger opportunity (${actor})`, async t => {
    const { game, botGame, bot, make } = scenario(t, actor);
    placeFieldCards(bot.field, make(501), make(504));
    const summoned = make(104);
    bot.hand.push(summoned);
    const action: AIAction = { type: "summon", index: 0, cardId: summoned.id, position: "attack" };
    const state = bot.cloneGameState(botGame);
    const actual: string[] = [];
    const predicted: string[] = [];
    const actualCountersAtSummonEffect: number[][] = [];
    const predictedCountersAtSummonEffect: number[][] = [];
    const summonEffectId = "shadow_heart_arctroth_on_summon";
    game.on("chain_link_resolution", payload => {
      if (payload.stage !== "resolving" || !payload.effectId) return;
      actual.push(payload.effectId);
      if (payload.effectId === summonEffectId) {
        actualCountersAtSummonEffect.push([game.player, game.bot].map(player =>
          required(player.spellTrap[0]).getCounter("funeral")));
      }
    });
    applyGenericSimulatedMainPhaseAction(state, action, {
      enableSimulatedEvents: true,
      getTributeRequirementFor: bot.getTributeRequirementFor.bind(bot),
      selectBestTributes: bot.selectBestTributes.bind(bot),
      onEffectActivated: (input: unknown) => {
        if (typeof input !== "object" || input === null) return;
        const effect: unknown = Reflect.get(input, "effect");
        if (typeof effect !== "object" || effect === null) return;
        const effectId: unknown = Reflect.get(effect, "id");
        if (typeof effectId !== "string") return;
        predicted.push(effectId);
        if (effectId === summonEffectId) {
          predictedCountersAtSummonEffect.push([state.player, state.bot].map(player =>
            required(player.spellTrap[0]).counters?.get("funeral") || 0));
        }
      },
    });
    assert.equal(await bot.executeMainPhaseAction(botGame, action), true);
    assert.equal(actual[0], summonEffectId,
      "the optional summon trigger resolves before the mandatory tribute triggers in their shared SEGOC Chain");
    assert.deepEqual(predicted, actual);
    assert.deepEqual(actualCountersAtSummonEffect, [[0, 0]]);
    assert.deepEqual(predictedCountersAtSummonEffect, actualCountersAtSummonEffect);
  });

  for (const kind of ["one tribute", "two tributes", "banished tribute", "token tribute"] as const) {
    test(`normal summon publishes each ${kind} movement and Court counters (${actor})`, async t => {
      const { game, botGame, bot, make } = scenario(t, actor);
      const material = make(501);
      if (kind === "banished tribute") material.banishWhenLeavesField = true;
      if (kind === "token tribute") material.isToken = true;
      const materials = kind === "two tributes" ? [material, make(504)] : [material];
      placeFieldCards(bot.field, ...materials);
      const summoned = make(507);
      if (kind === "two tributes") summoned.level = 7;
      bot.hand.push(summoned);
      const action: AIAction = { type: "summon", index: 0, cardId: summoned.id, position: "attack" };
      const state = bot.cloneGameState(botGame);
      const observed = (field: () => readonly { instanceId?: string | number }[], funeralCounters: () => number[]) => {
        const events: object[] = [];
        return { events, record(event: string, payload: object) {
          const card: unknown = Reflect.get(payload, "card");
          if (typeof card !== "object" || card === null) return;
          const id: unknown = Reflect.get(card, "instanceId");
          const materialIndex = materials.findIndex(candidate => candidate.instanceId === id);
          if (materialIndex < 0 && !(event === "after_summon" && id === summoned.instanceId)) return;
          events.push({ event, materialIndex, from: Reflect.get(payload, "fromZone") ?? null,
            to: Reflect.get(payload, "toZone") ?? null,
            movedByEffect: Reflect.get(payload, "movedByEffect") ?? false,
            contextLabel: Reflect.get(payload, "contextLabel") ?? null,
            funeralCounters: funeralCounters(),
            remainingMaterials: materials.flatMap((candidate, index) => field().some(entry =>
              entry.instanceId === candidate.instanceId) ? [index] : []) });
        } };
      };
      const actual = observed(() => bot.field, () => [game.player, game.bot].map(player =>
        required(player.spellTrap[0]).getCounter("funeral")));
      const predicted = observed(() => state.bot.field, () => [state.player, state.bot].map(player =>
        required(player.spellTrap[0]).counters?.get("funeral") || 0));
      for (const event of ["card_to_grave", "card_moved", "after_summon"] as const) {
        game.on(event, payload => actual.record(event, payload));
      }
      applyGenericSimulatedMainPhaseAction(state, action, {
        enableSimulatedEvents: true,
        getTributeRequirementFor: bot.getTributeRequirementFor.bind(bot),
        selectBestTributes: bot.selectBestTributes.bind(bot),
        onSimulatedEvent: (event, payload) => predicted.record(event, payload),
      });
      assert.equal(await bot.executeMainPhaseAction(botGame, action), true);
      const expectedCounters = kind === "one tribute" ? 1 : kind === "two tributes" ? 2 : 0;
      for (const player of [game.player, game.bot]) {
        assert.equal(required(player.spellTrap[0]).getCounter("funeral"), expectedCounters);
      }
      for (const player of [state.player, state.bot]) {
        assert.equal(required(player.spellTrap[0]).counters?.get("funeral") || 0, expectedCounters);
      }
      assert.deepEqual(predicted.events, actual.events, "movement ordering, destinations and intermediate fields match runtime");
      const destination = kind === "banished tribute" ? "banished" : kind === "token tribute" ? "removed" : "graveyard";
      assert.ok(actual.events.some(entry => Reflect.get(entry, "event") === "card_moved" && Reflect.get(entry, "to") === destination));
      assert.equal(actual.events.filter(entry => Reflect.get(entry, "event") === "card_to_grave").length, expectedCounters);
      assert.equal(Reflect.get(required(actual.events.at(-1)), "event"), "after_summon");
      assert.deepEqual(Reflect.get(required(actual.events.at(-1)), "funeralCounters"), [0, 0],
        "tribute triggers resolve after the summon procedure completes");
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }
}
