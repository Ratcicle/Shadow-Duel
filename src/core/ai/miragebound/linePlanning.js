import {
  getBattleStatForAttackTarget,
  getEffectiveAtk,
  getStrongestAttackThreat,
  getStrongestBattleThreat,
} from "../common/cardStats.js";

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
});

const DEFAULT_PROFILE = Object.freeze({
  enabled: false,
  mode: "off",
  turnMode: "mainOnly",
  beamWidth: 3,
  maxDepth: 4,
  nodeBudget: 220,
  candidateLimit: 8,
  battleStepLimit: 1,
});

const MIRAGEBOUND_SPELL_TRAPS = new Set([
  MB.OASIS,
  MB.MIRROR_PATH,
  MB.FALSE_HORIZON,
  MB.VANISHING_STEP,
  MB.HEAT_HAZE,
]);

const BOUNCE_SOURCE_NAMES = new Set([
  MB.DANCER,
  MB.OASIS,
  MB.FALSE_KING,
  MB.FALSE_HORIZON,
  MB.VANISHING_STEP,
  MB.GLASS_SOVEREIGN,
]);

const DEFENSIVE_CARD_NAMES = new Set([
  MB.MIRROR_PATH,
  MB.FALSE_HORIZON,
  MB.VANISHING_STEP,
]);

function safeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cardName(card) {
  if (!card) return null;
  if (typeof card === "string") return card;
  return card.name || card.cardName || card.label || null;
}

function actionName(action = {}) {
  return (
    action.cardName ||
    action.card?.name ||
    action.sourceCard?.name ||
    action.name ||
    action.attackerName ||
    null
  );
}

function actionLabel(action = {}) {
  if (action.type === "simulatedBattle") {
    const target = action.direct ? "direct" : action.targetName || "target";
    return `battle ${action.attackerName || "attacker"} -> ${target}`;
  }
  const name = actionName(action);
  const reason = action.reason ? ` (${action.reason})` : "";
  return `${action.type || "action"}${name ? ` ${name}` : ""}${reason}`.trim();
}

function getBotState(state) {
  return state?.bot || state?.player || {};
}

function getOpponentState(state) {
  return state?.player || state?.opponent || {};
}

function getZone(player, zone) {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return safeArray(player[zone]);
}

function getCards(player, zones = []) {
  return zones.flatMap((zone) => getZone(player, zone));
}

function countCards(player, zones, predicate = () => true) {
  return getCards(player, zones).filter(predicate).length;
}

function hasName(cards = [], name) {
  return safeArray(cards).some((card) => cardName(card) === name);
}

function hasCard(player, zones, name) {
  return hasName(getCards(player, zones), name);
}

function isMonster(card) {
  return card?.cardKind === "monster";
}

function isMiragebound(card) {
  return (
    card?.archetype === "Miragebound" ||
    (Array.isArray(card?.archetypes) && card.archetypes.includes("Miragebound"))
  );
}

function isMirageboundMonster(card) {
  return isMonster(card) && isMiragebound(card);
}

function isBattleReady(card) {
  return (
    isMonster(card) &&
    !card.isFacedown &&
    card.position !== "defense" &&
    !card.hasAttacked &&
    !card.cannotAttackThisTurn
  );
}

function totalVisibleAttack(field = []) {
  return safeArray(field).reduce((sum, card) => {
    if (!isBattleReady(card)) return sum;
    return sum + Math.max(0, getEffectiveAtk(card));
  }, 0);
}

function opponentThreatensLethal(bot = {}, opponent = {}) {
  const lp = Number(bot.lp || 0);
  if (lp <= 0) return true;
  const attack = safeArray(opponent.field).reduce((sum, card) => {
    if (!isMonster(card) || card.isFacedown || card.position === "defense") {
      return sum;
    }
    return sum + Math.max(0, getEffectiveAtk(card));
  }, 0);
  return attack >= lp;
}

function cardIdentity(card, index = 0) {
  return (
    card?.instanceId ||
    card?._instanceId ||
    card?.uid ||
    card?.uuid ||
    card?.simInstanceId ||
    card?.fieldPresenceId ||
    `${card?.id || 0}:${cardName(card) || "card"}:${index}`
  );
}

