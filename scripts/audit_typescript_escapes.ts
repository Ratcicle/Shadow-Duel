import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const DEBT_REGISTRY_FORMAT = "shadow-duel-typescript-debt-registry";
const DEBT_REGISTRY_VERSION = 1;
const DEBT_REGISTRY_MARKER = "typescript-debt-registry";
const DEBT_ID_PATTERN = /^TSDEBT-\d{3,}$/;
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

export const TYPESCRIPT_DEBT_KINDS = [
  "explicit-any",
  "double-cast",
  "ts-expect-error",
] as const;

export type TypeScriptDebtKind = (typeof TYPESCRIPT_DEBT_KINDS)[number];

export interface TypeScriptDebtEntry {
  id: string;
  path: string;
  kind: TypeScriptDebtKind;
  justification: string;
  removalStage: string;
}

export interface TypeScriptDebtRegistry {
  format: typeof DEBT_REGISTRY_FORMAT;
  version: typeof DEBT_REGISTRY_VERSION;
  entries: TypeScriptDebtEntry[];
}

export interface TypeScriptSourceInput {
  path: string;
  text: string;
}

export interface AuditDiagnostic {
  code: string;
  message: string;
  path?: string;
  line?: number;
  column?: number;
  debtId?: string;
}

export interface DebtRegistryParseResult {
  registry: TypeScriptDebtRegistry;
  diagnostics: AuditDiagnostic[];
}

export interface TypeScriptEscapeAuditResult {
  diagnostics: AuditDiagnostic[];
  scannedFiles: number;
  registeredDebts: number;
}

interface SourceComment {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  text: string;
}

interface DebtMarker {
  id: string | undefined;
  comment: SourceComment;
}

interface EscapeCandidate {
  kind: TypeScriptDebtKind;
  path: string;
  line: number;
  column: number;
  message: string;
}

