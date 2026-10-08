import type { MirageboundAnalysis, MirageboundChainContext, MirageboundChainOption, MirageboundContext, MirageboundGame, MirageboundPlayer } from "./contracts.js";
import { DEFENSIVE_CHAIN_RESPONSE_NAMES, MB, getEffectiveAtk, getEffectiveDef, getInstanceIds, getOwnerId, isFaceUpMirageboundMonster } from "./knowledge.js";
import { getPiercingDamage } from "../common/cardStats.js";
import { buildMirageboundActivationContext, mergeTargetPreference, rankOpponentMonstersForPosition } from "./targeting.js";

import type MirageboundStrategy from "../MirageboundStrategy.js";

export function hasMirageboundDefenseResponseInChain(chainSystem: MirageboundChainContext["chainSystem"], player: MirageboundPlayer) {
  const stack = chainSystem?.getChainSummary?.() || [];
  return stack.some(
    (link) =>
      link?.controllerId === player?.id &&
      DEFENSIVE_CHAIN_RESPONSE_NAMES.has(link?.cardName),
  );
}

export function getIncomingBattleThreat(context: MirageboundContext = {}, player: MirageboundPlayer | null, analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  const attacker = context.attacker || null;
  const defender = context.defender || context.target || null;
  const attackerOwnerId =
    getOwnerId(context.attackerOwner) || getOwnerId(attacker);
  const defenderOwnerId =
    getOwnerId(context.defenderOwner) ||
    getOwnerId(context.targetOwner) ||
    getOwnerId(defender);
  const isAttack =
    context.type === "attack_declaration" ||
    context.type === "battle_damage";
  const isOpponentAttack =
    isAttack &&
    attacker &&
    attackerOwnerId &&
    attackerOwnerId !== player?.id;
  const defendingSelf =
    !defender || !defenderOwnerId || defenderOwnerId === player?.id;

  if (!isOpponentAttack || !defendingSelf) {
    return {
      isOpponentAttack: false,
      damage: 0,
      loseMonster: false,
      lethal: false,
      highThreat: false,
      attacker,
      defender,
    };
  }

  const atk = getEffectiveAtk(attacker);
  let damage = 0;
  let loseMonster = false;
  if (!defender) {
    damage = atk;
  } else if (defender.position === "defense") {
    const defenderStat = getEffectiveDef(defender);
    loseMonster = atk > defenderStat;
    damage = getPiercingDamage(attacker, atk, defenderStat);
  } else {
    const defenderStat = getEffectiveAtk(defender);
    loseMonster = atk >= defenderStat;
    damage = Math.max(0, atk - defenderStat);
  }

  const lethal = damage >= Number(player?.lp || 0);
  const highThreat =
    lethal ||
    loseMonster ||
    damage >= 800 ||
    atk >= 2000 ||
    analysis.oppPressure === true;

  return {
    isOpponentAttack,
    damage,
    loseMonster,
    lethal,
    highThreat,
    attacker,
    defender,
  };
}

export function isMeaningfulChainBattleThreat(threat: Partial<ReturnType<typeof getIncomingBattleThreat>> = {}, analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  if (!threat.isOpponentAttack) return false;
  const attackerAtk = getEffectiveAtk(threat.attacker);
  return (
    threat.lethal ||
    threat.loseMonster ||
    threat.damage! >= 700 ||
    attackerAtk >= 2000 ||
    (analysis.needsBattleProtection &&
      (threat.damage! >= 400 || attackerAtk >= 1700))
  );
}

export function isOpponentEffectTargetingSelf(context: MirageboundContext = {}, player: MirageboundPlayer | null) {
  if (context.type !== "effect_targeted") return false;
  const sourceOwnerId =
    getOwnerId(context.player) ||
    getOwnerId(context.sourceOwner) ||
    getOwnerId(context.card);
  const target = context.target || context.defender || context.eventCard || null;
  const targetOwnerId =
    getOwnerId(context.targetOwner) ||
    getOwnerId(context.defenderOwner) ||
    getOwnerId(target);
  return (
    sourceOwnerId &&
    sourceOwnerId !== player?.id &&
    target &&
    (!targetOwnerId || targetOwnerId === player?.id)
  );
}

