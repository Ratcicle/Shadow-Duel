import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import type { CardAction } from "../../src/core/contracts/actions.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

function prepare(game: RuntimeGame, name: string, actions: readonly CardAction[]) {
  const effect = { id: name, timing: "on_activate" as const, actions };
  const card = new Card({ name, cardKind: "spell", subtype: "normal", effects: [effect] }, "player");
  placeFieldCards(game.player.spellTrap, card);
  return game.chainSystem.createPreparedActivation({ card, controller: game.player, effect,
    activationZone: "spellTrap", committed: true, costsPaid: true });
}

async function waitForSelection(game: RuntimeGame) {
  for (let attempt = 0; attempt < 100 && !game.targetSelection; attempt++) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.ok(game.targetSelection);
}

test("scenario replacement aborts the old Chain before its remaining link can draw from new state", async t => {
  const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
  t.after(() => game.dispose());
  game.disablePresentationDelays = true;
  game.applyScenarioSetup({ phase: "main1", player: { hand: [{ id: 1 }] }, bot: {} });
  const lower = prepare(game, "lower", [{ type: "draw", amount: 1 }]);
  const upper = prepare(game, "upper", [{ type: "optional_target_actions", optional: true, allowCancel: false,
    targets: [{ id: "pick", owner: "self", zone: "hand", cardKind: "monster", count: { min: 1, max: 1 } }],
    actions: [{ type: "draw", amount: 1 }] }]);
  const pending = Promise.resolve(game.chainSystem.openChainWindow({ type: "card_activation" },
    { firstPlayer: game.bot, secondPlayer: game.player, preparedActivations: [lower, upper] }));
  await waitForSelection(game);
  assert.equal(game.chainSystem.chainStack.length, 1);
  game.applyScenarioSetup({ phase: "main1", player: { hand: [], deck: [{ id: 3 }] }, bot: {} });
  await pending;
  assert.deepEqual(game.player.hand, []);
  assert.deepEqual(game.player.deck.map(card => card.id), [3]);
  assert.equal(game.chainSystem.chainWindowOpen, false);
  assert.equal(game.chainSystem.isResolving, false);
  assert.equal(game.chainSystem.pendingChainSelection, null);
  assert.equal(game.chainSystem.currentResolvingLink, null);
  await game.nextPhase();
  assert.equal(game.phase, "battle");
});

test("scenario replacement settles a shared resolution choice and releases phase progression", async t => {
  const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
  t.after(() => game.dispose());
  game.disablePresentationDelays = true;
  game.applyScenarioSetup({ phase: "main1", player: { deck: [{ id: 1 }, { id: 3 }] }, bot: {} });
  const prepared = prepare(game, "search", [{ type: "add_from_zone_to_hand", zone: "deck", player: "self",
    filters: { cardKind: "monster" }, count: { min: 1, max: 1 }, promptPlayer: true }]);
  let settled = false;
  const pending = Promise.resolve(game.chainSystem.openChainWindow({ type: "card_activation" },
    { firstPlayer: game.bot, secondPlayer: game.player, preparedActivations: [prepared] })).then(value => { settled = true; return value; });
  await waitForSelection(game);
  game.applyScenarioSetup({ phase: "main1", player: { hand: [], deck: [{ id: 3 }] }, bot: {} });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, true);
  const result = await pending;
  assert.ok(result);
  assert.equal(result.success, false);
  assert.equal(game.chainSystem.chainWindowOpen, false);
  assert.equal(game.chainSystem.pendingChainSelection, null);
  assert.deepEqual(game.player.hand, []);
  await game.nextPhase();
  assert.equal(game.phase, "battle");
});

