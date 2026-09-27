import assert from "node:assert/strict";
import test from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

const EFFECT_ID = "tech_zero_glider_wyvern_special_summon";

for (const actor of ["player", "bot"] as const) {
  test(`Wyvern resolves its first hand activation and shares its turn limit between copies (${actor})`, async (t) => {
    const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true });
    t.after(() => game.dispose("tech_zero_wyvern_test_complete"));
    const player = game[actor];
    player.controllerType = actor === "player" ? "human" : "ai";
    game.turn = player.id;
    game.turnCounter = 2;
    game.phase = "main1";
    game.disablePresentationDelays = true;
    game.effectEngine.chooseSpecialSummonPosition = async () => "attack";

    const tuner = new Card(cardDefinition("Tech-Zero Energy Core"), player.id);
    const first = new Card(cardDefinition("Tech-Zero Glider Wyvern"), player.id);
    const second = new Card(cardDefinition("Tech-Zero Glider Wyvern"), player.id);
    placeFieldCards(player.field, tuner);
    player.hand.push(first, second);

    const activate = (card: Card) => game.tryActivateMonsterEffect(
      card, null, "hand", player, { effectId: EFFECT_ID },
    );

    const firstResult = await activate(first);
    assert.equal(firstResult.success, true, "the first activation must resolve its own summon");
    assert.equal(player.hand.includes(first), false);
    assert.equal(player.field.includes(first), true);

    const repeatedResult = await activate(second);
    assert.equal(repeatedResult.success, false, "another copy must share the spent turn limit");
    assert.equal(player.hand.includes(second), true);
    assert.equal(player.field.includes(second), false);

    // Advance the fixture to this actor's next turn without scheduling an AI turn.
    game.turnCounter += 2;
    const nextTurnResult = await activate(second);
    assert.equal(nextTurnResult.success, true);
    assert.equal(player.hand.includes(second), false);
    assert.equal(player.field.includes(second), true);
  });
}
