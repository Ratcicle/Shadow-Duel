import type { DefineAction } from "./shared.js";

export interface ConditionalActionMap {
  choose_action_case: DefineAction<
    "choose_action_case",
    "cases",
    | "selectionMessage" | "effectChoiceKey" | "choiceTextKey" | "selectionLabel"
    | "allowCancel" | "filterAvailableCases" | "requirementId" | "selectionKind"
    | "choiceImage"
  >;
  declare_card_property: DefineAction<
    "declare_card_property",
    "property" | "stateKey",
    | "choices" | "duration" | "durationTurns" | "expiresOnTurn" | "value"
    | "selectionId" | "selectionLabel" | "selectionMessage" | "allowCancel"
  >;
  conditional_target_actions: DefineAction<
    "conditional_target_actions",
    "targetRef" | "cases",
    "defaultActions" | "matchMode" | "applyMode"
  >;
  optional_target_actions: DefineAction<
    "optional_target_actions",
    "targets" | "actions",
    | "conditions" | "selectionMessage" | "selectionMessageKey" | "promptMessage"
    | "promptMessageKey" | "promptTitle" | "promptTitleKey" | "allowCancel"
    | "logIfSkipped" | "optional" | "confirmOnly" | "requireConfirmation"
    | "confirmationId" | "selectionId" | "selectionLabel" | "confirmLabel"
    | "cancelLabel"
  >;
  conditional_actions: DefineAction<
    "conditional_actions",
    "actions",
    "conditions" | "logIfSkipped"
  >;
  register_temporary_event_effect: DefineAction<
    "register_temporary_event_effect",
    "event" | "triggerRequirement" | "triggerTiming" | "actions",
    | "conditions" | "targets" | "duration" | "uses" | "unlimitedUses"
    | "effectId" | "sourceName" | "declaredValueRef" | "declaredValueStateKey"
    | "stateKey" | "promptUser" | "promptMessage" | "uniqueKey"
    | "bindEventTargetRef" | "requireBoundTargetLeavesField"
  >;
  register_synchro_material_followup: DefineAction<
    "register_synchro_material_followup",
    "actions",
    "uniqueKey" | "sourceName" | "synchroSummonContextId"
  >;
  set_source_after_resolution_if: DefineAction<
    "set_source_after_resolution_if",
    "firstTargetRef" | "secondTargetRef",
    | "atkDifferenceMax" | "maxDifference" | "condition" | "conditionType"
    | "deferFinalizationUntil" | "deferUntil" | "contextLabel"
  >;
}
