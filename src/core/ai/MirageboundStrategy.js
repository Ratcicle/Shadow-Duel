import BaseStrategy from "./BaseStrategy.js";
import { buildStrategyAnalysis } from "./common/analysis.js";
import {
  getGenericHandSpellActions,
  getGenericIgnitionEffectActions,
  getGenericNormalSummonActions,
} from "./common/actionGeneration.js";
import { getGenericSetBackrowActions } from "./common/backrowPlanning.js";
import { sequenceActionsByPriority } from "./common/actionSequencing.js";
import { findIgnitionEffect } from "./common/effectDiscovery.js";
import { getPiercingDamage } from "./common/cardStats.js";
import {
  buildAutoActivationContext,
} from "./common/preferencePolicy.js";
import {
  canActivateFieldSpellEffect,
  canActivateMonsterEffect,
  canActivateSpellFromHand,
  canActivateSpellTrapEffect,
} from "./common/previewGuards.js";
import { getGenericAscensionActions } from "./common/ascensionPlanning.js";
import { applyGenericSimulatedMainPhaseAction } from "./common/simulation.js";
import {
  buildMirageboundPlanningProfile,
  describeMirageboundPlannedLine,
  scoreMirageboundBattleAttackCandidate,
  scoreMirageboundLineMilestones,
  scoreMirageboundLineTerminal,
} from "./miragebound/linePlanning.js";
import { estimateCardValue, estimateMonsterValue } from "./StrategyUtils.js";

const MIRAGEBOUND = "Miragebound";

const MB = Object.freeze({
  SCOUT: "Miragebound Scout",
  DANCER: "Miragebound Dancer",
  JACKAL: "Miragebound Jackal",
  OASIS: "Miragebound Oasis",
  GLASS_SOVEREIGN: "Miragebound Glass Sovereign",
  GLASS_VIPER: "Miragebound Glass Viper",
  SAND_PRIESTESS: "Miragebound Sand Priestess",
  FALSE_KING: "Miragebound False King",
  MIRROR_PATH: "Miragebound Mirror Path",
  FALSE_HORIZON: "Miragebound False Horizon",
  VANISHING_STEP: "Miragebound Vanishing Step",
  HEAT_HAZE: "Miragebound Heat Haze",
  DESERT_LEVIATHAN: "Miragebound Desert Leviathan",
  REBEL: "Miragebound Rebel",
});

const OASIS_RETURN_LABEL = 'Return a "Miragebound" monster; weaken an opponent monster';
const OASIS_SHIFT_LABEL = "Change an opponent monster's position";

const RETURN_TARGET_IDS = [
  "miragebound_dancer_bounce_target",
  "miragebound_oasis_return_target",
  "miragebound_false_horizon_return_target",
  "miragebound_vanishing_step_return_target",
  "miragebound_glass_sovereign_return_self_target",
];

const RECURSION_TARGET_IDS = [
  "miragebound_sand_priestess_recover_target",
];

const DEFENSIVE_CHAIN_RESPONSE_NAMES = new Set([
  MB.FALSE_HORIZON,
  MB.VANISHING_STEP,
]);

function isSimulatedState(game) {
  return game?._isPerspectiveState === true;
}

function isMiragebound(card) {
  return (
    card?.archetype === MIRAGEBOUND ||
    (Array.isArray(card?.archetypes) && card.archetypes.includes(MIRAGEBOUND))
  );
}

function isFaceUpMonster(card) {
  return card?.cardKind === "monster" && !card.isFacedown;
}

function isFaceUpMirageboundMonster(card) {
  return isFaceUpMonster(card) && isMiragebound(card);
}

function hasMirageboundDefenseResponseInChain(chainSystem, player) {
  const stack = chainSystem?.getChainSummary?.() || [];
  return stack.some(
    (link) =>
      link?.controllerId === player?.id &&
      DEFENSIVE_CHAIN_RESPONSE_NAMES.has(link?.cardName),
  );
}

function hasName(cards = [], name) {
  return (cards || []).some((card) => card?.name === name);
}

function hasPositionChangeEffectAccess(base = {}, faceUpMiragebounds = []) {
  const hand = base.hand || [];
  const spellTrap = base.spellTrap || [];
  const controlsMiragebound = faceUpMiragebounds.length > 0;
  return (
    hasName(faceUpMiragebounds, MB.SCOUT) ||
    hasName(faceUpMiragebounds, MB.SAND_PRIESTESS) ||
    hasName(faceUpMiragebounds, MB.FALSE_KING) ||
    hasName(faceUpMiragebounds, MB.GLASS_SOVEREIGN) ||
    base.fieldSpell?.name === MB.OASIS ||
    (controlsMiragebound && hasName(hand, MB.HEAT_HAZE)) ||
    (controlsMiragebound &&
      (hasName(hand, MB.VANISHING_STEP) ||
        hasName(spellTrap, MB.VANISHING_STEP)))
  );
}

function getRebelPositionEffectBonus(analysis = {}) {
  if (!analysis.hasRebelOpenZoneTriggerWindow) return 0;
  return analysis.hasRebelPiercingPressure ? 2.4 : 1.4;
}

function getEffectiveAtk(card) {
  return (
    Number(card?.atk || 0) +
    Number(card?.tempAtkBoost || 0) +
    Number(card?.equipAtkBonus || 0)
  );
}

function getEffectiveDef(card) {
  return (
    Number(card?.def || 0) +
    Number(card?.tempDefBoost || 0) +
    Number(card?.equipDefBonus || 0)
  );
}

function getBattleStat(card) {
  if (!card || card.cardKind !== "monster") return 0;
  if (card.isFacedown) return 1500;
  return card.position === "defense" ? getEffectiveDef(card) : getEffectiveAtk(card);
}

function getMaterialEffectActivations(game, player, materialId) {
  if (!player || !Number.isFinite(materialId)) return 0;
  const stats = game?.materialDuelStats || game?._gameRef?.materialDuelStats;
  return (
    stats?.[
      player.id
    ]?.effectActivationsByMaterialId?.get?.(materialId) || 0
  );
}

function getFieldCapacity(player) {
  return Math.max(0, 5 - ((player?.field || []).length || 0));
}

function getOpponentCards(analysis) {
  return [
    ...(analysis.oppField || []),
    ...(analysis.oppSpellTrap || []),
    ...(analysis.oppFieldSpell ? [analysis.oppFieldSpell] : []),
  ].filter(Boolean);
}

function hasOpenMonsterZoneAfterBounce(analysis) {
  return analysis.fieldCapacity > 0 || analysis.faceUpMiragebounds.length > 0;
}

function getCardInstanceIds(card) {
  return [
    card?.instanceId,
    card?._instanceId,
    card?.uid,
    card?.uuid,
    card?.simInstanceId,
    card?.fieldPresenceId,
  ].filter((id) => id !== null && id !== undefined);
}

function getCardsByNames(cards = [], names = []) {
  const wanted = new Set(names);
  return (cards || []).filter((card) => wanted.has(card?.name));
}

function getInstanceIds(cards = []) {
  const result = [];
  const seen = new Set();
  for (const id of (cards || []).flatMap(getCardInstanceIds)) {
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(id);
  }
  return result;
}

function buildMaterialHint(card, index) {
  return {
    index,
    id: card?.id,
    name: card?.name,
    instanceIds: getCardInstanceIds(card),
  };
}

function hasCardStatus(card, status) {
  if (!card || !status) return false;
  if (card[status]) return true;
  if (Array.isArray(card.statuses) && card.statuses.includes(status)) return true;
  if (card.status === status) return true;
  return false;
}

function getOwnerId(ownerLike) {
  if (!ownerLike) return null;
  if (typeof ownerLike === "string") return ownerLike;
  return ownerLike.id || ownerLike.controller || ownerLike.owner || null;
}

