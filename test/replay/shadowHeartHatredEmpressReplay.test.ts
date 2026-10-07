import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_REPLAY_ENGINE_VERSION, type ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, hashCanonicalGameState, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { setLocale } from "../../src/core/i18n.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, type RuntimeGame } from "../helpers/game.js";

const summonEffectId = "shadow_heart_hatred_empress_summon";
const negateEffectId = "shadow_heart_hatred_empress_negate";

/** Human choices are submitted through the real session and DecisionBroker. */
async function finishChoices(game: RuntimeGame, action: Promise<unknown>, search: boolean): Promise<void> {
  let done = false;
  let failure: unknown;
  const completion = action.then(() => { done = true; }, error => { done = true; failure = error; });
  const submitted = new Set<number>();
  const resolutions = new Set<Promise<void>>();
  for (let attempt = 0; attempt < 3000; attempt++) {
    const session = game.targetSelection;
    if (session && !submitted.has(session.sessionId)) {
      submitted.add(session.sessionId);
      for (const requirement of session.requirements) {
        const amount = requirement.id === "hatred_empress_search" ? Number(search) : requirement.min;
        session.selections[requirement.id] = requirement.candidates.slice(0, amount).map(candidate => candidate.key);
      }
      const resolution = game.finishTargetSelection();
      resolutions.add(resolution);
      void resolution.then(() => resolutions.delete(resolution), error => { failure = error; resolutions.delete(resolution); });
    }
    if (done && !game.targetSelection && resolutions.size === 0) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done, "all effect choices must complete");
  assert.equal(game.targetSelection, null);
  assert.equal(resolutions.size, 0);
  await completion;
  if (failure) throw failure;
}

