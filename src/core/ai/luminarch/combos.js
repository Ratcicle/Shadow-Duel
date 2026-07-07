// -----------------------------------------------------------------------------
// src/core/ai/luminarch/combos.js
// Line-package detection for the Luminarch archetype.
// -----------------------------------------------------------------------------

import {
  isLuminarch,
  LUMINARCH_LINE_PACKAGES,
  LUMINARCH_PACKAGE_STATUS,
} from "./knowledge.js";
import { getTotalAttackThreat } from "../common/cardStats.js";
import {
  createAvailableCombo,
  createZoneIndex,
  getZoneCards,
} from "../common/comboDetection.js";

const ZONES = [
  "hand",
  "field",
  "graveyard",
  "spellTrap",
  "extraDeck",
  "oppField",
];

const NAMES = Object.freeze({
  aegisbearer: "Luminarch Aegisbearer",
  arbiter: "Luminarch Sanctified Arbiter",
  aurora: "Luminarch Aurora Seraph",
  barbarias: "Luminarch Megashield Barbarias",
  citadel: "Sanctum of the Luminarch Citadel",
  crescentShield: "Luminarch Crescent Shield",
  enchantedHalberd: "Luminarch Enchanted Halberd",
  fortress: "Luminarch Fortress Aegis",
  holyAscension: "Luminarch Holy Ascension",
  holyShield: "Luminarch Holy Shield",
  knightsConvocation: "Luminarch Knights Convocation",
  magicSickle: "Luminarch Magic Sickle",
  marshal: "Luminarch Celestial Marshal",
  moonblade: "Luminarch Moonblade Captain",
  moonlit: "Luminarch Moonlit Blessing",
  polymerization: "Polymerization",
  protector: "Luminarch Sanctum Protector",
  pureKnight: "Luminarch Pure Knight",
  radiantLancer: "Luminarch Radiant Lancer",
  radiantWave: "Luminarch Radiant Wave",
  sacredJudgment: "Luminarch Sacred Judgment",
  spear: "Luminarch Spear of Dawnfall",
  sunforgedBlade: "Luminarch Sunforged Blade",
  valiant: "Luminarch Valiant - Knight of the Dawn",
});

const HIGH_VALUE_SICKLE_SPELL_TARGETS = new Set([
  NAMES.citadel,
  NAMES.holyAscension,
  NAMES.holyShield,
  NAMES.moonlit,
  NAMES.radiantWave,
  NAMES.sacredJudgment,
  NAMES.spear,
  NAMES.sunforgedBlade,
]);

