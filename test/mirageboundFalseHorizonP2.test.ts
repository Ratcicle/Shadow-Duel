import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { PlayerId } from "../src/core/contracts/primitives.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "./helpers/game.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";

const positionTarget = "miragebound_false_horizon_position_target";
const returnTarget = "miragebound_false_horizon_return_target";
function setup(t: TestContext, seat: PlayerId = "player", controller: "human" | "ai" = "ai") {
  t.mock.method(console, "log", () => {});
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0, randomSeed: 2 });
  t.after(() => game.dispose());
  const owner = game[seat], opponent = game.getOpponent(owner);
  game.turn = opponent.id; game.phase = "battle"; game.turnCounter = 3;
  game.player.controllerType = game.bot.controllerType = "ai"; owner.controllerType = controller;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = game.waitForAiPresentationStep = async () => {};
  game.ui.showConfirmPrompt = async () => false;
  game.ui.showChainResponseModal = async () => null;
  const trap = new Card(cardDefinition(360), owner.id); trap.isFacedown = true; trap.setTurn = 2;
  const own = new Card({ name: "Old return option", cardKind: "monster", archetype: "Miragebound", level: 4, atk: 1000, def: 1000 }, owner.id);
  const foe = new Card({ name: "Attacker", cardKind: "monster", level: 4, atk: 2000, def: 1000 }, opponent.id);
  placeFieldCards(owner.spellTrap, trap); placeFieldCards(owner.field, own); placeFieldCards(opponent.field, foe);
  const context = { type: "attack_declared" as const, event: "attack_declared", attacker: foe, attackerOwner: opponent, player: opponent, triggerPlayer: opponent };
  return { game, owner, opponent, trap, own, foe, context };
}

async function prepare(s: ReturnType<typeof setup>) {
  const { game, owner, trap, context } = s;
  const candidate = required(game.chainSystem.getActivatableCardsInChain(owner, context).find(entry => entry.card === trap));
  const pending = Promise.resolve(game.chainSystem.prepareChainResponse(candidate, owner, context));
  await completeTestSelections(game, pending);
  const result = await pending;
  assert.equal(result.success, true, result.reason || undefined);
  const link = required(game.chainSystem.addToChain(required(result.preparedActivation)));
  assert.ok(link);
  await game.chainSystem.publishChainLinkActivation(link);
  return link;
}

async function resolve(game: RuntimeGame, decline = false) {
  const pending = Promise.resolve(game.chainSystem.resolveChain());
  if (!decline) { await completeTestSelections(game, pending); return; }
  let done = false;
  const completion = pending.then(() => { done = true; });
  for (let attempt = 0; attempt < 3000 && !done; attempt++) {
    if (game.targetSelection?.requirements.some(requirement => requirement.id === returnTarget)) game.cancelTargetSelection();
    await new Promise<void>(r => setTimeout(r, 1));
  }
  assert.equal(done, true); await completion;
}

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const) {
  test(`False Horizon declares only the opponent target and chooses the current own monster at resolution (${seat}, ${controller})`, async t => {
    const s = setup(t, seat, controller);
    const { game, owner, trap, own, foe } = s;
    const targeted: string[] = [];
    game.on("effect_targeted", event => { if (event.source === trap || event.sourceCard === trap) targeted.push(event.target?.name || ""); });
    const link = await prepare(s);
    assert.deepEqual(Object.keys(link.targetSelections), [positionTarget]);
    assert.equal(foe.position, "attack"); assert.ok(owner.field.includes(own));
    await game.moveCard(own, owner, "graveyard", { fromZone: "field" });
    const late = new Card({ name: "Late return option", cardKind: "monster", archetype: "Miragebound", level: 4, atk: 1000, def: 1000 }, owner.id);
    owner.hand.push(late); await game.moveCard(late, owner, "field", { fromZone: "hand", summonOrigin: "effect_resolution", summonMethod: "special" });
    let returnObserved = false;
    game.on("card_moved", event => { if (event.card === late && event.toZone === "hand") { returnObserved = true; assert.equal(event.movedByEffect, true); assert.equal(foe.position, "defense"); } });
    await resolve(game);
    assert.equal(foe.position, "defense"); assert.equal(returnObserved, true); assert.ok(owner.hand.includes(late));
    assert.deepEqual(targeted, ["Attacker"], "the resolution choice is not an activation target");
    assert.ok(owner.graveyard.includes(trap));
  });

  test(`False Horizon allows refusal after a successful position change (${seat}, ${controller})`, async t => {
    const s = setup(t, seat, controller);
    await prepare(s);
    if (controller === "ai") {
      const select = s.game.autoSelector.select.bind(s.game.autoSelector);
      s.game.autoSelector.select = (contract, context) => "requirements" in contract && Array.isArray(contract.requirements) && contract.requirements.some((requirement: { readonly id?: string }) => requirement.id === returnTarget)
        ? { ok: true, selections: { [returnTarget]: [] } } : select(contract, context);
    }
    await resolve(s.game, controller === "human");
    assert.equal(s.foe.position, "defense"); assert.ok(s.owner.field.includes(s.own));
    assert.ok(s.owner.graveyard.includes(s.trap));
  });
}

