import {
  getBattleStatForAttackTarget,
  getEffectiveAtk,
  getPiercingDamage,
} from "./common/cardStats.js";
import { resolvePerspectivePlayers } from "./StrategyUtils.js";
import {
  fingerprintAction,
  summarizePlanningState,
} from "./common/planningDiagnostics.js";
import {
  filterAiActionsForCurrentPhase,
  hasPreBattleValueActions,
} from "./common/phaseTiming.js";
import {
  fieldHasTributeValue,
  getTributeCardsFromIndices,
  getTributeValueTotal,
  selectTributeIndicesByValue,
} from "../game/summon/tributeValue.js";
import { canUseNormalSummonForCard } from "../Player.js";

import type {
  AIAction,
  AIActionType,
  AILineMilestone,
  AILineMilestoneScore,
  AIPlannedAction,
  AIPlanningContext,
  AIPlanningProfile,
  AITributeRequirement,
  SimulatedBattleAction,
  TurnLineSearchOptions,
  TurnLineSearchResult,
} from "../contracts/ai.js";
import type {
  AiPlayerInput,
  AiStateInput,
  SimulatedCardState,
  SimulatedPlayerState,
  TurnLineSimulationGameState,
} from "../contracts/aiState.js";
import type { CardAction } from "../contracts/actions.js";
import type { GameCard } from "../contracts/cards.js";

type PlannerCard = SimulatedCardState & {
  cannotBeDestroyedByBattle?: boolean;
  storedBlueprints?: unknown[];
  blueprintStorageState?: { storedBlueprints?: unknown[] } | null;
  storedEffects?: unknown[];
};
type PlannerPlayer = SimulatedPlayerState;
type PlannerCardInput = NonNullable<AiPlayerInput["hand"]>[number];
type PlannerPlayerInput = AiPlayerInput & { name?: string };

interface LegacyAltTributeView {
  type?: string;
  requiresName?: string;
  requiresType?: string;
  tributes?: number;
}

interface PlannerTributeRequirement {
  tributesNeeded: number;
  usingAlt: boolean;
  alt: LegacyAltTributeView | null;
}

interface BattlePairActionView {
  type?: string;
  targetRef?: string;
}

interface TemporaryBattleEffectView {
  event?: string;
  timing?: string;
  sourceName?: string;
  sourceCardId?: string | number;
  sourceEffectId?: string;
  expiresOnTurn?: number;
  usesRemaining?: number;
  firstTarget?: PlannerCard | null;
  firstInstanceId?: string | number;
  firstFieldPresenceId?: string | number;
  secondTarget?: PlannerCard | null;
  secondInstanceId?: string | number;
  secondFieldPresenceId?: string | number;
  affectedTarget?: PlannerCard | null;
  affectedTargetRef?: string;
  affectedInstanceId?: string | number;
  affectedFieldPresenceId?: string | number;
  declaredValues?: unknown;
  actions?: readonly BattlePairActionView[];
}

type PlanningState = TurnLineSimulationGameState & {
  temporaryBattlePairEffects?: TemporaryBattleEffectView[];
  temporaryEventEffects?: TemporaryBattleEffectView[];
};

type PlanningGameInput = Omit<AiStateInput, "player" | "bot" | "opponent"> & {
  player?: PlannerPlayerInput | null;
  bot?: PlannerPlayerInput | null;
  opponent?: PlannerPlayerInput | null;
  _simOncePerTurn?: unknown;
  _simLuminarch?: unknown;
  _simBurningWest?: unknown;
  temporaryBattlePairEffects?: readonly TemporaryBattleEffectView[];
  temporaryEventEffects?: readonly TemporaryBattleEffectView[];
};

interface DestroyedCardSummary {
  id?: PlannerCard["id"];
  name?: string;
  owner: string;
  cardKind?: string;
  type?: string | null;
  archetype?: string | null;
  archetypes?: string[];
  level: number;
  monsterType?: string | null;
  atk: number;
  def: number;
  baseAtk: number;
  destroyedBy: string;
}

interface LpGainSummary {
  playerId: string | null;
  amount: number;
  sourceName: string | null;
  reason: "battle_damage_heal";
}

interface PlannerBattlePlan {
  attackerIndex: number;
  targetIndex: number | null;
  direct: boolean;
  attackerCard?: PlannerCard;
  destroyedCards?: DestroyedCardSummary[];
}

interface PlannerBattleSummary extends SimulatedBattleAction {
  type: "simulatedBattle";
  attackerName?: string;
  targetName?: string | null;
  direct: boolean;
  damage: number;
  destroyedNames: string[];
  destroyedCards: DestroyedCardSummary[];
  rewardNames: unknown[];
  lpGains: LpGainSummary[];
  battleSteps?: PlannerBattleSummary[];
  phaseBridge: "main1_battle_main2";
  priority?: number;
}

interface PlannerBattleChoice {
  plan: PlannerBattlePlan;
  score: number;
  state: PlanningState;
  summary: PlannerBattleSummary;
}

interface PlannerBattleHookInput {
  state: PlanningState;
  battlePlan: PlannerBattlePlan;
  summary?: PlannerBattleSummary;
  attacker?: PlannerCard | null;
  target?: PlannerCard | null;
  bot: PlannerPlayer;
  opponent: PlannerPlayer;
  options: TurnLineRuntimeOptions;
}

interface PlannerRewardResult {
  rewardName?: unknown;
  rewardNames?: unknown[];
}

interface BattleCandidateScoreInput {
  attacker: PlannerCard | null;
  target: PlannerCard | null;
  baseDelta: number;
  simState: PlanningState;
  game: PlanningState;
  bot: PlannerPlayer;
  opponent: PlannerPlayer;
  lethalNow: boolean;
  attackerSurvived: boolean;
  targetSurvived: boolean;
  isSecondAttack: boolean;
  summary: PlannerBattleSummary;
}

interface TurnLineStrategy {
  bot?: PlannerPlayerInput;
  id?: string;
  generateMainPhaseActions?(state: PlanningState): AIAction[];
  simulateMainPhaseAction?(state: PlanningState, action: AIPlannedAction): unknown;
  evaluateBoard?(state: PlanningState, perspective: PlannerPlayer): number;
  evaluateBoardV2?(state: PlanningState, perspective: PlannerPlayer): number;
  getTributeRequirementFor?(
    card: PlannerCard,
    player: PlannerPlayer,
  ): AITributeRequirement | PlannerTributeRequirement;
  selectBestTributes?(
    field: PlannerCard[],
    tributesNeeded: number,
    card: PlannerCard | null,
  ): number[];
  evaluateTributeTrade?(
    card: PlannerCard,
    field: PlannerCard[],
    tributesNeeded: number,
    context: { state: PlanningState },
  ): { ok: boolean };
  scoreLineMilestones?(context: PlannerLineContext): AILineMilestoneScore;
  scoreLineTerminal?(context: PlannerLineContext): number;
  describePlannedLine?(context: PlannerLineContext): string;
  prepareSimulatedBattle?(
    input: PlannerBattleHookInput,
  ): unknown[] | PlannerRewardResult | null;
  applySimulatedBattleRewards?(
    input: PlannerBattleHookInput,
  ): unknown[] | null;
  scoreBattleAttackCandidate?(input: BattleCandidateScoreInput): number;
}

interface BattlePlanningProfile extends AIPlanningProfile {
  battleStepLimit?: number;
}

interface BattlePlanningContext {
  profile?: { battleStepLimit?: number };
}

type TurnLineRuntimeOptions = Omit<
  TurnLineSearchOptions,
  "profile" | "planningContext"
> & {
  profile?: BattlePlanningProfile;
  planningContext?: BattlePlanningContext;
};

interface MilestoneResultInput {
  scoreDelta?: number;
  milestoneScore?: number;
  milestones?: AILineMilestone[];
}

