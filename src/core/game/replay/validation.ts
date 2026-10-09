import { CHAIN_RESOLUTION_STATUSES, CHAIN_FINALIZATION_STATUSES, FAST_EFFECT_STATES, FAST_EFFECT_ORIGINS, SEGOC_GROUPS, TRIGGER_ELIGIBILITY_STATUSES } from "../../contracts/chain.js";
import { TRIGGER_REQUIREMENTS, TRIGGER_TIMINGS } from "../../contracts/effects.js";
import { SELECTION_KINDS } from "../../contracts/selection.js";
import { readChainResponseDecisions } from "../decisions/chainResponse.js";
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
  "field_placement",
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

/** Validate only optional paid scalar evidence on serialized Chain links. */
function validatePaidReferenceMetadata(value: unknown, path: string): void {
  if (!isObject(value)) return;
  const payment = read(value, "costPayment");
  if (isObject(payment) && hasOwn(payment, "paidReferences")) {
    const mapPath = `${path}.costPayment.paidReferences`;
    const references = requireObject(read(payment, "paidReferences"), mapPath);
    for (const ref of Object.keys(references)) {
      const referencePath = `${mapPath}.${ref}`;
      const entries = requireArray(read(references, ref), referencePath);
      entries.forEach((value, index) => {
        const entryPath = `${referencePath}[${index}]`;
        const entry = requireObject(value, entryPath);
        requireIdentity(read(entry, "cardDuelCardId"), `${entryPath}.cardDuelCardId`, true);
        requireString(read(entry, "name"), `${entryPath}.name`);
        if (requireFiniteNumber(read(entry, "level"), `${entryPath}.level`) < 0) {
          invalid(`${entryPath}.level`, "a nonnegative finite Level");
        }
        if (Object.keys(entry).some(key => !["cardDuelCardId", "name", "level"].includes(key))) {
          invalid(entryPath, "only canonical paid identity, name and Level scalars");
        }
      });
    }
  }
}

function assertSerializable(
  value: unknown,
  path: string,
  stack = new WeakSet<object>(),
): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
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
      Object.prototype.propertyIsEnumerable.call(value, key),
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
    requireIdentity(read(entry, "duelCardId"), `${path}[${index}].duelCardId`);
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
      if (
        hasOwn(payload, "mode") &&
        read(payload, "mode") !== "next" && read(payload, "mode") !== "skip"
      ) {
        invalid(`${path}.mode`, "next or skip");
      }
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
      if (
        hasOwn(payload, "tributeIndices") &&
        read(payload, "tributeIndices") !== null
      ) {
        validateNumberArray(
          read(payload, "tributeIndices"),
          `${path}.tributeIndices`,
        );
      }
      return;
    case "set_spell_trap":
    case "flip_summon":
      validateCardLocator(payload, path);
      return;
    case "hand_summon_procedure":
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
        validateNumberArray(
          read(payload, "materialIds"),
          `${path}.materialIds`,
          1,
        );
      }
      if (hasOwn(payload, "counterSourceIds")) {
        if (type !== "hand_summon_procedure") invalid(`${path}.counterSourceIds`, "a hand procedure counter cost");
        validateNumberArray(read(payload, "counterSourceIds"), `${path}.counterSourceIds`, 1);
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
      return;
    default:
      // All canonical commands are covered; keep the defensive runtime no-op.
      (type) satisfies never;
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
    const sequence = requireInteger(
      read(entry, "sequence"),
      `${entryPath}.sequence`,
      1,
    );
    if (sequence <= previousSequence) {
      invalid(
        `${entryPath}.sequence`,
        "a strictly increasing positive sequence",
      );
    }
    previousSequence = sequence;
    validate(entry, entryPath);
  }
}

function validateCommands(value: unknown): void {
  validateSequencedEntries(
    requireArray(value, "commands"),
    "commands",
    (entry, path) => {
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
    },
  );
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
  if (candidateKey !== null)
    validateCandidateIdentity(candidateKey, `${path}.candidateKey`);
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
    const selections = requireObject(
      read(value, "selections"),
      `${path}.selections`,
    );
    for (const requirementId of Object.keys(selections)) {
      const identities = requireArray(
        read(selections, requirementId),
        `${path}.selections.${requirementId}`,
      );
      identities.forEach((identity, index) =>
        validateSelectionIdentity(
          identity,
          `${path}.selections.${requirementId}[${index}]`,
        ),
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
      validateCandidateIdentity(key, `${path}.orderedCandidateKeys[${index}]`),
    );
    return;
  }
  validateCandidateDecisionValue(value, path);
}

function validateDecisionContext(
  kind: string,
  value: unknown,
  path: string,
): void {
  if (value === null && kind !== "field_placement") return;
  const context = requireObject(value, path);
  if (read(context, "type") === "chain_response_reference") {
    if (kind !== "choice") invalid(path, "a choice context for a Chain response reference");
    requireIdentity(read(context, "chainId"), `${path}.chainId`);
    requireIdentity(read(context, "respondingToLinkId"), `${path}.respondingToLinkId`);
    requireIdentity(read(context, "sourceDuelCardId"), `${path}.sourceDuelCardId`, true);
    requireNullableString(read(context, "effectId"), `${path}.effectId`);
    return;
  }
  if (kind === "field_placement") {
    requireString(read(context, "procedureId"), `${path}.procedureId`);
    for (const key of ["decidingPlayerId", "destinationPlayerId"]) {
      const player = read(context, key);
      if (player !== "player" && player !== "bot") invalid(`${path}.${key}`, "a player id");
    }
    const row = read(context, "row");
    if (row !== "field" && row !== "spellTrap") invalid(`${path}.row`, "field or spellTrap");
    requireIdentity(read(context, "duelCardId"), `${path}.duelCardId`, false);
    requireBoolean(read(context, "allowCancel"), `${path}.allowCancel`);
    return;
  }
  if (kind === "chain_response") {
    requireNullableString(read(context, "type"), `${path}.type`);
    for (const key of ["chainId", "respondingToLinkId"]) {
      const identity = read(context, key);
      if (identity !== null)
        validateCandidateIdentity(identity, `${path}.${key}`);
    }
    return;
  }
  if (kind === "segoc_order") {
    requireNullableString(read(context, "group"), `${path}.group`);
    requireBoolean(read(context, "optional"), `${path}.optional`);
  }
}

