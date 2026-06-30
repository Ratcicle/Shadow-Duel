import BaseStrategy from "./BaseStrategy.js";
import { buildStrategyAnalysis } from "./common/analysis.js";
import {
  getGenericHandSpellActions,
  getGenericIgnitionEffectActions,
  getGenericNormalSummonActions,
} from "./common/actionGeneration.js";
import { getGenericSetBackrowActions } from "./common/backrowPlanning.js";
import { sequenceActionsByPriority } from "./common/actionSequencing.js";
import { getBattleStat, getEffectiveAtk } from "./common/cardStats.js";
import { findIgnitionEffect } from "./common/effectDiscovery.js";
import { applyGenericSimulatedMainPhaseAction } from "./common/simulation.js";
import {
  canActivateMonsterEffect,
  canActivateSpellFromHand,
  canActivateSpellTrapEffect,
} from "./common/previewGuards.js";
import {
  applyBurningWestSimulatedBattleRewards,
  prepareBurningWestSimulatedBattle,
  scoreBurningWestBattleAttackCandidate,
} from "./burningwest/battle.js";
import { getMonsterTypeLabel } from "../i18n.js";

const ARCHETYPE = "Burning West";

const BW = {
  GUNSLINGER: "Gunslinger of the Burning West",
  WANTED: "Wanted in the Burning West",
  UNDERTAKER: "Undertaker of the Burning West",
  BUTCHER: "Butcher of the Burning West",
  SPECIALIST: "Specialist of the Burning West",
  PEACEMAKER: "Burning Peacemaker",
  QUICK_DRAW: "Quick Draw in the Burning West",
  FUNERAL: "Funeral at Sunset",
  DEADEYE: "Deadeye of the Burning West",
  PREACHER: "Preacher of the Burning West",
  SHERIFF: "Sheriff of the Burning West",
  CRASH_TOWN: "Crash Town, the Burning City",
  AMBUSH: "Ambush in Crash Town",
  REWARD: "Burning Reward",
  LAW: "Law in the Burning West",
  EXECUTIONER: "Executioner of the Burning West",
};

const PEACEMAKER_TARGET_ORDER = [
  BW.SPECIALIST,
  BW.SHERIFF,
  BW.UNDERTAKER,
  BW.GUNSLINGER,
  BW.BUTCHER,
];

const BACKROW_NAMES = new Set([
  BW.AMBUSH,
  BW.REWARD,
  BW.LAW,
  BW.QUICK_DRAW,
]);

const RECOVERY_PRIORITY = [
  BW.LAW,
  BW.AMBUSH,
  BW.REWARD,
  BW.DEADEYE,
  BW.WANTED,
  BW.PEACEMAKER,
  BW.QUICK_DRAW,
  BW.FUNERAL,
  BW.SPECIALIST,
  BW.UNDERTAKER,
  BW.GUNSLINGER,
  BW.BUTCHER,
  BW.PREACHER,
];

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function isBurningWest(card) {
  if (!card) return false;
  if (card.archetype === ARCHETYPE) return true;
  return Array.isArray(card.archetypes) && card.archetypes.includes(ARCHETYPE);
}

function isFaceUpBurningWestMonster(card) {
  return (
    card?.cardKind === "monster" &&
    !card.isFacedown &&
    isBurningWest(card)
  );
}

function isFaceUpWanted(card) {
  return (
    card?.name === BW.WANTED &&
    card.cardKind === "spell" &&
    card.subtype === "continuous" &&
    !card.isFacedown
  );
}

function hasName(cards = [], name) {
  return (cards || []).some((card) => card?.name === name);
}

function hasActiveDeclaration(card, stateKey, turnCounter = 0) {
  const declaration = card?.declaredValues?.[stateKey];
  if (!declaration) return false;
  if (declaration.expiresOnTurn === null || declaration.expiresOnTurn === undefined) {
    return true;
  }
  return Number(declaration.expiresOnTurn) >= Number(turnCounter || 0);
}

function getActiveDeclaredTypeValues(cards = [], turnCounter = 0) {
  const values = [];
  for (const card of cards || []) {
    const declaredValues = card?.declaredValues || {};
    for (const declaration of Object.values(declaredValues)) {
      if (!declaration || declaration.property !== "type" || !declaration.value) {
        continue;
      }
      if (
        declaration.expiresOnTurn !== null &&
        declaration.expiresOnTurn !== undefined &&
        Number(declaration.expiresOnTurn) < Number(turnCounter || 0)
      ) {
        continue;
      }
      values.push(declaration.value);
    }
  }
  return unique(values);
}

function isExtraDeckMonster(card) {
  return ["fusion", "ascension", "synchro"].includes(card?.monsterType);
}

function getThreatScore(card) {
  if (!card || card.cardKind !== "monster") return 0;
  let score = getBattleStat(card) + (card.level || 0) * 80;
  if (card.position === "attack") score += 250;
  if (isExtraDeckMonster(card)) score += 650;
  return score;
}

