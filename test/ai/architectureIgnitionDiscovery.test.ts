import assert from "node:assert/strict";
import test from "node:test";
import { getGenericIgnitionEffectActions } from "../../src/core/ai/common/actionGeneration.js";
import { findIgnitionEffect, findIgnitionEffects } from "../../src/core/ai/common/effectDiscovery.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { createRuntimeGame } from "../helpers/game.js";
import { required } from "../helpers/fixtures.js";

for (const actor of ["bot", "player"] as const) {
  for (const discovery of ["singular", "multiple", "reject_first"] as const) {
    test(`ignition discovery preserves source/effect order and per-effect gates (${actor}/${discovery})`, t => {
      const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
      t.after(() => game.dispose("architecture_ignition_discovery"));
      const owner = game[actor];
      owner.hand.push(required(game.createCardForOwner(278, owner)));
      const state = createGameTreeCopy(game, owner).state;
      const source = required(state.bot.hand[0]);
      const declared = findIgnitionEffects(source, "hand");
      assert.deepEqual(declared.map(effect => effect.id), ["stelya_hand_banish_dragon_summon", "stelya_discard_search_dragon"]);
      const trace: string[] = [];
      const actions = getGenericIgnitionEffectActions({
        player: state.bot, entries: [{ card: source, sourceIndex: 4 }], type: "handIgnition", sourceZone: "hand",
        ...(discovery === "singular" ? { findEffect: () => findIgnitionEffect(source, "hand") } : {
          findEffects: () => declared,
          findEffect: () => { throw new Error("multi-effect discovery must not also visit the singular fallback"); },
        }),
        validateCandidate: ({ effect }) => {
          trace.push(`validate:${effect.id}`);
          return discovery !== "reject_first" || effect !== declared[0];
        },
        shouldActivate: (_card, _analysis, { effect }) => {
          trace.push(`policy:${effect.id}`);
          return { yes: true, priority: 7 };
        },
        buildActivationContext: (_card, _analysis, { effect }) => {
          trace.push(`context:${effect.id}`);
          return { activationZone: "hand", sourceZone: "hand" };
        },
        canActivate: ({ effect }) => { trace.push(`preview:${effect.id}`); return true; },
        includeEffectId: true,
      });
      const selected = discovery === "singular" ? declared.slice(0, 1) : discovery === "reject_first" ? declared.slice(1) : declared;
      assert.deepEqual(actions.map(action => action.effectId), selected.map(effect => effect.id));
      assert.ok(actions.every(action => action.index === 4 && action.cardId === source.id));
      assert.deepEqual(trace, (discovery === "singular" ? declared.slice(0, 1) : declared).flatMap(effect =>
        discovery === "reject_first" && effect === declared[0] ? [`validate:${effect.id}`] :
          ["validate", "policy", "context", "preview"].map(stage => `${stage}:${effect.id}`)));
      assert.equal(state.bot.hand[0], source);
      assert.equal(state._simOncePerTurn, undefined, "candidate discovery does not consume either effect's limit");
    });
  }
}
