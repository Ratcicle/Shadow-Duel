import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import Player from "../../src/core/Player.js";
import ArcanistStrategy from "../../src/core/ai/ArcanistStrategy.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { canUseSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { moveCardToZone } from "../../src/core/ai/common/zones.js";
import { evaluateSimulatedConditions } from "../../src/core/ai/common/simulatedConditions.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { simulationState } from "../helpers/simulation.js";
import { createRuntimeGame } from "../helpers/game.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";

const make = (id: number, owner = "bot") => createPlanningCopy().cloneCardForSim(new Card(cardDefinition(id), owner));
const strategy = () => new ArcanistStrategy(new Player("bot", "Bot"));
const activeState = () => ({ turn: "bot", phase: "main1", turnCounter: 3, _isPerspectiveState: true as const });

test("312 simulation accepts a legal 2100 LP activation while strategy preserves its 2200 reserve", () => {
  const library = make(312); const recruit = make(302);
  const state = simulationState({ ...activeState(), bot: { fieldSpell: library, deck: [recruit], lp: 2100 } });
  const ai = strategy();
  assert.equal(ai.generateMainPhaseActions(state).some(action => action.type === "fieldEffect"), false);
  ai.simulateMainPhaseAction(state, { type: "fieldEffect", cardId: 312 });
  assert.equal(state.bot.lp, 100);
  assert.equal(state.bot.field[0]?.instanceId, recruit.instanceId);
  assert.equal(canUseSimulatedEffectUsage(state, required(library.effects?.find(effect => effect.timing === "ignition")), library), false);
});

test("312 rejects recruitment with any monster present without spending LP or its use", () => {
  const library = make(312); const other = make(302); other.archetype = "Other";
  const state = simulationState({ ...activeState(), bot: { fieldSpell: library, field: [other], deck: [make(307)] } });
  strategy().simulateMainPhaseAction(state, { type: "fieldEffect", cardId: 312 });
  assert.equal(state.bot.lp, 8000);
  assert.equal(state.bot.field.length, 1);
  assert.equal(canUseSimulatedEffectUsage(state, required(library.effects?.find(effect => effect.timing === "ignition")), library), true);
});

test("312 pays its activation cost but cannot summon while the field source is negated", () => {
  const library = make(312); library.effectsNegated = true;
  const state = simulationState({ ...activeState(), bot: { fieldSpell: library, deck: [make(302)] } });
  strategy().simulateMainPhaseAction(state, { type: "fieldEffect", cardId: 312 });
  assert.equal(state.bot.lp, 6000);
  assert.equal(state.bot.field.length, 0);
  assert.equal(canUseSimulatedEffectUsage(state, required(library.effects?.find(effect => effect.timing === "ignition")), library), false);
});

test("field effects with an unaffordable declarative LP cost do not spend their usage", () => {
  const source = make(312);
  source.effects = [{ id: "synthetic_field_cost", timing: "ignition", activationZones: ["fieldSpell"], oncePerTurn: true,
    activationCosts: [{ type: "pay_lp", amount: 2000 }], actions: [{ type: "heal", amount: 500 }] }];
  const state = simulationState({ ...activeState(), bot: { fieldSpell: source, lp: 1999 } });
  applyGenericSimulatedMainPhaseAction(state, { type: "fieldEffect", cardId: 312 });
  assert.equal(state.bot.lp, 1999);
  assert.equal(canUseSimulatedEffectUsage(state, required(source.effects[0]), source), true);
});

test("field effects can pay all remaining LP and consume their parent usage", () => {
  const source = make(312);
  source.effects = [{ id: "synthetic_field_cost", timing: "ignition", activationZones: ["fieldSpell"], oncePerTurn: true,
    activationCosts: [{ type: "pay_lp", amount: 2000 }], actions: [] }];
  const state = simulationState({ ...activeState(), bot: { fieldSpell: source, lp: 2000 } });
  applyGenericSimulatedMainPhaseAction(state, { type: "fieldEffect", cardId: 312 });
  assert.equal(state.bot.lp, 0);
  assert.equal(canUseSimulatedEffectUsage(state, required(source.effects[0]), source), false);
});

for (const lp of [1999, 2000, 2001]) {
  test(`simulated LP payment matches runtime at ${lp} LP with a 2000 LP cost`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
    t.after(() => game.dispose("lp_cost_parity"));
    game.bot.lp = lp;
    const source = new Card(cardDefinition(312), "bot");
    const state = simulationState({ ...activeState(), bot: { lp } });
    const actions = [{ type: "pay_lp" as const, amount: 2000 }];
    const runtimeResult = await game.effectEngine.applyActions(actions, { source, player: game.bot, opponent: game.player }, {});
    const simulatedPaid = applySimulatedActions({ actions, state });
    assert.equal(runtimeResult.success, lp >= 2000);
    assert.equal(simulatedPaid, runtimeResult.success);
    assert.equal(state.bot.lp, game.bot.lp);
    assert.equal(state.bot.lp, lp >= 2000 ? lp - 2000 : lp);
  });
}