function getBurningWestCardValue(card) {
  if (!card) return 0;
  switch (card.name) {
    case BW.WANTED:
      return 95;
    case BW.BUTCHER:
      return 90;
    case BW.PEACEMAKER:
      return 84;
    case BW.SPECIALIST:
      return 78;
    case BW.UNDERTAKER:
      return 75;
    case BW.GUNSLINGER:
      return 70;
    case BW.AMBUSH:
    case BW.LAW:
      return 66;
    case BW.REWARD:
    case BW.QUICK_DRAW:
      return 62;
    case BW.PREACHER:
      return 58;
    case BW.SHERIFF:
      return 56;
    default:
      return Math.max(card.atk || 0, card.def || 0) / 100;
  }
}

function getInstanceIds(card) {
  return [
    card?.instanceId,
    card?.fieldPresenceId,
    card?.uid,
    card?.uuid,
  ].filter((id) => id !== null && id !== undefined);
}

function countTypes(monsters = []) {
  const counts = new Map();
  for (const monster of monsters) {
    if (!monster?.type) continue;
    counts.set(monster.type, (counts.get(monster.type) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type]) => type);
}

function getPreferredTypeNames(types = []) {
  return unique(
    types.flatMap((type) => [
      type,
      typeof getMonsterTypeLabel === "function"
        ? getMonsterTypeLabel(type)
        : type,
    ]),
  );
}

function canBeatMonster(attacker, defender) {
  if (!attacker || !defender) return false;
  return getEffectiveAtk(attacker) > getBattleStat(defender);
}

function canBattleThisTurn(card) {
  return (
    card?.cardKind === "monster" &&
    !card.isFacedown &&
    card.position !== "defense" &&
    !card.cannotAttackThisTurn &&
    !card.hasAttacked &&
    getEffectiveAtk(card) > 0
  );
}

function getTypeCounts(monsters = []) {
  const counts = new Map();
  for (const monster of monsters) {
    if (!monster?.type) continue;
    counts.set(monster.type, (counts.get(monster.type) || 0) + 1);
  }
  return counts;
}

function addTypeWeight(scores, type, amount) {
  if (!type) return;
  scores.set(type, (scores.get(type) || 0) + amount);
}

function getSortedTypesByScore(scores) {
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type]) => type);
}

function buildBattlePlans(attackers = [], targets = []) {
  const plans = [];
  for (const attacker of attackers.filter(canBattleThisTurn)) {
    for (const target of targets || []) {
      if (!target || target.isFacedown) continue;
      if (!canBeatMonster(attacker, target)) continue;
      plans.push({
        attacker,
        target,
        type: target.type || null,
        score:
          getThreatScore(target) +
          getEffectiveAtk(attacker) / 10 +
          (isExtraDeckMonster(target) ? 500 : 0),
      });
    }
  }
  return plans.sort((a, b) => b.score - a.score);
}

function buildQuickDrawPairs(attackers = [], targets = []) {
  const pairs = [];
  for (const attacker of attackers.filter(canBattleThisTurn)) {
    for (const target of targets || []) {
      if (!target || target.isFacedown) continue;
      const diff = Math.abs(getEffectiveAtk(attacker) - getEffectiveAtk(target));
      const cannotBeatNormally = !canBeatMonster(attacker, target);
      const resetFriendly = diff <= 500;
      const valuableThreat =
        getThreatScore(target) >= 1800 || isExtraDeckMonster(target);
      if (!cannotBeatNormally && !resetFriendly && !valuableThreat) continue;
      pairs.push({
        attacker,
        target,
        diff,
        score:
          getThreatScore(target) +
          (cannotBeatNormally ? 650 : 0) +
          (resetFriendly ? 350 : 0) +
          (isExtraDeckMonster(target) ? 500 : 0) -
          diff / 4,
      });
    }
  }
  return pairs.sort((a, b) => b.score - a.score);
}

function cardMentionsBurningWest(card) {
  return (
    isBurningWest(card) ||
    String(card?.description || "").includes("Burning West")
  );
}

function namesFromCards(cards = []) {
  return unique((cards || []).map((card) => card?.name));
}

function buildOpponentPreference(analysis) {
  const ordered = [
    analysis.quickDrawPair?.target,
    analysis.bestBattlePlan?.target,
    analysis.battleDestroyableOpponent,
    analysis.strongestOpponent,
    ...(analysis.faceUpOpponentMonsters || []),
  ]
    .filter(Boolean)
    .slice()
    .sort((a, b) => getThreatScore(b) - getThreatScore(a));
  return {
    intent: "harm",
    role: "removal",
    preferredNames: unique(ordered.map((card) => card.name).filter(Boolean)),
    preferredInstanceIds: ordered.flatMap(getInstanceIds),
  };
}

function buildOwnOffensivePreference(analysis) {
  const preferredCards = [
    analysis.quickDrawPair?.attacker,
    analysis.bestBattlePlan?.attacker,
    analysis.bestPeacemakerTarget,
    ...(analysis.faceUpBurningWestMonsters || []),
  ].filter(Boolean);
  const preferredNames =
    preferredCards.length > 0
      ? preferredCards.map((card) => card.name)
      : PEACEMAKER_TARGET_ORDER;
  const avoidNames = (analysis.faceUpBurningWestMonsters || [])
    .filter((card) => !canBattleThisTurn(card))
    .map((card) => card.name);
  return {
    intent: "benefit",
    role: "temporary_stat_buff",
    purpose: "offense",
    preferredNames: unique(preferredNames),
    preferredInstanceIds: preferredCards.flatMap(getInstanceIds),
    avoidNames: unique(avoidNames),
    attackers: preferredCards,
  };
}

