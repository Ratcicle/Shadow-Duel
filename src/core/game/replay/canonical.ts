import { cardDatabase } from "../../../data/cards.js";
import type { CardConstructorData } from "../../contracts/cards.js";
import type { EffectDefinition } from "../../contracts/effects.js";
import {
  CANONICAL_REPLAY_EVENT_NAMES,
  CANONICAL_REPLAY_FORMAT,
  CANONICAL_REPLAY_SCHEMA_VERSION,
} from "../../contracts/replay.js";
import type {
  CanonicalCardStateSnapshot,
  CanonicalGameStateSnapshot,
  CanonicalPlayerStateSnapshot,
  CanonicalPlayerZonesSnapshot,
  CanonicalProcedureStateSnapshot,
  CanonicalReplayEventName,
  CanonicalReplayGamePort,
  ReplayRuntimeCard,
  ReplayRuntimePlayer,
  SerializableObject,
  SerializableValue,
} from "../../contracts/replay.js";

export {
  CANONICAL_REPLAY_FORMAT,
  CANONICAL_REPLAY_SCHEMA_VERSION,
};

const REPLAY_EVENT_NAME_SET: ReadonlySet<string> = new Set(
  CANONICAL_REPLAY_EVENT_NAMES,
);
const SKIPPED_RUNTIME_KEYS: ReadonlySet<string> = new Set([
  "game",
  "renderer",
  "ui",
  "strategy",
  "effects",
  "image",
]);

type SpecialProjection = (
  value: object,
) => SerializableValue | undefined;

function readProperty(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function identityScalar(value: unknown): SerializableValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return String(value);
  return null;
}

function cycleIdentity(value: object): SerializableValue {
  const duelCardId = readProperty(value, "duelCardId");
  const instanceId = readProperty(value, "instanceId");
  if (duelCardId != null || instanceId != null) {
    return {
      duelCardId: identityScalar(duelCardId),
      instanceId: identityScalar(instanceId),
    };
  }
  const id = readProperty(value, "id");
  if (id != null) {
    return { id: identityScalar(id) };
  }
  return null;
}

function normalizeValue(
  value: unknown,
  stack: WeakSet<object>,
  project?: SpecialProjection,
): SerializableValue | undefined {
  if (value == null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return String(value);
  if (
    typeof value === "undefined" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return undefined;
  }
  if (typeof value !== "object") return String(value);

  const projected = project?.(value);
  if (projected !== undefined) return projected;
  if (stack.has(value)) return cycleIdentity(value);

  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return Array.from(
        { length: value.length },
        (_, index) =>
          Object.prototype.hasOwnProperty.call(value, index)
            ? normalizeValue(value[index], stack, project) ?? null
            : null,
      );
    }
    if (value instanceof Map) {
      return [...value.entries()]
        .map(([key, entry]) => [
          String(key),
          normalizeValue(entry, stack, project) ?? null,
        ] satisfies SerializableValue[])
        .sort((left, right) => compareCodeUnits(String(left[0]), String(right[0])));
    }
    if (value instanceof Set) {
      return [...value].map((entry, index) => {
        const normalized = normalizeValue(entry, stack, project) ?? null;
        return {
          normalized,
          canonical: JSON.stringify(normalized),
          index,
        };
      }).sort((left, right) =>
        compareCodeUnits(left.canonical, right.canonical) || left.index - right.index
      ).map(({ normalized }) => normalized);
    }

    const output: SerializableObject = {};
    for (const key of Object.keys(value).sort(compareCodeUnits)) {
      if (SKIPPED_RUNTIME_KEYS.has(key)) continue;
      const normalized = normalizeValue(readProperty(value, key), stack, project);
      if (normalized !== undefined) output[key] = normalized;
    }
    return output;
  } finally {
    stack.delete(value);
  }
}

function stableValue(value: unknown): SerializableValue | undefined {
  return normalizeValue(value, new WeakSet());
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value)) ?? "null";
}

