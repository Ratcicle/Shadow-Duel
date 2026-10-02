import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import Player from "../../src/core/Player.js";
import ArcanistStrategy from "../../src/core/ai/ArcanistStrategy.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { destroySimulatedCard, replaceSimulatedBattleDestruction } from "../../src/core/ai/common/simulatedActions/destruction.js";
import { applyGenericSimulatedMainPhaseAction, emitSimulatedSpellActivation, resolveSimulatedEndPhase } from "../../src/core/ai/common/simulation.js";
import { canUseSimulatedEffectUsage, markSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { moveCardToZone, appendSimulatedFieldCard } from "../../src/core/ai/common/zones.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { simulationState } from "../helpers/simulation.js";

const make = (id: number, owner = "bot") => createPlanningCopy().cloneCardForSim(new Card(cardDefinition(id), owner));
const strategy = () => new ArcanistStrategy(new Player("bot", "Bot"));
const equip = (host: ReturnType<typeof make>, spell = make(301)) => {
  spell.equippedTo = host; host.equips = [spell]; return spell;
};
const activeState = () => ({ turn: "bot", phase: "main1", turnCounter: 3, _isPerspectiveState: true as const });

test("301 copies costs and targets while retaining only its own per-copy usage", () => {
  const host = make(302); const grimoire = equip(host); const cost = make(301);
  // A synthetic second Equip isolates copied payment while the source remains.
  cost.name = "Synthetic Arcanist Equip";
  const enemy = make(307, "player"); const original = make(316);
  const state = simulationState({ ...activeState(), bot: { field: [host], spellTrap: [grimoire, cost] }, player: { field: [enemy] } });
  const ai = strategy(); ai.simulateArcanistBlueprintStorage(state, original);
  markSimulatedEffectUsage(state, required(original.effects?.[0]), original, "bot");
  ai.simulateMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, cardId: 301, cardName: grimoire.name,
    activationContext: { decisions: { selections: {
      seismic_impact_equip_cost: [required(cost.instanceId)], seismic_impact_target: [required(enemy.instanceId)],
    } } } });
  assert.ok(state.bot.graveyard.includes(cost)); assert.ok(state.player.banished.includes(enemy));
  assert.ok(state.bot.spellTrap.includes(grimoire));
  assert.equal(canUseSimulatedEffectUsage(state, required(grimoire.effects?.find(effect => effect.timing === "ignition")), grimoire), false);
  assert.deepEqual(state._simUnsupportedActions || [], []);
});

test("301 self-payment is legal but its copied effect fizzles after its Equip source leaves", () => {
  const host = make(302); const grimoire = equip(host); const enemy = make(307, "player");
  const state = simulationState({ ...activeState(), bot: { field: [host], spellTrap: [grimoire] }, player: { field: [enemy] } });
  const ai = strategy(); ai.simulateArcanistBlueprintStorage(state, make(316));
  ai.simulateMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, cardId: 301, cardName: grimoire.name });
  assert.ok(state.bot.graveyard.includes(grimoire)); assert.ok(state.player.field.includes(enemy));
  assert.equal(state.player.banished.length, 0);
});

test("301 copies 310 after the original limit was used and never emits another Spell activation", () => {
  const host = make(314); const grimoire = equip(host); const enemy = make(307, "player"); const original = make(310);
  const state = simulationState({ ...activeState(), bot: { field: [host], spellTrap: [grimoire], deck: [make(302), make(307)] }, player: { field: [enemy] } });
  const ai = strategy(); ai.simulateArcanistBlueprintStorage(state, original);
  markSimulatedEffectUsage(state, required(original.effects?.[0]), original, "bot");
  ai.simulateMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, cardId: 301, cardName: grimoire.name });
  assert.equal(state.bot.hand.length, 2); assert.equal(enemy.atk, enemy.baseAtk);
  assert.equal(destroySimulatedCard(host, state.bot, state.player, state, {}), false);
});

