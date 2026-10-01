/**
 * lifecycle.js
 *
 * Turn lifecycle methods extracted from Game.js.
 * Handles starting and ending turns.
 *
 * Methods:
 * - startTurn
 * - endTurn
 * - waitForPhaseDelay
 */

import { isAI } from "../../Player.js";
import { botLogger } from "../../BotLogger.js";
import type { FullGameHost, GamePlayer } from "../../contracts/gameRuntime.js";
import type { DrawCardsResult } from "../deck/draw.js";
import type { ActionGuardResult } from "../actions/guard.js";
import {
  enterPhase,
  leaveCurrentPhase,
  phaseWorkIsPending,
  type PhaseTransitionHost,
} from "./transitions.js";

interface AiMoveCapability {
  makeMove(game: LifecycleHost): unknown;
}

interface LifecycleProgressTracker {
  recordProgress?(label: string, game: LifecycleHost, detail?: unknown): void;
}

type LifecycleHost = PhaseTransitionHost &
  Pick<FullGameHost, "phaseDelayMs" | "effectEngine"> & {
  _arenaTracker?: LifecycleProgressTracker | null;
  devLog?(code: string, detail?: unknown): void;
  resetOncePerTurnUsage(reason?: string): void;
  cleanupExpiredBuffs(): void;
  cleanupExpiredDeclaredValues?(): void;
  cleanupExpiredEffectMarkers?(): void;
  cleanupExpiredTemporaryBattlePairEffects?(): void;
  cleanupExpiredTemporaryEventEffects?(): void;
  cleanupExpiredSpecialSummonRestrictions?(): void;
  cleanupExpiredEffectActivationRestrictions?(): void;
  drawCards(player: GamePlayer, count?: number): DrawCardsResult;
  waitForPhaseDelay(): Promise<void>;
  guardActionStart(
    options: { actor: GamePlayer; kind: "phase_change" },
    logToRenderer?: boolean,
  ): ActionGuardResult;
  processTemporaryControlEffects?(): Promise<unknown>;
  cleanupTempBoosts(player: GamePlayer): void;
  startTurn(): Promise<unknown>;
  skipToPhase(phase: "end"): Promise<unknown>;
};

function hasAiMove(actor: GamePlayer): actor is GamePlayer & AiMoveCapability {
  return typeof Reflect.get(actor, "makeMove") === "function";
}

function getErrorMessage(error: unknown): string {
  if (
    (typeof error === "object" && error !== null) ||
    typeof error === "function"
  ) {
    const message = Reflect.get(error, "message");
    if (message) return message as string;
  }
  return String(error);
}

function scheduleAiMoveAfterPaint(game: LifecycleHost, actor: GamePlayer) {
  if (
    !isAI(actor) ||
    game.gameOver ||
    game.isDisposed?.() ||
    !hasAiMove(actor)
  ) {
    return;
  }

  game._arenaTracker?.recordProgress?.("ai_move_scheduled", game, {
    actor: actor?.id || null,
  });
  const expectedTurn = game.turn;
  const expectedPhase = game.phase;
  const runMove = () => {
    if (
      game.isDisposed?.() ||
      game.gameOver ||
      game.turn !== expectedTurn ||
      game.phase !== expectedPhase
    ) {
      return;
    }
    game._arenaTracker?.recordProgress?.("ai_move_before_makeMove", game, {
      actor: actor?.id || null,
      expectedPhase,
    });
    try {
      Promise.resolve(actor.makeMove(game))
        .then(() => {
          game._arenaTracker?.recordProgress?.("ai_move_after_makeMove", game, {
            actor: actor?.id || null,
          });
        })
        .catch((error: unknown) => {
          game._arenaTracker?.recordProgress?.("ai_move_makeMove_error", game, {
            actor: actor?.id || null,
            error: getErrorMessage(error),
          });
          console.error("[BotArena:progress] AI makeMove failed:", error);
        });
    } catch (error: unknown) {
      game._arenaTracker?.recordProgress?.("ai_move_makeMove_error", game, {
        actor: actor?.id || null,
        error: getErrorMessage(error),
      });
      throw error;
    }
  };

  const requestFrame = globalThis.requestAnimationFrame;
  if (typeof requestFrame === "function") {
    requestFrame(() => setTimeout(runMove, 0));
    return;
  }

  setTimeout(runMove, 0);
}

