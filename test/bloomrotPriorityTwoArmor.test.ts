import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import BloomrotStrategy from "../src/core/ai/BloomrotStrategy.js";
import { getStrategyFor } from "../src/core/ai/StrategyRegistry.js";
import { cloneBotGameState } from "../src/core/bot/simulationBridge.js";
import { createPlanningCopy } from "../src/core/ai/common/planningCopy.js";
import { attachSimulatedEquip, moveCardToZone, refreshSimulatedFieldAuras } from "../src/core/ai/common/zones.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { cleanupSimulatedEndTurn } from "../src/core/ai/common/simulatedActions/lifecycle.js";
import { clearEffectNegation } from "../src/core/effects/negation.js";
import { getEquippedFieldCounterBuffKeys, getModeledPassiveContributions } from "../src/core/effects/passives/passiveBuffs.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { simulationState } from "./helpers/simulation.js";

type Seat = "player" | "bot";

function setup(t: TestContext, seat: Seat) {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false });
  t.after(() => game.dispose("bloomrot_priority_two_armor"));
  game.disablePresentationDelays = true;
  game.turn = seat;
  game.phase = "main1";
  game.turnCounter = 2;
  game.player.controllerType = game.bot.controllerType = "human";
  game.ui.showConfirmPrompt = async () => false;
  const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
  const host = new Card(cardDefinition(401), owner.id);
  const carrier = new Card(cardDefinition(401), opponent.id);
  const first = new Card(cardDefinition(413), owner.id);
  const second = new Card(cardDefinition(413), owner.id);
  placeFieldCards(owner.field, host);
  placeFieldCards(opponent.field, carrier);
  owner.hand.push(first, second);
  return { game, owner, opponent, host, carrier, first, second };
}

async function equipBoth(fixture: ReturnType<typeof setup>) {
  const { game, owner, host, first, second } = fixture;
  for (const source of [first, second]) {
    const activation = await game.tryActivateSpell(source, owner.hand.indexOf(source), {
      bloomrot_fungal_armor_equip_target: [host],
    }, { owner });
    assert.equal(activation.success, true);
  }
}

function setupSimulation(seat: Seat) {
  const copy = createPlanningCopy();
  const host = copy.cloneCardForSim(new Card(cardDefinition(401), seat));
  const otherHost = copy.cloneCardForSim(new Card(cardDefinition(401), seat));
  const carrier = copy.cloneCardForSim(new Card(cardDefinition(401), seat === "player" ? "bot" : "player"));
  const first = copy.cloneCardForSim(new Card(cardDefinition(413), seat));
  const second = copy.cloneCardForSim(new Card(cardDefinition(413), seat));
  const state = simulationState({ turn: seat, phase: "main1", turnCounter: 2,
    [seat]: { field: [host, otherHost], spellTrap: [first, second] },
    [seat === "player" ? "bot" : "player"]: { field: [carrier] },
  });
  assert.equal(attachSimulatedEquip(first, host), true);
  assert.equal(attachSimulatedEquip(second, host), true);
  return { state, owner: state[seat], host, otherHost, carrier, first, second };
}

function cloneSimulation(fixture: ReturnType<typeof setupSimulation>) {
  const copy = createPlanningCopy();
  const clonePlayer = (owner: typeof fixture.state.player) => ({
    field: owner.field.map(copy.cloneCardForSim),
    spellTrap: owner.spellTrap.map(copy.cloneCardForSim),
    hand: owner.hand.map(copy.cloneCardForSim),
    graveyard: owner.graveyard.map(copy.cloneCardForSim),
  });
  return simulationState({ turn: fixture.state.turn, phase: fixture.state.phase, turnCounter: fixture.state.turnCounter,
    player: clonePlayer(fixture.state.player), bot: clonePlayer(fixture.state.bot) });
}

test("B08 contribution keys prioritize presence, then instance, then source index while preserving fixed DEF keys", () => {
  const cases = [
    { source: { id: 413, fieldPresenceId: "presence-a", instanceId: 101 }, effectId: "armor_counter",
      expected: { counterKey: "armor_counter_presence-a_1_counter", fixedDefKey: "armor_counter_presence-a_fixed_def" } },
    { source: { id: 413, instanceId: 101 }, effectId: "armor_counter",
      expected: { counterKey: "armor_counter_101_1_counter", fixedDefKey: "armor_counter_101_fixed_def" } },
    { source: { id: 413 }, effectId: undefined,
      expected: { counterKey: "passive_413_1_413_4_field_counter_equip_413_4_1_counter", fixedDefKey: "passive_413_1_413_4_field_counter_equip_413_4_fixed_def" } },
  ];
  for (const { source, effectId, expected } of cases) {
    assert.deepEqual(getEquippedFieldCounterBuffKeys(source, effectId, 1, 4), expected);
  }
  assert.notEqual(getEquippedFieldCounterBuffKeys({ id: 413 }, "counter", 1, 4).counterKey,
    getEquippedFieldCounterBuffKeys({ id: 413 }, "counter", 1, 5).counterKey);
  assert.notEqual(getEquippedFieldCounterBuffKeys({ id: 413, instanceId: 101 }, "counter", 1, 4).counterKey,
    getEquippedFieldCounterBuffKeys({ id: 413, instanceId: 101 }, "counter", 2, 4).counterKey);
});

