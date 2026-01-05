// ─────────────────────────────────────────────────────────────────────────────
// test-ai-p0.js
// Script de teste automatizado para P0 — roda duelos bot vs bot e coleta métricas
// ─────────────────────────────────────────────────────────────────────────────

import Game from "./src/core/Game.js";
import Bot from "./src/core/Bot.js";
import Player from "./src/core/Player.js";
import { cardDatabase } from "./src/data/cards.js";

// ═════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO
// ═════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  numDuels: 5, // Quantos duelos rodar (reduzido para debug)
  maxTurns: 15, // Limite de turnos por duelo (anti-loop)
  useV2Evaluation: true, // true = nova IA, false = antiga
  verbose: false, // true = log detalhado, false = só estatísticas finais
};

// ═════════════════════════════════════════════════════════════════════════════
// SETUP DO DUELO
// ═════════════════════════════════════════════════════════════════════════════

function createMockRenderer() {
  const noop = () => {};
  const asyncNoop = async () => null;

  return new Proxy(
    {},
    {
      get: () => noop, // Qualquer propriedade retorna função vazia
    }
  );
}

function createTestGame(useV2 = true) {
  try {
    // Cria 2 bots: Shadow-Heart vs Luminarch
    const bot1 = new Bot("shadowheart");
    const bot2 = new Bot("luminarch");

    // Override do player para ser um bot também
    const game = new Game({ renderer: createMockRenderer() });

    // Debug
    if (!game.effectEngine) {
      console.error("❌ effectEngine não foi criado!");
      console.log("Game keys:", Object.keys(game).slice(0, 10));
    }

    game.player = bot2;
    game.player.id = "player";
    game.bot = bot1;
    game.bot.id = "bot";

    // Força uso de evaluateBoardV2
    if (!useV2) {
      // Desabilita evaluateBoardV2 forçando fallback
      game.bot.evaluateBoardV2 = null;
      game.player.evaluateBoardV2 = null;
    }

    return game;
  } catch (error) {
    console.error("❌ Erro ao criar game:", error.message);
    console.error(error.stack);
    throw error;
  }
} // ═════════════════════════════════════════════════════════════════════════════
// DETECÇÃO DE BLUNDERS
// ═════════════════════════════════════════════════════════════════════════════

class BlunderDetector {
  constructor() {
    this.blunders = [];
  }

  /**
   * Detecta se o bot perdeu lethal (tinha dano suficiente mas não atacou).
   */
  checkMissedLethal(game, activePlayer) {
    const opponent = game.getOpponent(activePlayer);
    if (!opponent) return;

    const attackers = activePlayer.field.filter(
      (m) =>
        m &&
        m.cardKind === "monster" &&
        m.position === "attack" &&
        !m.hasAttacked &&
        !m.cannotAttackThisTurn
    );

    let totalDamage = 0;
    for (const attacker of attackers) {
      const atk = (attacker.atk || 0) + (attacker.tempAtkBoost || 0);
      const extraAttacks = attacker.extraAttacks || 0;
      totalDamage += atk * (1 + extraAttacks);
    }

    // Se tinha lethal e não usou
    if (totalDamage >= opponent.lp && opponent.field.length === 0) {
      this.blunders.push({
        type: "missed_lethal",
        player: activePlayer.id,
        turn: game.turnCounter,
        damage: totalDamage,
        oppLP: opponent.lp,
      });
    }
  }

  /**
   * Detecta overextend (campo cheio sem necessidade).
   */
  checkOverextend(game, activePlayer) {
    const opponent = game.getOpponent(activePlayer);
    if (!opponent) return;

    // Campo cheio (5 monstros) mas oponente tem poucos monstros
    if (
      activePlayer.field.length >= 5 &&
      opponent.field.length <= 1 &&
      activePlayer.hand.length >= 2
    ) {
      this.blunders.push({
        type: "overextend",
        player: activePlayer.id,
        turn: game.turnCounter,
        fieldSize: activePlayer.field.length,
        oppFieldSize: opponent.field.length,
      });
    }
  }

  /**
   * Detecta se o bot foi destruído facilmente por não ter defesas.
   */
  checkNoDefense(game, activePlayer) {
    const opponent = game.getOpponent(activePlayer);
    if (!opponent) return;

    // Player sem monstros, oponente com 3+ atacadores
    if (activePlayer.field.length === 0 && opponent.field.length >= 3) {
      this.blunders.push({
        type: "no_defense",
        player: activePlayer.id,
        turn: game.turnCounter,
        oppFieldSize: opponent.field.length,
      });
    }
  }

