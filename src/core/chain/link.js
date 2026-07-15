/**
 * Canonical Chain Link contract.
 *
 * Phase 1 owns identity, classification, snapshots, status and serialization.
 * Timing, SEGOC and full resolution semantics remain in their dedicated phases.
 */

export const CHAIN_ACTIVATION_KINDS = Object.freeze({
  SPELL_TRAP_CARD: "spell_trap_card_activation",
  SPELL_TRAP_EFFECT: "spell_trap_effect_activation",
  MONSTER_EFFECT: "monster_effect_activation",
});

export const CHAIN_EFFECT_KINDS = Object.freeze({
  TRIGGER: "trigger_effect",
  QUICK: "quick_effect",
  IGNITION: "ignition_effect",
  SPELL_TRAP: "spell_trap_effect",
  OTHER: "other_effect",
});

export const CHAIN_RESPONSE_CONTEXTS = Object.freeze({
  CARD_ACTIVATION: "card_activation",
  EFFECT_ACTIVATION: "effect_activation",
});

const VALID_ACTIVATION_KINDS = new Set(Object.values(CHAIN_ACTIVATION_KINDS));
const VALID_EFFECT_KINDS = new Set(Object.values(CHAIN_EFFECT_KINDS));

function isSpellTrap(card) {
  return card?.cardKind === "spell" || card?.cardKind === "trap";
}

function cardInstanceId(card) {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uuid ??
    card?.simInstanceId ??
    null
  );
}

function normalizedLocationVersion(card) {
  const version = Number(card?.locationVersion ?? 0);
  return Number.isFinite(version) && version >= 0 ? version : 0;
}

export function captureSourceSnapshot(card, controller, zone = null) {
  if (!card) return null;
  return {
    cardInstanceId: cardInstanceId(card),
    controllerId: controller?.id ?? card.controller ?? card.owner ?? null,
    zone: zone || null,
    faceUp: card.isFacedown !== true,
    locationVersion: normalizedLocationVersion(card),
  };
}