function pairCardsByIdentity(initialCards = [], finalCards = []) {
  const finalById = new Map();
  safeArray(finalCards).forEach((card, index) => {
    finalById.set(cardIdentity(card, index), card);
  });
  return safeArray(initialCards).map((initial, index) => ({
    initial,
    final: finalById.get(cardIdentity(initial, index)) || null,
  }));
}

function rawMonsterStats(card) {
  if (!isMonster(card)) return 0;
  return Math.max(0, Number(card.atk || 0)) + Math.max(0, Number(card.def || 0));
}

function totalRawMonsterStats(field = []) {
  return safeArray(field).reduce((sum, card) => sum + rawMonsterStats(card), 0);
}

function countOpponentCards(player = {}) {
  return countCards(player, ["field", "spellTrap", "fieldSpell"]);
}

function countMirageboundZones(player = {}, zones = []) {
  return countCards(player, zones, isMiragebound);
}

function actionUsesName(sequence = [], name) {
  return safeArray(sequence).some(
    (action) => action.type !== "simulatedBattle" && actionName(action) === name,
  );
}

function actionUsesAny(sequence = [], names = new Set()) {
  return safeArray(sequence).some(
    (action) =>
      action.type !== "simulatedBattle" && names.has(actionName(action)),
  );
}

function actionUsesMaterialName(action = {}, name) {
  return safeArray(action.materialNames).includes(name) ||
    safeArray(action.materials).some((material) => cardName(material) === name);
}

function sequenceUsesExtraDeckProcedure(sequence = [], name) {
  return safeArray(sequence).some(
    (action) => action.type === "extraDeckProcedure" && actionName(action) === name,
  );
}

function sequenceProcedureUsesMaterial(sequence = [], procedureName, materialName) {
  return safeArray(sequence).some(
    (action) =>
      action.type === "extraDeckProcedure" &&
      actionName(action) === procedureName &&
      actionUsesMaterialName(action, materialName),
  );
}

function sequenceHasScoutStarter(sequence = []) {
  return safeArray(sequence).some(
    (action) => action.type === "summon" && actionName(action) === MB.SCOUT,
  );
}

function sequenceHasBattle(sequence = []) {
  return safeArray(sequence).some((action) => action.type === "simulatedBattle");
}

function sequenceHasPositionAction(sequence = []) {
  return safeArray(sequence).some((action) =>
    [
      "fieldEffect",
      "monsterEffect",
      "spell",
      "spellTrapEffect",
      "position_change",
    ].includes(action.type),
  );
}

function getPositionImpact(initialOpponent = {}, finalOpponent = {}) {
  let toDefense = 0;
  let toAttack = 0;
  let attacksStillOpen = 0;
  const pairs = pairCardsByIdentity(initialOpponent.field, finalOpponent.field);

  pairs.forEach(({ initial, final }) => {
    if (!isMonster(initial) || !isMonster(final)) return;
    if (initial.position === final.position) return;
    if (initial.position === "attack" && final.position === "defense") {
      toDefense += 1;
    } else if (initial.position === "defense" && final.position === "attack") {
      toAttack += 1;
    }
  });

  safeArray(finalOpponent.field).forEach((card) => {
    if (isMonster(card) && card.position === "attack" && !card.cannotAttackThisTurn) {
      attacksStillOpen += 1;
    }
  });

  return { toDefense, toAttack, attacksStillOpen };
}

