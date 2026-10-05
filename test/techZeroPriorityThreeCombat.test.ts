import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition, chainSelections, required } from "./helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "./helpers/game.js";

type Seat = "player" | "bot";
type Controller = "human" | "ai";
type Role = "attack" | "defend";
const BATTLE_REF = "tech_zero_ghost_samurai_battle_target";

function setup(t: TestContext, seat: Seat, controller: Controller, role: Role) {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false,
    disableChains: false, captureReplay: false, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose("techzero_priority_three_combat"));
  game.turn = role === "attack" ? seat : seat === "player" ? "bot" : "player";
  game.turnCounter = 4; game.phase = "battle"; game.battleStep = "battle";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  game.player.strategy = game.bot.strategy = null;
  const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
  owner.controllerType = controller;
  game.ui.showConfirmPrompt = async () => true;
  game.ui.showChainResponseModal = async () => null;
  game.chainSystem.botChooseChainResponse = async () => null;
  const source = new Card(cardDefinition(511), owner.id);
  source.lastSummonMethod = "synchro";
  const other = new Card({ name: "Special Summoned battle participant", cardKind: "monster",
    atk: 1000, def: 1000, level: 4, effects: [] }, opponent.id);
  other.lastSummonMethod = "special";
  placeFieldCards(owner.field, source); placeFieldCards(opponent.field, other);
  const effectId = `tech_zero_ghost_samurai_${role}_special_summoned_boost`;
  const effect = required(source.effects.find(entry => entry.id === effectId));
  return { game, owner, opponent, source, other, effect, effectId,
    battle: () => game.resolveCombat(role === "attack" ? source : other, role === "attack" ? other : source) };
}

