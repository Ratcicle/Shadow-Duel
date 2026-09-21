import type { AIPlannedAction } from "../contracts/ai.js";
import type { BotGamePort, BotRuntimePort } from "../contracts/bot.js";
import { fingerprintMainPhaseAction, fingerprintMainPhaseState } from "./mainPhaseIdentity.js";
import { getNextPhase } from "../game/turn/phaseRules.js";

export const MAIN_PHASE_MAX_DECISIONS = 128;
export const MAIN_PHASE_MAX_EXECUTIONS = 64;

export type MainPhaseExitReason = "no_candidates" | "alternatives_exhausted" |
  "planner_transition" | "decision_limit" | "execution_limit" | "game_over" |
  "context_lost" | "capture_error" | "execution_error" | "guard_blocked";

class CaptureError extends Error {}

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
  reason: MainPhaseExitReason | null = null;
  promise: Promise<void> = Promise.resolve();
  transitionScheduled = false;
  resumeRequested = false;

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

  sameContext(): boolean {
    return this.bot.id === this.actorId && this.game.turn === this.turn &&
      this.game.turnCounter === this.turnCounter && this.game.phase === this.phase &&
      this.game.player === this.player && this.game.bot === this.opponent &&
      (!this.bot.game || this.bot.game === this.game);
  }

  active(): boolean {
    if (this.game.gameOver) { this.reason = "game_over"; return false; }
    if (this.game.isDisposed?.() || !this.sameContext() || this.turn !== this.actorId ||
        (this.bot !== this.game.bot && this.bot !== this.game.player) ||
        (this.phase !== "main1" && this.phase !== "main2")) {
      this.reason = "context_lost";
      return false;
    }
    return true;
  }

  private actionGuard() {
    return this.game.canStartAction({ actor: this.bot, kind: "bot_main_action",
      phaseReq: ["main1", "main2"], silent: true });
  }

  async waitUntilReady(): Promise<boolean> {
    while (this.active()) {
      const guard = this.actionGuard();
      if (guard.ok) return true;
      if (!["BLOCKED_SELECTION_ACTIVE", "BLOCKED_RESOLVING", "BLOCKED_CHAIN_WINDOW_OPEN",
        "BLOCKED_FAST_EFFECT_TIMING"].includes(guard.code)) {
        this.reason = "guard_blocked";
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
    catch { throw new CaptureError("Main Phase state identity unavailable"); }
  }

  actionKey(state: string, action: AIPlannedAction): string {
    try { return JSON.stringify([state, fingerprintMainPhaseAction(action, this.game, this.bot)]); }
    catch { throw new CaptureError("Main Phase action identity unavailable"); }
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
    if (this.counts.executions >= MAIN_PHASE_MAX_EXECUTIONS) { this.reason = "execution_limit"; return false; }
    if (this.counts.decisions >= MAIN_PHASE_MAX_DECISIONS) { this.reason = "decision_limit"; return false; }
    this.counts.decisions++;
    return true;
  }

  async execute(action: Exclude<AIPlannedAction, { type: "simulatedBattle" }>, expectedState: string): Promise<boolean> {
    if (!await this.waitUntilReady()) return false;
    // Recheck synchronously after the await: another microtask may have opened
    // a selection/Chain. Such a busy refusal is not an attempt of this action.
    if (!this.active() || !this.actionGuard().ok) return false;
    if (this.counts.executions >= MAIN_PHASE_MAX_EXECUTIONS) { this.reason = "execution_limit"; return false; }
    const before = this.capture();
    // Waiting for a selection/Chain can reorder zones. Replan instead of
    // applying an old index to a different card in the new state.
    if (before !== expectedState) return false;
    if (!this.allowed(before, action)) return false;
    this.attempts.add(this.actionKey(before, action));
    this.counts.executions++;
    if (action.type === "ascension") this.counts.ascensions++;
    const accepted = await this.bot.executeMainPhaseAction(this.game, action);
    if (accepted) this.counts.accepted++;
    else this.counts.rejected++;
    if (!this.active()) return accepted;
    // The legacy rejection refresh also recomputes passive state. Include its
    // completion in the observed outcome, rather than changing it after capture.
    if (!accepted) await this.game.updateBoard();
    if (!await this.waitUntilReady()) return accepted;
    const changed = before !== this.capture();
    if (changed) this.counts.changes++;
    else if (accepted) this.counts.noOps++;
    this.game._arenaTracker?.recordProgress?.("ai_main_phase_execution", this.game, {
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

  async advancePhase(): Promise<boolean> {
    do {
      if (!await this.waitUntilReady()) return false;
    } while (!this.active() || !this.actionGuard().ok);
    this.transitionScheduled = true;
    const targetPhase = getNextPhase(this.phase, this.game);
    const result: unknown = await this.game.nextPhase();
    // A successful requested transition ends this session; it is not loss of
    // context during action execution. Unexpected interrupted changes still
    // pass through active() below.
    if (result === undefined && this.game.phase === targetPhase &&
        this.game.turn === this.turn && this.game.turnCounter === this.turnCounter &&
        !this.game.gameOver && !this.game.isDisposed?.()) return false;
    if (!this.active()) return false;
    const reason = result && typeof result === "object" && "reason" in result ? result.reason : null;
    if (reason !== "phase_transition_interrupted" && reason !== "phase_window_pending") return false;
    // A phase-end response can create new Main Phase options. Resume the same
    // history/budgets after it settles, including for a planner battle bridge.
    if (this.counts.decisions >= MAIN_PHASE_MAX_DECISIONS) {
      this.reason = "decision_limit";
      return false;
    }
    this.counts.decisions++;
    this.resumeRequested = true;
    this.transitionScheduled = false;
    return true;
  }
}

const sessions = new WeakMap<BotGamePort, Map<BotRuntimePort, MainPhaseSession>>();

export function runMainPhaseSession(bot: BotRuntimePort, game: BotGamePort,
  run: (session: MainPhaseSession) => Promise<void>): Promise<void> {
  let actors = sessions.get(game);
  if (!actors) { actors = new Map(); sessions.set(game, actors); }
  const previous = actors.get(bot);
  const sameContext = previous?.sameContext();
  if (previous && sameContext && !previous.resumeRequested) return previous.promise;
  const session = previous && sameContext ? previous : new MainPhaseSession(bot, game, run);
  const pending = previous?.promise;
  session.resumeRequested = false;
  session.reason = null;
  actors.set(bot, session);
  // Publish the session before any callback/generator can reenter it.
  session.promise = Promise.resolve().then(async () => {
    try {
      await pending;
      if (session.active()) await run(session);
    }
    catch (error) { session.reason = error instanceof CaptureError ? "capture_error" : "execution_error"; }
    finally {
      game._arenaTracker?.recordProgress?.("ai_main_phase_exit", game, {
        actor: session.actorId, phase: session.phase, turn: session.turnCounter,
        reason: session.reason, ...session.counts,
        decisionLimit: MAIN_PHASE_MAX_DECISIONS, executionLimit: MAIN_PHASE_MAX_EXECUTIONS,
      });
    }
  });
  return session.promise;
}

export function scheduleMainPhaseTransition(bot: BotRuntimePort, game: BotGamePort): void {
  const session = sessions.get(game)?.get(bot);
  if (!session || session.transitionScheduled || !session.active() ||
      !["no_candidates", "alternatives_exhausted", "decision_limit", "execution_limit"].includes(session.reason || "")) return;
  session.transitionScheduled = true;
  const delay = Number.isFinite(game.aiActionDelayMs) ? game.aiActionDelayMs : 500;
  setTimeout(() => {
    void (async () => {
      if (sessions.get(game)?.get(bot) !== session || !await session.waitUntilReady()) return;
      if (await session.advancePhase()) {
        await runMainPhaseSession(bot, game, session.run);
        scheduleMainPhaseTransition(bot, game);
      }
    })().catch(() => {
      game._arenaTracker?.recordProgress?.("ai_main_phase_transition_failed", game, { actor: session.actorId });
    });
  }, delay);
}
