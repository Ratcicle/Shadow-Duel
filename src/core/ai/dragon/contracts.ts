import type { SimulatedCardShape } from "../../contracts/aiState.js";
import type { CardFilter, EffectDefinition } from "../../contracts/effects.js";
import type { GameRuntimeState } from "../../contracts/gameRuntime.js";
import type { analyzeDragonState } from "./stateAnalysis.js";

/** Read projection shared by the Dragon policies for live and simulated cards. */
/** Read projection shared by the Dragon policies for live and simulated cards. */
export interface DragonCard extends Omit<SimulatedCardShape, "equips" | "equippedTo" | "equipTarget" | "sourceCard" | "counters"> {
  printedAtk?: number;
  effectActivations?: number;
  simEffectActivations?: number;
  counters?: ReadonlyMap<string, number> | Partial<Record<string, number>>;
  equips?: DragonCard[];
  equippedTo?: DragonCard | null;
  equipTarget?: DragonCard | number | string | null;
  sourceCard?: DragonCard | string | null;
}

export interface DragonMaterialEntry {
  card: DragonCard;
  zone?: DragonZone;
  index: number;
}
export type DragonCandidate = DragonCard | {
  candidate: DragonCard;
  index?: number;
} | {
  card: DragonCard;
  index?: number;
};
export interface DragonAscensionChoice<Card extends DragonCard = DragonCard> {
  ascensionCard?: Card;
  material?: Card;
  ascensionIndex?: number;
  materialIndex?: number;
}
export interface DragonFusionPlan {
  ok: boolean;
  fusionName: string;
  score: number;
  reason: string;
  priority?: number;
  materialEntries: DragonMaterialEntry[];
  projectedAtk?: number;
  preserveNames?: string[];
  gyBuffTarget?: DragonMaterialEntry | null;
  recycleTargets?: DragonMaterialEntry[];
  futureRevive?: boolean;
}

export type DragonZone = "hand" | "field" | "graveyard" | "deck" | "extraDeck" | "banished" | "spellTrap" | "fieldSpell";

export interface DragonPlayer<Card extends DragonCard = DragonCard> {
  id?: string;
  lp?: number;
  hand?: Card[];
  field?: Card[];
  graveyard?: Card[];
  deck?: Card[];
  extraDeck?: Card[];
  banished?: Card[];
  spellTrap?: Card[];
  fieldSpell?: Card | null;
  materialEntries?: DragonMaterialEntry[];
  _simMaterialEffectActivationsByMaterialId?: unknown;
  summonCount?: number;
  normalSummonUsed?: boolean;
  additionalNormalSummons?: number;
  oncePerTurnUsageByName?: SimulatedCardShape["oncePerTurnUsageByName"];
}

export interface DragonGame {
  player?: DragonPlayer | null;
  bot?: DragonPlayer | null;
  opponent?: DragonPlayer | null;
  phase?: string | null;
  turn?: string | null;
  turnCounter?: number;
  turnLineSearchEnabled?: boolean;
  turnLineSearchBeamWidth?: number | null;
  turnLineSearchCandidateLimit?: number | null;
  turnLineSearchMaxDepth?: number | null;
  turnLineSearchNodeBudget?: number | null;
  turnLineSearchTurnMode?: "mainOnly" | "mainBattleMain2" | null;
  _simMaterialEffectActivationsByMaterialId?: {
    player?: unknown;
    bot?: unknown;
  };
  _isPerspectiveState?: boolean;
  _gameRef?: DragonGame;
  _dragonSimOnce?: {
    player?: unknown;
    bot?: unknown;
  };
  oncePerTurnUsage?: GameRuntimeState["oncePerTurnUsage"];
  materialDuelStats?: {
    player?: {
      effectActivationsByMaterialId?: unknown;
    };
    bot?: {
      effectActivationsByMaterialId?: unknown;
    };
  };
  currentDragonBotList?: boolean;
  currentAnalysis?: DragonAnalysis | null;
  analysis?: DragonAnalysis;
  dragonState?: DragonState;
}

export type DragonState = ReturnType<typeof analyzeDragonState>;

