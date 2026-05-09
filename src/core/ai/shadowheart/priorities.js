// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/shadowheart/priorities.js
// Lógica de priorização: spell decisions, summon decisions, safety checks.
//
// RESOURCE CONSERVATION PATTERN:
// - Spells de buff ATK/combat (Battle Hymn, Rage) só ativam em Main Phase 1
// - Evita desperdiçar recursos em Main Phase 2 (pós-Battle)
// - Use analysis.phase para detectar timing apropriado
// ─────────────────────────────────────────────────────────────────────────────

import {
  CARD_KNOWLEDGE,
  isShadowHeartByName,
  isShadowHeart,
} from "./knowledge.js";

const SHADOW_HEART_OFFENSIVE_PAYOFFS = [
  "Polymerization",
  "Shadow-Heart Scale Dragon",
  "Shadow-Heart Demon Arctroth",
  "Shadow-Heart Death Wyrm",
  "Shadow-Heart Leviathan",
  "Shadow-Heart Purge",
  "Shadow-Heart Rage",
  "Shadow-Heart Battle Hymn",
  "The Shadow Heart",
];

const SH = {
  covenant: "Shadow-Heart Covenant",
  cathedral: "Shadow-Heart Cathedral",
  valley: "Darkness Valley",
  poly: "Polymerization",
  infusion: "Shadow-Heart Infusion",
  voidMage: "Shadow-Heart Void Mage",
  imp: "Shadow-Heart Imp",
  gecko: "Shadow-Heart Gecko",
  eel: "Shadow-Heart Abyssal Eel",
  leviathan: "Shadow-Heart Leviathan",
  scale: "Shadow-Heart Scale Dragon",
  arctroth: "Shadow-Heart Demon Arctroth",
  deathWyrm: "Shadow-Heart Death Wyrm",
  griffin: "Shadow-Heart Griffin",
  specter: "Shadow-Heart Specter",
  coward: "Shadow-Heart Coward",
  rage: "Shadow-Heart Rage",
  battleHymn: "Shadow-Heart Battle Hymn",
  demonDragon: "Shadow-Heart Demon Dragon",
  warlord: "Shadow-Heart Warlord",
};

const SHADOW_HEART_STARTERS = [SH.voidMage, SH.imp, SH.eel, SH.gecko];
const LOW_VALUE_DISCARDS = [SH.coward, SH.specter, SH.rage, SH.gecko];

function cardCountByName(cards = []) {
  const counts = new Map();
  for (const card of cards) {
    if (!card?.name) continue;
    counts.set(card.name, (counts.get(card.name) || 0) + 1);
  }
  return counts;
}

function allCards(analysis, zones = ["hand", "field"]) {
  return zones.flatMap((zone) => analysis?.[zone] || []);
}

function hasName(cards = [], name) {
  return cards.some((card) => card?.name === name);
}

function countName(cards = [], name) {
  return cards.filter((card) => card?.name === name).length;
}

function hasShadowHeartStarter(cards = []) {
  return cards.some((card) => SHADOW_HEART_STARTERS.includes(card?.name));
}

function hasLevel8PlusShadowHeart(cards = [], { excludeScale = false } = {}) {
  return cards.some(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      isShadowHeartByName(card.name) &&
      (card.level || 0) >= 8 &&
      (!excludeScale || card.name !== SH.scale),
  );
}

function hasUsefulImpTarget(cards = []) {
  return cards.some(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      isShadowHeartByName(card.name) &&
      (card.level || 0) <= 4 &&
      card.name !== SH.imp,
  );
}

function hasOpponentPressure(analysis) {
  const oppField = analysis?.oppField || [];
  return (
    oppField.length >= 2 ||
    oppField.some((card) => !card?.isFacedown && (card?.atk || 0) >= 2200)
  );
}

function getCandidateByName(candidates = [], names = []) {
  for (const name of names) {
    const match = candidates.find((card) => card?.name === name);
    if (match) return match;
  }
  return null;
}

function getDemonDragonLevel8Target(candidates = [], analysis = {}) {
  const pool = candidates.filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      isShadowHeartByName(card.name) &&
      (card.level || 0) >= 8 &&
      card.name !== SH.scale,
  );
  if (pool.length === 0) return null;
  const preferred = hasOpponentPressure(analysis)
    ? [SH.arctroth, SH.deathWyrm]
    : [SH.deathWyrm, SH.arctroth];
  return getCandidateByName(pool, preferred) || pool[0];
}

export function shouldPreserveScaleForDemonLine(analysis) {
  const cards = allCards(analysis);
  const hasPoly = hasName(analysis?.hand || [], SH.poly);
  const hasScale = hasName(cards, SH.scale);
  const hasLevel8 = hasLevel8PlusShadowHeart(cards, { excludeScale: true });
  const hasNearbySearch =
    hasName(analysis?.hand || [], SH.covenant) && isCovenantLive(analysis);
  const urgentBoard = hasOpponentPressure(analysis) || (analysis?.lp || 8000) <= 2500;

  if (!hasScale || urgentBoard) return false;
  if (hasPoly && hasLevel8) return false;
  if (hasPoly && !hasLevel8) return true;
  return hasNearbySearch;
}

export function chooseCovenantSearchTarget(candidates = [], analysis = {}) {
  const hand = analysis?.hand || [];
  const field = analysis?.field || [];
  const current = [...hand, ...field];
  const hasPoly = hasName(hand, SH.poly);
  const hasScale = hasName(current, SH.scale);
  const hasLevel8 = hasLevel8PlusShadowHeart(current, { excludeScale: true });

  if (hasPoly && !hasScale) {
    const scale = getCandidateByName(candidates, [SH.scale]);
    if (scale) {
      return { card: scale, reason: "complete_demon_dragon_scale" };
    }
  }

  if (hasPoly && hasScale && !hasLevel8) {
    const level8 = getDemonDragonLevel8Target(candidates, analysis);
    if (level8) {
      return { card: level8, reason: "complete_demon_dragon_level8" };
    }
  }

  if (hasName(hand, SH.leviathan) && !hasName(current, SH.eel)) {
    const eel = getCandidateByName(candidates, [SH.eel]);
    if (eel) return { card: eel, reason: "enable_leviathan" };
  }

  if (hasName(hand, SH.imp) && !hasUsefulImpTarget(hand)) {
    const wantsGecko =
      hasPoly ||
      hasScale ||
      hasName(hand, SH.infusion) ||
      !hasLevel8PlusShadowHeart(current, { excludeScale: true });
    const target = getCandidateByName(
      candidates,
      wantsGecko ? [SH.gecko, SH.eel, SH.specter, SH.coward] : [SH.eel, SH.gecko],
    );
    if (target) return { card: target, reason: "enable_imp_line" };
  }

  if (!hasShadowHeartStarter(current)) {
    const hasLineSpell = hand.some((card) =>
      [SH.valley, SH.cathedral, SH.infusion, SH.poly].includes(card?.name),
    );
    const starter = getCandidateByName(
      candidates,
      hasLineSpell ? [SH.imp, SH.voidMage, SH.eel] : [SH.voidMage, SH.imp],
    );
    if (starter) return { card: starter, reason: "find_starter" };
  }

  const fallback = getCandidateByName(candidates, [
    SH.voidMage,
    SH.imp,
    SH.eel,
    SH.gecko,
    SH.scale,
  ]);
  return fallback
    ? { card: fallback, reason: "best_general_starter" }
    : { card: candidates[0] || null, reason: "fallback" };
}

