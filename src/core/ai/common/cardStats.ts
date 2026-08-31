import type { SimulatedCardState } from "../../contracts/aiState.js";
import type { GameCard } from "../../contracts/cards.js";

type StatName = "atk" | "def";
type FacedownValue = number | "printed";
type StatCardBase = SimulatedCardState | GameCard;
type StatCard = StatCardBase & {
  status?: { piercingDamage?: boolean };
};

interface StatOptions {
  facedownValue?: FacedownValue;
  includeFacedown?: boolean;
  includeBoosts?: boolean;
  includeEquip?: boolean;
}

export function getEffectiveAtk(card: StatCardBase | null | undefined): number {
  return (
    (card?.atk || 0) +
    (card?.tempAtkBoost || 0) +
    (card?.equipAtkBonus || 0)
  );
}

export function getEffectiveDef(card: StatCardBase | null | undefined): number {
  return (
    (card?.def || 0) +
    (card?.tempDefBoost || 0) +
    (card?.equipDefBonus || 0)
  );
}

export function getEffectiveStat(
  card: StatCardBase | null | undefined,
  stat: StatName,
  { includeEquip = true }: Pick<StatOptions, "includeEquip"> = {},
): number {
  if (!card) return 0;
  const key = stat === "def" ? "def" : "atk";
  const tempKey = key === "def" ? "tempDefBoost" : "tempAtkBoost";
  const equipKey = key === "def" ? "equipDefBonus" : "equipAtkBonus";
  return (
    Number(card[key] || 0) +
    Number(card[tempKey] || 0) +
    (includeEquip ? Number(card[equipKey] || 0) : 0)
  );
}

export function getVisibleAtk(card: StatCardBase | null | undefined): number {
  if (!card || card.isFacedown) return 0;
  return getEffectiveAtk(card);
}

export function getVisibleDef(card: StatCardBase | null | undefined): number {
  if (!card || card.isFacedown) return 0;
  return getEffectiveDef(card);
}

export function getBattleStatForAttackTarget(
  card: StatCardBase | null | undefined,
  { facedownValue = 1500 }: Pick<StatOptions, "facedownValue"> = {},
): number {
  if (!card || card.cardKind !== "monster") return 0;
  if (card.isFacedown) return resolveFacedownValue(card, "def", facedownValue);
  return card.position === "defense" ? getEffectiveDef(card) : getEffectiveAtk(card);
}

export function getBattleStat(
  card: StatCardBase | null | undefined,
  { facedownValue = 1500 }: Pick<StatOptions, "facedownValue"> = {},
): number {
  return getBattleStatForAttackTarget(card, { facedownValue });
}

export function getPiercingDamage(
  attacker: StatCard | null | undefined,
  attackStat: number,
  targetStat: number,
): number {
  if (!attacker?.piercing && !attacker?.status?.piercingDamage) return 0;
  const multiplier = Number(attacker?.piercingDamageMultiplier ?? 1);
  const safeMultiplier =
    Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  const excess = Math.max(0, Number(attackStat || 0) - Number(targetStat || 0));
  return excess > 0 ? Math.floor(excess * safeMultiplier) : 0;
}

function resolveFacedownValue(
  card: StatCardBase | null | undefined,
  stat: StatName,
  facedownValue: FacedownValue,
): number {
  if (facedownValue === "printed") {
    return Number(card?.[stat] || 0);
  }
  return Number(facedownValue || 0);
}

export function getFieldMonsters<Card extends StatCardBase>(
  field: readonly Card[] = [],
  { includeFacedown = true }: Pick<StatOptions, "includeFacedown"> = {},
): Card[] {
  return (field || []).filter((card) => {
    if (!card || card.cardKind !== "monster") return false;
    return includeFacedown || !card.isFacedown;
  });
}

