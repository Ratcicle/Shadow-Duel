import type { AIDecisionPlan } from "../../contracts/ai.js";
import type {
  ChainActivationCandidate,
  ChainCard,
  ChainDecisionRequest,
  ChainGamePort,
} from "../../contracts/chainRuntime.js";
import type {
  ChainResponseDecisionValue,
  SerializedChainResponseDecisions,
} from "../../contracts/decisions.js";

const decisionChannels = new Set([
  "selections", "cases", "specialSummons", "specialSummonRevalidation", "synchroSummons",
]);

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identity(value: unknown): value is number | string {
  return typeof value === "string"
    ? value.length > 0
    : typeof value === "number" && Number.isFinite(value);
}

/** Validate the closed plan shape before it crosses a provider or replay boundary. */
export function readChainResponseDecisions(
  value: unknown,
  resolveIdentity: (id: number | string) => number | string | null = id => id,
  serialized = false,
): AIDecisionPlan | null {
  if (!object(value) || Object.keys(value).some(key => !decisionChannels.has(key))) return null;
  const mapId = (raw: unknown): number | string => {
    if (!identity(raw) || (serialized && (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw <= 0))) {
      throw new Error("Invalid decision identity");
    }
    const mapped = resolveIdentity(raw);
    if (mapped == null) throw new Error("Unavailable decision identity");
    return mapped;
  };
  const mapIds = (raw: unknown): (number | string)[] => {
    if (!Array.isArray(raw)) throw new Error("Invalid decision identities");
    const mapped = raw.map(mapId);
    if (new Set(mapped.map(String)).size !== mapped.length) throw new Error("Duplicate decision identity");
    return mapped;
  };
  try {
    const plan: AIDecisionPlan = {};
    for (const key of ["selections", "specialSummons"] as const) {
      if (!(key in value)) continue;
      const entries = value[key];
      if (!object(entries)) return null;
      plan[key] = Object.fromEntries(Object.entries(entries).map(([id, ids]) => [id, mapIds(ids)]));
    }
    if ("cases" in value) {
      if (!object(value.cases) || Object.values(value.cases).some(entry => typeof entry !== "string" || !entry)) return null;
      plan.cases = { ...value.cases } as Record<string, string>;
    }
    if ("specialSummonRevalidation" in value) {
      if (!object(value.specialSummonRevalidation) ||
          Object.values(value.specialSummonRevalidation).some(entry => entry !== "remaining")) return null;
      plan.specialSummonRevalidation = { ...value.specialSummonRevalidation } as Record<string, "remaining">;
    }
    if ("synchroSummons" in value) {
      if (!object(value.synchroSummons)) return null;
      const destinationKey = serialized ? "synchroDuelCardId" : "synchroInstanceId";
      const materialsKey = serialized ? "materialDuelCardIds" : "materialInstanceIds";
      const summons: Array<[string, NonNullable<AIDecisionPlan["synchroSummons"]>[string]]> = [];
      for (const [key, entry] of Object.entries(value.synchroSummons)) {
        if (!object(entry) ||
            Object.keys(entry).some(field => ![destinationKey, materialsKey, "position"].includes(field)) ||
            (entry.position !== "attack" && entry.position !== "defense")) return null;
        summons.push([key, {
          synchroInstanceId: mapId(entry[destinationKey]),
          materialInstanceIds: mapIds(entry[materialsKey]),
          position: entry.position,
        }]);
      }
      plan.synchroSummons = Object.fromEntries(summons);
    }
    return plan;
  } catch {
    return null;
  }
}

/** Shared canonical plan projection; physical identities are supplied by its runtime owner. */
export function serializeChainResponseDecisions(decisions: AIDecisionPlan,
  resolveIdentity: (id: number | string) => number | string | null): SerializedChainResponseDecisions | null {
  const mapped = readChainResponseDecisions(decisions, resolveIdentity);
  if (!mapped) return null;
  const serialized: SerializedChainResponseDecisions = {};
  for (const key of ["selections", "specialSummons"] as const) {
    if (mapped[key]) serialized[key] = Object.fromEntries(Object.entries(mapped[key]).map(([id, ids]) => [id, ids.map(Number)]));
  }
  if (mapped.cases) serialized.cases = { ...mapped.cases };
  if (mapped.specialSummonRevalidation) serialized.specialSummonRevalidation = { ...mapped.specialSummonRevalidation };
  if (mapped.synchroSummons) serialized.synchroSummons = Object.fromEntries(Object.entries(mapped.synchroSummons).map(([id, summon]) => [id, {
    synchroDuelCardId: Number(summon.synchroInstanceId), materialDuelCardIds: summon.materialInstanceIds.map(Number), position: summon.position,
  }]));
  return serialized;
}

/** Retain only physical planned cards, including Tokens that can leave all zones. */
export function captureChainResponseDecisionCards<Card extends { instanceId?: number | string | null }>(
  decisions: AIDecisionPlan, cards: readonly Card[]): Card[] {
  const bound = new Set<Card>();
  readChainResponseDecisions(decisions, id => {
    const card = cards.find(card => String(card.instanceId) === String(id));
    if (!card) return null;
    bound.add(card);
    return id;
  });
  return [...bound];
}

