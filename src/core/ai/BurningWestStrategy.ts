import type { EffectDefinition } from "../contracts/effects.js";
import type { GameCard, BattlePositionInput } from "../contracts/cards.js";
import type { AIAction, AIPlannedAction, AIState, AIPlanningContext, AIStrategyBotPort } from "../contracts/ai.js";
import type { SimulatedCardState, SimulatedPlayerState } from "../contracts/aiState.js";
import type { ChainStrategyPort, ChainEffect, ChainStrategyResponse } from "../contracts/chainRuntime.js";
import type { BurningWestBattlePlan, BurningWestQuickDrawPair, BurningWestActivationAnalysis, BurningWestDeclaration, BurningWestCard, BurningWestPlayer, BurningWestAnalysis, BurningWestContext, BurningWestGame, BurningWestLineAction, BurningWestPreference, BurningWestActivationOptions, BurningWestActivationContext } from "./burningwest/contracts.js";
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
import {
  buildBurningWestPlanningProfile,
  describeBurningWestPlannedLine,
  scoreBurningWestLineMilestones,
  scoreBurningWestLineTerminal,
} from "./burningwest/linePlanning.js";
import {
  chooseBurningWestAscensionPosition,
  getBurningWestExtraDeckActions,
  rankBurningWestExecutionerRecoveryCandidates,
  selectBurningWestAutomaticAscension,
} from "./burningwest/extraDeck.js";
import {
  buildBurningWestDefenseActivationContext,
  evaluateBurningWestAmbushResponse,
  evaluateBurningWestLawResponse,
  evaluateBurningWestQuickDrawResponse,
  evaluateBurningWestRecruitCandidate,
  evaluateBurningWestReplacementPolicy,
  hasBurningWestDefenseResponseInChain,
} from "./burningwest/defense.js";
import { evaluateBurningWestBoardBonus } from "./burningwest/scoring.js";
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

function unique<T>(values: Array<T | null | undefined> = []): T[] {
  return [...new Set(values.filter(Boolean))] as T[];
}

function isBurningWest(card: BurningWestCard | null | undefined) {
  if (!card) return false;
  if (card.archetype === ARCHETYPE) return true;
  return Array.isArray(card.archetypes) && card.archetypes.includes(ARCHETYPE);
}

function isFaceUpBurningWestMonster(card: BurningWestCard | null | undefined) {
  return (
    card?.cardKind === "monster" &&
    !card.isFacedown &&
    isBurningWest(card)
  );
}

function isFaceUpWanted(card: BurningWestCard | null | undefined) {
  return (
    card?.name === BW.WANTED &&
    card.cardKind === "spell" &&
    card.subtype === "continuous" &&
    !card.isFacedown
  );
}

function hasName(cards: BurningWestCard[] = [], name: string) {
  return (cards || []).some((card) => card?.name === name);
}

function hasActiveDeclaration(card: BurningWestCard, stateKey: string, turnCounter = 0) {
  const declaration = card?.declaredValues?.[stateKey] as BurningWestDeclaration | undefined;
  if (!declaration) return false;
  if (declaration.expiresOnTurn === null || declaration.expiresOnTurn === undefined) {
    return true;
  }
  return Number(declaration.expiresOnTurn) >= Number(turnCounter || 0);
}

