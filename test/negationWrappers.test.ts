import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { CardAction } from "../src/core/contracts/actions.js";
import type { EffectDefinition } from "../src/core/contracts/effects.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, completeTestSelections } from "./helpers/game.js";
import { clearEffectNegation } from "../src/core/effects/negation.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";
import { selectSimulatedTargets } from "../src/core/ai/common/targetSelection.js";

const negate: CardAction = { type: "add_status", targetRef: "victim", status: "effectsNegated", value: true, duration: "until_end_turn" };
const damage: CardAction = { type: "damage", amount: 100, player: "opponent" };
const victim = { id: "victim", owner: "opponent", zone: "field", cardKind: "monster", requireFaceup: true, count: { min: 1, max: 1 } } as const;
const wrappers: Array<{ name: string; wrap(actions: readonly CardAction[]): CardAction }> = [
  { name: "conditional_actions", wrap: actions => ({ type: "conditional_actions", actions }) },
  { name: "conditional_target_actions", wrap: actions => ({ type: "conditional_target_actions", targetRef: "condition_ref", cases: [{ actions }], defaultActions: [negate] }) },
  { name: "optional_target_actions inherited binding", wrap: actions => ({ type: "optional_target_actions", targets: [], actions }) },
];

function setup(t: TestContext, actions: readonly CardAction[]) {
  const game = createRuntimeGame({ captureReplay: false, laboratoryMode: true, laboratoryUseBot: false });
  t.after(() => game.dispose());
  game.turn = "player"; game.turnCounter = 2; game.phase = "main1"; game.disablePresentationDelays = true;
  game.player.controllerType = game.bot.controllerType = "human";
  const effect: EffectDefinition = { id: "wrapped_negation", timing: "ignition", activationZones: ["field"],
    targets: [{ id: "cost", owner: "self", zone: "hand", intent: "cost", count: { min: 1, max: 1 } }, victim,
      { ...victim, id: "condition_ref" }],
    activationCosts: [{ type: "move", targetRef: "cost", to: "graveyard", player: "self", contextLabel: "discard" }], actions };
  const source = new Card({ ...cardDefinition(1), effects: [effect] }, "player");
  const target = new Card({ ...cardDefinition(1), effectsNegated: true, effectsNegatedDuration: "while_faceup" }, "bot");
  const cost = new Card(cardDefinition(1), "player");
  placeFieldCards(game.player.field, source); placeFieldCards(game.bot.field, target); game.player.hand.push(cost);
  const selections = { cost: [cost], victim: [target], condition_ref: [target] };
  return { game, source, target, cost, effect, selections };
}

for (const { name, wrap } of wrappers) {
  for (const operation of ["preview", "activation"] as const) {
    test(`${name}: pure negation rejects redundant ${operation} before its cost`, async t => {
      const { game, source, cost, effect, selections } = setup(t, [wrap([negate])]);
      if (operation === "preview") {
        assert.equal(game.effectEngine.canActivateMonsterEffectPreview(source, game.player, "field", selections, { effectId: effect.id }).ok, false);
      } else {
        const result = await game.tryActivateMonsterEffect(source, selections, "field", game.player, { effectId: effect.id });
        assert.equal(result.success, false);
      }
      assert.ok(game.player.hand.includes(cost));
    });
  }
  test(`${name}: mixed result retains ordinary redundant target eligibility`, async t => {
    const { game, source, cost, effect, selections } = setup(t, [wrap([negate, damage])]);
    assert.equal(game.effectEngine.canActivateMonsterEffectPreview(source, game.player, "field", selections, { effectId: effect.id }).ok, true);
    const result = await game.tryActivateMonsterEffect(source, selections, "field", game.player, { effectId: effect.id });
    assert.equal(result.success, true);
    assert.equal(game.bot.lp, 7900);
    assert.ok(game.player.graveyard.includes(cost));
  });
}

test("all conditional branches and defaults contribute to pure/mixed classification", t => {
  const pure = setup(t, [{ type: "conditional_target_actions", targetRef: "condition_ref",
    cases: [{ actions: [negate] }, { actions: [{ type: "conditional_actions", actions: [negate] }] }], defaultActions: [negate] }]);
  assert.equal(pure.game.effectEngine.canActivateMonsterEffectPreview(pure.source, pure.game.player, "field", pure.selections).ok, false);
  const mixed = setup(t, [{ type: "conditional_target_actions", targetRef: "condition_ref", cases: [{ actions: [negate] }], defaultActions: [damage] }]);
  assert.equal(mixed.game.effectEngine.canActivateMonsterEffectPreview(mixed.source, mixed.game.player, "field", mixed.selections).ok, true);
});

test("pure choose cases retain outer direct negation classification; mixed case keeps eligibility", t => {
  const pure = setup(t, [negate, { type: "choose_action_case", cases: [{ id: "negate", targets: [{ ...victim, id: "local" }], actions: [{ ...negate, targetRef: "local" }] }] }]);
  assert.equal(pure.game.effectEngine.canActivateMonsterEffectPreview(pure.source, pure.game.player, "field", pure.selections).ok, false);
  const mixed = setup(t, [negate, { type: "choose_action_case", cases: [{ id: "negate", targets: [victim], actions: [negate] }, { id: "damage", actions: [damage] }] }]);
  assert.equal(mixed.game.effectEngine.canActivateMonsterEffectPreview(mixed.source, mixed.game.player, "field", mixed.selections).ok, true);
});

for (const action of [
  { type: "optional_target_actions", targets: [victim], actions: [negate] },
  { type: "choose_action_case", cases: [{ id: "local", targets: [victim], actions: [negate] }] },
] satisfies CardAction[]) {
  test(`${action.type} local resolution target cannot be confused with same-named activation target`, t => {
    const { game, source, selections } = setup(t, [action]);
    assert.equal(game.effectEngine.canActivateMonsterEffectPreview(source, game.player, "field", selections).ok, true);
  });
}

