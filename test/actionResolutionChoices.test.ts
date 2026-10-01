import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { ReplayDecisionInput } from "../src/core/contracts/decisions.js";
import { cardDefinition } from "./helpers/fixtures.js";
import { createRuntimeGame, completeTestSelections } from "./helpers/game.js";

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
