import assert from "node:assert/strict";
import test from "node:test";
import { moveCardToZone, removeCardFromZones } from "../../src/core/ai/common/zones.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { fingerprintPlanningState } from "../../src/core/ai/common/stateFingerprint.js";
import { resolveSimulatedTemporaryControlEffects } from "../../src/core/ai/common/simulatedActions/movement.js";
import { applyGenericSimulatedMainPhaseAction, resolveSimulatedEndPhase } from "../../src/core/ai/common/simulation.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { placeSimulationCards, simulationCard, simulationState } from "../helpers/simulation.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";
import Bot from "../../src/core/Bot.js";
import Player from "../../src/core/Player.js";
import Card from "../../src/core/Card.js";
import { simulateMainPhaseAction as simulateDragonMainPhaseAction } from "../../src/core/ai/dragon/simulation.js";
import ArcanistStrategy from "../../src/core/ai/ArcanistStrategy.js";
import { ARCANIST_NAMES } from "../../src/core/ai/arcanist/knowledge.js";

function monster(id: number, slot: 0 | 1 | 2 | 3 | 4 | null) {
  return simulationCard({ id, instanceId: id, name: `Monster ${id}`, cardKind: "monster", fieldSlot: slot });
}

test("Dragon simulation rejects hand activation and Set when the spell/trap row is full", () => {
  for (const actionType of ["spell", "set_spell_trap"] as const) {
    const spell = simulationCard({ id: 701, name: "Extreme Dragon Awakening", cardKind: "spell", subtype: "normal", fieldSlot: null });
    const recruit = simulationCard({ id: 702, cardKind: "monster", type: "Dragon", level: 8 });
    const occupants = ([0, 1, 2, 3, 4] as const).map(slot => simulationCard({ id: 710 + slot, cardKind: "trap", fieldSlot: slot }));
    const state = simulationState({ bot: { hand: [spell], deck: [recruit], spellTrap: occupants } });
    simulateDragonMainPhaseAction(state, { type: actionType, index: 0 });
    assert.deepEqual(state.bot.hand, [spell]);
    assert.deepEqual(state.bot.deck, [recruit], "Rejected activation must not resolve its search.");
    assert.deepEqual(state.bot.graveyard, []);
    assert.deepEqual(state.bot.spellTrap, occupants);
    assert.equal(spell.fieldSlot, null);
  }
});

test("Dragon normal Spell occupies the smallest vacancy during its search and frees it afterwards", () => {
  const spell = simulationCard({ id: 721, name: "Extreme Dragon Awakening", cardKind: "spell", subtype: "normal", fieldSlot: null });
  const recruit = simulationCard({ id: 722, name: "Searchable Dragon", cardKind: "monster", type: "Dragon", level: 8 });
  const occupants = ([0, 2, 3, 4] as const).map(slot => simulationCard({ id: 730 + slot, cardKind: "trap", fieldSlot: slot }));
  const state = simulationState({ bot: { hand: [spell], deck: [recruit], spellTrap: occupants.slice() } });
  let inspectedResolution = false;
  Object.defineProperty(recruit, "level", { configurable: true, get: () => {
    inspectedResolution = true;
    const resolving = state.bot.spellTrap.find(card => card.id === spell.id);
    assert.ok(resolving, "The source Spell must occupy a real row position while evaluating its effect.");
    assert.equal(resolving.fieldSlot, 1);
    return 8;
  } });
  simulateDragonMainPhaseAction(state, { type: "spell", index: 0 });
  assert.equal(inspectedResolution, true);
  assert.deepEqual(state.bot.hand, [recruit]);
  assert.deepEqual(state.bot.spellTrap, occupants);
  assert.equal(state.bot.graveyard.find(card => card.id === spell.id)?.fieldSlot, null);
});

