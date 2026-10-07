import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_REPLAY_ENGINE_VERSION, type ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
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
    assert.equal(replay.engineVersion, CANONICAL_REPLAY_ENGINE_VERSION);
    assert.equal(replay.schemaVersion, 2);
    for (const engineVersion of ["dragon-rules-v3", "engine-rules-v4", "dragon-rules-v5", "dragon-rules-v6", "engine-rules-v6", "engine-rules-v7"]) {
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

function installCrashTownScenario(game: RuntimeGame, negated: boolean) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = "player";
    game.turnCounter = 4;
    game.phase = "main1";
    game.phaseDelayMs = 0;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "human";
    for (const player of [game.player, game.bot]) {
      player.deck = [...player.hand, ...player.deck];
      player.hand = [];
    }
    const take = (zone: RuntimeGame["player"]["deck"], id: number) => {
      const card = required(zone.find(card => card.id === id));
      zone.splice(zone.indexOf(card), 1);
      card.isFacedown = false;
      card.position = "attack";
      return card;
    };
    const crash = take(game.player.deck, 462);
    game.player.fieldSpell = crash;
    game.player.hand.push(take(game.player.deck, 458));
    if (negated) {
      const singularity = take(game.bot.extraDeck, 517);
      placeFieldCards(game.bot.field, singularity);
      const effect = required(singularity.effects.find(effect => effect.id === "tech_zero_final_singularity_synchro_negate_all"));
      const applied = await game.effectEngine.applyActions(required(effect.actions), {
        source: singularity, effect, player: game.bot, opponent: game.player,
      }, {});
      assert.equal(applied.success, true);
      assert.equal(crash.effectsNegated, true);
      await game.moveCard(singularity, game.bot, "graveyard", { fromZone: "field", awaitCardMovedEvent: true });
      assert.equal(crash.effectsNegated, true);
    }
    const bahamut = take(game.bot.extraDeck, 275);
    bahamut.properSummonEstablished = true;
    bahamut.properSummonProcedure = "graveyard_banish_fusion";
    placeFieldCards(game.bot.field, bahamut);
  };
}

for (const negated of [false, true]) {
  test(`[CS-03] Crash Town passive protection replays with negated=${negated}`, async t => {
    const live = createRuntimeGame({ captureReplay: true, randomSeed: 33, laboratoryMode: true, laboratoryUseBot: false });
    const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false });
    t.after(() => { live.dispose(); playback.dispose(); });
    // Both Games install the same fixture after canonical deck setup; the JSON
    // exercises command/decision replay and is not a standalone scenario export.
    installCrashTownScenario(live, negated);
    installCrashTownScenario(playback, negated);
    let responded = false;
    live.ui.showChainResponseModal = async candidates => {
      const candidate = !responded && candidates.find(candidate => candidate.card?.id === 275);
      if (!candidate) return null;
      responded = true;
      return candidate;
    };
    playback.ui.showChainResponseModal = async () => assert.fail("Playback must consume recorded Chain decisions");
    playback.autoSelector.select = () => assert.fail("Playback must not rerun AI selection");
    await live.startWithDecks({
      exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true,
      startingPlayer: "player", announceStartingPlayer: false,
      playerDeck: [462, 458, 451, ...Array<number>(17).fill(1)], botDeck: Array<number>(20).fill(1),
      playerExtraDeck: [], botExtraDeck: [275, 517],
    });
    const funeral = required(live.player.hand.find(card => card.id === 458));
    const gunslinger = required(live.player.deck.find(card => card.id === 451));
    await live.tryActivateSpell(funeral, 0, { funeral_at_sunset_sent_monster: [gunslinger] }, { owner: live.player });
    assert.equal(responded, true);
    assert.equal(live.player.deck.includes(gunslinger), negated);
    assert.equal(live.player.graveyard.includes(gunslinger), !negated);
    assert.equal(live.player.graveyard.includes(funeral), true);
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "passive_negation_protection" }))));
    const played = await replayCanonicalDuel(replay, {
      game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game integration supplies the runtime replay ports."),
    });
    assert.equal(played.ok, true);
    assert.equal(played.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.equal(replay.commands.length, 1);
    assert.ok(replay.decisions.length > 0);
    assert.notEqual(playback.player.fieldSpell?.instanceId, live.player.fieldSpell?.instanceId);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
    assert.equal(hashCanonicalGameState(playback), hashCanonicalGameState(live));
  });
}
