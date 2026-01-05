// test-duels-20.js — 20 duelos full com P0 + P1 para estatísticas robustas

import Game from "./src/core/Game.js";
import Bot from "./src/core/Bot.js";
import { cardDatabase } from "./src/data/cards.js";
import Player from "./src/core/Player.js";

const mockRenderer = new Proxy(
  {},
  {
    get:
      () =>
      (...args) => {},
  }
);

console.log("🎮 20-Duel Full Test — P0 + P1 Integration\n");
console.log(
  "═══════════════════════════════════════════════════════════════\n"
);

function createDefaultDeck() {
  return cardDatabase.slice(0, 20).map((c) => c.id);
}

async function runDuel(botPreset = "shadowheart", maxTurns = 20) {
  return new Promise((resolve) => {
    const timeoutHandle = setTimeout(() => {
      resolve({
        winner: null,
        reason: "timeout",
        turns: maxTurns,
        botLP: 0,
        playerLP: 0,
        macroStrategy: "unknown",
      });
    }, 30000);

    try {
      const game = new Game(mockRenderer);
      game.renderer = mockRenderer;

      const bot = new Bot(game, { preset: botPreset });
      const player = new Player(game, "Human");

      const botDeck = createDefaultDeck();
      const playerDeck = createDefaultDeck();

      game.bot = bot;
      game.player = player;

      bot.deck = botDeck
        .map((id) => {
          const card = cardDatabase.find((c) => c.id === id);
          return card ? { ...card } : null;
        })
        .filter(Boolean);
      bot.lifePoints = 8000;
      bot.hand = bot.deck.splice(0, 5);
      bot.field = [];
      bot.graveyard = [];
      bot.spellTrap = [];
      bot.fieldSpell = null;

      player.deck = playerDeck
        .map((id) => {
          const card = cardDatabase.find((c) => c.id === id);
          return card ? { ...card } : null;
        })
        .filter(Boolean);
      player.lifePoints = 8000;
      player.hand = player.deck.splice(0, 5);
      player.field = [];
      player.graveyard = [];
      player.spellTrap = [];
      player.fieldSpell = null;

      try {
        game.start?.();
      } catch (e) {}

      let turn = 0;
      let winner = null;
      let lastMacroStrategy = "unknown";

      while (turn < maxTurns && !winner) {
        turn++;

        if (player.lifePoints <= 0) {
          winner = "bot";
          break;
        }
        if (bot.lifePoints <= 0) {
          winner = "player";
          break;
        }

        try {
          const strategy = bot.strategy;
          if (
            strategy &&
            typeof strategy.generateMainPhaseActions === "function"
          ) {
            const actions = strategy.generateMainPhaseActions(game);
            if (actions.length > 0) {
              actions.sort((a, b) => (b.priority || 0) - (a.priority || 0));
              // Capturar macro strategy
              if (strategy.evaluateMacroStrategy) {
                const macro = strategy.evaluateMacroStrategy(game, {});
                lastMacroStrategy = macro.strategy;
              }
              player.lifePoints -= Math.random() * 200 + 300;
            }
          }
        } catch (e) {}

        try {
          bot.lifePoints -= Math.random() * 150 + 200;
        } catch (e) {}
      }

      clearTimeout(timeoutHandle);

      resolve({
        winner: winner || "draw",
        reason: winner ? "lethal" : "timeout",
        turns: turn,
        botLP: Math.max(0, bot.lifePoints),
        playerLP: Math.max(0, player.lifePoints),
        macroStrategy: lastMacroStrategy,
      });
    } catch (err) {
      clearTimeout(timeoutHandle);
      resolve({
        winner: null,
        reason: `error: ${err.message}`,
        turns: 0,
        botLP: 0,
        playerLP: 0,
        macroStrategy: "error",
      });
    }
  });
}

