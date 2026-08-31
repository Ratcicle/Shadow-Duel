import {
  getBattleStatForAttackTarget,
  getEffectiveAtk,
  getEffectiveDef,
  getPiercingDamage,
} from "./cardStats.js";
import { getCardComparableAttribute } from "../../Card.js";
import { cardMatchesFilter } from "./cardFilters.js";
import {
  estimateCardValue,
  estimateMonsterValue,
  isBattleReadyAttacker,
} from "./cardValue.js";
import { getPerspectivePlayers } from "./perspective.js";
import { findCardOwner, findCardZone, getZoneCards } from "./zones.js";
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
type TargetableCard = FilterableCard | SimulatedCardState;
type TargetIntent = "benefit" | "cost" | "harm";
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

interface ActionPreferenceContext {
  targetPreferences?: object | null;
  costPreferences?: TargetPreference | null;
}

interface TargetSelectionOptions {
  targetPreferences?: object | null;
  targetPreference?: TargetPreference | null;
  costPreferences?: TargetPreference | null;
  actionContext?: ActionPreferenceContext | null;
  activationContext?: {
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

type AiTargetFilter = Omit<
  AiCardFilter,
  "excludeCards" | "owner" | "zone" | "zones"
> & {
  id?: string;
  owner?: EffectOwner | "either";
  anyOf?: readonly object[];
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
  atkBoost?: number;
  opponentField?: readonly SimulatedCardState[];
  opponentLp?: number;
}

interface TemporaryCombatDebuffOptions {
  attackers?: readonly SimulatedCardState[];
  opponentLp?: number;
  atkReduction?: number | null;
  defReduction?: number | null;
  destroyIfAtkZeroedByThisEffect?: boolean;
  destroyIfDefZeroedByThisEffect?: boolean;
}

interface RecursionPreference {
  purpose?: string;
  defensiveNames?: readonly string[];
  offensiveNames?: readonly string[];
}

interface SelectSimulatedTargetsInput {
  targets: readonly object[] | null | undefined;
  actions?: readonly CardAction[] | null;
  state: Pick<AiStateShape, "bot" | "player">;
  sourceCard?: SimulatedCardState | null;
  selfId?: string;
  options?: object;
}

const ACTION_FILTER_KEYS = [
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
] as const;

function isObjectValue(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

function readProperty(value: object | null | undefined, key: PropertyKey): unknown {
  return value ? Reflect.get(value, key) : undefined;
}

function readObjectProperty(
  value: object | null | undefined,
  key: PropertyKey,
): object | null {
  const property = readProperty(value, key);
  return isObjectValue(property) ? property : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readSelectedValue(selections: object, reference: unknown): unknown {
  return typeof reference === "string"
    ? Reflect.get(selections, reference)
    : undefined;
}

function selectionValueAsCards(value: unknown): SimulatedCardState[] {
  if (Array.isArray(value)) return value as SimulatedCardState[];
  return value ? [value as SimulatedCardState] : [];
}

export function asArray<Value>(
  value: Value | readonly Value[] | null | undefined,
): readonly Value[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value as readonly Value[] : [value as Value];
}

export function normalizeCount(count: unknown, fallback = 1): NormalizedCount {
  if (isFiniteNumber(count)) {
    return { min: count, max: count };
  }
  const minValue = isObjectValue(count) ? readProperty(count, "min") : undefined;
  const maxValue = isObjectValue(count) ? readProperty(count, "max") : undefined;
  const min = isFiniteNumber(minValue) ? minValue : fallback;
  const max = isFiniteNumber(maxValue) ? maxValue : min;
  return { min, max };
}

export function getCardInstanceId(
  card: TargetableCard | null | undefined,
): CardInstanceKey | null {
  return (
    card?.instanceId ??
    card?._instanceId ??
    readProperty(card, "uid") ??
    card?.uuid ??
    card?.simInstanceId ??
    null
  ) as CardInstanceKey | null;
}

export function getTargetPreference(
  options: object = {},
  targetId: string | null | undefined = null,
): TargetPreference | null {
  const typedOptions = options as TargetSelectionOptions;
  const byTarget =
    typedOptions.targetPreferences ||
    typedOptions.activationContext?.actionContext?.targetPreferences ||
    typedOptions.actionContext?.targetPreferences ||
    {};
  return (
    (targetId && readProperty(byTarget, targetId)) ||
    typedOptions.targetPreference ||
    null
  ) as TargetPreference | null;
}

export function getCostPreference(options: object = {}): TargetPreference | null {
  const typedOptions = options as TargetSelectionOptions;
  return (
    typedOptions.costPreferences ||
    typedOptions.actionContext?.costPreferences ||
    typedOptions.activationContext?.actionContext?.costPreferences ||
    typedOptions.activationContext?.costPreferences ||
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
  if (!preference || !card) return score;
  let adjusted = score;
  const name = card.name as string;
  const instanceId = getCardInstanceId(card);
  const forced = asArray(preference.forceNames).includes(name);
  const preferredByPolicy = asArray(preference.preferNames).includes(name);
  const preserved = asArray(preference.preserveNames).includes(name);
  const prefers =
    asArray(preference.preferredNames).includes(name) ||
    (instanceId !== null &&
      asArray(preference.preferredInstanceIds).includes(instanceId));
  const avoids =
    asArray(preference.avoidNames).includes(name) ||
    (instanceId !== null &&
      asArray(preference.avoidInstanceIds).includes(instanceId));
  const weight = intent === "cost" ? -100 : 100;
  if (forced) adjusted += intent === "cost" ? -120 : 120;
  if (prefers) adjusted += weight;
  if (preferredByPolicy) adjusted += intent === "cost" ? -8 : 8;
  if (avoids) adjusted -= weight;
  if (preserved && intent === "cost") adjusted += 80;
  return adjusted;
}

export function buildActionFilter(action: object = {}): AiCardFilter {
  const declaredFilters = readObjectProperty(action, "filters") || {};
  const filter = { ...declaredFilters };
  ACTION_FILTER_KEYS.forEach((key) => {
    const actionValue = readProperty(action, key);
    if (actionValue !== undefined && readProperty(filter, key) === undefined) {
      Reflect.set(filter, key, actionValue);
    }
  });
  return filter as AiCardFilter;
}

export function matchesTargetFilters(
  card: TargetableCard | null | undefined,
  target: object = {},
  sourceCard?: TargetableCard | null,
  ownerRole: TargetOwnerRole | null = null,
): boolean {
  if (!card) return false;
  const targetView = target as AiTargetFilter;
  if (
    targetView.excludeCannotBeSpecialSummoned === true &&
    card.cannotBeSpecialSummoned === true
  ) {
    return false;
  }
  if (Array.isArray(targetView.anyOf) && targetView.anyOf.length > 0) {
    return targetView.anyOf.some((entry) =>
      matchesTargetFilters(
        card,
        { ...targetView, ...entry, anyOf: undefined },
        sourceCard,
        ownerRole,
      )
    );
  }
  if (
    targetView.owner &&
    targetView.owner !== "any" &&
    ownerRole &&
    targetView.owner !== ownerRole
  ) {
    return false;
  }
  if (sourceCard && (targetView.requireThisCard || targetView.excludeSelf)) {
    const sourceInstanceId = getCardInstanceId(sourceCard);
    const cardInstanceId = getCardInstanceId(card);
    const sameCard =
      card === sourceCard ||
      (sourceInstanceId !== null &&
        cardInstanceId !== null &&
        sourceInstanceId === cardInstanceId);
    if (targetView.requireThisCard && !sameCard) {
      return false;
    }
    if (targetView.excludeSelf && sameCard) {
      return false;
    }
  }
  const {
    owner: _owner,
    anyOf: _anyOf,
    id: _targetId,
    targetFromContext: _targetFromContext,
    ...filters
  } = targetView;
  return cardMatchesFilter(
    card as FilterableCard,
    filters as AiCardFilter,
  );
}

function inferTargetIntent(action: CardAction | null | undefined): TargetIntent {
  const actionView = action as ActionIntentView | null | undefined;
  if (!actionView?.type) return "benefit";
  const type = actionView.type;
  if (type === "destroy") return "harm";
  if (type === "banish") return "harm";
  if (type === "move" && actionView.to === "graveyard") return "cost";
  if (type === "discard_from_hand") return "cost";
  if (type === "damage" && actionView.player === "self") return "cost";
  if (type === "buff_stats_temp") return "benefit";
  if (type === "equip") return "benefit";
  if (type === "add_status") return "benefit";
  if (type === "modify_stats_temp") {
    const atkFactor = isFiniteNumber(actionView.atkFactor) ? actionView.atkFactor : 1;
    const defFactor = isFiniteNumber(actionView.defFactor) ? actionView.defFactor : 1;
    return atkFactor < 1 || defFactor < 1 ? "harm" : "benefit";
  }
  if (type === "modify_stats_temp_then_destroy_if_zeroed") {
    const atkChange = isFiniteNumber(actionView.atkChange) ? actionView.atkChange : 0;
    const defChange = isFiniteNumber(actionView.defChange) ? actionView.defChange : 0;
    return atkChange < 0 || defChange < 0 ? "harm" : "benefit";
  }
  if (type.startsWith("special_summon")) return "benefit";
  if (type === "add_from_zone_to_hand") return "benefit";
  if (type === "search_any") return "benefit";
  return "benefit";
}

function buildTargetIntents(
  actions: readonly CardAction[] | null | undefined,
): Map<string, TargetIntent> {
  const intents = new Map<string, TargetIntent>();
  (actions || []).forEach((action) => {
    const targetRef = readProperty(action, "targetRef");
    if (typeof targetRef !== "string" || !targetRef) return;
    if (intents.has(targetRef)) return;
    intents.set(targetRef, inferTargetIntent(action));
  });
  return intents;
}

export function rankCandidates(
  candidates: readonly SimulatedCardState[],
  intent: TargetIntent,
  options: object = {},
): SimulatedCardState[] {
  const typedOptions = options as RankCandidateOptions;
  const targetPreference = typedOptions.targetPreference || null;
  const scored = candidates.map((card) => ({
    card,
    score: applyNameAndInstancePreference(
      intent === "benefit" && targetPreference?.role === "recursion"
        ? estimateRecursionTargetValue(card, targetPreference)
        : intent === "benefit" &&
            targetPreference?.role === "temporary_stat_buff" &&
            targetPreference?.purpose === "offense"
          ? estimateOffensiveTemporaryBuffValue(card, {
              atkBoost: targetPreference.atkBoost,
              opponentField: typedOptions.opponentField,
              opponentLp: typedOptions.opponentLp,
            })
          : intent === "harm" &&
            targetPreference?.role === "temporary_stat_debuff" &&
            targetPreference?.purpose === "combat"
          ? estimateTemporaryCombatDebuffTargetValue(card, {
              attackers: targetPreference.attackers || [],
              opponentLp: typedOptions.opponentLp || 0,
              atkReduction: targetPreference.atkReduction,
              defReduction: targetPreference.defReduction,
              destroyIfAtkZeroedByThisEffect:
                targetPreference.destroyIfAtkZeroedByThisEffect,
              destroyIfDefZeroedByThisEffect:
                targetPreference.destroyIfDefZeroedByThisEffect,
            })
        : estimateCardValue(card, typedOptions),
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
  const cardName = card.name as string;
  let score = (card.level || 0) * 0.2 + Math.max(atk, def) / 1000;

  if (purpose === "stabilize" || purpose === "defense") {
    score += def / 450;
    if (def >= atk + 500 || card.mustBeAttacked) score += 2;
    if (defensiveNames.includes(cardName)) score += 3;
    if (offensiveNames.includes(cardName) && def < 2000) score -= 1;
  } else if (purpose === "pressure" || purpose === "offense") {
    score += atk / 450;
    if (atk >= 2000 || card.piercing) score += 2;
    if (offensiveNames.includes(cardName)) score += 2;
    if (defensiveNames.includes(cardName) && atk < 1800) score -= 3;
  } else {
    if (defensiveNames.includes(cardName)) score += 0.8;
    if (offensiveNames.includes(cardName)) score += 0.8;
  }

  return score;
}

export function estimateOffensiveTemporaryBuffValue(
  card: SimulatedCardState | null | undefined,
  {
    atkBoost = 0,
    opponentField = [],
    opponentLp = 0,
  }: OffensiveTemporaryBuffOptions = {},
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
    isFiniteNumber(atkReduction) &&
    targetAtk > 0 &&
    Math.max(0, targetAtk - atkReduction) === 0;
  const defDropsToZero =
    destroyIfDefZeroedByThisEffect === true &&
    isFiniteNumber(defReduction) &&
    targetDef > 0 &&
    Math.max(0, targetDef - defReduction) === 0;

  if (atkDropsToZero || defDropsToZero) {
    return 100 + estimateMonsterValue(target);
  }
  if (readyAttackers.length === 0) return 0;

  const currentStat = getBattleStatForAttackTarget(target);
  let debuffedStat = 0;
  if (isFiniteNumber(atkReduction) || isFiniteNumber(defReduction)) {
    const reduction =
      target.position === "defense"
        ? isFiniteNumber(defReduction)
          ? defReduction
          : 0
        : isFiniteNumber(atkReduction)
          ? atkReduction
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

export function selectSimulatedTargets({
  targets,
  actions,
  state,
  sourceCard,
  selfId = "bot",
  options = {},
}: SelectSimulatedTargetsInput): CanonicalSelectionMap {
  const result: CanonicalSelectionMap = {};
  if (!Array.isArray(targets) || targets.length === 0) return result;
  const { self, opponent } = getPerspectivePlayers(state, selfId);
  const intents = buildTargetIntents(actions || []);
  const comparisonPasses = (
    candidate: SimulatedCardState | null | undefined,
    reference: SimulatedCardState | null | undefined,
    comparison: AttributeComparison = {},
  ): boolean => {
    if (!candidate || !reference) return false;
    const attr = comparison.attr || comparison.attribute;
    const candidateAttr =
      comparison.targetAttr || comparison.pairedAttr || attr;
    const referenceAttr =
      comparison.refAttr || comparison.sourceAttr || attr;
    if (!candidateAttr || !referenceAttr) return false;
    const left = getCardComparableAttribute(candidate, candidateAttr);
    const right = getCardComparableAttribute(reference, referenceAttr);
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
  };
  const hasPairedCandidate = (
    sourceCandidate: SimulatedCardState,
    pairSpec: object | null | undefined,
  ): boolean => {
    if (!pairSpec) return true;
    const typedPairSpec = pairSpec as AiPairedTarget;
    const ownerEntries: readonly {
      player: SimulatedPlayerState;
      role: TargetOwnerRole;
    }[] =
      typedPairSpec.owner === "opponent"
        ? [{ player: opponent, role: "opponent" }]
        : typedPairSpec.owner === "any"
          ? [
              { player: self, role: "self" },
              { player: opponent, role: "opponent" },
            ]
          : [{ player: self, role: "self" }];
    const zones: readonly EffectZone[] = asArray(
      typedPairSpec.zones || typedPairSpec.zone || "field",
    );
    const comparisons: readonly AttributeComparison[] = [
      ...asArray(typedPairSpec.compareAttribute),
      ...asArray(typedPairSpec.compareAttributes),
    ];
    return ownerEntries.some(({ player: owner, role }) =>
      zones.some((zone) =>
        getZoneCards(owner, zone).some((candidate) => {
          if (!candidate || candidate === sourceCandidate) return false;
          if (
            typedPairSpec.excludeSameName === true &&
            candidate.name === sourceCandidate.name
          ) {
            return false;
          }
          if (
            !matchesTargetFilters(
              candidate,
              typedPairSpec,
              sourceCandidate,
              role,
            )
          ) {
            return false;
          }
          return comparisons.every((comparison) =>
            comparisonPasses(candidate, sourceCandidate, comparison),
          );
        }),
      ),
    );
  };

  targets.forEach((target) => {
    const targetView = target as AiTargetFilter;
    if (!targetView.id) return;
    if (targetView.targetFromContext) {
      const actionContext = readObjectProperty(options, "actionContext");
      const activationContext = readObjectProperty(options, "activationContext");
      const activationActionContext = readObjectProperty(
        activationContext,
        "actionContext",
      );
      const contextValue =
        readProperty(options, targetView.targetFromContext) ||
        readProperty(actionContext, targetView.targetFromContext) ||
        readProperty(activationActionContext, targetView.targetFromContext) ||
        null;
      const requiredZones: readonly EffectZone[] = Array.isArray(targetView.zones)
        ? targetView.zones
        : targetView.zone
          ? [targetView.zone]
          : [];
      const contextCards = (
        asArray(contextValue) as readonly SimulatedCardState[]
      ).filter((card) => {
        const owner = findCardOwner(state, card);
        const ownerRole: TargetOwnerRole | null =
          owner === self ? "self" : owner === opponent ? "opponent" : null;
        const zone = owner ? findCardZone(owner, card) : null;
        return (
          matchesTargetFilters(card, targetView, sourceCard, ownerRole) &&
          (requiredZones.length === 0 ||
            requiredZones.includes("any") ||
            (zone !== null && requiredZones.includes(zone)))
        );
      });
      const count = normalizeCount(targetView.count, 1);
      Reflect.set(
        result,
        targetView.id,
        contextCards.slice(0, Math.min(count.max, contextCards.length)),
      );
      return;
    }
    const excludeTargetRefs = [
      targetView.excludeTargetRef,
      ...asArray(targetView.excludeTargetRefs),
    ].filter(Boolean) as string[];
    const excludedCards = excludeTargetRefs.flatMap((ref) =>
      selectionValueAsCards(readSelectedValue(result, ref)),
    );
    const excludedInstanceIds = excludedCards
      .map(getCardInstanceId)
      .filter((value) => value !== undefined && value !== null);
    let effectiveTarget: AiTargetFilter =
      excludedCards.length > 0
        ? {
            ...targetView,
            excludeCards: [
              ...asArray(targetView.excludeCards),
              ...excludedCards,
            ],
            excludeInstanceIds: [
              ...asArray(targetView.excludeInstanceIds),
              ...excludedInstanceIds,
            ],
          }
        : targetView;
    const excludedNameCards = selectionValueAsCards(
      readSelectedValue(result, targetView.excludeNameRef),
    );
    const excludedNames = excludedNameCards
      .map((card) => card?.name)
      .filter((name): name is string => typeof name === "string" && !!name);
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
        if (!matchesTargetFilters(card, effectiveTarget, sourceCard, role)) {
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
          const reference = selectionValueAsCards(
            readSelectedValue(result, comparison.ref),
          )[0];
          if (!comparisonPasses(card, reference, comparison)) return false;
        }
        return true;
      })
      .map(({ card }) => card);

    const explicitTargetPreference = getTargetPreference(options, targetView.id);
    const intent =
      explicitTargetPreference?.intent ||
      targetView.intent ||
      intents.get(targetView.id) ||
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
      typeof targetView.countFromSelectionRef === "string"
        ? readSelectedValue(result, targetView.countFromSelectionRef)
        : null;
    const count = Array.isArray(referencedSelection)
      ? {
          min: referencedSelection.length,
          max: referencedSelection.length,
        }
      : normalizeCount(targetView.count, 1);
    const min = count.min;
    const max = count.max;
    let pickCount = intent === "cost" ? min : max;
    if (min === 0 && intent !== "cost") {
      pickCount = 0;
    }
    Reflect.set(
      result,
      targetView.id,
      ordered.slice(0, Math.min(pickCount, ordered.length)),
    );
  });

  return result;
}
