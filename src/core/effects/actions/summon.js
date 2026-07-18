/**
 * Summon Actions - special summon tokens and revival
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

import Card, {
  captureTrapMonsterOriginalState,
  restoreTrapMonsterOriginalState,
} from "../../Card.js";

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
      attribute: action.token.attribute || null,
      archetype: action.token.archetype || null,
      archetypes: Array.isArray(action.token.archetypes)
        ? [...action.token.archetypes]
        : undefined,
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

  const restrictionCheck = this.game?.canSpecialSummonUnderRestrictions?.(
    tokenCard,
    targetPlayer,
    {
      summonMethod: "special",
      fromZone: "token",
      silent: false,
    },
  );
  this.game?.ensureDuelCardId?.(tokenCard);
  if (restrictionCheck?.ok === false) {
    return false;
  }

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
        fromZone: "token",
        position,
        isFacedown: false,
        resetAttackFlags: true,
        summonOrigin: "effect_resolution",
        summonMethodOverride: "special",
        summonProcedure: "token_effect",
      }
    );
    if (
      moveResult?.success === false &&
      moveResult?.reason !== "card_not_found"
    ) {
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
      this.game.updateBoard?.();
      await this.game.waitForBoardPresentation?.();
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

function normalizeTrapMonsterKinds(card, action) {
  const kinds = new Set(["monster"]);
  const originalKind = card?.originalCardKind || card?.cardKind || "trap";
  if (originalKind) kinds.add(originalKind);
  const configuredKinds = Array.isArray(action?.treatedAsCardKinds)
    ? action.treatedAsCardKinds
    : action?.treatedAsCardKinds
      ? [action.treatedAsCardKinds]
      : [];
  for (const kind of configuredKinds) {
    if (kind) kinds.add(kind);
  }
  return Array.from(kinds);
}

function resolveTrapMonsterStat(monster, action, key, fallback) {
  const value = monster?.[key] ?? action?.[key] ?? fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * Special Summons the source Spell/Trap as a monster while retaining trap treatment.
 * Generic support for Trap Monsters such as Ancient Tree Spirit.
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @returns {Promise<boolean>} Whether the source was summoned
 */
export async function applySpecialSummonSelfAsTrapMonster(action, ctx) {
  const game = this.game;
  const player = ctx?.player;
  const source = ctx?.source || ctx?.card;
  if (!game || !player || !source) return false;

  const sourceZone =
    typeof this.findCardZone === "function"
      ? this.findCardZone(player, source)
      : ctx?.activationZone || ctx?.sourceZone || null;

  if (sourceZone !== "spellTrap") {
    game.ui?.log?.(`${source.name} must be in the Spell/Trap zone.`);
    return false;
  }
  if (source.cardKind !== "trap" && source.cardKind !== "spell") {
    game.ui?.log?.(`${source.name} is not a Spell/Trap card.`);
    return false;
  }
  if ((player.field || []).length >= 5) {
    game.ui?.log?.("Field is full. Cannot summon.");
    return false;
  }

  const monster = action.monster || {};
  const original = captureTrapMonsterOriginalState(source);
  const summonProcedure = action.summonProcedure || "trap_monster";
  let position = action.position || monster.position || "defense";
  if (position !== "attack" && position !== "defense") {
    position = await this.chooseSpecialSummonPosition(source, player, {
      position,
    });
  }

  source.originalCardKind = original.cardKind || source.cardKind;
  source.isTrapMonster = true;
  source.trapMonsterSummonProcedure = summonProcedure;
  source.treatedAsCardKinds = normalizeTrapMonsterKinds(source, action);
  source.cardKind = "monster";
  source.monsterType = monster.monsterType || action.monsterType || null;
  source.type = monster.type || action.monsterTypeName || action.typeName || source.type;
  source.attribute = monster.attribute || action.attribute || source.attribute || null;
  source.level = resolveTrapMonsterStat(monster, action, "level", 0);
  source.baseAtk = resolveTrapMonsterStat(monster, action, "atk", 0);
  source.baseDef = resolveTrapMonsterStat(monster, action, "def", 0);
  source.atk = source.baseAtk;
  source.def = source.baseDef;
  source.position = position;
  source.isFacedown = false;
  source.hasAttacked = false;
  source.attacksUsedThisTurn = 0;

  const moveResult = await game.moveCard(source, player, "field", {
    fromZone: sourceZone,
    position,
    isFacedown: false,
    resetAttackFlags: true,
    summonMethodOverride: "special",
    summonProcedure,
    summonOrigin: "effect_resolution",
    sourceCard: source,
    effectId: ctx?.effectId || ctx?.effect?.id || null,
  });

  if (moveResult?.success === false) {
    restoreTrapMonsterOriginalState(source);
    return false;
  }

  source.cannotAttackThisTurn = action.cannotAttackThisTurn || false;
  game.ui?.log?.(`${source.name} was Special Summoned as a Trap Monster.`);
  game.updateBoard?.();
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

  game?.devLog?.("CALL_OF_THE_HAUNTED", {
    summary: "Resolving summon target",
  });

  if (card?.boundMonsterTarget) {
    game.ui.log("Call of the Haunted: This card is already bound to a monster.");
    return false;
  }

  if (!targets || !targets.haunted_target) {
    game.ui.log(`Call of the Haunted: Nenhum alvo selecionado no cemitério.`);
    return false;
  }

  // targets.haunted_target pode ser um array de cartas selecionadas
  const targetArray = Array.isArray(targets.haunted_target)
    ? targets.haunted_target
    : [targets.haunted_target];

  const targetMonster = targetArray[0];
  game?.devLog?.("CALL_OF_THE_HAUNTED", {
    summary: `Target monster: ${targetMonster?.name || "(none)"}`,
  });

  if (!targetMonster || targetMonster.cardKind !== "monster") {
    game.ui.log(`Call of the Haunted: Alvo inválido.`);
    return false;
  }

  if (targetMonster.cannotBeSpecialSummoned) {
    game.ui.log(`${targetMonster.name} cannot be Special Summoned.`);
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
      summonOrigin: "effect_resolution",
      summonMethodOverride: "special",
      summonProcedure: "card_effect",
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
      game?.devLog?.("CALL_OF_THE_HAUNTED", {
        summary: "Monster not found in graveyard during fallback",
      });
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
      game.updateBoard?.();
      await game.waitForBoardPresentation?.();
      await game.emit("after_summon", {
        card: targetMonster,
        player: player,
        method: "special",
        fromZone: "graveyard",
      });
    }
  }

  // Vincular a trap ao monstro para que se destruam mutuamente
  targetMonster.boundTrapSource = card;
  card.boundMonsterTarget = targetMonster;

  game.ui.log(
    `Call of the Haunted: ${targetMonster.name} foi revivido do cemitério em ${
      position === "defense" ? "Defesa" : "Ataque"
    }!`
  );
  game.updateBoard();
  return true;
}
