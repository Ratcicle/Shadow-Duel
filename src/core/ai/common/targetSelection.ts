import type { AiCardInput, AiPlayerInput } from "../../contracts/aiState.js";
import type { EffectTarget } from "../../contracts/effects.js";
import type { CanonicalZone } from "../../contracts/zones.js";
import { requiresUnnegatedTarget } from "../../effects/negation.js";
import { getPaidCostReferenceValues } from "../../effects/targeting/references.js";
import type { ChainCostPayment, PaidCostReferenceValues } from "../../contracts/chainRuntime.js";
import { hasActivePiercing } from "../../game/combat/availability.js";
import {
  getBattleStatForAttackTarget,
  getEffectiveAtk,
  getEffectiveDef,
  getPiercingDamage,
} from "./cardStats.js";
import { getCardComparableAttribute } from "../../Card.js";
import AutoSelector, { resolveExactInstanceSelection } from "../../AutoSelector.js";
import { getCounterValue } from "./counters.js";
import type { AIDecisionPlan } from "../../contracts/ai.js";
import { cardMatchesFilter } from "./cardFilters.js";
import {
  estimateCardValue,
  estimateCardCost,
  applyCardValuePreference,
  estimateMonsterValue,
  isBattleReadyAttacker,
} from "./cardValue.js";
import { getPerspectivePlayers } from "./perspective.js";
import { findCardOwner, findCardZone, getZoneCards } from "./zones.js";
import { isSimulatedReferencePresenceValid, type SimulatedReferenceSnapshot } from "./simulatedActions/shared.js";
import type { CardAction } from "../../contracts/actions.js";
import type {
  AiStateShape,
  SimulatedCardState,
  SimulatedPlayerState,
} from "../../contracts/aiState.js";
import type {
  EffectOwner,
  EffectZone,
} from "../../contracts/effects.js";
import type { CanonicalSelectionMap } from "../../contracts/selection.js";
import type { AiCardFilter, FilterableCard } from "./cardFilters.js";

type CardInstanceKey = number | string;
type TargetableCard = (FilterableCard | SimulatedCardState) & {
  uid?: CardInstanceKey | null;
};
type TargetIntent = "benefit" | "cost" | "harm" | "reference";
type TargetOwnerRole = "self" | "opponent";
type ComparisonOperator =
  | "eq"
  | "=="
  | "==="
  | "neq"
  | "!="
  | "!=="
  | "lte"
  | "<="
  | "lt"
  | "<"
  | "gte"
  | ">="
  | "gt"
  | ">";

interface NormalizedCount {
  min: number;
  max: number;
}

interface CountInput {
  min?: number;
  max?: number;
}

type TargetPreferenceMap = Partial<Record<string, TargetPreference>>;

interface ActionPreferenceContext {
  targetPreferences?: TargetPreferenceMap | null;
  costPreferences?: TargetPreference | null;
}

interface TargetSelectionOptions {
  /** Opt-in runtime optional-selection policy; absence preserves legacy planning refusal. */
  useRuntimeOptionalTargets?: boolean;
  costPayment?: ChainCostPayment;
  referenceSnapshots?: Record<string, SimulatedReferenceSnapshot[]>;
  targetPreferences?: TargetPreferenceMap | null;
  targetPreference?: TargetPreference | null;
  costPreferences?: TargetPreference | null;
  actionContext?: ActionPreferenceContext | null;
  activationContext?: {
    decisions?: AIDecisionPlan;
    actionContext?: ActionPreferenceContext | null;
    costPreferences?: TargetPreference | null;
  } | null;
  fieldSpell?: SimulatedCardState | null;
  preferDefense?: boolean;
  archetype?: string | null;
  opponentField?: readonly SimulatedCardState[];
  opponentLp?: number;
}

interface TargetPreference {
  intent?: TargetIntent;
  role?: "recursion" | "temporary_stat_buff" | "temporary_stat_debuff" | string;
  purpose?: "combat" | "defense" | "offense" | "pressure" | "stabilize" | "value" | string;
  forceNames?: readonly string[] | string;
  preferNames?: readonly string[] | string;
  preserveNames?: readonly string[] | string;
  preferredNames?: readonly string[] | string;
  avoidNames?: readonly string[] | string;
  preferredInstanceIds?: readonly CardInstanceKey[] | CardInstanceKey;
  avoidInstanceIds?: readonly CardInstanceKey[] | CardInstanceKey;
  defensiveNames?: readonly string[];
  offensiveNames?: readonly string[];
  attackers?: readonly SimulatedCardState[];
  atkBoost?: number;
  atkReduction?: number | null;
  defReduction?: number | null;
  destroyIfAtkZeroedByThisEffect?: boolean;
  destroyIfDefZeroedByThisEffect?: boolean;
}

