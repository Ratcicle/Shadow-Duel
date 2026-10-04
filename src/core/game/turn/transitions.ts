/**
 * transitions.js
 *
 * Phase transition methods extracted from Game.js.
 * Handles advancing through game phases.
 *
 * Methods:
 * - nextPhase
 * - skipToPhase
 */

import { isAI } from "../../Player.js";
import {
  PHASE_ORDER,
  getNextPhase,
  normalizeTargetPhase,
} from "./phaseRules.js";
import type { FullGameHost, GamePlayer } from "../../contracts/gameRuntime.js";
import type { GamePhase } from "../../contracts/game.js";
import type { ActionGuardResult } from "../actions/guard.js";
import type { PlayerId } from "../../contracts/primitives.js";

interface AiMoveCapability {
  makeMove(game: TransitionHost): unknown;
}

interface PhaseTimingResult {
  phaseTransitionAllowed?: boolean;
  phaseTransitionInterrupted?: boolean;
  needsSelection?: boolean;
  deferred?: boolean;
}

export type PhaseTransitionHost = Pick<
  FullGameHost,
  | "player"
  | "bot"
  | "turn"
  | "phase"
  | "turnCounter"
  | "gameOver"
  | "battleStep"
  | "selectionState"
  | "targetSelection"
  | "isResolvingEffect"
  | "eventResolutionDepth"
  | "pendingTributeSummonSelection"
  | "chainSystem"
> & {
  pendingTributeSummonSelection: { active?: boolean } | null;
  isDisposed?(): boolean;
  getNextPhase?(phase: GamePhase): GamePhase | null;
  checkAndOfferTraps(
    event: string,
    context: unknown,
  ): Promise<PhaseTimingResult | null>;
  clearAttackResolutionIndicators(): void;
  clearAttackReadyIndicators(): void;
  updateBoard(): unknown;
  processDelayedActions(phase: string, activePlayer: PlayerId): Promise<void>;
  emit(event: string, payload: unknown): Promise<unknown>;
};

type TransitionHost = PhaseTransitionHost &
  Pick<FullGameHost, "ui" | "aiActionDelayMs"> & {
  guardActionStart(
    options: { actor: GamePlayer; kind: "phase_change" },
    logToRenderer?: boolean,
  ): ActionGuardResult;
  nextPhase(): Promise<unknown>;
  endTurn(): Promise<unknown>;
  notify(event: "phase_skip", payload: unknown): unknown;
};

// A blocked request owns one retry, scoped to its actor and phase occurrence.
// Reset/dispose cancel it explicitly, including restarts with identical counters.
const phaseRetries = new WeakMap<object, { timer: ReturnType<typeof setTimeout>; isCurrent(): boolean }>();

export function cancelPendingPhaseRetry(game: object): void {
  const pending = phaseRetries.get(game);
  if (pending) clearTimeout(pending.timer);
  phaseRetries.delete(game);
}

function schedulePhaseRetry(game: TransitionHost, actor: GamePlayer): void {
  if (phaseRetries.get(game)?.isCurrent()) return;
  cancelPendingPhaseRetry(game);
  const turn = game.turn, phase = game.phase, counter = game.turnCounter;
  const isCurrent = () => !game.isDisposed?.() && !game.gameOver && isAI(actor) &&
    game.turn === turn && game.phase === phase && game.turnCounter === counter &&
    (game.turn === "player" ? game.player : game.bot) === actor;
  const delay = typeof game.aiActionDelayMs === "number" && Number.isFinite(game.aiActionDelayMs)
    ? game.aiActionDelayMs : 250;
  const pending = { isCurrent, timer: setTimeout(() => {
    if (phaseRetries.get(game) !== pending) return;
    phaseRetries.delete(game);
    if (isCurrent()) void game.nextPhase();
  }, delay) };
  phaseRetries.set(game, pending);
}

interface PhaseLeaveSuccess {
  ok: true;
  currentPhase: GamePhase;
  nextPhase: GamePhase | null;
}

interface PhaseLeaveFailure {
  ok: false;
  reason: string;
  currentPhase?: GamePhase;
  timingResult?: PhaseTimingResult;
}

type PhaseLeaveResult = PhaseLeaveSuccess | PhaseLeaveFailure;

function hasAiMove(actor: GamePlayer): actor is GamePlayer & AiMoveCapability {
  return typeof Reflect.get(actor, "makeMove") === "function";
}

function scheduleAiMoveAfterPaint(game: TransitionHost, actor: GamePlayer) {
  if (
    !isAI(actor) ||
    game.gameOver ||
    game.isDisposed?.() ||
    !hasAiMove(actor)
  ) {
    return;
  }

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
    actor.makeMove(game);
  };

  const requestFrame = globalThis.requestAnimationFrame;
  if (typeof requestFrame === "function") {
    requestFrame(() => setTimeout(runMove, 0));
    return;
  }

  setTimeout(runMove, 0);
}

