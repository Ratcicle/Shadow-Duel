/**
 * Summon Actions - special summon tokens and revival
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

import Card from "../../Card.js";

/**
 * Apply special summon token action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @returns {Promise<boolean>} Whether token was summoned
 */
export async function applySpecialSummonToken(action, ctx) {
  const targetPlayer = action.player === "opponent" ? ctx.opponent : ctx.player;
  if (!action.token) return false;
  if (targetPlayer.field.length >= 5) {
    console.log("No space to special summon token.");
    return false;
  }

  const tokenCard = new Card(
    {
      cardKind: "monster",
      name: action.token.name || "Token",
      atk: action.token.atk ?? 0,
      def: action.token.def ?? 0,
      level: action.token.level ?? 1,
      type: action.token.type || "Fiend",
      image: action.token.image || "",
      description: action.token.description || "Special Summoned by effect.",
    },
    targetPlayer.id
  );

  // Mark as token - this is the canonical flag for token identification
  // Tokens that leave the field are removed from the game entirely (handled in Game.moveCardInternal)
  tokenCard.isToken = true;
  // Optional debug info - not used for logic, only for tracing
  tokenCard.tokenSourceCard = ctx.card?.name || null;

  // UNIFIED POSITION SEMANTICS: respect action.position
  // undefined/null → "choice" (default)
  // "choice" → allow player/bot to choose
  // "attack"/"defense" → forced position
  const position = await this.chooseSpecialSummonPosition(
    tokenCard,
    targetPlayer,
    { position: action.position }
  );

  // Try moveCard first for consistent pipeline
  let moved = false;
  if (this.game && typeof this.game.moveCard === "function") {
    const moveResult = await this.game.moveCard(
      tokenCard,
      targetPlayer,
      "field",
      {
        position,
        isFacedown: false,
        resetAttackFlags: true,
      }
    );
    if (moveResult?.success === false) {
      return false;
    }
    moved = moveResult?.success === true;
  }

  // Fallback for tokens (not present in any zone initially)
  if (!moved) {
    if (targetPlayer.field.length >= 5) {
      console.log("No space to special summon token.");
      return false;
    }
    tokenCard.position = position;
    tokenCard.isFacedown = false;
    tokenCard.hasAttacked = false;
    tokenCard.cannotAttackThisTurn = action.cannotAttackThisTurn !== false; // Default true for tokens
    tokenCard.attacksUsedThisTurn = 0;
    tokenCard.owner = targetPlayer.id;
    tokenCard.controller = targetPlayer.id;

    // Set summonedTurn for consistency with other summons
    if (this.game?.turnCounter) {
      tokenCard.summonedTurn = this.game.turnCounter;
    }

    if (!targetPlayer.field.includes(tokenCard)) {
      targetPlayer.field.push(tokenCard);
    }

    // Emit after_summon event manually (moveCard would do this automatically)
    if (this.game && typeof this.game.emit === "function") {
      await this.game.emit("after_summon", {
        card: tokenCard,
        player: targetPlayer,
        method: "special",
        fromZone: "token",
      });
    }
  }

  if (this.game && typeof this.game.updateBoard === "function") {
    this.game.updateBoard();
  }
  if (this.game && typeof this.game.checkWinCondition === "function") {
    this.game.checkWinCondition();
  }

  return true;
}

/**
 * Apply Call of the Haunted summon action - revive monster from graveyard
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {Promise<boolean>} Whether monster was summoned
 */
export async function applyCallOfTheHauntedSummon(action, ctx, targets) {
  const player = ctx.player;
  const card = ctx.source;
  const game = this.game;

  console.log(`[applyCallOfTheHauntedSummon] Called with targets:`, targets);

  if (!targets || !targets.haunted_target) {
    game.ui.log(`Call of the Haunted: Nenhum alvo selecionado no cemitério.`);
    return false;
  }

  // targets.haunted_target pode ser um array de cartas selecionadas
  const targetArray = Array.isArray(targets.haunted_target)
    ? targets.haunted_target
    : [targets.haunted_target];

  const targetMonster = targetArray[0];
  console.log(
    `[applyCallOfTheHauntedSummon] Target monster:`,
    targetMonster?.name
  );

  if (!targetMonster || targetMonster.cardKind !== "monster") {
    game.ui.log(`Call of the Haunted: Alvo inválido.`);
    return false;
  }

  // UNIFIED POSITION SEMANTICS: respect action.position
  // undefined/null → "choice" (default for Call of the Haunted)
  // "choice" → allow player/bot to choose
  // "attack"/"defense" → forced position
  const position = await this.chooseSpecialSummonPosition(
    targetMonster,
    player,
    { position: action.position }
  );

  // Use moveCard for consistent pipeline (handles zones, flags, events)
  let usedMoveCard = false;
  if (game && typeof game.moveCard === "function") {
    const moveResult = await game.moveCard(targetMonster, player, "field", {
      fromZone: "graveyard",
      position,
      isFacedown: false,
      resetAttackFlags: true,
    });
    if (moveResult?.success === false) {
      return false;
    }
    usedMoveCard = moveResult?.success === true;
  }

  // Fallback if moveCard not available or failed
  if (!usedMoveCard) {
    if (player.field.length >= 5) {
      game.ui.log("Field is full. Cannot summon.");
      return false;
    }
    // Manual removal from graveyard
    const gyIndex = player.graveyard.indexOf(targetMonster);
    if (gyIndex > -1) {
      player.graveyard.splice(gyIndex, 1);
    } else {
      console.log(
        `[applyCallOfTheHauntedSummon] Monster not found in graveyard`
      );
    }

    // Manual field addition with consistent flags
    targetMonster.position = position;
    targetMonster.isFacedown = false;
    targetMonster.hasAttacked = false;
    targetMonster.cannotAttackThisTurn = true; // Cannot attack turn summoned
    targetMonster.attacksUsedThisTurn = 0;
    targetMonster.owner = player.id;
    targetMonster.controller = player.id;

    if (!player.field.includes(targetMonster)) {
      player.field.push(targetMonster);
    }

    // Emit after_summon event manually (moveCard would do this automatically)
    if (game && typeof game.emit === "function") {
      await game.emit("after_summon", {
        card: targetMonster,
        player: player,
        method: "special",
        fromZone: "graveyard",
      });
    }
  }

  // Vincular a trap ao monstro para que se destruam mutuamente
  targetMonster.callOfTheHauntedTrap = card;
  card.callOfTheHauntedTarget = targetMonster;

  game.ui.log(
    `Call of the Haunted: ${targetMonster.name} foi revivido do cemitério em ${
      position === "defense" ? "Defesa" : "Ataque"
    }!`
  );
  game.updateBoard();
  return true;
}
