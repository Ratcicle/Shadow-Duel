import assert from "node:assert/strict";
import test from "node:test";
import {
  BATTLE_POSITION_INPUTS,
  BATTLE_POSITIONS,
  CARD_KINDS,
  MONSTER_TYPES,
} from "../../src/core/contracts/cards.js";
import {
  CHAIN_ACTIVATION_KINDS,
  CHAIN_EFFECT_KINDS,
  CHAIN_RESPONSE_CONTEXTS,
} from "../../src/core/contracts/chain.js";
import {
  DAMAGE_STEP_TIMINGS,
  DUEL_EVENT_NAMES,
  EFFECT_TIMINGS,
  TRIGGER_REQUIREMENTS,
  TRIGGER_TIMINGS,
  USAGE_POLICIES,
} from "../../src/core/contracts/effects.js";
import {
  CONTROLLER_TYPES,
  PLAYER_IDS,
} from "../../src/core/contracts/primitives.js";
import {
  SUMMON_METHODS,
  SUMMON_ORIGINS,
} from "../../src/core/contracts/summon.js";
import {
  CANONICAL_ZONES,
  isCanonicalZone,
  isZoneInput,
  LEGACY_ZONE_ALIASES,
  normalizeZoneInput,
} from "../../src/core/contracts/zones.js";
import {
  CHAIN_ACTIVATION_KINDS as LEGACY_CHAIN_ACTIVATION_KINDS,
  CHAIN_EFFECT_KINDS as LEGACY_CHAIN_EFFECT_KINDS,
  CHAIN_RESPONSE_CONTEXTS as LEGACY_CHAIN_RESPONSE_CONTEXTS,
} from "../../src/core/chain/link.js";
import {
  TRIGGER_REQUIREMENTS as LEGACY_TRIGGER_REQUIREMENTS,
  TRIGGER_TIMINGS as LEGACY_TRIGGER_TIMINGS,
} from "../../src/core/chain/segoc.js";
import { USAGE_POLICIES as LEGACY_USAGE_POLICIES } from "../../src/core/chain/usage.js";
import { EFFECT_USAGE_POLICIES } from "../../src/core/game/effects/usage.js";
import { DAMAGE_STEP_TIMINGS as LEGACY_DAMAGE_STEP_TIMINGS } from "../../src/core/game/spellTrap/quickSpellRules.js";
import { SUMMON_ORIGINS as LEGACY_SUMMON_ORIGINS } from "../../src/core/game/summon/transaction.js";

function assertFrozen(value: object): void {
  assert.equal(Object.isFrozen(value), true);
}

test("canonical primitive, zone, card, and summon constants stay exact and frozen", () => {
  assert.deepEqual(PLAYER_IDS, ["player", "bot"]);
  assert.deepEqual(CONTROLLER_TYPES, ["human", "ai"]);
  assert.deepEqual(CANONICAL_ZONES, [
    "deck",
    "hand",
    "field",
    "graveyard",
    "spellTrap",
    "fieldSpell",
    "extraDeck",
    "banished",
  ]);
  assert.deepEqual(LEGACY_ZONE_ALIASES, ["banish"]);
  assert.deepEqual(CARD_KINDS, ["monster", "spell", "trap"]);
  assert.deepEqual(MONSTER_TYPES, ["fusion", "synchro", "ascension"]);
  assert.deepEqual(BATTLE_POSITIONS, ["attack", "defense"]);
  assert.deepEqual(BATTLE_POSITION_INPUTS, [
    "attack",
    "defense",
    "choice",
  ]);
  assert.deepEqual(SUMMON_METHODS, [
    "normal",
    "tribute",
    "flip",
    "special",
    "fusion",
    "synchro",
    "ascension",
  ]);
  assert.deepEqual(SUMMON_ORIGINS, {
    PROCEDURE: "procedure",
    EFFECT_RESOLUTION: "effect_resolution",
  });

  [
    PLAYER_IDS,
    CONTROLLER_TYPES,
    CANONICAL_ZONES,
    LEGACY_ZONE_ALIASES,
    CARD_KINDS,
    MONSTER_TYPES,
    BATTLE_POSITIONS,
    BATTLE_POSITION_INPUTS,
    SUMMON_METHODS,
    SUMMON_ORIGINS,
  ].forEach(assertFrozen);
});

