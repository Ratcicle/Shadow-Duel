
import { appendSimulatedZoneCard } from "../common/zones.js";
import { appendSimulatedFieldCard, refreshSimulatedFieldAuras } from "../common/zones.js";
// ---------------------------------------------------------------------------
// src/core/ai/shadowheart/simulation.js
// Shadow-Heart simulation layer for lookahead/beam/planner clones.
// ---------------------------------------------------------------------------

import { applyGenericSimulatedMainPhaseAction, resolveSimulatedHandIndex, simulateGenericSpellEffect } from "../common/simulation.js";

import { buildShadowHeartTargetPreferences, buildShadowHeartCostPreferences, evaluateShadowHeartFusionPlan, evaluateShadowHeartRecruitCandidate, evaluateTributeTrade, getTributeRequirementFor, rankShadowHeartSearchCandidates, selectBestTributes } from "./priorities.js";

import type { AIAction, AIActivationContext, AIPlannedAction, StrategyRuntimePort } from "../../contracts/ai.js";
import type { PerspectiveGameState, SimulatedCardState, SimulatedPlayerState, SimulationGameState } from "../../contracts/aiState.js";
import type { GameCard } from "../../contracts/cards.js";
import type { EffectDefinition } from "../../contracts/effects.js";
import type { AiCardFilter } from "../common/cardFilters.js";

type ShadowSimulationState =
  | SimulationGameState
  | PerspectiveGameState;
type MutableShadowState = ShadowSimulationState & {
  currentPhase?: string | null;
};
type ShadowSearchFilters = AiCardFilter;

type ShadowSearchAction = Omit<ShadowSearchFilters, "type"> & {
  type: "search_any";
  sourceName?: string;
  filters?: ShadowSearchFilters;
};

interface ShadowActionExtras {
  filters?: ShadowSearchFilters;
  cardKind?: ShadowSearchFilters["cardKind"];
  archetype?: string;
  archetypes?: readonly string[];
  name?: string | undefined;
  minLevel?: number;
  maxLevel?: number;
  minAtk?: number;
  maxAtk?: number;
  subtype?: ShadowSearchFilters["subtype"];
  cannotAttackThisTurn?: boolean;
  fusionTargetHint?: string | null | undefined;
  cathedralPlan?: {
    counterCount?: number;
    targetName?: string | null;
  };
}

type ShadowMainPhaseAction = AIPlannedAction & ShadowActionExtras & {
  activationContext?: AIActivationContext | undefined;
  sourceCard?: SimulatedCardState | GameCard | null;
  cardName?: string | undefined;
  index?: number;
  zoneIndex?: number;
  fieldIndex?: number;
  position?: "attack" | "defense" | "choice" | undefined;
  facedown?: boolean | undefined;
};

// A triggered summon may choose its position independently of the source action.
type ShadowSummonPositionInput = Omit<ShadowMainPhaseAction, "position"> & {
  position?: "attack" | "defense" | "choice" | undefined;
};

interface ShadowPlaceResult {
  placed: boolean;
  zone: "fieldSpell" | "spellTrap" | null;
}

type PlaceSpellCard = (
  state: MutableShadowState,
  card: SimulatedCardState,
) => ShadowPlaceResult;

interface ShadowStrategyOptions {
  rankSearchCandidates?: (
    candidates: SimulatedCardState[],
    action: ShadowSearchAction,
    context: {
      game: MutableShadowState;
      player: SimulatedPlayerState;
      opponent: SimulatedPlayerState;
      source: SimulatedCardState | null;
    },
  ) => SimulatedCardState[];
  buildActivationContextForEffect?: (input: {
    sourceCard: SimulatedCardState;
    effect: EffectDefinition | null | undefined;
    player: SimulatedPlayerState;
    game: MutableShadowState;
  }) => AIActivationContext | null | undefined;
  chooseSpecialSummonPosition?: (
    card: SimulatedCardState,
    context: {
      game: MutableShadowState;
      player: SimulatedPlayerState;
      opponent: SimulatedPlayerState;
      source: SimulatedCardState | null;
      action: ShadowSummonPositionInput;
      activationContext?: AIActivationContext | undefined;
    },
  ) => "attack" | "defense" | null | undefined;
}

interface ShadowSimulationOptions extends ShadowStrategyOptions {
  placeSpellCard?: PlaceSpellCard;
  strategy?: Pick<
    StrategyRuntimePort,
    "simulateMainPhaseAction" | "simulateSpellEffect"
  > & ShadowStrategyOptions;
  evaluateRecruitCandidate?: (candidates: SimulatedCardState[], context?: Parameters<typeof evaluateShadowHeartRecruitCandidate>[1]) => ReturnType<typeof evaluateShadowHeartRecruitCandidate<SimulatedCardState>>;
  activationContext?: AIActivationContext | null | undefined;
}