export function chooseVoidMageSearchTarget(candidates = [], analysis = {}) {
  const cards = allCards(analysis);
  const hand = analysis?.hand || [];
  const graveyard = analysis?.graveyard || [];

  if (!analysis?.fieldSpell) {
    const valley = getCandidateByName(candidates, [SH.valley]);
    if (valley) return { card: valley, reason: "establish_valley_engine" };
  }

  if (!hasName(cards, SH.cathedral)) {
    const cathedral = getCandidateByName(candidates, [SH.cathedral]);
    if (cathedral && !hasName(hand, SH.valley)) {
      return { card: cathedral, reason: "early_cathedral_engine" };
    }
  }

  if (
    hasName(cards, SH.scale) &&
    !hasName(hand, SH.rage) &&
    candidates.some((card) => card?.name === SH.rage)
  ) {
    const rage = getCandidateByName(candidates, [SH.rage]);
    return { card: rage, reason: "scale_finisher_setup" };
  }

  const hasInfusionTarget =
    graveyard.some((card) => card?.cardKind === "monster") ||
    hand.some((card) => [SH.scale, SH.arctroth, SH.deathWyrm, SH.gecko].includes(card?.name));
  if (hasInfusionTarget && !hasName(hand, SH.infusion)) {
    const infusion = getCandidateByName(candidates, [SH.infusion]);
    if (infusion) return { card: infusion, reason: "infusion_starter_or_recovery" };
  }

  const fallback = getCandidateByName(candidates, [
    SH.valley,
    SH.cathedral,
    SH.infusion,
    SH.battleHymn,
    SH.rage,
  ]);
  return fallback
    ? { card: fallback, reason: "best_spell_line" }
    : { card: candidates[0] || null, reason: "fallback" };
}

export function chooseGeckoSearchTarget(candidates = [], analysis = {}) {
  const cards = allCards(analysis);
  const hasPoly = hasName(analysis?.hand || [], SH.poly);
  const hasScale = hasName(cards, SH.scale);
  const hasLevel8 = hasLevel8PlusShadowHeart(cards, { excludeScale: true });

  if (hasPoly && !hasScale) {
    const scale = getCandidateByName(candidates, [SH.scale]);
    if (scale) return { card: scale, reason: "gecko_find_scale" };
  }

  if ((hasPoly || hasScale) && !hasLevel8) {
    const level8 = getDemonDragonLevel8Target(candidates, analysis);
    if (level8) return { card: level8, reason: "gecko_find_level8" };
  }

  const target = getCandidateByName(candidates, [SH.scale, SH.arctroth, SH.deathWyrm]);
  return target
    ? { card: target, reason: "gecko_best_level8" }
    : { card: candidates[0] || null, reason: "fallback" };
}

export function chooseImpSpecialTargetName(analysis = {}, candidates = []) {
  const hand = analysis?.hand || [];
  const hasPoly = hasName(hand, SH.poly);
  const hasScale = hasName([...hand, ...(analysis?.field || [])], SH.scale);
  const wantsLv8Search =
    hasPoly ||
    hasScale ||
    hasName(hand, SH.infusion) ||
    !hasLevel8PlusShadowHeart(hand, { excludeScale: true });

  if (wantsLv8Search && candidates.some((card) => card?.name === SH.gecko)) {
    return { name: SH.gecko, reason: "imp_into_gecko_search" };
  }

  if (
    (hasName(hand, SH.leviathan) || (analysis?.oppField || []).length === 0) &&
    candidates.some((card) => card?.name === SH.eel)
  ) {
    return { name: SH.eel, reason: "imp_into_eel_pressure" };
  }

  const fallback = getCandidateByName(candidates, [SH.specter, SH.coward, SH.gecko, SH.eel]);
  return fallback
    ? { name: fallback.name, reason: "imp_defensive_fodder" }
    : { name: null, reason: "fallback" };
}

export function buildShadowHeartTargetPreferences(sourceCard, effect, analysis = {}) {
  const targetPreferences = {};
  const specialSummonPositions = { byName: {} };

  if (sourceCard?.name === SH.imp || effect?.id === "shadow_heart_imp_on_summon") {
    const candidates = (analysis?.hand || []).filter(
      (card) =>
        card &&
        card.cardKind === "monster" &&
        isShadowHeartByName(card.name) &&
        (card.level || 0) <= 4 &&
        card.name !== SH.imp,
    );
    const target = chooseImpSpecialTargetName(analysis, candidates);
    targetPreferences.imp_special_from_hand = {
      role: "named_preference",
      purpose: "combo_extension",
      preferredNames: target.name ? [target.name] : [],
      reason: target.reason,
    };
    if ([SH.gecko, SH.eel].includes(target.name)) {
      specialSummonPositions.byName[target.name] = "attack";
    }
  }

  if (sourceCard?.name === SH.infusion || effect?.id === "shadow_heart_infusion") {
    targetPreferences.infusion_discard = {
      role: "cost",
      intent: "cost",
      purpose: "infusion_starter",
    };
    const bestRevive = chooseInfusionReviveTarget(analysis?.graveyard || [], analysis);
    if (bestRevive?.name) {
      specialSummonPositions.byName[bestRevive.name] =
        bestRevive.position || "defense";
    }
  }

  return {
    targetPreferences,
    specialSummonPositions,
  };
}

function chooseInfusionReviveTarget(candidates = [], analysis = {}) {
  const monsters = candidates.filter(
    (card) => card?.cardKind === "monster" && isShadowHeartByName(card.name),
  );
  if (monsters.length === 0) return null;
  const preferred = getCandidateByName(monsters, [
    SH.scale,
    SH.arctroth,
    SH.deathWyrm,
    SH.gecko,
    SH.eel,
  ]);
  const card = preferred || monsters.slice().sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
  const dependsOnImmediateDamage =
    (analysis?.oppField || []).length === 0 && (analysis?.oppLp || 8000) <= (card?.atk || 0);
  return {
    name: card?.name || null,
    position: dependsOnImmediateDamage ? "defense" : "attack",
  };
}

export function rankShadowHeartSearchCandidates(cards = [], action = {}, ctx = {}) {
  if (!Array.isArray(cards) || cards.length <= 1) return cards || [];
  const player = ctx.player || ctx.strategy?.bot || {};
  const opponent =
    ctx.opponent || ctx.getOpponent?.(ctx.game || {}, player) || {};
  const analysis =
    typeof ctx.strategy?.analyzeGameState === "function"
      ? ctx.strategy.analyzeGameState(ctx.game || { bot: player, player: opponent })
      : {
          hand: player.hand || [],
          field: player.field || [],
          graveyard: player.graveyard || [],
          spellTrap: player.spellTrap || [],
          fieldSpell: player.fieldSpell?.name || null,
          oppField: opponent.field || [],
          oppLp: opponent.lp || 8000,
          lp: player.lp || 8000,
        };
  const sourceName = ctx.source?.name || ctx.ctx?.source?.name || action.sourceName || null;
  let plan = null;

  if (sourceName === SH.covenant) {
    plan = chooseCovenantSearchTarget(cards, analysis);
  } else if (sourceName === SH.voidMage) {
    plan = chooseVoidMageSearchTarget(cards, analysis);
  } else if (sourceName === SH.gecko) {
    plan = chooseGeckoSearchTarget(cards, analysis);
  }

  const preferredName = plan?.card?.name || null;
  if (preferredName && (player.debug || ctx.game?.devModeEnabled)) {
    console.log(
      `[ShadowHeartStrategy] ${sourceName || "Search"} target: ${preferredName} (${plan.reason})`,
    );
  }

  const scoreCard = (card) => {
    let score = CARD_KNOWLEDGE[card?.name]?.value || 0;
    if (card?.name === preferredName) score += 100;
    if (card?.name && (player.hand || []).some((handCard) => handCard?.name === card.name)) {
      score -= 2;
    }
    if (card?.name === SH.covenant && !isCovenantLive(analysis)) score -= 40;
    if (card?.name === SH.scale && shouldPreserveScaleForDemonLine(analysis)) score += 8;
    return score;
  };

  return cards.slice().sort((a, b) => scoreCard(b) - scoreCard(a));
}

