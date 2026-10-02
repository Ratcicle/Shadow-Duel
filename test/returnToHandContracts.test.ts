import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Card from '../src/core/Card.js';
import { cardDefinition } from './helpers/fixtures.js';
import { createRuntimeGame, placeFieldCards } from './helpers/game.js';

function setup(t: TestContext, seat: 'player' | 'bot' = 'player') {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false,
    captureReplay: false, chainResponseTimeoutMs: 0, randomSeed: 42 });
  t.after(() => game.dispose());
  game.turn = seat;
  game.phase = 'main1';
  game.turnCounter = 4;
  game.player.controllerType = game.bot.controllerType = 'ai';
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
  game.chainSystem.botChooseChainResponse = async () => null;
  const owner = game[seat];
  const opponent = game[seat === 'player' ? 'bot' : 'player'];
  const make = (id: number, player = owner) => {
    const card = new Card(cardDefinition(id), player.id);
    card.isFacedown = false;
    card.position = 'attack';
    return card;
  };
  return { game, owner, opponent, make };
}

for (const requireDestination of [false, true]) {
  test(`successful redirected return retains the requireDestination contract (${requireDestination})`, async t => {
    const { game, owner, opponent, make } = setup(t);
    const source = make(355), target = make(351);
    placeFieldCards(owner.field, source, target);
    target.banishWhenLeavesField = true;
    const events: string[] = [];
    game.on('card_moved', event => { if (event.card === target) events.push(event.toZone); });
    const result = await game.effectEngine.applyActions([
      { type: 'return_to_hand', targetRef: 'returned', requireDestination },
    ], { source, player: owner, opponent }, { returned: [target] });
    assert.equal(result.success, !requireDestination);
    assert.ok(owner.banished.includes(target));
    assert.equal(owner.hand.includes(target), false);
    assert.deepEqual(events, ['banished']);
    assert.equal(target.locationVersion, 1);
  });
}

for (const seat of ['player', 'bot'] as const) {
  for (const locked of [false, true]) {
    test(`Vanishing Step retains redirected return and dependent debuff (${seat}/locked=${locked})`, async t => {
      const { game, owner, opponent, make } = setup(t, seat);
      const step = make(361), viper = make(356), target = make(1, opponent);
      owner.hand.push(step);
      placeFieldCards(owner.field, viper);
      placeFieldCards(opponent.field, target);
      // Reduced post-summon status; Glass Viper's return trigger produces this flag.
      viper.banishWhenLeavesField = true;
      target.battlePositionLocked = locked;
      const atk = target.atk, def = target.def;
      const events: string[] = [];
      game.on('card_moved', event => { if (event.card === viper) events.push(event.toZone); });
      const activation = await game.tryActivateSpell(step, 0, {
        miragebound_vanishing_step_return_target: [viper],
        miragebound_vanishing_step_position_target: [target],
      }, { owner });
      assert.equal(activation.success, !locked);
      assert.ok(owner.banished.includes(viper));
      assert.equal(owner.hand.includes(viper), false);
      assert.deepEqual(events, ['banished']);
      assert.equal(target.position, locked ? 'attack' : 'defense');
      assert.equal(target.atk, atk - (locked ? 0 : 500));
      assert.equal(target.def, def - (locked ? 0 : 500));
    });
  }
  for (const entry of ['moveCard', 'Sovereign', 'Assembly then Sovereign'] as const) {
    test(`protected redirected bounce preserves field presence: ${entry}, ${seat}`, async t => {
      const { game, owner, opponent, make } = setup(t, seat);
      const source = make(355), ownTarget = make(351);
      const phoenix = make(514, opponent), target = make(501, opponent);
      placeFieldCards(owner.field, source, ownTarget);
      placeFieldCards(opponent.field, phoenix);
      if (entry === 'Assembly then Sovereign') {
        const assembly = make(519, opponent);
        const costs = [make(502, opponent), make(509, opponent)];
        opponent.hand.push(assembly);
        opponent.graveyard.push(...costs);
        opponent.deck.push(target);
        game.turn = opponent.id;
        const summoned = await game.tryActivateSpell(assembly, 0,
          { tech_zero_assembly_line_banish_cost: costs }, { owner: opponent });
        assert.equal(summoned.success, true);
        assert.ok(opponent.field.includes(target));
        assert.equal(target.banishWhenLeavesField, true, 'real Assembly Line sets departure status');
        game.turn = owner.id;
      } else {
        placeFieldCards(opponent.field, target);
        // Reduced fixture; the third variant establishes this through the public spell flow.
        target.banishWhenLeavesField = true;
      }
      const version = target.locationVersion;
      const movements: unknown[] = [];
      game.on('card_moved', event => { if (event.card === target) movements.push(event); });
      if (entry === 'moveCard') {
        const result = await game.moveCard(target, opponent, 'hand', { fromZone: 'field',
          sourceCard: source, movedByEffect: true, awaitCardMovedEvent: true });
        assert.equal(result.success, false);
        assert.equal(result.reason, 'banish_protected');
      } else {
        const result = await game.tryActivateMonsterEffect(source, {
          miragebound_glass_sovereign_return_self_target: [ownTarget],
          miragebound_glass_sovereign_return_opponent_target: [target],
        }, 'field', owner, { effectId: 'miragebound_glass_sovereign_bounce' });
        assert.equal(result.success, false, 'the refused second movement reports partial resolution failure');
        assert.ok(owner.hand.includes(ownTarget), 'first target returns normally');
      }
      assert.ok(opponent.field.includes(target), 'movement rejected by banish protection must preserve field presence');
      assert.equal(opponent.hand.includes(target), false);
      assert.equal(target.locationVersion, version);
      assert.equal(movements.length, 0);
    });
  }

}
