/**
 * serialization.js
 *
 * Public state serialization extracted from Game.js.
 * Builds a sanitized snapshot of the game state suitable for replays,
 * AI inspection, and (eventually) network sync. Hides opponent hand
 * contents and face-down details.
 *
 * Methods:
 *  - getPublicState
 */

/**
 * Build a serialized, public-safe snapshot of the current game state.
 * Hides opponent hand contents and face-down card details.
 * @param {"player"|"bot"} forPlayerId
 * @returns {Object} snapshot JSON
 */
export function getPublicState(forPlayerId = "player") {
  const viewPlayer =
    forPlayerId === this.bot.id || forPlayerId === "bot"
      ? this.bot
      : this.player;
  const opp = viewPlayer === this.player ? this.bot : this.player;

  const serializeField = (owner, isSelf) =>
    (owner.field || []).map((card) => {
      if (!card) return null;
      const hidden = card.isFacedown && !isSelf;
      return {
        cardId: card.id,
        name: hidden ? null : card.name,
        position: card.position,
        atk: hidden ? null : card.atk,
        def: hidden ? null : card.def,
        level: hidden ? null : card.level,
        isTuner: hidden ? null : card.isTuner === true,
        faceDown: !!card.isFacedown,
        status: {
          cannotAttackThisTurn: !!card.cannotAttackThisTurn,
          effectsNegated: !!card.effectsNegated,
          effectsNegatedDuration: card.effectsNegatedDuration || null,
          canAttackAll: !!card.canAttackAllOpponentMonstersThisTurn,
        },
      };
    });

  const serializeHand = (owner, isSelf) =>
    isSelf
      ? (owner.hand || []).map((card) => ({
          cardId: card.id,
          name: card.name,
          atk: card.atk,
          def: card.def,
          level: card.level,
          isTuner: card.isTuner === true,
          cardKind: card.cardKind,
        }))
      : { count: (owner.hand || []).length };

  const serializeSpells = (owner, isSelf) =>
    (owner.spellTrap || []).map((card) => {
      if (!card) return null;
      const hidden = card.isFacedown && !isSelf;
      return {
        cardId: card.id,
        name: hidden ? null : card.name,
        faceDown: !!card.isFacedown,
        cardKind: card.cardKind,
        subtype: hidden ? null : card.subtype,
      };
    });

  const serializeGraveyard = (owner) =>
    (owner.graveyard || []).map((card) => ({
      cardId: card.id,
      name: card.name,
      cardKind: card.cardKind,
      subtype: card.subtype ?? null,
      atk: card.cardKind === "monster" ? (card.atk ?? null) : null,
      def: card.cardKind === "monster" ? (card.def ?? null) : null,
      level: card.cardKind === "monster" ? (card.level ?? null) : null,
      isTuner: card.cardKind === "monster" ? card.isTuner === true : null,
    }));

  const buildPlayerView = (owner, isSelf) => ({
    id: owner.id,
    name: owner.name,
    lp: owner.lp,
    damageReceivedThisTurn: owner.damageReceivedThisTurn || 0,
    specialSummonRestrictions: Array.isArray(owner.specialSummonRestrictions)
      ? owner.specialSummonRestrictions.map((restriction) => ({
          allowedFilters: restriction.allowedFilters || {},
          duration: restriction.duration || null,
          expiresOnTurn: restriction.expiresOnTurn ?? null,
          reason: restriction.reason || null,
          sourceName: restriction.sourceName || null,
          sourceId: restriction.sourceId ?? null,
        }))
      : [],
    hand: serializeHand(owner, isSelf),
    handCount: (owner.hand || []).length,
    field: serializeField(owner, isSelf),
    spellTrap: serializeSpells(owner, isSelf),
    fieldSpell: owner.fieldSpell
      ? {
          cardId: owner.fieldSpell.id,
          name:
            isSelf || !owner.fieldSpell.isFacedown
              ? owner.fieldSpell.name
              : null,
          faceDown: !!owner.fieldSpell.isFacedown,
        }
      : null,
    graveyardCount: (owner.graveyard || []).length,
    graveyard: serializeGraveyard(owner),
  });

  return {
    turn: this.turn,
    phase: this.phase,
    turnCounter: this.turnCounter,
    currentPlayer: this.turn === "player" ? this.player.id : this.bot.id,
    players: {
      self: buildPlayerView(viewPlayer, true),
      opponent: buildPlayerView(opp, false),
    },
  };
}
