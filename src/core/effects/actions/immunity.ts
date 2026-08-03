import type Game from "../../Game.js";
import type { ActionRuntimeCard, EffectContext } from "../../contracts/actionRuntime.js";
import type { ActionOf } from "../../contracts/actions.js";

interface ImmuneRuntimeCard extends ActionRuntimeCard {
  immuneToOpponentEffectsUntilTurn?: number;
}

interface ImmunityActionHost {
  game: Game;
  readonly ui: { log?(message: string): void } | null;
}

/**
 * Immunity Actions - effect immunity granting
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Apply grant fusion immunity action to a Fusion Monster of a specified archetype.
 * Grants temporary immunity to opponent's effects.
 * 
 * Note: Function name kept as applyGrantVoidFusionImmunity for backwards compatibility
 * with wiring.js, but the implementation is now generic and uses action.archetype.
 * 
 * @param {Object} action - Action configuration
 * @param {string} action.archetype - Required archetype filter (e.g., "Void")
 * @param {number} [action.durationTurns=1] - Duration of immunity in turns
 * @param {Object} ctx - Context object with summonedCard and player
 * @returns {boolean} Whether immunity was granted
 */
export function applyGrantVoidFusionImmunity(
  this: ImmunityActionHost,
  action: ActionOf<"grant_void_fusion_immunity">,
  ctx: EffectContext,
): boolean {
  const card = ctx?.summonedCard as ImmuneRuntimeCard | null | undefined;
  const player = ctx?.player;
  if (
    !card ||
    !player ||
    card.cardKind !== "monster" ||
    card.monsterType !== "fusion" ||
    card.owner !== player.id
  ) {
    return false;
  }

  // Use action.archetype if provided, otherwise require it
  const requiredArchetype = action?.archetype;
  if (!requiredArchetype) {
    console.warn("[applyGrantVoidFusionImmunity] action.archetype is required");
    return false;
  }

  const archetypes = card.archetypes
    ? card.archetypes
    : card.archetype
    ? [card.archetype]
    : [];
  if (!archetypes.includes(requiredArchetype)) {
    return false;
  }

  const duration = Math.max(1, action.durationTurns ?? 1);
  const untilTurn = (this.game?.turnCounter ?? 0) + duration;
  card.immuneToOpponentEffectsUntilTurn = Math.max(
    card.immuneToOpponentEffectsUntilTurn ?? 0,
    untilTurn
  );

  if (this.ui?.log) {
    this.ui.log(
      `${card.name} está imune aos efeitos do oponente até o final do próximo turno.`
    );
  }

  return true;
}
