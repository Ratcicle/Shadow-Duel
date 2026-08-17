/**
 * Summon execution - flip summon, fusion summon, special summon.
 * Extracted from Game.js as part of B.6 modularization.
 */

import { FAST_EFFECT_ORIGINS } from "../../chain/timing.js";
import { bumpCardLocationVersion } from "../../Card.js";
import {
  hasChainSourceMovementCapability,
  type ChainOperationResult,
  type ChainRuntimePort,
} from "../../contracts/chainRuntime.js";
import type { BattlePosition, GameCard } from "../../contracts/cards.js";
import type {
  MaybePromise,
  MoveCardOptions,
  MoveCardResult,
  PreparedSummon,
  PreparedSummonInput,
  SummonExecutionResult,
  SummonTransaction,
} from "../../contracts/gameRuntime.js";
import type { GamePlayer } from "../../contracts/player.js";
import type { CanonicalZone } from "../../contracts/zones.js";
import {
  SUMMON_MODES,
  SUMMON_ORIGINS,
  SUMMON_STATUSES,
} from "./transaction.js";
import { checkSpecialSummonEligibility } from "./eligibility.js";

interface ExecutionEffectEnginePort {
  clearTargetingCache?(): void;
}

interface ExecutionUiPort {
  log(message: string): void;
  applyFlipAnimation?(
    ownerId: "player" | "bot",
    fieldIndex: number,
    options: { mode: "flip-summon"; deferFrames: number },
  ): MaybePromise<unknown>;
  applyHandTargetableIndices?(ownerId: "player", indices: number[]): void;
}

interface SummonAttemptOptions {
  summonTransaction?: SummonTransaction | null;
  fromZone?: CanonicalZone | "token" | null;
  summonOrigin?: PreparedSummonInput["summonOrigin"];
  method?: PreparedSummonInput["summonMethod"];
  summonProcedure?: PreparedSummonInput["summonProcedure"];
  position?: BattlePosition | null;
}

interface SummonAttemptSharedResult extends Omit<ChainOperationResult, "needsSelection"> {
  ok?: boolean;
  summonNegated?: boolean;
  transaction?: SummonTransaction;
  ownsTransaction?: boolean;
  timing?: ChainOperationResult | null;
}

interface SummonAttemptSelectionResult extends SummonAttemptSharedResult {
  needsSelection: true;
  transaction: SummonTransaction;
  ownsTransaction: boolean;
}

interface SummonAttemptCompletionResult extends SummonAttemptSharedResult {
  needsSelection?: false;
}

type SummonAttemptResult =
  | SummonAttemptSelectionResult
  | SummonAttemptCompletionResult;

type SummonPerformResult =
  | SummonExecutionResult
  | SummonAttemptSelectionResult
  | boolean
  | null
  | undefined;

interface ExecutionPreparedSummonInput
  extends Omit<PreparedSummonInput, "perform"> {
  perform?: (
    transaction: SummonTransaction,
  ) => MaybePromise<SummonPerformResult>;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return false;
  }
  return typeof Reflect.get(value, "then") === "function";
}

interface SummonAttemptContext {
  type: "summon_attempt";
  event: "summon_attempt";
  card: GameCard;
  player: GamePlayer;
  triggerPlayer: GamePlayer;
  summonId: SummonTransaction["summonId"];
  summonMethod: SummonTransaction["summonMethod"];
  fromZone: CanonicalZone | "token" | null;
  summonProcedure: SummonTransaction["summonProcedure"];
  summonTransaction: SummonTransaction;
  summonNegated?: boolean;
}