interface TerminalEvaluation {
  score: number;
  baseScore: number;
  milestoneScore: number;
  milestones: AILineMilestone[];
  context: PlannerLineContext;
}

interface PlannerLineContext extends Omit<AIPlanningContext, "initialState"> {
  initialState?: PlanningState | null;
  finalState?: PlanningState;
  options?: TurnLineRuntimeOptions;
  profile?: BattlePlanningProfile;
  planningContext?: BattlePlanningContext;
}

interface SearchBranch {
  action?: AIPlannedAction;
  sequence: AIPlannedAction[];
  score: number;
  baseScore: number;
  milestoneScore: number;
  milestones: AILineMilestone[];
  terminalContext: PlannerLineContext;
  finalState: PlanningState;
  reason: string;
}

function actionRequiresHand(actionType: AIActionType): boolean {
  return (
    actionType === "summon" ||
    actionType === "spell" ||
    actionType === "handIgnition" ||
    actionType === "set_spell_trap" ||
    actionType === "special_summon_sanctum_protector"
  );
}

function expectedHandKind(
  actionType: AIActionType,
): "monster" | "spell" | readonly ["spell", "trap"] | null {
  if (
    actionType === "summon" ||
    actionType === "handIgnition" ||
    actionType === "special_summon_sanctum_protector"
  ) {
    return "monster";
  }
  if (actionType === "spell") return "spell";
  if (actionType === "set_spell_trap") return ["spell", "trap"] as const;
  return null;
}

function actionIsValidForHand(
  action: AIAction | null | undefined,
  hand: readonly PlannerCard[],
): boolean {
  if (!action) return false;
  if (!actionRequiresHand(action.type)) return true;
  if (!Array.isArray(hand)) return false;
  if (!Number.isInteger(action.index)) return false;
  const card = hand[action.index!];
  if (!card) return false;
  const requiredKind = expectedHandKind(action.type);
  if (requiredKind) {
    const kinds = Array.isArray(requiredKind) ? requiredKind : [requiredKind];
    if (!kinds.includes(card.cardKind)) return false;
  }
  if (action.cardName && card.name !== action.cardName) return false;
  return true;
}

function readLegacyAltTribute(value: unknown): LegacyAltTributeView | null {
  if (!value || typeof value !== "object") return null;
  const type = Reflect.get(value, "type");
  const requiresName = Reflect.get(value, "requiresName");
  const requiresType = Reflect.get(value, "requiresType");
  const tributes = Reflect.get(value, "tributes");
  return {
    type: typeof type === "string" ? type : undefined,
    requiresName:
      typeof requiresName === "string" ? requiresName : undefined,
    requiresType:
      typeof requiresType === "string" ? requiresType : undefined,
    tributes: typeof tributes === "number" ? tributes : undefined,
  };
}

function tributeMatchesAltRequirement(
  card: PlannerCard | null | undefined,
  alt: LegacyAltTributeView | null | undefined,
): boolean {
  if (!card || card.cardKind !== "monster" || !alt) return false;
  if (card.isFacedown) return false;
  if (alt.requiresName && card.name !== alt.requiresName) return false;
  if (alt.requiresType && card.type !== alt.requiresType) return false;
  return true;
}

function getPlannerTributeRequirement(
  card: PlannerCard | null | undefined,
  player: PlannerPlayer,
  strategy: TurnLineStrategy | null,
): PlannerTributeRequirement {
  if (!card) return { tributesNeeded: 0, usingAlt: false, alt: null };
  if (typeof strategy?.getTributeRequirementFor === "function") {
    const requirement = strategy.getTributeRequirementFor(card, player);
    if (!requirement) {
      return {
        tributesNeeded: 0,
        usingAlt: false,
        alt: null,
      };
    }
    return {
      tributesNeeded: requirement.tributesNeeded,
      usingAlt: requirement.usingAlt,
      alt: readLegacyAltTribute(requirement.alt),
    };
  }

  let tributesNeeded = 0;
  const level = Number(card.level || 0);
  if (level >= 5 && level <= 6) tributesNeeded = 1;
  else if (level >= 7) tributesNeeded = 2;
  if (typeof card.requiredTributes === "number" && card.requiredTributes >= 0) {
    tributesNeeded = card.requiredTributes;
  }

  const alt = readLegacyAltTribute(card.altTribute);
  if (alt?.type === "no_tribute_if_empty_field" && (player?.field || []).length === 0) {
    return { tributesNeeded: 0, usingAlt: true, alt };
  }
  if (alt?.requiresType && typeof alt?.tributes === "number") {
    const hasRequiredType = (player?.field || []).some((entry) =>
      tributeMatchesAltRequirement(entry, alt),
    );
    if (hasRequiredType && alt.tributes < tributesNeeded) {
      return { tributesNeeded: alt.tributes, usingAlt: true, alt };
    }
  }
  if (alt?.requiresName && typeof alt?.tributes === "number") {
    const hasRequiredName = (player?.field || []).some((entry) =>
      tributeMatchesAltRequirement(entry, alt),
    );
    if (hasRequiredName && alt.tributes < tributesNeeded) {
      return { tributesNeeded: alt.tributes, usingAlt: true, alt };
    }
  }

  return { tributesNeeded, usingAlt: false, alt };
}

function selectPlannerTributes(
  field: PlannerCard[] = [],
  tributesNeeded = 0,
  cardToSummon: PlannerCard | null = null,
  strategy: TurnLineStrategy | null = null,
): number[] {
  if (tributesNeeded <= 0) return [];
  if (!fieldHasTributeValue(field || [], tributesNeeded, cardToSummon)) return [];
  const selected =
    typeof strategy?.selectBestTributes === "function"
      ? strategy.selectBestTributes(field, tributesNeeded, cardToSummon)
      : selectTributeIndicesByValue(field, tributesNeeded, cardToSummon, {
          scoreCard: (card) =>
            Math.max(0, Number(card?.atk || 0)) +
            Math.max(0, Number(card?.def || 0)) * 0.25 +
            Number(card?.level || 0) * 120,
        });
  return [...new Set(selected || [])].filter(
    (index) => Number.isInteger(index) && field[index],
  );
}

function summonActionIsStillLegal(
  action: AIAction | null | undefined,
  state: PlanningState,
  strategy: TurnLineStrategy | null,
): boolean {
  if (!action || action.type !== "summon") return true;
  const player = state?.bot || {};
  const hand = player.hand || [];
  if (!actionIsValidForHand(action, hand)) return false;
  const card = hand[action.index!];
  if (!card || card.cardKind !== "monster") return false;
  if (card.cannotBeNormalSummonedOrSet) return false;
  if (card.summonRestrict === "shadow_heart_invocation_only") return false;

  if (!canUseNormalSummonForCard(player, card)) return false;

  const tributeInfo = getPlannerTributeRequirement(card, player, strategy);
  const tributesNeeded = Math.max(0, Number(tributeInfo.tributesNeeded || 0));
  const field = player.field || [];
  if (!fieldHasTributeValue(field, tributesNeeded, card)) return false;
  let physicalTributeCount = 0;
  if (tributesNeeded > 0) {
    const tributeIndices = selectPlannerTributes(field, tributesNeeded, card, strategy);
    const tributeCards = getTributeCardsFromIndices(field, tributeIndices);
    if (getTributeValueTotal(tributeCards, card) < tributesNeeded) return false;
    const tradeCheck =
      typeof strategy?.evaluateTributeTrade === "function"
        ? strategy.evaluateTributeTrade(card, field, tributesNeeded, { state })
        : { ok: true };
    if (tradeCheck?.ok === false) return false;
    physicalTributeCount = tributeIndices.length;
    if (
      tributeInfo.usingAlt === true &&
      tributeInfo.alt &&
      !tributeIndices
        .slice(0, tributesNeeded)
        .some((index) => tributeMatchesAltRequirement(field[index], tributeInfo.alt))
    ) {
      return false;
    }
  }
  if (field.length - physicalTributeCount + 1 > 5) return false;

  return true;
}

