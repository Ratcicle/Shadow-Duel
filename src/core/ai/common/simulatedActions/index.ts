import { refreshSimulatedFieldAuras } from "../zones.js";
import { shouldContinueAfterActionFailure } from "../../../actionHandlers/shared.js";
import { getPerspectivePlayers } from "../perspective.js";
import { resolveTargetsForAction, captureSimulatedReferences, areRequiredContextualReferencesValid, STOP_SIMULATION } from "./shared.js";
import type { ActionOf, ActionType } from "../../../contracts/actions.js";
import type {
  SimulatedActionBatchInput,
  SimulatedActionHandler,
  SimulatedActionHandlerContext,
  SimulatedActionHandlerManifest,
} from "./shared.js";
import {
  applyDraw,
  applyDrawAndSummon,
  applyHeal,
  applyHealPerOpponentCardsAndHand,
  applyHealPerArchetypeMonster,
  applyHealPerFieldCount,
  applyHealFromDestroyedAtk,
  applyHealFromDestroyedLevel,
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
  applyNormalSummonFromHand,
  applySpecialSummonFromZone,
  applySpecialSummonFromDeckWithCounterLimit,
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
  applyDestroyOtherDragonsAndBuff,
  applyBanishAllGraveyardAndBurn,
  applyDestroyCardsByScope,
} from "./destruction.js";
import {
  applyEquip,
} from "./equip.js";
import {
  applyAddCounter,
  applyCountFieldCounters,
  applyRemoveCounter,
  applyRemoveCountersFromField,
  applyRemoveAllCountersFromField,
  applyBuffStatsByCounter,
} from "./counters.js";
import {
  applyModifyLevel,
  applyReduceHandMonsterLevels,
  applyPermanentBuffNamed,
  applyRemovePermanentBuffNamed,
  applyBuffStatsTemp,
  applyBanishAndBuff,
  applyBuffAtkTemp,
  applySetOriginalStats,
  applySetAttackLimitFromZoneCount,
  applyRemoveStatIncreases,
  applyHalveTargetStatsAndGainRemoved,
  applyForbidAttackNextTurn,
  applyForbidAttackThisTurn,
  applyGrantProtection,
  applyGrantVoidFusionImmunity,
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
  applyRegisterSynchroMaterialFollowup,
  applyScheduleSpecialSummon,
  applyAbyssalSerpentDelayedSummon,
  applyNegateSummonOrActivationAndDestroy,
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
  "destroy_other_dragons_and_buff": applyDestroyOtherDragonsAndBuff,
  "banish_all_graveyard_and_burn": applyBanishAllGraveyardAndBurn,
  "banish_and_buff": applyBanishAndBuff,
  "permanent_buff_named": applyPermanentBuffNamed,
  "remove_permanent_buff_named": applyRemovePermanentBuffNamed,
  "modify_level": applyModifyLevel,
  "reduce_hand_monster_levels": applyReduceHandMonsterLevels,
  "register_synchro_material_followup": applyRegisterSynchroMaterialFollowup,
  "schedule_special_summon": applyScheduleSpecialSummon,
  "abyssal_serpent_delayed_summon": applyAbyssalSerpentDelayedSummon,
  "negate_summon_or_activation_and_destroy": applyNegateSummonOrActivationAndDestroy,
  "draw": applyDraw,
  "draw_and_summon": applyDrawAndSummon,
  "heal": applyHeal,
  "heal_per_opponent_cards_and_hand": applyHealPerOpponentCardsAndHand,
  "heal_per_archetype_monster": applyHealPerArchetypeMonster,
  "heal_per_field_count": applyHealPerFieldCount,
  "heal_from_destroyed_atk": applyHealFromDestroyedAtk,
  "heal_from_destroyed_level": applyHealFromDestroyedLevel,
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
  "special_summon_from_deck_with_counter_limit": applySpecialSummonFromDeckWithCounterLimit,
  "search_then_optional_special_summon_from_hand": applySearchThenOptionalSpecialSummonFromHand,
  "special_summon_from_hand_with_cost": applySpecialSummonFromHandWithCost,
  "special_summon_from_hand_with_tiered_cost": applySpecialSummonFromHandWithTieredCost,
  "bounce_and_summon": applyBounceAndSummon,
  "special_summon_token": applySpecialSummonToken,
  "conditional_summon_from_hand": applyConditionalSummonFromHand,
  "polymerization_fusion_summon": applyPolymerizationFusionSummon,
  "de_synchro": applyDeSynchro,
  "synchro_summon_from_extra_deck": applySynchroSummonFromExtraDeck,
  "normal_summon_from_hand": applyNormalSummonFromHand,
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
  "remove_counters_from_field": applyRemoveCountersFromField,
  "remove_all_counters_from_field": applyRemoveAllCountersFromField,
  "buff_stats_by_counter": applyBuffStatsByCounter,
  "buff_stats_temp": applyBuffStatsTemp,
  "buff_stats_temp_with_second_attack": applyBuffStatsTemp,
  "buff_atk_temp": applyBuffAtkTemp,
  "set_original_stats": applySetOriginalStats,
  "set_attack_limit_from_zone_count": applySetAttackLimitFromZoneCount,
  "remove_stat_increases": applyRemoveStatIncreases,
  "halve_target_stats_and_gain_removed": applyHalveTargetStatsAndGainRemoved,
  "forbid_attack_next_turn": applyForbidAttackNextTurn,
  "forbid_attack_this_turn": applyForbidAttackThisTurn,
  "grant_protection": applyGrantProtection,
  "grant_void_fusion_immunity": applyGrantVoidFusionImmunity,
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
} satisfies Partial<SimulatedActionHandlerManifest<ActionType>>;

