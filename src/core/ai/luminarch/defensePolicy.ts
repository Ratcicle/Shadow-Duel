import type { SimulatedCardState } from "../../contracts/aiState.js";
import type { ChainCard, ChainStrategyPort, ChainStrategyResponse } from "../../contracts/chainRuntime.js";
import { hasActivePiercing } from "../../game/combat/availability.js";
import { GENERIC_QUICK_SPELL_RESPONSE_PRIORITY } from "../../chain/botResponsePolicy.js";
import type { LuminarchAnalysis, LuminarchActionContext } from "./contracts.js";
import {
  getEffectiveAtk,
  getEffectiveDef,
  getTotalAttackThreat,
  getVisibleAtk,
  getVisibleDef,
} from "../common/cardStats.js";
import { estimateCardValue } from "../StrategyUtils.js";
import { evaluateCardExpendability } from "./cardValue.js";
import { evaluateLuminarchDefensePlan } from "./defensePlanning.js";
import { isLuminarch } from "./knowledge.js";
import { cardDatabaseByName } from "../../../data/cards.js";
import { quoteLuminarchLpCost } from "./resourceEconomy.js";
import type { LpQuoteCard } from "../common/simulatedActions/shared.js";
import {
  getBattleReadyLuminarchAttackers,
  getBestTemporaryCombatDebuffTarget,
  LUMINARCH_CORE_DEFENDERS,
  LUMINARCH_COUNTERATTACK_PAYOFFS,
} from "./priorityShared.js";

const HOLY_SHIELD = "Luminarch Holy Shield";
const CRESCENT_SHIELD = "Luminarch Crescent Shield";
const RADIANT_WAVE = "Luminarch Radiant Wave";
const SPEAR = "Luminarch Spear of Dawnfall";

const PROTECTED_COST_NAMES = new Set<string | undefined>([
  "Luminarch Aegisbearer",
  "Luminarch Sanctum Protector",
  "Luminarch Fortress Aegis",
  "Luminarch Aurora Seraph",
  "Luminarch Megashield Barbarias",
]);

function cardsIn(analysis: LuminarchAnalysis = {}, zone: "hand" | "field" | "graveyard" | "deck" | "extraDeck" | "spellTrap" | "oppField" | "oppSpellTrap") {
  return Array.isArray(analysis?.[zone]) ? analysis[zone] : [];
}

function getFaceupLuminarchMonsters(analysis: LuminarchAnalysis = {}) {
  return cardsIn(analysis, "field").filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      isLuminarch(card) &&
      !card.isFacedown,
  );
}

function getOpponentMonsters(analysis: LuminarchAnalysis = {}, { requireFaceup = false } = {}) {
  return cardsIn(analysis, "oppField").filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      (!requireFaceup || !card.isFacedown),
  );
}

function uniqueNames(names: Array<string | undefined> = []) {
  return [...new Set((names || []).filter(Boolean))];
}

function hasSetHolyShield(analysis: LuminarchAnalysis = {}) {
  return cardsIn(analysis, "spellTrap").some(
    (card) => card && card.name === HOLY_SHIELD && card.isFacedown,
  );
}

function getPressureProfile(analysis: LuminarchAnalysis = {}) {
  const opponentMonsters = getOpponentMonsters(analysis);
  const oppTotalAtk = getTotalAttackThreat(opponentMonsters, {
    facedownValue: 1500,
    includeBoosts: false,
  });
  const lp = analysis.lp || 8000;
  const threateningMonsters = opponentMonsters.filter(
    (monster) => monster && !monster.isFacedown && (monster.atk || 0) >= 1800,
  );
  return {
    opponentMonsters,
    oppTotalAtk,
    threateningCount: threateningMonsters.length,
    lpCritical: lp <= 2000,
    lethalPressure: oppTotalAtk >= lp && opponentMonsters.length > 0,
    multipleThreats: threateningMonsters.length >= 2,
  };
}

