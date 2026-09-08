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
  player[zoneName].push(card);
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
      faceDown: !!card?.isFacedown,
      atk: card?.atk || 0,
      def: card?.def || 0,
      tempAtk: card?.tempAtkBoost || 0,
      tempDef: card?.tempDefBoost || 0,
      cannotAttack: !!card?.cannotAttackThisTurn,
      piercing: !!card?.piercing,
      piercingDamageMultiplier: Number(card?.piercingDamageMultiplier || 1),
      equips: (card?.equips || []).map((equip) => equip?.name || "?"),
    })),
    spellTrap: (player.spellTrap || []).map((card) => ({
      name: card?.name || "?",
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

type SimOncePerTurnState = Pick<AiStateShape, "_simOncePerTurn"> | {
  _simOncePerTurn?: object;
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
): Map<string, number> {
  if (!state) return new Map<string, number>();
  if (
    !state._simOncePerTurn ||
    typeof state._simOncePerTurn !== "object" ||
    Array.isArray(state._simOncePerTurn)
  ) {
    state._simOncePerTurn = {};
  }

  const ownerKey = selfId || "bot";
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
): boolean {
  if (!key) return true;
  const bucket = ensureSimOncePerTurnBucket(state, selfId);
  const normalizedLimit = Math.max(1, Math.floor(Number(limit)) || 1);
  return Number(bucket.get(key) || 0) < normalizedLimit;
}

export function markSimOncePerTurnUsed(
  state: SimOncePerTurnState | null | undefined,
  key: string | null | undefined,
  limit = 1,
  selfId = "bot",
): void {
  if (!key) return;
  const bucket = ensureSimOncePerTurnBucket(state, selfId);
  const normalizedLimit = Math.max(1, Math.floor(Number(limit)) || 1);
  bucket.set(
    key,
    Math.min(normalizedLimit, Number(bucket.get(key) || 0) + 1),
  );
}
