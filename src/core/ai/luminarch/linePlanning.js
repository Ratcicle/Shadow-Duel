import {
  getStrongestAttackThreat,
  getStrongestBattleThreat,
} from "../common/cardStats.js";
import { detectAvailableCombos } from "./combos.js";
import { LUMINARCH_LINE_PACKAGES } from "./knowledge.js";

const DEFAULT_PROFILE = {
  enabled: false,
  mode: "off",
  turnMode: "mainOnly",
  beamWidth: 3,
  maxDepth: 4,
  nodeBudget: 220,
  candidateLimit: 8,
  reasons: [],
  critical: false,
};

const NAMES = Object.freeze({
  aegisbearer: "Luminarch Aegisbearer",
  arbiter: "Luminarch Sanctified Arbiter",
  barbarias: "Luminarch Megashield Barbarias",
  citadel: "Sanctum of the Luminarch Citadel",
  fortress: "Luminarch Fortress Aegis",
  knightsConvocation: "Luminarch Knights Convocation",
  magicSickle: "Luminarch Magic Sickle",
  marshal: "Luminarch Celestial Marshal",
  moonblade: "Luminarch Moonblade Captain",
  moonlit: "Luminarch Moonlit Blessing",
  polymerization: "Polymerization",
  protector: "Luminarch Sanctum Protector",
  pureKnight: "Luminarch Pure Knight",
  radiantWave: "Luminarch Radiant Wave",
  sacredJudgment: "Luminarch Sacred Judgment",
  valiant: "Luminarch Valiant - Knight of the Dawn",
});

const USEFUL_SICKLE_SPELL_TARGETS = new Set([
  NAMES.citadel,
  "Luminarch Holy Ascension",
  "Luminarch Holy Shield",
  NAMES.moonlit,
  NAMES.radiantWave,
  NAMES.sacredJudgment,
  "Luminarch Spear of Dawnfall",
  "Luminarch Sunforged Blade",
]);

const WALL_NAMES = new Set([
  NAMES.aegisbearer,
  NAMES.barbarias,
  NAMES.fortress,
  NAMES.marshal,
  NAMES.protector,
  "Luminarch Aurora Seraph",
]);

const SIM_MILESTONE_SCORES = Object.freeze({
  barbarias_fusion_wall: { score: 5, label: "Fusion: Barbarias wall online" },
  citadel_access: { score: 3.5, label: "Engine: Citadel access" },
  fortress_revive: { score: 3.5, label: "Grind: Fortress revived body" },
  halberd_followup: { score: 2, label: "Extender: Halberd follow-up" },
  lp_payment_created_payoff: { score: 2, label: "LP: payment created payoff" },
  lp_payment_created_wall: { score: 2.5, label: "LP: payment created wall" },
  marshal_self_summon: { score: 2, label: "Wall: Marshal self-summoned" },
  pure_knight_fusion: { score: 4, label: "Fusion: Pure Knight access" },
  risky_lp_payment: { score: -6, label: "Risk: LP payment left lethal exposure" },
  sickle_spell_recovery: { score: 2, label: "Grind: Sickle recovered useful Spell" },
});

const MAIN_ONLY_PACKAGES = new Set([
  LUMINARCH_LINE_PACKAGES.STARTER,
  LUMINARCH_LINE_PACKAGES.CITADEL,
  LUMINARCH_LINE_PACKAGES.WALL,
  LUMINARCH_LINE_PACKAGES.FUSION,
  LUMINARCH_LINE_PACKAGES.ASCENSION,
  LUMINARCH_LINE_PACKAGES.GRIND,
  LUMINARCH_LINE_PACKAGES.COMEBACK,
]);

