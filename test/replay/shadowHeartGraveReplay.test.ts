import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeGame } from "../helpers/game.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";

test("canonical driver replays Grave without a duplicate external summon command or live UI", async (t) => {
  const live = createRuntimeGame({ captureReplay: true, disableChains: true, randomSeed: 16, laboratoryMode: true, laboratoryUseBot: false,
    getFieldPlacementMode: () => "manual", fieldPlacementProvider: async request => ({ outcome: "chosen", slot: required(request.candidates[0]).slot }) });
  const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", disableChains: true, laboratoryMode: true, laboratoryUseBot: false });
  t.after(() => { live.dispose(); playback.dispose(); });
  live.phaseDelayMs = 0;
  playback.phaseDelayMs = 0;
  await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startingPlayer: "player", announceStartingPlayer: false,
    playerDeck: [...Array<number>(12).fill(107), 107, 107, 107, 126], botDeck: Array<number>(16).fill(1), playerExtraDeck: [], botExtraDeck: [] });
  live.phase = "main1";
  live.recordReplayCommand({ type: "set_phase", actorId: "player", payload: { phase: "main1" } });
  const source = required(live.player.hand.find(c => c.id === 126));
  await live.setSpellOrTrap(source, live.player.hand.indexOf(source), live.player);
  await live.skipToPhase("end");
  await live.skipToPhase("end");
  assert.equal(live.turn, "player");
  live.ui.showTrapActivationModal = async () => true;
  const pending = live.tryActivateSpellTrapEffect(source);
  for (let i = 0; i < 100 && !live.targetSelection; i++) await new Promise<void>(resolve => setTimeout(resolve, 10));
  const session = required(live.targetSelection);
  const requirement = required(session.requirements[0]);
  session.selections[requirement.id] = [required(requirement.candidates[0]).key];
  await live.finishTargetSelection();
  assert.equal((await pending).success, true);
  const replay = validateCanonicalReplay(live.finalizeReplay({ reason: "test" }));
  assert.equal(replay.commands.filter(c => c.type === "summon").length, 0);
  assert.equal(replay.commands.filter(c => c.type === "activate_effect").length, 1);
  const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Real headless Game replay driver integration.") });
  assert.equal(result.ok, true);
  assert.equal(result.finalStateHash, replay.result?.finalStateHash);
  assert.equal(playback.player.field[0]?.id, 107);
});
