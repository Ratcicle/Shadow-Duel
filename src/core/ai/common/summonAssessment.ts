import {
  getBattleStat,
  getEffectiveAtk,
  getEffectiveDef,
  getStrongestBattleStat,
} from "./cardStats.js";
import type { GameCard } from "../../contracts/cards.js";
import type { SimulatedCardState } from "../../contracts/aiState.js";

type SummonPosition = "attack" | "defense";
type SummonAssessmentCard = (GameCard | SimulatedCardState) & {
  faceDown?: boolean;
};
type CardValueCollection<Value> =
  | ReadonlySet<Value>
  | readonly Value[]
  | null
  | undefined;
type SummonCardGroup = "Boss" | "EnginePiece" | "KeepInHand";

interface ProjectedEntryStats {
  atk?: number;
  def?: number;
  projectedAtk?: number;
  projectedDef?: number;
}

interface EntryStatProjection {
  atk: number;
  def: number;
  baseAtk: number;
  baseDef: number;
  projected: boolean;
}

interface SummonAssessmentPlayer {
  field?: readonly SummonAssessmentCard[];
}

interface SummonAssessmentGame {
  phase?: string | null;
  getOpponent?(player: SummonAssessmentPlayer): SummonAssessmentPlayer | null;
}

interface SummonAssessmentAnalysis {
  oppField?: readonly SummonAssessmentCard[];
  field?: readonly SummonAssessmentCard[];
}

interface SummonAssessmentAction {
  cannotAttackThisTurn?: boolean;
  restrictAttackThisTurn?: boolean;
}

interface SummonAssessmentProfile {
  defaultPosition?: SummonPosition;
  invalidScoreDelta?: number;
  invalidReason?: string;
  projectEntryStats?(
    card: SummonAssessmentCard,
    context: SummonAssessmentContext,
    baseStats: Omit<EntryStatProjection, "projected">,
  ): ProjectedEntryStats | null | undefined;
  isBoss?(card: SummonAssessmentCard, context: SummonAssessmentContext): boolean;
  bossIds?: CardValueCollection<number>;
  bossNames?: CardValueCollection<string>;
  isEnginePiece?(
    card: SummonAssessmentCard,
    context: SummonAssessmentContext,
  ): boolean;
  enginePieceIds?: CardValueCollection<number>;
  enginePieceNames?: CardValueCollection<string>;
  isKeepInHand?(
    card: SummonAssessmentCard,
    context: SummonAssessmentContext,
  ): boolean;
  keepInHandIds?: CardValueCollection<number>;
  keepInHandNames?: CardValueCollection<string>;
  facedownValue?: number;
  lowImpactAtk?: number;
  keepInHandPosition?: SummonPosition;
  keepInHandScoreDelta?: number;
  keepInHandReason?: string;
  clearThreatScoreDelta?: number;
  clearThreatReason?: string;
  safeBossScoreDelta?: number;
  safeBossReason?: string;
  noImmediateAttackPenalty?: number;
  noImmediateAttackReason?: string;
  defenseSurvivalPenalty?: number;
  defenseSurvivalReason?: string;
  exposedEmergencyPenalty?: number;
  exposedPenalty?: number;
  exposedReason?: string;
  noThreatReason?: string;
  postBattlePenalty?: number;
  postBattleReason?: string;
  enginePieceScoreDelta?: number;
  enginePieceReason?: string;
  lowImpactPenalty?: number;
  lowImpactReason?: string;
  defaultReason?: string;
}

interface SummonAssessmentContext {
  profile?: SummonAssessmentProfile;
  game?: SummonAssessmentGame | null;
  analysis?: SummonAssessmentAnalysis | null;
  player?: SummonAssessmentPlayer | null;
  bot?: SummonAssessmentPlayer | null;
  opponent?: SummonAssessmentPlayer | null;
  oppField?: readonly SummonAssessmentCard[];
  myField?: readonly SummonAssessmentCard[];
  phase?: string | null;
  action?: SummonAssessmentAction | null;
  projectEntryStats?: SummonAssessmentProfile["projectEntryStats"];
  isBoss?: boolean;
  isEnginePiece?: boolean;
  isKeepInHand?: boolean;
}

interface SummonAssessmentResult {
  shouldSummon: boolean;
  position: SummonPosition;
  scoreDelta: number;
  reason: string;
  strongestThreat?: number;
  projectedAtk?: number;
  projectedDef?: number;
  baseAtk?: number;
  baseDef?: number;
  projectedStats?: boolean;
}

interface ProjectedAttackLineOptions {
  facedownValue?: number;
}

interface ProjectedAttackLine {
  projectedAtk: number;
  destroyableCount: number;
  bestTarget: SummonAssessmentCard | null;
  bestTargetStat: number;
  strongestBattleStat: number;
  strongestFaceUpAtk: number;
  safeInAttack: boolean;
  canClearStrongestBattle: boolean;
  canTradeStrongestAttack: boolean;
}

