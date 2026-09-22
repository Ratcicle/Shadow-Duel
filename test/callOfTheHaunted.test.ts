import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";

async function setup(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
  Object.assign(game, { turn: "player", turnCounter: 2, phase: "main1", disablePresentationDelays: true });
  game.player.controllerType = game.bot.controllerType = "human";
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.ui.showChainResponseModal = async () => null;
  game.ui.showTrapActivationModal = async () => true;
  const trap = new Card(cardDefinition("Call of the Haunted"), "player");
  Object.assign(trap, { isFacedown: true, setTurn: 1, turnSetOn: 1 });
  const monster = new Card(cardDefinition("Nightmare Steed"), "player");
  game.player.spellTrap.push(trap);
  game.player.graveyard.push(monster);
  t.after(() => game.dispose());
  assert.equal((await game.tryActivateSpellTrapEffect(trap, { haunted_target: [monster] }, { owner: game.player })).success, true);
  return { game, trap, monster };
}

for (const departing of ["monster", "trap"] as const) {
  for (const negated of [false, true]) {
    test(`Call of the Haunted: ${departing} leaves, negated=${negated}`, async (t) => {
      const { game, trap, monster } = await setup(t);
      if (negated) {
        const source = new Card(cardDefinition("Orathus, The Fallen Angel"), "bot");
        game.bot.field.push(source);
        const effect = required(source.effects.find((entry) => entry.id === "orathus_synchro_summon_negate"));
        await game.effectEngine.applyActions(required(effect.actions), { source, player: game.bot, opponent: game.player, effect },
          { orathus_negate_target: [trap] });
        assert.equal(trap.effectsNegated, true);
      }
      const target = departing === "monster" ? trap : monster;
      await game.moveCard(departing === "monster" ? monster : trap, game.player, "hand",
        { fromZone: departing === "monster" ? "field" : "spellTrap" });
      assert.equal(game.player.graveyard.includes(target), !negated);
      assert.equal(trap.boundMonsterTarget, null);
      assert.equal(monster.boundTrapSource, null);
      trap.effectsNegated = false;
      assert.equal(game.player.graveyard.includes(target), !negated);
    });
  }
}

test("Call of the Haunted keeps its binding across control changes and clears it when destruction is prevented", async (t) => {
  const { game, trap, monster } = await setup(t);
  await game.takeControl(monster, game.bot, { sourceCard: trap });
  assert.equal(monster.boundTrapSource, trap);
  assert.equal(trap.boundMonsterTarget, monster);
  monster.unaffectedByOtherCardEffects = true;
  await game.moveCard(trap, game.player, "graveyard", { fromZone: "spellTrap" });
  assert.ok(game.bot.field.includes(monster));
  assert.equal(monster.boundTrapSource, null);
  assert.equal(trap.boundMonsterTarget, null);
});

test("Call of the Haunted awaits linked destruction after the original movement and attributes it to the trap", async (t) => {
  const { game, trap, monster } = await setup(t);
  const events: string[] = [];
  game.on("card_moved", ({ card }) => { events.push(required(card.name)); });
  const originalDestroy = game.destroyCard.bind(game);
  game.destroyCard = async (card, options) => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(options?.sourceCard, trap);
    assert.deepEqual(events, [monster.name]);
    return originalDestroy(card, options);
  };
  await game.moveCard(monster, game.player, "hand", { fromZone: "field", awaitCardMovedEvent: true });
  assert.deepEqual(events, [monster.name, trap.name]);
  assert.ok(game.player.graveyard.includes(trap));
});

test("Call of the Haunted rechecks a surviving trap's negation after the movement events", async (t) => {
  const { game, trap, monster } = await setup(t);
  game.on("card_moved", ({ card }) => {
    if (card === monster) trap.effectsNegated = true;
  });
  await game.moveCard(monster, game.player, "hand", { fromZone: "field", awaitCardMovedEvent: true });
  assert.ok(game.player.spellTrap.includes(trap));
  assert.equal(trap.boundMonsterTarget, null);
  assert.equal(monster.boundTrapSource, null);
});
