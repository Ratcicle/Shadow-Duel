import { CARD_KNOWLEDGE, isExtremeDragon } from "./knowledge.js";
import { analyzeDragonState } from "./stateAnalysis.js";
import { rankDragonSearchCandidates } from "./searchPolicy.js";
import {
  buildDragonTargetCostPreferences,
  rankDragonDiscardCandidates,
  scoreDragonDiscardCandidate,
} from "./costPolicy.js";
import { shouldUseStelyaBanishSummon } from "./banishPolicy.js";

const SMALL_DRAGON_RECRUIT_ORDER = [
  "Lunar Eclipse Dragon",
  "Solar Eclipse Dragon",
  "Stelya, Dragon Tamer",
  "Voltaic Dragon",
  "Grey Dragon",
  "Luminescent Dragon",
  "Armored Dragon",
];

const STELYA_BOSS_NAMES = new Set([
  "Fire Extreme Dragon",
  "Volcanic Extreme Dragon",
  "Hellkite Dragon",
  "Majestic Silver Dragon",
  "Purified Crystal Dragon",
  "Black Bull Dragon",
  "Luminous Dragon",
]);

const BLACK_BULL_GOOD_COST_NAMES = new Set([
  "Solar Eclipse Dragon",
  "Lunar Eclipse Dragon",
  "Stelya, Dragon Tamer",
  "Voltaic Dragon",
  "Grey Dragon",
  "Black Bull Dragon",
]);

function zoneCards(player, zone) {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return Array.isArray(player[zone]) ? player[zone].filter(Boolean) : [];
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

function hasName(cards = [], name) {
  return (cards || []).some((card) => card?.name === name);
}

function countName(cards = [], name) {
  return (cards || []).filter((card) => card?.name === name).length;
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

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function getOpponent(context = {}, player = null) {
  if (context.opponent) return context.opponent;
  const game = context.game?._gameRef || context.game;
  if (!game || !player) return {};
  if (game.bot === player) return game.player || {};
  if (game.player === player) return game.bot || {};
  return game.player || game.bot || {};
}

function cardStrategicValue(card, fallbackValue = null) {
  if (typeof fallbackValue === "function") return Number(fallbackValue(card)) || 0;
  const knowledge = CARD_KNOWLEDGE[card?.name] || {};
  return (
    (knowledge.value || knowledge.priority || 0) +
    (card?.level || 0) * 0.25 +
    Math.max(card?.atk || 0, card?.def || 0) / 1000 +
    (isExtremeDragon(card) ? 4 : 0) +
    (card?.monsterType === "fusion" || card?.monsterType === "ascension" ? 5 : 0)
  );
}

function getEffectId(context = {}) {
  return (
    context.effectId ||
    context.effect?.id ||
    context.ctx?.effect?.id ||
    context.action?.effectId ||
    ""
  );
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
      isSimulatedState:
        context.isSimulatedState === true ||
        context.game?._isPerspectiveState === true ||
        !game,
    });
  const hand = zoneCards(player, "hand");
  const field = zoneCards(player, "field");
  const deck = zoneCards(player, "deck");
  const graveyard = zoneCards(player, "graveyard");
  const spellTrap = zoneCards(player, "spellTrap");
  const opponentField = zoneCards(opponent, "field");

  return {
    ...context,
    player,
    bot: player,
    opponent,
    game,
    dragonState,
    hand,
    field,
    deck,
    graveyard,
    spellTrap,
    extraDeck: zoneCards(player, "extraDeck"),
    opponentField,
    fieldCapacity: Math.max(0, 5 - field.length),
    source: context.source || context.sourceCard || context.card || null,
    sourceCard: context.sourceCard || context.source || context.card || null,
    sourceName:
      context.sourceName ||
      context.source?.name ||
      context.sourceCard?.name ||
      context.card?.name ||
      context.action?.cardName ||
      "",
    effectId: getEffectId(context),
    canNormalSummon:
      context.analysis?.canNormalSummon ??
      !(player?.normalSummonUsed || Number(player?.summonCount || 0) > 0),
  };
}

function optCanUse(ctx, key) {
  const status = ctx.dragonState?.opt?.[key];
  return status?.canUse !== false;
}