test("Dragon persistent Spells and Sets fill a hole without relocating existing cards", () => {
  for (const subtype of ["continuous", "equip", "normal"] as const) {
    const spell = simulationCard({ id: 741, cardKind: "spell", subtype, fieldSlot: null });
    const occupants = ([0, 2, 4] as const).map(slot => simulationCard({ id: 750 + slot, cardKind: "trap", fieldSlot: slot }));
    const state = simulationState({ bot: { hand: [spell], spellTrap: occupants.slice() } });
    simulateDragonMainPhaseAction(state, { type: subtype === "normal" ? "set_spell_trap" : "spell", index: 0 });
    assert.deepEqual(state.bot.spellTrap.map(card => card.fieldSlot), [0, 2, 4, 1]);
    assert.equal(state.bot.spellTrap[3]?.isFacedown === true, subtype === "normal");
    assert.equal(state.bot.hand.length, 0);
    assert.equal(state.bot.graveyard.length, 0);
  }
});

test("Dragon Normal Summon with no Tribute cannot remove a hand card when the field is full", () => {
  const incoming = simulationCard({ id: 761, cardKind: "monster", level: 4, fieldSlot: null });
  const occupants = ([0, 1, 2, 3, 4] as const).map(slot => monster(770 + slot, slot));
  const state = simulationState({ bot: { hand: [incoming], field: occupants.slice() } });
  simulateDragonMainPhaseAction(state, { type: "summon", index: 0 });
  assert.deepEqual(state.bot.hand, [incoming]);
  assert.deepEqual(state.bot.field, occupants);
  assert.equal(state.bot.summonCount, 0);
});

test("Arcanist custom hand Spells cannot bypass a full spell/trap row", () => {
  const strategy = new ArcanistStrategy(new Player("bot", "Bot"));
  for (const name of [ARCANIST_NAMES.GRIMOIRE, ARCANIST_NAMES.SEISMIC_IMPACT]) {
    const spell = simulationCard({ id: 781, name, cardKind: "spell", archetype: "Arcanist", subtype: name === ARCANIST_NAMES.GRIMOIRE ? "equip" : "normal", fieldSlot: null });
    const host = simulationCard({ id: 782, cardKind: "monster", archetype: "Arcanist", fieldSlot: 4 });
    const occupants = ([0, 1, 2, 3, 4] as const).map(slot => simulationCard({ id: 790 + slot, cardKind: "spell", archetype: "Arcanist", subtype: "equip", fieldSlot: slot }));
    host.equips = [occupants[0]!];
    const target = monster(799, 3);
    const state = simulationState({ bot: { hand: [spell], field: [host], spellTrap: occupants.slice() }, player: { field: [target] } });
    strategy.simulateArcanistSpell(state, { type: "spell", index: 0, cardId: spell.id });
    assert.deepEqual(state.bot.hand, [spell]);
    assert.deepEqual(state.bot.spellTrap, occupants);
    assert.deepEqual(host.equips, [occupants[0]!]);
    assert.deepEqual(state.player.field, [target]);
    assert.deepEqual(state.bot.graveyard, []);
  }
});

test("Arcanist Seismic Impact occupies a vacancy until its effect finishes", () => {
  const strategy = new ArcanistStrategy(new Player("bot", "Bot"));
  const spell = simulationCard({ id: 801, name: ARCANIST_NAMES.SEISMIC_IMPACT, cardKind: "spell", archetype: "Arcanist", subtype: "normal", fieldSlot: null });
  const host = simulationCard({ id: 802, cardKind: "monster", archetype: "Arcanist", fieldSlot: 4 });
  const equip = simulationCard({ id: 803, cardKind: "spell", archetype: "Arcanist", subtype: "equip", fieldSlot: 0 });
  host.equips = [equip];
  const target = monster(804, 2);
  const state = simulationState({ bot: { hand: [spell], field: [host], spellTrap: [equip] }, player: { field: [target] } });
  let inspectedResolution = false;
  Object.defineProperty(equip, "equippedTo", { configurable: true, get: () => {
    inspectedResolution = true;
    assert.ok(state.bot.spellTrap.includes(spell));
    assert.equal(spell.fieldSlot, 1);
    return host;
  }, set: () => {} });
  strategy.simulateArcanistSpell(state, { type: "spell", index: 0, cardId: spell.id });
  assert.equal(inspectedResolution, true);
  assert.deepEqual(state.bot.spellTrap, []);
  assert.deepEqual(state.bot.graveyard, [equip, spell]);
  assert.equal(spell.fieldSlot, null);
  assert.equal(equip.fieldSlot, null);
  assert.deepEqual(state.player.banished, [target]);
});

