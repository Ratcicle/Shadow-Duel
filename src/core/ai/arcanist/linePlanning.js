import {
  getEffectiveAtk,
  getEffectiveDef,
  getStrongestAttackThreat,
  getStrongestBattleThreat,
} from "../common/cardStats.js";
import {
  ARCANIST_NAMES,
  controlsArcanistEquip,
  getInkCounters,
  hasArcanistEquip,
  isArcanistEquip,
  isArcanistMonster,
  isArcanistSpell,
} from "./knowledge.js";

const DEFAULT_PROFILE = {
  enabled: false,
  mode: "off",
  turnMode: "mainOnly",
  beamWidth: 3,
  maxDepth: 4,
  nodeBudget: 180,
  candidateLimit: 6,
  reasons: [],
};

function getPlayer(state) {
  return state?.bot || state?.player || {};
}

function getOpponent(state) {
  return state?.player || {};
}

function faceUpArcanists(player) {
  return (player?.field || []).filter(
    (card) => isArcanistMonster(card) && !card.isFacedown,
  );
}

function hasName(cards = [], name) {
  return (cards || []).some((card) => card?.name === name);
}

function countOpponentCards(player) {
  return (
    (player?.field || []).filter(Boolean).length +
    (player?.spellTrap || []).filter(Boolean).length +
    (player?.fieldSpell ? 1 : 0)
  );
}

function getAttackDamage(field = []) {
  return (field || []).reduce((sum, card) => {
    if (!card || card.cardKind !== "monster") return sum;
    if (card.isFacedown || card.position === "defense") return sum;
    if (card.cannotAttackThisTurn) return sum;
    return sum + getEffectiveAtk(card);
  }, 0);
}

function opponentThreatensLethal(stateOrAnalysis = {}) {
  const player = stateOrAnalysis.bot || stateOrAnalysis.player || {};
  const lp = player.lp || stateOrAnalysis.lp || 0;
  if (lp <= 0) return true;
  const field =
    stateOrAnalysis.oppField ||
    stateOrAnalysis.opponent?.field ||
    stateOrAnalysis.player?.field ||
    [];
  return getAttackDamage(field) >= lp;
}

function isMain1Phase(phase) {
  return !phase || phase === "main1" || phase === "main";
}

function hasStarterAccess(analysis = {}) {
  const hand = analysis.hand || [];
  const meetingInHand = hasName(hand, ARCANIST_NAMES.MEETING) && hand.length >= 4;
  return (
    hasName(hand, ARCANIST_NAMES.GRAND_LIBRARY) ||
    hasName(hand, ARCANIST_NAMES.APPRENTICE) ||
    meetingInHand ||
    analysis.fieldSpell?.name === ARCANIST_NAMES.GRAND_LIBRARY ||
    hasName(analysis.spellTrap || [], ARCANIST_NAMES.MEETING) ||
    ((analysis.inkRiverCounters || 0) >= 2 &&
      (analysis.arcanistSpellsInGY || 0) > 0)
  );
}

function hasVisiblePayoff(analysis = {}) {
  const hand = analysis.hand || [];
  const field = analysis.field || [];
  const spellTrap = analysis.spellTrap || [];
  const hasElementalist =
    hasName(hand, ARCANIST_NAMES.ELEMENTALIST) ||
    hasName(field, ARCANIST_NAMES.ELEMENTALIST);
  const hasAzrath =
    hasName(hand, ARCANIST_NAMES.AZRATH) || hasName(field, ARCANIST_NAMES.AZRATH);
  const hasGrimoireAccess =
    hasName(hand, ARCANIST_NAMES.GRIMOIRE) ||
    hasName(spellTrap, ARCANIST_NAMES.GRIMOIRE) ||
    analysis.fieldSpell?.name === ARCANIST_NAMES.GRAND_LIBRARY;
  const hasSeismicLine =
    hasName(hand, ARCANIST_NAMES.SEISMIC_IMPACT) &&
    controlsArcanistEquip(analysis.player) &&
    countOpponentCards({
      field: analysis.oppField,
      spellTrap: analysis.oppSpellTrap,
      fieldSpell: analysis.oppFieldSpell,
    }) > 0;
  const hasHighCombo = (analysis.availableCombos || []).some(
    (combo) => (combo?.priority || 0) >= 13,
  );

  return (
    hasElementalist ||
    (hasAzrath && hasGrimoireAccess) ||
    hasSeismicLine ||
    analysis.fieldSpell?.name === ARCANIST_NAMES.GRAND_LIBRARY ||
    hasHighCombo
  );
}

