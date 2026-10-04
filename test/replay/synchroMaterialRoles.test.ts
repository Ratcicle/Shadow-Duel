import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReplayDriverGamePort } from '../../src/core/contracts/replay.js';
import { createCanonicalStateSnapshot, validateCanonicalReplay } from '../../src/core/game/replay/canonical.js';
import { replayCanonicalDuel } from '../../src/core/game/replay/driver.js';
import { required, unsafeFixture } from '../helpers/fixtures.js';
import { createRuntimeGame, placeFieldCards, completeTestSelections, type RuntimeGame } from '../helpers/game.js';

type Seat = 'player' | 'bot';
function install(game: RuntimeGame, seat: Seat) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options); game.turn = seat; game.phase = 'main1'; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.player.controllerType = game.bot.controllerType = 'human';
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    for (const player of [game.player, game.bot]) player.deck.push(...player.hand.splice(0));
    const owner = game[seat];
    const core = required(owner.deck.find(card => card.id === 501)); owner.deck.splice(owner.deck.indexOf(core), 1);
    const machine = required(owner.extraDeck.find(card => card.id === 503)); owner.extraDeck.splice(owner.extraDeck.indexOf(machine), 1);
    placeFieldCards(owner.field, core, machine);
  };
}

for (const seat of ['player', 'bot'] as const) test(`canonical replay preserves observed material metadata ${seat}`, async t => {
  const live = createRuntimeGame({ captureReplay: true, laboratoryMode: true, laboratoryUseBot: false, randomSeed: 443, chainResponseTimeoutMs: 0 });
  const playback = createRuntimeGame({ captureReplay: false, replayMode: 'playback', laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
  t.after(() => { live.dispose(); playback.dispose(); });
  install(live, seat); install(playback, seat);
  live.ui.showConfirmPrompt = async () => true;
  live.ui.showTriggerOrderModal = async options => options?.optional ? [] : (options?.candidates || []).map(candidate => candidate.candidateId);
  live.ui.showChainResponseModal = async () => null;
  live.ui.showSpecialSummonPositionModal = (_card, choose) => choose('defense');
  const deck = [501,3,3,3,3,3,3,3,3];
  await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
    startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
    playerDeck: deck, botDeck: deck, playerExtraDeck: [503,510], botExtraDeck: [503,510] });
  const owner = live[seat], slasher = required(owner.extraDeck.find(card => card.id === 510));
  const machine = required(owner.field.find(card => card.id === 503)), core = required(owner.field.find(card => card.id === 501));
  assert.equal((await live.performSynchroSummonFromExtraDeck(slasher, owner)).needsSelection, true);
  for (const card of [machine, core]) assert.equal(live.handleTargetSelectionClick(owner.id, owner.field.indexOf(card), null, 'field'), true);
  const finish = live.finishTargetSelection(); await completeTestSelections(live, finish); await finish;
  assert.ok(owner.field.includes(slasher)); assert.equal(owner.hand.length, 2);
  playback.ui.showConfirmPrompt = async () => assert.fail('no live confirmation in replay');
  playback.ui.showTriggerOrderModal = async () => assert.fail('no live trigger ordering in replay');
  playback.ui.showChainResponseModal = async () => assert.fail('no live response choice in replay');
  playback.ui.showSpecialSummonPositionModal = () => assert.fail('no live position choice in replay');
  playback.ui.showTargetSelection = () => assert.fail('no live material choice in replay');
  playback.autoSelector.select = () => assert.fail('no AI recomputation in replay');
  const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: 'D4C3 material roles' }))));
  const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, 'Concrete Game rebuilt by identical deterministic setup.') });
  assert.equal(result.ok, true); assert.equal(result.finalStateHash, replay.result?.finalStateHash);
  assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
  assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
  const rebuilt = required(playback[seat].field.find(card => card.id === 510));
  const summarize = (card: typeof slasher) => card.synchroMaterials?.map(({cardId, isTuner, level, ownerId, controllerId}) => ({cardId, isTuner, level, ownerId, controllerId}));
  assert.deepEqual(summarize(rebuilt), summarize(slasher), 'explicitly compare metadata: canonical card hash does not include this field');
  const wrong = required(rebuilt.synchroMaterials?.find(entry => entry.cardId === 503));
  assert.equal(wrong.isTuner, false, 'replay preserves the accepted non-Tuner role');
});
