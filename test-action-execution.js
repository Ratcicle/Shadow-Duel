// test-action-execution.js — Verificar se ações estão sendo EXECUTADAS

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

console.log("🔍 Action Execution Test — Verificar aplicação de ações\n");

function createDefaultDeck() {
  return cardDatabase.slice(0, 20).map((c) => c.id);
}

function getCardName(card) {
  if (!card) return "?";
  return card.name || `Card#${card.id}`;
}

async function runDuelWithActionTracking(botPreset = "shadowheart", maxTurns = 5) {
  return new Promise((resolve) => {
    const timeoutHandle = setTimeout(() => {
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

      console.log(`\n📋 Game Start State:`);
      console.log(`   Bot Hand Size: ${bot.hand.length}`);
      console.log(`   Bot Field Size: ${bot.field.length}`);

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

        console.log(`\n╔════════════════════════════════════════════════════════════╗`);
        console.log(`║ TURN ${turn}                                                      ║`);
        console.log(`╚════════════════════════════════════════════════════════════╝`);

        console.log(`\n[ANTES DA AÇÃO]`);
        console.log(`   Bot Hand: ${bot.hand.length}`);
        console.log(`   Bot Field: ${bot.field.length}`);

        try {
          const strategy = bot.strategy;
          if (
            strategy &&
            typeof strategy.generateMainPhaseActions === "function"
          ) {
            console.log(`\n[GERANDO AÇÕES]`);
            const actions = strategy.generateMainPhaseActions(game);

            console.log(`✅ Ações geradas: ${actions.length}`);
            actions.forEach((act, i) => {
              console.log(`   ${i + 1}. Type: ${act.type}`);
              if (act.card) console.log(`      Card: ${getCardName(act.card)}`);
            });

            if (actions.length > 0) {
              actions.sort((a, b) => (b.priority || 0) - (a.priority || 0));

              console.log(`\n[APLICANDO AÇÕES - SERIA AQUI QUE DEVERIA MUDAR!]`);
              console.log(`   Primeira ação: ${actions[0].type}`);

              // Simulação básica (não está realmente sendo executada)
              player.lifePoints -= Math.random() * 200 + 300;

              console.log(`   (Ação não está sendo aplicada ao game state)`);
            }
          } else {
            console.log(`❌ Bot não tem strategy ou método generateMainPhaseActions`);
          }
        } catch (e) {
          console.log(`❌ ERRO: ${e.message}`);
          console.log(e.stack);
        }

        console.log(`\n[DEPOIS DA AÇÃO]`);
        console.log(`   Bot Hand: ${bot.hand.length} (deveria ter diminuído se invocou)`);
        console.log(`   Bot Field: ${bot.field.length} (deveria ter aumentado se invocou)`);

        try {
          bot.lifePoints -= Math.random() * 150 + 200;
        } catch (e) {}
      }

      clearTimeout(timeoutHandle);

      console.log(`\n\n${"=".repeat(70)}`);
      console.log(`CONCLUSÃO: As ações geradas NÃO estão sendo aplicadas`);
      console.log(`Problema: generateMainPhaseActions() gera, mas ninguém as executa!`);
      console.log(`${"=".repeat(70)}`);

      resolve({
        winner: winner || "draw",
        reason: "test",
        turns: turn,
      });
    } catch (err) {
      clearTimeout(timeoutHandle);
      console.log(`\n💥 ERRO: ${err.message}`);
      resolve({
        winner: null,
        reason: `error`,
        turns: 0,
      });
    }
  });
}

(async () => {
  await runDuelWithActionTracking("shadowheart", 5);
})();
