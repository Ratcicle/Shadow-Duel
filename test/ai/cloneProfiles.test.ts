import assert from "node:assert/strict";
import test from "node:test";

import {
  greedySearchWithEvalV2,
} from "../../src/core/ai/BeamSearch.js";
import { gameTreeSearch } from "../../src/core/ai/GameTreeSearch.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";
import { cloneBotGameState } from "../../src/core/bot/simulationBridge.js";

type BotCloneCard = Parameters<typeof cloneBotGameState>[0]["hand"][number];

function makePlayer(id: "player" | "bot") {
  const nested = { stats: ["atk"] };
  const card: Partial<BotCloneCard> = {
    id: id === "bot" ? 101 : 201,
    name: `${id} card`,
    cardKind: "monster" as const,
    atk: 1200,
    def: 800,
  };
  Reflect.set(card, "nested", nested);
  return {
    id,
    lp: id === "bot" ? 7600 : 6400,
    hand: [card as BotCloneCard],
    field: [],
    graveyard: [],
    deck: [],
    extraDeck: [],
    banished: [],
    fieldSpell: null,
    spellTrap: [],
    summonCount: 1,
    additionalNormalSummons: 2,
    controllerType: "ai",
  };
}

interface CloneCardProbe {
  nested: { stats: string[] };
  counters: Map<string, number>;
  turnBasedBuffs: Array<{
    id: string;
    stat: "atk";
    value: number;
    expiresOnTurn: number;
  }>;
  equippedTo: object | null;
  equipTarget: object | null;
  equips: object[];
}

interface ClonePlayerProbe {
  lp: number;
  hand: CloneCardProbe[];
  additionalNormalSummonPermissions?: object[];
}

interface CloneStateProbe {
  bot: ClonePlayerProbe;
  player: ClonePlayerProbe;
  _gameRef?: object;
  _simOncePerTurn?: { bot?: Map<string, number> };
  _simLuminarch?: { milestones?: string[] };
  temporaryEventEffects?: Array<{ nested: { active: boolean } }>;
}

function requireCloneState(value: unknown): CloneStateProbe {
  assert.ok(value && typeof value === "object");
  const bot = Reflect.get(value, "bot");
  const player = Reflect.get(value, "player");
  assert.ok(bot && typeof bot === "object");
  assert.ok(player && typeof player === "object");
  return value as CloneStateProbe;
}

function makeCloneProfilePlayer(id: "player" | "bot") {
  const attachment = {
    id: id === "bot" ? 102 : 202,
    name: `${id} equipment`,
    cardKind: "spell" as const,
  };
  const card = {
    id: id === "bot" ? 101 : 201,
    name: `${id} card`,
    cardKind: "monster" as const,
    atk: 1200,
    def: 800,
    nested: { stats: ["atk"] },
    counters: new Map([["charge", 2]]),
    turnBasedBuffs: [
      {
        id: "profile-buff",
        stat: "atk" as const,
        value: 300,
        expiresOnTurn: 8,
      },
    ],
    equippedTo: attachment,
    equipTarget: attachment,
    equips: [attachment],
  };
  return {
    id,
    name: id,
    lp: id === "bot" ? 7600 : 6400,
    hand: [card],
    field: [],
    graveyard: [],
    deck: [],
    extraDeck: [],
    banished: [],
    fieldSpell: null,
    spellTrap: [],
    summonCount: 1,
    additionalNormalSummons: 2,
    additionalNormalSummonPermissions: [],
    normalSummonsThisTurn: [],
    specialSummonRestrictions: [],
    effectActivationRestrictions: [],
    controllerType: "ai" as const,
  };
}

function makeCloneProfileGame() {
  return {
    bot: makeCloneProfilePlayer("bot"),
    player: makeCloneProfilePlayer("player"),
    turn: "bot" as const,
    phase: "main1" as const,
    turnCounter: 7,
    _simOncePerTurn: { bot: new Map([["probe", 2]]) },
    _simLuminarch: { milestones: ["opening"] },
    temporaryEventEffects: [
      { event: "profile-probe", nested: { active: true } },
    ],
  };
}

