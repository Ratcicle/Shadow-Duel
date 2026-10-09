import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../../src/core/Card.js";
import type { CardAction } from "../../src/core/contracts/actions.js";
import type { ReplayDecisionInput } from "../../src/core/contracts/decisions.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

import {
  handleBanish,
  handleRegisterReplacementEffect,
} from "../../src/core/actionHandlers/destruction.js";

type RuntimeCallable = (...arguments_: unknown[]) => unknown;

function isRuntimeCallable(candidate: unknown): candidate is RuntimeCallable {
  return typeof candidate === "function";
}

async function invokeRuntime(
  candidate: unknown,
  argumentsList: unknown[],
): Promise<unknown> {
  assert.equal(isRuntimeCallable(candidate), true);
  if (!isRuntimeCallable(candidate)) throw new TypeError("Expected function.");
  return await Reflect.apply(candidate, undefined, argumentsList);
}

function readProperty(value: unknown, key: string): unknown {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Expected object.");
  }
  return Reflect.get(value, key);
}

test("replacement action fallback preserves every legacy top-level option", async () => {
  const temporaryReplacementEffects: unknown[] = [];
  const player = { id: "player" };
  const opponent = { id: "opponent" };
  const game = {
    player,
    bot: opponent,
    turnCounter: 7,
    temporaryReplacementEffects,
  };
  const action = {
    type: "register_replacement_effect",
    replacementEffect: { type: "prevent_destruction" },
    owner: "opponent",
    id: "legacy-id",
    key: "legacy-key",
    durationTurns: 2,
    usesRemaining: 3,
    sourceName: "Legacy protection",
  };

  const result = await invokeRuntime(handleRegisterReplacementEffect, [
    action,
    { player, opponent },
    {},
    { game },
  ]);

  assert.equal(result, true);
  assert.equal(game.temporaryReplacementEffects.length, 1);
  const registered = game.temporaryReplacementEffects[0];
  assert.equal(readProperty(registered, "id"), "legacy-id");
  assert.equal(readProperty(registered, "uniqueKey"), "legacy-key");
  assert.equal(readProperty(registered, "ownerId"), "opponent");
  assert.equal(readProperty(registered, "usesRemaining"), 3);
  assert.equal(readProperty(registered, "expiresOnTurn"), 9);
});

test("banish tolerates partial players whose zone arrays are absent", async () => {
  const card = { name: "Partial-zone target", owner: "player" };
  const player = { id: "player" };
  const opponent = { id: "opponent" };
  let observedMoveOptions: unknown;
  let boardUpdates = 0;
  const game = {
    player,
    bot: opponent,
    async moveCard(
      _card: unknown,
      _owner: unknown,
      _destination: unknown,
      options: unknown,
    ) {
      observedMoveOptions = options;
      return { success: true };
    },
    updateBoard() {
      boardUpdates += 1;
    },
  };

  const result = await invokeRuntime(handleBanish, [
    { type: "banish", targetRef: "chosen" },
    { player },
    { chosen: [card] },
    { game },
  ]);

  assert.equal(result, true);
  assert.equal(readProperty(observedMoveOptions, "fromZone"), null);
  assert.equal(boardUpdates, 1);
});

function humanSessionGame(t: TestContext, seat: "player" | "bot") {
  const game = createRuntimeGame({ laboratoryMode: true, randomSeed: 31 });
  t.after(() => game.dispose());
  game.turn = seat; game.phase = "main1"; game.turnCounter = 2;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
  owner.controllerType = "human";
  const make = (player = owner) => new Card({ ...cardDefinition(402), effects: [] }, player.id);
  return { game, owner, opponent, make };
}

async function waitForSelection(game: ReturnType<typeof humanSessionGame>["game"]) {
  for (let attempt = 0; attempt < 200 && !game.targetSelection; attempt++) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  return required(game.targetSelection, "human selection session");
}

for (const seat of ["player", "bot"] as const) {
  test(`a human graveyard banish cost uses a recorded selection session (${seat})`, async t => {
    const { game, owner, opponent, make } = humanSessionGame(t, seat);
    const cards = [make(), make(), make()];
    owner.graveyard.push(...cards);
    const decisions: ReplayDecisionInput[] = [];
    game.on("decision_made", decision => { decisions.push(decision); });
    const first = required(cards[0]);
    const action = unsafeFixture<CardAction>({ type: "banish_card_from_graveyard", cardName: first.name,
      cardType: first.type, count: 2 }, "legacy name/type filters still drive the graveyard banish cost");
    const pending = game.effectEngine.applyActions([action], { player: owner, opponent, source: first }, {});
    const session = await waitForSelection(game);
    assert.equal(session.owner, owner);
    const requirement = required(session.requirements[0]);
    assert.deepEqual([requirement.min, requirement.max], [2, 2]);
    session.selections[requirement.id] = requirement.candidates
      .filter(candidate => candidate.cardRef !== first).map(candidate => candidate.key);
    await game.finishTargetSelection();
    await pending;
    assert.deepEqual(owner.graveyard, [first]);
    assert.deepEqual(owner.banished.slice(-2), cards.slice(1));
    assert.deepEqual(decisions.map(decision => [decision.kind, decision.actorId]), [["cost", seat]]);
  });
}

test("a human tie-breaker is a mandatory selection session that cannot be cancelled", async t => {
  const { game, owner, opponent, make } = humanSessionGame(t, "player");
  const first = make(), second = make(), enemy = make(opponent);
  placeFieldCards(owner.field, first, second);
  placeFieldCards(opponent.field, enemy);
  const action: CardAction = { type: "selective_field_destruction", keepPerSide: 1 };
  const pending = game.effectEngine.applyActions([action], { player: owner, opponent, source: first }, {});
  const session = await waitForSelection(game);
  assert.equal(session.allowCancel, false);
  assert.equal(session.preventCancel, true);
  game.cancelTargetSelection();
  assert.equal(game.targetSelection, session);
  const requirement = required(session.requirements[0]);
  session.selections[requirement.id] = requirement.candidates
    .filter(candidate => candidate.cardRef === second).map(candidate => candidate.key);
  await game.finishTargetSelection();
  await pending;
  assert.deepEqual(owner.field, [second]);
  assert.ok(owner.graveyard.includes(first));
  assert.deepEqual(opponent.field, [enemy]);
});

test("a human bounce_and_summon choice uses a mandatory hand selection session", async t => {
  const { game, owner, opponent, make } = humanSessionGame(t, "player");
  const source = make(), first = make(), chosen = make();
  placeFieldCards(owner.field, source);
  owner.hand.push(first, chosen);
  const decisions: ReplayDecisionInput[] = [];
  game.on("decision_made", decision => { decisions.push(decision); });
  const action: CardAction = { type: "bounce_and_summon", bounceSource: true,
    filters: { cardKind: "monster" }, position: "attack" };
  const pending = game.effectEngine.applyActions([action], { player: owner, opponent, source }, {});
  const session = await waitForSelection(game);
  assert.equal(session.preventCancel, true);
  const requirement = required(session.requirements[0]);
  session.selections[requirement.id] = requirement.candidates
    .filter(candidate => candidate.cardRef === chosen).map(candidate => candidate.key);
  await game.finishTargetSelection();
  await pending;
  assert.deepEqual(owner.field, [chosen]);
  assert.ok(owner.hand.includes(source));
  assert.ok(owner.hand.includes(first));
  assert.equal(decisions[0]?.kind, "choice");
});
