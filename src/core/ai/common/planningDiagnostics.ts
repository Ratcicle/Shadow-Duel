import { cardDatabaseById } from "../../../data/cards.js";

import type {
  AIAction,
  AIActionFingerprint,
  AILineMilestone,
  AIPlannedAction,
  CompactPlanningSummaryDiff,
  PlannerResultSummary,
  PlanningCardSummary,
  PlanningDiffSeverity,
  PlanningPlayerSummary,
  PlanningStateSummary,
  PlanningSummaryDiff,
  PlanningSummaryDiffResult,
  TurnLineDiagnostics,
} from "../../contracts/ai.js";

type NonFalsy<Value> = Exclude<Value, null | undefined | false | 0 | "">;
type DiagnosticCounters =
  | ReadonlyMap<string, number>
  | readonly (readonly [string, number])[]
  | Readonly<Record<string, number>>;

interface PlanningDiagnosticCardInput {
  id?: PlanningCardSummary["id"];
  instanceId?: string | number | null;
  _instanceId?: string | number | null;
  uuid?: string | null;
  name?: string | null;
  cardName?: string | null;
  label?: string | null;
  cardKind?: string | null;
  position?: string | null;
  isFacedown?: boolean;
  atk?: unknown;
  def?: unknown;
  tempAtkBoost?: unknown;
  tempDefBoost?: unknown;
  equipAtkBonus?: unknown;
  equipDefBonus?: unknown;
  cannotAttackThisTurn?: boolean;
  hasAttacked?: boolean;
  counters?: DiagnosticCounters | null;
  equips?: readonly PlanningDiagnosticCardLike[] | null;
  state?: { blueprintStorage?: object | null } | null;
  blueprintStorage?: object | null;
  storedBlueprints?: readonly unknown[] | null;
  blueprintStorageState?: object | null;
  storedEffects?: readonly unknown[] | null;
}

interface BlueprintEntryInput {
  id?: string | number;
  effectId?: string | number;
  sourceName?: string | number;
  name?: string | number;
}

interface BlueprintStorageInput {
  storedBlueprints?: readonly unknown[] | null;
}

type PlanningDiagnosticCardLike =
  | PlanningDiagnosticCardInput
  | string
  | null
  | undefined;

interface PlanningDiagnosticPlayerInput {
  id?: PlanningPlayerSummary["id"];
  lp?: unknown;
  summonCount?: unknown;
  additionalNormalSummons?: unknown;
  hand?: readonly PlanningDiagnosticCardLike[] | null;
  field?: readonly PlanningDiagnosticCardLike[] | null;
  spellTrap?: readonly PlanningDiagnosticCardLike[] | null;
  fieldSpell?: PlanningDiagnosticCardLike;
  graveyard?: readonly PlanningDiagnosticCardLike[] | null;
  banished?: readonly PlanningDiagnosticCardLike[] | null;
  deck?: readonly PlanningDiagnosticCardLike[] | null;
  extraDeck?: readonly PlanningDiagnosticCardLike[] | null;
}

interface PlanningDiagnosticStateInput {
  player?: PlanningDiagnosticPlayerInput | null;
  bot?: PlanningDiagnosticPlayerInput | null;
  _isPerspectiveState?: boolean;
  phase?: PlanningStateSummary["phase"];
  currentPhase?: PlanningStateSummary["phase"];
  turn?: unknown;
  currentPlayer?: { id?: unknown } | null;
  turnCounter?: unknown;
}

interface PlanningDiagnosticPerspectiveInput {
  id?: PlanningPlayerSummary["id"];
}

interface PlanningDiagnosticStrategyInput
  extends PlanningDiagnosticPerspectiveInput {
  bot?: PlanningDiagnosticPerspectiveInput | null;
}

interface PlanningDiagnosticOptions {
  bot?: PlanningDiagnosticPerspectiveInput | null;
  strategy?: PlanningDiagnosticStrategyInput | null;
}