function observe(scenario: ReturnType<typeof setup>) {
  const { game, owner, source, effectId } = scenario;
  const targeted: object[] = [];
  const activations: Array<{ declared: object[]; referenceCards: object[];
    selectedReference: boolean; paidActions: number; costRefs: string[] }> = [];
  const completed: Array<{ atk: number; temp: number }> = [];
  const timings: Array<{ timing: string; atk: number; temp: number; inField: boolean; inGrave: boolean }> = [];
  let selections = 0, targetModals = 0;
  const startSelection = game.startTargetSelectionSession.bind(game);
  game.startTargetSelectionSession = input => { selections++; return startSelection(input); };
  const showTargetSelection = game.ui.showTargetSelection.bind(game.ui);
  game.ui.showTargetSelection = (...args) => { targetModals++; return showTargetSelection(...args); };
  game.on("effect_targeted", event => { if (event.source === source) targeted.push(event.target); });
  game.on("effect_activated", event => {
    if (event.sourceCard !== source || event.effectId !== effectId) return;
    const link = game.chainSystem.getLastChainLink();
    if (!link || link.effectId !== effectId) return;
    activations.push({ declared: link.declaredTargets.flatMap(entry => entry.cards),
      referenceCards: (link.referenceSnapshots || []).flatMap(entry => entry.cards.map(snapshot => snapshot.card)),
      selectedReference: Object.hasOwn(link.targetSelections, BATTLE_REF),
      paidActions: link.costPayment?.actions.length || 0, costRefs: Object.keys(link.costSelections) });
  });
  game.on("chain_link_resolution", event => {
    if (event.effectId === effectId && event.stage === "completed") completed.push({ atk: source.atk, temp: source.tempAtkBoost });
  });
  game.on("damage_step", event => {
    timings.push({ timing: event.damageStepTiming, atk: source.atk, temp: source.tempAtkBoost,
      inField: owner.field.includes(source), inGrave: owner.graveyard.includes(source) });
  });
  return { targeted, activations, completed, timings, selections: () => selections, targetModals: () => targetModals };
}

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const)
for (const role of ["attack", "defend"] as const) {
  test(`B04 Ghost references its ${role} participant without targeting (${seat}, ${controller})`, async t => {
    const scenario = setup(t, seat, controller, role), seen = observe(scenario);
    await scenario.battle();
    assert.deepEqual(seen.targeted, [], "the opponent only establishes the condition for a self boost");
    assert.equal(seen.selections(), 0, "a fixed battle participant never requires a target selection");
    assert.equal(seen.targetModals(), 0, "the contextual reference does not open a target modal");
    assert.deepEqual(seen.activations, [{ declared: [], referenceCards: [scenario.other], selectedReference: false,
      paidActions: 0, costRefs: [] }]);
    assert.deepEqual(seen.completed, [{ atk: 2400, temp: 500 }], "the mandatory bonus resolves exactly once without payment");
    assert.equal(scenario.owner.lp, 8000); assert.equal(scenario.opponent.lp, 6600);
    assert.equal(scenario.source.atk, 1900); assert.equal(scenario.source.tempAtkBoost, 0);
    assert.equal(scenario.game.targetSelection, null);
  });

  test(`B05 Ghost keeps its ${role} bonus through AFTER and END, then clears it (${seat}, ${controller})`, async t => {
    const scenario = setup(t, seat, controller, role), seen = observe(scenario);
    await scenario.battle();
    assert.deepEqual(seen.completed, [{ atk: 2400, temp: 500 }]);
    assert.deepEqual(seen.timings.filter(entry => ["damage_calculation", "after_damage_calculation", "end_of_damage_step"].includes(entry.timing)), [
      { timing: "damage_calculation", atk: 2400, temp: 500, inField: true, inGrave: false },
      { timing: "after_damage_calculation", atk: 2400, temp: 500, inField: true, inGrave: false },
      { timing: "end_of_damage_step", atk: 2400, temp: 500, inField: true, inGrave: false },
    ]);
    assert.equal(scenario.source.atk, 1900); assert.equal(scenario.source.tempAtkBoost, 0);
    assert.deepEqual(scenario.game.endOfDamageStepTempBuffs, []);
    assert.deepEqual(scenario.game.damageCalculationTempBuffs, []);
    assert.equal(scenario.effect.oncePerTurn, undefined, "the battle bonus retains its existing repeatability");
  });

  for (const protection of ["target", "effect"] as const) {
    test(`B04 Ghost's ${role} self boost observes an opponent with ${protection} protection (${seat}, ${controller})`, async t => {
      const scenario = setup(t, seat, controller, role), seen = observe(scenario);
      if (protection === "target") Object.assign(scenario.other, { cannotBeTargeted: true });
      else scenario.other.unaffectedByOtherCardEffects = true;
      await scenario.battle();
      assert.deepEqual(seen.completed, [{ atk: 2400, temp: 500 }], "the protected opponent is an observation, not the recipient of the bonus");
      assert.deepEqual(seen.targeted, []); assert.equal(seen.selections(), 0);
      assert.equal(seen.targetModals(), 0);
      assert.deepEqual(seen.activations.map(entry => entry.declared), [[]]);
      assert.equal(scenario.opponent.lp, 6600); assert.equal(scenario.owner.lp, 8000);
      assert.equal(scenario.source.atk, 1900); assert.equal(scenario.source.tempAtkBoost, 0);
    });
  }

  test(`B04 Ghost's ${role} battle with a Normal Summoned participant ignores another Special Summoned monster (${seat}, ${controller})`, async t => {
    const scenario = setup(t, seat, controller, role), seen = observe(scenario);
    scenario.other.lastSummonMethod = "normal";
    const decoy = new Card({ name: "Unrelated Special Summoned monster", cardKind: "monster",
      atk: 1000, def: 1000, effects: [] }, scenario.opponent.id);
    decoy.lastSummonMethod = "special"; placeFieldCards(scenario.opponent.field, decoy);
    await scenario.battle();
    assert.deepEqual(seen.completed, []); assert.deepEqual(seen.activations, []);
    assert.deepEqual(seen.targeted, []); assert.equal(seen.selections(), 0);
    assert.equal(seen.targetModals(), 0);
    assert.ok(seen.timings.every(entry => entry.atk === 1900 && entry.temp === 0));
    assert.equal(scenario.opponent.lp, 7100); assert.ok(scenario.opponent.field.includes(decoy));
  });

  test(`B05 a Ghost destroyed during its ${role} battle reaches the Graveyard at printed ATK (${seat}, ${controller})`, async t => {
    const scenario = setup(t, seat, controller, role), seen = observe(scenario);
    scenario.other.atk = 3000;
    await scenario.battle();
    assert.deepEqual(seen.completed, [{ atk: 2400, temp: 500 }]);
    assert.deepEqual(seen.timings.filter(entry => entry.timing === "after_damage_calculation"), [
      { timing: "after_damage_calculation", atk: 2400, temp: 500, inField: true, inGrave: false },
    ]);
    assert.ok(scenario.owner.graveyard.includes(scenario.source));
    assert.equal(scenario.owner.field.includes(scenario.source), false);
    assert.equal(scenario.source.atk, 1900, "movement retires the bonus before END cleanup can subtract it twice");
    assert.equal(scenario.source.tempAtkBoost, 0);
    assert.equal(scenario.owner.lp, 7400); assert.equal(scenario.opponent.lp, 8000);
    assert.deepEqual(scenario.game.endOfDamageStepTempBuffs, []);
    assert.deepEqual(scenario.game.damageCalculationTempBuffs, []);
    assert.equal(scenario.game.getDamageStepState().active, false);
  });
}

