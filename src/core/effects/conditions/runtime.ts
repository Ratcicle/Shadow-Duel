import type {
  ActionRuntimeCard,
  EffectContext,
  ResolvedTargetMap,
} from "../../contracts/actionRuntime.js";
import type { CardEffectMarkerMap } from "../../contracts/cards.js";
import type { AIDecisionPlan } from "../../contracts/ai.js";
import type { ActionOf } from "../../contracts/actions.js";
import type {
  EffectDefinition,
  EffectCondition,
  StructuredEffectCondition,
} from "../../contracts/effects.js";
import type {
  SelectionCardReference,
  SelectionChannelSource,
} from "../../contracts/selection.js";
import type { FilterCard, RuntimeCardFilter } from "../filters/cardFilters.js";
import type { TemporaryEventEffect } from "../triggers/runtime.js";
import type { resolveTargets } from "../targeting/resolution.js";
import type { EngineFaultHost } from "../../game/devTools/faults.js";

// These conditions only inspect existing state in both canonical interpreters.
// Impact predictions recurse into actions; declaration expiry and blueprint
// normalization can mutate state, so those conditions are not previewed here.
const READ_ONLY_PREVIEW_CONDITIONS = new Set([
  "context_number_compare",
  "control_card",
  "control_card_filters",
  "control_card_max",
  "battle_destroyer_matches_filters",
  "battle_participant_matches_filters",
  "field_card_count",
  "field_card_count_comparison",
  "event_card_matches_filters",
  "event_card_matches_declared_value_from_effect_sources",
  "targetRefMatchesFilters",
  "source_has_marker",
  "summoned_card_has_marker",
  "source_counters_at_least",
  "attacker_matches",
]);

/** Reuse canonical predicates without invoking stateful or recursive previews. */
export function evaluateActivationPreviewConditions(
  conditions: readonly unknown[] | null | undefined,
  evaluate: (condition: object) => boolean,
): boolean {
  const active = new WeakSet<object>();
  const visit = (condition: unknown): boolean => {
    if (!condition || typeof condition !== "object" || active.has(condition)) return false;
    const type: unknown = Reflect.get(condition, "type");
    if (type === "any_of") {
      active.add(condition);
      const options: unknown = Reflect.get(condition, "conditions") ??
        Reflect.get(condition, "anyOf") ?? Reflect.get(condition, "any_of");
      const result = Array.isArray(options) && options.some(visit);
      active.delete(condition);
      return result;
    }
    return typeof type === "string" && READ_ONLY_PREVIEW_CONDITIONS.has(type) && evaluate(condition);
  };
  return !conditions || conditions.every(visit);
}

type CapturedProcedureCondition =
  | { readonly kind: "frozen"; readonly result: ConditionResult }
  | { readonly kind: "capacity"; readonly condition: EffectCondition }
  | { readonly kind: "any"; readonly children: readonly CapturedProcedureCondition[]; readonly reason?: string };

/** Only unfiltered upper bounds describe open Monster Zones, rather than event facts. */
function isProcedureCapacityCondition(condition: EffectCondition): boolean {
  return "type" in condition && condition.type === "field_card_count" &&
    (condition.zone || "field") === "field" &&
    (!condition.zones || condition.zones.length === 1 && condition.zones[0] === "field") &&
    condition.max !== undefined && condition.min === undefined && condition.count === undefined &&
    !condition.filters && !condition.excludeSource && !condition.requireFaceup;
}

