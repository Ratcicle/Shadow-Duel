/**
 * Immunity Actions - effect immunity granting
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Apply grant fusion immunity action
 * Can be configured via action.archetype to apply to any archetype's fusion monsters
 * @param {Object} action - Action configuration
 * @param {Object} action.archetype - Required archetype filter (e.g., "Void")
 * @param {number} [action.durationTurns=1] - Duration of immunity in turns
 * @param {Object} ctx - Context object
 * @returns {boolean} Whether immunity was granted
 */
export function applyGrantVoidFusionImmunity(action, ctx) {
  const card = ctx?.summonedCard;
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
