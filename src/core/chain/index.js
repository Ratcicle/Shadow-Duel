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
export { CHAIN_CONTEXTS } from "./contexts.js";