function getLineImpact(context = {}) {
  const initialState = context.initialState || {};
  const finalState = context.finalState || {};
  const sequence = safeArray(context.sequence);
  const profile = context.profile || context.planningContext?.profile || {};
  const initialBot = getBotState(initialState);
  const finalBot = getBotState(finalState);
  const initialOpponent = getOpponentState(initialState);
  const finalOpponent = getOpponentState(finalState);
  const positionImpact = getPositionImpact(initialOpponent, finalOpponent);
  const initialThreat = getStrongestBattleThreat(initialOpponent.field || []);
  const finalThreat = getStrongestBattleThreat(finalOpponent.field || []);
  const initialAttackThreat = getStrongestAttackThreat(initialOpponent.field || []);
  const finalAttackThreat = getStrongestAttackThreat(finalOpponent.field || []);
  const removedOpponentCards =
    countOpponentCards(initialOpponent) - countOpponentCards(finalOpponent);
  const opponentStatReduction = Math.max(
    0,
    totalRawMonsterStats(initialOpponent.field) -
      totalRawMonsterStats(finalOpponent.field),
  );
  const mirageboundGyDelta =
    countMirageboundZones(initialBot, ["graveyard"]) -
    countMirageboundZones(finalBot, ["graveyard"]);
  const mirageboundHandDelta =
    countMirageboundZones(finalBot, ["hand"]) -
    countMirageboundZones(initialBot, ["hand"]);
  const hasFinalDefense = getCards(finalBot, ["hand", "spellTrap"]).some((card) =>
    DEFENSIVE_CARD_NAMES.has(cardName(card)),
  );
  const hasFinalSovereign = hasCard(finalBot, ["field"], MB.GLASS_SOVEREIGN);
  const hasFinalLeviathan = hasCard(finalBot, ["field"], MB.DESERT_LEVIATHAN);
  const hasInitialScout = hasCard(initialBot, ["field"], MB.SCOUT);
  const hasFinalScout = hasCard(finalBot, ["field"], MB.SCOUT);
  const usedLeviathanProcedure = sequenceUsesExtraDeckProcedure(
    sequence,
    MB.DESERT_LEVIATHAN,
  );
  const unsupportedCount = safeArray(finalState._simUnsupportedActions).length;

  return {
    sequence,
    profile,
    initialBot,
    finalBot,
    initialOpponent,
    finalOpponent,
    removedOpponentCards,
    initialThreat,
    finalThreat,
    threatReduction: Math.max(0, initialThreat - finalThreat),
    initialAttackThreat,
    finalAttackThreat,
    attackThreatReduction: Math.max(0, initialAttackThreat - finalAttackThreat),
    opponentStatReduction,
    positionImpact,
    initialOpponentMonsterCount: safeArray(initialOpponent.field).filter(isMonster).length,
    finalOpponentMonsterCount: safeArray(finalOpponent.field).filter(isMonster).length,
    usedBounceSource: actionUsesAny(sequence, BOUNCE_SOURCE_NAMES),
    usedVanishingStep: actionUsesName(sequence, MB.VANISHING_STEP),
    usedMirrorPath: actionUsesName(sequence, MB.MIRROR_PATH),
    usedHeatHaze: actionUsesName(sequence, MB.HEAT_HAZE),
    usedOasis: actionUsesName(sequence, MB.OASIS),
    usedLeviathanProcedure,
    leviathanUsedScoutMaterial: sequenceProcedureUsesMaterial(
      sequence,
      MB.DESERT_LEVIATHAN,
      MB.SCOUT,
    ),
    usedScoutStarter: sequenceHasScoutStarter(sequence),
    usedBattle: sequenceHasBattle(sequence),
    positionActionCount: sequence.filter((action) => sequenceHasPositionAction([action])).length,
    mirageboundGyDelta,
    mirageboundHandDelta,
    hasFinalDefense,
    hasFinalSovereign,
    hasFinalLeviathan,
    hasInitialScout,
    hasFinalScout,
    unsupportedCount,
    finalDirectDamage:
      Math.max(0, Number(initialOpponent.lp || 0) - Number(finalOpponent.lp || 0)),
    initialLethalDanger: opponentThreatensLethal(initialBot, initialOpponent),
    finalLethalDanger: opponentThreatensLethal(finalBot, finalOpponent),
    realPayoff: false,
  };
}

function addMilestone(list, label, score, detail = null) {
  if (!Number.isFinite(score) || score === 0) return;
  list.push({ label, score, detail });
}