function emptyRegistry(): TypeScriptDebtRegistry {
  return {
    format: DEBT_REGISTRY_FORMAT,
    version: DEBT_REGISTRY_VERSION,
    entries: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDebtKind(value: unknown): value is TypeScriptDebtKind {
  return (
    typeof value === "string" &&
    TYPESCRIPT_DEBT_KINDS.some((kind) => kind === value)
  );
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function isAuditedDebtPath(filePath: string): boolean {
  if (
    filePath.length === 0 ||
    filePath.startsWith("/") ||
    filePath.startsWith("./") ||
    filePath.includes("\\") ||
    /^[A-Za-z]:/.test(filePath)
  ) {
    return false;
  }

  const segments = filePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "..")) {
    return false;
  }
  if (!TYPESCRIPT_FILE_PATTERN.test(filePath)) {
    return false;
  }

  return (
    segments.length === 1 ||
    AUDITED_DIRECTORIES.some((directory) => segments[0] === directory)
  );
}

function registryDiagnostic(
  code: string,
  message: string,
  debtId?: string,
): AuditDiagnostic {
  return {
    code,
    message,
    path: "docs/migrations/typescript-debt.md",
    debtId,
  };
}

export function validateDebtRegistry(
  value: unknown,
): DebtRegistryParseResult {
  const diagnostics: AuditDiagnostic[] = [];
  const registry = emptyRegistry();

  if (!isRecord(value)) {
    diagnostics.push(
      registryDiagnostic(
        "invalid-debt-registry",
        "The embedded debt registry must be a JSON object.",
      ),
    );
    return { registry, diagnostics };
  }

  if (value.format !== DEBT_REGISTRY_FORMAT) {
    diagnostics.push(
      registryDiagnostic(
        "invalid-debt-registry-format",
        `Registry format must be "${DEBT_REGISTRY_FORMAT}".`,
      ),
    );
  }
  if (value.version !== DEBT_REGISTRY_VERSION) {
    diagnostics.push(
      registryDiagnostic(
        "invalid-debt-registry-version",
        `Registry version must be ${DEBT_REGISTRY_VERSION}.`,
      ),
    );
  }
  if (!Array.isArray(value.entries)) {
    diagnostics.push(
      registryDiagnostic(
        "invalid-debt-registry-entries",
        "Registry entries must be an array.",
      ),
    );
    return { registry, diagnostics };
  }

  const seenIds = new Set<string>();
  value.entries.forEach((rawEntry, index) => {
    if (!isRecord(rawEntry)) {
      diagnostics.push(
        registryDiagnostic(
          "invalid-debt-entry",
          `Debt entry at index ${index} must be a JSON object.`,
        ),
      );
      return;
    }

    const id = rawEntry.id;
    const filePath = rawEntry.path;
    const kind = rawEntry.kind;
    const justification = rawEntry.justification;
    const removalStage = rawEntry.removalStage;
    let valid = true;

    if (typeof id !== "string" || !DEBT_ID_PATTERN.test(id)) {
      diagnostics.push(
        registryDiagnostic(
          "invalid-debt-id",
          `Debt entry at index ${index} must use an ID like TSDEBT-001.`,
          typeof id === "string" ? id : undefined,
        ),
      );
      valid = false;
    } else if (seenIds.has(id)) {
      diagnostics.push(
        registryDiagnostic(
          "duplicate-debt-id",
          `Debt ID ${id} is declared more than once.`,
          id,
        ),
      );
      valid = false;
    } else {
      seenIds.add(id);
    }

    if (typeof filePath !== "string" || !isAuditedDebtPath(filePath)) {
      diagnostics.push(
        registryDiagnostic(
          "invalid-debt-path",
          `Debt ${typeof id === "string" ? id : `at index ${index}`} must reference a repository-relative audited TypeScript path.`,
          typeof id === "string" ? id : undefined,
        ),
      );
      valid = false;
    }
    if (!isDebtKind(kind)) {
      diagnostics.push(
        registryDiagnostic(
          "invalid-debt-kind",
          `Debt ${typeof id === "string" ? id : `at index ${index}`} has an unsupported kind.`,
          typeof id === "string" ? id : undefined,
        ),
      );
      valid = false;
    }
    if (typeof justification !== "string" || justification.trim() === "") {
      diagnostics.push(
        registryDiagnostic(
          "invalid-debt-justification",
          `Debt ${typeof id === "string" ? id : `at index ${index}`} requires a non-empty justification.`,
          typeof id === "string" ? id : undefined,
        ),
      );
      valid = false;
    }
    if (typeof removalStage !== "string" || removalStage.trim() === "") {
      diagnostics.push(
        registryDiagnostic(
          "invalid-debt-removal-stage",
          `Debt ${typeof id === "string" ? id : `at index ${index}`} requires a non-empty removalStage.`,
          typeof id === "string" ? id : undefined,
        ),
      );
      valid = false;
    }

    if (
      valid &&
      typeof id === "string" &&
      typeof filePath === "string" &&
      isDebtKind(kind) &&
      typeof justification === "string" &&
      typeof removalStage === "string"
    ) {
      registry.entries.push({
        id,
        path: filePath,
        kind,
        justification,
        removalStage,
      });
    }
  });

  return { registry, diagnostics };
}

export function parseDebtRegistryMarkdown(
  markdown: string,
): DebtRegistryParseResult {
  const markerPattern = new RegExp(
    `<!--\\s*${DEBT_REGISTRY_MARKER}\\s*-->\\s*\`\`\`json\\s*([\\s\\S]*?)\\s*\`\`\``,
    "i",
  );
  const match = markerPattern.exec(markdown);
  if (match === null || match[1] === undefined) {
    return {
      registry: emptyRegistry(),
      diagnostics: [
        registryDiagnostic(
          "missing-debt-registry",
          `Expected one JSON fence after <!-- ${DEBT_REGISTRY_MARKER} -->.`,
        ),
      ],
    };
  }

  try {
    return validateDebtRegistry(JSON.parse(match[1]));
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      registry: emptyRegistry(),
      diagnostics: [
        registryDiagnostic(
          "invalid-debt-registry-json",
          `The embedded debt registry is not valid JSON: ${detail}`,
        ),
      ],
    };
  }
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
        end: range.end,
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

function collectDebtMarkers(comments: SourceComment[]): DebtMarker[] {
  const markers: DebtMarker[] = [];
  for (const comment of comments) {
    const body = commentBody(comment);
    const markerPattern = /typescript-debt\s*:\s*([^\s*]+)?/g;
    for (const match of body.matchAll(markerPattern)) {
      const candidate = match[1];
      markers.push({
        id:
          candidate !== undefined && DEBT_ID_PATTERN.test(candidate)
            ? candidate
            : undefined,
        comment,
      });
    }
  }
  return markers;
}

function hasContractNegativeJustification(
  comments: SourceComment[],
  directive: SourceComment,
): boolean {
  return comments.some((comment) => {
    if (comment.endLine !== directive.startLine - 1) return false;
    const match = /^contract-negative\s*:\s*(.+)$/i.exec(commentBody(comment));
    return match?.[1]?.trim() !== "";
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

function collectEscapeCandidates(
  input: TypeScriptSourceInput,
  sourceFile: ts.SourceFile,
  comments: SourceComment[],
  diagnostics: AuditDiagnostic[],
): EscapeCandidate[] {
  const candidates: EscapeCandidate[] = [];

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const location = sourceLocation(sourceFile, node.getStart(sourceFile));
      candidates.push({
        kind: "explicit-any",
        path: input.path,
        ...location,
        message: "Explicit any is migration debt and must be registered.",
      });
    }

    if (
      isTypeAssertion(node) &&
      isTypeAssertion(unwrapParentheses(node.expression))
    ) {
      const location = sourceLocation(sourceFile, node.getStart(sourceFile));
      candidates.push({
        kind: "double-cast",
        path: input.path,
        ...location,
        message: "Nested type assertions are migration debt and must be registered.",
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
        message: `@${directive} is prohibited and cannot be added to the debt registry.`,
        path: input.path,
        ...location,
      });
      continue;
    }
    if (directive !== "ts-expect-error") continue;

    const isContractTest = input.path.startsWith("test/types/");
    if (
      isContractTest &&
      hasContractNegativeJustification(comments, comment)
    ) {
      continue;
    }

    const location = sourceLocation(sourceFile, comment.start);
    candidates.push({
      kind: "ts-expect-error",
      path: input.path,
      ...location,
      message:
        "@ts-expect-error requires registered migration debt, or an immediately preceding contract-negative justification under test/types/.",
    });
  }

  return candidates;
}

function adjacentMarkers(
  markers: DebtMarker[],
  candidate: EscapeCandidate,
): DebtMarker[] {
  return markers.filter(
    (marker) =>
      marker.comment.endLine === candidate.line ||
      marker.comment.endLine === candidate.line - 1,
  );
}

export function auditTypeScriptSources(
  sources: TypeScriptSourceInput[],
  registry: TypeScriptDebtRegistry,
): TypeScriptEscapeAuditResult {
  const diagnostics: AuditDiagnostic[] = [];
  const entriesById = new Map(
    registry.entries.map((entry) => [entry.id, entry]),
  );
  const usedDebtIds = new Set<string>();
  const associatedMarkers = new Set<DebtMarker>();

  for (const rawInput of sources) {
    const input = { ...rawInput, path: normalizePath(rawInput.path) };
    const sourceFile = ts.createSourceFile(
      input.path,
      input.text,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(input.path),
    );
    const comments = collectComments(sourceFile, input.text);
    const markers = collectDebtMarkers(comments);
    const candidates = collectEscapeCandidates(
      input,
      sourceFile,
      comments,
      diagnostics,
    );

    for (const marker of markers) {
      if (marker.id !== undefined) continue;
      const location = sourceLocation(sourceFile, marker.comment.start);
      diagnostics.push({
        code: "invalid-debt-marker",
        message: "Debt markers must use the form typescript-debt: TSDEBT-001.",
        path: input.path,
        ...location,
      });
    }

    for (const candidate of candidates) {
      const nearby = adjacentMarkers(markers, candidate);
      const validNearby = nearby.filter(
        (marker): marker is DebtMarker & { id: string } =>
          marker.id !== undefined,
      );
      for (const marker of nearby) associatedMarkers.add(marker);

      const exactMatches = validNearby.filter((marker) => {
        const entry = entriesById.get(marker.id);
        return entry?.path === input.path && entry.kind === candidate.kind;
      });

      if (exactMatches.length === 1) {
        usedDebtIds.add(exactMatches[0].id);
        continue;
      }
      if (exactMatches.length > 1) {
        diagnostics.push({
          code: "ambiguous-debt-marker",
          message: `Multiple debt markers match ${candidate.kind}; keep one adjacent marker per escape.`,
          path: candidate.path,
          line: candidate.line,
          column: candidate.column,
        });
        continue;
      }

      if (validNearby.length === 0) {
        diagnostics.push({
          code: "unregistered-typescript-escape",
          message: candidate.message,
          path: candidate.path,
          line: candidate.line,
          column: candidate.column,
        });
        continue;
      }

      for (const marker of validNearby) {
        const entry = entriesById.get(marker.id);
        if (entry === undefined) continue;
        if (entry.path !== input.path) {
          diagnostics.push({
            code: "debt-path-mismatch",
            message: `Debt ${marker.id} is registered for ${entry.path}, not ${input.path}.`,
            path: candidate.path,
            line: candidate.line,
            column: candidate.column,
            debtId: marker.id,
          });
        } else if (entry.kind !== candidate.kind) {
          diagnostics.push({
            code: "debt-kind-mismatch",
            message: `Debt ${marker.id} is registered as ${entry.kind}, not ${candidate.kind}.`,
            path: candidate.path,
            line: candidate.line,
            column: candidate.column,
            debtId: marker.id,
          });
        }
      }
    }

    for (const marker of markers) {
      if (marker.id === undefined) continue;
      const location = sourceLocation(sourceFile, marker.comment.start);
      if (!entriesById.has(marker.id)) {
        diagnostics.push({
          code: "unknown-debt-marker",
          message: `Debt marker ${marker.id} is not present in the registry.`,
          path: input.path,
          ...location,
          debtId: marker.id,
        });
      } else if (!associatedMarkers.has(marker)) {
        diagnostics.push({
          code: "orphan-debt-marker",
          message: `Debt marker ${marker.id} is not adjacent to a matching TypeScript escape.`,
          path: input.path,
          ...location,
          debtId: marker.id,
        });
      }
    }
  }

  for (const entry of registry.entries) {
    if (!usedDebtIds.has(entry.id)) {
      diagnostics.push(
        registryDiagnostic(
          "stale-debt-entry",
          `Debt ${entry.id} has no matching marker and ${entry.kind} escape at ${entry.path}.`,
          entry.id,
        ),
      );
    }
  }

  diagnostics.sort((left, right) => {
    const pathOrder = (left.path ?? "").localeCompare(right.path ?? "", "en");
    if (pathOrder !== 0) return pathOrder;
    const lineOrder = (left.line ?? 0) - (right.line ?? 0);
    if (lineOrder !== 0) return lineOrder;
    const columnOrder = (left.column ?? 0) - (right.column ?? 0);
    if (columnOrder !== 0) return columnOrder;
    return left.code.localeCompare(right.code, "en");
  });

  return {
    diagnostics,
    scannedFiles: sources.length,
    registeredDebts: registry.entries.length,
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
    if (
      isRecord(error) &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
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
  const debtPath = path.join(
    rootDirectory,
    "docs",
    "migrations",
    "typescript-debt.md",
  );
  const parsedRegistry = parseDebtRegistryMarkdown(
    await readFile(debtPath, "utf8"),
  );
  const filePaths = await collectAuthoredTypeScriptFiles(rootDirectory);
  const sources = await Promise.all(
    filePaths.map(async (filePath) => ({
      path: filePath,
      text: await readFile(path.join(rootDirectory, filePath), "utf8"),
    })),
  );
  const audit = auditTypeScriptSources(sources, parsedRegistry.registry);
  return {
    ...audit,
    diagnostics: [...parsedRegistry.diagnostics, ...audit.diagnostics],
  };
}

function formatDiagnostic(diagnostic: AuditDiagnostic): string {
  const location =
    diagnostic.path === undefined
      ? ""
      : `${diagnostic.path}${diagnostic.line === undefined ? "" : `:${diagnostic.line}:${diagnostic.column ?? 1}`}: `;
  return `${location}[${diagnostic.code}] ${diagnostic.message}`;
}

export function isDirectExecution(
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
        `[typescript-escapes] OK: ${result.scannedFiles} TypeScript files audited; ${result.registeredDebts} registered debts.`,
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
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`[typescript-escapes] FAILED: ${detail}`);
    process.exitCode = 1;
  }
}
