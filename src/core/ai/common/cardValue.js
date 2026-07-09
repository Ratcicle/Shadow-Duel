import { getEffectiveAtk } from "./cardStats.js";

export function getCardArchetypes(card) {
  if (!card) return [];
  if (Array.isArray(card.archetypes)) return card.archetypes.slice();
  if (card.archetype) return [card.archetype];
  return [];
}

// Resolves attacks available in a Battle Phase, including dynamic passive count.
export function getMaxAttacks(card, owner = null) {
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

export function hasArchetype(card, archetype) {
  if (!card || !archetype) return false;
  return getCardArchetypes(card).includes(archetype);
}

export function estimateMonsterValue(monster, options = {}) {
  if (!monster) return 0;
  const preferDefense = options.preferDefense === true;
  const archetype = options.archetype || null;
  const fieldSpell = options.fieldSpell || null;

  const atk = (monster.atk || 0) + (monster.tempAtkBoost || 0);
  const def = monster.isFacedown ? 1500 : (monster.def || 0) + (monster.tempDefBoost || 0);
  const level = monster.level || 0;
  const base = monster.position === "defense" || preferDefense ? def : atk;

  let value = base / 1000 + level * 0.12;

  if (monster.isFacedown) value *= 0.7;
  if (monster.cannotAttackThisTurn) value -= 0.2;
  if (monster.hasAttacked) value -= 0.1;
  if (monster.piercing) {
    const multiplier = Number(monster.piercingDamageMultiplier ?? 1);
    const safeMultiplier =
      Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
    value += 0.2 * safeMultiplier;
  }
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

export function estimateCardValue(card, options = {}) {
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

  const effects = Array.isArray(card.effects) ? card.effects : [];
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

export function isBattleReadyAttacker(card, { archetype = null } = {}) {
  if (!card || card.cardKind !== "monster") return false;
  if (card.isFacedown) return false;
  if (card.position !== "attack") return false;
  if (card.cannotAttackThisTurn || card.hasAttacked) return false;
  if (archetype && !hasArchetype(card, archetype)) return false;
  return getEffectiveAtk(card) > 0;
}