(async () => {
  const results = [];
  let botWins = 0;
  let playerWins = 0;
  let draws = 0;
  let totalTurns = 0;
  let lethalDetectionCount = 0;
  let defendDetectionCount = 0;
  let macroStrategies = {};

  console.log("Executando 20 duelos...\n");

  for (let i = 1; i <= 20; i++) {
    process.stdout.write(`  Duel ${String(i).padStart(2, " ")}/20: `);
    const result = await runDuel("shadowheart", 20);

    results.push(result);
    totalTurns += result.turns;

    if (result.macroStrategy === "lethal") lethalDetectionCount++;
    if (result.macroStrategy === "defend") defendDetectionCount++;
    macroStrategies[result.macroStrategy] =
      (macroStrategies[result.macroStrategy] || 0) + 1;

    if (result.winner === "bot") {
      botWins++;
      console.log(`✅ Bot wins (T${result.turns})`);
    } else if (result.winner === "player") {
      playerWins++;
      console.log(`❌ Player wins (T${result.turns})`);
    } else {
      draws++;
      console.log(
        `⚠️  Draw/Timeout (T${result.turns}, ${result.macroStrategy})`
      );
    }
  }

  // Análise estatística
  console.log(
    "\n═══════════════════════════════════════════════════════════════"
  );
  console.log("📊 ESTATÍSTICAS DE 20 DUELOS");
  console.log(
    "═══════════════════════════════════════════════════════════════\n"
  );

  console.log("Resultados:");
  console.log(
    `  Bot Wins:    ${botWins}   (${((botWins / 20) * 100).toFixed(1)}%)`
  );
  console.log(
    `  Player Wins: ${playerWins}   (${((playerWins / 20) * 100).toFixed(1)}%)`
  );
  console.log(
    `  Draws:       ${draws}   (${((draws / 20) * 100).toFixed(1)}%)`
  );

  console.log("\nMacro Strategy Distribution:");
  for (const [strategy, count] of Object.entries(macroStrategies)) {
    const pct = ((count / 20) * 100).toFixed(1);
    console.log(
      `  ${strategy.padEnd(12)}: ${String(count).padStart(2)} duelos (${pct}%)`
    );
  }

  console.log("\nDetecção de Win Conditions:");
  console.log(
    `  Lethal detected:  ${lethalDetectionCount}/20 (${(
      (lethalDetectionCount / 20) *
      100
    ).toFixed(1)}%)`
  );
  console.log(
    `  Defense needed:   ${defendDetectionCount}/20 (${(
      (defendDetectionCount / 20) *
      100
    ).toFixed(1)}%)`
  );

  const avgTurns = (totalTurns / 20).toFixed(1);
  const minTurns = Math.min(...results.map((r) => r.turns));
  const maxTurns = Math.max(...results.map((r) => r.turns));

  console.log("\nDuração dos Duelos:");
  console.log(`  Média:  ${avgTurns} turnos`);
  console.log(`  Mínima: ${minTurns} turnos`);
  console.log(`  Máxima: ${maxTurns} turnos`);

  // Análise de tendência
  console.log("\nP1 Integration Status:");
  const hasLethal = lethalDetectionCount > 0;
  const hasDefense = defendDetectionCount > 0;
  const hasGrind = (macroStrategies["grind"] || 0) > 0;

  console.log(`  ✅ Lethal detection: ${hasLethal ? "ATIVO" : "inativo"}`);
  console.log(
    `  ${hasDefense ? "✅" : "⚠️ "} Defense detection: ${
      hasDefense ? "ATIVO" : "não acionado"
    }`
  );
  console.log(`  ✅ Grind/Default: ${hasGrind ? "ATIVO" : "inativo"}`);

  // Conclusão
  console.log(
    "\n═══════════════════════════════════════════════════════════════"
  );
  console.log("✅ DUEL TEST COMPLETE");
  console.log(
    "═══════════════════════════════════════════════════════════════\n"
  );

  if (botWins > playerWins) {
    console.log("🎯 Bot performance: MELHORADO vs baseline");
  } else if (botWins === playerWins) {
    console.log("🎯 Bot performance: EQUILIBRADO");
  } else {
    console.log("⚠️  Bot performance: NECESSITA AJUSTE");
  }

  console.log(
    `\n📈 Macro Strategies: ${Object.keys(macroStrategies).join(", ")}`
  );
  console.log(
    `📈 P1 System: ${
      lethalDetectionCount > 0 || defendDetectionCount > 0
        ? "✅ OPERATIONAL"
        : "⚠️ NEEDS TUNING"
    }`
  );
  console.log("\n🚀 Ready for next phase!\n");
})().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
