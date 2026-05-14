import {
  getStrongestAttackThreat,
  getStrongestBattleThreat,
} from "../common/cardStats.js";
import {
  evaluateTributeSummonCost,
  getTributeRequirementFor as getGenericTributeRequirementFor,
  selectBestTributes as selectGenericTributes,
} from "../common/tributePolicy.js";
import {
  ARCANIST_MONSTER_RECOVERY_ORDER,
  ARCANIST_NAMES,
  ARCANIST_SPELL_RECOVERY_ORDER,
  GRIMOIRE_HOST_ORDER,
  controlsArcanistEquip,
  getNameRank,
  getStoredBlueprintCount,
  hasArcanistEquip,
  isArcanistEquip,
  isArcanistMonster,
  isArcanistSpell,
  sortByNameOrder,
} from "./knowledge.js";
import { evaluateArcanistCardValue } from "./scoring.js";

function hasFaceUpByName(cards = [], name) {
  return (cards || []).some(
    (card) => card?.name === name && !card.isFacedown,
  );
}

function hasOpponentFaceUpSpell(analysis = {}) {
  return (
    !!analysis.oppFieldSpell ||
    (analysis.oppSpellTrap || []).some(
      (card) => card?.cardKind === "spell" && !card.isFacedown,
    )
  );
}

function getOpponentCardCount(analysis = {}) {
  return (
    (analysis.oppField || []).length +
    (analysis.oppSpellTrap || []).length +
    (analysis.oppFieldSpell ? 1 : 0)
  );
}

function getOwnArcanistHosts(analysis = {}) {
  return (analysis.field || []).filter(
    (card) => isArcanistMonster(card) && !card.isFacedown,
  );
}

function countByName(cards = [], name) {
  return (cards || []).filter((card) => card?.name === name).length;
}

function hasFaceUpGrimoire(analysis = {}) {
  return hasFaceUpByName(analysis.spellTrap || [], ARCANIST_NAMES.GRIMOIRE);
}

function hasFaceUpInkRiver(analysis = {}) {
  return hasFaceUpByName(analysis.spellTrap || [], ARCANIST_NAMES.INK_RIVER);
}

function hasGrimoireInDeck(analysis = {}) {
  return (analysis.deck || []).some(
    (card) => card?.name === ARCANIST_NAMES.GRIMOIRE,
  );
}

function canAccessGrimoireThisTurn(analysis = {}) {
  if (hasFaceUpGrimoire(analysis)) return false;
  if (getOwnArcanistHosts(analysis).length === 0) return false;
  return (
    (analysis.hand || []).some((card) => card?.name === ARCANIST_NAMES.GRIMOIRE) ||
    (analysis.fieldSpell?.name === ARCANIST_NAMES.GRAND_LIBRARY &&
      hasGrimoireInDeck(analysis))
  );
}

function hasSpellFlowAfterInk(analysis = {}) {
  const handSpells = (analysis.hand || []).filter(
    (card) => isArcanistSpell(card) && card.name !== ARCANIST_NAMES.INK_RIVER,
  );
  const hasFieldSpellEffect =
    analysis.fieldSpell?.name === ARCANIST_NAMES.GRAND_LIBRARY &&
    (getOwnArcanistHosts(analysis).length > 0 || (analysis.player?.lp || 0) > 2200);
  const hasStoredGrimoire = (analysis.spellTrap || []).some(
    (card) =>
      card?.name === ARCANIST_NAMES.GRIMOIRE &&
      !card.isFacedown &&
      getStoredBlueprintCount(card) > 0,
  );
  return handSpells.length > 0 || hasFieldSpellEffect || hasStoredGrimoire;
}

function getStoredBlueprints(card) {
  const storage = card?.state?.blueprintStorage || card?.blueprintStorage;
  return Array.isArray(storage?.storedBlueprints) ? storage.storedBlueprints : [];
}

function getStoredBlueprintName(card) {
  const blueprint = getStoredBlueprints(card)[0];
  return (
    blueprint?.sourceCardName ||
    blueprint?.displayName ||
    blueprint?.effectSnapshot?.sourceCardName ||
    ""
  );
}

