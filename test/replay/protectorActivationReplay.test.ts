import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MainPhaseSession } from "../../src/core/bot/mainPhaseSession.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { required } from "../helpers/fixtures.js";
import { createProtectorScenario, finishProtectorResponse, protectorEffect } from "../helpers/protector.js";

for (const seat of ["player", "bot"] as const) for (const response of ["decline", "respond", "no-threat"] as const) {
  test(`generated Protector captures and replays its response and position in another process (${seat}, ${response})`, async t => {
    const { game, live, actor, opponent, initialize, generatedAction } = createProtectorScenario(seat, true,
      { captureReplay: true }, response !== "no-threat");
    const directory = mkdtempSync(join(tmpdir(), "protector-replay-"));
    t.after(() => { game.dispose(); rmSync(directory, { recursive: true, force: true }); });
    await initialize();
    const source = required(actor.hand[0]), cost = required(actor.field[0]);
    const target = required(actor.field[1]), discard = required(opponent.hand[0]);
    let offered = 0;
    game.ui.showChainResponseModal = async candidates => {
      const candidate = candidates.find(candidate => candidate.card?.id === 27);
      if (!candidate || offered) return null;
      offered++;
      assert.ok(actor.hand.includes(source)); assert.ok(actor.graveyard.includes(cost));
      return response === "respond" ? candidate : null;
    };
    const session = new MainPhaseSession(actor, live, async () => {});
    const pending = session.execute(generatedAction(), session.capture());
    await finishProtectorResponse(game, pending, discard, target);
    assert.equal(await pending, true); assert.equal(offered, response === "no-threat" ? 0 : 1);
    assert.equal(source.position, "defense", "the generated choice survives public activation");
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(game.finalizeReplay({ reason: "protector-activation" }))));
    assert.deepEqual(replay.commands.map(command => command.type), ["activate_effect"]);
    const command = required(replay.commands[0]);
    assert.ok(command.type === "activate_effect");
    assert.equal(command.payload.effectId, protectorEffect);
    if (response !== "no-threat") assert.ok(replay.decisions.some(decision => decision.kind === "chain_response"));
    const replayPath = join(directory, "replay.json"), snapshotPath = join(directory, "snapshot.json");
    writeFileSync(replayPath, JSON.stringify(replay));
    writeFileSync(snapshotPath, JSON.stringify(createCanonicalStateSnapshot(game)));
    const worker = spawnSync(process.execPath, ["--import=tsx", "--import=./scripts/register_node_asset_loader.ts",
      fileURLToPath(new URL("../helpers/protectorReplayWorker.ts", import.meta.url)), seat, replayPath, snapshotPath, response],
    { cwd: process.cwd(), encoding: "utf8", timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(worker.status, 0, `${worker.error?.message || ""}\n${worker.stdout}\n${worker.stderr}`);
    assert.equal(replay.decisions.filter(decision => decision.kind === "choice").length, 1,
      "the AI's summon position is recorded for playback");
  });
}
