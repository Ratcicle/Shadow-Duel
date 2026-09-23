import assert from "node:assert/strict";
import test from "node:test";
import "../../scripts/register_node_asset_loader.js";
import Bot from "../../src/core/Bot.js";
import { botLogger } from "../../src/core/BotLogger.js";
import Game from "../../src/core/Game.js";
import ShadowHeartStrategy from "../../src/core/ai/ShadowHeartStrategy.js";
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
