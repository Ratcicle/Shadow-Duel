import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { CardAction } from "../src/core/contracts/actions.js";
import { retireDamageStepBuffsForCard } from "../src/core/game/combat/damageStep.js";
import { checkpointZoneSnapshotAfterResponse } from "../src/core/game/zones/snapshot.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

function scenario(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
  t.after(() => game.dispose());
  game.turnCounter = 2;
  game.phase = "battle";
  game.battleStep = "battle";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  game.ui.showChainResponseModal = async () => null;
  const make = (isToken = false) => {
    const card = new Card({ id: 99411, name: "Damage Step lifecycle fixture", cardKind: "monster", atk: 1900, def: 1700 }, game.player.id);
    card.isToken = isToken;
    placeFieldCards(game.player.field, card);
    return card;
  };
  const apply = (card: Card, actions: readonly CardAction[]) => game.effectEngine.applyActions(
    actions,
    { source: card, player: game.player, opponent: game.bot },
    { chosen: [card] },
  );
  const clear = () => {
    game.clearDamageCalculationBuffs();
    game.clearEndOfDamageStepBuffs();
  };
  return { game, make, apply, clear };
}

for (const duration of ["damage_calculation", "end_of_damage_step"] as const) {
  for (const destination of ["hand", "graveyard"] as const) {
    test(`${duration} records retire when normal movement resets stats into ${destination}`, async t => {
      const { game, make, apply, clear } = scenario(t);
      const card = make();
      await apply(card, [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: 500, defBoost: 300, duration }]);
      assert.deepEqual([card.atk, card.def], [2400, 2000]);
      const result = await game.moveCard(card, game.player, destination, { fromZone: "field" });
      assert.equal(result.success, true);
      assert.ok(game.player[destination].includes(card));
      assert.deepEqual([card.atk, card.def, card.tempAtkBoost, card.tempDefBoost], [1900, 1700, 0, 0]);
      assert.equal(game.damageCalculationTempBuffs.some(entry => entry.card === card), false);
      assert.equal(game.endOfDamageStepTempBuffs.some(entry => entry.card === card), false);
      clear();
      clear();
      assert.deepEqual([card.atk, card.def, card.tempAtkBoost, card.tempDefBoost], [1900, 1700, 0, 0]);
    });
  }

  test(`${duration} old presence cannot consume a new buff after re-entry`, async t => {
    const { game, make, apply, clear } = scenario(t);
    const card = make();
    await apply(card, [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: 500, defBoost: 300, duration }]);
    assert.equal((await game.moveCard(card, game.player, "graveyard", { fromZone: "field" })).success, true);
    assert.equal((await game.moveCard(card, game.player, "field", {
      fromZone: "graveyard", position: "attack", summonMethodOverride: "special", summonOrigin: "effect_resolution",
    })).success, true);
    await apply(card, [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: 200, defBoost: 100, duration: "end_of_turn" }]);
    clear();
    assert.deepEqual([card.atk, card.def], [2100, 1800], "old expiry must not consume the new presence's independent modifier");
    game.cleanupTempBoosts(game.player);
    assert.deepEqual([card.atk, card.def], [1900, 1700]);
  });

  test(`${duration} Token removal retires references before later cleanup`, async t => {
    const { game, make, apply, clear } = scenario(t);
    const token = make(true);
    await apply(token, [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: 500, duration }]);
    assert.equal((await game.moveCard(token, game.player, "graveyard", { fromZone: "field" })).success, true);
    assert.equal(game.player.field.includes(token), false);
    assert.equal(game.player.graveyard.includes(token), false, "Tokens leave the game instead of entering the Graveyard");
    assert.equal(game.damageCalculationTempBuffs.some(entry => entry.card === token), false);
    assert.equal(game.endOfDamageStepTempBuffs.some(entry => entry.card === token), false);
    const afterRemoval = [token.atk, token.def, token.tempAtkBoost, token.tempDefBoost];
    clear();
    assert.deepEqual([token.atk, token.def, token.tempAtkBoost, token.tempDefBoost], afterRemoval);
  });

  test(`${duration} partial removal keeps unrelated expiry and later buffs`, async t => {
    const { game, make, apply, clear } = scenario(t);
    const card = make();
    await apply(card, [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: 500, defBoost: 300, duration }]);
    await apply(card, [{ type: "remove_stat_increases", targetRef: "chosen", stats: ["atk"] }]);
    await apply(card, [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: 200, duration: "end_of_turn" }]);
    clear();
    assert.deepEqual([card.atk, card.def], [2100, 1700]);
    game.cleanupTempBoosts(game.player);
    assert.deepEqual([card.atk, card.def], [1900, 1700]);
  });
}

