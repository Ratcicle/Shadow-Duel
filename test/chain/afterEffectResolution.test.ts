import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../../src/core/Card.js";
import { validateEffectActionTree } from "../../src/core/CardDatabaseValidator.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import { FAST_EFFECT_ORIGINS } from "../../src/core/contracts/chain.js";
import { createCanonicalStateSnapshot, hashCanonicalGameState, validateCanonicalReplay, getCardDatabaseSignature } from "../../src/core/game/replay/canonical.js";
import { CANONICAL_REPLAY_ENGINE_VERSION } from "../../src/core/contracts/replay.js";
import { cardDefinition, required, selectionKey } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function replayWithState(snapshot: ReturnType<typeof createCanonicalStateSnapshot>) {
  return { format: "shadow-duel-canonical-replay", schemaVersion: 2,
    engineVersion: CANONICAL_REPLAY_ENGINE_VERSION, cardDatabaseSignature: getCardDatabaseSignature(),
    setup: { seed: 123, randomState: { seed: 123, state: 456, calls: 7 }, startingPlayer: "player",
      playerDeck: [{ id: 1, duelCardId: 1 }], playerExtraDeck: [], botDeck: [{ id: 2, duelCardId: 2 }], botExtraDeck: [] },
    commands: [], decisions: [], result: { finalState: snapshot } };
}

function scenario(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose("after_effect_test"));
  game.turn = "player"; game.phase = "main1"; game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.player.controllerType = game.bot.controllerType = "human";
  game.ui.showChainResponseModal = async () => null;
  game.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
  game.ui.showTriggerOrderModal = async options => options?.optional ? [] : (options?.candidates || []).map(c => c.candidateId);
  const make = (id: number) => new Card({ ...cardDefinition(id), effects: [] }, game.player.id);
  const add = (effect: EffectDefinition) => {
    const source = new Card({ ...cardDefinition(520), effects: [effect] }, game.player.id);
    source.isFacedown = false; placeFieldCards(game.player.spellTrap, source);
    const prepared = game.chainSystem.createPreparedActivation({ card: source, controller: game.player,
      effect, activationZone: "spellTrap", committed: true, cardActivation: true });
    const link = game.chainSystem.addToChain(prepared);
    assert.ok(link);
    return Object.assign(link, { card: source });
  };
  return { game, make, add };
}

test("afterResolutionActions is a separate reference-aware declarative root", () => {
  const effect = { id: "after_root", timing: "on_activate", actions: [{ type: "draw", amount: 1 }],
    afterResolutionActions: [{ type: "draw", amount: 1 }] } satisfies EffectDefinition;
  assert.deepEqual(validateEffectActionTree(effect).errors, []);
});

test("post-effect actions execute after completed and before the next older link", async t => {
  const { game, make, add } = scenario(t);
  for (let n = 0; n < 5; n++) game.player.deck.push(make(501));
  const older = add({ id: "older", timing: "on_activate", actions: [{ type: "draw", amount: 1 }] });
  const newer = add({ id: "newer", timing: "on_activate", actions: [{ type: "draw", amount: 1 }],
    afterResolutionActions: [{ type: "draw", amount: 2 }] });
  const counts: number[] = [];
  game.on("chain_link_resolution", event => { if (event.stage === "completed") counts.push(game.player.hand.length); });
  await game.chainSystem.resolveChain();
  assert.deepEqual(counts, [1, 4]);
  assert.equal(game.player.hand.length, 4);
  assert.ok(game.player.graveyard.includes(older.card));
  assert.ok(game.player.graveyard.includes(newer.card));
});