interface AttributeComparison {
  attr?: string;
  attribute?: string;
  targetAttr?: string;
  pairedAttr?: string;
  refAttr?: string;
  sourceAttr?: string;
  ref?: string;
  op?: ComparisonOperator;
}

export function matchesTargetAttributeComparison(
  candidate: TargetableCard | null | undefined,
  reference: TargetableCard | null | undefined,
  comparison: AttributeComparison = {},
  paidValues?: readonly PaidCostReferenceValues[],
): boolean {
  if (!candidate) return false;
  const attr = comparison.attr || comparison.attribute;
  const candidateAttr =
    comparison.targetAttr || comparison.pairedAttr || attr;
  const referenceAttr =
    comparison.refAttr || comparison.sourceAttr || attr;
  if (!candidateAttr || !referenceAttr) return false;
  if (referenceAttr === "level" && paidValues !== undefined && paidValues.length === 0) return false;
  if (!reference && !(referenceAttr === "level" && paidValues !== undefined)) return false;
  const left = getCardComparableAttribute(candidate, candidateAttr);
  const right = referenceAttr === "level" && paidValues !== undefined
    ? paidValues[0]?.level : getCardComparableAttribute(reference!, referenceAttr);
  const op = comparison.op || "eq";
  if (op === "eq" || op === "==" || op === "===") return left === right;
  if (op === "neq" || op === "!=" || op === "!==") return left !== right;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return false;
  }
  if (op === "lte" || op === "<=") return leftNumber <= rightNumber;
  if (op === "lt" || op === "<") return leftNumber < rightNumber;
  if (op === "gte" || op === ">=") return leftNumber >= rightNumber;
  if (op === "gt" || op === ">") return leftNumber > rightNumber;
  return false;
}

type AiTargetFilter = Omit<
  AiCardFilter,
  "excludeCards" | "owner" | "zone" | "zones"
> & {
  id?: string;
  owner?: EffectOwner | "either";
  anyOf?: readonly AiTargetFilter[];
  targetFromContext?: string;
  requireThisCard?: boolean;
  excludeCannotBeSpecialSummoned?: boolean;
  excludeTargetRef?: string;
  excludeTargetRefs?: readonly string[];
  excludeNameRef?: string;
  countFromSelectionRef?: string;
  count?: unknown;
  intent?: TargetIntent;
  pairedTarget?: object | null;
  requiresPairedTarget?: object | null;
  compareAttribute?: AttributeComparison;
  excludeCards?: readonly TargetableCard[];
  zone?: EffectZone;
  zones?: readonly EffectZone[];
};

type AiPairedTarget = AiTargetFilter & {
  compareAttributes?: readonly AttributeComparison[] | AttributeComparison;
  excludeSameName?: boolean;
};

interface ActionIntentView {
  type?: string;
  targetRef?: string;
  to?: string;
  player?: string;
  atkFactor?: number;
  defFactor?: number;
  atkChange?: number;
  defChange?: number;
}

interface RankCandidateOptions extends TargetSelectionOptions {
  targetPreference?: TargetPreference | null;
}

interface OffensiveTemporaryBuffOptions {
  atkBoost?: number | undefined;
  opponentField?: readonly SimulatedCardState[] | undefined;
  opponentLp?: number | undefined;
}

interface TemporaryCombatDebuffOptions {
  attackers?: readonly SimulatedCardState[];
  opponentLp?: number;
  atkReduction?: number | null | undefined;
  defReduction?: number | null | undefined;
  destroyIfAtkZeroedByThisEffect?: boolean | undefined;
  destroyIfDefZeroedByThisEffect?: boolean | undefined;
}

interface RecursionPreference {
  purpose?: string;
  defensiveNames?: readonly string[];
  offensiveNames?: readonly string[];
}

interface SelectSimulatedTargetsInput {
  effect?: import("../../contracts/effects.js").EffectDefinition | undefined;
  targets: readonly AiTargetFilter[] | null | undefined;
  actions?: readonly (CardAction & ActionIntentView)[] | null | undefined;
  state: Pick<AiStateShape, "bot" | "player" | "_simUnsupportedActions">;
  sourceCard?: SimulatedCardState | null | undefined;
  selfId?: string;
  options?: TargetSelectionOptions;
  selections?: CanonicalSelectionMap;
}

export function asArray<Value>(
  value: Value | readonly Value[] | null | undefined,
): readonly Value[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value as readonly Value[] : [value as Value];
}

export function normalizeCount(count: unknown, fallback = 1): NormalizedCount {
  if (Number.isFinite(count as number)) {
    return { min: count as number, max: count as number };
  }
  const min = Number.isFinite((count as CountInput | null | undefined)?.min)
    ? (count as CountInput).min!
    : fallback;
  const max = Number.isFinite((count as CountInput | null | undefined)?.max)
    ? (count as CountInput).max!
    : min;
  return { min, max };
}

