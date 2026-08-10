/**
 * resolution.ts
 *
 * Chain resolution extracted from ChainSystem.js.
 * Resolves the chain stack in LIFO order. Link preparation and application
 * remain here; post-Chain destination handling belongs to finalization.js so
 * no link is cleaned up before CL1.
 *
 * Public methods (bound via prototype on ChainSystem):
 *  - resolveChain
 *  - resolveChainLink
 *  - isCardStillValid
 *  - determineCardZone
 */

import { isAI } from "../Player.js";
import { CHAIN_ACTIVATION_KINDS } from "./link.js";
import type { CanonicalZone } from "../contracts/zones.js";
import type {
  ChainActivationZone,
  ChainCard,
  ChainEffectTarget,
  ChainFinalizationSnapshot,
  ChainLink,
  ChainOperationResult,
  ChainPlayer,
  ChainSelectionContract,
  ChainSelectionKeyMap,
  ChainSelectionRequirement,
  ChainSelectionMap,
  ChainSourceValidity,
  ChainSourceZone,
  ChainTargetSnapshot,
  ChainTargetValidation,
  ChainTargetValidationCard,
  FastEffectContextInput,
  FullChainHost,
} from "../contracts/chainRuntime.js";

function caughtErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error !== "object" || error === null) return null;
  const message = Reflect.get(error, "message");
  return typeof message === "string" ? message : null;
}

function contractField(
  contract: ChainSelectionContract | null | undefined,
  key: string,
): unknown {
  return contract && typeof contract === "object"
    ? Reflect.get(contract, key)
    : undefined;
}

function contractRequirements(
  contract: ChainSelectionContract | null | undefined,
): ChainSelectionRequirement[] {
  const requirements = contractField(contract, "requirements");
  if (!Array.isArray(requirements)) return [];
  return requirements.filter(
    (requirement): requirement is ChainSelectionRequirement =>
      typeof requirement === "object" &&
      requirement !== null &&
      typeof Reflect.get(requirement, "id") === "string",
  );
}

function contractPurpose(
  contract: ChainSelectionContract | null | undefined,
): "target" | "cost" | "resolution" | "choice" | undefined {
  const purpose = contractField(contract, "purpose");
  return purpose === "target" ||
    purpose === "cost" ||
    purpose === "resolution" ||
    purpose === "choice"
    ? purpose
    : undefined;
}

function contractTiming(
  contract: ChainSelectionContract | null | undefined,
): string | undefined {
  const timing = contractField(contract, "timing");
  return typeof timing === "string" ? timing : undefined;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  ) && typeof Reflect.get(value, "then") === "function";
}

export async function resolveChain(
  this: FullChainHost,
): Promise<ChainOperationResult | false> {
  if (this.chainStack.length === 0) {
    this.log("No chain to resolve");
    return { success: true, needsSelection: false };
  }

  this.isResolving = true;
  this.log(`Resolving chain with ${this.chainStack.length} links`);

  const ui = this.getUI();
  let result: ChainOperationResult | undefined = {
    success: true,
    needsSelection: false,
  };
  const linkResults: ChainOperationResult[] = [];
  const chainId = this.activeChainId;
  let finalizationResult: ChainOperationResult | null = null;

  try {
    while (this.chainStack.length > 0) {
      const link = this.chainStack.pop();

      if (!link) continue;
      this.currentResolvingLink = link;
      this.setChainLinkResolutionStatus?.(link, "resolving");
      this.game?.notify?.("chain_link_resolution", {
        stage: "resolving",
        chainId: link.chainId,
        linkId: link.linkId,
        chainLevel: link.chainLevel,
        controllerId: link.controller?.id || null,
        effectId: link.effectId || link.effect?.id || null,
        activationKind: link.activationKind,
        effectKind: link.effectKind,
      });

      this.log(`Resolving Chain Link ${link.chainLevel}: ${link.card.name}`);

      if (ui?.log) {
        ui.log(`Resolving: ${link.card.name}`);
      }

      try {
        result = await this.resolveChainLink(link);
        if (result?.needsSelection) {
          this.pendingChainSelection = {
            link,
            selectionContract: result.selectionContract || null,
            selectionSource: result.selectionSource || "actions",
            baseTargets: result.baseTargets || null,
          };
          this.log(
            `${link.card.name} paused chain resolution for target selection.`,
          );
          return {
            ...result,
            success: false,
            needsSelection: true,
            pendingChainSelection: true,
          };
        }
        linkResults.push({
          chainId: link.chainId,
          linkId: link.linkId,
          ...result,
        });
        this.game?.notify?.("chain_link_resolution", {
          stage: "completed",
          chainId: link.chainId,
          linkId: link.linkId,
          chainLevel: link.chainLevel,
          controllerId: link.controller?.id || null,
          effectId: link.effectId || link.effect?.id || null,
          activationKind: link.activationKind,
          effectKind: link.effectKind,
          activationNegated: result?.activationNegated === true,
          effectNegated: result?.effectNegated === true,
          resolvedWithoutEffect: result?.resolvedWithoutEffect === true,
        });
      } catch (error) {
        this.setChainLinkResolutionStatus?.(link, "failed", {
          finalizationStatus: "failed",
        });
        console.error(
          `[ChainSystem] Error resolving ${link.card.name}:`,
          error,
        );
        result = {
          success: false,
          needsSelection: false,
          reason: caughtErrorMessage(error) || "Chain link failed.",
          error,
        };
        this.queueChainFinalization?.(link, result);
        linkResults.push({
          chainId: link.chainId,
          linkId: link.linkId,
          ...result,
        });
        this.game?.notify?.("chain_link_resolution", {
          stage: "failed",
          chainId: link.chainId,
          linkId: link.linkId,
          chainLevel: link.chainLevel,
          controllerId: link.controller?.id || null,
          effectId: link.effectId || link.effect?.id || null,
          reason: caughtErrorMessage(error) || "Chain link failed.",
        });
      } finally {
        if (this.currentResolvingLink === link) {
          this.currentResolvingLink = null;
        }
      }
    }
    finalizationResult = await this.finalizeWholeChain?.({ chainId });
  } finally {
    this.isResolving = false;
  }

  this.log("Chain resolution complete");
  return {
    ...(result || { success: true, needsSelection: false }),
    success:
      linkResults.every((entry) => entry.success !== false) &&
      finalizationResult?.success !== false,
    linkResults,
    finalizationResult,
  };
}

