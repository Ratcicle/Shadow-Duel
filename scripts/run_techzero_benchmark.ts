import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "node:util";
import "./register_node_asset_loader.js";
import Bot from "../src/core/Bot.js";
import Game from "../src/core/Game.js";
import ShadowHeartStrategy from "../src/core/ai/ShadowHeartStrategy.js";
import { registerStrategy, resolveRegisteredStrategy } from "../src/core/ai/StrategyRegistry.js";
import { evaluateTechZeroVisibleBattle, type TechZeroBattleProjection } from "../src/core/ai/techzero/battle.js";
import type { ArenaDuelResult } from "../src/core/contracts/arena.js";
import type { BotGamePort } from "../src/core/contracts/bot.js";
import type { GameOptions } from "../src/core/contracts/game.js";
import type { GamePlayer } from "../src/core/contracts/player.js";
import type { SummonMethod } from "../src/core/contracts/summon.js";

const { default: BotArena } = await import("../src/core/BotArena.js");
const DEFAULT_OPPONENTS = Bot.getAvailablePresets().map(preset => preset.id);
type Seat = "player" | "bot";
type Variant = "specialized" | "fallback";

export interface BenchmarkCaseOptions {
  opponents: readonly string[];
  duels: number;
  randomSeed: number;
}

export interface BenchmarkOptions extends BenchmarkCaseOptions {
  variant: Variant;
  out: string;
}

export interface BenchmarkCase {
  caseId: string;
  opponent: string;
  duelIndex: number;
  pairIndex: number;
  seed: number;
  seat1: string;
  seat2: string;
  techZeroSeat: "player" | "bot" | "both";
}

function validateCases(options: BenchmarkCaseOptions): void {
  if (!Number.isSafeInteger(options.duels) || options.duels <= 0) {
    throw new RangeError("--duels must be a positive integer.");
  }
  if (!Number.isInteger(options.randomSeed) || options.randomSeed < 0 || options.randomSeed > 0xffffffff) {
    throw new RangeError("--seed must be an integer between 0 and 4294967295.");
  }
  if (!options.opponents.length || new Set(options.opponents).size !== options.opponents.length ||
    options.opponents.some(opponent => !DEFAULT_OPPONENTS.some(preset => preset === opponent))) {
    throw new Error(`--opponents must contain unique presets from: ${DEFAULT_OPPONENTS.join(",")}.`);
  }
}

export function buildCases(options: BenchmarkCaseOptions): BenchmarkCase[] {
  validateCases(options);
  return options.opponents.flatMap(opponent => Array.from({ length: options.duels }, (_, index) => {
    const mirror = opponent === "techzero";
    const pairIndex = mirror ? index : Math.floor(index / 2);
    const reversed = !mirror && index % 2 === 1;
    return {
      caseId: `${opponent}:${index + 1}`,
      opponent,
      duelIndex: index + 1,
      pairIndex,
      seed: (options.randomSeed + pairIndex) >>> 0,
      seat1: reversed ? opponent : "techzero",
      seat2: reversed ? "techzero" : opponent,
      techZeroSeat: mirror ? "both" : reversed ? "bot" : "player",
    };
  }));
}

export function parseBenchmarkArgs(argv: readonly string[] = process.argv.slice(2)): BenchmarkOptions {
  const options: BenchmarkOptions = {
    opponents: DEFAULT_OPPONENTS,
    duels: 30,
    randomSeed: 20260926,
    variant: "specialized",
    out: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    index += 1;
    switch (argument) {
      case "--variant":
        if (value !== "specialized" && value !== "fallback") throw new Error("--variant must be specialized or fallback.");
        options.variant = value;
        break;
      case "--opponents": options.opponents = value.split(",").map(opponent => opponent.trim()); break;
      case "--duels": options.duels = Number(value); break;
      case "--seed": options.randomSeed = value.trim() ? Number(value) : NaN; break;
      case "--out": options.out = value; break;
      default: throw new Error(`Unknown argument: ${argument}.`);
    }
  }
  validateCases(options);
  options.out ||= `techzero-benchmark-${options.variant}.json`;
  return options;
}

