import type { DefineAction } from "./shared.js";

export interface DestructionActionMap {
  banish: DefineAction<
    "banish",
    never,
    "targetRef" | "fromZone" | "haltOnFailure" | "stopOnFailure"
  >;
  banish_card_from_graveyard: DefineAction<
    "banish_card_from_graveyard",
    never,
    "filters" | "player" | "count"
  >;
  banish_all_graveyard_and_burn: DefineAction<
    "banish_all_graveyard_and_burn",
    never,
    "damagePerCard" | "player" | "scope"
  >;
  banish_destroyed_monster: DefineAction<"banish_destroyed_monster">;
  destroy: DefineAction<"destroy", "targetRef", "optional">;
  destroy_and_damage_by_target_atk: DefineAction<
    "destroy_and_damage_by_target_atk",
    never,
    "entries" | "skipDamageIf"
  >;
  destroy_attacker_on_archetype_destruction: DefineAction<
    "destroy_attacker_on_archetype_destruction",
    never,
    "archetype" | "minLevel"
  >;
  destroy_other_dragons_and_buff: DefineAction<
    "destroy_other_dragons_and_buff",
    never,
    "typeName" | "atkPerDestroyed" | "buffSourceName"
  >;
  destroy_self_monsters_and_draw: DefineAction<"destroy_self_monsters_and_draw">;
  destroy_targeted_cards: DefineAction<
    "destroy_targeted_cards",
    never,
    | "targetRef" | "zones" | "cardKind" | "subtype" | "filters" | "position"
    | "requireFaceup" | "minTargets" | "maxTargets" | "targetCountFromContext"
  >;
  destroy_cards_by_scope: DefineAction<
    "destroy_cards_by_scope",
    "targetScope",
    "cause" | "effectType" | "optional" | "drawPerDestroyed" | "drawPlayer"
  >;
  mirror_force_destroy_all: DefineAction<"mirror_force_destroy_all">;
  register_replacement_effect: DefineAction<
    "register_replacement_effect",
    "replacementEffect",
    "duration" | "sourceName" | "targetRef" | "uniqueKey" | "uses" | "usesPerTarget" | "logMessage"
  >;
  selective_field_destruction: DefineAction<
    "selective_field_destruction",
    never,
    "allowTieBreak" | "keepPerSide" | "modalInfoText" | "modalTitle"
  >;
}
