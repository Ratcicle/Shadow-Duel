import type { StrategyAnalysis } from "../common/analysis.js";
import type { AIState, AIPlanningContext, AIPlanningProfile, AIActivationContext } from "../../contracts/ai.js";
import type { SimulatedCardShape, SimulatedPlayerState } from "../../contracts/aiState.js";
import type { EffectDefinition } from "../../contracts/effects.js";
import type { CanonicalZone } from "../../contracts/zones.js";
import type { getGenericAscensionActions } from "../common/ascensionPlanning.js";
/** Read fields used by the legacy scoring and planning projections. */
export type BurningWestCard = SimulatedCardShape & {
  faceDown?: boolean;
  equippedCards?: BurningWestCard[];
};
export type BurningWestPlayer = SimulatedPlayerState;
export type BurningWestReadPlayer = Omit<Partial<BurningWestPlayer>, BurningWestArrayZone | "fieldSpell"> & Partial<Record<BurningWestArrayZone, BurningWestCard[]>> & {
  fieldSpell?: BurningWestCard | null;
};
export type BurningWestGame = AIState & NonNullable<Parameters<typeof getGenericAscensionActions>[0]["game"]> & {
  turnLineSearchBattleStepLimit?: number | null;
  turnLineSearchEnabled?: boolean | null;
  turnLineSearchTurnMode?: "mainOnly" | "mainBattleMain2" | null;
  turnLineSearchBeamWidth?: number | null;
  turnLineSearchMaxDepth?: number | null;
  turnLineSearchNodeBudget?: number | null;
  turnLineSearchCandidateLimit?: number | null;
};
export interface BurningWestBattlePlan {
  attacker: BurningWestCard;
  target: BurningWestCard;
  type: string | null;
  score: number;
}
export interface BurningWestQuickDrawPair {
  attacker: BurningWestCard;
  target: BurningWestCard;
  diff: number;
  score: number;
}
export interface BurningWestAnalysis extends StrategyAnalysis<BurningWestPlayer> {
  game: BurningWestGame | null | undefined;
  canNormalSummon: boolean;
  fieldCapacity: number;
  faceUpBurningWestMonsters: BurningWestCard[];
  handBurningWestMonsters: BurningWestCard[];
  handBurningWestLevel5OrLower: BurningWestCard[];
  readyBurningWestAttackers: BurningWestCard[];
  opponentMonsters: BurningWestCard[];
  faceUpOpponentMonsters: BurningWestCard[];
  strongestOpponent: BurningWestCard | null;
  bestBattlePlan: BurningWestBattlePlan | null;
  battlePlans: BurningWestBattlePlan[];
  battleDestroyableOpponent: BurningWestCard | null;
  quickDrawPair: BurningWestQuickDrawPair | null;
  quickDrawPairs: BurningWestQuickDrawPair[];
  preferredDeclaredTypes: string[];
  plannedDeclaredType: string | null;
  activeDeclaredTypes: string[];
  fieldTypeCounts: Map<string, number>;
  graveyardTypeCounts: Map<string, number>;
  wantedActive: boolean;
  wantedDeclarationActive: boolean;
  wantedInHand: boolean;
  wantedSet: boolean;
  peacemakerInHand: boolean;
  peacemakerInGraveyard: boolean;
  wantedAvailableFromDeckOrGraveyard: boolean;
  recoverableBurningWestCards: BurningWestCard[];
  recoveryNames: string[];
  hasPeacemakerTarget: boolean;
  bestPeacemakerTarget: BurningWestCard | null;
  hasBurningWestAttacker: boolean;
  hasLikelyDeclaredBattle: boolean;
  hasRelevantTypePlan: boolean;
  shouldTributeSheriff: boolean;
  oppPressure: boolean;
  hasBackrowSpace: boolean;
  underPressure?: boolean;
  battleRewardLive?: boolean;
}
export interface BurningWestPreference {
  intent?: string;
  role?: string;
  purpose?: string;
  preferredNames?: string[];
  avoidNames?: string[];
  preferredInstanceIds?: Array<string | number>;
  attackers?: BurningWestCard[];
}
export interface BurningWestActivationContext extends Omit<AIActivationContext, "actionContext" | "targetPreferences"> {
  targetPreferences?: Record<string, BurningWestPreference>;
  actionContext?: {
    targetPreference?: BurningWestPreference;
    targetPreferences?: Record<string, BurningWestPreference>;
    costPreferences?: {
      archetype?: string;
      preserveNames?: string[];
      preferNames?: string[];
    };
    specialSummonPositions?: {
      byName?: Record<string, "attack" | "defense">;
    };
  };
}
export interface BurningWestActivationOptions extends BurningWestActivationContext {
  effect?: EffectDefinition | null;
  zone?: CanonicalZone;
  activationZone?: CanonicalZone;
  sourceZone?: CanonicalZone;
  fromHand?: boolean;
}
export type BurningWestActivationAnalysis = Partial<Pick<BurningWestAnalysis, "quickDrawPair" | "bestBattlePlan" | "battleDestroyableOpponent" | "strongestOpponent" | "faceUpOpponentMonsters" | "bestPeacemakerTarget" | "faceUpBurningWestMonsters" | "plannedDeclaredType" | "preferredDeclaredTypes" | "fieldCapacity" | "handBurningWestLevel5OrLower" | "oppPressure" | "hasLikelyDeclaredBattle" | "wantedActive">>;
export interface BurningWestLineAction {
  type?: string;
  cardName?: string;
  card?: {
    name?: string;
  };
  name?: string;
  sourceName?: string;
  effectId?: string;
  sourceEffectId?: string;
  archetype?: string;
  filters?: {
    archetype?: string;
    cardKind?: unknown;
  };
  candidateFilters?: {
    archetype?: string;
    cardKind?: unknown;
  };
  materialIndex?: number;
  materialId?: number;
  materialName?: string;
  direct?: boolean;
  targetName?: string;
  attackerName?: string;
  rewardNames?: string[];
  damage?: number;
  destroyedCards?: Array<Partial<BurningWestCard> & {
    owner?: string;
    destroyedBy?: string;
  }>;
  executionerPlan?: {
    recoveryScore?: number;
    recoveryName?: string | null;
  };
}
export interface BurningWestMilestone {
  label?: string;
  reason?: string;
  score?: number;
  detail?: string;
}
export type BurningWestProfile = AIPlanningProfile & {
  critical?: boolean;
  reasons?: string[];
};
export interface BurningWestContext extends Omit<AIPlanningContext, "profile" | "planningContext" | "sequence"> {
  analysis?: Partial<BurningWestAnalysis>;
  game?: BurningWestGame;
  bot?: BurningWestPlayer;
  player?: BurningWestPlayer;
  opponent?: BurningWestPlayer | null;
  effect?: EffectDefinition;
  sourceCard?: BurningWestCard;
  activationZone?: CanonicalZone;
  strategy?: object;
  source?: BurningWestCard;
  activationContext?: BurningWestActivationContext;
  ctx?: BurningWestContext;
  profile?: Partial<BurningWestProfile>;
  planningContext?: {
    profile?: Partial<BurningWestProfile>;
  };
  sequence?: BurningWestLineAction[];
}
export interface BurningWestLineScoreContext {
  sequence?: BurningWestLineAction[];
  initialBot?: BurningWestReadPlayer;
  finalBot?: BurningWestReadPlayer;
  initialOpponent?: BurningWestReadPlayer;
  finalOpponent?: BurningWestReadPlayer;
  turnCounter?: number;
}
export type BurningWestArrayZone = "hand" | "field" | "spellTrap" | "graveyard" | "deck" | "extraDeck" | "banished";
export interface BurningWestDeclaration {
  property?: string;
  value?: string;
  expiresOnTurn?: number | null;
}
