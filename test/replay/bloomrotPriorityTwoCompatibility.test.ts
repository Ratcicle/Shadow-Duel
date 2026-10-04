import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_REPLAY_ENGINE_VERSION, type ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, getCardDatabaseSignature, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame } from "../helpers/game.js";

test("P2 schema 2 rejects v15 and the old declaration signature independently before mutation", async t => {
  assert.equal(CANONICAL_REPLAY_ENGINE_VERSION, "engine-rules-v18");
  const live = createRuntimeGame({ captureReplay: true, laboratoryMode: true });
  const playback = createRuntimeGame({ replayMode: "playback", laboratoryMode: true });
  t.after(() => { live.dispose(); playback.dispose(); });
  const valid = live.finalizeReplay({ reason: "p2-compatibility" });
  assert.ok(valid);
  assert.equal(valid.schemaVersion, 2);
  assert.equal(valid.cardDatabaseSignature, getCardDatabaseSignature());
  assert.notEqual(valid.cardDatabaseSignature, "0f2a7a85");
  const before = createCanonicalStateSnapshot(playback);
  for (const [invalid, message] of [
    [{ ...valid, engineVersion: "engine-rules-v15" }, /engineVersion/],
    [{ ...valid, cardDatabaseSignature: "0f2a7a85" }, /card database signature/],
  ] as const) {
    assert.throws(() => validateCanonicalReplay(invalid), message);
    await assert.rejects(() => replayCanonicalDuel(invalid, {
      game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game supplies canonical replay ports."),
    }), message);
    assert.deepEqual(createCanonicalStateSnapshot(playback), before);
  }
});
