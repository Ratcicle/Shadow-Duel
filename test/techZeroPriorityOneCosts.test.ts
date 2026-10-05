import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { validateEffectActionTree } from "../src/core/CardDatabaseValidator.js";
import { createCanonicalStateSnapshot, hashCanonicalGameState } from "../src/core/game/replay/canonical.js";
import { getPaidCostReferenceValues } from "../src/core/effects/targeting/references.js";
import { cardDefinition, chainSelections, required } from "./helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "./helpers/game.js";

const MAGE_EFFECT = "tech_zero_battle_mage_recycle_revive";
const REACTOR_EFFECT = "tech_zero_reactor_dragon_recycle_synchros";
const COST_REF = "tech_zero_battle_mage_cost";

function scenario(t: TestContext, seat: "player" | "bot") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false,
    chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose("techzero_priority_one_costs"));
  game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.player.controllerType = game.bot.controllerType = "human";
  game.player.strategy = game.bot.strategy = null;
  game.ui.showChainResponseModal = async () => null;
  game.ui.showConfirmPrompt = async () => true;
  game.ui.showTriggerOrderModal = async options => options?.optional ? []
    : (options?.candidates || []).map(candidate => candidate.candidateId);
  game.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
  const owner = game[seat];
  const make = (id: number) => {
    const card = new Card(cardDefinition(id), owner.id);
    if (card.monsterType === "synchro") {
      card.properSummonEstablished = true; card.properSummonProcedure = "synchro";
    }
    return card;
  };
  return { game, owner, make };
}

