import type { ActionType, CardAction } from "./actions.js";
import type {
  BattlePosition,
  CardAttribute,
  CardKind,
  CardSubtype,
  MonsterRace,
  MonsterType,
} from "./cards.js";
import type { ChainResponseContextType } from "./chain.js";
import type { RawCardDefinitionId } from "./primitives.js";
import type { SummonMethod } from "./summon.js";
import type { CanonicalZone } from "./zones.js";

/**
 * Effect timings currently accepted by CardDatabaseValidator. Values are kept
 * in validator order to make the runtime contract easy to audit.
 */
export const EFFECT_TIMINGS = Object.freeze([
  "on_play",
  "on_event",
  "on_activate",
  "ignition",
  "on_field_activate",
  "passive",
  "manual",
] as const);

export type EffectTiming = (typeof EFFECT_TIMINGS)[number];

/**
 * Trigger event names currently accepted by CardDatabaseValidator. This is not
 * yet a payload map; informational event-bus names remain outside this union.
 */
export const DUEL_EVENT_NAMES = Object.freeze([
  "after_summon",
  "battle_destroy",
  "battle_completed",
  "damage_step",
  "card_flipped",
  "battle_damage_inflicted",
  "card_to_grave",
  "card_moved",
  "counter_removed",
  "standby_phase",
  "end_phase",
  "attack_declared",
  "battle_damage",
  "opponent_damage",
  "before_destroy",
  "effect_targeted",
  "card_activation",
  "effect_activation",
  "card_equipped",
  "lp_change",
  "spell_activated",
  "effect_activated",
  "position_change",
] as const);

export type DuelEventName = (typeof DUEL_EVENT_NAMES)[number];

export const USAGE_POLICIES = Object.freeze({
  USE: "use",
  ACTIVATE: "activate",
} as const);

export type UsagePolicy =
  (typeof USAGE_POLICIES)[keyof typeof USAGE_POLICIES];

export const TRIGGER_REQUIREMENTS = Object.freeze({
  MANDATORY: "mandatory",
  OPTIONAL: "optional",
} as const);

export type TriggerRequirement =
  (typeof TRIGGER_REQUIREMENTS)[keyof typeof TRIGGER_REQUIREMENTS];

export const TRIGGER_TIMINGS = Object.freeze({
  IF: "if",
  WHEN: "when",
} as const);

export type TriggerTiming =
  (typeof TRIGGER_TIMINGS)[keyof typeof TRIGGER_TIMINGS];

/**
 * Damage Step ordering is persisted in transaction and event payloads. Keep
 * these values identical to the established quick-spell rule surface.
 */
export const DAMAGE_STEP_TIMINGS = Object.freeze({
  START: "start_of_damage_step",
  BEFORE_CALCULATION: "before_damage_calculation",
  CALCULATION: "damage_calculation",
  AFTER_CALCULATION: "after_damage_calculation",
  END: "end_of_damage_step",
} as const);

export type DamageStepTiming =
  (typeof DAMAGE_STEP_TIMINGS)[keyof typeof DAMAGE_STEP_TIMINGS];

export type EffectOwner = "self" | "opponent" | "any" | "both";
export type EffectZone = CanonicalZone | "any" | "removed";
export type MainPhase = "main1" | "main2";
export type EffectResponseContext =
  | ChainResponseContextType
  | "summon_attempt";

export type NumericComparisonOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

export type OneOrMany<T> = T | readonly T[];
export type MonsterRaceInput = MonsterRace | Lowercase<MonsterRace>;

/**
 * Closed filter surface shared by effects, targets and action contracts. The
 * fields are the complete declarative filter vocabulary currently used by the
 * card database; consumers may refine their supported subset further.
 */
