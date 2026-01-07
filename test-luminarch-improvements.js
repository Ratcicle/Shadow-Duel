// test-luminarch-improvements.js — Teste focado nas melhorias da IA Luminarch

import { detectAvailableCombos, canAttemptLethal, shouldPrioritizeDefense, shouldTurtleStrategy } from "./src/core/ai/luminarch/combos.js";
import { shouldPlaySpell, shouldSummonMonster } from "./src/core/ai/luminarch/priorities.js";

console.log("🎮 Teste de Melhorias - IA Luminarch\n");
console.log("═══════════════════════════════════════════════════════════════\n");

// ═════════════════════════════════════════════════════════════════════════
// TEST 1: Combo Detection (Early Game)
// ═════════════════════════════════════════════════════════════════════════
console.log("📋 TEST 1: Early Game Combo Detection");
console.log("─────────────────────────────────────────────────────────────\n");

const t1Analysis = {
  hand: [
    { name: "Luminarch Valiant - Knight of the Dawn", cardKind: "monster", level: 4 },
    { name: "Sanctum of the Luminarch Citadel", cardKind: "spell" },
    { name: "Luminarch Holy Shield", cardKind: "spell" },
  ],
  field: [],
  fieldSpell: null,
  graveyard: [],
  extraDeck: [],
  lp: 8000,
  oppField: [],
  oppLp: 8000,
  currentTurn: 1,
};

const t1Combos = detectAvailableCombos(t1Analysis);
console.log(`Combos detectados (Turn 1): ${t1Combos.length}`);
t1Combos.forEach((combo, i) => {
  console.log(`  ${i+1}. ${combo.name} (priority ${combo.priority})`);
  console.log(`     ${combo.description}`);
});
console.log();

// ═════════════════════════════════════════════════════════════════════════
// TEST 2: Summon Priorities (Avoid Suicide)
// ═════════════════════════════════════════════════════════════════════════
console.log("📋 TEST 2: Summon Decision Logic");
console.log("─────────────────────────────────────────────────────────────\n");

const marshalCard = {
  name: "Luminarch Celestial Marshal",
  cardKind: "monster",
  atk: 2500,
  def: 2300,
  level: 5,
};

// Cenário 1: Oponente tem 2800 ATK monster, sem tank
const suicideAnalysis = {
  hand: [],
  field: [],
  fieldSpell: null,
  graveyard: [],
  lp: 8000,
  oppField: [{ name: "Shadow-Heart Demon Dragon", atk: 3500, cardKind: "monster" }],
  oppLp: 8000,
  currentTurn: 2,
};

const marshalDecision = shouldSummonMonster(marshalCard, suicideAnalysis);
console.log("Cenário: Oponente com 3500 ATK, sem tank próprio");
console.log(`  Decisão: ${marshalDecision.yes ? "✅ SUMMON" : "❌ BLOCK"}`);
console.log(`  Razão: ${marshalDecision.reason}`);
console.log();

// Cenário 2: Com tank ativo
const safeAnalysis = {
  ...suicideAnalysis,
  field: [{ name: "Luminarch Aegisbearer", def: 2500, cardKind: "monster" }],
};
const marshalDecision2 = shouldSummonMonster(marshalCard, safeAnalysis);
console.log("Cenário: Oponente com 3500 ATK, MAS tenho Aegisbearer tank");
console.log(`  Decisão: ${marshalDecision2.yes ? "✅ SUMMON" : "❌ BLOCK"}`);
console.log(`  Razão: ${marshalDecision2.reason}`);
console.log();

// ═════════════════════════════════════════════════════════════════════════
// TEST 3: LP Management (Holy Ascension)
// ═════════════════════════════════════════════════════════════════════════
console.log("📋 TEST 3: LP Cost Management");
console.log("─────────────────────────────────────────────────────────────\n");

const holyAscension = {
  name: "Luminarch Holy Ascension",
  cardKind: "spell",
};

// Cenário 1: LP baixo (3000)
const lowLpAnalysis = {
  hand: [],
  field: [
    { name: "Luminarch Valiant - Knight of the Dawn", atk: 1900, cardKind: "monster" },
  ],
  fieldSpell: { name: "Sanctum of the Luminarch Citadel" },
  graveyard: [],
  lp: 3000,
  oppField: [],
  oppLp: 2500,
};

const holyDecision1 = shouldPlaySpell(holyAscension, lowLpAnalysis);
console.log("Cenário: LP 3000, Opp LP 2500 (potencial lethal com buff)");
console.log(`  Decisão: ${holyDecision1.yes ? "✅ USE" : "❌ SAVE LP"}`);
console.log(`  Razão: ${holyDecision1.reason}`);
console.log();

