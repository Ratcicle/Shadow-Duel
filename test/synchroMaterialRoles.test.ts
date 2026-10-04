import type { SynchroCardView } from "../src/core/game/summon/synchro.js";
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Card from '../src/core/Card.js';
import { cardDefinition, required } from './helpers/fixtures.js';
import { createRuntimeGame, placeFieldCards, completeTestSelections } from './helpers/game.js';

type Seat = 'player' | 'bot';
function setup(t: TestContext, seat: Seat) {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false,
    randomSeed: 443, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turn = seat; game.phase = 'main1'; game.turnCounter = 4; game.disablePresentationDelays = true;
  game.player.controllerType = game.bot.controllerType = 'human';
  game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
  game.ui.showConfirmPrompt = async () => true;
  game.ui.showTrapActivationModal = async () => true;
  game.ui.showTriggerOrderModal = async options => options?.optional ? [] : (options?.candidates || []).map(candidate => candidate.candidateId);
  game.ui.showChainResponseModal = async () => null;
  game.ui.showSpecialSummonPositionModal = (_card, choose) => choose('attack');
  game.chainSystem.botChooseChainResponse = async () => null;
  const owner = game[seat], opponent = game[seat === 'player' ? 'bot' : 'player'];
  const make = (id: number, player = owner) => new Card(cardDefinition(id), player.id);
  for (const player of [owner, opponent]) player.deck.push(...Array.from({length: 8}, () => make(3, player)));
  const moves: string[] = [];
  game.on('card_moved', event => moves.push(`${event.card.id}:${event.fromZone}->${event.toZone}`));
  return { game, owner, opponent, make, moves };
}

