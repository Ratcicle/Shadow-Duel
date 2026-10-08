import type { MirageboundActivationContext, MirageboundAnalysis, MirageboundCard, MirageboundContext, MirageboundLineAction, MirageboundPreference, MirageboundStatCard } from "./contracts.js";
import { MB, MIRAGEBOUND, OASIS_RETURN_LABEL, OASIS_SHIFT_LABEL, RECURSION_TARGET_IDS, RETURN_TARGET_IDS, getBattleStat, getBestOwnBattleStat, getEffectiveAtk, getEffectiveDef, getInstanceIds, getOpponentCards, isAttackPositionThreat, uniqueValues } from "./knowledge.js";
import { estimateCardValue, estimateMonsterValue } from "../StrategyUtils.js";
import { buildBounceNameProfile, buildMirageboundCostPreferences, getMirageboundCardValue } from "./resourcePolicy.js";
import { buildAutoActivationContext } from "../common/preferencePolicy.js";
import type { AIState, AIStrategyBotPort } from "../../contracts/ai.js";

import type MirageboundStrategy from "../MirageboundStrategy.js";

export function mergePreference(base: MirageboundPreference = {}, patch: MirageboundPreference = {}) {
  return {
    ...(base || {}),
    ...(patch || {}),
    preferredInstanceIds: uniqueValues([
      ...(patch.preferredInstanceIds || []),
      ...(base.preferredInstanceIds || []),
    ]),
    avoidInstanceIds: uniqueValues([
      ...(patch.avoidInstanceIds || []),
      ...(base.avoidInstanceIds || []),
    ]),
    preferredNames: uniqueValues([
      ...(patch.preferredNames || []),
      ...(base.preferredNames || []),
    ]),
    avoidNames: uniqueValues([
      ...(patch.avoidNames || []),
      ...(base.avoidNames || []),
    ]),
  };
}

export function mergeTargetPreference(activationContext: MirageboundActivationContext, targetId: string, patch: MirageboundPreference) {
  if (!activationContext || !targetId || !patch) return activationContext;
  const actionContext = {
    ...(activationContext.actionContext || {}),
  };
  const targetPreferences: Record<string, MirageboundPreference> = {
    ...(actionContext.targetPreferences || {}),
  };
  targetPreferences[targetId] = mergePreference(
    targetPreferences[targetId],
    patch,
  );
  actionContext.targetPreferences = targetPreferences;
  return {
    ...activationContext,
    actionContext,
  };
}

export function scorePositionTarget(card: MirageboundCard, analysis: MirageboundAnalysis = {} as MirageboundAnalysis, { preferDefenseOutcome = true } = {}) {
  if (!card || card.cardKind !== "monster") return -100;
  const battleStat = getBattleStat(card);
  const atk = getEffectiveAtk(card);
  const def = getEffectiveDef(card);
  const ownBest = getBestOwnBattleStat(analysis);
  let score = estimateMonsterValue(card) * 10 + battleStat / 100;

  if (card.monsterType === "fusion" || card.monsterType === "ascension") score += 18;
  if ((card.level || 0) >= 7) score += 10;
  if (card.positionChangedThisTurn) score -= 35;
  if (card.isFacedown) score += preferDefenseOutcome ? -8 : 4;

  if (preferDefenseOutcome) {
    if (card.position === "attack") score += 28 + Math.max(0, atk - def) / 80;
    if (card.position === "defense") score -= 18;
  } else if (card.position === "defense") {
    score += 4;
  }

  if (ownBest > 0 && card.position === "attack" && ownBest > Math.max(0, def - 500)) {
    score += 8;
  }
  if (analysis.hasOasisActive && !card.positionChangedThisTurn) score += 8;
  if (analysis.hasSovereignInField && card.position === "attack") score += 8;
  if (
    analysis.hasRebelOpenZoneTriggerWindow &&
    preferDefenseOutcome &&
    card.position === "attack"
  ) {
    score += 10;
  }

  return score;
}

