import {
  getBattleStatForAttackTarget,
  getEffectiveAtk,
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
  aurora: "Luminarch Aurora Seraph",
  radiantLancer: "Luminarch Radiant Lancer",
  holyAscension: "Luminarch Holy Ascension",
  holyShield: "Luminarch Holy Shield",
  crescentShield: "Luminarch Crescent Shield",
  radiantWave: "Luminarch Radiant Wave",
  sacredJudgment: "Luminarch Sacred Judgment",
  spear: "Luminarch Spear of Dawnfall",
  sunforgedBlade: "Luminarch Sunforged Blade",
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
  NAMES.aurora,
  NAMES.barbarias,
  NAMES.fortress,
  NAMES.marshal,
  NAMES.protector,
]);

const LP_COST_FOLLOW_UP_NAMES = new Set([
  NAMES.citadel,
  NAMES.holyAscension,
  NAMES.sacredJudgment,
]);

const LP_PAYOFF_NAMES = new Set([
  NAMES.aurora,
  NAMES.barbarias,
  NAMES.citadel,
  NAMES.holyShield,
  NAMES.sacredJudgment,
  NAMES.sunforgedBlade,
]);

const MAIN2_BATTLE_PAYOFF_NAMES = new Set([
  NAMES.barbarias,
  NAMES.fortress,
  NAMES.moonlit,
  NAMES.pureKnight,
  NAMES.radiantWave,
  NAMES.sacredJudgment,
]);

const BATTLE_SIM_MILESTONE_KEYS = new Set([
  "citadel_battle_protection",
  "luminarch_battle_lp_gain",
  "magic_sickle_battle_boost",
  "moonblade_second_attack",
  "radiant_lancer_growth",
]);

