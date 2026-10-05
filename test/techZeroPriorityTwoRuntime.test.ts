import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { EffectDefinition } from "../src/core/contracts/effects.js";
import { cardDefinition, chainSelections, required } from "./helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "./helpers/game.js";

const CORE_REF = "tech_zero_energy_core_level_target";
const MACHINE_REF = "tech_zero_multimodal_machine_level_target";
const MAGE_EFFECT = "tech_zero_battle_mage_recycle_revive";
const LAB_EFFECT = "tech_zero_development_lab_recycle";

function setup(t: TestContext, seat: "player" | "bot" = "player") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false,
    captureReplay: false, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose("techzero_priority_two_runtime"));
  game.turn = seat; game.turnCounter = 4; game.phase = "main1";
  game.disablePresentationDelays = true;
  game.player.controllerType = game.bot.controllerType = "human";
  game.player.strategy = game.bot.strategy = null;
  game.ui.showChainResponseModal = async () => null;
  game.ui.showConfirmPrompt = async () => true;
  game.ui.showTrapActivationModal = async () => true;
  game.ui.showTriggerOrderModal = async options =>
    (options?.candidates || []).map(candidate => candidate.candidateId);
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
  for (const response of ["fill", "remove"] as const) test(`Mage retains its full-field payment when responses ${response} the revival opportunity (${seat})`, async t => {
    const { game, owner, make } = setup(t, seat);
    const source = make(512), cost = make(501), revival = make(503), filler = make(507);
    placeFieldCards(owner.field, source, cost, make(507), make(507), make(507));
    cost.originalLevel = 1; cost.level = 3; cost.levelModificationContributions = [{ amount: 2, duration: "while_faceup" }];
    owner.graveyard.push(revival); owner.hand.push(filler);
    let responses = 0, payments = 0;
    game.on("card_to_grave", event => { if (event.card === cost) payments++; });
    const offer = game.chainSystem.offerChainResponses.bind(game.chainSystem);
    game.chainSystem.offerChainResponses = async (...args) => {
      if (game.chainSystem.chainStack.some(link => link.effectId === MAGE_EFFECT) && responses++ === 0) {
        assert.ok(owner.graveyard.includes(cost)); assert.equal(owner.field.length, 4);
        if (response === "fill") {
          const movement = await game.moveCard(filler, owner, "field", { fromZone: "hand", position: "attack",
            summonMethodOverride: "special", summonOrigin: "effect_resolution" });
          assert.equal(movement.success, true);
        }
        else await game.moveCard(revival, owner, "banished", { fromZone: "graveyard" });
      }
      return offer(...args);
    };
    const activation = game.tryActivateMonsterEffect(source, null, "field", owner, { effectId: MAGE_EFFECT });
    await completeTestSelections(game, activation); await activation;
    assert.equal(payments, 1); assert.ok(owner.graveyard.includes(cost));
    assert.equal(owner.field.includes(revival), false); assert.equal(game.targetSelection, null);
  });

  for (const invalid of ["token", "redirect", "blocked"] as const) test(`Mage rejects an invalid ${invalid} cost with a full field (${seat})`, async t => {
    const { game, owner, make } = setup(t, seat);
    const source = make(512), cost = make(503), revival = make(502);
    placeFieldCards(owner.field, source, cost, make(507), make(507), make(507)); owner.graveyard.push(revival);
    if (invalid === "token") cost.isToken = true;
    if (invalid === "redirect") cost.banishWhenLeavesField = true;
    if (invalid === "blocked") {
      const move = game.moveCardInternal.bind(game);
      game.moveCardInternal = (...args) => args[0] === cost ? Promise.resolve({ success: false, reason: "controlled move failure" }) : move(...args);
    }
    const activation = game.tryActivateMonsterEffect(source, null, "field", owner, { effectId: MAGE_EFFECT });
    await completeTestSelections(game, activation); assert.equal((await activation).success, false);
    assert.ok(owner.field.includes(cost)); assert.ok(owner.graveyard.includes(revival));
    assert.equal(game.chainSystem.chainStack.length, 0);
  });

  test(`two Mage copies activate independently on the same turn (${seat})`, async t => {
    const { game, owner, make } = setup(t, seat);
    const first = make(512), second = make(512), cost1 = make(503), cost2 = make(503), revived1 = make(502), revived2 = make(502);
    placeFieldCards(owner.field, first, second, cost1, cost2); owner.graveyard.push(revived1, revived2);
    const activation1 = game.tryActivateMonsterEffect(first, null, "field", owner, { effectId: MAGE_EFFECT });
    await completeTestSelections(game, activation1); assert.equal((await activation1).success, true);
    const effect = required(first.effects.find(entry => entry.id === MAGE_EFFECT));
    assert.equal(game.canUseOncePerTurn(first, owner, effect).ok, false);
    assert.equal(game.canUseOncePerTurn(second, owner, effect).ok, true, "the first copy cannot consume the second copy's use");
    const activation2 = game.tryActivateMonsterEffect(second, null, "field", owner, { effectId: MAGE_EFFECT });
    await completeTestSelections(game, activation2); assert.equal((await activation2).success, true);
    assert.ok(owner.field.includes(revived1)); assert.ok(owner.field.includes(revived2));
  });

  test(`two Lab copies recycle independently when the second replaces the first (${seat})`, async t => {
    const { game, owner, make } = setup(t, seat);
    const first = make(518), second = make(518), firstSynchro = make(503), secondSynchro = make(512);
    owner.fieldSpell = first; first.location = "fieldSpell"; owner.hand.push(second);
    owner.graveyard.push(firstSynchro, make(501));
    const firstAction = Promise.resolve(game.activateFieldSpellEffect(first));
    await completeTestSelections(game, firstAction); assert.equal((await firstAction).success, true);
    assert.ok(owner.extraDeck.includes(firstSynchro));
    const effect = required(first.effects.find(entry => entry.id === LAB_EFFECT));
    assert.equal(game.canUseOncePerTurn(first, owner, effect).ok, false);
    assert.equal(game.canUseOncePerTurn(second, owner, effect).ok, true);
    owner.graveyard.push(secondSynchro, make(502));
    const placement = game.tryActivateSpell(second, owner.hand.indexOf(second), null, { owner });
    await completeTestSelections(game, placement); assert.equal((await placement).success, true);
    assert.equal(owner.fieldSpell, second); assert.ok(owner.graveyard.includes(first));
    const secondAction = Promise.resolve(game.activateFieldSpellEffect(second));
    await completeTestSelections(game, secondAction); assert.equal((await secondAction).success, true);
    assert.ok(owner.extraDeck.includes(secondSynchro));
    assert.equal(game.canUseOncePerTurn(second, owner, effect).ok, false);
  });

  for (const id of [512, 518]) test(`soft OPT follows each copy's existing presence lifecycle (${id}, ${seat})`, async t => {
    const { game, owner, make } = setup(t, seat);
    const first = make(id), second = make(id);
    const effect = required(first.effects.find(entry => entry.id === (id === 512 ? MAGE_EFFECT : LAB_EFFECT)));
    if (id === 512) placeFieldCards(owner.field, first, second);
    else { owner.fieldSpell = first; first.location = "fieldSpell"; owner.hand.push(second); }
    game.markOncePerTurnUsed(first, owner, effect);
    assert.equal(game.canUseOncePerTurn(first, owner, effect).ok, false);
    assert.equal(game.canUseOncePerTurn(second, owner, effect).ok, true);
    first.isFacedown = true;
    assert.equal(game.canUseOncePerTurn(first, owner, effect).ok, false, "face-down alone does not reset the ledger");
    first.isFacedown = false;
    await game.moveCard(first, owner, "hand", { fromZone: id === 512 ? "field" : "fieldSpell" });
    assert.equal(game.canUseOncePerTurn(first, owner, effect).ok, true, "field exit retains the existing reset semantics");
    game.markOncePerTurnUsed(second, owner, effect);
    game.turnCounter++;
    assert.equal(game.canUseOncePerTurn(second, owner, effect).ok, true);
  });

  test(`Prism chooses from the current hand after responses without declaring a target (${seat})`, async t => {
    const { game, owner, make } = setup(t, seat);
    const core = make(501), prism = make(506), old = make(504), current = make(507), boss = make(503);
    placeFieldCards(owner.field, core, prism); owner.hand.push(old); owner.extraDeck.push(boss);
    owner.deck.push(make(508));
    let responded = false;
    const offer = game.chainSystem.offerChainResponses.bind(game.chainSystem);
    game.chainSystem.offerChainResponses = async (...args) => {
      const link = game.chainSystem.chainStack.find(entry => entry.effectId === "tech_zero_prism_activator_synchro_summon");
      if (link && !responded) {
        responded = true;
        assert.equal(link.declaredTargets.length, 0, "Prism's summon is not targeting");
        await game.moveCard(old, owner, "banished", { fromZone: "hand" });
        owner.hand.unshift(current);
      }
      return offer(...args);
    };
    const summon = game.performSynchroSummonFromExtraDeck(boss, owner, { materials: [core, prism] });
    await completeTestSelections(game, summon); await summon;
    assert.equal(responded, true);
    assert.ok(owner.field.includes(current)); assert.ok(owner.banished.includes(old));
    assert.equal(current.effectsNegated, true);
  });

  test(`Scrapyard chooses from the current Graveyard after responses without targeting (${seat})`, async t => {
    const { game, owner, make } = setup(t, seat);
    const source = make(520), old = make(501), current = make(501), nonTuner = make(506), boss = make(503);
    source.isFacedown = true; source.setTurn = 2; source.turnSetOn = 2;
    placeFieldCards(owner.spellTrap, source); placeFieldCards(owner.field, nonTuner);
    owner.graveyard.push(old); owner.extraDeck.push(boss); owner.deck.push(make(504));
    let responded = false;
    const offer = game.chainSystem.offerChainResponses.bind(game.chainSystem);
    game.chainSystem.offerChainResponses = async (...args) => {
      const link = game.chainSystem.chainStack.find(entry => entry.effectId === "tech_zero_scrapyard_activation");
      if (link && !responded) {
        responded = true;
        assert.equal(link.declaredTargets.length, 0, "Scrapyard's revival is not targeting");
        await game.moveCard(old, owner, "banished", { fromZone: "graveyard" });
        owner.graveyard.push(current);
      }
      return offer(...args);
    };
    const activation = game.tryActivateSpellTrapEffect(source, null, { owner,
      activationContext: { effectId: "tech_zero_scrapyard_activation" } });
    await completeTestSelections(game, activation); await activation;
    assert.equal(responded, true);
    assert.ok(owner.banished.includes(old)); assert.ok(owner.field.includes(boss));
    assert.ok(owner.graveyard.includes(current), "the current Tuner was revived, then used as material");
  });

  test(`Multimodal declares its monster before responses and chooses its mode later (${seat})`, async t => {
    const { game, owner, make } = setup(t, seat);
    const target = make(501), source = make(503);
    placeFieldCards(owner.field, target, source);
    const observations: string[] = [];
    game.on("effect_targeted", event => { if (event.effect?.id === "tech_zero_multimodal_machine_level_mod") observations.push("targeted"); });
    const offer = game.chainSystem.offerChainResponses.bind(game.chainSystem);
    game.chainSystem.offerChainResponses = async (...args) => {
      const link = game.chainSystem.chainStack.find(entry => entry.effectId === "tech_zero_multimodal_machine_level_mod");
      if (link) {
        observations.push("responses");
        assert.deepEqual(link.declaredTargets.find(entry => entry.targetId === MACHINE_REF)?.cards, [target]);
        assert.equal(link.declaredTargets.length, 1);
        assert.equal(target.level, 1, "the mode must not resolve before responses");
      }
      return offer(...args);
    };
    const activation = game.tryActivateMonsterEffect(source, null, "field", owner,
      { effectId: "tech_zero_multimodal_machine_level_mod" });
    await completeTestSelections(game, activation);
    assert.equal((await activation).success, true);
    assert.ok(observations.includes("responses"));
    assert.ok(observations.indexOf("targeted") < observations.indexOf("responses"));
    assert.equal(target.level, 2);
    assert.equal(source.level, 3);
  });

  for (const response of ["block-revival", "remove-synchro"] as const) test(`Scrapyard preserves completed movements when responses ${response} (${seat})`, async t => {
    const { game, owner, make } = setup(t, seat);
    const source = make(520), tuner = make(501), material = make(506), boss = make(503);
    source.isFacedown = true; source.setTurn = source.turnSetOn = 2;
    placeFieldCards(owner.spellTrap, source); placeFieldCards(owner.field, material);
    owner.graveyard.push(tuner); owner.extraDeck.push(boss);
    let responded = false, synchroAttempts = 0;
    const offer = game.chainSystem.offerChainResponses.bind(game.chainSystem);
    game.chainSystem.offerChainResponses = async (...args) => {
      if (!responded && game.chainSystem.chainStack.some(entry => entry.effectId === "tech_zero_scrapyard_activation")) {
        responded = true;
        if (response === "block-revival") tuner.cannotBeSpecialSummoned = true;
        else await game.moveCard(boss, owner, "banished", { fromZone: "extraDeck" });
      }
      return offer(...args);
    };
    const timing = game.chainSystem.runFastEffectTiming.bind(game.chainSystem);
    game.chainSystem.runFastEffectTiming = input => {
      if (input?.origin === "summon_attempt") synchroAttempts++;
      return timing(input);
    };
    const activation = game.tryActivateSpellTrapEffect(source, null, { owner });
    await completeTestSelections(game, activation); await activation;
    assert.equal(responded, true); assert.equal(synchroAttempts, 0);
    assert.ok(owner.field.includes(material)); assert.ok(owner.graveyard.includes(source));
    if (response === "block-revival") {
      assert.ok(owner.graveyard.includes(tuner)); assert.ok(owner.extraDeck.includes(boss));
    } else {
      assert.ok(owner.field.includes(tuner), "the completed revival remains after losing the Synchro opportunity");
      assert.ok(owner.banished.includes(boss));
    }
  });

  test(`Energy Core declares a level target when its optional summon trigger activates (${seat})`, async t => {
    const { game, owner, make } = setup(t, seat);
    const target = make(504), catapult = make(502), source = make(501);
    placeFieldCards(owner.field, target); owner.hand.push(catapult, source);
    let declared = false;
    const offer = game.chainSystem.offerChainResponses.bind(game.chainSystem);
    game.chainSystem.offerChainResponses = async (...args) => {
      const link = game.chainSystem.chainStack.find(entry => entry.effectId === "tech_zero_energy_core_level_mod");
      if (link) {
        declared = true;
        assert.deepEqual(link.declaredTargets.find(entry => entry.targetId === CORE_REF)?.cards, [target]);
        assert.equal(target.level, 4);
      }
      return offer(...args);
    };
    const summon = game.performNormalSummon(owner, 0);
    await completeTestSelections(game, summon); await summon;
    assert.equal(declared, true);
    assert.equal(target.level, 5);
  });

  for (const change of ["rise", "fall"] as const) test(`Multimodal reductions use its declared target's current Level after a ${change} (${seat})`, async t => {
    const { game, owner, make } = setup(t, seat);
    const target = make(501), source = make(503), alternative = make(504);
    target.level = change === "rise" ? 1 : 3;
    placeFieldCards(owner.field, target, source, alternative);
    let responded = false, chose = false;
    const offer = game.chainSystem.offerChainResponses.bind(game.chainSystem);
    game.chainSystem.offerChainResponses = async (...args) => {
      if (!responded && game.chainSystem.chainStack.some(entry => entry.effectId === "tech_zero_multimodal_machine_level_mod")) {
        responded = true; target.level = change === "rise" ? 3 : 1;
      }
      return offer(...args);
    };
    const finish = game.finishTargetSelection.bind(game);
    game.finishTargetSelection = async (...args) => {
      const session = game.targetSelection;
      if (session?.kind === "choice") {
        const requirement = required(session.requirements[0]);
        const ids = requirement.candidates.map(candidate => candidate.cardRef ? Reflect.get(candidate.cardRef, "id") : null);
        assert.equal(ids.includes("decrease_1"), change === "rise");
        assert.equal(ids.includes("decrease_2"), change === "rise");
        const selected = required(requirement.candidates.find(candidate => candidate.cardRef && Reflect.get(candidate.cardRef, "id") ===
          (change === "rise" ? "decrease_2" : "increase_1")));
        session.selections[requirement.id] = [selected.key]; chose = true;
      }
      return finish(...args);
    };
    const activation = game.tryActivateMonsterEffect(source, null, "field", owner, { effectId: "tech_zero_multimodal_machine_level_mod" });
    await completeTestSelections(game, activation); assert.equal((await activation).success, true);
    assert.ok(responded && chose);
    assert.equal(target.level, change === "rise" ? 1 : 2);
    assert.equal(source.level, 3); assert.equal(alternative.level, 4);
  });

  for (const change of ["leave", "return", "facedown"] as const) {
    test(`Multimodal cannot replace its declared target after ${change} (${seat})`, async t => {
      const { game, owner, make } = setup(t, seat);
      const source = make(503), target = make(501), alternative = make(504);
      placeFieldCards(owner.field, source, target, alternative);
      const effect = required(source.effects.find(entry => entry.id === "tech_zero_multimodal_machine_level_mod"));
      const prepared = game.chainSystem.createPreparedActivation({ card: source, controller: owner, effect,
        activationZone: "field", committed: true, targetSelections: chainSelections({ [MACHINE_REF]: [target] }) });
      const link = game.chainSystem.addToChain(prepared); assert.ok(link);
      assert.equal(link.declaredTargets.length, 1);
      if (change === "facedown") target.isFacedown = true;
      else {
        await game.moveCard(target, owner, "hand", { fromZone: "field" });
        if (change === "return") {
          game.ui.showTriggerOrderModal = async options => options?.optional ? []
            : (options?.candidates || []).map(candidate => candidate.candidateId);
          await game.moveCard(target, owner, "field", { fromZone: "hand",
            position: "attack", summonMethodOverride: "special", summonOrigin: "effect_resolution" });
        }
      }
      const resolution = Promise.resolve(game.chainSystem.resolveChain());
      await completeTestSelections(game, resolution); await resolution;
      assert.equal(source.level, 3); assert.equal(alternative.level, 4); assert.equal(target.level, 1);
    });
  }
}

