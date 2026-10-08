import assert from "node:assert/strict";
import test from "node:test";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import type { ActionOf } from "../../src/core/contracts/actions.js";
import { required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

for (const actor of ["bot", "player"] as const) {
  for (const variant of ["ordinary", "other_type", "protected", "redirected", "token", "none", "missing_type", "zero_reward", "signed_reward"] as const) {
    test(`declarative type destruction rewards only actual destruction (${actor}/${variant})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
      t.after(() => game.dispose("architecture_destroy_type_buff"));
      game.turn = actor; game.phase = "main1"; game.turnCounter = 4;
      game.disablePresentationDelays = true;
      game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
      const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
      const source = required(game.createCardForOwner(258, owner));
      const first = required(game.createCardForOwner(254, owner));
      const second = required(game.createCardForOwner(256, owner));
      const unrelated = required(game.createCardForOwner(302, owner));
      const opposing = required(game.createCardForOwner(256, opponent));
      source.name = "Renamed source";
      if (variant === "signed_reward") source.atk = 100;
      for (const card of [source, first, second, unrelated, opposing]) card.effects = [];
      const type = variant === "other_type" ? "Spellcaster" : "Dragon";
      first.type = variant === "none" ? "Warrior" : type;
      second.type = "Warrior";
      second.types = variant === "none" ? ["Warrior"] : ["Warrior", type];
      unrelated.type = "Machine";
      first.isFacedown = true;
      if (variant === "redirected") second.banishWhenLeavesField = true;
      if (variant === "token") first.isToken = true;
      placeFieldCards(owner.field, source, first, second, unrelated);
      first.isFacedown = true;
      placeFieldCards(opponent.field, opposing);
      if (variant === "protected") await game.effectEngine.applyActions([
        { type: "grant_protection", targetRef: "protected", protectionType: "effect_destruction", duration: "end_of_next_turn" },
      ], { source: second, player: owner, opponent }, { protected: [second] });
      const action: ActionOf<"destroy_other_dragons_and_buff"> = {
        type: "destroy_other_dragons_and_buff", ...(variant === "missing_type" ? {} : { typeName: type }),
        ...(variant === "other_type" ? {} : { atkPerDestroyed: variant === "zero_reward" ? 0 : variant === "signed_reward" ? -300 : 300 }),
      };
      const { state } = createGameTreeCopy(game, owner);
      const simulatedSource = required(state.bot.field[0]);
      const liveEvents: object[] = [], simulatedEvents: object[] = [];
      const fact = (event: string, payload: object, atk: number | undefined) => {
        const card: unknown = Reflect.get(payload, "card");
        assert.ok(card && typeof card === "object");
        return { event, cardId: Reflect.get(card, "id") as unknown,
          from: Reflect.get(payload, "fromZone") as unknown, to: Reflect.get(payload, "toZone") as unknown,
          wasDestroyed: Reflect.get(payload, "wasDestroyed") as unknown, sourceAtk: atk };
      };
      for (const event of ["card_to_grave", "card_moved"] as const) game.on(event, payload => {
        if (payload.card === first || payload.card === second) liveEvents.push(fact(event, payload, source.atk));
      });
      const live = await game.effectEngine.applyActions([action], { source, player: owner, opponent }, {});
      const simulated = applySimulatedActions({ state, actions: [action], selfId: "bot", options: {
        sourceCard: simulatedSource, emitSimulatedEvent: (event, payload) => {
          if (event === "card_to_grave" || event === "card_moved") simulatedEvents.push(fact(event, payload, simulatedSource.atk));
        },
      } });
      const expectedSuccess = variant !== "none" && variant !== "missing_type";
      assert.equal(typeof live === "object" && live !== null ? live.success : live, expectedSuccess);
      assert.equal(simulated, expectedSuccess);
      assert.deepEqual(simulatedEvents, liveEvents, "each departure is emitted before the reward is applied");
      for (const zone of ["field", "graveyard", "banished"] as const) {
        assert.deepEqual(state.bot[zone].map(card => card.instanceId), owner[zone].map(card => card.instanceId));
        assert.deepEqual(state.player[zone].map(card => card.instanceId), opponent[zone].map(card => card.instanceId));
      }
      assert.equal(simulatedSource.atk, source.atk);
      assert.deepEqual(simulatedSource.permanentBuffsBySource || {}, source.permanentBuffsBySource || {});
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }
}
