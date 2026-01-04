/**
 * Fusion Module - Barrel file
 * Re-exports all fusion-related functions for EffectEngine
 */

export {
  matchesFusionRequirement,
  getFusionRequirements,
  getFusionRequiredCount,
} from "./requirements.js";

export {
  findFusionMaterialCombos,
  evaluateFusionSelection,
  canSummonFusion,
  getAvailableFusions,
  getRequiredMaterialCount,
} from "./evaluation.js";

export { performBotFusion, applyPolymerizationFusion } from "./execution.js";
