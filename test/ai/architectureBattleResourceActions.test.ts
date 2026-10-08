import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { attachSimulatedEventEmitter } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import type { CardAction } from "../../src/core/contracts/actions.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

const healCases: ReadonlyArray<{ name: string; action: CardAction; level?: number; missing?: boolean; multiplier?: boolean }> = [
  { name: "current ATK default", action: { type: "heal_from_destroyed_atk" } },
  { name: "printed ATK fractional rounding", action: { type: "heal_from_destroyed_atk", useBaseAtk: true, fraction: 0.5 } },
  { name: "fraction takes precedence over multiplier", action: { type: "heal_from_destroyed_atk", fraction: 0.25, multiplier: 2 } },
  { name: "ATK multiplier alias", action: { type: "heal_from_destroyed_atk", multiplier: 0.5 } },
  { name: "zero ATK fraction returns false", action: { type: "heal_from_destroyed_atk", fraction: 0, multiplier: 2 } },
  { name: "zero ATK multiplier returns false", action: { type: "heal_from_destroyed_atk", multiplier: 0 } },
  { name: "negative ATK fraction returns false", action: { type: "heal_from_destroyed_atk", fraction: -0.5 } },
  { name: "missing ATK context returns false", action: { type: "heal_from_destroyed_atk" }, missing: true },
  { name: "level default", action: { type: "heal_from_destroyed_level" } },
  { name: "level multiplier zero retains runtime default", action: { type: "heal_from_destroyed_level", multiplier: 0 } },
  { name: "level fractional multiplier floors", action: { type: "heal_from_destroyed_level", multiplier: 100.25 } },
  { name: "level zero continues without healing", action: { type: "heal_from_destroyed_level" }, level: 0 },
  { name: "legacy opponent recipient still heals activating owner", action: { type: "heal_from_destroyed_level", player: "opponent" } },
  { name: "missing level context returns false", action: { type: "heal_from_destroyed_level" }, missing: true },
  { name: "ATK healing uses existing LP gain multiplier", action: { type: "heal_from_destroyed_atk", useBaseAtk: true, fraction: 0.5 }, multiplier: true },
];

for (const actor of ["bot", "player"] as const) {
  for (const input of healCases) test(`battle resource action matches runtime (${actor}, ${input.name})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
    t.after(() => game.dispose("architecture_battle_resource_actions"));
    const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
    owner.controllerType = opponent.controllerType = "ai";
    owner.lp = opponent.lp = 5000;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    const source = new Card({ ...cardDefinition(1), effects: [] }, owner.id);
    const destroyed = new Card({ ...cardDefinition(1), effects: [], atk: 2501, def: 0, level: input.level ?? 4 }, opponent.id);
    destroyed.atk = 3999;
    placeFieldCards(owner.field, source);
    opponent.graveyard.push(destroyed);
    if (input.multiplier) placeFieldCards(owner.field, required(game.createCardForOwner(171, owner)));
    owner.updatePassiveEffects();
    const { state } = createGameTreeCopy(game, owner);
    const simSource = required(state.bot.field.find(card => card.instanceId === source.instanceId));
    const simDestroyed = required(state.player.graveyard.find(card => card.instanceId === destroyed.instanceId));
    const runtimeEvents: object[] = [], events: object[] = [];
    game.on("lp_change", event => runtimeEvents.push({ owner: event.player?.id, before: event.before, after: event.after,
      gained: event.lpGained, lost: event.lpLost, paid: event.lpPaid, source: event.sourceCard?.instanceId }));
    // The final action distinguishes a false prerequisite from legal zero-heal completion.
    const actions: CardAction[] = [input.action, { type: "heal", amount: 10, player: "self" }];
    await game.effectEngine.applyActions(actions, { source, player: owner, opponent, destroyed: input.missing ? null : destroyed }, {});
    applySimulatedActions({ state, selfId: "bot", actions, options: attachSimulatedEventEmitter(state, {
      enableSimulatedEvents: true, sourceCard: simSource, actionContext: { destroyed: input.missing ? null : simDestroyed },
      onSimulatedEvent(event, payload) {
        if (event === "lp_change") events.push({ owner: Reflect.get(payload, "player")?.id,
          before: Reflect.get(payload, "before"), after: Reflect.get(payload, "after"), gained: Reflect.get(payload, "lpGained"),
          lost: Reflect.get(payload, "lpLost"), paid: Reflect.get(payload, "lpPaid"), source: Reflect.get(payload, "sourceCard")?.instanceId });
      },
    }) });
    assert.equal(state.bot.lp, owner.lp);
    assert.equal(state.player.lp, opponent.lp);
    assert.equal(state.bot.lpGainedThisTurn, owner.lpGainedThisTurn);
    assert.deepEqual(events, runtimeEvents);
    assert.deepEqual(state._simUnsupportedActions || [], []);
    if (input.name.includes("returns false")) assert.equal(owner.lp, 5000, "false action stops the following heal");
    if (input.name === "level zero continues without healing") assert.equal(owner.lp, 5010, "zero level is a successful no-op");
    if (input.name === "legacy opponent recipient still heals activating owner") assert.equal(opponent.lp, 5000);
  });

  for (const [name, action, lp] of [
    ["default recipient", { type: "damage", amount: 700 }, 5000],
    ["explicit opponent lethal clamp", { type: "damage", amount: 700, player: "opponent" }, 500],
    ["self recipient", { type: "damage", amount: 700, player: "self" }, 5000],
    ["self lethal clamp", { type: "damage", amount: 700, player: "self" }, 500],
    ["zero does not heal", { type: "damage", amount: 0 }, 5000],
    ["negative does not heal", { type: "damage", amount: -700 }, 5000],
  ] satisfies Array<[string, CardAction, number]>) test(`damage action matches runtime bounds (${actor}, ${name})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
    t.after(() => game.dispose("architecture_battle_damage_bounds"));
    const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
    owner.lp = opponent.lp = lp;
    const source = new Card({ ...cardDefinition(1), effects: [] }, owner.id);
    placeFieldCards(owner.field, source);
    const { state } = createGameTreeCopy(game, owner);
    const simSource = required(state.bot.field.find(card => card.instanceId === source.instanceId));
    await game.effectEngine.applyActions([action], { source, player: owner, opponent }, {});
    applySimulatedActions({ state, selfId: "bot", actions: [action], options: { sourceCard: simSource } });
    assert.equal(state.bot.lp, owner.lp);
    assert.equal(state.player.lp, opponent.lp);
    assert.deepEqual(state._simUnsupportedActions || [], []);
    if (name.includes("does not heal")) assert.deepEqual([owner.lp, opponent.lp], [lp, lp]);
  });
}