export function rankOpponentMonstersForPosition(analysis: MirageboundAnalysis = {} as MirageboundAnalysis, options: MirageboundContext = {}) {
  return (analysis.opponentMonsters || [])
    .slice()
    .sort(
      (a, b) =>
        scorePositionTarget(b, analysis, options) -
        scorePositionTarget(a, analysis, options),
    );
}

export function rankOpponentCardsForRemoval(analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  return getOpponentCards(analysis)
    .slice()
    .sort((a, b) => {
      const score = (card: MirageboundCard) => {
        if (!card) return -100;
        let value = estimateCardValue(card) * 10;
        if (card.cardKind === "monster") {
          value += estimateMonsterValue(card) * 12 + getBattleStat(card) / 100;
          if (card.monsterType === "fusion" || card.monsterType === "ascension") {
            value += 20;
          }
          if ((card.level || 0) >= 7) value += 8;
        }
        if (card === analysis.oppFieldSpell) value += 14;
        if (card.cardKind === "spell" || card.cardKind === "trap") value += 7;
        if (card.subtype === "field" || card.subtype === "continuous") value += 5;
        return value;
      };
      return score(b) - score(a);
    });
}

export function buildOpponentPositionPreference(analysis: MirageboundAnalysis = {} as MirageboundAnalysis, sourceCard: MirageboundCard | null = null) {
  const preferAttackTargets =
    sourceCard?.name === MB.HEAT_HAZE ||
    sourceCard?.name === MB.GLASS_SOVEREIGN ||
    sourceCard?.name === MB.SCOUT ||
    sourceCard?.name === MB.OASIS ||
    sourceCard?.name === MB.FALSE_HORIZON ||
    sourceCard?.name === MB.FALSE_KING ||
    sourceCard?.name === MB.JACKAL;
  const ranked = rankOpponentMonstersForPosition(analysis, {
    preferDefenseOutcome: preferAttackTargets,
  });
  const preferred = ranked.filter((card) =>
    preferAttackTargets ? isAttackPositionThreat(card) : true,
  );
  const avoided = ranked.filter(
    (card) =>
      card?.positionChangedThisTurn ||
      (preferAttackTargets && card?.position === "defense"),
  );

  return {
    intent: "harm",
    role: "named_preference",
    preferredInstanceIds: getInstanceIds(preferred.length > 0 ? preferred : ranked),
    avoidInstanceIds: getInstanceIds(avoided),
  };
}

export function buildOpponentDebuffPreference(analysis: MirageboundAnalysis = {} as MirageboundAnalysis, sourceCard: MirageboundCard | null = null) {
  const reduction =
    sourceCard?.name === MB.GLASS_VIPER ||
    sourceCard?.name === MB.SAND_PRIESTESS ||
    sourceCard?.name === MB.VANISHING_STEP
      ? 500
      : sourceCard?.name === MB.OASIS || analysis.hasOasisActive
        ? 400
        : analysis.hasDesertLeviathan
          ? 300
          : 0;
  const ranked = rankOpponentMonstersForPosition(analysis, {
    preferDefenseOutcome:
      sourceCard?.name === MB.SAND_PRIESTESS ||
      sourceCard?.name === MB.VANISHING_STEP,
  });

  return {
    intent: "harm",
    role: reduction > 0 ? "temporary_stat_debuff" : "removal",
    purpose: "combat",
    attackers: analysis.readyAttackers || [],
    opponentLp: analysis.oppLp || analysis.oppLP || 0,
    atkReduction: reduction,
    defReduction: reduction,
    preferredInstanceIds: getInstanceIds(ranked),
    avoidInstanceIds: getInstanceIds(
      ranked.filter((card) => card?.positionChangedThisTurn),
    ),
  };
}

export function buildOpponentRemovalPreference(analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  const ranked = rankOpponentCardsForRemoval(analysis);
  return {
    intent: "harm",
    role: "removal",
    preferredInstanceIds: getInstanceIds(ranked),
  };
}

