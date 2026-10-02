import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Card from '../src/core/Card.js';
import type { EventCard } from '../src/core/contracts/events.js';
import { cardDefinition, required } from './helpers/fixtures.js';
import { createRuntimeGame, placeFieldCards, completeTestSelections } from './helpers/game.js';

function setup(t: TestContext, seat: 'player' | 'bot', controller: 'human' | 'ai') {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, randomSeed: 5001 });
  const owner = game[seat], opponent = seat === 'player' ? game.bot : game.player;
  game.turn = opponent.id; game.turnCounter = 2; game.phase = 'main1';
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = game.bot.controllerType = 'ai';
  owner.controllerType = controller;
  game.ui.showChainResponseModal = async () => null;
  game.ui.showConfirmPrompt = async () => true;
  game.ui.showTriggerOrderModal = async options => required(required(options).candidates).map(candidate => candidate.candidateId);
  t.after(() => game.dispose());
  const make = (id: number, player = owner) => new Card(cardDefinition(id), player.id);
  const monster = (atk: number, player = opponent) => new Card({ id: 999901, name: 'D5 vanilla', cardKind: 'monster', atk, def: 1000, level: 4, effects: [] }, player.id);
  return { game, owner, opponent, make, monster };
}

for (const controller of ['ai', 'human'] as const) {
for (const seat of ['player', 'bot'] as const) {
  for (const negated of [false, true]) {
    test(`negated destruction replacement source: negation=${negated}, seat=${seat}, controller=${controller}`, async t => {
      const { game, owner, opponent, make, monster } = setup(t, seat, controller);
      const aurora = make(159), fodder = make(158), attacker = monster(3000);
      aurora.position = attacker.position = 'attack';
      placeFieldCards(owner.field, aurora, fodder); placeFieldCards(opponent.field, attacker);
      if (negated) {
        const darkness = make(258, opponent), discard = make(21, opponent);
        placeFieldCards(opponent.field, darkness); opponent.hand.push(discard);
        const activation = await game.tryActivateMonsterEffect(darkness,
          { darkness_dragon_discard_cost: [discard], darkness_dragon_negate_target: [aurora] },
          'field', opponent, { effectId: 'darkness_dragon_negate' });
        assert.equal(activation.success, true);
        assert.equal(aurora.effectsNegated, true);
      }
      game.phase = 'battle'; game.battleStep = 'battle';
      const combat = game.resolveCombat(attacker, aurora);
      await completeTestSelections(game, combat);
      assert.equal(required(await combat).ok, true);
      assert.equal(owner.graveyard.includes(aurora), negated, 'a currently negated Aurora must be destroyed');
      assert.equal(owner.field.includes(fodder), negated, 'no replacement cost should be paid while negated');
    });
  }
  for (const redirected of [false, true]) {
    test(`destruction replacement requires the requested GY destination: redirected=${redirected}, seat=${seat}, controller=${controller}`, async t => {
      const { game, owner, opponent, make, monster } = setup(t, seat, controller);
      const aurora = make(159), fodder = make(158), attacker = monster(3000);
      aurora.position = attacker.position = 'attack';
      placeFieldCards(owner.field, aurora, fodder); placeFieldCards(opponent.field, attacker);
      if (redirected) placeFieldCards(opponent.field, make(273, opponent));
      game.phase = 'battle'; game.battleStep = 'battle';
      const combat = game.resolveCombat(attacker, aurora);
      await completeTestSelections(game, combat);
      assert.equal(required(await combat).ok, true);
      assert.equal(owner.field.includes(aurora), !redirected, 'banishment cannot satisfy send-to-GY replacement');
      assert.equal(owner.banished.includes(fodder), redirected);
      assert.equal(owner.graveyard.includes(fodder), !redirected);
      assert.equal(owner.banished.includes(aurora), redirected);
    });
  }
  for (const replacement of [false, true]) {
    test(`equal-ATK destruction remains sequential and atomic: replacement=${replacement}, seat=${seat}, controller=${controller}`, async t => {
      const { game, owner, opponent, make, monster } = setup(t, seat, controller);
      const attacker = monster(2800), defender = replacement ? make(159) : monster(2800, owner);
      attacker.position = defender.position = 'attack';
      placeFieldCards(owner.field, defender); placeFieldCards(opponent.field, attacker);
      const fodder = make(158);
      if (replacement) placeFieldCards(owner.field, fodder);
      const destructionEvents: { card: EventCard | undefined, group: unknown }[] = [];
      game.on('battle_destroy', e => { destructionEvents.push({ card: e.destroyed, group: e.atomicGroupId }); });
      game.phase = 'battle'; game.battleStep = 'battle';
      const combat = game.resolveCombat(attacker, defender);
      await completeTestSelections(game, combat);
      assert.equal(required(await combat).ok, true);
      assert.ok(opponent.graveyard.includes(attacker));
      assert.equal(owner.graveyard.includes(defender), !replacement);
      assert.equal(owner.field.includes(defender), replacement);
      assert.deepEqual(destructionEvents.map(e => e.card), replacement ? [attacker] : [attacker, defender]);
      if (!replacement) assert.equal(destructionEvents[0]?.group, destructionEvents[1]?.group);
      else assert.ok(owner.graveyard.includes(fodder));
      assert.equal(game.chainSystem.pendingTriggerOccurrences.length, 0);
      assert.equal(game.chainSystem.isOpenGameState(), true);
    });
  }
}
}