function getFinalMirageboundSpellTrapAccess(initialBot = {}, finalBot = {}) {
  const initialNames = new Map();
  getCards(initialBot, ["hand", "spellTrap", "fieldSpell"]).forEach((card) => {
    const name = cardName(card);
    if (!name) return;
    initialNames.set(name, (initialNames.get(name) || 0) + 1);
  });

  return getCards(finalBot, ["hand", "spellTrap", "fieldSpell"]).some((card) => {
    const name = cardName(card);
    if (!MIRAGEBOUND_SPELL_TRAPS.has(name)) return false;
    const previous = initialNames.get(name) || 0;
    initialNames.set(name, Math.max(0, previous - 1));
    return previous <= 0 || name === MB.OASIS;
  });
}

function scoreEngineMilestones(entries, impact) {
  const { initialBot, finalBot, profile } = impact;

  if (!hasCard(initialBot, ["fieldSpell"], MB.OASIS) && hasCard(finalBot, ["fieldSpell"], MB.OASIS)) {
    addMilestone(entries, "Oasis engine established", 5);
  }
  if (impact.usedScoutStarter) {
    addMilestone(entries, "Scout normal summon starter", 3.5);
    if (getFinalMirageboundSpellTrapAccess(initialBot, finalBot)) {
      addMilestone(entries, "Scout converted into Spell/Trap access", 3.5);
    }
  }
  if (impact.hasFinalSovereign) {
    addMilestone(entries, "Glass Sovereign online", 7);
  }
  if (impact.hasFinalLeviathan) {
    const wideBonus = impact.initialOpponentMonsterCount >= 2 ? 4 : 0;
    addMilestone(entries, "Desert Leviathan online", 5.5 + wideBonus);
    if (
      impact.usedLeviathanProcedure &&
      impact.initialOpponentMonsterCount >= 2 &&
      impact.sequence[0]?.type === "extraDeckProcedure" &&
      actionName(impact.sequence[0]) === MB.DESERT_LEVIATHAN
    ) {
      addMilestone(entries, "immediate Leviathan wide-board conversion", 6);
    } else if (
      impact.usedLeviathanProcedure &&
      impact.initialOpponentMonsterCount >= 2
    ) {
      addMilestone(entries, "delayed Leviathan against wide board", -8);
    }
  }
  if (
    profile?.scoutReadyForAscension &&
    impact.hasInitialScout &&
    !impact.hasFinalScout &&
    !impact.hasFinalSovereign &&
    !(impact.hasFinalLeviathan && impact.initialOpponentMonsterCount >= 2)
  ) {
    addMilestone(entries, "spent ready Scout before Ascension", -9);
  } else if (
    profile?.scoutNearAscension &&
    impact.hasInitialScout &&
    !impact.hasFinalScout &&
    !impact.hasFinalSovereign &&
    !(impact.hasFinalLeviathan && impact.initialOpponentMonsterCount >= 2)
  ) {
    addMilestone(entries, "bounced Scout near Ascension", -5.5);
  }
  if (
    impact.usedLeviathanProcedure &&
    impact.leviathanUsedScoutMaterial &&
    (profile?.scoutReadyForAscension || profile?.scoutNearAscension) &&
    !impact.hasFinalSovereign &&
    impact.initialOpponentMonsterCount <= 1 &&
    impact.removedOpponentCards <= 0 &&
    !impact.initialLethalDanger
  ) {
    addMilestone(
      entries,
      profile?.scoutReadyForAscension
        ? "spent ready Scout for Leviathan"
        : "spent near-Ascension Scout for Leviathan",
      profile?.scoutReadyForAscension ? -9 : -5.5,
    );
  }
}

function scoreBounceMilestones(entries, impact) {
  if (!impact.usedBounceSource) return;

  const finalFieldNames = new Set(
    getCards(impact.finalBot, ["field"]).map(cardName).filter(Boolean),
  );
  if (finalFieldNames.has(MB.GLASS_VIPER)) {
    addMilestone(entries, "bounce line kept Viper pressure", 4.5);
  }
  if (finalFieldNames.has(MB.JACKAL)) {
    addMilestone(entries, "bounce triggered Jackal body", 3.5);
  }
  if (impact.mirageboundGyDelta > 0 && impact.mirageboundHandDelta >= 0) {
    addMilestone(entries, "Priestess recovered Miragebound resource", 4);
  }
  if (impact.opponentStatReduction >= 400) {
    addMilestone(
      entries,
      "bounce converted into debuff",
      clamp(impact.opponentStatReduction / 350, 1.5, 5),
    );
  }
  if (
    impact.usedBounceSource &&
    finalFieldNames.has(MB.GLASS_VIPER) &&
    safeArray(impact.finalBot.field).length >= 5 &&
    hasCard(impact.finalBot, ["hand"], MB.JACKAL)
  ) {
    addMilestone(entries, "field clogged before Jackal payoff", -2.5);
  }
}

