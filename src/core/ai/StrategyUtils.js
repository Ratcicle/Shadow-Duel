import {
  getBattleStatForAttackTarget,
  getEffectiveAtk,
  getEffectiveDef,
} from "./common/cardStats.js";

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

function matchesTargetFilters(card, target, sourceCard) {
  if (!card) return false;
  if (target.cardKind) {
    const kinds = Array.isArray(target.cardKind)
      ? target.cardKind
      : [target.cardKind];
    if (!kinds.includes(card.cardKind)) return false;
  }
  if (target.cardName && card.name !== target.cardName) return false;
  if (target.name && card.name !== target.name) return false;
  if (target.excludeCardName && card.name === target.excludeCardName) {
    return false;
  }
  if (target.requireThisCard && sourceCard && card.id !== sourceCard.id) {
    return false;
  }
  if (target.excludeSelf && sourceCard && card.id === sourceCard.id) {
    return false;
  }
  if (target.archetype && !hasArchetype(card, target.archetype)) return false;
  if (target.requireFaceup && card.isFacedown) return false;
  if (Number.isFinite(target.minLevel) && (card.level || 0) < target.minLevel) {
    return false;
  }
  if (Number.isFinite(target.maxLevel) && (card.level || 0) > target.maxLevel) {
    return false;
  }
  if (Number.isFinite(target.level)) {
    const level = card.level || 0;
    const op = target.levelOp || "eq";
    if (op === "eq" && level !== target.level) return false;
    if (op === "lte" && level > target.level) return false;
    if (op === "gte" && level < target.level) return false;
    if (op === "lt" && level >= target.level) return false;
    if (op === "gt" && level <= target.level) return false;
  }
  if (Number.isFinite(target.minAtk) && (card.atk || 0) < target.minAtk) {
    return false;
  }
  if (Number.isFinite(target.maxAtk) && (card.atk || 0) > target.maxAtk) {
    return false;
  }
  if (Number.isFinite(target.minDef) && (card.def || 0) < target.minDef) {
    return false;
  }
  if (Number.isFinite(target.maxDef) && (card.def || 0) > target.maxDef) {
    return false;
  }
  return true;
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

function rankCandidates(candidates, intent, options) {
  const scored = candidates.map((card) => ({
    card,
    score:
      intent === "benefit" && options?.targetPreference?.role === "recursion"
        ? estimateRecursionTargetValue(card, options.targetPreference)
        : intent === "benefit" &&
            options?.targetPreference?.role === "temporary_stat_buff" &&
            options?.targetPreference?.purpose === "offense"
          ? estimateOffensiveTemporaryBuffValue(card, {
              atkBoost: options.targetPreference.atkBoost,
              opponentField: options.opponentField,
              opponentLp: options.opponentLp,
            })
          : intent === "harm" &&
            options?.targetPreference?.role === "temporary_stat_debuff" &&
            options?.targetPreference?.purpose === "combat"
          ? estimateTemporaryCombatDebuffTargetValue(card, {
              attackers: options.targetPreference.attackers || [],
              opponentLp: options.opponentLp || 0,
              atkReduction: options.targetPreference.atkReduction,
              defReduction: options.targetPreference.defReduction,
              destroyIfAtkZeroedByThisEffect:
                options.targetPreference.destroyIfAtkZeroedByThisEffect,
              destroyIfDefZeroedByThisEffect:
                options.targetPreference.destroyIfDefZeroedByThisEffect,
            })
        : estimateCardValue(card, options),
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
    const owner = target.owner === "opponent" ? opponent : self;
    const zones = target.zones || (target.zone ? [target.zone] : []);
    let candidates = [];
    zones.forEach((zone) => {
      candidates = candidates.concat(getZoneCards(owner, zone));
    });
    candidates = candidates.filter((card) =>
      matchesTargetFilters(card, target, sourceCard)
    );

    const intent = intents.get(target.id) || "benefit";
    const ordered = rankCandidates(candidates, intent, {
      ...options,
      fieldSpell: self.fieldSpell,
    });

    const count = target.count || { min: 1, max: 1 };
    const min = Number.isFinite(count.min) ? count.min : 1;
    const max = Number.isFinite(count.max) ? count.max : min;
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
  const zones = ["hand", "field", "graveyard", "spellTrap", "banished"];
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

function moveCardToZone(player, card, zone) {
  if (!player || !card) return false;
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
  }
  return null;
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

  actions.forEach((action) => {
    if (!action || !action.type) return;
    const targets =
      action.targetRef && selections[action.targetRef]
        ? selections[action.targetRef]
        : [];

    switch (action.type) {
      case "draw": {
        const targetPlayer = action.player === "opponent" ? opponent : self;
        const amount = action.amount || 1;
        for (let i = 0; i < amount; i += 1) {
          targetPlayer.hand.push({ placeholder: true });
        }
        break;
      }
      case "heal": {
        const targetPlayer = action.player === "opponent" ? opponent : self;
        targetPlayer.lp += action.amount || 0;
        break;
      }
      case "heal_per_archetype_monster": {
        const targetPlayer = action.player === "opponent" ? opponent : self;
        const archetype = action.archetype;
        const count = (targetPlayer.field || []).filter((card) =>
          hasArchetype(card, archetype)
        ).length;
        targetPlayer.lp += (action.amountPerMonster || 0) * count;
        break;
      }
      case "damage": {
        const targetPlayer = action.player === "opponent" ? opponent : self;
        targetPlayer.lp -= action.amount || 0;
        break;
      }
      case "search_any": {
        const targetPlayer = action.player === "opponent" ? opponent : self;
        targetPlayer.hand.push({ placeholder: true });
        break;
      }
      case "add_from_zone_to_hand": {
        const targetPlayer = action.player === "opponent" ? opponent : self;
        const zone = action.zone || "graveyard";
        const source = getZoneCards(targetPlayer, zone);
        const filters = action.filters || {};
        const candidates = source.filter((card) =>
          matchesTargetFilters(card, filters, null)
        );
        const count = action.count || { min: 1, max: 1 };
        const min = Number.isFinite(count.min) ? count.min : 1;
        const max = Number.isFinite(count.max) ? count.max : min;
        const pickCount = min === 0 ? 0 : max;
        const chosen = rankCandidates(candidates, "benefit", options).slice(
          0,
          Math.min(pickCount, candidates.length)
        );
        if (chosen.length === 0) break;
        chosen.forEach((card) => {
          removeCardFromZones(targetPlayer, card);
          targetPlayer.hand.push(card);
        });
        break;
      }
      case "special_summon_from_zone": {
        const targetPlayer = action.player === "opponent" ? opponent : self;
        if ((targetPlayer.field || []).length >= 5) break;
        const zone = action.zone || "deck";
        const source = getZoneCards(targetPlayer, zone);
        const filters = action.filters || {};
        const candidates = source.filter((card) =>
          matchesTargetFilters(card, filters, null)
        );
        const count = action.count || { min: 1, max: 1 };
        const max = Number.isFinite(count.max) ? count.max : 1;
        const chosen = rankCandidates(candidates, "benefit", options).slice(
          0,
          Math.min(max, candidates.length, 5 - targetPlayer.field.length)
        );
        chosen.forEach((card) => {
          removeCardFromZones(targetPlayer, card);
          card.position = card.position || action.position || "attack";
          card.isFacedown = false;
          card.hasAttacked = false;
          card.attacksUsedThisTurn = 0;
          targetPlayer.field.push(card);
        });
        break;
      }
      case "special_summon_token": {
        const targetPlayer = action.player === "opponent" ? opponent : self;
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
      case "equip": {
        targets.forEach((card) => {
          if (!card) return;
          if (Number.isFinite(action.atkBonus)) {
            card.tempAtkBoost = (card.tempAtkBoost || 0) + action.atkBonus;
          }
          if (Number.isFinite(action.defBonus)) {
            card.tempDefBoost = (card.tempDefBoost || 0) + action.defBonus;
          }
        });
        break;
      }
      case "buff_stats_temp": {
        targets.forEach((card) => {
          if (!card) return;
          if (Number.isFinite(action.atkBoost)) {
            card.tempAtkBoost = (card.tempAtkBoost || 0) + action.atkBoost;
          }
          if (Number.isFinite(action.defBoost)) {
            card.tempDefBoost = (card.tempDefBoost || 0) + action.defBoost;
          }
        });
        break;
      }
      case "modify_stats_temp": {
        targets.forEach((card) => {
          if (!card) return;
          if (Number.isFinite(action.atkFactor)) {
            card.atk = Math.floor((card.atk || 0) * action.atkFactor);
          }
          if (Number.isFinite(action.defFactor)) {
            card.def = Math.floor((card.def || 0) * action.defFactor);
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
        const targetPlayer = action.player === "opponent" ? opponent : self;
        if ((targetPlayer.field || []).length >= 5) break;
        const condition = action.condition || {};
        if (
          condition.type === "control_card" &&
          condition.zone === "fieldSpell"
        ) {
          if (!targetPlayer.fieldSpell) break;
          if (
            condition.cardName &&
            targetPlayer.fieldSpell.name !== condition.cardName
          ) {
            break;
          }
        }
        const chosen = targets[0];
        if (chosen) {
          removeCardFromZones(targetPlayer, chosen);
          chosen.position = action.position || "attack";
          chosen.isFacedown = false;
          chosen.hasAttacked = false;
          chosen.attacksUsedThisTurn = 0;
          targetPlayer.field.push(chosen);
        }
        break;
      }
      default:
        break;
    }
  });
}
