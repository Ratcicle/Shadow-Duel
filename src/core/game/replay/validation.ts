import { SELECTION_KINDS } from "../../contracts/selection.js";
import {
  CANONICAL_REPLAY_COMMAND_TYPES,
  CANONICAL_REPLAY_ENGINE_VERSION,
} from "../../contracts/replay.js";
import type {
  CanonicalReplay,
  CanonicalReplayCommandType,
} from "../../contracts/replay.js";
import {
  CANONICAL_REPLAY_FORMAT,
  CANONICAL_REPLAY_SCHEMA_VERSION,
  getCardDatabaseSignature,
  isReplayEvent,
} from "./canonical.js";

const COMMAND_TYPES: ReadonlySet<string> = new Set(
  CANONICAL_REPLAY_COMMAND_TYPES,
);
const DECISION_KINDS: ReadonlySet<string> = new Set([
  ...SELECTION_KINDS,
  "target_selection",
  "chain_response",
  "segoc_order",
]);
const PHASES: ReadonlySet<string> = new Set([
  "draw",
  "standby",
  "main1",
  "battle",
  "main2",
  "end",
]);
const POSITIONS: ReadonlySet<string> = new Set(["attack", "defense"]);
const CARD_ZONES: ReadonlySet<string> = new Set([
  "deck",
  "extraDeck",
  "hand",
  "field",
  "spellTrap",
  "graveyard",
  "banished",
  "fieldSpell",
]);
const EXTRA_DECK_SUMMON_TYPES: ReadonlySet<string> = new Set([
  "synchro",
  "ascension",
  "procedure",
]);
const HASH_PATTERN = /^[0-9a-f]{8}$/;

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function read(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function invalid(path: string, expectation: string): never {
  throw new Error(`Invalid canonical replay ${path}: expected ${expectation}.`);
}

function requireObject(value: unknown, path: string): object {
  if (!isObject(value)) invalid(path, "an object");
  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, "an array");
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") invalid(path, "a string");
  return value;
}

function requireNullableString(value: unknown, path: string): void {
  if (value !== null && typeof value !== "string") {
    invalid(path, "a string or null");
  }
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(path, "a finite number");
  }
  return value;
}

function requireInteger(
  value: unknown,
  path: string,
  minimum = Number.MIN_SAFE_INTEGER,
): number {
  const numeric = requireFiniteNumber(value, path);
  if (!Number.isSafeInteger(numeric) || numeric < minimum) {
    invalid(path, `a safe integer greater than or equal to ${minimum}`);
  }
  return numeric;
}

function requireBoolean(value: unknown, path: string): void {
  if (typeof value !== "boolean") invalid(path, "a boolean");
}

function requirePlayerId(value: unknown, path: string, nullable = true): void {
  if (nullable && value === null) return;
  if (value !== "player" && value !== "bot") {
    invalid(path, nullable ? '"player", "bot", or null' : '"player" or "bot"');
  }
}

function requirePhase(value: unknown, path: string, nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !PHASES.has(value)) {
    invalid(path, nullable ? "a duel phase or null" : "a duel phase");
  }
}

function requirePosition(value: unknown, path: string, nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !POSITIONS.has(value)) {
    invalid(path, nullable ? "a battle position or null" : "a battle position");
  }
}

function requireHash(value: unknown, path: string): void {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    invalid(path, "a lowercase eight-character hexadecimal hash");
  }
}

function requireIdentity(value: unknown, path: string, nullable = false): void {
  if (nullable && value === null) return;
  requireInteger(value, path, 1);
}

