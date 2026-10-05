import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { resolveTargetCards } from "../src/core/actionHandlers/shared.js";
import { handleAddStatus } from "../src/core/actionHandlers/stats.js";
import type { ActionOf } from "../src/core/contracts/actions.js";
import type { EffectContext } from "../src/core/contracts/actionRuntime.js";
import { cardDefinition, required, unsafeFixture } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

function fixture(t: TestContext, sourceId: 515 | 517, seat: "player" | "bot" = "player") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false });
  t.after(() => game.dispose());
  game.disablePresentationDelays = true;
  game.turn = seat; game.phase = "main1"; game.turnCounter = 3;
  game.player.controllerType = game.bot.controllerType = "human";
  const owner = game[seat];
  const opponent = game[seat === "player" ? "bot" : "player"];
  const source = new Card(cardDefinition(sourceId), owner.id);
  const immune = new Card(cardDefinition(275), opponent.id);
  placeFieldCards(owner.field, source); placeFieldCards(opponent.field, immune);
  for (const card of [source, immune]) game.ensureDuelCardId(card);
  const effect = required(source.effects.find(effect => effect.id === (sourceId === 515
    ? "tech_zero_reactor_dragon_synchro_negate" : "tech_zero_final_singularity_synchro_negate_all")));
  const context = { source, effect, player: owner, opponent };
  return { game, owner, opponent, source, immune, effect, context };
}

test("handler target maps keep empty selections authoritative over cached references", () => {
  const card = new Card(cardDefinition(275), "bot");
  assert.deepEqual(resolveTargetCards({ targetRef: "victim" }, { _actionTargets: { victim: [card] } }, { victim: [] }), []);
  assert.deepEqual(resolveTargetCards({ targetRef: "self" }, { source: card }, { self: [] }), []);
  assert.deepEqual(resolveTargetCards({ targetRef: "victim" }, { _actionTargets: { victim: [card] } }, {}), [card]);
});

test("reference options, intrinsic participants and stored results retain their resolution", () => {
  const source = new Card(cardDefinition(515), "player");
  const target = new Card(cardDefinition(501), "bot");
  const context: EffectContext = { source, attacker: target, _actionTargets: { stored: [target] } };
  assert.deepEqual(resolveTargetCards({ targetRef: "stored" }, context, {}, { targetRef: "self" }), [source]);
  assert.deepEqual(resolveTargetCards(null, context, {}, { defaultRef: "attacker" }), [target]);
  assert.deepEqual(resolveTargetCards({ targetRef: "stored" }, context, {}), [target]);
  assert.deepEqual(resolveTargetCards(null, context, {}, { targetRef: [target] }), [target]);
  const inherited = Object.create({ stored: [source] }) as Record<string, Card[]>;
  assert.deepEqual(resolveTargetCards({ targetRef: "stored" }, context, inherited), [target]);
});

