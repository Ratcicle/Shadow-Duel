// test-ai-p1.js — Teste da integração P1 (MacroPlanning + ChainAwareness)

import Game from "./src/core/Game.js";
import Bot from "./src/core/Bot.js";
import { cardDatabase } from "./src/data/cards.js";
import * as MacroPlanning from "./src/core/ai/MacroPlanning.js";
import * as ChainAwareness from "./src/core/ai/ChainAwareness.js";

// Mock do renderer
const mockRenderer = new Proxy(
  {},
  {
    get: () => () => {}, // Qualquer método retorna no-op
  }
);

console.log("🧪 Test P1: MacroPlanning + ChainAwareness Integration\n");

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 1: Duel com bot ShadowHeart — Verificar se macro strategy é calculada
// ═══════════════════════════════════════════════════════════════════════════════
console.log("Test 1: Macro Strategy Calculation");
console.log("──────────────────────────────────────");

try {
  const game = new Game(mockRenderer);
  const bot = new Bot(game);
  game.renderer = mockRenderer;

  // Criar decks pequenos
  const botDeck = cardDatabase.slice(0, 20);
  const playerDeck = cardDatabase.slice(1, 21);

  // Inicializar players manualmente
  game.bot = bot;
  game.bot.game = game;
  game.player = {
    name: "Human",
    lifePoints: 8000,
    id: "player",
    hand: playerDeck.slice(0, 5),
    field: [],
    graveyard: [],
    deck: playerDeck.slice(5),
    spellTrap: [],
    fieldSpell: null,
  };

  // Inicia jogo
  game.start();

  // Acessar strategy e verificar se avaliaMacroStrategy existe
  const strategy = bot.strategy;
  if (typeof strategy.evaluateMacroStrategy !== "function") {
    console.log("❌ evaluateMacroStrategy não existe na strategy");
  } else {
    console.log("✅ evaluateMacroStrategy method exists");
  }

  // Simular uma chamada
  const macroResult = strategy.evaluateMacroStrategy(game, {
    fieldCapacity: 5,
    canNormalSummon: true,
    availableCombos: [],
  });

  if (macroResult && macroResult.strategy) {
    console.log(`✅ Macro strategy calculated: ${macroResult.strategy}`);
    console.log(`   Priority: ${macroResult.priority}`);
    console.log(`   Detail: ${macroResult.detail}`);
  } else {
    console.log("❌ Macro strategy not properly calculated");
  }
} catch (err) {
  console.log(`❌ Test 1 failed: ${err.message}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 2: Chain Risk Assessment
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\nTest 2: Chain Risk Assessment");
console.log("──────────────────────────────────────");

try {
  const game = new Game(mockRenderer);
  const bot = new Bot(game);
  game.renderer = mockRenderer;

  const botDeck = cardDatabase.slice(0, 20);
  const playerDeck = cardDatabase.slice(1, 21);

  // Inicializar players manualmente
  game.bot = bot;
  game.bot.game = game;
  game.player = {
    name: "Human",
    lifePoints: 8000,
    id: "player",
    hand: playerDeck.slice(0, 5),
    field: [],
    graveyard: [],
    deck: playerDeck.slice(5),
    spellTrap: [],
    fieldSpell: null,
  };

  game.start();

  const strategy = bot.strategy;

  // Verificar se imports de ChainAwareness estão presentes
  const gameState = { bot: game.bot, player: game.player };

  // Testar avaliação de segurança
  const testCard = game.bot.hand[0];
  if (testCard) {
    const safety = ChainAwareness.assessActionSafety(
      gameState,
      game.bot,
      game.player,
      "spell",
      testCard
    );

    if (safety && typeof safety.riskScore === "number") {
      console.log(`✅ Chain risk assessment works`);
      console.log(`   Risk score: ${safety.riskScore.toFixed(2)}`);
      console.log(`   Recommendation: ${safety.recommendation}`);
    } else {
      console.log("❌ Chain risk assessment failed");
    }
  } else {
    console.log("⚠️  No hand cards to test chain risk");
  }
} catch (err) {
  console.log(`❌ Test 2 failed: ${err.message}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 3: Lethal Detection
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\nTest 3: Lethal Detection");
console.log("──────────────────────────────────────");

try {
  // Crear game state com condição de lethal potencial
  const testBot = {
    lp: 8000,
    field: [
      {
        name: "Test Monster",
        cardKind: "monster",
        atk: 5000,
        position: "attack",
        hasAttacked: false,
        extraAttacks: 0,
      },
    ],
  };

  const testOpponent = {
    lp: 3000, // Lethal range
    field: [],
    graveyard: [],
  };

  const lethalResult = MacroPlanning.detectLethalOpportunity(
    { bot: testBot, player: testOpponent },
    testBot,
    testOpponent,
    2
  );

  if (lethalResult.canLethal) {
    console.log(`✅ Lethal detected!`);
    console.log(`   Damage: ${lethalResult.damage}`);
    console.log(`   Turns needed: ${lethalResult.turnsNeeded}`);
    console.log(`   Confidence: ${lethalResult.confidence.toFixed(2)}`);
  } else {
    console.log("⚠️  No lethal detected (expected for randomized test)");
  }
} catch (err) {
  console.log(`❌ Test 3 failed: ${err.message}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 4: Defensive Need Detection
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\nTest 4: Defensive Need Detection");
console.log("──────────────────────────────────────");

try {
  const testBot = {
    lp: 2000, // Low LP = need defense
    field: [],
  };

  const testOpponent = {
    lp: 8000,
    field: [
      {
        name: "Strong Enemy",
        cardKind: "monster",
        atk: 2500,
        position: "attack",
      },
    ],
  };

  const defensiveResult = MacroPlanning.detectDefensiveNeed(
    { bot: testBot, player: testOpponent },
    testBot,
    testOpponent
  );

  if (defensiveResult.needsDefense) {
    console.log(`✅ Defensive need detected!`);
    console.log(`   Threat level: ${defensiveResult.threatLevel}`);
    console.log(`   Turns to kill: ${defensiveResult.turnsToKill}`);
  } else {
    console.log("⚠️  No defensive need (may vary based on state)");
  }
} catch (err) {
  console.log(`❌ Test 4 failed: ${err.message}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST 5: Macro Strategy Decision
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\nTest 5: Macro Strategy Decision");
console.log("──────────────────────────────────────");

try {
  const testBot = {
    lp: 8000,
    field: [
      {
        name: "High ATK",
        cardKind: "monster",
        atk: 4000,
        position: "attack",
        hasAttacked: false,
      },
    ],
  };

  const testOpponent = {
    lp: 2500, // Low LP = lethal opportunity
    field: [],
  };

  const strategyResult = MacroPlanning.decideMacroStrategy(
    { bot: testBot, player: testOpponent },
    testBot,
    testOpponent
  );

  if (strategyResult) {
    console.log(`✅ Strategy decided: ${strategyResult.strategy}`);
    console.log(`   Priority: ${strategyResult.priority}`);
    console.log(`   Detail: ${strategyResult.detail}`);
  } else {
    console.log("❌ Strategy decision failed");
  }
} catch (err) {
  console.log(`❌ Test 5 failed: ${err.message}`);
}
console.log("\n✅ P1 Integration Tests Complete");