for (const chainLevel of [1, 2]) test(`post-effect Synchro opens an isolated summon attempt only in CL1 (CL${chainLevel})`, async t => {
  const { game, make, add } = scenario(t);
  const tuner = make(501), material = make(503), boss = make(510);
  game.player.graveyard.push(tuner); placeFieldCards(game.player.field, material); game.player.extraDeck.push(boss);
  if (chainLevel === 2) add({ id: "older", timing: "on_activate", actions: [] });
  const link = add({ id: "after_synchro", timing: "on_activate", actions: [{ type: "special_summon_from_zone",
    zone: "graveyard", filters: { archetype: "Tech-Zero", isTuner: true }, count: 1,
    selectionId: "revival", position: "attack", storeResultAs: "revived" }], afterResolutionActions: [{
      type: "conditional_actions", conditions: [{ type: "context_number_compare", key: "_actionTargets.revived.length", op: "gt", value: 0 }],
      actions: [{ type: "synchro_summon_from_extra_deck", position: "attack" }],
    }] });
  let attempts = 0, postPolicy: string | undefined, postSkipTiming: boolean | undefined, revivalHasPolicy = false;
  let procedureSnapshot: ReturnType<typeof createCanonicalStateSnapshot> | null = null;
  game.on("after_summon", payload => {
    if (payload.card === boss) {
      postPolicy = game.getSummonState().transaction?.negationWindowPolicy;
      postSkipTiming = game.getSummonState().transaction?.skipFinalTiming;
      procedureSnapshot = createCanonicalStateSnapshot(game);
    }
    if (payload.card === tuner) revivalHasPolicy = game.getSummonState().transaction?.negationWindowPolicy !== undefined;
  });
  const original = game.chainSystem.runFastEffectTiming.bind(game.chainSystem);
  game.chainSystem.runFastEffectTiming = async input => {
    if (input?.origin === FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT) {
      attempts++; assert.ok(game.player.spellTrap.includes(link.card), "parent source stays until parent finalization");
      assert.equal(game.chainSystem.pendingChainFinalizations.some(entry => entry.link === link), false, "child cannot finalize parent");
    }
    return await original(input);
  };
  const action = Promise.resolve(game.chainSystem.resolveChain());
  await completeTestSelections(game, action);
  assert.ok(game.player.field.includes(boss), JSON.stringify({ result: await action, field: game.player.field.map(c => c.name), refs: Object.keys(link.afterResolution?.context._actionTargets || {}) }, (_key, value: unknown) => typeof value === "object" && value && "instanceId" in value ? Reflect.get(value, "name") : value));
  assert.equal(attempts, chainLevel === 1 ? 1 : 0);
  assert.equal(postPolicy, chainLevel === 1 ? "auto" : "suppressed"); assert.equal(postSkipTiming, true);
  assert.equal(revivalHasPolicy, false, "ordinary effect summons preserve their snapshot shape");
  const snapshot = required<ReturnType<typeof createCanonicalStateSnapshot> | null>(procedureSnapshot);
  assert.doesNotThrow(() => validateCanonicalReplay(replayWithState(snapshot)));
  const bad = structuredClone(snapshot); Reflect.set(record(record(bad.summon).transaction), "negationWindowPolicy", "invalid");
  assert.throws(() => validateCanonicalReplay(replayWithState(bad)), /negationWindowPolicy/);
  assert.ok(game.player.graveyard.includes(link.card));
});

function synchroEffect(): EffectDefinition {
  return { id: "after_synchro", timing: "on_activate", actions: [{ type: "special_summon_from_zone",
    zone: "graveyard", filters: { archetype: "Tech-Zero", isTuner: true }, count: 1,
    selectionId: "revival", position: "attack", storeResultAs: "revived" }], afterResolutionActions: [{
      type: "conditional_actions", conditions: [{ type: "context_number_compare", key: "_actionTargets.revived.length", op: "gt", value: 0 }],
      actions: [{ type: "synchro_summon_from_extra_deck", position: "attack",
        previewPendingSummon: { zone: "graveyard", filters: { archetype: "Tech-Zero", isTuner: true } } }],
    }] };
}

test("post-effect preview checks the possible Synchro without fabricating revival results", t => {
  const { game, make, add } = scenario(t);
  const tuner = make(501), material = make(503), boss = make(510);
  game.player.graveyard.push(tuner); placeFieldCards(game.player.field, material);
  const link = add(synchroEffect());
  const context = { player: game.player, source: link.card, effect: synchroEffect(), _actionTargets: {} };
  assert.equal(game.effectEngine.checkActionPreviewRequirements(context.effect.actions || [], context).ok, false);
  game.player.extraDeck.push(boss);
  assert.equal(game.effectEngine.checkActionPreviewRequirements(context.effect.actions || [], context).ok, true);
  assert.deepEqual(context._actionTargets, {}, "preview cannot claim a successful revival");
  tuner.cannotBeSpecialSummoned = true;
  assert.equal(game.effectEngine.checkActionPreviewRequirements(context.effect.actions || [], context).ok, false);
});

