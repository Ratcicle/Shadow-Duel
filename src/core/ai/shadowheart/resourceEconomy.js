import { analyzeResourceEconomy } from "../common/resourceEconomy.js";
import {
  assessResourceRecovery,
  assessResourceSpend,
  scoreResourcePressure,
} from "../common/resourcePolicy.js";
import { isShadowHeart, isShadowHeartByName } from "./knowledge.js";

const SH = {
  infusion: "Shadow-Heart Infusion",
  covenant: "Shadow-Heart Covenant",
  voidMage: "Shadow-Heart Void Mage",
  imp: "Shadow-Heart Imp",
  gecko: "Shadow-Heart Gecko",
  eel: "Shadow-Heart Abyssal Eel",
  specter: "Shadow-Heart Specter",
  coward: "Shadow-Heart Coward",
  scale: "Shadow-Heart Scale Dragon",
  arctroth: "Shadow-Heart Demon Arctroth",
  deathWyrm: "Shadow-Heart Death Wyrm",
  demonDragon: "Shadow-Heart Demon Dragon",
  warlord: "Shadow-Heart Warlord",
  poly: "Polymerization",
  purge: "Shadow-Heart Purge",
  rage: "Shadow-Heart Rage",
  battleHymn: "Shadow-Heart Battle Hymn",
  theShadowHeart: "The Shadow Heart",
};

const LOW_VALUE_ENGINE_NAMES = new Set([
  SH.coward,
  SH.specter,
  SH.gecko,
]);

const RECOVERY_ENABLER_NAMES = new Set([
  SH.infusion,
  SH.specter,
  SH.scale,
  SH.warlord,
]);

export const SHADOW_HEART_RESOURCE_POLICY = {
  resourceName: "Shadow-Heart monster",
  primaryZone: "graveyard",
  thresholds: {
    preserveAt: 2,
    criticalAt: 4,
    recoveryStrandedMin: 2,
  },
  minAccessible: 1,
  defaultPreservePenalty: 1.0,
  penaltyPerResource: 0.25,
  recoverySpendPenalty: 0.8,
  defaultRecoveryBonus: 1.0,
  recoveryPreserveBonus: 0.4,
  spendModes: {
    discard: {
      baseDelta: 0.25,
      preservePenalty: 0.4,
      penaltyPerResource: 0.1,
      penalizeWhenRecovering: false,
    },
    tribute: {
      baseDelta: 0,
      preservePenalty: 0.8,
      penaltyPerResource: 0.2,
      penalizeWhenRecovering: false,
    },
    fusion_material: {
      baseDelta: 0,
      preservePenalty: 0.6,
      penaltyPerResource: 0.15,
      penalizeWhenRecovering: false,
    },
  },
  recoveryModes: {
    graveyard_recursion: {
      baseDelta: 0,
      recoveryBonus: 1.3,
      preserveBonus: 0.5,
    },
    revive: {
      baseDelta: 0,
      recoveryBonus: 1.1,
      preserveBonus: 0.4,
    },
  },
};

function isShadowHeartMonster(card) {
  return (
    card?.cardKind === "monster" &&
    (isShadowHeart(card) || isShadowHeartByName(card?.name))
  );
}

function cardsIn(analysis = {}, zone) {
  const cards = analysis?.[zone];
  return Array.isArray(cards) ? cards : [];
}

function hasName(cards = [], name) {
  return cards.some((card) => card?.name === name);
}

function countLowAtkReviveTargets(cards = []) {
  return cards.filter(
    (card) => isShadowHeartMonster(card) && (card.atk || 0) <= 1600,
  ).length;
}

function buildZoneSummary(analysis = {}) {
  const hand = cardsIn(analysis, "hand");
  const field = cardsIn(analysis, "field");
  const graveyard = cardsIn(analysis, "graveyard");
  const all = [...hand, ...field, ...graveyard];

  return {
    hand,
    field,
    graveyard,
    all,
    handNames: new Set(hand.map((card) => card?.name).filter(Boolean)),
    fieldNames: new Set(field.map((card) => card?.name).filter(Boolean)),
    graveyardNames: new Set(graveyard.map((card) => card?.name).filter(Boolean)),
  };
}

function getEnablers(analysis = {}) {
  const zones = buildZoneSummary(analysis);
  return {
    hasInfusion: zones.handNames.has(SH.infusion) && zones.hand.length >= 3,
    hasSpecterOnField: zones.fieldNames.has(SH.specter),
    hasSpecterInGY: zones.graveyardNames.has(SH.specter),
    hasScaleOnField: zones.fieldNames.has(SH.scale),
    hasWarlordOnField: zones.fieldNames.has(SH.warlord),
    hasTheShadowHeart:
      zones.handNames.has(SH.theShadowHeart) && zones.field.length === 0,
    hasPolymerization: zones.handNames.has(SH.poly),
    canNormalSummon:
      analysis.summonAvailable === true ||
      analysis.canNormalSummon === true ||
      (analysis.normalSummonsAvailable || 0) > 0,
    hasRecoveryCardInHand: zones.hand.some((card) =>
      RECOVERY_ENABLER_NAMES.has(card?.name),
    ),
  };
}

function canAccessGraveyard(enablers = {}) {
  return (
    enablers.hasInfusion ||
    enablers.hasSpecterOnField ||
    enablers.hasScaleOnField ||
    enablers.hasWarlordOnField ||
    enablers.hasTheShadowHeart
  );
}

