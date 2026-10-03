import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { createPlanningCopy } from "../src/core/ai/common/planningCopy.js";
import { replaceSimulatedBattleDestruction } from "../src/core/ai/common/simulatedActions/destruction.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { canUseSimulatedEffectUsage } from "../src/core/ai/common/simStateUtils.js";
import { createCanonicalStateSnapshot } from "../src/core/game/replay/canonical.js";
import { cardDefinition, required, unsafeFixture } from "./helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { simulationState } from "./helpers/simulation.js";

const mirrorId = "miragebound_mirror_path_battle_return";

function setup(t: TestContext, seat: "player" | "bot" = "player", controller: "human" | "ai" = "human") {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, disableChains: true });
  t.after(() => game.dispose());
  game.disablePresentationDelays = true;
  game.turnCounter = 4; game.phase = "battle";
  game.player.controllerType = game.bot.controllerType = "ai";
  const owner = game[seat]; owner.controllerType = controller;
  const opponent = seat === "player" ? game.bot : game.player;
  const make = (id: number, player = owner) => {
    const card = new Card(cardDefinition(id), player.id);
    card.isFacedown = false; card.position = "attack";
    return card;
  };
  const mirror = make(359), target = make(351);
  placeFieldCards(owner.spellTrap, mirror); placeFieldCards(owner.field, target);
  game.ui.showConfirmPrompt = async () => true;
  return { game, owner, opponent, make, mirror, target };
}

for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) {
    for (const id of [351, 363]) {
      test(`battle replacement moves ${id} without destruction in ${seat}/${controller}`, async t => {
        const { game, owner, make, mirror, target } = setup(t, seat, controller);
        const protectedCard = id === 351 ? target : make(id);
        if (id !== 351) { owner.field.length = 0; placeFieldCards(owner.field, protectedCard); owner.spellTrap.length = 0; }
        const events: string[] = [];
        let confirmations = 0;
        game.ui.showConfirmPrompt = async () => { confirmations++; return true; };
        game.on("card_moved", event => {
          if (event.card === protectedCard) { assert.notEqual(event.wasDestroyed, true); events.push(event.toZone); }
        });
        const result = await game.destroyCard(protectedCard, { cause: "battle" });
        assert.ok("destroyed" in result && result.destroyed === false);
        assert.ok(id === 351 ? owner.hand.includes(protectedCard) : owner.extraDeck.includes(protectedCard));
        assert.deepEqual(events, [id === 351 ? "hand" : "extraDeck"]);
        assert.equal(confirmations, controller === "human" ? 1 : 0);
        if (id === 351) assert.equal(game.canUseOncePerTurn(mirror, owner, required(mirror.effects.find(effect => effect.id === mirrorId))).ok, false);
      });
    }
  }
}

for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) {
    test(`Mirror refusal consumes its first opportunity in ${seat}/${controller}`, async t => {
      const { game, owner, make, mirror, target } = setup(t, seat, controller);
      const second = make(351); placeFieldCards(owner.field, second);
      let confirmations = 0, policies = 0;
      game.ui.showConfirmPrompt = async () => { confirmations++; return false; };
      owner.strategy = unsafeFixture<NonNullable<typeof owner.strategy>>({
        shouldUseReplacementEffect: async () => { policies++; return false; },
      }, "Partial strategy exposes only the destruction replacement policy exercised by this fixture.");
      await game.destroyCard(target, { cause: "battle" });
      await game.destroyCard(second, { cause: "battle" });
      assert.equal(confirmations, controller === "human" ? 1 : 0);
      assert.equal(policies, controller === "ai" ? 1 : 0);
      assert.ok(owner.graveyard.includes(target)); assert.ok(owner.graveyard.includes(second));
      assert.equal(game.canUseOncePerTurn(mirror, owner, required(mirror.effects.find(effect => effect.id === mirrorId))).ok, false);
    });
  }
}

