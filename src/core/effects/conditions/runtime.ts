import type {
  ActionRuntimeCard,
  EffectContext,
  ResolvedTargetMap,
} from "../../contracts/actionRuntime.js";
import type { CardEffectMarkerMap } from "../../contracts/cards.js";
import type { ActionOf } from "../../contracts/actions.js";
import type {
  EffectDefinition,
  StructuredEffectCondition,
} from "../../contracts/effects.js";
import type {
  SelectionCardReference,
  SelectionChannelSource,
} from "../../contracts/selection.js";
import type { FilterCard, RuntimeCardFilter } from "../filters/cardFilters.js";
import type { TemporaryEventEffect } from "../triggers/runtime.js";
import type { resolveTargets } from "../targeting/resolution.js";

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
  context?: ConditionActivationContext | null;
  actionContext?: object | null;
  activationAttempt?: {
    card?: ConditionCard | null;
    controller?: ConditionPlayer | null;
    effect?: EffectDefinition | null;
  } | null;
  card?: ConditionCard | null;
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
}

export interface ConditionTemporaryEffect extends TemporaryEventEffect {
  sourceArchetype?: string;
  sourceArchetypes?: string[];
}

export interface ConditionSourceData
  extends Partial<Omit<ConditionCard, "archetypes">> {
  archetypes?: readonly string[];
}

export interface ConditionGame {
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
