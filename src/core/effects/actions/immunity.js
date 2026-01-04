/**
 * Immunity Actions - effect immunity granting
 * Extracted from EffectEngine.js – preserving original logic and signatures.
 */

/**
 * Apply grant Void fusion immunity action
 * @param {Object} action - Action configuration
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

  const archetypes = card.archetypes
    ? card.archetypes
    : card.archetype
    ? [card.archetype]
    : [];
  if (!archetypes.includes("Void")) {
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