test("302 aura suspends with source negation and resumes without a second grant", () => {
  const apprentice = make(302); const ally = make(307); const grimoire = equip(apprentice);
  const state = simulationState({ ...activeState(), bot: { field: [apprentice, ally], spellTrap: [grimoire] } });
  const ai = strategy();
  ai.applySimulatedArcanistPassiveStats(state);
  assert.equal(ally.atk, required(ally.baseAtk) + 300);
  apprentice.effectsNegated = true;
  ai.applySimulatedArcanistPassiveStats(state);
  assert.equal(ally.atk, ally.baseAtk);
  apprentice.effectsNegated = false;
  ai.applySimulatedArcanistPassiveStats(state);
  assert.equal(ally.atk, required(ally.baseAtk) + 300);
});

test("303 captures ATK immediately before each sequential destruction", () => {
  const first = make(302); const second = make(307, "player");
  const state = simulationState({ ...activeState(), bot: { field: [first] }, player: { field: [second] } });
  applySimulatedActions({ state, actions: [{ type: "destroy_and_damage_by_target_atk", entries: [
    { targetRef: "first", multiplier: 0.5 }, { targetRef: "second", multiplier: 0.5 },
  ] }], selections: { first: [first], second: [second] }, options: {
    sourceCard: make(303), emitSimulatedEvent: (event) => {
      if (event === "card_moved" && state.bot.graveyard.includes(first)) second.atk = 200;
    },
  } });
  assert.equal(state.bot.lp, 7250);
  assert.equal(state.player.lp, 7900);
});

test("304 attack bonus and piercing expire at the end of this turn", () => {
  const host = make(302); const spell = make(304);
  const state = simulationState({ ...activeState(), bot: { field: [host], hand: [spell] } });
  strategy().simulateMainPhaseAction(state, { type: "spell", cardId: 304, cardName: spell.name, index: 0 });
  assert.equal(host.atk, required(host.baseAtk) + 500); assert.equal(host.piercing, true);
  resolveSimulatedEndPhase(state);
  assert.equal(host.atk, host.baseAtk); assert.equal(host.piercing, false);
});

test("307 uses a costless hand summon procedure with its own hard limit", () => {
  const host = make(302); const albus = make(307); const second = make(307);
  const state = simulationState({ ...activeState(), bot: { field: [host], hand: [albus, second] } });
  const perform = () => applyGenericSimulatedMainPhaseAction(state, { type: "handSummonProcedure", index: 0,
    cardId: 307, materials: [], position: "defense" });
  perform(); perform();
  assert.equal(state.bot.field.length, 2); assert.equal(state.bot.hand.length, 1);
  assert.equal(state.bot.field[1]?.position, "defense");
  assert.equal(state.bot.field[1]?.lastSummonProcedure, albus.handSummonProcedure?.id);
  assert.deepEqual(state._simUnsupportedActions || [], []);
});

test("301 cannot store a resolved Spell while its effects are negated", () => {
  const host = make(302); const grimoire = equip(host); const spell = make(304);
  grimoire.effectsNegated = true;
  const state = simulationState({ ...activeState(), bot: { field: [host], spellTrap: [grimoire], hand: [spell] } });
  strategy().simulateMainPhaseAction(state, { type: "spell", cardId: 304, cardName: spell.name, index: 0 });
  assert.equal(grimoire.state?.blueprintStorage?.storedBlueprints?.length || 0, 0);
});

test("Arcanist candidates use the new Albus procedure and Elementalist ignition", () => {
  const host = make(313); const albus = make(307); const grimoire = equip(host); const enemy = make(302, "player");
  const state = simulationState({ ...activeState(), bot: { field: [host], hand: [albus], spellTrap: [grimoire] }, player: { field: [enemy] } });
  const ai = strategy(); const actions = ai.generateMainPhaseActions(state);
  assert.ok(actions.some(action => action.type === "handSummonProcedure" && action.cardId === 307));
  assert.equal(actions.some(action => action.type === "handIgnition" && action.cardId === 307), false);
  assert.ok(actions.some(action => action.type === "monsterEffect" && action.cardId === 313));
});

test("309 each copy can prevent one spell destruction independently", () => {
  const first = make(309); const second = make(309); const target = make(311);
  const state = simulationState({ ...activeState(), bot: { spellTrap: [first, second, target] } });
  assert.equal(destroySimulatedCard(target, state.bot, state.player, state, {}), false);
  assert.equal(destroySimulatedCard(target, state.bot, state.player, state, {}), false);
  assert.equal(destroySimulatedCard(target, state.bot, state.player, state, {}), true);
});