for (const invalid of ["negated", "facedown", "wrong zone"] as const) {
  test(`an initially ${invalid} Mirror does not consume an opportunity`, async t => {
    const { game, owner, make, mirror, target } = setup(t);
    const second = make(351); placeFieldCards(owner.field, second);
    if (invalid === "negated") mirror.effectsNegated = true;
    if (invalid === "facedown") mirror.isFacedown = true;
    if (invalid === "wrong zone") await game.moveCard(mirror, owner, "hand", { fromZone: "spellTrap", awaitEvents: true });
    await game.destroyCard(target, { cause: "battle" });
    assert.equal(game.canUseOncePerTurn(mirror, owner, required(mirror.effects.find(effect => effect.id === mirrorId))).ok, true);
    mirror.effectsNegated = false; mirror.isFacedown = false;
    if (invalid === "wrong zone") await game.moveCard(mirror, owner, "spellTrap", { fromZone: "hand", isFacedown: false, awaitEvents: true });
    await game.destroyCard(second, { cause: "battle" });
    assert.ok(owner.hand.includes(second));
  });
}

for (const when of ["before", "during"] as const) {
  test(`a negated Mirror Path cannot replace destruction (${when} confirmation)`, async t => {
    const { game, owner, mirror, target } = setup(t);
    let confirmations = 0;
    if (when === "before") mirror.effectsNegated = true;
    game.ui.showConfirmPrompt = async () => { confirmations++; mirror.effectsNegated = true; return true; };
    const result = await game.destroyCard(target, { cause: "battle" });
    assert.ok("destroyed" in result && result.destroyed === true);
    assert.ok(owner.graveyard.includes(target));
    assert.equal(confirmations, when === "before" ? 0 : 1);
  });
}

test("Mirror Path decline consumes the first matching occurrence but ignores effect destruction", async t => {
  const { game, owner, make, mirror, target } = setup(t);
  const second = make(351), unrelated = make(351);
  placeFieldCards(owner.field, second, unrelated);
  let confirmations = 0;
  game.ui.showConfirmPrompt = async () => { confirmations++; return false; };
  await game.destroyCard(unrelated, { cause: "effect" });
  assert.equal(confirmations, 0);
  await game.destroyCard(target, { cause: "battle" });
  game.ui.showConfirmPrompt = async () => { confirmations++; return true; };
  await game.destroyCard(second, { cause: "battle" });
  assert.equal(confirmations, 1);
  assert.ok(owner.graveyard.includes(second));
  assert.equal(game.canUseOncePerTurn(mirror, owner, required(mirror.effects.find(effect => effect.id === mirrorId))).ok, false);
});

test("an earlier temporary replacement still consumes Mirror Path's matching first occurrence", async t => {
  const { game, owner, make, mirror, target } = setup(t);
  const second = make(351); placeFieldCards(owner.field, second);
  await game.effectEngine.applyActions([{
    type: "register_replacement_effect", targetRef: "target", uses: 1,
    replacementEffect: { type: "destruction", reason: "battle", auto: true, targetOwner: "self", targetZones: ["field"] },
  }], { player: owner, opponent: owner === game.player ? game.bot : game.player, source: mirror }, { target: [target] });
  let confirmations = 0;
  game.ui.showConfirmPrompt = async () => { confirmations++; return true; };
  await game.destroyCard(target, { cause: "battle" });
  assert.ok(owner.field.includes(target));
  await game.destroyCard(second, { cause: "battle" });
  assert.ok(owner.graveyard.includes(second));
  assert.equal(confirmations, 0);
});

test("all initially eligible sources retain an occurrence token for their shared named limit", async t => {
  const { game, owner, make, mirror, target } = setup(t);
  owner.spellTrap.length = 0;
  const first = make(159), second = make(151);
  const effect = required(mirror.effects.find(candidate => candidate.id === mirrorId));
  first.effects = [effect]; second.effects = [effect];
  placeFieldCards(owner.field, first, second);
  let confirmations = 0;
  game.ui.showConfirmPrompt = async () => { confirmations++; if (confirmations === 1) first.effectsNegated = true; return true; };
  await game.destroyCard(target, { cause: "battle" });
  assert.equal(confirmations, 2); assert.ok(owner.hand.includes(target));
  assert.equal(game.canUseOncePerTurn(second, owner, effect).ok, false);
});

test("Mirror Path's failed cost preview consumes the first opportunity", async t => {
  const { game, owner, make, target } = setup(t);
  const second = make(351); placeFieldCards(owner.field, second);
  const preview = game.effectEngine.checkActionPreviewRequirements;
  game.effectEngine.checkActionPreviewRequirements = () => ({ ok: false, reason: "test failed movement preview" });
  await game.destroyCard(target, { cause: "battle" });
  game.effectEngine.checkActionPreviewRequirements = preview;
  await game.destroyCard(second, { cause: "battle" });
  assert.ok(owner.graveyard.includes(target)); assert.ok(owner.graveyard.includes(second));
});