function computeAccessibility({ countsByZone, enablers }) {
  const gyAccess = canAccessGraveyard(enablers)
    ? countsByZone.graveyard || 0
    : 0;

  return {
    accessibleByZone: {
      hand: countsByZone.hand || 0,
      field: countsByZone.field || 0,
      graveyard: gyAccess,
    },
    strandedByZone: {
      graveyard: Math.max(0, (countsByZone.graveyard || 0) - gyAccess),
    },
  };
}

function computePotential({ analysis, countsByZone, enablers }) {
  const hand = cardsIn(analysis, "hand");
  const field = cardsIn(analysis, "field");
  const graveyard = cardsIn(analysis, "graveyard");
  const handAndField = [...hand, ...field];
  const shMonstersInHand = hand.filter(isShadowHeartMonster);
  const shMonstersOnField = field.filter(isShadowHeartMonster);

  return {
    graveyardMonsters: countsByZone.graveyard || 0,
    lowAtkReviveTargets: countLowAtkReviveTargets(graveyard),
    lowValueDiscards: hand.filter((card) => LOW_VALUE_ENGINE_NAMES.has(card?.name))
      .length,
    fusionMaterialCount: handAndField.filter(isShadowHeartMonster).length,
    demonDragonReady:
      hasName(handAndField, SH.scale) &&
      handAndField.some(
        (card) =>
          isShadowHeartMonster(card) &&
          card.name !== SH.scale &&
          (card.level || 0) >= 8,
      ),
    warlordReady: handAndField.filter(isShadowHeartMonster).length >= 2,
    tributeBodies: shMonstersOnField.length,
    emergencyInfusionStarter:
      enablers.hasInfusion &&
      (countsByZone.graveyard || 0) === 0 &&
      shMonstersInHand.length > 0 &&
      hand.length >= 3,
  };
}

function computeFlags({
  countsByZone,
  enablers,
  totalAccessibleResources,
  totalStrandedResources,
  potential,
}) {
  const gyCount = countsByZone.graveyard || 0;
  const hasRecoveryLine = canAccessGraveyard(enablers);
  const payoffReady = potential?.demonDragonReady || potential?.warlordReady;

  return {
    isHealthy: totalAccessibleResources >= 2 && totalStrandedResources === 0,
    needsRecovery:
      totalStrandedResources >= 2 ||
      (gyCount > 0 && enablers.hasRecoveryCardInHand && !hasRecoveryLine),
    shouldPreserve:
      payoffReady ||
      potential?.emergencyInfusionStarter ||
      (gyCount >= 2 && hasRecoveryLine),
    critical:
      gyCount >= 4 ||
      (potential?.lowAtkReviveTargets >= 2 && enablers.hasInfusion),
    hasRecoveryLine,
    payoffReady,
  };
}

export function buildShadowHeartResourceEconomy(analysis = {}) {
  return analyzeResourceEconomy(analysis, {
    resourceName: SHADOW_HEART_RESOURCE_POLICY.resourceName,
    zones: ["hand", "field", "graveyard"],
    matchResource: isShadowHeartMonster,
    getEnablers,
    computeAccessibility,
    computePotential,
    computeFlags,
  });
}

export function getShadowHeartResourcePressure(analysis = {}, context = {}) {
  const economy =
    analysis.resourceEconomy || buildShadowHeartResourceEconomy(analysis);
  return scoreResourcePressure(
    economy,
    SHADOW_HEART_RESOURCE_POLICY,
    context,
  );
}

export function assessShadowHeartResourceSpend(
  analysis = {},
  spend = {},
  context = {},
) {
  const economy =
    analysis.resourceEconomy || buildShadowHeartResourceEconomy(analysis);
  return assessResourceSpend({
    economy,
    spend,
    policy: SHADOW_HEART_RESOURCE_POLICY,
    context,
  });
}

export function assessShadowHeartResourceRecovery(
  analysis = {},
  recovery = {},
  context = {},
) {
  const economy =
    analysis.resourceEconomy || buildShadowHeartResourceEconomy(analysis);
  return assessResourceRecovery({
    economy,
    recovery,
    policy: SHADOW_HEART_RESOURCE_POLICY,
    context,
  });
}

export function buildShadowHeartResourcePreferences(analysis = {}) {
  const economy =
    analysis.resourceEconomy || buildShadowHeartResourceEconomy(analysis);
  const pressure = scoreResourcePressure(
    economy,
    SHADOW_HEART_RESOURCE_POLICY,
  );
  const preferNames = new Set();
  const preserveNames = new Set();

  for (const card of cardsIn(analysis, "hand")) {
    if (LOW_VALUE_ENGINE_NAMES.has(card?.name)) {
      preferNames.add(card.name);
    }
  }

  const potential = economy.potential || {};
  if (pressure.shouldRecover || potential.lowAtkReviveTargets > 0) {
    preserveNames.add(SH.infusion);
  }

  if (potential.demonDragonReady) {
    preserveNames.add(SH.poly);
    preserveNames.add(SH.scale);
    preserveNames.add(SH.demonDragon);
  }

  if (potential.warlordReady) {
    preserveNames.add(SH.poly);
  }

  if (pressure.shouldPreserve) {
    preserveNames.add(SH.scale);
    preserveNames.add(SH.arctroth);
    preserveNames.add(SH.deathWyrm);
    preserveNames.add(SH.purge);
  }

  return {
    resourceEconomy: economy,
    resourcePressure: pressure,
    preferNames: [...preferNames],
    preserveNames: [...preserveNames],
  };
}
