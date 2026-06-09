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
  if (action.targetRef === "opponent_field") {
    return (opponent?.field || []).filter(
      (card) => card && card.cardKind === "monster" && !card.isFacedown,
    );
  }
  return selections[action.targetRef] || [];
}

export function getActionCandidates(player, action = {}, zoneFallback = "deck") {
  const zones = asArray(action.zones || action.zone || zoneFallback);
  const filters = buildActionFilter(action);
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

export function applySummonState(card, action, state, player, options = {}) {
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