export function evaluateShadowHeartRecruitCandidate(candidates = [], context = {}) {
  const cards = Array.isArray(candidates) ? candidates : [];
  const player = context.player || context.strategy?.bot || {};
  const opponent =
    context.opponent || context.strategy?.getOpponent?.(context.game || {}, player) || {};
  const analysis =
    typeof context.strategy?.analyzeGameState === "function"
      ? context.strategy.analyzeGameState(context.game || { bot: player, player: opponent })
      : {
          hand: player.hand || [],
          field: player.field || [],
          graveyard: player.graveyard || [],
          oppField: opponent.field || [],
          oppLp: opponent.lp || 8000,
        };
  const sourceName = context.source?.name || null;

  const scoreCard = (card) => {
    if (!card) return -999;
    let score = CARD_KNOWLEDGE[card.name]?.value || (card.atk || 0) / 1000;
    if (sourceName === SH.infusion) {
      if ([SH.scale, SH.arctroth, SH.deathWyrm].includes(card.name)) score += 40;
      if (card.name === SH.gecko && !hasLevel8PlusShadowHeart(analysis.hand, { excludeScale: true })) {
        score += 30;
      }
      if (analysis?.phase === "main1" && card.cannotAttackThisTurn) score -= 3;
    }
    if (sourceName === SH.cathedral && card.name === SH.eel) score += 10;
    return score;
  };

  const scores = cards
    .map((card) => ({ card, score: scoreCard(card) }))
    .sort((a, b) => b.score - a.score);
  return { best: scores[0]?.card || null, scores };
}

export function isCovenantLive(analysis) {
  const controlledCards =
    (analysis?.field?.length || 0) +
    (analysis?.spellTrap?.length || 0) +
    (analysis?.fieldSpell ? 1 : 0);
  return controlledCards === 0;
}

export function evaluateShadowHeartOffensivePlan(analysis) {
  const hand = analysis?.hand || [];
  const field = analysis?.field || [];
  const graveyard = analysis?.graveyard || [];
  const oppField = analysis?.oppField || [];
  const oppLp = analysis?.oppLp || 0;
  const phase = analysis?.phase || "main1";

  const attackers = field.filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      (isShadowHeart(card) || isShadowHeartByName(card.name)) &&
      !card.isFacedown &&
      card.position === "attack" &&
      !card.cannotAttackThisTurn &&
      !card.hasAttacked,
  );
  const totalAttack = attackers.reduce((sum, card) => sum + (card.atk || 0), 0);
  const directLethal = oppField.length === 0 && totalAttack >= oppLp && oppLp > 0;
  const battleHymnLethal =
    phase !== "main2" &&
    hand.some((card) => card.name === "Shadow-Heart Battle Hymn") &&
    attackers.length > 0 &&
    oppField.length === 0 &&
    totalAttack + attackers.length * 500 >= oppLp &&
    oppLp > 0;

  const scaleOnField = field.find(
    (card) =>
      card?.name === "Shadow-Heart Scale Dragon" &&
      !card.isFacedown &&
      card.position === "attack" &&
      !card.cannotAttackThisTurn,
  );
  const scaleInHand = hand.some((card) => card.name === "Shadow-Heart Scale Dragon");
  const scaleSolo =
    !!scaleOnField &&
    field.filter((card) => card && card.cardKind === "monster").length === 1;
  const rageLive =
    phase !== "main2" &&
    scaleSolo &&
    hand.some((card) => card.name === "Shadow-Heart Rage");

  const purgeWindow =
    phase !== "main2" &&
    hand.some((card) => card.name === "Shadow-Heart Purge") &&
    attackers.length > 0 &&
    oppField.some((target) => {
      if (!target || target.cardKind !== "monster" || target.isFacedown) {
        return false;
      }
      const currentAtk = target.atk || 0;
      const debuffedAtk = Math.max(0, currentAtk - 1000);
      if (currentAtk > 0 && currentAtk <= 1000) return true;
      return attackers.some((attacker) => {
        const atk = attacker.atk || 0;
        const before = atk > currentAtk ? atk - currentAtk : 0;
        const after = atk > debuffedAtk ? atk - debuffedAtk : 0;
        return (atk <= currentAtk && atk > debuffedAtk) || after >= oppLp || after - before >= 1000;
      });
    });

  const allFusionCards = [...hand, ...field];
  const shMonsters = allFusionCards.filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      (isShadowHeart(card) || isShadowHeartByName(card.name)),
  );
  const scaleCount = shMonsters.filter(
    (card) => card.name === "Shadow-Heart Scale Dragon",
  ).length;
  const level8Plus = shMonsters.filter(
    (card) => card.name !== "Shadow-Heart Scale Dragon" && (card.level || 0) >= 8,
  ).length;
  const demonDragonFusionReady = scaleCount > 0 && (level8Plus > 0 || scaleCount >= 2);
  const warlordFusionLikelyReady = shMonsters.length >= 2;
  const fusionNear =
    hand.some((card) => card.name === "Polymerization") &&
    (demonDragonFusionReady || warlordFusionLikelyReady);

  const comebackReady =
    field.length === 0 &&
    hand.some((card) => card.name === "The Shadow Heart") &&
    graveyard.some(
      (card) =>
        card?.cardKind === "monster" &&
        (isShadowHeart(card) || isShadowHeartByName(card.name)),
    );

  const preserveNames = new Set();
  if (fusionNear) {
    preserveNames.add("Polymerization");
    preserveNames.add("Shadow-Heart Scale Dragon");
    preserveNames.add("Shadow-Heart Demon Arctroth");
    preserveNames.add("Shadow-Heart Death Wyrm");
  }
  // Proteger materiais do Demon Dragon mesmo sem Polymerization na mão,
  // para não perder Scale Dragon + Lv8+ antes de sacar Poly.
  const hasDemonDragonSetup =
    scaleCount > 0 &&
    shMonsters.some(
      (c) => c.name !== "Shadow-Heart Scale Dragon" && (c.level || 0) >= 8,
    );
  if (hasDemonDragonSetup) {
    preserveNames.add("Shadow-Heart Scale Dragon");
    preserveNames.add("Shadow-Heart Demon Arctroth");
    preserveNames.add("Shadow-Heart Death Wyrm");
  }
  if (purgeWindow) preserveNames.add("Shadow-Heart Purge");
  if (battleHymnLethal || attackers.length >= 2) {
    preserveNames.add("Shadow-Heart Battle Hymn");
  }
  if (rageLive || scaleOnField || scaleInHand) {
    preserveNames.add("Shadow-Heart Rage");
    preserveNames.add("Shadow-Heart Scale Dragon");
  }
  if (comebackReady || field.length === 0) preserveNames.add("The Shadow Heart");

  return {
    attackers,
    totalAttack,
    directLethal,
    battleHymnLethal,
    rageLive,
    purgeWindow,
    fusionNear,
    comebackReady,
    scaleOnField: !!scaleOnField,
    scaleInHand,
    hasMajorSwing:
      directLethal ||
      battleHymnLethal ||
      rageLive ||
      purgeWindow ||
      fusionNear ||
      comebackReady,
    preserveNames: [...preserveNames],
  };
}