for (const seat of ["player", "bot"] as const) {
  test(`B08 two real Armors independently add their counter ATK on real Sporeling (${seat})`, async t => {
    const fixture = setup(t, seat);
    const { game, owner, host, carrier } = fixture;
    carrier.addCounter("spore", 3);
    await equipBoth(fixture);
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([host.atk, host.def], [1800, 2500]);
    assert.equal(owner.spellTrap.length, 2);
    assert.equal(host.equips.length, 2);
  });

  test(`B08 refresh is idempotent with 0, 3 and 4 spores and keeps DEF without counters (${seat})`, async t => {
    const fixture = setup(t, seat);
    const { game, owner, opponent, host, carrier } = fixture;
    await equipBoth(fixture);
    for (const [amount, expected] of [[0, 1200], [3, 1800], [1, 2000], [-4, 1200]] as const) {
      if (amount !== 0) await game.effectEngine.applyActions([{
        type: amount > 0 ? "add_counter" : "remove_counter", targetRef: "carrier", counterType: "spore", amount: Math.abs(amount),
      }], { player: opponent, opponent: owner, source: carrier }, { carrier: [carrier] });
      for (let refresh = 0; refresh < 3; refresh++) {
        game.effectEngine.updatePassiveBuffs();
        assert.deepEqual([host.atk, host.def], [expected, 2500]);
      }
    }
  });

  test(`B08 each negated or face-down Armor removes only its contribution and restores independently (${seat})`, async t => {
    const fixture = setup(t, seat);
    const { game, owner, host, carrier, first, second } = fixture;
    carrier.addCounter("spore", 3);
    await equipBoth(fixture);
    const context = { player: owner, source: host };
    await game.effectEngine.applyActions([{ type: "add_status", targetRef: "equip", status: "effectsNegated", duration: "until_end_turn" }], context, { equip: [first] });
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([host.atk, host.def], [1500, 2000]);
    await game.effectEngine.applyActions([{ type: "add_status", targetRef: "equip", status: "effectsNegated", duration: "until_end_turn" }], context, { equip: [second] });
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([host.atk, host.def], [1200, 1500]);
    clearEffectNegation(first);
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([host.atk, host.def], [1500, 2000]);
    game.cleanupTempBoosts(owner);
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([host.atk, host.def], [1800, 2500]);
    first.isFacedown = true;
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([host.atk, host.def], [1500, 2000]);
    first.isFacedown = false;
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([host.atk, host.def], [1800, 2500]);
  });

  test(`B08 departure, return and re-equip reconcile only that Armor and never retain an invalid binding (${seat})`, async t => {
    const fixture = setup(t, seat);
    const { game, owner, host, carrier, first, second } = fixture;
    carrier.addCounter("spore", 3);
    await equipBoth(fixture);
    await game.moveCard(first, owner, "hand", { fromZone: "spellTrap" });
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([host.atk, host.def], [1500, 2000]);
    assert.equal(first.equippedTo, null);
    await game.moveCard(first, owner, "spellTrap", { fromZone: "hand", isFacedown: false });
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([host.atk, host.def], [1500, 2000], "returning a source cannot recreate a binding");
    const equip = async (target: Card) => {
      const result = await game.effectEngine.applyActions([{ type: "equip", targetRef: "host" }], { player: owner, source: first }, { host: [target] });
      assert.equal(result.success, true);
      game.effectEngine.updatePassiveBuffs();
    };
    await equip(host);
    assert.deepEqual([host.atk, host.def], [1800, 2500]);
    const otherHost = new Card(cardDefinition(401), owner.id);
    placeFieldCards(owner.field, otherHost);
    await equip(otherHost);
    assert.deepEqual([host.atk, host.def, otherHost.atk, otherHost.def], [1500, 2000, 1500, 2000]);
    first.equippedTo = first.equipTarget = null;
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([host.atk, host.def, otherHost.atk, otherHost.def], [1500, 2000, 1200, 1500]);
    await equip(host);
    await completeTestSelections(game, Promise.resolve(game.moveCard(host, owner, "hand", { fromZone: "field" })));
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([host.atk, host.def], [1200, 1500]);
    assert.ok(owner.graveyard.includes(first));
    assert.ok(owner.graveyard.includes(second));
    assert.deepEqual(getModeledPassiveContributions(host), []);
    const returned = await game.effectEngine.applyActions([{
      type: "special_summon_from_zone", targetRef: "return", zone: "hand", position: "attack",
    }], { player: owner, source: otherHost }, { return: [host] });
    assert.equal(returned.success, true);
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([host.atk, host.def], [1200, 1500], "a new host presence cannot restore departed Equip links");
  });

  test(`B08 overlapping permanent reduction stays at zero through Armor removal and cleans up on host exit (${seat})`, async t => {
    const fixture = setup(t, seat);
    const { game, owner, host, carrier, first, second } = fixture;
    carrier.addCounter("spore", 3);
    await equipBoth(fixture);
    assert.deepEqual([host.atk, host.def], [1800, 2500]);
    await game.effectEngine.applyActions([{ type: "buff_stats_temp", targetRef: "host", atkBoost: -2200, defBoost: -3500, permanent: true }],
      { player: owner, source: carrier }, { host: [host] });
    for (const source of [first, second]) {
      game.effectEngine.updatePassiveBuffs();
      assert.deepEqual([host.atk, host.def], [0, 0]);
      await game.moveCard(source, owner, "hand", { fromZone: "spellTrap" });
      game.effectEngine.updatePassiveBuffs();
      assert.deepEqual([host.atk, host.def], [0, 0]);
    }
    await completeTestSelections(game, Promise.resolve(game.moveCard(host, owner, "hand", { fromZone: "field" })));
    assert.deepEqual([host.atk, host.def], [1200, 1500]);
    assert.equal(host.permanentBuffsBySource, undefined);
  });

  test(`B08 simulated two real Armor declarations accumulate, refresh and negate independently (${seat})`, () => {
    const { state, host, carrier, first, second } = setupSimulation(seat);
    for (const [amount, expected] of [[0, 1200], [3, 1800], [1, 2000], [-4, 1200], [3, 1800]] as const) {
      if (amount !== 0) applySimulatedActions({ state, actions: [{ type: amount > 0 ? "add_counter" : "remove_counter", targetRef: "carrier", counterType: "spore", amount: Math.abs(amount) }], selections: { carrier: [carrier] } });
      for (let refresh = 0; refresh < 3; refresh++) {
        refreshSimulatedFieldAuras(state);
        assert.deepEqual([host.atk, host.def], [expected, 2500]);
      }
    }
    first.effectsNegated = true;
    refreshSimulatedFieldAuras(state);
    assert.deepEqual([host.atk, host.def], [1500, 2000]);
    second.effectsNegated = true;
    refreshSimulatedFieldAuras(state);
    assert.deepEqual([host.atk, host.def], [1200, 1500]);
    first.effectsNegated = false;
    refreshSimulatedFieldAuras(state);
    assert.deepEqual([host.atk, host.def], [1500, 2000]);
    second.effectsNegated = false;
    refreshSimulatedFieldAuras(state);
    assert.deepEqual([host.atk, host.def], [1800, 2500]);
    first.isFacedown = true;
    refreshSimulatedFieldAuras(state);
    assert.deepEqual([host.atk, host.def], [1500, 2000]);
    first.isFacedown = false;
    refreshSimulatedFieldAuras(state);
    assert.deepEqual([host.atk, host.def], [1800, 2500]);
  });

  test(`B08 planning clones keep Equip links and independent contributions through source and host lifecycle (${seat})`, () => {
    const fixture = setupSimulation(seat);
    const { state, owner, host, otherHost, carrier, first, second } = fixture;
    applySimulatedActions({ state, actions: [{ type: "add_counter", targetRef: "carrier", counterType: "spore", amount: 3 }], selections: { carrier: [carrier] } });
    refreshSimulatedFieldAuras(state);
    assert.deepEqual([host.atk, host.def], [1800, 2500]);
    const cloned = cloneSimulation(fixture), clonedOwner = cloned[seat];
    const clonedHost = required(clonedOwner.field[0]), clonedFirst = required(clonedOwner.spellTrap[0]);
    assert.equal(clonedFirst.equippedTo, clonedHost);
    assert.equal(clonedHost.equips?.length, 2);
    clonedFirst.effectsNegated = true;
    refreshSimulatedFieldAuras(cloned);
    assert.deepEqual([clonedHost.atk, clonedHost.def], [1500, 2000]);
    assert.deepEqual([host.atk, host.def], [1800, 2500]);
    assert.equal(moveCardToZone(owner, first, "hand", owner, { state }), true);
    refreshSimulatedFieldAuras(state);
    assert.deepEqual([host.atk, host.def], [1500, 2000]);
    assert.equal(moveCardToZone(owner, first, "spellTrap", owner, { state }), true);
    refreshSimulatedFieldAuras(state);
    assert.deepEqual([host.atk, host.def], [1500, 2000]);
    assert.equal(attachSimulatedEquip(first, host), true);
    refreshSimulatedFieldAuras(state);
    assert.deepEqual([host.atk, host.def], [1800, 2500]);
    assert.equal(attachSimulatedEquip(first, otherHost), true);
    refreshSimulatedFieldAuras(state);
    assert.deepEqual([host.atk, host.def, otherHost.atk, otherHost.def], [1500, 2000, 1500, 2000]);
    first.equippedTo = first.equipTarget = null;
    refreshSimulatedFieldAuras(state);
    assert.deepEqual([host.atk, host.def, otherHost.atk, otherHost.def], [1500, 2000, 1200, 1500]);
    assert.equal(attachSimulatedEquip(first, host), true);
    refreshSimulatedFieldAuras(state);
    assert.equal(moveCardToZone(owner, host, "hand", owner, { state }), true);
    refreshSimulatedFieldAuras(state);
    assert.deepEqual([host.atk, host.def], [1200, 1500]);
    assert.ok(owner.graveyard.includes(first));
    assert.ok(owner.graveyard.includes(second));
    assert.deepEqual(getModeledPassiveContributions(host), []);
    assert.equal(moveCardToZone(owner, host, "field", owner, { state }), true);
    refreshSimulatedFieldAuras(state);
    assert.deepEqual([host.atk, host.def], [1200, 1500]);
    assert.deepEqual([clonedHost.atk, clonedHost.def], [1500, 2000]);
  });

  test(`B08 simulated negative overlap remains at zero after sources leave and host exit restores base stats (${seat})`, () => {
    const fixture = setupSimulation(seat);
    const { state, owner, host, carrier, first, second } = fixture;
    applySimulatedActions({ state, actions: [{ type: "add_counter", targetRef: "carrier", counterType: "spore", amount: 3 }], selections: { carrier: [carrier] } });
    assert.deepEqual([host.atk, host.def], [1800, 2500]);
    applySimulatedActions({ state, actions: [{ type: "buff_stats_temp", targetRef: "host", atkBoost: -2200, defBoost: -3500, permanent: true }], selections: { host: [host] }, options: { sourceCard: carrier } });
    for (const source of [first, second]) {
      refreshSimulatedFieldAuras(state);
      assert.deepEqual([host.atk, host.def], [0, 0]);
      assert.equal(moveCardToZone(owner, source, "hand", owner, { state }), true);
      refreshSimulatedFieldAuras(state);
      assert.deepEqual([host.atk, host.def], [0, 0]);
    }
    cleanupSimulatedEndTurn(state);
    assert.deepEqual([host.atk, host.def], [0, 0]);
    assert.equal(moveCardToZone(owner, host, "hand", owner, { state }), true);
    assert.deepEqual([host.atk, host.def], [1200, 1500]);
    assert.equal(host.permanentBuffsBySource, undefined);
  });

  test(`B08 runtime contributions survive Bot cloning and temporary zero restores only the remaining Armor (${seat})`, async t => {
    const fixture = setup(t, seat);
    const { game, owner, opponent, host, carrier, first } = fixture;
    carrier.addCounter("spore", 3);
    await equipBoth(fixture);
    await game.effectEngine.applyActions([{ type: "modify_stats_temp", targetRef: "host", atkFactor: 0, defFactor: 0 }],
      { player: owner, source: carrier }, { host: [host] });
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([host.atk, host.def], [0, 0]);
    const strategy = getStrategyFor("bloomrot", owner);
    assert.ok(strategy instanceof BloomrotStrategy);
    const bot = { ...owner, strategy, resolveOpponent: () => opponent };
    const state = cloneBotGameState(bot, { bot, player: opponent, turn: seat, phase: "main1", turnCounter: 2 });
    const clonedHost = required(state.bot.field[0]), clonedFirst = required(state.bot.spellTrap[0]);
    assert.equal(clonedFirst.equippedTo, clonedHost);
    assert.equal(clonedHost.equips?.length, 2);
    assert.equal(getModeledPassiveContributions(clonedHost).length, 4);
    assert.equal(moveCardToZone(state.bot, clonedFirst, "hand", state.bot, { state }), true);
    refreshSimulatedFieldAuras(state);
    assert.deepEqual([clonedHost.atk, clonedHost.def], [0, 0]);
    cleanupSimulatedEndTurn(state);
    refreshSimulatedFieldAuras(state);
    assert.deepEqual([clonedHost.atk, clonedHost.def], [1500, 2000]);
    assert.deepEqual([host.atk, host.def], [0, 0], "clone cleanup cannot restore runtime stats");
    await game.moveCard(first, owner, "hand", { fromZone: "spellTrap" });
    game.cleanupTempBoosts(owner);
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([host.atk, host.def], [1500, 2000]);
    assert.deepEqual(state._simUnsupportedActions ?? [], []);
  });
}
