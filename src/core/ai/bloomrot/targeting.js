import {
  BLOOMROT_NAMES,
  getSporeCount,
  isBloomrot,
  isBloomrotMonster,
} from "./analysis.js";

const N = {
  SPORELING: "Bloomrot Sporeling",
  ROOTLING: "Bloomrot Rootling",
  MYCO_WEAVER: "Bloomrot Myco-Weaver",
  ROT_STAG: "Bloomrot Rot-Stag",
  CARRIONCAP: "Bloomrot Carrioncap",
  MOLDMENDER: "Bloomrot Moldmender",
  GRAVECAP_WIDOW: "Bloomrot Gravecap Widow",
  ANCIENT_HUSK: "Bloomrot Ancient Husk",
  SPORE_CLOUD: "Bloomrot Spore Cloud",
  FUNGAL_ARMOR: "Bloomrot Fungal Armor",
};

const SPORE_TARGET_IDS = [
  "bloomrot_sporeling_spore_target",
  "bloomrot_rootling_spore_target",
  "bloomrot_rootling_destroyed_spore_target",
  "bloomrot_myco_weaver_spore_target",
  "bloomrot_rot_stag_spore_target",
  "bloomrot_carrioncap_battle_spore_target",
  "bloomrot_gravecap_widow_spore_target",
  "bloomrot_ancient_husk_spore_targets",
  "bloomrot_ancient_husk_destroy_spore_targets",
  "bloomrot_living_colony_spore_target",
  "bloomrot_compost_ritual_target",
  "bloomrot_fungal_armor_spore_target",
  "bloomrot_sudden_germination_bonus_target",
  "bloomrot_rotting_ground_summoned_monster",
  "bloomrot_queen_hollow_grove_leave_spores",
];

const DEBUFF_TARGET_IDS = [
  "bloomrot_carrioncap_spore_target",
  "bloomrot_spore_cloud_targets",
];

const RECOVERY_ORDER = [
  BLOOMROT_NAMES.HARVEST,
  BLOOMROT_NAMES.LIVING_COLONY,
  N.SPORE_CLOUD,
  N.GRAVECAP_WIDOW,
  N.MYCO_WEAVER,
  N.SPORELING,
];

function getInstanceId(card) {
  return card?.instanceId ?? card?.fieldPresenceId ?? card?.uid ?? card?.uuid ?? null;
}

function instanceIds(cards = []) {
  return cards.map(getInstanceId).filter((id) => id !== null && id !== undefined);
}

function effectiveAtk(card) {
  return (
    Number(card?.atk || 0) +
    Number(card?.tempAtkBoost || 0) +
    Number(card?.equipAtkBonus || 0)
  );
}

function effectiveDef(card) {
  return (
    Number(card?.def || 0) +
    Number(card?.tempDefBoost || 0) +
    Number(card?.equipDefBonus || 0)
  );
}

function battleStat(card) {
  if (!card || card.cardKind !== "monster") return 0;
  return card.position === "defense" ? effectiveDef(card) : effectiveAtk(card);
}

function isFaceup(card) {
  return card && card.isFacedown !== true;
}

function cardValue(card) {
  if (!card) return 0;
  if (card.cardKind === "monster") {
    return Math.max(effectiveAtk(card), effectiveDef(card)) / 100 + (card.level || 0);
  }
  let value = 12;
  if (card.subtype === "field") value += 22;
  if (card.subtype === "continuous") value += 16;
  if (card.subtype === "equip") value += 8;
  return value;
}

function faceupOpponentCards(analysis = {}) {
  return [
    ...(analysis.oppField || []),
    ...(analysis.oppSpellTrap || []),
    analysis.oppFieldSpell,
  ].filter(isFaceup);
}

function faceupOpponentMonsters(analysis = {}) {
  return (analysis.opponentMonsters || []).filter(isFaceup);
}

