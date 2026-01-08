#!/usr/bin/env node
/**
 * Ferramenta unificada de análise de logs do Bot Arena
 * Consolida todas as análises em um único arquivo
 */

import fs from 'fs';

const args = process.argv.slice(2);
const mode = args[0] || 'stats';
const logFile = args[1] || 'Log Bot Arena.log';

// Verifica se arquivo existe
if (!fs.existsSync(logFile)) {
  console.error(`❌ Arquivo não encontrado: ${logFile}`);
  console.log('\nUso: node analyze-logs.js [modo] [arquivo]');
  console.log('\nModos disponíveis:');
  console.log('  stats     - Estatísticas gerais (padrão)');
  console.log('  flow      - Análise de fluxo de duelos');
  console.log('  loops     - Detectar loops infinitos');
  console.log('  errors    - Erros e jogadas sem sentido');
  console.log('  passes    - Passes com ações disponíveis');
  console.log('  all       - Todas as análises');
  process.exit(1);
}

const log = fs.readFileSync(logFile, 'utf-8');
const lines = log.split('\n');

// ═══════════════════════════════════════════════════════════════════════════
// MODO 1: ESTATÍSTICAS GERAIS
// ═══════════════════════════════════════════════════════════════════════════
function analyzeStats() {
  console.log('═'.repeat(70));
  console.log('📊 ANÁLISE DE ESTATÍSTICAS - BOT ARENA');
  console.log('═'.repeat(70));
  console.log();

  // Parse dos duelos
  const duelos = [];
  let dueloAtual = null;
  const cardUsage = {};
  const actionTypes = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Início de duelo
    if (line.includes('🎮 DUELO #')) {
      const match = line.match(/DUELO #(\d+)/);
      dueloAtual = {
        numero: parseInt(match[1]),
        turnos: 0,
        vencedor: null,
        lpFinal: {},
        actions: []
      };
    }
    
    // Fim de duelo
    if (line.includes('Turnos:') && line.includes('LP Final:')) {
      const turnosMatch = line.match(/Turnos: (\d+)/);
      const lpMatch = line.match(/LP Final: (\d+) vs (\d+)/);
      
      if (dueloAtual && turnosMatch && lpMatch) {
        dueloAtual.turnos = parseInt(turnosMatch[1]);
        dueloAtual.lpFinal = {
          bot1: parseInt(lpMatch[1]),
          bot2: parseInt(lpMatch[2])
        };
        dueloAtual.vencedor = dueloAtual.lpFinal.bot1 > 0 ? 'Bot 1' : 'Bot 2';
        duelos.push(dueloAtual);
        dueloAtual = null;
      }
    }
    
    // Ações escolhidas
    if (line.includes('Chosen:') && line.includes('-')) {
      const cardMatch = line.match(/- ([a-z_]+):([^(]+)/);
      if (cardMatch) {
        const actionType = cardMatch[1];
        const cardName = cardMatch[2].trim();
        
        actionTypes[actionType] = (actionTypes[actionType] || 0) + 1;
        
        if (cardName) {
          cardUsage[cardName] = (cardUsage[cardName] || 0) + 1;
        }
        
        if (dueloAtual) {
          dueloAtual.actions.push({ type: actionType, card: cardName });
        }
      }
    }
  }

  if (duelos.length === 0) {
    console.log('❌ Nenhum duelo encontrado no log.');
    return;
  }

  // 1. Estatísticas Gerais
  const totalTurnos = duelos.reduce((sum, d) => sum + d.turnos, 0);
  const mediaTurnos = totalTurnos / duelos.length;
  const bot1Wins = duelos.filter(d => d.vencedor === 'Bot 1').length;
  const bot2Wins = duelos.filter(d => d.vencedor === 'Bot 2').length;

  console.log('1️⃣  ESTATÍSTICAS GERAIS');
  console.log('─'.repeat(70));
  console.log(`Total de duelos: ${duelos.length}`);
  console.log(`Total de turnos: ${totalTurnos}`);
  console.log(`Média de turnos: ${mediaTurnos.toFixed(1)}`);
  console.log(`Duelo mais curto: ${Math.min(...duelos.map(d => d.turnos))} turnos`);
  console.log(`Duelo mais longo: ${Math.max(...duelos.map(d => d.turnos))} turnos`);
  console.log(`\nWin Rate:`);
  console.log(`  Bot 1: ${bot1Wins} vitórias (${(bot1Wins/duelos.length*100).toFixed(0)}%)`);
  console.log(`  Bot 2: ${bot2Wins} vitórias (${(bot2Wins/duelos.length*100).toFixed(0)}%)`);

  const mediaLPBot1 = duelos.reduce((sum, d) => sum + d.lpFinal.bot1, 0) / duelos.length;
  const mediaLPBot2 = duelos.reduce((sum, d) => sum + d.lpFinal.bot2, 0) / duelos.length;
  console.log(`\nLP Final Médio:`);
  console.log(`  Bot 1: ${mediaLPBot1.toFixed(0)} LP`);
  console.log(`  Bot 2: ${mediaLPBot2.toFixed(0)} LP`);

  // 2. Top Cartas
  console.log('\n\n2️⃣  TOP 15 CARTAS MAIS USADAS');
  console.log('─'.repeat(70));
  const topCards = Object.entries(cardUsage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  const totalCardUsage = Object.values(cardUsage).reduce((a,b) => a+b, 0);
  topCards.forEach(([card, count], idx) => {
    const percent = (count / totalCardUsage * 100).toFixed(1);
    console.log(`${(idx+1).toString().padStart(2)}. ${card.padEnd(40)} ${count.toString().padStart(3)}x (${percent}%)`);
  });

  // 3. Tipos de Ação
  console.log('\n\n3️⃣  DISTRIBUIÇÃO DE TIPOS DE AÇÃO');
  console.log('─'.repeat(70));
  const totalActions = Object.values(actionTypes).reduce((a,b) => a+b, 0);
  const sortedActions = Object.entries(actionTypes)
    .sort((a, b) => b[1] - a[1]);

  sortedActions.forEach(([type, count]) => {
    const percent = (count / totalActions * 100).toFixed(1);
    const bar = '█'.repeat(Math.floor(percent / 2));
    console.log(`${type.padEnd(35)} ${count.toString().padStart(4)}x (${percent.toString().padStart(5)}%) ${bar}`);
  });

  // 4. Eficiência
  console.log('\n\n4️⃣  EFICIÊNCIA DA IA');
  console.log('─'.repeat(70));
  const actionsPerTurn = totalActions / totalTurnos;
  console.log(`Total de ações: ${totalActions}`);
  console.log(`Ações por turno (média): ${actionsPerTurn.toFixed(2)}`);

  const summons = (actionTypes['summon'] || 0);
  const spells = (actionTypes['spell'] || 0) + (actionTypes['spellTrapEffect'] || 0);
  const sets = (actionTypes['set_spell_trap'] || 0);

  console.log(`\nProporção de jogadas:`);
  console.log(`  Summons: ${summons} (${(summons/totalActions*100).toFixed(1)}%)`);
  console.log(`  Spells/Traps: ${spells} (${(spells/totalActions*100).toFixed(1)}%)`);
  console.log(`  Sets: ${sets} (${(sets/totalActions*100).toFixed(1)}%)`);

  // 5. Detalhamento
  console.log('\n\n5️⃣  DETALHAMENTO POR DUELO');
  console.log('─'.repeat(70));
  console.log('Duelo | Turnos | Vencedor | LP Final (B1 vs B2) | Ações');
  console.log('─'.repeat(70));

  duelos.forEach(d => {
    const vencedorStr = d.vencedor === 'Bot 1' ? '🏆 Bot 1' : '   Bot 2 🏆';
    console.log(
      `  #${d.numero.toString().padStart(2)}  |   ${d.turnos.toString().padStart(2)}   | ${vencedorStr} | ` +
      `${d.lpFinal.bot1.toString().padStart(5)} vs ${d.lpFinal.bot2.toString().padStart(5)} | ${d.actions.length}`
    );
  });

  console.log('\n' + '═'.repeat(70));
}

// ═══════════════════════════════════════════════════════════════════════════
// MODO 2: FLUXO DE DUELOS
// ═══════════════════════════════════════════════════════════════════════════
function analyzeFlow() {
  console.log('═'.repeat(70));
  console.log('🔍 ANÁLISE DE FLUXO DE DUELOS');
  console.log('═'.repeat(70));
  console.log();

  const events = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.includes('DUELO #') && line.includes('INICIADO')) {
      const match = line.match(/DUELO #(\d+)/);
      if (match) {
        events.push({
          line: i + 1,
          type: 'START',
          duel: parseInt(match[1]),
          text: line.trim().substring(0, 60)
        });
      }
    }
    
    if (line.includes('Turnos:') && line.includes('LP Final:')) {
      const match = line.match(/Turnos: (\d+)/);
      if (match) {
        events.push({
          line: i + 1,
          type: 'END',
          turnos: parseInt(match[1]),
          text: line.trim().substring(0, 60)
        });
      }
    }
  }

  console.log(`Total de eventos: ${events.length}`);
  console.log(`Duelos iniciados: ${events.filter(e => e.type === 'START').length}`);
  console.log(`Duelos finalizados: ${events.filter(e => e.type === 'END').length}`);
  console.log();

  // Detectar problemas
  let lastStart = null;
  const issues = [];

  events.forEach((event, idx) => {
    if (event.type === 'START') {
      if (lastStart && !events.slice(idx-10, idx).some(e => e.type === 'END')) {
        issues.push({
          type: 'DOUBLE_START',
          duel: event.duel,
          line: event.line,
          prev: lastStart
        });
      }
      lastStart = event;
    }
  });

  if (issues.length > 0) {
    console.log('⚠️  PROBLEMAS DETECTADOS:\n');
    issues.forEach(issue => {
      console.log(`❌ Linha ${issue.line}: Duelo #${issue.duel} iniciou sem finalizar anterior`);
      console.log(`   Duelo anterior: #${issue.prev.duel} (linha ${issue.prev.line})`);
    });
  } else {
    console.log('✅ Nenhum problema de fluxo detectado');
  }

  console.log('\n📋 Timeline de eventos:\n');
  events.forEach(e => {
    const icon = e.type === 'START' ? '🎮' : '🏁';
    const info = e.type === 'START' ? `Duelo #${e.duel}` : `${e.turnos} turnos`;
    console.log(`${icon} Linha ${e.line.toString().padStart(5)}: ${info}`);
  });

  console.log('\n' + '═'.repeat(70));
}

// ═══════════════════════════════════════════════════════════════════════════
// MODO 3: DETECÇÃO DE LOOPS
// ═══════════════════════════════════════════════════════════════════════════
function analyzeLoops() {
  console.log('═'.repeat(70));
  console.log('🔄 DETECÇÃO DE LOOPS INFINITOS');
  console.log('═'.repeat(70));
  console.log();

  const spellActivations = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.includes('Chosen:') && line.includes('spellTrapEffect:')) {
      const match = line.match(/spellTrapEffect:([^(]+)/);
      if (match) {
        spellActivations.push({
          line: i + 1,
          spell: match[1].trim(),
          turno: lines.slice(Math.max(0, i - 100), i)
            .filter(l => l.includes('TURNO'))
            .pop()
        });
      }
    }
  }

  console.log(`Total de ativações de spell/trap: ${spellActivations.length}`);
  console.log();

  // Detectar sequências suspeitas
  const sequences = {};
  
  for (let i = 0; i < spellActivations.length - 1; i++) {
    const current = spellActivations[i];
    const next = spellActivations[i + 1];
    
    if (next.line - current.line < 50 && current.spell === next.spell) {
      const key = current.spell;
      if (!sequences[key]) sequences[key] = [];
      sequences[key].push(current.line);
    }
  }

  const loops = Object.entries(sequences).filter(([_, lines]) => lines.length > 5);
  
  if (loops.length > 0) {
    console.log('⚠️  LOOPS DETECTADOS:\n');
    loops.forEach(([spell, lineNums]) => {
      console.log(`❌ ${spell}: ${lineNums.length} ativações consecutivas`);
      console.log(`   Primeira: linha ${lineNums[0]}`);
      console.log(`   Última: linha ${lineNums[lineNums.length - 1]}`);
      console.log();
    });
  } else {
    console.log('✅ Nenhum loop infinito detectado');
    
    // Top spells mais ativados
    const spellCount = {};
    spellActivations.forEach(s => {
      spellCount[s.spell] = (spellCount[s.spell] || 0) + 1;
    });
    
    console.log('\n📊 Top 5 spells/traps mais ativados:');
    Object.entries(spellCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([spell, count]) => {
        console.log(`   ${spell.padEnd(40)} ${count}x`);
      });
  }

  console.log('\n' + '═'.repeat(70));
}