export function getCardInstanceId(
  card: TargetableCard | null | undefined,
): CardInstanceKey | null {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uid ??
    card?.uuid ??
    card?.simInstanceId ??
    null
  ) as CardInstanceKey | null;
}

export function getTargetPreference(
  options: TargetSelectionOptions = {},
  targetId: string | null | undefined = null,
): TargetPreference | null {
  const byTarget =
    options.targetPreferences ||
    options.activationContext?.actionContext?.targetPreferences ||
    options.actionContext?.targetPreferences ||
    {};
  return (
    (targetId && byTarget?.[targetId]) ||
    options.targetPreference ||
    null
  );
}

export function getCostPreference(
  options: TargetSelectionOptions = {},
): TargetPreference | null {
  return (
    options.costPreferences ||
    options.actionContext?.costPreferences ||
    options.activationContext?.actionContext?.costPreferences ||
    options.activationContext?.costPreferences ||
    null
  );
}

export function mergeCostPreference(
  targetPreference: TargetPreference | null | undefined,
  costPreference: TargetPreference | null | undefined,
): TargetPreference | null {
  if (!costPreference) return targetPreference || null;
  return {
    ...costPreference,
    ...(targetPreference || {}),
    preferNames: [
      ...asArray(costPreference.preferNames),
      ...asArray(targetPreference?.preferNames),
    ],
    forceNames: [
      ...asArray(costPreference.forceNames),
      ...asArray(targetPreference?.forceNames),
    ],
    preserveNames: [
      ...asArray(costPreference.preserveNames),
      ...asArray(targetPreference?.preserveNames),
    ],
  };
}

function applyNameAndInstancePreference(
  score: number,
  card: SimulatedCardState | null | undefined,
  preference: TargetPreference | null | undefined,
  intent: TargetIntent,
): number {
  return applyCardValuePreference(score, card, preference, intent);
}

export function buildActionFilter<Action extends object>(
  action: Action = {} as Action,
): AiCardFilter {
  const filter: AiCardFilter = { ...((action as Partial<AiCardFilter> & { filters?: AiCardFilter }).filters || {}) };
  ([
    "cardKind",
    "cardName",
    "name",
    "cardId",
    "cardIds",
    "subtype",
    "monsterType",
    "archetype",
    "archetypes",
    "requireFaceup",
    "excludeCardName",
    "excludeCardNames",
    "excludeInstanceId",
    "excludeInstanceIds",
    "excludeCardInstanceIds",
    "excludeCards",
    "minLevel",
    "maxLevel",
    "level",
    "levelOp",
    "minAtk",
    "maxAtk",
    "minDef",
    "maxDef",
    "position",
    "isTuner",
    "isToken",
    "lastSummonMethods",
    "summonMethods",
    "lastSummonMethod",
    "summonMethod",
    "lastSummonedFromZone",
    "lastSummonedFromZones",
    "sentToGraveAsMaterial",
    "sentAsMaterial",
    "lastSentToGraveAsMaterial",
    "sentToGraveAsMaterialThisTurn",
    "sentAsMaterialThisTurn",
    "sentToGraveAsMaterialTurn",
    "sentAsMaterialTurn",
  ] as const).forEach((key) => {
    if (
      (action as Partial<Record<keyof AiCardFilter, unknown>>)[key] !== undefined &&
      filter[key] === undefined
    ) {
      (filter as Partial<Record<keyof AiCardFilter, unknown>>)[key] =
        (action as Partial<Record<keyof AiCardFilter, unknown>>)[key];
    }
  });
  return filter;
}

export function matchesTargetFilters<Target extends object>(
  card: TargetableCard | null | undefined,
  target: Target = {} as Target,
  sourceCard?: TargetableCard | null,
  ownerRole: TargetOwnerRole | null = null,
): boolean {
  if (!card) return false;
  if (
    (target as AiTargetFilter).excludeCannotBeSpecialSummoned === true &&
    card.cannotBeSpecialSummoned === true
  ) {
    return false;
  }
  if (
    Array.isArray((target as AiTargetFilter).anyOf) &&
    (target as AiTargetFilter).anyOf!.length > 0
  ) {
    return (target as AiTargetFilter).anyOf!.some((entry) =>
      matchesTargetFilters(
        card,
        { ...target, ...entry, anyOf: undefined },
        sourceCard,
        ownerRole,
      )
    );
  }
  if (
    (target as AiTargetFilter).owner &&
    (target as AiTargetFilter).owner !== "any" &&
    ownerRole &&
    (target as AiTargetFilter).owner !== ownerRole
  ) {
    return false;
  }
  if (
    sourceCard &&
    ((target as AiTargetFilter).requireThisCard ||
      (target as AiTargetFilter).excludeSelf)
  ) {
    const sourceInstanceId = getCardInstanceId(sourceCard);
    const cardInstanceId = getCardInstanceId(card);
    const sameCard =
      card === sourceCard ||
      (sourceInstanceId !== null &&
        cardInstanceId !== null &&
        sourceInstanceId === cardInstanceId);
    if ((target as AiTargetFilter).requireThisCard && !sameCard) {
      return false;
    }
    if ((target as AiTargetFilter).excludeSelf && sameCard) {
      return false;
    }
  }
  const {
    owner: _owner,
    anyOf: _anyOf,
    id: _targetId,
    targetFromContext: _targetFromContext,
    ...filters
  } = target as AiTargetFilter;
  return cardMatchesFilter(card as FilterableCard, filters as AiCardFilter);
}

