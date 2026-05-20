import { analyzeResourceEconomy } from "../common/resourceEconomy.js";
import {
  assessResourceRecovery,
  assessResourceSpend,
  scoreResourcePressure,
} from "../common/resourcePolicy.js";
import { isLuminarch } from "./knowledge.js";

const LUMINARCH = {
  aegisbearer: "Luminarch Aegisbearer",
  arbiter: "Luminarch Sanctified Arbiter",
  aurora: "Luminarch Aurora Seraph",
  barbarias: "Luminarch Megashield Barbarias",
  celestialMarshal: "Luminarch Celestial Marshal",
  citadel: "Sanctum of the Luminarch Citadel",
  crescentShield: "Luminarch Crescent Shield",
  enchantedHalberd: "Luminarch Enchanted Halberd",
  fortressAegis: "Luminarch Fortress Aegis",
  holyShield: "Luminarch Holy Shield",
  knightsConvocation: "Luminarch Knights Convocation",
  magicSickle: "Luminarch Magic Sickle",
  moonbladeCaptain: "Luminarch Moonblade Captain",
  moonlitBlessing: "Luminarch Moonlit Blessing",
  radiantLancer: "Luminarch Radiant Lancer",
  radiantWave: "Luminarch Radiant Wave",
  sacredJudgment: "Luminarch Sacred Judgment",
  sanctumProtector: "Luminarch Sanctum Protector",
  valiant: "Luminarch Valiant - Knight of the Dawn",
};

const LOW_VALUE_COST_NAMES = new Set([
  LUMINARCH.enchantedHalberd,
  LUMINARCH.valiant,
  LUMINARCH.arbiter,
]);

const RECOVERY_ENABLER_NAMES = new Set([
  LUMINARCH.fortressAegis,
  LUMINARCH.moonbladeCaptain,
  LUMINARCH.moonlitBlessing,
  LUMINARCH.sacredJudgment,
]);

const CORE_PRESERVE_NAMES = new Set([
  LUMINARCH.aegisbearer,
  LUMINARCH.aurora,
  LUMINARCH.barbarias,
  LUMINARCH.celestialMarshal,
  LUMINARCH.fortressAegis,
  LUMINARCH.moonbladeCaptain,
  LUMINARCH.radiantLancer,
  LUMINARCH.sanctumProtector,
]);

export const LUMINARCH_RESOURCE_POLICY = {
  resourceName: "Luminarch monster",
  primaryZone: "graveyard",
  thresholds: {
    preserveAt: 2,
    criticalAt: 4,
    recoveryStrandedMin: 2,
  },
  minAccessible: 0,
  defaultPreservePenalty: 0.8,
  penaltyPerResource: 0.15,
  recoverySpendPenalty: 0.5,
  defaultRecoveryBonus: 0.8,
  recoveryPreserveBonus: 0.35,
  spendModes: {
    discard: {
      baseDelta: 0.2,
      preservePenalty: 0.4,
      penaltyPerResource: 0.1,
      penalizeWhenRecovering: false,
    },
    tribute: {
      baseDelta: 0,
      preservePenalty: 0.8,
      penaltyPerResource: 0.15,
      penalizeWhenRecovering: false,
    },
    fusion_material: {
      baseDelta: 0,
      preservePenalty: 0.5,
      penaltyPerResource: 0.1,
      penalizeWhenRecovering: false,
    },
    protection_cost: {
      baseDelta: 0,
      preservePenalty: 1.0,
      penaltyPerResource: 0.2,
      blockWhenPreserving: false,
    },
  },
  recoveryModes: {
    moonlit_blessing: {
      baseDelta: 0,
      recoveryBonus: 1.1,
      preserveBonus: 0.4,
    },
    sacred_judgment: {
      baseDelta: 0,
      recoveryBonus: 1.4,
      preserveBonus: 0.5,
    },
    fortress_revive: {
      baseDelta: 0,
      recoveryBonus: 0.9,
      preserveBonus: 0.3,
    },
  },
};

function isLuminarchMonster(card) {
  return card?.cardKind === "monster" && isLuminarch(card);
}

function cardsIn(analysis = {}, zone) {
  const cards = analysis?.[zone];
  return Array.isArray(cards) ? cards : [];
}

function cardNames(cards = []) {
  return new Set(cards.map((card) => card?.name).filter(Boolean));
}

function hasFaceupName(cards = [], name) {
  return cards.some(
    (card) => card?.name === name && card.cardKind === "monster" && !card.isFacedown,
  );
}

