import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import Game from "../../src/core/Game.js";
import EffectEngine from "../../src/core/EffectEngine.js";
import AutoSelector from "../../src/core/AutoSelector.js";
import { createCanonicalStateSnapshot } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";

/**
 * Replays a fusion recording in a Game the driver creates from the JSON alone:
 * no setup hook or controller override. Any policy, UI or AI recomputation
 * fails the replay; the guards are restored before returning.
 */
export async function replayFusionInAnotherGame(t: TestContext, replay: unknown) {
  const guards = [
    t.mock.method(EffectEngine.prototype, "performBotFusion",
      async () => assert.fail("Playback recomputed fusion policy")),
    t.mock.method(EffectEngine.prototype, "chooseSpecialSummonPosition",
      async () => assert.fail("Playback recomputed position policy/UI")),
    t.mock.method(AutoSelector.prototype, "select", () => assert.fail("Playback recomputed generic AI selection")),
    t.mock.method(Game.prototype, "startTargetSelectionSession",
      () => assert.fail("Playback opened a human selection session")),
  ];
  try {
    // The JSON round trip keeps the boundary of a saved replay file.
    const result = await replayCanonicalDuel(JSON.parse(JSON.stringify(replay)));
    try {
      return {
        snapshot: createCanonicalStateSnapshot(result.game),
        cursor: result.game.decisionBroker.replayCursor,
        finalStateHash: result.finalStateHash,
      };
    } finally {
      result.game.dispose?.();
    }
  } finally {
    for (const guard of guards) guard.mock.restore();
  }
}