function hasPendingPhaseInterruption(game: PhaseTransitionHost) {
  const selectionState = game.selectionState || "idle";
  return (
    !!game.targetSelection ||
    selectionState === "selecting" ||
    selectionState === "confirming" ||
    selectionState === "resolving" ||
    game.isResolvingEffect ||
    game.pendingTributeSummonSelection?.active === true ||
    game.eventResolutionDepth > 0 ||
    game.chainSystem?.isChainResolving?.() ||
    game.chainSystem?.isChainWindowOpen?.()
  );
}

function setBattleOpenStateForPhase(game: PhaseTransitionHost, phase: GamePhase) {
  if (phase === "battle") {
    game.battleStep = "start";
    return;
  }
  game.battleStep = null;
}

async function negotiatePhaseExit(
  game: PhaseTransitionHost,
  options: { nextPhase?: GamePhase | null } = {},
): Promise<PhaseLeaveResult> {
  const currentPhase = game.phase;
  const currentTurn = game.turn;
  const previousBattleStep = game.battleStep ?? null;
  const nextPhase =
    options.nextPhase ??
    game.getNextPhase?.(currentPhase) ??
    getNextPhase(currentPhase, game);
  if (currentPhase === "battle") {
    game.battleStep = "end";
  }

  const timingResult = await game.checkAndOfferTraps("phase_end", {
    currentPhase,
    nextPhase,
    fromPhase: currentPhase,
    toPhase: nextPhase,
    battleStep: game.battleStep ?? null,
    damageStepTiming: null,
  });

  if (game.gameOver || game.isDisposed?.()) {
    return { ok: false, reason: "duel_stopped" };
  }

  if (game.phase !== currentPhase || game.turn !== currentTurn) {
    return {
      ok: false,
      reason: "phase_changed_during_phase_end",
      currentPhase: game.phase,
    };
  }

  if (phaseWorkIsPending(game, timingResult)) {
    return { ok: false, reason: "phase_window_pending", currentPhase };
  }

  if (
    timingResult &&
    (timingResult.phaseTransitionAllowed !== true ||
      timingResult.phaseTransitionInterrupted === true)
  ) {
    if (currentPhase === "battle" && timingResult.needsSelection !== true) {
      game.battleStep = previousBattleStep;
    }
    return {
      ok: false,
      reason: "phase_transition_interrupted",
      timingResult,
      currentPhase,
    };
  }

  if (currentPhase === "battle") {
    game.clearAttackResolutionIndicators();
    game.clearAttackReadyIndicators();
  }

  return { ok: true, currentPhase, nextPhase };
}

/** Returned pending work matters even when its selection has not been installed yet. */
export function phaseWorkIsPending(
  game: PhaseTransitionHost,
  result?: unknown,
): boolean {
  return (
    hasPendingPhaseInterruption(game) ||
    (typeof result === "object" && result !== null &&
      (Reflect.get(result, "needsSelection") === true ||
        Reflect.get(result, "deferred") === true))
  );
}

/** All phase exits share timing, live-work checks and Battle Step cleanup. */
export async function leaveCurrentPhase(
  game: PhaseTransitionHost,
  options: { nextPhase?: GamePhase | null; renewAfterChain?: boolean } = {},
): Promise<PhaseLeaveResult> {
  while (true) {
    if (phaseWorkIsPending(game)) {
      return { ok: false, reason: "phase_window_pending" };
    }
    const result = await negotiatePhaseExit(game, options);
    if (
      result.ok ||
      options.renewAfterChain !== true ||
      result.reason !== "phase_transition_interrupted" ||
      result.timingResult?.phaseTransitionInterrupted !== true
    ) {
      return result;
    }
    // Automatic Draw/Standby progression renews only a settled Chain's intent.
    // Human and AI action commands instead return to their ordinary open state.
  }
}

/** Phase-specific entry work belongs here so shortcuts cannot omit its events. */
export async function enterPhase(
  game: PhaseTransitionHost,
  nextPhase: GamePhase,
  previousPhase: GamePhase | null,
) {
  cancelPendingPhaseRetry(game);
  const currentTurn = game.turn;
  const player = currentTurn === "player" ? game.player : game.bot;
  const opponent = player === game.player ? game.bot : game.player;
  game.phase = nextPhase;
  setBattleOpenStateForPhase(game, nextPhase);
  game.updateBoard();

  const result = await game.checkAndOfferTraps("phase_start", {
    currentPhase: nextPhase,
    previousPhase,
    fromPhase: previousPhase,
    toPhase: nextPhase,
    player,
    battleStep: game.battleStep ?? null,
    damageStepTiming: null,
  });

  const stopped = (outcome?: unknown): PhaseLeaveFailure | null => {
    if (game.gameOver || game.isDisposed?.()) {
      return { ok: false, reason: "duel_stopped" };
    }
    if (game.phase !== nextPhase || game.turn !== currentTurn) {
      return {
        ok: false,
        reason: "phase_changed_during_phase_start",
        currentPhase: game.phase,
      };
    }
    if (phaseWorkIsPending(game, outcome)) {
      return { ok: false, reason: "phase_window_pending" };
    }
    return null;
  };
  const startFailure = stopped(result);
  if (startFailure) return startFailure;

  if (nextPhase === "standby") {
    await game.processDelayedActions("standby", currentTurn);
    const delayedFailure = stopped();
    if (delayedFailure) return delayedFailure;
    game.updateBoard();
  }
  if (nextPhase === "standby" || nextPhase === "end") {
    // The phase has already changed: renewed exit intent cannot repeat entry
    // triggers, including when their human selection interrupted progression.
    const eventResult = await game.emit(
      nextPhase === "end" ? "end_phase" : "standby_phase",
      { player, opponent },
    );
    const eventFailure = stopped(eventResult);
    if (eventFailure) return eventFailure;
  }

  if (nextPhase === "battle" && game.battleStep === "start") {
    game.battleStep = "battle";
  }
  return { ok: true as const };
}

