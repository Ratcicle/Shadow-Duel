import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { gameTreeSearch } from "../../src/core/ai/GameTreeSearch.js";
import { getPlanningModel } from "../../src/core/ai/PlanningStrategies.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { PlanningModel } from "../../src/core/contracts/aiPlanning.js";
import type { AiPlayerInput, AiStateInput } from "../../src/core/contracts/aiState.js";
import { cardDefinition, record, required } from "../helpers/fixtures.js";
import { createRuntimeGame } from "../helpers/game.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";

const idle: AIAction = { type: "position_change", fieldIndex: 99, toPosition: "attack" };

function predict(
  input: AiStateInput,
  actor: AiPlayerInput,
  action: AIAction,
  modelId: string,
) {
  let next: AiStateInput | undefined;
  const real = getPlanningModel(modelId);
  const model: PlanningModel = { id: modelId, create(state) {
    const strategy = real.create(state);
    return {
      generateMainPhaseActions(snapshot) {
        if (snapshot.bot.id === actor.id) return [action];
        next = snapshot;
        return [idle];
      },
      simulateMainPhaseAction: strategy.simulateMainPhaseAction.bind(strategy),
      getPlanningSimulationOptions: snapshot => strategy.getPlanningSimulationOptions?.(snapshot) || {},
    };
  } };
  const result = gameTreeSearch(input, { generateMainPhaseActions: () => [], simulateMainPhaseAction() {} }, actor, 2,
    { root: model, actors: new Map([input.bot, input.player].flatMap(player => player?.id ? [[player.id, model] as const] : [])) });
  assert.equal(result.action, action);
  return { result, next: required(next) };
}

test("GameTree follows registered Shadow-Heart Imp into Gecko summon and Deck search", () => {
  const input = simulationState({
    turn: "bot", phase: "main1", turnCounter: 2,
    bot: {
      hand: ["Shadow-Heart Imp", "Shadow-Heart Gecko"].map(name => simulationCard(cardDefinition(name))),
      deck: [simulationCard(cardDefinition("Shadow-Heart Demon Arctroth"))],
    },
  });
  const before = structuredClone(input);
  const { result, next } = predict(input, input.bot, {
    type: "summon", index: 0, cardName: "Shadow-Heart Imp",
  }, "shadowheart");

  assert.deepEqual(next.player?.field?.map(card => card.name), ["Shadow-Heart Imp", "Shadow-Heart Gecko"]);
  assert.deepEqual(next.player?.hand?.map(card => card.name), ["Shadow-Heart Demon Arctroth"]);
  assert.equal(next.player?.deck?.length, 0);
  assert.equal(next.player?.summonCount, 1);
  assert.equal(record(required(next.player?.field?.[1])).lastSummonMethod, "special");
  const ledger = record(record(next)._simOncePerTurn).bot;
  assert.ok(ledger instanceof Map);
  assert.equal(ledger.get("shadow_heart_imp_on_summon"), 1);
  assert.equal(ledger.get("shadow_heart_gecko_special_search"), 1);
  assert.equal(result.score, 5.5 * 0.85 ** 3 * 0.85 ** 2);
  assert.deepEqual(input, before);
});

test("GameTree follows registered Arcanist Apprentice search and preserves its actor usage flag", () => {
  const input = simulationState({
    turn: "bot", phase: "main1", turnCounter: 2,
    bot: {
      hand: [simulationCard(cardDefinition("Arcanist Apprentice"))],
      deck: [simulationCard(cardDefinition("Grimoire of the Apprentice Arcanist"))],
    },
  });
  const before = structuredClone(input);
  const { result, next } = predict(input, input.bot, {
    type: "summon", index: 0, cardName: "Arcanist Apprentice",
  }, "arcanist");

  assert.deepEqual(next.player?.field?.map(card => card.name), ["Arcanist Apprentice"]);
  assert.deepEqual(next.player?.hand?.map(card => card.name), ["Grimoire of the Apprentice Arcanist"]);
  assert.equal(next.player?.deck?.length, 0);
  assert.equal(next.player?.summonCount, 1);
  const actors = record(record(next)._gameTreeActors);
  assert.equal(record(actors.bot)._simArcanistApprenticeSearchUsed, true);
  assert.equal(record(next)._simArcanistApprenticeSearchUsed, undefined);
  assert.equal(result.score, 3.5 * 0.85 ** 3 * 0.85 ** 2);
  assert.deepEqual(input, before);
});

for (const fromOpponent of [false, true]) {
  test(`GameTree Monster Reborn prediction matches runtime revival from ${fromOpponent ? "opponent" : "own"} GY`, async (t) => {
    const game = createRuntimeGame({
      captureReplay: false, laboratoryMode: true, randomSeed: "gametree-fidelity-reborn",
    });
    t.after(() => game.dispose("gametree_fidelity_complete"));
    game.turn = "player";
    game.phase = "main1";
    game.turnCounter = 2;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    game.waitForPresentationDelay = async () => {};
    game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = "human";
    game.bot.controllerType = "human";

    const spell = new Card(cardDefinition("Monster Reborn"), "player");
    const graveOwner = fromOpponent ? game.bot : game.player;
    const target = new Card(cardDefinition("Arcane Scholar"), graveOwner.id);
    game.player.hand.push(spell);
    graveOwner.graveyard.push(target);
    const action: AIAction = { type: "spell", index: 0, cardName: "Monster Reborn" };
    const { result, next } = predict(game, game.player, action, "bloomrot");
    const predictedActor = required(next.player);
    const predictedOpponent = required(next.bot);
    assert.equal(result.score, 3.3 * 0.85 ** 3 * 0.85 ** 2);
    assert.equal(game.player.hand[0], spell);
    assert.equal(graveOwner.graveyard[0], target);
    assert.equal(game.player.field.length, 0);

    game.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
    const chosen = required(result.action);
    assert.equal(chosen.type, "spell");
    assert.equal(chosen.cardName, spell.name);
    const resolution = await game.tryActivateSpell(spell, required(chosen.index), { reborn_target: [target] }, { owner: game.player });
    assert.equal(resolution.success, true);

    for (const [predicted, runtime] of [[predictedActor, game.player], [predictedOpponent, game.bot]] as const) {
      for (const zone of ["hand", "field", "graveyard", "deck", "banished", "extraDeck"] as const) {
        assert.deepEqual(predicted[zone]?.map(card => card.name), runtime[zone].map(card => card.name), zone);
      }
      assert.equal(predicted.lp, runtime.lp);
    }
    const predictedTarget = required(predictedActor.field?.[0]);
    assert.equal(record(predictedTarget).controller, target.controller);
    assert.equal(record(predictedTarget).originalOwner, target.originalOwner);
    assert.equal(predictedTarget.position, target.position);
    assert.equal(predictedTarget.isFacedown, target.isFacedown);
  });
}