export const COMBO_DATABASE = [
  {
    id: LUMINARCH_LINE_PACKAGES.STARTER,
    name: "Starter Package",
    package: LUMINARCH_LINE_PACKAGES.STARTER,
    status: LUMINARCH_PACKAGE_STATUS.PARTIAL,
    priority: 12,
    priorityBucket: "high",
    milestone: "Starter online",
    strategicRole: "Access core cards, find searchers, and start the turn line.",
    coveredCombos: [
      "Valiant Starter",
      "Arbiter Starter",
      "Knights Convocation Discard Setup",
      "Moonblade Captain Revive",
      "Moonblade + Enchanted Halberd",
    ],
  },
  {
    id: LUMINARCH_LINE_PACKAGES.CITADEL,
    name: "Citadel Package",
    package: LUMINARCH_LINE_PACKAGES.CITADEL,
    status: LUMINARCH_PACKAGE_STATUS.PARTIAL,
    priority: 13,
    priorityBucket: "high",
    milestone: "Citadel online",
    strategicRole: "Put Sanctum of the Luminarch Citadel online through any route.",
    coveredCombos: [
      "Valiant -> Arbiter -> Citadel",
      "Pure Knight -> Citadel",
    ],
  },
  {
    id: LUMINARCH_LINE_PACKAGES.WALL,
    name: "Wall Package",
    package: LUMINARCH_LINE_PACKAGES.WALL,
    status: LUMINARCH_PACKAGE_STATUS.PARTIAL,
    priority: 12,
    priorityBucket: "high",
    milestone: "Wall established",
    strategicRole: "Survive, force bad attacks, and reduce opponent lethal lines.",
    coveredCombos: [
      "Valiant -> Aegisbearer -> Protector",
      "Aegisbearer Taunt Core",
      "Celestial Marshal Self-Summon",
      "Celestial Marshal + Halberd",
      "Celestial Marshal Battle Wall",
      "Holy Shield Multi-Guard",
      "Holy Shield + Citadel Protection Stack",
      "Aurora Seraph Sacrifice Shield",
    ],
  },
  {
    id: LUMINARCH_LINE_PACKAGES.FUSION,
    name: "Fusion Package",
    package: LUMINARCH_LINE_PACKAGES.FUSION,
    status: LUMINARCH_PACKAGE_STATUS.NEEDS_ACTION_GENERATION,
    priority: 11,
    priorityBucket: "high",
    milestone: "Fusion payoff",
    strategicRole: "Convert bodies into Pure Knight or Barbarias based on final state.",
    coveredCombos: [
      "Protector + Level 5+ -> Megashield Barbarias",
    ],
  },
  {
    id: LUMINARCH_LINE_PACKAGES.ASCENSION,
    name: "Ascension Package",
    package: LUMINARCH_LINE_PACKAGES.ASCENSION,
    status: LUMINARCH_PACKAGE_STATUS.PARTIAL,
    priority: 10,
    priorityBucket: "high",
    milestone: "Ascension payoff",
    strategicRole: "Upgrade mature Aegisbearer into Fortress Aegis.",
    coveredCombos: ["Aegisbearer -> Fortress Aegis"],
  },
  {
    id: LUMINARCH_LINE_PACKAGES.GRIND,
    name: "Grind Package",
    package: LUMINARCH_LINE_PACKAGES.GRIND,
    status: LUMINARCH_PACKAGE_STATUS.NEEDS_ACTION_GENERATION,
    priority: 10,
    priorityBucket: "high",
    milestone: "Grind engine online",
    strategicRole: "Recover resources and rebuild after trades.",
    coveredCombos: [
      "Fortress Aegis Revive Loop",
      "Convocation -> Moonlit Blessing",
      "Arbiter -> Moonlit Blessing -> Revive",
      "Magic Sickle Spell Recycle",
      "Radiant Wave LP Removal",
      "Radiant Wave + Moonlit Recovery",
    ],
  },
  {
    id: LUMINARCH_LINE_PACKAGES.BATTLE_CONVERSION,
    name: "Battle Conversion Package",
    package: LUMINARCH_LINE_PACKAGES.BATTLE_CONVERSION,
    status: LUMINARCH_PACKAGE_STATUS.NEEDS_MAIN_BATTLE_MAIN2,
    priority: 9,
    priorityBucket: "battle",
    milestone: "Battle converted",
    strategicRole: "Turn combat into removal, damage, healing, or permanent growth.",
    coveredCombos: [
      "Barbarias Position Push",
      "Moonblade Double Attack",
      "Magic Sickle Battle Trick",
      "Magic Sickle + Sunforged Blade",
      "Spear of Dawnfall Battle Break",
      "Spear + Valiant Pierce",
      "Spear + Moonblade Second Attack",
      "Spear + Aurora Seraph Heal",
      "Radiant Lancer Growth",
      "Radiant Lancer Punish",
    ],
  },
  {
    id: LUMINARCH_LINE_PACKAGES.LP_PAYOFF,
    name: "LP Payoff Package",
    package: LUMINARCH_LINE_PACKAGES.LP_PAYOFF,
    status: LUMINARCH_PACKAGE_STATUS.PARTIAL,
    priority: 9,
    priorityBucket: "medium_high",
    milestone: "LP payoff online",
    strategicRole: "Convert LP gain or LP payments into board, safety, or stats.",
    coveredCombos: [
      "Barbarias + Citadel",
      "Barbarias + Holy Shield",
      "Pure Knight + Holy Ascension",
      "Pure Knight + Citadel Buff",
      "Sunforged Blade + Citadel",
      "Sunforged Blade + Holy Shield",
      "Sunforged Blade + Barbarias",
      "Aurora Seraph + Sunforged Blade",
    ],
  },
  {
    id: LUMINARCH_LINE_PACKAGES.COMEBACK,
    name: "Comeback Package",
    package: LUMINARCH_LINE_PACKAGES.COMEBACK,
    status: LUMINARCH_PACKAGE_STATUS.PARTIAL,
    priority: 11,
    priorityBucket: "critical_high",
    milestone: "Comeback live",
    strategicRole: "Flip games under pressure with rebuild or survival lines.",
    coveredCombos: [
      "Sacred Judgment Comeback",
      "Sacred Judgment + Halberd",
    ],
  },
];

