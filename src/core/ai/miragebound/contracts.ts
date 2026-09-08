import type { StrategyAnalysis } from "../common/analysis.js";
import type { CanonicalZone } from "../../contracts/zones.js";
import type MirageboundStrategy from "../MirageboundStrategy.js";
import type { AIState, AIPlanningProfile, AIPlanningContext, AIActivationContext } from "../../contracts/ai.js";
import type { SimulatedCardState, SimulatedPlayerState } from "../../contracts/aiState.js";
import type { EffectDefinition } from "../../contracts/effects.js";
export type MirageboundCard = SimulatedCardState & {
  cardName?: string;
  label?: string;
};
export type MirageboundPlayer = SimulatedPlayerState;
export interface MirageboundAnalysis extends StrategyAnalysis<MirageboundPlayer> {
  game: MirageboundGame | null | undefined;
  canNormalSummon: boolean;
  fieldCapacity: number;
  availableMonsterZonesAfterBounce: number;
  faceUpMiragebounds: MirageboundCard[];
  mirageboundField: MirageboundCard[];
  mirageboundHand: MirageboundCard[];
  mirageboundGraveyard: MirageboundCard[];
  opponentMonsters: MirageboundCard[];
  opponentAttackPositionMonsters: MirageboundCard[];
  opponentDefensePositionMonsters: MirageboundCard[];
  opponentCards: MirageboundCard[];
  readyAttackers: MirageboundCard[];
  strongestOpponentStat: number;
  strongestOpponentAtk: number;
  bestOwnBattleStat: number;
  hasOasisActive: boolean;
  hasDesertLeviathan: boolean;
  hasSovereignInField: boolean;
  hasScoutInField: boolean;
  scoutEffectActivations: number;
  scoutNearAscension: boolean;
  scoutReadyForAscension: boolean;
  preserveScout: boolean;
  hasJackalInHand: boolean;
  hasJackalBouncePayoff: boolean;
  hasFalseKingInHand: boolean;
  hasDancerInHand: boolean;
  hasRebelInHand: boolean;
  hasRebelInField: boolean;
  hasRebelOpenZoneTriggerWindow: boolean;
  hasRebelVanishingStepWindow: boolean;
  hasRebelFalseKingTriggerWindow: boolean;
  hasRebelPositionTriggerWindow: boolean;
  hasRebelPiercingPressure: boolean;
  hasViperBouncePayoff: boolean;
  hasPriestessBouncePayoff: boolean;
  hasMeaningfulBounce: boolean;
  hasPlannedBounce: boolean;
  canKeepOffenseAfterBounce: boolean;
  canViperPressureAfterSummon: boolean;
  hasFalseHorizonAvailable: boolean;
  hasVanishingStepAvailable: boolean;
  hasMirrorPathOnField: boolean;
  needsBattleProtection: boolean;
  hasSafeBackrowDefense: boolean;
  mirrorPathIsOnlyBattleProtection: boolean;
  hasHeatHazeRecoveryLine: boolean;
  opponentBackrowPressure: boolean;
  hasLeviathanMaterials: boolean;
  hasLeviathanLine: boolean;
  oppPressure: boolean;
}
export type MirageboundGame = AIState & {
  canUseAsAscensionMaterial?(player: MirageboundPlayer, card: MirageboundCard): {
    ok: boolean;
  };
  getAscensionCandidatesForMaterial?(player: MirageboundPlayer, card: MirageboundCard): MirageboundCard[];
  checkAscensionRequirements?(player: MirageboundPlayer, card: MirageboundCard, material: MirageboundCard): {
    ok: boolean;
  };
  materialDuelStats?: Record<string, {
    effectActivationsByMaterialId?: ReadonlyMap<number, number>;
  }>;
  _gameRef?: {
    materialDuelStats?: Record<string, {
      effectActivationsByMaterialId?: ReadonlyMap<number, number>;
    }>;
  };
  canSummonExtraDeckCardByProcedure?(card: MirageboundCard, player: MirageboundPlayer, options: {
    silent: boolean;
  }): {
    ok: boolean;
    materialCombos?: MirageboundCard[][];
  };
  turnLineSearchBattleStepLimit?: number;
  turnLineSearchEnabled?: boolean;
  turnLineSearchTurnMode?: "mainOnly" | "mainBattleMain2";
  turnLineSearchBeamWidth?: number;
  turnLineSearchMaxDepth?: number;
  turnLineSearchNodeBudget?: number;
  turnLineSearchCandidateLimit?: number;
};
export interface MirageboundContext extends Omit<AIPlanningContext, "planningContext" | "sequence" | "profile"> {
  profile?: Partial<MirageboundProfile>;
  sequence?: MirageboundLineAction[];
  planningContext?: {
    profile?: Partial<MirageboundProfile>;
  };
  preferDefenseOutcome?: boolean;
  type?: string;
  attacker?: MirageboundCard | null;
  defender?: MirageboundCard | null;
  target?: MirageboundCard | null;
  eventCard?: MirageboundCard | null;
  attackerOwner?: MirageboundOwner;
  defenderOwner?: MirageboundOwner;
  targetOwner?: MirageboundOwner;
  sourceOwner?: MirageboundOwner;
  ctx?: {
    source?: MirageboundCard;
  };
  analysis?: MirageboundAnalysis;
  game?: MirageboundGame;
  state?: MirageboundGame;
  bot?: MirageboundPlayer;
  player?: MirageboundPlayer;
  opponent?: MirageboundPlayer | null;
  source?: MirageboundCard;
  sourceCard?: MirageboundCard;
  card?: MirageboundCard;
  effect?: EffectDefinition;
  activationContext?: MirageboundActivationContext;
  activationZone?: CanonicalZone;
  zone?: CanonicalZone;
  sourceZone?: CanonicalZone;
  fromHand?: boolean;
  strategy?: MirageboundStrategy;
}
export interface MirageboundMilestone {
  label: string;
  score: number;
  detail: unknown;
}
export interface MirageboundLineAction {
  filters?: {
    archetype?: string;
    cardKind?: unknown;
  };
  type?: import("../../contracts/ai.js").AIPlannedAction["type"];
  cardName?: string;
  card?: MirageboundCard;
  sourceCard?: MirageboundCard;
  name?: string;
  attackerName?: string;
  targetName?: string | null;
  direct?: boolean;
  reason?: string;
  index?: number;
  material?: MirageboundCard;
  materialName?: string;
  materials?: Array<{
    name?: string;
  }>;
  materialNames?: string[];
  battleSteps?: MirageboundLineAction[];
  rewardNames?: string[];
  damage?: number;
  destroyedCards?: Array<MirageboundCard & {
    owner?: string;
  }>;
}
export type MirageboundOwner = string | {
  id?: string | number;
  controller?: string;
  owner?: string;
} | null;
export interface MirageboundPreference {
  intent?: string;
  role?: string;
  purpose?: string;
  preferredNames?: string[];
  avoidNames?: string[];
  preferNames?: string[];
  preserveNames?: string[];
  preferredInstanceIds?: Array<string | number>;
  avoidInstanceIds?: Array<string | number>;
  defensiveNames?: string[];
  offensiveNames?: string[];
  attackers?: MirageboundCard[];
  opponentLp?: number;
  atkReduction?: number;
  defReduction?: number;
}
export type MirageboundActivationContext = Omit<AIActivationContext, "actionContext" | "targetPreferences"> & {
  targetPreferences?: Record<string, MirageboundPreference>;
  actionContext?: {
    targetPreferences?: Record<string, MirageboundPreference>;
    specialSummonPositions?: {
      byName?: Record<string, string>;
    };
  };
};
export interface MirageboundChainOption {
  card: MirageboundCard;
  effect?: EffectDefinition;
  context?: MirageboundContext;
  activationContext?: MirageboundActivationContext;
  sourceZone?: CanonicalZone;
  zone?: CanonicalZone;
}
export interface MirageboundChainContext {
  chainSystem?: {
    getChainSummary?(): Array<{
      controllerId?: string | null;
      cardName?: string | null;
    }>;
  };
  game?: MirageboundGame;
  player?: MirageboundPlayer;
  activatable?: MirageboundChainOption[];
  context?: MirageboundContext;
}
export interface MirageboundBattleContext {
  attacker?: (MirageboundStatCard & {
    name?: string;
  }) | null;
  target?: (MirageboundStatCard & {
    name?: string;
  }) | null;
  lethalNow?: boolean;
  attackerSurvived?: boolean;
  targetSurvived?: boolean;
  isSecondAttack?: boolean;
  summary?: {
    damage?: number;
    destroyedCards?: Array<{
      owner?: string;
    }>;
  };
}
export type MirageboundProfile = AIPlanningProfile & Partial<Pick<MirageboundAnalysis, "scoutNearAscension" | "scoutReadyForAscension" | "needsBattleProtection" | "mirrorPathIsOnlyBattleProtection" | "hasMeaningfulBounce" | "hasHeatHazeRecoveryLine" | "hasLeviathanLine" | "hasLeviathanMaterials" | "hasRebelPositionTriggerWindow" | "hasRebelPiercingPressure">> & {
  critical?: boolean;
  reasons?: string[];
};
export type MirageboundStatCard = Pick<import("../../contracts/aiState.js").SimulatedCardShape, "cardKind" | "isFacedown" | "position" | "atk" | "def" | "tempAtkBoost" | "tempDefBoost" | "equipAtkBonus" | "equipDefBonus">;
