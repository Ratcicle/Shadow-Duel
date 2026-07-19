/**
 * Summon execution - flip summon, fusion summon, special summon.
 * Extracted from Game.js as part of B.6 modularization.
 */

import { FAST_EFFECT_ORIGINS } from "../../chain/timing.js";
import { bumpCardLocationVersion } from "../../Card.js";
import {
  SUMMON_MODES,
  SUMMON_ORIGINS,
  SUMMON_STATUSES,
} from "./transaction.js";
import { checkSpecialSummonEligibility } from "./eligibility.js";

async function presentSummonBeforeAfterSummon(game) {
  const boardPresentation = game?.updateBoard?.();
  if (typeof game?.waitForBoardPresentation === "function") {
    await game.waitForBoardPresentation();
  } else if (boardPresentation && typeof boardPresentation.then === "function") {
    await boardPresentation.catch(() => {});
  }
}

/**
 * Perform a Flip Summon on a face-down monster.
 * @param {Object} card - The face-down monster to flip summon
 */
export async function flipSummon(card) {
  if (!this.canFlipSummon(card)) {
    return { success: false, reason: "flip_summon_unavailable" };
  }
  const ownerId = card.owner === "player" ? "player" : "bot";
  const owner = ownerId === "player" ? this.player : this.bot;
  const fieldIndex = owner?.field?.indexOf(card) ?? -1;
  const prepared = this.createPreparedSummon({
    card,
    controller: owner,
    sourceZone: "field",
    summonOrigin: SUMMON_ORIGINS.PROCEDURE,
    summonMode: SUMMON_MODES.SUMMON,
    summonMethod: "flip",
    position: "attack",
    finalContext: {
      type: "after_summon",
      event: "after_summon",
      card,
      player: owner,
      method: "flip",
    },
    perform: async (transaction) => {
      const currentIndex = owner.field.indexOf(card);
      if (currentIndex < 0) {
        return { success: false, reason: "flip_source_missing" };
      }
      owner.field.splice(currentIndex, 1);
      card.summonPending = true;
      this.effectEngine?.clearTargetingCache?.();

      const attempt = await this.offerSummonAttempt(card, owner, {
        method: "flip",
        fromZone: "field",
        summonOrigin: SUMMON_ORIGINS.PROCEDURE,
        summonTransaction: transaction,
      });
      if (attempt?.needsSelection) return attempt;

      if (
        attempt?.summonNegated ||
        transaction.status === SUMMON_STATUSES.NEGATED
      ) {
        owner.field.splice(Math.min(fieldIndex, owner.field.length), 0, card);
        delete card.summonPending;
        const outcome = transaction.negationOutcome || {};
        const moveResult = await this.moveCard(card, owner, outcome.destination || "graveyard", {
          fromZone: "field",
          contextLabel: "negated_flip_summon",
          wasDestroyed: outcome.destroyed === true,
          destroyCause: outcome.destroyed === true ? "effect" : null,
          destroySource: outcome.sourceCard || null,
          summonOrigin: SUMMON_ORIGINS.PROCEDURE,
          summonMethodOverride: "flip",
          summonProcedure: "flip",
          summonTransaction: transaction,
          awaitCardToGraveEvent: true,
          awaitCardMovedEvent: true,
        });
        return {
          success: false,
          summonNegated: true,
          reason: "summon_negated",
          moveResult,
        };
      }

      owner.field.splice(Math.min(fieldIndex, owner.field.length), 0, card);
      delete card.summonPending;
      card.isFacedown = false;
      card.revealedTurn = this.turnCounter;
      card.position = "attack";
      card.positionChangedThisTurn = true;
      card.hasAttacked = false;
      card.attacksUsedThisTurn = 0;
      this.effectEngine?.clearTargetingCache?.();
      const locationVersion = bumpCardLocationVersion(card);
      const atomicGroupId =
        this.chainSystem?.allocateAtomicEventGroupId?.() || null;
      this.chainSystem?.recordChainSourceMovement?.(card, {
        fromPlayer: owner,
        toPlayer: owner,
        fromZone: "field",
        toZone: "field",
        locationVersion,
        wasDestroyed: false,
      });
      await this.emit("card_moved", {
        card,
        player: owner,
        opponent: this.getOpponent?.(owner) || null,
        fromPlayer: owner,
        toPlayer: owner,
        fromZone: "field",
        toZone: "field",
        locationVersion,
        atomicGroupId,
        contextLabel: "flip_summon_success",
        summonId: transaction.summonId,
        summonOrigin: SUMMON_ORIGINS.PROCEDURE,
        wasDestroyed: false,
        wasFaceupBeforeMove: false,
      });
      this.ui.log(`${card.name} is Flip Summoned!`);
      this.updateBoard();
      await this.waitForBoardPresentation?.();
      const flipPresentation = this.ui?.applyFlipAnimation?.(ownerId, fieldIndex, {
        mode: "flip-summon",
        deferFrames: 0,
      });
      if (flipPresentation && typeof flipPresentation.then === "function") {
        await flipPresentation.catch(() => {});
      }
      await this.emit("after_summon", {
        card,
        player: owner,
        opponent: this.getOpponent?.(owner) || null,
        method: "flip",
        fromZone: "field",
        summonId: transaction.summonId,
        summonOrigin: SUMMON_ORIGINS.PROCEDURE,
        atomicGroupId,
      });
      this.updateBoard();
      return { success: true, card };
    },
    onFailure: async () => {
      if (!owner.field.includes(card)) {
        owner.field.splice(Math.min(fieldIndex, owner.field.length), 0, card);
      }
      delete card.summonPending;
    },
  });
  return await this.executeSummonTransaction(prepared);
}