export function hasUsefulChainBounceTarget(analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  return (analysis.faceUpMiragebounds || []).some((card) => {
    if (!card || card.name === MB.FALSE_KING) return false;
    if (card.name === MB.SCOUT && analysis.preserveScout) return false;
    if (card.name === MB.GLASS_SOVEREIGN || card.name === MB.DESERT_LEVIATHAN) {
      return false;
    }
    return true;
  });
}

export function buildChainActivationContext(option: MirageboundChainOption, analysis: MirageboundAnalysis, context: MirageboundContext = {}) {
  let activationContext = buildMirageboundActivationContext(
    option?.card,
    analysis,
    {
      zone: option?.zone || "spellTrap",
      activationZone: option?.zone || "spellTrap",
      sourceZone: option?.zone || "spellTrap",
      effect: option?.effect,
    },
  );

  const threat = getIncomingBattleThreat(context, analysis.player, analysis);
  const opponentFocus = [
    threat.attacker,
    context.target,
    context.defender,
    ...rankOpponentMonstersForPosition(analysis),
  ].filter((card) => card && card.cardKind === "monster");
  const opponentPatch = {
    intent: "harm",
    role: "named_preference",
    preferredInstanceIds: getInstanceIds(opponentFocus),
  };

  if (option?.card?.name === MB.FALSE_HORIZON) {
    activationContext = mergeTargetPreference(
      activationContext,
      "miragebound_false_horizon_position_target",
      opponentPatch,
    );
    if (isFaceUpMirageboundMonster(context.target) && !(
      context.target.name === MB.SCOUT && analysis.preserveScout
    )) {
      activationContext = mergeTargetPreference(
        activationContext,
        "miragebound_false_horizon_return_target",
        {
          intent: "benefit",
          role: "named_preference",
          preferredInstanceIds: getInstanceIds([context.target]),
        },
      );
    }
  }

  if (option?.card?.name === MB.VANISHING_STEP) {
    activationContext = mergeTargetPreference(
      activationContext,
      "miragebound_vanishing_step_position_target",
      {
        ...opponentPatch,
        role: "temporary_stat_debuff",
        purpose: "combat",
        attackers: analysis.readyAttackers || [],
        opponentLp: analysis.oppLP || analysis.opponent?.lp || 0,
        atkReduction: 500,
        defReduction: 500,
      },
    );
    if (isFaceUpMirageboundMonster(context.target) && !(
      context.target.name === MB.SCOUT && analysis.preserveScout
    )) {
      activationContext = mergeTargetPreference(
        activationContext,
        "miragebound_vanishing_step_return_target",
        {
          intent: "benefit",
          role: "named_preference",
          preferredInstanceIds: getInstanceIds([context.target]),
        },
      );
    }
  }

  return activationContext;
}

export function evaluateFalseHorizonChainResponse(option: MirageboundChainOption, analysis: MirageboundAnalysis, context: MirageboundContext = {}) {
  if (option?.card?.name !== MB.FALSE_HORIZON) return null;
  const threat = getIncomingBattleThreat(context, analysis.player, analysis);
  if (!threat.isOpponentAttack) return null;
  if ((analysis.opponentMonsters || []).length === 0) return null;
  if (!isMeaningfulChainBattleThreat(threat, analysis)) {
    return null;
  }
  return {
    option,
    score:
      70 +
      (threat.lethal ? 40 : 0) +
      (threat.loseMonster ? 18 : 0) +
      Math.min(20, Math.floor(threat.damage / 100)) +
      (analysis.hasMeaningfulBounce ? 8 : 0),
    reason: threat.lethal
      ? "False Horizon prevents lethal attack pressure"
      : "False Horizon answers opponent attack pressure",
  };
}

