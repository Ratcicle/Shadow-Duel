import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "../../src/core/i18n.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, hashCanonicalGameState, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

// Both Games start with the same deployed real cards. The public Synchro
// procedure, real 517 trigger, attack and phase cleanup execute unchanged.
function install(game: RuntimeGame, seat: "player" | "bot", controller: "human" | "ai") {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.turnCounter = 4; game.phase = "main1";
    game.phaseDelayMs = 0; game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = controller;
    for (const player of [game.player, game.bot]) player.deck.push(...player.hand.splice(0));
    const actor = game[seat], opponent = game.getOpponent(actor);
    const take = (player: Pick<typeof actor, "deck" | "extraDeck">, id: number, zone: "deck" | "extraDeck") => {
      const card = required(player[zone].find(entry => entry.id === id));
      player[zone].splice(player[zone].indexOf(card), 1);
      card.isFacedown = false; card.position = "attack";
      return card;
    };
    const attacker = take(actor, 1, "deck"); attacker.addCounter("spore", 5);
    placeFieldCards(actor.field, attacker,
      take(actor, 503, "extraDeck"), take(actor, 510, "extraDeck"), take(actor, 512, "extraDeck"));
    placeFieldCards(opponent.spellTrap, take(opponent, 412, "deck"));
    game.effectEngine.updatePassiveBuffs();
  };
}

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const) {
  test(`B07 real-card negation, attack and expiration replay (${seat}, ${controller})`, async t => {
    setLocale("en");
    const live = createRuntimeGame({ captureReplay: true, randomSeed: 412517, laboratoryMode: true, laboratoryUseBot: false });
    const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false });
    t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
    install(live, seat, controller); install(playback, seat, controller);
    live.ui.showChainResponseModal = async () => null;
    live.ui.showConfirmPrompt = async () => false;
    live.ui.showSpecialSummonPositionModal = (_card, done) => done("attack");
    live.ui.showTriggerOrderModal = async (options = {}) => (options.candidates || []).map(candidate => candidate.candidateId);
    playback.ui.showTargetSelection = () => assert.fail("Playback must consume the recorded selections");
    playback.ui.showChainResponseModal = async () => assert.fail("Playback must consume the recorded Chain responses");
    playback.ui.showConfirmPrompt = async () => assert.fail("Playback must consume the recorded confirmations");
    playback.ui.showSpecialSummonPositionModal = () => assert.fail("Playback must consume the recorded position");
    playback.ui.showTriggerOrderModal = async () => assert.fail("Playback must consume the recorded trigger order");
    playback.autoSelector.select = () => assert.fail("Playback must not rerun AutoSelector");
    playback.autoSelector.orderTriggerCandidates = () => assert.fail("Playback must not recompute AI trigger ordering");
    const deck = [412, ...Array<number>(19).fill(1)];
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true,
      startingPlayer: seat, announceStartingPlayer: false, playerDeck: deck, botDeck: deck,
      playerExtraDeck: [503, 510, 512, 517], botExtraDeck: [503, 510, 512, 517] });
    const actor = live[seat], opponent = live.getOpponent(actor);
    const attacker = required(actor.field.find(card => card.id === 1));
    const network = required(opponent.spellTrap.find(card => card.id === 412));
    const lock = required(network.effects.find(effect => effect.id === "bloomrot_root_network_attack_lock"));
    const reason = required("passive" in lock ? lock.passive?.reason : undefined);
    assert.deepEqual(live.getAttackAvailability(attacker), { ok: false, reason });
    const singularity = required(actor.extraDeck.find(card => card.id === 517));
    const summon = live.performSynchroSummonFromExtraDeck(singularity, actor, {
      materials: actor.field.filter(card => card.id !== undefined && [503, 510, 512].includes(card.id)),
    });
    await completeTestSelections(live, summon);
    assert.equal((await summon).success, true);
    assert.equal(network.effectsNegated, true);
    assert.deepEqual(network.effectsNegationContributions, [{ duration: "until_end_turn",
      sourceDuelCardId: singularity.duelCardId, sourceEffectId: "tech_zero_final_singularity_synchro_negate_all" }]);
    assert.equal(live.getAttackAvailability(attacker).ok, true);
    await completeTestSelections(live, live.nextPhase());
    assert.equal(live.phase, "battle");
    const previousLp = opponent.lp;
    const combat = live.resolveCombat(attacker, null);
    await completeTestSelections(live, combat);
    assert.equal(required(await combat).ok, true);
    assert.equal(opponent.lp, previousLp - attacker.atk);
    assert.equal(attacker.getCounter("spore"), 5);
    for (let step = 0; step < 4 && live.turn === seat; step++) await completeTestSelections(live, live.nextPhase());
    assert.notEqual(live.turn, seat, "the public phase flow completes the turn cleanup");
    assert.equal(network.effectsNegated, false);
    assert.deepEqual(network.effectsNegationContributions, []);
    assert.deepEqual(live.getAttackAvailability(attacker), { ok: false, reason });
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "bloomrot-p1-attack-lock" }))));
    assert.equal(replay.schemaVersion, 2);
    assert.deepEqual(replay.commands.map(command => command.type), [
      "extra_deck_summon", "phase_intent", "attack", "phase_intent", "phase_intent", "phase_intent",
    ]);
    assert.ok(replay.decisions.some(decision => decision.kind === "segoc_order"));
    setLocale("pt-br");
    const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback,
      "Concrete Game implements canonical replay with the identical real-card starting fixture.") });
    assert.equal(result.ok, true);
    assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
    assert.equal(hashCanonicalGameState(playback), hashCanonicalGameState(live));
    const restoredAttacker = required(playback[seat].field.find(card => card.id === 1));
    assert.deepEqual(playback.getAttackAvailability(restoredAttacker), { ok: false, reason });
  });
}