/** Freeze event predicates once; read Monster Zone capacity only at the activation opportunity. */
export function captureProcedureTriggerConditions(
  conditions: readonly EffectCondition[],
  evaluate: (condition: EffectCondition) => ConditionResult,
): { readonly possible: boolean; readonly check: () => ConditionResult } {
  const active = new WeakSet<object>();
  const capture = (condition: EffectCondition): CapturedProcedureCondition => {
    if (active.has(condition)) return { kind: "frozen", result: { ok: false, reason: "Cyclic trigger condition." } };
    if ("type" in condition && condition.type === "any_of" && condition.conditions?.length) {
      active.add(condition);
      const children = condition.conditions.map(capture);
      active.delete(condition);
      return { kind: "any", children, ...(condition.reason ? { reason: condition.reason } : {}) };
    }
    return isProcedureCapacityCondition(condition) ? { kind: "capacity", condition } :
      { kind: "frozen", result: evaluate(condition) };
  };
  const captured = conditions.map(capture);
  const check = (condition: CapturedProcedureCondition, possible: boolean): ConditionResult => {
    if (condition.kind === "frozen") return condition.result;
    if (condition.kind === "capacity") return possible ? { ok: true } : evaluate(condition.condition);
    let failure: ConditionResult = { ok: false };
    for (const child of condition.children) {
      const result = check(child, possible);
      if (result.ok) return result;
      failure = result;
    }
    return condition.reason ? { ok: false, reason: condition.reason } : failure;
  };
  const checkAll = (possible: boolean): ConditionResult => {
    for (const condition of captured) {
      const result = check(condition, possible);
      if (!result.ok) return result;
    }
    return { ok: true };
  };
  return { possible: checkAll(true).ok, check: () => checkAll(false) };
}

export interface ConditionCard extends ActionRuntimeCard {
  effectMarkers?: CardEffectMarkerMap;
  fieldPresenceId?: string | number | null;
}

export type ConditionZone =
  | "field"
  | "spellTrap"
  | "hand"
  | "graveyard"
  | "deck"
  | "extraDeck"
  | "banished";
export interface ConditionPlayer {
  id: string;
  lp?: number;
  field?: ConditionCard[];
  spellTrap?: ConditionCard[];
  hand?: ConditionCard[];
  graveyard?: ConditionCard[];
  deck?: ConditionCard[];
  extraDeck?: ConditionCard[];
  banished?: ConditionCard[];
  fieldSpell?: ConditionCard | null;
}

/** Conditions inspect legacy replay/Chain data without extending card authoring. */
export interface ConditionActivationContext extends SelectionChannelSource {
  decisions?: AIDecisionPlan;
  context?: ConditionActivationContext | null;
  actionContext?: object | null;
  activationAttempt?: {
    card?: ConditionCard | null;
    controller?: ConditionPlayer | null;
    effect?: EffectDefinition | null;
  } | null;
  card?: ConditionCard | null;
  targetCard?: ConditionCard | null;
  sourceCard?: ConditionCard | null;
  player?: ConditionPlayer | null;
  triggerPlayer?: ConditionPlayer | null;
  effect?: EffectDefinition | null;
  respondingToChainLink?: ConditionActivationContext | null;
  preview?: boolean;
  autoSelectSingleTarget?: boolean;
  autoSelectTargets?: boolean;
}

export interface ConditionContext
  extends Omit<
    Partial<EffectContext>,
    | "player"
    | "opponent"
    | "activationContext"
    | "actionContext"
    | "_actionTargets"
    | "game"
  > {
  game?: ConditionGame | undefined;
  player?: (ConditionPlayer | null) | undefined;
  opponent?: (ConditionPlayer | null) | undefined;
  source?: ConditionCard | null;
  sourceCard?: ConditionCard | null;
  summonedCard?: ConditionCard | null;
  card?: ConditionCard | null;
  activatedCard?: ConditionCard | null;
  battleDestroyer?: ConditionCard | null;
  battleDestroyers?: ConditionCard[];
  eventPlayer?: ConditionPlayer | string | null;
  activationContext?: ConditionActivationContext | null;
  actionContext?: ConditionActivationContext | null;
  _actionTargets?: {
    [reference: string]: ConditionCard | ConditionCard[] | null | undefined;
  };
}

export interface ConditionFilter extends RuntimeCardFilter {
  min?: number;
  max?: number;
}

