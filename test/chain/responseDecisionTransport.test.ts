import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import type { ChainEffectTarget, FastEffectContextInput } from "../../src/core/contracts/chainRuntime.js";
import type { ReplayDecisionInput } from "../../src/core/contracts/decisions.js";
import { cardDefinition, chainSelections, required, selectionKey, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { chooseChainResponseReference } from "../../src/core/chain/selection.js";
import { createCanonicalStateSnapshot, hashCanonicalGameState } from "../../src/core/game/replay/canonical.js";

function referenceScenario(t: TestContext, ai = false) {
  const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turn = "player"; game.phase = "main1"; game.turnCounter = 4; game.disablePresentationDelays = true;
  game.player.controllerType = "human"; game.bot.controllerType = ai ? "ai" : "human";
  const source = new Card(cardDefinition(361), "player");
  source.effects = [{ id: "reference_test_targets", timing: "on_play", speed: 2,
    targets: [{ id: "dragons", owner: "opponent", zone: "field", count: { min: 2, max: 2 } }],
    actions: [{ type: "switch_position", targetRef: "dragons" }] }];
  const dragons = [new Card(cardDefinition(257), "bot"), new Card(cardDefinition(257), "bot")];
  const trap = new Card(cardDefinition(268), "bot");
  trap.effects = trap.effects.map(effect => ({ ...effect, activationCosts: [{ type: "pay_lp", amount: 500 }] }));
  trap.isFacedown = true; trap.setTurn = trap.turnSetOn = 1;
  placeFieldCards(game.player.spellTrap, source);
  placeFieldCards(game.bot.field, ...dragons); placeFieldCards(game.bot.spellTrap, trap);
  for (const card of [source, ...dragons, trap]) game.ensureDuelCardId(card);
  const chain = game.chainSystem;
  const link = chain.addToChain(chain.createPreparedActivation({
    card: source, controller: game.player, effect: required(source.effects[0]), activationZone: "spellTrap",
    committed: true, costsPaid: true, targetSelections: chainSelections({ dragons }),
  }));
  assert.ok(link);
  const context: FastEffectContextInput = { type: "effect_targeted", player: game.player };
  const candidate = required(chain.getActivatableCardsInChain(game.bot, context).find(entry => entry.card === trap));
  assert.equal(candidate.responseReferences?.length, 2);
  return { game, chain, link, candidate, dragons, trap };
}

for (const change of ["cancel", "leave-return", "face-down", "new-link"] as const) {
  test(`CS-02 reference ${change} aborts before source commitment, costs and OPT`, async t => {
    const { game, chain, candidate, dragons, trap, link } = referenceScenario(t);
    const beforeLp = game.bot.lp;
    const choosing = chain.prepareChainResponse(candidate, game.bot, candidate.context);
    const session = required(game.targetSelection);
    const requirement = required(session.requirements[0]);
    const chosen = required(dragons[1]);
    if (change === "cancel") game.cancelTargetSelection();
    else {
      if (change === "leave-return") {
        await game.moveCard(chosen, game.bot, "hand", { fromZone: "field", awaitEvents: true });
        assert.ok(game.bot.hand.includes(chosen));
        await game.moveCard(chosen, game.bot, "field", { fromZone: "hand", position: "attack",
          summonOrigin: "effect_resolution", skipSummonAttempt: true });
        assert.ok(game.bot.field.includes(chosen));
      } else if (change === "face-down") chosen.isFacedown = true;
      else chain.addToChain(chain.createPreparedActivation({ card: link.card, controller: game.player,
        effect: { id: "new_link", timing: "on_play", speed: 2 }, activationZone: "spellTrap", committed: true }));
      session.selections[requirement.id] = [required(requirement.candidates.find(entry => entry.cardRef === chosen)).key];
      await game.finishTargetSelection();
    }
    const result = await choosing;
    assert.equal(result.success, false);
    assert.equal(game.bot.lp, beforeLp);
    assert.equal(trap.isFacedown, true);
    assert.ok(game.bot.spellTrap.includes(trap));
    assert.equal(chain.checkActivationUsage(trap, game.bot, candidate.effect).ok, true);
    assert.equal(game.targetSelection, null);
  });
}

test("CS-02 chosen presence is detached and represented in the canonical active link", async t => {
  const { game, chain, candidate, dragons } = referenceScenario(t);
  const choosing = chain.prepareChainResponse(candidate, game.bot, candidate.context);
  const session = required(game.targetSelection), requirement = required(session.requirements[0]);
  session.selections[requirement.id] = [required(requirement.candidates[1]).key];
  await game.finishTargetSelection();
  const prepared = required((await choosing).preparedActivation);
  assert.equal(prepared.referenceSnapshots?.[0]?.cards[0]?.card, dragons[1]);
  assert.deepEqual(prepared.targetSelections, {});
  const link = chain.addToChain(prepared);
  assert.ok(link);
  const before = createCanonicalStateSnapshot(game), hash = hashCanonicalGameState(game);
  const snapshot = required(link.referenceSnapshots?.[0]?.cards[0]);
  snapshot.locationVersion++;
  assert.notEqual(hashCanonicalGameState(game), hash);
  assert.notDeepEqual(createCanonicalStateSnapshot(game), before);
  assert.equal(required(link.context?.responseReference).target.locationVersion, snapshot.locationVersion - 1,
    "prepared reference snapshots are detached from original target declarations");
});

test("CS-02 AI reference provider records a choice and playback never calls policy", async t => {
  const live = referenceScenario(t, true), replay = referenceScenario(t, true);
  const decisions: ReplayDecisionInput[] = [];
  live.game.on("decision_made", value => decisions.push(structuredClone(value)));
  let calls = 0;
  live.game.autoSelector.select = contract => {
    calls++;
    assert.ok("requirements" in contract && Array.isArray(contract.requirements));
    const requirement = required(contract.requirements[0]);
    const key = required(requirement.candidates?.[1]?.key);
    return { ok: true, selections: { chain_response_reference: [selectionKey(key)] } };
  };
  const selected = await chooseChainResponseReference(live.chain, live.candidate, live.game.bot);
  assert.equal(selected?.target.card, live.dragons[1]); assert.equal(calls, 1);
  assert.equal(decisions.length, 1); assert.equal(decisions[0]?.kind, "choice");
  replay.game.decisionBroker.loadReplayDecisions(JSON.parse(JSON.stringify(decisions)));
  replay.game.autoSelector.select = () => assert.fail("replay cannot consult AI");
  replay.game.ui.showTargetSelection = () => assert.fail("replay cannot consult UI");
  const reproduced = await chooseChainResponseReference(replay.chain, replay.candidate, replay.game.bot);
  assert.equal(reproduced?.target.card, replay.dragons[1]);
  assert.equal(replay.game.decisionBroker.replayCursor, 1);
});

for (const field of ["chainId", "respondingToLinkId", "sourceDuelCardId", "effectId", "candidateKeys"] as const) {
  test(`CS-02 malformed replay reference ${field} rejects without hanging`, async t => {
    const live = referenceScenario(t), playback = referenceScenario(t);
    const decisions: ReplayDecisionInput[] = [];
    live.game.on("decision_made", value => decisions.push(structuredClone(value)));
    const choose = chooseChainResponseReference(live.chain, live.candidate, live.game.bot);
    const session = required(live.game.targetSelection), requirement = required(session.requirements[0]);
    session.selections[requirement.id] = [required(requirement.candidates[1]).key];
    await live.game.finishTargetSelection(); await choose;
    const invalid: ReplayDecisionInput[] = JSON.parse(JSON.stringify(decisions));
    if (field === "candidateKeys") required(invalid[0]).candidateKeys = ["wrong"];
    else Reflect.set(required(required(invalid[0]).context), field, field === "effectId" ? "wrong" : 999);
    playback.game.decisionBroker.loadReplayDecisions(invalid);
    playback.game.ui.showTargetSelection = () => assert.fail("no replay UI");
    await assert.rejects(chooseChainResponseReference(playback.chain, playback.candidate, playback.game.bot),
      /reference choice does not match/);
  });
}

for (const seat of ["player", "bot"] as const) {
  for (const purpose of ["cost", "target"] as const) {
    test(`off-turn human Chain ${purpose} records and replays the selecting actor (${seat})`, async t => {
      const setup = () => {
        const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
        t.after(() => game.dispose());
        game.turn = seat === "player" ? "bot" : "player";
        const actor = game[seat];
        actor.controllerType = "human";
        const source = new Card({ name: "Selection source", cardKind: "trap" }, actor.id);
        const target = new Card({ name: "Selection target", cardKind: "monster" }, actor.id);
        actor.hand.push(target);
        game.ensureDuelCardId(target);
        const definitions: ChainEffectTarget[] = [{ id: "chosen", owner: "self", zone: "hand",
          cardKind: "monster", count: { min: 1, max: 1 } }];
        const choose = () => game.chainSystem.getPlayerSelectionsForDefinitions(
          source, definitions, actor, null, { purpose });
        return { game, target, choose };
      };
      const live = setup();
      const decisions: ReplayDecisionInput[] = [];
      live.game.on("decision_made", decision => { decisions.push(structuredClone(decision)); });
      const pending = live.choose();
      const session = required(live.game.targetSelection);
      const requirement = required(session.requirements[0]);
      session.selections.chosen = [required(requirement.candidates[0]).key];
      await live.game.finishTargetSelection();
      assert.deepEqual(await pending, { chosen: [live.target] });
      assert.equal(decisions.length, 1);
      assert.equal(required(decisions[0]).actorId, seat);
      assert.equal(required(decisions[0]).kind, purpose);

      const playback = setup();
      assert.notEqual(playback.target.instanceId, live.target.instanceId);
      playback.game.decisionBroker.loadReplayDecisions(JSON.parse(JSON.stringify(decisions)));
      playback.game.ui.showTargetSelection = () => assert.fail("Replay must not open human UI");
      const replayedActors: unknown[] = [];
      playback.game.on("decision_made", decision => { replayedActors.push(decision.actorId); });
      assert.deepEqual(await playback.choose(), { chosen: [playback.target] });
      await playback.game.pendingReplayDecisionPromise;
      assert.deepEqual(replayedActors, [seat]);
      assert.equal(playback.game.decisionBroker.replayCursor, 1);
      assert.equal(playback.game.targetSelection, null);
    });
  }
}

function scenario(t: TestContext, seat: "player" | "bot") {
  const first = new Bot("techzero"); first.id = "player";
  const second = new Bot("techzero");
  const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true });
  game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot supplies the Player runtime in either physical seat");
  t.after(() => game.dispose("response_decision_transport"));
  game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
  game.disablePresentationDelays = true;
  const player = seat === "player" ? first : second;
  const make = (id: number) => new Card(cardDefinition(id), player.id);
  const scrapyard = make(520), core = make(501), raptor = make(505), prism = make(506), machine = make(503);
  scrapyard.isFacedown = true; scrapyard.setTurn = 2;
  placeFieldCards(player.spellTrap, scrapyard); placeFieldCards(player.field, prism);
  player.graveyard.push(core, raptor); player.extraDeck.push(machine);
  for (const card of [scrapyard, core, raptor, prism, machine]) game.ensureDuelCardId(card);
  const context: FastEffectContextInput = { type: "phase_change", player, fromPhase: "main1", toPhase: "battle" };
  return { game, player, context, scrapyard, core, raptor, prism, machine, chain: game.chainSystem };
}

