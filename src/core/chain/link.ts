/**
 * Canonical Chain Link contract.
 *
 * Phase 1 owns identity, classification, snapshots, status and serialization.
 * Timing, SEGOC and full resolution semantics remain in their dedicated phases.
 */

import {
  CHAIN_ACTIVATION_KINDS,
  CHAIN_EFFECT_KINDS,
  CHAIN_RESPONSE_CONTEXTS,
} from "../contracts/chain.js";
import type {
  ChainActivationKind,
  ChainEffectKind,
  ChainFinalizationStatus,
  ChainResolutionStatus,
  ChainResponseContextType,
} from "../contracts/chain.js";
import type {
  ChainCard,
  ChainCardInstanceId,
  ChainDeclaredTarget,
  ChainDeclaredTargetSnapshot,
  ChainEffect,
  ChainLink,
  ChainPlayer,
  ChainResolvedSelectionCounts,
  ChainSelectionMap,
  ChainSourceSnapshot,
  ChainSourceZone,
  ChainUsagePolicy,
  FastEffectContextInput,
  FullChainHost,
  PreparedActivationInput,
  SerializedChainCard,
  SerializedChainLink,
} from "../contracts/chainRuntime.js";
import type { ChainId, ChainLinkId } from "../contracts/primitives.js";

export {
  CHAIN_ACTIVATION_KINDS,
  CHAIN_EFFECT_KINDS,
  CHAIN_RESPONSE_CONTEXTS,
};

const VALID_ACTIVATION_KINDS = new Set(Object.values(CHAIN_ACTIVATION_KINDS));
const VALID_EFFECT_KINDS = new Set(Object.values(CHAIN_EFFECT_KINDS));

function isSpellTrap(card?: ChainCard | null): boolean {
  return card?.cardKind === "spell" || card?.cardKind === "trap";
}

function cardInstanceId(card?: ChainCard | null): ChainCardInstanceId {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uuid ??
    card?.simInstanceId ??
    null
  );
}

function normalizedLocationVersion(card?: ChainCard | null): number {
  const version = Number(card?.locationVersion ?? 0);
  return Number.isFinite(version) && version >= 0 ? version : 0;
}

export function captureSourceSnapshot(
  card: ChainCard | null | undefined,
  controller: ChainPlayer | null | undefined,
  zone: ChainSourceZone | null = null,
): ChainSourceSnapshot | null {
  if (!card) return null;
  return {
    cardInstanceId: cardInstanceId(card),
    controllerId: controller?.id ?? card.controller ?? card.owner ?? null,
    zone: zone || null,
    faceUp: card.isFacedown !== true,
    locationVersion: normalizedLocationVersion(card),
  };
}

export function classifyActivationKind(
  input: PreparedActivationInput = {},
): ChainActivationKind {
  if (
    input.activationKind &&
    VALID_ACTIVATION_KINDS.has(input.activationKind)
  ) {
    return input.activationKind;
  }

  const card = input.card || null;
  const activationContext = input.activationContext || {};
  const sourceSnapshot =
    input.sourceAtTrigger || activationContext.sourceAtTrigger || null;
  const sourceZone =
    sourceSnapshot?.zone ||
    activationContext.sourceZone ||
    input.sourceZone ||
    null;
  const fromHand =
    input.fromHand === true ||
    activationContext.fromHand === true ||
    sourceZone === "hand";
  const sourceWasFacedown =
    input.sourceWasFacedown === true ||
    activationContext.sourceWasFacedown === true;
  const committedAsCard =
    input.cardActivation === true ||
    activationContext.cardActivation === true ||
    activationContext.commitInfo != null;

  if (isSpellTrap(card)) {
    const wasSetCardActivation =
      sourceWasFacedown &&
      (sourceZone === "spellTrap" || sourceZone === "fieldSpell");
    return fromHand || wasSetCardActivation || committedAsCard
      ? CHAIN_ACTIVATION_KINDS.SPELL_TRAP_CARD
      : CHAIN_ACTIVATION_KINDS.SPELL_TRAP_EFFECT;
  }

  return CHAIN_ACTIVATION_KINDS.MONSTER_EFFECT;
}