function buildDeclaredTypePreference(analysis) {
  const preferredTypes = analysis.plannedDeclaredType
    ? [analysis.plannedDeclaredType]
    : analysis.preferredDeclaredTypes || [];
  return {
    intent: "benefit",
    role: "named_preference",
    preferredNames: getPreferredTypeNames(preferredTypes),
  };
}

function buildQuickDrawOwnPreference(analysis) {
  const attacker = analysis.quickDrawPair?.attacker || null;
  return {
    intent: "benefit",
    role: "named_preference",
    preferredNames: attacker ? [attacker.name] : PEACEMAKER_TARGET_ORDER,
    preferredInstanceIds: attacker ? getInstanceIds(attacker) : [],
  };
}

function buildQuickDrawOpponentPreference(analysis) {
  const target = analysis.quickDrawPair?.target || null;
  return {
    intent: "harm",
    role: "removal",
    preferredNames: target ? [target.name] : [],
    preferredInstanceIds: target ? getInstanceIds(target) : [],
  };
}

function buildWantedCasePreference(analysis) {
  const preferredNames = [];
  if (
    analysis.fieldCapacity > 0 &&
    analysis.handBurningWestLevel5OrLower.length > 0
  ) {
    preferredNames.push("burning_west_wanted_summon");
  }
  if (analysis.bestBattlePlan || analysis.faceUpBurningWestMonsters.length > 0) {
    preferredNames.push("burning_west_wanted_buff");
  }
  preferredNames.push("burning_west_wanted_recover");
  return {
    intent: "benefit",
    role: "named_preference",
    preferredNames,
  };
}

function buildRecoveryPreference(analysis) {
  const contextual = [];
  if (analysis.oppPressure) contextual.push(BW.LAW, BW.AMBUSH);
  if (analysis.hasLikelyDeclaredBattle) contextual.push(BW.REWARD, BW.DEADEYE);
  if (!analysis.wantedActive) contextual.push(BW.WANTED);
  if (analysis.bestPeacemakerTarget) contextual.push(BW.PEACEMAKER);
  contextual.push(...RECOVERY_PRIORITY);
  return {
    intent: "benefit",
    role: "named_preference",
    preferredNames: unique(contextual),
  };
}

function buildBurningWestActivationContext(card, analysis, options = {}) {
  const declaredTypePreference = buildDeclaredTypePreference(analysis);
  const ownOffensivePreference = buildOwnOffensivePreference(analysis);
  const opponentPreference = buildOpponentPreference(analysis);
  const quickDrawOwnPreference = buildQuickDrawOwnPreference(analysis);
  const quickDrawOpponentPreference = buildQuickDrawOpponentPreference(analysis);
  const wantedCasePreference = buildWantedCasePreference(analysis);
  const recoveryPreference = buildRecoveryPreference(analysis);

  const targetPreferences = {
    burning_west_wanted_declare_type_choice: declaredTypePreference,
    deadeye_of_the_burning_west_choice: declaredTypePreference,
    burning_west_sheriff_declare_type_choice: declaredTypePreference,
    burning_peacemaker_equip_target: ownOffensivePreference,
    burning_west_wanted_buff_target: ownOffensivePreference,
    burning_west_wanted_reward_selection: recoveryPreference,
    quick_draw_burning_west_target: quickDrawOwnPreference,
    quick_draw_opponent_target: quickDrawOpponentPreference,
    burning_west_specialist_control_target: opponentPreference,
    burning_west_executioner_ascension_recover_selection: recoveryPreference,
    action_case_choice: wantedCasePreference,
  };

  const effectId = options.effect?.id || null;
  const isDeclaration =
    card?.name === BW.WANTED || effectId?.includes?.("declare_type");

  return {
    autoSelectTargets: true,
    autoSelectSingleTarget: true,
    ...options,
    actionContext: {
      targetPreference: isDeclaration ? declaredTypePreference : undefined,
      targetPreferences,
      costPreferences: {
        archetype: ARCHETYPE,
        preserveNames: [BW.SPECIALIST, BW.UNDERTAKER, BW.SHERIFF],
        preferNames: [BW.BUTCHER, BW.GUNSLINGER, BW.PREACHER],
      },
      specialSummonPositions: {
        byName: {
          [BW.GUNSLINGER]: "attack",
          [BW.SPECIALIST]: "attack",
          [BW.SHERIFF]: "attack",
          [BW.EXECUTIONER]: "attack",
          [BW.UNDERTAKER]: analysis.oppPressure ? "defense" : "attack",
          [BW.PREACHER]: "defense",
        },
      },
    },
  };
}

export default class BurningWestStrategy extends BaseStrategy {
  constructor(bot) {
    super(bot);
    this.currentAnalysis = null;
    this.thoughtProcess = [];
  }