test("pure nested negation filters simulated activation with cost and reference bindings intact", () => {
  const effect: EffectDefinition = { id: "nested", timing: "ignition", activationZones: ["field"], targets: [victim, { ...victim, id: "condition_ref", intent: "reference" }],
    actions: [{ type: "conditional_actions", actions: [{ type: "conditional_target_actions", targetRef: "condition_ref", cases: [{ actions: [negate] }] }] }] };
  const source = simulationCard(new Card(cardDefinition(1), "bot"));
  const target = simulationCard(new Card({ ...cardDefinition(1), effectsNegated: true }, "player"));
  const state = simulationState({ bot: { field: [source] }, player: { field: [target] } });
  const selections = selectSimulatedTargets({ targets: effect.targets, actions: effect.actions, effect, state, sourceCard: source });
  assert.deepEqual(selections.victim, []);
  assert.deepEqual(selections.condition_ref, [target]);
});

for (const pure of [true, false]) {
  test(`context-bound activation target uses the same pure/mixed negation rule (${pure})`, async t => {
    const { game, source, target } = setup(t, []);
    const effect: EffectDefinition = { id: "context_negation", timing: "on_event", event: "attack_declared", triggerRequirement: "mandatory", triggerTiming: "if",
      targets: [{ ...victim, targetFromContext: "attacker" }], actions: pure ? [negate] : [negate, damage] };
    source.effects = [effect];
    const selections = await game.chainSystem.getPlayerSelectionsForEffect(source, effect, game.player, { attacker: target });
    if (pure) assert.equal(selections, null);
    else assert.deepEqual(selections, { victim: [target] });
    const resolved = game.effectEngine.resolveTargets(required(effect.targets), { source, effect, player: game.player, opponent: game.bot,
      attacker: target, activationContext: { timing: "resolution" } }, null);
    assert.equal(resolved.ok, true, "resolution must preserve a previously declared context target");
    assert.deepEqual(resolved.targets?.victim, [target]);
  });
}

test("context reference requirements remain available even in a pure negation effect", async t => {
  const { game, source, target } = setup(t, []);
  const effect: EffectDefinition = { id: "context_reference", timing: "on_event", event: "attack_declared", triggerRequirement: "mandatory", triggerTiming: "if",
    targets: [{ ...victim, targetFromContext: "attacker", intent: "reference" }], actions: [negate] };
  const resolved = game.effectEngine.resolveTargets(required(effect.targets), { source, effect, player: game.player, opponent: game.bot,
    attacker: target, activationContext: { timing: "activation" } }, null);
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.targets?.victim, [target]);
});

for (const filterAvailableCases of [true, false]) {
  test(`choice local context target stays legal during real Chain resolution (filter cases: ${filterAvailableCases})`, async t => {
    const { game, source, target } = setup(t, []);
    clearEffectNegation(target);
    const contextTarget = { ...victim, targetFromContext: "attacker" } as const;
    const effect: EffectDefinition = { id: "context_choice_resolution", timing: "on_event", event: "attack_declared", triggerRequirement: "mandatory", triggerTiming: "if",
      targets: [contextTarget], actions: [negate, { type: "choose_action_case", filterAvailableCases,
        cases: [{ id: "again", targets: [contextTarget], actions: [{ ...negate, duration: "while_faceup" }] }] }] };
    source.effects = [effect];
    const selections = await game.chainSystem.getPlayerSelectionsForEffect(source, effect, game.player, { attacker: target });
    assert.deepEqual(selections, { victim: [target] });
    assert.ok(game.chainSystem.addToChain(game.chainSystem.createPreparedActivation({ card: source, controller: game.player, effect,
      activationZone: "field", committed: true, costsPaid: true, context: { attacker: target, type: "attack_declared" },
      targetSelections: required(selections) })));
    await completeTestSelections(game, Promise.resolve(game.chainSystem.resolveChain()));
    assert.deepEqual(target.effectsNegationContributions.map(entry => entry.duration), ["until_end_turn", "while_faceup"]);
  });
}

test("two context-bound Chain declarations retain both contributions after a later link negates", async t => {
  const { game, source, target } = setup(t, []);
  clearEffectNegation(target);
  for (const duration of ["until_end_turn", "while_faceup"] as const) {
    const effect: EffectDefinition = { id: `context_${duration}`, timing: "on_event", event: "attack_declared", triggerRequirement: "mandatory", triggerTiming: "if",
      targets: [{ ...victim, targetFromContext: "attacker" }], actions: [{ ...negate, duration }] };
    const selections = await game.chainSystem.getPlayerSelectionsForEffect(source, effect, game.player, { attacker: target });
    assert.deepEqual(selections, { victim: [target] });
    assert.ok(game.chainSystem.addToChain(game.chainSystem.createPreparedActivation({ card: source, controller: game.player, effect,
      activationZone: "field", committed: true, costsPaid: true, context: { attacker: target, type: "attack_declared" },
      targetSelections: required(selections) })));
  }
  await game.chainSystem.resolveChain();
  assert.deepEqual(target.effectsNegationContributions.map(entry => entry.duration), ["while_faceup", "until_end_turn"]);
});

test("targetScope takes precedence over an unused targetRef when classifying activation requirements", t => {
  const { game, source, selections } = setup(t, [{ type: "conditional_actions", actions: [{ ...negate, targetScope: { owner: "self", zone: "field" } }] }]);
  assert.equal(game.effectEngine.canActivateMonsterEffectPreview(source, game.player, "field", selections).ok, true);
});
