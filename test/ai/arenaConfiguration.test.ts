import assert from "node:assert/strict";
import test from "node:test";
import "../../scripts/register_node_asset_loader.js";
import Bot from "../../src/core/Bot.js";
import { botLogger } from "../../src/core/BotLogger.js";
import Game from "../../src/core/Game.js";
import ShadowHeartStrategy from "../../src/core/ai/ShadowHeartStrategy.js";
import { DuelTracker, END_REASONS } from "../../src/core/ai/ArenaAnalytics.js";
import type { ArenaCompletionStats, ArenaProgressStats, ArenaWinner } from "../../src/core/contracts/arena.js";
import { createMemoryStorage } from "../helpers/game.js";
import { required } from "../helpers/fixtures.js";
import { getStrategyFor } from "../../src/core/ai/StrategyRegistry.js";
import {
  getAvailableBotPresets,
  getBotDeckList,
  getBotExtraDeckList,
} from "../../src/core/bot/presets.js";

const { default: BotArena } = await import("../../src/core/BotArena.js");

test("unknown strategies and decks retain their distinct fallbacks", () => {
  const bot = new Bot();
  assert.ok(getStrategyFor("missing-preset", bot) instanceof ShadowHeartStrategy);
  assert.deepEqual(getBotDeckList("missing-preset"), getBotDeckList("luminarch"));
  assert.deepEqual(getBotExtraDeckList("missing-preset"), getBotExtraDeckList("luminarch"));
  const deck = getBotDeckList("luminarch");
  deck.length = 0;
  assert.ok(getBotDeckList("luminarch").length > 0);
  const presets = getAvailableBotPresets();
  presets[0]!.label = "changed copy";
  assert.equal(getAvailableBotPresets()[0]!.label, "Shadow-Heart");
  assert.equal(botLogger, null);
});

test("Arena speed presets retain shared mutable identity and custom precedence", () => {
  const arena = new BotArena(Game, Bot);
  const secondArena = new BotArena(Game, Bot);
  const normal = arena.getSpeedConfig("1x");
  assert.equal(arena.getSpeedConfig("unknown-speed"), normal);
  assert.equal(secondArena.getSpeedConfig("1x"), normal);
  assert.equal(Object.isFrozen(normal), false);
  const beamWidth = normal.planner.beamWidth;
  try {
    normal.planner.beamWidth = 19;
    assert.equal(secondArena.getPlannerConfig(normal).beamWidth, 19);
    arena.setSearchParams({ plannerBeamWidth: 7 });
    assert.equal(arena.getPlannerConfig(normal).beamWidth, 7);
    assert.equal(secondArena.getPlannerConfig(normal).beamWidth, 19);
  } finally {
    normal.planner.beamWidth = beamWidth;
  }
});

test("headless Arena installs AI seats and preserves its NullRenderer proxy", () => {
  const arena = new BotArena(Game, Bot);
  const game = arena.createGame("arcanist", "shadowheart", arena.getSpeedConfig("instant"), {
    main: [],
    extra: [],
  });
  assert.equal(game.player.id, "player");
  assert.equal(game.bot.id, "bot");
  assert.equal(game.player.controllerType, "ai");
  assert.equal(game.bot.controllerType, "ai");
  assert.equal(game.player.game, game);
  assert.equal(game.bot.game, game);
  assert.deepEqual(Object.keys(game.renderer!), []);
  assert.equal(Reflect.get(game.renderer!, "updateBoard"), Reflect.get(game.renderer!, "log"));
  assert.equal(game.disablePresentationDelays, true);
  assert.equal(game.phaseDelayMs, 0);
  assert.equal(game.aiActionDelayMs, 0);
  assert.equal(game.bindCardInteractions(), undefined);
});

test("a wall-clock timeout is never decided by LP while the turn limit still is", t => {
  const arena = new BotArena(Game, Bot);
  const game = arena.createGame("arcanist", "shadowheart", arena.getSpeedConfig("instant"), { main: [], extra: [] });
  assert.ok(game instanceof Game);
  t.after(() => game.dispose("arena_outcome_test"));
  game.player.lp = 8000;
  game.bot.lp = 100;
  assert.equal(arena.resolveWinner(game, { type: "draw", reason: END_REASONS.TIMEOUT }), "draw");
  assert.equal(arena.resolveWinner(game, { type: "draw", reason: END_REASONS.MAX_TURNS }), "player");
  game.bot.lp = 8000;
  assert.equal(arena.resolveWinner(game, { type: "draw", reason: END_REASONS.MAX_TURNS }), "draw");
});

