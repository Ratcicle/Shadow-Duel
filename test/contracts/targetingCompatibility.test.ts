import assert from "node:assert/strict";
import test from "node:test";
import { resolveTargets } from "../../src/core/effects/targeting/resolution.js";
import { selectCandidates } from "../../src/core/effects/targeting/selection.js";

function createTargetingHarness() {
  const card = {
    id: 1,
    name: "Arcanist Candidate",
    cardKind: "monster",
    archetype: "Arcanist",
    archetypes: ["Arcanist"],
    owner: "player",
    position: "attack",
    atk: 1000,
    def: 1000,
    level: 4,
  };
  const player = {
    id: "player",
    lp: 8000,
    deck: [],
    extraDeck: [],
    hand: [],
    field: [card],
    spellTrap: [],
    graveyard: [],
    banished: [],
    fieldSpell: null,
  };
  const opponent = {
    id: "bot",
    lp: 8000,
    deck: [],
    extraDeck: [],
    hand: [],
    field: [],
    spellTrap: [],
    graveyard: [],
    banished: [],
    fieldSpell: null,
  };
  const host = {
    game: null,
    _targetingCache: new Map(),
    getZone(owner: typeof player, zone: string) {
      return zone === "field" ? owner.field : [];
    },
    cardMatchesFilters() {
      return true;
    },
  };
  return { card, player, opponent, host };
}

test("top-level targeting keeps legacy scalar archetype and name semantics", () => {
  const { player, opponent, host } = createTargetingHarness();
  const context = { player, opponent, source: null };

  const archetypeArray = Reflect.apply(selectCandidates, host, [
    {
      id: "array-archetype",
      owner: "self",
      zone: "field",
      archetype: ["Arcanist"],
    },
    context,
  ]);
  const nameArray = Reflect.apply(selectCandidates, host, [
    {
      id: "array-name",
      owner: "self",
      zone: "field",
      cardName: ["Arcanist Candidate"],
    },
    context,
  ]);

  assert.deepEqual(archetypeArray.candidates, []);
  assert.deepEqual(nameArray.candidates, []);
});

test("targeting remains defensive for non-array context exclusion keys", () => {
  const { card, player, opponent, host } = createTargetingHarness();
  const result = Reflect.apply(selectCandidates, host, [
    {
      id: "numeric-context-key",
      owner: "self",
      zone: "field",
      excludeContextCards: 5,
    },
    { player, opponent, source: null },
  ]);

  assert.deepEqual(result.candidates, [card]);
});

test("resolveTargets preserves its public three-argument runtime arity", () => {
  assert.equal(resolveTargets.length, 3);
});
