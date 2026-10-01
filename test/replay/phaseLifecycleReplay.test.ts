import assert from "node:assert/strict";
import test from "node:test";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

function install(game: RuntimeGame, controller: "human" | "ai", source: "spirit" | "quick") {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.phase = "main2"; game.turn = "player"; game.turnCounter = 2;
    game.disablePresentationDelays = true; game.phaseDelayMs = 0;
    game.player.controllerType = "human"; game.bot.controllerType = controller;
    for (const owner of [game.player, game.bot]) owner.deck.push(...owner.hand.splice(0));
    const card = required(game.bot.deck.find(card => card.id === (source === "spirit" ? 16 : 1)));
    game.bot.deck.splice(game.bot.deck.indexOf(card), 1);
    if (source === "spirit") {
      card.isFacedown = true; card.setTurn = card.turnSetOn = 1;
      placeFieldCards(game.bot.spellTrap, card);
      for (let i = 0; i < 4; i++) placeFieldCards(game.bot.field, required(game.bot.deck.pop()));
    } else {
      card.effects = [{ id: "replay_phase_quick", timing: "ignition", speed: 2, isQuickEffect: true,
        activationZones: ["field"], oncePerTurn: true, usagePolicy: "use", actions: [{ type: "heal", amount: 137, player: "self" }] }];
      placeFieldCards(game.bot.field, card);
    }
  };
}

for (const route of ["next", "skip"] as const) {
  for (const controller of ["human", "ai"] as const) {
    for (const source of ["spirit", "quick"] as const) {
      test(`End response ${route}/${controller}/${source} replays exact decisions in another Game`, async t => {
        const live = createRuntimeGame({ captureReplay: true, randomSeed: 137, laboratoryMode: true, laboratoryUseBot: false });
        const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false });
        t.after(() => { live.dispose(); playback.dispose(); });
        install(live, controller, source); install(playback, controller, source);
        let chosen = false;
        let liveEndEvents = 0;
        let playbackEndEvents = 0;
        live.on("end_phase", () => { liveEndEvents++; });
        playback.on("end_phase", () => { playbackEndEvents++; });
        live.ui.showChainResponseModal = async candidates => {
          if (chosen || live.turn !== "player" || live.phase !== "end") return null;
          chosen = true;
          return required(candidates[0]);
        };
        live.bot.strategy = { chooseChainResponse: ({ activatable }) => {
          if (chosen || live.turn !== "player" || live.phase !== "end") return { pass: true };
          chosen = true;
          return required(activatable[0]);
        } };
        playback.ui.showChainResponseModal = async () => assert.fail("playback cannot ask for human responses");
        playback.bot.strategy = { chooseChainResponse: () => assert.fail("playback cannot run AI response policy") };
        await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
          startAtDrawPhase: true, startingPlayer: "player", announceStartingPlayer: false,
          playerDeck: Array<number>(12).fill(1), botDeck: [16, ...Array<number>(11).fill(1)], playerExtraDeck: [], botExtraDeck: [] });
        if (route === "next") {
          await live.nextPhase();
          assert.equal(live.phase, "end");
          assert.equal(live.turnCounter, 2);
        }
        const advance = () => route === "next" ? live.nextPhase() : live.skipToPhase("end");
        await completeTestSelections(live, Promise.resolve(advance()));
        assert.equal(chosen, true);
        assert.equal(live.turn, "player");
        assert.equal(live.phase, "end");
        await completeTestSelections(live, Promise.resolve(advance()));
        assert.equal(live.turn, "bot");
        const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "phase-lifecycle" }))));
        assert.equal(replay.commands.length, route === "next" ? 3 : 2, "nested phase work cannot create duplicate commands");
        assert.ok(replay.decisions.some(decision => decision.kind === "chain_response"));
        const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Real Game with the same deterministic phase fixture.") });
        assert.equal(result.ok, true);
        assert.equal(result.finalStateHash, replay.result?.finalStateHash);
        assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
        assert.equal(liveEndEvents, 1);
        assert.equal(playbackEndEvents, 1);
      });
    }
  }
}

test("ordinary Main 2 advance enters End without replaying a turn-ending shortcut", async t => {
  const live = createRuntimeGame({ captureReplay: true, randomSeed: 138, laboratoryMode: true, laboratoryUseBot: false });
  const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false });
  t.after(() => { live.dispose(); playback.dispose(); });
  for (const game of [live, playback]) {
    const start = game.startWithDecks.bind(game);
    game.startWithDecks = async options => { await start(options); game.phase = "main2"; game.turnCounter = 2; game.phaseDelayMs = 0; };
  }
  await live.startWithDecks({ exactDecks: true, initializeOnly: true, startingPlayer: "player", announceStartingPlayer: false,
    playerDeck: Array<number>(12).fill(1), botDeck: Array<number>(12).fill(1), playerExtraDeck: [], botExtraDeck: [] });
  await live.nextPhase();
  assert.equal(live.phase, "end");
  const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "phase-next-only" }))));
  const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Real Game fixture reproduces same starting phase.") });
  assert.equal(result.ok, true);
  assert.equal(playback.turn, "player");
  assert.equal(playback.phase, "end");
  assert.equal(result.finalStateHash, replay.result?.finalStateHash);
});
