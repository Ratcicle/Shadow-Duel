/**
 * Combat damage application - centralized damage infliction.
 * Extracted from Game.js as part of B.5 modularization.
 */

import type { GameCard } from "../../contracts/cards.js";
import type { GamePlayer } from "../../contracts/player.js";
import type {
  DamageInflictedEventPayload,
  InformationalEventName,
  InformationalEventMap,
  LpChangeEventPayload,
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
  screenShake?: boolean | undefined;
  suppressVisual?: boolean;
  suppressLpChangeFeedback?: boolean;
  suppressLpDamageSequence?: boolean;
  /** Battle publishes the occurrence at its after-calculation window. */
  deferLpChangeEvent?: boolean;
}

interface DamageUiPort {
  showLpDamageSequence?(
    player: GamePlayer,
    amount: number,
    options: DamagePresentationOptions & { fromLp: number; toLp: number },
  ): void;
}

interface DamageHost {
  player: GamePlayer;
  bot: GamePlayer;
  ui?: DamageUiPort | null;
  emit?(eventName: "lp_change", payload: LpChangeEventPayload): Promise<unknown>;
  notify?<Name extends InformationalEventName>(
    eventName: Name,
    payload: InformationalEventMap[Name],
  ): void;
}

/**
 * Apply damage to a player through the centralized damage pipeline.
 * Publishes one canonical LP occurrence for normal trigger collection.
 * Should be used instead of direct player.takeDamage() calls.
 *
 * @param player - Player taking damage
 * @param {number} amount - Damage amount
 * @param options - Additional context (cause, sourceCard, etc.)
 */
export async function inflictDamage(
  this: DamageHost,
  player: GamePlayer | null | undefined,
  amount: number,
  options: DamagePresentationOptions = {},
): Promise<void> {
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

    if (
      !suppressVisual &&
      typeof this.ui?.showLpDamageSequence === "function"
    ) {
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
    if (!options.deferLpChangeEvent) {
      await this.emit?.("lp_change", {
        player,
        sourceCard: options.sourceCard || null,
        before,
        after: player.lp,
        lpGained: 0,
        lpLost: actual,
        lpPaid: 0,
        damageAmount: actual,
        damagedPlayer: player,
      });
    }
  }
}
