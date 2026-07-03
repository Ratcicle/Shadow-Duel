import { isExtremeDragon } from "./knowledge.js";
import { getEffectiveAtk, getEffectiveDef } from "../common/cardStats.js";

const SOLO_EXTREME_NAMES = new Set([
  "Fire Extreme Dragon",
  "Volcanic Extreme Dragon",
]);

const DRAGON_BOSS_NAMES = new Set([
  "Fire Extreme Dragon",
  "Volcanic Extreme Dragon",
  "Purified Crystal Dragon",
  "Black Bull Dragon",
  "Hellkite Dragon",
  "Majestic Silver Dragon",
  "Radiant Cosmic Dragon",
  "Tech-Void Dragon",
  "Rainbow Cosmic Dragon",
  "Metal Armored Dragon",
]);

const SANCTUARY_REPLACEMENT_ORDER = [
  "Volcanic Extreme Dragon",
  "Fire Extreme Dragon",
  "Purified Crystal Dragon",
  "Stelya, Dragon Tamer",
  "Lunar Eclipse Dragon",
  "Solar Eclipse Dragon",
  "Luminous Dragon",
  "Luminescent Dragon",
  "Voltaic Dragon",
  "Grey Dragon",
  "Armored Dragon",
];

const CALL_REVIVE_ORDER = [
  "Volcanic Extreme Dragon",
  "Fire Extreme Dragon",
  "Purified Crystal Dragon",
  "Stelya, Dragon Tamer",
  "Luminous Dragon",
  "Lunar Eclipse Dragon",
  "Solar Eclipse Dragon",
  "Luminescent Dragon",
  "Voltaic Dragon",
  "Grey Dragon",
];

function zoneCards(player, zone) {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return Array.isArray(player[zone]) ? player[zone].filter(Boolean) : [];
}

function isDragonMonster(card) {
  return card?.cardKind === "monster" && card.type === "Dragon";
}

function isFaceupDragon(card) {
  return isDragonMonster(card) && !card.isFacedown;
}

function hasName(cards = [], name) {
  return (cards || []).some((card) => card?.name === name);
}

function getCardInstanceId(card) {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uid ??
    card?.uuid ??
    card?.simInstanceId ??
    null
  );
}