export function getAttackThreatStat(
  card: StatCardBase | null | undefined,
  {
    facedownValue = 1500,
    includeFacedown = true,
    includeBoosts = true,
  }: StatOptions = {},
): number {
  if (!card || card.cardKind !== "monster") return 0;
  if (card.isFacedown) {
    return includeFacedown ? resolveFacedownValue(card, "atk", facedownValue) : 0;
  }
  return includeBoosts ? getEffectiveAtk(card) : Number(card.atk || 0);
}

export function getBattleThreatStat(
  card: StatCardBase | null | undefined,
  {
    facedownValue = 1500,
    includeFacedown = true,
    includeBoosts = true,
  }: StatOptions = {},
): number {
  if (!card || card.cardKind !== "monster") return 0;
  if (card.isFacedown) {
    return includeFacedown
      ? resolveFacedownValue(card, "atk", facedownValue)
      : 0;
  }
  const stat = card.position === "defense" ? "def" : "atk";
  return includeBoosts
    ? getEffectiveStat(card, stat)
    : Number(card[stat] || 0);
}

export function getStrongestAttackThreat(
  field: readonly StatCardBase[] = [],
  options: StatOptions = {},
): number {
  return getFieldMonsters(field, {
    includeFacedown: options.includeFacedown !== false,
  }).reduce(
    (max, card) => Math.max(max, getAttackThreatStat(card, options)),
    0,
  );
}

export function getTotalAttackThreat(
  field: readonly StatCardBase[] = [],
  options: StatOptions = {},
): number {
  return getFieldMonsters(field, {
    includeFacedown: options.includeFacedown !== false,
  }).reduce(
    (sum, card) => sum + getAttackThreatStat(card, options),
    0,
  );
}

export function getStrongestBattleThreat(
  field: readonly StatCardBase[] = [],
  options: StatOptions = {},
): number {
  return getFieldMonsters(field, {
    includeFacedown: options.includeFacedown !== false,
  }).reduce(
    (max, card) => Math.max(max, getBattleThreatStat(card, options)),
    0,
  );
}

export function getTotalBattleThreat(
  field: readonly StatCardBase[] = [],
  options: StatOptions = {},
): number {
  return getFieldMonsters(field, {
    includeFacedown: options.includeFacedown !== false,
  }).reduce(
    (sum, card) => sum + getBattleThreatStat(card, options),
    0,
  );
}

export function analyzeBattleThreats<Card extends StatCardBase>(
  field: readonly Card[] = [],
  options: StatOptions = {},
) {
  const monsters = getFieldMonsters(field, {
    includeFacedown: options.includeFacedown !== false,
  });
  return {
    monsters,
    monsterCount: monsters.length,
    strongestAttack: getStrongestAttackThreat(monsters, options),
    totalAttack: getTotalAttackThreat(monsters, options),
    strongestBattle: getStrongestBattleThreat(monsters, options),
    totalBattle: getTotalBattleThreat(monsters, options),
  };
}

export function getStrongestBattleStat(
  field: readonly StatCardBase[] = [],
  options: StatOptions = {},
): number {
  return (field || []).reduce((max, card) => {
    if (!card || card.cardKind !== "monster") return max;
    return Math.max(max, getBattleStat(card, options));
  }, 0);
}

export function countDestroyableByAtk(
  monsters: readonly StatCardBase[] = [],
  atk = 0,
  options: StatOptions = {},
): number {
  const attack = Number(atk || 0);
  return (monsters || []).filter((monster) => {
    if (!monster || monster.cardKind !== "monster") return false;
    return attack > getBattleStat(monster, options);
  }).length;
}

export function canClearThreat(
  attacker: StatCardBase | null | undefined,
  opponentField: readonly StatCardBase[] = [],
  options: StatOptions = {},
): boolean {
  if (!attacker || attacker.cardKind !== "monster") return false;
  const atk = getEffectiveAtk(attacker);
  if (atk <= 0) return false;
  return atk > getStrongestBattleStat(opponentField, options);
}
