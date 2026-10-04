import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { EffectDefinition } from "../src/core/contracts/effects.js";
import type { ActiveSelectionSession } from "../src/core/contracts/selection.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { createTestCandidate } from "./chain/helpers/chainHarness.js";

const cost = {
  type: "remove_counters_from_field" as const, counterType: "spore",
  targetRef: "spore_cost", amount: 3, owner: "any" as const,
  zones: ["field", "spellTrap", "fieldSpell"] as const,
  requireFaceup: true, haltOnFailure: true,
};
const effect: EffectDefinition = {
  id: "pooled_spore_cost", timing: "ignition", activationZones: ["spellTrap"], activationCosts: [cost],
  targets: [{ id: "spore_cost", intent: "cost", owner: "any", allowSelf: true,
    zones: ["field", "spellTrap", "fieldSpell"], requireFaceup: true,
    filters: { counterType: "spore", minCounters: 1 }, count: { min: 1, max: 3 } }],
  actions: [{ type: "heal", amount: 500, player: "self" }],
};

function setup(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.player.controllerType = game.bot.controllerType = "ai";
  game.turn = "player"; game.phase = "main1"; game.turnCounter = 3;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  const source = new Card({ ...cardDefinition(412), effects: [effect] }, "player");
  const first = new Card({ ...cardDefinition(1), effects: [] }, "player");
  const second = new Card({ ...cardDefinition(1), effects: [] }, "bot");
  const third = new Card({ ...cardDefinition(413), effects: [] }, "bot");
  placeFieldCards(game.player.spellTrap, source);
  placeFieldCards(game.player.field, first); placeFieldCards(game.bot.field, second);
  placeFieldCards(game.bot.spellTrap, third);
  for (const card of [first, second, third]) card.addCounter("spore", 1);
  const ctx = { source, player: game.player, opponent: game.bot, effect,
    activationContext: { payingActivationCosts: true } };
  return { game, source, first, second, third, ctx };
}

test("pooled counter preview rejects a selected subset despite an affordable global pool", t => {
  const { game, first, ctx } = setup(t);
  assert.equal(game.effectEngine.checkActionPreviewRequirements([cost], ctx).ok, true);
  assert.equal(game.effectEngine.checkActionPreviewRequirements([cost], {
    ...ctx, _actionTargets: { spore_cost: [first] },
  }).ok, false);
});

test("prepared pooled cost pays only the ordered chosen sources", async t => {
  const { game, first, second, third, ctx } = setup(t);
  const reserve = new Card({ ...cardDefinition(1), effects: [] }, "player");
  reserve.addCounter("spore", 10); placeFieldCards(game.player.field, reserve);
  const events: number[] = [];
  game.on("counter_removed", payload => { events.push(payload.amount); });
  const result = await game.effectEngine.applyActions([cost], ctx,
    { spore_cost: [third, second, first] });
  assert.equal(result.success, true);
  assert.deepEqual([first, second, third, reserve].map(card => card.getCounter("spore")), [0, 0, 0, 10]);
  assert.deepEqual(events, [3]);
});

test("prepared pooled cost rejects duplicate sources without mutating counters", async t => {
  const { game, first, ctx } = setup(t);
  first.addCounter("spore", 4);
  assert.equal(game.effectEngine.checkActionPreviewRequirements([cost], {
    ...ctx, _actionTargets: { spore_cost: [first, first] },
  }).ok, false);
  const result = await game.effectEngine.applyActions([cost], ctx,
    { spore_cost: [first, first] });
  assert.equal(result.success, false);
  assert.equal(first.getCounter("spore"), 5);
});

test("a partial pooled cost records the paid amount after a source leaves and returns", async t => {
  const { game, first, second, third, ctx } = setup(t);
  let waited = false;
  game.waitForPresentationDelay = async () => {
    if (!waited) { waited = true;
      await game.moveCard(second, game.bot, "hand", { fromZone: "field" });
      await game.moveCard(second, game.bot, "field", { fromZone: "hand", summonOrigin: "effect_resolution", position: "attack" });
      assert.ok(game.bot.field.includes(second));
    }
  };
  const events: number[] = [];
  game.on("counter_removed", payload => { events.push(payload.amount); });
  const result = await game.effectEngine.applyActions([cost], ctx,
    { spore_cost: [first, second, third] });
  assert.equal(result.success, false);
  assert.equal(first.getCounter("spore"), 0);
  assert.equal(third.getCounter("spore"), 1);
  assert.deepEqual(events, [1]);
});

test("a partial pooled cost stops when its remaining selected balance becomes insufficient", async t => {
  const { game, first, second, third, ctx } = setup(t);
  let waited = false;
  game.waitForPresentationDelay = async () => {
    if (!waited) { waited = true; second.removeCounter("spore", 1); }
  };
  const events: number[] = [];
  game.on("counter_removed", payload => { events.push(payload.amount); });
  const result = await game.effectEngine.applyActions([cost], ctx,
    { spore_cost: [first, second, third] });
  assert.equal(result.success, false);
  assert.deepEqual([first, second, third].map(card => card.getCounter("spore")), [0, 0, 1]);
  assert.deepEqual(events, [1]);
});

