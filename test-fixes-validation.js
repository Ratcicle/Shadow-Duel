import { Game } from "./src/core/Game.js";
import { createUIAdapter } from "./src/core/UIAdapter.js";

async function runTestDuel() {
  console.log("🧪 Test: Validating Bot 1 Action Execution Fixes\n");

  // Create mock renderer with all required methods
  const mockRenderer = {
    renderHand() {},
    renderField() {},
    renderFieldSpell() {},
    renderSpellTrap() {},
    updateLP() {},
    updatePhaseTrack() {},
    updateTurn() {},
    updateGYPreview() {},
    updateExtraDeckPreview() {},
    updateActivationIndicators() {},
    updateAttackIndicators() {},
    bindPhaseClick() {},
    bindCardInteractions() {},
    bindCardHover() {},
    bindMonsterClick() {},
    bindSpellTrapClick() {},
    bindFieldSpellClick() {},
    bindGYClick() {},
    bindExtraDeckClick() {},
    showSelectionModal() {},
    showMultiSelectModal() {},
    showSearchModal() {},
    showMultiSelectModal() {},
    getSearchModalElements() { return null; },
    showSearchModalVisual() {},
    log(msg) {
      console.log(`  📝 ${msg}`);
    },
  };

  const game = new Game(createUIAdapter(mockRenderer));
  game.testModeEnabled = false;

  console.log("📦 Initializing game...");
  await game.start();

  console.log("\n✅ Game initialized successfully!");
  console.log(`   Phase: ${game.phase}`);
  console.log(`   Turn: ${game.turnNumber}`);
  console.log(`   Player Hand: ${game.player.hand.length}`);
  console.log(`   Bot Hand: ${game.bot.hand.length}`);
  console.log(`   Player Field: ${game.player.field.length}`);
  console.log(`   Bot Field: ${game.bot.field.length}`);

  if (game.phase === "main1") {
    console.log("\n✅ PHASE PROGRESSION FIX VERIFIED: Phase reached main1 correctly!");
  } else {
    console.log(
      `\n❌ PHASE PROGRESSION ISSUE: Phase is ${game.phase}, expected main1`
    );
  }

  console.log("\n✅ Test Complete - Ready for BotArena validation");
}

runTestDuel().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