function inferTargetIntent(action: ActionIntentView | null | undefined): TargetIntent {
  if (!action || !action.type) return "benefit";
  const type = action.type;
  if (type === "destroy") return "harm";
  if (type === "banish") return "harm";
  if (type === "move" && action.to === "graveyard") return "cost";
  if (type === "discard_from_hand") return "cost";
  if (type === "damage" && action.player === "self") return "cost";
  if (type === "buff_stats_temp") return "benefit";
  if (type === "equip") return "benefit";
  if (type === "add_status") return "benefit";
  if (type === "modify_stats_temp") {
    const atkFactor = Number.isFinite(action.atkFactor) ? action.atkFactor! : 1;
    const defFactor = Number.isFinite(action.defFactor) ? action.defFactor! : 1;
    return atkFactor < 1 || defFactor < 1 ? "harm" : "benefit";
  }
  if (type === "modify_stats_temp_then_destroy_if_zeroed") {
    const atkChange = Number.isFinite(action.atkChange) ? action.atkChange! : 0;
    const defChange = Number.isFinite(action.defChange) ? action.defChange! : 0;
    return atkChange < 0 || defChange < 0 ? "harm" : "benefit";
  }
  if (type.startsWith("special_summon")) return "benefit";
  if (type === "add_from_zone_to_hand") return "benefit";
  if (type === "search_any") return "benefit";
  return "benefit";
}

function buildTargetIntents(
  actions: readonly (CardAction & ActionIntentView)[] | null | undefined,
): Map<string, TargetIntent> {
  const intents = new Map<string, TargetIntent>();
  (actions || []).forEach((action) => {
    if (!action || !action.targetRef) return;
    if (intents.has(action.targetRef)) return;
    intents.set(action.targetRef, inferTargetIntent(action));
  });
  return intents;
}

export function rankCandidates(
  candidates: readonly SimulatedCardState[],
  intent: TargetIntent,
  options: RankCandidateOptions = {},
): SimulatedCardState[] {
  const targetPreference = options.targetPreference || null;
  const scored = candidates.map((card) => ({
    card,
    score: intent === "cost" ? estimateCardCost(card, { ...options, preference: targetPreference }) : applyNameAndInstancePreference(
      intent === "benefit" && targetPreference?.role === "recursion"
        ? estimateRecursionTargetValue(card, targetPreference)
        : intent === "benefit" &&
            targetPreference?.role === "temporary_stat_buff" &&
            targetPreference?.purpose === "offense"
          ? estimateOffensiveTemporaryBuffValue(card, {
              atkBoost: targetPreference.atkBoost,
              opponentField: options.opponentField,
              opponentLp: options.opponentLp,
            })
          : intent === "harm" &&
            targetPreference?.role === "temporary_stat_debuff" &&
            targetPreference?.purpose === "combat"
          ? estimateTemporaryCombatDebuffTargetValue(card, {
              attackers: targetPreference.attackers || [],
              opponentLp: options.opponentLp || 0,
              atkReduction: targetPreference.atkReduction,
              defReduction: targetPreference.defReduction,
              destroyIfAtkZeroedByThisEffect:
                targetPreference.destroyIfAtkZeroedByThisEffect,
              destroyIfDefZeroedByThisEffect:
                targetPreference.destroyIfDefZeroedByThisEffect,
            })
        : estimateCardValue(card, options),
      card,
      targetPreference,
      intent,
    ),
  }));
  scored.sort((a, b) => {
    return intent === "cost" ? a.score - b.score : b.score - a.score;
  });
  return scored.map((entry) => entry.card);
}

