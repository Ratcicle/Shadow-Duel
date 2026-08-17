// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/spellTrap/finalization.js
// Spell/Trap finalization methods for Game class — B.9 extraction
// ─────────────────────────────────────────────────────────────────────────────

import type { GameCard } from "../../contracts/cards.js";
import type {
  MaybePromise,
  MoveCardOptions,
  MoveCardResult,
  SummonExecutionResult,
} from "../../contracts/gameRuntime.js";
import type { GamePlayer } from "../../contracts/player.js";
import type { CanonicalZone } from "../../contracts/zones.js";

type SpellTrapActivationZone = "spellTrap" | "fieldSpell";
type RuntimeCardInstanceId = string | number | null;

interface SpellTrapFinalizationOverride {
  type: "set_source" | "default";
  sourceCardId?: number | null;
  sourceInstanceId?: string | number | null;
  deferUntil?: string | null;
  setTurn?: number | null;
  reason?: string | null;
  ownerId?: string | null;
  activationZone?: SpellTrapActivationZone;
}

type FinalizableCard = GameCard & {
  _instanceId?: string | number | null;
  uuid?: string | null;
  simInstanceId?: string | number | null;
  pendingSpellTrapFinalization?: SpellTrapFinalizationOverride;
};

interface SpellTrapActivationContext {
  effectId?: string | null;
  chainId?: number | null;
  linkId?: number | null;
  spellTrapFinalization?: SpellTrapFinalizationOverride;
}

interface SpellTrapFinalizationOptions {
  activationContext?: SpellTrapActivationContext;
  forceDeferredFinalization?: boolean;
  deferUntil?: string | null;
}

interface SpellTrapFinalizationHost {
  turnCounter: number;
  ui: { log(message: string): void };
  moveCard(
    card: GameCard,
    player: GamePlayer,
    zone: "graveyard" | "hand" | "spellTrap" | "fieldSpell",
    options: MoveCardOptions,
  ): MaybePromise<MoveCardResult | SummonExecutionResult>;
  updateBoard(): unknown;
  devLog?(
    code: string,
    detail: {
      summary: string;
      card?: string;
      reason?: string;
      zone?: string;
      owner?: string;
    },
  ): void;
  assertStateInvariants(
    scope: string,
    options: { failFast: false },
  ): void;
}

interface CardActivationCommitInfo {
  cardRef: FinalizableCard;
  activationZone: SpellTrapActivationZone;
  zoneIndex: number | null;
  fromIndex: number;
  replacedFieldSpell: GameCard | null;
}

interface FieldSpellTrapActivationSnapshot {
  card: FinalizableCard;
  owner: GamePlayer;
  zone?: SpellTrapActivationZone;
  wasFacedown?: boolean;
  previousTurnSetOn?: number | null;
  previousSetTurn?: number | null;
}

interface FailureReasonResult {
  reason?: string;
  code?: string;
}

/**
 * Finalizes spell/trap activation (post-chain resolution).
 * Moves non-continuous spells/traps to graveyard after activation.
 * @param {Card} card - The card being finalized.
 * @param {Player} owner - The card owner.
 * @param {string} activationZone - Zone where activation occurred.
 */
function getCardInstanceId(
  card: FinalizableCard | null | undefined,
): RuntimeCardInstanceId {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? card?.simInstanceId ?? null;
}

function finalizationOverrideMatches(
  card: FinalizableCard | null | undefined,
  override: SpellTrapFinalizationOverride | null | undefined,
): boolean {
  if (!card || !override) return false;
  if (override.sourceCardId !== undefined && override.sourceCardId !== null) {
    if (card.id !== override.sourceCardId) return false;
  }
  const cardInstanceId = getCardInstanceId(card);
  if (
    override.sourceInstanceId !== undefined &&
    override.sourceInstanceId !== null &&
    cardInstanceId !== override.sourceInstanceId
  ) {
    return false;
  }
  return true;
}

