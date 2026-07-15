export const USAGE_POLICIES = Object.freeze({
  USE: "use",
  ACTIVATE: "activate",
  LEGACY: "legacy_resolution_success",
});

function getPolicy(effect) {
  return effect?.usagePolicy === USAGE_POLICIES.USE ||
    effect?.usagePolicy === USAGE_POLICIES.ACTIVATE
    ? effect.usagePolicy
    : USAGE_POLICIES.LEGACY;
}

function getTurnKey(chainSystem, card, player, effect) {
  if (!effect?.oncePerTurn) return null;
  return (
    chainSystem.game?.getOncePerTurnLockKey?.(card, effect) ||
    `once_per_turn:${effect.oncePerTurnName || effect.id || card?.name || "effect"}`
  );
}

function getDuelKey(card, effect) {
  if (!effect?.oncePerDuel) return null;
  return effect.oncePerDuelName || effect.id || card?.name || "effect";
}

function getPlayerKey(player) {
  return player?.id || "player";
}

function reservationMatches(reservation, player, turnKey, duelKey) {
  if (!reservation || reservation.status !== "reserved") return false;
  if (reservation.playerId !== getPlayerKey(player)) return false;
  return (
    (turnKey && reservation.turnKey === turnKey) ||
    (duelKey && reservation.duelKey === duelKey)
  );
}

function activeReservationCounts(chainSystem, player, turnKey, duelKey) {
  let turn = 0;
  let duel = 0;
  for (const reservation of chainSystem.usageReservations?.values?.() || []) {
    if (!reservationMatches(reservation, player, turnKey, duelKey)) continue;
    if (turnKey && reservation.turnKey === turnKey) turn += 1;
    if (duelKey && reservation.duelKey === duelKey) duel += 1;
  }
  return { turn, duel };
}

function compactReservation(reservation) {
  if (!reservation) return null;
  return {
    reservationId: reservation.reservationId ?? null,
    policy: reservation.policy || USAGE_POLICIES.LEGACY,
    status: reservation.status || null,
    playerId: reservation.playerId || null,
    turnKey: reservation.turnKey || null,
    duelKey: reservation.duelKey || null,
    oncePerTurn: reservation.oncePerTurn === true,
    oncePerDuel: reservation.oncePerDuel === true,
    chainId: reservation.chainId ?? null,
    linkId: reservation.linkId ?? null,
  };
}

function notifyUsage(chainSystem, reservation) {
  chainSystem.game?.notify?.("activation_usage", compactReservation(reservation));
}

function markConsumed(chainSystem, card, player, effect) {
  if (effect?.oncePerTurn) {
    chainSystem.game?.markOncePerTurnUsed?.(card, player, effect);
  }
  if (effect?.oncePerDuel) {
    chainSystem.game?.effectEngine?.registerOncePerDuelUsage?.(
      card,
      player,
      effect,
    );
  }
}

export function getUsagePolicy(effect) {
  return getPolicy(effect);
}

export function checkActivationUsage(card, player, effect) {
  if (!effect || !player) return { ok: true };

  const turnCheck = effect.oncePerTurn
    ? this.game?.canUseOncePerTurn?.(card, player, effect) || { ok: true }
    : { ok: true };
  if (turnCheck.ok === false) return turnCheck;

  const duelCheck = effect.oncePerDuel
    ? this.game?.effectEngine?.checkOncePerDuel?.(card, player, effect) || {
        ok: true,
      }
    : { ok: true };
  if (duelCheck.ok === false) return duelCheck;

  const turnKey = getTurnKey(this, card, player, effect);
  const duelKey = getDuelKey(card, effect);
  const reserved = activeReservationCounts(this, player, turnKey, duelKey);
  const turnRemaining = Number(turnCheck.remaining ?? Infinity);
  const duelRemaining = Number(duelCheck.remaining ?? Infinity);
  if (turnKey && reserved.turn >= turnRemaining) {
    return {
      ok: false,
      code: "USAGE_LIMIT_RESERVED",
      reason: "Effect usage limit is already reserved by another Chain Link.",
      scope: "turn",
    };
  }
  if (duelKey && reserved.duel >= duelRemaining) {
    return {
      ok: false,
      code: "USAGE_LIMIT_RESERVED",
      reason: "Effect usage limit is already reserved by another Chain Link.",
      scope: "duel",
    };
  }
  return {
    ok: true,
    policy: getPolicy(effect),
    turnKey,
    duelKey,
  };
}

export function reserveUsageForChainLink(link) {
  if (!link?.effect || !link?.controller) return null;
  const effect = link.effect;
  const policy = link.usagePolicy?.consumption || getPolicy(effect);
  if (
    policy === USAGE_POLICIES.LEGACY ||
    (!effect.oncePerTurn && !effect.oncePerDuel)
  ) {
    return null;
  }

  const check = this.checkActivationUsage?.(link.card, link.controller, effect);
  if (check?.ok === false) return { ...check, success: false };

  const reservation = {
    reservationId: this.nextUsageReservationId++,
    policy,
    status: policy === USAGE_POLICIES.USE ? "consumed" : "reserved",
    playerId: getPlayerKey(link.controller),
    turnKey: getTurnKey(this, link.card, link.controller, effect),
    duelKey: getDuelKey(link.card, effect),
    oncePerTurn: effect.oncePerTurn === true,
    oncePerDuel: !!effect.oncePerDuel,
    chainId: link.chainId,
    linkId: link.linkId,
  };

  if (policy === USAGE_POLICIES.USE) {
    markConsumed(this, link.card, link.controller, effect);
  } else {
    this.usageReservations.set(reservation.reservationId, reservation);
  }
  link.usageReservation = compactReservation(reservation);
  notifyUsage(this, reservation);
  return link.usageReservation;
}

export function settleUsageForChainLink(link) {
  const snapshot = link?.usageReservation;
  if (!snapshot || snapshot.status !== "reserved") return snapshot || null;
  const reservation = this.usageReservations.get(snapshot.reservationId);
  if (!reservation) return snapshot;

  if (link.activationNegated === true) {
    reservation.status = "released";
  } else {
    reservation.status = "consumed";
    markConsumed(this, link.card, link.controller, link.effect);
  }
  this.usageReservations.delete(reservation.reservationId);
  link.usageReservation = compactReservation(reservation);
  notifyUsage(this, reservation);
  return link.usageReservation;
}

export function releaseAllUsageReservations(reason = "chain_cancelled") {
  for (const reservation of this.usageReservations.values()) {
    reservation.status = "released";
    reservation.reason = reason;
    notifyUsage(this, reservation);
  }
  this.usageReservations.clear();
}
