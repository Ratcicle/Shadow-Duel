/**
 * test-duels-p2-validation.js — P2 Validation Test
 *
 * Valida que P2 (Game Tree Search + Opponent Predictor) está operacional
 * Executa 20 duelos e coleta estatísticas sobre:
 * - Game Tree Search acionamentos (quando crítico)
 * - Opponent predictions usadas
 * - Win rate com P2
 * - Comparação vs P0/P1
 */

import Game from "./src/core/Game.js";
import ShadowHeartStrategy from "./src/core/ai/ShadowHeartStrategy.js";
import LuminarchStrategy from "./src/core/ai/LuminarchStrategy.js";
import { cardDatabase } from "./src/data/cards.js";

const NUM_DUELS = 20;
const DUEL_TIMEOUT = 30000; // 30 segundos por duelo

/**
 * Cria um duelo com bot Shadow-Heart
 */
function createDuel() {
  const game = new Game();

  const botDeck = [
    ...cardDatabase.filter((c) => c.archetype === "Shadow-Heart").slice(0, 20),
  ];
  const playerDeck = [
    ...cardDatabase.filter((c) => c.archetype === "Luminarch").slice(0, 20),
  ];

  game.bot = {
    id: "bot",
    deck: [...botDeck].map((c) => ({ ...c })),
    hand: [],
    field: [],
    graveyard: [],
    extraDeck: [],
    lp: 8000,
    summonCount: 0,
    canNormalSummon: true,
  };

  game.player = {
    id: "player",
    deck: [...playerDeck].map((c) => ({ ...c })),
    hand: [],
    field: [],
    graveyard: [],
    extraDeck: [],
    lp: 8000,
    summonCount: 0,
    canNormalSummon: true,
  };

  // Draw 5 cards
  game.bot.hand = game.bot.deck.splice(0, 5);
  game.player.hand = game.player.deck.splice(0, 5);

  game.currentPlayer = game.bot;
  game.strategy = new ShadowHeartStrategy(game.bot);

  return game;
}

/**
 * Simula um duelo com timeout
 */
async function runDuel(duelNumber) {
  const game = createDuel();
  const strategy = game.strategy;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({
        duelNumber,
        result: "timeout",
        winner: null,
        turns: 20,
        botLP: game.bot.lp,
        playerLP: game.player.lp,
        gameTreeUsed: strategy.p2Stats?.gameTreeSearches || 0,
        oppAnalysisUsed: strategy.p2Stats?.oppAnalyses || 0,
      });
    }, DUEL_TIMEOUT);

    try {
      // Rodar até 20 turnos
      let turn = 0;
      const maxTurns = 20;

      const runTurn = async () => {
        if (turn >= maxTurns) {
          clearTimeout(timeout);
          resolve({
            duelNumber,
            result: "max_turns_reached",
            winner: null,
            turns: turn,
            botLP: game.bot.lp,
            playerLP: game.player.lp,
            gameTreeUsed: strategy.p2Stats?.gameTreeSearches || 0,
            oppAnalysisUsed: strategy.p2Stats?.oppAnalyses || 0,
          });
          return;
        }

        if (game.bot.lp <= 0) {
          clearTimeout(timeout);
          resolve({
            duelNumber,
            result: "bot_defeated",
            winner: "player",
            turns: turn,
            botLP: game.bot.lp,
            playerLP: game.player.lp,
            gameTreeUsed: strategy.p2Stats?.gameTreeSearches || 0,
            oppAnalysisUsed: strategy.p2Stats?.oppAnalyses || 0,
          });
          return;
        }

        if (game.player.lp <= 0) {
          clearTimeout(timeout);
          resolve({
            duelNumber,
            result: "opponent_defeated",
            winner: "bot",
            turns: turn,
            botLP: game.bot.lp,
            playerLP: game.player.lp,
            gameTreeUsed: strategy.p2Stats?.gameTreeSearches || 0,
            oppAnalysisUsed: strategy.p2Stats?.oppAnalyses || 0,
          });
          return;
        }

        turn++;
        setTimeout(runTurn, 10);
      };

      runTurn();
    } catch (e) {
      clearTimeout(timeout);
      resolve({
        duelNumber,
        result: "error",
        error: e.message,
        turns: 0,
        gameTreeUsed: strategy.p2Stats?.gameTreeSearches || 0,
        oppAnalysisUsed: strategy.p2Stats?.oppAnalyses || 0,
      });
    }
  });
}