/**
 * Starts a new turn for the active player.
 * Handles draw phase, standby phase, and transitions to main1.
 */
export async function startTurn(this: LifecycleHost) {
  if (this.gameOver || this.isDisposed?.()) return;
  this.turnCounter += 1;
  this._arenaTracker?.recordProgress?.("turn_start", this);

  const activePlayerName =
    (this.turn === "player" ? this.player : this.bot)?.name || this.turn;
  this.devLog?.("TURN_START", {
    summary: `Turn ${this.turnCounter}: ${activePlayerName}`,
    turn: this.turnCounter,
    player: this.turn,
    playerName: activePlayerName,
  });

  this.resetOncePerTurnUsage("start_turn");
  this.player.lpGainedThisTurn = 0;
  this.bot.lpGainedThisTurn = 0;
  this.player.damageReceivedThisTurn = 0;
  this.bot.damageReceivedThisTurn = 0;
  this.player.directAttacksDeclaredThisTurn = 0;
  this.bot.directAttacksDeclaredThisTurn = 0;

  // Clean up expired turn-based buffs at the start of the turn
  this.cleanupExpiredBuffs();
  this.cleanupExpiredDeclaredValues?.();
  this.cleanupExpiredEffectMarkers?.();
  this.cleanupExpiredTemporaryBattlePairEffects?.();
  this.cleanupExpiredTemporaryEventEffects?.();
  this.cleanupExpiredSpecialSummonRestrictions?.();
  this.cleanupExpiredEffectActivationRestrictions?.();

  // Limpar cache de targeting para novo turno
  if (this.effectEngine?.clearTargetingCache) {
    this.effectEngine.clearTargetingCache();
  }

  const activePlayer = this.turn === "player" ? this.player : this.bot;
  activePlayer.forbidDirectAttacksThisTurn = false;
  activePlayer.field.forEach((card) => {
    card.hasAttacked = false;
    card.attacksUsedThisTurn = 0;
    card.positionChangedThisTurn = false;
    card.canMakeSecondAttackThisTurn = false;
    card.secondAttackUsedThisTurn = false;

    const shouldRestrictAttack =
      card.cannotAttackUntilTurn &&
      this.turnCounter <= card.cannotAttackUntilTurn;
    Reflect.set(card, "cannotAttackThisTurn", shouldRestrictAttack);

    if (!shouldRestrictAttack && card.cannotAttackUntilTurn) {
      card.cannotAttackUntilTurn = null;
    }
    if (
      card.immuneToOpponentEffectsUntilTurn &&
      this.turnCounter > card.immuneToOpponentEffectsUntilTurn
    ) {
      card.immuneToOpponentEffectsUntilTurn = null;
    }
  });
  for (const player of [this.player, this.bot]) {
    player.summonCount = 0;
    player.additionalNormalSummons = 0;
    player.additionalNormalSummonPermissions = [];
    player.normalSummonsThisTurn = [];
  }

  const drawEntry = await enterPhase(this, "draw", null);
  if (!drawEntry.ok) return drawEntry;
  this._arenaTracker?.recordProgress?.("turn_draw_before", this, {
    actor: activePlayer?.id || this.turn,
    deckSize: activePlayer?.deck?.length || 0,
    handSize: activePlayer?.hand?.length || 0,
  });
  const drawResult = this.drawCards(activePlayer, 1);
  this._arenaTracker?.recordProgress?.("turn_draw_result", this, {
    actor: activePlayer?.id || this.turn,
    ok: drawResult?.ok === true,
    reason: drawResult?.reason || null,
    nonFatal: drawResult?.nonFatal === true,
    drawnCount: drawResult?.drawn?.length || 0,
    deckSize: activePlayer?.deck?.length || 0,
    handSize: activePlayer?.hand?.length || 0,
  });
  if (this.gameOver || this.isDisposed?.()) return;
  this._arenaTracker?.recordProgress?.("turn_draw_after", this, {
    actor: activePlayer?.id || this.turn,
    deckSize: activePlayer?.deck?.length || 0,
    handSize: activePlayer?.hand?.length || 0,
  });
  this.updateBoard();
  const drawTiming = await this.checkAndOfferTraps("normal_draw", {
    player: activePlayer,
    drawn: drawResult?.drawn || [],
    currentPhase: "draw",
    phase: "draw",
  });
  if (phaseWorkIsPending(this, drawTiming) || this.gameOver || this.isDisposed?.())
    return;
  const drawPhaseEnd = await leaveCurrentPhase(this, {
    nextPhase: "standby", renewAfterChain: true,
  });
  if (!drawPhaseEnd.ok) return drawPhaseEnd;
  if (this.gameOver || this.isDisposed?.()) return;
  await this.waitForPhaseDelay();
  if (this.gameOver || this.isDisposed?.() || phaseWorkIsPending(this)) return;

  const standbyEntry = await enterPhase(this, "standby", "draw");
  if (!standbyEntry.ok) return standbyEntry;
  await this.waitForPhaseDelay();
  if (this.gameOver || this.isDisposed?.() || phaseWorkIsPending(this)) return;
  const standbyPhaseEnd = await leaveCurrentPhase(this, {
    nextPhase: "main1", renewAfterChain: true,
  });
  if (!standbyPhaseEnd.ok) return standbyPhaseEnd;
  if (this.gameOver || this.isDisposed?.()) return;

  const mainEntry = await enterPhase(this, "main1", "standby");
  if (!mainEntry.ok) return mainEntry;
  this._arenaTracker?.recordProgress?.("main1_ready", this, {
    actor: activePlayer?.id || this.turn,
  });

  // 📊 Log de transição para main1
  if (botLogger && isAI(activePlayer)) {
    botLogger.logPhaseTransition(
      activePlayer.id || "bot",
      this.turnCounter,
      "standby",
      "main1",
      0,
      0,
    );
  }

  scheduleAiMoveAfterPaint(this, activePlayer);
  return undefined;
}

