/**
 * scheduling.js
 *
 * Delayed action scheduling and processing methods extracted from Game.js.
 * Handles scheduling actions for future phases/turns.
 *
 * Methods:
 * - scheduleDelayedAction
 * - processDelayedActions
 * - resolveDelayedAction
 */

/**
 * Schedules a delayed action to be resolved in a future phase.
 * Supports any type of future action: summons, damage, draw, etc.
 * @param {string} actionType - Type of action (e.g., "delayed_summon")
 * @param {Object} triggerCondition - Trigger condition (e.g., {phase: "standby", player: "opponent"})
 * @param {Object} payload - Action data
 * @param {number} priority - Execution priority (default: 0)
 * @returns {string|null} ID of the scheduled action
 */
export function scheduleDelayedAction(
  actionType,
  triggerCondition,
  payload,
  priority = 0
) {
  if (!actionType || !triggerCondition || !payload) {
    console.error("Invalid delayed action parameters");
    return null;
  }

  const action = {
    id: Math.random().toString(36).substr(2, 9),
    actionType,
    triggerCondition,
    payload,
    scheduledTurn: this.turnCounter,
    priority,
  };

  this.delayedActions.push(action);
  this.devLog?.("DELAYED_ACTION_SCHEDULED", {
    summary: `${actionType} scheduled for ${triggerCondition.phase} (${triggerCondition.player})`,
    actionType,
    trigger: triggerCondition,
    turn: this.turnCounter,
  });

  return action.id;
}

/**
 * Processes delayed actions that should be resolved now.
 * Filters actions by current trigger and executes appropriate resolvers.
 * @param {string} phase - Current phase (e.g., "standby")
 * @param {string} activePlayer - Active player ("player" or "bot")
 */
export function processDelayedActions(phase, activePlayer) {
  if (!Array.isArray(this.delayedActions) || this.delayedActions.length === 0) {
    return;
  }

  // Filter actions that should be resolved in this phase/player
  const actionsToResolve = this.delayedActions.filter((action) => {
    const trigger = action.triggerCondition;
    if (!trigger) return false;

    // Check if phase matches
    if (trigger.phase && trigger.phase !== phase) return false;

    // Check if player matches
    if (trigger.player) {
      const triggerPlayer =
        trigger.player === "opponent"
          ? activePlayer === "player"
            ? "bot"
            : "player"
          : trigger.player;
      if (triggerPlayer !== activePlayer) return false;
    }

    return true;
  });

  // Sort by priority and execute
  actionsToResolve.sort((a, b) => b.priority - a.priority);

  for (const action of actionsToResolve) {
    this.resolveDelayedAction(action);
  }

  // Remove resolved actions
  this.delayedActions = this.delayedActions.filter(
    (action) => !actionsToResolve.includes(action)
  );
}

/**
 * Resolves an individual scheduled action.
 * Calls the appropriate resolver based on action type.
 * @param {Object} action - Action to resolve
 */
export function resolveDelayedAction(action) {
  try {
    switch (action.actionType) {
      case "delayed_summon":
        this.resolveDelayedSummon(action.payload);
        break;
      // Future action types can be added here
      default:
        console.warn(`Unknown delayed action type: ${action.actionType}`);
    }
  } catch (err) {
    console.error("Error resolving delayed action:", err);
  }
}
