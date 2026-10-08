import assert from "node:assert/strict";
import test from "node:test";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { processSimulatedDelayedActions } from "../../src/core/ai/common/simulatedActions/lifecycle.js";
import { required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function movementFact(payload: object) {
  const card: unknown = Reflect.get(payload, "card");
  assert.ok(card && typeof card === "object");
  const cardId: unknown = Reflect.get(card, "id");
  const fromZone: unknown = Reflect.get(payload, "fromZone");
  const toZone: unknown = Reflect.get(payload, "toZone");
  const movedByEffect: unknown = Reflect.get(payload, "movedByEffect");
  const source: unknown = Reflect.get(payload, "sourceCard");
  const sourceId: unknown = source && typeof source === "object" ? Reflect.get(source, "id") : null;
  const effectId: unknown = Reflect.get(payload, "effectId");
  const contextLabel: unknown = Reflect.get(payload, "contextLabel");
  return { cardId, fromZone, toZone, movedByEffect, sourceId, effectId: effectId ?? null, contextLabel: contextLabel ?? null };
}

for (const actor of ["bot", "player"] as const) {
  test(`shared delayed return preserves the runtime movement provenance (${actor})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
    t.after(() => game.dispose("architecture_delayed_return_event"));
    game.turn = actor; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    game.waitForPresentationDelay = async () => {};
    game.waitForAiPresentationStep = async () => {};
    game.bot.controllerType = game.player.controllerType = "ai";
    const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
    const source = required(game.createCardForOwner(263, owner));
    owner.graveyard.push(source);
    const { state } = createGameTreeCopy(game, owner);
    const projectedSource = required(state.bot.graveyard[0]);
    const action = { type: "schedule_special_summon", fromZone: "graveyard", phase: "standby", triggerPlayer: "opponent" } as const;
    const liveMoves: ReturnType<typeof movementFact>[] = [];
    game.on("card_moved", payload => {
      if (payload.card === source) liveMoves.push(movementFact(payload));
    });
    await game.effectEngine.applyActions([action], { source, player: owner, opponent }, {});
    applySimulatedActions({ state, actions: [action], selfId: "bot", options: { sourceCard: projectedSource } });
    assert.equal(game.delayedActions.length, 1);
    assert.equal(state.delayedActions?.length, 1);
    game.turn = state.turn = opponent.id;
    game.turnCounter = state.turnCounter = 5;
    game.phase = state.phase = "standby";
    await game.processDelayedActions("standby", opponent.id);
    assert.equal(owner.field.includes(source), true);
    assert.equal(liveMoves.length, 1);
    assert.equal(required(liveMoves[0]).movedByEffect, false);
    const simulatedMoves: ReturnType<typeof movementFact>[] = [];
    processSimulatedDelayedActions(state, "standby", opponent.id, {
      emitSimulatedEvent: (event, payload) => {
        if (event === "card_moved") simulatedMoves.push(movementFact(payload));
      },
    });
    assert.equal(state.bot.field.includes(projectedSource), true);
    assert.deepEqual(simulatedMoves, liveMoves);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  for (const variant of ["ordinary", "borrowed", "token"] as const) {
    const borrowedTarget = variant === "borrowed";
    test(`Abyssal shared scheduling preserves runtime movement order, provenance and actual owner (${actor}/${variant})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
      t.after(() => game.dispose("architecture_dragon_delayed_events"));
      game.turn = actor; game.phase = "main1"; game.turnCounter = 4;
      game.disablePresentationDelays = true;
      game.waitForBoardPresentation = async () => {};
      game.waitForPresentationDelay = async () => {};
      game.waitForAiPresentationStep = async () => {};
      const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
      const source = required(game.createCardForOwner(263, owner));
      const target = required(game.createCardForOwner(302, borrowedTarget ? owner : opponent));
      placeFieldCards(owner.field, source);
      placeFieldCards(opponent.field, target);
      target.controller = opponent.id;
      target.isToken = variant === "token";
      const effect = required(source.effects.find(entry => entry.id === "abyssal_serpent_delayed_summon_effect"));
      const { state } = createGameTreeCopy(game, owner);
      const projectedSource = required(state.bot.field[0]);
      const projectedTarget = required(state.player.field[0]);
      const liveMoves: ReturnType<typeof movementFact>[] = [];
      game.on("card_moved", payload => {
        if (payload.card === source || payload.card === target) liveMoves.push(movementFact(payload));
      });
      await game.effectEngine.applyActions(effect.actions || [], { source, player: owner, opponent, effect }, { abyssal_target: [target] });
      assert.deepEqual(liveMoves.map(entry => entry.cardId), [263, 302]);
      // The existing runtime action calls moveCard without an effect source;
      // migration must preserve its actual event facts, not infer new rules.
      assert.equal(liveMoves.every(entry => entry.movedByEffect === false && entry.sourceId === null && entry.effectId === null), true);
      assert.equal((borrowedTarget ? owner : opponent).graveyard.includes(target), variant !== "token");
      assert.equal(required(liveMoves[1]).contextLabel, variant === "token" ? "token_removed" : null);

      const simulatedMoves: ReturnType<typeof movementFact>[] = [];
      applySimulatedActions({ state, actions: effect.actions, selfId: "bot",
        selections: { abyssal_target: [projectedTarget] }, options: { sourceCard: projectedSource, effect,
          emitSimulatedEvent: (event, payload) => {
            if (event === "card_moved") simulatedMoves.push(movementFact(payload));
          },
        } });
      assert.deepEqual(simulatedMoves, liveMoves);
      assert.equal((borrowedTarget ? state.bot : state.player).graveyard.includes(projectedTarget), variant !== "token");
      const scheduled = required(state.delayedActions?.[0]);
      assert.equal(scheduled.actionType, "delayed_summon");
      if (scheduled.actionType !== "delayed_summon") assert.fail("expected delayed summon");
      assert.deepEqual(scheduled.payload.summons.map(entry => [entry.card.id, entry.owner, entry.placementActorId]),
        variant === "token" ? [[263, owner.id, owner.id]] : [[263, owner.id, owner.id], [302, borrowedTarget ? owner.id : opponent.id, owner.id]]);
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }

  test(`shared token removal retains an explicit movement context (${actor})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
    t.after(() => game.dispose("architecture_token_context"));
    game.turn = actor; game.phase = "main1";
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    game.waitForPresentationDelay = async () => {};
    const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
    const token = required(game.createCardForOwner(257, owner));
    token.isToken = true;
    placeFieldCards(owner.field, token);
    const { state } = createGameTreeCopy(game, owner);
    const projectedToken = required(state.bot.field[0]);
    const action = { type: "move", to: "graveyard", targetRef: "selected", contextLabel: "explicit_context" } as const;
    const liveMoves: ReturnType<typeof movementFact>[] = [];
    game.on("card_moved", payload => { if (payload.card === token) liveMoves.push(movementFact(payload)); });
    await game.effectEngine.applyActions([action], { source: token, player: owner, opponent }, { selected: [token] });
    assert.equal(required(liveMoves[0]).contextLabel, "explicit_context");
    const simulatedMoves: ReturnType<typeof movementFact>[] = [];
    applySimulatedActions({ state, actions: [action], selfId: "bot", selections: { selected: [projectedToken] },
      options: { sourceCard: projectedToken, emitSimulatedEvent: (event, payload) => {
        if (event === "card_moved") simulatedMoves.push(movementFact(payload));
      } } });
    assert.deepEqual(simulatedMoves, liveMoves);
    assert.equal(state.bot.graveyard.length, 0);
  });
}
