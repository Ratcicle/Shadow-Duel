import {
  getBattleStatForAttackTarget,
  getEffectiveAtk,
  getEffectiveDef,
  getPiercingDamage,
} from "./cardStats.js";
import { cardMatchesFilter } from "./cardFilters.js";
import {
  estimateCardValue,
  estimateMonsterValue,
  isBattleReadyAttacker,
} from "./cardValue.js";
import { getPerspectivePlayers } from "./perspective.js";
import { getZoneCards } from "./zones.js";

export function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function normalizeCount(count, fallback = 1) {
  if (Number.isFinite(count)) {
    return { min: count, max: count };
  }
  const min = Number.isFinite(count?.min) ? count.min : fallback;
  const max = Number.isFinite(count?.max) ? count.max : min;
  return { min, max };
}

export function getCardInstanceId(card) {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uid ??
    card?.uuid ??
    card?.simInstanceId ??
    null
  );
}

export function getTargetPreference(options = {}, targetId = null) {
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

export function getCostPreference(options = {}) {
  return (
    options.costPreferences ||
    options.actionContext?.costPreferences ||
    options.activationContext?.actionContext?.costPreferences ||
    options.activationContext?.costPreferences ||
    null
  );
}

export function mergeCostPreference(targetPreference, costPreference) {
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

export function buildActionFilter(action = {}) {
  const filter = { ...(action.filters || {}) };
  [
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
    "sentToGraveAsMaterial",
    "sentAsMaterial",
    "lastSentToGraveAsMaterial",
    "sentToGraveAsMaterialThisTurn",
    "sentAsMaterialThisTurn",
    "sentToGraveAsMaterialTurn",
    "sentAsMaterialTurn",
  ].forEach((key) => {
    if (action[key] !== undefined && filter[key] === undefined) {
      filter[key] = action[key];
    }
  });
  return filter;
}

export function matchesTargetFilters(card, target = {}, sourceCard, ownerRole = null) {
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
  const {
    owner: _owner,
    anyOf: _anyOf,
    id: _targetId,
    targetFromContext: _targetFromContext,
    ...filters
  } = target;
  return cardMatchesFilter(card, filters);
}

function inferTargetIntent(action) {
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

export function rankCandidates(candidates, intent, options = {}) {
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
}) {
  const result = {};
  if (!Array.isArray(targets) || targets.length === 0) return result;
  const { self, opponent } = getPerspectivePlayers(state, selfId);
  const intents = buildTargetIntents(actions || []);

  targets.forEach((target) => {
    if (!target || !target.id) return;
    if (target.targetFromContext) {
      const contextValue =
        options?.[target.targetFromContext] ||
        options?.actionContext?.[target.targetFromContext] ||
        options?.activationContext?.actionContext?.[target.targetFromContext] ||
        null;
      const contextCards = asArray(contextValue).filter((card) =>
        matchesTargetFilters(card, target, sourceCard),
      );
      const count = normalizeCount(target.count, 1);
      result[target.id] = contextCards.slice(
        0,
        Math.min(count.max, contextCards.length),
      );
      return;
    }
    const excludeTargetRefs = [
      target.excludeTargetRef,
      ...asArray(target.excludeTargetRefs),
    ].filter(Boolean);
    const excludedCards = excludeTargetRefs.flatMap((ref) =>
      Array.isArray(result[ref])
        ? result[ref]
        : result[ref]
          ? [result[ref]]
          : [],
    );
    const excludedInstanceIds = excludedCards
      .map(getCardInstanceId)
      .filter((value) => value !== undefined && value !== null);
    const effectiveTarget =
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
    const ownerEntries =
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
        matchesTargetFilters(card, effectiveTarget, sourceCard, role)
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

