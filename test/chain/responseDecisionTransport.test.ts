import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import type { ChainEffectTarget, FastEffectContextInput } from "../../src/core/contracts/chainRuntime.js";
import type { ReplayDecisionInput } from "../../src/core/contracts/decisions.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

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
    assert.deepEqual(Reflect.get(prepared.targetSelections, "tech_zero_scrapyard_tuner"), [core]);
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
    assert.deepEqual(Reflect.get(prepared.targetSelections, "tech_zero_scrapyard_tuner"), [live.core]);
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
    assert.deepEqual(Reflect.get(replayPrepared.targetSelections, "tech_zero_scrapyard_tuner"), [playback.core]);
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
