/**
 * Combat resolution - attack resolution and battle outcome processing.
 * Extracted from Game.js as part of B.5 modularization.
 */

import {
  getMonsterAttackLimit,
  hasExplicitAttackLimitThisTurn,
} from "./availability.js";

function clearDamageCalculationTempBuffs(game) {
  const buffs = game?.damageCalculationTempBuffs;
  if (game) {
    game.damageCalculationStatChangePending = false;
  }
  if (!Array.isArray(buffs) || buffs.length === 0) return;

  for (const buff of buffs.splice(0)) {
    const card = buff?.card;
    if (!card) continue;

    const atk = Number(buff.atk || 0);
    const trackedAtk = Number(card.tempAtkBoost || 0);
    if (atk !== 0 && trackedAtk !== 0) {
      const removeAtk =
        Math.abs(trackedAtk) >= Math.abs(atk) ? atk : trackedAtk;
      card.atk = Math.max(0, Number(card.atk || 0) - removeAtk);
      card.tempAtkBoost = trackedAtk - removeAtk;
    }

    const def = Number(buff.def || 0);
    const trackedDef = Number(card.tempDefBoost || 0);
    if (def !== 0 && trackedDef !== 0) {
      const removeDef =
        Math.abs(trackedDef) >= Math.abs(def) ? def : trackedDef;
      card.def = Math.max(0, Number(card.def || 0) - removeDef);
      card.tempDefBoost = trackedDef - removeDef;
    }
  }
}

async function presentBattleDestructionBeforeTriggers(game) {
  game?.updateBoard?.();

  if (typeof game?.waitForPresentationDelay === "function") {
    await game.waitForPresentationDelay(250);
  }
}

function queuePendingBattleDestroyAfterSelection(game, attacker, destroyed, extras) {
  if (!game || !attacker || !destroyed) return;
  game.pendingBattleDestroyAfterSelection = {
    attacker,
    destroyed,
    extras: { ...(extras || {}) },
  };
}

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

function getPlayerById(game, playerId) {
  if (!game || !playerId) return null;
  if (game.player?.id === playerId) return game.player;
  if (game.bot?.id === playerId) return game.bot;
  return null;
}