export function buildMirageboundTargetPreferences(sourceCard: MirageboundCard, analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  const bounceProfile = buildBounceNameProfile(analysis);
  const bouncePreference = {
    intent: "benefit",
    role: "named_preference",
    preferredNames: bounceProfile.preferredNames,
    avoidNames: bounceProfile.avoidNames,
    preferredInstanceIds: bounceProfile.preferredInstanceIds,
    avoidInstanceIds: bounceProfile.avoidInstanceIds,
  };
  const positionPreference = buildOpponentPositionPreference(analysis, sourceCard);
  const debuffPreference = buildOpponentDebuffPreference(analysis, sourceCard);
  const removalPreference = buildOpponentRemovalPreference(analysis);
  const recursionPreference = {
    intent: "benefit",
    role: "recursion",
    purpose: analysis.oppPressure ? "defense" : "value",
    preferredNames: [
      MB.GLASS_VIPER,
      MB.SCOUT,
      MB.DANCER,
      MB.SAND_PRIESTESS,
      MB.FALSE_KING,
      MB.REBEL,
      MB.JACKAL,
    ],
    defensiveNames: [MB.SAND_PRIESTESS, MB.GLASS_VIPER],
    offensiveNames: [MB.FALSE_KING, MB.REBEL, MB.DANCER, MB.JACKAL],
  };

  const targetPreferences: Record<string, MirageboundPreference> = {
    miragebound_oasis_ignition: {
      intent: "benefit",
      role: "named_preference",
      preferredNames: analysis.hasMeaningfulBounce
        ? [OASIS_RETURN_LABEL]
        : [OASIS_SHIFT_LABEL],
      avoidNames: analysis.hasMeaningfulBounce
        ? [OASIS_SHIFT_LABEL]
        : [OASIS_RETURN_LABEL],
    },
    miragebound_false_king_return_cost: {
      intent: "cost",
      role: "cost",
      preferNames: bounceProfile.preferredNames,
      preserveNames: bounceProfile.preserveNames,
      preferredInstanceIds: bounceProfile.preferredInstanceIds,
      avoidInstanceIds: bounceProfile.avoidInstanceIds,
    },
    miragebound_mirror_path_spell_trap_target: {
      intent: "harm",
      role: "removal",
      preferredInstanceIds: getInstanceIds(
        [analysis.oppFieldSpell, ...(analysis.oppSpellTrap || [])].filter(Boolean),
      ),
    },
  };

  for (const id of RETURN_TARGET_IDS) {
    targetPreferences[id] = bouncePreference;
  }
  [
    "miragebound_scout_position_target",
    "miragebound_jackal_return_shift_target",
    "miragebound_oasis_weaken_target",
    "miragebound_glass_sovereign_shift_targets",
    "miragebound_false_king_shift_target",
    "miragebound_false_horizon_position_target",
    "miragebound_heat_haze_position_target",
  ].forEach((id) => {
    targetPreferences[id] = positionPreference;
  });
  [
    "miragebound_oasis_return_weaken_target",
    "miragebound_glass_viper_debuff_target",
    "miragebound_sand_priestess_shift_debuff_target",
    "miragebound_vanishing_step_position_target",
  ].forEach((id) => {
    targetPreferences[id] = debuffPreference;
  });
  targetPreferences.miragebound_glass_sovereign_return_opponent_target =
    removalPreference;
  for (const id of RECURSION_TARGET_IDS) {
    targetPreferences[id] = recursionPreference;
  }

  return targetPreferences;
}