function assertSerializable(
  value: unknown,
  path: string,
  stack = new WeakSet<object>(),
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid(path, "a finite JSON number");
    return;
  }
  if (typeof value !== "object") invalid(path, "a JSON-serializable value");
  if (stack.has(value)) invalid(path, "an acyclic JSON-serializable value");
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      invalid(path, "a plain JSON object");
    }
    const symbolKeys = Object.getOwnPropertySymbols(value).filter((key) =>
      Object.prototype.propertyIsEnumerable.call(value, key)
    );
    if (symbolKeys.length > 0) invalid(path, "an object without symbol keys");
  }

  stack.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!hasOwn(value, String(index))) {
          invalid(`${path}[${index}]`, "a present JSON array value");
        }
        assertSerializable(value[index], `${path}[${index}]`, stack);
      }
      return;
    }
    for (const key of Object.keys(value)) {
      assertSerializable(read(value, key), `${path}.${key}`, stack);
    }
  } finally {
    stack.delete(value);
  }
}

function validateRandomState(value: unknown, path: string): void {
  if (value === null) return;
  const state = requireObject(value, path);
  requireInteger(read(state, "seed"), `${path}.seed`, 0);
  requireInteger(read(state, "state"), `${path}.state`, 0);
  requireInteger(read(state, "calls"), `${path}.calls`, 0);
}

function validateDeck(value: unknown, path: string): void {
  for (const [index, entryValue] of requireArray(value, path).entries()) {
    const entry = requireObject(entryValue, `${path}[${index}]`);
    requireInteger(read(entry, "id"), `${path}[${index}].id`, 1);
    requireIdentity(
      read(entry, "duelCardId"),
      `${path}[${index}].duelCardId`,
    );
  }
}

function validateSetup(value: unknown): void {
  const setup = requireObject(value, "setup");
  const seed = read(setup, "seed");
  if (
    typeof seed !== "string" &&
    !(typeof seed === "number" && Number.isFinite(seed))
  ) {
    invalid("setup.seed", "a finite number or string");
  }
  validateRandomState(read(setup, "randomState"), "setup.randomState");
  requirePlayerId(read(setup, "startingPlayer"), "setup.startingPlayer");
  validateDeck(read(setup, "playerDeck"), "setup.playerDeck");
  validateDeck(read(setup, "playerExtraDeck"), "setup.playerExtraDeck");
  validateDeck(read(setup, "botDeck"), "setup.botDeck");
  validateDeck(read(setup, "botExtraDeck"), "setup.botExtraDeck");
}

function validateCardLocator(payload: object, path: string): void {
  const duelCardId = read(payload, "duelCardId");
  const cardId = read(payload, "cardId");
  if (duelCardId != null) requireIdentity(duelCardId, `${path}.duelCardId`);
  if (cardId != null) requireIdentity(cardId, `${path}.cardId`);
  if (duelCardId == null && cardId == null) {
    invalid(path, "a non-null duelCardId or cardId");
  }
}

function validateNumberArray(value: unknown, path: string, minimum = 0): void {
  for (const [index, entry] of requireArray(value, path).entries()) {
    requireInteger(entry, `${path}[${index}]`, minimum);
  }
}

