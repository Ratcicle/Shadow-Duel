import type EffectEngine from "../../src/core/EffectEngine.js";
import type Game from "../../src/core/Game.js";
import type {
  ActivationEngineHost,
  ActivationGetterHost,
} from "../../src/core/effects/activation/runtime.js";
import { cardMatchesFilters } from "../../src/core/effects/filters/cardFilters.js";
import type { resolveLpCost } from "../../src/core/effects/costs/lpCost.js";
import type { updatePassiveBuffs } from "../../src/core/effects/passives/passiveBuffs.js";
import type { executeEffectBlueprint } from "../../src/core/effects/blueprints/index.js";
import type { findFusionMaterialCombos } from "../../src/core/effects/fusion/evaluation.js";
import type { evaluateConditions } from "../../src/core/effects/conditions/evaluateConditions.js";

declare const engine: EffectEngine;
declare const game: Game;

// Check the complete live facade against each attached method's receiver,
// including capabilities not exercised by individual call sites.
const activationHost: ActivationEngineHost = engine;
const getterHost: ActivationGetterHost = engine;
const filterHost: ThisParameterType<typeof cardMatchesFilters> = engine;
const costHost: ThisParameterType<typeof resolveLpCost> = engine;
const passiveHost: ThisParameterType<typeof updatePassiveBuffs> = engine;
const blueprintHost: ThisParameterType<typeof executeEffectBlueprint> = engine;
const fusionHost: ThisParameterType<typeof findFusionMaterialCombos> = engine;
const conditionsHost: ThisParameterType<typeof evaluateConditions> = engine;

cardMatchesFilters({ cardKind: "monster" }, { cardKind: "monster" });
engine.cardMatchesFilters(
  { cardKind: "monster" },
  { equippedWithFilters: { cardKind: "spell" } },
);
// contract-negative: equipped-card filters need an engine for ownership and recursive filtering.
// @ts-expect-error
cardMatchesFilters(
  { cardKind: "monster" },
  { equippedWithFilters: { cardKind: "spell" } },
);

// Delayed action kinds are closed for authored code, with runtime fallback retained.
game.scheduleDelayedAction("delayed_summon", { phase: "standby" }, {});
game.scheduleDelayedAction(
  // contract-negative: new delayed action kinds need a scheduler implementation.
  // @ts-expect-error
  "unimplemented_delayed_action",
  { phase: "standby" },
  {},
);

void [
  activationHost,
  getterHost,
  filterHost,
  costHost,
  passiveHost,
  blueprintHost,
  fusionHost,
  conditionsHost,
];
