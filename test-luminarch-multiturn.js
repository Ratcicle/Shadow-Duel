/**
 * Teste: Validar melhorias multi-turno na IA Luminarch
 */

import { evaluateGameStance, shouldCommitResourcesNow, planNextTurns } from "./src/core/ai/luminarch/multiTurnPlanning.js";
import { cardDatabaseById } from "./src/data/cards.js";

console.log("=".repeat(70));
console.log("TESTE: Planejamento Multi-Turno Luminarch");
console.log("=".repeat(70));

// ═════════════════════════════════════════════════════════════════════════════
// TESTE 1: Stance Detection (Turn 1 - Setup)
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n📊 Teste 1: Turn 1 - Setup Phase");
const analysis1 = {
  field: [],
  oppField: [],
  hand: [],
  graveyard: [],
  lp: 8000,
  oppLp: 8000,
  currentTurn: 1,
};

const stance1 = evaluateGameStance(analysis1);
console.log(`Stance: ${stance1.stance} - ${stance1.reason}`);
console.log(`✅ Esperado: "setup" - Got: ${stance1.stance === "setup" ? "✅ PASS" : "❌ FAIL"}`);

// ═════════════════════════════════════════════════════════════════════════════
// TESTE 2: Stance Detection (Oponente Forte - Defensive)
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n📊 Teste 2: Oponente Forte - Defensive Stance");
const analysis2 = {
  field: [],
  oppField: [
    { cardKind: "monster", atk: 2800, isFacedown: false },
    { cardKind: "monster", atk: 2500, isFacedown: false },
  ],
  hand: [],
  graveyard: [],
  lp: 8000,
  oppLp: 8000,
  currentTurn: 3,
};

const stance2 = evaluateGameStance(analysis2);
console.log(`Stance: ${stance2.stance} - ${stance2.reason}`);
console.log(`✅ Esperado: "defensive" - Got: ${stance2.stance === "defensive" ? "✅ PASS" : "❌ FAIL"}`);

// ═════════════════════════════════════════════════════════════════════════════
// TESTE 3: Stance Detection (Oponente Fraco - Aggressive)
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n📊 Teste 3: Oponente Fraco - Aggressive Stance");
const analysis3 = {
  field: [
    { cardKind: "monster", atk: 2500, def: 2000, isFacedown: false },
  ],
  oppField: [
    { cardKind: "monster", atk: 1600, isFacedown: false },
  ],
  hand: [],
  graveyard: [],
  lp: 8000,
  oppLp: 4000,
  currentTurn: 5,
};

const stance3 = evaluateGameStance(analysis3);
console.log(`Stance: ${stance3.stance} - ${stance3.reason}`);
console.log(`✅ Esperado: "aggressive" - Got: ${stance3.stance === "aggressive" ? "✅ PASS" : "❌ FAIL"}`);

// ═════════════════════════════════════════════════════════════════════════════
// TESTE 4: Resource Commitment - Citadel (Sempre Jogar)
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n📊 Teste 4: Resource Commitment - Citadel (Sempre Jogar)");
const citadelCard = cardDatabaseById.get(112); // Sanctum of the Luminarch Citadel
const analysis4 = {
  field: [],
  oppField: [],
  hand: [citadelCard],
  graveyard: [],
  lp: 8000,
  oppLp: 8000,
  currentTurn: 1,
  fieldSpell: null,
};
const stance4 = evaluateGameStance(analysis4);

const decision4 = shouldCommitResourcesNow(citadelCard, analysis4, stance4);
console.log(`Decision: ${decision4.shouldPlay} - ${decision4.reason}`);
console.log(`✅ Esperado: true (Citadel sempre) - Got: ${decision4.shouldPlay ? "✅ PASS" : "❌ FAIL"}`);

// ═════════════════════════════════════════════════════════════════════════════
// TESTE 5: Resource Commitment - Holy Ascension Defensive (Segurar)
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n📊 Teste 5: Resource Commitment - Holy Ascension (Defensive - Segurar)");
const holyAscensionCard = cardDatabaseById.get(113);
const analysis5 = {
  field: [
    { cardKind: "monster", atk: 1800, name: "Test Monster" },
  ],
  oppField: [
    { cardKind: "monster", atk: 2800, isFacedown: false },
  ],
  hand: [holyAscensionCard],
  graveyard: [],
  lp: 5000,
  oppLp: 8000,
  currentTurn: 4,
};
const stance5 = evaluateGameStance(analysis5);

const decision5 = shouldCommitResourcesNow(holyAscensionCard, analysis5, stance5);
console.log(`Stance: ${stance5.stance}`);
console.log(`Decision: ${decision5.shouldPlay} - ${decision5.reason}`);
console.log(`✅ Esperado: false (defensive - segurar buff) - Got: ${!decision5.shouldPlay ? "✅ PASS" : "❌ FAIL"}`);

// ═════════════════════════════════════════════════════════════════════════════
// TESTE 6: Resource Commitment - Holy Ascension Aggressive (Jogar)
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n📊 Teste 6: Resource Commitment - Holy Ascension (Aggressive - Jogar)");
const analysis6 = {
  field: [
    { cardKind: "monster", atk: 2200, name: "Test Beater", isFacedown: false },
  ],
  oppField: [
    { cardKind: "monster", atk: 1600, isFacedown: false },
  ],
  hand: [holyAscensionCard],
  graveyard: [],
  lp: 7000,
  oppLp: 3000,
  currentTurn: 6,
};
const stance6 = evaluateGameStance(analysis6);

const decision6 = shouldCommitResourcesNow(holyAscensionCard, analysis6, stance6);
console.log(`Stance: ${stance6.stance}`);
console.log(`Decision: ${decision6.shouldPlay} - ${decision6.reason}`);
console.log(`✅ Esperado: true (aggressive - usar buff) - Got: ${decision6.shouldPlay ? "✅ PASS" : "❌ FAIL"}`);

// ═════════════════════════════════════════════════════════════════════════════
// TESTE 7: Planning Next Turns
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n📊 Teste 7: Planning Next Turns");
const plan = planNextTurns(analysis1);
console.log(`Priority: ${plan.priority}`);
console.log(`Plan:`, plan.plan.slice(0, 2));
console.log(`✅ Plano gerado: ${plan.plan.length > 0 ? "✅ PASS" : "❌ FAIL"}`);

// ═════════════════════════════════════════════════════════════════════════════
// RESUMO
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n" + "=".repeat(70));
console.log("✅ CONCLUSÃO: Sistema de planejamento multi-turno implementado!");
console.log("=".repeat(70));
console.log("\n🎯 Melhorias implementadas:");
console.log("  ✅ evaluateGameStance() - Detecta postura (setup/defensive/aggressive/balanced)");
console.log("  ✅ shouldCommitResourcesNow() - Decide se gasta recursos agora ou segura");
console.log("  ✅ planNextTurns() - Cria plano de jogo para próximos turnos");
console.log("\n💡 Comportamento esperado:");
console.log("  • Turn 1-2: Prioriza field spell + searchers (setup)");
console.log("  • Oponente forte: Defesa em layers (tanks + proteção)");
console.log("  • Oponente fraco: Agressivo (buffs + remoção)");
console.log("  • Buffs caros: Segurar se defensivo, usar se agressivo");
console.log("  • Citadel: SEMPRE jogar primeiro (prioridade absoluta)");
