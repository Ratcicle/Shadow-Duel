// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/replay/integration.js
// Integração do sistema de captura de replay com o Game
// ─────────────────────────────────────────────────────────────────────────────

import ReplayCapture from "../../ReplayCapture.js";

/**
 * Integra o sistema de captura de replay com uma instância do Game.
 * Registra listeners para eventos relevantes e captura decisões do jogador humano.
 * @param {Game} game - Instância do jogo
 */
export function integrateReplayCapture(game) {
  // Só ativa se o modo de captura estiver habilitado
  if (!ReplayCapture.isEnabled()) {
    return;
  }

  console.log("[ReplayCapture] Integração ativada para este duelo");

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Summons (Normal e Tribute)
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("after_summon", (payload) => {
    // Só captura decisões do jogador humano
    if (payload.player?.controllerType !== "human") return;

    const boardState = captureMinimalBoardState(game);

    ReplayCapture.capture("summon", {
      cardName: payload.card?.name,
      cardId: payload.card?.id,
      position: payload.position,
      method: payload.method, // "normal", "tribute", "special"
      fromZone: payload.fromZone,
      tributes: payload.tributes?.map((t) => t.name) || [],
      board: boardState,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Ataques
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("attack_declared", (payload) => {
    // Só captura ataques do jogador humano
    if (payload.attacker?.owner !== "player") return;

    const boardState = captureMinimalBoardState(game);

    ReplayCapture.capture("attack", {
      attackerName: payload.attacker?.name,
      attackerId: payload.attacker?.id,
      attackerAtk: payload.attacker?.atk,
      targetName: payload.target?.name || "direct",
      targetId: payload.target?.id,
      targetAtk: payload.target?.atk,
      targetDef: payload.target?.def,
      targetPosition: payload.target?.position,
      isDirectAttack: !payload.target,
      board: boardState,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Ativação de Spells/Traps
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("spell_activated", (payload) => {
    if (payload.player?.controllerType !== "human") return;

    const boardState = captureMinimalBoardState(game);

    ReplayCapture.capture("spell", {
      cardName: payload.card?.name,
      cardId: payload.card?.id,
      subtype: payload.card?.subtype,
      targets: payload.targets?.map((t) => t.name) || [],
      fromHand: payload.fromHand,
      board: boardState,
    });
  });

  game.on("trap_activated", (payload) => {
    if (payload.player?.controllerType !== "human") return;

    const boardState = captureMinimalBoardState(game);

    ReplayCapture.capture("trap_activation", {
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
    if (payload.player?.controllerType !== "human") return;

    const boardState = captureMinimalBoardState(game);

    ReplayCapture.capture("chain_response", {
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
    if (payload.player?.controllerType !== "human") return;

    const boardState = captureMinimalBoardState(game);

    ReplayCapture.capture("set_spell_trap", {
      cardName: payload.card?.name,
      cardId: payload.card?.id,
      cardKind: payload.card?.cardKind,
      subtype: payload.card?.subtype,
      board: boardState,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Pass Phase
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("phase_skip", (payload) => {
    if (payload.player !== "player") return;

    const boardState = captureMinimalBoardState(game);

    ReplayCapture.capture("pass", {
      fromPhase: payload.fromPhase,
      toPhase: payload.toPhase,
      turnNumber: game.turnCounter,
      board: boardState,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Captura de Position Choice (summon position)
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("position_chosen", (payload) => {
    if (payload.player?.controllerType !== "human") return;

    ReplayCapture.capture("position_choice", {
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
    if (payload.player?.controllerType !== "human") return;

    const boardState = captureMinimalBoardState(game);

    ReplayCapture.capture("effect", {
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
  // Fim do Duelo
  // ─────────────────────────────────────────────────────────────────────────────
  game.on("game_over", (payload) => {
    const humanWon = payload.winner?.controllerType === "human";

    ReplayCapture.endDuel({
      winner: humanWon ? "player" : "bot",
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

  console.log("[ReplayCapture] Novo duelo iniciado - captura ativa");
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
          position: c?.position,
          faceDown: c?.faceDown,
        }))
        .filter(Boolean) || [],
    playerHandCount: game.player.hand?.length || 0,
    playerGraveCount: game.player.graveyard?.length || 0,
    playerSpellTrapCount:
      game.player.spellTrapZone?.filter(Boolean).length || 0,
    botSpellTrapCount: game.bot.spellTrapZone?.filter(Boolean).length || 0,
  };
}

/**
 * Exporta funções de utilidade do ReplayCapture
 */
export { ReplayCapture };
