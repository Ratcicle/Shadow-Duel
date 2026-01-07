// ─────────────────────────────────────────────────────────────────────────────
// test-luminarch-phase1.js
// Validação da fase 1 da IA Luminarch: knowledge, priorities, combos, deck preset
// ─────────────────────────────────────────────────────────────────────────────

import { cardDatabase } from "./src/data/cards.js";
import {
  isLuminarch,
  isLuminarchByName,
  getCardKnowledge,
  getCardsByRole,
  CARD_KNOWLEDGE,
} from "./src/core/ai/luminarch/knowledge.js";
import {
  shouldPlaySpell,
  shouldSummonMonster,
} from "./src/core/ai/luminarch/priorities.js";
import {
  detectAvailableCombos,
  shouldPrioritizeDefense,
  canAttemptLethal,
} from "./src/core/ai/luminarch/combos.js";

console.log(
  "═════════════════════════════════════════════════════════════════"
);
console.log("  LUMINARCH AI - FASE 1 VALIDATION");
console.log(
  "═════════════════════════════════════════════════════════════════\n"
);

// ═════════════════════════════════════════════════════════════════════════════
// TEST 1: Knowledge Base
// ═════════════════════════════════════════════════════════════════════════════
console.log("TEST 1: Knowledge Base");
console.log(
  "─────────────────────────────────────────────────────────────────"
);

const testCards = [
  "Sanctum of the Luminarch Citadel",
  "Luminarch Aegisbearer",
  "Luminarch Holy Shield",
  "Luminarch Valiant - Knight of the Dawn",
];

let knowledgeTestPass = true;
testCards.forEach((name) => {
  const knowledge = getCardKnowledge(name);
  if (!knowledge) {
    console.log(`❌ FALHOU: ${name} não encontrado no knowledge base`);
    knowledgeTestPass = false;
  } else {
    console.log(
      `✅ ${name} | Role: ${knowledge.role} | Priority: ${knowledge.priority}`
    );
  }
});

console.log(
  `\nKnowledge Base: ${knowledgeTestPass ? "✅ PASSOU" : "❌ FALHOU"}\n`
);

// ═════════════════════════════════════════════════════════════════════════════
// TEST 2: Card Detection
// ═════════════════════════════════════════════════════════════════════════════
console.log("TEST 2: Card Detection (isLuminarch)");
console.log(
  "─────────────────────────────────────────────────────────────────"
);

const citadelCard = cardDatabase.find((c) => c.id === 112);
const aegisCard = cardDatabase.find((c) => c.id === 103);
const shadowCard = cardDatabase.find((c) => c.id === 60); // Shadow-Heart Imp

let detectionPass = true;
if (!isLuminarch(citadelCard)) {
  console.log(`❌ FALHOU: Citadel não detectado como Luminarch`);
  detectionPass = false;
} else {
  console.log(`✅ Sanctum of the Luminarch Citadel = Luminarch`);
}

if (!isLuminarch(aegisCard)) {
  console.log(`❌ FALHOU: Aegisbearer não detectado como Luminarch`);
  detectionPass = false;
} else {
  console.log(`✅ Luminarch Aegisbearer = Luminarch`);
}

if (isLuminarch(shadowCard)) {
  console.log(
    `❌ FALHOU: Shadow-Heart Imp detectado como Luminarch (falso positivo)`
  );
  detectionPass = false;
} else {
  console.log(`✅ Shadow-Heart Imp ≠ Luminarch`);
}

console.log(`\nCard Detection: ${detectionPass ? "✅ PASSOU" : "❌ FALHOU"}\n`);

// ═════════════════════════════════════════════════════════════════════════════
// TEST 3: Role-Based Search
// ═════════════════════════════════════════════════════════════════════════════
console.log("TEST 3: Role-Based Card Search");
console.log(
  "─────────────────────────────────────────────────────────────────"
);

const searchers = getCardsByRole("searcher");
const tanks = getCardsByRole("taunt_tank");

