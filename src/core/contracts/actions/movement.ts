import type { DefineAction } from "./shared.js";

export interface MovementActionMap {
  move: DefineAction<
    "move",
    "to",
    | "targetRef" | "targetScope" | "player" | "fromZone" | "isFacedown"
    | "resetAttackFlags" | "preservePosition" | "allowEmpty"
    | "allowExtraDeckMonsterToHand" | "allowExtraDeckMonsterToHandIf"
    | "skipSendToGraveReplacement" | "skipSendToGraveActionReplacement"
    | "contextLabel" | "storeResultAs" | "storeLevelSumAs"
  >;
  return_to_hand: DefineAction<
    "return_to_hand",
    "targetRef",
    "fromZone" | "contextLabel" | "haltOnFailure" | "stopOnFailure"
  >;
  take_control: DefineAction<
    "take_control",
    "targetRef",
    "player" | "duration" | "contextLabel"
  >;
  shuffle_opponent_field_to_deck: DefineAction<"shuffle_opponent_field_to_deck">;
}