function getOwnStrongestBattle(analysis = {}) {
  return getStrongestBattleThreat(analysis.field || [], {
    includeBoosts: true,
  });
}

export function buildArcanistPlanningProfile(analysis = {}, context = {}) {
  const game = context.game || analysis.game || null;
  const manual = game?.turnLineSearchEnabled === true;
  const phase = analysis.phase || game?.phase || "main1";
  const reasons = [];
  const lp = analysis.lp || analysis.player?.lp || 0;
  const oppField = analysis.oppField || [];
  const oppStrongestAtk =
    analysis.oppStrongestAtk ||
    getStrongestAttackThreat(oppField, { includeBoosts: true });
  const oppStrongestBattle =
    analysis.oppStrongestBattle ||
    getStrongestBattleThreat(oppField, { includeBoosts: true });
  const ownStrongestBattle = getOwnStrongestBattle(analysis);
  const hasOppMonster = oppField.some((card) => card?.cardKind === "monster");
  const weakOrEmptyField =
    faceUpArcanists(analysis.player).length === 0 ||
    ownStrongestBattle + 400 < oppStrongestBattle;

  if (opponentThreatensLethal(analysis) || oppStrongestAtk >= lp) {
    reasons.push("opponent threatens lethal");
  }
  if (lp <= 3000 && hasOppMonster) {
    reasons.push("low LP under pressure");
  }
  if (oppStrongestBattle >= 2400 && ownStrongestBattle < oppStrongestBattle) {
    reasons.push("large threat exceeds current board");
  }
  if (weakOrEmptyField && hasStarterAccess(analysis)) {
    reasons.push("starter access can repair weak board");
  }
  if (hasVisiblePayoff(analysis)) {
    reasons.push("high payoff line visible");
  }

  const enabled = manual || reasons.length > 0;
  const requestedTurnMode = game?.turnLineSearchTurnMode;
  const turnMode =
    requestedTurnMode ||
    (enabled && isMain1Phase(phase) ? "mainBattleMain2" : "mainOnly");
  return {
    ...DEFAULT_PROFILE,
    enabled,
    mode: manual && reasons.length === 0 ? "manual" : enabled ? "critical" : "off",
    turnMode,
    maxDepth: phase === "main2" ? 3 : DEFAULT_PROFILE.maxDepth,
    nodeBudget:
      phase === "main2"
        ? 120
        : turnMode === "mainBattleMain2"
          ? 220
          : DEFAULT_PROFILE.nodeBudget,
    reasons,
  };
}

function getEquippedHosts(player, name = null) {
  return faceUpArcanists(player).filter((card) => {
    if (name && card.name !== name) return false;
    return hasArcanistEquip(card);
  });
}

function cardInstanceKey(card, fallbackIndex = 0) {
  return `${card?.instanceId || card?.uuid || card?.id || card?.name || "card"}:${fallbackIndex}`;
}

