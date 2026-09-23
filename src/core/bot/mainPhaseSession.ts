import type { AIPlannedAction } from "../contracts/ai.js";
import type { BotGamePort, BotRuntimePort } from "../contracts/bot.js";
import { fingerprintMainPhaseAction, fingerprintMainPhaseState } from "./mainPhaseIdentity.js";
import { getNextPhase } from "../game/turn/phaseRules.js";

export const MAIN_PHASE_MAX_DECISIONS = 128;
export const MAIN_PHASE_MAX_EXECUTIONS = 64;
// Separate from card play: enough room for finite phase-end responses, while
// a broken runtime cannot keep the automation retrying indefinitely.
export const MAIN_PHASE_MAX_FINALIZATION_ATTEMPTS = 8;

export type MainPhaseExitReason = "no_candidates" | "alternatives_exhausted" |
  "planner_transition" | "decision_limit" | "execution_limit" | "game_over" |
  "context_lost" | "capture_error" | "execution_error" | "guard_blocked";

type SessionStatus = "planning" | "finalizing" | "completed" | "invalidated" | "failed";
type FinalizationOutcome = "not_requested" | "pending" | "transitioned" | "invalidated" |
  "limit_reached" | "guard_blocked" | "runtime_refused";

class CaptureError extends Error {
  readonly operation: string;
  constructor(operation: string, cause: unknown) {
    super("Main Phase identity unavailable", { cause });
    this.operation = operation;
  }
}

function errorMessage(error: unknown): string {
  try {
    let cause = error;
    for (let depth = 0; depth < 8 && cause instanceof Error && cause.cause !== undefined; depth++) cause = cause.cause;
    const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "Non-Error failure";
    return message.replace(/[\r\n\t]/g, " ").slice(0, 1000);
  } catch { return "Failure message unavailable"; }
}

/** Execution history is local to a physical actor/duel/turn/phase, never replay state. */
export class MainPhaseSession {
  readonly bot: BotRuntimePort;
  readonly game: BotGamePort;
  readonly run: (session: MainPhaseSession) => Promise<void>;
  readonly actorId;
  readonly turn;
  readonly turnCounter;
  readonly phase;
  readonly player;
  readonly opponent;
  readonly attempts = new Set<string>();
  readonly counts = { decisions: 0, executions: 0, accepted: 0, changes: 0,
    noOps: 0, rejected: 0, repetitionsSuppressed: 0, ascensions: 0 };
  stopReason: MainPhaseExitReason | null = null;
  status: SessionStatus = "planning";
  finalizationOutcome: FinalizationOutcome = "not_requested";
  finalizationAttempts = 0;
  promise: Promise<void> = Promise.resolve();
  finalizationTask: Promise<void> | null = null;
  private playClosed = false;
  private operation = "planning";
  private originalFailure: { category: string; operation: string; error: Error } | null = null;

  constructor(bot: BotRuntimePort, game: BotGamePort, run: (session: MainPhaseSession) => Promise<void>) {
    this.bot = bot;
    this.game = game;
    this.run = run;
    this.actorId = bot.id;
    this.turn = game.turn;
    this.turnCounter = game.turnCounter;
    this.phase = game.phase;
    this.player = game.player;
    this.opponent = game.bot;
  }

  sameContext(phase = this.phase): boolean {
    return this.bot.id === this.actorId && this.game.turn === this.turn &&
      this.game.turnCounter === this.turnCounter && this.game.phase === phase &&
      this.game.player === this.player && this.game.bot === this.opponent &&
      (!this.bot.game || this.bot.game === this.game);
  }

  active(): boolean {
    if (this.status === "completed" || this.status === "failed" || this.status === "invalidated") return false;
    if (this.game.gameOver) { this.invalidate("game_over"); return false; }
    if (this.game.isDisposed?.() || !this.sameContext() || this.turn !== this.actorId ||
        (this.bot !== this.game.bot && this.bot !== this.game.player) ||
        (this.phase !== "main1" && this.phase !== "main2")) {
      this.invalidate("context_lost");
      return false;
    }
    return true;
  }

