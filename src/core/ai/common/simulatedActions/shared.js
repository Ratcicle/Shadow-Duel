import {
  asArray,
  buildActionFilter,
  getCostPreference,
  getTargetPreference,
  matchesTargetFilters,
  mergeCostPreference,
  normalizeCount,
  rankCandidates,
} from "../targetSelection.js";
import { getZoneCards } from "../zones.js";

export const STOP_SIMULATION = Symbol("STOP_SIMULATION");

export function hasOpenMonsterZone(player) {
  return (player?.field || []).length < 5;
}

export function resolveActionPlayer(action, self, opponent) {
  return action.player === "opponent" ? opponent : self;
}

export function getSimulatedOncePerTurnKey(effect, card) {
  return effect?.oncePerTurnName || effect?.id || card?.name || null;
}

export function canUseSimulatedPassive(state, player, card, effect) {
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

export function markSimulatedPassiveUsed(state, player, card, effect) {
  if (!effect?.oncePerTurn && !effect?.oncePerTurnName) return;
  const key = getSimulatedOncePerTurnKey(effect, card);
  if (!key) return;
  if (!state._simPassiveOncePerTurn) state._simPassiveOncePerTurn = new Set();
  const ownerKey = player?.id || (player === state?.bot ? "bot" : "player");
  const cardKey = card?.instanceId || card?.id || card?.name || "card";
  state._simPassiveOncePerTurn.add(`${ownerKey}:${cardKey}:${key}`);
}

export function resolveSimulatedLpCost({
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

export function resolveTargetsForAction(action, selections, options, opponent) {
  if (!action?.targetRef) return [];
  if (action.targetRef === "self") return [options.sourceCard].filter(Boolean);
  if (action.targetRef === "ascension_material") {
    return resolveSimulatedAscensionMaterials(options);
  }
  if (
    action.targetRef === "battle_self_participant" ||
    action.targetRef === "battle_opponent_participant"
  ) {
    const selfId = options.selfId || "bot";
    const expectedId =
      action.targetRef === "battle_opponent_participant"
        ? opponent?.id || (selfId === "bot" ? "player" : "bot")
        : selfId;
    const expectedPlayer =
      expectedId === opponent?.id ? opponent : options.self || null;
    const matchesOwner = (card, ownerId) =>
      !!card &&
      ((Array.isArray(expectedPlayer?.field) &&
        expectedPlayer.field.includes(card)) ||
        card.controller === ownerId ||
        card.owner === ownerId);
    const attacker =
      options.attacker || options.actionContext?.attacker || null;
    const defender =
      options.defender ||
      options.target ||
      options.actionContext?.defender ||
      options.actionContext?.target ||
      null;
    if (matchesOwner(attacker, expectedId)) return [attacker];
    if (matchesOwner(defender, expectedId)) return [defender];
    return [];
  }
  if (action.targetRef === "opponent_field") {
    return (opponent?.field || []).filter(
      (card) => card && card.cardKind === "monster" && !card.isFacedown,
    );
  }
  return selections[action.targetRef] || [];
}

function getSimCardInstanceId(card) {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? card?.simInstanceId ?? null;
}

function resolveSimulatedAscensionMaterials(options = {}) {
  const source = options.sourceCard || options.actionContext?.source || null;
  const self = options.self || null;
  const graveyard = Array.isArray(self?.graveyard) ? self.graveyard : [];
  const materials = Array.isArray(source?.ascensionMaterials)
    ? source.ascensionMaterials
    : [];
  const materialInstanceIds = new Set(
    materials
      .map((entry) => entry?.instanceId)
      .filter((value) => value !== undefined && value !== null),
  );
  if (materialInstanceIds.size === 0) return [];
  return graveyard.filter((card) =>
    materialInstanceIds.has(getSimCardInstanceId(card)),
  );
}

export function storeSimActionResult(
  action,
  selections,
  options,
  cards,
  fallbackKey = null,
) {
  const resultKey = action?.resultRef || action?.storeResultAs || fallbackKey;
  if (!resultKey) return;
  const storedCards = Array.isArray(cards) ? cards.filter(Boolean) : [];
  if (selections && typeof selections === "object") {
    selections[resultKey] = storedCards;
  }
  if (options && typeof options === "object") {
    if (!options.actionResults || typeof options.actionResults !== "object") {
      options.actionResults = {};
    }
    options.actionResults[resultKey] = storedCards;
  }
}

function getContextPathValue(ctx, path) {
  if (!ctx || typeof path !== "string" || !path) return undefined;
  if (!path.includes(".")) return ctx[path];
  return path
    .split(".")
    .filter(Boolean)
    .reduce((value, key) => (value == null ? undefined : value[key]), ctx);
}

function resolveNumberFromContext(ref, options = {}) {
  if (ref === undefined || ref === null) return null;
  if (Number.isFinite(Number(ref))) return Number(ref);
  const key =
    typeof ref === "string"
      ? ref
      : ref.key || ref.contextKey || ref.path || ref.resultKey || null;
  const fallback =
    typeof ref === "object" && ref !== null
      ? ref.defaultValue ?? ref.default ?? ref.fallback
      : undefined;
  const context =
    options.actionContext ||
    options.activationContext?.actionContext ||
    options.activationContext ||
    {};
  const rawValue = getContextPathValue(context, key);
  const value = rawValue === undefined ? fallback : rawValue;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : null;
}

function applyContextMaxLevelFilter(filters, action, options) {
  const maxLevel = resolveNumberFromContext(action?.maxLevelFromContext, options);
  if (!Number.isFinite(maxLevel)) return;
  filters.maxLevel = Number.isFinite(filters.maxLevel)
    ? Math.min(filters.maxLevel, maxLevel)
    : maxLevel;
}

export function getActionCandidates(
  player,
  action = {},
  zoneFallback = "deck",
  options = {},
) {
  const zones = asArray(action.zones || action.zone || zoneFallback);
  const filters = buildActionFilter(action);
  applyContextMaxLevelFilter(filters, action, options);
  return zones.flatMap((zone) =>
    getZoneCards(player, zone).filter((card) =>
      matchesTargetFilters(card, filters, null)
    )
  );
}

export function getStrategyRanker(options = {}) {
  return (
    options.rankSearchCandidates ||
    options.strategy?.rankSearchCandidates?.bind(options.strategy) ||
    null
  );
}

export function getRecruitEvaluator(options = {}) {
  return (
    options.evaluateRecruitCandidate ||
    options.strategy?.evaluateRecruitCandidate?.bind(options.strategy) ||
    null
  );
}

export function chooseRankedCards(candidates, intent, action, state, player, options) {
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

export function chooseSpecialSummonPosition(card, action, state, player, options = {}) {
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

function normalizeNegateEffectsDuration(action = {}) {
  return action.negateEffectsDuration === "while_faceup"
    ? "while_faceup"
    : "until_end_turn";
}

function assignSimulatedFieldPresenceId(card, state) {
  if (!card) return;
  if (state && typeof state === "object") {
    state._simFieldPresenceSeq = Number(state._simFieldPresenceSeq || 0) + 1;
    card.fieldPresenceId = `sim_fp_${card.id || "card"}_${state.turnCounter || 0}_${state._simFieldPresenceSeq}`;
    return;
  }
  card.fieldPresenceId = `sim_fp_${card.id || "card"}_0`;
}

export function applySummonState(card, action, state, player, options = {}) {
  assignSimulatedFieldPresenceId(card, state);
  card.position = chooseSpecialSummonPosition(card, action, state, player, options);
  card.isFacedown = false;
  card.hasAttacked = false;
  card.attacksUsedThisTurn = 0;
  if (action.cannotAttackThisTurn) card.cannotAttackThisTurn = true;
  if (action.destroySummonedAtEndPhase) {
    card.destroyAtEndPhase = true;
    card.destroyAtEndPhaseTurn = state?.turnCounter ?? null;
    card.destroyAtEndPhaseSource = options?.sourceCard?.name || null;
  }
  if (action.negateEffects) {
    card.effectsNegated = true;
    card.effectsNegatedDuration = normalizeNegateEffectsDuration(action);
  }
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
  const statusesOnSummon = Array.isArray(action.statusesOnSummon)
    ? action.statusesOnSummon
    : action.statusesOnSummon
      ? [action.statusesOnSummon]
      : [];
  for (const entry of statusesOnSummon) {
    if (!entry) continue;
    const status =
      typeof entry === "string"
        ? entry
        : typeof entry.status === "string"
          ? entry.status
          : null;
    if (!status) continue;
    card[status] =
      typeof entry === "object" &&
      Object.prototype.hasOwnProperty.call(entry, "value")
        ? entry.value
        : true;
  }
}

export function pickCountForAction(action, fallback = 1) {
  const count = normalizeCount(action.count, fallback);
  return Math.max(0, count.max);
}

export function hasRequiredSelections(targets = [], selections = {}) {
  return (targets || []).every((target) => {
    if (!target?.id) return true;
    const { min } = normalizeCount(target.count, 1);
    if (min <= 0) return true;
    return (selections[target.id] || []).length >= min;
  });
}