function validateCommandPayload(
  type: CanonicalReplayCommandType,
  value: unknown,
  path: string,
): void {
  const payload = requireObject(value, path);
  switch (type) {
    case "noop":
    case "shuffle":
      return;
    case "draw":
      if (hasOwn(payload, "amount")) {
        requireInteger(read(payload, "amount"), `${path}.amount`, 1);
      }
      return;
    case "set_phase":
      requirePhase(read(payload, "phase"), `${path}.phase`);
      return;
    case "set_lp":
      requireFiniteNumber(read(payload, "lp"), `${path}.lp`);
      return;
    case "phase_intent":
      if (hasOwn(payload, "fromPhase")) {
        requirePhase(read(payload, "fromPhase"), `${path}.fromPhase`);
      }
      if (hasOwn(payload, "toPhase")) {
        requirePhase(read(payload, "toPhase"), `${path}.toPhase`, true);
      }
      return;
    case "summon":
    case "set_monster":
      validateCardLocator(payload, path);
      if (hasOwn(payload, "position")) {
        requirePosition(read(payload, "position"), `${path}.position`, true);
      }
      if (hasOwn(payload, "facedown")) {
        requireBoolean(read(payload, "facedown"), `${path}.facedown`);
      }
      if (hasOwn(payload, "tributeIndices") && read(payload, "tributeIndices") !== null) {
        validateNumberArray(read(payload, "tributeIndices"), `${path}.tributeIndices`);
      }
      return;
    case "set_spell_trap":
    case "flip_summon":
      validateCardLocator(payload, path);
      return;
    case "extra_deck_summon": {
      validateCardLocator(payload, path);
      if (hasOwn(payload, "summonType")) {
        const summonType = requireString(
          read(payload, "summonType"),
          `${path}.summonType`,
        );
        if (!EXTRA_DECK_SUMMON_TYPES.has(summonType)) {
          invalid(`${path}.summonType`, "a supported Extra Deck summon type");
        }
      }
      if (hasOwn(payload, "position")) {
        requirePosition(read(payload, "position"), `${path}.position`, true);
      }
      if (hasOwn(payload, "materialIds")) {
        validateNumberArray(read(payload, "materialIds"), `${path}.materialIds`, 1);
      }
      return;
    }
    case "activate_effect":
    case "activate_card":
      validateCardLocator(payload, path);
      if (hasOwn(payload, "sourceZone")) {
        if (
          !CARD_ZONES.has(
            requireString(read(payload, "sourceZone"), `${path}.sourceZone`),
          )
        ) {
          invalid(`${path}.sourceZone`, "a replay card zone");
        }
      }
      if (hasOwn(payload, "effectId")) {
        requireNullableString(read(payload, "effectId"), `${path}.effectId`);
      }
      return;
    case "change_position":
      validateCardLocator(payload, path);
      requirePosition(read(payload, "position"), `${path}.position`);
      return;
    case "attack":
      requireIdentity(read(payload, "attackerId"), `${path}.attackerId`);
      if (hasOwn(payload, "targetId")) {
        requireIdentity(read(payload, "targetId"), `${path}.targetId`, true);
      }
  }
}

function validateSequencedEntries(
  entries: unknown[],
  path: string,
  validate: (entry: object, entryPath: string) => void,
): void {
  let previousSequence = 0;
  for (const [index, entryValue] of entries.entries()) {
    const entryPath = `${path}[${index}]`;
    const entry = requireObject(entryValue, entryPath);
    const sequence = requireInteger(read(entry, "sequence"), `${entryPath}.sequence`, 1);
    if (sequence <= previousSequence) {
      invalid(`${entryPath}.sequence`, "a strictly increasing positive sequence");
    }
    previousSequence = sequence;
    validate(entry, entryPath);
  }
}

function validateCommands(value: unknown): void {
  validateSequencedEntries(requireArray(value, "commands"), "commands", (entry, path) => {
    const type = requireString(read(entry, "type"), `${path}.type`);
    if (!COMMAND_TYPES.has(type)) {
      throw new Error(`Unsupported canonical replay command "${type}".`);
    }
    requirePlayerId(read(entry, "actorId"), `${path}.actorId`);
    validateCommandPayload(
      type as CanonicalReplayCommandType,
      read(entry, "payload"),
      `${path}.payload`,
    );
    if (hasOwn(entry, "stateHash") && read(entry, "stateHash") != null) {
      requireHash(read(entry, "stateHash"), `${path}.stateHash`);
    }
  });
}

function validateCandidateIdentity(value: unknown, path: string): void {
  if (
    typeof value !== "string" &&
    !(typeof value === "number" && Number.isFinite(value))
  ) {
    invalid(path, "a string or finite number");
  }
}

function validateCandidateDecisionValue(value: object, path: string): void {
  if (read(value, "pass") === true) return;
  if (read(value, "pass") !== false) invalid(`${path}.pass`, "a boolean");
  const candidateKey = read(value, "candidateKey");
  if (candidateKey !== null) validateCandidateIdentity(candidateKey, `${path}.candidateKey`);
  requireNullableString(read(value, "effectId"), `${path}.effectId`);
}