test("potential preview preserves false guards, explicit empty results and producer cardinality", t => {
  const { game, make } = scenario(t);
  const tuner = make(501), material = make(503);
  game.player.graveyard.push(tuner); placeFieldCards(game.player.field, material);
  const base = synchroEffect();
  const wrapper = required(base.afterResolutionActions?.[0]);
  assert.equal(wrapper.type, "conditional_actions");
  if (wrapper.type !== "conditional_actions") return;
  const cases: { actions: NonNullable<EffectDefinition["actions"]>; conditions: NonNullable<typeof wrapper.conditions>; refs: Record<string, Card[]> }[] = [
    { actions: base.actions || [], conditions: [{ type: "context_number_compare", key: "unrelated", op: "gt", value: 0 }], refs: {} },
    { actions: base.actions || [], conditions: wrapper.conditions || [], refs: { revived: [] } },
    { actions: [], conditions: wrapper.conditions || [], refs: {} },
    { actions: base.actions || [], conditions: [{ type: "context_number_compare", key: "_actionTargets.revived.length", op: "eq", value: 2 }], refs: {} },
  ];
  for (const scenario of cases) {
    const effect: EffectDefinition = { ...base, actions: scenario.actions || [], afterResolutionActions: [{ ...wrapper, conditions: scenario.conditions }] };
    const context: Parameters<typeof game.effectEngine.checkActionPreviewRequirements>[1] = { player: game.player, effect, _actionTargets: scenario.refs };
    const before = JSON.stringify(context._actionTargets);
    assert.equal(game.effectEngine.checkActionPreviewRequirements(effect.actions || [], context).ok, true);
    assert.equal(JSON.stringify(context._actionTargets), before);
  }
  tuner.cannotBeSpecialSummoned = true;
  assert.equal(game.effectEngine.checkActionPreviewRequirements(base.actions || [], { player: game.player, effect: base }).ok, false);
});

test("CL1 child negation preserves parent source and queues triggers until parent cleanup", async t => {
  const { game, make, add } = scenario(t);
  const tuner = make(501), material = make(503), boss = make(510);
  game.player.graveyard.push(tuner); placeFieldCards(game.player.field, material); game.player.extraDeck.push(boss);
  const negator = new Card(cardDefinition(275), game.bot.id);
  negator.properSummonEstablished = true; negator.properSummonProcedure = "graveyard_banish_fusion";
  placeFieldCards(game.bot.field, negator);
  const link = add(synchroEffect());
  let used = false, parentCompleted = 0;
  game.on("chain_link_resolution", event => { if (event.linkId === link.linkId && event.stage === "completed") parentCompleted++; });
  game.ui.showChainResponseModal = async (candidates, context) => {
    assert.ok(game.player.spellTrap.includes(link.card));
    assert.equal(game.chainSystem.suspendedChainFrames.length, 1);
    const queued = game.chainSystem.pendingTriggerOccurrences.length;
    assert.ok(queued > 0);
    assert.equal((await game.flushPendingTriggerOccurrences()).deferred, true);
    assert.equal(game.chainSystem.pendingTriggerOccurrences.length, queued);
    if (context?.type === "summon_attempt" && !used) {
      const candidate = candidates.find(candidate => candidate.card === negator);
      if (candidate) { used = true; return candidate; }
    }
    return null;
  };
  const action = Promise.resolve(game.chainSystem.resolveChain());
  await completeTestSelections(game, action);
  assert.equal(used, true);
  assert.equal(parentCompleted, 1);
  assert.ok(game.player.graveyard.includes(boss));
  assert.ok(game.player.graveyard.includes(tuner));
  assert.ok(game.player.graveyard.includes(material));
  assert.ok(game.player.graveyard.includes(link.card));
  assert.equal(game.chainSystem.suspendedChainFrames.length, 0);
  assert.equal(game.chainSystem.getAfterResolutionState(), null);
  assert.ok(game.chainSystem.nextChainId > 2 && game.chainSystem.nextLinkId > 2);
});

