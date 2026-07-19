import {
  FAST_EFFECT_ORIGINS,
  FAST_EFFECT_STATES,
} from "../../chain/timing.js";
import { bumpCardLocationVersion } from "../../Card.js";
import {
  checkSpecialSummonEligibility,
  establishProperSummon,
} from "./eligibility.js";

export const SUMMON_ORIGINS = Object.freeze({
  PROCEDURE: "procedure",
  EFFECT_RESOLUTION: "effect_resolution",
});

export const SUMMON_MODES = Object.freeze({
  SUMMON: "summon",
  SET: "set",
});

export const SUMMON_STATUSES = Object.freeze({
  PREPARED: "prepared",
  COMMITTED: "committed",
  AWAITING_NEGATION: "awaiting_negation",
  SUCCEEDED: "succeeded",
  NEGATED: "negated",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const TERMINAL_STATUSES = new Set([
  SUMMON_STATUSES.SUCCEEDED,
  SUMMON_STATUSES.NEGATED,
  SUMMON_STATUSES.FAILED,
  SUMMON_STATUSES.CANCELLED,
]);

function playerId(player) {
  return player?.id ?? null;
}

function cardIdentity(card) {
  if (!card) return null;
  return {
    cardId: card.id ?? null,
    instanceId: card.instanceId ?? card._instanceId ?? card.uuid ?? null,
    name: card.name || null,
  };
}

function serializeCost(cost) {
  if (!cost) return null;
  return {
    ...cardIdentity(cost.card),
    ownerId: playerId(cost.owner),
    fromZone: cost.fromZone || null,
    toZone: cost.toZone || null,
    kind: cost.kind || "material",
    paid: cost.paid === true,
  };
}

export function serializeSummonTransaction(transaction) {
  if (!transaction) return null;
  return {
    summonId: transaction.summonId ?? null,
    status: transaction.status || SUMMON_STATUSES.PREPARED,
    summonOrigin: transaction.summonOrigin,
    summonMode: transaction.summonMode,
    summonMethod: transaction.summonMethod,
    summonProcedure: transaction.summonProcedure || null,
    controllerId: playerId(transaction.controller),
    opponentId: playerId(transaction.opponent),
    card: cardIdentity(transaction.card),
    sourceAtStart: transaction.sourceAtStart
      ? { ...transaction.sourceAtStart }
      : null,
    position: transaction.position || null,
    consumesNormalSummon: transaction.consumesNormalSummon === true,
    normalSummonCommitted: transaction.normalSummonCommitted === true,
    costs: (transaction.costPayments || []).map(serializeCost).filter(Boolean),
    negationOutcome: transaction.negationOutcome
      ? {
          destination: transaction.negationOutcome.destination || "graveyard",
          destroyed: transaction.negationOutcome.destroyed === true,
          sourceCard: cardIdentity(transaction.negationOutcome.sourceCard),
          sourcePlayerId: playerId(transaction.negationOutcome.sourcePlayer),
          linkId: transaction.negationOutcome.linkId ?? null,
        }
      : null,
    committedAtTurn: transaction.committedAtTurn ?? null,
    completedAtTurn: transaction.completedAtTurn ?? null,
    reason: transaction.reason || null,
  };
}

export function createPreparedSummon(input = {}) {
  const removedFields = ["player", "fromZone", "method", "negated"].filter(
    (field) => Object.hasOwn(input, field),
  );
  if (removedFields.length > 0) {
    throw new TypeError(
      `PreparedSummon contains removed fields: ${removedFields.join(", ")}`,
    );
  }
  const controller = input.controller || null;
  const card = input.card || null;
  const sourceZone = input.sourceZone || null;
  return {
    summonId: null,
    status: SUMMON_STATUSES.PREPARED,
    summonOrigin: input.summonOrigin || null,
    summonMode:
      input.summonMode === SUMMON_MODES.SET
        ? SUMMON_MODES.SET
        : SUMMON_MODES.SUMMON,
    summonMethod: input.summonMethod || "special",
    summonProcedure: input.summonProcedure || null,
    controller,
    opponent: input.opponent || this?.getOpponent?.(controller) || null,
    card,
    position: input.position || null,
    sourceAtStart: {
      zone: sourceZone,
      controllerId: playerId(controller),
      ownerId: card?.owner || playerId(controller),
      faceUp: card ? card.isFacedown !== true : null,
      locationVersion: Number(card?.locationVersion ?? 0),
    },
    consumesNormalSummon: input.consumesNormalSummon === true,
    normalSummonCommitted: false,
    costPayments: Array.isArray(input.costPayments)
      ? input.costPayments.map((cost) => ({ ...cost, paid: false }))
      : [],
    negationOutcome: null,
    committedAtTurn: null,
    completedAtTurn: null,
    reason: null,
    cancelled: input.cancelled === true,
    commit: typeof input.commit === "function" ? input.commit : null,
    perform: typeof input.perform === "function" ? input.perform : null,
    onFailure: typeof input.onFailure === "function" ? input.onFailure : null,
    finalContext: input.finalContext || null,
    skipFinalTiming: input.skipFinalTiming === true,
  };
}

function allocateSummonId(game) {
  const current = Number(game?.nextSummonId || 1);
  const summonId = Number.isInteger(current) && current > 0 ? current : 1;
  game.nextSummonId = summonId + 1;
  return summonId;
}

export function beginSummonTransaction(preparedInput = {}) {
  const prepared =
    preparedInput?.status === SUMMON_STATUSES.PREPARED
      ? preparedInput
      : this.createPreparedSummon(preparedInput);
  if (
    !prepared.card ||
    !prepared.controller ||
    !Object.values(SUMMON_ORIGINS).includes(prepared.summonOrigin)
  ) {
    return { ok: false, reason: "invalid_summon_transaction" };
  }
  const isSpecialSummon =
    prepared.summonMode === SUMMON_MODES.SUMMON &&
    !["normal", "tribute", "flip"].includes(prepared.summonMethod);
  if (isSpecialSummon) {
    const eligibility = checkSpecialSummonEligibility(prepared.card, {
      summonProcedure: prepared.summonProcedure || prepared.summonMethod,
      fromZone: prepared.sourceAtStart?.zone || null,
    });
    if (!eligibility.ok) {
      return {
        ok: false,
        reason: eligibility.reason || "special_summon_restriction",
        code: eligibility.code || "special_summon_restriction",
      };
    }
  }
  if (this.activeSummonTransaction) {
    return { ok: false, reason: "summon_transaction_busy" };
  }
  prepared.summonId = allocateSummonId(this);
  prepared.status = SUMMON_STATUSES.COMMITTED;
  prepared.committedAtTurn = this.turnCounter ?? null;
  this.activeSummonTransaction = prepared;
  this.notify?.("summon_transaction", serializeSummonTransaction(prepared));
  return { ok: true, transaction: prepared };
}

export function markSummonAwaitingNegation(summonId) {
  const transaction = this.activeSummonTransaction;
  if (!transaction || transaction.summonId !== summonId) return null;
  transaction.status = SUMMON_STATUSES.AWAITING_NEGATION;
  this.notify?.("summon_transaction", serializeSummonTransaction(transaction));
  return transaction;
}

export function markSummonNegated(summonId, outcome = {}) {
  const transaction = this.activeSummonTransaction;
  if (!transaction || transaction.summonId !== summonId) return null;
  transaction.status = SUMMON_STATUSES.NEGATED;
  transaction.negationOutcome = {
    destination: outcome.destination || "graveyard",
    destroyed: outcome.destroyed === true,
    sourceCard: outcome.sourceCard || null,
    sourcePlayer: outcome.sourcePlayer || null,
    linkId: outcome.linkId ?? null,
  };
  this.notify?.("summon_negated", serializeSummonTransaction(transaction));
  return transaction;
}

export function finishSummonTransaction(transaction, result = {}) {
  if (!transaction) return null;
  if (!TERMINAL_STATUSES.has(transaction.status)) {
    transaction.status =
      result.cancelled === true
        ? SUMMON_STATUSES.CANCELLED
        : result.summonNegated === true ||
            transaction.status === SUMMON_STATUSES.NEGATED
          ? SUMMON_STATUSES.NEGATED
          : result.success === false
            ? SUMMON_STATUSES.FAILED
            : SUMMON_STATUSES.SUCCEEDED;
  }
  transaction.reason = result.reason || transaction.reason || null;
  transaction.completedAtTurn = this.turnCounter ?? null;
  const snapshot = serializeSummonTransaction(transaction);
  this.lastSummonTransaction = snapshot;
  if (this.activeSummonTransaction === transaction) {
    this.activeSummonTransaction = null;
  }
  this.notify?.("summon_transaction", snapshot);
  return snapshot;
}

export function cleanupSummonTransaction(reason = "summon_cleanup") {
  const transaction = this.activeSummonTransaction;
  if (!transaction) {
    this.summonProcedureDepth = 0;
    return null;
  }
  transaction.status = SUMMON_STATUSES.FAILED;
  transaction.reason = reason;
  const snapshot = this.finishSummonTransaction(transaction, {
    success: false,
    reason,
  });
  this.summonProcedureDepth = 0;
  return snapshot;
}

export function getSummonState() {
  return {
    active: this.activeSummonTransaction != null,
    transaction: serializeSummonTransaction(this.activeSummonTransaction),
    last: this.lastSummonTransaction
      ? JSON.parse(JSON.stringify(this.lastSummonTransaction))
      : null,
  };
}

async function payCost(game, transaction, cost) {
  let result;
  if (typeof cost.pay === "function") {
    result = await cost.pay(transaction);
  } else {
    const owner = cost.owner || transaction.controller;
    result = await game.moveCard(cost.card, owner, cost.toZone || "graveyard", {
      ...(cost.options || {}),
      fromZone: cost.fromZone || undefined,
      contextLabel: cost.contextLabel || "summon_procedure_cost",
      summonId: transaction.summonId,
      summonOrigin: transaction.summonOrigin,
      summonProcedure: transaction.summonProcedure,
      awaitCardToGraveEvent: (cost.toZone || "graveyard") === "graveyard",
      awaitCardMovedEvent: true,
    });
  }
  if (result?.success === false || result === false) return result;
  cost.paid = true;
  game.notify?.("summon_cost_paid", {
    summonId: transaction.summonId,
    cost: serializeCost(cost),
  });
  return result || { success: true };
}

async function finishProcedureTiming(game, transaction, result) {
  if (
    transaction.skipFinalTiming ||
    transaction.summonOrigin !== SUMMON_ORIGINS.PROCEDURE ||
    game.chainSystem?.isChainResolving?.() === true ||
    game.chainSystem?.isChainWindowOpen?.() === true
  ) {
    return null;
  }
  const flushResult = await game.flushPendingTriggerOccurrences?.({
    reason: "summon_transaction_complete",
  });
  if (flushResult?.needsSelection) {
    return flushResult;
  }
  const failedContext =
    result?.success === false
      ? {
           type: result?.summonNegated ? "summon_negated" : "summon_failed",
           event: result?.summonNegated ? "summon_negated" : "summon_failed",
          card: transaction.card,
          player: transaction.controller,
          summonId: transaction.summonId,
        }
      : null;
  const context = failedContext || transaction.finalContext || {
    type:
      transaction.summonMode === SUMMON_MODES.SET
        ? "monster_set"
        : result?.summonNegated
          ? "summon_negated"
          : "after_summon",
    event:
      transaction.summonMode === SUMMON_MODES.SET
        ? "monster_set"
        : result?.summonNegated
          ? "summon_negated"
          : "after_summon",
    card: transaction.card,
    player: transaction.controller,
    summonId: transaction.summonId,
  };
  const timingResult = await game.chainSystem?.runFastEffectTiming?.({
    origin:
      flushResult?.chainBuilt === true
        ? FAST_EFFECT_ORIGINS.POST_CHAIN
        : FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN,
    actionPlayer: transaction.controller,
    context,
  });
  if (flushResult?.ok === false) {
    return {
      ...(timingResult || {}),
      ok: false,
      success: false,
      reason:
        flushResult.reason ||
        timingResult?.reason ||
        "summon_trigger_resolution_failed",
      triggerResolution: flushResult,
    };
  }
  return timingResult;
}

async function finalizeFailedCommittedCard(game, transaction) {
  const card = transaction?.card;
  const controller = transaction?.controller;
  if (
    !card ||
    !controller ||
    transaction.status === SUMMON_STATUSES.NEGATED
  ) return null;
  const ownerId =
    transaction.sourceAtStart?.ownerId || card.originalOwner || card.owner;
  const destinationOwner =
    ownerId === game.player?.id
      ? game.player
      : ownerId === game.bot?.id
        ? game.bot
        : controller;
  const sourceZone =
    game.chainSystem?.determineCardZone?.(card, destinationOwner) || null;
  if (sourceZone === "graveyard") return null;
  try {
    if (sourceZone) {
      return await game.moveCard(card, destinationOwner, "graveyard", {
        fromZone: sourceZone,
        contextLabel: "failed_summon_transaction",
        awaitCardToGraveEvent: true,
        awaitCardMovedEvent: true,
      });
    }
    destinationOwner.graveyard ||= [];
    if (!destinationOwner.graveyard.includes(card)) {
      destinationOwner.graveyard.push(card);
      card.owner = destinationOwner.id;
      card.controller = destinationOwner.id;
      card.isFacedown = false;
      const locationVersion = bumpCardLocationVersion(card);
      const fromZone = transaction.sourceAtStart?.zone || null;
      const payload = {
        card,
        player: destinationOwner,
        opponent:
          game.getOpponent?.(destinationOwner) || transaction.opponent || null,
        fromPlayer: destinationOwner,
        toPlayer: destinationOwner,
        fromZone,
        toZone: "graveyard",
        locationVersion,
        contextLabel: "failed_summon_transaction",
        summonId: transaction.summonId,
        wasDestroyed: false,
      };
      game.chainSystem?.recordChainSourceMovement?.(card, payload);
      await game.emit?.("card_to_grave", payload);
      await game.emit?.("card_moved", payload);
    }
  } catch {
    // Transaction cleanup must still release the action guard after a move error.
  }
  return null;
}

export async function executeSummonTransaction(preparedInput = {}) {
  const prepared =
    preparedInput?.status === SUMMON_STATUSES.PREPARED
      ? preparedInput
      : this.createPreparedSummon(preparedInput);
  if (prepared.cancelled) {
    prepared.status = SUMMON_STATUSES.CANCELLED;
    return {
      success: false,
      cancelled: true,
      summonId: null,
      transaction: serializeSummonTransaction(prepared),
    };
  }
  const begun = this.beginSummonTransaction(prepared);
  if (!begun.ok) return { success: false, reason: begun.reason, summonId: null };
  const transaction = begun.transaction;
  this.summonProcedureDepth = Number(this.summonProcedureDepth || 0) + 1;
  let result = null;
  try {
    if (transaction.commit) {
      const commitResult = await transaction.commit(transaction);
      if (commitResult?.success === false || commitResult === false) {
        result = {
          success: false,
          reason: commitResult?.reason || "summon_commit_failed",
        };
      }
    }
    if (!result) {
      for (const cost of transaction.costPayments) {
        const costResult = await payCost(this, transaction, cost);
        if (costResult?.success === false || costResult === false) {
          result = {
            success: false,
            reason: costResult?.reason || "summon_cost_failed",
          };
          break;
        }
      }
    }
    if (!result) {
      result = transaction.perform
        ? await transaction.perform(transaction)
        : { success: true };
    }
    result = result || { success: true };
  } catch (error) {
    result = {
      success: false,
      reason: error?.message || "summon_transaction_failed",
      error,
    };
    try {
      await transaction.onFailure?.(transaction, error);
    } catch {
      // Cleanup must never hide the original transaction failure.
    }
  } finally {
    this.summonProcedureDepth = Math.max(
      0,
      Number(this.summonProcedureDepth || 0) - 1,
    );
  }

  if (
    result.success === false &&
    transaction.status !== SUMMON_STATUSES.NEGATED
  ) {
    await finalizeFailedCommittedCard(this, transaction);
  }

  const finalResult = {
    ...result,
    success:
      result.success !== false && transaction.status !== SUMMON_STATUSES.NEGATED,
    summonNegated:
      result.summonNegated === true ||
      transaction.status === SUMMON_STATUSES.NEGATED,
    summonId: transaction.summonId,
  };
  if (finalResult.success === true) {
    establishProperSummon(transaction.card, transaction);
  }
  const snapshot = this.finishSummonTransaction(transaction, finalResult);
  finalResult.transaction = snapshot;
  const timing = await finishProcedureTiming(this, transaction, finalResult);
  if (timing?.needsSelection) {
    finalResult.needsSelection = true;
    finalResult.selectionContract = timing.selectionContract || null;
  }
  return finalResult;
}

export function holdSummonTimingState(transaction) {
  if (!transaction || !this.chainSystem?.transitionFastEffectState) return;
  this.chainSystem.transitionFastEffectState(FAST_EFFECT_STATES.TRIGGER_CHECK, {
    origin: FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT,
    timingWindowId: null,
    turnPlayer: this.chainSystem.getCurrentTurnPlayer?.() || null,
    actionPlayer: transaction.controller,
    priorityPlayer: null,
    chainId: null,
    consecutivePasses: 0,
  });
}
