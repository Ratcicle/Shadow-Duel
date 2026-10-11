import fs from "node:fs";
import Bot from "../src/core/Bot.js";
import BotArena from "../src/core/BotArena.js";
import Game from "../src/core/Game.js";
import { replayCanonicalDuel } from "../src/core/game/replay/driver.js";
import type { ReplayDriverGamePort } from "../src/core/contracts/replay.js";
import type {
  ArenaCompletionStats,
  ArenaDuelResult,
  ArenaSearchOptions,
} from "../src/core/contracts/arena.js";

interface SmokeOptions {
  randomSeed: number | null;
  duels: number;
  speed: string;
  matchups: string[];
  plannerMode: string | null | undefined;
  plannerTurnMode: string | null | undefined;
  plannerBeamWidth: number | null;
  plannerMaxDepth: number | null;
  plannerNodeBudget: number | null;
  plannerCandidateLimit: number | null;
  out: string | null | undefined;
  verbose: boolean;
  checkReplays: boolean;
}

interface ReplayCheckResult {
  duelNumber: number;
  ok: boolean;
  commands: number;
  decisions: string;
  message: string | null;
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
    randomSeed: null,
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
    checkReplays: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--seed") {
      const raw = next();
      const seed = raw?.trim() ? Number(raw) : NaN;
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
        throw new RangeError("--seed must be an integer between 0 and 4294967295.");
      }
      options.randomSeed = seed;
    } else if (arg === "--duels") options.duels = Number(next()) || options.duels;
    else if (arg === "--speed") options.speed = next() || options.speed;
    else if (arg === "--matchup")
      options.matchups = [next()].filter((value): value is string =>
        Boolean(value),
      );
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
    else if (arg === "--check-replays") options.checkReplays = true;
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
    decisionCount: bot.decisionCount,
    decisionTimeMs: bot.decisionTimeMs,
    avgDecisionTimeMs: bot.avgDecisionTimeMs,
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
      seed: duel.seed,
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

// --check-replays: every Arena duel records a canonical replay, which then
// plays back in a fresh Game with the same controllers (a bot in each seat).
// A divergence means some live path is not captured as a command or decision.
function createReplayCapturingGame(captured: Game[]) {
  return class ReplayCapturingGame extends Game {
    constructor(gameOptions: ConstructorParameters<typeof Game>[0] = {}) {
      // The turn limit is not part of the canonical setup, so capture refuses it;
      // these duels end by LP or by the Arena timeout.
      const captureOptions = { ...gameOptions, captureReplay: true };
      delete captureOptions.maxTurnCounter;
      super(captureOptions);
      captured.push(this);
    }
  };
}

async function checkArenaReplays(games: readonly Game[], seat1: string, seat2: string) {
  const results: ReplayCheckResult[] = [];
  for (const [index, game] of games.entries()) {
    const duelNumber = index + 1;
    const exported = game.exportReplay({ download: false });
    if (!exported) {
      results.push({ duelNumber, ok: false, commands: 0, decisions: "0/0", message: "no replay recorded" });
      continue;
    }
    const replay: unknown = JSON.parse(JSON.stringify(exported));
    const first = new Bot(seat1);
    const second = new Bot(seat2);
    first.id = "player";
    const playback = new Game({ replayMode: "playback", captureReplay: false, opponentOverride: second });
    // Seats are wired as BotArena wires them.
    playback.player = first;
    playback.player.game = playback;
    playback.bot.game = playback;
    playback.disablePresentationDelays = true;
    playback.phaseDelayMs = 0;
    const decisions = () => `${playback.decisionBroker.replayCursor}/${exported.decisions.length}`;
    try {
      // The concrete Game provides the driver's port, as its own headless Game does.
      const result = await replayCanonicalDuel(replay, { game: playback as ReplayDriverGamePort });
      results.push({ duelNumber, ok: true, commands: result.commands, decisions: decisions(), message: null });
    } catch (error) {
      results.push({ duelNumber, ok: false, commands: exported.commands.length, decisions: decisions(),
        message: error instanceof Error ? error.message : String(error) });
    } finally {
      playback.dispose("smoke-replay-check");
    }
  }
  return results;
}

async function runMatchup(matchup: string, options: SmokeOptions) {
  const [seat1, seat2] = splitMatchup(matchup);
  const capturedGames: Game[] = [];
  const arena = options.checkReplays
    ? new BotArena(createReplayCapturingGame(capturedGames), Bot)
    : new BotArena(Game, Bot);
  // BotArena normalizes the raw CLI mode strings against its supported modes.
  arena.setSearchParams({ ...plannerOptions(options), randomSeed: options.randomSeed } as ArenaSearchOptions);

  let completion: ArenaCompletionStats | null = null;
  const duels: ArenaDuelResult[] = [];
  await arena.startArena(
    seat1,
    seat2,
    options.duels,
    options.speed,
    false,
    progress => duels.push(progress.lastResult),
    (result) => {
      completion = result;
    },
  );

  const strategicReport = arena.exportStrategicReport();
  // Let commands still settling after the Arena stops polling finish first.
  if (options.checkReplays) await new Promise(resolve => setTimeout(resolve, 200));
  const replayCheck = options.checkReplays
    ? await checkArenaReplays(capturedGames, seat1, seat2)
    : undefined;
  if (replayCheck?.some(result => !result.ok)) process.exitCode = 1;
  return {
    matchup,
    seat1,
    seat2,
    duels,
    completion: compactCompletion(completion),
    strategicReport: compactStrategicReport(strategicReport),
    ...(replayCheck ? { replayCheck } : {}),
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
      ...(options.randomSeed === null ? {} : { randomSeed: options.randomSeed }),
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
