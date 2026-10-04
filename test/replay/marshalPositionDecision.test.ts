import assert from "node:assert/strict";
import test from "node:test";
import type { BattlePositionInput } from "../../src/core/contracts/cards.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { marshalScenario, marshalEffectId } from "../helpers/marshalHandIgnition.js";

function declaration(scenario: ReturnType<typeof marshalScenario>, position: BattlePositionInput) {
  const start = scenario.game.startWithDecks.bind(scenario.game);
  scenario.game.startWithDecks = async options => {
    await start(options);
    // Forced variants are protocol controls; actual Marshal declares choice.
    for (const card of scenario.actor.hand) card.effects = card.effects.map(effect => effect.id === marshalEffectId
      ? { ...effect, actions: required(effect.actions).map(action => action.type === "conditional_summon_from_hand"
        ? { ...action, position } : action) } : effect);
  };
}

for (const seat of ["player", "bot"] as const) for (const human of [false, true]) {
  for (const position of ["choice", "attack", "defense"] as const) {
    test(`hand summon distinguishes declaration from AI preference (${seat}, human=${human}, ${position})`, async t => {
      const s = marshalScenario(seat, { human }), { game, actor } = s;
      t.after(() => game.dispose()); declaration(s, position); await s.initialize();
      game.ui.showChainResponseModal = async () => null;
      let prompts = 0;
      game.ui.showSpecialSummonPositionModal = (_card, choose) => { prompts++; choose("attack"); };
      const source = required(actor.hand[0]), action = s.generate();
      const result = await game.tryActivateMonsterEffect(source, null, "hand", actor, {
        effectId: marshalEffectId, activationContext: required(action.activationContext),
      });
      assert.equal(result.success, true); assert.equal(actor.lp, 6000);
      const expected = position === "choice" ? human ? "attack" : "defense" : position;
      assert.equal(source.position, expected);
      assert.equal(prompts, position === "choice" && human ? 1 : 0);
      const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(game.finalizeReplay({ reason: "marshal-position" }))));
      const choices = replay.decisions.filter(decision => decision.kind === "choice" && "candidateKey" in decision.value &&
        (decision.value.candidateKey === "attack" || decision.value.candidateKey === "defense"));
      assert.equal(choices.length, position === "choice" ? 1 : 0);
      if (position === "choice") assert.equal(Reflect.get(required(choices[0]).value, "candidateKey"), expected);
      assert.equal(replay.commands.filter(command => command.type === "activate_effect").length, 1);
      const p = marshalScenario(seat, { playback: true });
      t.after(() => p.game.dispose()); declaration(p, position);
      p.game.ui.showSpecialSummonPositionModal = () => assert.fail("replay must consume recorded position");
      p.game.ui.showChainResponseModal = async () => assert.fail("replay must consume recorded response");
      p.actor.strategy.chooseSpecialSummonPosition = () => assert.fail("replay must not recalculate position");
      const replayed = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(p.game,
        "Concrete Game with identical card declaration; human choice is replayed under AI control.") });
      assert.equal(replayed.ok, true);
      assert.deepEqual(createCanonicalStateSnapshot(p.game), createCanonicalStateSnapshot(game));
      assert.equal(p.game.decisionBroker.replayCursor, replay.decisions.length);
    });
  }
}