  get archetypeLabel() {
    return "Burning West";
  }

  think(thought) {
    this.thoughtProcess.push(thought);
    if (this.bot?.debug) {
      console.log(`[Burning West AI] ${thought}`);
    }
  }

  analyzeGameState(game) {
    this.thoughtProcess = [];
    const player = game?._isPerspectiveState === true
      ? game?.bot || this.bot || null
      : this.bot || game?.bot || null;
    const opponent = player ? this.getOpponent(game, player) : null;
    const base = buildStrategyAnalysis({
      bot: player,
      opponent,
      game,
      strategy: this,
    });

    const field = base.field || [];
    const hand = base.hand || [];
    const spellTrap = base.spellTrap || [];
    const graveyard = base.graveyard || [];
    const deck = base.deck || [];
    const opponentMonsters = (base.oppField || []).filter(
      (card) => card?.cardKind === "monster",
    );
    const faceUpOpponentMonsters = opponentMonsters.filter(
      (card) => !card.isFacedown,
    );
    const faceUpBurningWestMonsters = field.filter(isFaceUpBurningWestMonster);
    const currentTurn = base.currentTurn || game?.turnCounter || 0;
    const wantedCards = spellTrap.filter(isFaceUpWanted);
    const wantedActive = wantedCards.length > 0;
    const wantedDeclarationActive = wantedCards.some((card) =>
      hasActiveDeclaration(card, "burning_west_wanted_type", currentTurn),
    );
    const activeDeclaredTypes = getActiveDeclaredTypeValues(
      [...field, ...spellTrap],
      currentTurn,
    );

    const handBurningWestMonsters = hand.filter(
      (card) => card?.cardKind === "monster" && isBurningWest(card),
    );
    const handBurningWestLevel5OrLower = handBurningWestMonsters.filter(
      (card) => (card.level || 0) <= 5,
    );
    const fieldCapacity = Math.max(0, 5 - field.length);
    const hasSummonableBurningWestInHand = handBurningWestMonsters.some(
      (card) => !card.cannotBeNormalSummonedOrSet,
    );
    const strongestOpponentAtk = opponentMonsters.reduce(
      (max, card) => Math.max(max, card?.isFacedown ? 0 : getEffectiveAtk(card)),
      0,
    );
    const oppPressure =
      opponentMonsters.length >= 2 ||
      strongestOpponentAtk >= Math.max(1800, (base.lp || 8000) / 3);
    const hasBurningWestAttacker = faceUpBurningWestMonsters.some(
      (card) =>
        card.position !== "defense" &&
        !card.cannotAttackThisTurn &&
        getEffectiveAtk(card) > 0,
    );
    const readyBurningWestAttackers =
      faceUpBurningWestMonsters.filter(canBattleThisTurn);
    const battlePlans = buildBattlePlans(
      faceUpBurningWestMonsters,
      faceUpOpponentMonsters,
    );
    const bestBattlePlan = battlePlans[0] || null;
    const battleDestroyableOpponent = bestBattlePlan?.target || null;
    const strongestOpponent =
      faceUpOpponentMonsters
        .slice()
        .sort((a, b) => getThreatScore(b) - getThreatScore(a))[0] || null;
    const quickDrawPairs = buildQuickDrawPairs(
      faceUpBurningWestMonsters,
      faceUpOpponentMonsters,
    );
    const quickDrawPair = quickDrawPairs[0] || null;
    const typeScores = new Map();
    if (bestBattlePlan?.type) addTypeWeight(typeScores, bestBattlePlan.type, 120);
    for (const type of activeDeclaredTypes) {
      const stillRelevant = faceUpOpponentMonsters.some(
        (monster) => monster?.type === type,
      );
      addTypeWeight(typeScores, type, stillRelevant ? 110 : 25);
    }
    if (isExtraDeckMonster(strongestOpponent)) {
      addTypeWeight(typeScores, strongestOpponent.type, 85);
    }
    if (strongestOpponent?.type) addTypeWeight(typeScores, strongestOpponent.type, 65);
    const fieldTypeCounts = getTypeCounts(faceUpOpponentMonsters);
    for (const [type, count] of fieldTypeCounts.entries()) {
      addTypeWeight(typeScores, type, count * 30);
    }
    const graveyardTypeCounts = getTypeCounts(
      (base.oppGraveyard || []).filter((card) => card?.cardKind === "monster"),
    );
    for (const [type, count] of graveyardTypeCounts.entries()) {
      addTypeWeight(typeScores, type, count * 10);
    }
    const preferredDeclaredTypes = getSortedTypesByScore(typeScores);
    const plannedDeclaredType = preferredDeclaredTypes[0] || null;
    const hasPeacemakerTarget =
      faceUpBurningWestMonsters.length > 0 ||
      hasSummonableBurningWestInHand;
    const bestPeacemakerTarget =
      faceUpBurningWestMonsters
        .slice()
        .filter(canBattleThisTurn)
        .sort((a, b) => {
          const rankA = PEACEMAKER_TARGET_ORDER.indexOf(a.name);
          const rankB = PEACEMAKER_TARGET_ORDER.indexOf(b.name);
          const normalizedA = rankA >= 0 ? rankA : 999;
          const normalizedB = rankB >= 0 ? rankB : 999;
          if (normalizedA !== normalizedB) return normalizedA - normalizedB;
          return getEffectiveAtk(b) - getEffectiveAtk(a);
        })[0] || null;
    const recoverableBurningWestCards = graveyard.filter(cardMentionsBurningWest);
    const recoveryNames = namesFromCards(recoverableBurningWestCards);
    const hasLikelyDeclaredBattle =
      !!bestBattlePlan &&
      !!plannedDeclaredType &&
      bestBattlePlan.target?.type === plannedDeclaredType;
    const hasRelevantTypePlan =
      !!plannedDeclaredType &&
      (hasLikelyDeclaredBattle ||
        fieldTypeCounts.get(plannedDeclaredType) >= 2 ||
        isExtraDeckMonster(strongestOpponent));
    const shouldTributeSheriff =
      hasRelevantTypePlan && field.length > 0 && fieldCapacity > 0;

    const analysis = {
      ...base,
      canNormalSummon: base.normalSummonsAvailable > 0 && fieldCapacity > 0,
      fieldCapacity,
      faceUpBurningWestMonsters,
      handBurningWestMonsters,
      handBurningWestLevel5OrLower,
      readyBurningWestAttackers,
      opponentMonsters,
      faceUpOpponentMonsters,
      strongestOpponent,
      bestBattlePlan,
      battlePlans,
      battleDestroyableOpponent,
      quickDrawPair,
      quickDrawPairs,
      preferredDeclaredTypes,
      plannedDeclaredType,
      activeDeclaredTypes,
      fieldTypeCounts,
      graveyardTypeCounts,
      wantedActive,
      wantedDeclarationActive,
      wantedInHand: hasName(hand, BW.WANTED),
      wantedSet: spellTrap.some(
        (card) => card?.name === BW.WANTED && card.isFacedown,
      ),
      peacemakerInHand: hasName(hand, BW.PEACEMAKER),
      peacemakerInGraveyard: hasName(graveyard, BW.PEACEMAKER),
      wantedAvailableFromDeckOrGraveyard:
        hasName(deck, BW.WANTED) || hasName(graveyard, BW.WANTED),
      recoverableBurningWestCards,
      recoveryNames,
      hasPeacemakerTarget,
      bestPeacemakerTarget,
      hasBurningWestAttacker,
      hasLikelyDeclaredBattle,
      hasRelevantTypePlan,
      shouldTributeSheriff,
      oppPressure,
      hasBackrowSpace: spellTrap.length < 5,
    };

    this.currentAnalysis = analysis;
    return analysis;
  }