for (const changed of ["source", "target"] as const) {
  test(`leave-return of the ${changed} during confirmation invalidates that pending presence`, async t => {
    const { game, owner, mirror, target } = setup(t);
    const moved = changed === "source" ? mirror : target;
    const zone = changed === "source" ? "spellTrap" : "field";
    game.ui.showConfirmPrompt = async () => {
      const departure = await game.moveCard(moved, owner, "hand", { fromZone: zone, awaitEvents: true });
      assert.equal(departure.success, true, JSON.stringify(departure));
      if (zone === "field") {
        await game.effectEngine.applyActions([{ type: "special_summon_from_zone", zone: "hand", targetRef: "target", position: "attack" }],
          { source: mirror, player: owner, opponent: owner === game.player ? game.bot : game.player }, { target: [moved] });
        assert.ok(owner.field.includes(moved));
      } else {
        const returned = await game.moveCard(moved, owner, zone, { fromZone: "hand", isFacedown: false, awaitEvents: true });
        assert.equal(returned.success, true, JSON.stringify(returned));
      }
      return true;
    };
    const result = await game.destroyCard(target, { cause: "battle" });
    assert.ok("destroyed" in result, JSON.stringify(result));
    if (changed === "target") {
      assert.equal(result.destroyed, false); assert.ok(owner.field.includes(target));
    } else {
      assert.equal(result.destroyed, true, JSON.stringify(result)); assert.ok(owner.graveyard.includes(target));
    }
  });
}

test("real replacement source is revalidated after manual cost selection before payment", async t => {
  const { game, owner, make, target } = setup(t);
  owner.spellTrap.length = 0;
  const source = make(159), cost = make(151);
  source.effects = [{ id: "presence_cost_control", timing: "passive", requireZone: "field", replacementEffect: {
    type: "destruction", targetOwner: "self", targetZones: ["field"], costCount: 1,
    costZone: "field", costFilters: { name: cost.name },
  } }];
  placeFieldCards(owner.field, source, cost);
  const finish = game.finishTargetSelection.bind(game);
  game.finishTargetSelection = async () => { source.effectsNegated = true; return finish(); };
  const result = game.destroyCard(target, { cause: "battle" });
  await completeTestSelections(game, result);
  assert.ok(owner.graveyard.includes(target)); assert.ok(owner.field.includes(cost));
});

for (const change of ["source facedown", "source control", "target control"] as const) {
  test(`replacement eligibility changes during confirmation: ${change}`, async t => {
    const { game, owner, opponent, make, mirror, target } = setup(t);
    owner.spellTrap.length = 0;
    const source = make(159);
    source.effects = [required(mirror.effects.find(effect => effect.id === mirrorId))];
    placeFieldCards(owner.field, source);
    game.ui.showConfirmPrompt = async () => {
      if (change === "source facedown") source.isFacedown = true;
      else assert.equal((await game.takeControl(change === "source control" ? source : target, opponent)).success, true);
      return true;
    };
    const result = await game.destroyCard(target, { cause: "battle" });
    assert.ok("destroyed" in result, JSON.stringify(result));
    if (change === "target control") {
      assert.equal(result.destroyed, false); assert.ok(opponent.field.includes(target));
    } else {
      assert.equal(result.destroyed, true); assert.ok(owner.graveyard.includes(target));
    }
  });
}

test("a selected replacement cost cannot leave and return before payment", async t => {
  const { game, owner, make, target } = setup(t);
  owner.spellTrap.length = 0;
  const source = make(159), cost = make(151);
  source.effects = [{ id: "cost_presence_control", timing: "passive", requireZone: "field", replacementEffect: {
    type: "destruction", targetOwner: "self", targetZones: ["field"], costCount: 1,
    costZone: "field", costFilters: { name: cost.name },
  } }];
  placeFieldCards(owner.field, source, cost);
  const finish = game.finishTargetSelection.bind(game);
  game.finishTargetSelection = async () => {
    await game.moveCard(cost, owner, "hand", { fromZone: "field", awaitEvents: true });
    await game.effectEngine.applyActions([{ type: "special_summon_from_zone", zone: "hand", targetRef: "cost", position: "attack" }],
      { source, player: owner, opponent: game.bot }, { cost: [cost] });
    return finish();
  };
  const result = game.destroyCard(target, { cause: "battle" });
  await completeTestSelections(game, result);
  assert.ok(owner.graveyard.includes(target)); assert.ok(owner.field.includes(cost));
});