function collectEquips(player) {
  const equips = [];
  (player?.spellTrap || []).forEach((card, index) => {
    if (card && isArcanistEquip(card)) {
      equips.push({ card, key: cardInstanceKey(card, index) });
    }
  });
  (player?.field || []).forEach((host, hostIndex) => {
    (host?.equips || []).forEach((equip, equipIndex) => {
      if (equip && isArcanistEquip(equip)) {
        equips.push({
          card: equip,
          key: cardInstanceKey(equip, `${hostIndex}:${equipIndex}`),
        });
      }
    });
  });
  const seen = new Set();
  return equips.filter((entry) => {
    if (seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
}

function getArcanistEquipCount(player) {
  return collectEquips(player).filter((entry) => !entry.card?.isFacedown).length;
}

function getInkRiverValue(player) {
  return (player?.spellTrap || []).reduce((best, card) => {
    if (card?.name !== ARCANIST_NAMES.INK_RIVER || card.isFacedown) return best;
    return Math.max(best, getInkCounters(card));
  }, 0);
}

function getRecoverableSpellCount(player) {
  return (player?.graveyard || []).filter(isArcanistSpell).length;
}

function getActionNames(sequence = []) {
  return (sequence || [])
    .map((action) => action?.cardName || action?.card?.name || action?.name)
    .filter(Boolean);
}

function getActionTypes(sequence = []) {
  return (sequence || [])
    .map((action) => action?.type)
    .filter(Boolean);
}

function getSimulatedBattleSteps(sequence = []) {
  return (sequence || []).filter((action) => action?.type === "simulatedBattle");
}

function lineUsed(actionNames, name) {
  return actionNames.includes(name);
}

function hasUsefulMeetingResult(finalPlayer) {
  return [
    ARCANIST_NAMES.ALBUS,
    ARCANIST_NAMES.GRIMOIRE,
    ARCANIST_NAMES.GRAND_LIBRARY,
    ARCANIST_NAMES.ELEMENTALIST,
    ARCANIST_NAMES.AZRATH,
  ].some((name) => hasName(finalPlayer?.hand || [], name));
}

function getActiveCardCount(player) {
  return (
    (player?.hand || []).filter(Boolean).length +
    (player?.field || []).filter(Boolean).length +
    (player?.spellTrap || []).filter(Boolean).length +
    (player?.fieldSpell ? 1 : 0)
  );
}

function getArcanistActiveCardCount(player) {
  const cards = [
    ...(player?.hand || []),
    ...(player?.field || []),
    ...(player?.spellTrap || []),
    player?.fieldSpell,
  ].filter(Boolean);
  return cards.filter((card) => isArcanistMonster(card) || isArcanistSpell(card))
    .length;
}

function getEquippedGrimoireHosts(player) {
  return faceUpArcanists(player).filter((card) =>
    (card?.equips || []).some((equip) => equip?.name === ARCANIST_NAMES.GRIMOIRE),
  );
}

function getGrimoireHostScore(host) {
  switch (host?.name) {
    case ARCANIST_NAMES.ELEMENTALIST:
      return 6;
    case ARCANIST_NAMES.AZRATH:
      return 4.5;
    case ARCANIST_NAMES.MASTER_OF_MIRRORS:
    case ARCANIST_NAMES.APPRENTICE:
      return 3;
    case ARCANIST_NAMES.VIRIDIS:
    case ARCANIST_NAMES.ALBUS:
    case ARCANIST_NAMES.TERA:
      return 2;
    default:
      return host ? 1 : 0;
  }
}

function getProtectionSignals(player) {
  const arcanists = faceUpArcanists(player);
  const protectedMonsters = arcanists.filter(
    (card) =>
      card.battleIndestructible ||
      card.tempBattleIndestructible ||
      card.cannotBeDestroyedByBattle ||
      card.cannotBeDestroyedByCardEffects ||
      card.immuneToOpponentEffectsUntilTurn ||
      card.destructionReplacement ||
      card.protectedFromDestruction,
  );
  const replacementEffects = (player?.replacementEffects || []).length;
  return {
    protectedMonsters,
    count: protectedMonsters.length + replacementEffects,
  };
}

function opponentSummary(state) {
  const opponent = getOpponent(state);
  return {
    cards: countOpponentCards(opponent),
    monsters: (opponent.field || []).filter(
      (card) => card?.cardKind === "monster",
    ).length,
    strongestBattle: getStrongestBattleThreat(opponent.field || [], {
      includeBoosts: true,
    }),
    strongestAttack: getStrongestAttackThreat(opponent.field || [], {
      includeBoosts: true,
    }),
    banished: (opponent.banished || []).length,
  };
}

function getLineImpact(context = {}) {
  const initialPlayer = getPlayer(context.initialState);
  const finalPlayer = getPlayer(context.finalState);
  const initialOpponent = getOpponent(context.initialState);
  const finalOpponent = getOpponent(context.finalState);
  const sequence = context.sequence || [];
  const actionNames = getActionNames(sequence);
  const actionTypes = getActionTypes(sequence);
  const simulatedBattles = getSimulatedBattleSteps(sequence);
  const simulatedBattleDamage = simulatedBattles.reduce(
    (sum, battle) => sum + Math.max(0, Number(battle.damage || 0)),
    0,
  );
  const simulatedBattleRemovedOpponent = simulatedBattles.reduce(
    (sum, battle) =>
      sum +
      (battle.destroyedCards || []).filter((entry) => entry?.owner === "opponent")
        .length,
    0,
  );
  const simulatedBattleLostSelf = simulatedBattles.reduce(
    (sum, battle) =>
      sum +
      (battle.destroyedCards || []).filter((entry) => entry?.owner === "self")
        .length,
    0,
  );
  const simulatedLibraryRewards = simulatedBattles.reduce(
    (sum, battle) => sum + (battle.rewardNames || []).length,
    0,
  );
  const hasMain2AfterBattlePayoff = (() => {
    const battleIndex = sequence.findIndex(
      (action) => action?.type === "simulatedBattle",
    );
    if (battleIndex < 0) return false;
    return sequence.slice(battleIndex + 1).some((action) =>
      [
        ARCANIST_NAMES.GRIMOIRE,
        ARCANIST_NAMES.SEISMIC_IMPACT,
        ARCANIST_NAMES.CRIMSON_EXPLOSION,
        ARCANIST_NAMES.ICE_BARRIER,
        ARCANIST_NAMES.INK_RIVER,
      ].includes(action?.cardName || action?.card?.name || action?.name),
    );
  })();
  const initialOpp = opponentSummary(context.initialState);
  const finalOpp = opponentSummary(context.finalState);
  const removedCards = Math.max(0, initialOpp.cards - finalOpp.cards);
  const removedMonsters = Math.max(0, initialOpp.monsters - finalOpp.monsters);
  const battleReduction = Math.max(
    0,
    initialOpp.strongestBattle - finalOpp.strongestBattle,
  );
  const attackReduction = Math.max(
    0,
    initialOpp.strongestAttack - finalOpp.strongestAttack,
  );
  const banishedGain = Math.max(
    0,
    (finalOpponent.banished || []).length -
      (initialOpponent.banished || []).length,
  );
  const initialLethal = opponentThreatensLethal(context.initialState);
  const finalLethal = opponentThreatensLethal(context.finalState);
  const finalArcanists = faceUpArcanists(finalPlayer);
  const initialArcanists = faceUpArcanists(initialPlayer);
  const ownActiveDelta =
    getActiveCardCount(finalPlayer) - getActiveCardCount(initialPlayer);
  const arcanistActiveDelta =
    getArcanistActiveCardCount(finalPlayer) -
    getArcanistActiveCardCount(initialPlayer);
  const equipDelta =
    getArcanistEquipCount(finalPlayer) - getArcanistEquipCount(initialPlayer);
  const grimoireDelta =
    getEquippedGrimoireHosts(finalPlayer).length -
    getEquippedGrimoireHosts(initialPlayer).length;
  const lpDelta = (finalPlayer.lp || 0) - (initialPlayer.lp || 0);
  const protection = getProtectionSignals(finalPlayer);
  const hasEngine =
    finalPlayer.fieldSpell?.name === ARCANIST_NAMES.GRAND_LIBRARY ||
    getEquippedGrimoireHosts(finalPlayer).length > 0 ||
    (getInkRiverValue(finalPlayer) >= 2 &&
      getRecoverableSpellCount(finalPlayer) > 0);
  const hasRemoval =
    removedCards > 0 || banishedGain > 0 || battleReduction >= 500;
  const hasPressure =
    finalArcanists.some((card) => getEffectiveAtk(card) >= finalOpp.strongestBattle) ||
    finalOpp.cards === 0;
  const hasProtection = protection.count > 0;
  const fieldImproved =
    finalArcanists.length > initialArcanists.length ||
    ownActiveDelta > 0 ||
    arcanistActiveDelta > 0;

  return {
    initialPlayer,
    finalPlayer,
    initialOpponent,
    finalOpponent,
    sequence,
    actionNames,
    actionTypes,
    initialOpp,
    finalOpp,
    removedCards,
    removedMonsters,
    battleReduction,
    attackReduction,
    banishedGain,
    initialLethal,
    finalLethal,
    removedLethal: initialLethal && !finalLethal,
    finalArcanists,
    initialArcanists,
    ownActiveDelta,
    arcanistActiveDelta,
    equipDelta,
    grimoireDelta,
    lpDelta,
    protection,
    hasEngine,
    hasRemoval,
    hasPressure,
    hasProtection,
    fieldImproved,
    hasPayoff:
      hasEngine || hasRemoval || hasPressure || hasProtection || fieldImproved,
    usedLibrary: lineUsed(actionNames, ARCANIST_NAMES.GRAND_LIBRARY),
    usedMeeting: lineUsed(actionNames, ARCANIST_NAMES.MEETING),
    usedAlbus: lineUsed(actionNames, ARCANIST_NAMES.ALBUS),
    usedSeismic: lineUsed(actionNames, ARCANIST_NAMES.SEISMIC_IMPACT),
    usedCrimson: lineUsed(actionNames, ARCANIST_NAMES.CRIMSON_EXPLOSION),
    usedLightning: lineUsed(actionNames, ARCANIST_NAMES.LIGHTNING_LANCE),
    usedIceBarrier: lineUsed(actionNames, ARCANIST_NAMES.ICE_BARRIER),
    usedTera: lineUsed(actionNames, ARCANIST_NAMES.TERA),
    simulatedBattles,
    simulatedBattleDamage,
    simulatedBattleRemovedOpponent,
    simulatedBattleLostSelf,
    simulatedLibraryRewards,
    hasMain2AfterBattlePayoff,
  };
}

function addMilestone(entries, score, label) {
  if (!score || !label) return;
  entries.push({
    score,
    label,
    weight: Math.abs(score),
  });
}

function hasElementalistImpact(elementalist, impact) {
  if (!elementalist) return false;
  return (
    hasArcanistEquip(elementalist) ||
    impact.hasRemoval ||
    impact.hasProtection ||
    impact.removedLethal ||
    impact.finalOpp.cards === 0
  );
}

function scoreElementalistMilestones(entries, impact) {
  const finalElementalist = impact.finalArcanists.find(
    (card) => card.name === ARCANIST_NAMES.ELEMENTALIST,
  );
  if (!finalElementalist) return;

  addMilestone(entries, 2.5, "established Elementalist");
  const hasGrimoire = (finalElementalist.equips || []).some(
    (equip) => equip?.name === ARCANIST_NAMES.GRIMOIRE,
  );
  if (hasGrimoire) {
    addMilestone(entries, 6, "equipped Elementalist with Grimoire");
  } else if (hasArcanistEquip(finalElementalist)) {
    addMilestone(entries, 3.5, "equipped Elementalist");
  }
  if (
    impact.hasRemoval ||
    impact.removedLethal ||
    impact.hasProtection ||
    impact.finalOpp.cards === 0
  ) {
    addMilestone(entries, 2.5, "Elementalist stabilized board");
  }
  if (!hasElementalistImpact(finalElementalist, impact)) {
    addMilestone(entries, -2.5, "Elementalist ended without impact");
  }
}

function scoreGrimoireMilestones(entries, impact) {
  const hosts = getEquippedGrimoireHosts(impact.finalPlayer);
  hosts.forEach((host) => {
    const hostScore = getGrimoireHostScore(host);
    addMilestone(entries, hostScore, `Grimoire equipped to ${host.name}`);
  });
  if (impact.grimoireDelta > 0 && hosts.length === 0) {
    addMilestone(entries, 1.5, "advanced Grimoire engine");
  }
}

function scoreEngineMilestones(entries, impact) {
  const libraryWasActive =
    impact.initialPlayer.fieldSpell?.name === ARCANIST_NAMES.GRAND_LIBRARY;
  const libraryIsActive =
    impact.finalPlayer.fieldSpell?.name === ARCANIST_NAMES.GRAND_LIBRARY;
  if (libraryIsActive) {
    if (impact.usedLibrary || !libraryWasActive) {
      addMilestone(entries, 3, "activated Grand Library");
    } else {
      addMilestone(entries, 1.2, "kept Grand Library active");
    }
    if (impact.finalArcanists.length > impact.initialArcanists.length) {
      addMilestone(entries, 2.5, "Grand Library recruited body");
    }
  }

  if (
    getInkRiverValue(impact.finalPlayer) >= 2 &&
    getRecoverableSpellCount(impact.finalPlayer) > 0
  ) {
    addMilestone(entries, 2.5, "Ink River recovery online");
  }

  if (impact.usedMeeting) {
    if (
      hasUsefulMeetingResult(impact.finalPlayer) &&
      (impact.fieldImproved || impact.hasEngine || impact.hasRemoval)
    ) {
      addMilestone(entries, 2.5, "Meeting converted hand into useful piece");
    } else {
      addMilestone(entries, -2.5, "Meeting spent cards without payoff");
    }
  }

  if (impact.usedAlbus) {
    const finalAlbus = impact.finalArcanists.find(
      (card) => card.name === ARCANIST_NAMES.ALBUS,
    );
    const convertedToPayoff = impact.finalArcanists.some((card) =>
      [
        ARCANIST_NAMES.ELEMENTALIST,
        ARCANIST_NAMES.AZRATH,
        ARCANIST_NAMES.MASTER_OF_MIRRORS,
      ].includes(card.name),
    );
    if (finalAlbus || convertedToPayoff || impact.hasRemoval) {
      addMilestone(
        entries,
        finalAlbus ? 2 : 2.5,
        finalAlbus ? "Albus extended field" : "Albus converted into payoff",
      );
    }
  }
}

function scoreTacticalMilestones(entries, impact) {
  const azrathHosts = getEquippedHosts(impact.finalPlayer, ARCANIST_NAMES.AZRATH);
  if (azrathHosts.length > 0 && (impact.battleReduction >= 500 || impact.hasRemoval)) {
    addMilestone(entries, 3, "Azrath neutralized threat");
  }

  if (
    impact.usedTera &&
    (impact.battleReduction >= 500 ||
      impact.removedMonsters > 0 ||
      impact.removedLethal)
  ) {
    addMilestone(entries, 2.5, "Tera opened battle trade");
  }

  if (impact.usedSeismic) {
    if (impact.banishedGain > 0 || impact.removedCards > 0) {
      const premium =
        impact.battleReduction >= 1000 || impact.removedLethal ? 4.5 : 3.5;
      addMilestone(entries, premium, "Seismic removed high-value card");
    } else if (impact.equipDelta < 0) {
      addMilestone(entries, -4, "Seismic spent Equip without removal");
    }
  }

  if (impact.usedCrimson) {
    if (impact.removedCards > 0 || impact.removedLethal) {
      addMilestone(entries, impact.removedLethal ? 4 : 2.5, "Crimson traded into removal");
    } else {
      addMilestone(entries, -3.5, "Crimson cost lacked payoff");
    }
  }

  if (
    impact.usedLightning &&
    (impact.removedLethal ||
      impact.battleReduction >= 500 ||
      impact.finalArcanists.some(
        (card) =>
          getEffectiveAtk(card) > getEffectiveDef(card) &&
          getEffectiveAtk(card) >= impact.finalOpp.strongestBattle,
      ))
  ) {
    addMilestone(entries, 2, "Lightning created combat advantage");
  }

  if (impact.usedIceBarrier && impact.hasProtection) {
    addMilestone(entries, impact.removedLethal ? 3.5 : 2, "Ice Barrier added protection");
  }
}

function scoreBoardImpactMilestones(entries, impact) {
  if (impact.removedCards > 0) {
    addMilestone(
      entries,
      Math.min(5, impact.removedCards * 2),
      "reduced opponent board",
    );
  }
  if (impact.battleReduction >= 500) {
    addMilestone(
      entries,
      Math.min(4.5, impact.battleReduction / 550),
      "reduced top threat",
    );
  }
  if (impact.banishedGain > 0) {
    addMilestone(
      entries,
      Math.min(4.5, impact.banishedGain * 2.5),
      "banished opposing card",
    );
  }
  if (impact.removedLethal) {
    addMilestone(entries, 7, "removed lethal threat");
  }
  if (impact.initialOpp.cards > 0 && impact.finalOpp.cards === 0) {
    addMilestone(entries, 4, "cleared opponent field");
  }
}

function scoreSimulatedBattleMilestones(entries, impact) {
  if (impact.simulatedBattles.length === 0) return;
  if (impact.simulatedBattleRemovedOpponent > 0) {
    addMilestone(entries, 3.5, "battle removed opposing monster");
  }
  if (impact.simulatedBattleDamage >= 1500) {
    addMilestone(entries, 2.5, "battle created decisive damage");
  } else if (impact.simulatedBattleDamage > 0) {
    addMilestone(entries, 1.2, "battle added pressure");
  }
  if (impact.simulatedLibraryRewards > 0) {
    addMilestone(entries, 3, "Grand Library drew after battle");
  }
  if (impact.hasMain2AfterBattlePayoff) {
    addMilestone(entries, 2.5, "battle opened Main2 payoff");
  }
  if (
    impact.simulatedBattleLostSelf > 0 &&
    !impact.removedLethal &&
    impact.simulatedBattleRemovedOpponent === 0
  ) {
    addMilestone(entries, -4, "battle lost monster without payoff");
  }
}

function scoreRiskMilestones(entries, impact) {
  if (impact.finalArcanists.length === 0 && impact.finalOpp.cards > 0) {
    addMilestone(entries, -6, "ended with no Arcanist monster");
  }

  const lostEquip = impact.equipDelta < 0;
  if (lostEquip && !impact.hasRemoval && !impact.hasProtection && !impact.hasEngine) {
    addMilestone(entries, -3.5, "spent Equip without payoff");
  }

  const initialGrimoireInPlay =
    getEquippedGrimoireHosts(impact.initialPlayer).length +
    (impact.initialPlayer.spellTrap || []).filter(
      (card) => card?.name === ARCANIST_NAMES.GRIMOIRE,
    ).length;
  const finalGrimoireInPlay =
    getEquippedGrimoireHosts(impact.finalPlayer).length +
    (impact.finalPlayer.spellTrap || []).filter(
      (card) => card?.name === ARCANIST_NAMES.GRIMOIRE,
    ).length;
  if (
    finalGrimoireInPlay < initialGrimoireInPlay &&
    !impact.hasRemoval &&
    !impact.hasProtection &&
    !impact.hasEngine
  ) {
    addMilestone(entries, -4, "lost Grimoire without payoff");
  }

  const finalElementalist = impact.finalArcanists.find(
    (card) => card.name === ARCANIST_NAMES.ELEMENTALIST,
  );
  if (finalElementalist && !hasElementalistImpact(finalElementalist, impact)) {
    addMilestone(entries, -2.5, "Elementalist lacked equip or stabilization");
  }

  if (impact.sequence.length >= 4 && !impact.hasPayoff) {
    addMilestone(entries, -Math.min(5, impact.sequence.length - 2), "long line without payoff");
  }
  if (
    impact.ownActiveDelta <= -3 &&
    !impact.hasRemoval &&
    !impact.hasEngine &&
    !impact.hasProtection
  ) {
    addMilestone(entries, -3, "spent many resources without payoff");
  }

  const finalLp = impact.finalPlayer.lp || 0;
  if (finalLp <= 1500 && impact.finalLethal) {
    addMilestone(entries, -9, "low LP with lethal still present");
  } else if (finalLp <= 3000 && impact.finalLethal) {
    addMilestone(entries, -4.5, "LP still under lethal pressure");
  } else if (finalLp <= 1500 && !impact.finalLethal && impact.finalOpp.cards > 0) {
    addMilestone(entries, -1.5, "low LP but stabilized");
  }
}

export function scoreArcanistLineMilestones(context = {}) {
  const impact = getLineImpact(context);
  const entries = [];

  scoreElementalistMilestones(entries, impact);
  scoreGrimoireMilestones(entries, impact);
  scoreEngineMilestones(entries, impact);
  scoreTacticalMilestones(entries, impact);
  scoreBoardImpactMilestones(entries, impact);
  scoreSimulatedBattleMilestones(entries, impact);
  scoreRiskMilestones(entries, impact);

  entries.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return b.score - a.score;
  });

  return {
    scoreDelta: entries.reduce((sum, entry) => sum + entry.score, 0),
    milestones: entries.map((entry) => entry.label),
    details: {
      lineImpact: {
        removedCards: impact.removedCards,
        battleReduction: impact.battleReduction,
        banishedGain: impact.banishedGain,
        removedLethal: impact.removedLethal,
        lpDelta: impact.lpDelta,
        ownActiveDelta: impact.ownActiveDelta,
        simulatedBattles: impact.simulatedBattles.length,
        simulatedLibraryRewards: impact.simulatedLibraryRewards,
      },
      entries,
    },
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function scoreArcanistLineTerminal(context = {}) {
  const finalPlayer = getPlayer(context.finalState);
  if ((finalPlayer.lp || 0) <= 0) {
    return -1000 + Math.min(0, Number(context.milestoneScore || 0));
  }
  const baseScore = Number(context.baseScore || 0);
  const milestoneScore = Number(context.milestoneScore || 0);
  const profile = context.profile || context.planningContext?.profile || {};
  const critical =
    profile.mode === "critical" ||
    opponentThreatensLethal(context.initialState) ||
    (getPlayer(context.initialState)?.lp || 0) <= 3000;
  const positiveCap = critical ? 12 : 8;
  const negativeCap = critical ? -11 : -8;
  const clamped = clamp(milestoneScore, negativeCap, positiveCap);
  const riskMultiplier = critical ? 1.1 : 0.85;
  const adjustedMilestone = clamped > 0 ? clamped * riskMultiplier : clamped;
  return baseScore + adjustedMilestone;
}

export function describeArcanistPlannedLine(context = {}) {
  const sequence = context.sequence || [];
  const actions = sequence
    .map((action) => {
      if (action?.type === "simulatedBattle") {
        const target = action.direct ? "direct" : action.targetName || "target";
        return `Battle: ${action.attackerName || "attacker"} > ${target}`;
      }
      return action?.cardName || action?.card?.name || action?.type;
    })
    .filter(Boolean)
    .join(" -> ");
  const milestones = (context.milestones || []).slice(0, 4).join(", ");
  if (!actions) return "Arcanist planner: no line";
  return milestones
    ? `Arcanist planner: ${actions} | ${milestones}`
    : `Arcanist planner: ${actions}`;
}
