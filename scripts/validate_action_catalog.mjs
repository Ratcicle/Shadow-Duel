import {
  ActionHandlerRegistry,
  registerDefaultHandlers,
} from "../src/core/ActionHandlers.js";
import {
  ACTION_CATALOG,
  ACTION_CATEGORIES,
  listCatalogActionTypes,
  validateActionShape,
} from "../src/core/actionHandlers/actionCatalog.js";

const TARGET_REF_MODES = new Set(["none", "optional", "required"]);
const SELECTION_MODES = new Set(["none", "usesTargets", "dynamic"]);
const PREVIEW_MODES = new Set(["covered", "notNeeded", "missing"]);

function getRegisteredTypes() {
  const registry = new ActionHandlerRegistry();
  registerDefaultHandlers(registry);
  if (typeof registry.listTypes === "function") return registry.listTypes();
  return Array.from(registry.handlers?.keys?.() ?? []);
}

function asSortedSetDifference(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item)).sort();
}

function validateEntryShape(type, entry) {
  const errors = [];
  const requiredKeys = [
    "category",
    "summary",
    "handler",
    "required",
    "optional",
    "fields",
    "targetRef",
    "selection",
    "mutates",
    "emits",
    "updatesBoard",
    "preview",
    "examples",
    "notes",
  ];

  for (const key of requiredKeys) {
    if (!(key in entry)) {
      errors.push(`${type}: missing catalog key "${key}".`);
    }
  }

  if (!ACTION_CATEGORIES.includes(entry.category)) {
    errors.push(`${type}: invalid category "${entry.category}".`);
  }
  if (!entry.summary || typeof entry.summary !== "string") {
    errors.push(`${type}: summary must be a non-empty string.`);
  }
  if (!entry.handler || typeof entry.handler !== "string") {
    errors.push(`${type}: handler must be a non-empty string.`);
  }
  if (!Array.isArray(entry.required)) {
    errors.push(`${type}: required must be an array.`);
  }
  if (!Array.isArray(entry.optional)) {
    errors.push(`${type}: optional must be an array.`);
  }
  if (!entry.fields || typeof entry.fields !== "object" || Array.isArray(entry.fields)) {
    errors.push(`${type}: fields must be an object.`);
  }
  if (!TARGET_REF_MODES.has(entry.targetRef)) {
    errors.push(`${type}: targetRef must be none, optional, or required.`);
  }
  if (!SELECTION_MODES.has(entry.selection)) {
    errors.push(`${type}: selection must be none, usesTargets, or dynamic.`);
  }
  if (!Array.isArray(entry.mutates)) {
    errors.push(`${type}: mutates must be an array.`);
  }
  if (!Array.isArray(entry.emits)) {
    errors.push(`${type}: emits must be an array.`);
  }
  if (typeof entry.updatesBoard !== "boolean") {
    errors.push(`${type}: updatesBoard must be a boolean.`);
  }
  if (!PREVIEW_MODES.has(entry.preview)) {
    errors.push(`${type}: preview must be covered, notNeeded, or missing.`);
  }
  if (!Array.isArray(entry.examples)) {
    errors.push(`${type}: examples must be an array.`);
  }
  if (!Array.isArray(entry.notes)) {
    errors.push(`${type}: notes must be an array.`);
  }

  const fieldNames = new Set(Object.keys(entry.fields || {}));
  for (const fieldName of [...(entry.required || []), ...(entry.optional || [])]) {
    if (!fieldNames.has(fieldName)) {
      errors.push(`${type}: field "${fieldName}" is listed but has no definition.`);
    }
  }

  return errors;
}

function validateExamples(type, entry) {
  const errors = [];
  for (const [index, example] of (entry.examples || []).entries()) {
    if (!example || typeof example !== "object" || Array.isArray(example)) {
      errors.push(`${type}: example ${index + 1} must be an object.`);
      continue;
    }
    if (!example.type) {
      errors.push(`${type}: example ${index + 1} is missing type.`);
      continue;
    }
    if (example.type !== type) {
      errors.push(
        `${type}: example ${index + 1} has type "${example.type}" instead of "${type}".`,
      );
    }

    const targetIds = new Set();
    if (typeof example.targetRef === "string") targetIds.add(example.targetRef);
    const shapeResult = validateActionShape(example, { targetIds });
    for (const message of shapeResult.errors) {
      errors.push(`${type}: example ${index + 1}: ${message}`);
    }
    for (const message of shapeResult.warnings) {
      errors.push(`${type}: example ${index + 1}: ${message}`);
    }
  }
  return errors;
}

const registeredTypes = getRegisteredTypes().sort();
const catalogTypes = listCatalogActionTypes();
const errors = [];

for (const type of asSortedSetDifference(registeredTypes, catalogTypes)) {
  errors.push(`Registered action "${type}" is missing from ACTION_CATALOG.`);
}
for (const type of asSortedSetDifference(catalogTypes, registeredTypes)) {
  errors.push(`ACTION_CATALOG contains "${type}", but it is not registered in wiring.js.`);
}

for (const type of catalogTypes) {
  const entry = ACTION_CATALOG[type];
  errors.push(...validateEntryShape(type, entry));
  errors.push(...validateExamples(type, entry));
}

if (errors.length > 0) {
  console.error(`Action catalog validation failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Action catalog OK: ${catalogTypes.length} catalog entries match ${registeredTypes.length} registered actions.`,
);