function clonePlain<Value>(value: Value): Value {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch (_err) {
      // Fall through to JSON clone for plain simulation data.
    }
  }
  return JSON.parse(
    JSON.stringify(value, (_key, nested) => {
      if (nested instanceof Map) return Object.fromEntries(nested.entries());
      if (nested instanceof Set) return [...nested];
      if (typeof nested === "function") return undefined;
      return nested;
    }),
  );
}

function clonePlayerState(
  player: PlannerPlayerInput | null | undefined,
): PlannerPlayer {
  const safe = player || {};
  const cloneCards = (
    cards: readonly PlannerCardInput[] | null | undefined,
  ): PlannerCard[] =>
    (cards || []).map((card) => clonePlain(card) as PlannerCard);
  const snapshot = {
    id: safe.id || "unknown",
    name: safe.name || safe.id || "unknown",
    lp: safe.lp || 0,
    hand: cloneCards(safe.hand),
    field: cloneCards(safe.field),
    graveyard: cloneCards(safe.graveyard),
    deck: cloneCards(safe.deck),
    extraDeck: cloneCards(safe.extraDeck),
    banished: cloneCards(safe.banished),
    fieldSpell: safe.fieldSpell
      ? clonePlain(safe.fieldSpell) as PlannerCard
      : null,
    spellTrap: cloneCards(safe.spellTrap),
    summonCount: safe.summonCount || 0,
    additionalNormalSummons: safe.additionalNormalSummons || 0,
    additionalNormalSummonPermissions:
      clonePlain([...(safe.additionalNormalSummonPermissions || [])]),
    normalSummonsThisTurn:
      clonePlain([...(safe.normalSummonsThisTurn || [])]),
    specialSummonRestrictions:
      clonePlain([...(safe.specialSummonRestrictions || [])]),
    effectActivationRestrictions:
      clonePlain([...(safe.effectActivationRestrictions || [])]),
    controllerType: safe.controllerType,
  };
  return snapshot;
}

function resolvePerspectiveBot(
  game: PlanningGameInput,
  strategy: TurnLineStrategy,
): AiPlayerInput | null {
  return strategy?.bot || (strategy?.id ? strategy : null) || game?.bot || null;
}

function clonePlanningState(
  game: PlanningGameInput,
  strategy: TurnLineStrategy,
): PlanningState {
  const perspectiveBot = resolvePerspectiveBot(game, strategy);
  const isPerspectiveState = game?._isPerspectiveState === true;
  const opponent = isPerspectiveState
    ? game.player
    : resolvePerspectivePlayers(game, perspectiveBot).opponent;
  const sourceBot = isPerspectiveState
    ? game.bot
    : perspectiveBot || game?.bot || game?.player;

  const state = {
    player: clonePlayerState(opponent || game?.player),
    bot: clonePlayerState(sourceBot),
    turn: game?.turn,
    phase: game?.phase,
    turnCounter: game?.turnCounter || 0,
    _isPerspectiveState: true,
    _gameRef: game?._gameRef || game,
  };
  if (game?._simOncePerTurn) {
    Reflect.set(state, "_simOncePerTurn", clonePlain(game._simOncePerTurn));
  }
  if (game?._simLuminarch) {
    Reflect.set(state, "_simLuminarch", clonePlain(game._simLuminarch));
  }
  if (game?._simBurningWest) {
    Reflect.set(state, "_simBurningWest", clonePlain(game._simBurningWest));
  }
  if (Array.isArray(game?.temporaryBattlePairEffects)) {
    Reflect.set(
      state,
      "temporaryBattlePairEffects",
      clonePlain(game.temporaryBattlePairEffects),
    );
  }
  if (Array.isArray(game?.temporaryEventEffects)) {
    Reflect.set(
      state,
      "temporaryEventEffects",
      clonePlain(game.temporaryEventEffects),
    );
  }
  return state as PlanningState;
}

function normalizeCounterEntries(
  counters: PlannerCard["counters"] | readonly (readonly [string, number])[] | object | null | undefined,
): Array<[string, number]> {
  if (!counters) return [];
  if (counters instanceof Map) return [...counters.entries()];
  if (Array.isArray(counters)) {
    return counters.filter(
      (entry): entry is [string, number] =>
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "number",
    );
  }
  if (typeof counters === "object") {
    return Object.entries(counters).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    );
  }
  return [];
}

function summarizeBlueprints(card: PlannerCard | null | undefined): string {
  const stored =
    card?.storedBlueprints ||
    card?.blueprintStorageState?.storedBlueprints ||
    card?.storedEffects ||
    [];
  return (Array.isArray(stored) ? stored : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object") return undefined;
      return (
        Reflect.get(entry, "id") ||
        Reflect.get(entry, "effectId") ||
        Reflect.get(entry, "sourceName") ||
        Reflect.get(entry, "name")
      );
    })
    .filter(Boolean)
    .sort()
    .join(",");
}

function summarizeCounters(card: PlannerCard | null | undefined): string {
  return normalizeCounterEntries(card?.counters)
    .map(([key, value]) => `${key}:${value}`)
    .sort()
    .join(",");
}

function getCardKey(card: PlannerCard | null | undefined): string {
  if (!card) return "empty";
  const equipNames = (card.equips || [])
    .map((equip) => equip?.name || equip?.id || "?")
    .sort()
    .join("+");
  const equippedTo = card.equippedTo?.name || card.equippedTo?.id || "";
  return [
    card.instanceId || card._instanceId || card.uid || card.uuid || "",
    card.id || 0,
    card.name || "",
    card.cardKind || "",
    card.position || "",
    card.isFacedown ? "fd" : "fu",
    card.atk || 0,
    card.def || 0,
    card.tempAtkBoost || 0,
    card.tempDefBoost || 0,
    card.equipAtkBonus || 0,
    card.equipDefBonus || 0,
    card.hasAttacked ? "attacked" : "",
    card.cannotAttackThisTurn ? "cantAtk" : "",
    summarizeCounters(card),
    summarizeBlueprints(card),
    equipNames,
    equippedTo,
  ].join(":");
}

function summarizeZone(
  cards: readonly (PlannerCard | null | undefined)[] = [],
  { sort = false }: { sort?: boolean } = {},
): string {
  const values = (cards || []).filter(Boolean).map(getCardKey);
  if (sort) values.sort();
  return values.join("|");
}

function summarizeSimOpt(value: unknown): string {
  if (!value) return "";
  const normalize = (entry: unknown): string => {
    if (entry instanceof Map) {
      return [...entry.entries()]
        .map(([key, nested]) => `${key}:${normalize(nested)}`)
        .sort()
        .join(",");
    }
    if (entry instanceof Set) return [...entry].sort().join(",");
    if (Array.isArray(entry)) return entry.slice().sort().join(",");
    if (entry && typeof entry === "object") {
      return Object.entries(entry)
        .map(([key, nested]) => `${key}=${normalize(nested)}`)
        .sort()
        .join(";");
    }
    return String(entry);
  };
  return normalize(value);
}

function summarizeTemporaryEffects(
  effects: readonly TemporaryBattleEffectView[] = [],
): string {
  if (!Array.isArray(effects)) return "";
  return effects
    .map((entry) =>
      [
        entry?.event || "",
        entry?.timing || "",
        entry?.sourceName || entry?.sourceCardId || "",
        entry?.sourceEffectId || "",
        entry?.expiresOnTurn ?? "",
        entry?.usesRemaining ?? "",
        entry?.firstInstanceId || entry?.firstFieldPresenceId || "",
        entry?.secondInstanceId || entry?.secondFieldPresenceId || "",
        entry?.affectedInstanceId || entry?.affectedFieldPresenceId || "",
        summarizeSimOpt(entry?.declaredValues),
        summarizeSimOpt(
          (entry?.actions || []).map(
            (action: BattlePairActionView) => action?.type || "",
          ),
        ),
      ].join(":"),
    )
    .sort()
    .join("|");
}