test("simulated removal preserves occupied slots and the next entry fills the hole", () => {
  const cards = [monster(1, 0), monster(2, 1), monster(3, 2)];
  const state = simulationState({ bot: { field: cards.slice() } });
  const middle = cards[1]!;
  assert.equal(moveCardToZone(state.bot, middle, "graveyard"), true);
  assert.deepEqual(state.bot.field.map(card => card.fieldSlot), [0, 2]);
  assert.equal(middle.fieldSlot, null);
  const incoming = monster(4, null);
  state.bot.hand.push(incoming);
  assert.equal(moveCardToZone(state.bot, incoming, "field"), true);
  assert.deepEqual(state.bot.field.map(card => card.fieldSlot), [0, 2, 1]);
});

function temporaryControlFixture(full = false) {
  const borrowed = monster(100, 4);
  borrowed.originalOwner = "bot";
  borrowed.owner = "bot";
  borrowed.controller = "bot";
  borrowed.fieldPresenceId = "borrowed-presence";
  borrowed.location = "field";
  borrowed.position = "defense";
  borrowed.hasAttacked = true;
  const slots = full ? [0, 1, 2, 3, 4] as const : [0, 2] as const;
  const state = simulationState({ turn: "bot", turnCounter: 7,
    bot: { field: [borrowed] },
    player: { field: slots.map(slot => monster(200 + slot, slot)) },
    temporaryControlEffects: [{ id: "temporary-1", cardInstanceId: 100,
      cardDuelCardId: null, sourceDuelCardId: null,
      fieldPresenceId: "borrowed-presence", holderId: "bot", previousControllerId: "player",
      expiresOnTurn: 7, sourceInstanceId: null, createdOnTurn: 7 }],
  });
  return { state, borrowed };
}

test("simulated temporary control returns to the smallest vacancy without leaving the field", () => {
  const { state, borrowed } = temporaryControlFixture();
  const events: string[] = [];
  resolveSimulatedTemporaryControlEffects(state, { emitSimulatedEvent: event => events.push(event) });
  assert.ok(state.player.field.includes(borrowed));
  assert.equal(state.bot.field.length, 0);
  assert.equal(borrowed.fieldSlot, 1);
  assert.equal(borrowed.fieldPresenceId, "borrowed-presence");
  assert.equal(borrowed.position, "defense");
  assert.equal(borrowed.hasAttacked, true);
  assert.equal(borrowed.originalOwner, "bot");
  assert.equal(borrowed.controller, "player");
  assert.deepEqual(events, ["control_changed"]);
  assert.deepEqual(state.temporaryControlEffects, []);
});

