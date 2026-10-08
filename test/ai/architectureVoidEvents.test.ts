import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import VoidStrategy from "../../src/core/ai/VoidStrategy.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { canUseSimulatedEffectUsage, markSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { canUseNormalSummonForCard } from "../../src/core/Player.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { createArchitectureFixture } from "../helpers/architectureBaseline.js";

for (const actor of ["bot", "player"] as const) {
  for (const replacesField of [false, true]) {
    test(`Void Field Spell placement moves each physical card once (${actor}/${replacesField})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
      t.after(() => game.dispose());
      game.turn = actor; game.phase = "main1"; game.turnCounter = 3;
      const owner = game[actor]; owner.controllerType = "ai";
      const source = new Card(cardDefinition(217), actor);
      const previous = replacesField ? new Card(cardDefinition(217), actor) : null;
      owner.hand.push(source);
      owner.fieldSpell = previous;
      const state = createGameTreeCopy(game, owner).state;
      const simulatedSource = required(state.bot.hand[0]);
      const simulatedPrevious = state.bot.fieldSpell;
      const movements: string[] = [];
      game.on("card_moved", ({ card, fromZone, toZone }) => {
        if (card === source || card === previous) movements.push(`${card === source ? "incoming" : "previous"}:${fromZone}->${toZone}`);
      });
      const result = await game.tryActivateSpell(source, 0, null, { owner });
      assert.equal(result.success, true);
      assert.equal(owner.fieldSpell, source);
      assert.deepEqual(owner.hand, []);
      assert.deepEqual(owner.graveyard, previous ? [previous] : []);
      assert.deepEqual(movements, [
        ...(previous ? ["previous:fieldSpell->graveyard"] : []), "incoming:hand->fieldSpell",
      ]);
      const effect = required(source.effects.find(entry => entry.id === "the_void_summon"));
      new VoidStrategy(state.bot).simulateMainPhaseAction(state, { type: "spell", index: 0, cardId: 217 });
      assert.equal(state.bot.fieldSpell, simulatedSource);
      assert.deepEqual(state.bot.hand, []);
      assert.deepEqual(state.bot.graveyard, simulatedPrevious ? [simulatedPrevious] : []);
      assert.equal(canUseSimulatedEffectUsage(state, effect, simulatedSource, actor, true), true,
        "Activating the Field Spell does not fabricate its separate Main Phase effect.");
    });
  }

  for (const candidateId of [204, 205]) {
    test(`Void Beast Strategy searches a legal runtime candidate once (${actor}/${candidateId})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
      t.after(() => game.dispose());
      game.turn = actor; game.phase = "main1"; game.turnCounter = 3;
      const owner = game[actor]; owner.controllerType = "ai";
      const source = new Card(cardDefinition(203), actor);
      owner.hand.push(source);
      owner.deck.push(new Card(cardDefinition(candidateId), actor));
      const state = createGameTreeCopy(game, owner).state;
      const strategy = new VoidStrategy(state.bot);
      strategy.simulateMainPhaseAction(state, { type: "summon", index: 0, cardId: 203, position: "attack" });
      owner.hand.splice(0, 1); placeFieldCards(owner.field, source);
      const collected = await game.effectEngine.collectAfterSummonTriggers({ card: source, player: owner, method: "normal", fromZone: "hand" });
      const entry = required(collected.entries.find(trigger => trigger.effect.id === "void_beast_normal_summon_search"));
      await entry.config.activate(null, { ...entry.config.activationContext, confirmed: true });
      assert.deepEqual(state.bot.hand.map(card => card.id), owner.hand.map(card => card.id));
      assert.deepEqual(state.bot.hand.map(card => card.id), [candidateId]);
      const simulatedSource = required(state.bot.field.find(card => card.id === 203));
      const effect = required(simulatedSource.effects?.find(effect => effect.id === "void_beast_normal_summon_search"));
      assert.equal(canUseSimulatedEffectUsage(state, effect, simulatedSource, actor, true), false);
    });
  }

  test(`Void Beast does not search after its canonical shared use is exhausted (${actor})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
    t.after(() => game.dispose());
    game.turn = actor; game.phase = "main1"; game.turnCounter = 3;
    const owner = game[actor]; owner.controllerType = "ai";
    const source = new Card(cardDefinition(203), actor);
    const effect = required(source.effects.find(entry => entry.id === "void_beast_normal_summon_search"));
    owner.hand.push(source);
    owner.deck.push(new Card(cardDefinition(204), actor));
    game.markOncePerTurnUsed(source, owner, effect);
    const state = createGameTreeCopy(game, owner).state;
    new VoidStrategy(state.bot).simulateMainPhaseAction(state, { type: "summon", index: 0, cardId: 203, position: "attack" });
    owner.hand.splice(0, 1); placeFieldCards(owner.field, source);
    const collected = await game.effectEngine.collectAfterSummonTriggers({ card: source, player: owner, method: "normal", fromZone: "hand" });
    assert.ok(!collected.entries.some(entry => entry.effect.id === effect.id));
    assert.equal(state.bot.hand.length, owner.hand.length);
    assert.equal(state.bot.deck.length, owner.deck.length);
    assert.equal(canUseSimulatedEffectUsage(state, effect, required(state.bot.field[0]), actor, true), false);
  });

  test(`Void Hollow has no recruit capacity after Walker fills the last field space (${actor})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
    t.after(() => game.dispose());
    game.turn = actor; game.phase = "main1"; game.turnCounter = 3;
    const owner = game[actor];
    owner.controllerType = "ai";
    game.disablePresentationDelays = true;
    placeFieldCards(owner.field, ...[202, 201, 201, 201, 203].map(id => new Card(cardDefinition(id), actor)));
    owner.hand.push(new Card(cardDefinition(204), actor));
    owner.deck.push(new Card(cardDefinition(204), actor));
    const state = createGameTreeCopy(game, owner).state;
    const hollow = required(state.bot.hand[0]);
    const effect = required(hollow.effects?.find(entry => entry.id === "void_hollow_summon"));
    const walker = required(owner.field[0]);
    const runtimeHollow = required(owner.hand[0]);
    const runtimeEffect = required(runtimeHollow.effects.find(entry => entry.id === effect.id));
    const result = await game.tryActivateMonsterEffect(walker, null, "field", owner,
      { effectId: "void_walker_bounce_summon" });
    assert.equal(result.success, true);
    assert.equal(owner.field.length, 5);
    assert.ok(owner.field.includes(runtimeHollow));
    assert.equal(owner.deck.length, 1);
    assert.equal(game.effectEngine.checkOncePerTurn(runtimeHollow, owner, runtimeEffect).ok, true);
    new VoidStrategy(state.bot).simulateMainPhaseAction(state, { type: "monsterEffect", fieldIndex: 0,
      cardId: 202, effectId: "void_walker_bounce_summon" });
    assert.equal(state.bot.field.length, 5);
    assert.ok(state.bot.field.includes(hollow));
    assert.equal(state.bot.deck.length, 1);
    assert.equal(canUseSimulatedEffectUsage(state, effect, hollow, actor, true), true);
  });

  test(`Void generation offers Walker when its paid return frees a full field (${actor})`, t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
    t.after(() => game.dispose());
    game.turn = actor; game.phase = "main1"; game.turnCounter = 3;
    const owner = game[actor];
    const walker = new Card(cardDefinition(202), actor);
    placeFieldCards(owner.field, walker, ...[201, 201, 201, 203].map(id => new Card(cardDefinition(id), actor)));
    owner.hand.push(new Card(cardDefinition(204), actor));
    const preview = game.effectEngine.canActivateMonsterEffectPreview(walker, owner, "field", null,
      { effectId: "void_walker_bounce_summon" });
    assert.equal(preview.ok, true);
    const state = createGameTreeCopy(game, owner).state;
    assert.ok(new VoidStrategy(state.bot).generateMainPhaseActions(state).some(action =>
      action.type === "monsterEffect" && action.effectId === "void_walker_bounce_summon"));
  });

  for (const exhausted of [false, true]) {
    test(`Void Hollow recruit uses the canonical ledger and summon provenance (${actor}/${exhausted})`, t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
      t.after(() => game.dispose());
      game.turn = actor; game.phase = "main1"; game.turnCounter = 3;
      const owner = game[actor]; owner.controllerType = "ai";
      placeFieldCards(owner.field, new Card(cardDefinition(202), actor));
      owner.hand.push(new Card(cardDefinition(204), actor));
      owner.deck.push(new Card(cardDefinition(204), actor), new Card(cardDefinition(204), actor));
      const state = createGameTreeCopy(game, owner).state;
      const hollow = required(state.bot.hand[0]);
      const effect = required(hollow.effects?.find(effect => effect.id === "void_hollow_summon"));
      if (exhausted) markSimulatedEffectUsage(state, effect, hollow, actor, true);
      new VoidStrategy(state.bot).simulateMainPhaseAction(state, { type: "monsterEffect", fieldIndex: 0,
        cardId: 202, effectId: "void_walker_bounce_summon" });
      assert.equal(state.bot.field.filter(card => card.id === 204).length, exhausted ? 1 : 2);
      assert.equal(canUseSimulatedEffectUsage(state, effect, hollow, actor, true), false);
      if (!exhausted) assert.equal(required(state.bot.field.find(card => card !== hollow)).lastSummonedFromZone, "deck");
      assert.deepEqual(state._simUnsupportedActions ?? [], []);
    });
  }

  for (const permission of ["matching", "wrong", "exhausted"] as const) {
    test(`Void generation observes per-archetype Normal Summon allowance (${actor}/${permission})`, () => {
      const { state } = createArchitectureFixture("void", "starter", actor);
      state.bot.hand = [required(state.bot.hand.find(card => card.id === 201))];
      state.bot.summonCount = 1;
      state.bot.additionalNormalSummonPermissions = permission === "exhausted" ? [] : [{ count: 1,
        filters: { archetype: permission === "matching" ? "Void" : "Luminarch" } }];
      const legal = canUseNormalSummonForCard(state.bot, required(state.bot.hand[0]));
      assert.equal(legal, permission === "matching");
      assert.equal(new VoidStrategy(state.bot).generateMainPhaseActions(state).some(action => action.type === "summon"), legal);
    });
  }

  for (const exhausted of [false, true]) {
    test(`Void Raven pays one physical copy only when its shared use is available (${actor}/${exhausted})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
      t.after(() => game.dispose());
      game.turn = actor; game.phase = "main1"; game.turnCounter = 3;
      const owner = game[actor]; owner.controllerType = "ai";
      const raven = new Card(cardDefinition(210), actor);
      const second = new Card(cardDefinition(210), actor);
      const fusion = new Card(cardDefinition(207), actor);
      owner.hand.push(new Card(cardDefinition(12), actor), raven, second);
      owner.extraDeck.push(fusion);
      placeFieldCards(owner.field, ...[0, 1, 2].map(() => new Card(cardDefinition(204), actor)));
      const state = createGameTreeCopy(game, owner).state;
      const simulatedRaven = required(state.bot.hand.find(card => card.instanceId === raven.instanceId));
      const simulatedSecond = required(state.bot.hand.find(card => card.instanceId === second.instanceId));
      const effect = required(raven.effects.find(effect => effect.id === "void_raven_fusion_immunity"));
      if (exhausted) markSimulatedEffectUsage(state, effect, simulatedRaven, actor, true);
      new VoidStrategy(state.bot).simulateMainPhaseAction(state, { type: "spell", index: 0, cardId: 12 });
      const summoned = required(state.bot.field.find(card => card.id === 207));
      if (!exhausted) {
        owner.extraDeck.splice(0, 1); placeFieldCards(owner.field, fusion);
        const collected = await game.effectEngine.collectAfterSummonTriggers({ card: fusion, player: owner, method: "fusion", fromZone: "extraDeck" });
        const entry = required(collected.entries.find(trigger => trigger.card === raven));
        await game.runActivationPipeline(unsafeFixture<Parameters<typeof game.runActivationPipeline>[0]>(entry.config,
          "The concrete runtime collector binds Raven's physical source and mandatory self cost."));
        assert.equal(owner.graveyard.filter(card => card.id === 210).length, 1);
        assert.ok(owner.hand.includes(second));
        assert.equal(fusion.immuneToOpponentEffectsUntilTurn, 4);
        assert.equal(summoned.immuneToOpponentEffectsUntilTurn, fusion.immuneToOpponentEffectsUntilTurn);
      }
      assert.equal(state.bot.graveyard.filter(card => card.id === 210).length, exhausted ? 0 : 1);
      assert.equal(state.bot.hand.filter(card => card.id === 210).length, exhausted ? 2 : 1);
      assert.equal(state.bot.graveyard.includes(simulatedRaven), !exhausted);
      assert.ok(state.bot.hand.includes(simulatedSecond), "The second physical Raven remains in hand.");
      assert.equal(canUseSimulatedEffectUsage(state, effect, simulatedRaven, actor, true), false);
      if (exhausted) assert.ok(!summoned.immuneToOpponentEffectsUntilTurn);
    });
  }
}