function validateDecisionValue(
  kind: string,
  value: unknown,
  path: string,
): void {
  const decisionValue = requireObject(value, path);
  if (kind === "field_placement") {
    if (read(decisionValue, "outcome") === "cancelled") return;
    if (read(decisionValue, "outcome") !== "chosen") invalid(`${path}.outcome`, "chosen or cancelled");
    const slot = requireInteger(read(decisionValue, "slot"), `${path}.slot`, 0);
    if (slot > 4) invalid(`${path}.slot`, "an integer between 0 and 4");
    return;
  }
  if (kind === "chain_response") {
    validateCandidateDecisionValue(decisionValue, path);
    const allowedKeys = read(decisionValue, "pass") === true
      ? ["pass"]
      : ["pass", "candidateKey", "effectId", "decisions"];
    if (Object.keys(decisionValue).some(key => !allowedKeys.includes(key))) {
      invalid(path, "a Chain response identity and typed choices only");
    }
    if (hasOwn(decisionValue, "decisions") &&
        !readChainResponseDecisions(read(decisionValue, "decisions"), id => id, true)) {
      invalid(`${path}.decisions`, "valid duel-local Chain response choices");
    }
    return;
  }
  if (kind === "segoc_order") {
    if (read(decisionValue, "pass") === true) return;
    const keys = requireArray(
      read(decisionValue, "orderedCandidateKeys"),
      `${path}.orderedCandidateKeys`,
    );
    keys.forEach((key, index) =>
      validateCandidateIdentity(key, `${path}.orderedCandidateKeys[${index}]`),
    );
    return;
  }
  validateSelectionDecisionValue(decisionValue, path);
}

function validateDecisions(value: unknown): void {
  validateSequencedEntries(
    requireArray(value, "decisions"),
    "decisions",
    (entry, path) => {
      requireInteger(read(entry, "decisionId"), `${path}.decisionId`, 1);
      const kind = requireString(read(entry, "kind"), `${path}.kind`);
      if (!DECISION_KINDS.has(kind))
        invalid(`${path}.kind`, "a supported decision kind");
      requireNullableString(read(entry, "actorId"), `${path}.actorId`);
      requireArray(
        read(entry, "candidateKeys"),
        `${path}.candidateKeys`,
      ).forEach((key, index) =>
        validateCandidateIdentity(key, `${path}.candidateKeys[${index}]`),
      );
      validateDecisionValue(kind, read(entry, "value"), `${path}.value`);
      validateDecisionContext(kind, read(entry, "context"), `${path}.context`);
      if (kind === "field_placement") {
        const context = requireObject(read(entry, "context"), `${path}.context`);
        const result = requireObject(read(entry, "value"), `${path}.value`);
        if (read(entry, "actorId") !== read(context, "decidingPlayerId")) {
          invalid(`${path}.actorId`, "the deciding player from context");
        }
        const prefix = `${read(context, "destinationPlayerId")}:${read(context, "row")}:`;
        const keys = requireArray(read(entry, "candidateKeys"), `${path}.candidateKeys`);
        if (keys.length === 0 || keys.length > 5 || new Set(keys).size !== keys.length || keys.some((key) =>
          typeof key !== "string" || ![0, 1, 2, 3, 4].some((slot) => key === `${prefix}${slot}`),
        )) invalid(`${path}.candidateKeys`, "distinct field slots for this destination");
        if (read(result, "outcome") === "cancelled") {
          if (read(context, "allowCancel") !== true) invalid(`${path}.value`, "a required field placement");
        } else if (!keys.includes(`${prefix}${read(result, "slot")}`)) {
          invalid(`${path}.value.slot`, "one of the recorded candidates");
        }
      }
    },
  );
}