function getPlanningStateHash(state: PlanningState): string {
  const bot = state?.bot || {};
  const opponent = state?.player || {};
  const playerSummary = (player: PlannerPlayer): string =>
    [
      player.id || "",
      player.lp || 0,
      player.summonCount || 0,
      player.additionalNormalSummons || 0,
      summarizeSimOpt(player.additionalNormalSummonPermissions || []),
      summarizeSimOpt(player.normalSummonsThisTurn || []),
      summarizeZone(player.hand, { sort: true }),
      summarizeZone(player.field),
      summarizeZone(player.spellTrap),
      getCardKey(player.fieldSpell),
      summarizeZone(player.graveyard, { sort: true }),
      summarizeZone(player.banished, { sort: true }),
    ].join("~");

  return [
    state?.phase || "",
    state?.turn || "",
    state?.turnCounter || 0,
    playerSummary(bot),
    playerSummary(opponent),
    summarizeSimOpt(state?._simOncePerTurn),
    summarizeSimOpt(state?._simBurningWest),
    summarizeTemporaryEffects(state?.temporaryBattlePairEffects),
    summarizeTemporaryEffects(state?.temporaryEventEffects),
  ].join("||");
}

function filterStillLegalRootActions(
  actions: readonly AIAction[] | null | undefined,
  state: PlanningState,
  strategy: TurnLineStrategy | null = null,
): AIAction[] {
  if (!Array.isArray(actions)) return [];
  const hand = state?.bot?.hand || [];
  return actions.filter((action) => {
    if (!actionIsValidForHand(action, hand)) return false;
    return summonActionIsStillLegal(action, state, strategy);
  });
}

function simulatePlanningAction(
  state: PlanningState,
  action: AIPlannedAction,
  strategy: TurnLineStrategy,
): PlanningState {
  if (typeof strategy?.simulateMainPhaseAction === "function") {
    strategy.simulateMainPhaseAction(state, action);
  }
  return state;
}

function evaluateBasePlanningScore(
  state: PlanningState,
  strategy: TurnLineStrategy,
  options: TurnLineRuntimeOptions = {},
): number {
  if (typeof options.evaluateState === "function") {
    return options.evaluateState(state, state.bot);
  }
  if (
    options.useV2Evaluation !== false &&
    typeof strategy?.evaluateBoardV2 === "function"
  ) {
    return strategy.evaluateBoardV2(state, state.bot);
  }
  if (typeof strategy?.evaluateBoard === "function") {
    return strategy.evaluateBoard(state, state.bot);
  }
  return 0;
}

function normalizeMilestoneResult(
  result: MilestoneResultInput | null | undefined,
): AILineMilestoneScore {
  const scoreDelta = Number(result?.scoreDelta ?? result?.milestoneScore ?? 0);
  return {
    scoreDelta: Number.isFinite(scoreDelta) ? scoreDelta : 0,
    milestones: Array.isArray(result?.milestones) ? result.milestones : [],
  };
}

function evaluatePlanningTerminal(
  finalState: PlanningState,
  strategy: TurnLineStrategy,
  options: TurnLineRuntimeOptions = {},
  sequence: AIPlannedAction[] = [],
  initialState: PlanningState | null = null,
): TerminalEvaluation {
  const rawBaseScore = evaluateBasePlanningScore(finalState, strategy, options);
  const baseScore = Number.isFinite(Number(rawBaseScore))
    ? Number(rawBaseScore)
    : 0;
  const milestoneInput = {
    initialState,
    finalState,
    sequence,
    baseScore,
    finalScore: baseScore,
    options,
    profile: options.profile,
    planningContext: options.planningContext,
  };
  const milestoneResult =
    typeof strategy?.scoreLineMilestones === "function"
      ? strategy.scoreLineMilestones(milestoneInput)
      : null;
  const { scoreDelta: milestoneScore, milestones } =
    normalizeMilestoneResult(milestoneResult);
  const terminalContext = {
    ...milestoneInput,
    milestoneScore,
    milestones,
  };
  const terminalScore =
    typeof strategy?.scoreLineTerminal === "function"
      ? strategy.scoreLineTerminal(terminalContext)
      : baseScore + milestoneScore;
  const score = Number.isFinite(Number(terminalScore))
    ? Number(terminalScore)
    : baseScore + milestoneScore;

  return {
    score,
    baseScore,
    milestoneScore,
    milestones,
    context: {
      ...terminalContext,
      finalScore: score,
    },
  };
}

function describeAction(action: AIPlannedAction | null | undefined): string {
  if (!action) return "no action";
  if (action.type === "simulatedBattle") {
    const target = action.direct ? "direct" : action.targetName || "target";
    return `${action.type}:${action.attackerName || "attacker"}>${target}`;
  }
  const card = action.card?.name || action.cardName || action.name || action.index;
  return card !== undefined ? `${action.type}:${card}` : String(action.type);
}

function isMainBattleMain2Mode(options: TurnLineRuntimeOptions = {}): boolean {
  return options.turnMode === "mainBattleMain2";
}

function isMain1Phase(phase: string | null | undefined): boolean {
  return !phase || phase === "main1" || phase === "main";
}

function isBattleReadyPlannerAttacker(
  card: PlannerCard | null | undefined,
): card is PlannerCard {
  if (!card || card.cardKind !== "monster") return false;
  if (card.isFacedown) return false;
  if (card.position === "defense") return false;
  if (card.cannotAttackThisTurn || card.hasAttacked) return false;
  return getEffectiveAtk(card) > 0;
}

function getPlannerMaxAttacks(
  card: PlannerCard | null | undefined,
  state: PlanningState,
): number {
  if (
    card?.attackLimitThisTurn !== undefined &&
    card?.attackLimitThisTurn !== null &&
    Number.isFinite(Number(card.attackLimitThisTurn))
  ) {
    return Math.max(0, Math.floor(Number(card.attackLimitThisTurn)));
  }
  let extra = Number(card?.extraAttacks || 0);
  if (card?.dynamicExtraAttacks?.source === "graveyard_count") {
    const config = card.dynamicExtraAttacks;
    extra = (state?.bot?.graveyard || []).filter(
      (entry) => entry?.name === config.name,
    ).length;
    extra -= 1;
  }
  if (card?.canAttackAllOpponentMonstersThisTurn) {
    return Math.max(1, Number(card.multiAttackLimit || 1));
  }
  const secondAttack =
    card?.canMakeSecondAttackThisTurn && !card?.secondAttackUsedThisTurn ? 1 : 0;
  return Math.max(1, 1 + Math.max(0, extra) + secondAttack);
}

function canPlannerAttackerStillAttack(
  card: PlannerCard | null | undefined,
  state: PlanningState,
): boolean {
  if (!isBattleReadyPlannerAttacker(card)) return false;
  const used = Number(card.attacksUsedThisTurn || 0);
  return used < getPlannerMaxAttacks(card, state);
}

function removeFromZone(
  zone: PlannerCard[],
  card: PlannerCard | null | undefined,
): boolean {
  if (!Array.isArray(zone) || !card) return false;
  const index = zone.indexOf(card);
  if (index < 0) return false;
  zone.splice(index, 1);
  return true;
}

function pushToGraveyard(
  player: PlannerPlayer | null | undefined,
  card: PlannerCard | null | undefined,
): void {
  if (!player || !card) return;
  if (!Array.isArray(player.graveyard)) player.graveyard = [];
  player.graveyard.push(card);
}

function sameCardIdentity(
  a: PlannerCard | null | undefined,
  b: PlannerCard | null | undefined,
): boolean {
  if (!a || !b) return false;
  const aInstance = a.instanceId || a._instanceId || a.uid || a.uuid;
  const bInstance = b.instanceId || b._instanceId || b.uid || b.uuid;
  if (aInstance && bInstance) return aInstance === bInstance;
  return a === b;
}

