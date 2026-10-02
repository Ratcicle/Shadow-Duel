import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import type { PlayerId } from "../../src/core/contracts/primitives.js";
import {
  createCanonicalStateSnapshot,
  hashCanonicalGameState,
  validateCanonicalReplay,
} from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { record, required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

function installStartingFixture(game: RuntimeGame, seat: PlayerId) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat;
    game.phase = "main1";
    game.turnCounter = 2;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    game.waitForPresentationDelay = async () => {};
    game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "human";
    const owner = game[seat];
    const cards = [...owner.hand, ...owner.deck];
    owner.hand = [301, 304, 310, 307].map(id => required(cards.find(card => card.id === id)));
    owner.deck = cards.filter(card => card.id === 3);
    const host = required(cards.find(card => card.id === 306));
    placeFieldCards(owner.field, host);
  };
}

async function setup(t: TestContext, seat: PlayerId, manualPlacement = false) {
  const live = createRuntimeGame({
    captureReplay: true, laboratoryMode: true, laboratoryUseBot: false, randomSeed: 407, chainResponseTimeoutMs: 0,
    getFieldPlacementMode: () => manualPlacement ? "manual" : "automatic",
    fieldPlacementProvider: async request => ({ outcome: "chosen", slot: required(request.candidates.at(-1)).slot }),
  });
  const playback = createRuntimeGame({
    captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0,
    getFieldPlacementMode: () => assert.fail("Playback must use its recorded placement decision."),
  });
  t.after(() => { live.dispose(); playback.dispose(); });
  for (const game of [live, playback]) installStartingFixture(game, seat);
  playback.ui.showConfirmPrompt = async () => assert.fail("Playback must not ask live storage/overwrite questions.");
  playback.autoSelector.select = () => assert.fail("Playback must not recalculate a targeting policy.");
  const ownerDeck = [301, 304, 310, 307, 306, ...Array<number>(14).fill(3)];
  const otherDeck = Array<number>(19).fill(3);
  await live.startWithDecks({
    exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true,
    startingPlayer: seat, announceStartingPlayer: false,
    playerDeck: seat === "player" ? ownerDeck : otherDeck,
    botDeck: seat === "bot" ? ownerDeck : otherDeck,
    playerExtraDeck: [], botExtraDeck: [],
  });
  const owner = live[seat];
  const host = required(owner.field[0]);
  const grimoire = required(owner.hand.find(card => card.id === 301));
  const activate = async (id: number, targetRef: string) => {
    const card = required(owner.hand.find(candidate => candidate.id === id));
    const pending = live.tryActivateSpell(card, owner.hand.indexOf(card), { [targetRef]: [host] }, { owner });
    await completeTestSelections(live, pending);
    const result = await pending;
    assert.equal(result.success, true, result.reason ?? undefined);
  };
  const replay = async () => {
    const saved = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "arcanist-design" }))));
    const result = await replayCanonicalDuel(saved, {
      game: unsafeFixture<ReplayDriverGamePort>(playback, "Both real Game instances install the same deterministic starting fixture."),
    });
    assert.equal(result.ok, true);
    assert.equal(result.finalStateHash, saved.result?.finalStateHash);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
    assert.equal(playback.decisionBroker.replayCursor, saved.decisions.length);
    return saved;
  };
  return { live, playback, owner, host, grimoire, activate, replay };
}