export interface CardFilter {
  readonly archetype?: string;
  readonly attribute?: OneOrMany<CardAttribute>;
  readonly cardId?: RawCardDefinitionId;
  readonly cardKind?: OneOrMany<CardKind>;
  readonly cardName?: string;
  readonly counterType?: string;
  readonly equippedWithFilters?: EquippedCardFilter;
  readonly excludeCardName?: string;
  readonly excludeCardNames?: readonly string[];
  readonly excludeMonsterTypes?: readonly MonsterType[];
  readonly excludeSelf?: boolean;
  readonly facedown?: boolean;
  readonly isToken?: boolean;
  readonly isTuner?: boolean;
  readonly level?: number;
  readonly levelOp?: NumericComparisonOperator;
  readonly maxAtk?: number;
  readonly maxDef?: number;
  readonly maxLevel?: number;
  readonly minAtk?: number;
  readonly minDef?: number;
  readonly minLevel?: number;
  readonly minCounters?: number;
  readonly monsterType?: OneOrMany<MonsterType>;
  readonly name?: string;
  readonly owner?: EffectOwner;
  readonly position?: BattlePosition;
  readonly requireFaceup?: boolean;
  readonly sentToGraveAsMaterial?: SummonMethod;
  readonly sentToGraveAsMaterialThisTurn?: boolean;
  readonly subtype?: OneOrMany<CardSubtype>;
  readonly textIncludes?: string;
  readonly type?: MonsterRaceInput;
  readonly zone?: OneOrMany<EffectZone>;
  readonly zones?: readonly EffectZone[];
}

export interface EquippedCardFilter {
  readonly archetype?: string;
  readonly cardKind?: OneOrMany<CardKind>;
  readonly requireFaceup?: boolean;
  readonly subtype?: OneOrMany<CardSubtype>;
}

export interface EffectCountRange {
  readonly min: number;
  readonly max: number;
  readonly cap?: number;
  readonly maxFrom?: "opponentFieldCount";
}

export interface TargetAlternative {
  readonly archetype?: string;
  readonly owner?: EffectOwner;
}

export interface TargetAttributeComparison {
  readonly attr: "atk" | "def" | "level" | "originalLevel";
  readonly op: NumericComparisonOperator;
  readonly ref: string;
}

export interface PairedTargetAttributeComparison {
  readonly attr: "atk" | "def" | "level" | "originalLevel";
  readonly op: NumericComparisonOperator;
}

export interface PairedEffectTarget {
  readonly archetype?: string;
  readonly cardKind?: CardKind;
  readonly compareAttribute?: PairedTargetAttributeComparison;
  readonly excludeCannotBeSpecialSummoned?: boolean;
  readonly excludeSameName?: boolean;
  readonly owner?: EffectOwner;
  readonly zone?: EffectZone;
}

export type ContextTargetName =
  | "attacker"
  | "battleDestroyer"
  | "changedCard"
  | "defender"
  | "destroyed"
  | "eventCard"
  | "host"
  | "source"
  | "summonedCard"
  | "target";

/** A target declaration is closed while retaining the combinations in data. */
export interface EffectTarget {
  readonly id: string;
  readonly anyOf?: readonly TargetAlternative[];
  readonly archetype?: string;
  readonly attribute?: CardAttribute | readonly CardAttribute[];
  readonly autoSelect?: boolean;
  readonly battleParticipant?: boolean;
  readonly cardId?: RawCardDefinitionId;
  readonly cardKind?: CardKind | readonly CardKind[];
  readonly cardName?: string;
  readonly compareAttribute?: TargetAttributeComparison;
  readonly count?: EffectCountRange;
  readonly countFromSelectionRef?: string;
  readonly counterType?: string;
  readonly excludeCannotBeSpecialSummoned?: boolean;
  readonly excludeCardName?: string;
  readonly excludeContextCard?: ContextTargetName;
  readonly excludeEventCardName?: boolean;
  readonly excludeNameRef?: string;
  readonly excludeSelf?: boolean;
  readonly excludeTargetRef?: string;
  readonly faceup?: boolean;
  readonly filters?: CardFilter;
  readonly intent?: "cost";
  readonly isTuner?: boolean;
  readonly lastSummonedFromZone?: CanonicalZone;
  readonly maxDef?: number;
  readonly maxLevel?: number;
  readonly minAtk?: number;
  readonly minAtResolution?: number;
  readonly minCounters?: number;
  readonly minLevel?: number;
  readonly monsterType?: MonsterType;
  readonly name?: string;
  readonly optional?: boolean;
  readonly owner?: EffectOwner;
  readonly pairedTarget?: PairedEffectTarget;
  readonly requireFaceup?: boolean;
  readonly requireThisCard?: boolean;
  readonly subtype?: CardSubtype;
  readonly summonMethods?: readonly SummonMethod[];
  readonly targetFromContext?: ContextTargetName;
  readonly type?: MonsterRaceInput;
  readonly zone?: CanonicalZone;
  readonly zones?: readonly CanonicalZone[];
}