const CLONE_PROBE_ACTION = {
  type: "position_change" as const,
  fieldIndex: 0,
  toPosition: "attack" as const,
  priority: 1,
};

test("bot perspective clone preserves its legacy key order and aliasing profile", () => {
  const bot = makePlayer("bot");
  const opponent = makePlayer("player");
  const usedThisTurn = new Map([["probe", 2]]);
  const game = {
    player: opponent,
    bot,
    turn: "bot",
    phase: "main1",
    turnCounter: 7,
    effectEngine: { usedThisTurn },
  };
  const botPort = {
    ...bot,
    resolveOpponent: () => opponent,
    strategy: {
      simulateMainPhaseAction: () => undefined,
      simulateSpellEffect: () => undefined,
    },
  };

  const clone = cloneBotGameState(botPort, game);

  assert.deepEqual(Object.keys(clone), [
    "player",
    "bot",
    "turn",
    "phase",
    "turnCounter",
    "_isPerspectiveState",
    "_gameRef",
    "usedThisTurn",
  ]);
  assert.deepEqual(Object.keys(clone.bot), [
    "id",
    "lp",
    "hand",
    "field",
    "graveyard",
    "deck",
    "extraDeck",
    "banished",
    "fieldSpell",
    "spellTrap",
    "summonCount",
    "additionalNormalSummons",
    "controllerType",
  ]);
  assert.equal(clone._isPerspectiveState, true);
  assert.equal(clone._gameRef, game);
  assert.notEqual(clone.bot, bot);
  assert.notEqual(clone.bot.hand, bot.hand);
  assert.notEqual(clone.bot.hand[0], bot.hand[0]);
  assert.equal(
    Reflect.get(clone.bot.hand[0]!, "nested"),
    Reflect.get(bot.hand[0]!, "nested"),
  );
  assert.notEqual(clone.usedThisTurn, usedThisTurn);
  assert.ok(clone.usedThisTurn);
  assert.deepEqual([...clone.usedThisTurn], [["probe", 2]]);
});

test("Beam/Greedy clone isolates selected mutable card state but keeps legacy aliases", async () => {
  const game = makeCloneProfileGame();
  let captured: unknown;
  const strategy = {
    generateMainPhaseActions: () => [CLONE_PROBE_ACTION],
    simulateMainPhaseAction(state: unknown) {
      const clone = requireCloneState(state);
      captured ??= clone;
      clone.bot.lp -= 1;
    },
    evaluateBoardV2: (state: unknown) => requireCloneState(state).bot.lp,
    evaluateBoard: (state: unknown) => requireCloneState(state).bot.lp,
  };

  const result = await greedySearchWithEvalV2(game, strategy, {
    preGeneratedActions: [CLONE_PROBE_ACTION],
  });
  const clone = requireCloneState(captured);
  const sourceCard = game.bot.hand[0];
  const clonedCard = clone.bot.hand[0];

  assert.ok(result);
  assert.equal(clone._gameRef, game);
  assert.notEqual(clone.bot, game.bot);
  assert.notEqual(clonedCard, sourceCard);
  assert.equal(clonedCard.nested, sourceCard.nested);
  assert.notEqual(clonedCard.counters, sourceCard.counters);
  assert.notEqual(clonedCard.turnBasedBuffs, sourceCard.turnBasedBuffs);
  assert.notEqual(clonedCard.turnBasedBuffs[0], sourceCard.turnBasedBuffs[0]);
  assert.equal(clonedCard.equippedTo, sourceCard.equippedTo);
  assert.notEqual(clonedCard.equips, sourceCard.equips);
  assert.equal(clonedCard.equips[0], sourceCard.equips[0]);
  assert.equal(
    clone.bot.additionalNormalSummonPermissions,
    game.bot.additionalNormalSummonPermissions,
  );
  assert.equal(clone._simOncePerTurn, undefined);

  clonedCard.counters.set("charge", 9);
  assert.equal(sourceCard.counters.get("charge"), 2);
});

