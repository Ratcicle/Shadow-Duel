import { USAGE_POLICIES } from "../../contracts/effects.js";
import type { GameCard, OncePerTurnDefinition } from "../../contracts/cards.js";
import type { EffectDefinition, UsagePolicy } from "../../contracts/effects.js";
import type { EffectUsageEventPayload } from "../../contracts/events.js";
import type { GamePlayer } from "../../contracts/player.js";
import type { TriggerEffectLike } from "../../effects/triggers/runtime.js";

interface EffectUsageInput {
  card?: GameCard | null;
  player?: EffectUsagePlayer | null;
  effect?: EffectDefinition | null;
  chainId?: number | null;
  linkId?: number | null;
}

type EffectUsagePlayer = GamePlayer & {
  oncePerDuelUsageByName?: { [key: string]: number };
};

interface UsageLimitCheck {
  ok: boolean;
  reason?: string;
  remaining?: number;
}

interface EffectUsageReservation {
  reservationId: number;
  policy: UsagePolicy;
  status: "reserved" | "consumed" | "released";
  playerId: string;
  turnKey: string | null;
  duelKey: string | null;
  oncePerTurn: boolean;
  oncePerDuel: boolean;
  chainId: number | null;
  linkId: number | null;
  effectId: string | null;
  sourceInstanceId: number | null;
  card: GameCard | null | undefined;
  player: EffectUsagePlayer;
  effect: EffectDefinition;
}

type EffectUsageSnapshot = Omit<
  EffectUsageReservation,
  "card" | "player" | "effect"
>;

interface EffectUsageHost {
  nextEffectUsageReservationId: number;
  effectUsageReservations: Map<number, EffectUsageReservation>;
  effectEngine?: {
    checkOncePerDuel?(
      card: GameCard | null | undefined,
      player: EffectUsagePlayer,
      effect: EffectDefinition,
    ): UsageLimitCheck;
  } | null;
  getOncePerTurnLockKey?(
    card: GameCard | null | undefined,
    effect: EffectDefinition,
  ): string | null;
  canUseOncePerTurn?(
    card: GameCard | null | undefined,
    player: EffectUsagePlayer,
    effect: EffectDefinition,
  ): UsageLimitCheck;
  markOncePerTurnUsed?(
    card: GameCard | null | undefined,
    player: EffectUsagePlayer,
    effect: EffectDefinition,
    options?: { lockKey: string },
  ): void;
  checkEffectUsage(input?: EffectUsageInput): EffectUsageCheck;
  notify?(eventName: "effect_usage", payload: EffectUsageEventPayload): void;
}

interface EffectUsageCheck extends UsageLimitCheck {
  policy?: UsagePolicy | null;
  code?: string;
  scope?: "turn" | "duel";
  turnKey?: string | null;
  duelKey?: string | null;
}

type EffectUsageSettlement =
  | "activation_negated"
  | "cancelled"
  | "precommit_failure"
  | { activationNegated?: boolean; cancelled?: boolean };

function usagePolicy(
  effect: EffectDefinition | null | undefined,
): UsagePolicy | null {
  return effect?.usagePolicy === USAGE_POLICIES.USE ||
    effect?.usagePolicy === USAGE_POLICIES.ACTIVATE
    ? effect.usagePolicy
    : null;
}

function turnKey(
  game: EffectUsageHost,
  card: GameCard | null | undefined,
  effect: EffectDefinition,
): string | null {
  if (!effect?.oncePerTurn) return null;
  return game.getOncePerTurnLockKey?.(card, effect) ||
    `once_per_turn:${effect.oncePerTurnName || effect.id || card?.name || "effect"}`;
}

function duelKey(
  card: GameCard | null | undefined,
  effect: EffectDefinition,
): string | null {
  if (!effect?.oncePerDuel) return null;
  return effect.oncePerDuelName || effect.id || card?.name || "effect";
}