for (const token of [false, true]) {
  test(`zero aggregate retires both queues by physical identity and preserves other order (Token=${token})`, async t => {
    const { game, make, apply, clear } = scenario(t);
    const first = make();
    const departing = make(token);
    const last = make();
    for (const duration of ["damage_calculation", "end_of_damage_step"] as const) {
      for (const card of [first, departing, last, departing]) {
        const amount = card === departing && game[duration === "damage_calculation" ? "damageCalculationTempBuffs" : "endOfDamageStepTempBuffs"].some(entry => entry.card === departing) ? -500 : 500;
        await apply(card, [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: amount, defBoost: amount, duration }]);
      }
    }
    assert.deepEqual([departing.tempAtkBoost, departing.tempDefBoost], [0, 0]);
    const calculationQueue = game.damageCalculationTempBuffs;
    const endQueue = game.endOfDamageStepTempBuffs;
    const remainingCalculation = calculationQueue.filter(entry => entry.card !== departing);
    const remainingEnd = endQueue.filter(entry => entry.card !== departing);
    assert.equal((await game.moveCard(departing, game.player, "graveyard", { fromZone: "field" })).success, true);
    assert.equal(game.damageCalculationTempBuffs, calculationQueue, "queue identity remains stable");
    assert.equal(game.endOfDamageStepTempBuffs, endQueue);
    assert.deepEqual(calculationQueue, remainingCalculation);
    assert.deepEqual(endQueue, remainingEnd);
    assert.deepEqual([first.atk, last.atk], [2900, 2900], "retiring another copy does not change stats");
    clear();
    assert.deepEqual([first.atk, last.atk], [1900, 1900]);
    assert.deepEqual([departing.tempAtkBoost, departing.tempDefBoost], [0, 0]);
  });
}

test("aborted Damage Step cleanup preserves departed baseline and expires surviving buffs once", async t => {
  const { game, make, apply } = scenario(t);
  const departing = make();
  const survivor = make();
  for (const card of [departing, survivor]) {
    await apply(card, [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: 500, duration: "end_of_damage_step" }]);
  }
  game.createDamageStepTransaction({ attacker: survivor, defenderOwner: game.bot });
  assert.equal((await game.moveCard(departing, game.player, "graveyard", { fromZone: "field" })).success, true);
  game.cleanupDamageStepTransaction("failed");
  game.cleanupDamageStepTransaction("failed");
  assert.deepEqual([departing.atk, departing.tempAtkBoost], [1900, 0]);
  assert.deepEqual([survivor.atk, survivor.tempAtkBoost], [1900, 0]);
  assert.equal(game.getDamageStepState().active, false);
  assert.deepEqual(game.damageCalculationTempBuffs, []);
  assert.deepEqual(game.endOfDamageStepTempBuffs, []);
});

