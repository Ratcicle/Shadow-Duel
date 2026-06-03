import {
  buildFieldSelectionCandidates,
  getUI,
  selectCards,
} from "../../actionHandlers/shared.js";
import { isAI } from "../../Player.js";

/**
 * Counter Actions - add/remove counters
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Apply add counter action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether counters were added
 */
function resolveCounterOwner(game, card, fallbackPlayer) {
  if (fallbackPlayer?.id === "player" || fallbackPlayer?.id === "bot") {
    return fallbackPlayer;
  }
  const owner = card?.controller || card?.owner;
  if (owner === "player") return game?.player || "player";
  if (owner === "bot") return game?.bot || "bot";
  return fallbackPlayer || null;
}

function emitCounterEvent(engine, data = {}) {
  const game = engine?.game;
  const tracker = game?._arenaTracker;
  if (!tracker || typeof tracker.recordEvent !== "function") return;
  tracker.recordEvent(
    "counter_changed",
    {
      player: resolveCounterOwner(game, data.card, data.ctx?.player),
      card: data.card,
      sourceCard: data.ctx?.source,
      source: data.ctx?.source,
      effectId: data.ctx?.effect?.id || data.ctx?.effectId || null,
      counterType: data.counterType,
      amount: data.amount,
      action: data.action,
      result: data.result,
    },
    { turn: game?.turnCounter },
  );
}

export function applyAddCounter(action, ctx, targets) {
  const counterType = action.counterType || "default";
  let amount = action.amount || 1;
  const targetRef = action.targetRef || "self";

  // If damagePerCounter is specified, calculate amount based on damage
  if (action.damagePerCounter && ctx.damageAmount !== undefined) {
    // Add 1 counter per damage instance that meets the threshold.
    amount = ctx.damageAmount >= action.damagePerCounter ? 1 : 0;
    if (amount <= 0) return false;
  }

  let targetCards = [];
  if (targetRef === "self") {
    targetCards = [ctx.source];
  } else if (targets[targetRef]) {
    targetCards = targets[targetRef];
  }

  if (!Array.isArray(targetCards)) {
    targetCards = [targetCards];
  }

  let added = false;
  for (const card of targetCards) {
    if (card && typeof card.addCounter === "function") {
      card.addCounter(counterType, amount);
      const after =
        typeof card.getCounter === "function" ? card.getCounter(counterType) : null;
      console.log(`Added ${amount} ${counterType} counter(s) to ${card.name}`);
      emitCounterEvent(this, {
        card,
        ctx,
        counterType,
        amount,
        action: "add",
        result: after,
      });
      added = true;
    }
  }

  if (added && this.game && typeof this.game.updateBoard === "function") {
    this.game.updateBoard();
  }

  if (added && this.ui?.log) {
    this.ui.log(
      `Added ${amount} ${counterType} counter(s) to ${
        targetCards[0]?.name || ctx.source?.name || "card"
      }.`,
    );
  }

  return added;
}

/**
 * Apply remove counter action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether counters were removed
 */
export function applyRemoveCounter(action, ctx, targets) {
  const counterType = action.counterType || "default";
  const amount = Number.isFinite(action.amount) ? action.amount : 1;
  const targetRef = action.targetRef || "self";
  const allowBelow = action.allowBelow === true;

  let targetCards = [];
  if (targetRef === "self") {
    targetCards = [ctx.source];
  } else if (targets[targetRef]) {
    targetCards = targets[targetRef];
  }

  if (!Array.isArray(targetCards)) {
    targetCards = [targetCards];
  }

  let removed = false;
  for (const card of targetCards) {
    if (!card || typeof card.getCounter !== "function") continue;
    const current = card.getCounter(counterType);
    if (current <= 0) continue;
    if (!allowBelow && current < amount) continue;
    const removeAmount = allowBelow ? Math.min(current, amount) : amount;
    if (typeof card.removeCounter === "function") {
      card.removeCounter(counterType, removeAmount);
      const after =
        typeof card.getCounter === "function" ? card.getCounter(counterType) : null;
      console.log(
        `Removed ${removeAmount} ${counterType} counter(s) from ${card.name}`,
      );
      emitCounterEvent(this, {
        card,
        ctx,
        counterType,
        amount: removeAmount,
        action: "remove",
        result: after,
      });
      removed = true;
    }
  }

  if (removed && this.game && typeof this.game.updateBoard === "function") {
    this.game.updateBoard();
  }

  if (removed && this.ui?.log) {
    this.ui.log(
      `Removed ${amount} ${counterType} counter(s) from ${
        targetCards[0]?.name || ctx.source?.name || "card"
      }.`,
    );
  }

  return removed;
}

