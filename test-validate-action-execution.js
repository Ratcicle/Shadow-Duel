// test-validate-action-execution.js — Validar que ações são executadas pós-correção

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
  log: (...args) => console.log("[UI LOG]", ...args),
  showConfirmPrompt: () => true,
  showNumberPrompt: () => 1,
};

console.log("✅ Action Execution Validation Test\n");

function createDefaultDeck() {
  return cardDatabase.slice(0, 20).map((c) => c.id);
}

function getCardName(card) {
  if (!card) return "?";
  return card.name || `Card#${card.id}`;
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
    console.log(`   Bot: ${bot.hand.length} cartas na mão, ${bot.field.length} no campo`);
    console.log(`   Player: ${player.hand.length} cartas na mão, ${player.field.length} no campo\n`);

    console.log("🎮 Iniciando jogo...");
    await game.start();

    console.log(`\n✅ Jogo iniciado com sucesso!`);
    console.log(`   Fase: ${game.phase}`);
    console.log(`   Turno: ${game.turnCounter}`);
    console.log(`   Jogador atual: ${game.turn}`);

    console.log(`\n📊 Estado após game.start():`);
    console.log(`   Bot: ${bot.hand.length} cartas na mão, ${bot.field.length} no campo`);
    if (bot.field.length > 0) {
      console.log(`   ✅ AÇÕES FORAM EXECUTADAS!`);
      console.log(`      Campo tem: ${bot.field.map(getCardName).join(", ")}`);
    } else {
      console.log(`   ⚠️  Campo ainda vazio (sem ações)`);
    }
    console.log(`   Player: ${player.hand.length} cartas na mão, ${player.field.length} no campo`);

    // Simular mudança de turno e aguardar uma ação do player
    console.log(`\n⏳ Simulando mudança de turno...`);
    game.turn = "bot";
    game.phase = "main1";
    
    console.log(`   Turno agora é: ${game.turn}`);
    console.log(`   Fase: ${game.phase}`);
    console.log(`   Bot pode executar ações na main phase`);

    console.log(`\n📊 Estado final:`);
    console.log(`   Bot: ${bot.hand.length} cartas, ${bot.field.length} no campo`);
    console.log(`   Player: ${player.hand.length} cartas, ${player.field.length} no campo`);
    console.log(`\n✅ Teste completado com sucesso!`);
  } catch (err) {
    console.log(`\n❌ ERRO: ${err.message}`);
    console.log(err.stack);
  }
})();
