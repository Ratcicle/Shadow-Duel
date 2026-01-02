/**
 * wiring.js
 *
 * Wires all handlers to the registry.
 * Single import point for all handler modules.
 */

import { proxyEngineMethod } from "./registry.js";

// Movement handlers
import { handleReturnToHand, handleBounceAndSummon } from "./movement.js";

// Summon handlers
import {
  handleSpecialSummonFromZone,
  handleTransmutate,
  handleSpecialSummonFromHandWithCost,
  handleConditionalSummonFromHand,
  handleDrawAndSummon,
  handleAbyssalSerpentDelayedSummon,
  handleSpecialSummonFromDeckWithCounterLimit,
} from "./summon.js";

// Destruction handlers
import {
  handleBanish,
  handleBanishCardFromGraveyard,
  handleDestroyTargetedCards,
  handleDestroyAttackerOnArchetypeDestruction,
} from "./destruction.js";

// Stats handlers
import {
  handleSetStatsToZeroAndNegate,
  handleBuffStatsTemp,
  handleGrantAttackAllMonsters,
  handleAddStatus,
  handleGrantProtection,
  handleBanishAndBuff,
  handleSwitchPosition,
  handleSwitchDefenderPositionOnAttack,
  handlePermanentBuffNamed,
  handleRemovePermanentBuffNamed,
} from "./stats.js";

// Resources handlers
import {
  handlePayLP,
  handleAddFromZoneToHand,
  handleHealFromDestroyedAtk,
  handleHealFromDestroyedLevel,
  handleGrantAdditionalNormalSummon,
  handleUpkeepPayOrSendToGrave,
} from "./resources.js";

/**
 * Initialize default handlers
 * @param {ActionHandlerRegistry} registry
 */
export function registerDefaultHandlers(registry) {
  // Generic special summon handler

  registry.register("special_summon_from_zone", handleSpecialSummonFromZone);

  registry.register(
    "special_summon_from_hand_with_cost",

    handleSpecialSummonFromHandWithCost
  );

  registry.register(
    "special_summon_from_hand_with_tiered_cost",

    handleSpecialSummonFromHandWithCost
  );

  registry.register("bounce_and_summon", handleBounceAndSummon);

  registry.register(
    "special_summon_matching_level",

    handleSpecialSummonFromZone
  );

  registry.register("return_to_hand", handleReturnToHand);

  registry.register("transmutate", handleTransmutate);

  registry.register("banish", handleBanish);

  registry.register("banish_destroyed_monster", handleBanish);

  registry.register(
    "banish_card_from_graveyard",

    handleBanishCardFromGraveyard
  );

  // Stat modification and effect negation handlers

  registry.register(
    "set_stats_to_zero_and_negate",

    handleSetStatsToZeroAndNegate
  );

  registry.register(
    "grant_additional_normal_summon",

    handleGrantAdditionalNormalSummon
  );

  // Field control handlers

  registry.register("selective_field_destruction", handleDestroyTargetedCards);

  // Luminarch refactoring: new generic handlers

  registry.register("buff_stats_temp", handleBuffStatsTemp);

  registry.register("reduce_self_atk", handleBuffStatsTemp);

  registry.register("add_status", handleAddStatus);

  registry.register("pay_lp", handlePayLP);

  registry.register("add_from_zone_to_hand", handleAddFromZoneToHand);

  registry.register("heal_from_destroyed_atk", handleHealFromDestroyedAtk);

  registry.register("heal_from_destroyed_level", handleHealFromDestroyedLevel);

  registry.register("grant_protection", handleGrantProtection);

  registry.register("banish_and_buff", handleBanishAndBuff);

  registry.register("switch_position", handleSwitchPosition);

  registry.register(
    "switch_defender_position_on_attack",

    handleSwitchDefenderPositionOnAttack
  );

  registry.register("permanent_buff_named", handlePermanentBuffNamed);

  registry.register(
    "remove_permanent_buff_named",

    handleRemovePermanentBuffNamed
  );

  registry.register("grant_second_attack", handleBuffStatsTemp);

  registry.register("grant_attack_all_monsters", handleGrantAttackAllMonsters);

  registry.register(
    "conditional_summon_from_hand",

    handleConditionalSummonFromHand
  );

  // FASE 2: New handlers for Shadow-Heart refactoring

  registry.register(
    "destroy_attacker_on_archetype_destruction",

    handleDestroyAttackerOnArchetypeDestruction
  );

  registry.register(
    "upkeep_pay_or_send_to_grave",

    handleUpkeepPayOrSendToGrave
  );

  registry.register(
    "special_summon_from_deck_with_counter_limit",

    handleSpecialSummonFromDeckWithCounterLimit
  );

  // FASE 3: New handlers for complex Shadow-Heart methods

  registry.register("destroy_targeted_cards", handleDestroyTargetedCards);

  registry.register("buff_stats_temp_with_second_attack", handleBuffStatsTemp);

  registry.register("draw_and_summon", handleDrawAndSummon);

  // FASE 3: Handler for Abyssal Serpent Dragon delayed summon

  registry.register(
    "abyssal_serpent_delayed_summon",

    handleAbyssalSerpentDelayedSummon
  );

  // Legacy/common actions migrated into the registry (proxy to EffectEngine methods)

  registry.register("draw", proxyEngineMethod("applyDraw"));

  registry.register("heal", proxyEngineMethod("applyHeal"));

  registry.register(
    "heal_per_archetype_monster",

    proxyEngineMethod("applyHealPerArchetypeMonster")
  );

  registry.register("damage", proxyEngineMethod("applyDamage"));

  registry.register("destroy", proxyEngineMethod("applyDestroy"));

  registry.register("move", proxyEngineMethod("applyMove"));

  registry.register("equip", proxyEngineMethod("applyEquip"));

  registry.register("negate_attack", proxyEngineMethod("applyNegateAttack"));

  registry.register("search_any", handleAddFromZoneToHand);

  registry.register("buff_atk_temp", proxyEngineMethod("applyBuffAtkTemp"));

  registry.register(
    "modify_stats_temp",

    proxyEngineMethod("applyModifyStatsTemp")
  );

  registry.register("add_counter", proxyEngineMethod("applyAddCounter"));

  registry.register(
    "forbid_attack_this_turn",

    proxyEngineMethod("applyForbidAttackThisTurn")
  );

  registry.register(
    "forbid_attack_next_turn",

    proxyEngineMethod("applyForbidAttackNextTurn")
  );

  registry.register(
    "allow_direct_attack_this_turn",

    proxyEngineMethod("applyAllowDirectAttackThisTurn")
  );

  registry.register(
    "special_summon_token",

    proxyEngineMethod("applySpecialSummonToken")
  );

  registry.register(
    "grant_void_fusion_immunity",

    proxyEngineMethod("applyGrantVoidFusionImmunity")
  );

  registry.register(
    "destroy_self_monsters_and_draw",

    proxyEngineMethod("applyDestroyAllOthersAndDraw")
  );

  registry.register(
    "polymerization_fusion_summon",

    proxyEngineMethod("applyPolymerizationFusion")
  );

  registry.register(
    "call_of_haunted_summon_and_bind",

    proxyEngineMethod("applyCallOfTheHauntedSummon")
  );

  registry.register(
    "mirror_force_destroy_all",

    proxyEngineMethod("applyMirrorForceDestroy")
  );

  registry.register(
    "destroy_other_dragons_and_buff",

    proxyEngineMethod("applyDestroyOtherDragonsAndBuff")
  );
}
