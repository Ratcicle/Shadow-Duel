// ═══════════════════════════════════════════════════════════════════════════
// ReplayCapture.js - Sistema de captura de decisões do jogador humano
// Objetivo: Registrar padrões de jogo para ensinar a IA
// Versão 2.0: Otimizado com snapshots, deltas e dicionário de cartas
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
 *
 * Formato v2:
 *   - cardDictionary: { id → name } para evitar repetição de nomes
 *   - snapshots: { turnNumber → gameState completo } a cada 5 turnos
 *   - decisions: usam delta (apenas campos alterados) e referências ao dicionário
 *   - timestamps relativos (dt) após o primeiro evento (t0)
 */

// Configuração de otimização
const SNAPSHOT_INTERVAL = 5; // Snapshot completo a cada N turnos
const REPLAY_VERSION = 3; // v3: mão completa, graveyard, summonType, cardsAdded, botDeckList

class ReplayCapture {
  constructor() {
    this.enabled = false;
    this.currentDuel = null;
    this.lastCompletedDuel = null; // Guarda o último duelo finalizado para exportação
    this.duelCounter = 0;

    // Estado para otimização v2
    this._lastState = null; // Último gameState capturado (para calcular delta)
    this._lastTimestamp = null; // Último timestamp (para delta de tempo)
    this._cardDictionary = {}; // id → name
    this._lastSnapshotTurn = -1; // Último turno com snapshot

    // v4: Armazenamento temporário de availableActions para vincular com decisão
    this._pendingAvailableActions = null; // { promptId, actor, actions[] }

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

    // Reset estado de otimização
    this._lastState = null;
    this._lastTimestamp = null;
    this._cardDictionary = {};
    this._lastSnapshotTurn = -1;

    // Extrair lista de cartas do deck do bot se disponível
    let botDeckList = null;
    if (
      botDeck &&
      typeof botDeck === "object" &&
      Array.isArray(botDeck.cards)
    ) {
      botDeckList = botDeck.cards.map((c) => c?.name || c);
    } else if (
      botDeck &&
      typeof botDeck === "object" &&
      Array.isArray(botDeck.deck)
    ) {
      botDeckList = botDeck.deck.map((c) => c?.name || c);
    }

    this.currentDuel = {
      version: REPLAY_VERSION,
      id: `duel_${Date.now()}_${this.duelCounter}`,
      timestamp: new Date().toISOString(),
      playerDeck: playerDeck || "Luminarch",
      botDeck: typeof botDeck === "string" ? botDeck : "unknown",
      botDeckList: botDeckList, // v3: lista completa de cartas do bot
      botArchetype: botArchetype || "unknown",
      cardDictionary: {}, // Será preenchido durante a captura
      snapshots: {}, // { turnNumber: gameState completo }
      decisions: [],
      result: null,
      totalTurns: 0,
      finalLP: { player: 0, bot: 0 },
    };

    console.log(
      `%c[ReplayCapture] 🎬 Iniciando captura do duelo #${this.duelCounter} (v${REPLAY_VERSION} otimizado)`,
      "color: #00ff00; font-weight: bold"
    );
  }