for (const seat of ["player", "bot"] as const) {
  test(`Reactor cannot recover an immune victim from cached targets (${seat})`, async t => {
    const { game, immune, effect, context } = fixture(t, 515, seat);
    const ref = required(effect.targets?.[0]).id;
    await game.effectEngine.applyActions(required(effect.actions), context, { [ref]: [immune] });
    assert.equal(immune.effectsNegated, false);
    assert.deepEqual(immune.effectsNegationContributions, []);
  });

  test(`Reactor still negates an eligible face-up monster (${seat})`, async t => {
    const { game, opponent, effect, context } = fixture(t, 515, seat);
    const victim = new Card(cardDefinition(501), opponent.id);
    placeFieldCards(opponent.field, victim);
    await game.effectEngine.applyActions(required(effect.actions), context, { [required(effect.targets?.[0]).id]: [victim] });
    assert.equal(victim.effectsNegated, true);
    assert.equal(victim.effectsNegatedDuration, "while_faceup");
  });

  test(`Singularity respects whole-effect immunity across field zones (${seat})`, async t => {
    const { game, owner, opponent, source, immune, effect, context } = fixture(t, 517, seat);
    const backrow = new Card(cardDefinition(519), opponent.id);
    const fieldSpell = new Card(cardDefinition(518), opponent.id);
    backrow.isFacedown = fieldSpell.isFacedown = false;
    opponent.spellTrap.push(backrow); opponent.fieldSpell = fieldSpell;
    await game.effectEngine.applyActions(required(effect.actions), context, {});
    assert.equal(immune.effectsNegated, false);
    assert.equal(backrow.effectsNegated, true);
    assert.equal(fieldSpell.effectsNegated, true);
    await game.moveCard(source, owner, "graveyard", { fromZone: "field" });
    game.cleanupTempBoosts(opponent);
    assert.equal(backrow.effectsNegated, true);
    assert.equal(fieldSpell.effectsNegated, true);
  });

  test(`Singularity does affect targeting-protected cards and only its resolution snapshot (${seat})`, async t => {
    const { game, opponent, effect, context } = fixture(t, 517, seat);
    const protectedCard = new Card(cardDefinition(501), opponent.id);
    Reflect.set(protectedCard, "cannotBeTargeted", true);
    placeFieldCards(opponent.field, protectedCard);
    await game.effectEngine.applyActions(required(effect.actions), context, {});
    assert.equal(protectedCard.effectsNegated, true);
    const late = new Card(cardDefinition(502), opponent.id);
    opponent.field.push(late);
    assert.equal(late.effectsNegated, false);
  });
}

test("scope skip_action checks every recipient before changing any status", async t => {
  const { game, source, immune, context } = fixture(t, 517);
  const action: ActionOf<"add_status"> & { immunityMode: "skip_action" } = {
    type: "add_status", status: "effectsNegated", immunityMode: "skip_action",
    targetScope: { owner: "both", zones: ["field"], requireFaceup: true },
  };
  await handleAddStatus(action, context, {}, unsafeFixture<Parameters<typeof handleAddStatus>[3]>(game.effectEngine,
    "Concrete runtime provides status/immunity methods; strategy projections are unused by this handler."));
  assert.equal(source.effectsNegated, false);
  assert.equal(immune.effectsNegated, false);
});

test("resolution references bypass targeting protection, but preserve immunity and empty selections", async t => {
  const { game, opponent, immune, source, context } = fixture(t, 515);
  const protectedCard = new Card(cardDefinition(501), opponent.id);
  Reflect.set(protectedCard, "cannotBeTargeted", true);
  const referenceEffect = { id: "reference_status", timing: "ignition" as const, activationZones: ["field"] as const,
    targets: [{ id: "reference", intent: "reference" as const, owner: "opponent" as const, zone: "field" as const }] };
  const referenceContext: EffectContext = { ...context, effect: referenceEffect,
    _actionTargets: { reference: [immune] } };
  const engine = unsafeFixture<Parameters<typeof handleAddStatus>[3]>(game.effectEngine,
    "Concrete runtime provides status/immunity methods; strategy projections are unused by this handler.");
  await handleAddStatus({ type: "add_status", targetRef: "reference", status: "effectsNegated" }, referenceContext, { reference: [] }, engine);
  assert.equal(immune.effectsNegated, false);
  placeFieldCards(opponent.field, protectedCard);
  await handleAddStatus({ type: "add_status", targetRef: "reference", status: "effectsNegated" }, referenceContext, { reference: [protectedCard] }, engine);
  assert.equal(protectedCard.effectsNegated, true);
  assert.equal(source.effectsNegated, false);
});

test("status without a reference affects only its source", async t => {
  const { game, owner, source, context } = fixture(t, 515);
  const bystander = new Card(cardDefinition(501), owner.id);
  owner.field.push(bystander);
  await game.effectEngine.applyActions([{ type: "add_status", status: "piercing" }], context, {});
  assert.equal(source.piercing, true);
  assert.equal(bystander.piercing, false);
});
