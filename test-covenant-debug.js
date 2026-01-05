import Game from "./src/core/Game.js";
import Bot from "./src/core/Bot.js";
import { createUIAdapter } from "./src/core/UIAdapter.js";
import { cardDatabase } from "./src/data/cards.js";

async function testCovenantExecution() {
  console.log("🧪 Testing Shadow-Heart Covenant Execution\n");

  const mockRenderer = {
    renderHand: () => {},
    renderField: () => {},
    renderFieldSpell: () => {},
    renderSpellTrap: () => {},
    updateLP: () => {},
    updatePhaseTrack: () => {},
    updateTurn: () => {},
    updateGYPreview: () => {},
    updateExtraDeckPreview: () => {},
    updateActivationIndicators: () => {},
    updateAttackIndicators: () => {},
    highlightTargetCandidates: () => {},
    bindPhaseClick: () => {},
    bindCardInteractions: () => {},
    bindCardHover: () => {},
    bindPlayerHandCardClick: () => {},
    bindPlayerFieldCardClick: () => {},
    bindPlayerSpellTrapCardClick: () => {},
    bindPlayerFieldSpellClick: () => {},
    bindBotHandCardClick: () => {},
    bindBotFieldCardClick: () => {},
    bindBotSpellTrapCardClick: () => {},
    bindBotFieldSpellClick: () => {},
    showSelectionModal: () => {},
    showMultiSelectModal: () => {},
    showSearchModal: () => {},
    getSearchModalElements: () => null,
    showSearchModalVisual: () => {},
    log: (msg) => {
      console.log(`  📝 ${msg}`);
    },
  };

  const game = new Game({ renderer: mockRenderer });
  game.testModeEnabled = false;

  await game.start();

  // Create Bot 1 with Shadow-Heart preset (as player)
  const bot1 = new Bot(game, { preset: "shadowheart" });
  bot1.id = "player"; // Make bot1 the player
  const bot2 = new Bot(game, { preset: "luminarch" });
  
  game.player = bot1;
  game.bot = bot2;
  game.turn = "player"; // Set player's turn
  game.phase = "main1";

  // Initialize decks with Shadow-Heart Covenant included
  const covenantCard = cardDatabase.find((c) => c.id === 59); // Shadow-Heart Covenant
  const shadowHeartCards = cardDatabase.filter((c) => c.archetype === "Shadow-Heart");
  
  bot1.deck = [
    { ...covenantCard },
    ...shadowHeartCards.slice(0, 19).map((c) => ({ ...c }))
  ];
  bot1.lp = 8000;
  bot1.hand = bot1.deck.splice(0, 5);
  bot1.field = [];
  bot1.graveyard = [];
  bot1.spellTrap = [];

  bot2.deck = cardDatabase.slice(0, 20).map((c) => ({ ...c }));
  bot2.lp = 8000;
  bot2.hand = bot2.deck.splice(0, 5);
  bot2.field = [];
  bot2.graveyard = [];
  bot2.spellTrap = [];

  // Force Bot 1 to have Shadow-Heart Covenant in hand
  const covenant = bot1.deck.find(
    (c) => c.name === "Shadow-Heart Covenant"
  );
  if (covenant) {
    const idx = bot1.deck.indexOf(covenant);
    bot1.deck.splice(idx, 1);
    bot1.hand.push(covenant);
    console.log("✅ Added Shadow-Heart Covenant to Bot 1 hand");
  } else {
    console.log("❌ Shadow-Heart Covenant not found in deck");
  }

  console.log(
    `\n🎮 Bot 1 State: LP=${bot1.lp}, Hand=${bot1.hand.length}, Deck=${bot1.deck.length}`
  );
  console.log(
    `   Hand cards: ${bot1.hand.map((c) => c.name).join(", ")}`
  );

  // Manually trigger bot action
  console.log("\n🤖 Executing Bot 1 Main Phase Actions...");
  console.log(`   Bot1 ID: ${bot1.id}`);
  console.log(`   Game.turn: ${game.turn}`);
  console.log(`   Current phase: ${game.phase}`);
  console.log(`   Current turn: ${game.turnCounter}`);
  console.log(`   Game over: ${game.gameOver}\n`);

  try {
    await bot1.makeMove(game);
    console.log("\n✅ makeMove completed");
  } catch (err) {
    console.error("\n❌ makeMove failed:", err);
  }

  console.log(
    `\n📊 Final Bot 1 State: LP=${bot1.lp}, Hand=${bot1.hand.length}, Deck=${bot1.deck.length}`
  );
}

testCovenantExecution().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