export function buildSpecialSummonPositions(analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  const viperPosition =
    analysis.oppPressure &&
    !analysis.canViperPressureAfterSummon &&
    !analysis.hasLeviathanMaterials
      ? "defense"
      : "attack";
  return {
    byName: {
      [MB.DANCER]: "attack",
      [MB.JACKAL]: "attack",
      [MB.FALSE_KING]: "attack",
      [MB.GLASS_VIPER]: viperPosition,
      [MB.SAND_PRIESTESS]: "defense",
      [MB.GLASS_SOVEREIGN]: "attack",
      [MB.DESERT_LEVIATHAN]: "attack",
      [MB.REBEL]: "attack",
    },
  };
}

export function buildMirageboundActivationContext(
  sourceCard: MirageboundCard,
  analysis: MirageboundAnalysis = {} as MirageboundAnalysis,
  options: MirageboundContext = {},
) {
  const zone = options.zone || options.activationZone || "field";
  return buildAutoActivationContext({
    zone,
    sourceZone: options.sourceZone || zone,
    activationZone: options.activationZone || zone,
    fromHand: options.fromHand === true || zone === "hand",
    autoSelectTargets: true,
    autoSelectSingleTarget: true,
    logTargets: false,
    costPreferences: buildMirageboundCostPreferences(analysis),
    targetPreferences: buildMirageboundTargetPreferences(sourceCard, analysis),
    specialSummonPositions: buildSpecialSummonPositions(analysis),
    actionContext: {
      archetype: MIRAGEBOUND,
      sourceName: sourceCard?.name || null,
      effectId: options.effect?.id || null,
    },
  }) as MirageboundActivationContext;
}

type BuildActivationContextForEffectPort = Pick<MirageboundStrategy, "analyzeGameState">;

export function buildActivationContextForEffect(strategy: BuildActivationContextForEffectPort, {
    sourceCard,
    effect,
    player,
    game,
    activationZone,
  }: MirageboundContext = {}) {
  if (!sourceCard || !player || !game) return null;
  const analysis = strategy.analyzeGameState(game);
  const zone = activationZone || effect?.activationZones?.[0] || "field";
  return buildMirageboundActivationContext(sourceCard, analysis, {
    zone,
    activationZone: zone,
    sourceZone: zone,
    fromHand: zone === "hand",
    effect,
  });
}

export function chooseActionCase<Case extends object>(cases: readonly Case[] = [], context: object = {}) {
  if (!Array.isArray(cases) || cases.length === 0) return null;
  const preferences =
    (context as MirageboundContext).activationContext?.actionContext?.targetPreferences ||
    (context as MirageboundContext).activationContext?.targetPreferences ||
    {};
  const preferredLabels = preferences.miragebound_oasis_ignition?.preferredNames || [];
  const preferredCase = (cases as readonly Case[]).find((choiceCase) =>
    preferredLabels.some(
      (label) =>
        (choiceCase as {label?:string})?.label === label ||
        (choiceCase as {id?:string})?.id === label ||
        (choiceCase as {description?:string})?.description?.includes?.(label),
    ),
  );
  if (preferredCase) return preferredCase;
  return (cases as readonly Case[])[0];
}

type RankSearchCandidatesPort = Pick<MirageboundStrategy, "analyzeGameState" | "currentAnalysis" | "rankByNameOrder">;

