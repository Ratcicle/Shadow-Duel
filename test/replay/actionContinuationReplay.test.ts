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
      for (const requirement of session.requirements) {
        const count = requirement.id === 'miragebound_false_horizon_return_target' ? (variant.endsWith('decline') ? 0 : 1) : requirement.min;
        session.selections[requirement.id] = requirement.candidates.slice(0, count).map(card => card.key);
      }
      const task = game.finishTargetSelection(); tasks.add(task);
      void task.then(() => tasks.delete(task), error => { failure = error; tasks.delete(task); });
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
        assert.equal(owner.hand.includes(priestess), !variant.endsWith('decline'), 'independent optional return survives a failed switch');
        assert.equal(returns.length, !variant.endsWith('decline') ? 1 : 0);
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
