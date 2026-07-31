import type { ActionByType, ActionType } from "../contracts/actions.js";

export type ActionStage = "cost" | "commit" | "resolution";

export type ActionFlow = "activation" | "replacement" | "negation";

export type ActionRoot =
  | "activationCosts"
  | "activationCommitActions"
  | "actions"
  | "replacementEffect.costActions"
  | "negationCost"
  | "actionList";

export type ActionPathSegment = string | number;

export type ActionWalkDiagnosticCode =
  | "invalid-action-list"
  | "invalid-action"
  | "invalid-container"
  | "cycle";

export interface ActionWalkDiagnostic {
  readonly code: ActionWalkDiagnosticCode;
  readonly path: readonly ActionPathSegment[];
  readonly pathText: string;
  readonly message: string;
}

export interface ActionVisit {
  readonly action: unknown;
  readonly stage: ActionStage;
  readonly flow: ActionFlow;
  readonly root: ActionRoot;
  readonly container: string;
  readonly depth: number;
  readonly sequence: number;
  readonly actionIndex: number;
  readonly path: readonly ActionPathSegment[];
  readonly pathText: string;
  readonly targetIds: ReadonlySet<string>;
  readonly availableRefs: ReadonlySet<string>;
  readonly producedRefs: ReadonlySet<string>;
}

export interface ActionWalkResult {
  readonly visits: readonly ActionVisit[];
  readonly diagnostics: readonly ActionWalkDiagnostic[];
  readonly refsAfter: ReadonlySet<string>;
}

export interface WalkActionListOptions {
  readonly stage?: ActionStage;
  readonly flow?: ActionFlow;
  readonly root?: ActionRoot;
  readonly path?: readonly ActionPathSegment[];
  readonly targetIds?: Iterable<string>;
  readonly availableRefs?: Iterable<string>;
  readonly depth?: number;
  readonly container?: string;
}

type UnknownRecord = { readonly [key: string]: unknown };

interface WalkContext {
  readonly visits: ActionVisit[];
  readonly diagnostics: ActionWalkDiagnostic[];
  readonly stack: WeakSet<object>;
  sequence: number;
}

interface InternalListOptions {
  readonly stage: ActionStage;
  readonly flow: ActionFlow;
  readonly root: ActionRoot;
  readonly path: readonly ActionPathSegment[];
  readonly targetIds: ReadonlySet<string>;
  readonly availableRefs: ReadonlySet<string>;
  readonly depth: number;
  readonly container: string;
  readonly rootActionIndex?: number;
}

const PRODUCED_REF_FIELDS = [
  "resultRef",
  "storeResultAs",
  "storeNegatedCardAs",
] as const;

const ACTION_LIST_FIELDS = ["actions", "defaultActions"] as const;

type ContractNestingField =
  | "actions"
  | "defaultActions"
  | "cases"
  | "targets"
  | "replacementEffect";

type ActionNestingContract = {
  readonly [Type in ActionType]?: readonly (Extract<
    keyof ActionByType[Type],
    ContractNestingField
  > &
    string)[];
};

/**
 * Compile-time link between recursive authoring fields and their action
 * variants. Raw defensive traversal remains separate below so malformed or
 * legacy input can still receive complete diagnostics.
 */
export const ACTION_NESTING_BY_TYPE = {
  choose_action_case: ["cases"],
  conditional_target_actions: ["cases", "defaultActions"],
  optional_target_actions: ["targets", "actions"],
  conditional_actions: ["actions"],
  register_temporary_event_effect: ["targets", "actions"],
  register_battle_pair_effect: ["actions"],
  register_synchro_material_followup: ["actions"],
  register_replacement_effect: ["replacementEffect"],
} as const satisfies ActionNestingContract;

const DEFENSIVE_ACTION_LIST_FIELDS = [
  "thenActions",
  "ifActions",
  "elseActions",
  "optionalActions",
  "onSuccessActions",
] as const;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contractNestingFields(action: UnknownRecord): ReadonlySet<string> {
  const type = action.type;
  if (
    typeof type !== "string" ||
    !Object.prototype.hasOwnProperty.call(ACTION_NESTING_BY_TYPE, type)
  ) {
    return new Set<string>();
  }
  const fields = Reflect.get(ACTION_NESTING_BY_TYPE, type);
  return new Set(Array.isArray(fields) ? fields : []);
}

