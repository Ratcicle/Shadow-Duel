import { getPerspectivePlayers } from "../perspective.js";
import { resolveTargetsForAction, STOP_SIMULATION } from "./shared.js";
import {
  applyDraw,
  applyHeal,
  applyHealPerArchetypeMonster,
  applyDamage,
  applyPayLp,
  applySearchAny,
  applyAddFromZoneToHand,
  applyGrantAdditionalNormalSummon,
} from "./resources.js";
import {
  applySpecialSummonFromZone,
  applySearchThenOptionalSpecialSummonFromHand,
  applySpecialSummonFromHandWithCost,
  applySpecialSummonFromHandWithTieredCost,
  applyBounceAndSummon,
  applySpecialSummonToken,
  applyConditionalSummonFromHand,
  applyPolymerizationFusionSummon,
} from "./summon.js";
import {
  applyBanish,
  applyReturnToHand,
  applyMove,
} from "./movement.js";
import {
  applyDestroy,
  applyDestroyAndDamageByTargetAtk,
  applyDestroyCardsByScope,
} from "./destruction.js";
import {
  applyEquip,
} from "./equip.js";
import {
  applyAddCounter,
  applyRemoveCounter,
} from "./counters.js";
import {
  applyBuffStatsTemp,
  applyBuffAtkTemp,
  applyRemoveStatIncreases,
  applyHalveTargetStatsAndGainRemoved,
  applyForbidAttackNextTurn,
  applyGrantProtection,
  applyRegisterReplacementEffect,
  applyModifyStatsTemp,
  applyModifyStatsTempThenDestroyIfZeroed,
  applySetStatsToZeroAndNegate,
  applyAddStatus,
} from "./stats.js";
import {
  applyAllowDirectAttackThisTurn,
} from "./combat.js";
import {
  applyConditionalTargetActions,
  applyActivateStoredBlueprint,
  applyChooseActionCase,
  applyShuffleDeck,
} from "./flow.js";

export const SIMULATED_ACTION_HANDLERS = {
  "draw": applyDraw,
  "heal": applyHeal,
  "heal_per_archetype_monster": applyHealPerArchetypeMonster,
  "damage": applyDamage,
  "pay_lp": applyPayLp,
  "search_any": applySearchAny,
  "add_from_zone_to_hand": applyAddFromZoneToHand,
  "grant_additional_normal_summon": applyGrantAdditionalNormalSummon,
  "special_summon_from_zone": applySpecialSummonFromZone,
  "search_then_optional_special_summon_from_hand": applySearchThenOptionalSpecialSummonFromHand,
  "special_summon_from_hand_with_cost": applySpecialSummonFromHandWithCost,
  "special_summon_from_hand_with_tiered_cost": applySpecialSummonFromHandWithTieredCost,
  "bounce_and_summon": applyBounceAndSummon,
  "special_summon_token": applySpecialSummonToken,
  "conditional_summon_from_hand": applyConditionalSummonFromHand,
  "polymerization_fusion_summon": applyPolymerizationFusionSummon,
  "banish": applyBanish,
  "return_to_hand": applyReturnToHand,
  "move": applyMove,
  "destroy": applyDestroy,
  "destroy_and_damage_by_target_atk": applyDestroyAndDamageByTargetAtk,
  "destroy_cards_by_scope": applyDestroyCardsByScope,
  "equip": applyEquip,
  "add_counter": applyAddCounter,
  "remove_counter": applyRemoveCounter,
  "buff_stats_temp": applyBuffStatsTemp,
  "buff_atk_temp": applyBuffAtkTemp,
  "remove_stat_increases": applyRemoveStatIncreases,
  "halve_target_stats_and_gain_removed": applyHalveTargetStatsAndGainRemoved,
  "forbid_attack_next_turn": applyForbidAttackNextTurn,
  "grant_protection": applyGrantProtection,
  "register_replacement_effect": applyRegisterReplacementEffect,
  "modify_stats_temp": applyModifyStatsTemp,
  "modify_stats_temp_then_destroy_if_zeroed": applyModifyStatsTempThenDestroyIfZeroed,
  "set_stats_to_zero_and_negate": applySetStatsToZeroAndNegate,
  "add_status": applyAddStatus,
  "allow_direct_attack_this_turn": applyAllowDirectAttackThisTurn,
  "conditional_target_actions": applyConditionalTargetActions,
  "activate_stored_blueprint": applyActivateStoredBlueprint,
  "choose_action_case": applyChooseActionCase,
  "shuffle_deck": applyShuffleDeck,
};

export function applySimulatedActions({
  actions,
  selections,
  state,
  selfId = "bot",
  options = {},
}) {
  if (!Array.isArray(actions)) return;
  const { self, opponent } = getPerspectivePlayers(state, selfId);

  for (const action of actions) {
    if (!action || !action.type) continue;
    const targets = resolveTargetsForAction(action, selections, options, opponent);
    const handler = SIMULATED_ACTION_HANDLERS[action.type];

    if (!handler) {
      if (!Array.isArray(state._simUnsupportedActions)) {
        state._simUnsupportedActions = [];
      }
      state._simUnsupportedActions.push(action.type);
      continue;
    }

    const result = handler({
      action,
      targets,
      selections,
      state,
      selfId,
      options,
      self,
      opponent,
      applySimulatedActions,
    });
    if (result === STOP_SIMULATION) return;
  }
}
