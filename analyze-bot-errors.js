/**
 * Análise de ERROS e JOGADAS SEM SENTIDO do Bot
 */

import fs from "fs";

const logPath = "./Log Bot Arena.txt";
const logContent = fs.readFileSync(logPath, "utf-8");
const lines = logContent.split("\n");

console.log("═══════════════════════════════════════════════════════════");
console.log("🔍 ANÁLISE DE ERROS E JOGADAS SEM SENTIDO");
console.log("═══════════════════════════════════════════════════════════\n");

// ═════════════════════════════════════════════════════════════════════════
// 1. COMBOS DETECTADOS MAS NÃO EXECUTADOS
// ═════════════════════════════════════════════════════════════════════════

console.log("1️⃣  COMBOS DETECTADOS VS AÇÕES EXECUTADAS\n");

const turnoSections = [];
let currentSection = [];

// Dividir log em seções de turno
lines.forEach((line, idx) => {
  if (line.includes("TURNO") && line.includes("────")) {
    if (currentSection.length > 0) {
      turnoSections.push(currentSection.join("\n"));
    }
    currentSection = [line];
  } else {
    currentSection.push(line);
  }
});

if (currentSection.length > 0) {
  turnoSections.push(currentSection.join("\n"));
}

// Analisar cada turno
let comboIgnoradoCount = 0;
const comboIgnorados = [];

