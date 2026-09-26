import { placeSimulationCards } from "../helpers/simulation.js";
import assert from "node:assert/strict";
import test from "node:test";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { canUseSimOncePerTurn, markSimOncePerTurnUsed } from "../../src/core/ai/common/simStateUtils.js";
import type { AiStateShape, SimulatedCardShape, SimulatedCardState, SimulatedPlayerState, SimulationGameState } from "../../src/core/contracts/aiState.js";
import { unsafeFixture } from "../helpers/fixtures.js";
import type { SimulatedRuntimeStateFields } from "../../src/core/ai/common/simulatedActions/shared.js";
import { resolvePerspectiveSlotForPlayer } from "../../src/core/ai/common/perspective.js";

function player(id: string): SimulatedPlayerState {
  return { id, lp: 8000, hand: [], field: [], spellTrap: [], graveyard: [], deck: [], extraDeck: [], banished: [], fieldSpell: null, summonCount: 0, additionalNormalSummons: 0 };
}

function state(actorId: string, opponentId: string): SimulationGameState & SimulatedRuntimeStateFields {
  return unsafeFixture<SimulationGameState & SimulatedRuntimeStateFields>({ bot: player(actorId), player: player(opponentId), turn: actorId, phase: "main1", turnCounter: 1, _isPerspectiveState: true, _gameTreeActors: {} } satisfies AiStateShape,
    "Branded simulation fixture with a GameTree ownership marker for rotated actor tests");
}

function card(instanceId: number, name: string, effects: NonNullable<SimulatedCardShape["effects"]> = []): SimulatedCardState {
  return unsafeFixture<SimulatedCardState>({ instanceId, name, cardKind: "monster", atk: 1000, def: 800, level: 4, position: "attack", effects } satisfies SimulatedCardShape,
    "Minimal branded simulation card exercising real GameTree usage and event dispatch");
}

for (const [actorId, opponentId] of [["player", "bot"], ["north", "south"]]) {
  test(`GameTree usage follows physical actors through slot rotation (${actorId}/${opponentId})`, () => {
    assert.ok(actorId && opponentId);
    const game = state(actorId, opponentId);
    markSimOncePerTurnUsed(game, "shared");
    assert.equal(canUseSimOncePerTurn(game, "shared", 1, "player"), true);
    [game.bot, game.player] = [game.player, game.bot];
    assert.equal(canUseSimOncePerTurn(game, "shared"), true);
    assert.equal(canUseSimOncePerTurn(game, "shared", 1, "player"), false);
    markSimOncePerTurnUsed(game, "shared");
    [game.bot, game.player] = [game.player, game.bot];
    assert.equal(canUseSimOncePerTurn(game, "shared"), false);
    assert.equal(canUseSimOncePerTurn(game, "shared", 1, "player"), false);
  });

  test(`GameTree events and direct effects share each physical owner's usage (${actorId}/${opponentId})`, () => {
    assert.ok(actorId && opponentId);
    const game = state(actorId, opponentId);
    const effects: NonNullable<SimulatedCardShape["effects"]> = [
      { id: "direct", timing: "ignition", activationZones: ["field"], oncePerTurn: true, oncePerTurnName: "shared", actions: [{ type: "heal", amount: 100, player: "self" }] },
      { id: "event", timing: "on_event", event: "after_summon", triggerRequirement: "mandatory", triggerTiming: "if", oncePerTurn: true, oncePerTurnName: "shared", actions: [{ type: "heal", amount: 100, player: "self" }] },
    ];
    placeSimulationCards(game.bot.field, card(1, "actor source", effects));
    placeSimulationCards(game.player.field, card(2, "opponent source", effects));
    game.bot.hand.push(card(3, "summoned"));
    const activated: string[] = [];
    const options = {
      enableSimulatedEvents: true,
      onEffectActivated({ card: source, effect }: { card: SimulatedCardState; effect?: { id?: string } }) {
        activated.push(`${source.name}:${effect?.id}`);
      },
    };
    applyGenericSimulatedMainPhaseAction(game, { type: "monsterEffect", fieldIndex: 0 }, options);
    applyGenericSimulatedMainPhaseAction(game, { type: "summon", index: 0, cardName: "summoned", position: "attack" }, options);
    assert.deepEqual(activated, ["actor source:direct", "opponent source:event"]);
    assert.equal(game.bot.lp, 8100, "Only the direct effect heals the actor");
    assert.equal(game.player.lp, 8100, "The opponent trigger heals its physical owner");
    [game.bot, game.player] = [game.player, game.bot];
    applyGenericSimulatedMainPhaseAction(game, { type: "monsterEffect", fieldIndex: 0 }, options);
    assert.equal(activated.length, 2, "The event owner cannot reuse its named OPT as a direct effect after rotation");
  });
}

