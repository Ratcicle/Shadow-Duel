import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from '../helpers/game.js';
import { required, unsafeFixture } from '../helpers/fixtures.js';
import { createCanonicalStateSnapshot, validateCanonicalReplay } from '../../src/core/game/replay/canonical.js';
import { replayCanonicalDuel } from '../../src/core/game/replay/driver.js';
import type { ReplayDriverGamePort } from '../../src/core/contracts/replay.js';

type Seat = 'player' | 'bot';
type Variant = 'attack' | 'facedown' | 'locked' | 'decline' | 'locked-decline';
type Family = 'priestess' | 'horizon';
const ids = { priestess: 'miragebound_sand_priestess_shift_debuff', horizon: 'miragebound_false_horizon_attack' };
function install(game: RuntimeGame, actor: Seat, family: Family, variant: Variant) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = actor; game.phase = 'main1'; game.turnCounter = 3;
    game.disablePresentationDelays = true; game.phaseDelayMs = 0;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = 'human';
    for (const player of [game.player, game.bot]) player.deck.push(...player.hand.splice(0));
    const owner = game[actor], opponent = game[actor === 'player' ? 'bot' : 'player'];
    const take = (player: typeof owner, id: number) => {
      const zone = player.deck.some(card => card.id === id) ? player.deck : player.extraDeck;
      const card = required(zone.find(card => card.id === id));
      zone.splice(zone.indexOf(card), 1); card.isFacedown = false; card.position = 'attack'; return card;
    };
    placeFieldCards(owner.field, take(owner, 27));
    owner.hand.push(take(owner, 357), take(owner, 4));
    const target = take(opponent, 1); placeFieldCards(opponent.field, target);
    if (variant === 'facedown') { target.position = 'defense'; target.isFacedown = true; }
    if (family === 'horizon') {
      const trap = take(owner, 360); trap.isFacedown = true; trap.setTurn = 1;
      placeFieldCards(owner.spellTrap, trap);
      placeFieldCards(opponent.field, take(opponent, 1));
    }
  };
}
async function drive(game: RuntimeGame, pending: Promise<unknown>, variant: Variant) {
  let done = false, failure: unknown;
  const tasks = new Set<Promise<void>>();
  const completion = pending.then(() => { done = true; }, error => { failure = error; done = true; });
  for (let n = 0; n < 3000; n++) {
    const session = game.targetSelection;
    if (session) {
      if (variant.endsWith('decline') && session.requirements.some(requirement => requirement.id === 'miragebound_false_horizon_return_target')) {
        game.cancelTargetSelection();
      } else {
        for (const requirement of session.requirements) {
          session.selections[requirement.id] = requirement.candidates.slice(0, requirement.min).map(card => card.key);
        }
        const task = game.finishTargetSelection(); tasks.add(task);
        void task.then(() => tasks.delete(task), error => { failure = error; tasks.delete(task); });
      }
    }
    if (done && !game.targetSelection && !tasks.size) break;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done && !game.targetSelection && !tasks.size, 'all decisions finish');
  await completion; if (failure) throw failure;
}
for (const actor of ['player', 'bot'] as const) for (const family of ['priestess', 'horizon'] as const) {
  for (const variant of (family === 'priestess' ? ['attack', 'facedown', 'locked'] : ['attack', 'facedown', 'locked', 'decline', 'locked-decline']) as Variant[]) {
    test(`switch_position runtime and replay ${actor}/${family}/${variant}`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: true, randomSeed: 42, chainResponseTimeoutMs: 0 });
      const playback = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, replayMode: 'playback', chainResponseTimeoutMs: 0 });
      t.after(() => { game.dispose(); playback.dispose(); });
      install(game, actor, family, variant); install(playback, actor, family, variant);
      let choseLock = false, choseHorizon = false;
      game.ui.showConfirmPrompt = async () => true;
      game.ui.showChainResponseModal = async candidates => {
        const lock = candidates.find(candidate => candidate.card?.id === 27);
        if (variant.startsWith('locked') && !choseLock && lock) { choseLock = true; return lock; }
        const horizon = candidates.find(candidate => candidate.card?.id === 360);
        if (family === 'horizon' && !choseHorizon && horizon) { choseHorizon = true; return horizon; }
        return null;
      };
      game.chainSystem.botChooseChainResponse = async () => null;
      playback.ui.showConfirmPrompt = async () => assert.fail('playback cannot request consent');
      playback.ui.showChainResponseModal = async () => assert.fail('playback cannot request responses');
      playback.ui.showTargetSelection = () => assert.fail('playback cannot request targets');
      playback.autoSelector.select = () => assert.fail('playback cannot rerun selection AI');
      const deck = [357, 360, 4, 1, 4, 1, 4, 1, 4, 1];
      await game.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true,
        startingPlayer: actor, announceStartingPlayer: false, playerDeck: deck, botDeck: deck, playerExtraDeck: [27], botExtraDeck: [27] });
      const owner = game[actor], opponent = game[actor === 'player' ? 'bot' : 'player'];
      const priestess = required(owner.hand.find(card => card.id === 357));
      const target = required(opponent.field[0]);
      const summon = game.performNormalSummon(owner, owner.hand.indexOf(priestess), 'attack', false);
      await drive(game, summon, variant);
      assert.equal((await summon)?.success, true);
      assert.equal(target.battlePositionLocked, variant.startsWith('locked'));
      if (variant.startsWith('locked')) assert.equal(owner.graveyard.some(card => card.id === 4), true);
      const shifts: unknown[] = [], returns: unknown[] = [];
      game.on('position_change', event => { if (event.card === target) shifts.push({ from: event.fromPosition, to: event.toPosition }); });
      game.on('card_moved', event => { if (event.card === priestess && event.toZone === 'hand') returns.push({ effectId: event.effectId, from: event.fromZone }); });
      if (family === 'priestess') {
        const before = { atk: target.atk, def: target.def };
        const effect = game.tryActivateMonsterEffect(priestess, null, 'field', owner, { effectId: ids.priestess });
        await drive(game, effect, variant);
        const result = await effect;
        assert.equal(result.ok, !variant.startsWith('locked'));
        assert.equal(target.atk, before.atk - (variant.startsWith('locked') ? 0 : 500));
        assert.equal(target.def, before.def - (variant.startsWith('locked') ? 0 : 500));
      } else {
        await drive(game, game.skipToPhase('end'), variant);
        assert.equal(game.turn, opponent.id);
        await drive(game, game.skipToPhase('battle'), variant);
        const attacker = required(opponent.field.find(card => card !== target && card.id === 1));
        assert.equal(attacker.cardKind, 'monster');
        assert.equal(game.getAttackAvailability(attacker).ok, true, 'attack must be legal for the real monster');
        const combat = game.resolveCombat(attacker, priestess);
        await drive(game, combat, variant); await combat;
        assert.equal(choseHorizon, true, 'trap must be offered as a legal response to the public attack');
        assert.equal(owner.graveyard.some(card => card.id === 360), true, 'trap resolves and cleans up');
        const shouldReturn = !variant.startsWith('locked') && !variant.endsWith('decline');
        assert.equal(owner.hand.includes(priestess), shouldReturn, 'optional return requires a successful position change');
        assert.equal(returns.length, shouldReturn ? 1 : 0);
      }
      assert.equal(shifts.length, variant.startsWith('locked') ? 0 : 1);
      const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(game.finalizeReplay({ reason: 'd7c2-switch-position' }))));
      const played = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, 'Concrete Game with the same initial fixture implements canonical playback.') });
      assert.equal(played.ok, true); assert.equal(played.finalStateHash, replay.result?.finalStateHash);
      assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
      assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(game));
      assert.deepEqual(playback.getRandomState(), game.getRandomState());
    });
  }
}

