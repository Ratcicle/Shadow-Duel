import { appendSimulatedFieldCard, appendSimulatedZoneCard, clearSimulatedFieldPosition } from "./zones.js";
import { canUseOncePerDuelEffect, markOncePerDuelEffectUsed } from "../../effects/triggers/registration.js";
import type { TriggerEffectLike } from "../../effects/triggers/runtime.js";

/**
 * Remove a card reference from a simulated player zone.
 * This intentionally avoids engine movement hooks; callers use it only on
 * cloned/perspective state during planning.
 */
export function removeFromZone(
  player: Partial<SimulatedPlayerState> | null | undefined,
  zoneName: SimulationZoneName,
  card: SimulatedCardState,
): boolean {
  const zone = player?.[zoneName];
  if (!Array.isArray(zone)) return false;
  const index = zone.indexOf(card);
  if (index < 0) return false;
  zone.splice(index, 1);
  clearSimulatedFieldPosition(card);
  return true;
}

/**
 * Push a card reference into a simulated player zone, creating the zone array
 * when needed. No ownership, event, or UI side effects are applied.
 */
export function pushToZone(
  player: Partial<SimulatedPlayerState> | null | undefined,
  zoneName: SimulationZoneName,
  card: SimulatedCardState | null | undefined,
): void {
  if (!player || !card) return;
  if (!Array.isArray(player[zoneName])) player[zoneName] = [];
  if (zoneName === "field" || zoneName === "spellTrap") {
    appendSimulatedFieldCard(player[zoneName], card);
  } else {
    appendSimulatedZoneCard(player[zoneName], card);
  }
}

/**
 * Return the stable runtime instance id used by AI preference metadata.
 */
export function getCardInstanceId(
  card: AiCardInput | SimulatedCardState | null | undefined,
): string | number | null {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uid ??
    card?.uuid ??
    card?.simInstanceId ??
    null
  );
}

function summarizePlayer(
  player: SimPlayerSummaryInput = {},
  options: SimSignatureOptions = {},
) {
  const getSpellTrapCounters =
    typeof options.getSpellTrapCounters === "function"
      ? options.getSpellTrapCounters
      : () => 0;

  return {
    lp: player.lp || 0,
    hand: (player.hand || []).map((card) => card?.name || "?"),
    field: (player.field || []).map((card) => ({
      name: card?.name || "?",
      position: card?.position || null,
      fieldSlot: card?.fieldSlot ?? null,
      faceDown: !!card?.isFacedown,
      atk: card?.atk || 0,
      def: card?.def || 0,
      tempAtk: card?.tempAtkBoost || 0,
      tempDef: card?.tempDefBoost || 0,
      cannotAttack: !!card?.cannotAttackThisTurn,
      piercing: !!card?.piercing,
      piercingGrantedByEffect: card?.piercingGrantedByEffect === true,
      piercingDamageMultiplier: Number(card?.piercingDamageMultiplier || 1),
      equips: (card?.equips || []).map((equip) => equip?.name || "?"),
    })),
    spellTrap: (player.spellTrap || []).map((card) => ({
      name: card?.name || "?",
      fieldSlot: card?.fieldSlot ?? null,
      faceDown: !!card?.isFacedown,
      counters: getSpellTrapCounters(card),
    })),
    fieldSpell: player.fieldSpell?.name || null,
    graveyard: (player.graveyard || []).map((card) => card?.name || "?"),
    banished: (player.banished || []).map((card) => card?.name || "?"),
    deck: (player.deck || []).map((card) => card?.name || "?"),
  };
}

/**
 * Build a compact, deterministic signature for detecting whether simulated
 * action application changed planning-relevant state.
 */
export function getSimStateSignature(
  state: AiStateInput,
  options: SimSignatureOptions = {},
): string {
  const extraState =
    typeof options.extraState === "function"
      ? options.extraState(state) || {}
      : {};

  return JSON.stringify({
    bot: summarizePlayer(state?.bot as SimPlayerSummaryInput, options),
    player: summarizePlayer(state?.player as SimPlayerSummaryInput, options),
    temporaryControlEffects: state.temporaryControlEffects || [],
    ...extraState,
  });
}

/**
 * Resolve the Set used to mark one-shot simulated effects in a caller-owned
 * bucket. Array buckets from cloned states are normalized back into Sets.
 */
