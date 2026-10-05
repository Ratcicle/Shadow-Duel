import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import ChainSystem from "../../src/core/ChainSystem.js";
import type { EffectContext } from "../../src/core/contracts/actionRuntime.js";
import type { ChainActionContext } from "../../src/core/contracts/chainRuntime.js";
import type { AIDecisionPlan } from "../../src/core/contracts/ai.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import { CANONICAL_REPLAY_ENGINE_VERSION } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, getCardDatabaseSignature, hashCanonicalGameState, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { cardDefinition, record, required, selectionKey } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function replayWithState(snapshot: ReturnType<typeof createCanonicalStateSnapshot>) {
  return { format: "shadow-duel-canonical-replay", schemaVersion: 2,
    engineVersion: CANONICAL_REPLAY_ENGINE_VERSION, cardDatabaseSignature: getCardDatabaseSignature(),
    setup: { seed: 123, randomState: { seed: 123, state: 456, calls: 7 }, startingPlayer: "player",
      playerDeck: [{ id: 1, duelCardId: 1 }], playerExtraDeck: [], botDeck: [{ id: 2, duelCardId: 2 }], botExtraDeck: [] },
    commands: [], decisions: [], result: { finalState: snapshot } };
}

for (const mode of ["chain", "direct"] as const) {
  test(`${mode} post-effect hashes distinguish the frozen source presence used by continuation`, async t => {
    for (const version of [0, 3]) {
      const game = createRuntimeGame({ disableChains: mode === "direct", laboratoryMode: true,
        laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
      t.after(() => game.dispose("after_resolution_metadata_test"));
      game.turn = "player"; game.phase = "main1"; game.turnCounter = 4;
      game.disablePresentationDelays = true;
      game.player.controllerType = game.bot.controllerType = "human";
      const effect = { id: "after_presence_hash", timing: "ignition", activationZones: ["field"], actions: [],
        afterResolutionActions: [{ type: "buff_stats_temp", targetRef: "self", atkBoost: 100 }] } satisfies EffectDefinition;
      const source = new Card({ ...cardDefinition(501), effects: [effect] }, game.player.id);
      source.isFacedown = false; source.locationVersion = version;
      placeFieldCards(game.player.field, source);
      const original = game.effectEngine.applyActions.bind(game.effectEngine);
      let paused = false;
      game.effectEngine.applyActions = async (actions, context, targets) => {
        if (context.afterEffectResolution && !paused) {
          paused = true;
          return { needsSelection: true, selectionContract: { kind: "choice", requirements: [{ id: "resume",
            zones: ["field"], owner: "self", min: 1, max: 1,
            candidates: [{ key: "source", cardRef: source }] }] } };
        }
        return original(actions, context, targets);
      };

      let context: EffectContext | ChainActionContext;
      if (mode === "chain") {
        assert.ok(game.chainSystem instanceof ChainSystem);
        const prepared = game.chainSystem.createPreparedActivation({ card: source, controller: game.player,
          effect, activationZone: "field", committed: true });
        const link = game.chainSystem.addToChain(prepared);
        assert.ok(link);
        await game.chainSystem.resolveChain();
        assert.equal(game.chainSystem.pendingChainSelection?.phase, "after_resolution");
        assert.equal(game.chainSystem.getChainSummary().length, 0, "the popped link must be represented by its continuation");
        context = required(link.afterResolution).context;
      } else {
        const result = await game.effectEngine.activateMonsterEffect(source, game.player, null, "field", {
          sourceAtActivation: { cardInstanceId: source.instanceId, controllerId: game.player.id,
            zone: "field", faceUp: true, locationVersion: version }, committed: true, costsPaid: true });
        assert.equal(result.needsSelection, true, result.reason ?? undefined);
        context = required(game.afterResolutionActivation).context;
      }

      const presence = required(context.activationContext?.sourceAtActivation);
      const initialHash = hashCanonicalGameState(game);
      const detached = createCanonicalStateSnapshot(game);
      const detachedJSON = JSON.stringify(detached);
      assert.doesNotThrow(() => validateCanonicalReplay(replayWithState(detached)));
      for (const [field, invalidValue] of [["locationVersion", -1], ["controllerId", {}], ["faceUp", null]] as const) {
        const bad = structuredClone(detached), metadata = record(bad.chain.afterResolution);
        const binding = mode === "chain" ? record(record(metadata.active).link) : record(metadata.direct);
        Reflect.set(record(binding.sourceAtActivation), field, invalidValue);
        assert.throws(() => validateCanonicalReplay(replayWithState(bad)), new RegExp(`sourceAtActivation.${field}`));
      }
      const badReference = structuredClone(detached), metadata = record(badReference.chain.afterResolution);
      const binding = mode === "chain" ? record(record(metadata.active).link) : record(metadata.direct);
      Reflect.set(binding, "referenceSnapshots", [{ targetId: "frozen", cards: [null] }]);
      assert.throws(() => validateCanonicalReplay(replayWithState(badReference)), /referenceSnapshots.*cards/);
      for (const delta of [1, 2]) {
        presence.locationVersion = version + delta;
        const alteredHash = hashCanonicalGameState(game);
        assert.equal(JSON.stringify(detached), detachedJSON, "captured metadata cannot retain the live source snapshot");
        presence.locationVersion = version;
        assert.equal(hashCanonicalGameState(game), initialHash, "restoring the frozen presence restores the hash");
        assert.deepEqual(createCanonicalStateSnapshot(game), detached, "a captured snapshot is detached from live continuation state");
        assert.notEqual(alteredHash, initialHash, `source presence ${version} and ${version + delta} produce different continuations`);
      }
      const atkBefore = source.atk;
      const oracleContext = { source, player: game.player, opponent: game.bot, effect, activationZone: "field" as const,
        activationContext: { sourceAtActivation: presence }, afterEffectResolution: { chainLevel: 1, actionIndex: 0 } };
      presence.locationVersion = version + 1;
      await original(effect.afterResolutionActions, oracleContext, { self: [source] });
      assert.equal(source.atk, atkBefore, "the stale source presence cannot receive its post-effect buff");
      presence.locationVersion = version;
      await original(effect.afterResolutionActions, oracleContext, { self: [source] });
      assert.equal(source.atk, atkBefore + 100, "the matching source presence receives its post-effect buff");
      game.dispose("after_resolution_metadata_case_complete");
    }
  });
}

test("direct post-effect failure finalizes its source equally before and after a selection pause", async t => {
  for (const pause of [false, true]) {
    const game = createRuntimeGame({ disableChains: true, laboratoryMode: true, laboratoryUseBot: false });
    t.after(() => game.dispose("after_resolution_failure_test"));
    game.turn = "player"; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true; game.player.controllerType = "human";
    game.ui.showTrapActivationModal = async () => true;
    const effect = { id: "after_failure", timing: "on_activate", actions: [{ type: "draw", amount: 1 }],
      afterResolutionActions: [{ type: "draw", amount: 1 }] } satisfies EffectDefinition;
    const source = new Card({ ...cardDefinition(520), effects: [effect] }, game.player.id);
    source.isFacedown = true; source.setTurn = 1; source.turnSetOn = 1;
    placeFieldCards(game.player.spellTrap, source);
    for (let i = 0; i < 4; i++) game.player.deck.push(new Card({ ...cardDefinition(501), effects: [] }, game.player.id));
    const original = game.effectEngine.applyActions.bind(game.effectEngine);
    let paused = false, primaryCalls = 0;
    game.effectEngine.applyActions = async (actions, context, targets) => {
      if (context.afterEffectResolution) {
        if (pause && !paused) {
          paused = true;
          return { needsSelection: true, selectionContract: { kind: "choice", requirements: [{ id: "resume",
            zones: ["spellTrap"], owner: "self", min: 1, max: 1,
            candidates: [{ key: "source", cardRef: source }] }] } };
        }
        return { success: false, executed: false, needsSelection: false,
          reason: "The post-effect action failed after its primary effect resolved." };
      }
      primaryCalls++;
      return original(actions, context, targets);
    };
    const action = game.tryActivateSpellTrapEffect(source, null, { owner: game.player });
    await completeTestSelections(game, action);
    assert.equal((await action).needsSelection, pause);
    assert.equal(primaryCalls, 1); assert.equal(game.player.hand.length, 1);
    assert.equal(game.afterResolutionActivation, null);
    assert.ok(game.player.graveyard.includes(source), `an already resolved source finalizes after failure (pause=${pause})`);
    assert.ok(!game.player.spellTrap.includes(source));
    game.dispose("after_resolution_failure_case_complete");
  }
});

for (const mode of ["chain", "direct"] as const) {
  test(`${mode} post-effect hashes distinguish exact AI Synchro plans that summon different physical cards`, async t => {
    for (const selected of [0, 1]) {
      const game = createRuntimeGame({ disableChains: mode === "direct", laboratoryMode: true,
        laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
      t.after(() => game.dispose("after_resolution_plan_test"));
      game.turn = "player"; game.phase = "main1"; game.turnCounter = 4;
      game.disablePresentationDelays = true;
      game.player.controllerType = "ai"; game.bot.controllerType = "human";
      game.ui.showChainResponseModal = async () => null;
      const effect = { id: "after_plan_hash", timing: "ignition", activationZones: ["field"], actions: [],
        afterResolutionActions: [{ type: "synchro_summon_from_extra_deck", position: "attack" }] } satisfies EffectDefinition;
      const make = (id: number) => new Card({ ...cardDefinition(id), effects: [] }, game.player.id);
      const source = new Card({ ...cardDefinition(501), effects: [effect] }, game.player.id);
      const tuner = make(501), material = make(503), boss1 = make(510), boss2 = make(510);
      source.isFacedown = false;
      placeFieldCards(game.player.field, source, tuner, material);
      game.player.extraDeck.push(boss1, boss2);
      const plan = (boss: Card): AIDecisionPlan => ({ synchroSummons: { [effect.id]: {
        synchroInstanceId: boss.instanceId, materialInstanceIds: [tuner.instanceId, material.instanceId], position: "attack" } } });
      const original = game.effectEngine.applyActions.bind(game.effectEngine);
      let paused = false;
      game.effectEngine.applyActions = async (actions, context, targets) => {
        if (context.afterEffectResolution && !paused) {
          paused = true;
          return { needsSelection: true, selectionContract: { kind: "choice", requirements: [{ id: "resume",
            zones: ["field"], owner: "self", min: 1, max: 1,
            candidates: [{ key: "source", cardRef: source }] }] } };
        }
        return original(actions, context, targets);
      };
      let context: EffectContext | ChainActionContext;
      if (mode === "chain") {
        assert.ok(game.chainSystem instanceof ChainSystem);
        const prepared = game.chainSystem.createPreparedActivation({ card: source, controller: game.player, effect,
          activationZone: "field", committed: true, activationContext: { decisions: plan(boss1) } });
        const link = game.chainSystem.addToChain(prepared);
        assert.ok(link);
        await game.chainSystem.resolveChain();
        context = required(link.afterResolution).context;
      } else {
        const result = await game.effectEngine.activateMonsterEffect(source, game.player, null, "field", {
          decisions: plan(boss1), committed: true, costsPaid: true });
        assert.equal(result.needsSelection, true, result.reason ?? undefined);
        context = required(game.afterResolutionActivation).context;
      }
      const activationContext = required(context.activationContext);
      const before = hashCanonicalGameState(game), detached = createCanonicalStateSnapshot(game);
      const detachedJSON = JSON.stringify(detached);
      assert.doesNotThrow(() => validateCanonicalReplay(replayWithState(detached)));
      const metadata = record(detached.chain.afterResolution);
      const binding = mode === "chain" ? record(record(metadata.active).link) : record(metadata.direct);
      const serializedPlan = record(binding.decisions), serializedSynchro = record(record(serializedPlan.synchroSummons)[effect.id]);
      assert.equal(serializedSynchro.synchroDuelCardId, boss1.duelCardId);
      assert.deepEqual(serializedSynchro.materialDuelCardIds, [tuner.duelCardId, material.duelCardId]);
      assert.equal(/"(?:synchroInstanceId|materialInstanceIds)"/.test(JSON.stringify(serializedPlan)), false);
      for (const badPlan of [{ unknown: {} }, { synchroSummons: { [effect.id]: {
        synchroDuelCardId: -1, materialDuelCardIds: [1, 2], position: "attack" } } }, { cases: { choice: "" } }]) {
        const bad = structuredClone(detached), badMetadata = record(bad.chain.afterResolution);
        const badBinding = mode === "chain" ? record(record(badMetadata.active).link) : record(badMetadata.direct);
        Reflect.set(badBinding, "decisions", badPlan);
        assert.throws(() => validateCanonicalReplay(replayWithState(bad)), /decisions/);
      }
      const processIdentity = boss1.instanceId;
      boss1.instanceId += 100_000;
      activationContext.decisions = plan(boss1);
      assert.equal(hashCanonicalGameState(game), before, "a changed process identity for the same physical card cannot change the canonical plan");
      boss1.instanceId = processIdentity;
      activationContext.decisions = plan(boss1);
      activationContext.decisions = plan(boss2);
      const altered = hashCanonicalGameState(game);
      assert.equal(JSON.stringify(detached), detachedJSON, "AI plans must be detached from the captured frame");
      activationContext.decisions = plan(selected === 0 ? boss1 : boss2);
      let resume: Promise<unknown>;
      if (mode === "chain") {
        assert.ok(game.chainSystem instanceof ChainSystem);
        resume = Promise.resolve(game.chainSystem.resumePendingChainSelection({ resume: [selectionKey("source")] }));
      } else {
        resume = game.effectEngine.activateMonsterEffect(source, game.player, null, "field", {
          afterResolution: required(game.afterResolutionActivation) });
      }
      await completeTestSelections(game, resume);
      await resume;
      assert.equal(game.player.field.includes(boss1), selected === 0);
      assert.equal(game.player.field.includes(boss2), selected === 1);
      assert.notEqual(before, altered, "the planned physical Synchro changes the pending continuation hash");
      game.dispose("after_resolution_plan_case_complete");
    }
  });
}

for (const mode of ["chain", "direct"] as const) {
  test(`${mode} post-effect metadata retains the canonical identity of a removed Token material`, async t => {
    const game = createRuntimeGame({ disableChains: mode === "direct", laboratoryMode: true,
      laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    t.after(() => game.dispose("after_resolution_token_metadata_test"));
    game.turn = "player"; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.player.controllerType = "ai"; game.bot.controllerType = "human";
    game.ui.showChainResponseModal = async () => null;
    const effect = { id: "after_token_plan", timing: "ignition", activationZones: ["field"], actions: [],
      afterResolutionActions: [{ type: "synchro_summon_from_extra_deck", position: "attack" }] } satisfies EffectDefinition;
    const source = new Card({ ...cardDefinition(501), effects: [effect] }, game.player.id);
    const tuner = new Card({ ...cardDefinition(501), effects: [] }, game.player.id);
    const material = new Card({ ...cardDefinition(503), effects: [] }, game.player.id);
    const boss = new Card({ ...cardDefinition(512), effects: [] }, game.player.id);
    const token = new Card({ name: "Raptor Token", cardKind: "monster", level: 1, type: "Machine",
      atk: 500, def: 500, archetype: "Tech-Zero" }, game.player.id);
    token.isToken = true; source.isFacedown = false;
    placeFieldCards(game.player.field, source, tuner, material, token);
    game.player.extraDeck.push(boss);
    const decisions: AIDecisionPlan = { synchroSummons: { [effect.id]: { synchroInstanceId: boss.instanceId,
      materialInstanceIds: [tuner.instanceId, material.instanceId, token.instanceId], position: "attack" } } };
    const observedSnapshots: ReturnType<typeof createCanonicalStateSnapshot>[] = [];
    game.on("after_summon", payload => {
      if (payload.card !== boss) return;
      observedSnapshots.push(createCanonicalStateSnapshot(game));
    });
    let action: Promise<unknown>;
    if (mode === "chain") {
      assert.ok(game.chainSystem instanceof ChainSystem);
      const prepared = game.chainSystem.createPreparedActivation({ card: source, controller: game.player, effect,
        activationZone: "field", committed: true, activationContext: { decisions } });
      assert.ok(game.chainSystem.addToChain(prepared));
      action = Promise.resolve(game.chainSystem.resolveChain());
    } else {
      action = game.effectEngine.activateMonsterEffect(source, game.player, null, "field", { decisions, committed: true, costsPaid: true });
    }
    await completeTestSelections(game, action);
    await action;
    assert.equal(observedSnapshots.length, 1); assert.ok(game.player.field.includes(boss));
    assert.ok(!game.player.field.includes(token) && !game.player.graveyard.includes(token) && !game.player.banished.includes(token));
    const snapshot = required(observedSnapshots[0]);
    assert.doesNotThrow(() => validateCanonicalReplay(replayWithState(snapshot)), "a legal Token cost cannot invalidate continuation metadata");
    const metadata = record(snapshot.chain.afterResolution);
    const binding = mode === "chain" ? record(record(metadata.active).link) : record(metadata.direct);
    const serialized = record(record(record(binding.decisions).synchroSummons)[effect.id]);
    assert.deepEqual(serialized.materialDuelCardIds, [tuner.duelCardId, material.duelCardId, token.duelCardId]);
  });
}