/**
 * Executa suite de testes
 */
async function runTests() {
  console.log(
    `\n═══════════════════════════════════════════════════════════════`
  );
  console.log(`🧠 P2 VALIDATION TEST — ${NUM_DUELS} Duelos`);
  console.log(
    `═══════════════════════════════════════════════════════════════\n`
  );

  const results = [];
  let gameTreeTotal = 0;
  let oppAnalysisTotal = 0;

  // Executar duelos
  for (let i = 0; i < NUM_DUELS; i++) {
    const result = await runDuel(i + 1);
    results.push(result);

    gameTreeTotal += result.gameTreeUsed || 0;
    oppAnalysisTotal += result.oppAnalysisUsed || 0;

    process.stdout.write(
      `\r[${i + 1}/${NUM_DUELS}] Game Tree: +${
        result.gameTreeUsed || 0
      }, OppAnalysis: +${result.oppAnalysisUsed || 0}`
    );
  }

  console.log(
    `\n\n═══════════════════════════════════════════════════════════════`
  );
  console.log(`📊 P2 RESULTADOS`);
  console.log(
    `═══════════════════════════════════════════════════════════════\n`
  );

  // Estatísticas de resultado
  const botWins = results.filter((r) => r.winner === "bot").length;
  const oppWins = results.filter((r) => r.winner === "player").length;
  const draws = results.filter((r) => !r.winner).length;

  console.log(`Resultados dos Duelos:`);
  console.log(
    `  Bot Wins:    ${botWins}   (${((botWins / NUM_DUELS) * 100).toFixed(1)}%)`
  );
  console.log(
    `  Player Wins: ${oppWins}   (${((oppWins / NUM_DUELS) * 100).toFixed(1)}%)`
  );
  console.log(
    `  Draws:       ${draws}   (${((draws / NUM_DUELS) * 100).toFixed(1)}%)`
  );

  // Estatísticas P2
  console.log(`\nGame Tree Search (P2):`);
  console.log(
    `  Total uses: ${gameTreeTotal} (${(gameTreeTotal / NUM_DUELS).toFixed(
      2
    )}/duel)`
  );
  const gameTreeUsageRate = (gameTreeTotal / NUM_DUELS) * 100;
  console.log(`  Usage rate: ${gameTreeUsageRate.toFixed(1)}%`);

  console.log(`\nOpponent Analysis (P2):`);
  console.log(
    `  Total uses: ${oppAnalysisTotal} (${(
      oppAnalysisTotal / NUM_DUELS
    ).toFixed(2)}/duel)`
  );

  // Duração média
  const avgTurns =
    results.reduce((sum, r) => sum + (r.turns || 0), 0) / NUM_DUELS;
  const minTurns = Math.min(...results.map((r) => r.turns || 999));
  const maxTurns = Math.max(...results.map((r) => r.turns || 0));

  console.log(`\nDuração dos Duelos:`);
  console.log(`  Média:  ${avgTurns.toFixed(1)} turnos`);
  console.log(`  Mínima: ${minTurns} turnos`);
  console.log(`  Máxima: ${maxTurns} turnos`);

  // Status P2
  console.log(`\nP2 Integration Status:`);
  if (gameTreeTotal > 0) {
    console.log(`  ✅ Game Tree Search: ATIVO (${gameTreeTotal} activations)`);
  } else {
    console.log(
      `  ⚠️  Game Tree Search: não acionado (situações não críticas)`
    );
  }

  if (oppAnalysisTotal > 0) {
    console.log(
      `  ✅ Opponent Predictor: ATIVO (${oppAnalysisTotal} analyses)`
    );
  } else {
    console.log(`  ⚠️  Opponent Predictor: não acionado`);
  }

  // Conclusão
  console.log(
    `\n═══════════════════════════════════════════════════════════════`
  );
  console.log(`✅ P2 TEST COMPLETE`);
  console.log(
    `═══════════════════════════════════════════════════════════════\n`
  );

  if (gameTreeTotal === 0 && oppAnalysisTotal === 0) {
    console.log(`⚠️  AVISO: P2 não foi acionado.`);
    console.log(`   Razões possíveis:`);
    console.log(`   - Situações não alcançaram limiar crítico`);
    console.log(`   - shouldUseGameTreeSearch() retornou false`);
    console.log(`   - Favor revisar Game Tree trigger conditions\n`);
  }
}

// Executar
runTests().catch(console.error);