for (const blockedSlot of ["bot", "player"] as const) {
  test(`GameTree event restrictions follow physical owners when ${blockedSlot} slot is blocked`, () => {
    const game = state("player", "bot");
    const effects: NonNullable<SimulatedCardShape["effects"]> = [{
      id: "reward", timing: "on_event", event: "after_summon", triggerRequirement: "mandatory", triggerTiming: "if", oncePerTurn: true,
      actions: [{ type: "heal", amount: 100, player: "self" }],
    }];
    placeSimulationCards(game.bot.field, card(1, "actor source", effects));
    placeSimulationCards(game.player.field, card(2, "opponent source", effects));
    game.bot.hand.push(card(3, "summoned"));
    game[blockedSlot].effectActivationRestrictions = [{ blockedNames: ["actor source", "opponent source"], allowedAttributes: [], restrictedCardFilters: {}, duration: "turn", expiresOnTurn: 1, reason: null, sourceName: null, sourceId: null, effectId: null }];
    const activated: string[] = [];
    applyGenericSimulatedMainPhaseAction(game, { type: "summon", index: 0, cardName: "summoned", position: "attack" }, {
      enableSimulatedEvents: true,
      onEffectActivated({ card: source }: { card: SimulatedCardState }) { activated.push(source.name || ""); },
    });
    assert.deepEqual(activated, [blockedSlot === "bot" ? "opponent source" : "actor source"]);
    assert.equal(game[blockedSlot].lp, 8000);
    assert.equal(game[blockedSlot === "bot" ? "player" : "bot"].lp, 8100);
  });
}

test("Other simulation profiles retain slot-based default usage", () => {
  const game: AiStateShape = { bot: player("player"), player: player("bot"), turn: "player", phase: "main1", turnCounter: 1 };
  markSimOncePerTurnUsed(game, "legacy");
  [game.bot, game.player] = [game.player, game.bot];
  assert.equal(canUseSimOncePerTurn(game, "legacy"), false);
  assert.equal(canUseSimOncePerTurn(game, "legacy", 1, "player"), true);
});

const eventOptions = { enableSimulatedEvents: true, selfId: "bot" };

test("Physical player resolution prefers references, then IDs, and never defaults to an active slot", () => {
  const game = state("player", "bot");
  assert.equal(resolvePerspectiveSlotForPlayer(game, "bot"), "player");
  assert.equal(resolvePerspectiveSlotForPlayer(game, "player"), "bot");
  assert.equal(resolvePerspectiveSlotForPlayer(game, { id: "bot" }), "player");
  assert.equal(resolvePerspectiveSlotForPlayer(game, "missing"), null);
  assert.equal(resolvePerspectiveSlotForPlayer(game, {}), null);
  assert.equal(resolvePerspectiveSlotForPlayer(game, null), null);
  game.player.id = game.bot.id;
  assert.equal(resolvePerspectiveSlotForPlayer(game, game.player), "player", "A known reference takes precedence over a duplicate ID");
});

function summonForEvent(game: SimulationGameState, instanceId: number) {
  game.bot.hand.push(card(instanceId, "summoned"));
  game.bot.additionalNormalSummons++;
  applyGenericSimulatedMainPhaseAction(game, { type: "summon", index: game.bot.hand.length - 1, cardName: "summoned", position: "attack" }, eventOptions);
}

test("Nested bound temporary trigger keeps owner conditions, targets and until_consumed cleanup after rotation", () => {
  const game = state("bot", "player");
  const owner = game.bot;
  const other = game.player;
  const source = card(50, "Registrar", [{
    id: "register-bound", timing: "ignition", activationZones: ["field"],
    targets: [{ id: "bound", owner: "self", zone: "field", name: "Bound" }],
    actions: [{
      type: "register_temporary_event_effect", event: "card_moved", triggerRequirement: "mandatory", triggerTiming: "if",
      duration: "until_consumed", uses: 1, bindEventTargetRef: "bound", requireBoundTargetLeavesField: true,
      conditions: [{ type: "control_card_filters", owner: "self", filters: { name: "Registrar" } }],
      targets: [{ id: "ally", owner: "self", zone: "field", name: "Registrar" }],
      actions: [
        { type: "heal", player: "self", amount: 100 },
        { type: "draw", player: "self", amount: 1 },
        { type: "add_counter", targetRef: "ally", counterType: "reward", amount: 1 },
      ],
    }],
  }]);
  source.counters = new Map();
  const bound = card(51, "Bound");
  placeSimulationCards(owner.field, source, bound);
  owner.deck.push(card(52, "Owner draw"));
  placeSimulationCards(other.field, card(53, "Mover", [{
    id: "move-on-summon", timing: "on_event", event: "after_summon", triggerRequirement: "mandatory", triggerTiming: "if",
    targets: [{ id: "victim", owner: "opponent", zone: "field", name: "Bound" }],
    actions: [{ type: "move", targetRef: "victim", player: "opponent", fromZone: "field", to: "graveyard" }],
  }]));
  applyGenericSimulatedMainPhaseAction(game, { type: "monsterEffect", fieldIndex: 0 }, eventOptions);
  const entry = game.temporaryEventEffects?.[0];
  assert.ok(entry);
  assert.equal(entry.boundEventTargetInstanceId, 51);
  [game.bot, game.player] = [game.player, game.bot];
  summonForEvent(game, 54);
  assert.equal(entry.ownerId, "bot");
  assert.equal(entry.sourceInstanceId, 50);
  assert.equal(entry.usesRemaining, 0);
  assert.deepEqual(game.temporaryEventEffects, []);
  assert.equal(owner.lp, 8100);
  assert.equal(other.lp, 8000);
  assert.deepEqual(owner.hand.map(entry => entry.name), ["Owner draw"]);
  assert.deepEqual(other.hand, []);
  assert.deepEqual(owner.graveyard, [bound]);
  assert.equal(source.counters.get("reward"), 1);
});