export function estimateRecursionTargetValue(
  card: SimulatedCardState | null | undefined,
  preference: RecursionPreference = {},
): number {
  if (!card || card.cardKind !== "monster") return -100;
  const atk = getEffectiveAtk(card);
  const def = getEffectiveDef(card);
  const purpose = preference.purpose || "value";
  const defensiveNames = preference.defensiveNames || [];
  const offensiveNames = preference.offensiveNames || [];
  let score = (card.level || 0) * 0.2 + Math.max(atk, def) / 1000;

  if (purpose === "stabilize" || purpose === "defense") {
    score += def / 450;
    if (def >= atk + 500 || card.mustBeAttacked) score += 2;
    if (defensiveNames.includes(card.name as string)) score += 3;
    if (offensiveNames.includes(card.name as string) && def < 2000) score -= 1;
  } else if (purpose === "pressure" || purpose === "offense") {
    score += atk / 450;
    if (atk >= 2000 || hasActivePiercing(card)) score += 2;
    if (offensiveNames.includes(card.name as string)) score += 2;
    if (defensiveNames.includes(card.name as string) && atk < 1800) score -= 3;
  } else {
    if (defensiveNames.includes(card.name as string)) score += 0.8;
    if (offensiveNames.includes(card.name as string)) score += 0.8;
  }

  return score;
}

export function estimateOffensiveTemporaryBuffValue(
  card: SimulatedCardState | null | undefined,
  { atkBoost = 0, opponentField = [], opponentLp = 0 }: OffensiveTemporaryBuffOptions = {},
): number {
  if (!card || card.cardKind !== "monster") return -100;
  if (atkBoost <= 0) return -100;
  if (card.position !== "attack") return -80 + getEffectiveAtk(card) / 10000;
  if (card.cannotAttackThisTurn || card.hasAttacked) {
    return -40 + getEffectiveAtk(card) / 10000;
  }

  const opponents = (opponentField || []).filter(
    (monster) => monster && monster.cardKind === "monster"
  );
  const atk = getEffectiveAtk(card);
  const buffedAtk = atk + atkBoost;
  if (opponents.length === 0) {
    if (opponentLp > 0 && atk < opponentLp && buffedAtk >= opponentLp) {
      return 120;
    }
    return opponentLp > 0 && opponentLp <= 2500 ? 12 : 0;
  }

  let bestScore = 0;
  opponents.forEach((opposing) => {
    const opposingStat = getBattleStatForAttackTarget(opposing);
    if (atk <= opposingStat && buffedAtk > opposingStat) {
      bestScore = Math.max(bestScore, 80 + opposingStat / 100);
    } else if (atk > opposingStat) {
      bestScore = Math.max(bestScore, 10 + opposingStat / 250);
    }
  });
  return bestScore;
}

export function estimateTemporaryCombatDebuffTargetValue(
  target: SimulatedCardState | null | undefined,
  {
    attackers = [],
    opponentLp = 0,
    atkReduction = null,
    defReduction = null,
    destroyIfAtkZeroedByThisEffect = false,
    destroyIfDefZeroedByThisEffect = false,
  }: TemporaryCombatDebuffOptions = {},
): number {
  if (!target || target.cardKind !== "monster" || target.isFacedown) return 0;
  const readyAttackers = (attackers || []).filter((card) =>
    isBattleReadyAttacker(card)
  );
  const targetAtk = getEffectiveAtk(target);
  const targetDef = getEffectiveDef(target);
  const atkDropsToZero =
    destroyIfAtkZeroedByThisEffect === true &&
    Number.isFinite(atkReduction) &&
    targetAtk > 0 &&
    Math.max(0, targetAtk - atkReduction!) === 0;
  const defDropsToZero =
    destroyIfDefZeroedByThisEffect === true &&
    Number.isFinite(defReduction) &&
    targetDef > 0 &&
    Math.max(0, targetDef - defReduction!) === 0;

  if (atkDropsToZero || defDropsToZero) {
    return 100 + estimateMonsterValue(target);
  }
  if (readyAttackers.length === 0) return 0;

  const currentStat = getBattleStatForAttackTarget(target);
  let debuffedStat = 0;
  if (Number.isFinite(atkReduction) || Number.isFinite(defReduction)) {
    const reduction =
      target.position === "defense"
        ? Number.isFinite(defReduction)
          ? defReduction!
          : 0
        : Number.isFinite(atkReduction)
          ? atkReduction!
          : 0;
    debuffedStat = Math.max(0, currentStat - reduction);
  }
  let bestScore = 0;
  let totalDamageGain = 0;
  let totalDamageAfter = 0;

  readyAttackers.forEach((attacker) => {
    const atk = getEffectiveAtk(attacker);
    const canDestroyBefore = atk > currentStat;
    const canDestroyAfter = atk > debuffedStat;
    const damageBefore =
      target.position === "attack" && atk > currentStat
        ? atk - currentStat
        : target.position === "defense"
          ? getPiercingDamage(attacker, atk, currentStat)
          : 0;
    const damageAfter =
      target.position === "attack" && atk > debuffedStat
        ? atk - debuffedStat
        : target.position === "defense"
          ? getPiercingDamage(attacker, atk, debuffedStat)
          : 0;

    totalDamageGain += Math.max(0, damageAfter - damageBefore);
    totalDamageAfter = Math.max(totalDamageAfter, damageAfter);

    if (!canDestroyBefore && canDestroyAfter) {
      bestScore = Math.max(bestScore, 80 + currentStat / 100);
    } else if (canDestroyAfter && damageAfter >= 1000) {
      bestScore = Math.max(bestScore, 18 + damageAfter / 200);
    }
  });

  if (opponentLp > 0 && totalDamageAfter >= opponentLp) {
    bestScore = Math.max(bestScore, 120);
  }
  if (totalDamageGain >= 1000) {
    bestScore = Math.max(bestScore, 20 + totalDamageGain / 250);
  }

  return bestScore;
}