export function ensureSimOptSet(
  state: SimOptState | null | undefined,
  bucketName: SimOptSetKey = "_simOptUsed",
): Set<string> {
  if (!state) return new Set<string>();
  if (Array.isArray(state[bucketName])) {
    state[bucketName] = new Set(state[bucketName]);
  }
  if (!(state[bucketName] instanceof Set)) {
    state[bucketName] = new Set();
  }
  return state[bucketName];
}

/**
 * Mark a simulated one-shot effect as used. Empty keys are treated as
 * unrestricted and therefore return true.
 */
export function useSimOpt(
  state: SimOptState | null | undefined,
  key: string | null | undefined,
  bucketName: SimOptSetKey = "_simOptUsed",
): boolean {
  if (!key) return true;
  const used = ensureSimOptSet(state, bucketName);
  if (used.has(key)) return false;
  used.add(key);
  return true;
}

type SimulationZoneName =
  | "hand"
  | "field"
  | "graveyard"
  | "deck"
  | "extraDeck"
  | "banished"
  | "spellTrap";

type SimOptSetKey = "_simOptUsed" | "_simArcanistOptUsed";
type LegacySimOncePerTurnBucket =
  | Map<string, number>
  | Set<string>
  | ReadonlyArray<string | readonly [string, number]>
  | Readonly<Record<string, number>>;

interface SimOptState {
  _simOptUsed?: Set<string> | string[];
  _simArcanistOptUsed?: Set<string> | string[];
}

type SimOncePerTurnState = {
  _simOncePerTurn?: object;
  _gameTreeActors?: AiStateShape["_gameTreeActors"];
  bot?: { id?: string | null } | null;
  player?: { id?: string | null } | null;
};

interface SimSignatureOptions {
  getSpellTrapCounters?(card: AiCardInput): number;
  extraState?(state: AiStateInput): object | null | undefined;
}

interface SimSummaryCard extends AiCardInput {
  tempAtkBoost?: number;
  tempDefBoost?: number;
  cannotAttackThisTurn?: boolean;
  piercing?: boolean;
  piercingDamageMultiplier?: number;
  piercingGrantedByEffect?: boolean;
}

type SimPlayerSummaryInput = Omit<AiPlayerInput, "field" | "spellTrap"> & {
  field?: readonly SimSummaryCard[];
  spellTrap?: readonly SimSummaryCard[];
};

import type {
  AiCardInput,
  AiPlayerInput,
  AiStateInput,
  AiStateShape,
  SimulatedCardState,
  SimulatedPlayerState,
} from "../../contracts/aiState.js";
import type { EffectUsageMap, EffectUsageEntry } from "../../contracts/cards.js";
import type { UsagePolicy } from "../../contracts/effects.js";

export interface SimulatedUsageEffect {
  id?: string | null;
  oncePerTurn?: boolean;
  oncePerTurnName?: string | null;
  oncePerTurnScope?: "card";
  oncePerTurnPerCard?: boolean;
  oncePerTurnLimit?: number;
  usesPerTurn?: number;
  maxUsesPerTurn?: number;
  usagePolicy?: UsagePolicy;
  oncePerDuel?: boolean;
  oncePerDuelName?: string;
  oncePerDuelLimit?: number;
  oncePerDuelMax?: number;
}

export type SimulatedUsageCard = Pick<SimulatedCardState,
  "name" | "id" | "instanceId" | "duelCardId" | "oncePerTurnResetVersion" | "oncePerTurnUsageByName">;
interface SimulatedUsagePlayer {
  id?: string | null;
  oncePerTurnUsageByName?: EffectUsageMap | undefined;
  oncePerDuelUsageByName?: Record<string, number | boolean>;
}
export interface SimulatedUsageState extends SimOncePerTurnState {
  turnCounter?: number;
  _simOncePerTurnTurn?: number;
  bot?: SimulatedUsagePlayer | null;
  player?: SimulatedUsagePlayer | null;
}

export function getSimulatedEffectUsageKey(
  effect: SimulatedUsageEffect,
  card: SimulatedUsageCard | null | undefined,
): string | null {
  const base = effect.oncePerTurnName || effect.id || card?.name;
  if (!base) return null;
  return effect.oncePerTurnScope === "card" || effect.oncePerTurnPerCard === true
    ? JSON.stringify(["card", card?.duelCardId ?? card?.instanceId ?? card?.id ?? null,
      card?.oncePerTurnResetVersion || 0, base])
    : base;
}

