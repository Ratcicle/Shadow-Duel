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

function attachMethods(EngineClass, module, methodNames) {
  for (const methodName of methodNames) {
    EngineClass.prototype[methodName] = module[methodName];
  }
}

export function attachEffectModules(EngineClass) {
  attachMethods(EngineClass, filters, [
    "cardMatchesFilters",
    "effectMatchesFilters",
  ]);

  attachMethods(EngineClass, costs, ["resolveLpCost"]);
  attachMethods(EngineClass, conditions, ["evaluateConditions"]);

  attachMethods(EngineClass, passives, [
    "cardHasArchetype",
    "isSameCardReference",
    "isActiveEquipForCard",
    "applyPassiveBuffValue",
    "clearPassiveBuffsForCard",
    "updatePassiveBuffs",
  ]);

  attachMethods(EngineClass, fusion, [
    "matchesFusionRequirement",
    "getFusionRequirements",
    "getFusionRequiredCount",
    "getRequiredMaterialCount",
    "findFusionMaterialCombos",
    "evaluateFusionSelection",
    "canSummonFusion",
    "getAvailableFusions",
    "performBotFusion",
    "applyPolymerizationFusion",
  ]);

  attachMethods(EngineClass, targeting, [
    "getZone",
    "findCardZone",
    "getOwnerByCard",
    "buildSelectionCandidateKey",
    "selectCandidates",
    "resolveTargets",
    "checkImmunity",
    "isImmuneToOpponentEffects",
    "filterCardsListByImmunity",
    "filterTargetsByImmunity",
    "inferEffectType",
    "shouldSkipActionDueToImmunity",
  ]);

  attachMethods(EngineClass, triggers, [
    "registerOncePerDuelUsage",
    "registerOncePerTurnUsage",
    "handleSpecialSummonTypeCounters",
    "handleFieldPresenceTypeSummonCounters",
    "assignFieldPresenceId",
    "clearFieldPresenceId",
    "handleTriggeredEffect",
    "buildTriggerActivationContext",
    "buildTriggerEntry",
    "collectEventTriggers",
    "collectAfterSummonTriggers",
    "collectSpellActivatedTriggers",
    "collectEffectActivatedTriggers",
    "collectBattleDestroyTriggers",
    "collectBattleCompletedTriggers",
    "collectAttackDeclaredTriggers",
    "collectBattleDamageTriggers",
    "collectLpChangeTriggers",
    "collectEffectTargetedTriggers",
    "collectCardEquippedTriggers",
    "collectCardMovedTriggers",
    "collectCardToGraveTriggers",
    "collectCounterRemovedTriggers",
    "collectPositionChangeTriggers",
    "collectStandbyPhaseTriggers",
  ]);

  attachMethods(EngineClass, blueprints, [
    "getBlueprintStorageConfig",
    "getBlueprintStorageState",
    "getStoredBlueprints",
    "clearBlueprintStorage",
    "buildEffectBlueprint",
    "resolveEffectBlueprint",
    "executeEffectBlueprint",
    "activateStoredBlueprint",
    "handleBlueprintStorageAfterResolution",
  ]);

  attachMethods(EngineClass, actions, [
    "applyActions",
    "checkActionPreviewRequirements",
    "applyDraw",
    "applyShuffleDeck",
    "applyHeal",
    "applyHealPerArchetypeMonster",
    "applyRemoveCounter",
    "applyRemoveAllCountersFromField",
    "applyRemoveCountersFromField",
    "applyCountFieldCounters",
    "applyDamage",
    "applyDestroy",
    "checkBeforeDestroyNegations",
    "promptForDestructionNegation",
    "getDestructionNegationCostDescription",
    "applyDestroyAllOthersAndDraw",
    "applyDestroyOtherDragonsAndBuff",
    "applyMirrorForceDestroy",
    "applyNegateAttack",
    "applyEndBattlePhase",
    "applyForbidAttackThisTurn",
    "applyForbidAttackNextTurn",
    "applyAllowDirectAttackThisTurn",
    "applyForbidDirectAttackThisTurn",
    "applySpecialSummonToken",
    "applySpecialSummonSelfAsTrapMonster",
    "applyCallOfTheHauntedSummon",
    "applyBuffAtkTemp",
    "applyModifyStatsTemp",
    "applyEquip",
    "showSickleSelectionModal",
    "applyMove",
    "applyAddCounter",
    "applyGrantVoidFusionImmunity",
  ]);

  attachMethods(EngineClass, activation, [
    "getHandActivationEffect",
    "getSpellTrapActivationEffect",
    "getMonsterIgnitionEffects",
    "getMonsterIgnitionEffect",
    "getActivatableMonsterIgnitionEffects",
    "getFirstActivatableMonsterIgnitionEffect",
    "getFieldSpellActivationEffect",
    "activateMonsterFromGraveyard",
    "activateFieldSpell",
    "activateSpellTrapEffect",
    "activateMonsterEffect",
    "chooseSpecialSummonPosition",
    "hasActivatableGraveyardEffect",
    "canActivate",
    "canActivateSpellFromHandPreview",
    "canActivateMonsterEffectPreview",
    "canActivateSpellTrapEffectPreview",
    "canActivateFieldSpellEffectPreview",
  ]);
}
