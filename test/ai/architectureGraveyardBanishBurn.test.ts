import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import DragonStrategy from "../../src/core/ai/DragonStrategy.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { attachSimulatedEventEmitter } from "../../src/core/ai/common/simulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { canUseSimulatedEffectUsage, markSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import type { ActionOf } from "../../src/core/contracts/actions.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

const cases: ReadonlyArray<{ name: string; action: ActionOf<"banish_all_graveyard_and_burn">; empty?: boolean;
  protection?: "one" | "all"; siblingMove?: boolean; immunity?: boolean; lethal?: boolean }> = [
  { name: "both owners and physical sibling copies", action: { type: "banish_all_graveyard_and_burn", scope: "both", damagePerCard: 100 } },
  { name: "default scope and zero damage", action: { type: "banish_all_graveyard_and_burn" } },
  { name: "opponent graveyard self damage", action: { type: "banish_all_graveyard_and_burn", scope: "opponent", player: "self", damagePerCard: 150 } },
  { name: "protected first card only counts successful moves", action: { type: "banish_all_graveyard_and_burn", scope: "opponent", damagePerCard: 100 }, protection: "one" },
  { name: "all protected aborts following action", action: { type: "banish_all_graveyard_and_burn", scope: "opponent", damagePerCard: 100 }, protection: "all" },
  { name: "empty graveyards abort following action", action: { type: "banish_all_graveyard_and_burn", scope: "both", damagePerCard: 100 }, empty: true },
  { name: "sequential observer removes later sibling", action: { type: "banish_all_graveyard_and_burn", scope: "both", damagePerCard: 100 }, siblingMove: true },
  { name: "graveyard non-targeting immunity follows runtime", action: { type: "banish_all_graveyard_and_burn", scope: "opponent", damagePerCard: 100 }, immunity: true },
  { name: "lethal damage clamps and records actual loss", action: { type: "banish_all_graveyard_and_burn", scope: "both", damagePerCard: 100 }, lethal: true },
  { name: "negative damage never heals", action: { type: "banish_all_graveyard_and_burn", scope: "both", damagePerCard: -100 } },
];

for (const actor of ["bot", "player"] as const) {
  for (const policy of ["use", "activate"] as const) {
    for (const outcome of ["success", "activation_negated", "effect_negated", "precommit_failure"] as const) {
      // `cancelled` describes an uncommitted simulator activation; runtime
      // `use` reservations already consume before settlement and are outside it.
      if (policy === "use" && outcome === "precommit_failure") continue;
      test(`duel-wide usage matches canonical reservation settlement (${actor}/${policy}/${outcome})`, t => {
        const game = createRuntimeGame({ laboratoryMode: true });
        t.after(() => game.dispose("architecture_duel_usage"));
        game.turn = actor; game.turnCounter = 4;
        const owner = game[actor];
        const effect: EffectDefinition = { id: "declarative_duel_usage", timing: "ignition", activationZones: ["field"],
          actions: [{ type: "draw", amount: 1 }], oncePerDuel: true, oncePerDuelName: "shared_declarative_duel_usage",
          usagePolicy: policy };
        const source = new Card({ ...cardDefinition(271), effects: [effect] }, owner.id);
        const sibling = new Card({ ...cardDefinition(271), effects: [effect] }, owner.id);
        placeFieldCards(owner.field, source, sibling);
        const { state } = createGameTreeCopy(game, owner);
        const simSource = required(state.bot.field[0]), simSibling = required(state.bot.field[1]);
        const beforeQuery = structuredClone(state.bot.oncePerDuelUsageByName);
        for (let repeat = 0; repeat < 3; repeat++) assert.equal(canUseSimulatedEffectUsage(state, effect, simSource, actor, true), true);
        assert.deepEqual(state.bot.oncePerDuelUsageByName, beforeQuery, "Repeated preview never creates or consumes a ledger.");
        const reservation = required(game.reserveEffectUsage({ card: source, player: owner, effect }));
        assert.ok("reservationId" in reservation);
        game.settleEffectUsage(reservation, outcome === "activation_negated" || outcome === "precommit_failure" ? outcome : {});
        markSimulatedEffectUsage(state, effect, simSource, actor, true,
          { activationNegated: outcome === "activation_negated", cancelled: outcome === "precommit_failure" });
        assert.equal(canUseSimulatedEffectUsage(state, effect, simSibling, actor, true), game.checkEffectUsage({ card: sibling, player: owner, effect }).ok);
        assert.deepEqual(Object.entries(state.bot.oncePerDuelUsageByName || {}), Object.entries(owner.oncePerDuelUsageByName || {}));
        game.turnCounter++; state.turnCounter++;
        assert.equal(canUseSimulatedEffectUsage(state, effect, simSibling, actor, true), game.checkEffectUsage({ card: sibling, player: owner, effect }).ok,
          "Duel-wide usage survives turn changes and is shared by sibling copies.");
        assert.equal(canUseSimulatedEffectUsage(state, effect, simSibling, state.player.id, true), true,
          "The opposite physical owner has an independent duel-wide ledger.");
      });
    }
  }
  test(`duel-wide limits project legacy boolean usage and remain detached (${actor})`, t => {
    const game = createRuntimeGame({ laboratoryMode: true });
    t.after(() => game.dispose("architecture_duel_usage_projection"));
    const owner = game[actor];
    const effect: EffectDefinition = { id: "limited_twice", timing: "ignition", activationZones: ["field"],
      actions: [], oncePerDuel: true, oncePerDuelLimit: 2, usagePolicy: "activate" };
    const source = new Card({ ...cardDefinition(271), effects: [effect] }, owner.id);
    placeFieldCards(owner.field, source); owner.oncePerDuelUsageByName = { [effect.id]: 1 };
    // This accepted public read view characterizes the older boolean ledger
    // without lying about RuntimeGame's narrower numeric producer contract.
    const legacyOwner = { ...owner, oncePerDuelUsageByName: { [effect.id]: true } };
    const { state } = createGameTreeCopy({ player: actor === "player" ? legacyOwner : game.player,
      bot: actor === "bot" ? legacyOwner : game.bot, turnCounter: game.turnCounter }, legacyOwner);
    const simSource = required(state.bot.field[0]);
    assert.equal(canUseSimulatedEffectUsage(state, effect, simSource, actor, true), true);
    markSimulatedEffectUsage(state, effect, simSource, actor, true);
    assert.equal(canUseSimulatedEffectUsage(state, effect, simSource, actor, true), false);
    assert.equal(game.effectEngine.checkOncePerDuel(source, owner, effect).ok, true);
    assert.equal(owner.oncePerDuelUsageByName?.[effect.id], 1, "Planning does not mutate the live Player ledger.");
  });
  for (const input of cases) test(`graveyard banish-burn follows real sequential action (${actor}/${input.name})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
    t.after(() => game.dispose("architecture_graveyard_banish_burn"));
    game.turn = actor; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
    owner.controllerType = opponent.controllerType = "ai";
    owner.lp = 5000; opponent.lp = input.lethal ? 50 : 5000;
    const source = new Card({ ...cardDefinition(271), name: "Declared burn action control", effects: [] }, owner.id);
    const own = new Card({ ...cardDefinition(252), effects: [] }, owner.id);
    const first = new Card({ ...cardDefinition(252), effects: [] }, opponent.id);
    const sibling = new Card({ ...cardDefinition(input.protection === "one" ? 253 : 252), effects: [] }, opponent.id);
    const unrelated = new Card({ ...cardDefinition(252), effects: [] }, owner.id);
    placeFieldCards(owner.field, source); owner.hand.push(unrelated);
    if (!input.empty) { owner.graveyard.push(own); opponent.graveyard.push(first, sibling); }
    if (input.immunity) first.immuneToOpponentEffectsUntilTurn = game.turnCounter;
    if (input.protection) {
      const guard = new Card({ ...cardDefinition(253), effects: [{ id: "declared_gy_banish_protection", timing: "passive",
        requireZone: "field", requireFaceup: true, passive: { type: "banish_protection", protectFrom: "opponent_effects",
          targetScope: { owner: "self", zone: "graveyard", filters: { name: first.name } } } }] }, opponent.id);
      placeFieldCards(opponent.field, guard);
    }
    const { state } = createGameTreeCopy(game, owner);
    const simSource = required(state.bot.field[0]);
    const simOwn = state.bot.graveyard[0], simSibling = state.player.graveyard[1];
    const liveFacts: object[] = [], simFacts: object[] = [];
    game.on("card_moved", async event => {
      liveFacts.push({ type: "move", id: event.card.instanceId, from: event.fromZone, to: event.toZone,
        owner: event.player?.id, label: event.contextLabel, byEffect: event.movedByEffect,
        source: event.sourceCard?.instanceId });
      if (input.siblingMove && event.card === own) await game.moveCard(sibling, opponent, "hand", { fromZone: "graveyard", awaitCardMovedEvent: true });
    });
    game.on("lp_change", event => liveFacts.push({ type: "lp", owner: event.player?.id, before: event.before,
      after: event.after, lost: event.lpLost, source: event.sourceCard?.instanceId }));
    // The following heal proves empty/all-protected failure stops the action sequence.
    await game.effectEngine.applyActions([input.action, { type: "heal", amount: 10, player: "self" }], { source, player: owner, opponent }, {});
    applySimulatedActions({ state, selfId: "bot", actions: [input.action, { type: "heal", amount: 10, player: "self" }],
      options: attachSimulatedEventEmitter(state, { sourceCard: simSource, enableSimulatedEvents: true,
        onSimulatedEvent(event, payload) {
          if (event === "card_moved") {
            const card = Reflect.get(payload, "card");
            simFacts.push({ type: "move", id: card?.instanceId, from: Reflect.get(payload, "fromZone"), to: Reflect.get(payload, "toZone"),
              owner: Reflect.get(payload, "player")?.id, label: Reflect.get(payload, "contextLabel"), byEffect: Reflect.get(payload, "movedByEffect"),
              source: Reflect.get(payload, "sourceCard")?.instanceId });
            if (input.siblingMove && card === simOwn && simSibling) {
              const index = state.player.graveyard.indexOf(simSibling);
              if (index >= 0) { state.player.graveyard.splice(index, 1); state.player.hand.push(simSibling); }
              // This fixture observes the parent's sequence; the external child movement is compared by final zones.
            }
          } else if (event === "lp_change") simFacts.push({ type: "lp", owner: Reflect.get(payload, "player")?.id,
            before: Reflect.get(payload, "before"), after: Reflect.get(payload, "after"), lost: Reflect.get(payload, "lpLost"),
            source: Reflect.get(payload, "sourceCard")?.instanceId });
        },
      }) });
    const ids = (cards: readonly { instanceId?: number | string | undefined }[]) => cards.map(card => card.instanceId);
    assert.deepEqual([ids(state.bot.graveyard), ids(state.player.graveyard)], [ids(owner.graveyard), ids(opponent.graveyard)]);
    assert.deepEqual([ids(state.bot.banished), ids(state.player.banished)], [ids(owner.banished), ids(opponent.banished)]);
    assert.deepEqual([ids(state.bot.hand), ids(state.player.hand)], [ids(owner.hand), ids(opponent.hand)]);
    assert.deepEqual([state.bot.lp, state.player.lp], [owner.lp, opponent.lp]);
    assert.deepEqual([state.bot.damageReceivedThisTurn || 0, state.player.damageReceivedThisTurn || 0],
      [owner.damageReceivedThisTurn || 0, opponent.damageReceivedThisTurn || 0]);
    assert.deepEqual(simFacts, input.siblingMove ? liveFacts.filter(fact => Reflect.get(fact, "id") !== sibling.instanceId) : liveFacts);
    assert.deepEqual(state._simUnsupportedActions || [], []);
    if (input.empty || input.protection === "all") assert.equal(owner.lp, 5000);
    assert.ok(owner.hand.includes(unrelated), "Same-ID card outside the chosen Graveyard scope is unchanged.");
  });

  for (const empty of [false, true]) test(`Volcanic ignition consumes declared once-per-duel without invented costs (${actor}/${empty})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
    t.after(() => game.dispose("architecture_volcanic_burn_usage"));
    game.turn = actor; game.phase = "main1"; game.turnCounter = 4; game.disablePresentationDelays = true;
    const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
    owner.controllerType = opponent.controllerType = "ai";
    const source = required(game.createCardForOwner(271, owner));
    placeFieldCards(owner.field, source);
    if (!empty) owner.graveyard.push(new Card({ ...cardDefinition(252), effects: [] }, owner.id));
    const effect = required(source.effects.find(entry => entry.id === "volcanic_extreme_dragon_banish_burn"));
    assert.equal(effect.oncePerDuel, true); assert.equal(effect.activationCosts, undefined);
    const { state } = createGameTreeCopy(game, owner);
    const simSource = required(state.bot.field[0]);
    const live = await game.tryActivateMonsterEffect(source, null, "field", owner, { effectId: effect.id });
    new DragonStrategy(state.bot).simulateMainPhaseAction(state, { type: "monsterEffect", fieldIndex: 0, cardId: 271, effectId: effect.id });
    // Empty Graveyards are refused by runtime preview before activation or usage.
    assert.equal(live.success, !empty);
    assert.deepEqual(state.bot.graveyard.map(card => card.id), owner.graveyard.map(card => card.id));
    assert.equal(state.player.lp, opponent.lp);
    assert.equal(game.effectEngine.checkOncePerDuel(source, owner, effect).ok, empty);
    assert.equal(canUseSimulatedEffectUsage(state, effect, simSource, actor, true), empty);
    assert.deepEqual(state._simUnsupportedActions || [], []);
    assert.equal(owner.hand.length, 0, "The declared ignition has no discard or LP cost.");
  });
}
