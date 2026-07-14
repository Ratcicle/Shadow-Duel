import test from "node:test";
import assert from "node:assert/strict";

import { cardDatabase } from "../src/data/cards.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";

function card(name) {
  return cardDatabase.find((entry) => entry.name === name);
}

test("custos reais das regressões usam activationCosts e targets de custo", () => {
  const naturalSelection = card("Natural Selection");
  const effect = naturalSelection.effects[0];
  assert.equal(effect.activationCosts.length, 1);
  assert.equal(
    effect.targets.find((target) => target.id === "natural_selection_cost").intent,
    "cost",
  );
  assert.equal(
    effect.actions.some((action) => action.targetRef === "natural_selection_cost"),
    false,
  );
  assert.equal(effect.actions[0].targetRef, "natural_selection_target");

  const hollowKing = card("Void Hollow King");
  assert.ok(
    hollowKing.effects.some((entryEffect) =>
      entryEffect.activationCosts?.some(
        (action) => action.targetRef === "void_hollow_king_boost_cost",
      ),
    ),
  );
  const sickle = card("Luminarch Magic Sickle");
  assert.equal(
    sickle.effects
      .flatMap((entryEffect) => entryEffect.targets || [])
      .find((target) => target.id === "magic_sickle_self").intent,
    "cost",
  );
  assert.ok(
    card("Miragebound Jackal").effects.some(
      (entryEffect) =>
        entryEffect.event === "card_moved" && entryEffect.isQuickEffect === true,
    ),
  );
  assert.ok(
    card("Miragebound Rebel").effects.some(
      (entryEffect) =>
        entryEffect.event === "position_change" && entryEffect.isQuickEffect === true,
    ),
  );
  assert.ok(
    cardDatabase.some((entry) =>
      entry.effects?.some((entryEffect) => entryEffect.event === "effect_activated"),
    ),
  );
  assert.ok(
    cardDatabase.some((entry) =>
      entry.effects?.some((entryEffect) =>
        Array.isArray(entryEffect.activationCosts),
      ),
    ),
  );
});

test("o validador aceita activationCosts e rejeita referências inválidas no banco real", () => {
  const validation = validateCardDatabase();
  assert.deepEqual(validation.errors, []);
});

test("o validador aceita ativações reativas on_activate vinculadas a eventos", () => {
  const burningReward = card("Burning Reward");
  const effect = burningReward.effects[0];
  assert.equal(effect.timing, "on_activate");
  assert.equal(effect.event, "battle_destroy");

  const validation = validateCardDatabase();
  const burningRewardIssues = [
    ...validation.errors,
    ...validation.warnings,
  ].filter((issue) => issue.cardId === burningReward.id);
  assert.deepEqual(burningRewardIssues, []);
});