export async function resolveChainLink(
  this: FullChainHost,
  link: ChainLink,
): Promise<ChainOperationResult | undefined> {
  const { card, effect } = link;
  const player = link.controller;

  if (!card || !player || !effect) {
    this.log("Invalid chain link, skipping");
    return;
  }

  const previousResolvingLink = this.currentResolvingLink;
  this.currentResolvingLink = link;
  this.setChainLinkResolutionStatus?.(link, "resolving");

  this.cardsBeingResolved.add(card);

  const activationZone = link.activationZone || "spellTrap";

  try {
    if (
      link.activationNegated === true ||
      link.context?.negatedLink === link
    ) {
      const ui = this.getUI();
      this.log(`${card.name}'s activation was negated.`);
      ui?.log?.(`${card.name}'s activation was negated.`);
      const negatedResult = {
        success: true,
        needsSelection: false,
        activationNegated: true,
        chainId: link.chainId,
        linkId: link.linkId,
        resolvedWithoutEffect: true,
      };
      await completePreparedPipeline(link, negatedResult);
      this.setChainLinkResolutionStatus?.(link, "no_effect", {
        resolvedWithoutEffect: true,
        finalizationStatus: "queued",
      });
      this.queueChainFinalization?.(link, negatedResult);
      return negatedResult;
    }
    const shouldPresentSpellTrapFlip =
      activationZone === "spellTrap" &&
      card.isFacedown === true &&
      (card.cardKind === "spell" || card.cardKind === "trap");
    if (!(await prepareForResolution(this, link, activationZone))) {
      const fizzledResult = {
        success: false,
        needsSelection: false,
        fizzled: true,
        chainId: link.chainId,
        linkId: link.linkId,
      };
      await completePreparedPipeline(link, fizzledResult);
      this.setChainLinkResolutionStatus?.(link, "no_effect", {
        resolvedWithoutEffect: true,
        finalizationStatus: "queued",
      });
      this.queueChainFinalization?.(link, fizzledResult);
      return fizzledResult;
    }
    if (shouldPresentSpellTrapFlip) {
      await this.game?.presentSpellTrapActivationFlip?.(
        card,
        player,
        activationZone,
      );
    }
    const negationState = getChainLinkEffectNegation(
      this,
      link,
      activationZone,
    );
    let applyResult: ChainOperationResult;
    if (negationState.negated) {
      this.markChainLinkEffectNegated?.(link, {
        negatedBy: negationState.source || null,
      });
      link.effectNegationReason = negationState.reason;
      applyResult = {
        success: true,
        needsSelection: false,
        effectNegated: true,
        resolvedWithoutEffect: true,
        reason: negationState.reason,
        activationContext: link.activationContext || null,
      };
    } else {
      applyResult = await applyChainEffect(this, link, activationZone);
    }
    if (applyResult?.needsSelection) {
      return {
        ...applyResult,
        success: false,
        needsSelection: true,
        activationZone,
      };
    }
    const completedResult = applyResult || {
      success: true,
      needsSelection: false,
    };
    await completePreparedPipeline(link, completedResult);
    this.setChainLinkResolutionStatus?.(link, "resolved", {
      resolvedWithoutEffect: completedResult.resolvedWithoutEffect === true,
      finalizationStatus: "queued",
    });
    const result = {
      ...completedResult,
      chainId: link.chainId,
      linkId: link.linkId,
      activationNegated: Reflect.get(link, "activationNegated") === true,
      effectNegated: link.effectNegated === true,
    };
    this.queueChainFinalization?.(link, result);
    return result;
  } catch (error) {
    await completePreparedPipeline(link, {
      success: false,
      needsSelection: false,
      reason: caughtErrorMessage(error) || "Chain link failed.",
      error,
    });
    this.setChainLinkResolutionStatus?.(link, "failed", {
      finalizationStatus: "queued",
    });
    this.queueChainFinalization?.(link, {
      success: false,
      needsSelection: false,
      reason: caughtErrorMessage(error) || "Chain link failed.",
      error,
    });
    throw error;
  } finally {
    this.settleUsageForChainLink?.(link);
    this.cardsBeingResolved.delete(card);
    this.currentResolvingLink = previousResolvingLink;
  }
}

