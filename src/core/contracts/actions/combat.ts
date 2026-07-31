import type { DefineAction } from "./shared.js";

export interface CombatActionMap {
  allow_direct_attack_this_turn: DefineAction<"allow_direct_attack_this_turn", "targetRef">;
  set_attack_limit_from_zone_count: DefineAction<
    "set_attack_limit_from_zone_count",
    never,
    "targetRef" | "owner" | "player" | "zone" | "filters" | "duration" | "minAttacks"
  >;
  register_battle_pair_effect: DefineAction<
    "register_battle_pair_effect",
    "firstTargetRef" | "secondTargetRef" | "affectedTargetRef",
    | "targetRef" | "targetARef" | "targetBRef" | "opponentTargetRef"
    | "destroyTargetRef" | "timing" | "duration" | "actions" | "uniqueKey"
    | "contextLabel"
  >;
  redirect_current_attack_to_target: DefineAction<
    "redirect_current_attack_to_target",
    "targetRef",
    "contextLabel"
  >;
  forbid_attack_next_turn: DefineAction<
    "forbid_attack_next_turn",
    "targetRef",
    "turns"
  >;
  forbid_attack_this_turn: DefineAction<"forbid_attack_this_turn">;
  forbid_direct_attack_this_turn: DefineAction<
    "forbid_direct_attack_this_turn",
    never,
    "player"
  >;
  grant_attack_all_monsters: DefineAction<"grant_attack_all_monsters", "targetRef">;
  grant_second_attack: DefineAction<
    "grant_second_attack",
    "targetRef",
    "targetRestriction"
  >;
  end_battle_phase: DefineAction<"end_battle_phase">;
  negate_attack: DefineAction<"negate_attack">;
  negate_summon_or_activation_and_destroy: DefineAction<"negate_summon_or_activation_and_destroy">;
  negate_activation: DefineAction<"negate_activation", never, "storeNegatedCardAs">;
  negate_effect: DefineAction<"negate_effect", never, "storeNegatedCardAs">;
  switch_defender_position_on_attack: DefineAction<"switch_defender_position_on_attack">;
}
