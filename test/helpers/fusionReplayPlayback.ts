import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Game from "../../src/core/Game.js";
import EffectEngine from "../../src/core/EffectEngine.js";
import AutoSelector from "../../src/core/AutoSelector.js";
import { createCanonicalStateSnapshot } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";

// The driver creates the Game from JSON. No setup hook or controller override.
const fusionGuard: EffectEngine["performBotFusion"] = async () => assert.fail("Playback recomputed fusion policy");
const positionGuard: EffectEngine["chooseSpecialSummonPosition"] = async () => assert.fail("Playback recomputed position policy/UI");
Object.defineProperty(EffectEngine.prototype, "performBotFusion", { value: fusionGuard });
Object.defineProperty(EffectEngine.prototype, "chooseSpecialSummonPosition", { value: positionGuard });
AutoSelector.prototype.select = () => assert.fail("Playback recomputed generic AI selection");
Game.prototype.startTargetSelectionSession = () => assert.fail("Playback opened a human selection session");
const result = await replayCanonicalDuel(JSON.parse(readFileSync(0, "utf8")));
console.log("FUSION_REPLAY_RESULT " + JSON.stringify({ snapshot: createCanonicalStateSnapshot(result.game),
  cursor: result.game.decisionBroker.replayCursor, finalStateHash: result.finalStateHash }));
result.game.dispose?.();
