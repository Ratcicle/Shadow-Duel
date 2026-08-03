import * as fusion from "./fusion/index.js";
import * as targeting from "./targeting/index.js";
import * as triggers from "./triggers/index.js";
import * as blueprints from "./blueprints/index.js";
import * as actions from "./actions/index.js";
import * as activation from "./activation/index.js";
import * as filters from "./filters/index.js";
import * as costs from "./costs/index.js";
import * as conditions from "./conditions/index.js";
import * as passives from "./passives/index.js";

type EffectMethod = (...args: never[]) => unknown;
type EffectMethodManifest = Readonly<Record<string, EffectMethod>>;

function defineEffectMethods<const Methods extends EffectMethodManifest>(
  methods: Methods,
): Methods {
  return methods;
}

export const FILTER_EFFECT_METHODS = defineEffectMethods({
  cardMatchesFilters: filters.cardMatchesFilters,
  effectMatchesFilters: filters.effectMatchesFilters,
});

export const COST_EFFECT_METHODS = defineEffectMethods({
  resolveLpCost: costs.resolveLpCost,
});

export const CONDITION_EFFECT_METHODS = defineEffectMethods({
  evaluateConditions: conditions.evaluateConditions,
});

export const PASSIVE_EFFECT_METHODS = defineEffectMethods({
  cardHasArchetype: passives.cardHasArchetype,
  isSameCardReference: passives.isSameCardReference,
  isActiveEquipForCard: passives.isActiveEquipForCard,
  applyPassiveBuffValue: passives.applyPassiveBuffValue,
  clearPassiveBuffsForCard: passives.clearPassiveBuffsForCard,
  updatePassiveBuffs: passives.updatePassiveBuffs,
});

export const FUSION_EFFECT_METHODS = defineEffectMethods({
  matchesFusionRequirement: fusion.matchesFusionRequirement,
  getFusionRequirements: fusion.getFusionRequirements,
  getFusionRequiredCount: fusion.getFusionRequiredCount,
  getRequiredMaterialCount: fusion.getRequiredMaterialCount,
  findFusionMaterialCombos: fusion.findFusionMaterialCombos,
  evaluateFusionSelection: fusion.evaluateFusionSelection,
  canSummonFusion: fusion.canSummonFusion,
  getAvailableFusions: fusion.getAvailableFusions,
  performBotFusion: fusion.performBotFusion,
  applyPolymerizationFusion: fusion.applyPolymerizationFusion,
});

export const TARGETING_EFFECT_METHODS = defineEffectMethods({
  getZone: targeting.getZone,
  findCardZone: targeting.findCardZone,
  getOwnerByCard: targeting.getOwnerByCard,
  buildSelectionCandidateKey: targeting.buildSelectionCandidateKey,
  selectCandidates: targeting.selectCandidates,
  resolveTargets: targeting.resolveTargets,
  checkImmunity: targeting.checkImmunity,
  isImmuneToOpponentEffects: targeting.isImmuneToOpponentEffects,
  filterCardsListByImmunity: targeting.filterCardsListByImmunity,
  filterTargetsByImmunity: targeting.filterTargetsByImmunity,
  inferEffectType: targeting.inferEffectType,
  shouldSkipActionDueToImmunity: targeting.shouldSkipActionDueToImmunity,
});

