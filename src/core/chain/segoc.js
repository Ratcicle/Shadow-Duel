/**
 * Canonical simultaneous Trigger Effect (SEGOC) coordinator.
 *
 * Event producers register atomic occurrences. At the next legal Trigger
 * opportunity, candidates are collected again, revalidated, split into the
 * four official groups and prepared as one ordered Chain before Fast Effects.
 */

import { isAI } from "../Player.js";

export const TRIGGER_REQUIREMENTS = Object.freeze({
  MANDATORY: "mandatory",
  OPTIONAL: "optional",
});

export const TRIGGER_TIMINGS = Object.freeze({
  IF: "if",
  WHEN: "when",
});

export const SEGOC_GROUPS = Object.freeze({
  TURN_MANDATORY: "turn_player_mandatory",
  OPPONENT_MANDATORY: "opponent_mandatory",
  TURN_OPTIONAL: "turn_player_optional",
  OPPONENT_OPTIONAL: "opponent_optional",
});

const SEGOC_GROUP_ORDER = Object.freeze([
  SEGOC_GROUPS.TURN_MANDATORY,
  SEGOC_GROUPS.OPPONENT_MANDATORY,
  SEGOC_GROUPS.TURN_OPTIONAL,
  SEGOC_GROUPS.OPPONENT_OPTIONAL,
]);

const VALID_REQUIREMENTS = new Set(Object.values(TRIGGER_REQUIREMENTS));
const VALID_TIMINGS = new Set(Object.values(TRIGGER_TIMINGS));

function numericId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function nextId(chainSystem, field) {
  if (!Number.isInteger(chainSystem[field]) || chainSystem[field] < 1) {
    chainSystem[field] = 1;
  }
  return chainSystem[field]++;
}

function playerId(player) {
  return player?.id ?? null;
}

function cardInstanceId(card) {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uuid ??
    card?.simInstanceId ??
    card?.id ??
    card?.name ??
    null
  );
}