export function buildShadowHeartCostPreferences(analysis) {
  const hand = analysis?.hand || [];
  const handCounts = cardCountByName(hand);
  const offensivePlan = evaluateShadowHeartOffensivePlan(analysis);
  const preferNames = new Set([
    "Shadow-Heart Coward",
    "Shadow-Heart Specter",
  ]);

  const geckoHasClearSpecialLine =
    hand.some((card) => card.name === "Shadow-Heart Imp") ||
    (analysis?.field || []).some((card) => card.name === "Shadow-Heart Imp");
  if (!geckoHasClearSpecialLine) {
    preferNames.add("Shadow-Heart Gecko");
  }

  for (const [name, count] of handCounts.entries()) {
    if (count >= 2) preferNames.add(name);
  }

  const hasScale =
    hand.some((card) => card.name === "Shadow-Heart Scale Dragon") ||
    (analysis?.field || []).some((card) => card.name === "Shadow-Heart Scale Dragon");
  if (!hasScale) {
    preferNames.add("Shadow-Heart Rage");
  }

  if (!isCovenantLive(analysis)) {
    preferNames.add("Shadow-Heart Covenant");
  }

  const preserveNames = new Set(offensivePlan.preserveNames || []);
  if (offensivePlan.hasMajorSwing) {
    for (const name of SHADOW_HEART_OFFENSIVE_PAYOFFS) {
      if (!preferNames.has(name)) preserveNames.add(name);
    }
  }

  return {
    archetype: "Shadow-Heart",
    preferNames: [...preferNames],
    preserveNames: [...preserveNames],
    offensivePayoffNames: SHADOW_HEART_OFFENSIVE_PAYOFFS,
    preserveLastOffensivePayoff: offensivePlan.hasMajorSwing,
    availableOffensivePayoffs: hand.filter((card) =>
      SHADOW_HEART_OFFENSIVE_PAYOFFS.includes(card.name),
    ).length,
    offensivePlan,
  };
}

/**
 * @typedef {Object} SpellDecision
 * @property {boolean} yes
 * @property {number} [priority]
 * @property {string} reason
 */

/**
 * @typedef {Object} SummonDecision
 * @property {boolean} yes
 * @property {string} [position]
 * @property {number} [priority]
 * @property {string} reason
 */

/**
 * Decide se deve jogar uma spell.
 * @param {Object} card
 * @param {Object} analysis
 * @returns {SpellDecision}
 */
