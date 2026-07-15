import {
  canActivateQuickSpellFromHand,
  canActivateSetQuickSpell,
  isQuickSpell,
} from "../game/spellTrap/quickSpellRules.js";

export const ACTIVATION_ZONES = Object.freeze([
  "hand",
  "field",
  "spellTrap",
  "fieldSpell",
  "graveyard",
  "banished",
]);

function cardInstanceId(card) {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uuid ??
    card?.simInstanceId ??
    card?.id ??
    card?.name ??
    "card"
  );
}

function isFastMonsterEffect(effect) {
  return effect?.isQuickEffect === true || Number(effect?.speed) === 2;
}

function isExplicitZone(effect, zone) {
  return (
    (Array.isArray(effect?.activationZones) &&
      effect.activationZones.includes(zone)) ||
    effect?.requireZone === zone
  );
}

export function getEffectActivationZones(card, effect) {
  if (!card || !effect) return [];
  if (Array.isArray(effect.activationZones)) {
    return [...new Set(effect.activationZones.filter(Boolean))];
  }
  if (effect.requireZone) return [effect.requireZone];

  if (card.cardKind === "trap") return ["spellTrap"];
  if (card.cardKind === "spell" && isQuickSpell(card)) {
    return ["hand", "spellTrap"];
  }
  if (card.cardKind === "monster" && isFastMonsterEffect(effect)) {
    return ["field"];
  }
  return [];
}

export function getActivationCandidateKey(card, effect, sourceZone) {
  return `${cardInstanceId(card)}:${effect?.id || "effect"}:${sourceZone || "unknown"}`;
}

function pairAlreadyInChain(chainSystem, card, effect) {
  const effectId = effect?.id || null;
  const links = [
    ...(chainSystem.chainStack || []),
    chainSystem.currentResolvingLink || null,
  ].filter(Boolean);
  return links.some(
    (link) =>
      cardInstanceId(link.card) === cardInstanceId(card) &&
      (link.effectId || link.effect?.id || null) === effectId,
  );
}

function wasTriggerEffectAlreadyOffered(chainSystem, card, effect) {
  return chainSystem.chainTriggerEffectsOffered?.get(card)?.has(effect) === true;
}

function buildResponseContext(chainSystem, context, effect, activationZone) {
  const responseContext =
    chainSystem.getEffectChainResponseContext?.(effect, context) || context;
  const lastLink = chainSystem.getLastChainLink?.();
  return {
    ...(responseContext || {}),
    activationZone,
    sourceZone: activationZone,
    effect,
    chainWindowOpen:
      chainSystem.isChainWindowOpen?.() === true || !!responseContext,
    isChainWindow:
      responseContext?.type !== "main_phase_action" ||
      chainSystem.isChainWindowOpen?.() === true,
    requiredSpellSpeed: chainSystem.getRequiredSpellSpeed?.(responseContext),
    respondingToSpellSpeed: lastLink?.spellSpeed,
    lastSpellSpeed: lastLink?.spellSpeed,
  };
}

function buildPreviewContext(chainSystem, card, effect, player, context, zone) {
  return {
    source: card,
    sourceCard: card,
    effect,
    player,
    opponent: chainSystem.getOpponent?.(player) || null,
    activationZone: zone,
    actionContext: context || null,
    defender: context?.defender || context?.target || null,
    target: context?.target || context?.defender || null,
    attacker: context?.attacker || null,
    summonedCard: context?.summonedCard || context?.card || null,
    activationContext: {
      preview: true,
      isPreview: true,
      sourceZone: zone,
      activationZone: zone,
      autoSelectSingleTarget: true,
      context: context || null,
    },
  };
}

function canonicalRequirementsCanBeMet(
  chainSystem,
  card,
  effect,
  player,
  context,
  zone,
) {
  const engine = chainSystem.game?.effectEngine;
  const preview = buildPreviewContext(
    chainSystem,
    card,
    effect,
    player,
    context,
    zone,
  );
  const definitions = (effect.targets || []).map((definition) =>
    definition?.intent === "cost" &&
    definition.requireThisCard !== true &&
    definition.allowSelf !== true
      ? { ...definition, excludeSelf: true }
      : definition,
  );
  if (definitions.length > 0 && engine?.resolveTargets) {
    const targetPreview = engine.resolveTargets(definitions, preview, null);
    if (targetPreview?.ok === false && !targetPreview?.needsSelection) {
      return false;
    }
  }

  const costs = chainSystem.getEffectActivationCosts?.(effect) || [];
  const costsWithoutDeclaredCards = costs.filter(
    (action) => typeof action?.targetRef !== "string",
  );
  if (
    costsWithoutDeclaredCards.length > 0 &&
    engine?.checkActionPreviewRequirements
  ) {
    const costPreview = engine.checkActionPreviewRequirements(
      costsWithoutDeclaredCards,
      preview,
    );
    if (costPreview?.ok === false) return false;
  }
  return true;
}

