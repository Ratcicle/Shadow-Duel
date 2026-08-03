import assert from "node:assert/strict";
import test from "node:test";
import { COLLECTED_TRIGGER_EVENT_NAMES } from "../../src/core/contracts/events.js";
import {
  collectEventTriggers,
  TRIGGER_COLLECTOR_MANIFEST,
} from "../../src/core/effects/triggers/collectors.js";
import {
  collectAfterSummonTriggers,
  collectAttackDeclaredTriggers,
  collectBattleCompletedTriggers,
  collectBattleDamageInflictedTriggers,
  collectBattleDamageTriggers,
  collectBattleDestroyTriggers,
  collectCardEquippedTriggers,
  collectCardFlippedTriggers,
  collectCardMovedTriggers,
  collectCardToGraveTriggers,
  collectCounterRemovedTriggers,
  collectDamageStepTriggers,
  collectEffectActivatedTriggers,
  collectEffectTargetedTriggers,
  collectEndPhaseTriggers,
  collectLpChangeTriggers,
  collectPositionChangeTriggers,
  collectSpellActivatedTriggers,
  collectStandbyPhaseTriggers,
} from "../../src/core/effects/triggers/collectors/index.js";

const EXPECTED_COLLECTORS = [
  ["after_summon", "collectAfterSummonTriggers", collectAfterSummonTriggers],
  ["spell_activated", "collectSpellActivatedTriggers", collectSpellActivatedTriggers],
  ["effect_activated", "collectEffectActivatedTriggers", collectEffectActivatedTriggers],
  ["battle_destroy", "collectBattleDestroyTriggers", collectBattleDestroyTriggers],
  ["battle_completed", "collectBattleCompletedTriggers", collectBattleCompletedTriggers],
  ["card_to_grave", "collectCardToGraveTriggers", collectCardToGraveTriggers],
  ["card_moved", "collectCardMovedTriggers", collectCardMovedTriggers],
  ["counter_removed", "collectCounterRemovedTriggers", collectCounterRemovedTriggers],
  ["attack_declared", "collectAttackDeclaredTriggers", collectAttackDeclaredTriggers],
  ["battle_damage", "collectBattleDamageTriggers", collectBattleDamageTriggers],
  [
    "battle_damage_inflicted",
    "collectBattleDamageInflictedTriggers",
    collectBattleDamageInflictedTriggers,
  ],
  ["card_flipped", "collectCardFlippedTriggers", collectCardFlippedTriggers],
  ["damage_step", "collectDamageStepTriggers", collectDamageStepTriggers],
  ["lp_change", "collectLpChangeTriggers", collectLpChangeTriggers],
  ["effect_targeted", "collectEffectTargetedTriggers", collectEffectTargetedTriggers],
  ["position_change", "collectPositionChangeTriggers", collectPositionChangeTriggers],
  ["card_equipped", "collectCardEquippedTriggers", collectCardEquippedTriggers],
  ["standby_phase", "collectStandbyPhaseTriggers", collectStandbyPhaseTriggers],
  ["end_phase", "collectEndPhaseTriggers", collectEndPhaseTriggers],
] as const;

test("trigger collector manifest preserves the canonical event order and identities", () => {
  assert.equal(Object.isFrozen(TRIGGER_COLLECTOR_MANIFEST), true);
  assert.deepEqual(
    Object.keys(TRIGGER_COLLECTOR_MANIFEST),
    [...COLLECTED_TRIGGER_EVENT_NAMES],
  );

  for (const [eventName, method, collector] of EXPECTED_COLLECTORS) {
    const descriptor = TRIGGER_COLLECTOR_MANIFEST[eventName];
    assert.equal(descriptor.method, method);
    assert.equal(descriptor.collector, collector);
  }
});

test("trigger dispatch resolves the collector through the host instance", async () => {
  const payload = {
    card: { id: 1, name: "Summoned" },
    player: { id: "player" },
    method: "special",
    fromZone: "hand",
  };
  const expected = {
    entries: [],
    orderRule: "instance monkeypatch",
  };
  let receivedPayload: object | null = null;
  const host = {
    game: {
      player: { id: "player" },
      bot: { id: "bot" },
      temporaryEventEffects: [],
    },
    async collectAfterSummonTriggers(received: object) {
      receivedPayload = received;
      return expected;
    },
  };

  const result = await Reflect.apply(collectEventTriggers, host, [
    "after_summon",
    payload,
  ]);

  assert.equal(receivedPayload, payload);
  assert.equal(result, expected);
});
