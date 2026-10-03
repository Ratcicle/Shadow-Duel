import assert from 'node:assert/strict';
import test from 'node:test';
import Card from '../../src/core/Card.js';
import Bot from '../../src/core/Bot.js';
import MirageboundStrategy from '../../src/core/ai/MirageboundStrategy.js';
import type { BotCloneGamePort } from '../../src/core/bot/simulationBridge.js';
import { createRuntimeGame, placeFieldCards, completeTestSelections } from '../helpers/game.js';
import { cardDefinition, required, unsafeFixture } from '../helpers/fixtures.js';
import { createCanonicalStateSnapshot } from '../../src/core/game/replay/canonical.js';
import { createPlanningCopy } from '../../src/core/ai/common/planningCopy.js';
import { applySimulatedActions } from '../../src/core/ai/common/simulatedActions/index.js';
import { simulationState } from '../helpers/simulation.js';

const priestessEffect = 'miragebound_sand_priestess_shift_debuff';
for (const actor of ['player', 'bot'] as const) for (const scenario of ['attack', 'defense', 'facedown', 'locked'] as const) {
  test(`Sand Priestess switch/debuff runtime versus generated simulation (${actor}/${scenario})`, async t => {
    const bot = new Bot('miragebound'); bot.id = actor;
    const game = createRuntimeGame({ ...(actor === 'bot' ? { opponentOverride: bot } : {}),
      laboratoryMode: true, captureReplay: false, randomSeed: 42, chainResponseTimeoutMs: 0 });
    if (actor === 'player') game.player = unsafeFixture<typeof game.player>(bot, 'Concrete Bot supplies Player methods in inverted seat.');
    bot.game = unsafeFixture<NonNullable<typeof bot.game>>(game, 'Concrete Game implements Bot runtime port after seat reassignment.');
    t.after(() => game.dispose());
    const owner = game[actor], opponent = game[actor === 'player' ? 'bot' : 'player'];
    game.turn = actor; game.phase = 'main1'; game.turnCounter = 3;
    owner.controllerType = opponent.controllerType = 'human';
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.ui.showConfirmPrompt = async () => true;
    game.ui.showChainResponseModal = async () => null;
    game.chainSystem.botChooseChainResponse = async () => null;
    const priestess = new Card(cardDefinition(357), owner.id);
    const target = new Card(cardDefinition(1), opponent.id);
    if (scenario === 'locked') owner.hand.push(priestess);
    else placeFieldCards(owner.field, priestess);
    placeFieldCards(opponent.field, target);
    if (scenario === 'defense' || scenario === 'facedown') target.position = 'defense';
    if (scenario === 'facedown') target.isFacedown = true;
    if (scenario === 'locked') {
      const leviathan = new Card(cardDefinition(27), owner.id);
      const discard = new Card(cardDefinition(4), owner.id);
      placeFieldCards(owner.field, leviathan); owner.hand.push(discard);
      let selectedLock = false;
      game.ui.showChainResponseModal = async candidates => {
        const option = candidates.find(candidate => candidate.card === leviathan);
        if (!selectedLock && option) { selectedLock = true; return option; }
        return null;
      };
      const locking = game.performNormalSummon(owner, 0, 'attack', false);
      await completeTestSelections(game, locking);
      assert.equal(required(await locking).success, true, 'public Normal Summon creates the real response window');
      assert.equal(selectedLock, true, 'Leviathan must be offered and chosen as a legal Chain response');
      game.ui.showChainResponseModal = async () => null;
      assert.equal(owner.graveyard.includes(discard), true, 'actual discard cost is paid');
      assert.equal(target.battlePositionLocked, true);
      assert.equal(target.isFacedown, true);
    }
    const strategy = new MirageboundStrategy(bot); bot.strategy = strategy;
    const state = bot.cloneGameState(unsafeFixture<BotCloneGamePort>(game, 'Concrete Game supplies normal Bot cloning capabilities.'));
    const actions = strategy.generateMainPhaseActions(state);
    const action = required(actions.find(a => a.cardId === 357 && a.effectId === priestessEffect), 'real strategy must generate this effect');
    const initial = { atk: target.atk, def: target.def, position: target.position, facedown: target.isFacedown };
    const snapshot = createCanonicalStateSnapshot(game);
    strategy.simulateMainPhaseAction(state, action);
    const projected = required(state.player.field.find(c => c.instanceId === target.instanceId));
    assert.deepEqual(createCanonicalStateSnapshot(game), snapshot, 'simulation must not mutate live state');
    const shifts: unknown[] = [];
    game.on('position_change', event => { if (event.card === target) shifts.push({ from: event.fromPosition, to: event.toPosition }); });
    const activating = game.tryActivateMonsterEffect(priestess, null, 'field', owner, { effectId: priestessEffect });
    await completeTestSelections(game, activating);
    const activation = await activating;
    const runtime = { atk: target.atk, def: target.def, position: target.position, facedown: target.isFacedown };
    const sim = { atk: projected.atk, def: projected.def, position: projected.position, facedown: projected.isFacedown };
    assert.equal(activation.ok, scenario !== 'locked');
    assert.equal(shifts.length, scenario === 'locked' ? 0 : 1);
    assert.equal(target.atk, initial.atk - (scenario === 'locked' ? 0 : 500));
    assert.equal(target.def, initial.def - (scenario === 'locked' ? 0 : 500));
    assert.deepEqual(sim, runtime, 'projection must honor the successful position-change prerequisite');
  });
}

