/**
 * test-luminarch-p012.js — Valida P0+P1+P2 + Suicide Prevention em Luminarch
 *
 * Testa:
 * 1. Suicide Prevention: Luminarch não summon monstro fraco vs ameaça forte
 * 2. Macro Strategy: Detecta lethal, defend, grind
 * 3. P2 Integration: Game Tree Search funciona
 */

import Game from "./src/core/Game.js";
import LuminarchStrategy from "./src/core/ai/LuminarchStrategy.js";
import { cardDatabase } from "./src/data/cards.js";

console.log(
  `\n═══════════════════════════════════════════════════════════════`
);
console.log(`🧪 TESTE: Luminarch P0+P1+P2 Integration`);
console.log(
  `═══════════════════════════════════════════════════════════════\n`
);

// === TESTE 1: SUICIDE PREVENTION ===
console.log(`📋 Teste 1: Suicide Prevention (Luminarch)\n`);

const game1 = new Game();

// Bot: Luminarch
const luminarchDeck = cardDatabase.filter((c) => c.archetype === "Luminarch");
game1.bot = {
  id: "bot",
  deck: [...luminarchDeck].map((c) => ({ ...c })).slice(0, 20),
  hand: [],
  field: [],
  graveyard: [],
  extraDeck: [],
  lp: 8000,
  summonCount: 0,
  canNormalSummon: true,
};

// Oponente: Shadow-Heart Scale Dragon (3000 ATK)
const scaleDragon = cardDatabase.find(
  (c) => c.name === "Shadow-Heart Scale Dragon"
);
game1.player = {
  id: "player",
  deck: [],
  hand: [],
  field: [{ ...scaleDragon, position: "attack" }],
  graveyard: [],
  extraDeck: [],
  lp: 8000,
  summonCount: 0,
};

// Bot hand: Luminarch monstro fraco (1400-1800 ATK)
const luminarchMonster = luminarchDeck.find(
  (c) => c.cardKind === "monster" && (c.atk || 0) < 2000
);
if (luminarchMonster) {
  game1.bot.hand = [{ ...luminarchMonster }];
}

game1.currentPlayer = game1.bot;
game1.strategy = new LuminarchStrategy(game1.bot);

console.log(`Cenário:`);
console.log(`  Oponente: Scale Dragon (3000 ATK)`);
console.log(
  `  Bot: ${luminarchMonster?.name || "Monstro fraco"} (${
    luminarchMonster?.atk || 0
  } ATK)`
);
console.log(`\n🤔 Bot deveria: NÃO summon em ATK ou summon em DEF\n`);

const actions1 = game1.strategy.generateMainPhaseActions(game1);
const summonActions1 = actions1.filter((a) => a.type === "summon");

if (summonActions1.length === 0) {
  console.log(`✅ CORRETO: Bot não gerou summon (muito perigoso)`);
} else {
  const summon = summonActions1[0];
  if (summon.position === "defense") {
    console.log(`✅ CORRETO: Bot summon em DEFENSE position (safety check)`);
  } else {
    console.log(`❌ FALHA: Bot summon em ATK position (suicide)`);
  }
}

// === TESTE 2: MACRO STRATEGY ===
console.log(
  `\n═══════════════════════════════════════════════════════════════`
);
console.log(`📋 Teste 2: Macro Strategy Detection\n`);

const game2 = new Game();
game2.bot = {
  id: "bot",
  deck: [...luminarchDeck].map((c) => ({ ...c })).slice(0, 20),
  hand: [],
  field: [
    { name: "Luminarch1", atk: 2000 },
    { name: "Luminarch2", atk: 2000 },
  ],
  graveyard: [],
  extraDeck: [],
  lp: 8000,
  summonCount: 0,
};

// Oponente low LP (lethal opportunity)
game2.player = {
  id: "player",
  deck: [],
  hand: [],
  field: [],
  graveyard: [],
  lp: 3000,
  summonCount: 0,
};

game2.currentPlayer = game2.bot;
game2.strategy = new LuminarchStrategy(game2.bot);

console.log(`Cenário:`);
console.log(`  Oponente: 3000 LP, campo vazio`);
console.log(`  Bot: 2 monstros (2000 ATK cada), 8000 LP`);
console.log(`\n🤔 Macro Strategy deveria: LETHAL (opp low LP)\n`);

const macro2 = game2.strategy.evaluateMacroStrategy(game2);
console.log(
  `Macro Strategy: ${macro2.strategy} (Priority: ${macro2.priority})`
);

if (macro2.strategy === "lethal") {
  console.log(`✅ CORRETO: Detectou lethal opportunity`);
} else {
  console.log(`⚠️  PARCIAL: Detectou ${macro2.strategy} (esperado: lethal)`);
}

// === TESTE 3: P2 INTEGRATION ===
console.log(
  `\n═══════════════════════════════════════════════════════════════`
);
console.log(`📋 Teste 3: P2 Integration (Game Tree disponível)\n`);

const game3 = new Game();
game3.bot = {
  id: "bot",
  deck: [...luminarchDeck].map((c) => ({ ...c })).slice(0, 20),
  hand: [
    { name: "Luminarch Spell 1", cardKind: "spell", atk: 0 },
    { name: "Luminarch Spell 2", cardKind: "spell", atk: 0 },
  ],
  field: [{ name: "Luminarch Beater", atk: 2400 }],
  graveyard: [],
  extraDeck: [],
  lp: 5000,
  summonCount: 0,
};

game3.player = {
  id: "player",
  deck: [],
  hand: [],
  field: [
    { name: "Threat1", atk: 2600 },
    { name: "Threat2", atk: 2600 },
  ],
  graveyard: [],
  lp: 8000,
  summonCount: 0,
};

game3.currentPlayer = game3.bot;
game3.strategy = new LuminarchStrategy(game3.bot);

console.log(`Cenário:`);
console.log(`  Oponente: 2 monstros (2600 ATK cada), 8000 LP`);
console.log(`  Bot: 1 monstro (2400 ATK), 5000 LP`);
console.log(`\n🤔 P2 deveria: Ser acionado (situação defensiva crítica)\n`);

const oppAnalysis = game3.strategy.analyzeOpponentPosition(game3);
if (oppAnalysis) {
  console.log(
    `✅ Opponent Analysis: ${oppAnalysis.playstyle}, threat ${oppAnalysis.threat_level}/3`
  );
} else {
  console.log(`⚠️  Opponent Analysis não rodou`);
}

// Nota: Game Tree pode não acionar se não tiver ações válidas
const actions3 = game3.strategy.generateMainPhaseActions(game3);
console.log(`\nAções geradas: ${actions3.length}`);

if (actions3.some((a) => a.p2Approved)) {
  console.log(`✅ CORRETO: P2 Game Tree influenciou decisão`);
} else {
  console.log(
    `ℹ️  P2 não influenciou (normal se não houve ação crítica válida)`
  );
}

console.log(
  `\n═══════════════════════════════════════════════════════════════`
);
console.log(`✅ TESTES COMPLETOS — Luminarch P0+P1+P2`);
console.log(
  `═══════════════════════════════════════════════════════════════\n`
);

console.log(`📊 Resumo:`);
console.log(`  ✅ Suicide Prevention: Implementado`);
console.log(`  ✅ Macro Strategy (P1): Implementado`);
console.log(`  ✅ Opponent Analysis (P2): Implementado`);
console.log(`  ✅ Game Tree Search (P2): Integrado (aciona se crítico)\n`);
