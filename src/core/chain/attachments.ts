import * as chainSpellSpeed from "./spellSpeed.js";
import * as chainStack from "./stack.js";
import * as chainResolution from "./resolution.js";
import * as chainEffectMatching from "./effectMatching.js";
import * as chainActivationDiscovery from "./activationDiscovery.js";
import * as chainResponseWindow from "./responseWindow.js";
import * as chainBotResponsePolicy from "./botResponsePolicy.js";
import * as chainPlayerResponse from "./playerResponse.js";
import * as chainSelection from "./selection.js";
import * as chainActivation from "./activation.js";
import * as chainLink from "./link.js";
import * as chainTiming from "./timing.js";
import * as chainSegoc from "./segoc.js";
import * as chainUsage from "./usage.js";
import * as chainFinalization from "./finalization.js";

import type { FullChainHost } from "../contracts/chainRuntime.js";

type ChainMethodReference = (
  this: FullChainHost,
  ...arguments_: never[]
) => unknown;

type CompatibleChainMethods<Methods> = {
  [Key in keyof Methods]: Key extends keyof FullChainHost
    ? Methods[Key] extends ChainMethodReference
      ? OmitThisParameter<Methods[Key]> extends FullChainHost[Key]
        ? Methods[Key]
        : never
      : never
    : never;
};

function defineChainMethods<
  const Methods extends Readonly<Record<string, ChainMethodReference>>,
>(methods: Methods & CompatibleChainMethods<Methods>): Methods {
  return Object.freeze(methods);
}

const linkMethods = defineChainMethods({
  createChainLink: chainLink.createChainLink,
  serializeChainLink: chainLink.serializeChainLink,
  markChainLinkActivationNegated: chainLink.markChainLinkActivationNegated,
  markChainLinkEffectNegated: chainLink.markChainLinkEffectNegated,
  recordChainSourceMovement: chainLink.recordChainSourceMovement,
  setChainLinkResolutionStatus: chainLink.setChainLinkResolutionStatus,
});

const usageMethods = defineChainMethods({
  getUsagePolicy: chainUsage.getUsagePolicy,
  checkActivationUsage: chainUsage.checkActivationUsage,
  reserveUsageForChainLink: chainUsage.reserveUsageForChainLink,
  settleUsageForChainLink: chainUsage.settleUsageForChainLink,
  releaseAllUsageReservations: chainUsage.releaseAllUsageReservations,
});

const finalizationMethods = defineChainMethods({
  queueChainFinalization: chainFinalization.queueChainFinalization,
  finalizeWholeChain: chainFinalization.finalizeWholeChain,
  getChainFinalizationState: chainFinalization.getChainFinalizationState,
  resetChainFinalizationState: chainFinalization.resetChainFinalizationState,
});

const timingMethods = defineChainMethods({
  getFastEffectState: chainTiming.getFastEffectState,
  transitionFastEffectState: chainTiming.transitionFastEffectState,
  resolveTimingPlayer: chainTiming.resolveTimingPlayer,
  isOpenGameState: chainTiming.isOpenGameState,
  resetFastEffectTiming: chainTiming.resetFastEffectTiming,
  recordFastEffectPriority: chainTiming.recordFastEffectPriority,
  runFastEffectTiming: chainTiming.runFastEffectTiming,
});

const segocMethods = defineChainMethods({
  allocateAtomicEventGroupId: chainSegoc.allocateAtomicEventGroupId,
  createTriggerOccurrence: chainSegoc.createTriggerOccurrence,
  queueTriggerOccurrence: chainSegoc.queueTriggerOccurrence,
  buildTriggerOpportunity: chainSegoc.buildTriggerOpportunity,
  collectTriggerCandidates: chainSegoc.collectTriggerCandidates,
  revalidateTriggerCandidate: chainSegoc.revalidateTriggerCandidate,
  orderTriggerCandidates: chainSegoc.orderTriggerCandidates,
  prepareTriggerOpportunity: chainSegoc.prepareTriggerOpportunity,
  prepareTriggerPackages: chainSegoc.prepareTriggerPackages,
  resolveTriggerOccurrences: chainSegoc.resolveTriggerOccurrences,
  getTriggerState: chainSegoc.getTriggerState,
  resetTriggerState: chainSegoc.resetTriggerState,
});

const spellSpeedMethods = defineChainMethods({
  getEffectSpellSpeed: chainSpellSpeed.getEffectSpellSpeed,
  getRequiredSpellSpeed: chainSpellSpeed.getRequiredSpellSpeed,
  canActivateInChain: chainSpellSpeed.canActivateInChain,
});

