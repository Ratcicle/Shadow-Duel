/**
 * wiring.js
 *
 * Wires all handlers to the registry.
 * Single import point for all handler modules.
 */

import { proxyEngineMethod } from "./registry.js";

// Movement handlers
import { handleReturnToHand, handleBounceAndSummon, handleShuffleOpponentFieldToDeck } from "./movement.js";

// Summon handlers
import {
  handleSpecialSummonFromZone,
  handleTransmutate,
  handleSpecialSummonFromHandWithCost,
  handleConditionalSummonFromHand,
  handleDrawAndSummon,
  handleAbyssalSerpentDelayedSummon,
  handleSpecialSummonFromDeckWithCounterLimit,
  handleRestrictSpecialSummons,
  handleScheduleSpecialSummon,
  handleDeSynchro,
  handleSynchroSummonFromExtraDeck,
} from "./summon.js";

// Destruction handlers
import {
  handleBanish,
  handleBanishCardFromGraveyard,
  handleBanishAllGraveyardAndBurn,
  handleDestroyTargetedCards,
  handleDestroyCardsByScope,
  handleDestroyAndDamageByTargetAtk,
  handleDestroyAttackerOnArchetypeDestruction,
  handleRegisterReplacementEffect,
  handleScheduleReturnFromBanished,
} from "./destruction.js";

// Stats handlers
import {
  handleSetStatsToZeroAndNegate,
  handleSetOriginalStats,
  handleBuffStatsTemp,
  handleBuffStatsByCounter,
  handleModifyStatsTempThenDestroyIfZeroed,
  handleGrantAttackAllMonsters,
  handleAddStatus,
  handleGrantProtection,
  handleBanishAndBuff,
  handleBuffAtkByLpGainedThisTurn,
  handleSetAttackLimitFromZoneCount,
  handleSwitchPosition,
  handleSwitchDefenderPositionOnAttack,
  handleRemoveStatIncreases,
  handleModifyLevel,
  handleHalveTargetStatsAndGainRemoved,
  handlePermanentBuffNamed,
  handleRemovePermanentBuffNamed,
  handleReduceHandMonsterLevels,
} from "./stats.js";

// Resources handlers
import {
  handlePayLP,
  handleAddFromZoneToHand,
  handleDiscardFromHand,
  handleSearchThenOptionalSpecialSummonFromHand,
  handleDamageFromDestroyedAtk,
  handleHealFromDestroyedAtk,
  handleHealFromDestroyedLevel,
  handleHealPerFieldCount,
  handleHealPerFieldCounter,
  handleHealPerOpponentCardsAndHand,
  handleGrantAdditionalNormalSummon,
  handleRestrictEffectActivationsByAttribute,
  handleRestrictEffectActivationsByNames,
  handleUpkeepPayOrSendToGrave,
} from "./resources.js";

// Blueprint handlers
import { handleActivateStoredBlueprint } from "./blueprints.js";

// Conditional handlers
import {
  handleConditionalActions,
  handleConditionalTargetActions,
  handleOptionalTargetActions,
  handleRegisterBattlePairEffect,
  handleRegisterSynchroMaterialFollowup,
  handleRegisterTemporaryEventEffect,
  handleRedirectCurrentAttackToTarget,
  handleSetSourceAfterResolutionIf,
} from "./conditional.js";
import { handleChooseActionCase, handleDeclareCardProperty } from "./choice.js";
import {
  handleNegateActivation,
  handleNegateEffect,
  handleNegateSummonOrActivationAndDestroy,
} from "./negation.js";

/**
 * Initialize default handlers
 * @param {ActionHandlerRegistry} registry
 */
