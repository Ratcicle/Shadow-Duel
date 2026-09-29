import assert from "node:assert/strict";
import test from "node:test";
import type { CardAction } from "../../src/core/contracts/actions.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, hashCanonicalGameState, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { cardDefinition, record, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, runtimeCard } from "../helpers/game.js";

test("canonical driver reproduces accumulated persistent burns in another Game", async (t) => {
  const live = createRuntimeGame({ captureReplay: true, randomSeed: 33, laboratoryMode: true, laboratoryUseBot: false });
  const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false });
  t.after(() => { live.dispose(); playback.dispose(); });
  for (const game of [live, playback]) {
    game.phaseDelayMs = 0;
    game.disablePresentationDelays = true;
    game.player.controllerType = "ai";
    game.bot.controllerType = "ai";
  }
  await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startingPlayer: "player", announceStartingPlayer: false,
    playerDeck: [...Array<number>(12).fill(1), 33, 33, 1, 1], botDeck: Array<number>(16).fill(1), playerExtraDeck: [], botExtraDeck: [] });
  live.phase = "main1";
  live.recordReplayCommand({ type: "set_phase", actorId: "player", payload: { phase: "main1" } });
  const activate = async () => {
    const source = required(live.player.hand.find(card => card.id === 33));
    const result = await live.tryActivateSpell(source, live.player.hand.indexOf(source), null, { owner: live.player });
    assert.equal(result.success, true, result.reason ?? undefined);
  };
  await activate();
  await live.skipToPhase("end");
  await live.skipToPhase("end");
  assert.equal(live.turn, "player");
  await live.skipToPhase("main1");
  await activate();
  const before = live.bot.lp;
  await live.skipToPhase("end");
  await live.skipToPhase("main1");
  assert.equal(live.bot.lp, before - 600);
  const replay = validateCanonicalReplay(live.finalizeReplay({ reason: "test" }));
  const result = await replayCanonicalDuel(replay, {
    game: unsafeFixture<ReplayDriverGamePort>(playback, "Real headless Game replay integration."),
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalStateHash, replay.result?.finalStateHash);
  assert.equal(playback.temporaryEventEffects.length, 2);
  assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
});

test("temporary registrations hash canonical sources and bound targets without changing runtime links", async (t) => {
  const games = [createRuntimeGame({ randomSeed: 10 }), createRuntimeGame({ randomSeed: 10 })];
  t.after(() => games.forEach(game => game.dispose()));
  const fixtures = games.map(game => {
    const source = runtimeCard(cardDefinition(33));
    const target = runtimeCard(cardDefinition(1));
    const other = runtimeCard(cardDefinition(1));
    game.player.graveyard.push(source, target, other);
    for (const card of [source, target, other]) game.ensureDuelCardId(card);
    return { game, source, target, other };
  });
  const action: CardAction = { type: "register_temporary_event_effect", event: "card_moved", duration: "until_consumed", uses: 1,
    triggerRequirement: "mandatory", triggerTiming: "if", bindEventTargetRef: "bound", requireBoundTargetLeavesField: true,
    actions: [{ type: "damage", amount: 300, player: "opponent" }] };
  for (const { game, source, target } of fixtures) {
    for (let i = 0; i < 2; i++) {
      const result = await game.effectEngine.applyActions([action], { source, player: game.player, opponent: game.bot }, { bound: [target] });
      assert.equal(result.success, true);
    }
    assert.notEqual(record(game.temporaryEventEffects[0]).id, record(game.temporaryEventEffects[1]).id);
  }
  const first = required(fixtures[0]);
  const second = required(fixtures[1]);
  assert.notEqual(first.source.instanceId, second.source.instanceId);
  const original = structuredClone(first.game.temporaryEventEffects);
  assert.equal(hashCanonicalGameState(first.game), hashCanonicalGameState(second.game));
  assert.deepEqual(first.game.temporaryEventEffects, original, "hashing must not mutate runtime links");
  const snapshot = createCanonicalStateSnapshot(first.game);
  assert.ok(Array.isArray(snapshot.temporaryEventEffects));
  const registration = record(snapshot.temporaryEventEffects[0]);
  assert.equal(registration.sourceDuelCardId, first.source.duelCardId);
  assert.equal(registration.boundEventTargetDuelCardId, first.target.duelCardId);
  assert.equal(Object.hasOwn(registration, "sourceInstanceId"), false);
  assert.equal(Object.hasOwn(registration, "boundEventTargetInstanceId"), false);

  // Sources may disappear entirely (for example a Token); registered provenance survives.
  first.game.player.graveyard.splice(0, 1);
  second.game.player.graveyard.splice(0, 1);
  assert.equal(hashCanonicalGameState(first.game), hashCanonicalGameState(second.game));
  first.game.player.graveyard.splice(0, 1);
  second.game.player.graveyard.splice(0, 1);
  assert.equal(hashCanonicalGameState(first.game), hashCanonicalGameState(second.game));
  const detachedSnapshot = createCanonicalStateSnapshot(first.game);
  assert.ok(Array.isArray(detachedSnapshot.temporaryEventEffects));
  assert.equal(record(detachedSnapshot.temporaryEventEffects[0]).boundEventTargetDuelCardId, first.target.duelCardId);

  // Explicit keys replace only the requested registration, and canonical target identity matters.
  for (const fixture of fixtures) {
    const { game, source, target } = fixture;
    await game.effectEngine.applyActions([{ ...action, uniqueKey: "replaceable" }], { source, player: game.player, opponent: game.bot }, { bound: [target] });
  }
  assert.equal(hashCanonicalGameState(first.game), hashCanonicalGameState(second.game));
  await second.game.effectEngine.applyActions([{ ...action, uniqueKey: "replaceable" }], {
    source: second.source, player: second.game.player, opponent: second.game.bot,
  }, { bound: [second.other] });
  assert.equal(second.game.temporaryEventEffects.length, 3);
  assert.notEqual(hashCanonicalGameState(first.game), hashCanonicalGameState(second.game), "different copies must not collapse to the card definition ID");
});
