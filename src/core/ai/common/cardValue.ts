import { getEffectiveAtk } from "./cardStats.js";
import { getActivePiercingMultiplier } from "../../game/combat/availability.js";
import type { CardAction } from "../../contracts/actions.js";

interface MultiAttackCardView {
  attackLimitThisTurn?: number | null;
  extraAttacks?: number;
  equipExtraAttacks?: number;
  multiAttackLimit?: number;
  dynamicExtraAttacks?: {
    source?: string;
    name?: string;
  } | null;
}

interface MultiAttackOwnerView {
  graveyard?: ReadonlyArray<{ name?: string | null | undefined }>;
}

interface CardValueEffectView {
  actions?: readonly CardAction[] | null;
}

export interface CardValueCardView extends MultiAttackCardView {
  name?: string | null | undefined;
  cardKind?: string | null | undefined;
  atk?: number | null | undefined;
  def?: number | null | undefined;
  level?: number | null | undefined;
  position?: string | null | undefined;
  archetype?: string | null | undefined;
  archetypes?: readonly string[] | undefined;
  isFacedown?: boolean | undefined;
  cannotAttackThisTurn?: boolean;
  hasAttacked?: boolean | undefined;
  piercing?: boolean;
  piercingDamageMultiplier?: number | null;
  piercingGrantedByEffect?: boolean | undefined;
  effectsNegated?: boolean | undefined;
  battleIndestructibleOncePerTurn?: boolean;
  mustBeAttacked?: boolean | undefined;
  tempAtkBoost?: number | undefined;
  tempDefBoost?: number | undefined;
  effects?: readonly CardValueEffectView[];
}

export interface CardValueOptions {
  preferDefense?: boolean;
  archetype?: string | null | undefined;
  fieldSpell?: CardValueCardView | null;
  owner?: MultiAttackOwnerView | null;
}

type CardInstanceKey = number | string;

export interface CardCostCardView extends CardValueCardView {
  instanceId?: CardInstanceKey | null | undefined;
  _instanceId?: CardInstanceKey | null | undefined;
  uid?: CardInstanceKey | null | undefined;
  uuid?: CardInstanceKey | null | undefined;
  simInstanceId?: CardInstanceKey | null | undefined;
}

export interface CardValuePreference {
  forceNames?: readonly string[] | string;
  preferNames?: readonly string[] | string;
  preserveNames?: readonly string[] | string;
  preferredNames?: readonly string[] | string;
  avoidNames?: readonly string[] | string;
  preferredInstanceIds?: readonly CardInstanceKey[] | CardInstanceKey;
  avoidInstanceIds?: readonly CardInstanceKey[] | CardInstanceKey;
}

export interface CardCostOptions extends CardValueOptions {
  preference?: CardValuePreference | null;
}

export interface MaterialCombinationValue {
  readonly cost: number;
  readonly battleAtk: number;
  readonly fieldCount: number;
  readonly instanceIds: readonly (CardInstanceKey | null)[];
}

export function getCardValueInstanceId(card: CardCostCardView | null | undefined): CardInstanceKey | null {
  return card?.instanceId ?? card?._instanceId ?? card?.uid ?? card?.uuid ?? card?.simInstanceId ?? null;
}

function preferenceIncludes<Value>(values: Value | readonly Value[] | undefined, value: Value): boolean {
  return Array.isArray(values) ? values.includes(value) : values === value;
}

export function applyCardValuePreference(
  score: number,
  card: CardCostCardView | null | undefined,
  preference: CardValuePreference | null | undefined,
  intent: "benefit" | "cost" | "harm" | "reference",
): number {
  if (!preference || !card) return score;
  const name = card.name || "";
  const instanceId = getCardValueInstanceId(card);
  const forced = preferenceIncludes(preference.forceNames, name);
  const preferredByPolicy = preferenceIncludes(preference.preferNames, name);
  const preserved = preferenceIncludes(preference.preserveNames, name);
  const preferred = preferenceIncludes(preference.preferredNames, name) ||
    (instanceId !== null && preferenceIncludes(preference.preferredInstanceIds, instanceId));
  const avoided = preferenceIncludes(preference.avoidNames, name) ||
    (instanceId !== null && preferenceIncludes(preference.avoidInstanceIds, instanceId));
  const weight = intent === "cost" ? -100 : 100;
  let adjusted = score;
  if (forced) adjusted += intent === "cost" ? -120 : 120;
  if (preferred) adjusted += weight;
  if (preferredByPolicy) adjusted += intent === "cost" ? -8 : 8;
  if (avoided) adjusted -= weight;
  if (preserved && intent === "cost") adjusted += 80;
  return adjusted;
}

/** Cost ranking is shared by public AI resolution and simulated selections. */
export function estimateCardCost(card: CardCostCardView, options: CardCostOptions = {}): number {
  return applyCardValuePreference(estimateCardValue(card, options), card, options.preference, "cost");
}

/** Orders instance ids by creation (numbers numerically), independent of the process-wide id offset. */
export function compareInstanceIds(left: CardInstanceKey | null, right: CardInstanceKey | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left !== typeof right) return typeof left === "number" ? -1 : 1;
  return String(left) < String(right) ? -1 : 1;
}

export function valueMaterialCombination<Card extends CardCostCardView>(
  materials: readonly Card[],
  field: readonly Card[],
  options: CardCostOptions = {},
): MaterialCombinationValue {
  return {
    cost: materials.map(card => estimateCardCost(card, options)).sort((left, right) => left - right)
      .reduce((sum, cost) => sum + cost, 0),
    battleAtk: materials.reduce((sum, card) => sum +
      (field.includes(card) && isBattleReadyAttacker(card) ? getEffectiveAtk(card) : 0), 0),
    fieldCount: materials.filter(card => field.includes(card)).length,
    instanceIds: materials.map(getCardValueInstanceId).sort(compareInstanceIds),
  };
}