function validateCardSnapshot(value: unknown, path: string, onField = false): void {
  if (value === null) {
    if (onField) invalid(path, "a real card (compact row)");
    return;
  }
  const card = requireObject(value, path);
  requireInteger(read(card, "attacksUsedThisTurn"), `${path}.attacksUsedThisTurn`, 0);
  requireBoolean(read(card, "hasAttacked"), `${path}.hasAttacked`);
  if (read(card, "summonedTurn") !== null) {
    requireInteger(read(card, "summonedTurn"), `${path}.summonedTurn`, 0);
  }
  requireBoolean(read(card, "positionChangedThisTurn"), `${path}.positionChangedThisTurn`);
  const presenceId = read(card, "fieldPresenceId");
  if (presenceId !== null && typeof presenceId !== "string" && typeof presenceId !== "number") {
    invalid(`${path}.fieldPresenceId`, "a field presence identity or null");
  }
  const fieldSlot = read(card, "fieldSlot");
  requireInteger(read(card, "oncePerTurnResetVersion"), `${path}.oncePerTurnResetVersion`, 0);
  const cardUsage = requireObject(read(card, "oncePerTurnUsageByName"), `${path}.oncePerTurnUsageByName`);
  for (const name of Object.keys(cardUsage)) {
    const entryPath = `${path}.oncePerTurnUsageByName.${name}`;
    const value = read(cardUsage, name);
    if (typeof value === "number") requireInteger(value, entryPath, 0);
    else {
      const entry = requireObject(value, entryPath);
      requireInteger(read(entry, "turn"), `${entryPath}.turn`, 0);
      requireInteger(read(entry, "count"), `${entryPath}.count`, 0);
    }
  }
  const presenceState = requireObject(read(card, "fieldPresenceState"), `${path}.fieldPresenceState`);
  for (const key of Object.keys(presenceState)) {
    requireFiniteNumber(read(presenceState, key), `${path}.fieldPresenceState.${key}`);
  }
  requireArray(read(card, "fieldPresenceSummons"), `${path}.fieldPresenceSummons`).forEach((value, index) => {
    const entryPath = `${path}.fieldPresenceSummons[${index}]`;
    const entry = requireObject(value, entryPath);
    const target = read(entry, "targetFieldPresenceId");
    if (typeof target !== "string" && typeof target !== "number") invalid(`${entryPath}.targetFieldPresenceId`, "a field presence identity");
    if (read(entry, "summoningPlayerId") !== "player" && read(entry, "summoningPlayerId") !== "bot") invalid(`${entryPath}.summoningPlayerId`, "a player identity");
    requireInteger(read(entry, "turn"), `${entryPath}.turn`, 0);
  });
  requireArray(read(card, "protectionEffects"), `${path}.protectionEffects`).forEach((value, index) => {
    const entryPath = `${path}.protectionEffects[${index}]`;
    const entry = requireObject(value, entryPath);
    if (!["battle_destruction", "effect_destruction"].includes(String(read(entry, "type")))) invalid(`${entryPath}.type`, "a destruction protection type");
    const duration = read(entry, "duration");
    if (typeof duration !== "string" && typeof duration !== "number") invalid(`${entryPath}.duration`, "a duration");
    for (const key of ["expiresOnTurn", "grantedOnTurn"]) {
      if (hasOwn(entry, key) && read(entry, key) !== null) requireInteger(read(entry, key), `${entryPath}.${key}`, 0);
    }
    if (hasOwn(entry, "source")) requireNullableString(read(entry, "source"), `${entryPath}.source`);
    if (hasOwn(entry, "removeOnLeave")) requireBoolean(read(entry, "removeOnLeave"), `${entryPath}.removeOnLeave`);
    if (hasOwn(entry, "sourceOwner") && !["self", "opponent", "any"].includes(String(read(entry, "sourceOwner")))) invalid(`${entryPath}.sourceOwner`, "a protection source scope");
  });
  if (onField) {
    const slot = requireInteger(fieldSlot, `${path}.fieldSlot`, 0);
    if (slot > 4) invalid(`${path}.fieldSlot`, "an integer between 0 and 4");
  } else if (fieldSlot !== null) invalid(`${path}.fieldSlot`, "null outside a field row");
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
  requireBoolean(
    read(card, "properSummonEstablished"),
    `${path}.properSummonEstablished`,
  );
  if (read(card, "originalLevel") !== null) requireFiniteNumber(read(card, "originalLevel"), `${path}.originalLevel`);
  requireArray(read(card, "levelModificationContributions"), `${path}.levelModificationContributions`).forEach((value, index) => {
    const entryPath = `${path}.levelModificationContributions[${index}]`;
    const entry = requireObject(value, entryPath);
    requireFiniteNumber(read(entry, "amount"), `${entryPath}.amount`);
    if (!["until_end_turn", "while_faceup"].includes(String(read(entry, "duration")))) invalid(`${entryPath}.duration`, "a level modification duration");
    if (read(card, "originalLevel") === null) invalid(`${path}.originalLevel`, "the baseline for tracked level modifications");
  });
  requireBoolean(read(card, "facedown"), `${path}.facedown`);
  if (hasOwn(card, "declaredValues")) {
    const declarations = requireObject(read(card, "declaredValues"), `${path}.declaredValues`);
    for (const [key, value] of Object.entries(declarations)) {
      const entryPath = `${path}.declaredValues.${key}`;
      if (typeof value === "string" || typeof value === "boolean") continue;
      if (typeof value === "number") { requireFiniteNumber(value, entryPath); continue; }
      const entry = requireObject(value, entryPath);
      if (typeof read(entry, "property") !== "string") invalid(`${entryPath}.property`, "a declared property");
      const declared = read(entry, "value");
      if (typeof declared !== "string" && typeof declared !== "boolean") requireFiniteNumber(declared, `${entryPath}.value`);
      if (hasOwn(entry, "declaredOnTurn")) requireFiniteNumber(read(entry, "declaredOnTurn"), `${entryPath}.declaredOnTurn`);
      if (hasOwn(entry, "expiresOnTurn") && read(entry, "expiresOnTurn") !== null) requireFiniteNumber(read(entry, "expiresOnTurn"), `${entryPath}.expiresOnTurn`);
      if (hasOwn(entry, "duration") && typeof read(entry, "duration") !== "string") invalid(`${entryPath}.duration`, "a declaration duration");
    }
  }
  if (hasOwn(card, "statBuffContributions")) {
    requireArray(read(card, "statBuffContributions"), `${path}.statBuffContributions`).forEach((value, index) => {
      const entryPath = `${path}.statBuffContributions[${index}]`;
      const entry = requireObject(value, entryPath);
      requireFiniteNumber(read(entry, "atk"), `${entryPath}.atk`);
      requireFiniteNumber(read(entry, "def"), `${entryPath}.def`);
      const duration = read(entry, "duration");
      if (duration !== "while_faceup" && duration !== "until_field_exit") {
        invalid(`${entryPath}.duration`, "a stat buff duration");
      }
    });
  }
  if (!hasOwn(card, "counters"))
    invalid(`${path}.counters`, "a serialized value");
  requireIdentity(read(card, "equipTargetId"), `${path}.equipTargetId`, true);
  const statuses = requireObject(read(card, "statuses"), `${path}.statuses`);
  if (hasOwn(statuses, "attackLimit")) {
    const entryPath = `${path}.statuses.attackLimit`;
    const entry = requireObject(read(statuses, "attackLimit"), entryPath);
    requireFiniteNumber(read(entry, "amount"), `${entryPath}.amount`);
    const duration = read(entry, "duration");
    if (typeof duration !== "string") requireFiniteNumber(duration, `${entryPath}.duration`);
  }
  if (hasOwn(statuses, "faceupStatuses")) {
    const registry = requireObject(read(statuses, "faceupStatuses"), `${path}.statuses.faceupStatuses`);
    for (const [status, value] of Object.entries(registry)) {
      const entry = requireObject(value, `${path}.statuses.faceupStatuses.${status}`);
      if (!hasOwn(entry, "previous") || !hasOwn(entry, "current")) {
        invalid(`${path}.statuses.faceupStatuses.${status}`, "previous and current status values");
      }
    }
  }
  if (!hasOwn(statuses, "effectsNegatedDuration")) {
    invalid(`${path}.statuses.effectsNegatedDuration`, "a serialized value");
  }
  requireArray(read(statuses, "effectsNegationContributions"), `${path}.statuses.effectsNegationContributions`).forEach((value, index) => {
    const entryPath = `${path}.statuses.effectsNegationContributions[${index}]`;
    const entry = requireObject(value, entryPath);
    const duration = read(entry, "duration");
    if (duration !== "while_faceup" && duration !== "until_end_turn") invalid(`${entryPath}.duration`, "a supported negation duration");
    const sourceId = read(entry, "sourceDuelCardId");
    if (sourceId !== null) requireInteger(sourceId, `${entryPath}.sourceDuelCardId`, 1);
    requireNullableString(read(entry, "sourceEffectId"), `${entryPath}.sourceEffectId`);
  });
  for (const key of [
    "effectsNegated",
    "cannotAttackThisTurn",
    "battlePositionLocked",
    "banishWhenLeavesField",
    "piercing",
    "piercingGrantedByEffect",
  ]) {
    requireBoolean(read(statuses, key), `${path}.statuses.${key}`);
  }
  if (requireFiniteNumber(read(statuses, "piercingDamageMultiplier"), `${path}.statuses.piercingDamageMultiplier`) <= 0) {
    invalid(`${path}.statuses.piercingDamageMultiplier`, "a positive multiplier");
  }
  for (const key of ["battleIndestructible", "tempBattleIndestructible", "battleDamageHealsControllerThisTurn"]) {
    requireBoolean(read(statuses, key), `${path}.statuses.${key}`);
  }
  requireFiniteNumber(read(statuses, "extraAttacks"), `${path}.statuses.extraAttacks`);
  const characteristics = requireObject(read(card, "characteristics"), `${path}.characteristics`);
  for (const key of ["isTrapMonster", "isTuner", "isToken"]) {
    requireBoolean(read(characteristics, key), `${path}.characteristics.${key}`);
  }
  for (const key of ["cardKind", "originalCardKind", "monsterType", "type", "attribute", "subtype"]) {
    requireNullableString(read(characteristics, key), `${path}.characteristics.${key}`);
  }
  for (const key of ["treatedAsCardKinds", "trapMonsterSummonProcedure", "trapMonsterOriginalState", "types", "synchroMaterialRoles"]) {
    if (!hasOwn(characteristics, key)) invalid(`${path}.characteristics.${key}`, "a serialized value");
  }
  const turnState = requireObject(read(card, "turnState"), `${path}.turnState`);
  for (const key of [
    "canMakeSecondAttackThisTurn",
    "secondAttackUsedThisTurn",
    "canAttackAllOpponentMonstersThisTurn",
    "canAttackDirectlyThisTurn",
  ]) {
    requireBoolean(read(turnState, key), `${path}.turnState.${key}`);
  }
  for (const key of [
    "cannotAttackUntilTurn",
    "immuneToOpponentEffectsUntilTurn",
    "battleIndestructibleOncePerTurnLastUsedTurn",
    "setTurn",
    "turnSetOn",
    "revealedTurn",
  ]) {
    if (read(turnState, key) !== null) requireFiniteNumber(read(turnState, key), `${path}.turnState.${key}`);
  }
  requireNullableString(read(turnState, "lastSummonProcedure"), `${path}.turnState.lastSummonProcedure`);
  requireArray(read(turnState, "attackedMonstersThisTurn"), `${path}.turnState.attackedMonstersThisTurn`);
  for (const key of ["extraAttackTargetRestriction", "passiveExtraAttackTargetRestriction", "passiveExtraAttackBonuses"]) {
    if (!hasOwn(turnState, key)) invalid(`${path}.turnState.${key}`, "a serialized value");
  }
  const stats = requireObject(read(card, "statBookkeeping"), `${path}.statBookkeeping`);
  for (const key of [
    "tempAtkBoost",
    "tempDefBoost",
    "equipAtkBonus",
    "equipDefBonus",
    "equipExtraAttacks",
    "equipExtraAttacksApplied",
  ]) {
    requireFiniteNumber(read(stats, key), `${path}.statBookkeeping.${key}`);
  }
  for (const key of ["originalAtk", "originalDef"]) {
    if (read(stats, key) !== null) requireFiniteNumber(read(stats, key), `${path}.statBookkeeping.${key}`);
  }
  for (const key of [
    "turnBasedBuffs",
    "originalStatsOverride",
    "dynamicBuffs",
    "suppressedDynamicBuffStatsByKey",
    "temporarySuppressedDynamicBuffStatsByKey",
  ]) {
    if (!hasOwn(stats, key)) invalid(`${path}.statBookkeeping.${key}`, "a serialized value");
  }
  const bindings = requireObject(read(card, "bindings"), `${path}.bindings`);
  requireBoolean(read(bindings, "grantsBattleIndestructible"), `${path}.bindings.grantsBattleIndestructible`);
  requireArray(read(bindings, "equips"), `${path}.bindings.equips`)
    .forEach((equip, index) => requireIdentity(equip, `${path}.bindings.equips[${index}]`, true));
  for (const key of ["boundTrapSource", "boundMonsterTarget"]) {
    requireIdentity(read(bindings, key), `${path}.bindings.${key}`, true);
  }
  for (const key of ["ascensionMaterials", "synchroMaterials"]) {
    requireArray(read(bindings, key), `${path}.bindings.${key}`);
  }
  for (const key of ["effectMarkers", "pendingSpellTrapFinalization", "lastSentToGraveAsMaterial"]) {
    if (!hasOwn(bindings, key)) invalid(`${path}.bindings.${key}`, "a serialized value");
  }
  const registries = requireObject(read(card, "statusRegistries"), `${path}.statusRegistries`);
  for (const key of ["temporary", "fieldExit"]) {
    requireObject(read(registries, key), `${path}.statusRegistries.${key}`);
  }
}

