import {
  getBattleStatForAttackTarget,
  getEffectiveAtk,
  getEffectiveDef,
} from "./common/cardStats.js";
import { cardMatchesFilter } from "./common/cardFilters.js";

export function getCardArchetypes(card) {
  if (!card) return [];
  if (Array.isArray(card.archetypes)) return card.archetypes.slice();
  if (card.archetype) return [card.archetype];
  return [];
}

// Resolves the number of attacks a monster can declare per Battle Phase,
// including the dynamicExtraAttacks passive (e.g. Malicious Demon of the Void).
// `owner` is required for dynamic resolution; without it falls back to static.
export function getMaxAttacks(card, owner = null) {
  if (!card) return 1;
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
  // 🎭 REGRA: Não pode ver DEF real de monstros facedown (usar estimativa)
  const def = monster.isFacedown ? 1500 : (monster.def || 0) + (monster.tempDefBoost || 0);
  const level = monster.level || 0;
  const base = monster.position === "defense" || preferDefense ? def : atk;

  let value = base / 1000 + level * 0.12;

  if (monster.isFacedown) value *= 0.7;
  if (monster.cannotAttackThisTurn) value -= 0.2;
  if (monster.hasAttacked) value -= 0.1;
  if (monster.piercing) value += 0.2;
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

  // BUGFIX: Protect high-value spells from being discarded
  const cardName = card.name || "";
  if (cardName === "Polymerization") {
    // Polymerization is extremely valuable - never discard if possible
    value += 2.0;
  }
  // Other valuable spells that shouldn't be discarded easily
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
      // Fusion effects are very valuable
      if (type === "fusion_summon") value += 1.5;
    });
  });

  return value;
}

export function getPerspectivePlayers(state, selfId = "bot") {
  if (selfId === "player") {
    return { self: state.player, opponent: state.bot };
  }
  return { self: state.bot, opponent: state.player };
}

function chooseOtherPlayer(self, candidates = []) {
  return candidates.find((candidate) => candidate && candidate !== self) || null;
}

function byId(player, slot) {
  return !!(
    player &&
    slot &&
    player.id !== undefined &&
    slot.id !== undefined &&
    player.id === slot.id
  );
}

export function resolvePerspectivePlayers(gameOrState, perspectivePlayer) {
  const state = gameOrState || {};
  const playerSlot = state.player || null;
  const botSlot = state.bot || null;
  const candidates = [playerSlot, botSlot].filter(Boolean);

  const finalize = (self, opponent) => {
    const resolvedSelf = self || perspectivePlayer || botSlot || playerSlot || null;
    let resolvedOpponent = opponent || chooseOtherPlayer(resolvedSelf, candidates);
    if (resolvedSelf && resolvedOpponent === resolvedSelf) {
      resolvedOpponent = chooseOtherPlayer(resolvedSelf, candidates);
    }
    return { self: resolvedSelf, opponent: resolvedOpponent || null };
  };

  if (state._isPerspectiveState === true) {
    if (perspectivePlayer && perspectivePlayer === playerSlot) {
      return finalize(playerSlot, botSlot);
    }
    return finalize(botSlot || perspectivePlayer, playerSlot);
  }

  if (typeof state.getOpponent === "function" && perspectivePlayer) {
    return finalize(perspectivePlayer, state.getOpponent(perspectivePlayer));
  }

  if (perspectivePlayer && perspectivePlayer === botSlot) {
    return finalize(botSlot, playerSlot);
  }
  if (perspectivePlayer && perspectivePlayer === playerSlot) {
    return finalize(playerSlot, botSlot);
  }
  if (byId(perspectivePlayer, botSlot)) {
    return finalize(botSlot, playerSlot);
  }
  if (byId(perspectivePlayer, playerSlot)) {
    return finalize(playerSlot, botSlot);
  }

  return finalize(perspectivePlayer || botSlot, playerSlot);
}

export function getZoneCards(player, zone) {
  if (!player) return [];
  switch (zone) {
    case "field":
      return Array.isArray(player.field) ? player.field : [];
    case "hand":
      return Array.isArray(player.hand) ? player.hand : [];
    case "graveyard":
      return Array.isArray(player.graveyard) ? player.graveyard : [];
    case "deck":
      return Array.isArray(player.deck) ? player.deck : [];
    case "spellTrap":
      return Array.isArray(player.spellTrap) ? player.spellTrap : [];
    case "fieldSpell":
      return player.fieldSpell ? [player.fieldSpell] : [];
    case "banished":
      return Array.isArray(player.banished) ? player.banished : [];
    default:
      return [];
  }
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeCount(count, fallback = 1) {
  if (Number.isFinite(count)) {
    return { min: count, max: count };
  }
  const min = Number.isFinite(count?.min) ? count.min : fallback;
  const max = Number.isFinite(count?.max) ? count.max : min;
  return { min, max };
}

function getCardInstanceId(card) {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uid ??
    card?.uuid ??
    card?.simInstanceId ??
    null
  );
}

