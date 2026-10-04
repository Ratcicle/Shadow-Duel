import { applyCostSummonMarker, applyPaidCostSummonMarkers } from "../../../effects/costs/summonMarkers.js";
import { appendSimulatedZoneCard } from "../zones.js";
import { getNormalSummonTributeOptions } from "../../../game/summon/tributeValue.js";
import { recordNormalSummonForTurn } from "../../../Player.js";
import { resolveExactInstanceSelection } from "../../../AutoSelector.js";
import { appendSimulatedFieldCard } from "../zones.js";
import { getEffectiveAtk } from "../cardStats.js";
import { emitSimulatedMove, getOriginalOwner } from "./movement.js";
import type { SimulatedMoveReceipt } from "../zones.js";
import { getGenericSynchroActions } from "../actionGeneration.js";
import { attachSimulatedEventEmitter, canSimulatedProcedureEnterField, createDeferredSimulatedEventFrame } from "../simulation.js";
import {
  checkSpecialSummonEligibility,
  establishProperSummon,
} from "../../../game/summon/eligibility.js";
import { getCounterValue, setCounterValue } from "../counters.js";
import { estimateMonsterValue, hasArchetype } from "../cardValue.js";
import {
  evaluateSimulatedConditions,
  getStoredBlueprints,
} from "../simulatedConditions.js";
import {
  buildActionFilter,
  getCardInstanceId,
  getCostPreference,
  getTargetPreference,
  matchesTargetFilters,
  mergeCostPreference,
  normalizeCount,
  rankCandidates,
  selectSimulatedTargets,
} from "../targetSelection.js";
import {
  attachSimulatedEquip,
  canMoveCardToZone,
  findCardOwner,
  findCardZone,
  getZoneCards,
  moveCardToZone,
  removeCardFromZones,
} from "../zones.js";
import {
  applySummonState,
  chooseSpecialSummonPosition,
  recordCompletedSimulatedSummon,
  chooseRankedCards,
  getActionCandidates,
  hasOpenMonsterZone,
  hasRequiredSelections,
  markSimulatedPassiveUsed,
  pickCountForAction,
  resolveActionPlayer,
  resolveSimulatedLpCost,
  resolveTargetsForAction,
  isSimulatedSourcePresenceValid,
  STOP_SIMULATION,
  storeSimActionResult,
  updateSimulatedSentToGraveMaterialMarker,
} from "./shared.js";
import type { ActionOf } from "../../../contracts/actions.js";
import type { ConditionalSummonMarker } from "../../../contracts/actions/shared.js";
import type {
  SimulatedCardState,
  SimulatedPlayerState,
} from "../../../contracts/aiState.js";
import type {
  GameCard,
  SpecialSummonProcedure,
  SynchroMaterialRecord,
} from "../../../contracts/cards.js";
import type { CardFilter } from "../../../contracts/effects.js";
import type { ZoneInput } from "../../../contracts/zones.js";
import type {
  SimulatedActionHandlerContext,
  SimulatedActionOptions,
  SimulatedRuntimeState,
  SimulatedSynchroChoice,
  SimulatedEventOccurrence,
} from "./shared.js";

interface SimulatedAfterSpecialSummonInput {
  options: SimulatedActionOptions;
  state: SimulatedRuntimeState;
  player: SimulatedPlayerState;
  card: object;
  action: object;
  fromZone?: string | readonly ZoneInput[];
  sourceCard?: object | null | undefined;
}

interface SimulatedConditionalSummonMarker extends ConditionalSummonMarker {
  readonly filters?: CardFilter;
}

interface SimulatedConditionalMarkerAction {
  readonly conditionalMarkersOnSummon?:
    | SimulatedConditionalSummonMarker
    | readonly SimulatedConditionalSummonMarker[];
  readonly sourceEffectId?: string;
}

interface SimulatedConditionalMarkerInput {
  action: SimulatedConditionalMarkerAction;
  sourceCard: SimulatedCardState | null | undefined;
  paidCostCards?: readonly SimulatedCardState[] | null;
  state: SimulatedRuntimeState;
  targetPlayer: SimulatedPlayerState | null | undefined;
  options: SimulatedActionOptions;
}

interface SimulatedCardToGraveInput {
  options: SimulatedActionOptions;
  player: SimulatedPlayerState;
  card: SimulatedCardState;
  fromZone: string;
  sourceCard: SimulatedCardState;
  contextLabel: string;
}

interface LegacySimulatedSpecialSummonRestriction {
  allowedFilters: CardFilter;
  duration: string;
  expiresOnTurn?: number | undefined;
  reason: string | null;
  sourceName: string | null;
  sourceId: number | null;
}

interface SimulatedSynchroEntry {
  card: SimulatedCardState;
  combos: SimulatedCardState[][];
}

interface MutablePositionFilter {
  position?: unknown;
}

interface SimulatedLastSpecialSummonContext {
  lastSpecialSummonedCards?: SimulatedCardState[];
  lastSpecialSummonedCard?: SimulatedCardState | null;
}

type SimulatedSummonStateAction = Parameters<typeof applySummonState>[1];
type SimulatedRankingAction = Parameters<typeof chooseRankedCards>[2];

type LegacyPolymerizationAction = SimulatedSummonStateAction & {
  readonly targetRef?: string;
  readonly id?: string;
};

interface LegacyFusionSourceAction {
  readonly fusionTargetHint?: string;
}

interface LegacyTieredCostFields {
  count?: unknown;
  filters?: CardFilter;
  costTargetRef?: string;
}

type LegacyTieredCostAction = ActionOf<
  "special_summon_from_hand_with_tiered_cost"
> & LegacyTieredCostFields;

type MutableSummonedCard = SimulatedCardState & {
  summonMethod?: string;
  summonProcedure?: string;
  cannotBeDestroyedByBattle?: boolean | undefined;
};

function emitSimulatedAfterSpecialSummon({
  options,
  state,
  player,
  card,
  action,
  fromZone = "hand",
  sourceCard = null,
}: SimulatedAfterSpecialSummonInput): void {
  options.emitSimulatedEvent?.("after_summon", {
    card,
    player,
    method: "special",
    fromZone,
    sourceCard: sourceCard || options.sourceCard || card,
    actionContext: options.actionContext,
  });
}

function getSimCardInstanceId(
  card: SimulatedCardState | null | undefined,
): number | string | null {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? card?.simInstanceId ?? null;
}