function getActiveDeclaredTypeValues(cards: BurningWestCard[] = [], turnCounter = 0) {
  const values: string[] = [];
  for (const card of cards || []) {
    const declaredValues = (card?.declaredValues || {}) as Record<string, BurningWestDeclaration>;
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

function isExtraDeckMonster(card: BurningWestCard | null | undefined) {
  return ["fusion", "ascension", "synchro"].includes(card?.monsterType!);
}

function getThreatScore(card: BurningWestCard | null | undefined) {
  if (!card || card.cardKind !== "monster") return 0;
  let score = getBattleStat(card) + (card.level || 0) * 80;
  if (card.position === "attack") score += 250;
  if (isExtraDeckMonster(card)) score += 650;
  return score;
}

function getBurningWestCardValue(card: BurningWestCard | null | undefined) {
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

function getInstanceIds(card: BurningWestCard | null | undefined) {
  return [
    card?.instanceId,
    card?.fieldPresenceId,
    card?.uid,
    card?.uuid,
  ].filter((id) => id !== null && id !== undefined);
}

function countTypes(monsters: BurningWestCard[] = []) {
  const counts = new Map<string, number>();
  for (const monster of monsters) {
    if (!monster?.type) continue;
    counts.set(monster.type, (counts.get(monster.type) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type]) => type);
}

function getPreferredTypeNames(types: string[] = []) {
  return unique(
    types.flatMap((type) => [
      type,
      typeof getMonsterTypeLabel === "function"
        ? getMonsterTypeLabel(type) as string
        : type,
    ]),
  );
}

function canBeatMonster(attacker: BurningWestCard | null | undefined, defender: BurningWestCard | null | undefined) {
  if (!attacker || !defender) return false;
  return getEffectiveAtk(attacker) > getBattleStat(defender);
}

function canBattleThisTurn(card: BurningWestCard | null | undefined) {
  return (
    card?.cardKind === "monster" &&
    !card.isFacedown &&
    card.position !== "defense" &&
    !card.cannotAttackThisTurn &&
    !card.hasAttacked &&
    getEffectiveAtk(card) > 0
  );
}

function getTypeCounts(monsters: BurningWestCard[] = []) {
  const counts = new Map<string, number>();
  for (const monster of monsters) {
    if (!monster?.type) continue;
    counts.set(monster.type, (counts.get(monster.type) || 0) + 1);
  }
  return counts;
}

function addTypeWeight(scores: Map<string, number>, type: string | null | undefined, amount: number) {
  if (!type) return;
  scores.set(type, (scores.get(type) || 0) + amount);
}

function getSortedTypesByScore(scores: Map<string, number>) {
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type]) => type);
}