type AttackPresenceScenario = 'attacker_return' | 'defender_return' | 'sanctuary' | 'ambush' | 'stale_redirect';

function installAttackPresenceSetup(game: RuntimeGame, scenario: AttackPresenceScenario) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = 'player'; game.phase = 'battle'; game.battleStep = 'battle'; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = 'ai';
    for (const owner of [game.player, game.bot]) owner.deck.push(...owner.hand.splice(0));
    const take = (seat: Seat, id: number) => {
      const owner = game[seat], card = required(owner.deck.find(entry => entry.id === id));
      owner.deck.splice(owner.deck.indexOf(card), 1);
      card.position = 'attack'; card.isFacedown = false;
      return card;
    };
    const attacker = take('player', 1), defender = take('bot', 254);
    attacker.effects = [];
    attacker.atk = 3000;
    defender.effects = [];
    placeFieldCards(game.player.field, attacker);
    placeFieldCards(game.bot.field, defender);
    if (scenario === 'attacker_return' || scenario === 'defender_return') {
      const recycled = scenario === 'attacker_return' ? attacker : defender;
      recycled.effects = [{ id: 'replay_attack_presence_departure', timing: 'on_event', event: 'attack_declared',
        ...(scenario === 'attacker_return' ? { requireSelfAsAttacker: true } : { requireDefenderIsSelf: true }),
        triggerRequirement: 'mandatory', triggerTiming: 'if',
        actions: [{ type: 'move', targetRef: 'self', player: 'self', fromZone: 'field', to: 'graveyard' }] },
      { id: 'replay_attack_presence_return', timing: 'on_event', event: 'card_to_grave',
        triggerRequirement: 'mandatory', triggerTiming: 'if',
        actions: [{ type: 'special_summon_from_zone', zone: 'graveyard', requireSource: true, position: 'attack' }] }];
    } else {
      const trap = take('bot', scenario === 'sanctuary' ? 268 : 463);
      trap.isFacedown = true; trap.turnSetOn = trap.setTurn = 1;
      placeFieldCards(game.bot.spellTrap, trap);
      if (scenario !== 'sanctuary') game.bot.hand.push(take('bot', 451));
    }
  };
  if (scenario === 'stale_redirect') {
    const check = game.checkAndOfferTraps.bind(game);
    game.checkAndOfferTraps = async (event, payload) => {
      const result = await check(event, payload);
      if (event === 'attack_declared' && payload?.attackRedirect) {
        const redirected = required(game.bot.field.find(card => card.id === 451));
        assert.equal((await game.moveCard(redirected, game.bot, 'graveyard', { fromZone: 'field', awaitCardMovedEvent: true })).success, true);
        assert.equal((await game.moveCard(redirected, game.bot, 'field', { fromZone: 'graveyard', position: 'attack',
          isFacedown: false, summonMethod: 'special', summonOrigin: 'effect_resolution', resetAttackFlags: true,
          awaitCardMovedEvent: true })).success, true);
      }
      return result;
    };
  }
}

