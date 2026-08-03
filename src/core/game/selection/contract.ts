/**
 * Selection contract utilities - key building and contract normalization.
 * Extracted from Game.js as part of B.3 modularization.
 */

import type { CardFilter } from "../../contracts/effects.js";
import type { SelectionCandidateKey } from "../../contracts/primitives.js";
import type {
  CanonicalSelectionMap,
  NormalizedSelectionContract,
  RawSelectionContract,
  RawSelectionCandidate,
  RawSelectionRequirement,
  SelectionCandidate,
  SelectionKind,
  SelectionMetadata,
  SelectionNormalizationOverrides,
  SelectionNormalizationResult,
  SelectionRequirement,
  SelectionChannelSource,
  SelectionZone,
} from "../../contracts/selection.js";

type UnknownObject = { [property: string]: unknown };

interface SelectionContractHost {
  buildSelectionCandidateKey(
    candidate?: RawSelectionCandidate,
    fallbackIndex?: number,
  ): SelectionCandidateKey;
}

function isObject(value: unknown): value is UnknownObject {
  return typeof value === "object" && value !== null;
}

function readObjectValue(value: UnknownObject, key: string): unknown {
  return Reflect.get(value, key);
}

function readNestedValue(value: unknown, key: string): unknown {
  return isObject(value) ? Reflect.get(value, key) : undefined;
}

/**
 * Build a unique key for a selection candidate.
 * The cast is confined to the producer that constructs the runtime identity;
 * no public cast helper is exposed.
 */
export function buildSelectionCandidateKey(
  candidate: RawSelectionCandidate = {},
  fallbackIndex = 0,
): SelectionCandidateKey {
  const zone = candidate.zone || "field";
  const zoneIndex =
    typeof candidate.zoneIndex === "number" ? candidate.zoneIndex : -1;
  const controller = candidate.controller || candidate.owner || "unknown";
  const baseId =
    candidate.cardRef?.id ||
    candidate.cardRef?.name ||
    candidate.name ||
    String(fallbackIndex);
  return `${controller}:${zone}:${zoneIndex}:${baseId}` as SelectionCandidateKey;
}

/**
 * Normalize and validate a selection contract.
 * `unknown` is intentional at this defensive runtime boundary: replay and
 * legacy JS callers may provide malformed input that must become a diagnostic.
 */