/**
 * Advances to the next phase in the turn order.
 * Phase order: draw → standby → main1 → battle → main2 → end
 */
export async function nextPhase(
  this: TransitionHost,
  options: { retryOnBlocked?: boolean } = {},
) {
  if (this.gameOver || this.isDisposed?.()) return;
  const actor = this.turn === "player" ? this.player : this.bot;
  const guard = this.guardActionStart(
    { actor, kind: "phase_change" },
    actor === this.player,
  );
  if (!guard.ok) {
    if (
      options.retryOnBlocked !== false && isAI(actor) &&
      (guard.code === "BLOCKED_RESOLVING" ||
        guard.code === "BLOCKED_SELECTION_ACTIVE")
    ) {
      schedulePhaseRetry(this, actor);
    }
    return guard;
  }

  cancelPendingPhaseRetry(this);
  const next = this.getNextPhase?.(this.phase) ?? getNextPhase(this.phase, this);
  if (!next) return await this.endTurn();
  const leaveResult = await leaveCurrentPhase(this, { nextPhase: next });
  if (!leaveResult.ok) {
    if (leaveResult.reason === "phase_transition_interrupted" && isAI(actor)) {
      scheduleAiMoveAfterPaint(this, actor);
    }
    return leaveResult;
  }

  const enterResult = await enterPhase(this, next, leaveResult.currentPhase);
  if (!enterResult.ok) return enterResult;

  scheduleAiMoveAfterPaint(this, actor);
  return undefined;
}

/**
 * Skips directly to a target phase.
 * Can only skip forward, not backward.
 * @param {string} targetPhase - The phase to skip to
 */
export async function skipToPhase(
  this: TransitionHost,
  targetPhase: GamePhase | string,
) {
  if (this.gameOver || this.isDisposed?.()) return;
  const actor = this.turn === "player" ? this.player : this.bot;
  const guard = this.guardActionStart(
    { actor, kind: "phase_change" },
    actor === this.player,
  );
  if (!guard.ok) return guard;
  const normalized = normalizeTargetPhase(targetPhase, this);
  const finalTargetPhase = normalized.phase;
  const currentIdx = PHASE_ORDER.indexOf(this.phase);
  const targetIdx = PHASE_ORDER.indexOf(finalTargetPhase as GamePhase);
  if (currentIdx === -1 || targetIdx === -1) return;
  if (targetIdx < currentIdx || (targetIdx === currentIdx && finalTargetPhase !== "end")) return;
  cancelPendingPhaseRetry(this);
  if (targetIdx === currentIdx) {
    return finalTargetPhase === "end" ? await this.endTurn() : undefined;
  }

  const fromPhase = this.phase;

  while (this.phase !== finalTargetPhase) {
    const next =
      this.getNextPhase?.(this.phase) ?? getNextPhase(this.phase, this);
    if (!next) return;

    const leaveResult = await leaveCurrentPhase(this, { nextPhase: next });
    if (!leaveResult.ok) {
      if (
        leaveResult.reason === "phase_transition_interrupted" &&
        isAI(actor)
      ) {
        scheduleAiMoveAfterPaint(this, actor);
      }
      return leaveResult;
    }

    const enterResult = await enterPhase(this, next, leaveResult.currentPhase);
    if (!enterResult.ok) return enterResult;
    if (this.gameOver || this.isDisposed?.()) return;
  }

  if (
    normalized.redirected &&
    normalized.reason &&
    actor.controllerType === "human"
  ) {
    this.ui?.log?.(normalized.reason);
  }

  // Emitir evento informativo para captura de replay (não bloqueia)
  if (actor.controllerType === "human") {
    this.notify("phase_skip", {
      player: this.turn,
      fromPhase,
      toPhase: finalTargetPhase,
    });
  }

  if (this.phase === "end") {
    return await this.endTurn();
  }
  if (this.gameOver || this.isDisposed?.()) return;
  this.updateBoard();
  if (this.phase !== "draw") {
    scheduleAiMoveAfterPaint(this, actor);
  }
  return undefined;
}
