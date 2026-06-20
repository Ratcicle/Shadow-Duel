import {
  buildFieldSelectionCandidates,
  getUI,
  resolveFieldScopeCards,
  selectCards,
} from "../../actionHandlers/shared.js";
import { cardMatchesKind } from "../../Card.js";
import { isAI } from "../../Player.js";
import { getCounterDisplayLabel, getUIText } from "../../i18n.js";

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

function getCounterTextParams(counterType, amount, extra = {}) {
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const counterLabel = getCounterDisplayLabel(counterType, value);
  return {
    ...extra,
    amount: value,
    counterType,
    counterLabel,
  };
}

function getCounterLogMessage(key, counterType, amount, params = {}) {
  return getUIText(
    `ui.counters.${key}`,
    getCounterTextParams(counterType, amount, params),
  );
}

async function waitForCounterStep(engine, action, ctx) {
  const game = engine?.game;
  if (!game) return;

  if (typeof game.updateBoard === "function") {
    game.updateBoard();
  }

  const delayMs = Number.isFinite(action?.stepDelayMs)
    ? action.stepDelayMs
    : 120;
  if (typeof game.waitForPresentationDelay === "function") {
    await game.waitForPresentationDelay(delayMs);
    return;
  }
  if (typeof game.waitForAiPresentationStep === "function") {
    await game.waitForAiPresentationStep(ctx?.player, { delayMs });
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function isCounterFieldZone(zone) {
  return zone === "field" || zone === "spellTrap" || zone === "fieldSpell";
}

function getCounterQueryPlayers(ctx, owner = "self") {
  if (owner === "opponent") return [ctx?.opponent].filter(Boolean);
  if (owner === "any" || owner === "both" || owner === "either") {
    return [ctx?.player, ctx?.opponent].filter(Boolean);
  }
  return [ctx?.player].filter(Boolean);
}

function getCounterQueryZoneCards(player, zone) {
  if (!player || !zone) return [];
  if (zone === "fieldSpell") {
    return player.fieldSpell ? [player.fieldSpell] : [];
  }
  const cards = player[zone];
  return Array.isArray(cards) ? cards.filter(Boolean) : [];
}

function cardMatchesCounterQueryFilters(card, filters = {}) {
  if (!card) return false;
  if (filters.requireFaceup === true && card.isFacedown) return false;
  if (filters.cardKind && !cardMatchesKind(card, filters.cardKind)) return false;
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  if (filters.type && card.type !== filters.type) return false;
  if (filters.attribute && card.attribute !== filters.attribute) return false;
  if (filters.name && card.name !== filters.name) return false;
  if (filters.subtype && card.subtype !== filters.subtype) return false;
  if (filters.counterType || filters.minCounters !== undefined) {
    const counterType = filters.counterType || "default";
    const minCounters = Number(filters.minCounters ?? 1);
    const count =
      typeof card.getCounter === "function" ? card.getCounter(counterType) : 0;
    if (count < minCounters) return false;
  }
  return true;
}

function countCounterQueryFieldCards(ctx, spec = {}) {
  const zones = Array.isArray(spec.zones)
    ? spec.zones
    : [spec.zone || "field"];
  const filters = spec.filters || {};
  let count = 0;

  for (const player of getCounterQueryPlayers(ctx, spec.owner || "self")) {
    for (const zone of zones) {
      for (const card of getCounterQueryZoneCards(player, zone)) {
        if (cardMatchesCounterQueryFilters(card, filters)) {
          count += 1;
        }
      }
    }
  }

  return count;
}

function resolveAddCounterAmount(action, ctx) {
  if (action.amountFromFieldCount) {
    const spec = action.amountFromFieldCount;
    const count = countCounterQueryFieldCards(ctx, spec);
    const multiplier = Number.isFinite(Number(spec.multiplier))
      ? Number(spec.multiplier)
      : 1;
    let amount = count * multiplier;
    if (Number.isFinite(Number(spec.min))) {
      amount = Math.max(Number(spec.min), amount);
    }
    if (Number.isFinite(Number(spec.max))) {
      amount = Math.min(Number(spec.max), amount);
    }
    return Math.max(0, Math.floor(amount));
  }

  if (action.damagePerCounter && ctx.damageAmount !== undefined) {
    return ctx.damageAmount >= action.damagePerCounter ? 1 : 0;
  }

  return Math.max(0, Math.floor(Number(action.amount || 1)));
}

function uniqueCounterEntries(cards, zones = []) {
  const seen = new Set();
  const entries = [];
  for (const [index, card] of (cards || []).entries()) {
    if (!card) continue;
    const key = card.instanceId || card;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      card,
      zone: zones[index] || zones[0] || null,
    });
  }
  return entries;
}