export function normalizeSelectionContract(
  this: SelectionContractHost,
  contract: unknown,
  overrides: SelectionNormalizationOverrides = {},
): SelectionNormalizationResult {
  const base =
    contract && typeof contract === "object" && !Array.isArray(contract)
      ? (contract as UnknownObject)
      : {};
  const rawKind = readObjectValue(base, "kind") || overrides.kind || "target";
  const contractKind = rawKind as SelectionKind;
  const requirementsValue = readObjectValue(base, "requirements");
  const rawRequirements = Array.isArray(requirementsValue)
    ? requirementsValue
    : requirementsValue
    ? [requirementsValue]
    : [];
  const normalizedRequirements: SelectionRequirement[] = [];

  for (let i = 0; i < rawRequirements.length; i += 1) {
    const req = rawRequirements[i];
    if (!req || typeof req !== "object") {
      return { ok: false, reason: "Invalid selection requirements." };
    }

    const count = readObjectValue(req, "count");
    const min = Number(
      readObjectValue(req, "min") ?? readNestedValue(count, "min") ?? 1,
    );
    const max = Number(
      readObjectValue(req, "max") ?? readNestedValue(count, "max") ?? min,
    );
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      return { ok: false, reason: "Selection requirements are invalid." };
    }

    const requirementZones = readObjectValue(req, "zones");
    const requirementZone = readObjectValue(req, "zone");
    let zones = Array.isArray(requirementZones)
      ? requirementZones.filter(Boolean)
      : requirementZone
      ? [requirementZone]
      : [];
    // Tentativa de inferir zona a partir dos candidatos quando o contrato
    // chega sem zones explícitas (ex.: prompts gerados no servidor).
    const requirementCandidates = readObjectValue(req, "candidates");
    if (zones.length === 0 && Array.isArray(requirementCandidates)) {
      const inferred = requirementCandidates
        .map((candidate: unknown) =>
          isObject(candidate)
            ? Reflect.get(candidate, "zone") || Reflect.get(candidate, "zoneName")
            : undefined,
        )
        .filter((z) => typeof z === "string" && z.length > 0);
      if (inferred.length > 0) {
        zones = Array.from(new Set(inferred));
      }
    }
    if (zones.length === 0 && contractKind === "position_select") {
      zones = ["field"];
    }
    if (zones.length === 0) {
      return { ok: false, reason: "Selection requirements missing zones." };
    }

    const ownerRaw = readObjectValue(req, "owner") || "player";
    const owner =
      ownerRaw === "opponent"
        ? "opponent"
        : ownerRaw === "either" || ownerRaw === "any"
        ? "either"
        : "player";

    const candidates = Array.isArray(requirementCandidates)
      ? requirementCandidates
          .map((cand: unknown, idx: number): SelectionCandidate | null => {
            if (!cand || typeof cand !== "object") return null;
            const candidate = cand as RawSelectionCandidate;
            if (!candidate.key) {
              candidate.key = this.buildSelectionCandidateKey(candidate, idx);
            }
            return candidate as SelectionCandidate;
          })
          .filter((candidate): candidate is SelectionCandidate => candidate !== null)
      : [];

    const filtersValue = readObjectValue(req, "filters");
    const normalized: SelectionRequirement = {
      id: (readObjectValue(req, "id") || `selection_${i + 1}`) as string,
      label:
        (readObjectValue(req, "label") || readObjectValue(req, "title") ||
          null) as string | null,
      min,
      max,
      zones: zones as SelectionZone[],
      owner,
      filters:
        filtersValue && typeof filtersValue === "object"
          ? ({ ...filtersValue } as CardFilter)
          : {},
      allowSelf: readObjectValue(req, "allowSelf") !== false,
      distinct: readObjectValue(req, "distinct") !== false,
      candidates,
    };

    normalizedRequirements.push(normalized);
  }

  if (normalizedRequirements.length === 0) {
    return { ok: false, reason: "Selection contract missing requirements." };
  }

  const baseUiValue = readObjectValue(base, "ui");
  const uiBase = isObject(baseUiValue) ? baseUiValue : {};
  const overrideUi =
    overrides.ui && typeof overrides.ui === "object" ? overrides.ui : {};

  const metadataValue = readObjectValue(base, "metadata");
  const normalizedContract: NormalizedSelectionContract = {
    kind: contractKind,
    message:
      (overrides.message ?? readObjectValue(base, "message") ?? null) as
        | string
        | null,
    requirements: normalizedRequirements,
    ui: {
      allowCancel:
        overrideUi.allowCancel ??
        (readObjectValue(uiBase, "allowCancel") as boolean | undefined) ??
        true,
      preventCancel:
        overrideUi.preventCancel ??
        (readObjectValue(uiBase, "preventCancel") as boolean | undefined) ??
        false,
      useFieldTargeting:
        overrideUi.useFieldTargeting ??
        (readObjectValue(uiBase, "useFieldTargeting") as boolean | undefined),
      allowEmpty:
        overrideUi.allowEmpty ??
        (readObjectValue(uiBase, "allowEmpty") as boolean | undefined),
    },
    metadata:
      metadataValue && typeof metadataValue === "object"
        ? ({ ...metadataValue } as SelectionMetadata)
        : {},
  };

  return { ok: true, contract: normalizedContract };
}

/**
 * Check if field targeting can be used for the given requirements.
 */
export function canUseFieldTargeting(
  requirements:
    | RawSelectionRequirement[]
    | SelectionRequirement[]
    | NormalizedSelectionContract
    | null
    | undefined,
): boolean {
  const list = Array.isArray(requirements)
    ? requirements
    : requirements?.requirements || [];
  if (!list || list.length === 0) return false;

  const allCandidates = [];
  for (const req of list) {
    if (!Array.isArray(req.candidates) || req.candidates.length === 0) {
      return false;
    }
    allCandidates.push(...req.candidates);
  }

  const hasClickableCards = allCandidates.every(
    (cand) =>
      cand?.cardRef &&
      (cand.controller === "player" || cand.controller === "bot"),
  );
  if (!hasClickableCards) return false;

  const fieldZones = new Set(["field", "spellTrap", "fieldSpell"]);
  const isFieldOnly = allCandidates.every(
    (cand) => cand.zone !== undefined && fieldZones.has(cand.zone),
  );
  const isHandOnly = allCandidates.every((cand) => cand.zone === "hand");
  return isFieldOnly || isHandOnly;
}

/** Build the read-only aggregate needed by action handlers from split state. */
export function mergeCanonicalSelections(
  selectionState: SelectionChannelSource | null | undefined = {},
): CanonicalSelectionMap {
  if (!selectionState || typeof selectionState !== "object") return {};
  return {
    ...(selectionState.costSelections || {}),
    ...(selectionState.targetSelections || {}),
    ...(selectionState.resolutionSelections || {}),
  } as CanonicalSelectionMap;
}