export function startPendingChainSelection(
  this: FullChainHost,
  result: ChainOperationResult = {},
): Promise<unknown> | false {
  const pending = this.pendingChainSelection;
  const contract = result.selectionContract || pending?.selectionContract;
  const game = this.game;
  const selectedTiming = contractTiming(contract);
  const selectedPurpose = contractPurpose(contract);
  if (
    selectedTiming === "activation" ||
    selectedPurpose === "target" ||
    contract?.kind === "target"
  ) {
    this.log(
      "Activation target selection was rejected during Chain resolution.",
    );
    return false;
  }
  if (
    !pending ||
    !contract ||
    !game?.startTargetSelectionSession
  ) {
    return false;
  }

  const link = pending.link;
  const contractUi = contractField(contract, "ui");
  const contractMessage = contractField(contract, "message");
  const resolutionPurpose = selectedPurpose || "choice";
  const resolutionContract = {
    ...contract,
    timing: "resolution",
    purpose: resolutionPurpose,
    ui: {
      ...(typeof contractUi === "object" && contractUi !== null
        ? contractUi
        : {}),
      allowCancel: false,
      preventCancel: true,
    },
  };
  return new Promise((resolve) => {
    let finished = false;
    const finishOnce = (value: unknown): void => {
      if (finished) return;
      finished = true;
      resolve(value);
    };

    game.startTargetSelectionSession?.({
      kind: contract.kind || "chain",
      card: link.card,
      owner: link.controller,
      selectionContract: resolutionContract,
      message:
        (typeof contractMessage === "string" && contractMessage) ||
        `Select target(s) for ${link.card?.name || "chain"}`,
      preventCancel: true,
      allowCancel: false,
      execute: async (selections) => {
        const nextResult = await this.resumePendingChainSelection(selections);
        if (!nextResult || !nextResult.needsSelection) {
          finishOnce(nextResult);
        }
        return nextResult;
      },
      onResult: (nextResult) => {
        if (nextResult?.needsSelection) {
          const nested = this.startPendingChainSelection(nextResult);
          if (isPromiseLike(nested)) {
            Promise.resolve(nested).then(finishOnce);
          }
          return;
        }
        finishOnce(nextResult);
      },
      onCancel: null,
    });
  });
}

export async function resumePendingChainSelection(
  this: FullChainHost,
  selections: ChainSelectionMap = {},
): Promise<ChainOperationResult | false> {
  const pending = this.pendingChainSelection;
  if (!pending?.link) {
    return {
      success: false,
      needsSelection: false,
      reason: "No pending chain selection.",
    };
  }

  this.pendingChainSelection = null;
  const link = pending.link;
  const wasResolving = this.isResolving === true;
  this.isResolving = true;

  try {
    if (
      pending.selectionSource === "effect_targeted" &&
      this.game?.pendingEventSelection &&
      typeof this.game.resumePendingEventSelection === "function"
    ) {
      const eventResult =
        await this.game.resumePendingEventSelection(selections);
      if (eventResult?.needsSelection) {
        this.pendingChainSelection = {
          link,
          selectionContract: eventResult.selectionContract || null,
          selectionSource: "effect_targeted",
          baseTargets: pending.baseTargets || null,
        };
        return {
          ...eventResult,
          success: false,
          needsSelection: true,
          pendingChainSelection: true,
        };
      }
      link.effectTargetedResolved = true;
    } else {
      const resolvedSelections = resolveChainSelectionCards(
        this,
        selections,
        pending.selectionContract,
        link.controller,
      );
      link.resolutionSelections = {
        ...(link.resolutionSelections || {}),
        ...resolvedSelections,
      };
    }

    const linkResult = await this.resolveChainLink(link);
    if (linkResult?.needsSelection) {
      this.pendingChainSelection = {
        link,
        selectionContract: linkResult.selectionContract || null,
        selectionSource: linkResult.selectionSource || "actions",
        baseTargets: linkResult.baseTargets || null,
      };
      return {
        ...linkResult,
        success: false,
        needsSelection: true,
        pendingChainSelection: true,
      };
    }

    this.game?.notify?.("chain_link_resolution", {
      stage: "completed",
      chainId: link.chainId,
      linkId: link.linkId,
      chainLevel: link.chainLevel,
      controllerId: link.controller?.id || null,
      effectId: link.effectId || link.effect?.id || null,
      activationKind: link.activationKind,
      effectKind: link.effectKind,
      activationNegated: linkResult?.activationNegated === true,
      effectNegated: linkResult?.effectNegated === true,
      resolvedWithoutEffect: linkResult?.resolvedWithoutEffect === true,
    });

    const remainingResult =
      this.chainStack.length > 0
        ? await this.resolveChain()
        : {
            success: true,
            needsSelection: false,
            finalizationResult: await this.finalizeWholeChain?.({
              chainId: link.chainId,
            }),
          };
    if (remainingResult && remainingResult.needsSelection) {
      return remainingResult;
    }

    await this.completeActivationTriggerPackages?.();

    this.chainWindowOpen = false;
    this.chainWindowContext = null;
    this.chainStack = [];
    this.currentChainLevel = 0;
    this.activeChainId = null;
    this.currentResolvingLink = null;
    this.cardsBeingResolved.clear();
    this.log("Chain resolution complete after selection");
    return remainingResult;
  } finally {
    this.isResolving = wasResolving;
  }
}

