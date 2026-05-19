// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/dragon/index.js
// Re-exports all Dragon AI modules.
// ─────────────────────────────────────────────────────────────────────────────

export {
  CARD_KNOWLEDGE,
  EXTREME_DRAGON_NAMES,
  SELF_SUMMON_MONSTERS,
  CONVERGING_STARS_TARGETS,
  isExtremeDragon,
  countExtremeInGY,
  countSafeBanishTargets,
  getCardKnowledge,
  selectBestExtremeDragon,
} from "./knowledge.js";

export {
  COMBO_DATABASE,
  DRAGON_COMBO_PRIORITY,
  DRAGON_COMBO_STATUS,
  detectAvailableCombos,
  getComboByName,
} from "./combos.js";

export {
  shouldPlaySpell,
  shouldSummonMonster,
  getTributeRequirementFor,
  selectBestTributes,
  evaluateTributeTrade,
} from "./priorities.js";

export {
  assessDragonExtremeResourcePolicy,
  analyzeExtremeDragonEconomy,
  evaluateDragonMonster,
  evaluateBoardDragon,
} from "./scoring.js";

export { simulateMainPhaseAction } from "./simulation.js";

export {
  applyDragonRetentionPriorities,
  buildDragonPlanningProfile,
  describeDragonPlannedLine,
  scoreDragonLineMilestones,
  scoreDragonLineTerminal,
} from "./linePlanning.js";
