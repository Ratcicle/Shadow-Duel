import { USAGE_POLICIES } from "../contracts/effects.js";
import type { UsagePolicy } from "../contracts/effects.js";
import type {
  ChainCard,
  ChainEffect,
  ChainLink,
  ChainPlayer,
  ChainUsageCheck,
  ChainUsageReservation,
  FullChainHost,
} from "../contracts/chainRuntime.js";

export { USAGE_POLICIES };

function getPolicy(effect?: ChainEffect | null): UsagePolicy | null {
  return effect?.usagePolicy === USAGE_POLICIES.USE ||
    effect?.usagePolicy === USAGE_POLICIES.ACTIVATE
    ? effect.usagePolicy
    : null;
}

export function getUsagePolicy(
  this: FullChainHost,
  effect?: ChainEffect | null,
): UsagePolicy | null {
  return getPolicy(effect);
}

export function checkActivationUsage(
  this: FullChainHost,
  card: ChainCard,
  player: ChainPlayer,
  effect: ChainEffect,
): ChainUsageCheck {
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

export function reserveUsageForChainLink(
  this: FullChainHost,
  link: ChainLink,
): ChainUsageReservation | null {
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

export function settleUsageForChainLink(
  this: FullChainHost,
  link: ChainLink,
): ChainUsageReservation | null {
  const snapshot = link?.usageReservation;
  if (!snapshot || snapshot.status !== "reserved") return snapshot || null;
  if (typeof this.game?.settleEffectUsage !== "function") return snapshot;
  link.usageReservation = this.game.settleEffectUsage(snapshot, {
    activationNegated: link.activationNegated === true,
    effectNegated: link.effectNegated === true,
  });
  return link.usageReservation;
}

export function releaseAllUsageReservations(
  this: FullChainHost,
  reason = "chain_cancelled",
): void {
  this.game?.releaseEffectUsageReservations?.(reason);
}