/** Public scoring view only; optionality is decided by the real AutoSelector. */
function selectRuntimeOptionalCount(
  target: EffectTarget, ordered: SimulatedCardState[], count: NormalizedCount,
  self: SimulatedPlayerState, opponent: SimulatedPlayerState, intent: TargetIntent,
): number {
  const scoringCard = (card: SimulatedCardState) => ({
    name: card.name || "", ...(card.id === undefined ? {} : { id: card.id }),
    ...(card.cardKind == null ? {} : { cardKind: card.cardKind }),
    ...(card.controller == null ? {} : { controller: card.controller }),
    ...(card.owner == null ? {} : { owner: card.owner }),
    ...(card.position == null ? {} : { position: card.position }),
    ...(card.isFacedown === undefined ? {} : { isFacedown: card.isFacedown }),
    ...(card.atk == null ? {} : { atk: card.atk }), ...(card.def == null ? {} : { def: card.def }),
    ...(card.level == null ? {} : { level: card.level }),
    ...(card.archetype == null ? {} : { archetype: card.archetype }),
    ...(card.archetypes ? { archetypes: [...card.archetypes] } : {}),
    ...(typeof card.instanceId === "number" ? { instanceId: card.instanceId } : {}),
  });
  const scoringOwner = (owner: SimulatedPlayerState) => ({ id: owner.id, lp: owner.lp,
    field: owner.field.map(scoringCard), hand: owner.hand.map(scoringCard), deck: owner.deck.map(scoringCard) });
  const actor = scoringOwner(self), other = scoringOwner(opponent);
  const selector = new AutoSelector({ bot: actor, player: other,
    getOpponent: owner => owner.id === actor.id ? other : actor });
  const candidates = ordered.map(card => ({ ...scoringCard(card), controller: card.controller || self.id }));
  const selectionIntent = intent === "reference" ? "benefit" : intent;
  return selector.getDesiredCount({ id: target.id, intent: selectionIntent }, candidates, count,
    { owner: actor });
}

