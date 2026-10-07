import assert from "node:assert/strict";
import test from "node:test";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
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
      assert.equal(replay.engineVersion, "engine-rules-v24");
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