function findCounterCardZone(engine, card, fallbackPlayer) {
  const game = engine?.game;
  const owner = resolveCounterOwner(game, card, fallbackPlayer);
  if (owner && typeof engine?.findCardZone === "function") {
    const ownerZone = engine.findCardZone(owner, card);
    if (ownerZone) return ownerZone;
  }
  if (typeof engine?.findCardZone !== "function") return null;
  return (
    engine.findCardZone(game?.player, card) ||
    engine.findCardZone(game?.bot, card) ||
    null
  );
}

async function emitCounterRemovedEvent(engine, data = {}) {
  const game = engine?.game;
  if (!game || typeof game.emit !== "function") return;

  const amount = Math.max(0, Number(data.amount || 0));
  if (amount <= 0) return;

  const rawCards = data.cards || (data.card ? [data.card] : []);
  const rawZones = Array.isArray(data.zones) ? data.zones : [];
  const entries = uniqueCounterEntries(rawCards, rawZones);
  const cards = entries.map((entry) => entry.card);
  const zones = entries
    .map((entry) => entry.zone)
    .filter((zone) => typeof zone === "string");
  const uniqueZones = Array.from(
    new Set(zones),
  );
  const fromField =
    data.fromField === true || zones.some((zone) => isCounterFieldZone(zone));
  if (!fromField) return;

  const eventPlayer =
    data.player ||
    data.ctx?.player ||
    resolveCounterOwner(game, data.ctx?.source || data.sourceCard, null) ||
    resolveCounterOwner(game, cards[0], null) ||
    null;
  const eventOpponent =
    data.opponent ||
    data.ctx?.opponent ||
    game.getOpponent?.(eventPlayer) ||
    null;

  await game.emit("counter_removed", {
    player: eventPlayer,
    opponent: eventOpponent,
    sourceCard: data.ctx?.source || data.sourceCard || null,
    source: data.ctx?.source || data.source || null,
    effectId: data.ctx?.effect?.id || data.ctx?.effectId || data.effectId || null,
    counterType: data.counterType,
    amount,
    card: cards[0] || null,
    cards,
    zones,
    uniqueZones,
    fromField,
    actionContext: data.ctx?.actionContext || data.actionContext || null,
  });
}

export async function applyAddCounter(action, ctx, targets) {
  const counterType = action.counterType || "default";
  const amount = resolveAddCounterAmount(action, ctx);
  const targetRef = action.targetRef || "self";

  if (amount <= 0) return false;

  let targetCards = [];
  if (action.targetScope) {
    targetCards = resolveFieldScopeCards(action.targetScope, ctx, this.game, {
      engine: this,
    });
  } else if (targetRef === "self") {
    targetCards = [ctx.source];
  } else if (targets[targetRef]) {
    targetCards = targets[targetRef];
  }

  if (!Array.isArray(targetCards)) {
    targetCards = [targetCards];
  }
  if (
    action.targetScope &&
    typeof this.filterCardsListByImmunity === "function"
  ) {
    targetCards = this.filterCardsListByImmunity(targetCards, ctx.player, {
      actionType: action.type,
      effectType: action.effectType || this.inferEffectType?.(action.type),
      sourceCard: ctx?.source || null,
    }).allowed;
  }

  let added = false;
  for (const card of targetCards) {
    if (card && typeof card.addCounter === "function") {
      let remaining = amount;
      while (remaining > 0) {
        card.addCounter(counterType, 1);
        remaining -= 1;
        const after =
          typeof card.getCounter === "function"
            ? card.getCounter(counterType)
            : null;
        const logMessage = getCounterLogMessage("added", counterType, 1, {
          cardName: card.name,
        });
        console.log(logMessage);
        emitCounterEvent(this, {
          card,
          ctx,
          counterType,
          amount: 1,
          action: "add",
          result: after,
        });
        if (this.ui?.log) {
          this.ui.log(logMessage);
        }
        await waitForCounterStep(this, action, ctx);
        added = true;
      }
    }
  }

  return added;
}

function toContextCounterKey(counterType) {
  const raw = String(counterType || "default");
  const pascal = raw
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return `removed${pascal || "Default"}CounterCount`;
}

function getCounterContextKey(action, counterType, fallback = undefined) {
  const configured = action.contextKey || action.storeAs || action.resultKey;
  if (configured) return configured;
  if (fallback !== undefined) return fallback;
  return toContextCounterKey(counterType);
}