function storePendingSpellTrapFinalization(
  card: FinalizableCard | null | undefined,
  owner: GamePlayer | null | undefined,
  activationZone: SpellTrapActivationZone | null,
  override: SpellTrapFinalizationOverride | null | undefined,
): boolean {
  if (!card || !owner || !override) return false;
  card.pendingSpellTrapFinalization = {
    ...override,
    ownerId: owner.id || card.owner || null,
    activationZone: activationZone || "spellTrap",
  };
  return true;
}

async function applyDefaultSpellTrapFinalization(
  game: SpellTrapFinalizationHost,
  card: FinalizableCard | null | undefined,
  owner: GamePlayer | null | undefined,
  activationZone: SpellTrapActivationZone | null,
  options: SpellTrapFinalizationOptions = {},
): Promise<boolean> {
  if (!card || !owner) return false;
  const subtype = card?.subtype || "";
  const kind = card?.cardKind || "";
  const shouldSendToGY =
    (kind === "spell" && (subtype === "normal" || isQuickSpell(card))) ||
    (kind === "trap" && (subtype === "normal" || subtype === "counter"));

  if (!shouldSendToGY) return false;
  if (!isSpellTrapInActivationZone(owner, card, activationZone)) return false;
  if (!activationZone) return false;
  const activationContext = options.activationContext || {};
  await game.moveCard(card, owner, "graveyard", {
    fromZone: activationZone,
    sourceCard: card,
    effectId: activationContext.effectId || null,
    chainId: activationContext.chainId ?? null,
    linkId: activationContext.linkId ?? null,
    contextLabel:
      activationContext.chainId != null
        ? "post_chain_cleanup"
        : "spell_trap_activation_cleanup",
    awaitEvents: true,
    deferCardToGraveTriggerResolution: activationContext.chainId != null,
  });
  game.updateBoard?.();
  return true;
}

function isSpellTrapInActivationZone(
  owner: GamePlayer | null | undefined,
  card: FinalizableCard | null | undefined,
  activationZone: SpellTrapActivationZone | null,
): boolean {
  if (!owner || !card) return false;
  if (activationZone === "fieldSpell") return owner.fieldSpell === card;
  return owner.spellTrap?.includes?.(card) === true;
}

export async function finalizeNegatedSpellTrapActivation(
  game: SpellTrapFinalizationHost | null | undefined,
  card: FinalizableCard | null | undefined,
  owner: GamePlayer | null | undefined,
  activationZone: CanonicalZone | null = null,
  options: SpellTrapFinalizationOptions = {},
): Promise<boolean> {
  if (!game || !card || !owner) return false;
  if (card.cardKind !== "spell" && card.cardKind !== "trap") return false;
  if (
    !activationZone ||
    !isSpellTrapInActivationZone(
      owner,
      card,
      activationZone as SpellTrapActivationZone,
    )
  ) {
    return false;
  }

  await finalizeSpellTrapActivation.call(
    game,
    card,
    owner,
    activationZone as SpellTrapActivationZone,
    options,
  );
  return true;
}

export function applySpellTrapFinalizationOverride(
  this: SpellTrapFinalizationHost,
  card: FinalizableCard | null | undefined,
  owner: GamePlayer | null | undefined,
  activationZone: SpellTrapActivationZone | null = null,
  options: SpellTrapFinalizationOptions = {},
): boolean {
  if (!card || !owner) return false;
  const override = options?.activationContext?.spellTrapFinalization;
  if (!override || (override.type !== "set_source" && override.type !== "default")) {
    return false;
  }
  if (!finalizationOverrideMatches(card, override)) return false;
  if (activationZone !== "spellTrap" && !owner.spellTrap?.includes?.(card)) {
    return false;
  }
  if (!owner.spellTrap?.includes?.(card)) return false;

  if (
    override.deferUntil &&
    options.forceDeferredFinalization !== true
  ) {
    return storePendingSpellTrapFinalization(
      card,
      owner,
      activationZone,
      override,
    );
  }

  if (override.type === "default") return false;

  card.isFacedown = true;
  const setTurn = Number.isFinite(override.setTurn)
    ? override.setTurn
    : Number(this?.turnCounter || 0);
  card.turnSetOn = setTurn;
  card.setTurn = setTurn;

  this.devLog?.("SPELL_TRAP_SET_AFTER_RESOLUTION", {
    summary: `${card.name || "Spell/Trap"} was Set after resolution.`,
    card: card.name,
    reason: override.reason || "set_after_resolution",
  });
  this.updateBoard?.();
  return true;
}