for (const seat of ["player", "bot"] as const) {
  test(`offerChainResponse keeps Core and exact Synchro materials through preparation (${seat})`, async t => {
    const { player, chain, context, core, prism, machine } = scenario(t, seat);
    const offered = required(await chain.offerChainResponse(player, context));
    assert.ok("candidateKey" in offered);
    const preparation = await chain.prepareChainResponse(offered, player, context);
    assert.equal(preparation.success, true);
    const prepared = required(preparation.preparedActivation);
    assert.deepEqual(prepared.targetSelections, {});
    assert.deepEqual(prepared.activationContext.decisions?.specialSummons?.tech_zero_scrapyard_activation, [core.instanceId]);
    assert.deepEqual(prepared.activationContext.decisions?.synchroSummons?.tech_zero_scrapyard_activation, {
      synchroInstanceId: machine.instanceId,
      materialInstanceIds: [core.instanceId, prism.instanceId],
      position: "attack",
    });
    chain.addToChain(prepared);
    await chain.resolveChain();
    assert.ok(player.field.includes(machine));
  });

  test(`Chain replay remaps exact decisions to rebuilt instances (${seat})`, async t => {
    const live = scenario(t, seat);
    const decisions: ReplayDecisionInput[] = [];
    live.game.on("decision_made", decision => { decisions.push(structuredClone(decision)); });
    const offered = required(await live.chain.offerChainResponse(live.player, live.context));
    assert.ok("candidateKey" in offered);
    const prepared = required((await live.chain.prepareChainResponse(offered, live.player, live.context)).preparedActivation);
    assert.deepEqual(prepared.targetSelections, {});
    assert.deepEqual(prepared.activationContext.decisions?.specialSummons?.tech_zero_scrapyard_activation, [live.core.instanceId]);
    live.chain.addToChain(prepared);
    await live.chain.resolveChain();
    assert.ok(live.player.field.includes(live.machine));
    const playback = scenario(t, seat);
    assert.notEqual(playback.core.instanceId, live.core.instanceId);
    assert.equal(playback.core.duelCardId, live.core.duelCardId);
    playback.game.decisionBroker.loadReplayDecisions(decisions);
    const replayed = required(await playback.chain.offerChainResponse(playback.player, playback.context));
    assert.ok("candidateKey" in replayed);
    const replayPrepared = required((await playback.chain.prepareChainResponse(replayed, playback.player, playback.context)).preparedActivation);
    assert.deepEqual(replayPrepared.targetSelections, {});
    assert.deepEqual(replayPrepared.activationContext.decisions?.specialSummons?.tech_zero_scrapyard_activation, [playback.core.instanceId]);
    assert.deepEqual(replayPrepared.activationContext.decisions?.synchroSummons?.tech_zero_scrapyard_activation, {
      synchroInstanceId: playback.machine.instanceId,
      materialInstanceIds: [playback.core.instanceId, playback.prism.instanceId],
      position: "attack",
    });
    playback.chain.addToChain(replayPrepared);
    await playback.chain.resolveChain();
    assert.ok(playback.player.field.includes(playback.machine));
  });
}

