import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { ReplayDecisionInput } from "../src/core/contracts/decisions.js";
import type { ActionRuntimeGamePort } from "../src/core/contracts/actionRuntime.js";
import type { SelectionSessionInput } from "../src/core/contracts/selection.js";
import { cardDefinition, required, unsafeFixture } from "./helpers/fixtures.js";
import { createRuntimeGame, completeTestSelections } from "./helpers/game.js";
import { selectResolutionCards } from "../src/core/actionHandlers/shared.js";

function setup(t: TestContext, human = false, seat: "player" | "bot" = "player") {
  const game = createRuntimeGame({ laboratoryMode: true, randomSeed: 267 });
  t.after(() => game.dispose());
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  const owner = game[seat]; owner.controllerType = human ? "human" : "ai";
  const make = (id: number) => new Card(cardDefinition(id), owner.id);
  const source = make(267), first = make(252), chosen = make(255), grave = make(254);
  owner.deck.push(first, chosen); owner.graveyard.push(grave);
  const run = () => game.effectEngine.applyActions([{
    type: "optional_target_actions", optional: false, allowCancel: false,
    targets: [
      { id: "deck_choice", owner: "self", zone: "deck", count: { min: 1, max: 1 } },
      { id: "grave_choice", owner: "self", zone: "graveyard", count: { min: 1, max: 1 } },
    ],
    actions: [
      { type: "move", targetRef: "deck_choice", to: "hand" },
      { type: "move", targetRef: "grave_choice", to: "hand" },
    ],
  }], { source, player: owner, opponent: seat === "player" ? game.bot : game.player,
    activationContext: { autoSelectTargets: true, autoSelectSingleTarget: true,
      decisions: { selections: { deck_choice: [chosen.instanceId], grave_choice: [grave.instanceId] } } } }, {});
  return { game, owner, chosen, grave, run };
}

test("planned AI resolution choices with multiple requirements are recorded and replayed without consulting AI", async t => {
  const live = setup(t), playback = setup(t);
  const decisions: ReplayDecisionInput[] = [];
  live.game.on("decision_made", decision => { decisions.push(decision); });
  await live.run();
  assert.ok(live.owner.hand.includes(live.chosen)); assert.ok(live.owner.hand.includes(live.grave));
  assert.equal(decisions.length, 1); assert.equal(decisions[0]?.kind, "choice");
  playback.game.decisionBroker.loadReplayDecisions(decisions);
  playback.game.autoSelector.select = () => { throw new Error("playback must consume the recorded choices"); };
  await playback.run();
  assert.ok(playback.owner.hand.includes(playback.chosen)); assert.ok(playback.owner.hand.includes(playback.grave));
  assert.equal(playback.game.decisionBroker.replayCursor, 1);
});

for (const seat of ["player", "bot"] as const) {
  test(`human resolution choices keep the correct actor and require an explicit singleton choice (${seat})`, async t => {
    const { game, owner, grave, run } = setup(t, true, seat);
    const decisions: ReplayDecisionInput[] = [];
    game.on("decision_made", decision => { decisions.push(decision); });
    await completeTestSelections(game, run());
    assert.ok(owner.hand.includes(grave));
    assert.equal(decisions.length, 1); assert.equal(decisions[0]?.actorId, seat);
    assert.equal(decisions[0]?.kind, "choice");
  });
}

for (const optional of [false, true]) {
  test(`an unavailable local choice is ${optional ? "skipped" : "mandatory"}`, async t => {
    const { game, owner } = setup(t);
    owner.deck.length = 0;
    const result = await game.effectEngine.applyActions([{ type: "optional_target_actions", optional, allowCancel: false,
      targets: [{ id: "missing", owner: "self", zone: "deck", count: { min: 1, max: 1 } }],
      actions: [{ type: "draw", amount: 1, player: "self" }],
    }], { player: owner, opponent: game.bot }, {});
    assert.ok(result && typeof result === "object");
    assert.equal(result.success, optional);
  });
}

test("an optional resolution choice rejects an AI card outside the candidate list", async t => {
  const { game, owner, chosen, grave } = setup(t);
  const result = await selectResolutionCards({ game: unsafeFixture<ActionRuntimeGamePort>(game,
    "Concrete Game provides the helper runtime; its public AutoSelector projection is intentionally smaller."), player: owner, cards: [chosen],
    requirementId: "optional_choice", min: 0, max: 1,
    locate: () => ({ player: owner, zone: "deck", index: owner.deck.indexOf(chosen) }),
    resolveAI: () => [grave],
  });
  assert.equal(result, null);
});

