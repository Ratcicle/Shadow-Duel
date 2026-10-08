import assert from "node:assert/strict";
import test from "node:test";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { cleanupSimulatedEndTurn } from "../../src/core/ai/common/simulatedActions/lifecycle.js";
import type { ActionOf } from "../../src/core/contracts/actions.js";
import { required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

for (const actor of ["bot", "player"] as const) {
  for (const variant of ["tech_void", "def_permanent", "level_default", "multi", "zero", "missing", "missing_recipient", "token"] as const) {
    test(`declarative banish-and-buff follows runtime movement, amount and duration (${actor}/${variant})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
      t.after(() => game.dispose("architecture_banish_buff"));
      game.turn = actor; game.phase = "main1"; game.turnCounter = 4;
      game.disablePresentationDelays = true;
      game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
      const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
      const source = required(game.createCardForOwner(265, owner));
      source.name = "Renamed source retains its declared action";
      const first = required(game.createCardForOwner(256, owner));
      const second = required(game.createCardForOwner(252, opponent));
      source.effects = []; first.effects = []; second.effects = [];
      first.atk = variant === "zero" ? 0 : 1501;
      first.def = 903;
      placeFieldCards(owner.field, source);
      if (variant === "token") { first.isToken = true; placeFieldCards(owner.field, first); }
      else owner.graveyard.push(first);
      if (variant === "multi") opponent.graveyard.push(second);
      const action: ActionOf<"banish_and_buff"> = {
        type: "banish_and_buff", targetRef: "chosen", buffSource: "atk", buffMultiplier: 0.5,
        buffType: "atk", duration: "end_of_turn",
        ...(variant === "def_permanent" ? { buffSource: "def", buffType: "def", duration: "permanent" } : {}),
        ...(variant === "level_default" ? { buffSource: "level", buffType: "both" } : {}),
        ...(variant === "missing_recipient" ? { buffTarget: "absent_recipient" } : {}),
      };
      // The default duration is while_faceup, regardless of the old handler comment.
      const effectiveAction = variant === "level_default"
        ? (({ duration: _duration, ...rest }) => rest)(action) : action;
      const { state } = createGameTreeCopy(game, owner);
      const simulatedSource = required(state.bot.field[0]);
      const simulatedFirst = required(variant === "token" ? state.bot.field[1] : state.bot.graveyard[0]);
      const simulatedSecond = variant === "multi" ? required(state.player.graveyard[0]) : undefined;
      const chosen = variant === "missing" ? [first, second] : variant === "multi" ? [first, second] : [first];
      const simulatedChosen = variant === "missing" ? [simulatedFirst, { ...second, counters: new Map<string, number>() }]
        : simulatedSecond ? [simulatedFirst, simulatedSecond] : [simulatedFirst];
      const liveMoves: object[] = [];
      const simulatedMoves: object[] = [];
      const fact = (payload: object) => {
        const card: unknown = Reflect.get(payload, "card");
        assert.ok(card && typeof card === "object");
        return { cardId: Reflect.get(card, "id") as unknown, fromZone: Reflect.get(payload, "fromZone") as unknown,
          toZone: Reflect.get(payload, "toZone") as unknown, label: Reflect.get(payload, "contextLabel") as unknown,
          movedByEffect: Reflect.get(payload, "movedByEffect") as unknown };
      };
      game.on("card_moved", payload => {
        if (payload.card !== first && payload.card !== second) return;
        liveMoves.push(fact(payload));
        // Values of all chosen cards are captured before the first movement.
        if (variant === "multi" && payload.card === first) second.atk += 2000;
      });
      const live = await game.effectEngine.applyActions([effectiveAction], { source, player: owner, opponent }, { chosen });
      const simulated = applySimulatedActions({ state, actions: [effectiveAction], selfId: "bot", selections: { chosen: simulatedChosen },
        options: { sourceCard: simulatedSource, emitSimulatedEvent: (event, payload) => {
          if (event !== "card_moved") return;
          const card: unknown = Reflect.get(payload, "card");
          simulatedMoves.push(fact(payload));
          if (variant === "multi" && card === simulatedFirst && simulatedSecond) simulatedSecond.atk = (simulatedSecond.atk || 0) + 2000;
        } } });
      if (variant === "missing") {
        assert.equal(typeof live === "object" && live !== null ? live.success : live, false);
        assert.equal(simulated, false);
        assert.equal(owner.graveyard.includes(first), true);
      } else assert.notEqual(live, false);
      assert.deepEqual(simulatedMoves, liveMoves);
      assert.deepEqual([simulatedSource.atk, simulatedSource.def, simulatedSource.tempAtkBoost || 0, simulatedSource.tempDefBoost || 0],
        [source.atk, source.def, source.tempAtkBoost || 0, source.tempDefBoost || 0]);
      assert.deepEqual(state.bot.banished.map(card => card.id), owner.banished.map(card => card.id));
      assert.deepEqual(state.player.banished.map(card => card.id), opponent.banished.map(card => card.id));
      assert.deepEqual(simulatedSource.permanentBuffsBySource || {}, source.permanentBuffsBySource || {});
      assert.deepEqual(state._simUnsupportedActions || [], []);
      game.cleanupTempBoosts(owner); cleanupSimulatedEndTurn(state);
      assert.deepEqual([simulatedSource.atk, simulatedSource.def], [source.atk, source.def]);
    });
  }
}