function validatePlayerSnapshot(value: unknown, path: string): void {
  const player = requireObject(value, path);
  requireNullableString(read(player, "id"), `${path}.id`);
  requireFiniteNumber(read(player, "lp"), `${path}.lp`);
  if (requireFiniteNumber(read(player, "lpGainedThisTurn"), `${path}.lpGainedThisTurn`) < 0) {
    invalid(`${path}.lpGainedThisTurn`, "a nonnegative number");
  }
  requireFiniteNumber(read(player, "summonCount"), `${path}.summonCount`);
  requireFiniteNumber(
    read(player, "additionalNormalSummons"),
    `${path}.additionalNormalSummons`,
  );
  if (requireFiniteNumber(read(player, "damageReceivedThisTurn"), `${path}.damageReceivedThisTurn`) < 0) {
    invalid(`${path}.damageReceivedThisTurn`, "a nonnegative number");
  }
  for (const key of ["normalSummonsThisTurn", "additionalNormalSummonPermissions"]) {
    requireArray(read(player, key), `${path}.${key}`);
  }
  if (requireFiniteNumber(read(player, "lpGainMultiplier"), `${path}.lpGainMultiplier`) <= 0) {
    invalid(`${path}.lpGainMultiplier`, "a positive multiplier");
  }
  requireBoolean(read(player, "opponentCannotActivateDuringBattle"), `${path}.opponentCannotActivateDuringBattle`);
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
    const cards = requireArray(read(zones, zone), `${path}.zones.${zone}`);
    const onField = zone === "field" || zone === "spellTrap";
    if (onField && cards.length > 5) invalid(`${path}.zones.${zone}`, "at most five cards");
    const occupied = new Set<unknown>();
    cards.forEach((card, index) => {
      validateCardSnapshot(card, `${path}.zones.${zone}[${index}]`, onField);
      if (onField && isObject(card)) {
        const slot = read(card, "fieldSlot");
        if (occupied.has(slot)) invalid(`${path}.zones.${zone}[${index}].fieldSlot`, "a unique occupied slot");
        occupied.add(slot);
      }
    });
  }
  validateCardSnapshot(read(zones, "fieldSpell"), `${path}.zones.fieldSpell`);
}

