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
import { cardHasRelevantTriggerForSummonMethod } from "../common/analysis.js";
import {
  countDestroyableByAtk,
  getEffectiveAtk,
  getEffectiveDef,
  getStrongestBattleStat,
} from "../common/cardStats.js";
import { getCounterCount } from "../common/counters.js";
import {
  createFinisherPlan,
  rankFinisherPlans,
} from "../common/finisherPlans.js";
import {
  assessSummonEntry,
  evaluateProjectedAttackLine,
} from "../common/summonAssessment.js";
import {
  assessShadowHeartResourceRecovery,
  buildShadowHeartResourcePreferences,
} from "./resourceEconomy.js";

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
const SHADOW_HEART_BOSS_SUMMON_NAMES = new Set([
  SH.scale,
  SH.arctroth,
  SH.deathWyrm,
  SH.leviathan,
  SH.demonDragon,
  SH.warlord,
]);
const SHADOW_HEART_ENGINE_SUMMON_NAMES = new Set([
  SH.voidMage,
  SH.imp,
  SH.gecko,
  SH.specter,
  SH.coward,
  SH.eel,
]);

function getCardName(value) {
  return typeof value === "string" ? value : value?.name || null;
}

function hasActiveOwnFieldSpell(context = {}, name) {
  const candidates = [
    context.fieldSpell,
    context.analysis?.fieldSpell,
    context.player?.fieldSpell,
    context.bot?.fieldSpell,
  ];
  return candidates.some((candidate) => getCardName(candidate) === name);
}

function isDragonType(card) {
  if (!card) return false;
  const requiredType = "dragon";
  if (Array.isArray(card.types)) {
    return card.types.some(
      (type) => String(type || "").toLowerCase() === requiredType,
    );
  }
  return String(card.type || "").toLowerCase() === requiredType;
}

function isShadowHeartDragon(card) {
  return (
    card?.cardKind === "monster" &&
    !card.isFacedown &&
    isDragonType(card) &&
    (isShadowHeart(card) || isShadowHeartByName(card.name))
  );
}

function sameCardInstance(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.instanceId && b.instanceId) return a.instanceId === b.instanceId;
  return false;
}

function isAlreadyOnOwnField(card, context = {}) {
  const field =
    context.myField ||
    context.player?.field ||
    context.bot?.field ||
    context.analysis?.field ||
    [];
  return (field || []).some((fieldCard) => sameCardInstance(card, fieldCard));
}

function hasNamedAtkBuff(card, sourceName) {
  return Number(card?.permanentBuffsBySource?.[sourceName]?.atk || 0) > 0;
}

function projectShadowHeartEntryStats(card, context = {}, stats = {}) {
  const projected = {
    atk: stats.atk ?? getEffectiveAtk(card),
    def: stats.def ?? getEffectiveDef(card),
  };

  if (!isShadowHeartByName(card?.name)) return projected;
  if (!hasActiveOwnFieldSpell(context, SH.valley)) return projected;
  if (isAlreadyOnOwnField(card, context)) return projected;
  if (hasNamedAtkBuff(card, SH.valley)) return projected;

  return {
    ...projected,
    atk: projected.atk + 300,
  };
}

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

function isReadyShadowHeartAttacker(card) {
  return (
    card &&
    card.cardKind === "monster" &&
    isShadowHeartByName(card.name) &&
    !card.isFacedown &&
    card.position === "attack" &&
    !card.cannotAttackThisTurn &&
    !card.hasAttacked
  );
}

function getCathedralDeckCandidates(analysis = {}, counterCount = 0) {
  const maxAtk = counterCount * 500;
  if (maxAtk <= 0) return [];
  return (analysis.deck || []).filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      isShadowHeartByName(card.name) &&
      (card.atk || 0) <= maxAtk,
  );
}

function hasUsefulCathedralTargetInDeck(analysis = {}, counterCount = 1) {
  return chooseCathedralSummonTarget(
    getCathedralDeckCandidates(analysis, counterCount),
    analysis,
  ).card;
}

function getCathedralCounterCost(card) {
  return Math.max(1, Math.ceil((card?.atk || 0) / 500));
}

function getCathedralCandidateNames(cards = []) {
  return cards.filter(Boolean).map((card) => card.name).filter(Boolean);
}

function roundPriority(score) {
  return Math.round((score || 0) * 10) / 10;
}