test("spell effects reject a counter activation cost before removing any counters", () => {
  const source = make(311); source.counters = new Map([["ink", 1]]);
  source.effects = [{ id: "synthetic_counter_cost", timing: "ignition", activationZones: ["spellTrap"], oncePerTurn: true,
    activationCosts: [{ type: "remove_counter", targetRef: "self", counterType: "ink", amount: 2 }],
    actions: [{ type: "heal", amount: 500 }] }];
  const state = simulationState({ ...activeState(), bot: { spellTrap: [source] } });
  applyGenericSimulatedMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, cardId: 311 });
  assert.equal(source.counters.get("ink"), 1);
  assert.equal(state.bot.lp, 8000);
  assert.equal(canUseSimulatedEffectUsage(state, required(source.effects[0]), source), true);
});

test("activation modes freeze exact intent before cost payment and share the parent usage", () => {
  const source = make(309); const spell = make(304); const monster = make(302);
  source.effects = [{ id: "mode_parent", timing: "ignition", activationZones: ["spellTrap"], oncePerTurn: true,
    activationCases: [
      { id: "discard_spell", targets: [{ id: "mode_cost", owner: "self", zone: "hand", cardKind: "spell", intent: "cost", count: { min: 1, max: 1 } }],
        activationCosts: [{ type: "move", targetRef: "mode_cost", fromZone: "hand", to: "graveyard", requireAll: true, requireDestination: true }],
        actions: [{ type: "heal", amount: 200 }] },
      { id: "discard_monster", targets: [{ id: "mode_cost", owner: "self", zone: "hand", cardKind: "monster", intent: "cost", count: { min: 1, max: 1 } }],
        activationCosts: [{ type: "move", targetRef: "mode_cost", fromZone: "hand", to: "graveyard", requireAll: true, requireDestination: true }],
        actions: [{ type: "heal", amount: 400 }] },
    ] }];
  const state = simulationState({ ...activeState(), bot: { spellTrap: [source], hand: [spell, monster] } });
  applyGenericSimulatedMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, cardId: 309,
    activationContext: { decisions: { cases: { mode_parent: "discard_monster" } } } });
  assert.ok(state.bot.graveyard.includes(monster));
  assert.ok(state.bot.hand.includes(spell));
  assert.equal(state.bot.lp, 8400);
  assert.equal(canUseSimulatedEffectUsage(state, required(source.effects[0]), source), false);
  applyGenericSimulatedMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, cardId: 309,
    activationContext: { decisions: { cases: { mode_parent: "discard_spell" } } } });
  assert.ok(state.bot.hand.includes(spell));
  assert.equal(state.bot.lp, 8400);
});

test("an unavailable exact activation mode never falls back to another payable mode", () => {
  const source = make(312);
  source.effects = [{ id: "mode_parent", timing: "ignition", activationZones: ["fieldSpell"], oncePerTurn: true,
    activationCases: [
      { id: "unpayable", activationCosts: [{ type: "pay_lp", amount: 8001 }], actions: [{ type: "heal", amount: 200 }] },
      { id: "free", actions: [{ type: "heal", amount: 400 }] },
    ] }];
  const state = simulationState({ ...activeState(), bot: { fieldSpell: source } });
  applyGenericSimulatedMainPhaseAction(state, { type: "fieldEffect", cardId: 312,
    activationContext: { decisions: { cases: { mode_parent: "unpayable" } } } });
  assert.equal(state.bot.lp, 8000);
  assert.equal(canUseSimulatedEffectUsage(state, required(source.effects[0]), source), true);
});

test("Arcanist generated actions carry stable payable activation mode IDs", () => {
  const meeting = make(309); const library = make(312);
  const state = simulationState({ ...activeState(), bot: { fieldSpell: library, spellTrap: [meeting],
    hand: [make(304), make(311)], deck: [make(302)] } });
  const actions = strategy().generateMainPhaseActions(state);
  const libraryAction = required(actions.find(action => action.type === "fieldEffect"));
  const meetingAction = required(actions.find(action => action.type === "spellTrapEffect" && action.cardId === 309));
  assert.equal(libraryAction.activationContext?.decisions?.cases?.arcanist_grand_library_ignition, "arcanist_grand_library_summon");
  assert.equal(meetingAction.activationContext?.decisions?.cases?.meeting_arcanists_choose_effect, "meeting_arcanists_discard_spells");
});

test("Arcanist generation excludes modes with no remaining deck candidate", () => {
  const meeting = make(309); const library = make(312);
  const state = simulationState({ ...activeState(), bot: { fieldSpell: library, spellTrap: [meeting],
    hand: [make(304), make(311)] } });
  const actions = strategy().generateMainPhaseActions(state);
  assert.equal(actions.some(action => action.type === "fieldEffect" || action.type === "spellTrapEffect" && action.cardId === 309), false);
});

