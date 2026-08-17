import { isAI } from "../../Player.js";
import type {
  ActionRuntimeCard,
  ActionRuntimeGamePort,
  ActionRuntimePlayer,
  EffectContext,
  ResolvedTargetMap,
} from "../../contracts/actionRuntime.js";
import type { ActionOf } from "../../contracts/actions.js";

interface CombatRuntimeCard extends ActionRuntimeCard {
  cannotAttackUntilTurn?: number;
  canAttackDirectlyThisTurn?: boolean;
}

interface CombatGame extends ActionRuntimeGamePort {
  turn: "player" | "bot";
  phase: string;
  aiActionDelayMs?: number;
  isDisposed?(): boolean;
  canStartAction?(options: {
    actor: AiActor;
    kind: string;
    silent?: boolean;
  }): { ok: boolean; code?: string };
  clearAttackReadyIndicators?(): void;
  clearAttackResolutionIndicators?(): void;
}
type ForbidAttackThisTurnAction = ActionOf<"forbid_attack_this_turn"> & {
  readonly targetRef?: string;
};
type CombatPlayer = ActionRuntimePlayer & {
  forbidDirectAttacksThisTurn?: boolean;
};
interface CombatActionHost {
  game: CombatGame;
}

type AiActor = ActionRuntimePlayer & {
  makeMove?(game: CombatGame): unknown;
};

/**
 * Combat Actions - attack negation, battle phase control, forbid attack, direct attack
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

function scheduleAiMoveAfterPaint(game: CombatGame, actor: AiActor): void {
  if (!isAI(actor) || game.gameOver || typeof actor?.makeMove !== "function") {
    return;
  }

  const expectedTurn = game.turn;
  const expectedPhase = game.phase;
  const retryableGuardCodes = new Set([
    "BLOCKED_RESOLVING",
    "BLOCKED_SELECTION_ACTIVE",
    "BLOCKED_CHAIN_WINDOW_OPEN",
    "BLOCKED_FAST_EFFECT_TIMING",
  ]);
  const runMove = () => {
    if (
      game.gameOver ||
      game.isDisposed?.() ||
      game.turn !== expectedTurn ||
      game.phase !== expectedPhase
    ) {
      return;
    }

    const guard = game.canStartAction?.({
      actor,
      kind: "bot_turn",
      silent: true,
    });
    if (guard?.ok === false) {
      const guardCode = "code" in guard ? guard.code : undefined;
      if (typeof guardCode === "string" && retryableGuardCodes.has(guardCode)) {
        const retryDelayMs =
          typeof game.aiActionDelayMs === "number" &&
          Number.isFinite(game.aiActionDelayMs)
          ? game.aiActionDelayMs
          : 250;
        setTimeout(runMove, Math.max(16, retryDelayMs));
      }
      return;
    }

    Promise.resolve(actor.makeMove!(game)).catch((error: unknown) => {
      console.error("[EffectPhaseTransition] AI move failed:", error);
    });
  };

  const requestFrame = globalThis.requestAnimationFrame;
  if (typeof requestFrame === "function") {
    requestFrame(() => setTimeout(runMove, 0));
    return;
  }

  setTimeout(runMove, 0);
}

/**
 * Apply negate attack action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @returns {boolean} Whether attack was negated
 */
export function applyNegateAttack(
  this: CombatActionHost,
  _action: ActionOf<"negate_attack">,
  ctx: EffectContext,
): boolean {
  if (!this.game || !ctx?.attacker) return false;
  if (typeof this.game.registerAttackNegated === "function") {
    this.game.registerAttackNegated(ctx.attacker);
    return true;
  }
  return false;
}

/**
 * Apply end battle phase action
 * @returns {boolean} Whether the Battle Phase was ended
 */
export function applyEndBattlePhase(this: CombatActionHost): boolean {
  const game = this.game;
  if (!game || game.phase !== "battle") return false;

  const fromPhase = game.phase;
  const activePlayer = game.turn === "player" ? game.player : game.bot;
  game.phase = "main2";
  game.battleStep = null;

  game.clearAttackResolutionIndicators?.();
  game.clearAttackReadyIndicators?.();
  game.ui?.log?.("The Battle Phase ends.");
  game.notify?.("phase_skip", {
    player: game.turn,
    fromPhase,
    toPhase: game.phase,
    reason: "effect",
  });
  game.updateBoard?.();

  scheduleAiMoveAfterPaint(game, activePlayer as AiActor);
  return true;
}

/**
 * Apply forbid attack this turn action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether any cards were affected
 */
export function applyForbidAttackThisTurn(
  this: CombatActionHost,
  action: ForbidAttackThisTurnAction,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
): boolean {
  // Se targetRef está definido, usa os alvos selecionados
  // Caso contrário, aplica à carta fonte (self)
  let targetCards: CombatRuntimeCard[] = [];
  if (action.targetRef && targets?.[action.targetRef]) {
    targetCards = targets[action.targetRef] as CombatRuntimeCard[];
  } else if (ctx && ctx.source) {
    targetCards = [ctx.source];
  }

  targetCards.forEach((card) => {
    card.cannotAttackThisTurn = true;
  });
  return targetCards.length > 0;
}

/**
 * Apply forbid attack next turn action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether any cards were affected
 */
export function applyForbidAttackNextTurn(
  this: CombatActionHost,
  action: ActionOf<"forbid_attack_next_turn">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
): boolean {
  let targetCards: CombatRuntimeCard[] = [];
  if (action.targetRef && targets?.[action.targetRef]) {
    targetCards = targets[action.targetRef] as CombatRuntimeCard[];
  } else if (ctx && ctx.source) {
    targetCards = [ctx.source];
  }

  if (targetCards.length === 0) {
    return false;
  }

  const currentTurn = this.game?.turnCounter ?? 0;
  const extraTurns = Math.max(
    1,
    Math.floor(typeof action.turns === "number" ? action.turns : 1)
  );
  const untilTurn = currentTurn + extraTurns;

  targetCards.forEach((card) => {
    card.cannotAttackThisTurn = true;
    if (!card.cannotAttackUntilTurn || card.cannotAttackUntilTurn < untilTurn) {
      card.cannotAttackUntilTurn = untilTurn;
    }
  });

  return true;
}

/**
 * Apply allow direct attack this turn action
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @param {Object} targets - Resolved targets
 * @returns {boolean} Whether any cards were affected
 */
export function applyAllowDirectAttackThisTurn(
  this: CombatActionHost,
  action: ActionOf<"allow_direct_attack_this_turn">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
): boolean {
  const targetCards =
    (targets[action.targetRef] as CombatRuntimeCard[] | undefined) ||
    ([ctx.source].filter(Boolean) as CombatRuntimeCard[]);
  if (!targetCards.length) return false;

  targetCards.forEach((card) => {
    card.canAttackDirectlyThisTurn = true;
  });

  return true;
}

/**
 * Apply forbid direct attacks this turn action (player-level restriction).
 * @param {Object} action - Action configuration
 * @param {Object} ctx - Context object
 * @returns {boolean} Whether restriction was applied
 */
export function applyForbidDirectAttackThisTurn(
  this: CombatActionHost,
  action: ActionOf<"forbid_direct_attack_this_turn">,
  ctx: EffectContext,
): boolean {
  if (!this.game || !ctx?.player) return false;
  const targetPlayer = (action.player === "opponent"
    ? ctx.opponent
    : ctx.player) as CombatPlayer | null | undefined;
  if (!targetPlayer) return false;
  targetPlayer.forbidDirectAttacksThisTurn = true;
  return true;
}