export function evaluateVanishingStepChainResponse(option: MirageboundChainOption, analysis: MirageboundAnalysis, context: MirageboundContext = {}) {
  if (option?.card?.name !== MB.VANISHING_STEP) return null;
  if ((analysis.opponentMonsters || []).length === 0) return null;
  if (!hasUsefulChainBounceTarget(analysis)) return null;

  const threat = getIncomingBattleThreat(context, analysis.player, analysis);
  const protectsTargetedMiragebound =
    isOpponentEffectTargetingSelf(context, analysis.player) &&
    isFaceUpMirageboundMonster(context.target) &&
    !(context.target.name === MB.SCOUT && analysis.preserveScout);
  const contextPlayerId = getOwnerId(context.player);
  const opponentAction =
    threat.isOpponentAttack ||
    protectsTargetedMiragebound ||
    (contextPlayerId && contextPlayerId !== analysis.player?.id);
  if (!opponentAction) return null;
  const convertsBattleBounce =
    isMeaningfulChainBattleThreat(threat, analysis) &&
    analysis.hasMeaningfulBounce;
  if (!convertsBattleBounce && !protectsTargetedMiragebound) {
    return null;
  }

  return {
    option,
    score:
      58 +
      (threat.lethal ? 35 : 0) +
      (threat.loseMonster ? 14 : 0) +
      (protectsTargetedMiragebound ? 20 : 0) +
      (analysis.hasViperBouncePayoff ? 10 : 0) +
      (analysis.hasPriestessBouncePayoff ? 8 : 0) +
      Math.min(12, Math.floor(threat.damage / 150)),
    reason: protectsTargetedMiragebound
      ? "Vanishing Step protects targeted Miragebound"
      : "Vanishing Step converts defensive bounce",
  };
}

type ChooseChainResponsePort = Pick<MirageboundStrategy, "analyzeGameState" | "buildChainActivationContext" | "currentAnalysis" | "evaluateFalseHorizonChainResponse" | "evaluateVanishingStepChainResponse">;

export async function chooseChainResponse(strategy: ChooseChainResponsePort, {
    chainSystem,
    game,
    player,
    activatable = [],
    context = {},
  }: Partial<Parameters<NonNullable<import("../../contracts/chainRuntime.js").ChainStrategyPort["chooseChainResponse"]>>[0]> = {}): Promise<import("../../contracts/chainRuntime.js").ChainStrategyResponse | null> {
  if (!player || !Array.isArray(activatable) || activatable.length === 0) {
    return null;
  }

  const relevant = (activatable as readonly MirageboundChainOption[]).filter(
    (option) =>
      option?.card?.name === MB.FALSE_HORIZON ||
      option?.card?.name === MB.VANISHING_STEP,
  ) as MirageboundChainOption[];
  if (relevant.length === 0) return null;
  if (hasMirageboundDefenseResponseInChain(chainSystem, player as MirageboundPlayer)) {
    return {
      pass: true,
      reason: "Miragebound defense already committed to this chain",
    };
  }

  const resolvedGame = (game || (context as MirageboundContext)?.game || strategy.currentAnalysis?.game || null) as MirageboundGame | null;
  const analysis: MirageboundAnalysis = resolvedGame
    ? strategy.analyzeGameState(resolvedGame)
    : strategy.currentAnalysis || {} as MirageboundAnalysis;
  if (!analysis.player || analysis.player.id !== player.id) {
    analysis.player = player as MirageboundPlayer;
    analysis.opponent = (context?.opponent || analysis.opponent) as MirageboundPlayer | null;
  }

  const evaluated = relevant
    .map(
      (option) =>
        strategy.evaluateFalseHorizonChainResponse(option, analysis, context as MirageboundContext) ||
        strategy.evaluateVanishingStepChainResponse(option, analysis, context as MirageboundContext),
    )
    .filter(Boolean)
    .sort((a, b) => {
      if (b!.score !== a!.score) return b!.score - a!.score;
      const order: Record<string, number> = {
        [MB.FALSE_HORIZON]: 0,
        [MB.VANISHING_STEP]: 1,
      };
      return (order[a!.option.card.name!] ?? 9) - (order[b!.option.card.name!] ?? 9);
    });

  if (evaluated.length === 0) {
    return { pass: true, reason: "no valuable Miragebound response" };
  }

  const best = evaluated[0]!;
  const activationContext = strategy.buildChainActivationContext(
    best.option,
    analysis,
    context as MirageboundContext,
  );
  return {
    ...best.option,
    priority: best.score,
    reason: best.reason,
    activationContext,
    context: {
      ...(best.option.context || context || {}),
      activationContext,
    },
  } as import("../../contracts/chainRuntime.js").ChainStrategyResponse;
}
