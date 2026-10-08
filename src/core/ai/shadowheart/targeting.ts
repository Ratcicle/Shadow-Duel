/** Shadow-Heart targeting policies; preferences remain owned by the archetype. */
import type { EffectDefinition } from "../../contracts/effects.js";
import { CARD_KNOWLEDGE, isShadowHeartByName, isShadowHeart } from "./knowledge.js";
import { cardHasRelevantTriggerForSummonMethod } from "../common/analysis.js";
import { buildShadowHeartResourcePreferences } from "./resourceEconomy.js";
import { evaluateCathedralPlacement, chooseCathedralSummonTarget } from "./cathedralPolicy.js";
import { evaluateShadowHeartOffensivePlan } from "./offensivePlanning.js";
import { cardCountByName, allCards, hasName, hasShadowHeartStarter, hasLevel8PlusShadowHeart, hasUsefulImpTarget, hasOpponentPressure, getCandidateByName, shouldPreserveScaleForDemonLine, heartbearerCompletesTributeLine, isCovenantLive, SHADOW_HEART_OFFENSIVE_PAYOFFS, SH } from "./policyContext.js";
import type { StrategyCard, Player, Analysis, Context } from "./policyContext.js";
import { isExtraDeckBoss } from "./summonPolicy.js";

function getDemonDragonLevel8Target(candidates: StrategyCard[] = [], analysis: Analysis = {}) {
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


function controlsOrHoldsCourt(analysis: Analysis = {}) {
  const cards = allCards(analysis, ["hand", "spellTrap"]);
  return cards.some((card) => card?.name === SH.courtOfTheDead);
}


function shouldSeekCourtOfTheDead(analysis: Analysis = {}) {
  if (controlsOrHoldsCourt(analysis)) return false;
  const gyMonsters = [
    ...(analysis.graveyard || []),
    ...(analysis.oppGraveyard || []),
  ].filter((card) => card?.cardKind === "monster").length;
  const fieldMonsters = [
    ...(analysis.field || []),
    ...(analysis.oppField || []),
  ].filter((card) => card?.cardKind === "monster").length;
  return gyMonsters >= 2 || fieldMonsters >= 3 || hasOpponentPressure(analysis);
}


export function chooseCovenantSearchTarget(candidates: StrategyCard[] = [], analysis: Analysis = {}) {
  const hand = analysis?.hand || [];
  const field = analysis?.field || [];
  const current = [...hand, ...field];
  const hasPoly = hasName(hand, SH.poly);
  const hasScale = hasName(current, SH.scale);
  const hasLevel8 = hasLevel8PlusShadowHeart(current, { excludeScale: true });

  if (heartbearerCompletesTributeLine(analysis)) {
    const heartbearer = getCandidateByName(candidates, [SH.heartbearer]);
    if (heartbearer) {
      return { card: heartbearer, reason: "complete_tribute_boss_line" };
    }
  }

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
      [SH.valley, SH.cathedral, SH.infusion, SH.poly].includes(card?.name!),
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


export function chooseVoidMageSearchTarget(candidates: StrategyCard[] = [], analysis: Analysis = {}) {
  const cards = allCards(analysis);
  const hand = analysis?.hand || [];
  const graveyard = analysis?.graveyard || [];
  const cathedral = getCandidateByName(candidates, [SH.cathedral]);
  const court = getCandidateByName(candidates, [SH.courtOfTheDead]);
  const cathedralPlan = cathedral
    ? evaluateCathedralPlacement({
        ...analysis,
        hand: [...hand, cathedral],
      })
    : null;

  if (court && shouldSeekCourtOfTheDead(analysis)) {
    return { card: court, reason: "establish_court_grind_engine" };
  }

  if (!analysis?.fieldSpell) {
    const valley = getCandidateByName(candidates, [SH.valley]);
    if (
      cathedral &&
      cathedralPlan?.shouldActivate &&
      cathedralPlan.predictedCounters! >= 2 &&
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
    hand.some((card) => [SH.scale, SH.arctroth, SH.deathWyrm, SH.gecko].includes(card?.name!));
  if (hasInfusionTarget && !hasName(hand, SH.infusion)) {
    const infusion = getCandidateByName(candidates, [SH.infusion]);
    if (infusion) return { card: infusion, reason: "infusion_starter_or_recovery" };
  }

  const fallback = getCandidateByName(candidates, [
    SH.valley,
    SH.cathedral,
    SH.courtOfTheDead,
    SH.infusion,
    SH.battleHymn,
    SH.rage,
  ]);
  return fallback
    ? { card: fallback, reason: "best_spell_line" }
    : { card: candidates[0] || null, reason: "fallback" };
}


export function chooseGeckoSearchTarget(candidates: StrategyCard[] = [], analysis: Analysis = {}) {
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


export function chooseImpSpecialTargetName(analysis: Analysis = {}, candidates: StrategyCard[] = []) {
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


export function buildShadowHeartTargetPreferences(sourceCard: StrategyCard, effect: EffectDefinition | null | undefined, analysis: Analysis = {}) {
  const targetPreferences: { imp_special_from_hand?: { role: string; purpose: string; preferredNames: string[]; reason: string }; infusion_discard?: { role: string; intent: string; purpose: string } } = {};
  const specialSummonPositions: { byName: Record<string, string> } = { byName: {} };

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
    if ([SH.gecko, SH.eel].includes(target.name!)) {
      specialSummonPositions.byName[target.name!] = "attack";
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


function chooseInfusionReviveTarget(candidates: StrategyCard[] = [], analysis: Analysis = {}) {
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

export function pickInfusionEmergencyRevive(nonInfusionHand: StrategyCard[] = [], analysis: Analysis = {}) {
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


export function rankShadowHeartSearchCandidates<Card extends StrategyCard>(cards: Card[] = [], action: { type?: string; sourceName?: string } = {}, ctx: Context = {}) {
  if (!Array.isArray(cards) || cards.length <= 1) return cards || [];
  const player: Player = ctx.player || ctx.strategy?.bot || {};
  const opponent: Player =
    ctx.opponent || ctx.getOpponent?.(ctx.game || {}, player) || {};
  const analysis: Analysis =
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
      `[ShadowHeartStrategy] ${sourceName || "Search"} target: ${preferredName} (${plan!.reason})`,
    );
  }

  const scoreCard = (card: StrategyCard) => {
    let score = CARD_KNOWLEDGE[card?.name!]?.value || 0;
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


export function evaluateShadowHeartRecruitCandidate<Card extends StrategyCard>(candidates: Card[] = [], context: Context = {}) {
  const cards = Array.isArray(candidates) ? candidates : [];
  const player: Player = context.player || context.strategy?.bot || {};
  const opponent: Player =
    context.opponent || context.strategy?.getOpponent?.(context.game || {}, player) || {};
  const analysis: Analysis =
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

  const scoreCard = (card: StrategyCard) => {
    if (!card) return -999;
    let score = CARD_KNOWLEDGE[card.name!]?.value || (card.atk || 0) / 1000;
    if (sourceName === SH.imp && chooseImpSpecialTargetName(analysis, cards).name === card.name) score += 100;
    if (sourceName === SH.infusion) {
      if ([SH.scale, SH.arctroth, SH.deathWyrm].includes(card.name!)) score += 40;
      if (card.name === SH.gecko && !hasLevel8PlusShadowHeart(analysis.hand, { excludeScale: true })) {
        score += 30;
      }
      if (analysis?.phase === "main1" && card.cannotAttackThisTurn) score -= 3;
    }
    if (sourceName === SH.courtOfTheDead) {
      score += Math.max(card?.atk || 0, card?.def || 0) / 250;
      if (isShadowHeart(card)) score += 4;
      if ([SH.scale, SH.arctroth, SH.deathWyrm, SH.demonDragon, SH.warlord].includes(card?.name!)) {
        score += 8;
      }
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


export function buildShadowHeartCostPreferences(analysis: Analysis) {
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
  for (const monster of analysis.field || []) {
    if (isExtraDeckBoss(monster) && monster.name) preserveNames.add(monster.name);
  }
  if (heartbearerCompletesTributeLine(analysis)) {
    preserveNames.add(SH.heartbearer);
  }
  if ((analysis.field || []).some((card) => card?.name === SH.heartbearer)) {
    preserveNames.add(SH.heartbearer);
  }

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
      SHADOW_HEART_OFFENSIVE_PAYOFFS.includes(card.name!),
    ).length,
    offensivePlan,
    resourceEconomy: resourcePreferences.resourceEconomy,
    resourcePressure: resourcePreferences.resourcePressure,
  };
}