interface OpeningSeat {
  hand: Array<number | null>;
  deck: Array<number | null>;
  extraDeck: Array<number | null>;
}

interface OpeningSnapshot {
  firstSeat: Seat;
  random: ReturnType<Game["getRandomState"]>;
  player: OpeningSeat;
  bot: OpeningSeat;
}

interface ObservedSummon {
  seat: Seat;
  turn: number;
  cardId: number;
  method: SummonMethod;
}

export interface BattleObservation extends TechZeroBattleProjection {
  seat: Seat;
  turn: number;
}

function openingSeat(player: GamePlayer): OpeningSeat {
  return {
    hand: player.hand.map(card => card.id ?? null),
    deck: player.deck.map(card => card.id ?? null),
    extraDeck: player.extraDeck.map(card => card.id ?? null),
  };
}

/** Observers belong to this CLI; the game and Bot policies remain unchanged. */
export class BenchmarkGame extends Game {
  static current: BenchmarkGame | null = null;
  opening: OpeningSnapshot | null = null;
  readonly summons: ObservedSummon[] = [];
  readonly mismatchSamples: Array<{ turn: number; phase: string; stage: string; detail: unknown }> = [];
  readonly battles: BattleObservation[] = [];

  constructor(options: GameOptions = {}) {
    super(options);
    BenchmarkGame.current = this;
    this.on("after_summon", ({ card, player, method }) => {
      if (card.id == null || ![503, 509, 515, 516, 517].includes(card.id)) return;
      if (player.id !== "player" && player.id !== "bot") return;
      this.summons.push({ seat: player.id, turn: this.turnCounter, cardId: card.id, method });
    });
  }

  override async start(...args: Parameters<Game["start"]>): Promise<void> {
    const tracker = this._arenaTracker;
    const recordProgress = tracker?.recordProgress;
    if (tracker && recordProgress) {
      tracker.recordProgress = (stage, game, detail) => {
        if (stage === "opening_draw_after") {
          this.opening = { firstSeat: this.turn, random: this.getRandomState(),
            player: openingSeat(this.player), bot: openingSeat(this.bot) };
        }
        if (stage === "ai_plan_execution_failed" || (stage === "ai_plan_execution_compare" &&
          detail !== null && typeof detail === "object" && Reflect.get(detail, "matched") === false)) {
          this.mismatchSamples.push({ turn: this.turnCounter, phase: this.phase, stage, detail });
        }
        recordProgress.call(tracker, stage, game, detail);
      };
    }
    await super.start(...args);
  }

  comboMetrics() {
    return Object.fromEntries((["player", "bot"] as const).map(seat => {
      const summons = this.summons.filter(summon => summon.seat === seat);
      const comboTurns = [...new Set(summons.map(summon => summon.turn))].filter(turn => {
        const turnSummons = summons.filter(summon => summon.turn === turn);
        return turnSummons.some(summon => summon.cardId === 503) &&
          turnSummons.some(summon => summon.cardId === 509) &&
          turnSummons.some(summon => summon.cardId >= 515 && summon.method === "synchro");
      });
      return [seat, {
        summonsById: Object.fromEntries([503, 509, 515, 516, 517].map(id =>
          [id, summons.filter(summon => summon.cardId === id).length])),
        comboTurns,
      }];
    }));
  }
}

class BenchmarkBot extends Bot {
  override playBattlePhase(game: BotGamePort): void {
    if (this.archetype === "techzero" && game instanceof BenchmarkGame &&
      !game.battles.some(battle => battle.seat === this.id && battle.turn === game.turnCounter)) {
      const opponent = this.id === "player" ? game.bot : game.player;
      game.battles.push({ seat: this.id, turn: game.turnCounter,
        ...evaluateTechZeroVisibleBattle(this, opponent, game.turnCounter) });
    }
    super.playBattlePhase(game);
  }
}

export function summarizeBattles(observations: readonly BattleObservation[], completed: ArenaDuelResult | null) {
  const battles = observations.map(battle => ({ ...battle,
    converted: battle.lethal && completed?.type === "completed" && completed.reason === "lp_zero" &&
      completed?.winner === battle.seat && completed.turns === battle.turn,
  }));
  return {
    battles,
    provenLethalOpportunities: battles.filter(battle => battle.lethal).length,
    unconvertedProvenLethals: battles.filter(battle => battle.lethal && !battle.converted).length,
  };
}