export async function resolvePendingSpellTrapFinalization(
  this: SpellTrapFinalizationHost,
  card: FinalizableCard | null | undefined,
  owner: GamePlayer | null | undefined,
  activationZone: SpellTrapActivationZone = "spellTrap",
  options: SpellTrapFinalizationOptions = {},
): Promise<boolean> {
  if (!card || !owner) return false;
  const pending = card.pendingSpellTrapFinalization;
  if (!pending) return false;
  if (!finalizationOverrideMatches(card, pending)) return false;
  if (pending.deferUntil && pending.deferUntil !== options.deferUntil) {
    return false;
  }

  delete card.pendingSpellTrapFinalization;

  if (!owner.spellTrap?.includes?.(card)) {
    return false;
  }

  if (pending.type === "set_source") {
    return applySpellTrapFinalizationOverride.call(
      this,
      card,
      owner,
      activationZone || pending.activationZone || "spellTrap",
      {
        activationContext: { spellTrapFinalization: pending },
        forceDeferredFinalization: true,
      },
    );
  }

  if (pending.type === "default") {
    return await applyDefaultSpellTrapFinalization(
      this,
      card,
      owner,
      activationZone || pending.activationZone || "spellTrap",
      options,
    );
  }

  return false;
}

export async function finalizeSpellTrapActivation(
  this: SpellTrapFinalizationHost,
  card: FinalizableCard | null | undefined,
  owner: GamePlayer | null | undefined,
  activationZone: SpellTrapActivationZone | null = null,
  options: SpellTrapFinalizationOptions = {},
): Promise<void> {
  if (!card || !owner) return;
  if (
    applySpellTrapFinalizationOverride.call(
      this,
      card,
      owner,
      activationZone,
      options,
    )
  ) {
    return;
  }

  await applyDefaultSpellTrapFinalization(
    this,
    card,
    owner,
    activationZone,
    options,
  );
}
/**
 * Move a Spell/Trap from hand to the appropriate zone before resolving
 * activation. Returns the committed card reference and activation zone.
 * @param {Player} player - The player performing activation.
 * @param {number} handIndex - Index of the card in hand.
 * @returns Commit info with cardRef, activationZone, etc.
 */
export async function commitCardActivationFromHand(
  this: SpellTrapFinalizationHost,
  player: GamePlayer | null | undefined,
  handIndex: number | null | undefined,
): Promise<CardActivationCommitInfo | null> {
  if (!player || handIndex == null) return null;
  const card = player.hand?.[handIndex];
  if (!card) return null;
  if (card.cardKind !== "spell" && card.cardKind !== "trap") return null;

  const isFieldSpell = card.subtype === "field";
  const activationZone = isFieldSpell ? "fieldSpell" : "spellTrap";
  const replacedFieldSpell = isFieldSpell ? player.fieldSpell : null;

  // Check zone capacity
  if (!isFieldSpell && player.spellTrap.length >= 5) {
    this.ui.log("Spell/Trap zone is full (max 5 cards).");
    return null;
  }

  // Ensure face-up when placed
  const wasFacedown = card.isFacedown === true;
  card.isFacedown = false;

  // Move to destination
  if (typeof this.moveCard === "function") {
    const moveResult = await this.moveCard(card, player, activationZone, {
      fromZone: "hand",
    });
    const committed =
      activationZone === "fieldSpell"
        ? player.fieldSpell === card
        : player.spellTrap.includes(card);
    if (moveResult?.success === false || !committed) {
      card.isFacedown = wasFacedown;
      return null;
    }
  } else {
    card.isFacedown = wasFacedown;
    return null;
  }

  // Determine zone index if in S/T array
  const zoneIndex =
    activationZone === "spellTrap" ? player.spellTrap.indexOf(card) : null;

  this.updateBoard();

  return {
    cardRef: card,
    activationZone,
    zoneIndex,
    fromIndex: handIndex,
    replacedFieldSpell,
  };
}