  buildActivationContextForEffect({
    sourceCard,
    effect,
    player,
    game,
    activationZone,
  } = {}) {
    if (!sourceCard || !player || !game) return null;
    const analysis = this.analyzeGameState(game);
    const zone = activationZone || effect?.requireZone || "field";
    return this.buildBurningWestActivationContext(sourceCard, analysis, {
      zone,
      activationZone: zone,
      sourceZone: zone,
      fromHand: zone === "hand",
      effect,
    });
  }

  buildBurningWestActivationContext(card, analysis, options = {}) {
    return buildBurningWestActivationContext(card, analysis, options);
  }

  getSpellActions(game, player, analysis) {
    return getGenericHandSpellActions({
      game,
      player,
      analysis,
      shouldPlay: (card) => {
        if (card.name === BW.WANTED && !analysis.wantedActive) {
          return {
            yes: true,
            priority: 100,
            reason: "establish Burning West type engine",
          };
        }
        if (card.name === BW.PEACEMAKER && analysis.hasPeacemakerTarget) {
          return {
            yes: true,
            priority:
              analysis.bestPeacemakerTarget ? 76 : 46,
            reason: "equip Peacemaker to a useful Burning West attacker",
          };
        }
        if (card.name === BW.DEADEYE) {
          if (!analysis.hasLikelyDeclaredBattle) return { yes: false };
          return {
            yes: true,
            priority: isExtraDeckMonster(analysis.bestBattlePlan?.target)
              ? 80
              : 66,
            reason: "declare Type for a likely battle-destroy payoff",
          };
        }
        if (card.name === BW.QUICK_DRAW) {
          if (!analysis.quickDrawPair) return { yes: false };
          return {
            yes: true,
            priority: analysis.quickDrawPair.diff <= 500 ? 64 : 52,
            reason: "use Quick Draw on a valuable battle pair",
          };
        }
        return { yes: false };
      },
      buildActivationContext: (card, currentAnalysis, context) =>
        this.buildBurningWestActivationContext(card, currentAnalysis, {
          fromHand: true,
          activationZone: "hand",
          sourceZone: "hand",
          effect: context?.effect || null,
        }),
      canActivate: ({ card, activationContext }) => {
        if (
          card.name === BW.PEACEMAKER &&
          analysis.faceUpBurningWestMonsters.length === 0 &&
          analysis.hasPeacemakerTarget
        ) {
          return true;
        }
        return canActivateSpellFromHand(game, card, player, activationContext, {
          bot: player,
          debugLabel: "BurningWestSpell",
        });
      },
    });
  }