function genericExplicitEffectCheck(
  chainSystem,
  card,
  effect,
  player,
  context,
  zone,
) {
  if (!isExplicitZone(effect, zone)) return false;
  if (effect.timing === "passive") return false;
  if (effect.timing === "on_event" && effect.allowManualActivation !== true) {
    return false;
  }
  if (
    effect.requireFaceup === true &&
    zone !== "hand" &&
    zone !== "graveyard" &&
    zone !== "banished" &&
    card.isFacedown === true
  ) {
    return false;
  }
  const phases = Array.isArray(effect.requirePhase)
    ? effect.requirePhase
    : effect.requirePhase
      ? [effect.requirePhase]
      : [];
  if (phases.length > 0 && !phases.includes(chainSystem.game?.phase)) {
    return false;
  }

  const preview = buildPreviewContext(
    chainSystem,
    card,
    effect,
    player,
    context,
    zone,
  );
  const engine = chainSystem.game?.effectEngine;
  if (Array.isArray(effect.conditions) && engine?.evaluateConditions) {
    if (engine.evaluateConditions(effect.conditions, preview)?.ok === false) {
      return false;
    }
  }
  if (Array.isArray(effect.targets) && effect.targets.length > 0) {
    const targetPreview = engine?.resolveTargets?.(effect.targets, preview, null);
    if (targetPreview?.ok === false && !targetPreview?.needsSelection) {
      return false;
    }
  }
  if (engine?.checkActionPreviewRequirements) {
    const actionPreview = engine.checkActionPreviewRequirements(
      effect.actions || [],
      preview,
    );
    if (actionPreview?.ok === false) return false;
  }
  return true;
}

function buildPlacementOnlyEffect(card) {
  return {
    id: `${card?.id || "trap"}_placement_only_activation`,
    timing: "on_activate",
    speed: 2,
    placementOnly: true,
    actions: [],
  };
}

function canUsePlacementOnly(card) {
  return (
    card?.cardKind === "trap" &&
    card?.subtype === "continuous" &&
    !(card.effects || []).some((effect) => effect?.timing === "on_activate")
  );
}

function zoneEntries(player) {
  return [
    ["hand", player.hand || []],
    ["field", player.field || []],
    ["spellTrap", player.spellTrap || []],
    ["fieldSpell", player.fieldSpell ? [player.fieldSpell] : []],
    ["graveyard", player.graveyard || []],
    ["banished", player.banished || []],
  ];
}

function trapStateAllows(chainSystem, card, effect, zone) {
  if (zone === "hand") return isExplicitZone(effect, "hand");
  if (zone !== "spellTrap") return isExplicitZone(effect, zone);

  if (card.isFacedown === true) {
    const setTurn = card.setTurn ?? card.turnSetOn ?? null;
    return setTurn != null && Number(setTurn) < Number(chainSystem.game.turnCounter);
  }

  return (
    card.subtype === "continuous" &&
    effect.requireFaceup === true &&
    (effect.timing !== "on_event" || effect.allowManualActivation === true)
  );
}