const COMBO_BY_PACKAGE = new Map(
  COMBO_DATABASE.map((entry) => [entry.package, entry]),
);

function getZones(analysis = {}) {
  const zoneIndex = createZoneIndex(analysis, ZONES);
  return {
    zoneIndex,
    hand: getZoneCards(zoneIndex, "hand"),
    field: getZoneCards(zoneIndex, "field"),
    graveyard: getZoneCards(zoneIndex, "graveyard"),
    spellTrap: getZoneCards(zoneIndex, "spellTrap"),
    extraDeck: getZoneCards(zoneIndex, "extraDeck"),
    oppField: getZoneCards(zoneIndex, "oppField"),
  };
}

function isLuminarchMonster(card) {
  return card?.cardKind === "monster" && isLuminarch(card);
}

function isFaceupLuminarchMonster(card) {
  return isLuminarchMonster(card) && !card.isFacedown;
}

function hasName(cards = [], name) {
  return cards.some((card) => card?.name === name);
}

function hasAnyName(cards = [], names = []) {
  return cards.some((card) => card?.name && names.includes(card.name));
}

function countMatching(cards = [], predicate) {
  return cards.filter((card) => card && predicate(card)).length;
}

function countLuminarchMonsters(cards = []) {
  return countMatching(cards, isLuminarchMonster);
}

function collectNames(cards = []) {
  return [...new Set(cards.map((card) => card?.name).filter(Boolean))];
}

function hasUsefulSickleSpellTarget(graveyard = []) {
  return graveyard.some(
    (card) =>
      card &&
      card.cardKind === "spell" &&
      isLuminarch(card) &&
      HIGH_VALUE_SICKLE_SPELL_TARGETS.has(card.name),
  );
}

function hasSpellRecoveryTarget(graveyard = []) {
  return hasName(graveyard, NAMES.magicSickle) && hasUsefulSickleSpellTarget(graveyard);
}

function buildPackageState(analysis = {}) {
  const zones = getZones(analysis);
  const fieldSpell = analysis.fieldSpell || null;
  const fieldMonsters = zones.field.filter((card) => card?.cardKind === "monster");
  const handMonsters = zones.hand.filter((card) => card?.cardKind === "monster");
  const allMainMaterials = [...zones.hand, ...zones.field].filter(
    (card) => card && card.cardKind !== "spell" && card.cardKind !== "trap",
  );
  const gyLuminarchMonsters = zones.graveyard.filter(isLuminarchMonster);
  const faceupLuminarch = zones.field.filter(isFaceupLuminarchMonster);
  const oppMonsters = zones.oppField.filter((card) => card?.cardKind === "monster");
  const lp = analysis.lp || 8000;
  const oppLp = analysis.oppLp || 8000;
  const oppThreat = getTotalAttackThreat(oppMonsters, {
    facedownValue: "printed",
    includeBoosts: false,
  });

  return {
    ...zones,
    analysis,
    fieldSpell,
    fieldMonsters,
    handMonsters,
    allMainMaterials,
    gyLuminarchMonsters,
    faceupLuminarch,
    oppMonsters,
    lp,
    oppLp,
    oppThreat,
    hasCitadelActive: fieldSpell?.name === NAMES.citadel,
    hasCitadelInHand: hasName(zones.hand, NAMES.citadel),
    hasPoly: hasName(zones.hand, NAMES.polymerization),
  };
}