/** Equal total costs preserve ready attackers, field bodies, then stable copies. */
export function compareMaterialCombinations(left: MaterialCombinationValue, right: MaterialCombinationValue): number {
  const difference = left.cost - right.cost || left.battleAtk - right.battleAtk || left.fieldCount - right.fieldCount;
  if (difference !== 0) return difference;
  for (let index = 0; index < Math.max(left.instanceIds.length, right.instanceIds.length); index++) {
    const leftId = left.instanceIds[index];
    const rightId = right.instanceIds[index];
    if (leftId === undefined || rightId === undefined) return left.instanceIds.length - right.instanceIds.length;
    const order = compareInstanceIds(leftId, rightId);
    if (order !== 0) return order;
  }
  return 0;
}

export function getCardArchetypes(
  card: CardValueCardView | null | undefined,
): string[] {
  if (!card) return [];
  if (Array.isArray(card.archetypes)) return card.archetypes.slice();
  if (card.archetype) return [card.archetype];
  return [];
}

// Resolves attacks available in a Battle Phase, including dynamic passive count.
export function getMaxAttacks(
  card: MultiAttackCardView | null | undefined,
  owner: MultiAttackOwnerView | null = null,
): number {
  if (!card) return 1;
  if (
    card.attackLimitThisTurn !== undefined &&
    card.attackLimitThisTurn !== null &&
    Number.isFinite(Number(card.attackLimitThisTurn))
  ) {
    return Math.max(0, Math.floor(Number(card.attackLimitThisTurn)));
  }
  let extra = (card.extraAttacks || 0) + (card.equipExtraAttacks || 0);
  if (card.dynamicExtraAttacks?.source === "graveyard_count" && owner) {
    const dea = card.dynamicExtraAttacks;
    extra = (owner.graveyard || []).filter(
      (c) => c && c.name === dea.name
    ).length;
  }
  return 1 + extra;
}

export function hasArchetype(
  card: CardValueCardView | null | undefined,
  archetype: string | null | undefined,
): boolean {
  if (!card || !archetype) return false;
  return getCardArchetypes(card).includes(archetype);
}

export function estimateMonsterValue(
  monster: CardValueCardView | null | undefined,
  options: CardValueOptions = {},
): number {
  if (!monster) return 0;
  const preferDefense = options.preferDefense === true;
  const archetype = options.archetype || null;
  const fieldSpell = options.fieldSpell || null;

  const atk = (monster.atk || 0);
  const def = monster.isFacedown ? 1500 : (monster.def || 0);
  const level = monster.level || 0;
  const base = monster.position === "defense" || preferDefense ? def : atk;

  let value = base / 1000 + level * 0.12;

  if (monster.isFacedown) value *= 0.7;
  if (monster.cannotAttackThisTurn) value -= 0.2;
  if (monster.hasAttacked) value -= 0.1;
  value += 0.2 * getActivePiercingMultiplier(monster);
  const bonusAttacks = getMaxAttacks(monster, options.owner || null) - 1;
  if (bonusAttacks > 0) value += 0.2 * bonusAttacks;
  if (monster.battleIndestructibleOncePerTurn) value += 0.25;
  if (monster.mustBeAttacked) {
    value += 0.25 + def / 2500;
  }

  if (archetype && hasArchetype(monster, archetype)) {
    value += 0.2;
  }
  if (fieldSpell && archetype && hasArchetype(fieldSpell, archetype)) {
    value += 0.15;
  }

  return value;
}

export function estimateCardValue(
  card: CardValueCardView | null | undefined,
  options: CardValueOptions = {},
): number {
  if (!card) return 0;
  if (card.cardKind === "monster") {
    return estimateMonsterValue(card, options);
  }

  let value = 0.25;

  const cardName = card.name || "";
  if (cardName === "Polymerization") {
    value += 2.0;
  }
  if (cardName.includes("Covenant") || cardName.includes("Purge")) {
    value += 0.8;
  }

  const effects = (Array.isArray(card.effects) ? card.effects : []) as readonly CardValueEffectView[];
  effects.forEach((effect) => {
    const actions = Array.isArray(effect.actions) ? effect.actions : [];
    actions.forEach((action) => {
      if (!action || !action.type) return;
      const type = action.type;
      if (type === "draw") value += 0.4 * (action.amount || 1);
      if (type === "search_any") value += 0.4;
      if (type === "add_from_zone_to_hand") value += 0.35;
      if (type === "heal") value += (action.amount || 0) / 3000;
      if (type === "heal_per_archetype_monster") value += 0.4;
      if (type === "destroy") value += 0.5;
      if (type === "equip") value += 0.3;
      if (
        type === "buff_stats_temp" ||
        type === "modify_stats_temp" ||
        type === "modify_stats_temp_then_destroy_if_zeroed"
      ) {
        value += 0.25;
      }
      if (type === "special_summon_from_zone") value += 0.6;
      if (type === "special_summon_token") value += 0.4;
      if (type === "fusion_summon") value += 1.5;
    });
  });

  return value;
}

export function isBattleReadyAttacker(
  card: CardValueCardView | null | undefined,
  { archetype = null }: Pick<CardValueOptions, "archetype"> = {},
): boolean {
  if (!card || card.cardKind !== "monster") return false;
  if (card.isFacedown) return false;
  if (card.position !== "attack") return false;
  if (card.cannotAttackThisTurn || card.hasAttacked) return false;
  if (archetype && !hasArchetype(card, archetype)) return false;
  return getEffectiveAtk(card) > 0;
}
