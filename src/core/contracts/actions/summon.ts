import type { DefineAction } from "./shared.js";

export interface SummonActionMap {
  abyssal_serpent_delayed_summon: DefineAction<
    "abyssal_serpent_delayed_summon",
    never,
    "targetRef" | "buffValue"
  >;
  bounce_and_summon: DefineAction<
    "bounce_and_summon",
    never,
    "bounceSource" | "filters" | "position" | "cannotAttackThisTurn"
  >;
  call_of_haunted_summon_and_bind: DefineAction<
    "call_of_haunted_summon_and_bind",
    "targetRef",
    "position"
  >;
  conditional_summon_from_hand: DefineAction<
    "conditional_summon_from_hand",
    never,
    | "targetRef" | "condition" | "position" | "optional"
    | "cannotAttackThisTurn" | "restrictAttackThisTurn"
  >;
  draw_and_summon: DefineAction<
    "draw_and_summon",
    never,
    "condition" | "drawAmount" | "optional" | "player" | "position"
  >;
  polymerization_fusion_summon: DefineAction<"polymerization_fusion_summon">;
  schedule_return_from_banished: DefineAction<
    "schedule_return_from_banished",
    never,
    "cardRef" | "returnPhase" | "delayTurns"
  >;
  schedule_special_summon: DefineAction<
    "schedule_special_summon",
    never,
    | "cardRef" | "targetRef" | "fromZone" | "zone" | "phase" | "returnPhase"
    | "triggerPlayer" | "player" | "owner" | "summonPlayer" | "position"
    | "statusesOnSummon" | "summonMethod" | "summonProcedure" | "priority"
  >;
  special_summon_from_deck_with_counter_limit: DefineAction<
    "special_summon_from_deck_with_counter_limit",
    never,
    "archetype" | "counterMultiplier" | "counterType" | "sendSourceToGraveAfter"
  >;
  restrict_special_summons: DefineAction<
    "restrict_special_summons",
    "allowedFilters",
    "player" | "duration" | "reason"
  >;
  special_summon_from_hand_with_cost: DefineAction<
    "special_summon_from_hand_with_cost",
    never,
    | "costTargetRef" | "costDestination" | "costMovedByEffect" | "position"
    | "cannotAttackThisTurn" | "conditionalMarkersOnSummon"
  >;
  special_summon_from_hand_with_tiered_cost: DefineAction<
    "special_summon_from_hand_with_tiered_cost",
    never,
    | "costFilters" | "maxCost" | "minCost" | "position" | "tier1AtkBoost"
    | "tierOptions"
  >;
  special_summon_from_zone: DefineAction<
    "special_summon_from_zone",
    never,
    | "targetRef" | "zone" | "sourceZone" | "sourceOwner" | "summonToOwner"
    | "scope" | "filters" | "count" | "player" | "archetype" | "cardKind"
    | "cardName" | "monsterType" | "isToken" | "isTuner" | "minAtk"
    | "maxAtk" | "minDef" | "maxDef" | "minLevel" | "maxLevel"
    | "maxLevelFromContext" | "position" | "promptPlayer" | "requireSource"
    | "banishCost" | "distinctNames" | "cannotAttackThisTurn"
    | "destroySummonedAtEndPhase" | "excludeSummonRestrict" | "negateEffects"
    | "negateEffectsDuration" | "oncePerTurnName" | "setAtkToZeroAfterSummon"
    | "setDefToZeroAfterSummon" | "atkBoostAfterSummon" | "defBoostAfterSummon"
    | "statusesOnSummon" | "resultRef" | "storeResultAs" | "haltOnFailure"
    | "stopOnFailure" | "fieldSlotsFreedBeforeSummon"
  >;
  de_synchro: DefineAction<
    "de_synchro",
    "targetRef",
    | "position" | "contextLabel" | "reviveContextLabel" | "promptMessage"
    | "promptTitle" | "confirmLabel" | "cancelLabel"
  >;
  synchro_summon_from_extra_deck: DefineAction<
    "synchro_summon_from_extra_deck",
    never,
    | "player" | "filters" | "candidateFilters" | "position" | "selectionMessage"
    | "allowCancel" | "previewPendingSummon"
  >;
  special_summon_self_as_trap_monster: DefineAction<
    "special_summon_self_as_trap_monster",
    "monster",
    "position" | "treatedAsCardKinds" | "summonProcedure" | "cannotAttackThisTurn"
  >;
  special_summon_matching_level: DefineAction<
    "special_summon_matching_level",
    "matchLevelRef" | "zone",
    "position" | "cannotAttackThisTurn" | "negateEffects" | "negateEffectsDuration"
  >;
  special_summon_token: DefineAction<
    "special_summon_token",
    "token",
    "player" | "position" | "cannotAttackThisTurn"
  >;
  transmutate: DefineAction<"transmutate", "targetRef">;
}
