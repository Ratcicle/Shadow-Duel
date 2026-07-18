export const USAGE_POLICIES = Object.freeze({
  USE: "use",
  ACTIVATE: "activate",
});

function getPolicy(effect) {
  return effect?.usagePolicy === USAGE_POLICIES.USE ||
    effect?.usagePolicy === USAGE_POLICIES.ACTIVATE
    ? effect.usagePolicy
    : null;
}

export function getUsagePolicy(effect) {
  return getPolicy(effect);
}

export function checkActivationUsage(card, player, effect) {
  if (!effect || !player) return { ok: true };
  if ((effect.oncePerTurn || effect.oncePerDuel) && !getPolicy(effect)) {
    return {
      ok: false,
      code: "USAGE_POLICY_REQUIRED",
      reason: "Limited effects require an explicit usagePolicy.",
    };
  }
  if (typeof this.game?.checkEffectUsage === "function") {
    return this.game.checkEffectUsage({ card, player, effect });
  }
  return effect.oncePerTurn || effect.oncePerDuel
    ? {
        ok: false,
        code: "USAGE_SERVICE_UNAVAILABLE",
        reason: "Canonical effect usage service is unavailable.",
      }
    : { ok: true, policy: getPolicy(effect) };
}

export function reserveUsageForChainLink(link) {
  if (!link?.effect || !link?.controller) return null;
  const effect = link.effect;
  if (
    (!effect.oncePerTurn && !effect.oncePerDuel)
  ) {
    return null;
  }

  if (typeof this.game?.reserveEffectUsage !== "function") {
    return {
      success: false,
      ok: false,
      code: "USAGE_SERVICE_UNAVAILABLE",
      reason: "Canonical effect usage service is unavailable.",
    };
  }
  link.usageReservation = this.game.reserveEffectUsage({
    card: link.card,
    player: link.controller,
    effect,
    chainId: link.chainId,
    linkId: link.linkId,
  });
  return link.usageReservation;
}

export function settleUsageForChainLink(link) {
  const snapshot = link?.usageReservation;
  if (!snapshot || snapshot.status !== "reserved") return snapshot || null;
  if (typeof this.game?.settleEffectUsage !== "function") return snapshot;
  link.usageReservation = this.game.settleEffectUsage(snapshot, {
    activationNegated: link.activationNegated === true,
    effectNegated: link.effectNegated === true,
  });
  return link.usageReservation;
}

export function releaseAllUsageReservations(reason = "chain_cancelled") {
  this.game?.releaseEffectUsageReservations?.(reason);
}
