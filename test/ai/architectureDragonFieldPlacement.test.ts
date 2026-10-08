import assert from "node:assert/strict";
import test from "node:test";
import Bot from "../../src/core/Bot.js";
import DragonStrategy from "../../src/core/ai/DragonStrategy.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame } from "../helpers/game.js";

for (const actor of ["bot", "player"] as const) for (const available of [false, true]) {
  test(`Dragon Field Spell remains in its actual field zone after on-play resolution (${actor}/${available})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, randomSeed: 42 });
    t.after(() => game.dispose("architecture_dragon_field_placement"));
    const owner = Object.assign(new Bot("dragon"), { oncePerDuelUsageByName: {} as Record<string, number> });
    owner.id = actor;
    game[actor] = owner;
    owner.game = unsafeFixture<BotGamePort>(game,
      "The concrete Game supplies runtime Bot capabilities; its fixture EffectEngine projection is narrower.");
    game.turn = actor; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    game.waitForPresentationDelay = async () => {};
    game.waitForAiPresentationStep = async () => {};
    game[actor === "bot" ? "player" : "bot"].controllerType = "ai";
    const source = required(game.createCardForOwner(262, owner));
    owner.hand.push(source);
    if (available) owner.graveyard.push(required(game.createCardForOwner(252, owner)));
    const { state } = createGameTreeCopy(game, owner);
    const projectedSource = required(state.bot.hand[0]);
    const result = await game.tryActivateSpell(source, 0, null, { owner });
    assert.equal(result.success, true);
    assert.equal(owner.fieldSpell, source, "Runtime keeps the activated Field Spell in its field zone.");
    new DragonStrategy(state.bot).simulateMainPhaseAction(state,
      { type: "spell", index: 0, cardId: 262, cardName: source.name });
    assert.equal(state.bot.fieldSpell, projectedSource, "The bridge must retain the same projected physical source.");
    assert.deepEqual(state.bot.hand.map(card => card.id), owner.hand.map(card => card.id));
    assert.deepEqual(state.bot.graveyard.map(card => card.id), owner.graveyard.map(card => card.id));
    assert.equal(projectedSource.locationVersion, source.locationVersion);
    assert.deepEqual(state._simUnsupportedActions ?? [], []);
  });
}

for (const actor of ["bot", "player"] as const) {
  test(`Dragon hand Spell activation normalizes an absent legacy face flag (${actor})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, randomSeed: 42 });
    t.after(() => game.dispose("architecture_dragon_field_placement"));
    const owner = Object.assign(new Bot("dragon"), { oncePerDuelUsageByName: {} as Record<string, number> });
    owner.id = actor;
    game[actor] = owner;
    owner.game = unsafeFixture<BotGamePort>(game,
      "The concrete Game supplies runtime Bot capabilities; its fixture EffectEngine projection is narrower.");
    game.turn = actor; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    game.waitForPresentationDelay = async () => {};
    game.waitForAiPresentationStep = async () => {};
    game[actor === "bot" ? "player" : "bot"].controllerType = "ai";
    const source = required(game.createCardForOwner(277, owner));
    owner.hand.push(source);
    const { state } = createGameTreeCopy(game, owner);
    const projectedSource = required(state.bot.hand[0]);
    delete projectedSource.isFacedown;
    assert.equal(projectedSource.isFacedown, undefined);
    assert.equal((await game.tryActivateSpell(source, 0, null, { owner })).success, true);
    assert.equal(source.isFacedown, false);
    new DragonStrategy(state.bot).simulateMainPhaseAction(state, { type: "spell", index: 0, cardId: 277 });
    assert.equal(state.bot.spellTrap[0], projectedSource);
    assert.equal(projectedSource.isFacedown, source.isFacedown);
    assert.deepEqual(state.bot.graveyard.map(card => card.id), owner.graveyard.map(card => card.id));
  });
}