test("D2 simulation destroys by rule, frees the holder slot and uses the original owner's GY", () => {
  const { state, borrowed } = temporaryControlFixture(true);
  borrowed.cannotBeDestroyedByBattle = true;
  borrowed.cannotBeDestroyedByCardEffects = true;
  const events: Array<{ event: string; payload: object }> = [];
  resolveSimulatedTemporaryControlEffects(state, { emitSimulatedEvent: (event, payload) => events.push({ event, payload }) });
  assert.ok(state.bot.graveyard.includes(borrowed));
  assert.ok(!state.player.graveyard.includes(borrowed));
  assert.equal(state.bot.field.length, 0);
  assert.equal(borrowed.fieldSlot, null);
  assert.equal(borrowed.fieldPresenceId, null);
  assert.equal(borrowed.controller, "bot");
  assert.deepEqual(events.map(entry => entry.event), ["card_to_grave", "card_moved"]);
  for (const entry of events) {
    assert.equal(Reflect.get(entry.payload, "destroyCause"), "rule");
    assert.equal(Reflect.get(entry.payload, "movedByEffect"), false);
    assert.equal(Reflect.get(entry.payload, "wasDestroyed"), true);
    assert.equal(Reflect.get(entry.payload, "destroySource"), null);
  }
  assert.deepEqual(state.temporaryControlEffects, []);
});

test("D2 simulated generic destruction triggers qualify while battle/effect triggers do not", () => {
  const { state, borrowed } = temporaryControlFixture(true);
  borrowed.effects = [
    { id: "any-destruction", timing: "on_event", event: "card_to_grave", triggerRequirement: "mandatory", triggerTiming: "if", requireSelfAsDestroyed: true,
      actions: [{ type: "heal", amount: 100, player: "self" }] },
    { id: "battle-only", timing: "on_event", event: "card_to_grave", triggerRequirement: "mandatory", triggerTiming: "if", condition: { type: "destroyed_by_battle" },
      actions: [{ type: "heal", amount: 500, player: "self" }] },
    { id: "battle-or-effect", timing: "on_event", event: "card_to_grave", triggerRequirement: "mandatory", triggerTiming: "if", condition: { type: "destroyed_by_battle_or_effect" },
      actions: [{ type: "heal", amount: 500, player: "self" }] },
  ];
  resolveSimulatedEndPhase(state);
  assert.equal(state.bot.lp, 8100);
  assert.equal(state.player.lp, 8000);
});

test("D2 simulated rule removal retains token disappearance, redirection and equipment cleanup", () => {
  for (const token of [false, true]) {
    const { state, borrowed } = temporaryControlFixture(true);
    borrowed.isToken = token;
    borrowed.banishWhenLeavesField = !token;
    const equip = simulationCard({ id: 300, name: "Equip", cardKind: "spell", subtype: "equip", originalOwner: "player", fieldSlot: 2 });
    equip.equippedTo = borrowed;
    equip.equipTarget = borrowed;
    borrowed.equips = [equip];
    placeSimulationCards(state.player.spellTrap, equip);
    resolveSimulatedTemporaryControlEffects(state);
    assert.equal(state.bot.banished.includes(borrowed), !token);
    assert.equal(state.bot.graveyard.includes(borrowed), false);
    assert.equal(state.bot.field.length, 0);
    assert.equal(borrowed.fieldSlot, null);
    assert.ok(state.player.graveyard.includes(equip));
    assert.equal(equip.fieldSlot, null);
    assert.equal(equip.equippedTo, null);
    assert.deepEqual(borrowed.equips, []);
  }
});

test("expired simulated control records cannot affect a later field presence or replacement", () => {
  for (const invalidation of ["left", "reentered", "replaced"] as const) {
    const { state, borrowed } = temporaryControlFixture(true);
    if (invalidation === "replaced") {
      applySimulatedActions({ state, selfId: "player", selections: { target: [borrowed] },
        actions: [{ type: "take_control", player: "self", targetRef: "target" }] });
      // A full destination makes ordinary control fail, without D2 destruction.
      assert.ok(state.bot.field.includes(borrowed));
      state.temporaryControlEffects = [];
    } else {
      moveCardToZone(state.bot, borrowed, "graveyard");
      if (invalidation === "reentered") moveCardToZone(state.bot, borrowed, "field");
    }
    const before = fingerprintPlanningState(state);
    resolveSimulatedTemporaryControlEffects(state, { emitSimulatedEvent: () => assert.fail("Stale record emitted an event") });
    assert.ok(invalidation === "left" ? state.bot.graveyard.includes(borrowed) : state.bot.field.includes(borrowed));
    if (invalidation === "replaced") assert.equal(fingerprintPlanningState(state), before);
  }
});