test("GameTree clone omits unused zones and clears equipment links", () => {
  const game = makeCloneProfileGame();
  let captured: unknown;
  const strategy = {
    generateMainPhaseActions(state: unknown) {
      captured ??= state;
      return [CLONE_PROBE_ACTION];
    },
  };

  gameTreeSearch(game, strategy, game.bot, 1);
  const clone = requireCloneState(captured);
  const sourceCard = game.bot.hand[0];
  const clonedCard = clone.bot.hand[0];

  assert.equal(clone._gameRef, game);
  assert.notEqual(clone.bot, game.bot);
  assert.notEqual(clonedCard, sourceCard);
  assert.equal(clonedCard.nested, sourceCard.nested);
  assert.notEqual(clonedCard.counters, sourceCard.counters);
  assert.notEqual(clonedCard.turnBasedBuffs, sourceCard.turnBasedBuffs);
  assert.notEqual(clonedCard.turnBasedBuffs[0], sourceCard.turnBasedBuffs[0]);
  assert.equal(clonedCard.equippedTo, null);
  assert.equal(clonedCard.equipTarget, null);
  assert.deepEqual(clonedCard.equips, []);
  assert.equal(Object.hasOwn(clone.bot, "deck"), false);
  assert.equal(Object.hasOwn(clone.bot, "banished"), false);
  assert.equal(
    Object.hasOwn(clone.bot, "additionalNormalSummonPermissions"),
    false,
  );

  clonedCard.counters.set("charge", 9);
  assert.equal(sourceCard.counters.get("charge"), 2);
});

test("TurnLine clone deep-isolates planning cards and copied simulation metadata", async () => {
  const game = makeCloneProfileGame();
  let captured: unknown;
  const strategy = {
    generateMainPhaseActions: () => [CLONE_PROBE_ACTION],
    simulateMainPhaseAction(state: unknown) {
      const clone = requireCloneState(state);
      captured ??= clone;
      clone.bot.lp -= 1;
    },
    evaluateBoardV2: (state: unknown) => -requireCloneState(state).bot.lp,
  };

  const result = await turnLineSearch(game, strategy, {
    beamWidth: 1,
    maxDepth: 1,
    nodeBudget: 2,
  });
  const clone = requireCloneState(captured);
  const sourceCard = game.bot.hand[0];
  const clonedCard = clone.bot.hand[0];

  assert.ok(result);
  assert.equal(clone._gameRef, game);
  assert.notEqual(clone.bot, game.bot);
  assert.notEqual(clonedCard, sourceCard);
  assert.notEqual(clonedCard.nested, sourceCard.nested);
  assert.notEqual(clonedCard.counters, sourceCard.counters);
  assert.notEqual(clonedCard.equippedTo, sourceCard.equippedTo);
  assert.notEqual(clonedCard.equips, sourceCard.equips);
  assert.notEqual(clonedCard.equips[0], sourceCard.equips[0]);
  assert.notEqual(
    clone.bot.additionalNormalSummonPermissions,
    game.bot.additionalNormalSummonPermissions,
  );
  assert.notEqual(clone._simOncePerTurn, game._simOncePerTurn);
  assert.notEqual(clone._simOncePerTurn?.bot, game._simOncePerTurn.bot);
  assert.deepEqual([...clone._simOncePerTurn!.bot!], [["probe", 2]]);
  assert.notEqual(clone._simLuminarch, game._simLuminarch);
  assert.notEqual(
    clone._simLuminarch?.milestones,
    game._simLuminarch.milestones,
  );
  assert.notEqual(
    clone.temporaryEventEffects,
    game.temporaryEventEffects,
  );
  assert.notEqual(
    clone.temporaryEventEffects?.[0].nested,
    game.temporaryEventEffects[0].nested,
  );

  clonedCard.nested.stats.push("def");
  clonedCard.counters.set("charge", 9);
  clone._simLuminarch?.milestones?.push("follow-up");
  assert.deepEqual(sourceCard.nested.stats, ["atk"]);
  assert.equal(sourceCard.counters.get("charge"), 2);
  assert.deepEqual(game._simLuminarch.milestones, ["opening"]);
});
