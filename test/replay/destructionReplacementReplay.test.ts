import assert from "node:assert/strict";
import test from "node:test";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Scenario = "negated" | "redirected" | "normal";

function install(game: RuntimeGame, seat: "player" | "bot", controller: "human" | "ai", scenario: Scenario) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    const owner = game[seat], opponent = game.getOpponent(owner);
    game.turn = opponent.id; game.turnCounter = 2; game.phase = "main1";
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "ai";
    owner.controllerType = controller;
    for (const player of [owner, opponent]) player.deck.push(...player.hand.splice(0));
    const take = (player: Pick<typeof owner, "deck">, id: number) => {
      const card = required(player.deck.find(card => card.id === id));
      player.deck.splice(player.deck.indexOf(card), 1);
      card.isFacedown = false; card.position = "attack";
      return card;
    };
    placeFieldCards(owner.field, take(owner, 159), take(owner, 158));
    const attacker = take(opponent, 1);
    attacker.atk = 3000;
    placeFieldCards(opponent.field, attacker);
    if (scenario === "negated") {
      placeFieldCards(opponent.field, take(opponent, 258));
      opponent.hand.push(take(opponent, 3));
    } else if (scenario === "redirected") placeFieldCards(opponent.field, take(opponent, 273));
  };
}

for (const scenario of ["negated", "redirected", "normal"] as const) {
  for (const seat of ["player", "bot"] as const) {
    for (const controller of ["human", "ai"] as const) {
      test(`destruction replacement replay (${scenario}/${seat}/${controller})`, async t => {
        const live = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: true, randomSeed: 5001 });
        const playback = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, replayMode: "playback" });
        t.after(() => { live.dispose(); playback.dispose(); });
        install(live, seat, controller, scenario); install(playback, seat, controller, scenario);
        live.ui.showChainResponseModal = async () => null;
        live.ui.showConfirmPrompt = async () => true;
        playback.ui.showChainResponseModal = async () => assert.fail("Playback cannot request Chain responses");
        playback.ui.showConfirmPrompt = async () => assert.fail("Playback cannot request confirmations");
        playback.ui.showTargetSelection = () => assert.fail("Playback cannot request replacement costs");
        playback.autoSelector.select = () => assert.fail("Playback cannot rerun AI selections");
        const deck = [159, 158, 1, 258, 273, ...Array<number>(15).fill(3)];
        await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
          startAtDrawPhase: true, startingPlayer: seat === "player" ? "bot" : "player", announceStartingPlayer: false,
          playerDeck: deck, botDeck: deck, playerExtraDeck: [], botExtraDeck: [] });
        const owner = live[seat], opponent = live.getOpponent(owner);
        const aurora = required(owner.field.find(card => card.id === 159));
        const fodder = required(owner.field.find(card => card.id === 158));
        const attacker = required(opponent.field.find(card => card.id === 1));
        if (scenario === "negated") {
          const result = await live.tryActivateMonsterEffect(required(opponent.field.find(card => card.id === 258)), {
            darkness_dragon_discard_cost: [required(opponent.hand[0])], darkness_dragon_negate_target: [aurora],
          }, "field", opponent, { effectId: "darkness_dragon_negate" });
          assert.equal(result.success, true);
          assert.equal(aurora.effectsNegated, true);
        }
        await live.nextPhase();
        assert.equal(live.phase, "battle");
        const combat = live.resolveCombat(attacker, aurora);
        await completeTestSelections(live, combat);
        assert.equal(required(await combat).ok, true);
        assert.equal(owner.field.includes(aurora), scenario === "normal");
        assert.equal(owner.field.includes(fodder), scenario === "negated");
        assert.equal(owner.banished.includes(fodder), scenario === "redirected");
        const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "destruction-replacement" }))));
        assert.equal(replay.engineVersion, "engine-rules-v23");
        assert.equal(replay.schemaVersion, 2);
        assert.throws(() => validateCanonicalReplay({ ...replay, engineVersion: "engine-rules-v7" }), /engineVersion/);
        const played = await replayCanonicalDuel(replay, {
          game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game supplies the canonical replay runtime ports."),
        });
        assert.equal(played.ok, true);
        assert.equal(played.finalStateHash, replay.result?.finalStateHash);
        assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
        assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
      });
    }
  }
}