  getHandIgnitionActions(game, player, analysis) {
    return getGenericIgnitionEffectActions({
      game,
      player,
      cards: analysis.hand,
      analysis,
      type: "handIgnition",
      sourceZone: "hand",
      indexFields: ["index"],
      findEffect: (card) => findIgnitionEffect(card, "hand"),
      shouldActivate: (card) => {
        if (card.name !== BW.GUNSLINGER) return { yes: false };
        if (analysis.fieldCapacity <= 0) return { yes: false };
        if (!analysis.wantedActive && !analysis.wantedInHand) {
          return { yes: false };
        }
        return {
          yes: true,
          priority: analysis.wantedActive ? 82 : 48,
          reason: "extend Gunslinger through Wanted",
        };
      },
      buildActivationContext: (card, currentAnalysis, context) =>
        this.buildBurningWestActivationContext(card, currentAnalysis, {
          fromHand: true,
          activationZone: "hand",
          sourceZone: "hand",
          effect: context?.effect || null,
        }),
      canActivate: ({ card, activationContext }) => {
        if (card.name === BW.GUNSLINGER && !analysis.wantedActive && analysis.wantedInHand) {
          return true;
        }
        return canActivateMonsterEffect(
          game,
          card,
          player,
          "hand",
          activationContext,
          {
            bot: player,
            debugLabel: "BurningWestHandIgnition",
          },
        );
      },
    });
  }

  getSpellTrapEffectActions(game, player, analysis) {
    return getGenericIgnitionEffectActions({
      game,
      player,
      cards: analysis.spellTrap,
      analysis,
      type: "spellTrapEffect",
      sourceZone: "spellTrap",
      indexFields: ["zoneIndex", "index"],
      findEffect: (card) => findIgnitionEffect(card, "spellTrap"),
      shouldActivate: (card) => {
        if (card.name !== BW.WANTED || card.isFacedown) return { yes: false };
        if (analysis.wantedDeclarationActive) return { yes: false };
        return {
          yes: true,
          priority: analysis.faceUpOpponentMonsters.length > 0 ? 88 : 58,
          reason: "declare the relevant monster Type for Wanted",
        };
      },
      buildActivationContext: (card, currentAnalysis, context) =>
        this.buildBurningWestActivationContext(card, currentAnalysis, {
          fromHand: false,
          activationZone: "spellTrap",
          sourceZone: "spellTrap",
          effect: context?.effect || null,
        }),
      canActivate: ({ card, activationContext }) =>
        canActivateSpellTrapEffect(
          game,
          card,
          player,
          "spellTrap",
          activationContext,
          {
            bot: player,
            debugLabel: "BurningWestSpellTrapEffect",
          },
        ),
    });
  }

  getSummonActions(_game, player, analysis) {
    return getGenericNormalSummonActions({
      player,
      analysis,
      getTributeRequirement: (card, currentPlayer) =>
        this.getTributeRequirementFor(card, currentPlayer),
      shouldSummon: (card, currentAnalysis, tributeInfo) => {
        if (!isBurningWest(card)) return { yes: false };
        const tributesNeeded = Math.max(
          0,
          Number(tributeInfo?.tributesNeeded || 0),
        );
        if (tributesNeeded > 0 && currentAnalysis.field.length < tributesNeeded) {
          return { yes: false };
        }
        if (card.name === BW.BUTCHER) {
          return {
            yes: true,
            priority: 92,
            position: "attack",
            reason: "normal summon Butcher as the starter",
          };
        }
        if (card.name === BW.GUNSLINGER) {
          if (currentAnalysis.wantedActive || currentAnalysis.wantedInHand) {
            return { yes: false };
          }
          return {
            yes: true,
            priority: 54,
            position: "attack",
            reason: "normal summon Gunslinger as fallback pressure",
          };
        }
        if (card.name === BW.SHERIFF) {
          if (!currentAnalysis.shouldTributeSheriff || tributesNeeded <= 0) {
            return { yes: false };
          }
          return {
            yes: true,
            priority: 50,
            position: "attack",
            reason: "tribute summon Sheriff for a relevant declared Type",
          };
        }
        if ([BW.SPECIALIST, BW.UNDERTAKER].includes(card.name)) {
          if (tributesNeeded <= 0 || currentAnalysis.field.length >= tributesNeeded) {
            return {
              yes: true,
              priority: card.name === BW.SPECIALIST ? 44 : 42,
              position:
                card.name === BW.UNDERTAKER && currentAnalysis.oppPressure
                  ? "defense"
                  : "attack",
              reason: "summon a higher-value Burning West body",
            };
          }
        }
        if (card.name === BW.PREACHER && currentAnalysis.field.length === 0) {
          return {
            yes: true,
            priority: currentAnalysis.oppPressure ? 34 : 18,
            position: "defense",
            reason: "use Preacher only when a body is needed",
          };
        }
        return { yes: false };
      },
    });
  }

