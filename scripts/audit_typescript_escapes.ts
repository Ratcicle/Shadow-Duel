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
