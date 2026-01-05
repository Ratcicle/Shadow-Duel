// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/shadowheart/index.js
// Re-exporta todos os módulos Shadow-Heart para acesso centralizado.
// ─────────────────────────────────────────────────────────────────────────────

// Knowledge base
export {
  CARD_KNOWLEDGE,
  BOSS_NAMES,
  isShadowHeart,
  isShadowHeartByName,
  getCardKnowledge,
  isBoss,
  isGoodTribute,
  isGoodDiscard,
} from "./knowledge.js";

// Combos
export {
  COMBO_DATABASE,
  detectAvailableCombos,
  getComboByName,
} from "./combos.js";

// Priorities e decisões
export {
  shouldPlaySpell,
  shouldSummonMonster,
  selectBestTributes,
  getTributeRequirementFor,
} from "./priorities.js";

// Scoring
export {
  evaluateMonster,
  evaluateBoardShadowHeart,
} from "./scoring.js";

// Simulation
export {
  simulateMainPhaseAction,
  simulateSpellEffect,
} from "./simulation.js";