function applySimConditionalMarkersOnSummon({
  action,
  sourceCard,
  paidCostCards,
  state,
  targetPlayer,
  options,
}: SimulatedConditionalMarkerInput): void {
  const markerConfigs = Array.isArray(action?.conditionalMarkersOnSummon)
    ? action.conditionalMarkersOnSummon
    : action?.conditionalMarkersOnSummon
      ? [action.conditionalMarkersOnSummon]
      : [];
  if (!sourceCard || markerConfigs.length === 0) return;

  for (const markerConfig of markerConfigs) {
    if (!markerConfig?.key) continue;
    const filters = markerConfig.costFilters || markerConfig.filters || {};
    const matchingCostCards = (paidCostCards || []).filter((card) =>
      matchesTargetFilters(card, filters, sourceCard, "self"),
    );
    applyCostSummonMarker(sourceCard, markerConfig, matchingCostCards.length,
      markerConfig.sourceEffectId || options.effect?.id || action.sourceEffectId || null,
      Number(state?.turnCounter || 0));
    const marker = sourceCard.effectMarkers?.[markerConfig.key];
    if (marker && targetPlayer?.id) marker.controllerId = targetPlayer.id;
  }
}

export function canSimSpecialSummon(
  card: SimulatedCardState | null | undefined,
  player: SimulatedPlayerState | null | undefined,
  summonProcedure: SpecialSummonProcedure | string = "special",
): boolean {
  if (!card || !player) return false;
  const fromZone = ([
    "hand",
    "field",
    "spellTrap",
    "graveyard",
    "banished",
    "deck",
    "extraDeck",
  ] as const).find((zone) =>
    Array.isArray(player[zone]) && player[zone].includes(card)
  );
  const eligibility = checkSpecialSummonEligibility(card, {
    summonProcedure,
    fromZone: fromZone || null,
  });
  if (eligibility.ok === false) {
    return false;
  }
  const restrictions = Array.isArray(player.specialSummonRestrictions)
    ? player.specialSummonRestrictions
    : [];
  return restrictions.every((restriction) => {
    const filters = restriction?.allowedFilters;
    return !filters || matchesTargetFilters(card, filters, null, "self");
  });
}

function captureSimSynchroMaterialMetadata(
  card: SimulatedCardState,
  player: SimulatedPlayerState,
  state: SimulatedRuntimeState,
): SynchroMaterialRecord {
  return {
    instanceId: getSimCardInstanceId(card),
    cardId: card?.id ?? null,
    name: card?.name || null,
    level: Number(card?.level || 0),
    isTuner: card?.isTuner === true,
    ownerId: card?.owner || player?.id || null,
    controllerId: player?.id || card?.controller || card?.owner || null,
    usedOnTurn: Number.isFinite(Number(state?.turnCounter))
      ? Number(state.turnCounter)
      : null,
  };
}

function getSimSynchroEntries(
  player: SimulatedPlayerState,
  action: ActionOf<"synchro_summon_from_extra_deck">,
  state: SimulatedRuntimeState,
): SimulatedSynchroEntry[] {
  const filters: CardFilter = {
    cardKind: "monster",
    monsterType: "synchro",
    ...(action.filters || action.candidateFilters || {}),
  };
  const opponent = state.bot === player ? state.player : state.bot;
  const actions = getGenericSynchroActions({ bot: player, player: opponent, turn: state.turn, turnCounter: state.turnCounter, phase: "main1", _isPerspectiveState: true });
  return (player?.extraDeck || [])
    .filter(
      (card) =>
        matchesTargetFilters(card, filters, null, "self") &&
        canSimSpecialSummon(card, player, "synchro"),
    )
    .map((card) => ({
      card,
      combos: actions.filter(entry => entry.synchroInstanceId === card.instanceId)
        .filter((entry, index, all) => all.findIndex(other =>
          JSON.stringify(other.materialInstanceIds) === JSON.stringify(entry.materialInstanceIds)) === index)
        .map(entry => entry.materialInstanceIds.map(id => player.field.find(material => material.instanceId === id))
          .filter((material): material is SimulatedCardState => !!material)),
    }))
    .filter((entry) =>
      entry.combos.some(
        (combo) => (player.field || []).length - combo.length + 1 <= 5,
      ),
    )
    .sort(
      (a, b) => estimateMonsterValue(b.card) - estimateMonsterValue(a.card),
    );
}

function emitSimulatedCardToGrave({
  options,
  player,
  card,
  fromZone,
  sourceCard,
  contextLabel,
}: SimulatedCardToGraveInput): void {
  options.emitSimulatedEvent?.("card_moved", {
    card,
    player,
    fromPlayer: player,
    toPlayer: player,
    fromZone,
    toZone: "graveyard",
    movedByEffect: false,
    wasFaceupBeforeMove: card?.isFacedown !== true,
    contextLabel,
    sourceCard,
    actionContext: options.actionContext,
  });
}

export function applyRestrictSpecialSummons(
  ctx: SimulatedActionHandlerContext<"restrict_special_summons">,
): void {
  const { action, options, self, opponent, state } = ctx;
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  if (!targetPlayer || !action.allowedFilters) return;
  targetPlayer.specialSummonRestrictions =
    targetPlayer.specialSummonRestrictions || [];
  (targetPlayer.specialSummonRestrictions as
    LegacySimulatedSpecialSummonRestriction[]).push({
    allowedFilters: { ...action.allowedFilters },
    duration: action.duration || "until_end_turn",
    expiresOnTurn: state.turnCounter,
    reason: action.reason || null,
    sourceName: options?.sourceCard?.name || null,
    sourceId: options?.sourceCard?.id || null,
  });
}

