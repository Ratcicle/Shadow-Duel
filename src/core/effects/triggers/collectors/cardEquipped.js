import { debugTriggerLog } from "./shared.js";

/**
 * Collects trigger entries for card_equipped event.
 * @param {Object} payload - Equip event payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectCardEquippedTriggers(payload) {
  const entries = [];
  const orderRule =
    "equip owner -> equipped owner; sources: equipped card -> equip spell";

  if (!payload || !payload.target || !payload.equipCard) {
    return { entries, orderRule };
  }

  const actionContext = payload?.actionContext || null;
  const equippedCard = payload.target;
  const equipCard = payload.equipCard;
  const equippedOwner =
    payload.targetOwner || this.getOwnerByCard?.(equippedCard);
  const equipOwner = payload.equipOwner || this.getOwnerByCard?.(equipCard);

  const participants = [];
  if (equippedOwner && equippedCard) {
    participants.push({
      owner: equippedOwner,
      opponent: this.game?.getOpponent?.(equippedOwner),
      sourceCard: equippedCard,
    });
  }
  if (equipOwner && equipCard) {
    participants.push({
      owner: equipOwner,
      opponent: this.game?.getOpponent?.(equipOwner),
      sourceCard: equipCard,
    });
  }

  for (const participant of participants) {
    const owner = participant.owner;
    const opponent = participant.opponent;
    const card = participant.sourceCard;
    if (!card?.effects || !Array.isArray(card.effects)) continue;

    const sourceZone = this.findCardZone?.(owner, card) || "field";
    const isFaceDownOnBoard =
      card?.isFacedown === true &&
      ["field", "spellTrap", "fieldSpell"].includes(sourceZone);
    const ctx = {
      source: card,
      player: owner,
      opponent,
      equipCard,
      equipOwner,
      equippedCard,
      equippedOwner,
      target: equippedCard,
      targetOwner: equippedOwner,
      actionContext,
    };

    for (const effect of card.effects) {
      if (!effect || effect.timing !== "on_event") continue;
      if (effect.event !== "card_equipped") continue;

      // Face-down cards on the field cannot activate triggered effects
      if (isFaceDownOnBoard) {
        continue;
      }

      // Check requireFaceup condition
      if (effect.requireFaceup === true && card.isFacedown === true) {
        debugTriggerLog(this,
          `[card_equipped] Skipping effect on ${card.name}: requireFaceup=true but card is facedown`,
        );
        continue;
      }

      const optCheck = this.checkOncePerTurn(card, owner, effect);
      if (!optCheck.ok) {
        debugTriggerLog(this, optCheck.reason);
        continue;
      }

      const duelCheck = this.checkOncePerDuel(card, owner, effect);
      if (!duelCheck.ok) {
        debugTriggerLog(this, duelCheck.reason);
        continue;
      }

      if (effect.requireEquipCardFilters) {
        if (
          !this.cardMatchesFilters(equipCard, effect.requireEquipCardFilters)
        ) {
          continue;
        }
      }

      if (effect.requireEquippedCardFilters) {
        if (
          !this.cardMatchesFilters(
            equippedCard,
            effect.requireEquippedCardFilters,
          )
        ) {
          continue;
        }
      }

      const activationContext = this.buildTriggerActivationContext(
        card,
        owner,
        sourceZone,
      );

      const entry = this.buildTriggerEntry({
        sourceCard: card,
        owner,
        effect,
        ctx,
        activationContext,
        selectionKind: "triggered",
        selectionMessage: "Select target(s) for the triggered effect.",
      });

      if (entry) {
        entries.push(entry);
      }
    }
  }

  return { entries, orderRule };
}
