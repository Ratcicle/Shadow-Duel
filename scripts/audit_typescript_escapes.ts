import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const TYPESCRIPT_FILE_PATTERN = /\.(?:ts|tsx|mts|cts)$/i;
const AUDITED_DIRECTORIES = ["src", "scripts", "test"] as const;
const EXCLUDED_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".vite",
  "coverage",
  "dist",
  "node_modules",
]);

export interface TypeScriptSourceInput {
  path: string;
  text: string;
}

export interface AuditDiagnostic {
  code: string;
  message: string;
  path: string;
  line: number;
  column: number;
}

export interface TypeScriptEscapeAuditResult {
  diagnostics: AuditDiagnostic[];
  scannedFiles: number;
}

interface SourceComment {
  start: number;
  startLine: number;
  endLine: number;
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

function collectComments(
  sourceFile: ts.SourceFile,
  sourceText: string,
): SourceComment[] {
  const ranges = new Map<string, ts.CommentRange>();

  const addRanges = (found: readonly ts.CommentRange[] | undefined): void => {
    for (const range of found ?? []) {
      ranges.set(`${range.pos}:${range.end}`, range);
    }
  };

  const visit = (node: ts.Node): void => {
    addRanges(ts.getLeadingCommentRanges(sourceText, node.getFullStart()));
    addRanges(ts.getTrailingCommentRanges(sourceText, node.getEnd()));
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return [...ranges.values()]
    .sort((left, right) => left.pos - right.pos)
    .map((range) => {
      const startLocation = sourceFile.getLineAndCharacterOfPosition(range.pos);
      const endLocation = sourceFile.getLineAndCharacterOfPosition(
        Math.max(range.pos, range.end - 1),
      );
      return {
        start: range.pos,
        startLine: startLocation.line + 1,
        endLine: endLocation.line + 1,
        text: sourceText.slice(range.pos, range.end),
      };
    });
}

function commentBody(comment: SourceComment): string {
  if (comment.text.startsWith("//")) {
    return comment.text.replace(/^\/\/\/?/, "").trim();
  }
  return comment.text.replace(/^\/\*/, "").replace(/\*\/$/, "").trim();
}

function directiveKind(
  comment: SourceComment,
): "ts-ignore" | "ts-nocheck" | "ts-expect-error" | undefined {
  const match = /^@(ts-ignore|ts-nocheck|ts-expect-error)\b/.exec(
    commentBody(comment),
  );
  if (
    match?.[1] === "ts-ignore" ||
    match?.[1] === "ts-nocheck" ||
    match?.[1] === "ts-expect-error"
  ) {
    return match[1];
  }
  return undefined;
}

function hasContractNegativeJustification(
  comments: SourceComment[],
  directive: SourceComment,
): boolean {
  return comments.some((comment) => {
    if (comment.endLine !== directive.startLine - 1) return false;
    const match = /^contract-negative\s*:\s*(.+)$/i.exec(commentBody(comment));
    return (match?.[1]?.trim().length ?? 0) > 0;
  });
}

function sourceLocation(
  sourceFile: ts.SourceFile,
  position: number,
): { line: number; column: number } {
  const location = sourceFile.getLineAndCharacterOfPosition(position);
  return { line: location.line + 1, column: location.character + 1 };
}

function unwrapParentheses(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function isTypeAssertion(
  node: ts.Node,
): node is ts.AsExpression | ts.TypeAssertion {
  return ts.isAsExpression(node) || ts.isTypeAssertionExpression(node);
}

// --- Human decision prompts (decision-broker:12) ----------------------------
// A human decision must reach the canonical decision broker, so it is recorded
// and replayed. In src/, a UI prompt call is accepted only inside a broker
// callback, inside a same-file function such a callback calls (one level), or
// in an explicit allowlist entry with its reason.

const HUMAN_DECISION_PROMPTS: ReadonlySet<string> = new Set([
  "chooseFieldPlacement",
  "showCardGridSelectionModal",
  "showChainResponseModal",
  "showConditionalSummonPrompt",
  "showConfirmPrompt",
  "showDestructionNegationPrompt",
  "showFusionMaterialSelection",
  "showFusionTargetModal",
  "showIgnitionActivateModal",
  "showMultiSelectModal",
  "showNumberPrompt",
  "showPositionChoiceModal",
  "showSearchModal",
  "showSearchModalVisual",
  "showShadowHeartCathedralModal",
  "showSickleSelectionModal",
  "showSpecialSummonPositionModal",
  "showSpellChoiceModal",
  "showTargetSelection",
  "showTieBreakerSelection",
  "showTierChoiceModal",
  "showTrapActivationModal",
  "showTriggerOrderModal",
  "showUnifiedTrapModal",
]);

const DECISION_BROKER_ENTRIES: ReadonlySet<string> = new Set([
  "requestDecision",
  "requestOptionalConfirmation",
  "requestResolutionCards",
  "requestResolutionOption",
]);

/** Functions with this name are human resolvers handed to the broker. */
const HUMAN_RESOLVER_NAME = "resolveHuman";

// UI implementations, pre-command interactions (recorded as commands) and
// contracts are outside the guard.
const PROMPT_GUARD_EXCLUDED_PATHS: readonly RegExp[] = [
  /^src\/ui\//,
  /^src\/core\/game\/ui\/interactions\.ts$/,
  /^src\/core\/contracts\//,
  /^src\/core\/UIAdapter\.ts$/,
];

interface PromptAllowlistEntry {
  readonly path: string;
  readonly enclosing: string;
  readonly reason: string;
}

export const HUMAN_PROMPT_ALLOWLIST: readonly PromptAllowlistEntry[] = [
  {
    path: "src/core/game/selection/session.ts",
    enclosing: "startTargetSelectionSession",
    reason: "Presents the selection session, which records its own decision when it finishes.",
  },
  {
    path: "src/core/actionHandlers/resources.ts",
    enclosing: "handleAddFromZoneToHand>selectSingle",
    reason: "Fallback for hosts without selection sessions; a real Game always uses the recorded session.",
  },
  {
    path: "src/core/actionHandlers/resources.ts",
    enclosing: "handleAddFromZoneToHand>selectMulti",
    reason: "Fallback for hosts without selection sessions; a real Game always uses the recorded session.",
  },
  {
    path: "src/core/actionHandlers/resources.ts",
    enclosing: "selectSingleSearchCard",
    reason: "Fallback for hosts without selection sessions; a real Game always uses the recorded session.",
  },
  {
    path: "src/core/effects/actions/equip.ts",
    enclosing: "showSickleSelectionModal",
    reason: "Dead wrapper; removal tracked in decision-broker:9 (backlog).",
  },
  {
    path: "src/core/game/ui/modals.ts",
    enclosing: "showIgnitionActivateModal",
    reason: "Dead wrapper; removal tracked in decision-broker:9 (backlog).",
  },
  {
    path: "src/core/game/ui/modals.ts",
    enclosing: "showShadowHeartCathedralModal",
    reason: "Dead wrapper; removal tracked in decision-broker:9 (backlog).",
  },
];

function stripCallee(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isNonNullExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function calleeName(expression: ts.Expression): string | null {
  const callee = stripCallee(expression);
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) {
    return callee.argumentExpression.text;
  }
  return null;
}

type FunctionNode =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionDeclaration
  | ts.MethodDeclaration;

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node);
}

function functionName(node: FunctionNode): string | null {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
    return node.name.getText();
  }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) return parent.name.getText();
  return null;
}

