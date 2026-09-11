import * as devToolsCommands from "./devTools/commands.js";
import * as devToolsSetup from "./devTools/setup.js";
import * as eventBus from "./events/eventBus.js";
import * as eventResolver from "./events/eventResolver.js";
import * as selectionContract from "./selection/contract.js";
import * as selectionHighlighting from "./selection/highlighting.js";
import * as selectionSession from "./selection/session.js";
import * as selectionHandlers from "./selection/handlers.js";
import * as zonesOwnership from "./zones/ownership.js";
import * as zonesSnapshot from "./zones/snapshot.js";
import * as zonesInvariants from "./zones/invariants.js";
import * as zonesOperations from "./zones/operations.js";
import * as zonesMovement from "./zones/movement.js";
import * as zonesControl from "./zones/control.js";
import * as zonesDestruction from "./zones/destruction.js";
import * as combatIndicators from "./combat/indicators.js";
import * as combatAvailability from "./combat/availability.js";
import * as combatDamage from "./combat/damage.js";
import * as combatTargeting from "./combat/targeting.js";
import * as combatResolution from "./combat/resolution.js";
import * as combatDamageStep from "./combat/damageStep.js";
import * as summonTracking from "./summon/tracking.js";
import * as summonExecution from "./summon/execution.js";
import * as summonTransaction from "./summon/transaction.js";
import * as summonAscension from "./summon/ascension.js";
import * as summonSynchro from "./summon/synchro.js";
import * as summonPosition from "./summon/position.js";
import * as summonMaterialStats from "./summon/materialStats.js";
import * as deckDraw from "./deck/draw.js";
import * as graveyardModal from "./graveyard/modal.js";
import * as extraDeckModal from "./extraDeck/modal.js";
import * as turnScheduling from "./turn/scheduling.js";
import * as turnCleanup from "./turn/cleanup.js";
import * as turnLifecycle from "./turn/lifecycle.js";
import * as turnPhaseRules from "./turn/phaseRules.js";
import * as turnTransitions from "./turn/transitions.js";
import * as turnOncePerTurn from "./turn/oncePerTurn.js";
import * as actionsGuard from "./actions/guard.js";
import * as stateDuelReset from "./state/duelReset.js";
import * as stateSerialization from "./state/serialization.js";
import * as helpersPlayers from "./helpers/players.js";
import * as helpersCards from "./helpers/cards.js";
import * as spellTrapSet from "./spellTrap/set.js";
import * as spellTrapActivation from "./spellTrap/activation.js";
import * as spellTrapFinalization from "./spellTrap/finalization.js";
import * as spellTrapVerification from "./spellTrap/verification.js";
import * as spellTrapTriggers from "./spellTrap/triggers.js";
import * as uiBoard from "./ui/board.js";
import * as uiCardAnimations from "./ui/cardAnimations.js";
import * as uiIndicators from "./ui/indicators.js";
import * as uiModals from "./ui/modals.js";
import * as uiPrompts from "./ui/prompts.js";
import * as uiWinCondition from "./ui/winCondition.js";
import * as uiInteractions from "./ui/interactions.js";
import * as strategicReport from "./analytics/strategicReport.js";
import * as effectsDestructionReplacement from "./effects/destructionReplacement.js";
import * as effectsActivationRestrictions from "./effects/activationRestrictions.js";
import * as effectsActivationPipeline from "./effects/activationPipeline.js";
import * as effectsUsage from "./effects/usage.js";
import "./decisions/broker.js";
import "./random.js";
import * as canonicalReplay from "./replay/recorder.js";
import type { MoveCardFunction } from "../contracts/gameRuntime.js";

type GameAttachmentMethod = (
  this: never,
  ...arguments_: never[]
) => unknown;

type GameAttachmentEntry = readonly [
  name: string,
  method: GameAttachmentMethod,
];

function group<
  const Name extends string,
  const Entries extends readonly GameAttachmentEntry[],
>(name: Name, entries: Entries) {
  return Object.freeze({
    name,
    entries: Object.freeze(entries),
  });
}