function hasLevelReductionPayoff(ctx) {
  const faceupBodies = ctx.field.filter(isFaceupDragon).length + 1;
  return ctx.hand.some((card) => {
    if (!isDragonMonster(card)) return false;
    if (card === ctx.source || card === ctx.sourceCard) return false;
    const currentLevel = card.level || 0;
    if (currentLevel < 5) return false;
    const reducedLevel = Math.max(1, currentLevel - 2);
    const beforeTributes = currentLevel >= 7 ? 2 : currentLevel >= 5 ? 1 : 0;
    const afterTributes = reducedLevel >= 7 ? 2 : reducedLevel >= 5 ? 1 : 0;
    return afterTributes < beforeTributes && faceupBodies >= afterTributes;
  });
}

function hasStelyaBodyPayoff(ctx) {
  const faceupDragons = ctx.field.filter(isFaceupDragon);
  const highDragonInHand = ctx.hand.some(
    (card) =>
      isDragonMonster(card) &&
      card.name !== "Stelya, Dragon Tamer" &&
      (card.level || 0) >= 7,
  );
  const awakeningInHandOrField =
    hasName(ctx.hand, "Extreme Dragon Awakening") ||
    hasName(ctx.spellTrap, "Extreme Dragon Awakening");
  const polyLine =
    hasName(ctx.hand, "Polymerization") &&
    (
      hasName([...ctx.hand, ...ctx.field], "Voltaic Dragon") ||
      ctx.field.filter(isFaceupDragon).length >= 2
    );
  const underPressure =
    ctx.field.length === 0 ||
    ctx.opponentField.some((card) => (card?.atk || 0) >= 2200) ||
    ctx.opponentField.length > ctx.field.length;

  return (
    (ctx.canNormalSummon && highDragonInHand) ||
    (awakeningInHandOrField && faceupDragons.length >= 1) ||
    polyLine ||
    underPressure ||
    ctx.dragonState?.hasTwoDragonsForAwakening
  );
}

function hasStelyaSearchTargetPlan(target, ctx) {
  if (!target || !STELYA_BOSS_NAMES.has(target.name)) return false;
  const canBridgeTribute =
    ctx.canNormalSummon &&
    ctx.field.some(isFaceupDragon) &&
    (target.level || 0) >= 7;
  if (canBridgeTribute) return true;

  if (
    target.name === "Black Bull Dragon" &&
    (ctx.dragonState?.usefulDiscardCandidates || []).length >= 2
  ) {
    return true;
  }
  if (
    target.name === "Purified Crystal Dragon" &&
    ctx.dragonState?.hasThreeSafeGYDragonsForPurified
  ) {
    return true;
  }
  if (
    target.name === "Luminous Dragon" &&
    (hasName(ctx.hand, "Polymerization") ||
      ctx.dragonState?.fusionPieces?.radiant?.hasMaterials ||
      ctx.dragonState?.hasLuminousForRadiant)
  ) {
    return true;
  }
  if (
    target.name === "Hellkite Dragon" &&
    (hasName(ctx.hand, "Hellkite Roar") ||
      hasName(ctx.graveyard, "Hellkite Roar") ||
      ctx.dragonState?.hasLevel7PlusForRoar === false)
  ) {
    return true;
  }

  const nextTurnSafe =
    ctx.field.filter(isFaceupDragon).length >= 2 ||
    hasName(ctx.spellTrap, "Call of the Haunted") ||
    hasName(ctx.spellTrap, "Dragon Spirit Sanctuary") ||
    ctx.player?.fieldSpell?.name === "Jagged Peak of the Dragons";
  return nextTurnSafe && ctx.opponentField.length <= ctx.field.length + 1;
}

function buildSearchAction(filters = {}, extra = {}) {
  return {
    type: "add_from_zone_to_hand",
    zone: "deck",
    filters,
    ...extra,
  };
}

function bestStelyaSearchTarget(ctx) {
  const action = buildSearchAction(
    { cardKind: "monster", type: "Dragon" },
    { minLevel: 5 },
  );
  const candidates = ctx.deck.filter(
    (card) => isDragonMonster(card) && (card.level || 0) >= 5,
  );
  return rankDragonSearchCandidates(candidates, action, {
    ...ctx,
    source: ctx.source,
    sourceCard: ctx.sourceCard,
    effect: { id: "stelya_discard_search_dragon" },
    effectId: "stelya_discard_search_dragon",
    fallbackValue: cardStrategicValue,
  })[0] || null;
}