function scoreControlMilestones(entries, impact) {
  const { positionImpact } = impact;
  if (positionImpact.toDefense > 0) {
    addMilestone(entries, "shifted attackers to Defense", positionImpact.toDefense * 2.2);
  }
  if (impact.usedLeviathanProcedure && positionImpact.toDefense >= 2) {
    addMilestone(entries, "Leviathan shifted wide board", 4 + positionImpact.toDefense);
  }
  if (impact.threatReduction >= 500) {
    addMilestone(
      entries,
      "reduced top battle threat",
      clamp(impact.threatReduction / 450, 1.5, 6),
    );
  }
  if (impact.attackThreatReduction >= 500) {
    addMilestone(
      entries,
      "reduced attack pressure",
      clamp(impact.attackThreatReduction / 500, 1.2, 4.5),
    );
  }
  if (impact.opponentStatReduction >= 500 && !impact.usedBounceSource) {
    addMilestone(
      entries,
      "stacked Miragebound debuffs",
      clamp(impact.opponentStatReduction / 450, 1.5, 5),
    );
  }
  if (positionImpact.toAttack > 0 && impact.removedOpponentCards <= 0) {
    const improvedThreat =
      impact.finalThreat > impact.initialThreat + 300 ||
      impact.finalAttackThreat > impact.initialAttackThreat + 300;
    addMilestone(
      entries,
      improvedThreat
        ? "position switch improved opponent combat"
        : "position switch opened attack target",
      improvedThreat ? -4 : 1.5,
    );
  }
  if (
    impact.positionActionCount >= 2 &&
    positionImpact.toDefense === 0 &&
    impact.threatReduction < 300 &&
    impact.removedOpponentCards <= 0
  ) {
    addMilestone(entries, "double switch without net control", -3.5);
  }
}

function scoreResourceMilestones(entries, impact) {
  if (impact.usedHeatHaze) {
    if (impact.mirageboundGyDelta > 0 && impact.positionImpact.toDefense > 0) {
      addMilestone(entries, "Heat Haze recovered resource and stopped attacker", 5);
    } else if (impact.mirageboundGyDelta > 0) {
      addMilestone(entries, "Heat Haze recovered Miragebound resource", 3.5);
    } else if (impact.positionImpact.toDefense === 0 && impact.threatReduction < 300) {
      addMilestone(entries, "Heat Haze without clear recovery window", -3);
    }
  }
  if (impact.removedOpponentCards > 0) {
    addMilestone(
      entries,
      "removed opponent cards",
      clamp(impact.removedOpponentCards * 2.5, 2.5, 7),
    );
  }
  if (impact.finalDirectDamage > 0) {
    addMilestone(
      entries,
      "converted line into damage",
      clamp(impact.finalDirectDamage / 700, 1, 5),
    );
  }
}

function scoreBattleMilestones(entries, impact) {
  safeArray(impact.sequence)
    .filter((action) => action?.type === "simulatedBattle")
    .forEach((battle) => {
      const destroyedOpponent = safeArray(battle.destroyedCards).some(
        (entry) => entry?.owner === "opponent",
      );
      const destroyedSelf = safeArray(battle.destroyedCards).some(
        (entry) => entry?.owner === "self",
      );
      if (destroyedOpponent) {
        addMilestone(entries, "battle removed a threat", 3.5);
      }
      if (Number(battle.damage || 0) > 0) {
        addMilestone(
          entries,
          battle.attackerName === MB.GLASS_SOVEREIGN
            ? "Glass Sovereign piercing pressure"
            : "battle pressure",
          clamp(Number(battle.damage || 0) / 600, 1, 6),
        );
      }
      if (destroyedSelf && !destroyedOpponent) {
        addMilestone(entries, "lost attacker without battle payoff", -4.5);
      }
    });
}