export interface DragonAnalysis extends DragonPlayer {
  bot?: DragonPlayer;
  player?: DragonPlayer;
  opponent?: DragonPlayer;
  game?: DragonGame | null;
  currentDragonBotList?: boolean;
  dragonState?: DragonState;
  oppField?: DragonCard[];
  oppGraveyard?: DragonCard[];
  oppHand?: number;
  oppBackrow?: number;
  oppLp?: number;
  lpRatio?: number;
  canNormalSummon?: boolean;
  fieldCapacity?: number;
  hasJaggedPeak?: boolean;
  jaggedPeakCounters?: number;
  extremeDragonEconomy?: {
    economy: ReturnType<typeof import("../common/resourceEconomy.js").analyzeResourceEconomy>;
  };
  phase?: string | null;
}

export interface DragonPreference {
  role?: string;
  purpose?: string;
  atkReduction?: number;
  defReduction?: number;
  attackers?: DragonCard[];
  intent?: string;
  offensiveNames?: string[];
  defensiveNames?: string[];
  preferNames?: string[];
  preferredNames?: string[];
  forceNames?: string[];
  preserveNames?: string[];
  avoidNames?: string[];
  preferredInstanceIds?: Array<string | number>;
  avoidInstanceIds?: Array<string | number>;
  offensivePayoffNames?: string[];
}

export interface DragonPolicyContext {
  player?: DragonPlayer | null;
  bot?: DragonPlayer | null;
  opponent?: DragonPlayer | null;
  owner?: DragonPlayer | null;
  game?: DragonGame | null;
  source?: DragonCard | null;
  sourceCard?: DragonCard | null;
  card?: DragonCard | null;
  effect?: Partial<EffectDefinition> | null;
  effectId?: string | null;
  sourceName?: string;
  other?: object;
  analysis?: DragonAnalysis | null;
  dragonState?: DragonState;
  currentDragonBotList?: boolean;
  isSimulatedState?: boolean;
  ctx?: DragonPolicyContext;
  fallbackValue?(card: DragonCard): number;
  costPreferences?: DragonPreference;
  targetPreferences?: Record<string, DragonPreference | undefined>;
  preferNames?: string[];
  preserveNames?: string[];
  routeKind?: string;
  fieldCostCount?: number;
  hasHellkiteRoarAccess?: boolean;
  action?: DragonSearchAction | null;
  field?: DragonCard[];
  candidates?: DragonCard[];
  summoned?: DragonCard | null;
  oppField?: DragonCard[];
  attacker?: DragonCard | null;
  target?: DragonCard | null;
  attackerSurvived?: boolean;
  targetSurvived?: boolean;
  lethalNow?: boolean;
  isSecondAttack?: boolean;
  tributeCount?: number;
  allowExtremeReplacement?: boolean;
  canKeepExtremeSolo?: boolean;
  materialEntries?: DragonMaterialEntry[];
  allowMissingExtraDeck?: boolean;
  extraDeckPlan?: DragonFusionPlan | null;
  dragonExtraDeckPlan?: DragonFusionPlan | null;
}

export interface DragonSearchAction {
  cardName?: string;
  type?: string;
  effectId?: string | null;
  selectionId?: string;
  resultRef?: string;
  filters?: CardFilter;
  sourceName?: string;
  other?: object;
}

export interface DragonCardKnowledge {
  role?: string;
  priority?: number;
  value?: number;
  atk?: number;
  def?: number;
  level?: number;
  isExtremeDragon?: boolean;
  summonCondition?: string;
  effect?: string;
  synergies?: string[];
  playPatterns?: string[];
  situationScore?: Record<string, number>;
  dangerousEffect?: string;
  legacyOnly?: boolean;
  outOfPlan?: boolean;
  tags?: string[];
  goodDiscard?: boolean;
  eclipseEngine?: boolean;
  currentBotCore?: boolean;
  goodSearchTarget?: string;
  selfSummons?: boolean;
  fusionMaterial?: string;
  legacyConvergingStarsTarget?: boolean;
  situationalOnly?: boolean;
  isTuner?: boolean;
  playCondition?: string;
  polymerizationTarget?: boolean;
}
