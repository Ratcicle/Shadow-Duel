// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/replay/integration.js
// Integração do sistema de captura de replay com o Game
// Captura decisões de AMBOS os jogadores (humano e bot) para análise completa
// ─────────────────────────────────────────────────────────────────────────────

import ReplayCapture from "../../ReplayCapture.js";

/**
 * Determina o tipo de ator (human/bot) a partir do payload
 */
function getActorType(payload, game) {
  // Tentar várias formas de identificar o jogador
  if (payload.player?.controllerType) {
    return payload.player.controllerType === "human" ? "human" : "bot";
  }
  if (payload.player?.id) {
    return payload.player.id === "player" ? "human" : "bot";
  }
  if (payload.attacker?.owner) {
    return payload.attacker.owner === "player" ? "human" : "bot";
  }
  if (payload.card?.owner) {
    return payload.card.owner === "player" ? "human" : "bot";
  }
  // Fallback: usar turno atual
  if (game?.turn) {
    return game.turn === "player" ? "human" : "bot";
  }
  return "unknown";
}

/**
 * Integra o sistema de captura de replay com uma instância do Game.
 * Registra listeners para eventos relevantes e captura decisões de AMBOS os jogadores.
 * @param {Game} game - Instância do jogo
 */
export function integrateReplayCapture(game) {
  // Só ativa se o modo de captura estiver habilitado
  if (!ReplayCapture.isEnabled()) {
    return;
  }

  console.log(
    "[ReplayCapture] Integração ativada para este duelo (captura completa)"
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Summons (Normal, Tribute, Special, Fusion, Ascension)
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("after_summon", (payload) => {
    const actor = getActorType(payload, game);
    const boardState = captureMinimalBoardState(game);

    // v3: Determinar tipo de summon para análise
    const method = payload.method || "normal";
    const isAscension =
      method === "ascension" || payload.card?.monsterType === "ascension";
    const isFusion =
      method === "fusion" || payload.card?.monsterType === "fusion";
    const isSpecial =
      method === "special" ||
      isAscension ||
      isFusion ||
      payload.fromZone !== "hand";

    ReplayCapture.capture("summon", {
      actor,
      cardName: payload.card?.name,
      cardId: payload.card?.id,
      position: payload.position,
      method: method, // "normal", "tribute", "special", "fusion", "ascension"
      summonType: isAscension
        ? "ascension"
        : isFusion
        ? "fusion"
        : isSpecial
        ? "special"
        : "normal",
      isAscension: isAscension,
      isFusion: isFusion,
      isSpecial: isSpecial,
      fromZone: payload.fromZone,
      tributes: payload.tributes?.map((t) => t.name) || [],
      board: boardState,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Ataques
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("attack_declared", (payload) => {
    const actor = payload.attacker?.owner === "player" ? "human" : "bot";
    const boardState = captureMinimalBoardState(game);

    const hasTarget = !!payload.target;
    const targetName = payload.target?.name;
    const isDirectAttack = !payload.target;

    ReplayCapture.capture("attack", {
      actor,
      attackerName: payload.attacker?.name,
      attackerId: payload.attacker?.id,
      attackerAtk: payload.attacker?.atk,
      targetName: targetName || null,
      targetId: payload.target?.id,
      targetAtk: payload.target?.atk,
      targetDef: payload.target?.def,
      targetPosition: payload.target?.position,
      targetIsFacedown: payload.target?.isFacedown,
      isDirectAttack: isDirectAttack,
      board: boardState,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Resultado de Combate (dano, destruição)
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("combat_resolved", (payload) => {
    const actor = payload.attacker?.owner === "player" ? "human" : "bot";
    const boardState = captureMinimalBoardState(game);

    ReplayCapture.capture("attack", {
      actor,
      attackerName: payload.attacker?.name,
      attackerId: payload.attacker?.id,
      attackerAtk: payload.attacker?.atk,
      targetName: payload.target?.name || null,
      targetId: payload.target?.id,
      targetAtk: payload.target?.atk,
      targetDef: payload.target?.def,
      targetPosition: payload.target?.position,
      isDirectAttack: !payload.target,
      damageDealt: payload.damageDealt || 0,
      targetDestroyed: payload.targetDestroyed || false,
      attackerDestroyed: payload.attackerDestroyed || false,
      board: boardState,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Ativação de Spells/Traps
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("spell_activated", (payload) => {
    const actor = getActorType(payload, game);
    const boardState = captureMinimalBoardState(game);

    ReplayCapture.capture("spell", {
      actor,
      cardName: payload.card?.name,
      cardId: payload.card?.id,
      subtype: payload.card?.subtype,
      targets: payload.targets?.map((t) => t.name) || [],
      fromHand: payload.fromHand,
      board: boardState,
    });
  });

  game.on("trap_activated", (payload) => {
    const actor = getActorType(payload, game);
    const boardState = captureMinimalBoardState(game);

    ReplayCapture.capture("trap_activation", {
      actor,
      cardName: payload.card?.name,
      cardId: payload.card?.id,
      trigger: payload.trigger,
      chainLink: payload.chainLink,
      board: boardState,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Buffs de Status
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("stat_buff_applied", (payload) => {
    const actor = getActorType(payload, game);
    const boardState = captureMinimalBoardState(game);

    ReplayCapture.captureEffectResolution({
      actor,
      turn: game.turnCounter,
      phase: game.phase,
      sourceCard: payload.sourceCard,
      effectType: "buff",
      targets: [
        {
          name: payload.card?.name,
          previousAtk: payload.previousAtk,
          newAtk: payload.newAtk,
          previousDef: payload.previousDef,
          newDef: payload.newDef,
        },
      ],
      description: `${payload.card?.name} ${payload.atkChange > 0 ? "+" : ""}${
        payload.atkChange
      } ATK, ${payload.defChange > 0 ? "+" : ""}${payload.defChange} DEF${
        payload.permanent ? "" : " (temp)"
      }`,
      board: boardState,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Cartas Adicionadas à Mão (search, draw de efeitos)
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("cards_added_to_hand", (payload) => {
    const actor = payload.player?.id === "player" ? "human" : "bot";
    const boardState = captureMinimalBoardState(game);

    ReplayCapture.captureEffectResolution({
      actor,
      turn: game.turnCounter,
      phase: game.phase,
      sourceCard: payload.sourceCard, // Passar objeto completo para _compactCardRef
      effectType: "search",
      cardsAdded: payload.cards?.map((c) => c.name) || [],
      fromZone: payload.fromZone,
      description: `Added ${payload.cards?.length || 0} card(s) to hand from ${
        payload.fromZone
      }`,
      board: boardState,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Mudança de Posição Manual
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("position_change", (payload) => {
    const actor = payload.player?.id === "player" ? "human" : "bot";
    const boardState = captureMinimalBoardState(game);

    ReplayCapture.capture("position_change", {
      actor,
      cardName: payload.card?.name,
      cardId: payload.card?.id,
      fromPosition: payload.fromPosition,
      toPosition: payload.toPosition,
      wasFlipped: payload.wasFlipped,
      board: boardState,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Chain Responses
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("chain_response", (payload) => {
    const actor = getActorType(payload, game);
    const boardState = captureMinimalBoardState(game);

    ReplayCapture.capture("chain_response", {
      actor,
      responded: payload.responded,
      cardUsed: payload.card?.name,
      chainLength: payload.chainLength,
      triggerCard: payload.triggerCard?.name,
      board: boardState,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Set Spell/Trap
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("card_set", (payload) => {
    const actor = getActorType(payload, game);
    const boardState = captureMinimalBoardState(game);

    ReplayCapture.capture("set_spell_trap", {
      actor,
      cardName: payload.card?.name,
      cardId: payload.card?.id,
      cardKind: payload.card?.cardKind,
      subtype: payload.card?.subtype,
      board: boardState,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Pass Phase (apenas humano - bot não "passa" explicitamente)
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("phase_skip", (payload) => {
    // Pass só faz sentido para o humano
    if (payload.player !== "player") return;

    const boardState = captureMinimalBoardState(game);

    ReplayCapture.capture("pass", {
      actor: "human",
      fromPhase: payload.fromPhase,
      toPhase: payload.toPhase,
      turnNumber: game.turnCounter,
      board: boardState,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Início de Turno (para marcar claramente a mudança de turno)
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("turn_start", (payload) => {
    const actor = payload.player === "player" ? "human" : "bot";

    ReplayCapture.capture("turn_start", {
      actor,
      turnNumber: game.turnCounter,
      playerLP: game.player.lp,
      botLP: game.bot.lp,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Position Choice (summon position)
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("position_chosen", (payload) => {
    const actor = getActorType(payload, game);

    ReplayCapture.capture("position_choice", {
      actor,
      cardName: payload.card?.name,
      cardId: payload.card?.id,
      position: payload.position,
      context: payload.context, // "summon", "effect", etc.
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Efeitos de Monstro/Spell/Trap Ativados
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("effect_activated", (payload) => {
    const actor = getActorType(payload, game);
    const boardState = captureMinimalBoardState(game);

    ReplayCapture.capture("effect", {
      actor,
      cardName: payload.card?.name,
      cardId: payload.card?.id,
      cardKind: payload.card?.cardKind,
      effectId: payload.effect?.id,
      effectTiming: payload.effect?.timing,
      activationZone: payload.activationZone, // "field", "hand", "graveyard", "spellTrap", "fieldSpell"
      effectType: payload.effectType, // "ignition", "spell_trap", etc.
      actions: payload.effect?.actions?.map((a) => a.type) || [],
      board: boardState,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Destruição de Cartas (para contexto)
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("card_destroyed", (payload) => {
    const owner = payload.card?.owner === "player" ? "human" : "bot";

    ReplayCapture.capture("card_destroyed", {
      owner, // Quem perdeu a carta
      cardName: payload.card?.name,
      cardId: payload.card?.id,
      destroyedBy: payload.source || "battle",
      fromZone: payload.fromZone || "field",
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Dano Infligido
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("damage_inflicted", (payload) => {
    const target = payload.target?.id === "player" ? "human" : "bot";

    ReplayCapture.capture("damage", {
      target, // Quem tomou dano
      amount: payload.amount,
      source: payload.source || "battle",
      newLP: payload.newLP,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Fim do Duelo
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("game_over", (payload) => {
    const humanWon =
      payload.winner?.controllerType === "human" ||
      payload.winner?.id === "player" ||
      payload.winner === "player";

    ReplayCapture.endDuel({
      winner: humanWon ? "human" : "bot",
      reason: payload.reason,
      finalLP: {
        player: game.player.lp,
        bot: game.bot.lp,
      },
      totalTurns: game.turnCounter,
      botPreset: game.botPreset,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CAPTURA DE AVAILABLE ACTIONS PARA HUMANO (v4)
  // Registra opções disponíveis no momento da decisão
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Captura ações disponíveis quando humano entra na Main Phase
   */
  game.on("main_phase_options", (payload) => {
    if (payload.player !== "player") return;

    const actions = [];

    // Cartas invocáveis na mão
    if (payload.summonableCards?.length) {
      payload.summonableCards.forEach((card, index) => {
        actions.push({
          type: "summon",
          card: { id: card.id, name: card.name },
          index,
        });
      });
    }

    // Spells/Traps setáveis
    if (payload.settableCards?.length) {
      payload.settableCards.forEach((card, index) => {
        actions.push({
          type: "set",
          card: { id: card.id, name: card.name },
          index,
        });
      });
    }

    // Spells ativáveis
    if (payload.activatableSpells?.length) {
      payload.activatableSpells.forEach((card) => {
        actions.push({
          type: "activate_spell",
          card: { id: card.id, name: card.name },
        });
      });
    }

    // Efeitos de campo ativáveis
    if (payload.fieldEffects?.length) {
      payload.fieldEffects.forEach((effect) => {
        actions.push({
          type: "ignition_effect",
          card: { id: effect.card?.id, name: effect.card?.name },
          effectId: effect.effectId,
        });
      });
    }

    // Posições mudáveis
    if (payload.positionChangeable?.length) {
      payload.positionChangeable.forEach((card) => {
        actions.push({
          type: "position_change",
          card: { id: card.id, name: card.name },
        });
      });
    }

    // Sempre pode passar
    actions.push({ type: "pass" });

    ReplayCapture.registerAvailableActions({
      actor: "human",
      promptType: "main_phase",
      turn: game.turnCounter,
      phase: game.phase,
      actions,
    });
  });

  /**
   * Captura ações de ataque disponíveis para humano
   */
  game.on("battle_phase_options", (payload) => {
    if (payload.player !== "player") return;

    const actions = [];

    // Monstros que podem atacar
    if (payload.attackableMonsters?.length) {
      payload.attackableMonsters.forEach((monster) => {
        // Ataque direto
        if (payload.canDirectAttack) {
          actions.push({
            type: "direct_attack",
            card: { id: monster.id, name: monster.name },
          });
        }

        // Ataques a alvos
        if (payload.validTargets?.length) {
          payload.validTargets.forEach((target) => {
            actions.push({
              type: "attack",
              card: { id: monster.id, name: monster.name },
              target: { id: target.id, name: target.name },
            });
          });
        }
      });
    }

    // Sempre pode passar
    actions.push({ type: "end_battle" });

    ReplayCapture.registerAvailableActions({
      actor: "human",
      promptType: "battle_phase",
      turn: game.turnCounter,
      phase: game.phase,
      actions,
    });
  });

  /**
   * Captura opções de resposta em chain
   */
  game.on("chain_window_options", (payload) => {
    if (payload.player !== "player") return;

    const actions = [];

    // Traps/Quick-plays ativáveis
    if (payload.activatableCards?.length) {
      payload.activatableCards.forEach((card) => {
        actions.push({
          type: "chain_activate",
          card: { id: card.id, name: card.name },
          effectId: card.effectId,
        });
      });
    }

    // Sempre pode passar
    actions.push({ type: "pass" });

    ReplayCapture.registerAvailableActions({
      actor: "human",
      promptType: "chain_window",
      turn: game.turnCounter,
      phase: game.phase,
      actions,
    });
  });

  /**
   * Captura escolha de posição de summon
   */
  game.on("summon_position_choice", (payload) => {
    if (payload.player !== "player") return;

    const actions = [
      {
        type: "attack_position",
        card: { id: payload.card?.id, name: payload.card?.name },
      },
      {
        type: "defense_position",
        card: { id: payload.card?.id, name: payload.card?.name },
      },
    ];

    ReplayCapture.registerAvailableActions({
      actor: "human",
      promptType: "summon_position",
      turn: game.turnCounter,
      phase: game.phase,
      actions,
    });
  });

  /**
   * Captura escolha de alvos
   */
  game.on("target_selection_options", (payload) => {
    if (payload.player !== "player") return;

    const actions = (payload.candidates || []).map((target) => ({
      type: "select_target",
      target: { id: target.id, name: target.name },
      zone: target.zone,
    }));

    // Pode cancelar se permitido
    if (payload.allowCancel) {
      actions.push({ type: "cancel" });
    }

    ReplayCapture.registerAvailableActions({
      actor: "human",
      promptType: "target_selection",
      turn: game.turnCounter,
      phase: game.phase,
      actions,
      context: {
        effectId: payload.effectId,
        sourceCard: payload.sourceCard?.name,
      },
    });
  });
}

/**
 * Inicia a captura de um novo duelo.
 * Deve ser chamado no início do Game.start()
 * @param {Game} game - Instância do jogo
 */
export function startReplayCapture(game) {
  if (!ReplayCapture.isEnabled()) return;

  const playerDeck = game.player.deck?.map((c) => c.name) || [];
  const playerExtra = game.player.extraDeck?.map((c) => c.name) || [];

  // v3: Capturar deck do bot completo se disponível
  const botDeck = game.bot.deck?.map((c) => c.name) || [];
  const botExtra = game.bot.extraDeck?.map((c) => c.name) || [];

  ReplayCapture.startDuel(
    {
      playerDeck: playerDeck.slice(0, 10), // Primeiras 10 cartas do deck (sample)
      playerExtraDeck: playerExtra,
      botPreset: game.botPreset,
      timestamp: Date.now(),
    },
    // v3: Passar deck do bot como segundo argumento
    {
      cards: botDeck,
      extraDeck: botExtra,
    },
    game.botPreset // arquétipo
  );

  console.log("[ReplayCapture] Novo duelo iniciado - captura completa ativa");
}

/**
 * Captura estado mínimo do board para contexto
 */
function captureMinimalBoardState(game) {
  return {
    turn: game.turn,
    phase: game.phase,
    turnNumber: game.turnCounter,
    playerLP: game.player.lp,
    botLP: game.bot.lp,
    playerField:
      game.player.field
        ?.map((c) => ({
          name: c?.name,
          atk: c?.atk,
          def: c?.def,
          position: c?.position,
        }))
        .filter(Boolean) || [],
    botField:
      game.bot.field
        ?.map((c) => ({
          name: c?.name,
          atk: c?.atk,
          def: c?.def,
          position: c?.position,
          isFacedown: c?.isFacedown,
        }))
        .filter(Boolean) || [],
    // v3: Mão completa do jogador (nomes das cartas)
    playerHand: game.player.hand?.map((c) => c?.name).filter(Boolean) || [],
    playerHandCount: game.player.hand?.length || 0,
    botHandCount: game.bot.hand?.length || 0,
    // v3: Graveyard completo (ambos os lados)
    playerGraveyard:
      game.player.graveyard?.map((c) => c?.name).filter(Boolean) || [],
    playerGraveCount: game.player.graveyard?.length || 0,
    botGraveyard: game.bot.graveyard?.map((c) => c?.name).filter(Boolean) || [],
    botGraveCount: game.bot.graveyard?.length || 0,
    playerSpellTrapCount:
      game.player.spellTrapZone?.filter(Boolean).length || 0,
    botSpellTrapCount: game.bot.spellTrapZone?.filter(Boolean).length || 0,
    // v3: Extra deck counts
    playerExtraDeckCount: game.player.extraDeck?.length || 0,
    botExtraDeckCount: game.bot.extraDeck?.length || 0,
    // v3: Field spells
    playerFieldSpell: game.player.fieldSpell?.name || null,
    botFieldSpell: game.bot.fieldSpell?.name || null,
  };
}

/**
 * Exporta funções de utilidade do ReplayCapture
 */
export { ReplayCapture };