function includesCardValue<Value>(
  values: CardValueCollection<Value>,
  value: Value | null | undefined,
): boolean {
  if (!value || !values) return false;
  if (values instanceof Set) return values.has(value);
  return Array.isArray(values) && values.includes(value);
}

function matchesCardGroup(
  card: SummonAssessmentCard | null | undefined,
  ids: CardValueCollection<number>,
  names: CardValueCollection<string>,
): boolean {
  return (
    includesCardValue(ids, card?.id) || includesCardValue(names, card?.name)
  );
}

function resolveGroupMatch(
  card: SummonAssessmentCard,
  context: SummonAssessmentContext,
  profile: SummonAssessmentProfile,
  groupName: SummonCardGroup,
): boolean {
  const explicit = groupName === "Boss"
    ? context.isBoss
    : groupName === "EnginePiece"
      ? context.isEnginePiece
      : context.isKeepInHand;
  if (typeof explicit === "boolean") return explicit;

  const predicate = groupName === "Boss"
    ? profile.isBoss
    : groupName === "EnginePiece"
      ? profile.isEnginePiece
      : profile.isKeepInHand;
  if (typeof predicate === "function") {
    return !!predicate(card, context);
  }

  if (groupName === "Boss") {
    return matchesCardGroup(card, profile.bossIds, profile.bossNames);
  }
  if (groupName === "EnginePiece") {
    return matchesCardGroup(
      card,
      profile.enginePieceIds,
      profile.enginePieceNames,
    );
  }
  return matchesCardGroup(card, profile.keepInHandIds, profile.keepInHandNames);
}

function normalizeProjectedStat(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveEntryStats(
  card: SummonAssessmentCard,
  context: SummonAssessmentContext,
  profile: SummonAssessmentProfile,
): EntryStatProjection {
  const baseStats = {
    atk: getEffectiveAtk(card),
    def: getEffectiveDef(card),
  };
  const projector =
    context.projectEntryStats || profile.projectEntryStats || null;
  if (typeof projector !== "function") {
    return {
      ...baseStats,
      baseAtk: baseStats.atk,
      baseDef: baseStats.def,
      projected: false,
    };
  }

  const projected = projector(card, context, {
    ...baseStats,
    baseAtk: baseStats.atk,
    baseDef: baseStats.def,
  });

  const atk = normalizeProjectedStat(
    projected?.atk ?? projected?.projectedAtk,
    baseStats.atk,
  );
  const def = normalizeProjectedStat(
    projected?.def ?? projected?.projectedDef,
    baseStats.def,
  );

  return {
    atk,
    def,
    baseAtk: baseStats.atk,
    baseDef: baseStats.def,
    projected: atk !== baseStats.atk || def !== baseStats.def,
  };
}

export function evaluateProjectedAttackLine(
  projectedAtk: number | null | undefined,
  opponentField: readonly SummonAssessmentCard[] = [],
  options: ProjectedAttackLineOptions = {},
): ProjectedAttackLine {
  const attack = Number(projectedAtk || 0);
  const visibleMonsters = (opponentField || []).filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      !card.isFacedown &&
      !card.faceDown,
  );
  const targets = visibleMonsters.map((card) => ({
    card,
    battleStat: getBattleStat(card, {
      facedownValue: options.facedownValue ?? 1500,
    }),
    attackStat: getEffectiveAtk(card),
  }));
  const destroyable = targets
    .filter((entry) => attack > entry.battleStat)
    .sort((a, b) => b.battleStat - a.battleStat);
  const strongestBattleStat = targets.reduce(
    (max, entry) => Math.max(max, entry.battleStat),
    0,
  );
  const strongestFaceUpAtk = targets.reduce(
    (max, entry) => Math.max(max, entry.attackStat),
    0,
  );

  return {
    projectedAtk: attack,
    destroyableCount: destroyable.length,
    bestTarget: destroyable[0]?.card || null,
    bestTargetStat: destroyable[0]?.battleStat || 0,
    strongestBattleStat,
    strongestFaceUpAtk,
    safeInAttack: strongestFaceUpAtk <= 0 || attack >= strongestFaceUpAtk,
    canClearStrongestBattle:
      strongestBattleStat > 0 && attack > strongestBattleStat,
    canTradeStrongestAttack:
      strongestFaceUpAtk > 0 && attack === strongestFaceUpAtk,
  };
}

