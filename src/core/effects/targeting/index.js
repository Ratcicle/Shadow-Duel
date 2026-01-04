/**
 * Targeting Module - Barrel file
 * Re-exports all targeting-related functions for EffectEngine
 */

// Zone access and card location utilities
export { getZone, findCardZone, getOwnerByCard } from "./zones.js";

// Candidate selection and key building
export { buildSelectionCandidateKey, selectCandidates } from "./selection.js";

// Main target resolution
export { resolveTargets } from "./resolution.js";

// Immunity and filtering
export {
  checkImmunity,
  isImmuneToOpponentEffects,
  filterCardsListByImmunity,
  filterTargetsByImmunity,
  inferEffectType,
  shouldSkipActionDueToImmunity,
} from "./filters.js";