function packageData(packageId) {
  return COMBO_BY_PACKAGE.get(packageId) || null;
}

function makePackage(packageId, details = {}) {
  const base = packageData(packageId);
  if (!base) return null;
  const priority = Math.max(0, (base.priority || 0) + (details.priorityBoost || 0));
  return createAvailableCombo({
    combo: base,
    id: base.id,
    name: base.name,
    package: base.package,
    status: details.status || base.status,
    ready: details.ready !== false,
    priority,
    priorityBucket: base.priorityBucket,
    milestone: details.milestone || base.milestone,
    strategicRole: base.strategicRole,
    coveredCombos: base.coveredCombos,
    signals: details.signals || [],
    cards: details.cards || [],
    conditions: details.conditions || {},
    diagnostics: details.diagnostics || {},
    description: details.description || base.strategicRole,
    steps: details.steps || [base.milestone],
  });
}

function evaluateStarterPackage(state) {
  const hasValiant = hasName(state.hand, NAMES.valiant);
  const hasArbiter = hasName(state.hand, NAMES.arbiter);
  const hasMoonbladeRevive =
    hasName(state.hand, NAMES.moonblade) &&
    state.gyLuminarchMonsters.some((card) => (card.level || 0) <= 4);
  const hasConvocationSetup =
    hasName(state.hand, NAMES.knightsConvocation) &&
    state.hand.some((card) => isLuminarchMonster(card) && (card.level || 0) >= 5);
  if (!hasValiant && !hasArbiter && !hasMoonbladeRevive && !hasConvocationSetup) {
    return null;
  }

  return makePackage(LUMINARCH_LINE_PACKAGES.STARTER, {
    priorityBoost: (hasValiant || hasArbiter ? 2 : 0) + (hasConvocationSetup ? 1 : 0),
    signals: [
      ...(hasValiant ? ["valiant_search"] : []),
      ...(hasArbiter ? ["arbiter_spell_search"] : []),
      ...(hasMoonbladeRevive ? ["moonblade_revive"] : []),
      ...(hasConvocationSetup ? ["convocation_setup"] : []),
    ],
    cards: collectNames(state.hand).filter((name) =>
      [
        NAMES.valiant,
        NAMES.arbiter,
        NAMES.moonblade,
        NAMES.knightsConvocation,
      ].includes(name),
    ),
    conditions: { hasValiant, hasArbiter, hasMoonbladeRevive, hasConvocationSetup },
  });
}

function evaluateCitadelPackage(state) {
  const pureKnightRoute =
    state.hasPoly &&
    hasName(state.extraDeck, NAMES.pureKnight) &&
    countLuminarchMonsters(state.allMainMaterials) >= 2;
  const hasAccess =
    state.hasCitadelActive ||
    state.hasCitadelInHand ||
    hasName(state.hand, NAMES.arbiter) ||
    pureKnightRoute;
  if (!hasAccess) return null;

  return makePackage(LUMINARCH_LINE_PACKAGES.CITADEL, {
    priorityBoost: state.hasCitadelActive ? -4 : pureKnightRoute ? 3 : 2,
    status: state.hasCitadelActive
      ? LUMINARCH_PACKAGE_STATUS.SUPPORTED
      : LUMINARCH_PACKAGE_STATUS.PARTIAL,
    signals: [
      ...(state.hasCitadelActive ? ["citadel_active"] : []),
      ...(state.hasCitadelInHand ? ["citadel_in_hand"] : []),
      ...(hasName(state.hand, NAMES.arbiter) ? ["arbiter_access"] : []),
      ...(pureKnightRoute ? ["pure_knight_access"] : []),
    ],
    cards: [
      NAMES.citadel,
      ...(pureKnightRoute ? [NAMES.pureKnight] : []),
      ...(hasName(state.hand, NAMES.arbiter) ? [NAMES.arbiter] : []),
    ],
    conditions: { hasAccess, citadelActive: state.hasCitadelActive, pureKnightRoute },
  });
}