test("canonical effect constants stay exact and frozen", () => {
  assert.deepEqual(EFFECT_TIMINGS, [
    "on_play",
    "on_event",
    "on_activate",
    "ignition",
    "on_field_activate",
    "passive",
    "manual",
  ]);
  assert.deepEqual(DUEL_EVENT_NAMES, [
    "after_summon",
    "battle_destroy",
    "battle_completed",
    "damage_step",
    "card_flipped",
    "battle_damage_inflicted",
    "card_to_grave",
    "card_moved",
    "counter_removed",
    "standby_phase",
    "end_phase",
    "attack_declared",
    "battle_damage",
    "opponent_damage",
    "before_destroy",
    "effect_targeted",
    "card_activation",
    "effect_activation",
    "card_equipped",
    "lp_change",
    "spell_activated",
    "effect_activated",
    "position_change",
  ]);
  assert.deepEqual(USAGE_POLICIES, {
    USE: "use",
    ACTIVATE: "activate",
  });
  assert.deepEqual(TRIGGER_REQUIREMENTS, {
    MANDATORY: "mandatory",
    OPTIONAL: "optional",
  });
  assert.deepEqual(TRIGGER_TIMINGS, {
    IF: "if",
    WHEN: "when",
  });
  assert.deepEqual(DAMAGE_STEP_TIMINGS, {
    START: "start_of_damage_step",
    BEFORE_CALCULATION: "before_damage_calculation",
    CALCULATION: "damage_calculation",
    AFTER_CALCULATION: "after_damage_calculation",
    END: "end_of_damage_step",
  });

  [
    EFFECT_TIMINGS,
    DUEL_EVENT_NAMES,
    USAGE_POLICIES,
    TRIGGER_REQUIREMENTS,
    TRIGGER_TIMINGS,
    DAMAGE_STEP_TIMINGS,
  ].forEach(assertFrozen);
});

test("canonical chain constants stay exact and frozen", () => {
  assert.deepEqual(CHAIN_ACTIVATION_KINDS, {
    SPELL_TRAP_CARD: "spell_trap_card_activation",
    SPELL_TRAP_EFFECT: "spell_trap_effect_activation",
    MONSTER_EFFECT: "monster_effect_activation",
  });
  assert.deepEqual(CHAIN_EFFECT_KINDS, {
    TRIGGER: "trigger_effect",
    QUICK: "quick_effect",
    IGNITION: "ignition_effect",
    SPELL_TRAP: "spell_trap_effect",
    OTHER: "other_effect",
  });
  assert.deepEqual(CHAIN_RESPONSE_CONTEXTS, {
    CARD_ACTIVATION: "card_activation",
    EFFECT_ACTIVATION: "effect_activation",
  });

  [
    CHAIN_ACTIVATION_KINDS,
    CHAIN_EFFECT_KINDS,
    CHAIN_RESPONSE_CONTEXTS,
  ].forEach(assertFrozen);
});

test("legacy exports keep the canonical object identities", () => {
  assert.strictEqual(LEGACY_USAGE_POLICIES, USAGE_POLICIES);
  assert.strictEqual(EFFECT_USAGE_POLICIES, USAGE_POLICIES);
  assert.strictEqual(LEGACY_TRIGGER_REQUIREMENTS, TRIGGER_REQUIREMENTS);
  assert.strictEqual(LEGACY_TRIGGER_TIMINGS, TRIGGER_TIMINGS);
  assert.strictEqual(LEGACY_DAMAGE_STEP_TIMINGS, DAMAGE_STEP_TIMINGS);
  assert.strictEqual(LEGACY_SUMMON_ORIGINS, SUMMON_ORIGINS);
  assert.strictEqual(
    LEGACY_CHAIN_ACTIVATION_KINDS,
    CHAIN_ACTIVATION_KINDS,
  );
  assert.strictEqual(LEGACY_CHAIN_EFFECT_KINDS, CHAIN_EFFECT_KINDS);
  assert.strictEqual(
    LEGACY_CHAIN_RESPONSE_CONTEXTS,
    CHAIN_RESPONSE_CONTEXTS,
  );
});

test("zone guards and normalization preserve canonical values defensively", () => {
  for (const zone of CANONICAL_ZONES) {
    assert.equal(isCanonicalZone(zone), true);
    assert.equal(isZoneInput(zone), true);
    assert.equal(normalizeZoneInput(zone), zone);
  }

  assert.equal(isCanonicalZone("banish"), false);
  assert.equal(isZoneInput("banish"), true);
  assert.equal(normalizeZoneInput("banish"), "banished");
  assert.equal(isCanonicalZone("void"), false);
  assert.equal(isZoneInput("void"), false);
  assert.equal(isZoneInput(null), false);
  assert.throws(
    () => Reflect.apply(normalizeZoneInput, undefined, ["void"]),
    TypeError,
  );
});
