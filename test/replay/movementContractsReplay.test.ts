import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_REPLAY_ENGINE_VERSION, type ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Scenario = "field-replacement" | "refused-bounce";
function install(game: RuntimeGame, seat: "player" | "bot", scenario: Scenario) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "human";
    const owner = game[seat], opponent = game.getOpponent(owner);
    for (const player of [owner, opponent]) player.deck.push(...player.hand.splice(0));
    const take = (player: Pick<typeof owner, "deck" | "extraDeck">, id: number) => {
      const zone = player.deck.some(card => card.id === id) ? player.deck : player.extraDeck;
      const card = required(zone.find(card => card.id === id));
      zone.splice(zone.indexOf(card), 1);
      card.isFacedown = false; card.position = "attack";
      return card;
    };
    if (scenario === "field-replacement") owner.hand.push(take(owner, 217), take(owner, 115));
    else {
      placeFieldCards(owner.field, take(owner, 351), take(owner, 355));
      const target = take(opponent, 501);
      target.banishWhenLeavesField = true;
      placeFieldCards(opponent.field, target, take(opponent, 514));
    }
  };
}

for (const scenario of ["field-replacement", "refused-bounce"] as const) {
  for (const seat of ["player", "bot"] as const) {
    test(`canonical movement replay (${scenario}/${seat})`, async t => {
      const live = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: true,
        chainResponseTimeoutMs: 0, randomSeed: 6701 });
      const playback = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false,
        chainResponseTimeoutMs: 0, replayMode: "playback" });
      t.after(() => { live.dispose(); playback.dispose(); });
      install(live, seat, scenario); install(playback, seat, scenario);
      live.ui.showChainResponseModal = async () => null;
      playback.ui.showChainResponseModal = async () => assert.fail("Playback cannot ask for responses");
      playback.ui.showTargetSelection = () => assert.fail("Playback cannot ask for targets");
      playback.autoSelector.select = () => assert.fail("Playback cannot choose new targets");
      const deck = [217, 115, 351, 355, 501, 514, ...Array<number>(14).fill(3)];
      await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
        startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
        playerDeck: deck, botDeck: deck, playerExtraDeck: [355, 514], botExtraDeck: [355, 514] });
      const owner = live[seat], opponent = live.getOpponent(owner);
      if (scenario === "field-replacement") {
        const previous = required(owner.hand.find(card => card.id === 217));
        const incoming = required(owner.hand.find(card => card.id === 115));
        for (const card of [previous, incoming]) {
          assert.equal((await live.tryActivateSpell(card, owner.hand.indexOf(card), null, { owner })).success, true);
        }
        assert.equal(owner.fieldSpell, incoming);
        assert.deepEqual(owner.graveyard, [previous]);
      } else {
        const source = required(owner.field.find(card => card.id === 355));
        const target = required(opponent.field.find(card => card.id === 501));
        const activation = live.tryActivateMonsterEffect(source, null, "field", owner,
          { effectId: "miragebound_glass_sovereign_bounce" });
        await completeTestSelections(live, activation);
        // Public activation may return the selection handoff; assert the resolved state.
        await activation;
        assert.ok(owner.hand.some(card => card.id === 351));
        assert.ok(opponent.field.includes(target));
        assert.equal(target.locationVersion, 0);
        assert.equal(opponent.hand.includes(target), false);
      }
      const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: scenario }))));
      assert.equal(replay.engineVersion, CANONICAL_REPLAY_ENGINE_VERSION);
      assert.equal(replay.schemaVersion, 2);
      assert.ok(replay.commands.length > 0);
      const result = await replayCanonicalDuel(replay, {
        game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game implements canonical replay runtime ports."),
      });
      assert.equal(result.ok, true);
      assert.equal(result.finalStateHash, replay.result?.finalStateHash);
      assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
      assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
    });
  }
}

type PreacherCase = { controller: "human" | "ai"; accept: boolean };
const PREACHER_CASES: readonly PreacherCase[] = [
  { controller: "human", accept: true },
  { controller: "human", accept: false },
  { controller: "ai", accept: true },
  { controller: "ai", accept: false },
];

function installPreacher(game: RuntimeGame, seat: "player" | "bot", scenario: PreacherCase) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "human";
    const owner = game[seat], opponent = game.getOpponent(owner);
    owner.controllerType = scenario.controller;
    Reflect.set(owner, "strategy", {
      ...owner.strategy,
      shouldUseReplacementEffect: () => game.replayMode === "playback"
        ? assert.fail("Playback must consume the recorded replacement choice") : scenario.accept,
    });
    for (const player of [owner, opponent]) player.deck.push(...player.hand.splice(0));
    const take = (id: number) => {
      const card = required(owner.deck.find(card => card.id === id));
      owner.deck.splice(owner.deck.indexOf(card), 1);
      card.isFacedown = false; card.position = "attack";
      return card;
    };
    placeFieldCards(owner.field, take(460), take(451));
    owner.hand.push(take(453));
  };
}