turnoSections.forEach((section, idx) => {
  const combosMatch = section.match(/Combos detectados:.*?\[(.*?)\]/);
  const chosenMatch = section.match(/Chosen:.*?-(.*?)\(/);
  
  if (combosMatch && chosenMatch) {
    const combos = combosMatch[1];
    const chosen = chosenMatch[1].trim();
    
    // Verificar se algum combo de alta prioridade foi ignorado
    if (combos.includes("Arbiter → Citadel") && !chosen.includes("Arbiter")) {
      comboIgnoradoCount++;
      comboIgnorados.push({
        turno: idx + 1,
        comboIgnorado: "Arbiter → Citadel",
        escolhido: chosen,
      });
    }
    
    if (combos.includes("Moonblade + Halberd Chain") && !chosen.includes("Moonblade") && !chosen.includes("Halberd")) {
      comboIgnoradoCount++;
      comboIgnorados.push({
        turno: idx + 1,
        comboIgnorado: "Moonblade + Halberd Chain",
        escolhido: chosen,
      });
    }
  }
});

console.log(`  Combos ignorados encontrados: ${comboIgnoradoCount}\n`);

if (comboIgnorados.length > 0) {
  console.log("  Exemplos (primeiros 10):");
  comboIgnorados.slice(0, 10).forEach((item) => {
    console.log(`    Turno ${item.turno}: Ignorou "${item.comboIgnorado}", escolheu "${item.escolhido}"`);
  });
  console.log();
}

// ═════════════════════════════════════════════════════════════════════════
// 2. BEAM SEARCH ESCOLHENDO OPÇÃO INFERIOR
// ═════════════════════════════════════════════════════════════════════════

console.log("2️⃣  BEAM SEARCH - ESCOLHAS SUSPEITAS\n");

const beamChoices = [];

turnoSections.forEach((section, idx) => {
  const chosenMatch = section.match(/Chosen: #(\d+)\/(\d+) - (.*?)\(p:(\d+)\)/);
  
  if (chosenMatch) {
    const position = parseInt(chosenMatch[1]);
    const total = parseInt(chosenMatch[2]);
    const action = chosenMatch[3].trim();
    const priority = parseInt(chosenMatch[4]);
    
    // Se escolheu #2 ou #3 de 3 ações, pode ser suspeito
    if (position > 1 && total >= 2) {
      beamChoices.push({
        turno: idx + 1,
        position,
        total,
        action,
        priority,
        coherence: section.match(/Coherence: (\d+)%/)?.[1] || "N/A",
      });
    }
  }
});

console.log(`  Escolhas não-prioritárias: ${beamChoices.length}\n`);

if (beamChoices.length > 0) {
  console.log("  Análise (primeiros 15):");
  beamChoices.slice(0, 15).forEach((item) => {
    console.log(`    T${item.turno}: Escolheu #${item.position}/${item.total} - ${item.action} (p:${item.priority}, coherence:${item.coherence}%)`);
  });
  console.log();
}

// ═════════════════════════════════════════════════════════════════════════
// 3. RECURSOS DESPERDIÇADOS
// ═════════════════════════════════════════════════════════════════════════

console.log("3️⃣  RECURSOS DESPERDIÇADOS\n");

// Buscar por "set_spell_trap" quando field está cheio
const setActions = lines.filter((l) => l.includes("set_spell_trap") && l.includes("priority"));

console.log(`  Set spell/trap ações: ${setActions.length}`);

// Buscar passes quando tinha ações disponíveis
const passWithActions = [];

turnoSections.forEach((section, idx) => {
  const hasActions = section.includes("ações geradas");
  const passed = section.includes("Nenhuma ação escolhida") || section.includes("pass");
  
  if (hasActions && passed) {
    const actionsMatch = section.match(/(\d+) ações geradas/);
    if (actionsMatch && parseInt(actionsMatch[1]) > 0) {
      passWithActions.push({
        turno: idx + 1,
        actionsAvailable: parseInt(actionsMatch[1]),
      });
    }
  }
});

console.log(`  Passes com ações disponíveis: ${passWithActions.length}`);

if (passWithActions.length > 0) {
  console.log("\n  Exemplos:");
  passWithActions.slice(0, 5).forEach((item) => {
    console.log(`    T${item.turno}: Passou com ${item.actionsAvailable} ações disponíveis`);
  });
}

console.log();

// ═════════════════════════════════════════════════════════════════════════
// 4. ERROS DE EXECUÇÃO
// ═════════════════════════════════════════════════════════════════════════

console.log("4️⃣  ERROS DE EXECUÇÃO\n");

const errors = lines.filter((l) => 
  l.includes("❌") || 
  l.includes("ERROR") || 
  l.includes("ERRO") ||
  l.includes("failed") ||
  l.includes("undefined") ||
  l.includes("null is not")
);

console.log(`  Linhas com indicadores de erro: ${errors.length}`);

// Tipos específicos
const rejeitados = lines.filter((l) => l.includes("❌ REJEITADO"));
const bloqueados = lines.filter((l) => l.includes("❌ Bloqueado") || l.includes("❌ BLOCKED"));

console.log(`    - Summons rejeitados: ${rejeitados.length}`);
console.log(`    - Ações bloqueadas: ${bloqueados.length}`);

console.log();

// ═════════════════════════════════════════════════════════════════════════
// 5. DECISÕES CONTRADITÓRIAS
// ═════════════════════════════════════════════════════════════════════════

console.log("5️⃣  DECISÕES CONTRADITÓRIAS\n");

const contradicoes = [];

// Buscar padrões: "APROVADO" seguido de não ser escolhido
turnoSections.forEach((section, idx) => {
  const aprovedActions = [];
  const sectionLines = section.split("\n");
  
  sectionLines.forEach((line) => {
    if (line.includes("✅ APROVADO") || line.includes("✅ Summon válido")) {
      // Extrair nome da carta/ação
      const cardMatch = line.match(/(?:Avaliando|Summon válido:)\s*(Luminarch [^-\n]+)/);
      if (cardMatch) {
        aprovedActions.push(cardMatch[1].trim());
      }
    }
  });
  
  const chosenMatch = section.match(/Chosen:.*?-(.*?)\(/);
  
  if (aprovedActions.length > 1 && chosenMatch) {
    const chosen = chosenMatch[1].trim();
    const notChosen = aprovedActions.filter((a) => !chosen.includes(a.split(" ").slice(1, 3).join(" ")));
    
    if (notChosen.length > 0 && notChosen.length < aprovedActions.length) {
      contradicoes.push({
        turno: idx + 1,
        aprovados: aprovedActions.length,
        escolhido: chosen,
        ignorados: notChosen.slice(0, 3),
      });
    }
  }
});

console.log(`  Turnos com múltiplas opções aprovadas: ${contradicoes.length}\n`);

if (contradicoes.length > 0) {
  console.log("  Exemplos (primeiros 10):");
  contradicoes.slice(0, 10).forEach((item) => {
    console.log(`    T${item.turno}: ${item.aprovados} aprovados, escolheu "${item.escolhido}"`);
    console.log(`              Ignorou: ${item.ignorados.join(", ")}`);
  });
}

console.log();

// ═════════════════════════════════════════════════════════════════════════
// 6. PRIORIDADES INVERTIDAS
// ═════════════════════════════════════════════════════════════════════════

console.log("6️⃣  PRIORIDADES APARENTEMENTE INVERTIDAS\n");

const priorityIssues = [];

turnoSections.forEach((section, idx) => {
  // Buscar todas as ações com prioridades
  const actionMatches = [...section.matchAll(/- (summon|spell|set_spell_trap): (.*?) \(priority: ([\d.-]+)\)/g)];
  const chosenMatch = section.match(/Chosen:.*?-(.*?)\(p:([\d.-]+)\)/);
  
  if (actionMatches.length > 1 && chosenMatch) {
    const chosenPriority = parseFloat(chosenMatch[2]);
    
    // Verificar se havia ações com prioridade maior
    const higherPriorityActions = actionMatches.filter((m) => {
      const priority = parseFloat(m[3]);
      return priority > chosenPriority + 1; // +1 de margem
    });
    
    if (higherPriorityActions.length > 0) {
      priorityIssues.push({
        turno: idx + 1,
        escolhido: chosenMatch[1].trim(),
        escolhidoPriority: chosenPriority,
        ignoradoMaiorPriority: higherPriorityActions[0][2] + " (p:" + higherPriorityActions[0][3] + ")",
      });
    }
  }
});

console.log(`  Casos de prioridade invertida: ${priorityIssues.length}\n`);

if (priorityIssues.length > 0) {
  console.log("  Exemplos (primeiros 10):");
  priorityIssues.slice(0, 10).forEach((item) => {
    console.log(`    T${item.turno}: Escolheu "${item.escolhido}" (p:${item.escolhidoPriority})`);
    console.log(`              Ignorou "${item.ignoradoMaiorPriority}"`);
  });
}

console.log();

// ═════════════════════════════════════════════════════════════════════════
// 7. SITUAÇÕES ESPECÍFICAS PROBLEMÁTICAS
// ═════════════════════════════════════════════════════════════════════════

console.log("7️⃣  SITUAÇÕES ESPECÍFICAS PROBLEMÁTICAS\n");

// Invocar sem field spell quando há field spell na mão
let noFieldSpellInvoke = 0;

turnoSections.forEach((section) => {
  const hasFieldSpellInHand = section.includes("Sanctum of the Luminarch Citadel") && section.includes("Hand");
  const noFieldSpellActive = section.includes("Field Spell: (nenhum)");
  const summoned = section.match(/Chosen.*summon/);
  
  if (hasFieldSpellInHand && noFieldSpellActive && summoned) {
    noFieldSpellInvoke++;
  }
});

console.log(`  Summons sem field spell (tendo na mão): ${noFieldSpellInvoke}`);

// Não usar Arbiter quando não tem field spell
let missedArbiterOpportunity = 0;

turnoSections.forEach((section) => {
  const hasArbiter = section.includes("Luminarch Sanctified Arbiter") && section.includes("Hand");
  const noFieldSpell = section.includes("Field Spell: (nenhum)");
  const earlyGame = section.includes("Early game") || section.includes("T1") || section.includes("T2");
  const didntSummonArbiter = !section.match(/Chosen.*Arbiter/);
  
  if (hasArbiter && noFieldSpell && earlyGame && didntSummonArbiter) {
    missedArbiterOpportunity++;
  }
});

console.log(`  Não usou Arbiter early game sem field spell: ${missedArbiterOpportunity}`);

console.log();

console.log("═══════════════════════════════════════════════════════════");
console.log("✅ ANÁLISE DE ERROS COMPLETA");
console.log("═══════════════════════════════════════════════════════════");