function writeCounterContext(ctx, counterType, contextKey, amount) {
  if (!ctx || !contextKey) return;
  const safeAmount = Math.max(0, Number(amount || 0));
  ctx[contextKey] = safeAmount;
  ctx.lastRemovedCounterCount = safeAmount;
  ctx.removedCounterCounts = ctx.removedCounterCounts || {};
  ctx.removedCounterCounts[counterType] = safeAmount;
}

async function resolveCounterRemovalAmount(engine, action, ctx, totalAvailable) {
  const game = engine?.game;
  const player = ctx?.player;
  const hasRange =
    action.maxAmount !== undefined ||
    action.minAmount !== undefined ||
    action.variableAmount === true;

  if (!hasRange) {
    return Math.max(1, Number(action.amount ?? action.count ?? 1));
  }

  const minAmount = Math.max(1, Number(action.minAmount ?? 1));
  const configuredMax = Math.max(
    minAmount,
    Number(action.maxAmount ?? action.amount ?? action.count ?? minAmount),
  );
  const maxAmount = Math.min(configuredMax, Math.max(0, totalAvailable));

  if (maxAmount < minAmount) return 0;
  if (isAI(player)) return maxAmount;

  const defaultAmount = Math.max(
    minAmount,
    Math.min(maxAmount, Number(action.defaultAmount ?? maxAmount)),
  );
  const ui = getUI(game);
  if (!ui?.showNumberPrompt) return defaultAmount;

  const prompt =
    action.amountPrompt ||
    getUIText("ui.counters.removeAmount", {
      ...getCounterTextParams(action.counterType || "default", 2),
      min: minAmount,
      max: maxAmount,
    });
  const raw = ui.showNumberPrompt(prompt, defaultAmount);
  const resolved = raw && typeof raw.then === "function" ? await raw : raw;
  if (resolved === null || resolved === undefined) return null;

  const parsed = Math.floor(Number(resolved));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(minAmount, Math.min(maxAmount, parsed));
}

/**
 * Apply remove counter action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether counters were removed
 */