export function hashCanonicalValue(value: unknown): string {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

type SignatureCardDefinition = Pick<CardConstructorData,
  "id" | "name" | "mustFirstBeSpecialSummonedBy" | "effects"
>;

export function getCardDatabaseSignature(): string {
  return hashCanonicalValue(
    cardDatabase.map((card: SignatureCardDefinition) => ({
      id: card.id,
      name: card.name,
      mustFirstBeSpecialSummonedBy:
        card.mustFirstBeSpecialSummonedBy || null,
      effects: (card.effects || []).map((effect: EffectDefinition) => ({
        id: effect.id || null,
        activationZones: effect.activationZones || null,
        usagePolicy: effect.usagePolicy || null,
        damageStepTimings: effect.damageStepTimings || null,
        activationCommitActions: effect.activationCommitActions || null,
      })),
    })),
  );
}

function numericValue(value: unknown): number {
  return Number(value ?? 0);
}

function cardState(
  game: CanonicalReplayGamePort,
  card: ReplayRuntimeCard | null | undefined,
): CanonicalCardStateSnapshot | null {
  if (!card) return null;
  game.ensureDuelCardId?.(card);
  return {
    duelCardId: card.duelCardId ?? null,
    cardId: card.id ?? null,
    owner: card.owner ?? null,
    controller: card.controller ?? card.owner ?? null,
    originalOwner: card.originalOwner ?? null,
    locationVersion: numericValue(card.locationVersion),
    lastSummonMethod: card.lastSummonMethod || null,
    lastSummonedFromZone: card.lastSummonedFromZone || null,
    properSummonEstablished: card.properSummonEstablished === true,
    properSummonProcedure: card.properSummonProcedure || null,
    position: card.position || null,
    facedown: card.isFacedown === true,
    atk: numericValue(card.atk),
    def: numericValue(card.def),
    baseAtk: numericValue(card.baseAtk),
    baseDef: numericValue(card.baseDef),
    level: numericValue(card.level),
    baseLevel: Number(card.baseLevel ?? card.level ?? 0),
    counters: stableValue(card.counters || {}) ?? {},
    equipTargetId: card.equippedTo?.duelCardId ?? null,
    statuses: {
      effectsNegated: card.effectsNegated === true,
      effectsNegatedDuration: card.effectsNegatedDuration || null,
      cannotAttackThisTurn: card.cannotAttackThisTurn === true,
      battlePositionLocked: card.battlePositionLocked === true,
      banishWhenLeavesField: card.banishWhenLeavesField === true,
    },
  };
}

function playerState(
  game: CanonicalReplayGamePort,
  player: ReplayRuntimePlayer | null | undefined,
): CanonicalPlayerStateSnapshot {
  const zones: CanonicalPlayerZonesSnapshot = {
    deck: (player?.deck || []).map((card) => cardState(game, card)),
    extraDeck: (player?.extraDeck || []).map((card) => cardState(game, card)),
    hand: (player?.hand || []).map((card) => cardState(game, card)),
    field: (player?.field || []).map((card) => cardState(game, card)),
    spellTrap: (player?.spellTrap || []).map((card) => cardState(game, card)),
    graveyard: (player?.graveyard || []).map((card) => cardState(game, card)),
    banished: (player?.banished || []).map((card) => cardState(game, card)),
    fieldSpell: player?.fieldSpell ? cardState(game, player.fieldSpell) : null,
  };
  return {
    id: player?.id ?? null,
    lp: numericValue(player?.lp),
    zones,
    summonCount: Number(player?.summonCount || 0),
    additionalNormalSummons: Number(player?.additionalNormalSummons || 0),
    oncePerDuelUsage: stableValue(player?.oncePerDuelUsageByName || {}) ?? {},
    restrictions: stableValue({
      specialSummon: player?.specialSummonRestrictions || [],
      effectActivation: player?.effectActivationRestrictions || [],
      directAttackForbidden: player?.forbidDirectAttacksThisTurn === true,
    }) ?? {},
  };
}

function procedureState(value: unknown): CanonicalProcedureStateSnapshot | null {
  const normalized = stableValue(value);
  if (
    normalized === null ||
    Array.isArray(normalized) ||
    typeof normalized !== "object"
  ) {
    return null;
  }
  if (
    typeof normalized.active !== "boolean" ||
    normalized.transaction === undefined ||
    normalized.last === undefined
  ) {
    return null;
  }
  return {
    active: normalized.active,
    last: normalized.last,
    transaction: normalized.transaction,
  };
}

export function createCanonicalStateSnapshot(
  game: CanonicalReplayGamePort,
): CanonicalGameStateSnapshot {
  const usage = game.getEffectUsageState?.() || null;
  return {
    turn: game.turn ?? null,
    phase: game.phase ?? null,
    turnCounter: Number(game.turnCounter || 0),
    random: game.getRandomState?.() || null,
    players: {
      player: playerState(game, game.player),
      bot: playerState(game, game.bot),
    },
    usage,
    delayedActions: stableValue(game.delayedActions || []) ?? [],
    temporaryEventEffects: stableValue(game.temporaryEventEffects || []) ?? [],
    temporaryControlEffects: stableValue(
      game.getTemporaryControlState?.() || game.temporaryControlEffects || [],
    ) ?? [],
    chain: {
      links: stableValue(game.chainSystem?.getChainSummary?.() || []) ?? [],
      state: stableValue(game.chainSystem?.getPublicState?.() || null) ?? null,
      timing: stableValue(game.chainSystem?.getFastEffectState?.() || null) ?? null,
      triggers: stableValue(game.chainSystem?.getTriggerState?.() || null) ?? null,
    },
    summon: procedureState(game.getSummonState?.() || null),
    combat: procedureState(game.getDamageStepState?.() || null),
  };
}

export function hashCanonicalGameState(game: CanonicalReplayGamePort): string {
  return hashCanonicalValue(createCanonicalStateSnapshot(game));
}

export function serializeReplayEventPayload(
  game: CanonicalReplayGamePort,
  payload: unknown,
): SerializableValue | undefined {
  const project: SpecialProjection = (value) => {
    const duelCardId = readProperty(value, "duelCardId");
    const cardKind = readProperty(value, "cardKind");
    const name = readProperty(value, "name");
    if (duelCardId != null || (cardKind && name)) {
      game.ensureDuelCardId?.(value);
      const projection: SerializableObject = {
        duelCardId: stableValue(readProperty(value, "duelCardId")) ?? null,
        cardId: stableValue(readProperty(value, "id")) ?? null,
        locationVersion: Number(readProperty(value, "locationVersion") ?? 0),
      };
      return projection;
    }
    const id = readProperty(value, "id");
    if (id === "player" || id === "bot") {
      const projection: SerializableObject = { playerId: id };
      return projection;
    }
    return undefined;
  };
  return normalizeValue(payload, new WeakSet(), project);
}

export function isReplayEvent(
  eventName: unknown,
): eventName is CanonicalReplayEventName {
  return typeof eventName === "string" && REPLAY_EVENT_NAME_SET.has(eventName);
}

export { validateCanonicalReplay } from "./validation.js";
