/**
 * Análise PROFUNDA dos PASSES COM AÇÕES DISPONÍVEIS
 */

import fs from "fs";

const logPath = "./Log Bot Arena.txt";
const logContent = fs.readFileSync(logPath, "utf-8");
const lines = logContent.split("\n");

console.log("═══════════════════════════════════════════════════════════");
console.log("🔍 ANÁLISE PROFUNDA: PASSES COM AÇÕES DISPONÍVEIS");
console.log("═══════════════════════════════════════════════════════════\n");

// Dividir log em seções de turno
const turnoSections = [];
let currentSection = { lines: [], startIdx: 0 };

lines.forEach((line, idx) => {
  if (line.includes("TURNO") && line.includes("────")) {
    if (currentSection.lines.length > 0) {
      turnoSections.push(currentSection);
    }
    currentSection = { lines: [line], startIdx: idx };
  } else {
    currentSection.lines.push(line);
  }
});

if (currentSection.lines.length > 0) {
  turnoSections.push(currentSection);
}

console.log(`Total de turnos analisados: ${turnoSections.length}\n`);

// Analisar cada turno buscando passes suspeitos
const passesSuspeitos = [];

turnoSections.forEach((section, idx) => {
  const sectionText = section.lines.join("\n");
  
  // Buscar: "X ações geradas"
  const acoesGeradasMatch = sectionText.match(/(\d+) ações geradas/);
  
  // Buscar sinais de que não executou nada:
  const naoExecutou = 
    sectionText.includes("Nenhuma ação escolhida") ||
    sectionText.includes("No action chosen") ||
    sectionText.includes("Passing turn") ||
    (sectionText.includes("Resumo:") && sectionText.includes("ações geradas") && 
     !sectionText.includes("Chosen:"));
  
  // Buscar se beam search foi executado mas retornou null/undefined
  const beamSearchRodou = sectionText.includes("Running beam search");
  const beamSearchFalhou = 
    sectionText.includes("Beam search result: null") ||
    sectionText.includes("Beam search result: undefined") ||
    (beamSearchRodou && !sectionText.includes("Beam search chose"));
  
  if (acoesGeradasMatch && parseInt(acoesGeradasMatch[1]) > 0 && (naoExecutou || beamSearchFalhou)) {
    const numAcoes = parseInt(acoesGeradasMatch[1]);
    
    // Extrair informações contextuais
    const handMatch = sectionText.match(/Hand \((\d+)\):/);
    const fieldMatch = sectionText.match(/Field \((\d+)\):/);
    const lpMatch = sectionText.match(/LP: (\d+)/);
    const oppLpMatch = sectionText.match(/vs (\d+) LP/);
    const stanceMatch = sectionText.match(/Stance: (\w+)/);
    
    // Buscar as ações que foram geradas
    const acoesGeradas = [];
    const acaoMatches = [...sectionText.matchAll(/- (summon|spell|set_spell_trap|spellTrapEffect): (.*?) \(priority: ([\d.-]+)\)/g)];
    acaoMatches.forEach(match => {
      acoesGeradas.push({
        tipo: match[1],
        carta: match[2].trim(),
        prioridade: parseFloat(match[3])
      });
    });
    
    // Buscar razão do passe (se houver)
    const razaoMatch = sectionText.match(/(?:Nenhuma ação escolhida|No action chosen|Passing)[:\s]+(.*?)(?:\n|$)/);
    
    // Buscar se houve algum erro durante beam search
    const erroMatch = sectionText.match(/ERROR|error|undefined|null is not|failed/i);
    
    passesSuspeitos.push({
      turno: idx + 1,
      lineStart: section.startIdx,
      numAcoes,
      handSize: handMatch ? parseInt(handMatch[1]) : "?",
      fieldSize: fieldMatch ? parseInt(fieldMatch[1]) : "?",
      lp: lpMatch ? parseInt(lpMatch[1]) : "?",
      oppLp: oppLpMatch ? parseInt(oppLpMatch[1]) : "?",
      stance: stanceMatch ? stanceMatch[1] : "?",
      acoesGeradas,
      beamSearchRodou,
      beamSearchFalhou,
      razao: razaoMatch ? razaoMatch[1].trim() : "Desconhecida",
      temErro: !!erroMatch
    });
  }
});

console.log(`🚨 PASSES SUSPEITOS ENCONTRADOS: ${passesSuspeitos.length}\n`);
console.log("═══════════════════════════════════════════════════════════\n");

