import assert from "node:assert/strict";
import type { PlayerId } from "../../src/core/contracts/primitives.js";
import type { CanonicalReplay, ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { setLocale } from "../../src/core/i18n.js";
import { required, unsafeFixture } from "./fixtures.js";
import { createProtectorScenario } from "./protector.js";

/**
 * Replays a Protector recording in another Game with the same scenario, in
 * PT-BR, without UI or AI recomputation. The caller restores the locale.
 */
export async function replayProtectorInAnotherGame(seat: PlayerId, recorded: CanonicalReplay,
  expectedSnapshot: unknown, response: "decline" | "respond" | "no-threat") {
  // The JSON round trip keeps the boundary of a saved replay file.
  const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(recorded)));
  const { game, actor, opponent } = createProtectorScenario(seat, true, { replayMode: "playback" }, response !== "no-threat");
  try {
    setLocale("pt-br");
    const forbidden = () => assert.fail("playback must consume decisions without UI or AI recomputation");
    game.ui.showChainResponseModal = async () => forbidden();
    game.ui.showTargetSelection = forbidden;
    game.ui.showSpecialSummonPositionModal = forbidden;
    game.autoSelector.select = forbidden;
    for (const player of [actor, opponent]) {
      required(player.strategy).chooseSpecialSummonPosition = forbidden;
      required(player.strategy).chooseChainResponse = forbidden;
    }
    const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(game,
      "Concrete Game supplies the canonical driver with real runtime cards and players.") });
    assert.equal(result.ok, true);
    assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(game.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(createCanonicalStateSnapshot(game), expectedSnapshot);
  } finally { game.dispose(); }
}