function evaluateWallPackage(state) {
  const aegisAvailable = hasName(state.hand, NAMES.aegisbearer) || hasName(state.field, NAMES.aegisbearer);
  const protectorLine = hasName(state.field, NAMES.aegisbearer) && hasName(state.hand, NAMES.protector);
  const marshalLine = hasName(state.hand, NAMES.marshal);
  const fortressWall = hasName(state.field, NAMES.fortress);
  const holyShieldReady = hasName(state.hand, NAMES.holyShield) && state.faceupLuminarch.length > 0;
  const auroraShield = hasName(state.field, NAMES.aurora) && state.faceupLuminarch.length >= 2;
  if (
    !aegisAvailable &&
    !protectorLine &&
    !marshalLine &&
    !fortressWall &&
    !holyShieldReady &&
    !auroraShield
  ) {
    return null;
  }

  const pressureBoost =
    state.oppThreat >= state.lp ? 4 : state.oppMonsters.length >= 2 ? 2 : 0;
  return makePackage(LUMINARCH_LINE_PACKAGES.WALL, {
    priorityBoost: pressureBoost,
    signals: [
      ...(aegisAvailable ? ["aegis_taunt"] : []),
      ...(protectorLine ? ["protector_upgrade"] : []),
      ...(marshalLine ? ["marshal_wall"] : []),
      ...(fortressWall ? ["fortress_taunt"] : []),
      ...(holyShieldReady ? ["holy_shield_reactive"] : []),
      ...(auroraShield ? ["aurora_replacement"] : []),
    ],
    cards: [
      ...(aegisAvailable ? [NAMES.aegisbearer] : []),
      ...(protectorLine ? [NAMES.protector] : []),
      ...(marshalLine ? [NAMES.marshal] : []),
      ...(fortressWall ? [NAMES.fortress] : []),
      ...(holyShieldReady ? [NAMES.holyShield] : []),
      ...(auroraShield ? [NAMES.aurora] : []),
    ],
    conditions: {
      aegisAvailable,
      protectorLine,
      marshalLine,
      fortressWall,
      holyShieldReady,
      auroraShield,
    },
    diagnostics: { oppThreat: state.oppThreat, lp: state.lp },
  });
}

function evaluateFusionPackage(state) {
  if (!state.hasPoly) return null;
  const luminarchMaterials = state.allMainMaterials.filter(isLuminarchMonster);
  const pureReady =
    hasName(state.extraDeck, NAMES.pureKnight) && luminarchMaterials.length >= 2;
  const protectorMaterial = luminarchMaterials.find(
    (card) => card.name === NAMES.protector,
  );
  const levelFivePlusAvailable = luminarchMaterials.some(
    (card) => card !== protectorMaterial && (card.level || 0) >= 5,
  );
  const barbariasReady =
    hasName(state.extraDeck, NAMES.barbarias) &&
    !!protectorMaterial &&
    levelFivePlusAvailable;
  if (!pureReady && !barbariasReady) return null;

  const needsCitadel = !state.hasCitadelActive;
  return makePackage(LUMINARCH_LINE_PACKAGES.FUSION, {
    priorityBoost: needsCitadel && pureReady ? 3 : barbariasReady ? 2 : 0,
    status: LUMINARCH_PACKAGE_STATUS.NEEDS_ACTION_GENERATION,
    signals: [
      ...(pureReady ? ["pure_knight_ready"] : []),
      ...(barbariasReady ? ["barbarias_ready"] : []),
      ...(needsCitadel ? ["citadel_missing"] : []),
    ],
    cards: [
      NAMES.polymerization,
      ...(pureReady ? [NAMES.pureKnight] : []),
      ...(barbariasReady ? [NAMES.barbarias] : []),
    ],
    conditions: { pureReady, barbariasReady, needsCitadel },
  });
}