export async function offerSummonAttempt(card, player, options = {}) {
  if (!card || !player) {
    return { ok: true };
  }
  let transaction =
    options.summonTransaction ||
    (this.activeSummonTransaction?.card === card
      ? this.activeSummonTransaction
      : null);
  let ownsTransaction = false;
  if (!transaction) {
    const begun = this.beginSummonTransaction(
      this.createPreparedSummon({
        card,
        controller: player,
        sourceZone: options.fromZone || null,
        summonOrigin: options.summonOrigin || SUMMON_ORIGINS.PROCEDURE,
        summonMode: SUMMON_MODES.SUMMON,
        summonMethod: options.method || "special",
        summonProcedure: options.summonProcedure || null,
        position: options.position || card.position || null,
      }),
    );
    if (!begun.ok) return { ok: false, reason: begun.reason };
    transaction = begun.transaction;
    ownsTransaction = true;
  }
  this.markSummonAwaitingNegation?.(transaction.summonId);
  if (!this.chainSystem || this.disableChains) {
    return { ok: true, transaction, ownsTransaction };
  }
  if (
    this.chainSystem.isChainResolving?.() ||
    this.chainSystem.isChainWindowOpen?.()
  ) {
    return {
      ok: false,
      reason: "summon_attempt_timing_busy",
      transaction,
      ownsTransaction,
    };
  }
  const context = {
    type: "summon_attempt",
    event: "summon_attempt",
    card,
    player,
    triggerPlayer: player,
    summonId: transaction.summonId,
    summonMethod: transaction.summonMethod,
    fromZone: transaction.sourceAtStart?.zone || options.fromZone || null,
    summonProcedure: transaction.summonProcedure,
    summonTransaction: transaction,
  };
  const timing = await this.chainSystem.runFastEffectTiming({
    origin: FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT,
    actionPlayer: player,
    context: {
      ...context,
      addTriggerToChain: false,
      skipTriggerLink: true,
    },
    pauseAfterRootResolution: true,
  });
  if (timing?.needsSelection) {
    return { ...timing, transaction, ownsTransaction };
  }
  this.holdSummonTimingState?.(transaction);
  if (
    transaction.status === SUMMON_STATUSES.NEGATED ||
    context.summonNegated === true
  ) {
    return {
      ok: false,
      summonNegated: true,
      reason: "summon_negated",
      transaction,
      ownsTransaction,
      timing,
    };
  }
  return { ok: true, transaction, ownsTransaction, timing };
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

  const result = await player.summon(
    cardIndex,
    position,
    isFacedown,
    tributeIndices,
  );
  return result;
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
    summonMethod: "fusion",
    summonProcedure: "fusion",
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

  const requiredNames = requiredMaterials.map((c) => c.name).join(", ");
  const extraNames = extraMaterials.map((c) => c.name).join(", ");
  const extraNote =
    extraMaterials.length > 0
      ? ` Extra materials also sent to GY: ${extraNames}.`
      : "";

  const prepared = this.createPreparedSummon({
    card: fusionMonster,
    controller: activePlayer,
    sourceZone: "extraDeck",
    summonOrigin: SUMMON_ORIGINS.EFFECT_RESOLUTION,
    summonMode: SUMMON_MODES.SUMMON,
    summonMethod: "fusion",
    summonProcedure: "fusion",
    position,
    costPayments: materialSendOrder.map((material) => ({
      card: material,
      owner: activePlayer,
      fromZone: activePlayer.field.includes(material)
        ? "field"
        : activePlayer.hand.includes(material)
          ? "hand"
          : this.findCardZone?.(activePlayer, material) || null,
      toZone: "graveyard",
      kind: "fusion_material",
      contextLabel: "fusion_material",
      options: {
        awaitCardToGraveEvent: true,
        awaitCardMovedEvent: true,
      },
    })),
    perform: async (transaction) => {
      const postMaterialLimitCheck = this.canPlaceCardOnField?.(
        fusionMonster,
        activePlayer,
        {
          isFacedown: false,
          summonMethod: "fusion",
          summonProcedure: "fusion",
        },
      );
      if (postMaterialLimitCheck && postMaterialLimitCheck.ok === false) {
        return { success: false, reason: "field_limit_after_materials" };
      }
      const moveResult = await this.moveCard(
        fusionMonster,
        activePlayer,
        "field",
        {
          fromZone: "extraDeck",
          position,
          isFacedown: false,
          resetAttackFlags: true,
          summonMethodOverride: "fusion",
          summonProcedure: "fusion",
          summonOrigin: SUMMON_ORIGINS.EFFECT_RESOLUTION,
          summonTransaction: transaction,
          contextLabel: "fusion_summon",
          awaitCardMovedEvent: true,
        },
      );
      if (moveResult?.success !== false) {
        this.ui.log(
          `Fusion Summoned ${fusionMonster.name} using ${
            requiredNames || "selected materials"
          }.${extraNote}`,
        );
      }
      return moveResult;
    },
  });
  const result = await this.executeSummonTransaction(prepared);
  this.updateBoard();
  return result?.success === true;
}

