/**
 * test-fusion-priority.js
 * Valida o sistema de prioridade de fusão - Hand 3 específico
 */

import {
  detectFusionOpportunities,
  calculatePowerSwing,
  isMaterialExpendable,
  shouldPrioritizeFusion,
  evaluateFusionPriority,
} from "./src/core/ai/luminarch/fusionPriority.js";

console.log("=== TESTE: FUSION PRIORITY SYSTEM ===\n");

// === CENÁRIO: Hand 3 (análise do usuário) ===
// Mão: Holy Shield, Sanctum Protector, Moonlit Blessing, Polymerization, Aegisbearer
// Oponente: 2 monstros (2400 ATK + 1800 ATK)
// Esperado: Fusion (Barbarias 3300 ATK) > Defense (Protector 2800 DEF)

const mockContext = {
  hand: [
    { name: "Luminarch Holy Shield", cardKind: "spell", subtype: "quick", speed: 2 },
    { name: "Luminarch Sanctum Protector", cardKind: "monster", atk: 2300, def: 2800, level: 6 },
    { name: "Moonlit Blessing", cardKind: "spell", subtype: "normal" },
    { name: "Polymerization", cardKind: "spell", subtype: "normal" },
    { name: "Luminarch Aegisbearer", cardKind: "monster", atk: 1800, def: 2000, level: 4 }
  ],
  field: [], // Campo vazio
  opponent: {
    field: [
      { name: "Enemy 1", cardKind: "monster", atk: 2400, position: "attack" },
      { name: "Enemy 2", cardKind: "monster", atk: 1800, position: "attack" }
    ],
    lp: 8000
  }
};

// === TESTE 1: Detectar oportunidade de fusão ===
console.log("TEST 1: Detectar Polymerization + Materiais (Protector + Aegis → Barbarias)");
const opportunities = detectFusionOpportunities(mockContext);
console.log(`  Oportunidades detectadas: ${opportunities.length}`);
if (opportunities.length > 0) {
  const opp = opportunities[0];
  console.log(`  ✅ Fusão: ${opp.fusionName}`);
  console.log(`  ✅ Materiais: ${opp.materials.map(m => m.name).join(" + ")}`);
  console.log(`  ✅ Stats: ${opp.stats.atk} ATK / ${opp.stats.def} DEF`);
} else {
  console.log("  ❌ FALHOU: Não detectou oportunidade de fusão");
}

console.log("\n" + "=".repeat(50) + "\n");

// === TESTE 2: Calcular power swing ===
if (opportunities.length > 0) {
  console.log("TEST 2: Calcular Power Swing (Board State Change)");
  const opportunity = opportunities[0];
  const swing = calculatePowerSwing(opportunity, mockContext);
  
  console.log(`  ATK atual no campo: ${swing.details.currentBoardATK}`);
  console.log(`  ATK pós-fusão: ${swing.details.postFusionBoardATK}`);
  console.log(`  Power swing: ${swing.swing > 0 ? '+' : ''}${swing.swing}`);
  console.log(`  Boss ATK: ${swing.details.fusionATK}`);
  console.log(`  Oponente max ATK: ${swing.details.opponentMaxATK}`);
  console.log(`  Oponente total ATK: ${swing.details.opponentTotalATK}`);
  console.log(`  Boss domina ameaça máxima: ${swing.details.bossDominatesMaxThreat ? '✅' : '❌'}`);
  console.log(`  Boss domina board total: ${swing.details.bossDominatesBoard ? '✅' : '❌'}`);
  console.log(`  Dominância geral: ${swing.dominates ? '✅ SIM' : '❌ NÃO'}`);
  console.log(`  Potencial de destruição: ${swing.details.potentialKills} monstros`);

  if (swing.dominates && swing.swing >= 0) {
    console.log(`  ✅ CORRETO: Boss domina (3300 > 2400) + swing positivo`);
  } else {
    console.log(`  ❌ FALHOU: Deveria detectar dominância`);
  }
}

console.log("\n" + "=".repeat(50) + "\n");

