import assert from "node:assert/strict";
import test from "node:test";
import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

test("Meeting declares each discard as its selected activation case cost", () => {
  const effect = required(cardDefinition(309).effects?.find(entry => entry.id === "meeting_arcanists_choose_effect"));
  const cases = required(effect.activationCases);
  assert.equal(effect.id, "meeting_arcanists_choose_effect");
  assert.equal(effect.oncePerTurnScope, "card");
  assert.equal(effect.oncePerTurn, true);
  assert.equal(effect.oncePerTurnName, "meeting_arcanists_choose_effect");
  assert.equal(effect.usagePolicy, "activate");
  assert.equal(effect.actions?.some(action => action.type === "choose_action_case") ?? false, false);
  assert.equal(cases.length, 2);
  for (const [index, activationCase] of cases.entries()) {
    const target = required(activationCase.targets?.[0]);
    const cost = required(activationCase.activationCosts?.[0]);
    assert.equal(target.intent, "cost");
    assert.equal(target.zone, "hand");
    assert.equal(target.cardKind, index === 0 ? "monster" : "spell");
    assert.deepEqual(target.count, { min: 2, max: 2 });
    assert.deepEqual(cost, { type: "move", targetRef: target.id, player: "self", fromZone: "hand", to: "graveyard", contextLabel: "discard", requireAll: true, requireDestination: true });
    const actions = activationCase.actions;
    assert.equal(actions.length, 1);
    assert.equal(required(actions[0]).type, "search_any");
  }
});

test("Grand Library and Ink River separate their activation costs from resolution", () => {
  const library = required(cardDefinition(312).effects?.find(effect => effect.id === "arcanist_grand_library_ignition"));
  const cases = required(library.activationCases);
  const summon = required(cases.find(entry => entry.id === "arcanist_grand_library_summon"));
  const search = required(cases.find(entry => entry.id === "arcanist_grand_library_search_equip"));
  assert.deepEqual(summon.activationCosts, [{ type: "pay_lp", amount: 2000 }]);
  assert.deepEqual(summon.actions.map(action => action.type), ["special_summon_from_zone"]);
  assert.equal(search.activationCosts, undefined);
  assert.deepEqual(search.actions.map(action => action.type), ["search_any"]);
  assert.equal(library.oncePerTurnScope, "card");
  assert.equal(library.oncePerTurn, true);
  assert.equal(library.oncePerTurnName, "arcanist_grand_library_ignition");
  assert.equal(library.usagePolicy, "activate");
  const recover = required(cardDefinition(311).effects?.find(effect => effect.id === "arcanist_ink_river_recover"));
  assert.deepEqual(recover.activationCosts, [{ type: "remove_counter", targetRef: "self", counterType: "ink", amount: 2 }]);
  assert.deepEqual(recover.actions?.map(action => action.type), ["add_from_zone_to_hand"]);
});

test("Tornado requires the face-up Arcanist monster itself to carry a face-up Arcanist Equip", t => {
  const game = createRuntimeGame({ laboratoryMode: true });
  t.after(() => game.dispose());
  const source = new Card(cardDefinition(315), game.player.id);
  const arcanist = new Card(cardDefinition(306), game.player.id);
  const unrelated = new Card({ ...cardDefinition(306), archetype: "Other" }, game.player.id);
  const equip = new Card(cardDefinition(301), game.player.id);
  placeFieldCards(game.player.field, arcanist, unrelated);
  game.player.spellTrap[0] = equip;
  const effect = required(source.effects[0]);
  const canActivate = () => game.effectEngine.evaluateConditions(effect.conditions, { source, player: game.player, opponent: game.bot }).ok;
  assert.equal(canActivate(), false, "An unbound Equip does not satisfy the condition");
  equip.equippedTo = unrelated;
  unrelated.equips = [equip];
  assert.equal(canActivate(), false, "Equipping a different archetype does not satisfy the condition");
  equip.equippedTo = arcanist;
  unrelated.equips = [];
  arcanist.equips = [equip];
  assert.equal(canActivate(), true);
  equip.isFacedown = true;
  assert.equal(canActivate(), false);
  equip.isFacedown = false;
  arcanist.isFacedown = true;
  assert.equal(canActivate(), false);
});

test("Arcanist activation definitions pass the card database validator", () => {
  const { errors } = validateCardDatabase();
  assert.deepEqual(errors.filter(issue => issue.cardId !== null && [307, 309, 311, 312, 313, 314, 315].includes(issue.cardId)), []);
});