function getCathedralBodyPlan(card, analysis = {}) {
  const name = card?.name;
  const hand = analysis.hand || [];
  const field = analysis.field || [];
  const graveyard = analysis.graveyard || [];
  const extraDeck = analysis.extraDeck || [];
  const hasSpecterRecycle =
    name === SH.specter &&
    graveyard.some(
      (graveCard) =>
        graveCard?.name &&
        graveCard.name !== SH.specter &&
        isShadowHeartByName(graveCard.name) &&
        graveCard.cardKind === "monster",
    );

  const tributeBoss = hand.find((handCard) =>
    [SH.scale, SH.arctroth, SH.deathWyrm].includes(handCard?.name),
  );
  if (tributeBoss) {
    const { tributesNeeded } = getTributeRequirementFor(tributeBoss, {
      field,
    });
    const completesTributeSetup =
      tributesNeeded > 0 &&
      field.length < tributesNeeded &&
      field.length + 1 >= tributesNeeded;
    if (completesTributeSetup) {
      return {
        ok: true,
        type: "tribute",
        bonus: name === SH.specter ? 18 : 10,
        plan: hasSpecterRecycle
          ? `tribute setup for ${tributeBoss.name} with Specter recycle`
          : `tribute setup for ${tributeBoss.name}`,
      };
    }
  }

  const hasPolymerization = hasName(hand, SH.poly);
  const hasWarlordAccess =
    extraDeck.length === 0 || extraDeck.some((extraCard) => extraCard?.name === SH.warlord);
  const hasOtherShadowHeartMaterial = [...hand, ...field].some(
    (otherCard) =>
      otherCard?.cardKind === "monster" &&
      otherCard.name !== name &&
      isShadowHeartByName(otherCard.name),
  );
  if (hasPolymerization && hasWarlordAccess && hasOtherShadowHeartMaterial) {
    return {
      ok: true,
      type: "fusion_material",
      bonus: name === SH.specter ? 16 : 8,
      plan: hasSpecterRecycle
        ? "Warlord material with Specter recycle"
        : "low-value Warlord material",
    };
  }

  return {
    ok: false,
    type: "body",
    bonus: 0,
    plan: "no clear tribute/material plan",
  };
}

export function estimateShadowHeartCathedralCounterGain(analysis = {}) {
  const field = analysis.field || [];
  const oppField = analysis.oppField || [];
  const attackers = field.filter(isReadyShadowHeartAttacker);
  const instances = [];

  for (const attacker of attackers) {
    const atk = attacker.atk || 0;
    if (oppField.length === 0) {
      if (atk >= 500) {
        instances.push({
          type: "direct",
          source: attacker.name,
          amount: atk,
        });
      }
      continue;
    }

    const battleDamage = oppField
      .filter(
        (target) =>
          target &&
          target.cardKind === "monster" &&
          !target.isFacedown &&
          target.position !== "defense",
      )
      .map((target) => Math.max(0, atk - (target.atk || 0)))
      .sort((a, b) => b - a)[0] || 0;
    if (battleDamage >= 500) {
      instances.push({
        type: "battle",
        source: attacker.name,
        amount: battleDamage,
      });
    }

    if (attacker.name === SH.leviathan && battleDamage > 0) {
      instances.push({
        type: "burn",
        source: attacker.name,
        amount: 500,
      });
    }
  }

  return {
    count: instances.length,
    instances,
    totalDamage: instances.reduce((sum, entry) => sum + entry.amount, 0),
  };
}

export function evaluateCathedralPlacement(analysis = {}) {
  const hand = analysis.hand || [];
  const spellTrap = analysis.spellTrap || [];
  const field = analysis.field || [];
  const alreadyActive =
    spellTrap.some((card) => card?.name === SH.cathedral) ||
    field.some((card) => card?.name === SH.cathedral);
  if (alreadyActive) {
    return { shouldActivate: false, priority: 0, reason: "Cathedral ja esta ativa" };
  }
  if (spellTrap.length >= 4) {
    return { shouldActivate: false, priority: 0, reason: "Backrow apertada" };
  }

  const predicted = estimateShadowHeartCathedralCounterGain(analysis);
  const hasPressure = predicted.count > 0;
  const hasMultiplePressure = predicted.count >= 2;
  const hasValley = !!analysis.fieldSpell || hand.some((card) => card?.name === SH.valley);
  const hasImmediateSpell =
    hand.some((card) => card?.name === SH.infusion || card?.name === SH.poly) &&
    field.length === 0;
  const hasFutureTarget = hasUsefulCathedralTargetInDeck(
    analysis,
    Math.max(1, predicted.count),
  );
  const longGameLikely =
    (analysis.oppField || []).length >= 2 ||
    (analysis.lp || 8000) >= 3500 ||
    (analysis.oppLp || 8000) >= 3500;

  if (!hasPressure && !hasFutureTarget) {
    return {
      shouldActivate: false,
      priority: 0,
      reason: "Sem dano 500+ previsto nem alvo futuro claro",
    };
  }
  if (!hasPressure && hasImmediateSpell) {
    return {
      shouldActivate: false,
      priority: 0,
      reason: "Precisa de spell imediata antes da engine",
    };
  }

  let priority = 9;
  if (hasPressure) priority += 3;
  if (hasMultiplePressure) priority += 2;
  if (hasValley) priority += 1;
  if (longGameLikely) priority += 1;
  if (hasFutureTarget) priority += 1;

  return {
    shouldActivate: true,
    priority,
    reason: `Engine com ${predicted.count} counter(s) previsto(s)`,
    predictedCounters: predicted.count,
  };
}

