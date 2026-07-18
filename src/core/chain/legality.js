import { isQuickSpell } from "../game/spellTrap/quickSpellRules.js";

function sourceIdentity(card) {
  return (
    card?.duelCardId ??
    card?.instanceId ??
    card?._instanceId ??
    card?.uuid ??
    card?.simInstanceId ??
    card?.id ??
    card?.name ??
    "card"
  );
}

export function getCanonicalEffectActivationZones(card, effect) {
  if (!effect) return [];
  if (Array.isArray(effect.activationZones)) {
    return [...new Set(effect.activationZones.filter(Boolean))];
  }
  if (card?.cardKind === "trap") return ["spellTrap"];
  if (card?.cardKind === "spell" && isQuickSpell(card)) {
    return ["hand", "spellTrap"];
  }
  if (
    card?.cardKind === "monster" &&
    (effect.isQuickEffect === true || Number(effect.speed) === 2)
  ) {
    return ["field"];
  }
  return [];
}

export function getCanonicalActivationCandidateKey(card, effect, sourceZone) {
  return `${sourceIdentity(card)}:${effect?.id || "effect"}:${sourceZone || "unknown"}`;
}

function serializeContext(context = null) {
  if (!context) return null;
  return {
    type: context.type || null,
    event: context.event || null,
    linkId: context.linkId ?? context.activationAttempt?.linkId ?? null,
    summonId:
      context.summonId ?? context.summonTransaction?.summonId ?? null,
    damageStepTiming: context.damageStepTiming || context.timing || null,
  };
}

export function buildActivationQuery(input = {}) {
  return Object.freeze({
    player: input.player || null,
    playerId: input.player?.id || input.playerId || null,
    opponent: input.opponent || null,
    context: input.context || null,
    contextSnapshot: serializeContext(input.context),
    phase: input.phase || input.game?.phase || input.state?.phase || null,
    turnPlayerId:
      input.turnPlayerId || input.game?.turn || input.state?.turn || null,
    priorityPlayerId:
      input.priorityPlayerId ||
      input.chainSystem?.getFastEffectState?.().priorityPlayerId ||
      null,
    damageStepTiming:
      input.damageStepTiming ||
      input.game?.getDamageStepState?.().timing ||
      input.state?.combat?.timing ||
      null,
    sourceZones: Array.isArray(input.sourceZones)
      ? [...input.sourceZones]
      : null,
  });
}

export function checkEffectZoneLegality(card, effect, sourceZone) {
  const allowedZones = getCanonicalEffectActivationZones(card, effect);
  if (!allowedZones.includes(sourceZone)) {
    return {
      ok: false,
      code: "ACTIVATION_ZONE_ILLEGAL",
      reason: `Effect cannot be activated from ${sourceZone || "this zone"}.`,
      allowedZones,
    };
  }
  if (
    effect?.requireFaceup === true &&
    !["hand", "graveyard", "banished"].includes(sourceZone) &&
    card?.isFacedown === true
  ) {
    return {
      ok: false,
      code: "ACTIVATION_SOURCE_FACEDOWN",
      reason: "Effect source must be face-up.",
      allowedZones,
    };
  }
  return { ok: true, code: "LEGAL", reason: null, allowedZones };
}

function canonicalCandidate(candidate) {
  const effect = candidate.effect || null;
  const card = candidate.card || null;
  const sourceZone = candidate.sourceZone || null;
  const { zone: _removedZone, ...canonicalInput } = candidate;
  return {
    ...canonicalInput,
    candidateKey:
      candidate.candidateKey || getCanonicalActivationCandidateKey(card, effect, sourceZone),
    effectId: candidate.effectId || effect?.id || null,
    sourceZone,
    spellSpeed: Number(candidate.spellSpeed ?? effect?.speed ?? 1),
    category:
      candidate.category ||
      (card?.cardKind === "monster" ? "monster_effect" : "spell_trap_effect"),
    activationLabelKey:
      candidate.activationLabelKey || effect?.activationLabelKey || null,
    legality: { ok: true, code: "LEGAL", reason: null },
  };
}

export function listLegalActivationCandidates(query, adapter) {
  if (!query?.player && !query?.playerId) return [];
  if (typeof adapter?.listCandidates !== "function") return [];
  const candidates = adapter.listCandidates(query) || [];
  return candidates
    .filter(Boolean)
    .map(canonicalCandidate)
    .sort((a, b) => String(a.candidateKey).localeCompare(String(b.candidateKey)));
}

export function revalidateActivationCandidate(candidate, query, adapter) {
  if (!candidate) {
    return {
      ok: false,
      code: "INVALID_ACTIVATION_CANDIDATE",
      reason: "Activation candidate is missing.",
    };
  }
  if (typeof adapter?.revalidateCandidate === "function") {
    const result = adapter.revalidateCandidate(candidate, query);
    if (result?.ok === false) {
      return {
        ok: false,
        code: result.code || String(result.reason || "CANDIDATE_NO_LONGER_LEGAL").toUpperCase(),
        reason: result.reason || "Activation candidate is no longer legal.",
      };
    }
    return { ok: true, code: "LEGAL", reason: null, candidate: canonicalCandidate(result?.candidate || candidate) };
  }
  const zoneCheck = checkEffectZoneLegality(
    candidate.card,
    candidate.effect,
    candidate.sourceZone,
  );
  return zoneCheck.ok
    ? { ...zoneCheck, candidate: canonicalCandidate(candidate) }
    : zoneCheck;
}

export function createSimulationLegalityAdapter(state, options = {}) {
  const players = [state?.player, state?.bot].filter(Boolean);
  const getPlayer = (query) =>
    query.player || players.find((player) => player.id === query.playerId) || null;
  return {
    listCandidates(query) {
      const player = getPlayer(query);
      if (!player) return [];
      const zones = query.sourceZones || [
        "hand",
        "field",
        "spellTrap",
        "fieldSpell",
        "graveyard",
        "banished",
      ];
      const candidates = [];
      for (const zone of zones) {
        const cards = zone === "fieldSpell"
          ? [player.fieldSpell].filter(Boolean)
          : (player[zone] || []).filter(Boolean);
        for (const card of cards) {
          for (const effect of card.effects || []) {
            if (checkEffectZoneLegality(card, effect, zone).ok === false) continue;
            if (effect.timing === "passive") continue;
            if (typeof options.effectCheck === "function" &&
                options.effectCheck({ state, player, card, effect, zone, query }) === false) {
              continue;
            }
            candidates.push({
              card,
              effect,
              player,
              sourceZone: zone,
              sourceLocationVersion: Number(card.locationVersion ?? 0),
            });
          }
        }
      }
      return candidates;
    },
    revalidateCandidate(candidate, query) {
      const player = getPlayer(query);
      const zone = candidate.sourceZone;
      const cards = zone === "fieldSpell"
        ? [player?.fieldSpell].filter(Boolean)
        : player?.[zone] || [];
      if (!cards.includes(candidate.card)) {
        return { ok: false, code: "ACTIVATION_SOURCE_MOVED", reason: "activation_source_moved" };
      }
      if (Number(candidate.card.locationVersion ?? 0) !==
          Number(candidate.sourceLocationVersion ?? 0)) {
        return { ok: false, code: "ACTIVATION_SOURCE_VERSION_CHANGED", reason: "activation_source_version_changed" };
      }
      return checkEffectZoneLegality(candidate.card, candidate.effect, zone);
    },
  };
}