export const GAME_ATTACHMENT_GROUPS = Object.freeze([
  group("devToolsCommands", [
    ["devDraw", devToolsCommands.devDraw],
    ["devGiveCard", devToolsCommands.devGiveCard],
    ["devForcePhase", devToolsCommands.devForcePhase],
    ["devGetSelectionCleanupState", devToolsCommands.devGetSelectionCleanupState],
    ["devForceTargetCleanup", devToolsCommands.devForceTargetCleanup],
    ["devAutoConfirmTargetSelection", devToolsCommands.devAutoConfirmTargetSelection],
  ]),
  group("devToolsSetup", [
    ["applyManualSetup", devToolsSetup.applyManualSetup],
    ["applyScenarioSetup", devToolsSetup.applyScenarioSetup],
  ]),
  group("eventBus", [
    ["on", eventBus.on],
    ["emit", eventBus.emit],
    ["notify", eventBus.notify],
    ["emitEffectActivated", eventBus.emitEffectActivated],
  ]),
  group("eventResolver", [
    ["resolveEvent", eventResolver.resolveEvent],
    ["resolveEventEntries", eventResolver.resolveEventEntries],
    ["resumePendingEventSelection", eventResolver.resumePendingEventSelection],
    ["queueTriggerOccurrence", eventResolver.queueTriggerOccurrence],
    ["flushPendingTriggerOccurrences", eventResolver.flushPendingTriggerOccurrences],
  ]),
  group("selectionContract", [
    ["buildSelectionCandidateKey", selectionContract.buildSelectionCandidateKey],
    ["normalizeSelectionContract", selectionContract.normalizeSelectionContract],
    ["canUseFieldTargeting", selectionContract.canUseFieldTargeting],
  ]),
  group("selectionHighlighting", [
    ["clearTargetHighlights", selectionHighlighting.clearTargetHighlights],
    ["setSelectionDimming", selectionHighlighting.setSelectionDimming],
    ["updateFieldTargetingProgress", selectionHighlighting.updateFieldTargetingProgress],
    ["highlightTargetCandidates", selectionHighlighting.highlightTargetCandidates],
  ]),
  group("selectionSession", [
    ["setSelectionState", selectionSession.setSelectionState],
    ["forceClearTargetSelection", selectionSession.forceClearTargetSelection],
    ["startTargetSelectionSession", selectionSession.startTargetSelectionSession],
    ["advanceTargetSelection", selectionSession.advanceTargetSelection],
    ["finishTargetSelection", selectionSession.finishTargetSelection],
    ["cancelTargetSelection", selectionSession.cancelTargetSelection],
  ]),
  group("selectionHandlers", [
    ["handleTargetSelectionClick", selectionHandlers.handleTargetSelectionClick],
    ["askPlayerToSelectCards", selectionHandlers.askPlayerToSelectCards],
  ]),
  group("zonesOwnership", [
    ["normalizeRelativePlayerId", zonesOwnership.normalizeRelativePlayerId],
    ["normalizeCardOwnership", zonesOwnership.normalizeCardOwnership],
    ["normalizeZoneCardOwnership", zonesOwnership.normalizeZoneCardOwnership],
  ]),
  group("zonesSnapshot", [
    ["snapshotCardState", zonesSnapshot.snapshotCardState],
    ["collectAllZoneCards", zonesSnapshot.collectAllZoneCards],
    ["captureZoneSnapshot", zonesSnapshot.captureZoneSnapshot],
    ["restoreZoneSnapshot", zonesSnapshot.restoreZoneSnapshot],
    ["compareZoneSnapshot", zonesSnapshot.compareZoneSnapshot],
  ]),
  group("zonesInvariants", [
    ["assertStateInvariants", zonesInvariants.assertStateInvariants],
    ["inspectZoneNullishCards", zonesInvariants.inspectZoneNullishCards],
    ["recoverNullishZoneCards", zonesInvariants.recoverNullishZoneCards],
  ]),
  group("zonesOperations", [
    ["getZone", zonesOperations.getZone],
    ["runZoneOp", zonesOperations.runZoneOp],
  ]),
  group("zonesDestruction", [
    ["destroyCard", zonesDestruction.destroyCard],
    ["isBattleDestructionProtected", zonesDestruction.isBattleDestructionProtected],
  ]),
  group("effectsDestructionReplacement", [
    ["resolveDestructionWithReplacement", effectsDestructionReplacement.resolveDestructionWithReplacement],
  ]),
  group("effectsActivationRestrictions", [
    ["registerEffectActivationRestriction", effectsActivationRestrictions.registerEffectActivationRestriction],
    ["cleanupExpiredEffectActivationRestrictions", effectsActivationRestrictions.cleanupExpiredEffectActivationRestrictions],
    ["canActivateCardEffectUnderRestrictions", effectsActivationRestrictions.canActivateCardEffectUnderRestrictions],
  ]),
  group("effectsActivationPipeline", [
    ["normalizeActivationResult", effectsActivationPipeline.normalizeActivationResult],
    ["createActionResult", effectsActivationPipeline.createActionResult],
    ["runActivationPipeline", effectsActivationPipeline.runActivationPipeline],
    ["runActivationPipelineWait", effectsActivationPipeline.runActivationPipelineWait],
  ]),
  group("zonesMovement", [
    ["cleanupTokenReferences", zonesMovement.cleanupTokenReferences],
    ["registerSpecialSummonRestriction", zonesMovement.registerSpecialSummonRestriction],
    ["cleanupExpiredSpecialSummonRestrictions", zonesMovement.cleanupExpiredSpecialSummonRestrictions],
    ["canSpecialSummonUnderRestrictions", zonesMovement.canSpecialSummonUnderRestrictions],
    ["canPlaceCardOnField", zonesMovement.canPlaceCardOnField],
    ["applyPendingSynchroMaterialFollowups", zonesMovement.applyPendingSynchroMaterialFollowups],
    ["moveCard", zonesMovement.moveCard],
    ["moveCardInternal", zonesMovement.moveCardInternal],
  ]),
  group("zonesControl", [
    ["transferControl", zonesControl.transferControl],
    ["takeControl", zonesControl.takeControl],
    ["registerTemporaryControl", zonesControl.registerTemporaryControl],
    ["processTemporaryControlEffects", zonesControl.processTemporaryControlEffects],
    ["getTemporaryControlState", zonesControl.getTemporaryControlState],
  ]),
  group("combatIndicators", [
    ["updateAttackIndicators", combatIndicators.updateAttackIndicators],
    ["clearAttackReadyIndicators", combatIndicators.clearAttackReadyIndicators],
    ["applyAttackResolutionIndicators", combatIndicators.applyAttackResolutionIndicators],
    ["clearAttackResolutionIndicators", combatIndicators.clearAttackResolutionIndicators],
  ]),
  group("combatAvailability", [
    ["getAttackAvailability", combatAvailability.getAttackAvailability],
    ["getMonsterAttackLimit", combatAvailability.getMonsterAttackLimit],
    ["hasExplicitAttackLimitThisTurn", combatAvailability.hasExplicitAttackLimitThisTurn],
    ["isActiveAttackPriorityTarget", combatAvailability.isActiveAttackPriorityTarget],
    ["markAttackUsed", combatAvailability.markAttackUsed],
    ["registerAttackNegated", combatAvailability.registerAttackNegated],
    ["isBattleDestructionPreventionNegated", combatAvailability.isBattleDestructionPreventionNegated],
    ["canDestroyByBattle", combatAvailability.canDestroyByBattle],
  ]),
  group("combatDamage", [
    ["inflictDamage", combatDamage.inflictDamage],
  ]),
  group("combatTargeting", [
    ["startAttackTargetSelection", combatTargeting.startAttackTargetSelection],
  ]),
  group("combatResolution", [
    ["resolveCombat", combatResolution.resolveCombat],
  ]),
  group("combatDamageStep", [
    ["createDamageStepTransaction", combatDamageStep.createDamageStepTransaction],
    ["executeDamageStepTransaction", combatDamageStep.executeDamageStepTransaction],
    ["getDamageStepState", combatDamageStep.getDamageStepState],
    ["cleanupDamageStepTransaction", combatDamageStep.cleanupDamageStepTransaction],
    ["clearDamageCalculationBuffs", combatDamageStep.clearDamageCalculationBuffs],
    ["clearEndOfDamageStepBuffs", combatDamageStep.clearEndOfDamageStepBuffs],
  ]),
  group("summonTracking", [
    ["_trackSpecialSummonType", summonTracking._trackSpecialSummonType],
    ["getSpecialSummonedTypeCount", summonTracking.getSpecialSummonedTypeCount],
    ["resolveDelayedSummon", summonTracking.resolveDelayedSummon],
  ]),
  group("summonTransaction", [
    ["createPreparedSummon", summonTransaction.createPreparedSummon],
    ["beginSummonTransaction", summonTransaction.beginSummonTransaction],
    ["markSummonAwaitingNegation", summonTransaction.markSummonAwaitingNegation],
    ["markSummonNegated", summonTransaction.markSummonNegated],
    ["finishSummonTransaction", summonTransaction.finishSummonTransaction],
    ["cleanupSummonTransaction", summonTransaction.cleanupSummonTransaction],
    ["getSummonState", summonTransaction.getSummonState],
    ["executeSummonTransaction", summonTransaction.executeSummonTransaction],
    ["holdSummonTimingState", summonTransaction.holdSummonTimingState],
  ]),
  group("summonExecution", [
    ["flipSummon", summonExecution.flipSummon],
    ["offerSummonAttempt", summonExecution.offerSummonAttempt],
    ["performNormalSummon", summonExecution.performNormalSummon],
    ["performFusionSummon", summonExecution.performFusionSummon],
    ["performSpecialSummon", summonExecution.performSpecialSummon],
  ]),
  group("summonPosition", [
    ["canFlipSummon", summonPosition.canFlipSummon],
    ["canChangePosition", summonPosition.canChangePosition],
    ["changeMonsterPosition", summonPosition.changeMonsterPosition],
  ]),
  group("summonMaterialStats", [
    ["resetMaterialDuelStats", summonMaterialStats.resetMaterialDuelStats],
    ["incrementMaterialStat", summonMaterialStats.incrementMaterialStat],
    ["recordMaterialEffectActivation", summonMaterialStats.recordMaterialEffectActivation],
    ["recordMaterialDestroyedOpponentMonster", summonMaterialStats.recordMaterialDestroyedOpponentMonster],
  ]),
  group("summonAscension", [
    ["getMaterialFieldAgeTurnCounter", summonAscension.getMaterialFieldAgeTurnCounter],
    ["getAscensionCandidatesForMaterial", summonAscension.getAscensionCandidatesForMaterial],
    ["checkAscensionRequirements", summonAscension.checkAscensionRequirements],
    ["canUseAsAscensionMaterial", summonAscension.canUseAsAscensionMaterial],
    ["performAscensionSummon", summonAscension.performAscensionSummon],
    ["tryAscensionSummon", summonAscension.tryAscensionSummon],
  ]),
  group("summonSynchro", [
    ["canUseAsSynchroMaterial", summonSynchro.canUseAsSynchroMaterial],
    ["getSynchroMaterialCombos", summonSynchro.getSynchroMaterialCombos],
    ["canSummonSynchroCard", summonSynchro.canSummonSynchroCard],
    ["performSynchroSummon", summonSynchro.performSynchroSummon],
    ["performSynchroSummonFromExtraDeck", summonSynchro.performSynchroSummonFromExtraDeck],
    ["finishPendingSynchroMaterialTriggerContinuation", summonSynchro.finishPendingSynchroMaterialTriggerContinuation],
  ]),
  group("deckDraw", [
    ["drawCards", deckDraw.drawCards],
    ["forceOpeningHand", deckDraw.forceOpeningHand],
  ]),
  group("graveyardModal", [
    ["openGraveyardModal", graveyardModal.openGraveyardModal],
    ["closeGraveyardModal", graveyardModal.closeGraveyardModal],
  ]),
  group("extraDeckModal", [
    ["openExtraDeckModal", extraDeckModal.openExtraDeckModal],
    ["closeExtraDeckModal", extraDeckModal.closeExtraDeckModal],
    ["canSummonExtraDeckCardByProcedure", extraDeckModal.canSummonExtraDeckCardByProcedure],
    ["performExtraDeckSummonProcedure", extraDeckModal.performExtraDeckSummonProcedure],
    ["canSummonAscensionCardFromExtraDeck", extraDeckModal.canSummonAscensionCardFromExtraDeck],
    ["performAscensionSummonFromExtraDeck", extraDeckModal.performAscensionSummonFromExtraDeck],
    ["canSummonExtraDeckCard", extraDeckModal.canSummonExtraDeckCard],
  ]),
  group("turnScheduling", [
    ["scheduleDelayedAction", turnScheduling.scheduleDelayedAction],
    ["processDelayedActions", turnScheduling.processDelayedActions],
    ["resolveDelayedAction", turnScheduling.resolveDelayedAction],
  ]),
  group("turnCleanup", [
    ["applyTurnBasedBuff", turnCleanup.applyTurnBasedBuff],
    ["cleanupExpiredBuffs", turnCleanup.cleanupExpiredBuffs],
    ["cleanupExpiredDeclaredValues", turnCleanup.cleanupExpiredDeclaredValues],
    ["cleanupExpiredEffectMarkers", turnCleanup.cleanupExpiredEffectMarkers],
    ["cleanupExpiredTemporaryBattlePairEffects", turnCleanup.cleanupExpiredTemporaryBattlePairEffects],
    ["cleanupExpiredTemporaryEventEffects", turnCleanup.cleanupExpiredTemporaryEventEffects],
    ["cleanupTempBoosts", turnCleanup.cleanupTempBoosts],
  ]),
  group("turnOncePerTurn", [
    ["resetOncePerTurnUsage", turnOncePerTurn.resetOncePerTurnUsage],
    ["ensureOncePerTurnUsageFresh", turnOncePerTurn.ensureOncePerTurnUsageFresh],
    ["getOncePerTurnLockKey", turnOncePerTurn.getOncePerTurnLockKey],
    ["getOncePerTurnStore", turnOncePerTurn.getOncePerTurnStore],
    ["canUseOncePerTurn", turnOncePerTurn.canUseOncePerTurn],
    ["markOncePerTurnUsed", turnOncePerTurn.markOncePerTurnUsed],
  ]),
  group("effectsUsage", [
    ["checkEffectUsage", effectsUsage.checkEffectUsage],
    ["reserveEffectUsage", effectsUsage.reserveEffectUsage],
    ["settleEffectUsage", effectsUsage.settleEffectUsage],
    ["releaseEffectUsageReservations", effectsUsage.releaseEffectUsageReservations],
    ["getEffectUsageState", effectsUsage.getEffectUsageState],
  ]),
  group("actionsGuard", [
    ["canStartAction", actionsGuard.canStartAction],
    ["guardActionStart", actionsGuard.guardActionStart],
  ]),
  group("stateDuelReset", [
    ["resetPlayerDuelState", stateDuelReset.resetPlayerDuelState],
    ["resetDuelState", stateDuelReset.resetDuelState],
  ]),
  group("stateSerialization", [
    ["getPublicState", stateSerialization.getPublicState],
  ]),
  group("helpersPlayers", [
    ["getOpponent", helpersPlayers.getOpponent],
    ["resolvePlayerById", helpersPlayers.resolvePlayerById],
  ]),
  group("helpersCards", [
    ["resolveCardData", helpersCards.resolveCardData],
    ["createCardForOwner", helpersCards.createCardForOwner],
    ["setMonsterFacing", helpersCards.setMonsterFacing],
  ]),
  group("turnLifecycle", [
    ["startTurn", turnLifecycle.startTurn],
    ["endTurn", turnLifecycle.endTurn],
    ["waitForPhaseDelay", turnLifecycle.waitForPhaseDelay],
  ]),
  group("turnTransitions", [
    ["nextPhase", turnTransitions.nextPhase],
    ["skipToPhase", turnTransitions.skipToPhase],
  ]),
  group("turnPhaseRules", [
    ["isFirstTurnOfDuel", turnPhaseRules.isFirstTurnOfDuel],
    ["canEnterBattlePhase", turnPhaseRules.canEnterBattlePhase],
    ["getNextPhase", turnPhaseRules.getNextPhase],
  ]),
  group("spellTrapSet", [
    ["setSpellOrTrap", spellTrapSet.setSpellOrTrap],
  ]),
  group("spellTrapActivation", [
    ["tryActivateSpellTrapEffect", spellTrapActivation.tryActivateSpellTrapEffect],
    ["finalizeSpellCardActivation", spellTrapActivation.finalizeSpellCardActivation],
    ["tryActivateSpell", spellTrapActivation.tryActivateSpell],
    ["activateFieldSpellEffect", spellTrapActivation.activateFieldSpellEffect],
    ["presentSpellTrapActivationFlip", spellTrapActivation.presentSpellTrapActivationFlip],
  ]),
  group("spellTrapFinalization", [
    ["finalizeSpellTrapActivation", spellTrapFinalization.finalizeSpellTrapActivation],
    ["resolvePendingSpellTrapFinalization", spellTrapFinalization.resolvePendingSpellTrapFinalization],
    ["commitCardActivationFromHand", spellTrapFinalization.commitCardActivationFromHand],
    ["rollbackSpellActivation", spellTrapFinalization.rollbackSpellActivation],
    ["rollbackFieldSpellTrapActivation", spellTrapFinalization.rollbackFieldSpellTrapActivation],
  ]),
  group("spellTrapVerification", [
    ["canActivateTrap", spellTrapVerification.canActivateTrap],
    ["canActivatePolymerization", spellTrapVerification.canActivatePolymerization],
  ]),
  group("spellTrapTriggers", [
    ["checkAndOfferTraps", spellTrapTriggers.checkAndOfferTraps],
    ["_mapEventToChainContext", spellTrapTriggers._mapEventToChainContext],
    ["activateTrapFromZone", spellTrapTriggers.activateTrapFromZone],
  ]),
  group("uiBoard", [
    ["updateBoard", uiBoard.updateBoard],
    ["highlightReadySpecialSummon", uiBoard.highlightReadySpecialSummon],
  ]),
  group("uiCardAnimations", [
    ["queueCardAnimation", uiCardAnimations.queueCardAnimation],
    ["queueVisualFeedback", uiCardAnimations.queueVisualFeedback],
    ["waitForAiPresentationStep", uiCardAnimations.waitForAiPresentationStep],
    ["waitForPresentationDelay", uiCardAnimations.waitForPresentationDelay],
    ["waitForBoardPresentation", uiCardAnimations.waitForBoardPresentation],
  ]),
  group("uiIndicators", [
    ["updateActivationIndicators", uiIndicators.updateActivationIndicators],
    ["buildActivationIndicatorsForPlayer", uiIndicators.buildActivationIndicatorsForPlayer],
  ]),
  group("uiModals", [
    ["showIgnitionActivateModal", uiModals.showIgnitionActivateModal],
    ["showShadowHeartCathedralModal", uiModals.showShadowHeartCathedralModal],
  ]),
  group("uiPrompts", [
    ["chooseSpecialSummonPosition", uiPrompts.chooseSpecialSummonPosition],
  ]),
  group("uiWinCondition", [
    ["checkWinCondition", uiWinCondition.checkWinCondition],
  ]),
  group("uiInteractions", [
    ["bindCardInteractions", uiInteractions.bindCardInteractions],
  ]),
  group("strategicReport", [
    ["startNormalDuelStrategicReport", strategicReport.startNormalDuelStrategicReport],
    ["finalizeNormalDuelStrategicReport", strategicReport.finalizeNormalDuelStrategicReport],
    ["hasStrategicReport", strategicReport.hasStrategicReport],
    ["exportStrategicReport", strategicReport.exportStrategicReport],
    ["buildStrategicReportFilename", strategicReport.buildStrategicReportFilename],
    ["downloadStrategicReport", strategicReport.downloadStrategicReport],
  ]),
  group("canonicalReplay", [
    ["startReplayRecording", canonicalReplay.startReplayRecording],
    ["captureReplaySetup", canonicalReplay.captureReplaySetup],
    ["recordReplayCommand", canonicalReplay.recordReplayCommand],
    ["recordReplayDecision", canonicalReplay.recordReplayDecision],
    ["recordReplayEvent", canonicalReplay.recordReplayEvent],
    ["finalizeReplay", canonicalReplay.finalizeReplay],
    ["exportReplay", canonicalReplay.exportReplay],
    ["hasCanonicalReplay", canonicalReplay.hasCanonicalReplay],
  ]),
]);

