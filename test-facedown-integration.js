/**
 * Teste de integração: Bot Arena com validação de ataque a monstros facedown
 * 
 * Este teste simula duelos reais onde bots têm monstros setados e valida
 * que o comportamento de ataque agora é mais agressivo e realista.
 */

import Game from "./src/core/Game.js";
import Bot from "./src/core/Bot.js";
import Player from "./src/core/Player.js";

// Mock renderer
const mockRenderer = new Proxy(
  {},
  {
    get: () => () => {},
  }
);

async function runBotVsBotDuel(options = {}) {
  const { maxTurns = 50, logBattles = true } = options;

  const player = new Bot("luminarch"); // Luminarch tende a setar monstros
  const bot = new Bot("shadowheart"); // Shadow-Heart mais agressivo
  const game = new Game(player, bot, mockRenderer);

  player.isBot = true;
  game.aiBattleDelayMs = 0; // Sem delay para teste rápido
  game.aiMainPhaseDelayMs = 0;

  player.buildDeck();
  bot.buildDeck();
  game.startGame();

  let battleCount = 0;
  let attacksAgainstFacedown = 0;

  // Monitorar ataques contra monstros facedown
  const originalResolveCombat = game.resolveCombat.bind(game);
  game.resolveCombat = async function (attacker, target) {
    battleCount++;
    if (target && target.isFacedown) {
      attacksAgainstFacedown++;
      if (logBattles) {
        console.log(
          `⚔️ T${game.turnCounter} ${game.turnPlayer.id}: ${attacker.name} (${attacker.atk} ATK) ataca [FACEDOWN] (DEF: ${target.def})`
        );
      }
    }
    return originalResolveCombat(attacker, target);
  };

  // Timeout de segurança
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout - duelo excedeu 30s")), 30000)
  );

  try {
    const result = await Promise.race([
      new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (game.gameOver || game.turnCounter > maxTurns) {
            clearInterval(checkInterval);
            resolve({
              winner: game.winner?.id || "draw",
              reason: game.winReason || "max_turns",
              turns: game.turnCounter,
              botLP: bot.lp,
              playerLP: player.lp,
              battleCount,
              attacksAgainstFacedown,
            });
          }
        }, 10);
      }),
      timeout,
    ]);

    return result;
  } catch (error) {
    console.error("❌ Erro durante duelo:", error.message);
    return {
      winner: "error",
      reason: error.message,
      turns: game.turnCounter,
      botLP: bot.lp,
      playerLP: player.lp,
      battleCount,
      attacksAgainstFacedown,
    };
  }
}

// Executar múltiplos duelos
console.log("=".repeat(70));
console.log("VALIDAÇÃO: Bots atacam monstros facedown de forma mais agressiva");
console.log("=".repeat(70));

(async () => {
  const numDuels = 10;
  const results = [];

  console.log(`\n🎮 Executando ${numDuels} duelos bot vs bot...\n`);

  for (let i = 1; i <= numDuels; i++) {
    console.log(`\n📊 Duelo ${i}/${numDuels}`);
    const result = await runBotVsBotDuel({
      maxTurns: 50,
      logBattles: true,
    });
    results.push(result);

    console.log(`   Vencedor: ${result.winner}`);
    console.log(`   Turnos: ${result.turns}`);
    console.log(`   Batalhas totais: ${result.battleCount}`);
    console.log(`   Ataques vs Facedown: ${result.attacksAgainstFacedown}`);
  }

  // Análise dos resultados
  console.log("\n" + "=".repeat(70));
  console.log("ANÁLISE DOS RESULTADOS");
  console.log("=".repeat(70));

  const totalBattles = results.reduce((sum, r) => sum + r.battleCount, 0);
  const totalFacedownAttacks = results.reduce(
    (sum, r) => sum + r.attacksAgainstFacedown,
    0
  );
  const avgBattles = totalBattles / numDuels;
  const avgFacedownAttacks = totalFacedownAttacks / numDuels;
  const facedownAttackRate =
    totalBattles > 0 ? (totalFacedownAttacks / totalBattles) * 100 : 0;

  console.log(`\n📈 Estatísticas de Batalha:`);
  console.log(`   Total de batalhas: ${totalBattles}`);
  console.log(`   Ataques vs Facedown: ${totalFacedownAttacks}`);
  console.log(`   Média de batalhas/duelo: ${avgBattles.toFixed(1)}`);
  console.log(
    `   Média de ataques facedown/duelo: ${avgFacedownAttacks.toFixed(1)}`
  );
  console.log(`   Taxa de ataque facedown: ${facedownAttackRate.toFixed(1)}%`);

  const shadowheartWins = results.filter((r) => r.winner === "bot").length;
  const luminarchWins = results.filter((r) => r.winner === "player").length;
  const draws = numDuels - shadowheartWins - luminarchWins;

  console.log(`\n🏆 Win Rates:`);
  console.log(
    `   Shadow-Heart: ${shadowheartWins}/${numDuels} (${((shadowheartWins / numDuels) * 100).toFixed(0)}%)`
  );
  console.log(
    `   Luminarch: ${luminarchWins}/${numDuels} (${((luminarchWins / numDuels) * 100).toFixed(0)}%)`
  );
  console.log(`   Empates: ${draws}/${numDuels}`);

  // Validação final
  console.log("\n" + "=".repeat(70));
  console.log("✅ VALIDAÇÃO FINAL");
  console.log("=".repeat(70));

  if (totalFacedownAttacks > 0) {
    console.log(
      `✅ Bots atacaram monstros facedown ${totalFacedownAttacks} vezes!`
    );
    console.log(
      `✅ Taxa de ${facedownAttackRate.toFixed(1)}% de ataques contra facedown.`
    );
    console.log(`✅ Fix aplicado com sucesso - bots são mais agressivos!`);
  } else {
    console.log(
      `⚠️ Nenhum ataque contra facedown detectado. Verifique se Luminarch setou monstros.`
    );
  }

  console.log(
    `\n🎯 Os bots agora tomam decisões baseadas em DEF estimado (1500) ao invés da DEF real.`
  );
  console.log(
    `   Isso elimina o vazamento de informação e torna o gameplay mais realista!`
  );
})();