function evaluateAscensionPackage(state) {
  const aegis = state.field.find((card) => card?.name === NAMES.aegisbearer);
  if (!aegis || !hasName(state.extraDeck, NAMES.fortress)) return null;
  const ready = (aegis.fieldAgeTurns || 0) >= 2;
  return makePackage(LUMINARCH_LINE_PACKAGES.ASCENSION, {
    priorityBoost: ready ? 3 : -3,
    status: ready
      ? LUMINARCH_PACKAGE_STATUS.PARTIAL
      : LUMINARCH_PACKAGE_STATUS.NEEDS_SIMULATION,
    ready,
    signals: [ready ? "aegis_mature" : "aegis_needs_time"],
    cards: [NAMES.aegisbearer, NAMES.fortress],
    conditions: { aegisOnField: true, ascensionReady: ready },
    diagnostics: { fieldAgeTurns: aegis.fieldAgeTurns || 0 },
  });
}

function evaluateGrindPackage(state) {
  const moonlitReady = hasName(state.hand, NAMES.moonlit) && state.gyLuminarchMonsters.length > 0;
  const fortressRevive =
    hasName(state.field, NAMES.fortress) &&
    state.gyLuminarchMonsters.some((card) => (card.def || 0) <= 2000);
  const sickleRecovery = hasSpellRecoveryTarget(state.graveyard);
  const waveRecovery =
    hasName(state.hand, NAMES.radiantWave) &&
    hasName(state.hand, NAMES.moonlit) &&
    (state.hasCitadelActive || state.gyLuminarchMonsters.length > 0);
  const convocationMoonlit =
    hasName(state.hand, NAMES.knightsConvocation) &&
    hasName(state.hand, NAMES.moonlit) &&
    state.hand.some((card) => isLuminarchMonster(card) && (card.level || 0) >= 5);
  if (!moonlitReady && !fortressRevive && !sickleRecovery && !waveRecovery && !convocationMoonlit) {
    return null;
  }

  return makePackage(LUMINARCH_LINE_PACKAGES.GRIND, {
    priorityBoost:
      (moonlitReady && state.hasCitadelActive ? 3 : 0) +
      (fortressRevive ? 2 : 0) +
      (sickleRecovery ? 1 : 0),
    signals: [
      ...(moonlitReady ? ["moonlit_recovery"] : []),
      ...(fortressRevive ? ["fortress_revive"] : []),
      ...(sickleRecovery ? ["sickle_spell_recovery"] : []),
      ...(waveRecovery ? ["radiant_wave_recovery"] : []),
      ...(convocationMoonlit ? ["convocation_moonlit"] : []),
    ],
    cards: [
      ...(moonlitReady ? [NAMES.moonlit] : []),
      ...(fortressRevive ? [NAMES.fortress] : []),
      ...(sickleRecovery ? [NAMES.magicSickle] : []),
      ...(waveRecovery ? [NAMES.radiantWave] : []),
      ...(convocationMoonlit ? [NAMES.knightsConvocation] : []),
    ],
    conditions: { moonlitReady, fortressRevive, sickleRecovery, waveRecovery, convocationMoonlit },
  });
}

function evaluateBattleConversionPackage(state) {
  const battleCards = [
    NAMES.spear,
    NAMES.magicSickle,
    NAMES.holyAscension,
    NAMES.moonblade,
    NAMES.radiantLancer,
    NAMES.aurora,
    NAMES.barbarias,
  ];
  const hasBattlePiece = hasAnyName([...state.hand, ...state.field], battleCards);
  if (!hasBattlePiece) return null;

  return makePackage(LUMINARCH_LINE_PACKAGES.BATTLE_CONVERSION, {
    priorityBoost: state.oppMonsters.length > 0 ? 2 : -2,
    status: LUMINARCH_PACKAGE_STATUS.NEEDS_MAIN_BATTLE_MAIN2,
    signals: [
      ...(hasName(state.hand, NAMES.spear) ? ["spear_break"] : []),
      ...(hasName(state.hand, NAMES.magicSickle) ? ["sickle_damage_step"] : []),
      ...(hasName(state.field, NAMES.moonblade) ? ["moonblade_second_attack"] : []),
      ...(hasName(state.field, NAMES.radiantLancer) ? ["lancer_growth"] : []),
      ...(hasName(state.field, NAMES.aurora) ? ["aurora_heal"] : []),
      ...(hasName(state.field, NAMES.barbarias) ? ["barbarias_position_push"] : []),
    ],
    cards: collectNames([...state.hand, ...state.field]).filter((name) =>
      battleCards.includes(name),
    ),
    conditions: {
      hasBattlePiece,
      opponentHasMonsters: state.oppMonsters.length > 0,
    },
  });
}