test("temporary replacements remain independent of their original departed, negated source", async t => {
  const { game, owner, mirror, target } = setup(t);
  await game.effectEngine.applyActions([{
    type: "register_replacement_effect", targetRef: "target", uses: 1,
    replacementEffect: { type: "destruction", auto: true, targetOwner: "self", targetZones: ["field"] },
  }], { player: owner, opponent: owner === game.player ? game.bot : game.player, source: mirror }, { target: [target] });
  await game.moveCard(mirror, owner, "graveyard", { fromZone: "spellTrap", awaitEvents: true });
  mirror.effectsNegated = true;
  await game.destroyCard(target, { cause: "battle" });
  assert.ok(owner.field.includes(target));
});

test("Mirror Path returns a controlled Extra Deck monster to its original owner's Extra Deck", async t => {
  const { game, owner, opponent, make } = setup(t);
  owner.field.length = 0;
  const target = make(363, opponent); placeFieldCards(opponent.field, target);
  assert.equal((await game.takeControl(target, owner)).success, true);
  await game.destroyCard(target, { cause: "battle" });
  assert.ok(opponent.extraDeck.includes(target)); assert.equal(target.owner, opponent.id);
  assert.equal(owner.extraDeck.includes(target), false);
});

const simulated = (id: number, owner: "bot" | "player" = "bot") => createPlanningCopy().cloneCardForSim(new Card(cardDefinition(id), owner));
for (const seat of ["bot", "player"] as const) {
  for (const id of [351, 363]) {
    test(`simulation moves battle replacement ${id} in ${seat}`, () => {
      const mirror = simulated(359, seat), target = simulated(id, seat);
      const state = simulationState({ turnCounter: 4, [seat]: { field: [target], spellTrap: id === 351 ? [mirror] : [] } });
      assert.ok(replaceSimulatedBattleDestruction(state, target));
      assert.ok(id === 351 ? state[seat].hand.includes(target) : state[seat].extraDeck.includes(target));
      assert.equal(state[seat].graveyard.length, 0);
    });
  }
}

test("simulation consumes Mirror first occurrence even when a temporary replacement wins", () => {
  const mirror = simulated(359), target = simulated(351), second = simulated(351);
  const state = simulationState({ turnCounter: 4, bot: { field: [target, second], spellTrap: [mirror] } });
  applySimulatedActions({ state, selections: { target: [target] }, options: { sourceCard: mirror }, actions: [{
    type: "register_replacement_effect", targetRef: "target", uses: 1,
    replacementEffect: { type: "destruction", reason: "battle", auto: true, targetZones: ["field"] },
  }] });
  assert.ok(replaceSimulatedBattleDestruction(state, target));
  assert.equal(replaceSimulatedBattleDestruction(state, second), null);
  assert.equal(canUseSimulatedEffectUsage(state, required(mirror.effects?.find(effect => effect.id === mirrorId)), mirror, "bot", true), false);
});

test("simulation redirects a controlled fusion return to its original owner", () => {
  const mirror = simulated(359), target = simulated(363);
  target.originalOwner = "player";
  const state = simulationState({ turnCounter: 4, bot: { field: [target], spellTrap: [mirror] } });
  assert.ok(replaceSimulatedBattleDestruction(state, target));
  assert.ok(state.player.extraDeck.includes(target));
  assert.equal(target.owner, "player");
});

test("simulation publishes replacement movement without destruction metadata", () => {
  for (const id of [351, 363]) {
    const mirror = simulated(359), target = simulated(id);
    const state = simulationState({ bot: { field: [target], spellTrap: id === 351 ? [mirror] : [] } });
    const events: string[] = [];
    assert.ok(replaceSimulatedBattleDestruction(state, target, {
      emitSimulatedEvent: (name, payload) => {
        assert.ok(typeof payload === "object" && payload !== null);
        assert.notEqual(Reflect.get(payload, "wasDestroyed"), true);
        assert.equal(Reflect.get(payload, "destroyCause"), undefined);
        events.push(name);
      },
    }));
    assert.deepEqual(events, ["card_moved"]);
  }
});