for (const search of [false, true]) {
  test(`Hatred Empress canonical commands replay costs, optional search=${search} and persistent ATK`, { timeout: 15000 }, async t => {
    setLocale("en");
    const live = createRuntimeGame({ captureReplay: true, randomSeed: 20261007, laboratoryMode: true,
      laboratoryUseBot: false, chainResponseTimeoutMs: 0, getFieldPlacementMode: () => "manual",
      fieldPlacementProvider: async request => ({ outcome: "chosen", slot: required(request.candidates.at(-1)).slot }) });
    const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true,
      laboratoryUseBot: false, chainResponseTimeoutMs: 0,
      fieldPlacementProvider: async () => assert.fail("playback must consume field placement decisions") });
    t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
    for (const game of [live, playback]) {
      game.player.controllerType = game.bot.controllerType = "human";
      game.disablePresentationDelays = true;
      game.phaseDelayMs = 0;
    }
    live.ui.showChainResponseModal = async () => null;
    live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
    live.ui.showConfirmPrompt = async () => false;
    playback.ui.showChainResponseModal = async () => assert.fail("playback must consume Chain decisions");
    playback.ui.showSpecialSummonPositionModal = () => assert.fail("playback must consume position decisions");
    playback.ui.showConfirmPrompt = async () => assert.fail("playback must consume confirmation decisions");
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
      startAtDrawPhase: true, startingPlayer: "bot", announceStartingPlayer: false,
      playerDeck: [101, 127, 101, 101, 1, 127, ...Array<number>(14).fill(3)].reverse(),
      botDeck: [1, 4, 4, 3, ...Array<number>(16).fill(3)].reverse(), playerExtraDeck: [], botExtraDeck: [] });
    await live.skipToPhase("main1");
    await live.performNormalSummon(live.bot, live.bot.hand.findIndex(card => card.id === 1), "attack", false);
    for (let index = 0; index < 2; index++) {
      const spell = required(live.bot.hand.find(card => card.id === 4));
      const action = live.tryActivateSpell(spell, live.bot.hand.indexOf(spell), null, { owner: live.bot });
      await finishChoices(live, action, search);
      const spellResult = await action;
      assert.equal(spellResult.success, true, spellResult.reason ?? "token spell must resolve");
    }
    assert.equal(live.bot.field.length, 3);
    await live.skipToPhase("end");
    assert.equal(live.turn, "player");
    assert.equal(live.phase, "main1");
    await live.performNormalSummon(live.player, live.player.hand.findIndex(card => card.id === 101), "attack", false);
    const ally = required(live.player.field.find(card => card.id === 101));
    const empress = required(live.player.hand.find(card => card.id === 127));
    const discarded = live.player.hand.filter(card => card.id === 101);
    assert.equal(discarded.length, 2);
    const moves: string[] = [];
    live.on("card_moved", event => {
      if (discarded.some(card => card === event.card)) moves.push(`${event.contextLabel}:${event.toZone}`);
      if (event.card === empress) moves.push(`empress:${event.contextLabel}:${event.toZone}`);
    });
    live.on("effect_activated", event => {
      if (event.effect?.id === summonEffectId) {
        assert.ok(discarded.every(card => live.player.graveyard.includes(card)), "discards are paid before publication");
        assert.ok(live.player.hand.includes(empress));
        assert.equal(live.player.field.includes(empress), false);
      }
      if (event.effect?.id === negateEffectId) {
        assert.ok(live.player.graveyard.includes(empress), "self tribute is paid before publication");
        assert.equal(live.player.field.includes(empress), false);
        assert.ok(live.bot.field.every(card => card.effectsNegated !== true), "negation waits for resolution");
      }
    });
    const handAction = live.tryActivateMonsterEffect(empress, null, "hand", live.player, { effectId: summonEffectId });
    await finishChoices(live, handAction, search);
    assert.equal((await handAction).success, true);
    assert.equal(empress.position, "defense");
    assert.ok(live.player.field.includes(empress));
    assert.equal(live.player.hand.filter(card => card.id === 127).length, Number(search));
    assert.deepEqual(moves.slice(0, 2), ["discard:graveyard", "discard:graveyard"]);
    const fieldAction = live.tryActivateMonsterEffect(empress, null, "field", live.player, { effectId: negateEffectId });
    await finishChoices(live, fieldAction, search);
    assert.equal((await fieldAction).success, true);
    assert.ok(live.player.graveyard.includes(empress));
    assert.equal(live.player.field.includes(empress), false);
    assert.ok(moves.includes("empress:tribute_cost:graveyard"));
    assert.ok(live.bot.field.every(card => card.effectsNegated === true));
    assert.equal(ally.atk, 2500, "three newly negated monsters grant 900 ATK");
    const beforeEnd = createCanonicalStateSnapshot(live);
    assert.deepEqual(required(beforeEnd.players.player.zones.field.find(card => card?.duelCardId === ally.duelCardId)).statBuffContributions,
      [{ atk: 900, def: 0, duration: "while_faceup" }]);
    await live.skipToPhase("end");
    assert.equal(live.turn, "bot");
    assert.ok(live.bot.field.every(card => card.effectsNegated !== true));
    assert.equal(ally.atk, 2500, "ATK persists after end-turn negation cleanup");
    const afterEnd = createCanonicalStateSnapshot(live);
    assert.deepEqual(required(afterEnd.players.player.zones.field.find(card => card?.duelCardId === ally.duelCardId)).statBuffContributions,
      [{ atk: 900, def: 0, duration: "while_faceup" }]);
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "hatred-empress" }))));
    assert.equal(replay.schemaVersion, 2);
    assert.equal(replay.engineVersion, CANONICAL_REPLAY_ENGINE_VERSION);
    assert.equal(replay.commands.filter(command => command.type === "activate_effect" && command.payload.cardId === 127).length, 2);
    assert.ok(replay.decisions.some(decision => decision.kind === "field_placement"));
    assert.equal(replay.decisions.filter(decision => decision.kind === "choice" &&
      "candidateKey" in decision.value && decision.value.candidateKey === "defense").length, 3,
    "two Tokens and the Empress record manual Defense Position choices");
    const searchDecision = required(replay.decisions.find(decision => decision.kind === "target" &&
      "selections" in decision.value && "hatred_empress_search" in decision.value.selections));
    assert.ok("selections" in searchDecision.value);
    assert.equal(required(searchDecision.value.selections.hatred_empress_search).length, Number(search),
      "accepting or declining the optional search is recorded explicitly");
    const costDecision = required(replay.decisions.find(decision => decision.kind === "cost" &&
      "selections" in decision.value && "hatred_empress_discard" in decision.value.selections));
    assert.ok("selections" in costDecision.value);
    assert.deepEqual(required(costDecision.value.selections.hatred_empress_discard).map(card =>
      "duelCardId" in card ? card.duelCardId : null), discarded.map(card => card.duelCardId));
    setLocale("pt-br");
    const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "The concrete Game supplies canonical replay capabilities.") });
    assert.equal(result.ok, true);
    assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(createCanonicalStateSnapshot(playback), afterEnd);
    assert.equal(hashCanonicalGameState(playback), hashCanonicalGameState(live));
    assert.notEqual(playback.player.graveyard.find(card => card.id === 127)?.instanceId, empress.instanceId);
  });
}
