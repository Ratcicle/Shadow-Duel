// ═══════════════════════════════════════════════════════════════════════════
// ReplayCapture.js - Sistema de captura de decisões do jogador humano
// Objetivo: Registrar padrões de jogo para ensinar a IA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ReplayCapture - Captura decisões do jogador para análise posterior
 *
 * Uso:
 *   1. localStorage.setItem('shadow_duel_capture_mode', 'true')
 *   2. Jogue normalmente contra o bot
 *   3. Ao terminar, será perguntado se quer salvar o replay
 *   4. Se sim, o JSON do duelo será baixado individualmente
 *   5. Duelos ruins podem ser descartados sem salvar
 */
class ReplayCapture {
  constructor() {
    this.enabled = false;
    this.currentDuel = null;
    this.lastCompletedDuel = null; // Guarda o último duelo finalizado para exportação
    this.duelCounter = 0;

    // Carregar contador do localStorage (apenas para numeração)
    this._loadCounter();
  }

  /**
   * Verifica se o modo de captura está ativo
   */
  isEnabled() {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem("shadow_duel_capture_mode") === "true";
  }

  /**
   * Inicia captura de um novo duelo
   */
  startDuel(playerDeck, botDeck, botArchetype) {
    if (!this.isEnabled()) return;

    this.duelCounter++;
    this._saveCounter();

    this.currentDuel = {
      id: `duel_${Date.now()}_${this.duelCounter}`,
      timestamp: new Date().toISOString(),
      playerDeck: playerDeck || "Luminarch",
      botDeck: botDeck || "unknown",
      botArchetype: botArchetype || "unknown",
      decisions: [],
      result: null,
      totalTurns: 0,
      finalLP: { player: 0, bot: 0 },
    };

    console.log(
      `%c[ReplayCapture] 🎬 Iniciando captura do duelo #${this.duelCounter}`,
      "color: #00ff00; font-weight: bold"
    );
  }

  /**
   * Finaliza o duelo atual (não salva automaticamente)
   * O duelo fica disponível para exportação ou descarte
   */
  endDuel(winner, reason, playerLP, botLP, turns) {
    if (!this.isEnabled() || !this.currentDuel) return;

    this.currentDuel.result = {
      winner: winner,
      reason: reason,
    };
    this.currentDuel.totalTurns = turns;
    this.currentDuel.finalLP = { player: playerLP, bot: botLP };

    // Guardar para possível exportação
    this.lastCompletedDuel = this.currentDuel;

    const decisions = this.currentDuel.decisions.length;
    console.log(
      `%c[ReplayCapture] 🏁 Duelo #${this.duelCounter} finalizado!`,
      "color: #00ff00; font-weight: bold"
    );
    console.log(
      `   Winner: ${winner} | Turns: ${turns} | Decisões capturadas: ${decisions}`
    );
    console.log(
      `%c[ReplayCapture] 💾 Use o botão "Salvar Replay" ou ReplayCapture.exportCurrentDuel() para salvar`,
      "color: #ffaa00"
    );
    console.log(
      `%c[ReplayCapture] 🗑️  Ou clique "Descartar" / ReplayCapture.discardLastDuel() para descartar`,
      "color: #ff8800"
    );

    this.currentDuel = null;
  }