for (const ids of [["bot", "player"], ["north", "south"]] as const) {
  for (const rotated of [false, true]) {
    test(`Card trigger conditions, targets and self/opponent actions follow owner (${ids}, rotated=${rotated})`, () => {
      const game = state(ids[0], ids[1]);
      const owner = game.player;
      const other = game.bot;
      const source = card(10, "Owner source", [{
        id: "reward", timing: "on_event", event: "after_summon", triggerRequirement: "mandatory", triggerTiming: "if",
        conditions: [{ type: "control_card_filters", owner: "self", filters: { name: "Owner source" } }],
        targets: [{ id: "ally", owner: "self", zone: "field", cardKind: "monster", name: "Owner source" }],
        actions: [
          { type: "heal", player: "self", amount: 100 },
          { type: "damage", player: "opponent", amount: 50 },
          { type: "add_counter", targetRef: "ally", counterType: "reward", amount: 1 },
        ],
      }]);
      source.counters = new Map();
      placeSimulationCards(owner.field, source);
      if (rotated) [game.bot, game.player] = [game.player, game.bot];
      summonForEvent(game, 20);
      assert.equal(owner.lp, 8100);
      assert.equal(other.lp, 7950);
      assert.equal(source.counters?.get("reward"), 1);
      assert.equal(game.bot.field.find(entry => entry.instanceId === 20)?.counters?.get("reward"), undefined);
    });
  }

  for (const reward of ["heal", "draw"] as const) {
    test(`Temporary ${reward} follows physical owner after rotation and consumes uses (${ids})`, () => {
      const game = state(ids[0], ids[1]);
      const owner = game.bot;
      const other = game.player;
      owner.deck.push(card(30, "Owner draw"), card(31, "Owner second draw"));
      other.deck.push(card(32, "Other draw"));
      placeSimulationCards(owner.field, card(10, "Registrar", [{
        id: "register", timing: "ignition", activationZones: ["field"], actions: [{
          type: "register_temporary_event_effect", event: "after_summon", triggerRequirement: "mandatory", triggerTiming: "if",
          duration: "until_consumed", uses: 2,
          actions: reward === "heal" ? [{ type: "heal", player: "self", amount: 100 }] : [{ type: "draw", player: "self", amount: 1 }],
        }],
      }]));
      applyGenericSimulatedMainPhaseAction(game, { type: "monsterEffect", fieldIndex: 0 }, eventOptions);
      const entry = game.temporaryEventEffects?.[0];
      assert.ok(entry);
      assert.equal(entry.ownerId, owner.id);
      assert.equal(entry.sourceInstanceId, 10);
      assert.equal(entry.expiresOnTurn, null);
      [game.bot, game.player] = [game.player, game.bot];
      summonForEvent(game, 40);
      assert.equal(entry.usesRemaining, 1);
      assert.equal(owner.lp, reward === "heal" ? 8100 : 8000);
      assert.deepEqual(owner.hand.map(entry => entry.name), reward === "draw" ? ["Owner draw"] : []);
      assert.equal(other.lp, 8000);
      assert.deepEqual(other.hand, []);
      summonForEvent(game, 41);
      assert.equal(entry.usesRemaining, 0);
      assert.deepEqual(game.temporaryEventEffects, []);
      assert.equal(owner.lp, reward === "heal" ? 8200 : 8000);
      assert.deepEqual(owner.hand.map(entry => entry.name), reward === "draw" ? ["Owner draw", "Owner second draw"] : []);
    });
  }
}
