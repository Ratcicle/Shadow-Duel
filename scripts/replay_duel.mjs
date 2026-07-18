import fs from "node:fs/promises";
import path from "node:path";
import { replayCanonicalDuel } from "../src/core/game/replay/driver.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/replay_duel.mjs <replay.json>");
  process.exitCode = 2;
} else {
  try {
    const absolute = path.resolve(process.cwd(), file);
    const replay = JSON.parse(await fs.readFile(absolute, "utf8"));
    const result = await replayCanonicalDuel(replay);
    console.log(
      `Replay OK: ${result.commands} commands, final hash ${result.finalStateHash}.`,
    );
    result.game?.dispose?.("replay_complete");
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}

