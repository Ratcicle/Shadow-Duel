import assert from "node:assert/strict";
import test from "node:test";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

function installProtectionBoard(game: RuntimeGame, seat: "player" | "bot", controller: "human" | "ai") {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.turnCounter = 4; game.phase = "main1";
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "ai";
    const owner = game[seat];
    owner.controllerType = controller;
    owner.deck = [...owner.hand, ...owner.deck]; owner.hand = [];
    const target = required(owner.deck.find(card => card.id === 255));
    owner.deck.splice(owner.deck.indexOf(target), 1);
    target.isFacedown = false; target.position = "attack";
    placeFieldCards(owner.field, required(owner.extraDeck.shift()), target);
  };
}

for (const seat of ["player", "bot"] as const) {
  for (const mode of ["ai-plan", "ai-provided", "human-provided"] as const) {
    test(`${seat} ${mode} activation target is recorded and replayed without recomputing`, async t => {
      const live = createRuntimeGame({ captureReplay: true, randomSeed: 629, laboratoryMode: true,
        laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
      const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true,
        laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
      t.after(() => { live.dispose(); playback.dispose(); });
      const controller = mode === "human-provided" ? "human" : "ai";
      installProtectionBoard(live, seat, controller); installProtectionBoard(playback, seat, controller);
      live.ui.showChainResponseModal = async () => null;
      playback.ui.showChainResponseModal = async () => assert.fail("Replay cannot request a response");
      playback.autoSelector.select = () => assert.fail("Replay cannot recompute the recorded target");
      if (mode !== "ai-plan") live.autoSelector.select = () => assert.fail("A provided choice needs no AI selection");
      const deck = [255, ...Array<number>(19).fill(3)];
      await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
        startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
        playerDeck: deck, botDeck: deck, playerExtraDeck: [267], botExtraDeck: [267] });
      const owner = live[seat], source = required(owner.field[0]), chosen = required(owner.field[1]);
      const selections = { rainbow_cosmic_protection_target: [chosen] };
      const result = await live.tryActivateMonsterEffect(source, mode === "ai-plan" ? null : selections, "field", owner, {
        effectId: "rainbow_cosmic_dragon_protect_dragon",
        ...(mode === "ai-plan" ? { activationContext: { decisions: { selections: {
          rainbow_cosmic_protection_target: [chosen.instanceId],
        } } } } : {}),
      });
      assert.equal(result.success, true);
      assert.equal(chosen.protectionEffects?.length, 2, "The caller's exact target must be preserved");
      assert.equal(source.protectionEffects?.length ?? 0, 0);
      const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: mode }))));
      assert.equal(replay.decisions.filter(decision => decision.kind === "target").length, 1);
      const replayResult = await replayCanonicalDuel(replay, {
        game: unsafeFixture<ReplayDriverGamePort>(playback, "Real Game exposes runtime cards to the replay driver."),
      });
      assert.equal(replayResult.ok, true);
      assert.equal(replayResult.finalStateHash, replay.result?.finalStateHash);
      assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
      assert.equal(playback[seat].field[1]?.protectionEffects?.length, 2);
    });
  }
}

for (const seat of ["player", "bot"] as const) {
  test(`${seat} Tera records its public-information target and playback never consults AutoSelector`, async t => {
    const live = createRuntimeGame({ captureReplay: true, randomSeed: 42, laboratoryMode: true,
      laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true,
      laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    t.after(() => { live.dispose(); playback.dispose(); });
    for (const game of [live, playback]) {
      const start = game.startWithDecks.bind(game);
      game.startWithDecks = async options => {
        await start(options);
        game.turn = seat; game.turnCounter = 4; game.phase = "main1";
        game.disablePresentationDelays = true;
        game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
        game.player.controllerType = game.bot.controllerType = "ai";
        for (const player of [game.player, game.bot]) {
          player.deck = [...player.hand, ...player.deck]; player.hand = [];
        }
        const owner = game[seat], opponent = game.getOpponent(owner);
        const tera = required(owner.deck.find(card => card.id === 306));
        owner.deck.splice(owner.deck.indexOf(tera), 1);
        placeFieldCards(owner.field, tera);
        for (const id of [251, 257]) {
          const hidden = required(opponent.deck.find(card => card.id === id));
          opponent.deck.splice(opponent.deck.indexOf(hidden), 1);
          hidden.isFacedown = true; hidden.position = "defense";
          placeFieldCards(opponent.field, hidden);
        }
      };
    }
    live.ui.showChainResponseModal = async () => null;
    playback.ui.showChainResponseModal = async () => assert.fail("Playback must use the recorded responses");
    playback.autoSelector.select = () => assert.fail("Playback must use the recorded target");
    const deck = [306, 251, 257, ...Array<number>(17).fill(3)];
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
      startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
      playerDeck: deck, botDeck: deck, playerExtraDeck: [], botExtraDeck: [] });
    const owner = live[seat], opponent = live.getOpponent(owner);
    const chosen = required(opponent.field[0]);
    const result = await live.tryActivateMonsterEffect(required(owner.field[0]), null, "field", owner, {
      effectId: "tera_arcanist_earth_ignition", activationContext: { autoSelectTargets: true },
    });
    assert.equal(result.success, true);
    assert.equal(chosen.isFacedown, false);
    assert.equal(chosen.position, "attack");
    assert.equal(opponent.field[1]?.isFacedown, true);
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "public-target" }))));
    assert.equal(replay.decisions.filter(decision => decision.kind === "target").length, 1);
    const replayResult = await replayCanonicalDuel(replay, {
      game: unsafeFixture<ReplayDriverGamePort>(playback, "Real Game with the identical prepared target board in both instances."),
    });
    assert.equal(replayResult.ok, true);
    assert.equal(replayResult.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(playback.getRandomState(), live.getRandomState());
    assert.equal(playback.getOpponent(playback[seat]).field[0]?.isFacedown, false);
  });
}
