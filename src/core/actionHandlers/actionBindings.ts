import type {
  ActionOf,
  ActionType,
} from "../contracts/actions.js";
import type {
  ActionHandler,
  ActionHandlerEnginePort,
  EffectContext,
  LegacyActionHandlerResult,
  MaybePromise,
  ProxyActionType,
  ProxyMethodByAction,
  ResolvedTargetMap,
} from "../contracts/actionRuntime.js";

import { handleActivateStoredBlueprint } from "./blueprints.js";
import { handleChooseActionCase, handleDeclareCardProperty } from "./choice.js";
import {
  handleConditionalActions,
  handleConditionalTargetActions,
  handleOptionalTargetActions,
  handleRedirectCurrentAttackToTarget,
  handleRegisterBattlePairEffect,
  handleRegisterSynchroMaterialFollowup,
  handleRegisterTemporaryEventEffect,
  handleSetSourceAfterResolutionIf,
} from "./conditional.js";
import {
  handleBanish,
  handleBanishAllGraveyardAndBurn,
  handleBanishCardFromGraveyard,
  handleDestroyAndDamageByTargetAtk,
  handleDestroyAttackerOnArchetypeDestruction,
  handleDestroyCardsByScope,
  handleDestroyTargetedCards,
  handleRegisterReplacementEffect,
  handleScheduleReturnFromBanished,
} from "./destruction.js";
import {
  handleBounceAndSummon,
  handleReturnToHand,
  handleShuffleOpponentFieldToDeck,
  handleTakeControl,
} from "./movement.js";
import {
  handleNegateActivation,
  handleNegateEffect,
  handleNegateSummonOrActivationAndDestroy,
} from "./negation.js";
import {
  handleAddFromZoneToHand,
  handleDamageFromDestroyedAtk,
  handleDiscardFromHand,
  handleGrantAdditionalNormalSummon,
  handleHealFromDestroyedAtk,
  handleHealFromDestroyedLevel,
  handleHealPerFieldCount,
  handleHealPerFieldCounter,
  handleHealPerOpponentCardsAndHand,
  handlePayLP,
  handleRestrictEffectActivationsByAttribute,
  handleRestrictEffectActivationsByNames,
  handleSearchThenOptionalSpecialSummonFromHand,
  handleUpkeepPayOrSendToGrave,
} from "./resources.js";
import {
  handleAddStatus,
  handleBanishAndBuff,
  handleBuffAtkByLpGainedThisTurn,
  handleBuffStatsByCounter,
  handleBuffStatsTemp,
  handleGrantAttackAllMonsters,
  handleGrantProtection,
  handleHalveTargetStatsAndGainRemoved,
  handleModifyLevel,
  handleModifyStatsTempThenDestroyIfZeroed,
  handlePermanentBuffNamed,
  handleReduceHandMonsterLevels,
  handleRemovePermanentBuffNamed,
  handleRemoveStatIncreases,
  handleSetAttackLimitFromZoneCount,
  handleSetFacedownDefense,
  handleSetOriginalStats,
  handleSetStatsToZeroAndNegate,
  handleSwitchDefenderPositionOnAttack,
  handleSwitchPosition,
} from "./stats.js";
import {
  handleAbyssalSerpentDelayedSummon,
  handleConditionalSummonFromHand,
  handleDeSynchro,
  handleDrawAndSummon,
  handleRestrictSpecialSummons,
  handleScheduleSpecialSummon,
  handleSpecialSummonFromDeckWithCounterLimit,
  handleSpecialSummonFromHandWithCost,
  handleSpecialSummonFromZone,
  handleSynchroSummonFromExtraDeck,
  handleTransmutate,
} from "./summon.js";

type EngineProxyMethod<Type extends ActionType> = (
  action: ActionOf<Type>,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
) => MaybePromise<LegacyActionHandlerResult>;

export type CompatibleEffectEngineMethodFor<
  Type extends ProxyActionType,
> = ProxyMethodByAction[Type] extends keyof ActionHandlerEnginePort
  ? ActionHandlerEnginePort[ProxyMethodByAction[Type]] extends EngineProxyMethod<Type>
    ? ProxyMethodByAction[Type]
    : never
  : never;