export function applySpecialSummonFromZone(
  ctx: SimulatedActionHandlerContext<"special_summon_from_zone">,
): void | typeof STOP_SIMULATION {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  options.lastSpecialSummonedCards = [];
  options.lastSpecialSummonedCard = null;
  if (options.actionContext) {
    (options.actionContext as SimulatedLastSpecialSummonContext).lastSpecialSummonedCards = [];
    (options.actionContext as SimulatedLastSpecialSummonContext).lastSpecialSummonedCard = null;
  }
  storeSimActionResult(action, selections, options, []);
  const targetPlayer =
    action.summonToOwner === "opponent"
      ? opponent
      : resolveActionPlayer(action, self, opponent);
  const decisionKey = ("contextLabel" in action && typeof action.contextLabel === "string" && action.contextLabel) || options.effect?.id || action.type;
  const exactIds = options.activationContext?.decisions?.specialSummons?.[decisionKey];
  const minimum = normalizeCount(action.count, 1).min;
  const fail = () => minimum > 0 && (action.haltOnFailure || action.stopOnFailure) ? STOP_SIMULATION : undefined;
  const sourceScope = action.sourceOwner || action.scope || "self";
  const sourceOwners = sourceScope === "opponent" ? [opponent]
    : sourceScope === "both" || sourceScope === "any" ? [self, opponent] : [self];
  const sourceZone = action.zone || action.sourceZone || "deck";
  const sourceZones = Array.isArray(sourceZone) ? sourceZone : [sourceZone];
  const sourceInConfiguredZone = (card: SimulatedCardState) => sourceOwners.some(owner =>
    sourceZones.some(zone => getZoneCards(owner, zone).includes(card)));
  if (action.requireSource && (!options.sourceCard ||
      !sourceInConfiguredZone(options.sourceCard) || !isSimulatedSourcePresenceValid(options, self))) return fail();
  if (!hasOpenMonsterZone(targetPlayer) && exactIds === undefined) return fail();
  let candidates = action.requireSource && options.sourceCard
    ? [options.sourceCard]
    : action.targetRef
      ? targets
      : null;
  if (!candidates || candidates.length === 0) {
    if (action.targetRef) return fail();
    const candidateAction = { ...action };
    delete candidateAction.position;
    candidates = getActionCandidates(
      targetPlayer,
      candidateAction,
      "deck",
      options,
    );
  }
  if (action.targetRef) {
    const filters = buildActionFilter(
      action as Parameters<typeof buildActionFilter>[0],
    );
    delete (filters as MutablePositionFilter).position;
    if (Object.keys(filters).length > 0) {
      candidates = candidates.filter((card) =>
        matchesTargetFilters(card, filters, options.sourceCard, "self"),
      );
    }
  }
  const otherPlayer = targetPlayer === self ? opponent : self;
  candidates = candidates.filter((card) => canSimSpecialSummon(card, targetPlayer) &&
    canSimulatedProcedureEnterField(card, targetPlayer, otherPlayer, []));
  const count = typeof action.count === "object" ? action.count : null;
  const dynamicMax = count?.maxFrom === "opponentFieldCount"
    ? Math.min(opponent.field.length, count.cap ?? 5)
    : Infinity;
  const max = Math.min(
    pickCountForAction(action, 1),
    dynamicMax,
    candidates.length,
    5 - (targetPlayer.field || []).length,
  );
  const ranked = chooseRankedCards(
    candidates,
    "summon",
    action,
    state,
    targetPlayer,
    options,
  );
  const preferred = exactIds === undefined
    ? options.chooseSpecialSummonCards?.(candidates, { action, player: targetPlayer, state, sourceCard: options.sourceCard })
    : resolveExactInstanceSelection(candidates, exactIds, { min: normalizeCount(action.count, 1).min, max,
      revalidation: options.activationContext?.decisions?.specialSummonRevalidation?.[decisionKey] });
  if (exactIds !== undefined && (preferred === null ||
      (action.distinctNames && preferred && new Set(preferred.map(card => card.name)).size !== preferred.length))) {
    (state._simUnsupportedActions ??= []).push(`exact_special_summon:${decisionKey}`);
    return STOP_SIMULATION;
  }
  if (preferred === null) return fail();
  const chosen: SimulatedCardState[] = [];
  for (const card of preferred ?? ranked) {
    if (chosen.length >= max) break;
    if (!candidates.includes(card) || chosen.includes(card)) continue;
    if (action.distinctNames && chosen.some(other => other.name === card.name)) continue;
    chosen.push(card);
  }
  if (chosen.length === 0) return fail();
  if (action.requireSource && (!options.sourceCard ||
      !sourceInConfiguredZone(options.sourceCard) || !isSimulatedSourcePresenceValid(options, self))) return fail();
  if (action.banishCost && options.sourceCard) {
    const sourceOwner = findCardOwner(state, options.sourceCard) || targetPlayer;
    moveCardToZone(sourceOwner, options.sourceCard, "banished");
  }
  const summoned: SimulatedCardState[] = [];
  chosen.forEach((card) => {
    if (!hasOpenMonsterZone(targetPlayer)) return;
    const sourceOwner = findCardOwner(state, card) || targetPlayer;
    const fromZone = findCardZone(sourceOwner, card);
    if (!fromZone || !canSimSpecialSummon(card, targetPlayer) ||
        !canSimulatedProcedureEnterField(card, targetPlayer, otherPlayer, [])) return;
    const position = chooseSpecialSummonPosition(card, {
      ...action, position: action.position === "any" ? "choice" : action.position || "choice",
    }, state, targetPlayer, options);
    if (findCardZone(sourceOwner, card) !== fromZone ||
        !canSimSpecialSummon(card, targetPlayer) || !canSimulatedProcedureEnterField(card, targetPlayer, otherPlayer, []) ||
        (action.requireSource && (!sourceInConfiguredZone(card) || !isSimulatedSourcePresenceValid(options, self)))) return;
    removeCardFromZones(sourceOwner, card);
    card.owner = targetPlayer.id;
    card.controller = targetPlayer.id;
    applySummonState(
      card,
      { ...action, position },
      state,
      targetPlayer,
      options,
    );
    appendSimulatedFieldCard(targetPlayer.field, card);
    recordCompletedSimulatedSummon(state, { card, player: targetPlayer, method: "special" });
    applyPaidCostSummonMarkers(action, card, options.costPayment?.summonMarkers || [],
      options.effect?.id || null, Number(state.turnCounter || 0));
    summoned.push(card);
    options.onAfterSpecialSummon?.({
      state,
      player: targetPlayer,
      card,
      action,
      fromZone,
      sourceCard: options.sourceCard,
    });
    emitSimulatedAfterSpecialSummon({
      options,
      state,
      player: targetPlayer,
      card,
      action,
      fromZone,
      sourceCard: options.sourceCard,
    });
    options.emitSimulatedEvent?.("card_moved", {
      card, player: targetPlayer, fromZone, toZone: "field", sourceCard: options.sourceCard,
      actionContext: options.actionContext,
    });
  });
  if (summoned.length > 0) {
    options.lastSpecialSummonedCards = summoned;
    options.lastSpecialSummonedCard = summoned[0] || null;
    if (options.actionContext && typeof options.actionContext === "object") {
      (options.actionContext as SimulatedLastSpecialSummonContext)
        .lastSpecialSummonedCards = summoned;
      (options.actionContext as SimulatedLastSpecialSummonContext)
        .lastSpecialSummonedCard = summoned[0] || null;
    }
    storeSimActionResult(action, selections, options, summoned);
  }
  if (summoned.length === 0) return fail();
  return;
}