export function selectSimulatedTargets({
  effect,
  targets,
  actions,
  state,
  sourceCard,
  selfId = "bot",
  options = {},
  selections = {},
}: SelectSimulatedTargetsInput): CanonicalSelectionMap {
  const result: CanonicalSelectionMap = { ...selections };
  if (!Array.isArray(targets) || targets.length === 0) return result;
  const { self, opponent } = getPerspectivePlayers(state, selfId);
  const intents = buildTargetIntents(actions || []);
  const exactSelection = (id: string, candidates: readonly SimulatedCardState[], count: NormalizedCount) => {
    const ids = options.activationContext?.decisions?.selections?.[id];
    if (ids === undefined) return undefined;
    const selected = resolveExactInstanceSelection(candidates, ids, count);
    if (selected === null) (state._simUnsupportedActions ??= []).push(`exact_selection:${id}`);
    return selected || [];
  };
  const hasPairedCandidate = (
    sourceCandidate: SimulatedCardState,
    pairSpec: AiPairedTarget | null | undefined,
  ): boolean => {
    if (!pairSpec) return true;
    const ownerEntries: readonly {
      player: SimulatedPlayerState;
      role: TargetOwnerRole;
    }[] =
      pairSpec.owner === "opponent"
        ? [{ player: opponent, role: "opponent" }]
        : pairSpec.owner === "any"
          ? [
              { player: self, role: "self" },
              { player: opponent, role: "opponent" },
            ]
          : [{ player: self, role: "self" }];
    const zones: readonly EffectZone[] = asArray(pairSpec.zones || pairSpec.zone || "field");
    const comparisons: readonly AttributeComparison[] = [
      ...asArray(pairSpec.compareAttribute),
      ...asArray(pairSpec.compareAttributes),
    ];
    return ownerEntries.some(({ player: owner, role }) =>
      zones.some((zone) =>
        getZoneCards(owner, zone).some((candidate) => {
          if (!candidate || candidate === sourceCandidate) return false;
          if (
            pairSpec.excludeSameName === true &&
            candidate.name === sourceCandidate.name
          ) {
            return false;
          }
          if (
            !matchesTargetFilters(
              candidate,
              pairSpec,
              sourceCandidate,
              role,
            )
          ) {
            return false;
          }
          return comparisons.every((comparison) =>
            matchesTargetAttributeComparison(candidate, sourceCandidate, comparison),
          );
        }),
      ),
    );
  };

  targets.forEach((target) => {
    if (!target || !target.id) return;
    const requireUnnegated = requiresUnnegatedTarget(effect, target);
    const negationEligible = (card: SimulatedCardState) => !requireUnnegated || card.cardKind !== "monster" || card.effectsNegated !== true;
    if (target.targetFromContext) {
      const contextValue =
        target.intent === "reference" && options.referenceSnapshots !== undefined
        ? (options.referenceSnapshots[target.id] || []).filter(isSimulatedReferencePresenceValid).map(snapshot => snapshot.card)
        :
        (options as Partial<Record<string, unknown>> | null)?.[target.targetFromContext] ||
        (options?.actionContext as Partial<Record<string, unknown>> | null | undefined)?.[
          target.targetFromContext
        ] ||
        (options?.activationContext?.actionContext as Partial<Record<string, unknown>> | null | undefined)?.[
          target.targetFromContext
        ] ||
        null;
      const requiredZones: readonly EffectZone[] = Array.isArray(target.zones)
        ? target.zones
        : target.zone
          ? [target.zone]
          : [];
      const contextCards = (
        asArray(contextValue) as readonly SimulatedCardState[]
      ).filter((card) => {
        const owner = findCardOwner(state, card);
        const ownerRole: TargetOwnerRole | null =
          owner === self ? "self" : owner === opponent ? "opponent" : null;
        const zone = owner ? findCardZone(owner, card) : null;
        return (
          negationEligible(card) && matchesTargetFilters(card, target, sourceCard, ownerRole) &&
          (requiredZones.length === 0 ||
            requiredZones.includes("any") ||
            requiredZones.includes(zone!))
        );
      });
      const count = normalizeCount(target.count, 1);
      result[target.id] = exactSelection(target.id, contextCards, count) ?? contextCards.slice(
        0,
        Math.min(count.max, contextCards.length),
      );
      return;
    }
    const excludeTargetRefs = [
      target.excludeTargetRef,
      ...asArray(target.excludeTargetRefs),
    ].filter(Boolean) as string[];
    const excludedCards = excludeTargetRefs.flatMap((ref) =>
      Array.isArray(result[ref])
        ? result[ref] as SimulatedCardState[]
        : result[ref]
          ? [result[ref] as SimulatedCardState]
          : [],
    );
    const excludedInstanceIds = excludedCards
      .map(getCardInstanceId)
      .filter((value) => value !== undefined && value !== null);
    let effectiveTarget: AiTargetFilter =
      excludedCards.length > 0
        ? {
            ...target,
            excludeCards: [
              ...asArray(target.excludeCards),
              ...excludedCards,
            ],
            excludeInstanceIds: [
              ...asArray(target.excludeInstanceIds),
              ...excludedInstanceIds,
            ],
          }
        : target;
    const excludedNameCards = asArray(result[target.excludeNameRef!]) as readonly SimulatedCardState[];
    const paidNameValues = getPaidCostReferenceValues(options.costPayment, target.excludeNameRef);
    const excludedNames = (paidNameValues ?? excludedNameCards)
      .map((card) => card?.name)
      .filter(Boolean) as string[];
    if (excludedNames.length > 0) {
      effectiveTarget = {
        ...effectiveTarget,
        excludeCardNames: [
          ...asArray(effectiveTarget.excludeCardNames),
          ...excludedNames,
        ],
      };
    }
    const ownerEntries: readonly {
      player: SimulatedPlayerState;
      role: TargetOwnerRole;
    }[] =
      effectiveTarget.owner === "opponent"
        ? [{ player: opponent, role: "opponent" }]
        : effectiveTarget.owner === "any"
          ? [
              { player: self, role: "self" },
              { player: opponent, role: "opponent" },
            ]
          : [{ player: self, role: "self" }];
    const zones =
      effectiveTarget.zones ||
      (effectiveTarget.zone ? [effectiveTarget.zone] : []);
    let candidates: Array<{
      card: SimulatedCardState;
      role: TargetOwnerRole;
    }> = [];
    ownerEntries.forEach(({ player: owner, role }) => {
      zones.forEach((zone) => {
        candidates = candidates.concat(
          getZoneCards(owner, zone).map((card) => ({ card, role })),
        );
      });
    });
    const filtered = candidates
      .filter(({ card, role }) => {
        if (!negationEligible(card) || !matchesTargetFilters(card, effectiveTarget, sourceCard, role)) {
          return false;
        }
        if (
          !hasPairedCandidate(
            card,
            effectiveTarget.pairedTarget ||
              effectiveTarget.requiresPairedTarget,
          )
        ) {
          return false;
        }
        const comparison = effectiveTarget.compareAttribute;
        if (comparison?.ref) {
          const reference = asArray(result[comparison.ref])[0] as SimulatedCardState;
          if (!matchesTargetAttributeComparison(card, reference, comparison,
            getPaidCostReferenceValues(options.costPayment, comparison.ref))) return false;
        }
        return true;
      })
      .map(({ card }) => card);

    const explicitTargetPreference = getTargetPreference(options, target.id);
    const intent =
      explicitTargetPreference?.intent ||
      target.intent ||
      intents.get(target.id) ||
      "benefit";
    const targetPreference =
      intent === "cost"
        ? mergeCostPreference(
            explicitTargetPreference,
            getCostPreference(options),
          )
        : explicitTargetPreference;
    const ordered = rankCandidates(filtered, intent, {
      ...options,
      fieldSpell: self.fieldSpell,
      targetPreference,
    });

    const referencedSelection =
      typeof target.countFromSelectionRef === "string"
        ? result[target.countFromSelectionRef]
        : null;
    const count = Array.isArray(referencedSelection)
      ? {
          min: referencedSelection.length,
          max: referencedSelection.length,
        }
      : normalizeCount(target.count, 1);
    const min = count.min;
    const max = count.max;
    let pickCount = intent === "cost" ? min : max;
    if (options.useRuntimeOptionalTargets && intent !== "cost") {
      pickCount = selectRuntimeOptionalCount(target, ordered, count, self, opponent, intent);
    } else if (min === 0 && intent !== "cost") {
      pickCount = 0;
    }
    const exact = exactSelection(target.id, filtered, count);
    const pooledCost = intent === "cost" ? effect?.activationCosts?.find(action =>
      action.type === "remove_counters_from_field" && action.targetRef === target.id) : undefined;
    if (exact === undefined && pooledCost?.type === "remove_counters_from_field") {
      let total = 0;
      pickCount = 0;
      while (pickCount < Math.min(max, ordered.length) && total < (pooledCost.amount ?? 1)) {
        const card = ordered[pickCount];
        if (!card) break;
        total += getCounterValue(card, pooledCost.counterType || "default");
        pickCount++;
      }
    }
    result[target.id] = exact ?? ordered.slice(0, Math.min(pickCount, ordered.length));
  });

  return result;
}