for (const mutation of ["permutation", "replacement"] as const) {
  test(`AI resolution replay preserves same-card-ID identity after ${mutation}`, async t => {
    const fixture = () => {
      const base = setup(t);
      const first = new Card(cardDefinition(3), base.owner.id);
      const chosen = new Card(cardDefinition(3), base.owner.id);
      base.owner.deck.splice(0, base.owner.deck.length, first, chosen);
      base.game.ensureDuelCardId(first);
      base.game.ensureDuelCardId(chosen);
      return { ...base, first, chosen };
    };
    const live = fixture(), playback = fixture();
    const decisions: ReplayDecisionInput[] = [];
    live.game.on("decision_made", decision => { decisions.push(decision); });
    const run = (current: typeof live) => selectResolutionCards({ game: unsafeFixture<ActionRuntimeGamePort>(current.game,
      "Concrete Game provides the helper runtime; its public AutoSelector projection is intentionally smaller."),
      player: current.owner, cards: current.owner.deck, requirementId: "optional_choice", min: 0, max: 1,
      locate: card => ({ player: current.owner, zone: "deck", index: current.owner.deck.indexOf(card) }),
      resolveAI: () => [current.chosen],
    });
    assert.deepEqual(await run(live), [live.chosen]);
    assert.deepEqual(required(decisions[0]).value, { selections: { optional_choice: [{
      duelCardId: live.chosen.duelCardId, cardId: live.chosen.id, effectId: null, candidateKey: null, key: null,
    }] } });
    if (mutation === "permutation") playback.owner.deck.reverse();
    else {
      const replacement = new Card(cardDefinition(3), playback.owner.id);
      playback.game.ensureDuelCardId(replacement);
      playback.owner.deck.splice(1, 1, replacement);
    }
    playback.game.decisionBroker.loadReplayDecisions(decisions);
    playback.game.autoSelector.select = () => assert.fail("Replay must not consult the AI selector");
    if (mutation === "permutation") assert.deepEqual(await run(playback), [playback.chosen]);
    else await assert.rejects(run(playback), /no longer legal/);
  });
}

for (const invalid of ["stale", "duplicate", "too_many"] as const) {
  test(`an optional resolution choice rejects ${invalid} replay identities without dropping them`, async t => {
    const live = setup(t), playback = setup(t);
    const decisions: ReplayDecisionInput[] = [];
    live.game.on("decision_made", decision => { decisions.push(decision); });
    const run = (fixture: typeof live) => selectResolutionCards({ game: unsafeFixture<ActionRuntimeGamePort>(fixture.game,
      "Concrete Game provides the helper runtime; its public AutoSelector projection is intentionally smaller."), player: fixture.owner,
      cards: [fixture.chosen, fixture.grave], requirementId: "optional_choice", min: 0, max: 1,
      locate: card => ({ player: fixture.owner, zone: card === fixture.chosen ? "deck" : "graveyard",
        index: card === fixture.chosen ? fixture.owner.deck.indexOf(fixture.chosen) : 0 }),
      resolveAI: () => [fixture.chosen],
    });
    assert.deepEqual(await run(live), [live.chosen]);
    const decision = required(decisions[0]);
    assert.ok(typeof decision.value === "object" && decision.value !== null);
    const selections = Reflect.get(decision.value, "selections");
    assert.ok(typeof selections === "object" && selections !== null);
    const recorded = Reflect.get(selections, "optional_choice");
    assert.ok(Array.isArray(recorded));
    const identity: unknown = required(recorded[0]);
    assert.ok(typeof identity === "object" && identity !== null);
    const identities = invalid === "stale" ? [{ ...identity, duelCardId: 99999 }]
      : invalid === "duplicate" ? [identity, identity] : [identity, { ...identity, duelCardId: live.grave.duelCardId }];
    playback.game.decisionBroker.loadReplayDecisions([{ ...decision, value: { selections: { optional_choice: identities } } }]);
    await assert.rejects(run(playback), /no longer legal/);
  });
}

