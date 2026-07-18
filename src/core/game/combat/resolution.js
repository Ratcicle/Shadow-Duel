/**
 * Combat resolution - attack resolution and battle outcome processing.
 * Extracted from Game.js as part of B.5 modularization.
 */

import {
  getMonsterAttackLimit,
  hasExplicitAttackLimitThisTurn,
} from "./availability.js";

function getController(game, card) {
  if (!game || !card) return null;
  return card.owner === "player" ? game.player : game.bot;
}

function getOpponentPlayer(game, card) {
  if (!game || !card) return null;
  return card.owner === "player" ? game.bot : game.player;
}

function getActualLpLoss(player, amount) {
  const value = Number(amount);
  if (!player || !Number.isFinite(value) || value <= 0) return 0;
  return Math.max(0, Math.min(Number(player.lp || 0), value));
}

function getPiercingDamageMultiplier(card) {
  if (!card?.piercing) return 0;
  const multiplier = Number(card.piercingDamageMultiplier ?? 1);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}

function calculatePiercingDamage(attacker, attackerAtk, targetDef) {
  const multiplier = getPiercingDamageMultiplier(attacker);
  if (multiplier <= 0) return 0;
  const excess = Math.max(0, Number(attackerAtk || 0) - Number(targetDef || 0));
  return excess > 0 ? Math.floor(excess * multiplier) : 0;
}

function canShowBattleDamageLoss(player, cardInvolved, shouldHeal) {
  if (!player || !cardInvolved) return false;
  if (
    cardInvolved?.preventsBattleDamageToController === true &&
    player.id === cardInvolved?.owner
  ) {
    return false;
  }
  if (shouldHeal && player.id === cardInvolved?.owner) {
    return false;
  }
  return true;
}

function getCardInstanceId(card) {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? card?.simInstanceId ?? null;
}

function sameBattleCard(card, expected, expectedInstanceId, expectedFieldPresenceId) {
  if (!card || !expected) return false;
  if (card === expected) return true;
  const cardInstanceId = getCardInstanceId(card);
  if (
    cardInstanceId !== null &&
    expectedInstanceId !== undefined &&
    expectedInstanceId !== null &&
    cardInstanceId === expectedInstanceId
  ) {
    return true;
  }
  return (
    expectedFieldPresenceId &&
    card.fieldPresenceId &&
    expectedFieldPresenceId === card.fieldPresenceId
  );
}

function battlePairMatches(entry, attacker, defender) {
  const firstIsAttacker = sameBattleCard(
    attacker,
    entry.firstTarget,
    entry.firstInstanceId,
    entry.firstFieldPresenceId,
  );
  const secondIsDefender = sameBattleCard(
    defender,
    entry.secondTarget,
    entry.secondInstanceId,
    entry.secondFieldPresenceId,
  );
  const firstIsDefender = sameBattleCard(
    defender,
    entry.firstTarget,
    entry.firstInstanceId,
    entry.firstFieldPresenceId,
  );
  const secondIsAttacker = sameBattleCard(
    attacker,
    entry.secondTarget,
    entry.secondInstanceId,
    entry.secondFieldPresenceId,
  );
  return (firstIsAttacker && secondIsDefender) || (firstIsDefender && secondIsAttacker);
}

function hasBattleDamageTimingEffect(card) {
  return Array.isArray(card?.effects)
    ? card.effects.some(
        (effect) =>
          effect?.timing === "on_event" && effect.event === "battle_damage",
      )
    : false;
}

function hasMatchingTemporaryBattlePairDamageStepEffect(game, attacker, target) {
  if (!attacker || !target || !Array.isArray(game?.temporaryBattlePairEffects)) {
    return false;
  }

  return game.temporaryBattlePairEffects.some((entry) => {
    if (!entry) return false;
    if (
      Number.isFinite(entry.expiresOnTurn) &&
      game.turnCounter > entry.expiresOnTurn
    ) {
      return false;
    }

    const timing = entry.timing || "before_damage_calculation";
    if (
      timing !== "start_of_damage_step" &&
      timing !== "before_damage_calculation"
    ) {
      return false;
    }

    return battlePairMatches(entry, attacker, target);
  });
}

function hasPotentialBattleDamageTimingEffect(game, attacker, target) {
  if (hasMatchingTemporaryBattlePairDamageStepEffect(game, attacker, target)) {
    return true;
  }

  const candidates = [attacker, target];
  for (const player of [game?.player, game?.bot]) {
    for (const zoneName of ["hand", "spellTrap", "fieldSpell"]) {
      if (Array.isArray(player?.[zoneName])) {
        candidates.push(...player[zoneName]);
      } else if (player?.[zoneName]) {
        candidates.push(player[zoneName]);
      }
    }
  }
  return candidates.some(hasBattleDamageTimingEffect);
}

