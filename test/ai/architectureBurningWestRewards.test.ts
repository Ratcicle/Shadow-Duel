import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../../src/core/Card.js";
import { applyBurningWestSimulatedBattleRewards } from "../../src/core/ai/burningwest/battle.js";
import type { SimulatedTemporaryEventEffect } from "../../src/core/ai/common/simulatedActions/shared.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

const registration = required((cardDefinition(459).effects || [])
  .flatMap(effect => effect.actions || [])
  .find(action => action.type === "register_temporary_event_effect"));
assert.equal(registration.type, "register_temporary_event_effect");
if (registration.type !== "register_temporary_event_effect") throw new Error("Deadeye registration required");
const rewardActions = registration.actions || [];

function scenario(t: TestContext, seat: "player" | "bot", deckSize = 2) {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false, disableChains: true });
  t.after(() => game.dispose("architecture_burning_west_rewards_test"));
  game.turn = seat;
  game.phase = "battle";
  game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.player.controllerType = game.bot.controllerType = "ai";
  const owner = game[seat];
  const opponent = game[seat === "player" ? "bot" : "player"];
  const source = new Card(cardDefinition(459), seat);
  const attacker = new Card(cardDefinition(455), seat);
  const destroyed = new Card(cardDefinition(503), opponent.id);
  placeFieldCards(owner.field, attacker);
  owner.graveyard.push(source);
  opponent.graveyard.push(destroyed);
  const deckIds = [458, 461].slice(0, deckSize);
  owner.deck.push(...deckIds.map(id => new Card(cardDefinition(id), seat)));
  const entry = {
    event: "battle_destroy", ownerId: seat, sourceCardId: 459,
    sourceName: "Deadeye of the Burning West", sourceCardKind: "spell", sourceCardSubtype: "normal",
    sourceArchetype: "Burning West", sourceArchetypes: ["Burning West"],
    sourceEffectId: "deadeye_of_the_burning_west", sourceInstanceId: "deadeye:source",
    boundEventTargetInstanceId: null, requireBoundTargetLeavesField: false,
    duration: "end_of_turn", createdOnTurn: 4, expiresOnTurn: 4, usesRemaining: 1,
    declaredValues: { burning_west_deadeye_type: {
      property: "type", value: "Machine", declaredOnTurn: 4, expiresOnTurn: 4, duration: "end_of_turn",
    } },
    effect: { id: "deadeye_of_the_burning_west_reward", timing: "on_event" as const,
      event: "battle_destroy" as const, triggerRequirement: "mandatory" as const,
      triggerTiming: "if" as const, conditions: registration.conditions || [], actions: rewardActions },
  } satisfies SimulatedTemporaryEventEffect;
  const simulatedAttacker = simulationCard({ ...cardDefinition(455), owner: seat, instanceId: "attacker:1" });
  const state = Object.assign(simulationState({ turn: seat, phase: "battle", turnCounter: 4, _isPerspectiveState: true,
    player: { id: seat === "bot" ? "player" : "bot" },
    bot: { id: seat, field: [simulatedAttacker],
      deck: deckIds.map(id => simulationCard({ ...cardDefinition(id), owner: seat, instanceId: `deck:${id}` })) },
  }), { temporaryEventEffects: [entry] });
  const summary = { damage: 0, destroyedCards: [{ ...simulationCard({ ...cardDefinition(503), instanceId: "destroyed:1" }),
    owner: "opponent", destroyedBy: "battle", monsterType: "synchro" }] };
  const apply = () => applyBurningWestSimulatedBattleRewards({ state, bot: state.bot,
    opponent: state.player, battlePlan: { attackerCard: simulatedAttacker }, summary });
  const runtime = () => game.effectEngine.applyActions(rewardActions,
    { source, player: owner, opponent, attacker, destroyed, destroyedOwner: opponent }, {});
  return { owner, opponent, state, summary, apply, runtime, entry };
}

for (const seat of ["player", "bot"] as const) {
  test(`Deadeye battle reward conceals the drawn identity (${seat})`, async t => {
    const { owner, opponent, state, apply, runtime } = scenario(t, seat);
    assert.equal((await runtime()).success, true);
    apply();
    assert.equal(state.bot.hand.length, owner.hand.length);
    assert.equal(state.player.lp, opponent.lp);
    assert.equal(state.player.lp, 7000);
    const drawn = required(state.bot.hand[0]);
    assert.equal(drawn._simUnknownDraw, true, "battle rewards must use the common opaque draw contract");
    assert.equal(drawn.id, undefined);
    assert.equal(drawn.name, undefined);
  });

  test(`Deadeye battle reward marks unknown draw for replanning (${seat})`, t => {
    const { state, apply } = scenario(t, seat);
    apply();
    assert.equal(state._simRequiresReplan, true);
    assert.equal(state._simUnknownDrawCount, 1);
  });

  test(`Deadeye battle reward removes the runtime Deck top (${seat})`, async t => {
    const { owner, state, apply, runtime } = scenario(t, seat);
    await runtime();
    apply();
    assert.deepEqual(owner.deck.map(card => card.id), [458]);
    assert.deepEqual(state.bot.deck.map(card => card.id), [458]);
  });

  test(`an empty mandatory Deadeye draw cannot manufacture its following burn (${seat})`, async t => {
    const { owner, opponent, state, summary, apply, runtime } = scenario(t, seat, 0);
    assert.equal((await runtime()).success, false);
    assert.equal(opponent.lp, 8000);
    apply();
    assert.equal(state.bot.hand.length, owner.hand.length);
    assert.equal(state.player.lp, opponent.lp);
    assert.equal(summary.damage, 0);
    assert.equal(state._simRequiresReplan === true, false);
  });
}

test("Deadeye registration waits for a matching destruction and consumes only one reward", t => {
  const { state, summary, entry, apply } = scenario(t, "bot");
  const destroyed = required(summary.destroyedCards[0]);
  destroyed.type = "Dragon";
  assert.deepEqual(apply(), []);
  assert.equal(entry.usesRemaining, 1);
  assert.equal(state.bot.hand.length, 0);
  destroyed.type = "Machine";
  apply();
  assert.equal(entry.usesRemaining, 0);
  assert.equal(state.bot.hand.length, 1);
  apply();
  assert.equal(state.bot.hand.length, 1);
  assert.equal(state.player.lp, 7000);
});

test("an expired Deadeye registration cannot consume, draw or burn", t => {
  const { state, entry, apply } = scenario(t, "bot");
  state.turnCounter = 5;
  entry.declaredValues.burning_west_deadeye_type.expiresOnTurn = 6;
  assert.deepEqual(apply(), []);
  assert.equal(entry.usesRemaining, 1);
  assert.equal(state.bot.deck.length, 2);
  assert.equal(state.bot.hand.length, 0);
  assert.equal(state.player.lp, 8000);
});