export function applyDeSynchro(
  ctx: SimulatedActionHandlerContext<"de_synchro">,
): void {
  const { action, targets, state, options, self, opponent } = ctx;
  const player = resolveActionPlayer(action, self, opponent);
  const synchroCard = (targets || []).find(
    (card) =>
      card?.cardKind === "monster" &&
      card.monsterType === "synchro" &&
      card.isFacedown !== true,
  );
  if (!player || !synchroCard) return;
  const owner = findCardOwner(state, synchroCard) || player;
  if (!owner.field?.includes(synchroCard)) return;

  const metadata = Array.isArray(synchroCard.synchroMaterials)
    ? synchroCard.synchroMaterials
    : [];
  const materialIds = metadata
    .map((entry) => entry?.instanceId)
    .filter((id) => id !== undefined && id !== null);
  const materials = materialIds.map((id) =>
    (player.graveyard || []).find((card) => getSimCardInstanceId(card) === id),
  );
  const targetOnOwnField = (player.field || []).includes(synchroCard);
  const freeZones = Math.max(
    0,
    5 - (player.field || []).length + (targetOnOwnField ? 1 : 0),
  );
  const canReviveAll =
    materials.length === materialIds.length &&
    materials.length > 0 &&
    materials.length <= freeZones &&
    materials.every((card) => canSimSpecialSummon(card, player, "special"));

  moveCardToZone(owner, synchroCard, "extraDeck");
  if (!canReviveAll) return;

  (materials as SimulatedCardState[]).forEach((material) => {
    moveCardToZone(player, material, "field");
    applySummonState(
      material,
      { ...action, position: action.position || "attack" } as
        SimulatedSummonStateAction,
      state,
      player,
      options,
    );
    recordCompletedSimulatedSummon(state, { card: material, player, method: "special" });
    options.emitSimulatedEvent?.("after_summon", {
      card: material,
      player,
      method: "special",
      fromZone: "graveyard",
      sourceCard: options.sourceCard,
      actionContext: options.actionContext,
    });
  });
}

export function applySynchroSummonFromExtraDeck(
  ctx: SimulatedActionHandlerContext<"synchro_summon_from_extra_deck">,
): void | typeof STOP_SIMULATION {
  const { action, state, options, self, opponent } = ctx;
  const player = resolveActionPlayer(action, self, opponent);
  if (!player) return;
  const entries = getSimSynchroEntries(player, action, state);
  const selected = entries[0];
  const fallbackMaterials = selected?.combos[0];
  const decisionKey = ("contextLabel" in action && typeof action.contextLabel === "string" && action.contextLabel) || options.effect?.id || action.type;
  const exactChoice = options.activationContext?.decisions?.synchroSummons?.[decisionKey];
  const choice = exactChoice !== undefined ? exactChoice : options.chooseSynchroMaterials
    ? options.chooseSynchroMaterials({ candidates: entries, player, state, sourceCard: options.sourceCard })
    : selected?.card.instanceId != null && fallbackMaterials?.every(card => card.instanceId != null)
      ? { synchroInstanceId: selected.card.instanceId,
        materialInstanceIds: fallbackMaterials.map(card => card.instanceId!),
        position: action.position === "defense" ? "defense" as const : "attack" as const } : null;
  const success = choice && entries.some(entry => entry.card.instanceId === choice.synchroInstanceId) &&
    ((action.position !== "attack" && action.position !== "defense") || (choice.position || "attack") === action.position) &&
    simulateSynchroSummon(state, player, choice, options, ctx.applySimulatedActions);
  if (!success && exactChoice !== undefined) {
    (state._simUnsupportedActions ??= []).push(`exact_synchro_summon:${decisionKey}`);
    return STOP_SIMULATION;
  }
}

