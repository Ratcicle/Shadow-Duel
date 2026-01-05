/**
 * test-ai-p0-validation.js
 * Validação rápida: P0 é carregável e não quebra na inicialização?
 */

import Game from "./src/core/Game.js";
import Bot from "./src/core/Bot.js";
import * as RoleAnalyzer from "./src/core/ai/RoleAnalyzer.js";
import * as ThreatEvaluation from "./src/core/ai/ThreatEvaluation.js";

const MOCK_RENDERER = new Proxy({}, { get: () => () => {} });

async function validateP0Components() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  P0 VALIDATION — Checking if components exist and load");
  console.log("═══════════════════════════════════════════════════════\n");

  let passed = 0;
  let failed = 0;

  // Test 1: Game creation
  try {
    const game = new Game({ renderer: MOCK_RENDERER });
    if (game.effectEngine && game.chainSystem) {
      console.log("✅ [1/5] Game initialization: PASS");
      passed++;
    } else {
      console.log("❌ [1/5] Game initialization: FAIL (missing subsystems)");
      failed++;
    }
  } catch (err) {
    console.log(`❌ [1/5] Game initialization: FAIL (${err.message})`);
    failed++;
  }

  // Test 2: Bot creation with strategy
  try {
    const bot = new Bot("shadowheart");
    if (bot.strategy && bot.playMainPhase) {
      console.log("✅ [2/5] Bot creation: PASS");
      passed++;
    } else {
      console.log("❌ [2/5] Bot creation: FAIL (missing strategy/method)");
      failed++;
    }
  } catch (err) {
    console.log(`❌ [2/5] Bot creation: FAIL (${err.message})`);
    failed++;
  }

  // Test 3: RoleAnalyzer exists
  try {
    if (RoleAnalyzer && RoleAnalyzer.inferRole) {
      console.log("✅ [3/5] RoleAnalyzer module: PASS");
      passed++;
    } else {
      console.log("❌ [3/5] RoleAnalyzer module: FAIL (not found)");
      failed++;
    }
  } catch (err) {
    console.log(`❌ [3/5] RoleAnalyzer module: FAIL (${err.message})`);
    failed++;
  }

  // Test 4: ThreatEvaluation exists
  try {
    if (ThreatEvaluation && ThreatEvaluation.calculateThreatScore) {
      console.log("✅ [4/5] ThreatEvaluation module: PASS");
      passed++;
    } else {
      console.log("❌ [4/5] ThreatEvaluation module: FAIL (not found)");
      failed++;
    }
  } catch (err) {
    console.log(`❌ [4/5] ThreatEvaluation module: FAIL (${err.message})`);
    failed++;
  }

  // Test 5: Bot has evaluateBoardV2
  try {
    const bot = new Bot("shadowheart");
    if (typeof bot.evaluateBoardV2 === "function") {
      console.log("✅ [5/5] evaluateBoardV2 method: PASS");
      passed++;
    } else {
      console.log("❌ [5/5] evaluateBoardV2 method: FAIL (not found)");
      failed++;
    }
  } catch (err) {
    console.log(`❌ [5/5] evaluateBoardV2 method: FAIL (${err.message})`);
    failed++;
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════════");

  if (failed === 0) {
    console.log(
      "\n✅ P0 IMPLEMENTATION VALIDATED — All core components present"
    );
    console.log("   Note: Full duel tests need infinite-loop protection");
  } else {
    console.log("\n❌ P0 VALIDATION FAILED — Check implementation");
    process.exit(1);
  }
}

await validateP0Components();