function getPlannerCardInstanceId(
  card: PlannerCard | null | undefined,
): string | number | null {
  return (
    card?.instanceId ||
    card?._instanceId ||
    card?.uid ||
    card?.uuid ||
    card?.fieldPresenceId ||
    null
  );
}

function sameBattlePairCard(
  card: PlannerCard | null | undefined,
  storedCard: PlannerCard | null | undefined,
  storedInstanceId: string | number | null | undefined,
): boolean {
  if (!card) return false;
  if (sameCardIdentity(card, storedCard)) return true;
  const cardInstanceId = getPlannerCardInstanceId(card);
  return Boolean(
    cardInstanceId &&
      storedInstanceId &&
      String(cardInstanceId) === String(storedInstanceId),
  );
}

function detachEquipsForDestroyedMonster(
  player: PlannerPlayer | null | undefined,
  monster: PlannerCard | null | undefined,
): PlannerCard[] {
  if (!player || !monster) return [];
  const detached: PlannerCard[] = [];
  const hostEquips = Array.isArray(monster.equips) ? monster.equips : [];
  hostEquips.forEach((equip) => {
    if (equip) detached.push(equip);
  });
  monster.equips = [];

  if (Array.isArray(player.spellTrap)) {
    for (let index = player.spellTrap.length - 1; index >= 0; index -= 1) {
      const card = player.spellTrap[index];
      if (!card) continue;
      if (sameCardIdentity(card.equippedTo, monster)) {
        detached.push(card);
        player.spellTrap.splice(index, 1);
      }
    }
  }

  detached.forEach((equip) => {
    equip.equippedTo = null;
    pushToGraveyard(player, equip);
  });
  return detached;
}

function destroyPlannerMonster(
  player: PlannerPlayer | null | undefined,
  monster: PlannerCard | null | undefined,
): boolean {
  if (!player || !monster) return false;
  if (!removeFromZone(player.field, monster)) return false;
  detachEquipsForDestroyedMonster(player, monster);
  pushToGraveyard(player, monster);
  return true;
}

function recordDestroyedCard(
  summary: PlannerBattleSummary,
  card: PlannerCard | null | undefined,
  owner: string,
  destroyedBy = "battle",
): void {
  if (!summary || !card) return;
  summary.destroyedNames.push(card.name || "card");
  summary.destroyedCards.push({
    id: card.id,
    name: card.name,
    owner,
    cardKind: card.cardKind,
    type: card.type,
    archetype: card.archetype,
    archetypes: Array.isArray(card.archetypes) ? [...card.archetypes] : undefined,
    level: card.level || 0,
    monsterType: card.monsterType || null,
    atk: card.atk || 0,
    def: card.def || 0,
    baseAtk: card.baseAtk ?? card.originalAtk ?? card.atk ?? 0,
    destroyedBy,
  });
}

function getSimTurnCounter(turnCounter: unknown): number {
  return Number.isFinite(Number(turnCounter)) ? Number(turnCounter) : 0;
}

function hasBattleDestructionProtection(
  card: PlannerCard | null | undefined,
  turnCounter: unknown,
): boolean {
  const currentTurn = getSimTurnCounter(turnCounter);
  return Boolean(
    card?.battleIndestructible ||
      card?.tempBattleIndestructible ||
      card?.cannotBeDestroyedByBattle ||
      card?.simBattleDestructionProtected ||
      (card?.battleIndestructibleOncePerTurn &&
        card?.battleIndestructibleOncePerTurnLastUsedTurn !== currentTurn),
  );
}

function preventBattleDestruction(
  card: PlannerCard | null | undefined,
  turnCounter: unknown,
): boolean {
  if (!hasBattleDestructionProtection(card, turnCounter)) return false;
  const currentTurn = getSimTurnCounter(turnCounter);
  const nonOnceProtection = Boolean(
    card?.battleIndestructible ||
      card?.tempBattleIndestructible ||
      card?.cannotBeDestroyedByBattle ||
      card?.simBattleDestructionProtected,
  );
  if (card?.simBattleDestructionProtected) {
    card.simBattleDestructionProtected = false;
  }
  if (
    !nonOnceProtection &&
    card?.battleIndestructibleOncePerTurn &&
    card?.battleIndestructibleOncePerTurnLastUsedTurn !== currentTurn
  ) {
    card.battleIndestructibleOncePerTurnLastUsedTurn = currentTurn;
    card.battleIndestructibleOncePerTurnUsed = true;
  }
  return true;
}

function preventsBattleDamageToController(
  card: PlannerCard | null | undefined,
): boolean {
  return card?.preventsBattleDamageToController === true;
}

function isArcanistMonster(card: PlannerCard | null | undefined): boolean {
  if (!card || card.cardKind !== "monster") return false;
  if (card.archetype === "Arcanist") return true;
  return Array.isArray(card.archetypes) && card.archetypes.includes("Arcanist");
}

function applyGrandLibraryBattleReward(
  state: PlanningState,
  battlePlan: PlannerBattlePlan,
): string[] {
  const bot = state?.bot;
  if (!bot || bot.fieldSpell?.name !== "Arcanist Grand Library") return [];
  if (state._simGrandLibraryBattleRewardUsed) return [];
  const destroyedOpponentMonster = (battlePlan.destroyedCards || []).some(
    (entry) =>
      entry?.owner === "opponent" &&
      entry?.cardKind === "monster" &&
      entry.destroyedBy !== "effect",
  );
  if (!destroyedOpponentMonster) return [];
  const attacker = battlePlan.attackerCard || bot.field?.[battlePlan.attackerIndex];
  if (!isArcanistMonster(attacker)) return [];
  const drawn = bot.deck?.shift?.();
  if (!drawn) return [];
  if (!Array.isArray(bot.hand)) bot.hand = [];
  bot.hand.push(drawn);
  state._simGrandLibraryBattleRewardUsed = true;
  return [drawn.name || "drawn card"];
}

function applyStrategyBattleRewards(
  state: PlanningState,
  battlePlan: PlannerBattlePlan,
  summary: PlannerBattleSummary,
  strategy: TurnLineStrategy | null,
  options: TurnLineRuntimeOptions = {},
): unknown[] {
  if (typeof strategy?.applySimulatedBattleRewards !== "function") return [];
  const rewards = strategy.applySimulatedBattleRewards({
    state,
    battlePlan,
    summary,
    bot: state?.bot,
    opponent: state?.player,
    options,
  });
  return Array.isArray(rewards) ? rewards.filter(Boolean) : [];
}

function prepareStrategyBattle(
  state: PlanningState,
  battlePlan: PlannerBattlePlan,
  strategy: TurnLineStrategy | null,
  options: TurnLineRuntimeOptions = {},
): unknown[] {
  if (typeof strategy?.prepareSimulatedBattle !== "function") return [];
  const bot = state?.bot;
  const opponent = state?.player;
  const attacker = bot?.field?.[battlePlan?.attackerIndex];
  const targetIndex = battlePlan.targetIndex;
  const target = Number.isInteger(targetIndex) && targetIndex !== null
    ? opponent?.field?.[targetIndex]
    : null;
  const result = strategy.prepareSimulatedBattle({
    state,
    battlePlan,
    attacker,
    target,
    bot,
    opponent,
    options,
  });
  if (Array.isArray(result)) return result.filter(Boolean);
  if (Array.isArray(result?.rewardNames)) return result.rewardNames.filter(Boolean);
  if (result?.rewardName) return [result.rewardName];
  return [];
}

