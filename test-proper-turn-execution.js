// test-proper-turn-execution.js — Executar turnos COM fases corretas

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

console.log("✅ Proper Turn Execution Test — Com fases e inicialização corretas\n");

function createDefaultDeck() {
  return cardDatabase.slice(0, 20).map((c) => c.id);
}

function getCardName(card) {
  if (!card) return "?";
  return card.name || `Card#${card.id}`;
}

async function runProperDuel(botPreset = "shadowheart", maxTurns = 10) {
  return new Promise(async (resolve) => {
    const timeoutHandle = setTimeout(() => {
      console.log("\n⏱️ TIMEOUT");
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

      // ✅ INICIALIZAR O GAME CORRETAMENTE
      if (typeof game.start === "function") {
        try {
          game.start();
          console.log(
            `✅ Game iniciado. Fase atual: ${game.phase}, Turno: ${game.turn}`
          );
        } catch (e) {
          console.log(`⚠️ game.start() error (non-blocking): ${e.message}`);
        }
      }

      // Configurar turno manualmente se start não funcionou
      if (!game.phase) {
        game.phase = "main1";
        game.turn = "bot";
        game.turnCounter = 0;
        console.log(`✅ Game configurado manualmente. Fase: ${game.phase}`);
      }

      let turn = 0;
      let winner = null;

      console.log(`\n📋 Estado inicial:`);
      console.log(`   Bot: ${bot.hand.length} cartas, ${bot.field.length} no campo`);
      console.log(`   Player: ${player.hand.length} cartas, ${player.field.length} no campo`);
      console.log(`   Fase: ${game.phase}, Turno atual: ${game.turn}`);

      while (turn < maxTurns && !winner) {
        turn++;
        game.turnCounter = turn;

        if (player.lifePoints <= 0) {
          winner = "bot";
          console.log(`\n🏆 Bot venceu! Player LP: ${player.lifePoints}`);
          break;
        }
        if (bot.lifePoints <= 0) {
          winner = "player";
          console.log(`\n🏆 Player venceu! Bot LP: ${bot.lifePoints}`);
          break;
        }

        console.log(`\n╔════════════════════════════════════════════════════════════╗`);
        console.log(
          `║ TURN ${turn} — Fase: ${game.phase || "?"}                                  ║`
        );
        console.log(
          `╚════════════════════════════════════════════════════════════╝`
        );

        // Garantir que é turno do bot na main phase
        game.turn = "bot";
        game.phase = "main1";

        console.log(`[ANTES]`);
        console.log(`   Bot Hand: ${bot.hand.length}, Field: ${bot.field.length}`);

        // Tentar executar ações na main phase (ASYNC)
        let actionCount = 0;
        if (bot.playMainPhase && typeof bot.playMainPhase === "function") {
          console.log(`\n[EXECUTANDO MAIN PHASE]`);
          try {
            const result = bot.playMainPhase(game);
            // Check if it's a promise
            if (result && typeof result.then === "function") {
              await result;
            }
            console.log(`✅ playMainPhase executado`);
          } catch (e) {
            console.log(`❌ Erro em playMainPhase: ${e.message}`);
          }
        } else {
          console.log(`⚠️ Bot não tem playMainPhase`);
        }

        console.log(`\n[DEPOIS]`);
        console.log(`   Bot Hand: ${bot.hand.length}, Field: ${bot.field.length}`);
        if (bot.field.length > 0) {
          console.log(`   Invocações: ${bot.field.map(getCardName).join(", ")}`);
          actionCount++;
        }

        // Simular dano aleatório
        bot.lifePoints -= Math.random() * 100 + 50;
        player.lifePoints -= Math.random() * 100 + 50;
      }

      clearTimeout(timeoutHandle);

      console.log(`\n\n${"=".repeat(70)}`);
      console.log(`Duelo finalizado: ${turn} turnos`);
      console.log(`Bot LP: ${Math.max(0, bot.lifePoints)}`);
      console.log(`Player LP: ${Math.max(0, player.lifePoints)}`);
      console.log(
        `Resultado: ${winner ? winner.toUpperCase() + " venceu" : "Draw"}`
      );
      console.log(`${"=".repeat(70)}`);

      resolve({
        winner: winner || "draw",
        reason: "test",
        turns: turn,
        botLP: bot.lifePoints,
        playerLP: player.lifePoints,
      });
    } catch (err) {
      clearTimeout(timeoutHandle);
      console.log(`\n💥 ERRO CRÍTICO: ${err.message}`);
      console.log(err.stack);
      resolve({
        winner: null,
        reason: `error`,
        turns: 0,
      });
    }
  });
}

(async () => {
  console.log("Teste 1: Execução apropriada com fases\n");
  const result = await runProperDuel("shadowheart", 10);

  console.log(`\n\nFINAL RESULT:`);
  console.log(`  Winner: ${result.winner}`);
  console.log(`  Turns: ${result.turns}`);
  console.log(`  Bot LP: ${result.botLP.toFixed(0)}`);
  console.log(`  Player LP: ${result.playerLP.toFixed(0)}`);
})();