function compactSerializable(value, seen = new WeakSet(), depth = 0) {
  if (value == null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (depth > 4) return null;
  if (Array.isArray(value)) {
    return value
      .map((entry) => compactSerializable(entry, seen, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return undefined;

  const looksLikePlayer =
    typeof value.id === "string" &&
    (value.controllerType != null || value.lp != null || Array.isArray(value.hand));
  if (looksLikePlayer) {
    return { id: value.id, name: value.name || null };
  }
  const looksLikeCard =
    value.cardKind != null ||
    value.instanceId != null ||
    (value.name != null && value.owner != null);
  if (looksLikeCard) {
    return {
      id: value.id ?? null,
      instanceId: cardInstanceId(value),
      name: value.name || null,
      owner: value.owner ?? null,
      controller: value.controller ?? value.owner ?? null,
      locationVersion: Number(value.locationVersion || 0),
    };
  }

  seen.add(value);
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    const compact = compactSerializable(entry, seen, depth + 1);
    if (compact !== undefined) output[key] = compact;
  }
  seen.delete(value);
  return output;
}

function serializeOccurrence(occurrence) {
  if (!occurrence) return null;
  return {
    occurrenceId: occurrence.occurrenceId ?? null,
    atomicGroupId: occurrence.atomicGroupId ?? null,
    eventName: occurrence.eventName || null,
    sequence: occurrence.sequence ?? null,
    turnCounter: occurrence.turnCounter ?? null,
    phase: occurrence.phase || null,
    chainId: occurrence.chainId ?? null,
    resolvingLinkId: occurrence.resolvingLinkId ?? null,
    snapshot: occurrence.snapshot ? compactSerializable(occurrence.snapshot) : null,
  };
}

function serializeCandidate(candidate) {
  if (!candidate) return null;
  return {
    candidateId: candidate.candidateId ?? null,
    occurrenceId: candidate.occurrenceId ?? null,
    atomicGroupId: candidate.atomicGroupId ?? null,
    eventName: candidate.eventName || null,
    controllerId: playerId(candidate.controller),
    cardId: candidate.card?.id ?? null,
    cardInstanceId: cardInstanceId(candidate.card),
    cardName: candidate.card?.name || null,
    effectId: candidate.effect?.id || null,
    triggerRequirement: candidate.triggerRequirement || null,
    triggerTiming: candidate.triggerTiming || null,
    segocGroup: candidate.segocGroup || null,
    eligibilityStatus: candidate.eligibilityStatus || null,
    rejectionReason: candidate.rejectionReason || null,
  };
}

function serializeGroups(groups = {}) {
  return Object.fromEntries(
    SEGOC_GROUP_ORDER.map((group) => [
      group,
      (groups[group] || []).map(serializeCandidate).filter(Boolean),
    ]),
  );
}

export function allocateAtomicEventGroupId(providedId = null) {
  const provided = numericId(providedId);
  if (provided != null) {
    if (!Number.isInteger(this.nextAtomicEventGroupId)) {
      this.nextAtomicEventGroupId = 1;
    }
    this.nextAtomicEventGroupId = Math.max(
      this.nextAtomicEventGroupId,
      provided + 1,
    );
    return provided;
  }
  return nextId(this, "nextAtomicEventGroupId");
}

export function createTriggerOccurrence(eventName, payload = {}, options = {}) {
  if (!eventName) return null;
  const atomicGroupId = this.allocateAtomicEventGroupId(
    options.atomicGroupId ?? payload?.atomicGroupId ?? null,
  );
  const occurrence = {
    occurrenceId: nextId(this, "nextTriggerOccurrenceId"),
    atomicGroupId,
    eventName,
    sequence: Number(options.sequence ?? this.game?.eventResolutionCounter ?? 0),
    turnCounter: Number(this.game?.turnCounter ?? 0),
    phase: this.game?.phase || null,
    chainId: this.activeChainId ?? null,
    resolvingLinkId: this.currentResolvingLink?.linkId ?? null,
    payload: payload || {},
    snapshot: compactSerializable(payload || {}),
    entries: Array.isArray(options.entries) ? options.entries : null,
    entriesProvided: options.entriesProvided === true,
    orderRule: options.orderRule || null,
    onComplete:
      typeof options.onComplete === "function" ? options.onComplete : null,
  };
  this.game?.notify?.("trigger_occurrence_queued", serializeOccurrence(occurrence));
  return occurrence;
}

export function queueTriggerOccurrence(occurrence) {
  if (!occurrence?.eventName) {
    return { ok: false, deferred: false, reason: "missing_event" };
  }
  if (!Array.isArray(this.pendingTriggerOccurrences)) {
    this.pendingTriggerOccurrences = [];
  }
  this.pendingTriggerOccurrences.push(occurrence);
  return {
    ok: true,
    deferred: true,
    eventName: occurrence.eventName,
    occurrenceId: occurrence.occurrenceId,
    pendingCount: this.pendingTriggerOccurrences.length,
    triggerCount: Array.isArray(occurrence.entries)
      ? occurrence.entries.length
      : 0,
    results: [],
  };
}

export function buildTriggerOpportunity(occurrences = []) {
  const orderedOccurrences = (occurrences || [])
    .filter((entry) => entry?.eventName)
    .slice()
    .sort((a, b) => a.occurrenceId - b.occurrenceId);
  if (orderedOccurrences.length === 0) return null;
  const opportunity = {
    opportunityId: nextId(this, "nextTriggerOpportunityId"),
    occurrences: orderedOccurrences,
    occurrenceIds: orderedOccurrences.map((entry) => entry.occurrenceId),
    lastRelevantAtomicGroupId:
      orderedOccurrences[orderedOccurrences.length - 1]?.atomicGroupId ?? null,
    turnPlayer: this.getCurrentTurnPlayer?.() || null,
    groups: Object.fromEntries(SEGOC_GROUP_ORDER.map((group) => [group, []])),
    candidates: [],
    selectedCandidates: [],
    declinedCandidates: [],
    rejectedCandidates: [],
    selecting: false,
  };
  this.activeTriggerOpportunity = opportunity;
  this.game?.notify?.("trigger_opportunity_opened", {
    opportunityId: opportunity.opportunityId,
    occurrenceIds: opportunity.occurrenceIds.slice(),
    lastRelevantAtomicGroupId: opportunity.lastRelevantAtomicGroupId,
    turnPlayerId: playerId(opportunity.turnPlayer),
  });
  return opportunity;
}

function candidateGroup(candidate, turnPlayer) {
  const isTurnPlayer = candidate.controller === turnPlayer;
  const mandatory =
    candidate.triggerRequirement === TRIGGER_REQUIREMENTS.MANDATORY;
  if (isTurnPlayer && mandatory) return SEGOC_GROUPS.TURN_MANDATORY;
  if (!isTurnPlayer && mandatory) return SEGOC_GROUPS.OPPONENT_MANDATORY;
  if (isTurnPlayer) return SEGOC_GROUPS.TURN_OPTIONAL;
  return SEGOC_GROUPS.OPPONENT_OPTIONAL;
}

function sourceSnapshot(entry) {
  return (
    entry?.sourceAtTrigger ||
    entry?.config?.activationContext?.sourceAtTrigger ||
    entry?.config?.sourceAtTrigger ||
    null
  );
}

function stableCardKey(card) {
  return [cardInstanceId(card), card?.owner ?? null, card?.name ?? null].join(":");
}

function currentSourceZone(chainSystem, candidate) {
  return chainSystem.determineCardZone?.(candidate.card, candidate.controller) || null;
}

export function revalidateTriggerCandidate(candidate, opportunity) {
  if (!candidate?.card || !candidate?.effect || !candidate?.controller) {
    return { ok: false, reason: "invalid_trigger_candidate" };
  }
  if (!VALID_REQUIREMENTS.has(candidate.triggerRequirement)) {
    return { ok: false, reason: "invalid_trigger_requirement" };
  }
  if (!VALID_TIMINGS.has(candidate.triggerTiming)) {
    return { ok: false, reason: "invalid_trigger_timing" };
  }
  if (
    candidate.triggerRequirement === TRIGGER_REQUIREMENTS.OPTIONAL &&
    candidate.triggerTiming === TRIGGER_TIMINGS.WHEN &&
    candidate.atomicGroupId !== opportunity.lastRelevantAtomicGroupId
  ) {
    return { ok: false, reason: "optional_when_missed_timing" };
  }

  const snapshot = candidate.sourceAtTrigger;
  if (snapshot && snapshot.zone !== "temporary") {
    const currentVersion = Number(candidate.card?.locationVersion || 0);
    if (currentVersion !== Number(snapshot.locationVersion || 0)) {
      return { ok: false, reason: "source_location_changed" };
    }
    const currentZone = currentSourceZone(this, candidate);
    if (snapshot.zone && currentZone !== snapshot.zone) {
      return { ok: false, reason: "source_zone_changed" };
    }
    if (snapshot.faceUp === true && candidate.card?.isFacedown === true) {
      return { ok: false, reason: "source_no_longer_face_up" };
    }
    const currentControllerId =
      candidate.card?.controller ?? candidate.card?.owner ?? candidate.controller?.id;
    if (
      snapshot.controllerId != null &&
      currentControllerId != null &&
      snapshot.controllerId !== currentControllerId
    ) {
      return { ok: false, reason: "source_controller_changed" };
    }
  }

  const restriction = this.game?.canActivateCardEffectUnderRestrictions?.(
    candidate.card,
    candidate.controller,
    candidate.effect,
    { silent: true },
  );
  if (restriction?.ok === false) {
    return { ok: false, reason: restriction.code || "activation_restricted" };
  }
  return { ok: true };
}

export async function collectTriggerCandidates(opportunity) {
  if (!opportunity) return [];
  const candidates = [];
  const dedupe = new Set();
  let collectorOrder = 0;

  for (const occurrence of opportunity.occurrences) {
    let triggerPackage = null;
    if (occurrence.entriesProvided) {
      triggerPackage = {
        entries: occurrence.entries || [],
        orderRule: occurrence.orderRule || null,
        onComplete: occurrence.onComplete || null,
      };
    } else if (typeof this.game?.effectEngine?.collectEventTriggers === "function") {
      triggerPackage = await this.game.effectEngine.collectEventTriggers(
        occurrence.eventName,
        occurrence.payload || {},
      );
    }
    const entries = Array.isArray(triggerPackage)
      ? triggerPackage
      : Array.isArray(triggerPackage?.entries)
        ? triggerPackage.entries
        : [];
    occurrence.orderRule = triggerPackage?.orderRule || occurrence.orderRule || null;
    occurrence.onComplete =
      typeof triggerPackage?.onComplete === "function"
        ? triggerPackage.onComplete
        : occurrence.onComplete;

    for (const [effectOrder, entry] of entries.entries()) {
      const card = entry?.card || entry?.config?.card || null;
      const effect = entry?.effect || entry?.config?.effect || null;
      const controller = entry?.owner || entry?.config?.owner || null;
      if (!card || !effect || !controller) continue;
      const triggerRequirement = effect.triggerRequirement;
      const triggerTiming = effect.triggerTiming;
      const key = [
        occurrence.atomicGroupId,
        stableCardKey(card),
        effect.id || effectOrder,
      ].join("|");
      if (dedupe.has(key)) continue;
      dedupe.add(key);

      const candidate = {
        candidateId: nextId(this, "nextTriggerCandidateId"),
        occurrenceId: occurrence.occurrenceId,
        atomicGroupId: occurrence.atomicGroupId,
        eventName: occurrence.eventName,
        eventSnapshot: occurrence.snapshot,
        card,
        effect,
        controller,
        opponent: this.getOpponent?.(controller) || null,
        triggerRequirement,
        triggerTiming,
        sourceAtTrigger: sourceSnapshot(entry),
        collectorOrder: collectorOrder++,
        sourceOrder: effectOrder,
        effectOrder,
        config: entry?.config || entry?.pipeline || entry,
        summary: entry?.summary || `${controller.id}:${card.name}:${effect.id}`,
        eligibilityStatus: "pending",
        rejectionReason: null,
      };
      const eligibility = this.revalidateTriggerCandidate(candidate, opportunity);
      if (!eligibility.ok) {
        candidate.eligibilityStatus = "rejected";
        candidate.rejectionReason = eligibility.reason;
        opportunity.rejectedCandidates.push(candidate);
        this.game?.notify?.("trigger_candidate_rejected", {
          opportunityId: opportunity.opportunityId,
          ...serializeCandidate(candidate),
        });
        continue;
      }
      candidate.eligibilityStatus = "eligible";
      candidate.segocGroup = candidateGroup(candidate, opportunity.turnPlayer);
      candidates.push(candidate);
      opportunity.groups[candidate.segocGroup].push(candidate);
    }
  }
  opportunity.candidates = candidates;
  return candidates;
}

function stableCandidateOrder(candidates) {
  return candidates.slice().sort((a, b) =>
    a.collectorOrder - b.collectorOrder ||
    a.occurrenceId - b.occurrenceId ||
    a.sourceOrder - b.sourceOrder ||
    a.effectOrder - b.effectOrder ||
    a.candidateId - b.candidateId,
  );
}

function normalizeHumanDecision(decision, candidates, optional) {
  const raw = Array.isArray(decision)
    ? decision
    : Array.isArray(decision?.orderedCandidateIds)
      ? decision.orderedCandidateIds
      : Array.isArray(decision?.candidates)
        ? decision.candidates
        : [];
  const byId = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const selected = [];
  const used = new Set();
  for (const entry of raw) {
    const id = typeof entry === "object" ? entry?.candidateId : entry;
    const candidate = byId.get(Number(id));
    if (!candidate || used.has(candidate.candidateId)) continue;
    used.add(candidate.candidateId);
    selected.push(candidate);
  }
  if (!optional && selected.length !== candidates.length) {
    return { ok: false, reason: "mandatory_trigger_order_incomplete" };
  }
  return { ok: true, candidates: selected };
}

async function requestHumanOrder(chainSystem, candidates, group, optional) {
  const showModal = chainSystem.getUI?.()?.showTriggerOrderModal;
  if (typeof showModal !== "function") {
    return {
      ok: false,
      needsSelection: true,
      reason: "trigger_order_ui_unavailable",
      selectionContract: {
        kind: "trigger_order",
        group,
        optional,
        candidates: candidates.map(serializeCandidate),
      },
    };
  }

  let callbackResolved = false;
  let resolveCallback;
  const callbackResult = new Promise((resolve) => {
    resolveCallback = resolve;
  });
  const finish = (value) => {
    if (callbackResolved) return;
    callbackResolved = true;
    resolveCallback(value);
  };
  const options = {
    group,
    optional,
    candidates,
    onConfirm: (ordered) => finish(ordered),
    onCancel: () => finish(optional ? [] : null),
  };
  const resolveHuman = async () => {
    const returned = showModal.call(chainSystem.getUI(), options);
    if (returned && typeof returned.then === "function") {
      returned.then(finish, () => finish(optional ? [] : null));
    } else if (returned !== undefined) {
      finish(returned);
    }
    return callbackResult;
  };
  const decision = typeof chainSystem.game?.requestDecision === "function"
    ? await chainSystem.game.requestDecision({
        kind: "segoc_order",
        actor: candidates[0]?.controller || null,
        candidates,
        contextSnapshot: { group, optional },
        resolveHuman,
      })
    : await resolveHuman();
  if (decision == null && !optional) {
    return { ok: false, reason: "mandatory_trigger_order_cancelled" };
  }
  return normalizeHumanDecision(decision, candidates, optional);
}

export async function orderTriggerCandidates(candidates = [], options = {}) {
  const ordered = stableCandidateOrder(candidates);
  if (ordered.length === 0) return { ok: true, candidates: [] };
  const group = options.group || ordered[0]?.segocGroup || null;
  const optional =
    options.optional === true ||
    ordered[0]?.triggerRequirement === TRIGGER_REQUIREMENTS.OPTIONAL;
  const controller = ordered[0]?.controller || null;

  if (!controller || isAI(controller)) {
    const resolveAI = () =>
      this.game?.autoSelector?.orderTriggerCandidates?.(
        ordered,
        { group, optional },
      ) || ordered;
    const aiOrdered = controller && typeof this.game?.requestDecision === "function"
      ? await this.game.requestDecision({
          kind: "segoc_order",
          actor: controller,
          candidates: ordered,
          contextSnapshot: { group, optional },
          resolveAI,
        })
      : resolveAI();
    return {
      ok: true,
      candidates: Array.isArray(aiOrdered) ? aiOrdered : ordered,
    };
  }
  if (!optional && ordered.length === 1) {
    return { ok: true, candidates: ordered };
  }
  this.activeTriggerOpportunity.selecting = true;
  try {
    return await requestHumanOrder(this, ordered, group, optional);
  } finally {
    if (this.activeTriggerOpportunity) {
      this.activeTriggerOpportunity.selecting = false;
    }
  }
}

export async function prepareTriggerOpportunity(opportunity) {
  if (!opportunity) {
    return { ok: true, preparedActivations: [], selectedCandidates: [] };
  }
  const selected = [];
  for (const group of SEGOC_GROUP_ORDER) {
    const groupCandidates = opportunity.groups[group] || [];
    const optional = group.endsWith("_optional");
    const decision = await this.orderTriggerCandidates(groupCandidates, {
      group,
      optional,
    });
    if (decision?.needsSelection) return decision;
    if (decision?.ok === false) return decision;
    const chosen = decision?.candidates || [];
    selected.push(...chosen);
    if (optional) {
      const chosenIds = new Set(chosen.map((candidate) => candidate.candidateId));
      opportunity.declinedCandidates.push(
        ...groupCandidates.filter(
          (candidate) => !chosenIds.has(candidate.candidateId),
        ),
      );
    }
    this.game?.notify?.("segoc_order_selected", {
      opportunityId: opportunity.opportunityId,
      group,
      optional,
      orderedCandidateIds: chosen.map((candidate) => candidate.candidateId),
    });
  }

  const preparedActivations = [];
  const preparedCandidates = [];
  for (const [segocOrder, candidate] of selected.entries()) {
    const liveEligibility = this.revalidateTriggerCandidate(candidate, opportunity);
    if (!liveEligibility.ok) {
      candidate.eligibilityStatus = "rejected";
      candidate.rejectionReason = liveEligibility.reason;
      opportunity.rejectedCandidates.push(candidate);
      this.game?.notify?.("trigger_candidate_rejected", {
        opportunityId: opportunity.opportunityId,
        ...serializeCandidate(candidate),
      });
      continue;
    }
    const config = candidate.config;
    if (!config || typeof config.activate !== "function") continue;
    const preparation = await this.game?.runActivationPipelineWait?.({
      ...config,
      activationContext: {
        ...(config.activationContext || {}),
        confirmed: true,
        triggeredByEvent: candidate.eventName,
        triggerOpportunityId: opportunity.opportunityId,
        triggerOccurrenceId: candidate.occurrenceId,
        atomicGroupId: candidate.atomicGroupId,
      },
      prepareForExistingChain: true,
      allowDuringChainWindow: true,
      allowDuringResolving: true,
      allowDuringOpponentTurn: true,
    });
    if (!preparation?.success || !preparation.preparedActivation) {
      candidate.eligibilityStatus = "rejected";
      candidate.rejectionReason =
        preparation?.reason || "trigger_preparation_failed";
      opportunity.rejectedCandidates.push(candidate);
      this.game?.notify?.("trigger_candidate_rejected", {
        opportunityId: opportunity.opportunityId,
        ...serializeCandidate(candidate),
      });
      continue;
    }
    const prepared = preparation.preparedActivation;
    Object.assign(prepared, {
      triggerOpportunityId: opportunity.opportunityId,
      triggerOccurrenceId: candidate.occurrenceId,
      atomicGroupId: candidate.atomicGroupId,
      segocGroup: candidate.segocGroup,
      segocOrder: segocOrder + 1,
    });
    prepared.context = {
      ...(prepared.context || {}),
      ...(candidate.eventSnapshot || {}),
      type: candidate.eventName,
      event: candidate.eventName,
      player: candidate.controller,
      controller: candidate.controller,
      triggerPlayer: candidate.controller,
      triggerOpportunityId: opportunity.opportunityId,
      triggerOccurrenceId: candidate.occurrenceId,
      atomicGroupId: candidate.atomicGroupId,
      segocGroup: candidate.segocGroup,
      segocOrder: segocOrder + 1,
    };
    preparedActivations.push(prepared);
    preparedCandidates.push(candidate);
  }
  opportunity.selectedCandidates = preparedCandidates;
  return { ok: true, preparedActivations, selectedCandidates: preparedCandidates };
}

async function completeOccurrences(occurrences) {
  for (const occurrence of occurrences || []) {
    if (typeof occurrence?.onComplete !== "function") continue;
    try {
      await occurrence.onComplete();
    } catch (error) {
      console.error("[ChainSystem] Trigger occurrence completion failed:", error);
    }
  }
}

export async function prepareTriggerPackages(packages = []) {
  const occurrences = [];
  for (const entryPackage of packages || []) {
    if (!entryPackage?.eventName) continue;
    const occurrence =
      entryPackage.occurrence ||
      this.createTriggerOccurrence(
        entryPackage.eventName,
        entryPackage.payload || {},
        {
          entries: entryPackage.entries || [],
          entriesProvided: true,
          orderRule: entryPackage.orderRule || null,
          onComplete: entryPackage.onComplete || null,
          atomicGroupId: entryPackage.atomicGroupId || null,
        },
      );
    if (occurrence) occurrences.push(occurrence);
  }
  const opportunity = this.buildTriggerOpportunity(occurrences);
  if (!opportunity) return { ok: true, preparedActivations: [], opportunity: null };
  await this.collectTriggerCandidates(opportunity);
  const preparation = await this.prepareTriggerOpportunity(opportunity);
  return { ...preparation, opportunity, occurrences };
}

export async function resolveTriggerOccurrences(occurrences = [], options = {}) {
  const opportunity = this.buildTriggerOpportunity(occurrences);
  if (!opportunity) {
    return { ok: true, success: true, chainBuilt: false, triggerCount: 0 };
  }
  try {
    await this.collectTriggerCandidates(opportunity);
    const preparation = await this.prepareTriggerOpportunity(opportunity);
    if (preparation?.needsSelection) {
      this.pendingTriggerSelection = { opportunity };
      return {
        ...preparation,
        triggerCount: opportunity.candidates.length,
        opportunityId: opportunity.opportunityId,
      };
    }
    if (preparation?.ok === false) {
      this.pendingTriggerSelection = null;
      this.activeTriggerOpportunity = null;
      return {
        ...preparation,
        triggerCount: opportunity.candidates.length,
        opportunityId: opportunity.opportunityId,
      };
    }
    this.pendingTriggerSelection = null;
    const preparedActivations = preparation.preparedActivations || [];
    this.game?.notify?.("trigger_chain_prepared", {
      opportunityId: opportunity.opportunityId,
      occurrenceIds: opportunity.occurrenceIds.slice(),
      preparedCount: preparedActivations.length,
      candidates: preparation.selectedCandidates.map(serializeCandidate),
    });

    let timingResult = {
      ok: true,
      success: true,
      chainBuilt: false,
      needsSelection: false,
    };
    if (preparedActivations.length > 0) {
      const actionPlayer =
        options.actionPlayer ||
        preparation.selectedCandidates[0]?.controller ||
        opportunity.turnPlayer;
      timingResult = await this.runFastEffectTiming({
        origin: "trigger_chain",
        actionPlayer,
        preparedActivations,
        context: {
          ...(options.context || {}),
          type: options.context?.type || "trigger_chain",
          event: options.context?.event || "trigger_chain",
          triggerOpportunityId: opportunity.opportunityId,
        },
        deferPostChainWindow: options.deferPostChainWindow === true,
      });
    }
    await completeOccurrences(opportunity.occurrences);
    this.activeTriggerOpportunity = null;
    return {
      ...timingResult,
      triggerCount: opportunity.candidates.length,
      selectedTriggerCount: preparedActivations.length,
      opportunityId: opportunity.opportunityId,
    };
  } catch (error) {
    this.pendingTriggerSelection = null;
    this.activeTriggerOpportunity = null;
    return {
      ok: false,
      success: false,
      chainBuilt: false,
      needsSelection: false,
      triggerCount: opportunity.candidates.length,
      opportunityId: opportunity.opportunityId,
      reason: error?.message || "trigger_opportunity_failed",
    };
  }
}

export function getTriggerState() {
  const opportunity = this.activeTriggerOpportunity || null;
  return {
    opportunityId: opportunity?.opportunityId ?? null,
    pendingOccurrenceCount: Array.isArray(this.pendingTriggerOccurrences)
      ? this.pendingTriggerOccurrences.length
      : 0,
    selecting:
      opportunity?.selecting === true || this.pendingTriggerSelection != null,
    occurrenceIds: opportunity?.occurrenceIds?.slice() || [],
    groups: serializeGroups(opportunity?.groups || {}),
  };
}

export function resetTriggerState({ clearPending = true } = {}) {
  this.activeTriggerOpportunity = null;
  this.pendingTriggerSelection = null;
  if (clearPending) this.pendingTriggerOccurrences = [];
  this._flushingPendingTriggerOccurrences = false;
  return this.getTriggerState();
}