function readyBloomrotAttackers(analysis = {}) {
  return (analysis.faceUpBloomrotField || []).filter(
    (card) =>
      card?.cardKind === "monster" &&
      card.position === "attack" &&
      !card.hasAttacked &&
      !card.cannotAttackThisTurn,
  );
}

function scoreSporeTarget(card, analysis = {}) {
  let score = cardValue(card);
  const spores = getSporeCount(card);

  if (card.cardKind === "monster") {
    score += battleStat(card) / 80;
    if (spores >= 1) score += 10;
    if (analysis.hasRottingGroundActive && spores === 3) score += 65;
    if (analysis.hasRootNetworkActive && spores === 4) score += 58;
    if (spores >= 1 && (analysis.bloomrotHand || []).some((c) => c?.name === N.GRAVECAP_WIDOW)) {
      score += 18;
    }
    if (readyBloomrotAttackers(analysis).some((attacker) => effectiveAtk(attacker) >= battleStat(card))) {
      score += 8;
    }
  } else {
    score += card.subtype === "field" ? 8 : 0;
    score += card.subtype === "continuous" ? 5 : 0;
  }

  return score;
}

function scoreRemovalTarget(card, analysis = {}) {
  let score = cardValue(card);
  if (card?.cardKind === "monster") {
    score += battleStat(card) / 60;
    if ((card.level || 0) >= 7) score += 22;
    if (getSporeCount(card) > 0) score += 8;
  } else {
    if (card?.subtype === "field") score += 45;
    if (card?.subtype === "continuous") score += 35;
    if (card?.subtype === "equip") score += 15;
  }
  if (analysis.oppFieldSpell === card) score += 20;
  return score;
}

function scoreOwnEquipTarget(card) {
  if (!isBloomrotMonster(card) || card.isToken) return -100;
  let score = cardValue(card);
  if (card.name === BLOOMROT_NAMES.ANCIENT_MYCELIUM) score += 45;
  if (card.name === BLOOMROT_NAMES.QUEEN) score += 45;
  if (card.name === BLOOMROT_NAMES.DEVOURER) score += 45;
  if (card.name === N.CARRIONCAP) score += 28;
  if (card.name === N.MYCO_WEAVER) score += 22;
  if (card.name === N.SPORELING) score += 14;
  if ((card.level || 0) >= 5) score += 10;
  return score;
}

