import { CARD_KNOWLEDGE, isExtremeDragon } from "./knowledge.js";
import { analyzeDragonState } from "./stateAnalysis.js";

const LOW_DRAGON_NAMES = new Set([
  "Solar Eclipse Dragon",
  "Lunar Eclipse Dragon",
  "Stelya, Dragon Tamer",
  "Armored Dragon",
  "Grey Dragon",
  "Luminescent Dragon",
  "Voltaic Dragon",
]);

const EXTREME_BOSS_NAMES = new Set([
  "Fire Extreme Dragon",
  "Volcanic Extreme Dragon",
  "Purified Crystal Dragon",
  "Rainbow Cosmic Dragon",
  "Radiant Cosmic Dragon",
  "Tech-Void Dragon",
  "Metal Armored Dragon",
]);

const TECH_VOID_BANISH_ORDER = new Map([
  ["Grey Dragon", 0],
  ["Solar Eclipse Dragon", 10],
  ["Stelya, Dragon Tamer", 12],
  ["Armored Dragon", 20],
  ["Luminescent Dragon", 30],
  ["Voltaic Dragon", 40],
  ["Lunar Eclipse Dragon", 50],
]);

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function zoneCards(player, zone) {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return Array.isArray(player[zone]) ? player[zone].filter(Boolean) : [];
}

function candidateCard(entry) {
  return entry?.candidate || entry?.card || entry;
}

function instanceId(card) {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uid ??
    card?.uuid ??
    card?.simInstanceId ??
    null
  );
}

function candidateIds(cards = []) {
  return (cards || [])
    .map((entry) => instanceId(candidateCard(entry)))
    .filter((id) => id !== null && id !== undefined);
}

function isDragonMonster(card) {
  return card?.cardKind === "monster" && card.type === "Dragon";
}

function isFaceupDragon(card) {
  return isDragonMonster(card) && !card.isFacedown;
}

function isLowDragon(card) {
  return isDragonMonster(card) && (card.level || 0) <= 4;
}

function countName(cards = [], name) {
  return (cards || []).filter((card) => card?.name === name).length;
}

function getEffectiveAtkValue(card) {
  if (!card) return 0;
  return (
    (card.atk || 0) +
    (card.tempAtkBoost || 0) +
    (card.equipAtkBonus || 0) +
    (card.permanentAtkBoost || 0)
  );
}

function cardStrategicValue(card) {
  if (!card) return 0;
  const knowledge = CARD_KNOWLEDGE[card.name] || {};
  return (
    (knowledge.value || knowledge.priority || 0) +
    (card.level || 0) * 0.25 +
    Math.max(card.atk || 0, card.def || 0) / 1000 +
    (isExtremeDragon(card) ? 4 : 0) +
    (card.monsterType === "fusion" || card.monsterType === "ascension" ? 5 : 0)
  );
}

function getOpponent(context = {}, player = null) {
  if (context.opponent) return context.opponent;
  const game = context.game?._gameRef || context.game;
  if (!game || !player) return {};
  if (game.bot === player) return game.player || {};
  if (game.player === player) return game.bot || {};
  return game.player || game.bot || {};
}

function makeContext(context = {}) {
  const player = context.player || context.bot || context.owner || context.game?.bot || {};
  const opponent = getOpponent(context, player);
  const game = context.game?._gameRef || context.game || null;
  const dragonState =
    context.dragonState ||
    context.analysis?.dragonState ||
    analyzeDragonState({
      game,
      bot: player,
      opponent,
      isSimulatedState: context.isSimulatedState ?? !game,
    });

  return {
    ...context,
    player,
    bot: player,
    opponent,
    game,
    dragonState,
    hand: zoneCards(player, "hand"),
    field: zoneCards(player, "field"),
    deck: zoneCards(player, "deck"),
    graveyard: zoneCards(player, "graveyard"),
    extraDeck: zoneCards(player, "extraDeck"),
    spellTrap: zoneCards(player, "spellTrap"),
    opponentField: zoneCards(opponent, "field"),
    sourceName:
      context.sourceName ||
      context.source?.name ||
      context.sourceCard?.name ||
      context.action?.cardName ||
      "",
    effectId:
      context.effectId ||
      context.effect?.id ||
      context.ctx?.effect?.id ||
      context.action?.effectId ||
      "",
  };
}