test("child movement updates suspended source metadata and canonical frames are detached and deeply validated", async t => {
  const { game, make, add } = scenario(t);
  const tuner = make(501), material = make(503), boss = make(510);
  game.player.graveyard.push(tuner); placeFieldCards(game.player.field, material); game.player.extraDeck.push(boss);
  const link = add(synchroEffect());
  const original = game.chainSystem.runFastEffectTiming.bind(game.chainSystem);
  let inspected = false;
  game.chainSystem.runFastEffectTiming = async input => {
    if (input?.origin === FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT) {
      inspected = true;
      const state = createCanonicalStateSnapshot(game);
      const after = required(state.chain.afterResolution);
      assert.equal(typeof after, "object");
      const json = JSON.stringify(after);
      assert.equal(/"(?:instanceId|cardInstanceId|sourceInstanceId)"/.test(json), false);
      const replay = replayWithState;
      assert.doesNotThrow(() => validateCanonicalReplay(replay(state)));
      const phase = required(link.afterResolution);
      for (const actionIndex of [1, 2, 4]) {
        const beforeHash = hashCanonicalGameState(game);
        phase.actionIndex = actionIndex;
        assert.notEqual(hashCanonicalGameState(game), beforeHash);
        assert.equal(JSON.stringify(after), json, "canonical metadata must detach from its live frame");
        phase.actionIndex = 0;
      }
      const copy = structuredClone(state);
      const metadata = record(copy.chain.afterResolution);
      const frames = metadata.suspended;
      assert.ok(Array.isArray(frames));
      const active = record(record(frames[0]).afterResolution);
      Reflect.set(active, "actionIndex", -1);
      assert.throws(() => validateCanonicalReplay(replay(copy)), /actionIndex/);
      Reflect.set(active, "actionIndex", 0);
      Reflect.set(active, "results", { revived: [-1] });
      assert.throws(() => validateCanonicalReplay(replay(copy)), /results.revived/);
      for (const [field, invalidValue] of [["cardDuelCardId", -1], ["resolutionStatus", "unknown"], ["targetSelections", { wrong: [-1] }],
        ["latestSourceLocation", { controllerId: "player", zone: "wrong", faceUp: true, locationVersion: 0 }],
        ["declaredTargetSnapshots", [{ targetId: "ref", cards: [{ cardDuelCardId: -2, controllerId: "player", zone: "field", faceUp: true, locationVersion: 0 }] }]]] as const) {
        const bad = structuredClone(state), badFrames = record(bad.chain.afterResolution).suspended;
        assert.ok(Array.isArray(badFrames));
        const badLink = record(record(record(badFrames[0]).afterResolution).link);
        Reflect.set(badLink, field, invalidValue);
        assert.throws(() => validateCanonicalReplay(replay(bad)), new RegExp(field));
      }
      const badTiming = structuredClone(state), timingFrames = record(badTiming.chain.afterResolution).suspended;
      assert.ok(Array.isArray(timingFrames)); Reflect.set(record(timingFrames[0]), "timing", {});
      assert.throws(() => validateCanonicalReplay(replay(badTiming)), /timing.state/);
      await game.moveCard(link.card, game.player, "graveyard", { fromZone: "spellTrap", awaitCardMovedEvent: true });
      assert.equal(link.sourceMoved, true);
      assert.equal(link.latestSourceLocation?.zone, "graveyard");
    }
    return await original(input);
  };
  const action = Promise.resolve(game.chainSystem.resolveChain()); await completeTestSelections(game, action);
  assert.equal(inspected, true);
  assert.ok(game.player.field.includes(boss));
  assert.equal(game.player.graveyard.filter(card => card === link.card).length, 1);
});