  private invalidate(reason: "game_over" | "context_lost") {
    this.stopReason ??= reason;
    this.status = "invalidated";
    this.finalizationOutcome = "invalidated";
  }

  private actionGuard(finalizing = false) {
    this.operation = finalizing ? "phase_guard" : "action_guard";
    return this.game.canStartAction({ actor: this.bot, kind: finalizing ? "phase_change" : "bot_main_action",
      phaseReq: ["main1", "main2"], silent: true });
  }

  async waitUntilReady(finalizing = false): Promise<boolean> {
    while (this.active()) {
      const guard = this.actionGuard(finalizing);
      if (guard.ok) return true;
      if (!["BLOCKED_SELECTION_ACTIVE", "BLOCKED_RESOLVING", "BLOCKED_CHAIN_WINDOW_OPEN",
        "BLOCKED_FAST_EFFECT_TIMING"].includes(guard.code)) {
        this.stopReason ??= "guard_blocked";
        this.status = "failed";
        this.finalizationOutcome = "guard_blocked";
        this.failure("guard_blocked", this.operation, new Error(`${guard.code}: ${guard.reason}`));
        return false;
      }
      // A human selection/Chain may take arbitrarily long. Waiting consumes no
      // decision budget and never races or abandons an in-flight action.
      await new Promise<void>(resolve => setTimeout(resolve, 20));
    }
    return false;
  }

  capture(): string {
    try { return fingerprintMainPhaseState(this.game, this.bot); }
    catch (cause) { throw new CaptureError("capture_state", cause); }
  }

  actionKey(state: string, action: AIPlannedAction): string {
    try { return JSON.stringify([state, fingerprintMainPhaseAction(action, this.game, this.bot)]); }
    catch (cause) { throw new CaptureError("identify_action", cause); }
  }

  allowed(state: string, action: AIPlannedAction): boolean {
    if (!this.attempts.has(this.actionKey(state, action))) return true;
    this.counts.repetitionsSuppressed++;
    return false;
  }

  rejectCandidate(state: string, action: AIPlannedAction): void {
    this.attempts.add(this.actionKey(state, action));
  }

  beginDecision(): boolean {
    if (this.playClosed) return false;
    if (this.counts.executions >= MAIN_PHASE_MAX_EXECUTIONS) { this.stopReason = "execution_limit"; return false; }
    if (this.counts.decisions >= MAIN_PHASE_MAX_DECISIONS) { this.stopReason = "decision_limit"; return false; }
    this.counts.decisions++;
    return true;
  }

  async execute(action: Exclude<AIPlannedAction, { type: "simulatedBattle" }>, expectedState: string): Promise<boolean> {
    if (this.playClosed) return false;
    if (!await this.waitUntilReady()) return false;
    // Recheck synchronously after the await: another microtask may have opened
    // a selection/Chain. Such a busy refusal is not an attempt of this action.
    if (!this.active() || !this.actionGuard().ok) return false;
    if (this.counts.executions >= MAIN_PHASE_MAX_EXECUTIONS) { this.stopReason = "execution_limit"; return false; }
    const before = this.capture();
    // Waiting for a selection/Chain can reorder zones. Replan instead of
    // applying an old index to a different card in the new state.
    if (before !== expectedState) return false;
    if (!this.allowed(before, action)) return false;
    this.attempts.add(this.actionKey(before, action));
    this.counts.executions++;
    if (action.type === "ascension") this.counts.ascensions++;
    this.operation = "execute_action";
    const accepted = await this.bot.executeMainPhaseAction(this.game, action);
    if (accepted) this.counts.accepted++;
    else this.counts.rejected++;
    if (!this.active()) return accepted;
    // The legacy rejection refresh also recomputes passive state. Include its
    // completion in the observed outcome, rather than changing it after capture.
    if (!accepted) { this.operation = "refresh_board"; await this.game.updateBoard(); }
    if (!await this.waitUntilReady()) return accepted;
    const changed = before !== this.capture();
    if (changed) this.counts.changes++;
    else if (accepted) this.counts.noOps++;
    this.recordProgress("ai_main_phase_execution", this.game, {
      actor: this.actorId, actionType: action.type, actionAccepted: accepted, changed,
      ...this.counts,
    });
    return accepted;
  }