for (const seat of ['player', 'bot'] as const) {
  for (const controller of ['human', 'ai'] as const) test(`actual non-Tuner role metadata ${seat}/${controller}`, async t => {
    const { game, owner, make, moves } = setup(t, seat);
    owner.controllerType = controller;
    const core = make(501), machine = make(503), slasher = make(510);
    placeFieldCards(owner.field, core, machine); owner.extraDeck.push(slasher);
    const check = game.canSummonSynchroCard(owner, slasher); assert.equal(check.ok, true);
    if (!check.ok) return;
    assert.equal(check.materialCombos.length, 1);
    assert.deepEqual(check.materialCombos[0], [core, machine]);
    const result = await game.performSynchroSummonFromExtraDeck(slasher, owner);
    if (controller === 'human') {
      assert.equal(result.needsSelection, true); assert.equal(moves.length, 0);
      // Deliberate human choice in reverse order; role cannot be inferred from click order.
      for (const card of [machine, core]) assert.equal(game.handleTargetSelectionClick(owner.id, owner.field.indexOf(card), null, 'field'), true);
      const finish = game.finishTargetSelection(); await completeTestSelections(game, finish); await finish;
    } else assert.equal(result.success, true);
    assert.ok(owner.field.includes(slasher));
    assert.equal(owner.hand.length, 2, 'the two real mandatory material effects draw');
    assert.equal(machine.isTuner, true, 'printed type remains a Tuner after material use');
    const record = required(slasher.synchroMaterials?.find(entry => entry.instanceId === machine.instanceId));
    const evidence = { seat, controller, moves, metadata: slasher.synchroMaterials,
      machinePrintedTuner: machine.isTuner, observedUsedAsTuner: record.isTuner, expectedUsedAsTuner: false };
    assert.equal(game.targetSelection, null); assert.equal(game.activeSummonTransaction, null);
    assert.equal(record.isTuner, false, 'Multimodal was the non-Tuner: metadata must record its actual role');
  });

  test(`alternate role restricted to Tech-Zero destination ${seat}`, async t => {
    const { game, owner, make, moves } = setup(t, seat);
    const machine = make(503), pulse = make(505), samurai = make(513), generic = make(31);
    placeFieldCards(owner.field, machine, pulse); owner.extraDeck.push(samurai, generic);
    assert.equal(machine.level + pulse.level, samurai.level);
    assert.equal(samurai.level, generic.level);
    assert.equal(game.canSummonSynchroCard(owner, samurai).ok, true);
    assert.equal(game.canSummonSynchroCard(owner, generic).ok, false);
    const result = await game.performSynchroSummonFromExtraDeck(generic, owner, { materials: [pulse, machine] });
    assert.equal(result.success, false); assert.deepEqual(moves, []);
    assert.deepEqual(owner.field, [machine, pulse]); assert.deepEqual(owner.graveyard, []);
  });

  test(`real Orathus negation disables only alternate role ${seat}`, async t => {
    const { game, owner, opponent, make, moves } = setup(t, seat);
    const machine = make(503), pulse = make(508), prism = make(506), samurai = make(511);
    placeFieldCards(owner.field, machine, pulse, prism); owner.extraDeck.push(samurai);
    const otherMachine = make(503, opponent), rock = make(29, opponent), orathus = make(32, opponent);
    placeFieldCards(opponent.field, otherMachine, rock); opponent.extraDeck.push(orathus);
    game.turn = opponent.id;
    game.ui.showConfirmPrompt = async (_message) => !owner.field.includes(samurai);
    const negate = game.performSynchroSummonFromExtraDeck(orathus, opponent, { materials: [otherMachine, rock] });
    await completeTestSelections(game, negate); assert.equal((await negate).success, true);
    assert.equal(game.effectEngine.isEffectNegated(machine), true);
    assert.equal(machine.effectsNegatedDuration, 'while_faceup');
    game.ui.showConfirmPrompt = async () => true;
    await game.skipToPhase('end');
    if (game.turn !== owner.id) await game.nextPhase();
    assert.equal(game.turn, owner.id); await game.skipToPhase('main1');
    assert.equal(game.phase, 'main1'); assert.equal(game.effectEngine.isEffectNegated(machine), true);
    const check = game.canSummonSynchroCard(owner, samurai); assert.equal(check.ok, true);
    if (!check.ok) return;
    assert.equal(check.materialCombos.some(combo => combo.includes(machine) && combo.includes(pulse)), false);
    assert.equal(check.materialCombos.some(combo => combo.includes(machine) && combo.includes(prism)), true);
    const before = moves.length;
    assert.equal((await game.performSynchroSummonFromExtraDeck(samurai, owner, { materials: [pulse, machine] })).success, false);
    assert.equal(moves.length, before, 'rejected role pays no materials');
    let machineDraws = 0;
    game.on('cards_added_to_hand', event => { if (event.sourceCard === machine && event.fromZone === 'deck') machineDraws += event.cards.length; });
    const summon = game.performSynchroSummonFromExtraDeck(samurai, owner, { materials: [machine, prism] });
    await completeTestSelections(game, summon); assert.equal((await summon).success, true);
    assert.equal(machineDraws, 1, 'field-exit allowance preserves its material draw');
    const record = required(samurai.synchroMaterials?.find(entry => entry.instanceId === machine.instanceId));
    assert.equal(record.isTuner, true, 'the printed Tuner role remains valid while negated');
  });
}

test('accepted multi-Tuner assignment preserves the first legal allocation after physical-set deduplication', async () => {
  const { enumerateSynchroMaterialCombos, getAcceptedSynchroMaterialRoles } = await import('../src/core/game/summon/synchro.js');
  const cards = [1, 2, 3].map(instanceId => ({
    id: 503, instanceId, cardKind: 'monster', isTuner: true, level: 1,
    synchroMaterialRoles: { nonTunerFor: [{ archetype: 'Tech-Zero' }] },
  }));
  const destination = { id: 510, cardKind: 'monster', monsterType: 'synchro', archetype: 'Tech-Zero', level: 3,
    synchro: { tunerCount: 2, nonTunerMin: 1, nonTunerMax: 1 } };
  const combos = enumerateSynchroMaterialCombos<SynchroCardView>(cards, destination);
  assert.equal(combos.length, 1, 'three allocations of one physical set are deduplicated');
  const combo = required(combos[0]), roles = getAcceptedSynchroMaterialRoles(combo, destination);
  assert.deepEqual(combo.map(card => card.instanceId), [1, 2, 3]);
  assert.deepEqual([...roles.values()], ['tuner', 'tuner', 'nonTuner']);
  assert.deepEqual([...cards].reverse().map(card => roles.get(card)), ['nonTuner', 'tuner', 'tuner']);
  assert.ok(cards.every(card => card.isTuner), 'printed roles are never modified');
});