/** One shared procedure for explicit AI actions and Synchros performed by effects. */
export function simulateSynchroSummon(
  state: SimulatedRuntimeState,
  player: SimulatedPlayerState,
  choice: SimulatedSynchroChoice,
  options: SimulatedActionOptions,
  applyActions: SimulatedActionHandlerContext<"synchro_summon_from_extra_deck">["applySimulatedActions"],
): boolean {
  options = attachSimulatedEventEmitter(state, { ...options, enableSimulatedEvents: true });
  const opponent = state.bot === player ? state.player : state.bot;
  const position = choice.position || "attack";
  const ids = choice.materialInstanceIds;
  if (new Set(ids).size !== ids.length) return false;
  const legal = getGenericSynchroActions({ bot: player, player: opponent, turn: state.turn, turnCounter: state.turnCounter, phase: "main1", _isPerspectiveState: true })
    .some(action => action.synchroInstanceId === choice.synchroInstanceId && action.position === position &&
      action.materialInstanceIds.length === ids.length && action.materialInstanceIds.every(id => ids.includes(id)));
  if (!legal) return false;
  const synchroCard = player.extraDeck.find(card => card.instanceId === choice.synchroInstanceId);
  const materials = ids.map(id => player.field.find(card => card.instanceId === id))
    .filter((card): card is SimulatedCardState => !!card);
  if (!synchroCard || materials.length !== ids.length) return false;
  if (!materials.every(material => canMoveCardToZone(player, material, "graveyard", player, { state }))) return false;
  const metadata = materials.map(card => captureSimSynchroMaterialMetadata(card, player, state));
  const contextId = `sim:synchro:${state._simGeneratedInstanceCounter = (state._simGeneratedInstanceCounter || 0) + 1}`;
  const actionContext = { ...options.actionContext, synchroSummonContextId: contextId };
  const deferred: SimulatedEventOccurrence[] = [];
  for (const material of materials) {
    const wasFaceupBeforeMove = !material.isFacedown;
    const effectsNegatedAtFieldExit = material.effectsNegated === true;
    if (!moveCardToZone(player, material, "graveyard", player, { state })) return false;
    const toZone = findCardZone(player, material) || "removed";
    const payload = { card: material, player, fromPlayer: player, toPlayer: toZone === "removed" ? null : player,
      fromZone: "field", toZone,
      wasFaceupBeforeMove, effectsNegatedAtFieldExit, movedByEffect: false,
      contextLabel: "synchro_material", sourceCard: synchroCard, actionContext };
    if (toZone === "graveyard") {
      updateSimulatedSentToGraveMaterialMarker({ card: material, state, player, fromZone: "field", contextLabel: "synchro_material" });
      // The runtime emits movement immediately and holds its trigger until the
      // Synchro attempt finishes. Observe now; resolve the batch below.
      options.onSimulatedEvent?.("card_to_grave", payload);
      deferred.push({ event: "card_to_grave", payload, observed: true });
    }
    options.emitSimulatedEvent?.("card_moved", payload);
  }
  if (!moveCardToZone(player, synchroCard, "field", player, { state })) return false;
  applySummonState(
    synchroCard,
    { position },
    state,
    player,
    options,
  );
  (synchroCard as MutableSummonedCard).summonMethod = "synchro";
  synchroCard.lastSummonMethod = "synchro";
  synchroCard.lastSummonedFromZone = "extraDeck";
  (synchroCard as MutableSummonedCard).summonProcedure = "synchro";
  establishProperSummon(synchroCard, {
    summonProcedure: "synchro",
    sourceZone: "extraDeck",
  });
  synchroCard.synchroMaterials = metadata;
  recordCompletedSimulatedSummon(state, { card: synchroCard, player, method: "synchro" });
  const summonEvent: SimulatedEventOccurrence = { event: "after_summon", observed: true, payload: {
    card: synchroCard,
    player,
    method: "synchro",
    summonProcedure: "synchro",
    fromZone: "extraDeck",
    sourceCard: synchroCard,
    actionContext,
  } };
  options.onSimulatedEvent?.(summonEvent.event, summonEvent.payload);
  options.emitSimulatedEvent?.("card_moved", { card: synchroCard, player, fromZone: "extraDeck", toZone: "field", actionContext });
  // The runtime finishes the material trigger window before discovering the
  // summoned monster's queued trigger targets. Keep those choices separate:
  // a material effect can remove a prospective target from the Graveyard.
  if (options.emitSimulatedEvents) options.emitSimulatedEvents(deferred);
  else for (const entry of deferred) options.emitSimulatedEvent?.(entry.event, entry.payload);
  if (options.emitSimulatedEvents) options.emitSimulatedEvents([summonEvent]);
  else options.emitSimulatedEvent?.(summonEvent.event, summonEvent.payload);
  const followups = (state.pendingSynchroMaterialFollowups || []).filter(entry => entry.synchroSummonContextId === contextId);
  state.pendingSynchroMaterialFollowups = (state.pendingSynchroMaterialFollowups || []).filter(entry => entry.synchroSummonContextId !== contextId);
  for (const followup of followups) {
    if (!player.field.includes(synchroCard)) break;
    applyActions({ actions: followup.actions, state,
      selfId: state.bot === player ? "bot" : "player", selections: { synchro_summoned_card: [synchroCard] },
      options: { ...options, sourceCard: followup.source, actionContext },
    });
  }
  return true;
}

export function applySearchThenOptionalSpecialSummonFromHand(
  ctx: SimulatedActionHandlerContext<"search_then_optional_special_summon_from_hand">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  const candidates = getActionCandidates(targetPlayer, action, "deck");
  const searched = chooseRankedCards(
    candidates,
    "benefit",
    action,
    state,
    targetPlayer,
    options,
  )[0];
  if (!searched) return;
  removeCardFromZones(targetPlayer, searched);
  appendSimulatedZoneCard(targetPlayer.hand, searched);

  const canSummon =
    hasOpenMonsterZone(targetPlayer) &&
    canSimSpecialSummon(searched, targetPlayer) &&
    evaluateSimulatedConditions(action.summonCondition, {
      state,
      selfId,
      options,
    });
  if (!canSummon) return;

  removeCardFromZones(targetPlayer, searched);
  applySummonState(
    searched,
    action as SimulatedSummonStateAction,
    state,
    targetPlayer,
    ({
      ...options,
      action,
    } as SimulatedActionOptions),
  );
  appendSimulatedFieldCard(targetPlayer.field, searched);
  recordCompletedSimulatedSummon(state, { card: searched, player: targetPlayer, method: "special" });
  options.onAfterSpecialSummon?.({
    state,
    player: targetPlayer,
    card: searched,
    action,
    fromZone: "hand",
    sourceCard: options.sourceCard,
  });
  emitSimulatedAfterSpecialSummon({
    options,
    state,
    player: targetPlayer,
    card: searched,
    action,
    fromZone: "hand",
    sourceCard: options.sourceCard,
  });
  return;
}

export function applySpecialSummonFromHandWithCost(
  ctx: SimulatedActionHandlerContext<"special_summon_from_hand_with_cost">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  const sourceCard = options.sourceCard;
  if (!sourceCard || !targetPlayer.hand?.includes(sourceCard)) return;
  if (!canSimSpecialSummon(sourceCard, targetPlayer)) return;
  const costTargets = (action.costTargetRef
    ? selections?.[action.costTargetRef] || []
    : targets) as readonly SimulatedCardState[];
  if (!Array.isArray(costTargets) || costTargets.length === 0) return;
  const costDestination =
    action.costDestination === "banish"
      ? "banished"
      : action.costDestination || "graveyard";
  const costFreesMonsterZone = costTargets.some((card) => {
    const owner = findCardOwner(state, card) || targetPlayer;
    return owner === targetPlayer && findCardZone(owner, card) === "field";
  });
  if (!hasOpenMonsterZone(targetPlayer) && !costFreesMonsterZone) return;
  const paidCostCards: SimulatedCardState[] = [];
  costTargets.forEach((card) => {
    if (!card) return;
    const owner = findCardOwner(state, card) || targetPlayer;
    const fromZone = findCardZone(owner, card) || "field";
    const wasFaceupBeforeMove = card.isFacedown !== true;
    if (moveCardToZone(owner, card, costDestination)) {
      options.emitSimulatedEvent?.("card_moved", {
        card,
        player: owner,
        fromPlayer: owner,
        toPlayer: owner,
        fromZone,
        toZone: costDestination,
        movedByEffect: action.costMovedByEffect === true,
        wasFaceupBeforeMove,
        sourceCard,
        effectId: options.effect?.id || null,
        actionContext: options.actionContext,
      });
      paidCostCards.push(card);
    }
  });
  if (!hasOpenMonsterZone(targetPlayer)) return;
  removeCardFromZones(targetPlayer, sourceCard);
  applySummonState(
    sourceCard,
    action as SimulatedSummonStateAction,
    state,
    targetPlayer,
    options,
  );
  appendSimulatedFieldCard(targetPlayer.field, sourceCard);
  recordCompletedSimulatedSummon(state, { card: sourceCard, player: targetPlayer, method: "special" });
  applySimConditionalMarkersOnSummon({
    action,
    sourceCard,
    paidCostCards,
    state,
    targetPlayer,
    options,
  });
  options.onAfterSpecialSummon?.({
    state,
    player: targetPlayer,
    card: sourceCard,
    action,
    fromZone: "hand",
    sourceCard,
  });
  emitSimulatedAfterSpecialSummon({
    options,
    state,
    player: targetPlayer,
    card: sourceCard,
    action,
    fromZone: "hand",
    sourceCard,
  });
  return;
}