function resolveChainSelectionCards(
  cs: FullChainHost,
  selections: ChainSelectionMap,
  contract: ChainSelectionContract | null | undefined,
  player: ChainPlayer,
): ChainSelectionMap {
  const hasCardArrays = Object.values(selections || {}).some(
    (value) =>
      Array.isArray(value) &&
      value.some((entry) => entry && typeof entry === "object"),
  );
  if (hasCardArrays) {
    return selections || {};
  }

  if (typeof cs.resolveSelectionsToCards === "function") {
    const keySelections: ChainSelectionKeyMap = {};
    for (const [reference, value] of Object.entries(selections || {})) {
      if (
        Array.isArray(value) &&
        value.every((entry) => typeof entry === "string")
      ) {
        Reflect.set(keySelections, reference, value);
      }
    }
    return cs.resolveSelectionsToCards(
      keySelections,
      contractRequirements(contract),
      player,
    );
  }
  return selections || {};
}

export function getChainSourceValidity(
  this: FullChainHost,
  link: ChainLink,
): ChainSourceValidity {
  if (!link?.card || !link?.controller) {
    return {
      valid: false,
      required: link?.requiresSourceAtResolution === true,
      reason: "missing_source",
      zone: "unknown",
      sameLocation: false,
      faceUp: false,
    };
  }
  const required = link.requiresSourceAtResolution === true;
  const expected = link.sourceAtActivation || null;
  const zone = this.determineCardZone?.(link.card, link.controller) || "unknown";
  const locationVersion = Number(link.card.locationVersion ?? 0);
  const sameZone = !expected?.zone || zone === expected.zone;
  const sameLocation =
    sameZone &&
    (!expected ||
      locationVersion === Number(expected.locationVersion ?? locationVersion));
  const faceUp = link.card.isFacedown !== true;
  const faceUpValid =
    link.requiresSourceFaceUpAtResolution !== true || faceUp;
  const valid = !required || (sameLocation && faceUpValid);
  let reason: ChainSourceValidity["reason"] = null;
  if (!valid) {
    if (!sameZone) reason = "source_wrong_zone";
    else if (!sameLocation) reason = "source_location_changed";
    else if (!faceUpValid) reason = "source_not_face_up";
    else reason = "source_invalid";
  }
  return {
    valid,
    required,
    reason,
    zone,
    expectedZone: expected?.zone || link.activationZone || null,
    controllerId: link.controller.id || null,
    locationVersion,
    expectedLocationVersion: Number(expected?.locationVersion ?? 0),
    sameLocation,
    faceUp,
  };
}

interface ChainEffectNegationState {
  negated: boolean;
  reason: string | null;
  source: ChainCard | null;
}

function getChainLinkEffectNegation(
  chainSystem: FullChainHost,
  link: ChainLink,
  activationZone: ChainActivationZone,
): ChainEffectNegationState {
  if (link.effectNegated === true) {
    return {
      negated: true,
      reason: link.effectNegationReason || "explicit_effect_negation",
      source: link.effectNegatedBy || null,
    };
  }
  if (link.card?.cardKind !== "monster" || activationZone !== "field") {
    return { negated: false, reason: null, source: null };
  }
  const validity = link.sourceValidity || chainSystem.getChainSourceValidity?.(link);
  if (!validity?.sameLocation || validity.faceUp !== true) {
    return { negated: false, reason: null, source: null };
  }
  if (chainSystem.game?.effectEngine?.isEffectNegated?.(link.card) === true) {
    return {
      negated: true,
      reason: "continuous_effect_negation",
      source: null,
    };
  }
  return { negated: false, reason: null, source: null };
}