function unique(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function battleStat(card = {}) {
  if (!card || card.cardKind !== "monster") return 0;
  if (card.isFacedown || card.position === "defense") return getEffectiveDef(card);
  return getEffectiveAtk(card);
}

function cardThreatValue(card = {}) {
  if (!card) return 0;
  let score = Math.max(getEffectiveAtk(card), getEffectiveDef(card)) / 500;
  score += Number(card.level || 0) * 0.35;
  if ((card.effects || []).length > 0) score += 1.2;
  if (card.monsterType === "fusion" || card.monsterType === "ascension") score += 5;
  if (DRAGON_BOSS_NAMES.has(card.name) || isExtremeDragon(card)) score += 4;
  return score;
}

function cardFieldValue(card = {}) {
  if (!card) return 0;
  let score = cardThreatValue(card);
  if (isFaceupDragon(card)) score += 1;
  if (DRAGON_BOSS_NAMES.has(card.name) || isExtremeDragon(card)) score += 6;
  if (["Solar Eclipse Dragon", "Lunar Eclipse Dragon", "Stelya, Dragon Tamer"].includes(card.name)) {
    score += 3;
  }
  return score;
}

function isSoloExtreme(attacker, bot = {}) {
  if (!SOLO_EXTREME_NAMES.has(attacker?.name)) return false;
  const monsters = zoneCards(bot, "field").filter(
    (card) => card?.cardKind === "monster" && !card.isFacedown,
  );
  return monsters.length === 1 && monsters[0] === attacker;
}

function canDestroyByBattle(attacker, target) {
  if (!attacker || !target) return false;
  return getEffectiveAtk(attacker) > battleStat(target);
}

function bestBattleTargetForAttacker(attacker, opponentField = []) {
  return (opponentField || [])
    .filter((target) => target?.cardKind === "monster")
    .map((target) => ({
      target,
      score:
        (canDestroyByBattle(attacker, target) ? 50 : 0) +
        cardThreatValue(target),
    }))
    .sort((a, b) => b.score - a.score)[0]?.target || null;
}

export function getMajesticBattlePositionPlan({
  source,
  opponentField = [],
} = {}) {
  if (source?.name !== "Majestic Silver Dragon") return null;
  const sourceAtk = getEffectiveAtk(source);
  const candidates = (opponentField || [])
    .filter((target) => target?.cardKind === "monster" && !target.isFacedown)
    .map((target) => {
      const afterSwitchStat =
        target.position === "defense" ? getEffectiveAtk(target) : getEffectiveDef(target);
      const currentlyWins =
        target.position === "defense"
          ? sourceAtk > getEffectiveDef(target)
          : sourceAtk > getEffectiveAtk(target);
      const winsAfterSwitch = sourceAtk > afterSwitchStat;
      let score = cardThreatValue(target);
      if (winsAfterSwitch && !currentlyWins) score += 60;
      if (winsAfterSwitch) score += 18;
      if (target.monsterType === "fusion" || target.monsterType === "ascension") score += 10;
      return { target, score, winsAfterSwitch, currentlyWins };
    })
    .filter((entry) => entry.winsAfterSwitch || entry.target.monsterType)
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;
  return {
    ok: true,
    target: best.target,
    priorityBonus: best.winsAfterSwitch && !best.currentlyWins ? 5 : 2,
    preferredNames: candidates.slice(0, 3).map((entry) => entry.target.name),
    reason: "Majestic position switch creates battle removal",
  };
}

export function getLuminescentBattleDebuffPlan({
  bot = {},
  opponent = {},
} = {}) {
  const attackers = zoneCards(bot, "field").filter(
    (card) =>
      isFaceupDragon(card) &&
      card.position !== "defense" &&
      !card.cannotAttackThisTurn &&
      !card.hasAttacked,
  );
  if (attackers.length === 0) return null;
  const targets = zoneCards(opponent, "field").filter(
    (card) => card?.cardKind === "monster" && !card.isFacedown,
  );
  const candidates = [];
  for (const target of targets) {
    const currentStat = battleStat(target);
    const debuffedAtk = Math.max(0, getEffectiveAtk(target) - 600);
    const debuffedDef = Math.max(0, getEffectiveDef(target) - 600);
    const debuffedStat =
      target.position === "defense" ? debuffedDef : debuffedAtk;
    const bestAttacker = attackers
      .filter(
        (attacker) =>
          getEffectiveAtk(attacker) <= currentStat &&
          getEffectiveAtk(attacker) > debuffedStat,
      )
      .sort((a, b) => getEffectiveAtk(b) - getEffectiveAtk(a))[0];
    if (!bestAttacker) continue;
    candidates.push({
      target,
      attacker: bestAttacker,
      score: 55 + cardThreatValue(target) + getEffectiveAtk(bestAttacker) / 1000,
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;
  return {
    ok: true,
    target: best.target,
    attacker: best.attacker,
    priorityBonus: 5,
    preferredNames: candidates.slice(0, 3).map((entry) => entry.target.name),
    reason: "Luminescent debuff changes battle math",
  };
}

export function scoreDragonBattleAttack(context = {}) {
  const attacker = context.attacker || {};
  const target = context.target || null;
  const bot = context.bot || {};
  const opponent = context.opponent || {};
  if (!isDragonMonster(attacker)) return 0;

  const targetDestroyed = Boolean(target) && context.targetSurvived === false;
  const attackerSurvived = context.attackerSurvived !== false;
  const lethalNow = context.lethalNow === true;
  const targetThreat = cardThreatValue(target);
  const soloExtreme = isSoloExtreme(attacker, bot);
  let score = 0;

  if (attacker.name === "Grey Dragon" && target === null) return -1000;

  if (lethalNow) score += 9;
  if (targetDestroyed) {
    score += 3 + Math.min(4, targetThreat / 2.2);
    if (targetThreat >= 8) score += 2;
  }
  if (target && attackerSurvived) score += 0.9;
  if (target && !attackerSurvived && !lethalNow) {
    score -= soloExtreme ? 9 : DRAGON_BOSS_NAMES.has(attacker.name) ? 5 : 2.8;
  }
  if (target && !targetDestroyed && !lethalNow) {
    score -= targetThreat >= 8 ? 2.5 : 1;
  }

  if (target === null) {
    if (!lethalNow && zoneCards(opponent, "field").length > 0) score -= 4;
    if (attacker.name === "Black Bull Dragon" && !lethalNow) score -= 2.2;
    else if (!lethalNow) score += 0.2;
  }

  if (attacker.name === "Black Bull Dragon") {
    if (targetDestroyed) score += context.isSecondAttack ? 3 : 2.2;
    if (target === null && !lethalNow) score -= 1.4;
  }

  if (targetDestroyed && bot.fieldSpell?.name === "Jagged Peak of the Dragons") {
    const counters = Number(bot.fieldSpell.counters?.dragon_peak || 0);
    score += counters >= 4 ? 4.2 : 1.5;
  }

  if (attacker.name === "Fire Extreme Dragon" && targetDestroyed) {
    score += 1.8;
  }
  if (attacker.name === "Volcanic Extreme Dragon" && target) {
    score += (opponent.lp || 0) <= 600 ? 4.5 : 2;
  }
  if (attacker.name === "Purified Crystal Dragon" && targetDestroyed) {
    score += Math.min(2.5, Number(target?.level || 0) / 3);
  }
  if (attacker.name === "Rainbow Cosmic Dragon" && targetDestroyed) {
    score += (bot.lp || 8000) <= 3500 ? 2.5 : 1.3;
  }
  if (attacker.name === "Radiant Cosmic Dragon" && target) {
    score += attacker.preventsBattleDamageToController ? 1.4 : 0.6;
  }

  return score;
}

function preferredCardsByNames(cards = [], names = []) {
  const entries = (cards || [])
    .filter(Boolean)
    .map((card, index) => {
      const order = names.indexOf(card.name);
      return {
        card,
        index,
        score:
          (order >= 0 ? 100 - order * 4 : 0) +
          cardFieldValue(card),
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return entries.map((entry) => entry.card);
}

export function buildDragonDefenseTargetPreferences(context = {}) {
  const player = context.player || context.bot || context.game?.bot || {};
  const opponent = context.opponent || context.game?.player || {};
  const field = zoneCards(player, "field");
  const hand = zoneCards(player, "hand");
  const graveyard = zoneCards(player, "graveyard");
  const opponentField = zoneCards(opponent, "field");
  const defensiveNeed =
    opponentField.length > field.length ||
    opponentField.some((card) => battleStat(card) >= 2200) ||
    (player?.lp || 8000) <= 3500;

  const protectedField = preferredCardsByNames(field, [
    "Volcanic Extreme Dragon",
    "Fire Extreme Dragon",
    "Purified Crystal Dragon",
    "Rainbow Cosmic Dragon",
    "Radiant Cosmic Dragon",
    "Tech-Void Dragon",
    "Black Bull Dragon",
    "Stelya, Dragon Tamer",
    "Lunar Eclipse Dragon",
    "Solar Eclipse Dragon",
  ]);
  const replacements = preferredCardsByNames(hand.filter(isDragonMonster), SANCTUARY_REPLACEMENT_ORDER);
  const reviveTargets = preferredCardsByNames(
    graveyard.filter((card) => card?.cardKind === "monster"),
    CALL_REVIVE_ORDER,
  );

  const targetPreferences = {};
  if (protectedField.length > 0) {
    targetPreferences.returning = {
      role: "named_preference",
      preferredNames: unique(protectedField.map((card) => card.name)),
      preferredInstanceIds: protectedField
        .map(getCardInstanceId)
        .filter((id) => id !== null && id !== undefined),
    };
  }
  if (replacements.length > 0) {
    targetPreferences.replacement = {
      role: "recursion",
      purpose: defensiveNeed ? "stabilize" : "pressure",
      preferredNames: unique(replacements.map((card) => card.name)),
      offensiveNames: ["Fire Extreme Dragon", "Volcanic Extreme Dragon", "Purified Crystal Dragon"],
      defensiveNames: ["Stelya, Dragon Tamer", "Lunar Eclipse Dragon", "Luminous Dragon"],
      avoidNames: ["Armored Dragon", "Grey Dragon"],
      preferredInstanceIds: replacements
        .map(getCardInstanceId)
        .filter((id) => id !== null && id !== undefined),
    };
  }
  if (reviveTargets.length > 0) {
    targetPreferences.haunted_target = {
      role: "recursion",
      purpose: defensiveNeed ? "stabilize" : "pressure",
      preferredNames: unique(reviveTargets.map((card) => card.name)),
      offensiveNames: [
        "Fire Extreme Dragon",
        "Volcanic Extreme Dragon",
        "Purified Crystal Dragon",
        "Luminous Dragon",
      ],
      defensiveNames: ["Stelya, Dragon Tamer", "Lunar Eclipse Dragon"],
      preferredInstanceIds: reviveTargets
        .map(getCardInstanceId)
        .filter((id) => id !== null && id !== undefined),
    };
  }

  return targetPreferences;
}

export function scoreDragonBackrowSet(card, context = {}) {
  const player = context.player || context.bot || {};
  const opponent = context.opponent || {};
  const field = zoneCards(player, "field");
  const hand = zoneCards(player, "hand");
  const graveyard = zoneCards(player, "graveyard");
  const opponentField = zoneCards(opponent, "field");
  const defensiveNeed =
    opponentField.length > field.length ||
    opponentField.some((target) => battleStat(target) >= 2200) ||
    (player?.lp || 8000) <= 3500 ||
    (context.analysis?.lpRatio ?? 1) < 0.65;

  if (card?.name === "Call of the Haunted") {
    const preferred = preferredCardsByNames(
      graveyard.filter((candidate) => candidate?.cardKind === "monster"),
      CALL_REVIVE_ORDER,
    );
    if (preferred.length === 0) return { priority: 4, reason: "Call has no revive target" };
    const top = preferred[0];
    let priority = 8;
    if (CALL_REVIVE_ORDER.includes(top.name)) priority += 2;
    if (DRAGON_BOSS_NAMES.has(top.name) || isExtremeDragon(top)) priority += 2;
    if (defensiveNeed) priority += 2;
    return { priority, reason: `Call can revive ${top.name}` };
  }

  if (card?.name === "Dragon Spirit Sanctuary") {
    const protectedDragon = preferredCardsByNames(field.filter(isFaceupDragon), [
      "Volcanic Extreme Dragon",
      "Fire Extreme Dragon",
      "Purified Crystal Dragon",
      "Rainbow Cosmic Dragon",
      "Radiant Cosmic Dragon",
      "Tech-Void Dragon",
      "Black Bull Dragon",
      "Stelya, Dragon Tamer",
      "Lunar Eclipse Dragon",
      "Solar Eclipse Dragon",
    ])[0];
    const replacement = preferredCardsByNames(hand.filter(isDragonMonster), SANCTUARY_REPLACEMENT_ORDER)[0];
    if (!protectedDragon || !replacement) {
      return { priority: 3, reason: "Sanctuary lacks premium protection setup" };
    }
    const bossProtected = DRAGON_BOSS_NAMES.has(protectedDragon.name) || isExtremeDragon(protectedDragon);
    const weakOnly =
      !bossProtected &&
      !["Stelya, Dragon Tamer", "Lunar Eclipse Dragon", "Solar Eclipse Dragon"].includes(protectedDragon.name) &&
      ["Armored Dragon", "Grey Dragon"].includes(replacement.name);
    if (weakOnly && !defensiveNeed) {
      return { priority: 4, reason: "Sanctuary would only trade small Dragons" };
    }
    let priority = bossProtected ? 11 : 7;
    if (defensiveNeed) priority += 2;
    if (DRAGON_BOSS_NAMES.has(replacement.name) || isExtremeDragon(replacement)) priority += 1;
    return { priority, reason: `Sanctuary can protect ${protectedDragon.name}` };
  }

  return null;
}

export function shouldRecheckBossBeforeBattle(context = {}) {
  const player = context.player || context.bot || {};
  const opponent = context.opponent || {};
  const fieldDragons = zoneCards(player, "field").filter(isFaceupDragon);
  const opponentField = zoneCards(opponent, "field");
  if (fieldDragons.length < 2 || opponentField.length === 0) return false;
  const bestCurrentTarget = fieldDragons
    .map((attacker) => bestBattleTargetForAttacker(attacker, opponentField))
    .filter(Boolean)[0];
  if (!bestCurrentTarget) return true;
  const bestCurrentAtk = Math.max(...fieldDragons.map((card) => getEffectiveAtk(card)));
  const bestTargetStat = Math.max(...opponentField.map(battleStat));
  return bestCurrentAtk <= bestTargetStat || cardThreatValue(bestCurrentTarget) < 7;
}