test("legacy needsSelection Chain producer receives systemic abort and settles its window", async t => {
  const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
  t.after(() => game.dispose());
  game.disablePresentationDelays = true;
  game.applyScenarioSetup({ phase: "main1", player: {}, bot: {} });
  const prepared = prepare(game, "legacy-choice", [{ type: "draw", amount: 1 }]);
  // Supply the supported legacy producer result; Chain/session/window remain real.
  t.mock.method(game.effectEngine, "applyActions", () => ({ success: false, needsSelection: true,
    selectionContract: { kind: "choice", requirements: [{ id: "choice", min: 1, max: 1,
      zone: "choice", candidates: [{ key: "yes", zone: "choice" }] }] } }));
  let settled = false;
  const pending = Promise.resolve(game.chainSystem.openChainWindow({ type: "card_activation" },
    { firstPlayer: game.bot, secondPlayer: game.player, preparedActivations: [prepared] })).then(value => { settled = true; return value; });
  await waitForSelection(game);
  assert.ok(game.chainSystem.pendingChainSelection);
  game.applyScenarioSetup({ phase: "main1", player: {}, bot: {} });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, true);
  const result = await pending;
  assert.ok(result);
  assert.equal(result.success, false);
  assert.equal(game.chainSystem.pendingChainSelection, null);
  assert.equal(game.chainSystem.chainWindowOpen, false);
});

test("systemic force-clear retires the Chain even without replacing the scenario", async t => {
  const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
  t.after(() => game.dispose());
  game.disablePresentationDelays = true;
  game.applyScenarioSetup({ phase: "main1", player: { hand: [{ id: 1 }], deck: [{ id: 3 }] }, bot: {} });
  const prepared = prepare(game, "forced-cleanup", [{ type: "optional_target_actions", optional: true, allowCancel: false,
    targets: [{ id: "pick", owner: "self", zone: "hand", cardKind: "monster", count: { min: 1, max: 1 } }],
    actions: [{ type: "draw", amount: 1 }] }]);
  const pending = game.chainSystem.openChainWindow({ type: "card_activation" },
    { firstPlayer: game.bot, secondPlayer: game.player, preparedActivations: [prepared] });
  await waitForSelection(game);
  game.devForceTargetCleanup();
  await pending;
  assert.equal(game.chainSystem.chainWindowOpen, false);
  assert.equal(game.chainSystem.isResolving, false);
  assert.equal(game.chainSystem.currentResolvingLink, null);
  assert.equal(game.chainSystem.pendingChainSelection, null);
  assert.deepEqual(game.player.deck.map(card => card.id), [3]);
  await game.nextPhase();
  assert.equal(game.phase, "battle");
});

test("an aborted old window cannot clear a new Chain opened before its continuation settles", async t => {
  const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
  t.after(() => game.dispose());
  game.disablePresentationDelays = true;
  game.applyScenarioSetup({ phase: "main1", player: { hand: [{ id: 1 }] }, bot: {} });
  const old = prepare(game, "old", [{ type: "optional_target_actions", optional: true, allowCancel: false,
    targets: [{ id: "pick", owner: "self", zone: "hand", cardKind: "monster", count: { min: 1, max: 1 } }],
    actions: [{ type: "draw", amount: 1 }] }]);
  const oldWindow = game.chainSystem.openChainWindow({ type: "card_activation" },
    { firstPlayer: game.bot, secondPlayer: game.player, preparedActivations: [old] });
  await waitForSelection(game);
  game.applyScenarioSetup({ phase: "main1", player: { deck: [{ id: 1 }, { id: 1 }] }, bot: {} });
  const next = prepare(game, "new", [{ type: "add_from_zone_to_hand", zone: "deck", player: "self",
    filters: { cardKind: "monster" }, count: { min: 1, max: 1 }, promptPlayer: true }]);
  const nextWindow = game.chainSystem.openChainWindow({ type: "card_activation" },
    { firstPlayer: game.bot, secondPlayer: game.player, preparedActivations: [next] });
  await oldWindow;
  await waitForSelection(game);
  assert.equal(game.chainSystem.chainWindowOpen, true);
  const selection = game.targetSelection;
  assert.ok(selection);
  const requirement = selection.requirements[0];
  assert.ok(requirement);
  const candidate = requirement.candidates[0];
  assert.ok(candidate);
  selection.selections[requirement.id] = [candidate.key];
  await game.finishTargetSelection();
  const result = await nextWindow;
  assert.ok(result);
  assert.equal(result.success, true);
  assert.equal(game.player.hand.length, 1);
});
