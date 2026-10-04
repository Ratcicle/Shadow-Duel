import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Bot from "../../src/core/Bot.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { hashCanonicalGameState, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";

test("completed playback never starts an autonomous AI move", async t => {
  const file = process.env.PHASE_AI_REPLAY_FILE;
  assert.ok(file);
  const replay = validateCanonicalReplay(JSON.parse(readFileSync(file, "utf8")));
  const moves = t.mock.method(Bot.prototype, "makeMove");
  const result = await replayCanonicalDuel(replay);
  t.after(() => result.game.dispose?.());
  assert.equal(result.ok, true);
  assert.ok(replay.result);
  assert.equal(result.finalStateHash, replay.result.finalStateHash);
  assert.equal(result.game.decisionBroker.replayCursor, replay.decisions.length);
  const cursor = result.game.decisionBroker.replayCursor;
  // Let real callbacks queued by phase entry run after the driver has returned.
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(moves.mock.callCount(), 0, "playback must only execute recorded commands");
  assert.equal(result.game.decisionBroker.replayCursor, cursor);
  assert.equal(hashCanonicalGameState(result.game), result.finalStateHash);
});
