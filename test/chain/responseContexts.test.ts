import assert from "node:assert/strict";
import test from "node:test";
import type { ChainCard, ChainSelectionMap, ChainSelectionValue, FastEffectContextInput } from "../../src/core/contracts/chainRuntime.js";
import { required } from "../helpers/fixtures.js";
import { createChainHarness, createTestCard, createTestEffect, placeCard } from "./helpers/chainHarness.js";

function setup(targets: ChainCard[] = []) {
  const harness = createChainHarness({ turnCounter: 4 });
  const { chain, player, bot } = harness;
  const originalTarget = createTestCard({ instanceId: 800, name: "Original target" });
  const source = createTestCard({ instanceId: 801, name: "Latest source" });
  const cost = createTestCard({ instanceId: 802, name: "Cost" });
  const reference = createTestCard({ instanceId: 803, name: "Reference" });
  placeCard(bot, "field", originalTarget); placeCard(bot, "field", source);
  for (const target of targets) placeCard(player, "field", target);
  const original: FastEffectContextInput = { type: "effect_targeted", event: "effect_targeted",
    card: originalTarget, player, controller: player, target: originalTarget, targets: [originalTarget], targetOwner: bot };
  const effect = createTestEffect({ id: "latest_effect", speed: 2, isQuickEffect: true,
    targets: [
      { id: "actual", owner: "opponent", zone: "field", count: { min: 0, max: 3 } },
      { id: "cost", intent: "cost", owner: "self", zone: "hand", count: { min: 1, max: 1 } },
      { id: "reference", intent: "reference", targetFromContext: "target", count: { min: 1, max: 1 } },
    ] });
  const targetSelections: ChainSelectionMap & Record<string, ChainSelectionValue> = {
    actual: targets, cost: [cost], reference: [reference],
  };
  const link = required(chain.addToChain(chain.createPreparedActivation({ card: source, controller: bot, effect,
    activationZone: "field", targetSelections,
    committed: true, costsPaid: true })));
  return { ...harness, source, originalTarget, original, link, cost, reference };
}

test("current activation context replaces old targets and excludes costs/references", () => {
  const first = createTestCard({ instanceId: 810, name: "First current target" });
  const second = createTestCard({ instanceId: 811, name: "Second current target" });
  const { chain, player, bot, source, original, originalTarget, link } = setup([first, second]);
  const current = required(chain.getCurrentChainActivationContext(original));
  assert.equal(current.type, "effect_activation");
  assert.equal(current.card, source); assert.equal(current.controller, bot);
  assert.equal(current.target, first); assert.equal(current.targetOwner, player);
  assert.deepEqual(current.targets, [first, second]);
  assert.equal(current.respondingToChainLink, link);
  assert.equal(current.activationAttempt?.linkId, link.linkId);
  assert.equal(current.originalContext, original);
  assert.equal(original.target, originalTarget); assert.deepEqual(original.targets, [originalTarget]);
});

test("targeting response uses latest declared target and projection is idempotent", () => {
  const target = createTestCard({ instanceId: 812 });
  const { chain, original, link, bot, source } = setup([target]);
  const response = createTestEffect({ id: "on_target", timing: "on_event", event: "effect_targeted", speed: 2 });
  const first = required(chain.getEffectChainResponseContext(response, original));
  const repeated = required(chain.getEffectChainResponseContext(response, first));
  for (const context of [first, repeated]) {
    assert.equal(context.type, "effect_targeted"); assert.equal(context.event, "effect_targeted");
    assert.equal(context.target, target); assert.equal(context.card, source);
    assert.equal(context.controller, bot); assert.equal(context.respondingToChainLink, link);
    assert.equal(context.originalContext, original);
  }
});

test("cost/reference-only latest link does not reuse a previous targeting event", () => {
  const { chain, original, player } = setup();
  const response = createTestEffect({ id: "target_response", timing: "on_event", event: "effect_targeted", speed: 2 });
  const trap = createTestCard({ cardKind: "trap", subtype: "normal", isFacedown: true, setTurn: 1, effects: [response] });
  placeCard(player, "spellTrap", trap);
  const current = required(chain.getCurrentChainActivationContext(original));
  assert.equal(current.target, null); assert.equal(current.targetOwner, null); assert.deepEqual(current.targets, []);
  assert.equal(chain.findActivatableEffect(trap, original, player), null);
  assert.equal(chain.getActivatableCardsInChain(player, original).some(candidate => candidate.card === trap), false);
});

for (const occurrence of [
  { type: "attack_declaration", event: "attack_declared" },
  { type: "summon", event: "after_summon" },
  { type: "phase_change", event: "phase_end" },
] as const) {
  test(`original ${occurrence.event} occurrence survives targeted response projection`, () => {
    const target = createTestCard({ instanceId: 813 });
    const { chain, original, originalTarget } = setup([target]);
    const root: FastEffectContextInput = { ...original, ...occurrence, attacker: originalTarget,
      defender: target, summonedCard: originalTarget, summonId: 33, fromPhase: "main1", toPhase: "battle" };
    const targetResponse = createTestEffect({ id: "target_response", timing: "on_event", event: "effect_targeted", speed: 2 });
    const projected = required(chain.getEffectChainResponseContext(targetResponse, root));
    assert.equal(projected.target, target);
    const originalResponse = createTestEffect({ id: "occurrence_response", timing: "on_event", event: occurrence.event, speed: 2 });
    const restored = chain.getEffectChainResponseContext(originalResponse, projected);
    assert.equal(restored, root, "the explicit occurrence is retained, not a transformed activation context");
  });
}

test("activation responders retain the latest activation kind rather than targeted-event type", () => {
  const target = createTestCard({ instanceId: 814 });
  const { chain, original, link } = setup([target]);
  const response = createTestEffect({ id: "negation_response", speed: 2, canRespondTo: ["effect_activation"] });
  const current = required(chain.getEffectChainResponseContext(response, original));
  assert.equal(current.type, "effect_activation");
  assert.equal(current.respondingToChainLink, link); assert.equal(current.target, target);
});

test("a later effect activation does not revive an earlier card activation event", () => {
  const { chain, original, player, link } = setup();
  const root: FastEffectContextInput = { ...original, type: "card_activation", event: "card_activation" };
  const oldResponse = createTestEffect({ id: "card_only", timing: "on_event", event: "card_activation", speed: 2 });
  const trap = createTestCard({ cardKind: "trap", subtype: "normal", isFacedown: true, setTurn: 1, effects: [oldResponse] });
  placeCard(player, "spellTrap", trap);
  const current = required(chain.getEffectChainResponseContext(oldResponse, root));
  assert.equal(current.type, "effect_activation");
  assert.equal(current.respondingToChainLink, link);
  assert.equal(chain.findActivatableEffect(trap, root, player), null);
  assert.equal(chain.getActivatableCardsInChain(player, root).some(candidate => candidate.card === trap), false);
});