test("GameTree copies D2 registration and slots without sharing real references", () => {
  const { state, borrowed } = temporaryControlFixture(true);
  const before = fingerprintPlanningState(state);
  const copy = createGameTreeCopy(state).state;
  assert.equal(copy.bot.field[0]?.fieldSlot, 4);
  assert.notEqual(copy.temporaryControlEffects, state.temporaryControlEffects);
  assert.notEqual(copy.temporaryControlEffects?.[0], state.temporaryControlEffects?.[0]);
  resolveSimulatedTemporaryControlEffects(copy);
  assert.equal(copy.bot.field.length, 0);
  assert.ok(state.bot.field.includes(borrowed));
  assert.equal(fingerprintPlanningState(state), before);
});

test("simulated spell/trap rows use independent persistent slots and reject a full row", () => {
  const state = simulationState({ bot: { spellTrap: [0, 1, 2, 3, 4].map((slot, i) =>
    simulationCard({ id: i + 10, name: "Spell", cardKind: "spell", fieldSlot: slot as 0 | 1 | 2 | 3 | 4 })) } });
  const incoming = simulationCard({ id: 20, name: "Spell", cardKind: "spell", fieldSlot: null });
  state.bot.hand.push(incoming);
  assert.equal(moveCardToZone(state.bot, incoming, "spellTrap"), false);
  assert.ok(state.bot.hand.includes(incoming));
  assert.equal(incoming.fieldSlot, null);
  const removed = state.bot.spellTrap[3]!;
  assert.equal(removeCardFromZones(state.bot, removed), true);
  assert.equal(removed.fieldSlot, null);
  assert.equal(moveCardToZone(state.bot, incoming, "spellTrap"), true);
  assert.equal(incoming.fieldSlot, 3);
});

test("planning clones retain positions by value and position-only changes alter the fingerprint", () => {
  const source = monster(1, 4);
  const state = simulationState({ bot: { field: [source] } });
  for (const selective of [false, true]) {
    const copied = createPlanningCopy(selective).cloneCardForSim(source);
    assert.equal(copied.fieldSlot, 4);
    copied.fieldSlot = 0;
    assert.equal(source.fieldSlot, 4);
  }
  const before = fingerprintPlanningState(state);
  source.fieldSlot = 2;
  assert.notEqual(fingerprintPlanningState(state), before);
});

test("a simulated hand spell occupies its slot throughout resolution, then frees it", () => {
  const spell = simulationCard({ id: 400, name: "Temporary spell", cardKind: "spell", subtype: "normal", fieldSlot: null,
    effects: [{ id: "heal", timing: "on_play", actions: [{ type: "choose_action_case", cases: [
      { id: "heal", actions: [{ type: "heal", amount: 10, player: "self" }] },
    ] }] }] });
  const state = simulationState({ _isPerspectiveState: true, bot: { hand: [spell], spellTrap: [0, 2].map(slot =>
    simulationCard({ id: 401 + slot, name: "Set spell", cardKind: "spell", fieldSlot: slot as 0 | 2 })) } });
  let duringResolution = false;
  applyGenericSimulatedMainPhaseAction(state, { type: "spell", index: 0, cardId: 400 }, {
    chooseActionCase(cases) {
      const card = state.bot.spellTrap.find(candidate => candidate.id === spell.id);
      assert.ok(card);
      assert.equal(card.fieldSlot, 1);
      duringResolution = true;
      return cases[0];
    },
  });
  assert.equal(duringResolution, true);
  assert.deepEqual(state.bot.spellTrap.map(card => card.fieldSlot), [0, 2]);
  assert.equal(state.bot.graveyard[0]?.fieldSlot, null);
});