function battlePairMatches(
  entry: TemporaryBattleEffectView | null | undefined,
  attacker: PlannerCard | null | undefined,
  defender: PlannerCard | null | undefined,
): boolean {
  if (!entry || !attacker || !defender) return false;
  const firstIsAttacker = sameBattlePairCard(
    attacker,
    entry.firstTarget,
    entry.firstInstanceId || entry.firstFieldPresenceId,
  );
  const secondIsDefender = sameBattlePairCard(
    defender,
    entry.secondTarget,
    entry.secondInstanceId || entry.secondFieldPresenceId,
  );
  const firstIsDefender = sameBattlePairCard(
    defender,
    entry.firstTarget,
    entry.firstInstanceId || entry.firstFieldPresenceId,
  );
  const secondIsAttacker = sameBattlePairCard(
    attacker,
    entry.secondTarget,
    entry.secondInstanceId || entry.secondFieldPresenceId,
  );
  return (firstIsAttacker && secondIsDefender) || (firstIsDefender && secondIsAttacker);
}

function findSimulatedFieldCard(
  player: PlannerPlayer,
  storedCard: PlannerCard | null | undefined,
  storedInstanceId: string | number | null | undefined,
): PlannerCard | null {
  return (player?.field || []).find((card) =>
    sameBattlePairCard(card, storedCard, storedInstanceId),
  ) || null;
}

function actionDestroysBattlePairAffected(
  action: BattlePairActionView | null | undefined,
  entry: TemporaryBattleEffectView,
): boolean {
  if (!action || action.type !== "destroy") return false;
  if (!action.targetRef) return true;
  return (
    action.targetRef === entry.affectedTargetRef ||
    action.targetRef === "battle_pair_affected"
  );
}

function resolveSimulatedBattlePairEffects(
  state: PlanningState,
  attacker: PlannerCard,
  target: PlannerCard | null,
  summary: PlannerBattleSummary,
): { stopped: boolean } {
  const entries = Array.isArray(state?.temporaryBattlePairEffects)
    ? state.temporaryBattlePairEffects
    : [];
  if (!target || entries.length === 0) return { stopped: false };
  const opponent = state?.player || {};
  const remaining: TemporaryBattleEffectView[] = [];
  let stopped = false;

  for (const entry of entries) {
    if (!entry) continue;
    if (
      Number.isFinite(entry.expiresOnTurn) &&
      Number(state.turnCounter || 0) > Number(entry.expiresOnTurn)
    ) {
      continue;
    }
    if ((entry.timing || "before_damage_calculation") !== "start_of_damage_step") {
      remaining.push(entry);
      continue;
    }
    if (!battlePairMatches(entry, attacker, target)) {
      remaining.push(entry);
      continue;
    }

    const affected = findSimulatedFieldCard(
      opponent,
      entry.affectedTarget,
      entry.affectedInstanceId || entry.affectedFieldPresenceId,
    );
    if (!affected) continue;
    const actions = Array.isArray(entry.actions) && entry.actions.length > 0
      ? entry.actions
      : [{ type: "destroy", targetRef: entry.affectedTargetRef }];
    if (!actions.some((action) => actionDestroysBattlePairAffected(action, entry))) {
      continue;
    }

    recordDestroyedCard(summary, affected, "opponent", "effect");
    destroyPlannerMonster(opponent, affected);
    summary.rewardNames.push(
      `${entry.sourceName || "battle pair effect"} destroyed ${affected.name || "target"}`,
    );
    if (sameCardIdentity(affected, target)) stopped = true;
  }

  state.temporaryBattlePairEffects = remaining;
  return { stopped };
}

function markSimulatedAttackUsed(
  bot: PlannerPlayer,
  attacker: PlannerCard,
  state: PlanningState,
  usedAttacks: number,
): void {
  if (!bot?.field?.includes(attacker)) return;
  attacker.attacksUsedThisTurn = usedAttacks + 1;
  attacker.hasAttacked =
    attacker.attacksUsedThisTurn >= getPlannerMaxAttacks(attacker, state);
}

function applySimulatedBattle(
  state: PlanningState,
  battlePlan: PlannerBattlePlan,
  strategy: TurnLineStrategy | null = null,
  options: TurnLineRuntimeOptions = {},
): PlannerBattleSummary | null {
  const bot = state?.bot;
  const opponent = state?.player;
  if (!bot || !opponent || !battlePlan) return null;
  const attacker = bot.field?.[battlePlan.attackerIndex];
  const targetIndex = battlePlan.targetIndex;
  const target = Number.isInteger(targetIndex) && targetIndex !== null
    ? opponent.field?.[targetIndex]
    : null;
  if (!canPlannerAttackerStillAttack(attacker, state)) return null;
  const usedAttacks = Number(attacker.attacksUsedThisTurn || 0);
  const summary: PlannerBattleSummary = {
    type: "simulatedBattle",
    attackerName: attacker.name,
    targetName: target?.name || null,
    direct: !target,
    damage: 0,
    destroyedNames: [],
    destroyedCards: [],
    rewardNames: [],
    lpGains: [],
    phaseBridge: "main1_battle_main2",
  };

  const battlePairResult = resolveSimulatedBattlePairEffects(
    state,
    attacker,
    target,
    summary,
  );
  if (battlePairResult.stopped) {
    markSimulatedAttackUsed(bot, attacker, state, usedAttacks);
    return summary;
  }

  const prepareRewards = prepareStrategyBattle(state, battlePlan, strategy, options);
  summary.rewardNames.push(...prepareRewards);
  const attackStat = getEffectiveAtk(attacker);
  const inflictDamage = (
    recipient: PlannerPlayer,
    amount: number,
    involvedCard: PlannerCard | null = null,
  ): number => {
    const raw = Math.max(0, Number(amount || 0));
    if (
      raw > 0 &&
      involvedCard?.battleDamageHealsControllerThisTurn === true &&
      (!involvedCard.owner || involvedCard.owner === recipient?.id)
    ) {
      const before = Number(recipient.lp || 0);
      recipient.lp = before + raw;
      summary.lpGains.push({
        playerId: recipient.id || null,
        amount: raw,
        sourceName: involvedCard.name || null,
        reason: "battle_damage_heal",
      });
      summary.rewardNames.push("battle damage converted to LP");
      return 0;
    }
    const damage = preventsBattleDamageToController(involvedCard) ? 0 : raw;
    recipient.lp = Math.max(0, Number(recipient.lp || 0) - damage);
    return damage;
  };
  const destroyIfAllowed = (
    owner: PlannerPlayer,
    card: PlannerCard | null,
    ownerLabel: string,
  ): boolean => {
    if (!card) return false;
    if (preventBattleDestruction(card, state?.turnCounter)) return false;
    recordDestroyedCard(summary, card, ownerLabel, "battle");
    return destroyPlannerMonster(owner, card);
  };

  if (!target) {
    summary.damage = inflictDamage(opponent, attackStat, null);
  } else {
    const targetStat = getBattleStatForAttackTarget(target);
    if (target.position === "attack") {
      if (attackStat > targetStat) {
        summary.damage = inflictDamage(opponent, attackStat - targetStat, target);
        destroyIfAllowed(opponent, target, "opponent");
      } else if (attackStat < targetStat) {
        const damageTaken = inflictDamage(bot, targetStat - attackStat, attacker);
        summary.damage = -damageTaken;
        destroyIfAllowed(bot, attacker, "self");
      } else {
        destroyIfAllowed(opponent, target, "opponent");
        destroyIfAllowed(bot, attacker, "self");
      }
    } else if (attackStat > targetStat) {
      destroyIfAllowed(opponent, target, "opponent");
      const piercingDamage = getPiercingDamage(
        attacker,
        attackStat,
        targetStat,
      );
      if (piercingDamage > 0) {
        summary.damage = inflictDamage(opponent, piercingDamage, target);
      }
    } else if (attackStat < targetStat) {
      const damageTaken = inflictDamage(bot, targetStat - attackStat, attacker);
      summary.damage = -damageTaken;
    }
  }

  markSimulatedAttackUsed(bot, attacker, state, usedAttacks);
  summary.rewardNames.push(
    ...applyGrandLibraryBattleReward(state, {
      ...battlePlan,
      attackerCard: attacker,
      destroyedCards: summary.destroyedCards,
    }),
  );
  summary.rewardNames.push(
    ...applyStrategyBattleRewards(
      state,
      {
        ...battlePlan,
        attackerCard: attacker,
        destroyedCards: summary.destroyedCards,
      },
      summary,
      strategy,
      options,
    ),
  );
  return summary;
}

