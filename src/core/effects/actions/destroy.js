/**
 * Destroy Actions - destruction and negation handling
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Apply destroy action to target cards
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {Promise<boolean>} Whether any cards were destroyed
 */
export async function applyDestroy(action, ctx, targets) {
  const targetCards = targets?.[action.targetRef] || [];
  let destroyedAny = false;

  for (const card of targetCards) {
    if (!this.game?.destroyCard) continue;

    const result = await this.game.destroyCard(card, {
      cause: "effect",
      sourceCard: ctx?.source || null,
      opponent: ctx?.opponent || null,
    });

    if (result?.destroyed) {
      destroyedAny = true;
      if (typeof this.game.updateBoard === "function") {
        this.game.updateBoard();
      }
      if (typeof this.game.checkWinCondition === "function") {
        this.game.checkWinCondition();
      }
    }
  }

  return destroyedAny;
}

/**
 * Check if a card being destroyed has negation effects that can prevent it.
 * Allows cards to negate their own destruction by paying costs (e.g., ATK reduction).
 * @param {Object} card - Card being destroyed
 * @param {Object} ctx - Context with source, player, opponent info
 * @returns {Promise<Object>} - { negated: boolean, costPaid: boolean }
 */
export async function checkBeforeDestroyNegations(card, ctx) {
  if (!card || !card.effects) {
    return { negated: false };
  }

  const owner = card.owner === "player" ? this.game.player : this.game.bot;
  if (!owner) {
    return { negated: false };
  }

  for (const effect of card.effects) {
    if (!effect || effect.timing !== "on_event") continue;
    if (effect.event !== "before_destroy") continue;

    // Check once-per-turn for negation
    const optCheck = this.checkOncePerTurn(card, owner, effect);
    if (!optCheck.ok) {
      console.log(`Negation blocked by OPT: ${optCheck.reason}`);
      continue;
    }

    // For player-controlled cards, prompt for confirmation
    if (owner === this.game.player) {
      const shouldNegate = await this.promptForDestructionNegation(
        card,
        effect
      );
      if (!shouldNegate) {
        continue;
      }
    }

    // Apply negation actions (e.g., cost payment)
    const negationCtx = {
      source: card,
      player: owner,
      opponent:
        ctx?.opponent ||
        (owner === this.game.player ? this.game.bot : this.game.player),
      cause: ctx?.cause,
      destroySource: ctx?.source || null,
      fromZone: ctx?.fromZone || null,
    };

    const costSuccess = await this.applyActions(
      effect.negationCost || [],
      negationCtx,
      {}
    );

    if (costSuccess || effect.negationCost?.length === 0) {
      // Register OPT usage for negation
      this.registerOncePerTurnUsage(card, owner, effect);

      if (this.ui?.log) {
        this.ui.log(`${card.name} negated its destruction!`);
      }

      return { negated: true, costPaid: true };
    }
  }

  return { negated: false };
}

/**
 * Prompt the player to decide if they want to negate destruction with a cost.
 * @param {Object} card - Card offering negation
 * @param {Object} effect - Effect definition with negationCost
 * @returns {Promise<boolean>} - Whether player wants to activate negation
 */
export async function promptForDestructionNegation(card, effect) {
  if (!this.ui) {
    return false;
  }

  const costDescription = this.getDestructionNegationCostDescription(effect);
  const message = `${card.name} would be destroyed. Negate destruction? Cost: ${costDescription}`;

  return new Promise((resolve) => {
    if (this.ui.showDestructionNegationPrompt) {
      this.ui.showDestructionNegationPrompt(
        card.name,
        costDescription,
        resolve
      );
    } else if (this.ui.showConfirmPrompt) {
      const confirmResult = this.ui.showConfirmPrompt(message, {
        kind: "destruction_negation",
        cardName: card.name,
      });
      if (confirmResult && typeof confirmResult.then === "function") {
        confirmResult.then(resolve);
      } else {
        resolve(!!confirmResult);
      }
    } else {
      resolve(false);
    }
  });
}