interface PlannerResultDiagnosticInput {
  score?: unknown;
  baseScore?: unknown;
  milestoneScore?: unknown;
  sequence?: readonly AIPlannedAction[] | null;
  milestones?: readonly AILineMilestone[] | null;
  reason?: string | null;
  nodesEvaluated?: unknown;
  diagnostics?: TurnLineDiagnostics | null;
}

type DiagnosticPlannedAction = AIPlannedAction & {
  index?: number;
  fieldIndex?: number;
  zoneIndex?: number;
  graveyardIndex?: number;
  materialIndex?: number;
  position?: AIActionFingerprint["position"];
  name?: string;
};

function safeArray<Value>(
  value: readonly Value[] | null | undefined,
): Array<NonFalsy<Value>>;
function safeArray(value: unknown): unknown[];
function safeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function roundStat(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function cardName(card: PlanningDiagnosticCardLike): string | null {
  if (!card) return null;
  if (typeof card === "string") return card;
  return card.name || card.cardName || card.label || null;
}

function summarizeCounters(card: PlanningDiagnosticCardInput): string[] {
  const counters = card?.counters;
  if (!counters) return [];
  const entries = counters instanceof Map
    ? [...counters.entries()]
    : Array.isArray(counters)
      ? counters
      : typeof counters === "object"
        ? Object.entries(counters)
        : [];
  return entries
    .map(([key, value]) => `${key}:${value}`)
    .sort();
}

function summarizeStoredBlueprints(
  card: PlanningDiagnosticCardInput,
): Array<string | number> {
  const storage = (card?.state?.blueprintStorage || card?.blueprintStorage) as BlueprintStorageInput | null | undefined;
  const stored =
    card?.storedBlueprints ||
    (card?.blueprintStorageState as BlueprintStorageInput | null | undefined)
      ?.storedBlueprints ||
    storage?.storedBlueprints ||
    card?.storedEffects ||
    [];
  return (safeArray(stored).map((entry) => (entry as BlueprintEntryInput | null | undefined)?.id || (entry as BlueprintEntryInput | null | undefined)?.effectId || (entry as BlueprintEntryInput | null | undefined)?.sourceName || (entry as BlueprintEntryInput | null | undefined)?.name).filter(Boolean) as Array<string | number>).sort();
}

function summarizeEquips(card: PlanningDiagnosticCardInput): string[] {
  return safeArray(card?.equips)
    .map((equip) => cardName(equip) || `id:${(equip as PlanningDiagnosticCardInput | null | undefined)?.id || "unknown"}`)
    .sort();
}

function summarizeCard(
  card: PlanningDiagnosticCardLike,
): PlanningCardSummary | null {
  if (!card) return null;
  return {
    name: cardName(card) || "unknown",
    id: (card as PlanningDiagnosticCardInput).id ?? null,
    instanceId:
      (card as PlanningDiagnosticCardInput).instanceId ||
      (card as PlanningDiagnosticCardInput)._instanceId ||
      (card as PlanningDiagnosticCardInput).uuid ||
      null,
    kind: (card as PlanningDiagnosticCardInput).cardKind || null,
    position: (card as PlanningDiagnosticCardInput).position || null,
    faceDown: !!(card as PlanningDiagnosticCardInput).isFacedown,
    atk: roundStat((card as PlanningDiagnosticCardInput).atk),
    def: roundStat((card as PlanningDiagnosticCardInput).def),
    tempAtk: roundStat((card as PlanningDiagnosticCardInput).tempAtkBoost),
    tempDef: roundStat((card as PlanningDiagnosticCardInput).tempDefBoost),
    equipAtk: roundStat((card as PlanningDiagnosticCardInput).equipAtkBonus),
    equipDef: roundStat((card as PlanningDiagnosticCardInput).equipDefBonus),
    cannotAttack: !!(card as PlanningDiagnosticCardInput).cannotAttackThisTurn,
    hasAttacked: !!(card as PlanningDiagnosticCardInput).hasAttacked,
    counters: summarizeCounters(card as PlanningDiagnosticCardInput),
    blueprints: summarizeStoredBlueprints(card as PlanningDiagnosticCardInput),
    equips: summarizeEquips(card as PlanningDiagnosticCardInput),
  };
}

function summarizeZone(
  cards: readonly PlanningDiagnosticCardLike[] | null = [],
  { sort = false }: { sort?: boolean } = {},
): PlanningCardSummary[] {
  const list = safeArray(cards)
    .map(summarizeCard)
    .filter(Boolean) as PlanningCardSummary[];
  if (sort) {
    list.sort((a, b) => {
      const nameCompare = a.name.localeCompare(b.name);
      if (nameCompare !== 0) return nameCompare;
      return String(a.instanceId || a.id || "").localeCompare(
        String(b.instanceId || b.id || ""),
      );
    });
  }
  return list;
}

function summarizeNameZone(
  cards: readonly PlanningDiagnosticCardLike[] | null = [],
): string[] {
  return safeArray(cards)
    .map((card) => cardName(card) || "unknown")
    .sort();
}

function summarizePlayer(
  player: PlanningDiagnosticPlayerInput = {},
): PlanningPlayerSummary {
  return {
    id: player.id || null,
    lp: roundStat(player.lp),
    summonCount: roundStat(player.summonCount),
    additionalNormalSummons: roundStat(player.additionalNormalSummons),
    hand: summarizeNameZone(player.hand),
    handSize: safeArray(player.hand).length,
    field: summarizeZone(player.field),
    spellTrap: summarizeZone(player.spellTrap),
    fieldSpell: summarizeCard(player.fieldSpell),
    graveyard: summarizeNameZone(player.graveyard),
    graveyardSize: safeArray(player.graveyard).length,
    banished: summarizeNameZone(player.banished),
    banishedSize: safeArray(player.banished).length,
    deckSize: safeArray(player.deck).length,
    extraDeckSize: safeArray(player.extraDeck).length,
  };
}

function resolvePerspective(
  stateOrGame: PlanningDiagnosticStateInput | null | undefined,
  options: PlanningDiagnosticOptions = {},
): {
  bot: PlanningDiagnosticPlayerInput;
  opponent: PlanningDiagnosticPlayerInput;
} {
  if (stateOrGame?._isPerspectiveState === true) {
    return {
      bot: stateOrGame.bot || {},
      opponent: stateOrGame.player || {},
    };
  }

  const perspectiveBot = options.bot || options.strategy?.bot || options.strategy;
  const player = stateOrGame?.player || {};
  const bot = stateOrGame?.bot || {};
  if (perspectiveBot?.id && player?.id === perspectiveBot.id) {
    return { bot: player, opponent: bot };
  }
  if (perspectiveBot?.id && bot?.id === perspectiveBot.id) {
    return { bot, opponent: player };
  }
  return {
    bot: bot || player || {},
    opponent: player || {},
  };
}

export function fingerprintAction(action: AIPlannedAction | null | undefined): AIActionFingerprint | null;
export function fingerprintAction(action?: null): null;
export function fingerprintAction(action: AIPlannedAction): AIActionFingerprint;
export function fingerprintAction(
  action: DiagnosticPlannedAction | null = null,
): AIActionFingerprint | null {
  if (!action) return null;
  if (action.type === "simulatedBattle") {
    return {
      type: "simulatedBattle",
      cardName: action.attackerName || null,
      targetName: action.targetName || null,
      direct: !!action.direct,
      damage: Number.isFinite(Number(action.damage)) ? Number(action.damage) : 0,
      destroyedNames: (safeArray(action.destroyedNames)
        .map((entry) => (typeof entry === "string" ? entry : entry?.name))
        .filter(Boolean) as string[]).sort(),
      rewardNames: safeArray(action.rewardNames).slice().sort(),
      phaseBridge: action.phaseBridge || null,
      priority: Number.isFinite(Number(action.priority))
        ? Number(action.priority)
        : null,
    };
  }
  const context = action.activationContext || {};
  const targetPreferences = context.targetPreferences || {};
  return {
    type: action.type || null,
    cardName:
      action.cardName ||
      action.card?.name ||
      action.sourceCard?.name ||
      action.name ||
      null,
    cardId: action.cardId || action.card?.id || null,
    index: Number.isInteger(action.index) ? action.index! : null,
    fieldIndex: Number.isInteger(action.fieldIndex) ? action.fieldIndex! : null,
    zoneIndex: Number.isInteger(action.zoneIndex) ? action.zoneIndex! : null,
    graveyardIndex: Number.isInteger(action.graveyardIndex)
      ? action.graveyardIndex!
      : null,
    materialIndex: Number.isInteger(action.materialIndex)
      ? action.materialIndex!
      : null,
    position: action.position || null,
    priority: Number.isFinite(Number(action.priority))
      ? Number(action.priority)
      : null,
    targetPreferenceKeys: Object.keys(targetPreferences).sort(),
  };
}

export function summarizePlanningState(
  stateOrGame: PlanningDiagnosticStateInput | null | undefined,
  options: PlanningDiagnosticOptions = {},
): PlanningStateSummary {
  const { bot, opponent } = resolvePerspective(stateOrGame, options);
  return {
    phase: stateOrGame?.phase || stateOrGame?.currentPhase || null,
    turn: stateOrGame?.turn || stateOrGame?.currentPlayer?.id || null,
    turnCounter: roundStat(stateOrGame?.turnCounter),
    bot: summarizePlayer(bot),
    opponent: summarizePlayer(opponent),
  };
}

function stableString(value: unknown): string | undefined {
  return JSON.stringify(value);
}

function getBaseStat(
  card: PlanningCardSummary | null | undefined,
  stat: "atk" | "def",
): number | null {
  const value = cardDatabaseById.get(card?.id)?.[stat];
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function effectiveStat(
  card: PlanningCardSummary | null | undefined,
  stat: "atk" | "def",
): number {
  const raw = roundStat(card?.[stat]);
  const tempKey = stat === "def" ? "tempDef" : "tempAtk";
  const equipKey = stat === "def" ? "equipDef" : "equipAtk";
  const temp = roundStat(card?.[tempKey]);
  const equip = roundStat(card?.[equipKey]);
  const base = getBaseStat(card, stat);

  if (base !== null && raw !== base && (temp !== 0 || equip !== 0)) {
    return raw;
  }
  return raw + temp + equip;
}

function effectiveAtk(card: PlanningCardSummary | null | undefined): number {
  return effectiveStat(card, "atk");
}

function effectiveDef(card: PlanningCardSummary | null | undefined): number {
  return effectiveStat(card, "def");
}

function statRepresentationStableCard(
  card: PlanningCardSummary | null | undefined,
): Omit<
  PlanningCardSummary,
  | "instanceId"
  | "atk"
  | "def"
  | "tempAtk"
  | "tempDef"
  | "equipAtk"
  | "equipDef"
> | null {
  if (!card) return null;
  const {
    instanceId: _instanceId,
    atk: _atk,
    def: _def,
    tempAtk: _tempAtk,
    tempDef: _tempDef,
    equipAtk: _equipAtk,
    equipDef: _equipDef,
    ...stable
  } = card;
  return stable;
}

function equivalentCardExceptStatRepresentation(
  expected: PlanningCardSummary | null | undefined,
  actual: PlanningCardSummary | null | undefined,
): boolean {
  if (!expected || !actual) return false;
  const expectedStable = statRepresentationStableCard(expected);
  const actualStable = statRepresentationStableCard(actual);
  return (
    stableString(expectedStable) === stableString(actualStable) &&
    effectiveAtk(expected) === effectiveAtk(actual) &&
    effectiveDef(expected) === effectiveDef(actual)
  );
}

function equivalentZoneExceptStatRepresentation(
  expected: readonly PlanningCardSummary[] = [],
  actual: readonly PlanningCardSummary[] = [],
): boolean {
  if (!Array.isArray(expected) || !Array.isArray(actual)) return false;
  if (expected.length !== actual.length) return false;
  return expected.every((card, index) =>
    equivalentCardExceptStatRepresentation(card, actual[index])
  );
}

function zoneDiffCategory(
  expected: readonly PlanningCardSummary[] = [],
  actual: readonly PlanningCardSummary[] = [],
): PlanningDiffSeverity {
  if (!Array.isArray(expected) || !Array.isArray(actual)) return "state_mismatch";
  const max = Math.max(expected.length, actual.length);
  for (let index = 0; index < max; index += 1) {
    const left = expected[index];
    const right = actual[index];
    if (!left || !right) continue;
    if (stableString(left.equips) !== stableString(right.equips)) {
      return "host_equip_mismatch";
    }
    if (stableString(left.counters) !== stableString(right.counters)) {
      return "counter_mismatch";
    }
    if (stableString(left.blueprints) !== stableString(right.blueprints)) {
      return "blueprint_mismatch";
    }
  }
  return "state_mismatch";
}

function compareField(
  prefix: string,
  expected: unknown,
  actual: unknown,
  diffs: PlanningSummaryDiff[],
  severity: PlanningDiffSeverity = "state_mismatch",
): void {
  if (stableString(expected) === stableString(actual)) return;
  diffs.push({
    path: prefix,
    severity,
    expected,
    actual,
  });
}

function compareCardZone(
  prefix: string,
  expected: readonly PlanningCardSummary[] | undefined,
  actual: readonly PlanningCardSummary[] | undefined,
  diffs: PlanningSummaryDiff[],
): void {
  if (stableString(expected) === stableString(actual)) return;
  if (equivalentZoneExceptStatRepresentation(expected, actual)) {
    diffs.push({
      path: prefix,
      severity: "minor",
      reason: "effective_stats_match",
      expected,
      actual,
    });
    return;
  }
  compareField(prefix, expected, actual, diffs, zoneDiffCategory(expected, actual));
}

function comparePlayer(
  prefix: string,
  expected: Partial<PlanningPlayerSummary> = {},
  actual: Partial<PlanningPlayerSummary> = {},
  diffs: PlanningSummaryDiff[],
): void {
  compareField(`${prefix}.lp`, expected.lp, actual.lp, diffs);
  compareField(`${prefix}.summonCount`, expected.summonCount, actual.summonCount, diffs, "minor");
  compareField(`${prefix}.hand`, expected.hand, actual.hand, diffs, "hand_deck_mismatch");
  compareCardZone(`${prefix}.field`, expected.field, actual.field, diffs);
  compareField(`${prefix}.spellTrap`, expected.spellTrap, actual.spellTrap, diffs, "host_equip_mismatch");
  compareField(`${prefix}.fieldSpell`, expected.fieldSpell, actual.fieldSpell, diffs, "host_equip_mismatch");
  compareField(`${prefix}.graveyard`, expected.graveyard, actual.graveyard, diffs, "hand_deck_mismatch");
  compareField(`${prefix}.banished`, expected.banished, actual.banished, diffs, "state_mismatch");
  compareField(`${prefix}.deckSize`, expected.deckSize, actual.deckSize, diffs, "hand_deck_mismatch");
}

function classifyDiff(
  diffs: readonly PlanningSummaryDiff[] = [],
): PlanningDiffSeverity {
  if (!diffs.length) return "none";
  if (diffs.every((diff) => diff.severity === "minor")) return "minor";
  const meaningful = diffs.filter((diff) => diff.severity !== "minor");
  if (
    meaningful.length > 0 &&
    meaningful.every((diff) => String(diff.path || "").startsWith("opponent."))
  ) {
    return "opponent_reaction_mismatch";
  }
  const firstMeaningful = meaningful[0];
  if (firstMeaningful?.severity) return firstMeaningful.severity;
  const targetDiff = diffs.find((diff) =>
    /field|spellTrap|fieldSpell|banished/.test(diff.path || ""),
  );
  if (targetDiff) return "state_mismatch";
  return "state_mismatch";
}

export function diffPlanningSummaries(
  expected: PlanningStateSummary | null | undefined,
  actual: PlanningStateSummary | null | undefined,
): PlanningSummaryDiffResult {
  if (!expected || !actual) {
    return {
      matched: false,
      severity: "missing_summary",
      diffs: [
        {
          path: "summary",
          severity: "missing_summary",
          expected: !!expected,
          actual: !!actual,
        },
      ],
    };
  }
  const diffs: PlanningSummaryDiff[] = [];
  compareField("phase", expected.phase, actual.phase, diffs, "minor");
  compareField("turn", expected.turn, actual.turn, diffs, "minor");
  comparePlayer("bot", expected.bot, actual.bot, diffs);
  comparePlayer("opponent", expected.opponent, actual.opponent, diffs);
  const severity = classifyDiff(diffs);
  return {
    matched: severity === "none" || severity === "minor",
    severity,
    diffs,
  };
}

export function isMeaningfulPlanningDiff(
  diff: PlanningSummaryDiffResult | null | undefined,
): boolean {
  if (!diff) return false;
  return !["none", "minor"].includes(diff.severity);
}

function compactDiffValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, 6).map(compactDiffValue);
  }
  if (value && typeof value === "object") {
    if ("name" in value || "id" in value || "position" in value) {
      return {
        name: (value as PlanningCardSummary).name || null,
        id: (value as PlanningCardSummary).id ?? null,
        position: (value as PlanningCardSummary).position || null,
        faceDown: (value as PlanningCardSummary).faceDown ?? null,
        atk: (value as PlanningCardSummary).atk ?? null,
        def: (value as PlanningCardSummary).def ?? null,
        tempAtk: (value as PlanningCardSummary).tempAtk ?? null,
        tempDef: (value as PlanningCardSummary).tempDef ?? null,
        counters: Array.isArray((value as PlanningCardSummary).counters)
          ? (value as PlanningCardSummary).counters.slice(0, 4)
          : [],
        equips: Array.isArray((value as PlanningCardSummary).equips)
          ? (value as PlanningCardSummary).equips.slice(0, 4)
          : [],
      };
    }
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 8)
        .map(([key, nested]) => [key, compactDiffValue(nested)]),
    );
  }
  return value;
}

export function compactPlanningDiffs(
  diffs: readonly PlanningSummaryDiff[] = [],
  limit = 6,
): CompactPlanningSummaryDiff[] {
  return (diffs || []).slice(0, limit).map((diff) => ({
    path: diff.path,
    severity: diff.severity,
    expected: compactDiffValue(diff.expected),
    actual: compactDiffValue(diff.actual),
  }));
}

export function summarizePlannerResult(
  result: PlannerResultDiagnosticInput | null = null,
): PlannerResultSummary | null {
  if (!result) return null;
  return {
    score: Number.isFinite(Number(result.score)) ? Number(result.score) : null,
    baseScore: Number.isFinite(Number(result.baseScore))
      ? Number(result.baseScore)
      : null,
    milestoneScore: Number.isFinite(Number(result.milestoneScore))
      ? Number(result.milestoneScore)
      : null,
    sequence: safeArray(result.sequence).map(fingerprintAction),
    milestones: safeArray(result.milestones).slice(0, 8),
    reason: result.reason || null,
    nodesEvaluated: roundStat(result.nodesEvaluated),
    diagnostics: result.diagnostics || null,
  };
}
