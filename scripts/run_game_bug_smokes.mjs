import Game from "../src/core/Game.js";
import {
  cardDatabase,
  cardDatabaseByName,
} from "../src/data/cards.js";

const args = new Set(process.argv.slice(2));
const verbose = args.has("--verbose");
const jsonOutput = args.has("--json");

const STATUS_ORDER = {
  reproduced: 0,
  current_behavior: 1,
  manual: 2,
  blocked: 3,
  unexpected: 4,
};

const SMOKE_MAIN_DECK_IDS = cardDatabase
  .filter((card) => card.cardKind && !card.monsterType)
  .slice(0, 20)
  .map((card) => card.id);

function createMockRenderer(options = {}) {
  const state = {
    logs: [],
    phaseHandler: null,
  };
  const noop = () => {};
  const renderer = {
    __state: state,
    log(message) {
      state.logs.push(String(message ?? ""));
    },
    showMessage(message) {
      state.logs.push(String(message ?? ""));
    },
    showAlert(message) {
      state.logs.push(String(message ?? ""));
    },
    showConfirmPrompt() {
      return options.confirm ?? true;
    },
    showTrapActivationModal() {
      return Promise.resolve(options.confirmTrap ?? true);
    },
    showDuelStartAnnouncement() {
      return Promise.resolve();
    },
    bindPhaseClick(handler) {
      state.phaseHandler = handler;
    },
    captureCardRects() {
      return null;
    },
    captureCardAnimationSource() {
      return null;
    },
    renderHand: noop,
    renderField: noop,
    renderSpellTrap: noop,
    renderFieldSpell: noop,
    updateLP: noop,
    updatePhaseTrack: noop,
    updateTurn: noop,
    updateGYPreview: noop,
    updateExtraDeckPreview: noop,
    applyHandTargetableIndices: noop,
    hideFieldTargetingControls: noop,
    playQueuedCardAnimations: noop,
    playVisualFeedback: noop,
    animateCardLayout: noop,
  };

  return new Proxy(renderer, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return noop;
    },
  });
}

function createSmokeGame(options = {}) {
  const renderer = createMockRenderer(options.renderer || {});
  const game = new Game({
    renderer,
    laboratoryMode: true,
    laboratoryUseBot: false,
    disableChains: options.disableChains ?? true,
  });
  game.phaseDelayMs = 0;
  game.aiActionDelayMs = 0;
  game.aiSuccessfulActionDelayMs = 0;
  game.aiPresentationStepDelayMs = 0;
  game.aiBattleDelayMs = 0;
  return { game, renderer };
}

function createCard(game, owner, name, overrides = {}) {
  const card = game.createCardForOwner(name, owner, overrides);
  if (!card) {
    throw new Error(`Card not found for smoke: ${name}`);
  }
  return card;
}

function markerCard(game, owner, marker, name = "Mirror Force") {
  const card = createCard(game, owner, name);
  card.__smokeMarker = marker;
  return card;
}

async function startSmokeDuel(game) {
  await game.startWithDecks({
    playerDeck: SMOKE_MAIN_DECK_IDS,
    botDeck: SMOKE_MAIN_DECK_IDS,
    playerExtraDeck: [],
    botExtraDeck: [],
    startingPlayer: "player",
    firstTurnPlayer: "player",
    exactDecks: false,
    startAtDrawPhase: true,
    announceStartingPlayer: false,
  });
}

function hasMarker(zone, marker) {
  return Array.isArray(zone) && zone.some((card) => card?.__smokeMarker === marker);
}

function compact(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return String(value);
  }
}

async function smokeResetReuse() {
  const { game } = createSmokeGame();
  await startSmokeDuel(game);

  game.player.lp = 1234;
  game.player.hand.push(markerCard(game, game.player, "hand_leak"));
  game.player.field.push(markerCard(game, game.player, "field_leak"));
  game.player.graveyard.push(markerCard(game, game.player, "grave_leak"));
  game.player.spellTrap.push(markerCard(game, game.player, "spelltrap_leak"));
  game.player.additionalNormalSummons = 2;
  game.delayedActions.push({ __smokeMarker: "delayed_leak" });
  game.turnCounter = 7;
  game.oncePerTurnUsage.player.set("smoke_lock", true);
  game.player.oncePerDuelUsageByName = { smoke_duel_lock: true };

  await startSmokeDuel(game);

  const leaks = [];
  if (game.player.lp === 1234) leaks.push("player.lp");
  if (hasMarker(game.player.hand, "hand_leak")) leaks.push("player.hand");
  if (hasMarker(game.player.field, "field_leak")) leaks.push("player.field");
  if (hasMarker(game.player.graveyard, "grave_leak")) leaks.push("player.graveyard");
  if (hasMarker(game.player.spellTrap, "spelltrap_leak")) {
    leaks.push("player.spellTrap");
  }
  if (game.player.additionalNormalSummons === 2) {
    leaks.push("player.additionalNormalSummons");
  }
  if (game.delayedActions.some((entry) => entry?.__smokeMarker === "delayed_leak")) {
    leaks.push("game.delayedActions");
  }
  if (game.turnCounter === 7) leaks.push("game.turnCounter");
  if (game.oncePerTurnUsage?.player?.has?.("smoke_lock")) {
    leaks.push("game.oncePerTurnUsage.player");
  }
  if (game.player.oncePerDuelUsageByName?.smoke_duel_lock === true) {
    leaks.push("player.oncePerDuelUsageByName");
  }

  game.dispose?.("smoke_reset_reuse");
  return {
    status: leaks.length ? "unexpected" : "current_behavior",
    detail: leaks.length
      ? `state leaked after second startWithDecks: ${leaks.join(", ")}`
      : "second startWithDecks reset LP, zones, turnCounter, delayedActions, once-per-turn, and once-per-duel",
  };
}