export function rankSearchCandidates(strategy: RankSearchCandidatesPort, cards: MirageboundCard[] = [], action: MirageboundLineAction = {}, ctx: MirageboundContext = {}) {
  const source = ctx?.source || ctx?.ctx?.source || null;
  const analysis = ctx?.game ? strategy.analyzeGameState(ctx.game) : strategy.currentAnalysis || {} as MirageboundAnalysis;
  const searchedKinds = JSON.stringify(action?.filters?.cardKind || "");
  const isSpellTrapSearch =
    action?.filters?.archetype === MIRAGEBOUND &&
    (searchedKinds.includes("spell") || searchedKinds.includes("trap"));

  if (source?.name === MB.SCOUT || isSpellTrapSearch) {
    const order: string[] = [];
    if (!analysis.hasOasisActive) order.push(MB.OASIS);
    if (analysis.needsBattleProtection && !analysis.hasFalseHorizonAvailable) {
      order.push(MB.FALSE_HORIZON);
    }
    if (
      (analysis.needsBattleProtection || analysis.opponentBackrowPressure) &&
      !analysis.hasMirrorPathOnField
    ) {
      order.push(MB.MIRROR_PATH);
    }
    if (analysis.hasMeaningfulBounce && !analysis.hasVanishingStepAvailable) {
      order.push(MB.VANISHING_STEP);
    }
    if (analysis.hasHeatHazeRecoveryLine) order.push(MB.HEAT_HAZE);
    order.push(
      MB.OASIS,
      MB.MIRROR_PATH,
      MB.VANISHING_STEP,
      MB.HEAT_HAZE,
      MB.FALSE_HORIZON,
    );
    return strategy.rankByNameOrder(cards, order);
  }

  if (action?.filters?.archetype === MIRAGEBOUND) {
    const monsterOrder: string[] = [
      MB.GLASS_VIPER,
      MB.SCOUT,
      MB.DANCER,
      MB.SAND_PRIESTESS,
      MB.FALSE_KING,
    ];
    if (
      analysis.hasRebelPositionTriggerWindow ||
      analysis.hasRebelPiercingPressure
    ) {
      monsterOrder.push(MB.REBEL);
    }
    monsterOrder.push(MB.JACKAL, MB.REBEL);
    return strategy.rankByNameOrder(cards, [
      ...monsterOrder,
    ]);
  }

  return cards
    .slice()
    .sort((a, b) => getMirageboundCardValue(b) - getMirageboundCardValue(a));
}

export function rankByNameOrder(cards: MirageboundCard[] = [], preferredNames: string[] = []) {
  const order = new Map<string | undefined, number>();
  preferredNames.forEach((name, index) => {
    if (!order.has(name)) order.set(name, index);
  });
  return cards.slice().sort((a, b) => {
    const rankA = order.has(a?.name) ? order.get(a.name)! : 999;
    const rankB = order.has(b?.name) ? order.get(b.name)! : 999;
    if (rankA !== rankB) return rankA - rankB;
    return getMirageboundCardValue(b) - getMirageboundCardValue(a);
  });
}

type ChooseSpecialSummonPositionPort = Pick<MirageboundStrategy, "analyzeGameState" | "currentAnalysis" | "getOpponent">;

export function chooseSpecialSummonPosition(strategy: ChooseSpecialSummonPositionPort, card: MirageboundStatCard & {name?:string}, context: {game?:AIState;player?:AIStrategyBotPort;opponent?:AIStrategyBotPort|null;analysis?:MirageboundAnalysis} = {}) {
  if (!card || card.cardKind !== "monster") return null;
  if (card.name === MB.GLASS_SOVEREIGN || card.name === MB.DESERT_LEVIATHAN) {
    return "attack";
  }
  if (
    card.name === MB.FALSE_KING ||
    card.name === MB.REBEL ||
    card.name === MB.DANCER ||
    card.name === MB.JACKAL
  ) {
    return "attack";
  }

  const opponent =
    context.opponent ||
    (context.game && context.player
      ? strategy.getOpponent(context.game, context.player)
      : null);
  const analysis =
    context.analysis ||
    (context.game ? strategy.analyzeGameState(context.game) : strategy.currentAnalysis) ||
    {} as MirageboundAnalysis;
  const strongest = (opponent?.field || []).reduce(
    (max, monster) => Math.max(max, getEffectiveAtk(monster)),
    0,
  );

  if (card.name === MB.SAND_PRIESTESS) return "defense";
  if (card.name === MB.GLASS_VIPER) {
    if (analysis.canViperPressureAfterSummon || analysis.hasLeviathanMaterials) {
      return "attack";
    }
    if (analysis.oppPressure || strongest > getEffectiveAtk(card)) {
      return "defense";
    }
  }
  return "attack";
}