test("310 protects only its target once across battle and effects and draws two when equipped", () => {
  const host = make(302); const ally = make(307); const grimoire = equip(host); const spell = make(310);
  const state = simulationState({ ...activeState(), bot: { field: [host, ally], spellTrap: [grimoire], hand: [spell], deck: [make(304), make(303)] } });
  strategy().simulateMainPhaseAction(state, { type: "spell", cardId: 310, cardName: spell.name, index: 0,
    activationContext: { decisions: { selections: { arcanist_ice_barrier_target: [required(host.instanceId)] } } } });
  assert.equal(state.bot.hand.length, 2);
  assert.equal(destroySimulatedCard(ally, state.bot, state.player, state, {}), true);
  assert.ok(replaceSimulatedBattleDestruction(state, host));
  assert.equal(destroySimulatedCard(host, state.bot, state.player, state, {}), true);
});

test("310 replacement expires after next turn and never follows a new presence", () => {
  for (const leave of [false, true]) {
    const host = make(302); const state = simulationState({ ...activeState(), bot: { field: [host] } });
    applySimulatedActions({ state, selections: { target: [host] }, options: { sourceCard: make(310) }, actions: [{
      type: "register_replacement_effect", targetRef: "target", uses: 1, duration: "end_of_next_turn",
      replacementEffect: { type: "destruction", reason: "any", targetZones: ["field"] },
    }] });
    if (leave) { moveCardToZone(state.bot, host, "hand", state.bot, { state }); moveCardToZone(state.bot, host, "field", state.bot, { state }); }
    else state.turnCounter = 5;
    assert.equal(destroySimulatedCard(host, state.bot, state.player, state, {}), true);
  }
});

test("310 original and Grimoire copy keep independent target protections", () => {
  const host = make(302); const ally = make(307); const grimoire = equip(host); const spell = make(310);
  const state = simulationState({ ...activeState(), bot: { field: [host, ally], spellTrap: [grimoire], hand: [spell] } });
  const ai = strategy();
  ai.simulateMainPhaseAction(state, { type: "spell", cardId: 310, cardName: spell.name, index: 0,
    activationContext: { decisions: { selections: { arcanist_ice_barrier_target: [required(ally.instanceId)] } } } });
  ai.simulateMainPhaseAction(state, { type: "spellTrapEffect", cardId: 301, cardName: grimoire.name, zoneIndex: 0,
    activationContext: { decisions: { selections: { arcanist_ice_barrier_target: [required(host.instanceId)] } } } });
  assert.equal(state._simReplacementEffects?.length, 2);
  assert.ok(replaceSimulatedBattleDestruction(state, ally));
  assert.equal(destroySimulatedCard(host, state.bot, state.player, state, {}), false);
  assert.equal(destroySimulatedCard(ally, state.bot, state.player, state, {}), true);
  assert.equal(destroySimulatedCard(host, state.bot, state.player, state, {}), true);
});

test("313 equip creates no destruction trigger and intrinsic protection suspends while negated", () => {
  const host = make(313); const enemy = make(307, "player"); const grimoire = make(301);
  const state = simulationState({ ...activeState(), bot: { field: [host], hand: [grimoire] }, player: { field: [enemy] } });
  strategy().simulateMainPhaseAction(state, { type: "spell", cardId: 301, cardName: grimoire.name, index: 0 });
  assert.ok(state.player.field.includes(enemy));
  assert.equal(destroySimulatedCard(host, state.bot, state.player, state, {}), false);
  host.effectsNegated = true;
  assert.equal(destroySimulatedCard(host, state.bot, state.player, state, {}), true);
});

test("314 spell event debuffs only witnessed targets and does not reverse on source exit", () => {
  const azrath = make(314); const enemy = make(307, "player"); const late = make(307, "player"); const spell = make(304);
  const state = simulationState({ ...activeState(), bot: { field: [azrath], hand: [spell] }, player: { field: [enemy] } });
  const ai = strategy();
  ai.simulateMainPhaseAction(state, { type: "spell", cardId: 304, cardName: spell.name, index: 0,
    activationContext: { decisions: { selections: { lightning_magic_lance_target: [required(azrath.instanceId)] } } } });
  assert.equal(enemy.atk, required(enemy.baseAtk) - 100);
  appendSimulatedFieldCard(state.player.field, late); ai.applySimulatedArcanistPassiveStats(state);
  assert.equal(late.atk, late.baseAtk);
  moveCardToZone(state.bot, azrath, "graveyard", state.bot, { state }); ai.applySimulatedArcanistPassiveStats(state);
  assert.equal(enemy.atk, required(enemy.baseAtk) - 100);
});