function rankSameShape(candidates = [], scoreFn) {
  return (candidates || [])
    .map((entry, index) => ({ entry, index, score: scoreFn(candidateCard(entry), entry) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ entry }) => entry);
}

function isUsedFieldBody(card) {
  return !!(card?.usedEffectThisTurn || card?.hasAttacked || card?.positionChangedThisTurn);
}

function hasImmediateStelyaPayoff(ctx) {
  const hasTributeBoss =
    (ctx.analysis?.canNormalSummon ?? true) &&
    ctx.hand.some(
      (card) =>
        isDragonMonster(card) &&
        (card.level || 0) >= 7 &&
        card.name !== "Stelya, Dragon Tamer",
    );
  const hasAwakeningLine =
    ctx.hand.some((card) => card?.name === "Extreme Dragon Awakening") &&
    ctx.field.filter(isFaceupDragon).length >= 2;
  const hasRelevantPressure =
    ctx.opponentField.some((card) => getEffectiveAtkValue(card) >= 2200) ||
    (ctx.opponentField.length > 0 && ctx.field.filter(isFaceupDragon).length <= 1);
  return hasTributeBoss || hasAwakeningLine || hasRelevantPressure;
}

export function scoreDragonFieldBanishCost(card, context = {}) {
  const ctx = makeContext(context);
  if (!isFaceupDragon(card)) return 9999;

  const name = card.name;
  const used = isUsedFieldBody(card);
  const duplicates = countName(ctx.field, name);
  let score =
    cardStrategicValue(card) * 6 +
    (card.level || 0) * 2 +
    Math.max(0, getEffectiveAtkValue(card)) / 450;

  if (LOW_DRAGON_NAMES.has(name)) score -= 10;
  else score += 12;
  if (used) score -= card.usedEffectThisTurn ? 16 : 10;
  if (duplicates > 1) score -= 8;

  if (name === "Armored Dragon") score += used ? -12 : -4;
  if (name === "Solar Eclipse Dragon") score += used ? -8 : 8;
  if (name === "Lunar Eclipse Dragon") score += used ? -7 : 10;
  if (name === "Grey Dragon") score += used ? -6 : 0;
  if (name === "Luminescent Dragon") {
    score += used ? -5 : ctx.dragonState.hasLuminousForRadiant ? 18 : 2;
  }
  if (name === "Stelya, Dragon Tamer") score += used ? -4 : 14;

  if (name === "Voltaic Dragon") {
    score += ctx.dragonState.hasVoltaicForTechVoid ? 45 : 8;
  }
  if (name === "Luminous Dragon") {
    score += ctx.dragonState.hasLuminousForRadiant ? 45 : 12;
  }
  if (name === "Purified Crystal Dragon") score += 65;
  if (EXTREME_BOSS_NAMES.has(name)) score += 55;
  if (isExtremeDragon(card)) score += 80;
  if (card.monsterType === "fusion" || card.monsterType === "ascension") score += 90;
  if ((card.level || 0) >= 7) score += 20;

  return score;
}

export function rankDragonFieldBanishCosts(candidates = [], context = {}) {
  return rankSameShape(candidates, (card) => scoreDragonFieldBanishCost(card, context));
}

function gySummaryByInstance(entries = []) {
  const byId = new Map();
  const byName = new Map();
  for (const entry of entries || []) {
    const id = entry?.instanceId;
    if (id !== null && id !== undefined) byId.set(String(id), entry);
    if (entry?.name) {
      const list = byName.get(entry.name) || [];
      list.push(entry);
      byName.set(entry.name, list);
    }
  }
  return { byId, byName };
}

function isStateMarkedSafe(card, ctx) {
  const { byId, byName } = gySummaryByInstance(ctx.dragonState.purifiedSafeBanishCandidates);
  const id = instanceId(card);
  if (id !== null && id !== undefined && byId.has(String(id))) return true;
  return (byName.get(card?.name) || []).length > 0;
}

function isStateMarkedProtected(card, ctx) {
  const { byId, byName } = gySummaryByInstance(ctx.dragonState.purifiedProtectedBanishCandidates);
  const id = instanceId(card);
  if (id !== null && id !== undefined && byId.has(String(id))) return true;
  return (byName.get(card?.name) || []).length > 0;
}

