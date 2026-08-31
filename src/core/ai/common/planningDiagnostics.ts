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

function safeArray<Value>(
  value: readonly Value[] | null | undefined,
): Array<NonFalsy<Value>>;
function safeArray(value: unknown): unknown[];
function safeArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter(Boolean);
}

function readProperty(value: unknown, key: string): unknown {
  return value !== null && (typeof value === "object" || typeof value === "function")
    ? Reflect.get(value, key)
    : undefined;
}

function readFirstProperty(value: unknown, keys: readonly string[]): unknown {
  for (const key of keys) {
    const entry = readProperty(value, key);
    if (entry) return entry;
  }
  return undefined;
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

function isCounterEntryArray(
  value: DiagnosticCounters,
): value is readonly (readonly [string, number])[] {
  return Array.isArray(value);
}

function summarizeCounters(card: PlanningDiagnosticCardInput): string[] {
  const counters = card?.counters;
  if (!counters) return [];
  let entries: readonly (readonly [string, number])[];
  if (counters instanceof Map) entries = [...counters.entries()];
  else if (isCounterEntryArray(counters)) entries = counters;
  else entries = Object.entries(counters);
  return entries
    .map(([key, value]) => `${key}:${value}`)
    .sort();
}

function summarizeStoredBlueprints(
  card: PlanningDiagnosticCardInput,
): Array<string | number> {
  const state = readProperty(card, "state");
  const storage =
    readProperty(state, "blueprintStorage") ||
    readProperty(card, "blueprintStorage");
  const stored =
    readProperty(card, "storedBlueprints") ||
    readProperty(readProperty(card, "blueprintStorageState"), "storedBlueprints") ||
    readProperty(storage, "storedBlueprints") ||
    readProperty(card, "storedEffects") ||
    [];
  return safeArray(stored)
    .map((entry) =>
      readFirstProperty(entry, ["id", "effectId", "sourceName", "name"]),
    )
    .filter(
      (entry): entry is string | number =>
        Boolean(entry) &&
        (typeof entry === "string" || typeof entry === "number"),
    )
    .sort();
}

function summarizeEquips(card: PlanningDiagnosticCardInput): string[] {
  return safeArray(card?.equips)
    .map((equip) => {
      const id = typeof equip === "string" ? undefined : equip?.id;
      return cardName(equip) || `id:${id || "unknown"}`;
    })
    .sort();
}

function summarizeCard(
  card: PlanningDiagnosticCardLike,
): PlanningCardSummary | null {
  if (!card) return null;
  const safe = typeof card === "string" ? {} : card;
  return {
    name: cardName(card) || "unknown",
    id: safe.id ?? null,
    instanceId: safe.instanceId || safe._instanceId || safe.uuid || null,
    kind: safe.cardKind || null,
    position: safe.position || null,
    faceDown: !!safe.isFacedown,
    atk: roundStat(safe.atk),
    def: roundStat(safe.def),
    tempAtk: roundStat(safe.tempAtkBoost),
    tempDef: roundStat(safe.tempDefBoost),
    equipAtk: roundStat(safe.equipAtkBonus),
    equipDef: roundStat(safe.equipDefBonus),
    cannotAttack: !!safe.cannotAttackThisTurn,
    hasAttacked: !!safe.hasAttacked,
    counters: summarizeCounters(safe),
    blueprints: summarizeStoredBlueprints(safe),
    equips: summarizeEquips(safe),
  };
}

function summarizeZone(
  cards: readonly PlanningDiagnosticCardLike[] | null = [],
  { sort = false }: { sort?: boolean } = {},
): PlanningCardSummary[] {
  const list = safeArray(cards)
    .map(summarizeCard)
    .filter((card): card is PlanningCardSummary => Boolean(card));
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

export function fingerprintAction(action?: null): null;
export function fingerprintAction(action: AIPlannedAction): AIActionFingerprint;
export function fingerprintAction(
  action: AIPlannedAction | null = null,
): AIActionFingerprint | null {
  if (!action) return null;
  if (action.type === "simulatedBattle") {
    return {
      type: "simulatedBattle",
      cardName: action.attackerName || null,
      targetName: action.targetName || null,
      direct: !!action.direct,
      damage: Number.isFinite(Number(action.damage)) ? Number(action.damage) : 0,
      destroyedNames: safeArray(action.destroyedNames)
        .map((entry) => (typeof entry === "string" ? entry : entry?.name))
        .filter((name): name is string => Boolean(name))
        .sort(),
      rewardNames: safeArray(action.rewardNames).slice().sort(),
      phaseBridge: action.phaseBridge || null,
      priority: Number.isFinite(Number(action.priority))
        ? Number(action.priority)
        : null,
    };
  }
  const context = action.activationContext || {};
  const targetPreferences = context.targetPreferences || {};
  const readInteger = (key: string): number | null => {
    const value = readProperty(action, key);
    return typeof value === "number" && Number.isInteger(value) ? value : null;
  };
  const position = ((candidate: AIAction): AIActionFingerprint["position"] => {
    switch (candidate.type) {
      case "ascension":
      case "extraDeckProcedure":
      case "special_summon_sanctum_protector":
      case "summon":
        return candidate.position || null;
      default:
        return null;
    }
  })(action);
  return {
    type: action.type || null,
    cardName:
      action.cardName ||
      action.card?.name ||
      action.sourceCard?.name ||
      action.name ||
      null,
    cardId: action.cardId || action.card?.id || null,
    index: readInteger("index"),
    fieldIndex: readInteger("fieldIndex"),
    zoneIndex: readInteger("zoneIndex"),
    graveyardIndex: readInteger("graveyardIndex"),
    materialIndex: readInteger("materialIndex"),
    position,
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
  expected: readonly PlanningCardSummary[] = [],
  actual: readonly PlanningCardSummary[] = [],
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
      const name = readProperty(value, "name");
      const id = readProperty(value, "id");
      const position = readProperty(value, "position");
      const faceDown = readProperty(value, "faceDown");
      const atk = readProperty(value, "atk");
      const def = readProperty(value, "def");
      const tempAtk = readProperty(value, "tempAtk");
      const tempDef = readProperty(value, "tempDef");
      const counters = readProperty(value, "counters");
      const equips = readProperty(value, "equips");
      return {
        name: name || null,
        id: id ?? null,
        position: position || null,
        faceDown: faceDown ?? null,
        atk: atk ?? null,
        def: def ?? null,
        tempAtk: tempAtk ?? null,
        tempDef: tempDef ?? null,
        counters: Array.isArray(counters) ? counters.slice(0, 4) : [],
        equips: Array.isArray(equips) ? equips.slice(0, 4) : [],
      };
    }
    return Object.fromEntries(
      Object.keys(value)
        .slice(0, 8)
        .map((key) => [key, compactDiffValue(readProperty(value, key))]),
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