function sortedByScore(cards, scoreFn) {
  return (cards || [])
    .filter(Boolean)
    .map((card) => ({ card, score: scoreFn(card) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.card);
}

function topIds(cards, scoreFn, count = 1) {
  return instanceIds(sortedByScore(cards, scoreFn).slice(0, count));
}

function sporePreference(analysis = {}, count = 1) {
  return {
    intent: "harm",
    role: "named_preference",
    preferredInstanceIds: topIds(
      faceupOpponentCards(analysis),
      (card) => scoreSporeTarget(card, analysis),
      count,
    ),
  };
}

function debuffPreference(analysis = {}) {
  return {
    intent: "harm",
    role: "temporary_stat_debuff",
    purpose: "combat",
    attackers: readyBloomrotAttackers(analysis),
    opponentLp: analysis.oppLp || analysis.oppLP || 0,
    atkReduction: 600,
    defReduction: 600,
    preferredInstanceIds: topIds(
      faceupOpponentMonsters(analysis),
      (card) => scoreSporeTarget(card, analysis) + battleStat(card) / 60,
      1,
    ),
  };
}

function removalPreference(analysis = {}, options = {}) {
  const cards = options.monstersOnly
    ? faceupOpponentMonsters(analysis)
    : faceupOpponentCards(analysis);
  return {
    intent: "harm",
    role: "removal",
    preferredInstanceIds: topIds(cards, (card) => scoreRemovalTarget(card, analysis), 2),
  };
}

function ownEquipPreference(analysis = {}) {
  return {
    intent: "benefit",
    role: "named_preference",
    preferredNames: [
      BLOOMROT_NAMES.ANCIENT_MYCELIUM,
      BLOOMROT_NAMES.QUEEN,
      BLOOMROT_NAMES.DEVOURER,
      N.CARRIONCAP,
      N.MYCO_WEAVER,
      N.SPORELING,
    ],
    avoidNames: [BLOOMROT_NAMES.TOKEN],
    preferredInstanceIds: topIds(
      analysis.faceUpBloomrotField || [],
      scoreOwnEquipTarget,
      1,
    ),
  };
}

function opponentEquipPreference(analysis = {}) {
  return {
    intent: "harm",
    role: "removal",
    preferredInstanceIds: topIds(
      faceupOpponentMonsters(analysis),
      (card) => scoreSporeTarget(card, analysis) + battleStat(card) / 50,
      1,
    ),
  };
}

function mycoWeaverCostPreference(analysis = {}) {
  const tokens = (analysis.field || []).filter(
    (card) => card?.isToken || card?.name === BLOOMROT_NAMES.TOKEN,
  );
  return {
    intent: "cost",
    role: "cost",
    preferNames: [BLOOMROT_NAMES.TOKEN, N.MOLDMENDER, N.ROOTLING],
    preserveNames: [
      N.MYCO_WEAVER,
      N.CARRIONCAP,
      N.GRAVECAP_WIDOW,
      N.ROT_STAG,
      N.ANCIENT_HUSK,
      BLOOMROT_NAMES.ANCIENT_MYCELIUM,
      BLOOMROT_NAMES.QUEEN,
      BLOOMROT_NAMES.DEVOURER,
    ],
    preferredInstanceIds: instanceIds(tokens),
  };
}

export function buildBloomrotTargetPreferences(sourceCard, analysis = {}) {
  const preferences = {};
  const defaultSporePreference = sporePreference(analysis);

  for (const targetId of SPORE_TARGET_IDS) {
    preferences[targetId] = defaultSporePreference;
  }
  preferences.bloomrot_ancient_husk_spore_targets = sporePreference(analysis, 2);
  preferences.bloomrot_spore_cloud_targets = debuffPreference(analysis);
  preferences.bloomrot_carrioncap_spore_target = debuffPreference(analysis);
  preferences.bloomrot_gravecap_widow_destroy_target = removalPreference(analysis, {
    monstersOnly: true,
  });
  preferences.destroy_targets = removalPreference(analysis);
  preferences.bloomrot_fungal_armor_equip_target = ownEquipPreference(analysis);
  preferences.bloomrot_overgrowth_equip_target = opponentEquipPreference(analysis);
  preferences.bloomrot_myco_weaver_cost = mycoWeaverCostPreference(analysis);
  preferences.bloomrot_rotting_ground_negate_target = removalPreference(analysis, {
    monstersOnly: true,
  });

  if (sourceCard?.name === N.FUNGAL_ARMOR) {
    preferences.targetPreference = ownEquipPreference(analysis);
  }

  return preferences;
}

function searchScore(card, action = {}, _ctx = {}) {
  if (!card) return -1000;
  const recoveryRank = RECOVERY_ORDER.indexOf(card.name);
  if ((action.zone || "deck") === "graveyard") {
    return recoveryRank >= 0 ? 100 - recoveryRank * 10 : cardValue(card);
  }
  if (card.name === N.MYCO_WEAVER) return 95;
  if (card.name === N.SPORELING) return 88;
  if (card.name === N.CARRIONCAP) return 78;
  if (card.name === N.ROOTLING) return 70;
  if (card.name === N.MOLDMENDER) return 62;
  return isBloomrot(card) ? cardValue(card) : 0;
}

export function rankBloomrotSearchCandidates(cards = [], action = {}, ctx = {}) {
  return (cards || [])
    .slice()
    .sort((a, b) => searchScore(b, action, ctx) - searchScore(a, action, ctx));
}

export const bloomrotTargetingInternals = {
  scoreSporeTarget,
  scoreRemovalTarget,
  scoreOwnEquipTarget,
};