/** Closed read surface, with aliases accepted by the historical interpreter. */
export interface RuntimeCondition
  extends Omit<
    Partial<StructuredEffectCondition>,
    "type" | "conditions" | "filters" | "valueFromContext"
  > {
  type?: string;
  filters?: ConditionFilter;
  conditions?: readonly RuntimeCondition[];
  anyOf?: readonly RuntimeCondition[];
  valueFromContext?: string | { key?: string; path?: string };
  amount?: number;
  defaultValue?: number;
  defaultExpectedValue?: number;
  path?: string;
  monstersOnly?: boolean;
  cardId?: number;
  cardIds?: readonly number[];
  name?: string;
  eventCardRef?: string;
  cardOwner?: string;
  banishedCardFilters?: RuntimeCardFilter;
  banishedCardZones?: readonly string[];
  fromZones?: readonly string[];
  controllerId?: string;
  leftFilters?: RuntimeCardFilter;
  rightFilters?: RuntimeCardFilter;
  cardType?: string;
  monsterType?: string;
  isTuner?: boolean;
  position?: string;
  player?: string;
  turn?: string;
  level?: number;
  race?: string;
}

export interface ConditionScope
  extends Omit<RuntimeCardFilter, "owner" | "zone" | "zones" | "type"> {
  // targetRefMatchesFilters clears the condition discriminant before filtering.
  type?: RuntimeCardFilter["type"];
  filters?: RuntimeCardFilter;
  owner?: string;
  player?: string;
  zone?: string | readonly string[];
  zones?: readonly string[];
}

/** Only action capabilities read by activation-impact previews. */
export interface ConditionAction
  extends Omit<ConditionScope, "type">,
    Partial<Pick<ActionOf<"destroy">, "targetRef">> {
  type?: string;
  targetScope?: ConditionScope;
  entries?: readonly { targetRef?: string }[];
  destroyIfAtkZeroedByThisEffect?: boolean;
  atkChange?: number;
  to?: string;
  toZone?: string;
  destination?: string;
  cardType?: string;
  scope?: string;
  useDestroyed?: boolean;
  storeNegatedCardAs?: string;
  conditions?: readonly RuntimeCondition[];
}

export interface ConditionTemporaryEffect extends TemporaryEventEffect {
  sourceArchetype?: string;
  sourceArchetypes?: string[];
}

export interface ConditionSourceData
  extends Partial<Omit<ConditionCard, "archetypes">> {
  archetypes?: readonly string[];
}

/** Conditions report unknown types through the engine fault policy. */
export interface ConditionGame extends EngineFaultHost {
  player?: ConditionPlayer;
  bot?: ConditionPlayer;
  turnCounter: number;
  turn?: string;
  temporaryEventEffects?: unknown[];
  getOpponent?(
    player: ConditionPlayer | null | undefined,
  ): ConditionPlayer | null | undefined;
  getOwnerByCard?(card: ConditionCard): ConditionPlayer | null | undefined;
  effectEngine?: object;
  resolveCardData?(
    reference: number | string | undefined,
  ): ConditionSourceData | null | undefined;
}

export interface ConditionResult {
  ok: boolean;
  reason?: string;
  matches?: ConditionCard[];
}
export interface ConditionTargetResult {
  ok?: boolean | undefined;
  targets?: ResolvedTargetMap | undefined;
  selectionContract?:
    | {
        requirements?: readonly {
          id?: string;
          candidates?: readonly {
            cardRef?: ConditionCard | null;
            card?: SelectionCardReference | null;
          }[];
        }[];
      }
    | undefined;
}

export interface ConditionHost {
  game?: ConditionGame;
  cardMatchesFilters(card: FilterCard, filters: RuntimeCardFilter): boolean;
  isActiveEquipForCard(
    equip: FilterCard,
    card: FilterCard | null | undefined,
  ): boolean;
  getOwnerByCard(card: ConditionCard): ConditionPlayer | null | undefined;
  evaluateConditions(
    conditions: unknown,
    ctx: ConditionContext,
  ): ConditionResult;
  getBlueprintStorageState?(
    card: ConditionCard | null,
    create: boolean,
  ): { storedBlueprints?: readonly unknown[] } | null;
  resolveTargets: OmitThisParameter<typeof resolveTargets>;
}