  getGraveyardSpellEffectActions(game, player, analysis) {
    return getGenericIgnitionEffectActions({
      game,
      player,
      cards: analysis.graveyard,
      analysis,
      type: "graveyardSpellEffect",
      sourceZone: "graveyard",
      indexFields: ["graveyardIndex"],
      findEffect: (card) => findIgnitionEffect(card, "graveyard"),
      shouldActivate: (card) => {
        if (card.name !== BW.PEACEMAKER) return { yes: false };
        if (analysis.wantedActive) return { yes: false };
        if (!analysis.wantedAvailableFromDeckOrGraveyard) return { yes: false };
        return {
          yes: true,
          priority: 86,
          reason: "banish Peacemaker to recover access to Wanted",
        };
      },
      buildActivationContext: (card, currentAnalysis, context) =>
        this.buildBurningWestActivationContext(card, currentAnalysis, {
          fromHand: false,
          activationZone: "graveyard",
          sourceZone: "graveyard",
          effect: context?.effect || null,
        }),
      canActivate: ({ card, activationContext }) =>
        canActivateSpellTrapEffect(
          game,
          card,
          player,
          "graveyard",
          activationContext,
          {
            bot: player,
            debugLabel: "BurningWestGraveyardSpell",
          },
        ),
    });
  }

  getSetSpellTrapActions(game, player, analysis) {
    return getGenericSetBackrowActions({
      bot: player,
      player,
      analysis,
      game,
      opponent: analysis.opponent,
      basePriority: 24,
      defaultReason: "prepare Burning West backrow",
      policy: {
        acceptsCard: (card) => BACKROW_NAMES.has(card?.name),
        shouldSet: (card) => {
          if (!analysis.hasBackrowSpace) return false;
          if ([BW.AMBUSH, BW.LAW].includes(card.name)) {
            return {
              yes: true,
              priority: analysis.oppPressure ? 62 : 38,
              reason: "hold defensive Burning West response",
            };
          }
          if (card.name === BW.REWARD) {
            return {
              yes: analysis.hasBurningWestAttacker || analysis.wantedActive,
              priority: 36,
              reason: "prepare battle reward payoff",
            };
          }
          if (card.name === BW.QUICK_DRAW) {
            return {
              yes:
                analysis.hasBurningWestAttacker &&
                analysis.faceUpOpponentMonsters.length > 0,
              priority: 34,
              reason: "prepare tactical battle interaction",
            };
          }
          return false;
        },
      },
    });
  }

  generateMainPhaseActions(game) {
    const analysis = this.analyzeGameState(game);
    const player = analysis.player;
    if (!player) return [];

    return this.sequenceActions([
      ...this.getSpellActions(game, player, analysis),
      ...this.getSpellTrapEffectActions(game, player, analysis),
      ...this.getHandIgnitionActions(game, player, analysis),
      ...this.getSummonActions(game, player, analysis),
      ...this.getGraveyardSpellEffectActions(game, player, analysis),
      ...this.getSetSpellTrapActions(game, player, analysis),
    ]);
  }

  sequenceActions(actions = []) {
    return sequenceActionsByPriority(actions, {
      typeOrder: {
        spell: 0,
        spellTrapEffect: 1,
        handIgnition: 2,
        summon: 3,
        graveyardSpellEffect: 4,
        monsterEffect: 5,
        set_spell_trap: 6,
      },
    });
  }

  rankSearchCandidates(cards = [], action = {}, ctx = {}) {
    const game = ctx.game || ctx.ctx?.game || null;
    const analysis = game ? this.analyzeGameState(game) : this.currentAnalysis || {};
    const filters = action?.filters || action?.candidateFilters || {};
    const cardKinds = Array.isArray(filters.cardKind)
      ? filters.cardKind
      : [filters.cardKind].filter(Boolean);
    const isBurningWestSearch =
      filters.archetype === ARCHETYPE || action?.archetype === ARCHETYPE;

    if (isBurningWestSearch && cardKinds.includes("monster")) {
      const order = [];
      if (analysis.wantedActive || analysis.wantedInHand) {
        order.push(BW.GUNSLINGER);
      }
      if (analysis.peacemakerInHand || analysis.faceUpBurningWestMonsters?.length) {
        order.push(BW.SPECIALIST);
      }
      if ((analysis.graveyard || []).some(isBurningWest)) {
        order.push(BW.UNDERTAKER);
      }
      if (analysis.oppPressure) order.push(BW.PREACHER);
      order.push(
        BW.GUNSLINGER,
        BW.SPECIALIST,
        BW.UNDERTAKER,
        BW.PREACHER,
        BW.BUTCHER,
      );
      return this.rankByNameOrder(cards, order);
    }

    if (
      isBurningWestSearch &&
      (cardKinds.includes("spell") || cardKinds.includes("trap"))
    ) {
      const order = [];
      if (!analysis.wantedActive) order.push(BW.WANTED);
      if (analysis.hasBurningWestAttacker || analysis.faceUpBurningWestMonsters?.length) {
        order.push(BW.PEACEMAKER);
      }
      if (analysis.oppPressure) order.push(BW.AMBUSH, BW.LAW);
      if (analysis.hasBurningWestAttacker || analysis.wantedActive) {
        order.push(BW.REWARD);
      }
      if (analysis.hasLikelyDeclaredBattle) order.push(BW.DEADEYE);
      if (analysis.faceUpOpponentMonsters?.length) order.push(BW.QUICK_DRAW);
      order.push(
        BW.WANTED,
        BW.PEACEMAKER,
        BW.AMBUSH,
        BW.LAW,
        BW.REWARD,
        BW.QUICK_DRAW,
        BW.FUNERAL,
        BW.DEADEYE,
        BW.CRASH_TOWN,
      );
      return this.rankByNameOrder(cards, order);
    }

    return cards
      .slice()
      .sort((a, b) => getBurningWestCardValue(b) - getBurningWestCardValue(a));
  }

