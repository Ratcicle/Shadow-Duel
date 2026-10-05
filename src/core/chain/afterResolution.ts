import type { ChainCard, ChainEffect, ChainLink, ChainOperationResult, ChainSelectionMap, FastEffectTimingInput, FullChainHost, SuspendedChainFrame } from "../contracts/chainRuntime.js";
import { FAST_EFFECT_ORIGINS } from "../contracts/chain.js";
import { copyCostPayment, projectAfterResolutionReferences, projectAfterResolutionSource } from "./link.js";
import { serializeChainResponseDecisions } from "../game/decisions/chainResponse.js";

/** Continue the completed link's static action list, never its primary actions. */
export async function resolveAfterResolutionActions(chain: FullChainHost, link: ChainLink): Promise<ChainOperationResult> {
  const state = link.afterResolution;
  const actions = link.effect.afterResolutionActions || [];
  if (!state || state.completed) return state?.primaryResult || { success: true };
  if (state.primaryResult.activationNegated || state.primaryResult.effectNegated || state.primaryResult.resolvedWithoutEffect) {
    state.completed = true;
    return state.primaryResult;
  }
  const engine = chain.game?.effectEngine;
  if (!engine) return { success: false, reason: "No effect engine available" };
  const generation = chain.game?.selectionAbortGeneration ?? 0;
  while (state.actionIndex < actions.length) {
    const action = actions[state.actionIndex];
    if (!action) break;
    state.context.afterEffectResolution = { chainLevel: link.chainLevel, actionIndex: state.actionIndex };
    const result = await engine.applyActions([action], state.context, { ...state.targets, ...state.context._actionTargets });
    if ((chain.game?.selectionAbortGeneration ?? 0) !== generation) return { success: false, code: "SELECTION_ABORTED" };
    if (result.needsSelection) return { ...result, selectionSource: "after_resolution" };
    state.actionIndex++;
    if (result.success === false) {
      state.completed = true;
      return { ...state.primaryResult, ...result };
    }
  }
  state.completed = true;
  return state.primaryResult;
}

export function isPostEffectTriggerBarrierActive(this: FullChainHost): boolean {
  return this.suspendedChainFrames.length > 0;
}

/** Only the completed CL1 may open a separate summon-attempt timing frame. */
export async function runPostEffectSummonAttempt(this: FullChainHost, input: FastEffectTimingInput): Promise<ChainOperationResult> {
  const link = this.currentResolvingLink;
  if (input.origin !== FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT || !link?.afterResolution ||
    !link.afterResolution.context.afterEffectResolution || link.afterResolution.completed || link.chainLevel !== 1) {
    return { success: false, ok: false, reason: "post_effect_summon_timing_unavailable" };
  }
  const frame: SuspendedChainFrame = {
    chainStack: this.chainStack, chainWindowContext: this.chainWindowContext,
    chainWindowOpen: this.chainWindowOpen, isResolving: this.isResolving,
    currentChainLevel: this.currentChainLevel, activeChainId: this.activeChainId,
    currentResolvingLink: this.currentResolvingLink, cardsBeingResolved: this.cardsBeingResolved,
    pendingChainSelection: this.pendingChainSelection, isPreparingActivation: this.isPreparingActivation,
    activeResponseAbortController: this.activeResponseAbortController,
    chainEventCompletions: this.chainEventCompletions, chainTriggerEffectsOffered: this.chainTriggerEffectsOffered,
    pendingChainFinalizations: this.pendingChainFinalizations, isFinalizingChain: this.isFinalizingChain,
    currentFinalizingLink: this.currentFinalizingLink, activeTriggerOpportunity: this.activeTriggerOpportunity,
    pendingTriggerSelection: this.pendingTriggerSelection, fastEffectState: this.fastEffectState,
    activeTimingWindowId: this.activeTimingWindowId, timingDepth: this.timingDepth,
  };
  this.suspendedChainFrames.push(frame);
  const childFrame: SuspendedChainFrame = {
    chainStack: [], chainWindowContext: null, chainWindowOpen: false, isResolving: false,
    currentChainLevel: 0, activeChainId: null, currentResolvingLink: null, cardsBeingResolved: new Set<ChainCard>(),
    pendingChainSelection: null, isPreparingActivation: false, activeResponseAbortController: null,
    chainEventCompletions: [], chainTriggerEffectsOffered: new Map<ChainCard, Set<ChainEffect>>(), pendingChainFinalizations: [],
    isFinalizingChain: false, currentFinalizingLink: null, activeTriggerOpportunity: null,
    pendingTriggerSelection: null, fastEffectState: { ...frame.fastEffectState, phaseIntent: null },
    activeTimingWindowId: null, timingDepth: 0,
  };
  Object.assign(this, childFrame);
  try {
    return await this.runFastEffectTiming(input);
  } finally {
    // Teardown cancels all frames. Never resurrect a cancelled parental Chain.
    if (this.suspendedChainFrames.at(-1) === frame) {
      this.suspendedChainFrames.pop();
      Object.assign(this, frame);
    }
  }
}