interface CurrentChainCardState {
  player: ChainPlayer | null;
  zone: ChainSourceZone;
  locationVersion: number;
  faceUp: boolean;
}

function findCardState(
  chainSystem: FullChainHost,
  card: ChainCard,
): CurrentChainCardState {
  for (const player of [chainSystem.game?.player, chainSystem.game?.bot]) {
    if (!player) continue;
    const zone = chainSystem.determineCardZone?.(card, player);
    if (zone && zone !== "unknown") {
      return {
        player,
        zone,
        locationVersion: Number(card?.locationVersion ?? 0),
        faceUp: card?.isFacedown !== true,
      };
    }
  }
  return {
    player: null,
    zone: "unknown",
    locationVersion: Number(card?.locationVersion ?? 0),
    faceUp: card?.isFacedown !== true,
  };
}

function targetStillMatchesDefinition(
  chainSystem: FullChainHost,
  link: ChainLink,
  definition: ChainEffectTarget,
  card: ChainCard,
  current: CurrentChainCardState,
): boolean {
  if (definition.excludeSelf === true && card === link.card) return false;
  if (
    definition.owner === "self" &&
    current.player !== link.controller
  ) {
    return false;
  }
  if (
    definition.owner === "opponent" &&
    current.player !== link.opponent
  ) {
    return false;
  }
  if (
    definition.cardName &&
    card?.name !== definition.cardName
  ) {
    return false;
  }
  if (
    definition.cardId !== undefined &&
    card?.id !== definition.cardId
  ) {
    return false;
  }
  if (
    Array.isArray(definition.cardIds) &&
    (card.id == null || !definition.cardIds.includes(card.id))
  ) {
    return false;
  }
  if (definition.subtype && card?.subtype !== definition.subtype) return false;
  if (definition.archetype) {
    const archetypes: string[] = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(definition.archetype)) return false;
  }
  if (
    definition.position &&
    definition.position !== "any" &&
    card?.position !== definition.position
  ) {
    return false;
  }
  if (
    Number.isFinite(Number(definition.minAtk)) &&
    Number(card?.atk) < Number(definition.minAtk)
  ) {
    return false;
  }
  if (
    Number.isFinite(Number(definition.maxAtk)) &&
    Number(card?.atk) > Number(definition.maxAtk)
  ) {
    return false;
  }

  const filters: object = { ...(definition.filters || {}) };
  const copyFilter = (sourceKey: string, filterKey = sourceKey): void => {
    const value = Reflect.get(definition, sourceKey);
    if (value !== undefined) {
      Reflect.set(filters, filterKey, value);
    }
  };
  copyFilter("cardKind");
  copyFilter("cardId");
  copyFilter("cardIds");
  copyFilter("cardName", "name");
  copyFilter("subtype");
  copyFilter("archetype");
  copyFilter("level");
  copyFilter("levelOp");
  copyFilter("minAtk");
  copyFilter("maxAtk");
  copyFilter("minDef");
  copyFilter("maxDef");
  copyFilter("position");
  copyFilter("isTuner");
  if (definition.requireFaceup === true) Reflect.set(filters, "faceUp", true);
  if (
    Object.keys(filters).length > 0 &&
    typeof chainSystem.game?.effectEngine?.cardMatchesFilters === "function" &&
    !chainSystem.game.effectEngine.cardMatchesFilters(card, filters)
  ) {
    return false;
  }
  return true;
}