  rankByNameOrder(cards = [], preferredNames = []) {
    const order = new Map();
    preferredNames.forEach((name, index) => {
      if (!order.has(name)) order.set(name, index);
    });
    return cards.slice().sort((a, b) => {
      const rankA = order.has(a?.name) ? order.get(a.name) : 999;
      const rankB = order.has(b?.name) ? order.get(b.name) : 999;
      if (rankA !== rankB) return rankA - rankB;
      return getBurningWestCardValue(b) - getBurningWestCardValue(a);
    });
  }

  chooseSpecialSummonPosition(card, context = {}) {
    if (!card || card.cardKind !== "monster") return null;
    if (
      [
        BW.GUNSLINGER,
        BW.SPECIALIST,
        BW.SHERIFF,
        BW.EXECUTIONER,
      ].includes(card.name)
    ) {
      return "attack";
    }
    if (card.name === BW.PREACHER) return "defense";
    if (card.name === BW.UNDERTAKER) {
      const analysis =
        context.analysis ||
        (context.game ? this.analyzeGameState(context.game) : this.currentAnalysis) ||
        {};
      return analysis.oppPressure ? "defense" : "attack";
    }
    return "attack";
  }

  chooseActionCase(cases = [], context = {}) {
    if (!Array.isArray(cases) || cases.length === 0) return null;
    const preferences =
      context.activationContext?.actionContext?.targetPreferences ||
      context.activationContext?.targetPreferences ||
      {};
    const preferredLabels = preferences.action_case_choice?.preferredNames || [];
    const preferredCase = cases.find((choiceCase) =>
      preferredLabels.some(
        (label) =>
          choiceCase?.id === label ||
          choiceCase?.label === label ||
          choiceCase?.description?.includes?.(label),
      ),
    );
    return preferredCase || cases[0];
  }

  prepareSimulatedBattle(context = {}) {
    return prepareBurningWestSimulatedBattle(context);
  }

  applySimulatedBattleRewards(context = {}) {
    return applyBurningWestSimulatedBattleRewards({
      ...context,
      strategy: this,
    });
  }

  scoreBattleAttackCandidate(context = {}) {
    return scoreBurningWestBattleAttackCandidate(context);
  }

  simulateMainPhaseAction(state, action) {
    return applyGenericSimulatedMainPhaseAction(state, action, {
      guardLabel: "BurningWestStrategy",
      selfId: "bot",
      archetype: ARCHETYPE,
      strategy: this,
      activationContext: action?.activationContext,
      enableSimulatedEvents: true,
      rankSearchCandidates: this.rankSearchCandidates.bind(this),
      getTributeRequirementFor: this.getTributeRequirementFor.bind(this),
      selectBestTributes: this.selectBestTributes.bind(this),
      placeSpellCard: this.placeSpellCard.bind(this),
      chooseSpecialSummonPosition: this.chooseSpecialSummonPosition.bind(this),
      chooseActionCase: this.chooseActionCase.bind(this),
    });
  }

  selectBestTributes(field = [], tributesNeeded = 0) {
    if (tributesNeeded <= 0) return [];
    return (field || [])
      .map((card, index) => ({
        index,
        value:
          getBurningWestCardValue(card) +
          (card?.name === BW.SPECIALIST || card?.name === BW.UNDERTAKER ? 40 : 0) +
          (card?.name === BW.SHERIFF ? 50 : 0),
      }))
      .sort((a, b) => a.value - b.value)
      .slice(0, tributesNeeded)
      .map((entry) => entry.index);
  }

  evaluateTributeTrade(cardToSummon, field = [], tributesNeeded = 0) {
    if (tributesNeeded <= 0) return { ok: true };
    if (!field || field.length < tributesNeeded) {
      return { ok: false, reason: "not enough tribute material" };
    }
    if (![BW.SPECIALIST, BW.UNDERTAKER, BW.SHERIFF].includes(cardToSummon?.name)) {
      return { ok: false, reason: "not a Burning West tribute priority" };
    }
    const tributeIndices = this.selectBestTributes(field, tributesNeeded);
    const tributeValue = tributeIndices.reduce(
      (sum, index) => sum + getBurningWestCardValue(field[index]),
      0,
    );
    const summonValue = getBurningWestCardValue(cardToSummon);
    if (tributeValue > summonValue + 35) {
      return { ok: false, reason: "tribute would spend a stronger resource" };
    }
    return { ok: true };
  }
}