function scoreDefenseAndRiskMilestones(entries, impact) {
  const hasRealPayoff = impact.realPayoff;
  if (impact.initialLethalDanger && !impact.finalLethalDanger) {
    addMilestone(entries, "removed lethal danger", 7);
  }
  if (impact.finalLethalDanger) {
    addMilestone(entries, "ended exposed to lethal", -8);
  }
  if (impact.profile?.needsBattleProtection && impact.hasFinalDefense) {
    addMilestone(entries, "preserved defensive card under pressure", 2.5);
  }
  if (impact.usedVanishingStep && !hasRealPayoff) {
    addMilestone(entries, "spent Vanishing Step without payoff", -4);
  }
  if (
    impact.usedMirrorPath &&
    impact.profile?.mirrorPathIsOnlyBattleProtection &&
    !hasRealPayoff
  ) {
    addMilestone(entries, "spent only Mirror Path protection", -5.5);
  }
  if (
    safeArray(impact.finalBot.field).length === 0 &&
    safeArray(impact.finalOpponent.field).some(isMonster)
  ) {
    addMilestone(entries, "ended with empty board under pressure", -5);
  }
  if (impact.sequence.length >= 5 && !hasRealPayoff) {
    addMilestone(entries, "long line without payoff", -3.5);
  }
  if (impact.unsupportedCount > 0) {
    addMilestone(entries, "line used unsupported simulated action", -8);
  }
  if (
    impact.usedLeviathanProcedure &&
    impact.initialOpponentMonsterCount <= 1 &&
    impact.removedOpponentCards <= 0 &&
    impact.finalDirectDamage <= 0 &&
    !impact.initialLethalDanger
  ) {
    addMilestone(entries, "Leviathan into single target without payoff", -6);
  }
}

function finalizeImpactPayoff(impact) {
  impact.realPayoff =
    impact.hasFinalSovereign ||
    (impact.hasFinalLeviathan && impact.initialOpponentMonsterCount >= 2) ||
    impact.removedOpponentCards > 0 ||
    impact.threatReduction >= 500 ||
    impact.attackThreatReduction >= 500 ||
    impact.opponentStatReduction >= 600 ||
    impact.mirageboundGyDelta > 0 ||
    impact.usedBattle ||
    Number(impact.finalDirectDamage || 0) > 0;
  return impact;
}

function formatMilestone(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  const sign = entry.score > 0 ? "+" : "";
  return `${sign}${Number(entry.score.toFixed(1))} ${entry.label}`;
}

function collectPlanningReasons(analysis = {}) {
  const hand = safeArray(analysis.hand);
  const field = safeArray(analysis.field);
  const reasons = [];

  if (!analysis.hasOasisActive && hasName(hand, MB.OASIS)) {
    reasons.push("Oasis starter available");
  }
  if (analysis.canNormalSummon && hasName(hand, MB.SCOUT)) {
    reasons.push("Scout starter available");
  }
  if (analysis.hasMeaningfulBounce) {
    reasons.push("bounce payoff is live");
  }
  if (analysis.hasPriestessBouncePayoff) {
    reasons.push("Priestess recursion line is live");
  }
  if (analysis.hasHeatHazeRecoveryLine) {
    reasons.push("Heat Haze recovery line is live");
  }
  if (analysis.oppPressure || analysis.needsBattleProtection) {
    reasons.push("battle pressure needs planning");
  }
  if (analysis.scoutReadyForAscension || analysis.hasSovereignInField) {
    reasons.push("Glass Sovereign window is live");
  }
  if (analysis.hasLeviathanLine || analysis.hasLeviathanMaterials) {
    reasons.push("Desert Leviathan contact fusion is live");
  }
  if (field.some((card) => cardName(card) === MB.GLASS_SOVEREIGN)) {
    reasons.push("Sovereign battle conversion available");
  }

  return reasons;
}

