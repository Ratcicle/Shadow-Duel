import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Game from "../../src/core/Game.js";
import Bot from "../../src/core/Bot.js";
import { validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { hasCommandInFlight } from "../../src/core/game/replay/capture.js";

const deck = [3, 3, 3, 4, 4, 4, 5, 5, 5, 7, 7, 7, 8, 8, 9, 9, 9, 1, 1, 1];
const modes = ["lifecycle-skip", "lifecycle-next", "transition-skip", "transition-next", "human-control"] as const;
for (const mode of modes) test(`phase scheduling preserves fresh playback after ${mode}`, async t => {
  const directory = mkdtempSync(join(tmpdir(), "shadow-duel-phase-replay-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const live = new Game({ captureReplay: true, randomSeed: 9401, chainResponseTimeoutMs: 0 });
  t.after(() => live.dispose());
  live.phaseDelayMs = 0;
  await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
    startAtDrawPhase: true, announceStartingPlayer: false,
    startingPlayer: mode.startsWith("transition") ? "bot" : "player",
    playerDeck: deck, botDeck: deck, playerExtraDeck: [], botExtraDeck: [] });
  if (mode === "transition-next") { await live.nextPhase(); await live.nextPhase(); }
  else await live.skipToPhase("main1");
  if (!mode.startsWith("transition")) {
    assert.equal(live.player.hand[0]?.id, 1);
    await live.performNormalSummon(live.player, 0, "attack", false);
    if (mode === "lifecycle-skip") await live.skipToPhase("end");
    else if (mode === "lifecycle-next") {
      for (let index = 0; live.turn === "player" && index < 6; index++) await live.nextPhase();
      assert.equal(live.turn, "bot");
    }
  }
  const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: mode }))));
  live.dispose();
  if (!mode.startsWith("transition")) assert.equal(replay.decisions.length, 1);
  const file = join(directory, "replay.json");
  writeFileSync(file, JSON.stringify(replay));
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ["--import=tsx", "--import=./scripts/register_node_asset_loader.ts",
    "--test", "--test-concurrency=1", fileURLToPath(new URL("../helpers/replayPhaseAiWorker.ts", import.meta.url))],
  { encoding: "utf8", timeout: 15000, env: { ...environment, PHASE_AI_REPLAY_FILE: file } });
  assert.equal(child.status, 0, child.stdout + child.stderr);
});

for (const entry of ["transition", "lifecycle"] as const) {
  for (const invalidator of ["none", "playback", "dispose"] as const) {
    test(`live AI scheduling through ${entry} respects ${invalidator}`, async t => {
      const game = new Game({ captureReplay: false, chainResponseTimeoutMs: 0 });
      t.after(() => game.dispose());
      const moves = t.mock.method(Bot.prototype, "makeMove", async () => {});
      game.phaseDelayMs = 0;
      await game.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
        startAtDrawPhase: true, announceStartingPlayer: false, startingPlayer: "bot",
        playerDeck: deck, botDeck: deck, playerExtraDeck: [], botExtraDeck: [] });
      if (entry === "transition") await game.skipToPhase("main1");
      else await game.startTurn();
      if (invalidator === "playback") game.replayMode = "playback";
      if (invalidator === "dispose") game.dispose();
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(moves.mock.callCount(), invalidator === "none" ? 1 : 0);
    });
  }
}

test("an AI move scheduled by a turn change waits for that command to settle", async t => {
  const game = new Game({ captureReplay: true, randomSeed: 9402, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.phaseDelayMs = 0;
  const calls: boolean[] = [];
  t.mock.method(Bot.prototype, "makeMove", async () => { calls.push(hasCommandInFlight(game)); });
  await game.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
    startAtDrawPhase: true, announceStartingPlayer: false, startingPlayer: "player",
    playerDeck: deck, botDeck: deck, playerExtraDeck: [], botExtraDeck: [] });
  // Ending the turn schedules the bot's move; the command keeps running after it.
  const endTurn = game.endTurn.bind(game);
  game.endTurn = async () => {
    const result = await endTurn();
    await new Promise(resolve => setTimeout(resolve, 20));
    return result;
  };
  await game.skipToPhase("end");
  assert.equal(game.turn, "bot");
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(calls, [false], "the bot acts once, after the turn change settled");
});
