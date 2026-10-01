import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { PlayerId } from "../src/core/contracts/primitives.js";
import type { ReplayDecisionInput } from "../src/core/contracts/decisions.js";
import type { ReplayDriverGamePort } from "../src/core/contracts/replay.js";
import { validateCanonicalReplay } from "../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../src/core/game/replay/driver.js";
import { installReplayCommandCaptureBindings } from "../src/core/game/replay/capture.js";
import { performAscensionSummonFromExtraDeck } from "../src/core/game/extraDeck/modal.js";
import { cardDefinition, required, unsafeFixture } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "./helpers/game.js";

type Entry = "material" | "extraDeck";

function populate(game: RuntimeGame, entry: Entry, count: number, seat: PlayerId, controller?: "human" | "ai") {
  game.phase = "main1";
  game.turn = seat;
  game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  const owner = game[seat];
  if (controller) owner.controllerType = controller;
  owner.field = [];
  owner.extraDeck = [];
  owner.graveyard = [];
  const materials = Array.from({ length: entry === "extraDeck" ? count : 1 }, () => {
    const card = new Card(cardDefinition("Armored Dragon"), seat);
    card.summonedTurn = 0;
    game.ensureDuelCardId(card);
    placeFieldCards(owner.field, card);
    return card;
  });
  const ascensions = Array.from({ length: entry === "material" ? count : 1 }, () => {
    const card = new Card(cardDefinition("Metal Armored Dragon"), seat);
    card.ascension = { ...required(card.ascension), position: "attack" };
    game.ensureDuelCardId(card);
    owner.extraDeck.push(card);
    return card;
  });
  return { owner, materials, ascensions };
}

function setup(t: TestContext, entry: Entry, count = 1, seat: PlayerId = "player") {
  t.mock.method(console, "log", () => {});
  const game = createRuntimeGame({ disableChains: true, captureReplay: false, randomSeed: 904 });
  t.after(() => game.dispose());
  return { game, ...populate(game, entry, count, seat, "human") };
}

function begin(game: RuntimeGame, entry: Entry, seat: PlayerId) {
  const owner = game[seat];
  return entry === "material"
    ? game.tryAscensionSummon(required(owner.field[0]), { player: owner })
    : game.performAscensionSummonFromExtraDeck(required(owner.extraDeck[0]), owner);
}