let roleTestPass = true;
if (searchers.length === 0) {
  console.log(`❌ FALHOU: Nenhum searcher encontrado`);
  roleTestPass = false;
} else {
  console.log(`✅ Searchers (${searchers.length}): ${searchers.join(", ")}`);
}

if (tanks.length === 0) {
  console.log(`❌ FALHOU: Nenhum taunt_tank encontrado`);
  roleTestPass = false;
} else {
  console.log(`✅ Taunt Tanks (${tanks.length}): ${tanks.join(", ")}`);
}

console.log(`\nRole Search: ${roleTestPass ? "✅ PASSOU" : "❌ FALHOU"}\n`);

// ═════════════════════════════════════════════════════════════════════════════
// TEST 4: shouldPlaySpell (Priorities)
// ═════════════════════════════════════════════════════════════════════════════
console.log("TEST 4: Spell Priorities");
console.log(
  "─────────────────────────────────────────────────────────────────"
);

const mockAnalysis = {
  hand: [citadelCard, aegisCard],
  field: [],
  fieldSpell: null,
  graveyard: [],
  lp: 8000,
  oppField: [{ atk: 2000 }],
  oppLp: 8000,
};

const citadelDecision = shouldPlaySpell(citadelCard, mockAnalysis);
console.log(
  `Sanctum Citadel (sem field spell): ${
    citadelDecision.yes ? "✅" : "❌"
  } shouldPlay | Priority: ${citadelDecision.priority} | Reason: ${
    citadelDecision.reason
  }`
);

// Testar com field spell já ativo
const mockAnalysisWithField = {
  ...mockAnalysis,
  fieldSpell: citadelCard,
};
const citadelDecision2 = shouldPlaySpell(citadelCard, mockAnalysisWithField);
console.log(
  `Sanctum Citadel (com field spell): ${
    citadelDecision2.yes ? "❌" : "✅"
  } blocked | Reason: ${citadelDecision2.reason}`
);

let spellTestPass = citadelDecision.yes && !citadelDecision2.yes;
console.log(
  `\nSpell Priorities: ${spellTestPass ? "✅ PASSOU" : "❌ FALHOU"}\n`
);

// ═════════════════════════════════════════════════════════════════════════════
// TEST 5: shouldSummonMonster (Priorities)
// ═════════════════════════════════════════════════════════════════════════════
console.log("TEST 5: Monster Summon Priorities");
console.log(
  "─────────────────────────────────────────────────────────────────"
);

const aegisDecision = shouldSummonMonster(aegisCard, mockAnalysis);
console.log(
  `Aegisbearer: ${aegisDecision.yes ? "✅" : "❌"} shouldSummon | Position: ${
    aegisDecision.position
  } | Priority: ${aegisDecision.priority} | Reason: ${aegisDecision.reason}`
);

// Aegis deve sempre ser defense
let summonTestPass = aegisDecision.yes && aegisDecision.position === "defense";

const valiantCard = cardDatabase.find((c) => c.id === 101);
const valiantDecision = shouldSummonMonster(valiantCard, mockAnalysis);
console.log(
  `Valiant: ${valiantDecision.yes ? "✅" : "❌"} shouldSummon | Position: ${
    valiantDecision.position
  } | Priority: ${valiantDecision.priority}`
);

console.log(
  `\nSummon Priorities: ${summonTestPass ? "✅ PASSOU" : "❌ FALHOU"}\n`
);

// ═════════════════════════════════════════════════════════════════════════════
// TEST 6: Combo Detection
// ═════════════════════════════════════════════════════════════════════════════
console.log("TEST 6: Combo Detection");
console.log(
  "─────────────────────────────────────────────────────────────────"
);

const comboAnalysis = {
  hand: [valiantCard],
  field: [],
  fieldSpell: null,
  graveyard: [aegisCard],
  extraDeck: [{ id: 121, name: "Luminarch Fortress Aegis" }],
  lp: 8000,
  oppField: [{ atk: 2000 }],
  oppLp: 8000,
};