function resolveBattleLpLossPreview(game, attacker, target) {
  if (!game || !attacker) return null;

  if (!target) {
    // Direct attacks do not emit the battle_damage window, so the preview is stable.
    const defender = getOpponentPlayer(game, attacker);
    const amount = getActualLpLoss(defender, attacker.atk);
    return amount > 0 ? { player: defender, amount } : null;
  }

  if (target.isFacedown) return null;

  if (hasPotentialBattleDamageTimingEffect(game, attacker, target)) return null;

  const attackerOwner = getController(game, attacker);
  const defenderOwner = getController(game, target);
  const attackerAtk = Number(attacker.atk || 0);
  const targetAtk = Number(target.atk || 0);
  const targetDef = Number(target.def || 0);

  let player = null;
  let cardInvolved = null;
  let amount = 0;
  let shouldHeal = false;

  if (target.position === "attack") {
    if (attackerAtk > targetAtk) {
      player = defenderOwner;
      cardInvolved = target;
      amount = attackerAtk - targetAtk;
      shouldHeal = !!target.battleDamageHealsControllerThisTurn;
    } else if (attackerAtk < targetAtk) {
      player = attackerOwner;
      cardInvolved = attacker;
      amount = targetAtk - attackerAtk;
      shouldHeal = !!attacker.battleDamageHealsControllerThisTurn;
    }
  } else if (attackerAtk > targetDef && attacker.piercing) {
    const piercingDamage = calculatePiercingDamage(
      attacker,
      attackerAtk,
      targetDef,
    );
    player = defenderOwner;
    cardInvolved = target;
    amount = piercingDamage;
    shouldHeal = !!target.battleDamageHealsControllerThisTurn;
  } else if (attackerAtk < targetDef) {
    player = attackerOwner;
    cardInvolved = attacker;
    amount = targetDef - attackerAtk;
    shouldHeal = !!attacker.battleDamageHealsControllerThisTurn;
  }

  if (!canShowBattleDamageLoss(player, cardInvolved, shouldHeal)) return null;
  const actual = getActualLpLoss(player, amount);
  return actual > 0 ? { player, amount: actual } : null;
}

async function waitForAttackPresentation(game, presentation) {
  const finished =
    presentation?.finished && typeof presentation.finished.then === "function"
      ? presentation.finished
      : presentation && typeof presentation.then === "function"
        ? presentation
        : null;
  if (!finished) return;
  try {
    await finished;
  } catch (error) {
    console.warn("[Shadow Duel] Attack presentation failed.", error);
  }
}

async function waitForAttackContact(game, presentation) {
  const contact =
    presentation?.contact && typeof presentation.contact.then === "function"
      ? presentation.contact
      : null;
  if (!contact) {
    await waitForAttackPresentation(game, presentation);
    return false;
  }
  try {
    await contact;
    return true;
  } catch (error) {
    console.warn("[Shadow Duel] Attack contact presentation failed.", error);
    return false;
  }
}