export function applySpecialSummonFromHandWithTieredCost(
  ctx: SimulatedActionHandlerContext<"special_summon_from_hand_with_tiered_cost">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  if (!hasOpenMonsterZone(targetPlayer)) return;
  const sourceCard = options.sourceCard;
  if (!sourceCard || !targetPlayer.hand?.includes(sourceCard)) return;
  if (!canSimSpecialSummon(sourceCard, targetPlayer)) return;
  const minCost = Number.isFinite(action.minCost)
    ? action.minCost as number
    : normalizeCount((action as LegacyTieredCostAction).count, 1).min;
  const maxCost = Number.isFinite(action.maxCost)
    ? action.maxCost as number
    : Math.max(
        minCost,
        normalizeCount((action as LegacyTieredCostAction).count, minCost).max,
      );
  const costFilter =
    action.costFilters || (action as LegacyTieredCostAction).filters || {};
  const costPool = (targetPlayer.field || []).filter((card) =>
    matchesTargetFilters(card, costFilter, sourceCard, "self"),
  );
  if (costPool.length < minCost) return;
  const chosenCosts = chooseRankedCards(
    costPool,
    "cost",
    {
      ...action,
      targetRef: (action as LegacyTieredCostAction).costTargetRef,
    } as SimulatedRankingAction,
    state,
    targetPlayer,
    options,
  ).slice(0, Math.min(maxCost, costPool.length));
  if (chosenCosts.length < minCost) return;
  chosenCosts.forEach((card) => moveCardToZone(targetPlayer, card, "graveyard"));
  removeCardFromZones(targetPlayer, sourceCard);
  applySummonState(
    sourceCard,
    action as SimulatedSummonStateAction,
    state,
    targetPlayer,
    options,
  );
  if (
    Number.isFinite(action.tier1AtkBoost) &&
    chosenCosts.length >= 1
  ) {
    sourceCard.atk = Math.max(
      0,
      (sourceCard.atk || 0) + (action.tier1AtkBoost as number),
    );
    sourceCard.tempAtkBoost =
      (sourceCard.tempAtkBoost || 0) + (action.tier1AtkBoost as number);
  }
  if (chosenCosts.length >= 2) {
    (sourceCard as MutableSummonedCard).cannotBeDestroyedByBattle = true;
    sourceCard._simBattleDestructionProtected = true;
  }
  appendSimulatedFieldCard(targetPlayer.field, sourceCard);
  recordCompletedSimulatedSummon(state, { card: sourceCard, player: targetPlayer, method: "special" });
  options.onAfterSpecialSummon?.({
    state,
    player: targetPlayer,
    card: sourceCard,
    action,
    fromZone: "hand",
    sourceCard,
    costCount: chosenCosts.length,
  });
  emitSimulatedAfterSpecialSummon({
    options,
    state,
    player: targetPlayer,
    card: sourceCard,
    action,
    fromZone: "hand",
    sourceCard,
  });
  return;
}

export function applyBounceAndSummon(
  ctx: SimulatedActionHandlerContext<"bounce_and_summon">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  const sourceCard = options.sourceCard;
  if (!sourceCard || !targetPlayer.field?.includes(sourceCard)) return;
  const bouncesSource = action.bounceSource !== false;
  if (!hasOpenMonsterZone(targetPlayer) && !bouncesSource) return;
  // Position belongs to the arriving monster, not to the hand-card filter.
  const candidates = getActionCandidates(targetPlayer, { filters: action.filters || {} }, "hand", options)
    .filter(card => card !== sourceCard && canSimSpecialSummon(card, targetPlayer));
  const chosen = chooseRankedCards(candidates, "summon", action, state, targetPlayer, options)[0];
  if (!chosen || !candidates.includes(chosen)) return;

  if (bouncesSource) {
    const wasFaceupBeforeMove = sourceCard.isFacedown !== true;
    if (!moveCardToZone(targetPlayer, sourceCard, "hand", targetPlayer, {
      state, movedByEffect: true, sourceCard, sourcePlayer: self,
    })) return;
    options.emitSimulatedEvent?.("card_moved", {
      card: sourceCard,
      player: targetPlayer,
      fromPlayer: targetPlayer,
      toPlayer: targetPlayer,
      fromZone: "field",
      toZone: findCardZone(targetPlayer, sourceCard) || "removed",
      movedByEffect: true,
      wasFaceupBeforeMove,
      sourceCard,
      effectId: options.effect?.id || null,
      actionContext: options.actionContext,
    });
  }
  if (!targetPlayer.hand.includes(chosen) || !moveCardToZone(targetPlayer, chosen, "field", targetPlayer, {
    state, movedByEffect: true, sourceCard, sourcePlayer: self,
  })) return;
  applySummonState(
    chosen,
    action as SimulatedSummonStateAction,
    state,
    targetPlayer,
    options,
  );
  recordCompletedSimulatedSummon(state, { card: chosen, player: targetPlayer, method: "special" });
  options.onAfterSpecialSummon?.({
    state,
    player: targetPlayer,
    card: chosen,
    action,
    fromZone: "hand",
    sourceCard,
  });
  emitSimulatedAfterSpecialSummon({
    options,
    state,
    player: targetPlayer,
    card: chosen,
    action,
    fromZone: "hand",
    sourceCard,
  });
  options.emitSimulatedEvent?.("card_moved", {
    card: chosen, player: targetPlayer, fromZone: "hand", toZone: "field",
    movedByEffect: true, sourceCard, effectId: options.effect?.id || null,
    actionContext: options.actionContext,
  });
  return;
}