for (const seat of ["player", "bot"] as const) {
  for (const scenario of ["initial_refusal", "accept_overwrite", "refuse_overwrite"] as const) {
    test(`Grimoire canonical replay preserves ${scenario} and copied activation (${seat})`, async t => {
      const { live, playback, owner, host, grimoire, activate, replay } = await setup(t, seat);
      const answers = scenario === "initial_refusal" ? [false] : [true, scenario === "accept_overwrite"];
      let prompts = 0;
      live.ui.showConfirmPrompt = async () => required(answers[prompts++], "expected storage confirmation");
      await activate(301, "grimoire_equip_target");
      await activate(304, "lightning_magic_lance_target");
      assert.equal(live.effectEngine.getStoredBlueprints(grimoire).length, scenario === "initial_refusal" ? 0 : 1);
      let expectedSource = scenario === "initial_refusal" ? null : 304;
      if (scenario !== "initial_refusal") {
        await activate(310, "arcanist_ice_barrier_target");
        expectedSource = scenario === "accept_overwrite" ? 310 : 304;
        assert.equal(required(live.effectEngine.getStoredBlueprints(grimoire)[0]).sourceCardId, expectedSource);
        const targetRef = expectedSource === 310 ? "arcanist_ice_barrier_target" : "lightning_magic_lance_target";
        const pending = live.tryActivateSpellTrapEffect(grimoire, { [targetRef]: [host] }, { owner });
        await completeTestSelections(live, pending);
        assert.equal((await pending).success, true);
        assert.ok(owner.spellTrap.includes(grimoire));
        assert.equal(host.atk, expectedSource === 310 ? 2000 : 2500);
        assert.equal(owner.hand.filter(card => card.id === 3).length, expectedSource === 310 ? 4 : 2);
        assert.equal(live.temporaryReplacementEffects.length, expectedSource === 310 ? 2 : 1);

        const replacements = live.temporaryReplacementEffects;
        const protectedHash = hashCanonicalGameState(live);
        live.temporaryReplacementEffects = [];
        assert.notEqual(hashCanonicalGameState(live), protectedHash, "pending prevention must contribute to the canonical state hash");
        live.temporaryReplacementEffects = replacements;
      }
      assert.equal(prompts, answers.length);
      const saved = await replay();
      const replayGrimoire = required(playback[seat].spellTrap.find(card => card.id === 301));
      assert.deepEqual(playback.effectEngine.getStoredBlueprints(replayGrimoire), live.effectEngine.getStoredBlueprints(grimoire));
      assert.equal(playback.effectEngine.getStoredBlueprints(replayGrimoire)[0]?.sourceCardId ?? null, expectedSource);
      const storageDecisions = saved.decisions.filter(decision => decision.kind === "choice");
      assert.deepEqual(storageDecisions.map(decision => "candidateKey" in decision.value && decision.value.candidateKey === "confirm"), answers);
      assert.ok(saved.decisions.some(decision => decision.kind === "target"));
      assert.equal(saved.commands.filter(command => command.type === "activate_effect").length, scenario === "initial_refusal" ? 0 : 1);

      if (expectedSource !== null) {
        const storage = live.effectEngine.getBlueprintStorageState(grimoire, true);
        const stored = storage.storedBlueprints;
        const before = hashCanonicalGameState(live);
        storage.storedBlueprints = [];
        assert.notEqual(hashCanonicalGameState(live), before, "different stored effects must not collapse to the same state hash");
        storage.storedBlueprints = stored;
        const snapshot = record(createCanonicalStateSnapshot(playback));
        assert.ok(Array.isArray(snapshot.temporaryReplacementEffects));
        assert.equal(snapshot.temporaryReplacementEffects.length, expectedSource === 310 ? 2 : 1);
        const registration = record(snapshot.temporaryReplacementEffects[0]);
        assert.equal(registration.usesRemaining, 1);
        assert.equal(registration.expiresOnTurn, 3);
        const replacement = record(registration.replacementEffect);
        assert.equal(Object.hasOwn(replacement, "targetCards"), false);
        assert.equal(Object.hasOwn(replacement, "targetInstanceIds"), false);
        assert.ok(Array.isArray(replacement.targetPresences));
        const presence = record(replacement.targetPresences[0]);
        assert.equal(Object.hasOwn(presence, "instanceId"), false);
        assert.equal(presence.duelCardId, host.duelCardId);
        assert.equal(presence.locationVersion, host.locationVersion);
      }
    });
  }

  test(`Albus no-cost hand procedure replays its placement without activation or payment (${seat})`, async t => {
    const { live, playback, owner, replay } = await setup(t, seat, true);
    const albus = required(owner.hand.find(card => card.id === 307));
    const handBefore = owner.hand.length;
    const result = await live.performHandSummonProcedure(albus, owner, { position: "attack" });
    assert.equal(result.success, true, result.reason ?? undefined);
    assert.ok(owner.field.includes(albus));
    assert.equal(albus.fieldSlot, 4);
    assert.equal(owner.hand.length, handBefore - 1);
    assert.equal(owner.graveyard.length, 0);
    assert.equal(owner.banished.length, 0);
    const saved = await replay();
    assert.deepEqual(saved.commands.map(command => command.type), ["hand_summon_procedure"]);
    assert.equal(saved.decisions.filter(decision => decision.kind === "cost").length, 0);
    assert.equal(saved.decisions.filter(decision => decision.kind === "field_placement").length, 1);
    const replayedAlbus = required(playback[seat].field.find(card => card.id === 307));
    assert.equal(replayedAlbus.fieldSlot, 4);
    assert.equal(replayedAlbus.lastSummonProcedure, albus.lastSummonProcedure);
  });
}