async function runCase(scenario: BenchmarkCase) {
  BenchmarkGame.current = null;
  const arena = new BotArena(BenchmarkGame, BenchmarkBot);
  arena.setSearchParams({ randomSeed: scenario.seed, quietLogs: true });
  let result: ArenaDuelResult | null = null;
  try {
    await arena.startArena(scenario.seat1, scenario.seat2, 1, "instant", false,
      progress => { result = progress.lastResult; });
    // The callback is invoked by startArena before its promise resolves.
    const completed = result as ArenaDuelResult | null;
    const game = BenchmarkGame.current as BenchmarkGame | null;
    const record = arena.getAnalytics().duelRecords[0];
    const strategic = arena.exportStrategicReport({ includeDiagnostics: true }).duels[0] ?? null;
    return {
      ...scenario,
      result: completed,
      opening: game?.opening ?? null,
      actualCombos: game?.comboMetrics() ?? null,
      summons: game?.summons ?? [],
      ...summarizeBattles(game?.battles ?? [], completed),
      mismatchSamples: game?.mismatchSamples ?? [],
      metrics: { endReason: record?.endReason ?? "error", finalLP: record?.finalLP ?? null,
        totalTimeMs: record?.totalTimeMs ?? null, totalNodesVisited: record?.totalNodesVisited ?? null,
        avgDecisionTimeMs: record?.avgDecisionTimeMs ?? null },
      strategic,
    };
  } finally {
    const game = BenchmarkGame.current as BenchmarkGame | null;
    game?.dispose("techzero_benchmark_case_complete");
    BenchmarkGame.current = null;
  }
}

export async function runBenchmark(options: BenchmarkOptions) {
  const cases = buildCases(options);
  const originalStrategy = resolveRegisteredStrategy("techzero");
  if (!originalStrategy) throw new Error("Tech-Zero strategy must be registered before benchmarking.");
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const needsStorage = typeof globalThis.localStorage === "undefined";
  if (needsStorage) {
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() { return values.size; },
      key: index => [...values.keys()][index] ?? null,
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, String(value)); },
      removeItem: key => { values.delete(key); },
      clear: () => { values.clear(); },
    };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  }
  const results: Array<Awaited<ReturnType<typeof runCase>> & { consoleErrors: string[]; consoleWarnings: string[] }> = [];
  const startedAt = new Date().toISOString();
  const output = path.resolve(options.out);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const checkpoint = () => {
    const payload = { version: 1, variant: options.variant, startedAt, updatedAt: new Date().toISOString(),
      randomSeed: options.randomSeed, duelsPerOpponent: options.duels, opponents: options.opponents,
      plannedCases: cases.length, completedCases: results.length, complete: results.length === cases.length, results };
    fs.writeFileSync(`${output}.tmp`, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(`${output}.tmp`, output);
    return payload;
  };
  try {
    if (options.variant === "fallback") registerStrategy("techzero", ShadowHeartStrategy);
    console.log = () => {};
    checkpoint();
    for (const scenario of cases) {
      const consoleErrors: string[] = [];
      const consoleWarnings: string[] = [];
      console.error = (...values: unknown[]) => { consoleErrors.push(format(...values)); };
      console.warn = (...values: unknown[]) => { consoleWarnings.push(format(...values)); };
      process.stderr.write(`[${options.variant}] ${results.length + 1}/${cases.length} ${scenario.caseId} ${scenario.seat1}:${scenario.seat2} seed=${scenario.seed}\n`);
      const result = await runCase(scenario);
      results.push({ ...result, consoleErrors, consoleWarnings });
      checkpoint();
      process.stderr.write(`  ${result.metrics.endReason} turns=${result.result?.type === "cancelled" ? "cancelled" : result.result?.turns ?? 0} errors=${consoleErrors.length}\n`);
    }
    return checkpoint();
  } finally {
    registerStrategy("techzero", originalStrategy);
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    if (needsStorage) {
      if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBenchmark(parseBenchmarkArgs()).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