function zoneCards(player: AiPlayerInput | undefined, zone: CanonicalZone): readonly AiCardInput[] {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return player[zone] || [];
}

/** Ordered exact-instance candidates for policies compiling decision plans. */
export function collectExactTargetCandidates(target: EffectTarget, source: AiCardInput, ctx: { player: AiPlayerInput; opponent?: AiPlayerInput },
  selections: Readonly<Record<string, readonly (number | string)[]>>): AiCardInput[] {
  const allZones: readonly CanonicalZone[] = ["field", "hand", "deck", "graveyard", "banished", "extraDeck", "spellTrap", "fieldSpell"];
  const fromZones = (spec: { owner?: EffectOwner; zone?: EffectZone; zones?: readonly EffectZone[] }) => {
    const roles = spec.owner === "opponent" ? ["opponent"] as const :
      spec.owner === "any" ? ["self", "opponent"] as const : ["self"] as const;
    const zones = (spec.zones || [spec.zone || "field"]).flatMap<CanonicalZone>(zone =>
      zone === "any" ? allZones : [zone === "removed" ? "banished" : zone]);
    return roles.flatMap(role => zones.flatMap(zone =>
      zoneCards(role === "self" ? ctx.player : ctx.opponent, zone).map(card => ({ card, role }))));
  };
  const references = (ref: string | undefined): AiCardInput[] => {
    if (!ref) return [];
    const ids = selections[ref] || [];
    return fromZones({ owner: "any", zones: allZones })
      .map(entry => entry.card).filter(card => card.instanceId != null && ids.includes(card.instanceId));
  };
  const excluded = target.excludeTargetRef ? selections[target.excludeTargetRef] || [] : [];
  const excludedNames = references(target.excludeNameRef).map(card => card.name);
  const pair = target.pairedTarget;
  const result: AiCardInput[] = [];
  for (const { card, role } of fromZones(target)) {
    if (card.instanceId == null || excluded.includes(card.instanceId) || result.some(other => card.instanceId === other.instanceId)) continue;
    if (excludedNames.includes(card.name) || !matchesTargetFilters(card, target, source, role)) continue;
    if (target.compareAttribute && !matchesTargetAttributeComparison(card, references(target.compareAttribute.ref)[0], target.compareAttribute)) continue;
    if (pair && !fromZones(pair).some(({ card: paired, role: pairedRole }) =>
      card.instanceId !== paired.instanceId && !(pair.excludeSameName && paired.name === card.name) &&
      matchesTargetFilters(paired, pair, card, pairedRole) &&
      (!pair.compareAttribute || matchesTargetAttributeComparison(paired, card, pair.compareAttribute)))) continue;
    result.push(card);
  }
  return result;
}