// Cenário 2: LP alto, sem lethal
const highLpAnalysis = {
  ...lowLpAnalysis,
  lp: 6000,
  oppLp: 7000,
};

const holyDecision2 = shouldPlaySpell(holyAscension, highLpAnalysis);
console.log("Cenário: LP 6000, Opp LP 7000 (sem lethal)");
console.log(`  Decisão: ${holyDecision2.yes ? "✅ USE" : "❌ SAVE LP"}`);
console.log(`  Razão: ${holyDecision2.reason}`);
console.log();

// ═════════════════════════════════════════════════════════════════════════
// TEST 4: Win Condition Analysis
// ═════════════════════════════════════════════════════════════════════════
console.log("📋 TEST 4: Win Condition Detection");
console.log("─────────────────────────────────────────────────────────────\n");

// Cenário 1: Lethal opportunity
const lethalAnalysis = {
  hand: [],
  field: [
    { name: "Luminarch Celestial Marshal", atk: 2500, position: "attack", cardKind: "monster" },
    { name: "Luminarch Valiant - Knight of the Dawn", atk: 1900, position: "attack", cardKind: "monster" },
  ],
  fieldSpell: null,
  graveyard: [],
  lp: 5000,
  oppField: [],
  oppLp: 4000,
};

const canLethal = canAttemptLethal(lethalAnalysis);
console.log("Cenário: 2500+1900 ATK vs 4000 LP oponente, sem defesa");
console.log(`  Lethal possível: ${canLethal ? "✅ YES" : "❌ NO"}`);
console.log();

// Cenário 2: Turtle strategy
const turtleAnalysis = {
  hand: [{ name: "Luminarch Holy Shield", cardKind: "spell" }],
  field: [
    { name: "Luminarch Aegisbearer", def: 2500, position: "defense", cardKind: "monster" },
  ],
  fieldSpell: { name: "Sanctum of the Luminarch Citadel" },
  graveyard: [],
  lp: 2500,
  oppField: [
    { name: "Shadow-Heart Demon Dragon", atk: 3500, cardKind: "monster" },
    { name: "Shadow-Heart Scale Dragon", atk: 3000, cardKind: "monster" },
  ],
  oppLp: 8000,
};

const turtleDecision = shouldTurtleStrategy(turtleAnalysis);
console.log("Cenário: LP 2500, opp 6500 ATK board, tenho Aegis+Citadel+Holy Shield");
console.log(`  Turtle Mode: ${turtleDecision.shouldTurtle ? "✅ ACTIVATE" : "❌ NO"}`);
console.log(`  Razão: ${turtleDecision.reason}`);
console.log();

// Cenário 3: Defense priority
const shouldDefend = shouldPrioritizeDefense(turtleAnalysis);
console.log("Cenário: LP 2500, opp 6500 ATK board");
console.log(`  Priorizar defesa: ${shouldDefend ? "✅ YES" : "❌ NO"}`);
console.log();

// ═════════════════════════════════════════════════════════════════════════
// TEST 5: Valiant vs Arbiter Priority (Turn 1)
// ═════════════════════════════════════════════════════════════════════════
console.log("📋 TEST 5: Turn 1 Opener Priority");
console.log("─────────────────────────────────────────────────────────────\n");

const valiant = {
  name: "Luminarch Valiant - Knight of the Dawn",
  cardKind: "monster",
  level: 4,
};

const arbiter = {
  name: "Luminarch Sanctified Arbiter",
  cardKind: "monster",
  level: 4,
};

const t1OpenerAnalysis = {
  hand: [valiant, arbiter],
  field: [],
  fieldSpell: null,
  graveyard: [],
  lp: 8000,
  oppField: [],
  oppLp: 8000,
  currentTurn: 1,
};

const valiantDecision = shouldSummonMonster(valiant, t1OpenerAnalysis);
const arbiterDecision = shouldSummonMonster(arbiter, t1OpenerAnalysis);

console.log("Situação: Turn 1, sem field spell, tenho Valiant e Arbiter");
console.log(`  Valiant: ${valiantDecision.yes ? "✅" : "❌"} (priority ${valiantDecision.priority || 0}) - ${valiantDecision.reason}`);
console.log(`  Arbiter: ${arbiterDecision.yes ? "✅" : "❌"} (priority ${arbiterDecision.priority || 0}) - ${arbiterDecision.reason}`);
console.log();

console.log("═══════════════════════════════════════════════════════════════");
console.log("✅ Teste de Melhorias Completo!");
console.log("═══════════════════════════════════════════════════════════════\n");
