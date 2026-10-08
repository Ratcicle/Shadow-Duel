import assert from "node:assert/strict";
import test from "node:test";

import { ensureSimOncePerTurnBucket } from "../../src/core/ai/common/simStateUtils.js";
import { simulateMainPhaseAction } from "../../src/core/ai/shadowheart/simulation.js";
import { cloneBotGameState } from "../../src/core/bot/simulationBridge.js";
import * as usage from "../../src/core/ai/common/simStateUtils.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";

function usageFixture(actor: "bot" | "player") {
  const first = player("bot");
  const second = player("player");
  first.field.push(shadowHeartMonster(503, "Shared definition"), shadowHeartMonster(503, "Shared definition"));
  second.field.push(shadowHeartMonster(503, "Shared definition"));
  const game = { bot: first, player: second, turn: actor, phase: "main1", turnCounter: 7 };
  const state = createGameTreeCopy(game, game[actor]).state;
  state.bot.field.forEach((card, index) => { card.instanceId = `sim:${actor}:${index}`; });
  state.player.field.forEach((card, index) => { card.instanceId = `sim:opponent:${index}`; });
  return state;
}

for (const actor of ["bot", "player"] as const) {
  test(`simulated effect ledger respects shared names, card instances and turn expiry (${actor})`, () => {
    assert.equal(typeof usage.canUseSimulatedEffectUsage, "function");
    const state = usageFixture(actor);
    const first = required(state.bot.field[0]);
    const second = { ...first, instanceId: "sim:second-copy" };
    state.bot.field.push(second);
    const opposing = required(state.player.field[0]);
    const shared = { id: "shared", oncePerTurn: true, oncePerTurnName: "shared-effect", usagePolicy: "use" as const };
    assert.equal(usage.canUseSimulatedEffectUsage(state, shared, first, "bot"), true);
    usage.markSimulatedEffectUsage(state, shared, first, "bot");
    assert.equal(usage.canUseSimulatedEffectUsage(state, shared, second, "bot"), false);
    assert.equal(usage.canUseSimulatedEffectUsage(state, shared, opposing, "player"), true);
    const perCard = { ...shared, oncePerTurnName: "card-effect", oncePerTurnScope: "card" as const };
    usage.markSimulatedEffectUsage(state, perCard, first, "bot");
    assert.equal(usage.canUseSimulatedEffectUsage(state, perCard, first, "bot"), false);
    assert.equal(usage.canUseSimulatedEffectUsage(state, perCard, second, "bot"), true);
    first.oncePerTurnResetVersion = 1;
    assert.equal(usage.canUseSimulatedEffectUsage(state, perCard, first, "bot"), true);
    state.turnCounter += 1;
    assert.equal(usage.canUseSimulatedEffectUsage(state, shared, first, "bot"), true);
  });
}

test("use and activate consume different outcomes, while unlimited effects remain reusable", () => {
  assert.equal(typeof usage.markSimulatedEffectUsage, "function");
  const state = usageFixture("bot");
  const source = required(state.bot.field[0]);
  for (const policy of ["use", "activate"] as const) {
    const effect = { id: policy, oncePerTurn: true, usagePolicy: policy };
    usage.markSimulatedEffectUsage(state, effect, source, "bot", false, { activationNegated: true });
    assert.equal(usage.canUseSimulatedEffectUsage(state, effect, source, "bot"), policy === "activate");
  }
  const successful = { id: "successful-activation", oncePerTurn: true, usagePolicy: "activate" as const };
  usage.markSimulatedEffectUsage(state, successful, source, "bot");
  assert.equal(usage.canUseSimulatedEffectUsage(state, successful, source, "bot"), false);
  const unlimited = { id: "electrocatapult_material", usagePolicy: "use" as const };
  usage.markSimulatedEffectUsage(state, unlimited, source, "bot");
  usage.markSimulatedEffectUsage(state, unlimited, source, "bot");
  assert.equal(usage.canUseSimulatedEffectUsage(state, unlimited, source, "bot"), true);
});

interface TestCard {
  id: number;
  name: string;
  cardKind: "monster";
  level: number;
  atk: number;
  def: number;
  archetype: string;
  archetypes: string[];
  effects: readonly EffectDefinition[];
}

function player(id: "player" | "bot") {
  return {
    id,
    lp: 8000,
    hand: [] as TestCard[],
    field: [] as TestCard[],
    graveyard: [] as TestCard[],
    spellTrap: [] as TestCard[],
    deck: [] as TestCard[],
    extraDeck: [] as TestCard[],
    banished: [] as TestCard[],
    fieldSpell: null,
    summonCount: 0,
    additionalNormalSummons: 0,
    additionalNormalSummonPermissions: [],
    normalSummonsThisTurn: [],
    specialSummonRestrictions: [],
    effectActivationRestrictions: [],
  };
}

function shadowHeartMonster(id: number, name: string): TestCard {
  return {
    id,
    name,
    cardKind: "monster",
    level: 2,
    atk: 500,
    def: 500,
    archetype: "Shadow-Heart",
    archetypes: ["Shadow-Heart"],
    effects: [],
  };
}

function cloneLegacyBotFixture(bot: object, game: object) {
  const runtimeClone: unknown = cloneBotGameState;
  if (typeof runtimeClone !== "function") {
    throw new TypeError("cloneBotGameState must remain callable");
  }
  return Reflect.apply(runtimeClone, undefined, [bot, game]) as ReturnType<
    typeof cloneBotGameState
  >;
}

test("Shadow-Heart and common simulation share counted OPT buckets", () => {
  const sourceBot = player("bot");
  const imp = shadowHeartMonster(107, "Shadow-Heart Imp");
  const gecko = shadowHeartMonster(108, "Shadow-Heart Gecko");
  // This interop assertion exercises a real trigger, rather than implicit
  // behavior inferred from the source's display name.
  imp.effects = cardDefinition(107).effects || [];
  // The recruit intentionally has no further effects: isolate the counted
  // source trigger from a second, independent search trigger.
  sourceBot.hand.push(imp, gecko);
  const opponent = player("player");
  const bot = {
    ...sourceBot,
    resolveOpponent: () => opponent,
    strategy: {
      simulateMainPhaseAction: () => undefined,
      simulateSpellEffect: () => undefined,
    },
  };
  const game = {
    bot,
    player: opponent,
    turn: "bot",
    phase: "main1",
    turnCounter: 1,
  };
  const state = cloneLegacyBotFixture(bot, game);
  state._simOncePerTurn = {};
  state.bot.additionalNormalSummonPermissions = [];
  state.bot.normalSummonsThisTurn = [];
  state.bot.specialSummonRestrictions = [];
  state.bot.effectActivationRestrictions = [];

  const commonBucket = ensureSimOncePerTurnBucket(state, "bot");
  commonBucket.set("common_probe", 1);

  assert.doesNotThrow(() =>
    simulateMainPhaseAction(state, {
      type: "summon",
      index: 0,
      cardName: imp.name,
      position: "attack",
    }),
  );
  assert.equal(state._simOncePerTurn.bot, commonBucket);
  assert.deepEqual([...commonBucket], [
    ["common_probe", 1],
    ["shadow_heart_imp_on_summon", 1],
  ]);
  assert.deepEqual(
    state.bot.field.map((card) => card.name),
    ["Shadow-Heart Imp", "Shadow-Heart Gecko"],
  );
});