test("level-case previews bind an explicit reference and never replace it with another candidate", t => {
  const { game, owner, make } = setup(t);
  const source = make(503), low = make(501), high = make(504);
  placeFieldCards(owner.field, source, low, high);
  const effect: EffectDefinition = { ...required(source.effects[0]), targets: [{ id: MACHINE_REF,
    owner: "self", zone: "field", cardKind: "monster", requireFaceup: true, count: { min: 1, max: 1 } }] };
  const condition = [{ type: "targetRefMatchesFilters", targetRef: MACHINE_REF, filters: { minLevel: 3 } }] as const;
  const base = { source, player: owner, effect, activationContext: { preview: true } };
  assert.equal(game.effectEngine.evaluateConditions(condition, base).ok, true, "unbound preview can inspect declared candidates");
  assert.equal(game.effectEngine.evaluateConditions(condition, { ...base, _actionTargets: { [MACHINE_REF]: [low] } }).ok, false);
  assert.equal(game.effectEngine.evaluateConditions(condition, { ...base, _actionTargets: { [MACHINE_REF]: [] } }).ok, false);
  assert.equal(game.effectEngine.evaluateConditions(condition, { ...base, activationContext: { preview: true,
    targetSelections: { [MACHINE_REF]: [low] } } }).ok, false);
  assert.equal(game.effectEngine.evaluateConditions(condition, { ...base, activationContext: { preview: true,
    targetSelections: { [MACHINE_REF]: [] } } }).ok, false);
  owner.controllerType = "ai";
  assert.equal(game.effectEngine.evaluateConditions(condition, { ...base, activationContext: { preview: true,
    decisions: { selections: { [MACHINE_REF]: [high.instanceId] } } } }).ok, true);
  assert.equal(game.effectEngine.evaluateConditions(condition, { ...base, activationContext: { preview: true,
    decisions: { selections: { [MACHINE_REF]: [low.instanceId] } } } }).ok, false);
  assert.equal(game.effectEngine.evaluateConditions(condition, { ...base, activationContext: { preview: false } }).ok, false);
});
