import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalStateSnapshot, hashCanonicalGameState, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { setLocale } from "../../src/core/i18n.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

function install(game: RuntimeGame, seat: "player" | "bot", controller: "human" | "ai") {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat;
    game.phase = "main1";
    game.turnCounter = 4;
    game.phaseDelayMs = 0;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "human";
    game[seat].controllerType = controller;
    game.player.strategy = game.bot.strategy = null;
    for (const owner of [game.player, game.bot]) owner.deck.push(...owner.hand.splice(0));
    const owner = game[seat];
    const source = required(owner.deck.find(card => card.id === 452));
    owner.deck.splice(owner.deck.indexOf(source), 1);
    source.isFacedown = false;
    source.location = "spellTrap";
    source.declaredValues = { legacyPrimitive: "Machine", legacyNumber: 2, legacyBoolean: false };
    placeFieldCards(owner.spellTrap, source);
  };
}

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const) {
  test(`Burning West declaration metadata replays EN/PT after turn boundary (${seat}/${controller})`, { timeout: 20000 }, async t => {
    setLocale("en");
    const live = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: true, randomSeed: 452, chainResponseTimeoutMs: 0 });
    const playback = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, replayMode: "playback", chainResponseTimeoutMs: 0 });
    t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
    install(live, seat, controller);
    install(playback, seat, controller);
    live.ui.showConfirmPrompt = async () => true;
    live.ui.showChainResponseModal = async () => null;
    const deck = [452, ...Array<number>(19).fill(3)];
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
      startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
      playerDeck: deck, botDeck: deck, playerExtraDeck: [], botExtraDeck: [] });
    const source = required(live[seat].spellTrap[0]);
    const action = live.tryActivateSpellTrapEffect(source, null, { owner: live[seat], effectId: "burning_west_wanted_declare_type" });
    await completeTestSelections(live, action);
    assert.equal((await action).success, true);
    const transition = live.skipToPhase("end");
    await completeTestSelections(live, transition);
    await transition;
    assert.equal(live.turnCounter, 5);
    const declaration = required(source.declaredValues?.burning_west_wanted_type);
    assert.equal(typeof declaration, "object");
    if (typeof declaration !== "object") return;
    assert.equal(declaration.expiresOnTurn, 5);
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "declaration_metadata" }))));
    if (seat === "player" && controller === "human") {
      const invalid = structuredClone(replay);
      const value = required(invalid.result?.finalState?.players.player.zones.spellTrap[0]?.declaredValues?.burning_west_wanted_type);
      assert.equal(typeof value, "object");
      if (typeof value !== "object") return;
      value.expiresOnTurn = Number.NaN;
      assert.throws(() => validateCanonicalReplay(invalid), /expiresOnTurn/);
      value.expiresOnTurn = 5;
      value.declaredOnTurn = Number.POSITIVE_INFINITY;
      assert.throws(() => validateCanonicalReplay(invalid), /declaredOnTurn/);
    }
    playback.ui.showTargetSelection = () => assert.fail("Replay must consume the recorded declaration.");
    playback.ui.showConfirmPrompt = async () => assert.fail("Replay must consume the recorded consent.");
    playback.ui.showChainResponseModal = async () => assert.fail("Replay must consume recorded Chain responses.");
    playback.autoSelector.select = () => assert.fail("Replay must not recompute the declaration.");
    setLocale("pt-br");
    const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback,
      "Concrete Game rebuilds identical deterministic decks and initial declaration-source placement.") });
    assert.equal(result.ok, true);
    assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
    assert.equal(hashCanonicalGameState(playback), hashCanonicalGameState(live));
    assert.deepEqual(playback.getRandomState(), live.getRandomState());
  });
}