export function classifyActivationKind(input = {}) {
  if (VALID_ACTIVATION_KINDS.has(input.activationKind)) {
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

export function classifyEffectKind(input = {}) {
  if (VALID_EFFECT_KINDS.has(input.effectKind)) return input.effectKind;

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

export function getResponseContextType(activationKind) {
  return activationKind === CHAIN_ACTIVATION_KINDS.SPELL_TRAP_CARD
    ? CHAIN_RESPONSE_CONTEXTS.CARD_ACTIVATION
    : CHAIN_RESPONSE_CONTEXTS.EFFECT_ACTIVATION;
}

export function buildUsagePolicy(effect = null) {
  if (!effect) {
    return {
      consumption: "legacy_resolution_success",
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
        : "legacy_resolution_success",
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

function selectionCards(value, output = []) {
  if (!value) return output;
  if (Array.isArray(value)) {
    for (const entry of value) selectionCards(entry, output);
    return output;
  }
  if (value?.card) return selectionCards(value.card, output);
  if (typeof value === "object") output.push(value);
  return output;
}

export function collectDeclaredTargets(effect, selections = {}) {
  const declared = [];
  for (const target of effect?.targets || []) {
    if (!target?.id || target.intent === "cost") continue;
    const cards = selectionCards(selections?.[target.id], []);
    declared.push({ targetId: target.id, cards });
  }
  return declared;
}

function resolveTargetController(chainSystem, card) {
  for (const player of [chainSystem.game?.player, chainSystem.game?.bot]) {
    if (!player) continue;
    const zone = chainSystem.determineCardZone?.(card, player);
    if (zone && zone !== "unknown") return { player, zone };
  }
  return { player: null, zone: null };
}

function captureDeclaredTargetSnapshots(chainSystem, declaredTargets) {
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

function compactCard(card) {
  if (!card) return null;
  return {
    id: card.id ?? null,
    instanceId: cardInstanceId(card),
    name: card.name || null,
    owner: card.owner ?? null,
  };
}

function serializeSelectionValue(value) {
  if (Array.isArray(value)) return value.map(serializeSelectionValue);
  if (value?.card) return serializeSelectionValue(value.card);
  if (value && typeof value === "object") return compactCard(value);
  return value ?? null;
}

function serializeSelectionMap(selections) {
  if (!selections || typeof selections !== "object") return {};
  return Object.fromEntries(
    Object.entries(selections).map(([key, value]) => [
      key,
      serializeSelectionValue(value),
    ]),
  );
}

function warnLegacy(chainSystem, alias) {
  if (!chainSystem?.testMode) return;
  if (!(chainSystem.legacyContractWarnings instanceof Set)) {
    chainSystem.legacyContractWarnings = new Set();
  }
  if (chainSystem.legacyContractWarnings.has(alias)) return;
  chainSystem.legacyContractWarnings.add(alias);
  console.warn(
    `[ChainSystem] Legacy Chain Link contract used: ${alias}. ` +
      "This adapter must be removed in Phase 9.",
  );
}

export function warnLegacyChainContract(alias) {
  warnLegacy(this, alias);
}

function defineLegacyAlias(chainSystem, link, alias, canonical, onSet = null) {
  Object.defineProperty(link, alias, {
    configurable: true,
    enumerable: false,
    get() {
      warnLegacy(chainSystem, alias);
      return link[canonical];
    },
    set(value) {
      warnLegacy(chainSystem, alias);
      link[canonical] = value;
      onSet?.(value);
    },
  });
}

function ensureIdentity(chainSystem) {
  if (!Number.isInteger(chainSystem.nextChainId)) chainSystem.nextChainId = 1;
  if (!Number.isInteger(chainSystem.nextLinkId)) chainSystem.nextLinkId = 1;
  if (chainSystem.activeChainId == null) {
    chainSystem.activeChainId = chainSystem.nextChainId++;
  }
  return {
    chainId: chainSystem.activeChainId,
    linkId: chainSystem.nextLinkId++,
  };
}

export function createChainLink(preparedInput = {}, contextOverride = null) {
  const card = preparedInput.card || null;
  const controller = preparedInput.controller || preparedInput.player || null;
  const opponent =
    preparedInput.opponent || this.getOpponent?.(controller) || null;
  const effect = preparedInput.effect || null;
  const activationZone =
    preparedInput.activationZone || preparedInput.zone || null;
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
    preparedInput.negated === true ||
    preparedInput.activationAttempt?.activationNegated === true ||
    preparedInput.activationAttempt?.negated === true;
  const activationAttempt = {
    ...(preparedInput.activationAttempt || {}),
    chainId,
    linkId,
    card,
    controller,
    // Phase 9 compatibility alias.
    player: controller,
    effect,
    effectId: effect?.id || null,
    activationKind,
    activationZone,
    activationNegated,
    // Phase 9 compatibility alias.
    negated: activationNegated,
  };
  const costSelections = preparedInput.costSelections || {};
  const targetSelections = preparedInput.targetSelections || {};
  const resolutionSelections = preparedInput.resolutionSelections || {};
  const selections = {
    ...(preparedInput.selections || {}),
    ...costSelections,
    ...targetSelections,
    ...resolutionSelections,
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
    selections,
    costSelections,
    targetSelections,
    resolutionSelections,
    costPayment: preparedInput.costPayment
      ? { ...preparedInput.costPayment }
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
        : preparedInput.prepared === true
          ? "prepared"
          : "legacy"),
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
    skipUsageRegistration: preparedInput.skipUsageRegistration === true,
    triggerOpportunityId: preparedInput.triggerOpportunityId ?? null,
    triggerOccurrenceId: preparedInput.triggerOccurrenceId ?? null,
    atomicGroupId: preparedInput.atomicGroupId ?? null,
    segocGroup: preparedInput.segocGroup || null,
    segocOrder: preparedInput.segocOrder ?? null,
  };

  defineLegacyAlias(this, link, "player", "controller");
  defineLegacyAlias(this, link, "zone", "activationZone");
  defineLegacyAlias(this, link, "activationType", "responseContextType");
  defineLegacyAlias(
    this,
    link,
    "negated",
    "activationNegated",
    (value) => {
      link.activationAttempt.activationNegated = value === true;
    },
  );

  return link;
}

function resolveLink(chainSystem, linkOrId) {
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

export function markChainLinkActivationNegated(linkOrId, details = {}) {
  const link = resolveLink(this, linkOrId);
  if (!link) return null;
  link.activationNegated = true;
  link.negatedBy = details.negatedBy || link.negatedBy || null;
  link.activationAttempt.activationNegated = true;
  // Phase 9 compatibility alias.
  link.activationAttempt.negated = true;
  return link;
}

export function markChainLinkEffectNegated(linkOrId, details = {}) {
  const link = resolveLink(this, linkOrId);
  if (!link) return null;
  link.effectNegated = true;
  link.effectNegatedBy = details.negatedBy || link.effectNegatedBy || null;
  return link;
}

export function recordChainSourceMovement(card, movement = {}) {
  if (!card) return 0;
  const candidates = [
    ...(this.chainStack || []),
    ...(this.pendingChainFinalizations || []).map((entry) => entry?.link),
    this.currentResolvingLink || null,
    this.currentFinalizingLink || null,
  ].filter(Boolean);
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

export function setChainLinkResolutionStatus(linkOrId, status, details = {}) {
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

export function serializeChainLink(link) {
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
      cards: (entry.cards || []).map(compactCard).filter(Boolean),
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
    costPayment: link.costPayment
      ? {
          status: link.costPayment.status || null,
          actions: Array.isArray(link.costPayment.actions)
            ? link.costPayment.actions.map((entry) => ({ ...entry }))
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
    // Phase 9: remove these summary aliases after all external consumers migrate.
    level: link.chainLevel ?? null,
    playerName:
      link.controller?.name || link.controller?.id || "Unknown",
  };
}