async function smokeDeckEmptyDraw() {
  const { game } = createSmokeGame();
  game.player.deck = [];
  const result = game.drawCards(game.player, 1, { silent: true });
  const nonFatal =
    result?.ok === false &&
    result?.success === false &&
    result?.reason === "deck_empty" &&
    result?.nonFatal === true &&
    game.gameOver === false &&
    game.winner == null;
  game.dispose?.("smoke_deck_empty_draw");
  return {
    status: nonFatal ? "current_behavior" : "unexpected",
    detail: nonFatal
      ? "drawCards returns non-fatal deck_empty and leaves gameOver=false"
      : `unexpected draw result: ${compact(result)}, gameOver=${game.gameOver}`,
  };
}

async function smokePhaseSkip() {
  const nextGame = createSmokeGame().game;
  nextGame.phase = "main1";
  nextGame.turn = "player";
  nextGame.turnCounter = 2;
  let nextCalls = 0;
  nextGame.checkAndOfferTraps = async (event) => {
    if (event === "phase_end") nextCalls += 1;
  };
  await nextGame.nextPhase();
  nextGame.dispose?.("smoke_phase_next");

  const skipGame = createSmokeGame().game;
  skipGame.phase = "main1";
  skipGame.turn = "player";
  skipGame.turnCounter = 2;
  let skipCalls = 0;
  skipGame.checkAndOfferTraps = async (event) => {
    if (event === "phase_end") skipCalls += 1;
  };
  await skipGame.skipToPhase("main2");
  skipGame.dispose?.("smoke_phase_skip");

  const reproduced = nextCalls === 1 && skipCalls === 0;
  return {
    status: reproduced ? "reproduced" : "unexpected",
    detail: `nextPhase phase_end calls=${nextCalls}; skipToPhase phase_end calls=${skipCalls}`,
  };
}

async function smokeTrapFlipRollback() {
  const { game } = createSmokeGame({ renderer: { confirmTrap: true } });
  const trap = createCard(game, game.player, "Mirror Force", {
    isFacedown: true,
    turnSetOn: 0,
  });
  trap.turnSetOn = 0;
  trap.isFacedown = true;
  game.player.spellTrap.push(trap);
  game.phase = "main1";
  game.turn = "player";
  game.turnCounter = 2;
  game.effectEngine.canActivateSpellTrapEffectPreview = () => ({ ok: true });
  game.runActivationPipeline = async () => ({
    success: false,
    reason: "forced_smoke_failure",
  });

  const result = await game.tryActivateSpellTrapEffect(trap);
  const stayedFaceUp = trap.isFacedown === false;
  game.dispose?.("smoke_trap_flip_rollback");
  return {
    status: stayedFaceUp ? "reproduced" : "unexpected",
    detail: stayedFaceUp
      ? `trap remains face-up after failed pipeline; result=${compact(result)}`
      : `trap returned face-down; result=${compact(result)}`,
  };
}

async function smokeQuickSpellFromHand() {
  const { game } = createSmokeGame();
  const quick = createCard(game, game.player, "Luminarch Holy Shield");
  game.player.hand = [quick];
  game.phase = "battle";
  game.turn = "player";
  game.turnCounter = 2;

  const result = await game.tryActivateSpell(quick, 0, null, {
    owner: game.player,
  });
  const blockedByPhase =
    result?.success === false &&
    result?.blockedByGuard === true &&
    /phase/i.test(result?.code || result?.reason || "");
  game.dispose?.("smoke_quick_spell_from_hand");
  return {
    status: blockedByPhase ? "reproduced" : "unexpected",
    detail: blockedByPhase
      ? `quick spell from hand blocked in battle phase: ${result.code || result.reason}`
      : `quick spell behavior differed: ${compact(result)}`,
  };
}

