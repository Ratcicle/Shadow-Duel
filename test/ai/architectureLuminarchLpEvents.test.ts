import assert from "node:assert/strict";
import test from "node:test";
import { attachSimulatedEventEmitter } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import type { CardAction } from "../../src/core/contracts/actions.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { required } from "../helpers/fixtures.js";

for (const actor of ["player", "bot"] as const) {
  for (const kind of ["heal", "heal_pair", "opponent_heal", "counted_heal", "pay"] as const) {
    test(`LP facts preserve runtime owner, source, amount and one Sunforged counter (${actor}, ${kind})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: false });
      t.after(() => game.dispose("architecture_luminarch_lp_facts"));
      game.turn = actor;
      game.phase = "main1";
      game.turnCounter = 4;
      const owner = game[actor];
      const opponent = game[actor === "player" ? "bot" : "player"];
      owner.controllerType = "ai";
      opponent.controllerType = "ai";
      owner.lp = 5000;
      const source = required(game.createCardForOwner(155, owner));
      const barbarias = required(game.createCardForOwner(171, owner));
      const blade = required(game.createCardForOwner(166, owner));
      const oppositeBlade = required(game.createCardForOwner(166, opponent));
      source.isFacedown = false;
      barbarias.isFacedown = false;
      blade.isFacedown = false;
      oppositeBlade.isFacedown = false;
      placeFieldCards(owner.field, source, barbarias);
      placeFieldCards(owner.spellTrap, blade);
      placeFieldCards(opponent.spellTrap, oppositeBlade);
      await game.effectEngine.applyEquip({ type: "equip", targetRef: "host" },
        { source: blade, player: owner, opponent }, { host: [barbarias] });
      owner.updatePassiveEffects();
      const actions: CardAction[] = kind === "heal_pair" ? [
        { type: "heal", amount: 500, player: "self" }, { type: "heal", amount: 500, player: "self" },
      ] : kind === "opponent_heal" ? [{ type: "heal", amount: 500, player: "opponent" }]
        : kind === "heal" ? [{ type: "heal", amount: 500, player: "self" }]
        : kind === "counted_heal" ? [{ type: "heal_per_archetype_monster", archetype: "Luminarch", amountPerMonster: 250, player: "self" }]
          : [{ type: "pay_lp", amount: 500 }];
      const { state } = createGameTreeCopy(game, owner);
      const simSource = required(state.bot.field.find(card => card.instanceId === source.instanceId));
      const simBlade = required(state.bot.spellTrap.find(card => card.instanceId === blade.instanceId));
      const simHost = required(state.bot.field.find(card => card.instanceId === barbarias.instanceId));
      const simOppositeBlade = required(state.player.spellTrap.find(card => card.instanceId === oppositeBlade.instanceId));
      const runtimeFacts: object[] = [];
      const simulationFacts: object[] = [];
      const payments: object[] = [];
      game.on("lp_change", event => {
        runtimeFacts.push({ owner: event.player.id, source: event.sourceCard?.instanceId,
          before: event.before, after: event.after, gained: event.lpGained, lost: event.lpLost, paid: event.lpPaid });
      });
      const options = attachSimulatedEventEmitter(state, {
        enableSimulatedEvents: true,
        sourceCard: simSource,
        onSimulatedEvent(event, payload) {
          if (event !== "lp_change") return;
          const player: unknown = Reflect.get(payload, "player");
          const card: unknown = Reflect.get(payload, "sourceCard");
          assert.ok(player && typeof player === "object");
          assert.ok(card && typeof card === "object");
          // GameTree perspective changes owner.id, while the physical source
          // and all event amounts must stay identical to the live event.
          simulationFacts.push({ owner: player === state.bot ? actor : opponent.id, source: Reflect.get(card, "instanceId"),
            before: Reflect.get(payload, "before"), after: Reflect.get(payload, "after"),
            gained: Reflect.get(payload, "lpGained"), lost: Reflect.get(payload, "lpLost"), paid: Reflect.get(payload, "lpPaid") });
        },
        onLpPayment(event) {
          payments.push({ source: event.sourceCard?.instanceId, before: event.before, after: event.after, amount: event.amount });
        },
      });
      assert.equal(applySimulatedActions({ state, actions, options }), true);
      await game.effectEngine.applyActions(actions, { player: owner, opponent, source }, {});
      assert.equal(runtimeFacts.length, actions.length);
      assert.deepEqual(simulationFacts, runtimeFacts);
      assert.equal(state.bot.lp, owner.lp);
      assert.equal(state.player.lp, opponent.lp);
      assert.deepEqual([simHost.atk, simHost.def], [barbarias.atk, barbarias.def],
        "the real equipped counter passive refreshes the host after each factual gain");
      assert.deepEqual([simBlade.equipAtkBonus || 0, simBlade.equipDefBonus || 0],
        [blade.equipAtkBonus || 0, blade.equipDefBonus || 0], "counter buffs are tracked independently of fixed Equip bonuses");
      assert.equal(simBlade.counters?.get("solar") || 0, blade.getCounter("solar"));
      assert.equal(blade.getCounter("solar"), kind === "pay" || kind === "opponent_heal" ? 0 : kind === "heal_pair" ? 2 : 1);
      assert.equal(simOppositeBlade.counters?.get("solar") || 0, oppositeBlade.getCounter("solar"));
      assert.equal(oppositeBlade.getCounter("solar"), kind === "opponent_heal" ? 1 : 0);
      assert.deepEqual(payments, kind === "pay" ? [{ source: source.instanceId, before: 5000, after: 4500, amount: 500 }] : []);
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }
}
