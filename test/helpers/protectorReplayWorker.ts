import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { setLocale } from "../../src/core/i18n.js";
import { required, unsafeFixture } from "./fixtures.js";
import { createProtectorScenario } from "./protector.js";

const seat = process.argv[2];
assert.ok(seat === "player" || seat === "bot");
const replay = validateCanonicalReplay(JSON.parse(readFileSync(required(process.argv[3]), "utf8")));
const expectedSnapshot: unknown = JSON.parse(readFileSync(required(process.argv[4]), "utf8"));
const { game, actor, opponent } = createProtectorScenario(seat, true, { replayMode: "playback" }, process.argv[5] !== "no-threat");
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
