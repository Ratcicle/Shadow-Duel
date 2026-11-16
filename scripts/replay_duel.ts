import fs from "node:fs/promises";
import path from "node:path";
import { replayCanonicalDuel } from "../src/core/game/replay/driver.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run replay -- <replay.json>");
  process.exitCode = 2;
} else {
  try {
    const absolute = path.resolve(process.cwd(), file);
    const replay: unknown = JSON.parse(await fs.readFile(absolute, "utf8"));
    // The driver's own Game plays back strictly: its seats keep only the
    // recorded controllers and throw if a strategy is consulted.
    const result = await replayCanonicalDuel(replay);
    const seats = `player=${result.game.player.controllerType ?? "human"}, bot=${result.game.bot.controllerType ?? "ai"}`;
    console.log(
      `Replay OK (strict playback; seats ${seats}): ${result.commands} commands, final hash ${result.finalStateHash}.`,
    );
    // The replay port intentionally exposes only zero-argument disposal; the
    // concrete Game also accepts this diagnostic reason.
    const game: { dispose?(reason?: string): void } | undefined = result.game;
    game?.dispose?.("replay_complete");
  } catch (error) {
    console.error(
      error instanceof Error ? error.stack || error.message : String(error),
    );
    process.exitCode = 1;
  }
}
