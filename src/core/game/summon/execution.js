/**
 * Summon execution - flip summon, fusion summon, special summon.
 * Extracted from Game.js as part of B.6 modularization.
 */

/**
 * Perform a Flip Summon on a face-down monster.
 * @param {Object} card - The face-down monster to flip summon
 */
export async function flipSummon(card) {
  if (!this.canFlipSummon(card)) return;
  card.isFacedown = false;
  card.revealedTurn = this.turnCounter; // Track when monster was revealed for Ascension timing
  card.position = "attack";
  card.positionChangedThisTurn = true;
  card.hasAttacked = false;
  card.attacksUsedThisTurn = 0;
  this.effectEngine?.clearTargetingCache?.();
  this.ui.log(`${card.name} is Flip Summoned!`);

  await this.emit("after_summon", {
    card,
    player: card.owner === "player" ? this.player : this.bot,
    method: "flip",
  });

  this.updateBoard();
}

export async function offerSummonAttempt(card, player, options = {}) {
  if (!card || !player || !this.chainSystem || this.disableChains) {
    return { ok: true };
  }
  if (this.chainSystem.isChainResolving?.() || this.chainSystem.isChainWindowOpen?.()) {
    return { ok: true };
  }

  const attempt = {
    card,
    player,
    method: options.method || "special",
    fromZone: options.fromZone || null,
    summonProcedure: options.summonProcedure || null,
    negated: false,
  };
  const context = {
    type: "summon_attempt",
    event: "summon_attempt",
    card,
    player,
    triggerPlayer: player,
    summonMethod: attempt.method,
    fromZone: attempt.fromZone,
    summonAttempt: attempt,
  };

  const opponent = this.getOpponent?.(player) || null;
  const playerResponses =
    this.chainSystem.getActivatableCardsInChain?.(player, context) || [];
  const opponentResponses = opponent
    ? this.chainSystem.getActivatableCardsInChain?.(opponent, context) || []
    : [];

  if (playerResponses.length === 0 && opponentResponses.length === 0) {
    return { ok: true };
  }

  await this.chainSystem.openChainWindow(context);
  if (attempt.negated || context.negated) {
    return { ok: false, negated: true, reason: "summon_negated" };
  }
  return { ok: true };
}

export async function performNormalSummon(
  actor,
  cardIndex,
  position = "attack",
  isFacedown = false,
  tributeIndices = null,
) {
  const player = actor || this.player;
  const card = player?.hand?.[cardIndex];
  if (!player || !card) return null;

  const tributeInfo =
    typeof player.getTributeRequirement === "function"
      ? player.getTributeRequirement(card)
      : { tributesNeeded: 0 };
  const method = tributeInfo?.tributesNeeded > 0 ? "tribute" : "normal";
  const attempt = await this.offerSummonAttempt(card, player, {
    method,
    fromZone: "hand",
  });
  if (attempt?.negated) {
    return null;
  }
  return player.summon(cardIndex, position, isFacedown, tributeIndices);
}

/**
 * Perform a Fusion Summon using materials from hand/field.
 * @param {Array} materials - Array of material cards
 * @param {number} fusionMonsterIndex - Index in Extra Deck
 * @param {string} position - "attack" or "defense"
 * @param {Array|null} requiredSubset - Subset of required materials
 * @param {Object|null} player - Player performing the summon
 * @returns {boolean} Success status
 */