function candidateForEffect(chainSystem, player, card, effect, zone, context) {
  if (!getEffectActivationZones(card, effect).includes(zone)) return null;
  if (pairAlreadyInChain(chainSystem, card, effect)) return null;
  if (wasTriggerEffectAlreadyOffered(chainSystem, card, effect)) return null;

  const responseContext = buildResponseContext(
    chainSystem,
    context,
    effect,
    zone,
  );
  if (!chainSystem.canOfferEffectInChainContext?.(effect, responseContext)) {
    return null;
  }

  let matchedEffect = null;
  if (card.cardKind === "trap") {
    if (!trapStateAllows(chainSystem, card, effect, zone)) return null;
    matchedEffect = chainSystem.findActivatableEffect?.(
      card,
      responseContext,
      player,
      zone,
      effect,
    );
  } else if (
    card.cardKind === "spell" &&
    isQuickSpell(card) &&
    (zone === "hand" || zone === "spellTrap")
  ) {
    matchedEffect = chainSystem.findActivatableEffect?.(
      card,
      responseContext,
      player,
      zone,
      effect,
    );
    if (!matchedEffect) return null;
    const quickCheck =
      zone === "hand"
        ? canActivateQuickSpellFromHand(
            chainSystem.game,
            card,
            player,
            responseContext,
          )
        : canActivateSetQuickSpell(
            chainSystem.game,
            card,
            player,
            responseContext,
          );
    if (!quickCheck.ok) return null;
  } else if (card.cardKind === "monster" && isFastMonsterEffect(effect)) {
    if (zone === "field" && card.isFacedown === true) return null;
    matchedEffect = chainSystem.findQuickMonsterEffect?.(
      card,
      responseContext,
      player,
      zone,
      effect,
    );
  } else if (
    (card.cardKind === "spell" || card.cardKind === "trap") &&
    (Number(effect.speed) >= 2 || card.cardKind === "trap") &&
    genericExplicitEffectCheck(
      chainSystem,
      card,
      effect,
      player,
      responseContext,
      zone,
    )
  ) {
    matchedEffect = effect;
  }
  if (!matchedEffect) return null;
  if (
    !canonicalRequirementsCanBeMet(
      chainSystem,
      card,
      effect,
      player,
      responseContext,
      zone,
    )
  ) {
    return null;
  }

  const restriction = chainSystem.game?.canActivateCardEffectUnderRestrictions?.(
    card,
    player,
    effect,
    { silent: true },
  );
  if (restriction?.ok === false) return null;
  const usage = chainSystem.checkActivationUsage?.(card, player, effect);
  if (usage?.ok === false) return null;
  const chainCheck = chainSystem.canActivateInChain?.(
    effect,
    card,
    responseContext,
  );
  if (chainCheck?.ok === false) return null;

  return {
    candidateKey: getActivationCandidateKey(card, effect, zone),
    card,
    effect,
    effectId: effect.id || null,
    player,
    controller: player,
    zone,
    sourceZone: zone,
    sourceLocationVersion: Number(card.locationVersion ?? 0),
    spellSpeed: chainSystem.getEffectSpellSpeed?.(effect, card) ?? 1,
    context: responseContext,
    effectLabel:
      effect.activationLabel || effect.promptMessage || effect.id || card.name,
  };
}

/**
 * Canonical response discovery. Candidates are effects, never whole cards.
 */
export function getActivatableCardsInChain(player, context) {
  if (!player || !this.game) return [];
  const candidates = [];

  for (const [zone, cards] of zoneEntries(player)) {
    for (const card of cards) {
      if (!card) continue;
      for (const effect of card.effects || []) {
        const candidate = candidateForEffect(
          this,
          player,
          card,
          effect,
          zone,
          context,
        );
        if (candidate) candidates.push(candidate);
      }

      if (
        zone === "spellTrap" &&
        card.isFacedown === true &&
        canUsePlacementOnly(card)
      ) {
        const placement = buildPlacementOnlyEffect(card);
        const candidate = candidateForEffect(
          this,
          player,
          { ...card, effects: [placement] },
          placement,
          zone,
          context,
        );
        if (candidate) {
          candidate.card = card;
          candidate.candidateKey = getActivationCandidateKey(
            card,
            placement,
            zone,
          );
          candidates.push(candidate);
        }
      }
    }
  }

  candidates.sort((a, b) =>
    String(a.candidateKey).localeCompare(String(b.candidateKey)),
  );
  return candidates;
}

export function revalidateActivationCandidate(candidate, player, context) {
  if (!candidate?.card || !candidate?.effect || !player) {
    return { ok: false, reason: "invalid_activation_candidate" };
  }
  const currentZone = this.determineCardZone?.(candidate.card, player);
  if (currentZone !== candidate.sourceZone) {
    return { ok: false, reason: "activation_source_moved" };
  }
  if (
    Number(candidate.card.locationVersion ?? 0) !==
    Number(candidate.sourceLocationVersion ?? 0)
  ) {
    return { ok: false, reason: "activation_source_version_changed" };
  }
  const current = candidateForEffect(
    this,
    player,
    candidate.card,
    candidate.effect,
    currentZone,
    candidate.context || context,
  );
  return current
    ? { ok: true, candidate: current }
    : { ok: false, reason: "activation_candidate_no_longer_legal" };
}