for (const seat of ['player', 'bot'] as const) for (const locked of [false, true]) for (const missingCandidate of [false, true]) {
  test(`False Horizon simulation requires a successful switch before optional return (${seat}/locked=${locked}/missingCandidate=${missingCandidate})`, () => {
    const other = seat === 'player' ? 'bot' : 'player';
    const clone = createPlanningCopy();
    const source = clone.cloneCardForSim(new Card(cardDefinition(360), seat));
    const returned = clone.cloneCardForSim(new Card(cardDefinition(357), seat));
    returned.isFacedown = missingCandidate;
    const target = clone.cloneCardForSim(new Card(cardDefinition(1), other));
    target.position = 'attack'; target.battlePositionLocked = locked;
    const state = simulationState({ [seat]: { field: [returned], spellTrap: [source] }, [other]: { field: [target] } });
    const effect = required(cardDefinition(360).effects?.find(entry => entry.id === 'miragebound_false_horizon_attack'));
    applySimulatedActions({ state, selfId: seat, actions: effect.actions, options: { sourceCard: source, effect }, selections: {
      miragebound_false_horizon_position_target: [target],
    } });
    assert.equal(target.position, locked ? 'attack' : 'defense');
    const returns = !locked && !missingCandidate;
    assert.equal(state[seat].hand.includes(returned), returns);
    assert.equal(state[seat].field.includes(returned), !returns);
    assert.deepEqual(state._simUnsupportedActions || [], [], 'a failed prerequisite or absent optional candidate is supported');
  });
}

for (const flags of [{}, { haltOnFailure: true }, { haltOnFailure: false }, { stopOnFailure: false },
  { haltOnFailure: false, stopOnFailure: true }] as const) {
  for (const available of ['none', 'locked', 'mixed'] as const) {
    test(`simulated switch result ${available}/${JSON.stringify(flags)}`, () => {
      const clone = createPlanningCopy();
      const locked = clone.cloneCardForSim(new Card(cardDefinition(1), 'player'));
      const movable = clone.cloneCardForSim(new Card(cardDefinition(1), 'player'));
      locked.battlePositionLocked = true;
      const targets = available === 'none' ? [] : available === 'locked' ? [locked] : [locked, movable];
      const state = simulationState({ player: { field: targets } });
      const lp = state.bot.lp;
      const action = { type: 'switch_position' as const, targetRef: 'target', ...flags };
      const canContinue = available === 'mixed' || (!('stopOnFailure' in flags && flags.stopOnFailure === true)
        && ('haltOnFailure' in flags && flags.haltOnFailure === false || 'stopOnFailure' in flags && flags.stopOnFailure === false));
      const result = applySimulatedActions({ state, selections: { target: targets }, actions: [action, { type: 'heal', amount: 100 }] });
      assert.equal(result, canContinue);
      assert.equal(state.bot.lp, lp + (canContinue ? 100 : 0));
    });
  }
}

test('optional action cannot continue past the unknown draw/summon boundary', () => {
  const card = createPlanningCopy().cloneCardForSim(new Card(cardDefinition(1), 'bot'));
  const state = simulationState({ bot: { deck: [card] } });
  const lp = state.bot.lp;
  assert.equal(applySimulatedActions({ state, actions: [
    { type: 'draw_and_summon', optional: true }, { type: 'heal', amount: 100 },
  ] }), false);
  assert.equal(state.bot.lp, lp);
  assert.equal(state.bot.field.length, 0);
  assert.equal(state.bot.hand.length, 1);
  assert.equal(state._simRequiresReplan, true);
});
