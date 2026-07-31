import type { DefineAction } from "./shared.js";

export interface StatsActionMap {
  add_status: DefineAction<
    "add_status",
    "status",
    "targetRef" | "targetScope" | "value" | "remove" | "untilEndOfTurn" | "duration"
  >;
  banish_and_buff: DefineAction<
    "banish_and_buff",
    "targetRef",
    "buffMultiplier" | "buffSource" | "buffTarget" | "buffType" | "duration"
  >;
  buff_atk_temp: DefineAction<"buff_atk_temp", "targetRef" | "amount">;
  buff_stats_temp: DefineAction<
    "buff_stats_temp",
    never,
    | "targetRef" | "atkBoost" | "defBoost" | "targetScope"
    | "atkBoostFromContext" | "atkBoostFromTarget" | "defBoostFromContext"
    | "duration" | "durationTurns" | "expiresOnTurn" | "permanent"
    | "sourceName" | "allowEmpty"
  >;
  set_facedown_defense: DefineAction<
    "set_facedown_defense",
    "targetRef",
    "lockBattlePosition"
  >;
  set_original_stats: DefineAction<
    "set_original_stats",
    never,
    | "targetRef" | "atk" | "def" | "baseAtk" | "baseDef"
    | "atkFromContext" | "defFromContext" | "updateCurrentStats"
  >;
  buff_stats_by_counter: DefineAction<
    "buff_stats_by_counter",
    "targetRef" | "counterType",
    | "atkPerCounter" | "defPerCounter" | "atkBoostPerCounter"
    | "defBoostPerCounter" | "counterSourceRef" | "minCounters" | "duration"
    | "durationTurns" | "expiresOnTurn" | "permanent" | "sourceName"
  >;
  modify_stats_temp_then_destroy_if_zeroed: DefineAction<
    "modify_stats_temp_then_destroy_if_zeroed",
    "targetRef",
    | "atkChange" | "defChange" | "destroyIfAtkZeroedByThisEffect"
    | "destroyIfDefZeroedByThisEffect" | "permanent"
  >;
  buff_atk_by_lp_gained_this_turn: DefineAction<
    "buff_atk_by_lp_gained_this_turn",
    never,
    "targetRef"
  >;
  reduce_hand_monster_levels: DefineAction<
    "reduce_hand_monster_levels",
    never,
    "amount" | "optional"
  >;
  modify_level: DefineAction<
    "modify_level",
    "targetRef" | "amount",
    "duration" | "minLevel" | "maxLevel"
  >;
  buff_stats_temp_with_second_attack: DefineAction<
    "buff_stats_temp_with_second_attack",
    "targetRef",
    "atkBoost" | "defBoost"
  >;
  equip: DefineAction<
    "equip",
    never,
    | "targetRef" | "equippedCard" | "atkBonus" | "defBonus" | "extraAttacks"
    | "battleIndestructible" | "grantCrescentShieldGuard"
  >;
  grant_protection: DefineAction<
    "grant_protection",
    "protectionType",
    "targetRef" | "duration" | "sourceOwner" | "targetScope" | "removeOnLeave"
  >;
  grant_void_fusion_immunity: DefineAction<
    "grant_void_fusion_immunity",
    never,
    "archetype" | "durationTurns"
  >;
  modify_stats_temp: DefineAction<
    "modify_stats_temp",
    "targetRef",
    "atkFactor" | "defFactor"
  >;
  permanent_buff_named: DefineAction<
    "permanent_buff_named",
    never,
    | "targetRef" | "sourceName" | "archetype" | "atkBoost" | "defBoost"
    | "applyToAllField" | "cumulative"
  >;
  reduce_self_atk: DefineAction<
    "reduce_self_atk",
    never,
    "targetRef" | "amount" | "atkBoost" | "defBoost"
  >;
  remove_permanent_buff_named: DefineAction<
    "remove_permanent_buff_named",
    never,
    "targetRef" | "sourceName" | "archetype" | "removeFromAllField"
  >;
  remove_stat_increases: DefineAction<
    "remove_stat_increases",
    "targetRef",
    "stats"
  >;
  halve_target_stats_and_gain_removed: DefineAction<
    "halve_target_stats_and_gain_removed",
    "targetRef",
    "gainTargetRef" | "stats" | "sourceName"
  >;
  set_stats_to_zero_and_negate: DefineAction<
    "set_stats_to_zero_and_negate",
    "targetRef",
    "negateEffects" | "negateEffectsDuration" | "setAtkToZero" | "setDefToZero"
  >;
  switch_position: DefineAction<
    "switch_position",
    never,
    | "targetRef" | "targetScope" | "atkBoost" | "markChanged"
    | "haltOnFailure" | "stopOnFailure"
  >;
}