test("timeouts stay out of Arena win-rate accounting and are reported separately", async t => {
  t.mock.method(console, "log", () => {});
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: createMemoryStorage() });
  t.after(() => {
    if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const arena = new BotArena(Game, Bot);
  // The timeout entry is what resolveWinner returns; the old LP adjudication would hand it to the bot.
  // Its turns and LP must not move any average either.
  const scripted: { winner: ArenaWinner; reason: string; turns: number; finalLP: { player: number; bot: number } }[] = [
    { winner: "player", reason: END_REASONS.LP_ZERO, turns: 8, finalLP: { player: 4000, bot: 0 } },
    { winner: "draw", reason: END_REASONS.TIMEOUT, turns: 41, finalLP: { player: 100, bot: 8000 } },
    { winner: "player", reason: END_REASONS.MAX_TURNS, turns: 12, finalLP: { player: 6000, bot: 2000 } },
  ];
  arena.runDuel = async (preset1, preset2, _speed, duelNumber) => {
    const entry = required(scripted[duelNumber - 1]);
    const tracker = new DuelTracker(duelNumber, preset1, preset2);
    tracker.setCurrentTurn(entry.turns);
    arena.analytics.recordDuel(tracker.finalize(entry.winner, entry.reason, entry.finalLP));
    return { duelNumber, winner: entry.winner, turns: entry.turns, type: entry.reason === END_REASONS.LP_ZERO ? "completed" : "draw",
      reason: entry.reason, totalTimeMs: 0, archetype1: preset1, archetype2: preset2 };
  };
  const progress: ArenaProgressStats[] = [];
  let completion: ArenaCompletionStats | null = null;
  await arena.startArena("arcanist", "shadowheart", scripted.length, "instant", false,
    stats => progress.push(stats), stats => { completion = stats; });

  const last = required(progress.at(-1));
  assert.deepEqual([last.completed, last.wins1, last.wins2, last.draws, last.drawsByTimeout, last.drawsByMaxTurns],
    [2, 2, 0, 0, 1, 0]);
  assert.equal(last.avgTurns, "10.0");
  const done = required<ArenaCompletionStats | null>(completion);
  assert.deepEqual([done.completed, done.avgTurns], [2, "10.0"], "progress and completion agree on the average");

  const batch = arena.analytics.getBatchStats();
  assert.deepEqual([batch.total, batch.wins1, batch.wins2, batch.draws, batch.notCompleted, batch.winRate1, batch.winRate2],
    [3, 2, 0, 0, 1, 100, 0]);
  assert.equal(batch.avgTurns, 10);
  const matchup = required(arena.analytics.getAllMatchupStats()["arcanist_vs_shadowheart"]);
  assert.deepEqual([matchup.total, matchup.draws, matchup.notCompleted, matchup.winRate1, matchup.winRate2],
    [3, 0, 1, "100.0", "0.0"]);
  assert.deepEqual([matchup.avgTurns, matchup.avgFinalLP], ["10.0", { player: "5000.0", bot: "1000.0" }]);
  const report = arena.exportStrategicReport();
  assert.equal(report.version, 6, "completed-only denominators are a new strategic report version");
  const strategic = required(report.matchups["arcanist_vs_shadowheart"]);
  assert.deepEqual([strategic.totalDuels, strategic.notCompleted, strategic.wins.draw, strategic.winRate.player],
    [3, 1, 0, 100]);
  assert.deepEqual([strategic.avgTurns, strategic.avgFinalLP], [10, { player: 5000, bot: 1000 }]);
  const seat = required(report.bots["player:arcanist"]);
  assert.deepEqual([seat.duels, seat.notCompleted, seat.wins, seat.winRate], [3, 1, 2, 100]);
  assert.deepEqual(report.duels.map(duel => duel.endReason),
    [END_REASONS.LP_ZERO, END_REASONS.TIMEOUT, END_REASONS.MAX_TURNS]);
});

test("a harness turn limit cannot be combined with canonical replay capture", () => {
  // Playback does not carry the limit, so a captured duel stopped by it would diverge.
  assert.throws(() => new Game({ captureReplay: true, maxTurnCounter: 4 }), RangeError);
  const game = new Game({ maxTurnCounter: 4 });
  assert.equal(game.maxTurnCounter, 4);
  game.dispose("turn_limit_capture_test");
});
