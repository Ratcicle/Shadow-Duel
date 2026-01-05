// test-hand-monitoring.js — Monitorar mãos dos bots para entender EmptyPhase

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

console.log("🔍 Hand Monitoring Test — EmptyPhase Investigation\n");
console.log(
  "═══════════════════════════════════════════════════════════════\n"
);

function createDefaultDeck() {
  return cardDatabase.slice(0, 20).map((c) => c.id);
}

function getCardName(card) {
  if (!card) return "?";
  return card.name || `Card#${card.id}`;
}

function logHandState(game, turn, phase = "Start") {
  const botHand = game.bot?.hand || [];
  const playerHand = game.player?.hand || [];

  console.log(`\n📋 T${turn} ${phase}`);
  console.log(
    `   Bot Hand (${botHand.length}): ${botHand.map(getCardName).join(", ") || "(empty)"}`
  );
  console.log(
    `   Player Hand (${playerHand.length}): ${playerHand.map(getCardName).join(", ") || "(empty)"}`
  );
  console.log(`   Bot LP: ${game.bot?.lifePoints} | Player LP: ${game.player?.lifePoints}`);
}

async function runDuelWithMonitoring(botPreset = "shadowheart", maxTurns = 20) {
  return new Promise((resolve) => {
    const timeoutHandle = setTimeout(() => {
      console.log("\n⏱️ TIMEOUT após 30 segundos");
      resolve({
        winner: null,
        reason: "timeout",
        turns: maxTurns,
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

      // 🔍 LOG INICIAL
      logHandState(game, 0, "Game Start");

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

        console.log(
          `\n╔════════════════════════════════════════════════════════════╗`
        );
        console.log(`║ TURN ${turn}                                                      ║`);
        console.log(
          `╚════════════════════════════════════════════════════════════╝`
        );

        // 📍 Log antes de tentar gerar ações
        logHandState(game, turn, "Main Phase Start");

        try {
          const strategy = bot.strategy;
          if (
            strategy &&
            typeof strategy.generateMainPhaseActions === "function"
          ) {
            console.log(`\n🤖 Bot tentando gerar ações...`);

            const actions = strategy.generateMainPhaseActions(game);

            if (actions.length === 0) {
              console.log(
                `⚠️  NO_ACTIONS_GENERATED! Bot tem ${game.bot.hand.length} cartas na mão.`
              );
              console.log(`   Mão: ${game.bot.hand.map(getCardName).join(", ")}`);
              console.log(`   Campo: ${game.bot.field.length} cartas`);
              console.log(`   Graveyard: ${game.bot.graveyard.length} cartas`);
            } else {
              console.log(
                `✅ Geradas ${actions.length} ação(ões) para o bot`
              );
              actions.forEach((act, i) => {
                console.log(
                  `   ${i + 1}. ${act.type} (prioridade: ${act.priority || 0})`
                );
              });

              actions.sort((a, b) => (b.priority || 0) - (a.priority || 0));

              // Simula aplicação de ações
              player.lifePoints -= Math.random() * 200 + 300;
            }
          } else {
            console.log(
              `⚠️  Bot não tem strategy.generateMainPhaseActions!`
            );
          }
        } catch (e) {
          console.log(`❌ ERRO ao gerar ações: ${e.message}`);
        }

        // 📍 Log após tentativa de ação
        logHandState(game, turn, "Main Phase End");

        try {
          bot.lifePoints -= Math.random() * 150 + 200;
        } catch (e) {}
      }

      clearTimeout(timeoutHandle);

      console.log(`\n🏁 Duelo encerrado após ${turn} turnos`);
      console.log(`   Vencedor: ${winner || "draw"}`);
      console.log(`   Bot LP: ${Math.max(0, bot.lifePoints)}`);
      console.log(`   Player LP: ${Math.max(0, player.lifePoints)}`);

      resolve({
        winner: winner || "draw",
        reason: winner ? "lethal" : "timeout",
        turns: turn,
        botLP: Math.max(0, bot.lifePoints),
        playerLP: Math.max(0, player.lifePoints),
      });
    } catch (err) {
      clearTimeout(timeoutHandle);
      console.log(`\n💥 ERRO CRÍTICO: ${err.message}`);
      console.log(err.stack);
      resolve({
        winner: null,
        reason: `error: ${err.message}`,
        turns: 0,
        botLP: 0,
        playerLP: 0,
      });
    }
  });
}

(async () => {
  const numDuels = 3;
  console.log(`🎮 Rodando ${numDuels} duelos com monitoramento de mão\n`);

  for (let i = 1; i <= numDuels; i++) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`DUEL #${i} — Shadow-Heart vs Human`);
    console.log(`${"=".repeat(70)}`);

    const result = await runDuelWithMonitoring("shadowheart", 20);

    console.log(`\n📊 RESULTADO DUEL #${i}:`);
    console.log(
      `   Vencedor: ${result.winner} (${result.reason})`
    );
    console.log(`   Duração: ${result.turns} turnos`);
    console.log(`   LP Final - Bot: ${result.botLP}, Player: ${result.playerLP}`);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`✅ Teste de Monitoramento Concluído`);
  console.log(`${"=".repeat(70)}`);
})();