function cloneSet(values: Iterable<string>): Set<string> {
  return new Set(values);
}

function addDiagnostic(
  context: WalkContext,
  code: ActionWalkDiagnosticCode,
  path: readonly ActionPathSegment[],
  message: string,
): void {
  const storedPath = [...path];
  context.diagnostics.push({
    code,
    path: storedPath,
    pathText: formatActionPath(storedPath),
    message,
  });
}

function collectTargetIds(value: unknown, inherited: ReadonlySet<string>): Set<string> {
  const targetIds = cloneSet(inherited);
  if (!Array.isArray(value)) return targetIds;

  for (const target of value) {
    if (!isRecord(target)) continue;
    const id = target.id;
    if (typeof id === "string" && id.length > 0) targetIds.add(id);
  }
  return targetIds;
}

function collectProducedRefs(action: UnknownRecord): Set<string> {
  const refs = new Set<string>();
  for (const field of PRODUCED_REF_FIELDS) {
    const value = action[field];
    if (typeof value === "string" && value.length > 0) refs.add(value);
  }
  return refs;
}

function walkChildList(
  value: unknown,
  context: WalkContext,
  options: InternalListOptions,
): void {
  if (value === undefined) return;
  walkList(value, context, options);
}

function walkCases(
  action: UnknownRecord,
  context: WalkContext,
  options: InternalListOptions,
  childAvailableRefs: ReadonlySet<string>,
  childTargetIds: ReadonlySet<string>,
): void {
  const cases = action.cases;
  if (cases === undefined) return;
  const casesPath = [...options.path, "cases"];
  if (!Array.isArray(cases)) {
    addDiagnostic(
      context,
      "invalid-container",
      casesPath,
      "Action container must be an array.",
    );
    return;
  }

  if (context.stack.has(cases)) {
    addDiagnostic(context, "cycle", casesPath, "Cyclic action container detected.");
    return;
  }

  context.stack.add(cases);
  for (const [caseIndex, caseValue] of cases.entries()) {
    const casePath = [...casesPath, caseIndex];
    if (!isRecord(caseValue)) {
      addDiagnostic(
        context,
        "invalid-container",
        casePath,
        "Action case must be an object.",
      );
      continue;
    }

    const caseTargetIds = collectTargetIds(caseValue.targets, childTargetIds);
    if (caseValue.actions !== undefined) {
      walkChildList(caseValue.actions, context, {
        ...options,
        path: [...casePath, "actions"],
        targetIds: caseTargetIds,
        availableRefs: cloneSet(childAvailableRefs),
        depth: options.depth + 1,
        container: "cases[].actions",
      });
    }
  }
  context.stack.delete(cases);
}

function walkEntries(
  action: UnknownRecord,
  context: WalkContext,
  options: InternalListOptions,
  childAvailableRefs: ReadonlySet<string>,
  childTargetIds: ReadonlySet<string>,
): void {
  const entries = action.entries;
  const entriesPath = [...options.path, "entries"];
  if (entries === undefined) return;
  if (!Array.isArray(entries)) {
    addDiagnostic(
      context,
      "invalid-container",
      entriesPath,
      "Action entries container must be an array.",
    );
    return;
  }

  if (context.stack.has(entries)) {
    addDiagnostic(context, "cycle", entriesPath, "Cyclic action container detected.");
    return;
  }

  context.stack.add(entries);
  for (const [entryIndex, entryValue] of entries.entries()) {
    if (!isRecord(entryValue) || entryValue.actions === undefined) continue;
    walkChildList(entryValue.actions, context, {
      ...options,
      path: [...entriesPath, entryIndex, "actions"],
      targetIds: childTargetIds,
      availableRefs: cloneSet(childAvailableRefs),
      depth: options.depth + 1,
      container: "entries[].actions",
    });
  }
  context.stack.delete(entries);
}

