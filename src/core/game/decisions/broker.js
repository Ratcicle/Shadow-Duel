function candidateKey(candidate) {
  return candidate?.candidateKey ?? candidate?.key ?? candidate?.candidateId ?? candidate?.id ?? null;
}

function defaultValue(result) {
  if (result == null) return { pass: true };
  if (Array.isArray(result)) {
    return { orderedCandidateKeys: result.map(candidateKey).filter(Boolean) };
  }
  return {
    pass: false,
    candidateKey: candidateKey(result),
    effectId: result.effectId || result.effect?.id || null,
  };
}

function matchReplayValue(value, candidates) {
  if (value?.pass === true) return null;
  if (value?.candidateKey != null) {
    return candidates.find(
      (candidate) => String(candidateKey(candidate)) === String(value.candidateKey),
    ) || null;
  }
  if (Array.isArray(value?.orderedCandidateKeys)) {
    const byKey = new Map(
      candidates.map((candidate) => [String(candidateKey(candidate)), candidate]),
    );
    return value.orderedCandidateKeys
      .map((entry) => byKey.get(String(entry)))
      .filter(Boolean);
  }
  if (value?.selections && typeof value.selections === "object") {
    return value.selections;
  }
  return value?.raw ?? null;
}

export class DecisionBroker {
  constructor(game, options = {}) {
    this.game = game;
    this.mode = options.mode || "live";
    this.nextDecisionId = 1;
    this.replayDecisions = [];
    this.replayCursor = 0;
  }

  loadReplayDecisions(decisions = []) {
    this.mode = "replay";
    this.replayDecisions = Array.isArray(decisions) ? decisions : [];
    this.replayCursor = 0;
  }

  recordDecision(input = {}, result = null) {
    const candidates = Array.isArray(input.candidates) ? input.candidates : [];
    const decision = {
      decisionId: this.nextDecisionId++,
      kind: input.kind || "choice",
      actorId: input.actor?.id || input.actorId || null,
      candidateKeys: candidates.map(candidateKey).filter((key) => key != null),
      value:
        typeof input.serializeResult === "function"
          ? input.serializeResult(result)
          : defaultValue(result),
      context: input.contextSnapshot || null,
    };
    this.game?.recordReplayDecision?.(decision);
    this.game?.notify?.("decision_made", decision);
    return decision;
  }

  async requestDecision(input = {}) {
    const candidates = Array.isArray(input.candidates) ? input.candidates : [];
    if (this.mode === "replay") {
      const recorded = this.replayDecisions[this.replayCursor++];
      if (!recorded || recorded.kind !== input.kind) {
        throw new Error(
          `Replay decision mismatch at ${this.replayCursor}: expected ${input.kind}.`,
        );
      }
      const result = typeof input.deserializeReplayValue === "function"
        ? input.deserializeReplayValue(recorded.value, candidates)
        : matchReplayValue(recorded.value, candidates);
      if (recorded.value?.pass !== true && result == null) {
        throw new Error(
          `Replay decision ${recorded.decisionId || this.replayCursor} is no longer legal.`,
        );
      }
      return result;
    }

    const resolver = input.actor?.controllerType === "ai"
      ? input.resolveAI
      : input.resolveHuman;
    let result = typeof resolver === "function" ? await resolver() : null;
    if (
      result != null &&
      input.requireCandidate !== false &&
      !Array.isArray(result) &&
      candidates.length > 0 &&
      !candidates.includes(result)
    ) {
      result = candidates.find(
        (candidate) => candidateKey(candidate) === candidateKey(result),
      ) || null;
      if (!result) {
        this.game?.notify?.("decision_rejected", {
          kind: input.kind || "choice",
          reason: "choice_not_in_candidate_list",
        });
      }
    }
    this.recordDecision(input, result);
    return result;
  }
}

export function createDecisionBroker(game, options = {}) {
  return new DecisionBroker(game, options);
}