export function applyNormalSummonFromHand(ctx: SimulatedActionHandlerContext<"normal_summon_from_hand">): void {
  const { action, state, self, opponent, options } = ctx;
  const player = resolveActionPlayer(action, self, opponent);
  if (!player) return;
  const other = player === self ? opponent : self;
  const entries = player.hand.flatMap(card => {
    if (!matchesTargetFilters(card, action.filters || {}, options.sourceCard, "self")) return [];
    const costs = getNormalSummonTributeOptions(player, card, tributes =>
      tributes.every(tribute => canMoveCardToZone(player, tribute, "graveyard", player, { state })) &&
      canSimulatedProcedureEnterField(card, player, other, tributes));
    return costs.length ? [{ card, costs }] : [];
  }).sort((a, b) => (b.card.atk || 0) - (a.card.atk || 0));
  const entry = entries[0];
  if (!entry) return;
  const tributes = entry.costs.sort((a, b) =>
    a.reduce((sum, c) => sum + (c.atk || 0), 0) - b.reduce((sum, c) => sum + (c.atk || 0), 0) || a.length - b.length)[0];
  if (!tributes) return;
  const events: SimulatedEventOccurrence[] = [];
  for (const tribute of tributes) {
    if (!moveCardToZone(player, tribute, "graveyard", player, { state })) return;
    events.push({ event: "card_to_grave", payload: { card: tribute, player, fromPlayer: player, toPlayer: player,
      fromZone: "field", wasTributed: true, context: "tribute_summon_cost" } });
  }
  const card = entry.card;
  if (!moveCardToZone(player, card, "field", player, { state })) return;
  card.position = "attack";
  card.isFacedown = false;
  card.hasAttacked = false;
  card.attacksUsedThisTurn = 0;
  card.lastSummonMethod = tributes.length ? "tribute" : "normal";
  card.lastSummonedFromZone = "hand";
  player.summonCount = (player.summonCount || 0) + 1;
  recordNormalSummonForTurn(player, card);
  recordCompletedSimulatedSummon(state, { card, player, method: card.lastSummonMethod });
  card.lastTributeMaterialNames = tributes.map(tribute => tribute.name || "");
  card.lastTributeMaterialCount = tributes.length;
  if (!options.enableSimulatedEvents) {
    options.onAfterNormalSummon?.({ state, player, card, method: card.lastSummonMethod });
  }
  events.push({ event: "after_summon", payload: { card, player, method: card.lastSummonMethod, fromZone: "hand", tributes } });
  if (options.emitSimulatedEvents) options.emitSimulatedEvents(events);
  else for (const event of events) options.emitSimulatedEvent?.(event.event, event.payload);
}

export function applySpecialSummonToken(
  ctx: SimulatedActionHandlerContext<"special_summon_token">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  if ((targetPlayer.field || []).length >= 5) return;
  const token = action.token || { name: "Token", atk: 0, def: 0 };
  const tokenCard = {
    ...token,
    cardKind: "monster",
    isToken: true,
  } as SimulatedCardState;
  if (!canSimSpecialSummon(tokenCard, targetPlayer)) return;
  const summonedToken: SimulatedCardState = {
    ...tokenCard,
    cardKind: "monster",
    isToken: true,
    cannotAttackThisTurn: action.cannotAttackThisTurn === true,
    owner: targetPlayer.id,
    controller: targetPlayer.id,
  };
  const occupiedIds = new Set([state.bot, state.player].flatMap(player =>
    ["field", "hand", "deck", "extraDeck", "graveyard", "banished", "spellTrap", "fieldSpell"]
      .flatMap(zone => getZoneCards(player, zone).map(card => card.instanceId))));
  do {
    state._simGeneratedInstanceCounter = (state._simGeneratedInstanceCounter || 0) + 1;
    summonedToken.instanceId = `sim:token:${state._simGeneratedInstanceCounter}`;
  } while (occupiedIds.has(summonedToken.instanceId));
  applySummonState(
    summonedToken,
    action as SimulatedSummonStateAction,
    state,
    targetPlayer,
    options,
  );
  appendSimulatedFieldCard(targetPlayer.field, summonedToken);
  recordCompletedSimulatedSummon(state, { card: summonedToken, player: targetPlayer, method: "special" });
  emitSimulatedAfterSpecialSummon({
    options,
    state,
    player: targetPlayer,
    card: summonedToken,
    action,
    fromZone: "token",
    sourceCard: options.sourceCard,
  });
  return;
}

export function applyConditionalSummonFromHand(
  ctx: SimulatedActionHandlerContext<"conditional_summon_from_hand">,
): void {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  if ((targetPlayer.field || []).length >= 5) return;
  if (
    action.condition &&
    !evaluateSimulatedConditions(action.condition, { state, selfId, options })
  ) return;
  const chosen = targets[0];
  if (chosen && canSimSpecialSummon(chosen, targetPlayer)) {
    removeCardFromZones(targetPlayer, chosen);
    applySummonState(
      chosen,
      action as SimulatedSummonStateAction,
      state,
      targetPlayer,
      options,
    );
    appendSimulatedFieldCard(targetPlayer.field, chosen);
    recordCompletedSimulatedSummon(state, { card: chosen, player: targetPlayer, method: "special" });
    emitSimulatedAfterSpecialSummon({
      options,
      state,
      player: targetPlayer,
      card: chosen,
      action,
      fromZone: "hand",
      sourceCard: options.sourceCard,
    });
  }
  return;
}