export const TRIGGER_EFFECT_METHODS = defineEffectMethods({
  commitEffectUsage: triggers.commitEffectUsage,
  handleSpecialSummonTypeCounters: triggers.handleSpecialSummonTypeCounters,
  handleFieldPresenceTypeSummonCounters:
    triggers.handleFieldPresenceTypeSummonCounters,
  assignFieldPresenceId: triggers.assignFieldPresenceId,
  clearFieldPresenceId: triggers.clearFieldPresenceId,
  handleTriggeredEffect: triggers.handleTriggeredEffect,
  buildTriggerActivationContext: triggers.buildTriggerActivationContext,
  buildTriggerEntry: triggers.buildTriggerEntry,
  collectEventTriggers: triggers.collectEventTriggers,
  collectAfterSummonTriggers: triggers.collectAfterSummonTriggers,
  collectSpellActivatedTriggers: triggers.collectSpellActivatedTriggers,
  collectEffectActivatedTriggers: triggers.collectEffectActivatedTriggers,
  collectBattleDestroyTriggers: triggers.collectBattleDestroyTriggers,
  collectBattleCompletedTriggers: triggers.collectBattleCompletedTriggers,
  collectAttackDeclaredTriggers: triggers.collectAttackDeclaredTriggers,
  collectBattleDamageTriggers: triggers.collectBattleDamageTriggers,
  collectBattleDamageInflictedTriggers:
    triggers.collectBattleDamageInflictedTriggers,
  collectCardFlippedTriggers: triggers.collectCardFlippedTriggers,
  collectDamageStepTriggers: triggers.collectDamageStepTriggers,
  collectLpChangeTriggers: triggers.collectLpChangeTriggers,
  collectEffectTargetedTriggers: triggers.collectEffectTargetedTriggers,
  collectCardEquippedTriggers: triggers.collectCardEquippedTriggers,
  collectCardMovedTriggers: triggers.collectCardMovedTriggers,
  collectCardToGraveTriggers: triggers.collectCardToGraveTriggers,
  collectCounterRemovedTriggers: triggers.collectCounterRemovedTriggers,
  collectPositionChangeTriggers: triggers.collectPositionChangeTriggers,
  collectStandbyPhaseTriggers: triggers.collectStandbyPhaseTriggers,
  collectEndPhaseTriggers: triggers.collectEndPhaseTriggers,
});

export const BLUEPRINT_EFFECT_METHODS = defineEffectMethods({
  getBlueprintStorageConfig: blueprints.getBlueprintStorageConfig,
  getBlueprintStorageState: blueprints.getBlueprintStorageState,
  getStoredBlueprints: blueprints.getStoredBlueprints,
  clearBlueprintStorage: blueprints.clearBlueprintStorage,
  buildEffectBlueprint: blueprints.buildEffectBlueprint,
  resolveEffectBlueprint: blueprints.resolveEffectBlueprint,
  executeEffectBlueprint: blueprints.executeEffectBlueprint,
  activateStoredBlueprint: blueprints.activateStoredBlueprint,
  handleBlueprintStorageAfterResolution:
    blueprints.handleBlueprintStorageAfterResolution,
});

export const ACTION_EFFECT_METHODS = defineEffectMethods({
  applyActions: actions.applyActions,
  checkActionPreviewRequirements: actions.checkActionPreviewRequirements,
  applyDraw: actions.applyDraw,
  applyShuffleDeck: actions.applyShuffleDeck,
  applyHeal: actions.applyHeal,
  applyHealPerArchetypeMonster: actions.applyHealPerArchetypeMonster,
  applyRemoveCounter: actions.applyRemoveCounter,
  applyRemoveAllCountersFromField: actions.applyRemoveAllCountersFromField,
  applyRemoveCountersFromField: actions.applyRemoveCountersFromField,
  applyCountFieldCounters: actions.applyCountFieldCounters,
  applyDamage: actions.applyDamage,
  applyDestroy: actions.applyDestroy,
  checkBeforeDestroyNegations: actions.checkBeforeDestroyNegations,
  promptForDestructionNegation: actions.promptForDestructionNegation,
  getDestructionNegationCostDescription:
    actions.getDestructionNegationCostDescription,
  applyDestroyAllOthersAndDraw: actions.applyDestroyAllOthersAndDraw,
  applyDestroyOtherDragonsAndBuff: actions.applyDestroyOtherDragonsAndBuff,
  applyMirrorForceDestroy: actions.applyMirrorForceDestroy,
  applyNegateAttack: actions.applyNegateAttack,
  applyEndBattlePhase: actions.applyEndBattlePhase,
  applyForbidAttackThisTurn: actions.applyForbidAttackThisTurn,
  applyForbidAttackNextTurn: actions.applyForbidAttackNextTurn,
  applyAllowDirectAttackThisTurn: actions.applyAllowDirectAttackThisTurn,
  applyForbidDirectAttackThisTurn: actions.applyForbidDirectAttackThisTurn,
  applySpecialSummonToken: actions.applySpecialSummonToken,
  applySpecialSummonSelfAsTrapMonster:
    actions.applySpecialSummonSelfAsTrapMonster,
  applyCallOfTheHauntedSummon: actions.applyCallOfTheHauntedSummon,
  applyBuffAtkTemp: actions.applyBuffAtkTemp,
  applyModifyStatsTemp: actions.applyModifyStatsTemp,
  applyEquip: actions.applyEquip,
  showSickleSelectionModal: actions.showSickleSelectionModal,
  applyMove: actions.applyMove,
  applyAddCounter: actions.applyAddCounter,
  applyGrantVoidFusionImmunity: actions.applyGrantVoidFusionImmunity,
});

