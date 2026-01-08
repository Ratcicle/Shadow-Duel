/**
 * Test: Bot deve continuar avaliando ações após ativar efeitos de campo
 * 
 * Cenário: Bot com Valiant, Convocation e Aurora Seraph na mão
 * Esperado:
 * 1. Invocar Valiant (busca Halberd) - chainCount = 1
 * 2. Ativar Convocation spell - chainCount = 2
 * 3. Ativar efeito Convocation (busca Arbiter) - não conta
 * 4. Invocar Arbiter (busca Citadel) - chainCount = 3
 * 5. Loop termina (maxChains = 3)
 */

import Game from "./src/core/Game.js";
import Bot from "./src/core/Bot.js";
import { cardDatabaseById } from "./src/data/cards.js";

// Mock renderer que ignora todas as chamadas
const mockRenderer = new Proxy({}, {
  get: () => () => Promise.resolve()
});

async function testChainLimit() {
  console.log("🧪 TEST: Chain limit após efeitos de campo\n");
  
  const game = new Game(mockRenderer);
  game.player.id = "player";
  game.bot = new Bot("luminarch");
  game.bot.id = "bot";
  
  // Bot é o jogador ativo
  game.currentPlayer = game.bot;
  
  // Setup: Bot jogando de Luminarch
  const botPlayer = game.bot;
  
  // Mão inicial: Valiant, Convocation, Aurora Seraph, Radiant Wave, Holy Ascension
  const valiant = cardDatabaseById.get(101);    // Luminarch Valiant
  const convocation = cardDatabaseById.get(111); // Knights Convocation
  const aurora = cardDatabaseById.get(109);      // Aurora Seraph
  const wave = cardDatabaseById.get(114);        // Radiant Wave
  const ascension = cardDatabaseById.get(113);   // Holy Ascension
  
  if (!valiant || !convocation || !aurora) {
    console.error("❌ Cards not found in database");
    console.error(`  Valiant: ${valiant ? "✓" : "✗"}`);
    console.error(`  Convocation: ${convocation ? "✓" : "✗"}`);
    console.error(`  Aurora: ${aurora ? "✓" : "✗"}`);
    return;
  }
  
  botPlayer.hand = [
    new (await import("./src/core/Card.js")).default(valiant, botPlayer.id),
    new (await import("./src/core/Card.js")).default(convocation, botPlayer.id),
    new (await import("./src/core/Card.js")).default(aurora, botPlayer.id),
    new (await import("./src/core/Card.js")).default(wave, botPlayer.id),
    new (await import("./src/core/Card.js")).default(ascension, botPlayer.id)
  ];
  
  // Deck: Arbiter, Citadel, Halberd, outros
  const arbiter = cardDatabaseById.get(110);    // Sanctified Arbiter
  const citadel = cardDatabaseById.get(112);    // Sanctum of Luminarch Citadel
  const halberd = cardDatabaseById.get(106);    // Enchanted Halberd (ou Magic Sickle)
  const aegis = cardDatabaseById.get(103);      // Aegisbearer
  
  botPlayer.deck = [
    new (await import("./src/core/Card.js")).default(halberd, botPlayer.id),
    new (await import("./src/core/Card.js")).default(arbiter, botPlayer.id),
    new (await import("./src/core/Card.js")).default(citadel, botPlayer.id),
    new (await import("./src/core/Card.js")).default(aegis, botPlayer.id)
  ];
  
  game.phase = "main1";
  game.turnCounter = 1;
  botPlayer.summonCount = 0;
  
  console.log("📋 Setup inicial:");
  console.log(`  Hand: ${botPlayer.hand.map(c => c.name).join(", ")}`);
  console.log(`  Deck: ${botPlayer.deck.map(c => c.name).join(", ")}`);
  console.log(`  maxChainedActions: ${botPlayer.maxChainedActions}\n`);
  
  console.log("▶️  Executando playMainPhase...\n");
  
  // Ativar debug
  botPlayer.debug = true;
  
  // Executar main phase
  await botPlayer.playMainPhase(game);
  
  console.log("\n✅ playMainPhase finalizada");
  console.log("\n📊 Estado final:");
  console.log(`  Hand (${botPlayer.hand.length}): ${botPlayer.hand.map(c => c.name).join(", ")}`);
  console.log(`  Field (${botPlayer.field.length}): ${botPlayer.field.map(c => c.name).join(", ")}`);
  console.log(`  Spell/Trap (${botPlayer.spellTrapZone.filter(c => c).length}): ${botPlayer.spellTrapZone.filter(c => c).map(c => c.name).join(", ")}`);
  console.log(`  Field Spell: ${botPlayer.fieldSpell?.name || "(nenhum)"}`);
  console.log(`  Summon Count: ${botPlayer.summonCount}`);
  
  // Validações
  console.log("\n🔍 Validações:");
  
  const hasArbiterInField = botPlayer.field.some(c => c.name.includes("Arbiter"));
  const hasValiantInField = botPlayer.field.some(c => c.name.includes("Valiant"));
  const hasCitadelInHand = botPlayer.hand.some(c => c.name.includes("Citadel"));
  const hasHalberdInHand = botPlayer.hand.some(c => c.name.includes("Halberd"));
  const hasConvocationInField = botPlayer.spellTrapZone.some(c => c?.name.includes("Convocation"));
  
  console.log(`  ✓ Valiant no field: ${hasValiantInField ? "✅" : "❌"}`);
  console.log(`  ✓ Arbiter no field: ${hasArbiterInField ? "✅" : "❌"}`);
  console.log(`  ✓ Halberd na mão: ${hasHalberdInHand ? "✅" : "❌"}`);
  console.log(`  ✓ Citadel na mão: ${hasCitadelInHand ? "✅" : "❌"}`);
  console.log(`  ✓ Convocation ativo: ${hasConvocationInField ? "✅" : "❌"}`);
  
  const success = hasValiantInField && hasArbiterInField && hasCitadelInHand;
  
  if (success) {
    console.log("\n✅ TESTE PASSOU! Bot executou múltiplas ações após ativar efeitos de campo.");
  } else {
    console.log("\n❌ TESTE FALHOU! Bot não continuou avaliando após efeitos de campo.");
  }
  
  return success;
}

testChainLimit()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((err) => {
    console.error("❌ Erro no teste:", err);
    process.exit(1);
  });
