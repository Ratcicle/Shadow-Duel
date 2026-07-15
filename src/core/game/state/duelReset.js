/**
 * duelReset.js
 *
 * Central duel-state reset helpers for reusing a Game instance safely.
 */

function createOncePerTurnUsage() {
  return {
    player: new Map(),
    bot: new Map(),
    card: new WeakMap(),
  };
}

function createSpecialSummonTypeCounts() {
  return {
    player: new Map(),
    bot: new Map(),
  };
}

function resetKnownPlayerTurnFlags(player) {
  player.lpGainedThisTurn = 0;
  player.damageReceivedThisTurn = 0;
  player.summonCount = 0;
  player.additionalNormalSummons = 0;
  player.additionalNormalSummonPermissions = [];
  player.normalSummonsThisTurn = [];
  player.specialSummonRestrictions = [];
  player.effectActivationRestrictions = [];
  player.forbidDirectAttacksThisTurn = false;
}

export function resetPlayerDuelState(player, _options = {}) {
  if (!player) return;

  player.lp = 8000;
  player.deck = [];
  player.extraDeck = [];
  player.hand = [];
  player.field = [];
  player.spellTrap = [];
  player.graveyard = [];
  player.banished = [];
  player.fieldSpell = null;
  player.oncePerTurnUsageByName = {};
  player.oncePerDuelUsageByName = Object.create(null);
  resetKnownPlayerTurnFlags(player);
}

export function resetDuelState(reason = "reset", options = {}) {
  const turn = options.turn || "player";
  const phase = options.phase || "draw";
  const turnCounter = Number.isFinite(options.turnCounter)
    ? options.turnCounter
    : 0;

  this.resetPlayerDuelState?.(this.player, options);
  this.resetPlayerDuelState?.(this.bot, options);

  if (this.player) this.player.game = this;
  if (this.bot) this.bot.game = this;

  this.turn = turn;
  this.phase = phase;
  this.turnCounter = turnCounter;
  this.gameOver = false;
  this.winner = null;
  this.disposeReason = null;

  this.targetSelection = null;
  this.selectionState = "idle";
  this.graveyardSelection = null;
  this.selectionSessionCounter = 0;
  this.lastSelectionSessionId = 0;
  this.pendingSpecialSummon = null;
  this.pendingTributeSummonSelection = null;
  this.pendingEventSelection = null;
  this.pendingTriggerSelection = null;
  this.pendingChainEvents = [];
  this._flushingPendingChainEvents = false;
  this.pendingBattleDestroyAfterSelection = null;
  this.isResolvingEffect = false;
  this.eventResolutionDepth = 0;
  this.eventResolutionCounter = 0;
  this.temporaryReplacementEffects = [];
  this.temporaryBattlePairEffects = [];
  this.temporaryEventEffects = [];
  this.pendingSynchroMaterialFollowups = [];
  this.pendingSynchroMaterialTriggerContinuation = null;
  this.synchroSummonContextCounter = 0;
  this.delayedActions = [];
  this.damageCalculationTempBuffs = [];
  this.damageCalculationStatChangePending = false;

  this.lastAttackNegated = false;
  this.pendingCardAnimations = [];
  this.pendingVisualFeedback = [];
  this.cardAnimationsReady = false;

  this.zoneOpDepth = 0;
  this.zoneOpSnapshot = null;
  this.devFailAfterZoneMutation = false;

  this.oncePerTurnUsage = createOncePerTurnUsage();
  this.oncePerTurnTurnCounter = this.turnCounter;
  this.specialSummonTypeCounts = createSpecialSummonTypeCounts();
  this._normalDuelStrategic = null;

  this.resetMaterialDuelStats?.(reason);
  this.chainSystem?.cancelChain?.();
  this.effectEngine?.clearTargetingCache?.();

  this.devLog?.("DUEL_RESET", {
    summary: reason,
    phase: this.phase,
    turn: this.turn,
    turnCounter: this.turnCounter,
  });
}