/**
 * Perform a Special Summon from hand (e.g., from Eel effect).
 * @param {number} handIndex - Index in player's hand
 * @param {string} position - "attack" or "defense"
 */
export async function performSpecialSummon(handIndex, position, actor = this.player) {
  const player = actor || this.player;
  const card = player.hand[handIndex];
  if (!card) return;

  const eligibility = checkSpecialSummonEligibility(card, {
    summonProcedure: "card_effect",
    fromZone: "hand",
  });
  if (!eligibility.ok) {
    this.ui?.log?.(`${card.name} cannot be Special Summoned this way.`);
    return;
  }

  const limitCheck = this.canPlaceCardOnField?.(card, player, {
    isFacedown: false,
    summonMethod: "special",
  });
  if (limitCheck && limitCheck.ok === false) {
    return;
  }

  const prepared = this.createPreparedSummon({
    card,
    controller: player,
    sourceZone: "hand",
    summonOrigin: SUMMON_ORIGINS.EFFECT_RESOLUTION,
    summonMode: SUMMON_MODES.SUMMON,
    summonMethod: "special",
    summonProcedure: "card_effect",
    position,
    perform: async (transaction) => {
      const moveResult = await this.moveCard(card, player, "field", {
        fromZone: "hand",
        position,
        isFacedown: false,
        resetAttackFlags: true,
        summonMethodOverride: "special",
        summonProcedure: "card_effect",
        summonOrigin: SUMMON_ORIGINS.EFFECT_RESOLUTION,
        summonTransaction: transaction,
        sourceCard: this.currentEffectContext?.source || null,
        effectId: this.currentEffectContext?.effect?.id || null,
        contextLabel: "effect_special_summon",
        awaitCardMovedEvent: true,
      });
      if (moveResult?.success !== false) {
        card.cannotAttackThisTurn = true;
        this.ui.log(`Special Summoned ${card.name} from hand.`);
      }
      return moveResult;
    },
  });
  const result = await this.executeSummonTransaction(prepared);

  // Clear pending special summon and unlock actions
  this.pendingSpecialSummon = null;
  this.isResolvingEffect = false;

  // Remove highlight from all hand cards
  if (this.ui && typeof this.ui.applyHandTargetableIndices === "function") {
    this.ui.applyHandTargetableIndices("player", []);
  }

  this.updateBoard();
  return result;
}