function countHighValueReviveTargets(cards = []) {
  return cards.filter(
    (card) =>
      isLuminarchMonster(card) &&
      ((card.def || 0) >= 2000 ||
        (card.atk || 0) >= 2000 ||
        CORE_PRESERVE_NAMES.has(card.name)),
  ).length;
}

function countLowDefReviveTargets(cards = []) {
  return cards.filter(
    (card) => isLuminarchMonster(card) && (card.def || 0) <= 2000,
  ).length;
}

function countLowLevelReviveTargets(cards = []) {
  return cards.filter(
    (card) => isLuminarchMonster(card) && (card.level || 0) <= 4,
  ).length;
}

function buildZoneSummary(analysis = {}) {
  const hand = cardsIn(analysis, "hand");
  const field = cardsIn(analysis, "field");
  const spellTrap = cardsIn(analysis, "spellTrap");
  const graveyard = cardsIn(analysis, "graveyard");

  return {
    hand,
    field,
    spellTrap,
    graveyard,
    handNames: cardNames(hand),
    fieldNames: cardNames(field),
    spellTrapNames: cardNames(spellTrap),
    graveyardNames: cardNames(graveyard),
  };
}

function getEnablers(analysis = {}) {
  const zones = buildZoneSummary(analysis);
  const fieldSpell = analysis.fieldSpell || null;
  const canNormalSummon =
    analysis.summonAvailable === true ||
    analysis.canNormalSummon === true ||
    (analysis.normalSummonsAvailable || 0) > 0;
  const oppMonsterCount =
    analysis.oppFieldCount ??
    cardsIn(analysis, "oppField").filter((card) => card?.cardKind === "monster")
      .length;
  const lp = analysis.lp || 8000;

  return {
    hasCitadel: fieldSpell?.name === LUMINARCH.citadel,
    hasMoonlitBlessing:
      zones.handNames.has(LUMINARCH.moonlitBlessing) ||
      zones.spellTrapNames.has(LUMINARCH.moonlitBlessing),
    hasMagicSickleOnField: hasFaceupName(zones.field, LUMINARCH.magicSickle),
    hasMoonbladeInHand: zones.handNames.has(LUMINARCH.moonbladeCaptain),
    hasFortressAegisOnField: hasFaceupName(zones.field, LUMINARCH.fortressAegis),
    hasSacredJudgment: zones.handNames.has(LUMINARCH.sacredJudgment),
    sacredJudgmentLive:
      zones.handNames.has(LUMINARCH.sacredJudgment) &&
      zones.field.filter((card) => card?.cardKind === "monster").length === 0 &&
      oppMonsterCount >= 2 &&
      lp >= 2500,
    canNormalSummon,
    oppMonsterCount,
    hasRecoveryCardInHand: zones.hand.some((card) =>
      RECOVERY_ENABLER_NAMES.has(card?.name),
    ),
  };
}

function computeAccessibility({ analysis, countsByZone, enablers }) {
  const graveyard = cardsIn(analysis, "graveyard");
  const gyCount = countsByZone.graveyard || 0;
  let accessibleFromGY = 0;

  if (enablers.hasMoonlitBlessing) accessibleFromGY += 1;
  if (enablers.hasMagicSickleOnField) accessibleFromGY += Math.min(2, gyCount);
  if (enablers.hasFortressAegisOnField && (analysis.lp || 8000) > 1000) {
    accessibleFromGY += Math.min(1, countLowDefReviveTargets(graveyard));
  }
  if (enablers.hasMoonbladeInHand && enablers.canNormalSummon) {
    accessibleFromGY += Math.min(1, countLowLevelReviveTargets(graveyard));
  }
  if (enablers.sacredJudgmentLive) {
    accessibleFromGY += Math.min(5, enablers.oppMonsterCount || 0, gyCount);
  }

  accessibleFromGY = Math.min(gyCount, accessibleFromGY);

  return {
    accessibleByZone: {
      hand: countsByZone.hand || 0,
      field: countsByZone.field || 0,
      graveyard: accessibleFromGY,
    },
    strandedByZone: {
      graveyard: Math.max(0, gyCount - accessibleFromGY),
    },
  };
}

