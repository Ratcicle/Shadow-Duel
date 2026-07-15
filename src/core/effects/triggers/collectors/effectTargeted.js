import { debugTriggerLog } from "./shared.js";

/**
 * Collects trigger entries for effect_targeted event.
 * @param {Object} payload - Effect targeted event payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectEffectTargetedTriggers(payload) {
  const entries = [];
  const orderRule =
    "target owner only; sources: field -> spellTrap -> fieldSpell";

  if (!payload || !payload.target || !payload.targetOwner) {
    return { entries, orderRule };
  }

  const actionContext = payload?.actionContext || null;
  const targetCard = payload.target;
  const targetOwner = payload.targetOwner;
  const sourceCard = payload.source;
  const sourceOwner =
    this.game?.player?.id === targetOwner.id ? this.game.bot : this.game.player;

  if (!targetOwner) {
    return { entries, orderRule };
  }

  const sources = [...(targetOwner.field || [])];

  // Include face-down traps from spellTrap zone
  if (targetOwner.spellTrap && Array.isArray(targetOwner.spellTrap)) {
    for (const trap of targetOwner.spellTrap) {
      if (
        trap &&
        (trap.cardKind === "trap" ||
          trap.originalCardKind === "trap" ||
          trap.cardType === "trap")
      ) {
        sources.push(trap);
      }
    }
  }

  if (targetOwner.fieldSpell) {
    sources.push(targetOwner.fieldSpell);
  }

  const devMode = this.game?.devModeEnabled || false;
  const debugLog = (...args) => {
    if (devMode) debugTriggerLog(this, ...args);
  };

  debugLog(
    `[collectEffectTargetedTriggers] ${targetCard.name} was targeted. Checking ${sources.length} sources for triggers.`,
  );

  for (const card of sources) {
    if (!card || !card.effects || !Array.isArray(card.effects)) continue;

    for (const effect of card.effects) {
      if (!effect || effect.timing !== "on_event") continue;
      if (effect.event !== "effect_targeted") continue;

      debugLog(
        `[collectEffectTargetedTriggers] Found effect_targeted effect on ${card.name}:`,
        {
          effectId: effect.id,
          isFacedown: card.isFacedown,
          targetFromContext: effect.targetFromContext,
          targetCardName: targetCard.name,
        },
      );

      // Check requireFaceup condition
      if (effect.requireFaceup === true && card.isFacedown === true) {
        debugLog(
          `[effect_targeted] Skipping effect on ${card.name}: requireFaceup=true but card is facedown`,
        );
        continue;
      }

      const optCheck = this.checkOncePerTurn(card, targetOwner, effect);
      if (!optCheck.ok) {
        debugLog(optCheck.reason);
        continue;
      }

      // Check if the targeted card matches requirements (e.g., monster type)
      if (effect.requireTargetType) {
        const requiredTypes = Array.isArray(effect.requireTargetType)
          ? effect.requireTargetType
          : [effect.requireTargetType];
        if (!requiredTypes.includes(targetCard.type)) {
          debugLog(
            `[effect_targeted] Skipping effect: requireTargetType not met`,
            {
              effectId: effect.id,
              cardName: card.name,
              targetType: targetCard.type,
              requiredTypes,
            },
          );
          continue;
        }
      }

      const ctx = {
        source: card,
        player: targetOwner,
        opponent: sourceOwner,
        targetedCard: targetCard,
        targetingSource: sourceCard,
        actionContext,
      };

      const activationContext = this.buildTriggerActivationContext(
        card,
        targetOwner,
      );

      const entry = this.buildTriggerEntry({
        sourceCard: card,
        owner: targetOwner,
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
