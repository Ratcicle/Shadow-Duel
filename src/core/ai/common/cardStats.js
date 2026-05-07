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