for (const seat of ["player", "bot"] as const) test(`False Horizon still changes position with no return candidates (${seat})`, async t => {
  const s = setup(t, seat);
  await prepare(s); await s.game.moveCard(s.own, s.owner, "graveyard", { fromZone: "field" });
  await resolve(s.game);
  assert.equal(s.foe.position, "defense"); assert.equal(s.owner.hand.length, 0);
});

for (const failure of ["immunity", "locked", "exit", "exit_return"] as const) test(`False Horizon halts before its optional return when shift fails (${failure})`, async t => {
  const s = setup(t);
  await prepare(s);
  if (failure === "immunity") s.foe.immuneToOpponentEffectsUntilTurn = 3;
  if (failure === "locked") s.foe.battlePositionLocked = true;
  if (failure === "exit" || failure === "exit_return") {
    await s.game.moveCard(s.foe, s.opponent, "graveyard", { fromZone: "field" });
    if (failure === "exit_return") await s.game.moveCard(s.foe, s.opponent, "field", { fromZone: "graveyard", summonOrigin: "effect_resolution", summonMethod: "special" });
  }
  await resolve(s.game);
  assert.ok(s.owner.field.includes(s.own)); assert.equal(s.owner.hand.length, 0);
  assert.equal(s.foe.position, "attack");
});

for (const failure of ["none", "immunity", "locked"] as const) test(`False Horizon simulation gates its optional return on successful position change (${failure})`, () => {
  const trap = simulationCard(cardDefinition(360));
  const own = simulationCard({ id: 99001, name: "Return option", cardKind: "monster", archetype: "Miragebound", atk: 1000, def: 1000 });
  const foe = simulationCard({ id: 99002, name: "Attacker", cardKind: "monster", owner: "player", position: "attack", atk: 2000, def: 1000,
    ...(failure === "locked" ? { battlePositionLocked: true } : failure === "immunity" ? { immuneToOpponentEffectsUntilTurn: 3 } : {}) });
  const state = simulationState({ bot: { field: [own] }, player: { field: [foe] }, turnCounter: 3 });
  const effect = required(trap.effects?.[0]);
  applySimulatedActions({ state, selfId: "bot", actions: effect.actions || [], selections: { [positionTarget]: [foe] }, options: { sourceCard: trap } });
  assert.equal(state.bot.field.length, failure === "none" ? 0 : 1);
  assert.equal(state.bot.hand.length, failure === "none" ? 1 : 0);
  assert.equal(foe.position, failure === "none" ? "defense" : "attack");
});

for (const seat of ["player", "bot"] as const) for (const declined of [false, true]) test(`False Horizon triggers Viper only after its actual effect return (${seat}, declined=${declined})`, async t => {
  const s = setup(t, seat);
  s.owner.field = [];
  s.game.ui.showConfirmPrompt = async () => true;
  const viper = new Card(cardDefinition(356), s.owner.id); placeFieldCards(s.owner.field, viper);
  let returned = 0, activated = 0;
  s.game.on("card_moved", event => { if (event.card === viper && event.fromZone === "field" && event.toZone === "hand") { returned++; assert.equal(event.movedByEffect, true); } });
  s.game.on("effect_activated", event => { if (event.effectId === "miragebound_glass_viper_returned_to_hand") activated++; });
  await prepare(s);
  if (declined) {
    const select = s.game.autoSelector.select.bind(s.game.autoSelector);
    s.game.autoSelector.select = (contract, context) => "requirements" in contract && Array.isArray(contract.requirements) && contract.requirements.some((requirement: { readonly id?: string }) => requirement.id === returnTarget)
      ? { ok: true, selections: { [returnTarget]: [] } } : select(contract, context);
  }
  await resolve(s.game);
  await completeTestSelections(s.game, Promise.resolve(s.game.flushPendingTriggerOccurrences({ reason: "false_horizon_test" })));
  assert.equal(returned, declined ? 0 : 1);
  assert.equal(activated, declined ? 0 : 1);
});