test("simulated temporary protection survives its departed, negated source", () => {
  const mirror = simulated(359), target = simulated(351);
  const state = simulationState({ bot: { field: [target], spellTrap: [mirror] } });
  applySimulatedActions({ state, selections: { target: [target] }, options: { sourceCard: mirror }, actions: [{
    type: "register_replacement_effect", targetRef: "target", uses: 1,
    replacementEffect: { type: "destruction", reason: "battle", auto: true, targetZones: ["field"] },
  }] });
  applySimulatedActions({ state, options: { sourceCard: mirror }, actions: [{ type: "move", targetRef: "self", to: "graveyard" }] });
  mirror.effectsNegated = true;
  assert.ok(replaceSimulatedBattleDestruction(state, target));
  assert.ok(state.bot.field.includes(target));
});

function setupFungalCost(t: TestContext, seat: "player" | "bot" = "player") {
  const { game, owner, opponent, make } = setup(t, seat);
  owner.field.length = 0; owner.spellTrap.length = 0;
  const source = make(413);
  const target = new Card({ ...cardDefinition(401), effects: [] }, owner.id);
  const firstCost = new Card({ ...cardDefinition(402), effects: [] }, owner.id);
  const secondCost = new Card({ ...cardDefinition(402), effects: [] }, opponent.id);
  firstCost.addCounter("spore", 1); secondCost.addCounter("spore", 1);
  source.equippedTo = target; target.equips.push(source);
  placeFieldCards(owner.field, target, firstCost); placeFieldCards(opponent.field, secondCost);
  placeFieldCards(owner.spellTrap, source);
  let removed = 0;
  game.on("counter_removed", event => { if (event.counterType === "spore") removed += event.amount; });
  return { game, owner, opponent, source, target, firstCost, secondCost, removed: () => removed };
}

for (const seat of ["player", "bot"] as const) {
  for (const change of ["none", "source negated", "source leaves", "source returns", "protected returns", "counter returns", "counter control"] as const) {
    test(`Fungal Armor revalidates after its internal counter cost selection: ${change}/${seat}`, async t => {
      const { game, owner, opponent, source, target, firstCost, removed } = setupFungalCost(t, seat);
      const finish = game.finishTargetSelection.bind(game);
      let mutated = false;
      game.finishTargetSelection = async () => {
        if (game.targetSelection?.kind === "cost" && !mutated) {
          mutated = true;
          if (change === "source negated") source.effectsNegated = true;
          if (change === "source leaves" || change === "source returns") {
            await game.moveCard(source, owner, "hand", { fromZone: "spellTrap", awaitEvents: true });
            if (change === "source returns") {
              await game.moveCard(source, owner, "spellTrap", { fromZone: "hand", isFacedown: false, awaitEvents: true });
              source.equippedTo = target; target.equips.push(source);
            }
          }
          if (change === "protected returns" || change === "counter returns") {
            const moved = change === "protected returns" ? target : firstCost;
            await game.moveCard(moved, owner, "hand", { fromZone: "field", awaitEvents: true });
            await game.effectEngine.applyActions([{ type: "special_summon_from_zone", zone: "hand", targetRef: "returning", position: "attack" }],
              { player: owner, opponent, source }, { returning: [moved] });
            if (moved === firstCost) firstCost.addCounter("spore", 1);
          }
          if (change === "counter control") assert.equal((await game.takeControl(firstCost, opponent)).success, true);
        }
        return finish();
      };
      const destruction = game.destroyCard(target, { cause: "effect" });
      await completeTestSelections(game, destruction);
      const result = await destruction;
      assert.ok("destroyed" in result, JSON.stringify(result));
      assert.ok(mutated, "the real Fungal Armor must open its internal counter cost decision");
      if (change === "none") {
        assert.equal(result.destroyed, false); assert.ok(owner.field.includes(target));
        assert.equal(removed(), 1); assert.equal(firstCost.getCounter("spore"), 0);
      } else {
        assert.equal(removed(), 0, "no invalid replacement may remove counters");
        assert.ok(firstCost.getCounter("spore") >= 1, "the counter cost remains unpaid");
        assert.equal(result.destroyed, change !== "protected returns");
        if (change === "protected returns") assert.ok(owner.field.includes(target), "a new protected presence survives the old pending destruction");
        else assert.ok(owner.graveyard.includes(target));
      }
    });
  }
}

