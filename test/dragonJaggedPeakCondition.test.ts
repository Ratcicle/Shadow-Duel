import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSimulatedConditions } from "../src/core/ai/common/simulatedConditions.js";
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

function matchesSimulatedAttacker(attacker: {
  cardKind: string;
  type: string;
  controller: string;
}) {
  return evaluateSimulatedConditions(attackerCondition, {
    state: {
      player: {
        ...player,
        field: attacker.controller === player.id ? [attacker] : [],
      },
      bot: {
        ...opponent,
        field: attacker.controller === opponent.id ? [attacker] : [],
      },
    },
    selfId: player.id,
    attacker,
  });
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

  assert.equal(
    matchesSimulatedAttacker({
      cardKind: "monster",
      type: "Dragon",
      controller: "player",
    }),
    true,
  );
  assert.equal(
    matchesSimulatedAttacker({
      cardKind: "monster",
      type: "Warrior",
      controller: "player",
    }),
    false,
  );
  assert.equal(
    matchesSimulatedAttacker({
      cardKind: "monster",
      type: "Dragon",
      controller: "bot",
    }),
    false,
  );
});