for (const seat of ["player", "bot"] as const) {
  test(`Mage pays before effect notification and revives using its cost's field Level (${seat})`, async t => {
    const { game, owner, make } = scenario(t, seat);
    const mage = make(512), core = make(501), revive = make(503), sameName = make(501);
    placeFieldCards(owner.field, mage, core);
    await game.effectEngine.applyActions([{ type: "modify_level", targetRef: "core", amount: 2 }],
      { source: mage, player: owner }, { core: [core] });
    sameName.level = 3;
    owner.graveyard.push(sameName, revive);
    let notified = false;
    let paidBeforeNotification = false;
    let fieldReferenceValues: unknown;
    game.on("effect_activated", payload => {
      if (payload.effect?.id !== MAGE_EFFECT) return;
      notified = true;
      paidBeforeNotification = owner.graveyard.includes(core) && !owner.field.includes(core);
      const payment = payload.costPayment;
      fieldReferenceValues = payment ? Reflect.get(payment, "paidReferences") : undefined;
    });
    const activation = game.tryActivateMonsterEffect(mage, null, "field", owner, { effectId: MAGE_EFFECT });
    await completeTestSelections(game, activation);
    assert.equal((await activation).success, true);
    assert.equal(notified, true);
    assert.equal(paidBeforeNotification, true, "the field monster must be paid before the effect is notified");
    assert.deepEqual(fieldReferenceValues, { [COST_REF]: [{ cardDuelCardId: core.duelCardId, name: core.name, level: 3 }] });
    assert.equal(core.level, 1, "field-exit cleanup restores the physical card without changing its paid values");
    assert.ok(owner.field.includes(revive));
    assert.ok(owner.graveyard.includes(sameName), "a same-name card cannot be revived");
  });

  test(`Mage's paid activation cost remains spent when the real Chain negates activation (${seat})`, async t => {
    const { game, owner, make } = scenario(t, seat);
    const mage = make(512), cost = make(503), revive = make(502);
    placeFieldCards(owner.field, mage, cost); owner.graveyard.push(revive);
    const prepared = game.chainSystem.createPreparedActivation({ card: mage, controller: owner,
      effect: required(mage.effects.find(effect => effect.id === MAGE_EFFECT)), activationZone: "field",
      committed: true, costSelections: chainSelections({ [COST_REF]: [cost] }) });
    assert.equal((await game.chainSystem.payActivationCosts(prepared)).success, true);
    assert.ok(owner.graveyard.includes(cost), "payment must precede publishing the Chain Link");
    const link = required(game.chainSystem.addToChain(prepared));
    assert.ok(link);
    game.chainSystem.markChainLinkActivationNegated(link);
    await game.chainSystem.resolveChain();
    assert.ok(owner.graveyard.includes(cost));
    assert.ok(owner.graveyard.includes(revive));
  });

  test(`Reactor refuses a self-cost redirected away from the Graveyard (${seat})`, async t => {
    const { game, owner, make } = scenario(t, seat);
    const reactor = make(515), revive = make(514);
    reactor.summonedTurn = 1; reactor.banishWhenLeavesField = true;
    placeFieldCards(owner.field, reactor); owner.graveyard.push(revive);
    const activation = game.tryActivateMonsterEffect(reactor, null, "field", owner, { effectId: REACTOR_EFFECT });
    await completeTestSelections(game, activation);
    assert.equal((await activation).success, false, "sending this card to the Graveyard must be a payable cost");
    assert.ok(owner.field.includes(reactor));
    assert.ok(owner.graveyard.includes(revive));
    assert.equal(owner.banished.includes(reactor), false);
  });

  test(`Mage preserves paid values after the cost moves again and detaches Chain evidence (${seat})`, async t => {
    const { game, owner, make } = scenario(t, seat);
    const mage = make(512), core = make(501), sameName = make(501), revive = make(503);
    placeFieldCards(owner.field, mage, core);
    await game.effectEngine.applyActions([{ type: "modify_level", targetRef: "core", amount: 2 }],
      { source: mage, player: owner }, { core: [core] });
    sameName.level = 3; owner.graveyard.push(sameName, revive);
    const prepared = game.chainSystem.createPreparedActivation({ card: mage, controller: owner,
      effect: required(mage.effects.find(effect => effect.id === MAGE_EFFECT)), activationZone: "field",
      committed: true, costSelections: chainSelections({ [COST_REF]: [core] }) });
    assert.equal((await game.chainSystem.payActivationCosts(prepared)).success, true);
    const link = game.chainSystem.addToChain(prepared); assert.ok(link);
    const frozen = required(getPaidCostReferenceValues(link.costPayment, COST_REF))[0];
    assert.ok(frozen);
    assert.deepEqual(frozen, { cardDuelCardId: core.duelCardId, name: core.name, level: 3 });
    const serialized = required(game.chainSystem.serializeChainLink(link));
    const detachedPrepared = game.chainSystem.createPreparedActivation({ card: mage, controller: owner,
      effect: prepared.effect, activationZone: "field", costPayment: link.costPayment, costsPaid: true });
    const detachedValues = required(detachedPrepared.costPayment?.paidReferences?.[COST_REF]);
    detachedValues[0] = { cardDuelCardId: null, name: "Unrelated preparation mutation", level: 9 };
    const recorded = required(serialized.costPayment?.paidReferences?.[COST_REF]);
    recorded.push({ cardDuelCardId: null, name: "Unrelated serialization mutation", level: 7 });
    const draft = required(prepared.costPayment?.paidReferences?.[COST_REF]);
    draft[0] = { cardDuelCardId: core.duelCardId ?? null, name: "Unrelated draft mutation", level: 1 };
    assert.deepEqual(getPaidCostReferenceValues(link.costPayment, COST_REF), [frozen]);
    const hash = hashCanonicalGameState(game);
    const snapshot = createCanonicalStateSnapshot(game);
    assert.ok(JSON.stringify(snapshot.chain.links).includes('"level":3'));
    assert.ok(JSON.stringify(snapshot.chain.links).includes('"paidReferences"'));
    assert.equal(hashCanonicalGameState(game), hash, "reading/copying evidence must not change live Chain state");
    const liveReferences = required(link.costPayment?.paidReferences?.[COST_REF]);
    liveReferences[0] = { ...frozen, level: 2 };
    assert.notEqual(hashCanonicalGameState(game), hash, "paid values affect canonical state independently of the physical card");
    liveReferences[0] = frozen;
    await game.moveCard(core, owner, "banished", { fromZone: "graveyard" });
    core.name = "Changed after payment"; core.level = 7;
    const resolution = Promise.resolve(game.chainSystem.resolveChain());
    await completeTestSelections(game, resolution); await resolution;
    assert.ok(owner.banished.includes(core));
    assert.ok(owner.field.includes(revive), "comparison uses the paid Level even without the cost card in the Graveyard");
    assert.ok(owner.graveyard.includes(sameName), "name exclusion uses the name captured when paying");
    assert.deepEqual(getPaidCostReferenceValues(link.costPayment, COST_REF), [frozen]);
  });

  test(`Mage cancellation spends no cost and an unpayable cost publishes no evidence (${seat})`, async t => {
    const { game, owner, make } = scenario(t, seat);
    const mage = make(512), first = make(503), second = make(503), revive = make(502);
    placeFieldCards(owner.field, mage, first, second); owner.graveyard.push(revive);
    const activation = game.tryActivateMonsterEffect(mage, null, "field", owner, { effectId: MAGE_EFFECT });
    for (let attempt = 0; attempt < 200 && !game.targetSelection; attempt++) {
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    assert.equal(game.targetSelection?.kind, "cost");
    game.cancelTargetSelection();
    assert.equal((await activation).success, false);
    assert.ok(owner.field.includes(first)); assert.ok(owner.field.includes(second));
    assert.equal(game.chainSystem.chainStack.length, 0);
    first.banishWhenLeavesField = true;
    const prepared = game.chainSystem.createPreparedActivation({ card: mage, controller: owner,
      effect: required(mage.effects.find(effect => effect.id === MAGE_EFFECT)), activationZone: "field",
      committed: true, costSelections: chainSelections({ [COST_REF]: [first] }) });
    assert.equal((await game.chainSystem.payActivationCosts(prepared)).success, false);
    assert.equal(prepared.costsPaid, false);
    assert.equal(prepared.costPayment?.paidReferences, undefined);
    assert.ok(owner.field.includes(first)); assert.equal(owner.banished.length, 0);
  });

  test(`a successful move cost without opt-in retains its existing reference behavior (${seat})`, async t => {
    const { game, owner, make } = scenario(t, seat);
    const mage = make(512), cost = make(503);
    placeFieldCards(owner.field, mage, cost);
    const effect = required(mage.effects.find(entry => entry.id === MAGE_EFFECT));
    const prepared = game.chainSystem.createPreparedActivation({ card: mage, controller: owner,
      effect: { ...effect, activationCosts: required(effect.activationCosts).map(action => ({ ...action, capturePaidReference: false })) },
      activationZone: "field", committed: true, costSelections: chainSelections({ [COST_REF]: [cost] }) });
    assert.equal((await game.chainSystem.payActivationCosts(prepared)).success, true);
    assert.ok(owner.graveyard.includes(cost));
    assert.equal(prepared.costPayment?.paidReferences, undefined);
  });

  test(`Mage can pay a field cost to open a full field for its revival (${seat})`, async t => {
    const { game, owner, make } = scenario(t, seat);
    const mage = make(512), cost = make(503), revive = make(502);
    placeFieldCards(owner.field, mage, cost, make(507), make(507), make(507));
    owner.graveyard.push(revive);
    const preview = game.effectEngine.canActivateMonsterEffectPreview(mage, owner, "field", null, { effectId: MAGE_EFFECT });
    assert.equal(preview.ok, true, "the activation cost projects the Monster Zone it will free");
    const activation = game.tryActivateMonsterEffect(mage, null, "field", owner, { effectId: MAGE_EFFECT });
    await completeTestSelections(game, activation);
    assert.equal((await activation).success, true);
    assert.equal(owner.field.length, 5); assert.ok(owner.field.includes(revive));
    assert.deepEqual(owner.graveyard, [cost]);
    assert.equal(game.chainSystem.chainStack.length, 0);
  });

  test(`Mage pays only once when responses remove every legal revival (${seat})`, async t => {
    const { game, owner, make } = scenario(t, seat);
    const mage = make(512), cost = make(503), revive = make(502);
    placeFieldCards(owner.field, mage, cost); owner.graveyard.push(revive);
    let payments = 0, windows = 0;
    game.on("card_moved", payload => {
      if (payload.card === cost && payload.fromZone === "field" && payload.toZone === "graveyard") payments++;
    });
    game.chainSystem.offerChainResponses = async () => {
      windows++;
      assert.ok(owner.graveyard.includes(cost), "the response window must see the paid cost");
      const link = required(game.chainSystem.chainStack.find(entry => entry.card === mage));
      assert.equal(link.costPayment?.paidReferences?.[COST_REF]?.length, 1);
      if (owner.graveyard.includes(revive)) await game.moveCard(revive, owner, "banished", { fromZone: "graveyard" });
      return { offers: 1, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false };
    };
    const activation = game.tryActivateMonsterEffect(mage, null, "field", owner, { effectId: MAGE_EFFECT });
    await completeTestSelections(game, activation); await activation;
    assert.ok(windows >= 1); assert.equal(payments, 1);
    assert.deepEqual(owner.field, [mage]);
    assert.ok(owner.graveyard.includes(cost)); assert.ok(owner.banished.includes(revive));
    assert.equal(game.targetSelection, null);
  });

  test(`Mage rejects a Token as a send-to-Graveyard cost without removing it (${seat})`, async t => {
    const { game, owner, make } = scenario(t, seat);
    const mage = make(512), token = make(503), revive = make(502);
    token.isToken = true;
    placeFieldCards(owner.field, mage, token); owner.graveyard.push(revive);
    assert.equal(game.effectEngine.canActivateMonsterEffectPreview(mage, owner, "field", null, { effectId: MAGE_EFFECT }).ok, false);
    const activation = game.tryActivateMonsterEffect(mage, null, "field", owner, { effectId: MAGE_EFFECT });
    await completeTestSelections(game, activation);
    assert.equal((await activation).success, false);
    assert.ok(owner.field.includes(token)); assert.equal(owner.graveyard.includes(token), false);
    assert.ok(owner.graveyard.includes(revive));
  });

  for (const family of ["mage", "reactor"] as const) {
    test(`${family} respects Galaxy Extreme Dragon's real continuous Graveyard replacement (${seat})`, async t => {
      const { game, owner, make } = scenario(t, seat);
      const source = make(family === "mage" ? 512 : 515), cost = family === "mage" ? make(503) : source;
      const revive = make(family === "mage" ? 502 : 514);
      source.summonedTurn = 1;
      placeFieldCards(owner.field, source, ...(cost === source ? [] : [cost]));
      owner.graveyard.push(revive);
      const opponent = game[seat === "player" ? "bot" : "player"];
      const galaxy = new Card(cardDefinition(273), opponent.id);
      placeFieldCards(opponent.field, galaxy);
      const effectId = family === "mage" ? MAGE_EFFECT : REACTOR_EFFECT;
      assert.equal(game.effectEngine.canActivateMonsterEffectPreview(source, owner, "field", null, { effectId }).ok, false);
      const activation = game.tryActivateMonsterEffect(source, null, "field", owner, { effectId });
      await completeTestSelections(game, activation);
      assert.equal((await activation).success, false);
      assert.ok(owner.field.includes(cost)); assert.ok(owner.graveyard.includes(revive));
      assert.equal(owner.banished.length, 0); assert.equal(game.chainSystem.chainStack.length, 0);
    });
  }
}

test("paid-reference authoring accepts only activation costs with a nonempty targetRef", () => {
  const target = { id: "cost", intent: "cost", owner: "self", zone: "field", count: { min: 1, max: 1 } };
  const move = { type: "move", targetRef: "cost", fromZone: "field", to: "graveyard", capturePaidReference: true };
  assert.deepEqual(validateEffectActionTree({ targets: [target], activationCosts: [move], actions: [] }).errors, []);
  for (const effect of [
    { targets: [target], actions: [{ type: "optional_target_actions", actions: [move] }] },
    { targets: [target], activationCosts: [{ ...move, targetRef: "" }], actions: [] },
    { targets: [target], activationCosts: [{ ...move, targetRef: undefined }], actions: [] },
    { targets: [target], replacementEffect: { costActions: [move] }, actions: [] },
  ]) {
    assert.ok(validateEffectActionTree(effect).errors.some(error => error.message.includes("capturePaidReference")));
  }
});
