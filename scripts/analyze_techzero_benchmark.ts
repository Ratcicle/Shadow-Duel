import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

type Seat = "player" | "bot";
type Variant = "specialized" | "fallback";
type Counter = Record<string, number>;
type JsonObject = Record<string, unknown>;

interface ParsedCase {
  raw: JsonObject;
  caseId: string;
  opponent: string;
  seed: number;
  duelIndex: number;
  pairIndex: number;
  seat1: string;
  seat2: string;
  techZeroSeat: Seat | "both";
  opening: JsonObject;
  winner: Seat | "draw";
  endReason: string;
}

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonObject;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a nonempty string.`);
  return value;
}
function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite nonnegative number.`);
  return value;
}
function integer(value: unknown, label: string): number {
  const result = number(value, label);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} must be an integer.`);
  return result;
}
function nullableNumber(value: unknown, label: string): number | null {
  return value === null ? null : number(value, label);
}
function counter(): Counter { return Object.create(null) as Counter; }
function increment(counts: Counter, key: string, amount = 1): void { counts[key] = (counts[key] ?? 0) + amount; }
function addCounter(target: Counter, value: unknown, label: string): void {
  for (const entry of array(value, label)) {
    const item = object(entry, label);
    increment(target, string(item.name, `${label}.name`), integer(item.count, `${label}.count`));
  }
}
function seat(value: unknown, label: string): Seat {
  if (value !== "player" && value !== "bot") throw new Error(`${label} must be player or bot.`);
  return value;
}
function validateOpening(value: unknown, label: string): JsonObject {
  const opening = object(value, label);
  seat(opening.firstSeat, `${label}.firstSeat`);
  const random = object(opening.random, `${label}.random`);
  for (const key of ["seed", "state", "calls"]) integer(random[key], `${label}.random.${key}`);
  for (const owner of ["player", "bot"]) {
    const participant = object(opening[owner], `${label}.${owner}`);
    for (const zone of ["hand", "deck", "extraDeck"]) {
      for (const id of array(participant[zone], `${label}.${owner}.${zone}`)) {
        if (id !== null) integer(id, `${label}.${owner}.${zone}.id`);
      }
    }
  }
  return opening;
}
function parseCase(value: unknown): ParsedCase {
  const raw = object(value, "case");
  const caseId = string(raw.caseId, "case.caseId");
  const role = raw.techZeroSeat === "both" ? "both" : seat(raw.techZeroSeat, `${caseId}.techZeroSeat`);
  const result = object(raw.result, `${caseId}.result`);
  const metrics = object(raw.metrics, `${caseId}.metrics`);
  const winner = result.winner === "draw" ? "draw" : seat(result.winner, `${caseId}.winner`);
  return { raw, caseId, opponent: string(raw.opponent, `${caseId}.opponent`),
    seed: integer(raw.seed, `${caseId}.seed`), duelIndex: integer(raw.duelIndex, `${caseId}.duelIndex`),
    pairIndex: integer(raw.pairIndex, `${caseId}.pairIndex`), seat1: string(raw.seat1, `${caseId}.seat1`),
    seat2: string(raw.seat2, `${caseId}.seat2`), techZeroSeat: role,
    opening: validateOpening(raw.opening, `${caseId}.opening`), winner,
    endReason: string(metrics.endReason, `${caseId}.metrics.endReason`) };
}
function parseReport(value: unknown, variant: Variant) {
  const raw = object(value, variant);
  if (raw.version !== 1 || raw.variant !== variant || raw.complete !== true) {
    throw new Error(`${variant} must be a complete version 1 ${variant} report.`);
  }
  const cases = array(raw.results, `${variant}.results`).map(parseCase);
  const planned = integer(raw.plannedCases, `${variant}.plannedCases`);
  if (!planned || planned !== cases.length || raw.completedCases !== planned) throw new Error(`${variant} has missing cases.`);
  if (new Set(cases.map(entry => entry.caseId)).size !== cases.length) throw new Error(`${variant} has duplicate case IDs.`);
  const opponents = array(raw.opponents, `${variant}.opponents`).map(entry => string(entry, "opponent"));
  const duelsPerOpponent = integer(raw.duelsPerOpponent, `${variant}.duelsPerOpponent`);
  if (!duelsPerOpponent || new Set(opponents).size !== opponents.length || planned !== duelsPerOpponent * opponents.length ||
    opponents.some(opponent => cases.filter(entry => entry.opponent === opponent).length !== duelsPerOpponent)) {
    throw new Error(`${variant} opponent counts do not match the configured sample.`);
  }
  return { cases, opponents, duelsPerOpponent, randomSeed: integer(raw.randomSeed, `${variant}.randomSeed`) };
}

function parseReports(value: unknown, variant: Variant) {
  const batches = (Array.isArray(value) ? value : [value]).map(entry => parseReport(entry, variant));
  const first = batches[0];
  if (!first) throw new Error(`${variant} requires at least one report.`);
  if (batches.some(batch => batch.randomSeed !== first.randomSeed || batch.duelsPerOpponent !== first.duelsPerOpponent)) {
    throw new Error(`${variant} batch configuration differs.`);
  }
  const opponents = batches.flatMap(batch => batch.opponents);
  const cases = batches.flatMap(batch => batch.cases);
  if (new Set(opponents).size !== opponents.length || new Set(cases.map(entry => entry.caseId)).size !== cases.length) {
    throw new Error(`${variant} batches overlap or contain duplicate cases.`);
  }
  return { ...first, opponents, cases };
}

function newSeatSummary() {
  return { games: 0, normalGames: 0, wins: 0, losses: 0, draws: 0, maxTurns: 0, timeout: 0,
    normalWinRatePercent: null as number | null };
}
function newSummary(isMirror: boolean) {
  return {
    duels: 0, isMirror, normalWinRatePercent: null as number | null,
    outcomes: { lpZero: { games: 0, wins: isMirror ? null : 0, losses: isMirror ? null : 0, draws: 0,
      winsBySeat: { player: 0, bot: 0 } }, draws: 0, maxTurns: 0, timeout: 0, error: 0, cancelled: 0, other: counter() },
    seats: { player: newSeatSummary(), bot: newSeatSummary() },
    decisions: { count: 0, totalMs: 0, meanMs: null as number | null },
    search: { turnLineNodesAllSeats: 0, measuredDuels: 0, unsupportedBranches: 0, repeatedStates: 0, terminationReasons: counter() },
    runtime: { totalMs: 0, measuredDuels: 0, meanMs: null as number | null },
    combos: { duelsWithCombo: 0, turnsWithCombo: 0, summonsById: counter() },
    lethal: { proven: 0, unconverted: 0 },
    execution: { failedActions: 0, blockedActions: 0, failedActionsAllSeats: 0, blockedActionsAllSeats: 0,
      planningFailedExecutions: 0, invalidByCard: counter(), blockedByCard: counter() },
    mismatches: { executionMismatches: 0, samples: 0, samplesAllSeats: 0, byReason: counter(), byStage: counter(), byDiffPath: counter(), byDiffSeverity: counter() },
    errors: { duelsWithErrors: 0, consoleMessages: 0, strategicMessages: 0, consoleByMessage: counter(), strategicByMessage: counter() },
    warnings: { consoleMessages: 0, strategicMessages: 0, consoleByMessage: counter(), strategicByMessage: counter() },
  };
}
type Summary = ReturnType<typeof newSummary>;
function messageLabel(value: unknown): string {
  return (typeof value === "string" ? value : JSON.stringify(value) ?? String(value)).split(/\r?\n/, 1)[0] ?? "unknown";
}
function recordMessages(value: unknown, counts: Counter, label: string): number {
  const messages = array(value, label);
  for (const message of messages) increment(counts, messageLabel(message));
  return messages.length;
}
function controlledSeats(entry: ParsedCase): Seat[] {
  return entry.techZeroSeat === "both" ? ["player", "bot"] : [entry.techZeroSeat];
}

function addCase(summary: Summary, entry: ParsedCase): void {
  const { raw, winner, endReason } = entry;
  const controlled = controlledSeats(entry);
  summary.duels += 1;
  if (winner === "draw") summary.outcomes.draws += 1;
  switch (endReason) {
    case "lp_zero":
      summary.outcomes.lpZero.games += 1;
      if (winner === "draw") summary.outcomes.lpZero.draws += 1;
      else {
        summary.outcomes.lpZero.winsBySeat[winner] += 1;
        if (!summary.isMirror) {
          if (winner === entry.techZeroSeat) summary.outcomes.lpZero.wins = (summary.outcomes.lpZero.wins ?? 0) + 1;
          else summary.outcomes.lpZero.losses = (summary.outcomes.lpZero.losses ?? 0) + 1;
        }
      }
      break;
    case "max_turns": summary.outcomes.maxTurns += 1; break;
    case "timeout": summary.outcomes.timeout += 1; break;
    case "error": summary.outcomes.error += 1; break;
    case "cancelled": summary.outcomes.cancelled += 1; break;
    default: increment(summary.outcomes.other, endReason);
  }
  for (const owner of controlled) {
    const stats = summary.seats[owner];
    stats.games += 1;
    if (endReason === "lp_zero") {
      stats.normalGames += 1;
      if (winner === owner) stats.wins += 1;
      else if (winner === "draw") stats.draws += 1;
      else stats.losses += 1;
    }
    if (endReason === "max_turns") stats.maxTurns += 1;
    if (endReason === "timeout") stats.timeout += 1;
  }
  const metrics = object(raw.metrics, `${entry.caseId}.metrics`);
  const nodes = nullableNumber(metrics.totalNodesVisited, "totalNodesVisited");
  if (nodes !== null) { summary.search.turnLineNodesAllSeats += nodes; summary.search.measuredDuels += 1; }
  const elapsed = nullableNumber(metrics.totalTimeMs, "totalTimeMs");
  if (elapsed !== null) { summary.runtime.totalMs += elapsed; summary.runtime.measuredDuels += 1; }
  summary.lethal.proven += integer(raw.provenLethalOpportunities, "provenLethalOpportunities");
  summary.lethal.unconverted += integer(raw.unconvertedProvenLethals, "unconvertedProvenLethals");
  if (raw.actualCombos !== null) {
    const combos = object(raw.actualCombos, "actualCombos");
    let hasCombo = false;
    for (const owner of controlled) {
      const seatCombos = object(combos[owner], `actualCombos.${owner}`);
      const turns = array(seatCombos.comboTurns, "comboTurns");
      hasCombo ||= turns.length > 0;
      summary.combos.turnsWithCombo += turns.length;
      for (const [id, count] of Object.entries(object(seatCombos.summonsById, "summonsById"))) {
        increment(summary.combos.summonsById, id, integer(count, `summonsById.${id}`));
      }
    }
    if (hasCombo) summary.combos.duelsWithCombo += 1;
  }
  const strategic = raw.strategic === null ? null : object(raw.strategic, "strategic");
  const participants = strategic ? object(strategic.participants, "participants") : null;
  if (participants) {
    for (const owner of ["player", "bot"] as const) {
      const participant = object(participants[owner], `participants.${owner}`);
      summary.execution.failedActionsAllSeats += integer(participant.failedActions, "failedActions");
      summary.execution.blockedActionsAllSeats += integer(participant.blockedActions, "blockedActions");
      if (!controlled.includes(owner)) continue;
      summary.decisions.count += integer(participant.decisionCount, "decisionCount");
      summary.decisions.totalMs += number(participant.decisionTimeMs, "decisionTimeMs");
      summary.execution.failedActions += integer(participant.failedActions, "failedActions");
      summary.execution.blockedActions += integer(participant.blockedActions, "blockedActions");
      addCounter(summary.execution.invalidByCard, participant.invalidByCard, "invalidByCard");
      addCounter(summary.execution.blockedByCard, participant.blockedByCard, "blockedByCard");
      const planning = object(participant.planning, "planning");
      summary.execution.planningFailedExecutions += integer(planning.failedExecutions, "planning.failedExecutions");
      summary.mismatches.executionMismatches += integer(planning.executionMismatches, "planning.executionMismatches");
      summary.search.unsupportedBranches += integer(planning.unsupportedBranches, "planning.unsupportedBranches");
      summary.search.repeatedStates += integer(planning.repeatedStates, "planning.repeatedStates");
      addCounter(summary.search.terminationReasons, planning.terminationReasons, "planning.terminationReasons");
    }
  }
  for (const value of array(raw.mismatchSamples, "mismatchSamples")) {
    summary.mismatches.samplesAllSeats += 1;
    const sample = object(value, "mismatch");
    const detail = object(sample.detail, "mismatch.detail");
    if (!controlled.includes(seat(detail.actor, "mismatch.actor"))) continue;
    summary.mismatches.samples += 1;
    increment(summary.mismatches.byStage, string(sample.stage, "mismatch.stage"));
    increment(summary.mismatches.byReason, string(detail.mismatchReason ?? detail.diffSeverity ?? "unclassified", "mismatch.reason"));
    for (const value of array(detail.diffs ?? [], "mismatch.diffs")) {
      const diff = object(value, "diff");
      increment(summary.mismatches.byDiffPath, string(diff.path ?? "unspecified", "diff.path"));
      increment(summary.mismatches.byDiffSeverity, string(diff.severity ?? "unspecified", "diff.severity"));
    }
  }
  const consoleErrors = recordMessages(raw.consoleErrors, summary.errors.consoleByMessage, "consoleErrors");
  const strategicErrors = recordMessages(strategic?.errors ?? [], summary.errors.strategicByMessage, "strategic.errors");
  summary.errors.consoleMessages += consoleErrors;
  summary.errors.strategicMessages += strategicErrors;
  if (consoleErrors || strategicErrors || endReason === "error") summary.errors.duelsWithErrors += 1;
  summary.warnings.consoleMessages += recordMessages(raw.consoleWarnings, summary.warnings.consoleByMessage, "consoleWarnings");
  summary.warnings.strategicMessages += recordMessages(strategic?.warnings ?? [], summary.warnings.strategicByMessage, "strategic.warnings");
}

function percentage(wins: number | null, total: number): number | null {
  return wins === null || !total ? null : Math.round(wins * 10000 / total) / 100;
}
function summarize(cases: readonly ParsedCase[], opponent: string): Summary {
  const summary = newSummary(opponent === "techzero");
  for (const entry of cases) if (entry.opponent === opponent) addCase(summary, entry);
  summary.normalWinRatePercent = percentage(summary.outcomes.lpZero.wins, summary.outcomes.lpZero.games);
  for (const owner of ["player", "bot"] as const) {
    const stats = summary.seats[owner];
    stats.normalWinRatePercent = percentage(stats.wins, stats.normalGames);
  }
  if (summary.decisions.count) summary.decisions.meanMs = summary.decisions.totalMs / summary.decisions.count;
  if (summary.runtime.measuredDuels) summary.runtime.meanMs = summary.runtime.totalMs / summary.runtime.measuredDuels;
  return summary;
}

export function analyzeReports(specializedInput: unknown, fallbackInput: unknown) {
  const specialized = parseReports(specializedInput, "specialized");
  const fallback = parseReports(fallbackInput, "fallback");
  if (specialized.randomSeed !== fallback.randomSeed || specialized.duelsPerOpponent !== fallback.duelsPerOpponent ||
    !isDeepStrictEqual([...specialized.opponents].sort(), [...fallback.opponents].sort())) {
    throw new Error("Benchmark configuration differs between variants.");
  }
  const counterparts = new Map(fallback.cases.map(entry => [entry.caseId, entry]));
  const identityFields = ["opponent", "duelIndex", "pairIndex", "seed", "seat1", "seat2", "techZeroSeat"] as const;
  for (const first of specialized.cases) {
    const second = counterparts.get(first.caseId);
    if (!second) throw new Error(`Missing fallback case: ${first.caseId}.`);
    for (const key of identityFields) {
      if (first[key] !== second[key]) throw new Error(`Scenario mismatch: ${first.caseId}.${key}.`);
    }
    if (!isDeepStrictEqual(first.opening, second.opening)) throw new Error(`Opening mismatch: ${first.caseId}.`);
  }
  return { version: 1,
    validation: { pairedCases: specialized.cases.length, identicalSeeds: true, identicalOpenings: true,
      randomSeed: specialized.randomSeed, duelsPerOpponent: specialized.duelsPerOpponent },
    rows: specialized.opponents.map(opponent => {
      const first = summarize(specialized.cases, opponent);
      const second = summarize(fallback.cases, opponent);
      return { opponent, specialized: first, fallback: second,
        normalWinRateDeltaPoints: first.normalWinRatePercent === null || second.normalWinRatePercent === null ? null :
          Math.round((first.normalWinRatePercent - second.normalWinRatePercent) * 100) / 100 };
    }),
  };
}

type Analysis = ReturnType<typeof analyzeReports>;
function cell(value: string | number | null): string { return value === null ? "—" : String(value).replaceAll("|", "\\|").replaceAll("\n", " "); }
function decimal(value: number | null): string { return value === null ? "—" : value.toFixed(2); }
function labels(counts: Counter): string { return Object.entries(counts).filter(([, count]) => count > 0).map(([name, count]) => `${name}: ${count}`).join("; ") || "—"; }

export function renderMarkdown(analysis: Analysis): string {
  const lines = ["# Benchmark Tech-Zero", "",
    `${analysis.validation.pairedCases} cenários correspondentes por variante; seeds, assentos e aberturas idênticos. Seed base: ${analysis.validation.randomSeed}.`, "",
    "## Resultados por oponente", "",
    "Vitórias normais exigem término por LP. Limite de turnos e timeout ficam separados, mesmo quando a Arena atribui vencedor por LP restante. A taxa usa somente partidas terminadas por LP; os denominadores por assento aparecem na tabela. No espelho, P/B/E indica vitórias de player/bot/empates; não há taxa do arquétipo.", "",
    "| Oponente | Variante | n | LP: V/D/E ou P/B/E | Taxa LP | Player: V/n LP | Bot: V/n LP | Empates totais | Limite | Timeout | Erro |",
    "| --- | --- | ---: | --- | ---: | --- | --- | ---: | ---: | ---: | ---: |"];
  for (const row of analysis.rows) for (const variant of ["specialized", "fallback"] as const) {
    const stats = row[variant];
    const lp = stats.outcomes.lpZero;
    lines.push(`| ${cell(row.opponent)} | ${variant} | ${stats.duels} | ${stats.isMirror ? `${lp.winsBySeat.player}/${lp.winsBySeat.bot}/${lp.draws}` : `${lp.wins}/${lp.losses}/${lp.draws}`} | ${decimal(stats.normalWinRatePercent)} | ${stats.seats.player.wins}/${stats.seats.player.normalGames} (${decimal(stats.seats.player.normalWinRatePercent)}%) | ${stats.seats.bot.wins}/${stats.seats.bot.normalGames} (${decimal(stats.seats.bot.normalWinRatePercent)}%) | ${stats.outcomes.draws} | ${stats.outcomes.maxTurns} | ${stats.outcomes.timeout} | ${stats.outcomes.error} |`);
  }
  lines.push("", "## Combos, decisões e custo", "",
    "Combos exigem invocações reais de M, Portal e um boss por Sincro no mesmo turno e assento. Decisões e seus tempos pertencem ao Tech-Zero (ambos no espelho). Nós medem somente TurnLineSearch dos dois assentos; Beam/Greedy não estão instrumentados. A duração inclui os dois bots. Latência média é ponderada pelo número de decisões. Tempos são os observados na execução, sem pressupor CPU isolada. Letal perdido conta uma oportunidade comprovada sem vitória naquele turno; projeções com informação oculta não provam letal.", "",
    "| Oponente | Variante | Duelos com combo | Turnos com combo | M/Portal/515/516/517 | Letal perdido/provado | Decisões | ms/decisão | Nós TurnLineSearch (ambos) | ms/duelo |",
    "| --- | --- | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: |");
  for (const row of analysis.rows) for (const variant of ["specialized", "fallback"] as const) {
    const stats = row[variant];
    lines.push(`| ${cell(row.opponent)} | ${variant} | ${stats.combos.duelsWithCombo} | ${stats.combos.turnsWithCombo} | ${[503, 509, 515, 516, 517].map(id => stats.combos.summonsById[String(id)] ?? 0).join("/")} | ${stats.lethal.unconverted}/${stats.lethal.proven} | ${stats.decisions.count} | ${decimal(stats.decisions.meanMs)} | ${stats.search.turnLineNodesAllSeats} | ${decimal(stats.runtime.meanMs)} |`);
  }
  lines.push("", "## Diagnósticos", "",
    "Falhas, bloqueios e divergências da tabela pertencem ao Tech-Zero; falhas/bloqueios de todos os assentos aparecem entre parênteses. Falhas incluem efeitos que deixam de resolver, como a segunda ficha de Raptor sem vaga; não equivalem automaticamente a uma ação inválida de Main Phase. Falhas de execução planejada podem sobrepor falhas de ação e ficam separadas no JSON. Divergências são classificadas pelo diagnóstico emitido, sem presumir que diferenças de mão/Deck sejam inofensivas. Erros contam duelos afetados, evitando somar ocorrências repetidas em fontes diferentes.", "",
    "| Oponente | Variante | Duelos com erro | Falhas (todos) | Bloqueios (todos) | Divergências | Classificação dos registros completos | Avisos console/estratégicos |",
    "| --- | --- | ---: | --- | --- | ---: | --- | --- |");
  for (const row of analysis.rows) for (const variant of ["specialized", "fallback"] as const) {
    const stats = row[variant];
    lines.push(`| ${cell(row.opponent)} | ${variant} | ${stats.errors.duelsWithErrors} | ${stats.execution.failedActions} (${stats.execution.failedActionsAllSeats}) | ${stats.execution.blockedActions} (${stats.execution.blockedActionsAllSeats}) | ${stats.mismatches.executionMismatches} | ${cell(labels(stats.mismatches.byReason))} | ${stats.warnings.consoleMessages}/${stats.warnings.strategicMessages} |`);
  }
  lines.push("", "A validação compara IDs de definição e ordem das cartas na abertura. Não certifica decisões de uma partida inteira somente pela seed: IDs de instância globais também dependem da ordem completa dos casos.", "",
    "As tabelas descrevem a amostra. Vitórias não substituem a investigação das divergências e os testes de paridade.", "");
  return lines.join("\n");
}

function main(argv = process.argv.slice(2)): void {
  const options = new Map<string, string>();
  const inputFiles: Record<Variant, string[]> = { specialized: [], fallback: [] };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key || !["--specialized", "--fallback", "--json", "--markdown"].includes(key) || !value || value.startsWith("--")) {
      throw new Error("Use --specialized FILE --fallback FILE [--json FILE] [--markdown FILE].");
    }
    if (key === "--specialized" || key === "--fallback") {
      inputFiles[key === "--specialized" ? "specialized" : "fallback"].push(value);
      continue;
    }
    if (options.has(key)) throw new Error(`Duplicate option: ${key}.`);
    options.set(key, value);
  }
  if (!inputFiles.specialized.length || !inputFiles.fallback.length) throw new Error("Both --specialized and --fallback are required.");
  const read = (files: readonly string[]): unknown[] => files.map((file): unknown => JSON.parse(fs.readFileSync(file, "utf8")));
  const analysis = analyzeReports(read(inputFiles.specialized), read(inputFiles.fallback));
  const outputs: Array<[string, string]> = [];
  const json = options.get("--json");
  const markdown = options.get("--markdown");
  if (json) outputs.push([json, `${JSON.stringify(analysis, null, 2)}\n`]);
  if (markdown) outputs.push([markdown, renderMarkdown(analysis)]);
  const inputs = new Set([...inputFiles.specialized, ...inputFiles.fallback].map(file => path.resolve(file).toLowerCase()));
  const destinations = new Set<string>();
  for (const [file] of outputs) {
    const resolved = path.resolve(file).toLowerCase();
    if (inputs.has(resolved) || destinations.has(resolved)) throw new Error("Output files must differ from both inputs and from each other.");
    destinations.add(resolved);
  }
  for (const [file, contents] of outputs) {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, contents, "utf8");
  }
  if (!outputs.length) process.stdout.write(renderMarkdown(analysis));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error: unknown) { console.error(error); process.exitCode = 1; }
}