  async presentationDelay(): Promise<boolean> {
    const configured = this.game.aiSuccessfulActionDelayMs;
    const delay = typeof configured === "number" && Number.isFinite(configured)
      ? configured : this.game.phaseDelayMs || 0;
    if (delay > 0) await new Promise<void>(resolve => setTimeout(resolve, delay));
    return this.active();
  }

  recordProgress(kind: string, game: BotGamePort, details: object): void {
    try { game._arenaTracker?.recordProgress?.(kind, game, details); }
    catch (cause) { this.logFailure("diagnostic_error", kind, cause); }
  }

  private logFailure(category: string, operation: string, error: unknown): void {
    try {
      console.error("[Bot.MainPhase]", { category, operation, message: errorMessage(error),
        actor: this.actorId, turn: this.turnCounter, phase: this.phase,
        stopReason: this.stopReason, finalizationOutcome: this.finalizationOutcome });
    } catch { /* A broken diagnostic sink must never reject the session promise. */ }
  }

  private failure(category: string, operation: string, cause: unknown): void {
    const error = new Error(`Main Phase ${operation} failed`, { cause });
    this.originalFailure ??= { category, operation, error };
    this.logFailure(category, operation, error);
    this.recordProgress("ai_main_phase_failure", this.game, {
      category, operation, message: errorMessage(error), actor: this.actorId,
      turn: this.turnCounter, phase: this.phase, stopReason: this.stopReason,
      finalizationOutcome: this.finalizationOutcome,
    });
  }

  private report(kind: string): void {
    const failure = this.originalFailure;
    this.recordProgress(kind, this.game, {
      actor: this.actorId, phase: this.phase, turn: this.turnCounter,
      reason: this.stopReason, stopReason: this.stopReason, status: this.status,
      finalizationOutcome: this.finalizationOutcome, finalizationAttempts: this.finalizationAttempts,
      finalizationLimit: MAIN_PHASE_MAX_FINALIZATION_ATTEMPTS, ...this.counts,
      decisionLimit: MAIN_PHASE_MAX_DECISIONS, executionLimit: MAIN_PHASE_MAX_EXECUTIONS,
      ...(failure ? { category: failure.category, operation: failure.operation, message: errorMessage(failure.error) } : {}),
    });
    if (failure && kind === "ai_main_phase_finalization") this.logFailure(failure.category, failure.operation, failure.error);
  }

  async plan(): Promise<void> {
    try {
      if (this.playClosed || !this.active()) return;
      this.status = "planning";
      this.stopReason = null;
      this.operation = "planning";
      await this.run(this);
    } catch (error) {
      this.stopReason = error instanceof CaptureError ? "capture_error" : "execution_error";
      this.playClosed = true;
      this.failure(this.stopReason, error instanceof CaptureError ? error.operation : this.operation, error);
    } finally {
      if (this.stopReason === "decision_limit" || this.stopReason === "execution_limit") this.playClosed = true;
      if (this.status === "planning") this.status = "finalizing";
      this.report("ai_main_phase_exit");
    }
  }

  private transitionFinished(targetPhase: ReturnType<typeof getNextPhase>): boolean {
    if (targetPhase && this.sameContext(targetPhase) && !this.game.gameOver && !this.game.isDisposed?.()) {
      this.status = "completed";
      this.finalizationOutcome = "transitioned";
      return true;
    }
    return !this.active();
  }

