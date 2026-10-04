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

    const excludedRefs = readObjectValue(req, "excludeTargetRefs");
    if (Array.isArray(excludedRefs)) {
      const refs = excludedRefs.filter((ref): ref is string => typeof ref === "string");
      if (refs.length) normalized.excludeTargetRefs = [...new Set(refs)];
    }

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

interface DependentRequirement<Candidate extends RawSelectionCandidate = RawSelectionCandidate> {
  id?: string;
  min?: number;
  max?: number;
  preferredCount?: number;
  excludeTargetRefs?: readonly string[];
  candidates?: readonly Candidate[];
}
type SelectionKeys = Readonly<Record<string, readonly string[]>>;

function sameSelectionInstance(left: RawSelectionCandidate, right: RawSelectionCandidate): boolean {
  const a = left.cardRef || left.card, b = right.cardRef || right.card;
  if (a && b) {
    if (a === b) return true;
    if (a.duelCardId != null && b.duelCardId != null) return a.duelCardId === b.duelCardId;
    return a.instanceId != null && a.instanceId === b.instanceId;
  }
  return !a && !b && left.key != null && left.key === right.key;
}

/** Retain the immutable pool; each consumer derives eligibility from current choices. */
export function getEligibleSelectionCandidates<Candidate extends RawSelectionCandidate>(
  requirement: DependentRequirement<Candidate>,
  requirements: readonly DependentRequirement[],
  selections: SelectionKeys,
): Candidate[] {
  const excluded = (requirement.excludeTargetRefs || []).flatMap(ref => {
    const keys = selections[ref] || [];
    return (requirements.find(other => other.id === ref)?.candidates || [])
      .filter(candidate => candidate.key != null && keys.includes(candidate.key));
  });
  return (requirement.candidates || []).filter(candidate =>
    !excluded.some(other => sameSelectionInstance(candidate, other)));
}

/** Upstream edits invalidate dependent choices without changing their source pools. */
export function pruneExcludedSelections<Key extends string>(requirements: readonly DependentRequirement[], selections: Record<string, Key[]>): void {
  for (let pass = 0; pass < requirements.length; pass++) {
    let changed = false;
    for (const requirement of requirements) {
      if (!requirement.id || !requirement.excludeTargetRefs?.length) continue;
      const allowed = new Set(getEligibleSelectionCandidates(requirement, requirements, selections).map(candidate => candidate.key));
      const previous = selections[requirement.id] || [];
      const next = previous.filter(key => allowed.has(key));
      if (next.length !== previous.length) { selections[requirement.id] = next; changed = true; }
    }
    if (!changed) break;
  }
}

/** Exclusions only remove candidates, so a feasible minimum-size assignment suffices. */
export function findFeasibleSelection(requirements: readonly DependentRequirement[]): Record<string, string[]> | null {
  const selected: Record<string, string[]> = {};
  const ordered = [...requirements].sort((a, b) => (a.candidates?.length || 0) - (b.candidates?.length || 0));
  const consistent = () => requirements.every(requirement => !requirement.id ||
    (selected[requirement.id] || []).every(key => getEligibleSelectionCandidates(requirement, requirements, selected)
      .some(candidate => candidate.key === key)));
  const assign = (index: number): boolean => {
    if (index === ordered.length) return true;
    const requirement = ordered[index]!;
    const id = requirement.id;
    if (!id) return false;
    const keys = [...new Set(getEligibleSelectionCandidates(requirement, requirements, selected)
      .flatMap(candidate => typeof candidate.key === "string" ? [candidate.key] : []))];
    const min = Math.max(0, requirement.min ?? 0);
    const preferred = Math.min(requirement.preferredCount ?? min, requirement.max ?? min, keys.length);
    const choose = (start: number, chosen: string[], count: number): boolean => {
      if (chosen.length === count) {
        selected[id] = chosen;
        if (consistent() && assign(index + 1)) return true;
        delete selected[id];
        return false;
      }
      const remaining = count - chosen.length;
      for (let next = start; next <= keys.length - remaining; next++) {
        if (choose(next + 1, [...chosen, keys[next]!], count)) return true;
      }
      return false;
    };
    for (let count = preferred; count >= min; count--) {
      if (choose(0, [], count)) return true;
    }
    return false;
  };
  return assign(0) ? selected : null;
}

export function hasFeasibleSelection(requirements: readonly DependentRequirement[]): boolean {
  return !requirements.some(requirement => requirement.excludeTargetRefs?.length) || findFeasibleSelection(requirements) !== null;
}