for (const scenario of ['attacker_return', 'defender_return', 'sanctuary', 'ambush', 'stale_redirect'] as const) {
  test(`attack presence runtime and canonical replay ${scenario}`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: true, randomSeed: 42, chainResponseTimeoutMs: 0 });
    const playback = createRuntimeGame({ laboratoryMode: true, captureReplay: false,
      replayMode: 'playback', chainResponseTimeoutMs: 0 });
    t.after(() => { game.dispose(); playback.dispose(); });
    installAttackPresenceSetup(game, scenario);
    installAttackPresenceSetup(playback, scenario);
    const trapId = scenario === 'sanctuary' ? 268 : 463;
    game.bot.strategy = { chooseChainResponse: ({ activatable }) =>
      activatable.find(candidate => candidate.card?.id === trapId) || { pass: true } };
    playback.ui.showChainResponseModal = async () => assert.fail('playback must use recorded responses');
    playback.ui.showTargetSelection = () => assert.fail('playback must use recorded targets');
    playback.autoSelector.select = () => assert.fail('playback must not recalculate target choices');
    const deck = [1, 254, 268, 463, 451, 1, 1, 1, 1, 1];
    await game.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true,
      startingPlayer: 'player', announceStartingPlayer: false, playerDeck: deck, botDeck: deck,
      playerExtraDeck: [], botExtraDeck: [] });
    const attacker = required(game.player.field[0]), defender = required(game.bot.field[0]);
    let damageSteps = 0, resolved = 0;
    game.on('damage_step', () => { damageSteps++; });
    game.on('combat_resolved', () => { resolved++; });
    const oldVersion = scenario === 'attacker_return' ? attacker.locationVersion : defender.locationVersion;
    assert.equal(required(await game.resolveCombat(attacker, defender)).ok, true);
    if (scenario === 'ambush') {
      assert.equal(damageSteps, 5); assert.equal(resolved, 1);
      assert.ok(game.bot.field.includes(defender));
      assert.ok(game.bot.graveyard.some(card => card.id === 451), 'redirected monster enters the actual battle');
    } else {
      assert.equal(damageSteps, 0); assert.equal(resolved, 0);
      assert.deepEqual([game.player.lp, game.bot.lp], [8000, 8000]);
      assert.ok(game.bot.field.includes(defender));
      if (scenario !== 'stale_redirect') {
        assert.ok((scenario === 'attacker_return' ? attacker : defender).locationVersion > oldVersion);
      }
    }
    assert.equal(attacker.attacksUsedThisTurn, scenario === 'attacker_return' ? 0 : 1);
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(game.finalizeReplay({ reason: `attack-presence-${scenario}` }))));
    const played = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback,
      'Concrete Game uses the identical deterministic presence fixture before live capture and playback.') });
    assert.equal(played.ok, true);
    assert.equal(played.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(game));
    assert.deepEqual(playback.getRandomState(), game.getRandomState());
  });
}