export function chooseCathedralSummonTarget(candidates = [], analysis = {}) {
  const cards = Array.isArray(candidates)
    ? candidates.filter((card) => card?.cardKind === "monster")
    : [];
  if (cards.length === 0) {
    return { card: null, score: -999, reason: "no_targets" };
  }

  const hasLevel8InDeck = (analysis.deck || []).some(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      isShadowHeartByName(card.name) &&
      (card.level || 0) >= 8,
  );
  const hasPolyLine =
    hasName(analysis.hand || [], SH.poly) ||
    hasName([...(analysis.hand || []), ...(analysis.field || [])], SH.scale);
  const needsTributes = (analysis.hand || []).some((card) =>
    [SH.scale, SH.arctroth, SH.deathWyrm].includes(card?.name),
  );
  const hasLeviathan = hasName(analysis.hand || [], SH.leviathan);
  const fieldEmpty = (analysis.field || []).length === 0;
  const candidateNames = getCathedralCandidateNames(cards);
  const geckoAvailable = cards.some((card) => card?.name === SH.gecko);
  const eelAvailable = cards.some((card) => card?.name === SH.eel);
  const eelInDeck = (analysis.deck || []).some((card) => card?.name === SH.eel);
  const pressurePlan =
    fieldEmpty ||
    (analysis.oppField || []).length === 0 ||
    (analysis.oppLp || 8000) <= 2500;

  const evaluateCard = (card) => {
    let score = (CARD_KNOWLEDGE[card.name]?.value || 0) * 0.4;
    const specialTrigger = cardHasRelevantTriggerForSummonMethod(card, "special");
    if (specialTrigger) score += 8;
    let plan = specialTrigger ? "special summon trigger" : "body/material";
    let clearBodyPlan = null;

    if (card.name === SH.gecko) {
      score += hasLevel8InDeck ? 25 : -4;
      if (hasLevel8InDeck) score += 18;
      if (hasLevel8InDeck && hasPolyLine) score += 8;
      plan = hasLevel8InDeck
        ? "special search for Level 8 Shadow-Heart"
        : "Gecko body without Level 8 search";
      return { card, score, plan, clearBodyPlan, specialTrigger };
    }
    if (card.name === SH.eel) {
      score += 26;
      if (!geckoAvailable) score += 12;
      if (hasLeviathan) score += 10;
      if (pressurePlan) score += 6;
      plan = hasLeviathan
        ? "Leviathan enabler and pressure body"
        : "best fallback pressure/defense body";
      return { card, score, plan, clearBodyPlan, specialTrigger };
    }
    if (card.name === SH.specter) {
      clearBodyPlan = getCathedralBodyPlan(card, analysis);
      if (clearBodyPlan.ok) {
        score += 18 + clearBodyPlan.bonus;
        if (!eelAvailable) score += 3;
        plan = clearBodyPlan.plan;
      } else {
        score -= eelInDeck ? 22 : 12;
        plan = clearBodyPlan.plan;
      }
      return { card, score, plan, clearBodyPlan, specialTrigger };
    }
    if (card.name === SH.coward) {
      clearBodyPlan = getCathedralBodyPlan(card, analysis);
      if (clearBodyPlan.ok) {
        score += 11 + clearBodyPlan.bonus;
        if (!eelAvailable) score += 2;
        plan = clearBodyPlan.plan;
      } else {
        score -= eelInDeck ? 26 : 16;
        plan = clearBodyPlan.plan;
      }
      return { card, score, plan, clearBodyPlan, specialTrigger };
    }
    if (card.name === SH.voidMage || card.name === SH.imp) {
      score += needsTributes ? 2 : -12;
      if (!specialTrigger) score -= 4;
      plan = needsTributes
        ? "body for tribute/material only"
        : "poor Cathedral target without Normal Summon trigger";
      return { card, score, plan, clearBodyPlan, specialTrigger };
    }

    score += (card.atk || 0) / 1000;
    return { card, score, plan, clearBodyPlan, specialTrigger };
  };

  const ranked = cards
    .map((card) => evaluateCard(card))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const hasRelevantSpecialTrigger = cardHasRelevantTriggerForSummonMethod(
    best.card,
    "special",
  );
  const scores = ranked.map((entry) => ({
    card: entry.card,
    score: entry.score,
    plan: entry.plan,
    hasRelevantSpecialTrigger: entry.specialTrigger,
    clearBodyPlan: entry.clearBodyPlan,
  }));
  return {
    card: best.card,
    score: best.score,
    scores,
    candidateNames,
    expectedPlan: best.plan,
    clearBodyPlan: best.clearBodyPlan,
    hasRelevantSpecialTrigger,
    reason: `${best.card.name} via Cathedral${
      hasRelevantSpecialTrigger ? " (special trigger)" : " (body/material)"
    }: ${best.plan}`,
  };
}

