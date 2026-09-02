import assert from "node:assert/strict";
import test from "node:test";

import { ensureSimOncePerTurnBucket } from "../../src/core/ai/common/simStateUtils.js";
import { simulateMainPhaseAction } from "../../src/core/ai/shadowheart/simulation.js";
import { cloneBotGameState } from "../../src/core/bot/simulationBridge.js";

interface TestCard {
  id: number;
  name: string;
  cardKind: "monster";
  level: number;
  atk: number;
  def: number;
  archetype: string;
  archetypes: string[];
  effects: [];
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
  const imp = shadowHeartMonster(1, "Shadow-Heart Imp");
  sourceBot.hand.push(imp, shadowHeartMonster(2, "Shadow-Heart Gecko"));
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
