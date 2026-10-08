import { trackFaceupStatus } from "../../Card.js";
import type { ActionOf } from "../../contracts/actions.js";

interface ImmuneRuntimeCard {
  readonly cardKind?: string | null | undefined;
  readonly monsterType?: string | null | undefined;
  readonly owner?: string | undefined;
  readonly archetypes?: readonly string[] | undefined;
  readonly archetype?: string | null | undefined;
  readonly name?: string | null | undefined;
  unaffectedByOpponentCardEffects?: boolean;
  immuneToOpponentEffectsUntilTurn?: number | null;
}

interface ImmunityActionHost {
  readonly game: { readonly turnCounter?: number };
  readonly ui: { log?(message: string): void } | null;
}

interface ImmunityActionContext {
  readonly summonedCard?: ImmuneRuntimeCard | null;
  readonly player?: { readonly id: string } | null;
}

/**
 * Immunity Actions - effect immunity granting
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Apply grant fusion immunity action to a Fusion Monster of a specified archetype.
 * Grants immunity to opponent effects for the declared duration or face-up presence.
 * 
 * Note: Function name kept as applyGrantVoidFusionImmunity for backwards compatibility
 * with wiring.js, but the implementation is now generic and uses action.archetype.
 * 
 * @param {Object} action - Action configuration
 * @param {string} action.archetype - Required archetype filter (e.g., "Void")
 * @param {number} [action.durationTurns] - Explicit turn duration; omitted lasts while face-up
 * @param {Object} ctx - Context object with summonedCard and player
 * @returns {boolean} Whether immunity was granted
 */
export function applyGrantVoidFusionImmunity(
  this: ImmunityActionHost,
  action: ActionOf<"grant_void_fusion_immunity">,
  ctx: ImmunityActionContext,
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

  if (action.durationTurns === undefined) {
    trackFaceupStatus(card, "unaffectedByOpponentCardEffects");
    card.unaffectedByOpponentCardEffects = true;
    this.ui?.log?.(`${card.name} is immune to the opponent's effects while face-up.`);
    return true;
  }
  const duration = Math.max(1, action.durationTurns);
  const untilTurn = (this.game?.turnCounter ?? 0) + duration;
  card.immuneToOpponentEffectsUntilTurn = Math.max(
    card.immuneToOpponentEffectsUntilTurn ?? 0,
    untilTurn
  );

  if (this.ui?.log) {
    this.ui.log(
      `${card.name} is immune to the opponent's effects until the end of turn ${untilTurn}.`
    );
  }

  return true;
}
