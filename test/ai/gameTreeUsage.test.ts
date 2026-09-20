import assert from "node:assert/strict";
import test from "node:test";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { canUseSimOncePerTurn, markSimOncePerTurnUsed } from "../../src/core/ai/common/simStateUtils.js";
import type { AiStateShape, SimulatedCardShape, SimulatedCardState, SimulatedPlayerState, SimulationGameState } from "../../src/core/contracts/aiState.js";
import { unsafeFixture } from "../helpers/fixtures.js";

function player(id: string): SimulatedPlayerState {
  return { id, lp: 8000, hand: [], field: [], spellTrap: [], graveyard: [], deck: [], extraDeck: [], banished: [], fieldSpell: null, summonCount: 0, additionalNormalSummons: 0 };
}

function state(actorId: string, opponentId: string): SimulationGameState {
  return unsafeFixture<SimulationGameState>({ bot: player(actorId), player: player(opponentId), turn: actorId, phase: "main1", turnCounter: 1, _isPerspectiveState: true, _gameTreeActors: {} } satisfies AiStateShape,
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
    game.bot.field.push(card(1, "actor source", effects));
    game.player.field.push(card(2, "opponent source", effects));
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
    game.bot.field.push(card(1, "actor source", effects));
    game.player.field.push(card(2, "opponent source", effects));
    game.bot.hand.push(card(3, "summoned"));
    game[blockedSlot].effectActivationRestrictions = [{ blockedNames: ["actor source", "opponent source"], allowedAttributes: [], restrictedCardFilters: {}, duration: "turn", expiresOnTurn: 1, reason: null, sourceName: null, sourceId: null, effectId: null }];
    const activated: string[] = [];
    applyGenericSimulatedMainPhaseAction(game, { type: "summon", index: 0, cardName: "summoned", position: "attack" }, {
      enableSimulatedEvents: true,
      onEffectActivated({ card: source }: { card: SimulatedCardState }) { activated.push(source.name || ""); },
    });
    assert.deepEqual(activated, [blockedSlot === "bot" ? "opponent source" : "actor source"]);
  });
}

test("Other simulation profiles retain slot-based default usage", () => {
  const game: AiStateShape = { bot: player("player"), player: player("bot"), turn: "player", phase: "main1", turnCounter: 1 };
  markSimOncePerTurnUsed(game, "legacy");
  [game.bot, game.player] = [game.player, game.bot];
  assert.equal(canUseSimOncePerTurn(game, "legacy"), false);
  assert.equal(canUseSimOncePerTurn(game, "legacy", 1, "player"), true);
});
