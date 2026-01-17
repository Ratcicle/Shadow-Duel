/**
 * Selection contract utilities - key building and contract normalization.
 * Extracted from Game.js as part of B.3 modularization.
 */

/**
 * Build a unique key for a selection candidate.
 * @param {Object} candidate - Candidate object
 * @param {number} fallbackIndex - Fallback index if no unique identifier
 * @returns {string} Unique key
 */
export function buildSelectionCandidateKey(candidate = {}, fallbackIndex = 0) {
  const zone = candidate.zone || "field";
  const zoneIndex =
    typeof candidate.zoneIndex === "number" ? candidate.zoneIndex : -1;
  const controller = candidate.controller || candidate.owner || "unknown";
  const baseId =
    candidate.cardRef?.id ||
    candidate.cardRef?.name ||
    candidate.name ||
    String(fallbackIndex);
  return `${controller}:${zone}:${zoneIndex}:${baseId}`;
}

/**
 * Normalize and validate a selection contract.
 * @param {Object} contract - Raw selection contract
 * @param {Object} overrides - Override options
 * @returns {{ok: boolean, contract?: Object, reason?: string}}
 */
export function normalizeSelectionContract(contract, overrides = {}) {
  const base =
    contract && typeof contract === "object" && !Array.isArray(contract)
      ? contract
      : {};
  const contractKind = base.kind || overrides.kind || "target";
  const rawRequirements = Array.isArray(base.requirements)
    ? base.requirements
    : base.requirements
    ? [base.requirements]
    : [];
  const normalizedRequirements = [];

  for (let i = 0; i < rawRequirements.length; i += 1) {
    const req = rawRequirements[i];
    if (!req || typeof req !== "object") {
      return { ok: false, reason: "Invalid selection requirements." };
    }

    const min = Number(req.min ?? req.count?.min ?? 1);
    const max = Number(req.max ?? req.count?.max ?? min);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      return { ok: false, reason: "Selection requirements are invalid." };
    }

    let zones = Array.isArray(req.zones)
      ? req.zones.filter(Boolean)
      : req.zone
      ? [req.zone]
      : [];
    // Tentativa de inferir zona a partir dos candidatos quando o contrato
    // chega sem zones explícitas (ex.: prompts gerados no servidor).
    if (zones.length === 0 && Array.isArray(req.candidates)) {
      const inferred = req.candidates
        .map((cand) => cand?.zone || cand?.zoneName)
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

    const ownerRaw = req.owner || "player";
    const owner =
      ownerRaw === "opponent"
        ? "opponent"
        : ownerRaw === "either" || ownerRaw === "any"
        ? "either"
        : "player";

    const candidates = Array.isArray(req.candidates)
      ? req.candidates
          .map((cand, idx) => {
            if (!cand || typeof cand !== "object") return null;
            if (!cand.key) {
              cand.key = this.buildSelectionCandidateKey(cand, idx);
            }
            return cand;
          })
          .filter(Boolean)
      : [];

    const normalized = {
      id: req.id || `selection_${i + 1}`,
      label: req.label || req.title || null,
      min,
      max,
      zones,
      owner,
      filters:
        req.filters && typeof req.filters === "object"
          ? { ...req.filters }
          : {},
      allowSelf: req.allowSelf !== false,
      distinct: req.distinct !== false,
      candidates,
    };

    normalizedRequirements.push(normalized);
  }

  if (normalizedRequirements.length === 0) {
    return { ok: false, reason: "Selection contract missing requirements." };
  }

  const uiBase = base.ui && typeof base.ui === "object" ? base.ui : {};
  const overrideUi =
    overrides.ui && typeof overrides.ui === "object" ? overrides.ui : {};

  const normalizedContract = {
    kind: contractKind,
    message: overrides.message ?? base.message ?? null,
    requirements: normalizedRequirements,
    ui: {
      allowCancel: overrideUi.allowCancel ?? uiBase.allowCancel ?? true,
      preventCancel: overrideUi.preventCancel ?? uiBase.preventCancel ?? false,
      useFieldTargeting:
        overrideUi.useFieldTargeting ?? uiBase.useFieldTargeting,
      allowEmpty: overrideUi.allowEmpty ?? uiBase.allowEmpty,
    },
    metadata:
      base.metadata && typeof base.metadata === "object"
        ? { ...base.metadata }
        : {},
  };

  return { ok: true, contract: normalizedContract };
}

/**
 * Check if field targeting can be used for the given requirements.
 * @param {Object|Array} requirements - Requirements object or array
 * @returns {boolean}
 */
export function canUseFieldTargeting(requirements) {
  const list = Array.isArray(requirements)
    ? requirements
    : requirements?.requirements || [];
  if (!list || list.length === 0) return false;
  const allowedZones = new Set(["field", "spellTrap", "fieldSpell"]);
  return list.every((req) => {
    if (!Array.isArray(req.candidates) || req.candidates.length === 0) {
      return false;
    }
    return req.candidates.every(
      (cand) =>
        (allowedZones.has(cand.zone) || cand.isDirectAttack === true) &&
        (cand.controller === "player" || cand.controller === "bot")
    );
  });
}
