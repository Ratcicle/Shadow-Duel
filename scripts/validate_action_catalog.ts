import {
  ActionHandlerRegistry,
  registerDefaultHandlers,
} from "../src/core/ActionHandlers.js";
import {
  ACTION_BINDINGS,
  getActionBindingLabel,
  listActionBindingTypes,
} from "../src/core/actionHandlers/actionBindings.js";
import {
  ACTION_CATALOG,
  ACTION_CATEGORIES,
  listCatalogActionTypes,
  validateActionShape,
} from "../src/core/actionHandlers/actionCatalog.js";
import { walkEffectActions } from "../src/core/actionHandlers/actionWalker.js";
import type {
  ActionCatalogEntry,
  ActionFieldDefinition,
  ActionType,
} from "../src/core/contracts/actions.js";
import { cardDatabase } from "../src/data/cards.js";

type CatalogEntry = Omit<
  ActionCatalogEntry<ActionType>,
  "required" | "optional" | "fields"
> & {
  readonly required: readonly string[];
  readonly optional: readonly string[];
  readonly fields: Readonly<Record<string, ActionFieldDefinition>>;
};

const TARGET_REF_MODES = new Set(["none", "optional", "required"]);
const SELECTION_MODES = new Set(["none", "usesTargets", "dynamic"]);
const PREVIEW_MODES = new Set(["covered", "notNeeded", "missing"]);

function getRegisteredTypes() {
  const registry = new ActionHandlerRegistry();
  registerDefaultHandlers(registry);
  if (typeof registry.listTypes === "function") return registry.listTypes();
  return Array.from(registry.handlers?.keys?.() ?? []);
}

function asSortedSetDifference(
  left: readonly string[],
  right: readonly string[],
) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item)).sort();
}

function validateEntryShape(type: ActionType, entry: CatalogEntry) {
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
  if (
    !entry.fields ||
    typeof entry.fields !== "object" ||
    Array.isArray(entry.fields)
  ) {
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
  for (const fieldName of [
    ...(entry.required || []),
    ...(entry.optional || []),
  ]) {
    if (!fieldNames.has(fieldName)) {
      errors.push(
        `${type}: field "${fieldName}" is listed but has no definition.`,
      );
    }
  }

  return errors;
}

function validateExamples(type: ActionType, entry: CatalogEntry) {
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

    const targetIds = new Set<string>();
    if ("targetRef" in example && typeof example.targetRef === "string")
      targetIds.add(example.targetRef);
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

const registeredTypeOrder = getRegisteredTypes();
const bindingTypeOrder = listActionBindingTypes();
const registeredTypes = [...registeredTypeOrder].sort();
const bindingTypes = [...bindingTypeOrder].sort();
const catalogTypes = listCatalogActionTypes();
const errors = [];
const usedTypes = new Set<string>();

for (const card of cardDatabase) {
  for (const [effectIndex, effect] of (card.effects || []).entries()) {
    const actionWalk = walkEffectActions(effect, {
      path: ["cards", card.id, "effects", effectIndex],
    });
    for (const diagnostic of actionWalk.diagnostics) {
      errors.push(
        `Card ${card.id} ${diagnostic.pathText}: ${diagnostic.message}`,
      );
    }
    for (const visit of actionWalk.visits) {
      const action = visit.action;
      if (!action || typeof action !== "object") continue;
      if (
        "type" in action &&
        typeof action.type === "string" &&
        action.type.length > 0
      ) {
        usedTypes.add(action.type);
      }
    }
  }
}

for (const type of asSortedSetDifference(registeredTypes, catalogTypes)) {
  errors.push(`Registered action "${type}" is missing from ACTION_CATALOG.`);
}
for (const type of asSortedSetDifference(catalogTypes, registeredTypes)) {
  errors.push(
    `ACTION_CATALOG contains "${type}", but it is absent from the populated registry.`,
  );
}
for (const type of asSortedSetDifference(bindingTypes, catalogTypes)) {
  errors.push(
    `ACTION_BINDINGS contains "${type}", but it is missing from ACTION_CATALOG.`,
  );
}
for (const type of asSortedSetDifference(catalogTypes, bindingTypes)) {
  errors.push(
    `ACTION_CATALOG contains "${type}", but it is missing from ACTION_BINDINGS.`,
  );
}
for (const type of asSortedSetDifference([...usedTypes], catalogTypes)) {
  errors.push(
    `Card database uses action "${type}", but it is missing from ACTION_CATALOG.`,
  );
}
for (const type of asSortedSetDifference([...usedTypes], registeredTypes)) {
  errors.push(
    `Card database uses action "${type}", but it is absent from the populated registry.`,
  );
}

if (registeredTypeOrder.join("\n") !== bindingTypeOrder.join("\n")) {
  errors.push(
    "Registry order differs from the canonical ACTION_BINDINGS order.",
  );
}

const directBindings = bindingTypeOrder.filter(
  (type) => ACTION_BINDINGS[type].kind === "direct",
);
const proxyBindings = bindingTypeOrder.filter(
  (type) => ACTION_BINDINGS[type].kind === "proxy",
);
if (directBindings.length !== 80 || proxyBindings.length !== 29) {
  errors.push(
    `ACTION_BINDINGS must contain 80 direct and 29 proxy bindings; found ${directBindings.length} direct and ${proxyBindings.length} proxy.`,
  );
}

for (const type of catalogTypes) {
  const entry = ACTION_CATALOG[type];
  errors.push(...validateEntryShape(type, entry));
  errors.push(...validateExamples(type, entry));
  const expectedHandler = getActionBindingLabel(type);
  if (entry.handler !== expectedHandler) {
    errors.push(
      `${type}: catalog handler "${entry.handler}" does not match binding "${expectedHandler}".`,
    );
  }

  const binding = ACTION_BINDINGS[type];
  if (binding.kind === "direct" && binding.handler.name !== binding.handlerId) {
    errors.push(
      `${type}: direct handler id "${binding.handlerId}" does not match function name "${binding.handler.name}".`,
    );
  }
}

if (errors.length > 0) {
  console.error(
    `Action catalog validation failed with ${errors.length} issue(s):`,
  );
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Action catalog OK: ${catalogTypes.length} catalog entries match ${bindingTypes.length} bindings and ${registeredTypes.length} registered actions; ${usedTypes.size} action types are used by the card database.`,
);