test("314 does not witness earlier or opposing activations and temporary reductions expire", () => {
  const azrath = make(314); const enemy = make(307, "player");
  const state = simulationState({ ...activeState(), bot: { hand: [azrath] }, player: { field: [enemy] } });
  emitSimulatedSpellActivation(state, make(304));
  moveCardToZone(state.bot, azrath, "field", state.bot, { state });
  emitSimulatedSpellActivation(state, make(304, "player"), "player");
  assert.equal(enemy.atk, enemy.baseAtk);
  emitSimulatedSpellActivation(state, make(304)); assert.equal(enemy.atk, required(enemy.baseAtk) - 100);
  resolveSimulatedEndPhase(state); assert.equal(enemy.atk, enemy.baseAtk);
});

for (const id of [301, 304, 309, 311, 312]) {
  for (const wasSet of id === 312 || id === 301 ? [false] : [false, true]) {
    test(`314 witnesses Spell ${id} exactly once when activated from ${wasSet ? "set" : "hand"}`, () => {
      const azrath = make(314); const enemy = make(307, "player"); const spell = make(id);
      spell.isFacedown = wasSet;
      const state = simulationState({ ...activeState(), bot: { field: [azrath],
        hand: wasSet ? [] : [spell], spellTrap: wasSet ? [spell] : [] }, player: { field: [enemy] } });
      strategy().simulateMainPhaseAction(state, wasSet
        ? { type: "spellTrapEffect", cardId: id, cardName: spell.name, zoneIndex: 0 }
        : { type: "spell", cardId: id, cardName: spell.name, index: 0 });
      const factor = id === 301 ? 0.5 : 1; // Equipping Azrath also halves the current stats.
      assert.equal(enemy.atk, Math.floor((required(enemy.baseAtk) - 100) * factor));
      assert.equal(enemy.def, Math.floor((required(enemy.baseDef) - 100) * factor));
    });
  }
}

test("314 does not treat the field Spell ignition as a Spell activation", () => {
  const azrath = make(314); const enemy = make(307, "player"); const library = make(312);
  const state = simulationState({ ...activeState(), bot: { field: [azrath], fieldSpell: library }, player: { field: [enemy] } });
  strategy().simulateMainPhaseAction(state, { type: "fieldEffect", cardId: 312, cardName: library.name });
  assert.equal(enemy.atk, enemy.baseAtk);
  assert.equal(enemy.def, enemy.baseDef);
});

test("310 protections from consecutive turns remain independent", () => {
  const first = make(302); const second = make(307); const spell = make(310);
  const state = simulationState({ ...activeState(), bot: { field: [first, second] } });
  const action = required(required(spell.effects?.[0]).actions?.[0]);
  for (const target of [first, second]) {
    applySimulatedActions({ state, actions: [action], selections: { arcanist_ice_barrier_target: [target] }, options: { sourceCard: spell } });
    state.turnCounter += 1;
  }
  state.turnCounter = 4;
  assert.equal(state._simReplacementEffects?.length, 2);
  assert.ok(replaceSimulatedBattleDestruction(state, first));
  assert.ok(replaceSimulatedBattleDestruction(state, second));
});

test("310 protection follows the same field presence after control changes", () => {
  const host = make(302); const spell = make(310);
  const state = simulationState({ ...activeState(), bot: { field: [host] } });
  applySimulatedActions({ state, actions: [required(required(spell.effects?.[0]).actions?.[0])],
    selections: { arcanist_ice_barrier_target: [host] }, options: { sourceCard: spell } });
  applySimulatedActions({ state, selfId: "player", actions: [{ type: "take_control", targetRef: "target" }], selections: { target: [host] } });
  assert.ok(state.player.field.includes(host));
  assert.equal(destroySimulatedCard(host, state.player, state.bot, state, {}), false);
  assert.equal(destroySimulatedCard(host, state.player, state.bot, state, {}), true);
});
