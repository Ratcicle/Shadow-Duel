import {
  getEffectiveAtk,
  getEffectiveDef,
  getStrongestAttackThreat,
  getStrongestBattleThreat,
} from "../common/cardStats.js";
import {
  evaluateTributeSummonCost,
  getTributeRequirementFor as getGenericTributeRequirementFor,
  selectBestTributes as selectGenericTributes,
} from "../common/tributePolicy.js";
import {
  ARCANIST_MONSTER_RECOVERY_ORDER,
  ARCANIST_NAMES,
  ARCANIST_SPELL_RECOVERY_ORDER,
  GRIMOIRE_HOST_ORDER,
  controlsArcanistEquip,
  getInkCounters,
  getNameRank,
  getStoredBlueprintCount,
  hasArcanistEquip,
  isArcanistEquip,
  isArcanistMonster,
  isArcanistSpell,
  sortByNameOrder,
} from "./knowledge.js";
import { evaluateArcanistCardValue } from "./scoring.js";

function hasFaceUpByName(cards = [], name) {
  return (cards || []).some(
    (card) => card?.name === name && !card.isFacedown,
  );
}

function hasOpponentFaceUpSpell(analysis = {}) {
  return (
    !!analysis.oppFieldSpell ||
    (analysis.oppSpellTrap || []).some(
      (card) => card?.cardKind === "spell" && !card.isFacedown,
    )
  );
}

function getOpponentCardCount(analysis = {}) {
  return (
    (analysis.oppField || []).length +
    (analysis.oppSpellTrap || []).length +
    (analysis.oppFieldSpell ? 1 : 0)
  );
}

function getCurrentBattleStat(card) {
  if (!card || card.cardKind !== "monster") return 0;
  if (card.isFacedown) return 1500;
  return card.position === "defense"
    ? getEffectiveDef(card)
    : getEffectiveAtk(card);
}

function getSwitchedBattleStat(card) {
  if (!card || card.cardKind !== "monster") return 0;
  if (card.isFacedown) return getEffectiveAtk(card);
  return card.position === "defense"
    ? getEffectiveAtk(card)
    : getEffectiveDef(card);
}