function revalidateDeclaredTargets(
  chainSystem: FullChainHost,
  link: ChainLink,
): { selections: ChainSelectionMap; validation: ChainTargetValidation } {
  const definitions = new Map(
    (link.effect?.targets || [])
      .filter((definition) => definition?.intent !== "cost")
      .map((definition) => [definition.id, definition]),
  );
  const snapshots = new Map(
    (link.declaredTargetSnapshots || []).map((entry) => [
      entry.targetId,
      entry,
    ]),
  );
  const selections: ChainSelectionMap = {};
  const groups: ChainTargetValidation["groups"] = [];
  let satisfiesMinimums = true;

  for (const [targetId, definition] of definitions) {
    const declaredValue = Reflect.get(link.targetSelections, targetId);
    const declaredCards: ChainCard[] = Array.isArray(declaredValue)
      ? declaredValue.filter(isChainCardValue)
      : [];
    const snapshotCards: ChainTargetSnapshot[] =
      snapshots.get(targetId)?.cards || [];
    const validCards: ChainCard[] = [];
    const cards = declaredCards.map((card, index) => {
      const snapshot = snapshotCards[index] || null;
      const current = findCardState(chainSystem, card);
      const allowedZones = Array.isArray(definition.zones)
        ? definition.zones
        : definition.zone
          ? [definition.zone]
          : [];
      const sameLocation =
        !!snapshot &&
        current.zone === snapshot.zone &&
        current.locationVersion === Number(snapshot.locationVersion ?? 0);
      const zoneValid =
        allowedZones.length === 0 ||
        (current.zone !== "unknown" && allowedZones.includes(current.zone));
      const faceUpValid =
        definition.requireFaceup !== true || current.faceUp === true;
      const kindValid =
        !definition.cardKind ||
        (Array.isArray(definition.cardKind)
          ? definition.cardKind.includes(card?.cardKind)
          : card?.cardKind === definition.cardKind);
      const definitionValid = targetStillMatchesDefinition(
        chainSystem,
        link,
        definition,
        card,
        current,
      );
      const valid =
        sameLocation &&
        zoneValid &&
        faceUpValid &&
        kindValid &&
        definitionValid;
      if (valid) validCards.push(card);
      const reason: ChainTargetValidationCard["reason"] = valid
        ? null
        : !sameLocation
          ? "target_location_changed"
          : !zoneValid
            ? "target_wrong_zone"
            : !faceUpValid
              ? "target_not_face_up"
              : !kindValid || !definitionValid
                ? "target_no_longer_matches"
                : "target_invalid";
      return {
        cardInstanceId:
          card?.instanceId ?? card?._instanceId ?? card?.id ?? null,
        valid,
        reason,
        zone: current.zone,
        locationVersion: current.locationVersion,
      };
    });
    const minimum = Number(
      definition?.minAtResolution ?? definition?.count?.min ?? definition?.min ?? 1,
    );
    const minimumMet = validCards.length >= Math.max(0, minimum);
    if (!minimumMet) satisfiesMinimums = false;
    Reflect.set(selections, targetId, validCards);
    groups.push({ targetId, minimum, minimumMet, cards });
  }

  const validation = { satisfiesMinimums, groups };
  link.targetValidation = validation;
  return { selections, validation };
}

/**
 * Phase 1 — preparation.
 * Verifies effect engine + card validity, reveals face-down spells/traps,
 * relocates Quick Spells from hand to spellTrap zone.
 * Returns false if resolution must abort (fizzle).
 */
async function prepareForResolution(
  cs: FullChainHost,
  link: ChainLink,
  activationZone: ChainActivationZone,
): Promise<boolean> {
  const { card } = link;
  const player = link.controller;
  const effectEngine = cs.game?.effectEngine;

  if (!effectEngine) {
    cs.log("No effect engine available");
    return false;
  }

  const sourceValidity = cs.getChainSourceValidity?.(link) || {
    valid: true,
    required: false,
  };
  link.sourceValidity = sourceValidity;
  if (!sourceValidity.valid) {
    cs.log(
      `${card.name} is no longer valid in ${activationZone}: ${sourceValidity.reason}`,
    );
    const ui = cs.getUI();
    if (ui?.log) {
      ui.log(`${card.name}'s effect fizzles (card is no longer available).`);
    }
    return false;
  }

  return true;
}

/**
 * Phase 2 — effect application.
 * Builds resolution context, resolves targets if not pre-selected,
 * and runs the action list. Errors are logged but do not propagate
 * (chain resolution must continue for remaining links).
 */