  /** One owner drives waits, negotiation retries and any permitted replanning. */
  async finalize(): Promise<void> {
    this.finalizationOutcome = "pending";
    try {
      while (this.active()) {
        this.status = "finalizing";
        if (this.finalizationAttempts >= MAIN_PHASE_MAX_FINALIZATION_ATTEMPTS) {
          this.status = "failed";
          this.finalizationOutcome = "limit_reached";
          this.failure("finalization_limit", "next_phase", new Error("Main Phase finalization attempts exhausted"));
          break;
        }
        const configured = this.game.aiActionDelayMs;
        const delay = typeof configured === "number" && Number.isFinite(configured) ? configured : 500;
        if (delay > 0 && !(this.finalizationAttempts === 0 && this.stopReason === "planner_transition")) {
          await new Promise<void>(resolve => setTimeout(resolve, delay));
        }
        do {
          if (!await this.waitUntilReady(true)) return;
        } while (!this.active() || !this.actionGuard(true).ok);
        const targetPhase = getNextPhase(this.phase, this.game);
        this.finalizationAttempts++;
        let result: unknown;
        try {
          // This session owns retries; do not also install nextPhase's legacy
          // blocked-action timer. Its phase-end reentry simply joins our task.
          result = await this.game.nextPhase({ retryOnBlocked: false });
        } catch (cause) {
          this.playClosed = true;
          this.failure("transition_error", "next_phase", cause);
          if (this.transitionFinished(targetPhase)) break;
          continue;
        }
        if (this.transitionFinished(targetPhase)) break;
        const reason = result && typeof result === "object" && "reason" in result ? result.reason : null;
        const code = result && typeof result === "object" && "code" in result ? result.code : null;
        const interrupted = reason === "phase_transition_interrupted" || reason === "phase_window_pending";
        const busy = typeof code === "string" && ["BLOCKED_SELECTION_ACTIVE", "BLOCKED_RESOLVING",
          "BLOCKED_CHAIN_WINDOW_OPEN", "BLOCKED_FAST_EFFECT_TIMING"].includes(code);
        if (!interrupted && !busy) {
          this.status = "failed";
          this.finalizationOutcome = "runtime_refused";
          this.failure("transition_refused", "next_phase", new Error(typeof reason === "string" ? reason : "Runtime did not advance the phase"));
          break;
        }
        // Finishing is independent of card-play budgets. Only an ordinary
        // response with room for BOTH decisions and executions may reopen play.
        if (interrupted && !this.playClosed && this.counts.decisions < MAIN_PHASE_MAX_DECISIONS &&
            this.counts.executions < MAIN_PHASE_MAX_EXECUTIONS && this.finalizationAttempts < MAIN_PHASE_MAX_FINALIZATION_ATTEMPTS) {
          await this.plan();
        }
      }
    } catch (cause) {
      this.status = "failed";
      this.finalizationOutcome = "guard_blocked";
      this.failure("finalization_error", this.operation, cause);
    } finally {
      this.report("ai_main_phase_finalization");
    }
  }
}

const sessions = new WeakMap<BotGamePort, Map<BotRuntimePort, MainPhaseSession>>();

export function runMainPhaseSession(bot: BotRuntimePort, game: BotGamePort,
  run: (session: MainPhaseSession) => Promise<void>): Promise<void> {
  let actors = sessions.get(game);
  if (!actors) { actors = new Map(); sessions.set(game, actors); }
  const previous = actors.get(bot);
  if (previous?.sameContext()) return previous.promise;
  const session = new MainPhaseSession(bot, game, run);
  actors.set(bot, session);
  // Capture the old task before publishing the new one; never await ourselves.
  const pending = previous?.promise;
  session.promise = Promise.resolve().then(async () => {
    await pending;
    await session.plan();
    if (session.stopReason === "planner_transition" && session.status === "finalizing") {
      session.finalizationTask = session.promise;
      await session.finalize();
    }
  });
  return session.promise;
}

export function scheduleMainPhaseTransition(bot: BotRuntimePort, game: BotGamePort): Promise<void> {
  const session = sessions.get(game)?.get(bot);
  if (!session) return Promise.resolve();
  if (session.finalizationTask) return session.finalizationTask;
  if (session.status !== "finalizing") return session.promise;
  const pending = session.promise;
  const task = Promise.resolve().then(async () => {
    await pending;
    if (sessions.get(game)?.get(bot) === session && session.status === "finalizing") await session.finalize();
  });
  session.finalizationTask = task;
  session.promise = task;
  return task;
}