// === TESTE 3: Materiais expendable ===
if (opportunities.length > 0) {
  console.log("TEST 3: Avaliar Materiais como Expendable");
  const opportunity = opportunities[0];
  
  const protectorExpendable = isMaterialExpendable(
    mockContext.hand.find(c => c.name === "Luminarch Sanctum Protector"),
    opportunity,
    mockContext
  );
  
  const aegisExpendable = isMaterialExpendable(
    mockContext.hand.find(c => c.name === "Luminarch Aegisbearer"),
    opportunity,
    mockContext
  );

  console.log(`  Sanctum Protector expendable: ${protectorExpendable ? '✅' : '❌'}`);
  console.log(`    Razão: 2500 ATK boss + LP doubling > 2800 DEF tank`);
  console.log(`  Aegisbearer expendable: ${aegisExpendable ? '✅' : '❌'}`);
  console.log(`    Razão: Na mão, vai direto pra fusão (não precisa summon)`);

  if (protectorExpendable && aegisExpendable) {
    console.log(`  ✅ CORRETO: Ambos materiais expendable para fusão`);
  } else {
    console.log(`  ❌ FALHOU: Deveria considerar materiais expendable`);
  }
}

console.log("\n" + "=".repeat(50) + "\n");

// === TESTE 4: Decisão de prioridade ===
if (opportunities.length > 0) {
  console.log("TEST 4: Decisão - Fusion > Defense?");
  const opportunity = opportunities[0];
  const decision = shouldPrioritizeFusion(opportunity, mockContext);

  console.log(`  Deve priorizar fusão: ${decision.shouldPrioritize ? '✅' : '❌'}`);
  console.log(`  Prioridade: ${decision.priority}`);
  console.log(`  Razão: ${decision.reason}`);

  if (decision.shouldPrioritize && decision.priority >= 17) {
    console.log(`  ✅ CORRETO: Fusão tem prioridade alta (≥17)`);
  } else {
    console.log(`  ❌ FALHOU: Fusão deveria ter prioridade ≥17`);
  }
}

console.log("\n" + "=".repeat(50) + "\n");

// === TESTE 5: Função principal (evaluateFusionPriority) ===
console.log("TEST 5: Função Principal - evaluateFusionPriority");
const bestOpportunity = evaluateFusionPriority(mockContext);

if (bestOpportunity) {
  console.log(`  ✅ Melhor oportunidade: ${bestOpportunity.fusionName}`);
  console.log(`  ✅ Prioridade: ${bestOpportunity.decision.priority}`);
  console.log(`  ✅ Deve priorizar: ${bestOpportunity.decision.shouldPrioritize ? 'SIM' : 'NÃO'}`);
  console.log(`  ✅ Power swing: ${bestOpportunity.powerSwing.swing > 0 ? '+' : ''}${bestOpportunity.powerSwing.swing}`);
  console.log(`  ✅ Dominância: ${bestOpportunity.powerSwing.dominates ? 'SIM' : 'NÃO'}`);
  console.log(`  ✅ Razão: ${bestOpportunity.decision.reason}`);
} else {
  console.log(`  ❌ FALHOU: Não retornou oportunidade de fusão`);
}

console.log("\n" + "=".repeat(50) + "\n");

// === TESTE 6: Cenário contrário - Fusion NÃO deve ser priorizada ===
console.log("TEST 6: Cenário Negativo - Boss NÃO domina");
const weakContext = {
  hand: [
    { name: "Polymerization", cardKind: "spell" },
    { name: "Valiant Shieldbearer", cardKind: "monster", atk: 1600, def: 2000, level: 4 },
    { name: "Light Sentinel", cardKind: "monster", atk: 1800, def: 1600, level: 4 }
  ],
  field: [],
  opponent: {
    field: [
      { name: "Boss Enemy", cardKind: "monster", atk: 3500, position: "attack" }, // Boss oponente muito forte
      { name: "Enemy 2", cardKind: "monster", atk: 2500, position: "attack" }
    ],
    lp: 8000
  }
};

const weakOpportunities = detectFusionOpportunities(weakContext);
if (weakOpportunities.length > 0) {
  const weakDecision = shouldPrioritizeFusion(weakOpportunities[0], weakContext);
  console.log(`  Deve priorizar fusão: ${weakDecision.shouldPrioritize ? '❌ SIM (ERRADO)' : '✅ NÃO (CORRETO)'}`);
  console.log(`  Prioridade: ${weakDecision.priority}`);
  console.log(`  Razão: ${weakDecision.reason}`);
  
  if (!weakDecision.shouldPrioritize || weakDecision.priority < 14) {
    console.log(`  ✅ CORRETO: Não prioriza fusão quando boss não domina`);
  } else {
    console.log(`  ❌ FALHOU: Não deveria priorizar fusão fraca`);
  }
} else {
  console.log(`  ℹ️ Nenhuma fusão detectada (Valiant+Sentinel não tem fusão registrada)`);
}

console.log("\n" + "=".repeat(50));
console.log("\n✅ TESTE CONCLUÍDO - Sistema de Fusion Priority implementado\n");