test("resuming a post-effect action never repeats the primary action or completed event", async t => {
  const { game, make, add } = scenario(t);
  for (let n = 0; n < 4; n++) game.player.deck.push(make(501));
  const link = add({ id: "pause", timing: "on_activate", actions: [{ type: "draw", amount: 1 }],
    afterResolutionActions: [{ type: "draw", amount: 2 }] });
  let paused = false, completed = 0;
  game.on("chain_link_resolution", event => { if (event.stage === "completed") completed++; });
  const original = game.effectEngine.applyActions.bind(game.effectEngine);
  game.effectEngine.applyActions = async (actions, context, targets) => {
    if (context.afterEffectResolution && !paused) {
      paused = true;
      return { needsSelection: true, selectionContract: { kind: "choice", requirements: [{ id: "resume", zones: ["spellTrap"], owner: "self", min: 1, max: 1,
        candidates: [{ key: "source", cardRef: link.card }] }] } };
    }
    return await original(actions, context, targets);
  };
  assert.equal((await game.chainSystem.resolveChain()) && game.chainSystem.pendingChainSelection?.phase, "after_resolution");
  assert.equal(game.player.hand.length, 1);
  await game.chainSystem.resumePendingChainSelection({ resume: [selectionKey("source")] });
  assert.equal(game.player.hand.length, 3);
  assert.equal(completed, 1);
  assert.ok(game.player.graveyard.includes(link.card));
});

test("successful revival permits materials already controlled without requiring the revived Tuner", async t => {
  const { game, make, add } = scenario(t);
  const revived = make(501), tuner = make(502), nonTuner = make(503), boss = make(513);
  game.player.graveyard.push(revived); placeFieldCards(game.player.field, tuner, nonTuner); game.player.extraDeck.push(boss);
  add(synchroEffect());
  const action = Promise.resolve(game.chainSystem.resolveChain()); await completeTestSelections(game, action);
  assert.ok(game.player.field.includes(boss)); assert.ok(game.player.field.includes(revived));
  assert.ok(game.player.graveyard.includes(tuner)); assert.ok(game.player.graveyard.includes(nonTuner));
});

test("a failed revival never schedules the post-effect Synchro", async t => {
  const { game, make, add } = scenario(t);
  const tuner = make(501), material = make(503), boss = make(510);
  tuner.cannotBeSpecialSummoned = true;
  game.player.graveyard.push(tuner); placeFieldCards(game.player.field, material); game.player.extraDeck.push(boss);
  const link = add(synchroEffect());
  let attempts = 0;
  const original = game.chainSystem.runFastEffectTiming.bind(game.chainSystem);
  game.chainSystem.runFastEffectTiming = async input => { if (input?.origin === FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT) attempts++; return original(input); };
  await game.chainSystem.resolveChain();
  assert.equal(attempts, 0); assert.equal(link.afterResolution, undefined);
  assert.ok(game.player.graveyard.includes(tuner)); assert.ok(game.player.extraDeck.includes(boss));
});

test("teardown during the child window never restores the cancelled parent frame", async t => {
  const { game, make, add } = scenario(t);
  const tuner = make(501), material = make(503), boss = make(510);
  game.player.graveyard.push(tuner); placeFieldCards(game.player.field, material); game.player.extraDeck.push(boss);
  const link = add(synchroEffect());
  const original = game.chainSystem.runFastEffectTiming.bind(game.chainSystem);
  game.chainSystem.runFastEffectTiming = async input => {
    if (input?.origin === FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT) {
      assert.equal(game.chainSystem.suspendedChainFrames.length, 1);
      game.dispose("post_effect_child_abort");
      return { success: false, ok: false, code: "SELECTION_ABORTED" };
    }
    return original(input);
  };
  const action = Promise.resolve(game.chainSystem.resolveChain()); await completeTestSelections(game, action);
  assert.equal(game.chainSystem.suspendedChainFrames.length, 0);
  assert.equal(game.chainSystem.currentResolvingLink, null);
  assert.equal(game.chainSystem.pendingChainFinalizations.length, 0);
  assert.equal(link.finalizationStatus, "cancelled");
});