for (const seat of ["player", "bot"] as const) for (const role of ["attack", "defend"] as const)
for (const change of ["empty", "returned", "control", "face"] as const) {
  test(`B04 frozen ${role} reference rejects ${change} without selecting a replacement (${seat})`, async t => {
    const { game, owner, opponent, source, other, effect } = setup(t, seat, "human", role);
    game.phase = "main1"; game.battleStep = null;
    const decoy = new Card({ name: "Eligible replacement outside the original battle", cardKind: "monster",
      atk: 1000, def: 1000, effects: [] }, opponent.id);
    decoy.lastSummonMethod = "special"; placeFieldCards(opponent.field, decoy);
    const prepared = game.chainSystem.createPreparedActivation({ card: source, controller: owner, opponent,
      effect, activationZone: "field", committed: true, targetSelections: chainSelections({ [BATTLE_REF]: [other] }),
      context: { attacker: role === "attack" ? source : other, defender: role === "attack" ? other : source,
        attackerOwner: role === "attack" ? owner : opponent, defenderOwner: role === "attack" ? opponent : owner },
      ...(change === "empty" ? { referenceSnapshots: [] } : {}) });
    assert.ok(game.chainSystem.addToChain(prepared));
    const link = game.chainSystem.getLastChainLink(); assert.ok(link);
    assert.deepEqual(link.declaredTargets, []);
    assert.deepEqual((link.referenceSnapshots || []).flatMap(entry => entry.cards.map(snapshot => snapshot.card)),
      change === "empty" ? [] : [other]);
    if (change === "returned") {
      const leave = await game.moveCard(other, opponent, "hand", { fromZone: "field", awaitEvents: true });
      assert.equal(leave.success, true);
      const enter = await game.moveCard(other, opponent, "field", { fromZone: "hand", position: "attack",
        summonMethodOverride: "special", summonOrigin: "effect_resolution", awaitEvents: true });
      assert.equal(enter.success, true);
    } else if (change === "control") {
      await game.transferControl(other, owner);
      assert.ok(owner.field.includes(other));
    } else if (change === "face") other.isFacedown = true;
    const targeted: object[] = []; let selections = 0;
    game.on("effect_targeted", event => { if (event.source === source) targeted.push(event.target); });
    const startSelection = game.startTargetSelectionSession.bind(game);
    game.startTargetSelectionSession = input => { selections++; return startSelection(input); };
    await game.chainSystem.resolveChain();
    assert.equal(source.atk, 1900); assert.equal(source.tempAtkBoost, 0);
    assert.equal(link.resolvedWithoutEffect, true, "a required frozen reference cannot be recaptured from live context or another monster");
    assert.deepEqual(targeted, []); assert.equal(selections, 0);
    assert.ok(opponent.field.includes(decoy)); assert.equal(decoy.atk, 1000);
    assert.equal(game.targetSelection, null);
  });
}

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const) {
  test(`Ghost's genuine Synchro recovery still targets the chosen Graveyard Tuner (${seat}, ${controller})`, async t => {
    const { game, owner, opponent, source } = setup(t, seat, controller, "attack");
    game.phase = "main1"; game.battleStep = null;
    const tuner = new Card(cardDefinition(501), owner.id), nonTuner = new Card(cardDefinition(504), owner.id);
    owner.graveyard.push(tuner, nonTuner);
    const targeted: object[] = [], moved: object[] = [];
    const declarations: object[][] = [];
    game.on("effect_targeted", event => { if (event.source === source) targeted.push(event.target); });
    game.on("card_moved", event => { if (event.card === tuner && event.toZone === "hand") moved.push(event.card); });
    game.on("effect_activated", event => {
      if (event.sourceCard !== source || event.effectId !== "tech_zero_ghost_samurai_synchro_recover_tuner") return;
      const link = game.chainSystem.getLastChainLink();
      if (link) declarations.push(link.declaredTargets.flatMap(entry => entry.cards));
    });
    const activation = game.emit("after_summon", { card: source, player: owner, opponent,
      method: "synchro", fromZone: "extraDeck" });
    await completeTestSelections(game, activation); await activation;
    assert.deepEqual(targeted, [tuner]); assert.deepEqual(declarations, [[tuner]]);
    assert.deepEqual(moved, [tuner], "the chosen Tuner moves exactly once");
    assert.ok(owner.hand.includes(tuner)); assert.ok(owner.graveyard.includes(nonTuner));
    assert.equal(source.atk, 1900); assert.equal(source.tempAtkBoost, 0);
    assert.equal(game.targetSelection, null);
  });

  for (const summon of ["normal", "special"] as const) {
    test(`Ghost preserves piercing against a ${summon} Summoned Defense Position monster (${seat}, ${controller})`, async t => {
      const scenario = setup(t, seat, controller, "attack"), seen = observe(scenario);
      scenario.other.position = "defense"; scenario.other.lastSummonMethod = summon;
      await scenario.battle();
      assert.equal(scenario.opponent.lp, summon === "special" ? 6600 : 7100);
      assert.ok(scenario.opponent.graveyard.includes(scenario.other));
      assert.equal(scenario.source.piercing, true);
      assert.deepEqual(seen.completed, summon === "special" ? [{ atk: 2400, temp: 500 }] : []);
      assert.deepEqual(seen.targeted, []); assert.equal(seen.selections(), 0);
      assert.equal(seen.targetModals(), 0);
      assert.equal(scenario.source.atk, 1900); assert.equal(scenario.source.tempAtkBoost, 0);
    });
  }
}
