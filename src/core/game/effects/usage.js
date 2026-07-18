export const EFFECT_USAGE_POLICIES = Object.freeze({
  USE: "use",
  ACTIVATE: "activate",
});

function usagePolicy(effect) {
  return effect?.usagePolicy === EFFECT_USAGE_POLICIES.USE ||
    effect?.usagePolicy === EFFECT_USAGE_POLICIES.ACTIVATE
    ? effect.usagePolicy
    : null;
}

function turnKey(game, card, effect) {
  if (!effect?.oncePerTurn) return null;
  return game.getOncePerTurnLockKey?.(card, effect) ||
    `once_per_turn:${effect.oncePerTurnName || effect.id || card?.name || "effect"}`;
}

function duelKey(card, effect) {
  if (!effect?.oncePerDuel) return null;
  return effect.oncePerDuelName || effect.id || card?.name || "effect";
}

function compact(reservation) {
  if (!reservation) return null;
  return {
    reservationId: reservation.reservationId,
    policy: reservation.policy,
    status: reservation.status,
    playerId: reservation.playerId,
    turnKey: reservation.turnKey,
    duelKey: reservation.duelKey,
    oncePerTurn: reservation.oncePerTurn,
    oncePerDuel: reservation.oncePerDuel,
    chainId: reservation.chainId ?? null,
    linkId: reservation.linkId ?? null,
    effectId: reservation.effectId ?? null,
    sourceInstanceId: reservation.sourceInstanceId ?? null,
  };
}

function consume(game, card, player, effect) {
  if (effect?.oncePerTurn) game.markOncePerTurnUsed?.(card, player, effect);
  if (effect?.oncePerDuel) {
    markOncePerDuelEffectUsed(card, player, effect);
  }
}

function activeReservationCounts(game, playerId, effectTurnKey, effectDuelKey) {
  let turn = 0;
  let duel = 0;
  for (const reservation of game.effectUsageReservations?.values?.() || []) {
    if (reservation.status !== "reserved" || reservation.playerId !== playerId) {
      continue;
    }
    if (effectTurnKey && reservation.turnKey === effectTurnKey) turn += 1;
    if (effectDuelKey && reservation.duelKey === effectDuelKey) duel += 1;
  }
  return { turn, duel };
}

export function checkEffectUsage(input = {}) {
  const { card, player, effect } = input;
  if (!effect || !player || (!effect.oncePerTurn && !effect.oncePerDuel)) {
    return { ok: true, policy: usagePolicy(effect) };
  }
  if (!usagePolicy(effect)) {
    return {
      ok: false,
      code: "USAGE_POLICY_REQUIRED",
      reason: "Limited effects require an explicit usagePolicy.",
    };
  }

  const turnCheck = effect.oncePerTurn
    ? this.canUseOncePerTurn?.(card, player, effect) || { ok: true }
    : { ok: true };
  if (turnCheck.ok === false) return { ...turnCheck, code: "USAGE_LIMIT_REACHED" };

  const duelCheck = effect.oncePerDuel
    ? this.effectEngine?.checkOncePerDuel?.(card, player, effect) || { ok: true }
    : { ok: true };
  if (duelCheck.ok === false) return { ...duelCheck, code: "USAGE_LIMIT_REACHED" };

  const effectTurnKey = turnKey(this, card, effect);
  const effectDuelKey = duelKey(card, effect);
  const reserved = activeReservationCounts(
    this,
    player.id || "player",
    effectTurnKey,
    effectDuelKey,
  );
  if (effectTurnKey && reserved.turn >= Number(turnCheck.remaining ?? Infinity)) {
    return {
      ok: false,
      code: "USAGE_LIMIT_RESERVED",
      reason: "Effect usage is already reserved.",
      scope: "turn",
    };
  }
  if (effectDuelKey && reserved.duel >= Number(duelCheck.remaining ?? Infinity)) {
    return {
      ok: false,
      code: "USAGE_LIMIT_RESERVED",
      reason: "Effect usage is already reserved.",
      scope: "duel",
    };
  }

  return {
    ok: true,
    policy: usagePolicy(effect),
    turnKey: effectTurnKey,
    duelKey: effectDuelKey,
  };
}

export function reserveEffectUsage(input = {}) {
  const { card, player, effect } = input;
  if (!effect || !player || (!effect.oncePerTurn && !effect.oncePerDuel)) {
    return null;
  }
  const check = this.checkEffectUsage(input);
  if (check.ok === false) return { ...check, success: false };

  const policy = usagePolicy(effect);
  const reservation = {
    reservationId: this.nextEffectUsageReservationId++,
    policy,
    status: policy === EFFECT_USAGE_POLICIES.USE ? "consumed" : "reserved",
    playerId: player.id || "player",
    turnKey: turnKey(this, card, effect),
    duelKey: duelKey(card, effect),
    oncePerTurn: effect.oncePerTurn === true,
    oncePerDuel: !!effect.oncePerDuel,
    chainId: input.chainId ?? null,
    linkId: input.linkId ?? null,
    effectId: effect.id || null,
    sourceInstanceId: card?.instanceId ?? card?.id ?? null,
    card,
    player,
    effect,
  };

  if (policy === EFFECT_USAGE_POLICIES.USE) consume(this, card, player, effect);
  else this.effectUsageReservations.set(reservation.reservationId, reservation);

  const snapshot = compact(reservation);
  this.notify?.("effect_usage", snapshot);
  return snapshot;
}

export function settleEffectUsage(reservationOrId, outcome = {}) {
  const id =
    typeof reservationOrId === "number"
      ? reservationOrId
      : reservationOrId?.reservationId;
  if (!Number.isFinite(id)) return reservationOrId || null;
  const reservation = this.effectUsageReservations.get(id);
  if (!reservation) return reservationOrId || null;

  const activationNegated =
    outcome === "activation_negated" || outcome?.activationNegated === true;
  const cancelled =
    outcome === "cancelled" || outcome === "precommit_failure" || outcome?.cancelled === true;
  if (activationNegated || cancelled) {
    reservation.status = "released";
  } else {
    reservation.status = "consumed";
    consume(this, reservation.card, reservation.player, reservation.effect);
  }
  this.effectUsageReservations.delete(id);
  const snapshot = compact(reservation);
  this.notify?.("effect_usage", snapshot);
  return snapshot;
}

export function releaseEffectUsageReservations(reason = "reset") {
  for (const reservation of this.effectUsageReservations.values()) {
    reservation.status = "released";
    const snapshot = { ...compact(reservation), reason };
    this.notify?.("effect_usage", snapshot);
  }
  this.effectUsageReservations.clear();
}

export function getEffectUsageState() {
  return {
    nextReservationId: this.nextEffectUsageReservationId,
    reservations: [...this.effectUsageReservations.values()]
      .map(compact)
      .sort((a, b) => a.reservationId - b.reservationId),
  };
}
import { markOncePerDuelEffectUsed } from "../../effects/triggers/registration.js";
