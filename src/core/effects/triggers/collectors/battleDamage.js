import { canActivateDuringDamageStep } from "../../../game/spellTrap/quickSpellRules.js";

/**
 * Collects trigger entries for battle_damage event.
 * This event happens after attack declaration responses and flips, but before
 * battle stats are compared. Hand sources must explicitly opt in with
 * requireZone: "hand" and a quick/speed-2 monster effect.
 * @param {Object} payload - Battle damage preview payload
 * @returns {Promise<Object>} Collected entries and order rule
 */
export async function collectBattleDamageTriggers(payload) {
  const entries = [];
  const orderRule =
    "attacker owner -> defender owner; sources: field -> fieldSpell -> hand quick";

  if (
    !payload ||
    !payload.attacker ||
    !payload.defender ||
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

    const sources = [];
    for (const card of player.field || []) {
      sources.push({ card, zone: "field" });
    }
    if (player.fieldSpell) {
      sources.push({ card: player.fieldSpell, zone: "fieldSpell" });
    }
    for (const card of player.hand || []) {
      sources.push({ card, zone: "hand" });
    }

    for (const source of sources) {
      const card = source.card;
      const sourceZone = source.zone;
      if (!card || !card.effects || !Array.isArray(card.effects)) continue;

      for (const effect of card.effects) {
        if (!effect || effect.timing !== "on_event") continue;
        if (effect.event !== "battle_damage") continue;

        if (effect.requireZone && effect.requireZone !== sourceZone) {
          continue;
        }

        if (sourceZone === "hand") {
          const isHandMonsterQuick =
            card.cardKind === "monster" &&
            (effect.isQuickEffect === true || effect.speed === 2);
          if (!isHandMonsterQuick || effect.requireZone !== "hand") {
            continue;
          }
        }

        const damageStepCheck = canActivateDuringDamageStep(effect, card, {
          ...(payload || {}),
          type: "battle_damage",
          event: "battle_damage",
          isDamageStep: true,
          damageStepTiming:
            payload.damageStepTiming || "before_damage_calculation",
          activationZone: sourceZone,
        });
        if (!damageStepCheck.ok) {
          continue;
        }

        if (effect.requireFaceup === true && card.isFacedown === true) {
          continue;
        }

        const optCheck = this.checkOncePerTurn(card, player, effect);
        if (!optCheck.ok) {
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
          continue;
        }

        if (effect.requireDefender === true && !payload.defender) {
          continue;
        }

        if (effect.requireDefenderPosition === true) {
          const defenderCard = payload.defender;
          if (!defenderCard || defenderCard.position !== "defense") {
            continue;
          }
        }

        if (effect.requireDefenderType) {
          const defenderCard = payload.defender;
          const requiredTypes = Array.isArray(effect.requireDefenderType)
            ? effect.requireDefenderType
            : [effect.requireDefenderType];
          if (!defenderCard || !requiredTypes.includes(defenderCard.type)) {
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
          targetOwner: payload.targetOwner || payload.defenderOwner,
          actionContext,
          activationZone: sourceZone,
        };

        if (Array.isArray(effect.conditions) && effect.conditions.length > 0) {
          const conditionResult = this.evaluateConditions(effect.conditions, ctx);
          if (!conditionResult?.ok) {
            continue;
          }
        }

        if (Array.isArray(effect.targets) && effect.targets.length > 0) {
          const previewCtx = {
            ...ctx,
            activationContext: {
              isPreview: true,
              preview: true,
              activationZone: sourceZone,
              sourceZone,
            },
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
          sourceZone,
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
