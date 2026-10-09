import { getNegationContributions } from "../../effects/negation.js";
import { hasChainPostEffectSummonCapability } from "../../contracts/chainRuntime.js";
import { projectAfterResolutionReferences, projectAfterResolutionSource, copyCostPayment } from "../../chain/link.js";
import { serializeChainResponseDecisions } from "../decisions/chainResponse.js";
import { projectOncePerTurnUsage } from "../turn/oncePerTurn.js";
import { getTurnCardActivations } from "../events/activationHistory.js";
import { cardDatabase } from "../../../data/cards.js";
import type { RawCardDefinition } from "../../contracts/cards.js";
import {
  CANONICAL_REPLAY_EVENT_NAMES,
  CANONICAL_REPLAY_FORMAT,
  CANONICAL_REPLAY_SCHEMA_VERSION,
} from "../../contracts/replay.js";
import type {
  CanonicalCardCharacteristicsSnapshot,
  CanonicalCardStateSnapshot,
  CanonicalGameStateSnapshot,
  CanonicalPlayerStateSnapshot,
  CanonicalPlayerZonesSnapshot,
  CanonicalProcedureStateSnapshot,
  CanonicalReplayEventName,
  CanonicalReplayGamePort,
  CanonicalRuleStateSnapshot,
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

// Process-local runtime ids (`instanceId`, `sourceInstanceId`, `firstInstanceId`, ...).
const INSTANCE_ID_KEY = /instanceId$/i;

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
  skipRuntimeKeys = true,
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
            ? normalizeValue(value[index], stack, project, skipRuntimeKeys) ?? null
            : null,
      );
    }
    if (value instanceof Map) {
      return [...value.entries()]
        .map(([key, entry]) => [
          String(key),
          normalizeValue(entry, stack, project, skipRuntimeKeys) ?? null,
        ] satisfies SerializableValue[])
        .sort((left, right) => compareCodeUnits(String(left[0]), String(right[0])));
    }
    if (value instanceof Set) {
      return [...value].map((entry, index) => {
        const normalized = normalizeValue(entry, stack, project, skipRuntimeKeys) ?? null;
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
      if (skipRuntimeKeys && SKIPPED_RUNTIME_KEYS.has(key)) continue;
      const normalized = normalizeValue(readProperty(value, key), stack, project, skipRuntimeKeys);
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
  return hashCanonicalText(stableStringify(value));
}

function hashCanonicalText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function getCardDatabaseSignature(
  definitions: readonly RawCardDefinition[] = cardDatabase,
): string {
  // Definitions contain rules, not live references: never strip their effects.
  const normalized = normalizeValue(definitions, new WeakSet(), undefined, false);
  return hashCanonicalText(JSON.stringify(normalized) ?? "null");
}

function numericValue(value: unknown): number {
  return Number(value ?? 0);
}

function readString(value: object, key: string): string | null {
  const field = readProperty(value, key);
  return typeof field === "string" ? field : null;
}

function readFlag(value: object, key: string): boolean {
  return readProperty(value, key) === true;
}

function readSerializable(
  value: object,
  key: string,
  fallback: SerializableValue,
): SerializableValue {
  return stableValue(readProperty(value, key) ?? fallback) ?? fallback;
}

/** A status baseline registry: the value to restore and the value in effect. */
function statusRegistryState(card: object, registryKey: string): SerializableValue {
  const registry = readProperty(card, registryKey);
  if (!registry || typeof registry !== "object") return {};
  return stableValue(Object.fromEntries(Object.keys(registry).map(status => [status, {
    previous: readProperty(registry, status) ?? null,
    current: readProperty(card, status) ?? null,
  }]))) ?? {};
}

function cardCharacteristics(card: ReplayRuntimeCard): CanonicalCardCharacteristicsSnapshot {
  return {
    cardKind: readString(card, "cardKind"),
    originalCardKind: readString(card, "originalCardKind"),
    treatedAsCardKinds: readSerializable(card, "treatedAsCardKinds", []),
    isTrapMonster: readFlag(card, "isTrapMonster"),
    trapMonsterSummonProcedure: readSerializable(card, "trapMonsterSummonProcedure", null),
    trapMonsterOriginalState: readSerializable(card, "trapMonsterOriginalState", null),
    monsterType: readString(card, "monsterType"),
    type: readString(card, "type"),
    types: readSerializable(card, "types", []),
    attribute: readString(card, "attribute"),
    subtype: readString(card, "subtype"),
    isTuner: readFlag(card, "isTuner"),
    synchroMaterialRoles: readSerializable(card, "synchroMaterialRoles", null),
    isToken: readFlag(card, "isToken"),
  };
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
    oncePerTurnResetVersion: numericValue(card.oncePerTurnResetVersion),
    oncePerTurnUsageByName: game.oncePerTurnTurnCounter === undefined || game.oncePerTurnTurnCounter === game.turnCounter
      ? projectOncePerTurnUsage(game.oncePerTurnUsage?.card?.get(card),
        `:card:${String(card.duelCardId)}:presence:${String(card.oncePerTurnResetVersion || 0)}`, game.turnCounter)
      : {},
    lastSummonMethod: card.lastSummonMethod || null,
    lastSummonedFromZone: card.lastSummonedFromZone || null,
    properSummonEstablished: card.properSummonEstablished === true,
    properSummonProcedure: card.properSummonProcedure || null,
    position: card.position || null,
    attacksUsedThisTurn: card.attacksUsedThisTurn ?? 0,
    hasAttacked: card.hasAttacked ?? false,
    summonedTurn: card.summonedTurn ?? null,
    positionChangedThisTurn: card.positionChangedThisTurn ?? false,
    fieldSlot: card.fieldSlot ?? null,
    fieldPresenceId: card.fieldPresenceId ?? null,
    fieldPresenceState: { ...(card.fieldPresenceState || {}) },
    fieldPresenceSummons: (card.fieldPresenceSummons || []).map(entry => ({ ...entry })),
    protectionEffects: (card.protectionEffects || []).map(entry => ({ ...entry })),
    ...(card.state?.blueprintStorage?.storedBlueprints.length
      ? { blueprintStorage: stableValue(card.state.blueprintStorage.storedBlueprints) ?? [] }
      : {}),
    facedown: card.isFacedown === true,
    atk: numericValue(card.atk),
    def: numericValue(card.def),
    baseAtk: numericValue(card.baseAtk),
    baseDef: numericValue(card.baseDef),
    level: numericValue(card.level),
    baseLevel: Number(card.baseLevel ?? card.level ?? 0),
    originalLevel: card.originalLevel ?? null,
    levelModificationContributions: (card.levelModificationContributions || []).map(entry => ({ ...entry })),
    ...(card.declaredValues ? { declaredValues: Object.fromEntries(Object.entries(card.declaredValues).map(([key, value]) =>
      [key, typeof value === "object" ? {
        property: value.property,
        value: value.value,
        ...(value.declaredOnTurn !== undefined ? { declaredOnTurn: value.declaredOnTurn } : {}),
        ...(value.expiresOnTurn !== undefined ? { expiresOnTurn: value.expiresOnTurn } : {}),
        ...(value.duration !== undefined ? { duration: value.duration } : {}),
      } : value],
    )) } : {}),
    ...(card.permanentBuffsBySource ? {
      statBuffContributions: Object.values(card.permanentBuffsBySource).map(entry => ({
        atk: entry.atk ?? 0,
        def: entry.def ?? 0,
        duration: entry.duration ?? "until_field_exit" as const,
      })).sort((left, right) => left.atk - right.atk || left.def - right.def ||
        compareCodeUnits(left.duration, right.duration)),
    } : {}),
    counters: stableValue(card.counters || {}) ?? {},
    equipTargetId: card.equippedTo?.duelCardId ?? null,
    statuses: {
      ...(card.attackLimitThisTurn != null ? {
        attackLimit: { amount: card.attackLimitThisTurn, duration: card.attackLimitDuration ?? "until_end_turn" },
      } : {}),
      ...(Object.keys(card.faceupStatuses || {}).length ? {
        faceupStatuses: stableValue(Object.fromEntries(Object.entries(card.faceupStatuses || {}).map(([status, previous]) => [status, {
          previous: previous ?? null,
          current: Reflect.get(card, status) ?? null,
        }]))) ?? {},
      } : {}),
      effectsNegated: card.effectsNegated === true,
      effectsNegatedDuration: card.effectsNegatedDuration || null,
      effectsNegationContributions: getNegationContributions(card).map(entry => ({ ...entry })),
      cannotAttackThisTurn: card.cannotAttackThisTurn === true,
      battlePositionLocked: card.battlePositionLocked === true,
      banishWhenLeavesField: card.banishWhenLeavesField === true,
      piercing: card.piercing === true,
      piercingDamageMultiplier: Number(card.piercingDamageMultiplier ?? 1),
      piercingGrantedByEffect: card.piercingGrantedByEffect === true,
      battleIndestructible: readFlag(card, "battleIndestructible"),
      tempBattleIndestructible: readFlag(card, "tempBattleIndestructible"),
      battleDamageHealsControllerThisTurn: readFlag(card, "battleDamageHealsControllerThisTurn"),
      extraAttacks: numericValue(readProperty(card, "extraAttacks")),
    },
    characteristics: cardCharacteristics(card),
    statusRegistries: {
      temporary: statusRegistryState(card, "tempStatuses"),
      fieldExit: statusRegistryState(card, "fieldExitStatuses"),
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
    lpGainedThisTurn: numericValue(player?.lpGainedThisTurn),
    zones,
    summonCount: Number(player?.summonCount || 0),
    additionalNormalSummons: Number(player?.additionalNormalSummons || 0),
    damageReceivedThisTurn: numericValue(player?.damageReceivedThisTurn),
    normalSummonsThisTurn: stableValue(player?.normalSummonsThisTurn || []) ?? [],
    additionalNormalSummonPermissions: stableValue(player?.additionalNormalSummonPermissions || []) ?? [],
    // Derived from face-up passives on board refresh, but read between refreshes.
    lpGainMultiplier: Number(player?.lpGainMultiplier ?? 1),
    opponentCannotActivateDuringBattle: player?.opponentCannotActivateDuringBattle === true,
    oncePerDuelUsage: stableValue(player?.oncePerDuelUsageByName || {}) ?? {},
    restrictions: stableValue({
      specialSummon: player?.specialSummonRestrictions || [],
      effectActivation: player?.effectActivationRestrictions || [],
      directAttackForbidden: player?.forbidDirectAttacksThisTurn === true,
      directAttacksDeclaredThisTurn: Number(player?.directAttacksDeclaredThisTurn || 0),
    }) ?? {},
  };
}

function projectCardIdentitySnapshot(entry: object): SerializableValue | undefined {
  if (readProperty(entry, "duelCardId") == null || !Object.hasOwn(entry, "instanceId") || !Object.hasOwn(entry, "cardId")) return undefined;
  // Transaction snapshots keep runtime IDs for diagnostics. Replay hashes use
  // only the identity allocated within the duel, also for each paid cost.
  const identity: SerializableObject = {};
  for (const key of Object.keys(entry).sort(compareCodeUnits)) {
    if (key === "instanceId") continue;
    const field = stableValue(readProperty(entry, key));
    if (field !== undefined) identity[key] = field;
  }
  return identity;
}

function procedureState(value: unknown): CanonicalProcedureStateSnapshot | null {
  const normalized = normalizeValue(value, new WeakSet(), entry => {
    if (Object.hasOwn(entry, "destructionDuelCardIds") && Object.hasOwn(entry, "movedAtEndDuelCardIds")) {
      const outcome: SerializableObject = {};
      for (const key of Object.keys(entry)) {
        if (key === "destructionInstanceIds" || key === "movedAtEndInstanceIds") continue;
        const field = stableValue(readProperty(entry, key));
        if (field !== undefined) outcome[key] = field;
      }
      return outcome;
    }
    return projectCardIdentitySnapshot(entry);
  });
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

/**
 * Rule records keep their facts; cards become duel identities, and process-local
 * instance ids, plus record ids built from them, are dropped. The deterministic
 * counters behind those record ids are hashed through `generatedIdCounters`.
 */
function serializeRuleRecords(
  game: CanonicalReplayGamePort,
  value: unknown,
): SerializableValue {
  const project: SpecialProjection = (entry) => {
    const card = projectRuntimeCardReference(game, entry);
    if (card !== undefined) return card;
    if (Array.isArray(entry) || entry instanceof Map || entry instanceof Set) return undefined;
    const keys = Object.keys(entry);
    const derivesFromInstance = keys.includes("sourceInstanceId");
    if (!derivesFromInstance && !keys.some(key => INSTANCE_ID_KEY.test(key))) return undefined;
    const record: SerializableObject = {};
    for (const key of keys.sort(compareCodeUnits)) {
      if (INSTANCE_ID_KEY.test(key) || (derivesFromInstance && key === "id")) continue;
      if (SKIPPED_RUNTIME_KEYS.has(key)) continue;
      const field = normalizeValue(readProperty(entry, key), new WeakSet(), project);
      if (field !== undefined) record[key] = field;
    }
    return record;
  };
  return normalizeValue(value, new WeakSet(), project) ?? null;
}

function synchroContinuationState(
  game: CanonicalReplayGamePort,
  value: unknown,
): SerializableValue {
  if (!value || typeof value !== "object") return null;
  const summonedCard = readProperty(value, "summonedCard");
  return {
    stage: stableValue(readProperty(value, "stage")) ?? null,
    synchroSummonContextId: stableValue(readProperty(value, "synchroSummonContextId")) ?? null,
    summonedCard: summonedCard && typeof summonedCard === "object"
      ? projectRuntimeCardReference(game, summonedCard) ?? null
      : null,
    playerId: stableValue(readProperty(value, "playerId")) ?? null,
  };
}

function ruleState(game: CanonicalReplayGamePort): CanonicalRuleStateSnapshot {
  return {
    gameOver: game.gameOver === true,
    winner: game.winner ?? null,
    battleStep: game.battleStep ?? null,
    lastAttackNegated: game.lastAttackNegated === true,
    damageCalculationStatChangePending: game.damageCalculationStatChangePending === true,
    damageCalculationTempBuffs: serializeRuleRecords(game, game.damageCalculationTempBuffs || []),
    endOfDamageStepTempBuffs: serializeRuleRecords(game, game.endOfDamageStepTempBuffs || []),
    temporaryBattlePairEffects: serializeRuleRecords(game, game.temporaryBattlePairEffects || []),
    pendingSynchroMaterialFollowups: serializeRuleRecords(game, game.pendingSynchroMaterialFollowups || []),
    pendingSynchroMaterialTriggerContinuation:
      synchroContinuationState(game, game.pendingSynchroMaterialTriggerContinuation),
    synchroSummonContextCounter: Number(game.synchroSummonContextCounter || 0),
    eventResolutionCounter: Number(game.eventResolutionCounter || 0),
    generatedIdCounters: stableValue(game.generatedIdCounters || new Map()) ?? [],
    // Keyed by player and card definition id; inner Sets are sorted canonically.
    materialDuelStats: stableValue(game.materialDuelStats || {}) ?? {},
    specialSummonTypeCounts: stableValue(game.specialSummonTypeCounts || {}) ?? {},
  };
}

export function createCanonicalStateSnapshot(
  game: CanonicalReplayGamePort,
): CanonicalGameStateSnapshot {
  const usage = game.getEffectUsageState?.() || null;
  const controlState = game.getTemporaryControlState?.() || game.temporaryControlEffects || [];
  const canonicalControl = normalizeValue(controlState, new WeakSet(), (entry) => {
    if (!Object.hasOwn(entry, "cardInstanceId")) return undefined;
    const record: SerializableObject = {};
    for (const key of Object.keys(entry)) {
      const value = readProperty(entry, key);
      if (key === "cardInstanceId" || key === "sourceInstanceId") {
        continue;
      } else record[key] = stableValue(value) ?? null;
    }
    return record;
  });
  const canonicalEventEffects = normalizeValue(game.temporaryEventEffects || [], new WeakSet(), (entry) => {
    if (!Object.hasOwn(entry, "sourceDuelCardId") || !Object.hasOwn(entry, "boundEventTargetDuelCardId")) return undefined;
    const record: SerializableObject = {};
    for (const key of Object.keys(entry)) {
      // Runtime links use process-local instance IDs. Registered duel identities
      // survive even if the source/target has disappeared from every zone.
      if (key === "sourceInstanceId" || key === "boundEventTargetInstanceId") continue;
      const value = stableValue(readProperty(entry, key));
      if (value !== undefined) record[key] = value;
    }
    return record;
  });
  const canonicalReplacements = normalizeValue(game.temporaryReplacementEffects || [], new WeakSet(), entry => {
    if (Object.hasOwn(entry, "targetPresences")) {
      const record: SerializableObject = {};
      for (const key of Object.keys(entry)) {
        if (key === "targetCards" || key === "targetInstanceIds") continue;
        if (key === "targetPresences") {
          record[key] = normalizeValue(readProperty(entry, key), new WeakSet(), presence => {
            if (Array.isArray(presence)) return undefined;
            return {
              duelCardId: stableValue(readProperty(presence, "duelCardId")) ?? null,
              locationVersion: Number(readProperty(presence, "locationVersion") ?? 0),
              fieldPresenceId: stableValue(readProperty(presence, "fieldPresenceId")) ?? null,
            };
          }) ?? [];
        } else {
          const value = stableValue(readProperty(entry, key));
          if (value !== undefined) record[key] = value;
        }
      }
      return record;
    }
    return undefined;
  });
  const replacementSequence = game.generatedIdCounters?.get("temporary_replacement") || 0;
  return {
    fieldPlacementSequence: game.generatedIdCounters?.get("field_placement") || 0,
    turn: game.turn ?? null,
    phase: game.phase ?? null,
    turnCounter: Number(game.turnCounter || 0),
    ...(getTurnCardActivations(game).length ? {
      cardActivationHistory: stableValue(getTurnCardActivations(game)) ?? [],
    } : {}),
    random: game.getRandomState?.() || null,
    players: {
      player: playerState(game, game.player),
      bot: playerState(game, game.bot),
    },
    usage,
    namedOncePerTurnUsage: stableValue({
      turn: game.oncePerTurnTurnCounter ?? null,
      player: game.oncePerTurnUsage?.player || new Map(),
      bot: game.oncePerTurnUsage?.bot || new Map(),
    }) ?? null,
    delayedActions: serializeReplayEventPayload(game, game.delayedActions || []) ?? [],
    temporaryEventEffects: canonicalEventEffects ?? [],
    temporaryControlEffects: canonicalControl ?? [],
    ruleState: ruleState(game),
    ...(game.temporaryReplacementEffects?.length ? { temporaryReplacementEffects: canonicalReplacements ?? [] } : {}),
    ...(replacementSequence ? { temporaryReplacementSequence: replacementSequence } : {}),
    chain: {
      links: stableValue(game.chainSystem?.getChainSummary?.() || []) ?? [],
      state: stableValue(game.chainSystem?.getPublicState?.() || null) ?? null,
      timing: stableValue(game.chainSystem?.getFastEffectState?.() || null) ?? null,
      triggers: stableValue(game.chainSystem?.getTriggerState?.() || null) ?? null,
      ...(hasChainPostEffectSummonCapability(game.chainSystem) && game.chainSystem.getAfterResolutionState()
        ? { afterResolution: stableValue(game.chainSystem.getAfterResolutionState()) ?? null }
        : getDirectAfterResolutionSnapshot(game) ? { afterResolution: stableValue(getDirectAfterResolutionSnapshot(game)) ?? null } : {}),
    },
    summon: procedureState(game.getSummonState?.() || null),
    combat: procedureState(game.getDamageStepState?.() || null),
  };
}

export function hashCanonicalGameState(game: CanonicalReplayGamePort): string {
  return hashCanonicalValue(createCanonicalStateSnapshot(game));
}

/** Detached direct-activation metadata uses duel identities, never runtime card objects. */
export function getDirectAfterResolutionSnapshot(game: Pick<CanonicalReplayGamePort, "afterResolutionActivation" | "player" | "bot" | "ensureDuelCardId">): object | null {
  const state = game.afterResolutionActivation;
  if (!state || state.completed) return null;
  const results: Record<string, (number | null)[]> = {};
  const cards = [game.player, game.bot].flatMap(player => player ? [
    ...(player.deck || []), ...(player.extraDeck || []), ...(player.hand || []), ...(player.field || []),
    ...(player.spellTrap || []), ...(player.graveyard || []), ...(player.banished || []), ...(player.fieldSpell ? [player.fieldSpell] : []),
  ] : []);
  for (const [ref, value] of Object.entries(state.context._actionTargets || {})) {
    results[ref] = (Array.isArray(value) ? value : [value]).map(card => {
      const physical = card && "card" in card ? card.card : card;
      return physical?.duelCardId ?? null;
    });
  }
  return { direct: { stage: "after_resolution", sourceDuelCardId: state.source.duelCardId ?? null,
    sourceCardId: state.source.id, controllerId: state.player.id, effectId: state.effect.id,
    sourceAtActivation: projectAfterResolutionSource(state.context.activationContext?.sourceAtActivation, state.source.duelCardId ?? null),
    ...(state.referenceSnapshots ? { referenceSnapshots: projectAfterResolutionReferences(state.referenceSnapshots) } : {}),
    costPayment: state.context.activationContext?.costPayment ? copyCostPayment(state.context.activationContext.costPayment) : null,
    ...(state.context.activationContext?.decisions ? { decisions: serializeChainResponseDecisions(state.context.activationContext.decisions, id => {
      const card = cards.find(card => String(readProperty(card, "instanceId")) === String(id));
      if (card) return game.ensureDuelCardId?.(card) ?? card.duelCardId ?? null;
      return state.decisionCards?.find(card => String(card.instanceId) === String(id))?.duelCardId ?? null;
    }) } : {}),
    actionIndex: state.actionIndex, selectionGeneration: state.selectionGeneration, results } };
}

/** Physical cards and players referenced from runtime records, by duel identity. */
function projectRuntimeCardReference(
  game: CanonicalReplayGamePort,
  value: object,
): SerializableValue | undefined {
  const identity = projectCardIdentitySnapshot(value);
  if (identity !== undefined) return identity;
  const duelCardId = readProperty(value, "duelCardId");
  const cardKind = readProperty(value, "cardKind");
  const name = readProperty(value, "name");
  // Declarative filters and Token templates also carry a name and kind.
  // Only physical runtime instances may receive a new duel identity.
  const runtimeInstance = typeof readProperty(value, "instanceId") === "number" &&
    typeof cardKind === "string" && typeof name === "string";
  if (duelCardId != null || runtimeInstance) {
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
}

export function serializeReplayEventPayload(
  game: CanonicalReplayGamePort,
  payload: unknown,
): SerializableValue | undefined {
  return normalizeValue(payload, new WeakSet(), value => projectRuntimeCardReference(game, value));
}

export function isReplayEvent(
  eventName: unknown,
): eventName is CanonicalReplayEventName {
  return typeof eventName === "string" && REPLAY_EVENT_NAME_SET.has(eventName);
}

export { validateCanonicalReplay } from "./validation.js";
