import assert from "node:assert/strict";
import test from "node:test";
import type Card from "../../src/core/Card.js";
import type ChainSystem from "../../src/core/ChainSystem.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { setLocale } from "../../src/core/i18n.js";
import { validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type ChainGame = RuntimeGame & { chainSystem: ChainSystem };
const dragonId = required(cardDefinition("Majestic Silver Dragon").id);
const roarId = required(cardDefinition("Hellkite Roar").id);
const callId = required(cardDefinition("Call of the Haunted").id);
const otherTrapId = required(cardDefinition("Mirror Force").id);

// Arrange the same authoritative cards after setup in both independent Games.
// All subsequent responses, movement, targeting and trigger resolution are real.
function installScenario(game: ChainGame) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = "player";
    game.turnCounter = 4;
    game.phase = "main1";
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    for (const owner of [game.player, game.bot]) {
      owner.controllerType = "human";
      owner.deck = [...owner.hand, ...owner.deck];
      owner.hand = [];
    }
    const take = (owner: RuntimeGame["player"], id: number) => {
      const card = required(owner.deck.find(entry => entry.id === id));
      owner.deck.splice(owner.deck.indexOf(card), 1);
      card.isFacedown = false;
      card.position = "attack";
      return card;
    };
    placeFieldCards(game.player.field, take(game.player, dragonId));
    game.player.hand.push(take(game.player, roarId));
    const call = take(game.bot, callId);
    const otherTrap = take(game.bot, otherTrapId);
    Object.assign(call, { isFacedown: true, setTurn: 2 });
    Object.assign(otherTrap, { isFacedown: true, setTurn: 2 });
    placeFieldCards(game.bot.spellTrap, call, otherTrap);
    game.bot.graveyard.push(take(game.bot, 151));
  };
}

async function finishSelections(game: ChainGame, action: Promise<unknown>, destroyTarget: Card) {
  let done = false;
  let failure: unknown;
  let pausedAfterSummon = false;
  const completion = action.then(() => { done = true; }, error => { failure = error; done = true; });
  const callbacks = new Set<Promise<void>>();
  const submitted = new Set<NonNullable<RuntimeGame["targetSelection"]>>();
  for (let attempt = 0; attempt < 3000; attempt++) {
    const session = game.targetSelection;
    if (session && !submitted.has(session)) {
      submitted.add(session);
      for (const requirement of session.requirements) {
        if (requirement.id === "destroy_targets") {
          pausedAfterSummon = true;
          assert.equal(game.chainSystem.isChainResolving(), true);
          assert.equal(game.bot.field[0]?.id, 151);
          assert.equal(game.bot.hand.length, 0, "Valiant must wait until the original Chain finishes");
        }
        const candidate = required(requirement.id === "destroy_targets"
          ? requirement.candidates.find(entry => entry.cardRef === destroyTarget)
          : requirement.candidates[0]);
        session.selections[requirement.id] = [candidate.key];
      }
      const callback = game.finishTargetSelection();
      callbacks.add(callback);
      void callback.then(() => callbacks.delete(callback), error => { failure = error; callbacks.delete(callback); });
    }
    if (done && !game.targetSelection && callbacks.size === 0) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done, "activation and deferred triggers must finish");
  await completion;
  if (failure) throw failure;
  assert.ok(pausedAfterSummon, "Hellkite must request its manual choice after Call summons Valiant");
  assert.equal(game.targetSelection, null);
  assert.equal(callbacks.size, 0);
}

for (const destroyBinding of [true, false]) {
  test(`deferred summon replays when Hellkite destroys ${destroyBinding ? "Call" : "another trap"}`, async t => {
    setLocale("en");
    const live = createRuntimeGame({ captureReplay: true, randomSeed: 629, laboratoryMode: true,
      laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true,
      laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
    installScenario(live);
    installScenario(playback);
    live.ui.showConfirmPrompt = async () => true;
    live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
    let offeredCall = false;
    live.ui.showChainResponseModal = async candidates => {
      if (offeredCall) return null;
      const candidate = candidates.find(entry => entry.card?.id === callId);
      if (candidate) offeredCall = true;
      return candidate ?? null;
    };
    playback.ui.showConfirmPrompt = async () => assert.fail("Replay cannot request confirmation");
    playback.ui.showChainResponseModal = async () => assert.fail("Replay cannot request a response");
    playback.ui.showSpecialSummonPositionModal = () => assert.fail("Replay cannot request position");
    playback.ui.showTargetSelection = () => assert.fail("Replay cannot request targets");
    playback.autoSelector.select = () => assert.fail("Replay cannot recompute an AI selection");
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
      startAtDrawPhase: true, startingPlayer: "player", announceStartingPlayer: false,
      playerDeck: [dragonId, roarId, ...Array<number>(10).fill(3)],
      botDeck: [callId, otherTrapId, 151, 151, ...Array<number>(8).fill(3)],
      playerExtraDeck: [], botExtraDeck: [] });
    const destroyTarget = required(live.bot.spellTrap.find(card => card.id === (destroyBinding ? callId : otherTrapId)));
    await finishSelections(live, live.tryActivateSpell(required(live.player.hand[0]), 0).then(result => {
      assert.equal(result.success, true, result.reason ?? undefined);
      return result;
    }), destroyTarget);
    assert.ok(offeredCall);
    const assertOutcome = (game: ChainGame) => {
      assert.equal(game.bot.hand.filter(card => card.id === 151).length, destroyBinding ? 0 : 1);
      assert.equal(game.bot.graveyard.some(card => card.id === 151), destroyBinding);
      assert.equal(game.bot.field.some(card => card.id === 151), !destroyBinding);
      assert.equal(game.chainSystem.pendingTriggerOccurrences.length, 0);
      assert.equal(game.chainSystem.pendingChainSelection, null);
    };
    assertOutcome(live);
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "deferred-summon-test" }))));
    assert.deepEqual(replay.commands.map(command => command.type), ["activate_card"]);
    assert.ok(replay.decisions.some(decision => decision.kind === "chain_response"));
    assert.equal(replay.decisions.filter(decision => decision.kind === "target").length, destroyBinding ? 1 : 2);
    const choices = replay.decisions.filter(decision => decision.kind === "choice");
    assert.equal(choices.length, 1, "Hellkite destruction is a resolution choice, not an activation target");
    const choiceValue = required(choices[0]).value;
    assert.ok("selections" in choiceValue);
    const chosen = required(choiceValue.selections.destroy_targets);
    assert.equal(chosen.length, 1);
    const identity = required(chosen[0]);
    assert.ok("duelCardId" in identity);
    assert.equal(identity.duelCardId, destroyTarget.duelCardId, "the resolution choice records the exact physical card");
    setLocale("pt-br");
    const result = await replayCanonicalDuel(replay, {
      game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game owns the card and player instances used by canonical playback."),
    });
    assert.equal(result.ok, true);
    assert.equal(result.finalStateHash, required(replay.result).finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assertOutcome(playback);
  });
}
