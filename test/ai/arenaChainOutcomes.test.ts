import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import { ArenaAnalytics, DuelTracker } from "../../src/core/ai/ArenaAnalytics.js";
import { cardDefinition, chainSelections, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function scenario(t: TestContext, seat: "player" | "bot") {
  const first = new Bot("techzero"); first.id = "player";
  const game = createRuntimeGame({ opponentOverride: new Bot("techzero"), captureReplay: false, laboratoryMode: true });
  game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot supplies the Player runtime in either physical seat");
  t.after(() => game.dispose("arena_chain_outcomes"));
  game.turn = seat; game.turnCounter = 4; game.phase = "main1";
  game.disablePresentationDelays = true;
  game.ui.log = () => {};
  const player = seat === "player" ? game.player : game.bot;
  const tracker = new DuelTracker(1, "techzero", "techzero");
  game._arenaTracker = tracker;
  return { game, player, tracker, chain: game.chainSystem, make: (id: number) => new Card(cardDefinition(id), seat) };
}

for (const seat of ["player", "bot"] as const) {
  test(`Arena preserves a partial Scrapyard response independently of successful Assembly (${seat})`, async t => {
    const { game, player, tracker, chain, make } = scenario(t, seat);
    const assembly = make(519), scrapyard = make(520), core = make(501), catapult = make(502);
    placeFieldCards(player.spellTrap, assembly, scrapyard);
    player.graveyard.push(core); player.deck.push(catapult); player.extraDeck.push(make(503));
    tracker.recordPlanningProgress({ stage: "ai_turn_line_search", actor: seat, plannerUsed: true });
    // Both activations are already committed. Core alone cannot complete Scrapyard's Synchro.
    let responded = false;
    chain.offerChainResponses = async () => {
      if (!responded && chain.getLastChainLink()?.card === assembly) {
        responded = true;
        required(chain.addToChain(chain.createPreparedActivation({ card: scrapyard, controller: player,
          effect: required(scrapyard.effects[0]), activationZone: "spellTrap", committed: true, costsPaid: true,
          targetSelections: chainSelections({ tech_zero_scrapyard_tuner: [core] }),
        })));
      }
      return { offers: 0, activations: 0, lastActivator: null, chainBuilt: false, consecutivePasses: 2 };
    };
    const result = await chain.openActivationChain(chain.createPreparedActivation({ card: assembly, controller: player,
      effect: required(assembly.effects[0]), activationZone: "spellTrap", committed: true, costsPaid: true,
    }));
    assert.equal(result.success, true, JSON.stringify({ reason: result.reason, links: result.resolutionResult?.linkResults?.map(link => ({ success: link.success, reason: link.reason, executed: link.executed, failedAction: link.failedAction })) }));
    assert.equal(result.resolutionResult?.success, false);
    assert.ok(player.field.includes(core), "the first response action has already revived Core");
    assert.ok(player.field.includes(catapult), "Assembly still resolves its own summon");
    tracker.recordAction({ type: "activate", seat, success: result.success });
    tracker.recordPlanningProgress({ stage: "ai_plan_execution_compare", actor: seat, matched: false, mismatchReason: "field_mismatch" });
    const final = tracker.finalize(seat, "max_turns", { player: 8000, bot: 8000 });
    const stats = final.strategic.seats[seat];
    assert.equal(stats.failedActions, 0);
    assert.equal(stats.planning.failedExecutions, 0);
    assert.ok(stats.chainLinks, "each completed Chain link must have its own diagnostic");
    assert.equal(stats.chainLinks.total, 3, "Core's post-Chain summon trigger is a separate successful link");
    assert.equal(stats.chainLinks.succeeded, 2);
    assert.equal(stats.chainLinks.partialFailures, 1);
    assert.equal(stats.chainLinks.failed, 0);
    const partial = required(stats.chainLinks.samples.find(entry => entry.outcome === "partial_failure"));
    assert.equal(partial.controllerId, seat);
    assert.equal(partial.effectId, "tech_zero_scrapyard_activation");
    assert.equal(partial.cardName, scrapyard.name);
    assert.equal(partial.chainLevel, 2);
    assert.equal(partial.failedAction, "synchro_summon_from_extra_deck");
    assert.match(partial.reason || "", /synchro/i);
    assert.notEqual(partial.chainId, null); assert.notEqual(partial.linkId, null);
    const event = required(final.strategic.events.find(entry => entry.type === "chain_link_resolution" && entry.stage === "completed"));
    assert.equal(event.success, false);
    assert.equal(event.outcome, "partial_failure");
    assert.equal(event.failedAction, "synchro_summon_from_extra_deck");
    const rootEvent = required(final.strategic.events.find(entry => entry.effectId === "tech_zero_assembly_line_activation" && entry.stage === "completed"));
    assert.equal(rootEvent.executed, true);
    const mismatch = required(stats.planning.mismatchSamples[0]);
    assert.ok(mismatch.chainLinks, "mismatches must retain link outcomes and controllers observed during execution");
    assert.equal(mismatch.chainLinks.length, 3);
    assert.equal(mismatch.chainLinks[0]?.controllerId, seat);
    assert.equal(mismatch.chainLinks[0]?.failedAction, "synchro_summon_from_extra_deck");
    tracker.recordPlanningProgress({ stage: "ai_turn_line_search", actor: seat, plannerUsed: true });
    tracker.recordPlanningProgress({ stage: "ai_plan_execution_compare", actor: seat, matched: false });
    assert.deepEqual(tracker.finalize(seat, "max_turns", { player: 8000, bot: 8000 }).strategic.seats[seat].planning.mismatchSamples[1]?.chainLinks, []);
    const analytics = new ArenaAnalytics(); analytics.recordDuel(final); analytics.recordDuel(final);
    const merged = required(analytics.exportStrategicReport().bots[`${seat}:techzero`]);
    assert.equal(merged.chainLinks.total, 6);
    assert.equal(merged.chainLinks.partialFailures, 2);
    assert.equal(merged.failedActions, 0);
    assert.equal(game.gameOver, false);
  });

  for (const mode of ["activation", "effect"] as const) {
    test(`Arena counts ${mode} negation once despite repeated terminal notification (${seat})`, async t => {
      const { game, player, tracker, chain, make } = scenario(t, seat);
      const source = make(501);
      placeFieldCards(player.field, source);
      const link = required(chain.addToChain(chain.createPreparedActivation({ card: source, controller: player,
        effect: required(source.effects.find(effect => effect.id === "tech_zero_energy_core_level_mod")),
        activationZone: "field", committed: true, costsPaid: true,
      })));
      assert.ok(link);
      if (mode === "activation") chain.markChainLinkActivationNegated(link);
      else chain.markChainLinkEffectNegated(link);
      game.on("chain_link_resolution", payload => {
        if (payload.stage === "completed") tracker.recordEvent("chain_link_resolution", payload, { turn: 4 });
      });
      await chain.resolveChain();
      const stats = tracker.finalize(seat, "max_turns", { player: 8000, bot: 8000 }).strategic.seats[seat];
      assert.ok(stats.chainLinks, "negated links must have separate diagnostics");
      assert.equal(stats.chainLinks.total, 1);
      assert.equal(stats.chainLinks.succeeded, 0);
      assert.equal(stats.chainLinks.activationNegated, mode === "activation" ? 1 : 0);
      assert.equal(stats.chainLinks.effectNegated, mode === "effect" ? 1 : 0);
      assert.equal(stats.chainLinks.failed, 0);
      assert.equal(stats.chainLinks.partialFailures, 0);
      assert.equal(stats.failedActions, 0);
      assert.equal(stats.chainLinks.samples.length, 1);
      assert.equal(stats.chainLinks.samples[0]?.outcome, `${mode}_negated`);
      assert.equal(tracker.events.filter(event => event.type === "chain_link_resolution" && event.stage === "completed").length, 1);
    });
  }

  test(`Arena distinguishes failure before any action and retains opposing actor in plan diagnostics (${seat})`, async t => {
    const { game, player, tracker, chain, make } = scenario(t, seat);
    const scrapyard = make(520), core = make(501);
    placeFieldCards(player.spellTrap, scrapyard); player.graveyard.push(core);
    required(chain.addToChain(chain.createPreparedActivation({ card: scrapyard, controller: player,
      effect: required(scrapyard.effects[0]), activationZone: "spellTrap", committed: true, costsPaid: true,
      targetSelections: chainSelections({ tech_zero_scrapyard_tuner: [core] }),
    })));
    const planningSeat = seat === "player" ? "bot" : "player";
    tracker.recordPlanningProgress({ stage: "ai_turn_line_search", actor: planningSeat, plannerUsed: true });
    await game.moveCard(core, player, "banished", { fromZone: "graveyard" });
    await chain.resolveChain();
    tracker.recordPlanningProgress({ stage: "ai_plan_execution_compare", actor: planningSeat, matched: false });
    const result = tracker.finalize(seat, "max_turns", { player: 8000, bot: 8000 });
    const stats = result.strategic.seats[seat].chainLinks;
    assert.equal(stats.total, 1);
    assert.equal(stats.failed, 1);
    assert.equal(stats.partialFailures, 0);
    assert.equal(stats.samples[0]?.outcome, "failed");
    assert.match(stats.samples[0]?.reason || "", /target/i);
    const observed = required(result.strategic.seats[planningSeat].planning.mismatchSamples[0]?.chainLinks[0]);
    assert.equal(observed.controllerId, seat);
    assert.equal(observed.effectId, "tech_zero_scrapyard_activation");
    assert.equal(result.strategic.seats[planningSeat].chainLinks.total, 0);
  });
}

test("Arena link totals continue beyond the bounded event log and do not infer outcomes from legacy notifications", () => {
  const tracker = new DuelTracker(1, "techzero", "techzero");
  tracker.recordEvent("chain_link_resolution", { stage: "completed", chainId: "old", linkId: 1, controllerId: "player" });
  for (let linkId = 1; linkId <= 410; linkId++) {
    const payload = { stage: "completed", chainId: 1, linkId, controllerId: "player", outcome: "failed" as const, success: false };
    tracker.recordEvent("chain_link_resolution", payload);
    tracker.recordEvent("chain_link_resolution", payload);
  }
  const result = tracker.finalize("player", "max_turns", { player: 8000, bot: 8000 });
  assert.equal(result.strategic.seats.player.chainLinks.total, 410);
  assert.equal(result.strategic.seats.player.chainLinks.failed, 410);
  assert.equal(result.strategic.seats.player.chainLinks.samples.length, 5);
  assert.equal(result.strategic.events.length, 400);
  assert.equal(result.strategic.seats.player.failedActions, 0);
});
