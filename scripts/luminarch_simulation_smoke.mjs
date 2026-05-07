import Game from "../src/core/Game.js";
import Bot from "../src/core/Bot.js";
import BotArena from "../src/core/BotArena.js";

const MATCHUPS = [
  { name: "Luminarch vs Dragon", preset1: "luminarch", preset2: "dragon" },
  {
    name: "Luminarch vs Shadow-Heart",
    preset1: "luminarch",
    preset2: "shadowheart",
  },
];

const DUELS_PER_MATCHUP = 10;
const CRITICAL_PATTERNS = [
  /Invalid summon action/i,
  /CRITICAL/i,
  /Simulating on REAL game state/i,
  /BLOCKED sim/i,
];

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const criticalMessages = [];

function captureCritical(args) {
  const message = args
    .map((entry) =>
      typeof entry === "string" ? entry : JSON.stringify(entry, null, 0),
    )
    .join(" ");
  if (CRITICAL_PATTERNS.some((pattern) => pattern.test(message))) {
    criticalMessages.push(message);
  }
}

console.log = () => {};
console.warn = (...args) => {
  captureCritical(args);
};
console.error = (...args) => {
  captureCritical(args);
};

async function runMatchup(matchup) {
  const arena = new BotArena(Game, Bot);
  const speed = arena.getSpeedConfig("instant");
  arena.setCustomTimeout(30000);
  const results = [];

  for (let i = 1; i <= DUELS_PER_MATCHUP; i += 1) {
    const result = await arena.runDuel(
      matchup.preset1,
      matchup.preset2,
      speed,
      i,
      null,
    );
    results.push(result);
  }

  return results;
}

try {
  const summaries = [];
  for (const matchup of MATCHUPS) {
    const results = await runMatchup(matchup);
    const wins = results.reduce(
      (acc, result) => {
        acc[result.winner || "unknown"] =
          (acc[result.winner || "unknown"] || 0) + 1;
        return acc;
      },
      {},
    );
    summaries.push({ matchup: matchup.name, wins });
  }

  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;

  summaries.forEach((summary) => {
    console.log(
      `[PASS] ${summary.matchup}: ${JSON.stringify(summary.wins)}`,
    );
  });

  if (criticalMessages.length > 0) {
    console.error("\nCritical simulation messages detected:");
    criticalMessages.slice(0, 10).forEach((message) => {
      console.error(`- ${message}`);
    });
    process.exitCode = 1;
  } else {
    console.log("\nLuminarch simulation smoke passed.");
  }
} catch (error) {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
