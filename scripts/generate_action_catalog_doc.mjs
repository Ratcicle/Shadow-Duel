import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTION_CATALOG,
  ACTION_CATEGORIES,
} from "../src/core/actionHandlers/actionCatalog.js";

const CATEGORY_LABELS = {
  resources: "Recursos",
  movement: "Movimento",
  summon: "Invocacao",
  destruction: "Destruicao",
  stats: "Stats e status",
  combat: "Combate",
  counters: "Counters",
  conditional: "Condicional",
  blueprint: "Blueprint",
  legacyProxy: "Legacy proxy",
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const outputPath = join(repoRoot, "docs", "Catalogo de actions.md");
const checkOnly = process.argv.slice(2).includes("--check");

function escapeCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", "<br>");
}

function describeField(field = {}) {
  const parts = [];
  if (field.enum) parts.push(`enum: ${field.enum.join(", ")}`);
  else if (field.type) parts.push(field.type);
  else parts.push("any");

  if (field.values) parts.push(`valores: ${field.values.join(", ")}`);
  if (field.min !== undefined) parts.push(`min: ${field.min}`);
  if (field.default !== undefined) parts.push(`default: ${field.default}`);
  return parts.join("; ");
}

function formatList(values) {
  return values?.length ? values.join(", ") : "nenhum";
}

function formatExamples(examples = []) {
  if (examples.length === 0) return "_Sem exemplo cadastrado._";
  return examples
    .map((example) => `\`\`\`json\n${JSON.stringify(example, null, 2)}\n\`\`\``)
    .join("\n");
}

function formatEntry(type, entry) {
  const fieldNames = [...new Set([...(entry.required || []), ...(entry.optional || [])])];
  const fieldTable =
    fieldNames.length === 0
      ? "_Sem campos alem de `type`._"
      : [
          "| Campo | Obrigatorio | Contrato | Descricao |",
          "| --- | --- | --- | --- |",
          ...fieldNames.map((fieldName) => {
            const field = entry.fields?.[fieldName] || {};
            return `| \`${escapeCell(fieldName)}\` | ${
              entry.required?.includes(fieldName) ? "sim" : "nao"
            } | ${escapeCell(describeField(field))} | ${escapeCell(field.description || "")} |`;
          }),
        ].join("\n");

  const notes =
    entry.notes?.length > 0
      ? entry.notes.map((note) => `- ${note}`).join("\n")
      : "_Sem notas._";

  return [
    `### \`${type}\``,
    "",
    entry.summary,
    "",
    `- Handler: \`${entry.handler}\``,
    `- Target: \`${entry.targetRef}\``,
    `- Selecao: \`${entry.selection}\``,
    `- Mutacoes: ${formatList(entry.mutates)}`,
    `- Eventos emitidos: ${formatList(entry.emits)}`,
    `- Atualiza board: ${entry.updatesBoard ? "sim" : "nao"}`,
    `- Preview: \`${entry.preview}\``,
    "",
    fieldTable,
    "",
    "**Exemplos**",
    "",
    formatExamples(entry.examples),
    "",
    "**Notas**",
    "",
    notes,
  ].join("\n");
}

function buildMarkdown() {
  const entriesByCategory = new Map();
  for (const category of ACTION_CATEGORIES) entriesByCategory.set(category, []);

  for (const [type, entry] of Object.entries(ACTION_CATALOG).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (!entriesByCategory.has(entry.category)) entriesByCategory.set(entry.category, []);
    entriesByCategory.get(entry.category).push([type, entry]);
  }

  const lines = [
    "# Catalogo de actions",
    "",
    "> Gerado por `npm run generate:actions`. Atualize `src/core/actionHandlers/actionCatalog.ts` e `ACTION_BINDINGS`, regenere este arquivo e valide com `npm run check:actions-doc`.",
    "",
    "Este catalogo descreve o contrato declarativo de cada `action.type` registrado no Shadow Duel. O runtime vem de `src/core/actionHandlers/actionBindings.ts`, aplicado por `wiring.ts`; este documento serve para criar cartas, revisar handlers e validar o banco de cartas.",
    "",
    `Total de actions catalogadas: ${Object.keys(ACTION_CATALOG).length}.`,
    "",
  ];

  for (const category of ACTION_CATEGORIES) {
    const entries = entriesByCategory.get(category) || [];
    if (entries.length === 0) continue;
    lines.push(`## ${CATEGORY_LABELS[category] || category}`);
    lines.push("");
    for (const [type, entry] of entries) {
      lines.push(formatEntry(type, entry));
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function normalizeLineEndings(value) {
  return value.replaceAll("\r\n", "\n");
}

const generatedMarkdown = buildMarkdown();

if (checkOnly) {
  let currentMarkdown = "";
  try {
    currentMarkdown = await readFile(outputPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  if (
    normalizeLineEndings(currentMarkdown) !==
    normalizeLineEndings(generatedMarkdown)
  ) {
    console.error(
      "Action catalog documentation is out of date. Run `npm run generate:actions`.",
    );
    process.exitCode = 1;
  } else {
    console.log(`Action catalog documentation is up to date: ${outputPath}`);
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generatedMarkdown, "utf8");
  console.log(`Generated ${outputPath}`);
}