export function scoreDragonGyBanishCost(card, context = {}) {
  const ctx = makeContext(context);
  if (!isDragonMonster(card)) return 9999;

  const name = card.name;
  const duplicates = countName(ctx.graveyard, name);
  const opt = ctx.dragonState.opt || {};
  let score =
    cardStrategicValue(card) * 7 +
    (card.level || 0) * 1.5 +
    Math.max(0, card.atk || 0, card.def || 0) / 650;

  if (LOW_DRAGON_NAMES.has(name)) score -= 5;
  if (duplicates > 1) score -= 14;
  if (isStateMarkedSafe(card, ctx)) score -= 18;
  if (isStateMarkedProtected(card, ctx)) score += 45;

  if (name === "Armored Dragon") score -= duplicates > 1 ? 12 : 7;
  if (name === "Grey Dragon") score -= 8;
  if (name === "Luminescent Dragon") score += ctx.dragonState.hasLuminousForRadiant ? 18 : -4;

  if (name === "Solar Eclipse Dragon") {
    score += opt.solarGy?.canUse ? 75 : duplicates > 1 ? -6 : 15;
  }
  if (name === "Lunar Eclipse Dragon") {
    score += opt.lunarGy?.canUse ? 80 : duplicates > 1 ? -6 : 15;
  }
  if (name === "Stelya, Dragon Tamer") {
    score += opt.stelyaSummon?.canUse
      ? ctx.dragonState.hasDragonFieldBodyForStelya
        ? 80
        : 60
      : 18;
  }
  if (name === "Voltaic Dragon") {
    score += duplicates <= 1 && ctx.dragonState.hasVoltaicForTechVoid ? 80 : 18;
  }
  if (name === "Luminous Dragon") {
    score += duplicates <= 1 && ctx.dragonState.hasLuminousForRadiant ? 80 : 25;
  }
  if (name === "Black Bull Dragon") score += 48;
  if (name === "Hellkite Dragon") {
    score += ctx.dragonState.hasLevel7PlusForRoar || ctx.dragonState.hasCallSetOrHand ? 48 : 20;
  }
  if (name === "Purified Crystal Dragon") score += 45;
  if (isExtremeDragon(card)) score += 75;
  if (card.monsterType === "fusion" || card.monsterType === "ascension") score += 90;

  return score;
}

export function rankDragonGyBanishCosts(candidates = [], context = {}) {
  return rankSameShape(candidates, (card) => scoreDragonGyBanishCost(card, context));
}

function techVoidBuffAmount(card) {
  return Math.floor(Math.max(0, card?.atk || 0) * 0.5);
}

function techVoidBuffMatters(card, ctx) {
  const source = ctx.source || ctx.sourceCard || ctx.summoned || null;
  const currentAtk = getEffectiveAtkValue(source) || 2500;
  const buff = techVoidBuffAmount(card);
  const buffedAtk = currentAtk + buff;
  const strongestOpponentAtk = ctx.opponentField.reduce(
    (max, candidate) => Math.max(max, getEffectiveAtkValue(candidate)),
    0,
  );
  const opponentLp = Number(ctx.opponent?.lp ?? 8000);
  const canAttack = !source?.hasAttacked && !source?.cannotAttackThisTurn;

  return (
    (strongestOpponentAtk > 0 &&
      currentAtk <= strongestOpponentAtk &&
      buffedAtk > strongestOpponentAtk) ||
    (canAttack && opponentLp > currentAtk && opponentLp <= buffedAtk)
  );
}

function hasPendingGyValueForTechVoid(card, ctx) {
  const name = card?.name;
  const duplicates = countName(ctx.graveyard, name);
  const opt = ctx.dragonState.opt || {};

  if (name === "Solar Eclipse Dragon") return !!opt.solarGy?.canUse;
  if (name === "Lunar Eclipse Dragon") return !!opt.lunarGy?.canUse;
  if (name === "Stelya, Dragon Tamer") return !!opt.stelyaSummon?.canUse;
  if (name === "Voltaic Dragon") {
    return duplicates <= 1 && ctx.dragonState.hasVoltaicForTechVoid;
  }
  if (name === "Luminescent Dragon") return duplicates <= 1 && ctx.dragonState.hasLunarInGY;
  if (name === "Black Bull Dragon") return true;
  return false;
}

