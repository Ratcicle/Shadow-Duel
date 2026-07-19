/**
 * Control-change operations.
 *
 * A control change moves a monster between the two Monster Zones without
 * making it leave the field. It deliberately does not use moveCard(): that
 * method represents a zone change, updates locationVersion and emits
 * card_moved, none of which apply to a control change.
 */

function getPlayerById(game, playerId) {
  if (!game || !playerId) return null;
  if (game.player?.id === playerId) return game.player;
  if (game.bot?.id === playerId) return game.bot;
  return null;
}

function getCardInstanceId(card) {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? null;
}

function findFieldController(game, card) {
  if (!game || !card) return null;
  for (const player of [game.player, game.bot]) {
    if (Array.isArray(player?.field) && player.field.includes(card)) {
      return player;
    }
  }
  return null;
}

function removeFromField(player, card) {
  if (!player || !card || !Array.isArray(player.field)) return false;
  const index = player.field.indexOf(card);
  if (index < 0) return false;
  player.field.splice(index, 1);
  return true;
}

function publicControlRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    cardInstanceId: record.cardInstanceId,
    holderId: record.holderId,
    previousControllerId: record.previousControllerId,
    expiresOnTurn: record.expiresOnTurn,
    sourceInstanceId: record.sourceInstanceId,
    createdOnTurn: record.createdOnTurn,
  };
}

/**
 * Transfers control of one face-up or face-down monster while it remains in a
 * Monster Zone. `originalOwner` is intentionally never changed.
 */
export async function transferControl(card, nextController, options = {}) {
  if (!card || card.cardKind !== "monster" || !nextController) {
    return { success: false, reason: "invalid_control_target" };
  }

  const previousController = findFieldController(this, card);
  if (!previousController) {
    return { success: false, reason: "target_not_on_field" };
  }

  if (previousController === nextController) {
    return {
      success: true,
      unchanged: true,
      card,
      fromPlayer: previousController,
      toPlayer: nextController,
    };
  }

  if ((nextController.field || []).length >= 5) {
    return { success: false, reason: "field_full" };
  }

  if (!removeFromField(previousController, card)) {
    return { success: false, reason: "target_not_on_field" };
  }

  // A later control-changing effect supersedes any pending temporary return.
  // The card still remains on the field, so instance-bound leave-field
  // watchers are intentionally left untouched.
  if (Array.isArray(this.temporaryControlEffects)) {
    const cardInstanceId = getCardInstanceId(card);
    this.temporaryControlEffects = this.temporaryControlEffects.filter(
      (entry) => entry?.cardInstanceId !== cardInstanceId,
    );
  }

  nextController.field.push(card);
  card.owner = nextController.id;
  card.controller = nextController.id;
  if (!card.originalOwner) {
    card.originalOwner = previousController.id;
  }

  this.effectEngine?.clearTargetingCache?.();
  this.updateBoard?.();

  const payload = {
    card,
    fromPlayer: previousController,
    toPlayer: nextController,
    previousControllerId: previousController.id,
    controllerId: nextController.id,
    originalOwnerId: card.originalOwner || null,
    sourceCard: options.sourceCard || null,
    effectId: options.effectId || null,
    reason: options.reason || "effect",
    temporaryControlId: options.temporaryControlId || null,
  };
  await this.emit?.("control_changed", payload);

  return {
    success: true,
    card,
    fromPlayer: previousController,
    toPlayer: nextController,
  };
}

/**
 * Records a control-change expiration after the transfer succeeds. The
 * record is bound to the card instance and current holder so a later control
 * change cannot be overwritten at the End Phase.
 */
export function registerTemporaryControl(card, options = {}) {
  if (!card || !options?.holder) return null;
  if (!Array.isArray(this.temporaryControlEffects)) {
    this.temporaryControlEffects = [];
  }

  const record = {
    id:
      options.id ||
      this.createDeterministicId?.("temporary_control") ||
      `temporary_control_${this.temporaryControlEffects.length + 1}`,
    cardInstanceId: getCardInstanceId(card),
    holderId: options.holder.id,
    previousControllerId: options.previousControllerId || null,
    expiresOnTurn: Number(options.expiresOnTurn ?? this.turnCounter ?? 0),
    sourceInstanceId: getCardInstanceId(options.sourceCard),
    createdOnTurn: Number(this.turnCounter || 0),
  };
  this.temporaryControlEffects.push(record);
  return publicControlRecord(record);
}

/**
 * Takes control of a monster and, when requested, tracks its return at the
 * End Phase of the current turn.
 */
export async function takeControl(card, controller, options = {}) {
  const previousController = findFieldController(this, card);
  const result = await this.transferControl(card, controller, {
    ...options,
    reason: options.reason || "take_control",
  });
  if (!result?.success || options.duration !== "until_end_phase") {
    return result;
  }

  const record = this.registerTemporaryControl(card, {
    holder: controller,
    previousControllerId: previousController?.id || null,
    expiresOnTurn: this.turnCounter,
    sourceCard: options.sourceCard || null,
  });
  return { ...result, temporaryControl: record };
}

/**
 * Resolves control effects that expire at the current End Phase. A record is
 * discarded if the card left the field or changed controller again; that is
 * what prevents one temporary effect from overwriting a newer one.
 */
export async function processTemporaryControlEffects() {
  if (!Array.isArray(this.temporaryControlEffects)) {
    this.temporaryControlEffects = [];
    return [];
  }

  const currentTurn = Number(this.turnCounter || 0);
  const expiring = this.temporaryControlEffects.filter(
    (entry) => Number(entry?.expiresOnTurn) === currentTurn,
  );
  this.temporaryControlEffects = this.temporaryControlEffects.filter(
    (entry) => Number(entry?.expiresOnTurn) !== currentTurn,
  );

  const results = [];
  for (const entry of expiring) {
    const card = [this.player, this.bot]
      .flatMap((player) => player?.field || [])
      .find((candidate) => getCardInstanceId(candidate) === entry.cardInstanceId);
    const holder = getPlayerById(this, entry.holderId);
    const previousController = getPlayerById(this, entry.previousControllerId);

    if (!card || !holder || !previousController || !holder.field.includes(card)) {
      results.push({ ...publicControlRecord(entry), returned: false, reason: "control_changed_or_left_field" });
      continue;
    }

    const result = await this.transferControl(card, previousController, {
      reason: "temporary_control_expired",
      temporaryControlId: entry.id,
    });
    results.push({ ...publicControlRecord(entry), returned: result?.success === true, reason: result?.reason || null });
  }

  return results;
}

export function getTemporaryControlState() {
  return (this.temporaryControlEffects || []).map(publicControlRecord);
}
