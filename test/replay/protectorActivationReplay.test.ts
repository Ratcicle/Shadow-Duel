import assert from "node:assert/strict";
import test from "node:test";
import { MainPhaseSession } from "../../src/core/bot/mainPhaseSession.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { required } from "../helpers/fixtures.js";
import { setLocale } from "../../src/core/i18n.js";
import { createProtectorScenario, finishProtectorResponse, protectorEffect } from "../helpers/protector.js";
import { replayProtectorInAnotherGame } from "../helpers/protectorReplayWorker.js";

for (const seat of ["player", "bot"] as const) for (const response of ["decline", "respond", "no-threat"] as const) {
  test(`generated Protector captures and replays its response and position in another Game (${seat}, ${response})`, async t => {
    const { game, live, actor, opponent, initialize, generatedAction } = createProtectorScenario(seat, true,
      { captureReplay: true }, response !== "no-threat");
    t.after(() => { game.dispose(); setLocale("en"); });
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
    await replayProtectorInAnotherGame(seat, replay,
      JSON.parse(JSON.stringify(createCanonicalStateSnapshot(game))), response);
    assert.equal(replay.decisions.filter(decision => decision.kind === "choice").length, 1,
      "the AI's summon position is recorded for playback");
  });
}