test("temporary counter-cost replacement ignores its original source leaving during the internal choice", async t => {
  const { game, owner, opponent, source, target, removed } = setupFungalCost(t);
  await game.effectEngine.applyActions([{
    type: "register_replacement_effect", targetRef: "target", uses: 1,
    replacementEffect: { type: "destruction", auto: true, targetZones: ["field"], targetOwner: "self", costActions: [{
      type: "remove_counters_from_field", counterType: "spore", amount: 1, owner: "any", zones: ["field"], haltOnFailure: true,
    }] },
  }], { player: owner, opponent, source }, { target: [target] });
  const finish = game.finishTargetSelection.bind(game);
  let moved = false;
  game.finishTargetSelection = async () => {
    if (game.targetSelection?.kind === "cost" && !moved) {
      moved = true;
      await game.moveCard(source, owner, "hand", { fromZone: "spellTrap", awaitEvents: true });
      source.effectsNegated = true;
    }
    return finish();
  };
  const destruction = game.destroyCard(target, { cause: "effect" });
  await completeTestSelections(game, destruction);
  assert.equal(removed(), 1); assert.ok(owner.field.includes(target));
});

for (const change of ["none", "source negated", "protected returns"] as const) {
  test(`Preacher revalidates replacement after its internal position choice: ${change}`, async t => {
    const { game, owner, opponent, make } = setup(t);
    owner.field.length = 0; owner.spellTrap.length = 0;
    const source = make(460), target = new Card({ ...cardDefinition(451), effects: [] }, owner.id);
    owner.hand.push(source); placeFieldCards(owner.field, target);
    let chosen = 0;
    game.ui.showSpecialSummonPositionModal = (_card, callback) => {
      chosen++;
      void (async () => {
        if (change === "source negated") source.effectsNegated = true;
        if (change === "protected returns") {
          await game.moveCard(target, owner, "hand", { fromZone: "field", awaitEvents: true });
          await game.effectEngine.applyActions([{ type: "special_summon_from_zone", zone: "hand", targetRef: "returning", position: "attack" }],
            { player: owner, opponent, source }, { returning: [target] });
        }
        callback("defense");
      })();
    };
    const result = await game.destroyCard(target, { cause: "effect" });
    assert.ok("destroyed" in result, JSON.stringify(result));
    assert.equal(chosen, 1);
    assert.equal(owner.field.includes(source), change === "none");
    if (change !== "none") assert.ok(owner.hand.includes(source), "invalid replacement does not pay the hand summon");
    assert.equal(result.destroyed, change === "source negated");
    if (change !== "source negated") assert.ok(owner.field.includes(target));
  });
}

test("a payment context guard rejects a nonselecting cost before payment", async t => {
  const { game, owner, opponent, mirror } = setup(t);
  const before = owner.lp;
  const context = { player: owner, opponent, source: mirror, validateCostPayment: () => false };
  const result = await game.effectEngine.applyActions([{ type: "pay_lp", amount: 100 }], context, {});
  assert.ok(typeof result === "object" && result !== null && result.success === false);
  assert.equal(owner.lp, before);
});

test("a payment context guard is checked before each sequential cost action", async t => {
  const { game, owner, opponent, mirror } = setup(t);
  let valid = true;
  const before = owner.lp;
  game.on("lp_change", () => { valid = false; });
  const context = { player: owner, opponent, source: mirror, validateCostPayment: () => valid };
  const result = await game.effectEngine.applyActions([{ type: "pay_lp", amount: 100 }, { type: "pay_lp", amount: 100 }], context, {});
  assert.ok(typeof result === "object" && result !== null && result.success === false);
  assert.equal(owner.lp, before - 100, "the first paid cost remains paid; the stale second action is rejected");
});

test("counter payment rechecks the guard between observable counter removals", async t => {
  const { game, owner, opponent, source, firstCost, secondCost } = setupFungalCost(t);
  secondCost.removeCounter("spore", 1); firstCost.addCounter("spore", 1);
  let valid = true;
  game.waitForPresentationDelay = async () => { valid = false; };
  const context = { player: owner, opponent, source, validateCostPayment: () => valid };
  const result = await game.effectEngine.applyActions([{ type: "remove_counters_from_field", counterType: "spore", amount: 2,
    owner: "any", zones: ["field"], haltOnFailure: true }], context, {});
  assert.ok(typeof result === "object" && result !== null && result.success === false);
  assert.equal(firstCost.getCounter("spore"), 1, "only the removal before invalidation is committed");
});

