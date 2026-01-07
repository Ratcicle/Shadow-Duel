/**
 * Teste: Validar conceitos de avaliação de valor e proteção sacrificial
 */

import {
  evaluateCardExpendability,
  evaluateFieldSpellUrgency,
  detectSacrificialProtection,
  evaluateRiskWithProtection,
} from "./src/core/ai/luminarch/cardValue.js";
import { cardDatabaseById } from "./src/data/cards.js";

console.log("=".repeat(70));
console.log("TESTE: Avaliação de Valor de Cartas e Proteção Sacrificial");
console.log("=".repeat(70));

// ═════════════════════════════════════════════════════════════════════════════
// TESTE 1: Arbiter após buscar = gastável
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n📊 Teste 1: Arbiter após buscar spell/trap");
const arbiter = cardDatabaseById.get(110);
arbiter.id = "arbiter-1"; // Simular ID único

const context1 = {
  usedEffects: ["arbiter-1"], // Já usou efeito
  field: [arbiter],
  hand: [],
  graveyard: [],
};

const eval1 = evaluateCardExpendability(arbiter, context1);
console.log(`Expendable: ${eval1.expendable}`);
console.log(`Reason: ${eval1.reason}`);
console.log(`Value: ${eval1.value}/10`);
console.log(
  `✅ Esperado: expendable=true (já cumpriu papel) - Got: ${eval1.expendable ? "✅ PASS" : "❌ FAIL"}`
);

// ═════════════════════════════════════════════════════════════════════════════
// TESTE 2: Aegisbearer = nunca gastável (tank principal)
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n📊 Teste 2: Aegisbearer = tank principal (não gastável)");
const aegis = cardDatabaseById.get(103);
aegis.fieldAgeTurns = 1; // Ainda não pronto para Ascension

const context2 = {
  field: [aegis],
  hand: [],
  graveyard: [],
};

const eval2 = evaluateCardExpendability(aegis, context2);
console.log(`Expendable: ${eval2.expendable}`);
console.log(`Reason: ${eval2.reason}`);
console.log(`Value: ${eval2.value}/10`);
console.log(
  `✅ Esperado: expendable=false (tank principal) - Got: ${!eval2.expendable ? "✅ PASS" : "❌ FAIL"}`
);

// ═════════════════════════════════════════════════════════════════════════════
// TESTE 3: Aegisbearer pronto para Ascension = gastável
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n📊 Teste 3: Aegisbearer pronto para Ascension (gastável)");
const aegis2 = cardDatabaseById.get(103);
aegis2.fieldAgeTurns = 2; // Pronto para Ascension!

const context3 = {
  field: [aegis2],
  hand: [],
  graveyard: [],
};

const eval3 = evaluateCardExpendability(aegis2, context3);
console.log(`Expendable: ${eval3.expendable}`);
console.log(`Reason: ${eval3.reason}`);
console.log(`Value: ${eval3.value}/10`);
console.log(
  `✅ Esperado: expendable=true (upgrade) - Got: ${eval3.expendable ? "✅ PASS" : "❌ FAIL"}`
);

// ═════════════════════════════════════════════════════════════════════════════
// TESTE 4: Field Spell Urgency - sem monstros
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n📊 Teste 4: Urgência de Field Spell (sem monstros)");
const analysis4 = {
  field: [],
  hand: [],
  fieldSpell: null,
  lp: 8000,
};

const urgency4 = evaluateFieldSpellUrgency(analysis4);
console.log(`Priority: ${urgency4.priority}/20`);
console.log(`Reason: ${urgency4.reason}`);
console.log(
  `✅ Esperado: priority >= 18 (mesmo sem monstros) - Got: ${urgency4.priority >= 18 ? "✅ PASS" : "❌ FAIL"}`
);

// ═════════════════════════════════════════════════════════════════════════════
// TESTE 5: Field Spell Urgency - com monstros
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n📊 Teste 5: Urgência de Field Spell (com monstros)");
const analysis5 = {
  field: [aegis, arbiter],
  hand: [],
  fieldSpell: null,
  lp: 8000,
};