function evaluateLpPayoffPackage(state) {
  const hasLpPayoff =
    state.hasCitadelActive ||
    hasAnyName([...state.hand, ...state.field, ...state.spellTrap], [
      NAMES.holyShield,
      NAMES.holyAscension,
      NAMES.sunforgedBlade,
      NAMES.barbarias,
      NAMES.aurora,
      NAMES.pureKnight,
      NAMES.sacredJudgment,
    ]);
  if (!hasLpPayoff) return null;

  return makePackage(LUMINARCH_LINE_PACKAGES.LP_PAYOFF, {
    priorityBoost: state.hasCitadelActive ? 2 : 0,
    signals: [
      ...(state.hasCitadelActive ? ["citadel_lifegain"] : []),
      ...(hasName(state.hand, NAMES.sunforgedBlade) ? ["sunforged_scaling"] : []),
      ...(hasName(state.field, NAMES.barbarias) ? ["barbarias_double_lifegain"] : []),
      ...(hasName(state.field, NAMES.pureKnight) ? ["pure_knight_cost_discount"] : []),
      ...(hasName(state.field, NAMES.aurora) ? ["aurora_lifegain"] : []),
    ],
    cards: collectNames([...state.hand, ...state.field, ...state.spellTrap]).filter(
      (name) =>
        [
          NAMES.citadel,
          NAMES.holyShield,
          NAMES.holyAscension,
          NAMES.sunforgedBlade,
          NAMES.barbarias,
          NAMES.aurora,
          NAMES.pureKnight,
          NAMES.sacredJudgment,
        ].includes(name),
    ),
    conditions: { hasLpPayoff, hasCitadelActive: state.hasCitadelActive },
  });
}

function evaluateComebackPackage(state) {
  const sacredJudgmentLive =
    hasName(state.hand, NAMES.sacredJudgment) &&
    state.fieldMonsters.length === 0 &&
    state.oppMonsters.length >= 2 &&
    state.gyLuminarchMonsters.length > 0 &&
    state.lp >= 2500;
  const moonlitCitadelLive =
    hasName(state.hand, NAMES.moonlit) &&
    state.hasCitadelActive &&
    state.gyLuminarchMonsters.length > 0;
  const wallUnderPressure =
    state.oppThreat >= state.lp &&
    (hasName(state.hand, NAMES.holyShield) ||
      hasName(state.hand, NAMES.marshal) ||
      hasName(state.hand, NAMES.aegisbearer));
  if (!sacredJudgmentLive && !moonlitCitadelLive && !wallUnderPressure) return null;

  return makePackage(LUMINARCH_LINE_PACKAGES.COMEBACK, {
    priorityBoost:
      (sacredJudgmentLive ? 4 : 0) +
      (wallUnderPressure ? 3 : 0) +
      (state.oppMonsters.length >= 3 ? 2 : 0),
    signals: [
      ...(sacredJudgmentLive ? ["sacred_judgment_live"] : []),
      ...(moonlitCitadelLive ? ["moonlit_citadel_rebuild"] : []),
      ...(wallUnderPressure ? ["wall_under_pressure"] : []),
    ],
    cards: [
      ...(sacredJudgmentLive ? [NAMES.sacredJudgment] : []),
      ...(moonlitCitadelLive ? [NAMES.moonlit] : []),
      ...(wallUnderPressure ? [NAMES.holyShield, NAMES.marshal, NAMES.aegisbearer] : []),
    ],
    conditions: { sacredJudgmentLive, moonlitCitadelLive, wallUnderPressure },
    diagnostics: { oppThreat: state.oppThreat, lp: state.lp },
  });
}