test("retiring registrations alone changes no stats and is idempotent", async t => {
  const { game, make, apply } = scenario(t);
  const card = make();
  const other = make();
  for (const duration of ["damage_calculation", "end_of_damage_step"] as const) {
    await apply(card, [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: 500, duration }]);
    await apply(other, [{ type: "buff_stats_temp", targetRef: "chosen", defBoost: 300, duration }]);
  }
  const cardStats = [card.atk, card.def, card.tempAtkBoost, card.tempDefBoost];
  const otherStats = [other.atk, other.def, other.tempAtkBoost, other.tempDefBoost];
  const calculationQueue = game.damageCalculationTempBuffs;
  const endQueue = game.endOfDamageStepTempBuffs;
  const calculationEntry = calculationQueue.find(entry => entry.card === other);
  const endEntry = endQueue.find(entry => entry.card === other);
  retireDamageStepBuffsForCard(game, card);
  retireDamageStepBuffsForCard(game, card);
  assert.equal(game.damageCalculationTempBuffs, calculationQueue);
  assert.equal(game.endOfDamageStepTempBuffs, endQueue);
  assert.deepEqual(calculationQueue, [calculationEntry]);
  assert.deepEqual(endQueue, [endEntry]);
  assert.equal(calculationQueue[0], calculationEntry, "remaining entries retain their identity");
  assert.equal(endQueue[0], endEntry);
  assert.deepEqual([card.atk, card.def, card.tempAtkBoost, card.tempDefBoost], cardStats);
  assert.deepEqual([other.atk, other.def, other.tempAtkBoost, other.tempDefBoost], otherStats);
});

for (const token of [false, true]) {
  test(`late movement rollback restores expiry for the original presence (Token=${token})`, async t => {
    const { game, make, apply, clear } = scenario(t);
    const card = make(token);
    await apply(card, [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: 500, duration: "end_of_damage_step" }]);
    const queue = game.endOfDamageStepTempBuffs;
    const originalEntries = [...queue];
    const publishedRegistrations: number[] = [];
    game.on("card_moved", event => {
      if (event.card === card) publishedRegistrations.push(queue.filter(entry => entry.card === card).length);
    });
    const originalInvariantCheck = game.assertStateInvariants.bind(game);
    let injected = false;
    game.assertStateInvariants = (...args) => {
      if (!injected && args[0] === "damage_step_late_failure") {
        injected = true;
        throw new Error("DAMAGE_STEP_LATE_FAILURE");
      }
      return originalInvariantCheck(...args);
    };
    const result = await game.moveCard(card, game.player, "graveyard", {
      fromZone: "field", awaitEvents: true, contextLabel: "damage_step_late_failure",
    });
    assert.equal(result.success, false);
    assert.ok("rolledBack" in result);
    assert.equal(result.rolledBack, true);
    assert.equal(injected, true);
    assert.deepEqual(publishedRegistrations, [0], "confirmed movement observers do not see obsolete expiry registrations");
    assert.ok(game.player.field.includes(card));
    assert.deepEqual([card.atk, card.tempAtkBoost], [2400, 500]);
    assert.equal(game.endOfDamageStepTempBuffs, queue);
    assert.deepEqual(queue, originalEntries, "restored presence retains its original expiry");
    clear();
    assert.deepEqual([card.atk, card.tempAtkBoost], [1900, 0]);
  });
}

test("pre-publication movement rollback preserves the original registrations", async t => {
  const { game, make, apply, clear } = scenario(t);
  const card = make();
  await apply(card, [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: 500, duration: "end_of_damage_step" }]);
  const originalEntries = [...game.endOfDamageStepTempBuffs];
  game.setDevMode(true);
  game.devFailAfterZoneMutation = true;
  const result = await game.moveCard(card, game.player, "graveyard", { fromZone: "field" });
  assert.equal(result.success, false);
  assert.ok("rolledBack" in result);
  assert.equal(result.rolledBack, true);
  assert.ok(game.player.field.includes(card));
  assert.deepEqual([card.atk, card.tempAtkBoost], [2400, 500]);
  assert.deepEqual(game.endOfDamageStepTempBuffs, originalEntries);
  clear();
  assert.deepEqual([card.atk, card.tempAtkBoost], [1900, 0]);
});