// ═══════════════════════════════════════════════════════════════════════════
// MODO 4: ERROS E JOGADAS SEM SENTIDO
// ═══════════════════════════════════════════════════════════════════════════
function analyzeErrors() {
  console.log('═'.repeat(70));
  console.log('⚠️  ANÁLISE DE ERROS E DECISÕES QUESTIONÁVEIS');
  console.log('═'.repeat(70));
  console.log();

  // Detectar combos ignorados
  const combosDetectados = [];
  const acoesExecutadas = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.includes('🎯 Combos detectados:')) {
      const match = line.match(/\['(.+)'\]/);
      if (match) {
        combosDetectados.push({
          line: i + 1,
          combos: match[1].split("', '")
        });
      }
    }
    
    if (line.includes('Chosen:')) {
      const match = line.match(/Chosen: [^-]+ - ([a-z_]+):(.+)/);
      if (match) {
        acoesExecutadas.push({
          line: i + 1,
          type: match[1],
          card: match[2].split('(')[0].trim()
        });
      }
    }
  }

  console.log(`Combos detectados: ${combosDetectados.length}`);
  console.log(`Ações executadas: ${acoesExecutadas.length}`);
  console.log();

  // Passes suspeitos
  let passCount = 0;
  const suspiciousPasses = [];
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('[Bot.makeMove] No actions available, passing')) {
      passCount++;
      
      // Verificar contexto: tinha mão/backrow?
      const context = lines.slice(Math.max(0, i - 50), i);
      const hasHand = context.some(l => l.includes('Hand (') && !l.includes('Hand (0)'));
      const hasBackrow = context.some(l => l.includes('spellTrapZone:') && !l.includes('(0)'));
      
      if (hasHand || hasBackrow) {
        suspiciousPasses.push({
          line: i + 1,
          hasHand,
          hasBackrow
        });
      }
    }
  }

  console.log(`Total de passes: ${passCount}`);
  console.log(`Passes suspeitos (com recursos): ${suspiciousPasses.length}`);
  
  if (suspiciousPasses.length > 0) {
    console.log('\n⚠️  Passes questionáveis:\n');
    suspiciousPasses.slice(0, 5).forEach(p => {
      console.log(`   Linha ${p.line}: ${p.hasHand ? '✅ Hand' : '❌ Hand'} | ${p.hasBackrow ? '✅ Backrow' : '❌ Backrow'}`);
    });
    if (suspiciousPasses.length > 5) {
      console.log(`   ... e mais ${suspiciousPasses.length - 5}`);
    }
  }

  console.log('\n' + '═'.repeat(70));
}

