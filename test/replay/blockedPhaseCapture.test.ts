import assert from "node:assert/strict";
import test from "node:test";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Seat = "player" | "bot";
function install(game: RuntimeGame, seat: Seat) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.phase = "main2"; game.turnCounter = 4;
    game.phaseDelayMs = 0; game.disablePresentationDelays = true;
    const actor = game[seat], other = game[seat === "player" ? "bot" : "player"];
    actor.controllerType = "ai"; other.controllerType = "human";
    for (const owner of [actor, other]) owner.deck.push(...owner.hand.splice(0));
    const take = (owner: typeof actor, id: number) => {
      const card = required(owner.deck.find(card => card.id === id));
      owner.deck.splice(owner.deck.indexOf(card), 1);
      card.isFacedown = false; card.position = "attack";
      return card;
    };
    actor.hand.push(take(actor, 3)); placeFieldCards(actor.field, take(actor, 1));
    other.hand.push(take(other, 3));
    const leviathan = required(other.extraDeck.find(card => card.id === 27));
    other.extraDeck.splice(other.extraDeck.indexOf(leviathan), 1);
    leviathan.isFacedown = false; leviathan.position = "attack";
    leviathan.properSummonEstablished = true; leviathan.properSummonProcedure = "synchro";
    placeFieldCards(other.field, leviathan);
    for (const card of [...actor.field, ...other.field]) game.effectEngine.assignFieldPresenceId(card);
  };
}

for (const seat of ["player", "bot"] as const) for (const route of ["control", "next", "skip"] as const) {
  test(`rejected ${route} phase intent cannot precede the pending activation (${seat})`, { timeout: 10000 }, async t => {
    const live = createRuntimeGame({ captureReplay: true, laboratoryMode: true, laboratoryUseBot: false, randomSeed: 9951, chainResponseTimeoutMs: 0 });
    const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    t.after(() => { live.dispose(); playback.dispose(); });
    install(live, seat); install(playback, seat);
    const deck = [3, 3, 3, 1, 1, 1, 4, 4, 4, 7, 7, 7, 8, 8, 8, 9, 9, 9, 5, 5];
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
      startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
      playerDeck: deck, botDeck: deck, playerExtraDeck: [27], botExtraDeck: [27] });
    const actor = live[seat], other = live[seat === "player" ? "bot" : "player"];
    const spell = required(actor.hand[0]), target = required(actor.field[0]), discard = required(other.hand[0]);
    const leviathan = required(other.field[0]);
    let offered = false;
    live.ui.showChainResponseModal = async candidates => {
      const response = candidates.find(candidate => candidate.card === leviathan);
      if (response && !offered) { offered = true; return response; }
      return null;
    };
    const activation = live.tryActivateSpell(spell, 0, null, { owner: actor });
    for (let attempt = 0; !live.targetSelection && attempt < 2000; attempt++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.ok(live.targetSelection, "a real human response selection is pending");
    assert.equal(offered, true);
    if (route !== "control") {
      const result = route === "next" ? await live.nextPhase({ retryOnBlocked: false }) : await live.skipToPhase("end");
      assert.ok(result && typeof result === "object");
      assert.equal(Reflect.get(result, "code"), "BLOCKED_SELECTION_ACTIVE");
    }
    await completeTestSelections(live, activation);
    assert.equal((await activation).success, true);
    assert.equal(actor.lp, 9000); assert.equal(target.isFacedown, true);
    assert.ok(actor.graveyard.includes(spell)); assert.ok(other.graveyard.includes(discard));
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "blocked-phase" }))));
    assert.equal(replay.commands.some(command => command.type === "phase_intent"), false);
    assert.equal(replay.commands.filter(command => command.type === "activate_card").length, 1);
    playback.ui.showChainResponseModal = async () => assert.fail("playback must consume the recorded response");
    playback.ui.showConfirmPrompt = async () => assert.fail("playback must consume recorded confirmation");
    playback.ui.showTargetSelection = () => assert.fail("playback must consume recorded targets");
    playback.autoSelector.select = () => assert.fail("playback must not recalculate AI choices");
    const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback,
      "Concrete Game with the same deterministic laboratory initialization; recorder output is unchanged.") });
    assert.equal(result.ok, true);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(playback.getRandomState(), live.getRandomState());
  });
}
