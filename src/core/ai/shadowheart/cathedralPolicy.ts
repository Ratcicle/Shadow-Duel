/** Shadow-Heart cathedralPolicy policies; preferences remain owned by the archetype. */
import { CARD_KNOWLEDGE, isShadowHeartByName } from "./knowledge.js";
import { cardHasRelevantTriggerForSummonMethod } from "../common/analysis.js";
import { getCounterCount } from "../common/counters.js";
import { fieldHasTributeValue } from "../../game/summon/tributeValue.js";
import { evaluateShadowHeartOffensivePlan } from "./offensivePlanning.js";
import { hasName, isReadyShadowHeartAttacker, SH } from "./policyContext.js";
import type { StrategyCard, Analysis } from "./policyContext.js";
import { getTributeRequirementFor } from "./summonPolicy.js";

function getCathedralDeckCandidates(analysis: Analysis = {}, counterCount = 0) {
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


function hasUsefulCathedralTargetInDeck(analysis: Analysis = {}, counterCount = 1) {
  return chooseCathedralSummonTarget(
    getCathedralDeckCandidates(analysis, counterCount),
    analysis,
  ).card;
}


function getCathedralCounterCost(card: StrategyCard) {
  return Math.max(1, Math.ceil((card?.atk || 0) / 500));
}


function getCathedralCandidateNames(cards: StrategyCard[] = []) {
  return cards.filter(Boolean).map((card) => card.name).filter(Boolean);
}


function roundPriority(score: number) {
  return Math.round((score || 0) * 10) / 10;
}


function getCathedralBodyPlan(card: StrategyCard, analysis: Analysis = {}) {
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
    [SH.scale, SH.arctroth, SH.deathWyrm].includes(handCard?.name!),
  );
  if (tributeBoss) {
    const { tributesNeeded } = getTributeRequirementFor(tributeBoss, {
      field,
    });
    const completesTributeSetup =
      tributesNeeded > 0 &&
      !fieldHasTributeValue(field, tributesNeeded, tributeBoss) &&
      fieldHasTributeValue([...field, card], tributesNeeded, tributeBoss);
    if (completesTributeSetup) {
      return {
        ok: true as const,
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
      ok: true as const,
      type: "fusion_material",
      bonus: name === SH.specter ? 16 : 8,
      plan: hasSpecterRecycle
        ? "Warlord material with Specter recycle"
        : "low-value Warlord material",
    };
  }

  return {
    ok: false as const,
    type: "body",
    bonus: 0,
    plan: "no clear tribute/material plan",
  };
}


export function estimateShadowHeartCathedralCounterGain(analysis: Analysis = {}) {
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


export function evaluateCathedralPlacement(analysis: Analysis = {}) {
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


export function chooseCathedralSummonTarget<Card extends StrategyCard>(candidates: Card[] = [], analysis: Analysis = {}) {
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
    [SH.scale, SH.arctroth, SH.deathWyrm].includes(card?.name!),
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

  const evaluateCard = (card: Card) => {
    let score = (CARD_KNOWLEDGE[card.name!]?.value || 0) * 0.4;
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
  if (!best) return { card: null, score: -999, reason: "no_targets" };
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


export function evaluateCathedralActivation(cathedral: StrategyCard, analysis: Analysis = {}) {
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

  const isLowBodyTarget = [SH.specter, SH.coward].includes(target.card.name!);
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
        [SH.scale, SH.arctroth, SH.deathWyrm, SH.poly].includes(card?.name!),
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