export function classifyEffectKind(
  input: PreparedActivationInput = {},
): ChainEffectKind {
  if (input.effectKind && VALID_EFFECT_KINDS.has(input.effectKind)) {
    return input.effectKind;
  }

  const card = input.card || null;
  const effect = input.effect || null;
  const activationContext = input.activationContext || {};
  const isTrigger =
    input.selectionKind === "triggered" ||
    effect?.timing === "on_event" ||
    activationContext.triggeredByEvent != null;

  if (isTrigger) return CHAIN_EFFECT_KINDS.TRIGGER;
  if (isSpellTrap(card)) return CHAIN_EFFECT_KINDS.SPELL_TRAP;
  if (effect?.isQuickEffect === true || Number(effect?.speed) === 2) {
    return CHAIN_EFFECT_KINDS.QUICK;
  }
  if (effect?.timing === "ignition") return CHAIN_EFFECT_KINDS.IGNITION;
  return CHAIN_EFFECT_KINDS.OTHER;
}

export function getResponseContextType(
  activationKind: ChainActivationKind,
): ChainResponseContextType {
  return activationKind === CHAIN_ACTIVATION_KINDS.SPELL_TRAP_CARD
    ? CHAIN_RESPONSE_CONTEXTS.CARD_ACTIVATION
    : CHAIN_RESPONSE_CONTEXTS.EFFECT_ACTIVATION;
}

export function buildUsagePolicy(
  effect: ChainEffect | null = null,
): ChainUsagePolicy {
  if (!effect) {
    return {
      consumption: null,
      oncePerTurn: false,
      oncePerDuel: false,
      name: null,
      scope: null,
      perEventCard: false,
      limit: null,
    };
  }

  const oncePerTurnLimit =
    effect.oncePerTurnLimit ??
    effect.usesPerTurn ??
    effect.maxUsesPerTurn ??
    1;
  const oncePerDuelLimit =
    effect.oncePerDuelLimit ??
    effect.oncePerDuelMax ??
    (typeof effect.oncePerDuel === "number" ? effect.oncePerDuel : 1);
  const rawLimit = effect.oncePerTurn
    ? oncePerTurnLimit
    : effect.oncePerDuel
      ? oncePerDuelLimit
      : null;
  const normalizedLimit = Math.floor(Number(rawLimit));

  return {
    consumption:
      effect.usagePolicy === "use" || effect.usagePolicy === "activate"
        ? effect.usagePolicy
        : null,
    oncePerTurn: effect.oncePerTurn === true,
    oncePerDuel: !!effect.oncePerDuel,
    name:
      effect.oncePerTurnName || effect.oncePerDuelName || effect.id || null,
    scope:
      effect.oncePerTurnScope ||
      (effect.oncePerTurnPerCard === true ? "card" : null),
    perEventCard: effect.oncePerTurnPerEventCard === true,
    limit:
      rawLimit == null
        ? null
        : Number.isFinite(normalizedLimit) && normalizedLimit > 0
          ? normalizedLimit
          : 1,
  };
}

function selectionCards(
  value: unknown,
  output: ChainCard[] = [],
): ChainCard[] {
  if (!value) return output;
  if (Array.isArray(value)) {
    for (const entry of value) selectionCards(entry, output);
    return output;
  }
  if (typeof value === "object") {
    const enclosedCard: unknown = Reflect.get(value, "card");
    if (enclosedCard) return selectionCards(enclosedCard, output);
    output.push(value as ChainCard);
  }
  return output;
}

export function collectDeclaredTargets(
  effect?: ChainEffect | null,
  selections: ChainSelectionMap = {},
): ChainDeclaredTarget[] {
  const declared: ChainDeclaredTarget[] = [];
  for (const target of effect?.targets || []) {
    if (!target?.id || target.intent === "cost") continue;
    const cards = selectionCards(Reflect.get(selections, target.id), []);
    declared.push({ targetId: target.id, cards });
  }
  return declared;
}

function resolveTargetController(
  chainSystem: FullChainHost,
  card: ChainCard,
): { player: ChainPlayer | null; zone: ChainSourceZone | null } {
  for (const player of [chainSystem.game?.player, chainSystem.game?.bot]) {
    if (!player) continue;
    const zone = chainSystem.determineCardZone?.(card, player);
    if (zone && zone !== "unknown") return { player, zone };
  }
  return { player: null, zone: null };
}

