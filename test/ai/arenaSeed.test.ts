import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test, { type TestContext } from "node:test";
import "../../scripts/register_node_asset_loader.js";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import type { ArenaDuelResult } from "../../src/core/contracts/arena.js";
import { createMemoryStorage } from "../helpers/game.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";

const { default: BotArena } = await import("../../src/core/BotArena.js");
const emptyDeck = { main: [], extra: [] };

/** Initializes the duel, then ends it through the Game's own turn limit. */
class InitializedGame extends Game {
  override async start() {
    await this.startWithDecks({ initializeOnly: true });
    this.turnCounter = required(this.maxTurnCounter, "Arena turn limit");
    await this.startTurn();
  }
}

function useMemoryStorage(t: TestContext) {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: createMemoryStorage() });
  t.after(() => {
    if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
}

function createSeededGame(t: TestContext, seed: number | null, duelNumber = 1, swapped = false) {
  const arena = new BotArena(Game, Bot);
  arena.setSearchParams({ randomSeed: seed });
  const game = arena.createGame(swapped ? "shadowheart" : "techzero",
    swapped ? "techzero" : "shadowheart", arena.getSpeedConfig("instant"), emptyDeck, duelNumber);
  assert.ok(game instanceof Game);
  t.after(() => game.dispose("arena_seed_test"));
  return { arena, game };
}

test("Arena derives a distinct uint32 seed per duel and keeps seat counterparts aligned", t => {
  for (const [base, expected] of [[42, [42, 43, 44]], [0, [0, 1, 2]], [0xffffffff, [0xffffffff, 0, 1]]] as const) {
    for (let index = 0; index < expected.length; index += 1) {
      const first = createSeededGame(t, base, index + 1);
      const counterpart = createSeededGame(t, base, index + 1, true);
      assert.equal(first.game.randomSeed, expected[index]);
      assert.equal(counterpart.game.randomSeed, first.game.randomSeed);
    }
  }
});

test("Arena rejects invalid seeds and preserves the Game default when omitted or cleared", t => {
  const arena = new BotArena(Game, Bot);
  for (const randomSeed of [-1, 1.5, 0x100000000, NaN, Infinity]) {
    assert.throws(() => arena.setSearchParams({ randomSeed }), /seed.*integer.*4294967295/i);
  }
  t.mock.method(Date, "now", () => 123456789);
  for (const reset of [false, true]) {
    if (reset) {
      arena.setSearchParams({ randomSeed: 0 });
      arena.setSearchParams({ randomSeed: null });
    }
    const game = arena.createGame("techzero", "shadowheart", arena.getSpeedConfig("instant"), emptyDeck);
    assert.ok(game instanceof Game);
    t.after(() => game.dispose("arena_default_seed_test"));
    assert.equal(game.randomSeed, 123456789);
  }
});

/** Process-global ids change digit count between runs; decisions must not depend on it. */
function pushInstanceIdsPastNextPowerOfTen() {
  const probe = new Card(cardDefinition(501), "bot");
  const target = 10 ** String(probe.instanceId).length;
  while (new Card(cardDefinition(501), "bot").instanceId < target) { /* advance the shared counter */ }
}

function setupSnapshot(game: Game) {
  return {
    firstSeat: game.turn,
    seats: [game.player, game.bot].map(player => ({
      hand: player.hand.map(card => card.id),
      deck: player.deck.map(card => card.id),
      extraDeck: player.extraDeck.map(card => card.id),
    })),
  };
}

test("repeating an Arena seed reproduces setup and the bounded Tech-Zero decision in each seat", async t => {
  t.mock.method(console, "log", () => {});
  for (const swapped of [false, true]) {
    const runs = [];
    for (let repeat = 0; repeat < 2; repeat += 1) {
      if (repeat > 0) pushInstanceIdsPastNextPowerOfTen();
      const { game } = createSeededGame(t, 20260926, 3, swapped);
      await game.startWithDecks({ initializeOnly: true });
      const setup = setupSnapshot(game);
      const bot = swapped ? game.bot : game.player;
      assert.ok(bot instanceof Bot);
      game.turn = bot.id;
      game.phase = "main1";
      game.turnCounter = 2;
      const state = bot.cloneGameState(unsafeFixture<BotCloneGamePort>(game,
        "Concrete Game supplies the snapshot capabilities hidden by the Arena Game port"));
      const profile = { ...required(bot.strategy.getPlanningProfile).call(bot.strategy, state), nodeBudget: 12 };
      const decision = required(await turnLineSearch(state, bot.strategy, { ...profile, profile }));
      // Runtime instance IDs are process-global; compare references by their
      // exact seat/zone/index within this independently initialized scenario.
      const references = new Map<number | string, string>();
      for (const seat of [state.player, state.bot]) {
        for (const zone of ["hand", "deck", "extraDeck"] as const) {
          seat[zone]?.forEach((card, index) => {
            if (card?.instanceId != null) references.set(card.instanceId, `${seat.id}:${zone}:${index}:${card.id}`);
          });
        }
      }
      const normalized = JSON.stringify(decision.action, (key: string, value: unknown) => {
        if ((key === "selections" || key === "specialSummons") && value && typeof value === "object") {
          return Object.fromEntries(Object.entries(value).map(([target, ids]: [string, unknown]) => {
            assert.ok(Array.isArray(ids));
            return [target, ids.map((id: unknown) => {
              assert.ok(typeof id === "number" || typeof id === "string");
              return required(references.get(id));
            })];
          }));
        }
        if (/instanceId$/i.test(key) && (typeof value === "number" || typeof value === "string")) {
          return required(references.get(value), `action must reference a scenario card: ${value}`);
        }
        if (/instanceIds$/i.test(key) && Array.isArray(value)) {
          return value.map((id: number | string) => required(references.get(id)));
        }
        return value;
      });
      runs.push({ setup, action: normalized });
    }
    assert.deepEqual(runs[0], runs[1]);
  }
});

test("Arena progress and analytics retain each derived duel seed", async t => {
  t.mock.method(console, "log", () => {});
  useMemoryStorage(t);
  const arena = new BotArena(InitializedGame, Bot);
  arena.setSearchParams({ randomSeed: 900 });
  const results: ArenaDuelResult[] = [];
  await arena.startArena("techzero", "shadowheart", 2, "instant", false,
    progress => results.push(progress.lastResult));
  assert.deepEqual(results.map(result => result.randomSeed), [900, 901]);
  const records = arena.getAnalytics().duelRecords;
  assert.deepEqual(records.map(record => record.seed), [900, 901]);
  assert.deepEqual(arena.exportStrategicReport().duels.map(duel => duel.seed), [900, 901]);
});

test("an unseeded Arena records the seed each Game actually used", async t => {
  t.mock.method(console, "log", () => {});
  useMemoryStorage(t);
  const games: Game[] = [];
  class RecordedGame extends InitializedGame {
    override async start() {
      games.push(this);
      await super.start();
    }
  }
  const arena = new BotArena(RecordedGame, Bot);
  const results: ArenaDuelResult[] = [];
  await arena.startArena("techzero", "shadowheart", 2, "instant", false,
    progress => results.push(progress.lastResult));
  const seeds = games.map(game => game.randomSeed);
  assert.equal(seeds.length, 2);
  for (const seed of seeds) assert.equal(typeof seed, "number");
  assert.deepEqual(results.map(result => result.randomSeed), seeds);
  assert.deepEqual(arena.getAnalytics().duelRecords.map(record => record.seed), seeds);
  assert.deepEqual(arena.exportStrategicReport().duels.map(duel => duel.seed), seeds);
});

test("an unseeded Arena duel that fails after the game ends still records its seed", async t => {
  t.mock.method(console, "log", () => {});
  useMemoryStorage(t);
  const games: Game[] = [];
  class RecordedGame extends InitializedGame {
    override async start() {
      games.push(this);
      await super.start();
    }
  }
  const arena = new BotArena(RecordedGame, Bot);
  const recordDuel = arena.analytics.recordDuel.bind(arena.analytics);
  let calls = 0;
  t.mock.method(arena.analytics, "recordDuel", (...args: Parameters<typeof recordDuel>) => {
    calls += 1;
    if (calls === 1) throw new Error("analytics failure after the duel ended");
    return recordDuel(...args);
  });
  const results: ArenaDuelResult[] = [];
  await arena.startArena("techzero", "shadowheart", 1, "instant", false,
    progress => results.push(progress.lastResult));
  const seed = required(games[0]).randomSeed;
  assert.equal(typeof seed, "number");
  const result = required(results[0]);
  assert.equal(result.type, "error");
  assert.equal(result.randomSeed, seed);
  assert.deepEqual(arena.getAnalytics().duelRecords.map(record => record.seed), [seed]);
});

test("an Arena duel plays exactly the turn limit and never starts the next turn", async t => {
  t.mock.method(console, "log", () => {});
  useMemoryStorage(t);
  const games: Game[] = [];
  const standbyPhases: number[] = [];
  const endPhases: number[] = [];
  class ObservedGame extends Game {
    override async start() {
      games.push(this);
      this.on("standby_phase", () => standbyPhases.push(this.turnCounter));
      this.on("end_phase", () => endPhases.push(this.turnCounter));
      return await super.start();
    }
  }
  const arena = new BotArena(ObservedGame, Bot);
  arena.maxTurns = 1;
  arena.setSearchParams({ randomSeed: 20261009 });
  const results: ArenaDuelResult[] = [];
  await arena.startArena("techzero", "shadowheart", 1, "instant", false,
    progress => results.push(progress.lastResult));
  const game = required(games[0]);
  t.after(() => game.dispose("arena_turn_limit_test"));
  const result = required(results[0]);
  assert.ok(result.type !== "cancelled");
  assert.equal(result.reason, "max_turns");
  assert.equal(result.turns, 1);
  assert.equal(game.turnCounter, 1);
  assert.equal(game.gameOver, true);
  assert.deepEqual(endPhases, [1], "the limited turn reaches its End Phase");
  assert.deepEqual(standbyPhases, [1], "no Standby Phase of turn 2");
  assert.equal(arena.getAnalytics().duelRecords[0]?.turns, 1);
});

test("smoke CLI rejects a malformed seed before attempting a matchup", () => {
  const result = spawnSync(process.execPath, ["--import=tsx", "--import=./scripts/register_node_asset_loader.ts",
    "scripts/run_bot_arena_smoke.ts", "--seed", "invalid", "--matchup", ":"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /seed.*integer.*4294967295/i);
});
