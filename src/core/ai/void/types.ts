import type { AIActivationContext, AIState, AIStrategyBotPort } from "../../contracts/ai.js";
import type { AiLiveGamePort, AiStateShape, SimulatedCardState, SimulatedPlayerState, SimulationGameState, PerspectiveGameState, GameTreeSimulationGameState } from "../../contracts/aiState.js";
import type { GameCard } from "../../contracts/cards.js";
import type { EffectDefinition } from "../../contracts/effects.js";
import type { CanonicalZone } from "../../contracts/zones.js";
import type { FinisherPlan } from "../common/finisherPlans.js";
import type { buildStrategyAnalysis } from "../common/analysis.js";
import type { getFusionPreferenceScore } from "../common/fusionPlanning.js";
import type { buildVoidCostPreferences } from "./costPolicy.js";
import type { detectAvailableCombos } from "./combos.js";
import type { evaluateVoidFinisherPlans } from "./priorities.js";
import type { analyzeHollowEconomy, assessVoidHollowResourcePolicy } from "./scoring.js";

export interface VoidSwarmPayoffs {
  hasBossPayoff: boolean;
  hasFusionPayoff: boolean;
  hasGYPayoff: boolean;
  totalPayoffValue: number;
  reasons: string[];
}
export interface VoidMacroStrategy {
  mode: string;
  priority: number;
  reason?: string;
  target?: ReturnType<typeof detectAvailableCombos>[number];
  payoffs?: VoidSwarmPayoffs | undefined;
}

export type StrategyCard = (GameCard | SimulatedCardState) & {
  usedEffectThisTurn?: boolean;
};

export type VoidPlayer = AIStrategyBotPort & {
  usedEffects?: number[];
};

export interface VoidGame extends Omit<AiLiveGamePort, "player" | "bot" | "effectEngine" | "_gameRef"> {
  player: VoidPlayer;
  bot: VoidPlayer;
  _gameRef?: VoidGame;
  turnLineSearchEnabled?: boolean;
  materialDuelStats?: NonNullable<AiStateShape["materialDuelStats"]>;
  effectEngine?: {
    usedThisTurn?: ReadonlyMap<string, number>;
    checkOncePerTurn?(card: StrategyCard, player: Partial<AIStrategyBotPort> | null | undefined, effect: EffectDefinition): {
      ok: boolean;
      reason?: string;
    } | null;
    checkOncePerDuel?(card: StrategyCard, player: Partial<AIStrategyBotPort> | null | undefined, effect: EffectDefinition): {
      ok: boolean;
      reason?: string;
    } | null;
    canActivateMonsterEffectPreview?(card: StrategyCard, player: VoidPlayer, zone: CanonicalZone, selections: unknown, options: object): {
      ok?: boolean;
      reason?: string | null;
    } | null;
    getSpellTrapActivationEffect?(card: StrategyCard, options: {
      fromHand?: boolean;
    }): EffectDefinition | null;
  } | null;
  canActivatePolymerization?(): boolean;
  canUseAsAscensionMaterial?(player: Partial<AIStrategyBotPort>, material: StrategyCard): {
    ok: boolean;
    reason?: string;
  };
  checkAscensionRequirements?(player: Partial<AIStrategyBotPort>, card: StrategyCard, material?: StrategyCard): {
    ok: boolean;
    reason?: string;
  };
}

export type VoidAnalysisInput = Omit<Partial<ReturnType<typeof buildStrategyAnalysis>>, "phase" | "game"> & {
  game?: VoidGame | null;
  phase?: string | null | undefined;
  oppStrongestAtk?: number;
  oppStrongestBattle?: number;
  oppFieldCount?: number;
  myLP?: number;
  hollowCount?: number;
  voidCount?: number;
  swarmPayoffs?: VoidSwarmPayoffs;
  readyCombos?: ReturnType<typeof detectAvailableCombos>;
  hollowEconomy?: ReturnType<typeof analyzeHollowEconomy>;
  bestFinisherPlan?: FinisherPlan | null;
};

export type VoidAnalysis = VoidAnalysisInput & {
  hand: StrategyCard[];
  field: StrategyCard[];
  graveyard: StrategyCard[];
  deck: StrategyCard[];
  extraDeck: StrategyCard[];
  spellTrap: StrategyCard[];
  fieldSpell: StrategyCard | null;
  lp: number;
  bot: VoidPlayer;
  opponent: SimulatedPlayerState | null;
  phase: VoidGame["phase"];
  summonAvailable: boolean;
  oppField: StrategyCard[];
  oppHand: StrategyCard[];
  oppGraveyard: StrategyCard[];
  oppSpellTrap: StrategyCard[];
  oppFieldSpell: StrategyCard | null | undefined;
  oppLP: number;
  oppFieldCount: number;
  oppStrongestAtk: number;
  oppStrongestBattle: number;
  myStrongestAtk: number;
  hollowCount: number;
  voidCount: number;
  hollowsInHand: number;
  myLP: number;
  availableCombos?: ReturnType<typeof detectAvailableCombos>;
  finisherPlans?: ReturnType<typeof evaluateVoidFinisherPlans>;
  hollowResourcePolicy?: ReturnType<typeof assessVoidHollowResourcePolicy>;
  macroStrategy?: VoidMacroStrategy;
};

export type VoidActivationContext = AIActivationContext & {
  actionContext?: {
    costPreferences?: ReturnType<typeof buildVoidCostPreferences>;
    fusionPreferences?: NonNullable<NonNullable<Parameters<typeof getFusionPreferenceScore>[0]>["actionContext"]>["fusionPreferences"];
  };
};

export interface VoidSelectionAction {
  type?: string;
  cannotAttackThisTurn?: boolean;
  restrictAttackThisTurn?: boolean;
}

export interface VoidSelectionContext {
  game?: AIState | undefined;
  player?: VoidPlayer;
  source?: Partial<StrategyCard> | undefined;
  action?: VoidSelectionAction | undefined;
  forceSummonAssessment?: boolean;
}

export interface VoidAscensionContext<Card extends StrategyCard = StrategyCard> {
  choices?: Array<{
    material: Card;
    ascensionCard: Card;
  }>;
  game?: AIState;
  bot?: VoidPlayer;
  opponent?: VoidPlayer | null;
  ascensionCard?: StrategyCard;
  material?: StrategyCard;
}

export interface VoidBattleContext {
  attacker?: StrategyCard | null;
  target?: StrategyCard | null;
  lethalNow?: boolean;
  attackerSurvived?: boolean;
  targetSurvived?: boolean;
  isSecondAttack?: boolean;
  bot?: VoidPlayer;
  opponent?: VoidPlayer | null;
}

export type VoidCompleteAnalysis = VoidAnalysis & Required<Pick<VoidAnalysis, "availableCombos" | "readyCombos" | "hollowEconomy" | "swarmPayoffs" | "finisherPlans" | "hollowResourcePolicy" | "macroStrategy">>;

export type StrategySimulation = SimulationGameState | PerspectiveGameState | GameTreeSimulationGameState;

export interface VoidSummonPayload {
  effect?: EffectDefinition;
  state?: AiStateShape;
  player?: SimulatedPlayerState;
  card?: SimulatedCardState;
  newCard?: SimulatedCardState;
  fusionCard?: SimulatedCardState;
  fromZone?: string | undefined;
  action?: VoidSelectionAction | undefined;
}