/**
 * Generate a human-readable description of the cost to negate destruction.
 * @param {Object} effect - Effect with negationCost array
 * @returns {string} - Cost description
 */
export function getDestructionNegationCostDescription(effect) {
  if (!effect?.negationCost || !Array.isArray(effect.negationCost)) {
    return "Unknown cost";
  }

  const descriptions = [];
  for (const action of effect.negationCost) {
    if (action.type === "modify_stats_temp") {
      const baseAtk = action.baseAtk ?? 3500;
      const atkReduction = Math.floor(baseAtk * (1 - (action.atkFactor ?? 1)));
      descriptions.push(`reduzir ATK em ${atkReduction}`);
    } else if (action.type === "reduce_self_atk") {
      descriptions.push(`reduzir ATK em ${action.amount ?? 0}`);
    } else if (action.type === "pay_lp") {
      descriptions.push(`pagar ${action.amount} LP`);
    } else if (action.type === "damage") {
      descriptions.push(`sofrer ${action.amount} de dano`);
    } else if (action.type === "banish_card_from_graveyard") {
      const cardDesc = action.cardName || action.cardType || "carta";
      const count = action.count || 1;
      descriptions.push(`banir ${count} '${cardDesc}' do Cemitério`);
    } else {
      descriptions.push(action.type);
    }
  }

  return descriptions.join(" and ");
}

/**
 * Destroy all other monsters controlled by the player and draw 1 card per destroyed monster.
 * Used by Void Hydra Titan on-summon effect.
 * @param {Object} action - Action definition
 * @param {Object} ctx - Context with source, player, opponent
 * @returns {Promise<boolean>} - Whether any cards were destroyed
 */
export async function applyDestroyAllOthersAndDraw(action, ctx) {
  const player = ctx?.player;
  const sourceCard = ctx?.source;

  if (!player || !sourceCard) {
    return false;
  }

  // Collect all monsters on the field except the source card
  const othersToDestroy = (player.field || []).filter(
    (card) => card && card !== sourceCard && card.cardKind === "monster"
  );

  if (othersToDestroy.length === 0) {
    console.log("No other monsters to destroy.");
    return false;
  }

  // Count how many we're destroying
  let destroyedCount = 0;

  // Destroy all collected monsters
  for (const card of othersToDestroy) {
    if (!this.game?.destroyCard) continue;
    const result = await this.game.destroyCard(card, {
      cause: "effect",
      sourceCard,
      opponent: ctx?.opponent || null,
    });
    if (result?.destroyed) {
      destroyedCount += 1;
    }
  }

  // Draw 1 card for each monster destroyed
  let drawnCount = 0;
  if (this.game && typeof this.game.drawCards === "function") {
    const drawResult = this.game.drawCards(player, destroyedCount);
    drawnCount = drawResult?.drawn?.length || 0;
  } else {
    for (let i = 0; i < destroyedCount; i++) {
      player.draw();
      drawnCount += 1;
    }
  }

  if (destroyedCount > 0 && this.game?.updateBoard) {
    this.game.updateBoard();
  }

  if (destroyedCount > 0 && this.ui?.log) {
    this.ui.log(
      `${sourceCard.name} destroyed ${destroyedCount} monster(s) and drew ${drawnCount} card(s)!`
    );
  }

  return destroyedCount > 0;
}

/**
 * Destroy all other Dragons controlled by the player and buff ATK
 * @param {Object} action - Action definition
 * @param {Object} ctx - Context with source, player, opponent
 * @returns {Promise<boolean>} - Whether any cards were destroyed
 */
