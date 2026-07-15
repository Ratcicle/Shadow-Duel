import { debugTriggerLog } from "./shared.js";

/**
 * Collects trigger entries for attack_declared event.
 * @param {Object} payload - Attack declared event payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectAttackDeclaredTriggers(payload) {
  const entries = [];
  const orderRule =
    "attacker owner -> defender owner; sources: field -> fieldSpell";

  if (
    !payload ||
    !payload.attacker ||
    !payload.attackerOwner ||
    !payload.defenderOwner
  ) {
    return { entries, orderRule };
  }

  const actionContext = payload?.actionContext || null;
  const attackerOwner = payload.attackerOwner;
  const defenderOwner = payload.defenderOwner;

  const participants = [
    { owner: attackerOwner, other: defenderOwner },
    { owner: defenderOwner, other: attackerOwner },
  ];

  for (const side of participants) {
    const player = side.owner;
    const opponent = side.other;
    if (!player) continue;

    const sources = [...(player.field || [])];
    if (player.fieldSpell) {
      sources.push(player.fieldSpell);
    }
    // Face-down traps are offered by the ChainSystem after attack_declared.
    // Keeping them out of this trigger pass prevents the same Trap from
    // resolving once as a trigger and once as a chain activation.
    if (player.spellTrap && Array.isArray(player.spellTrap)) {
      for (const trap of player.spellTrap) {
        if (
          trap &&
          trap.isFacedown !== true &&
          (trap.cardKind === "trap" ||
            trap.cardType === "trap" ||
            trap.originalCardKind === "trap")
        ) {
          sources.push(trap);
        }
      }
    }

    for (const card of sources) {
      if (!card || !card.effects || !Array.isArray(card.effects)) continue;

      for (const effect of card.effects) {
        if (!effect || effect.timing !== "on_event") continue;
        if (effect.event !== "attack_declared") continue;

        // Rate limiting de logs (reduz spam em bot arena)
        const devMode = this.game?.devModeEnabled || false;
        if (devMode) {
          debugTriggerLog(this,
            `[collectAttackDeclaredTriggers] Found attack_declared effect on ${card.name}:`,
            {
              effectId: effect.id,
              requireDefenderType: effect.requireDefenderType,
              requireDefenderIsSelf: effect.requireDefenderIsSelf,
              defenderName: payload.defender?.name,
              defenderType: payload.defender?.type,
              defenderOwnerId: payload.defenderOwner?.id,
              playerId: player.id,
              isFacedown: card.isFacedown,
            },
          );
        }

        // Check requireFaceup condition
        if (effect.requireFaceup === true && card.isFacedown === true) {
          if (devMode) {
            debugTriggerLog(this,
              `[attack_declared] Skipping effect on ${card.name}: requireFaceup=true but card is facedown`,
            );
          }
          continue;
        }

        const optCheck = this.checkOncePerTurn(card, player, effect);
        if (!optCheck.ok) {
          debugTriggerLog(this, optCheck.reason);
          continue;
        }

        if (
          effect.requireOpponentAttack === true &&
          payload.attackerOwner?.id !== opponent?.id
        ) {
          continue;
        }

        if (
          effect.requireDefenderIsSelf === true &&
          payload.defenderOwner?.id !== player?.id
        ) {
          continue;
        }

        if (
          effect.requireSelfAsDefender === true &&
          payload.defender !== card
        ) {
          continue;
        }

        if (
          effect.requireSelfAsAttacker === true &&
          payload.attacker !== card
        ) {
          debugTriggerLog(this,
            "[attack_declared] Skipping effect: requireSelfAsAttacker not met",
            {
              effectId: effect.id,
              cardName: card.name,
              attackerName: payload.attacker?.name,
            },
          );
          continue;
        }

        if (effect.requireDefender === true && !payload.defender) {
          debugTriggerLog(this,
            "[attack_declared] Skipping effect: requireDefender not met",
            {
              effectId: effect.id,
              cardName: card.name,
              directAttack: payload.target == null,
            },
          );
          continue;
        }

        if (effect.requireDefenderPosition === true) {
          const defenderCard = payload.defender;
          if (!defenderCard || defenderCard.position !== "defense") {
            debugTriggerLog(this,
              "[attack_declared] Skipping effect: requireDefenderPosition not met",
              {
                effectId: effect.id,
                cardName: card.name,
                hasDefender: !!defenderCard,
                defenderName: defenderCard?.name,
                defenderPosition: defenderCard?.position,
              },
            );
            continue;
          }
        }

        // Filter by defender's monster type (Dragon, Warrior, etc.)
        if (effect.requireDefenderType) {
          const defenderCard = payload.defender;
          const requiredTypes = Array.isArray(effect.requireDefenderType)
            ? effect.requireDefenderType
            : [effect.requireDefenderType];
          if (!defenderCard || !requiredTypes.includes(defenderCard.type)) {
            debugTriggerLog(this,
              "[attack_declared] Skipping effect: requireDefenderType not met",
              {
                effectId: effect.id,
                cardName: card.name,
                hasDefender: !!defenderCard,
                defenderName: defenderCard?.name,
                defenderType: defenderCard?.type,
                requiredTypes,
              },
            );
            continue;
          }
        }

        const ctx = {
          source: card,
          player,
          opponent,
          attacker: payload.attacker,
          defender: payload.defender || null,
          target: payload.defender || payload.target || null,
          attackerOwner: payload.attackerOwner,
          defenderOwner: payload.defenderOwner,
          actionContext,
        };

        // Avoid prompting/adding triggers that have impossible target requirements.
        // This keeps UX clean for effects that require a cost/target (e.g., send 1 monster),
        // but have no valid candidates at the moment.
        if (Array.isArray(effect.targets) && effect.targets.length > 0) {
          const previewCtx = {
            ...ctx,
            activationContext: { isPreview: true, preview: true },
          };
          const targetPreview = this.resolveTargets(effect.targets, previewCtx);
          if (targetPreview?.ok === false && !targetPreview?.needsSelection) {
            continue;
          }
          const requirements =
            targetPreview?.selectionContract?.requirements || [];
          if (requirements.length === 0 && targetPreview?.needsSelection) {
            continue;
          }
          const impossible = requirements.some((req) => {
            const min = Number(req?.min ?? 0);
            const candidates = Array.isArray(req?.candidates)
              ? req.candidates
              : [];
            return min > 0 && candidates.length < min;
          });
          if (impossible) {
            continue;
          }
        }

        const activationContext = this.buildTriggerActivationContext(
          card,
          player,
        );

        const entry = this.buildTriggerEntry({
          sourceCard: card,
          owner: player,
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
  }

  return { entries, orderRule };
}