const effectMatchingMethods = defineChainMethods({
  effectCanRespondToContext: chainEffectMatching.effectCanRespondToContext,
  getCurrentChainActivationContext:
    chainEffectMatching.getCurrentChainActivationContext,
  getEffectChainResponseContext:
    chainEffectMatching.getEffectChainResponseContext,
  effectHasAction: chainEffectMatching.effectHasAction,
  isSummonNegationResponse: chainEffectMatching.isSummonNegationResponse,
  requiresExplicitSummonResponse:
    chainEffectMatching.requiresExplicitSummonResponse,
  isExplicitAfterSummonEventResponse:
    chainEffectMatching.isExplicitAfterSummonEventResponse,
  canOfferEffectInChainContext:
    chainEffectMatching.canOfferEffectInChainContext,
  findActivatableEffect: chainEffectMatching.findActivatableEffect,
  findQuickMonsterEffect: chainEffectMatching.findQuickMonsterEffect,
});

const activationDiscoveryMethods = defineChainMethods({
  getActivatableCardsInChain:
    chainActivationDiscovery.getActivatableCardsInChain,
  getEffectActivationZones:
    chainActivationDiscovery.getEffectActivationZones,
  getActivationCandidateKey:
    chainActivationDiscovery.getActivationCandidateKey,
  revalidateActivationCandidate:
    chainActivationDiscovery.revalidateActivationCandidate,
});

const activationMethods = defineChainMethods({
  createPreparedActivation: chainActivation.createPreparedActivation,
  effectRequiresSourceAtResolution:
    chainActivation.effectRequiresSourceAtResolution,
  getEffectActivationCosts: chainActivation.getEffectActivationCosts,
  getEffectActivationCommitActions:
    chainActivation.getEffectActivationCommitActions,
  getEffectResolutionActions: chainActivation.getEffectResolutionActions,
  payActivationCosts: chainActivation.payActivationCosts,
  applyActivationCommitActions: chainActivation.applyActivationCommitActions,
  publishChainLinkActivation: chainActivation.publishChainLinkActivation,
  appendActivationTriggerPackages:
    chainActivation.appendActivationTriggerPackages,
  completeActivationTriggerPackages:
    chainActivation.completeActivationTriggerPackages,
  prepareChainResponse: chainActivation.prepareChainResponse,
  openActivationChain: chainActivation.openActivationChain,
  openEventWindow: chainActivation.openEventWindow,
});

const responseWindowMethods = defineChainMethods({
  openChainWindow: chainResponseWindow.openChainWindow,
  offerChainResponses: chainResponseWindow.offerChainResponses,
  offerChainResponse: chainResponseWindow.offerChainResponse,
});

const botResponsePolicyMethods = defineChainMethods({
  botChooseChainResponse: chainBotResponsePolicy.botChooseChainResponse,
});

const playerResponseMethods = defineChainMethods({
  playerChooseChainResponse: chainPlayerResponse.playerChooseChainResponse,
});

const selectionMethods = defineChainMethods({
  effectRequiresTargets: chainSelection.effectRequiresTargets,
  getActivationCostTargetDefinitions:
    chainSelection.getActivationCostTargetDefinitions,
  getDeclaredTargetDefinitions: chainSelection.getDeclaredTargetDefinitions,
  getPlayerSelectionsForDefinitions:
    chainSelection.getPlayerSelectionsForDefinitions,
  getPlayerSelectionsForEffect: chainSelection.getPlayerSelectionsForEffect,
  resolveSelectionsToCards: chainSelection.resolveSelectionsToCards,
});

const stackMethods = defineChainMethods({
  addToChain: chainStack.addToChain,
  isChainWindowOpen: chainStack.isChainWindowOpen,
  getChainLength: chainStack.getChainLength,
  getLastChainLink: chainStack.getLastChainLink,
  isChainResolving: chainStack.isChainResolving,
  cancelChain: chainStack.cancelChain,
  getChainSummary: chainStack.getChainSummary,
});

const resolutionMethods = defineChainMethods({
  resolveChain: chainResolution.resolveChain,
  resolveChainLink: chainResolution.resolveChainLink,
  startPendingChainSelection: chainResolution.startPendingChainSelection,
  resumePendingChainSelection: chainResolution.resumePendingChainSelection,
  getChainSourceValidity: chainResolution.getChainSourceValidity,
  isCardStillValid: chainResolution.isCardStillValid,
  determineCardZone: chainResolution.determineCardZone,
});