test("direct NullChain activation completes the post-effect phase before finalizing its source", async t => {
  const game = createRuntimeGame({ disableChains: true, laboratoryMode: true, laboratoryUseBot: false });
  t.after(() => game.dispose("direct_post_effect"));
  game.turn = "player"; game.phase = "main1"; game.turnCounter = 4; game.disablePresentationDelays = true;
  game.player.controllerType = "human";
  const tuner = new Card({ ...cardDefinition(501), effects: [] }, game.player.id);
  const material = new Card({ ...cardDefinition(503), effects: [] }, game.player.id);
  const boss = new Card({ ...cardDefinition(510), effects: [] }, game.player.id);
  const trap = new Card({ ...cardDefinition(520), effects: [synchroEffect()] }, game.player.id);
  trap.isFacedown = true; trap.setTurn = 1; trap.turnSetOn = 1;
  placeFieldCards(game.player.field, material); placeFieldCards(game.player.spellTrap, trap);
  game.player.graveyard.push(tuner); game.player.extraDeck.push(boss);
  game.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
  game.ui.showTrapActivationModal = async () => true;
  let sourcePresentAtSynchro = false;
  const moves: Array<{ card: unknown; event: string; relevance: string }> = [];
  for (const event of ["card_to_grave", "card_moved"] as const) game.on(event, payload => {
    moves.push({ card: payload.card, event, relevance: payload.timingRelevance || "semantic" });
  });
  game.on("after_summon", payload => { if (payload.card === boss) sourcePresentAtSynchro = game.player.spellTrap.includes(trap); });
  const action = game.tryActivateSpellTrapEffect(trap, null, { owner: game.player });
  await completeTestSelections(game, action);
  assert.equal((await action).success, true, (await action).reason || undefined);
  assert.equal(sourcePresentAtSynchro, true);
  assert.ok(game.player.field.includes(boss)); assert.ok(game.player.graveyard.includes(trap));
  assert.deepEqual(moves.filter(move => move.card === trap && move.event === "card_to_grave").map(move => move.relevance), ["source_cleanup"]);
  assert.ok(moves.filter(move => move.card === tuner || move.card === material).every(move => move.relevance === "semantic"), "materials and actual effects retain semantic relevance");
});

test("direct NullChain post-effect pause resumes its cursor without repeating primary actions", async t => {
  const game = createRuntimeGame({ disableChains: true, laboratoryMode: true, laboratoryUseBot: false });
  t.after(() => game.dispose("direct_post_effect_pause"));
  game.turn = "player"; game.phase = "main1"; game.turnCounter = 4; game.disablePresentationDelays = true;
  game.player.controllerType = "human"; game.ui.showTrapActivationModal = async () => true;
  const effect = { id: "direct_pause", timing: "on_activate", actions: [{ type: "draw", amount: 1 }],
    afterResolutionActions: [{ type: "draw", amount: 1 }, { type: "draw", amount: 1 }] } satisfies EffectDefinition;
  const trap = new Card({ ...cardDefinition(520), effects: [effect] }, game.player.id);
  trap.isFacedown = true; trap.setTurn = 1; trap.turnSetOn = 1;
  placeFieldCards(game.player.spellTrap, trap);
  for (let i = 0; i < 5; i++) game.player.deck.push(new Card({ ...cardDefinition(501), effects: [] }, game.player.id));
  const original = game.effectEngine.applyActions.bind(game.effectEngine);
  let paused = false, primaries = 0, earlierAfter = 0;
  game.effectEngine.applyActions = async (actions, context, targets) => {
    if (context.afterEffectResolution?.actionIndex === 1 && !paused) {
      paused = true;
      assert.equal(game.player.hand.length, 2);
      assert.ok(game.player.spellTrap.includes(trap));
      const state = createCanonicalStateSnapshot(game), metadata = record(required(state.chain.afterResolution));
      assert.equal(record(metadata.direct).actionIndex, 1);
      assert.doesNotThrow(() => validateCanonicalReplay(replayWithState(state)));
      assert.deepEqual(game.getPublicState().chain.afterResolution, metadata);
      const before = JSON.stringify(metadata), live = required(game.afterResolutionActivation), hash = hashCanonicalGameState(game);
      live.actionIndex = 0;
      assert.notEqual(hashCanonicalGameState(game), hash); assert.equal(JSON.stringify(metadata), before);
      live.actionIndex = 1;
      const bad = structuredClone(state); Reflect.set(record(record(bad.chain.afterResolution).direct), "sourceDuelCardId", -1);
      assert.throws(() => validateCanonicalReplay(replayWithState(bad)), /sourceDuelCardId/);
      return { needsSelection: true, selectionContract: { kind: "choice", requirements: [{ id: "resume", zones: ["spellTrap"], owner: "self", min: 1, max: 1,
        candidates: [{ key: "source", cardRef: trap }] }] } };
    }
    if (!context.afterEffectResolution) primaries++;
    if (context.afterEffectResolution?.actionIndex === 0) earlierAfter++;
    return original(actions, context, targets);
  };
  const action = game.tryActivateSpellTrapEffect(trap, null, { owner: game.player });
  await completeTestSelections(game, action);
  assert.equal((await action).needsSelection, true, "the initial call exposes its pending selection");
  assert.equal(game.afterResolutionActivation, null, "selection completion clears the direct frame");
  assert.equal(game.player.hand.length, 3);
  assert.equal(primaries, 1); assert.equal(earlierAfter, 1);
  assert.ok(game.player.graveyard.includes(trap));
});