const SIM_MILESTONE_SCORES = Object.freeze({
  barbarias_fusion_wall: { score: 5, label: "Fusion: Barbarias wall online" },
  citadel_access: { score: 3.5, label: "Engine: Citadel access" },
  fortress_revive: { score: 3.5, label: "Grind: Fortress revived body" },
  halberd_followup: { score: 2, label: "Extender: Halberd follow-up" },
  citadel_battle_protection: { score: 1.5, label: "Battle: Citadel protected attacker" },
  luminarch_battle_lp_gain: { score: 1.2, label: "Battle: LP payoff triggered" },
  lp_payment_created_payoff: { score: 2, label: "LP: payment created payoff" },
  lp_payment_created_wall: { score: 2.5, label: "LP: payment created wall" },
  magic_sickle_battle_boost: { score: 1.5, label: "Battle: Magic Sickle changed combat" },
  marshal_self_summon: { score: 2, label: "Wall: Marshal self-summoned" },
  moonblade_second_attack: { score: 1.5, label: "Battle: Moonblade earned second attack" },
  pure_knight_fusion: { score: 4, label: "Fusion: Pure Knight access" },
  radiant_lancer_growth: { score: 1.2, label: "Battle: Radiant Lancer grew" },
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

const MAIN_BATTLE_PACKAGES = new Set([
  ...MAIN_ONLY_PACKAGES,
  LUMINARCH_LINE_PACKAGES.BATTLE_CONVERSION,
  LUMINARCH_LINE_PACKAGES.LP_PAYOFF,
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

function isMain1Phase(phase) {
  const normalized = String(phase || "main1").toLowerCase();
  return normalized === "main1" || normalized === "main";
}

function isBattleReadyAttacker(card) {
  return (
    isFaceupLuminarchMonster(card) &&
    card.position !== "defense" &&
    card.cannotAttackThisTurn !== true &&
    card.hasAttacked !== true &&
    getEffectiveAtk(card) > 0
  );
}

function collectBattleReadyAttackers(analysis = {}) {
  return cards(analysis, "field").filter(isBattleReadyAttacker);
}

function getPotentialBattleAttackers(analysis = {}) {
  const attackers = [...collectBattleReadyAttackers(analysis)];
  if (analysis.summonAvailable !== false) {
    attackers.push(
      ...cards(analysis, "hand").filter(
        (card) =>
          isLuminarchMonster(card) &&
          ((card.level || 0) <= 4 ||
            card.name === NAMES.moonblade ||
            (card.name === NAMES.marshal && (analysis.lp || 0) > 2500)),
      ),
    );
  }
  const barbarias = cards(analysis, "field").find(
    (card) =>
      card?.name === NAMES.barbarias &&
      !card.isFacedown &&
      card.position === "defense" &&
      card.hasAttacked !== true,
  );
  if (barbarias) {
    attackers.push({
      ...barbarias,
      atk: (barbarias.atk || 0) + 800,
      position: "attack",
      _simPotentialBarbariasPush: true,
    });
  }
  return attackers;
}

function getTargetBattleStat(card) {
  return getBattleStatForAttackTarget(card, { facedownValue: 1500 });
}

function canDestroyBattleTarget(attacker, target, atkBoost = 0) {
  if (!attacker || !target || target.cardKind !== "monster") return false;
  return getEffectiveAtk(attacker) + atkBoost > getTargetBattleStat(target);
}

function canAnyAttackerDestroyTarget(attackers = [], targets = [], atkBoost = 0) {
  return attackers.some((attacker) =>
    targets.some((target) => canDestroyBattleTarget(attacker, target, atkBoost)),
  );
}

function hasDirectOrNearLethal(analysis = {}, attackers = []) {
  const opponentLp = Number(analysis.oppLp ?? analysis.opponent?.lp ?? 0);
  if (opponentLp <= 0) return false;
  if (cards(analysis, "oppField").some((card) => card?.cardKind === "monster")) {
    return false;
  }
  const attackTotal = attackers.reduce(
    (sum, card) => sum + Math.max(0, getEffectiveAtk(card)),
    0,
  );
  if (attackTotal >= opponentLp) return true;
  const hasSickle = hasName(cards(analysis, "hand"), NAMES.magicSickle);
  return hasSickle && attackTotal + 1200 >= opponentLp;
}

function hasBattleMain2Payoff(analysis = {}) {
  const hand = cards(analysis, "hand");
  const field = cards(analysis, "field");
  const gy = cards(analysis, "graveyard");
  if (hasFortressRevive(analysis)) return true;
  if (hasName(hand, NAMES.moonlit) && gy.some(isLuminarchMonster)) return true;
  if (
    hasName(hand, NAMES.radiantWave) &&
    field.some((card) => isLuminarchMonster(card) && getEffectiveAtk(card) >= 2000)
  ) {
    return true;
  }
  if (hasName(hand, NAMES.sacredJudgment) && gy.some(isLuminarchMonster)) {
    return true;
  }
  if (hasPureKnightFusionAccess(analysis) || hasBarbariasFusionAccess(analysis)) {
    return true;
  }
  return hasMagicSickleRecovery(analysis);
}

function collectBattleBridgeSignals(analysis = {}, context = {}) {
  const game = context.game || analysis.game || {};
  const phase = analysis.phase || game?.phase || "main1";
  const requestedTurnMode = game?.turnLineSearchTurnMode;
  if (!isMain1Phase(phase)) return [];
  if (requestedTurnMode === "mainOnly") return [];
  if (requestedTurnMode === "mainBattleMain2") {
    return ["manual mainBattleMain2"];
  }

  const hand = cards(analysis, "hand");
  const field = cards(analysis, "field");
  const spellTrap = cards(analysis, "spellTrap");
  const oppField = cards(analysis, "oppField").filter(
    (card) => card?.cardKind === "monster",
  );
  const attackers = getPotentialBattleAttackers(analysis);
  const readyAttackers = collectBattleReadyAttackers(analysis);
  const signals = [];

  if (attackers.length === 0) return signals;
  if (hasDirectOrNearLethal(analysis, attackers)) signals.push("battle lethal");
  if (
    hasName(hand, NAMES.spear) &&
    field.some(isFaceupLuminarchMonster) &&
    oppField.length > 0
  ) {
    signals.push("Spear creates battle target");
  }
  if (
    (hasName(field, NAMES.moonblade) || hasName(hand, NAMES.moonblade)) &&
    oppField.length > 0
  ) {
    signals.push("Moonblade battle conversion");
  }
  if (
    field.some((card) => card?.name === NAMES.radiantLancer) &&
    canAnyAttackerDestroyTarget(
      field.filter((card) => card?.name === NAMES.radiantLancer),
      oppField,
    )
  ) {
    signals.push("Radiant Lancer can grow");
  }
  if (
    field.some((card) => card?.name === NAMES.aurora) &&
    canAnyAttackerDestroyTarget(
      field.filter((card) => card?.name === NAMES.aurora),
      oppField,
    )
  ) {
    signals.push("Aurora can convert battle to LP");
  }
  if (field.some((card) => card?.name === NAMES.barbarias)) {
    signals.push("Barbarias battle push");
  }
  if (spellTrap.some((card) => card?.name === NAMES.sunforgedBlade)) {
    signals.push("Sunforged LP battle payoff");
  }
  if (
    hasName(hand, NAMES.magicSickle) &&
    (canAnyAttackerDestroyTarget(attackers, oppField, 1200) ||
      hasDirectOrNearLethal(analysis, attackers))
  ) {
    signals.push("Magic Sickle changes combat");
  }
  if (
    (hasName(hand, NAMES.holyShield) ||
      spellTrap.some((card) => card?.name === NAMES.holyShield)) &&
    readyAttackers.length > 0
  ) {
    signals.push("Holy Shield supports battle");
  }
  if (analysis.fieldSpell?.name === NAMES.citadel && oppField.length > 0) {
    signals.push("Citadel battle protection");
  }
  if (field.some((card) => card?.name === NAMES.marshal && !card.isFacedown)) {
    signals.push("Marshal can hold combat");
  }
  if (hasBattleMain2Payoff(analysis) && oppField.length > 0) {
    signals.push("battle opens Main 2 payoff");
  }

  return [...new Set(signals)];
}

function getBattleStepLimit(analysis = {}, battleSignals = []) {
  const readyAttackers = collectBattleReadyAttackers(analysis);
  const hasMoonbladeReady = readyAttackers.some(
    (card) => card?.name === NAMES.moonblade,
  );
  if (hasMoonbladeReady || readyAttackers.length >= 2) return 2;
  if (battleSignals.some((signal) => signal.includes("Moonblade"))) return 2;
  return 1;
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

function isCriticalProfile(profile = {}) {
  return profile.critical === true || profile.mode === "critical";
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

function getSimulatedBattleSteps(sequence = []) {
  return (sequence || []).filter((action) => action?.type === "simulatedBattle");
}

function getDetailedBattleSteps(sequence = []) {
  return getSimulatedBattleSteps(sequence).flatMap((step) =>
    Array.isArray(step?.battleSteps) && step.battleSteps.length > 0
      ? step.battleSteps
      : [step],
  );
}

function getBattleRewardNames(steps = []) {
  return steps.flatMap((step) =>
    Array.isArray(step?.rewardNames) ? step.rewardNames.filter(Boolean) : [],
  );
}

function getBattleLpGain(steps = []) {
  return steps.reduce(
    (sum, step) =>
      sum +
      (step?.lpGains || []).reduce(
        (gainSum, gain) => gainSum + Math.max(0, Number(gain?.amount || 0)),
        0,
      ),
    0,
  );
}

function getDestroyedBattleCards(steps = [], owner) {
  return steps.flatMap((step) =>
    (step?.destroyedCards || []).filter(
      (card) => !owner || card?.owner === owner,
    ),
  );
}

function getDestroyedBattleCardValue(card) {
  if (!card || card.cardKind !== "monster") return 0;
  const printedBest = Math.max(Number(card.atk || 0), Number(card.def || 0));
  const levelValue = Number(card.level || 0) * 180;
  return Math.max(printedBest, levelValue);
}

function isDestroyedBattleWall(card) {
  if (!card || card.cardKind !== "monster") return false;
  if (WALL_NAMES.has(card.name)) return true;
  return Number(card.def || 0) >= 2400;
}

function getMain2PayoffActionsAfterBattle(sequence = []) {
  const battleIndex = sequence.findIndex(
    (action) => action?.type === "simulatedBattle",
  );
  if (battleIndex < 0) return [];
  return sequence.slice(battleIndex + 1).filter((action) =>
    MAIN2_BATTLE_PAYOFF_NAMES.has(
      action?.cardName || action?.card?.name || action?.name,
    ),
  );
}

function rewardNameMatches(rewards = [], pattern) {
  return rewards.some((name) => pattern.test(String(name || "")));
}

function getLineImpact(context = {}) {
  const initialBot = getPlanningBot(context.initialState || {});
  const finalBot = getPlanningBot(context.finalState || {});
  const initialOpponent = getPlanningOpponent(context.initialState || {});
  const finalOpponent = getPlanningOpponent(context.finalState || {});
  const sequence = Array.isArray(context.sequence) ? context.sequence : [];
  const simulatedBattles = getSimulatedBattleSteps(sequence);
  const detailedBattleSteps = getDetailedBattleSteps(sequence);
  const battleRewardNames = getBattleRewardNames(detailedBattleSteps);
  const battleLpGain = getBattleLpGain(detailedBattleSteps);
  const battleDestroyedOpponentCards = getDestroyedBattleCards(
    detailedBattleSteps,
    "opponent",
  );
  const battleDestroyedSelfCards = getDestroyedBattleCards(
    detailedBattleSteps,
    "self",
  );
  const battleLostWallCount = battleDestroyedSelfCards.filter(
    isDestroyedBattleWall,
  ).length;
  const simulatedBattleRemovedThreat = battleDestroyedOpponentCards.reduce(
    (sum, card) => sum + getDestroyedBattleCardValue(card),
    0,
  );
  const main2PayoffActions = getMain2PayoffActionsAfterBattle(sequence);
  const simulatedBattleDamage = detailedBattleSteps.reduce(
    (sum, battle) => sum + Math.max(0, Number(battle.damage || 0)),
    0,
  );
  const simulatedBattleRemovedOpponent = battleDestroyedOpponentCards.length;
  const simulatedBattleLostSelf = battleDestroyedSelfCards.length;
  const hasMain2AfterBattlePayoff = main2PayoffActions.length > 0;
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
    initialOpponentThreat,
    finalOpponentThreat,
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
    simulatedBattles,
    detailedBattleSteps,
    simulatedBattleDamage,
    simulatedBattleRemovedOpponent,
    simulatedBattleLostSelf,
    simulatedBattleLostWallCount: battleLostWallCount,
    simulatedBattleRemovedThreat,
    simulatedBattleRewardNames: battleRewardNames,
    simulatedBattleRewards: battleRewardNames.length,
    simulatedBattleLpGain: battleLpGain,
    hasMain2AfterBattlePayoff,
    main2BattlePayoffNames: main2PayoffActions
      .map((action) => action?.cardName || action?.card?.name || action?.name)
      .filter(Boolean),
  };
}

function hasStateCard(player = {}, zones = [], predicate = () => false) {
  return zones.some((zone) => stateCards(player, zone).some(predicate));
}

function countStateCards(player = {}, zones = [], predicate = () => true) {
  return zones.reduce(
    (sum, zone) => sum + stateCards(player, zone).filter(predicate).length,
    0,
  );
}

function hasStateNameInZones(player = {}, zones = [], name) {
  return hasStateCard(player, zones, (card) => card?.name === name);
}

function getBattleWallValue(card) {
  if (!card || card.cardKind !== "monster") return 0;
  const atk =
    Number(card.atk || 0) +
    Number(card.tempAtkBoost || 0) +
    Number(card.permanentAtkBoost || 0);
  const def =
    Number(card.def || 0) +
    Number(card.tempDefBoost || 0) +
    Number(card.permanentDefBoost || 0);
  return card.position === "attack" ? atk : def;
}

function getBestWallValue(player = {}) {
  return stateCards(player, "field").reduce((best, card) => {
    if (!isLuminarchWall(card)) return best;
    return Math.max(best, getBattleWallValue(card));
  }, 0);
}

function hasWallOverThreat(player = {}, opponent = {}) {
  const wallValue = getBestWallValue(player);
  if (wallValue <= 0) return false;
  const threat = getStrongestAttackThreat(stateCards(opponent, "field"), {
    facedownValue: 1500,
    includeBoosts: false,
  });
  return threat <= 0 || wallValue >= threat;
}

function hasProtectedWall(player = {}, opponent = {}) {
  if (countWalls(player) <= 0) return false;
  const hasProtection =
    hasCitadelOnline(player) ||
    hasStateNameInZones(player, ["hand", "spellTrap"], NAMES.holyShield) ||
    hasStateNameInZones(player, ["field", "spellTrap"], NAMES.crescentShield) ||
    (hasStateName(player, "field", NAMES.aurora) &&
      countFaceupLuminarchs(player) >= 2);
  return hasProtection && hasWallOverThreat(player, opponent);
}

function countLpCostFollowUps(player = {}) {
  return countStateCards(
    player,
    ["hand", "spellTrap", "fieldSpell"],
    (card) => card && LP_COST_FOLLOW_UP_NAMES.has(card.name),
  );
}

function hasLpPayoffEngine(player = {}, options = {}) {
  const hasFaceupLuminarch = countFaceupLuminarchs(player) > 0;
  if (!hasFaceupLuminarch) return false;
  const excludedNames = new Set(options.excludeNames || []);
  return hasStateCard(
    player,
    ["field", "spellTrap", "fieldSpell", "hand"],
    (card) =>
      card && LP_PAYOFF_NAMES.has(card.name) && !excludedNames.has(card.name),
  );
}

function hasFortressReviveFollowUp(player = {}) {
  if (stateCards(player, "field").length >= 5) return false;
  return (
    hasStateName(player, "field", NAMES.fortress) &&
    stateCards(player, "graveyard").some(
      (card) => isLuminarchMonster(card) && (card.def || 0) <= 2000,
    )
  );
}

function hasGrindFollowUp(player = {}) {
  const gyLuminarchs = countUsefulGyLuminarchs(player);
  if (hasFortressReviveFollowUp(player)) return true;
  if (
    gyLuminarchs > 0 &&
    hasStateNameInZones(player, ["hand", "spellTrap"], NAMES.moonlit)
  ) {
    return true;
  }
  if (
    gyLuminarchs > 0 &&
    hasStateNameInZones(player, ["hand", "spellTrap"], NAMES.sacredJudgment)
  ) {
    return true;
  }
  return (
    hasStateName(player, "graveyard", NAMES.magicSickle) &&
    stateCards(player, "graveyard").some(
      (card) =>
        card?.cardKind === "spell" &&
        isLuminarch(card) &&
        USEFUL_SICKLE_SPELL_TARGETS.has(card.name),
    )
  );
}

function hasRealAttackPressure(player = {}, opponent = {}) {
  const opponentLp = Number(opponent?.lp || 0);
  const attackDamage = getAttackDamage(player);
  if (opponentLp > 0 && attackDamage >= opponentLp) return true;
  if (attackDamage >= 2800 && countBoardCards(opponent) === 0) return true;
  return attackDamage >= 4000;
}

function getLpPayments(impact = {}) {
  const payments = Array.isArray(impact.simMeta?.lpPayments)
    ? impact.simMeta.lpPayments
    : [];
  if (payments.length > 0) return payments;
  if (impact.lpDelta < 0) {
    return [
      {
        cardName: "unknown",
        cost: Math.abs(impact.lpDelta),
        beforeLp: Number(impact.initialBot?.lp || 0),
        afterLp: Number(impact.finalBot?.lp || 0),
      },
    ];
  }
  return [];
}

function scoreTerminalQuality(impact = {}) {
  const finalBot = impact.finalBot || {};
  const finalOpponent = impact.finalOpponent || {};
  let score = 0;

  if (impact.finalCitadel && impact.finalFaceupLuminarchs > 0) score += 2;
  if (impact.finalCitadel && impact.finalWalls > 0) score += 1.5;
  if (impact.finalFaceupLuminarchs >= 2) score += 1;
  if (hasWallOverThreat(finalBot, finalOpponent)) score += 2;
  if (hasProtectedWall(finalBot, finalOpponent)) score += 1.5;
  if (
    hasStateName(finalBot, "field", NAMES.pureKnight) &&
    countLpCostFollowUps(finalBot) > 0
  ) {
    score += 2;
  }
  if (
    hasStateName(finalBot, "field", NAMES.barbarias) &&
    hasLpPayoffEngine(finalBot, { excludeNames: [NAMES.barbarias] })
  ) {
    score += 2;
  }
  if (hasFortressReviveFollowUp(finalBot)) score += 2;
  if (hasGrindFollowUp(finalBot)) score += 1;
  if (hasRealAttackPressure(finalBot, finalOpponent)) score += 1;
  if (countBoardCards(finalOpponent) === 0 && countBoardCards(finalBot) > 0) {
    score += 1;
  }

  return score;
}

function scoreTerminalLpPolicy(impact = {}) {
  const payments = getLpPayments(impact);
  if (payments.length === 0) return 0;

  const safetyImproved = impact.initialLethal && !impact.finalLethal;
  const wallCreated = impact.finalWalls > impact.initialWalls;
  const payoffCreated =
    impact.finalFusionPayoffs > impact.initialFusionPayoffs ||
    (!impact.initialCitadel && impact.finalCitadel);
  const resourceRecovered =
    impact.finalHandCount > impact.initialHandCount ||
    impact.finalGyResources > impact.initialGyResources;
  const opponentWeakened =
    impact.removedOpponentCards > 0 || impact.threatReduction >= 500;
  const finalLp = Number(impact.finalBot?.lp || 0);
  let score = 0;

  payments.forEach((payment) => {
    const cost = Math.max(0, Number(payment?.cost || 0));
    const afterLp = Number(payment?.afterLp ?? finalLp);
    const markedPositive =
      payment?.createsWall === true || payment?.createsPayoff === true;
    const createdUsefulState =
      markedPositive ||
      safetyImproved ||
      wallCreated ||
      payoffCreated ||
      resourceRecovered ||
      opponentWeakened;

    if (impact.finalLethal && afterLp <= Math.max(3000, impact.finalOpponentThreat)) {
      score -= cost >= 2000 ? 4.5 : 3;
    } else if (createdUsefulState) {
      score += cost >= 2000 ? 1.8 : 1.2;
    } else {
      score -= cost >= 2000 ? 3 : 1.8;
    }
  });

  const totalCost = payments.reduce(
    (sum, payment) => sum + Math.max(0, Number(payment?.cost || 0)),
    0,
  );
  const hasStrongPayoff =
    safetyImproved ||
    wallCreated ||
    payoffCreated ||
    (opponentWeakened && !impact.finalLethal);
  if (totalCost >= 3000 && !hasStrongPayoff) score -= 2.5;
  if (totalCost > 0 && finalLp <= 2000 && impact.finalOpponentThreat > 0) {
    score -= impact.finalLethal ? 3 : 1.5;
  }

  return score;
}

function scoreTerminalRisk(impact = {}) {
  const finalBot = impact.finalBot || {};
  const finalOpponent = impact.finalOpponent || {};
  const finalField = stateCards(finalBot, "field");
  const finalHand = stateCards(finalBot, "hand");
  const lineLength = impact.sequence.filter(
    (action) => action?.type !== "simulatedBattle",
  ).length;
  const fieldWeak =
    impact.finalFaceupLuminarchs === 0 ||
    (impact.finalWalls === 0 && impact.finalFusionPayoffs === 0);
  const battleSetupWithoutBattle =
    !impact.sequence.some((action) => action?.type === "simulatedBattle") &&
    (sequenceUses(impact.sequence, NAMES.spear) ||
      sequenceUses(impact.sequence, NAMES.holyAscension));
  let score = 0;

  if (finalField.length === 0 && impact.finalOpponentThreat > 0) score -= 6;
  if (impact.finalLethal && (finalBot.lp || 0) <= 3000) score -= 5;
  if (finalHand.length === 0 && fieldWeak) score -= 4;
  if (
    impact.finalWalls > 0 &&
    !impact.finalCitadel &&
    !hasGrindFollowUp(finalBot) &&
    !hasRealAttackPressure(finalBot, finalOpponent)
  ) {
    score -= 2.5;
  }
  if (
    impact.finalFusionPayoffs < impact.initialFusionPayoffs &&
    impact.finalWalls <= impact.initialWalls &&
    impact.removedOpponentCards <= 0
  ) {
    score -= 4;
  }
  if (
    lineLength >= 4 &&
    !impact.finalCitadel &&
    impact.finalWalls <= impact.initialWalls &&
    impact.finalFusionPayoffs <= impact.initialFusionPayoffs &&
    impact.removedOpponentCards <= 0
  ) {
    score -= 3;
  }
  if (
    battleSetupWithoutBattle &&
    impact.removedOpponentCards <= 0 &&
    !hasRealAttackPressure(finalBot, finalOpponent)
  ) {
    score -= 2;
  }

  return score;
}

function scoreTerminalAdjustments(impact = {}) {
  return (
    scoreTerminalQuality(impact) +
    scoreTerminalLpPolicy(impact) +
    scoreTerminalRisk(impact)
  );
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
    if (
      impact.simulatedBattles.length > 0 &&
      BATTLE_SIM_MILESTONE_KEYS.has(key)
    ) {
      return;
    }
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

function scoreBattleBridgeMilestones(entries, impact) {
  if (impact.simulatedBattles.length === 0) return;
  const rewards = impact.simulatedBattleRewardNames || [];
  const removedCount = impact.simulatedBattleRemovedOpponent || 0;
  const lostCount = impact.simulatedBattleLostSelf || 0;
  const removedThreat = impact.simulatedBattleRemovedThreat || 0;
  const damage = impact.simulatedBattleDamage || 0;
  const lpGain = impact.simulatedBattleLpGain || 0;
  const usefulBattle =
    removedCount > 0 ||
    damage >= 800 ||
    lpGain >= 800 ||
    rewards.length > 0 ||
    impact.hasMain2AfterBattlePayoff ||
    Number(impact.finalOpponent?.lp || 0) <= 0;

  if (Number(impact.finalOpponent?.lp || 0) <= 0) {
    addMilestone(entries, 4, "Battle: converted lethal");
  }
  if (impact.simulatedBattleRemovedOpponent > 0) {
    const removalScore =
      Math.min(4.5, removedCount * 2.1) + Math.min(1.8, removedThreat / 1800);
    addMilestone(entries, removalScore, "Battle: removed real threat");
  }
  if (damage >= 1800) {
    addMilestone(entries, Math.min(3, damage / 900), "Battle: decisive damage");
  } else if (damage >= 800) {
    addMilestone(entries, 1.2, "Battle: useful damage");
  }
  if (sequenceUses(impact.sequence, NAMES.spear)) {
    if (removedCount > 0 || impact.threatReduction >= 800) {
      addMilestone(entries, 3, "Spear: converted threat into removal");
    } else if (!usefulBattle) {
      addMilestone(entries, -2, "Spear: no battle conversion");
    }
  }
  if (rewardNameMatches(rewards, /Magic Sickle/)) {
    const sickleMattered =
      removedCount > 0 ||
      damage >= 1000 ||
      Number(impact.finalOpponent?.lp || 0) <= 0;
    addMilestone(
      entries,
      sickleMattered ? 2.5 : -1.5,
      sickleMattered
        ? "Magic Sickle: combat result mattered"
        : "Risk: Magic Sickle lacked payoff",
    );
  }
  if (rewardNameMatches(rewards, /Citadel protected/)) {
    addMilestone(entries, 1.6, "Citadel: protected battle body");
  }
  if (rewardNameMatches(rewards, /battle damage converted to LP/)) {
    addMilestone(
      entries,
      Math.min(3.5, 1.5 + lpGain / 1000),
      "Holy Shield: battle damage became LP",
    );
  }
  if (rewardNameMatches(rewards, /Moonblade/)) {
    addMilestone(
      entries,
      impact.detailedBattleSteps.length >= 2 ? 3 : 1.8,
      "Moonblade: earned second attack",
    );
  }
  if (rewardNameMatches(rewards, /Radiant Lancer/)) {
    addMilestone(entries, 1.8, "Radiant Lancer: battle growth");
  }
  if (rewardNameMatches(rewards, /Aurora Seraph/)) {
    addMilestone(
      entries,
      Math.min(3, 1.2 + lpGain / 1200),
      "Aurora: converted battle into LP",
    );
  }
  if (rewardNameMatches(rewards, /Sunforged/)) {
    const sunforgedEvents = rewards.filter((name) => /Sunforged/.test(name)).length;
    addMilestone(
      entries,
      Math.min(2.2, sunforgedEvents * 0.9),
      "Sunforged: battle LP fed counters",
    );
  }
  if (rewardNameMatches(rewards, /Barbarias doubled/)) {
    addMilestone(
      entries,
      lpGain >= 1600 ? 2.4 : 1.4,
      "Barbarias: doubled relevant LP gain",
    );
  }
  if (rewardNameMatches(rewards, /Marshal battle destruction heal/)) {
    addMilestone(entries, 1.2, "Marshal: turned battle loss into LP");
  }
  if (impact.hasMain2AfterBattlePayoff) {
    const uniquePayoffs = new Set(impact.main2BattlePayoffNames || []);
    addMilestone(
      entries,
      Math.min(4, 2.2 + uniquePayoffs.size * 0.6),
      "Battle: opened Main 2 payoff",
    );
  }
  if (lostCount > 0 && removedCount === 0 && !impact.finalLethal) {
    addMilestone(
      entries,
      impact.simulatedBattleLostWallCount > 0 ? -6 : -4,
      "Risk: battle lost body without payoff",
    );
  }
  if (!usefulBattle) {
    addMilestone(entries, -3, "Risk: Battle bridge had no payoff");
  }
  if (
    impact.finalLethal &&
    Number(impact.finalBot?.lp || 0) <= Math.max(3000, impact.finalOpponentThreat)
  ) {
    addMilestone(entries, -4, "Risk: battle left lethal exposure");
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
  const battleSignals = collectBattleBridgeSignals(analysis, context);
  const reasons = [...collectPlanningReasons(analysis), ...battleSignals];
  const enabled = manual || reasons.length > 0;
  const phase = analysis.phase || game?.phase || "main1";
  const requestedTurnMode = game?.turnLineSearchTurnMode;
  const useBattleBridge = battleSignals.length > 0;
  const turnMode =
    requestedTurnMode ||
    (useBattleBridge ? "mainBattleMain2" : DEFAULT_PROFILE.turnMode);

  return {
    ...DEFAULT_PROFILE,
    enabled,
    mode: manual && reasons.length === 0 ? "manual" : enabled ? "critical" : "off",
    turnMode,
    battleStepLimit: useBattleBridge ? getBattleStepLimit(analysis, battleSignals) : 1,
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
      : DEFAULT_PROFILE.nodeBudget + (useBattleBridge ? 40 : 0),
    candidateLimit: Number.isFinite(game?.turnLineSearchCandidateLimit)
      ? game.turnLineSearchCandidateLimit
      : DEFAULT_PROFILE.candidateLimit,
    reasons,
    critical: reasons.length > 0,
    availablePackages: (analysis.availableCombos || detectAvailableCombos(analysis))
      .filter((entry) =>
        (useBattleBridge ? MAIN_BATTLE_PACKAGES : MAIN_ONLY_PACKAGES).has(
          entry?.package,
        ),
      )
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
    battleSignals,
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
  scoreBattleBridgeMilestones(entries, impact);
  addSimMetaMilestones(entries, impact);
  scoreRiskMilestones(entries, impact);

  entries.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return b.score - a.score;
  });

  const rawScore = entries.reduce((sum, entry) => sum + entry.score, 0);
  const profile = context.profile || context.planningContext?.profile || {};
  const milestoneCap = isCriticalProfile(profile) ? 14 : 10;
  return {
    scoreDelta: clampScore(rawScore, -milestoneCap, milestoneCap),
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
        simulatedBattles: impact.simulatedBattles.length,
        battleDamage: impact.simulatedBattleDamage,
        battleLpGain: impact.simulatedBattleLpGain,
        battleRemovedThreat: impact.simulatedBattleRemovedThreat,
        main2BattlePayoffs: impact.main2BattlePayoffNames,
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
  const critical = isCriticalProfile(profile);
  const milestoneCap = critical ? 14 : 10;
  const terminalCap = critical ? 12 : 8;
  const milestoneScore = clampScore(
    rawMilestoneScore,
    -milestoneCap,
    milestoneCap,
  );
  const terminalScore = clampScore(
    scoreTerminalAdjustments(getLineImpact(context)),
    -terminalCap,
    terminalCap,
  );
  return baseScore + milestoneScore + terminalScore;
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