function getCounterValue(card, counterType) {
  if (!card || typeof card.getCounter !== "function") return 0;
  return Math.max(0, Number(card.getCounter(counterType) || 0));
}

function getCounterFieldOwners(game, ctx, ownerRule = "self") {
  const player = ctx?.player || null;
  const opponent = ctx?.opponent || game?.getOpponent?.(player) || null;

  if (ownerRule === "opponent") return opponent ? [opponent] : [];
  if (ownerRule === "any" || ownerRule === "both") {
    return [player, opponent].filter(Boolean);
  }
  return player ? [player] : [];
}

function getZoneCards(owner, zoneKey) {
  if (!owner || !zoneKey) return [];
  if (zoneKey === "fieldSpell") {
    return owner.fieldSpell ? [owner.fieldSpell] : [];
  }
  return Array.isArray(owner[zoneKey]) ? owner[zoneKey] : [];
}

function collectCounterFieldEntries(engine, action, ctx) {
  const game = engine?.game;
  const counterType = action.counterType || "default";
  const ownerRule = action.owner || action.player || "self";
  const zones =
    Array.isArray(action.zones) && action.zones.length > 0
      ? action.zones
      : [action.zone || "field"];
  const filters = action.filters || {};
  const hasFilters = Object.keys(filters).length > 0;
  const requireFaceup = action.requireFaceup === true;
  const entries = [];

  for (const owner of getCounterFieldOwners(game, ctx, ownerRule)) {
    for (const zoneKey of zones) {
      for (const card of getZoneCards(owner, zoneKey)) {
        if (!card) continue;
        if (requireFaceup && card.isFacedown) continue;
        if (
          hasFilters &&
          typeof engine.cardMatchesFilters === "function" &&
          !engine.cardMatchesFilters(card, filters)
        ) {
          continue;
        }
        const counterCount = getCounterValue(card, counterType);
        if (counterCount <= 0) continue;
        entries.push({ owner, card, zone: zoneKey, counterCount });
      }
    }
  }

  return entries;
}

function decorateCounterEntries(game, entries) {
  const groups = new Map();

  for (const entry of entries) {
    if (!entry?.owner || !entry.card) continue;
    if (!groups.has(entry.owner)) groups.set(entry.owner, []);
    groups.get(entry.owner).push(entry.card);
  }

  const candidates = [];
  for (const [owner, cards] of groups.entries()) {
    candidates.push(
      ...buildFieldSelectionCandidates(owner, game, cards, {
        ownerLabel: owner.id,
      }),
    );
  }

  return candidates;
}

function chooseGreedyCounterEntries(entries, amount) {
  const selected = [];
  let remaining = amount;

  for (const entry of entries) {
    if (remaining <= 0) break;
    selected.push(entry.card);
    remaining -= Math.max(1, Math.min(entry.counterCount, remaining));
  }

  return remaining <= 0 ? selected : [];
}

