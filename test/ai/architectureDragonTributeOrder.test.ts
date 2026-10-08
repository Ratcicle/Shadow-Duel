import assert from "node:assert/strict";
import test from "node:test";
import Bot from "../../src/core/Bot.js";
import DragonStrategy from "../../src/core/ai/DragonStrategy.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import { createArchitectureFixture } from "../helpers/architectureBaseline.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

for (const actor of ["bot", "player"] as const) for (const setup of ["full_field", "finisher"] as const) {
  test(`Dragon runtime preserves policy tribute order and subsequent Lunar discard (${actor}/${setup})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, randomSeed: 42 });
    t.after(() => game.dispose("architecture_dragon_tribute_order"));
    const owner = Object.assign(new Bot("dragon"), { oncePerDuelUsageByName: {} as Record<string, number> });
    owner.id = actor; game[actor] = owner;
    const port = unsafeFixture<BotGamePort>(game,
      "The concrete Game supplies runtime Bot capabilities; its fixture EffectEngine projection is narrower.");
    owner.game = port;
    game.turn = actor; game.phase = "main1"; game.turnCounter = 5;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    game.waitForPresentationDelay = async () => {};
    game.waitForAiPresentationStep = async () => {};
    const opponent = game[actor === "bot" ? "player" : "bot"];
    opponent.controllerType = "ai";
    const fixture = createArchitectureFixture("dragon", setup, actor);
    for (const [runtime, template] of [[owner, fixture.state.bot], [opponent, fixture.state.player]] as const) {
      runtime.lp = template.lp; runtime.summonCount = template.summonCount;
      for (const zone of ["hand", "field", "graveyard", "deck", "extraDeck", "spellTrap", "banished"] as const) {
        for (const sample of template[zone]) {
          const card = required(game.createCardForOwner(required(sample.id), runtime));
          card.position = sample.position === "defense" ? "defense" : "attack";
          card.isFacedown = sample.isFacedown === true;
          card.lastSummonMethod = sample.lastSummonMethod ?? null;
          card.lastSummonedTurn = sample.lastSummonedTurn ?? null;
          card.enteredFieldTurn = sample.enteredFieldTurn ?? null;
          if (zone === "field" || zone === "spellTrap") placeFieldCards(runtime[zone], card);
          else runtime[zone].push(card);
        }
      }
    }
    const action = required(owner.generateMainPhaseActions(port).find(entry => entry.type === "summon" && entry.cardId === 270));
    const { state } = createGameTreeCopy(game, owner);
    assert.equal(await owner.executeMainPhaseAction(port, action), true);
    const strategy = new DragonStrategy(state.bot);
    strategy.simulateMainPhaseAction(state, action);
    const expected = setup === "full_field" ? [255, 280] : [252, 254];
    assert.deepEqual(owner.graveyard.map(card => card.id), expected, "Runtime moves tributes in the policy's order.");
    assert.deepEqual(state.bot.graveyard.map(card => card.id), expected);
    assert.deepEqual(state.bot.field.map(card => card.id), owner.field.map(card => card.id));
    if (setup === "full_field") {
      const lunarAction = required(owner.generateMainPhaseActions(port).find(entry =>
        entry.type === "graveyardMonsterEffect" && entry.effectId === "lunar_eclipse_gy_summon_deck_dragon"));
      assert.ok(lunarAction.type === "graveyardMonsterEffect");
      assert.equal(lunarAction.graveyardIndex, 1);
      const nextState = createGameTreeCopy(game, owner).state;
      assert.equal(await owner.executeMainPhaseAction(port, lunarAction), true);
      new DragonStrategy(nextState.bot).simulateMainPhaseAction(nextState, lunarAction);
      assert.deepEqual(nextState.bot.hand.map(card => card.id), owner.hand.map(card => card.id));
      assert.deepEqual(nextState.bot.graveyard.map(card => card.id), owner.graveyard.map(card => card.id));
      assert.deepEqual(nextState.bot.field.map(card => card.id), owner.field.map(card => card.id));
    }
  });
}
