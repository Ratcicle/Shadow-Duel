/**
 * Chain Module - Main barrel file
 * Aggregates all chain sub-modules for ChainSystem.
 *
 * Mirrors the convention of src/core/effects/index.js:
 * ChainSystem.js becomes a thin facade that imports these modules
 * and binds their functions via prototype.
 */

export * as spellSpeed from "./spellSpeed.js";
export * as stack from "./stack.js";
export * as effectMatching from "./effectMatching.js";
export * as activationDiscovery from "./activationDiscovery.js";
export * as activation from "./activation.js";
export * as link from "./link.js";
export * as timing from "./timing.js";
export * as segoc from "./segoc.js";
export * as usage from "./usage.js";
export * as finalization from "./finalization.js";
export {
  CHAIN_ACTIVATION_KINDS,
  CHAIN_EFFECT_KINDS,
  CHAIN_RESPONSE_CONTEXTS,
} from "./link.js";
export { FAST_EFFECT_ORIGINS, FAST_EFFECT_STATES } from "./timing.js";
export {
  SEGOC_GROUPS,
  TRIGGER_REQUIREMENTS,
  TRIGGER_TIMINGS,
} from "./segoc.js";
export { USAGE_POLICIES } from "./usage.js";
export * as responseWindow from "./responseWindow.js";
export * as botResponsePolicy from "./botResponsePolicy.js";
export * as playerResponse from "./playerResponse.js";
export * as selection from "./selection.js";
export { CHAIN_CONTEXTS } from "./contexts.js";