function walkStoredReplacement(
  action: UnknownRecord,
  context: WalkContext,
  options: InternalListOptions,
): void {
  const replacementEffect = action.replacementEffect;
  if (!isRecord(replacementEffect) || replacementEffect.costActions === undefined) {
    return;
  }

  walkChildList(replacementEffect.costActions, context, {
    ...options,
    stage: "cost",
    flow: "replacement",
    root: "replacementEffect.costActions",
    path: [...options.path, "replacementEffect", "costActions"],
    targetIds: collectTargetIds(replacementEffect.targets, new Set<string>()),
    availableRefs: new Set<string>(),
    depth: options.depth + 1,
    container: "replacementEffect.costActions",
  });
}

function walkAction(
  action: unknown,
  context: WalkContext,
  options: InternalListOptions,
  siblingRefs: Set<string>,
  actionIndex: number,
): void {
  const actionPath = [...options.path, actionIndex];
  const rootActionIndex = options.rootActionIndex ?? actionIndex;
  const availableRefs = cloneSet(siblingRefs);

  if (!isRecord(action)) {
    const visit: ActionVisit = {
      action,
      stage: options.stage,
      flow: options.flow,
      root: options.root,
      container: options.container,
      depth: options.depth,
      sequence: context.sequence,
      actionIndex: rootActionIndex,
      path: actionPath,
      pathText: formatActionPath(actionPath),
      targetIds: cloneSet(options.targetIds),
      availableRefs,
      producedRefs: new Set<string>(),
    };
    context.sequence += 1;
    context.visits.push(visit);
    addDiagnostic(context, "invalid-action", actionPath, "Action must be an object.");
    return;
  }

  if (context.stack.has(action)) {
    addDiagnostic(context, "cycle", actionPath, "Cyclic action object detected.");
    return;
  }

  const actionTargetIds = collectTargetIds(action.targets, options.targetIds);
  const producedRefs = collectProducedRefs(action);
  const supportedNestingFields = contractNestingFields(action);
  const visit: ActionVisit = {
    action,
    stage: options.stage,
    flow: options.flow,
    root: options.root,
    container: options.container,
    depth: options.depth,
    sequence: context.sequence,
    actionIndex: rootActionIndex,
    path: actionPath,
    pathText: formatActionPath(actionPath),
    targetIds: cloneSet(actionTargetIds),
    availableRefs,
    producedRefs: cloneSet(producedRefs),
  };
  context.sequence += 1;
  context.visits.push(visit);

  const childAvailableRefs = cloneSet(availableRefs);
  for (const ref of producedRefs) childAvailableRefs.add(ref);

  context.stack.add(action);
  for (const field of ACTION_LIST_FIELDS) {
    if (action[field] === undefined) continue;
    walkChildList(action[field], context, {
      ...options,
      path: [...actionPath, field],
      targetIds: actionTargetIds,
      availableRefs: cloneSet(childAvailableRefs),
      depth: options.depth + 1,
      container: supportedNestingFields.has(field) ? field : `legacy:${field}`,
      rootActionIndex,
    });
  }
  walkCases(
    action,
    context,
    { ...options, path: actionPath, rootActionIndex },
    childAvailableRefs,
    actionTargetIds,
  );
  for (const field of DEFENSIVE_ACTION_LIST_FIELDS) {
    if (action[field] === undefined) continue;
    walkChildList(action[field], context, {
      ...options,
      path: [...actionPath, field],
      targetIds: actionTargetIds,
      availableRefs: cloneSet(childAvailableRefs),
      depth: options.depth + 1,
      container: field,
      rootActionIndex,
    });
  }
  walkEntries(
    action,
    context,
    { ...options, path: actionPath, rootActionIndex },
    childAvailableRefs,
    actionTargetIds,
  );
  walkStoredReplacement(
    action,
    context,
    { ...options, path: actionPath, rootActionIndex },
  );
  context.stack.delete(action);

  for (const ref of producedRefs) siblingRefs.add(ref);
}

