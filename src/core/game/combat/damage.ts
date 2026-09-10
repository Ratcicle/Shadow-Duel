/**
 * Combat damage application - centralized damage infliction.
 * Extracted from Game.js as part of B.5 modularization.
 */

import type { ActionOf } from "../../contracts/actions.js";
import type { GameCard } from "../../contracts/cards.js";
import type { GamePlayer } from "../../contracts/player.js";
import type {
  DamageInflictedEventPayload,
  InformationalEventName,
  InformationalEventMap,
} from "../../contracts/events.js";

interface DamagePresentationOptions {
  cause?: string;
  sourceCard?: GameCard | null;
  targetCard?: GameCard | null;
  sourceRect?: import("../../contracts/ui.js").UiRect | null;
  targetRect?: object | null;
  battleImpactRect?: object | null;
  contactRect?: object | null;
  directAttack?: boolean;
  screenShake?: boolean;
  suppressVisual?: boolean;
  suppressLpChangeFeedback?: boolean;
  suppressLpDamageSequence?: boolean;
  triggerOpponentDamage?: boolean;
}

interface DamageUiPort {
  showLpDamageSequence?(
    player: GamePlayer,
    amount: number,
    options: DamagePresentationOptions & { fromLp: number; toLp: number },
  ): void;
}

interface DamageEffectEnginePort {
  applyDamage(
    action: ActionOf<"damage"> & { triggerOnly: true },
    context: {
      player: GamePlayer;
      opponent: GamePlayer;
      source: GameCard | null;
    },
  ): unknown;
}

interface DamageHost {
  player: GamePlayer;
  bot: GamePlayer;
  ui?: DamageUiPort | null;
  effectEngine?: DamageEffectEnginePort | null;
  notify?<Name extends InformationalEventName>(
    eventName: Name,
    payload: InformationalEventMap[Name],
  ): void;
}

/**
 * Apply damage to a player through the centralized damage pipeline.
 * Triggers opponent_damage effects via EffectEngine.
 * Should be used instead of direct player.takeDamage() calls.
 *
 * @param player - Player taking damage
 * @param {number} amount - Damage amount
 * @param options - Additional context (cause, sourceCard, etc.)
 */
export function inflictDamage(
  this: DamageHost,
  player: GamePlayer | null | undefined,
  amount: number,
  options: DamagePresentationOptions = {},
): void {
  if (!player || !amount || amount <= 0) return;

  // Apply the damage to player LP
  const before = player.lp || 0;
  const suppressVisual =
    options.suppressVisual === true ||
    options.suppressLpChangeFeedback === true ||
    options.suppressLpDamageSequence === true;
  player.takeDamage(amount, {
    suppressVisual: true,
  });
  const actual = Math.max(0, before - (player.lp || 0));
  if (actual > 0) {
    player.damageReceivedThisTurn =
      Math.max(0, Number(player.damageReceivedThisTurn || 0)) + actual;

    if (!suppressVisual && typeof this.ui?.showLpDamageSequence === "function") {
      this.ui.showLpDamageSequence(player, actual, {
        cause: options.cause || "effect",
        sourceCard: options.sourceCard || null,
        targetCard: options.targetCard || null,
        sourceRect: options.sourceRect || null,
        targetRect: options.targetRect || null,
        battleImpactRect: options.battleImpactRect || null,
        contactRect: options.contactRect || null,
        directAttack: options.directAttack === true,
        fromLp: before,
        toLp: player.lp,
        screenShake: options.screenShake,
      });
    }

    const payload: DamageInflictedEventPayload = {
      target: player,
      sourceCard: options.sourceCard || null,
      amount: actual,
      lpLost: actual,
      newLP: player.lp,
    };
    this.notify?.("damage_inflicted", payload);
  }

  // Trigger opponent_damage effects via EffectEngine
  if (
    options.triggerOpponentDamage !== false &&
    this.effectEngine &&
    typeof this.effectEngine.applyDamage === "function"
  ) {
    const opponent = player === this.player ? this.bot : this.player;
    const ctx = {
      player: opponent, // The one whose effects will trigger
      opponent: player, // The one taking damage
      source: options.sourceCard || null,
    };
    const action: ActionOf<"damage"> & { triggerOnly: true } = {
      type: "damage",
      player: "opponent", // From opponent's perspective
      amount: amount,
      triggerOnly: true, // Don't apply damage again, just trigger effects
    };

    // This will trigger all opponent_damage effects
    this.effectEngine.applyDamage(action, ctx);
  }
}
