import assert from "node:assert/strict";
import test from "node:test";
import Card from "../src/core/Card.js";
import BloomrotStrategy from "../src/core/ai/BloomrotStrategy.js";
import { cloneBotGameState } from "../src/core/bot/simulationBridge.js";
import { canUseSimulatedEffectUsage, markSimulatedEffectUsage } from "../src/core/ai/common/simStateUtils.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "./helpers/game.js";

const effects = [
  [402, "bloomrot_rootling_ignition_spore_counter", "activate"],
  [410, "bloomrot_living_colony_ignition_spore_counter", "activate"],
  [412, "bloomrot_root_network_recover", "activate"],
  [413, "bloomrot_fungal_armor_equipped_protection", "use"],
  [417, "bloomrot_rotting_ground_negate_infected", "activate"],
  [418, "bloomrot_ancient_mycelium_destroy_defense", "activate"],
  [420, "bloomrot_devourer_dead_roots_destroy_spored_monsters", "activate"],
] as const;

for (const seat of ["player", "bot"] as const) for (const [id, effectId, policy] of effects) {
  test(`B03 ${id} reserves, settles and projects usage by physical copy (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true });
    t.after(() => game.dispose());
    game.turn = seat; game.turnCounter = 9; game.phase = "main1";
    const actor = game[seat], other = game[seat === "player" ? "bot" : "player"];
    const a = new Card(cardDefinition(id), actor.id), b = new Card(cardDefinition(id), actor.id);
    const zone = a.cardKind === "monster" ? "field" : a.subtype === "field" ? "fieldSpell" : "spellTrap";
    if (zone === "fieldSpell") { actor.fieldSpell = a; actor.hand.push(b); }
    else placeFieldCards(actor[zone], a, b);
    const effect = required(a.effects.find(entry => entry.id === effectId));
    assert.equal(effect.usagePolicy, policy);
    const reserve = required(game.reserveEffectUsage({ card: a, player: actor, effect }));
    assert.ok("reservationId" in reserve);
    assert.equal(game.checkEffectUsage({ card: a, player: actor, effect }).ok, false);
    assert.equal(game.checkEffectUsage({ card: b, player: actor, effect }).ok, true);
    game.settleEffectUsage(reserve, "activation_negated");
    assert.equal(game.checkEffectUsage({ card: a, player: actor, effect }).ok, policy === "activate");
    assert.equal(game.checkEffectUsage({ card: b, player: actor, effect }).ok, true);
    if (policy === "activate") {
      const cancelled = required(game.reserveEffectUsage({ card: a, player: actor, effect }));
      assert.ok("reservationId" in cancelled);
      game.settleEffectUsage(cancelled, "precommit_failure");
      assert.equal(game.checkEffectUsage({ card: a, player: actor, effect }).ok, true);
      const committed = required(game.reserveEffectUsage({ card: a, player: actor, effect }));
      assert.ok("reservationId" in committed);
      game.settleEffectUsage(committed, {});
    }
    assert.equal(game.checkEffectUsage({ card: a, player: other, effect }).ok, false,
      "a control change cannot refresh this presence's card-scoped usage");
    const liveProjection = { player: other, bot: actor, turn: game.turn, phase: game.phase,
      turnCounter: game.turnCounter, oncePerTurnUsage: game.oncePerTurnUsage };
    const state = cloneBotGameState({ ...actor, strategy: new BloomrotStrategy(actor), resolveOpponent: () => other }, liveProjection);
    const projectedCards = [...state.bot.field, ...state.bot.spellTrap, ...state.bot.hand, ...(state.bot.fieldSpell ? [state.bot.fieldSpell] : [])];
    const projectedA = required(projectedCards.find(entry => entry.instanceId === a.instanceId));
    const projectedB = required(projectedCards.find(entry => entry.instanceId === b.instanceId));
    assert.equal(canUseSimulatedEffectUsage(state, effect, projectedA, actor.id, true), false);
    assert.equal(canUseSimulatedEffectUsage(state, effect, projectedB, actor.id, true), true);
    markSimulatedEffectUsage(state, effect, projectedB, actor.id, true);
    assert.equal(canUseSimulatedEffectUsage(state, effect, projectedB, actor.id, true), false);
    assert.equal(game.checkEffectUsage({ card: b, player: actor, effect }).ok, true,
      "simulation leaves the live ledger unchanged");
    game.turnCounter += 1;
    assert.equal(game.checkEffectUsage({ card: a, player: actor, effect }).ok, true);
    game.markOncePerTurnUsed(a, actor, effect);
    assert.equal(game.checkEffectUsage({ card: a, player: actor, effect }).ok, false);
    await game.moveCard(a, actor, "hand", { fromZone: zone });
    assert.equal(game.checkEffectUsage({ card: a, player: actor, effect }).ok, true,
      "leaving the board resets only this card's scoped presence");
  });
}

test("B03 keeps Root Network's modes on their parent's shared copy limit", () => {
  const effect = required(cardDefinition(412).effects?.find(entry => entry.id === "bloomrot_root_network_recover"));
  assert.equal(effect.oncePerTurnScope, "card");
  assert.equal(effect.activationCases?.length, 2);
  assert.ok(effect.activationCases?.every(entry => !("oncePerTurnScope" in entry)));
});

test("B03 preserves hard OPT and the shared Rot Stag battle limit", () => {
  for (const id of [401, 404, 405, 407, 408, 419]) {
    const definitions = cardDefinition(id).effects ?? [];
    for (const effect of definitions.filter(entry => entry.oncePerTurn && entry.oncePerTurnName)) {
      assert.notEqual(effect.oncePerTurnScope, "card", `${id}/${effect.id}`);
    }
  }
  const battle = (cardDefinition(404).effects ?? []).filter(entry => entry.oncePerTurnName === "bloomrot_rot_stag_battle_spore_boost");
  assert.equal(battle.length, 2);
  assert.equal(battle[0]?.oncePerTurnName, battle[1]?.oncePerTurnName);
});

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const) {
  test(`B03 real Armors protect two independent hosts once each (${seat}/${controller})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, chainResponseTimeoutMs: 0 });
    t.after(() => game.dispose());
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4; game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = controller;
    game.ui.showConfirmPrompt = async () => true; game.ui.showChainResponseModal = async () => null;
    const actor = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
    const hosts = [new Card(cardDefinition(401), seat), new Card(cardDefinition(402), seat)];
    const armors = [new Card(cardDefinition(413), seat), new Card(cardDefinition(413), seat)];
    const pool = new Card(cardDefinition(1), opponent.id); pool.addCounter("spore", 3);
    const payments: number[] = []; game.on("counter_removed", payload => { payments.push(payload.amount); });
    placeFieldCards(actor.field, ...hosts); placeFieldCards(opponent.field, pool); actor.hand.push(...armors);
    for (const [index, equip] of armors.entries()) assert.equal((await game.tryActivateSpell(equip, actor.hand.indexOf(equip),
      { bloomrot_fungal_armor_equip_target: [required(hosts[index])] }, { owner: actor })).success, true);
    for (const target of hosts) {
      const destruction = game.destroyCard(target, { cause: "effect", sourceCard: pool });
      await completeTestSelections(game, destruction);
      const result = await destruction; assert.ok("destroyed" in result); assert.equal(result.destroyed, false);
    }
    assert.equal(pool.getCounter("spore"), 1);
    const final = game.destroyCard(required(hosts[0]), { cause: "effect", sourceCard: pool });
    await completeTestSelections(game, final);
    const result = await final; assert.ok("destroyed" in result); assert.equal(result.destroyed, true);
    assert.deepEqual(payments, [1, 1], "the exhausted protection cannot pay another cost");
  });
}