  /**
   * Exporta o último duelo finalizado como arquivo JSON individual
   * @param {string} customName - Nome customizado para o arquivo (opcional)
   */
  exportCurrentDuel(customName = null) {
    if (!this.lastCompletedDuel) {
      console.warn("[ReplayCapture] Nenhum duelo para exportar");
      return null;
    }

    const duel = this.lastCompletedDuel;
    const data = JSON.stringify(duel, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    // Gerar nome do arquivo
    const date = new Date().toISOString().slice(0, 10);
    const result = duel.result?.winner === "player" ? "win" : "loss";
    const turns = duel.totalTurns || 0;
    const defaultName = `replay_${date}_${result}_${turns}turns`;
    const fileName = customName || defaultName;

    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.json`;
    a.click();

    URL.revokeObjectURL(url);

    console.log(
      `%c[ReplayCapture] 📥 Replay exportado: ${fileName}.json`,
      "color: #00ff00; font-weight: bold"
    );
    console.log(`   Decisões: ${duel.decisions.length} | Turnos: ${turns}`);

    // Limpar após exportar
    this.lastCompletedDuel = null;

    return duel;
  }

  /**
   * Descarta o último duelo sem salvar
   */
  discardLastDuel() {
    if (!this.lastCompletedDuel) {
      console.warn("[ReplayCapture] Nenhum duelo para descartar");
      return;
    }

    const duelId = this.lastCompletedDuel.id;
    this.lastCompletedDuel = null;

    console.log(
      `%c[ReplayCapture] 🗑️ Duelo descartado: ${duelId}`,
      "color: #ff8800"
    );
  }

  /**
   * Verifica se há um duelo pendente para salvar
   */
  hasPendingDuel() {
    return this.lastCompletedDuel !== null;
  }

  /**
   * Retorna info do duelo pendente (para UI)
   */
  getPendingDuelInfo() {
    if (!this.lastCompletedDuel) return null;

    const duel = this.lastCompletedDuel;
    return {
      id: duel.id,
      winner: duel.result?.winner,
      reason: duel.result?.reason,
      turns: duel.totalTurns,
      decisions: duel.decisions.length,
      playerLP: duel.finalLP?.player,
      botLP: duel.finalLP?.bot,
    };
  }

  /**
   * Método genérico de captura - faz dispatch para métodos específicos
   * @param {string} type - Tipo de decisão (summon, spell, attack, etc.)
   * @param {Object} data - Dados da decisão
   */
  capture(type, data) {
    if (!this.isEnabled() || !this.currentDuel) return;

    // Normalizar dados - adaptar formato da integração para formato interno
    const normalized = this._normalizeData(type, data);

    switch (type) {
      case "summon":
        this.captureSummon(normalized);
        break;
      case "spell":
        this.captureSpell(normalized);
        break;
      case "attack":
        this.captureAttack(normalized);
        break;
      case "chain_response":
        this.captureChainResponse(normalized);
        break;
      case "field_effect":
        this.captureFieldEffect(normalized);
        break;
      case "effect":
        this.captureEffect(normalized);
        break;
      case "pass":
        this.capturePass(normalized);
        break;
      case "position_choice":
        this.capturePositionChoice(normalized);
        break;
      case "set_spell_trap":
        this.captureSetSpellTrap(normalized);
        break;
      case "trap_activation":
        this.captureTrapActivation(normalized);
        break;
      default:
        // Captura genérica para tipos não mapeados
        this._addDecision({
          type,
          timestamp: Date.now(),
          data: normalized,
          gameState: this._captureGameState(normalized),
        });
    }
  }

  /**
   * Normaliza dados da integração para o formato interno
   */
  _normalizeData(type, data) {
    // Se já tem 'card' objeto, retorna como está (mas ainda precisa processar attack)
    const hasCardObject = data.card && typeof data.card === "object";

    // Adaptar cardName/cardId para card objeto
    const normalized = { ...data };

    if (!hasCardObject && (data.cardName || data.cardId)) {
      normalized.card = {
        name: data.cardName,
        id: data.cardId,
        atk: data.cardAtk,
        def: data.cardDef,
      };
    }

    // Adaptar attacker/target para formato esperado pelo captureAttack
    if (type === "attack") {
      // Só criar attacker se temos dados válidos
      if (data.attackerName || data.attackerId) {
        normalized.attacker = {
          name: data.attackerName,
          id: data.attackerId,
          atk: data.attackerAtk,
        };
      }
      // Se não é ataque direto e tem nome de alvo, criar objeto target
      if (!data.isDirectAttack && data.targetName) {
        normalized.target = {
          name: data.targetName,
          id: data.targetId,
          atk: data.targetAtk,
          def: data.targetDef,
          position: data.targetPosition,
          isFacedown: data.targetIsFacedown,
        };
      } else {
        normalized.target = null;
      }
    }

    // Manter board intacto para _captureGameState usar
    // Os campos individuais são apenas fallback adicional
    if (data.board) {
      normalized.turn = data.board.turnNumber || data.board.turn;
      normalized.phase = data.board.phase;
    }

    return normalized;
  }

  /**
   * Captura set de spell/trap
   */
  captureSetSpellTrap(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    const decision = {
      type: "set_spell_trap",
      timestamp: Date.now(),
      actor: context.actor || "human",
      cardName: context.cardName,
      cardId: context.cardId,
      cardKind: context.cardKind,
      subtype: context.subtype,
      gameState: this._captureGameState(context),
    };

    this._addDecision(decision);
    this._logDecision("SET", context.cardName, `[${decision.actor}]`);
  }

  /**
   * Captura ativação de trap
   */
  captureTrapActivation(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    const decision = {
      type: "trap_activation",
      timestamp: Date.now(),
      actor: context.actor || "human",
      cardName: context.cardName,
      cardId: context.cardId,
      trigger: context.trigger,
      chainLink: context.chainLink,
      gameState: this._captureGameState(context),
    };

    this._addDecision(decision);
    this._logDecision(
      "TRAP",
      context.cardName,
      `trigger: ${context.trigger} [${decision.actor}]`
    );
  }

  /**
   * Captura ativação de efeito (monstro, spell contínua, field spell, etc.)
   */
  captureEffect(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    const decision = {
      type: "effect",
      timestamp: Date.now(),
      actor: context.actor || "human",
      cardName: context.cardName || context.card?.name,
      cardId: context.cardId || context.card?.id,
      cardKind: context.cardKind || context.card?.cardKind,
      effectId: context.effectId,
      effectTiming: context.effectTiming,
      activationZone: context.activationZone, // "field", "hand", "graveyard", "spellTrap", "fieldSpell"
      effectType: context.effectType,
      actions: context.actions || [],
      gameState: this._captureGameState(context),
    };

    this._addDecision(decision);

    const zoneLabel = context.activationZone || "?";
    this._logDecision(
      "EFFECT",
      context.cardName || context.card?.name,
      `zone: ${zoneLabel} [${decision.actor}]`
    );
  }

  /**
   * Adiciona decisão ao duelo atual
   */
  _addDecision(decision) {
    if (!this.currentDuel) return;
    this.currentDuel.decisions.push(decision);
  }

  /**
   * Captura uma decisão de summon
   */
  captureSummon(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    const decision = {
      type: "summon",
      turn: context.turn || 0,
      phase: context.phase || "main1",
      timestamp: Date.now(),
      actor: context.actor || "human",

      // Carta escolhida
      card: {
        name: context.card?.name,
        id: context.card?.id,
        level: context.card?.level,
        atk: context.card?.atk,
        def: context.card?.def,
        type: context.card?.type,
        archetype: context.card?.archetype,
      },

      // Escolha de posição
      position: context.position,
      facedown: context.facedown,

      // Contexto do jogo
      gameState: this._captureGameState(context),
    };

    this.currentDuel.decisions.push(decision);
    this._logDecision(
      "SUMMON",
      context.card?.name,
      `${context.position}${context.facedown ? " (set)" : ""} [${
        decision.actor
      }]`
    );
  }

  /**
   * Captura uma decisão de spell/trap
   */
  captureSpell(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    const decision = {
      type: "spell",
      turn: context.turn || 0,
      phase: context.phase || "main1",
      timestamp: Date.now(),
      actor: context.actor || "human",

      // Carta escolhida
      card: {
        name: context.card?.name,
        id: context.card?.id,
        subtype: context.card?.subtype,
        cardKind: context.card?.cardKind,
      },

      // Targets selecionados
      targets: this._serializeTargets(context.targets),

      // Contexto do jogo
      gameState: this._captureGameState(context),
    };

    this.currentDuel.decisions.push(decision);
    this._logDecision("SPELL", context.card?.name, `[${decision.actor}]`);
  }

  /**
   * Captura uma decisão de ataque
   */
  captureAttack(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    const decision = {
      type: "attack",
      turn: context.turn || 0,
      phase: "battle",
      timestamp: Date.now(),
      actor: context.actor || "human",

      // Atacante
      attacker: {
        name: context.attacker?.name,
        id: context.attacker?.id,
        atk: context.attacker?.atk,
        position: context.attacker?.position,
      },

      // Alvo (null = ataque direto)
      target: context.target
        ? {
            name: context.target.name,
            id: context.target.id,
            atk: context.target.atk,
            def: context.target.def,
            position: context.target.position,
            isFacedown: context.target.isFacedown,
          }
        : null,

      directAttack: !context.target,

      // Contexto do jogo
      gameState: this._captureGameState(context),
    };

    this.currentDuel.decisions.push(decision);
    this._logDecision(
      "ATTACK",
      context.attacker?.name,
      `${context.target?.name || "DIRETO"} [${decision.actor}]`
    );
  }

  /**
   * Captura uma decisão de chain response
   */
  captureChainResponse(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    const decision = {
      type: "chain_response",
      turn: context.turn || 0,
      phase: context.phase || "unknown",
      timestamp: Date.now(),
      actor: context.actor || "human",

      // Trigger que causou a chain window
      trigger: {
        type: context.triggerType,
        card: context.triggerCard?.name,
      },

      // Resposta do jogador
      responded: context.responded,
      responseCard: context.responseCard
        ? {
            name: context.responseCard.name,
            id: context.responseCard.id,
          }
        : null,

      // Cartas disponíveis para responder
      availableResponses: (context.availableCards || []).map((c) => c?.name),

      // Contexto do jogo
      gameState: this._captureGameState(context),
    };

    this.currentDuel.decisions.push(decision);
    this._logDecision(
      "CHAIN",
      context.responded ? context.responseCard?.name : "PASS",
      `[${decision.actor}]`
    );
  }

  /**
   * Captura uso de efeito do field spell
   */
  captureFieldEffect(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    const decision = {
      type: "field_effect",
      turn: context.turn || 0,
      phase: context.phase || "main1",
      timestamp: Date.now(),
      actor: context.actor || "human",

      fieldSpell: {
        name: context.fieldSpell?.name,
        id: context.fieldSpell?.id,
      },

      // Targets selecionados
      targets: this._serializeTargets(context.targets),

      // Contexto do jogo
      gameState: this._captureGameState(context),
    };

    this.currentDuel.decisions.push(decision);
    this._logDecision(
      "FIELD_EFFECT",
      context.fieldSpell?.name,
      `[${decision.actor}]`
    );
  }
  /**
   * Captura quando o jogador passa a fase (não faz nada)
   */
  capturePass(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    const decision = {
      type: "pass",
      turn: context.turn || 0,
      phase: context.phase || "unknown",
      timestamp: Date.now(),
      actor: context.actor || "human",

      // O que o jogador tinha disponível mas escolheu não usar
      availableActions: context.availableActions || [],

      // Contexto do jogo
      gameState: this._captureGameState(context),
    };

    this.currentDuel.decisions.push(decision);
    this._logDecision("PASS", context.phase, `[${decision.actor}]`);
  }

  /**
   * Captura escolha de posição para special summon
   */
  capturePositionChoice(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    const decision = {
      type: "position_choice",
      turn: context.turn || 0,
      phase: context.phase || "main1",
      timestamp: Date.now(),
      actor: context.actor || "human",

      card: {
        name: context.card?.name,
        id: context.card?.id,
        atk: context.card?.atk,
        def: context.card?.def,
      },

      chosenPosition: context.position,
      summonType: context.summonType || "special", // special, fusion, ascension

      // Contexto do jogo
      gameState: this._captureGameState(context),
    };

    this.currentDuel.decisions.push(decision);
    this._logDecision(
      "POSITION",
      context.card?.name,
      `${context.position} [${decision.actor}]`
    );
  }

  /**
   * Captura estado completo do jogo
   * Usa dados do player/bot se disponíveis, ou do board normalizado
   */
  _captureGameState(context) {
    const player = context.player || context.game?.player;
    const bot = context.bot || context.opponent || context.game?.bot;

    // Se temos os objetos player/bot, usar dados completos
    if (player || bot) {
      return {
        // LP
        playerLP: player?.lp || 0,
        botLP: bot?.lp || 0,

        // Mão do jogador
        playerHand: (player?.hand || []).map((c) => ({
          name: c?.name,
          cardKind: c?.cardKind,
          level: c?.level,
          atk: c?.atk,
          def: c?.def,
        })),

        // Campo do jogador
        playerField: (player?.field || []).map((c) => ({
          name: c?.name,
          atk: c?.atk,
          def: c?.def,
          position: c?.position,
          isFacedown: c?.isFacedown,
          hasAttacked: c?.hasAttacked,
        })),

        // Campo do oponente
        botField: (bot?.field || []).map((c) => ({
          name: c?.name,
          atk: c?.atk,
          def: c?.def,
          position: c?.position,
          isFacedown: c?.isFacedown,
        })),

        // Backrow
        playerBackrow: (player?.spellTrap || []).map((c) => ({
          name: c?.name,
          isFacedown: c?.isFacedown,
        })),
        botBackrowCount: (bot?.spellTrap || []).length,

        // Field Spell
        playerFieldSpell: player?.fieldSpell?.name || null,
        botFieldSpell: bot?.fieldSpell?.name || null,

        // Graveyard
        playerGraveyard: (player?.graveyard || []).map((c) => c?.name),
        botGraveyardCount: (bot?.graveyard || []).length,

        // Turno
        turn: context.turn || context.game?.turnCounter || 0,
        phase: context.phase || context.game?.phase || "unknown",

        // Summon count
        summonCount: player?.summonCount || 0,
      };
    }

    // Usar dados do board (vindos da integração via captureMinimalBoardState)
    const board = context.board || context;

    return {
      playerLP: board.playerLP || 0,
      botLP: board.botLP || 0,
      playerField: board.playerField || [],
      botField: board.botField || [],
      playerHandCount: board.playerHandCount || 0,
      botHandCount: board.botHandCount || 0,
      playerGraveCount: board.playerGraveCount || 0,
      botGraveCount: board.botGraveCount || 0,
      playerSpellTrapCount: board.playerSpellTrapCount || 0,
      botSpellTrapCount: board.botSpellTrapCount || 0,
      turn: board.turnNumber || board.turn || 0,
      phase: board.phase || "unknown",
    };
  }

  /**
   * Serializa targets para formato simples
   */
  _serializeTargets(targets) {
    if (!targets) return null;
    if (Array.isArray(targets)) {
      return targets.map((t) => t?.name || t?.cardRef?.name || "unknown");
    }
    if (typeof targets === "object") {
      const result = {};
      for (const key of Object.keys(targets)) {
        const val = targets[key];
        if (Array.isArray(val)) {
          result[key] = val.map(
            (t) => t?.name || t?.cardRef?.name || "unknown"
          );
        } else if (val?.name) {
          result[key] = val.name;
        } else {
          result[key] = val;
        }
      }
      return result;
    }
    return targets;
  }

  /**
   * Log visual da decisão capturada
   */
  _logDecision(type, ...details) {
    const icons = {
      SUMMON: "🎴",
      SPELL: "✨",
      ATTACK: "⚔️",
      CHAIN: "🔗",
      FIELD_EFFECT: "🏰",
      PASS: "⏭️",
      POSITION: "🎯",
    };
    const icon = icons[type] || "📝";
    console.log(
      `%c[ReplayCapture] ${icon} ${type}: ${details
        .filter(Boolean)
        .join(" → ")}`,
      "color: #88ff88"
    );
  }

  /**
   * Salva contador de duelos no localStorage
   */
  _saveCounter() {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem("shadow_duel_counter", String(this.duelCounter));
    } catch (e) {
      // Ignorar erros de storage
    }
  }

  /**
   * Carrega contador de duelos do localStorage
   */
  _loadCounter() {
    try {
      if (typeof localStorage === "undefined") return;
      const counter = localStorage.getItem("shadow_duel_counter");
      if (counter) {
        this.duelCounter = parseInt(counter, 10) || 0;
      }
    } catch (e) {
      this.duelCounter = 0;
    }
  }

  /**
   * Exporta o último duelo (alias para compatibilidade)
   * @deprecated Use exportCurrentDuel() em vez disso
   */
  exportReplays() {
    console.log(
      "%c[ReplayCapture] ⚠️ exportReplays() está obsoleto. Usando exportCurrentDuel()...",
      "color: #ffaa00"
    );
    return this.exportCurrentDuel();
  }

  /**
   * Limpa dados de replay (apenas o contador agora)
   */
  clearReplays() {
    this.lastCompletedDuel = null;
    this.duelCounter = 0;
    localStorage.removeItem("shadow_duel_counter");
    console.log("%c[ReplayCapture] 🗑️ Dados limpos", "color: #ff8800");
  }

  /**
   * Retorna estatísticas do duelo pendente (se houver)
   */
  getStats() {
    if (!this.lastCompletedDuel) {
      return { message: "Nenhum duelo pendente para análise" };
    }

    const duel = this.lastCompletedDuel;
    const stats = {
      duelId: duel.id,
      totalDecisions: duel.decisions.length,
      turns: duel.totalTurns,
      winner: duel.result?.winner,
      reason: duel.result?.reason,
      decisionsByType: {},
      cardsSummoned: [],
      attacksMade: 0,
    };

    for (const d of duel.decisions) {
      stats.decisionsByType[d.type] = (stats.decisionsByType[d.type] || 0) + 1;

      if (d.type === "summon" && d.card?.name) {
        stats.cardsSummoned.push(d.card.name);
      }
      if (d.type === "attack") {
        stats.attacksMade++;
      }
    }

    return stats;
  }

  /**
   * Mostra resumo do duelo pendente no console
   */
  showSummary() {
    const stats = this.getStats();

    if (stats.message) {
      console.log(`%c[ReplayCapture] ${stats.message}`, "color: #ffaa00");
      return stats;
    }

    console.log(
      "\n%c═══════════════════════════════════════════════════",
      "color: #00ff00"
    );
    console.log(
      "%c📊 REPLAY - DUELO PENDENTE",
      "color: #00ff00; font-weight: bold; font-size: 14px"
    );
    console.log(
      "%c═══════════════════════════════════════════════════",
      "color: #00ff00"
    );
    console.log(`ID: ${stats.duelId}`);
    console.log(`Resultado: ${stats.winner} (${stats.reason})`);
    console.log(`Turnos: ${stats.turns}`);
    console.log(`Total de decisões: ${stats.totalDecisions}`);

    console.log("\n%cDecisões por tipo:", "font-weight: bold");
    for (const [type, count] of Object.entries(stats.decisionsByType)) {
      console.log(`  ${type}: ${count}`);
    }

    if (stats.cardsSummoned.length > 0) {
      console.log("\n%cCartas invocadas:", "font-weight: bold");
      stats.cardsSummoned.forEach((name, i) => {
        console.log(`  ${i + 1}. ${name}`);
      });
    }

    console.log(
      "\n%c💾 ReplayCapture.exportCurrentDuel() para salvar",
      "color: #00ff00"
    );
    console.log(
      "%c🗑️  ReplayCapture.discardLastDuel() para descartar",
      "color: #ff8800"
    );
    console.log(
      "%c═══════════════════════════════════════════════════\n",
      "color: #00ff00"
    );

    return stats;
  }
}

// Singleton global
const replayCapture = new ReplayCapture();

// Expor no window para acesso fácil no console
if (typeof window !== "undefined") {
  window.ReplayCapture = replayCapture;
}

export default replayCapture;
