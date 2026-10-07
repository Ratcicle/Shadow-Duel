import assert from "node:assert/strict";
import test from "node:test";
import type Card from "../../src/core/Card.js";
import type ChainSystem from "../../src/core/ChainSystem.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { setLocale } from "../../src/core/i18n.js";
import { validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

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

// The audit's corrected responses run through captured commands and broker decisions.
for (const seat of ["player", "bot"] as const) {
  for (const scenario of ["normal15", "flip15", "own220", "opponent220"] as const) {
    test(`CS01 canonical Summon response ${seat}/${scenario}`, async t => {
      const live = createRuntimeGame({ captureReplay: true, randomSeed: 661, laboratoryMode: true,
        laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
      const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true,
        laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
      t.after(() => { live.dispose(); playback.dispose(); });
      const trapId = scenario.endsWith("15") ? 15 : 220;
      const responderSeat = scenario === "own220" ? seat : seat === "player" ? "bot" : "player";
      const install = (game: RuntimeGame) => {
        const start = game.startWithDecks.bind(game);
        game.startWithDecks = async options => {
          await start(options);
          Object.assign(game, { turn: seat, phase: "main1", turnCounter: 4, disablePresentationDelays: true });
          game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
          for (const owner of [game.player, game.bot]) {
            owner.deck.push(...owner.hand.splice(0));
            owner.controllerType = "human";
          }
          const take = (owner: RuntimeGame["player"], id: number) => {
            const card = required(owner.deck.find(entry => entry.id === id));
            owner.deck.splice(owner.deck.indexOf(card), 1);
            return card;
          };
          const monster = take(game[seat], 1);
          if (scenario === "flip15") {
            Object.assign(monster, { isFacedown: true, position: "defense", setTurn: 1 });
            placeFieldCards(game[seat].field, monster);
          } else game[seat].hand.push(monster);
          const trap = take(game[responderSeat], trapId);
          Object.assign(trap, { isFacedown: true, setTurn: 1 });
          placeFieldCards(game[responderSeat].spellTrap, trap);
          if (trapId === 220) game[responderSeat].hand.push(take(game[responderSeat], 1));
        };
      };
      install(live); install(playback);
      let accepted = false;
      live.ui.showChainResponseModal = async candidates => {
        if (accepted) return null;
        const candidate = candidates.find(entry => entry.card?.id === trapId);
        accepted = !!candidate;
        return candidate ?? null;
      };
      live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
      playback.ui.showChainResponseModal = async () => assert.fail("Playback must consume broker responses");
      playback.ui.showTargetSelection = () => assert.fail("Playback must consume broker selections");
      const deck = (ownerSeat: "player" | "bot") => [
        ...(ownerSeat === responderSeat ? [trapId] : []),
        ...Array<number>(12).fill(1), ...Array<number>(12).fill(3),
      ];
      await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
        startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
        playerDeck: deck("player"), botDeck: deck("bot"), playerExtraDeck: [], botExtraDeck: [] });
      await completeTestSelections(live, scenario === "flip15"
        ? live.flipSummon(required(live[seat].field[0]))
        : live.performNormalSummon(live[seat], 0, "attack", false));
      const expectedResponse = scenario === "normal15" || scenario === "opponent220";
      assert.equal(accepted, expectedResponse);
      assert.equal(live[seat].graveyard.some(card => card.id === 1), scenario === "normal15");
      assert.equal(live[responderSeat].field.length, trapId === 220 ? 1 : 0);
      const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "cs01_corrected_summon" }))));
      const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback,
        "Independent Game with the same deterministic canonical starting-board fixture") });
      assert.equal(result.ok, true);
      assert.equal(result.finalStateHash, replay.result?.finalStateHash);
      assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
      assert.deepEqual(playback[seat].graveyard.map(card => card.id), live[seat].graveyard.map(card => card.id));
      assert.deepEqual(playback[responderSeat].field.map(card => card.id), live[responderSeat].field.map(card => card.id));
    });
  }
}

const kingId = required(cardDefinition('Void Hollow King').id);
const hollowId = required(cardDefinition('Void Hollow').id);
const courtId = required(cardDefinition('Court of the Dead').id);


// Arrange identical real database cards in independent games. After setup, all
// actions, costs, responses, decisions, movements and trigger flushes are real.
function installCourtScenario(game: ChainGame) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    Object.assign(game, { turn: 'player', turnCounter: 4, phase: 'main1', disablePresentationDelays: true });
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    for (const owner of [game.player, game.bot]) {
      owner.controllerType = 'human';
      owner.deck = [...owner.hand, ...owner.deck]; owner.hand = [];
    }
    const take = (owner: typeof game.player, id: number) => {
      const card = required([...owner.deck, ...owner.extraDeck].find(card => card.id === id));
      const zone = owner.deck.includes(card) ? owner.deck : owner.extraDeck;
      zone.splice(zone.indexOf(card), 1); card.isFacedown = false; return card;
    };
    placeFieldCards(game.player.field, take(game.player, kingId), take(game.player, hollowId));
    const court = take(game.bot, courtId);
    Object.assign(court, { isFacedown: true, setTurn: 2 }); placeFieldCards(game.bot.spellTrap, court);
  };
}