async function selectCounterPaymentCards(engine, action, ctx, entries, amount) {
  const game = engine?.game;
  const player = ctx?.player;
  if (!game || !player) return [];

  if (entries.length === 0) return [];
  if (entries.length === 1 || isAI(player)) {
    return chooseGreedyCounterEntries(entries, amount);
  }

  const candidates = decorateCounterEntries(game, entries);
  const requirementId = action.requirementId || "counter_payment";
  const maxSelect = Math.min(entries.length, amount);
  const selectionContract = {
    kind: "cost",
    message:
      action.selectionMessage ||
      `Select card(s) to remove ${amount} ${action.counterType || "default"} counter(s).`,
    requirements: [
      {
        id: requirementId,
        min: 1,
        max: maxSelect,
        zones:
          Array.isArray(action.zones) && action.zones.length > 0
            ? action.zones
            : [action.zone || "field"],
        owner: action.owner || action.player || "self",
        filters: action.filters || {},
        allowSelf: true,
        distinct: true,
        candidates,
      },
    ],
    ui: { useFieldTargeting: true },
    metadata: { context: "counter_payment" },
  };

  const selectedKeys = await selectCards({
    game,
    player,
    selectionContract,
    requirementId,
    kind: "cost",
    autoSelectorOptions: {
      owner: player,
      activationContext: ctx?.activationContext,
      selectionKind: "cost",
    },
    autoSelectKeys: () =>
      chooseGreedyCounterEntries(entries, amount)
        .map((card) => candidates.find((candidate) => candidate.cardRef === card)?.key)
        .filter(Boolean),
  });

  if (selectedKeys === null) {
    getUI(game)?.log("Counter payment cancelled.");
    return [];
  }

  return selectedKeys
    .map((key) => candidates.find((candidate) => candidate.key === key)?.cardRef)
    .filter(Boolean);
}

/**
 * Remove counters from a pool of cards on the field.
 *
 * This generic cost-style action can remove counters across one or more cards,
 * using field targeting when a human player needs to choose the payment source.
 */
export async function applyRemoveCountersFromField(action, ctx) {
  const game = this?.game;
  const counterType = action.counterType || "default";
  const amount = Math.max(1, Number(action.amount ?? action.count ?? 1));
  const entries = collectCounterFieldEntries(this, action, ctx);
  const totalAvailable = entries.reduce(
    (sum, entry) => sum + entry.counterCount,
    0,
  );

  if (totalAvailable < amount) {
    getUI(game)?.log(
      `Not enough ${counterType} counters on the field to pay the cost.`,
    );
    return false;
  }

  const selectedCards = await selectCounterPaymentCards(
    this,
    action,
    ctx,
    entries,
    amount,
  );
  const selectedEntries = selectedCards
    .map((card) => entries.find((entry) => entry.card === card))
    .filter(Boolean);
  const selectedTotal = selectedEntries.reduce(
    (sum, entry) => sum + entry.counterCount,
    0,
  );

  if (selectedTotal < amount) {
    getUI(game)?.log(
      `Select enough cards to remove ${amount} ${counterType} counter(s).`,
    );
    return false;
  }

  let remaining = amount;
  let removed = false;

  for (const entry of selectedEntries) {
    if (remaining <= 0) break;
    const card = entry.card;
    const current = getCounterValue(card, counterType);
    if (current <= 0 || typeof card.removeCounter !== "function") continue;

    const firstPassAmount = Math.min(1, current, remaining);
    card.removeCounter(counterType, firstPassAmount);
    remaining -= firstPassAmount;
    removed = true;
    emitCounterEvent(this, {
      card,
      ctx,
      counterType,
      amount: firstPassAmount,
      action: "remove",
      result: getCounterValue(card, counterType),
    });
    getUI(game)?.log(
      `Removed ${firstPassAmount} ${counterType} counter(s) from ${card.name}.`,
    );
  }

  for (const entry of selectedEntries) {
    if (remaining <= 0) break;
    const card = entry.card;
    const current = getCounterValue(card, counterType);
    if (current <= 0 || typeof card.removeCounter !== "function") continue;

    const removeAmount = Math.min(current, remaining);
    card.removeCounter(counterType, removeAmount);
    remaining -= removeAmount;
    removed = true;
    emitCounterEvent(this, {
      card,
      ctx,
      counterType,
      amount: removeAmount,
      action: "remove",
      result: getCounterValue(card, counterType),
    });
    getUI(game)?.log(
      `Removed ${removeAmount} ${counterType} counter(s) from ${card.name}.`,
    );
  }

  if (remaining > 0) return false;

  if (removed && game && typeof game.updateBoard === "function") {
    game.updateBoard();
  }

  return removed;
}
