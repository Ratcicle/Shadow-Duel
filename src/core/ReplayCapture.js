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
 *   3. Ao terminar, chame ReplayCapture.exportReplays() no console
 *   4. O JSON será baixado para análise
 */
class ReplayCapture {
  constructor() {
    this.enabled = false;
    this.currentDuel = null;
    this.replays = [];
    this.duelCounter = 0;

    // Carregar replays salvos do localStorage
    this._loadFromStorage();
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
   * Finaliza o duelo atual e salva
   */
  endDuel(winner, reason, playerLP, botLP, turns) {
    if (!this.isEnabled() || !this.currentDuel) return;

    this.currentDuel.result = {
      winner: winner,
      reason: reason,
    };
    this.currentDuel.totalTurns = turns;
    this.currentDuel.finalLP = { player: playerLP, bot: botLP };

    // Adicionar à lista de replays
    this.replays.push(this.currentDuel);

    // Salvar no localStorage
    this._saveToStorage();

    const decisions = this.currentDuel.decisions.length;
    console.log(
      `%c[ReplayCapture] 🏁 Duelo #${this.duelCounter} finalizado!`,
      "color: #00ff00; font-weight: bold"
    );
    console.log(
      `   Winner: ${winner} | Turns: ${turns} | Decisões capturadas: ${decisions}`
    );
    console.log(`   Total de duelos salvos: ${this.replays.length}`);

    this.currentDuel = null;
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
    // Se já tem 'card' objeto, retorna como está
    if (data.card && typeof data.card === "object") {
      return data;
    }

    // Adaptar cardName/cardId para card objeto
    const normalized = { ...data };

    if (data.cardName || data.cardId) {
      normalized.card = {
        name: data.cardName,
        id: data.cardId,
        atk: data.cardAtk,
        def: data.cardDef,
      };
    }

    // Adaptar board para gameState se necessário
    if (data.board && !data.gameState) {
      normalized.turn = data.board.turnNumber;
      normalized.phase = data.board.phase;
      normalized.playerLP = data.board.playerLP;
      normalized.botLP = data.board.botLP;
      normalized.playerField = data.board.playerField;
      normalized.botField = data.board.botField;
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
      cardName: context.cardName,
      cardId: context.cardId,
      cardKind: context.cardKind,
      subtype: context.subtype,
      gameState: this._captureGameState(context),
    };

    this._addDecision(decision);
    this._logDecision("SET", context.cardName);
  }

  /**
   * Captura ativação de trap
   */
  captureTrapActivation(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    const decision = {
      type: "trap_activation",
      timestamp: Date.now(),
      cardName: context.cardName,
      cardId: context.cardId,
      trigger: context.trigger,
      chainLink: context.chainLink,
      gameState: this._captureGameState(context),
    };

    this._addDecision(decision);
    this._logDecision("TRAP", context.cardName, `trigger: ${context.trigger}`);
  }

  /**
   * Captura ativação de efeito (monstro, spell contínua, field spell, etc.)
   */
  captureEffect(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    const decision = {
      type: "effect",
      timestamp: Date.now(),
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
      `zone: ${zoneLabel}`
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
      `${context.position}${context.facedown ? " (set)" : ""}`
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
    this._logDecision("SPELL", context.card?.name);
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
      context.target?.name || "DIRETO"
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
      context.responded ? context.responseCard?.name : "PASS"
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
    this._logDecision("FIELD_EFFECT", context.fieldSpell?.name);
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

      // O que o jogador tinha disponível mas escolheu não usar
      availableActions: context.availableActions || [],

      // Contexto do jogo
      gameState: this._captureGameState(context),
    };

    this.currentDuel.decisions.push(decision);
    this._logDecision("PASS", context.phase);
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
    this._logDecision("POSITION", context.card?.name, context.position);
  }

  /**
   * Captura estado completo do jogo
   */
  _captureGameState(context) {
    const player = context.player || context.game?.player;
    const bot = context.bot || context.opponent || context.game?.bot;

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
   * Salva replays no localStorage
   */
  _saveToStorage() {
    try {
      const data = JSON.stringify(this.replays);
      localStorage.setItem("shadow_duel_replays", data);
    } catch (e) {
      console.warn("[ReplayCapture] Erro ao salvar:", e.message);
    }
  }

  /**
   * Carrega replays do localStorage
   */
  _loadFromStorage() {
    try {
      if (typeof localStorage === "undefined") return;
      const data = localStorage.getItem("shadow_duel_replays");
      if (data) {
        this.replays = JSON.parse(data);
        this.duelCounter = this.replays.length;
        if (this.replays.length > 0) {
          console.log(
            `%c[ReplayCapture] 📂 ${this.replays.length} replays carregados`,
            "color: #00ff00"
          );
        }
      }
    } catch (e) {
      console.warn("[ReplayCapture] Erro ao carregar:", e.message);
      this.replays = [];
    }
  }

  /**
   * Exporta todos os replays como JSON
   */
  exportReplays() {
    const data = JSON.stringify(this.replays, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `shadow_duel_replays_${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    a.click();

    URL.revokeObjectURL(url);
    console.log(
      `%c[ReplayCapture] 📥 Exportados ${this.replays.length} replays`,
      "color: #00ff00; font-weight: bold"
    );

    return this.replays;
  }

  /**
   * Limpa todos os replays salvos
   */
  clearReplays() {
    this.replays = [];
    this.duelCounter = 0;
    localStorage.removeItem("shadow_duel_replays");
    console.log("%c[ReplayCapture] 🗑️ Replays limpos", "color: #ff8800");
  }

  /**
   * Retorna estatísticas dos replays
   */
  getStats() {
    const stats = {
      totalDuels: this.replays.length,
      totalDecisions: 0,
      wins: 0,
      losses: 0,
      decisionsByType: {},
      avgDecisionsPerDuel: 0,
      avgTurns: 0,
      mostPlayedCards: {},
    };

    for (const duel of this.replays) {
      stats.totalDecisions += duel.decisions.length;
      stats.avgTurns += duel.totalTurns || 0;

      if (duel.result?.winner === "player") stats.wins++;
      else if (duel.result?.winner === "bot") stats.losses++;

      for (const d of duel.decisions) {
        stats.decisionsByType[d.type] =
          (stats.decisionsByType[d.type] || 0) + 1;

        // Contar cartas mais jogadas
        const cardName =
          d.card?.name ||
          d.attacker?.name ||
          d.responseCard?.name ||
          d.fieldSpell?.name;
        if (cardName) {
          stats.mostPlayedCards[cardName] =
            (stats.mostPlayedCards[cardName] || 0) + 1;
        }
      }
    }

    if (stats.totalDuels > 0) {
      stats.avgDecisionsPerDuel = Math.round(
        stats.totalDecisions / stats.totalDuels
      );
      stats.avgTurns = Math.round(stats.avgTurns / stats.totalDuels);
    }

    return stats;
  }

  /**
   * Mostra resumo dos replays no console
   */
  showSummary() {
    const stats = this.getStats();
    console.log(
      "\n%c═══════════════════════════════════════════════════",
      "color: #00ff00"
    );
    console.log(
      "%c📊 REPLAY CAPTURE - RESUMO",
      "color: #00ff00; font-weight: bold; font-size: 14px"
    );
    console.log(
      "%c═══════════════════════════════════════════════════",
      "color: #00ff00"
    );
    console.log(`Total de duelos: ${stats.totalDuels}`);
    console.log(`Vitórias: ${stats.wins} | Derrotas: ${stats.losses}`);
    console.log(`Total de decisões: ${stats.totalDecisions}`);
    console.log(`Média por duelo: ${stats.avgDecisionsPerDuel} decisões`);
    console.log(`Média de turnos: ${stats.avgTurns}`);
    console.log("\n%cDecisões por tipo:", "font-weight: bold");
    for (const [type, count] of Object.entries(stats.decisionsByType)) {
      console.log(`  ${type}: ${count}`);
    }

    // Top 5 cartas mais jogadas
    const topCards = Object.entries(stats.mostPlayedCards)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    if (topCards.length > 0) {
      console.log("\n%cTop 5 cartas mais jogadas:", "font-weight: bold");
      topCards.forEach(([name, count], i) => {
        console.log(`  ${i + 1}. ${name}: ${count}x`);
      });
    }

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