type GameAttachmentEntryUnion =
  (typeof GAME_ATTACHMENT_GROUPS)[number]["entries"][number];

export type GameAttachmentName = GameAttachmentEntryUnion[0];

type GameAttachmentMethodFor<Name extends GameAttachmentName> = Extract<
  GameAttachmentEntryUnion,
  readonly [Name, GameAttachmentMethod]
>[1];

type TypedGameEventListener = <
  Name extends import("../contracts/events.js").RuntimeEventName,
>(
  eventName: Name,
  handler: import("../contracts/events.js").EventListener<Name>,
) => void;

export type GameAttachedMethods = {
  [Name in GameAttachmentName]: Name extends "moveCard"
    ? MoveCardFunction
    : Name extends "on"
      ? TypedGameEventListener
      : OmitThisParameter<GameAttachmentMethodFor<Name>>;
};

export const GAME_ATTACHMENT_NAMES = Object.freeze(
  GAME_ATTACHMENT_GROUPS.flatMap(({ entries }) =>
    entries.map(([name]) => name),
  ),
);

export interface GameAttachmentGroupInput {
  readonly name: string;
  readonly entries: readonly (readonly [name: string, method: unknown])[];
}

function collectGameAttachmentEntries(
  groups: readonly GameAttachmentGroupInput[],
): Array<readonly [name: string, method: unknown]> {
  const entries: Array<readonly [name: string, method: unknown]> = [];
  for (const attachmentGroup of groups) {
    for (const entry of attachmentGroup.entries) entries.push(entry);
  }
  return entries;
}