export function applyPolymerizationFusionSummon(
  ctx: SimulatedActionHandlerContext<"polymerization_fusion_summon">,
) {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options: suppliedOptions,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  const options = attachSimulatedEventEmitter(state, { ...suppliedOptions, enableSimulatedEvents: true });
  const targetPlayer = resolveActionPlayer(action, self, opponent);
  const otherPlayer = targetPlayer === self ? opponent : self;
  const materialPool = rankCandidates([
    ...(targetPlayer.field || []),
    ...(targetPlayer.hand || []),
  ].filter((card) => card?.cardKind === "monster"), "cost", {
      ...options,
      fieldSpell: targetPlayer.fieldSpell,
      targetPreference: mergeCostPreference(
        getTargetPreference(
          options,
          (action as LegacyPolymerizationAction).targetRef ||
            (action as LegacyPolymerizationAction).id,
        ),
        getCostPreference(options),
      ),
    });
  const canPayMaterials = (
    fusionCard: SimulatedCardState,
  ): SimulatedCardState[] | null => {
    const requirements = fusionCard.fusionMaterials || [];
    if (requirements.length === 0 || fusionCard.extraDeckSummonProcedure) return null;
    const slots = requirements.flatMap(requirement =>
      Array.from({ length: requirement.count || 1 }, () => requirement));
    if (slots.length === 0 || slots.length > materialPool.length) return null;
    const candidatesBySlot = slots.map(requirement => materialPool.filter(candidate => {
      const zone = findCardZone(targetPlayer, candidate);
      return (zone === "hand" || zone === "field") &&
        (!requirement.allowedZones || requirement.allowedZones.includes(zone)) &&
        matchesTargetFilters(candidate, requirement, fusionCard, "self") &&
        canMoveCardToZone(targetPlayer, candidate, "graveyard", targetPlayer, { state });
    }));
    if (candidatesBySlot.some(candidates => candidates.length === 0)) return null;
    // Even removing every eligible material must leave a legal destination.
    if (!canSimulatedProcedureEnterField(fusionCard, targetPlayer, otherPlayer,
      candidatesBySlot.flat())) return null;
    const picked: SimulatedCardState[] = [];
    // Preserve cost ranking, but backtrack until every requirement and the
    // destination are legal together (a cheap hand-only combo may leave no room).
    const search = (index: number): SimulatedCardState[] | null => {
      const requirement = slots[index];
      if (!requirement) {
        return canSimulatedProcedureEnterField(fusionCard, targetPlayer, otherPlayer, picked)
          ? [...picked] : null;
      }
      const candidates = candidatesBySlot[index] || [];
      const previous = picked[index - 1];
      // Slots expanded from one count requirement are interchangeable.
      const start = previous && slots[index - 1] === requirement
        ? candidates.indexOf(previous) + 1 : 0;
      for (const candidate of candidates.slice(start)) {
        if (picked.includes(candidate)) continue;
        picked.push(candidate);
        const combo = search(index + 1);
        if (combo) return combo;
        picked.pop();
      }
      return null;
    };
    return search(0);
  };
  const fusionEntries = (targetPlayer.extraDeck || [])
    .filter((card) => card?.monsterType === "fusion")
    .filter((card) => canSimSpecialSummon(card, targetPlayer, "fusion"))
    .map((fusionCard) => ({
      fusionCard,
      materials: canPayMaterials(fusionCard),
    }))
    .filter(
      (entry): entry is {
        fusionCard: SimulatedCardState;
        materials: SimulatedCardState[];
      } => Array.isArray(entry.materials),
    );
  if (fusionEntries.length === 0) return;
  const hint = (options.sourceAction as LegacyFusionSourceAction | null)
    ?.fusionTargetHint;
  fusionEntries.sort((a, b) => {
    if (hint) {
      if (a.fusionCard.name === hint) return -1;
      if (b.fusionCard.name === hint) return 1;
    }
    return estimateMonsterValue(b.fusionCard) - estimateMonsterValue(a.fusionCard);
  });
  const fusionEntry = fusionEntries[0];
  if (!fusionEntry) return;
  const { fusionCard, materials } = fusionEntry;
  const frame = createDeferredSimulatedEventFrame(state, { ...options, enableSimulatedEvents: true });
  const eventOptions = frame.options;
  const materialOptions: SimulatedActionOptions = { ...eventOptions, sourceCard: null };
  try {
  const hasFieldToGraveTrigger = (card: SimulatedCardState) => targetPlayer.field.includes(card) &&
    card.effects?.some(effect => effect.timing === "on_event" && effect.event === "card_to_grave" &&
      (!effect.fromZone || effect.fromZone === "any" || effect.fromZone === "field")) === true;
  const materialSendOrder = [...materials].sort((a, b) => Number(hasFieldToGraveTrigger(a)) - Number(hasFieldToGraveTrigger(b)));
  for (const material of materialSendOrder) {
    const fromZone = findCardZone(targetPlayer, material);
    if (fromZone !== "hand" && fromZone !== "field") return;
    const wasFaceupBeforeMove = material.isFacedown !== true;
    const effectsNegatedAtFieldExit = fromZone === "field" && material.effectsNegated === true;
    const destination = fromZone === "field" ? getOriginalOwner(state, material, targetPlayer) : targetPlayer;
    const receipt: { value: SimulatedMoveReceipt | null } = { value: null };
    if (!moveCardToZone(destination, material, "graveyard", targetPlayer, { state,
      ...(eventOptions.emitSimulatedEvent ? { emitSimulatedEvent: eventOptions.emitSimulatedEvent } : {}),
      onMoveCommitted: result => { receipt.value = result; } })) return;
    emitSimulatedMove(material, state, targetPlayer, destination, fromZone, wasFaceupBeforeMove,
      effectsNegatedAtFieldExit, materialOptions, "fusion_material", false, receipt.value);
  }
  if (!canSimSpecialSummon(fusionCard, targetPlayer, "fusion") ||
      !canSimulatedProcedureEnterField(fusionCard, targetPlayer, otherPlayer, []) ||
      !canMoveCardToZone(targetPlayer, fusionCard, "field", targetPlayer, { state })) return;
  const receipt: { value: SimulatedMoveReceipt | null } = { value: null };
  if (!moveCardToZone(targetPlayer, fusionCard, "field", targetPlayer, { state,
    onMoveCommitted: result => { receipt.value = result; } })) return;
  applySummonState(
    fusionCard,
    {
      ...action,
      position: (action as LegacyPolymerizationAction).position || "choice",
    },
    state,
    targetPlayer,
    options,
  );
  (fusionCard as MutableSummonedCard).summonMethod = "fusion";
  fusionCard.lastSummonMethod = "fusion";
  fusionCard.lastSummonedFromZone = "extraDeck";
  (fusionCard as MutableSummonedCard).summonProcedure = "fusion";
  establishProperSummon(fusionCard, { summonProcedure: "fusion", sourceZone: "extraDeck" });
  recordCompletedSimulatedSummon(state, { card: fusionCard, player: targetPlayer, method: "fusion" });
  eventOptions.emitSimulatedEvent?.("after_summon", {
    card: fusionCard, player: targetPlayer, opponent: otherPlayer,
    method: "fusion", summonProcedure: "fusion", fromZone: "extraDeck", position: fusionCard.position,
    sourceCard: null, source: null, actionContext: options.actionContext,
  });
  emitSimulatedMove(fusionCard, state, targetPlayer, targetPlayer, "extraDeck", true, false,
    { ...eventOptions, sourceCard: null }, "fusion_summon", false, receipt.value);
  // Fusion is an effect resolution. Its observed occurrences enter one SEGOC
  // group after placement, preserving the dispatcher's mandatory/optional LIFO.
  frame.finishResolution();
  options.onFusionSummon?.({
    state,
    player: targetPlayer,
    fusionCard,
    materials,
    action,
    sourceCard: options.sourceCard,
  });
  return;
  } finally {
    frame.finishResolution();
  }
}