function walkList(
  actions: unknown,
  context: WalkContext,
  options: InternalListOptions,
): Set<string> {
  const refsAfter = cloneSet(options.availableRefs);
  if (!Array.isArray(actions)) {
    addDiagnostic(
      context,
      "invalid-action-list",
      options.path,
      "Action list must be an array.",
    );
    return refsAfter;
  }

  if (context.stack.has(actions)) {
    addDiagnostic(context, "cycle", options.path, "Cyclic action list detected.");
    return refsAfter;
  }

  context.stack.add(actions);
  for (const [actionIndex, action] of actions.entries()) {
    walkAction(action, context, options, refsAfter, actionIndex);
  }
  context.stack.delete(actions);
  return refsAfter;
}

function createContext(): WalkContext {
  return {
    visits: [],
    diagnostics: [],
    stack: new WeakSet<object>(),
    sequence: 0,
  };
}

function resultFromContext(
  context: WalkContext,
  refsAfter: ReadonlySet<string>,
): ActionWalkResult {
  return {
    visits: context.visits,
    diagnostics: context.diagnostics,
    refsAfter: cloneSet(refsAfter),
  };
}

export function formatActionPath(path: readonly ActionPathSegment[]): string {
  let result = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      result += `[${segment}]`;
      continue;
    }
    if (/^[A-Za-z_$][\w$]*$/.test(segment)) {
      result += result.length === 0 ? segment : `.${segment}`;
      continue;
    }
    result += `[${JSON.stringify(segment)}]`;
  }
  return result;
}

export function walkActionList(
  actions: unknown,
  options: WalkActionListOptions = {},
): ActionWalkResult {
  const context = createContext();
  const refsAfter = walkList(actions, context, {
    stage: options.stage ?? "resolution",
    flow: options.flow ?? "activation",
    root: options.root ?? "actionList",
    path: options.path ? [...options.path] : ["actions"],
    targetIds: new Set(options.targetIds ?? []),
    availableRefs: new Set(options.availableRefs ?? []),
    depth: options.depth ?? 0,
    container: options.container ?? "actions",
  });
  return resultFromContext(context, refsAfter);
}

export function walkEffectActions(
  effect: unknown,
  options: { readonly path?: readonly ActionPathSegment[] } = {},
): ActionWalkResult {
  const context = createContext();
  const basePath = options.path ? [...options.path] : [];
  if (!isRecord(effect)) {
    addDiagnostic(context, "invalid-container", basePath, "Effect must be an object.");
    return resultFromContext(context, new Set<string>());
  }

  const effectTargetIds = collectTargetIds(effect.targets, new Set<string>());
  let activationRefs = new Set<string>();
  const activationRoots = [
    ["activationCosts", "cost"],
    ["activationCommitActions", "commit"],
    ["actions", "resolution"],
  ] as const;

  for (const [root, stage] of activationRoots) {
    const value = effect[root];
    if (value === undefined) continue;
    activationRefs = walkList(value, context, {
      stage,
      flow: "activation",
      root,
      path: [...basePath, root],
      targetIds: effectTargetIds,
      availableRefs: activationRefs,
      depth: 0,
      container: root,
    });
  }

  const replacementEffect = effect.replacementEffect;
  if (isRecord(replacementEffect) && replacementEffect.costActions !== undefined) {
    walkList(replacementEffect.costActions, context, {
      stage: "cost",
      flow: "replacement",
      root: "replacementEffect.costActions",
      path: [...basePath, "replacementEffect", "costActions"],
      targetIds: collectTargetIds(replacementEffect.targets, effectTargetIds),
      availableRefs: new Set<string>(),
      depth: 0,
      container: "replacementEffect.costActions",
    });
  }

  if (effect.negationCost !== undefined) {
    walkList(effect.negationCost, context, {
      stage: "cost",
      flow: "negation",
      root: "negationCost",
      path: [...basePath, "negationCost"],
      targetIds: effectTargetIds,
      availableRefs: new Set<string>(),
      depth: 0,
      container: "negationCost",
    });
  }

  return resultFromContext(context, activationRefs);
}