for (const cause of ['battle', 'effect'] as const) {
  for (const negated of ['source', 'target', 'neither'] as const) {
    test(`external replacement checks its source, not the protected target (${cause}/${negated})`, async t => {
      const { game, owner, opponent, monster } = setup(t, 'player', 'ai');
      const target = monster(1500, owner), attacker = monster(3000);
      const source = new Card({ name: 'Generic replacement source', cardKind: 'spell', subtype: 'continuous',
        effects: [{ id: 'external_guard', timing: 'passive', requireZone: 'spellTrap', requireFaceup: true,
          replacementEffect: { type: 'destruction', reason: 'any', auto: true, targetOwner: 'self', targetZones: ['field'] } }],
      }, owner.id);
      placeFieldCards(owner.field, target); placeFieldCards(opponent.field, attacker);
      placeFieldCards(owner.spellTrap, source);
      if (negated !== 'neither') await game.effectEngine.applyActions([
        { type: 'add_status', targetRef: 'chosen', status: 'effectsNegated', value: true },
      ], { source: attacker, player: opponent, opponent: owner }, { chosen: [negated === 'source' ? source : target] });
      const result = await game.destroyCard(target, { cause, sourceCard: attacker });
      assert.ok('destroyed' in result);
      assert.equal(result.destroyed, negated === 'source');
      assert.equal(owner.field.includes(target), negated !== 'source');
    });
  }
}

test('a resolved temporary replacement survives later negation of its source', async t => {
  const { game, owner, opponent, monster } = setup(t, 'player', 'ai');
  const source = monster(1000, owner), target = monster(1500, owner), attacker = monster(3000);
  placeFieldCards(owner.field, source, target); placeFieldCards(opponent.field, attacker);
  await game.effectEngine.applyActions([{ type: 'register_replacement_effect', duration: 'end_of_turn', uses: 1,
    replacementEffect: { type: 'destruction', reason: 'any', auto: true, targetOwner: 'self', targetZones: ['field'] },
  }], { source, player: owner, opponent }, {});
  await game.effectEngine.applyActions([{ type: 'add_status', targetRef: 'chosen', status: 'effectsNegated', value: true }],
    { source: attacker, player: opponent, opponent: owner }, { chosen: [source] });
  assert.equal(source.effectsNegated, true);
  const first = await game.destroyCard(target, { cause: 'effect', sourceCard: attacker });
  assert.ok('destroyed' in first && first.destroyed === false);
  assert.equal(game.temporaryReplacementEffects.length, 0);
  const second = await game.destroyCard(target, { cause: 'effect', sourceCard: attacker });
  assert.ok('destroyed' in second && second.destroyed === true);
});

test('a token removed from the game cannot satisfy a replacement GY cost', async t => {
  const { game, owner, make } = setup(t, 'player', 'ai');
  const target = make(159), token = new Card({ name: 'Luminarch cost token', cardKind: 'monster',
    archetype: 'Luminarch', atk: 0, def: 0, level: 1, effects: [] }, owner.id);
  token.isToken = true;
  placeFieldCards(owner.field, target, token);
  const result = await game.destroyCard(target, { cause: 'battle' });
  assert.ok('destroyed' in result && result.destroyed === true);
  assert.equal(owner.field.includes(token), false);
  assert.equal(owner.graveyard.includes(token), false);
});
