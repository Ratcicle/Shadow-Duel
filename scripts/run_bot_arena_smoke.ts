import fs from "node:fs";
import Bot from "../src/core/Bot.js";
import BotArena from "../src/core/BotArena.js";
import Game from "../src/core/Game.js";
import type {
  ArenaCompletionStats,
  ArenaSearchOptions,
} from "../src/core/contracts/arena.js";

interface SmokeOptions {
  duels: number;
  speed: string;
  matchups: string[];
  plannerMode: string | null;
  plannerTurnMode: string | null;
  plannerBeamWidth: number | null;
  plannerMaxDepth: number | null;
  plannerNodeBudget: number | null;
  plannerCandidateLimit: number | null;
  out: string | null;
  verbose: boolean;
}

type StrategicReport = ReturnType<BotArena["exportStrategicReport"]>;
type StrategicBot = StrategicReport["bots"][string];
type StrategicPlanning = StrategicBot["planning"];

const DEFAULT_MATCHUPS = ["arcanist:shadowheart"];

function ensureLocalStorage() {
  if (globalThis.localStorage) return;
  const storage = new Map<string, string>();
  globalThis.localStorage = {
    get length() {
      return storage.size;
    },
    key(index) {
      return [...storage.keys()][index] ?? null;
    },
    getItem(key) {
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
    clear() {
      storage.clear();
    },
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options: SmokeOptions = {
    duels: 3,
    speed: "instant",
    matchups: DEFAULT_MATCHUPS,
    plannerMode: null,
    plannerTurnMode: null,
    plannerBeamWidth: null,
    plannerMaxDepth: null,
    plannerNodeBudget: null,
    plannerCandidateLimit: null,
    out: null,
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--duels") options.duels = Number(next()) || options.duels;
    else if (arg === "--speed") options.speed = next() || options.speed;
    else if (arg === "--matchup") options.matchups = [next()].filter(Boolean);
    else if (arg === "--matchups") {
      options.matchups = String(next() || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (arg === "--plannerMode") options.plannerMode = next();
    else if (arg === "--plannerTurnMode") options.plannerTurnMode = next();
    else if (arg === "--plannerBeamWidth") {
      options.plannerBeamWidth = Number(next()) || null;
    } else if (arg === "--plannerMaxDepth") {
      options.plannerMaxDepth = Number(next()) || null;
    } else if (arg === "--plannerNodeBudget") {
      options.plannerNodeBudget = Number(next()) || null;
    } else if (arg === "--plannerCandidateLimit") {
      options.plannerCandidateLimit = Number(next()) || null;
    } else if (arg === "--out") options.out = next();
    else if (arg === "--verbose") options.verbose = true;
  }

  options.duels = Math.max(1, Math.floor(options.duels || 1));
  return options;
}

function splitMatchup(matchup: string): [string, string] {
  const [seat1, seat2] = String(matchup || "").split(":");
  if (!seat1 || !seat2) {
    throw new Error(`Invalid matchup "${matchup}". Use "seat1:seat2".`);
  }
  return [seat1, seat2];
}

function plannerOptions(options: SmokeOptions) {
  return {
    plannerMode: options.plannerMode,
    plannerTurnMode: options.plannerTurnMode,
    plannerBeamWidth: options.plannerBeamWidth,
    plannerMaxDepth: options.plannerMaxDepth,
    plannerNodeBudget: options.plannerNodeBudget,
    plannerCandidateLimit: options.plannerCandidateLimit,
  };
}

function compactCompletion(completion: ArenaCompletionStats | null) {
  if (!completion) return null;
  const { analytics: _analytics, ...rest } = completion;
  return rest;
}

function compactStrategicReport(report: StrategicReport | null) {
  if (!report) return null;
  const compactPlanning = (
    planning: StrategicPlanning | null | undefined = null,
  ) => {
    if (!planning) return null;
    const { mismatchSamples: _samples, ...rest } = planning;
    return {
      ...rest,
      mismatchSampleCount: Array.isArray(planning.mismatchSamples)
        ? planning.mismatchSamples.length
        : 0,
    };
  };
  const compactBot = (bot: Partial<StrategicBot> = {}) => ({
    archetype: bot.archetype,
    duels: bot.duels,
    wins: bot.wins,
    winRate: bot.winRate,
    actions: bot.actions,
    monsterSets: bot.monsterSets,
    setMonsters: bot.setMonsters,
    failedActions: bot.failedActions,
    blockedActions: bot.blockedActions,
    noUsefulTurns: bot.noUsefulTurns,
    planning: compactPlanning(bot.planning),
  });
  return {
    generatedAt: report.generatedAt,
    version: report.version,
    duelCount: report.duelCount,
    matchups: report.matchups,
    bots: Object.fromEntries(
      Object.entries(report.bots || {}).map(([key, bot]) => [
        key,
        compactBot(bot),
      ]),
    ),
    suspiciousPatterns: report.suspiciousPatterns,
    duels: (report.duels || []).map((duel) => ({
      duelNumber: duel.duelNumber,
      matchup: duel.matchup,
      winner: duel.winner,
      turns: duel.turns,
      endReason: duel.endReason,
      timeoutKind: duel.timeoutKind,
      failedOrBlocked: duel.failedOrBlocked,
      planning: {
        player: compactPlanning(duel.participants?.player?.planning),
        bot: compactPlanning(duel.participants?.bot?.planning),
      },
      errors: duel.errors || [],
      warnings: duel.warnings || [],
    })),
  };
}

async function runMatchup(matchup: string, options: SmokeOptions) {
  const [seat1, seat2] = splitMatchup(matchup);
  const arena = new BotArena(Game, Bot);
  // BotArena normalizes the raw CLI mode strings against its supported modes.
  arena.setSearchParams(plannerOptions(options) as ArenaSearchOptions);

  let completion: ArenaCompletionStats | null = null;
  await arena.startArena(
    seat1,
    seat2,
    options.duels,
    options.speed,
    false,
    undefined,
    (result) => {
      completion = result;
    },
  );

  const strategicReport = arena.exportStrategicReport();
  return {
    matchup,
    seat1,
    seat2,
    completion: compactCompletion(completion),
    strategicReport: compactStrategicReport(strategicReport),
  };
}

async function main() {
  ensureLocalStorage();
  const options = parseArgs();
  const originalLog = console.log;
  if (!options.verbose) {
    console.log = () => {};
  }

  try {
    const results = [];
    for (const matchup of options.matchups) {
      results.push(await runMatchup(matchup, options));
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      speed: options.speed,
      duelsPerMatchup: options.duels,
      planner: plannerOptions(options),
      results,
    };

    const json = JSON.stringify(payload, null, 2);
    if (options.out) {
      fs.writeFileSync(options.out, `${json}\n`, "utf8");
    }
    originalLog(json);
  } finally {
    console.log = originalLog;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