async function applyChainEffect(
  cs: FullChainHost,
  link: ChainLink,
  activationZone: ChainActivationZone,
): Promise<ChainOperationResult> {
  const { card, effect } = link;
  const player = link.controller;
  const effectEngine = cs.game?.effectEngine;
  if (!effectEngine) {
    return {
      success: false,
      needsSelection: false,
      reason: "No effect engine available",
    };
  }
  const inheritedActivationContext = link.context?.activationContext || {};

  const ctx = {
    source: card,
    sourceCard: card,
    effect,
    effectId: effect?.id || null,
    player,
    opponent: cs.getOpponent(player),
    activationZone,
    defender: link.context?.defender || link.context?.target,
    target: link.context?.target || link.context?.defender || null,
    attacker: link.context?.attacker,
    attackerOwner: link.context?.attackerOwner,
    defenderOwner: link.context?.defenderOwner,
    targetOwner: link.context?.targetOwner,
    destroyed: link.context?.destroyed || null,
    destroyedOwner: link.context?.destroyedOwner || null,
    destroyedOwnerId: link.context?.destroyedOwnerId || null,
    destroyedPosition: link.context?.destroyedPosition || null,
    battleDestroyer: link.context?.battleDestroyer || link.context?.attacker || null,
    battleDestroyers: Array.isArray(link.context?.battleDestroyers)
      ? link.context.battleDestroyers
      : [link.context?.battleDestroyer || link.context?.attacker].filter(Boolean),
    summonedCard: link.context?.summonedCard || link.context?.card || null,
    summonMethod: link.context?.method || link.context?.summonMethod || null,
    summonFromZone: link.context?.fromZone || null,
    actionContext: link.context || null,
    activationContext: {
      ...inheritedActivationContext,
      chainLevel: link.chainLevel,
      effectId: effect?.id || null,
      sourceZone: activationZone,
      chainContext: link.context?.type || null,
      context: link.context || null,
      event: link.context?.event || null,
      autoSelectSingleTarget: true,
      autoSelectTargets: isAI(player),
      _effectTargetedResolved: link.effectTargetedResolved === true,
      actionContext: {
        ...(inheritedActivationContext.actionContext || {}),
        chainContext: link.context?.type || null,
        event: link.context?.event || null,
      },
    },
  };
  link.activationContext = ctx.activationContext;

  const targetRevalidation = revalidateDeclaredTargets(cs, link);
  const resolvedSelections = {
    ...(link.costSelections || {}),
    ...(targetRevalidation.selections || {}),
    ...(link.resolutionSelections || {}),
  };
  if (!targetRevalidation.validation.satisfiesMinimums) {
    cs.log(`${card.name} has no frozen declaration for a required target.`);
    return {
      success: false,
      needsSelection: false,
      resolvedWithoutEffect: true,
      reason: "Required activation target was not declared before resolution.",
      targetValidation: targetRevalidation.validation,
    };
  }

  notifyChainActivation(cs, link, activationZone, resolvedSelections);

  const resolutionActions =
    typeof cs.getEffectResolutionActions === "function"
      ? cs.getEffectResolutionActions(effect)
      : effect.actions || [];
  if (Array.isArray(resolutionActions)) {
    try {
      const actionsResult = await effectEngine.applyActions(
        resolutionActions,
        ctx,
        resolvedSelections || {},
      );
      if (actionsResult?.needsSelection) {
        const contract = actionsResult.selectionContract
          ? {
              ...actionsResult.selectionContract,
              timing: contractTiming(actionsResult.selectionContract) || "resolution",
              purpose: contractPurpose(actionsResult.selectionContract) || "choice",
            }
          : null;
        return {
          ...actionsResult,
          success: false,
          selectionContract: contract,
          selectionSource: actionsResult.selectionSource || "actions",
        };
      }
      if (
        actionsResult &&
        typeof actionsResult === "object" &&
        actionsResult.success === false
      ) {
        cs.log(
          `Chain resolution failed for ${card.name} (CL${link.chainLevel}): ${
            actionsResult.reason || "effect actions failed"
          }`,
        );
        return {
          ...actionsResult,
          selectionSource:
            actionsResult.selectionSource ||
            (actionsResult.needsSelection ? "actions" : null),
        };
      }
    } catch (error) {
      const linkContext = {
        cardName: card?.name || "Unknown",
        cardId: card?.id,
        effectId: effect?.id || "unknown",
        effectTiming: effect?.timing,
        chainLevel: link.chainLevel,
        activationZone,
        player: player?.id,
        actionsCount: resolutionActions.length,
        actionTypes: resolutionActions.map((a) => a?.type).filter(Boolean),
      };
      console.error(
        `[ChainSystem] Action error resolving chain link:`,
        linkContext,
        error,
      );
      cs.log(
        `Chain resolution failed for ${linkContext.cardName} (CL${linkContext.chainLevel}):`,
        caughtErrorMessage(error),
      );
      return {
        success: false,
        reason: caughtErrorMessage(error) || "Chain link actions failed.",
        error,
      };
    }
  }

  if (
    card.cardKind === "spell" &&
    typeof effectEngine.handleBlueprintStorageAfterResolution === "function"
  ) {
    await effectEngine.handleBlueprintStorageAfterResolution(
      card,
      effect,
      ctx,
    );
  }

  cs.game?.checkWinCondition?.();

  return { success: true, activationContext: ctx.activationContext };
}

/**
 * Chain activation telemetry.
 * Emits compact strategic events for chain-resolved activations.
 */
function getChainActivationEventName(
  link: ChainLink,
): "spell_activated" | "trap_activated" | "effect_activated" {
  if (
    link?.activationKind === CHAIN_ACTIVATION_KINDS.SPELL_TRAP_CARD &&
    link.card?.cardKind === "spell"
  ) {
    return "spell_activated";
  }
  if (
    link?.activationKind === CHAIN_ACTIVATION_KINDS.SPELL_TRAP_CARD &&
    link.card?.cardKind === "trap"
  ) {
    return "trap_activated";
  }
  return "effect_activated";
}

function isChainCardValue(value: unknown): value is ChainCard {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "name") === "string" ||
    typeof Reflect.get(value, "cardName") === "string"
  );
}

