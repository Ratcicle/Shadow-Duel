import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { getStrategyFor } from "../../src/core/ai/StrategyRegistry.js";
import { cloneBotGameState } from "../../src/core/bot/simulationBridge.js";
import { getCounterValue } from "../../src/core/ai/common/counters.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

// Runtime is the oracle. Valid boards include a Token and face-down allies;
// the simulated scratch context must report the same actual addition and heal.
for (const seat of ["player", "bot"] as const) {
  test(`Compost Ritual runtime/simulation oracle across legal allied counts (${seat})`, async t => {
    for (let count = 0; count <= 5; count++) {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false,
        randomSeed: 411, chainResponseTimeoutMs: 0 });
      t.after(() => game.dispose());
      game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
      game.disablePresentationDelays = true;
      game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
      const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
      owner.controllerType = "ai"; opponent.controllerType = "ai";
      const strategy = getStrategyFor("bloomrot", owner);
      const actor = Object.assign(owner, { strategy, resolveOpponent: () => opponent });
      for (let index = 0; index < count; index++) {
        const ally = index === 0
          ? new Card({ name: "Bloomrot Token", cardKind: "monster", archetype: "Bloomrot",
            atk: 0, def: 0, level: 1, type: "Plant", effects: [] }, owner.id)
          : new Card({ ...cardDefinition(402), effects: [] }, owner.id);
        ally.isToken = index === 0;
        ally.isFacedown = index % 2 === 1;
        placeFieldCards(owner.field, ally);
      }
      const target = new Card({ ...cardDefinition(1), effects: [] }, opponent.id);
      placeFieldCards(opponent.field, target);
      const spell = new Card(cardDefinition(411), owner.id); owner.hand.push(spell);
      const clone = cloneBotGameState(actor, { player: game.player, bot: game.bot,
        turn: game.turn, phase: game.phase, turnCounter: game.turnCounter });
      strategy.simulateMainPhaseAction(clone, { type: "spell", index: 0, cardName: spell.name });
      const result = await game.tryActivateSpell(spell, 0, { bloomrot_compost_ritual_target: [target] }, { owner });
      assert.equal(result.success, true);
      const projected = required(clone.player.field[0]);
      assert.equal(getCounterValue(projected, "spore"), target.getCounter("spore"));
      assert.equal(clone.bot.lp, owner.lp);
      assert.deepEqual(clone._simUnsupportedActions || [], []);
      assert.equal(owner.lp - 8000, target.getCounter("spore") * 300);
      assert.equal(opponent.lp, 8000);
    }
  });
}