  getSummary() {
    const byType = {};
    for (const blunder of this.blunders) {
      byType[blunder.type] = (byType[blunder.type] || 0) + 1;
    }
    return {
      total: this.blunders.length,
      byType,
      details: this.blunders,
    };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SIMULADOR DE DUELO
// ═════════════════════════════════════════════════════════════════════════════

async function runSingleDuel(duelId, useV2) {
  const game = createTestGame(useV2);
  const detector = new BlunderDetector();

  // Inicializar jogo
  game.start();

  let winner = null;
  let turns = 0;
  const maxTurns = CONFIG.maxTurns;

  if (CONFIG.verbose) {
    console.log(`\n[Duel #${duelId}] Starting...`);
  }

  // Loop de turnos
  while (!game.gameOver && turns < maxTurns) {
    // Iniciar o turno
    await game.startTurn();

    const activePlayer = game.turn === "player" ? game.player : game.bot;
    turns++;

    if (CONFIG.verbose) {
      console.log(
        `  Turn ${turns} (${activePlayer.id}): ${activePlayer.lp} LP, ${activePlayer.field.length} monsters`
      );
    }

    // Detectar blunders ANTES das ações
    detector.checkMissedLethal(game, activePlayer);
    detector.checkOverextend(game, activePlayer);
    detector.checkNoDefense(game, activePlayer);

    // Esperar um pouco para que o makeMove termine (se não, será async)
    // O game.startTurn() já chama bot.makeMove() se for bot
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Checar vitória
    if (game.player.lp <= 0) {
      winner = "bot";
      game.gameOver = true;
    } else if (game.bot.lp <= 0) {
      winner = "player";
      game.gameOver = true;
    }

    // Se não terminou o jogo, encerrar o turno
    if (!game.gameOver) {
      game.endTurn();
    }
  }

  // Timeout = empate
  if (turns >= maxTurns && !winner) {
    winner = "draw";
  }

  if (CONFIG.verbose) {
    console.log(`[Duel #${duelId}] Winner: ${winner} after ${turns} turns`);
  }

  return {
    duelId,
    winner,
    turns,
    finalLP: {
      player: game.player.lp,
      bot: game.bot.lp,
    },
    finalField: {
      player: game.player.field.length,
      bot: game.bot.field.length,
    },
    blunders: detector.getSummary(),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// ESTATÍSTICAS
// ═════════════════════════════════════════════════════════════════════════════

function calculateStats(results) {
  const total = results.length;
  let botWins = 0;
  let playerWins = 0;
  let draws = 0;
  let totalTurns = 0;
  let totalBlunders = 0;
  const blundersByType = {};

  for (const result of results) {
    if (result.winner === "bot") botWins++;
    else if (result.winner === "player") playerWins++;
    else draws++;

    totalTurns += result.turns;
    totalBlunders += result.blunders.total;

    for (const [type, count] of Object.entries(result.blunders.byType)) {
      blundersByType[type] = (blundersByType[type] || 0) + count;
    }
  }

  return {
    total,
    botWins,
    playerWins,
    draws,
    winrate: {
      bot: ((botWins / total) * 100).toFixed(1) + "%",
      player: ((playerWins / total) * 100).toFixed(1) + "%",
      draw: ((draws / total) * 100).toFixed(1) + "%",
    },
    averageTurns: (totalTurns / total).toFixed(1),
    totalBlunders,
    blundersPerDuel: (totalBlunders / total).toFixed(2),
    blundersByType,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  SHADOW DUEL — AI P0 TEST SUITE");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(
    `  Config: ${CONFIG.numDuels} duels, max ${CONFIG.maxTurns} turns`
  );
  console.log(
    `  Evaluation: ${CONFIG.useV2Evaluation ? "V2 (NEW)" : "V1 (OLD)"}`
  );
  console.log("═══════════════════════════════════════════════════════════\n");

  const results = [];

  for (let i = 1; i <= CONFIG.numDuels; i++) {
    process.stdout.write(`\rRunning duel ${i}/${CONFIG.numDuels}...`);
    const result = await runSingleDuel(i, CONFIG.useV2Evaluation);
    results.push(result);
  }

  console.log(
    "\n\n═══════════════════════════════════════════════════════════"
  );
  console.log("  RESULTS");
  console.log("═══════════════════════════════════════════════════════════");

  const stats = calculateStats(results);

  console.log(`\nTotal duels:        ${stats.total}`);
  console.log(`Shadow-Heart wins:  ${stats.botWins} (${stats.winrate.bot})`);
  console.log(
    `Luminarch wins:     ${stats.playerWins} (${stats.winrate.player})`
  );
  console.log(`Draws:              ${stats.draws} (${stats.winrate.draw})`);
  console.log(`Average turns:      ${stats.averageTurns}`);
  console.log(`Total blunders:     ${stats.totalBlunders}`);
  console.log(`Blunders per duel:  ${stats.blundersPerDuel}`);

  if (Object.keys(stats.blundersByType).length > 0) {
    console.log("\nBlunders by type:");
    for (const [type, count] of Object.entries(stats.blundersByType)) {
      console.log(`  - ${type}: ${count}`);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  ANALYSIS");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Análise rápida
  const botWinrate = (stats.botWins / stats.total) * 100;
  const blundersPerDuel = parseFloat(stats.blundersPerDuel);

  if (botWinrate >= 60) {
    console.log("✓ Shadow-Heart winrate is GOOD (>= 60%)");
  } else if (botWinrate >= 50) {
    console.log("~ Shadow-Heart winrate is FAIR (50-60%)");
  } else {
    console.log("✗ Shadow-Heart winrate is LOW (< 50%)");
  }

  if (blundersPerDuel < 1.0) {
    console.log("✓ Blunders per duel is LOW (< 1.0)");
  } else if (blundersPerDuel < 2.0) {
    console.log("~ Blunders per duel is MODERATE (1.0-2.0)");
  } else {
    console.log("✗ Blunders per duel is HIGH (>= 2.0)");
  }

  console.log(
    "\n═══════════════════════════════════════════════════════════\n"
  );
}

// Run
main().catch((error) => {
  console.error("\nFATAL ERROR:", error);
  process.exit(1);
});