test("ordinary counter actions retain their internal choice behavior without a payment guard", async t => {
  const { game, owner, opponent, source, firstCost, removed } = setupFungalCost(t);
  const finish = game.finishTargetSelection.bind(game);
  game.finishTargetSelection = async () => {
    source.effectsNegated = true;
    return finish();
  };
  const action = game.effectEngine.applyActions([{ type: "remove_counters_from_field", counterType: "spore", amount: 1,
    owner: "any", zones: ["field"], haltOnFailure: true }], { player: owner, opponent, source }, {});
  await completeTestSelections(game, action);
  assert.equal(removed(), 1); assert.equal(firstCost.getCounter("spore"), 0);
});

for (const valid of [true, false]) {
  test(`movement payment guard runs after placement and before mutation: ${valid}`, async t => {
    const { game, owner } = setup(t);
    const target = new Card({ ...cardDefinition(351), effects: [] }, owner.id);
    owner.field.length = 0; owner.hand.push(target);
    const initialVersion = target.locationVersion;
    game.startReplayRecording({ enabled: true });
    game.getFieldPlacementMode = () => "manual";
    const order: string[] = [];
    game.fieldPlacementProvider = async request => {
      order.push("placement");
      return { outcome: "chosen", slot: required(request.candidates[0]).slot };
    };
    game.on("card_moved", event => { if (event.card === target) order.push("moved"); });
    game.on("after_summon", event => { if (event.card === target) order.push("summoned"); });
    const result = await game.moveCard(target, owner, "field", { fromZone: "hand", summonOrigin: "effect_resolution",
      validateBeforeMove: () => {
        order.push("validation");
        assert.ok(owner.hand.includes(target), "validation precedes the first paid zone mutation");
        return valid;
      } });
    assert.equal(result.success, valid);
    assert.deepEqual(order, valid ? ["placement", "validation", "summoned", "moved"] : ["placement", "validation"]);
    if (!valid) {
      assert.equal("cancelled" in result && result.cancelled, true);
      assert.ok(owner.hand.includes(target)); assert.equal(target.locationVersion, initialVersion);
    }
    const transaction = required(game.getSummonState().last);
    assert.equal(transaction.status, valid ? "succeeded" : "cancelled");
    const serialized = JSON.stringify({ snapshot: createCanonicalStateSnapshot(game), replay: game.exportReplay({ download: false }) });
    assert.equal(serialized.includes("validateBeforeMove"), false); assert.equal(serialized.includes("validateCostPayment"), false);
  });
}

for (const change of ["none", "source negated", "protected returns"] as const) {
  test(`Preacher cost is revalidated after manual field placement: ${change}`, async t => {
    const { game, owner, opponent, make } = setup(t);
    owner.field.length = 0; owner.spellTrap.length = 0;
    const source = make(460), target = new Card({ ...cardDefinition(451), effects: [] }, owner.id);
    owner.hand.push(source); placeFieldCards(owner.field, target);
    game.ui.showSpecialSummonPositionModal = (_card, callback) => callback("attack");
    game.getFieldPlacementMode = () => "manual";
    let placements = 0;
    game.fieldPlacementProvider = async request => {
      placements++;
      if (change === "source negated") source.effectsNegated = true;
      if (change === "protected returns") {
        await game.moveCard(target, owner, "hand", { fromZone: "field", awaitEvents: true });
        game.getFieldPlacementMode = () => "automatic";
        await game.effectEngine.applyActions([{ type: "special_summon_from_zone", zone: "hand", targetRef: "returning", position: "attack" }],
          { player: owner, opponent, source }, { returning: [target] });
        game.getFieldPlacementMode = () => "manual";
      }
      return { outcome: "chosen", slot: required(request.candidates[0]).slot };
    };
    const result = await game.destroyCard(target, { cause: "effect" });
    assert.ok("destroyed" in result, JSON.stringify(result));
    assert.equal(placements, 1);
    assert.equal(owner.field.includes(source), change === "none");
    if (change !== "none") assert.ok(owner.hand.includes(source));
    if (change === "source negated") assert.equal(source.effectsNegated, true, "a stale payment must preserve the decision-time source negation");
    assert.equal(game.getSummonState().last?.status, change === "none" ? "succeeded" : "cancelled", "pre-mutation rejection cancels the unpaid summon rather than applying failed-summon cleanup");
    assert.equal(result.destroyed, change === "source negated");
    if (change !== "source negated") assert.ok(owner.field.includes(target));
  });
}
