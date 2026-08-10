import assert from "node:assert/strict";
import test from "node:test";

import * as chainFacade from "../../src/core/ChainSystem.js";
import * as chainBarrel from "../../src/core/chain/index.js";
import { CHAIN_CONTEXTS } from "../../src/core/chain/contexts.js";
import * as chainLink from "../../src/core/chain/link.js";
import * as chainSegoc from "../../src/core/chain/segoc.js";
import * as chainTiming from "../../src/core/chain/timing.js";
import {
  CHAIN_ACTIVATION_KINDS,
  CHAIN_CONTEXT_TYPES,
  CHAIN_EFFECT_KINDS,
  CHAIN_FINALIZATION_STATUSES,
  CHAIN_PREPARATION_STATUSES,
  CHAIN_RESOLUTION_STATUSES,
  CHAIN_RESPONSE_CONTEXTS,
  FAST_EFFECT_CONTEXT_TYPES,
  FAST_EFFECT_ORIGINS,
  FAST_EFFECT_STATES,
  SEGOC_GROUPS,
  TRIGGER_ELIGIBILITY_STATUSES,
} from "../../src/core/contracts/chain.js";

test("canonical Chain constants preserve their exact values", () => {
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
  assert.deepEqual(CHAIN_CONTEXT_TYPES, [
    "card_activation",
    "attack_declaration",
    "battle_step_open",
    "summon",
    "summon_attempt",
    "phase_change",
    "main_phase_action",
    "action_without_chain",
    "post_chain",
    "battle_damage",
    "damage_step",
    "battle_destroy",
    "effect_activation",
    "effect_targeted",
  ]);
  assert.deepEqual(FAST_EFFECT_CONTEXT_TYPES, [
    ...CHAIN_CONTEXT_TYPES,
    "after_summon",
    "monster_set",
    "summon_failed",
    "summon_negated",
    "trigger_chain",
  ]);
  assert.deepEqual(FAST_EFFECT_STATES, {
    OPEN: "open",
    ACTION_WITHOUT_CHAIN: "action_without_chain",
    TRIGGER_CHECK: "trigger_check",
    TRIGGER_CHAIN: "trigger_chain",
    FAST_EFFECT_WINDOW: "fast_effect_window",
    RESOLVING_CHAIN: "resolving_chain",
    POST_CHAIN_CHECK: "post_chain_check",
    PHASE_TRANSITION_INTENT: "phase_transition_intent",
  });
  assert.deepEqual(FAST_EFFECT_ORIGINS, {
    PHASE_START: "phase_start",
    ACTION_WITHOUT_CHAIN: "action_without_chain",
    ACTIVATION: "activation",
    TRIGGER_CHAIN: "trigger_chain",
    POST_CHAIN: "post_chain",
    PHASE_TRANSITION_INTENT: "phase_transition_intent",
    SUMMON_ATTEMPT: "summon_attempt",
  });
  assert.deepEqual(SEGOC_GROUPS, {
    TURN_MANDATORY: "turn_player_mandatory",
    OPPONENT_MANDATORY: "opponent_mandatory",
    TURN_OPTIONAL: "turn_player_optional",
    OPPONENT_OPTIONAL: "opponent_optional",
  });
  assert.deepEqual(TRIGGER_ELIGIBILITY_STATUSES, [
    "pending",
    "eligible",
    "rejected",
  ]);
  assert.deepEqual(CHAIN_PREPARATION_STATUSES, ["prepared", "committed"]);
  assert.deepEqual(CHAIN_RESOLUTION_STATUSES, [
    "pending",
    "resolving",
    "resolved",
    "no_effect",
    "failed",
  ]);
  assert.deepEqual(CHAIN_FINALIZATION_STATUSES, [
    "pending",
    "queued",
    "cancelled",
    "completed",
    "failed",
    "already_moved",
    "retained",
  ]);
});

test("legacy exports reuse the canonical constant objects by identity", () => {
  assert.equal(chainLink.CHAIN_ACTIVATION_KINDS, CHAIN_ACTIVATION_KINDS);
  assert.equal(chainLink.CHAIN_EFFECT_KINDS, CHAIN_EFFECT_KINDS);
  assert.equal(chainLink.CHAIN_RESPONSE_CONTEXTS, CHAIN_RESPONSE_CONTEXTS);
  assert.equal(chainTiming.FAST_EFFECT_STATES, FAST_EFFECT_STATES);
  assert.equal(chainTiming.FAST_EFFECT_ORIGINS, FAST_EFFECT_ORIGINS);
  assert.equal(chainSegoc.SEGOC_GROUPS, SEGOC_GROUPS);

  assert.equal(chainFacade.CHAIN_ACTIVATION_KINDS, CHAIN_ACTIVATION_KINDS);
  assert.equal(chainFacade.CHAIN_EFFECT_KINDS, CHAIN_EFFECT_KINDS);
  assert.equal(chainFacade.CHAIN_RESPONSE_CONTEXTS, CHAIN_RESPONSE_CONTEXTS);
  assert.equal(chainFacade.FAST_EFFECT_STATES, FAST_EFFECT_STATES);
  assert.equal(chainFacade.FAST_EFFECT_ORIGINS, FAST_EFFECT_ORIGINS);
  assert.equal(chainFacade.SEGOC_GROUPS, SEGOC_GROUPS);

  assert.equal(chainBarrel.CHAIN_ACTIVATION_KINDS, CHAIN_ACTIVATION_KINDS);
  assert.equal(chainBarrel.CHAIN_EFFECT_KINDS, CHAIN_EFFECT_KINDS);
  assert.equal(chainBarrel.CHAIN_RESPONSE_CONTEXTS, CHAIN_RESPONSE_CONTEXTS);
  assert.equal(chainBarrel.FAST_EFFECT_STATES, FAST_EFFECT_STATES);
  assert.equal(chainBarrel.FAST_EFFECT_ORIGINS, FAST_EFFECT_ORIGINS);
  assert.equal(chainBarrel.SEGOC_GROUPS, SEGOC_GROUPS);
  assert.equal(chainBarrel.CHAIN_CONTEXTS, CHAIN_CONTEXTS);
});

test("Chain constants retain their legacy freeze state", () => {
  for (const frozenValue of [
    CHAIN_ACTIVATION_KINDS,
    CHAIN_EFFECT_KINDS,
    CHAIN_RESPONSE_CONTEXTS,
    CHAIN_CONTEXT_TYPES,
    FAST_EFFECT_CONTEXT_TYPES,
    FAST_EFFECT_STATES,
    FAST_EFFECT_ORIGINS,
    SEGOC_GROUPS,
    TRIGGER_ELIGIBILITY_STATUSES,
    CHAIN_PREPARATION_STATUSES,
    CHAIN_RESOLUTION_STATUSES,
    CHAIN_FINALIZATION_STATUSES,
  ]) {
    assert.equal(Object.isFrozen(frozenValue), true);
  }

  assert.equal(Object.isFrozen(CHAIN_CONTEXTS), false);
  for (const definition of Object.values(CHAIN_CONTEXTS)) {
    assert.equal(Object.isFrozen(definition), false);
    assert.equal(Object.isFrozen(definition.allowedSpeeds), false);
  }
});
