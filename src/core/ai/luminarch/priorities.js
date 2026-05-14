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
export {
  assessLuminarchSummonEntry,
  shouldSummonMonster,
} from "./summonPriority.js";
export {
  LUMINARCH_RESOURCE_POLICY,
  assessLuminarchResourceRecovery,
  assessLuminarchResourceSpend,
  buildLuminarchResourceEconomy,
  buildLuminarchResourcePreferences,
  getLuminarchResourcePressure,
} from "./resourceEconomy.js";
export {
  evaluateLuminarchAscensionPlan,
  evaluateLuminarchFinisherPlans,
  evaluateLuminarchFusionPlan,
  getBestLuminarchFinisherPlan,
} from "./finisherPlanning.js";
export {
  applyLuminarchDefenseActionContext,
  evaluateLuminarchBackrowSetPolicy,
  evaluateLuminarchProtectionSpell,
  evaluateLuminarchRemovalSpell,
} from "./defensePolicy.js";