function validateProcedureSnapshot(value: unknown, path: string): void {
  if (value === null) return;
  const procedure = requireObject(value, path);
  requireBoolean(read(procedure, "active"), `${path}.active`);
  for (const key of ["last", "transaction"]) {
    if (!hasOwn(procedure, key))
      invalid(`${path}.${key}`, "a serialized value");
    const transaction = read(procedure, key);
    if (isObject(transaction)) {
      if (hasOwn(transaction, "negationWindowPolicy") && read(transaction, "negationWindowPolicy") !== "auto" && read(transaction, "negationWindowPolicy") !== "suppressed") {
        invalid(`${path}.${key}.negationWindowPolicy`, "auto or suppressed");
      }
      if (hasOwn(transaction, "skipFinalTiming") && read(transaction, "skipFinalTiming") !== true) invalid(`${path}.${key}.skipFinalTiming`, "true");
    }
  }
}

function validateLocation(value: unknown, path: string): void {
  const location = requireObject(value, path);
  requireNullableString(read(location, "controllerId"), `${path}.controllerId`);
  const zone = read(location, "zone");
  if (zone !== null && (typeof zone !== "string" || ![...CARD_ZONES, "token", "temporary", "unknown"].includes(zone))) invalid(`${path}.zone`, "a canonical card zone or null");
  requireBoolean(read(location, "faceUp"), `${path}.faceUp`);
  requireInteger(read(location, "locationVersion"), `${path}.locationVersion`, 0);
}

function validateSource(value: unknown, path: string): void {
  if (value === null) return;
  const source = requireObject(value, path);
  if (Object.keys(source).some(key => !["cardDuelCardId", "controllerId", "zone", "faceUp", "locationVersion", "counters"].includes(key))) invalid(path, "only canonical source presence fields");
  requireIdentity(read(source, "cardDuelCardId"), `${path}.cardDuelCardId`, true);
  validateLocation(source, path);
  if (hasOwn(source, "counters")) for (const [key, count] of Object.entries(requireObject(read(source, "counters"), `${path}.counters`))) {
    requireInteger(count, `${path}.counters.${key}`, 0);
  }
}

function validateReferences(value: unknown, path: string): void {
  requireArray(value, path).forEach((value, index) => {
    const refPath = `${path}[${index}]`, ref = requireObject(value, refPath);
    requireNullableString(read(ref, "targetId"), `${refPath}.targetId`);
    requireArray(read(ref, "cards"), `${refPath}.cards`).forEach((card, index) => {
      const cardPath = `${refPath}.cards[${index}]`;
      validateSource(requireObject(card, cardPath), cardPath);
    });
  });
}

function validateLinkReferences(value: unknown, path: string): void {
  if (!isObject(value)) return;
  if (hasOwn(value, "referenceSnapshots")) validateReferences(read(value, "referenceSnapshots"), `${path}.referenceSnapshots`);
  if (hasOwn(value, "responseReference")) {
    const referencePath = `${path}.responseReference`;
    const reference = requireObject(read(value, "responseReference"), referencePath);
    for (const key of ["chainId", "linkId"]) requireIdentity(read(reference, key), `${referencePath}.${key}`);
    requireIdentity(read(reference, "duelCardId"), `${referencePath}.duelCardId`, true);
    if (Object.keys(reference).some(key => !["chainId", "linkId", "duelCardId"].includes(key))) invalid(referencePath, "only canonical Chain and duel card identities");
  }
}