type ShadowOptionsInput = PlaceSpellCard | ShadowSimulationOptions | null;

interface ShadowFusionHookInput {
  state: MutableShadowState;
  fusionCard: SimulatedCardState;
}

function normalizeOptions(
  placeSpellCardOrOptions: ShadowOptionsInput = null,
): ShadowSimulationOptions {
  if (typeof placeSpellCardOrOptions === "function") {
    return { placeSpellCard: placeSpellCardOrOptions };
  }
  return placeSpellCardOrOptions || {};
}

function ensureZones(
  player: Partial<SimulatedPlayerState> = {},
): SimulatedPlayerState {
  player.hand = player.hand || [];
  player.field = player.field || [];
  player.spellTrap = player.spellTrap || [];
  player.graveyard = player.graveyard || [];
  player.deck = player.deck || [];
  player.extraDeck = player.extraDeck || [];
  player.banished = player.banished || [];
  return player as SimulatedPlayerState;
}

function buildSimAnalysis(
  state: MutableShadowState = {} as MutableShadowState,
) {
  const player = ensureZones(state.bot || {});
  const opponent = ensureZones(state.player || {});
  return {
    hand: player.hand,
    field: player.field,
    graveyard: player.graveyard,
    spellTrap: player.spellTrap,
    fieldSpell: player.fieldSpell?.name || null,
    deck: player.deck,
    extraDeck: player.extraDeck,
    lp: player.lp || 8000,
    summonCount: player.summonCount || 0,
    phase: state.phase || state.currentPhase || "main1",
    game: state,
    player,
    opponent,
    oppField: opponent.field || [],
    oppLp: opponent.lp || 8000,
  };
}

function defaultPlaceSpellCard(
  state: MutableShadowState,
  card: SimulatedCardState,
): ShadowPlaceResult {
  const player = ensureZones(state.bot || {});
  if (card.subtype === "field") {
    if (player.fieldSpell) appendSimulatedZoneCard(player.graveyard, player.fieldSpell);
    player.fieldSpell = card;
    return { placed: true, zone: "fieldSpell" };
  }
  if (card.subtype === "continuous" || card.subtype === "equip") {
    appendSimulatedFieldCard(player.spellTrap, card);
    return { placed: true, zone: "spellTrap" };
  }
  return { placed: false, zone: null };
}

function placeShadowHeartSpellCard(
  state: MutableShadowState,
  card: SimulatedCardState,
  options: ShadowSimulationOptions = {},
): ShadowPlaceResult {
  const placeSpellCard = options.placeSpellCard || defaultPlaceSpellCard;
  const result = placeSpellCard(state, card);
  refreshSimulatedFieldAuras(state);
  return result;
}

function findEffect(
  card: SimulatedCardState | null | undefined,
  timings: string[] = [],
): EffectDefinition | null | undefined {
  const effects = Array.isArray(card?.effects) ? card.effects : [];
  return effects.find(
    (effect) =>
      effect &&
      (timings.length === 0 || timings.includes(effect.timing)),
  );
}

function buildActivationContext(
  state: MutableShadowState,
  sourceCard: SimulatedCardState | null,
  effect: EffectDefinition | null | undefined,
  options: ShadowSimulationOptions = {},
): AIActivationContext | null {
  if (!sourceCard) return null;
  if (typeof options.buildActivationContextForEffect === "function") {
    const built = options.buildActivationContextForEffect({
      sourceCard,
      effect,
      player: state.bot,
      game: state,
    });
    if (built) return built;
  }
  if (typeof options.strategy?.buildActivationContextForEffect === "function") {
    const built = options.strategy.buildActivationContextForEffect({
      sourceCard,
      effect,
      player: state.bot,
      game: state,
    });
    if (built) return built;
  }

  const preferences = buildShadowHeartTargetPreferences(
    sourceCard,
    effect,
    buildSimAnalysis(state),
  );
  return {
    autoSelectTargets: true,
    autoSelectSingleTarget: true,
    logTargets: false,
    actionContext: {
      costPreferences: buildShadowHeartCostPreferences(buildSimAnalysis(state)),
      targetPreferences: preferences.targetPreferences || {},
      specialSummonPositions: preferences.specialSummonPositions || {},
    },
  };
}

