/**
 * Combat resolution - attack resolution and battle outcome processing.
 * Extracted from Game.js as part of B.5 modularization.
 */

/**
 * Resolve a combat attack, handling flip effects and delegating to finishCombat.
 * @param {Object} attacker - The attacking monster
 * @param {Object|null} target - The target monster (null for direct attack)
 * @param {Object} options - Resolution options
 * @returns {Object} Result with ok status and any pending selections
 */
export async function resolveCombat(attacker, target, options = {}) {
  if (!attacker) return;
  const attackerOwner = attacker.owner === "player" ? this.player : this.bot;
  const guard = this.guardActionStart(
    {
      actor: attackerOwner,
      kind: "attack",
      phaseReq: "battle",
      allowDuringSelection: options.allowDuringSelection === true,
      allowDuringResolving: options.allowDuringResolving === true,
    },
    attackerOwner === this.player
  );
  if (!guard.ok) return guard;

  const availability = this.getAttackAvailability(attacker);
  if (!availability.ok) return;

  this.applyAttackResolutionIndicators(attacker, target);

  const attacksUsed =
    availability.attacksUsed ?? attacker.attacksUsedThisTurn ?? 0;
  const baseMaxAttacks = 1 + (attacker.extraAttacks || 0);
  const maxAttacks = availability.maxAttacks ?? baseMaxAttacks;
  const usingSecondAttack =
    attacker.canMakeSecondAttackThisTurn &&
    !attacker.secondAttackUsedThisTurn &&
    attacksUsed >= maxAttacks;

  if (usingSecondAttack) {
    attacker.secondAttackUsedThisTurn = true;
  }

  this.lastAttackNegated = false;

  this.ui.log(`${attacker.name} attacks ${target ? target.name : "directly"}!`);

  const defenderOwner = target
    ? target.owner === "player"
      ? this.player
      : this.bot
    : attacker.owner === "player"
    ? this.bot
    : this.player;
  const targetOwner = defenderOwner;

  await this.emit("attack_declared", {
    attacker,
    target: target || null,
    defender: target || null,
    attackerOwner,
    defenderOwner,
    targetOwner,
  });

  if (this.lastAttackNegated) {
    attacker.attacksUsedThisTurn = (attacker.attacksUsedThisTurn || 0) + 1;
    // Check if all attacks are exhausted, considering extraAttacks
    const extraAttacks = attacker.extraAttacks || 0;
    const maxAttacks = 1 + extraAttacks;
    // For multi-attack mode, don't block further attacks when one is negated
    if (!attacker.canAttackAllOpponentMonstersThisTurn) {
      attacker.hasAttacked = attacker.attacksUsedThisTurn >= maxAttacks;
    }
    this.clearAttackResolutionIndicators();
    this.updateBoard();
    this.checkWinCondition();
    return { ok: true };
  }

  if (!target) {
    if (attacker.cannotAttackDirectly) {
      this.ui?.log?.(`${attacker.name} cannot attack directly.`);
      this.clearAttackResolutionIndicators();
      this.updateBoard();
      return { ok: false, reason: "cannot_attack_directly" };
    }
    if (attackerOwner?.forbidDirectAttacksThisTurn) {
      this.ui?.log?.(`You cannot attack directly this turn.`);
      this.clearAttackResolutionIndicators();
      this.updateBoard();
      return { ok: false, reason: "direct_attack_forbidden" };
    }
    const defender = attacker.owner === "player" ? this.bot : this.player;
    this.inflictDamage(defender, attacker.atk, {
      sourceCard: attacker,
      cause: "battle",
    });
    this.markAttackUsed(attacker, null); // Direct attack, no target
    this.checkWinCondition();
    this.clearAttackResolutionIndicators();
    this.updateBoard();
    return { ok: true };
  }

  // Check if flip is needed (might have been flipped by attack_declared effects)
  const needsFlip = target.isFacedown;

  if (needsFlip) {
    const targetOwner = target.owner === "player" ? "player" : "bot";
    const targetField =
      target.owner === "player" ? this.player.field : this.bot.field;
    const targetIndex = targetField.indexOf(target);

    if (this.ui && typeof this.ui.applyFlipAnimation === "function") {
      this.ui.applyFlipAnimation(targetOwner, targetIndex);
    }

    target.isFacedown = false;
    target.revealedTurn = this.turnCounter; // Track when monster was revealed for Ascension timing
    this.ui.log(`${target.name} was flipped!`);

    this.updateBoard();
    this.applyAttackResolutionIndicators(attacker, target);

    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  const combatResult = await this.finishCombat(attacker, target);
  
  // Emit combat resolution event for replay capture
  await this.emit("combat_resolved", {
    attacker,
    target,
    attackerOwner,
    defenderOwner,
    damageDealt: combatResult?.damageDealt || 0,
    targetDestroyed: combatResult?.targetDestroyed || false,
    attackerDestroyed: combatResult?.attackerDestroyed || false,
  });
  
  // Propagate needsSelection from battle_destroy effects
  if (combatResult?.needsSelection && combatResult?.selectionContract) {
    return combatResult;
  }
  return { ok: true };
}

/**
 * Finish combat resolution - calculate damage, destroy monsters, apply effects.
 * @param {Object} attacker - The attacking monster
 * @param {Object} target - The target monster
 * @param {Object} options - Additional options (resumeFromTie, etc.)
 * @returns {Object} Result with ok status and any pending selections
 */
export async function finishCombat(attacker, target, options = {}) {
  // Capture healing flags at the start of combat resolution to avoid race conditions
  const attackerHealsOnBattleDamage =
    attacker?.battleDamageHealsControllerThisTurn || false;
  const defenderHealsOnBattleDamage =
    target?.battleDamageHealsControllerThisTurn || false;

  // Check if we're resuming from a pending tie destruction
  const resumeFromTie = options.resumeFromTie === true;
  const skipAttackerDestruction = resumeFromTie;
  const battleDestroyResults = [];
  
  // Track combat results for replay
  let totalDamageDealt = 0;
  let targetWasDestroyed = false;
  let attackerWasDestroyed = false;

  const applyBattleDamage = (
    player,
    cardInvolved,
    amount,
    shouldHeal = false
  ) => {
    if (!player || amount <= 0) return;
    if (shouldHeal && player.id === cardInvolved?.owner) {
      player.gainLP(amount);
    } else {
      this.inflictDamage(player, amount, {
        sourceCard: cardInvolved,
        cause: "battle",
      });
    }
  };

  const logBattleResult = (message) => {
    if (message) {
      this.ui.log(message);
    }
  };

  const logBattleDestroyCheck = (context) => {
    if (!this.devModeEnabled) return;
    const formatCard = (card, label) => {
      if (!card) return `${label}: (none)`;
      const flags = `bi=${!!card.battleIndestructible}, tempBi=${!!card.tempBattleIndestructible}, once=${!!card.battleIndestructibleOncePerTurn}, onceUsed=${!!card.battleIndestructibleOncePerTurnUsed}`;
      return `${label}: ${card.name} ATK:${card.atk} DEF:${card.def} ${flags}`;
    };
    this.devLog("BATTLE_DESTROY_CHECK", {
      summary: `canDestroyByBattle check (${context})`,
      context,
      attacker: attacker?.name,
      target: target?.name,
    });
  };

  if (target.position === "attack") {
    if (attacker.atk > target.atk) {
      const defender = target.owner === "player" ? this.player : this.bot;
      const damage = attacker.atk - target.atk;
      totalDamageDealt = damage;
      applyBattleDamage(defender, target, damage, defenderHealsOnBattleDamage);
      logBattleResult(
        `${attacker.name} destroyed ${target.name} and dealt ${damage} damage.`
      );

      logBattleDestroyCheck("attacker over atk target");
      if (this.canDestroyByBattle(target)) {
        const result = await this.destroyCard(target, {
          cause: "battle",
          sourceCard: attacker,
        });
        if (result?.destroyed) {
          targetWasDestroyed = true;
          const bdResult = await this.applyBattleDestroyEffect(
            attacker,
            target
          );
          if (bdResult) battleDestroyResults.push(bdResult);
        }
        if (result?.needsSelection) {
          this.markAttackUsed(attacker, target);
          this.clearAttackResolutionIndicators();
          this.updateBoard();
          return {
            ok: true,
            needsSelection: true,
            selectionContract: result.selectionContract,
            damageDealt: totalDamageDealt,
            targetDestroyed: targetWasDestroyed,
            attackerDestroyed: attackerWasDestroyed,
          };
        }
      }
    } else if (attacker.atk < target.atk) {
      const attPlayer = attacker.owner === "player" ? this.player : this.bot;
      const damage = target.atk - attacker.atk;
      totalDamageDealt = damage;
      applyBattleDamage(
        attPlayer,
        attacker,
        damage,
        attackerHealsOnBattleDamage
      );
      logBattleResult(
        `${attacker.name} was destroyed by ${target.name} and took ${damage} damage.`
      );

      logBattleDestroyCheck("attacker loses to atk target");
      if (this.canDestroyByBattle(attacker)) {
        const result = await this.destroyCard(attacker, {
          cause: "battle",
          sourceCard: target,
        });
        if (result?.destroyed) {
          attackerWasDestroyed = true;
          const bdResult = await this.applyBattleDestroyEffect(
            target,
            attacker
          );
          if (bdResult) battleDestroyResults.push(bdResult);
        }
        if (result?.needsSelection) {
          this.markAttackUsed(attacker, target);
          this.clearAttackResolutionIndicators();
          this.updateBoard();
          return {
            ok: true,
            needsSelection: true,
            selectionContract: result.selectionContract,
            damageDealt: totalDamageDealt,
            targetDestroyed: targetWasDestroyed,
            attackerDestroyed: attackerWasDestroyed,
          };
        }
      }
    } else {
      // to allow each triggered effect to be resolved before the next
      logBattleDestroyCheck("tie - attacker destruction check");
      if (!skipAttackerDestruction && this.canDestroyByBattle(attacker)) {
        const result = await this.destroyCard(attacker, {
          cause: "battle",
          sourceCard: target,
        });
        if (result?.destroyed) {
          const bdResult = await this.applyBattleDestroyEffect(
            target,
            attacker
          );
          if (bdResult) battleDestroyResults.push(bdResult);
        }
        // we need to pause and let that resolve before destroying target
        if (result?.needsSelection) {
          // Store pending tie info so we can resume after selection
          this.pendingTieDestruction = {
            attacker,
            target,
            attackerHealsOnBattleDamage,
            defenderHealsOnBattleDamage,
          };
          this.markAttackUsed(attacker, target);
          this.clearAttackResolutionIndicators();
          this.updateBoard();
          return {
            ok: true,
            needsSelection: true,
            selectionContract: result.selectionContract,
            pendingTieDestruction: true,
          };
        }
      }

      logBattleDestroyCheck("tie - target destruction check");
      if (this.canDestroyByBattle(target)) {
        const result = await this.destroyCard(target, {
          cause: "battle",
          sourceCard: attacker,
        });
        if (result?.destroyed) {
          const bdResult = await this.applyBattleDestroyEffect(
            attacker,
            target
          );
          if (bdResult) battleDestroyResults.push(bdResult);
        }
        // If target destruction also needs selection, return it
        if (result?.needsSelection) {
          this.markAttackUsed(attacker, target);
          this.clearAttackResolutionIndicators();
          this.updateBoard();
          return {
            ok: true,
            needsSelection: true,
            selectionContract: result.selectionContract,
          };
        }
      }
      // Clear pending tie destruction if we completed successfully
      this.pendingTieDestruction = null;
      logBattleResult(
        `${attacker.name} and ${target.name} destroyed each other.`
      );
    }
  } else {
    const defender = target.owner === "player" ? this.player : this.bot;
    if (attacker.atk > target.def) {
      if (attacker.piercing) {
        const damage = attacker.atk - target.def;
        applyBattleDamage(
          defender,
          target,
          damage,
          defenderHealsOnBattleDamage
        );
        logBattleResult(
          `${attacker.name} pierced ${target.name} for ${damage} damage.`
        );
      }
      logBattleDestroyCheck("defense target destruction check");
      if (this.canDestroyByBattle(target)) {
        const result = await this.destroyCard(target, {
          cause: "battle",
          sourceCard: attacker,
        });
        if (result?.destroyed) {
          const bdResult = await this.applyBattleDestroyEffect(
            attacker,
            target
          );
          if (bdResult) battleDestroyResults.push(bdResult);
        }
        if (result?.needsSelection) {
          this.markAttackUsed(attacker, target);
          this.clearAttackResolutionIndicators();
          this.updateBoard();
          return {
            ok: true,
            needsSelection: true,
            selectionContract: result.selectionContract,
          };
        }
      }
      if (!attacker.piercing) {
        logBattleResult(`${attacker.name} destroyed ${target.name}.`);
      }
    } else if (attacker.atk < target.def) {
      const attPlayer = attacker.owner === "player" ? this.player : this.bot;
      const damage = target.def - attacker.atk;
      applyBattleDamage(
        attPlayer,
        attacker,
        damage,
        attackerHealsOnBattleDamage
      );
      logBattleResult(
        `${attacker.name} took ${damage} damage attacking ${target.name}.`
      );
    } else {
      logBattleResult(
        `${attacker.name} could not break ${target.name}'s defense.`
      );
    }
  }

  this.markAttackUsed(attacker, target);
  this.checkWinCondition();
  this.clearAttackResolutionIndicators();
  this.updateBoard();
  const pendingResult = battleDestroyResults.find(
    (r) => r?.needsSelection && r?.selectionContract
  );
  if (pendingResult) {
    return {
      ...pendingResult,
      damageDealt: totalDamageDealt,
      targetDestroyed: targetWasDestroyed,
      attackerDestroyed: attackerWasDestroyed,
    };
  }

  return {
    ok: true,
    damageDealt: totalDamageDealt,
    targetDestroyed: targetWasDestroyed,
    attackerDestroyed: attackerWasDestroyed,
  };
}

/**
 * Apply effects that trigger when a monster is destroyed by battle.
 * @param {Object} attacker - The attacking monster
 * @param {Object} destroyed - The destroyed monster
 * @returns {Object} Result with ok status and any pending selections
 */
export async function applyBattleDestroyEffect(attacker, destroyed) {
  // Legacy: onBattleDestroy direct damage effects tied to the attacker
  if (attacker && attacker.onBattleDestroy && attacker.onBattleDestroy.damage) {
    const defender = attacker.owner === "player" ? this.bot : this.player;
    this.inflictDamage(defender, attacker.onBattleDestroy.damage, {
      sourceCard: attacker,
      cause: "effect",
    });
    this.ui.log(
      `${attacker.name} inflicts an extra ${attacker.onBattleDestroy.damage} damage!`
    );
    this.checkWinCondition();
    this.updateBoard();
  }

  // New: global battle_destroy event for cards like Shadow-Heart Gecko
  if (!destroyed) {
    return { ok: true };
  }

  const destroyedOwner = destroyed.owner === "player" ? this.player : this.bot;
  const attackerOwner = attacker.owner === "player" ? this.player : this.bot;

  const emitResult = await this.emit("battle_destroy", {
    player: attackerOwner, // o dono do atacante (quem causou a destruição)
    opponent: destroyedOwner, // o jogador que perdeu o monstro
    attacker,
    destroyed,
    attackerOwner,
    destroyedOwner,
  });

  return emitResult || { ok: true };
}