export type EffectConditionType =
  | "activation_would_banish_cards_matching_filters"
  | "activation_would_destroy_cards_matching_filters"
  | "activation_would_make_card_leave_field"
  | "any_of"
  | "attacker_matches"
  | "battle_destroyer_matches_filters"
  | "battle_opponent_matches_declared_value"
  | "battle_participant_matches_filters"
  | "context_number_compare"
  | "control_card"
  | "control_card_filters"
  | "control_card_max"
  | "control_card_type"
  | "control_type_min_level"
  | "destroyed_card_matches_declared_value"
  | "equipped_with_filters"
  | "event_card_matches_declared_value_from_effect_sources"
  | "event_card_matches_filters"
  | "empty_field"
  | "field_card_count"
  | "field_card_count_comparison"
  | "field_counters_at_least"
  | "graveyardHasMatch"
  | "has_stored_blueprint"
  | "match_card_props"
  | "opponentMonstersMin"
  | "playerFieldCount"
  | "playerFieldEmpty"
  | "playerLpMin"
  | "source_counters_at_least"
  | "source_has_marker"
  | "summoned_card_has_marker"
  | "targetRefMatchesFilters";

/**
 * Conditions remain composable (including recursive any_of) but reject
 * unknown declarative fields and unknown condition discriminants.
 */
export interface StructuredEffectCondition {
  readonly type: EffectConditionType;
  readonly activationPlayer?: EffectOwner;
  readonly affectedPlayer?: EffectOwner;
  readonly archetype?: string;
  readonly attackerType?: MonsterRace;
  readonly attribute?: CardAttribute;
  readonly cardKind?: CardKind;
  readonly cardName?: string;
  readonly cardRef?: string;
  readonly conditions?: readonly EffectCondition[];
  readonly count?: number;
  readonly counterType?: string;
  readonly destroyedCardFilters?: CardFilter;
  readonly destroyedCardZones?: readonly EffectZone[];
  readonly equippedWithFilters?: EquippedCardFilter;
  readonly excludeSource?: boolean;
  readonly filters?: CardFilter;
  readonly includeFacedown?: boolean;
  readonly key?: string;
  readonly leftOwner?: EffectOwner;
  readonly max?: number;
  readonly maxLevel?: number;
  readonly min?: number;
  readonly minCount?: number;
  readonly minLevel?: number;
  readonly minMatchingCostCount?: number;
  readonly op?: NumericComparisonOperator;
  readonly operator?: NumericComparisonOperator | ">" | ">=" | "<" | "<=" | "===" | "!=" | "!==";
  readonly owner?: EffectOwner;
  readonly property?: string;
  readonly reason?: string;
  readonly requireCurrentFieldPresence?: boolean;
  readonly requireFaceup?: boolean;
  readonly rightOwner?: EffectOwner;
  readonly sourceEffectId?: string;
  readonly sourceFilters?: CardFilter;
  readonly sourceRef?: string;
  readonly stateKey?: string;
  readonly subtype?: CardSubtype;
  readonly targetRef?: string;
  readonly typeName?: MonsterRace;
  readonly value?: number;
  readonly valueFromContext?: string;
  readonly zone?: EffectZone;
  readonly zones?: readonly EffectZone[];
}