function gameCards(game: ChainGamePort | null): ChainCard[] {
  return game ? [game.player, game.bot].flatMap(player => [
    ...player.deck, ...player.extraDeck, ...player.hand, ...player.field,
    ...player.spellTrap, ...player.graveyard, ...player.banished,
    ...(player.fieldSpell ? [player.fieldSpell] : []),
  ]) : [];
}

const strategyActivationMetadata = new Set([
  "decisions", "autoSelectTargets", "autoSelectSingleTarget", "logTargets", "targetPreferences",
  "actionContext", "effect", "effectId", "fromHand", "zone", "sourceZone", "activationZone",
  "trapActivationFromSet", "blueprintSourceCardId", "blueprintId",
]);

/** Keep the canonical source/timing and transport only the strategy's exact choices. */
export function normalizeChainResponseCandidate(
  canonical: ChainActivationCandidate,
  proposed: unknown,
): ChainActivationCandidate | null {
  if (!object(proposed) || proposed.card !== canonical.card || proposed.effect !== canonical.effect) return null;
  for (const key of ["effectId", "player", "controller", "sourceZone", "sourceLocationVersion", "spellSpeed"] as const) {
    if (key in proposed && proposed[key] !== canonical[key]) return null;
  }
  const context = proposed.context;
  if (context == null) return canonical;
  if (!object(context)) return null;
  for (const [key, value] of Object.entries(context)) {
    if (key === "activationContext") continue;
    if (key === "_chainRootContext" && (value === canonical.context || value === canonical.context._chainRootContext)) continue;
    if (value !== Reflect.get(canonical.context, key)) return null;
  }
  const activation = context.activationContext;
  if (activation == null) return canonical;
  if (!object(activation) || Object.keys(activation).some(key =>
    !strategyActivationMetadata.has(key) && activation[key] !== Reflect.get(canonical.context.activationContext || {}, key)
  )) return null;
  if (!("decisions" in activation)) return canonical;
  const decisions = readChainResponseDecisions(activation.decisions);
  if (!decisions) return null;
  return {
    ...canonical,
    context: {
      ...canonical.context,
      activationContext: { ...canonical.context.activationContext, decisions },
    },
  };
}

export function createChainResponseDecisionAdapter(
  game: ChainGamePort | null,
  candidates: readonly ChainActivationCandidate[],
): Pick<ChainDecisionRequest, "normalizeCandidateResult" | "serializeResult" | "deserializeReplayValue"> {
  const find = (value: unknown) => object(value)
    ? candidates.find(candidate => candidate.candidateKey === value.candidateKey)
    : undefined;
  const mapIdentity = (id: number | string, replay: boolean) => {
    const card = gameCards(game).find(entry => String(replay ? entry.duelCardId : entry.instanceId) === String(id));
    return card ? (replay ? card.instanceId : game?.ensureDuelCardId?.(card) ?? card.duelCardId) ?? null : null;
  };
  return {
    normalizeCandidateResult: (canonical, result) => {
      const candidate = find(canonical);
      const normalized = candidate ? normalizeChainResponseCandidate(candidate, result) : null;
      const decisions = normalized?.context.activationContext?.decisions;
      if (decisions && !readChainResponseDecisions(decisions, id => {
        const card = gameCards(game).find(entry => String(entry.instanceId) === String(id));
        return card?.instanceId ?? null;
      })) return null;
      return normalized;
    },
    serializeResult: result => {
      if (result == null) return { pass: true };
      const canonical = find(result);
      const candidate = canonical && normalizeChainResponseCandidate(canonical, result);
      if (!candidate) throw new Error("Cannot record an invalid Chain response.");
      const value: ChainResponseDecisionValue = {
        pass: false,
        candidateKey: candidate.candidateKey,
        effectId: candidate.effectId,
      };
      const decisions = candidate.context.activationContext?.decisions;
      if (decisions) {
        const serialized = serializeChainResponseDecisions(decisions, id => mapIdentity(id, false));
        if (!serialized) throw new Error("Cannot record unavailable Chain response choices.");
        value.decisions = serialized;
      }
      return value;
    },
    deserializeReplayValue: value => {
      if (!object(value) || value.pass === true) return null;
      if (value.pass !== false || Object.keys(value).some(key => !["pass", "candidateKey", "effectId", "decisions"].includes(key))) return null;
      const candidate = find(value);
      if (!candidate || value.effectId !== candidate.effectId) return null;
      if (!("decisions" in value)) return candidate;
      const decisions = readChainResponseDecisions(value.decisions, id => mapIdentity(id, true), true);
      return decisions ? {
        ...candidate,
        context: {
          ...candidate.context,
          activationContext: { ...candidate.context.activationContext, decisions },
        },
      } : null;
    },
  };
}
