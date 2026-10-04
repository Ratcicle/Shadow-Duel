import assert from "node:assert/strict";
import test from "node:test";
import { MainPhaseSession } from "../../src/core/bot/mainPhaseSession.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections } from "../helpers/game.js";
import { marshalScenario, marshalEffectId } from "../helpers/marshalHandIgnition.js";

for (const seat of ["player", "bot"] as const) {
  for (const mode of ["pass", "respond", "late-full"] as const) {
    test(`generated hand ignition captures its command and preserves costs (${seat}/${mode})`, async t => {
      const s = marshalScenario(seat, { full: mode === "late-full" });
      const { game, live, actor, opponent } = s;
      t.after(() => game.dispose()); await s.initialize();
      const source = required(actor.hand[0]), twin = required(actor.hand[1]);
      const target = required(actor.field[0]), discard = required(opponent.hand[0]);
      const baseline = createCanonicalStateSnapshot(game), action = s.generate();
      assert.deepEqual(createCanonicalStateSnapshot(game), baseline, "generation does not pay the cost");
      let offered = false, activated = 0;
      const payments: number[] = [];
      game.on("lp_change", event => { if (event.sourceCard === source) payments.push(required(event.lpPaid)); });
      game.on("effect_activated", event => { if (event.effectId === marshalEffectId) activated++; });
      game.ui.showConfirmPrompt = async () => false;
      const choose = async <Candidate extends { card?: object | null }>(candidates: readonly Candidate[]): Promise<Candidate | null> => {
        const candidate = candidates.find(candidate => candidate.card === (mode === "late-full" ? actor.spellTrap[0] : opponent.field[0]));
        if (!candidate || offered) return null;
        offered = true;
        assert.equal(actor.lp, 6000); assert.ok(actor.hand.includes(source));
        assert.equal(game.chainSystem.getLastChainLink()?.costPayment?.status, "paid");
        return mode === "pass" ? null : candidate;
      };
      game.ui.showChainResponseModal = choose;
      if (mode === "late-full") game.chainSystem.botChooseChainResponse = async (_player, candidates) => choose(candidates);
      const session = new MainPhaseSession(actor, live, async () => {});
      const execution = session.execute(action, session.capture());
      await completeTestSelections(game, execution);
      assert.equal(await execution, mode !== "late-full");
      assert.deepEqual(payments, [2000]); assert.equal(activated, 1); assert.equal(offered, true);
      assert.ok(actor.hand.includes(twin));
      assert.equal(actor.hand.includes(source), mode === "late-full");
      if (mode === "respond") { assert.equal(target.isFacedown, true); assert.ok(opponent.graveyard.includes(discard)); }
      if (mode === "late-full") assert.equal(actor.field.length, 5);
      else assert.equal(source.position, "defense", "generated preference is preserved");
      const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(game.finalizeReplay({ reason: "marshal-command" }))));
      assert.equal(replay.commands.filter(command => command.type === "activate_effect").length, 1);
      assert.equal(replay.commands.length, 1, "the canonical ingress records exactly once");
      // Successful summoning's missing position choice is tracked separately as
      // D8C4-02. The post-cost full-field failure reaches no position choice.
      if (mode === "late-full") {
        const p = marshalScenario(seat, { full: true, playback: true });
        t.after(() => p.game.dispose());
        p.game.ui.showChainResponseModal = async () => assert.fail("replay must consume recorded response");
        p.game.autoSelector.select = () => assert.fail("replay must consume recorded selection");
        const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(p.game,
          "Concrete Game with the same deterministic initialization.") });
        assert.equal(result.ok, true);
        assert.deepEqual(createCanonicalStateSnapshot(p.game), createCanonicalStateSnapshot(game));
        assert.equal(p.game.decisionBroker.replayCursor, replay.decisions.length);
      }
    });
  }

  for (const invalidator of ["lp", "source-left", "disabled"] as const) {
    test(`hand ignition revalidates ${invalidator} before paying (${seat})`, async t => {
      const s = marshalScenario(seat), { game, actor, live } = s;
      t.after(() => game.dispose()); await s.initialize();
      game.ui.showChainResponseModal = async () => null;
      const source = required(actor.hand[0]), twin = required(actor.hand[1]), action = s.generate();
      const session = new MainPhaseSession(actor, live, async () => {}), captured = session.capture();
      if (invalidator === "lp") actor.takeDamage(6501, { suppressVisual: true });
      if (invalidator === "source-left") await game.moveCard(source, actor, "graveyard", { fromZone: "hand" });
      if (invalidator === "disabled") game.disableEffectActivation = true;
      const lp = actor.lp;
      assert.equal(await (invalidator === "source-left" ? session.execute(action, captured) : actor.executeMainPhaseAction(live, action)), false);
      assert.equal(actor.lp, lp); assert.ok(actor.hand.includes(twin));
      assert.equal(game.chainSystem.chainStack.length, 0); assert.equal(game.targetSelection, null);
    });
  }
}