/**
 * Ends the current turn and starts the opponent's turn.
 */
export async function endTurn(this: LifecycleHost) {
  if (this.gameOver || this.isDisposed?.()) return;
  const actor = this.turn === "player" ? this.player : this.bot;
  const guard = this.guardActionStart(
    { actor, kind: "phase_change" },
    actor === this.player,
  );
  if (!guard.ok) return guard;

  if (this.phase !== "end") return await this.skipToPhase("end");
  const leaveResult = await leaveCurrentPhase(this, { nextPhase: null });
  if (!leaveResult.ok) {
    if (leaveResult.reason === "phase_transition_interrupted") {
      scheduleAiMoveAfterPaint(this, actor);
    }
    return leaveResult;
  }

  // Control-change effects expire after End Phase triggers finish. This keeps
  // the returned monster in the same field zone and does not fabricate a
  // movement or summon event.
  await this.processTemporaryControlEffects?.();
  if (this.gameOver || this.isDisposed?.() || phaseWorkIsPending(this)) return;

  await this.processDelayedActions("end", this.turn);
  if (this.gameOver || this.isDisposed?.() || phaseWorkIsPending(this)) return;

  this.cleanupTempBoosts(this.player);
  this.cleanupTempBoosts(this.bot);
  this.player.forbidDirectAttacksThisTurn = false;
  this.bot.forbidDirectAttacksThisTurn = false;
  this.player.directAttacksDeclaredThisTurn = 0;
  this.bot.directAttacksDeclaredThisTurn = 0;

  // Clear all attack indicators at end of turn
  this.clearAttackResolutionIndicators();
  this.clearAttackReadyIndicators();
  this.battleStep = null;

  this.turn = this.turn === "player" ? "bot" : "player";
  await this.startTurn();
  return undefined;
}

/**
 * Waits for a configurable delay between phases.
 * @returns {Promise<void>}
 */
export function waitForPhaseDelay(this: LifecycleHost): Promise<void> {
  if (this.isDisposed?.()) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, this.phaseDelayMs || 0));
}