function buildPlannerBattlePlans(state: PlanningState): PlannerBattlePlan[] {
  const bot = state?.bot;
  const opponent = state?.player;
  if (!bot || !opponent) return [];
  const opponentMonsters = (opponent.field || []).filter(
    (card) => card?.cardKind === "monster",
  );
  const plans: PlannerBattlePlan[] = [];
  (bot.field || []).forEach((attacker, attackerIndex) => {
    if (!canPlannerAttackerStillAttack(attacker, state)) return;
    const usedAttacks = Number(attacker.attacksUsedThisTurn || 0);
    const monsterOnlyExtraAttack =
      usedAttacks > 0 &&
      (attacker.extraAttackTargetRestriction ||
        attacker.passiveExtraAttackTargetRestriction) === "monster";
    if (
      !attacker.cannotAttackDirectly &&
      !monsterOnlyExtraAttack &&
      (opponentMonsters.length === 0 || attacker.canAttackDirectlyThisTurn)
    ) {
      plans.push({
        attackerIndex,
        targetIndex: null,
        direct: true,
      });
    }
    opponent.field.forEach((target, targetIndex) => {
      if (!target || target.cardKind !== "monster") return;
      plans.push({
        attackerIndex,
        targetIndex,
        direct: false,
      });
    });
  });
  return plans;
}

function chooseBestSingleSimulatedBattle(
  state: PlanningState,
  strategy: TurnLineStrategy,
  options: TurnLineRuntimeOptions = {},
): PlannerBattleChoice | null {
  const plans = buildPlannerBattlePlans(state);
  if (plans.length === 0) return null;
  const baseScore = evaluateBasePlanningScore(state, strategy, options);
  let best: PlannerBattleChoice | null = null;

  plans.forEach((plan) => {
    const originalAttacker = state.bot?.field?.[plan.attackerIndex] || null;
    const targetIndex = plan.targetIndex;
    const originalTarget = Number.isInteger(targetIndex) && targetIndex !== null
      ? state.player?.field?.[targetIndex] || null
      : null;
    const wasSecondAttack =
      Number(originalAttacker?.attacksUsedThisTurn || 0) > 0;
    const candidateState = clonePlanningState(state, strategy);
    const summary = applySimulatedBattle(candidateState, plan, strategy, options);
    if (!summary) return;
    const destroyedOpponent = summary.destroyedNames.filter(
      (_name, index) => summary.destroyedCards[index]?.owner === "opponent",
    ).length;
    const destroyedSelf = summary.destroyedNames.filter(
      (_name, index) => summary.destroyedCards[index]?.owner === "self",
    ).length;
    const scoreAfter = evaluateBasePlanningScore(candidateState, strategy, options);
    let score = scoreAfter - baseScore;
    if ((candidateState.player?.lp || 0) <= 0) score += 100;
    score += Math.max(0, summary.damage || 0) / 450;
    score += destroyedOpponent * 3;
    score -= destroyedSelf * 4;
    score += (summary.rewardNames || []).length * 2.5;
    if (typeof strategy?.scoreBattleAttackCandidate === "function") {
      const attackerAfter = (candidateState.bot?.field || []).find(
        (card) => card?.name === summary.attackerName,
      );
      const targetAfter = originalTarget
        ? (candidateState.player?.field || []).find(
            (card) => card?.name === originalTarget.name,
          )
        : null;
      const hookDelta = strategy.scoreBattleAttackCandidate({
        attacker: attackerAfter || originalAttacker,
        target: originalTarget,
        baseDelta: scoreAfter - baseScore,
        simState: candidateState,
        game: candidateState,
        bot: candidateState.bot,
        opponent: candidateState.player,
        lethalNow: (candidateState.player?.lp || 0) <= 0,
        attackerSurvived: Boolean(attackerAfter),
        targetSurvived: Boolean(targetAfter),
        isSecondAttack: wasSecondAttack,
        summary,
      });
      if (Number.isFinite(hookDelta)) score += hookDelta;
    }
    if (score <= 0 && destroyedOpponent === 0 && summary.damage <= 0) return;
    if (!best || score > best.score) {
      best = {
        plan,
        score,
        state: candidateState,
        summary,
      };
    }
  });

  return best;
}