function buildTargetPreference(cards = [], role = "named_preference") {
  return {
    role,
    preferredNames: unique(cards.map((card) => card?.name)),
    preferNames: unique(cards.map((card) => card?.name)),
    preferredInstanceIds: cards
      .map(instanceId)
      .filter((id) => id !== null && id !== undefined),
  };
}

function rankRecruitCards(candidates = [], context = {}) {
  const ctx = makeContext(context);
  const effectId = ctx.effectId;
  const sourceName = ctx.sourceName;
  const action = ctx.action || {};
  const isSolarHand =
    sourceName === "Solar Eclipse Dragon" ||
    effectId === "solar_eclipse_discard_summon_lunar";
  const isLuminescent =
    sourceName === "Luminescent Dragon" ||
    effectId === "luminescent_dragon_normal_summon_revive";
  const isSolarGy = effectId === "solar_eclipse_gy_revive_dragon";
  const isLunarGy = effectId === "lunar_eclipse_gy_summon_deck_dragon";

  return (candidates || [])
    .map((card, index) => {
      let score = cardStrategicValue(card, ctx.fallbackValue);
      const order = SMALL_DRAGON_RECRUIT_ORDER.indexOf(card?.name);
      if (order >= 0) score += 30 - order * 2;

      if (isSolarHand) {
        score = card?.name === "Lunar Eclipse Dragon" ? 500 : -5000;
        if ((ctx.deck || []).includes(card)) score += 80;
        if ((ctx.hand || []).includes(card)) score += 10;
      } else if (isLuminescent) {
        if (card?.name === "Lunar Eclipse Dragon") {
          score += optCanUse(ctx, "lunarSummon") && ctx.hand.length > 0 ? 170 : 75;
        } else if (card?.name === "Solar Eclipse Dragon") {
          score += optCanUse(ctx, "solarGy") ? 125 : 85;
        } else if (card?.name === "Stelya, Dragon Tamer") {
          score += hasStelyaBodyPayoff(ctx) ? 130 : 70;
        } else if (card?.name === "Voltaic Dragon") {
          score += ctx.dragonState?.hasVoltaicForTechVoid ? 115 : 85;
        } else if (card?.name === "Grey Dragon") {
          score += 95;
        }
      } else if (isSolarGy) {
        if (card?.name === "Lunar Eclipse Dragon") {
          score += optCanUse(ctx, "lunarSummon") && ctx.hand.length > 0 ? 185 : 95;
        } else if (card?.name === "Stelya, Dragon Tamer") {
          score += hasStelyaBodyPayoff(ctx) ? 165 : 80;
        } else if (card?.name === "Voltaic Dragon") {
          score += ctx.dragonState?.hasVoltaicForTechVoid ? 135 : 100;
        } else if (card?.name === "Grey Dragon") {
          score += 105;
        } else if (card?.name === "Luminescent Dragon") {
          score += 85;
        }
      } else if (isLunarGy) {
        if (card?.name === "Lunar Eclipse Dragon") {
          score += optCanUse(ctx, "lunarSummon") && ctx.hand.length > 0 ? 190 : 85;
        } else if (card?.name === "Solar Eclipse Dragon") {
          score += !ctx.dragonState?.hasSolarInHand && !ctx.dragonState?.hasSolarInGY ? 155 : 105;
        } else if (card?.name === "Stelya, Dragon Tamer") {
          score += hasStelyaBodyPayoff(ctx) ? 140 : 80;
        } else if (card?.name === "Voltaic Dragon") {
          score += ctx.dragonState?.hasVoltaicForTechVoid ? 125 : 95;
        } else if (card?.name === "Luminescent Dragon") {
          score += (ctx.dragonState?.lowLevelDragonGYTargets || []).length > 0 ? 120 : 70;
        }
      } else if (action.filters?.name && card?.name === action.filters.name) {
        score += 60;
      }

      return { card, index, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        cardStrategicValue(b.card, ctx.fallbackValue) -
          cardStrategicValue(a.card, ctx.fallbackValue) ||
        a.index - b.index,
    );
}

function hasLunarGyRecruitPayoff(ctx, bestCard = null) {
  if (bestCard?.name === "Lunar Eclipse Dragon") {
    return (
      optCanUse(ctx, "lunarSummon") &&
      ctx.hand.length > 0 &&
      ctx.deck.some((card) => isLowDragon(card) && card !== bestCard)
    );
  }
  if (bestCard?.name === "Stelya, Dragon Tamer") {
    return hasStelyaBodyPayoff(ctx);
  }
  return (
    ctx.dragonState?.hasTwoDragonsForAwakening ||
    (bestCard?.name === "Luminescent Dragon" &&
      (ctx.dragonState?.lowLevelDragonGYTargets || []).length > 0) ||
    ctx.opponentField.length > ctx.field.length
  );
}

export function buildDragonRecruitTargetPreference(candidates = [], context = {}) {
  const ranked = rankRecruitCards(candidates, context).map((entry) => entry.card);
  return buildTargetPreference(ranked.slice(0, 4), "recruit");
}

export function evaluateDragonRecruitCandidate(candidates = [], context = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { blockedAll: true, scores: [], reason: "no recruit candidates" };
  }
  const ctx = makeContext(context);
  const ranked = rankRecruitCards(candidates, ctx);
  const scores = ranked.map((entry) => ({
    card: entry.card,
    score: entry.score,
  }));
  const best = ranked[0]?.card || null;
  if (ctx.effectId === "lunar_eclipse_gy_summon_deck_dragon" && !hasLunarGyRecruitPayoff(ctx, best)) {
    return {
      blockedAll: true,
      best,
      scores,
      reason: "Lunar GY summon has no follow-up payoff",
    };
  }
  return {
    best,
    scores,
    reason: best ? `Prefer ${best.name}` : "no recruit candidates",
  };
}

export function evaluateDragonHandIgnition(card, effect, context = {}) {
  if (!card || !effect) return null;
  const ctx = makeContext({
    ...context,
    source: card,
    sourceCard: card,
    effect,
    effectId: effect.id,
  });

  if (effect.id === "solar_eclipse_discard_summon_lunar") {
    if (!optCanUse(ctx, "solarHand")) {
      return { handled: true, ok: false, reason: "Solar hand effect already used" };
    }
    if (ctx.fieldCapacity <= 0) {
      return { handled: true, ok: false, reason: "no Monster Zone for Lunar" };
    }
    if (!hasName(ctx.hand, "Lunar Eclipse Dragon") && !hasName(ctx.deck, "Lunar Eclipse Dragon")) {
      return { handled: true, ok: false, reason: "no Lunar Eclipse Dragon accessible" };
    }
    let priority = 14;
    if (hasName(ctx.deck, "Lunar Eclipse Dragon")) priority += 2;
    if (!ctx.dragonState?.hasLunarInGY && !ctx.dragonState?.hasLunarInHand) priority += 1;
    if (hasLevelReductionPayoff(ctx)) priority += 3;
    if (ctx.opponentField.length > ctx.field.length) priority += 1;
    return {
      handled: true,
      ok: true,
      priority,
      targetPreferences: {},
      reason: hasLevelReductionPayoff(ctx)
        ? "Eclipse starter unlocks Lunar and lowers tribute levels"
        : "Eclipse starter summons Lunar",
    };
  }

  if (card.name === "Stelya, Dragon Tamer" && effect.id === "stelya_hand_banish_dragon_summon") {
    const decision = shouldUseStelyaBanishSummon(ctx);
    if (!decision.ok) {
      return { handled: true, ok: false, reason: decision.reason };
    }
    if (!hasStelyaBodyPayoff(ctx)) {
      return {
        handled: true,
        ok: false,
        reason: "Stelya self-summon has no tribute, material, defense, or bridge payoff",
      };
    }
    return {
      handled: true,
      ok: true,
      priority: decision.priority + 2,
      targetPreferences: {
        stelya_hand_banish_cost: decision.targetPreference,
      },
      reason: decision.reason,
    };
  }

  if (card.name === "Stelya, Dragon Tamer" && effect.id === "stelya_discard_search_dragon") {
    if (!optCanUse(ctx, "stelyaSearch")) {
      return { handled: true, ok: false, reason: "Stelya search already used" };
    }
    const discardCandidates = ctx.hand.filter((candidate) => candidate !== card);
    if (discardCandidates.length === 0) {
      return { handled: true, ok: false, reason: "no second card to discard" };
    }
    const rankedDiscard = rankDragonDiscardCandidates(discardCandidates, ctx);
    const bestDiscard = rankedDiscard[0] || null;
    if (!bestDiscard || scoreDragonDiscardCandidate(bestDiscard, ctx) >= 115) {
      return {
        handled: true,
        ok: false,
        reason: "Stelya would discard a protected payoff",
      };
    }
    const bossTarget = bestStelyaSearchTarget(ctx);
    if (!bossTarget) {
      return { handled: true, ok: false, reason: "no Level 5+ Dragon search target" };
    }
    if (!hasStelyaSearchTargetPlan(bossTarget, ctx)) {
      return {
        handled: true,
        ok: false,
        reason: `searched ${bossTarget.name} has no near-term route`,
      };
    }
    const costPrefs = buildDragonTargetCostPreferences(ctx);
    let priority = 9;
    if (["Fire Extreme Dragon", "Volcanic Extreme Dragon", "Purified Crystal Dragon"].includes(bossTarget.name)) {
      priority += 2;
    }
    if (ctx.canNormalSummon && ctx.field.some(isFaceupDragon)) priority += 2;
    if (ctx.opponentField.length > 0) priority += 1;
    return {
      handled: true,
      ok: true,
      priority,
      targetPreferences: {
        stelya_discard_other_card: costPrefs.stelya_discard_other_card,
      },
      reason: `Stelya searches ${bossTarget.name} with usable plan`,
    };
  }

  if (card.name === "Voltaic Dragon") {
    if (!ctx.field.some(isFaceupDragon)) {
      return { handled: true, ok: false, reason: "no face-up Dragon controlled" };
    }
    if (ctx.fieldCapacity <= 0) {
      return { handled: true, ok: false, reason: "field full" };
    }
    const bodyCountAfter = ctx.field.filter(isFaceupDragon).length + 1;
    const enablesAwakening =
      bodyCountAfter >= 2 &&
      (hasName(ctx.hand, "Extreme Dragon Awakening") ||
        hasName(ctx.spellTrap, "Extreme Dragon Awakening"));
    const enablesTechVoid =
      hasName(ctx.hand, "Polymerization") &&
      ctx.hand.some((candidate) => isDragonMonster(candidate) && (candidate.level || 0) >= 5);
    const enablesStelya = hasName(ctx.hand, "Stelya, Dragon Tamer") || hasName(ctx.graveyard, "Stelya, Dragon Tamer");
    const stabilizes = ctx.opponentField.length > ctx.field.length;
    if (!enablesAwakening && !enablesTechVoid && !enablesStelya && !stabilizes) {
      return { handled: true, ok: false, reason: "Voltaic body has no immediate payoff" };
    }
    return {
      handled: true,
      ok: true,
      priority:
        8 +
        (enablesAwakening ? 2 : 0) +
        (enablesTechVoid ? 2 : 0) +
        (stabilizes ? 1 : 0),
      targetPreferences: {},
      reason: "Voltaic enables Dragon body payoff",
    };
  }

  if (card.name === "Black Bull Dragon") {
    const handDragons = ctx.hand.filter(
      (candidate) => isDragonMonster(candidate) && candidate !== card,
    );
    if (handDragons.length < 2) {
      return { handled: true, ok: false, reason: "insufficient Dragon discard costs" };
    }
    if (ctx.fieldCapacity <= 0) {
      return { handled: true, ok: false, reason: "field full" };
    }
    const ranked = rankDragonDiscardCandidates(handDragons, {
      ...ctx,
      source: card,
      sourceCard: card,
      effect,
    });
    const selected = ranked.slice(0, 2);
    const acceptable = selected.length >= 2 && selected.every(
      (candidate) => scoreDragonDiscardCandidate(candidate, ctx) < 115,
    );
    const useful = selected.some((candidate) => BLACK_BULL_GOOD_COST_NAMES.has(candidate.name));
    const needsImmediateAttacker =
      ctx.field.length === 0 &&
      (
        (ctx.opponent?.lp || 8000) <= (card.atk || 2500) ||
        ctx.opponentField.some((candidate) => (candidate?.atk || 0) <= (card.atk || 2500))
      );
    if (!acceptable || (!useful && needsImmediateAttacker)) {
      return {
        handled: true,
        ok: false,
        reason: "Black Bull discard costs do not justify a non-attacking body",
      };
    }
    const costPrefs = buildDragonTargetCostPreferences({
      ...ctx,
      source: card,
      sourceCard: card,
      effect,
    });
    return {
      handled: true,
      ok: true,
      priority: useful ? 10 : 7,
      targetPreferences: {
        bbd_cost: costPrefs.bbd_cost,
      },
      reason: "Black Bull has acceptable Dragon discard costs",
    };
  }

  return null;
}

export function evaluateDragonGraveyardIgnition(card, effect, context = {}) {
  if (!card || !effect) return null;
  const ctx = makeContext({
    ...context,
    source: card,
    sourceCard: card,
    effect,
    effectId: effect.id,
  });

  if (effect.id === "solar_eclipse_gy_revive_dragon") {
    if (!optCanUse(ctx, "solarGy")) {
      return { handled: true, ok: false, reason: "Solar GY effect already used" };
    }
    if (ctx.fieldCapacity <= 0) {
      return { handled: true, ok: false, reason: "field full" };
    }
    const targets = ctx.graveyard.filter(
      (candidate) => candidate !== card && isLowDragon(candidate),
    );
    if (targets.length === 0) {
      return { handled: true, ok: false, reason: "no low-level Dragon in GY" };
    }
    const preference = buildDragonRecruitTargetPreference(targets, ctx);
    const best = evaluateDragonRecruitCandidate(targets, ctx).best || targets[0];
    const payoff =
      best?.name === "Lunar Eclipse Dragon" ||
      best?.name === "Stelya, Dragon Tamer" ||
      ctx.dragonState?.hasTwoDragonsForAwakening ||
      ctx.opponentField.length > ctx.field.length;
    if (!payoff) {
      return { handled: true, ok: false, reason: "Solar revive has no material or defense payoff" };
    }
    return {
      handled: true,
      ok: true,
      priority: 9 + (best?.name === "Lunar Eclipse Dragon" ? 2 : 0),
      targetPreferences: {
        solar_eclipse_gy_revive_target: preference,
      },
      reason: `Solar revives ${best?.name || "a low Dragon"}`,
    };
  }

  if (effect.id === "lunar_eclipse_gy_summon_deck_dragon") {
    if (!optCanUse(ctx, "lunarGy")) {
      return { handled: true, ok: false, reason: "Lunar GY effect already used" };
    }
    if (ctx.fieldCapacity <= 0) {
      return { handled: true, ok: false, reason: "field full" };
    }
    const targets = ctx.deck.filter(isLowDragon);
    if (targets.length === 0) {
      return { handled: true, ok: false, reason: "no low-level Dragon in Deck" };
    }
    const recruit = evaluateDragonRecruitCandidate(targets, ctx);
    if (recruit.blockedAll) {
      return { handled: true, ok: false, reason: recruit.reason };
    }
    return {
      handled: true,
      ok: true,
      priority: 8 + (recruit.best?.name === "Lunar Eclipse Dragon" ? 3 : 1),
      targetPreferences: {
        lunar_eclipse_deck_summon_target: buildDragonRecruitTargetPreference(targets, ctx),
      },
      reason: `Lunar summons ${recruit.best?.name || "a low Dragon"} from Deck`,
    };
  }

  if (card.name === "Stelya, Dragon Tamer" && effect.id === "stelya_graveyard_banish_dragon_summon") {
    const decision = shouldUseStelyaBanishSummon(ctx);
    if (!decision.ok) {
      return { handled: true, ok: false, reason: decision.reason };
    }
    if (!hasStelyaBodyPayoff(ctx)) {
      return {
        handled: true,
        ok: false,
        reason: "Stelya GY summon has no tribute, material, defense, or bridge payoff",
      };
    }
    return {
      handled: true,
      ok: true,
      priority: decision.priority + 2,
      targetPreferences: {
        stelya_graveyard_banish_cost: decision.targetPreference,
      },
      reason: decision.reason,
    };
  }

  return null;
}
