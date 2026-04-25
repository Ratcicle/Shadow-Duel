import { mkdir, writeFile } from "node:fs/promises";
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
    a.localeCompare(b),
  )) {
    if (!entriesByCategory.has(entry.category)) entriesByCategory.set(entry.category, []);
    entriesByCategory.get(entry.category).push([type, entry]);
  }

  const lines = [
    "# Catalogo de actions",
    "",
    "> Gerado por `node scripts/generate_action_catalog_doc.mjs`. Atualize `src/core/actionHandlers/actionCatalog.js` e regenere este arquivo.",
    "",
    "Este catalogo descreve o contrato declarativo de cada `action.type` registrado no Shadow Duel. O runtime continua vindo de `src/core/actionHandlers/wiring.js`; este documento serve para criar cartas, revisar handlers e validar o banco de cartas.",
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

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, buildMarkdown(), "utf8");
console.log(`Generated ${outputPath}`);