function isFieldMonsterControlledBy(player, card) {
  return (
    !!player &&
    !!card &&
    card.cardKind === "monster" &&
    Array.isArray(player.field) &&
    player.field.includes(card)
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

async function resolveTemporaryBattlePairEffects(game, payload) {
  const entries = Array.isArray(game?.temporaryBattlePairEffects)
    ? game.temporaryBattlePairEffects
    : [];
  if (entries.length === 0) return null;

  const remaining = [];
  let selectionResult = null;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (
      entry &&
      Number.isFinite(entry.expiresOnTurn) &&
      game.turnCounter > entry.expiresOnTurn
    ) {
      continue;
    }
    if (!entry || entry.timing !== payload.damageStepTiming) {
      remaining.push(entry);
      continue;
    }
    if (!battlePairMatches(entry, payload.attacker, payload.defender)) {
      remaining.push(entry);
      continue;
    }

    const controller = getPlayerById(game, entry.controllerId);
    const opponent = getPlayerById(game, entry.opponentId);
    const affectedTarget = entry.affectedTarget;
    if (!isFieldMonsterControlledBy(opponent, affectedTarget)) {
      continue;
    }

    const actionCtx = {
      source: entry.source,
      player: controller,
      opponent,
      effect: { id: entry.sourceEffectId || entry.id },
      attacker: payload.attacker,
      defender: payload.defender,
      target: payload.target,
      attackerOwner: payload.attackerOwner,
      defenderOwner: payload.defenderOwner,
      targetOwner: payload.targetOwner,
      battleStep: "damage",
      damageStepTiming: payload.damageStepTiming,
      isDamageStep: true,
    };
    const actionTargets = {
      [entry.firstTargetRef]: [entry.firstTarget],
      [entry.secondTargetRef]: [entry.secondTarget],
      [entry.affectedTargetRef]: [affectedTarget],
      battle_pair_first: [entry.firstTarget],
      battle_pair_second: [entry.secondTarget],
      battle_pair_affected: [affectedTarget],
    };
    const result = await game.effectEngine?.applyActions?.(
      Array.isArray(entry.actions) ? entry.actions : [],
      actionCtx,
      actionTargets,
    );
    if (result?.needsSelection) {
      selectionResult = result;
      remaining.push(...entries.slice(index + 1));
      break;
    }
    await game.resolvePendingSpellTrapFinalization?.(
      entry.source,
      controller,
      "spellTrap",
      { deferUntil: "battle_pair_effect" },
    );
  }

  game.temporaryBattlePairEffects = remaining;
  return selectionResult;
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

async function presentDamageCalculationStatChanges(game) {
  if (!game?.damageCalculationStatChangePending) return;

  game.updateBoard?.({
    animateCards: false,
    animateFeedback: true,
  });
  await game.waitForBoardPresentation?.();
  await game.waitForPresentationDelay?.(
    game.damageCalculationStatPresentationDelayMs ?? 500,
  );
  game.damageCalculationStatChangePending = false;
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

async function revealBattleTargetBeforeDamage(game, attacker, target) {
  if (!game || !target?.isFacedown) return false;

  const targetOwner = target.owner === "player" ? "player" : "bot";
  const targetField =
    target.owner === "player" ? game.player?.field : game.bot?.field;
  const targetIndex = Array.isArray(targetField)
    ? targetField.indexOf(target)
    : -1;

  game.ui?.applyFlipAnimation?.(targetOwner, targetIndex);

  target.isFacedown = false;
  target.revealedTurn = game.turnCounter;
  game.effectEngine?.clearTargetingCache?.();
  game.ui?.log?.(`${target.name} was flipped!`);

  game.updateBoard?.();
  game.applyAttackResolutionIndicators?.(attacker, target);

  if (typeof game.waitForPresentationDelay === "function") {
    await game.waitForPresentationDelay(600);
  } else {
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return true;
}

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
  this.damageStepTiming = null;

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
    damageStepTiming: this.damageStepTiming,
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
    damageStepTiming: this.damageStepTiming,
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
      damageStepTiming: this.damageStepTiming,
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
    this.inflictDamage(defender, attacker.atk, {
      sourceCard: attacker,
      cause: "battle",
      directAttack: true,
      suppressVisual: consumeBattleLpLossFeedback(
        defender,
        attacker.atk,
      ),
    });
    this.markAttackUsed(attacker, null); // Direct attack, no target
    this.checkWinCondition();
    this.clearAttackResolutionIndicators();
    this.updateBoard();
    return { ok: true };
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

  const combatResult = await this.finishCombat(attacker, target, {
    battleImpactVisualPlayed,
    consumeBattleLpLossFeedback,
  });

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

/**
 * Finish combat resolution - calculate damage, destroy monsters, apply effects.
 * @param {Object} attacker - The attacking monster
 * @param {Object} target - The target monster
 * @param {Object} options - Additional options (resumeFromTie, etc.)
 * @returns {Object} Result with ok status and any pending selections
 */
export async function finishCombat(attacker, target, options = {}) {
  const resumeFromTie = options.resumeFromTie === true;
  const battleImpactVisualPlayed = options.battleImpactVisualPlayed === true;
  const consumeBattleLpLossFeedback =
    typeof options.consumeBattleLpLossFeedback === "function"
      ? options.consumeBattleLpLossFeedback
      : null;

  const attackerOwner = attacker?.owner === "player" ? this.player : this.bot;
  const defenderOwner = target?.owner === "player" ? this.player : this.bot;

  if (!resumeFromTie) {
    const previousBattleStep = this.battleStep;
    const previousDamageStepTiming = this.damageStepTiming;
    this.battleStep = "damage";
    this.damageStepTiming = "start_of_damage_step";
    const damageStepStartBattlePairResult =
      await resolveTemporaryBattlePairEffects(this, {
        attacker,
        defender: target,
        target,
        attackerOwner,
        defenderOwner,
        targetOwner: defenderOwner,
        damageStepTiming: this.damageStepTiming,
      });
    this.damageStepTiming = "before_damage_calculation";
    if (damageStepStartBattlePairResult?.needsSelection) {
      this.battleStep =
        previousBattleStep || (this.phase === "battle" ? "battle" : null);
      this.damageStepTiming = previousDamageStepTiming ?? null;
      return {
        ok: true,
        needsSelection: true,
        selectionContract: damageStepStartBattlePairResult.selectionContract,
        damageDealt: 0,
        targetDestroyed: false,
        attackerDestroyed: false,
      };
    }

    const attackerStillOnFieldAtDamageStart =
      attackerOwner && Array.isArray(attackerOwner.field)
        ? attackerOwner.field.includes(attacker)
        : false;
    const targetStillOnFieldAtDamageStart =
      defenderOwner && Array.isArray(defenderOwner.field)
        ? defenderOwner.field.includes(target)
        : false;

    if (!attackerStillOnFieldAtDamageStart || !targetStillOnFieldAtDamageStart) {
      this.battleStep =
        previousBattleStep || (this.phase === "battle" ? "battle" : null);
      this.damageStepTiming = previousDamageStepTiming ?? null;
      this.ui?.log?.("Attack stopped at the start of the Damage Step.");
      this.markAttackUsed(attacker, target);
      this.clearAttackResolutionIndicators();
      clearDamageCalculationTempBuffs(this);
      this.updateBoard();
      return {
        ok: true,
        damageDealt: 0,
        targetDestroyed: false,
        attackerDestroyed: false,
      };
    }

    await revealBattleTargetBeforeDamage(this, attacker, target);
    const battleDamageResult = await this.emit("battle_damage", {
      attacker,
      defender: target,
      target,
      attackerOwner,
      defenderOwner,
      targetOwner: defenderOwner,
      battleStep: this.battleStep,
      damageStepTiming: this.damageStepTiming,
      isDamageStep: true,
    });
    const battlePairResult = battleDamageResult?.needsSelection
      ? null
      : await resolveTemporaryBattlePairEffects(this, {
          attacker,
          defender: target,
          target,
          attackerOwner,
          defenderOwner,
          targetOwner: defenderOwner,
          damageStepTiming: this.damageStepTiming,
        });
    if (!battleDamageResult?.needsSelection && !battlePairResult?.needsSelection) {
      await presentDamageCalculationStatChanges(this);
    }
    this.battleStep =
      previousBattleStep || (this.phase === "battle" ? "battle" : null);
    this.damageStepTiming = previousDamageStepTiming ?? null;

    if (battleDamageResult?.needsSelection || battlePairResult?.needsSelection) {
      const pendingSelection = battleDamageResult?.needsSelection
        ? battleDamageResult
        : battlePairResult;
      return {
        ok: true,
        needsSelection: true,
        selectionContract: pendingSelection.selectionContract,
        damageDealt: 0,
        targetDestroyed: false,
        attackerDestroyed: false,
      };
    }

    if (this.lastAttackNegated) {
      this.markAttackUsed(attacker, target);
      this.clearAttackResolutionIndicators();
      clearDamageCalculationTempBuffs(this);
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
      clearDamageCalculationTempBuffs(this);
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
      clearDamageCalculationTempBuffs(this);
      this.updateBoard();
      return {
        ok: true,
        damageDealt: 0,
        targetDestroyed: false,
        attackerDestroyed: false,
      };
    }
  }

  const battleImpactVisualTarget = this.ui?.captureCardAnimationSource?.(target, {
    ownerId: target?.owner,
    zone: "field",
  });
  if (!battleImpactVisualPlayed) {
    this.queueVisualFeedback?.({
      kind: "impact",
      cause: "battle",
      intensity: "normal",
      sourceCard: attacker,
      targetCard: target,
      targetOwnerId: target?.owner,
      targetRect: battleImpactVisualTarget?.rect || null,
      targetZone: "field",
      tone: "red",
    });
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

  const emitBattleCompleted = async () => {
    if (typeof this.emit !== "function" || !attacker || !target) return null;
    return await this.emit("battle_completed", {
      attacker,
      defender: target,
      target,
      attackerOwner,
      defenderOwner,
      targetOwner: defenderOwner,
      damageDealt: totalDamageDealt,
      targetDestroyed: targetWasDestroyed,
      attackerDestroyed: attackerWasDestroyed,
    });
  };

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
      player.gainLP(amount, {
        cause: "effect",
        sourceCard: cardInvolved,
        sourceRect: battleImpactVisualTarget?.rect || null,
      });
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
      const actualLoss = getActualLpLoss(player, amount);
      this.inflictDamage(player, amount, {
        sourceCard: cardInvolved,
        targetCard: target,
        targetRect: battleImpactVisualTarget?.rect || null,
        battleImpactRect: battleImpactVisualTarget?.rect || null,
        cause: "battle",
        suppressVisual:
          consumeBattleLpLossFeedback?.(player, actualLoss) === true,
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
      const lastUsedTurn =
        card.battleIndestructibleOncePerTurnLastUsedTurn ?? "none";
      const flags = `bi=${!!card.battleIndestructible}, tempBi=${!!card.tempBattleIndestructible}, once=${!!card.battleIndestructibleOncePerTurn}, onceUsed=${!!card.battleIndestructibleOncePerTurnUsed}, onceLast=${lastUsedTurn}`;
      return `${label}: ${card.name} ATK:${card.atk} DEF:${card.def} ${flags}`;
    };
    this.devLog("BATTLE_DESTROY_CHECK", {
      summary: `canDestroyByBattle check (${context})`,
      context,
      attacker: attacker?.name,
      target: target?.name,
    });
  };
  const getBattleDestructionContext = (card) => ({
    attacker,
    defender: target,
    target,
    battleOpponent: card === attacker ? target : attacker,
    sourceCard: card === attacker ? target : attacker,
  });

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
      if (this.canDestroyByBattle(target, getBattleDestructionContext(target))) {
        const preDestroyedOwnerId = target.owner;
        const preDestroyedOwner =
          preDestroyedOwnerId === "player" ? this.player : this.bot;
        const preDestroyedPosition = target.position || null;
        const result = await this.destroyCard(target, {
          cause: "battle",
          sourceCard: attacker,
        });
        if (result?.needsSelection) {
          if (result?.destroyed) {
            targetWasDestroyed = true;
            queuePendingBattleDestroyAfterSelection(this, attacker, target, {
              destroyedOwner: preDestroyedOwner,
              destroyedOwnerId: preDestroyedOwnerId,
              destroyedPosition: preDestroyedPosition,
            });
          }
          this.markAttackUsed(attacker, target);
          this.clearAttackResolutionIndicators();
          clearDamageCalculationTempBuffs(this);
          this.updateBoard();
          await emitBattleCompleted();
          return {
            ok: true,
            needsSelection: true,
            selectionContract: result.selectionContract,
            damageDealt: totalDamageDealt,
            targetDestroyed: targetWasDestroyed,
            attackerDestroyed: attackerWasDestroyed,
          };
        }
        if (result?.destroyed) {
          targetWasDestroyed = true;
          const bdResult = await this.applyBattleDestroyEffect(
            attacker,
            target,
            {
              destroyedOwner: preDestroyedOwner,
              destroyedOwnerId: preDestroyedOwnerId,
              destroyedPosition: preDestroyedPosition,
            },
          );
          if (bdResult) battleDestroyResults.push(bdResult);
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
      if (
        this.canDestroyByBattle(
          attacker,
          getBattleDestructionContext(attacker),
        )
      ) {
        const preDestroyedOwnerId = attacker.owner;
        const preDestroyedOwner =
          preDestroyedOwnerId === "player" ? this.player : this.bot;
        const preDestroyedPosition = attacker.position || null;
        const result = await this.destroyCard(attacker, {
          cause: "battle",
          sourceCard: target,
        });
        if (result?.needsSelection) {
          if (result?.destroyed) {
            attackerWasDestroyed = true;
            queuePendingBattleDestroyAfterSelection(this, target, attacker, {
              destroyedOwner: preDestroyedOwner,
              destroyedOwnerId: preDestroyedOwnerId,
              destroyedPosition: preDestroyedPosition,
            });
          }
          this.markAttackUsed(attacker, target);
          this.clearAttackResolutionIndicators();
          clearDamageCalculationTempBuffs(this);
          this.updateBoard();
          await emitBattleCompleted();
          return {
            ok: true,
            needsSelection: true,
            selectionContract: result.selectionContract,
            damageDealt: totalDamageDealt,
            targetDestroyed: targetWasDestroyed,
            attackerDestroyed: attackerWasDestroyed,
          };
        }
        if (result?.destroyed) {
          attackerWasDestroyed = true;
          const bdResult = await this.applyBattleDestroyEffect(
            target,
            attacker,
            {
              destroyedOwner: preDestroyedOwner,
              destroyedOwnerId: preDestroyedOwnerId,
              destroyedPosition: preDestroyedPosition,
            },
          );
          if (bdResult) battleDestroyResults.push(bdResult);
        }
      }
    } else {
      // to allow each triggered effect to be resolved before the next
      logBattleDestroyCheck("tie - attacker destruction check");
      if (
        !skipAttackerDestruction &&
        this.canDestroyByBattle(
          attacker,
          getBattleDestructionContext(attacker),
        )
      ) {
        const preDestroyedOwnerId = attacker.owner;
        const preDestroyedOwner =
          preDestroyedOwnerId === "player" ? this.player : this.bot;
        const preDestroyedPosition = attacker.position || null;
        const result = await this.destroyCard(attacker, {
          cause: "battle",
          sourceCard: target,
        });
        // we need to pause and let that resolve before destroying target
        if (result?.needsSelection) {
          if (result?.destroyed) {
            attackerWasDestroyed = true;
            queuePendingBattleDestroyAfterSelection(this, target, attacker, {
              destroyedOwner: preDestroyedOwner,
              destroyedOwnerId: preDestroyedOwnerId,
              destroyedPosition: preDestroyedPosition,
            });
          }
          // Store pending tie info so we can resume after selection
          this.pendingTieDestruction = {
            attacker,
            target,
            attackerHealsOnBattleDamage,
            defenderHealsOnBattleDamage,
          };
          this.markAttackUsed(attacker, target);
          this.clearAttackResolutionIndicators();
          clearDamageCalculationTempBuffs(this);
          this.updateBoard();
          await emitBattleCompleted();
          return {
            ok: true,
            needsSelection: true,
            selectionContract: result.selectionContract,
            pendingTieDestruction: true,
          };
        }
        if (result?.destroyed) {
          attackerWasDestroyed = true;
          const bdResult = await this.applyBattleDestroyEffect(
            target,
            attacker,
            {
              destroyedOwner: preDestroyedOwner,
              destroyedOwnerId: preDestroyedOwnerId,
              destroyedPosition: preDestroyedPosition,
            },
          );
          if (bdResult) battleDestroyResults.push(bdResult);
        }
      }

      logBattleDestroyCheck("tie - target destruction check");
      if (this.canDestroyByBattle(target, getBattleDestructionContext(target))) {
        const preDestroyedOwnerId = target.owner;
        const preDestroyedOwner =
          preDestroyedOwnerId === "player" ? this.player : this.bot;
        const preDestroyedPosition = target.position || null;
        const result = await this.destroyCard(target, {
          cause: "battle",
          sourceCard: attacker,
        });
        // If target destruction also needs selection, return it
        if (result?.needsSelection) {
          if (result?.destroyed) {
            targetWasDestroyed = true;
            queuePendingBattleDestroyAfterSelection(this, attacker, target, {
              destroyedOwner: preDestroyedOwner,
              destroyedOwnerId: preDestroyedOwnerId,
              destroyedPosition: preDestroyedPosition,
            });
          }
          this.markAttackUsed(attacker, target);
          this.clearAttackResolutionIndicators();
          clearDamageCalculationTempBuffs(this);
          this.updateBoard();
          await emitBattleCompleted();
          return {
            ok: true,
            needsSelection: true,
            selectionContract: result.selectionContract,
          };
        }
        if (result?.destroyed) {
          targetWasDestroyed = true;
          const bdResult = await this.applyBattleDestroyEffect(
            attacker,
            target,
            {
              destroyedOwner: preDestroyedOwner,
              destroyedOwnerId: preDestroyedOwnerId,
              destroyedPosition: preDestroyedPosition,
            },
          );
          if (bdResult) battleDestroyResults.push(bdResult);
        }
      }
      // Clear pending tie destruction if we completed successfully
      this.pendingTieDestruction = null;
      if (attackerWasDestroyed && targetWasDestroyed) {
        logBattleResult(
          `${attacker.name} and ${target.name} destroyed each other.`,
        );
      } else if (attackerWasDestroyed) {
        logBattleResult(`${attacker.name} was destroyed by ${target.name}.`);
      } else if (targetWasDestroyed) {
        logBattleResult(`${attacker.name} destroyed ${target.name}.`);
      } else {
        logBattleResult(
          `${attacker.name} and ${target.name} survived the battle.`,
        );
      }
    }
  } else {
    const defender = target.owner === "player" ? this.player : this.bot;
    if (attacker.atk > target.def) {
      if (attacker.piercing) {
        const damage = calculatePiercingDamage(attacker, attacker.atk, target.def);
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
      if (this.canDestroyByBattle(target, getBattleDestructionContext(target))) {
        const preDestroyedOwnerId = target.owner;
        const preDestroyedOwner =
          preDestroyedOwnerId === "player" ? this.player : this.bot;
        const preDestroyedPosition = target.position || null;
        const result = await this.destroyCard(target, {
          cause: "battle",
          sourceCard: attacker,
        });
        if (result?.needsSelection) {
          if (result?.destroyed) {
            targetWasDestroyed = true;
            queuePendingBattleDestroyAfterSelection(this, attacker, target, {
              destroyedOwner: preDestroyedOwner,
              destroyedOwnerId: preDestroyedOwnerId,
              destroyedPosition: preDestroyedPosition,
            });
          }
          this.markAttackUsed(attacker, target);
          this.clearAttackResolutionIndicators();
          clearDamageCalculationTempBuffs(this);
          this.updateBoard();
          await emitBattleCompleted();
          return {
            ok: true,
            needsSelection: true,
            selectionContract: result.selectionContract,
          };
        }
        if (result?.destroyed) {
          targetWasDestroyed = true;
          const bdResult = await this.applyBattleDestroyEffect(
            attacker,
            target,
            {
              destroyedOwner: preDestroyedOwner,
              destroyedOwnerId: preDestroyedOwnerId,
              destroyedPosition: preDestroyedPosition,
            },
          );
          if (bdResult) battleDestroyResults.push(bdResult);
        }
      }
      if (!attacker.piercing && targetWasDestroyed) {
        logBattleResult(`${attacker.name} destroyed ${target.name}.`);
      } else if (!attacker.piercing) {
        logBattleResult(`${target.name} was not destroyed by battle.`);
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
  clearDamageCalculationTempBuffs(this);
  this.updateBoard();
  const battleCompletedResult = await emitBattleCompleted();
  if (battleCompletedResult?.needsSelection && battleCompletedResult?.selectionContract) {
    return {
      ...battleCompletedResult,
      damageDealt: totalDamageDealt,
      targetDestroyed: targetWasDestroyed,
      attackerDestroyed: attackerWasDestroyed,
    };
  }
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
  if (!destroyed) {
    return { ok: true };
  }

  await presentBattleDestructionBeforeTriggers(this);

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
  const destroyedOwner =
    extras?.destroyedOwner ||
    (destroyed.owner === "player" ? this.player : this.bot);
  const attackerOwner = attacker.owner === "player" ? this.player : this.bot;
  const destroyedPosition =
    extras?.destroyedPosition || destroyed.position || null;
  const battleDestroyers = Array.isArray(extras?.battleDestroyers)
    ? extras.battleDestroyers.filter(Boolean)
    : attacker
      ? [attacker]
      : [];

  const emitResult = await this.emit("battle_destroy", {
    player: attackerOwner, // o dono do atacante (quem causou a destruição)
    opponent: destroyedOwner, // o jogador que perdeu o monstro
    attacker,
    battleDestroyer: battleDestroyers[0] || attacker || null,
    battleDestroyers,
    destroyed,
    destroyedOwner: destroyedOwner || extras?.destroyedOwner || null,
    destroyedOwnerId:
      extras?.destroyedOwnerId || destroyedOwner?.id || destroyed?.owner,
    attackerOwner,
    destroyedPosition,
  });

  return emitResult || { ok: true };
}