function getTargetPreference(options = {}, targetId = null) {
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

function getCostPreference(options = {}) {
  return (
    options.costPreferences ||
    options.actionContext?.costPreferences ||
    options.activationContext?.actionContext?.costPreferences ||
    options.activationContext?.costPreferences ||
    null
  );
}

function mergeCostPreference(targetPreference, costPreference) {
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

function applyNameAndInstancePreference(score, card, preference, intent) {
  if (!preference || !card) return score;
  let adjusted = score;
  const name = card.name;
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

function buildActionFilter(action = {}) {
  const filter = { ...(action.filters || {}) };
  [
    "cardKind",
    "cardName",
    "name",
    "cardId",
    "subtype",
    "archetype",
    "archetypes",
    "requireFaceup",
    "excludeCardName",
    "excludeCardNames",
    "minLevel",
    "maxLevel",
    "level",
    "levelOp",
    "minAtk",
    "maxAtk",
    "minDef",
    "maxDef",
  ].forEach((key) => {
    if (action[key] !== undefined && filter[key] === undefined) {
      filter[key] = action[key];
    }
  });
  if (action.monsterType && filter.type === undefined) {
    filter.type = action.monsterType;
  }
  return filter;
}

function matchesTargetFilters(card, target = {}, sourceCard, ownerRole = null) {
  if (!card) return false;
  if (Array.isArray(target.anyOf) && target.anyOf.length > 0) {
    return target.anyOf.some((entry) =>
      matchesTargetFilters(
        card,
        { ...target, ...entry, anyOf: undefined },
        sourceCard,
        ownerRole,
      )
    );
  }
  if (
    target.owner &&
    target.owner !== "any" &&
    ownerRole &&
    target.owner !== ownerRole
  ) {
    return false;
  }
  if (sourceCard && (target.requireThisCard || target.excludeSelf)) {
    const sourceInstanceId = getCardInstanceId(sourceCard);
    const cardInstanceId = getCardInstanceId(card);
    const sameCard =
      card === sourceCard ||
      (sourceInstanceId !== null &&
        cardInstanceId !== null &&
        sourceInstanceId === cardInstanceId);
    if (target.requireThisCard && !sameCard) {
      return false;
    }
    if (target.excludeSelf && sameCard) {
      return false;
    }
  }
  const { owner: _owner, anyOf: _anyOf, ...filters } = target;
  return cardMatchesFilter(card, filters);
}

function inferTargetIntent(action) {
  if (!action || !action.type) return "benefit";
  const type = action.type;
  if (type === "destroy") return "harm";
  if (type === "banish") return "harm";
  if (type === "move" && action.to === "graveyard") return "cost";
  if (type === "damage" && action.player === "self") return "cost";
  if (type === "buff_stats_temp") return "benefit";
  if (type === "equip") return "benefit";
  if (type === "add_status") return "benefit";
  if (type === "modify_stats_temp") {
    const atkFactor = Number.isFinite(action.atkFactor) ? action.atkFactor : 1;
    const defFactor = Number.isFinite(action.defFactor) ? action.defFactor : 1;
    return atkFactor < 1 || defFactor < 1 ? "harm" : "benefit";
  }
  if (type === "modify_stats_temp_then_destroy_if_zeroed") {
    const atkChange = Number.isFinite(action.atkChange) ? action.atkChange : 0;
    const defChange = Number.isFinite(action.defChange) ? action.defChange : 0;
    return atkChange < 0 || defChange < 0 ? "harm" : "benefit";
  }
  if (type.startsWith("special_summon")) return "benefit";
  if (type === "add_from_zone_to_hand") return "benefit";
  if (type === "search_any") return "benefit";
  return "benefit";
}

function buildTargetIntents(actions) {
  const intents = new Map();
  (actions || []).forEach((action) => {
    if (!action || !action.targetRef) return;
    if (intents.has(action.targetRef)) return;
    intents.set(action.targetRef, inferTargetIntent(action));
  });
  return intents;
}

function rankCandidates(candidates, intent, options = {}) {
  const targetPreference = options.targetPreference || null;
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

export function estimateRecursionTargetValue(card, preference = {}) {
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
    if (defensiveNames.includes(card.name)) score += 3;
    if (offensiveNames.includes(card.name) && def < 2000) score -= 1;
  } else if (purpose === "pressure" || purpose === "offense") {
    score += atk / 450;
    if (atk >= 2000 || card.piercing) score += 2;
    if (offensiveNames.includes(card.name)) score += 2;
    if (defensiveNames.includes(card.name) && atk < 1800) score -= 3;
  } else {
    if (defensiveNames.includes(card.name)) score += 0.8;
    if (offensiveNames.includes(card.name)) score += 0.8;
  }

  return score;
}

export function estimateOffensiveTemporaryBuffValue(
  card,
  { atkBoost = 0, opponentField = [], opponentLp = 0 } = {},
) {
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

export function getBattleStat(card) {
  return getBattleStatForAttackTarget(card);
}

export function isBattleReadyAttacker(card, { archetype = null } = {}) {
  if (!card || card.cardKind !== "monster") return false;
  if (card.isFacedown) return false;
  if (card.position !== "attack") return false;
  if (card.cannotAttackThisTurn || card.hasAttacked) return false;
  if (archetype && !hasArchetype(card, archetype)) return false;
  return getEffectiveAtk(card) > 0;
}

export function estimateTemporaryCombatDebuffTargetValue(
  target,
  {
    attackers = [],
    opponentLp = 0,
    atkReduction = null,
    defReduction = null,
    destroyIfAtkZeroedByThisEffect = false,
    destroyIfDefZeroedByThisEffect = false,
  } = {},
) {
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
    Math.max(0, targetAtk - atkReduction) === 0;
  const defDropsToZero =
    destroyIfDefZeroedByThisEffect === true &&
    Number.isFinite(defReduction) &&
    targetDef > 0 &&
    Math.max(0, targetDef - defReduction) === 0;

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
          ? defReduction
          : 0
        : Number.isFinite(atkReduction)
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
        : attacker.piercing && target.position === "defense" && atk > currentStat
          ? atk - currentStat
          : 0;
    const damageAfter =
      target.position === "attack" && atk > debuffedStat
        ? atk - debuffedStat
        : attacker.piercing && target.position === "defense" && atk > debuffedStat
          ? atk - debuffedStat
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
}) {
  const result = {};
  if (!Array.isArray(targets) || targets.length === 0) return result;
  const { self, opponent } = getPerspectivePlayers(state, selfId);
  const intents = buildTargetIntents(actions || []);

  targets.forEach((target) => {
    if (!target || !target.id) return;
    const ownerEntries =
      target.owner === "opponent"
        ? [{ player: opponent, role: "opponent" }]
        : target.owner === "any"
          ? [
              { player: self, role: "self" },
              { player: opponent, role: "opponent" },
            ]
          : [{ player: self, role: "self" }];
    const zones = target.zones || (target.zone ? [target.zone] : []);
    let candidates = [];
    ownerEntries.forEach(({ player: owner, role }) => {
      zones.forEach((zone) => {
        candidates = candidates.concat(
          getZoneCards(owner, zone).map((card) => ({ card, role })),
        );
      });
    });
    const filtered = candidates
      .filter(({ card, role }) =>
        matchesTargetFilters(card, target, sourceCard, role)
      )
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

    const count = normalizeCount(target.count, 1);
    const min = count.min;
    const max = count.max;
    let pickCount = intent === "cost" ? min : max;
    if (min === 0 && intent !== "cost") {
      pickCount = 0;
    }
    result[target.id] = ordered.slice(0, Math.min(pickCount, ordered.length));
  });

  return result;
}

function removeCardFromZones(player, card) {
  if (!player || !card) return false;
  detachSimulatedEquip(card);
  if (Array.isArray(card.equips) && card.equips.length > 0) {
    card.equips.forEach((equip) => {
      if (!equip) return;
      equip.equippedTo = null;
      equip.equipTarget = null;
    });
  }
  const zones = [
    "hand",
    "field",
    "graveyard",
    "spellTrap",
    "banished",
    "deck",
    "extraDeck",
  ];
  for (const zone of zones) {
    const list = player[zone];
    if (!Array.isArray(list)) continue;
    const idx = list.indexOf(card);
    if (idx !== -1) {
      list.splice(idx, 1);
      return true;
    }
  }
  if (player.fieldSpell === card) {
    player.fieldSpell = null;
    return true;
  }
  return false;
}

function detachSimulatedEquip(equipCard) {
  if (!equipCard) return;
  const host = equipCard.equippedTo || equipCard.equipTarget || null;
  if (!host) return;

  if (Array.isArray(host.equips)) {
    host.equips = host.equips.filter((equip) => equip !== equipCard);
  }

  if (
    typeof equipCard.equipAtkBonus === "number" &&
    equipCard.equipAtkBonus !== 0
  ) {
    host.atk = Math.max(0, (host.atk || 0) - equipCard.equipAtkBonus);
  }
  if (
    typeof equipCard.equipDefBonus === "number" &&
    equipCard.equipDefBonus !== 0
  ) {
    host.def = Math.max(0, (host.def || 0) - equipCard.equipDefBonus);
  }
  if (
    typeof equipCard.equipExtraAttacks === "number" &&
    equipCard.equipExtraAttacks !== 0
  ) {
    host.extraAttacks = Math.max(
      0,
      (host.extraAttacks || 0) - equipCard.equipExtraAttacks,
    );
  }
  if (equipCard.grantsBattleIndestructible) {
    host.battleIndestructible = false;
  }

  equipCard.equippedTo = null;
  equipCard.equipTarget = null;
  equipCard.equipAtkBonus = 0;
  equipCard.equipDefBonus = 0;
  equipCard.equipExtraAttacks = 0;
  equipCard.grantsBattleIndestructible = false;
  equipCard.grantsCrescentShieldGuard = false;
}

function attachSimulatedEquip(equipCard, target, action = {}) {
  if (!equipCard || !target || target.cardKind !== "monster" || target.isFacedown) {
    return false;
  }

  detachSimulatedEquip(equipCard);
  equipCard.equippedTo = target;
  equipCard.equipTarget = target;
  if (!Array.isArray(target.equips)) target.equips = [];
  if (!target.equips.includes(equipCard)) target.equips.push(equipCard);

  if (Number.isFinite(action.atkBonus)) {
    equipCard.equipAtkBonus = action.atkBonus;
    target.atk = (target.atk || 0) + action.atkBonus;
  }
  if (Number.isFinite(action.defBonus)) {
    equipCard.equipDefBonus = action.defBonus;
    target.def = (target.def || 0) + action.defBonus;
  }
  if (Number.isFinite(action.extraAttacks) && action.extraAttacks !== 0) {
    equipCard.equipExtraAttacks = action.extraAttacks;
    target.extraAttacks = (target.extraAttacks || 0) + action.extraAttacks;
  }
  if (action.battleIndestructible) {
    equipCard.grantsBattleIndestructible = true;
    target.battleIndestructible = true;
  } else {
    equipCard.grantsBattleIndestructible = false;
  }
  equipCard.grantsCrescentShieldGuard = action.grantCrescentShieldGuard === true;
  return true;
}

export function moveCardToZone(player, card, zone) {
  if (!player || !card) return false;
  if (
    card.cardKind === "monster" &&
    Array.isArray(card.equips) &&
    card.equips.length > 0 &&
    zone !== "field"
  ) {
    const attachedEquips = card.equips.slice();
    card.equips = [];
    attachedEquips.forEach((equip) => {
      if (!equip) return;
      detachSimulatedEquip(equip);
      removeCardFromZones(player, equip);
      if (!Array.isArray(player.graveyard)) player.graveyard = [];
      player.graveyard.push(equip);
    });
  }
  removeCardFromZones(player, card);
  if (zone === "fieldSpell") {
    player.fieldSpell = card;
    return true;
  }
  if (!player[zone]) {
    player[zone] = [];
  }
  if (Array.isArray(player[zone])) {
    player[zone].push(card);
    return true;
  }
  return false;
}

function findCardOwner(state, card) {
  if (!state || !card) return null;
  const players = [state.bot, state.player];
  for (const player of players) {
    if (!player) continue;
    if (player.fieldSpell === card) return player;
    if (Array.isArray(player.field) && player.field.includes(card))
      return player;
    if (Array.isArray(player.hand) && player.hand.includes(card)) return player;
    if (Array.isArray(player.graveyard) && player.graveyard.includes(card)) {
      return player;
    }
    if (Array.isArray(player.spellTrap) && player.spellTrap.includes(card)) {
      return player;
    }
    if (Array.isArray(player.deck) && player.deck.includes(card)) return player;
    if (Array.isArray(player.banished) && player.banished.includes(card)) {
      return player;
    }
  }
  return null;
}

function getCounterValue(card, counterType = "counter") {
  if (!card) return 0;
  const key = counterType || "counter";
  const counters = card.counters;
  if (counters instanceof Map) return counters.get(key) || 0;
  if (counters && typeof counters === "object") {
    const upperKey = typeof key === "string" ? key.toUpperCase() : key;
    return counters[key] || counters[upperKey] || 0;
  }
  return 0;
}

function setCounterValue(card, counterType = "counter", value = 0) {
  if (!card) return;
  const key = counterType || "counter";
  const nextValue = Math.max(0, Math.floor(value || 0));
  if (card.counters instanceof Map) {
    card.counters.set(key, nextValue);
    return;
  }
  if (!card.counters || typeof card.counters !== "object") card.counters = {};
  card.counters[key] = nextValue;
}

function getStoredBlueprints(card) {
  const storage = card?.state?.blueprintStorage || card?.blueprintStorage;
  return (
    card?.storedBlueprints ||
    card?.blueprintStorageState?.storedBlueprints ||
    storage?.storedBlueprints ||
    card?.storedEffects ||
    []
  );
}

function hasOpenMonsterZone(player) {
  return (player?.field || []).length < 5;
}

function resolveActionPlayer(action, self, opponent) {
  return action.player === "opponent" ? opponent : self;
}

function getSimulatedOncePerTurnKey(effect, card) {
  return effect?.oncePerTurnName || effect?.id || card?.name || null;
}

function canUseSimulatedPassive(state, player, card, effect) {
  if (!effect?.oncePerTurn && !effect?.oncePerTurnName) return true;
  const key = getSimulatedOncePerTurnKey(effect, card);
  if (!key) return true;
  const currentTurn = state?.turnCounter || 0;
  const usage =
    effect.oncePerTurnScope === "card" || effect.oncePerTurnPerCard
      ? card?.oncePerTurnUsageByName || {}
      : player?.oncePerTurnUsageByName || {};
  if (usage[key] === currentTurn) return false;
  if (!state._simPassiveOncePerTurn) state._simPassiveOncePerTurn = new Set();
  const ownerKey = player?.id || (player === state?.bot ? "bot" : "player");
  const cardKey = card?.instanceId || card?.id || card?.name || "card";
  const simKey = `${ownerKey}:${cardKey}:${key}`;
  return !state._simPassiveOncePerTurn.has(simKey);
}

function markSimulatedPassiveUsed(state, player, card, effect) {
  if (!effect?.oncePerTurn && !effect?.oncePerTurnName) return;
  const key = getSimulatedOncePerTurnKey(effect, card);
  if (!key) return;
  if (!state._simPassiveOncePerTurn) state._simPassiveOncePerTurn = new Set();
  const ownerKey = player?.id || (player === state?.bot ? "bot" : "player");
  const cardKey = card?.instanceId || card?.id || card?.name || "card";
  state._simPassiveOncePerTurn.add(`${ownerKey}:${cardKey}:${key}`);
}

function resolveSimulatedLpCost({
  action,
  targetPlayer,
  self,
  opponent,
  state,
  options,
  baseAmount,
}) {
  const result = {
    finalAmount: baseAmount,
    appliedReducers: [],
  };
  if (!state || !targetPlayer || baseAmount <= 0) return result;

  const source = options.sourceCard || null;
  const boards = [self, opponent].filter(Boolean);
  const reducers = [];

  boards.forEach((board) => {
    const zoneCards = [
      ...(board.field || []),
      ...(board.spellTrap || []),
      board.fieldSpell,
    ].filter(Boolean);

    zoneCards.forEach((card) => {
      (card.effects || []).forEach((effect) => {
        if (!effect || effect.timing !== "passive") return;
        const passive = effect.passive;
        if (!passive || passive.type !== "lp_cost_reduction") return;
        if (effect.requireFaceup === true && card.isFacedown) return;
        if (card.isFacedown && effect.allowFacedown !== true && passive.allowFacedown !== true) {
          return;
        }

        const appliesTo = asArray(
          passive.appliesTo || passive.affects || passive.owner || "self",
        );
        const relation = board === targetPlayer ? "self" : "opponent";
        if (!appliesTo.includes("any") && !appliesTo.includes(relation)) return;

        const actionTypes = passive.actionTypes || passive.actionType;
        if (actionTypes && !asArray(actionTypes).includes(action.type)) return;

        if (passive.sourceFilters || passive.sourceFilter) {
          const filters = { ...(passive.sourceFilters || passive.sourceFilter) };
          if (filters.cardName && !filters.name) filters.name = filters.cardName;
          if (!source || !matchesTargetFilters(source, filters, source, relation)) {
            return;
          }
        }

        if (!canUseSimulatedPassive(state, board, card, effect)) return;
        const reduction = Number(passive.amount ?? passive.reduction ?? passive.value ?? 0);
        if (reduction <= 0) return;
        reducers.push({
          board,
          card,
          effect,
          reduction,
          stackMode: passive.stackMode || "max",
          minFinalAmount: Number(passive.minFinalAmount ?? passive.minAmount ?? 0),
        });
      });
    });
  });

  if (reducers.length === 0) return result;

  const sumReducers = reducers.filter((entry) => entry.stackMode === "sum");
  const maxReducer = reducers
    .filter((entry) => entry.stackMode !== "sum")
    .sort((a, b) => b.reduction - a.reduction)[0] || null;
  const appliedReducers = [...sumReducers];
  if (maxReducer) appliedReducers.push(maxReducer);

  const totalReduction = appliedReducers.reduce(
    (sum, entry) => sum + entry.reduction,
    0,
  );
  const minFinalAmount = appliedReducers.reduce(
    (max, entry) => Math.max(max, entry.minFinalAmount || 0),
    0,
  );
  result.finalAmount = Math.max(minFinalAmount, baseAmount - totalReduction);
  if (result.finalAmount < baseAmount) {
    result.appliedReducers = appliedReducers;
  }
  return result;
}

function resolveTargetsForAction(action, selections, options, opponent) {
  if (!action?.targetRef) return [];
  if (action.targetRef === "self") return [options.sourceCard].filter(Boolean);
  if (action.targetRef === "opponent_field") {
    return (opponent?.field || []).filter(
      (card) => card && card.cardKind === "monster" && !card.isFacedown,
    );
  }
  return selections[action.targetRef] || [];
}

function getActionCandidates(player, action = {}, zoneFallback = "deck") {
  const zones = asArray(action.zones || action.zone || zoneFallback);
  const filters = buildActionFilter(action);
  return zones.flatMap((zone) =>
    getZoneCards(player, zone).filter((card) =>
      matchesTargetFilters(card, filters, null)
    )
  );
}

function getStrategyRanker(options = {}) {
  return (
    options.rankSearchCandidates ||
    options.strategy?.rankSearchCandidates?.bind(options.strategy) ||
    null
  );
}

function getRecruitEvaluator(options = {}) {
  return (
    options.evaluateRecruitCandidate ||
    options.strategy?.evaluateRecruitCandidate?.bind(options.strategy) ||
    null
  );
}

function chooseRankedCards(candidates, intent, action, state, player, options) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const ctx = {
    game: state,
    player,
    source: options.sourceCard,
    action,
    activationContext: options.activationContext,
  };

  if (intent === "summon") {
    const evaluator = getRecruitEvaluator(options);
    if (typeof evaluator === "function") {
      const result = evaluator(candidates, {
        ...ctx,
        forceSummonAssessment: true,
      });
      if (Array.isArray(result?.scores)) {
        const pool = result.scores.some((entry) => !entry.blocked)
          ? result.scores.filter((entry) => !entry.blocked)
          : result.scores;
        return pool
          .slice()
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .map((entry) => entry.card)
          .filter(Boolean);
      }
      if (typeof result?.asBotSelect === "function") {
        return result.asBotSelect();
      }
      if (result?.best) return [result.best];
    }
  }

  const ranker = getStrategyRanker(options);
  if (intent !== "cost" && typeof ranker === "function") {
    const ranked = ranker(candidates, action, ctx);
    if (Array.isArray(ranked) && ranked.length > 0) return ranked;
  }

  const explicitTargetPreference = getTargetPreference(
    options,
    action.targetRef || action.id,
  );
  const targetPreference =
    intent === "cost"
      ? mergeCostPreference(explicitTargetPreference, getCostPreference(options))
      : explicitTargetPreference;

  return rankCandidates(candidates, intent === "summon" ? "benefit" : intent, {
    ...options,
    targetPreference,
  });
}

function chooseSpecialSummonPosition(card, action, state, player, options = {}) {
  if (action.position && action.position !== "choice") return action.position;
  const chooser =
    options.chooseSpecialSummonPosition ||
    options.strategy?.chooseSpecialSummonPosition?.bind(options.strategy);
  if (typeof chooser === "function") {
    const choice = chooser(card, {
      game: state,
      player,
      source: options.sourceCard,
      action,
      activationContext: options.activationContext,
    });
    if (choice === "attack" || choice === "defense") return choice;
  }
  return "attack";
}

function applySummonState(card, action, state, player, options = {}) {
  card.position = chooseSpecialSummonPosition(card, action, state, player, options);
  card.isFacedown = false;
  card.hasAttacked = false;
  card.attacksUsedThisTurn = 0;
  if (action.cannotAttackThisTurn) card.cannotAttackThisTurn = true;
  if (action.negateEffects) card.effectsNegated = true;
  if (action.setAtkToZeroAfterSummon) card.atk = 0;
  if (action.setDefToZeroAfterSummon) card.def = 0;
  if (Number.isFinite(action.atkBoostAfterSummon)) {
    card.tempAtkBoost =
      (card.tempAtkBoost || 0) + action.atkBoostAfterSummon;
  }
  if (Number.isFinite(action.defBoostAfterSummon)) {
    card.tempDefBoost =
      (card.tempDefBoost || 0) + action.defBoostAfterSummon;
  }
}

function pickCountForAction(action, fallback = 1) {
  const count = normalizeCount(action.count, fallback);
  return Math.max(0, count.max);
}

function conditionsArray(conditions) {
  if (!conditions) return [];
  return Array.isArray(conditions) ? conditions : [conditions];
}

function playerControlsMatching(player, condition = {}) {
  const zones = asArray(condition.zones || condition.zone || "field");
  const {
    type: _conditionType,
    owner: _owner,
    zone: _zone,
    zones: _zones,
    min: _min,
    reason: _reason,
    ...directFilters
  } = condition;
  const filters = condition.filters || directFilters;
  return zones.some((zone) =>
    getZoneCards(player, zone).some((card) =>
      matchesTargetFilters(card, filters, null)
    )
  );
}

export function evaluateSimulatedConditions(conditions, ctx = {}) {
  const list = conditionsArray(conditions);
  if (list.length === 0) return true;
  const state = ctx.state || ctx.game || {};
  const { self, opponent } = getPerspectivePlayers(state, ctx.selfId || "bot");
  const options = ctx.options || {};
  const custom =
    options.evaluateSimulatedConditions ||
    options.strategy?.evaluateSimulatedConditions?.bind(options.strategy);
  if (typeof custom === "function") {
    const result = custom(conditions, ctx);
    if (typeof result === "boolean") return result;
  }

  return list.every((condition) => {
    if (!condition) return true;
    if (condition.type === "any_of" || Array.isArray(condition.any_of)) {
      const optionsList = condition.conditions || condition.any_of || [];
      return optionsList.some((entry) =>
        evaluateSimulatedConditions(entry, ctx)
      );
    }
    const owner = condition.owner === "opponent" ? opponent : self;
    if (condition.type === "source_counters_at_least") {
      const sourceCard = ctx.sourceCard || options.sourceCard;
      return (
        getCounterValue(sourceCard, condition.counterType || "counter") >=
        (condition.min || 0)
      );
    }
    if (condition.type === "has_stored_blueprint") {
      const sourceCard = ctx.sourceCard || options.sourceCard;
      return getStoredBlueprints(sourceCard).length > 0;
    }
    if (condition.type === "empty_field" || condition.empty_field) {
      return (owner?.field || []).filter((card) => card?.cardKind === "monster")
        .length === 0;
    }
    if (condition.type === "control_card" || condition.control_card) {
      return playerControlsMatching(owner, condition);
    }
    if (
      condition.type === "control_card_filters" ||
      condition.control_card_filters
    ) {
      const {
        type: _conditionType,
        owner: _owner,
        zone: _zone,
        zones: _zones,
        min: _min,
        max: _max,
        reason: _reason,
        ...directFilters
      } = condition;
      const filters = {
        ...directFilters,
        ...(condition.control_card_filters || condition.filters || {}),
      };
      const zones = asArray(condition.zones || condition.zone || "field");
      const min = Number.isFinite(condition.min)
        ? condition.min
        : Number.isFinite(condition.max)
          ? 0
          : 1;
      const max = Number.isFinite(condition.max) ? condition.max : null;
      const count = zones.reduce(
        (sum, zone) =>
          sum +
          getZoneCards(owner, zone).filter((card) =>
            matchesTargetFilters(card, filters, null)
          ).length,
        0,
      );
      return count >= min && (max === null || count <= max);
    }
    if (condition.type === "control_card_max") {
      const zones = asArray(condition.zones || condition.zone || "field");
      const max = Number.isFinite(condition.max) ? condition.max : 0;
      const filters = condition.filters || {};
      const count = zones.reduce(
        (sum, zone) =>
          sum +
          getZoneCards(owner, zone).filter((card) =>
            matchesTargetFilters(card, filters, null)
          ).length,
        0,
      );
      return count <= max;
    }
    return true;
  });
}

function hasRequiredSelections(targets = [], selections = {}) {
  return (targets || []).every((target) => {
    if (!target?.id) return true;
    const { min } = normalizeCount(target.count, 1);
    if (min <= 0) return true;
    return (selections[target.id] || []).length >= min;
  });
}

export function applySimulatedActions({
  actions,
  selections,
  state,
  selfId = "bot",
  options = {},
}) {
  if (!Array.isArray(actions)) return;
  const { self, opponent } = getPerspectivePlayers(state, selfId);

  for (const action of actions) {
    if (!action || !action.type) continue;
    const targets = resolveTargetsForAction(action, selections, options, opponent);

    switch (action.type) {
      case "draw": {
        const targetPlayer = resolveActionPlayer(action, self, opponent);
        const amount = action.amount || 1;
        for (let i = 0; i < amount; i += 1) {
          const drawn = targetPlayer.deck?.shift?.();
          if (drawn) targetPlayer.hand.push(drawn);
        }
        break;
      }
      case "heal": {
        const targetPlayer = resolveActionPlayer(action, self, opponent);
        targetPlayer.lp += action.amount || 0;
        break;
      }
      case "heal_per_archetype_monster": {
        const targetPlayer = resolveActionPlayer(action, self, opponent);
        const archetype = action.archetype;
        const count = (targetPlayer.field || []).filter((card) =>
          hasArchetype(card, archetype)
        ).length;
        targetPlayer.lp += (action.amountPerMonster || 0) * count;
        break;
      }
      case "damage": {
        const targetPlayer = resolveActionPlayer(action, self, opponent);
        targetPlayer.lp -= action.amount || 0;
        break;
      }
      case "pay_lp": {
        const targetPlayer = resolveActionPlayer(action, self, opponent);
        const amount = Number.isFinite(action.amount)
          ? action.amount
          : Number.isFinite(action.lp)
            ? action.lp
            : 0;
        if (amount <= 0) break;
        const cost = resolveSimulatedLpCost({
          action,
          targetPlayer,
          self,
          opponent,
          state,
          options,
          baseAmount: amount,
        });
        const finalAmount = cost.finalAmount;
        if (
          finalAmount > 0 &&
          (targetPlayer.lp || 0) <= finalAmount &&
          action.allowSelfKO !== true
        ) {
          return;
        }
        targetPlayer.lp = Math.max(0, (targetPlayer.lp || 0) - finalAmount);
        cost.appliedReducers.forEach((reducer) => {
          markSimulatedPassiveUsed(state, reducer.board, reducer.card, reducer.effect);
        });
        break;
      }
      case "search_any": {
        const targetPlayer = resolveActionPlayer(action, self, opponent);
        const candidates = getActionCandidates(targetPlayer, action, "deck");
        const chosen = chooseRankedCards(
          candidates,
          "benefit",
          action,
          state,
          targetPlayer,
          options,
        )[0];
        if (!chosen) break;
        removeCardFromZones(targetPlayer, chosen);
        targetPlayer.hand.push(chosen);
        break;
      }
      case "add_from_zone_to_hand": {
        const targetPlayer = resolveActionPlayer(action, self, opponent);
        const candidates = getActionCandidates(targetPlayer, action, "graveyard");
        const pickCount = pickCountForAction(action, 1);
        const chosen = chooseRankedCards(
          candidates,
          "benefit",
          action,
          state,
          targetPlayer,
          options,
        ).slice(0, Math.min(pickCount, candidates.length));
        if (chosen.length === 0) break;
        chosen.forEach((card) => {
          removeCardFromZones(targetPlayer, card);
          targetPlayer.hand.push(card);
        });
        break;
      }
      case "special_summon_from_zone": {
        const targetPlayer = resolveActionPlayer(action, self, opponent);
        if (!hasOpenMonsterZone(targetPlayer)) break;
        let candidates = action.requireSource && options.sourceCard
          ? [options.sourceCard]
          : action.targetRef
            ? targets
            : null;
        if (!candidates || candidates.length === 0) {
          candidates = getActionCandidates(targetPlayer, action, "deck");
        }
        const max = Math.min(
          pickCountForAction(action, 1),
          candidates.length,
          5 - (targetPlayer.field || []).length,
        );
        const chosen = chooseRankedCards(
          candidates,
          "summon",
          action,
          state,
          targetPlayer,
          options,
        ).slice(0, max);
        if (action.banishCost && options.sourceCard) {
          const sourceOwner = findCardOwner(state, options.sourceCard) || targetPlayer;
          moveCardToZone(sourceOwner, options.sourceCard, "banished");
        }
        chosen.forEach((card) => {
          removeCardFromZones(targetPlayer, card);
          const fromZone = action.zone || "deck";
          applySummonState(card, action, state, targetPlayer, options);
          targetPlayer.field.push(card);
          options.onAfterSpecialSummon?.({
            state,
            player: targetPlayer,
            card,
            action,
            fromZone,
            sourceCard: options.sourceCard,
          });
        });
        break;
      }
      case "search_then_optional_special_summon_from_hand": {
        const targetPlayer = resolveActionPlayer(action, self, opponent);
        const candidates = getActionCandidates(targetPlayer, action, "deck");
        const searched = chooseRankedCards(
          candidates,
          "benefit",
          action,
          state,
          targetPlayer,
          options,
        )[0];
        if (!searched) break;
        removeCardFromZones(targetPlayer, searched);
        targetPlayer.hand.push(searched);

        const canSummon =
          hasOpenMonsterZone(targetPlayer) &&
          evaluateSimulatedConditions(action.summonCondition, {
            state,
            selfId,
            options,
          });
        if (!canSummon) break;

        removeCardFromZones(targetPlayer, searched);
        applySummonState(searched, action, state, targetPlayer, {
          ...options,
          action,
        });
        targetPlayer.field.push(searched);
        options.onAfterSpecialSummon?.({
          state,
          player: targetPlayer,
          card: searched,
          action,
          fromZone: "hand",
          sourceCard: options.sourceCard,
        });
        break;
      }
      case "special_summon_from_hand_with_cost": {
        const targetPlayer = resolveActionPlayer(action, self, opponent);
        if (!hasOpenMonsterZone(targetPlayer)) break;
        const sourceCard = options.sourceCard;
        if (!sourceCard || !targetPlayer.hand?.includes(sourceCard)) break;
        const costTargets = action.costTargetRef
          ? selections?.[action.costTargetRef] || []
          : targets;
        if (!Array.isArray(costTargets) || costTargets.length === 0) break;
        costTargets.forEach((card) => {
          if (!card) return;
          const owner = findCardOwner(state, card) || targetPlayer;
          moveCardToZone(owner, card, "graveyard");
        });
        removeCardFromZones(targetPlayer, sourceCard);
        applySummonState(sourceCard, action, state, targetPlayer, options);
        targetPlayer.field.push(sourceCard);
        options.onAfterSpecialSummon?.({
          state,
          player: targetPlayer,
          card: sourceCard,
          action,
          fromZone: "hand",
          sourceCard,
        });
        break;
      }
      case "special_summon_from_hand_with_tiered_cost": {
        const targetPlayer = resolveActionPlayer(action, self, opponent);
        if (!hasOpenMonsterZone(targetPlayer)) break;
        const sourceCard = options.sourceCard;
        if (!sourceCard || !targetPlayer.hand?.includes(sourceCard)) break;
        const minCost = Number.isFinite(action.minCost)
          ? action.minCost
          : normalizeCount(action.count, 1).min;
        const maxCost = Number.isFinite(action.maxCost)
          ? action.maxCost
          : Math.max(minCost, normalizeCount(action.count, minCost).max);
        const costFilter = action.costFilters || action.filters || {};
        const costPool = (targetPlayer.field || []).filter((card) =>
          matchesTargetFilters(card, costFilter, sourceCard, "self"),
        );
        if (costPool.length < minCost) break;
        const chosenCosts = chooseRankedCards(
          costPool,
          "cost",
          { ...action, targetRef: action.costTargetRef },
          state,
          targetPlayer,
          options,
        ).slice(0, Math.min(maxCost, costPool.length));
        if (chosenCosts.length < minCost) break;
        chosenCosts.forEach((card) => moveCardToZone(targetPlayer, card, "graveyard"));
        removeCardFromZones(targetPlayer, sourceCard);
        applySummonState(sourceCard, action, state, targetPlayer, options);
        if (Number.isFinite(action.tier1AtkBoost) && chosenCosts.length >= 1) {
          sourceCard.atk = Math.max(
            0,
            (sourceCard.atk || 0) + action.tier1AtkBoost,
          );
          sourceCard.tempAtkBoost =
            (sourceCard.tempAtkBoost || 0) + action.tier1AtkBoost;
        }
        if (chosenCosts.length >= 2) {
          sourceCard.cannotBeDestroyedByBattle = true;
          sourceCard._simBattleDestructionProtected = true;
        }
        targetPlayer.field.push(sourceCard);
        options.onAfterSpecialSummon?.({
          state,
          player: targetPlayer,
          card: sourceCard,
          action,
          fromZone: "hand",
          sourceCard,
          costCount: chosenCosts.length,
        });
        break;
      }
      case "bounce_and_summon": {
        const targetPlayer = resolveActionPlayer(action, self, opponent);
        if (!hasOpenMonsterZone(targetPlayer)) break;
        const sourceCard = options.sourceCard;
        if (!sourceCard || !targetPlayer.field?.includes(sourceCard)) break;
        if (action.bounceSource) {
          moveCardToZone(targetPlayer, sourceCard, "hand");
        }
        const candidates = getActionCandidates(targetPlayer, action, "hand")
          .filter((card) => card !== sourceCard);
        const chosen = chooseRankedCards(
          candidates,
          "summon",
          action,
          state,
          targetPlayer,
          options,
        )[0];
        if (!chosen) break;
        removeCardFromZones(targetPlayer, chosen);
        applySummonState(chosen, action, state, targetPlayer, options);
        targetPlayer.field.push(chosen);
        options.onAfterSpecialSummon?.({
          state,
          player: targetPlayer,
          card: chosen,
          action,
          fromZone: "hand",
          sourceCard,
        });
        break;
      }
      case "special_summon_token": {
        const targetPlayer = resolveActionPlayer(action, self, opponent);
        if ((targetPlayer.field || []).length >= 5) break;
        const token = action.token || { name: "Token", atk: 0, def: 0 };
        targetPlayer.field.push({
          ...token,
          cardKind: "monster",
          position: action.position || "attack",
          isFacedown: false,
          hasAttacked: false,
          attacksUsedThisTurn: 0,
          isToken: true,
        });
        break;
      }
      case "banish": {
        targets.forEach((card) => {
          const owner = findCardOwner(state, card);
          if (!owner) return;
          moveCardToZone(owner, card, "banished");
        });
        break;
      }
      case "return_to_hand": {
        targets.forEach((card) => {
          const owner = findCardOwner(state, card);
          if (!owner) return;
          moveCardToZone(owner, card, "hand");
        });
        break;
      }
      case "move": {
        targets.forEach((card) => {
          const owner = findCardOwner(state, card);
          if (!owner) return;
          const to = action.to || "graveyard";
          moveCardToZone(owner, card, to);
        });
        break;
      }
      case "destroy": {
        targets.forEach((card) => {
          const owner = findCardOwner(state, card);
          if (!owner) return;
          moveCardToZone(owner, card, "graveyard");
        });
        break;
      }
      case "destroy_and_damage_by_target_atk": {
        const entries = Array.isArray(action.entries) ? action.entries : [];
        const destroyed = entries.flatMap((entry) => {
          const entryTargets = resolveTargetsForAction(
            entry,
            selections,
            options,
            opponent,
          );
          return entryTargets.map((card) => ({
            card,
            owner: findCardOwner(state, card),
            damagePlayer: entry.damagePlayer || "owner",
            multiplier: Number.isFinite(entry.multiplier) ? entry.multiplier : 1,
            atk: getEffectiveAtk(card),
          }));
        });
        destroyed.forEach(({ card, owner }) => {
          if (owner) moveCardToZone(owner, card, "graveyard");
        });
        const skipDamage = (playerKey) => {
          const conditions = action.skipDamageIf?.[playerKey];
          if (!conditions) return false;
          return evaluateSimulatedConditions(conditions, {
            state,
            selfId,
            options,
          });
        };
        destroyed.forEach(({ owner, damagePlayer, multiplier, atk }) => {
          if (!owner) return;
          let recipient = null;
          if (damagePlayer === "self") recipient = self;
          else if (damagePlayer === "opponent") recipient = opponent;
          else recipient = owner;
          if (!recipient) return;
          const isSelf = recipient === self;
          if (skipDamage(isSelf ? "self" : "opponent")) return;
          recipient.lp = Math.max(
            0,
            (recipient.lp || 0) - Math.floor(Math.max(0, atk) * multiplier),
          );
        });
        break;
      }
      case "equip": {
        const equipCard = options.sourceCard || null;
        const target = targets[0] || null;
        attachSimulatedEquip(equipCard, target, action);
        break;
      }
      case "add_counter": {
        targets.forEach((card) => {
          const amount = Number.isFinite(action.amount) ? action.amount : 1;
          setCounterValue(
            card,
            action.counterType || "counter",
            getCounterValue(card, action.counterType || "counter") + amount,
          );
        });
        break;
      }
      case "remove_counter": {
        targets.forEach((card) => {
          const amount = Number.isFinite(action.amount) ? action.amount : 1;
          setCounterValue(
            card,
            action.counterType || "counter",
            getCounterValue(card, action.counterType || "counter") - amount,
          );
        });
        break;
      }
      case "buff_stats_temp": {
        targets.forEach((card) => {
          if (!card) return;
          if (Number.isFinite(action.atkBoost)) {
            card.tempAtkBoost = (card.tempAtkBoost || 0) + action.atkBoost;
            card.atk = Math.max(0, (card.atk || 0) + action.atkBoost);
          }
          if (Number.isFinite(action.defBoost)) {
            card.tempDefBoost = (card.tempDefBoost || 0) + action.defBoost;
            card.def = Math.max(0, (card.def || 0) + action.defBoost);
          }
        });
        break;
      }
      case "buff_atk_temp": {
        targets.forEach((card) => {
          if (!card) return;
          const amount = Number.isFinite(action.amount)
            ? action.amount
            : Number.isFinite(action.atkBoost)
              ? action.atkBoost
              : 0;
          if (amount !== 0) {
            card.tempAtkBoost = (card.tempAtkBoost || 0) + amount;
            card.atk = Math.max(0, (card.atk || 0) + amount);
          }
        });
        break;
      }
      case "forbid_attack_next_turn": {
        const turns = Number.isFinite(action.turns) ? action.turns : 1;
        targets.forEach((card) => {
          if (!card) return;
          card.cannotAttackThisTurn = true;
          card.cannotAttackUntilTurn = Math.max(
            card.cannotAttackUntilTurn || 0,
            (state.turnCounter || 0) + turns,
          );
          card._simCannotAttackByEffect = true;
        });
        break;
      }
      case "grant_protection": {
        targets.forEach((card) => {
          if (!card) return;
          if (action.protectionType === "effect_destruction") {
            card.cannotBeDestroyedByCardEffects = true;
            card._simEffectDestructionProtected = true;
          } else {
            card._simProtection = {
              type: action.protectionType || "generic",
              duration: action.duration || "temporary",
            };
          }
        });
        break;
      }
      case "register_replacement_effect": {
        if (!Array.isArray(state._simReplacementEffects)) {
          state._simReplacementEffects = [];
        }
        const targetIds = targets.map(getCardInstanceId).filter((id) => id !== null);
        const uniqueKey =
          action.uniqueKey ||
          `${options.sourceCard?.name || "source"}:${action.replacementEffect?.type || "replacement"}`;
        state._simReplacementEffects = state._simReplacementEffects.filter(
          (entry) => entry.uniqueKey !== uniqueKey || entry.playerId !== self.id,
        );
        state._simReplacementEffects.push({
          _sim: true,
          uniqueKey,
          playerId: self.id,
          sourceName: action.sourceName || options.sourceCard?.name || null,
          duration: action.duration || "temporary",
          targetRef: action.targetRef || null,
          targetInstanceIds: targetIds,
          uses: action.uses || null,
          usesPerTarget: action.usesPerTarget || null,
          replacementEffect: action.replacementEffect || null,
        });
        targets.forEach((card) => {
          if (!card) return;
          card._simReplacementProtection = {
            uniqueKey,
            duration: action.duration || "temporary",
            replacementEffect: action.replacementEffect || null,
          };
        });
        break;
      }
      case "modify_stats_temp": {
        targets.forEach((card) => {
          if (!card) return;
          if (Number.isFinite(action.atkFactor)) {
            const previousAtk = card.atk || 0;
            const newAtk = Math.floor(previousAtk * action.atkFactor);
            card.atk = newAtk;
            card.tempAtkBoost =
              (card.tempAtkBoost || 0) + newAtk - previousAtk;
          }
          if (Number.isFinite(action.defFactor)) {
            const previousDef = card.def || 0;
            const newDef = Math.floor(previousDef * action.defFactor);
            card.def = newDef;
            card.tempDefBoost =
              (card.tempDefBoost || 0) + newDef - previousDef;
          }
        });
        break;
      }
      case "modify_stats_temp_then_destroy_if_zeroed": {
        targets.forEach((card) => {
          if (!card) return;
          const previousAtk = card.atk || 0;
          const previousDef = card.def || 0;
          if (Number.isFinite(action.atkChange)) {
            const newAtk = Math.max(0, previousAtk + action.atkChange);
            card.atk = newAtk;
            card.tempAtkBoost = (card.tempAtkBoost || 0) + newAtk - previousAtk;
          }
          if (Number.isFinite(action.defChange)) {
            const newDef = Math.max(0, previousDef + action.defChange);
            card.def = newDef;
            card.tempDefBoost = (card.tempDefBoost || 0) + newDef - previousDef;
          }
          const atkZeroed =
            action.destroyIfAtkZeroedByThisEffect === true &&
            previousAtk > 0 &&
            (card.atk || 0) === 0;
          const defZeroed =
            action.destroyIfDefZeroedByThisEffect === true &&
            previousDef > 0 &&
            (card.def || 0) === 0;
          if (atkZeroed || defZeroed) {
            const owner = findCardOwner(state, card);
            if (owner) moveCardToZone(owner, card, "graveyard");
          }
        });
        break;
      }
      case "set_stats_to_zero_and_negate": {
        targets.forEach((card) => {
          if (!card) return;
          if (action.setAtkToZero) {
            card.atk = 0;
            card.tempAtkBoost = 0;
          }
          if (action.setDefToZero) {
            card.def = 0;
            card.tempDefBoost = 0;
          }
          if (action.negateEffects) {
            card.effectsNegated = true;
          }
        });
        break;
      }
      case "allow_direct_attack_this_turn": {
        targets.forEach((card) => {
          if (!card) return;
          card.canAttackDirectlyThisTurn = true;
        });
        break;
      }
      case "grant_additional_normal_summon": {
        const targetPlayer = resolveActionPlayer(action, self, opponent);
        targetPlayer.additionalNormalSummons =
          (targetPlayer.additionalNormalSummons || 0) +
          (Number.isFinite(action.count) ? action.count : 1);
        break;
      }
      case "polymerization_fusion_summon": {
        const targetPlayer = resolveActionPlayer(action, self, opponent);
        if (!hasOpenMonsterZone(targetPlayer)) break;
        const materialPool = rankCandidates([
          ...(targetPlayer.field || []),
          ...(targetPlayer.hand || []),
        ].filter((card) => card?.cardKind === "monster"), "cost", {
          ...options,
          fieldSpell: targetPlayer.fieldSpell,
          targetPreference: mergeCostPreference(
            getTargetPreference(options, action.targetRef || action.id),
            getCostPreference(options),
          ),
        });
        const canPayMaterials = (fusionCard) => {
          const remaining = materialPool.slice();
          const picked = [];
          for (const requirement of fusionCard.fusionMaterials || []) {
            const count = Number(requirement.count || 1);
            for (let i = 0; i < count; i += 1) {
              const index = remaining.findIndex((candidate) =>
                matchesTargetFilters(candidate, requirement, fusionCard, "self"),
              );
              if (index < 0) return null;
              picked.push(remaining[index]);
              remaining.splice(index, 1);
            }
          }
          return picked;
        };
        const fusionEntries = (targetPlayer.extraDeck || [])
          .filter((card) => card?.monsterType === "fusion")
          .map((fusionCard) => ({
            fusionCard,
            materials: canPayMaterials(fusionCard),
          }))
          .filter((entry) => Array.isArray(entry.materials));
        if (fusionEntries.length === 0) break;
        const hint = options.sourceAction?.fusionTargetHint;
        fusionEntries.sort((a, b) => {
          if (hint) {
            if (a.fusionCard.name === hint) return -1;
            if (b.fusionCard.name === hint) return 1;
          }
          return estimateMonsterValue(b.fusionCard) - estimateMonsterValue(a.fusionCard);
        });
        const { fusionCard, materials } = fusionEntries[0];
        materials.forEach((material) => moveCardToZone(targetPlayer, material, "graveyard"));
        removeCardFromZones(targetPlayer, fusionCard);
        applySummonState(
          fusionCard,
          { ...action, position: action.position || "attack" },
          state,
          targetPlayer,
          options,
        );
        fusionCard.summonMethod = "fusion";
        targetPlayer.field.push(fusionCard);
        options.onFusionSummon?.({
          state,
          player: targetPlayer,
          fusionCard,
          materials,
          action,
          sourceCard: options.sourceCard,
        });
        break;
      }
      case "add_status": {
        targets.forEach((card) => {
          if (!card) return;
          const status = action.status;
          if (status) {
            card[status] = action.value ?? true;
          }
        });
        break;
      }
      case "conditional_summon_from_hand": {
        const targetPlayer = resolveActionPlayer(action, self, opponent);
        if ((targetPlayer.field || []).length >= 5) break;
        if (
          action.condition &&
          !evaluateSimulatedConditions(action.condition, { state, selfId, options })
        ) break;
        const chosen = targets[0];
        if (chosen) {
          removeCardFromZones(targetPlayer, chosen);
          applySummonState(chosen, action, state, targetPlayer, options);
          targetPlayer.field.push(chosen);
        }
        break;
      }
      case "conditional_target_actions": {
        const sourceCard = options.sourceCard || null;
        const caseTargets = targets.length > 0 ? targets : [sourceCard].filter(Boolean);
        const matchesCase = (caseEntry) => {
          if (!caseEntry) return false;
          if (
            caseEntry.conditions &&
            !evaluateSimulatedConditions(caseEntry.conditions, {
              state,
              selfId,
              options,
              sourceCard,
            })
          ) {
            return false;
          }
          const filters = caseEntry.filters || caseEntry.filter;
          if (!filters || Object.keys(filters).length === 0) return true;
          const matchMode = action.matchMode === "all" ? "all" : "any";
          if (matchMode === "all") {
            return caseTargets.every((card) =>
              matchesTargetFilters(
                card,
                filters,
                sourceCard,
                findCardOwner(state, card) === self ? "self" : "opponent",
              )
            );
          }
          return caseTargets.some((card) =>
            matchesTargetFilters(
              card,
              filters,
              sourceCard,
              findCardOwner(state, card) === self ? "self" : "opponent",
            )
          );
        };
        const chosenCase = (action.cases || []).find(matchesCase);
        const nestedActions = chosenCase?.actions || action.defaultActions || [];
        if (nestedActions.length === 0) break;
        applySimulatedActions({
          actions: nestedActions,
          selections,
          state,
          selfId,
          options,
        });
        break;
      }
      case "activate_stored_blueprint": {
        const sourceCard = options.sourceCard;
        const blueprint = getStoredBlueprints(sourceCard)[0];
        const effect = blueprint?.effectSnapshot || blueprint?.effect || null;
        if (!effect) break;
        if (
          effect.conditions &&
          !evaluateSimulatedConditions(effect.conditions, {
            state,
            selfId,
            options,
            sourceCard,
          })
        ) {
          break;
        }
        const blueprintSelections = selectSimulatedTargets({
          targets: effect.targets || [],
          actions: effect.actions || [],
          state,
          sourceCard,
          selfId,
          options,
        });
        if (!hasRequiredSelections(effect.targets || [], blueprintSelections)) {
          break;
        }
        applySimulatedActions({
          actions: effect.actions || [],
          selections: blueprintSelections,
          state,
          selfId,
          options: {
            ...options,
            sourceCard,
            activationContext: {
              ...(options.activationContext || {}),
              blueprintSourceCardId: blueprint.sourceCardId,
              blueprintId: blueprint.blueprintId,
            },
          },
        });
        break;
      }
      case "choose_action_case": {
        const validCases = (action.cases || [])
          .map((choiceCase) => {
            if (!choiceCase) return null;
            if (
              choiceCase.conditions &&
              !evaluateSimulatedConditions(choiceCase.conditions, {
                state,
                selfId,
                options,
              })
            ) {
              return null;
            }
            const caseSelections = selectSimulatedTargets({
              targets: choiceCase.targets || [],
              actions: choiceCase.actions || [],
              state,
              sourceCard: options.sourceCard,
              selfId,
              options,
            });
            if (!hasRequiredSelections(choiceCase.targets || [], caseSelections)) {
              return null;
            }
            return { choiceCase, caseSelections };
          })
          .filter(Boolean);
        if (validCases.length === 0) break;

        const chooser =
          options.chooseActionCase ||
          options.strategy?.chooseActionCase?.bind(options.strategy);
        let chosenEntry = null;
        if (typeof chooser === "function") {
          const chosen = chooser(
            validCases.map((entry) => entry.choiceCase),
            {
              state,
              action,
              source: options.sourceCard,
              activationContext: options.activationContext,
            },
          );
          chosenEntry =
            validCases.find((entry) => entry.choiceCase === chosen) ||
            validCases.find((entry) => entry.choiceCase.id === chosen?.id) ||
            validCases.find((entry) => entry.choiceCase.id === chosen);
        }
        if (!chosenEntry) chosenEntry = validCases[0];

        applySimulatedActions({
          actions: chosenEntry.choiceCase.actions || [],
          selections: chosenEntry.caseSelections,
          state,
          selfId,
          options,
        });
        break;
      }
      case "shuffle_deck":
        break;
      default:
        if (!Array.isArray(state._simUnsupportedActions)) {
          state._simUnsupportedActions = [];
        }
        state._simUnsupportedActions.push(action.type);
        break;
    }
  }
}
