// ═══════════════════════════════════════════════════════════════════════════
// src/core/ai/replay/index.js
// Re-exports para o módulo de análise de replays
// ═══════════════════════════════════════════════════════════════════════════

export { ReplayDatabase, replayDatabase } from "./ReplayDatabase.js";
export { ReplayImporter, replayImporter } from "./ReplayImporter.js";
export { ReplayAnalyzer, replayAnalyzer } from "./ReplayAnalyzer.js";
export { ReplayInsights, replayInsights } from "./ReplayInsights.js";
export { PatternMatcher, patternMatcher } from "./PatternMatcher.js";

// Configuração de feature flags
export const REPLAY_INSIGHTS_FLAG = "shadow_duel_replay_insights";
export const REPLAY_WEIGHT_FLAG = "shadow_duel_replay_weight";

/**
 * Verifica se insights de replay estão habilitados
 */
export function isReplayInsightsEnabled() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(REPLAY_INSIGHTS_FLAG) === "true";
}

/**
 * Retorna o peso dos insights de replay (0.0 a 1.0)
 */
export function getReplayWeight() {
  if (typeof localStorage === "undefined") return 0.3;
  const weight = parseFloat(localStorage.getItem(REPLAY_WEIGHT_FLAG) || "0.3");
  return Math.max(0, Math.min(1, weight));
}

/**
 * Habilita/desabilita insights de replay
 */
export function setReplayInsightsEnabled(enabled) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(REPLAY_INSIGHTS_FLAG, enabled ? "true" : "false");
}

/**
 * Define o peso dos insights de replay
 */
export function setReplayWeight(weight) {
  if (typeof localStorage === "undefined") return;
  const clampedWeight = Math.max(0, Math.min(1, weight));
  localStorage.setItem(REPLAY_WEIGHT_FLAG, clampedWeight.toString());
}