export type SimulatedActionType = keyof typeof SIMULATED_ACTION_HANDLERS;

export function applySimulatedActions({
  actions,
  selections,
  state,
  selfId = "bot",
  options = {},
}: SimulatedActionBatchInput): boolean {
  if (!Array.isArray(actions)) return true;
  const { self, opponent } = getPerspectivePlayers(state, selfId);
  // Persistent stat recipients remain bound to their original field presence.
  const statReferences = Object.fromEntries(actions
    .filter(action => action?.type === "permanent_buff_named" && !action.applyToAllField)
    .map(action => {
      const ref = action.targetRef || "self";
      const cards = ref === "self" ? [options.sourceCard].filter(Boolean)
        : ref === "summonedCard" ? [options.actionContext?.summonedCard].filter(Boolean)
        : selections?.[ref] || [];
      return [ref, cards];
    }));
  options = { ...options, referenceSnapshots: {
    ...captureSimulatedReferences(options.referenceSnapshots === undefined ? options.effect : null, selections, self, opponent, statReferences),
    ...options.referenceSnapshots,
  } };
  if ((options._contextualReferencePreflight?.effect !== options.effect ||
      options._contextualReferencePreflight?.source !== options.sourceCard) &&
      !areRequiredContextualReferencesValid(options, self, opponent)) return false;
  options._contextualReferencePreflight = { effect: options.effect, source: options.sourceCard };

  for (const action of actions) {
    if (!action || !action.type) continue;
    const targets = resolveTargetsForAction(
      action,
      selections,
      { ...options, self, selfId },
      opponent,
    );
    // Indexing the heterogeneous mapped manifest loses its key/value
    // correlation here. The `satisfies` declaration above proves the pairs;
    // this is the only erased runtime-dispatch boundary.
    const handler = SIMULATED_ACTION_HANDLERS[
      action.type as SimulatedActionType
    ] as SimulatedActionHandler<ActionType> | undefined;

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
    refreshSimulatedFieldAuras(state);
    if (result === STOP_SIMULATION) return false;
    if (result === false && !shouldContinueAfterActionFailure(action)) return false;
  }
  return true;
}