test("direct activation with a real Chain defers material triggers until source finalization", async t => {
  const { game, make } = scenario(t);
  const tuner = make(501), boss = make(510);
  const material = new Card(cardDefinition(503), game.player.id);
  const trap = new Card({ ...cardDefinition(520), effects: [synchroEffect()] }, game.player.id);
  trap.isFacedown = true; trap.turnSetOn = trap.setTurn = 1;
  game.ui.showTrapActivationModal = async () => true;
  game.ui.showTriggerOrderModal = async options => (options?.candidates || []).map(candidate => candidate.candidateId);
  placeFieldCards(game.player.field, material); placeFieldCards(game.player.spellTrap, trap);
  game.player.graveyard.push(tuner); game.player.extraDeck.push(boss); game.player.deck.push(make(501));
  let materialTriggerCompleted = false, sourceFinalizedAtTrigger = false;
  game.on("chain_link_resolution", event => {
    if (event.effectId === "tech_zero_multimodal_machine_synchro_draw" && event.stage === "completed") {
      materialTriggerCompleted = true;
      sourceFinalizedAtTrigger = game.player.graveyard.includes(trap);
    }
  });
  const action = game.runActivationPipeline({ card: trap, owner: game.player, activationZone: "spellTrap", effect: synchroEffect(),
    selectionKind: "spellTrapEffect", openActivationWindow: false,
    activationContext: { preparedEffect: synchroEffect(), committed: true },
    activate: (selections, context) => game.effectEngine.activateSpellTrapEffect(trap, game.player, selections, "spellTrap", context),
    finalize: async () => { await game.finalizeSpellTrapActivation(trap, game.player, "spellTrap"); } });
  await completeTestSelections(game, action);
  assert.equal((await action).success, true);
  assert.equal(materialTriggerCompleted, true);
  assert.equal(sourceFinalizedAtTrigger, true, "parent source must finalize before material trigger resolves");
  assert.equal(game.player.hand.length, 1);
});