// Analisar cada passe em detalhe
passesSuspeitos.forEach((passe, idx) => {
  console.log(`\n📍 PASSE #${idx + 1} - Turno ${passe.turno} (linha ${passe.lineStart})`);
  console.log("─────────────────────────────────────────────────────");
  console.log(`Estado do jogo:`);
  console.log(`  LP: ${passe.lp} vs ${passe.oppLp}`);
  console.log(`  Mão: ${passe.handSize} cartas | Campo: ${passe.fieldSize} monstros`);
  console.log(`  Stance: ${passe.stance}`);
  console.log();
  console.log(`Ações disponíveis: ${passe.numAcoes}`);
  
  if (passe.acoesGeradas.length > 0) {
    console.log(`Ações geradas:`);
    passe.acoesGeradas.forEach((acao, i) => {
      console.log(`  ${i + 1}. ${acao.tipo}: ${acao.carta} (priority: ${acao.prioridade})`);
    });
  } else {
    console.log(`  ⚠️ Não foi possível extrair lista de ações`);
  }
  
  console.log();
  console.log(`Beam Search:`);
  console.log(`  Rodou: ${passe.beamSearchRodou ? "✅ Sim" : "❌ Não"}`);
  console.log(`  Falhou: ${passe.beamSearchFalhou ? "🔴 SIM" : "✅ Não"}`);
  
  if (passe.temErro) {
    console.log(`  ⚠️ Erro detectado no log desta seção`);
  }
  
  console.log();
  console.log(`Razão do passe: ${passe.razao}`);
});

// Estatísticas agregadas
console.log("\n\n═══════════════════════════════════════════════════════════");
console.log("📊 ESTATÍSTICAS DOS PASSES");
console.log("═══════════════════════════════════════════════════════════\n");

const comBeamSearch = passesSuspeitos.filter(p => p.beamSearchRodou).length;
const beamSearchFalhou = passesSuspeitos.filter(p => p.beamSearchFalhou).length;
const comErro = passesSuspeitos.filter(p => p.temErro).length;

console.log(`Passes totais: ${passesSuspeitos.length}`);
console.log(`  Com Beam Search executado: ${comBeamSearch} (${((comBeamSearch/passesSuspeitos.length)*100).toFixed(1)}%)`);
console.log(`  Beam Search falhou: ${beamSearchFalhou} (${((beamSearchFalhou/passesSuspeitos.length)*100).toFixed(1)}%)`);
console.log(`  Com erro no log: ${comErro} (${((comErro/passesSuspeitos.length)*100).toFixed(1)}%)`);

// Distribuição de ações disponíveis
const distribuicaoAcoes = {};
passesSuspeitos.forEach(p => {
  distribuicaoAcoes[p.numAcoes] = (distribuicaoAcoes[p.numAcoes] || 0) + 1;
});

console.log();
console.log("Distribuição por número de ações:");
Object.entries(distribuicaoAcoes).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).forEach(([num, count]) => {
  console.log(`  ${num} ações: ${count} passes`);
});

// Stance distribution
const distribuicaoStance = {};
passesSuspeitos.forEach(p => {
  distribuicaoStance[p.stance] = (distribuicaoStance[p.stance] || 0) + 1;
});

console.log();
console.log("Distribuição por stance:");
Object.entries(distribuicaoStance).sort((a, b) => b[1] - a[1]).forEach(([stance, count]) => {
  console.log(`  ${stance}: ${count} passes`);
});

// Prioridades das ações ignoradas
const prioridadesIgnoradas = passesSuspeitos.flatMap(p => 
  p.acoesGeradas.map(a => a.prioridade)
).filter(p => !isNaN(p));

if (prioridadesIgnoradas.length > 0) {
  const maxPrio = Math.max(...prioridadesIgnoradas);
  const minPrio = Math.min(...prioridadesIgnoradas);
  const avgPrio = prioridadesIgnoradas.reduce((a, b) => a + b, 0) / prioridadesIgnoradas.length;
  
  console.log();
  console.log("Prioridades das ações ignoradas:");
  console.log(`  Máxima: ${maxPrio.toFixed(2)}`);
  console.log(`  Mínima: ${minPrio.toFixed(2)}`);
  console.log(`  Média: ${avgPrio.toFixed(2)}`);
}

console.log("\n═══════════════════════════════════════════════════════════");
console.log("✅ ANÁLISE PROFUNDA COMPLETA");
console.log("═══════════════════════════════════════════════════════════");