test("offering a Chain response rejects forged sources, timing and execution flags", async t => {
  const { chain, player, context, raptor } = scenario(t, "bot");
  const candidate = required(chain.getActivatableCardsInChain(player, context)[0]);
  for (const response of [
    { ...candidate, card: raptor },
    { ...candidate, candidateKey: "not-a-candidate" },
    { ...candidate, context: { ...candidate.context, type: "summon" as const } },
    { ...candidate, activationContext: unsafeFixture<NonNullable<typeof candidate.activationContext>>({ costsPaid: true }, "Invalid provider must not bypass activation costs") },
    { ...candidate, activationContext: { decisions: unsafeFixture<NonNullable<NonNullable<typeof candidate.activationContext>["decisions"]>>({ selections: { target: [false] } }, "Malformed provider plan must be rejected") } },
    { ...candidate, activationContext: { decisions: { selections: { tech_zero_scrapyard_tuner: ["missing-instance"] } } } },
  ]) {
    player.strategy.chooseChainResponse = async () => response;
    assert.equal(await chain.offerChainResponse(player, context), null);
  }
});

test("Chain transport records every choice channel with duel-local identities", async t => {
  const live = scenario(t, "bot");
  const candidate = required(live.chain.getActivatableCardsInChain(live.player, live.context)[0]);
  live.player.strategy.chooseChainResponse = async () => ({ ...candidate, activationContext: { decisions: {
    selections: { tech_zero_scrapyard_tuner: [live.core.instanceId] },
    cases: { level: "increase" }, specialSummons: { revive: [live.core.instanceId, live.raptor.instanceId] },
    specialSummonRevalidation: { revive: "remaining" },
    synchroSummons: { tech_zero_scrapyard_activation: { synchroInstanceId: live.machine.instanceId,
      materialInstanceIds: [live.core.instanceId, live.prism.instanceId], position: "defense" } },
  } } });
  const decisions: ReplayDecisionInput[] = [];
  live.game.on("decision_made", decision => { decisions.push(structuredClone(decision)); });
  assert.ok(await live.chain.offerChainResponse(live.player, live.context));
  assert.deepEqual(required(decisions[0]).value, {
    pass: false, candidateKey: "1:tech_zero_scrapyard_activation:spellTrap", effectId: "tech_zero_scrapyard_activation",
    decisions: {
      selections: { tech_zero_scrapyard_tuner: [2] }, cases: { level: "increase" },
      specialSummons: { revive: [2, 3] }, specialSummonRevalidation: { revive: "remaining" },
      synchroSummons: { tech_zero_scrapyard_activation: { synchroDuelCardId: 5, materialDuelCardIds: [2, 4], position: "defense" } },
    },
  });
  const playback = scenario(t, "bot");
  playback.game.decisionBroker.loadReplayDecisions(decisions);
  const replayed = required(await playback.chain.offerChainResponse(playback.player, playback.context));
  assert.ok("candidateKey" in replayed);
  assert.deepEqual(replayed.context.activationContext?.decisions, {
    selections: { tech_zero_scrapyard_tuner: [playback.core.instanceId] },
    cases: { level: "increase" }, specialSummons: { revive: [playback.core.instanceId, playback.raptor.instanceId] },
    specialSummonRevalidation: { revive: "remaining" },
    synchroSummons: { tech_zero_scrapyard_activation: { synchroInstanceId: playback.machine.instanceId,
      materialInstanceIds: [playback.core.instanceId, playback.prism.instanceId], position: "defense" } },
  });
});