export async function performFusionSummon(
  materials,
  fusionMonsterIndex,
  position = "attack",
  requiredSubset = null,
  player = null
) {
  // Usa o jogador passado ou default para this.player
  const activePlayer = player || this.player;

  // Validate inputs
  if (!materials || materials.length === 0) {
    this.ui.log("No materials selected for Fusion Summon.");
    return false;
  }

  const fusionMonster = activePlayer.extraDeck[fusionMonsterIndex];
  if (!fusionMonster) {
    this.ui.log("Fusion Monster not found in Extra Deck.");
    return false;
  }

  if (fusionMonster.extraDeckSummonProcedure) {
    this.ui.log(`${fusionMonster.name} cannot be Fusion Summoned by this effect.`);
    return false;
  }

  // Check field space after using any field materials
  const fieldMaterialCount = materials.filter((mat) =>
    activePlayer.field.includes(mat)
  ).length;
  const projectedFieldSize =
    activePlayer.field.length - fieldMaterialCount + 1;
  if (projectedFieldSize > 5) {
    this.ui.log("Field is full after using materials.");
    return false;
  }

  const limitCheck = this.canPlaceCardOnField?.(fusionMonster, activePlayer, {
    isFacedown: false,
    excludeCards: materials,
  });
  if (limitCheck && limitCheck.ok === false) {
    return false;
  }

  const requiredMaterials =
    requiredSubset && requiredSubset.length ? requiredSubset : materials;
  const requiredSet = new Set(requiredMaterials);
  const extraMaterials = materials.filter((mat) => !requiredSet.has(mat));
  const hasFieldToGraveTrigger = (card) =>
    activePlayer.field.includes(card) &&
    Array.isArray(card?.effects) &&
    card.effects.some(
      (effect) =>
        effect &&
        effect.timing === "on_event" &&
        effect.event === "card_to_grave" &&
        (!effect.fromZone ||
          effect.fromZone === "any" ||
          effect.fromZone === "field"),
    );
  const materialSendOrder = [...materials].sort(
    (a, b) =>
      Number(hasFieldToGraveTrigger(a)) - Number(hasFieldToGraveTrigger(b)),
  );

  // Send materials to GY in a deterministic order. Fusion materials can have
  // "sent from field to GY" triggers, so callers that await this summon need
  // those card_to_grave events to resolve before the summon continues.
  for (const material of materialSendOrder) {
    const fromZone =
      activePlayer.field.includes(material)
        ? "field"
        : activePlayer.hand.includes(material)
          ? "hand"
          : typeof this.findCardZone === "function"
            ? this.findCardZone(activePlayer, material)
            : null;
    const moveResult = await this.moveCard(material, activePlayer, "graveyard", {
      fromZone: fromZone || undefined,
      awaitCardToGraveEvent: true,
      contextLabel: "fusion_material",
    });
    if (moveResult?.success === false) {
      this.ui.log(`Could not send ${material.name} as Fusion Material.`);
      return false;
    }
  }

  const postMaterialLimitCheck = this.canPlaceCardOnField?.(
    fusionMonster,
    activePlayer,
    { isFacedown: false },
  );
  if (postMaterialLimitCheck && postMaterialLimitCheck.ok === false) {
    return false;
  }

  const attempt = await this.offerSummonAttempt(fusionMonster, activePlayer, {
    method: "fusion",
    fromZone: "extraDeck",
  });
  if (attempt?.negated) {
    if (activePlayer.extraDeck.includes(fusionMonster)) {
      activePlayer.extraDeck.splice(activePlayer.extraDeck.indexOf(fusionMonster), 1);
      activePlayer.graveyard.push(fusionMonster);
      fusionMonster.owner = activePlayer.id;
      fusionMonster.controller = activePlayer.id;
    }
    this.updateBoard();
    return false;
  }

  // Remove fusion monster from Extra Deck
  activePlayer.extraDeck.splice(fusionMonsterIndex, 1);

  // Add to field
  fusionMonster.position = position;
  fusionMonster.isFacedown = false;
  fusionMonster.hasAttacked = false;
  fusionMonster.cannotAttackThisTurn = false;
  fusionMonster.owner = activePlayer.id;
  fusionMonster.summonedTurn = this.turnCounter;
  activePlayer.field.push(fusionMonster);

  const requiredNames = requiredMaterials.map((c) => c.name).join(", ");
  const extraNames = extraMaterials.map((c) => c.name).join(", ");
  const extraNote =
    extraMaterials.length > 0
      ? ` Extra materials also sent to GY: ${extraNames}.`
      : "";

  this.ui.log(
    `Fusion Summoned ${fusionMonster.name} using ${
      requiredNames || "selected materials"
    }.${extraNote}`
  );

  // Emit after_summon event
  await this.emit("after_summon", {
    card: fusionMonster,
    player: activePlayer,
    method: "fusion",
    fromZone: "extraDeck",
  });

  this.updateBoard();
  return true;
}

/**
 * Perform a Special Summon from hand (e.g., from Eel effect).
 * @param {number} handIndex - Index in player's hand
 * @param {string} position - "attack" or "defense"
 */
export async function performSpecialSummon(handIndex, position, actor = this.player) {
  const player = actor || this.player;
  const opponent = this.getOpponent?.(player) || this.bot;
  const card = player.hand[handIndex];
  if (!card) return;

  if (Array.isArray(card.specialSummonOnlyBy)) {
    this.ui?.log?.(`${card.name} cannot be Special Summoned this way.`);
    return;
  }

  const attempt = await this.offerSummonAttempt(card, player, {
    method: "special",
    fromZone: "hand",
  });
  if (attempt?.negated) {
    return;
  }

  const limitCheck = this.canPlaceCardOnField?.(card, player, {
    isFacedown: false,
  });
  if (limitCheck && limitCheck.ok === false) {
    return;
  }

  // Remove from hand
  player.hand.splice(handIndex, 1);

  // Add to field
  card.position = position;
  card.isFacedown = false;
  card.hasAttacked = false;
  card.cannotAttackThisTurn = true; // Cannot attack this turn (from Eel effect)
  card.owner = player.id;
  player.field.push(card);

  this.ui.log(`Special Summoned ${card.name} from hand.`);

  // Clear pending special summon and unlock actions
  this.pendingSpecialSummon = null;
  this.isResolvingEffect = false;

  // Remove highlight from all hand cards
  if (this.ui && typeof this.ui.applyHandTargetableIndices === "function") {
    this.ui.applyHandTargetableIndices("player", []);
  }

  // Emit after_summon for special summons performed directly from hand
  await this.emit("after_summon", {
    card,
    player,
    opponent,
    method: "special",
    fromZone: "hand",
  });

  this.updateBoard();
}
