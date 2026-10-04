import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_REPLAY_ENGINE_VERSION, type ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, getCardDatabaseSignature, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame } from "../helpers/game.js";

for (const incompatible of ["version", "declaration"] as const) {
  test(`T01 schema 2 rejects the prior ${incompatible} before changing the game`, async t => {
    assert.equal(CANONICAL_REPLAY_ENGINE_VERSION, "engine-rules-v18");
    const live = createRuntimeGame({ captureReplay: true, laboratoryMode: true });
    const playback = createRuntimeGame({ replayMode: "playback", laboratoryMode: true });
    t.after(() => { live.dispose(); playback.dispose(); });
    const valid = live.finalizeReplay({ reason: "resolution-choice-compatibility" });
    assert.ok(valid);
    assert.equal(valid.schemaVersion, 2);
    assert.equal(valid.cardDatabaseSignature, getCardDatabaseSignature());
    assert.notEqual(valid.cardDatabaseSignature, "e1469707");
    const invalid = incompatible === "version"
      ? { ...valid, engineVersion: "engine-rules-v16" }
      : { ...valid, cardDatabaseSignature: "e1469707" };
    const message = incompatible === "version" ? /engineVersion/ : /card database signature/;
    const before = createCanonicalStateSnapshot(playback);
    assert.throws(() => validateCanonicalReplay(invalid), message);
    await assert.rejects(() => replayCanonicalDuel(invalid, {
      game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game supplies canonical replay ports."),
    }), message);
    assert.deepEqual(createCanonicalStateSnapshot(playback), before);
  });
}