for (const recordedKind of ["empty", "stale", "null", "missing", "missing_duel_identity", "missing_duel_field"] as const) {
  test(`a human optional resolution replay ${recordedKind === "empty" ? "accepts" : "rejects"} ${recordedKind}`, async t => {
    const { game, owner, chosen } = setup(t, true);
    const decisions: ReplayDecisionInput[] = [];
    game.on("decision_made", decision => { decisions.push(decision); });
    const candidate = { cardRef: chosen, owner: "player", controller: owner.id, zone: "deck", zoneIndex: 1 } as const;
    const key = game.buildSelectionCandidateKey(candidate, 0);
    const session: SelectionSessionInput = {
      kind: "choice", owner,
      selectionContract: { kind: "choice", requirements: [{ id: "optional_choice", min: 0, max: 1,
        candidates: [{ ...candidate, key }] }], ui: { allowEmpty: true } },
      execute: () => ({ success: true, needsSelection: false }),
    };
    game.startTargetSelectionSession(session);
    await game.finishTargetSelection();
    const decision = required(decisions[0]);
    let replaySession = session;
    if (recordedKind === "missing_duel_identity" || recordedKind === "missing_duel_field") {
      game.ensureDuelCardId(chosen);
      await game.moveCard(chosen, owner, "graveyard", { fromZone: "deck" });
      const replacement = new Card(cardDefinition(required(chosen.id)), owner.id);
      owner.deck.push(replacement);
      game.ensureDuelCardId(replacement);
      replaySession = { ...session, selectionContract: { kind: "choice", requirements: [{
        id: "optional_choice", min: 0, max: 1, candidates: [{ ...candidate, cardRef: replacement, key }],
      }], ui: { allowEmpty: true } } };
    }
    const value = recordedKind === "null" ? null : recordedKind === "missing" ? { selections: {} }
      : recordedKind === "missing_duel_identity" ? { selections: { optional_choice: [{
        duelCardId: null, cardId: chosen.id, effectId: null, candidateKey: null, key,
      }] } }
      : recordedKind === "missing_duel_field" ? { selections: { optional_choice: [{ key }] } }
      : { selections: { optional_choice: recordedKind === "stale" ? [{ key: "missing" }] : [] } };
    game.decisionBroker.loadReplayDecisions([{ ...decision, value }]);
    const replay = game.startTargetSelectionSession(replaySession);
    if (recordedKind !== "empty") await assert.rejects(Promise.resolve(replay), /resolution choice/);
    else { await replay; assert.equal(game.targetSelection, null); }
  });
}

test("a human resolution replay preserves key matching for a choice without a card", async t => {
  const { game, owner } = setup(t, true);
  const decisions: ReplayDecisionInput[] = [];
  game.on("decision_made", decision => { decisions.push(decision); });
  const candidate = { owner: "player", controller: owner.id, zone: "deck", zoneIndex: 0, label: "Manual case" } as const;
  const key = game.buildSelectionCandidateKey(candidate, 0);
  const session: SelectionSessionInput = { kind: "choice", owner, selectionContract: {
    kind: "choice", requirements: [{ id: "manual_case", min: 1, max: 1, candidates: [{ ...candidate, key }] }],
  }, execute: () => ({ success: true, needsSelection: false }) };
  game.startTargetSelectionSession(session);
  required(game.targetSelection).selections.manual_case = [key];
  await game.finishTargetSelection();
  assert.deepEqual(required(decisions[0]).value, { selections: { manual_case: [{
    duelCardId: null, cardId: null, effectId: null, candidateKey: null, key,
  }] } });
  game.decisionBroker.loadReplayDecisions(decisions);
  game.ui.showTargetSelection = () => assert.fail("Replay must not open a selection prompt");
  await game.startTargetSelectionSession(session);
  assert.equal(game.decisionBroker.replayCursor, 1);
});

test("cancelling an optional human resolution choice records empty and replays it without prompts", async t => {
  const live = setup(t, true), playback = setup(t, true);
  const decisions: ReplayDecisionInput[] = [];
  live.game.on("decision_made", decision => { decisions.push(decision); });
  const run = (fixture: typeof live) => selectResolutionCards({ game: unsafeFixture<ActionRuntimeGamePort>(fixture.game,
    "Concrete Game provides the helper runtime; its public AutoSelector projection is intentionally smaller."), player: fixture.owner,
    cards: [fixture.chosen], requirementId: "optional_choice", min: 0, max: 1,
    locate: () => ({ player: fixture.owner, zone: "deck", index: 1 }),
    resolveAI: () => assert.fail("Human choices must not use the AI resolver"),
  });
  const pending = run(live);
  assert.ok(live.game.targetSelection);
  live.game.cancelTargetSelection();
  assert.deepEqual(await pending, []);
  assert.equal(decisions.length, 1);
  assert.deepEqual(decisions[0]?.value, { selections: { optional_choice: [] } });
  playback.game.decisionBroker.loadReplayDecisions(decisions);
  playback.game.ui.showTargetSelection = () => assert.fail("Replay must not open a selection prompt");
  playback.game.autoSelector.select = () => assert.fail("Replay must not consult the AI selector");
  assert.deepEqual(await run(playback), []);
  assert.equal(playback.game.decisionBroker.replayCursor, 1);
});
