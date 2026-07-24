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
  applyDiscardFromHand,
  applyDeclareCardProperty,
  applyGrantAdditionalNormalSummon,
  applyRestrictEffectActivationsByAttribute,
  applyRestrictEffectActivationsByNames,
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
  applyRestrictSpecialSummons,
  applyDeSynchro,
  applySynchroSummonFromExtraDeck,
} from "./summon.js";
import {
  applyBanish,
  applyReturnToHand,
  applyMove,
  applyTakeControl,
} from "./movement.js";
import {
  applyDestroy,
  applyDestroyTargetedCards,
  applyDestroyAndDamageByTargetAtk,
  applyDestroyCardsByScope,
} from "./destruction.js";
import {
  applyEquip,
} from "./equip.js";
import {
  applyAddCounter,
  applyCountFieldCounters,
  applyRemoveCounter,
} from "./counters.js";
import {
  applyBuffStatsTemp,
  applyBuffAtkTemp,
  applySetAttackLimitFromZoneCount,
  applyRemoveStatIncreases,
  applyHalveTargetStatsAndGainRemoved,
  applyForbidAttackNextTurn,
  applyForbidAttackThisTurn,
  applyGrantProtection,
  applyRegisterReplacementEffect,
  applyModifyStatsTemp,
  applyModifyStatsTempThenDestroyIfZeroed,
  applySetStatsToZeroAndNegate,
  applyAddStatus,
  applySetFacedownDefense,
  applySwitchPosition,
} from "./stats.js";
import {
  applyAllowDirectAttackThisTurn,
  applyForbidDirectAttackThisTurn,
  applyRegisterBattlePairEffect,
  applyRedirectCurrentAttackToTarget,
  applySetSourceAfterResolutionIf,
} from "./combat.js";
import {
  applyConditionalActions,
  applyConditionalTargetActions,
  applyOptionalTargetActions,
  applyNegateActivation,
  applyNegateEffect,
  applyActivateStoredBlueprint,
  applyChooseActionCase,
  applyRegisterTemporaryEventEffect,
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
  "discard_from_hand": applyDiscardFromHand,
  "declare_card_property": applyDeclareCardProperty,
  "grant_additional_normal_summon": applyGrantAdditionalNormalSummon,
  "restrict_effect_activations_by_attribute": applyRestrictEffectActivationsByAttribute,
  "restrict_effect_activations_by_names": applyRestrictEffectActivationsByNames,
  "restrict_special_summons": applyRestrictSpecialSummons,
  "special_summon_from_zone": applySpecialSummonFromZone,
  "search_then_optional_special_summon_from_hand": applySearchThenOptionalSpecialSummonFromHand,
  "special_summon_from_hand_with_cost": applySpecialSummonFromHandWithCost,
  "special_summon_from_hand_with_tiered_cost": applySpecialSummonFromHandWithTieredCost,
  "bounce_and_summon": applyBounceAndSummon,
  "special_summon_token": applySpecialSummonToken,
  "conditional_summon_from_hand": applyConditionalSummonFromHand,
  "polymerization_fusion_summon": applyPolymerizationFusionSummon,
  "de_synchro": applyDeSynchro,
  "synchro_summon_from_extra_deck": applySynchroSummonFromExtraDeck,
  "banish": applyBanish,
  "return_to_hand": applyReturnToHand,
  "move": applyMove,
  "take_control": applyTakeControl,
  "destroy": applyDestroy,
  "destroy_targeted_cards": applyDestroyTargetedCards,
  "destroy_and_damage_by_target_atk": applyDestroyAndDamageByTargetAtk,
  "destroy_cards_by_scope": applyDestroyCardsByScope,
  "equip": applyEquip,
  "add_counter": applyAddCounter,
  "count_field_counters": applyCountFieldCounters,
  "remove_counter": applyRemoveCounter,
  "buff_stats_temp": applyBuffStatsTemp,
  "buff_atk_temp": applyBuffAtkTemp,
  "set_attack_limit_from_zone_count": applySetAttackLimitFromZoneCount,
  "remove_stat_increases": applyRemoveStatIncreases,
  "halve_target_stats_and_gain_removed": applyHalveTargetStatsAndGainRemoved,
  "forbid_attack_next_turn": applyForbidAttackNextTurn,
  "forbid_attack_this_turn": applyForbidAttackThisTurn,
  "grant_protection": applyGrantProtection,
  "register_replacement_effect": applyRegisterReplacementEffect,
  "modify_stats_temp": applyModifyStatsTemp,
  "modify_stats_temp_then_destroy_if_zeroed": applyModifyStatsTempThenDestroyIfZeroed,
  "set_stats_to_zero_and_negate": applySetStatsToZeroAndNegate,
  "add_status": applyAddStatus,
  "set_facedown_defense": applySetFacedownDefense,
  "switch_position": applySwitchPosition,
  "allow_direct_attack_this_turn": applyAllowDirectAttackThisTurn,
  "forbid_direct_attack_this_turn": applyForbidDirectAttackThisTurn,
  "register_battle_pair_effect": applyRegisterBattlePairEffect,
  "redirect_current_attack_to_target": applyRedirectCurrentAttackToTarget,
  "set_source_after_resolution_if": applySetSourceAfterResolutionIf,
  "conditional_actions": applyConditionalActions,
  "conditional_target_actions": applyConditionalTargetActions,
  "optional_target_actions": applyOptionalTargetActions,
  "negate_activation": applyNegateActivation,
  "negate_effect": applyNegateEffect,
  "register_temporary_event_effect": applyRegisterTemporaryEventEffect,
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
    const targets = resolveTargetsForAction(
      action,
      selections,
      { ...options, self, selfId },
      opponent,
    );
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