/**
 * Rollback a spell activation if it fails mid-process.
 * @param {Player} player - The player whose activation is being rolled back.
 * @param commitInfo - Info from commitCardActivationFromHand.
 */
export async function rollbackSpellActivation(
  this: SpellTrapFinalizationHost,
  player: GamePlayer | null | undefined,
  commitInfo: CardActivationCommitInfo | null | undefined,
): Promise<void> {
  if (!player || !commitInfo || !commitInfo.cardRef) return;
  const { cardRef, activationZone, fromIndex, replacedFieldSpell } = commitInfo;
  const sourceZone = activationZone || "spellTrap";
  await this.moveCard(cardRef, player, "hand", { fromZone: sourceZone });

  if (
    typeof fromIndex === "number" &&
    fromIndex >= 0 &&
    fromIndex < player.hand.length
  ) {
    const currentIndex = player.hand.indexOf(cardRef);
    if (currentIndex > -1 && currentIndex !== fromIndex) {
      player.hand.splice(currentIndex, 1);
      player.hand.splice(fromIndex, 0, cardRef);
    }
  }

  if (
    activationZone === "fieldSpell" &&
    replacedFieldSpell &&
    player.graveyard?.includes(replacedFieldSpell)
  ) {
    await this.moveCard(replacedFieldSpell, player, "fieldSpell", {
      fromZone: "graveyard",
    });
  }

  this.updateBoard();
  this.assertStateInvariants("rollbackSpellActivation", { failFast: false });
}

import { isQuickSpell } from "./quickSpellRules.js";

/**
 * Restore a Set field Spell/Trap activation that failed after being revealed.
 * This intentionally does not move cards between zones; it only rolls back
 * reveal metadata when the card is still in its original Spell/Trap zone.
 * @param snapshot - Field activation state captured before reveal.
 * @param reasonOrResult - Failure/cancel reason for dev logs.
 * @returns {boolean} Whether rollback was applied.
 */
export function rollbackFieldSpellTrapActivation(
  this: SpellTrapFinalizationHost,
  snapshot: FieldSpellTrapActivationSnapshot | null | undefined,
  reasonOrResult: string | FailureReasonResult | null = null,
): boolean {
  if (!snapshot || !snapshot.card || !snapshot.owner) return false;
  const {
    card,
    owner,
    zone = "spellTrap",
    wasFacedown,
    previousTurnSetOn,
    previousSetTurn,
  } = snapshot;

  const reason =
    typeof reasonOrResult === "string"
      ? reasonOrResult
      : reasonOrResult?.reason || reasonOrResult?.code || "activation_failed";

  if (zone !== "spellTrap" || !owner.spellTrap?.includes?.(card)) {
    this.devLog?.("FIELD_SPELL_TRAP_ROLLBACK_SKIPPED", {
      summary: `${card.name || "Unknown card"} rollback skipped (${reason})`,
      reason,
      zone,
      owner: owner.id,
    });
    return false;
  }

  if (typeof wasFacedown === "boolean") {
    card.isFacedown = wasFacedown;
  }
  card.turnSetOn = previousTurnSetOn;
  card.setTurn = previousSetTurn;

  this.devLog?.("FIELD_SPELL_TRAP_ROLLBACK", {
    summary: `${card.name || "Unknown card"} restored after ${reason}`,
    reason,
    zone,
    owner: owner.id,
  });
  this.updateBoard?.();
  return true;
}
