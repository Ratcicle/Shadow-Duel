import fs from "node:fs";
import Game from "../src/core/Game.js";
import Bot from "../src/core/Bot.js";
import BotArena from "../src/core/BotArena.js";

const DEFAULT_MATCHUPS = ["arcanist:shadowheart"];

function ensureLocalStorage() {
  if (globalThis.localStorage) return;
  const storage = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
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
  const options = {
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

function splitMatchup(matchup) {
  const [seat1, seat2] = String(matchup || "").split(":");
  if (!seat1 || !seat2) {
    throw new Error(`Invalid matchup "${matchup}". Use "seat1:seat2".`);
  }
  return [seat1, seat2];
}

function plannerOptions(options) {
  return {
    plannerMode: options.plannerMode,
    plannerTurnMode: options.plannerTurnMode,
    plannerBeamWidth: options.plannerBeamWidth,
    plannerMaxDepth: options.plannerMaxDepth,
    plannerNodeBudget: options.plannerNodeBudget,
    plannerCandidateLimit: options.plannerCandidateLimit,
  };
}

function compactCompletion(completion) {
  if (!completion) return null;
  const { analytics: _analytics, ...rest } = completion;
  return rest;
}

function compactStrategicReport(report) {
  if (!report) return null;
  const compactPlanning = (planning = null) => {
    if (!planning) return null;
    const { mismatchSamples: _samples, ...rest } = planning;
    return {
      ...rest,
      mismatchSampleCount: Array.isArray(planning.mismatchSamples)
        ? planning.mismatchSamples.length
        : 0,
    };
  };
  const compactBot = (bot = {}) => ({
    archetype: bot.archetype,
    duels: bot.duels,
    wins: bot.wins,
    winRate: bot.winRate,
    actions: bot.actions,
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

async function runMatchup(matchup, options) {
  const [seat1, seat2] = splitMatchup(matchup);
  const arena = new BotArena(Game, Bot);
  arena.setSearchParams(plannerOptions(options));

  let completion = null;
  await arena.startArena(
    seat1,
    seat2,
    options.duels,
    options.speed,
    false,
    null,
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