function isLowValueDiscard(card, analysis = {}) {
  if (!card) return false;
  const hand = analysis.hand || [];
  const duplicates = getDuplicateNames(hand);
  if (duplicates.includes(card.name)) return true;
  if (card.name === ARCANIST_NAMES.MEETING) return true;
  if (
    card.name === ARCANIST_NAMES.GRIMOIRE &&
    hasFaceUpGrimoire(analysis) &&
    countByName(hand, ARCANIST_NAMES.GRIMOIRE) > 0
  ) {
    return true;
  }
  if (card.name === ARCANIST_NAMES.GRAND_LIBRARY && analysis.fieldSpell) {
    return true;
  }
  if (
    card.name === ARCANIST_NAMES.ICE_BARRIER &&
    (analysis.equippedArcanists || []).length === 0
  ) {
    return true;
  }
  if (card.name === ARCANIST_NAMES.CRIMSON_EXPLOSION && (analysis.oppField || []).length === 0) {
    return true;
  }
  if (
    card.name === ARCANIST_NAMES.LIGHTNING_LANCE &&
    (analysis.oppField || []).length === 0
  ) {
    return true;
  }
  return evaluateArcanistCardValue(card, analysis) <= 8;
}

function hasLowValueDiscard(analysis = {}) {
  return (analysis.hand || []).some((card) => isLowValueDiscard(card, analysis));
}

export function rankGrimoireHosts(hosts = [], analysis = {}) {
  const recoverableSpellNames = new Set(
    (analysis.graveyard || []).filter(isArcanistSpell).map((card) => card.name),
  );
  const hasRecoverableMonster = (analysis.graveyard || []).some(isArcanistMonster);
  const hasSmallRecoverableMonster = (analysis.graveyard || []).some(
    (card) => isArcanistMonster(card) && (card.level || 0) <= 4,
  );
  const opponentPressure =
    getStrongestBattleThreat(analysis.oppField || [], { includeBoosts: true }) >=
    2200;

  return [...hosts].sort((a, b) => {
    const equippedA = hasArcanistEquip(a) ? 1 : 0;
    const equippedB = hasArcanistEquip(b) ? 1 : 0;
    if (equippedA !== equippedB) return equippedA - equippedB;

    let rankA = getNameRank(a?.name, GRIMOIRE_HOST_ORDER);
    let rankB = getNameRank(b?.name, GRIMOIRE_HOST_ORDER);

    if ((analysis.oppField || []).length === 0) {
      if (a?.name === ARCANIST_NAMES.APPRENTICE) rankA -= 1;
      if (b?.name === ARCANIST_NAMES.APPRENTICE) rankB -= 1;
    }
    if (recoverableSpellNames.size > 0) {
      const spellRecoveryBonus = recoverableSpellNames.has(
        ARCANIST_NAMES.SEISMIC_IMPACT,
      )
        ? 7
        : 5;
      if (a?.name === ARCANIST_NAMES.VIRIDIS) rankA -= spellRecoveryBonus;
      if (b?.name === ARCANIST_NAMES.VIRIDIS) rankB -= spellRecoveryBonus;
    }
    if (hasRecoverableMonster && !opponentPressure) {
      if (a?.name === ARCANIST_NAMES.ALBUS) rankA -= 5;
      if (b?.name === ARCANIST_NAMES.ALBUS) rankB -= 5;
    }
    if (hasSmallRecoverableMonster && !opponentPressure) {
      if (a?.name === ARCANIST_NAMES.MASTER_OF_MIRRORS) rankA -= 4;
      if (b?.name === ARCANIST_NAMES.MASTER_OF_MIRRORS) rankB -= 4;
    }

    if (rankA !== rankB) return rankA - rankB;
    return evaluateArcanistCardValue(b, analysis) - evaluateArcanistCardValue(a, analysis);
  });
}

export function getBestGrimoireHostNames(analysis = {}) {
  return rankGrimoireHosts(getOwnArcanistHosts(analysis), analysis).map(
    (card) => card.name,
  );
}