function buildBattlePlans(attackers: BurningWestCard[] = [], targets: BurningWestCard[] = []) {
  const plans: BurningWestBattlePlan[] = [];
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

function buildQuickDrawPairs(attackers: BurningWestCard[] = [], targets: BurningWestCard[] = []) {
  const pairs: BurningWestQuickDrawPair[] = [];
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

function cardMentionsBurningWest(card: BurningWestCard | null | undefined) {
  return (
    isBurningWest(card) ||
    String(card?.description || "").includes("Burning West")
  );
}

function namesFromCards(cards: BurningWestCard[] = []) {
  return unique((cards || []).map((card) => card?.name));
}

function buildOpponentPreference(analysis: BurningWestAnalysis) {
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
    preferredNames: unique(ordered.map((card) => card!.name).filter(Boolean)),
    preferredInstanceIds: ordered.flatMap(getInstanceIds),
  };
}

function buildOwnOffensivePreference(analysis: BurningWestAnalysis) {
  const preferredCards = [
    analysis.quickDrawPair?.attacker,
    analysis.bestBattlePlan?.attacker,
    analysis.bestPeacemakerTarget,
    ...(analysis.faceUpBurningWestMonsters || []),
  ].filter(Boolean);
  const preferredNames =
    preferredCards.length > 0
      ? preferredCards.map((card) => card!.name)
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

function buildDeclaredTypePreference(analysis: BurningWestAnalysis) {
  const preferredTypes = analysis.plannedDeclaredType
    ? [analysis.plannedDeclaredType]
    : analysis.preferredDeclaredTypes || [];
  return {
    intent: "benefit",
    role: "named_preference",
    preferredNames: getPreferredTypeNames(preferredTypes),
  };
}

function buildQuickDrawOwnPreference(analysis: BurningWestAnalysis) {
  const attacker = analysis.quickDrawPair?.attacker || null;
  return {
    intent: "benefit",
    role: "named_preference",
    preferredNames: attacker ? [attacker.name] : PEACEMAKER_TARGET_ORDER,
    preferredInstanceIds: attacker ? getInstanceIds(attacker) : [],
  };
}

function buildQuickDrawOpponentPreference(analysis: BurningWestAnalysis) {
  const target = analysis.quickDrawPair?.target || null;
  return {
    intent: "harm",
    role: "removal",
    preferredNames: target ? [target.name] : [],
    preferredInstanceIds: target ? getInstanceIds(target) : [],
  };
}

function buildWantedCasePreference(analysis: BurningWestAnalysis) {
  const preferredNames: string[] = [];
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

function buildRecoveryPreference(analysis: BurningWestAnalysis) {
  const contextual: string[] = [];
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

function buildBurningWestActivationContext(card: BurningWestCard, analysis: BurningWestAnalysis, options: BurningWestActivationOptions = {}) {
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
  declare currentAnalysis: BurningWestAnalysis | null;
  declare thoughtProcess: string[];
  constructor(bot: AIStrategyBotPort) {
    super(bot);
    this.currentAnalysis = null;
    this.thoughtProcess = [];
  }

  get archetypeLabel() {
    return "Burning West";
  }

  think(thought: string) {
    this.thoughtProcess.push(thought);
    if (this.bot?.debug) {
      console.log(`[Burning West AI] ${thought}`);
    }
  }

  evaluateBoard(gameOrState: AIState, perspectivePlayer?: SimulatedPlayerState) {
    return this.evaluateBoardV2(gameOrState, perspectivePlayer);
  }

  evaluateBoardV2(gameOrState: AIState, perspectivePlayer?: SimulatedPlayerState) {
    const baseScore = super.evaluateBoardV2(gameOrState, perspectivePlayer);
    return (
      baseScore +
      evaluateBurningWestBoardBonus(gameOrState, perspectivePlayer, {
        strategy: this,
      })
    );
  }

  analyzeGameState(game: BurningWestGame): BurningWestAnalysis {
    this.thoughtProcess = [];
    const player = (game?._isPerspectiveState === true
      ? game?.bot || this.bot || null
      : this.bot || game?.bot || null) as BurningWestPlayer;
    const opponent = (player ? this.getOpponent(game, player) : null) as BurningWestPlayer | null;
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
    const typeScores = new Map<string, number>();
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
          const rankA = PEACEMAKER_TARGET_ORDER.indexOf(a.name!);
          const rankB = PEACEMAKER_TARGET_ORDER.indexOf(b.name!);
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
        fieldTypeCounts.get(plannedDeclaredType)! >= 2 ||
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
  }: BurningWestContext = {}) {
    if (!sourceCard || !player || !game) return null;
    const analysis = this.analyzeGameState(game);
    const zone = activationZone || effect?.activationZones?.[0] || "field";
    return this.buildBurningWestActivationContext(sourceCard, analysis, {
      zone,
      activationZone: zone,
      sourceZone: zone,
      fromHand: zone === "hand",
      effect,
    });
  }

  buildBurningWestActivationContext(card: Pick<BurningWestCard, "name"> | undefined, analysis: BurningWestActivationAnalysis, options: Omit<BurningWestActivationOptions, "effect"> & { effect?: EffectDefinition | ChainEffect | null } = {}) {
    return buildBurningWestActivationContext(card as BurningWestCard, analysis as BurningWestAnalysis, options as BurningWestActivationOptions) as BurningWestActivationContext;
  }

  getPlanningProfile(game: AIState, context: AIPlanningContext = {}) {
    if (!game) return super.getPlanningProfile(game, context);
    const analysis = (context as BurningWestContext).analysis || this.analyzeGameState(game);
    return buildBurningWestPlanningProfile(analysis, {
      ...(context as BurningWestContext),
      game,
      strategy: this,
      bot: ((context as BurningWestContext).bot || analysis.player || this.bot || game.bot) as BurningWestPlayer,
    });
  }

  shouldUseDeepPlanning(game: AIState, context: AIPlanningContext = {}) {
    const profile =
      context.profile || this.getPlanningProfile(game, context) || {};
    return (game as BurningWestGame)?.turnLineSearchEnabled === true || profile.enabled === true;
  }

  scoreLineMilestones(context: AIPlanningContext = {}) {
    return scoreBurningWestLineMilestones(context as BurningWestContext);
  }

  scoreLineTerminal(context: AIPlanningContext = {}) {
    return scoreBurningWestLineTerminal(context as BurningWestContext);
  }

  describePlannedLine(context: AIPlanningContext = {}) {
    return describeBurningWestPlannedLine(context as BurningWestContext);
  }

  async chooseChainResponse({
    chainSystem,
    game,
    player = this.bot as Parameters<NonNullable<ChainStrategyPort["chooseChainResponse"]>>[0]["player"],
    activatable = [],
    context = {},
  }: Partial<Parameters<NonNullable<ChainStrategyPort["chooseChainResponse"]>>[0]> = {}): Promise<ChainStrategyResponse | null> {
    const options = (activatable || []).filter((option) =>
      [BW.AMBUSH, BW.LAW, BW.QUICK_DRAW].includes(option?.card?.name),
    );

    if (!options.length) {
      return {
        pass: true,
        reason: "no Burning West defensive chain response is available",
      };
    }

    if (hasBurningWestDefenseResponseInChain(chainSystem, player)) {
      return {
        pass: true,
        reason: "Burning West defense is already committed in this chain",
      };
    }

    const rawAnalysis: Partial<BurningWestAnalysis> = (context as BurningWestContext).analysis || (game ? this.analyzeGameState(game as BurningWestGame) : this.currentAnalysis || {});
    const analysis = {
      ...rawAnalysis,
      player: player || rawAnalysis.player || this.bot,
      game,
      faceUpBurningWestMonsters: rawAnalysis.faceUpBurningWestMonsters || [],
      faceUpOpponentMonsters: rawAnalysis.faceUpOpponentMonsters || [],
      opponentMonsters: rawAnalysis.opponentMonsters || [],
      preferredDeclaredTypes: rawAnalysis.preferredDeclaredTypes || [],
      activeDeclaredTypes: rawAnalysis.activeDeclaredTypes || [],
      recoverableBurningWestCards: rawAnalysis.recoverableBurningWestCards || [],
      recoveryNames: rawAnalysis.recoveryNames || [],
      bestBattlePlan: rawAnalysis.bestBattlePlan || null,
      quickDrawPair: rawAnalysis.quickDrawPair || null,
      bestPeacemakerTarget: rawAnalysis.bestPeacemakerTarget || null,
      underPressure: rawAnalysis.underPressure || rawAnalysis.oppPressure,
      battleRewardLive: rawAnalysis.battleRewardLive || rawAnalysis.hasLikelyDeclaredBattle,
    };
    const evaluationContext = {
      ...context,
      contextPlayer: context.player || null,
      responsePlayer: analysis.player,
      game,
      player: analysis.player,
      opponent: context.opponent || analysis.opponent,
      chainSystem,
    };

    const evaluations = options
      .map((option) => {
        const optionContext = {
          ...evaluationContext,
          ...(option.context || {}),
          contextPlayer:
            option.context?.player || evaluationContext.contextPlayer || null,
          responsePlayer: analysis.player,
          player: analysis.player,
          game,
          opponent:
            option.context?.opponent ||
            evaluationContext.opponent ||
            analysis.opponent,
          chainSystem,
        };
        if (option.card?.name === BW.AMBUSH) {
          return evaluateBurningWestAmbushResponse(option, analysis, optionContext);
        }
        if (option.card?.name === BW.LAW) {
          return evaluateBurningWestLawResponse(option, analysis, optionContext);
        }
        if (option.card?.name === BW.QUICK_DRAW) {
          return evaluateBurningWestQuickDrawResponse(option, analysis, optionContext);
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => (b!.score || 0) - (a!.score || 0));

    const best = evaluations.find((evaluation) => !evaluation!.pass);
    if (!best) {
      return {
        pass: true,
        reason: evaluations[0]?.reason || "no Burning West response is worthwhile",
      };
    }

    const activationContext = buildBurningWestDefenseActivationContext({
      option: best.option,
      analysis,
      context: evaluationContext,
      evaluation: best,
      buildActivationContext: this.buildBurningWestActivationContext.bind(this),
    });

    return {
      ...best.option,
      priority: best.score,
      score: best.score,
      reason: best.reason,
      activationContext,
      context: {
        ...context,
        ...(best.option.context || {}),
        activationContext,
        defenseEvaluation: {
          score: best.score,
          reason: best.reason,
          bestCandidate: best.bestCandidate?.name,
          ownTarget: best.ownTarget?.name,
          opponentTarget: best.opponentTarget?.name,
        },
      },
    } as ChainStrategyResponse;
  }

  evaluateRecruitCandidate(candidates: BurningWestCard[] = [], context: BurningWestContext = {}) {
    const rawAnalysis =
      context.analysis ||
      (context.game ? this.analyzeGameState(context.game) : this.currentAnalysis || {});
    const analysis = {
      ...rawAnalysis,
      player: context.player || rawAnalysis.player || this.bot,
      game: context.game,
      underPressure: rawAnalysis.underPressure || rawAnalysis.oppPressure,
      battleRewardLive: rawAnalysis.battleRewardLive || rawAnalysis.hasLikelyDeclaredBattle,
    };
    return evaluateBurningWestRecruitCandidate(candidates, {
      ...context,
      analysis,
      player: context.player || analysis.player,
      game: context.game,
    });
  }

  shouldUseReplacementEffect(context: BurningWestContext = {}) {
    const rawAnalysis =
      context.analysis ||
      (context.game ? this.analyzeGameState(context.game) : this.currentAnalysis || {});
    const analysis = {
      ...rawAnalysis,
      player: context.player || rawAnalysis.player || this.bot,
      game: context.game,
      underPressure: rawAnalysis.underPressure || rawAnalysis.oppPressure,
      battleRewardLive: rawAnalysis.battleRewardLive || rawAnalysis.hasLikelyDeclaredBattle,
    };
    return evaluateBurningWestReplacementPolicy({
      ...context,
      analysis,
      player: context.player || analysis.player,
    });
  }

  getSpellActions(game: BurningWestGame, player: BurningWestPlayer, analysis: BurningWestAnalysis) {
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
        this.buildBurningWestActivationContext(card, currentAnalysis!, {
          fromHand: true,
          activationZone: "hand",
          sourceZone: "hand",
          effect: (context as { effect?: import("../contracts/effects.js").EffectDefinition })?.effect || null,
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

  getHandIgnitionActions(game: BurningWestGame, player: BurningWestPlayer, analysis: BurningWestAnalysis) {
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
        this.buildBurningWestActivationContext(card, currentAnalysis!, {
          fromHand: true,
          activationZone: "hand",
          sourceZone: "hand",
          effect: (context as { effect?: import("../contracts/effects.js").EffectDefinition })?.effect || null,
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

  getSpellTrapEffectActions(game: BurningWestGame, player: BurningWestPlayer, analysis: BurningWestAnalysis) {
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
        this.buildBurningWestActivationContext(card, currentAnalysis!, {
          fromHand: false,
          activationZone: "spellTrap",
          sourceZone: "spellTrap",
          effect: (context as { effect?: import("../contracts/effects.js").EffectDefinition })?.effect || null,
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

  getSummonActions(_game: BurningWestGame, player: BurningWestPlayer, analysis: BurningWestAnalysis) {
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
        if ([BW.SPECIALIST, BW.UNDERTAKER].includes(card.name!)) {
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

  getGraveyardSpellEffectActions(game: BurningWestGame, player: BurningWestPlayer, analysis: BurningWestAnalysis) {
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
        this.buildBurningWestActivationContext(card, currentAnalysis!, {
          fromHand: false,
          activationZone: "graveyard",
          sourceZone: "graveyard",
          effect: (context as { effect?: import("../contracts/effects.js").EffectDefinition })?.effect || null,
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

  getSetSpellTrapActions(game: BurningWestGame, player: BurningWestPlayer, analysis: BurningWestAnalysis) {
    return getGenericSetBackrowActions({
      bot: player,
      player,
      analysis,
      game,
      opponent: analysis.opponent,
      basePriority: 24,
      defaultReason: "prepare Burning West backrow",
      policy: {
        acceptsCard: (card) => BACKROW_NAMES.has(card?.name!),
        shouldSet: (card) => {
          if (!analysis.hasBackrowSpace) return false;
          if ([BW.AMBUSH, BW.LAW].includes(card.name!)) {
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

  generateMainPhaseActions(game: BurningWestGame) {
    const analysis = this.analyzeGameState(game);
    const player = analysis.player;
    if (!player) return [];

    return this.sequenceActions([
      ...this.getSpellActions(game, player, analysis),
      ...this.getSpellTrapEffectActions(game, player, analysis),
      ...this.getHandIgnitionActions(game, player, analysis),
      ...this.getExtraDeckActions(game, player, analysis),
      ...this.getSummonActions(game, player, analysis),
      ...this.getGraveyardSpellEffectActions(game, player, analysis),
      ...this.getSetSpellTrapActions(game, player, analysis),
    ]);
  }

  getExtraDeckActions(game: BurningWestGame, player: BurningWestPlayer, analysis: BurningWestAnalysis) {
    return getBurningWestExtraDeckActions({
      game,
      bot: player,
      analysis,
      strategy: this,
    });
  }

  sequenceActions(actions: AIAction[] = []) {
    return sequenceActionsByPriority(actions, {
      typeOrder: {
        spell: 0,
        spellTrapEffect: 1,
        handIgnition: 2,
        ascension: 3,
        summon: 4,
        graveyardSpellEffect: 5,
        monsterEffect: 6,
        set_spell_trap: 7,
      },
    });
  }

  rankSearchCandidates<Card extends BurningWestCard>(cards: Card[] = [], action: BurningWestLineAction = {}, ctx: BurningWestContext = {}) {
    const game = ctx.game || ctx.ctx?.game || null;
    const analysis: Partial<BurningWestAnalysis> = game ? this.analyzeGameState(game as BurningWestGame) : this.currentAnalysis || {};
    const effectId =
      ctx.ctx?.effect?.id ||
      ctx.effect?.id ||
      action.effectId ||
      action.sourceEffectId ||
      "";
    const sourceName = ctx.source?.name || ctx.ctx?.source?.name || "";
    const isExecutionerRecovery =
      effectId === "burning_west_executioner_ascension_recover" ||
      (sourceName === BW.EXECUTIONER && action?.type === "add_from_zone_to_hand");
    if (isExecutionerRecovery) {
      return rankBurningWestExecutionerRecoveryCandidates(cards, analysis, {
        game,
        bot: ctx.player || analysis.player || this.bot,
        opponent:
          analysis.opponent ||
          (game && (ctx.player || this.bot)
            ? this.getOpponent(game, ctx.player || this.bot)
            : null),
      });
    }

    const filters = action?.filters || action?.candidateFilters || {};
    const cardKinds: unknown[] = Array.isArray(filters.cardKind)
      ? filters.cardKind
      : [filters.cardKind].filter(Boolean);
    const isBurningWestSearch =
      filters.archetype === ARCHETYPE || action?.archetype === ARCHETYPE;

    if (isBurningWestSearch && cardKinds.includes("monster")) {
      const order: string[] = [];
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
      const order: string[] = [];
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

  rankByNameOrder<Card extends BurningWestCard>(cards: Card[] = [], preferredNames: string[] = []) {
    const order = new Map<string | undefined, number>();
    preferredNames.forEach((name, index) => {
      if (!order.has(name)) order.set(name, index);
    });
    return cards.slice().sort((a, b) => {
      const rankA = order.has(a?.name) ? order.get(a.name) : 999;
      const rankB = order.has(b?.name) ? order.get(b.name) : 999;
      if (rankA !== rankB) return rankA! - rankB!;
      return getBurningWestCardValue(b) - getBurningWestCardValue(a);
    });
  }

  chooseSpecialSummonPosition(card: Pick<BurningWestCard, "name" | "cardKind">, context: { analysis?: Partial<BurningWestAnalysis>; game?: AIState } = {} as { analysis?: Partial<BurningWestAnalysis>; game?: AIState }) {
    if (!card || card.cardKind !== "monster") return null;
    if (
      [
        BW.GUNSLINGER,
        BW.SPECIALIST,
        BW.SHERIFF,
        BW.EXECUTIONER,
      ].includes(card.name!)
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

  selectAutomaticAscension<Card extends GameCard | SimulatedCardState>({
    choices = [],
    game,
    bot = this.bot,
    opponent,
  }: { choices?: Array<{ ascensionCard: Card; material: Card }>; game?: AIState; bot?: AIStrategyBotPort | null; opponent?: AIStrategyBotPort | null } = {}) {
    const analysis: Partial<BurningWestAnalysis> = game ? this.analyzeGameState(game as BurningWestGame) : this.currentAnalysis || {};
    return selectBurningWestAutomaticAscension({
      choices,
      game: game as NonNullable<Parameters<typeof selectBurningWestAutomaticAscension>[0]>["game"],
      bot,
      opponent:
        opponent ||
        analysis.opponent ||
        (game && bot ? this.getOpponent(game, bot) : null),
      analysis,
    });
  }

  chooseAutomaticAscensionPosition({
    ascensionCard,
    material,
    game,
    bot = this.bot,
    opponent,
  }: { ascensionCard?: GameCard | SimulatedCardState; material?: GameCard | SimulatedCardState; game?: AIState; bot?: AIStrategyBotPort | null; opponent?: AIStrategyBotPort | null } = {}): BattlePositionInput | null {
    const analysis: Partial<BurningWestAnalysis> = game ? this.analyzeGameState(game as BurningWestGame) : this.currentAnalysis || {};
    return chooseBurningWestAscensionPosition({
      ascensionCard,
      material,
      game: game as NonNullable<Parameters<typeof selectBurningWestAutomaticAscension>[0]>["game"],
      bot,
      opponent:
        opponent ||
        analysis.opponent ||
        (game && bot ? this.getOpponent(game, bot) : null),
      analysis,
    });
  }

  chooseActionCase<Case extends object>(cases: readonly Case[] = [], context: object = {}) {
    if (!Array.isArray(cases) || cases.length === 0) return null;
    const preferences =
      (context as BurningWestContext).activationContext?.actionContext?.targetPreferences ||
      (context as BurningWestContext).activationContext?.targetPreferences ||
      {};
    const preferredLabels = preferences.action_case_choice?.preferredNames || [];
    const preferredCase = (cases as readonly Case[]).find((choiceCase) =>
      preferredLabels.some(
        (label) =>
          (choiceCase as { id?: string })?.id === label ||
          (choiceCase as { label?: string })?.label === label ||
          (choiceCase as { description?: string })?.description?.includes?.(label),
      ),
    );
    return preferredCase || (cases as readonly Case[])[0];
  }

  prepareSimulatedBattle(context: Parameters<typeof prepareBurningWestSimulatedBattle>[0] = {}) {
    return prepareBurningWestSimulatedBattle(context);
  }

  applySimulatedBattleRewards(context: Parameters<typeof applyBurningWestSimulatedBattleRewards>[0] = {}) {
    return applyBurningWestSimulatedBattleRewards({
      ...context,
      strategy: this,
    });
  }

  scoreBattleAttackCandidate(context: Parameters<typeof scoreBurningWestBattleAttackCandidate>[0] = {}) {
    return scoreBurningWestBattleAttackCandidate(context);
  }

  simulateMainPhaseAction(state: Parameters<BaseStrategy["simulateMainPhaseAction"]>[0], action: AIPlannedAction) {
    return applyGenericSimulatedMainPhaseAction(state as Parameters<typeof applyGenericSimulatedMainPhaseAction>[0], action as AIAction, {
      guardLabel: "BurningWestStrategy",
      selfId: "bot",
      archetype: ARCHETYPE,
      strategy: this,
      activationContext: (action as AIAction)?.activationContext,
      enableSimulatedEvents: true,
      rankSearchCandidates: this.rankSearchCandidates.bind(this),
      getTributeRequirementFor: this.getTributeRequirementFor.bind(this),
      selectBestTributes: this.selectBestTributes.bind(this),
      placeSpellCard: this.placeSpellCard.bind(this),
      chooseSpecialSummonPosition: this.chooseSpecialSummonPosition.bind(this),
      chooseActionCase: this.chooseActionCase.bind(this),
    });
  }

  selectBestTributes(field: BurningWestCard[] = [], tributesNeeded = 0) {
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

  evaluateTributeTrade(cardToSummon: BurningWestCard, field: BurningWestCard[] = [], tributesNeeded = 0) {
    if (tributesNeeded <= 0) return { ok: true };
    if (!field || field.length < tributesNeeded) {
      return { ok: false, reason: "not enough tribute material" };
    }
    if (![BW.SPECIALIST, BW.UNDERTAKER, BW.SHERIFF].includes(cardToSummon?.name!)) {
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
