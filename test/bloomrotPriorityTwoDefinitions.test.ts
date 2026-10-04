import assert from "node:assert/strict";
import test from "node:test";
import { cardDefinition, required } from "./helpers/fixtures.js";

for (const [id, effectId, context] of [
  [404, "bloomrot_rot_stag_attack_spore_boost", "defender"],
  [404, "bloomrot_rot_stag_defense_spore_boost", "attacker"],
  [406, "bloomrot_mold_mender_attack_spores", "attacker"],
  [415, "bloomrot_overgrowth_standby_spore_counter", "host"],
  [416, "bloomrot_sudden_germination_attack", "attacker"],
  [417, "bloomrot_rotting_ground_summon_spore_counter", "summonedCard"],
] as const) test(`B11 ${effectId} declares a fixed event reference`, () => {
  const effect = required(cardDefinition(id).effects?.find(entry => entry.id === effectId));
  const target = required(effect.targets?.[0]);
  assert.equal(target.intent, "reference");
  assert.equal(target.targetFromContext, context);
  if (id === 404) assert.deepEqual(target.filters, { counterType: "spore", minCounters: 1 });
});

test("B10 Overgrowth observes host destruction through generic movement", () => {
  const effect = required(cardDefinition(415).effects?.find(entry => entry.id === "bloomrot_overgrowth_destroyed_host_spread"));
  assert.equal(effect.event, "card_moved");
  assert.equal(effect.fromZone, "field");
  assert.equal(effect.toZone, "any");
  assert.equal(effect.eventCardFilters?.eventCardIsEquippedToSource, true);
  assert.equal(effect.requiresSourceAtResolution, undefined);
});
