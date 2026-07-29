import assert from "node:assert/strict";
import test from "node:test";

import {
  fieldHasTributeValue,
  getTributeValueForSummon,
  selectTributeIndicesByValue,
} from "../src/core/game/summon/tributeValue.js";
import { cardDatabaseById } from "../src/data/cards.js";

const HEARTBEARER_ID = 125;
const SHADOW_HEART_TARGET_ID = 104;
const STELYA_ID = 278;
const DRAGON_TARGET_ID = 28;

function runtimeCard(id, overrides = {}) {
  const definition = cardDatabaseById.get(id);
  assert.ok(definition, `Expected card ${id} in the card database.`);
  return { ...definition, ...overrides };
}

test("Shadow-Heart Heartbearer loses its additional Tribute value while negated", () => {
  const target = runtimeCard(SHADOW_HEART_TARGET_ID);
  const activeHeartbearer = runtimeCard(HEARTBEARER_ID, {
    effectsNegated: false,
    isFacedown: false,
  });
  const negatedHeartbearer = runtimeCard(HEARTBEARER_ID, {
    effectsNegated: true,
    isFacedown: false,
  });

  assert.equal(getTributeValueForSummon(activeHeartbearer, target), 2);
  assert.equal(getTributeValueForSummon(negatedHeartbearer, target), 1);
  assert.equal(fieldHasTributeValue([negatedHeartbearer], 2, target), false);
  assert.deepEqual(
    selectTributeIndicesByValue([negatedHeartbearer], 2, target),
    [],
  );

  const regularTribute = {
    id: 999001,
    name: "Regular Tribute",
    cardKind: "monster",
  };
  assert.equal(
    fieldHasTributeValue([negatedHeartbearer, regularTribute], 2, target),
    true,
  );
  assert.deepEqual(
    selectTributeIndicesByValue(
      [negatedHeartbearer, regularTribute],
      2,
      target,
    ),
    [0, 1],
  );
});

test("tributeValue negation behavior is generic for Stelya, Dragon Tamer", () => {
  const target = runtimeCard(DRAGON_TARGET_ID);
  const activeStelya = runtimeCard(STELYA_ID, { effectsNegated: false });
  const negatedStelya = runtimeCard(STELYA_ID, { effectsNegated: true });

  assert.equal(getTributeValueForSummon(activeStelya, target), 2);
  assert.equal(getTributeValueForSummon(negatedStelya, target), 1);
  assert.equal(fieldHasTributeValue([negatedStelya], 2, target), false);
});

test("Heartbearer still requires being face-up for its additional Tribute value", () => {
  const target = runtimeCard(SHADOW_HEART_TARGET_ID);
  const facedownHeartbearer = runtimeCard(HEARTBEARER_ID, {
    effectsNegated: false,
    isFacedown: true,
  });

  assert.equal(getTributeValueForSummon(facedownHeartbearer, target), 1);
});
