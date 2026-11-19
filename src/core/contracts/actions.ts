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

/**
 * Event participants an action needs present on the field for its trigger to
 * be collected at all (decision V9, 19/11/2026). Declared per action type, so
 * every card using the action follows the same rule without card data.
 */
export interface ActionEventPresenceRequirement {
  /**
   * The monster that declared the attack in this battle must still be on the
   * field, in the presence it battled in, controlled by this side relative to
   * the trigger owner, and affectable by the trigger owner's effects.
   */
  readonly battleAttacker: "opponent" | "self";
  /** Events that carry the battle participants this requirement reads. */
  readonly events: readonly ("battle_destroy" | "attack_declared" | "battle_damage" | "damage_step")[];
}

export const ACTION_EVENT_PRESENCE_REQUIREMENTS = Object.freeze({
  destroy_attacker_on_archetype_destruction: Object.freeze({
    battleAttacker: "opponent",
    events: Object.freeze(["battle_destroy"] as const),
  }),
} as const satisfies Readonly<Partial<Record<ActionType, ActionEventPresenceRequirement>>>);

/** The presence requirement one action type declares, if any. */
export function getActionEventPresenceRequirement(
  type: string | null | undefined,
): ActionEventPresenceRequirement | null {
  if (!type || !Object.hasOwn(ACTION_EVENT_PRESENCE_REQUIREMENTS, type)) return null;
  const table: Readonly<Partial<Record<string, ActionEventPresenceRequirement>>> =
    ACTION_EVENT_PRESENCE_REQUIREMENTS;
  return table[type] ?? null;
}

export type ActionCategory =
  | "resources"
  | "movement"
  | "summon"
  | "destruction"
  | "stats"
  | "combat"
  | "counters"
  | "conditional"
  | "blueprint";

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

export interface ActionCatalogEntry<
  Type extends ActionType,
  HandlerLabel extends string = string,
> {
  readonly category: ActionCategory;
  readonly summary: string;
  readonly handler: HandlerLabel;
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

export type ActionCatalog<
  HandlerLabelByType extends { readonly [Type in ActionType]: string } = {
    readonly [Type in ActionType]: string;
  },
> = {
  readonly [Type in ActionType]: ActionCatalogEntry<
    Type,
    HandlerLabelByType[Type]
  >;
};

export type {
  ActionCase,
  ActionOwner,
  ActionPlayer,
  ActionPlayerScope,
  ActionProperties,
  ActionReplacementEffect,
  ReplacementRegistrationEntry,
  ActionTargetScope,
  ContextNumberSource,
  DefineAction,
  DestroyDamageEntry,
  SelectionCount,
  SummonStatus,
} from "./actions/shared.js";
