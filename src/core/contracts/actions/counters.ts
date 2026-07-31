import type { DefineAction } from "./shared.js";

export interface CountersActionMap {
  add_counter: DefineAction<
    "add_counter",
    "counterType",
    | "targetRef" | "amount" | "damagePerCounter" | "amountFromFieldCount"
    | "targetScope" | "contextKey" | "storeAs" | "resultKey"
  >;
  remove_counter: DefineAction<
    "remove_counter",
    "targetRef" | "counterType" | "amount",
    "haltOnFailure" | "stopOnFailure"
  >;
  remove_counters_from_field: DefineAction<
    "remove_counters_from_field",
    "counterType",
    | "amount" | "count" | "minAmount" | "maxAmount" | "defaultAmount"
    | "variableAmount" | "owner" | "player" | "zone" | "zones"
    | "filters" | "requireFaceup" | "contextKey" | "storeAs"
    | "resultKey" | "selectionMessage" | "amountPrompt" | "haltOnFailure"
    | "stopOnFailure"
  >;
  count_field_counters: DefineAction<
    "count_field_counters",
    "counterType",
    | "owner" | "player" | "zone" | "zones" | "filters" | "requireFaceup"
    | "contextKey" | "storeAs" | "resultKey" | "log"
  >;
  remove_all_counters_from_field: DefineAction<
    "remove_all_counters_from_field",
    "counterType",
    | "owner" | "player" | "zone" | "zones" | "filters" | "requireFaceup"
    | "contextKey" | "storeAs" | "resultKey" | "haltOnFailure"
    | "stopOnFailure"
  >;
}
