// test-debug-game-start.js — Debugar por que game.start() falha

import Game from "./src/core/Game.js";
import Bot from "./src/core/Bot.js";
import { cardDatabase } from "./src/data/cards.js";
import Player from "./src/core/Player.js";

const mockRenderer = {
  // Métodos renderização
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
  
  // Métodos de binding (interact)
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
  
  // Outros
  log: (...args) => console.log("[UI LOG]", ...args),
  showConfirmPrompt: () => true,
  showNumberPrompt: () => 1,
};

console.log("🔍 Debugging Game.start()\n");

function createDefaultDeck() {
  return cardDatabase.slice(0, 20).map((c) => c.id);
}

(async () => {
  try {
    const game = new Game({ renderer: mockRenderer });

    console.log("📍 Game criado:");
    console.log(`   game.ui: ${game.ui ? "✅ existe" : "❌ nulo"}`);
    console.log(`   game.ui.renderHand: ${typeof game.ui?.renderHand}`);
    console.log(`   game.renderer: ${game.renderer ? "✅ existe" : "❌ nulo"}`);
    
    const bot = new Bot(game, { preset: "shadowheart" });
    const player = new Player(game, "Human");

    game.bot = bot;
    game.player = player;

    const botDeck = createDefaultDeck();
    const playerDeck = createDefaultDeck();

    bot.deck = botDeck
      .map((id) => {
        const card = cardDatabase.find((c) => c.id === id);
        return card ? { ...card } : null;
      })
      .filter(Boolean);
    bot.lifePoints = 8000;
    bot.hand = bot.deck.splice(0, 5);
    bot.field = [];
    bot.graveyard = [];
    bot.spellTrap = [];
    bot.fieldSpell = null;

    player.deck = playerDeck
      .map((id) => {
        const card = cardDatabase.find((c) => c.id === id);
        return card ? { ...card } : null;
      })
      .filter(Boolean);
    player.lifePoints = 8000;
    player.hand = player.deck.splice(0, 5);
    player.field = [];
    player.graveyard = [];
    player.spellTrap = [];
    player.fieldSpell = null;

    console.log("Estado antes de game.start():");
    console.log(`  game.phase: ${game.phase}`);
    console.log(`  game.turn: ${game.turn}`);
    console.log(`  game.turnCounter: ${game.turnCounter}`);

    console.log("\n🎮 Chamando game.start()...\n");
    
    try {
      await game.start();
      console.log("✅ game.start() executado com sucesso!");
    } catch (e) {
      console.log(`❌ ERRO em game.start(): ${e.message}`);
      console.log(`   Stack: ${e.stack}`);
    }

    console.log("\nEstado após game.start():");
    console.log(`  game.phase: ${game.phase}`);
    console.log(`  game.turn: ${game.turn}`);
    console.log(`  game.turnCounter: ${game.turnCounter}`);
    console.log(`  Bot hand: ${bot.hand.length}`);
    console.log(`  Player hand: ${player.hand.length}`);
  } catch (err) {
    console.log(`💥 ERRO CRÍTICO: ${err.message}`);
    console.log(err.stack);
  }
})();
