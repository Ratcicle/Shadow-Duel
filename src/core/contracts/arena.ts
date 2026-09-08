import type { AIPlanningMode, AITurnPlanningMode } from "./ai.js";
import type { BotArchetypeId, BotRuntimePort } from "./bot.js";
import type { GameOptions, GameRendererPort } from "./game.js";
import type { RawCardDefinitionId } from "./primitives.js";

export type ArenaSpeed = "1x" | "2x" | "4x" | "instant";

export interface ArenaPlannerPreset {
  mode: AIPlanningMode;
  turnMode: AITurnPlanningMode | null;
  beamWidth: number;
  maxDepth: number;
  nodeBudget: number;
  candidateLimit: number;
}

export interface ArenaSpeedConfig {
  phaseDelayMs: number;
  actionDelayMs: number;
  battleDelayMs: number;
  pollIntervalMs: number;
  useRenderer: boolean;
  timeoutMs: number;
  diagnosticLog?: boolean;
  quietLogs?: boolean;
  beamWidth: number;
  maxDepth: number;
  nodeBudget: number;
  planner: ArenaPlannerPreset;
}

export interface ArenaPlannerConfig {
  mode: AIPlanningMode;
  turnMode: AITurnPlanningMode | null;
  beamWidth: number | null;
  maxDepth: number | null;
  nodeBudget: number | null;
  candidateLimit: number | null;
  hasCustomMode: boolean;
  hasCustomTurnMode: boolean;
  hasCustomBeamWidth: boolean;
  hasCustomMaxDepth: boolean;
  hasCustomNodeBudget: boolean;
  hasCustomCandidateLimit: boolean;
}

export interface ArenaSearchOptions {
  beamWidth?: number | null;
  maxDepth?: number | null;
  nodeBudget?: number | null;
  plannerMode?: AIPlanningMode | null;
  plannerTurnMode?: AITurnPlanningMode | null;
  plannerBeamWidth?: number | null;
  plannerMaxDepth?: number | null;
  plannerNodeBudget?: number | null;
  plannerCandidateLimit?: number | null;
  turnLineSearchMode?: AIPlanningMode | null;
  turnLineSearchTurnMode?: AITurnPlanningMode | null;
  turnLineSearchBeamWidth?: number | null;
  turnLineSearchMaxDepth?: number | null;
  turnLineSearchNodeBudget?: number | null;
  turnLineSearchCandidateLimit?: number | null;
  diagnosticLog?: boolean;
  quietLogs?: boolean;
  quiet?: boolean;
}

export interface ArenaDeckData {
  main: RawCardDefinitionId[];
  extra: RawCardDefinitionId[];
}

export type ArenaEndReason =
  | "lp_zero"
  | "max_turns"
  | "timeout"
  | "cancelled"
  | "error";

export type ArenaWinner = "player" | "bot" | "draw";

export type ArenaDuelOutcome =
  | { type: "completed"; reason: ArenaEndReason }
  | { type: "draw"; reason: ArenaEndReason }
  | { type: "cancelled"; reason: ArenaEndReason };

export interface ArenaCompletedDuelResult {
  duelNumber: number;
  winner: ArenaWinner;
  turns: number;
  type: "completed" | "draw" | "error";
  reason: ArenaEndReason | string | null;
  totalTimeMs: number;
  archetype1?: BotArchetypeId | "custom" | string;
  archetype2?: BotArchetypeId | "custom" | string;
  message?: string;
}

export interface ArenaCancelledDuelResult {
  type: "cancelled";
  duelNumber: number;
}

export type ArenaDuelResult =
  | ArenaCompletedDuelResult
  | ArenaCancelledDuelResult;

export interface ArenaProgressStats {
  completed: number;
  wins1: number;
  wins2: number;
  draws: number;
  drawsByTimeout: number;
  drawsByMaxTurns: number;
  avgTurns: string;
  lastResult: ArenaDuelResult;
}

export interface ArenaCompletionStats {
  completed: number;
  wins1: number;
  wins2: number;
  draws: number;
  drawsByTimeout: number;
  drawsByMaxTurns: number;
  avgTurns: string;
  avgDecisionTimeMs: number;
  batchDurationMs: number;
  endReasonBreakdown: unknown;
  analytics: ArenaAnalyticsPort;
}

export interface ArenaAnalyticsPort {
  reset(): void;
  startBatch(): void;
  endBatch(): void;
  recordDuel(result: unknown): void;
  getBatchStats(): {
    avgTurns?: number;
    avgDecisionTimeMs: number;
    batchDurationMs: number;
    endReasonBreakdown: unknown;
  };
  exportAsCSV(): string;
  exportAsJSONL(): string;
  exportSummary(): unknown;
  exportStrategicReport(options?: unknown): unknown;
  downloadCSV(filename?: string): void;
  downloadJSONL(filename?: string): void;
  downloadSummary(filename?: string): void;
  downloadStrategicReport(filename?: string, options?: unknown): void;
}

export interface ArenaGamePort {
  player: BotRuntimePort;
  bot: BotRuntimePort;
  renderer?: GameRendererPort | null;
  phaseDelayMs: number;
  aiActionDelayMs: number;
  aiSuccessfulActionDelayMs: number;
  aiPresentationStepDelayMs: number;
  aiBattleDelayMs?: number;
  disablePresentationDelays?: boolean;
  turnCounter: number;
  gameOver: boolean;
  winner: ArenaWinner | null;
  start(): Promise<unknown>;
}

export type ArenaGameConstructor = new (
  options?: GameOptions,
) => ArenaGamePort;

export type ArenaBotConstructor = new (
  archetype?: BotArchetypeId | string,
) => BotRuntimePort;

export interface ArenaRendererConstructor {
  new (): GameRendererPort;
}

export type ArenaProgressCallback = (stats: ArenaProgressStats) => void;
export type ArenaCompletionCallback = (stats: ArenaCompletionStats) => void;