for (const scenario of PREACHER_CASES) {
  for (const seat of ["player", "bot"] as const) {
    test(`Preacher send-to-GY replacement is a recorded broker choice (${seat}/${scenario.controller}/${scenario.accept ? "accept" : "decline"})`, async t => {
      const live = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: true,
        chainResponseTimeoutMs: 0, randomSeed: 6702 });
      const playback = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false,
        chainResponseTimeoutMs: 0, replayMode: "playback" });
      t.after(() => { live.dispose(); playback.dispose(); });
      installPreacher(live, seat, scenario); installPreacher(playback, seat, scenario);
      let replacementPrompts = 0;
      live.ui.showChainResponseModal = async () => null;
      const isReplacementPrompt = (options: unknown) =>
        Reflect.get(Object(options), "kind") === "send_to_grave_replacement";
      live.ui.showConfirmPrompt = async (_message, options) => {
        if (!isReplacementPrompt(options)) return false;
        replacementPrompts++;
        return scenario.accept;
      };
      playback.ui.showChainResponseModal = async () => assert.fail("Playback cannot ask for responses");
      playback.ui.showConfirmPrompt = async (_message, options) => isReplacementPrompt(options)
        ? assert.fail("Playback must consume the recorded replacement choice") : false;
      const deck = [460, 451, 453, ...Array<number>(17).fill(3)];
      await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
        startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
        playerDeck: deck, botDeck: deck, playerExtraDeck: [], botExtraDeck: [] });
      const owner = live[seat];
      const preacher = required(owner.field.find(card => card.id === 460));
      const tribute = required(owner.field.find(card => card.id === 451));
      const summoned = await live.performNormalSummon(owner, owner.hand.findIndex(card => card.id === 453), "attack", false,
        [owner.field.indexOf(tribute)]);
      assert.equal(summoned?.success, true);
      assert.equal(replacementPrompts, scenario.controller === "human" ? 1 : 0);
      assert.equal(owner.deck.includes(tribute), scenario.accept, "an accepted replacement shuffles the tribute into the Deck");
      assert.equal(owner.graveyard.includes(tribute), !scenario.accept);
      assert.equal(owner.graveyard.includes(preacher), scenario.accept, "the Preacher is the paid cost");

      const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "preacher" }))));
      assert.ok(replay.decisions.some(decision => decision.kind === "choice" && decision.actorId === seat));
      const result = await replayCanonicalDuel(replay, {
        game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game implements canonical replay runtime ports."),
      });
      assert.equal(result.ok, true);
      assert.equal(result.finalStateHash, replay.result?.finalStateHash);
      assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    });
  }
}

for (const change of ["source-negated", "source-left", "once-per-turn-used"] as const) {
  test(`Preacher replacement is revalidated after the prompt (${change})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false,
      chainResponseTimeoutMs: 0, randomSeed: 6703 });
    t.after(() => game.dispose());
    installPreacher(game, "player", { controller: "human", accept: true });
    const deck = [460, 451, 453, ...Array<number>(17).fill(3)];
    await game.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
      startAtDrawPhase: true, startingPlayer: "player", announceStartingPlayer: false,
      playerDeck: deck, botDeck: deck, playerExtraDeck: [], botExtraDeck: [] });
    const owner = game.player;
    const preacher = required(owner.field.find(card => card.id === 460));
    const tribute = required(owner.field.find(card => card.id === 451));
    const effect = required(preacher.effects.find(entry => entry.id === "burning_west_preacher_graveyard_replacement"));
    game.ui.showChainResponseModal = async () => null;
    let prompts = 0;
    game.ui.showConfirmPrompt = async (_message, options) => {
      if (Reflect.get(Object(options), "kind") !== "send_to_grave_replacement") return false;
      prompts++;
      if (change === "source-negated") preacher.effectsNegated = true;
      if (change === "source-left") {
        await game.moveCard(preacher, owner, "hand", { fromZone: "field", awaitEvents: true });
      }
      if (change === "once-per-turn-used") game.markOncePerTurnUsed(preacher, owner, effect);
      return true;
    };
    const summoned = await game.performNormalSummon(owner, owner.hand.findIndex(card => card.id === 453), "attack", false,
      [owner.field.indexOf(tribute)]);
    assert.equal(summoned?.success, true);
    assert.equal(prompts, 1);
    assert.ok(owner.graveyard.includes(tribute), "the send is no longer replaced");
    assert.equal(owner.graveyard.includes(preacher), false, "the replacement cost is not paid");
  });
}