interface ExecutionHost {
  player: GamePlayer;
  bot: GamePlayer;
  turnCounter: number;
  disableChains: boolean;
  pendingSpecialSummon: unknown;
  isResolvingEffect: boolean;
  activeSummonTransaction: SummonTransaction | null;
  chainSystem: ChainRuntimePort;
  effectEngine: ExecutionEffectEnginePort;
  ui: ExecutionUiPort;
  currentEffectContext?: {
    source?: GameCard | null;
    effect?: { id?: string | null } | null;
  } | null;
  canFlipSummon(card: GameCard): boolean;
  createPreparedSummon(
    input?: PreparedSummonInput | ExecutionPreparedSummonInput,
  ): PreparedSummon;
  beginSummonTransaction(input: PreparedSummon):
    | { ok: false; reason: string }
    | { ok: true; transaction: SummonTransaction };
  executeSummonTransaction(
    input: PreparedSummon,
  ): Promise<SummonExecutionResult>;
  markSummonAwaitingNegation?(summonId: SummonTransaction["summonId"]): unknown;
  holdSummonTimingState?(transaction: SummonTransaction): void;
  offerSummonAttempt(
    card: GameCard,
    player: GamePlayer,
    options?: SummonAttemptOptions,
  ): Promise<SummonAttemptResult>;
  canPlaceCardOnField?(
    card: GameCard,
    player: GamePlayer,
    options: MoveCardOptions,
  ): { ok?: boolean; reason?: string; code?: string };
  findCardZone?(player: GamePlayer, card: GameCard): CanonicalZone | null;
  moveCard(
    card: GameCard,
    player: GamePlayer,
    zone: CanonicalZone,
    options?: MoveCardOptions,
  ): MaybePromise<MoveCardResult | SummonExecutionResult>;
  emit(eventName: string, payload: unknown): Promise<unknown>;
  getOpponent?(player: GamePlayer): GamePlayer | null;
  updateBoard(): MaybePromise<unknown>;
  waitForBoardPresentation?(): Promise<unknown>;
}

async function presentSummonBeforeAfterSummon(game: ExecutionHost) {
  const boardPresentation = game?.updateBoard?.();
  if (typeof game?.waitForBoardPresentation === "function") {
    await game.waitForBoardPresentation();
  } else if (isPromiseLike(boardPresentation)) {
    await (boardPresentation as Promise<unknown>).catch(() => {});
  }
}

/**
 * Perform a Flip Summon on a face-down monster.
 * @param card - The face-down monster to flip summon
 */
export async function flipSummon(
  this: ExecutionHost,
  card: GameCard,
): Promise<SummonExecutionResult> {
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
    perform: async (transaction: SummonTransaction) => {
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
      const chainSystem = this.chainSystem;
      const atomicGroupId =
        chainSystem?.allocateAtomicEventGroupId?.() || null;
      if (hasChainSourceMovementCapability(chainSystem)) {
        const movement = {
          fromPlayer: owner,
          toPlayer: owner,
          fromZone: "field",
          toZone: "field" as const,
          locationVersion,
          wasDestroyed: false,
        };
        chainSystem.recordChainSourceMovement(card, movement);
      }
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
      if (isPromiseLike(flipPresentation)) {
        await (flipPresentation as Promise<unknown>).catch(() => {});
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

export async function offerSummonAttempt(
  this: ExecutionHost,
  card: GameCard | null | undefined,
  player: GamePlayer | null | undefined,
  options: SummonAttemptOptions = {},
): Promise<SummonAttemptResult> {
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
  const context: SummonAttemptContext = {
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
    return {
      ...timing,
      needsSelection: true,
      transaction,
      ownsTransaction,
    };
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
  this: ExecutionHost,
  actor: GamePlayer | null,
  cardIndex: number,
  position: BattlePosition = "attack",
  isFacedown = false,
  tributeIndices: readonly number[] | null = null,
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
 * @param player - Player performing the summon
 * @returns {boolean} Success status
 */
export async function performFusionSummon(
  this: ExecutionHost,
  materials: GameCard[],
  fusionMonsterIndex: number,
  position: BattlePosition = "attack",
  requiredSubset: GameCard[] | null = null,
  player: GamePlayer | null = null,
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
  const hasFieldToGraveTrigger = (card: GameCard) =>
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
    perform: async (transaction: SummonTransaction) => {
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
export async function performSpecialSummon(
  this: ExecutionHost,
  handIndex: number,
  position: BattlePosition,
  actor: GamePlayer = this.player,
) {
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
    perform: async (transaction: SummonTransaction) => {
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