test("an already placed simulated continuous spell retains its fifth slot on activation", () => {
  const spell = simulationCard({ id: 500, name: "Fifth slot spell", cardKind: "spell", subtype: "continuous", isFacedown: true, fieldSlot: 4,
    effects: [{ id: "heal", timing: "on_play", actions: [{ type: "heal", amount: 10, player: "self" }] }] });
  const state = simulationState({ _isPerspectiveState: true, bot: { spellTrap: [spell] } });
  applyGenericSimulatedMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0 });
  assert.equal(state.bot.spellTrap[0], spell);
  assert.equal(spell.fieldSlot, 4);
  assert.equal(spell.isFacedown, false);
});

test("TurnLine clones control registrations and distinguishes a slot-only planning state", async () => {
  const { state, borrowed } = temporaryControlFixture();
  state._isPerspectiveState = true;
  state.phase = "main1";
  const before = fingerprintPlanningState(state);
  const result = await turnLineSearch({
    bot: state.bot, player: state.player, turn: state.turn, phase: state.phase,
    turnCounter: state.turnCounter, _isPerspectiveState: true,
    temporaryControlEffects: state.temporaryControlEffects || [],
  }, {
    bot: state.bot,
    generateMainPhaseActions: () => [{ type: "position_change", fieldIndex: 0, toPosition: "attack" }],
    simulateMainPhaseAction(copy) {
      assert.equal(copy.temporaryControlEffects?.[0]?.fieldPresenceId, "borrowed-presence");
      assert.notEqual(copy.temporaryControlEffects?.[0], state.temporaryControlEffects?.[0]);
      const cloned = copy.bot.field[0];
      assert.ok(cloned);
      cloned.fieldSlot = 0;
    },
    evaluateBoard: copy => copy.bot.field[0]?.fieldSlot === 0 ? 100 : 0,
  }, { maxDepth: 1, nodeBudget: 5 });
  assert.ok(result);
  assert.equal(result.sequence.length, 1);
  assert.equal(result.finalState.bot.field[0]?.fieldSlot, 0);
  assert.equal(borrowed.fieldSlot, 4);
  assert.equal(fingerprintPlanningState(state), before);
});

test("Bot clone preserves slots and isolates control registration and equipment links", () => {
  const bot = new Bot();
  const player = new Player("player", "Player");
  const card = new Card({ id: 600, name: "Controlled", cardKind: "monster" }, "bot");
  card.fieldSlot = 4;
  card.fieldPresenceId = "control-presence";
  const equip = new Card({ id: 601, name: "Equip", cardKind: "spell", subtype: "equip" }, "bot");
  equip.fieldSlot = 3;
  equip.equippedTo = card;
  card.equips = [equip];
  bot.field.push(card);
  bot.spellTrap.push(equip);
  const registration = { id: "temporary-bot", cardInstanceId: card.instanceId, fieldPresenceId: "control-presence",
    cardDuelCardId: null, sourceDuelCardId: null,
    holderId: "bot", previousControllerId: "player", expiresOnTurn: 7, sourceInstanceId: null, createdOnTurn: 7 };
  const copy = bot.cloneGameState({ bot, player, turn: "bot", phase: "main1", turnCounter: 7,
    temporaryControlEffects: [registration] });
  assert.equal(copy.bot.field[0]?.fieldSlot, 4);
  assert.equal(copy.bot.spellTrap[0]?.fieldSlot, 3);
  assert.equal(copy.bot.spellTrap[0]?.equippedTo, copy.bot.field[0]);
  assert.notEqual(copy.bot.spellTrap[0]?.equippedTo, card);
  const cloned = copy.temporaryControlEffects?.[0];
  assert.ok(cloned);
  cloned.expiresOnTurn = 8;
  assert.equal(registration.expiresOnTurn, 7);
});