export function shouldPlaySpell(card, analysis) {
  const name = card.name;
  const knowledge = CARD_KNOWLEDGE[name];

  // Polymerization - Detecta fusões Shadow-Heart viáveis (não Ascensões!)
  if (name === "Polymerization") {
    const allCards = [...analysis.hand, ...analysis.field];
    const shMonsters = allCards.filter(
      (c) => isShadowHeartByName(c.name) && c.cardKind === "monster"
    );

    // ===== Demon Dragon (priority 14) =====
    // Materiais: 1 "Shadow-Heart Scale Dragon" + 1 monstro Shadow-Heart Level 8+
    const hasScaleDragon = allCards.some(
      (c) => c.name === "Shadow-Heart Scale Dragon"
    );
    const validLevel8Plus = shMonsters.filter((c) => {
      if (c.name === "Shadow-Heart Scale Dragon") return false;
      const level = c.level || 0;
      return level >= 8;
    });
    const scaleCount = allCards.filter(
      (c) => c.name === "Shadow-Heart Scale Dragon"
    ).length;

    if (hasScaleDragon && (validLevel8Plus.length > 0 || scaleCount >= 2)) {
      const materialName =
        validLevel8Plus.length > 0
          ? validLevel8Plus[0].name
          : "Shadow-Heart Scale Dragon";
      return {
        yes: true,
        priority: 17,
        reason: `Fusion: Demon Dragon (3000 ATK, destroy 2) com Scale Dragon + ${materialName}`,
      };
    }

    // ===== Shadow-Heart Warlord (priority 9) =====
    // Materiais: 2 monstros Shadow-Heart quaisquer.
    // Prioridade abaixo de Demon Dragon: se ambas viáveis, Demon Dragon vence.
    if (shMonsters.length >= 2) {
      if (shouldPreserveScaleForDemonLine(analysis)) {
        return {
          yes: false,
          reason:
            "Preservar Scale Dragon para linha proxima de Demon Dragon em vez de Warlord cedo",
        };
      }
      const [m1, m2] = shMonsters;
      return {
        yes: true,
        priority: 9,
        reason: `Fusion: Warlord (2500 ATK, protection + revive) com ${m1.name} + ${m2.name}`,
      };
    }

    return {
      yes: false,
      reason:
        "Sem materiais para fusão Shadow-Heart (Demon Dragon: Scale + Lv8+; Warlord: 2 SH)",
    };
  }

  // Darkness Valley - Primeiro se tiver monstros Shadow-Heart
  if (name === "Darkness Valley") {
    if (analysis.fieldSpell) {
      return { yes: false, reason: "Já tenho field spell" };
    }
    const shMonsters = analysis.hand.filter(
      (c) => isShadowHeartByName(c.name) && c.type === "monster"
    );
    if (
      analysis.field.some((c) => isShadowHeartByName(c.name)) ||
      shMonsters.length > 0
    ) {
      return { yes: true, priority: 10, reason: "Vai buffar meus monstros" };
    }
    return { yes: false, reason: "Sem monstros Shadow-Heart para buffar" };
  }

  // Shadow-Heart Rage - Só com Scale Dragon sozinho
  if (name === "Shadow-Heart Rage") {
    // ⚠️ TIMING: Rage é buff de ATK - só útil antes da Battle Phase
    if (analysis.phase === "main2") {
      return {
        yes: false,
        reason: "Main2: Battle Phase já passou (buff ATK inútil)",
      };
    }

    if (
      analysis.field.length === 1 &&
      analysis.field[0].name === "Shadow-Heart Scale Dragon" &&
      !analysis.field[0].cannotAttackThisTurn
    ) {
      return {
        yes: true,
        priority: 10,
        reason: "OTK potencial com Scale Dragon!",
      };
    }
    return { yes: false, reason: "Scale Dragon não está sozinho ou não pode atacar" };
  }

  // Shadow-Heart Infusion - Avaliação dinâmica de custo/benefício
  if (name === "Shadow-Heart Infusion") {
    if (analysis.hand.length < 3) {
      return { yes: false, reason: "Preciso de 2 cartas para descartar" };
    }
    const shInGY = analysis.graveyard.filter((c) => c.cardKind === "monster");
    const nonInfusionHand = analysis.hand.filter((c) => c.name !== SH.infusion);
    const emergencyReviveCandidate = nonInfusionHand.find(
      (c) =>
        c?.cardKind === "monster" &&
        isShadowHeartByName(c.name) &&
        ([SH.scale, SH.arctroth, SH.deathWyrm, SH.gecko].includes(c.name) ||
          (c.atk || 0) >= 1800),
    );
    const lowValueDiscard = nonInfusionHand.find(
      (c) =>
        LOW_VALUE_DISCARDS.includes(c?.name) ||
        countName(nonInfusionHand, c?.name) > 1,
    );
    const hasBetterNormalLine =
      hasName(analysis.hand, SH.voidMage) ||
      hasName(analysis.hand, SH.imp) ||
      hasName(analysis.hand, SH.eel) ||
      hasName(analysis.hand, SH.valley) ||
      hasName(analysis.hand, SH.cathedral);

    if (
      shInGY.length === 0 &&
      emergencyReviveCandidate &&
      lowValueDiscard &&
      !hasBetterNormalLine
    ) {
      const damagePenalty =
        analysis.phase !== "main2" &&
        (analysis.oppField || []).length === 0 &&
        (analysis.oppLp || 8000) <= (emergencyReviveCandidate.atk || 0);
      return {
        yes: true,
        priority: damagePenalty ? 6 : 8,
        reason: `Starter emergencial: descartar ${emergencyReviveCandidate.name} + ${lowValueDiscard.name} e reviver ${emergencyReviveCandidate.name}`,
      };
    }

    if (shInGY.length === 0) {
      return { yes: false, reason: "Sem Shadow-Heart no GY e sem starter emergencial" };
    }

    // Avaliar valor das cartas na mão (usando CARD_KNOWLEDGE)
    const handValues = analysis.hand
      .filter((c) => c.name !== "Shadow-Heart Infusion")
      .map((c) => ({
        card: c,
        value: CARD_KNOWLEDGE[c.name]?.value || 0,
      }))
      .sort((a, b) => a.value - b.value); // Menor valor primeiro

    // Avaliar valor do revival (melhor monstro no GY)
    const bestRevival = shInGY.sort((a, b) => {
      const valA = CARD_KNOWLEDGE[a.name]?.value || 0;
      const valB = CARD_KNOWLEDGE[b.name]?.value || 0;
      return valB - valA;
    })[0];
    const revivalValue = CARD_KNOWLEDGE[bestRevival.name]?.value || 0;

    // Precisamos descartar 1 carta. Pegar a de MENOR valor.
    const worstCard = handValues[0];
    const discardCost = worstCard.value;

    // Só ativar se o revival vale MAIS que o descarte
    // Bônus: cartas com "discard value" (Specter, Coward)
    const hasValueDiscard =
      worstCard.card.name === "Shadow-Heart Specter" ||
      worstCard.card.name === "Shadow-Heart Coward";
    const netValue = revivalValue - discardCost + (hasValueDiscard ? 1 : 0);

    if (netValue > 0) {
      return {
        yes: true,
        priority: hasValueDiscard ? 8 : 6,
        reason: `Reviver ${bestRevival.name} (val:${revivalValue}) > descartar ${worstCard.card.name} (val:${discardCost})`,
      };
    }

    return {
      yes: false,
      reason: `Revival ${bestRevival.name} (${revivalValue}) NÃO vale descartar ${worstCard.card.name} (${discardCost})`,
    };
  }

  // Shadow-Heart Covenant - Searcher genérico (custo: 800 LP)
  if (name === "Shadow-Heart Covenant") {
    if (!isCovenantLive(analysis)) {
      return {
        yes: false,
        reason: "Covenant requer controlar nenhum outro card",
      };
    }

    // Prioridade MÁXIMA em T1-T2 para buscar peças antes de outras ações
    const turnCounter = analysis.game?.turnCounter || 0;
    const isEarlyGame = turnCounter <= 2;

    // Threshold reduzido: 1200 LP (800 custo + 400 margem mínima)
    if (analysis.lp <= 1200) {
      return {
        yes: false,
        reason: `LP crítico (${analysis.lp}) para pagar 800`,
      };
    }

    const searchPlan = chooseCovenantSearchTarget([], analysis);

    // Em T1-T2, SEMPRE ativar antes de qualquer desenvolvimento de board
    // Garante buscar peças ANTES de fazer fusion
    if (isEarlyGame) {
      return {
        yes: true,
        priority: 24,
        reason: `T${turnCounter}: Buscar peça PRIMEIRO (setup ideal)`,
      };
    }

    if (!isEarlyGame) {
      return {
        yes: true,
        priority: 21,
        reason: `Buscar peca chave antes de desenvolver board (${searchPlan.reason})`,
      };
    }

    // T3+: Priority normal (7), sem bloqueio por LP
    return { yes: true, priority: 7, reason: "Buscar peça chave do combo" };
  }

  // Shadow-Heart Cathedral - long-term engine; Covenant still outranks it.
  if (name === "Shadow-Heart Cathedral") {
    const alreadyActive =
      analysis.spellTrap.some((c) => c?.name === SH.cathedral) ||
      analysis.field.some((c) => c?.name === SH.cathedral);
    if (alreadyActive) {
      return { yes: false, reason: "Cathedral ja esta ativa" };
    }
    return {
      yes: true,
      priority: 15,
      reason: "Engine cedo para acumular Judgment Counters",
    };
  }

  // Shadow-Heart Battle Hymn - Buff em monstros Shadow-Heart
  if (name === "Shadow-Heart Battle Hymn") {
    // ⚠️ TIMING: Battle Hymn só é útil ANTES da Battle Phase
    // Se estamos em main2, já passou a battle phase - desperdiçar recurso!
    if (analysis.phase === "main2") {
      return {
        yes: false,
        reason: "Main2: Battle Phase já passou (buff inútil)",
      };
    }

    const shOnField = analysis.field.filter(
      (c) => isShadowHeartByName(c.name) && !c.cannotAttackThisTurn,
    );

    if (shOnField.length === 0) {
      return { yes: false, reason: "Sem Shadow-Heart que possa atacar este turno" };
    }

    // Calcular potencial de dano com buff
    const totalATKBuff = shOnField.length * 500;
    const oppLP = analysis.oppLp || 8000;
    const currentATK = shOnField.reduce((sum, m) => sum + (m.atk || 0), 0);
    const buffedATK = currentATK + totalATKBuff;
    const canPushLethal = analysis.oppField.length === 0 && buffedATK >= oppLP;

    // Se pode fazer lethal com o buff, usar mesmo com 1 monstro
    if (canPushLethal) {
      return {
        yes: true,
        priority: 12,
        reason: `+${totalATKBuff} ATK total = ${buffedATK} ATK (LETHAL!)`,
      };
    }

    // Senão, exigir 2+ monstros para não desperdiçar
    if (shOnField.length >= 2) {
      const priority = totalATKBuff >= oppLP / 2 ? 8 : 5;
      return {
        yes: true,
        priority,
        reason: `+500 ATK para ${shOnField.length} monstros${
          totalATKBuff >= oppLP / 2 ? " (LETHAL PUSH)" : ""
        }`,
      };
    }

    return {
      yes: false,
      reason: "Preciso de 2+ Shadow-Heart no campo (ou lethal opportunity)",
    };
  }

  // Shadow-Heart Purge - conditional debuff/removal
  if (name === "Shadow-Heart Purge") {
    const shadowHeartCardsInHand = analysis.hand.filter(
      (c) => isShadowHeart(c) || isShadowHeartByName(c.name),
    );
    const discardAvailable =
      shadowHeartCardsInHand.length > (isShadowHeartByName(card.name) ? 1 : 0);
    if (!discardAvailable) {
      return { yes: false, reason: "Sem Shadow-Heart para descartar" };
    }

    const faceUpOpponents = analysis.oppField.filter(
      (c) => c && c.cardKind === "monster" && !c.isFacedown,
    );
    if (faceUpOpponents.length === 0) {
      return { yes: false, reason: "Oponente sem monstros face-up" };
    }

    const zeroableTarget = faceUpOpponents
      .filter((c) => (c.atk || 0) > 0 && (c.atk || 0) <= 1000)
      .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];

    if (zeroableTarget) {
      const targetATK = zeroableTarget.atk || 0;
      return {
        yes: true,
        priority: targetATK >= 800 ? 7 : 5,
        reason: `Purge zera e destroi ${zeroableTarget.name || "alvo"} (${targetATK} ATK)`,
      };
    }

    if (analysis.phase === "main2") {
      return {
        yes: false,
        reason: "Main2: debuff temporario sem remocao seria desperdicado",
      };
    }

    const attackers = analysis.field.filter(
      (c) =>
        c &&
        c.cardKind === "monster" &&
        (isShadowHeart(c) || isShadowHeartByName(c.name)) &&
        !c.isFacedown &&
        c.position === "attack" &&
        !c.cannotAttackThisTurn &&
        !c.hasAttacked,
    );

    if (attackers.length === 0) {
      return {
        yes: false,
        reason: "Sem atacante Shadow-Heart pronto para aproveitar o debuff",
      };
    }

    const attackTargets = faceUpOpponents.filter(
      (target) => target.position !== "defense",
    );
    const combatSwing = attackTargets.some((target) => {
      const currentAtk = target.atk || 0;
      const debuffedAtk = Math.max(0, currentAtk - 1000);
      return attackers.some((attacker) => {
        const atk = attacker.atk || 0;
        return atk <= currentAtk && atk > debuffedAtk;
      });
    });

    if (combatSwing) {
      return {
        yes: true,
        priority: 6,
        reason: "Purge abre uma troca de batalha favoravel neste turno",
      };
    }

    const relevantDamage = attackTargets.some((target) => {
      const currentAtk = target.atk || 0;
      const debuffedAtk = Math.max(0, currentAtk - 1000);
      return attackers.some((attacker) => {
        const atk = attacker.atk || 0;
        const before = atk > currentAtk ? atk - currentAtk : 0;
        const after = atk > debuffedAtk ? atk - debuffedAtk : 0;
        return after >= analysis.oppLp || after - before >= 1000;
      });
    });

    if (relevantDamage) {
      return {
        yes: true,
        priority: 4,
        reason: "Purge aumenta dano relevante antes da batalha",
      };
    }

    return {
      yes: false,
      reason: "Nenhum alvo gera remocao ou ganho real de combate",
    };
  }

  // Shadow-Heart Shield - Proteção flexível (não só boss)
  if (name === "Shadow-Heart Shield") {
    // Verificar se há monstros face-up disponíveis
    const hasFaceUpMonsters = analysis.field.some(
      (c) => c.cardKind === "monster" && !c.isFacedown
    );

    if (!hasFaceUpMonsters) {
      return { yes: false, reason: "Sem monstros face-up para equipar" };
    }

    const hasBoss = analysis.field.some(
      (c) =>
        !c.isFacedown &&
        [
          "Shadow-Heart Scale Dragon",
          "Shadow-Heart Demon Arctroth",
          "Shadow-Heart Demon Dragon",
        ].includes(c.name)
    );

    const strongBody = analysis.field.some(
      (c) => !c.isFacedown && (c.atk || 0) >= 1800
    );

    const anyMonster = analysis.field.some(
      (c) => c.cardKind === "monster" && !c.isFacedown
    );

    if (hasBoss) {
      return { yes: true, priority: 5, reason: "Proteger boss com shield" };
    }

    if (strongBody) {
      return {
        yes: true,
        priority: 4,
        reason: "Proteger atacante/defensor >1800 ATK",
      };
    }

    if (anyMonster && analysis.oppField.some((m) => (m.atk || 0) > 0)) {
      return {
        yes: true,
        priority: 3,
        reason: "Proteger board pequeno de troca ruim",
      };
    }

    return { yes: false, reason: "Sem alvo útil para o shield" };
  }

  // The Shadow Heart - Comeback card (requer campo vazio)
  if (name === "The Shadow Heart") {
    // Só ativar se campo estiver vazio (requisito da carta)
    if (analysis.field.length > 0) {
      return { yes: false, reason: "Requer campo vazio para ativar" };
    }

    // Verificar se há Shadow-Heart no cemitério
    const shInGY = analysis.graveyard.filter(
      (c) => c.cardKind === "monster" && isShadowHeartByName(c.name)
    );

    if (shInGY.length === 0) {
      return { yes: false, reason: "Sem Shadow-Heart no GY para reviver" };
    }

    // Priorizar se há boss no cemitério
    const hasBossInGY = shInGY.some((c) =>
      [
        "Shadow-Heart Scale Dragon",
        "Shadow-Heart Demon Arctroth",
        "Shadow-Heart Leviathan",
        "Shadow-Heart Death Wyrm",
      ].includes(c.name)
    );

    const targetName = shInGY[0].name;
    const targetATK = shInGY[0].atk || 0;

    if (hasBossInGY) {
      return {
        yes: true,
        priority: 11,
        reason: `COMEBACK! Reviver ${targetName} (${targetATK} ATK) após board wipe`,
      };
    }

    // Se não há boss, mas há monstro médio/alto ATK, ainda vale
    if (targetATK >= 1800) {
      return {
        yes: true,
        priority: 9,
        reason: `Reviver ${targetName} (${targetATK} ATK) - recovery sólido`,
      };
    }

    // Monstro fraco só se não tiver outra opção
    return {
      yes: true,
      priority: 6,
      reason: `Reviver ${targetName} (última opção)`,
    };
  }

  // Spells genéricos com knowledge
  if (knowledge) {
    return {
      yes: true,
      priority: knowledge.priority || 3,
      reason: "Spell utilizável",
    };
  }

  return { yes: true, priority: 3, reason: "Spell genérica" };
}