function getProtectionTargetScore(card: SimulatedCardState, analysis: LuminarchAnalysis = {}) {
  if (!card) return -100;
  const defensePlan =
    analysis.luminarchDefensePlan || evaluateLuminarchDefensePlan(analysis);
  let score = estimateCardValue(card, {
    archetype: "Luminarch",
    fieldSpell: analysis.fieldSpell || null,
    preferDefense: true,
  });

  if (LUMINARCH_CORE_DEFENDERS.includes(card.name!)) score += 8;
  if (LUMINARCH_COUNTERATTACK_PAYOFFS.includes(card.name!)) score += 4;
  if (card.mustBeAttacked) score += 4;
  if (getEffectiveDef(card) >= defensePlan.oppStrongest!) score += 2;
  if (getEffectiveDef(card) >= 2500) score += 2;
  if (card.name === "Luminarch Aegisbearer") score += 2;
  if (card.name === "Luminarch Sanctum Protector") score += 3;
  if (card.name === "Luminarch Fortress Aegis") score += 4;
  if (card.name === "Luminarch Megashield Barbarias") score += 3;
  return score;
}

export function getLuminarchProtectionTargetNames(analysis: LuminarchAnalysis = {}, count: number = 3) {
  return getFaceupLuminarchMonsters(analysis)
    .map((card) => ({ card, score: getProtectionTargetScore(card, analysis) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((entry) => entry.card.name);
}

export function evaluateLuminarchHolyShieldPolicy(analysis: LuminarchAnalysis = {}) {
  const targets = getFaceupLuminarchMonsters(analysis);
  if (targets.length === 0) {
    return {
      canUse: false,
      shouldActivateNow: false,
      shouldSet: true,
      priority: 3,
      setPriority: 2,
      targetNames: [],
      reason: "Sem monstros Luminarch face-up para proteger agora",
    };
  }

  const pressure = getPressureProfile(analysis);
  const targetNames = getLuminarchProtectionTargetNames(analysis);
  const urgent =
    (pressure.lpCritical && pressure.multipleThreats && targets.length >= 2) ||
    (pressure.lethalPressure && targets.length >= 1);
  const alreadySet = hasSetHolyShield(analysis);

  return {
    canUse: true,
    shouldActivateNow: urgent,
    shouldSet: !alreadySet || urgent,
    priority: urgent ? 16 : 0,
    setPriority: urgent ? 14 : pressure.multipleThreats ? 9 : 6,
    targetNames,
    reason: urgent
      ? `Protecao urgente contra ${pressure.threateningCount || pressure.opponentMonsters.length} ameacas`
      : "Quick Spell: preservar para janela reativa do oponente",
  };
}

export function evaluateLuminarchCrescentShieldPolicy(analysis: LuminarchAnalysis = {}) {
  const targets = getFaceupLuminarchMonsters(analysis).filter((card) => {
    return !cardsIn(analysis, "spellTrap").some(
      (equip) => equip && equip.name === CRESCENT_SHIELD && equip.equippedTo === card.id,
    );
  });
  if (targets.length === 0) {
    return {
      yes: false,
      priority: 0,
      target: null,
      targetNames: [],
      reason: "Sem monstro Luminarch face-up para equipar",
    };
  }

  const defensePlan =
    analysis.luminarchDefensePlan || evaluateLuminarchDefensePlan(analysis);
  const best = targets
    .map((card) => ({
      card,
      score:
        getProtectionTargetScore(card, analysis) +
        (getEffectiveDef(card) + 500 >= defensePlan.oppStrongest! ? 3 : 0),
    }))
    .sort((a, b) => b.score - a.score)[0];

  const target = best?.card || targets[0];
  if (!target) {
    return {
      yes: false,
      priority: 0,
      target: null,
      targetNames: [],
      reason: "Sem monstro Luminarch face-up para equipar",
    };
  }
  const targetNames = uniqueNames([
    target?.name,
    ...targets
      .map((card) => ({ card, score: getProtectionTargetScore(card, analysis) }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.card.name),
  ]);
  const priority =
    target?.name === "Luminarch Aegisbearer"
      ? 8
      : target?.name === "Luminarch Sanctum Protector"
        ? 7
        : LUMINARCH_CORE_DEFENDERS.includes(target?.name!)
          ? 7
          : 5;

  return {
    yes: true,
    priority: priority + (defensePlan.clearLethalRisk ? 2 : 0),
    target,
    targetNames,
    reason: `Equipar ${target.name} (${getEffectiveDef(target) + 500} DEF projetada)`,
  };
}

function isProtectedLuminarchCost(card: SimulatedCardState) {
  if (!card) return false;
  if (PROTECTED_COST_NAMES.has(card.name)) return true;
  return (
    card.name === "Luminarch Radiant Lancer" &&
    (getEffectiveAtk(card) > 2200 || card.hasAttacked)
  );
}

export function getLuminarchRemovalCostScore(card: SimulatedCardState, analysis: LuminarchAnalysis = {}) {
  const expendability = evaluateCardExpendability(card, {
    hand: cardsIn(analysis, "hand"),
    field: cardsIn(analysis, "field"),
    graveyard: cardsIn(analysis, "graveyard"),
    fieldSpell: analysis.fieldSpell || null,
    usedEffects: analysis.usedEffects || [],
  });

  let score = expendability.value ?? 5;
  if (expendability.expendable) score -= 2;
  if (card.usedEffectThisTurn || card.hasAttacked) score -= 1.25;
  if (card.name === "Luminarch Enchanted Halberd") score -= 1.5;
  if (card.name === "Luminarch Magic Sickle") score -= 1.25;
  if (isProtectedLuminarchCost(card)) score += 4;
  if (card.mustBeAttacked) score += 2;
  if (getVisibleDef(card) >= 2500) score += 1.5;
  return score;
}

export function getLuminarchRemovalTargetScore(card: SimulatedCardState | null | undefined, analysis: LuminarchAnalysis = {}) {
  if (!card) return 0;
  if (card.cardKind !== "monster") {
    let score = estimateCardValue(card, {
      archetype: card.archetype,
      fieldSpell: analysis.oppFieldSpell || null,
    });
    if (card.subtype === "field" || card === analysis.oppFieldSpell) score += 4;
    if (/Cathedral|Valley|Citadel|The Shadow Heart|The Void/i.test(card.name || "")) {
      score += 3;
    }
    return score;
  }

  const atk = getVisibleAtk(card);
  const def = getVisibleDef(card);
  let score = Math.max(atk, def) / 450;
  if (atk >= 2500 || def >= 2500) score += 1.5;
  if (atk >= 3000) score += 2.5;
  if ((card.name || "").includes("Extreme Dragon")) score += 3;
  if (card.monsterType === "fusion" || card.monsterType === "ascension") {
    score += 1.5;
  }
  if (card.mustBeAttacked || card.battleIndestructibleOncePerTurn) score += 1;

  const oppTotalAtk = getTotalAttackThreat(cardsIn(analysis, "oppField"), {
    includeFacedown: false,
  });
  if (oppTotalAtk >= (analysis.lp || 8000) && atk >= 2000) score += 2;
  return score;
}

function hasRadiantWaveAccess(analysis: LuminarchAnalysis = {}) {
  return getFaceupLuminarchMonsters(analysis).length > 0 ||
    cardsIn(analysis, "graveyard").some(
      (card) => card && card.cardKind === "monster" && isLuminarch(card),
    );
}

function getRadiantWaveLpCost(analysis: LuminarchAnalysis = {}) {
  const source: LpQuoteCard | undefined = cardsIn(analysis, "hand").find(card => card.name === RADIANT_WAVE)
    || cardDatabaseByName.get(RADIANT_WAVE);
  const payment = source?.effects?.flatMap(effect => [...(effect.activationCosts || []), ...(effect.actions || [])])
    .find(action => action.type === "pay_lp");
  return source && payment ? quoteLuminarchLpCost(analysis, source, payment).finalAmount : 2000;
}

function getRadiantWaveTargets(analysis: LuminarchAnalysis = {}) {
  return [
    ...getOpponentMonsters(analysis),
    ...cardsIn(analysis, "oppSpellTrap"),
    analysis.oppFieldSpell,
  ].filter(Boolean);
}

export function evaluateLuminarchRadiantWavePolicy(analysis: LuminarchAnalysis = {}) {
  const targets = getRadiantWaveTargets(analysis);
  const lpCost = getRadiantWaveLpCost(analysis);
  const lp = analysis.lp || 8000;
  if (lp < lpCost) return { yes: false, priority: 0, lpCost, bestTarget: null,
    reason: `LP insuficiente (custo ${lpCost} LP)` };
  if (!hasRadiantWaveAccess(analysis) || targets.length === 0) {
    return {
      yes: false,
      priority: 0,
      lpCost,
      bestTarget: null,
      reason: "Sem Luminarch em campo/GY ou sem alvo relevante para remover",
    };
  }

  const bestTarget = targets
    .map((card) => ({ card, score: getLuminarchRemovalTargetScore(card, analysis) }))
    .sort((a, b) => b.score - a.score)[0];
  if (!bestTarget) {
    return {
      yes: false,
      priority: 0,
      lpCost,
      bestTarget: null,
      reason: "Sem Luminarch em campo/GY ou sem alvo relevante para remover",
    };
  }

  const targetAtk = bestTarget?.card?.cardKind === "monster"
    ? getVisibleAtk(bestTarget.card)
    : 0;
  const oppTotalAtk = getTotalAttackThreat(getOpponentMonsters(analysis), {
    includeFacedown: false,
  });
  const preventsLethal = oppTotalAtk >= (analysis.lp || 8000) && targetAtk >= 1800;
  const targetName = bestTarget?.card?.name || "opposing threat";
  const removesWinCondition =
    /Extreme Dragon|Bahamut|Galaxy|Malicious|Leviathan|Fire Extreme/i.test(
      targetName,
    ) || bestTarget.score >= 9;
  const lpPressure = lp <= lpCost + 1000;
  const positiveTrade = bestTarget.score >= (lpCost <= 1000 ? 4.5 : 6.5);

  if (lpPressure && !preventsLethal && !removesWinCondition) {
    return {
      yes: false,
      priority: 0,
      bestTarget: bestTarget?.card || null,
      lpCost,
      reason: `Radiant Wave held: ${lp} LP is too low to pay ${lpCost} for ${targetName}`,
    };
  }

  if (!positiveTrade && !preventsLethal && !removesWinCondition) {
    return {
      yes: false,
      priority: 0,
      bestTarget: bestTarget?.card || null,
      lpCost,
      reason: `Radiant Wave held: ${targetName} is not worth ${lpCost} LP`,
    };
  }

  return {
    yes: true,
    priority: (preventsLethal || removesWinCondition ? 15 : 11) + (lpCost <= 1000 ? 2 : 0),
    bestTarget: bestTarget?.card || null,
    lpCost,
    reason: `Destroy ${targetName} by paying ${lpCost} LP`,
  };
}

export function evaluateLuminarchSpearPolicy(analysis: LuminarchAnalysis = {}) {
  const attackers = getBattleReadyLuminarchAttackers(analysis);
  if (attackers.length === 0) {
    return {
      yes: false,
      priority: 0,
      bestTarget: null,
      reason: "Sem atacante Luminarch apto para aproveitar o debuff",
    };
  }

  const combatTarget = getBestTemporaryCombatDebuffTarget(analysis);
  return combatTarget.target && combatTarget.score > 0
    ? {
        yes: true,
        priority: combatTarget.score >= 100 ? 18 : 11,
        bestTarget: combatTarget.target,
        reason: `Spear em ${combatTarget.target.name}: janela real de combate`,
      }
    : {
        yes: false,
        priority: 0,
        bestTarget: null,
        reason: "Spear segurada: nenhum alvo gera ganho real de batalha",
      };
}

export function evaluateLuminarchProtectionSpell(card: SimulatedCardState, analysis: LuminarchAnalysis = {}) {
  if (card?.name === HOLY_SHIELD) {
    const policy = evaluateLuminarchHolyShieldPolicy(analysis);
    if (!policy.canUse) {
      return { yes: false, reason: policy.reason };
    }
    if (policy.shouldActivateNow) {
      return {
        yes: true,
        priority: policy.priority,
        reason: policy.reason,
      };
    }
    return {
      yes: false,
      reason: policy.reason,
    };
  }

  if (card?.name === CRESCENT_SHIELD) {
    const policy = evaluateLuminarchCrescentShieldPolicy(analysis);
    return {
      yes: policy.yes,
      priority: policy.priority,
      reason: policy.reason,
    };
  }

  return null;
}

export function evaluateLuminarchRemovalSpell(card: SimulatedCardState, analysis: LuminarchAnalysis = {}) {
  if (card?.name === RADIANT_WAVE) {
    const policy = evaluateLuminarchRadiantWavePolicy(analysis);
    return {
      yes: policy.yes,
      priority: policy.priority,
      reason: policy.reason,
    };
  }
  if (card?.name === SPEAR) {
    const policy = evaluateLuminarchSpearPolicy(analysis);
    return {
      yes: policy.yes,
      priority: policy.priority,
      reason: policy.reason,
    };
  }
  return null;
}

export function evaluateLuminarchBackrowSetPolicy(card: SimulatedCardState, analysis: LuminarchAnalysis = {}) {
  if (card?.name === HOLY_SHIELD) {
    const policy = evaluateLuminarchHolyShieldPolicy(analysis);
    return {
      shouldSet: policy.shouldSet,
      priority: policy.setPriority,
      reason: policy.reason,
    };
  }
  if (card?.cardKind === "trap") {
    const pressure = getPressureProfile(analysis);
    return {
      shouldSet: true,
      priority: pressure.lethalPressure ? 7 : 3,
      reason: "setup_reactive_backrow",
    };
  }
  if (card?.subtype === "quick") {
    return {
      shouldSet: true,
      priority: 2,
      reason: "setup_quick_spell",
    };
  }
  return null;
}

export function applyLuminarchDefenseActionContext(
  actionContext: LuminarchActionContext = {},
  card: SimulatedCardState,
  analysis: LuminarchAnalysis = {},
) {
  const next = { ...(actionContext || {}) };
  const targetPreferences: Record<string, object> = { ...(next.targetPreferences || {}) };

  if (card?.name === HOLY_SHIELD) {
    targetPreferences.holy_shield_targets = {
      role: "named_preference",
      preferredNames: getLuminarchProtectionTargetNames(analysis),
    };
  }

  if (card?.name === CRESCENT_SHIELD) {
    const shieldPlan = evaluateLuminarchCrescentShieldPolicy(analysis);
    targetPreferences.crescent_shield_target = {
      role: "named_preference",
      preferredNames: shieldPlan.targetNames || [],
    };
  }

  if (card?.name === RADIANT_WAVE) {
    const removalPlan = evaluateLuminarchRadiantWavePolicy(analysis);
    targetPreferences.radiant_wave_destroy = {
      role: "removal",
      preferredNames: removalPlan.bestTarget?.name
        ? [removalPlan.bestTarget.name]
        : [],
    };
  }

  if (card?.name === SPEAR) {
    const attackers = getBattleReadyLuminarchAttackers(analysis);
    targetPreferences.spear_zero_target = {
      role: "temporary_stat_debuff",
      purpose: "combat",
      attackers,
      opponentLp: analysis.oppLp || 0,
    };
  }

  if (Object.keys(targetPreferences).length > 0) {
    next.targetPreferences = targetPreferences;
  }
  return next;
}

type LuminarchChainResponseInput = Parameters<NonNullable<ChainStrategyPort["chooseChainResponse"]>>[0];

function wouldLoseOrTakeDamage(
  attacker: ChainCard | null | undefined,
  defender: ChainCard | null | undefined,
) {
  if (!attacker || !defender)
    return { loseMonster: false, takeDamage: false };
  const atk = attacker.atk || 0;
  const isDefense = defender.position === "defense";
  const defStat = isDefense ? defender.def || 0 : defender.atk || 0;

  if (!isDefense) {
    if (atk > defStat) return { loseMonster: true, takeDamage: true };
    if (atk === defStat) return { loseMonster: true, takeDamage: false };
    return { loseMonster: false, takeDamage: false };
  }

  if (atk > defStat) {
    return {
      loseMonster: true,
      takeDamage: hasActivePiercing(attacker),
    };
  }
  return { loseMonster: false, takeDamage: false };
}

/** An opponent attack on a face-up Luminarch that Holy Shield should answer. */
function holyShieldAnswersBattle(
  { game, player, opponent, context }: LuminarchChainResponseInput,
): boolean {
  const luminarchTargets = (player?.field || []).filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      card.archetype === "Luminarch" &&
      !card.isFacedown,
  );
  const oppAttackers = (opponent?.field || []).filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      !card.isFacedown &&
      card.position === "attack",
  );

  const attacker = context?.attacker || null;
  const defender = context?.defender || context?.target || null;
  const defenderOwnerId =
    context?.defenderOwner?.id ||
    context?.targetOwner?.id ||
    (defender?.owner === "player"
      ? game?.player?.id
      : game?.bot?.id);
  const attackerOwnerId = context?.attackerOwner?.id || attacker?.owner;

  const isDefendingSelf =
    defender && defenderOwnerId && defenderOwnerId === player.id;
  const isOpponentAttack =
    attacker && attackerOwnerId && attackerOwnerId !== player.id;
  const isBattleContext =
    context?.type === "attack_declaration" ||
    context?.type === "battle_damage";
  const isHolyShieldTiming =
    isBattleContext &&
    isOpponentAttack &&
    isDefendingSelf &&
    defender?.archetype === "Luminarch" &&
    !defender?.isFacedown;

  let directBattleThreat = false;
  if (isHolyShieldTiming) {
    const outcome = wouldLoseOrTakeDamage(attacker, defender);
    directBattleThreat = outcome.loseMonster || outcome.takeDamage;
  }

  const multipleAttackers = oppAttackers.length >= 2;
  const anyVulnerableTarget =
    multipleAttackers &&
    luminarchTargets.some((monster) =>
      oppAttackers.some((opp) => {
        const outcome = wouldLoseOrTakeDamage(opp, monster);
        return outcome.loseMonster || outcome.takeDamage;
      }),
    );

  return !!(
    isHolyShieldTiming &&
    luminarchTargets.length > 0 &&
    (directBattleThreat || anyVulnerableTarget)
  );
}

/**
 * Final fallback score of Holy Shield when no battle answer applies. Its
 * generic score is exactly the Quick Spell bonus: it is a speed 2 Quick
 * Spell, so no other generic rule scores it.
 */
function holyShieldFallbackPriority(
  { player, context }: LuminarchChainResponseInput,
): number {
  let priority = GENERIC_QUICK_SPELL_RESPONSE_PRIORITY;
  // Holy Shield is only worth spending in the opponent's battle contexts;
  // never on the bot's own turn or in response to its own summons.
  const isOpponentAction =
    typeof context?.isOpponentAttack === "boolean"
      ? context.isOpponentAttack
      : context?.player?.id !== player?.id;
  const isBattleContext =
    context?.type === "attack_declaration" ||
    context?.type === "battle_damage";

  if (isBattleContext) {
    // Battle threats are answered by holyShieldAnswersBattle. Any other
    // attack is not worth spending the shield on.
    priority = -100;
  } else if (!isOpponentAction) {
    priority = -100;
  } else if (context?.type === "effect_targeted") {
    priority += 40;
  } else {
    priority -= 20;
  }
  if (isOpponentAction && isBattleContext && player?.lp < 3000) {
    priority += 10;
  }
  return priority;
}

/**
 * Chain response of the Luminarch pack: Holy Shield answers a threatening
 * opponent attack directly; otherwise its generic fallback score is shifted
 * to the pack's value and the generic fallback still ranks and rolls.
 */
export function chooseLuminarchChainResponse(
  input: LuminarchChainResponseInput,
): ChainStrategyResponse | null {
  const shields = input.activatable.filter(option => option?.card?.name === HOLY_SHIELD);
  const first = shields[0];
  if (!first) return null;
  if (holyShieldAnswersBattle(input)) {
    return { card: first.card, effect: first.effect, candidateKey: first.candidateKey };
  }
  const adjustment = holyShieldFallbackPriority(input) - GENERIC_QUICK_SPELL_RESPONSE_PRIORITY;
  return {
    fallbackPriorityAdjustments: Object.fromEntries(shields.map(option => [option.candidateKey, adjustment])),
  };
}