export type LegacyTriggerGate =
  | {
      readonly requires: "self_in_hand";
      readonly triggerArchetype?: string;
    }
  | {
      readonly type: "destroyed_by_battle" | "destroyed_by_battle_or_effect";
    };

export type EffectCondition = StructuredEffectCondition | LegacyTriggerGate;

export type PassiveRuleType =
  | "activation_negation_protection"
  | "additional_normal_summon"
  | "archetype_count_buff"
  | "banish_protection"
  | "battle_indestructible_if_stat_match"
  | "battle_phase_activation_lock"
  | "conditional_destruction_protection_aura"
  | "conditional_extra_attacks"
  | "conditional_protection"
  | "conditional_status"
  | "conditional_unaffected_by_effects"
  | "counter_attack_lock"
  | "equipped_counter_buff"
  | "equipped_field_counter_buff"
  | "field_archetype_aura_buff"
  | "field_counter_stat_aura"
  | "field_presence_type_summon_count_buff"
  | "graveyard_archetype_count_buff"
  | "graveyard_card_count_buff"
  | "graveyard_type_count_buff"
  | "lp_cost_reduction"
  | "lp_gain_multiplier"
  | "negate_opponent_battle_destruction_prevention"
  | "position_status"
  | "restrict_opponent_summon_turn_attack"
  | "send_to_grave_replacement";

export interface PassiveTargetScope {
  readonly excludeSelf?: boolean;
  readonly filters?: CardFilter;
  readonly owner?: EffectOwner;
  readonly requireFaceup?: boolean;
  readonly zone?: CanonicalZone;
  readonly zones?: readonly CanonicalZone[];
}

/** Closed capability bag for the heterogeneous passive rules in the database. */
export interface PassiveRuleDefinition {
  readonly type: PassiveRuleType;
  readonly actionTypes?: readonly ActionType[];
  readonly activePosition?: BattlePosition;
  readonly amount?: number;
  readonly amountPerCard?: number;
  readonly amountPerCounter?: number;
  readonly appliesTo?: EffectOwner;
  readonly archetype?: string;
  readonly atkBoost?: number;
  readonly cardKind?: CardKind;
  readonly cardKinds?: readonly CardKind[];
  readonly cardName?: string;
  readonly condition?: EffectCondition;
  readonly conditions?: readonly EffectCondition[];
  readonly count?: number;
  readonly counterFilters?: CardFilter;
  readonly counterOwners?: readonly EffectOwner[];
  readonly counterType?: string;
  readonly counterZones?: readonly CanonicalZone[];
  readonly countOwner?: EffectOwner;
  readonly countOwners?: readonly EffectOwner[];
  readonly equippedWithFilters?: EquippedCardFilter;
  readonly exceptSourceArchetypes?: readonly string[];
  readonly filters?: CardFilter;
  readonly includeSelf?: boolean;
  readonly minCounters?: number;
  readonly monsterType?: MonsterType | MonsterRace;
  readonly multiplier?: number;
  readonly opponentFilters?: CardFilter;
  readonly preventedEffectOwners?: readonly EffectOwner[];
  readonly protectFrom?: "opponent_effects";
  readonly protectionType?: "battle_destruction" | "effect_destruction";
  readonly reason?: string;
  readonly redirectTo?: CanonicalZone;
  readonly requireFaceup?: boolean;
  readonly requireSoleMonster?: boolean;
  readonly sourceFilters?: CardFilter;
  readonly stackMode?: "max";
  readonly stat?: "atk" | "def";
  readonly stats?: readonly ("atk" | "def")[];
  readonly status?: string;
  readonly summonMethods?: readonly SummonMethod[];
  readonly target?: "self";
  readonly targetCardKinds?: readonly CardKind[];
  readonly targetFilters?: CardFilter;
  readonly targetOwner?: EffectOwner;
  readonly targetOwners?: readonly EffectOwner[];
  readonly targetRequireFaceup?: boolean;
  readonly targetRestriction?: "monster";
  readonly targetScope?: PassiveTargetScope;
  readonly targetZones?: readonly CanonicalZone[];
  readonly textIncludes?: string;
  readonly typeName?: MonsterRace;
}