async function smokeBattleIndestructible() {
  const { game } = createSmokeGame();
  const marshal = createCard(game, game.player, "Luminarch Celestial Marshal");
  game.player.field = [marshal];
  game.bot.deck = [createCard(game, game.bot, "Mirror Force")];
  game.turn = "player";
  game.turnCounter = 1;

  const firstCanDestroy = game.canDestroyByBattle(marshal);
  game.turn = "bot";
  await game.startTurn();
  const secondCanDestroy = game.canDestroyByBattle(marshal);
  game.dispose?.("smoke_battle_indestructible");

  const reproduced = firstCanDestroy === false && secondCanDestroy === true;
  return {
    status: reproduced ? "reproduced" : "unexpected",
    detail: `first canDestroy=${firstCanDestroy}; next turn canDestroy=${secondCanDestroy}`,
  };
}

async function smokeUpdateBoardMutation() {
  const { game } = createSmokeGame();
  const card = createCard(game, game.player, "Luminarch Celestial Marshal");
  game.player.field = [undefined, card];
  const before = game.player.field.length;
  game.updateBoard();
  const after = game.player.field.length;
  game.dispose?.("smoke_update_board_mutation");
  return {
    status: before === 2 && after === 1 ? "reproduced" : "unexpected",
    detail: `player.field length before=${before}; after updateBoard=${after}`,
  };
}

async function smokeReturnContracts() {
  const { game } = createSmokeGame();
  const monsterResult = await game.tryActivateMonsterEffect(null);
  const spellTrapResult = await game.tryActivateSpellTrapEffect(null);
  game.dispose?.("smoke_return_contracts");
  const reproduced = monsterResult === undefined && spellTrapResult === undefined;
  return {
    status: reproduced ? "reproduced" : "unexpected",
    detail: `tryActivateMonsterEffect(null)=${compact(monsterResult)}; tryActivateSpellTrapEffect(null)=${compact(spellTrapResult)}`,
  };
}

const scenarios = [
  ["Reset reuse", smokeResetReuse],
  ["Deck empty draw", smokeDeckEmptyDraw],
  ["Phase skip", smokePhaseSkip],
  ["Trap flip rollback", smokeTrapFlipRollback],
  ["Quick Spell from hand", smokeQuickSpellFromHand],
  ["Battle indestructible", smokeBattleIndestructible],
  ["updateBoard mutation", smokeUpdateBoardMutation],
  ["Return contracts", smokeReturnContracts],
];

async function runScenario(name, fn) {
  try {
    const result = await fn();
    return {
      scenario: name,
      status: result?.status || "blocked",
      detail: result?.detail || "no detail returned",
    };
  } catch (error) {
    return {
      scenario: name,
      status: "blocked",
      detail: error?.stack || error?.message || String(error),
    };
  }
}

function printTable(rows) {
  const sorted = [...rows].sort((a, b) => {
    const statusDiff =
      (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    return statusDiff || a.scenario.localeCompare(b.scenario);
  });
  const columns = ["scenario", "status", "detail"];
  const widths = Object.fromEntries(
    columns.map((column) => [
      column,
      Math.max(
        column.length,
        ...sorted.map((row) => String(row[column] || "").length),
      ),
    ]),
  );
  const line = columns
    .map((column) => "-".repeat(widths[column]))
    .join("-+-");
  const header = columns
    .map((column) => column.padEnd(widths[column]))
    .join(" | ");

  console.log(header);
  console.log(line);
  for (const row of sorted) {
    console.log(
      columns
        .map((column) => String(row[column] || "").padEnd(widths[column]))
        .join(" | "),
    );
  }
}

async function main() {
  if (SMOKE_MAIN_DECK_IDS.length < 4) {
    throw new Error("Smoke harness could not find enough main deck cards.");
  }
  if (!cardDatabaseByName.has("Luminarch Holy Shield")) {
    throw new Error("Smoke harness requires Luminarch Holy Shield.");
  }

  const originalConsole = {
    log: console.log,
    warn: console.warn,
  };
  const captured = [];
  if (!verbose && !jsonOutput) {
    console.log = (...items) => captured.push(["log", items]);
    console.warn = (...items) => captured.push(["warn", items]);
  }

  let rows;
  try {
    rows = [];
    for (const [name, fn] of scenarios) {
      rows.push(await runScenario(name, fn));
    }
  } finally {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ rows, capturedLogCount: captured.length }, null, 2));
    return;
  }

  console.log("\nShadow Duel Game bug smoke report");
  console.log(`Captured internal log/warn calls: ${captured.length}`);
  printTable(rows);
}

main().catch((error) => {
  console.error("[run_game_bug_smokes] Infrastructure failure:", error);
  process.exitCode = 1;
});
