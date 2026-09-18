import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";

function createGame(t: TestContext) {
  const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
  game.turn = "player";
  game.phase = "main1";
  game.turnCounter = 2;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = "human";
  game.bot.controllerType = "human";
  t.after(() => game.dispose("monster_reborn_test_complete"));
  return game;
}

for (const actorId of ["player", "bot"] as const) {
  for (const fromOpponent of [false, true]) {
    test(`Monster Reborn: ${actorId} revives from ${fromOpponent ? "opponent" : "own"} GY with a manual position choice`, async (t) => {
      const game = createGame(t);
      const actor = game[actorId];
      const other = actorId === "player" ? game.bot : game.player;
      const graveOwner = fromOpponent ? other : actor;
      game.turn = actorId;
      const spell = new Card(cardDefinition("Monster Reborn"), actorId);
      const target = new Card(cardDefinition("Arcane Scholar"), graveOwner.id);
      actor.hand.push(spell);
      graveOwner.graveyard.push(target);
      const selectedPosition = fromOpponent ? "defense" : "attack";
      const prompts: string[] = [];
      const summons: string[] = [];
      game.on("after_summon", (event) => {
        if (event.card === target) summons.push(event.method);
      });
      game.ui.showTargetSelection = (contract, confirm) => {
        const requirement = required(required(required(contract).requirements)[0]);
        const candidate = required(requirement.candidates.find((entry) => entry.cardRef === target));
        const onConfirm = required(confirm);
        setImmediate(() => onConfirm({ [requirement.id]: [candidate.key] }));
        return { close() {} };
      };
      game.ui.showSpecialSummonPositionModal = (card, choose) => {
        prompts.push(required(required(card).name));
        choose(selectedPosition);
      };

      const result = await game.tryActivateSpell(spell, 0, null, { owner: actor });

      assert.equal(result.success, true);
      assert.deepEqual(prompts, [target.name]);
      assert.deepEqual(summons, ["special"]);
      assert.equal(graveOwner.graveyard.includes(target), false);
      assert.equal(actor.field.includes(target), true);
      assert.equal(other.field.includes(target), false);
      assert.equal(target.controller, actorId);
      assert.equal(target.originalOwner, graveOwner.id);
      assert.equal(target.position, selectedPosition);
      assert.equal(target.isFacedown, false);
      assert.equal(target.lastSummonedFromZone, "graveyard");
      assert.equal(actor.graveyard.includes(spell), true);
      assert.equal(actor.hand.length, 0, "Arcane Scholar must not draw on Special Summon");
    });
  }
}

test("Monster Reborn rejects activation with a full field or only forbidden targets", (t) => {
  const game = createGame(t);
  const spell = new Card(cardDefinition("Monster Reborn"), game.player.id);
  const target = new Card(cardDefinition("Nightmare Steed"), game.bot.id);
  game.player.hand.push(spell);
  game.bot.graveyard.push(target);
  for (let i = 0; i < 5; i++) game.player.field.push(new Card(cardDefinition("Nightmare Steed"), game.player.id));
  assert.equal(game.effectEngine.canActivateSpellFromHandPreview(spell, game.player).ok, false);
  game.player.field = [];
  target.cannotBeSpecialSummoned = true;
  game.effectEngine.clearTargetingCache();
  assert.equal(game.effectEngine.canActivateSpellFromHandPreview(spell, game.player).ok, false);
});

test("Monster Reborn does not replace a declared target that leaves the GY", async (t) => {
  const game = createGame(t);
  const spell = new Card(cardDefinition("Monster Reborn"), game.player.id);
  const target = new Card(cardDefinition("Nightmare Steed"), game.bot.id);
  const replacement = new Card(cardDefinition("Arcane Scholar"), game.bot.id);
  game.player.hand.push(spell);
  game.bot.graveyard.push(target, replacement);
  game.chainSystem.offerChainResponses = async () => {
    await game.moveCard(target, game.bot, "hand", { fromZone: "graveyard" });
    return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
  };
  await game.tryActivateSpell(spell, 0, { reborn_target: [target] });
  assert.equal(game.bot.hand.includes(target), true);
  assert.equal(game.bot.graveyard.includes(replacement), true);
  assert.equal(game.player.field.length, 0);
  assert.equal(game.player.graveyard.includes(spell), true);
});

test("Monster Reborn simulation removes the target from the opponent's GY and changes its controller", () => {
  const definition = cardDefinition("Monster Reborn");
  const effect = required(required(definition.effects)[0]);
  const source = simulationCard({ ...definition, owner: "player", originalOwner: "player" });
  const target = simulationCard({
    ...cardDefinition("Nightmare Steed"),
    owner: "bot",
    originalOwner: "bot",
    controller: "bot",
  });
  const state = simulationState({ bot: { graveyard: [target] } });
  applySimulatedActions({
    actions: required(effect.actions),
    selections: { reborn_target: [target] },
    state,
    selfId: "player",
    options: { sourceCard: source },
  });
  assert.deepEqual(state.bot.graveyard, []);
  assert.deepEqual(state.player.field, [target]);
  assert.equal(target.controller, "player");
  assert.equal(target.originalOwner, "bot");
});