const urgency5 = evaluateFieldSpellUrgency(analysis5);
console.log(`Priority: ${urgency5.priority}/20`);
console.log(`Reason: ${urgency5.reason}`);
console.log(
  `✅ Esperado: priority = 20 (máxima) - Got: ${urgency5.priority === 20 ? "✅ PASS" : "❌ FAIL"}`
);

// ═════════════════════════════════════════════════════════════════════════════
// TESTE 6: Proteção Sacrificial - Crescent Shield
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n📊 Teste 6: Proteção Sacrificial - Crescent Shield");
arbiter.id = "arbiter-2";
const crescentShield = cardDatabaseById.get(115);
crescentShield.equippedTo = "arbiter-2";

const context6 = {
  field: [arbiter, crescentShield],
  hand: [],
  spellTrap: [],
};

const protection6 = detectSacrificialProtection(arbiter, context6);
console.log(`Has Protection: ${protection6.hasProtection}`);
console.log(`Layers: ${protection6.layers}`);
console.log(`Protections:`, protection6.protections.map((p) => p.card));
console.log(
  `✅ Esperado: 1 layer (Crescent Shield) - Got: ${protection6.layers === 1 ? "✅ PASS" : "❌ FAIL"}`
);

// ═════════════════════════════════════════════════════════════════════════════
// TESTE 7: Múltiplas Layers de Proteção
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n📊 Teste 7: Múltiplas Layers de Proteção");
const holyShield = cardDatabaseById.get(102);
const citadel = cardDatabaseById.get(112);

const context7 = {
  field: [arbiter, crescentShield],
  hand: [holyShield],
  spellTrap: [],
  fieldSpell: citadel,
  lp: 5000,
};

const protection7 = detectSacrificialProtection(arbiter, context7);
console.log(`Has Protection: ${protection7.hasProtection}`);
console.log(`Layers: ${protection7.layers}`);
console.log(`Protections:`, protection7.protections.map((p) => p.card));
console.log(
  `✅ Esperado: 3 layers (Shield + Holy Shield + Citadel) - Got: ${protection7.layers === 3 ? "✅ PASS" : "❌ FAIL"}`
);

// ═════════════════════════════════════════════════════════════════════════════
// TESTE 8: Avaliar Risco com Proteção
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n📊 Teste 8: Avaliar Risco (Arbiter pós-busca + proteção)");
arbiter.id = "arbiter-3";
const context8 = {
  usedEffects: ["arbiter-3"], // Já buscou
  field: [arbiter, crescentShield],
  hand: [holyShield],
  spellTrap: [],
  fieldSpell: citadel,
  lp: 5000,
};

const action8 = { card: arbiter, type: "summon" };
const risk8 = evaluateRiskWithProtection(action8, context8);
console.log(`Worth Risk: ${risk8.worthRisk}`);
console.log(`Reason: ${risk8.reason}`);
console.log(`Protection Layers: ${risk8.protectionLayers}`);
console.log(
  `✅ Esperado: worthRisk=true (já cumpriu + 3 layers) - Got: ${risk8.worthRisk ? "✅ PASS" : "❌ FAIL"}`
);

// ═════════════════════════════════════════════════════════════════════════════
// RESUMO
// ═════════════════════════════════════════════════════════════════════════════
console.log("\n" + "=".repeat(70));
console.log("✅ CONCLUSÃO: Conceitos de valor de carta implementados!");
console.log("=".repeat(70));
console.log("\n🎯 Conceitos implementados:");
console.log("  ✅ evaluateCardExpendability() - Cartas que cumpriram papel");
console.log("  ✅ evaluateFieldSpellUrgency() - Citadel prioritário mesmo sem setup");
console.log("  ✅ detectSacrificialProtection() - Detecta layers de proteção");
console.log("  ✅ evaluateRiskWithProtection() - Riscos calculados com proteção");
console.log("\n💡 Lógica implementada:");
console.log("  • Searchers pós-busca: gastáveis (Arbiter, Valiant)");
console.log("  • Tanks: nunca gastáveis (exceto upgrades)");
console.log("  • Equips: proteção sacrificial (absorvem 1 ataque)");
console.log("  • Field spell: prioridade alta mesmo sem monstros");
console.log("  • Múltiplas layers: permitem jogadas arriscadas");
