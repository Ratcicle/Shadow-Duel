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

    ReplayCapture.capture("summon", {
      actor,
      cardName: payload.card?.name,
      cardId: payload.card?.id,
      position: payload.position,
      method: payload.method, // "normal", "tribute", "special", "fusion", "ascension"
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

  ReplayCapture.startDuel({
    playerDeck: playerDeck.slice(0, 10), // Primeiras 10 cartas do deck (sample)
    playerExtraDeck: playerExtra,
    botPreset: game.botPreset,
    timestamp: Date.now(),
  });

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
    playerHandCount: game.player.hand?.length || 0,
    botHandCount: game.bot.hand?.length || 0,
    playerGraveCount: game.player.graveyard?.length || 0,
    botGraveCount: game.bot.graveyard?.length || 0,
    playerSpellTrapCount:
      game.player.spellTrapZone?.filter(Boolean).length || 0,
    botSpellTrapCount: game.bot.spellTrapZone?.filter(Boolean).length || 0,
  };
}

/**
 * Exporta funções de utilidade do ReplayCapture
 */
export { ReplayCapture };