test("opponent effect immunity does not prevent paying a selected pooled cost", async t => {
  const { game, first, second, third, ctx } = setup(t);
  second.unaffectedByOtherCardEffects = true;
  third.unaffectedByOtherCardEffects = true;
  assert.equal((await game.effectEngine.applyActions([cost], ctx,
    { spore_cost: [first, second, third] })).success, true);
  assert.deepEqual([first, second, third].map(card => card.getCounter("spore")), [0, 0, 0]);
});

test("AI selects enough distinct sources before the activation Chain", async t => {
  const { game, source, first, second, third } = setup(t);
  let observed = false;
  game.chainSystem.offerChainResponses = async () => {
    const link = game.chainSystem.chainStack.find(entry => entry.card === source);
    if (link) { observed = true;
      assert.deepEqual([first, second, third].map(card => card.getCounter("spore")), [0, 0, 0]);
      assert.equal(link.costPayment?.status, "paid");
    }
    return { responseFound: false, aborted: false, offers: 1, activations: 0,
      consecutivePasses: 2, lastActivator: null, chainBuilt: false };
  };
  const result = await game.tryActivateSpellTrapEffect(source, null, { owner: game.player });
  assert.equal(result.success, true, result.reason || result.code);
  assert.equal(observed, true);
  assert.equal(game.player.lp, 8500);
});

