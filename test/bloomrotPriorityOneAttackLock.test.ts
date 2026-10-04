import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { getCounterAttackLockReason } from "../src/core/game/combat/availability.js";
import { matchesCardFilter } from "../src/core/effects/filters/cardFilters.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

function setup(t: TestContext, seat: "player" | "bot") {
  const game = createRuntimeGame({ disableChains: true });
  t.after(() => game.dispose("bloomrot_p1_attack_lock"));
  game.turn = seat; game.phase = "battle"; game.turnCounter = 4;
  game.disablePresentationDelays = true;
  const actor = game[seat], opponent = seat === "player" ? game.bot : game.player;
  actor.controllerType = opponent.controllerType = "ai";
  const attacker = new Card({ name: "Spore-bearing attacker", cardKind: "monster", atk: 2000, def: 0 }, actor.id);
  const network = new Card(cardDefinition(412), opponent.id);
  placeFieldCards(actor.field, attacker); placeFieldCards(opponent.spellTrap, network);
  attacker.addCounter("spore", 5);
  return { game, actor, opponent, attacker, network };
}

for (const seat of ["player", "bot"] as const) {
  test(`Root Network stops blocking during negation and resumes afterwards (${seat})`, t => {
    const { game, attacker, network } = setup(t, seat);
    assert.equal(game.getAttackAvailability(attacker).ok, false);
    network.effectsNegated = true;
    assert.equal(game.getAttackAvailability(attacker).ok, true);
    network.effectsNegated = false;
    assert.equal(game.getAttackAvailability(attacker).ok, false);
    assert.equal(attacker.cannotAttackThisTurn, false, "the aura does not write a lasting attack prohibition");
  });

  test(`Root Network reads current counter threshold, source face, zone and independent copies (${seat})`, async t => {
    const { game, opponent, attacker, network } = setup(t, seat);
    attacker.removeCounter("spore", 1);
    assert.equal(game.getAttackAvailability(attacker).ok, true);
    attacker.addCounter("spore", 1);
    network.isFacedown = true;
    assert.equal(game.getAttackAvailability(attacker).ok, true);
    network.isFacedown = false;
    const second = new Card(cardDefinition(412), opponent.id);
    placeFieldCards(opponent.spellTrap, second);
    network.effectsNegated = true;
    assert.equal(game.getAttackAvailability(attacker).ok, false, "the other active copy still blocks");
    second.effectsNegated = true;
    assert.equal(game.getAttackAvailability(attacker).ok, true);
    network.effectsNegated = false;
    const moved = await game.moveCard(network, opponent, "graveyard", { fromZone: "spellTrap" });
    assert.equal(typeof moved === "object" ? moved?.success : moved, true);
    assert.equal(game.getAttackAvailability(attacker).ok, true);
  });

  test(`public combat enforces Root Network and permits the attack while negated (${seat})`, async t => {
    const { game, opponent, attacker, network } = setup(t, seat);
    const initialLp = opponent.lp;
    const blocked = await game.resolveCombat(attacker, null);
    assert.equal(blocked, undefined);
    assert.equal(opponent.lp, initialLp);
    network.effectsNegated = true;
    const result = required(await game.resolveCombat(attacker, null));
    assert.equal(result.ok, true);
    assert.equal(opponent.lp, initialLp - 2000);
  });
}

test("the shared counter rule respects current physical controllers, source zones and target filters", () => {
  const attacker = new Card({ name: "Filtered attacker", cardKind: "monster", atk: 1000, def: 0 }, "physical_first");
  attacker.addCounter("spore", 5);
  const source = new Card({ name: "Generic counter rule", cardKind: "spell", subtype: "field", effects: [{
    id: "generic_counter_rule", timing: "passive", requireZone: "fieldSpell", passive: {
      type: "counter_attack_lock", counterType: "spore", minCounters: 5, targetOwners: ["self"],
      targetFilters: { cardKind: "monster", minAtk: 1500 },
    },
  }] }, "physical_first");
  const owners = [{ id: "physical_first", field: [attacker], spellTrap: [source], fieldSpell: null as Card | null }];
  const reason = () => getCounterAttackLockReason(attacker, owners, "physical_first", matchesCardFilter);
  assert.equal(reason(), null, "the declared source zone is required");
  required(owners[0]).spellTrap = []; required(owners[0]).fieldSpell = source;
  assert.equal(reason(), null, "the target filter remains in force");
  attacker.atk = 1500;
  assert.ok(reason());
  assert.equal(getCounterAttackLockReason(attacker, owners, "physical_second", matchesCardFilter), null,
    "the physical actor controls the owner relation, independently of card.owner");
  source.effectsNegated = true;
  assert.equal(reason(), null);
});