function captureDeclaredTargetSnapshots(
  chainSystem: FullChainHost,
  declaredTargets: readonly ChainDeclaredTarget[],
): ChainDeclaredTargetSnapshot[] {
  return (declaredTargets || []).map((entry) => ({
    targetId: entry.targetId || null,
    cards: (entry.cards || []).map((card) => {
      const { player, zone } = resolveTargetController(chainSystem, card);
      return {
        card,
        cardInstanceId: cardInstanceId(card),
        controllerId: player?.id ?? card?.controller ?? card?.owner ?? null,
        zone,
        faceUp: card?.isFacedown !== true,
        locationVersion: normalizedLocationVersion(card),
      };
    }),
  }));
}

function compactCard(card?: ChainCard | null): SerializedChainCard | null {
  if (!card) return null;
  return {
    id: card.id ?? null,
    instanceId: cardInstanceId(card),
    name: card.name || null,
    owner: card.owner ?? null,
  };
}

function serializeSelectionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(serializeSelectionValue);
  if (value && typeof value === "object") {
    const enclosedCard: unknown = Reflect.get(value, "card");
    if (enclosedCard) return serializeSelectionValue(enclosedCard);
    return compactCard(value as ChainCard);
  }
  return value ?? null;
}

function serializeSelectionMap(
  selections?: ChainSelectionMap | null,
): ChainSelectionMap {
  if (!selections || typeof selections !== "object") return {};
  return Object.fromEntries(
    Object.entries(selections).map(([key, value]) => [
      key,
      serializeSelectionValue(value),
    ]),
  );
}

/**
 * Records target quantities fixed by an earlier activation-cost selection.
 * The map belongs to the link, rather than the card definition, so public
 * state and canonical replay can reproduce the exact declared quantity.
 */
function resolveLinkedSelectionCounts(
  effect?: ChainEffect | null,
  costSelections: ChainSelectionMap = {},
): ChainResolvedSelectionCounts {
  const counts: ChainResolvedSelectionCounts = {};
  for (const target of effect?.targets || []) {
    const sourceReference = target.countFromSelectionRef;
    if (!target.id || typeof sourceReference !== "string") continue;
    Reflect.set(
      counts,
      target.id,
      selectionCards(Reflect.get(costSelections, sourceReference), []).length,
    );
  }
  return counts;
}

function checkedChainId(value: number): ChainId {
  if (!Number.isInteger(value)) {
    throw new TypeError("Chain identity must be an integer.");
  }
  return value as ChainId;
}

function checkedChainLinkId(value: number): ChainLinkId {
  if (!Number.isInteger(value)) {
    throw new TypeError("Chain Link identity must be an integer.");
  }
  return value as ChainLinkId;
}

function ensureIdentity(
  chainSystem: FullChainHost,
): { chainId: ChainId; linkId: ChainLinkId } {
  if (!Number.isInteger(chainSystem.nextChainId)) chainSystem.nextChainId = 1;
  if (!Number.isInteger(chainSystem.nextLinkId)) chainSystem.nextLinkId = 1;
  if (chainSystem.activeChainId == null) {
    chainSystem.activeChainId = checkedChainId(chainSystem.nextChainId++);
  }
  return {
    chainId: chainSystem.activeChainId,
    linkId: checkedChainLinkId(chainSystem.nextLinkId++),
  };
}