function validateAfterResolutionSnapshot(value: unknown, path: string): void {
  const state = requireObject(value, path);
  const checkEnum = (value: unknown, choices: readonly string[], path: string) => {
    if (typeof value !== "string" || !choices.includes(value)) invalid(path, "a canonical state value");
  };
  const validateTiming = (value: unknown, path: string) => {
    const timing = requireObject(value, path);
    checkEnum(read(timing, "state"), Object.values(FAST_EFFECT_STATES), `${path}.state`);
    checkEnum(read(timing, "origin"), Object.values(FAST_EFFECT_ORIGINS), `${path}.origin`);
    for (const key of ["timingWindowId", "chainId"]) requireIdentity(read(timing, key), `${path}.${key}`, true);
    for (const key of ["turnPlayerId", "actionPlayerId", "priorityPlayerId", "lastLinkControllerId"]) requireNullableString(read(timing, key), `${path}.${key}`);
    requireInteger(read(timing, "consecutivePasses"), `${path}.consecutivePasses`, 0);
    if (read(timing, "phaseIntent") !== null) {
      const intent = requireObject(read(timing, "phaseIntent"), `${path}.phaseIntent`);
      requirePhase(read(intent, "fromPhase"), `${path}.phaseIntent.fromPhase`, true);
      requirePhase(read(intent, "toPhase"), `${path}.phaseIntent.toPhase`, true);
    }
  };
  const validatePayment = (value: unknown, path: string) => {
    const cost = value;
    if (cost !== null) {
      const payment = requireObject(cost, `${path}.costPayment`);
      checkEnum(read(payment, "status"), ["not_required", "paid"], `${path}.costPayment.status`);
      requireArray(read(payment, "actions"), `${path}.costPayment.actions`).forEach((value, index) => {
        const entryPath = `${path}.costPayment.actions[${index}]`;
        const entry = requireObject(value, entryPath);
        requireInteger(read(entry, "index"), `${entryPath}.index`, 0);
        requireNullableString(read(entry, "type"), `${entryPath}.type`);
        if (hasOwn(entry, "targetRef")) requireNullableString(read(entry, "targetRef"), `${entryPath}.targetRef`);
      });
      if (hasOwn(payment, "summonMarkers")) requireArray(read(payment, "summonMarkers"), `${path}.costPayment.summonMarkers`).forEach((value, index) => {
        const markerPath = `${path}.costPayment.summonMarkers[${index}]`;
        const marker = requireObject(value, markerPath);
        requireNullableString(read(marker, "sourceEffectId"), `${markerPath}.sourceEffectId`);
        requireString(read(marker, "costTargetRef"), `${markerPath}.costTargetRef`);
        requireString(read(marker, "key"), `${markerPath}.key`);
        requireInteger(read(marker, "matchingCostCount"), `${markerPath}.matchingCostCount`, 0);
      });
      validatePaidReferenceMetadata({ costPayment: payment }, path);
    }
  };
  const validateLink = (value: unknown, path: string) => {
    const link = requireObject(value, path);
    requireInteger(read(link, "chainId"), `${path}.chainId`, 1);
    requireInteger(read(link, "linkId"), `${path}.linkId`, 1);
    requireInteger(read(link, "chainLevel"), `${path}.chainLevel`, 1);
    requireIdentity(read(link, "cardDuelCardId"), `${path}.cardDuelCardId`, true);
    requireIdentity(read(link, "cardId"), `${path}.cardId`, true);
    requireString(read(link, "controllerId"), `${path}.controllerId`);
    requireNullableString(read(link, "effectId"), `${path}.effectId`);
    checkEnum(read(link, "resolutionStatus"), CHAIN_RESOLUTION_STATUSES, `${path}.resolutionStatus`);
    checkEnum(read(link, "finalizationStatus"), CHAIN_FINALIZATION_STATUSES, `${path}.finalizationStatus`);
    requireBoolean(read(link, "sourceMoved"), `${path}.sourceMoved`);
    requireBoolean(read(link, "sourceDestroyed"), `${path}.sourceDestroyed`);
    if (read(link, "latestSourceLocation") !== null) validateLocation(read(link, "latestSourceLocation"), `${path}.latestSourceLocation`);
    validateSource(read(link, "sourceAtActivation"), `${path}.sourceAtActivation`);
    if (hasOwn(link, "decisions") && !readChainResponseDecisions(read(link, "decisions"), id => id, true)) invalid(`${path}.decisions`, "a canonical decision plan");
    if (hasOwn(link, "referenceSnapshots")) validateReferences(read(link, "referenceSnapshots"), `${path}.referenceSnapshots`);
    validateResults(read(link, "costSelections"), `${path}.costSelections`);
    validateResults(read(link, "targetSelections"), `${path}.targetSelections`);
    validateResults(read(link, "resolutionSelections"), `${path}.resolutionSelections`);
    requireArray(read(link, "declaredTargetSnapshots"), `${path}.declaredTargetSnapshots`).forEach((value, index) => {
      const targetPath = `${path}.declaredTargetSnapshots[${index}]`;
      const target = requireObject(value, targetPath);
      requireNullableString(read(target, "targetId"), `${targetPath}.targetId`);
      requireArray(read(target, "cards"), `${targetPath}.cards`).forEach((value, index) => {
        const cardPath = `${targetPath}.cards[${index}]`;
        const card = requireObject(value, cardPath);
        requireIdentity(read(card, "cardDuelCardId"), `${cardPath}.cardDuelCardId`, true);
        validateLocation(card, cardPath);
      });
    });
    validatePayment(read(link, "costPayment"), path);
  };
  const validateResults = (value: unknown, path: string) => {
    for (const [ref, cards] of Object.entries(requireObject(value, path))) {
      requireArray(cards, `${path}.${ref}`).forEach((id, index) => {
        if (id !== null) requireInteger(id, `${path}.${ref}[${index}]`, 1);
      });
    }
  };
  const validatePhase = (value: unknown, path: string) => {
    const phase = requireObject(value, path);
    if (read(phase, "stage") !== "after_resolution") invalid(`${path}.stage`, "after_resolution");
    requireInteger(read(phase, "actionIndex"), `${path}.actionIndex`, 0);
    validateLink(read(phase, "link"), `${path}.link`);
    validateResults(read(phase, "results"), `${path}.results`);
  };
  if (hasOwn(state, "direct")) {
    const direct = requireObject(read(state, "direct"), `${path}.direct`);
    if (read(direct, "stage") !== "after_resolution") invalid(`${path}.direct.stage`, "after_resolution");
    requireIdentity(read(direct, "sourceDuelCardId"), `${path}.direct.sourceDuelCardId`, true);
    requireIdentity(read(direct, "sourceCardId"), `${path}.direct.sourceCardId`);
    requireString(read(direct, "controllerId"), `${path}.direct.controllerId`);
    requireString(read(direct, "effectId"), `${path}.direct.effectId`);
    requireInteger(read(direct, "actionIndex"), `${path}.direct.actionIndex`, 0);
    requireInteger(read(direct, "selectionGeneration"), `${path}.direct.selectionGeneration`, 0);
    validateResults(read(direct, "results"), `${path}.direct.results`);
    validateSource(read(direct, "sourceAtActivation"), `${path}.direct.sourceAtActivation`);
    if (hasOwn(direct, "decisions") && !readChainResponseDecisions(read(direct, "decisions"), id => id, true)) invalid(`${path}.direct.decisions`, "a canonical decision plan");
    if (hasOwn(direct, "referenceSnapshots")) validateReferences(read(direct, "referenceSnapshots"), `${path}.direct.referenceSnapshots`);
    validatePayment(read(direct, "costPayment"), `${path}.direct`);
  }
  if (hasOwn(state, "active")) validatePhase(read(state, "active"), `${path}.active`);
  const frames = hasOwn(state, "suspended") ? requireArray(read(state, "suspended"), `${path}.suspended`) : [];
  if (!hasOwn(state, "active") && !hasOwn(state, "direct") && frames.length === 0) invalid(path, "an active phase or non-empty suspended frames");
  frames.forEach((value, index) => {
    const framePath = `${path}.suspended[${index}]`;
    const frame = requireObject(value, framePath);
    requireInteger(read(frame, "chainId"), `${framePath}.chainId`, 1);
    requireBoolean(read(frame, "resolving"), `${framePath}.resolving`);
    requireBoolean(read(frame, "windowOpen"), `${framePath}.windowOpen`);
    validateTiming(read(frame, "timing"), `${framePath}.timing`);
    if (hasOwn(frame, "triggers")) validateTriggerState(read(frame, "triggers"), `${framePath}.triggers`);
    requireArray(read(frame, "links"), `${framePath}.links`).forEach((link, index) => validateLink(link, `${framePath}.links[${index}]`));
    if (read(frame, "afterResolution") !== null) validatePhase(read(frame, "afterResolution"), `${framePath}.afterResolution`);
    requireArray(read(frame, "finalizations"), `${framePath}.finalizations`).forEach((value, index) => {
      const entryPath = `${framePath}.finalizations[${index}]`;
      const entry = requireObject(value, entryPath);
      checkEnum(read(entry, "status"), CHAIN_FINALIZATION_STATUSES, `${entryPath}.status`);
      validateLink(read(entry, "link"), `${entryPath}.link`);
    });
    const selection = read(frame, "selection");
    if (selection !== null) {
      const selected = requireObject(selection, `${framePath}.selection`);
      const phase = read(selected, "phase");
      if (phase !== "resolution" && phase !== "after_resolution") invalid(`${framePath}.selection.phase`, "a resolution phase");
      validateLink(read(selected, "link"), `${framePath}.selection.link`);
      validateResults(read(selected, "selections"), `${framePath}.selection.selections`);
    }
  });
}

function requireTriggerObject(value: unknown, path: string, keys: readonly string[]): object {
  const object = requireObject(value, path);
  if (Object.keys(object).some(key => !keys.includes(key))) invalid(path, "only canonical trigger fields");
  return object;
}

function validateTriggerPresence(value: unknown, path: string): void {
  if (value === null) return;
  const presence = requireTriggerObject(value, path, ["cardId", "duelCardId", "controllerId", "zone", "faceUp", "locationVersion", "counters"]);
  for (const key of ["cardId", "duelCardId"]) requireIdentity(read(presence, key), `${path}.${key}`, true);
  requirePlayerId(read(presence, "controllerId"), `${path}.controllerId`);
  validateLocation(presence, path);
  if (hasOwn(presence, "counters")) for (const [key, count] of Object.entries(requireObject(read(presence, "counters"), `${path}.counters`))) {
    requireInteger(count, `${path}.counters.${key}`, 0);
  }
}

