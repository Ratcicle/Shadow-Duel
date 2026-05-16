function safeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function roundStat(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function cardName(card) {
  if (!card) return null;
  if (typeof card === "string") return card;
  return card.name || card.cardName || card.label || null;
}

function summarizeCounters(card) {
  const counters = card?.counters;
  if (!counters) return [];
  const entries =
    counters instanceof Map
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

function summarizeStoredBlueprints(card) {
  const storage = card?.state?.blueprintStorage || card?.blueprintStorage;
  const stored =
    card?.storedBlueprints ||
    card?.blueprintStorageState?.storedBlueprints ||
    storage?.storedBlueprints ||
    card?.storedEffects ||
    [];
  return safeArray(stored)
    .map((entry) => entry?.id || entry?.effectId || entry?.sourceName || entry?.name)
    .filter(Boolean)
    .sort();
}

function summarizeEquips(card) {
  return safeArray(card?.equips)
    .map((equip) => cardName(equip) || `id:${equip?.id || "unknown"}`)
    .sort();
}

function summarizeCard(card) {
  if (!card) return null;
  return {
    name: cardName(card) || "unknown",
    id: card.id ?? null,
    instanceId: card.instanceId || card._instanceId || card.uuid || null,
    kind: card.cardKind || null,
    position: card.position || null,
    faceDown: !!card.isFacedown,
    atk: roundStat(card.atk),
    def: roundStat(card.def),
    tempAtk: roundStat(card.tempAtkBoost),
    tempDef: roundStat(card.tempDefBoost),
    equipAtk: roundStat(card.equipAtkBonus),
    equipDef: roundStat(card.equipDefBonus),
    cannotAttack: !!card.cannotAttackThisTurn,
    hasAttacked: !!card.hasAttacked,
    counters: summarizeCounters(card),
    blueprints: summarizeStoredBlueprints(card),
    equips: summarizeEquips(card),
  };
}

function summarizeZone(cards = [], { sort = false } = {}) {
  const list = safeArray(cards).map(summarizeCard).filter(Boolean);
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

function summarizeNameZone(cards = []) {
  return safeArray(cards)
    .map((card) => cardName(card) || "unknown")
    .sort();
}

function summarizePlayer(player = {}) {
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

function resolvePerspective(stateOrGame, options = {}) {
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

export function fingerprintAction(action = null) {
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
        .filter(Boolean)
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
  return {
    type: action.type || null,
    cardName:
      action.cardName ||
      action.card?.name ||
      action.sourceCard?.name ||
      action.name ||
      null,
    cardId: action.cardId || action.card?.id || null,
    index: Number.isInteger(action.index) ? action.index : null,
    fieldIndex: Number.isInteger(action.fieldIndex) ? action.fieldIndex : null,
    zoneIndex: Number.isInteger(action.zoneIndex) ? action.zoneIndex : null,
    graveyardIndex: Number.isInteger(action.graveyardIndex)
      ? action.graveyardIndex
      : null,
    materialIndex: Number.isInteger(action.materialIndex)
      ? action.materialIndex
      : null,
    position: action.position || null,
    priority: Number.isFinite(Number(action.priority))
      ? Number(action.priority)
      : null,
    targetPreferenceKeys: Object.keys(targetPreferences).sort(),
  };
}

export function summarizePlanningState(stateOrGame, options = {}) {
  const { bot, opponent } = resolvePerspective(stateOrGame, options);
  return {
    phase: stateOrGame?.phase || stateOrGame?.currentPhase || null,
    turn: stateOrGame?.turn || stateOrGame?.currentPlayer?.id || null,
    turnCounter: roundStat(stateOrGame?.turnCounter),
    bot: summarizePlayer(bot),
    opponent: summarizePlayer(opponent),
  };
}

function stableString(value) {
  return JSON.stringify(value);
}

function effectiveAtk(card) {
  return roundStat((card?.atk || 0) + (card?.tempAtk || 0) + (card?.equipAtk || 0));
}

function effectiveDef(card) {
  return roundStat((card?.def || 0) + (card?.tempDef || 0) + (card?.equipDef || 0));
}

function equivalentCardExceptStatRepresentation(expected, actual) {
  if (!expected || !actual) return false;
  const expectedStable = {
    ...expected,
    atk: 0,
    def: 0,
    tempAtk: 0,
    tempDef: 0,
    equipAtk: 0,
    equipDef: 0,
  };
  const actualStable = {
    ...actual,
    atk: 0,
    def: 0,
    tempAtk: 0,
    tempDef: 0,
    equipAtk: 0,
    equipDef: 0,
  };
  return (
    stableString(expectedStable) === stableString(actualStable) &&
    effectiveAtk(expected) === effectiveAtk(actual) &&
    effectiveDef(expected) === effectiveDef(actual)
  );
}

function equivalentZoneExceptStatRepresentation(expected = [], actual = []) {
  if (!Array.isArray(expected) || !Array.isArray(actual)) return false;
  if (expected.length !== actual.length) return false;
  return expected.every((card, index) =>
    equivalentCardExceptStatRepresentation(card, actual[index])
  );
}

function zoneDiffCategory(expected = [], actual = []) {
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

function compareField(prefix, expected, actual, diffs, severity = "state_mismatch") {
  if (stableString(expected) === stableString(actual)) return;
  diffs.push({
    path: prefix,
    severity,
    expected,
    actual,
  });
}

function compareCardZone(prefix, expected, actual, diffs) {
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

function comparePlayer(prefix, expected = {}, actual = {}, diffs) {
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

function classifyDiff(diffs = []) {
  if (!diffs.length) return "none";
  if (diffs.every((diff) => diff.severity === "minor")) return "minor";
  const meaningful = diffs.find((diff) => diff.severity !== "minor");
  if (meaningful?.severity) return meaningful.severity;
  const targetDiff = diffs.find((diff) =>
    /field|spellTrap|fieldSpell|banished/.test(diff.path || ""),
  );
  if (targetDiff) return "state_mismatch";
  return "state_mismatch";
}

export function diffPlanningSummaries(expected, actual) {
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
  const diffs = [];
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

export function isMeaningfulPlanningDiff(diff) {
  if (!diff) return false;
  return !["none", "minor"].includes(diff.severity);
}

function compactDiffValue(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 6).map(compactDiffValue);
  }
  if (value && typeof value === "object") {
    if ("name" in value || "id" in value || "position" in value) {
      return {
        name: value.name || null,
        id: value.id ?? null,
        position: value.position || null,
        faceDown: value.faceDown ?? null,
        atk: value.atk ?? null,
        def: value.def ?? null,
        tempAtk: value.tempAtk ?? null,
        tempDef: value.tempDef ?? null,
        counters: Array.isArray(value.counters) ? value.counters.slice(0, 4) : [],
        equips: Array.isArray(value.equips) ? value.equips.slice(0, 4) : [],
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

export function compactPlanningDiffs(diffs = [], limit = 6) {
  return (diffs || []).slice(0, limit).map((diff) => ({
    path: diff.path,
    severity: diff.severity,
    expected: compactDiffValue(diff.expected),
    actual: compactDiffValue(diff.actual),
  }));
}

export function summarizePlannerResult(result = null) {
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