export interface ReplacementEffectBehavior {
  readonly type: "destruction" | "send_to_grave";
  readonly auto?: boolean;
  readonly costActions?: readonly CardAction[];
  readonly costCount?: number;
  readonly costDestination?: CanonicalZone;
  readonly costFilters?: CardFilter;
  readonly costOwner?: "source" | EffectOwner;
  readonly costZone?: CanonicalZone;
  readonly logMessage?: string;
  readonly prompt?: string;
  readonly reason?: "any" | "battle" | "effect";
  readonly selectionMessage?: string;
  readonly targetFilters?: CardFilter;
  readonly targetMustBeEquippedToSource?: boolean;
  readonly targetMustBeSource?: boolean;
  readonly targetMustNotBeSource?: boolean;
  readonly targetOwner?: EffectOwner;
  readonly targetRequireFaceup?: boolean;
  readonly targetZones?: readonly CanonicalZone[];
}

export interface ActivatedCardFilter extends CardFilter {
  readonly excludeCardNames?: readonly string[];
}

export interface ActivatedEffectFilter {
  readonly activationZone?: OneOrMany<CanonicalZone>;
  readonly placementOnly?: boolean;
  readonly timing?: EffectTiming;
}

export interface EventCardFilter extends CardFilter {
  readonly eventCardIsEquippedToSource?: boolean;
  readonly fromZone?: EffectZone;
  readonly toZone?: EffectZone;
}

export interface EffectUiOptions {
  readonly allowCancel?: boolean;
}

export interface NegationCostDefinition {
  readonly type: "reduce_self_atk";
  readonly amount: number;
}