function simulatedUsagePlayer(state: SimulatedUsageState, selfId: string, ownerIsPhysical: boolean) {
  if (!ownerIsPhysical && (selfId === "bot" || selfId === "player")) return state[selfId];
  if (state.bot?.id === selfId) return state.bot;
  if (state.player?.id === selfId) return state.player;
  return null;
}

function prepareSimulatedUsageTurn(state: SimulatedUsageState): number {
  const turn = state.turnCounter || 0;
  if (state._simOncePerTurnTurn !== undefined && state._simOncePerTurnTurn !== turn) {
    state._simOncePerTurn = {};
  }
  state._simOncePerTurnTurn = turn;
  return turn;
}

export function simulatedUsageCount(entry: EffectUsageEntry | undefined, turn: number): number {
  if (typeof entry === "number") return entry === turn ? 1 : 0;
  if (!entry || entry.turn !== turn) return 0;
  return Math.max(0, Math.floor(entry.count || 0));
}

function simulatedUsageLimit(effect: SimulatedUsageEffect): number {
  const limit = Math.floor(effect.oncePerTurnLimit ?? effect.usesPerTurn ?? effect.maxUsesPerTurn ?? 1);
  return Number.isFinite(limit) && limit > 0 ? limit : 1;
}

/** Delegate duel-wide key, limit and legacy boolean counts to the runtime. */
function simulatedDuelUsageEffect(effect: SimulatedUsageEffect): TriggerEffectLike {
  return {
    oncePerDuel: effect.oncePerDuel === true,
    ...(effect.id ? { id: effect.id } : {}),
    ...(effect.oncePerDuelName ? { oncePerDuelName: effect.oncePerDuelName } : {}),
    ...(effect.oncePerDuelLimit !== undefined ? { oncePerDuelLimit: effect.oncePerDuelLimit } : {}),
    ...(effect.oncePerDuelMax !== undefined ? { oncePerDuelMax: effect.oncePerDuelMax } : {}),
  };
}

/** Shared by activated effects and passives; copied runtime records remain read-only. */
export function canUseSimulatedEffectUsage(
  state: SimulatedUsageState | null | undefined,
  effect: SimulatedUsageEffect | null | undefined,
  card: SimulatedUsageCard | null | undefined,
  selfId = "bot",
  ownerIsPhysical = false,
): boolean {
  if (!state || !effect) return true;
  const player = simulatedUsagePlayer(state, selfId, ownerIsPhysical);
  if (effect.oncePerDuel && !canUseOncePerDuelEffect(card?.name ? { name: card.name } : null,
    player ? { oncePerDuelUsageByName: player.oncePerDuelUsageByName || {} } : null,
    simulatedDuelUsageEffect(effect)).ok) return false;
  if (!effect.oncePerTurn && !effect.oncePerTurnName) return true;
  // A preview must not reset the caller's turn or normalize its legacy buckets.
  // Normalization only replaces owner entries; Map contents are read here.
  // Project only the usage fields: spreading the whole state would read every
  // enumerable property, including a planning clone's live `_gameRef`. Owner
  // slots are unnecessary because both bucket lookups below use physical ids.
  const usageView: SimulatedUsageState = {
    ...(state.turnCounter !== undefined ? { turnCounter: state.turnCounter } : {}),
    ...(state._simOncePerTurnTurn !== undefined
      ? { _simOncePerTurnTurn: state._simOncePerTurnTurn } : {}),
    _simOncePerTurn: state._simOncePerTurn && !Array.isArray(state._simOncePerTurn)
      ? { ...state._simOncePerTurn } : {},
  };
  const turn = prepareSimulatedUsageTurn(usageView);
  const key = getSimulatedEffectUsageKey(effect, card);
  if (!key) return true;
  const cardScoped = effect.oncePerTurnScope === "card" || effect.oncePerTurnPerCard === true;
  const persisted = cardScoped
    ? card?.oncePerTurnUsageByName : player?.oncePerTurnUsageByName;
  const base = effect.oncePerTurnName || effect.id || card?.name || "";
  const used = simulatedUsageCount(persisted?.[base], turn);
  const bucket = ensureSimOncePerTurnBucket(usageView, player?.id || selfId, true);
  // A control change retains this card's presence and usage across owner buckets.
  const simulated = cardScoped
    ? Object.keys(usageView._simOncePerTurn || {}).reduce((count, ownerId) =>
      count + Number(ensureSimOncePerTurnBucket(usageView, ownerId, true).get(key) || 0), 0)
    : Number(bucket.get(key) || 0);
  return used + simulated < simulatedUsageLimit(effect);
}