export const ACTIVATION_EFFECT_METHODS = defineEffectMethods({
  getHandActivationEffect: activation.getHandActivationEffect,
  getSpellTrapActivationEffect: activation.getSpellTrapActivationEffect,
  getMonsterIgnitionEffects: activation.getMonsterIgnitionEffects,
  getMonsterIgnitionEffect: activation.getMonsterIgnitionEffect,
  getActivatableMonsterIgnitionEffects:
    activation.getActivatableMonsterIgnitionEffects,
  getFirstActivatableMonsterIgnitionEffect:
    activation.getFirstActivatableMonsterIgnitionEffect,
  getFieldSpellActivationEffect: activation.getFieldSpellActivationEffect,
  activateMonsterFromGraveyard: activation.activateMonsterFromGraveyard,
  activateFieldSpell: activation.activateFieldSpell,
  activateSpellTrapEffect: activation.activateSpellTrapEffect,
  activateMonsterEffect: activation.activateMonsterEffect,
  chooseSpecialSummonPosition: activation.chooseSpecialSummonPosition,
  hasActivatableGraveyardEffect: activation.hasActivatableGraveyardEffect,
  canActivate: activation.canActivate,
  canActivateSpellFromHandPreview: activation.canActivateSpellFromHandPreview,
  canActivateMonsterEffectPreview: activation.canActivateMonsterEffectPreview,
  canActivateSpellTrapEffectPreview:
    activation.canActivateSpellTrapEffectPreview,
  canActivateFieldSpellEffectPreview:
    activation.canActivateFieldSpellEffectPreview,
});

export const EFFECT_MODULE_MANIFESTS = [
  FILTER_EFFECT_METHODS,
  COST_EFFECT_METHODS,
  CONDITION_EFFECT_METHODS,
  PASSIVE_EFFECT_METHODS,
  FUSION_EFFECT_METHODS,
  TARGETING_EFFECT_METHODS,
  TRIGGER_EFFECT_METHODS,
  BLUEPRINT_EFFECT_METHODS,
  ACTION_EFFECT_METHODS,
  ACTIVATION_EFFECT_METHODS,
] as const;

export type EffectModuleMethods = typeof FILTER_EFFECT_METHODS &
  typeof COST_EFFECT_METHODS &
  typeof CONDITION_EFFECT_METHODS &
  typeof PASSIVE_EFFECT_METHODS &
  typeof FUSION_EFFECT_METHODS &
  typeof TARGETING_EFFECT_METHODS &
  typeof TRIGGER_EFFECT_METHODS &
  typeof BLUEPRINT_EFFECT_METHODS &
  typeof ACTION_EFFECT_METHODS &
  typeof ACTIVATION_EFFECT_METHODS;

interface EffectEngineConstructor {
  readonly prototype: object;
}

interface PendingMethod {
  readonly name: string;
  readonly method: EffectMethod;
}

function collectMethods(): readonly PendingMethod[] {
  const names = new Set<string>();
  const pending: PendingMethod[] = [];

  for (const manifest of EFFECT_MODULE_MANIFESTS) {
    for (const [name, method] of Object.entries(manifest)) {
      if (typeof method !== "function") {
        throw new TypeError(
          `[EffectEngine] Cannot attach ${name}: exported value is not callable`,
        );
      }
      if (names.has(name)) {
        throw new TypeError(
          `[EffectEngine] Cannot attach duplicate method ${name}`,
        );
      }
      names.add(name);
      pending.push({ name, method });
    }
  }

  return pending;
}

function assertCompatiblePrototype(
  prototype: object,
  pending: readonly PendingMethod[],
): void {
  for (const { name, method } of pending) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (!descriptor) continue;
    if ("value" in descriptor && descriptor.value === method) continue;
    throw new TypeError(
      `[EffectEngine] Cannot attach ${name}: prototype already defines an incompatible member`,
    );
  }
}

export function attachEffectModules(EngineClass: EffectEngineConstructor): void {
  const pending = collectMethods();
  assertCompatiblePrototype(EngineClass.prototype, pending);

  for (const { name, method } of pending) {
    if (Object.getOwnPropertyDescriptor(EngineClass.prototype, name)) continue;
    if (!Reflect.set(EngineClass.prototype, name, method)) {
      throw new TypeError(`[EffectEngine] Failed to attach method ${name}`);
    }
  }
}