function flattenSelectionCards(selections: ChainSelectionMap): ChainCard[] {
  const cards: ChainCard[] = [];
  const visit = (value: unknown): void => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === "object" && value !== null) {
      const card = Reflect.get(value, "card");
      if (card) {
        visit(card);
        return;
      }
    }
    if (isChainCardValue(value)) {
      cards.push(value);
      return;
    }
  };

  for (const value of Object.values(selections || {})) {
    visit(value);
  }
  return cards;
}

interface CompactSelectedTarget {
  id: number | null;
  name: string | null;
  owner: string | null;
  zone: CanonicalZone | null;
  position: string | null;
}

function compactSelectedTarget(
  card: ChainCard | null | undefined,
): CompactSelectedTarget | null {
  if (!card) return null;
  return {
    id: card.id ?? null,
    name: card.name || card.cardName || null,
    owner: card.owner || null,
    zone: card.zone || null,
    position: card.position || null,
  };
}

function notifyChainActivation(
  cs: FullChainHost,
  link: ChainLink,
  activationZone: ChainActivationZone,
  resolvedSelections: ChainSelectionMap,
): void {
  if (link?.activationPublished === true) return;
  const game = cs.game;
  if (typeof game?.notify !== "function") return;

  const { card, effect } = link;
  const player = link.controller;
  const selectedCards = flattenSelectionCards(resolvedSelections);
  const selectedTargets = selectedCards.map(compactSelectedTarget).filter(Boolean);
  const eventName = getChainActivationEventName(link);

  game.notify(eventName, {
    chainId: link.chainId,
    linkId: link.linkId,
    card,
    source: card,
    sourceCard: card,
    player,
    owner: player,
    effect,
    effectId: effect?.id || null,
    effectType: effect?.timing || "chain",
    activationZone,
    fromZone: link.sourceAtTrigger?.zone || activationZone,
    fromHand: link.sourceAtTrigger?.zone === "hand",
    chainLevel: link.chainLevel,
    triggerOpportunityId: link.triggerOpportunityId ?? null,
    triggerOccurrenceId: link.triggerOccurrenceId ?? null,
    atomicGroupId: link.atomicGroupId ?? null,
    segocGroup: link.segocGroup || null,
    segocOrder: link.segocOrder ?? null,
    activationKind: link.activationKind,
    effectKind: link.effectKind,
    responseContextType: link.responseContextType,
    sourceAtTrigger: link.sourceAtTrigger,
    sourceAtActivation: link.sourceAtActivation,
    chainContext: link.context?.type || null,
    trigger: link.context?.event || null,
    target: selectedCards[0] || null,
    targets: selectedCards,
    selectedTargets,
    selectedCount: selectedTargets.length,
    activationContext: {
      chainLevel: link.chainLevel,
      effectId: effect?.id || null,
      sourceZone: activationZone,
      chainContext: link.context?.type || null,
      event: link.context?.event || null,
    },
  });

  if (selectedTargets.length > 0) {
    game.notify("target_selected", {
      player,
      source: card,
      sourceCard: card,
      effect,
      effectId: effect?.id || null,
      targets: selectedCards,
      selectedTargets,
      selectedCount: selectedTargets.length,
    });
  }
}

export function isCardStillValid(
  this: FullChainHost,
  card: ChainCard,
  player: ChainPlayer,
  zone?: CanonicalZone | "banish" | null,
): boolean {
  if (!card || !player) return false;

  const checkZone = zone || "spellTrap";

  if (checkZone === "spellTrap") {
    return player.spellTrap?.includes(card) === true;
  }
  if (checkZone === "hand") {
    return player.hand?.includes(card) === true;
  }
  if (checkZone === "field") {
    return player.field?.includes(card) === true;
  }
  if (checkZone === "graveyard") {
    return player.graveyard?.includes(card) === true;
  }
  if (checkZone === "fieldSpell") {
    return player.fieldSpell === card;
  }
  if (checkZone === "banished" || checkZone === "banish") {
    return player.banished?.includes(card) === true;
  }

  return true;
}

async function completePreparedPipeline(
  link: ChainLink,
  result: ChainOperationResult,
): Promise<void> {
  if (
    link?.pipelineCompletionDone === true ||
    typeof link?.pipelineCompletion !== "function"
  ) {
    return;
  }
  link.pipelineCompletionDone = true;
  await link.pipelineCompletion(result);
}

export function determineCardZone(
  this: FullChainHost,
  card: ChainCard,
  player?: ChainPlayer | null,
): CanonicalZone | "unknown" {
  if (!card || !player) return "unknown";

  if (player.deck?.includes(card)) return "deck";
  if (player.extraDeck?.includes(card)) return "extraDeck";
  if (player.hand?.includes(card)) return "hand";
  if (player.field?.includes(card)) return "field";
  if (player.spellTrap?.includes(card)) return "spellTrap";
  if (player.graveyard?.includes(card)) return "graveyard";
  if (player.banished?.includes(card)) return "banished";
  if (player.fieldSpell === card) return "fieldSpell";

  return "unknown";
}
