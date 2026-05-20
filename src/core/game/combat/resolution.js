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
    attackerOwner === this.player,
  );
  if (!guard.ok) return guard;

  const availability = this.getAttackAvailability(attacker);
  if (!availability.ok) return;

  this.applyAttackResolutionIndicators(attacker, target);

  const attacksUsed =
    availability.attacksUsed ?? attacker.attacksUsedThisTurn ?? 0;
  let _extraAttacks = attacker.extraAttacks || 0;
  if (attacker.dynamicExtraAttacks?.source === "graveyard_count") {
    const dea = attacker.dynamicExtraAttacks;
    const owner = attacker.owner === "player" ? this.player : this.bot;
    const dynamicAttackLimit = (owner?.graveyard || []).filter(
      (c) => c && c.name === dea.name,
    ).length;
    _extraAttacks = dynamicAttackLimit - 1;
  }
  const baseMaxAttacks = 1 + _extraAttacks;
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

  if (attacker.instanceId != null && typeof this.ui?.playAttackLunge === "function") {
    this.ui.playAttackLunge({
      kind: "attack-lunge",
      card: attacker,
      cardKey: String(attacker.instanceId),
      targetCardKey: target?.instanceId != null ? String(target.instanceId) : null,
      targetOwnerId: defenderOwner?.id || null,
    });
  }

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
    let extraAttacks = attacker.extraAttacks || 0;
    if (attacker.dynamicExtraAttacks?.source === "graveyard_count") {
      const dea = attacker.dynamicExtraAttacks;
      const owner = attacker.owner === "player" ? this.player : this.bot;
      const dynamicAttackLimit = (owner?.graveyard || []).filter(
        (c) => c && c.name === dea.name,
      ).length;
      extraAttacks = dynamicAttackLimit - 1;
    }
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

  const attackerStillOnField =
    attackerOwner && Array.isArray(attackerOwner.field)
      ? attackerOwner.field.includes(attacker)
      : false;
  if (!attackerStillOnField) {
    this.ui.log("Attack stopped because the attacker left the field.");
    this.clearAttackResolutionIndicators();
    this.updateBoard();
    return { ok: true };
  }

  if (attacker.position !== "attack" || attacker.isFacedown) {
    this.ui.log(
      "Attack stopped because the attacker is no longer in Attack Position.",
    );
    this.markAttackUsed(attacker, target);
    this.clearAttackResolutionIndicators();
    this.updateBoard();
    return { ok: true };
  }

  if (target) {
    const targetOwnerField =
      target.owner === "player" ? this.player.field : this.bot.field;
    if (!targetOwnerField.includes(target)) {
      this.ui.log("Attack stopped because the target left the field.");
      this.markAttackUsed(attacker, target);
      this.clearAttackResolutionIndicators();
      this.updateBoard();
      return { ok: true };
    }
  }

  if (!target) {
    if (
      (attacker.attacksUsedThisTurn || 0) > 0 &&
      attacker.extraAttackTargetRestriction === "monster"
    ) {
      this.ui?.log?.(`${attacker.name}'s extra attack can only target monsters.`);
      this.clearAttackResolutionIndicators();
      this.updateBoard();
      return { ok: false, reason: "extra_attack_requires_monster_target" };
    }
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
    this.queueVisualFeedback?.({
      kind: "impact",
      sourceCard: attacker,
      targetOwnerId: defender.id,
      tone: "red",
    });
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
    this.effectEngine?.clearTargetingCache?.();
    this.ui.log(`${target.name} was flipped!`);

    this.updateBoard();
    this.applyAttackResolutionIndicators(attacker, target);

    if (typeof this.waitForPresentationDelay === "function") {
      await this.waitForPresentationDelay(600);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
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
  const resumeFromTie = options.resumeFromTie === true;

  this.queueVisualFeedback?.({
    kind: "impact",
    sourceCard: attacker,
    targetCard: target,
    targetOwnerId: target?.owner,
    targetZone: "field",
    tone: "red",
  });

  const attackerOwner = attacker?.owner === "player" ? this.player : this.bot;
  const defenderOwner = target?.owner === "player" ? this.player : this.bot;

  if (!resumeFromTie) {
    const battleDamageResult = await this.emit("battle_damage", {
      attacker,
      defender: target,
      target,
      attackerOwner,
      defenderOwner,
      targetOwner: defenderOwner,
    });

    if (battleDamageResult?.needsSelection) {
      return {
        ok: true,
        needsSelection: true,
        selectionContract: battleDamageResult.selectionContract,
        damageDealt: 0,
        targetDestroyed: false,
        attackerDestroyed: false,
      };
    }

    if (this.lastAttackNegated) {
      this.markAttackUsed(attacker, target);
      this.clearAttackResolutionIndicators();
      this.updateBoard();
      return {
        ok: true,
        damageDealt: 0,
        targetDestroyed: false,
        attackerDestroyed: false,
      };
    }

    const attackerStillOnField =
      attackerOwner && Array.isArray(attackerOwner.field)
        ? attackerOwner.field.includes(attacker)
        : false;
    const targetStillOnField =
      defenderOwner && Array.isArray(defenderOwner.field)
        ? defenderOwner.field.includes(target)
        : false;

    if (!attackerStillOnField || !targetStillOnField) {
      this.ui?.log?.("Attack stopped before damage calculation.");
      this.markAttackUsed(attacker, target);
      this.clearAttackResolutionIndicators();
      this.updateBoard();
      return {
        ok: true,
        damageDealt: 0,
        targetDestroyed: false,
        attackerDestroyed: false,
      };
    }

    if (attacker.position !== "attack" || attacker.isFacedown) {
      this.ui?.log?.(
        "Attack stopped because the attacker is no longer in Attack Position.",
      );
      this.markAttackUsed(attacker, target);
      this.clearAttackResolutionIndicators();
      this.updateBoard();
      return {
        ok: true,
        damageDealt: 0,
        targetDestroyed: false,
        attackerDestroyed: false,
      };
    }
  }

  // Capture healing flags at the start of combat resolution to avoid race conditions
  const attackerHealsOnBattleDamage =
    attacker?.battleDamageHealsControllerThisTurn || false;
  const defenderHealsOnBattleDamage =
    target?.battleDamageHealsControllerThisTurn || false;

  // Check if we're resuming from a pending tie destruction
  const skipAttackerDestruction = resumeFromTie;
  const battleDestroyResults = [];

  // Track combat results for replay
  let totalDamageDealt = 0;
  let targetWasDestroyed = false;
  let attackerWasDestroyed = false;

  const applyBattleDamage = async (
    player,
    cardInvolved,
    amount,
    shouldHeal = false,
  ) => {
    if (!player || amount <= 0) return 0;
    if (
      cardInvolved?.preventsBattleDamageToController === true &&
      player.id === cardInvolved?.owner
    ) {
      this.ui?.log?.(
        `${cardInvolved.name} prevents battle damage to its controller.`,
      );
      return 0;
    }
    if (shouldHeal && player.id === cardInvolved?.owner) {
      const before = player.lp || 0;
      player.gainLP(amount);
      const gained = Math.max(0, (player.lp || 0) - before);
      if (gained > 0 && typeof this.emit === "function") {
        await this.emit("lp_change", {
          player,
          sourceCard: cardInvolved,
          lpGained: gained,
          before,
          after: player.lp,
        });
      }
    } else {
      this.inflictDamage(player, amount, {
        sourceCard: cardInvolved,
        cause: "battle",
      });
    }
    return amount;
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
      const appliedDamage = await applyBattleDamage(
        defender,
        target,
        damage,
        defenderHealsOnBattleDamage,
      );
      totalDamageDealt = appliedDamage;
      logBattleResult(
        appliedDamage > 0
          ? `${attacker.name} destroyed ${target.name} and dealt ${appliedDamage} damage.`
          : `${attacker.name} destroyed ${target.name}, but no battle damage was taken.`,
      );

      logBattleDestroyCheck("attacker over atk target");
      if (this.canDestroyByBattle(target)) {
        const preDestroyedOwnerId = target.owner;
        const preDestroyedOwner =
          preDestroyedOwnerId === "player" ? this.player : this.bot;
        const result = await this.destroyCard(target, {
          cause: "battle",
          sourceCard: attacker,
        });
        if (result?.destroyed) {
          targetWasDestroyed = true;
          const bdResult = await this.applyBattleDestroyEffect(
            attacker,
            target,
            {
              destroyedOwner: preDestroyedOwner,
              destroyedOwnerId: preDestroyedOwnerId,
            },
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
      const appliedDamage = await applyBattleDamage(
        attPlayer,
        attacker,
        damage,
        attackerHealsOnBattleDamage,
      );
      totalDamageDealt = appliedDamage;
      logBattleResult(
        appliedDamage > 0
          ? `${attacker.name} was destroyed by ${target.name} and took ${appliedDamage} damage.`
          : `${attacker.name} was destroyed by ${target.name}, but no battle damage was taken.`,
      );

      logBattleDestroyCheck("attacker loses to atk target");
      if (this.canDestroyByBattle(attacker)) {
        const preDestroyedOwnerId = attacker.owner;
        const preDestroyedOwner =
          preDestroyedOwnerId === "player" ? this.player : this.bot;
        const result = await this.destroyCard(attacker, {
          cause: "battle",
          sourceCard: target,
        });
        if (result?.destroyed) {
          attackerWasDestroyed = true;
          const bdResult = await this.applyBattleDestroyEffect(
            target,
            attacker,
            {
              destroyedOwner: preDestroyedOwner,
              destroyedOwnerId: preDestroyedOwnerId,
            },
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
        const preDestroyedOwnerId = attacker.owner;
        const preDestroyedOwner =
          preDestroyedOwnerId === "player" ? this.player : this.bot;
        const result = await this.destroyCard(attacker, {
          cause: "battle",
          sourceCard: target,
        });
        if (result?.destroyed) {
          const bdResult = await this.applyBattleDestroyEffect(
            target,
            attacker,
            {
              destroyedOwner: preDestroyedOwner,
              destroyedOwnerId: preDestroyedOwnerId,
            },
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
            target,
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
        `${attacker.name} and ${target.name} destroyed each other.`,
      );
    }
  } else {
    const defender = target.owner === "player" ? this.player : this.bot;
    if (attacker.atk > target.def) {
      if (attacker.piercing) {
        const damage = attacker.atk - target.def;
        const appliedDamage = await applyBattleDamage(
          defender,
          target,
          damage,
          defenderHealsOnBattleDamage,
        );
        totalDamageDealt = appliedDamage;
        logBattleResult(
          appliedDamage > 0
            ? `${attacker.name} pierced ${target.name} for ${appliedDamage} damage.`
            : `${attacker.name} pierced ${target.name}, but no battle damage was taken.`,
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
            target,
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
      const appliedDamage = await applyBattleDamage(
        attPlayer,
        attacker,
        damage,
        attackerHealsOnBattleDamage,
      );
      totalDamageDealt = appliedDamage;
      logBattleResult(
        appliedDamage > 0
          ? `${attacker.name} took ${appliedDamage} damage attacking ${target.name}.`
          : `${attacker.name} attacked ${target.name}, but no battle damage was taken.`,
      );
    } else {
      logBattleResult(
        `${attacker.name} could not break ${target.name}'s defense.`,
      );
    }
  }

  this.markAttackUsed(attacker, target);
  this.checkWinCondition();
  this.clearAttackResolutionIndicators();
  this.updateBoard();
  const pendingResult = battleDestroyResults.find(
    (r) => r?.needsSelection && r?.selectionContract,
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
export async function applyBattleDestroyEffect(
  attacker,
  destroyed,
  extras = {},
) {
  // Legacy: onBattleDestroy direct damage effects tied to the attacker
  if (attacker && attacker.onBattleDestroy && attacker.onBattleDestroy.damage) {
    const defender = attacker.owner === "player" ? this.bot : this.player;
    this.inflictDamage(defender, attacker.onBattleDestroy.damage, {
      sourceCard: attacker,
      cause: "effect",
    });
    this.ui.log(
      `${attacker.name} inflicts an extra ${attacker.onBattleDestroy.damage} damage!`,
    );
    this.checkWinCondition();
    this.updateBoard();
  }

  // New: global battle_destroy event for cards like Shadow-Heart Gecko
  if (!destroyed) {
    return { ok: true };
  }

  const destroyedOwner =
    extras?.destroyedOwner ||
    (destroyed.owner === "player" ? this.player : this.bot);
  const attackerOwner = attacker.owner === "player" ? this.player : this.bot;

  const emitResult = await this.emit("battle_destroy", {
    player: attackerOwner, // o dono do atacante (quem causou a destruição)
    opponent: destroyedOwner, // o jogador que perdeu o monstro
    attacker,
    destroyed,
    destroyedOwner: destroyedOwner || extras?.destroyedOwner || null,
    destroyedOwnerId:
      extras?.destroyedOwnerId || destroyedOwner?.id || destroyed?.owner,
    attackerOwner,
    destroyedOwner,
  });

  return emitResult || { ok: true };
}