for (const actor of ["bot", "player"] as const) {
  for (const cardKind of ["monsters", "spells"] as const) {
    test(`309 pays both exact ${cardKind} before resolution and keeps its mode (${actor})`, () => {
      const source = make(309, actor); const first = make(cardKind === "monsters" ? 302 : 304, actor);
      const second = make(cardKind === "monsters" ? 307 : 311, actor);
      const reward = make(cardKind === "monsters" ? 304 : 302, actor);
      const caseId = `meeting_arcanists_discard_${cardKind}`;
      const state = simulationState({ ...activeState(), bot: { id: actor, spellTrap: [source], hand: [first, second], deck: [reward] },
        player: { id: actor === "bot" ? "player" : "bot" } });
      const seen: number[] = [];
      applyGenericSimulatedMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, cardId: 309,
        activationContext: { decisions: { cases: { meeting_arcanists_choose_effect: caseId },
          selections: { [caseId]: [required(first.instanceId), required(second.instanceId)] } } } }, {
        enableSimulatedEvents: true,
        onSimulatedEvent(event) {
          if (event === "card_moved") { seen.push(state.bot.graveyard.length); assert.equal(state.bot.hand.includes(reward), false); }
        },
      });
      assert.deepEqual(seen, [1, 2]);
      assert.ok(state.bot.hand.includes(reward));
      assert.equal(state.bot.graveyard.length, 2);
      assert.equal(canUseSimulatedEffectUsage(state, required(source.effects?.find(effect => effect.timing === "ignition")), source), false);
    });
  }
}

for (const unavailable of ["negated", "departed"] as const) {
  test(`309 keeps discarded costs when its continuous source becomes ${unavailable}`, () => {
    const source = make(309); const first = make(302); const second = make(307); const reward = make(304);
    const state = simulationState({ ...activeState(), bot: { spellTrap: [source], hand: [first, second], deck: [reward] } });
    applyGenericSimulatedMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, cardId: 309,
      activationContext: { decisions: { cases: { meeting_arcanists_choose_effect: "meeting_arcanists_discard_monsters" } } } }, {
      enableSimulatedEvents: true,
      onSimulatedEvent(event) {
        if (event !== "card_moved" || !state.bot.graveyard.includes(first)) return;
        if (unavailable === "negated") source.effectsNegated = true;
        else moveCardToZone(state.bot, source, "graveyard", state.bot, { state });
      },
    });
    assert.ok(state.bot.graveyard.includes(first));
    assert.ok(state.bot.graveyard.includes(second));
    assert.ok(state.bot.deck.includes(reward));
    assert.equal(canUseSimulatedEffectUsage(state, required(source.effects?.find(effect => effect.timing === "ignition")), source), false);
  });
}

test("311 removes the two activation counters even when negated and leaves recovery unresolved", () => {
  const source = make(311); source.counters = new Map([["ink", 2]]); source.effectsNegated = true;
  const recovered = make(304);
  const state = simulationState({ ...activeState(), bot: { spellTrap: [source], graveyard: [recovered] } });
  applyGenericSimulatedMainPhaseAction(state, { type: "spellTrapEffect", cardId: 311, zoneIndex: 0 });
  assert.equal(source.counters.get("ink"), 0);
  assert.ok(state.bot.graveyard.includes(recovered));
  assert.equal(state.bot.hand.length, 0);
});

test("312 position and recruited instance are resolved with the canonical exact summon decision", () => {
  const library = make(312); const first = make(302); const second = make(306);
  const state = simulationState({ ...activeState(), bot: { fieldSpell: library, deck: [first, second] } });
  applyGenericSimulatedMainPhaseAction(state, { type: "fieldEffect", cardId: 312,
    activationContext: { decisions: { cases: { arcanist_grand_library_ignition: "arcanist_grand_library_summon" },
      specialSummons: { arcanist_grand_library_ignition: [required(second.instanceId)] } },
    } }, { chooseSpecialSummonPosition: () => "defense" });
  assert.equal(state.bot.field[0]?.instanceId, second.instanceId);
  assert.equal(state.bot.field[0]?.position, "defense");
  assert.equal(state.bot.lp, 6000);
});

for (const validity of ["active", "other_host", "outside_spell_trap", "opponent_host", "facedown"] as const) {
  test(`315 simulation requires a valid controlled equipped host: ${validity}`, () => {
    const own = make(302); const enemy = make(307, "player"); const equip = make(301);
    equip.equippedTo = validity === "other_host" || validity === "opponent_host" ? enemy : own;
    own.equips = validity === "opponent_host" ? [] : [equip];
    enemy.equips = validity === "opponent_host" ? [equip] : [];
    equip.isFacedown = validity === "facedown";
    const state = simulationState({ ...activeState(), bot: { field: [own],
      spellTrap: validity === "outside_spell_trap" ? [] : [equip],
      graveyard: validity === "outside_spell_trap" ? [equip] : [] }, player: { field: [enemy] } });
    const tornado = make(315); const effect = required(tornado.effects?.[0]);
    assert.equal(evaluateSimulatedConditions(effect.conditions, { state, sourceCard: tornado }), validity === "active");
  });
}