const PACKAGE_EVALUATORS = [
  evaluateStarterPackage,
  evaluateCitadelPackage,
  evaluateWallPackage,
  evaluateFusionPackage,
  evaluateAscensionPackage,
  evaluateGrindPackage,
  evaluateBattleConversionPackage,
  evaluateLpPayoffPackage,
  evaluateComebackPackage,
];

export function detectAvailableLinePackages(analysis = {}) {
  if (!analysis) return [];
  const state = buildPackageState(analysis);
  return PACKAGE_EVALUATORS.map((evaluate) => evaluate(state))
    .filter(Boolean)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

export function detectAvailableCombos(analysis = {}) {
  return detectAvailableLinePackages(analysis);
}

export function getLinePackageById(packageId) {
  return packageData(packageId);
}

export function getLinePackageCoverage(packageId) {
  return packageData(packageId)?.coveredCombos || [];
}

export function getLinePackageMilestones(packageId) {
  if (packageId) return [packageData(packageId)?.milestone].filter(Boolean);
  return COMBO_DATABASE.map((entry) => entry.milestone).filter(Boolean);
}

export function getAllCoveredComboNames() {
  return COMBO_DATABASE.flatMap((entry) => entry.coveredCombos || []);
}

export function shouldExecuteCombo(combo) {
  if (!combo) return false;
  if (combo.ready === false) return false;
  if (!combo.conditions) return true;
  return Object.values(combo.conditions).every(Boolean);
}

export function shouldPrioritizeDefense(analysis = {}) {
  const state = buildPackageState(analysis);
  if (state.lp <= 2500) return true;
  if (state.oppThreat >= state.lp) return true;
  if (state.lp <= 4000 && state.oppThreat >= 5000) return true;
  if (state.fieldMonsters.length === 0 && state.oppMonsters.length >= 2) {
    return true;
  }
  const myAttack = state.faceupLuminarch.reduce(
    (sum, monster) => sum + (monster.atk || 0) + (monster.tempAtkBoost || 0),
    0,
  );
  return myAttack > 0 && state.oppThreat >= myAttack * 2;
}

export function shouldTurtleStrategy(analysis = {}) {
  const state = buildPackageState(analysis);
  const hasAegis = hasName(state.field, NAMES.aegisbearer);
  const hasHolyShield = hasName(state.hand, NAMES.holyShield);

  if (state.lp <= 3000 && state.hasCitadelActive && hasAegis) {
    return {
      shouldTurtle: true,
      reason: "low_lp_with_citadel_aegis",
    };
  }

  if (state.oppThreat >= 7000 && state.hasCitadelActive) {
    return {
      shouldTurtle: true,
      reason: "opponent_threat_requires_stall",
    };
  }

  if (state.hasCitadelActive && hasAegis && hasHolyShield) {
    return {
      shouldTurtle: true,
      reason: "full_defensive_package",
    };
  }

  return {
    shouldTurtle: false,
    reason: "no_turtle_package",
  };
}

export function canAttemptLethal(analysis = {}) {
  const state = buildPackageState(analysis);
  const attackers = state.faceupLuminarch.filter(
    (monster) => monster.position === "attack" && !monster.hasAttacked,
  );
  const totalAtk = attackers.reduce(
    (sum, monster) => sum + (monster.atk || 0) + (monster.tempAtkBoost || 0),
    0,
  );
  if (state.oppMonsters.length === 0 && totalAtk >= state.oppLp) return true;

  const canPayForBuff = state.lp >= 1000;
  const hasBuff =
    hasName(state.hand, NAMES.holyAscension) ||
    state.hasCitadelActive ||
    hasName(state.hand, NAMES.magicSickle);
  const bestBuff = hasName(state.hand, NAMES.magicSickle) ? 1200 : 800;
  if (canPayForBuff && hasBuff && totalAtk + attackers.length * bestBuff >= state.oppLp) {
    return true;
  }

  return state.oppLp <= 2000 && attackers.length >= 2;
}