test("outer zone operation restores registrations after a nested successful departure", async t => {
  const { game, make, apply, clear } = scenario(t);
  const card = make();
  const other = make();
  for (const duration of ["damage_calculation", "end_of_damage_step"] as const) {
    await apply(card, [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: 500, duration }]);
    await apply(other, [{ type: "buff_stats_temp", targetRef: "chosen", defBoost: 300, duration }]);
  }
  const calculationQueue = game.damageCalculationTempBuffs;
  const endQueue = game.endOfDamageStepTempBuffs;
  const expectedCalculation = calculationQueue.map(entry => ({ ...entry }));
  const expectedEnd = endQueue.map(entry => ({ ...entry }));
  let nestedMoved = false;
  const result = await game.runZoneOp("damage_step_outer", async () => {
    nestedMoved = (await game.moveCard(card, game.player, "graveyard", { fromZone: "field" })).success === true;
    throw new Error("DAMAGE_STEP_OUTER_FAILURE");
  });
  assert.ok(result && typeof result === "object");
  assert.ok("rolledBack" in result);
  assert.equal(result.rolledBack, true);
  assert.equal(nestedMoved, true);
  assert.ok(game.player.field.includes(card));
  assert.equal(game.damageCalculationTempBuffs, calculationQueue);
  assert.equal(game.endOfDamageStepTempBuffs, endQueue);
  assert.deepEqual(calculationQueue, expectedCalculation);
  assert.deepEqual(endQueue, expectedEnd);
  clear();
  assert.deepEqual([card.atk, other.def], [1900, 1700]);
});

test("zone snapshot detaches mutable expiry records while retaining physical cards", async t => {
  const { game, make, apply, clear } = scenario(t);
  const card = make();
  for (const duration of ["damage_calculation", "end_of_damage_step"] as const) {
    await apply(card, [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: 500, defBoost: 300, duration }]);
  }
  const calculationQueue = game.damageCalculationTempBuffs;
  const endQueue = game.endOfDamageStepTempBuffs;
  const snapshot = game.captureZoneSnapshot("damage_step_detached");
  await apply(card, [{ type: "remove_stat_increases", targetRef: "chosen", stats: ["atk"] }]);
  game.restoreZoneSnapshot(snapshot);
  assert.equal(game.damageCalculationTempBuffs, calculationQueue);
  assert.equal(game.endOfDamageStepTempBuffs, endQueue);
  assert.equal(calculationQueue[0]?.card, card);
  assert.equal(endQueue[0]?.card, card);
  clear();
  assert.deepEqual([card.atk, card.def, card.tempAtkBoost, card.tempDefBoost], [1900, 1700, 0, 0], "saved amounts must not be consumed through live record aliases");
  game.restoreZoneSnapshot(snapshot);
  clear();
  assert.deepEqual([card.atk, card.def, card.tempAtkBoost, card.tempDefBoost], [1900, 1700, 0, 0], "restored records are independent of the reusable snapshot");
});

test("response checkpoint retains current expiry and does not resurrect a paid departure", async t => {
  const { game, make, apply, clear } = scenario(t);
  const paid = make();
  const survivor = make();
  const entrant = new Card({ name: "Response checkpoint entrant", cardKind: "monster", atk: 1000, def: 1000 }, game.player.id);
  game.player.hand.push(entrant);
  await apply(paid, [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: 500, duration: "end_of_damage_step" }]);
  const result = await game.runZoneOp("damage_step_response_checkpoint", async () => {
    assert.equal((await game.moveCard(paid, game.player, "graveyard", { fromZone: "field" })).success, true);
    await apply(survivor, [{ type: "buff_stats_temp", targetRef: "chosen", atkBoost: 300, duration: "end_of_damage_step" }]);
    // The checkpoint's entrant is in transit while completed response effects remain live.
    game.player.hand.splice(game.player.hand.indexOf(entrant), 1);
    checkpointZoneSnapshotAfterResponse(game, entrant);
    throw new Error("DAMAGE_STEP_PLACEMENT_FAILURE_AFTER_RESPONSE");
  });
  assert.ok(result && typeof result === "object");
  assert.ok("rolledBack" in result);
  assert.equal(result.rolledBack, true);
  assert.ok(game.player.graveyard.includes(paid));
  assert.ok(game.player.hand.includes(entrant));
  assert.deepEqual([paid.atk, survivor.atk], [1900, 2200]);
  assert.deepEqual(game.endOfDamageStepTempBuffs.map(entry => entry.card), [survivor]);
  clear();
  assert.deepEqual([paid.atk, survivor.atk, survivor.tempAtkBoost], [1900, 1900, 0]);
});
