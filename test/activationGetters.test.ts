import assert from "node:assert/strict";
import test from "node:test";
import type { GamePlayer } from "../src/core/contracts/player.js";
import {
  getActivatableMonsterIgnitionEffects,
  getFirstActivatableMonsterIgnitionEffect,
  getMonsterIgnitionEffect,
} from "../src/core/effects/activation/getters.js";
import type { ActivationCard } from "../src/core/effects/activation/runtime.js";
import { unsafeFixture } from "./helpers/fixtures.js";

test("monster ignition getters preserve their standalone fallback with a null receiver", () => {
  const card = unsafeFixture<ActivationCard>(
    { effects: [] },
    "Standalone getter fallback only reads the effects collection.",
  );
  const player = unsafeFixture<GamePlayer>(
    {},
    "An empty effect collection never inspects the player fixture.",
  );

  assert.equal(
    Reflect.apply(getMonsterIgnitionEffect, null, [card, "field"]),
    null,
  );
  assert.deepEqual(
    Reflect.apply(getActivatableMonsterIgnitionEffects, null, [
      card,
      player,
      "field",
    ]),
    [],
  );
  assert.equal(
    Reflect.apply(getFirstActivatableMonsterIgnitionEffect, null, [
      card,
      player,
      "field",
    ]),
    null,
  );
});
