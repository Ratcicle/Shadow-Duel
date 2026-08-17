/**
 * Combat visual indicators - attack ready and resolution markers.
 * Extracted from Game.js as part of B.5 modularization.
 */

import type { GameCard } from "../../contracts/cards.js";
import type { GamePlayer } from "../../contracts/player.js";

interface AttackAvailabilityResult {
  ok: boolean;
}

interface AttackResolutionIndicatorState {
  attackerOwner: "player" | "bot";
  attackerIndex: number;
  targetOwner: "player" | "bot";
  targetIndex: number;
  directAttack: boolean;
}

interface CombatIndicatorUiPort {
  applyAttackReadyIndicators?(owner: "player", indices: number[]): void;
  clearAttackReadyIndicators?(): void;
  applyAttackResolutionIndicators?(
    state: AttackResolutionIndicatorState,
  ): void;
  clearAttackResolutionIndicators?(): void;
}

interface CombatIndicatorHost {
  player: GamePlayer;
  bot: GamePlayer;
  turn: string;
  phase: string;
  selectionState?: string | null;
  isResolvingEffect?: boolean;
  eventResolutionDepth: number;
  ui?: CombatIndicatorUiPort | null;
  clearAttackReadyIndicators(): void;
  getAttackAvailability(card: GameCard): AttackAvailabilityResult;
}

/**
 * Update attack ready indicators for player's monsters.
 * Shows which monsters can attack during battle phase.
 */
export function updateAttackIndicators(this: CombatIndicatorHost): void {
  this.clearAttackReadyIndicators();

  const selectionState = this.selectionState || "idle";
  const hasActiveSelection = selectionState !== "idle";
  if (
    this.turn !== "player" ||
    this.phase !== "battle" ||
    hasActiveSelection ||
    this.isResolvingEffect ||
    this.eventResolutionDepth > 0
  ) {
    return;
  }

  const field = this.player.field || [];
  const readyIndices: number[] = [];
  field.forEach((card, index) => {
    if (!card || card.cardKind !== "monster") return;
    const availability = this.getAttackAvailability(card);
    if (!availability.ok) return;
    if (card.isFacedown) return;
    readyIndices.push(index);
  });
  if (this.ui && typeof this.ui.applyAttackReadyIndicators === "function") {
    this.ui.applyAttackReadyIndicators("player", readyIndices);
  }
}

/**
 * Clear all attack ready indicators from the UI.
 */
export function clearAttackReadyIndicators(this: CombatIndicatorHost): void {
  if (this.ui && typeof this.ui.clearAttackReadyIndicators === "function") {
    this.ui.clearAttackReadyIndicators();
  }
}

/**
 * Apply attack resolution indicators showing attacker and target.
 * @param attacker - The attacking monster
 * @param target - The target monster (null for direct attack)
 */
export function applyAttackResolutionIndicators(
  this: CombatIndicatorHost,
  attacker: GameCard,
  target: GameCard | null,
): void {
  const attackerOwner = attacker?.owner === "player" ? "player" : "bot";
  const attackerField =
    attackerOwner === "player" ? this.player.field : this.bot.field;
  const attackerIndex = attackerField.indexOf(attacker);
  const targetOwner = target?.owner === "player" ? "player" : "bot";
  const targetField =
    targetOwner === "player" ? this.player.field : this.bot.field;
  const targetIndex = target ? targetField.indexOf(target) : -1;

  if (
    this.ui &&
    typeof this.ui.applyAttackResolutionIndicators === "function"
  ) {
    this.ui.applyAttackResolutionIndicators({
      attackerOwner,
      attackerIndex,
      targetOwner,
      targetIndex,
      directAttack: !target,
    });
  }
}

/**
 * Clear attack resolution indicators from the UI.
 */
export function clearAttackResolutionIndicators(
  this: CombatIndicatorHost,
): void {
  if (
    this.ui &&
    typeof this.ui.clearAttackResolutionIndicators === "function"
  ) {
    this.ui.clearAttackResolutionIndicators();
  }
}