export function assessSummonEntry(
  card: SummonAssessmentCard | null | undefined,
  context: SummonAssessmentContext = {},
): SummonAssessmentResult {
  const profile = context.profile || {};
  if (!card || card.cardKind !== "monster") {
    return {
      shouldSummon: false,
      position: profile.defaultPosition || "attack",
      scoreDelta: profile.invalidScoreDelta ?? -100,
      reason: profile.invalidReason || "Invalid summon candidate",
    };
  }

  const game = context.game || null;
  const analysis = context.analysis || null;
  const player = context.player || context.bot || null;
  const opponent =
    context.opponent ||
    (game && player && typeof game.getOpponent === "function"
      ? game.getOpponent(player)
      : null);
  const oppField =
    context.oppField || opponent?.field || analysis?.oppField || [];
  const myField = context.myField || player?.field || analysis?.field || [];
  const phase = String(context.phase || game?.phase || "").toLowerCase();
  const action = context.action || {};

  const entryStats = resolveEntryStats(card, context, profile);
  const atk = entryStats.atk;
  const def = entryStats.def;
  const strongestThreat = getStrongestBattleStat(oppField, {
    facedownValue: profile.facedownValue ?? 1500,
  });
  const oppHasThreat = strongestThreat > 0;
  const isPostBattle =
    phase.includes("main2") ||
    phase.includes("main_2") ||
    phase.includes("end");
  const cannotAttack =
    action.cannotAttackThisTurn === true ||
    action.restrictAttackThisTurn === true ||
    card.cannotAttackThisTurn === true ||
    isPostBattle;
  const isEmergency = myField.length === 0 && oppHasThreat;
  const isBoss = resolveGroupMatch(card, context, profile, "Boss");
  const isEnginePiece = resolveGroupMatch(card, context, profile, "EnginePiece");
  const lowImpactAtk = profile.lowImpactAtk ?? 1000;
  const lowImpactBody = atk < lowImpactAtk && !isEnginePiece && !isBoss;
  const keepInHand = resolveGroupMatch(card, context, profile, "KeepInHand");

  if (keepInHand && !isEmergency) {
    return {
      shouldSummon: false,
      position: profile.keepInHandPosition || "defense",
      scoreDelta: profile.keepInHandScoreDelta ?? -80,
      reason:
        profile.keepInHandReason ||
        `${card.name || "Card"} should stay in hand`,
      strongestThreat,
    };
  }

  const reasons: string[] = [];
  let position = profile.defaultPosition || "attack";
  let scoreDelta = 0;
  const canClearThreat = oppHasThreat && !cannotAttack && atk > strongestThreat;
  const safeInAttack = !oppHasThreat || atk >= strongestThreat;
  const safeInDefense = !oppHasThreat || def >= strongestThreat;

  if (canClearThreat) {
    position = "attack";
    scoreDelta += profile.clearThreatScoreDelta ?? 2.2;
    reasons.push(profile.clearThreatReason || "can attack over current threat");
  } else if (isBoss && safeInAttack) {
    position = "attack";
    scoreDelta += profile.safeBossScoreDelta ?? 1.5;
    reasons.push(profile.safeBossReason || "boss is safe in attack");
  } else if (cannotAttack && !isBoss) {
    position = safeInDefense || def >= atk ? "defense" : "attack";
    scoreDelta -= profile.noImmediateAttackPenalty ?? 0.6;
    reasons.push(profile.noImmediateAttackReason || "no immediate attack value");
  } else if (!safeInAttack && safeInDefense) {
    position = "defense";
    scoreDelta -= profile.defenseSurvivalPenalty ?? 0.4;
    reasons.push(
      profile.defenseSurvivalReason || "defense survives better than attack",
    );
  } else if (!safeInAttack && !safeInDefense) {
    position = "defense";
    scoreDelta -= isEmergency
      ? profile.exposedEmergencyPenalty ?? 0.8
      : profile.exposedPenalty ?? 1.8;
    reasons.push(
      profile.exposedReason || "summon is exposed to opponent threat",
    );
  } else if (!oppHasThreat) {
    position = "attack";
    reasons.push(profile.noThreatReason || "no opponent battle threat");
  }

  if (isPostBattle && !isBoss && !canClearThreat) {
    position = safeInDefense || def >= atk ? "defense" : position;
    scoreDelta -= profile.postBattlePenalty ?? 0.5;
    reasons.push(
      profile.postBattleReason || "post-battle summon favors defense/material",
    );
  }

  if (isEnginePiece) {
    scoreDelta += profile.enginePieceScoreDelta ?? 0.6;
    reasons.push(profile.enginePieceReason || "engine/combo body");
  }
  if (lowImpactBody && !isEmergency) {
    scoreDelta -= profile.lowImpactPenalty ?? 2.5;
    reasons.push(
      profile.lowImpactReason || "low-impact body without emergency",
    );
  }

  return {
    shouldSummon:
      !lowImpactBody || isEmergency || isEnginePiece || isBoss,
    position,
    scoreDelta,
    reason: reasons.join("; ") || profile.defaultReason || "default summon assessment",
    strongestThreat,
    projectedAtk: atk,
    projectedDef: def,
    baseAtk: entryStats.baseAtk,
    baseDef: entryStats.baseDef,
    projectedStats: entryStats.projected,
  };
}
