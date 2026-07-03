// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/dragon/index.js
// Re-exports all Dragon AI modules.
// ─────────────────────────────────────────────────────────────────────────────

export {
  CARD_KNOWLEDGE,
  CURRENT_AWAKENING_TARGET_NAMES,
  CURRENT_DRAGON_BOT_CARD_NAMES,
  DRAGON_LEVEL5_PLUS_SEARCH_NAMES,
  DRAGON_SMALL_SEARCH_NAMES,
  ECLIPSE_ENGINE_NAMES,
  EXTREME_DRAGON_NAMES,
  LEGACY_CONVERGING_STARS_TARGETS,
  LEGACY_SELF_SUMMON_MONSTERS,
  OUT_OF_PLAN_DRAGON_CARD_NAMES,
  SELF_SUMMON_MONSTERS,
  CONVERGING_STARS_TARGETS,
  isExtremeDragon,
  isCurrentDragonBotCardName,
  isOutOfPlanDragonCardName,
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

export {
  DRAGON_OPT_NAMES,
  analyzeDragonState,
} from "./stateAnalysis.js";

export {
  getDragonSearchKind,
  rankDragonSearchCandidates,
} from "./searchPolicy.js";

export {
  DRAGON_CORE_PAYOFF_NAMES,
  DRAGON_GOOD_DISCARD_NAMES,
  DRAGON_MEDIUM_DISCARD_NAMES,
  buildDragonCostPreferences,
  buildDragonTargetCostPreferences,
  rankDragonDiscardCandidates,
  scoreDragonDiscardCandidate,
} from "./costPolicy.js";

export {
  buildDragonBanishTargetPreferences,
  rankDragonFieldBanishCosts,
  rankDragonGyBanishCosts,
  rankTechVoidBanishTargets,
  scoreDragonFieldBanishCost,
  scoreDragonGyBanishCost,
  scoreTechVoidBanishTarget,
  shouldUsePurifiedBanishSummon,
  shouldUseStelyaBanishSummon,
} from "./banishPolicy.js";

export {
  DRAGON_BOSS_POLICY_NAMES,
  actionBreaksSoloExtremeProtection,
  buildDragonBossContext,
  buildDragonBossPreferenceMap,
  buildDragonBossTargetPreference,
  hasActiveExtremeDragonConflict,
  hasDragonBossRoute,
  isDragonBossCandidate,
  rankDragonBossCandidates,
  scoreDragonBossCandidate,
  selectBestDragonBoss,
} from "./bossPolicy.js";

export {
  DRAGON_EXTRA_DECK_NAMES,
  buildDragonExtraDeckActionContext,
  chooseDragonAscensionPosition,
  rankDragonAscensionChoices,
  rankDragonFusionPlans,
  selectDragonAscensionChoice,
  selectDragonFusionPlan,
} from "./extraDeckPolicy.js";

export {
  buildDragonRecruitTargetPreference,
  evaluateDragonGraveyardIgnition,
  evaluateDragonHandIgnition,
  evaluateDragonRecruitCandidate,
} from "./actionPolicy.js";

export {
  buildDragonDefenseTargetPreferences,
  getLuminescentBattleDebuffPlan,
  getMajesticBattlePositionPlan,
  scoreDragonBackrowSet,
  scoreDragonBattleAttack,
  shouldRecheckBossBeforeBattle,
} from "./battleDefensePolicy.js";

export { simulateMainPhaseAction } from "./simulation.js";

export {
  applyDragonSimulatedBattleRewards,
  applyDragonRetentionPriorities,
  buildDragonPlanningProfile,
  describeDragonPlannedLine,
  scoreDragonBattleAttackCandidate,
  scoreDragonLineMilestones,
  scoreDragonLineTerminal,
} from "./linePlanning.js";