export const CHAIN_ATTACHMENT_GROUPS = Object.freeze([
  Object.freeze({ id: "link", methods: linkMethods }),
  Object.freeze({ id: "usage", methods: usageMethods }),
  Object.freeze({ id: "finalization", methods: finalizationMethods }),
  Object.freeze({ id: "timing", methods: timingMethods }),
  Object.freeze({ id: "segoc", methods: segocMethods }),
  Object.freeze({ id: "spellSpeed", methods: spellSpeedMethods }),
  Object.freeze({ id: "effectMatching", methods: effectMatchingMethods }),
  Object.freeze({
    id: "activationDiscovery",
    methods: activationDiscoveryMethods,
  }),
  Object.freeze({ id: "activation", methods: activationMethods }),
  Object.freeze({ id: "responseWindow", methods: responseWindowMethods }),
  Object.freeze({
    id: "botResponsePolicy",
    methods: botResponsePolicyMethods,
  }),
  Object.freeze({ id: "playerResponse", methods: playerResponseMethods }),
  Object.freeze({ id: "selection", methods: selectionMethods }),
  Object.freeze({ id: "stack", methods: stackMethods }),
  Object.freeze({ id: "resolution", methods: resolutionMethods }),
] as const);

export const CHAIN_METHOD_MANIFEST = Object.freeze({
  ...linkMethods,
  ...usageMethods,
  ...finalizationMethods,
  ...timingMethods,
  ...segocMethods,
  ...spellSpeedMethods,
  ...effectMatchingMethods,
  ...activationDiscoveryMethods,
  ...activationMethods,
  ...responseWindowMethods,
  ...botResponsePolicyMethods,
  ...playerResponseMethods,
  ...selectionMethods,
  ...stackMethods,
  ...resolutionMethods,
});

type MethodWithoutThis<Value> = Value extends ChainMethodReference
  ? OmitThisParameter<Value>
  : never;

export type ChainAttachedMethods = {
  -readonly [Key in keyof typeof CHAIN_METHOD_MANIFEST]: MethodWithoutThis<
    (typeof CHAIN_METHOD_MANIFEST)[Key]
  >;
};

export interface ChainAttachmentGroupInput {
  readonly id: string;
  readonly methods: Readonly<Record<string, unknown>>;
}

export interface ChainAttachmentEntry {
  readonly group: string;
  readonly name: string;
  readonly method: ChainMethodReference;
  readonly alreadyAttached: boolean;
}

function isChainMethodReference(value: unknown): value is ChainMethodReference {
  return typeof value === "function";
}

export function preflightChainAttachments(
  prototype: object,
  groups: readonly ChainAttachmentGroupInput[] = CHAIN_ATTACHMENT_GROUPS,
): ChainAttachmentEntry[] {
  const entries: ChainAttachmentEntry[] = [];
  const names = new Set<string>();

  for (const group of groups) {
    if (!group.id) {
      throw new TypeError("Chain attachment groups require a non-empty id.");
    }
    for (const [name, method] of Object.entries(group.methods)) {
      if (!isChainMethodReference(method)) {
        throw new TypeError(
          `Chain attachment ${group.id}.${name} is not a function.`,
        );
      }
      if (names.has(name)) {
        throw new TypeError(`Duplicate Chain attachment: ${name}.`);
      }
      names.add(name);

      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (descriptor && descriptor.value !== method) {
        throw new TypeError(`Incompatible Chain prototype collision: ${name}.`);
      }
      entries.push({
        group: group.id,
        name,
        method,
        alreadyAttached: descriptor?.value === method,
      });
    }
  }

  const hasNewAttachment = entries.some((entry) => !entry.alreadyAttached);
  if (hasNewAttachment && !Object.isExtensible(prototype)) {
    throw new TypeError("Chain prototype is not extensible.");
  }
  return entries;
}

export function attachChainMethods(
  prototype: object,
  groups: readonly ChainAttachmentGroupInput[] = CHAIN_ATTACHMENT_GROUPS,
): void {
  const entries = preflightChainAttachments(prototype, groups);
  for (const entry of entries) {
    if (entry.alreadyAttached) continue;
    if (!Reflect.set(prototype, entry.name, entry.method)) {
      throw new TypeError(`Unable to attach Chain method: ${entry.name}.`);
    }
  }
}

export const CHAIN_METHOD_NAMES = Object.freeze(
  Object.keys(CHAIN_METHOD_MANIFEST),
);

if (CHAIN_METHOD_NAMES.length !== 89) {
  throw new TypeError(
    `Chain attachment manifest must contain 89 methods; received ${CHAIN_METHOD_NAMES.length}.`,
  );
}
