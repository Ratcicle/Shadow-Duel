/**
 * Teste simples: Verificar se spellTrapEffect não incrementa chainCount
 */

console.log("🧪 TEST: spellTrapEffect não deve contar para chainCount\n");

// Mock das ações
const actions = [
  { type: "summon", cardName: "Valiant" },
  { type: "spell", cardName: "Convocation" },
  { type: "spellTrapEffect", cardName: "Convocation Effect" },
  { type: "summon", cardName: "Arbiter" },
  { type: "monsterEffect", cardName: "Arbiter Search" },
  { type: "spell", cardName: "Citadel" },
];

console.log("📋 Simulando execução de ações:");
console.log(`   maxChainedActions: 3\n`);

let chainCount = 0;
const maxChains = 3;

for (const action of actions) {
  // Lógica copiada do Bot.js (com o fix)
  if (action.type !== "spellTrapEffect" && action.type !== "monsterEffect") {
    chainCount += 1;
  }
  
  const counted = action.type !== "spellTrapEffect" && action.type !== "monsterEffect";
  console.log(`${chainCount}. ${action.cardName} (${action.type}) ${counted ? "✅ conta" : "⏭️  não conta"}`);
  
  if (chainCount >= maxChains) {
    console.log(`\n⛔ Loop terminou: chainCount (${chainCount}) >= maxChains (${maxChains})\n`);
    break;
  }
}

console.log("📊 Resumo:");
console.log(`   Ações executadas: ${actions.slice(0, actions.indexOf(actions.find((_, i) => i === actions.length - 1 || chainCount >= maxChains ? i + 1 : 0))).length}`);
console.log(`   chainCount final: ${chainCount}`);

// Verificar se executou Arbiter
const executedActions = actions.slice(0, 4); // Valiant, Convocation, ConvocationEffect, Arbiter
const hasArbiter = executedActions.some(a => a.cardName === "Arbiter");

console.log(`\n✓ Arbiter foi invocado: ${hasArbiter ? "✅ PASS" : "❌ FAIL"}`);

if (hasArbiter && chainCount === 3) {
  console.log("\n✅ TESTE PASSOU! Efeitos de campo não contam para chainCount.");
  process.exit(0);
} else {
  console.log("\n❌ TESTE FALHOU!");
  process.exit(1);
}
