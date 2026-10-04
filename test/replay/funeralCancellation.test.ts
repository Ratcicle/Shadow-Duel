import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { validateCanonicalReplay, createCanonicalStateSnapshot } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";

type Seat = "player" | "bot";
type Mode = "accept-twin" | "accept-other" | "decline" | "empty" | "cancel" | "only-sent" | "facedown";
const sentRef = "funeral_at_sunset_sent_monster";
const deck = [458, 458, 451, 451, 451, 453, 452, 1, 1, 1, 3, 3, 3, 4, 4, 4, 7, 7, 7, 8];
function install(game: RuntimeGame, seat: Seat, mode: Mode) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.player.controllerType = game.bot.controllerType = "human";
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    for (const owner of [game.player, game.bot]) owner.deck.push(...owner.hand.splice(0));
    const owner = game[seat];
    const take = (id: number) => {
      const card = required(owner.deck.find(card => card.id === id));
      owner.deck.splice(owner.deck.indexOf(card), 1); return card;
    };
    owner.hand.push(take(458));
    const sent = take(451), twin = take(451), field = take(451), other = take(453);
    owner.deck.unshift(sent);
    (mode === "only-sent" ? owner.banished : owner.graveyard).push(twin, other);
    field.isFacedown = mode === "facedown"; field.position = field.isFacedown ? "defense" : "attack";
    placeFieldCards(owner.field, field); game.effectEngine.assignFieldPresenceId(field);
    owner.graveyard.push(take(452), take(1));
  };
}

for (const seat of ["player", "bot"] as const) {
  for (const mode of ["accept-twin", "accept-other", "decline", "empty", "cancel", "only-sent", "facedown"] as const) {
    test(`Funeral optional recovery preserves commitment and replay (${seat}/${mode})`, { timeout: 10000 }, async t => {
      const live = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: true, randomSeed: 1601, chainResponseTimeoutMs: 0 });
      const playback = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, replayMode: "playback", chainResponseTimeoutMs: 0 });
      t.after(() => { live.dispose(); playback.dispose(); });
      install(live, seat, mode); install(playback, seat, mode);
      await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true,
        startingPlayer: seat, announceStartingPlayer: false, playerDeck: deck, botDeck: deck, playerExtraDeck: [], botExtraDeck: [] });
      const owner = live[seat], source = required(owner.hand[0]), sent = required(owner.deck.find(card => card.id === 451));
      const recoveryZone = mode === "only-sent" ? owner.banished : owner.graveyard;
      const twin = required(recoveryZone.find(card => card.id === 451)), other = required(recoveryZone.find(card => card.id === 453));
      assert.notEqual(sent.duelCardId, twin.duelCardId);
      let confirmations = 0, selections = 0;
      const controls: { cancel: (() => void) | null } = { cancel: null };
      live.ui.showTargetSelection = (_contract, _confirm, onCancel) => { controls.cancel = onCancel ?? null; return { close() {} }; };
      live.ui.showChainResponseModal = async () => null;
      live.autoSelector.select = () => assert.fail("human choice cannot use AutoSelector");
      live.ui.showConfirmPrompt = async (_message, options) => {
        confirmations++; assert.ok(owner.graveyard.includes(sent));
        assert.equal(Reflect.get(options || {}, "kind"), "optional_target_actions"); return mode !== "decline";
      };
      const activation = live.tryActivateSpell(source, 0, null, { owner });
      let done = false;
      const completion = activation.finally(() => { done = true; });
      const seen = new Set<object>();
      for (let attempt = 0; !done && attempt < 3000; attempt++) {
        const session = live.targetSelection;
        if (session && !seen.has(session)) {
          seen.add(session); selections++;
          const requirement = required(session.requirements[0]);
          if (requirement.id === sentRef) {
            assert.deepEqual(requirement.candidates.map(candidate => candidate.cardRef), [sent]);
            session.selections[requirement.id] = [required(requirement.candidates[0]).key];
            await live.finishTargetSelection();
          } else {
            assert.equal(requirement.min, 0); assert.equal(requirement.max, 1);
            assert.deepEqual(new Set(requirement.candidates.map(candidate => candidate.cardRef)), new Set([twin, other]));
            if (mode === "cancel") required(controls.cancel)();
            else {
              session.selections[requirement.id] = mode === "empty" ? [] :
                [required(requirement.candidates.find(candidate => candidate.cardRef === (mode === "accept-other" ? other : twin))).key];
              await live.finishTargetSelection();
            }
          }
        }
        if (!done) await new Promise(resolve => setTimeout(resolve, 1));
      }
      assert.equal(done, true); await completion;
      assert.equal((await activation).success, true);
      assert.equal(live.canUseOncePerTurn(source, owner, required(source.effects[0])).ok, false);
      assert.equal(confirmations, mode === "facedown" ? 0 : 1);
      assert.equal(selections, ["only-sent", "facedown", "decline"].includes(mode) ? 1 : 2);
      assert.ok(owner.graveyard.includes(sent)); assert.ok(owner.graveyard.includes(source));
      assert.equal(owner.hand.includes(twin), mode === "accept-twin");
      assert.equal(owner.hand.includes(other), mode === "accept-other");
      assert.equal(live.targetSelection, null); assert.equal(live.effectUsageReservations.size, 0);
      const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "funeral-cancellation" }))));
      assert.equal(replay.commands.length, 1);
      playback.ui.showConfirmPrompt = async () => assert.fail("replay consumes consent");
      playback.ui.showChainResponseModal = async () => assert.fail("replay consumes response");
      playback.ui.showTargetSelection = () => assert.fail("replay consumes targets");
      playback.autoSelector.select = () => assert.fail("replay must not recalculate choices");
      const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback,
        "Concrete Game with identical initialization and unchanged recorded command/decisions.") });
      assert.equal(result.ok, true);
      assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
      assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
      assert.deepEqual(playback.getRandomState(), live.getRandomState());
    });
  }
}
