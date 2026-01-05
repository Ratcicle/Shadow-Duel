// test-full-turn-simulation.js — Simular múltiplos turnos CORRETOS

import Game from "./src/core/Game.js";
import Bot from "./src/core/Bot.js";
import { cardDatabase } from "./src/data/cards.js";
import Player from "./src/core/Player.js";

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
  log: (...args) => {},
  showConfirmPrompt: () => true,
  showNumberPrompt: () => 1,
};

console.log("🎮 Full Turn Simulation Test\n");

function createDefaultDeck() {
  return cardDatabase.slice(0, 20).map((c) => c.id);
}

function getCardName(card) {
  if (!card) return "?";
  return card.name || `Card#${card.id}`;
}

async function simulatePlayerTurn(game) {
  // Player turn (skip immediately to bot)
  game.turn = "bot";
  await game.startTurn();
}

(async () => {
  try {
    const game = new Game({ renderer: mockRenderer });
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

    console.log("📊 Estado inicial:");
    console.log(`   Bot: ${bot.hand.length} cartas, ${bot.field.length} no campo`);
    console.log(`   Player: ${player.hand.length} cartas, ${player.field.length} no campo\n`);

    console.log("🎮 Iniciando jogo (start)...");
    await game.start();
    console.log(`✅ Turno 1 (Player) iniciado`);

    console.log(`\n🔄 Mudando para turno do Bot...\n`);
    await simulatePlayerTurn(game);
    
    console.log(`\n✅ Turno 2 (Bot) iniciado!`);
    console.log(`   Fase: ${game.phase}`);
    
    // Aguardar um pouco para o bot completar suas ações
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log(`\n   Bot: ${bot.hand.length} cartas na mão, ${bot.field.length} no campo`);
    
    if (bot.field.length > 0) {
      console.log(`\n🎉 SUCCESS! Ações foram executadas!`);
      console.log(`   Campo do bot: ${bot.field.map(getCardName).join(", ")}`);
    } else {
      console.log(`\n⚠️  Campo ainda vazio`);
    }
    
    console.log(`\n✅ Teste completado!`);
  } catch (err) {
    console.log(`\n❌ ERRO: ${err.message}`);
    console.log(err.stack);
  }
})();