const combos = detectAvailableCombos(comboAnalysis);
console.log(`Combos detectados: ${combos.length}`);
combos.slice(0, 3).forEach((combo) => {
  console.log(
    `  • ${combo.name} (priority ${combo.priority}): ${combo.description}`
  );
});

let comboTestPass = combos.length > 0;
console.log(
  `\nCombo Detection: ${comboTestPass ? "✅ PASSOU" : "❌ FALHOU"}\n`
);

// ═════════════════════════════════════════════════════════════════════════════
// TEST 7: Deck Preset Validation
// ═════════════════════════════════════════════════════════════════════════════
console.log("TEST 7: Deck Preset Validation");
console.log(
  "─────────────────────────────────────────────────────────────────"
);

import Bot from "./src/core/Bot.js";
const luminarchBot = new Bot("luminarch");
const deck = luminarchBot.getLuminarchDeck();
const extraDeck = luminarchBot.getLuminarchExtraDeck();

console.log(`Main Deck size: ${deck.length} cards`);
console.log(`Extra Deck size: ${extraDeck.length} cards`);

// Validar prioridades S-tier (3 cópias)
const citadelCount = deck.filter((id) => id === 112).length;
const aegisCount = deck.filter((id) => id === 103).length;
const holyShieldCount = deck.filter((id) => id === 102).length;

let deckTestPass = true;
if (citadelCount !== 3) {
  console.log(
    `❌ FALHOU: Sanctum Citadel deveria ter 3 cópias (encontrado ${citadelCount})`
  );
  deckTestPass = false;
} else {
  console.log(`✅ Sanctum Citadel: 3x (S-tier)`);
}

if (aegisCount !== 3) {
  console.log(
    `❌ FALHOU: Aegisbearer deveria ter 3 cópias (encontrado ${aegisCount})`
  );
  deckTestPass = false;
} else {
  console.log(`✅ Aegisbearer: 3x (S-tier)`);
}

if (holyShieldCount !== 3) {
  console.log(
    `❌ FALHOU: Holy Shield deveria ter 3 cópias (encontrado ${holyShieldCount})`
  );
  deckTestPass = false;
} else {
  console.log(`✅ Holy Shield: 3x (S-tier)`);
}

if (extraDeck.length === 0) {
  console.log(`❌ FALHOU: Extra Deck vazio`);
  deckTestPass = false;
} else {
  console.log(`✅ Extra Deck configurado`);
}

console.log(`\nDeck Preset: ${deckTestPass ? "✅ PASSOU" : "❌ FALHOU"}\n`);

// ═════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═════════════════════════════════════════════════════════════════════════════
console.log(
  "═════════════════════════════════════════════════════════════════"
);
console.log("  RESUMO DOS TESTES");
console.log(
  "═════════════════════════════════════════════════════════════════"
);

const allTestsPass =
  knowledgeTestPass &&
  detectionPass &&
  roleTestPass &&
  spellTestPass &&
  summonTestPass &&
  comboTestPass &&
  deckTestPass;

console.log(`Knowledge Base:      ${knowledgeTestPass ? "✅" : "❌"}`);
console.log(`Card Detection:      ${detectionPass ? "✅" : "❌"}`);
console.log(`Role Search:         ${roleTestPass ? "✅" : "❌"}`);
console.log(`Spell Priorities:    ${spellTestPass ? "✅" : "❌"}`);
console.log(`Summon Priorities:   ${summonTestPass ? "✅" : "❌"}`);
console.log(`Combo Detection:     ${comboTestPass ? "✅" : "❌"}`);
console.log(`Deck Preset:         ${deckTestPass ? "✅" : "❌"}`);
console.log(
  "\n═════════════════════════════════════════════════════════════════"
);
console.log(
  `  RESULTADO FINAL: ${
    allTestsPass ? "✅ TODOS PASSARAM" : "❌ ALGUNS FALHARAM"
  }`
);
console.log(
  "═════════════════════════════════════════════════════════════════\n"
);

process.exit(allTestsPass ? 0 : 1);