function computePotential({ analysis, countsByZone, enablers }) {
  const graveyard = cardsIn(analysis, "graveyard");
  const highValueReviveTargets = countHighValueReviveTargets(graveyard);
  const lowDefReviveTargets = countLowDefReviveTargets(graveyard);
  const lowLevelReviveTargets = countLowLevelReviveTargets(graveyard);

  return {
    graveyardMonsters: countsByZone.graveyard || 0,
    highValueReviveTargets,
    lowDefReviveTargets,
    lowLevelReviveTargets,
    moonlitCitadelReady:
      enablers.hasMoonlitBlessing &&
      enablers.hasCitadel &&
      (countsByZone.graveyard || 0) > 0,
    magicSickleReady:
      enablers.hasMagicSickleOnField && (countsByZone.graveyard || 0) >= 2,
    fortressReviveReady:
      enablers.hasFortressAegisOnField &&
      (analysis.lp || 8000) > 1000 &&
      lowDefReviveTargets > 0,
    moonbladeReviveReady:
      enablers.hasMoonbladeInHand &&
      enablers.canNormalSummon &&
      lowLevelReviveTargets > 0,
    sacredJudgmentReady:
      enablers.sacredJudgmentLive && highValueReviveTargets > 0,
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
  const hasRecoveryLine = totalAccessibleResources > (countsByZone.hand || 0) + (countsByZone.field || 0);
  const highValueRecoveryReady =
    potential?.moonlitCitadelReady ||
    potential?.fortressReviveReady ||
    potential?.sacredJudgmentReady;

  return {
    isHealthy: totalAccessibleResources >= 2 && totalStrandedResources <= 1,
    needsRecovery:
      totalStrandedResources >= 2 ||
      (gyCount > 0 && enablers.hasRecoveryCardInHand && !hasRecoveryLine),
    shouldPreserve:
      highValueRecoveryReady ||
      potential?.magicSickleReady ||
      (gyCount >= 2 && hasRecoveryLine),
    critical:
      potential?.sacredJudgmentReady ||
      gyCount >= 4 ||
      (potential?.highValueReviveTargets >= 2 && highValueRecoveryReady),
    hasRecoveryLine,
    highValueRecoveryReady,
  };
}

export function buildLuminarchResourceEconomy(analysis = {}) {
  return analyzeResourceEconomy(analysis, {
    resourceName: LUMINARCH_RESOURCE_POLICY.resourceName,
    zones: ["hand", "field", "graveyard"],
    matchResource: isLuminarchMonster,
    getEnablers,
    computeAccessibility,
    computePotential,
    computeFlags,
  });
}

export function getLuminarchResourcePressure(analysis = {}, context = {}) {
  const economy =
    analysis.resourceEconomy || buildLuminarchResourceEconomy(analysis);
  return scoreResourcePressure(economy, LUMINARCH_RESOURCE_POLICY, context);
}

export function assessLuminarchResourceSpend(
  analysis = {},
  spend = {},
  context = {},
) {
  const economy =
    analysis.resourceEconomy || buildLuminarchResourceEconomy(analysis);
  return assessResourceSpend({
    economy,
    spend,
    policy: LUMINARCH_RESOURCE_POLICY,
    context,
  });
}

export function assessLuminarchResourceRecovery(
  analysis = {},
  recovery = {},
  context = {},
) {
  const economy =
    analysis.resourceEconomy || buildLuminarchResourceEconomy(analysis);
  return assessResourceRecovery({
    economy,
    recovery,
    policy: LUMINARCH_RESOURCE_POLICY,
    context,
  });
}

export function buildLuminarchResourcePreferences(analysis = {}) {
  const economy =
    analysis.resourceEconomy || buildLuminarchResourceEconomy(analysis);
  const pressure = scoreResourcePressure(economy, LUMINARCH_RESOURCE_POLICY);
  const preferNames = new Set();
  const preserveNames = new Set();

  for (const card of cardsIn(analysis, "hand")) {
    if (LOW_VALUE_COST_NAMES.has(card?.name)) preferNames.add(card.name);
  }

  const potential = economy.potential || {};
  if (pressure.shouldRecover || potential.moonlitCitadelReady) {
    preserveNames.add(LUMINARCH.moonlitBlessing);
    preserveNames.add(LUMINARCH.citadel);
  }
  if (potential.magicSickleReady) preserveNames.add(LUMINARCH.magicSickle);
  if (potential.fortressReviveReady) preserveNames.add(LUMINARCH.fortressAegis);
  if (potential.sacredJudgmentReady) preserveNames.add(LUMINARCH.sacredJudgment);

  if (pressure.shouldPreserve) {
    preserveNames.add(LUMINARCH.aegisbearer);
    preserveNames.add(LUMINARCH.sanctumProtector);
    preserveNames.add(LUMINARCH.fortressAegis);
  }

  return {
    resourceEconomy: economy,
    resourcePressure: pressure,
    preferNames: [...preferNames],
    preserveNames: [...preserveNames],
  };
}
