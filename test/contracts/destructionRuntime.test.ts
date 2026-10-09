import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../../src/core/Card.js";
import type { ActionOf, CardAction } from "../../src/core/contracts/actions.js";
import type { ReplayDecisionInput } from "../../src/core/contracts/decisions.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

import {
  handleBanish,
  handleBanishCardFromGraveyard,
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

interface GraveyardTestCard {
  readonly name: string;
  readonly type?: string;
  readonly cardKind: string;
}

interface GraveyardTestPlayer {
  readonly id: string;
  readonly controllerType: "human" | "ai";
  readonly graveyard: GraveyardTestCard[];
  readonly banished: GraveyardTestCard[];
}

interface GraveyardTestSession {
  readonly selectionContract: {
    readonly requirements: ReadonlyArray<{
      readonly id: string;
      readonly min: unknown;
      readonly max: unknown;
      readonly candidates: ReadonlyArray<{ readonly key: string }>;
    }>;
  };
  readonly execute: (selections: Record<string, readonly string[]>) => unknown;
  readonly onCancel: () => void;
}

function createGraveyardTestPlayer(
  id: string,
  controllerType: "human" | "ai",
  graveyard: GraveyardTestCard[] = [],
): GraveyardTestPlayer {
  return { id, controllerType, graveyard, banished: [] };
}

function createGraveyardBanishGame(
  player: GraveyardTestPlayer,
  opponent = createGraveyardTestPlayer("opponent", "ai"),
  chooseKeys?: (candidateKeys: readonly string[]) => readonly string[],
) {
  const moves: Array<{
    card: unknown;
    owner: unknown;
    destination: unknown;
    options: unknown;
  }> = [];
  const offeredRanges: Array<{ min: unknown; max: unknown }> = [];
  const game = {
    player,
    bot: opponent,
    async moveCard(
      card: GraveyardTestCard,
      owner: GraveyardTestPlayer,
      destination: unknown,
      options: unknown,
    ) {
      moves.push({ card, owner, destination, options });
      const index = owner.graveyard.indexOf(card);
      if (index >= 0) owner.graveyard.splice(index, 1);
      owner.banished.push(card);
      return { success: true };
    },
    buildSelectionCandidateKey(_candidate: unknown, index: number) {
      return `candidate_${index}`;
    },
    startTargetSelectionSession(session: GraveyardTestSession) {
      const [requirement] = session.selectionContract.requirements;
      if (!requirement || !chooseKeys) {
        session.onCancel();
        return;
      }
      offeredRanges.push({ min: requirement.min, max: requirement.max });
      session.execute({
        [requirement.id]: chooseKeys(
          requirement.candidates.map((entry) => entry.key),
        ),
      });
    },
    updateBoard() {},
  };
  return { game, moves, offeredRanges };
}

test("graveyard banish without cardType does not filter by the action type", async () => {
  const spell = { name: "Spent Spell", cardKind: "spell" };
  const player = createGraveyardTestPlayer("player", "human", [spell]);
  const { game, moves } = createGraveyardBanishGame(player);
  const action = {
    type: "banish_card_from_graveyard",
  } satisfies ActionOf<"banish_card_from_graveyard">;

  const result = await invokeRuntime(handleBanishCardFromGraveyard, [
    action,
    { player },
    {},
    { game },
  ]);

  assert.equal(result, true);
  assert.equal(moves.length, 1);
  assert.equal(moves[0]?.card, spell);
  assert.equal(moves[0]?.destination, "banished");
  assert.equal(readProperty(moves[0]?.options, "fromZone"), "graveyard");
  assert.deepEqual(player.graveyard, []);
});

test("graveyard banish cardName and cardType restrict the candidates", async () => {
  const dragon = { name: "Ash Dragon", type: "Dragon", cardKind: "monster" };
  const otherDragon = { name: "Coal Dragon", type: "Dragon", cardKind: "monster" };
  const warrior = { name: "Ash Dragon", type: "Warrior", cardKind: "monster" };
  const player = createGraveyardTestPlayer("player", "human", [
    warrior,
    otherDragon,
    dragon,
  ]);
  const { game, moves } = createGraveyardBanishGame(player);
  const action = {
    type: "banish_card_from_graveyard",
    cardName: "Ash Dragon",
    cardType: "Dragon",
    count: 1,
  } satisfies ActionOf<"banish_card_from_graveyard">;

  const result = await invokeRuntime(handleBanishCardFromGraveyard, [
    action,
    { player },
    {},
    { game },
  ]);

  assert.equal(result, true);
  assert.deepEqual(
    moves.map((move) => move.card),
    [dragon],
  );
  assert.deepEqual(player.graveyard, [warrior, otherDragon]);
});

test("graveyard banish merges shorthand fields into filters, explicit filters first", async () => {
  const dragon = { name: "Ash Dragon", type: "Dragon", cardKind: "monster" };
  const player = createGraveyardTestPlayer("player", "human", [dragon]);
  const { game, moves } = createGraveyardBanishGame(player);
  const observedFilters: unknown[] = [];
  const engine = {
    game,
    cardMatchesFilters(_card: unknown, filters: unknown) {
      observedFilters.push(filters);
      return true;
    },
  };
  const action = {
    type: "banish_card_from_graveyard",
    filters: { cardKind: "monster", type: "Dragon" },
    cardName: "Ash Dragon",
    cardType: "Warrior",
  } satisfies ActionOf<"banish_card_from_graveyard">;

  const result = await invokeRuntime(handleBanishCardFromGraveyard, [
    action,
    { player },
    {},
    engine,
  ]);

  assert.equal(result, true);
  assert.equal(moves.length, 1);
  assert.deepEqual(observedFilters, [
    { cardKind: "monster", type: "Dragon", name: "Ash Dragon" },
  ]);
});

test("graveyard banish fails without moving cards when candidates are short", async () => {
  const spell = { name: "Spent Spell", cardKind: "spell" };
  const player = createGraveyardTestPlayer("player", "human", [spell]);
  const { game, moves } = createGraveyardBanishGame(player);
  const action = {
    type: "banish_card_from_graveyard",
    cardType: "Dragon",
  } satisfies ActionOf<"banish_card_from_graveyard">;

  const result = await invokeRuntime(handleBanishCardFromGraveyard, [
    action,
    { player },
    {},
    { game },
  ]);

  assert.equal(result, false);
  assert.equal(moves.length, 0);
  assert.deepEqual(player.graveyard, [spell]);
});

test("graveyard banish player scope reads and moves from the opponent graveyard", async () => {
  const ownCard = { name: "Own card", cardKind: "monster" };
  const opposingCard = { name: "Opposing card", cardKind: "monster" };
  const player = createGraveyardTestPlayer("player", "human", [ownCard]);
  const opponent = createGraveyardTestPlayer("opponent", "ai", [opposingCard]);
  const { game, moves } = createGraveyardBanishGame(player, opponent);
  const action = {
    type: "banish_card_from_graveyard",
    player: "opponent",
  } satisfies ActionOf<"banish_card_from_graveyard">;

  const result = await invokeRuntime(handleBanishCardFromGraveyard, [
    action,
    { player, opponent },
    {},
    { game },
  ]);

  assert.equal(result, true);
  assert.deepEqual(
    moves.map((move) => [move.card, move.owner]),
    [[opposingCard, opponent]],
  );
  assert.deepEqual(player.graveyard, [ownCard]);
  assert.deepEqual(opponent.banished, [opposingCard]);
});

test("graveyard banish count range lets the human choose through the selection session", async () => {
  const first = { name: "First", cardKind: "monster" };
  const second = { name: "Second", cardKind: "monster" };
  const third = { name: "Third", cardKind: "monster" };
  const player = createGraveyardTestPlayer("player", "human", [
    first,
    second,
    third,
  ]);
  const { game, moves, offeredRanges } = createGraveyardBanishGame(
    player,
    undefined,
    (keys) => [required(keys[1])],
  );
  const action = {
    type: "banish_card_from_graveyard",
    count: { min: 1, max: 2 },
  } satisfies ActionOf<"banish_card_from_graveyard">;

  const result = await invokeRuntime(handleBanishCardFromGraveyard, [
    action,
    { player },
    {},
    { game },
  ]);

  assert.equal(result, true);
  assert.deepEqual(offeredRanges, [{ min: 1, max: 2 }]);
  assert.deepEqual(
    moves.map((move) => move.card),
    [second],
  );
  assert.deepEqual(player.graveyard, [first, third]);
});

test("graveyard banish count range across both graveyards resolves the AI one card at a time", async () => {
  const ownCard = { name: "Own card", cardKind: "monster" };
  const opposingCard = { name: "Opposing card", cardKind: "monster" };
  const player = createGraveyardTestPlayer("bot", "ai", [ownCard]);
  const opponent = createGraveyardTestPlayer("player", "human", [opposingCard]);
  const { game, moves } = createGraveyardBanishGame(player, opponent);
  const action = {
    type: "banish_card_from_graveyard",
    player: "both",
    count: { min: 1, max: 3 },
  } satisfies ActionOf<"banish_card_from_graveyard">;

  const result = await invokeRuntime(handleBanishCardFromGraveyard, [
    action,
    { player, opponent },
    {},
    { game },
  ]);

  assert.equal(result, true);
  assert.deepEqual(
    moves.map((move) => [move.card, move.owner]),
    [
      [ownCard, player],
      [opposingCard, opponent],
    ],
  );
});

test("graveyard banish fails when the human cancels a required choice", async () => {
  const first = { name: "First", cardKind: "monster" };
  const second = { name: "Second", cardKind: "monster" };
  const player = createGraveyardTestPlayer("player", "human", [first, second]);
  const { game, moves } = createGraveyardBanishGame(player);
  const action = {
    type: "banish_card_from_graveyard",
    count: 1,
  } satisfies ActionOf<"banish_card_from_graveyard">;

  const result = await invokeRuntime(handleBanishCardFromGraveyard, [
    action,
    { player },
    {},
    { game },
  ]);

  assert.equal(result, false);
  assert.equal(moves.length, 0);
  assert.deepEqual(player.graveyard, [first, second]);
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
    const action = { type: "banish_card_from_graveyard", cardName: first.name,
      cardType: required(first.type), count: 2 } satisfies ActionOf<"banish_card_from_graveyard">;
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