function getSourceCardForAction(
  state: MutableShadowState,
  action: ShadowMainPhaseAction,
): SimulatedCardState | null {
  const player = ensureZones(state.bot || {});
  if (action.type === "spell") {
    const index = resolveSimulatedHandIndex(player, action, "spell");
    return player.hand[index] || null;
  }
  if (action.type === "handIgnition") {
    const index = resolveSimulatedHandIndex(player, action, "monster");
    return player.hand[index] || null;
  }
  if (action.type === "spellTrapEffect") {
    const index = (
      Number.isInteger(action.zoneIndex) ? action.zoneIndex : action.index
    ) as number;
    return player.spellTrap?.[index] || null;
  }
  if (action.type === "fieldEffect") return player.fieldSpell || null;
  if (action.type === "monsterEffect") {
    return player.field?.[action.fieldIndex as number] || null;
  }
  return null;
}

function prepareAction(
  state: MutableShadowState,
  action: ShadowMainPhaseAction,
  options: ShadowSimulationOptions = {},
): ShadowMainPhaseAction {
  const prepared = { ...action };
  const sourceCard = getSourceCardForAction(state, action);
  const effect = sourceCard
    ? findEffect(sourceCard, action.type === "handIgnition" ? ["ignition"] : [])
    : null;
  if (!prepared.activationContext && sourceCard) {
    const activationContext = buildActivationContext(
      state,
      sourceCard,
      effect,
      options,
    );
    if (activationContext) prepared.activationContext = activationContext;
  }
  if (sourceCard?.name === "Polymerization" && !prepared.fusionTargetHint) {
    const fusionPlan = evaluateShadowHeartFusionPlan(buildSimAnalysis(state));
    if (fusionPlan?.targetName) prepared.fusionTargetHint = fusionPlan.targetName;
  }
  return prepared;
}

export function buildShadowHeartSimulationOptions(
  baseOptions: ShadowSimulationOptions = {},
) {
  const options = {
    ...baseOptions,
    guardLabel: "ShadowHeartSimulation",
    strategy: baseOptions.strategy,
    getTributeRequirementFor,
    selectBestTributes,
    rankSearchCandidates: baseOptions.rankSearchCandidates || rankShadowHeartSearchCandidates,
    evaluateRecruitCandidate:
      baseOptions.evaluateRecruitCandidate || evaluateShadowHeartRecruitCandidate,
    chooseSpecialSummonPosition: baseOptions.chooseSpecialSummonPosition,
    placeSpellCard: (
      simState: MutableShadowState,
      card: SimulatedCardState,
    ) =>
      placeShadowHeartSpellCard(simState, card, baseOptions),
    enableSimulatedEvents: true,
    evaluateTributeTrade,
    onFusionSummon: ({
      state: simState,
    }: ShadowFusionHookInput) => {
      refreshSimulatedFieldAuras(simState);
    },
  };

  if (!options.chooseSpecialSummonPosition && options.strategy?.chooseSpecialSummonPosition) {
    options.chooseSpecialSummonPosition =
      options.strategy.chooseSpecialSummonPosition.bind(options.strategy);
  }

  return options;
}

export function simulateMainPhaseAction(
  state: MutableShadowState,
  action: AIPlannedAction,
  placeSpellCardOrOptions?: ShadowOptionsInput,
  planningOptions?: ReturnType<typeof buildShadowHeartSimulationOptions>,
): MutableShadowState;
export function simulateMainPhaseAction(
  state: MutableShadowState,
  action: ShadowMainPhaseAction,
  placeSpellCardOrOptions: ShadowOptionsInput = null,
  planningOptions?: ReturnType<typeof buildShadowHeartSimulationOptions>,
): MutableShadowState {
  if (!action) return state;
  ensureZones(state.bot || {});
  ensureZones(state.player || {});
  const baseOptions = normalizeOptions(placeSpellCardOrOptions);
  const preparedAction = prepareAction(state, action, baseOptions);
  const options = planningOptions || buildShadowHeartSimulationOptions(baseOptions);
  // The legacy planner may probe `simulatedBattle` through this adapter. The
  // generic dispatcher intentionally exposes only the 13 executable actions,
  // while the erased cast preserves the former runtime no-op path.
  applyGenericSimulatedMainPhaseAction(
    state,
    preparedAction as AIAction,
    options,
  );
  return state;
}

export function simulateSpellEffect(
  state: MutableShadowState,
  card: SimulatedCardState,
  placeSpellCardOrOptions: ShadowOptionsInput = null,
): MutableShadowState {
  if (!card) return state;
  ensureZones(state.bot || {});
  ensureZones(state.player || {});
  const baseOptions = normalizeOptions(placeSpellCardOrOptions);
  const effect = findEffect(card, ["on_play"]);
  const activationContext = buildActivationContext(state, card, effect, baseOptions);
  const options = buildShadowHeartSimulationOptions({
    ...baseOptions,
    activationContext,
  });
  simulateGenericSpellEffect(state, card, {
    ...options,
    sourceCard: card,
    activationContext,
  });
  return state;
}
