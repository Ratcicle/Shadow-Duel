import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTION_CATALOG,
  ACTION_CATEGORIES,
  ACTION_FIELD_DEFS,
} from "../src/core/actionHandlers/actionCatalog.js";
import { getCardDatabaseSignature } from "../src/core/game/replay/canonical.js";
import { CURRENT_BANLIST, BANLIST_STATUS } from "../src/data/banlist.js";
import { cardDatabaseGroups } from "../src/data/cards.js";
import {
  CARD_ID_MIGRATION_MAP,
  CARD_ID_MIGRATION_VERSION,
} from "../src/data/cards/idMigration.js";
import {
  CARD_ID_RANGES,
  CARD_ID_RANGE_POLICY,
} from "../src/data/cards/ranges.js";

export const MIGRATION_DIGEST_FORMAT =
  "shadow-duel-typescript-migration-digest";
export const MIGRATION_DIGEST_VERSION = 1;
export const DIGEST_REGISTRY_FORMAT =
  "shadow-duel-typescript-digest-registry";
export const DIGEST_REGISTRY_VERSION = 1;
export const COMPONENT_KEYS = [
  "cardDatabaseGroups",
  "cardIdRanges",
  "cardIdMigration",
  "banlist",
  "actionCatalog",
  "locales",
] as const;

export type ComponentKey = (typeof COMPONENT_KEYS)[number];
export type CanonicalValue =
  | null
  | string
  | boolean
  | number
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export interface MigrationPayload {
  format: typeof MIGRATION_DIGEST_FORMAT;
  version: typeof MIGRATION_DIGEST_VERSION;
  cardDatabaseGroups: unknown;
  cardIdRanges: unknown;
  cardIdMigration: unknown;
  banlist: unknown;
  actionCatalog: unknown;
  locales: unknown;
}

export interface MigrationDigests {
  aggregate: string;
  components: Record<ComponentKey, string>;
}

export interface DigestApproval {
  functionalCommit: string;
  aggregate: string;
  components: Record<ComponentKey, string>;
  reason: string;
  approvedAt: string;
}

export interface DigestRegistry {
  format: typeof DIGEST_REGISTRY_FORMAT;
  version: typeof DIGEST_REGISTRY_VERSION;
  legacyReplaySignature: string;
  approvals: DigestApproval[];
}

export interface VerificationResult extends MigrationDigests {
  legacyReplaySignature: string;
  approval: DigestApproval;
}

const REGISTRY_URL = new URL(
  "../docs/migrations/typescript-digests.json",
  import.meta.url,
);
const PT_BR_LOCALE_URL = new URL(
  "../public/locales/pt-br.json",
  import.meta.url,
);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const LEGACY_SIGNATURE_PATTERN = /^[0-9a-f]{8}$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ISO_TIMESTAMP_COMPONENTS_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

export function canonicalize(
  value: unknown,
  path = "$",
  seen: WeakSet<object> = new WeakSet(),
): CanonicalValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite number at ${path}`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError(`Cycle at ${path}`);
    const expectedIndexes = Array.from(
      { length: value.length },
      (_, index) => String(index),
    );
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.some((key) => typeof key === "symbol") ||
      ownKeys.some(
        (key) =>
          typeof key === "string" &&
          key !== "length" &&
          !expectedIndexes.includes(key),
      ) ||
      expectedIndexes.some(
        (key) => !Object.prototype.hasOwnProperty.call(value, key),
      )
    ) {
      throw new TypeError(`Sparse or extended array at ${path}`);
    }
    seen.add(value);
    const output: CanonicalValue[] = value.map(
      (entry: unknown, index: number) =>
        canonicalize(entry, `${path}[${index}]`, seen),
    );
    seen.delete(value);
    return output;
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Non-plain object at ${path}`);
    }
    if (Reflect.ownKeys(value).length !== Object.keys(value).length) {
      throw new TypeError(`Symbol or non-enumerable key at ${path}`);
    }
    if (seen.has(value)) throw new TypeError(`Cycle at ${path}`);
    seen.add(value);
    const output: { [key: string]: CanonicalValue } = {};
    for (const key of Object.keys(value).sort()) {
      const entry: unknown = Reflect.get(value, key);
      if (entry === undefined) {
        throw new TypeError(`Undefined value at ${path}.${key}`);
      }
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value: canonicalize(entry, `${path}.${key}`, seen),
        writable: true,
      });
    }
    seen.delete(value);
    return output;
  }

  throw new TypeError(`Unsupported ${typeof value} at ${path}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashCanonicalValue(value: unknown): string {
  return sha256Utf8(canonicalJson(value));
}

export async function loadMigrationPayload(): Promise<MigrationPayload> {
  const ptBrLocaleSource = await readFile(PT_BR_LOCALE_URL, "utf8");
  const ptBrLocale: unknown = JSON.parse(ptBrLocaleSource);

  return {
    format: MIGRATION_DIGEST_FORMAT,
    version: MIGRATION_DIGEST_VERSION,
    cardDatabaseGroups: cardDatabaseGroups.map(({ rangeKey, cards }) => ({
      rangeKey,
      cards,
    })),
    cardIdRanges: {
      policy: CARD_ID_RANGE_POLICY,
      ranges: CARD_ID_RANGES,
    },
    cardIdMigration: {
      version: CARD_ID_MIGRATION_VERSION,
      map: CARD_ID_MIGRATION_MAP,
    },
    banlist: {
      statuses: BANLIST_STATUS,
      current: CURRENT_BANLIST,
    },
    actionCatalog: {
      categories: ACTION_CATEGORIES,
      fieldDefinitions: ACTION_FIELD_DEFS,
      entries: ACTION_CATALOG,
    },
    locales: {
      "pt-br": ptBrLocale,
    },
  };
}

export function calculateMigrationDigests(
  payload: MigrationPayload,
): MigrationDigests {
  const components: Record<ComponentKey, string> = {
    cardDatabaseGroups: hashCanonicalValue(payload.cardDatabaseGroups),
    cardIdRanges: hashCanonicalValue(payload.cardIdRanges),
    cardIdMigration: hashCanonicalValue(payload.cardIdMigration),
    banlist: hashCanonicalValue(payload.banlist),
    actionCatalog: hashCanonicalValue(payload.actionCatalog),
    locales: hashCanonicalValue(payload.locales),
  };

  return {
    aggregate: hashCanonicalValue(payload),
    components,
  };
}

function recordEntries(value: object): Array<[string, unknown]> {
  return Object.keys(value).map((key) => [key, Reflect.get(value, key)]);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${path} must be a plain object`);
  }
  if (Reflect.ownKeys(value).length !== Object.keys(value).length) {
    throw new TypeError(`${path} must contain only enumerable string keys`);
  }
  return Object.fromEntries(recordEntries(value));
}

