/**
 * guard.js
 *
 * Action guard system extracted from Game.js.
 * Validates whether an action can start given the current game state
 * (phase, turn, ongoing selections, ongoing effect resolution).
 *
 * Methods:
 *  - canStartAction
 *  - guardActionStart
 */

export function canStartAction(options = {}) {
  const actor = options.actor || null;
  const kind = options.kind || "action";
  const silent = options.silent === true;
  const allowDuringSelection =
    options.allowDuringSelection === true || kind === "selection_interaction";
  const allowDuringResolving =
    options.allowDuringResolving === true || kind === "selection_interaction";
  const allowDuringOpponentTurn = options.allowDuringOpponentTurn === true;
  const phaseReq = options.phaseReq || null;
  const selectionState = this.selectionState || "idle";
  const selectionInteractive =
    !!this.targetSelection ||
    selectionState === "selecting" ||
    selectionState === "confirming";
  const resolvingActive =
    this.isResolvingEffect ||
    selectionState === "resolving" ||
    this.eventResolutionDepth > 0;

  const blocked = (code, reason) => {
    const result = { ok: false, code, reason };
    if (!silent) {
      this.devLog("ACTION_GUARD_BLOCKED", {
        summary: code,
        kind,
        reason,
        phase: this.phase,
        turn: this.turn,
        actor: actor?.id,
        selectionState: this.selectionState,
        resolving: this.isResolvingEffect,
        eventDepth: this.eventResolutionDepth,
      });
    }
    return result;
  };

  if (selectionInteractive && !allowDuringSelection) {
    return blocked(
      "BLOCKED_SELECTION_ACTIVE",
      "Finalize a selecao atual antes de iniciar outra acao.",
    );
  }

  if (resolvingActive && !allowDuringResolving) {
    return blocked(
      "BLOCKED_RESOLVING",
      "Finalize o efeito pendente antes de fazer outra acao.",
    );
  }

  if (
    actor &&
    actor.id &&
    actor.id !== this.turn &&
    !allowDuringOpponentTurn
  ) {
    return blocked("BLOCKED_NOT_YOUR_TURN", "Nao e o seu turno.");
  }

  if (phaseReq) {
    const phases = Array.isArray(phaseReq) ? phaseReq : [phaseReq];
    if (!phases.includes(this.phase)) {
      return blocked(
        "BLOCKED_WRONG_PHASE",
        "Esta acao nao pode ser usada nesta fase.",
      );
    }
  }

  // Battle phase activation lock: blocks the opponent of the Arturus controller
  // from activating cards/effects during the controller's own battle phase.
  // Crucially, this only applies when the actor is NOT the current turn player —
  // i.e., it never blocks the turn player's own actions during their own phase.
  if (
    this.phase === "battle" &&
    actor?.id &&
    actor.opponentCannotActivateDuringBattle &&
    actor.id !== this.turn
  ) {
    return blocked(
      "BLOCKED_BATTLE_PHASE_LOCK",
      "Seu oponente nao pode ativar cards ou efeitos durante a Fase de Batalha.",
    );
  }

  return { ok: true };
}

export function guardActionStart(options = {}, logToRenderer = true) {
  const result = this.canStartAction(options);
  if (!result.ok && logToRenderer && result.reason && this.ui?.log) {
    this.ui.log(result.reason);
  }
  return result;
}