function cards(analysis = {}, zone) {
  const value = analysis?.[zone];
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function hasName(list = [], name) {
  return list.some((card) => card?.name === name);
}

function isLuminarch(card) {
  if (!card) return false;
  if (card.archetype === "Luminarch") return true;
  return Array.isArray(card.archetypes) && card.archetypes.includes("Luminarch");
}

function isLuminarchMonster(card) {
  return card?.cardKind === "monster" && isLuminarch(card);
}

function isFaceupLuminarchMonster(card) {
  return isLuminarchMonster(card) && !card.isFacedown;
}

function getOpponentTotalAttack(analysis = {}) {
  return cards(analysis, "oppField").reduce((sum, card) => {
    if (!card || card.cardKind !== "monster" || card.isFacedown) return sum;
    if (card.position === "defense") return sum;
    return sum + Math.max(0, card.atk || 0);
  }, 0);
}

function scoreMagicSickleSpellTarget(card, analysis = {}) {
  if (!card) return 0;
  const hasCitadel = analysis.fieldSpell?.name === NAMES.citadel;
  const underPressure =
    getOpponentTotalAttack(analysis) >= (analysis.lp || 8000) ||
    (analysis.lp || 8000) <= 3500;
  const hasGyLuminarch = cards(analysis, "graveyard").some(
    (entry) => isLuminarchMonster(entry) && entry.name !== NAMES.magicSickle,
  );

  switch (card.name) {
    case NAMES.citadel:
      return hasCitadel ? 1 : 12;
    case NAMES.moonlit:
      return hasGyLuminarch ? (hasCitadel ? 13 : 9) : 3;
    case "Luminarch Holy Shield":
      return underPressure ? 12 : 7;
    case NAMES.radiantWave:
      return cards(analysis, "field").some(
        (entry) => isLuminarchMonster(entry) && (entry.atk || 0) >= 2000,
      )
        ? 10
        : 4;
    case NAMES.sacredJudgment:
      return underPressure && cards(analysis, "field").length === 0 ? 11 : 5;
    case "Luminarch Spear of Dawnfall":
      return cards(analysis, "oppField").length > 0 ? 9 : 4;
    case "Luminarch Sunforged Blade":
      return hasCitadel ? 8 : 4;
    case "Luminarch Holy Ascension":
      return cards(analysis, "oppField").length > 0 ? 7 : 3;
    default:
      return 2;
  }
}

function countLuminarchMaterials(analysis = {}) {
  return [...cards(analysis, "hand"), ...cards(analysis, "field")].filter(
    isLuminarchMonster,
  ).length;
}

function hasPureKnightFusionAccess(analysis = {}) {
  return (
    hasName(cards(analysis, "hand"), NAMES.polymerization) &&
    hasName(cards(analysis, "extraDeck"), NAMES.pureKnight) &&
    countLuminarchMaterials(analysis) >= 2
  );
}

function hasBarbariasFusionAccess(analysis = {}) {
  const materials = [...cards(analysis, "hand"), ...cards(analysis, "field")].filter(
    isLuminarchMonster,
  );
  const protector = materials.find((card) => card.name === NAMES.protector);
  return (
    hasName(cards(analysis, "hand"), NAMES.polymerization) &&
    hasName(cards(analysis, "extraDeck"), NAMES.barbarias) &&
    !!protector &&
    materials.some((card) => card !== protector && (card.level || 0) >= 5)
  );
}

function opponentThreatensLethal(analysis = {}) {
  const lp = analysis.lp || 0;
  if (lp <= 0) return true;
  const attackTotal = cards(analysis, "oppField").reduce((sum, card) => {
    if (!card || card.cardKind !== "monster" || card.isFacedown) return sum;
    if (card.position === "defense") return sum;
    return sum + Math.max(0, card.atk || 0);
  }, 0);
  return attackTotal >= lp;
}

function hasStarterAccess(analysis = {}) {
  const hand = cards(analysis, "hand");
  const gy = cards(analysis, "graveyard");
  const normalAvailable = analysis.summonAvailable !== false;
  const hasMoonbladeRevive =
    normalAvailable &&
    hasName(hand, NAMES.moonblade) &&
    gy.some((card) => isLuminarchMonster(card) && (card.level || 0) <= 4);
  const hasConvocationSetup =
    hasName(hand, NAMES.knightsConvocation) &&
    hand.some((card) => isLuminarchMonster(card) && (card.level || 0) >= 7);
  return (
    normalAvailable &&
    (hasName(hand, NAMES.valiant) ||
      hasName(hand, NAMES.arbiter) ||
      hasMoonbladeRevive ||
      hasConvocationSetup)
  );
}

function hasCitadelAccess(analysis = {}) {
  const hand = cards(analysis, "hand");
  if (analysis.fieldSpell?.name === NAMES.citadel) return false;
  return (
    hasName(hand, NAMES.citadel) ||
    (analysis.summonAvailable !== false && hasName(hand, NAMES.arbiter)) ||
    hasPureKnightFusionAccess(analysis)
  );
}

function hasFortressRevive(analysis = {}) {
  if ((analysis.field || []).length >= 5) return false;
  if ((analysis.lp || 0) <= 1000) return false;
  return (
    cards(analysis, "field").some(
      (card) => card?.name === NAMES.fortress && !card.isFacedown,
    ) &&
    cards(analysis, "graveyard").some(
      (card) => isLuminarchMonster(card) && (card.def || 0) <= 2000,
    )
  );
}

function hasMagicSickleRecovery(analysis = {}) {
  const gy = cards(analysis, "graveyard");
  return (
    hasName(gy, NAMES.magicSickle) &&
    gy.some(
      (card) =>
        card?.cardKind === "spell" &&
        isLuminarch(card) &&
        USEFUL_SICKLE_SPELL_TARGETS.has(card.name) &&
        scoreMagicSickleSpellTarget(card, analysis) >= 7,
    )
  );
}

function hasAegisbearerFortressSetup(analysis = {}) {
  if (!hasName(cards(analysis, "extraDeck"), NAMES.fortress)) return false;
  const aegis = cards(analysis, "field").find(
    (card) => card?.name === NAMES.aegisbearer && !card.isFacedown,
  );
  return !!aegis && (aegis.fieldAgeTurns || 0) >= 1;
}

function hasComebackOrPressure(analysis = {}) {
  const hand = cards(analysis, "hand");
  const field = cards(analysis, "field");
  const gy = cards(analysis, "graveyard");
  const oppField = cards(analysis, "oppField");
  const ownStrongest = getStrongestBattleThreat(field, { facedownValue: 1500 });
  const oppStrongest = getStrongestBattleThreat(oppField, { facedownValue: 1500 });
  const weakField =
    field.filter((card) => card?.cardKind === "monster").length === 0 ||
    ownStrongest + 500 < oppStrongest;
  const sacredJudgmentLive =
    hasName(hand, NAMES.sacredJudgment) &&
    field.filter((card) => card?.cardKind === "monster").length === 0 &&
    oppField.filter((card) => card?.cardKind === "monster").length >= 2 &&
    gy.some(isLuminarchMonster) &&
    (analysis.lp || 0) > 2000;
  const moonlitLive =
    hasName(hand, NAMES.moonlit) &&
    analysis.fieldSpell?.name === NAMES.citadel &&
    gy.some(isLuminarchMonster);
  const radiantWaveLive =
    hasName(hand, NAMES.radiantWave) &&
    field.some((card) => isLuminarchMonster(card) && (card.atk || 0) >= 2000) &&
    (oppField.length > 0 || cards(analysis, "oppSpellTrap").length > 0);
  return (
    opponentThreatensLethal(analysis) ||
    (weakField && hasStarterAccess(analysis)) ||
    sacredJudgmentLive ||
    moonlitLive ||
    radiantWaveLive
  );
}

function collectPlanningReasons(analysis = {}) {
  const reasons = [];
  const hand = cards(analysis, "hand");
  const packages = analysis.availableCombos || detectAvailableCombos(analysis);
  const mainOnlyPackages = (packages || []).filter((entry) =>
    MAIN_ONLY_PACKAGES.has(entry?.package),
  );

  if (hasStarterAccess(analysis)) reasons.push("starter access");
  if (hasCitadelAccess(analysis)) reasons.push("Citadel access");
  if (hasPureKnightFusionAccess(analysis)) reasons.push("Pure Knight fusion");
  if (hasBarbariasFusionAccess(analysis)) reasons.push("Barbarias fusion");
  if (hasName(hand, NAMES.marshal) && (analysis.lp || 0) > 2500) {
    reasons.push("Marshal hand ignition");
  }
  if (hasFortressRevive(analysis)) reasons.push("Fortress revive");
  if (hasMagicSickleRecovery(analysis)) reasons.push("Magic Sickle recovery");
  if (hasAegisbearerFortressSetup(analysis)) reasons.push("Aegisbearer near Fortress");
  if (hasComebackOrPressure(analysis)) reasons.push("comeback or pressure");

  mainOnlyPackages
    .filter((entry) => (entry?.priority || 0) >= 12)
    .slice(0, 3)
    .forEach((entry) => {
      if (entry?.name && !reasons.includes(entry.name)) reasons.push(entry.name);
    });

  return [...new Set(reasons)];
}

function isMain2(phase) {
  return String(phase || "").toLowerCase() === "main2";
}

function clampScore(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getPlanningBot(state = {}) {
  return state?.bot || state?.player || {};
}

function getPlanningOpponent(state = {}) {
  if (state?.bot) return state.player || state.opponent || {};
  return state?.opponent || {};
}

function stateCards(player = {}, zone) {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  const value = player[zone];
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function hasStateName(player = {}, zone, name) {
  return stateCards(player, zone).some((card) => card?.name === name);
}

function countBoardCards(player = {}) {
  return (
    stateCards(player, "field").length +
    stateCards(player, "spellTrap").length +
    stateCards(player, "fieldSpell").length
  );
}

function getAttackDamage(player = {}) {
  return stateCards(player, "field").reduce((sum, card) => {
    if (!card || card.cardKind !== "monster" || card.isFacedown) return sum;
    if (card.position === "defense" || card.cannotAttackThisTurn) return sum;
    return sum + Math.max(0, Number(card.atk || 0) + Number(card.tempAtkBoost || 0));
  }, 0);
}

function stateThreatensLethal(defender = {}, attacker = {}) {
  const lp = Number(defender?.lp || 0);
  if (lp <= 0) return true;
  return getAttackDamage(attacker) >= lp;
}

function hasCitadelOnline(player = {}) {
  return (
    player.fieldSpell?.name === NAMES.citadel ||
    stateCards(player, "spellTrap").some(
      (card) => card?.name === NAMES.citadel && !card.isFacedown,
    )
  );
}

function countFaceupLuminarchs(player = {}) {
  return stateCards(player, "field").filter(isFaceupLuminarchMonster).length;
}

function isLuminarchWall(card) {
  if (!isFaceupLuminarchMonster(card)) return false;
  if (WALL_NAMES.has(card.name)) return true;
  if (card.mustBeAttacked || card.battleIndestructibleOncePerTurn) return true;
  if (card._simulatedRole === "defensive_wall") return true;
  const defense =
    Number(card.def || 0) +
    Number(card.tempDefBoost || 0) +
    Number(card.permanentDefBoost || 0);
  return card.position === "defense" && defense >= 2400;
}

function countWalls(player = {}) {
  return stateCards(player, "field").filter(isLuminarchWall).length;
}

function countFusionPayoffs(player = {}) {
  return stateCards(player, "field").filter(
    (card) =>
      card?.name === NAMES.pureKnight ||
      card?.name === NAMES.barbarias ||
      card?.name === NAMES.fortress,
  ).length;
}

function countUsefulGyLuminarchs(player = {}) {
  return stateCards(player, "graveyard").filter(
    (card) =>
      isLuminarchMonster(card) &&
      ![NAMES.pureKnight, NAMES.barbarias, NAMES.fortress].includes(card.name),
  ).length;
}

function getActionNames(sequence = []) {
  return (sequence || [])
    .map((action) => action?.cardName || action?.card?.name || action?.name)
    .filter(Boolean);
}

function sequenceUses(sequence = [], name, type = null) {
  return (sequence || []).some(
    (action) =>
      (!type || action?.type === type) &&
      (action?.cardName === name || action?.card?.name === name || action?.name === name),
  );
}

function getLineImpact(context = {}) {
  const initialBot = getPlanningBot(context.initialState || {});
  const finalBot = getPlanningBot(context.finalState || {});
  const initialOpponent = getPlanningOpponent(context.initialState || {});
  const finalOpponent = getPlanningOpponent(context.finalState || {});
  const sequence = Array.isArray(context.sequence) ? context.sequence : [];
  const initialOpponentThreat = getStrongestBattleThreat(
    stateCards(initialOpponent, "field"),
    { facedownValue: 1500 },
  );
  const finalOpponentThreat = getStrongestBattleThreat(
    stateCards(finalOpponent, "field"),
    { facedownValue: 1500 },
  );

  return {
    initialBot,
    finalBot,
    initialOpponent,
    finalOpponent,
    sequence,
    actionNames: getActionNames(sequence),
    initialLethal: stateThreatensLethal(initialBot, initialOpponent),
    finalLethal: stateThreatensLethal(finalBot, finalOpponent),
    removedOpponentCards: Math.max(
      0,
      countBoardCards(initialOpponent) - countBoardCards(finalOpponent),
    ),
    threatReduction: Math.max(0, initialOpponentThreat - finalOpponentThreat),
    initialCitadel: hasCitadelOnline(initialBot),
    finalCitadel: hasCitadelOnline(finalBot),
    initialWalls: countWalls(initialBot),
    finalWalls: countWalls(finalBot),
    initialFaceupLuminarchs: countFaceupLuminarchs(initialBot),
    finalFaceupLuminarchs: countFaceupLuminarchs(finalBot),
    initialFusionPayoffs: countFusionPayoffs(initialBot),
    finalFusionPayoffs: countFusionPayoffs(finalBot),
    initialHandCount: stateCards(initialBot, "hand").length,
    finalHandCount: stateCards(finalBot, "hand").length,
    initialGyResources: countUsefulGyLuminarchs(initialBot),
    finalGyResources: countUsefulGyLuminarchs(finalBot),
    lpDelta: Number(finalBot.lp || 0) - Number(initialBot.lp || 0),
    simMeta: context.finalState?._simLuminarch || {},
  };
}

function addMilestone(entries, score, label) {
  if (!Number.isFinite(score) || score === 0 || !label) return;
  entries.push({ score, label, weight: Math.abs(score) });
}

function addSimMetaMilestones(entries, impact) {
  const raw = Array.isArray(impact.simMeta?.milestones)
    ? impact.simMeta.milestones
    : [];
  raw.forEach((entry) => {
    const key = typeof entry === "string" ? entry : entry?.label || entry?.name;
    const mapped = SIM_MILESTONE_SCORES[key];
    if (mapped) {
      addMilestone(entries, mapped.score, mapped.label);
    }
  });

  const payments = Array.isArray(impact.simMeta?.lpPayments)
    ? impact.simMeta.lpPayments
    : [];
  const totalCost = payments.reduce(
    (sum, payment) => sum + Math.max(0, Number(payment?.cost || 0)),
    0,
  );
  if (totalCost >= 2000 && impact.finalLethal) {
    addMilestone(entries, -4, "Risk: paid heavy LP while still exposed");
  }
}

function scoreEngineMilestones(entries, impact) {
  if (!impact.initialCitadel && impact.finalCitadel) {
    addMilestone(entries, 4, "Engine: Citadel online");
  } else if (impact.finalCitadel && impact.finalWalls > 0) {
    addMilestone(entries, 1.5, "Engine: Citadel supports wall");
  }

  const starterUsed =
    sequenceUses(impact.sequence, NAMES.valiant) ||
    sequenceUses(impact.sequence, NAMES.arbiter) ||
    sequenceUses(impact.sequence, NAMES.moonblade) ||
    sequenceUses(impact.sequence, NAMES.knightsConvocation);
  if (
    starterUsed &&
    (impact.finalFaceupLuminarchs > impact.initialFaceupLuminarchs ||
      impact.finalHandCount >= impact.initialHandCount ||
      (!impact.initialCitadel && impact.finalCitadel))
  ) {
    addMilestone(entries, 2.5, "Starter: converted into resource");
  }
}

function scoreWallMilestones(entries, impact) {
  const wallDelta = impact.finalWalls - impact.initialWalls;
  if (wallDelta > 0) {
    addMilestone(entries, Math.min(4, wallDelta * 2.5), "Wall: established defense");
  }
  if (impact.initialLethal && !impact.finalLethal) {
    addMilestone(entries, 6, "Defense: removed lethal pressure");
  }
  if (impact.finalWalls > 0 && impact.finalCitadel) {
    addMilestone(entries, 2, "Wall: protected by Citadel");
  }
}

function scoreFusionMilestones(entries, impact) {
  const payoffDelta = impact.finalFusionPayoffs - impact.initialFusionPayoffs;
  if (payoffDelta > 0) {
    addMilestone(entries, Math.min(5, payoffDelta * 3), "Fusion/Ascension: payoff on field");
  }
  if (hasStateName(impact.finalBot, "field", NAMES.pureKnight) && impact.finalCitadel) {
    addMilestone(entries, 2, "Pure Knight: enabled Citadel plan");
  }
  if (hasStateName(impact.finalBot, "field", NAMES.barbarias) && impact.finalWalls > 0) {
    addMilestone(entries, 2.5, "Barbarias: defensive payoff online");
  }
}

function scoreGrindMilestones(entries, impact) {
  if (impact.finalGyResources > impact.initialGyResources) {
    addMilestone(entries, 1.2, "Grind: stocked Luminarch GY");
  }
  if (
    sequenceUses(impact.sequence, NAMES.moonlit) &&
    impact.finalFaceupLuminarchs > impact.initialFaceupLuminarchs
  ) {
    addMilestone(entries, 2.5, "Grind: Moonlit converted GY to field");
  }
}

function scoreBoardImpactMilestones(entries, impact) {
  if (impact.removedOpponentCards > 0) {
    addMilestone(
      entries,
      Math.min(5, impact.removedOpponentCards * 2),
      "Control: reduced opponent board",
    );
  }
  if (impact.threatReduction >= 500) {
    addMilestone(
      entries,
      Math.min(4, impact.threatReduction / 700),
      "Control: reduced top threat",
    );
  }
}

function scoreRiskMilestones(entries, impact) {
  if (
    impact.finalFaceupLuminarchs === 0 &&
    countBoardCards(impact.finalOpponent) > 0
  ) {
    addMilestone(entries, -6, "Risk: ended with no face-up Luminarch");
  }
  if (impact.finalLethal && Number(impact.finalBot.lp || 0) <= 3000) {
    addMilestone(entries, -5, "Risk: low LP still under lethal");
  }
  if (
    sequenceUses(impact.sequence, NAMES.polymerization, "spell") &&
    impact.finalFusionPayoffs <= impact.initialFusionPayoffs
  ) {
    addMilestone(entries, -5, "Risk: Polymerization spent without payoff");
  }
  const lineLength = impact.sequence.filter(
    (action) => action?.type !== "simulatedBattle",
  ).length;
  const hasPayoff =
    impact.finalCitadel ||
    impact.finalWalls > impact.initialWalls ||
    impact.finalFusionPayoffs > impact.initialFusionPayoffs ||
    impact.removedOpponentCards > 0 ||
    (impact.initialLethal && !impact.finalLethal);
  if (lineLength >= 4 && !hasPayoff) {
    addMilestone(entries, -4, "Risk: long line without compact payoff");
  }
}

function formatMilestone(entry) {
  const sign = entry.score > 0 ? "+" : "";
  const rounded = Number(entry.score.toFixed(1));
  return `${sign}${rounded} ${entry.label}`;
}

export function buildLuminarchPlanningProfile(analysis = {}, context = {}) {
  const game = context.game || analysis.game || {};
  const manual = game?.turnLineSearchEnabled === true;
  const reasons = collectPlanningReasons(analysis);
  const enabled = manual || reasons.length > 0;
  const phase = analysis.phase || game?.phase || "main1";

  return {
    ...DEFAULT_PROFILE,
    enabled,
    mode: manual && reasons.length === 0 ? "manual" : enabled ? "critical" : "off",
    turnMode: "mainOnly",
    beamWidth: Number.isFinite(game?.turnLineSearchBeamWidth)
      ? game.turnLineSearchBeamWidth
      : DEFAULT_PROFILE.beamWidth,
    maxDepth: Number.isFinite(game?.turnLineSearchMaxDepth)
      ? game.turnLineSearchMaxDepth
      : isMain2(phase)
        ? 3
        : DEFAULT_PROFILE.maxDepth,
    nodeBudget: Number.isFinite(game?.turnLineSearchNodeBudget)
      ? game.turnLineSearchNodeBudget
      : DEFAULT_PROFILE.nodeBudget,
    candidateLimit: Number.isFinite(game?.turnLineSearchCandidateLimit)
      ? game.turnLineSearchCandidateLimit
      : DEFAULT_PROFILE.candidateLimit,
    reasons,
    critical: reasons.length > 0,
    availablePackages: (analysis.availableCombos || detectAvailableCombos(analysis))
      .filter((entry) => MAIN_ONLY_PACKAGES.has(entry?.package))
      .slice(0, 5)
      .map((entry) => ({
        name: entry.name,
        package: entry.package,
        priority: entry.priority,
        signals: entry.signals || [],
      })),
    opponentThreat: getStrongestAttackThreat(analysis.oppField || [], {
      facedownValue: 1500,
      includeBoosts: false,
    }),
  };
}

function collectSimMilestones(state = {}) {
  const raw = state?._simLuminarch?.milestones;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(Boolean)
    .map((entry) =>
      typeof entry === "string"
        ? { label: entry, score: 0 }
        : { label: entry.label || String(entry), score: Number(entry.score || 0) },
    );
}

export function scoreLuminarchLineMilestones(context = {}) {
  const impact = getLineImpact(context);
  const entries = [];

  scoreEngineMilestones(entries, impact);
  scoreWallMilestones(entries, impact);
  scoreFusionMilestones(entries, impact);
  scoreGrindMilestones(entries, impact);
  scoreBoardImpactMilestones(entries, impact);
  addSimMetaMilestones(entries, impact);
  scoreRiskMilestones(entries, impact);

  entries.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return b.score - a.score;
  });

  const rawScore = entries.reduce((sum, entry) => sum + entry.score, 0);
  return {
    scoreDelta: clampScore(rawScore, -12, 12),
    milestones: entries.slice(0, 8).map(formatMilestone),
    details: {
      lineImpact: {
        removedOpponentCards: impact.removedOpponentCards,
        threatReduction: impact.threatReduction,
        initialLethal: impact.initialLethal,
        finalLethal: impact.finalLethal,
        finalCitadel: impact.finalCitadel,
        wallDelta: impact.finalWalls - impact.initialWalls,
        fusionPayoffDelta:
          impact.finalFusionPayoffs - impact.initialFusionPayoffs,
        lpDelta: impact.lpDelta,
      },
      entries,
    },
  };
}

export function scoreLuminarchLineTerminal(context = {}) {
  const finalBot = getPlanningBot(context.finalState || {});
  const finalOpponent = getPlanningOpponent(context.finalState || {});
  if ((finalBot.lp || 0) <= 0) return -10000;
  if ((finalOpponent.lp || 0) <= 0) return 10000;

  const baseScore = Number(context.baseScore ?? context.finalScore ?? 0);
  const rawMilestoneScore = Number(context.milestoneScore ?? 0);
  const profile = context.profile || context.planningContext?.profile || {};
  const cap = profile.critical || profile.mode === "critical" ? 12 : 8;
  const milestoneScore = clampScore(rawMilestoneScore, -cap, cap);
  return baseScore + milestoneScore;
}

function describeAction(action = {}) {
  if (action.type === "simulatedBattle") {
    const target = action.direct ? "direct" : action.targetName || "target";
    return `battle ${action.attackerName || "attacker"} -> ${target}`;
  }
  const card = action.cardName || action.card?.name || action.name || action.index;
  const fusion = action.fusionTarget ? ` -> ${action.fusionTarget}` : "";
  const reason = action.reason ? ` (${action.reason})` : "";
  return `${action.type || "action"} ${card ?? ""}${fusion}${reason}`.trim();
}

function describeMilestone(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  const label = entry.label || entry.name || entry.milestone;
  if (!label) return null;
  return Number.isFinite(entry.score) && entry.score !== 0
    ? `${entry.score > 0 ? "+" : ""}${entry.score} ${label}`
    : label;
}

export function describeLuminarchPlannedLine(context = {}) {
  const sequence = Array.isArray(context.sequence) ? context.sequence : [];
  const steps = sequence.map(describeAction).filter(Boolean);
  const milestones = [
    ...(Array.isArray(context.milestones) ? context.milestones : []),
    ...collectSimMilestones(context.finalState),
  ]
    .map(describeMilestone)
    .filter(Boolean);
  const uniqueMilestones = [...new Set(milestones)].slice(0, 6);

  if (!steps.length) return "Luminarch planner found no actionable line";
  return `Luminarch planned line: ${steps.join(" -> ")}${
    uniqueMilestones.length ? ` | Milestones: ${uniqueMilestones.join(", ")}` : ""
  }`;
}
