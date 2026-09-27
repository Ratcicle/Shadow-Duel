import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test, { type TestContext } from "node:test";
import "../../scripts/register_node_asset_loader.js";
import Bot from "../../src/core/Bot.js";
import Game from "../../src/core/Game.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import type { ArenaDuelResult } from "../../src/core/contracts/arena.js";
import { createMemoryStorage } from "../helpers/game.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";

const { default: BotArena } = await import("../../src/core/BotArena.js");
const emptyDeck = { main: [], extra: [] };

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
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: createMemoryStorage() });
  t.after(() => {
    if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  class InitializedGame extends Game {
    override async start() {
      await this.startWithDecks({ initializeOnly: true });
      this.gameOver = true;
    }
  }
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

test("smoke CLI rejects a malformed seed before attempting a matchup", () => {
  const result = spawnSync(process.execPath, ["--import=tsx", "--import=./scripts/register_node_asset_loader.ts",
    "scripts/run_bot_arena_smoke.ts", "--seed", "invalid", "--matchup", ":"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /seed.*integer.*4294967295/i);
});