/** Name of the enclosing function; a callback in an object literal is "outer>property". */
function enclosingFunctionName(node: ts.Node): string {
  for (let current = node.parent; current; current = current.parent) {
    if (!isFunctionNode(current)) continue;
    if (ts.isPropertyAssignment(current.parent) && !ts.isFunctionDeclaration(current)) {
      return `${enclosingFunctionName(current.parent)}>${current.parent.name.getText()}`;
    }
    const name = functionName(current);
    if (name) return name;
  }
  return "<module>";
}

function isBrokerCallback(node: FunctionNode): boolean {
  if (functionName(node) === HUMAN_RESOLVER_NAME) return true;
  const parent = node.parent;
  if (ts.isCallExpression(parent) && parent.arguments.some(argument => argument === node)) {
    const name = calleeName(parent.expression);
    return name !== null && DECISION_BROKER_ENTRIES.has(name);
  }
  return false;
}

function auditHumanPrompts(
  input: TypeScriptSourceInput,
  sourceFile: ts.SourceFile,
  diagnostics: AuditDiagnostic[],
): void {
  if (!input.path.startsWith("src/")) return;
  if (PROMPT_GUARD_EXCLUDED_PATHS.some(pattern => pattern.test(input.path))) return;

  // Functions reached from broker callbacks in this file: called inside one,
  // or handed to a broker entry by reference.
  const brokerReached = new Set<string>([HUMAN_RESOLVER_NAME]);
  const collectReached = (node: ts.Node, insideCallback: boolean): void => {
    const inside = insideCallback || (isFunctionNode(node) && isBrokerCallback(node));
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (inside && name) brokerReached.add(name);
      if (name && DECISION_BROKER_ENTRIES.has(name)) {
        for (const argument of node.arguments) {
          if (ts.isIdentifier(argument)) brokerReached.add(argument.text);
        }
      }
    }
    ts.forEachChild(node, child => collectReached(child, inside));
  };
  collectReached(sourceFile, false);

  const isAccepted = (node: ts.Node): boolean => {
    for (let current = node.parent; current; current = current.parent) {
      if (!isFunctionNode(current)) continue;
      if (isBrokerCallback(current)) return true;
      const name = functionName(current);
      if (name && brokerReached.has(name)) return true;
    }
    return false;
  };

  const allowlist = HUMAN_PROMPT_ALLOWLIST.filter(entry => entry.path === input.path);
  const usedAllowlist = new Set<PromptAllowlistEntry>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && HUMAN_DECISION_PROMPTS.has(name) && !ts.isIdentifier(stripCallee(node.expression)) && !isAccepted(node)) {
        const enclosing = enclosingFunctionName(node);
        const allowed = allowlist.find(entry => entry.enclosing === enclosing);
        if (allowed) {
          usedAllowlist.add(allowed);
        } else {
          diagnostics.push({
            code: "unrecorded-human-prompt",
            path: input.path,
            ...sourceLocation(sourceFile, node.getStart(sourceFile)),
            message: `Human prompt ${name} in ${enclosing} bypasses the decision broker; ` +
              "request it through requestDecision/requestOptionalConfirmation, or allowlist it with a reason.",
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  for (const entry of allowlist) {
    if (usedAllowlist.has(entry)) continue;
    diagnostics.push({
      code: "stale-human-prompt-allowlist",
      path: input.path,
      line: 1,
      column: 1,
      message: `Allowlisted human prompt in ${entry.enclosing} no longer exists; remove the allowlist entry.`,
    });
  }
}

function auditSource(
  input: TypeScriptSourceInput,
  sourceFile: ts.SourceFile,
  comments: SourceComment[],
  diagnostics: AuditDiagnostic[],
): void {
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const location = sourceLocation(sourceFile, node.getStart(sourceFile));
      diagnostics.push({
        code: "prohibited-explicit-any",
        path: input.path,
        ...location,
        message: "Explicit any is prohibited; use a concrete type or narrow unknown.",
      });
    }

    if (
      isTypeAssertion(node) &&
      isTypeAssertion(unwrapParentheses(node.expression))
    ) {
      const location = sourceLocation(sourceFile, node.getStart(sourceFile));
      diagnostics.push({
        code: "prohibited-double-cast",
        path: input.path,
        ...location,
        message:
          "Nested type assertions are prohibited; narrow the value or fix its contract.",
      });
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  for (const comment of comments) {
    const directive = directiveKind(comment);
    if (directive === "ts-ignore" || directive === "ts-nocheck") {
      const location = sourceLocation(sourceFile, comment.start);
      diagnostics.push({
        code: `prohibited-${directive}`,
        message: `@${directive} is prohibited.`,
        path: input.path,
        ...location,
      });
      continue;
    }
    if (directive !== "ts-expect-error") continue;

    const isContractTest = input.path.startsWith("test/types/");
    if (isContractTest && hasContractNegativeJustification(comments, comment)) {
      continue;
    }

    const location = sourceLocation(sourceFile, comment.start);
    diagnostics.push({
      code: "prohibited-ts-expect-error",
      path: input.path,
      ...location,
      message:
        "@ts-expect-error requires an immediately preceding contract-negative justification under test/types/.",
    });
  }
}

export function auditTypeScriptSources(
  sources: TypeScriptSourceInput[],
): TypeScriptEscapeAuditResult {
  const diagnostics: AuditDiagnostic[] = [];

  for (const rawInput of sources) {
    const input = { ...rawInput, path: normalizePath(rawInput.path) };
    const sourceFile = ts.createSourceFile(
      input.path,
      input.text,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(input.path),
    );
    auditSource(input, sourceFile, collectComments(sourceFile, input.text), diagnostics);
    auditHumanPrompts(input, sourceFile, diagnostics);
  }

  diagnostics.sort((left, right) => {
    const pathOrder = left.path.localeCompare(right.path, "en");
    if (pathOrder !== 0) return pathOrder;
    const lineOrder = left.line - right.line;
    if (lineOrder !== 0) return lineOrder;
    const columnOrder = left.column - right.column;
    if (columnOrder !== 0) return columnOrder;
    return left.code.localeCompare(right.code, "en");
  });

  return {
    diagnostics,
    scannedFiles: sources.length,
  };
}

async function collectDirectoryFiles(
  rootDirectory: string,
  directory: string,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (isRecord(error) && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        files.push(
          ...(await collectDirectoryFiles(rootDirectory, absolutePath)),
        );
      }
    } else if (entry.isFile() && TYPESCRIPT_FILE_PATTERN.test(entry.name)) {
      files.push(normalizePath(path.relative(rootDirectory, absolutePath)));
    }
  }
  return files;
}

export async function collectAuthoredTypeScriptFiles(
  rootDirectory: string,
): Promise<string[]> {
  const files: string[] = [];
  for (const directory of AUDITED_DIRECTORIES) {
    files.push(
      ...(await collectDirectoryFiles(
        rootDirectory,
        path.join(rootDirectory, directory),
      )),
    );
  }

  const rootEntries = await readdir(rootDirectory, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.isFile() && TYPESCRIPT_FILE_PATTERN.test(entry.name)) {
      files.push(entry.name);
    }
  }

  return [...new Set(files)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

export async function runTypeScriptEscapeAudit(
  rootDirectory = process.cwd(),
): Promise<TypeScriptEscapeAuditResult> {
  const filePaths = await collectAuthoredTypeScriptFiles(rootDirectory);
  const sources = await Promise.all(
    filePaths.map(async (filePath) => ({
      path: filePath,
      text: await readFile(path.join(rootDirectory, filePath), "utf8"),
    })),
  );
  return auditTypeScriptSources(sources);
}

function formatDiagnostic(diagnostic: AuditDiagnostic): string {
  return `${diagnostic.path}:${diagnostic.line}:${diagnostic.column}: [${diagnostic.code}] ${diagnostic.message}`;
}

function isDirectExecution(
  metaUrl: string,
  argumentPath: string | undefined,
): boolean {
  return (
    argumentPath !== undefined &&
    pathToFileURL(path.resolve(argumentPath)).href === metaUrl
  );
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  try {
    const result = await runTypeScriptEscapeAudit();
    if (result.diagnostics.length === 0) {
      console.log(
        `[typescript-escapes] OK: ${result.scannedFiles} TypeScript files audited.`,
      );
    } else {
      for (const diagnostic of result.diagnostics) {
        console.error(`[typescript-escapes] ${formatDiagnostic(diagnostic)}`);
      }
      console.error(
        `[typescript-escapes] FAILED: ${result.diagnostics.length} issue(s) found.`,
      );
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    const detail =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`[typescript-escapes] FAILED: ${detail}`);
    process.exitCode = 1;
  }
}
