/**
 * run-arena-batch.js
 *
 * Script para rodar batches de duelos no Bot Arena e exportar métricas.
 * Útil para validar otimizações em escala.
 *
 * USO:
 *   node run-arena-batch.js [bot1] [bot2] [duels] [speed]
 *
 * EXEMPLOS:
 *   node run-arena-batch.js shadowheart luminarch 50 1x
 *   node run-arena-batch.js shadowheart shadowheart 20 instant
 */

import BotArena from "./src/core/BotArena.js";
import Game from "./src/core/Game.js";
import Bot from "./src/core/Bot.js";

// ─────────────────────────────────────────────────────────────────────────────
// Configuração
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const bot1Preset = args[0] || "shadowheart";
const bot2Preset = args[1] || "luminarch";
const numDuels = parseInt(args[2], 10) || 20;
const speed = args[3] || "1x";

console.log("🎮 BOT ARENA - BATCH TEST\n");
console.log("═".repeat(60));
console.log(`Bot 1: ${bot1Preset}`);
console.log(`Bot 2: ${bot2Preset}`);
console.log(`Duelos: ${numDuels}`);
console.log(`Velocidade: ${speed}`);
console.log("═".repeat(60) + "\n");

// ─────────────────────────────────────────────────────────────────────────────
// Setup Arena
// ─────────────────────────────────────────────────────────────────────────────

const arena = new BotArena(Game, Bot);

// Configuração opcional (descomente para customizar)
// arena.setCustomTimeout(45000); // 45s timeout
// arena.setSearchParams({ beamWidth: 3, maxDepth: 2 });

// ─────────────────────────────────────────────────────────────────────────────
// Callbacks
// ─────────────────────────────────────────────────────────────────────────────

let lastUpdate = Date.now();
const updateInterval = 2000; // Log a cada 2s

function onProgress(progress) {
  const now = Date.now();
  if (now - lastUpdate < updateInterval && progress.completed < numDuels) {
    return; // Throttle updates
  }
  lastUpdate = now;

  const {
    completed,
    wins1,
    wins2,
    draws,
    drawsByTimeout,
    drawsByMaxTurns,
    avgTurns,
    lastResult,
  } = progress;

  const pct = ((completed / numDuels) * 100).toFixed(0);
  const winRate1 = completed > 0 ? ((wins1 / completed) * 100).toFixed(1) : 0;
  const winRate2 = completed > 0 ? ((wins2 / completed) * 100).toFixed(1) : 0;
  const drawRate = completed > 0 ? ((draws / completed) * 100).toFixed(1) : 0;

  console.log(
    `\n[${"█".repeat(Math.floor(pct / 5))}${" ".repeat(
      20 - Math.floor(pct / 5)
    )}] ${pct}%`
  );
  console.log(`Duelo ${completed}/${numDuels}`);
  console.log(`  Bot 1: ${wins1} vitórias (${winRate1}%)`);
  console.log(`  Bot 2: ${wins2} vitórias (${winRate2}%)`);
  console.log(
    `  Empates: ${draws} (${drawRate}%) - Timeout: ${drawsByTimeout}, MaxTurns: ${drawsByMaxTurns}`
  );
  console.log(`  Turnos médios: ${avgTurns}`);

  if (lastResult) {
    const icon =
      lastResult.winner === "player"
        ? "🥇"
        : lastResult.winner === "bot"
        ? "🥈"
        : "⚖️";
    console.log(
      `  Último: ${icon} Turno ${lastResult.turns} (${
        lastResult.reason || "LP_ZERO"
      })`
    );
  }
}

function onComplete(final) {
  console.log("\n" + "═".repeat(60));
  console.log("🏁 BATCH COMPLETO\n");

  const {
    completed,
    wins1,
    wins2,
    draws,
    drawsByTimeout,
    drawsByMaxTurns,
    avgTurns,
    avgDecisionTimeMs,
    batchDurationMs,
    endReasonBreakdown,
  } = final;

  const winRate1 = completed > 0 ? ((wins1 / completed) * 100).toFixed(1) : 0;
  const winRate2 = completed > 0 ? ((wins2 / completed) * 100).toFixed(1) : 0;
  const drawRate = completed > 0 ? ((draws / completed) * 100).toFixed(1) : 0;

  console.log("📊 RESULTADOS FINAIS");
  console.log("-".repeat(60));
  console.log(`Total de duelos: ${completed}`);
  console.log(`Bot 1 (${bot1Preset}): ${wins1} vitórias (${winRate1}%)`);
  console.log(`Bot 2 (${bot2Preset}): ${wins2} vitórias (${winRate2}%)`);
  console.log(`Empates: ${draws} (${drawRate}%)`);
  console.log(`  - Por timeout: ${drawsByTimeout}`);
  console.log(`  - Por max_turns: ${drawsByMaxTurns}`);
  console.log(`\nTurnos médios: ${avgTurns}`);

  if (avgDecisionTimeMs != null) {
    console.log(`Tempo de decisão médio: ${avgDecisionTimeMs.toFixed(1)}ms`);
  }

  if (batchDurationMs != null) {
    const durationSec = (batchDurationMs / 1000).toFixed(1);
    const avgDuelTime = (batchDurationMs / completed / 1000).toFixed(1);
    console.log(`Duração total: ${durationSec}s (${avgDuelTime}s por duelo)`);
  }

  if (endReasonBreakdown && Object.keys(endReasonBreakdown).length > 0) {
    console.log("\n📋 CATEGORIZAÇÃO DE FINAIS:");
    for (const [reason, count] of Object.entries(endReasonBreakdown)) {
      const pct = ((count / completed) * 100).toFixed(1);
      console.log(`  ${reason}: ${count} (${pct}%)`);
    }
  }

  console.log("\n💾 EXPORTANDO RESULTADOS...");

  // Exportar CSV
  try {
    arena.downloadCSV(`arena_${bot1Preset}_vs_${bot2Preset}_${Date.now()}.csv`);
    console.log("  ✅ CSV exportado");
  } catch (err) {
    console.log("  ⚠️  CSV export falhou (ambiente sem browser?)");
  }

  // Exportar JSONL para stdout (pode redirecionar para arquivo)
  console.log("\n📄 JSONL (primeiros 5 duelos):");
  const jsonl = arena.exportJSONL();
  const lines = jsonl.split("\n").slice(0, 5);
  lines.forEach((line) => {
    if (line.trim()) {
      const data = JSON.parse(line);
      console.log(
        `  Duelo ${data.duelNumber}: ${data.winner} (${data.turns} turnos, ${data.endReason})`
      );
    }
  });

  console.log("\n═".repeat(60));
  console.log("✨ Batch finalizado!\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Executar
// ─────────────────────────────────────────────────────────────────────────────

arena.startArena(
  bot1Preset,
  bot2Preset,
  numDuels,
  speed,
  false, // Auto-pause em erro
  onProgress,
  onComplete
);