interface EffectCapabilities {
  readonly id: string;
  readonly speed?: 1 | 2 | 3;
  readonly isQuickEffect?: boolean;
  readonly event?: DuelEventName;
  readonly triggerRequirement?: TriggerRequirement;
  readonly triggerTiming?: TriggerTiming;
  readonly activationZones?: readonly CanonicalZone[];
  readonly activationCosts?: readonly CardAction[];
  readonly activationCommitActions?: readonly CardAction[];
  readonly actions?: readonly CardAction[];
  readonly targets?: readonly EffectTarget[];
  readonly condition?: LegacyTriggerGate;
  readonly conditions?: readonly EffectCondition[];
  readonly activatedCardFilters?: ActivatedCardFilter;
  readonly activatedEffectFilters?: ActivatedEffectFilter;
  readonly activationLabelKey?: string;
  readonly allowIfEffectsNegatedAtFieldExit?: boolean;
  readonly canRespondTo?: readonly EffectResponseContext[];
  readonly changedCardOwner?: EffectOwner;
  readonly changedCardRequireFaceup?: boolean;
  readonly changedCardRequireFaceupBeforeChange?: boolean;
  readonly contextLabel?: string;
  readonly counterType?: string;
  readonly damageStepTimings?: readonly DamageStepTiming[];
  readonly description?: string;
  readonly destroyedCardFilters?: CardFilter;
  readonly endPhasePlayer?: "any";
  readonly eventCardFilters?: EventCardFilter;
  readonly excludeActivatedSelf?: boolean;
  readonly fromZone?: EffectZone;
  readonly handModalLabelKey?: string;
  readonly minAmount?: number;
  readonly movedByEffect?: boolean;
  readonly negationCost?: readonly NegationCostDefinition[];
  readonly oncePerDuel?: boolean;
  readonly oncePerDuelLimit?: number;
  readonly oncePerDuelName?: string;
  readonly oncePerTurn?: boolean;
  readonly oncePerTurnLimit?: number;
  readonly oncePerTurnName?: string;
  readonly oncePerTurnPerCard?: boolean;
  readonly oncePerTurnPerEventCard?: boolean;
  readonly oncePerTurnScope?: "card";
  readonly positionChangedByEffect?: boolean;
  readonly positionChangeSourceFilters?: CardFilter;
  readonly promptMessage?: string;
  readonly promptUser?: boolean;
  readonly requireDefender?: boolean;
  readonly requireDefenderIsSelf?: boolean;
  readonly requireDefenderPosition?: boolean;
  readonly requireDefenderType?: Lowercase<MonsterRace>;
  readonly requireDestroyedByOpponent?: boolean;
  readonly requireDestroyedIsOpponent?: boolean;
  readonly requireDestroyedPosition?: BattlePosition;
  readonly requireEmptyField?: boolean;
  readonly requireEquipCardFilters?: EquippedCardFilter;
  readonly requireEquippedAsBattleDestroyer?: boolean;
  readonly requireFaceup?: boolean;
  readonly requireMovedCardWasFaceup?: boolean;
  readonly requireOpponentAttack?: boolean;
  readonly requireOpponentSummon?: boolean;
  readonly requireOwnMonsterArchetype?: string;
  readonly requirePhase?: readonly MainPhase[];
  readonly requireRemovedFromField?: boolean;
  readonly requireSelfAsAttacker?: boolean;
  readonly requireSelfAsBattleDestroyer?: boolean;
  readonly requireSelfAsDefender?: boolean;
  readonly requireSelfAsDestroyed?: boolean;
  readonly requireSelfAsMoved?: boolean;
  readonly requireSelfAsSummoned?: boolean;
  readonly requireSelfBattled?: boolean;
  readonly requireSelfDestroyedByBattle?: boolean;
  readonly requireSelfSummonProcedure?: "trap_monster";
  readonly requireSelfWasSummonedBy?: SummonMethod;
  readonly requireZone?: CanonicalZone;
  readonly respectStoredEffectUsageLimits?: boolean;
  readonly standbyPlayer?: "any";
  readonly storableByGrimoire?: boolean;
  readonly summonFrom?: CanonicalZone;
  readonly summonMethods?: readonly SummonMethod[];
  readonly toZone?: EffectZone;
  readonly triggerPlayer?: "current" | "opponent" | "self";
  readonly ui?: EffectUiOptions;
  readonly usagePolicy?: UsagePolicy;
}

export interface EventTriggerEffect extends EffectCapabilities {
  readonly timing: "on_event";
  readonly event: DuelEventName;
  readonly triggerRequirement: TriggerRequirement;
  readonly triggerTiming: TriggerTiming;
}

export interface IgnitionEffect extends EffectCapabilities {
  readonly timing: "ignition" | "manual";
  readonly activationZones: readonly CanonicalZone[];
}

export interface OtherTimedActiveEffect extends EffectCapabilities {
  readonly timing:
    | "on_play"
    | "on_activate"
    | "on_field_activate";
}

export type TimedActiveEffect =
  | EventTriggerEffect
  | IgnitionEffect
  | OtherTimedActiveEffect;

export interface PassiveRuleEffect extends EffectCapabilities {
  readonly timing: "passive";
  readonly passive: PassiveRuleDefinition;
}

export interface ReplacementEffectDefinition extends EffectCapabilities {
  readonly timing?: "passive";
  readonly replacementEffect: ReplacementEffectBehavior;
}

export interface LegacyDocumentedPassiveEffect extends EffectCapabilities {
  readonly timing: "passive";
  readonly description: string;
}

/**
 * Runtime effects combine independent capabilities; the four variants model
 * only invariants demonstrated by the current database.
 */
export type EffectDefinition =
  | TimedActiveEffect
  | PassiveRuleEffect
  | ReplacementEffectDefinition
  | LegacyDocumentedPassiveEffect;