function resultIdentities(targets: ChainSelectionMap | undefined): Record<string, (number | null)[]> {
  const result: Record<string, (number | null)[]> = {};
  for (const [key, value] of Object.entries(targets || {})) {
    const cards = Array.isArray(value) ? value : [value];
    result[key] = cards.map(card => {
      const id: unknown = card && typeof card === "object" ? Reflect.get(card, "duelCardId") : null;
      return typeof id === "number" ? id : null;
    });
  }
  return result;
}

export function getAfterResolutionState(this: FullChainHost): object | null {
  const cards = this.game ? [this.game.player, this.game.bot].flatMap(player => [
    ...player.deck, ...player.extraDeck, ...player.hand, ...player.field, ...player.spellTrap, ...player.graveyard,
    ...player.banished, ...(player.fieldSpell ? [player.fieldSpell] : []),
  ]) : [];
  const projectLink = (link: ChainLink) => ({
    chainId: link.chainId, linkId: link.linkId, chainLevel: link.chainLevel,
    cardDuelCardId: link.card.duelCardId ?? null, cardId: link.card.id ?? null,
    controllerId: link.controller.id, effectId: link.effectId,
    resolutionStatus: link.resolutionStatus, finalizationStatus: link.finalizationStatus,
    sourceMoved: link.sourceMoved, sourceDestroyed: link.sourceDestroyed,
    sourceAtActivation: projectAfterResolutionSource(link.afterResolution?.context.activationContext?.sourceAtActivation || link.sourceAtActivation,
      link.card.duelCardId ?? null),
    ...(link.referenceSnapshots ? { referenceSnapshots: projectAfterResolutionReferences(link.referenceSnapshots) } : {}),
    costSelections: resultIdentities(link.afterResolution?.context.activationContext?.costSelections || link.costSelections),
    ...(link.afterResolution?.context.activationContext?.decisions ? {
      decisions: serializeChainResponseDecisions(link.afterResolution.context.activationContext.decisions, id => {
        const card = [...cards, ...(link.afterResolution?.decisionCards || [])].find(card => String(card.instanceId) === String(id));
        return card ? this.game?.ensureDuelCardId?.(card) ?? card.duelCardId ?? null : null;
      }),
    } : {}),
    latestSourceLocation: link.latestSourceLocation ? {
      controllerId: link.latestSourceLocation.controllerId, zone: link.latestSourceLocation.zone,
      faceUp: link.latestSourceLocation.faceUp, locationVersion: link.latestSourceLocation.locationVersion,
    } : null,
    targetSelections: resultIdentities(link.targetSelections), resolutionSelections: resultIdentities(link.resolutionSelections),
    declaredTargetSnapshots: projectAfterResolutionReferences(link.declaredTargetSnapshots),
    costPayment: link.costPayment ? copyCostPayment(link.costPayment) : null,
  });
  const project = (link: ChainLink | null) => link?.afterResolution && !link.afterResolution.completed ? {
    stage: "after_resolution", link: projectLink(link), actionIndex: link.afterResolution.actionIndex,
    results: resultIdentities(link.afterResolution.context._actionTargets),
  } : null;
  const active = project(this.currentResolvingLink || this.pendingChainSelection?.link || null);
  if (!active && this.suspendedChainFrames.length === 0) return null;
  return {
    ...(active ? { active } : {}),
    ...(this.suspendedChainFrames.length ? { suspended: this.suspendedChainFrames.map(frame => ({
      chainId: frame.activeChainId, resolving: frame.isResolving, windowOpen: frame.chainWindowOpen,
      links: frame.chainStack.map(projectLink), timing: { ...frame.fastEffectState,
        phaseIntent: frame.fastEffectState.phaseIntent ? { ...frame.fastEffectState.phaseIntent } : null },
      afterResolution: project(frame.currentResolvingLink),
      selection: frame.pendingChainSelection ? { phase: frame.pendingChainSelection.phase || "resolution",
        link: projectLink(frame.pendingChainSelection.link),
        selections: resultIdentities(frame.pendingChainSelection.link.resolutionSelections) } : null,
      finalizations: frame.pendingChainFinalizations.map(entry => ({ status: entry.status, link: projectLink(entry.link) })),
    })) } : {}),
  };
}