export function registerDefaultHandlers(registry) {
  // Generic special summon handler

  registry.register("special_summon_from_zone", handleSpecialSummonFromZone);
  registry.register("restrict_special_summons", handleRestrictSpecialSummons);
  registry.register("de_synchro", handleDeSynchro);
  registry.register(
    "synchro_summon_from_extra_deck",
    handleSynchroSummonFromExtraDeck,
  );

  registry.register(
    "special_summon_from_hand_with_cost",

    handleSpecialSummonFromHandWithCost,
  );

  registry.register(
    "special_summon_from_hand_with_tiered_cost",

    handleSpecialSummonFromHandWithCost,
  );

  registry.register("bounce_and_summon", handleBounceAndSummon);

  registry.register(
    "special_summon_matching_level",

    handleSpecialSummonFromZone,
  );

  registry.register("return_to_hand", handleReturnToHand);
  registry.register("shuffle_opponent_field_to_deck", handleShuffleOpponentFieldToDeck);

  registry.register("transmutate", handleTransmutate);

  registry.register("banish", handleBanish);

  registry.register("banish_destroyed_monster", handleBanish);

  registry.register(
    "banish_card_from_graveyard",

    handleBanishCardFromGraveyard,
  );

  registry.register(
    "banish_all_graveyard_and_burn",

    handleBanishAllGraveyardAndBurn,
  );

  // Stat modification and effect negation handlers

  registry.register(
    "set_stats_to_zero_and_negate",

    handleSetStatsToZeroAndNegate,
  );

  registry.register(
    "grant_additional_normal_summon",

    handleGrantAdditionalNormalSummon,
  );

  // Field control handlers

  registry.register("selective_field_destruction", handleDestroyTargetedCards);

  // Luminarch refactoring: new generic handlers

  registry.register("buff_stats_temp", handleBuffStatsTemp);
  registry.register("set_original_stats", handleSetOriginalStats);

  registry.register("buff_stats_by_counter", handleBuffStatsByCounter);

  registry.register(
    "modify_stats_temp_then_destroy_if_zeroed",
    handleModifyStatsTempThenDestroyIfZeroed,
  );

  registry.register("reduce_self_atk", handleBuffStatsTemp);

  registry.register("add_status", handleAddStatus);

  registry.register("reduce_hand_monster_levels", handleReduceHandMonsterLevels);
  registry.register("modify_level", handleModifyLevel);
  registry.register(
    "set_attack_limit_from_zone_count",
    handleSetAttackLimitFromZoneCount,
  );

  registry.register("pay_lp", handlePayLP);
  registry.register(
    "restrict_effect_activations_by_names",
    handleRestrictEffectActivationsByNames,
  );
  registry.register(
    "restrict_effect_activations_by_attribute",
    handleRestrictEffectActivationsByAttribute,
  );

  registry.register("add_from_zone_to_hand", handleAddFromZoneToHand);
  registry.register("discard_from_hand", handleDiscardFromHand);
  registry.register("declare_card_property", handleDeclareCardProperty);
  registry.register(
    "search_then_optional_special_summon_from_hand",
    handleSearchThenOptionalSpecialSummonFromHand,
  );

  registry.register("damage_from_destroyed_atk", handleDamageFromDestroyedAtk);

  registry.register("heal_from_destroyed_atk", handleHealFromDestroyedAtk);

  registry.register("heal_from_destroyed_level", handleHealFromDestroyedLevel);

  registry.register("heal_per_field_count", handleHealPerFieldCount);
  registry.register("heal_per_field_counter", handleHealPerFieldCounter);
  registry.register(
    "heal_per_opponent_cards_and_hand",
    handleHealPerOpponentCardsAndHand,
  );

  registry.register("grant_protection", handleGrantProtection);

  registry.register("banish_and_buff", handleBanishAndBuff);

  registry.register("switch_position", handleSwitchPosition);

  registry.register(
    "switch_defender_position_on_attack",

    handleSwitchDefenderPositionOnAttack,
  );

  registry.register("permanent_buff_named", handlePermanentBuffNamed);

  registry.register("remove_stat_increases", handleRemoveStatIncreases);

  registry.register(
    "halve_target_stats_and_gain_removed",
    handleHalveTargetStatsAndGainRemoved,
  );

  registry.register(
    "remove_permanent_buff_named",

    handleRemovePermanentBuffNamed,
  );

  registry.register("grant_second_attack", handleBuffStatsTemp);

  registry.register("grant_attack_all_monsters", handleGrantAttackAllMonsters);

  registry.register(
    "conditional_summon_from_hand",

    handleConditionalSummonFromHand,
  );

  // FASE 2: New handlers for Shadow-Heart refactoring

  registry.register(
    "destroy_attacker_on_archetype_destruction",

    handleDestroyAttackerOnArchetypeDestruction,
  );

  registry.register(
    "upkeep_pay_or_send_to_grave",

    handleUpkeepPayOrSendToGrave,
  );

  registry.register(
    "special_summon_from_deck_with_counter_limit",

    handleSpecialSummonFromDeckWithCounterLimit,
  );

  // FASE 3: New handlers for complex Shadow-Heart methods

  registry.register("destroy_targeted_cards", handleDestroyTargetedCards);
  registry.register("destroy_cards_by_scope", handleDestroyCardsByScope);
  registry.register(
    "destroy_and_damage_by_target_atk",
    handleDestroyAndDamageByTargetAtk,
  );
  registry.register(
    "register_replacement_effect",
    handleRegisterReplacementEffect,
  );
  registry.register(
    "schedule_return_from_banished",
    handleScheduleReturnFromBanished,
  );

  registry.register("buff_stats_temp_with_second_attack", handleBuffStatsTemp);
  registry.register(
    "buff_atk_by_lp_gained_this_turn",
    handleBuffAtkByLpGainedThisTurn,
  );

  registry.register("draw_and_summon", handleDrawAndSummon);

  // FASE 3: Handler for Abyssal Serpent Dragon delayed summon

  registry.register(
    "abyssal_serpent_delayed_summon",

    handleAbyssalSerpentDelayedSummon,
  );
  registry.register("schedule_special_summon", handleScheduleSpecialSummon);

  // Legacy/common actions migrated into the registry (proxy to EffectEngine methods)

  registry.register("draw", proxyEngineMethod("applyDraw"));
  registry.register("shuffle_deck", proxyEngineMethod("applyShuffleDeck"));

  registry.register(
    "conditional_target_actions",
    handleConditionalTargetActions,
  );
  registry.register("optional_target_actions", handleOptionalTargetActions);
  registry.register("conditional_actions", handleConditionalActions);
  registry.register(
    "register_temporary_event_effect",
    handleRegisterTemporaryEventEffect,
  );
  registry.register(
    "register_synchro_material_followup",
    handleRegisterSynchroMaterialFollowup,
  );
  registry.register("register_battle_pair_effect", handleRegisterBattlePairEffect);
  registry.register(
    "redirect_current_attack_to_target",
    handleRedirectCurrentAttackToTarget,
  );
  registry.register(
    "set_source_after_resolution_if",
    handleSetSourceAfterResolutionIf,
  );
  registry.register("choose_action_case", handleChooseActionCase);

  registry.register("heal", proxyEngineMethod("applyHeal"));

  registry.register(
    "heal_per_archetype_monster",

    proxyEngineMethod("applyHealPerArchetypeMonster"),
  );

  registry.register("damage", proxyEngineMethod("applyDamage"));

  registry.register("destroy", proxyEngineMethod("applyDestroy"));

  registry.register("move", proxyEngineMethod("applyMove"));

  registry.register("equip", proxyEngineMethod("applyEquip"));

  registry.register("negate_attack", proxyEngineMethod("applyNegateAttack"));
  registry.register(
    "end_battle_phase",
    proxyEngineMethod("applyEndBattlePhase"),
  );
  registry.register(
    "negate_summon_or_activation_and_destroy",
    handleNegateSummonOrActivationAndDestroy,
  );
  registry.register("negate_activation", handleNegateActivation);
  registry.register("negate_effect", handleNegateEffect);

  registry.register("search_any", handleAddFromZoneToHand);

  registry.register("buff_atk_temp", proxyEngineMethod("applyBuffAtkTemp"));

  registry.register(
    "modify_stats_temp",

    proxyEngineMethod("applyModifyStatsTemp"),
  );

  registry.register("add_counter", proxyEngineMethod("applyAddCounter"));
  registry.register("remove_counter", proxyEngineMethod("applyRemoveCounter"));
  registry.register(
    "remove_all_counters_from_field",
    proxyEngineMethod("applyRemoveAllCountersFromField"),
  );
  registry.register(
    "remove_counters_from_field",
    proxyEngineMethod("applyRemoveCountersFromField"),
  );
  registry.register(
    "count_field_counters",
    proxyEngineMethod("applyCountFieldCounters"),
  );

  registry.register(
    "forbid_attack_this_turn",

    proxyEngineMethod("applyForbidAttackThisTurn"),
  );

  registry.register(
    "forbid_attack_next_turn",

    proxyEngineMethod("applyForbidAttackNextTurn"),
  );

  registry.register(
    "allow_direct_attack_this_turn",

    proxyEngineMethod("applyAllowDirectAttackThisTurn"),
  );

  registry.register(
    "forbid_direct_attack_this_turn",

    proxyEngineMethod("applyForbidDirectAttackThisTurn"),
  );

  registry.register(
    "special_summon_token",

    proxyEngineMethod("applySpecialSummonToken"),
  );

  registry.register(
    "special_summon_self_as_trap_monster",

    proxyEngineMethod("applySpecialSummonSelfAsTrapMonster"),
  );

  registry.register(
    "grant_void_fusion_immunity",

    proxyEngineMethod("applyGrantVoidFusionImmunity"),
  );

  registry.register(
    "destroy_self_monsters_and_draw",

    proxyEngineMethod("applyDestroyAllOthersAndDraw"),
  );

  registry.register(
    "polymerization_fusion_summon",

    proxyEngineMethod("applyPolymerizationFusion"),
  );

  registry.register(
    "call_of_haunted_summon_and_bind",

    proxyEngineMethod("applyCallOfTheHauntedSummon"),
  );

  registry.register(
    "mirror_force_destroy_all",

    proxyEngineMethod("applyMirrorForceDestroy"),
  );

  registry.register(
    "destroy_other_dragons_and_buff",

    proxyEngineMethod("applyDestroyOtherDragonsAndBuff"),
  );

  // Blueprint actions
  registry.register("activate_stored_blueprint", handleActivateStoredBlueprint);
}
