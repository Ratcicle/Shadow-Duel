import type { CardAttribute, CardSubtype } from "../cards.js";
import type {
  CardFilter,
  MonsterRaceInput,
} from "../effects.js";
import type { ZoneInput } from "../zones.js";
import type { DefineAction, SelectionCount } from "./shared.js";

type RefineAction<
  Action,
  Refinement extends object,
> = Omit<Action, keyof Refinement> & Readonly<Refinement>;

export interface ResourceFieldCountFilter
  extends Omit<CardFilter, "zone"> {
  readonly zone?: ZoneInput;
}

export interface ResourceFieldCounterFilter {
  readonly requireFaceup?: boolean;
  readonly cardKind?: CardFilter["cardKind"];
  readonly archetype?: string;
  readonly type?: MonsterRaceInput;
  readonly attribute?: CardAttribute;
  readonly name?: string;
  readonly subtype?: CardSubtype;
}

export interface ResourcesActionMap {
  add_from_zone_to_hand: RefineAction<
    DefineAction<
      "add_from_zone_to_hand",
      never,
      | "zone" | "filters" | "count" | "promptPlayer" | "player"
      | "archetype" | "cardKind" | "cardName" | "monsterType"
      | "isToken" | "isTuner" | "minAtk" | "maxAtk" | "minDef"
      | "maxDef" | "minLevel" | "maxLevel" | "requireSource"
      | "cardId" | "cardIds" | "excludeName" | "excludeCardName"
      | "excludeCardNames" | "excludeNameRef" | "excludeTargetRef"
      | "excludeTargetRefs" | "markAddedCards" | "resultRef"
      | "storeResultAs" | "selectionId" | "selectionLabel"
      | "selectionMessage"
    >,
    {
      readonly zone?: ZoneInput;
      readonly count?: SelectionCount;
    }
  >;
  discard_from_hand: DefineAction<
    "discard_from_hand",
    never,
    | "player" | "count" | "chooser" | "contextLabel" | "selectionId"
    | "selectionLabel" | "selectionMessage" | "filters" | "promptPlayer"
  >;
  damage: DefineAction<"damage", "amount", "player">;
  damage_from_destroyed_atk: DefineAction<
    "damage_from_destroyed_atk",
    never,
    "fraction" | "multiplier" | "player" | "useBaseAtk"
  >;
  draw: DefineAction<"draw", "amount", "player">;
  grant_additional_normal_summon: DefineAction<
    "grant_additional_normal_summon",
    never,
    "count" | "filters" | "archetype" | "cardKind"
  >;
  heal: DefineAction<"heal", never, "amount" | "amountFromContext" | "player">;
  heal_from_destroyed_atk: DefineAction<
    "heal_from_destroyed_atk",
    never,
    "fraction" | "multiplier" | "useBaseAtk"
  >;
  heal_from_destroyed_level: DefineAction<
    "heal_from_destroyed_level",
    never,
    "multiplier" | "player"
  >;
  heal_per_archetype_monster: DefineAction<
    "heal_per_archetype_monster",
    "archetype" | "amountPerMonster",
    "player"
  >;
  heal_per_field_count: RefineAction<
    DefineAction<
      "heal_per_field_count",
      "amountPerCard",
      "filters" | "player"
    >,
    { readonly filters?: ResourceFieldCountFilter }
  >;
  heal_per_field_counter: RefineAction<
    DefineAction<
      "heal_per_field_counter",
      "amountPerCounter" | "counterType",
      "player" | "owner" | "zone" | "zones" | "filters"
    >,
    {
      readonly zone?: ZoneInput;
      readonly filters?: ResourceFieldCounterFilter;
    }
  >;
  heal_per_opponent_cards_and_hand: DefineAction<
    "heal_per_opponent_cards_and_hand",
    "amountPerCard",
    "player"
  >;
  pay_lp: DefineAction<"pay_lp", never, "amount" | "fraction" | "player">;
  restrict_effect_activations_by_names: DefineAction<
    "restrict_effect_activations_by_names",
    never,
    | "player" | "names" | "cardNames" | "blockedNames" | "nameSource"
    | "duration" | "reason" | "logMessage"
  >;
  restrict_effect_activations_by_attribute: DefineAction<
    "restrict_effect_activations_by_attribute",
    never,
    | "player" | "allowedAttributes" | "attributes" | "attributeSourceRef"
    | "attributeSource" | "sourceRef" | "targetRef"
    | "restrictedCardFilters" | "duration" | "reason" | "logMessage"
  >;
  search_any: RefineAction<
    DefineAction<
      "search_any",
      never,
      | "archetype" | "cardKind" | "cardName" | "count" | "filters"
      | "maxLevel" | "minLevel" | "player" | "promptPlayer" | "zone"
    >,
    {
      readonly zone?: ZoneInput;
      readonly count?: SelectionCount;
    }
  >;
  search_then_optional_special_summon_from_hand: RefineAction<
    DefineAction<
      "search_then_optional_special_summon_from_hand",
      never,
      | "zone" | "filters" | "count" | "promptPlayer" | "player"
      | "archetype" | "cardKind" | "cardName" | "monsterType"
      | "isToken" | "isTuner" | "minAtk" | "maxAtk" | "minDef"
      | "maxDef" | "minLevel" | "maxLevel" | "requireSource"
      | "cardId" | "condition" | "summonCondition" | "optional"
      | "position" | "cannotAttackThisTurn" | "restrictAttackThisTurn"
      | "promptMessage" | "promptTitle" | "confirmLabel" | "cancelLabel"
    >,
    {
      readonly zone?: ZoneInput;
      readonly count?: SelectionCount;
    }
  >;
  shuffle_deck: DefineAction<"shuffle_deck", never, "player">;
  upkeep_pay_or_send_to_grave: DefineAction<
    "upkeep_pay_or_send_to_grave",
    "lpCost",
    "failureZone"
  >;
}