export async function applyRemoveCounter(action, ctx, targets) {
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
  let removedAmount = 0;
  const removedCards = [];
  const removedZones = [];
  for (const card of targetCards) {
    if (!card || typeof card.getCounter !== "function") continue;
    const current = card.getCounter(counterType);
    if (current <= 0) continue;
    if (!allowBelow && current < amount) continue;
    if (typeof card.removeCounter === "function") {
      const zoneBeforeRemoval = findCounterCardZone(this, card, ctx?.player);
      let remainingForCard = allowBelow ? Math.min(current, amount) : amount;

      while (remainingForCard > 0) {
        card.removeCounter(counterType, 1);
        remainingForCard -= 1;
        const after =
          typeof card.getCounter === "function" ? card.getCounter(counterType) : null;
        const logMessage = getCounterLogMessage("removed", counterType, 1, {
          cardName: card.name,
        });
        console.log(logMessage);
        emitCounterEvent(this, {
          card,
          ctx,
          counterType,
          amount: 1,
          action: "remove",
          result: after,
        });
        if (isCounterFieldZone(zoneBeforeRemoval)) {
          removedCards.push(card);
          removedZones.push(zoneBeforeRemoval);
          removedAmount += 1;
        }
        if (this.ui?.log) {
          this.ui.log(logMessage);
        }
        await waitForCounterStep(this, action, ctx);
      }

      removed = true;
    }
  }

  if (removedAmount > 0) {
    await emitCounterRemovedEvent(this, {
      ctx,
      counterType,
      amount: removedAmount,
      cards: removedCards,
      zones: removedZones,
      fromField: true,
    });
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
      getUIText("ui.counters.selectPayment", {
        ...getCounterTextParams(action.counterType || "default", amount),
      }),
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
    getUI(game)?.log(getUIText("ui.counters.paymentCancelled"));
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
  const entries = collectCounterFieldEntries(this, action, ctx);
  const totalAvailable = entries.reduce(
    (sum, entry) => sum + entry.counterCount,
    0,
  );
  const contextKey = getCounterContextKey(action, counterType, null);
  if (ctx && contextKey) {
    writeCounterContext(ctx, counterType, contextKey, 0);
  }

  const amount = await resolveCounterRemovalAmount(
    this,
    action,
    ctx,
    totalAvailable,
  );
  if (amount === null) {
    getUI(game)?.log(getUIText("ui.counters.paymentCancelled"));
    return false;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    getUI(game)?.log(
      getUIText("ui.counters.notEnough", getCounterTextParams(counterType, 2)),
    );
    return false;
  }

  if (totalAvailable < amount) {
    getUI(game)?.log(
      getUIText("ui.counters.notEnough", getCounterTextParams(counterType, 2)),
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
      getUIText(
        "ui.counters.selectEnough",
        getCounterTextParams(counterType, amount),
      ),
    );
    return false;
  }

  let remaining = amount;
  let removed = false;
  let removedAmount = 0;
  const removedCards = [];
  const removedZones = [];

  while (remaining > 0) {
    let progressed = false;

    for (const entry of selectedEntries) {
      if (remaining <= 0) break;
      const card = entry.card;
      const current = getCounterValue(card, counterType);
      if (current <= 0 || typeof card.removeCounter !== "function") continue;

      card.removeCounter(counterType, 1);
      remaining -= 1;
      progressed = true;
      removed = true;
      removedAmount += 1;
      removedCards.push(card);
      removedZones.push(entry.zone);
      emitCounterEvent(this, {
        card,
        ctx,
        counterType,
        amount: 1,
        action: "remove",
        result: getCounterValue(card, counterType),
      });
      getUI(game)?.log(
        getCounterLogMessage("removed", counterType, 1, {
          cardName: card.name,
        }),
      );
      await waitForCounterStep(this, action, ctx);
    }

    if (!progressed) break;
  }

  if (remaining > 0) return false;

  if (ctx && contextKey) {
    writeCounterContext(ctx, counterType, contextKey, removedAmount);
  }

  if (removedAmount > 0) {
    await emitCounterRemovedEvent(this, {
      ctx,
      counterType,
      amount: removedAmount,
      cards: removedCards,
      zones: removedZones,
      fromField: true,
    });
  }

  return removed;
}

/**
 * Remove every matching counter from the field and expose the removed count
 * on the action context for subsequent actions.
 */
export async function applyRemoveAllCountersFromField(action, ctx) {
  const game = this?.game;
  const counterType = action.counterType || "default";
  const entries = collectCounterFieldEntries(this, action, ctx);
  const totalAvailable = entries.reduce(
    (sum, entry) => sum + entry.counterCount,
    0,
  );

  const contextKey = getCounterContextKey(action, counterType);

  if (ctx && contextKey) {
    ctx[contextKey] = 0;
    ctx.lastRemovedCounterCount = 0;
    ctx.removedCounterCounts = ctx.removedCounterCounts || {};
    ctx.removedCounterCounts[counterType] = 0;
  }

  if (totalAvailable <= 0) {
    getUI(game)?.log(
      getUIText("ui.counters.noneFound", getCounterTextParams(counterType, 2)),
    );
    return false;
  }

  let removedAmount = 0;
  const removedCards = [];
  const removedZones = [];

  for (const entry of entries) {
    const card = entry.card;
    if (!card || typeof card.removeCounter !== "function") continue;

    while (getCounterValue(card, counterType) > 0) {
      card.removeCounter(counterType, 1);
      removedAmount += 1;
      removedCards.push(card);
      removedZones.push(entry.zone);
      emitCounterEvent(this, {
        card,
        ctx,
        counterType,
        amount: 1,
        action: "remove",
        result: getCounterValue(card, counterType),
      });
      getUI(game)?.log(
        getCounterLogMessage("removed", counterType, 1, {
          cardName: card.name,
        }),
      );
      await waitForCounterStep(this, action, ctx);
    }
  }

  if (ctx && contextKey) {
    ctx[contextKey] = removedAmount;
    ctx.lastRemovedCounterCount = removedAmount;
    ctx.removedCounterCounts = ctx.removedCounterCounts || {};
    ctx.removedCounterCounts[counterType] = removedAmount;
  }

  if (removedAmount > 0) {
    await emitCounterRemovedEvent(this, {
      ctx,
      counterType,
      amount: removedAmount,
      cards: removedCards,
      zones: removedZones,
      fromField: true,
    });
  }

  return removedAmount > 0;
}

/**
 * Count matching field counters and expose the total on the action context.
 */
export async function applyCountFieldCounters(action, ctx) {
  const game = this?.game;
  const counterType = action.counterType || "default";
  const entries = collectCounterFieldEntries(this, action, ctx);
  const total = entries.reduce((sum, entry) => sum + entry.counterCount, 0);
  const contextKey =
    action.contextKey ||
    action.storeAs ||
    action.resultKey ||
    `field${counterType.charAt(0).toUpperCase()}${counterType.slice(1)}CounterCount`;

  if (ctx && contextKey) {
    ctx[contextKey] = total;
    ctx.lastFieldCounterCount = total;
    ctx.fieldCounterCounts = ctx.fieldCounterCounts || {};
    ctx.fieldCounterCounts[counterType] = total;
  }

  if (action.log !== false) {
    getUI(game)?.log(
      getUIText(
        "ui.counters.counted",
        getCounterTextParams(counterType, total),
      ),
    );
  }

  return true;
}
