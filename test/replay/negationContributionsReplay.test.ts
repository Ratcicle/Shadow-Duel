import assert from "node:assert/strict";
import test from "node:test";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, hashCanonicalGameState, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

function install(game: RuntimeGame, seat: "player" | "bot", controller: "human" | "ai") {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.turnCounter = 4; game.phase = "main1";
    game.phaseDelayMs = 0; game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "human";
    const owner = game[seat], opponent = game.getOpponent(owner);
    owner.controllerType = controller;
    for (const player of [owner, opponent]) { player.deck = [...player.hand, ...player.deck]; player.hand = []; }
    const take = (player: Pick<ReturnType<typeof game.getOpponent>, "deck">, id: number) => {
      const card = required(player.deck.find(card => card.id === id)); player.deck.splice(player.deck.indexOf(card), 1);
      card.isFacedown = false; card.position = "attack"; return card;
    };
    placeFieldCards(owner.field, take(owner, 258));
    owner.hand.push(take(owner, 1));
    placeFieldCards(opponent.field, take(opponent, 1));
  };
}

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const) {
  test(`negation contributions replay with canonical source identity (${seat}/${controller})`, async t => {
    const live = createRuntimeGame({ captureReplay: true, randomSeed: 17, laboratoryMode: true, laboratoryUseBot: false });
    const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false });
    t.after(() => { live.dispose(); playback.dispose(); });
    install(live, seat, controller); install(playback, seat, controller);
    live.ui.showChainResponseModal = async () => null;
    playback.ui.showChainResponseModal = async () => assert.fail("Playback must consume recorded Chain decisions");
    playback.autoSelector.select = () => assert.fail("Playback must not rerun AI selection");
    const deck = [258, ...Array<number>(19).fill(1)];
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true,
      startingPlayer: seat, announceStartingPlayer: false, playerDeck: deck, botDeck: deck, playerExtraDeck: [], botExtraDeck: [] });
    const owner = live[seat], source = required(owner.field[0]), target = required(live.getOpponent(owner).field[0]);
    const result = await live.tryActivateMonsterEffect(source, {
      darkness_dragon_discard_cost: [required(owner.hand[0])], darkness_dragon_negate_target: [target],
    }, "field", owner, { effectId: "darkness_dragon_negate" });
    assert.equal(result.success, true);
    assert.deepEqual(target.effectsNegationContributions, [{ duration: "until_end_turn", sourceDuelCardId: source.duelCardId, sourceEffectId: "darkness_dragon_negate" }]);
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "negation" }))));
    assert.equal(replay.engineVersion, "engine-rules-v10");
    assert.equal(replay.schemaVersion, 2);
    for (const engineVersion of ["dragon-rules-v3", "engine-rules-v4", "dragon-rules-v5", "dragon-rules-v6", "engine-rules-v6"]) {
      assert.throws(() => validateCanonicalReplay({ ...replay, engineVersion }), /engineVersion/);
    }
    const malformed = structuredClone(replay);
    const snapshot = required(malformed.result?.finalState);
    const opponentId = seat === "player" ? "bot" : "player";
    required(required(snapshot.players[opponentId].zones.field[0]).statuses.effectsNegationContributions[0]).sourceDuelCardId = -1;
    assert.throws(() => validateCanonicalReplay(malformed), /sourceDuelCardId/);
    const played = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game integration supplies the runtime replay ports.") });
    assert.equal(played.ok, true);
    assert.equal(played.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.notEqual(playback[seat].field[0]?.instanceId, source.instanceId);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
    assert.equal(hashCanonicalGameState(playback), hashCanonicalGameState(live));
  });
}
