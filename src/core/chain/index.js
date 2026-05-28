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
export * as responseWindow from "./responseWindow.js";
export * as botResponsePolicy from "./botResponsePolicy.js";
export * as playerResponse from "./playerResponse.js";
export * as selection from "./selection.js";
export { CHAIN_CONTEXTS } from "./contexts.js";
