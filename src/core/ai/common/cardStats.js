export function getEffectiveAtk(card) {
  return (
    (card?.atk || 0) +
    (card?.tempAtkBoost || 0) +
    (card?.equipAtkBonus || 0)
  );
}

export function getEffectiveDef(card) {
  return (
    (card?.def || 0) +
    (card?.tempDefBoost || 0) +
    (card?.equipDefBonus || 0)
  );
}

export function getEffectiveStat(card, stat, { includeEquip = true } = {}) {
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

export function getVisibleAtk(card) {
  if (!card || card.isFacedown) return 0;
  return getEffectiveAtk(card);
}

export function getVisibleDef(card) {
  if (!card || card.isFacedown) return 0;
  return getEffectiveDef(card);
}

export function getBattleStatForAttackTarget(
  card,
  { facedownValue = 1500 } = {},
) {
  if (!card || card.cardKind !== "monster") return 0;
  if (card.isFacedown) return facedownValue;
  return card.position === "defense" ? getEffectiveDef(card) : getEffectiveAtk(card);
}

export function getBattleStat(card, { facedownValue = 1500 } = {}) {
  return getBattleStatForAttackTarget(card, { facedownValue });
}

export function getStrongestBattleStat(field = [], options = {}) {
  return (field || []).reduce((max, card) => {
    if (!card || card.cardKind !== "monster") return max;
    return Math.max(max, getBattleStat(card, options));
  }, 0);
}

export function countDestroyableByAtk(monsters = [], atk = 0, options = {}) {
  const attack = Number(atk || 0);
  return (monsters || []).filter((monster) => {
    if (!monster || monster.cardKind !== "monster") return false;
    return attack > getBattleStat(monster, options);
  }).length;
}

export function canClearThreat(attacker, opponentField = [], options = {}) {
  if (!attacker || attacker.cardKind !== "monster") return false;
  const atk = getEffectiveAtk(attacker);
  if (atk <= 0) return false;
  return atk > getStrongestBattleStat(opponentField, options);
}
