import { cardDatabase } from "../../../data/cards.js";

export const CANONICAL_REPLAY_FORMAT = "shadow-duel-canonical-replay";
export const CANONICAL_REPLAY_SCHEMA_VERSION = 1;

const REPLAY_EVENT_NAMES = new Set([
  "effect_activated",
  "spell_activated",
  "trap_activated",
  "activation_transaction",
  "fast_effect_timing",
  "fast_effect_priority",
  "trigger_occurrence_queued",
  "trigger_opportunity_opened",
  "segoc_order_selected",
  "trigger_candidate_rejected",
  "trigger_chain_prepared",
  "trigger_opportunity",
  "trigger_ordered",
  "effect_usage",
  "activation_usage",
  "chain_link_resolution",
  "chain_finalization",
  "chain_finalization_complete",
  "chain_link_resolved",
  "chain_finalized",
  "summon_transaction",
  "summon_cost_paid",
  "summon_negated",
  "summon_attempt",
  "after_summon",
  "damage_step_created",
  "damage_step_timing",
  "damage_step_completed",
  "battle_damage_inflicted",
  "control_changed",
  "card_moved",
  "card_to_grave",
  "chain_cleanup",
  "game_over",
]);

function stableValue(value, seen = new WeakSet()) {
  if (value == null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entry]) => [String(key), stableValue(entry, seen)])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }
  if (value instanceof Set) {
    return [...value].map((entry) => stableValue(entry, seen)).sort();
  }
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry, seen));
  if (typeof value === "object") {
    if (seen.has(value)) {
      if (value.duelCardId != null || value.instanceId != null) {
        return { duelCardId: value.duelCardId ?? null, instanceId: value.instanceId ?? null };
      }
      if (value.id != null) return { id: value.id };
      return null;
    }
    seen.add(value);
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (["game", "renderer", "ui", "strategy", "effects", "image"].includes(key)) continue;
      const normalized = stableValue(value[key], seen);
      if (normalized !== undefined) output[key] = normalized;
    }
    seen.delete(value);
    return output;
  }
  return String(value);
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export function hashCanonicalValue(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function getCardDatabaseSignature() {
  return hashCanonicalValue(
    cardDatabase.map((card) => ({
      id: card.id,
      name: card.name,
      mustFirstBeSpecialSummonedBy:
        card.mustFirstBeSpecialSummonedBy || null,
      effects: (card.effects || []).map((effect) => ({
        id: effect.id || null,
        activationZones: effect.activationZones || null,
        usagePolicy: effect.usagePolicy || null,
        damageStepTimings: effect.damageStepTimings || null,
        activationCommitActions: effect.activationCommitActions || null,
      })),
    })),
  );
}

function cardState(game, card) {
  if (!card) return null;
  game.ensureDuelCardId?.(card);
  return {
    duelCardId: card.duelCardId ?? null,
    cardId: card.id ?? null,
    owner: card.owner ?? null,
    controller: card.controller ?? card.owner ?? null,
    originalOwner: card.originalOwner ?? null,
    locationVersion: Number(card.locationVersion ?? 0),
    lastSummonMethod: card.lastSummonMethod || null,
    lastSummonedFromZone: card.lastSummonedFromZone || null,
    properSummonEstablished: card.properSummonEstablished === true,
    properSummonProcedure: card.properSummonProcedure || null,
    position: card.position || null,
    facedown: card.isFacedown === true,
    atk: Number(card.atk ?? 0),
    def: Number(card.def ?? 0),
    baseAtk: Number(card.baseAtk ?? 0),
    baseDef: Number(card.baseDef ?? 0),
    level: Number(card.level ?? 0),
    counters: stableValue(card.counters || {}),
    equipTargetId: card.equippedTo?.duelCardId ?? null,
    statuses: {
      effectsNegated: card.effectsNegated === true,
      effectsNegatedDuration: card.effectsNegatedDuration || null,
      cannotAttackThisTurn: card.cannotAttackThisTurn === true,
      battlePositionLocked: card.battlePositionLocked === true,
      banishWhenLeavesField: card.banishWhenLeavesField === true,
    },
  };
}

function playerState(game, player) {
  const zones = {};
  for (const zone of [
    "deck",
    "extraDeck",
    "hand",
    "field",
    "spellTrap",
    "graveyard",
    "banished",
  ]) {
    zones[zone] = (player?.[zone] || []).map((card) => cardState(game, card));
  }
  zones.fieldSpell = player?.fieldSpell ? cardState(game, player.fieldSpell) : null;
  return {
    id: player?.id || null,
    lp: Number(player?.lp ?? 0),
    zones,
    summonCount: Number(player?.summonCount || 0),
    additionalNormalSummons: Number(player?.additionalNormalSummons || 0),
    oncePerDuelUsage: stableValue(player?.oncePerDuelUsageByName || {}),
    restrictions: stableValue({
      specialSummon: player?.specialSummonRestrictions || [],
      effectActivation: player?.effectActivationRestrictions || [],
      directAttackForbidden: player?.forbidDirectAttacksThisTurn === true,
    }),
  };
}

export function createCanonicalStateSnapshot(game) {
  return {
    turn: game.turn,
    phase: game.phase,
    turnCounter: Number(game.turnCounter || 0),
    random: game.getRandomState?.() || null,
    players: {
      player: playerState(game, game.player),
      bot: playerState(game, game.bot),
    },
    usage: game.getEffectUsageState?.() || null,
    delayedActions: stableValue(game.delayedActions || []),
    temporaryEventEffects: stableValue(game.temporaryEventEffects || []),
    temporaryControlEffects: stableValue(
      game.getTemporaryControlState?.() || game.temporaryControlEffects || [],
    ),
    chain: stableValue({
      state: game.chainSystem?.getPublicState?.() || null,
      links: game.chainSystem?.getChainSummary?.() || [],
      timing: game.chainSystem?.getFastEffectState?.() || null,
      triggers: game.chainSystem?.getTriggerState?.() || null,
    }),
    summon: stableValue(game.getSummonState?.() || null),
    combat: stableValue(game.getDamageStepState?.() || null),
  };
}

export function hashCanonicalGameState(game) {
  return hashCanonicalValue(createCanonicalStateSnapshot(game));
}

export function serializeReplayEventPayload(game, payload) {
  const replace = (value, seen = new WeakSet()) => {
    if (value == null || typeof value !== "object") return value;
    if (seen.has(value)) return null;
    if (value.duelCardId != null || (value.cardKind && value.name)) {
      game.ensureDuelCardId?.(value);
      return {
        duelCardId: value.duelCardId ?? null,
        cardId: value.id ?? null,
        locationVersion: Number(value.locationVersion ?? 0),
      };
    }
    if (value.id === "player" || value.id === "bot") return { playerId: value.id };
    seen.add(value);
    if (Array.isArray(value)) return value.map((entry) => replace(entry, seen));
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (["game", "renderer", "ui", "strategy", "effects", "image"].includes(key)) continue;
      const normalized = replace(value[key], seen);
      if (normalized !== undefined) output[key] = normalized;
    }
    seen.delete(value);
    return output;
  };
  return replace(payload);
}

export function isReplayEvent(eventName) {
  return REPLAY_EVENT_NAMES.has(eventName);
}

export function validateCanonicalReplay(replay) {
  if (replay?.format !== CANONICAL_REPLAY_FORMAT) {
    const legacy = replay?.reportVersion || replay?.version || replay?.schemaVersion;
    throw new Error(
      `Unsupported replay format${legacy ? ` (legacy/report version ${legacy})` : ""}; expected ${CANONICAL_REPLAY_FORMAT}.`,
    );
  }
  if (replay.schemaVersion !== CANONICAL_REPLAY_SCHEMA_VERSION) {
    throw new Error(`Unsupported canonical replay schema ${replay.schemaVersion}.`);
  }
  if (replay.cardDatabaseSignature !== getCardDatabaseSignature()) {
    throw new Error("Replay card database signature does not match this build.");
  }
  if (!replay.setup || !Array.isArray(replay.commands) || !Array.isArray(replay.decisions)) {
    throw new Error("Canonical replay is missing setup, commands, or decisions.");
  }
  return replay;
}
