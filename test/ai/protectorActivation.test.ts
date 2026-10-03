import assert from "node:assert/strict";
import test from "node:test";
import { MainPhaseSession } from "../../src/core/bot/mainPhaseSession.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { placeFieldCards } from "../helpers/game.js";
import { createProtectorScenario, finishProtectorResponse, protectorEffect } from "../helpers/protector.js";

for (const seat of ["player", "bot"] as const) {
  for (const full of [false, true]) for (const respond of [false, true]) {
    test(`generated Protector offers a legal response before summoning (${seat}, full=${full}, respond=${respond})`, async t => {
      const { game, live, actor, opponent, initialize, generatedAction } = createProtectorScenario(seat, full);
      t.after(() => game.dispose()); await initialize();
      const source = required(actor.hand[0]), cost = required(actor.field[0]), target = required(actor.field[1]);
      const discard = required(opponent.hand[0]), leviathan = required(opponent.field[0]);
      const action = generatedAction();
      assert.equal(action.cardId, 157); assert.equal(actor.field[required(action.materialIndex)], cost);
      let offered = 0, activated = 0, costMoves = 0, summons = 0;
      game.on("effect_activated", event => { if (event.effectId === protectorEffect) activated++; });
      game.on("card_to_grave", event => { if (event.card === cost) costMoves++; });
      game.on("after_summon", event => { if (event.card === source) summons++; });
      game.ui.showChainResponseModal = async candidates => {
        const candidate = candidates.find(candidate => candidate.card === leviathan);
        if (!candidate || offered) return null;
        offered++;
        assert.ok(actor.hand.includes(source), "source stays in hand while its effect can be answered");
        assert.ok(actor.graveyard.includes(cost), "chosen cost is already paid when responding");
        const link = required(game.chainSystem.getLastChainLink());
        assert.equal(link.card, source); assert.equal(link.costPayment?.status, "paid");
        return respond ? candidate : null;
      };
      const session = new MainPhaseSession(actor, live, async () => {});
      const pending = session.execute(action, session.capture());
      await finishProtectorResponse(game, pending, discard, target);
      assert.equal(await pending, true);
      assert.equal(offered, 1, "generated action must offer the public effect's legal response");
      assert.equal(activated, 1); assert.equal(costMoves, 1); assert.equal(summons, 1);
      assert.equal(actor.field.filter(card => card === source).length, 1);
      assert.equal(actor.graveyard.filter(card => card === cost).length, 1);
      assert.equal(actor.field.length, full ? 5 : 2); assert.equal(source.position, "defense");
      assert.equal(target.isFacedown, respond); assert.equal(opponent.graveyard.includes(discard), respond);
      assert.equal(session.counts.executions, 1); assert.equal(session.counts.accepted, 1);
    });
  }

  test(`Protector pays the generated physical cost once when another copy is available (${seat})`, async t => {
    const { game, live, actor, initialize, generatedAction } = createProtectorScenario(seat);
    t.after(() => game.dispose()); await initialize();
    const chosen = required(actor.field[0]), other = required(actor.deck.find(card => card.id === 153));
    actor.deck.splice(actor.deck.indexOf(other), 1); placeFieldCards(actor.field, other);
    const action = generatedAction();
    assert.equal(actor.field[required(action.materialIndex)], chosen);
    game.ui.showChainResponseModal = async () => null;
    const session = new MainPhaseSession(actor, live, async () => {});
    assert.equal(await session.execute(action, session.capture()), true);
    assert.deepEqual(actor.graveyard, [chosen]); assert.ok(actor.field.includes(other));
  });

  for (const invalid of ["missing", "facedown", "effects-disabled"] as const) {
    test(`Protector rejects an unavailable activation without payment (${seat}, ${invalid})`, async t => {
      const { game, live, actor, initialize, generatedAction } = createProtectorScenario(seat);
      t.after(() => game.dispose()); await initialize();
      const source = required(actor.hand[0]), cost = required(actor.field[0]);
      const action = generatedAction();
      if (invalid === "missing") await game.moveCard(cost, actor, "hand", { fromZone: "field", awaitEvents: true });
      if (invalid === "facedown") cost.isFacedown = true;
      if (invalid === "effects-disabled") game.disableEffectActivation = true;
      const session = new MainPhaseSession(actor, live, async () => {});
      assert.equal(await session.execute(action, session.capture()), false);
      assert.ok(actor.hand.includes(source)); assert.equal(actor.graveyard.length, 0);
      assert.equal(game.chainSystem.getLastChainLink(), null);
    });
  }

  test(`Protector invalidates a stale session before a replacement cost copy can be used (${seat})`, async t => {
    const { game, live, actor, initialize, generatedAction } = createProtectorScenario(seat);
    t.after(() => game.dispose()); await initialize();
    const source = required(actor.hand[0]), cost = required(actor.field[0]);
    const other = required(actor.deck.find(card => card.id === 153));
    actor.deck.splice(actor.deck.indexOf(other), 1); placeFieldCards(actor.field, other);
    const action = generatedAction(), session = new MainPhaseSession(actor, live, async () => {});
    const before = session.capture();
    await game.moveCard(cost, actor, "graveyard", { fromZone: "field", awaitEvents: true });
    assert.equal(await session.execute(action, before), false);
    assert.equal(session.counts.executions, 0); assert.ok(actor.hand.includes(source));
    assert.ok(actor.field.includes(other)); assert.deepEqual(actor.graveyard, [cost]);
  });

  for (const interruption of ["negated", "filled-zone", "source-left"] as const) {
    test(`Protector keeps its cost after an accepted activation cannot summon (${seat}, ${interruption})`, async t => {
      const { game, live, actor, initialize, generatedAction } = createProtectorScenario(seat, true);
      t.after(() => game.dispose()); await initialize();
      const source = required(actor.hand[0]), cost = required(actor.field[0]);
      let offers = 0;
      game.chainSystem.offerChainResponses = async () => {
        const link = required(game.chainSystem.getLastChainLink());
        assert.equal(link.card, source); assert.ok(actor.hand.includes(source));
        assert.ok(actor.graveyard.includes(cost)); offers++;
        if (interruption === "negated") link.effectNegated = true;
        else if (interruption === "filled-zone") {
          const replacement = required(actor.deck.find(card => card.id === 153));
          actor.deck.splice(actor.deck.indexOf(replacement), 1);
          placeFieldCards(actor.field, replacement);
        } else {
          await game.moveCard(source, actor, "graveyard", { fromZone: "hand", awaitEvents: true });
        }
        return { offers: 1, activations: 0, lastActivator: null, chainBuilt: false, consecutivePasses: 2 };
      };
      const session = new MainPhaseSession(actor, live, async () => {});
      assert.equal(await session.execute(generatedAction(), session.capture()), false,
        "the executor preserves the public activation's unsuccessful resolution result");
      assert.equal(offers, 1); assert.equal(actor.hand.includes(source), interruption !== "source-left");
      assert.deepEqual(actor.graveyard, interruption === "source-left" ? [cost, source] : [cost]);
      assert.equal(actor.field.length, interruption === "filled-zone" ? 5 : 4);
      assert.equal(game.chainSystem.getLastChainLink(), null); assert.equal(game.targetSelection, null);
    });
  }

  test(`Protector preserves the generated defense position without an opposing threat (${seat})`, async t => {
    const { game, live, actor, opponent, initialize, generatedAction } = createProtectorScenario(seat);
    t.after(() => game.dispose()); await initialize();
    await game.moveCard(required(opponent.field[0]), opponent, "graveyard", { fromZone: "field", awaitEvents: true });
    const action = generatedAction(), source = required(actor.hand[0]);
    assert.equal(action.position, "defense");
    game.ui.showChainResponseModal = async () => null;
    const session = new MainPhaseSession(actor, live, async () => {});
    assert.equal(await session.execute(action, session.capture()), true);
    assert.equal(source.position, action.position);
  });

  test(`a forced summon position takes precedence over an AI preference (${seat})`, async t => {
    const { game, actor, initialize } = createProtectorScenario(seat);
    t.after(() => game.dispose()); await initialize();
    const source = required(actor.hand[0]);
    const owner = unsafeFixture<Parameters<typeof game.effectEngine.chooseSpecialSummonPosition>[1]>(actor,
      "The concrete Bot uses the actual Game context; the forced branch never calls its wider strategy contract.");
    const position = await game.effectEngine.chooseSpecialSummonPosition(source, owner,
      { position: "attack", preferredPosition: "defense" });
    assert.equal(position, "attack");
  });

  test(`a summon position preference preserves manual human choice (${seat})`, async t => {
    const { game, actor, initialize } = createProtectorScenario(seat);
    t.after(() => game.dispose()); await initialize(); actor.controllerType = "human";
    let prompts = 0;
    game.ui.showSpecialSummonPositionModal = (_card, choose) => { prompts++; choose("attack"); };
    const owner = unsafeFixture<Parameters<typeof game.effectEngine.chooseSpecialSummonPosition>[1]>(actor,
      "This concrete Player has a human controller, so the position resolver does not invoke its strategy.");
    const position = await game.effectEngine.chooseSpecialSummonPosition(required(actor.hand[0]), owner,
      { position: "choice", preferredPosition: "defense" });
    assert.equal(position, "attack"); assert.equal(prompts, 1);
  });
}