// ═══════════════════════════════════════════════════════════════════════════
// MODO 5: PASSES COM AÇÕES DISPONÍVEIS
// ═══════════════════════════════════════════════════════════════════════════
function analyzePasses() {
  console.log('═'.repeat(70));
  console.log('🤔 ANÁLISE DE PASSES COM AÇÕES DISPONÍVEIS');
  console.log('═'.repeat(70));
  console.log();

  const passes = [];
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('No actions available, passing')) {
      // Contexto dos últimos 100 linhas
      const context = lines.slice(Math.max(0, i - 100), i).join('\n');
      
      // Extrair informações
      const handMatch = context.match(/Hand \((\d+)\):/);
      const fieldMatch = context.match(/Field \((\d+)\):/);
      const backrowMatch = context.match(/spellTrapZone: \[([^\]]+)\]/);
      const actionsMatch = context.match(/Generated (\d+) raw actions/);
      
      passes.push({
        line: i + 1,
        handSize: handMatch ? parseInt(handMatch[1]) : 0,
        fieldSize: fieldMatch ? parseInt(fieldMatch[1]) : 0,
        hasBackrow: backrowMatch && !backrowMatch[1].includes('null'),
        rawActions: actionsMatch ? parseInt(actionsMatch[1]) : 0
      });
    }
  }

  console.log(`Total de passes: ${passes.length}`);
  
  const withHand = passes.filter(p => p.handSize > 0);
  const withBackrow = passes.filter(p => p.hasBackrow);
  const withRawActions = passes.filter(p => p.rawActions > 0);
  
  console.log(`  Com cartas na mão: ${withHand.length}`);
  console.log(`  Com backrow: ${withBackrow.length}`);
  console.log(`  Com raw actions geradas: ${withRawActions.length}`);
  
  if (withRawActions.length > 0) {
    console.log('\n❌ PASSES CRÍTICOS (ações foram geradas mas não executadas):');
    withRawActions.forEach(p => {
      console.log(`   Linha ${p.line}: ${p.rawActions} ações | Hand: ${p.handSize} | Field: ${p.fieldSize}`);
    });
  } else {
    console.log('\n✅ Todos os passes parecem legítimos (sem ações disponíveis)');
  }

  console.log('\n' + '═'.repeat(70));
}

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTAR ANÁLISES
// ═══════════════════════════════════════════════════════════════════════════

console.log(`\n🔍 Analisando: ${logFile}`);
console.log(`📦 Tamanho: ${lines.length.toLocaleString()} linhas\n`);

switch (mode) {
  case 'stats':
    analyzeStats();
    break;
  case 'flow':
    analyzeFlow();
    break;
  case 'loops':
    analyzeLoops();
    break;
  case 'errors':
    analyzeErrors();
    break;
  case 'passes':
    analyzePasses();
    break;
  case 'all':
    analyzeStats();
    console.log('\n\n');
    analyzeFlow();
    console.log('\n\n');
    analyzeLoops();
    console.log('\n\n');
    analyzeErrors();
    console.log('\n\n');
    analyzePasses();
    break;
  default:
    console.error(`❌ Modo desconhecido: ${mode}`);
    console.log('\nModos disponíveis: stats, flow, loops, errors, passes, all');
    process.exit(1);
}

console.log('\n✅ Análise concluída!\n');
