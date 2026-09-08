import type { ArenaWinner } from "../contracts/arena.js";
import type { EventCard } from "../contracts/events.js";


type Seat = "player" | "bot";
type Seats<Value> = Record<Seat, Value>;
type Counter = Record<string, number>;
type CounterList = Array<{
  name: string;
  count: number;
}>;
interface ArenaCardRef extends Omit<EventCard, "id"> {
  id?: number | string | null;
  label?: string | null;
  zone?: string | null;
}
type CardRef = ArenaCardRef | string | null | undefined;
type PlayerRef = {
  id?: string | number | null;
} | string | null | undefined;
interface ArenaSnapshotPlayer {
  id?: string;
  hand?: readonly ArenaCardRef[];
  field?: readonly ArenaCardRef[];
  spellTrap?: readonly ArenaCardRef[];
  fieldSpell?: ArenaCardRef | null;
  deck?: readonly unknown[];
  graveyard?: readonly unknown[];
  banished?: readonly unknown[];
  lp?: number;
  game?: unknown;
}
export interface ArenaSnapshotGame {
  turnCounter?: number;
  phase?: string | null;
  currentPhase?: string | null;
  turn?: string | null;
  currentPlayer?: {
    id?: string | null;
  };
  currentTurnPlayer?: {
    id?: string | null;
  };
  gameOver?: boolean;
  winner?: string | null;
  bot?: ArenaSnapshotPlayer;
  player?: ArenaSnapshotPlayer;
}
export interface ArenaAnalyticsOptions {
  enabled?: boolean;
  trackDecisionTime?: boolean;
  trackNodesVisited?: boolean;
  trackOpeningBook?: boolean;
  openingBookDepth?: number;
}
export interface ArenaTrackerOptions {
  seed?: number | string | null;
  beamWidth?: number | null;
  maxDepth?: number | null;
  plannerMode?: string | null;
  plannerTurnMode?: string | null;
  plannerBeamWidth?: number | null;
  plannerMaxDepth?: number | null;
  plannerNodeBudget?: number | null;
  plannerCandidateLimit?: number | null;
  diagnosticLog?: boolean;
  openingBookDepth?: number;
}
export interface ArenaReportOptions {
  includeDiagnostics?: boolean;
  detailedDiagnostics?: boolean;
  diagnostics?: boolean | "full" | "compact";
}
interface PlanningLabelObject {
  label?: unknown;
  name?: unknown;
  reason?: unknown;
  milestone?: unknown;
  description?: unknown;
  type?: unknown;
}
interface PlanningAction {
  type?: string;
  cardName?: string | null;
  name?: string;
  attackerName?: string;
  targetName?: string;
  cardId?: number;
  index?: number | null;
}
export interface ArenaRecordedAction extends PlanningAction {
  seat?: Seat | null;
  player?: Seat | null;
  turn?: number;
  success?: boolean;
  blocked?: boolean;
  reason?: string | null;
}
export interface ArenaProgressEntry {
  t?: number;
  stage?: string;
  turn?: number;
  phase?: string | null;
  currentPlayer?: string | null;
  gameOver?: boolean;
  actor?: PlayerRef;
  plannerMode?: string;
  plannerTurnMode?: string;
  plannerUsed?: boolean;
  plannedLineLength?: number;
  plannedNodesEvaluated?: number;
  plannedScore?: number;
  plannedMilestones?: readonly unknown[];
  selectedFirstAction?: PlanningAction | string | null;
  plannedFirstAction?: PlanningAction | string | null;
  executedFirstAction?: PlanningAction | string | null;
  actualAction?: PlanningAction | string | null;
  plannedAction?: PlanningAction | string | null;
  plannerReason?: string | null;
  mismatchReason?: string;
  diffSeverity?: string;
  matched?: boolean;
  diffs?: unknown[];
}
interface PlanSample {
  turn?: number;
  phase?: string | null;
  mode: string | null;
  turnMode: string | null;
  score: number | null;
  lineLength: number;
  nodes: number;
  firstAction: string | null;
  milestones: (string | null)[];
  reason: string | null;
}
interface MismatchSample {
  turn?: number;
  phase?: string | null;
  stage?: string;
  severity: string;
  selectedFirstAction: PlanningAction | string | null;
  executedFirstAction: PlanningAction | string | null;
  action: PlanningAction | string | null;
  reason: string | null;
  diffs: unknown[];
}
export interface ArenaRecordedEvent {
  t?: number | null;
  seat?: string | null;
  type?: string;
  card?: string | null;
  sourceCard?: string | null;
  effectId?: string | null;
  target?: string | null;
  targets?: (string | null)[];
  targetOwner?: string | null;
  targetZone?: string | null;
  position?: string | null;
  fromZone?: string | null;
  toZone?: string | null;
  fromPosition?: string | null;
  toPosition?: string | null;
  stage?: string | null;
  chainId?: number | string | null;
  linkId?: number | string | null;
  duelCardId?: number | null;
  activationKind?: string | null;
  effectKind?: string | null;
  effectType?: string | null;
  summonId?: string | number | null;
  damageStepId?: string | number | null;
  activationNegated?: boolean | null;
  effectNegated?: boolean | null;
  costPayment?: unknown;
  targetIds?: unknown;
  method?: string;
  tributes?: (string | null)[] | null;
  counterType?: string | null;
  amount?: number | null;
  action?: unknown;
  result?: unknown;
  lpPaid?: number | null;
  lpGained?: number | null;
  lpLost?: number | null;
  cost?: boolean | null;
}
export interface ArenaEventPayload {
  card?: ArenaCardRef | null;
  source?: CardRef;
  sourceCard?: CardRef;
  attacker?: CardRef;
  target?: ArenaCardRef | null;
  player?: PlayerRef;
  owner?: PlayerRef;
  attackerOwner?: PlayerRef;
  sourcePlayer?: PlayerRef;
  targets?: CardRef | readonly CardRef[];
  selectedTargets?: CardRef | readonly CardRef[];
  selectedCards?: CardRef | readonly CardRef[];
  cards?: CardRef | readonly CardRef[];
  addedCards?: CardRef | readonly CardRef[];
  tributes?: readonly CardRef[];
  action?: string | {
    effectId?: string;
  };
  effect?: {
    id?: string | null;
  } | null;
  effectId?: string | null;
  controllerId?: string;
  playerId?: string;
  stage?: string;
  status?: string;
  timing?: string;
  chainId?: string | number | null;
  linkId?: string | number | null;
  duelCardId?: number | null;
  activationKind?: string | null;
  effectKind?: string | null;
  effectType?: string | null;
  summonId?: string | number | null;
  damageStepId?: string | number | null;
  activationNegated?: boolean;
  effectNegated?: boolean;
  costPayment?: unknown;
  targetIds?: unknown;
  method?: string;
  summonMethod?: string;
  fromZone?: string;
  toZone?: string;
  sourceZone?: string;
  activationZone?: string;
  position?: string;
  turn?: number;
  placementOnly?: boolean;
  fromHand?: boolean;
  fromDeck?: boolean;
  activationContext?: {
    fromHand?: boolean;
    sourceZone?: string | null;
  } | null;
  wasDestroyed?: boolean;
  reason?: string;
  cause?: string;
  destroyCause?: string;
  contextLabel?: string;
  context?: unknown;
  fromPosition?: string;
  toPosition?: string;
  wasFlipped?: boolean;
  atkChange?: number;
  defChange?: number;
  counterType?: string;
  amount?: number;
  change?: unknown;
  result?: unknown;
  after?: unknown;
  lpPaid?: number;
  lpGained?: number;
  lpLost?: number;
  newLP?: number;
}
interface EventMeta {
  turn?: number;
}
interface ActivationAttempt extends ArenaRecordedAction {
  card?: CardRef;
  source?: CardRef;
  owner?: PlayerRef;
  actor?: PlayerRef;
  code?: string;
  kind?: string;
}
interface ZoneMoveOptions {
  fromZone?: string | null;
  contextLabel?: string;
  reason?: string;
  cause?: string;
  sourceCard?: CardRef;
  source?: CardRef;
  effectId?: string | null;
  position?: string;
}
interface ZoneMoveResult {
  success?: boolean;
  fromZone?: string | null;
  toZone?: string | null;
}
type PlanningStats = ReturnType<typeof createPlanningStats>;
type CompactPlanningStats = ReturnType<typeof compactPlanningStats>;
type SeatStats = ReturnType<typeof createSeatStats>;
type CompactSeatStats = ReturnType<typeof compactSeatStats>;
type GameSnapshot = ReturnType<DuelTracker["captureGameSnapshot"]>;
interface DuelDiagnostics {
  progress: ArenaProgressEntry[];
  zeroEventTimeoutSnapshot: GameSnapshot | null;
  stallSnapshots: GameSnapshot[];
}
type TrackedResult = ReturnType<DuelTracker["finalize"]>;
export type ArenaDuelInput = Partial<TrackedResult> & {
  duelNumber: number;
  winner: ArenaWinner;
};
interface DuelRecord extends Omit<TrackedResult, "reason" | "finalLP" | "cardsPlayed" | "actionsExecuted" | "strategic" | "planner" | "diagnostics" | "errors" | "warnings" | "archetype1" | "archetype2" | "timeoutKind"> {
  timestamp: number;
  timeoutKind: string | null;
  endReason: string;
  winnerArchetype: string | null | undefined;
  archetype1: string;
  archetype2: string;
  finalLP: Seats<number>;
  cardsPlayed: string[];
  actionsExecuted: ArenaRecordedAction[];
  strategic: TrackedResult["strategic"] | null;
  planner: TrackedResult["planner"] | null;
  diagnostics: DuelDiagnostics | null;
  errors: unknown[];
  warnings: unknown[];
}
type MatchupStats = ReturnType<ArenaAnalytics["createEmptyMatchupStats"]>;
interface OpeningEntry {
  sequence: PlanningAction[];
  wins: number;
  total: number;
}
interface StrategicMatchup {
  totalDuels: number;
  wins: Seats<number> & {
    draw: number;
  };
  winRate: Seats<number>;
  avgTurns: number;
  avgFinalLP: Seats<number>;
  endReasons: Counter;
  warnings: number;
  errors: number;
}
interface DuelSummary {
  duelNumber: number;
  matchup: string;
  winner: ArenaWinner;
  turns: number;
  finalLP: Seats<number>;
  endReason: string;
  planner: TrackedResult["planner"] | null;
  timeoutKind: string;
  actionsByBot: Seats<number>;
  actionsBySeat: Seats<number>;
  summons: Seats<number>;
  spellActivations: Seats<number>;
  trapActivations: Seats<number>;
  effectActivations: Seats<number>;
  spellTrapActivations: Seats<number>;
  attacks: Seats<number>;
  failedOrBlocked: Seats<number>;
  errors: unknown[];
  warnings: unknown[];
  bots: Partial<Seats<CompactSeatStats>>;
  participants: Partial<Seats<CompactSeatStats>>;
  events: ArenaRecordedEvent[];
  diagnostics?: ReturnType<typeof compactDuelDiagnostics>;
}
interface MoonlitResolution {
  recovered?: string | null;
  recoveredFrom: string | null;
  recoveredTo: string | null;
  summoned: boolean;
  summonedPosition: string | null;
  result: string | null;
}
interface PurgeStatResult {
  card: string;
  atkChange: unknown;
  turn: number | null;
}
interface SuspiciousAlert {
  type: string;
  severity: "high" | "medium" | "low";
  detail: {
    duelNumber?: number;
    matchup?: string;
    lastProgressStage?: string | null;
    events?: number;
    bot?: string;
    participant?: string;
    card?: string;
    count?: number;
    archetype?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
import { CHAIN_ACTIVATION_KINDS } from "../chain/link.js";

// src/core/ai/ArenaAnalytics.js
// Telemetria e analytics para BotArena — foco em métricas, não em policy.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Razões de término de duelo para categorização.
 */
export const END_REASONS = {
  LP_ZERO: "lp_zero",
  DECK_OUT: "deck_out",
  SURRENDER: "surrender",
  MAX_TURNS: "max_turns",
  TIMEOUT: "timeout",
  ERROR: "error",
  CANCELLED: "cancelled",
} as const;

const REPORT_VERSION = 5;
const SEATS: Seat[] = ["player", "bot"];
const DIAGNOSTIC_PROGRESS_LIMIT = 80;
const DIAGNOSTIC_SNAPSHOT_LIMIT = 3;
const TRACKED_EVENTS = new Set([
  "after_summon",
  "monster_set",
  "attack_declared",
  "combat_resolved",
  "spell_activated",
  "trap_activated",
  "effect_activated",
  "effect_usage",
  "activation_usage",
  "activation_transaction",
  "chain_link_resolution",
  "chain_finalization",
  "chain_finalization_complete",
  "summon_transaction",
  "summon_cost_paid",
  "summon_negated",
  "summon_attempt",
  "trigger_opportunity_opened",
  "segoc_order_selected",
  "damage_step_timing",
  "damage_step_completed",
  "battle_damage_inflicted",
  "cards_added_to_hand",
  "card_to_grave",
  "effect_targeted",
  "target_selected",
  "position_chosen",
  "position_change",
  "stat_buff_applied",
  "counter_changed",
  "damage_inflicted",
  "lp_change",
]);

const CANONICAL_LIFECYCLE_EVENTS = new Set([
  "effect_usage",
  "activation_usage",
  "activation_transaction",
  "chain_link_resolution",
  "chain_finalization",
  "chain_finalization_complete",
  "summon_transaction",
  "summon_cost_paid",
  "summon_negated",
  "summon_attempt",
  "trigger_opportunity_opened",
  "segoc_order_selected",
  "damage_step_timing",
  "damage_step_completed",
  "battle_damage_inflicted",
]);

const SHADOWHEART_FINISHERS = new Set([
  "Shadow-Heart Apex Dragon",
  "Shadow-Heart Malicious Dragon",
  "Shadow-Heart Demon Dragon",
  "Shadow-Heart Tyrant Dragon",
  "Shadow-Heart Archfiend Dragon",
]);

const SHADOWHEART_BOSSES = new Set([
  ...SHADOWHEART_FINISHERS,
  "Shadow-Heart Demon Dragon",
  "Shadow-Heart Dragon",
]);

const EXTREME_DRAGON_RE = /Extreme Dragon|Supreme Bahamut Dragon/i;

function createCounter(): Counter {
  return Object.create(null) as Counter;
}

function addCount(counter: Counter | null | undefined, key: string | null | undefined, amount = 1) {
  if (!counter || !key) return;
  counter[key] = (counter[key] || 0) + amount;
}

function topCounter(counter: Counter | null | undefined, limit = 12) {
  return Object.entries(counter || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function planningLabel(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    const direct =
      (value as PlanningLabelObject).label ||
      (value as PlanningLabelObject).name ||
      (value as PlanningLabelObject).reason ||
      (value as PlanningLabelObject).milestone ||
      (value as PlanningLabelObject).description ||
      (value as PlanningLabelObject).type;
    if (direct) return String(direct);
    try {
      return JSON.stringify(value).slice(0, 160);
    } catch (_error) {
      return "unserializable_planning_entry";
    }
  }
  return String(value);
}

function planningActionLabel(action: PlanningAction | string | null = null) {
  if (!action) return null;
  if (typeof action === "string") return action;
  const type = action.type || "action";
  const card =
    action.cardName ??
    action.name ??
    action.attackerName ??
    action.targetName ??
    action.cardId ??
    action.index;
  return card != null ? `${type}:${card}` : type;
}

function createPlanningStats() {
  return {
    attempts: 0,
    used: 0,
    executionMatches: 0,
    executionMismatches: 0,
    failedExecutions: 0,
    totalLineLength: 0,
    totalNodesEvaluated: 0,
    totalNodesWhenUsed: 0,
    scoreTotal: 0,
    scoreCount: 0,
    modeCounts: createCounter(),
    turnModeCounts: createCounter(),
    selectedFirstActions: createCounter(),
    executedFirstActions: createCounter(),
    topMilestones: createCounter(),
    mismatchReasons: createCounter(),
    planSamples: [] as PlanSample[],
    mismatchSamples: [] as MismatchSample[],
  };
}

function compactPlanningStats(planning: Partial<PlanningStats> = {}) {
  const attempts = planning.attempts || 0;
  const used = planning.used || 0;
  const executionComparisons =
    (planning.executionMatches || 0) +
    (planning.executionMismatches || 0) +
    (planning.failedExecutions || 0);
  return {
    attempts,
    used,
    usedRate: attempts ? round((used / attempts) * 100, 1) : 0,
    executionMatches: planning.executionMatches || 0,
    executionMismatches: planning.executionMismatches || 0,
    failedExecutions: planning.failedExecutions || 0,
    mismatchRate: executionComparisons
      ? round(
          (((planning.executionMismatches || 0) +
            (planning.failedExecutions || 0)) /
            executionComparisons) *
            100,
          1,
        )
      : 0,
    failedExecutionRate: used
      ? round(((planning.failedExecutions || 0) / used) * 100, 1)
      : 0,
    avgLineLength: used ? round((planning.totalLineLength || 0) / used) : 0,
    avgNodesEvaluated: attempts
      ? round((planning.totalNodesEvaluated || 0) / attempts)
      : 0,
    avgNodesWhenUsed: used
      ? round((planning.totalNodesWhenUsed || 0) / used)
      : 0,
    avgPlannedScore: planning.scoreCount
      ? round((planning.scoreTotal || 0) / planning.scoreCount, 2)
      : null,
    modeCounts: topCounter(planning.modeCounts),
    turnModeCounts: topCounter(planning.turnModeCounts),
    selectedFirstActions: topCounter(planning.selectedFirstActions),
    executedFirstActions: topCounter(planning.executedFirstActions),
    topMilestones: topCounter(planning.topMilestones),
    mismatchReasons: topCounter(planning.mismatchReasons),
    planSamples: (planning.planSamples || []).slice(0, 5),
    mismatchSamples: (planning.mismatchSamples || []).slice(0, 5),
  };
}

function round(value: number, digits = 1) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function cardName(card: CardRef) {
  if (typeof card === "string") return card;
  return card?.name || card?.cardName || card?.label || null;
}

function cardNames(value: CardRef | readonly CardRef[]) {
  if (!value) return [];
  const list: readonly CardRef[] = Array.isArray(value) ? value : [value as CardRef];
  return list.map(cardName).filter(Boolean);
}

function playerSeat(player: PlayerRef) {
  const id = typeof player === "string" ? player : player?.id;
  return id === "player" || id === "bot" ? id : null;
}

function compactCardRef(card: CardRef) {
  if (!card) return null;
  if (typeof card === "string") return { name: card };
  return {
    name: cardName(card),
    id: card.id ?? null,
    owner: card.owner ?? null,
    zone: card.zone ?? null,
    position: card.position ?? null,
  };
}

function compactCardNames(cards: readonly ArenaCardRef[] = [], limit = 12) {
  const list: readonly ArenaCardRef[] = Array.isArray(cards) ? cards : [];
  return list.slice(0, limit).map((card) => cardName(card) || "unknown");
}

function compactFieldCards(cards: readonly ArenaCardRef[] = [], limit = 8) {
  const list: readonly ArenaCardRef[] = Array.isArray(cards) ? cards : [];
  return list.slice(0, limit).map((card) => ({
    name: cardName(card) || "unknown",
    position: card?.position || null,
    faceDown: !!card?.isFacedown,
    atk: card?.atk ?? null,
    def: card?.def ?? null,
  }));
}

function compactFieldSpell(player: ArenaSnapshotPlayer | undefined) {
  if (!player?.fieldSpell) return null;
  return {
    name: cardName(player.fieldSpell) || "unknown",
    faceDown: !!player.fieldSpell.isFacedown,
  };
}

function compactPlayerSnapshot(player: ArenaSnapshotPlayer | undefined) {
  return {
    hand: compactCardNames(player?.hand),
    field: compactFieldCards(player?.field),
    spellTrap: compactCardNames(player?.spellTrap),
    fieldSpell: compactFieldSpell(player),
    deckSize: Array.isArray(player?.deck) ? player.deck.length : 0,
    graveyardSize: Array.isArray(player?.graveyard) ? player.graveyard.length : 0,
    banishedSize: Array.isArray(player?.banished) ? player.banished.length : 0,
    lp: player?.lp ?? null,
  };
}

function isDiagnosticsExportEnabledByFlag() {
  try {
    const storage = globalThis?.localStorage;
    if (!storage) return false;
    return (
      storage.getItem("shadow_duel_dev_mode") === "true" ||
      storage.getItem("shadow_duel_diagnostics_mode") === "true"
    );
  } catch (_err) {
    return false;
  }
}

function shouldIncludeDetailedDiagnostics(options: ArenaReportOptions | boolean | null = {}) {
  if (options === true) return true;
  if (!options || typeof options !== "object") {
    return isDiagnosticsExportEnabledByFlag();
  }
  if (
    options.includeDiagnostics === true ||
    options.detailedDiagnostics === true ||
    options.diagnostics === true ||
    options.diagnostics === "full"
  ) {
    return true;
  }
  if (
    options.includeDiagnostics === false ||
    options.detailedDiagnostics === false ||
    options.diagnostics === false ||
    options.diagnostics === "compact"
  ) {
    return false;
  }
  return isDiagnosticsExportEnabledByFlag();
}

function compactDuelDiagnostics(diagnostics: DuelDiagnostics | null | undefined, includeDetailed = false) {
  if (!diagnostics) return null;
  const zeroEventTimeoutSnapshot =
    diagnostics.zeroEventTimeoutSnapshot || null;
  if (includeDetailed) {
    return {
      progress: diagnostics.progress || [],
      zeroEventTimeoutSnapshot,
      stallSnapshots: diagnostics.stallSnapshots || [],
    };
  }
  if (zeroEventTimeoutSnapshot) {
    return { zeroEventTimeoutSnapshot };
  }
  return null;
}

function effectId(payload: ArenaEventPayload = {}) {
  return payload.effectId || payload.effect?.id || (payload.action as { effectId?: string } | undefined)?.effectId || null;
}

function sourceName(payload: ArenaEventPayload = {}) {
  return cardName(payload.sourceCard || payload.source || payload.card);
}

function causalKey(card: CardRef, source: CardRef) {
  const name = cardName(card);
  const src = cardName(source);
  return src ? `${name} <= ${src}` : name;
}

function classifyActivationEvent(eventName: string, payload: ArenaEventPayload = {}) {
  const card = payload.card || payload.source || null;
  const kind = (card as ArenaCardRef | null)?.cardKind || null;
  const canonicalKind = payload.activationKind || null;
  const effectType = String(payload.effectType || "");
  const activationZone = String(payload.activationZone || "");

  if (canonicalKind === CHAIN_ACTIVATION_KINDS.MONSTER_EFFECT) return "effect";
  if (
    canonicalKind === CHAIN_ACTIVATION_KINDS.SPELL_TRAP_CARD ||
    canonicalKind === CHAIN_ACTIVATION_KINDS.SPELL_TRAP_EFFECT
  ) {
    return kind === "trap" ? "trap" : "spell";
  }
  if (eventName === "spell_activated") return "spell";
  if (eventName === "trap_activated") return "trap";
  if (kind === "spell") return "spell";
  if (kind === "trap") return "trap";
  if (/spellTrapEffect|fieldSpell|spell_trap/i.test(effectType)) return "spell";
  if (activationZone === "spellTrap" || activationZone === "fieldSpell") {
    return (kind as ArenaCardRef["cardKind"]) === "trap" ? "trap" : "spell";
  }
  return "effect";
}

function createSeatStats(archetype = "unknown") {
  return {
    archetype,
    actions: 0,
    summons: 0,
    monsterSets: 0,
    fusionSummons: 0,
    ascensionSummons: 0,
    spellActivations: 0,
    spellCardActivations: 0,
    spellEffectActivations: 0,
    trapActivations: 0,
    trapCardActivations: 0,
    trapEffectActivations: 0,
    effectActivations: 0,
    attacks: 0,
    failedActions: 0,
    blockedActions: 0,
    activated: createCounter(),
    discarded: createCounter(),
    discardedByCost: createCounter(),
    discardedByDestruction: createCounter(),
    searched: createCounter(),
    summoned: createCounter(),
    setMonsters: createCounter(),
    fusionSummoned: createCounter(),
    ascensionSummoned: createCounter(),
    targeted: createCounter(),
    targetedBySource: createCounter(),
    invalidByCard: createCounter(),
    blockedByCard: createCounter(),
    usedAsCost: createCounter(),
    banished: createCounter(),
    graveyardResourceUses: 0,
    noUsefulTurns: 0,
    turnActions: createCounter(),
    planning: createPlanningStats(),
    warnings: [] as unknown[],
  };
}

function compactSeatStats(stats: SeatStats) {
  return {
    archetype: stats.archetype,
    actions: stats.actions,
    summons: stats.summons,
    fusionSummons: stats.fusionSummons,
    ascensionSummons: stats.ascensionSummons,
    spellActivations: stats.spellActivations || 0,
    spellCardActivations: stats.spellCardActivations || 0,
    spellEffectActivations: stats.spellEffectActivations || 0,
    trapActivations: stats.trapActivations || 0,
    trapCardActivations: stats.trapCardActivations || 0,
    trapEffectActivations: stats.trapEffectActivations || 0,
    effectActivations: stats.effectActivations || 0,
    // backward-compat aggregate
    spellTrapActivations: (stats.spellActivations || 0) + (stats.trapActivations || 0),
    attacks: stats.attacks,
    failedActions: stats.failedActions,
    blockedActions: stats.blockedActions,
    noUsefulTurns: stats.noUsefulTurns,
    activated: topCounter(stats.activated),
    discarded: topCounter(stats.discarded),
    discardedByCost: topCounter(stats.discardedByCost),
    discardedByDestruction: topCounter(stats.discardedByDestruction),
    searched: topCounter(stats.searched),
    summoned: topCounter(stats.summoned),
    monsterSets: stats.monsterSets || 0,
    setMonsters: topCounter(stats.setMonsters),
    fusionSummoned: topCounter(stats.fusionSummoned),
    ascensionSummoned: topCounter(stats.ascensionSummoned),
    targeted: topCounter(stats.targeted),
    targetedBySource: topCounter(stats.targetedBySource),
    invalidByCard: topCounter(stats.invalidByCard),
    blockedByCard: topCounter(stats.blockedByCard),
    usedAsCost: topCounter(stats.usedAsCost),
    banished: topCounter(stats.banished),
    graveyardResourceUses: stats.graveyardResourceUses,
    planning: compactPlanningStats(stats.planning),
    warnings: stats.warnings.slice(0, 8),
  };
}

/**
 * Classe para coletar e agregar métricas de duelos.
 * Focada em analytics, não em aprendizado de policy.
 */
export class ArenaAnalytics {
  declare enabled: boolean;
  declare trackDecisionTime: boolean;
  declare trackNodesVisited: boolean;
  declare trackOpeningBook: boolean;
  declare openingBookDepth: number;
  declare duelRecords: DuelRecord[];
  declare matchupStats: Map<string, MatchupStats>;
  declare cardPlayCounts: Map<string, number>;
  declare actionTypeCounts: Map<string, number>;
  declare actionFailureRates: Map<string, { success: number; fail: number }>;
  declare duelDurationDistribution: { veryShort: number; short: number; medium: number; long: number; veryLong: number };
  declare winConditions: { lpZero: number; deckOut: number; timeout: number; maxTurns: number; error: number; surrender: number };
  declare phaseMetrics: { earlyGameWins: number; midGameWins: number; lateGameWins: number; earlyGameLosses: number; midGameLosses: number; lateGameLosses: number };
  declare openingBook: { sequences: Map<string, Map<string, OpeningEntry>> };
  declare decisionTimes: number[];
  declare nodesPerTurn: number[];
  declare batchStartTime: number | null;
  declare batchEndTime: number | null;

  constructor(options: ArenaAnalyticsOptions = {}) {
    /** @type {boolean} */
    this.enabled = options.enabled !== false;

    /** @type {boolean} */
    this.trackDecisionTime = options.trackDecisionTime ?? true;

    /** @type {boolean} */
    this.trackNodesVisited = options.trackNodesVisited ?? true;

    /** @type {boolean} */
    this.trackOpeningBook = options.trackOpeningBook ?? false;

    /** @type {number} Quantos turnos iniciais rastrear para opening book */
    this.openingBookDepth = options.openingBookDepth ?? 2;

    // Reset stats
    this.reset();
  }

  /**
   * Reseta todas as métricas.
   */
  reset() {
    /** @type {DuelRecord[]} */
    this.duelRecords = [];

    /** @type {Map<string, MatchupStats>} Chave: "archetype1_vs_archetype2" */
    this.matchupStats = new Map();

    /** @type {Map<string, number>} Contagem de cartas jogadas */
    this.cardPlayCounts = new Map();

    /** @type {Map<string, number>} Contagem de ações por tipo */
    this.actionTypeCounts = new Map();

    /** @type {Map<string, {success: number, fail: number}>} Taxa de falhas por tipo de ação */
    this.actionFailureRates = new Map();

    /** @type {Object} Distribuição de duração de duelos */
    this.duelDurationDistribution = {
      veryShort: 0, // 1-5 turnos
      short: 0, // 6-10 turnos
      medium: 0, // 11-20 turnos
      long: 0, // 21-35 turnos
      veryLong: 0, // 36+ turnos
    };

    /** @type {Object} Win conditions breakdown */
    this.winConditions = {
      lpZero: 0,
      deckOut: 0,
      timeout: 0,
      maxTurns: 0,
      error: 0,
      surrender: 0,
    };

    /** @type {Object} Game phase metrics */
    this.phaseMetrics = {
      earlyGameWins: 0, // 1-7 turnos
      midGameWins: 0, // 8-15 turnos
      lateGameWins: 0, // 16+ turnos
      earlyGameLosses: 0,
      midGameLosses: 0,
      lateGameLosses: 0,
    };

    /** @type {OpeningBook} */
    this.openingBook = {
      sequences: new Map(), // "arch" -> Map<sequenceHash, { wins, total }>
    };

    /** @type {number[]} Tempos de decisão em ms */
    this.decisionTimes = [];

    /** @type {number[]} Nós visitados por turno */
    this.nodesPerTurn = [];

    /** @type {number} Timestamp de início do batch */
    this.batchStartTime = null;

    /** @type {number} Timestamp de fim do batch */
    this.batchEndTime = null;
  }

  /**
   * Inicia um novo batch de duelos.
   */
  startBatch() {
    this.batchStartTime = Date.now();
    this.batchEndTime = null;
  }

  /**
   * Finaliza o batch atual.
   */
  endBatch() {
    this.batchEndTime = Date.now();
  }

  /**
   * Registra o resultado de um duelo.
   * @param {DuelResult} result
   */
  recordDuel(result: ArenaDuelInput) {
    if (!this.enabled) return;

    const record: DuelRecord = {
      duelNumber: result.duelNumber,
      timestamp: Date.now(),
      seed: result.seed ?? null,
      archetype1: result.archetype1 ?? "unknown",
      archetype2: result.archetype2 ?? "unknown",
      winner: result.winner, // "player" | "bot" | "draw"
      winnerArchetype: this.resolveWinnerArchetype(result),
      turns: result.turns ?? 0,
      endReason: result.reason ?? END_REASONS.LP_ZERO,
      finalLP: {
        player: result.finalLP?.player ?? 0,
        bot: result.finalLP?.bot ?? 0,
      },
      totalTimeMs: result.totalTimeMs ?? 0,
      avgDecisionTimeMs: result.avgDecisionTimeMs ?? null,
      totalNodesVisited: result.totalNodesVisited ?? null,
      beamWidth: result.beamWidth ?? null,
      maxDepth: result.maxDepth ?? null,
      planner: result.planner ?? null,
      cardsPlayed: result.cardsPlayed ?? [],
      actionsExecuted: result.actionsExecuted ?? [],
      openingSequence: result.openingSequence ?? null,
      strategic: result.strategic ?? null,
      timeoutKind: result.timeoutKind ?? null,
      diagnostics: result.diagnostics ?? null,
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
    };

    this.duelRecords.push(record);
    this.updateMatchupStats(record);
    this.updateCardCounts(record);
    this.updateActionCounts(record);
    this.updateDuelDurationDistribution(record);
    this.updateWinConditions(record);
    this.updatePhaseMetrics(record);

    if (this.trackOpeningBook && record.openingSequence) {
      this.updateOpeningBook(record);
    }
  }

  /**
   * Resolve qual arquétipo venceu.
   * @private
   */
  resolveWinnerArchetype(result: ArenaDuelInput) {
    if (result.winner === "draw") return null;
    if (result.winner === "player") return result.archetype1;
    if (result.winner === "bot") return result.archetype2;
    return null;
  }

  /**
   * Atualiza estatísticas de matchup.
   * @private
   */
  updateMatchupStats(record: DuelRecord) {
    const key = `${record.archetype1}_vs_${record.archetype2}`;
    const reverseKey = `${record.archetype2}_vs_${record.archetype1}`;

    if (!this.matchupStats.has(key)) {
      this.matchupStats.set(key, this.createEmptyMatchupStats());
    }

    const stats = this.matchupStats.get(key)!;
    stats.total += 1;
    stats.totalTurns += record.turns;
    stats.totalFinalLP.player += record.finalLP.player;
    stats.totalFinalLP.bot += record.finalLP.bot;
    stats.errors += record.endReason === END_REASONS.ERROR ? 1 : 0;
    stats.warnings += (record.warnings || []).length;

    if (record.winner === "player") {
      stats.wins1 += 1;
    } else if (record.winner === "bot") {
      stats.wins2 += 1;
    } else {
      stats.draws += 1;
    }

    // Categorizar razão de término
    stats.endReasons[record.endReason] =
      (stats.endReasons[record.endReason] || 0) + 1;

    // Decision time
    if (record.avgDecisionTimeMs != null) {
      stats.decisionTimes.push(record.avgDecisionTimeMs);
    }

    // Nodes visited
    if (record.totalNodesVisited != null) {
      stats.nodesVisited.push(record.totalNodesVisited);
    }
  }

  /**
   * Cria estrutura vazia de matchup stats.
   * @private
   */
  createEmptyMatchupStats() {
    return {
      total: 0,
      wins1: 0,
      wins2: 0,
      draws: 0,
      totalTurns: 0,
      totalFinalLP: { player: 0, bot: 0 },
      endReasons: {} as Counter,
      decisionTimes: [] as number[],
      nodesVisited: [] as number[],
      errors: 0,
      warnings: 0,
    };
  }

  /**
   * Atualiza contagem de cartas jogadas.
   * @private
   */
  updateCardCounts(record: DuelRecord) {
    for (const cardName of record.cardsPlayed || []) {
      this.cardPlayCounts.set(
        cardName,
        (this.cardPlayCounts.get(cardName) || 0) + 1
      );
    }
  }

  /**
   * Atualiza contagem de tipos de ação.
   * @private
   */
  updateActionCounts(record: DuelRecord) {
    for (const action of record.actionsExecuted || []) {
      const actionType = action.type ?? "unknown";
      this.actionTypeCounts.set(
        actionType,
        (this.actionTypeCounts.get(actionType) || 0) + 1
      );
    }
  }

  /**
   * Atualiza distribuição de duração de duelos.
   * @private
   */
  updateDuelDurationDistribution(record: DuelRecord) {
    const turns = record.turns || 0;
    if (turns <= 5) this.duelDurationDistribution.veryShort += 1;
    else if (turns <= 10) this.duelDurationDistribution.short += 1;
    else if (turns <= 20) this.duelDurationDistribution.medium += 1;
    else if (turns <= 35) this.duelDurationDistribution.long += 1;
    else this.duelDurationDistribution.veryLong += 1;
  }

  /**
   * Atualiza win conditions breakdown.
   * @private
   */
  updateWinConditions(record: DuelRecord) {
    const reason = record.endReason || END_REASONS.LP_ZERO;
    if (reason === END_REASONS.LP_ZERO) this.winConditions.lpZero += 1;
    else if (reason === END_REASONS.DECK_OUT) this.winConditions.deckOut += 1;
    else if (reason === END_REASONS.TIMEOUT) this.winConditions.timeout += 1;
    else if (reason === END_REASONS.MAX_TURNS) this.winConditions.maxTurns += 1;
    else if (reason === END_REASONS.ERROR) this.winConditions.error += 1;
    else if (reason === END_REASONS.SURRENDER)
      this.winConditions.surrender += 1;
  }

  /**
   * Atualiza métricas de fase do jogo.
   * @private
   */
  updatePhaseMetrics(record: DuelRecord) {
    const turns = record.turns || 0;
    const isWin = record.winner === "player";

    if (turns <= 7) {
      if (isWin) this.phaseMetrics.earlyGameWins += 1;
      else if (record.winner === "bot") this.phaseMetrics.earlyGameLosses += 1;
    } else if (turns <= 15) {
      if (isWin) this.phaseMetrics.midGameWins += 1;
      else if (record.winner === "bot") this.phaseMetrics.midGameLosses += 1;
    } else {
      if (isWin) this.phaseMetrics.lateGameWins += 1;
      else if (record.winner === "bot") this.phaseMetrics.lateGameLosses += 1;
    }
  }

  /**
   * Atualiza opening book com sequência de abertura.
   * @private
   */
  updateOpeningBook(record: DuelRecord) {
    const arch = record.archetype1;
    const seq = record.openingSequence;
    if (!arch || !seq) return;

    const seqHash = this.hashOpeningSequence(seq);
    const isWin = record.winner === "player";

    if (!this.openingBook.sequences.has(arch)) {
      this.openingBook.sequences.set(arch, new Map());
    }

    const archBook = this.openingBook.sequences.get(arch)!;
    if (!archBook.has(seqHash)) {
      archBook.set(seqHash, { sequence: seq, wins: 0, total: 0 });
    }

    const entry = archBook.get(seqHash)!;
    entry.total += 1;
    if (isWin) entry.wins += 1;
  }

  /**
   * Gera hash para sequência de abertura.
   * @private
   */
  hashOpeningSequence(sequence: PlanningAction[]) {
    return sequence
      .map((action) => `${action.type}:${action.cardName || action.index}`)
      .join("|");
  }

  /**
   * Registra tempo de decisão individual.
   * @param {number} timeMs
   */
  recordDecisionTime(timeMs: number) {
    if (!this.enabled || !this.trackDecisionTime) return;
    this.decisionTimes.push(timeMs);
  }

  /**
   * Registra nós visitados em um turno.
   * @param {number} nodes
   */
  recordNodesVisited(nodes: number) {
    if (!this.enabled || !this.trackNodesVisited) return;
    this.nodesPerTurn.push(nodes);
  }

  /**
   * Calcula métrica de aggressiveness baseado em duração de duelos.
   * @private
   * @returns {Object}
   */
  calculateAggressiveness() {
    const total = this.duelRecords.length;
    if (total === 0) return { score: 0, rating: "unknown" };

    const dist = this.duelDurationDistribution;
    const shortGames = dist.veryShort + dist.short;
    const longGames = dist.long + dist.veryLong;

    // Score: quanto menor a duração média, mais agressivo
    const avgTurns =
      this.duelRecords.reduce((sum, r) => sum + (r.turns || 0), 0) / total;
    const score = Math.max(0, 100 - avgTurns * 3); // 10 turnos = 70 score

    let rating = "balanced";
    if (score >= 80) rating = "very_aggressive";
    else if (score >= 60) rating = "aggressive";
    else if (score >= 40) rating = "balanced";
    else if (score >= 20) rating = "defensive";
    else rating = "very_defensive";

    return {
      score: score.toFixed(1),
      rating,
      avgTurns: avgTurns.toFixed(1),
      shortGamesPercent: ((shortGames / total) * 100).toFixed(1),
      longGamesPercent: ((longGames / total) * 100).toFixed(1),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Getters de métricas agregadas
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Retorna estatísticas agregadas do batch atual.
   * @returns {BatchStats}
   */
  getBatchStats() {
    const total = this.duelRecords.length;
    if (total === 0) {
      return {
        total: 0,
        wins1: 0,
        wins2: 0,
        draws: 0,
        winRate1: 0,
        winRate2: 0,
        avgTurns: 0,
        avgDecisionTimeMs: null,
        avgNodesPerTurn: null,
        batchDurationMs: 0,
        endReasonBreakdown: {},
      };
    }

    let wins1 = 0;
    let wins2 = 0;
    let draws = 0;
    let totalTurns = 0;
    const endReasons: Counter = {};

    for (const record of this.duelRecords) {
      if (record.winner === "player") wins1 += 1;
      else if (record.winner === "bot") wins2 += 1;
      else draws += 1;

      totalTurns += record.turns;
      endReasons[record.endReason] = (endReasons[record.endReason] || 0) + 1;
    }

    const avgDecision =
      this.decisionTimes.length > 0
        ? this.decisionTimes.reduce((a, b) => a + b, 0) /
          this.decisionTimes.length
        : null;

    const avgNodes =
      this.nodesPerTurn.length > 0
        ? this.nodesPerTurn.reduce((a, b) => a + b, 0) /
          this.nodesPerTurn.length
        : null;

    return {
      total,
      wins1,
      wins2,
      draws,
      winRate1: (wins1 / total) * 100,
      winRate2: (wins2 / total) * 100,
      avgTurns: totalTurns / total,
      avgDecisionTimeMs: avgDecision,
      avgNodesPerTurn: avgNodes,
      batchDurationMs:
        this.batchEndTime && this.batchStartTime
          ? this.batchEndTime - this.batchStartTime
          : null,
      endReasonBreakdown: endReasons,
      duelDurationDistribution: { ...this.duelDurationDistribution },
      winConditionsBreakdown: { ...this.winConditions },
      phaseMetrics: { ...this.phaseMetrics },
      aggressiveness: this.calculateAggressiveness(),
    };
  }

  /**
   * Retorna estatísticas por matchup.
   * @param {string} archetype1
   * @param {string} archetype2
   * @returns {MatchupStats|null}
   */
  getMatchupStats(archetype1: string, archetype2: string) {
    const key = `${archetype1}_vs_${archetype2}`;
    return this.matchupStats.get(key) || null;
  }

  /**
   * Retorna todas as estatísticas de matchup.
   * @returns {Object<string, MatchupStats>}
   */
  getAllMatchupStats() {
    const result: Record<string, MatchupStats & { winRate1: string | number; winRate2: string | number; avgTurns: string | number; avgFinalLP: Seats<string | number>; avgDecisionTimeMs: string | null }> = {};
    for (const [key, stats] of this.matchupStats.entries()) {
      result[key] = {
        ...stats,
        winRate1:
          stats.total > 0 ? ((stats.wins1 / stats.total) * 100).toFixed(1) : 0,
        winRate2:
          stats.total > 0 ? ((stats.wins2 / stats.total) * 100).toFixed(1) : 0,
        avgTurns:
          stats.total > 0 ? (stats.totalTurns / stats.total).toFixed(1) : 0,
        avgFinalLP: {
          player:
            stats.total > 0
              ? (stats.totalFinalLP.player / stats.total).toFixed(1)
              : 0,
          bot:
            stats.total > 0
              ? (stats.totalFinalLP.bot / stats.total).toFixed(1)
              : 0,
        },
        avgDecisionTimeMs:
          stats.decisionTimes.length > 0
            ? (
                stats.decisionTimes.reduce((a, b) => a + b, 0) /
                stats.decisionTimes.length
              ).toFixed(1)
            : null,
      };
    }
    return result;
  }

  /**
   * Retorna top N cartas mais jogadas.
   * @param {number} n
   * @returns {Array<{card: string, count: number}>}
   */
  getTopPlayedCards(n = 10) {
    const sorted = [...this.cardPlayCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);

    return sorted.map(([card, count]) => ({ card, count }));
  }

  /**
   * Retorna top N ações mais frequentes.
   * @param {number} n
   * @returns {Array<{action: string, count: number}>}
   */
  getTopActions(n = 10) {
    const sorted = [...this.actionTypeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);

    return sorted.map(([action, count]) => ({ action, count }));
  }

  /**
   * Retorna melhores sequências de abertura para um arquétipo.
   * @param {string} archetype
   * @param {number} minGames - Mínimo de jogos para considerar
   * @returns {Array<{sequence: Array, winRate: number, total: number}>}
   */
  getBestOpenings(archetype: string, minGames = 3) {
    if (!this.openingBook.sequences.has(archetype)) {
      return [];
    }

    const archBook = this.openingBook.sequences.get(archetype)!;
    const results: Array<OpeningEntry & { winRate: number }> = [];

    for (const [, data] of archBook.entries()) {
      if (data.total >= minGames) {
        results.push({
          sequence: data.sequence,
          winRate: (data.wins / data.total) * 100,
          wins: data.wins,
          total: data.total,
        });
      }
    }

    return results.sort((a, b) => b.winRate - a.winRate);
  }

  exportStrategicReport(options: ArenaReportOptions | boolean | null = {}) {
    const includeDiagnostics = shouldIncludeDetailedDiagnostics(options);
    const matchups = this.buildStrategicMatchups();
    const duels = this.buildStrategicDuelSummaries({ includeDiagnostics });
    const bots = this.buildStrategicBotSummaries();
    const archetypes = this.buildArchetypeSummaries(duels);
    const suspiciousPatterns = this.detectSuspiciousPatterns(bots, archetypes, duels);

    return {
      generatedAt: new Date().toISOString(),
      version: REPORT_VERSION,
      duelCount: this.duelRecords.length,
      matchups,
      duels,
      bots,               // backward compat (Bot Arena)
      participants: bots, // semantic alias: inclui player + bot em qualquer modo
      archetypes,
      suspiciousPatterns,
    };
  }

  buildStrategicMatchups() {
    const matchups: Record<string, StrategicMatchup> = {};
    for (const record of this.duelRecords) {
      const key = `${record.archetype1}_vs_${record.archetype2}`;
      if (!matchups[key]) {
        matchups[key] = {
          totalDuels: 0,
          wins: { player: 0, bot: 0, draw: 0 },
          winRate: { player: 0, bot: 0 },
          avgTurns: 0,
          avgFinalLP: { player: 0, bot: 0 },
          endReasons: {} as Counter,
          warnings: 0,
          errors: 0,
        };
      }
      const stats = matchups[key];
      stats.totalDuels += 1;
      stats.wins[record.winner] = (stats.wins[record.winner] || 0) + 1;
      stats.avgTurns += record.turns || 0;
      stats.avgFinalLP.player += record.finalLP?.player || 0;
      stats.avgFinalLP.bot += record.finalLP?.bot || 0;
      stats.endReasons[record.endReason] =
        (stats.endReasons[record.endReason] || 0) + 1;
      stats.warnings += (record.warnings || []).length;
      stats.errors += record.endReason === END_REASONS.ERROR ? 1 : 0;
    }
    for (const stats of Object.values(matchups)) {
      const total = stats.totalDuels || 1;
      stats.winRate.player = round((stats.wins.player / total) * 100);
      stats.winRate.bot = round((stats.wins.bot / total) * 100);
      stats.avgTurns = round(stats.avgTurns / total);
      stats.avgFinalLP.player = round(stats.avgFinalLP.player / total);
      stats.avgFinalLP.bot = round(stats.avgFinalLP.bot / total);
    }
    return matchups;
  }

  buildStrategicDuelSummaries(options: ArenaReportOptions = {}) {
    const includeDiagnostics = options.includeDiagnostics === true;
    return this.duelRecords.map((record) => {
      const seats: Partial<Seats<CompactSeatStats>> = record.strategic?.seats || {};
      const diagnostics = compactDuelDiagnostics(
        record.diagnostics,
        includeDiagnostics,
      );
      const summary: DuelSummary = {
        duelNumber: record.duelNumber,
        matchup: `${record.archetype1}_vs_${record.archetype2}`,
        winner: record.winner,
        turns: record.turns,
        finalLP: record.finalLP,
        endReason: record.endReason,
        planner: record.planner || null,
        timeoutKind:
          record.timeoutKind ||
          (record.endReason === END_REASONS.TIMEOUT
            ? record.strategic?.events?.length
              ? "eventful_timeout"
              : "zero_event_timeout"
            : "none"),
        actionsByBot: {
          player: seats.player?.actions || 0,
          bot: seats.bot?.actions || 0,
        },
        actionsBySeat: {
          player: seats.player?.actions || 0,
          bot: seats.bot?.actions || 0,
        },
        summons: {
          player: seats.player?.summons || 0,
          bot: seats.bot?.summons || 0,
        },
        spellActivations: {
          player: seats.player?.spellActivations || 0,
          bot: seats.bot?.spellActivations || 0,
        },
        trapActivations: {
          player: seats.player?.trapActivations || 0,
          bot: seats.bot?.trapActivations || 0,
        },
        effectActivations: {
          player: seats.player?.effectActivations || 0,
          bot: seats.bot?.effectActivations || 0,
        },
        spellTrapActivations: {
          player: seats.player?.spellTrapActivations || 0,
          bot: seats.bot?.spellTrapActivations || 0,
        },
        attacks: {
          player: seats.player?.attacks || 0,
          bot: seats.bot?.attacks || 0,
        },
        failedOrBlocked: {
          player:
            (seats.player?.failedActions || 0) +
            (seats.player?.blockedActions || 0),
          bot:
            (seats.bot?.failedActions || 0) +
            (seats.bot?.blockedActions || 0),
        },
        errors: record.errors || [],
        warnings: record.warnings || [],
        bots: seats,          // backward compat
        participants: seats,  // semantic alias (player vs Bot ou Bot vs Bot)
        events: record.strategic?.events || [],
      };
      if (diagnostics) {
        summary.diagnostics = diagnostics;
      }
      return summary;
    });
  }

  buildStrategicBotSummaries() {
    const bots: Record<string, SeatStats & { duels: number; wins: number }> = {};
    for (const record of this.duelRecords) {
      const seats: Partial<Seats<CompactSeatStats>> = record.strategic?.seats || {};
      for (const seat of SEATS) {
        const seatStats = seats[seat];
        if (!seatStats) continue;
        const key = `${seat}:${seatStats.archetype || "unknown"}`;
        if (!bots[key]) {
          bots[key] = createSeatStats(seatStats.archetype || "unknown") as SeatStats & { duels: number; wins: number };
          bots[key].duels = 0;
          bots[key].wins = 0;
        }
        this.mergeSeatStats(bots[key], seatStats);
        bots[key].duels += 1;
        if (record.winner === seat) bots[key].wins += 1;
      }
    }

    const compact: Record<string, CompactSeatStats & { duels: number; wins: number; winRate: number }> = {};
    for (const [key, stats] of Object.entries(bots)) {
      compact[key] = {
        ...compactSeatStats(stats),
        duels: stats.duels,
        wins: stats.wins,
        winRate: stats.duels > 0 ? round((stats.wins / stats.duels) * 100) : 0,
      };
    }
    return compact;
  }

    mergeSeatStats(target: SeatStats, source: CompactSeatStats) {
      for (const field of [
      "actions",
      "summons",
      "monsterSets",
      "fusionSummons",
      "ascensionSummons",
      "spellActivations",
      "spellCardActivations",
      "spellEffectActivations",
      "trapActivations",
      "trapCardActivations",
      "trapEffectActivations",
      "effectActivations",
      "attacks",
      "failedActions",
      "blockedActions",
      "noUsefulTurns",
      "graveyardResourceUses",
    ] as const) {
      target[field] = (target[field] || 0) + (source[field] || 0);
    }
    for (const field of [
      "activated",
      "discarded",
      "discardedByCost",
      "discardedByDestruction",
      "searched",
      "summoned",
      "setMonsters",
      "fusionSummoned",
      "ascensionSummoned",
      "targeted",
      "targetedBySource",
      "invalidByCard",
      "blockedByCard",
      "usedAsCost",
      "banished",
    ] as const) {
      for (const { name, count } of source[field] || []) {
          addCount(target[field], name, count);
        }
      }
      this.mergePlanningStats(target.planning, source.planning);
    }

    mergePlanningStats(target = createPlanningStats(), source: Partial<CompactPlanningStats & Pick<PlanningStats, "totalLineLength" | "totalNodesEvaluated" | "totalNodesWhenUsed" | "scoreTotal" | "scoreCount">> = {}) {
      for (const field of [
        "attempts",
        "used",
        "executionMatches",
        "executionMismatches",
        "failedExecutions",
        "totalLineLength",
        "totalNodesEvaluated",
        "totalNodesWhenUsed",
        "scoreTotal",
        "scoreCount",
      ] as const) {
        target[field] = (target[field] || 0) + (source[field] || 0);
      }
      const avgLineLength = Number(source.avgLineLength || 0);
      if (avgLineLength && source.used) {
        target.totalLineLength =
          (target.totalLineLength || 0) + avgLineLength * source.used;
      }
      const avgNodesEvaluated = Number(source.avgNodesEvaluated || 0);
      if (avgNodesEvaluated && source.attempts) {
        target.totalNodesEvaluated =
          (target.totalNodesEvaluated || 0) +
          avgNodesEvaluated * source.attempts;
      }
      const avgNodesWhenUsed = Number(source.avgNodesWhenUsed || 0);
      if (avgNodesWhenUsed && source.used) {
        target.totalNodesWhenUsed =
          (target.totalNodesWhenUsed || 0) + avgNodesWhenUsed * source.used;
      }
      const avgPlannedScore = Number(source.avgPlannedScore);
      if (Number.isFinite(avgPlannedScore) && source.used) {
        target.scoreTotal = (target.scoreTotal || 0) + avgPlannedScore * source.used;
        target.scoreCount = (target.scoreCount || 0) + source.used;
      }
      for (const { name, count } of source.modeCounts || []) {
        addCount(target.modeCounts, name, count);
      }
      for (const { name, count } of source.turnModeCounts || []) {
        addCount(target.turnModeCounts, name, count);
      }
      for (const { name, count } of source.selectedFirstActions || []) {
        addCount(target.selectedFirstActions, name, count);
      }
      for (const { name, count } of source.executedFirstActions || []) {
        addCount(target.executedFirstActions, name, count);
      }
      for (const { name, count } of source.topMilestones || []) {
        addCount(target.topMilestones, planningLabel(name), count);
      }
      for (const { name, count } of source.mismatchReasons || []) {
        addCount(target.mismatchReasons, name, count);
      }
      target.planSamples = [
        ...(target.planSamples || []),
        ...(source.planSamples || []),
      ].slice(0, 5);
      target.mismatchSamples = [
        ...(target.mismatchSamples || []),
        ...(source.mismatchSamples || []),
      ].slice(0, 5);
    }

  buildArchetypeSummaries(duels: DuelSummary[]) {
    const archetypes = {
      shadowheart: {
        covenantInvalid: 0,
        covenantSuccess: 0,
        discards: [] as CounterList,
        discardsByCost: [] as CounterList,
        purgeUses: 0,
        purgeTargets: [] as CounterList, // legado: deprecated, mantido p/ compat (= purgeMonsterTargets)
        purgeDiscardCosts: [] as CounterList,
        purgeMonsterTargets: [] as CounterList,
        purgeStatResults: [] as PurgeStatResult[],
        purgeDestroyedTargets: 0,
        purgeSuccessfulUses: 0,
        purgeFailedOrBlockedUses: 0,
        polymerizationActivations: 0,
        fusionSummons: 0,
        bossesSummoned: [] as CounterList,
        battleHymnUses: 0,
        rageUses: 0,
        finisherDiscards: [] as CounterList,
      },
      luminarch: {
        knightsConvocationUses: 0,
        knightsConvocationDiscards: [] as CounterList,
        citadelTargets: [] as CounterList,
        spearTargets: [] as CounterList,
        moonlitRevives: [] as CounterList | { total: number; successful: number; summoned: number; handOnly: number; resolutions: MoonlitResolution[] },
        barbarias: {
          summoned: 0,
          summonedPositions: [] as CounterList,
          selfEffectUses: 0,
          effectTargets: [] as CounterList,
          selfTargets: 0,
          positionChanges: [] as CounterList,
          attacksAfterBuff: 0,
        },
      },
      dragon: {
        extremeDragonSummons: [] as CounterList,
        importantDiscards: [] as CounterList,
        importantBanishes: [] as CounterList,
        graveyardResourceUses: 0,
        noUsefulTurns: 0,
      },
    };
    const shDiscards = createCounter();
    const shDiscardsByCost = createCounter();
    const shBosses = createCounter();
    const shFinishers = createCounter();
    // Shadow-Heart Purge: separated by target slot ID (purge_discard vs purge_target_monster)
    const shPurgeDiscardCosts = createCounter();
    const shPurgeMonsterTargets = createCounter();
    const shPurgeStatResults: PurgeStatResult[] = [];
    let shPurgeDestroyedTargets = 0;
    // Luminarch: per-source targeting counters built from events array
    const lumCitadelTargets = createCounter();
    const lumSpearTargets = createCounter();
    const lumKCDiscards = createCounter();
    const lumBarbariasPositions = createCounter();
    const lumBarbariasTargets = createCounter();
    const lumBarbariasPositionChanges = createCounter();
    const barbariasBuffedByDuel = new Set<string>();
    // Luminarch Moonlit Blessing: agrupa cada resolução em uma única entrada
    const moonlitResolutions: MoonlitResolution[] = [];
    const moonlitByGroup = new Map<string, MoonlitResolution>();
    const dragonSummons = createCounter();
    const dragonDiscards = createCounter();
    const dragonBanishes = createCounter();

    const moonlitGroupKey = (duelN: number, t: number | null | undefined, seat: string | null | undefined) => `${duelN}|${t}|${seat}`;
    const ensureMoonlitResolution = (key: string) => {
      let res = moonlitByGroup.get(key);
      if (!res) {
        res = {
          recovered: null,
          recoveredFrom: null,
          recoveredTo: null,
          summoned: false,
          summonedPosition: null,
          result: null,
        };
        moonlitByGroup.set(key, res);
        moonlitResolutions.push(res);
      }
      return res;
    };

    for (const duel of duels) {
      // Percorre eventos do duelo para atribuição por fonte
      const duelEvents = duel.events || [];

      // Inferência segura de destruição por Purge:
      // só conta quando o move pro cemitério tem sourceCard = "Shadow-Heart Purge"
      // (propagado pelo handler modify_stats_temp_then_destroy_if_zeroed).
      for (const ev of duelEvents) {
        if (
          ev.type === "move" &&
          ev.sourceCard === "Shadow-Heart Purge" &&
          ev.toZone === "graveyard" &&
          ev.fromZone === "field" &&
          ev.card
        ) {
          shPurgeDestroyedTargets += 1;
        }
      }

      for (const ev of duelEvents) {
        const source = ev.sourceCard || null;
        const target = ev.card || ev.target || null;

        if (ev.type === "targeting" && source) {
          switch (source) {
            case "Shadow-Heart Purge":
              if (ev.targetZone === "purge_discard") {
                addCount(shPurgeDiscardCosts, target);
              } else if (ev.targetZone === "purge_target_monster") {
                addCount(shPurgeMonsterTargets, target);
              }
              break;
            case "Sanctum of the Luminarch Citadel":
              addCount(lumCitadelTargets, target);
              break;
            case "Luminarch Spear of Dawnfall":
              if (!ev.targetOwner || ev.targetOwner !== ev.seat) {
                addCount(lumSpearTargets, target);
              }
              break;
            case "Luminarch Moonlit Blessing": {
              const key = moonlitGroupKey(duel.duelNumber, ev.t, ev.seat);
              const res = ensureMoonlitResolution(key);
              res.recovered = target;
              res.recoveredFrom = "graveyard";
              break;
            }
            case "Luminarch Megashield Barbarias":
              addCount(lumBarbariasTargets, target);
              if (target === "Luminarch Megashield Barbarias") {
                archetypes.luminarch.barbarias.selfTargets += 1;
              }
              barbariasBuffedByDuel.add(`${duel.duelNumber}:${target}`);
              break;
            // Knights Convocation: NÃO acumular via targeting — targeting não
            // garante que a carta foi descartada como custo; a atribuição correta
            // vem do evento move (hand→graveyard com sourceCard=KC) logo abaixo.
          }
        }

        if (ev.type === "stat" && source === "Shadow-Heart Purge" && target) {
          shPurgeStatResults.push({
            card: target,
            atkChange: ev.result || null,
            turn: ev.t || null,
          });
        }

        if (ev.type === "move" && ev.sourceCard) {
          if (
            ev.sourceCard === "Luminarch Knights Convocation" &&
            ev.fromZone === "hand" &&
            ev.toZone === "graveyard"
          ) {
            addCount(lumKCDiscards, ev.card);
          }
          if (
            ev.sourceCard === "Luminarch Moonlit Blessing" &&
            ev.fromZone === "graveyard" &&
            ev.toZone === "hand"
          ) {
            const key = moonlitGroupKey(duel.duelNumber, ev.t, ev.seat);
            const res = ensureMoonlitResolution(key);
            if (!res.recovered) res.recovered = ev.card;
            res.recoveredFrom = "graveyard";
            res.recoveredTo = "hand";
          }
        }

        if (ev.type === "summon") {
          if (ev.sourceCard === "Luminarch Moonlit Blessing") {
            const key = moonlitGroupKey(duel.duelNumber, ev.t, ev.seat);
            const res = ensureMoonlitResolution(key);
            res.summoned = true;
            res.summonedPosition = ev.position || res.summonedPosition;
            if (!res.recovered) res.recovered = ev.card;
          }
          if (ev.card === "Luminarch Megashield Barbarias") {
            addCount(lumBarbariasPositions, ev.position || "unknown");
          }
        }

        if (
          ev.type === "position_chosen" &&
          ev.result === "Luminarch Moonlit Blessing"
        ) {
          // Some position_chosen events carry context = source name
          const key = moonlitGroupKey(duel.duelNumber, ev.t, ev.seat);
          const res = ensureMoonlitResolution(key);
          if (ev.position) res.summonedPosition = ev.position;
        }

        if (ev.type === "position" && ev.sourceCard === "Luminarch Megashield Barbarias") {
          addCount(
            lumBarbariasPositionChanges,
            `${ev.card}: ${ev.fromPosition || "?"}->${ev.toPosition || "?"}`,
          );
        }

        if (ev.type === "attack" && barbariasBuffedByDuel.has(`${duel.duelNumber}:${ev.card}`)) {
          archetypes.luminarch.barbarias.attacksAfterBuff += 1;
        }
      }

      // Finaliza result de cada Moonlit deste duelo
      for (const [key, res] of moonlitByGroup) {
        if (!key.startsWith(`${duel.duelNumber}|`)) continue;
        if (res.result) continue;
        if (res.recovered && (res.recoveredTo || res.summoned)) {
          res.result = "success";
        } else if (res.recovered) {
          res.result = "partial";
        } else {
          res.result = "fail";
        }
      }

      for (const seat of SEATS) {
        const stats = duel.bots?.[seat];
        if (!stats) continue;
        const arch = stats.archetype || "";
        const activated = Object.fromEntries(
          (stats.activated || []).map((entry) => [entry.name, entry.count]),
        );

        if (arch === "shadowheart") {
          archetypes.shadowheart.covenantSuccess +=
            activated["Shadow-Heart Covenant"] || 0;
          archetypes.shadowheart.purgeUses += activated["Shadow-Heart Purge"] || 0;
          archetypes.shadowheart.polymerizationActivations +=
            activated.Polymerization || 0;
          archetypes.shadowheart.battleHymnUses +=
            activated["Shadow-Heart Battle Hymn"] || 0;
          archetypes.shadowheart.rageUses += activated["Shadow-Heart Rage"] || 0;
          archetypes.shadowheart.fusionSummons += stats.fusionSummons || 0;
          for (const entry of stats.invalidByCard || []) {
            if (entry.name === "Shadow-Heart Covenant") {
              archetypes.shadowheart.covenantInvalid += entry.count;
            }
            if (entry.name === "Shadow-Heart Purge") {
              archetypes.shadowheart.purgeFailedOrBlockedUses += entry.count;
            }
          }
          for (const entry of stats.blockedByCard || []) {
            if (entry.name === "Shadow-Heart Purge") {
              archetypes.shadowheart.purgeFailedOrBlockedUses += entry.count;
            }
          }
          for (const entry of stats.discarded || []) {
            addCount(shDiscards, entry.name, entry.count);
            if (SHADOWHEART_FINISHERS.has(entry.name)) {
              addCount(shFinishers, entry.name, entry.count);
            }
          }
          for (const entry of stats.discardedByCost || []) {
            addCount(shDiscardsByCost, entry.name, entry.count);
          }
          for (const entry of stats.summoned || []) {
            if (SHADOWHEART_BOSSES.has(entry.name)) {
              addCount(shBosses, entry.name, entry.count);
            }
          }
        } else if (arch === "luminarch") {
          archetypes.luminarch.knightsConvocationUses +=
            activated["Luminarch Knights Convocation"] || 0;
          for (const entry of stats.summoned || []) {
            if (entry.name === "Luminarch Megashield Barbarias") {
              archetypes.luminarch.barbarias.summoned += entry.count;
            }
          }
          archetypes.luminarch.barbarias.selfEffectUses +=
            activated["Luminarch Megashield Barbarias"] || 0;
        } else if (arch === "dragon") {
          archetypes.dragon.graveyardResourceUses +=
            stats.graveyardResourceUses || 0;
          archetypes.dragon.noUsefulTurns += stats.noUsefulTurns || 0;
          for (const entry of stats.summoned || []) {
            if (EXTREME_DRAGON_RE.test(entry.name)) {
              addCount(dragonSummons, entry.name, entry.count);
            }
          }
          for (const entry of stats.discarded || []) {
            if (/Dragon|Polymerization/i.test(entry.name)) {
              addCount(dragonDiscards, entry.name, entry.count);
            }
          }
          for (const entry of stats.banished || []) {
            if (/Dragon|Polymerization/i.test(entry.name)) {
              addCount(dragonBanishes, entry.name, entry.count);
            }
          }
        }
      }
    }

    archetypes.shadowheart.discards = topCounter(shDiscards);
    archetypes.shadowheart.discardsByCost = topCounter(shDiscardsByCost);
    // Purge: estruturas separadas por slot de target
    const purgeMonsterTargetsList = topCounter(shPurgeMonsterTargets);
    archetypes.shadowheart.purgeMonsterTargets = purgeMonsterTargetsList;
    archetypes.shadowheart.purgeDiscardCosts = topCounter(shPurgeDiscardCosts);
    archetypes.shadowheart.purgeStatResults = shPurgeStatResults.slice(0, 24);
    archetypes.shadowheart.purgeDestroyedTargets = shPurgeDestroyedTargets;
    archetypes.shadowheart.purgeSuccessfulUses = purgeMonsterTargetsList.reduce(
      (s, e) => s + e.count,
      0,
    );
    // Compat legacy: purgeTargets agora reflete monstros alvejados (não custos)
    archetypes.shadowheart.purgeTargets = purgeMonsterTargetsList;
    archetypes.shadowheart.bossesSummoned = topCounter(shBosses);
    archetypes.shadowheart.finisherDiscards = topCounter(shFinishers);
    // Luminarch: fontes separadas por carta ativadora
    archetypes.luminarch.knightsConvocationDiscards = topCounter(lumKCDiscards);
    archetypes.luminarch.citadelTargets = topCounter(lumCitadelTargets);
    archetypes.luminarch.spearTargets = topCounter(lumSpearTargets);
    // Moonlit: cada resolução é uma entrada compacta
    archetypes.luminarch.moonlitRevives = {
      total: moonlitResolutions.length,
      successful: moonlitResolutions.filter((r) => r.result === "success").length,
      summoned: moonlitResolutions.filter((r) => r.summoned).length,
      handOnly: moonlitResolutions.filter(
        (r) => !r.summoned && r.recoveredTo === "hand",
      ).length,
      resolutions: moonlitResolutions.slice(0, 24),
    };
    archetypes.luminarch.barbarias.summonedPositions =
      topCounter(lumBarbariasPositions);
    archetypes.luminarch.barbarias.effectTargets = topCounter(lumBarbariasTargets);
    archetypes.luminarch.barbarias.positionChanges =
      topCounter(lumBarbariasPositionChanges);
    archetypes.dragon.extremeDragonSummons = topCounter(dragonSummons);
    archetypes.dragon.importantDiscards = topCounter(dragonDiscards);
    archetypes.dragon.importantBanishes = topCounter(dragonBanishes);
    return archetypes;
  }

  detectSuspiciousPatterns(bots: ReturnType<ArenaAnalytics["buildStrategicBotSummaries"]>, archetypes: ReturnType<ArenaAnalytics["buildArchetypeSummaries"]>, duels: DuelSummary[] = []) {
    const alerts: SuspiciousAlert[] = [];
    const pushAlert = (type: string, severity: SuspiciousAlert["severity"], detail: SuspiciousAlert["detail"]) => {
      alerts.push({ type, severity, detail });
    };

    for (const duel of duels) {
      if (duel.timeoutKind === "zero_event_timeout") {
        pushAlert("zero_event_timeout", "high", {
          duelNumber: duel.duelNumber,
          matchup: duel.matchup,
          lastProgressStage:
            duel.diagnostics?.zeroEventTimeoutSnapshot?.lastProgressStage ||
            duel.diagnostics?.progress?.at?.(-1)?.stage ||
            null,
        });
      } else if (duel.timeoutKind === "eventful_timeout") {
        pushAlert("eventful_timeout", "medium", {
          duelNumber: duel.duelNumber,
          matchup: duel.matchup,
          events: duel.events?.length || 0,
        });
      }
    }

    for (const [botKey, stats] of Object.entries(bots)) {
      for (const entry of stats.invalidByCard || []) {
        if (entry.count >= 3) {
          pushAlert("repeated_invalid_activation", "high", {
            bot: botKey,         // backward compat
            participant: botKey, // semântico: pode ser "player:X" em duelo normal
            card: entry.name,
            count: entry.count,
          });
        }
      }
      if (stats.blockedActions >= 5) {
        pushAlert("many_blocked_actions", "medium", {
          bot: botKey,         // backward compat
          participant: botKey,
          count: stats.blockedActions,
        });
      }
      if (stats.noUsefulTurns >= Math.max(3, stats.duels || 1)) {
        pushAlert("turns_without_useful_action", "medium", {
          bot: botKey,         // backward compat
          participant: botKey,
          count: stats.noUsefulTurns,
        });
      }
    }

    for (const entry of archetypes.shadowheart.finisherDiscards || []) {
      if (entry.count >= 2) {
        pushAlert("key_finisher_discarded", "medium", {
          archetype: "shadowheart",
          card: entry.name,
          count: entry.count,
        });
      }
    }
    if (archetypes.shadowheart.covenantInvalid >= 3) {
      pushAlert("shadowheart_covenant_invalid_many_times", "high", {
        count: archetypes.shadowheart.covenantInvalid,
      });
    }
    if (archetypes.dragon.noUsefulTurns >= 4) {
      pushAlert("dragon_turns_without_useful_action", "medium", {
        count: archetypes.dragon.noUsefulTurns,
      });
    }

    return alerts.sort((a, b) => {
      const severity = { high: 0, medium: 1, low: 2 };
      return (severity[a.severity] ?? 9) - (severity[b.severity] ?? 9);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Export de dados
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Exporta todos os registros como JSONL (JSON Lines).
   * @returns {string}
   */
  exportAsJSONL() {
    return this.duelRecords.map((record) => JSON.stringify(record)).join("\n");
  }

  /**
   * Exporta todos os registros como CSV.
   * @returns {string}
   */
  exportAsCSV() {
    if (this.duelRecords.length === 0) return "";

    const headers = [
      "duelNumber",
      "timestamp",
      "seed",
      "archetype1",
      "archetype2",
      "winner",
      "winnerArchetype",
      "turns",
      "endReason",
      "finalLP_player",
      "finalLP_bot",
      "totalTimeMs",
      "avgDecisionTimeMs",
      "totalNodesVisited",
      "beamWidth",
      "maxDepth",
    ];

    const rows = [headers.join(",")];

    for (const record of this.duelRecords) {
      const row = [
        record.duelNumber,
        record.timestamp,
        record.seed ?? "",
        record.archetype1,
        record.archetype2,
        record.winner,
        record.winnerArchetype ?? "",
        record.turns,
        record.endReason,
        record.finalLP.player,
        record.finalLP.bot,
        record.totalTimeMs,
        record.avgDecisionTimeMs ?? "",
        record.totalNodesVisited ?? "",
        record.beamWidth ?? "",
        record.maxDepth ?? "",
      ];
      rows.push(row.join(","));
    }

    return rows.join("\n");
  }

  /**
   * Exporta resumo agregado.
   * @returns {Object}
   */
  exportSummary() {
    return {
      batchStats: this.getBatchStats(),
      matchupStats: this.getAllMatchupStats(),
      topCards: this.getTopPlayedCards(15),
      topActions: this.getTopActions(10),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Faz download do CSV no browser.
   * @param {string} filename
   */
  downloadCSV(filename = "arena_results.csv") {
    const csv = this.exportAsCSV();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /**
   * Faz download do JSONL no browser.
   * @param {string} filename
   */
  downloadJSONL(filename = "arena_results.jsonl") {
    const jsonl = this.exportAsJSONL();
    const blob = new Blob([jsonl], {
      type: "application/x-ndjson;charset=utf-8;",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /**
   * Faz download do resumo JSON no browser.
   * @param {string} filename
   */
  downloadSummary(filename = "arena_summary.json") {
    const summary = this.exportSummary();
    const blob = new Blob([JSON.stringify(summary, null, 2)], {
      type: "application/json;charset=utf-8;",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /**
   * Faz download do relatorio estrategico JSON compacto.
   * @param {string} filename
   * @param {Object} options
   */
  downloadStrategicReport(filename = "arena_strategic_report.json", options: ArenaReportOptions | boolean | null = {}) {
    const report = this.exportStrategicReport(options);
    const blob = new Blob([JSON.stringify(report)], {
      type: "application/json;charset=utf-8;",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton para uso global (opcional)
// ─────────────────────────────────────────────────────────────────────────────

let globalAnalytics: ArenaAnalytics | null = null;

/**
 * Retorna instância global de analytics.
 * @returns {ArenaAnalytics}
 */
export function getGlobalAnalytics() {
  if (!globalAnalytics) {
    globalAnalytics = new ArenaAnalytics();
  }
  return globalAnalytics;
}

/**
 * Reseta instância global.
 */
export function resetGlobalAnalytics() {
  if (globalAnalytics) {
    globalAnalytics.reset();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers para coleta durante duelo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria um DuelTracker para coletar métricas durante um duelo.
 * Usar .finalize() ao fim do duelo para obter o resultado completo.
 */
export class DuelTracker {
  declare duelNumber: number;
  declare archetype1: string;
  declare archetype2: string;
  declare seed: number | string | null;
  declare beamWidth: number | null;
  declare maxDepth: number | null;
  declare plannerMode: string | null;
  declare plannerTurnMode: string | null;
  declare plannerBeamWidth: number | null;
  declare plannerMaxDepth: number | null;
  declare plannerNodeBudget: number | null;
  declare plannerCandidateLimit: number | null;
  declare diagnosticLog: boolean;
  declare startTime: number;
  declare cardsPlayed: string[];
  declare actionsExecuted: ArenaRecordedAction[];
  declare decisionTimes: number[];
  declare nodesVisited: number[];
  declare openingSequence: PlanningAction[];
  declare openingTurnLimit: number;
  declare currentTurn: number;
  declare seats: Seats<SeatStats>;
  declare lastActivated: Seats<string | null>;
  declare targetingKeys: Set<string>;
  declare rawSpellTrapActivationKeys: Set<string>;
  declare events: ArenaRecordedEvent[];
  declare errors: unknown[];
  declare warnings: unknown[];
  declare lastProgressStage: string | null;
  declare turnOwners: Record<string, Seat>;
  declare diagnostics: DuelDiagnostics;

  constructor(duelNumber: number, archetype1: string, archetype2: string, options: ArenaTrackerOptions = {}) {
    this.duelNumber = duelNumber;
    this.archetype1 = archetype1;
    this.archetype2 = archetype2;
    this.seed = options.seed ?? null;
    this.beamWidth = options.beamWidth ?? null;
    this.maxDepth = options.maxDepth ?? null;
    this.plannerMode = options.plannerMode ?? null;
    this.plannerTurnMode = options.plannerTurnMode ?? null;
    this.plannerBeamWidth = options.plannerBeamWidth ?? null;
    this.plannerMaxDepth = options.plannerMaxDepth ?? null;
    this.plannerNodeBudget = options.plannerNodeBudget ?? null;
    this.plannerCandidateLimit = options.plannerCandidateLimit ?? null;
    this.diagnosticLog = options.diagnosticLog === true;

    this.startTime = Date.now();
    this.cardsPlayed = [];
    this.actionsExecuted = [];
    this.decisionTimes = [];
    this.nodesVisited = [];
    this.openingSequence = [];
    this.openingTurnLimit = options.openingBookDepth ?? 2;
    this.currentTurn = 0;
    this.seats = {
      player: createSeatStats(archetype1),
      bot: createSeatStats(archetype2),
    };
    // Última carta ativada por seat — usado para atribuir eventos de targeting à fonte
    this.lastActivated = { player: null, bot: null };
    this.targetingKeys = new Set();
    this.rawSpellTrapActivationKeys = new Set();
    this.events = [];
    this.errors = [];
    this.warnings = [];
    this.lastProgressStage = null;
    this.turnOwners = Object.create(null) as Record<string, Seat>;
    this.diagnostics = {
      progress: [],
      zeroEventTimeoutSnapshot: null,
      stallSnapshots: [],
    };
  }

  /**
   * Registra uma carta jogada.
   */
  recordCardPlayed(cardName: string) {
    this.cardsPlayed.push(cardName);
  }

  /**
   * Registra uma ação executada.
   */
  recordAction(action: ArenaRecordedAction) {
    this.actionsExecuted.push(action);
    const seat = action?.seat || action?.player || null;
    if (this.seats[seat!]) {
      this.seats[seat!].actions += 1;
      if (action.success === false) this.seats[seat!].failedActions += 1;
      if (action.blocked === true) this.seats[seat!].blockedActions += 1;
      this.markUsefulAction(seat, action?.turn);
    }

    // Opening book: só primeiros N turnos
    if (this.currentTurn <= this.openingTurnLimit) {
      this.openingSequence.push({
        type: action.type,
        cardName: action.cardName ?? null,
        index: action.index ?? null,
      });
    }
  }

  /**
   * Registra tempo de uma decisão.
   */
  recordDecision(timeMs: number, nodesVisited: number | null = null) {
    this.decisionTimes.push(timeMs);
    if (nodesVisited != null) {
      this.nodesVisited.push(nodesVisited);
    }
  }

  /**
   * Avança o contador de turno.
   */
  nextTurn() {
    this.currentTurn += 1;
  }

  setCurrentTurn(turn: number | undefined) {
    const numericTurn = Number(turn);
    if (Number.isFinite(numericTurn) && numericTurn > this.currentTurn) {
      this.currentTurn = numericTurn;
    }
  }

  markUsefulAction(seat: Seat | null, turn: number | null = null) {
    if (!this.seats[seat!]) return;
    const numericTurn = Number(turn);
    const turnKey = Number.isFinite(numericTurn)
      ? String(numericTurn)
      : String(this.currentTurn || 0);
    if (turnKey !== "0") {
      addCount(this.seats[seat!].turnActions, turnKey);
    }
  }

  recordTurnOwnerFromGame(game: ArenaSnapshotGame | null = null) {
    const turn = Number(game?.turnCounter ?? this.currentTurn ?? 0);
    const currentPlayer =
      game?.turn ??
      game?.currentPlayer?.id ??
      game?.currentTurnPlayer?.id ??
      null;
    if (!Number.isFinite(turn) || turn <= 0 || !SEATS.includes(currentPlayer as Seat)) {
      return;
    }
    this.turnOwners[String(turn)] = currentPlayer as Seat;
  }

  pushEvent(event: ArenaRecordedEvent) {
    if (!event || this.events.length >= 400) return;
    const compact: ArenaRecordedEvent = {};
    for (const [key, value] of Object.entries(event)) {
      if (value !== undefined && value !== null) (compact as Record<string, unknown>)[key] = value;
    }
    this.events.push(compact);
  }

  getStrategicEventCount() {
    return this.events.length;
  }

  getTimeoutKind(reason: string) {
    if (reason !== END_REASONS.TIMEOUT) return "none";
    return this.events.length === 0 ? "zero_event_timeout" : "eventful_timeout";
  }

  recordProgress(stage: string, game: ArenaSnapshotGame | null = null, details: Record<string, unknown> = {}) {
    if (!stage) return;
    const turn = game?.turnCounter ?? this.currentTurn ?? 0;
    const phase = game?.phase ?? game?.currentPhase ?? null;
    const currentPlayer =
      game?.turn ??
      game?.currentPlayer?.id ??
      game?.currentTurnPlayer?.id ??
      null;
    const entry: ArenaProgressEntry = {
      t: Date.now() - this.startTime,
      stage,
      turn,
      phase,
      currentPlayer,
      gameOver: !!game?.gameOver,
    };
    this.recordTurnOwnerFromGame(game);
    for (const [key, value] of Object.entries(details || {})) {
      if (value !== undefined && value !== null) (entry as Record<string, unknown>)[key] = value;
    }

      this.lastProgressStage = stage;
      this.diagnostics.progress.push(entry);
      if (this.diagnostics.progress.length > DIAGNOSTIC_PROGRESS_LIMIT) {
        this.diagnostics.progress.shift();
      }
      this.recordPlanningProgress(entry);

      if (this.diagnosticLog) {
        console.log(
          `[BotArena:progress] duel=${this.duelNumber} stage=${stage} turn=${turn} phase=${phase || "?"}`,
        );
      }
    }

    recordPlanningProgress(entry: ArenaProgressEntry = {}) {
      if (
        entry.stage !== "ai_turn_line_search" &&
        entry.stage !== "ai_plan_execution_compare" &&
        entry.stage !== "ai_plan_execution_failed"
      ) {
        return;
      }
      const seat = playerSeat(entry.actor || entry.currentPlayer);
      const stats = this.seats[seat!];
      if (!stats) return;
      const planning = stats.planning || (stats.planning = createPlanningStats());

      if (entry.stage === "ai_turn_line_search") {
        planning.attempts += 1;
        addCount(planning.modeCounts, entry.plannerMode || "unknown");
        addCount(planning.turnModeCounts, entry.plannerTurnMode || "unknown");
        if (entry.plannerUsed) {
          planning.used += 1;
          planning.totalLineLength += Number(entry.plannedLineLength || 0);
          planning.totalNodesWhenUsed += Number(entry.plannedNodesEvaluated || 0);
        }
        planning.totalNodesEvaluated += Number(entry.plannedNodesEvaluated || 0);
        const score = Number(entry.plannedScore);
        if (Number.isFinite(score)) {
          planning.scoreTotal += score;
          planning.scoreCount += 1;
        }
        for (const milestone of entry.plannedMilestones || []) {
          addCount(planning.topMilestones, planningLabel(milestone));
        }
        const firstAction =
          entry.selectedFirstAction || entry.plannedFirstAction || null;
        addCount(planning.selectedFirstActions, planningActionLabel(firstAction));
        if (
          entry.plannerUsed &&
          (planning.planSamples || []).length < 5
        ) {
          planning.planSamples.push({
            turn: entry.turn,
            phase: entry.phase,
            mode: entry.plannerMode || null,
            turnMode: entry.plannerTurnMode || null,
            score: Number.isFinite(score) ? round(score, 2) : null,
            lineLength: entry.plannedLineLength || 0,
            nodes: entry.plannedNodesEvaluated || 0,
            firstAction: planningActionLabel(firstAction),
            milestones: (entry.plannedMilestones || [])
              .map(planningLabel)
              .filter(Boolean)
              .slice(0, 4),
            reason: entry.plannerReason || null,
          });
        }
        return;
      }

      const executedFirstAction =
        entry.executedFirstAction || entry.actualAction || null;
      addCount(
        planning.executedFirstActions,
        planningActionLabel(executedFirstAction),
      );

      if (entry.stage === "ai_plan_execution_failed") {
        planning.failedExecutions += 1;
        addCount(planning.mismatchReasons, entry.mismatchReason || "action_failed");
      } else if (entry.matched) {
        planning.executionMatches += 1;
      } else {
        planning.executionMismatches += 1;
        addCount(
          planning.mismatchReasons,
          entry.mismatchReason || entry.diffSeverity || "state_mismatch",
        );
      }

      if (
        (entry.stage === "ai_plan_execution_failed" || !entry.matched) &&
        (planning.mismatchSamples || []).length < 5
      ) {
        planning.mismatchSamples.push({
          turn: entry.turn,
          phase: entry.phase,
          stage: entry.stage,
          severity: entry.mismatchReason || entry.diffSeverity || "action_failed",
          selectedFirstAction:
            entry.selectedFirstAction || entry.plannedAction || null,
          executedFirstAction:
            entry.executedFirstAction || entry.actualAction || null,
          action: entry.plannedAction || entry.actualAction || null,
          reason: entry.plannerReason || null,
          diffs: (entry.diffs || []).slice(0, 3),
        });
      }
    }

    captureGameSnapshot(game: ArenaSnapshotGame | null = null, reason = "snapshot") {
    return {
      reason,
      capturedAtMs: Date.now() - this.startTime,
      duelNumber: this.duelNumber,
      turnCounter: game?.turnCounter ?? this.currentTurn ?? 0,
      phase: game?.phase ?? game?.currentPhase ?? null,
      currentPhase: game?.currentPhase ?? game?.phase ?? null,
      currentPlayer: game?.currentPlayer?.id ?? game?.turn ?? null,
      currentTurnPlayer: game?.currentTurnPlayer?.id ?? game?.turn ?? null,
      turn: game?.turn ?? null,
      gameOver: !!game?.gameOver,
      winner: game?.winner ?? null,
      player: compactPlayerSnapshot(game?.player),
      bot: compactPlayerSnapshot(game?.bot),
      refs: {
        gamePlayer: !!game?.player,
        gameBot: !!game?.bot,
        playerGame: game?.player?.game === game,
        botGame: game?.bot?.game === game,
      },
      lastProgressStage: this.lastProgressStage,
      lastProgress: this.diagnostics.progress.at(-1) || null,
    };
  }

  recordStallSnapshot(reason: string, game: ArenaSnapshotGame | null = null) {
    const snapshot = this.captureGameSnapshot(game, reason);
    if (
      reason === "zero_event_timeout" &&
      !this.diagnostics.zeroEventTimeoutSnapshot
    ) {
      this.diagnostics.zeroEventTimeoutSnapshot = snapshot;
    }
    if (this.diagnostics.stallSnapshots.length < DIAGNOSTIC_SNAPSHOT_LIMIT) {
      this.diagnostics.stallSnapshots.push(snapshot);
    }
    const warning = `${reason}: no strategic events before first action`;
    if (!this.warnings.includes(warning)) {
      this.warnings.push(warning);
    }
    this.recordProgress(reason, game, { snapshot: true });
    return snapshot;
  }

  recordEvent(eventName: string, payload: ArenaEventPayload = {}, meta: EventMeta = {}) {
    if (!TRACKED_EVENTS.has(eventName)) return;
    this.setCurrentTurn(meta.turn);

    if (eventName === "after_summon") {
      this.recordSummon(payload, meta);
    } else if (eventName === "monster_set") {
      this.recordMonsterSet(payload, meta);
    } else if (eventName === "attack_declared") {
      this.recordAttack(payload, meta);
    } else if (
      eventName === "spell_activated" ||
      eventName === "trap_activated" ||
      eventName === "effect_activated"
    ) {
      this.recordActivationEvent(eventName, payload, meta);
    } else if (eventName === "cards_added_to_hand") {
      this.recordCardsAddedToHand(payload, meta);
    } else if (eventName === "card_to_grave") {
      this.recordCardToGrave(payload, meta);
    } else if (eventName === "effect_targeted" || eventName === "target_selected") {
      this.recordTargeting(payload, meta);
    } else if (eventName === "position_chosen") {
      this.recordPositionChosen(payload, meta);
    } else if (eventName === "position_change") {
      this.recordPositionChange(payload, meta);
    } else if (eventName === "stat_buff_applied") {
      this.recordStatBuff(payload, meta);
    } else if (eventName === "counter_changed") {
      this.recordCounterEvent(payload, meta);
    } else if (eventName === "damage_inflicted" || eventName === "lp_change") {
      this.recordLpEvent(eventName, payload, meta);
    } else if (CANONICAL_LIFECYCLE_EVENTS.has(eventName)) {
      this.recordCanonicalLifecycleEvent(eventName, payload, meta);
    }
  }

  recordCanonicalLifecycleEvent(eventName: string, payload: ArenaEventPayload = {}, meta: EventMeta = {}) {
    const seat =
      playerSeat(payload.player || payload.owner) ||
      payload.controllerId ||
      payload.playerId ||
      null;
    this.pushEvent({
      t: meta.turn,
      seat: this.seats[seat as Seat] ? seat : null,
      type: eventName,
      stage: payload.stage || payload.status || payload.timing || null,
      chainId: payload.chainId ?? null,
      linkId: payload.linkId ?? null,
      effectId: payload.effectId || null,
      duelCardId: payload.duelCardId ?? null,
      activationKind: payload.activationKind || null,
      summonId: payload.summonId ?? null,
      damageStepId: payload.damageStepId ?? null,
      activationNegated: payload.activationNegated === true || null,
      effectNegated: payload.effectNegated === true || null,
      costPayment: payload.costPayment || null,
      targetIds: payload.targetIds || null,
    });
  }

  recordSummon(payload: ArenaEventPayload = {}, meta: EventMeta = {}) {
    const seat = playerSeat(payload.player);
    const name = cardName(payload.card);
    if (!this.seats[seat!] || !name) return;

    const method = payload.method || payload.summonMethod || "summon";
    const stats = this.seats[seat!];
    stats.summons += 1;
    addCount(stats.summoned, name);
    this.markUsefulAction(seat, meta.turn);

    if (method === "fusion") {
      stats.fusionSummons += 1;
      addCount(stats.fusionSummoned, name);
    }
    if (method === "ascension") {
      stats.ascensionSummons += 1;
      addCount(stats.ascensionSummoned, name);
    }
    this.pushEvent({
      t: meta.turn,
      seat,
      type: "summon",
      card: name,
      method,
      fromZone: payload.fromZone || null,
      position: payload.position || payload.card?.position || null,
      sourceCard: sourceName(payload),
      effectId: effectId(payload),
    });
  }

  recordMonsterSet(payload: ArenaEventPayload = {}, meta: EventMeta = {}) {
    const seat = playerSeat(payload.player);
    const name = cardName(payload.card);
    if (!this.seats[seat!] || !name) return;

    const stats = this.seats[seat!];
    stats.monsterSets += 1;
    addCount(stats.setMonsters, name);
    this.markUsefulAction(seat, meta.turn);

    this.pushEvent({
      t: meta.turn,
      seat,
      type: "monster_set",
      card: name,
      method: payload.method || "normal_set",
      fromZone: payload.fromZone || null,
      position: payload.position || payload.card?.position || "defense",
      tributes: Array.isArray(payload.tributes)
        ? payload.tributes.map(cardName).filter(Boolean)
        : null,
    });
  }

  recordAttack(payload: ArenaEventPayload = {}, meta: EventMeta = {}) {
    const seat = playerSeat(payload.attackerOwner);
    if (!this.seats[seat!]) return;

    this.seats[seat!].attacks += 1;
    this.markUsefulAction(seat, meta.turn);
    this.pushEvent({
      t: meta.turn,
      seat,
      type: "attack",
      card: cardName(payload.attacker),
      target: cardName(payload.target),
      result: payload.result || null,
    });
  }

  recordActivationEvent(eventName: string, payload: ArenaEventPayload = {}, meta: EventMeta = {}) {
    const seat = playerSeat(payload.player || payload.owner);
    const name = cardName(payload.card || payload.source);
    if (!this.seats[seat!] || !name) return;

    const stats = this.seats[seat!];
    const activationKind = classifyActivationEvent(eventName, payload);
    const rawKey = [
      meta.turn || this.currentTurn || 0,
      seat,
      name,
      payload.activationZone || payload.fromZone || "",
    ].join("|");
    const activationKey =
      payload.linkId != null ? `link:${payload.linkId}` : rawKey;
    if (eventName === "spell_activated" || eventName === "trap_activated") {
      this.rawSpellTrapActivationKeys.add(activationKey);
    } else if (
      eventName === "effect_activated" &&
      activationKind !== "effect" &&
      this.rawSpellTrapActivationKeys.has(activationKey)
    ) {
      this.lastActivated[seat!] = name;
      return;
    }

    addCount(stats.activated, name);
    this.recordCardPlayed(name);
    this.markUsefulAction(seat, meta.turn);

    // Card activation = the act of playing the spell/trap card itself.
    //   Triggered when:
    //     - dedicated `spell_activated` / `trap_activated` event fires, OR
    //     - placement-only effect (e.g. field/continuous spell placed), OR
    //     - the activation source is the hand / a face-down set zone (the bot
    //       fast-path bypasses tryActivateSpell, so we infer from context).
    // Effect activation = an effect resolving on an already-on-field spell/trap
    //   (continuous, field-spell trigger, in-zone re-activation).
    const isPlacement = payload.placementOnly === true;
    const ctx = payload.activationContext || null;
    const fromHand =
      payload.fromHand === true ||
      ctx?.fromHand === true ||
      ctx?.sourceZone === "hand" ||
      payload.fromZone === "hand";
    const isCardPlay = payload.activationKind
      ? payload.activationKind === CHAIN_ACTIVATION_KINDS.SPELL_TRAP_CARD
      : eventName === "spell_activated" ||
        eventName === "trap_activated" ||
        isPlacement ||
        fromHand;
    if (activationKind === "spell") {
      stats.spellActivations += 1;
      if (isCardPlay) stats.spellCardActivations += 1;
      else stats.spellEffectActivations += 1;
    } else if (activationKind === "trap") {
      stats.trapActivations += 1;
      if (isCardPlay) stats.trapCardActivations += 1;
      else stats.trapEffectActivations += 1;
    } else {
      stats.effectActivations += 1;
    }

    // Registra última carta ativada para correlacionar eventos de targeting
    this.lastActivated[seat!] = name;

    this.recordAction({
      type: activationKind === "effect" ? "effect" : `${activationKind}_activated`,
      cardName: name,
      seat,
      turn: meta.turn,
      success: true,
    });
    const targets = cardNames(
      payload.targets ||
        payload.selectedTargets ||
        payload.selectedCards ||
        payload.target,
    );
    this.pushEvent({
      t: meta.turn,
      seat,
      type: activationKind === "effect" ? "effect" : `${activationKind}_activated`,
      card: name,
      sourceCard: name,
      effectId: effectId(payload),
      chainId: payload.chainId ?? null,
      linkId: payload.linkId ?? null,
      activationKind: payload.activationKind || null,
      effectKind: payload.effectKind || null,
      effectType: payload.effectType || null,
      fromZone: payload.activationZone || payload.fromZone || null,
      target: targets[0] || null,
      targets: targets.length > 1 ? targets : undefined,
      result: payload.placementOnly === true ? "placement" : "activated",
    });
  }

  recordCardsAddedToHand(payload: ArenaEventPayload = {}, meta: EventMeta = {}) {
    const seat = playerSeat(payload.player || payload.owner);
    if (!this.seats[seat!]) return;
    const sourceZone = payload.sourceZone || payload.fromZone || null;
    if (sourceZone !== "deck" && payload.fromDeck !== true) return;

    // Usa apenas sourceCard/source explícitos — evita payload.card como fallback,
    // pois payload.card pode ser a própria carta sendo buscada (self-attribution).
    const sourceCard = cardName(payload.sourceCard || payload.source) || null;

    for (const name of cardNames(payload.cards || payload.addedCards || payload.card)) {
      addCount(this.seats[seat!].searched, name);
      this.markUsefulAction(seat, meta.turn);
      this.pushEvent({
        t: meta.turn,
        seat,
        type: "search",
        card: name,
        sourceCard,
        effectId: effectId(payload),
        fromZone: payload.sourceZone || payload.fromZone || "deck",
        toZone: "hand",
      });
    }
  }

  recordCardToGrave(payload: ArenaEventPayload = {}, _meta: EventMeta = {}) {
    const seat = playerSeat(payload.player || payload.owner);
    const name = cardName(payload.card);
    if (!this.seats[seat!] || !name) return;

    const fromZone = payload.fromZone || null;
    const wasDestroyed = payload.wasDestroyed === true;
    const cause = String(
      payload.reason || payload.cause || payload.destroyCause || payload.contextLabel || ""
    );
    const isCost = /cost|material|tribute/i.test(cause);
    const isBattle = /battle/i.test(cause) || (wasDestroyed && !isCost);

    if (fromZone === "hand") {
      addCount(this.seats[seat!].discarded, name);
      if (isCost) {
        addCount(
          this.seats[seat!].discardedByCost,
          causalKey(name, payload.sourceCard || payload.source),
        );
      } else if (isBattle || wasDestroyed) {
        addCount(this.seats[seat!].discardedByDestruction, name);
      }
    }
    if (isCost) {
      addCount(this.seats[seat!].usedAsCost, name);
    }
  }

  recordTargeting(payload: ArenaEventPayload = {}, meta: EventMeta = {}) {
    const seat = playerSeat(payload.player || payload.owner || payload.sourcePlayer);
    if (!this.seats[seat!]) return;
    const targetValues =
      payload.targets ||
      payload.selectedTargets ||
      payload.selectedCards ||
      payload.cards ||
      payload.target ||
      payload.card;
    const targets: readonly CardRef[] = Array.isArray(targetValues) ? targetValues : [targetValues as CardRef];
    const sourceCard = sourceName(payload) || this.lastActivated[seat!] || null;
    const names: string[] = [];
    for (const target of targets) {
      const name = cardName(target);
      if (!name) continue;
      const key = [
        meta.turn || this.currentTurn || 0,
        seat,
        sourceCard || "",
        effectId(payload) || "",
        name,
        (target as ArenaCardRef | null | undefined)?.id ?? "",
      ].join("|");
      if (this.targetingKeys.has(key)) continue;
      this.targetingKeys.add(key);
      names.push(name);
      addCount(this.seats[seat!].targeted, name);
      addCount(this.seats[seat!].targetedBySource, causalKey(name, sourceCard));
    }
    if (names.length > 0) {
      this.markUsefulAction(seat, meta.turn);
      // Associa targeting à última carta ativada pelo mesmo seat
      for (const name of names) {
        const target = targets.find((candidate) => cardName(candidate) === name) as ArenaCardRef | undefined;
        this.pushEvent({
          t: meta.turn,
          seat,
          type: "targeting",
          card: name,
          sourceCard,
          effectId: effectId(payload),
          targetOwner: target?.owner || null,
          targetZone: target?.zone || null,
          position: target?.position || null,
        });
      }
    }
  }

  recordPositionChosen(payload: ArenaEventPayload = {}, meta: EventMeta = {}) {
    const seat = playerSeat(payload.player || payload.owner);
    const name = cardName(payload.card);
    if (!this.seats[seat!] || !name) return;
    this.pushEvent({
      t: payload.turn || meta.turn,
      seat,
      type: "position_chosen",
      card: name,
      position: payload.position,
      result: payload.context || null,
    });
  }

  recordPositionChange(payload: ArenaEventPayload = {}, meta: EventMeta = {}) {
    const seat = playerSeat(payload.player || payload.owner);
    const name = cardName(payload.card);
    if (!this.seats[seat!] || !name) return;
    this.pushEvent({
      t: meta.turn,
      seat,
      type: "position",
      card: name,
      sourceCard: sourceName(payload),
      fromPosition: payload.fromPosition,
      toPosition: payload.toPosition,
      result: payload.wasFlipped ? "flipped" : "changed",
    });
  }

  recordStatBuff(payload: ArenaEventPayload = {}, meta: EventMeta = {}) {
    const seat = playerSeat(payload.player || payload.owner);
    const name = cardName(payload.card);
    if (!this.seats[seat!] || !name) return;
    this.pushEvent({
      t: meta.turn,
      seat,
      type: "stat",
      card: name,
      sourceCard: sourceName(payload),
      result:
        payload.atkChange || payload.defChange
          ? `${payload.atkChange || 0}/${payload.defChange || 0}`
          : null,
    });
  }

  recordCounterEvent(payload: ArenaEventPayload = {}, meta: EventMeta = {}) {
    const seat = playerSeat(payload.player || payload.owner || payload.sourcePlayer);
    const name = cardName(payload.card || payload.target || payload.source);
    if (!this.seats[seat!] || !name) return;

    this.pushEvent({
      t: payload.turn || meta.turn,
      seat,
      type: "counter",
      card: name,
      sourceCard: sourceName(payload),
      effectId: effectId(payload),
      counterType: payload.counterType || null,
      amount: payload.amount ?? null,
      action: payload.action || payload.change || null,
      result: payload.result ?? payload.after ?? null,
    });
  }

  recordLpEvent(eventName: string, payload: ArenaEventPayload = {}, meta: EventMeta = {}) {
    const seat = playerSeat(payload.player || payload.target || payload.owner);
    if (!this.seats[seat!]) return;
    this.pushEvent({
      t: payload.turn || meta.turn,
      seat,
      type: eventName === "damage_inflicted" ? "damage" : "lp",
      sourceCard: sourceName(payload),
      lpPaid: payload.lpPaid || null,
      lpGained: payload.lpGained || null,
      lpLost: payload.lpLost || payload.amount || null,
      result: payload.newLP ?? payload.after ?? null,
    });
  }

  recordActivationAttempt(data: ActivationAttempt = {}) {
    const seat = playerSeat(data.player || data.owner || data.seat);
    const name = cardName(data.card || data.source) || data.cardName || "unknown";
    if (!this.seats[seat!]) return;

    const success = data.success === true;
    const blocked = data.blocked === true;
    const stats = this.seats[seat!];
    if (success) {
      this.markUsefulAction(seat, data.turn);
      return;
    } else {
      addCount(stats.invalidByCard, name);
      if (blocked) {
        addCount(stats.blockedByCard, name);
      }
    }

    this.recordAction({
      type: data.type || "activation_attempt",
      cardName: name,
      seat,
      turn: data.turn,
      success,
      blocked,
      reason: data.reason || data.code || null,
    });
  }

  recordBlockedAction(data: ActivationAttempt = {}) {
    const seat = playerSeat(data.player || data.actor || data.seat);
    const name = cardName(data.card) || data.cardName || data.kind || "action";
    if (!this.seats[seat!]) return;

    const stats = this.seats[seat!];
    addCount(stats.invalidByCard, name);
    addCount(stats.blockedByCard, name);
    this.recordAction({
      type: data.kind || "blocked_action",
      cardName: name,
      seat,
      turn: data.turn,
      success: false,
      blocked: true,
      reason: data.reason || data.code || null,
    });
  }

  recordZoneMove(card: ArenaCardRef, destPlayer: PlayerRef, toZone: string, options: ZoneMoveOptions = {}, result: ZoneMoveResult = {}) {
    if (!result || result.success === false) return;
    const seat = playerSeat(destPlayer);
    const name = cardName(card);
    if (!this.seats[seat!] || !name) return;

    const fromZone = result.fromZone || options.fromZone || null;
    const finalZone = result.toZone || toZone;
    const label = String(options.contextLabel || options.reason || options.cause || "");
    const isCost = /cost|material|tribute/i.test(label);
    const source = options.sourceCard || options.source || null;

    if (fromZone === "hand" && finalZone === "graveyard") {
      addCount(this.seats[seat!].discarded, name);
      if (isCost) {
        addCount(this.seats[seat!].discardedByCost, causalKey(name, source));
      }
    }
    if (isCost) {
      addCount(this.seats[seat!].usedAsCost, name);
    }
    if (fromZone === "deck" && finalZone === "hand") {
      addCount(this.seats[seat!].searched, name);
      this.markUsefulAction(seat, this.currentTurn);
    }
    if (finalZone === "banished") {
      addCount(this.seats[seat!].banished, name);
      if (fromZone === "graveyard") {
        this.seats[seat!].graveyardResourceUses += 1;
      }
    }
    this.pushEvent({
      t: this.currentTurn,
      seat,
      type: "move",
      card: name,
      sourceCard: cardName(source),
      effectId: options.effectId || null,
      fromZone,
      toZone: finalZone,
      position: options.position || card?.position || null,
      cost: isCost ? true : null,
      result: (result.success as boolean | undefined) === false ? "failed" : "success",
    });
  }

  finalizeStrategic(turns: number) {
    const totalTurns = Number(turns) || this.currentTurn || 0;
    for (const seat of SEATS) {
      const stats = this.seats[seat!];
      for (let turn = 1; turn <= totalTurns; turn += 1) {
        const owner = this.turnOwners[String(turn)];
        if (owner && owner !== seat) continue;
        if (!stats.turnActions[String(turn)]) {
          stats.noUsefulTurns += 1;
        }
      }
    }
  }

  /**
   * Finaliza o tracker e retorna resultado para registro.
   * @param {string} winner - "player" | "bot" | "draw"
   * @param {string} reason - END_REASONS.*
   * @param {Object} finalLP - { player: number, bot: number }
   * @returns {DuelResult}
   */
  finalize(winner: ArenaWinner, reason: string, finalLP: Seats<number>) {
    const totalTimeMs = Date.now() - this.startTime;
    const avgDecisionTimeMs =
      this.decisionTimes.length > 0
        ? this.decisionTimes.reduce((a, b) => a + b, 0) /
          this.decisionTimes.length
        : null;
    const totalNodesVisited =
      this.nodesVisited.length > 0
        ? this.nodesVisited.reduce((a, b) => a + b, 0)
        : null;
    this.finalizeStrategic(this.currentTurn);
    const timeoutKind = this.getTimeoutKind(reason);

    return {
      duelNumber: this.duelNumber,
      seed: this.seed,
      archetype1: this.archetype1,
      archetype2: this.archetype2,
      winner,
      turns: this.currentTurn,
      reason,
      timeoutKind,
      finalLP,
      totalTimeMs,
      avgDecisionTimeMs,
      totalNodesVisited,
      beamWidth: this.beamWidth,
      maxDepth: this.maxDepth,
      planner: {
        mode: this.plannerMode,
        turnMode: this.plannerTurnMode,
        beamWidth: this.plannerBeamWidth,
        maxDepth: this.plannerMaxDepth,
        nodeBudget: this.plannerNodeBudget,
        candidateLimit: this.plannerCandidateLimit,
      },
      cardsPlayed: this.cardsPlayed,
      actionsExecuted: this.actionsExecuted,
      openingSequence:
        this.openingSequence.length > 0 ? this.openingSequence : null,
      strategic: {
        seats: {
          player: compactSeatStats(this.seats.player),
          bot: compactSeatStats(this.seats.bot),
        },
        events: this.events,
      },
      diagnostics: {
        progress: this.diagnostics.progress,
        zeroEventTimeoutSnapshot: this.diagnostics.zeroEventTimeoutSnapshot,
        stallSnapshots: this.diagnostics.stallSnapshots,
      },
      errors: this.errors,
      warnings: this.warnings,
    };
  }
}