test('CS04 canonical replay excludes historical Court event and consumes decisions', async t => {
  setLocale('en');
  const live = createRuntimeGame({ captureReplay: true, randomSeed: 107, laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
  const playback = createRuntimeGame({ captureReplay: false, replayMode: 'playback', laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
  t.after(() => { live.dispose(); playback.dispose(); setLocale('en'); });
  installCourtScenario(live); installCourtScenario(playback);
  let used = false;
  live.ui.showChainResponseModal = async candidates => {
    if (used) return null;
    const candidate = candidates.find(candidate => candidate.card?.id === courtId);
    if (candidate) used = true;
    return candidate ?? null;
  };
  live.ui.showConfirmPrompt = async () => true;
  live.ui.showTriggerOrderModal = async options => (options?.candidates || []).map(candidate => candidate.candidateId);
  playback.ui.showChainResponseModal = async () => assert.fail('replay requested a new response');
  playback.ui.showTargetSelection = () => assert.fail('replay requested a new selection');
  playback.ui.showTriggerOrderModal = async () => assert.fail('replay requested trigger ordering');
  playback.autoSelector.select = () => assert.fail('replay recomputed an AI choice');
  await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
    startAtDrawPhase: true, startingPlayer: 'player', announceStartingPlayer: false,
    playerDeck: [hollowId, ...Array<number>(10).fill(3)], playerExtraDeck: [kingId],
    botDeck: [courtId, ...Array<number>(10).fill(3)], botExtraDeck: [] });
  const king = required(live.player.field.find(card => card.id === kingId));
  const hollow = required(live.player.field.find(card => card.id === hollowId));
  const action = live.tryActivateMonsterEffect(king, { void_hollow_king_boost_cost: [hollow] }, 'field', live.player, { effectId: 'void_hollow_king_quick_boost' });
  await completeTestSelections(live, action);
  assert.equal((await action).success, true);
  assert.equal(required(live.bot.spellTrap[0]).getCounter('funeral'), 0);
  const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: 'read-only-chain-audit-retroactive-court' }))));
  setLocale('pt-br');
  const result = await replayCanonicalDuel(replay, {
    game: unsafeFixture<ReplayDriverGamePort>(playback, 'Canonical playback runs the concrete Game with identical initial fixture layout.'),
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalStateHash, required(replay.result).finalStateHash);
  assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
  assert.equal(required(playback.bot.spellTrap[0]).getCounter('funeral'), 0);
});

for (const viaTrap of [true, false]) {
  test(`D01 canonical optional when survives ${viaTrap ? "Grave source cleanup" : "procedural Summon"}`, async t => {
    setLocale("en");
    const live = createRuntimeGame({ captureReplay: true, randomSeed: 122, laboratoryMode: true,
      laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true,
      laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
    const install = (game: RuntimeGame) => {
      const start = game.startWithDecks.bind(game);
      game.startWithDecks = async options => {
        await start(options);
        Object.assign(game, { turn: "player", turnCounter: 4, phase: "main1", disablePresentationDelays: true });
        game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
        for (const owner of [game.player, game.bot]) {
          owner.controllerType = "human";
          owner.deck.push(...owner.hand.splice(0));
        }
        const take = (id: number) => {
          const card = required(game.player.deck.find(entry => entry.id === id));
          game.player.deck.splice(game.player.deck.indexOf(card), 1);
          return card;
        };
        const grave = take(126);
        Object.assign(grave, { isFacedown: true, setTurn: 2, turnSetOn: 2 });
        placeFieldCards(game.player.spellTrap, grave);
        game.player.hand.push(take(107), take(108));
      };
    };
    install(live); install(playback);
    live.ui.showChainResponseModal = async () => null;
    live.ui.showTrapActivationModal = async () => true;
    live.ui.showConfirmPrompt = async () => true;
    live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
    live.ui.showTriggerOrderModal = async options => (options?.candidates || []).map(candidate => candidate.candidateId);
    playback.ui.showChainResponseModal = async () => assert.fail("Playback requested a response");
    playback.ui.showTargetSelection = () => assert.fail("Playback requested a selection");
    playback.ui.showConfirmPrompt = async () => assert.fail("Playback requested a confirmation");
    playback.ui.showSpecialSummonPositionModal = () => assert.fail("Playback requested a Summon position");
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
      startAtDrawPhase: true, startingPlayer: "player", announceStartingPlayer: false,
      playerDeck: [126, 107, 108, ...Array<number>(10).fill(3)], botDeck: Array<number>(12).fill(3),
      playerExtraDeck: [], botExtraDeck: [] });
    const action = viaTrap ? live.tryActivateSpellTrapEffect(required(live.player.spellTrap[0]))
      : live.performNormalSummon(live.player, 0, "attack", false);
    await completeTestSelections(live, action);
    assert.deepEqual(live.player.field.map(card => card.id), [107, 108]);
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "d01_source_cleanup" }))));
    setLocale("pt-br");
    const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback,
      "Independent canonical Game with the same Grave/Imp/Gecko setup") });
    assert.equal(result.ok, true);
    assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(playback.player.field.map(card => card.id), [107, 108]);
  });
}