function validateTriggerOccurrence(value: unknown, path: string): void {
  const occurrence = requireTriggerObject(value, path, ["occurrenceId", "atomicGroupId", "eventName", "sequence", "turnCounter", "phase", "chainId", "resolvingLinkId", "timingRelevance", "entriesProvided", "entries", "referenceSnapshots", "snapshot"]);
  for (const key of ["occurrenceId", "atomicGroupId"]) requireIdentity(read(occurrence, key), `${path}.${key}`);
  for (const key of ["sequence", "turnCounter"]) requireInteger(read(occurrence, key), `${path}.${key}`, 0);
  requireString(read(occurrence, "eventName"), `${path}.eventName`);
  requirePhase(read(occurrence, "phase"), `${path}.phase`, true);
  for (const key of ["chainId", "resolvingLinkId"]) requireIdentity(read(occurrence, key), `${path}.${key}`, true);
  const relevance = read(occurrence, "timingRelevance");
  if (relevance !== "semantic" && relevance !== "source_cleanup") invalid(`${path}.timingRelevance`, "semantic or source_cleanup");
  requireBoolean(read(occurrence, "entriesProvided"), `${path}.entriesProvided`);
  requireArray(read(occurrence, "entries"), `${path}.entries`).forEach((value, index) => {
    const entryPath = `${path}.entries[${index}]`;
    const entry = requireTriggerObject(value, entryPath, ["entryId", "cardId", "duelCardId", "effectId", "controllerId", "registrationId", "sourceAtTrigger"]);
    requireString(read(entry, "entryId"), `${entryPath}.entryId`);
    for (const key of ["cardId", "duelCardId"]) requireIdentity(read(entry, key), `${entryPath}.${key}`, true);
    requireNullableString(read(entry, "effectId"), `${entryPath}.effectId`);
    requirePlayerId(read(entry, "controllerId"), `${entryPath}.controllerId`);
    const registrationId = read(entry, "registrationId");
    if (registrationId !== null && typeof registrationId !== "string") requireInteger(registrationId, `${entryPath}.registrationId`, 0);
    validateTriggerPresence(read(entry, "sourceAtTrigger"), `${entryPath}.sourceAtTrigger`);
  });
  requireArray(read(occurrence, "referenceSnapshots"), `${path}.referenceSnapshots`).forEach((value, index) => {
    const bindingPath = `${path}.referenceSnapshots[${index}]`;
    const binding = requireTriggerObject(value, bindingPath, ["sourceDuelCardId", "effectId", "sourcePresence", "references"]);
    requireIdentity(read(binding, "sourceDuelCardId"), `${bindingPath}.sourceDuelCardId`, true);
    requireNullableString(read(binding, "effectId"), `${bindingPath}.effectId`);
    validateTriggerPresence(read(binding, "sourcePresence"), `${bindingPath}.sourcePresence`);
    requireArray(read(binding, "references"), `${bindingPath}.references`).forEach((value, index) => {
      const referencePath = `${bindingPath}.references[${index}]`;
      const reference = requireTriggerObject(value, referencePath, ["targetId", "cards"]);
      requireNullableString(read(reference, "targetId"), `${referencePath}.targetId`);
      requireArray(read(reference, "cards"), `${referencePath}.cards`).forEach((card, index) => {
        const cardPath = `${referencePath}.cards[${index}]`;
        validateTriggerPresence(requireObject(card, cardPath), cardPath);
      });
    });
  });
  const snapshot = read(occurrence, "snapshot");
  assertSerializable(snapshot, `${path}.snapshot`);
  const rejectRuntimeIdentities = (value: unknown, path: string): void => {
    if (value === null || typeof value !== "object") return;
    for (const key of Object.keys(value)) {
      if (["instanceId", "cardInstanceId", "sourceInstanceId", "_instanceId", "simInstanceId", "uuid"].includes(key)) invalid(`${path}.${key}`, "a duel-local identity instead of a runtime identifier");
      rejectRuntimeIdentities(read(value, key), `${path}.${key}`);
    }
  };
  rejectRuntimeIdentities(snapshot, `${path}.snapshot`);
}

function validateTriggerState(value: unknown, path: string): void {
  if (value === null) return;
  const state = requireObject(value, path);
  requireIdentity(read(state, "opportunityId"), `${path}.opportunityId`, true);
  const pendingCount = requireInteger(read(state, "pendingOccurrenceCount"), `${path}.pendingOccurrenceCount`, 0);
  requireBoolean(read(state, "selecting"), `${path}.selecting`);
  const occurrenceIds = requireArray(read(state, "occurrenceIds"), `${path}.occurrenceIds`);
  occurrenceIds.forEach((id, index) => requireIdentity(id, `${path}.occurrenceIds[${index}]`));
  const groups = requireObject(read(state, "groups"), `${path}.groups`);
  const full = hasOwn(state, "pendingOccurrences") || hasOwn(state, "activeOccurrences") || hasOwn(state, "lastRelevantAtomicGroupId") || Object.keys(groups).length > 0;
  if (!full) {
    if (read(state, "opportunityId") !== null || read(state, "selecting") !== false || occurrenceIds.length !== 0) invalid(path, "an empty disabled-Chain trigger state");
    return;
  }
  const pending = requireArray(read(state, "pendingOccurrences"), `${path}.pendingOccurrences`);
  if (pending.length !== pendingCount) invalid(`${path}.pendingOccurrenceCount`, "the pending occurrence array length");
  for (const key of ["pendingOccurrences", "activeOccurrences"]) {
    requireArray(read(state, key), `${path}.${key}`).forEach((occurrence, index) => validateTriggerOccurrence(occurrence, `${path}.${key}[${index}]`));
  }
  requireIdentity(read(state, "lastRelevantAtomicGroupId"), `${path}.lastRelevantAtomicGroupId`, true);
  for (const key of Object.values(SEGOC_GROUPS)) {
    requireArray(read(groups, key), `${path}.groups.${key}`).forEach((value, index) => {
      if (value === null) return;
      const candidatePath = `${path}.groups.${key}[${index}]`;
      const candidate = requireObject(value, candidatePath);
      for (const field of ["candidateId", "occurrenceId", "atomicGroupId", "cardId", "duelCardId"]) requireIdentity(read(candidate, field), `${candidatePath}.${field}`, true);
      if (read(candidate, "cardInstanceId") !== null) invalid(`${candidatePath}.cardInstanceId`, "null; canonical candidates use duelCardId");
      requirePlayerId(read(candidate, "controllerId"), `${candidatePath}.controllerId`);
      for (const field of ["eventName", "cardName", "effectId", "rejectionReason"]) requireNullableString(read(candidate, field), `${candidatePath}.${field}`);
      for (const [field, choices] of [["triggerRequirement", Object.values(TRIGGER_REQUIREMENTS)], ["triggerTiming", Object.values(TRIGGER_TIMINGS)], ["eligibilityStatus", TRIGGER_ELIGIBILITY_STATUSES]] as const) {
        const entry = read(candidate, field);
        if (entry !== null && (typeof entry !== "string" || !(choices as readonly string[]).includes(entry))) invalid(`${candidatePath}.${field}`, "a canonical trigger value or null");
      }
      if (read(candidate, "segocGroup") !== null && read(candidate, "segocGroup") !== key) invalid(`${candidatePath}.segocGroup`, "the enclosing SEGOC group");
    });
  }
}

