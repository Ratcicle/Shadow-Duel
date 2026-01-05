/**
 * test-suicide-summon-fix.js — Valida que bot não faz summon suicida
 *
 * Cenário:
 * - Oponente tem Black Bull Dragon (2400 ATK)
 * - Bot tem Abyssal Eel (1600 ATK) na mão
 * - Bot NÃO deve summon Eel em ATK
 */

import Game from "./src/core/Game.js";
import ShadowHeartStrategy from "./src/core/ai/ShadowHeartStrategy.js";
import { cardDatabase } from "./src/data/cards.js";

console.log(
  `\n═══════════════════════════════════════════════════════════════`
);
console.log(`🧪 TESTE: Suicide Summon Prevention`);
console.log(
  `═══════════════════════════════════════════════════════════════\n`
);

// Setup game
const game = new Game();

// Bot deck: Shadow-Heart
const botDeck = cardDatabase.filter((c) => c.archetype === "Shadow-Heart");
game.bot = {
  id: "bot",
  deck: [...botDeck].map((c) => ({ ...c })).slice(0, 20),
  hand: [],
  field: [],
  graveyard: [],
  extraDeck: [],
  lp: 8000,
  summonCount: 0,
  canNormalSummon: true,
};

// Player: Black Bull Dragon no campo
const blackBullDragon = cardDatabase.find(
  (c) => c.name === "Black Bull Dragon"
);
game.player = {
  id: "player",
  deck: [],
  hand: [],
  field: [{ ...blackBullDragon, position: "attack" }],
  graveyard: [],
  extraDeck: [],
  lp: 8000,
  summonCount: 0,
  canNormalSummon: true,
};

// Bot hand: Abyssal Eel
const abyssalEel = cardDatabase.find(
  (c) => c.name === "Shadow-Heart Abyssal Eel"
);
game.bot.hand = [{ ...abyssalEel }];

game.currentPlayer = game.bot;
game.strategy = new ShadowHeartStrategy(game.bot);

console.log(`Cenário:`);
console.log(
  `  Oponente: Black Bull Dragon (${blackBullDragon.atk} ATK) no campo`
);
console.log(`  Bot: Shadow-Heart Abyssal Eel (${abyssalEel.atk} ATK) na mão`);
console.log(`\n🤔 Bot deveria: NÃO summon Eel (seria destruído)\n`);

// Rodar strategy
const actions = game.strategy.generateMainPhaseActions(game);

console.log(
  `\n═══════════════════════════════════════════════════════════════`
);
console.log(`📊 RESULTADO`);
console.log(
  `═══════════════════════════════════════════════════════════════\n`
);

const summonActions = actions.filter((a) => a.type === "summon");

if (summonActions.length === 0) {
  console.log(`✅ CORRETO: Bot não gerou ação de summon`);
  console.log(
    `   Razão: Eel 1600 ATK seria destruído por Black Bull 2400 ATK\n`
  );
} else {
  console.log(`❌ FALHA: Bot gerou ${summonActions.length} summon action(s)`);
  summonActions.forEach((a) => {
    console.log(`   - ${a.type}: ${a.cardName} (priority: ${a.priority})`);
  });
  console.log(`\n   ⚠️  Bot ainda faz summon suicida!\n`);
}

// Teste 2: Bot com monstro forte
console.log(`═══════════════════════════════════════════════════════════════`);
console.log(`🧪 TESTE 2: Summon seguro (monstro forte)`);
console.log(
  `═══════════════════════════════════════════════════════════════\n`
);

const scaleDragon = cardDatabase.find(
  (c) => c.name === "Shadow-Heart Scale Dragon"
);
game.bot.hand = [{ ...scaleDragon }];
game.bot.field = [
  { name: "Tribute1", atk: 1500 },
  { name: "Tribute2", atk: 1500 },
  { name: "Tribute3", atk: 1500 },
];

const actions2 = game.strategy.generateMainPhaseActions(game);
const summonActions2 = actions2.filter((a) => a.type === "summon");

console.log(`Cenário:`);
console.log(`  Oponente: Black Bull Dragon (2400 ATK)`);
console.log(`  Bot: Scale Dragon (3000 ATK) na mão + 3 tributos no campo`);
console.log(
  `\n🤔 Bot deveria: Summon Scale Dragon (mais forte que Black Bull)\n`
);

if (summonActions2.length > 0) {
  console.log(`✅ CORRETO: Bot gerou summon action`);
  console.log(
    `   ${summonActions2[0].cardName} com priority ${summonActions2[0].priority}\n`
  );
} else {
  console.log(
    `❌ FALHA: Bot não gerou summon (deveria ter summoned Scale Dragon)\n`
  );
}

console.log(`═══════════════════════════════════════════════════════════════`);
console.log(`✅ TESTES COMPLETOS`);
console.log(
  `═══════════════════════════════════════════════════════════════\n`
);