/**
 * Decide se deve invocar um monstro.
 * @param {Object} card
 * @param {Object} analysis
 * @param {Object} tributeInfo - { tributesNeeded, alt }
 * @param {Object} [context]
 * @returns {SummonDecision}
 */
export function shouldSummonMonster(card, analysis, tributeInfo, context = {}) {
  const name = card.name;
  const knowledge = CARD_KNOWLEDGE[name];
  const fieldState = context.field || analysis?.field || [];
  const oppFieldState = context.oppField || analysis?.oppField || [];

  // === SAFETY CHECK: Avaliar se é seguro summon em ATK ===
  const cardATK = card.atk || 0;
  const cardDEF = card.def || 0;
  const oppStrongestATK = analysis.oppField.reduce(
    (max, m) => Math.max(max, m.atk || 0),
    0
  );
  const oppHasThreats = analysis.oppField.length > 0;

  // Se oponente tem monstro mais forte, não summon em ATK (só se for extender/combo)
  const isSuicideSummon =
    oppHasThreats && cardATK < oppStrongestATK && cardATK > 0;
  const shouldDefensivePosition = isSuicideSummon && cardDEF >= cardATK;

  // Imp - Extender de alta prioridade
  if (name === "Shadow-Heart Imp") {
    const hasTarget = analysis.hand.some(
      (c) =>
        isShadowHeartByName(c.name) &&
        c.type === "monster" &&
        (c.level || 0) <= 4 &&
        c.name !== "Shadow-Heart Imp"
    );
    if (hasTarget) {
      if (isSuicideSummon && !shouldDefensivePosition) {
        return {
          yes: false,
          reason: `Imp seria destruído por ${oppStrongestATK} ATK oponente`,
        };
      }
      return {
        yes: true,
        position: shouldDefensivePosition ? "defense" : "attack",
        priority: 10,
        reason: "Extender para 2 corpos",
      };
    }
    if (isSuicideSummon) {
      return {
        yes: false,
        reason: `Imp 1500 ATK vs oponente ${oppStrongestATK} ATK = suicide`,
      };
    }
    return {
      yes: true,
      position: "attack",
      priority: 4,
      reason: "Beater de 1500",
    };
  }

  // Leviathan - Boss 2600 ATK com efeitos de burn
  if (name === "Shadow-Heart Leviathan") {
    if (tributeInfo.tributesNeeded > analysis.field.length) {
      return {
        yes: false,
        reason: `Requer ${tributeInfo.tributesNeeded} tributos (tenho ${analysis.field.length})`,
      };
    }
    const hasLeviathanLine =
      hasName(analysis.hand, SH.leviathan) ||
      (analysis.oppField || []).length === 0 ||
      (analysis.game?.turnCounter || 0) <= 2;
    return {
      yes: true,
      position: "attack",
      priority: hasLeviathanLine ? 9 : 8,
      reason: hasLeviathanLine
        ? "Pressao e linha Eel -> Leviathan"
        : "Boss 2600 ATK + burn damage",
    };
  }

  // Griffin - 2000 ATK, pode invocar sem tributo sob certas condições
  if (name === "Shadow-Heart Griffin") {
    // Griffin tem altTribute que permite invocar com menos tributos
    const actualTributes = tributeInfo.usingAlt
      ? tributeInfo.alt.tributes
      : tributeInfo.tributesNeeded;
    if (actualTributes > analysis.field.length) {
      return {
        yes: false,
        reason: `Requer ${actualTributes} tributos (tenho ${analysis.field.length})`,
      };
    }
    if (actualTributes > 0) {
      const tradeCheck = evaluateTributeTrade(
        card,
        fieldState,
        actualTributes,
        { oppField: oppFieldState }
      );
      if (!tradeCheck.ok) {
        return {
          yes: false,
          reason: tradeCheck.reason,
        };
      }
    }
    return {
      yes: true,
      position: "attack",
      priority: 7,
      reason: actualTributes === 0 ? "2000 ATK sem tributo!" : "2000 ATK",
    };
  }

  // Specter - Recursivo (adiciona do GY à mão)
  if (name === "Shadow-Heart Specter") {
    const hasGYTargets = analysis.graveyard.filter(
      (c) => isShadowHeartByName(c.name) && c.name !== "Shadow-Heart Specter"
    );
    if (hasGYTargets.length > 0) {
      return {
        yes: true,
        position: shouldDefensivePosition ? "defense" : "attack",
        priority: 5,
        reason: "Recursão: adiciona Shadow-Heart do GY à mão",
      };
    }
    return {
      yes: true,
      position: "defense",
      priority: 2,
      reason: "1800 ATK (setup futuro para recursão)",
    };
  }

  // Void Mage - Searcher de spell/trap com prioridade alta
  if (name === "Shadow-Heart Void Mage") {
    // Prioridade alta T1 ou quando não temos spells-chave
    const hasKeySpells = analysis.hand.some((c) =>
      [
        "Darkness Valley",
        "Shadow-Heart Covenant",
        "Shadow-Heart Shield",
      ].includes(c.name)
    );
    const hasDarknessValley = (analysis.spellTrapZone || []).some(
      (c) => c.name === "Darkness Valley"
    );

    if (!hasDarknessValley && !hasKeySpells) {
      // Altíssima prioridade se não temos setup
      // SEMPRE face-up para disparar efeito de busca (on_event after_summon requires face-up)
      // REGRA: facedown só existe com position="defense", então invocamos em attack para efeito
      const needsDefense = isSuicideSummon && shouldDefensivePosition;
      return {
        yes: true,
        // Se precisamos de defesa, invocamos em attack mesmo assim para buscar
        // O efeito de busca é mais importante que sobreviver
        position: "attack",
        priority: 13,
        reason: "Buscar spell-chave (Darkness Valley/Covenant/Shield)",
      };
    }

    // Prioridade média se já temos spells
    if (isSuicideSummon) {
      // Se já temos as spells, podemos setar em defesa (facedown)
      // Nesse caso perdemos o efeito de busca, mas já temos o que precisamos
      return {
        yes: shouldDefensivePosition,
        position: "defense",
        // REGRA DO JOGO: defense = sempre facedown
        priority: shouldDefensivePosition ? 12 : 0,
        reason: shouldDefensivePosition
          ? "Searcher em DEF (set)"
          : "Void Mage seria destruído",
      };
    }

    return {
      yes: true,
      position: "attack",
      priority: 12,
      reason: "Searcher de spells + draw engine",
    };
  }

  // Scale Dragon - Boss principal
  if (name === "Shadow-Heart Scale Dragon") {
    if (tributeInfo.tributesNeeded <= analysis.field.length) {
      return {
        yes: true,
        position: "attack",
        priority: 10,
        reason: "Boss de 3000 ATK!",
      };
    }
  }

  // Demon Arctroth - Boss com remoção
  if (name === "Shadow-Heart Demon Arctroth") {
    if (
      tributeInfo.tributesNeeded <= analysis.field.length &&
      analysis.oppField.length > 0
    ) {
      // PRIORIDADE ALTA: Ameaça battle-indestructible que só pode ser removida por efeito
      const hasBattleIndestructible = analysis.oppField.some(
        (m) => m.battleIndestructible || m.cannotBeDestroyedByBattle
      );

      if (hasBattleIndestructible) {
        return {
          yes: true,
          position: "attack",
          priority: 15, // Prioridade muito alta - única forma de remover
          reason: "Remover ameaça battle-indestructible (única solução)",
        };
      }

      // Verificar se já temos lethal com os monstros atuais
      const fieldMonsters = analysis.field.filter(
        (c) => c?.cardKind === "monster"
      );
      const totalCurrentATK = fieldMonsters.reduce(
        (sum, m) => sum + (m.atk || 0),
        0
      );
      const oppTotalDEF = analysis.oppField.reduce((sum, m) => {
        const isDefense = m.position === "defense";
        return sum + (isDefense ? m.def || 0 : m.atk || 0);
      }, 0);
      const potentialDamage = Math.max(0, totalCurrentATK - oppTotalDEF);

      // Se já temos lethal com o campo atual, não tributar desnecessariamente
      if (potentialDamage >= analysis.oppLp && fieldMonsters.length > 0) {
        return {
          yes: false,
          reason: `Já tenho lethal com campo atual (${potentialDamage} dano >= ${analysis.oppLp} LP)`,
        };
      }

      // Se tributos reduzem muito ATK, só invocar se realmente necessário
      const tributeATK = fieldMonsters
        .slice(0, tributeInfo.tributesNeeded)
        .reduce((sum, m) => sum + (m.atk || 0), 0);
      const summonATK = card.atk || 0;
      const atkLoss = tributeATK - summonATK;

      if (atkLoss > 1000) {
        // Perdendo muito ATK no trade, só vale se remove ameaça crítica
        const strongestThreat = analysis.oppField.reduce(
          (max, c) => ((c.atk || 0) > (max.atk || 0) ? c : max),
          { atk: 0 }
        );
        if ((strongestThreat.atk || 0) < 2000) {
          return {
            yes: false,
            reason: `Perderia ${atkLoss} ATK tributando, ameaça não é crítica`,
          };
        }
      }

      return {
        yes: true,
        position: "attack",
        priority: 9,
        reason: "Destruir monstro oponente + 2600 ATK",
      };
    }
  }

  // Griffin - Sem tributo se campo vazio
  if (name === "Shadow-Heart Griffin") {
    if (analysis.field.length === 0) {
      return {
        yes: true,
        position: "attack",
        priority: 8,
        reason: "2000 ATK sem tributo!",
      };
    }
  }

  // Gecko - Draw engine
  if (name === "Shadow-Heart Gecko") {
    if (analysis.field.some((c) => (c.atk || 0) >= 1800)) {
      if (isSuicideSummon) {
        return {
          yes: true,
          position: "defense",
          priority: 4,
          reason: "Draw engine (defesa por safety)",
        };
      }
      return {
        yes: true,
        position: "attack",
        priority: 5,
        reason: "Draw engine passivo",
      };
    }
  }

  // Specter - Recursão
  if (name === "Shadow-Heart Specter") {
    if (analysis.graveyard.length > 0) {
      if (isSuicideSummon && !shouldDefensivePosition) {
        return {
          yes: false,
          reason: `Specter 1500 ATK seria destruído por ${oppStrongestATK} ATK`,
        };
      }
      return {
        yes: true,
        position: shouldDefensivePosition ? "defense" : "attack",
        priority: 5,
        reason: "Futuro recurso de GY",
      };
    }
  }

  // Abyssal Eel - CASO ESPECÍFICO (1600 ATK burn)
  if (name === "Shadow-Heart Abyssal Eel") {
    if (isSuicideSummon) {
      return {
        yes: false,
        reason: `Eel 1600 ATK vs oponente ${oppStrongestATK} ATK = perda de monstro + burn inútil`,
      };
    }
    const hasLeviathanInHand = hasName(analysis.hand, SH.leviathan);
    const pressureLine =
      hasLeviathanInHand ||
      (analysis.oppField || []).length === 0 ||
      (analysis.game?.turnCounter || 0) <= 2;
    return {
      yes: true,
      position: "attack",
      priority: pressureLine ? 8 : 5,
      reason: pressureLine
        ? "Starter de pressao e ponte para Leviathan"
        : "Beater 1600 + burn",
    };
  }

  // Monstro genérico
  const baseAtk = card.atk || 0;
  if (baseAtk >= 1500 && tributeInfo.tributesNeeded === 0) {
    if (isSuicideSummon) {
      if (shouldDefensivePosition) {
        return {
          yes: true,
          position: "defense",
          priority: 3,
          reason: `DEF ${cardDEF} vs oponente ${oppStrongestATK} ATK`,
        };
      }
      return {
        yes: false,
        reason: `${baseAtk} ATK vs oponente ${oppStrongestATK} ATK = suicide`,
      };
    }
    return {
      yes: true,
      position: "attack",
      priority: 4,
      reason: `Beater de ${baseAtk}`,
    };
  }

  if (
    tributeInfo.tributesNeeded > 0 &&
    tributeInfo.tributesNeeded <= fieldState.length
  ) {
    const tradeCheck = evaluateTributeTrade(
      card,
      fieldState,
      tributeInfo.tributesNeeded,
      { oppField: oppFieldState }
    );
    if (!tradeCheck.ok) {
      return {
        yes: false,
        reason: tradeCheck.reason,
      };
    }
    return {
      yes: true,
      position: "attack",
      priority: 5,
      reason: `Tribute Summon de ${baseAtk}`,
    };
  }

  // Monstro fraco em defesa
  if (baseAtk < 1500) {
    return {
      yes: true,
      position: "defense",
      priority: 2,
      reason: "Defesa/material",
    };
  }

  return { yes: false, reason: "Não vale a pena agora" };
}

