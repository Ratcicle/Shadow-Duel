import assert from "node:assert/strict";
import type { CardAction } from "../../src/core/contracts/actions.js";
import type { CardConstructorData } from "../../src/core/contracts/cards.js";
import type {
  ChainSelectionMap,
  ChainSelectionValue,
} from "../../src/core/contracts/chainRuntime.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import type { SelectionCandidateKey } from "../../src/core/contracts/primitives.js";
import {
  cardDatabaseById as byId,
  cardDatabaseByName as byName,
  cardDatabase as database,
} from "../../src/data/cards.js";

type UnionKeys<Value> = Value extends unknown ? keyof Value : never;
type UnionField<Value, Key extends PropertyKey> = Value extends unknown
  ? Key extends keyof Value
    ? Value[Key]
    : never
  : never;

// Assertions inspect fields across action variants. This read projection keeps
// the discriminated union and derives every optional field from that union.
type InspectedAction = CardAction & {
  readonly [Key in UnionKeys<CardAction>]?: UnionField<CardAction, Key>;
};
type InspectEffect<Value extends EffectDefinition> = Value extends unknown
  ? Omit<Value, "actions" | "activationCosts" | "activationCommitActions"> & {
      readonly actions?: readonly InspectedAction[];
      readonly activationCosts?: readonly InspectedAction[];
      readonly activationCommitActions?: readonly InspectedAction[];
    }
  : never;
export type FixtureEffect = InspectEffect<EffectDefinition>;
export type FixtureCard = Omit<CardConstructorData, "effects"> & {
  readonly effects?: readonly FixtureEffect[];
};

// Read through the public constructor contract without copying or changing
// database entries. Tests narrow optional fields at the assertion that uses them.
export const cardDatabase: readonly FixtureCard[] = database;
export const cardDatabaseById: ReadonlyMap<number, FixtureCard> = byId;
export const cardDatabaseByName: ReadonlyMap<string, FixtureCard> = byName;

export function cardDefinition(key: number | string): FixtureCard {
  const card = typeof key === "number" ? byId.get(key) : byName.get(key);
  assert.ok(card, `Missing card fixture: ${key}`);
  return card;
}

export function required<Value>(
  value: Value,
  label = "fixture value",
): NonNullable<Value> {
  assert.ok(value != null, `Missing ${label}`);
  return value;
}

/** Narrow successful object results without treating false/null as a result. */
export function objectResult<Value>(value: Value): Value & object {
  assert.ok(
    value !== null && typeof value === "object",
    "Expected an object result.",
  );
  return value as Value & object;
}

export function record(value: unknown): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}

export function array(value: unknown): unknown[] {
  assert.ok(Array.isArray(value), "Expected an array fixture.");
  return value;
}

export function selectedCards(
  selections: ChainSelectionMap,
  key: string,
): import("../../src/core/contracts/chainRuntime.js").ChainCard[] {
  const value: unknown = Reflect.get(selections, key);
  if (value == null) return [];
  assert.ok(Array.isArray(value));
  for (const card of value)
    assert.ok(
      card && typeof card === "object" && typeof card.name === "string",
    );
  return value;
}

export function selectionContract(
  value:
    | import("../../src/core/contracts/chainRuntime.js").ChainSelectionContract
    | null
    | undefined,
) {
  assert.ok(
    value && "requirements" in value && Array.isArray(value.requirements),
  );
  // Older normalized contracts omit these optional annotations. Reflect keeps
  // that absence observable while exposing their read projection to assertions.
  const purpose: unknown = Reflect.get(value, "purpose");
  const timing: unknown = Reflect.get(value, "timing");
  assert.ok(purpose == null || typeof purpose === "string");
  assert.ok(timing == null || typeof timing === "string");
  return value as typeof value & { purpose?: string; timing?: string };
}

export function selectionKey(key: string): SelectionCandidateKey {
  assert.ok(key.length > 0, "Selection fixtures require nonempty keys.");
  return key as SelectionCandidateKey;
}

export function chainSelections<
  Value extends Record<string, ChainSelectionValue>,
>(values: Value): Value & ChainSelectionMap {
  return values as Value & ChainSelectionMap;
}

/** Only for scenarios deliberately exercising malformed or legacy inputs. */
export function unsafeFixture<Value>(value: unknown, reason: string): Value {
  assert.ok(
    reason.trim(),
    "An unsafe fixture must explain its contract violation.",
  );
  return value as Value;
}