test("direct post-effect teardown clears its frame without reactivation or source finalization", async t => {
  const game = createRuntimeGame({ disableChains: true, laboratoryMode: true, laboratoryUseBot: false });
  t.after(() => game.dispose("direct_after_abort_complete"));
  game.turn = "player"; game.phase = "main1"; game.turnCounter = 4; game.disablePresentationDelays = true;
  game.player.controllerType = "human"; game.ui.showTrapActivationModal = async () => true;
  const effect: EffectDefinition = { id: "direct_abort", timing: "on_activate", actions: [{ type: "draw", amount: 1 }],
    afterResolutionActions: [{ type: "draw", amount: 1 }] };
  const source = new Card({ ...cardDefinition(520), effects: [effect] }, game.player.id);
  source.isFacedown = true; source.setTurn = source.turnSetOn = 1; placeFieldCards(game.player.spellTrap, source);
  for (let i = 0; i < 3; i++) game.player.deck.push(new Card({ ...cardDefinition(501), effects: [] }, game.player.id));
  const original = game.effectEngine.applyActions.bind(game.effectEngine);
  let primaryCalls = 0;
  game.effectEngine.applyActions = async (actions, context, targets) => {
    if (context.afterEffectResolution) {
      assert.ok(game.afterResolutionActivation); game.dispose("direct_after_abort");
      return { success: false, executed: false, needsSelection: false, reason: "aborted" };
    }
    primaryCalls++;
    return original(actions, context, targets);
  };
  const result = await game.tryActivateSpellTrapEffect(source, null, { owner: game.player });
  assert.equal(result.success, false); assert.equal(result.code, "SELECTION_ABORTED");
  assert.equal(primaryCalls, 1); assert.equal(game.player.hand.length, 1);
  assert.equal(game.afterResolutionActivation, null); assert.equal(createCanonicalStateSnapshot(game).chain.afterResolution, undefined);
  assert.ok(game.player.spellTrap.includes(source)); assert.ok(!game.player.graveyard.includes(source));
});


test("suspended parent retains frozen trigger eligibility and timing in canonical child-window hashes", async t => {
  const { game, make, add } = scenario(t);
  const tuner = make(501), material = make(503), boss = make(510);
  const court = new Card(cardDefinition(17), game.player.id);
  game.player.graveyard.push(tuner);
  placeFieldCards(game.player.field, material);
  placeFieldCards(game.player.spellTrap, court);
  game.player.extraDeck.push(boss);
  const captured = await game.resolveEvent("card_to_grave", {
    card: tuner, player: game.player, fromZone: "field", toZone: "graveyard", deferActivationChecks: true,
  }, { collectTriggersOnly: true });
  const parent = required(captured.occurrence);
  const occurrence = required(game.chainSystem.createTriggerOccurrence("card_to_grave", {}, {
    entries: captured.entries || [], entriesProvided: true,
  }));
  assert.equal(parent.entries?.length, 1);
  assert.ok("sequence" in occurrence);
  game.chainSystem.buildTriggerOpportunity([occurrence]);
  add(synchroEffect());
  let inspected = false;
  const original = game.chainSystem.runFastEffectTiming.bind(game.chainSystem);
  game.chainSystem.runFastEffectTiming = async input => {
    if (input?.origin === FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT) {
      inspected = true;
      assert.equal(game.chainSystem.activeTriggerOpportunity, null, "child uses its own trigger opportunity");
      const state = createCanonicalStateSnapshot(game);
      const suspended = record(state.chain.afterResolution).suspended;
      assert.ok(Array.isArray(suspended));
      const triggers = record(record(required(suspended[0])).triggers);
      const active = triggers.activeOccurrences;
      assert.ok(Array.isArray(active));
      const projection = record(required(active[0]));
      assert.equal(projection.entriesProvided, true);
      assert.equal(projection.timingRelevance, "semantic");
      assert.ok(Array.isArray(projection.entries));
      assert.equal(projection.entries.length, 1);
      assert.doesNotThrow(() => validateCanonicalReplay(replayWithState(state)));
      const hash = hashCanonicalGameState(game);
      const entries = occurrence.entries;
      occurrence.entries = [];
      assert.notEqual(hashCanonicalGameState(game), hash, "captured eligibility changes the child-window hash");
      occurrence.entries = entries;
      occurrence.timingRelevance = "source_cleanup";
      assert.notEqual(hashCanonicalGameState(game), hash, "timing relevance changes the child-window hash");
      occurrence.timingRelevance = "semantic";
      projection.entries.splice(0);
      assert.equal(occurrence.entries?.length, 1, "the returned suspended state is detached");
    }
    return await original(input);
  };
  const action = Promise.resolve(game.chainSystem.resolveChain());
  await completeTestSelections(game, action);
  assert.equal(inspected, true);
  assert.ok(game.player.field.includes(boss));
});