export function markSimulatedEffectUsage(
  state: SimulatedUsageState | null | undefined,
  effect: SimulatedUsageEffect | null | undefined,
  card: SimulatedUsageCard | null | undefined,
  selfId = "bot",
  ownerIsPhysical = false,
  outcome: { activationNegated?: boolean; cancelled?: boolean } = {},
): void {
  if (!state || !effect) return;
  if (outcome.cancelled || (outcome.activationNegated && effect.usagePolicy === "activate")) return;
  const player = simulatedUsagePlayer(state, selfId, ownerIsPhysical);
  if (effect.oncePerDuel && player) {
    const duelPlayer = { oncePerDuelUsageByName: player.oncePerDuelUsageByName || {} };
    markOncePerDuelEffectUsed(card?.name ? { name: card.name } : null, duelPlayer, simulatedDuelUsageEffect(effect));
    player.oncePerDuelUsageByName = duelPlayer.oncePerDuelUsageByName;
  }
  if (!effect.oncePerTurn && !effect.oncePerTurnName) return;
  prepareSimulatedUsageTurn(state);
  const key = getSimulatedEffectUsageKey(effect, card);
  if (key) markSimOncePerTurnUsed(state, key, simulatedUsageLimit(effect), player?.id || selfId, true);
}

/**
 * Resolve the canonical per-player simulated usage bucket.
 *
 * Older planners cloned this metadata as Sets, arrays, or plain objects. Keep
 * accepting those runtime shapes at the boundary, but immediately normalize
 * them to the counted Map representation shared by every simulator.
 */
export function ensureSimOncePerTurnBucket(
  state: SimOncePerTurnState | null | undefined,
  selfId = "bot",
  ownerIsPhysical = false,
): Map<string, number> {
  if (!state) return new Map<string, number>();
  if (
    !state._simOncePerTurn ||
    typeof state._simOncePerTurn !== "object" ||
    Array.isArray(state._simOncePerTurn)
  ) {
    state._simOncePerTurn = {};
  }

  // GameTree rotates the bot/player slots without changing physical owners.
  // Event callers already carry an owner's id, which can itself be "bot" or
  // "player"; those keys must never be interpreted as a rotated slot.
  const ownerKey = state._gameTreeActors && !ownerIsPhysical &&
    (selfId === "bot" || selfId === "player")
    ? state[selfId]?.id || selfId
    : selfId || "bot";
  const current = Reflect.get(state._simOncePerTurn, ownerKey) as
    | LegacySimOncePerTurnBucket
    | undefined;
  if (current instanceof Map) return current;

  const normalized = new Map<string, number>();
  if (current instanceof Set) {
    for (const key of current) normalized.set(key, 1);
  } else if (Array.isArray(current)) {
    for (const entry of current) {
      if (Array.isArray(entry)) {
        const key = entry[0];
        if (typeof key === "string") {
          normalized.set(key, Number(entry[1] || 1));
        }
      } else {
        normalized.set(entry, 1);
      }
    }
  } else if (current && typeof current === "object") {
    for (const [key, count] of Object.entries(current)) {
      normalized.set(key, Number(count || 1));
    }
  }

  Reflect.set(state._simOncePerTurn, ownerKey, normalized);
  return normalized;
}

export function canUseSimOncePerTurn(
  state: SimOncePerTurnState | null | undefined,
  key: string | null | undefined,
  limit = 1,
  selfId = "bot",
  ownerIsPhysical = false,
): boolean {
  if (!key) return true;
  const bucket = ensureSimOncePerTurnBucket(state, selfId, ownerIsPhysical);
  const normalizedLimit = Math.max(1, Math.floor(Number(limit)) || 1);
  return Number(bucket.get(key) || 0) < normalizedLimit;
}

export function markSimOncePerTurnUsed(
  state: SimOncePerTurnState | null | undefined,
  key: string | null | undefined,
  limit = 1,
  selfId = "bot",
  ownerIsPhysical = false,
): void {
  if (!key) return;
  const bucket = ensureSimOncePerTurnBucket(state, selfId, ownerIsPhysical);
  const normalizedLimit = Math.max(1, Math.floor(Number(limit)) || 1);
  bucket.set(
    key,
    Math.min(normalizedLimit, Number(bucket.get(key) || 0) + 1),
  );
}
