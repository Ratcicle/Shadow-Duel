/**
 * Logging System - Sistema centralizado de logs para rastreamento de decisões dos bots
 * 
 * Uso:
 *   localStorage.setItem('shadow_duel_log_level', '2');  // 1=min, 2=normal, 3=verbose
 *   localStorage.setItem('shadow_duel_log_filter', 'all'); // 'Bot1', 'Bot2', 'all'
 * 
 * Categorias: action_gen, decision, state_change, phase_transition, duplicate, card_effect, empty_phase
 */

class BotLogger {
  constructor() {
    this.level = this.getLogLevel();
    this.filter = this.getLogFilter();
    this.enabledCategories = this.getEnabledCategories();
    this.stats = {
      logsCounted: 0,
      duplicatesDetected: 0,
    };
  }

  /**
   * Obter nível de log (1=min, 2=normal, 3=verbose)
   */
  getLogLevel() {
    try {
      const stored = localStorage?.getItem?.('shadow_duel_log_level');
      const level = parseInt(stored, 10);
      return isFinite(level) && level >= 1 && level <= 3 ? level : 1;
    } catch {
      return 1;
    }
  }

  /**
   * Obter filtro de bot ('Bot1', 'Bot2', 'all')
   */
  getLogFilter() {
    try {
      const filter = localStorage?.getItem?.('shadow_duel_log_filter');
      return filter || 'all';
    } catch {
      return 'all';
    }
  }

  /**
   * Obter categorias ativadas
   */
  getEnabledCategories() {
    try {
      const cats = localStorage?.getItem?.('shadow_duel_log_categories');
      if (cats) {
        return new Set(cats.split(','));
      }
    } catch {}

    // Default: baseado no nível
    if (this.level === 1) {
      return new Set(['phase_transition', 'empty_phase', 'decision']);
    } else if (this.level === 2) {
      return new Set(['action_gen', 'decision', 'empty_phase', 'phase_transition', 'duplicate']);
    } else {
      return new Set(['action_gen', 'decision', 'state_change', 'phase_transition', 'duplicate', 'card_effect', 'empty_phase']);
    }
  }

  /**
   * Verificar se deve logar baseado em filtro e level
   */
  shouldLog(botId, category) {
    if (this.level < 1) return false;
    if (!this.enabledCategories.has(category)) return false;
    if (this.filter !== 'all' && this.filter !== botId) return false;
    return true;
  }

  /**
   * Log de geração de ações
   */
  logActionGeneration(botId, turn, phase, hand, field, summonAvailable, generatedActions) {
    if (!this.shouldLog(botId, 'action_gen')) return;

    console.log(`\n[ActionGen] ${botId} | T${turn}:${phase}`);
    console.log(`  Hand: ${hand.length} | Field: ${field.length} | Summon: ${summonAvailable ? 'YES' : 'NO'}`);
    
    if (this.level >= 2) {
      console.log(`  Generated: ${generatedActions.length} actions`);
      if (this.level >= 3 && generatedActions.length > 0) {
        const sorted = [...generatedActions].sort((a, b) => (b.priority || 0) - (a.priority || 0));
        sorted.slice(0, 5).forEach((a, i) => {
          console.log(`    #${i + 1}. ${a.type}:${a.cardName || '?'} (p:${(a.priority || 0).toFixed(0)})`);
        });
        if (sorted.length > 5) {
          console.log(`    ... +${sorted.length - 5} more`);
        }
      }
    }

    this.stats.logsCounted++;
  }

  /**
   * Log de decisão escolhida vs ranking
   */
  logDecision(botId, turn, phase, totalActions, ranking, coherence, chosenAction) {
    if (!this.shouldLog(botId, 'decision')) return;

    const topPercent = ranking === 0 ? '🥇' : ranking < 3 ? '🥈' : '❌';
    console.log(`\n[Decision] ${botId} | T${turn}:${phase} ${topPercent}`);
    console.log(`  Chosen: #${ranking + 1}/${totalActions} - ${chosenAction.type}:${chosenAction.cardName || '?'} (p:${(chosenAction.priority || 0).toFixed(0)})`);
    console.log(`  Coherence: ${(coherence * 100).toFixed(0)}%`);

    this.stats.logsCounted++;
  }

  /**
   * Log de fase vazia (sem ações)
   */
  logEmptyPhase(botId, turn, phase, reason, context) {
    if (!this.shouldLog(botId, 'empty_phase')) return;

    console.log(`\n[EmptyPhase] ⚠️  ${botId} | T${turn}:${phase}`);
    console.log(`  Reason: ${reason}`);
    if (context) {
      console.log(`  Context: LP=${context.lp} | Hand=${context.handSize} | Field=${context.fieldSize} | GY=${context.gySize}`);
    }

    this.stats.logsCounted++;
  }

  /**
   * Log de transição de fase
   */
  logPhaseTransition(botId, turn, fromPhase, toPhase, actionCount, timeMs) {
    if (!this.shouldLog(botId, 'phase_transition')) return;

    const statusIcon = actionCount === 0 ? '⏭️' : actionCount === 1 ? '→' : '⚔️';
    console.log(`\n[Phase] ${statusIcon} ${botId} | T${turn} ${fromPhase} → ${toPhase} (${actionCount} actions, ${timeMs}ms)`);

    this.stats.logsCounted++;
  }

  /**
   * Log de mudança de estado
   */
  logStateChange(botId, action, before, after) {
    if (!this.shouldLog(botId, 'state_change')) return;

    console.log(`\n[StateChange] ${botId} executing: ${action}`);
    console.log(`  BEFORE: Field=[${before.field.join(',')}] | Hand: ${before.hand} | LP: ${before.lp}`);
    console.log(`  AFTER:  Field=[${after.field.join(',')}] | Hand: ${after.hand} | LP: ${after.lp}`);

    this.stats.logsCounted++;
  }

  /**
   * Log de detecção de duplicata
   */
  logDuplicate(category, description, callCount, source) {
    if (!this.shouldLog('all', 'duplicate')) return;

    console.log(`\n[Duplicate] ⚠️  ${category}: ${description}`);
    console.log(`  Occurrences: ${callCount} | Source: ${source}`);

    this.stats.duplicatesDetected++;
    this.stats.logsCounted++;
  }

  /**
   * Log de efeito de carta
   */
  logCardEffect(botId, card, effectId, result) {
    if (!this.shouldLog(botId, 'card_effect')) return;

    console.log(`\n[CardEffect] ${botId} - ${card}`);
    console.log(`  Effect: ${effectId}`);
    console.log(`  Result: ${result}`);

    this.stats.logsCounted++;
  }

  /**
   * Resetar stats
   */
  resetStats() {
    this.stats = {
      logsCounted: 0,
      duplicatesDetected: 0,
    };
  }

  /**
   * Imprimir resumo de stats
   */
  printStats() {
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`📊 Logging Stats`);
    console.log(`   Level: ${this.level} | Filter: ${this.filter}`);
    console.log(`   Total Logs: ${this.stats.logsCounted}`);
    console.log(`   Duplicates Detected: ${this.stats.duplicatesDetected}`);
    console.log(`${'═'.repeat(50)}\n`);
  }
}

// Instância global
export const botLogger = typeof window !== 'undefined' ? new BotLogger() : null;

export default BotLogger;