export function createChainLink(
  this: FullChainHost,
  preparedInput: PreparedActivationInput = {},
  contextOverride: FastEffectContextInput | null = null,
): ChainLink {
  const card = preparedInput.card || null;
  const controller = preparedInput.controller || null;
  const opponent =
    preparedInput.opponent || this.getOpponent?.(controller) || null;
  const effect = preparedInput.effect || null;
  const activationZone = preparedInput.activationZone || null;
  const activationContext = preparedInput.activationContext || {};
  const activationKind = classifyActivationKind({
    ...preparedInput,
    card,
    effect,
    activationContext,
  });
  const effectKind = classifyEffectKind({
    ...preparedInput,
    card,
    effect,
    activationContext,
  });
  const responseContextType = getResponseContextType(activationKind);
  const { chainId, linkId } = ensureIdentity(this);
  const chainLevel = (this.chainStack?.length || 0) + 1;
  const sourceAtTrigger =
    preparedInput.sourceAtTrigger ||
    activationContext.sourceAtTrigger ||
    null;
  const sourceAtActivation =
    preparedInput.sourceAtActivation ||
    activationContext.sourceAtActivation ||
    captureSourceSnapshot(card, controller, activationZone);
  const currentSourceZone = this.determineCardZone?.(card, controller) || null;
  const currentSourceSnapshot = captureSourceSnapshot(
    card,
    controller,
    currentSourceZone,
  );
  const sourceMovedBeforeLink =
    !!sourceAtActivation &&
    !!currentSourceSnapshot &&
    Number(sourceAtActivation.locationVersion ?? 0) !==
      Number(currentSourceSnapshot.locationVersion ?? 0);
  const activationNegated =
    preparedInput.activationNegated === true ||
    preparedInput.activationAttempt?.activationNegated === true;
  const activationAttempt = {
    ...(preparedInput.activationAttempt || {}),
    chainId,
    linkId,
    card,
    controller,
    effect,
    effectId: effect?.id || null,
    activationKind,
    activationZone,
    activationNegated,
  };
  const costSelections = preparedInput.costSelections || {};
  const targetSelections = preparedInput.targetSelections || {};
  const resolutionSelections = preparedInput.resolutionSelections || {};
  const resolvedSelectionCounts = {
    ...resolveLinkedSelectionCounts(effect, costSelections),
    ...(preparedInput.resolvedSelectionCounts || {}),
  };
  const declaredTargets =
    preparedInput.declaredTargets ||
    collectDeclaredTargets(effect, targetSelections);
  const link = {
    chainId,
    linkId,
    chainLevel,
    controller,
    opponent,
    card,
    effect,
    effectId: effect?.id || null,
    spellSpeed: this.getEffectSpellSpeed?.(effect, card) ?? 1,
    activationZone,
    activationKind,
    effectKind,
    responseContextType,
    context: contextOverride || preparedInput.context || null,
    activationContext,
    activationAttempt,
    costSelections,
    targetSelections,
    resolutionSelections,
    resolvedSelectionCounts,
    costPayment: preparedInput.costPayment
      ? { ...preparedInput.costPayment }
      : null,
    activationCommitment: preparedInput.activationCommitment
      ? {
          ...preparedInput.activationCommitment,
          actions: Array.isArray(preparedInput.activationCommitment.actions)
            ? preparedInput.activationCommitment.actions.map((entry) => ({ ...entry }))
            : [],
        }
      : null,
    declaredTargets,
    declaredTargetSnapshots:
      preparedInput.declaredTargetSnapshots ||
      captureDeclaredTargetSnapshots(this, declaredTargets),
    targetValidation: preparedInput.targetValidation || null,
    committed: preparedInput.committed === true,
    costsPaid: preparedInput.costsPaid === true,
    usagePolicy:
      preparedInput.usagePolicy || buildUsagePolicy(preparedInput.effect),
    usageReservation: preparedInput.usageReservation || null,
    sourceAtTrigger,
    sourceAtActivation,
    requiresSourceAtResolution:
      preparedInput.requiresSourceAtResolution === true,
    requiresSourceFaceUpAtResolution:
      typeof preparedInput.requiresSourceFaceUpAtResolution === "boolean"
        ? preparedInput.requiresSourceFaceUpAtResolution
        : preparedInput.requiresSourceAtResolution === true,
    preparationStatus:
      preparedInput.preparationStatus ||
      (preparedInput.committed === true && preparedInput.costsPaid === true
        ? "committed"
        : "prepared"),
    resolutionStatus: preparedInput.resolutionStatus || "pending",
    finalizationStatus: preparedInput.finalizationStatus || "pending",
    finalizationQueued: preparedInput.finalizationQueued === true,
    activationNegated,
    effectNegated: preparedInput.effectNegated === true,
    sourceMoved: preparedInput.sourceMoved === true || sourceMovedBeforeLink,
    sourceDestroyed: preparedInput.sourceDestroyed === true,
    latestSourceLocation:
      preparedInput.latestSourceLocation ||
      (sourceMovedBeforeLink ? currentSourceSnapshot : null),
    resolvedWithoutEffect: preparedInput.resolvedWithoutEffect === true,
    activationPublished: preparedInput.activationPublished === true,
    effectTargetedResolved: preparedInput.effectTargetedResolved === true,
    pipelineCompletion: preparedInput.pipelineCompletion || null,
    pipelineFinalization: preparedInput.pipelineFinalization || null,
    pipelineManaged: preparedInput.pipelineManaged === true,
    skipDefaultFinalization: preparedInput.skipDefaultFinalization === true,
    triggerOpportunityId: preparedInput.triggerOpportunityId ?? null,
    triggerOccurrenceId: preparedInput.triggerOccurrenceId ?? null,
    atomicGroupId: preparedInput.atomicGroupId ?? null,
    segocGroup: preparedInput.segocGroup || null,
    segocOrder: preparedInput.segocOrder ?? null,
  };

  // The runtime builder is deliberately defensive for legacy direct callers;
  // stack admission validates the required card/controller/effect correlation.
  return link as ChainLink;
}

