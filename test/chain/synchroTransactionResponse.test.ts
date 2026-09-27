import assert from "node:assert/strict";
import test from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import { cardDefinition, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

for (const seat of ["player", "bot"] as const) {
  test(`Synchro material triggers offer responses after the summon transaction completes (${seat})`, async t => {
    const first = new Bot("techzero"); first.id = "player";
    const second = new Bot("techzero");
    const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true });
    game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot supplies the Player runtime in either physical seat");
    t.after(() => game.dispose("synchro_transaction_response"));
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    const player = seat === "player" ? first : second;
    const make = (id: number) => new Card(cardDefinition(id), player.id);
    const core = make(501), wyvern = make(504), ghost = make(511), machine = make(503);
    const slasher = make(510), singularity = make(517), scrapyard = make(520);
    wyvern.level = 3;
    machine.properSummonEstablished = true; machine.properSummonProcedure = "synchro";
    scrapyard.isFacedown = true; scrapyard.setTurn = 2;
    placeFieldCards(player.field, ghost, core, wyvern);
    placeFieldCards(player.spellTrap, scrapyard);
    player.graveyard.push(machine); player.extraDeck.push(slasher, singularity);
    player.deck.push(make(518), make(519), make(518));
    const activeSummonsAtResponse: Array<number | null> = [];
    const outcomes: string[] = [];
    const sequence: string[] = [];
    const concurrentAttempts: unknown[] = [];
    game.on("card_to_grave", payload => {
      if ([core, wyvern, machine, ghost, slasher].some(card => card === payload.card)) sequence.push(`grave:${payload.card.id}`);
    });
    game.on("after_summon", payload => {
      sequence.push(`summon:${payload.card.id}`);
      if (payload.card === slasher) {
        concurrentAttempts.push(game.beginSummonTransaction(game.createPreparedSummon({
          card: singularity, controller: player, sourceZone: "extraDeck",
          summonOrigin: "effect_resolution", summonMethod: "synchro", summonProcedure: "synchro",
        })));
      }
    });
    game.on("summon_transaction", payload => {
      if (payload?.status === "succeeded" && payload.card) sequence.push(`complete:${Reflect.get(payload.card, "cardId")}`);
    });
    game.on("chain_link_resolution", payload => {
      if (payload.effectId !== "tech_zero_scrapyard_activation") return;
      if (payload.stage === "resolving") {
        sequence.push("response:520");
        activeSummonsAtResponse.push(game.activeSummonTransaction?.card?.id ?? null);
      }
      if (payload.outcome) outcomes.push(payload.outcome);
    });

    const result = await game.performSynchroSummon(player, [core, wyvern], slasher);

    assert.equal(result.success, true);
    assert.deepEqual(activeSummonsAtResponse, [null], "the completed Slasher summon must release its transaction before a response can Synchro Summon");
    assert.deepEqual(outcomes, ["success"]);
    assert.deepEqual(concurrentAttempts, [{ ok: false, reason: "summon_transaction_busy" }]);
    assert.deepEqual(sequence, [
      "grave:501", "grave:504", "summon:510", "complete:510", "response:520",
      "summon:503", "complete:503", "grave:503", "grave:511", "grave:510", "summon:517", "complete:517",
    ]);
    assert.deepEqual(player.field.map(card => card.id), [517]);
    assert.equal(game.activeSummonTransaction, null);
    assert.equal(game.summonProcedureDepth, 0);
  });
}