function validateSelectionIdentity(value: unknown, path: string): void {
  const identity = requireObject(value, path);
  const identityKeys = ["duelCardId", "candidateKey", "key"];
  if (!identityKeys.some((key) => read(identity, key) != null)) {
    invalid(path, "a replay selection candidate identity");
  }
  if (hasOwn(identity, "duelCardId")) {
    requireIdentity(read(identity, "duelCardId"), `${path}.duelCardId`, true);
  }
  if (hasOwn(identity, "cardId")) {
    const cardId = read(identity, "cardId");
    if (cardId !== null && typeof cardId !== "string") {
      requireIdentity(cardId, `${path}.cardId`);
    }
  }
  if (hasOwn(identity, "effectId")) {
    requireNullableString(read(identity, "effectId"), `${path}.effectId`);
  }
  for (const key of ["candidateKey", "key"] as const) {
    if (hasOwn(identity, key) && read(identity, key) !== null) {
      validateCandidateIdentity(read(identity, key), `${path}.${key}`);
    }
  }
}

function validateSelectionDecisionValue(value: object, path: string): void {
  if (hasOwn(value, "selections")) {
    const selections = requireObject(read(value, "selections"), `${path}.selections`);
    for (const requirementId of Object.keys(selections)) {
      const identities = requireArray(
        read(selections, requirementId),
        `${path}.selections.${requirementId}`,
      );
      identities.forEach((identity, index) =>
        validateSelectionIdentity(
          identity,
          `${path}.selections.${requirementId}[${index}]`,
        )
      );
    }
    return;
  }
  if (hasOwn(value, "orderedCandidateKeys")) {
    const keys = requireArray(
      read(value, "orderedCandidateKeys"),
      `${path}.orderedCandidateKeys`,
    );
    keys.forEach((key, index) =>
      validateCandidateIdentity(key, `${path}.orderedCandidateKeys[${index}]`)
    );
    return;
  }
  validateCandidateDecisionValue(value, path);
}

function validateDecisionContext(kind: string, value: unknown, path: string): void {
  if (value === null) return;
  const context = requireObject(value, path);
  if (kind === "chain_response") {
    requireNullableString(read(context, "type"), `${path}.type`);
    for (const key of ["chainId", "respondingToLinkId"]) {
      const identity = read(context, key);
      if (identity !== null) validateCandidateIdentity(identity, `${path}.${key}`);
    }
    return;
  }
  if (kind === "segoc_order") {
    requireNullableString(read(context, "group"), `${path}.group`);
    requireBoolean(read(context, "optional"), `${path}.optional`);
  }
}

function validateDecisionValue(kind: string, value: unknown, path: string): void {
  const decisionValue = requireObject(value, path);
  if (kind === "chain_response") {
    validateCandidateDecisionValue(decisionValue, path);
    return;
  }
  if (kind === "segoc_order") {
    if (read(decisionValue, "pass") === true) return;
    const keys = requireArray(
      read(decisionValue, "orderedCandidateKeys"),
      `${path}.orderedCandidateKeys`,
    );
    keys.forEach((key, index) =>
      validateCandidateIdentity(key, `${path}.orderedCandidateKeys[${index}]`)
    );
    return;
  }
  validateSelectionDecisionValue(decisionValue, path);
}

function validateDecisions(value: unknown): void {
  validateSequencedEntries(requireArray(value, "decisions"), "decisions", (entry, path) => {
    requireInteger(read(entry, "decisionId"), `${path}.decisionId`, 1);
    const kind = requireString(read(entry, "kind"), `${path}.kind`);
    if (!DECISION_KINDS.has(kind)) invalid(`${path}.kind`, "a supported decision kind");
    requireNullableString(read(entry, "actorId"), `${path}.actorId`);
    requireArray(read(entry, "candidateKeys"), `${path}.candidateKeys`).forEach(
      (key, index) => validateCandidateIdentity(key, `${path}.candidateKeys[${index}]`),
    );
    validateDecisionValue(kind, read(entry, "value"), `${path}.value`);
    validateDecisionContext(kind, read(entry, "context"), `${path}.context`);
  });
}