type ChainLinkReference = ChainLink | ChainLinkId | number | null | undefined;

function resolveLink(
  chainSystem: FullChainHost,
  linkOrId: ChainLinkReference,
): ChainLink | null {
  if (linkOrId && typeof linkOrId === "object" && linkOrId.linkId != null) {
    return linkOrId;
  }
  const linkId =
    typeof linkOrId === "object" ? linkOrId?.linkId : linkOrId;
  if (linkId == null) return null;
  if (chainSystem.currentResolvingLink?.linkId === linkId) {
    return chainSystem.currentResolvingLink;
  }
  return (
    chainSystem.chainStack?.find((candidate) => candidate?.linkId === linkId) ||
    null
  );
}

export function markChainLinkActivationNegated(
  this: FullChainHost,
  linkOrId: ChainLinkReference,
  details: { negatedBy?: ChainCard | null } = {},
): ChainLink | null {
  const link = resolveLink(this, linkOrId);
  if (!link) return null;
  link.activationNegated = true;
  link.negatedBy = details.negatedBy || link.negatedBy || null;
  link.activationAttempt.activationNegated = true;
  return link;
}

export function markChainLinkEffectNegated(
  this: FullChainHost,
  linkOrId: ChainLinkReference,
  details: { negatedBy?: ChainCard | null } = {},
): ChainLink | null {
  const link = resolveLink(this, linkOrId);
  if (!link) return null;
  link.effectNegated = true;
  link.effectNegatedBy = details.negatedBy || link.effectNegatedBy || null;
  return link;
}

function isChainLink(
  value: ChainLink | null | undefined,
): value is ChainLink {
  return value != null;
}

export function recordChainSourceMovement(
  this: FullChainHost,
  card: ChainCard | null | undefined,
  movement: {
    wasDestroyed?: boolean;
    toPlayer?: ChainPlayer | null;
    toZone?: ChainSourceZone | null;
  } = {},
): number {
  if (!card) return 0;
  const candidates = [
    ...(this.chainStack || []),
    ...(this.pendingChainFinalizations || []).map((entry) => entry?.link),
    this.currentResolvingLink || null,
    this.currentFinalizingLink || null,
  ].filter(isChainLink);
  let updated = 0;
  for (const link of new Set(candidates)) {
    if (link.card !== card) continue;
    link.sourceMoved = true;
    if (movement.wasDestroyed === true) link.sourceDestroyed = true;
    link.latestSourceLocation = captureSourceSnapshot(
      card,
      movement.toPlayer || link.controller,
      movement.toZone || null,
    );
    updated += 1;
  }
  return updated;
}

export function setChainLinkResolutionStatus(
  this: FullChainHost,
  linkOrId: ChainLinkReference,
  status: ChainResolutionStatus,
  details: {
    resolvedWithoutEffect?: boolean;
    finalizationStatus?: ChainFinalizationStatus;
  } = {},
): ChainLink | null {
  const link = resolveLink(this, linkOrId);
  if (!link) return null;
  link.resolutionStatus = status;
  if (details.resolvedWithoutEffect === true) {
    link.resolvedWithoutEffect = true;
  }
  if (details.finalizationStatus) {
    link.finalizationStatus = details.finalizationStatus;
  }
  return link;
}

