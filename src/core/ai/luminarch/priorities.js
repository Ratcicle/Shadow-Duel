// -----------------------------------------------------------------------------
// src/core/ai/luminarch/priorities.js
// Compatibility facade for Luminarch tactical priority decisions.
// -----------------------------------------------------------------------------

export { evaluateRadiantLancerBattlePlan } from "./lancerPlanning.js";
export {
  evaluateMoonlitReviveCandidate,
  getMoonlitTargetPlan,
} from "./moonlitPlanning.js";
export {
  evaluateKnightsConvocationPlan,
  evaluateLuminarchDefensePlan,
} from "./defensePlanning.js";
export { shouldPlaySpell } from "./spellPriority.js";
export { shouldSummonMonster } from "./summonPriority.js";
