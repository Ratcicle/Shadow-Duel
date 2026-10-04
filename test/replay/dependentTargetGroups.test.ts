import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeGame, type RuntimeGame } from "../helpers/game.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { validateCanonicalReplay, createCanonicalStateSnapshot } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";

const first = "tech_zero_development_lab_synchro_target";
function install(game: RuntimeGame, seat: "player" | "bot", ai: boolean) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options); game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.player.controllerType = game.bot.controllerType = "human";
    if (ai) game[seat].controllerType = "ai";
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    for (const owner of [game.player, game.bot]) owner.deck.push(...owner.hand.splice(0));
    const owner = game[seat];
    const take = (id: number) => {
      const zone = owner.deck.some(card => card.id === id) ? owner.deck : owner.extraDeck;
      const card = required(zone.find(card => card.id === id)); zone.splice(zone.indexOf(card), 1); return card;
    };
    owner.fieldSpell = take(518); owner.graveyard.push(take(509), take(509), take(501));
  };
}
for (const seat of ["player", "bot"] as const) for (const mode of ["twin", "main-monster", "ai"] as const) {
  test(`Lab dependent choices replay exactly (${seat}/${mode})`, { timeout: 10000 }, async t => {
    const live = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: true, randomSeed: 1801, chainResponseTimeoutMs: 0 });
    const playback = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, replayMode: "playback", chainResponseTimeoutMs: 0 });
    t.after(() => { live.dispose(); playback.dispose(); });
    install(live, seat, mode === "ai"); install(playback, seat, mode === "ai");
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
      playerDeck: [518, 501, 3, 3, 3, 3, 3], botDeck: [518, 501, 3, 3, 3, 3, 3], playerExtraDeck: [509, 509], botExtraDeck: [509, 509] });
    live.ui.showChainResponseModal = async () => null;
    const owner = live[seat], source = required(owner.fieldSpell), a = required(owner.graveyard[0]);
    const b = required(owner.graveyard[mode === "main-monster" ? 2 : 1]);
    const activation = live.activateFieldSpellEffect(source);
    if (mode !== "ai") {
      for (let attempt = 0; !live.targetSelection && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 1));
      const session = required(live.targetSelection);
      for (const requirement of session.requirements) session.selections[requirement.id] =
        [required(requirement.candidates.find(candidate => candidate.cardRef === (requirement.id === first ? a : b))).key];
      await live.finishTargetSelection();
    }
    assert.equal((await activation).success, true);
    assert.equal(owner.graveyard.length, 1);
    if (mode !== "ai") { assert.ok(owner.extraDeck.includes(a)); assert.ok((mode === "twin" ? owner.extraDeck : owner.deck).includes(b)); }
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "dependent-target-groups" }))));
    assert.equal(replay.commands.length, 1);
    assert.equal(replay.engineVersion, "engine-rules-v18");
    assert.throws(() => validateCanonicalReplay({ ...replay, engineVersion: "engine-rules-v17" }), /engineVersion/);
    playback.ui.showTargetSelection = () => assert.fail("replay must consume recorded selections");
    playback.autoSelector.select = () => assert.fail("replay must not recompute dependent selections");
    playback.ui.showChainResponseModal = async () => assert.fail("replay must consume response");
    const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game with identical deterministic initial zones.") });
    assert.equal(result.ok, true);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
    assert.deepEqual(playback.getRandomState(), live.getRandomState());
  });
}