function getDuplicateNames(cards = []) {
  const counts = new Map();
  for (const card of cards || []) {
    if (!card?.name) continue;
    counts.set(card.name, (counts.get(card.name) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name);
}

export function buildArcanistCostPreferences(analysis = {}) {
  const hand = analysis.hand || [];
  const duplicateNames = getDuplicateNames(hand);
  const activeGrimoire = hasFaceUpGrimoire(analysis);
  const hasFieldSpell = !!analysis.fieldSpell;

  const preferNames = [
    ...duplicateNames.filter(
      (name) =>
        ![
          ARCANIST_NAMES.SEISMIC_IMPACT,
          ARCANIST_NAMES.AZRATH,
          ARCANIST_NAMES.ELEMENTALIST,
        ].includes(name),
    ),
    ARCANIST_NAMES.MEETING,
    ...(hasFieldSpell ? [ARCANIST_NAMES.GRAND_LIBRARY] : []),
    ...((analysis.equippedArcanists || []).length === 0
      ? [ARCANIST_NAMES.ICE_BARRIER]
      : []),
  ];

  const preserveNames = [
    ARCANIST_NAMES.SEISMIC_IMPACT,
    ARCANIST_NAMES.AZRATH,
    ARCANIST_NAMES.ELEMENTALIST,
    ...(!hasFieldSpell ? [ARCANIST_NAMES.GRAND_LIBRARY] : []),
    ...(!activeGrimoire ? [ARCANIST_NAMES.GRIMOIRE] : []),
    ...((analysis.graveyard || []).some(isArcanistSpell)
      ? [ARCANIST_NAMES.VIRIDIS]
      : []),
    ...((analysis.graveyard || []).some(isArcanistMonster)
      ? [ARCANIST_NAMES.ALBUS]
      : []),
  ];

  return {
    archetype: "Arcanist",
    preferNames: [...new Set(preferNames)],
    preserveNames: [...new Set(preserveNames)],
    offensivePayoffNames: [
      ARCANIST_NAMES.AZRATH,
      ARCANIST_NAMES.ELEMENTALIST,
      ARCANIST_NAMES.MASTER_OF_MIRRORS,
    ],
    availableOffensivePayoffs: [
      ...(analysis.hand || []),
      ...(analysis.deck || []),
      ...(analysis.field || []),
    ].filter((card) =>
      [
        ARCANIST_NAMES.AZRATH,
        ARCANIST_NAMES.ELEMENTALIST,
        ARCANIST_NAMES.MASTER_OF_MIRRORS,
      ].includes(card?.name),
    ).length,
    preserveLastOffensivePayoff: true,
  };
}

function getHighestValueOpponentNames(analysis = {}) {
  const cards = [
    ...(analysis.oppField || []),
    ...(analysis.oppSpellTrap || []),
    ...(analysis.oppFieldSpell ? [analysis.oppFieldSpell] : []),
  ].filter(Boolean);
  return cards
    .slice()
    .sort((a, b) => evaluateArcanistCardValue(b, analysis) - evaluateArcanistCardValue(a, analysis))
    .slice(0, 3)
    .map((card) => card.name);
}

function getCheapArcanistNamesForCrimson(analysis = {}) {
  return (analysis.field || [])
    .filter((card) => isArcanistMonster(card) && !card.isFacedown)
    .slice()
    .sort((a, b) => {
      const equippedA = hasArcanistEquip(a) ? 1 : 0;
      const equippedB = hasArcanistEquip(b) ? 1 : 0;
      if (equippedA !== equippedB) return equippedA - equippedB;
      return evaluateArcanistCardValue(a, analysis) - evaluateArcanistCardValue(b, analysis);
    })
    .map((card) => card.name);
}

function getLibraryChoiceNames(analysis = {}) {
  const controlsMonster = getOwnArcanistHosts(analysis).length > 0;
  return controlsMonster
    ? ['Add an "Arcanist" Equip Spell']
    : ["Pay 2000 LP; Special Summon an Arcanist monster"];
}

function getMeetingChoiceNames(analysis = {}) {
  const monsters = (analysis.hand || []).filter(isArcanistMonster).length;
  const spells = (analysis.hand || []).filter(isArcanistSpell).length;
  const hasMonsterAccess =
    getOwnArcanistHosts(analysis).length > 0 ||
    (analysis.hand || []).some(isArcanistMonster);
  const hasSpellEngine =
    !!analysis.fieldSpell ||
    (analysis.hand || []).some((card) =>
      [ARCANIST_NAMES.GRAND_LIBRARY, ARCANIST_NAMES.GRIMOIRE].includes(
        card?.name,
      ),
    );

  if (!hasSpellEngine && monsters >= 2) {
    return ['Discard 2 "Arcanist" monsters'];
  }
  if (!hasMonsterAccess && spells >= 2) {
    return ['Discard 2 "Arcanist" Spells'];
  }
  return monsters >= spells
    ? ['Discard 2 "Arcanist" monsters']
    : ['Discard 2 "Arcanist" Spells'];
}

export function buildArcanistTargetPreferences(card, analysis = {}) {
  const opponentNames = getHighestValueOpponentNames(analysis);
  const grimoireHosts = getBestGrimoireHostNames(analysis);
  const cheapArcanists = getCheapArcanistNamesForCrimson(analysis);

  const spellRecoveryNames = sortByNameOrder(
    (analysis.graveyard || []).filter(isArcanistSpell),
    ARCANIST_SPELL_RECOVERY_ORDER,
  ).map((candidate) => candidate.name);
  const monsterRecoveryNames = sortByNameOrder(
    (analysis.graveyard || []).filter(isArcanistMonster),
    ARCANIST_MONSTER_RECOVERY_ORDER,
  ).map((candidate) => candidate.name);

  const preferences = {
    grimoire_equip_target: {
      role: "named_preference",
      preferredNames: grimoireHosts,
    },
    seismic_impact_target: {
      role: "removal",
      preferredNames: opponentNames,
    },
    crimson_magic_self_target: {
      role: "named_preference",
      preferredNames: cheapArcanists,
      avoidNames: [
        ARCANIST_NAMES.AZRATH,
        ARCANIST_NAMES.ELEMENTALIST,
        ARCANIST_NAMES.MASTER_OF_MIRRORS,
      ],
    },
    crimson_magic_opponent_target: {
      role: "removal",
      preferredNames: opponentNames,
    },
    lightning_magic_lance_target: {
      role: opponentNames.length ? "removal" : "named_preference",
      preferredNames:
        (analysis.oppField || []).length > 0 ? opponentNames : grimoireHosts,
    },
    tera_arcanist_earth_targets: {
      role: "removal",
      preferredNames: opponentNames,
    },
    viridis_bounce_target: {
      role: "removal",
      preferredNames: opponentNames,
    },
    viridis_recover_target: {
      role: "named_preference",
      preferredNames: spellRecoveryNames,
    },
    albus_arcanist_ice_recover_target: {
      role: "recursion",
      preferredNames: monsterRecoveryNames,
      purpose: "value",
    },
    master_mirrors_arcanist_revive_target: {
      role: "recursion",
      preferredNames: monsterRecoveryNames,
      purpose: (analysis.oppField || []).length > 0 ? "stabilize" : "pressure",
      defensiveNames: [ARCANIST_NAMES.TERA, ARCANIST_NAMES.VIRIDIS],
      offensiveNames: [ARCANIST_NAMES.AZRATH, ARCANIST_NAMES.APPRENTICE],
    },
    master_mirrors_arcanist_spell_targets: {
      role: "named_preference",
      preferredNames: spellRecoveryNames,
    },
    elementalist_destroy_target: {
      role: "removal",
      preferredNames: opponentNames,
    },
    azrath_zero_target: {
      role: "removal",
      preferredNames: opponentNames,
    },
    action_case_choice: {
      role: "named_preference",
      preferredNames:
        card?.name === ARCANIST_NAMES.MEETING
          ? getMeetingChoiceNames(analysis)
          : getLibraryChoiceNames(analysis),
    },
  };

  return preferences;
}

export function buildArcanistSpecialSummonPositions() {
  return {
    default: "attack",
    byName: {
      [ARCANIST_NAMES.TERA]: "defense",
      [ARCANIST_NAMES.VIRIDIS]: "attack",
      [ARCANIST_NAMES.ALBUS]: "attack",
      [ARCANIST_NAMES.AZRATH]: "attack",
      [ARCANIST_NAMES.APPRENTICE]: "attack",
    },
    byTargetRef: {
      master_mirrors_arcanist_revive_target: "attack",
    },
  };
}

export function buildArcanistActivationContext(card, analysis = {}) {
  return {
    autoSelectTargets: true,
    autoSelectSingleTarget: true,
    logTargets: false,
    actionContext: {
      costPreferences: buildArcanistCostPreferences(analysis),
      targetPreferences: buildArcanistTargetPreferences(card, analysis),
      specialSummonPositions: buildArcanistSpecialSummonPositions(),
    },
  };
}

export function shouldSummonMonster(card, analysis = {}, tributeInfo = {}) {
  if (!card || card.cardKind !== "monster") {
    return { yes: false, reason: "not a monster" };
  }
  if (!isArcanistMonster(card)) {
    return { yes: false, reason: "not Arcanist" };
  }

  const field = analysis.field || [];
  const oppField = analysis.oppField || [];
  const tributesNeeded = tributeInfo.tributesNeeded || 0;
  if (field.length < tributesNeeded) {
    return { yes: false, reason: "insufficient tributes" };
  }

  if (tributesNeeded > 0) {
    const tributeIndices = selectBestTributes(field, tributesNeeded, card, {
      evaluationContext: analysis,
      oppField,
    });
    const tributes = tributeIndices.map((index) => field[index]).filter(Boolean);
    const costCheck = evaluateArcanistTributeTrade(card, tributes, analysis);
    if (!costCheck.ok) return { yes: false, reason: costCheck.reason };
  }

  const hasGrimoireInHand = (analysis.hand || []).some(
    (candidate) => candidate?.name === ARCANIST_NAMES.GRIMOIRE,
  );
  const hasEquip = controlsArcanistEquip(analysis.player);
  const oppStrongest = getStrongestBattleThreat(oppField, {
    includeBoosts: true,
  });

  if (card.name === ARCANIST_NAMES.APPRENTICE) {
    const canSearchSpell = (analysis.deck || []).some(isArcanistSpell);
    return {
      yes: true,
      position: "attack",
      priority: canSearchSpell ? 15 : 7,
      reason: canSearchSpell
        ? "normal summon searches Arcanist spell"
        : "starter body for Grimoire",
    };
  }

  if (card.name === ARCANIST_NAMES.AZRATH) {
    return {
      yes: true,
      position: "attack",
      priority: hasGrimoireInHand || oppField.length > 0 ? 11 : 7,
      reason: "best Grimoire host and spell debuff payoff",
    };
  }

  if (card.name === ARCANIST_NAMES.TERA) {
    return {
      yes: true,
      position: "attack",
      priority: oppField.length > 0 ? 8 : 5,
      reason: "position control body",
    };
  }

  if (card.name === ARCANIST_NAMES.VIRIDIS) {
    return {
      yes: true,
      position: "attack",
      priority: hasOpponentFaceUpSpell(analysis) ? 8 : 5,
      reason: "spell bounce and recovery body",
    };
  }

  if (card.name === ARCANIST_NAMES.ALBUS) {
    const alreadyHasArcanist = getOwnArcanistHosts(analysis).length > 0;
    return {
      yes: !alreadyHasArcanist,
      position: "attack",
      priority: alreadyHasArcanist ? 3 : 6,
      reason: alreadyHasArcanist
        ? "prefer hand special summon effect"
        : "normal summonable Arcanist body",
    };
  }

  if (card.name === ARCANIST_NAMES.MASTER_OF_MIRRORS) {
    const hasSpellGY = (analysis.graveyard || []).some(isArcanistSpell);
    return {
      yes: hasSpellGY || oppStrongest <= 2100 || hasGrimoireInHand,
      position: "attack",
      priority: hasSpellGY ? 9 : 6,
      reason: hasSpellGY
        ? "tribute summon recycles spells and draws"
        : "midgame body with Grimoire revive upside",
    };
  }

  if (card.name === ARCANIST_NAMES.ELEMENTALIST) {
    const worthTribute =
      oppField.length > 0 &&
      (hasGrimoireInHand || hasEquip || oppStrongest >= 2300);
    return {
      yes: worthTribute,
      position: "attack",
      priority: hasGrimoireInHand ? 11 : 8,
      reason: "finisher with effect protection and equipped removal",
    };
  }

  return {
    yes: true,
    position: "attack",
    priority: 4,
    reason: "generic Arcanist summon",
  };
}

export function shouldPlaySpell(card, analysis = {}) {
  if (!card || card.cardKind !== "spell") {
    return { yes: false, reason: "not a spell" };
  }
  if (!isArcanistSpell(card)) {
    return { yes: false, reason: "not Arcanist spell" };
  }

  const field = analysis.field || [];
  const hand = analysis.hand || [];
  const spellTrap = analysis.spellTrap || [];
  const oppField = analysis.oppField || [];
  const oppCards = getOpponentCardCount(analysis);
  const hasArcanistField = getOwnArcanistHosts(analysis).length > 0;
  const hasEquip = controlsArcanistEquip(analysis.player);
  const hasGrimoireActive = hasFaceUpGrimoire(analysis);
  const handArcanistSpells = hand.filter(isArcanistSpell).length;

  if (card.name === ARCANIST_NAMES.GRAND_LIBRARY) {
    if (analysis.fieldSpell) {
      return { yes: false, reason: "field spell already active" };
    }
    return { yes: true, priority: 14, reason: "core field engine" };
  }

  if (card.name === ARCANIST_NAMES.GRIMOIRE) {
    const hosts = getOwnArcanistHosts(analysis).filter(
      (host) => !hasArcanistEquip(host),
    );
    if (hosts.length === 0) {
      return { yes: false, reason: "no face-up Arcanist host" };
    }
    if (hasGrimoireActive) {
      return { yes: false, reason: "Grimoire already controlled" };
    }
    const bestHost = rankGrimoireHosts(hosts, analysis)[0];
    let priority = 13;
    if (
      bestHost?.name === ARCANIST_NAMES.AZRATH ||
      bestHost?.name === ARCANIST_NAMES.ELEMENTALIST
    ) {
      priority += 2;
    }
    return {
      yes: true,
      priority,
      reason: `equip ${bestHost?.name || "best Arcanist"}`,
    };
  }

  if (card.name === ARCANIST_NAMES.SEISMIC_IMPACT) {
    if (!hasArcanistField) return { yes: false, reason: "need Arcanist field" };
    if (oppCards === 0) return { yes: false, reason: "no opposing card" };
    if (hand.length < 2 && hand.includes(card)) {
      return { yes: false, reason: "need discard card" };
    }
    if (!hasEquip && canAccessGrimoireThisTurn(analysis)) {
      const emergencyRemoval =
        (analysis.oppStrongestBattle || 0) >= 2800 ||
        (analysis.lp || 8000) <= 3500 ||
        oppCards >= 4;
      if (!emergencyRemoval) {
        return {
          yes: false,
          priority: 1,
          reason: "delay Seismic until Grimoire turns it into banish",
        };
      }
    }
    return {
      yes: true,
      priority: hasEquip ? 14 : oppCards >= 2 ? 7 : 5,
      reason: hasEquip ? "banish opposing card" : "bounce opposing card",
    };
  }

  if (card.name === ARCANIST_NAMES.INK_RIVER) {
    if (hasFaceUpInkRiver(analysis)) {
      return { yes: false, reason: "Ink River already active" };
    }
    const gySpells = (analysis.graveyard || []).filter(isArcanistSpell).length;
    const hasFlow = hasSpellFlowAfterInk(analysis);
    return {
      yes: hasFlow || handArcanistSpells >= 2 || gySpells > 0,
      priority: gySpells > 0 ? 16 : hasFlow ? 16 : 6,
      reason: "sets up spell counter recursion",
    };
  }

  if (card.name === ARCANIST_NAMES.LIGHTNING_LANCE) {
    const hasFaceUpMonster =
      getOwnArcanistHosts(analysis).length > 0 || oppField.length > 0;
    if (!hasFaceUpMonster) return { yes: false, reason: "no valid monster" };
    const myAttackers = getOwnArcanistHosts(analysis).filter(
      (monster) => monster.position === "attack" && !monster.hasAttacked,
    );
    const canPressure =
      myAttackers.some((monster) => (monster.atk || 0) + 500 >= (analysis.oppLp || 8000)) ||
      (oppField.length > 0 &&
        myAttackers.some(
          (monster) =>
            (monster.atk || 0) + 500 >
            getStrongestBattleThreat(oppField, { includeBoosts: true }),
        ));
    return {
      yes: canPressure || oppField.length > 0,
      priority: canPressure ? 9 : 5,
      reason: canPressure ? "combat push" : "lock opponent attacker",
    };
  }

  if (card.name === ARCANIST_NAMES.ICE_BARRIER) {
    const protectedHosts = getOwnArcanistHosts(analysis).filter(hasArcanistEquip);
    if (protectedHosts.length === 0) {
      return { yes: false, reason: "need equipped Arcanist" };
    }
    return {
      yes: oppField.length > 0 || (analysis.oppSpellTrap || []).length > 0,
      priority: 7,
      reason: "protect equipped Arcanist",
    };
  }

  if (card.name === ARCANIST_NAMES.CRIMSON_EXPLOSION) {
    if (!hasArcanistField || oppField.length === 0) {
      return { yes: false, reason: "need both Arcanist and opposing monster" };
    }
    const oppStrongest = getStrongestAttackThreat(oppField, {
      includeBoosts: true,
    });
    const hasCheapSelfTarget = getCheapArcanistNamesForCrimson(analysis).length > 0;
    return {
      yes: hasEquip || oppStrongest >= 2200 || hasCheapSelfTarget,
      priority: hasEquip ? 10 : oppStrongest >= 2200 ? 8 : 5,
      reason: hasEquip ? "one-sided Crimson damage" : "trade removal",
    };
  }

  if (card.name === ARCANIST_NAMES.MEETING) {
    if (hasFaceUpByName(spellTrap, ARCANIST_NAMES.MEETING)) {
      return { yes: false, reason: "Meeting already active" };
    }
    return {
      yes: hand.length >= 4,
      priority: 5,
      reason: "hand conversion engine",
    };
  }

  return { yes: true, priority: 3, reason: "generic Arcanist spell" };
}

export function shouldActivateSpellTrapEffect(card, analysis = {}) {
  if (!card || card.cardKind !== "spell" || card.isFacedown) {
    return { yes: false, reason: "not face-up spell" };
  }

  if (card.name === ARCANIST_NAMES.INK_RIVER) {
    const counters = card.counters instanceof Map
      ? card.counters.get("ink") || 0
      : card.counters?.ink || 0;
    const gySpells = (analysis.graveyard || []).filter(isArcanistSpell).length;
    return {
      yes: counters >= 2 && gySpells > 0,
      priority: 15,
      reason: "recover Arcanist spell from GY",
    };
  }

  if (card.name === ARCANIST_NAMES.GRIMOIRE) {
    const storedName = getStoredBlueprintName(card);
    const storedCount = getStoredBlueprintCount(card);
    if (storedCount <= 0) {
      return { yes: false, reason: "no stored spell effect" };
    }

    if (storedName === ARCANIST_NAMES.SEISMIC_IMPACT) {
      const opponentTargets = getOpponentCardCount(analysis);
      const hasCheapDiscard = hasLowValueDiscard(analysis);
      const premiumTarget =
        (analysis.oppStrongestBattle || 0) >= 2200 ||
        (analysis.oppSpellTrap || []).length > 0 ||
        !!analysis.oppFieldSpell;
      return {
        yes: opponentTargets > 0 && hasCheapDiscard && premiumTarget,
        priority: 12,
        reason: hasCheapDiscard
          ? "use stored Seismic on premium target"
          : "hold stored Seismic until a cheap discard exists",
      };
    }

    if (storedName === ARCANIST_NAMES.CRIMSON_EXPLOSION) {
      return {
        yes:
          (analysis.oppField || []).length > 0 &&
          getCheapArcanistNamesForCrimson(analysis).length > 0,
        priority: 9,
        reason: "use stored Crimson only when the trade is clean",
      };
    }

    if (storedName === ARCANIST_NAMES.ICE_BARRIER) {
      return {
        yes:
          (analysis.equippedArcanists || []).length > 0 &&
          ((analysis.oppField || []).length > 0 ||
            (analysis.oppSpellTrap || []).length > 0),
        priority: 8,
        reason: "protect an equipped Arcanist",
      };
    }

    if (storedName === ARCANIST_NAMES.LIGHTNING_LANCE) {
      return {
        yes:
          (analysis.oppField || []).length > 0 ||
          (analysis.oppLp || 8000) <= 2500,
        priority: 8,
        reason: "stored combat trick has pressure",
      };
    }

    return {
      yes: true,
      priority: 7,
      reason: "activate stored spell effect",
    };
  }

  if (card.name === ARCANIST_NAMES.MEETING) {
    const monsters = (analysis.hand || []).filter(isArcanistMonster).length;
    const spells = (analysis.hand || []).filter(isArcanistSpell).length;
    const missingEngine = !analysis.fieldSpell && !hasFaceUpByName(analysis.spellTrap || [], ARCANIST_NAMES.GRIMOIRE);
    const missingMonster = getOwnArcanistHosts(analysis).length === 0;
    return {
      yes:
        (monsters >= 2 && missingEngine) ||
        (spells >= 2 && missingMonster) ||
        (analysis.hand || []).length >= 5,
      priority: missingEngine || missingMonster ? 8 : 4,
      reason: "convert excess Arcanist cards",
    };
  }

  return { yes: false, reason: "no Arcanist spellTrap effect" };
}

export function shouldActivateMonsterEffect(card, analysis = {}) {
  if (!card || card.cardKind !== "monster" || card.isFacedown) {
    return { yes: false, reason: "not face-up monster" };
  }

  if (card.name === ARCANIST_NAMES.TERA) {
    return {
      yes: (analysis.oppField || []).some((target) => !target.isFacedown),
      priority: hasArcanistEquip(card) ? 8 : 6,
      reason: "switch opposing monster position",
    };
  }

  if (card.name === ARCANIST_NAMES.VIRIDIS) {
    return {
      yes: hasOpponentFaceUpSpell(analysis),
      priority: 7,
      reason: "bounce opposing face-up spell and gain LP",
    };
  }

  return { yes: false, reason: "no proactive monster effect" };
}

export function shouldActivateHandIgnition(card, analysis = {}) {
  if (card?.name !== ARCANIST_NAMES.ALBUS) {
    return { yes: false, reason: "not Albus hand effect" };
  }
  const hasArcanistField = getOwnArcanistHosts(analysis).length > 0;
  const fieldCapacity = 5 - (analysis.field || []).length;
  return {
    yes: hasArcanistField && fieldCapacity > 0,
    priority: 10,
    reason: "free Arcanist body from hand",
  };
}

export function getTributeRequirementFor(card, playerState) {
  return getGenericTributeRequirementFor(card, playerState);
}

function evaluateArcanistTributeValue(card, analysis = {}) {
  if (!card) return 0;
  let value = evaluateArcanistCardValue(card, analysis);
  if (hasArcanistEquip(card)) value += 20;
  if (card.name === ARCANIST_NAMES.AZRATH) value += 12;
  if (card.name === ARCANIST_NAMES.ELEMENTALIST) value += 20;
  if (card.name === ARCANIST_NAMES.MASTER_OF_MIRRORS) value += 10;
  if (card.hasAttacked || card.usedEffectThisTurn) value -= 2;
  return value;
}

export function selectBestTributes(field, tributesNeeded, cardToSummon, context = {}) {
  return selectGenericTributes(
    field,
    tributesNeeded,
    cardToSummon,
    context,
    {
      evaluateCardValue: (card, analysis) =>
        evaluateArcanistTributeValue(card, analysis),
    },
  );
}

export function evaluateArcanistTributeTrade(cardToSummon, tributes, analysis = {}) {
  return evaluateTributeSummonCost(
    cardToSummon,
    tributes,
    { evaluationContext: analysis },
    {
      isProtectedTribute: (card) =>
        hasArcanistEquip(card) ||
        [
          ARCANIST_NAMES.AZRATH,
          ARCANIST_NAMES.ELEMENTALIST,
          ARCANIST_NAMES.MASTER_OF_MIRRORS,
        ].includes(card?.name),
      evaluateSummonPayoff: (card) => {
        if (card?.name === ARCANIST_NAMES.ELEMENTALIST) {
          return { ok: true, reason: "Elementalist is a finisher payoff" };
        }
        if (
          card?.name === ARCANIST_NAMES.MASTER_OF_MIRRORS &&
          (analysis.graveyard || []).some(isArcanistSpell)
        ) {
          return { ok: true, reason: "Master recycles spells and draws" };
        }
        return { ok: false, reason: "no immediate Arcanist payoff" };
      },
    },
  );
}

export function rankSearchCandidates(cards = [], action = {}, ctx = {}) {
  const analysis = ctx.analysis || {};
  const sourceName = ctx.source?.name || "";
  const candidates = [...cards];

  const scoreCard = (card) => {
    if (!card) return -999;
    let score = evaluateArcanistCardValue(card, analysis);

    if (isArcanistEquip(card)) score += 2;
    if (card.name === ARCANIST_NAMES.GRAND_LIBRARY && !analysis.fieldSpell) {
      score += sourceName === ARCANIST_NAMES.APPRENTICE ? 8 : 4;
    }
    if (
      card.name === ARCANIST_NAMES.GRIMOIRE &&
      getOwnArcanistHosts(analysis).length > 0 &&
      !hasFaceUpByName(analysis.spellTrap || [], ARCANIST_NAMES.GRIMOIRE)
    ) {
      score += 7;
    }
    if (card.name === ARCANIST_NAMES.SEISMIC_IMPACT) {
      score += getOpponentCardCount(analysis) > 0 ? 5 : 1;
      if (controlsArcanistEquip(analysis.player)) score += 3;
    }
    if (card.name === ARCANIST_NAMES.INK_RIVER) {
      score += (analysis.hand || []).filter(isArcanistSpell).length >= 2 ? 3 : 0;
    }
    if (card.name === ARCANIST_NAMES.APPRENTICE && analysis.summonAvailable) {
      score += 5;
    }
    if (card.name === ARCANIST_NAMES.AZRATH && (analysis.oppField || []).length > 0) {
      score += 4;
    }
    if (card.name === ARCANIST_NAMES.TERA && (analysis.oppField || []).length > 0) {
      score += 2;
    }
    if (card.name === ARCANIST_NAMES.VIRIDIS && hasOpponentFaceUpSpell(analysis)) {
      score += 3;
    }

    if (action.zone === "graveyard" || ctx.source?.name === ARCANIST_NAMES.INK_RIVER) {
      const spellRank = getNameRank(card.name, ARCANIST_SPELL_RECOVERY_ORDER);
      const monsterRank = getNameRank(card.name, ARCANIST_MONSTER_RECOVERY_ORDER);
      score += Math.max(0, 20 - Math.min(spellRank, monsterRank));
    }

    return score;
  };

  return candidates.sort((a, b) => scoreCard(b) - scoreCard(a));
}

export function evaluateRecruitCandidate(cards = [], ctx = {}) {
  const analysis = ctx.analysis || {};
  const sourceName = ctx.source?.name || "";
  const scores = (cards || []).map((card) => {
    let score = evaluateArcanistCardValue(card, analysis);
    if (sourceName === ARCANIST_NAMES.GRAND_LIBRARY) {
      if (card.name === ARCANIST_NAMES.AZRATH && (analysis.oppField || []).length > 0) score += 7;
      if (card.name === ARCANIST_NAMES.TERA && (analysis.oppField || []).length > 0) score += 4;
      if (card.name === ARCANIST_NAMES.VIRIDIS && hasOpponentFaceUpSpell(analysis)) score += 4;
      if (card.name === ARCANIST_NAMES.ALBUS) score += 2;
      if (card.name === ARCANIST_NAMES.APPRENTICE) score -= 2;
    }
    if (sourceName === ARCANIST_NAMES.MASTER_OF_MIRRORS) {
      if (card.name === ARCANIST_NAMES.AZRATH && (analysis.oppField || []).length > 0) score += 5;
      if (card.name === ARCANIST_NAMES.APPRENTICE) score += 3;
      if (card.name === ARCANIST_NAMES.ALBUS) score += 2;
    }
    return { card, score };
  });
  scores.sort((a, b) => b.score - a.score);
  return { best: scores[0]?.card || null, scores };
}