for (const reset of ["scenario", "duel", "dispose"] as const) {
  test(`mandatory human Chain decision settles on ${reset} teardown without a recorded choice`, async t => {
    const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
    t.after(() => game.dispose());
    const source = new Card({ name: "Abort source", cardKind: "trap" }, "player");
    game.applyScenarioSetup({ phase: "main1", player: { hand: [{ id: 1 }] } });
    const decisions: unknown[] = [];
    game.on("decision_made", decision => { decisions.push(decision); });
    let settled = false;
    const pending = Promise.resolve(game.chainSystem.getPlayerSelectionsForDefinitions(source,
      [{ id: "chosen", owner: "self", zone: "hand", cardKind: "monster", count: { min: 1, max: 1 } }],
      game.player, null, { purpose: "target", allowCancel: false })).then(value => { settled = true; return value; });
    assert.ok(game.targetSelection);
    game.cancelTargetSelection();
    assert.ok(game.targetSelection, "player cannot abandon the mandatory decision");
    if (reset === "scenario") game.applyScenarioSetup({ phase: "main1", player: { hand: [{ id: 3 }] } });
    else if (reset === "duel") game.resetDuelState();
    else game.dispose();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, true, "teardown must settle the decision consumer");
    assert.equal(await pending, null);
    assert.deepEqual(decisions, []);
    assert.equal(game.targetSelection, null);
  });
}