/**
 * Resolve an attack through the Battle Step and canonical Damage Step.
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
  const baseMaxAttacks = this.getMonsterAttackLimit
    ? this.getMonsterAttackLimit(attacker)
    : getMonsterAttackLimit.call(this, attacker);
  const maxAttacks = availability.maxAttacks ?? baseMaxAttacks;
  const usingSecondAttack =
    !hasExplicitAttackLimitThisTurn(attacker) &&
    attacker.canMakeSecondAttackThisTurn &&
    !attacker.secondAttackUsedThisTurn &&
    attacksUsed >= maxAttacks;

  if (usingSecondAttack) {
    attacker.secondAttackUsedThisTurn = true;
  }

  this.lastAttackNegated = false;

  this.battleStep = "battle";

  let defenderOwner = target
    ? target.owner === "player"
      ? this.player
      : this.bot
    : attacker.owner === "player"
      ? this.bot
      : this.player;
  let targetOwner = defenderOwner;

  const applyAttackRedirect = (redirectPayload) => {
    const redirectedTarget =
      redirectPayload?.attackRedirect?.target ||
      redirectPayload?.redirectedTarget ||
      null;
    const redirectedTargetOwner =
      redirectPayload?.attackRedirect?.targetOwner ||
      redirectPayload?.redirectedTargetOwner ||
      null;
    const redirectIsValid =
      redirectedTarget &&
      redirectedTarget.cardKind === "monster" &&
      redirectedTargetOwner &&
      Array.isArray(redirectedTargetOwner.field) &&
      redirectedTargetOwner.field.includes(redirectedTarget) &&
      redirectedTargetOwner.id !== attackerOwner?.id;
    if (!redirectIsValid) return false;

    target = redirectedTarget;
    defenderOwner = redirectedTargetOwner;
    targetOwner = redirectedTargetOwner;
    this.applyAttackResolutionIndicators(attacker, target);
    this.ui?.log?.(`Attack target changed to ${target.name}.`);
    return true;
  };

  const validateAttackDeclaration = () => {
    const attackerStillOnField =
      attackerOwner && Array.isArray(attackerOwner.field)
        ? attackerOwner.field.includes(attacker)
        : false;
    if (!attackerStillOnField) {
      return {
        ok: false,
        reason: "Attack stopped before declaration because the attacker left the field.",
      };
    }
    if (attacker.position !== "attack" || attacker.isFacedown) {
      return {
        ok: false,
        reason:
          "Attack stopped before declaration because the attacker is no longer in Attack Position.",
      };
    }
    if (target) {
      const targetOwnerField =
        targetOwner?.field ||
        (target.owner === "player" ? this.player.field : this.bot.field);
      if (!targetOwnerField.includes(target)) {
        return {
          ok: false,
          reason: "Attack stopped before declaration because the target left the field.",
        };
      }
    } else {
      if (
        (attacker.attacksUsedThisTurn || 0) > 0 &&
        (attacker.extraAttackTargetRestriction ||
          attacker.passiveExtraAttackTargetRestriction) === "monster"
      ) {
        return {
          ok: false,
          reason: `${attacker.name}'s extra attack can only target monsters.`,
        };
      }
      if (attacker.cannotAttackDirectly) {
        return {
          ok: false,
          reason: `${attacker.name} cannot attack directly.`,
        };
      }
      if (attacker.canAttackAllOpponentMonstersThisTurn) {
        return {
          ok: false,
          reason: `${attacker.name} can only attack monsters this turn.`,
        };
      }
      if (attackerOwner?.forbidDirectAttacksThisTurn) {
        return {
          ok: false,
          reason: "You cannot attack directly this turn.",
        };
      }
      const opponentField = defenderOwner?.field || [];
      const hasOpponentMonster = opponentField.some(
        (card) => card && card.cardKind === "monster",
      );
      if (hasOpponentMonster && attacker.canAttackDirectlyThisTurn !== true) {
        return {
          ok: false,
          reason: "Attack stopped before declaration because a direct attack is no longer valid.",
        };
      }
    }
    return { ok: true };
  };

  const battleStepOpenContext = {
    attacker,
    target: target || null,
    defender: target || null,
    attackerOwner,
    defenderOwner,
    targetOwner,
    battleStep: this.battleStep,
    damageStepTiming: null,
    isOpponentAttack: attackerOwner?.id !== defenderOwner?.id,
    triggerPlayer: attackerOwner,
    addTriggerToChain: false,
  };
  await this.checkAndOfferTraps("battle_step_open", battleStepOpenContext);
  applyAttackRedirect(battleStepOpenContext);

  const declarationCheck = validateAttackDeclaration();
  if (!declarationCheck.ok) {
    if (usingSecondAttack) {
      attacker.secondAttackUsedThisTurn = false;
    }
    this.ui?.log?.(declarationCheck.reason || "Attack stopped before declaration.");
    this.clearAttackResolutionIndicators();
    this.updateBoard();
    return { ok: true };
  }

  this.ui.log(`${attacker.name} attacks ${target ? target.name : "directly"}!`);

  let battleImpactVisualPlayed = false;
  let battleLpLossPreview = null;
  let battleLpLossFeedback = null;
  const setBattleLpLossPreview = (preview) => {
    battleLpLossPreview = preview?.player && preview.amount > 0 ? preview : null;
  };
  const showBattleLpLossOnContact = (contact = {}) => {
    if (battleLpLossFeedback || !battleLpLossPreview) return;
    const amount = getActualLpLoss(
      battleLpLossPreview.player,
      battleLpLossPreview.amount,
    );
    if (amount <= 0 || typeof this.ui?.showLpDamageSequence !== "function") {
      return;
    }
    const fromLp = Number(battleLpLossPreview.player.lp || 0);
    const played = this.ui.showLpDamageSequence(
      battleLpLossPreview.player,
      amount,
      {
        cause: "battle",
        sourceCard: attacker,
        targetCard: target || null,
        sourceRect: contact?.sourceRect || null,
        targetRect: contact?.targetRect || contact?.contactRect || null,
        battleImpactRect: contact?.targetRect || contact?.contactRect || null,
        contactRect: contact?.contactRect || null,
        directAttack: !target,
        fromLp,
        toLp: Math.max(0, fromLp - amount),
        screenShake: false,
        holdFinalUntilReal: true,
      },
    );
    if (played !== true) return;
    battleLpLossFeedback = {
      player: battleLpLossPreview.player,
      amount,
    };
  };
  const consumeBattleLpLossFeedback = (player, amount) => {
    const actual = getActualLpLoss(player, amount);
    if (
      !battleLpLossFeedback ||
      battleLpLossFeedback.player !== player ||
      battleLpLossFeedback.amount !== actual
    ) {
      return false;
    }
    battleLpLossFeedback = null;
    return true;
  };
  const playBattleImpactOnContact = (contact = {}) => {
    if (!battleImpactVisualPlayed) {
      const played = this.ui?.playBattleImpactImmediate?.({
        sourceCard: attacker,
        targetCard: target || null,
        targetOwnerId: defenderOwner?.id || null,
        targetRect: !target
          ? contact?.targetRect || contact?.contactRect || null
          : null,
        directAttack: !target,
        cause: "battle",
        intensity: "normal",
        tone: "red",
      });
      if (played === true) {
        battleImpactVisualPlayed = true;
      }
    }
    showBattleLpLossOnContact(contact);
  };
  const startAttackPresentation = () =>
    attacker.instanceId != null && typeof this.ui?.playAttackLunge === "function"
      ? this.ui.playAttackLunge({
          kind: "attack-lunge",
          card: attacker,
          cardKey: String(attacker.instanceId),
          targetCardKey:
            target?.instanceId != null ? String(target.instanceId) : null,
          targetOwnerId: defenderOwner?.id || null,
          directAttack: !target,
          onContact: playBattleImpactOnContact,
        })
      : null;

  const attackDeclaredPayload = {
    attacker,
    target: target || null,
    defender: target || null,
    attackerOwner,
    defenderOwner,
    targetOwner,
    battleStep: this.battleStep,
    damageStepTiming: null,
  };

  await this.emit("attack_declared", attackDeclaredPayload);

  if (applyAttackRedirect(attackDeclaredPayload)) {
    const battleStepOpenContext = {
      attacker,
      target,
      defender: target,
      attackerOwner,
      defenderOwner,
      targetOwner,
      battleStep: this.battleStep,
      damageStepTiming: null,
      isOpponentAttack: attackerOwner?.id !== defenderOwner?.id,
      triggerPlayer: attackerOwner,
      addTriggerToChain: false,
    };
    await this.checkAndOfferTraps("battle_step_open", battleStepOpenContext);
    applyAttackRedirect(battleStepOpenContext);
  }

  if (this.lastAttackNegated) {
    attacker.attacksUsedThisTurn = (attacker.attacksUsedThisTurn || 0) + 1;
    const maxAttacks = this.getMonsterAttackLimit
      ? this.getMonsterAttackLimit(attacker)
      : getMonsterAttackLimit.call(this, attacker);
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
      targetOwner?.field ||
      (target.owner === "player" ? this.player.field : this.bot.field);
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
      (attacker.extraAttackTargetRestriction ||
        attacker.passiveExtraAttackTargetRestriction) === "monster"
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
    setBattleLpLossPreview(resolveBattleLpLossPreview(this, attacker, null));
    const attackPresentation = startAttackPresentation();
    await waitForAttackPresentation(this, attackPresentation);
    if (!battleImpactVisualPlayed) {
      this.queueVisualFeedback?.({
        kind: "impact",
        cause: "battle",
        directAttack: true,
        intensity: "normal",
        sourceCard: attacker,
        targetOwnerId: defender.id,
        tone: "red",
      });
    }
    const damageStep = this.createDamageStepTransaction({
      attacker,
      defender: null,
      attackerOwner,
      defenderOwner: defender,
      consumeBattleLpLossFeedback,
    });
    const combatResult = await this.executeDamageStepTransaction(damageStep);
    this.checkWinCondition();
    this.clearAttackResolutionIndicators();
    this.updateBoard();
    return combatResult;
  }

  setBattleLpLossPreview(resolveBattleLpLossPreview(this, attacker, target));
  const attackPresentation = startAttackPresentation();
  const resolveDamageOnContact = hasPotentialBattleDamageTimingEffect(
    this,
    attacker,
    target,
  );
  // Damage Step effects can change stats, so calculate real damage at impact.
  if (resolveDamageOnContact) {
    await waitForAttackContact(this, attackPresentation);
  } else {
    await waitForAttackPresentation(this, attackPresentation);
  }

  const damageStep = this.createDamageStepTransaction({
    attacker,
    defender: target,
    attackerOwner,
    defenderOwner,
    consumeBattleLpLossFeedback,
  });
  const combatResult = await this.executeDamageStepTransaction(damageStep);

  if (resolveDamageOnContact) {
    await waitForAttackPresentation(this, attackPresentation);
  }

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