function validateStateSnapshot(value: unknown, path: string): void {
  const snapshot = requireObject(value, path);
  requireInteger(read(snapshot, "fieldPlacementSequence"), `${path}.fieldPlacementSequence`, 0);
  requireNullableString(read(snapshot, "turn"), `${path}.turn`);
  requireNullableString(read(snapshot, "phase"), `${path}.phase`);
  requireFiniteNumber(read(snapshot, "turnCounter"), `${path}.turnCounter`);
  validateRandomState(read(snapshot, "random"), `${path}.random`);
  const players = requireObject(read(snapshot, "players"), `${path}.players`);
  validatePlayerSnapshot(read(players, "player"), `${path}.players.player`);
  validatePlayerSnapshot(read(players, "bot"), `${path}.players.bot`);
  const chain = requireObject(read(snapshot, "chain"), `${path}.chain`);
  for (const key of ["state", "links", "timing", "triggers"]) {
    if (!hasOwn(chain, key))
      invalid(`${path}.chain.${key}`, "a serialized value");
  }
  const links = read(chain, "links");
  if (Array.isArray(links)) links.forEach((link, index) => {
    validatePaidReferenceMetadata(link, `${path}.chain.links[${index}]`);
    validateLinkReferences(link, `${path}.chain.links[${index}]`);
  });
  validateTriggerState(read(chain, "triggers"), `${path}.chain.triggers`);
  if (hasOwn(chain, "afterResolution")) validateAfterResolutionSnapshot(read(chain, "afterResolution"), `${path}.chain.afterResolution`);
  for (const key of [
    "usage",
    "namedOncePerTurnUsage",
    "delayedActions",
    "temporaryEventEffects",
    "temporaryControlEffects",
  ]) {
    if (!hasOwn(snapshot, key)) invalid(`${path}.${key}`, "a serialized value");
  }
  requireArray(read(snapshot, "temporaryControlEffects"), `${path}.temporaryControlEffects`).forEach((value, index) => {
    const controlPath = `${path}.temporaryControlEffects[${index}]`;
    const control = requireObject(value, controlPath);
    requireIdentity(read(control, "cardDuelCardId"), `${controlPath}.cardDuelCardId`, false);
    requireIdentity(read(control, "sourceDuelCardId"), `${controlPath}.sourceDuelCardId`, true);
    requireString(read(control, "id"), `${controlPath}.id`);
    requireString(read(control, "holderId"), `${controlPath}.holderId`);
    requireNullableString(read(control, "previousControllerId"), `${controlPath}.previousControllerId`);
    for (const key of ["expiresOnTurn", "createdOnTurn"]) requireInteger(read(control, key), `${controlPath}.${key}`, 0);
    const presenceId = read(control, "fieldPresenceId");
    if (presenceId !== null && typeof presenceId !== "number" && typeof presenceId !== "string") invalid(`${controlPath}.fieldPresenceId`, "a field presence identity or null");
  });
  validateRuleStateSnapshot(read(snapshot, "ruleState"), `${path}.ruleState`);
  validateProcedureSnapshot(read(snapshot, "summon"), `${path}.summon`);
  validateProcedureSnapshot(read(snapshot, "combat"), `${path}.combat`);
}

function validateRuleStateSnapshot(value: unknown, path: string): void {
  const rules = requireObject(value, path);
  for (const key of ["gameOver", "lastAttackNegated", "damageCalculationStatChangePending"]) {
    requireBoolean(read(rules, key), `${path}.${key}`);
  }
  for (const key of ["winner", "battleStep"]) requireNullableString(read(rules, key), `${path}.${key}`);
  for (const key of ["synchroSummonContextCounter", "eventResolutionCounter"]) {
    requireInteger(read(rules, key), `${path}.${key}`, 0);
  }
  for (const key of [
    "damageCalculationTempBuffs",
    "endOfDamageStepTempBuffs",
    "temporaryBattlePairEffects",
    "pendingSynchroMaterialFollowups",
    "generatedIdCounters",
  ]) {
    requireArray(read(rules, key), `${path}.${key}`);
  }
  for (const key of ["materialDuelStats", "specialSummonTypeCounts"]) {
    requireObject(read(rules, key), `${path}.${key}`);
  }
  const continuation = read(rules, "pendingSynchroMaterialTriggerContinuation");
  if (continuation !== null) {
    const continuationPath = `${path}.pendingSynchroMaterialTriggerContinuation`;
    const entry = requireObject(continuation, continuationPath);
    for (const key of ["stage", "synchroSummonContextId", "summonedCard", "playerId"]) {
      if (!hasOwn(entry, key)) invalid(`${continuationPath}.${key}`, "a serialized value");
    }
  }
}

function validateEvents(value: unknown): void {
  validateSequencedEntries(
    requireArray(value, "events"),
    "events",
    (entry, path) => {
      const eventName = read(entry, "event");
      if (!isReplayEvent(eventName))
        invalid(`${path}.event`, "a supported replay event");
      requireInteger(read(entry, "turn"), `${path}.turn`, 0);
      requirePhase(read(entry, "phase"), `${path}.phase`, true);
      if (!hasOwn(entry, "payload"))
        invalid(`${path}.payload`, "a serialized value");
    },
  );
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
  if (
    hasOwn(result, "finalStateHash") &&
    read(result, "finalStateHash") !== null
  ) {
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
    throw new Error(
      "Replay card database signature does not match this build.",
    );
  }
  const setup = read(replay, "setup");
  const commands = read(replay, "commands");
  const decisions = read(replay, "decisions");
  if (!setup || !Array.isArray(commands) || !Array.isArray(decisions)) {
    throw new Error(
      "Canonical replay is missing setup, commands, or decisions.",
    );
  }

  if (
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