function compact(reservation: EffectUsageReservation): EffectUsageSnapshot;
function compact(reservation: null | undefined): null;
function compact(
  reservation: EffectUsageReservation | null | undefined,
): EffectUsageSnapshot | null {
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

function consume<
  C extends LimitedUsageCard | null | undefined,
  P extends LimitedUsagePlayer,
  E extends LimitedUsageEffect,
>(
  game: Pick<LimitedUsageSpendHost<C, P, E>, "markOncePerTurnUsed">,
  card: C,
  player: P,
  effect: E,
  reservedTurnKey?: string | null,
): void {
  if (effect?.oncePerTurn) {
    game.markOncePerTurnUsed?.(
      card,
      player,
      effect,
      reservedTurnKey ? { lockKey: reservedTurnKey } : undefined,
    );
  }
  if (effect?.oncePerDuel) {
    markOncePerDuelEffectUsed(card, player, effect);
  }
}

/** Limit metadata read by a spend; EffectDefinition and runtime replacement definitions satisfy it. */
export type LimitedUsageEffect = Partial<OncePerTurnDefinition> &
  Pick<TriggerEffectLike, "id" | "oncePerDuel" | "oncePerDuelName" | "oncePerDuelLimit">;

/** Card projection the once-per-duel ledger keys on. */
export interface LimitedUsageCard {
  readonly name?: string | null;
}

/** Player carrying the once-per-duel ledger written by markOncePerDuelEffectUsed. */
export type LimitedUsagePlayer = Pick<GamePlayer, "id"> & {
  oncePerDuelUsageByName?: { [effectKey: string]: number | boolean };
};

/**
 * Host a spend reads and writes. The once-per-turn accessors are required so
 * every spend of a once-per-turn effect yields a restorable token; restore
 * itself works only on that token and takes no host.
 */
export interface LimitedUsageSpendHost<C, P, E> {
  ensureOncePerTurnUsageFresh(): void;
  getOncePerTurnLockKey(card: C, effect: E): string;
  getOncePerTurnStore(card: C, player: P, effect: E): Map<string, unknown>;
  markOncePerTurnUsed?(card: C, player: P, effect: E, options?: { lockKey: string }): void;
}

/**
 * Previous and written value of each counter a spend touched. A restore puts
 * back the previous value while the counter still holds what the spend wrote,
 * and otherwise removes only this spend's single use.
 */
export interface LimitedUsageSpend {
  readonly turn: {
    readonly store: Map<string, unknown>;
    readonly lockKey: string;
    readonly had: boolean;
    readonly previous: unknown;
    readonly written: unknown;
  } | null;
  readonly duel: {
    readonly player: LimitedUsagePlayer;
    readonly key: string;
    readonly hadLedger: boolean;
    readonly had: boolean;
    readonly previous: number | boolean | undefined;
    readonly written: number | boolean | undefined;
  } | null;
}

/**
 * Spends the usage of a limited effect applied outside a Chain Link, before
 * its cost is paid: no other effect sharing the key can be applied while the
 * cost resolves. The token lets a failed cost or application undo this spend.
 */
export function spendLimitedEffectUsage<
  C extends LimitedUsageCard | null | undefined,
  P extends LimitedUsagePlayer,
  E extends LimitedUsageEffect,
>(
  game: LimitedUsageSpendHost<C, P, E>,
  card: C,
  player: P | null | undefined,
  effect: E,
): LimitedUsageSpend | null {
  if (!player || (!effect.oncePerTurn && !effect.oncePerDuel)) return null;
  let turnBefore: {
    store: Map<string, unknown>;
    lockKey: string;
    had: boolean;
    previous: unknown;
  } | null = null;
  if (effect.oncePerTurn) {
    game.ensureOncePerTurnUsageFresh();
    const lockKey = game.getOncePerTurnLockKey(card, effect);
    const store = game.getOncePerTurnStore(card, player, effect);
    turnBefore = { store, lockKey, had: store.has(lockKey), previous: store.get(lockKey) };
  }
  const duelKey = effect.oncePerDuel ? getOncePerDuelKey(card, effect) : null;
  const ledgerBefore = player.oncePerDuelUsageByName;
  const duelBefore = duelKey
    ? {
      key: duelKey,
      hadLedger: ledgerBefore !== undefined,
      had: ledgerBefore !== undefined && Object.hasOwn(ledgerBefore, duelKey),
      previous: ledgerBefore?.[duelKey],
    }
    : null;
  consume(game, card, player, effect, turnBefore?.lockKey ?? null);
  return {
    turn: turnBefore
      ? { ...turnBefore, written: turnBefore.store.get(turnBefore.lockKey) }
      : null,
    duel: duelBefore
      ? { ...duelBefore, player, written: player.oncePerDuelUsageByName?.[duelBefore.key] }
      : null,
  };
}

/** Uses recorded by a once-per-turn store entry, whatever turn it names. */
function recordedTurnUses(entry: unknown): number {
  if (typeof entry === "number") return 1;
  if (typeof entry !== "object" || entry === null || !("count" in entry)) return 0;
  const count = Math.floor(Number(entry.count));
  return Number.isFinite(count) && count > 0 ? count : 0;
}

/**
 * Undoes a spend whose cost or application failed. While a counter still
 * holds the value the spend wrote, its exact previous value comes back; when
 * another use of the same key followed the spend, only one use is removed.
 */
export function restoreLimitedEffectUsage(spend: LimitedUsageSpend | null): void {
  if (!spend) return;
  const { turn, duel } = spend;
  if (turn && turn.store.has(turn.lockKey)) {
    const current = turn.store.get(turn.lockKey);
    if (current === turn.written) {
      if (turn.had) turn.store.set(turn.lockKey, turn.previous);
      else turn.store.delete(turn.lockKey);
    } else {
      const remaining = recordedTurnUses(current) - 1;
      if (remaining > 0 && typeof current === "object" && current !== null && "turn" in current) {
        turn.store.set(turn.lockKey, { turn: current.turn, count: remaining });
      } else {
        turn.store.delete(turn.lockKey);
      }
    }
  }
  const ledger = duel?.player.oncePerDuelUsageByName;
  if (!duel || !ledger || !Object.hasOwn(ledger, duel.key)) return;
  if (ledger[duel.key] === duel.written) {
    if (duel.had && duel.previous !== undefined) ledger[duel.key] = duel.previous;
    else delete ledger[duel.key];
  } else {
    const remaining = getOncePerDuelUsage(duel.player, duel.key) - 1;
    if (remaining > 0) ledger[duel.key] = remaining;
    else delete ledger[duel.key];
  }
  if (!duel.hadLedger && Object.keys(ledger).length === 0) {
    delete duel.player.oncePerDuelUsageByName;
  }
}

function activeReservationCounts(
  game: EffectUsageHost,
  playerId: string,
  effectTurnKey: string | null,
  effectDuelKey: string | null,
  cardScope: boolean,
): { turn: number; duel: number } {
  let turn = 0;
  let duel = 0;
  for (const reservation of game.effectUsageReservations?.values?.() || []) {
    if (reservation.status !== "reserved") {
      continue;
    }
    const samePlayer = reservation.playerId === playerId;
    if ((samePlayer || cardScope) && effectTurnKey && reservation.turnKey === effectTurnKey) turn += 1;
    if (samePlayer && effectDuelKey && reservation.duelKey === effectDuelKey) duel += 1;
  }
  return { turn, duel };
}

export function checkEffectUsage(
  this: EffectUsageHost,
  input: EffectUsageInput = {},
): EffectUsageCheck {
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
    effect.oncePerTurnScope === "card" || effect.oncePerTurnPerCard === true,
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

export function reserveEffectUsage(
  this: EffectUsageHost,
  input: EffectUsageInput = {},
): EffectUsageSnapshot | (EffectUsageCheck & { success: false }) | null {
  const { card, player, effect } = input;
  if (!effect || !player || (!effect.oncePerTurn && !effect.oncePerDuel)) {
    return null;
  }
  const check = this.checkEffectUsage(input);
  if (check.ok === false) return { ...check, success: false };

  const policy = usagePolicy(effect)!;
  const reservation: EffectUsageReservation = {
    reservationId: this.nextEffectUsageReservationId++,
    policy,
    status: policy === USAGE_POLICIES.USE ? "consumed" : "reserved",
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

  if (policy === USAGE_POLICIES.USE) consume(this, card, player, effect);
  else this.effectUsageReservations.set(reservation.reservationId, reservation);

  const snapshot = compact(reservation);
  this.notify?.("effect_usage", snapshot);
  return snapshot;
}

export function settleEffectUsage(
  this: EffectUsageHost,
  reservationOrId: number | EffectUsageSnapshot | null | undefined,
  outcome: EffectUsageSettlement = {},
): EffectUsageSnapshot | number | null {
  const id =
    typeof reservationOrId === "number"
      ? reservationOrId
      : reservationOrId?.reservationId;
  if (typeof id !== "number" || !Number.isFinite(id)) {
    return reservationOrId || null;
  }
  const reservation = this.effectUsageReservations.get(id);
  if (!reservation) return reservationOrId || null;

  const outcomeObject = typeof outcome === "object" ? outcome : null;
  const activationNegated =
    outcome === "activation_negated" ||
    outcomeObject?.activationNegated === true;
  const cancelled =
    outcome === "cancelled" ||
    outcome === "precommit_failure" ||
    outcomeObject?.cancelled === true;
  if (activationNegated || cancelled) {
    reservation.status = "released";
  } else {
    reservation.status = "consumed";
    consume(
      this,
      reservation.card,
      reservation.player,
      reservation.effect,
      reservation.turnKey,
    );
  }
  this.effectUsageReservations.delete(id);
  const snapshot = compact(reservation);
  this.notify?.("effect_usage", snapshot);
  return snapshot;
}

export function releaseEffectUsageReservations(
  this: EffectUsageHost,
  reason = "reset",
): void {
  for (const reservation of this.effectUsageReservations.values()) {
    reservation.status = "released";
    const snapshot = { ...compact(reservation), reason };
    this.notify?.("effect_usage", snapshot);
  }
  this.effectUsageReservations.clear();
}

export function getEffectUsageState(this: EffectUsageHost) {
  return {
    nextReservationId: this.nextEffectUsageReservationId,
    reservations: [...this.effectUsageReservations.values()]
      .map((reservation) => compact(reservation))
      .sort((a, b) => a.reservationId - b.reservationId),
  };
}
import {
  getOncePerDuelKey,
  getOncePerDuelUsage,
  markOncePerDuelEffectUsed,
} from "../../effects/triggers/registration.js";