for (const entry of ["material", "extraDeck"] as const) {
  for (const seat of ["player", "bot"] as const) {
    for (const count of [1, 2]) {
      test(`human ${entry} Ascension waits for and records a choice (${seat}, ${count} candidates)`, async t => {
        const { game, owner, materials, ascensions } = setup(t, entry, count, seat);
        const decisions: ReplayDecisionInput[] = [];
        game.on("decision_made", decision => { decisions.push(decision); });
        const pending = begin(game, entry, seat);
        const selection = required(game.targetSelection);
        const requirement = required(selection.requirements[0]);
        assert.equal(requirement.candidates.length, count);
        assert.deepEqual(owner.field, materials, "opening the choice must not pay the material");
        assert.deepEqual(owner.extraDeck, ascensions);
        assert.equal(owner.graveyard.length, 0);
        assert.equal(selection.allowCancel, true);
        // Let the Extra Deck command wrapper attach its deferred descriptor.
        if (entry === "extraDeck") {
          const result = await pending;
          assert.ok("needsSelection" in result && result.needsSelection === true);
        }
        selection.selections[requirement.id] = [required(requirement.candidates.at(-1)).key];
        await game.finishTargetSelection();
        if (entry === "material") assert.equal((await pending).success, true);
        const chosenMaterial = required(materials.at(entry === "extraDeck" ? -1 : 0));
        const chosenAscension = required(ascensions.at(entry === "material" ? -1 : 0));
        assert.ok(owner.graveyard.includes(chosenMaterial));
        assert.ok(owner.field.includes(chosenAscension));
        assert.equal(game.targetSelection, null);
        assert.equal(decisions.filter(decision => decision.kind === "ascension").length, 1);
      });
    }
  }

  for (const count of [1, 2]) {
    test(`cancelling ${entry} Ascension preserves all cards (${count} candidates)`, async t => {
      const { game, owner, materials, ascensions } = setup(t, entry, count);
      const pending = begin(game, entry, "player");
      assert.ok(game.targetSelection);
      if (entry === "extraDeck") await pending;
      game.cancelTargetSelection();
      if (entry === "material") assert.equal((await pending).success, false);
      assert.deepEqual(owner.field, materials);
      assert.deepEqual(owner.extraDeck, ascensions);
      assert.equal(owner.graveyard.length, 0);
      assert.equal(game.targetSelection, null);
    });
  }

  test(`an inert UI cannot authorize a single ${entry} Ascension`, async t => {
    const { game, owner, materials, ascensions } = setup(t, entry);
    const pending = begin(game, entry, "player");
    if (entry === "extraDeck") await pending;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(owner.field, materials);
    assert.deepEqual(owner.extraDeck, ascensions);
    assert.equal(owner.graveyard.length, 0);
    assert.ok(game.targetSelection);
    game.cancelTargetSelection();
    await pending;
  });

  for (const seat of ["player", "bot"] as const) {
    test(`AI keeps the single ${entry} Ascension shortcut (${seat})`, async t => {
      const { game, owner, materials, ascensions } = setup(t, entry, 1, seat);
      owner.controllerType = "ai";
      assert.equal((await begin(game, entry, seat)).success, true);
      assert.ok(owner.graveyard.includes(required(materials[0])));
      assert.ok(owner.field.includes(required(ascensions[0])));
      assert.equal(game.targetSelection, null);
    });

    for (const count of [1, 2]) {
      test(`human ${entry} Ascension replays its choice with one command and the same hash (${seat}, ${count} candidates)`, async t => {
        t.mock.method(console, "log", () => {});
        const live = createRuntimeGame({ disableChains: true, captureReplay: true, randomSeed: 904 });
        const playback = createRuntimeGame({ disableChains: true, captureReplay: false, replayMode: "playback", randomSeed: 904 });
        t.after(() => { live.dispose(); playback.dispose(); });
        for (const game of [live, playback]) {
          const start = game.startWithDecks.bind(game);
          game.startWithDecks = async options => {
            await start(options);
            populate(game, entry, count, seat, game === live ? "human" : undefined);
          };
        }
        playback.ui.showTargetSelection = () => assert.fail("playback cannot ask for a choice");
        playback.ui.showFieldTargetingControls = () => assert.fail("playback cannot ask for a material");
        await live.startWithDecks({ exactDecks: true, initializeOnly: true, startAtDrawPhase: true,
          announceStartingPlayer: false, startingPlayer: "player", playerDeck: [1, 2, 3, 4, 5, 6],
          botDeck: [1, 2, 3, 4, 5, 6], playerExtraDeck: [], botExtraDeck: [] });
        const pending = begin(live, entry, seat);
        const selection = required(live.targetSelection);
        if (entry === "extraDeck") await pending;
        const requirement = required(selection.requirements[0]);
        selection.selections[requirement.id] = [required(requirement.candidates.at(-1)).key];
        await live.finishTargetSelection();
        await pending;
        const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "ascension-choice" }))));
        assert.equal(replay.commands.length, 1);
        assert.equal(replay.commands[0]?.type, "extra_deck_summon");
        assert.equal(replay.decisions.filter(decision => decision.kind === "ascension").length, 1);
        const result = await replayCanonicalDuel(replay, {
          game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game implements the replay driver runtime port."),
        });
        assert.equal(result.ok, true);
        assert.equal(result.finalStateHash, replay.result?.finalStateHash);
        assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
      });
    }
  }

  test(`cancelled ${entry} Ascension records no command or decision`, async t => {
    t.mock.method(console, "log", () => {});
    const game = createRuntimeGame({ disableChains: true, captureReplay: true, randomSeed: 904 });
    t.after(() => game.dispose());
    await game.startWithDecks({ exactDecks: true, initializeOnly: true, startAtDrawPhase: true,
      announceStartingPlayer: false, startingPlayer: "player", playerDeck: [1, 2, 3, 4, 5, 6],
      botDeck: [1, 2, 3, 4, 5, 6], playerExtraDeck: [], botExtraDeck: [] });
    populate(game, entry, 1, "player");
    const pending = begin(game, entry, "player");
    assert.ok(game.targetSelection);
    if (entry === "extraDeck") await pending;
    game.cancelTargetSelection();
    await pending;
    const replay = required(game.finalizeReplay({ reason: "cancelled-ascension" }));
    assert.equal(replay.commands.length, 0);
    assert.equal(replay.decisions.length, 0);
  });
}

test("an explicit human material keeps the previous choice", async t => {
  const { game, owner, materials, ascensions } = setup(t, "extraDeck", 2);
  const result = await game.performAscensionSummonFromExtraDeck(required(ascensions[0]), owner, { material: required(materials[1]) });
  assert.equal(result.success, true);
  assert.ok(owner.field.includes(required(materials[0])));
  assert.ok(owner.graveyard.includes(required(materials[1])));
  assert.equal(game.targetSelection, null);
});