function evaluateTeraPositionPlan(tera, analysis = {}) {
  if (!tera || tera.name !== ARCANIST_NAMES.TERA || tera.isFacedown) {
    return { ok: false, reason: "not Tera" };
  }

  const targets = (analysis.oppField || []).filter(
    (target) => target && target.cardKind === "monster",
  );
  if (targets.length === 0) {
    return { ok: false, reason: "no opponent monsters" };
  }

  const teraAtk = getEffectiveAtk(tera);
  const canAttackNow =
    tera.position === "attack" &&
    !tera.hasAttacked &&
    !tera.cannotAttackThisTurn &&
    analysis.phase !== "main2";

  const plans = targets
    .map((target) => {
      const currentStat = getCurrentBattleStat(target);
      const switchedStat = getSwitchedBattleStat(target);
      const canClearAfterSwitch = canAttackNow && teraAtk > switchedStat;
      const couldClearBefore = canAttackNow && teraAtk > currentStat;
      const createsAttackWindow = canClearAfterSwitch && !couldClearBefore;
      const damageGain =
        target.position === "defense" && canClearAfterSwitch
          ? Math.max(0, teraAtk - switchedStat)
          : 0;
      let score = evaluateArcanistCardValue(target, analysis);

      if (createsAttackWindow) score += 80;
      if (canClearAfterSwitch) score += 20;
      if (target.position === "attack" && currentStat >= teraAtk) score += 18;
      if (target.position === "defense" && switchedStat < currentStat) score += 12;
      if (damageGain > 0) score += Math.min(30, damageGain / 50);
      if (!createsAttackWindow && target.position === "attack" && teraAtk > currentStat) {
        score -= 35;
      }

      return {
        target,
        currentStat,
        switchedStat,
        createsAttackWindow,
        canClearAfterSwitch,
        damageGain,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);

  const attackWindows = plans.filter((plan) => plan.createsAttackWindow);
  const damageWindows = plans.filter(
    (plan) => !plan.createsAttackWindow && plan.damageGain > 0,
  );
  const usefulPlans =
    attackWindows.length > 0
      ? attackWindows
      : damageWindows.length > 0
        ? damageWindows
        : [];
  const preferredPlans = usefulPlans.length > 0 ? usefulPlans : plans;
  const best = preferredPlans[0] || null;
  if (!best) return { ok: false, reason: "no useful Tera target" };

  const targetNames = preferredPlans.map((plan) => plan.target.name);
  const targetInstanceIds = preferredPlans
    .map((plan) => getCardInstanceId(plan.target))
    .filter((id) => id !== null);
  const avoidInstanceIds = plans
    .filter((plan) => !preferredPlans.includes(plan))
    .map((plan) => getCardInstanceId(plan.target))
    .filter((id) => id !== null);

  return {
    ok: usefulPlans.length > 0,
    hasAttackWindow: attackWindows.length > 0,
    target: best.target,
    targetNames,
    targetInstanceIds,
    avoidInstanceIds,
    priority: attackWindows.length > 0 ? 9.5 : 7.5,
    reason:
      attackWindows.length > 0
        ? "switch target to create a winning attack"
        : "switch target to convert defense wall into battle damage",
  };
}

function getOwnArcanistHosts(analysis = {}) {
  return (analysis.field || []).filter(
    (card) => isArcanistMonster(card) && !card.isFacedown,
  );
}

function countByName(cards = [], name) {
  return (cards || []).filter((card) => card?.name === name).length;
}

function hasFaceUpGrimoire(analysis = {}) {
  return hasFaceUpByName(analysis.spellTrap || [], ARCANIST_NAMES.GRIMOIRE);
}

function hasFaceUpInkRiver(analysis = {}) {
  return hasFaceUpByName(analysis.spellTrap || [], ARCANIST_NAMES.INK_RIVER);
}

function hasGrimoireInDeck(analysis = {}) {
  return (analysis.deck || []).some(
    (card) => card?.name === ARCANIST_NAMES.GRIMOIRE,
  );
}

function canAccessGrimoireThisTurn(analysis = {}) {
  if (hasFaceUpGrimoire(analysis)) return false;
  if (getOwnArcanistHosts(analysis).length === 0) return false;
  return (
    (analysis.hand || []).some((card) => card?.name === ARCANIST_NAMES.GRIMOIRE) ||
    (analysis.fieldSpell?.name === ARCANIST_NAMES.GRAND_LIBRARY &&
      hasGrimoireInDeck(analysis))
  );
}

function isNormalArcanistSpellCounterSource(card) {
  return (
    isArcanistSpell(card) &&
    card.name !== ARCANIST_NAMES.INK_RIVER &&
    card.subtype === "normal"
  );
}

function hasMeetingIgnitionCost(analysis = {}) {
  const hand = analysis.hand || [];
  const monsters = hand.filter(isArcanistMonster).length;
  const spells = hand.filter(isArcanistSpell).length;
  return monsters >= 2 || spells >= 2;
}

function canUseGrandLibraryForInkCounter(analysis = {}) {
  if (analysis.fieldSpell?.name !== ARCANIST_NAMES.GRAND_LIBRARY) {
    return false;
  }

  const hosts = getOwnArcanistHosts(analysis);
  if (hosts.length === 0) {
    return (
      (analysis.player?.lp || analysis.lp || 0) > 2200 &&
      (analysis.deck || []).some(
        (card) => isArcanistMonster(card) && (card.level || 0) <= 4,
      )
    );
  }

  return !hasFaceUpGrimoire(analysis) && hasGrimoireInDeck(analysis);
}

function canUseSpellTrapIgnitionForInkCounter(card, analysis = {}) {
  if (
    !card ||
    card.isFacedown ||
    !isArcanistSpell(card) ||
    card.name === ARCANIST_NAMES.INK_RIVER
  ) {
    return false;
  }

  if (card.subtype !== "continuous" && card.subtype !== "equip") {
    return false;
  }

  const hasIgnition = (card.effects || []).some(
    (effect) =>
      effect &&
      effect.timing === "ignition" &&
      (!effect.requireZone || effect.requireZone === "spellTrap"),
  );
  if (!hasIgnition) return false;

  if (card.name === ARCANIST_NAMES.GRIMOIRE) {
    return getStoredBlueprintCount(card) > 0;
  }
  if (card.name === ARCANIST_NAMES.MEETING) {
    return hasMeetingIgnitionCost(analysis);
  }

  return true;
}

function getInkCounterFlowAfterInk(analysis = {}) {
  const normalSpellSources = (analysis.hand || []).filter(
    isNormalArcanistSpellCounterSource,
  ).length;
  const hasFieldSpellEffect =
    canUseGrandLibraryForInkCounter(analysis) ? 1 : 0;
  const spellTrapEffectSources = (analysis.spellTrap || []).filter((card) =>
    canUseSpellTrapIgnitionForInkCounter(card, analysis),
  ).length;

  return {
    normalSpellSources,
    fieldSpellEffectSources: hasFieldSpellEffect,
    spellTrapEffectSources,
    totalSources:
      normalSpellSources + hasFieldSpellEffect + spellTrapEffectSources,
  };
}

function describeInkCounterFlow(flow = {}) {
  const parts = [];
  if (flow.normalSpellSources > 0) {
    parts.push(`${flow.normalSpellSources} normal spell(s)`);
  }
  if (flow.fieldSpellEffectSources > 0) {
    parts.push("Grand Library effect");
  }
  if (flow.spellTrapEffectSources > 0) {
    parts.push(`${flow.spellTrapEffectSources} face-up spell effect(s)`);
  }
  return parts.length > 0
    ? parts.join(", ")
    : "no immediate Ink counter source";
}

function getNonCounterSetupSpellsAfterInk(analysis = {}) {
  return (analysis.hand || []).filter(
    (card) =>
      isArcanistSpell(card) &&
      card.name !== ARCANIST_NAMES.INK_RIVER &&
      !isNormalArcanistSpellCounterSource(card),
  );
}

function getStoredBlueprints(card) {
  const storage = card?.state?.blueprintStorage || card?.blueprintStorage;
  return Array.isArray(storage?.storedBlueprints) ? storage.storedBlueprints : [];
}

function getStoredBlueprintName(card) {
  const blueprint = getStoredBlueprints(card)[0];
  return (
    blueprint?.sourceCardName ||
    blueprint?.displayName ||
    blueprint?.effectSnapshot?.sourceCardName ||
    ""
  );
}

function canUseCombatBuffThisTurn(monster, analysis = {}) {
  return (
    monster &&
    monster.cardKind === "monster" &&
    !monster.isFacedown &&
    monster.position === "attack" &&
    !monster.hasAttacked &&
    !monster.cannotAttackThisTurn &&
    analysis.phase === "main1"
  );
}

function evaluateLightningLancePlan(analysis = {}) {
  const oppLp = analysis.oppLp ?? analysis.oppLP ?? analysis.opponent?.lp ?? 8000;
  const attackers = getOwnArcanistHosts(analysis).filter((monster) =>
    canUseCombatBuffThisTurn(monster, analysis),
  );
  const opponentMonsters = (analysis.oppField || []).filter(
    (card) => card && card.cardKind === "monster",
  );
  const faceUpOpponentMonsters = opponentMonsters.filter(
    (card) => !card.isFacedown,
  );

  let bestOffensivePlan = null;
  for (const attacker of attackers) {
    const baseAtk = getEffectiveAtk(attacker);
    const boostedAtk = baseAtk + 500;

    if (
      opponentMonsters.length === 0 &&
      !attacker.cannotAttackDirectly &&
      boostedAtk >= oppLp
    ) {
      const score = 120 + Math.max(0, oppLp - baseAtk) / 100;
      if (!bestOffensivePlan || score > bestOffensivePlan.score) {
        bestOffensivePlan = {
          attacker,
          score,
          priority: 11,
          reason: "Lightning Lance enables direct lethal",
        };
      }
      continue;
    }

    for (const target of opponentMonsters) {
      const battleStat = getCurrentBattleStat(target);
      const boostedClears = boostedAtk > battleStat;
      if (!boostedClears) continue;

      const baseClears = baseAtk > battleStat;
      const targetValue = evaluateArcanistCardValue(target, analysis);
      const battleDamage =
        target.position === "attack"
          ? Math.max(0, boostedAtk - getEffectiveAtk(target))
          : Math.max(0, boostedAtk - getEffectiveDef(target));
      const baseBattleDamage =
        target.position === "attack" && baseClears
          ? Math.max(0, baseAtk - getEffectiveAtk(target))
          : 0;
      const damageGain = Math.max(0, battleDamage - baseBattleDamage);
      const createsNewClear = !baseClears && boostedClears;
      const createsPiercingDamage = target.position === "defense" && battleDamage > 0;
      const createsLethal = battleDamage >= oppLp && baseBattleDamage < oppLp;

      if (!createsNewClear && !createsPiercingDamage && !createsLethal) {
        continue;
      }

      let score = targetValue;
      if (createsLethal) score += 110;
      if (createsNewClear) score += 80;
      if (createsPiercingDamage) score += 45 + Math.min(25, damageGain / 100);
      if (target.position === "attack") score += Math.min(18, battleDamage / 100);

      if (!bestOffensivePlan || score > bestOffensivePlan.score) {
        bestOffensivePlan = {
          attacker,
          target,
          score,
          priority: createsLethal ? 11 : createsNewClear ? 9.5 : 8.5,
          reason: createsLethal
            ? "Lightning Lance creates lethal battle damage"
            : createsNewClear
              ? "Lightning Lance lets an Arcanist destroy a threat"
              : "Lightning Lance creates piercing battle damage",
        };
      }
    }
  }

  if (bestOffensivePlan) {
    const attackerInstanceId = getCardInstanceId(bestOffensivePlan.attacker);
    const avoidInstanceIds = [
      ...getOwnArcanistHosts(analysis)
        .filter((card) => !isSameCardInstance(card, bestOffensivePlan.attacker))
        .map(getCardInstanceId),
      ...faceUpOpponentMonsters.map(getCardInstanceId),
    ].filter((id) => id !== null);
    return {
      ok: true,
      mode: "offense",
      target: bestOffensivePlan.attacker,
      targetNames: [bestOffensivePlan.attacker.name],
      targetInstanceIds: attackerInstanceId !== null ? [attackerInstanceId] : [],
      avoidInstanceIds,
      priority: bestOffensivePlan.priority,
      reason: bestOffensivePlan.reason,
    };
  }

  const lockTargets = faceUpOpponentMonsters
    .filter((target) => !target.cannotAttackThisTurn)
    .map((target) => ({
      target,
      score:
        evaluateArcanistCardValue(target, analysis) +
        getEffectiveAtk(target) / 1000 +
        (target.position === "attack" ? 4 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const lockPlan = lockTargets[0] || null;
  if (!lockPlan) {
    return { ok: false, reason: "no useful Lightning Lance target" };
  }

  const lockInstanceId = getCardInstanceId(lockPlan.target);
  return {
    ok: true,
    mode: "defense",
    target: lockPlan.target,
    targetNames: lockTargets.map((plan) => plan.target.name),
    targetInstanceIds: lockInstanceId !== null ? [lockInstanceId] : [],
    avoidInstanceIds: getOwnArcanistHosts(analysis)
      .map(getCardInstanceId)
      .filter((id) => id !== null),
    priority: 5,
    reason: "lock opponent attacker",
  };
}

function isLowValueDiscard(card, analysis = {}) {
  if (!card) return false;
  const hand = analysis.hand || [];
  const duplicates = getDuplicateNames(hand);
  if (duplicates.includes(card.name)) return true;
  if (card.name === ARCANIST_NAMES.MEETING) return true;
  if (
    card.name === ARCANIST_NAMES.GRIMOIRE &&
    hasFaceUpGrimoire(analysis) &&
    countByName(hand, ARCANIST_NAMES.GRIMOIRE) > 0
  ) {
    return true;
  }
  if (card.name === ARCANIST_NAMES.GRAND_LIBRARY && analysis.fieldSpell) {
    return true;
  }
  if (
    card.name === ARCANIST_NAMES.ICE_BARRIER &&
    !evaluateIceBarrierPlan(analysis).ok
  ) {
    return true;
  }
  if (
    card.name === ARCANIST_NAMES.CRIMSON_EXPLOSION &&
    !evaluateCrimsonExplosionPlan(analysis).ok
  ) {
    return true;
  }
  if (
    card.name === ARCANIST_NAMES.LIGHTNING_LANCE &&
    !evaluateLightningLancePlan(analysis).ok
  ) {
    return true;
  }
  return evaluateArcanistCardValue(card, analysis) <= 8;
}

function hasLowValueDiscard(analysis = {}) {
  return (analysis.hand || []).some((card) => isLowValueDiscard(card, analysis));
}

export function rankGrimoireHosts(hosts = [], analysis = {}) {
  const recoverableSpellNames = new Set(
    (analysis.graveyard || []).filter(isArcanistSpell).map((card) => card.name),
  );
  const hasRecoverableMonster = (analysis.graveyard || []).some(isArcanistMonster);
  const hasSmallRecoverableMonster = (analysis.graveyard || []).some(
    (card) => isArcanistMonster(card) && (card.level || 0) <= 4,
  );
  const opponentPressure =
    getStrongestBattleThreat(analysis.oppField || [], { includeBoosts: true }) >=
    2200;

  return [...hosts].sort((a, b) => {
    const equippedA = hasArcanistEquip(a) ? 1 : 0;
    const equippedB = hasArcanistEquip(b) ? 1 : 0;
    if (equippedA !== equippedB) return equippedA - equippedB;

    let rankA = getNameRank(a?.name, GRIMOIRE_HOST_ORDER);
    let rankB = getNameRank(b?.name, GRIMOIRE_HOST_ORDER);

    if ((analysis.oppField || []).length === 0) {
      if (a?.name === ARCANIST_NAMES.APPRENTICE) rankA -= 1;
      if (b?.name === ARCANIST_NAMES.APPRENTICE) rankB -= 1;
    }
    if (recoverableSpellNames.size > 0) {
      const spellRecoveryBonus = recoverableSpellNames.has(
        ARCANIST_NAMES.SEISMIC_IMPACT,
      )
        ? 7
        : 5;
      if (a?.name === ARCANIST_NAMES.VIRIDIS) rankA -= spellRecoveryBonus;
      if (b?.name === ARCANIST_NAMES.VIRIDIS) rankB -= spellRecoveryBonus;
    }
    if (hasRecoverableMonster && !opponentPressure) {
      if (a?.name === ARCANIST_NAMES.ALBUS) rankA -= 5;
      if (b?.name === ARCANIST_NAMES.ALBUS) rankB -= 5;
    }
    if (hasSmallRecoverableMonster && !opponentPressure) {
      if (a?.name === ARCANIST_NAMES.MASTER_OF_MIRRORS) rankA -= 4;
      if (b?.name === ARCANIST_NAMES.MASTER_OF_MIRRORS) rankB -= 4;
    }

    if (rankA !== rankB) return rankA - rankB;
    return evaluateArcanistCardValue(b, analysis) - evaluateArcanistCardValue(a, analysis);
  });
}

export function getBestGrimoireHostNames(analysis = {}) {
  return rankGrimoireHosts(getOwnArcanistHosts(analysis), analysis).map(
    (card) => card.name,
  );
}

function getDuplicateNames(cards = []) {
  const counts = new Map();
  for (const card of cards || []) {
    if (!card?.name) continue;
    counts.set(card.name, (counts.get(card.name) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name);
}

export function buildArcanistCostPreferences(analysis = {}) {
  const hand = analysis.hand || [];
  const duplicateNames = getDuplicateNames(hand);
  const activeGrimoire = hasFaceUpGrimoire(analysis);
  const hasFieldSpell = !!analysis.fieldSpell;

  const preferNames = [
    ...duplicateNames.filter(
      (name) =>
        ![
          ARCANIST_NAMES.SEISMIC_IMPACT,
          ARCANIST_NAMES.AZRATH,
          ARCANIST_NAMES.ELEMENTALIST,
        ].includes(name),
    ),
    ARCANIST_NAMES.MEETING,
    ...(hasFieldSpell ? [ARCANIST_NAMES.GRAND_LIBRARY] : []),
    ...(!evaluateIceBarrierPlan(analysis).ok
      ? [ARCANIST_NAMES.ICE_BARRIER]
      : []),
  ];

  const preserveNames = [
    ARCANIST_NAMES.SEISMIC_IMPACT,
    ARCANIST_NAMES.AZRATH,
    ARCANIST_NAMES.ELEMENTALIST,
    ...(!hasFieldSpell ? [ARCANIST_NAMES.GRAND_LIBRARY] : []),
    ...(!activeGrimoire ? [ARCANIST_NAMES.GRIMOIRE] : []),
    ...((analysis.graveyard || []).some(isArcanistSpell)
      ? [ARCANIST_NAMES.VIRIDIS]
      : []),
    ...((analysis.graveyard || []).some(isArcanistMonster)
      ? [ARCANIST_NAMES.ALBUS]
      : []),
  ];

  return {
    archetype: "Arcanist",
    preferNames: [...new Set(preferNames)],
    preserveNames: [...new Set(preserveNames)],
    offensivePayoffNames: [
      ARCANIST_NAMES.AZRATH,
      ARCANIST_NAMES.ELEMENTALIST,
      ARCANIST_NAMES.MASTER_OF_MIRRORS,
    ],
    availableOffensivePayoffs: [
      ...(analysis.hand || []),
      ...(analysis.deck || []),
      ...(analysis.field || []),
    ].filter((card) =>
      [
        ARCANIST_NAMES.AZRATH,
        ARCANIST_NAMES.ELEMENTALIST,
        ARCANIST_NAMES.MASTER_OF_MIRRORS,
      ].includes(card?.name),
    ).length,
    preserveLastOffensivePayoff: true,
  };
}

function getHighestValueOpponentNames(analysis = {}) {
  const cards = [
    ...(analysis.oppField || []),
    ...(analysis.oppSpellTrap || []),
    ...(analysis.oppFieldSpell ? [analysis.oppFieldSpell] : []),
  ].filter(Boolean);
  return cards
    .slice()
    .sort((a, b) => evaluateArcanistCardValue(b, analysis) - evaluateArcanistCardValue(a, analysis))
    .slice(0, 3)
    .map((card) => card.name);
}

function getCardInstanceId(card) {
  return card?.instanceId ?? card?.fieldPresenceId ?? null;
}

function isSameCardInstance(a, b) {
  if (!a || !b) return false;
  const aInstance = getCardInstanceId(a);
  const bInstance = getCardInstanceId(b);
  if (aInstance !== null && bInstance !== null) {
    return String(aInstance) === String(bInstance);
  }
  return a === b;
}

function isEquipAttachedToMonster(equip, monster) {
  if (!equip || !monster) return false;
  if (isSameCardInstance(equip.equippedTo, monster)) return true;
  return (monster.equips || []).some((attached) =>
    isSameCardInstance(attached, equip),
  );
}

function getFaceUpArcanistEquipCards(analysis = {}) {
  return (analysis.spellTrap || []).filter(
    (card) => card && !card.isFacedown && isArcanistEquip(card),
  );
}

function hasSeismicImpactSetup(analysis = {}) {
  return (
    getOwnArcanistHosts(analysis).some(hasArcanistEquip) &&
    getFaceUpArcanistEquipCards(analysis).length > 0
  );
}

function hasPremiumSeismicTarget(analysis = {}) {
  const oppCards = getOpponentCardCount(analysis);
  if (oppCards === 0) return false;
  const strongestBattle =
    analysis.oppStrongestBattle ??
    getStrongestBattleThreat(analysis.oppField || [], { includeBoosts: true });
  const canPressureLp =
    (analysis.oppLp ?? analysis.oppLP ?? analysis.opponent?.lp ?? 8000) <= 2500 &&
    getOwnArcanistHosts(analysis).some(
      (monster) => monster.position === "attack" && !monster.hasAttacked,
    );
  return (
    strongestBattle >= 2200 ||
    (analysis.oppSpellTrap || []).length > 0 ||
    !!analysis.oppFieldSpell ||
    oppCards >= 3 ||
    canPressureLp
  );
}

function getBattleProtectionThreat(analysis = {}) {
  return getStrongestBattleThreat(analysis.oppField || [], {
    includeBoosts: true,
  });
}

function hasPlausibleIceBarrierThreat(analysis = {}, { amplified = false } = {}) {
  const battleThreat = getBattleProtectionThreat(analysis);
  if (battleThreat > 0) return true;
  if (!amplified) return false;
  return (
    (analysis.oppSpellTrap || []).length > 0 ||
    !!analysis.oppFieldSpell ||
    getOpponentCardCount(analysis) >= 2
  );
}

function evaluateIceBarrierPlan(analysis = {}) {
  const hosts = getOwnArcanistHosts(analysis);
  if (hosts.length === 0) {
    return { ok: false, reason: "need face-up Arcanist target" };
  }

  const equippedHosts = hosts.filter(hasArcanistEquip);
  const amplified = equippedHosts.length > 0;
  if (!hasPlausibleIceBarrierThreat(analysis, { amplified })) {
    return {
      ok: false,
      reason: amplified
        ? "no plausible destruction threat"
        : "no battle threat to guard against",
    };
  }

  const battleThreat = getBattleProtectionThreat(analysis);
  const sortByValue = (a, b) =>
    evaluateArcanistCardValue(b, analysis) - evaluateArcanistCardValue(a, analysis);
  const targetPool = amplified ? equippedHosts : hosts;
  const target = [...targetPool].sort(sortByValue)[0];
  const targetValue = evaluateArcanistCardValue(target, analysis);
  const targetBattleStat = Math.max(target?.atk || 0, target?.def || 0);
  const underBattlePressure = battleThreat >= targetBattleStat;

  let priority = amplified ? 8.5 : 5.5;
  if (amplified) {
    priority += Math.min(hosts.length, 3) * 0.5;
  }
  if (underBattlePressure) priority += 1.25;
  if (targetValue >= 10) priority += 0.75;

  return {
    ok: true,
    amplified,
    target,
    targetNames: target ? [target.name] : [],
    targetInstanceId: getCardInstanceId(target),
    priority: Math.min(11, priority),
    reason: amplified
      ? "amplified Ice Barrier protects Arcanist board"
      : "battle guard for vulnerable Arcanist",
  };
}

function getCrimsonDamage(card) {
  return Math.max(0, Math.floor(((card?.atk || 0) * 0.5)));
}

function evaluateCrimsonExplosionPlan(analysis = {}) {
  const selfTargets = getOwnArcanistHosts(analysis);
  const opponentTargets = (analysis.oppField || []).filter(
    (card) => card?.cardKind === "monster" && !card.isFacedown,
  );
  if (selfTargets.length === 0 || opponentTargets.length === 0) {
    return { ok: false, reason: "need face-up targets for Crimson" };
  }

  const ownLp = analysis.lp ?? analysis.player?.lp ?? 8000;
  const opponentLp = analysis.oppLp ?? analysis.oppLP ?? analysis.opponent?.lp ?? 8000;
  const equipCards = getFaceUpArcanistEquipCards(analysis);
  const protectedNames = [
    ARCANIST_NAMES.AZRATH,
    ARCANIST_NAMES.ELEMENTALIST,
    ARCANIST_NAMES.MASTER_OF_MIRRORS,
  ];
  const strongestOpponentAtk = getStrongestAttackThreat(opponentTargets, {
    includeBoosts: true,
  });

  let best = null;
  for (const selfTarget of selfTargets) {
    const attachedEquips = equipCards.filter((equip) =>
      isEquipAttachedToMonster(equip, selfTarget),
    );
    const hasSurvivingEquip = equipCards.some(
      (equip) => !isEquipAttachedToMonster(equip, selfTarget),
    );
    const selfDamage = hasSurvivingEquip ? 0 : getCrimsonDamage(selfTarget);
    const losesLastMonster = selfTargets.length <= 1;
    const losesEquip = attachedEquips.length > 0;
    const protectedSelf = protectedNames.includes(selfTarget.name);
    const selfValue = evaluateArcanistCardValue(selfTarget, analysis);

    for (const opponentTarget of opponentTargets) {
      const opponentDamage = getCrimsonDamage(opponentTarget);
      const lethal = opponentDamage >= opponentLp;
      if (selfDamage >= ownLp) continue;
      if (!lethal && losesLastMonster) continue;
      if (!lethal && losesEquip) continue;
      if (!lethal && protectedSelf) continue;

      const opponentValue = evaluateArcanistCardValue(opponentTarget, analysis);
      const oneSided = selfDamage === 0;
      const removesThreat =
        (opponentTarget.atk || 0) >= 2200 ||
        strongestOpponentAtk >= 2200 ||
        opponentValue >= 9;
      const cleanTrade = selfValue <= 8 && opponentValue >= selfValue + 1;
      const worthwhile =
        lethal ||
        (oneSided && (removesThreat || opponentDamage >= 800)) ||
        (!oneSided && cleanTrade && removesThreat);
      if (!worthwhile) continue;

      let score = opponentValue * 4 + opponentDamage / 160;
      score -= selfValue * (oneSided ? 0.7 : 1.1);
      score -= selfDamage / 220;
      if (oneSided) score += 12;
      if (lethal) score += 35;
      if (removesThreat) score += 8;
      if (losesLastMonster) score -= 12;
      if (losesEquip) score -= 10;

      if (!best || score > best.score) {
        const priority = lethal
          ? 14
          : oneSided
            ? Math.min(12, 10 + Math.floor(opponentValue / 6))
            : removesThreat
              ? 8
              : 5;
        best = {
          ok: true,
          score,
          priority,
          selfTarget,
          opponentTarget,
          selfDamage,
          opponentDamage,
          oneSided,
          lethal,
          reason: lethal
            ? "safe Crimson lethal"
            : oneSided
              ? "one-sided Crimson removal"
              : "clean Crimson trade removal",
        };
      }
    }
  }

  return best || { ok: false, reason: "no safe Crimson trade" };
}

function getCheapArcanistNamesForCrimson(analysis = {}) {
  return (analysis.field || [])
    .filter((card) => isArcanistMonster(card) && !card.isFacedown)
    .slice()
    .sort((a, b) => {
      const equippedA = hasArcanistEquip(a) ? 1 : 0;
      const equippedB = hasArcanistEquip(b) ? 1 : 0;
      if (equippedA !== equippedB) return equippedA - equippedB;
      return evaluateArcanistCardValue(a, analysis) - evaluateArcanistCardValue(b, analysis);
    })
    .map((card) => card.name);
}

function getLibraryChoiceNames(analysis = {}) {
  const controlsMonster = getOwnArcanistHosts(analysis).length > 0;
  return controlsMonster
    ? ['Add an "Arcanist" Equip Spell']
    : ["Pay 2000 LP; Special Summon an Arcanist monster"];
}

function getMeetingChoiceNames(analysis = {}) {
  const monsters = (analysis.hand || []).filter(isArcanistMonster).length;
  const spells = (analysis.hand || []).filter(isArcanistSpell).length;
  const hasMonsterAccess =
    getOwnArcanistHosts(analysis).length > 0 ||
    (analysis.hand || []).some(isArcanistMonster);
  const hasSpellEngine =
    !!analysis.fieldSpell ||
    (analysis.hand || []).some((card) =>
      [ARCANIST_NAMES.GRAND_LIBRARY, ARCANIST_NAMES.GRIMOIRE].includes(
        card?.name,
      ),
    );

  if (!hasSpellEngine && monsters >= 2) {
    return ['Discard 2 "Arcanist" monsters'];
  }
  if (!hasMonsterAccess && spells >= 2) {
    return ['Discard 2 "Arcanist" Spells'];
  }
  return monsters >= spells
    ? ['Discard 2 "Arcanist" monsters']
    : ['Discard 2 "Arcanist" Spells'];
}

export function buildArcanistTargetPreferences(card, analysis = {}) {
  const opponentNames = getHighestValueOpponentNames(analysis);
  const grimoireHosts = getBestGrimoireHostNames(analysis);
  const isCrimsonSource =
    card?.name === ARCANIST_NAMES.CRIMSON_EXPLOSION ||
    (card?.name === ARCANIST_NAMES.GRIMOIRE &&
      getStoredBlueprintName(card) === ARCANIST_NAMES.CRIMSON_EXPLOSION);
  const crimsonPlan = isCrimsonSource
    ? evaluateCrimsonExplosionPlan(analysis)
    : null;
  const cheapArcanists = crimsonPlan?.ok
    ? [crimsonPlan.selfTarget.name]
    : getCheapArcanistNamesForCrimson(analysis);
  const crimsonSelfInstanceId = getCardInstanceId(crimsonPlan?.selfTarget);
  const crimsonOpponentInstanceId = getCardInstanceId(crimsonPlan?.opponentTarget);
  const crimsonAvoidSelfInstanceIds = isCrimsonSource
    ? getOwnArcanistHosts(analysis)
        .filter((candidate) => !isSameCardInstance(candidate, crimsonPlan?.selfTarget))
        .map(getCardInstanceId)
        .filter((id) => id !== null)
    : [];
  const iceBarrierPlan = evaluateIceBarrierPlan(analysis);
  const iceBarrierInstanceId = getCardInstanceId(iceBarrierPlan?.target);
  const teraPlan =
    card?.name === ARCANIST_NAMES.TERA
      ? evaluateTeraPositionPlan(card, analysis)
      : null;
  const isLightningSource =
    card?.name === ARCANIST_NAMES.LIGHTNING_LANCE ||
    (card?.name === ARCANIST_NAMES.GRIMOIRE &&
      getStoredBlueprintName(card) === ARCANIST_NAMES.LIGHTNING_LANCE);
  const lightningPlan = isLightningSource
    ? evaluateLightningLancePlan(analysis)
    : null;

  const spellRecoveryNames = sortByNameOrder(
    (analysis.graveyard || []).filter(isArcanistSpell),
    ARCANIST_SPELL_RECOVERY_ORDER,
  ).map((candidate) => candidate.name);
  const monsterRecoveryNames = sortByNameOrder(
    (analysis.graveyard || []).filter(isArcanistMonster),
    ARCANIST_MONSTER_RECOVERY_ORDER,
  ).map((candidate) => candidate.name);
  const seismicEquipCostNames = getFaceUpArcanistEquipCards(analysis)
    .slice()
    .sort(
      (a, b) =>
        evaluateArcanistCardValue(a, analysis) -
        evaluateArcanistCardValue(b, analysis),
    )
    .map((candidate) => candidate.name);

  const preferences = {
    grimoire_equip_target: {
      role: "named_preference",
      preferredNames: grimoireHosts,
    },
    seismic_impact_equip_cost: {
      role: "named_preference",
      preferredNames: seismicEquipCostNames,
    },
    seismic_impact_target: {
      role: "removal",
      preferredNames: opponentNames,
    },
    crimson_magic_self_target: {
      role: "named_preference",
      preferredNames: cheapArcanists,
      preferredInstanceIds:
        crimsonSelfInstanceId !== null ? [crimsonSelfInstanceId] : [],
      avoidInstanceIds: crimsonAvoidSelfInstanceIds,
      avoidNames: [
        ARCANIST_NAMES.AZRATH,
        ARCANIST_NAMES.ELEMENTALIST,
        ARCANIST_NAMES.MASTER_OF_MIRRORS,
      ],
    },
    crimson_magic_opponent_target: {
      role: "removal",
      preferredNames: crimsonPlan?.ok
        ? [crimsonPlan.opponentTarget.name]
        : opponentNames,
      preferredInstanceIds:
        crimsonOpponentInstanceId !== null ? [crimsonOpponentInstanceId] : [],
    },
    lightning_magic_lance_target: {
      role: lightningPlan?.mode === "offense" ? "named_preference" : "removal",
      intent: lightningPlan?.mode === "offense" ? "benefit" : "harm",
      preferredNames: lightningPlan?.ok
        ? lightningPlan.targetNames
        : (analysis.oppField || []).length > 0
          ? opponentNames
          : grimoireHosts,
      preferredInstanceIds: lightningPlan?.targetInstanceIds || [],
      avoidInstanceIds: lightningPlan?.avoidInstanceIds || [],
    },
    arcanist_ice_barrier_target: {
      role: "named_preference",
      preferredNames: iceBarrierPlan.ok ? iceBarrierPlan.targetNames : [],
      preferredInstanceIds:
        iceBarrierInstanceId !== null ? [iceBarrierInstanceId] : [],
    },
    tera_arcanist_earth_targets: {
      role: "removal",
      preferredNames: teraPlan?.ok ? teraPlan.targetNames : opponentNames,
      preferredInstanceIds: teraPlan?.targetInstanceIds || [],
      avoidInstanceIds: teraPlan?.avoidInstanceIds || [],
    },
    viridis_bounce_target: {
      role: "removal",
      preferredNames: opponentNames,
    },
    viridis_recover_target: {
      role: "named_preference",
      preferredNames: spellRecoveryNames,
    },
    albus_arcanist_ice_recover_target: {
      role: "recursion",
      preferredNames: monsterRecoveryNames,
      purpose: "value",
    },
    master_mirrors_arcanist_revive_target: {
      role: "recursion",
      preferredNames: monsterRecoveryNames,
      purpose: (analysis.oppField || []).length > 0 ? "stabilize" : "pressure",
      defensiveNames: [ARCANIST_NAMES.TERA, ARCANIST_NAMES.VIRIDIS],
      offensiveNames: [ARCANIST_NAMES.AZRATH, ARCANIST_NAMES.APPRENTICE],
    },
    master_mirrors_arcanist_spell_targets: {
      role: "named_preference",
      preferredNames: spellRecoveryNames,
    },
    elementalist_destroy_target: {
      role: "removal",
      preferredNames: opponentNames,
    },
    azrath_halve_target: {
      role: "removal",
      preferredNames: opponentNames,
    },
    action_case_choice: {
      role: "named_preference",
      preferredNames:
        card?.name === ARCANIST_NAMES.MEETING
          ? getMeetingChoiceNames(analysis)
          : getLibraryChoiceNames(analysis),
    },
  };

  return preferences;
}

export function buildArcanistSpecialSummonPositions() {
  return {
    default: "attack",
    byName: {
      [ARCANIST_NAMES.TERA]: "defense",
      [ARCANIST_NAMES.VIRIDIS]: "attack",
      [ARCANIST_NAMES.ALBUS]: "attack",
      [ARCANIST_NAMES.AZRATH]: "attack",
      [ARCANIST_NAMES.APPRENTICE]: "attack",
    },
    byTargetRef: {
      master_mirrors_arcanist_revive_target: "attack",
    },
  };
}

export function buildArcanistActivationContext(card, analysis = {}) {
  return {
    autoSelectTargets: true,
    autoSelectSingleTarget: true,
    logTargets: false,
    actionContext: {
      costPreferences: buildArcanistCostPreferences(analysis),
      targetPreferences: buildArcanistTargetPreferences(card, analysis),
      specialSummonPositions: buildArcanistSpecialSummonPositions(),
    },
  };
}

export function shouldSummonMonster(card, analysis = {}, tributeInfo = {}) {
  if (!card || card.cardKind !== "monster") {
    return { yes: false, reason: "not a monster" };
  }
  if (!isArcanistMonster(card)) {
    return { yes: false, reason: "not Arcanist" };
  }

  const field = analysis.field || [];
  const oppField = analysis.oppField || [];
  const tributesNeeded = tributeInfo.tributesNeeded || 0;
  if (field.length < tributesNeeded) {
    return { yes: false, reason: "insufficient tributes" };
  }

  if (tributesNeeded > 0) {
    const tributeIndices = selectBestTributes(field, tributesNeeded, card, {
      evaluationContext: analysis,
      oppField,
    });
    const tributes = tributeIndices.map((index) => field[index]).filter(Boolean);
    const costCheck = evaluateArcanistTributeTrade(card, tributes, analysis);
    if (!costCheck.ok) return { yes: false, reason: costCheck.reason };
  }

  const hasGrimoireInHand = (analysis.hand || []).some(
    (candidate) => candidate?.name === ARCANIST_NAMES.GRIMOIRE,
  );
  const hasEquip = controlsArcanistEquip(analysis.player);
  const oppStrongest = getStrongestBattleThreat(oppField, {
    includeBoosts: true,
  });

  if (card.name === ARCANIST_NAMES.APPRENTICE) {
    const canSearchSpell = (analysis.deck || []).some(isArcanistSpell);
    return {
      yes: true,
      position: "attack",
      priority: canSearchSpell ? 15 : 7,
      reason: canSearchSpell
        ? "normal summon searches Arcanist spell"
        : "starter body for Grimoire",
    };
  }

  if (card.name === ARCANIST_NAMES.AZRATH) {
    return {
      yes: true,
      position: "attack",
      priority: hasGrimoireInHand || oppField.length > 0 ? 11 : 7,
      reason: "best Grimoire host and spell debuff payoff",
    };
  }

  if (card.name === ARCANIST_NAMES.TERA) {
    return {
      yes: true,
      position: "attack",
      priority: oppField.length > 0 ? 8 : 5,
      reason: "position control body",
    };
  }

  if (card.name === ARCANIST_NAMES.VIRIDIS) {
    return {
      yes: true,
      position: "attack",
      priority: hasOpponentFaceUpSpell(analysis) ? 8 : 5,
      reason: "spell bounce and recovery body",
    };
  }

  if (card.name === ARCANIST_NAMES.ALBUS) {
    const alreadyHasArcanist = getOwnArcanistHosts(analysis).length > 0;
    return {
      yes: !alreadyHasArcanist,
      position: "attack",
      priority: alreadyHasArcanist ? 3 : 6,
      reason: alreadyHasArcanist
        ? "prefer hand special summon effect"
        : "normal summonable Arcanist body",
    };
  }

  if (card.name === ARCANIST_NAMES.MASTER_OF_MIRRORS) {
    const hasSpellGY = (analysis.graveyard || []).some(isArcanistSpell);
    return {
      yes: hasSpellGY || oppStrongest <= 2100 || hasGrimoireInHand,
      position: "attack",
      priority: hasSpellGY ? 9 : 6,
      reason: hasSpellGY
        ? "tribute summon recycles spells and draws"
        : "midgame body with Grimoire revive upside",
    };
  }

  if (card.name === ARCANIST_NAMES.ELEMENTALIST) {
    const worthTribute =
      oppField.length > 0 &&
      (hasGrimoireInHand || hasEquip || oppStrongest >= 2300);
    return {
      yes: worthTribute,
      position: "attack",
      priority: hasGrimoireInHand ? 11 : 8,
      reason: "finisher with effect protection and equipped removal",
    };
  }

  return {
    yes: true,
    position: "attack",
    priority: 4,
    reason: "generic Arcanist summon",
  };
}

export function shouldPlaySpell(card, analysis = {}) {
  if (!card || card.cardKind !== "spell") {
    return { yes: false, reason: "not a spell" };
  }
  if (!isArcanistSpell(card)) {
    return { yes: false, reason: "not Arcanist spell" };
  }

  const field = analysis.field || [];
  const hand = analysis.hand || [];
  const spellTrap = analysis.spellTrap || [];
  const oppField = analysis.oppField || [];
  const oppCards = getOpponentCardCount(analysis);
  const hasArcanistField = getOwnArcanistHosts(analysis).length > 0;
  const hasEquip = controlsArcanistEquip(analysis.player);
  const hasGrimoireActive = hasFaceUpGrimoire(analysis);

  if (card.name === ARCANIST_NAMES.GRAND_LIBRARY) {
    if (analysis.fieldSpell) {
      return { yes: false, reason: "field spell already active" };
    }
    return { yes: true, priority: 14, reason: "core field engine" };
  }

  if (card.name === ARCANIST_NAMES.GRIMOIRE) {
    const hosts = getOwnArcanistHosts(analysis).filter(
      (host) => !hasArcanistEquip(host),
    );
    if (hosts.length === 0) {
      return { yes: false, reason: "no face-up Arcanist host" };
    }
    if (hasGrimoireActive) {
      return { yes: false, reason: "Grimoire already controlled" };
    }
    const bestHost = rankGrimoireHosts(hosts, analysis)[0];
    let priority = 13;
    if (
      bestHost?.name === ARCANIST_NAMES.AZRATH ||
      bestHost?.name === ARCANIST_NAMES.ELEMENTALIST
    ) {
      priority += 2;
    }
    return {
      yes: true,
      priority,
      reason: `equip ${bestHost?.name || "best Arcanist"}`,
    };
  }

  if (card.name === ARCANIST_NAMES.SEISMIC_IMPACT) {
    if (!hasArcanistField) return { yes: false, reason: "need Arcanist field" };
    if (oppCards === 0) return { yes: false, reason: "no opposing card" };
    if (!hasSeismicImpactSetup(analysis)) {
      return {
        yes: false,
        reason: "need equipped Arcanist and Equip cost",
      };
    }
    if (!hasPremiumSeismicTarget(analysis)) {
      return {
        yes: false,
        priority: 1,
        reason: "hold Equip unless Seismic has a premium banish target",
      };
    }
    return {
      yes: true,
      priority: 11,
      reason: "spend Equip to banish opposing card",
    };
  }

  if (card.name === ARCANIST_NAMES.INK_RIVER) {
    if (hasFaceUpInkRiver(analysis)) {
      return { yes: false, reason: "Ink River already active" };
    }
    const gySpells = (analysis.graveyard || []).filter(isArcanistSpell).length;
    const flow = getInkCounterFlowAfterInk(analysis);
    const hasFlow = flow.totalSources > 0;
    const setupOnlySpells = getNonCounterSetupSpellsAfterInk(analysis);
    const priority = gySpells > 0 && hasFlow ? 16 : hasFlow ? 10 : 0;
    return {
      yes: hasFlow,
      priority,
      reason: hasFlow
        ? `sets up Ink counters via ${describeInkCounterFlow(flow)}`
        : setupOnlySpells.length > 0
          ? "permanent Arcanist spells in hand do not add Ink counters yet"
          : "needs an immediate Ink counter source",
    };
  }

  if (card.name === ARCANIST_NAMES.LIGHTNING_LANCE) {
    const plan = evaluateLightningLancePlan(analysis);
    if (!plan.ok) {
      return { yes: false, reason: plan.reason };
    }
    return {
      yes: true,
      priority: plan.priority,
      reason: plan.reason,
    };
  }

  if (card.name === ARCANIST_NAMES.ICE_BARRIER) {
    const plan = evaluateIceBarrierPlan(analysis);
    if (!plan.ok) {
      return { yes: false, reason: plan.reason };
    }
    return {
      yes: true,
      priority: plan.priority,
      reason: plan.reason,
    };
  }

  if (card.name === ARCANIST_NAMES.CRIMSON_EXPLOSION) {
    const plan = evaluateCrimsonExplosionPlan(analysis);
    if (!plan.ok) {
      return { yes: false, reason: plan.reason };
    }
    return {
      yes: true,
      priority: plan.priority,
      reason: plan.reason,
    };
  }

  if (card.name === ARCANIST_NAMES.MEETING) {
    if (hasFaceUpByName(spellTrap, ARCANIST_NAMES.MEETING)) {
      return { yes: false, reason: "Meeting already active" };
    }
    return {
      yes: hand.length >= 4,
      priority: 5,
      reason: "hand conversion engine",
    };
  }

  return { yes: true, priority: 3, reason: "generic Arcanist spell" };
}

export function shouldActivateSpellTrapEffect(card, analysis = {}) {
  if (!card || card.cardKind !== "spell" || card.isFacedown) {
    return { yes: false, reason: "not face-up spell" };
  }

  if (card.name === ARCANIST_NAMES.INK_RIVER) {
    const counters = getInkCounters(card);
    const gySpells = (analysis.graveyard || []).filter(isArcanistSpell).length;
    return {
      yes: counters >= 2 && gySpells > 0,
      priority: 15,
      reason: "recover Arcanist spell from GY",
    };
  }

  if (card.name === ARCANIST_NAMES.GRIMOIRE) {
    const storedName = getStoredBlueprintName(card);
    const storedCount = getStoredBlueprintCount(card);
    if (storedCount <= 0) {
      return { yes: false, reason: "no stored spell effect" };
    }

    if (storedName === ARCANIST_NAMES.SEISMIC_IMPACT) {
      const opponentTargets = getOpponentCardCount(analysis);
      const premiumTarget =
        hasSeismicImpactSetup(analysis) && hasPremiumSeismicTarget(analysis);
      return {
        yes: opponentTargets > 0 && premiumTarget,
        priority: 10,
        reason: premiumTarget
          ? "spend Equip on stored Seismic banish"
          : "hold stored Seismic until a premium Equip-cost banish exists",
      };
    }

    if (storedName === ARCANIST_NAMES.CRIMSON_EXPLOSION) {
      const plan = evaluateCrimsonExplosionPlan(analysis);
      if (!plan.ok) {
        return { yes: false, reason: plan.reason };
      }
      return {
        yes: true,
        priority: Math.max(8, plan.priority),
        reason: `stored ${plan.reason}`,
      };
    }

    if (storedName === ARCANIST_NAMES.ICE_BARRIER) {
      const plan = evaluateIceBarrierPlan(analysis);
      if (!plan.ok) {
        return { yes: false, reason: plan.reason };
      }
      return {
        yes: true,
        priority: Math.max(7, plan.priority - 0.5),
        reason: `stored ${plan.reason}`,
      };
    }

    if (storedName === ARCANIST_NAMES.LIGHTNING_LANCE) {
      const plan = evaluateLightningLancePlan(analysis);
      if (!plan.ok) {
        return { yes: false, reason: plan.reason };
      }
      return {
        yes: true,
        priority: Math.max(6, plan.priority - 0.5),
        reason: `stored ${plan.reason}`,
      };
    }

    return {
      yes: true,
      priority: 7,
      reason: "activate stored spell effect",
    };
  }

  if (card.name === ARCANIST_NAMES.MEETING) {
    const monsters = (analysis.hand || []).filter(isArcanistMonster).length;
    const spells = (analysis.hand || []).filter(isArcanistSpell).length;
    const missingEngine = !analysis.fieldSpell && !hasFaceUpByName(analysis.spellTrap || [], ARCANIST_NAMES.GRIMOIRE);
    const missingMonster = getOwnArcanistHosts(analysis).length === 0;
    return {
      yes:
        (monsters >= 2 && missingEngine) ||
        (spells >= 2 && missingMonster) ||
        (analysis.hand || []).length >= 5,
      priority: missingEngine || missingMonster ? 8 : 4,
      reason: "convert excess Arcanist cards",
    };
  }

  return { yes: false, reason: "no Arcanist spellTrap effect" };
}

export function shouldActivateMonsterEffect(card, analysis = {}) {
  if (!card || card.cardKind !== "monster" || card.isFacedown) {
    return { yes: false, reason: "not face-up monster" };
  }

  if (card.name === ARCANIST_NAMES.TERA) {
    const plan = evaluateTeraPositionPlan(card, analysis);
    return {
      yes: plan.ok,
      priority: plan.priority,
      reason: plan.reason,
    };
  }

  if (card.name === ARCANIST_NAMES.VIRIDIS) {
    return {
      yes: hasOpponentFaceUpSpell(analysis),
      priority: 7,
      reason: "bounce opposing face-up spell and gain LP",
    };
  }

  return { yes: false, reason: "no proactive monster effect" };
}

export function shouldActivateHandIgnition(card, analysis = {}) {
  if (card?.name !== ARCANIST_NAMES.ALBUS) {
    return { yes: false, reason: "not Albus hand effect" };
  }
  const hasArcanistField = getOwnArcanistHosts(analysis).length > 0;
  const fieldCapacity = 5 - (analysis.field || []).length;
  return {
    yes: hasArcanistField && fieldCapacity > 0,
    priority: 10,
    reason: "free Arcanist body from hand",
  };
}

export function getTributeRequirementFor(card, playerState) {
  return getGenericTributeRequirementFor(card, playerState);
}

function evaluateArcanistTributeValue(card, analysis = {}) {
  if (!card) return 0;
  let value = evaluateArcanistCardValue(card, analysis);
  if (hasArcanistEquip(card)) value += 20;
  if (card.name === ARCANIST_NAMES.AZRATH) value += 12;
  if (card.name === ARCANIST_NAMES.ELEMENTALIST) value += 20;
  if (card.name === ARCANIST_NAMES.MASTER_OF_MIRRORS) value += 10;
  if (card.hasAttacked || card.usedEffectThisTurn) value -= 2;
  return value;
}

export function selectBestTributes(field, tributesNeeded, cardToSummon, context = {}) {
  return selectGenericTributes(
    field,
    tributesNeeded,
    cardToSummon,
    context,
    {
      evaluateCardValue: (card, analysis) =>
        evaluateArcanistTributeValue(card, analysis),
    },
  );
}

export function evaluateArcanistTributeTrade(cardToSummon, tributes, analysis = {}) {
  return evaluateTributeSummonCost(
    cardToSummon,
    tributes,
    { evaluationContext: analysis },
    {
      isProtectedTribute: (card) =>
        hasArcanistEquip(card) ||
        [
          ARCANIST_NAMES.AZRATH,
          ARCANIST_NAMES.ELEMENTALIST,
          ARCANIST_NAMES.MASTER_OF_MIRRORS,
        ].includes(card?.name),
      evaluateSummonPayoff: (card) => {
        if (card?.name === ARCANIST_NAMES.ELEMENTALIST) {
          return { ok: true, reason: "Elementalist is a finisher payoff" };
        }
        if (
          card?.name === ARCANIST_NAMES.MASTER_OF_MIRRORS &&
          (analysis.graveyard || []).some(isArcanistSpell)
        ) {
          return { ok: true, reason: "Master recycles spells and draws" };
        }
        return { ok: false, reason: "no immediate Arcanist payoff" };
      },
    },
  );
}

export function rankSearchCandidates(cards = [], action = {}, ctx = {}) {
  const analysis = ctx.analysis || {};
  const sourceName = ctx.source?.name || "";
  const candidates = [...cards];

  const scoreCard = (card) => {
    if (!card) return -999;
    let score = evaluateArcanistCardValue(card, analysis);

    if (isArcanistEquip(card)) score += 2;
    if (card.name === ARCANIST_NAMES.GRAND_LIBRARY && !analysis.fieldSpell) {
      score += sourceName === ARCANIST_NAMES.APPRENTICE ? 8 : 4;
    }
    if (
      card.name === ARCANIST_NAMES.GRIMOIRE &&
      getOwnArcanistHosts(analysis).length > 0 &&
      !hasFaceUpByName(analysis.spellTrap || [], ARCANIST_NAMES.GRIMOIRE)
    ) {
      score += 7;
    }
    if (card.name === ARCANIST_NAMES.SEISMIC_IMPACT) {
      if (hasSeismicImpactSetup(analysis) && hasPremiumSeismicTarget(analysis)) {
        score += 5;
      } else {
        score -= 4;
      }
    }
    if (card.name === ARCANIST_NAMES.CRIMSON_EXPLOSION) {
      const crimsonPlan = evaluateCrimsonExplosionPlan(analysis);
      score += crimsonPlan.ok ? crimsonPlan.priority - 5 : -35;
    }
    if (card.name === ARCANIST_NAMES.ICE_BARRIER) {
      const icePlan = evaluateIceBarrierPlan(analysis);
      score += icePlan.ok ? icePlan.priority - 4 : -45;
    }
    if (card.name === ARCANIST_NAMES.INK_RIVER) {
      score += (analysis.hand || []).filter(isArcanistSpell).length >= 2 ? 3 : 0;
    }
    if (card.name === ARCANIST_NAMES.APPRENTICE && analysis.summonAvailable) {
      score += 5;
    }
    if (card.name === ARCANIST_NAMES.AZRATH && (analysis.oppField || []).length > 0) {
      score += 4;
    }
    if (card.name === ARCANIST_NAMES.TERA && (analysis.oppField || []).length > 0) {
      score += 2;
    }
    if (card.name === ARCANIST_NAMES.VIRIDIS && hasOpponentFaceUpSpell(analysis)) {
      score += 3;
    }

    if (action.zone === "graveyard" || ctx.source?.name === ARCANIST_NAMES.INK_RIVER) {
      const spellRank = getNameRank(card.name, ARCANIST_SPELL_RECOVERY_ORDER);
      const monsterRank = getNameRank(card.name, ARCANIST_MONSTER_RECOVERY_ORDER);
      score += Math.max(0, 20 - Math.min(spellRank, monsterRank));
    }

    return score;
  };

  return candidates.sort((a, b) => scoreCard(b) - scoreCard(a));
}

export function evaluateRecruitCandidate(cards = [], ctx = {}) {
  const analysis = ctx.analysis || {};
  const sourceName = ctx.source?.name || "";
  const scores = (cards || []).map((card) => {
    let score = evaluateArcanistCardValue(card, analysis);
    if (sourceName === ARCANIST_NAMES.GRAND_LIBRARY) {
      if (card.name === ARCANIST_NAMES.AZRATH && (analysis.oppField || []).length > 0) score += 7;
      if (card.name === ARCANIST_NAMES.TERA && (analysis.oppField || []).length > 0) score += 4;
      if (card.name === ARCANIST_NAMES.VIRIDIS && hasOpponentFaceUpSpell(analysis)) score += 4;
      if (card.name === ARCANIST_NAMES.ALBUS) score += 2;
      if (card.name === ARCANIST_NAMES.APPRENTICE) score -= 2;
    }
    if (sourceName === ARCANIST_NAMES.MASTER_OF_MIRRORS) {
      if (card.name === ARCANIST_NAMES.AZRATH && (analysis.oppField || []).length > 0) score += 5;
      if (card.name === ARCANIST_NAMES.APPRENTICE) score += 3;
      if (card.name === ARCANIST_NAMES.ALBUS) score += 2;
    }
    return { card, score };
  });
  scores.sort((a, b) => b.score - a.score);
  return { best: scores[0]?.card || null, scores };
}