export function preflightGameAttachments(
  prototype: object,
  groups: readonly GameAttachmentGroupInput[] = GAME_ATTACHMENT_GROUPS,
): void {
  const entries = collectGameAttachmentEntries(groups);
  const seen = new Set<string>();
  let requiresExtension = false;

  for (const [name, method] of entries) {
    if (seen.has(name)) {
      throw new Error(`Duplicate Game attachment: ${name}`);
    }
    seen.add(name);

    if (method == null) {
      throw new TypeError(`Game attachment reference is missing: ${name}`);
    }
    if (typeof method !== "function") {
      throw new TypeError(`Game attachment is not callable: ${name}`);
    }

    const existing = Object.getOwnPropertyDescriptor(prototype, name);
    if (existing && existing.value !== method) {
      throw new Error(`Incompatible Game prototype collision: ${name}`);
    }
    if (!existing) requiresExtension = true;
  }

  if (requiresExtension && !Object.isExtensible(prototype)) {
    throw new TypeError("Game prototype is not extensible");
  }
}

export function installGameAttachments(
  prototype: object,
  groups: readonly GameAttachmentGroupInput[] = GAME_ATTACHMENT_GROUPS,
): void {
  const entries = collectGameAttachmentEntries(groups);
  preflightGameAttachments(prototype, groups);

  for (const [name, method] of entries) {
    if (Object.getOwnPropertyDescriptor(prototype, name)) {
      continue;
    }

    if (typeof method !== "function") continue;
    Object.defineProperty(prototype, name, {
      value: method,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
}