function hasBattleBridgeSignal(analysis = {}) {
  const phase = String(analysis.phase || "").toLowerCase();
  if (phase && phase !== "main" && phase !== "main1") return false;
  const readyAttack = totalVisibleAttack(analysis.field || []);
  if (readyAttack <= 0) return false;
  const opponent = analysis.opponent || {};
  const opponentField = safeArray(analysis.oppField || opponent.field);
  const opponentLp = Number(opponent.lp || analysis.oppLP || 8000);
  if (readyAttack >= opponentLp) return true;
  if (analysis.hasSovereignInField && opponentField.some((card) => card?.position === "defense")) {
    return true;
  }
  if ((analysis.hasLeviathanLine || analysis.hasLeviathanMaterials) && opponentField.length >= 2) {
    return true;
  }
  if (analysis.hasMeaningfulBounce || analysis.hasHeatHazeRecoveryLine) {
    return opponentField.length > 0;
  }
  return opponentField.some((target) =>
    safeArray(analysis.readyAttackers).some(
      (attacker) => getEffectiveAtk(attacker) > getBattleStatForAttackTarget(target),
    ),
  );
}

export function buildMirageboundPlanningProfile(analysis = {}, context = {}) {
  const game = context.game || analysis.game || {};
  const phase = String(analysis.phase || game.phase || "main1").toLowerCase();
  const manual = game?.turnLineSearchEnabled === true;
  const reasons = collectPlanningReasons(analysis);
  const battleBridge = hasBattleBridgeSignal({
    ...analysis,
    phase,
  });
  if (battleBridge) reasons.push("battle bridge can convert Miragebound control");

  const enabled = manual || reasons.length > 0;
  const requestedTurnMode = game?.turnLineSearchTurnMode;

  return {
    ...DEFAULT_PROFILE,
    enabled,
    mode: manual && reasons.length === 0 ? "manual" : enabled ? "critical" : "off",
    turnMode: requestedTurnMode || (battleBridge ? "mainBattleMain2" : "mainOnly"),
    beamWidth: Number.isFinite(game?.turnLineSearchBeamWidth)
      ? game.turnLineSearchBeamWidth
      : DEFAULT_PROFILE.beamWidth,
    maxDepth: Number.isFinite(game?.turnLineSearchMaxDepth)
      ? game.turnLineSearchMaxDepth
      : phase.includes("main2")
        ? 3
        : DEFAULT_PROFILE.maxDepth,
    nodeBudget: Number.isFinite(game?.turnLineSearchNodeBudget)
      ? game.turnLineSearchNodeBudget
      : DEFAULT_PROFILE.nodeBudget,
    candidateLimit: Number.isFinite(game?.turnLineSearchCandidateLimit)
      ? game.turnLineSearchCandidateLimit
      : DEFAULT_PROFILE.candidateLimit,
    battleStepLimit: Number.isFinite(game?.turnLineSearchBattleStepLimit)
      ? game.turnLineSearchBattleStepLimit
      : DEFAULT_PROFILE.battleStepLimit,
    reasons,
    critical: reasons.length > 0,
    scoutNearAscension: !!analysis.scoutNearAscension,
    scoutReadyForAscension: !!analysis.scoutReadyForAscension,
    needsBattleProtection: !!analysis.needsBattleProtection,
    mirrorPathIsOnlyBattleProtection: !!analysis.mirrorPathIsOnlyBattleProtection,
    hasMeaningfulBounce: !!analysis.hasMeaningfulBounce,
    hasHeatHazeRecoveryLine: !!analysis.hasHeatHazeRecoveryLine,
    hasLeviathanLine: !!analysis.hasLeviathanLine,
    hasLeviathanMaterials: !!analysis.hasLeviathanMaterials,
  };
}