export async function applyDestroyOtherDragonsAndBuff(action, ctx) {
  const player = ctx?.player;
  const sourceCard = ctx?.source;

  if (!player || !sourceCard) {
    console.log("[applyDestroyOtherDragonsAndBuff] missing player/source", {
      player: !!player,
      source: !!sourceCard,
    });
    return false;
  }

  const typeName = action?.typeName;
  if (!typeName) {
    console.warn("[applyDestroyOtherDragonsAndBuff] typeName is required in action");
    return false;
  }
  const atkPerDestroyed = Number.isFinite(action?.atkPerDestroyed)
    ? action.atkPerDestroyed
    : 200;

  const hasType = (card) => {
    if (!card) return false;
    if (Array.isArray(card.types)) return card.types.includes(typeName);
    return card.type === typeName;
  };

  const othersToDestroy = (player.field || []).filter(
    (card) =>
      card &&
      card !== sourceCard &&
      card.cardKind === "monster" &&
      hasType(card)
  );

  console.log("[applyDestroyOtherDragonsAndBuff] start", {
    source: sourceCard.name,
    field: player.field.map((c) => c && c.name),
    othersToDestroy: othersToDestroy.map((c) => c && c.name),
    typeName,
  });

  let destroyedCount = 0;

  for (const card of othersToDestroy) {
    if (!this.game?.destroyCard) continue;
    const result = await this.game.destroyCard(card, {
      cause: "effect",
      sourceCard,
      opponent: ctx?.opponent || null,
    });
    if (result?.destroyed) {
      destroyedCount += 1;
    }
  }

  console.log(
    "[applyDestroyOtherDragonsAndBuff] destroyedCount",
    destroyedCount
  );

  if (destroyedCount > 0 && atkPerDestroyed !== 0) {
    const atkGain = destroyedCount * atkPerDestroyed;
    const buffKey =
      action?.buffSourceName || `${sourceCard.name}-self-destroy-buff`;
    if (!sourceCard.permanentBuffsBySource) {
      sourceCard.permanentBuffsBySource = {};
    }
    const currentBuff = sourceCard.permanentBuffsBySource[buffKey]?.atk || 0;
    const newBuff = currentBuff + atkGain;
    sourceCard.permanentBuffsBySource[buffKey] = {
      ...(sourceCard.permanentBuffsBySource[buffKey] || {}),
      atk: newBuff,
    };

    const delta = newBuff - currentBuff;
    sourceCard.atk = (sourceCard.atk || 0) + delta;

    console.log("[applyDestroyOtherDragonsAndBuff] applied buff", {
      atkGain,
      destroyedCount,
      newAtk: sourceCard.atk,
    });
  }

  if (destroyedCount > 0 && this.game?.updateBoard) {
    this.game.updateBoard();
  }

  if (this.ui?.log) {
    const gainText =
      destroyedCount > 0
        ? ` and gained ${destroyedCount * atkPerDestroyed} ATK`
        : "";
    this.ui.log(
      `${sourceCard.name} destroyed ${destroyedCount} Dragon(s) you control${gainText}.`
    );
  }

  return destroyedCount > 0;
}

/**
 * Apply Mirror Force destroy effect - destroy all attack position monsters
 * @param {Object} action - Action definition
 * @param {Object} ctx - Context with game, player, eventData
 * @returns {Promise<boolean>} - Whether any cards were destroyed
 */
export async function applyMirrorForceDestroy(action, ctx) {
  const { game, player, eventData } = ctx;

  // Determinar quem é o oponente
  const opponent = player.id === "player" ? game.bot : game.player;

  if (!opponent || !opponent.field) {
    return false;
  }

  // Encontrar todos os monstros em Attack Position do oponente
  const attackPositionMonsters = opponent.field.filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      card.position === "attack" &&
      !card.isFacedown
  );

  if (attackPositionMonsters.length === 0) {
    game.ui.log(
      `Mirror Force: Nenhum monstro em Attack Position para destruir.`
    );
    return false;
  }

  game.ui.log(
    `Mirror Force: Destruindo ${attackPositionMonsters.length} monstro(s) em Attack Position!`
  );

  // Destruir todos os monstros em Attack Position (com substituição de destruição)
  const sourceCard = ctx.source || ctx.card || null;
  for (const monster of attackPositionMonsters) {
    await game.destroyCard(monster, {
      cause: "effect",
      sourceCard,
      opponent: player,
    });
  }

  // Negar o ataque que disparou a Mirror Force
  if (ctx.eventData?.attacker) {
    game.registerAttackNegated(ctx.eventData.attacker);
  } else {
    game.lastAttackNegated = true;
  }

  game.updateBoard();
  return true;
}