export function evaluateCathedralActivation(cathedral, analysis = {}) {
  const counterCount = getCounterCount(cathedral, "judgment_marker");
  if (counterCount <= 0) {
    return {
      shouldActivate: false,
      priority: 0,
      counterCount,
      reason: "Sem Judgment Counters",
    };
  }
  if ((analysis.field || []).length >= 5) {
    return {
      shouldActivate: false,
      priority: 0,
      counterCount,
      reason: "Campo cheio",
    };
  }

  const candidates = getCathedralDeckCandidates(analysis, counterCount);
  const target = chooseCathedralSummonTarget(candidates, analysis);
  const candidateNames = target.candidateNames || getCathedralCandidateNames(candidates);
  const candidateScores = (target.scores || []).map((entry) => ({
    name: entry.card?.name || "unknown",
    score: roundPriority(entry.score),
    plan: entry.plan || "unknown",
  }));
  if (!target.card) {
    return {
      shouldActivate: false,
      priority: 0,
      counterCount,
      candidateNames,
      candidateScores,
      reason: `Sem alvo valido com ${counterCount} counter(s)`,
    };
  }

  const offensivePlan = evaluateShadowHeartOffensivePlan(analysis);
  if (offensivePlan.directLethal || offensivePlan.battleHymnLethal) {
    return {
      shouldActivate: false,
      priority: 0,
      counterCount,
      target: target.card,
      candidateNames,
      candidateScores,
      expectedPlan: target.expectedPlan,
      reason: "Ataque atual ja fecha o jogo",
    };
  }

  const isLowBodyTarget = [SH.specter, SH.coward].includes(target.card.name);
  const hasClearBodyPlan = target.clearBodyPlan?.ok === true;
  const eelInDeck = (analysis.deck || []).some((card) => card?.name === SH.eel);
  const eelCounterCost = Math.min(
    ...((analysis.deck || [])
      .filter((card) => card?.name === SH.eel)
      .map((card) => getCathedralCounterCost(card))),
  );
  if (
    isLowBodyTarget &&
    !hasClearBodyPlan &&
    eelInDeck &&
    Number.isFinite(eelCounterCost) &&
    counterCount < eelCounterCost
  ) {
    return {
      shouldActivate: false,
      priority: 0,
      counterCount,
      target: target.card,
      targetScore: target.score,
      candidateNames,
      candidateScores,
      expectedPlan: target.expectedPlan,
      reason: `Segura counters para ${SH.eel} (${counterCount}/${eelCounterCost})`,
    };
  }

  const bodyOnlyUseful =
    target.score >= 6 &&
    ((analysis.field || []).length <= 1 ||
      (analysis.hand || []).some((card) =>
        [SH.scale, SH.arctroth, SH.deathWyrm, SH.poly].includes(card?.name),
      ));
  const shouldActivate =
    target.hasRelevantSpecialTrigger ||
    target.card.name === SH.eel ||
    (isLowBodyTarget && hasClearBodyPlan) ||
    bodyOnlyUseful;
  if (!shouldActivate) {
    return {
      shouldActivate: false,
      priority: 0,
      counterCount,
      target: target.card,
      targetScore: target.score,
      candidateNames,
      candidateScores,
      expectedPlan: target.expectedPlan,
      reason: `${target.card.name} nao converte counters em valor suficiente`,
    };
  }

  return {
    shouldActivate: true,
    priority: 7 + Math.min(6, counterCount) + Math.max(0, target.score / 10),
    counterCount,
    target: target.card,
    targetScore: target.score,
    hasRelevantSpecialTrigger: target.hasRelevantSpecialTrigger,
    clearBodyPlan: target.clearBodyPlan,
    candidateNames,
    candidateScores,
    expectedPlan: target.expectedPlan,
    reason: target.reason,
  };
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
  const cathedral = getCandidateByName(candidates, [SH.cathedral]);
  const cathedralPlan = cathedral
    ? evaluateCathedralPlacement({
        ...analysis,
        hand: [...hand, cathedral],
      })
    : null;

  if (!analysis?.fieldSpell) {
    const valley = getCandidateByName(candidates, [SH.valley]);
    if (
      cathedral &&
      cathedralPlan?.shouldActivate &&
      cathedralPlan.predictedCounters >= 2 &&
      hasName(hand, SH.valley)
    ) {
      return { card: cathedral, reason: "early_cathedral_counter_engine" };
    }
    if (valley) return { card: valley, reason: "establish_valley_engine" };
  }

  if (!hasName(cards, SH.cathedral)) {
    if (cathedral && cathedralPlan?.shouldActivate && !hasName(hand, SH.valley)) {
      return { card: cathedral, reason: cathedralPlan.reason || "early_cathedral_engine" };
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

/**
 * Escolhe o melhor monstro Shadow-Heart para descartar+reviver em modo emergencial
 * (quando o GY não tem nenhum SH monster disponível para Infusion).
 *
 * Prioridade contextual:
 *   1. Scale Dragon — quando não há linha real de Fusion/Tribute próxima.
 *   2. Gecko — quando Imp está acessível (SS→Gecko busca Lv8).
 *   3. Arctroth / Death Wyrm — corpo grande para pressão imediata.
 *   4. Eel — corpo + pressão secundária.
 *   5. Fallback: maior ATK disponível.
 *
 * @param {Object[]} nonInfusionHand — mão excluindo as cópias de Infusion
 * @param {Object} analysis
 * @returns {Object|null} card object ou null se não há candidato
 */
export function pickInfusionEmergencyRevive(nonInfusionHand = [], analysis = {}) {
  const monsters = nonInfusionHand.filter(
    (c) => c?.cardKind === "monster" && isShadowHeartByName(c.name),
  );
  if (monsters.length === 0) return null;

  const allHandField = [...(analysis?.hand || []), ...(analysis?.field || [])];

  // P1: Scale Dragon — quando não há linha de Fusion nem Tribute montada
  const scale = monsters.find((c) => c.name === SH.scale);
  if (scale) {
    const hasFusionLine =
      allHandField.some((c) => c.name === SH.poly) &&
      allHandField.some(
        (c) =>
          isShadowHeartByName(c.name) &&
          (c.level || 0) >= 8 &&
          c.name !== SH.scale,
      );
    const hasTributeLine = (analysis?.field || []).length >= 2;
    if (!hasFusionLine && !hasTributeLine) return scale;
  }

  // P2: Gecko — quando Imp está disponível (SS de Gecko ativa busca de Lv8)
  const gecko = monsters.find((c) => c.name === SH.gecko);
  if (gecko) {
    const hasImpAccess = allHandField.some((c) => c.name === SH.imp);
    if (hasImpAccess) return gecko;
  }

  // P3: Arctroth / Death Wyrm (corpo grande / pressão)
  const heavy = monsters.find(
    (c) => c.name === SH.arctroth || c.name === SH.deathWyrm,
  );
  if (heavy) return heavy;

  // P4: Eel (corpo + pressão secundária)
  const eel = monsters.find((c) => c.name === SH.eel);
  if (eel) return eel;

  // Scale/Gecko sem condição ideal ainda é melhor que nada
  if (scale) return scale;
  if (gecko) return gecko;

  // Fallback: maior ATK
  return monsters.slice().sort((a, b) => (b.atk || 0) - (a.atk || 0))[0] || null;
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
    if (sourceName === SH.cathedral) {
      const cathedralTarget = chooseCathedralSummonTarget(cards, analysis);
      if (cathedralTarget.card?.name === card.name) score += 100;
      if (!cardHasRelevantTriggerForSummonMethod(card, "special")) score -= 8;
    }
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
  const rageTargetOnField = field.find(
    (card) =>
      isShadowHeartDragon(card) &&
      card.position === "attack" &&
      !card.cannotAttackThisTurn,
  );
  const rageLive =
    phase !== "main2" &&
    !!rageTargetOnField &&
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
  if (rageLive || rageTargetOnField || scaleOnField || scaleInHand) {
    preserveNames.add("Shadow-Heart Rage");
  }
  if (scaleOnField || scaleInHand) {
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
  const resourcePreferences = buildShadowHeartResourcePreferences(analysis);
  const preferNames = new Set([
    "Shadow-Heart Coward",
    "Shadow-Heart Specter",
  ]);
  for (const name of resourcePreferences.preferNames || []) {
    preferNames.add(name);
  }

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

  const preserveNames = new Set([
    ...(offensivePlan.preserveNames || []),
    ...(resourcePreferences.preserveNames || []),
  ]);
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
    resourceEconomy: resourcePreferences.resourceEconomy,
    resourcePressure: resourcePreferences.resourcePressure,
  };
}

export function assessShadowHeartSummonEntry(card, context = {}) {
  const base = assessSummonEntry(card, {
    ...context,
    profile: {
      bossNames: SHADOW_HEART_BOSS_SUMMON_NAMES,
      enginePieceNames: SHADOW_HEART_ENGINE_SUMMON_NAMES,
      lowImpactAtk: 1200,
      facedownValue: context.facedownValue ?? 1500,
      defaultReason: "default Shadow-Heart summon assessment",
      projectEntryStats: projectShadowHeartEntryStats,
      ...(context.profile || {}),
    },
  });

  if (!card || card.cardKind !== "monster") return base;

  const atk = base.projectedAtk ?? getEffectiveAtk(card);
  const def = base.projectedDef ?? getEffectiveDef(card);
  const oppField =
    context.oppField ||
    context.opponent?.field ||
    context.analysis?.oppField ||
    [];

  if (context.clearsOpponentBoardOnSummon === true) {
    return {
      ...base,
      shouldSummon: true,
      position: "attack",
      scoreDelta: (base.scoreDelta || 0) + 1.2,
      reason: [
        base.reason,
        "Shadow-Heart removal summon should pressure in attack",
      ]
        .filter(Boolean)
        .join("; "),
    };
  }

  if (def >= atk) {
    return {
      ...base,
      position: "attack",
      reason: [
        base.reason,
        "Shadow-Heart pressure prefers attack when DEF is not lower",
      ]
        .filter(Boolean)
        .join("; "),
    };
  }

  const attackLine = evaluateProjectedAttackLine(atk, oppField, {
    facedownValue: context.facedownValue ?? 1500,
  });
  const strongestFaceUpAtk = attackLine.strongestFaceUpAtk;

  return {
    ...base,
    position: attackLine.safeInAttack ? "attack" : "defense",
    strongestThreat: Math.max(base.strongestThreat || 0, strongestFaceUpAtk),
    attackLine,
  };
}

export function evaluateShadowHeartFusionPlan(analysis = {}) {
  const allCards = [...(analysis.hand || []), ...(analysis.field || [])];
  const shMonsters = allCards.filter(
    (card) => isShadowHeartByName(card?.name) && card.cardKind === "monster",
  );
  const hasScaleDragon = allCards.some((card) => card?.name === SH.scale);
  const validLevel8Plus = shMonsters.filter((card) => {
    if (card.name === SH.scale) return false;
    return (card.level || 0) >= 8;
  });
  const scaleCount = allCards.filter((card) => card?.name === SH.scale).length;

  if (hasScaleDragon && (validLevel8Plus.length > 0 || scaleCount >= 2)) {
    const materialName =
      validLevel8Plus.length > 0 ? validLevel8Plus[0].name : SH.scale;
    return createFinisherPlan({
      kind: "fusion",
      targetName: SH.demonDragon,
      score100: 100,
      reason: `Fusion: Demon Dragon (3000 ATK, destroy 2) com Scale Dragon + ${materialName}`,
      details: {
        spellPriority: 17,
        materialNames: [SH.scale, materialName],
      },
    });
  }

  if (shMonsters.length >= 2) {
    if (shouldPreserveScaleForDemonLine(analysis)) {
      return {
        kind: "fusion_hold",
        targetName: null,
        score100: 0,
        actionPriority: 0,
        reason:
          "Preservar Scale Dragon para linha proxima de Demon Dragon em vez de Warlord cedo",
      };
    }

    const [m1, m2] = shMonsters;
    return createFinisherPlan({
      kind: "fusion",
      targetName: SH.warlord,
      score100: 72,
      reason: `Fusion: Warlord (2500 ATK, protection + revive) com ${m1.name} + ${m2.name}`,
      details: {
        spellPriority: 9,
        materialNames: [m1.name, m2.name],
      },
    });
  }

  return null;
}

export function evaluateShadowHeartFinisherPlans(
  bot = null,
  opponent = null,
  game = null,
  analysis = null,
) {
  const field = analysis?.field || bot?.field || [];
  const hand = analysis?.hand || bot?.hand || [];
  const oppField = analysis?.oppField || opponent?.field || [];
  const oppLp = analysis?.oppLp || opponent?.lp || 8000;
  const summonLimit = 1 + (bot?.additionalNormalSummons || 0);
  const canNormalSummon =
    analysis?.canNormalSummon ?? (bot?.summonCount || 0) < summonLimit;
  const strongestThreat = getStrongestBattleStat(oppField, {
    facedownValue: 1500,
  });
  const plans = [];

  const fusionPlan = evaluateShadowHeartFusionPlan(analysis || { hand, field });
  if (fusionPlan?.targetName) plans.push(fusionPlan);

  const scaleInHand = hand.find((card) => card?.name === SH.scale);
  if (scaleInHand && canNormalSummon && field.length >= 2) {
    const atk = getEffectiveAtk(scaleInHand);
    plans.push(
      createFinisherPlan({
        kind: "normal_summon",
        targetName: SH.scale,
        score100:
          78 +
          (atk > strongestThreat ? 8 : 0) +
          (oppField.length === 0 && atk >= oppLp ? 10 : 0),
        reason: "Scale Dragon cria pressao alta e recupera recursos por batalha",
        details: { atk },
      }),
    );
  }

  const arctrothInHand = hand.find((card) => card?.name === SH.arctroth);
  if (arctrothInHand && canNormalSummon && field.length >= 2 && oppField.length > 0) {
    const destroyable = countDestroyableByAtk(oppField, getEffectiveAtk(arctrothInHand), {
      facedownValue: 1500,
    });
    const battleIndestructible = oppField.some(
      (monster) =>
        monster?.battleIndestructible || monster?.cannotBeDestroyedByBattle,
    );
    plans.push(
      createFinisherPlan({
        kind: "normal_summon",
        targetName: SH.arctroth,
        score100: battleIndestructible ? 92 : 74 + Math.min(2, destroyable) * 6,
        reason: battleIndestructible
          ? "Demon Arctroth remove ameaca que batalha nao resolve"
          : "Demon Arctroth converte tributos em remocao e pressao",
        details: { destroyable, battleIndestructible },
      }),
    );
  }

  const leviathanInHand = hand.find((card) => card?.name === SH.leviathan);
  const eelOnField = field.some((card) => card?.name === SH.eel);
  if (leviathanInHand && eelOnField) {
    const atk = getEffectiveAtk(leviathanInHand);
    plans.push(
      createFinisherPlan({
        kind: "hand_ignition",
        targetName: SH.leviathan,
        score100:
          70 +
          (atk > strongestThreat ? 6 : 0) +
          (oppField.length === 0 && atk >= oppLp ? 8 : 0),
        reason: "Leviathan usa Eel como ponte para pressao e burn",
        details: { atk },
      }),
    );
  }

  return rankFinisherPlans(plans);
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

  // Polymerization - Detecta fusoes Shadow-Heart viaveis (nao Ascensoes!)
  if (name === "Polymerization") {
    const fusionPlan = evaluateShadowHeartFusionPlan(analysis);

    if (fusionPlan?.targetName) {
      return {
        yes: true,
        priority: fusionPlan.details?.spellPriority || 9,
        reason: fusionPlan.reason,
      };
    }

    if (fusionPlan?.kind === "fusion_hold") {
      return { yes: false, reason: fusionPlan.reason };
    }

    return {
      yes: false,
      reason:
        "Sem materiais para fusao Shadow-Heart (Demon Dragon: Scale + Lv8+; Warlord: 2 SH)",
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

  // Shadow-Heart Rage - Dragon Shadow-Heart combat push
  if (name === "Shadow-Heart Rage") {
    // ⚠️ TIMING: Rage é buff de ATK - só útil antes da Battle Phase
    if (analysis.phase === "main2") {
      return {
        yes: false,
        reason: "Main2: Battle Phase já passou (buff ATK inútil)",
      };
    }

    const rageTargets = analysis.field
      .filter((card) => isShadowHeartDragon(card) && !card.cannotAttackThisTurn)
      .sort((a, b) => (b.atk || 0) - (a.atk || 0));

    if (rageTargets.length > 0) {
      const target = rageTargets[0];
      return {
        yes: true,
        priority: target.name === "Shadow-Heart Scale Dragon" ? 10 : 9,
        reason: `Push de batalha com ${target.name}`,
      };
    }
    return {
      yes: false,
      reason: "Sem Dragao Shadow-Heart apto para atacar",
    };
  }

  // Shadow-Heart Infusion - Avaliação dinâmica de custo/benefício
  if (name === "Shadow-Heart Infusion") {
    if (analysis.hand.length < 3) {
      return { yes: false, reason: "Preciso de 2 cartas para descartar" };
    }
    const shInGY = analysis.graveyard.filter((c) => c.cardKind === "monster");
    const nonInfusionHand = analysis.hand.filter((c) => c.name !== SH.infusion);
    const hasBetterNormalLine =
      hasName(analysis.hand, SH.voidMage) ||
      hasName(analysis.hand, SH.imp) ||
      hasName(analysis.hand, SH.eel) ||
      hasName(analysis.hand, SH.valley) ||
      hasName(analysis.hand, SH.cathedral);

    if (shInGY.length === 0) {
      // Sem SH monster no GY: só ativar se puder descartar 1 monstro revivível como custo.
      // Linha normal preferida — evita gastar Infusion desnecessariamente.
      if (hasBetterNormalLine) {
        return { yes: false, reason: "Sem SH no GY — linha normal disponível" };
      }
      const emergencyRevive = pickInfusionEmergencyRevive(nonInfusionHand, analysis);
      if (!emergencyRevive) {
        return {
          yes: false,
          reason: "Sem SH no GY e sem monstro Shadow-Heart revivível na mão",
        };
      }
      // Precisamos de pelo menos 2 cartas além da Infusion (monstro + 2º descarte)
      if (nonInfusionHand.length < 2) {
        return { yes: false, reason: "Sem segunda carta para o descarte emergencial" };
      }
      const damagePenalty =
        analysis.phase !== "main2" &&
        (analysis.oppField || []).length === 0 &&
        (analysis.oppLp || 8000) <= (emergencyRevive.atk || 0);
      return {
        yes: true,
        priority: damagePenalty ? 6 : 8,
        reason: `Starter emergencial: forçar ${emergencyRevive.name} no descarte e reviver`,
      };
    }

    // GY tem SH monster — avaliar custo/benefício do revival
    const handValues = analysis.hand
      .filter((c) => c.name !== SH.infusion)
      .map((c) => ({
        card: c,
        value: CARD_KNOWLEDGE[c.name]?.value || 0,
      }))
      .sort((a, b) => a.value - b.value); // Menor valor primeiro para descartar

    const bestRevival = shInGY.slice().sort((a, b) => {
      const valA = CARD_KNOWLEDGE[a.name]?.value || 0;
      const valB = CARD_KNOWLEDGE[b.name]?.value || 0;
      return valB - valA;
    })[0];
    const revivalValue = CARD_KNOWLEDGE[bestRevival.name]?.value || 0;

    const worstCard = handValues[0];
    const discardCost = worstCard.value;

    // Bônus: Specter/Coward têm efeito ao serem descartados
    const hasValueDiscard =
      worstCard.card.name === SH.specter || worstCard.card.name === SH.coward;
    const netValue = revivalValue - discardCost + (hasValueDiscard ? 1 : 0);

    if (netValue > 0) {
      const recoveryAssessment = assessShadowHeartResourceRecovery(analysis, {
        mode: "revive",
      });
      const recoveryBonus = Math.max(
        0,
        Math.min(2, recoveryAssessment.scoreDelta || 0),
      );
      return {
        yes: true,
        priority: (hasValueDiscard ? 8 : 6) + recoveryBonus,
        reason:
          `Reviver ${bestRevival.name} (val:${revivalValue}) > descartar ${worstCard.card.name} (val:${discardCost})` +
          (recoveryBonus > 0 ? "; economia SH favorece revival" : ""),
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
    const cathedralPlan = evaluateCathedralPlacement(analysis);
    if (!cathedralPlan.shouldActivate) {
      return { yes: false, reason: cathedralPlan.reason };
    }
    return {
      yes: true,
      priority: cathedralPlan.priority,
      reason: cathedralPlan.reason,
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
  const summonAssessment = assessShadowHeartSummonEntry(card, {
    analysis,
    myField: fieldState,
    oppField: oppFieldState,
    phase: analysis?.phase,
  });

  // === SAFETY CHECK: Avaliar se é seguro summon em ATK ===
  const cardATK = getEffectiveAtk(card);
  const cardDEF = getEffectiveDef(card);
  const oppStrongestATK = getStrongestBattleStat(
    (analysis.oppField || []).filter((monster) => !monster?.isFacedown),
    { facedownValue: 0 },
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
      position: summonAssessment.position || "attack",
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