export function scoreMirageboundLineMilestones(context = {}) {
  const impact = finalizeImpactPayoff(getLineImpact(context));
  const entries = [];

  scoreEngineMilestones(entries, impact);
  scoreBounceMilestones(entries, impact);
  scoreControlMilestones(entries, impact);
  scoreResourceMilestones(entries, impact);
  scoreBattleMilestones(entries, impact);
  scoreDefenseAndRiskMilestones(entries, impact);

  entries.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  const rawScore = entries.reduce((sum, entry) => sum + entry.score, 0);
  const cap = impact.profile?.critical ? 16 : 12;

  return {
    scoreDelta: clamp(rawScore, -cap, cap),
    milestones: entries.slice(0, 8),
    details: {
      removedOpponentCards: impact.removedOpponentCards,
      threatReduction: impact.threatReduction,
      attackThreatReduction: impact.attackThreatReduction,
      opponentStatReduction: impact.opponentStatReduction,
      mirageboundGyDelta: impact.mirageboundGyDelta,
      finalLethalDanger: impact.finalLethalDanger,
      realPayoff: impact.realPayoff,
    },
  };
}

export function scoreMirageboundLineTerminal(context = {}) {
  const finalBot = getBotState(context.finalState || {});
  const finalOpponent = getOpponentState(context.finalState || {});
  if ((finalBot.lp || 0) <= 0) return -10000;
  if ((finalOpponent.lp || 0) <= 0) return 10000;

  const baseScore = Number(context.baseScore ?? context.finalScore ?? 0);
  const profile = context.profile || context.planningContext?.profile || {};
  const milestoneCap = profile.critical ? 16 : 12;
  const milestoneScore = clamp(
    Number(context.milestoneScore || 0),
    -milestoneCap,
    milestoneCap,
  );
  let terminalScore = 0;

  if (opponentThreatensLethal(finalBot, finalOpponent)) terminalScore -= 8;
  if (
    safeArray(finalBot.field).length === 0 &&
    safeArray(finalOpponent.field).some(isMonster)
  ) {
    terminalScore -= 4;
  }
  if (
    profile.needsBattleProtection &&
    getCards(finalBot, ["hand", "spellTrap"]).some((card) =>
      DEFENSIVE_CARD_NAMES.has(cardName(card)),
    )
  ) {
    terminalScore += 2;
  }
  if (hasCard(finalBot, ["field"], MB.GLASS_SOVEREIGN)) {
    terminalScore += 3;
  }
  if (hasCard(finalBot, ["field"], MB.DESERT_LEVIATHAN)) {
    terminalScore += profile.hasLeviathanLine ? 2.5 : 1.5;
  }

  return baseScore + milestoneScore + clamp(terminalScore, -10, 8);
}

export function describeMirageboundPlannedLine(context = {}) {
  const sequence = safeArray(context.sequence);
  const steps = sequence.map(actionLabel).filter(Boolean);
  const milestones = safeArray(context.milestones)
    .map(formatMilestone)
    .filter(Boolean)
    .slice(0, 6);

  if (!steps.length) return "Miragebound planner found no actionable line";
  return `Miragebound planned line: ${steps.join(" -> ")}${
    milestones.length ? ` | Milestones: ${milestones.join(", ")}` : ""
  }`;
}

export function scoreMirageboundBattleAttackCandidate({
  attacker,
  target,
  lethalNow,
  attackerSurvived,
  targetSurvived,
  isSecondAttack,
  summary,
} = {}) {
  let score = 0;
  const damage = Math.max(0, Number(summary?.damage || 0));
  const destroyedOpponent = safeArray(summary?.destroyedCards).some(
    (entry) => entry?.owner === "opponent",
  );
  const destroyedSelf = safeArray(summary?.destroyedCards).some(
    (entry) => entry?.owner === "self",
  );

  if (lethalNow) score += 30;
  if (destroyedOpponent) score += 3.5;
  if (damage > 0) score += clamp(damage / 600, 1, 5);
  if (attacker?.name === MB.GLASS_SOVEREIGN && target?.position === "defense") {
    score += damage > 0 ? 5 : 2;
  }
  if (attacker?.name === MB.DESERT_LEVIATHAN && destroyedOpponent) {
    score += 2.5;
  }
  if (attackerSurvived) score += 0.8;
  if (isSecondAttack) score += 1;
  if (destroyedSelf && !destroyedOpponent) score -= 5;
  if (targetSurvived && target && getEffectiveAtk(target) >= getEffectiveAtk(attacker)) {
    score -= 2.5;
  }

  return score;
}