function uniqueValues(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function mergePreference(base = {}, patch = {}) {
  return {
    ...(base || {}),
    ...(patch || {}),
    preferredInstanceIds: uniqueValues([
      ...(patch.preferredInstanceIds || []),
      ...(base.preferredInstanceIds || []),
    ]),
    avoidInstanceIds: uniqueValues([
      ...(patch.avoidInstanceIds || []),
      ...(base.avoidInstanceIds || []),
    ]),
    preferredNames: uniqueValues([
      ...(patch.preferredNames || []),
      ...(base.preferredNames || []),
    ]),
    avoidNames: uniqueValues([
      ...(patch.avoidNames || []),
      ...(base.avoidNames || []),
    ]),
  };
}

function mergeTargetPreference(activationContext, targetId, patch) {
  if (!activationContext || !targetId || !patch) return activationContext;
  const actionContext = {
    ...(activationContext.actionContext || {}),
  };
  const targetPreferences = {
    ...(actionContext.targetPreferences || {}),
  };
  targetPreferences[targetId] = mergePreference(
    targetPreferences[targetId],
    patch,
  );
  actionContext.targetPreferences = targetPreferences;
  return {
    ...activationContext,
    actionContext,
  };
}

function getIncomingBattleThreat(context = {}, player, analysis = {}) {
  const attacker = context.attacker || null;
  const defender = context.defender || context.target || null;
  const attackerOwnerId =
    getOwnerId(context.attackerOwner) || getOwnerId(attacker);
  const defenderOwnerId =
    getOwnerId(context.defenderOwner) ||
    getOwnerId(context.targetOwner) ||
    getOwnerId(defender);
  const isAttack =
    context.type === "attack_declaration" ||
    context.type === "battle_damage";
  const isOpponentAttack =
    isAttack &&
    attacker &&
    attackerOwnerId &&
    attackerOwnerId !== player?.id;
  const defendingSelf =
    !defender || !defenderOwnerId || defenderOwnerId === player?.id;

  if (!isOpponentAttack || !defendingSelf) {
    return {
      isOpponentAttack: false,
      damage: 0,
      loseMonster: false,
      lethal: false,
      highThreat: false,
      attacker,
      defender,
    };
  }

  const atk = getEffectiveAtk(attacker);
  let damage = 0;
  let loseMonster = false;
  if (!defender) {
    damage = atk;
  } else if (defender.position === "defense") {
    const defenderStat = getEffectiveDef(defender);
    loseMonster = atk > defenderStat;
    damage = getPiercingDamage(attacker, atk, defenderStat);
  } else {
    const defenderStat = getEffectiveAtk(defender);
    loseMonster = atk >= defenderStat;
    damage = Math.max(0, atk - defenderStat);
  }

  const lethal = damage >= Number(player?.lp || 0);
  const highThreat =
    lethal ||
    loseMonster ||
    damage >= 800 ||
    atk >= 2000 ||
    analysis.oppPressure === true;

  return {
    isOpponentAttack,
    damage,
    loseMonster,
    lethal,
    highThreat,
    attacker,
    defender,
  };
}

function isMeaningfulChainBattleThreat(threat = {}, analysis = {}) {
  if (!threat.isOpponentAttack) return false;
  const attackerAtk = getEffectiveAtk(threat.attacker);
  return (
    threat.lethal ||
    threat.loseMonster ||
    threat.damage >= 700 ||
    attackerAtk >= 2000 ||
    (analysis.needsBattleProtection &&
      (threat.damage >= 400 || attackerAtk >= 1700))
  );
}

function isOpponentEffectTargetingSelf(context = {}, player) {
  if (context.type !== "effect_targeted") return false;
  const sourceOwnerId =
    getOwnerId(context.player) ||
    getOwnerId(context.sourceOwner) ||
    getOwnerId(context.card);
  const target = context.target || context.defender || context.eventCard || null;
  const targetOwnerId =
    getOwnerId(context.targetOwner) ||
    getOwnerId(context.defenderOwner) ||
    getOwnerId(target);
  return (
    sourceOwnerId &&
    sourceOwnerId !== player?.id &&
    target &&
    (!targetOwnerId || targetOwnerId === player?.id)
  );
}

function hasUsefulChainBounceTarget(analysis = {}) {
  return (analysis.faceUpMiragebounds || []).some((card) => {
    if (!card || card.name === MB.FALSE_KING) return false;
    if (card.name === MB.SCOUT && analysis.preserveScout) return false;
    if (card.name === MB.GLASS_SOVEREIGN || card.name === MB.DESERT_LEVIATHAN) {
      return false;
    }
    return true;
  });
}

function getBestOwnBattleStat(analysis = {}) {
  const ownMonsters = (analysis.field || []).filter(isFaceUpMonster);
  return ownMonsters.reduce(
    (best, card) => Math.max(best, getEffectiveAtk(card), getEffectiveDef(card)),
    0,
  );
}

function isAttackPositionThreat(card) {
  return card?.cardKind === "monster" && !card.isFacedown && card.position === "attack";
}

function canReUseViperAfterBounce(analysis = {}) {
  return analysis.availableMonsterZonesAfterBounce > 0;
}

function buildBounceTargetBuckets(analysis = {}) {
  const faceUpMiragebounds = analysis.faceUpMiragebounds || [];
  const preferred = [];
  const avoided = [];

  const addPreferred = (cards) => {
    preferred.push(...(cards || []));
  };
  const addAvoided = (cards) => {
    avoided.push(...(cards || []));
  };

  if (analysis.hasViperBouncePayoff && canReUseViperAfterBounce(analysis)) {
    addPreferred(getCardsByNames(faceUpMiragebounds, [MB.GLASS_VIPER]));
  } else if (hasName(faceUpMiragebounds, MB.GLASS_VIPER)) {
    addAvoided(getCardsByNames(faceUpMiragebounds, [MB.GLASS_VIPER]));
  }

  if (analysis.hasPriestessBouncePayoff) {
    addPreferred(getCardsByNames(faceUpMiragebounds, [MB.SAND_PRIESTESS]));
  }

  const dancer = getCardsByNames(faceUpMiragebounds, [MB.DANCER]);
  if (analysis.fieldCapacity > 0 || analysis.hasOasisActive) {
    addPreferred(dancer);
  }

  if (!analysis.preserveScout) {
    addPreferred(getCardsByNames(faceUpMiragebounds, [MB.SCOUT]));
  } else {
    addAvoided(getCardsByNames(faceUpMiragebounds, [MB.SCOUT]));
  }

  addPreferred(getCardsByNames(faceUpMiragebounds, [MB.JACKAL]));

  if (!analysis.canKeepOffenseAfterBounce) {
    addAvoided(getCardsByNames(faceUpMiragebounds, [
      MB.DANCER,
      MB.JACKAL,
      MB.FALSE_KING,
      MB.GLASS_SOVEREIGN,
      MB.DESERT_LEVIATHAN,
      MB.REBEL,
    ]));
  }

  addAvoided(getCardsByNames(faceUpMiragebounds, [MB.FALSE_KING]));
  addAvoided(getCardsByNames(faceUpMiragebounds, [MB.REBEL]));

  return {
    preferred,
    avoided,
    preferredInstanceIds: getInstanceIds(preferred),
    avoidInstanceIds: getInstanceIds(avoided),
  };
}

function buildBounceNameProfile(analysis = {}) {
  const buckets = buildBounceTargetBuckets(analysis);
  const preferred = [];
  if (analysis.hasViperBouncePayoff && canReUseViperAfterBounce(analysis)) {
    preferred.push(MB.GLASS_VIPER);
  }
  if (analysis.hasPriestessBouncePayoff) preferred.push(MB.SAND_PRIESTESS);
  preferred.push(MB.DANCER, MB.JACKAL);
  if (!analysis.preserveScout) preferred.push(MB.SCOUT);

  const preserveNames = analysis.preserveScout ? [MB.SCOUT] : [];
  const avoidNames = analysis.preserveScout ? [MB.SCOUT] : [];
  if (analysis.hasRebelInField) {
    preserveNames.push(MB.REBEL);
    avoidNames.push(MB.REBEL);
  }

  return {
    preferredNames: [...new Set(preferred)],
    preserveNames: [...new Set(preserveNames)],
    avoidNames: [...new Set(avoidNames)],
    preferredInstanceIds: buckets.preferredInstanceIds,
    avoidInstanceIds: buckets.avoidInstanceIds,
  };
}

function scorePositionTarget(card, analysis = {}, { preferDefenseOutcome = true } = {}) {
  if (!card || card.cardKind !== "monster") return -100;
  const battleStat = getBattleStat(card);
  const atk = getEffectiveAtk(card);
  const def = getEffectiveDef(card);
  const ownBest = getBestOwnBattleStat(analysis);
  let score = estimateMonsterValue(card) * 10 + battleStat / 100;

  if (card.monsterType === "fusion" || card.monsterType === "ascension") score += 18;
  if ((card.level || 0) >= 7) score += 10;
  if (card.positionChangedThisTurn) score -= 35;
  if (card.isFacedown) score += preferDefenseOutcome ? -8 : 4;

  if (preferDefenseOutcome) {
    if (card.position === "attack") score += 28 + Math.max(0, atk - def) / 80;
    if (card.position === "defense") score -= 18;
  } else if (card.position === "defense") {
    score += 4;
  }

  if (ownBest > 0 && card.position === "attack" && ownBest > Math.max(0, def - 500)) {
    score += 8;
  }
  if (analysis.hasOasisActive && !card.positionChangedThisTurn) score += 8;
  if (analysis.hasSovereignInField && card.position === "attack") score += 8;
  if (
    analysis.hasRebelOpenZoneTriggerWindow &&
    preferDefenseOutcome &&
    card.position === "attack"
  ) {
    score += 10;
  }

  return score;
}

function rankOpponentMonstersForPosition(analysis = {}, options = {}) {
  return (analysis.opponentMonsters || [])
    .slice()
    .sort(
      (a, b) =>
        scorePositionTarget(b, analysis, options) -
        scorePositionTarget(a, analysis, options),
    );
}

function rankOpponentCardsForRemoval(analysis = {}) {
  return getOpponentCards(analysis)
    .slice()
    .sort((a, b) => {
      const score = (card) => {
        if (!card) return -100;
        let value = estimateCardValue(card) * 10;
        if (card.cardKind === "monster") {
          value += estimateMonsterValue(card) * 12 + getBattleStat(card) / 100;
          if (card.monsterType === "fusion" || card.monsterType === "ascension") {
            value += 20;
          }
          if ((card.level || 0) >= 7) value += 8;
        }
        if (card === analysis.oppFieldSpell) value += 14;
        if (card.cardKind === "spell" || card.cardKind === "trap") value += 7;
        if (card.subtype === "field" || card.subtype === "continuous") value += 5;
        return value;
      };
      return score(b) - score(a);
    });
}

function buildOpponentPositionPreference(analysis = {}, sourceCard = null) {
  const preferAttackTargets =
    sourceCard?.name === MB.HEAT_HAZE ||
    sourceCard?.name === MB.GLASS_SOVEREIGN ||
    sourceCard?.name === MB.SCOUT ||
    sourceCard?.name === MB.OASIS ||
    sourceCard?.name === MB.FALSE_HORIZON ||
    sourceCard?.name === MB.FALSE_KING ||
    sourceCard?.name === MB.JACKAL;
  const ranked = rankOpponentMonstersForPosition(analysis, {
    preferDefenseOutcome: preferAttackTargets,
  });
  const preferred = ranked.filter((card) =>
    preferAttackTargets ? isAttackPositionThreat(card) : true,
  );
  const avoided = ranked.filter(
    (card) =>
      card?.positionChangedThisTurn ||
      (preferAttackTargets && card?.position === "defense"),
  );

  return {
    intent: "harm",
    role: "named_preference",
    preferredInstanceIds: getInstanceIds(preferred.length > 0 ? preferred : ranked),
    avoidInstanceIds: getInstanceIds(avoided),
  };
}

function buildOpponentDebuffPreference(analysis = {}, sourceCard = null) {
  const reduction =
    sourceCard?.name === MB.GLASS_VIPER ||
    sourceCard?.name === MB.SAND_PRIESTESS ||
    sourceCard?.name === MB.VANISHING_STEP
      ? 500
      : sourceCard?.name === MB.OASIS || analysis.hasOasisActive
        ? 400
        : analysis.hasDesertLeviathan
          ? 300
          : 0;
  const ranked = rankOpponentMonstersForPosition(analysis, {
    preferDefenseOutcome:
      sourceCard?.name === MB.SAND_PRIESTESS ||
      sourceCard?.name === MB.VANISHING_STEP,
  });

  return {
    intent: "harm",
    role: reduction > 0 ? "temporary_stat_debuff" : "removal",
    purpose: "combat",
    attackers: analysis.readyAttackers || [],
    opponentLp: analysis.oppLp || analysis.oppLP || 0,
    atkReduction: reduction,
    defReduction: reduction,
    preferredInstanceIds: getInstanceIds(ranked),
    avoidInstanceIds: getInstanceIds(
      ranked.filter((card) => card?.positionChangedThisTurn),
    ),
  };
}

function buildOpponentRemovalPreference(analysis = {}) {
  const ranked = rankOpponentCardsForRemoval(analysis);
  return {
    intent: "harm",
    role: "removal",
    preferredInstanceIds: getInstanceIds(ranked),
  };
}

function buildMirageboundTargetPreferences(sourceCard, analysis = {}) {
  const bounceProfile = buildBounceNameProfile(analysis);
  const bouncePreference = {
    intent: "benefit",
    role: "named_preference",
    preferredNames: bounceProfile.preferredNames,
    avoidNames: bounceProfile.avoidNames,
    preferredInstanceIds: bounceProfile.preferredInstanceIds,
    avoidInstanceIds: bounceProfile.avoidInstanceIds,
  };
  const positionPreference = buildOpponentPositionPreference(analysis, sourceCard);
  const debuffPreference = buildOpponentDebuffPreference(analysis, sourceCard);
  const removalPreference = buildOpponentRemovalPreference(analysis);
  const recursionPreference = {
    intent: "benefit",
    role: "recursion",
    purpose: analysis.oppPressure ? "defense" : "value",
    preferredNames: [
      MB.GLASS_VIPER,
      MB.SCOUT,
      MB.DANCER,
      MB.SAND_PRIESTESS,
      MB.FALSE_KING,
      MB.REBEL,
      MB.JACKAL,
    ],
    defensiveNames: [MB.SAND_PRIESTESS, MB.GLASS_VIPER],
    offensiveNames: [MB.FALSE_KING, MB.REBEL, MB.DANCER, MB.JACKAL],
  };

  const targetPreferences = {
    action_case_choice: {
      intent: "benefit",
      role: "named_preference",
      preferredNames: analysis.hasMeaningfulBounce
        ? [OASIS_RETURN_LABEL]
        : [OASIS_SHIFT_LABEL],
      avoidNames: analysis.hasMeaningfulBounce
        ? [OASIS_SHIFT_LABEL]
        : [OASIS_RETURN_LABEL],
    },
    miragebound_false_king_return_cost: {
      intent: "cost",
      role: "cost",
      preferNames: bounceProfile.preferredNames,
      preserveNames: bounceProfile.preserveNames,
      preferredInstanceIds: bounceProfile.preferredInstanceIds,
      avoidInstanceIds: bounceProfile.avoidInstanceIds,
    },
    miragebound_mirror_path_spell_trap_target: {
      intent: "harm",
      role: "removal",
      preferredInstanceIds: getInstanceIds(
        [analysis.oppFieldSpell, ...(analysis.oppSpellTrap || [])].filter(Boolean),
      ),
    },
  };

  for (const id of RETURN_TARGET_IDS) {
    targetPreferences[id] = bouncePreference;
  }
  [
    "miragebound_scout_position_target",
    "miragebound_jackal_return_shift_target",
    "miragebound_oasis_weaken_target",
    "miragebound_glass_sovereign_shift_targets",
    "miragebound_false_king_shift_target",
    "miragebound_false_horizon_position_target",
    "miragebound_heat_haze_position_target",
  ].forEach((id) => {
    targetPreferences[id] = positionPreference;
  });
  [
    "miragebound_oasis_return_weaken_target",
    "miragebound_glass_viper_debuff_target",
    "miragebound_sand_priestess_shift_debuff_target",
    "miragebound_vanishing_step_position_target",
  ].forEach((id) => {
    targetPreferences[id] = debuffPreference;
  });
  targetPreferences.miragebound_glass_sovereign_return_opponent_target =
    removalPreference;
  for (const id of RECURSION_TARGET_IDS) {
    targetPreferences[id] = recursionPreference;
  }

  return targetPreferences;
}

function buildMirageboundCostPreferences(analysis = {}) {
  const bounceProfile = buildBounceNameProfile(analysis);
  return {
    archetype: MIRAGEBOUND,
    preferNames: bounceProfile.preferredNames,
    preserveNames: bounceProfile.preserveNames,
    offensivePayoffNames: [
      MB.FALSE_KING,
      MB.DANCER,
      MB.GLASS_SOVEREIGN,
      MB.DESERT_LEVIATHAN,
      MB.REBEL,
    ],
    preserveLastOffensivePayoff: true,
  };
}

function buildSpecialSummonPositions(analysis = {}) {
  const viperPosition =
    analysis.oppPressure &&
    !analysis.canViperPressureAfterSummon &&
    !analysis.hasLeviathanMaterials
      ? "defense"
      : "attack";
  return {
    byName: {
      [MB.DANCER]: "attack",
      [MB.JACKAL]: "attack",
      [MB.FALSE_KING]: "attack",
      [MB.GLASS_VIPER]: viperPosition,
      [MB.SAND_PRIESTESS]: "defense",
      [MB.GLASS_SOVEREIGN]: "attack",
      [MB.DESERT_LEVIATHAN]: "attack",
      [MB.REBEL]: "attack",
    },
  };
}

function buildMirageboundActivationContext(
  sourceCard,
  analysis = {},
  options = {},
) {
  const zone = options.zone || options.activationZone || "field";
  return buildAutoActivationContext({
    zone,
    sourceZone: options.sourceZone || zone,
    activationZone: options.activationZone || zone,
    fromHand: options.fromHand === true || zone === "hand",
    autoSelectTargets: true,
    autoSelectSingleTarget: true,
    logTargets: false,
    costPreferences: buildMirageboundCostPreferences(analysis),
    targetPreferences: buildMirageboundTargetPreferences(sourceCard, analysis),
    specialSummonPositions: buildSpecialSummonPositions(analysis),
    actionContext: {
      archetype: MIRAGEBOUND,
      sourceName: sourceCard?.name || null,
      effectId: options.effect?.id || null,
    },
  });
}

function shouldPlayMirageboundSpell(card, analysis = {}) {
  const name = card?.name;
  if (name === MB.OASIS) {
    if (analysis.hasOasisActive) return { yes: false };
    return { yes: true, priority: 13, reason: "establish Oasis engine" };
  }

  if (name === MB.HEAT_HAZE) {
    if (analysis.faceUpMiragebounds.length === 0) return { yes: false };
    if (analysis.opponentMonsters.length === 0) return { yes: false };
    const hasRecursion = analysis.mirageboundGraveyard.length > 0;
    const rebelBonus = getRebelPositionEffectBonus(analysis);
    const priority =
      (hasRecursion ? 8.5 : analysis.hasOasisActive ? 6.5 : 5.5) +
      rebelBonus;
    return {
      yes: true,
      priority,
      reason: analysis.hasRebelOpenZoneTriggerWindow
        ? "shift threat and trigger Rebel extender"
        : hasRecursion
          ? "shift threat and recover Miragebound"
          : "shift threat",
    };
  }

  if (name === MB.VANISHING_STEP) {
    if (analysis.faceUpMiragebounds.length === 0) return { yes: false };
    if (analysis.opponentMonsters.length === 0) return { yes: false };
    const rebelPayoff = analysis.hasRebelVanishingStepWindow;
    if (!analysis.hasMeaningfulBounce && !rebelPayoff) return { yes: false };
    return {
      yes: true,
      priority: analysis.hasMeaningfulBounce ? 9.5 : 7.4,
      reason: rebelPayoff
        ? "bounce to trigger Rebel hand extender"
        : "cash in bounce payoff now",
    };
  }

  if (name === MB.MIRROR_PATH) {
    const alreadyControls = hasName(analysis.spellTrap || [], MB.MIRROR_PATH);
    if (alreadyControls) return { yes: false };
    return {
      yes: true,
      priority: analysis.oppPressure ? 7 : 5.5,
      reason: "establish Miragebound battle protection",
    };
  }

  return { yes: false };
}

function shouldSetMirageboundBackrow(card, analysis = {}) {
  if (card?.name === MB.FALSE_HORIZON) {
    return {
      yes: true,
      priority: analysis.oppPressure ? 6 : 4.5,
      reason: "prepare attack response",
    };
  }
  if (card?.name === MB.VANISHING_STEP) {
    return {
      yes: true,
      priority: analysis.hasMeaningfulBounce ? 5.5 : 3.5,
      reason: "hold quick bounce for opponent turn",
    };
  }
  return { yes: false };
}

function shouldSummonMirageboundMonster(card, analysis = {}, tributeInfo = {}) {
  if (!card || card.cardKind !== "monster") return { yes: false };
  if (card.name === MB.REBEL) return { yes: false };
  if (card.name === MB.FALSE_KING) return { yes: false };
  if ((tributeInfo.tributesNeeded || 0) > 0) return { yes: false };

  if (card.name === MB.SCOUT) {
    return {
      yes: true,
      priority: analysis.hasOasisActive ? 11.5 : 12,
      position: "attack",
      reason: "normal summon Scout starter",
    };
  }

  if (card.name === MB.SAND_PRIESTESS) {
    return {
      yes: true,
      priority: analysis.mirageboundGraveyard.length > 0 ? 8.2 : 7.2,
      position: analysis.oppPressure ? "defense" : "attack",
      reason: "set up Priestess control",
    };
  }

  if (card.name === MB.GLASS_VIPER) {
    return {
      yes: true,
      priority: analysis.hasLeviathanMaterials ? 8 : 7,
      position: analysis.oppPressure ? "defense" : "attack",
      reason: "set up Viper bounce payoff",
    };
  }

  if (card.name === MB.DANCER) {
    return {
      yes: true,
      priority: analysis.faceUpMiragebounds.length > 0 ? 6.5 : 5.5,
      position: "attack",
      reason: "normal summon Dancer body",
    };
  }

  if (card.name === MB.JACKAL) {
    if (analysis.hasPlannedBounce) return { yes: false };
    return {
      yes: true,
      priority: 4.5,
      position: "attack",
      reason: "normal summon Jackal only without bounce line",
    };
  }

  if (isMiragebound(card)) {
    return {
      yes: true,
      priority: 3,
      position: "attack",
      reason: "summon Miragebound body",
    };
  }

  return { yes: false };
}

function shouldActivateHandIgnition(card, analysis = {}) {
  if (card?.name === MB.DANCER) {
    if (analysis.fieldCapacity <= 0) return { yes: false };
    if (analysis.faceUpMiragebounds.length === 0) return { yes: false };
    if (
      !analysis.hasMeaningfulBounce &&
      analysis.opponentMonsters.length === 0 &&
      analysis.faceUpMiragebounds.length > 1
    ) {
      return { yes: false };
    }
    return {
      yes: true,
      priority: analysis.hasMeaningfulBounce ? 9 : 7,
      reason: "special summon Dancer as extender",
    };
  }

  if (card?.name === MB.FALSE_KING) {
    if (analysis.faceUpMiragebounds.length === 0) return { yes: false };
    const rebelPayoff = analysis.hasRebelFalseKingTriggerWindow;
    if (!analysis.hasMeaningfulBounce && !rebelPayoff) return { yes: false };
    if (!hasOpenMonsterZoneAfterBounce(analysis)) return { yes: false };
    return {
      yes: true,
      priority:
        (analysis.hasJackalInHand ? 10.5 : 9.5) +
        (rebelPayoff ? 1.5 : 0),
      reason: rebelPayoff
        ? "special summon False King to trigger Rebel extender"
        : "special summon False King with bounce payoff",
    };
  }

  return { yes: false };
}

function shouldActivateMonsterEffect(card, analysis = {}, context = {}) {
  const otherMiragebounds = analysis.faceUpMiragebounds.filter(
    (candidate) => candidate !== card,
  );
  const opponentTargets = analysis.opponentMonsters.length > 0;

  if (card?.name === MB.GLASS_SOVEREIGN) {
    if (otherMiragebounds.length === 0) return { yes: false };
    if (getOpponentCards(analysis).length === 0) return { yes: false };
    return {
      yes: true,
      priority: 11.5,
      reason: "Sovereign bounce converts tempo",
    };
  }

  if (card?.name === MB.DANCER) {
    if (otherMiragebounds.length === 0) return { yes: false };
    if (analysis.hasLeviathanLine && analysis.opponentMonsters.length >= 2) {
      return { yes: false };
    }
    if (!analysis.hasMeaningfulBounce && !opponentTargets) return { yes: false };
    return {
      yes: true,
      priority: analysis.hasMeaningfulBounce ? 9.2 : 7,
      reason: "bounce Miragebound for Dancer pressure",
    };
  }

  if (card?.name === MB.SCOUT) {
    if (!opponentTargets) return { yes: false };
    return {
      yes: true,
      priority:
        7.5 +
        (analysis.hasOasisActive ? 1.5 : 0) +
        (analysis.scoutEffectActivations < 2 ? 1 : 0) +
        getRebelPositionEffectBonus(analysis),
      reason: "Scout changes battle position and advances Ascension",
    };
  }

  if (card?.name === MB.SAND_PRIESTESS) {
    if (!opponentTargets) return { yes: false };
    return {
      yes: true,
      priority:
        (analysis.mirageboundGraveyard.length > 0 ? 8.8 : 7.8) +
        getRebelPositionEffectBonus(analysis),
      reason: "Priestess shifts and weakens threat",
    };
  }

  if (card?.name === MB.FALSE_KING) {
    if (!opponentTargets) return { yes: false };
    return {
      yes: true,
      priority: 7.6 + getRebelPositionEffectBonus(analysis),
      reason: "False King shifts opponent threat",
    };
  }

  return { yes: false };
}

function shouldActivateFieldSpell(card, analysis = {}) {
  if (card?.name !== MB.OASIS) return { yes: false };
  if (analysis.opponentMonsters.length === 0) return { yes: false };
  return {
    yes: true,
    priority:
      (analysis.hasMeaningfulBounce ? 10.2 : 8.4) +
      getRebelPositionEffectBonus(analysis),
    reason: analysis.hasMeaningfulBounce
      ? "Oasis bounce mode has payoff"
      : analysis.hasRebelOpenZoneTriggerWindow
        ? "Oasis shift mode triggers Rebel extender"
        : "Oasis shift mode controls threat",
  };
}

function shouldActivateSpellTrapEffect(card, analysis = {}) {
  if (card?.name !== MB.MIRROR_PATH) return { yes: false };
  if ((analysis.oppSpellTrap || []).length === 0 && !analysis.oppFieldSpell) {
    return { yes: false };
  }
  if (analysis.mirrorPathIsOnlyBattleProtection) {
    return { yes: false };
  }
  return {
    yes: true,
    priority: 6,
    reason: "Mirror Path removes opposing backrow",
  };
}

function getMirageboundCardValue(card) {
  if (!card) return 0;
  const base = estimateCardValue(card);
  if (card.name === MB.SCOUT) return base + 8;
  if (card.name === MB.GLASS_VIPER) return base + 5;
  if (card.name === MB.SAND_PRIESTESS) return base + 4;
  if (card.name === MB.FALSE_KING) return base + 4;
  if (card.name === MB.REBEL) return base + 4.5;
  if (card.name === MB.DANCER) return base + 3;
  if (card.name === MB.JACKAL) return base + 2;
  if (card.name === MB.GLASS_SOVEREIGN) return base + 10;
  if (card.name === MB.DESERT_LEVIATHAN) return base + 9;
  return base;
}

function getDesertLeviathanCard(bot) {
  return (bot?.extraDeck || []).find((card) => card?.name === MB.DESERT_LEVIATHAN);
}

function getGlassSovereignCard(bot) {
  return (bot?.extraDeck || []).find((card) => card?.name === MB.GLASS_SOVEREIGN);
}

function getLocalLeviathanMaterialCombos(bot) {
  const field = bot?.field || [];
  const vipers = field.filter(
    (card) => isFaceUpMirageboundMonster(card) && card.name === MB.GLASS_VIPER,
  );
  const combos = [];
  for (const viper of vipers) {
    for (const other of field) {
      if (other === viper || !isFaceUpMirageboundMonster(other)) continue;
      combos.push([viper, other]);
    }
  }
  return combos;
}

function getLeviathanMaterialCombos(game, bot, leviathan) {
  if (!leviathan) return { ok: false, combos: [], check: null };
  if (typeof game?.canSummonExtraDeckCardByProcedure === "function") {
    const check = game.canSummonExtraDeckCardByProcedure(leviathan, bot, {
      silent: true,
    });
    return {
      ok: !!check?.ok,
      combos: Array.isArray(check?.materialCombos)
        ? check.materialCombos
        : check?.ok
          ? getLocalLeviathanMaterialCombos(bot)
          : [],
      check,
    };
  }
  const combos = getLocalLeviathanMaterialCombos(bot);
  return { ok: combos.length > 0, combos, check: null };
}

function getLeviathanSecondMaterialScore(card, analysis = {}) {
  if (!card) return -100;
  const preferred = {
    [MB.DANCER]: 9,
    [MB.JACKAL]: 8,
    [MB.SAND_PRIESTESS]: 7,
    [MB.FALSE_KING]: 6,
    [MB.REBEL]: 5,
    [MB.GLASS_VIPER]: -8,
    [MB.GLASS_SOVEREIGN]: -12,
    [MB.DESERT_LEVIATHAN]: -12,
  };
  let score = preferred[card.name] ?? (isMiragebound(card) ? 3 : -5);
  if (card.name === MB.SCOUT) {
    score = analysis.scoutReadyForAscension ? -18 : analysis.scoutNearAscension ? -10 : 2;
  }
  return score;
}

function evaluateLeviathanCombo(combo = [], analysis = {}) {
  const [viper, second] = combo;
  if (!viper || viper.name !== MB.GLASS_VIPER || !second) {
    return { viable: false, score: -100, reason: "invalid Leviathan materials" };
  }

  const opponentCount = (analysis.opponentMonsters || []).length;
  const attackTargets = (analysis.opponentAttackPositionMonsters || []).length;
  const wideBoard = opponentCount >= 2;
  const lethalSwing =
    analysis.oppPressure ||
    (analysis.readyAttackers || []).reduce(
      (sum, card) => sum + Math.max(0, getEffectiveAtk(card)),
      0,
    ) >= Number(analysis.oppLP || analysis.opponent?.lp || 8000);
  let score =
    7 +
    getLeviathanSecondMaterialScore(second, analysis) +
    Math.min(4, opponentCount) * 2 +
    attackTargets * 1.2;

  if (wideBoard) score += 7;
  if (analysis.oppPressure) score += 4;
  if (lethalSwing) score += 3;
  if (analysis.hasOasisActive) score += 1.2;
  if (opponentCount <= 1) score -= 7;
  if (opponentCount === 0) score -= 12;
  if (second.name === MB.SCOUT && analysis.scoutReadyForAscension && !wideBoard && !lethalSwing) {
    score -= 12;
  } else if (second.name === MB.SCOUT && analysis.scoutNearAscension && !wideBoard) {
    score -= 6;
  }
  if (hasCardStatus(viper, "banishWhenLeavesField") && analysis.hasMeaningfulBounce) {
    score -= 3;
  }

  const viable =
    opponentCount > 0 &&
    (score >= 9 || wideBoard || analysis.oppPressure || lethalSwing);
  return {
    viable,
    score,
    reason: wideBoard
      ? "Desert Leviathan punishes a wide board"
      : analysis.oppPressure
        ? "Desert Leviathan stabilizes battle pressure"
        : "Desert Leviathan converts Extra Deck pressure",
  };
}

function chooseBestLeviathanCombo(combos = [], analysis = {}) {
  return combos
    .map((combo) => ({
      combo,
      evaluation: evaluateLeviathanCombo(combo, analysis),
    }))
    .filter((entry) => entry.evaluation.viable)
    .sort((a, b) => b.evaluation.score - a.evaluation.score)[0] || null;
}

function buildLeviathanProcedureAction({
  bot,
  leviathan,
  combo,
  evaluation,
  analysis,
} = {}) {
  if (!bot || !leviathan || !Array.isArray(combo) || combo.length === 0) {
    return null;
  }
  const materials = combo.map((card) => buildMaterialHint(card, bot.field.indexOf(card)));
  return {
    type: "extraDeckProcedure",
    cardId: leviathan.id,
    cardName: leviathan.name,
    extraDeckIndex: bot.extraDeck.indexOf(leviathan),
    extraDeckCard: leviathan,
    materialIndices: materials.map((entry) => entry.index),
    materialIds: materials.map((entry) => entry.id),
    materialNames: materials.map((entry) => entry.name),
    materialInstanceIds: materials.map((entry) => entry.instanceIds),
    materials,
    requiredMaterialCount: materials.length,
    position: "attack",
    priority: Math.min(15, Math.max(6, evaluation?.score || 8)),
    reason: evaluation?.reason || "Extra Deck contact fusion",
    activationContext: buildMirageboundActivationContext(leviathan, analysis, {
      zone: "extraDeck",
      activationZone: "extraDeck",
      sourceZone: "extraDeck",
    }),
  };
}

export default class MirageboundStrategy extends BaseStrategy {
  constructor(bot) {
    super(bot);
    this.currentAnalysis = null;
    this.thoughtProcess = [];
  }

  get archetypeLabel() {
    return "Miragebound";
  }

  think(thought) {
    this.thoughtProcess.push(thought);
    if (this.bot?.debug) {
      console.log(`[Miragebound AI] ${thought}`);
    }
  }

  getPlanningProfile(game, context = {}) {
    if (!game) return super.getPlanningProfile(game, context);
    const analysis = context.analysis || this.analyzeGameState(game);
    return buildMirageboundPlanningProfile(analysis, {
      ...context,
      game,
      bot: context.bot || this.bot || game.bot,
      strategy: this,
    });
  }

  shouldUseDeepPlanning(game, context = {}) {
    const profile =
      context.profile || this.getPlanningProfile(game, context) || {};
    return game?.turnLineSearchEnabled === true || profile.enabled === true;
  }

  scoreLineMilestones(context = {}) {
    return scoreMirageboundLineMilestones(context);
  }

  scoreLineTerminal(context = {}) {
    return scoreMirageboundLineTerminal(context);
  }

  describePlannedLine(context = {}) {
    return describeMirageboundPlannedLine(context);
  }

  scoreBattleAttackCandidate(context = {}) {
    return scoreMirageboundBattleAttackCandidate(context);
  }

  analyzeGameState(game) {
    this.thoughtProcess = [];
    const simulated = isSimulatedState(game);
    const actor = simulated ? game.bot : this.bot || game?.bot;
    const opponent = actor ? this.getOpponent(game, actor) : null;
    const base = buildStrategyAnalysis({
      bot: actor,
      opponent,
      game,
      strategy: this,
    });

    const faceUpMiragebounds = (base.field || []).filter(
      isFaceUpMirageboundMonster,
    );
    const mirageboundHand = (base.hand || []).filter(isMiragebound);
    const mirageboundGraveyard = (base.graveyard || []).filter(isMiragebound);
    const opponentMonsters = (base.oppField || []).filter(
      (card) => card?.cardKind === "monster",
    );
    const opponentAttackPositionMonsters = opponentMonsters.filter(
      isAttackPositionThreat,
    );
    const opponentDefensePositionMonsters = opponentMonsters.filter(
      (card) => card?.cardKind === "monster" && card.position === "defense",
    );
    const readyAttackers = (base.field || []).filter(
      (card) =>
        isFaceUpMonster(card) &&
        card.position === "attack" &&
        !card.hasAttacked &&
        !card.cannotAttackThisTurn,
    );
    const strongestOpponentStat = opponentMonsters.reduce(
      (max, card) => Math.max(max, getBattleStat(card)),
      0,
    );
    const strongestOpponentAtk = opponentAttackPositionMonsters.reduce(
      (max, card) => Math.max(max, getEffectiveAtk(card)),
      0,
    );
    const bestOwnBattleStat = (base.field || [])
      .filter(isFaceUpMonster)
      .reduce(
        (max, card) => Math.max(max, getEffectiveAtk(card), getEffectiveDef(card)),
        0,
      );
    const fieldCapacity = getFieldCapacity(actor);
    const availableMonsterZonesAfterBounce =
      faceUpMiragebounds.length > 0 ? Math.max(fieldCapacity, 1) : fieldCapacity;
    const scoutEffectActivations = getMaterialEffectActivations(game, actor, 351);
    const hasScoutInField = hasName(faceUpMiragebounds, MB.SCOUT);
    const hasSovereignInField = hasName(faceUpMiragebounds, MB.GLASS_SOVEREIGN);
    const hasDesertLeviathan = hasName(faceUpMiragebounds, MB.DESERT_LEVIATHAN);
    const hasDesertLeviathanInExtraDeck = hasName(base.extraDeck || [], MB.DESERT_LEVIATHAN);
    const hasViperBouncePayoff =
      hasName(faceUpMiragebounds, MB.GLASS_VIPER) &&
      availableMonsterZonesAfterBounce > 0;
    const hasPriestessBouncePayoff =
      hasName(faceUpMiragebounds, MB.SAND_PRIESTESS) &&
      mirageboundGraveyard.length > 0;
    const hasJackalInHand = hasName(base.hand, MB.JACKAL);
    const hasJackalBouncePayoff =
      hasJackalInHand && opponentMonsters.length > 0 && availableMonsterZonesAfterBounce > 0;
    const hasFalseKingInHand = hasName(base.hand, MB.FALSE_KING);
    const hasDancerInHand = hasName(base.hand, MB.DANCER);
    const hasMirrorPathOnField = hasName(base.spellTrap || [], MB.MIRROR_PATH);
    const hasFalseHorizonAvailable =
      hasName(base.hand || [], MB.FALSE_HORIZON) ||
      hasName(base.spellTrap || [], MB.FALSE_HORIZON);
    const hasVanishingStepAvailable =
      hasName(base.hand || [], MB.VANISHING_STEP) ||
      hasName(base.spellTrap || [], MB.VANISHING_STEP);
    const hasRebelInHand = hasName(base.hand || [], MB.REBEL);
    const hasRebelInField = hasName(faceUpMiragebounds, MB.REBEL);
    const hasPositionChangeAccess = hasPositionChangeEffectAccess(
      base,
      faceUpMiragebounds,
    );
    const hasRebelOpenZoneTriggerWindow =
      hasRebelInHand &&
      fieldCapacity > 0 &&
      opponentMonsters.length > 0 &&
      hasPositionChangeAccess;
    const hasRebelVanishingStepWindow =
      hasRebelInHand &&
      hasVanishingStepAvailable &&
      faceUpMiragebounds.length > 0 &&
      availableMonsterZonesAfterBounce > 0 &&
      opponentMonsters.length > 0;
    const hasRebelFalseKingTriggerWindow =
      hasRebelInHand &&
      hasFalseKingInHand &&
      fieldCapacity > 0 &&
      faceUpMiragebounds.length > 0 &&
      opponentMonsters.length > 0;
    const hasRebelPositionTriggerWindow =
      hasRebelOpenZoneTriggerWindow ||
      hasRebelVanishingStepWindow ||
      hasRebelFalseKingTriggerWindow;
    const hasRebelPiercingPressure =
      (hasRebelInHand || hasRebelInField) &&
      (opponentDefensePositionMonsters.length > 0 ||
        (hasRebelPositionTriggerWindow &&
          opponentAttackPositionMonsters.length > 0));
    const canViperPressureAfterSummon =
      hasDesertLeviathan ||
      strongestOpponentStat <= 1500 ||
      opponentMonsters.some((monster) =>
        readyAttackers.some(
          (attacker) => getEffectiveAtk(attacker) > Math.max(0, getBattleStat(monster) - 500),
        ),
      );
    const canKeepOffenseAfterBounce =
      readyAttackers.length > 1 ||
      hasDancerInHand ||
      hasFalseKingInHand ||
      hasJackalBouncePayoff ||
      (hasViperBouncePayoff && canViperPressureAfterSummon) ||
      hasSovereignInField ||
      hasRebelPositionTriggerWindow;
    const hasMeaningfulBounce =
      faceUpMiragebounds.length > 0 &&
      (hasViperBouncePayoff || hasPriestessBouncePayoff || hasJackalBouncePayoff);
    const oppPressure =
      opponentAttackPositionMonsters.some((card) => getEffectiveAtk(card) >= 2000) ||
      strongestOpponentStat >= 2000 ||
      (strongestOpponentAtk > 0 && strongestOpponentAtk >= bestOwnBattleStat);
    const needsBattleProtection = oppPressure && faceUpMiragebounds.length > 0;
    const hasSafeBackrowDefense =
      hasFalseHorizonAvailable ||
      hasVanishingStepAvailable ||
      hasMirrorPathOnField;
    const mirrorPathIsOnlyBattleProtection =
      hasMirrorPathOnField &&
      needsBattleProtection &&
      !hasFalseHorizonAvailable &&
      !hasVanishingStepAvailable;

    const analysis = {
      ...base,
      player: actor,
      opponent,
      canNormalSummon: base.summonAvailable,
      fieldCapacity,
      availableMonsterZonesAfterBounce,
      faceUpMiragebounds,
      mirageboundField: faceUpMiragebounds,
      mirageboundHand,
      mirageboundGraveyard,
      opponentMonsters,
      opponentAttackPositionMonsters,
      opponentDefensePositionMonsters,
      opponentCards: getOpponentCards(base),
      readyAttackers,
      strongestOpponentStat,
      strongestOpponentAtk,
      bestOwnBattleStat,
      hasOasisActive: base.fieldSpell?.name === MB.OASIS,
      hasDesertLeviathan,
      hasSovereignInField,
      hasScoutInField,
      scoutEffectActivations,
      scoutNearAscension: hasScoutInField && scoutEffectActivations >= 1,
      scoutReadyForAscension: hasScoutInField && scoutEffectActivations >= 2,
      preserveScout: hasScoutInField && scoutEffectActivations >= 1,
      hasJackalInHand,
      hasJackalBouncePayoff,
      hasFalseKingInHand,
      hasDancerInHand,
      hasRebelInHand,
      hasRebelInField,
      hasRebelOpenZoneTriggerWindow,
      hasRebelVanishingStepWindow,
      hasRebelFalseKingTriggerWindow,
      hasRebelPositionTriggerWindow,
      hasRebelPiercingPressure,
      hasViperBouncePayoff,
      hasPriestessBouncePayoff,
      hasMeaningfulBounce,
      hasPlannedBounce: hasMeaningfulBounce,
      canKeepOffenseAfterBounce,
      canViperPressureAfterSummon,
      hasFalseHorizonAvailable,
      hasVanishingStepAvailable,
      hasMirrorPathOnField,
      needsBattleProtection,
      hasSafeBackrowDefense,
      mirrorPathIsOnlyBattleProtection,
      hasHeatHazeRecoveryLine:
        mirageboundGraveyard.length > 0 &&
        opponentAttackPositionMonsters.length > 0 &&
        faceUpMiragebounds.length > 0,
      opponentBackrowPressure:
        Boolean(base.oppFieldSpell) ||
        (base.oppSpellTrap || []).some(
          (card) => card?.subtype === "continuous" || card?.subtype === "field",
        ),
      hasLeviathanMaterials:
        hasDesertLeviathanInExtraDeck &&
        hasName(faceUpMiragebounds, MB.GLASS_VIPER) &&
        faceUpMiragebounds.some((card) => card.name !== MB.GLASS_VIPER),
      hasLeviathanLine:
        hasDesertLeviathanInExtraDeck &&
        opponentMonsters.length > 0 &&
        hasName(faceUpMiragebounds, MB.GLASS_VIPER) &&
        faceUpMiragebounds.some((card) => card.name !== MB.GLASS_VIPER),
      oppPressure,
    };

    this.currentAnalysis = analysis;
    return analysis;
  }

  buildActivationContextForEffect({
    sourceCard,
    effect,
    player,
    game,
    activationZone,
  } = {}) {
    if (!sourceCard || !player || !game) return null;
    const analysis = this.analyzeGameState(game);
    const zone = activationZone || effect?.activationZones?.[0] || "field";
    return buildMirageboundActivationContext(sourceCard, analysis, {
      zone,
      activationZone: zone,
      sourceZone: zone,
      fromHand: zone === "hand",
      effect,
    });
  }

  buildChainActivationContext(option, analysis, context = {}) {
    let activationContext = buildMirageboundActivationContext(
      option?.card,
      analysis,
      {
        zone: option?.zone || "spellTrap",
        activationZone: option?.zone || "spellTrap",
        sourceZone: option?.zone || "spellTrap",
        effect: option?.effect,
      },
    );

    const threat = getIncomingBattleThreat(context, analysis.player, analysis);
    const opponentFocus = [
      threat.attacker,
      context.target,
      context.defender,
      ...rankOpponentMonstersForPosition(analysis),
    ].filter((card) => card && card.cardKind === "monster");
    const opponentPatch = {
      intent: "harm",
      role: "named_preference",
      preferredInstanceIds: getInstanceIds(opponentFocus),
    };

    if (option?.card?.name === MB.FALSE_HORIZON) {
      activationContext = mergeTargetPreference(
        activationContext,
        "miragebound_false_horizon_position_target",
        opponentPatch,
      );
      if (isFaceUpMirageboundMonster(context.target) && !(
        context.target.name === MB.SCOUT && analysis.preserveScout
      )) {
        activationContext = mergeTargetPreference(
          activationContext,
          "miragebound_false_horizon_return_target",
          {
            intent: "benefit",
            role: "named_preference",
            preferredInstanceIds: getInstanceIds([context.target]),
          },
        );
      }
    }

    if (option?.card?.name === MB.VANISHING_STEP) {
      activationContext = mergeTargetPreference(
        activationContext,
        "miragebound_vanishing_step_position_target",
        {
          ...opponentPatch,
          role: "temporary_stat_debuff",
          purpose: "combat",
          attackers: analysis.readyAttackers || [],
          opponentLp: analysis.oppLP || analysis.opponent?.lp || 0,
          atkReduction: 500,
          defReduction: 500,
        },
      );
      if (isFaceUpMirageboundMonster(context.target) && !(
        context.target.name === MB.SCOUT && analysis.preserveScout
      )) {
        activationContext = mergeTargetPreference(
          activationContext,
          "miragebound_vanishing_step_return_target",
          {
            intent: "benefit",
            role: "named_preference",
            preferredInstanceIds: getInstanceIds([context.target]),
          },
        );
      }
    }

    return activationContext;
  }

  evaluateFalseHorizonChainResponse(option, analysis, context = {}) {
    if (option?.card?.name !== MB.FALSE_HORIZON) return null;
    const threat = getIncomingBattleThreat(context, analysis.player, analysis);
    if (!threat.isOpponentAttack) return null;
    if ((analysis.opponentMonsters || []).length === 0) return null;
    if (!isMeaningfulChainBattleThreat(threat, analysis)) {
      return null;
    }
    return {
      option,
      score:
        70 +
        (threat.lethal ? 40 : 0) +
        (threat.loseMonster ? 18 : 0) +
        Math.min(20, Math.floor(threat.damage / 100)) +
        (analysis.hasMeaningfulBounce ? 8 : 0),
      reason: threat.lethal
        ? "False Horizon prevents lethal attack pressure"
        : "False Horizon answers opponent attack pressure",
    };
  }

  evaluateVanishingStepChainResponse(option, analysis, context = {}) {
    if (option?.card?.name !== MB.VANISHING_STEP) return null;
    if ((analysis.opponentMonsters || []).length === 0) return null;
    if (!hasUsefulChainBounceTarget(analysis)) return null;

    const threat = getIncomingBattleThreat(context, analysis.player, analysis);
    const protectsTargetedMiragebound =
      isOpponentEffectTargetingSelf(context, analysis.player) &&
      isFaceUpMirageboundMonster(context.target) &&
      !(context.target.name === MB.SCOUT && analysis.preserveScout);
    const contextPlayerId = getOwnerId(context.player);
    const opponentAction =
      threat.isOpponentAttack ||
      protectsTargetedMiragebound ||
      (contextPlayerId && contextPlayerId !== analysis.player?.id);
    if (!opponentAction) return null;
    const convertsBattleBounce =
      isMeaningfulChainBattleThreat(threat, analysis) &&
      analysis.hasMeaningfulBounce;
    if (!convertsBattleBounce && !protectsTargetedMiragebound) {
      return null;
    }

    return {
      option,
      score:
        58 +
        (threat.lethal ? 35 : 0) +
        (threat.loseMonster ? 14 : 0) +
        (protectsTargetedMiragebound ? 20 : 0) +
        (analysis.hasViperBouncePayoff ? 10 : 0) +
        (analysis.hasPriestessBouncePayoff ? 8 : 0) +
        Math.min(12, Math.floor(threat.damage / 150)),
      reason: protectsTargetedMiragebound
        ? "Vanishing Step protects targeted Miragebound"
        : "Vanishing Step converts defensive bounce",
    };
  }

  async chooseChainResponse({
    chainSystem,
    game,
    player,
    activatable = [],
    context = {},
  } = {}) {
    if (!player || !Array.isArray(activatable) || activatable.length === 0) {
      return null;
    }

    const relevant = activatable.filter(
      (option) =>
        option?.card?.name === MB.FALSE_HORIZON ||
        option?.card?.name === MB.VANISHING_STEP,
    );
    if (relevant.length === 0) return null;
    if (hasMirageboundDefenseResponseInChain(chainSystem, player)) {
      return {
        pass: true,
        reason: "Miragebound defense already committed to this chain",
      };
    }

    const resolvedGame = game || context?.game || this.currentAnalysis?.game || null;
    const analysis = resolvedGame
      ? this.analyzeGameState(resolvedGame)
      : this.currentAnalysis || {};
    if (!analysis.player || analysis.player.id !== player.id) {
      analysis.player = player;
      analysis.opponent = context?.opponent || analysis.opponent;
    }

    const evaluated = relevant
      .map(
        (option) =>
          this.evaluateFalseHorizonChainResponse(option, analysis, context) ||
          this.evaluateVanishingStepChainResponse(option, analysis, context),
      )
      .filter(Boolean)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const order = {
          [MB.FALSE_HORIZON]: 0,
          [MB.VANISHING_STEP]: 1,
        };
        return (order[a.option.card.name] ?? 9) - (order[b.option.card.name] ?? 9);
      });

    if (evaluated.length === 0) {
      return { pass: true, reason: "no valuable Miragebound response" };
    }

    const best = evaluated[0];
    const activationContext = this.buildChainActivationContext(
      best.option,
      analysis,
      context,
    );
    return {
      ...best.option,
      priority: best.score,
      reason: best.reason,
      activationContext,
      context: {
        ...(best.option.context || context || {}),
        activationContext,
      },
    };
  }

  getSpellActions(game, bot, analysis) {
    return getGenericHandSpellActions({
      game,
      player: bot,
      analysis,
      shouldPlay: shouldPlayMirageboundSpell,
      buildActivationContext: (card, currentAnalysis, context) =>
        buildMirageboundActivationContext(card, currentAnalysis, {
          zone: "hand",
          activationZone: "hand",
          sourceZone: "hand",
          fromHand: true,
          effect: context?.effect,
        }),
      canActivate: ({ card, player, activationContext }) =>
        canActivateSpellFromHand(game, card, player, activationContext, {
          bot: this.bot,
          debugLabel: "MirageboundStrategy",
        }),
    });
  }

  getSetSpellTrapActions(game, bot, analysis) {
    return getGenericSetBackrowActions({
      game,
      player: bot,
      analysis,
      opponent: analysis.opponent,
      policy: {
        acceptsCard: (card) =>
          card?.name === MB.FALSE_HORIZON || card?.name === MB.VANISHING_STEP,
        shouldSet: (card) => shouldSetMirageboundBackrow(card, analysis),
        getPriority: (_card, context) => context.setDecision?.priority,
        getReason: (_card, context) => context.setDecision?.reason,
      },
    });
  }

  getSummonActions(_game, bot, analysis) {
    return getGenericNormalSummonActions({
      player: bot,
      analysis,
      getTributeRequirement: (card, player) =>
        this.getTributeRequirementFor(card, player),
      shouldSummon: shouldSummonMirageboundMonster,
    });
  }

  getHandIgnitionActions(game, bot, analysis) {
    return getGenericIgnitionEffectActions({
      game,
      player: bot,
      cards: bot.hand,
      analysis,
      type: "handIgnition",
      sourceZone: "hand",
      indexFields: ["index"],
      findEffect: (card) => findIgnitionEffect(card, "hand"),
      shouldActivate: shouldActivateHandIgnition,
      buildActivationContext: (card, currentAnalysis, context) =>
        buildMirageboundActivationContext(card, currentAnalysis, {
          zone: "hand",
          activationZone: "hand",
          sourceZone: "hand",
          fromHand: true,
          effect: context?.effect,
        }),
      canActivate: ({ card, player, activationContext }) =>
        canActivateMonsterEffect(game, card, player, "hand", activationContext, {
          bot: this.bot,
          debugLabel: "MirageboundStrategy",
        }),
      cardFilter: (card) => card?.cardKind === "monster" && isMiragebound(card),
      includeEffectId: true,
    });
  }

  getMonsterEffectActions(game, bot, analysis) {
    return getGenericIgnitionEffectActions({
      game,
      player: bot,
      cards: bot.field,
      analysis,
      type: "monsterEffect",
      sourceZone: "field",
      indexFields: ["fieldIndex"],
      findEffect: (card) => findIgnitionEffect(card, "field"),
      shouldActivate: shouldActivateMonsterEffect,
      buildActivationContext: (card, currentAnalysis, context) =>
        buildMirageboundActivationContext(card, currentAnalysis, {
          zone: "field",
          activationZone: "field",
          sourceZone: "field",
          effect: context?.effect,
        }),
      canActivate: ({ card, player, activationContext }) =>
        canActivateMonsterEffect(game, card, player, "field", activationContext, {
          bot: this.bot,
          debugLabel: "MirageboundStrategy",
        }),
      cardFilter: (card) => isFaceUpMirageboundMonster(card),
      includeEffectId: true,
    });
  }

  getFieldEffectActions(game, bot, analysis) {
    if (!bot.fieldSpell) return [];
    return getGenericIgnitionEffectActions({
      game,
      player: bot,
      cards: [bot.fieldSpell],
      analysis,
      type: "fieldEffect",
      sourceZone: "fieldSpell",
      indexFields: [],
      findEffect: (card) => findIgnitionEffect(card, "fieldSpell"),
      shouldActivate: shouldActivateFieldSpell,
      buildActivationContext: (card, currentAnalysis, context) =>
        buildMirageboundActivationContext(card, currentAnalysis, {
          zone: "fieldSpell",
          activationZone: "fieldSpell",
          sourceZone: "fieldSpell",
          effect: context?.effect,
        }),
      canActivate: ({ card, player, activationContext }) =>
        canActivateFieldSpellEffect(game, card, player, activationContext, {
          bot: this.bot,
          debugLabel: "MirageboundStrategy",
        }),
      includeEffectId: true,
    });
  }

  getSpellTrapEffectActions(game, bot, analysis) {
    return getGenericIgnitionEffectActions({
      game,
      player: bot,
      cards: bot.spellTrap,
      analysis,
      type: "spellTrapEffect",
      sourceZone: "spellTrap",
      indexFields: ["index", "zoneIndex"],
      findEffect: (card) => findIgnitionEffect(card, "spellTrap"),
      shouldActivate: shouldActivateSpellTrapEffect,
      buildActivationContext: (card, currentAnalysis, context) =>
        buildMirageboundActivationContext(card, currentAnalysis, {
          zone: "spellTrap",
          activationZone: "spellTrap",
          sourceZone: "spellTrap",
          effect: context?.effect,
        }),
      canActivate: ({ card, player, activationContext }) =>
        canActivateSpellTrapEffect(
          game,
          card,
          player,
          "spellTrap",
          activationContext,
          {
            bot: this.bot,
            debugLabel: "MirageboundStrategy",
          },
        ),
      includeEffectId: true,
    });
  }

  getExtraDeckActions(game, bot, analysis) {
    const actions = [];
    const simulated = isSimulatedState(game);
    const sovereign = getGlassSovereignCard(bot);

    actions.push(
      ...getGenericAscensionActions(
        {
          game,
          bot,
          opponent: analysis.opponent,
          analysis,
          isSimulatedState: simulated,
        },
        {
          getSimulatedAscensionCandidates: (_game, player, material) => {
            if (material?.name !== MB.SCOUT) return [];
            if (getMaterialEffectActivations(_game, player, 351) < 2) return [];
            return sovereign ? [sovereign] : [];
          },
          shouldSkipAscension: (ascensionCard) =>
            ascensionCard?.name !== MB.GLASS_SOVEREIGN,
          evaluateAscensionPriority: () =>
            12.5 +
            (analysis.opponentMonsters.length <= 1 ? 2.2 : 0) +
            (analysis.oppPressure ? 1.2 : 0),
          chooseAscensionPosition: (ascensionCard, material) =>
            this.chooseAutomaticAscensionPosition({
              ascensionCard,
              material,
              game,
              bot,
              opponent: analysis.opponent,
            }),
          decorateAction: (action, ascensionCard, material) => ({
            ...action,
            cardId: ascensionCard?.id,
            materialId: material?.id,
            materialName: material?.name,
            reason: "Glass Sovereign Ascension line",
            activationContext: buildMirageboundActivationContext(
              ascensionCard,
              analysis,
              {
                zone: "extraDeck",
                activationZone: "extraDeck",
                sourceZone: "extraDeck",
              },
            ),
          }),
        },
      ),
    );

    const leviathan = getDesertLeviathanCard(bot);
    const { ok, combos } = getLeviathanMaterialCombos(game, bot, leviathan);
    if (ok && combos.length > 0) {
      const best = chooseBestLeviathanCombo(combos, analysis);
      const action = buildLeviathanProcedureAction({
        bot,
        leviathan,
        combo: best?.combo,
        evaluation: best?.evaluation,
        analysis,
      });
      if (action) actions.push(action);
    }

    return actions;
  }

  generateMainPhaseActions(game) {
    const analysis = this.analyzeGameState(game);
    const bot = analysis.player;
    if (!bot) return [];

    const actions = [
      ...this.getSpellActions(game, bot, analysis),
      ...this.getHandIgnitionActions(game, bot, analysis),
      ...this.getFieldEffectActions(game, bot, analysis),
      ...this.getSpellTrapEffectActions(game, bot, analysis),
      ...this.getMonsterEffectActions(game, bot, analysis),
      ...this.getExtraDeckActions(game, bot, analysis),
      ...this.getSummonActions(game, bot, analysis),
      ...this.getSetSpellTrapActions(game, bot, analysis),
      ...(analysis.hasLeviathanLine && analysis.opponentMonsters.length >= 2
        ? []
        : this.getPositionChangeActions(game, bot, analysis.opponent)),
    ];

    const sequenced = this.sequenceActions(actions);
    return this.integrateP2IntoActionSelection(game, sequenced, analysis);
  }

  sequenceActions(actions = []) {
    return sequenceActionsByPriority(actions, {
      typeOrder: {
        spell: 0,
        handIgnition: 1,
        fieldEffect: 2,
        spellTrapEffect: 3,
        monsterEffect: 4,
        ascension: 5,
        extraDeckProcedure: 5,
        summon: 6,
        set_spell_trap: 7,
        position_change: 8,
      },
    });
  }

  evaluateBoard(gameOrState, perspectivePlayer) {
    const base = super.evaluateBoardV2(gameOrState, perspectivePlayer);
    const perspective =
      perspectivePlayer?.id ? perspectivePlayer : gameOrState?.bot || this.bot;
    if (!perspective) return base;
    const opponent = this.getOpponent(gameOrState, perspective);
    const field = perspective.field || [];
    const graveyard = perspective.graveyard || [];
    const faceUpMiragebounds = field.filter(isFaceUpMirageboundMonster);
    let score = base;
    score += faceUpMiragebounds.length * 0.35;
    if (perspective.fieldSpell?.name === MB.OASIS) score += 1.4;
    if (hasName(faceUpMiragebounds, MB.GLASS_SOVEREIGN)) score += 2.6;
    if (hasName(faceUpMiragebounds, MB.DESERT_LEVIATHAN)) score += 2.4;
    if (hasName(faceUpMiragebounds, MB.SCOUT)) {
      const activations = getMaterialEffectActivations(
        gameOrState,
        perspective,
        351,
      );
      score += Math.min(2, activations) * 0.5;
    }
    if (hasName(faceUpMiragebounds, MB.GLASS_VIPER)) score += 0.8;
    if (hasName(faceUpMiragebounds, MB.REBEL)) score += 1.1;
    if (
      hasName(faceUpMiragebounds, MB.SAND_PRIESTESS) &&
      graveyard.some(isMiragebound)
    ) {
      score += 0.8;
    }
    const defenseTargets = (opponent?.field || []).filter(
      (card) => card?.position === "defense",
    ).length;
    if (hasName(faceUpMiragebounds, MB.GLASS_SOVEREIGN)) {
      score += defenseTargets * 0.35;
    }
    if (hasName(faceUpMiragebounds, MB.REBEL)) {
      score += defenseTargets * 0.25;
    }
    return score;
  }

  evaluateBoardV2(gameOrState, perspectivePlayer) {
    return this.evaluateBoard(gameOrState, perspectivePlayer);
  }

  simulateMainPhaseAction(state, action) {
    return applyGenericSimulatedMainPhaseAction(state, action, {
      guardLabel: "MirageboundStrategy",
      selfId: "bot",
      archetype: MIRAGEBOUND,
      strategy: this,
      enableSimulatedEvents: true,
      rankSearchCandidates: this.rankSearchCandidates.bind(this),
      getTributeRequirementFor: this.getTributeRequirementFor.bind(this),
      selectBestTributes: this.selectBestTributes.bind(this),
      placeSpellCard: this.placeSpellCard.bind(this),
      chooseSpecialSummonPosition: this.chooseSpecialSummonPosition.bind(this),
      chooseActionCase: this.chooseActionCase.bind(this),
    });
  }

  chooseActionCase(cases = [], context = {}) {
    if (!Array.isArray(cases) || cases.length === 0) return null;
    const preferences =
      context.activationContext?.actionContext?.targetPreferences ||
      context.activationContext?.targetPreferences ||
      {};
    const preferredLabels = preferences.action_case_choice?.preferredNames || [];
    const preferredCase = cases.find((choiceCase) =>
      preferredLabels.some(
        (label) =>
          choiceCase?.label === label ||
          choiceCase?.id === label ||
          choiceCase?.description?.includes?.(label),
      ),
    );
    if (preferredCase) return preferredCase;
    return cases[0];
  }

  rankSearchCandidates(cards = [], action = {}, ctx = {}) {
    const source = ctx?.source || ctx?.ctx?.source || null;
    const analysis = ctx?.game ? this.analyzeGameState(ctx.game) : this.currentAnalysis || {};
    const searchedKinds = JSON.stringify(action?.filters?.cardKind || "");
    const isSpellTrapSearch =
      action?.filters?.archetype === MIRAGEBOUND &&
      (searchedKinds.includes("spell") || searchedKinds.includes("trap"));

    if (source?.name === MB.SCOUT || isSpellTrapSearch) {
      const order = [];
      if (!analysis.hasOasisActive) order.push(MB.OASIS);
      if (analysis.needsBattleProtection && !analysis.hasFalseHorizonAvailable) {
        order.push(MB.FALSE_HORIZON);
      }
      if (
        (analysis.needsBattleProtection || analysis.opponentBackrowPressure) &&
        !analysis.hasMirrorPathOnField
      ) {
        order.push(MB.MIRROR_PATH);
      }
      if (analysis.hasMeaningfulBounce && !analysis.hasVanishingStepAvailable) {
        order.push(MB.VANISHING_STEP);
      }
      if (analysis.hasHeatHazeRecoveryLine) order.push(MB.HEAT_HAZE);
      order.push(
        MB.OASIS,
        MB.MIRROR_PATH,
        MB.VANISHING_STEP,
        MB.HEAT_HAZE,
        MB.FALSE_HORIZON,
      );
      return this.rankByNameOrder(cards, order);
    }

    if (action?.filters?.archetype === MIRAGEBOUND) {
      const monsterOrder = [
        MB.GLASS_VIPER,
        MB.SCOUT,
        MB.DANCER,
        MB.SAND_PRIESTESS,
        MB.FALSE_KING,
      ];
      if (
        analysis.hasRebelPositionTriggerWindow ||
        analysis.hasRebelPiercingPressure
      ) {
        monsterOrder.push(MB.REBEL);
      }
      monsterOrder.push(MB.JACKAL, MB.REBEL);
      return this.rankByNameOrder(cards, [
        ...monsterOrder,
      ]);
    }

    return cards
      .slice()
      .sort((a, b) => getMirageboundCardValue(b) - getMirageboundCardValue(a));
  }

  rankByNameOrder(cards = [], preferredNames = []) {
    const order = new Map();
    preferredNames.forEach((name, index) => {
      if (!order.has(name)) order.set(name, index);
    });
    return cards.slice().sort((a, b) => {
      const rankA = order.has(a?.name) ? order.get(a.name) : 999;
      const rankB = order.has(b?.name) ? order.get(b.name) : 999;
      if (rankA !== rankB) return rankA - rankB;
      return getMirageboundCardValue(b) - getMirageboundCardValue(a);
    });
  }

  chooseSpecialSummonPosition(card, context = {}) {
    if (!card || card.cardKind !== "monster") return null;
    if (card.name === MB.GLASS_SOVEREIGN || card.name === MB.DESERT_LEVIATHAN) {
      return "attack";
    }
    if (
      card.name === MB.FALSE_KING ||
      card.name === MB.REBEL ||
      card.name === MB.DANCER ||
      card.name === MB.JACKAL
    ) {
      return "attack";
    }

    const opponent =
      context.opponent ||
      (context.game && context.player
        ? this.getOpponent(context.game, context.player)
        : null);
    const analysis =
      context.analysis ||
      (context.game ? this.analyzeGameState(context.game) : this.currentAnalysis) ||
      {};
    const strongest = (opponent?.field || []).reduce(
      (max, monster) => Math.max(max, getEffectiveAtk(monster)),
      0,
    );

    if (card.name === MB.SAND_PRIESTESS) return "defense";
    if (card.name === MB.GLASS_VIPER) {
      if (analysis.canViperPressureAfterSummon || analysis.hasLeviathanMaterials) {
        return "attack";
      }
      if (analysis.oppPressure || strongest > getEffectiveAtk(card)) {
        return "defense";
      }
    }
    return "attack";
  }

  selectAutomaticAscension({ choices = [], game, bot = this.bot, opponent } = {}) {
    const sovereignChoice = choices.find(
      (choice) => choice?.ascensionCard?.name === MB.GLASS_SOVEREIGN,
    );
    if (!sovereignChoice) return null;

    return {
      material: sovereignChoice.material,
      ascensionCard: sovereignChoice.ascensionCard,
      position: this.chooseAutomaticAscensionPosition({
        material: sovereignChoice.material,
        ascensionCard: sovereignChoice.ascensionCard,
        game,
        bot,
        opponent,
      }),
    };
  }

  shouldUseAutomaticAscensionShortcut() {
    return false;
  }

  chooseAutomaticAscensionPosition({ ascensionCard, game, bot = this.bot, opponent } = {}) {
    if (ascensionCard?.name !== MB.GLASS_SOVEREIGN) {
      return ascensionCard?.ascension?.position || "choice";
    }

    const resolvedOpponent =
      opponent || (game && bot ? this.getOpponent(game, bot) : null);
    const strongest = (resolvedOpponent?.field || []).reduce(
      (max, monster) => Math.max(max, getBattleStat(monster)),
      0,
    );
    if ((bot?.lp || 8000) <= 2000 && strongest >= (ascensionCard.def || 0)) {
      return "defense";
    }
    return "attack";
  }

  selectBestTributes(field = [], tributesNeeded = 0, cardToSummon = null) {
    if (tributesNeeded <= 0) return [];
    return (field || [])
      .map((card, index) => ({
        index,
        value:
          estimateMonsterValue(card) +
          (isMiragebound(card) ? 5 : 0) +
          (card?.name === MB.SCOUT ? 20 : 0),
      }))
      .sort((a, b) => a.value - b.value)
      .slice(0, tributesNeeded)
      .map((entry) => entry.index);
  }
}