async function driveCostSelection(game: ReturnType<typeof createRuntimeGame>, pending: Promise<unknown>,
  choose: (session: ActiveSelectionSession) => Promise<void>) {
  let completed = false;
  const completion = pending.finally(() => { completed = true; });
  for (let attempt = 0; attempt < 1500 && !completed; attempt++) {
    if (game.targetSelection) await choose(game.targetSelection);
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.equal(completed, true, "explicit cost decision must complete the activation");
  await completion;
}

test("human pooled cost cancellation changes no counters or usage", async t => {
  const { game, source, first, second, third } = setup(t);
  game.player.controllerType = "human";
  game.autoSelector.select = () => assert.fail("human costs cannot consult AutoSelector");
  const pending = game.tryActivateSpellTrapEffect(source, null, { owner: game.player });
  await driveCostSelection(game, pending, async session => {
    assert.equal(session.kind, "cost"); game.cancelTargetSelection();
  });
  assert.equal((await pending).success, false);
  assert.deepEqual([first, second, third].map(card => card.getCounter("spore")), [1, 1, 1]);
  assert.equal(game.player.lp, 8000);
});

for (const moved of ["payment", "source"] as const) {
  test(`human pooled cost rejects ${moved} leaving and returning during the prompt`, async t => {
    const { game, source, first, second, third } = setup(t);
    game.player.controllerType = "human";
    game.autoSelector.select = () => assert.fail("human costs cannot consult AutoSelector");
    const pending = game.tryActivateSpellTrapEffect(source, null, { owner: game.player });
    await driveCostSelection(game, pending, async session => {
      assert.equal(session.kind, "cost");
      const card = moved === "payment" ? second : source;
      const owner = moved === "payment" ? game.bot : game.player;
      const zone = moved === "payment" ? "field" : "spellTrap";
      await game.moveCard(card, owner, "hand", { fromZone: zone });
      if (moved === "payment") {
        await game.moveCard(card, owner, "field", { fromZone: "hand", summonOrigin: "effect_resolution", position: "attack" });
        assert.ok(owner.field.includes(card));
      } else {
        await game.moveCard(card, owner, "spellTrap", { fromZone: "hand" });
        assert.ok(owner.spellTrap.includes(card));
      }
      card.isFacedown = false;
      if (moved === "payment" && card.getCounter("spore") === 0) card.addCounter("spore", 1);
      const requirement = required(session.requirements.find(entry => entry.id === "spore_cost"));
      session.selections.spore_cost = requirement.candidates.map(candidate => candidate.key);
      await game.finishTargetSelection();
    });
    const result = await pending;
    assert.equal(result.success, false);
    if (moved === "payment") assert.equal(result.code, "ACTIVATION_COST_SELECTION_CANCELLED");
    assert.deepEqual([first, second, third].map(card => card.getCounter("spore")), [1, 1, 1]);
    assert.equal(game.player.lp, 8000);
  });
}

test("exact AI counter sources cannot be replaced to afford the payment", async t => {
  const { game, source, first, second, third } = setup(t);
  const result = await game.tryActivateSpellTrapEffect(source, null, { owner: game.player,
    activationContext: { decisions: { selections: { spore_cost: [first.instanceId] } } } });
  assert.equal(result.success, false);
  assert.deepEqual([first, second, third].map(card => card.getCounter("spore")), [1, 1, 1]);
});

test("a single affordable source cannot substitute an invalid exact AI cost plan", async t => {
  const { game, source, first, second, third } = setup(t);
  first.addCounter("spore", 2); second.removeCounter("spore", 1); third.removeCounter("spore", 1);
  const result = await game.tryActivateSpellTrapEffect(source, null, { owner: game.player,
    activationContext: { decisions: { selections: { spore_cost: [second.instanceId] } } } });
  assert.equal(result.success, false);
  assert.equal(first.getCounter("spore"), 3);
});

test("duplicate provided cost references are rejected before commitment", async t => {
  const { game, source, first } = setup(t);
  first.addCounter("spore", 2);
  const result = await game.tryActivateSpellTrapEffect(source, { spore_cost: [first, first] }, { owner: game.player });
  assert.equal(result.success, false);
  assert.equal(first.getCounter("spore"), 3);
  assert.equal(game.player.lp, 8000);
});

test("human pooled cost selects the sources before the first response", async t => {
  const { game, source, first, second, third } = setup(t);
  game.player.controllerType = "human";
  game.autoSelector.select = () => assert.fail("human costs cannot consult AutoSelector");
  let responses = 0;
  game.chainSystem.offerChainResponses = async () => {
    if (game.chainSystem.chainStack.some(link => link.card === source)) {
      responses++;
      assert.deepEqual([first, second, third].map(card => card.getCounter("spore")), [0, 0, 0]);
    }
    return { responseFound: false, aborted: false, offers: 1, activations: 0,
      consecutivePasses: 2, lastActivator: null, chainBuilt: false };
  };
  const pending = game.tryActivateSpellTrapEffect(source, null, { owner: game.player });
  await driveCostSelection(game, pending, async session => {
    assert.equal(session.kind, "cost");
    const requirement = required(session.requirements.find(entry => entry.id === "spore_cost"));
    session.selections.spore_cost = [third, second, first].map(card => required(
      requirement.candidates.find(candidate => candidate.cardRef === card)).key);
    await game.finishTargetSelection();
  });
  assert.equal((await pending).success, true);
  assert.ok(responses > 0);
  assert.equal(game.player.lp, 8500);
});

test("cost-reference immunity bypass applies only during payment", async t => {
  const { game, first, second, third, ctx } = setup(t);
  second.unaffectedByOtherCardEffects = true;
  const result = await game.effectEngine.applyActions([cost], {
    ...ctx, activationContext: { payingActivationCosts: false },
  }, { spore_cost: [first, second, third] });
  assert.equal(result.success, false);
  assert.deepEqual([first, second, third].map(card => card.getCounter("spore")), [1, 1, 1]);
});

test("Chain response preparation keeps pooled cost metadata for AI distributed sources", async t => {
  const { game, source, first, second, third } = setup(t);
  const quickEffect: EffectDefinition = { ...effect, speed: 2, isQuickEffect: true };
  source.effects = [quickEffect];
  const response = await game.chainSystem.prepareChainResponse(createTestCandidate(game.chainSystem, game.player, {
    card: source, effect: quickEffect, sourceZone: "spellTrap", context: { type: "effect_activation" },
  }), game.player, {});
  assert.equal(response.success, true, response.reason || undefined);
  assert.deepEqual([first, second, third].map(card => card.getCounter("spore")), [0, 0, 0]);
});

test("a source turned face-down during the human cost prompt cannot pay before commitment", async t => {
  const { game, source, first, second, third } = setup(t);
  source.effects = [{ ...effect, requireFaceup: true }];
  game.player.controllerType = "human";
  const pending = game.tryActivateSpellTrapEffect(source, null, { owner: game.player });
  await driveCostSelection(game, pending, async session => {
    source.isFacedown = true;
    const requirement = required(session.requirements.find(entry => entry.id === "spore_cost"));
    session.selections.spore_cost = requirement.candidates.map(candidate => candidate.key);
    await game.finishTargetSelection();
  });
  assert.equal((await pending).success, false);
  assert.deepEqual([first, second, third].map(card => card.getCounter("spore")), [1, 1, 1]);
  assert.equal(game.player.lp, 8000);
});

test("a Chain response source turned face-down during the human cost prompt cannot commit", async t => {
  const { game, source, first, second, third } = setup(t);
  const quickEffect: EffectDefinition = { ...effect, speed: 2, isQuickEffect: true, requireFaceup: true };
  source.effects = [quickEffect];
  game.player.controllerType = "human";
  const pending = Promise.resolve(game.chainSystem.prepareChainResponse(createTestCandidate(game.chainSystem, game.player, {
    card: source, effect: quickEffect, sourceZone: "spellTrap", context: { type: "effect_activation" },
  }), game.player, {}));
  await driveCostSelection(game, pending, async session => {
    source.isFacedown = true;
    const requirement = required(session.requirements.find(entry => entry.id === "spore_cost"));
    session.selections.spore_cost = requirement.candidates.map(candidate => candidate.key);
    await game.finishTargetSelection();
  });
  assert.equal((await pending).success, false);
  assert.deepEqual([first, second, third].map(card => card.getCounter("spore")), [1, 1, 1]);
});