for (const confirm of [false, true]) {
  test(`capture preserves an asynchronously opened selection (${confirm ? "confirm" : "cancel"})`, async t => {
    t.mock.method(console, "log", () => {});
    const game = createRuntimeGame({ disableChains: true, captureReplay: true, randomSeed: 904 });
    t.after(() => game.dispose());
    await game.startWithDecks({ exactDecks: true, initializeOnly: true, startAtDrawPhase: true,
      announceStartingPlayer: false, startingPlayer: "player", playerDeck: [1, 2, 3, 4, 5, 6],
      botDeck: [1, 2, 3, 4, 5, 6], playerExtraDeck: [], botExtraDeck: [] });
    const { owner, materials, ascensions } = populate(game, "extraDeck", 1, "player");
    game.performAscensionSummonFromExtraDeck = async (...args) => {
      await new Promise<void>(resolve => setImmediate(resolve));
      const host = unsafeFixture<ThisParameterType<typeof performAscensionSummonFromExtraDeck>>(
        game, "The real Ascension entrypoint uses Game's concrete methods; its wider Extra Deck AutoSelector port is unused by this human fixture.",
      );
      return performAscensionSummonFromExtraDeck.call(host, ...args);
    };
    installReplayCommandCaptureBindings(game);
    const pending = begin(game, "extraDeck", "player");
    const readSelection = () => game.targetSelection;
    assert.equal(readSelection(), null);
    await pending;
    const selection = required(game.targetSelection);
    assert.ok(selection.replayCommandDescriptor);
    if (confirm) {
      const requirement = required(selection.requirements[0]);
      selection.selections[requirement.id] = [required(requirement.candidates[0]).key];
      await game.finishTargetSelection();
      assert.ok(owner.field.includes(required(ascensions[0])));
    } else {
      game.cancelTargetSelection();
      assert.deepEqual(owner.field, materials);
    }
    const replay = required(game.finalizeReplay({ reason: "async-selection" }));
    assert.equal(replay.commands.length, confirm ? 1 : 0);
    assert.equal(replay.decisions.filter(decision => decision.kind === "ascension").length, confirm ? 1 : 0);
  });
}

for (const entry of ["material", "extraDeck"] as const) {
  test(`AI ${entry} singleton replays with a human controller without adding a choice`, async t => {
    t.mock.method(console, "log", () => {});
    const live = createRuntimeGame({ disableChains: true, captureReplay: true, randomSeed: 904 });
    const playback = createRuntimeGame({ disableChains: true, replayMode: "playback", randomSeed: 904 });
    t.after(() => { live.dispose(); playback.dispose(); });
    for (const game of [live, playback]) {
      const start = game.startWithDecks.bind(game);
      game.startWithDecks = async options => {
        await start(options);
        populate(game, entry, 1, "player", game === live ? "ai" : undefined);
      };
    }
    playback.ui.showTargetSelection = () => assert.fail("playback cannot ask for a choice");
    playback.ui.showFieldTargetingControls = () => assert.fail("playback cannot ask for a material");
    await live.startWithDecks({ exactDecks: true, initializeOnly: true, startAtDrawPhase: true,
      announceStartingPlayer: false, startingPlayer: "player", playerDeck: [1, 2, 3, 4, 5, 6],
      botDeck: [1, 2, 3, 4, 5, 6], playerExtraDeck: [], botExtraDeck: [] });
    assert.equal((await begin(live, entry, "player")).success, true);
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "ai-ascension" }))));
    assert.equal(replay.commands.length, 1);
    assert.equal(replay.decisions.filter(decision => decision.kind === "ascension").length, 0);
    const result = await replayCanonicalDuel(replay, {
      game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game implements the replay driver runtime port."),
    });
    assert.equal(playback.player.controllerType, "human");
    assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
  });
}

test("scenario replacement settles a pending Ascension choice without summoning into the new field", async t => {
  const { game } = setup(t, "material", 2);
  let settled = false;
  const pending = begin(game, "material", "player").then(value => { settled = true; return value; });
  assert.ok(game.targetSelection);
  game.applyScenarioSetup({ phase: "main1", player: { field: [{ id: 1 }], extraDeck: [] } });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, true);
  assert.equal((await pending).success, false);
  assert.deepEqual(game.player.field.map(card => card.id), [1]);
  assert.equal(game.targetSelection, null);
});