function requireExactKeys(
  record: Record<string, unknown>,
  expectedKeys: readonly string[],
  path: string,
): void {
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(
      `${path} must contain exactly: ${expectedKeys.join(", ")}`,
    );
  }
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${path} must be a string`);
  }
  return value;
}

function requirePattern(
  value: unknown,
  pattern: RegExp,
  path: string,
  description: string,
): string {
  const text = requireString(value, path);
  if (!pattern.test(text)) {
    throw new TypeError(`${path} must be ${description}`);
  }
  return text;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear =
      year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function requireIsoTimestamp(value: unknown, path: string): string {
  const text = requirePattern(
    value,
    ISO_TIMESTAMP_PATTERN,
    path,
    "an ISO-8601 timestamp with timezone",
  );
  const components = ISO_TIMESTAMP_COMPONENTS_PATTERN.exec(text);
  if (components === null) {
    throw new TypeError(`${path} must be a valid ISO-8601 timestamp`);
  }

  const year = Number(components[1]);
  const month = Number(components[2]);
  const day = Number(components[3]);
  const hour = Number(components[4]);
  const minute = Number(components[5]);
  const second = Number(components[6]);
  const offsetHour = components[8] === undefined ? 0 : Number(components[8]);
  const offsetMinute =
    components[9] === undefined ? 0 : Number(components[9]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    !Number.isFinite(Date.parse(text))
  ) {
    throw new TypeError(`${path} must be a valid ISO-8601 timestamp`);
  }
  return text;
}

function validateComponents(
  value: unknown,
  path: string,
): Record<ComponentKey, string> {
  const components = requireRecord(value, path);
  requireExactKeys(components, COMPONENT_KEYS, path);
  return {
    cardDatabaseGroups: requirePattern(
      components.cardDatabaseGroups,
      SHA256_PATTERN,
      `${path}.cardDatabaseGroups`,
      "a lowercase SHA-256 hash",
    ),
    cardIdRanges: requirePattern(
      components.cardIdRanges,
      SHA256_PATTERN,
      `${path}.cardIdRanges`,
      "a lowercase SHA-256 hash",
    ),
    cardIdMigration: requirePattern(
      components.cardIdMigration,
      SHA256_PATTERN,
      `${path}.cardIdMigration`,
      "a lowercase SHA-256 hash",
    ),
    banlist: requirePattern(
      components.banlist,
      SHA256_PATTERN,
      `${path}.banlist`,
      "a lowercase SHA-256 hash",
    ),
    actionCatalog: requirePattern(
      components.actionCatalog,
      SHA256_PATTERN,
      `${path}.actionCatalog`,
      "a lowercase SHA-256 hash",
    ),
    locales: requirePattern(
      components.locales,
      SHA256_PATTERN,
      `${path}.locales`,
      "a lowercase SHA-256 hash",
    ),
  };
}

function validateApproval(value: unknown, index: number): DigestApproval {
  const path = `registry.approvals[${index}]`;
  const approval = requireRecord(value, path);
  const reason = requireString(approval.reason, `${path}.reason`);
  if (reason.trim().length === 0) {
    throw new TypeError(`${path}.reason must not be empty`);
  }
  const approvedAt = requireIsoTimestamp(
    approval.approvedAt,
    `${path}.approvedAt`,
  );

  return {
    functionalCommit: requirePattern(
      approval.functionalCommit,
      COMMIT_PATTERN,
      `${path}.functionalCommit`,
      "a lowercase 40-character commit hash",
    ),
    aggregate: requirePattern(
      approval.aggregate,
      SHA256_PATTERN,
      `${path}.aggregate`,
      "a lowercase SHA-256 hash",
    ),
    components: validateComponents(approval.components, `${path}.components`),
    reason,
    approvedAt,
  };
}

export function validateDigestRegistry(value: unknown): DigestRegistry {
  const registry = requireRecord(value, "registry");
  if (registry.format !== DIGEST_REGISTRY_FORMAT) {
    throw new TypeError(
      `registry.format must be "${DIGEST_REGISTRY_FORMAT}"`,
    );
  }
  if (registry.version !== DIGEST_REGISTRY_VERSION) {
    throw new TypeError(
      `registry.version must be ${DIGEST_REGISTRY_VERSION}`,
    );
  }
  const legacyReplaySignature = requirePattern(
    registry.legacyReplaySignature,
    LEGACY_SIGNATURE_PATTERN,
    "registry.legacyReplaySignature",
    "a lowercase 8-character hexadecimal signature",
  );
  if (!Array.isArray(registry.approvals) || registry.approvals.length === 0) {
    throw new TypeError("registry.approvals must be a non-empty array");
  }

  const approvalValues: readonly unknown[] = registry.approvals;
  const approvals = approvalValues.map(validateApproval);
  const aggregateHashes = new Set<string>();
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < approvals.length; index += 1) {
    const approval = approvals[index];
    const timestamp = Date.parse(approval.approvedAt);
    if (timestamp <= previousTimestamp) {
      throw new TypeError(
        `registry.approvals[${index}].approvedAt must be strictly later than the previous approval`,
      );
    }
    previousTimestamp = timestamp;
    if (aggregateHashes.has(approval.aggregate)) {
      throw new TypeError(
        `registry.approvals[${index}].aggregate duplicates an earlier approval`,
      );
    }
    aggregateHashes.add(approval.aggregate);
  }

  return {
    format: DIGEST_REGISTRY_FORMAT,
    version: DIGEST_REGISTRY_VERSION,
    legacyReplaySignature,
    approvals,
  };
}

export function parseDigestRegistry(source: string): DigestRegistry {
  const parsed: unknown = JSON.parse(source);
  return validateDigestRegistry(parsed);
}

export async function loadDigestRegistry(
  registryUrl: URL = REGISTRY_URL,
): Promise<DigestRegistry> {
  return parseDigestRegistry(await readFile(registryUrl, "utf8"));
}

export function getRuntimeLegacyReplaySignature(): string {
  return getCardDatabaseSignature();
}

export function verifyMigrationDigestValues({
  payload,
  registry: registryValue,
  legacyReplaySignature,
}: {
  payload: MigrationPayload;
  registry: unknown;
  legacyReplaySignature: string;
}): VerificationResult {
  const registry = validateDigestRegistry(registryValue);
  const approval = registry.approvals.at(-1);
  if (!approval) {
    throw new TypeError("registry.approvals must be a non-empty array");
  }
  if (legacyReplaySignature !== registry.legacyReplaySignature) {
    throw new Error(
      `Legacy replay signature mismatch: expected ${registry.legacyReplaySignature}, received ${legacyReplaySignature}`,
    );
  }

  const calculated = calculateMigrationDigests(payload);
  for (const key of COMPONENT_KEYS) {
    const expected = approval.components[key];
    const received = calculated.components[key];
    if (received !== expected) {
      throw new Error(
        `Migration digest component mismatch for ${key}: expected ${expected}, received ${received}`,
      );
    }
  }
  if (calculated.aggregate !== approval.aggregate) {
    throw new Error(
      `Migration digest aggregate mismatch: expected ${approval.aggregate}, received ${calculated.aggregate}`,
    );
  }

  return {
    ...calculated,
    legacyReplaySignature,
    approval,
  };
}

export async function verifyMigrationDigest(): Promise<VerificationResult> {
  const [payload, registry] = await Promise.all([
    loadMigrationPayload(),
    loadDigestRegistry(),
  ]);
  return verifyMigrationDigestValues({
    payload,
    registry,
    legacyReplaySignature: getRuntimeLegacyReplaySignature(),
  });
}

export function isDirectExecution(
  moduleUrl: string,
  entryPath: string | undefined,
): boolean {
  return entryPath !== undefined && fileURLToPath(moduleUrl) === resolve(entryPath);
}

async function runCli(): Promise<void> {
  try {
    const result = await verifyMigrationDigest();
    console.log(
      `Legacy replay signature: ${result.legacyReplaySignature} (verified)`,
    );
    for (const key of COMPONENT_KEYS) {
      console.log(`${key}: ${result.components[key]}`);
    }
    console.log(`aggregate: ${result.aggregate}`);
    console.log(
      `Migration digest matches approval from ${result.approval.approvedAt}.`,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Migration digest verification failed: ${message}`);
    process.exitCode = 1;
  }
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  void runCli();
}