/**
 * Avalia melhor tributos para um Tribute Summon.
 * Menor valor = melhor tributo.
 * @param {Array} field
 * @param {number} tributesNeeded
 * @param {Object} [cardToSummon]
 * @param {Object} [context] - Contexto adicional (oppField, game state)
 * @returns {number[]} Índices dos monstros a tributar
 */
export function selectBestTributes(
  field,
  tributesNeeded,
  cardToSummon = null,
  context = {}
) {
  if (tributesNeeded <= 0 || !field || field.length < tributesNeeded) {
    return [];
  }

  // CASO ESPECIAL: Demon Arctroth vs battle-indestructible
  // Permitir tributar monstros mais fortes se for a única forma de remover ameaça
  const isDemonArctroth = cardToSummon?.name === "Shadow-Heart Demon Arctroth";
  const hasBattleIndestructibleThreat = context.oppField?.some(
    (m) => m.battleIndestructible || m.cannotBeDestroyedByBattle
  );
  const isEmergencyRemoval = isDemonArctroth && hasBattleIndestructibleThreat;

  const monstersWithValue = field.map((monster, index) => {
    const value = getTributeValue(monster, { isEmergencyRemoval });
    return { monster, index, value };
  });

  monstersWithValue.sort((a, b) => a.value - b.value);
  return monstersWithValue.slice(0, tributesNeeded).map((t) => t.index);
}


