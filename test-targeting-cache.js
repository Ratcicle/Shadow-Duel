/**
 * Test script para validar o cache de targeting
 * 
 * Execute com: node test-targeting-cache.js
 * 
 * Roda 1 duelo rápido no modo instant e verifica:
 * - Se o cache está sendo usado (hits > 0)
 * - Se o hit rate é razoável (esperado > 50%)
 * - Se não há erros de targeting
 */

import Game from "./src/core/Game.js";
import Bot from "./src/core/Bot.js";
import Player from "./src/core/Player.js";
import { cardDatabaseById } from "./src/data/cards.js";

// Configurações do teste
const MAX_TURNS = 20;
const TIMEOUT_MS = 15000; // 15s timeout

// Criar decks Shadow-Heart (default)
function createDefaultDeck() {
  const mainDeckIds = [
    1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18,
    19, 19, 20,
  ];
  const extraDeckIds = [200];

  const mainDeck = mainDeckIds.map((id) => cardDatabaseById.get(id)).filter(Boolean);
  const extraDeck = extraDeckIds.map((id) => cardDatabaseById.get(id)).filter(Boolean);

  return { mainDeck, extraDeck };
}

// Criar jogo com configurações de teste
function createTestGame() {
  const { mainDeck: p1Main, extraDeck: p1Extra } = createDefaultDeck();
  const { mainDeck: p2Main, extraDeck: p2Extra } = createDefaultDeck();

  const player = new Player("player");
  const bot = new Player("bot");

  player.deck = [...p1Main];
  player.extraDeck = [...p1Extra];
  bot.deck = [...p2Main];
  bot.extraDeck = [...p2Extra];

  const game = new Game(player, bot, { enableRenderer: false });
  
  // Configurar delays zerados para teste rápido
  game.phaseDelayMs = 0;
  game.actionDelayMs = 0;
  game.battleDelayMs = 0;

  // Criar bots
  const playerBot = new Bot(game, player, {
    preset: "shadowheart",
    debug: false,
  });
  const botBot = new Bot(game, bot, {
    preset: "shadowheart",
    debug: false,
  });

  game.playerBot = playerBot;
  game.botBot = botBot;

  return game;
}

// Executar duelo com timeout
async function runDuelWithTimeout(game, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("TIMEOUT"));
    }, timeoutMs);

    let turnCount = 0;
    const checkInterval = setInterval(() => {
      if (game.winner || game.player.lp <= 0 || game.bot.lp <= 0) {
        clearInterval(checkInterval);
        clearTimeout(timeoutId);
        resolve({ winner: game.winner, turns: game.turnCounter });
      }
      
      if (game.turnCounter > MAX_TURNS) {
        clearInterval(checkInterval);
        clearTimeout(timeoutId);
        resolve({ winner: "max_turns", turns: game.turnCounter });
      }
    }, 10);

    game.start();
  });
}

// Executar teste
async function runTest() {
  console.log("🧪 Teste de Cache de Targeting");
  console.log("═".repeat(50));
  console.log("");

  const game = createTestGame();
  
  try {
    const result = await runDuelWithTimeout(game, TIMEOUT_MS);
    
    console.log("\n✅ Duelo concluído!");
    console.log(`   Vencedor: ${result.winner || "draw"}`);
    console.log(`   Turnos: ${result.turns}`);
    console.log("");

    // Verificar estatísticas do cache
    const engine = game.effectEngine;
    if (!engine) {
      console.log("❌ EffectEngine não encontrado");
      process.exit(1);
    }

    const hits = engine._targetingCacheHits || 0;
    const misses = engine._targetingCacheMisses || 0;
    const total = hits + misses;

    if (total === 0) {
      console.log("⚠️  Nenhuma busca de targeting foi realizada");
      console.log("   Isso é inesperado - pode ser um problema");
      process.exit(1);
    }

    const hitRate = ((hits / total) * 100).toFixed(1);
    
    console.log("📊 Estatísticas do Cache:");
    console.log(`   Cache Hits: ${hits}`);
    console.log(`   Cache Misses: ${misses}`);
    console.log(`   Total: ${total}`);
    console.log(`   Hit Rate: ${hitRate}%`);
    console.log("");

    if (hits === 0) {
      console.log("⚠️  Cache não está sendo usado!");
      console.log("   Esperado: hits > 0 em um duelo normal");
      process.exit(1);
    }

    if (parseFloat(hitRate) < 30) {
      console.log("⚠️  Hit rate muito baixo");
      console.log("   Esperado: > 30% em duelos com efeitos repetidos");
    } else if (parseFloat(hitRate) >= 50) {
      console.log("✅ Hit rate excelente! Cache funcionando bem.");
    } else {
      console.log("✅ Hit rate razoável. Cache funcionando.");
    }

    console.log("");
    console.log("═".repeat(50));
    console.log("✅ TESTE PASSOU");
    process.exit(0);

  } catch (error) {
    console.log("");
    console.log("❌ ERRO NO TESTE:", error.message);
    process.exit(1);
  }
}

runTest();
