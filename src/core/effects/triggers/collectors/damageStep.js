import {
  DAMAGE_STEP_TIMINGS,
  canActivateDuringDamageStep,
} from "../../../game/spellTrap/quickSpellRules.js";

const BOARD_ZONES = new Set(["field", "spellTrap", "fieldSpell"]);

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function collectSources(owner) {
  return [
    ...(owner?.field || []).map((card) => ({ card, zone: "field" })),
    ...(owner?.fieldSpell
      ? [{ card: owner.fieldSpell, zone: "fieldSpell" }]
      : []),
    ...(owner?.spellTrap || []).map((card) => ({ card, zone: "spellTrap" })),
    ...(owner?.hand || []).map((card) => ({ card, zone: "hand" })),
    ...(owner?.graveyard || []).map((card) => ({ card, zone: "graveyard" })),
    ...(owner?.banished || []).map((card) => ({ card, zone: "banished" })),
  ];
}

function effectMatchesDamageStepEvent(effect, eventName, timing) {
  if (!effect || effect.timing !== "on_event") return false;
  if (eventName === "battle_damage_inflicted") {
    return (
      effect.event === "battle_damage_inflicted" ||
      effect.event === "opponent_damage"
    );
  }
  if (effect.event !== eventName) return false;
  if (eventName !== "damage_step") return true;
  const timings = asArray(
    effect.damageStepTimings,
  );
  return timings.includes(timing);
}

function effectSourceIsLegal(effect, card, zone) {
  if (effect.requireZone && effect.requireZone !== zone) return false;
  if (
    Array.isArray(effect.activationZones) &&
    !effect.activationZones.includes(zone)
  ) {
    return false;
  }
  if (
    BOARD_ZONES.has(zone) &&
    card.isFacedown === true &&
    (effect.requireFaceup === true || zone !== "field")
  ) {
    return false;
  }
  return true;
}

function eventOwnershipMatches(effect, eventName, owner, payload) {
  if (
    eventName === "battle_damage_inflicted" &&
    effect.event === "opponent_damage"
  ) {
    return owner !== payload.damagedPlayer;
  }
  const rule = effect.triggerPlayer || "any";
  const eventPlayer =
    eventName === "card_flipped"
      ? payload.defenderOwner || null
      : payload.damagedPlayer || payload.player || payload.defenderOwner || null;
  if (rule === "self") return owner === eventPlayer;
  if (rule === "opponent") return owner !== eventPlayer;
  return true;
}

async function collectDamageStepEvent(engine, eventName, payload = {}) {
  const entries = [];
  const turnPlayer =
    engine.game?.turn === engine.game?.player?.id
      ? engine.game.player
      : engine.game?.bot;
  const otherPlayer = turnPlayer
    ? engine.game?.getOpponent?.(turnPlayer) || null
    : null;
  const participants = [turnPlayer, otherPlayer].filter(Boolean);
  const timing = payload.damageStepTiming || null;

  for (const owner of participants) {
    const opponent = engine.game?.getOpponent?.(owner) || null;
    const seen = new Set();
    for (const { card, zone } of collectSources(owner)) {
      if (!card || seen.has(card)) continue;
      seen.add(card);
      for (const effect of card.effects || []) {
        if (!effectMatchesDamageStepEvent(effect, eventName, timing)) continue;
        if (!effectSourceIsLegal(effect, card, zone)) continue;
        if (!eventOwnershipMatches(effect, eventName, owner, payload)) continue;
        const legality = canActivateDuringDamageStep(effect, card, {
          ...payload,
          type: "damage_step",
          event: eventName,
          isDamageStep: true,
          damageStepTiming: timing,
          activationZone: zone,
        });
        if (!legality.ok) continue;
        if (
          effect.requireOpponentAttack === true &&
          payload.attackerOwner?.id !== opponent?.id
        ) {
          continue;
        }
        if (
          (effect.requireDefenderIsSelf === true ||
            effect.requireDefenderOwner === "self") &&
          payload.defenderOwner?.id !== owner?.id
        ) {
          continue;
        }
        if (
          effect.requireSelfAsAttacker === true &&
          payload.attacker !== card
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
          eventName === "card_flipped" &&
          effect.requireSelfAsFlipped === true &&
          payload.flippedCard !== card
        ) {
          continue;
        }
        const oncePerTurn = engine.checkOncePerTurn(card, owner, effect);
        if (!oncePerTurn?.ok) continue;
        const oncePerDuel = engine.checkOncePerDuel(card, owner, effect);
        if (!oncePerDuel?.ok) continue;

        const activationContext = {
          ...engine.buildTriggerActivationContext(card, owner, zone),
          triggeredByEvent: eventName,
          damageStepTiming: timing,
          excludedDamageStepTargets:
            eventName === "card_flipped"
              ? payload.pendingBattleDestructionCards || []
              : [],
        };
        const ctx = {
          ...payload,
          source: card,
          player: owner,
          opponent,
          activationZone: zone,
          damageStepTiming: timing,
          isDamageStep: true,
          activationContext,
        };
        if (
          Array.isArray(effect.conditions) &&
          engine.evaluateConditions(effect.conditions, ctx)?.ok === false
        ) {
          continue;
        }
        if (Array.isArray(effect.targets) && effect.targets.length > 0) {
          const preview = engine.resolveTargets(effect.targets, {
            ...ctx,
            activationContext: {
              ...activationContext,
              preview: true,
              isPreview: true,
            },
          });
          if (preview?.ok === false && !preview?.needsSelection) continue;
          const requirements = preview?.selectionContract?.requirements || [];
          if (preview?.needsSelection && requirements.length === 0) continue;
          if (
            requirements.some(
              (requirement) =>
                Number(requirement?.min ?? 0) >
                (requirement?.candidates || []).length,
            )
          ) {
            continue;
          }
        }
        const entry = engine.buildTriggerEntry({
          sourceCard: card,
          owner,
          effect,
          ctx,
          activationContext,
          selectionKind: "triggered",
          selectionMessage: "Select target(s) for the triggered effect.",
        });
        if (entry) entries.push(entry);
      }
    }
  }

  return {
    entries,
    orderRule: "turn player -> opponent; source zone order",
  };
}

export async function collectDamageStepTriggers(payload) {
  return await collectDamageStepEvent(this, "damage_step", payload);
}

export async function collectCardFlippedTriggers(payload) {
  return await collectDamageStepEvent(this, "card_flipped", payload);
}

export async function collectBattleDamageInflictedTriggers(payload) {
  if (!payload || Number(payload.amount || 0) <= 0) {
    return { entries: [], orderRule: "no battle damage" };
  }
  return await collectDamageStepEvent(
    this,
    "battle_damage_inflicted",
    payload,
  );
}

export function isCanonicalDamageStepTiming(timing) {
  return Object.values(DAMAGE_STEP_TIMINGS).includes(timing);
}
