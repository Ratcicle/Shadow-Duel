import assert from "node:assert/strict";
import test from "node:test";

import { evaluateConditions } from "../src/core/effects/conditions/evaluateConditions.js";
import { dragonCards } from "../src/data/cards/dragon.js";

const jaggedPeak = dragonCards.find(({ id }) => id === 262);
const counterEffect = jaggedPeak?.effects.find(
  ({ id }) => id === "dragon_peak_battle_counter",
);
const attackerCondition =
  counterEffect && "conditions" in counterEffect
    ? counterEffect.conditions?.[0]
    : undefined;

const player = { id: "player" };
const opponent = { id: "bot" };

const conditionHost = {
  game: {
    getOpponent() {
      return opponent;
    },
  },
  getOwnerByCard(card: { controller?: string }) {
    return card.controller === player.id ? player : opponent;
  },
};

function matchesAttacker(attacker: {
  cardKind: string;
  type: string;
  controller: string;
}) {
  return evaluateConditions.call(conditionHost, [attackerCondition], {
    player,
    opponent,
    attacker,
  }).ok;
}

test("Jagged Peak uses the attacker_matches discriminator with a Dragon filter", () => {
  assert.ok(jaggedPeak);
  assert.ok(counterEffect);
  assert.deepEqual(attackerCondition, {
    type: "attacker_matches",
    owner: "self",
    cardKind: "monster",
    attackerType: "Dragon",
  });

  assert.equal(
    matchesAttacker({
      cardKind: "monster",
      type: "Dragon",
      controller: "player",
    }),
    true,
  );
  assert.equal(
    matchesAttacker({
      cardKind: "monster",
      type: "Warrior",
      controller: "player",
    }),
    false,
  );
  assert.equal(
    matchesAttacker({
      cardKind: "monster",
      type: "Dragon",
      controller: "bot",
    }),
    false,
  );
});