  /**
   * Finaliza o duelo atual (não salva automaticamente)
   * O duelo fica disponível para exportação ou descarte
   */
  endDuel(winner, reason, playerLP, botLP, turns) {
    if (!this.isEnabled() || !this.currentDuel) return;

    // Ordenar decisões por timestamp para garantir ordem cronológica correta
    this.currentDuel.decisions.sort((a, b) => a.timestamp - b.timestamp);

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

    // Filtrar eventos que não agregam valor (v2)
    if (this._shouldFilterEvent(type, data)) {
      return;
    }

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
      case "position_change":
        this.capturePositionChange(normalized);
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

    // Registrar carta no dicionário
    const card = { id: context.cardId, name: context.cardName };
    this._registerCard(card);

    const decision = {
      type: "set_spell_trap",
      timestamp: Date.now(),
      actor: context.actor || "human",
      card: { c: context.cardId },
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

    // Registrar carta no dicionário
    const card = { id: context.cardId, name: context.cardName };
    this._registerCard(card);

    const decision = {
      type: "trap_activation",
      timestamp: Date.now(),
      actor: context.actor || "human",
      card: { c: context.cardId },
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

    // Registrar carta no dicionário
    const card = {
      id: context.cardId || context.card?.id,
      name: context.cardName || context.card?.name,
    };
    this._registerCard(card);

    const decision = {
      type: "effect",
      timestamp: Date.now(),
      actor: context.actor || "human",
      card: { c: card.id },
      effectId: context.effectId,
      effectTiming: context.effectTiming,
      activationZone: context.activationZone,
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
   * Adiciona decisão ao duelo atual com otimizações v2
   */
  _addDecision(decision) {
    if (!this.currentDuel) return;

    // v4: Vincular availableActions pendentes (se houver e for do mesmo ator)
    const pendingActions = this._consumePendingActions();
    if (pendingActions && pendingActions.length > 0) {
      decision.availableActions = pendingActions;
    }

    // Adicionar timestamp relativo
    const timeRef = this._getRelativeTimestamp();
    if (timeRef.t0) {
      decision.t0 = timeRef.t0;
    } else {
      decision.dt = timeRef.dt;
    }
    delete decision.timestamp; // Remover timestamp absoluto redundante

    // Substituir gameState por delta (se não for turno de snapshot)
    if (decision.gameState) {
      const turn = decision.turn || decision.gameState.turn || 0;

      if (this._shouldSnapshot(turn)) {
        this._createSnapshot(decision.gameState, turn);
        delete decision.gameState; // Estado está no snapshot
      } else {
        const delta = this._computeDelta(decision.gameState);
        delete decision.gameState;
        if (delta && Object.keys(delta).length > 0) {
          decision.delta = delta;
        }
      }
    }

    // Omitir valores default comuns
    const defaults = {
      directAttack: false,
      facedown: false,
    };
    for (const [key, defaultValue] of Object.entries(defaults)) {
      if (decision[key] === defaultValue) {
        delete decision[key];
      }
    }

    // Compactar combatResult removendo valores default
    if (decision.combatResult) {
      const combatDefaults = {
        damageDealt: 0,
        targetDestroyed: false,
        attackerDestroyed: false,
        wasNegated: false,
      };
      for (const [key, defaultValue] of Object.entries(combatDefaults)) {
        if (decision.combatResult[key] === defaultValue) {
          delete decision.combatResult[key];
        }
      }
      // Se combatResult ficou vazio, remover
      if (Object.keys(decision.combatResult).length === 0) {
        delete decision.combatResult;
      }
    }

    this.currentDuel.decisions.push(decision);
  }

  /**
   * Captura uma decisão de summon
   */
  captureSummon(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    // Registrar carta no dicionário
    this._registerCard(context.card);

    // v3: Determinar tipo de summon
    let summonType = context.summonType || "normal";
    if (context.isAscension || context.card?.monsterType === "ascension") {
      summonType = "ascension";
    } else if (context.isFusion || context.card?.monsterType === "fusion") {
      summonType = "fusion";
    } else if (
      context.isSpecial ||
      context.fromZone === "graveyard" ||
      context.fromZone === "extraDeck"
    ) {
      summonType = "special";
    }

    const decision = {
      type: "summon",
      turn: context.turn || 0,
      phase: context.phase || "main1",
      timestamp: Date.now(),
      actor: context.actor || "human",

      // Carta usando referência compacta
      card: this._compactCardRef(context.card),

      // v3: Tipo de invocação (normal, special, ascension, fusion)
      summonType: summonType,

      // v3: Zona de origem (hand, graveyard, deck, extraDeck)
      fromZone: context.fromZone || "hand",

      // Contexto do jogo
      gameState: this._captureGameState(context),
    };

    this._addDecision(decision);
    this._logDecision(
      "SUMMON",
      context.card?.name,
      `[${summonType}] ${context.position || ""}${
        context.facedown ? " (set)" : ""
      } [${decision.actor}]`
    );
  }

  /**
   * Captura uma decisão de spell/trap
   */
  captureSpell(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    // Registrar carta no dicionário
    this._registerCard(context.card);

    const decision = {
      type: "spell",
      turn: context.turn || 0,
      phase: context.phase || "main1",
      timestamp: Date.now(),
      actor: context.actor || "human",

      // Carta usando referência compacta
      card: this._compactCardRef(context.card),

      // Targets selecionados
      targets: this._serializeTargets(context.targets),

      // Contexto do jogo
      gameState: this._captureGameState(context),
    };

    this._addDecision(decision);
    this._logDecision("SPELL", context.card?.name, `[${decision.actor}]`);
  }

  /**
   * Captura uma decisão de ataque
   */
  captureAttack(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    // Registrar cartas no dicionário
    this._registerCard(context.attacker);
    if (context.target) this._registerCard(context.target);

    const decision = {
      type: "attack",
      turn: context.turn || 0,
      phase: "battle",
      timestamp: Date.now(),
      actor: context.actor || "human",

      // Atacante compacto
      attacker: this._compactCardRef(context.attacker),

      // Alvo compacto (null = ataque direto)
      target: context.target ? this._compactCardRef(context.target) : null,

      directAttack: !context.target,

      // Resultado do combate
      combatResult: {
        damageDealt: context.damageDealt || 0,
        targetDestroyed: context.targetDestroyed || false,
        attackerDestroyed: context.attackerDestroyed || false,
        wasNegated: context.wasNegated || false,
      },

      // Contexto do jogo
      gameState: this._captureGameState(context),
    };

    this._addDecision(decision);

    // Log mais descritivo
    const resultDesc = context.wasNegated
      ? "(NEGADO)"
      : context.targetDestroyed
      ? `(+${context.damageDealt} dano, DESTRUIU)`
      : context.damageDealt > 0
      ? `(+${context.damageDealt} dano)`
      : "";

    this._logDecision(
      "ATTACK",
      context.attacker?.name,
      `${context.target?.name || "DIRETO"} ${resultDesc} [${decision.actor}]`
    );
  }

  /**
   * Captura detalhes de um efeito resolvido
   */
  captureEffectResolution(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    // Registrar carta fonte no dicionário
    this._registerCard(context.sourceCard);

    const decision = {
      type: "effect_resolution",
      turn: context.turn || 0,
      phase: context.phase || "unknown",
      timestamp: Date.now(),
      actor: context.actor || "unknown",

      // Carta que gerou o efeito (compacta)
      sourceCard: this._compactCardRef(context.sourceCard),

      // Resultado do efeito (compacto)
      effectResult: {
        type: context.effectType,
        targets: (context.targets || [])
          .map((t) => {
            this._registerCard(t);
            return {
              c: t?.id,
              atkDelta:
                t?.newAtk !== undefined && t?.previousAtk !== undefined
                  ? t.newAtk - t.previousAtk
                  : undefined,
              defDelta:
                t?.newDef !== undefined && t?.previousDef !== undefined
                  ? t.newDef - t.previousDef
                  : undefined,
            };
          })
          .filter((t) => t.c),
        // v3: cardsDrawn agora é array de nomes das cartas sacadas
        cardsDrawn: Array.isArray(context.cardsDrawn)
          ? context.cardsDrawn.map((c) => c?.name || c)
          : typeof context.cardsDrawn === "number"
          ? context.cardsDrawn
          : 0,
        // v3: cardsAdded é array de nomes das cartas adicionadas (search, etc)
        cardsAdded: Array.isArray(context.cardsAdded)
          ? context.cardsAdded.map((c) => c?.name || c)
          : context.cardAdded
          ? [context.cardAdded?.name || context.cardAdded]
          : [],
        // v3: cardsSearched para ações de search específico
        cardsSearched: context.cardsSearched
          ? Array.isArray(context.cardsSearched)
            ? context.cardsSearched.map((c) => c?.name || c)
            : [context.cardsSearched?.name || context.cardsSearched]
          : undefined,
        lpChange: context.lpChange || 0,
        description: context.description || "",
      },

      // Contexto do jogo
      gameState: this._captureGameState(context),
    };

    this._addDecision(decision);
    this._logDecision(
      "EFFECT",
      context.sourceCard?.name,
      context.description || "resolvido"
    );
  }

  /**
   * Captura uma decisão de chain response
   */
  captureChainResponse(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    // Registrar cartas no dicionário
    if (context.responseCard) this._registerCard(context.responseCard);
    if (context.triggerCard) this._registerCard(context.triggerCard);

    const decision = {
      type: "chain_response",
      turn: context.turn || 0,
      phase: context.phase || "unknown",
      timestamp: Date.now(),
      actor: context.actor || "human",

      // Trigger compacto
      trigger: context.triggerCard
        ? {
            type: context.triggerType,
            c: context.triggerCard?.id,
          }
        : null,

      // Resposta do jogador
      responded: context.responded,
      responseCard: context.responseCard
        ? this._compactCardRef(context.responseCard)
        : null,

      // Cartas disponíveis (apenas IDs)
      availableResponses: (context.availableCards || [])
        .map((c) => {
          this._registerCard(c);
          return c?.id;
        })
        .filter(Boolean),

      // Contexto do jogo
      gameState: this._captureGameState(context),
    };

    this._addDecision(decision);
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

    // Registrar carta no dicionário
    this._registerCard(context.fieldSpell);

    const decision = {
      type: "field_effect",
      turn: context.turn || 0,
      phase: context.phase || "main1",
      timestamp: Date.now(),
      actor: context.actor || "human",

      fieldSpell: this._compactCardRef(context.fieldSpell),

      // Targets selecionados
      targets: this._serializeTargets(context.targets),

      // Contexto do jogo
      gameState: this._captureGameState(context),
    };

    this._addDecision(decision);
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

      // Contexto do jogo
      gameState: this._captureGameState(context),
    };

    this._addDecision(decision);
    this._logDecision("PASS", context.phase, `[${decision.actor}]`);
  }

  /**
   * Captura escolha de posição para special summon
   */
  capturePositionChoice(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    // Registrar carta no dicionário
    this._registerCard(context.card);

    const decision = {
      type: "position_choice",
      turn: context.turn || 0,
      phase: context.phase || "main1",
      timestamp: Date.now(),
      actor: context.actor || "human",

      card: this._compactCardRef(context.card),

      chosenPosition: context.position === "attack" ? "a" : "d",
      summonType: context.summonType || "special",

      // Contexto do jogo
      gameState: this._captureGameState(context),
    };

    this._addDecision(decision);
    this._logDecision(
      "POSITION",
      context.card?.name,
      `${context.position} [${decision.actor}]`
    );
  }

  /**
   * Captura mudança de posição manual (não por efeito)
   */
  capturePositionChange(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    // Registrar carta no dicionário
    const card = { id: context.cardId, name: context.cardName };
    this._registerCard(card);

    const decision = {
      type: "position_change",
      turn: context.turn || context.board?.turnNumber || 0,
      phase: context.phase || context.board?.phase || "main1",
      timestamp: Date.now(),
      actor: context.actor || "human",

      card: this._compactCardRef(card),

      fromPosition: context.fromPosition === "attack" ? "a" : "d",
      toPosition: context.toPosition === "attack" ? "a" : "d",
      wasFlipped: context.wasFlipped || false,

      // Contexto do jogo
      gameState: this._captureGameState(context),
    };

    this._addDecision(decision);
    this._logDecision(
      "POS_CHANGE",
      context.cardName,
      `${context.fromPosition} → ${context.toPosition} [${decision.actor}]`
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAPTURA DE AVAILABLE ACTIONS (v4)
  // Para treino de IA: registra opções disponíveis no momento da decisão
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Registra ações disponíveis ANTES da decisão ser tomada
   * Deve ser chamado quando o menu/modal é apresentado (humano) ou ações são geradas (bot)
   *
   * @param {Object} context
   * @param {string} context.actor - "human" ou "bot"
   * @param {string} context.promptType - Tipo de prompt ("main_phase", "battle", "chain", etc)
   * @param {Array} context.actions - Array de ações disponíveis
   * @param {number} context.turn - Turno atual
   * @param {string} context.phase - Fase atual
   */
  registerAvailableActions(context) {
    if (!this.isEnabled() || !this.currentDuel) return;

    // Compactar ações para armazenamento
    const compactActions = (context.actions || []).map((action) => {
      const compact = {
        type: action.type,
      };

      // Adicionar cardId se disponível
      if (action.card?.id !== undefined) {
        compact.cardId = action.card.id;
        this._registerCard(action.card);
      } else if (action.cardId !== undefined) {
        compact.cardId = action.cardId;
      } else if (action.index !== undefined) {
        compact.index = action.index;
      }

      // Adicionar effectId se for efeito
      if (action.effectId) {
        compact.effectId = action.effectId;
      }

      // Adicionar target info se disponível
      if (action.target?.id !== undefined) {
        compact.targetId = action.target.id;
      }

      // Adicionar posição se relevante
      if (action.position) {
        compact.position = action.position === "attack" ? "a" : "d";
      }

      // Adicionar summonType se for summon
      if (action.summonType) {
        compact.summonType = action.summonType;
      }

      // Adicionar fromZone se disponível
      if (action.fromZone) {
        compact.fromZone = action.fromZone;
      }

      return compact;
    });

    // Armazenar pendente para vincular com próxima decisão
    this._pendingAvailableActions = {
      promptType: context.promptType || "unknown",
      actor: context.actor || "unknown",
      turn: context.turn,
      phase: context.phase,
      actions: compactActions,
      timestamp: Date.now(),
    };

    console.log(
      `%c[ReplayCapture] 📋 Available actions: ${compactActions.length} options for ${context.actor}`,
      "color: #88ccff"
    );
  }

  /**
   * Consome e retorna ações pendentes, limpando o armazenamento
   * Chamado internamente por _addDecision para vincular
   */
  _consumePendingActions() {
    if (!this._pendingAvailableActions) return null;

    const pending = this._pendingAvailableActions;
    this._pendingAvailableActions = null;

    // Verificar se não está muito antigo (máx 30 segundos)
    const age = Date.now() - pending.timestamp;
    if (age > 30000) {
      console.warn(
        "[ReplayCapture] Descartando availableActions antigas (>30s)"
      );
      return null;
    }

    return pending.actions;
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

        // v3: Mão do jogador (lista completa de nomes para análise de timing)
        playerHand: (player?.hand || []).map((c) => c?.name).filter(Boolean),
        playerHandCount: (player?.hand || []).length,

        // Mão detalhada (para análise de opções disponíveis)
        playerHandDetails: (player?.hand || []).map((c) => ({
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

        // v3: Mão do bot (apenas contagem - não revelamos cartas)
        botHandCount: (bot?.hand || []).length,

        // v3: Extra deck info
        playerExtraDeckCount: (player?.extraDeck || []).length,
        botExtraDeckCount: (bot?.extraDeck || []).length,

        // v3: Graveyard completo (ambos os lados)
        playerGraveyard: (player?.graveyard || [])
          .map((c) => c?.name)
          .filter(Boolean),
        playerGraveCount: (player?.graveyard || []).length,
        botGraveyard: (bot?.graveyard || [])
          .map((c) => c?.name)
          .filter(Boolean),
        botGraveCount: (bot?.graveyard || []).length,

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
      // v3: Mão completa do jogador
      playerHand: board.playerHand || [],
      playerHandCount: board.playerHandCount || 0,
      botHandCount: board.botHandCount || 0,
      // v3: Graveyard completo
      playerGraveyard: board.playerGraveyard || [],
      playerGraveCount: board.playerGraveCount || 0,
      botGraveyard: board.botGraveyard || [],
      botGraveCount: board.botGraveCount || 0,
      playerSpellTrapCount: board.playerSpellTrapCount || 0,
      botSpellTrapCount: board.botSpellTrapCount || 0,
      // v3: Extra deck e field spell
      playerExtraDeckCount: board.playerExtraDeckCount || 0,
      botExtraDeckCount: board.botExtraDeckCount || 0,
      playerFieldSpell: board.playerFieldSpell || null,
      botFieldSpell: board.botFieldSpell || null,
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

  // ═══════════════════════════════════════════════════════════════════════════
  // MÉTODOS DE OTIMIZAÇÃO v2
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Registra uma carta no dicionário e retorna seu ID
   */
  _registerCard(card) {
    if (!card || !card.id) return null;

    const id = card.id;
    if (!this._cardDictionary[id]) {
      this._cardDictionary[id] = card.name;
      if (this.currentDuel) {
        this.currentDuel.cardDictionary[id] = card.name;
      }
    }
    return id;
  }

  /**
   * Converte referência de carta para formato compacto
   * { name: "Luminarch Aegis", id: 107, atk: 2500 } → { c: 107, atk: 2500 }
   */
  _compactCardRef(card) {
    if (!card) return null;

    this._registerCard(card);

    // v3: Lidar com cards que podem ter apenas name ou apenas id
    const compact = {};

    if (card.id !== undefined) {
      compact.c = card.id;
    } else if (card.name) {
      // Fallback: usar nome se não tiver ID
      compact.name = card.name;
    }

    // Se não tem nem id nem name, retornar null
    if (!compact.c && !compact.name) return null;

    // Incluir apenas atributos dinâmicos relevantes
    if (card.atk !== undefined) compact.atk = card.atk;
    if (card.def !== undefined) compact.def = card.def;
    if (card.position) compact.pos = card.position === "attack" ? "a" : "d";
    if (card.isFacedown) compact.fd = true;

    return compact;
  }

  /**
   * Calcula timestamp relativo
   */
  _getRelativeTimestamp() {
    const now = Date.now();

    if (this._lastTimestamp === null) {
      this._lastTimestamp = now;
      return { t0: now };
    }

    const delta = now - this._lastTimestamp;
    this._lastTimestamp = now;
    return { dt: delta };
  }

  /**
   * Verifica se precisa criar um snapshot neste turno
   */
  _shouldSnapshot(turn) {
    if (turn === 0 || turn === 1) return true; // Sempre snapshot no início
    if (this._lastSnapshotTurn < 0) return true; // Primeiro evento
    if (turn - this._lastSnapshotTurn >= SNAPSHOT_INTERVAL) return true;
    return false;
  }

  /**
   * Cria um snapshot completo do estado do jogo
   */
  _createSnapshot(gameState, turn) {
    if (!this.currentDuel) return;

    // Evitar snapshots duplicados no mesmo turno
    if (this.currentDuel.snapshots[turn]) return;

    this.currentDuel.snapshots[turn] = { ...gameState };
    this._lastSnapshotTurn = turn;
    this._lastState = { ...gameState };
  }

  /**
   * Calcula delta entre estado atual e anterior
   */
  _computeDelta(currentState) {
    if (!this._lastState) {
      // Primeiro estado - retornar completo
      this._lastState = { ...currentState };
      return currentState;
    }

    const delta = {};

    // Comparar cada campo
    for (const key of Object.keys(currentState)) {
      const current = currentState[key];
      const previous = this._lastState[key];

      // Arrays (fields) - comparar por JSON
      if (Array.isArray(current)) {
        if (JSON.stringify(current) !== JSON.stringify(previous)) {
          delta[key] = current;
        }
      }
      // Valores primitivos
      else if (current !== previous) {
        delta[key] = current;
      }
    }

    // Atualizar último estado
    this._lastState = { ...currentState };

    // Se nada mudou, retornar null
    return Object.keys(delta).length > 0 ? delta : null;
  }

  /**
   * Verifica se um evento deve ser filtrado (não gravado)
   */
  _shouldFilterEvent(type, context) {
    // Filtrar chain_response vazios (não respondeu E não tinha opções)
    if (type === "chain_response") {
      if (
        !context.responded &&
        (!context.availableCards || context.availableCards.length === 0)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Remove valores default de um objeto para compactação
   */
  _omitDefaults(obj, defaults) {
    const result = { ...obj };

    for (const [key, defaultValue] of Object.entries(defaults)) {
      if (result[key] === defaultValue) {
        delete result[key];
      }
    }

    return result;
  }

  /**
   * Reconstrói estado completo a partir de snapshots e deltas
   * @param {number} eventIndex - Índice do evento para reconstruir
   * @returns {Object} Estado completo do jogo naquele momento
   */
  reconstructStateAtEvent(eventIndex) {
    const duel = this.lastCompletedDuel || this.currentDuel;
    if (!duel) return null;

    const decisions = duel.decisions;

    if (eventIndex < 0 || eventIndex >= decisions.length) return null;

    // Encontrar snapshot mais recente antes do evento
    const event = decisions[eventIndex];
    const eventTurn = event.turn || 0;

    let baseState = null;

    // Procurar snapshot mais próximo (menor ou igual ao turno do evento)
    const snapshotTurns = Object.keys(duel.snapshots)
      .map(Number)
      .sort((a, b) => b - a);

    for (const turn of snapshotTurns) {
      if (turn <= eventTurn) {
        baseState = { ...duel.snapshots[turn] };
        break;
      }
    }

    if (!baseState && duel.snapshots["0"]) {
      baseState = { ...duel.snapshots["0"] };
    }
    if (!baseState && duel.snapshots["1"]) {
      baseState = { ...duel.snapshots["1"] };
    }
    if (!baseState) {
      baseState = {};
    }

    // Aplicar deltas sequencialmente até o evento
    for (let i = 0; i <= eventIndex; i++) {
      const decision = decisions[i];
      if (decision.delta) {
        Object.assign(baseState, decision.delta);
      }
      // Se evento tem gameState completo (compatibilidade v1), usar
      if (decision.gameState && Object.keys(decision.gameState).length > 5) {
        baseState = { ...decision.gameState };
      }
    }

    return baseState;
  }

  /**
   * Converte nome de carta para ID usando dicionário reverso
   */
  getCardIdByName(name) {
    const duel = this.lastCompletedDuel || this.currentDuel;
    if (!duel) return null;

    const dict = duel.cardDictionary;
    for (const [id, cardName] of Object.entries(dict)) {
      if (cardName === name) return Number(id);
    }
    return null;
  }

  /**
   * Converte ID de carta para nome usando dicionário
   */
  getCardNameById(id) {
    const duel = this.lastCompletedDuel || this.currentDuel;
    if (!duel) return null;
    return duel.cardDictionary[id] || null;
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

      if (d.type === "summon" && d.card) {
        // v2: card.c é o ID, usar dicionário para nome
        const cardName =
          d.card.name || duel.cardDictionary[d.card.c] || `Card#${d.card.c}`;
        stats.cardsSummoned.push(cardName);
      }
      if (d.type === "attack") {
        stats.attacksMade++;
      }
    }

    // Adicionar info sobre otimização v2
    stats.version = duel.version || 1;
    stats.snapshotCount = Object.keys(duel.snapshots || {}).length;
    stats.cardDictionarySize = Object.keys(duel.cardDictionary || {}).length;

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
    console.log(
      `Versão: ${stats.version} ${
        stats.version >= 2 ? "(otimizado)" : "(legado)"
      }`
    );
    console.log(`Resultado: ${stats.winner} (${stats.reason})`);
    console.log(`Turnos: ${stats.turns}`);
    console.log(`Total de decisões: ${stats.totalDecisions}`);
    if (stats.version >= 2) {
      console.log(
        `Snapshots: ${stats.snapshotCount} | Cartas no dicionário: ${stats.cardDictionarySize}`
      );
    }

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