function normalizeBattleStepLimit(options: TurnLineRuntimeOptions = {}): number {
  const raw =
    options.battleStepLimit ??
    options.profile?.battleStepLimit ??
    options.planningContext?.profile?.battleStepLimit ??
    1;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

function aggregateBattleSummaries(
  steps: readonly PlannerBattleSummary[] = [],
  totalScore = 0,
): PlannerBattleSummary {
  const validSteps = (steps || []).filter(Boolean);
  const first = validSteps[0] || {};
  const destroyedCards = validSteps.flatMap((step) => step.destroyedCards || []);
  const destroyedNames = validSteps.flatMap((step) => step.destroyedNames || []);
  const rewardNames = validSteps.flatMap((step) => step.rewardNames || []);
  const lpGains = validSteps.flatMap((step) => step.lpGains || []);
  const damage = validSteps.reduce((sum, step) => sum + Number(step.damage || 0), 0);
  return {
    type: "simulatedBattle",
    attackerName: first.attackerName || "attacker",
    targetName: first.targetName || null,
    direct: first.direct === true,
    damage,
    destroyedNames,
    destroyedCards,
    rewardNames,
    lpGains,
    battleSteps: validSteps,
    phaseBridge: "main1_battle_main2",
    priority: totalScore,
  };
}

function chooseBestSimulatedBattle(
  state: PlanningState,
  strategy: TurnLineStrategy,
  options: TurnLineRuntimeOptions = {},
): PlannerBattleChoice | null {
  const limit = normalizeBattleStepLimit(options);
  let currentState = state;
  let totalScore = 0;
  let firstPlan: PlannerBattlePlan | null = null;
  const steps: PlannerBattleSummary[] = [];

  for (let stepIndex = 0; stepIndex < limit; stepIndex += 1) {
    const next = chooseBestSingleSimulatedBattle(currentState, strategy, options);
    if (!next) break;
    if (!firstPlan) firstPlan = next.plan;
    steps.push(next.summary);
    totalScore += Number(next.score || 0);
    currentState = next.state;
    if ((currentState.player?.lp || 0) <= 0) break;
  }

  if (steps.length === 0) return null;
  return {
    plan: firstPlan!,
    score: totalScore,
    state: currentState,
    summary: aggregateBattleSummaries(steps, totalScore),
  };
}

function tryMainBattleMain2Bridge(
  state: PlanningState,
  sequence: AIPlannedAction[],
  strategy: TurnLineStrategy,
  options: TurnLineRuntimeOptions = {},
): { state: PlanningState; action: PlannerBattleSummary; score: number } | null {
  if (!isMainBattleMain2Mode(options)) return null;
  if (state?._simPlanningBattleDone) return null;
  if (!isMain1Phase(state?.phase)) return null;
  if (!Array.isArray(sequence)) return null;

  const battle = chooseBestSimulatedBattle(state, strategy, options);
  if (!battle) return null;
  battle.state.phase = "main2";
  battle.state._simPlanningBattleDone = true;
  const pseudoStep = {
    ...battle.summary,
    priority: battle.score,
  };
  return {
    state: battle.state,
    action: pseudoStep,
    score: battle.score,
  };
}

function getCandidatesForDepth(
  state: PlanningState,
  strategy: TurnLineStrategy,
  depth: number,
  options: TurnLineRuntimeOptions,
): AIAction[] {
  const filterForPhase = (actions: AIAction[]): AIAction[] =>
    filterAiActionsForCurrentPhase(actions, {
      state,
      game: state,
      bot: state?.bot,
      player: state?.bot,
      strategy,
      analysis: { phase: state?.phase, turnCounter: state?.turnCounter },
    });

  if (depth === 0 && Array.isArray(options.preGeneratedActions)) {
    const legal = filterStillLegalRootActions(
      options.preGeneratedActions,
      state,
      strategy,
    );
    const phaseLegal = filterForPhase(legal);
    if (phaseLegal.length > 0) return phaseLegal;
  }
  if (typeof strategy?.generateMainPhaseActions !== "function") return [];
  const generated = strategy.generateMainPhaseActions(state) || [];
  const legal = depth === 0
    ? filterStillLegalRootActions(generated, state, strategy)
    : generated;
  return filterForPhase(legal);
}

export async function turnLineSearch(
  game: PlanningGameInput,
  strategy: TurnLineStrategy,
  options: TurnLineRuntimeOptions = {},
): Promise<TurnLineSearchResult | null> {
  const {
    beamWidth = 3,
    maxDepth = 3,
    nodeBudget = 200,
    candidateLimit = 8,
    turnMode = "mainOnly",
  } = options;

  if (turnMode !== "mainOnly" && turnMode !== "mainBattleMain2") return null;
  if (!game || !strategy || typeof strategy.simulateMainPhaseAction !== "function") {
    return null;
  }

  let nodesEvaluated = 0;
  const seenStates = new Set<string>();
  const root = clonePlanningState(game, strategy);
  seenStates.add(getPlanningStateHash(root));

  const search = async (
    currentState: PlanningState,
    depth: number,
    sequence: AIPlannedAction[] = [],
  ): Promise<SearchBranch> => {
    const terminalEval = () =>
      evaluatePlanningTerminal(currentState, strategy, options, sequence, root);

    if (depth >= maxDepth || nodesEvaluated >= nodeBudget) {
      const terminal = terminalEval();
      return {
        sequence,
        score: terminal.score,
        baseScore: terminal.baseScore,
        milestoneScore: terminal.milestoneScore,
        milestones: terminal.milestones,
        terminalContext: terminal.context,
        finalState: currentState,
        reason: depth >= maxDepth ? "max_depth" : "node_budget",
      };
    }

    let candidates = getCandidatesForDepth(currentState, strategy, depth, options);
    if (!Array.isArray(candidates) || candidates.length === 0) {
      if (nodesEvaluated < nodeBudget) {
        const bridge = tryMainBattleMain2Bridge(
          currentState,
          sequence,
          strategy,
          options,
        );
        if (bridge) {
          nodesEvaluated += 1;
          const bridgeHash = getPlanningStateHash(bridge.state);
          if (!seenStates.has(bridgeHash)) {
            seenStates.add(bridgeHash);
            const future = await search(bridge.state, depth + 1, [
              ...sequence,
              bridge.action,
            ]);
            return {
              action: bridge.action,
              sequence: future.sequence,
              score: future.score,
              baseScore: future.baseScore,
              milestoneScore: future.milestoneScore,
              milestones: future.milestones,
              terminalContext: future.terminalContext,
              finalState: future.finalState,
              reason: future.reason,
            };
          }
        }
      }
      const terminal = terminalEval();
      return {
        sequence,
        score: terminal.score,
        baseScore: terminal.baseScore,
        milestoneScore: terminal.milestoneScore,
        milestones: terminal.milestones,
        terminalContext: terminal.context,
        finalState: currentState,
        reason: "no_candidates",
      };
    }

    const hasPreBattleValueCandidate = hasPreBattleValueActions(candidates, {
      state: currentState,
      game: currentState,
      bot: currentState?.bot,
      player: currentState?.bot,
      strategy,
      analysis: {
        phase: currentState?.phase,
        turnCounter: currentState?.turnCounter,
      },
    });

    candidates = candidates
      .slice()
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .slice(0, Math.max(1, candidateLimit));

    const effectiveBeamWidth = Math.max(1, Math.min(beamWidth, candidates.length));
    const branches: SearchBranch[] = [];

    for (const action of candidates.slice(0, effectiveBeamWidth)) {
      if (nodesEvaluated >= nodeBudget) break;
      const nextState = clonePlanningState(currentState, strategy);
      const beforeHash = getPlanningStateHash(nextState);
      simulatePlanningAction(nextState, action, strategy);
      nodesEvaluated += 1;
      const afterHash = getPlanningStateHash(nextState);

      if (beforeHash === afterHash || seenStates.has(afterHash)) {
        continue;
      }
      seenStates.add(afterHash);

      const future = await search(nextState, depth + 1, [...sequence, action]);
      branches.push({
        action,
        sequence: future.sequence,
        score: future.score,
        baseScore: future.baseScore,
        milestoneScore: future.milestoneScore,
        milestones: future.milestones,
        terminalContext: future.terminalContext,
        finalState: future.finalState,
        reason: future.reason,
      });
    }

    const canBridgeNow = !hasPreBattleValueCandidate;

    if (nodesEvaluated < nodeBudget && canBridgeNow) {
      const bridge = tryMainBattleMain2Bridge(
        currentState,
        sequence,
        strategy,
        options,
      );
      if (bridge) {
        nodesEvaluated += 1;
        const bridgeHash = getPlanningStateHash(bridge.state);
        if (!seenStates.has(bridgeHash)) {
          seenStates.add(bridgeHash);
          const future = await search(bridge.state, depth + 1, [
            ...sequence,
            bridge.action,
          ]);
          branches.push({
            action: bridge.action,
            sequence: future.sequence,
            score: future.score,
            baseScore: future.baseScore,
            milestoneScore: future.milestoneScore,
            milestones: future.milestones,
            terminalContext: future.terminalContext,
            finalState: future.finalState,
            reason: future.reason,
          });
        }
      }
    }

    if (branches.length === 0) {
      const terminal = terminalEval();
      return {
        sequence,
        score: terminal.score,
        baseScore: terminal.baseScore,
        milestoneScore: terminal.milestoneScore,
        milestones: terminal.milestones,
        terminalContext: terminal.context,
        finalState: currentState,
        reason: "no_state_changing_branches",
      };
    }

    branches.sort((a, b) => b.score - a.score);
    return branches[0];
  };

  const result = await search(root, 0, []);
  if (!result?.sequence?.length) return null;
  const firstStepState = clonePlanningState(root, strategy);
  simulatePlanningAction(firstStepState, result.sequence[0], strategy);
  const diagnostics = {
    rootSummary: summarizePlanningState(root, { strategy }),
    firstStepSummary: summarizePlanningState(firstStepState, { strategy }),
    terminalSummary: summarizePlanningState(result.finalState, { strategy }),
    sequenceFingerprints: result.sequence.map(fingerprintAction),
  };
  const describeContext = {
    initialState: root,
    finalState: result.finalState,
    sequence: result.sequence,
    score: result.score,
    baseScore: result.baseScore,
    milestoneScore: result.milestoneScore,
    milestones: result.milestones || [],
    reason: result.reason,
    options,
    profile: options.profile,
    planningContext: options.planningContext,
  };
  const described =
    typeof strategy?.describePlannedLine === "function"
      ? strategy.describePlannedLine(describeContext)
      : "";

  return {
    action: result.sequence[0],
    score: result.score,
    baseScore: result.baseScore,
    milestoneScore: result.milestoneScore,
    sequence: result.sequence,
    finalState: result.finalState,
    nodesEvaluated,
    milestones: result.milestones || [],
    diagnostics,
    reason:
      described ||
      result.reason ||
      result.sequence.map((action) => describeAction(action)).join(" -> "),
    used: true,
  };
}
