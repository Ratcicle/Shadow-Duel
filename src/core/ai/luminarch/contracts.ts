import type { AIAction, AIActivationContext, AIPlanningContext, AIPlanningProfile, AIState, AITributeRequirement } from "../../contracts/ai.js";
import type { SimulatedCardState, SimulatedPlayerState } from "../../contracts/aiState.js";
import type { BattlePosition, BattlePositionInput } from "../../contracts/cards.js";
import type { CostPreferences } from "../common/preferencePolicy.js";
import type { FinisherPlan } from "../common/finisherPlans.js";
import type { MacroStrategyDecision } from "../MacroPlanning.js";
export interface LuminarchAnalysis {
  hand?: SimulatedCardState[];
  field?: SimulatedCardState[];
  spellTrap?: SimulatedCardState[];
  graveyard?: SimulatedCardState[];
  deck?: SimulatedCardState[];
  extraDeck?: SimulatedCardState[];
  oppField?: SimulatedCardState[];
  oppHand?: SimulatedCardState[];
  oppSpellTrap?: SimulatedCardState[];
  oppGraveyard?: SimulatedCardState[];
  fieldSpell?: SimulatedCardState | null;
  oppFieldSpell?: SimulatedCardState | null;
  bot?: SimulatedPlayerState | null;
  player?: SimulatedPlayerState | null;
  opponent?: SimulatedPlayerState | null;
  game?: LuminarchGame | null;
  lp?: number;
  oppLp?: number;
  oppLP?: number;
  oppFieldCount?: number;
  currentTurn?: number;
  phase?: string;
  summonAvailable?: boolean;
  canNormalSummon?: boolean;
  normalSummonsAvailable?: number;
  additionalNormalSummons?: number;
  isSimulatedState?: boolean;
  usedEffects?: Array<number | undefined>;
  resourceEconomy?: import("./resourceEconomy.js").LuminarchResourceEconomy;
  luminarchDefensePlan?: Partial<ReturnType<typeof import("./defensePlanning.js").evaluateLuminarchDefensePlan>>;
  availableCombos?: ReturnType<typeof import("./combos.js").detectAvailableCombos>;
  finisherPlans?: LuminarchPlan[];
}
export interface LuminarchActionContext {
  costPreferences?: Partial<CostPreferences> & object;
  targetPreferences?: object;
  fusionPreferences?: {
    preferredNames: string[];
    scoresByName: Record<string, number>;
    reason: string | null;
  } | null;
  preferredSearchNames?: Array<string | undefined>;
  specialSummonPositions?: {
    byName?: Record<string, BattlePositionInput>;
  };
  fusionPositions?: {
    byName?: Record<string, BattlePositionInput>;
  };
}
export type LuminarchActivationContext = Omit<AIActivationContext, "actionContext"> & {
  actionContext?: LuminarchActionContext;
};
export interface LuminarchHooks {
  evaluateBarbariasStanceDance?(card: import("../../contracts/aiState.js").SimulatedCardShape, opponent: SimulatedPlayerState | null | undefined, options?: {
    afterManualDefense?: boolean;
  }): {
    score: number;
    reason?: string;
  };
  getTributeRequirementFor?(card: SimulatedCardState, player: SimulatedPlayerState): AITributeRequirement;
  selectBestTributes?(field: SimulatedCardState[], needed: number, card: SimulatedCardState, context?: LuminarchContext): number[];
  shouldSummonMonsterSafely?(card: SimulatedCardState, game: AIState, opponent: SimulatedPlayerState): {
    yes: boolean;
    priority?: number;
    reason?: string;
    position?: BattlePosition;
    lancerPlan?: ReturnType<typeof import("./lancerPlanning.js").evaluateRadiantLancerBattlePlan> | null;
  };
  chooseSummonPosition?(card: SimulatedCardState, game: AIState): BattlePosition;
  shouldSetFacedown?(card: SimulatedCardState, position: BattlePositionInput): boolean;
}
export interface LuminarchContext extends Omit<AIPlanningContext, "profile" | "phase" | "planningContext" | "sequence">, LuminarchAnalysis {
  botState?: Partial<LuminarchPlayer>;
  sequence?: LuminarchLineAction[];
  analysis?: LuminarchAnalysis | null;
  activationContext?: LuminarchActivationContext;
  hooks?: LuminarchHooks;
  profile?: Partial<AIPlanningProfile> & {
    critical?: boolean;
    reasons?: string[];
    battleStepLimit?: number;
  };
  shouldSummon?: {
    yes?: boolean;
    priority?: number;
    reason?: string;
    lancerPlan?: {
      hasLine?: boolean;
      improvesThreatMatchup?: boolean;
    } | null;
  };
  macroDecision?: MacroStrategyDecision;
  planningContext?: {
    profile?: AIPlanningProfile & {
      critical?: boolean;
    };
  };
  zone?: string;
  state?: LuminarchGame;
  action?: import("../../contracts/ai.js").AIAction;
  sourceAction?: import("../../contracts/ai.js").AIAction | null;
  actionPosition?: BattlePositionInput;
  position?: BattlePositionInput;
  evaluationContext?: LuminarchContext;
  cardToSummon?: SimulatedCardState;
  fieldIndex?: number;
}
export type LuminarchPlayer = SimulatedPlayerState & {
  debug?: boolean;
  usedEffects?: number[];
};
export type LuminarchGame = AIState & {
  turnLineSearchEnabled?: boolean;
  turnLineSearchTurnMode?: "mainOnly" | "mainBattleMain2";
  turnLineSearchBeamWidth?: number;
  turnLineSearchMaxDepth?: number;
  turnLineSearchNodeBudget?: number;
  turnLineSearchCandidateLimit?: number;
  canChangePosition?(card: SimulatedCardState): boolean;
  canUseAsAscensionMaterial?(player: SimulatedPlayerState, card: SimulatedCardState): {
    ok: boolean;
    reason?: string;
  };
  getAscensionCandidatesForMaterial?(player: SimulatedPlayerState, card: SimulatedCardState): SimulatedCardState[];
  checkAscensionRequirements?(player: SimulatedPlayerState, card: SimulatedCardState, material?: SimulatedCardState): {
    ok: boolean;
    reason?: string;
  };
  effectEngine?: {
    canActivate?(card: SimulatedCardState, player: SimulatedPlayerState): {
      ok: boolean;
      reason?: string;
    };
    canActivateSpellFromHandPreview?(card: SimulatedCardState, player: SimulatedPlayerState, options?: object): {
      ok: boolean;
      reason?: string;
    };
    canActivateFieldSpellEffectPreview?(card: SimulatedCardState, player: SimulatedPlayerState, selections?: unknown, options?: object): {
      ok: boolean;
      reason?: string;
    };
    canActivateMonsterEffectPreview?(card: SimulatedCardState, player: SimulatedPlayerState, zone: string, selections?: unknown, options?: object): {
      ok: boolean;
      reason?: string;
    };
    canSummonFusion?(card: SimulatedCardState, materials: SimulatedCardState[], player: SimulatedPlayerState, options?: {
      materialInfo?: Array<{
        zone: string;
      }>;
    }): boolean;
    findFusionMaterialCombos?(card: SimulatedCardState, materials: SimulatedCardState[], options?: {
      materialInfo?: Array<{
        zone: string;
      }>;
    }): SimulatedCardState[][];
  } | null;
};
export type LuminarchMacroDecision = Omit<MacroStrategyDecision, "detail"> & {
  detail: MacroStrategyDecision["detail"] | object;
};
export interface LuminarchActionGenerationContext extends LuminarchContext {
  game: LuminarchGame;
  bot: LuminarchPlayer;
  opponent: LuminarchPlayer;
  macroStrategy: LuminarchMacroDecision;
  activationContext: LuminarchActivationContext;
  gameStance: {
    stance: string;
    reason: string;
  };
  bestFinisherPlan?: LuminarchPlan | null;
  fusionOpportunity?: {
    fusionName?: string | null;
    decision: {
      reason?: string | null;
      priority: number;
    };
    plan: LuminarchPlan;
  } | null;
  verboseEval?: boolean;
  hooks: Required<LuminarchHooks>;
}
export interface LuminarchPlan extends Omit<FinisherPlan, "details"> {
  details: {
    card?: SimulatedCardState;
    target?: SimulatedCardState;
    polyCard?: SimulatedCardState;
    material?: SimulatedCardState;
    materialIndex?: number;
    handIndex?: number;
    fieldIndex?: number;
    position?: BattlePosition;
    spellPriority?: number;
    radiantLancerPlan?: object;
    spellIndex?: number;
    spellCardId?: number;
    stanceValue?: {
      score: number;
      reason?: string;
    };
    hasFortress?: boolean;
    has2800Tank?: boolean;
    materialName?: string | null;
    materialInstanceId?: string | number | null;
    ascensionPriority?: number;
    gyLuminarch?: number;
    oppStrength?: number;
    summonPriority?: number;
    lancerPlan?: ReturnType<typeof import("./lancerPlanning.js").evaluateRadiantLancerBattlePlan>;
    reviveTargets?: Array<string | undefined>;
    reason?: string;
  };
}
export interface LuminarchLineAction {
  type?: import("../../contracts/ai.js").AIPlannedAction["type"];
  card?: import("../../contracts/cards.js").GameCard | SimulatedCardState | null;
  cardName?: string;
  name?: string;
  index?: number;
  fusionTarget?: string;
  reason?: string;
  direct?: boolean;
  targetName?: string | null;
  attackerName?: string;
  damage?: number;
  rewardNames?: unknown[];
  battleSteps?: LuminarchLineAction[];
  lpGains?: Array<{
    amount?: number;
  }>;
  destroyedCards?: Array<import("../../contracts/aiState.js").SimulatedCardShape & {
    owner?: string;
  }>;
}