function getTributeValue(monster, context = {}) {
  const isEmergencyRemoval = !!context.isEmergencyRemoval;
  let value = 0;
  const knowledge = CARD_KNOWLEDGE[monster.name];

  value += (monster.atk || 0) / 400;
  value += (monster.level || 0) * 0.15;

  if (monster.name === "Shadow-Heart Demon Dragon") {
    value += isEmergencyRemoval ? 40 : 100;
  }

  if (monster.name === "Shadow-Heart Scale Dragon") {
    value += isEmergencyRemoval ? 35 : 80;
  }

  if (monster.name === "Shadow-Heart Demon Arctroth") {
    value += isEmergencyRemoval ? 30 : 70;
  }

  if (monster.name === "Shadow-Heart Death Wyrm") {
    value += isEmergencyRemoval ? 20 : 50;
  }

  if (monster.name === "Shadow-Heart Leviathan") {
    value += isEmergencyRemoval ? 18 : 45;
  }

  if (
    knowledge?.role === "boss" ||
    knowledge?.role === "fusion_boss" ||
    knowledge?.role === "ascension_boss"
  ) {
    value += isEmergencyRemoval ? 25 : 60;
  }

  if (knowledge?.ascensionTarget) {
    value += isEmergencyRemoval ? 20 : 50;
  }

  if (monster.name === "Shadow-Heart Griffin") value += 3;
  if (monster.name === "Shadow-Heart Gecko") value += 2;

  if (monster.name === "Shadow-Heart Specter") value -= 5;

  if (monster.isToken || monster.name.includes("Token")) value -= 10;

  if (monster.hasAttacked) value -= 2;

  return value;
}

export function evaluateTributeTrade(
  cardToSummon,
  field,
  tributesNeeded,
  context = {}
) {
  if (!cardToSummon || tributesNeeded <= 0) {
    return { ok: true };
  }

  const fieldMonsters = (field || []).filter(
    (card) => card && card.cardKind !== "spell" && card.cardKind !== "trap"
  );
  if (fieldMonsters.length < tributesNeeded) {
    return { ok: false, reason: "Tributos insuficientes" };
  }

  const isDemonArctroth = cardToSummon?.name === "Shadow-Heart Demon Arctroth";
  const hasBattleIndestructibleThreat = context.oppField?.some(
    (m) => m.battleIndestructible || m.cannotBeDestroyedByBattle
  );
  const isEmergencyRemoval = isDemonArctroth && hasBattleIndestructibleThreat;

  const tributeIndices = selectBestTributes(
    fieldMonsters,
    tributesNeeded,
    cardToSummon,
    context
  );

  if (tributeIndices.length < tributesNeeded) {
    return { ok: false, reason: "Sem tributos validos" };
  }

  const tributes = tributeIndices
    .map((index) => fieldMonsters[index])
    .filter(Boolean);

  const tributeCost = tributes.reduce(
    (sum, monster) => sum + getTributeValue(monster, { isEmergencyRemoval }),
    0
  );
  const summonValue = getTributeValue(cardToSummon, {});

  const knowledge = CARD_KNOWLEDGE[cardToSummon?.name];
  const summonIsPremium =
    knowledge?.role === "boss" ||
    knowledge?.role === "fusion_boss" ||
    knowledge?.role === "ascension_boss";

  const tributeHasPremium = tributes.some((monster) => {
    const tribKnowledge = CARD_KNOWLEDGE[monster.name];
    const tribIsPremium =
      tribKnowledge?.role === "boss" ||
      tribKnowledge?.role === "fusion_boss" ||
      tribKnowledge?.role === "ascension_boss" ||
      tribKnowledge?.ascensionTarget;
    return (
      tribIsPremium ||
      monster.name === "Shadow-Heart Demon Dragon" ||
      monster.name === "Shadow-Heart Scale Dragon" ||
      monster.name === "Shadow-Heart Demon Arctroth"
    );
  });

  if (tributeHasPremium && !summonIsPremium) {
    return {
      ok: false,
      reason: "Nao vale tributar boss para invocar monstro menor",
    };
  }

  const costRatio = tributeCost / Math.max(1, summonValue);
  const costDelta = tributeCost - summonValue;
  const badValueTrade = costDelta >= 25 && costRatio >= 1.4;

  if (badValueTrade) {
    return {
      ok: false,
      reason: "Tribute Summon com custo alto demais",
    };
  }

  return { ok: true };
}

/**
 * Calcula requisito de tributos para um card.
 * @param {Object} card
 * @param {Object} playerState
 * @returns {{ tributesNeeded: number, alt: Object|null }}
 */
export function getTributeRequirementFor(card, playerState) {
  let tributesNeeded = 0;
  if (card.level >= 5 && card.level <= 6) tributesNeeded = 1;
  else if (card.level >= 7) tributesNeeded = 2;

  if (
    typeof card.requiredTributes === "number" &&
    card.requiredTributes >= 0
  ) {
    tributesNeeded = card.requiredTributes;
  }

  // Alt tribute conditions
  const alt = card.altTribute;
  if (
    alt?.type === "no_tribute_if_empty_field" &&
    (playerState.field?.length || 0) === 0
  ) {
    tributesNeeded = 0;
  }

  return { tributesNeeded, alt };
}