export interface DirectActionBinding<Type extends ActionType, Id extends string = string> {
  readonly kind: "direct";
  readonly handlerId: Id;
  readonly handler: ActionHandler<Type>;
}

export interface ProxyActionBinding<Type extends ProxyActionType> {
  readonly kind: "proxy";
  readonly method: CompatibleEffectEngineMethodFor<Type>;
}

export type ActionBindingByType = {
  readonly [Type in ActionType]: Type extends ProxyActionType
    ? ProxyActionBinding<Type>
    : DirectActionBinding<Type>;
};

function direct<const Id extends string, Handler>(handlerId: Id, handler: Handler) {
  return { kind: "direct" as const, handlerId, handler };
}

function proxy<const Method extends string>(method: Method) {
  return { kind: "proxy" as const, method };
}

/**
 * Canonical runtime wiring. Property order intentionally matches the legacy
 * registry registration order because listTypes() exposes that order.
 */
export const ACTION_BINDINGS = {
  special_summon_from_zone: direct("handleSpecialSummonFromZone", handleSpecialSummonFromZone),
  restrict_special_summons: direct("handleRestrictSpecialSummons", handleRestrictSpecialSummons),
  de_synchro: direct("handleDeSynchro", handleDeSynchro),
  synchro_summon_from_extra_deck: direct("handleSynchroSummonFromExtraDeck", handleSynchroSummonFromExtraDeck),
  special_summon_from_hand_with_cost: direct("handleSpecialSummonFromHandWithCost", handleSpecialSummonFromHandWithCost),
  special_summon_from_hand_with_tiered_cost: direct("handleSpecialSummonFromHandWithCost", handleSpecialSummonFromHandWithCost),
  bounce_and_summon: direct("handleBounceAndSummon", handleBounceAndSummon),
  special_summon_matching_level: direct("handleSpecialSummonFromZone", handleSpecialSummonFromZone),
  return_to_hand: direct("handleReturnToHand", handleReturnToHand),
  take_control: direct("handleTakeControl", handleTakeControl),
  shuffle_opponent_field_to_deck: direct("handleShuffleOpponentFieldToDeck", handleShuffleOpponentFieldToDeck),
  transmutate: direct("handleTransmutate", handleTransmutate),
  banish: direct("handleBanish", handleBanish),
  banish_destroyed_monster: direct("handleBanish", handleBanish),
  banish_card_from_graveyard: direct("handleBanishCardFromGraveyard", handleBanishCardFromGraveyard),
  banish_all_graveyard_and_burn: direct("handleBanishAllGraveyardAndBurn", handleBanishAllGraveyardAndBurn),
  set_stats_to_zero_and_negate: direct("handleSetStatsToZeroAndNegate", handleSetStatsToZeroAndNegate),
  grant_additional_normal_summon: direct("handleGrantAdditionalNormalSummon", handleGrantAdditionalNormalSummon),
  selective_field_destruction: direct("handleDestroyTargetedCards", handleDestroyTargetedCards),
  buff_stats_temp: direct("handleBuffStatsTemp", handleBuffStatsTemp),
  set_original_stats: direct("handleSetOriginalStats", handleSetOriginalStats),
  buff_stats_by_counter: direct("handleBuffStatsByCounter", handleBuffStatsByCounter),
  modify_stats_temp_then_destroy_if_zeroed: direct("handleModifyStatsTempThenDestroyIfZeroed", handleModifyStatsTempThenDestroyIfZeroed),
  reduce_self_atk: direct("handleBuffStatsTemp", handleBuffStatsTemp),
  add_status: direct("handleAddStatus", handleAddStatus),
  reduce_hand_monster_levels: direct("handleReduceHandMonsterLevels", handleReduceHandMonsterLevels),
  modify_level: direct("handleModifyLevel", handleModifyLevel),
  set_attack_limit_from_zone_count: direct("handleSetAttackLimitFromZoneCount", handleSetAttackLimitFromZoneCount),
  pay_lp: direct("handlePayLP", handlePayLP),
  restrict_effect_activations_by_names: direct("handleRestrictEffectActivationsByNames", handleRestrictEffectActivationsByNames),
  restrict_effect_activations_by_attribute: direct("handleRestrictEffectActivationsByAttribute", handleRestrictEffectActivationsByAttribute),
  add_from_zone_to_hand: direct("handleAddFromZoneToHand", handleAddFromZoneToHand),
  discard_from_hand: direct("handleDiscardFromHand", handleDiscardFromHand),
  declare_card_property: direct("handleDeclareCardProperty", handleDeclareCardProperty),
  search_then_optional_special_summon_from_hand: direct("handleSearchThenOptionalSpecialSummonFromHand", handleSearchThenOptionalSpecialSummonFromHand),
  damage_from_destroyed_atk: direct("handleDamageFromDestroyedAtk", handleDamageFromDestroyedAtk),
  heal_from_destroyed_atk: direct("handleHealFromDestroyedAtk", handleHealFromDestroyedAtk),
  heal_from_destroyed_level: direct("handleHealFromDestroyedLevel", handleHealFromDestroyedLevel),
  heal_per_field_count: direct("handleHealPerFieldCount", handleHealPerFieldCount),
  heal_per_field_counter: direct("handleHealPerFieldCounter", handleHealPerFieldCounter),
  heal_per_opponent_cards_and_hand: direct("handleHealPerOpponentCardsAndHand", handleHealPerOpponentCardsAndHand),
  grant_protection: direct("handleGrantProtection", handleGrantProtection),
  banish_and_buff: direct("handleBanishAndBuff", handleBanishAndBuff),
  set_facedown_defense: direct("handleSetFacedownDefense", handleSetFacedownDefense),
  switch_position: direct("handleSwitchPosition", handleSwitchPosition),
  switch_defender_position_on_attack: direct("handleSwitchDefenderPositionOnAttack", handleSwitchDefenderPositionOnAttack),
  permanent_buff_named: direct("handlePermanentBuffNamed", handlePermanentBuffNamed),
  remove_stat_increases: direct("handleRemoveStatIncreases", handleRemoveStatIncreases),
  halve_target_stats_and_gain_removed: direct("handleHalveTargetStatsAndGainRemoved", handleHalveTargetStatsAndGainRemoved),
  remove_permanent_buff_named: direct("handleRemovePermanentBuffNamed", handleRemovePermanentBuffNamed),
  grant_second_attack: direct("handleBuffStatsTemp", handleBuffStatsTemp),
  grant_attack_all_monsters: direct("handleGrantAttackAllMonsters", handleGrantAttackAllMonsters),
  conditional_summon_from_hand: direct("handleConditionalSummonFromHand", handleConditionalSummonFromHand),
  destroy_attacker_on_archetype_destruction: direct("handleDestroyAttackerOnArchetypeDestruction", handleDestroyAttackerOnArchetypeDestruction),
  upkeep_pay_or_send_to_grave: direct("handleUpkeepPayOrSendToGrave", handleUpkeepPayOrSendToGrave),
  special_summon_from_deck_with_counter_limit: direct("handleSpecialSummonFromDeckWithCounterLimit", handleSpecialSummonFromDeckWithCounterLimit),
  destroy_targeted_cards: direct("handleDestroyTargetedCards", handleDestroyTargetedCards),
  destroy_cards_by_scope: direct("handleDestroyCardsByScope", handleDestroyCardsByScope),
  destroy_and_damage_by_target_atk: direct("handleDestroyAndDamageByTargetAtk", handleDestroyAndDamageByTargetAtk),
  register_replacement_effect: direct("handleRegisterReplacementEffect", handleRegisterReplacementEffect),
  schedule_return_from_banished: direct("handleScheduleReturnFromBanished", handleScheduleReturnFromBanished),
  buff_stats_temp_with_second_attack: direct("handleBuffStatsTemp", handleBuffStatsTemp),
  buff_atk_by_lp_gained_this_turn: direct("handleBuffAtkByLpGainedThisTurn", handleBuffAtkByLpGainedThisTurn),
  draw_and_summon: direct("handleDrawAndSummon", handleDrawAndSummon),
  abyssal_serpent_delayed_summon: direct("handleAbyssalSerpentDelayedSummon", handleAbyssalSerpentDelayedSummon),
  schedule_special_summon: direct("handleScheduleSpecialSummon", handleScheduleSpecialSummon),
  draw: proxy("applyDraw"),
  shuffle_deck: proxy("applyShuffleDeck"),
  conditional_target_actions: direct("handleConditionalTargetActions", handleConditionalTargetActions),
  optional_target_actions: direct("handleOptionalTargetActions", handleOptionalTargetActions),
  conditional_actions: direct("handleConditionalActions", handleConditionalActions),
  register_temporary_event_effect: direct("handleRegisterTemporaryEventEffect", handleRegisterTemporaryEventEffect),
  register_synchro_material_followup: direct("handleRegisterSynchroMaterialFollowup", handleRegisterSynchroMaterialFollowup),
  register_battle_pair_effect: direct("handleRegisterBattlePairEffect", handleRegisterBattlePairEffect),
  redirect_current_attack_to_target: direct("handleRedirectCurrentAttackToTarget", handleRedirectCurrentAttackToTarget),
  set_source_after_resolution_if: direct("handleSetSourceAfterResolutionIf", handleSetSourceAfterResolutionIf),
  choose_action_case: direct("handleChooseActionCase", handleChooseActionCase),
  heal: proxy("applyHeal"),
  heal_per_archetype_monster: proxy("applyHealPerArchetypeMonster"),
  damage: proxy("applyDamage"),
  destroy: proxy("applyDestroy"),
  move: proxy("applyMove"),
  equip: proxy("applyEquip"),
  negate_attack: proxy("applyNegateAttack"),
  end_battle_phase: proxy("applyEndBattlePhase"),
  negate_summon_or_activation_and_destroy: direct("handleNegateSummonOrActivationAndDestroy", handleNegateSummonOrActivationAndDestroy),
  negate_activation: direct("handleNegateActivation", handleNegateActivation),
  negate_effect: direct("handleNegateEffect", handleNegateEffect),
  search_any: direct("handleAddFromZoneToHand", handleAddFromZoneToHand),
  buff_atk_temp: proxy("applyBuffAtkTemp"),
  modify_stats_temp: proxy("applyModifyStatsTemp"),
  add_counter: proxy("applyAddCounter"),
  remove_counter: proxy("applyRemoveCounter"),
  remove_all_counters_from_field: proxy("applyRemoveAllCountersFromField"),
  remove_counters_from_field: proxy("applyRemoveCountersFromField"),
  count_field_counters: proxy("applyCountFieldCounters"),
  forbid_attack_this_turn: proxy("applyForbidAttackThisTurn"),
  forbid_attack_next_turn: proxy("applyForbidAttackNextTurn"),
  allow_direct_attack_this_turn: proxy("applyAllowDirectAttackThisTurn"),
  forbid_direct_attack_this_turn: proxy("applyForbidDirectAttackThisTurn"),
  special_summon_token: proxy("applySpecialSummonToken"),
  special_summon_self_as_trap_monster: proxy("applySpecialSummonSelfAsTrapMonster"),
  grant_void_fusion_immunity: proxy("applyGrantVoidFusionImmunity"),
  destroy_self_monsters_and_draw: proxy("applyDestroyAllOthersAndDraw"),
  polymerization_fusion_summon: proxy("applyPolymerizationFusion"),
  call_of_haunted_summon_and_bind: proxy("applyCallOfTheHauntedSummon"),
  mirror_force_destroy_all: proxy("applyMirrorForceDestroy"),
  destroy_other_dragons_and_buff: proxy("applyDestroyOtherDragonsAndBuff"),
  activate_stored_blueprint: direct("handleActivateStoredBlueprint", handleActivateStoredBlueprint),
} as const satisfies ActionBindingByType;

export type ActionBindingLabelByType = {
  readonly [Type in ActionType]: (typeof ACTION_BINDINGS)[Type] extends {
    readonly kind: "direct";
    readonly handlerId: infer Id extends string;
  }
    ? Id
    : (typeof ACTION_BINDINGS)[Type] extends {
          readonly kind: "proxy";
          readonly method: infer Method extends string;
        }
      ? `proxy:${Method}`
      : never;
};

export function getActionBindingLabel<Type extends ActionType>(
  type: Type,
): ActionBindingLabelByType[Type];
export function getActionBindingLabel(type: ActionType): string {
  const binding = ACTION_BINDINGS[type];
  return (binding.kind === "direct"
    ? binding.handlerId
    : `proxy:${binding.method}`);
}

export function listActionBindingTypes(): ActionType[] {
  return Object.keys(ACTION_BINDINGS) as ActionType[];
}
