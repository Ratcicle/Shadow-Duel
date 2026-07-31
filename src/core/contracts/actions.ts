import type { BlueprintActionMap } from "./actions/blueprint.js";
import type { CombatActionMap } from "./actions/combat.js";
import type { ConditionalActionMap } from "./actions/conditional.js";
import type { CountersActionMap } from "./actions/counters.js";
import type { DestructionActionMap } from "./actions/destruction.js";
import type { MovementActionMap } from "./actions/movement.js";
import type { ResourcesActionMap } from "./actions/resources.js";
import type { StatsActionMap } from "./actions/stats.js";
import type { SummonActionMap } from "./actions/summon.js";

export interface ActionByType
  extends ResourcesActionMap,
    MovementActionMap,
    SummonActionMap,
    DestructionActionMap,
    StatsActionMap,
    CombatActionMap,
    CountersActionMap,
    ConditionalActionMap,
    BlueprintActionMap {}

export type ActionType = keyof ActionByType;

export type ActionOf<Type extends ActionType> = ActionByType[Type];

export type CardAction = ActionByType[ActionType];

export type ActionCategory =
  | "resources"
  | "movement"
  | "summon"
  | "destruction"
  | "stats"
  | "combat"
  | "counters"
  | "conditional"
  | "blueprint"
  | "legacyProxy";

export type ActionFieldPrimitiveType =
  | "any"
  | "array"
  | "boolean"
  | "number"
  | "object"
  | "string"
  | "stringOrArray"
  | "zone";

export interface ActionFieldDefinition {
  readonly type?: ActionFieldPrimitiveType;
  readonly enum?: readonly (boolean | number | string)[];
  readonly values?: readonly string[];
  readonly min?: number;
  readonly description?: string;
}

type ActionFieldKey<Type extends ActionType> = Exclude<
  keyof ActionOf<Type>,
  "type"
> & string;

type RequiredActionFieldKey<Type extends ActionType> = {
  [Key in ActionFieldKey<Type>]-?: object extends Pick<ActionOf<Type>, Key>
    ? never
    : Key;
}[ActionFieldKey<Type>];

type OptionalActionFieldKey<Type extends ActionType> = Exclude<
  ActionFieldKey<Type>,
  RequiredActionFieldKey<Type>
>;

export interface ActionCatalogEntry<Type extends ActionType> {
  readonly category: ActionCategory;
  readonly summary: string;
  readonly handler: string;
  readonly required: readonly RequiredActionFieldKey<Type>[];
  readonly optional: readonly OptionalActionFieldKey<Type>[];
  readonly fields: {
    readonly [Key in ActionFieldKey<Type>]: ActionFieldDefinition;
  };
  readonly targetRef: "none" | "optional" | "required";
  readonly selection: "none" | "usesTargets" | "dynamic";
  readonly mutates: readonly string[];
  readonly emits: readonly string[];
  readonly updatesBoard: boolean;
  readonly preview: "notNeeded" | "covered" | "missing";
  readonly examples: readonly [ActionOf<Type>, ...ActionOf<Type>[]];
  readonly notes: readonly string[];
}

export type ActionCatalog = {
  readonly [Type in ActionType]: ActionCatalogEntry<Type>;
};

export type {
  ActionCase,
  ActionOwner,
  ActionPlayer,
  ActionPlayerScope,
  ActionProperties,
  ActionReplacementEffect,
  ActionTargetScope,
  ContextNumberSource,
  DefineAction,
  SelectionCount,
  SummonStatus,
} from "./actions/shared.js";