export function scoreTechVoidBanishTarget(card, context = {}) {
  const ctx = makeContext(context);
  if (!isLowDragon(card)) return 9999;

  const name = card.name;
  const combatRelevant = techVoidBuffMatters(card, ctx);
  const pendingGyValue = hasPendingGyValueForTechVoid(card, ctx);
  let score = TECH_VOID_BANISH_ORDER.has(name)
    ? TECH_VOID_BANISH_ORDER.get(name)
    : 35 + cardStrategicValue(card) * 2;

  score -= techVoidBuffAmount(card) / 1000;
  if (countName(ctx.graveyard, name) > 1) score -= 6;
  if (combatRelevant) score -= 20;
  if (pendingGyValue && !combatRelevant) score += 80;
  if (pendingGyValue && combatRelevant) score += 12;
  if (name === "Grey Dragon") score -= 8;
  if (name === "Lunar Eclipse Dragon" && pendingGyValue && !combatRelevant) score += 25;
  if (isExtremeDragon(card)) score += 100;

  return score;
}

export function rankTechVoidBanishTargets(candidates = [], context = {}) {
  return rankSameShape(candidates, (card) => scoreTechVoidBanishTarget(card, context));
}

function buildPreferenceFromRanked(ranked = [], scoreFn, context = {}, options = {}) {
  const limit = options.limit ?? 3;
  const preferMaxScore = options.preferMaxScore ?? 65;
  const preserveMinScore = options.preserveMinScore ?? 85;
  const scored = (ranked || []).map((entry) => ({
    entry,
    card: candidateCard(entry),
    score: scoreFn(candidateCard(entry), context),
  }));
  const preferred = scored
    .filter((entry) => entry.score <= preferMaxScore)
    .slice(0, limit)
    .map((entry) => entry.card);
  const protectedCards = scored
    .filter((entry) => entry.score >= preserveMinScore)
    .map((entry) => entry.card);

  return {
    role: "cost",
    intent: "cost",
    preferNames: unique(preferred.map((card) => card?.name)),
    preserveNames: unique(protectedCards.map((card) => card?.name)),
    avoidNames: unique(protectedCards.map((card) => card?.name)),
    preferredInstanceIds: candidateIds(preferred),
    avoidInstanceIds: candidateIds(protectedCards),
  };
}

function preferExactCards(preference = {}, cards = []) {
  const selectedIds = new Set(candidateIds(cards).map((id) => String(id)));
  return {
    ...preference,
    preferNames: unique([
      ...(preference.preferNames || []),
      ...cards.map((card) => card?.name),
    ]),
    preferredInstanceIds: unique([
      ...(preference.preferredInstanceIds || []),
      ...candidateIds(cards),
    ]),
    avoidInstanceIds: (preference.avoidInstanceIds || []).filter(
      (id) => !selectedIds.has(String(id)),
    ),
  };
}

export function shouldUseStelyaBanishSummon(context = {}) {
  const ctx = makeContext(context);
  const candidates = (context.candidates || ctx.field).filter(isFaceupDragon);
  const ranked = rankDragonFieldBanishCosts(candidates, ctx);
  const best = candidateCard(ranked[0]);
  if (!best) {
    return { ok: false, reason: "no field Dragon to banish for Stelya", ranked };
  }

  const bestScore = scoreDragonFieldBanishCost(best, ctx);
  const payoff = hasImmediateStelyaPayoff(ctx);
  const safe = bestScore <= 55;
  const acceptableWithPayoff = bestScore <= 82 && payoff;
  const ok = safe || acceptableWithPayoff;

  return {
    ok,
    reason: ok
      ? safe
        ? "Stelya has expendable Dragon cost"
        : "Stelya has payoff for a medium-risk Dragon cost"
      : "Stelya would banish a critical Dragon without payoff",
    best,
    bestScore,
    ranked,
    priority: safe ? 8 : 7,
    targetPreference: preferExactCards(
      buildPreferenceFromRanked(
        ranked,
        scoreDragonFieldBanishCost,
        ctx,
        {
          limit: 2,
          preferMaxScore: safe ? 70 : Math.max(70, bestScore),
          preserveMinScore: 83,
        },
      ),
      [best],
    ),
  };
}