function isSerializedChainCard(
  value: SerializedChainCard | null,
): value is SerializedChainCard {
  return value != null;
}

export function serializeChainLink(
  link?: ChainLink | null,
): SerializedChainLink | null {
  if (!link) return null;
  return {
    chainId: link.chainId ?? null,
    linkId: link.linkId ?? null,
    chainLevel: link.chainLevel ?? null,
    controllerId: link.controller?.id ?? null,
    opponentId: link.opponent?.id ?? null,
    cardId: link.card?.id ?? null,
    cardInstanceId: cardInstanceId(link.card),
    cardName: link.card?.name || "Unknown",
    effectId: link.effectId || link.effect?.id || null,
    spellSpeed: link.spellSpeed ?? null,
    activationZone: link.activationZone || null,
    activationKind: link.activationKind || null,
    effectKind: link.effectKind || null,
    responseContextType: link.responseContextType || null,
    costsPaid: link.costsPaid === true,
    committed: link.committed === true,
    declaredTargets: (link.declaredTargets || []).map((entry) => ({
      targetId: entry.targetId || null,
      cards: (entry.cards || [])
        .map(compactCard)
        .filter(isSerializedChainCard),
    })),
    declaredTargetSnapshots: (link.declaredTargetSnapshots || []).map(
      (entry) => ({
        targetId: entry.targetId || null,
        cards: (entry.cards || []).map((snapshot) => ({
          cardInstanceId: snapshot.cardInstanceId ?? null,
          controllerId: snapshot.controllerId ?? null,
          zone: snapshot.zone || null,
          faceUp: snapshot.faceUp === true,
          locationVersion: Number(snapshot.locationVersion ?? 0),
        })),
      }),
    ),
    targetValidation: link.targetValidation
      ? structuredClone(link.targetValidation)
      : null,
    costSelections: serializeSelectionMap(link.costSelections),
    targetSelections: serializeSelectionMap(link.targetSelections),
    resolutionSelections: serializeSelectionMap(link.resolutionSelections),
    resolvedSelectionCounts: { ...(link.resolvedSelectionCounts || {}) },
    costPayment: link.costPayment
      ? {
          status: link.costPayment.status || null,
          actions: Array.isArray(link.costPayment.actions)
            ? link.costPayment.actions.map((entry) => ({ ...entry }))
            : [],
        }
      : null,
    activationCommitment: link.activationCommitment
      ? {
          status: link.activationCommitment.status || null,
          actions: Array.isArray(link.activationCommitment.actions)
            ? link.activationCommitment.actions.map((entry) => ({ ...entry }))
            : [],
        }
      : null,
    usagePolicy: link.usagePolicy ? { ...link.usagePolicy } : null,
    usageReservation: link.usageReservation
      ? { ...link.usageReservation }
      : null,
    sourceAtTrigger: link.sourceAtTrigger
      ? { ...link.sourceAtTrigger }
      : null,
    sourceAtActivation: link.sourceAtActivation
      ? { ...link.sourceAtActivation }
      : null,
    latestSourceLocation: link.latestSourceLocation
      ? { ...link.latestSourceLocation }
      : null,
    sourceValidity: link.sourceValidity ? { ...link.sourceValidity } : null,
    requiresSourceAtResolution: link.requiresSourceAtResolution === true,
    requiresSourceFaceUpAtResolution:
      link.requiresSourceFaceUpAtResolution === true,
    preparationStatus: link.preparationStatus || null,
    resolutionStatus: link.resolutionStatus || null,
    finalizationStatus: link.finalizationStatus || null,
    finalizationQueued: link.finalizationQueued === true,
    activationNegated: link.activationNegated === true,
    effectNegated: link.effectNegated === true,
    effectNegationReason: link.effectNegationReason || null,
    sourceMoved: link.sourceMoved === true,
    sourceDestroyed: link.sourceDestroyed === true,
    resolvedWithoutEffect: link.resolvedWithoutEffect === true,
    triggerOpportunityId: link.triggerOpportunityId ?? null,
    triggerOccurrenceId: link.triggerOccurrenceId ?? null,
    atomicGroupId: link.atomicGroupId ?? null,
    segocGroup: link.segocGroup || null,
    segocOrder: link.segocOrder ?? null,
  };
}