function validateCardSnapshot(value: unknown, path: string): void {
  if (value === null) return;
  const card = requireObject(value, path);
  requireIdentity(read(card, "duelCardId"), `${path}.duelCardId`, true);
  requireIdentity(read(card, "cardId"), `${path}.cardId`, true);
  for (const key of [
    "owner",
    "controller",
    "originalOwner",
    "lastSummonMethod",
    "lastSummonedFromZone",
    "properSummonProcedure",
    "position",
  ]) {
    requireNullableString(read(card, key), `${path}.${key}`);
  }
  for (const key of [
    "locationVersion",
    "atk",
    "def",
    "baseAtk",
    "baseDef",
    "level",
    "baseLevel",
  ]) {
    requireFiniteNumber(read(card, key), `${path}.${key}`);
  }
  requireBoolean(read(card, "properSummonEstablished"), `${path}.properSummonEstablished`);
  requireBoolean(read(card, "facedown"), `${path}.facedown`);
  if (!hasOwn(card, "counters")) invalid(`${path}.counters`, "a serialized value");
  requireIdentity(read(card, "equipTargetId"), `${path}.equipTargetId`, true);
  const statuses = requireObject(read(card, "statuses"), `${path}.statuses`);
  if (!hasOwn(statuses, "effectsNegatedDuration")) {
    invalid(`${path}.statuses.effectsNegatedDuration`, "a serialized value");
  }
  for (const key of [
    "effectsNegated",
    "cannotAttackThisTurn",
    "battlePositionLocked",
    "banishWhenLeavesField",
  ]) {
    requireBoolean(read(statuses, key), `${path}.statuses.${key}`);
  }
}

function validatePlayerSnapshot(value: unknown, path: string): void {
  const player = requireObject(value, path);
  requireNullableString(read(player, "id"), `${path}.id`);
  requireFiniteNumber(read(player, "lp"), `${path}.lp`);
  requireFiniteNumber(read(player, "summonCount"), `${path}.summonCount`);
  requireFiniteNumber(
    read(player, "additionalNormalSummons"),
    `${path}.additionalNormalSummons`,
  );
  for (const key of ["oncePerDuelUsage", "restrictions"]) {
    if (!hasOwn(player, key)) invalid(`${path}.${key}`, "a serialized value");
  }
  const zones = requireObject(read(player, "zones"), `${path}.zones`);
  for (const zone of [
    "deck",
    "extraDeck",
    "hand",
    "field",
    "spellTrap",
    "graveyard",
    "banished",
  ]) {
    requireArray(read(zones, zone), `${path}.zones.${zone}`).forEach((card, index) =>
      validateCardSnapshot(card, `${path}.zones.${zone}[${index}]`)
    );
  }
  validateCardSnapshot(read(zones, "fieldSpell"), `${path}.zones.fieldSpell`);
}

function validateProcedureSnapshot(value: unknown, path: string): void {
  if (value === null) return;
  const procedure = requireObject(value, path);
  requireBoolean(read(procedure, "active"), `${path}.active`);
  for (const key of ["last", "transaction"]) {
    if (!hasOwn(procedure, key)) invalid(`${path}.${key}`, "a serialized value");
  }
}

function validateStateSnapshot(value: unknown, path: string): void {
  const snapshot = requireObject(value, path);
  requireNullableString(read(snapshot, "turn"), `${path}.turn`);
  requireNullableString(read(snapshot, "phase"), `${path}.phase`);
  requireFiniteNumber(read(snapshot, "turnCounter"), `${path}.turnCounter`);
  validateRandomState(read(snapshot, "random"), `${path}.random`);
  const players = requireObject(read(snapshot, "players"), `${path}.players`);
  validatePlayerSnapshot(read(players, "player"), `${path}.players.player`);
  validatePlayerSnapshot(read(players, "bot"), `${path}.players.bot`);
  const chain = requireObject(read(snapshot, "chain"), `${path}.chain`);
  for (const key of ["state", "links", "timing", "triggers"]) {
    if (!hasOwn(chain, key)) invalid(`${path}.chain.${key}`, "a serialized value");
  }
  for (const key of [
    "usage",
    "delayedActions",
    "temporaryEventEffects",
    "temporaryControlEffects",
  ]) {
    if (!hasOwn(snapshot, key)) invalid(`${path}.${key}`, "a serialized value");
  }
  validateProcedureSnapshot(read(snapshot, "summon"), `${path}.summon`);
  validateProcedureSnapshot(read(snapshot, "combat"), `${path}.combat`);
}

