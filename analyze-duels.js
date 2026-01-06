/**
 * Script para analisar os resultados dos duelos do Bot Arena
 * Extrai estatísticas dos logs
 */

import fs from "fs";

const logPath = "./Log duelos.txt";
const logContent = fs.readFileSync(logPath, "utf-8");

// Regex para encontrar resultados dos duelos
const duelRegex = /🏆 DUELO #(\d+) FINALIZADO - (Bot 1|Bot 2) venceu!\s*[\n\s]*Turnos: (\d+) \| LP Final: (\d+) vs (\d+)/g;

const duels = [];
let match;

while ((match = duelRegex.exec(logContent)) !== null) {
  const duelNum = parseInt(match[1]);
  const winner = match[2];
  const turns = parseInt(match[3]);
  const bot1LP = parseInt(match[4]);
  const bot2LP = parseInt(match[5]);

  duels.push({
    duelNum,
    winner,
    turns,
    bot1LP,
    bot2LP,
    bot1Won: winner === "Bot 1",
  });
}

console.log("\n╔════════════════════════════════════════════╗");
console.log("║     ANÁLISE DE 50 DUELOS - SHADOWHEART    ║");
console.log("╚════════════════════════════════════════════╝\n");

// Estatísticas gerais
const bot1Wins = duels.filter((d) => d.bot1Won).length;
const bot2Wins = duels.filter((d) => !d.bot1Won).length;
const totalDuels = duels.length;

console.log(`📊 PLACAR GERAL`);
console.log(`   Bot 1: ${bot1Wins}W - ${bot2Wins}L (${((bot1Wins / totalDuels) * 100).toFixed(1)}% Win Rate)`);
console.log(`   Bot 2: ${bot2Wins}W - ${bot1Wins}L (${((bot2Wins / totalDuels) * 100).toFixed(1)}% Win Rate)\n`);

// Turnos médios
const avgTurns = (duels.reduce((sum, d) => sum + d.turns, 0) / totalDuels).toFixed(1);
const minTurns = Math.min(...duels.map((d) => d.turns));
const maxTurns = Math.max(...duels.map((d) => d.turns));

console.log(`⏱️  TURNOS`);
console.log(`   Média: ${avgTurns} turnos`);
console.log(`   Mínimo: ${minTurns} turnos (Duel #${duels.find((d) => d.turns === minTurns).duelNum})`);
console.log(`   Máximo: ${maxTurns} turnos (Duel #${duels.find((d) => d.turns === maxTurns).duelNum})\n`);

// Vitórias por turno
console.log(`🎯 VITÓRIAS POR TURNO`);
const turnsDistribution = {};
duels.forEach((d) => {
  if (!turnsDistribution[d.turns]) turnsDistribution[d.turns] = { bot1: 0, bot2: 0 };
  if (d.bot1Won) turnsDistribution[d.turns].bot1++;
  else turnsDistribution[d.turns].bot2++;
});

Object.keys(turnsDistribution)
  .sort((a, b) => parseInt(a) - parseInt(b))
  .forEach((t) => {
    const b1 = turnsDistribution[t].bot1;
    const b2 = turnsDistribution[t].bot2;
    const total = b1 + b2;
    console.log(`   T${t}: ${total} duelos (Bot1: ${b1}, Bot2: ${b2})`);
  });

// Análise de dureza
console.log(`\n💪 ANÁLISE DE DUREZA (LP Final)`);
const bot1AvgLPWin = (
  duels
    .filter((d) => d.bot1Won)
    .reduce((sum, d) => sum + d.bot1LP, 0) / bot1Wins
).toFixed(0);
const bot2AvgLPWin = (
  duels
    .filter((d) => !d.bot1Won)
    .reduce((sum, d) => sum + d.bot2LP, 0) / bot2Wins
).toFixed(0);

console.log(
  `   Bot 1 (quando vence): LP médio = ${bot1AvgLPWin} (de 8000)`
);
console.log(
  `   Bot 2 (quando vence): LP médio = ${bot2AvgLPWin} (de 8000)`
);

// Duelos mais "apertados" (vitórias com pouco LP)
console.log(`\n🔥 VITÓRIAS MAIS APERTADAS`);
const tightVictories = duels.sort((a, b) => {
  const aLP = a.bot1Won ? a.bot1LP : a.bot2LP;
  const bLP = b.bot1Won ? b.bot1LP : b.bot2LP;
  return aLP - bLP;
});

tightVictories.slice(0, 5).forEach((d) => {
  const lp = d.bot1Won ? d.bot1LP : d.bot2LP;
  console.log(`   Duel #${d.duelNum}: ${d.winner} venceu com ${lp} LP em ${d.turns} turnos`);
});

// Duelos mais dominantes
console.log(`\n💥 VITÓRIAS MAIS DOMINANTES`);
const dominantVictories = duels.sort((a, b) => {
  const aLP = a.bot1Won ? a.bot1LP : a.bot2LP;
  const bLP = b.bot1Won ? b.bot1LP : b.bot2LP;
  return bLP - aLP;
});

dominantVictories.slice(0, 5).forEach((d) => {
  const winnerLP = d.bot1Won ? d.bot1LP : d.bot2LP;
  const loserLP = d.bot1Won ? d.bot2LP : d.bot1LP;
  console.log(
    `   Duel #${d.duelNum}: ${d.winner} venceu com ${winnerLP} LP vs ${loserLP} LP em ${d.turns} turnos`
  );
});

// Resumo final
console.log(`\n📋 RESUMO`);
console.log(`   Total de duelos: ${totalDuels}`);
console.log(`   Arquétipo: Shadow-Heart vs Shadow-Heart`);
console.log(`   Nível de paridade: ${Math.abs(bot1Wins - bot2Wins) <= 5 ? "BALANCEADO ✓" : "DESBALANCEADO ✗"}`);
console.log(`\n`);