export function shouldUsePurifiedBanishSummon(context = {}) {
  const ctx = makeContext(context);
  const candidates = (context.candidates || ctx.graveyard).filter(isDragonMonster);
  const ranked = rankDragonGyBanishCosts(candidates, ctx);
  const selected = ranked.slice(0, 3).map(candidateCard);
  if (selected.length < 3) {
    return { ok: false, reason: "not enough Dragon GY costs for Purified", ranked, selected };
  }

  const scores = selected.map((card) => scoreDragonGyBanishCost(card, ctx));
  const criticalCount = scores.filter((score) => score >= 70).length;
  const safeCount = ranked
    .map(candidateCard)
    .filter((card) => scoreDragonGyBanishCost(card, ctx) < 55).length;
  const ownFieldDragons = ctx.field.filter(isFaceupDragon);
  const strongestOpponentAtk = ctx.opponentField.reduce(
    (max, card) => Math.max(max, getEffectiveAtkValue(card)),
    0,
  );
  const pressure =
    strongestOpponentAtk >= 2300 ||
    ctx.opponentField.length > ownFieldDragons.length ||
    Number(ctx.analysis?.lpRatio ?? 1) < 0.65;
  const fieldNeedsBody = ownFieldDragons.length === 0;
  const protectionTarget = ownFieldDragons.length > 0;
  const rainbowProgress =
    safeCount >= 3 &&
    ctx.extraDeck.some((card) => card?.name === "Rainbow Cosmic Dragon");
  const advancesPlan = pressure || fieldNeedsBody || protectionTarget || rainbowProgress;
  const ok =
    advancesPlan &&
    (criticalCount === 0 || (criticalCount === 1 && pressure && safeCount >= 2));

  return {
    ok,
    reason: ok
      ? "Purified advances board state without exhausting critical GY"
      : criticalCount > 0
        ? "Purified would banish critical GY resources"
        : "Purified does not stabilize or advance a current plan",
    ranked,
    selected,
    scores,
    criticalCount,
    safeCount,
    priority:
      7 +
      (pressure ? 1 : 0) +
      (fieldNeedsBody ? 1 : 0) +
      (protectionTarget ? 1 : 0) +
      (rainbowProgress ? 1 : 0) -
      criticalCount * 2,
    targetPreference: preferExactCards(
      buildPreferenceFromRanked(
        ranked,
        scoreDragonGyBanishCost,
        ctx,
        {
          limit: 3,
          preferMaxScore: 65,
          preserveMinScore: 70,
        },
      ),
      selected,
    ),
  };
}

export function buildDragonBanishTargetPreferences(context = {}) {
  const ctx = makeContext(context);
  const byId = {};

  const fieldCandidates = ctx.field.filter(isFaceupDragon);
  const rankedField = rankDragonFieldBanishCosts(fieldCandidates, ctx);
  const stelyaPreference = buildPreferenceFromRanked(
    rankedField,
    scoreDragonFieldBanishCost,
    ctx,
    {
      limit: 2,
      preferMaxScore: 70,
      preserveMinScore: 83,
    },
  );
  byId.stelya_hand_banish_cost = stelyaPreference;
  byId.stelya_graveyard_banish_cost = stelyaPreference;

  const gyDragonCandidates = ctx.graveyard.filter(isDragonMonster);
  const rankedGy = rankDragonGyBanishCosts(gyDragonCandidates, ctx);
  byId.purified_banish_cost = buildPreferenceFromRanked(
    rankedGy,
    scoreDragonGyBanishCost,
    ctx,
    {
      limit: 3,
      preferMaxScore: 65,
      preserveMinScore: 70,
    },
  );

  const techVoidCandidates = gyDragonCandidates.filter(isLowDragon);
  const rankedTechVoid = rankTechVoidBanishTargets(techVoidCandidates, ctx);
  byId.tech_void_banish_target = buildPreferenceFromRanked(
    rankedTechVoid,
    scoreTechVoidBanishTarget,
    ctx,
    {
      limit: 1,
      preferMaxScore: 60,
      preserveMinScore: 80,
    },
  );

  return byId;
}