function validateEvents(value: unknown): void {
  validateSequencedEntries(requireArray(value, "events"), "events", (entry, path) => {
    const eventName = read(entry, "event");
    if (!isReplayEvent(eventName)) invalid(`${path}.event`, "a supported replay event");
    requireInteger(read(entry, "turn"), `${path}.turn`, 0);
    requirePhase(read(entry, "phase"), `${path}.phase`, true);
    if (!hasOwn(entry, "payload")) invalid(`${path}.payload`, "a serialized value");
  });
}

function validateResult(value: unknown): void {
  if (value === null) return;
  const result = requireObject(value, "result");
  if (hasOwn(result, "winner")) {
    requireNullableString(read(result, "winner"), "result.winner");
  }
  if (hasOwn(result, "reason")) {
    requireNullableString(read(result, "reason"), "result.reason");
  }
  if (hasOwn(result, "finalStateHash") && read(result, "finalStateHash") !== null) {
    requireHash(read(result, "finalStateHash"), "result.finalStateHash");
  }
  if (hasOwn(result, "finalState")) {
    validateStateSnapshot(read(result, "finalState"), "result.finalState");
  }
}

export function validateCanonicalReplay(input: unknown): CanonicalReplay {
  const replay = isObject(input) ? input : null;
  const format = replay ? read(replay, "format") : undefined;
  if (format !== CANONICAL_REPLAY_FORMAT) {
    const legacy = replay
      ? read(replay, "reportVersion") ||
        read(replay, "version") ||
        read(replay, "schemaVersion")
      : undefined;
    throw new Error(
      `Unsupported replay format${legacy ? ` (legacy/report version ${legacy})` : ""}; expected ${CANONICAL_REPLAY_FORMAT}.`,
    );
  }
  if (replay === null) {
    throw new Error(
      `Unsupported replay format; expected ${CANONICAL_REPLAY_FORMAT}.`,
    );
  }
  const schemaVersion = read(replay, "schemaVersion");
  if (schemaVersion !== CANONICAL_REPLAY_SCHEMA_VERSION) {
    throw new Error(`Unsupported canonical replay schema ${schemaVersion}.`);
  }
  if (read(replay, "cardDatabaseSignature") !== getCardDatabaseSignature()) {
    throw new Error("Replay card database signature does not match this build.");
  }
  const setup = read(replay, "setup");
  const commands = read(replay, "commands");
  const decisions = read(replay, "decisions");
  if (!setup || !Array.isArray(commands) || !Array.isArray(decisions)) {
    throw new Error("Canonical replay is missing setup, commands, or decisions.");
  }

  if (
    hasOwn(replay, "engineVersion") &&
    read(replay, "engineVersion") !== CANONICAL_REPLAY_ENGINE_VERSION
  ) {
    invalid("engineVersion", `"${CANONICAL_REPLAY_ENGINE_VERSION}"`);
  }
  validateSetup(setup);
  validateCommands(commands);
  validateDecisions(decisions);
  if (hasOwn(replay, "events")) validateEvents(read(replay, "events"));
  if (hasOwn(replay, "result")) validateResult(read(replay, "result"));
  if (hasOwn(replay, "finalized")) {
    requireBoolean(read(replay, "finalized"), "finalized");
    if (read(replay, "finalized") === true && read(replay, "result") == null) {
      invalid("result", "a result when finalized is true");
    }
  }
  assertSerializable(replay, "$replay");
  return replay as CanonicalReplay;
}
