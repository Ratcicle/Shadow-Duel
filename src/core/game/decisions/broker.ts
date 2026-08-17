import type { DecisionId } from "../../contracts/primitives.js";
import type {
  DecisionActor,
  DecisionBrokerGamePort,
  DecisionBrokerMode,
  DecisionBrokerOptions,
  DecisionCandidateIdentity,
  DecisionKind,
  DecisionRequest,
  DecisionResult,
  DefaultDecisionValue,
  RecordedDecision,
  ReplayDecisionInput,
} from "../../contracts/decisions.js";
import type { SelectionResult } from "../../contracts/selection.js";

type UnknownObject = { [property: string]: unknown };

interface RuntimeDecisionInput {
  kind?: string;
  actor?: DecisionActor | null;
  actorId?: string | null;
  candidates?: unknown[];
  requireCandidate?: boolean;
  contextSnapshot?: object | null;
  resolveAI?: () => unknown;
  resolveHuman?: () => unknown;
  serializeResult?: (result: unknown) => unknown;
  deserializeReplayValue?: (value: unknown, candidates: unknown[]) => unknown;
}

interface DecisionBrokerState {
  game: DecisionBrokerGamePort;
  nextDecisionId: number;
}

function isObject(value: unknown): value is UnknownObject {
  return typeof value === "object" && value !== null;
}

function readValue(value: UnknownObject, key: string): unknown {
  return Reflect.get(value, key);
}

function candidateKey(candidate: unknown): unknown {
  if (!isObject(candidate)) return null;
  return (
    readValue(candidate, "candidateKey") ??
    readValue(candidate, "key") ??
    readValue(candidate, "candidateId") ??
    readValue(candidate, "id") ??
    null
  );
}

function defaultValue(result: unknown): DefaultDecisionValue {
  if (result == null) return { pass: true };
  if (Array.isArray(result)) {
    return {
      orderedCandidateKeys: result
        .map(candidateKey)
        .filter(Boolean) as DecisionCandidateIdentity[],
    };
  }
  const resultObject = isObject(result) ? result : {};
  const effect = readValue(resultObject, "effect");
  const effectId =
    readValue(resultObject, "effectId") ||
    (isObject(effect) ? readValue(effect, "id") : null) ||
    null;
  return {
    pass: false,
    candidateKey: candidateKey(result) as DecisionCandidateIdentity | null,
    effectId: effectId as string | null,
  };
}

function matchReplayValue(value: unknown, candidates: unknown[]): unknown {
  if (!isObject(value)) return null;
  if (readValue(value, "pass") === true) return null;
  const recordedCandidateKey = readValue(value, "candidateKey");
  if (recordedCandidateKey != null) {
    return candidates.find(
      (candidate) =>
        String(candidateKey(candidate)) === String(recordedCandidateKey),
    ) || null;
  }
  const orderedCandidateKeys = readValue(value, "orderedCandidateKeys");
  if (Array.isArray(orderedCandidateKeys)) {
    const byKey = new Map(
      candidates.map((candidate) => [String(candidateKey(candidate)), candidate]),
    );
    return orderedCandidateKeys
      .map((entry) => byKey.get(String(entry)))
      .filter(Boolean);
  }
  const selections = readValue(value, "selections");
  if (selections && typeof selections === "object") {
    return selections;
  }
  return readValue(value, "raw") ?? null;
}

function allocateDecisionId(state: DecisionBrokerState): DecisionId {
  return state.nextDecisionId++ as DecisionId;
}

function recordRuntimeDecision(
  state: DecisionBrokerState,
  input: RuntimeDecisionInput,
  result: unknown,
): RecordedDecision {
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const decision = {
    decisionId: allocateDecisionId(state),
    kind: input.kind || "choice",
    actorId: input.actor?.id || input.actorId || null,
    candidateKeys: candidates
      .map(candidateKey)
      .filter(
        (identity) => identity != null,
      ) as DecisionCandidateIdentity[],
    value:
      typeof input.serializeResult === "function"
        ? input.serializeResult(result)
        : defaultValue(result),
    context: input.contextSnapshot || null,
  } as RecordedDecision;
  state.game?.recordReplayDecision?.(decision);
  state.game?.notify?.("decision_made", decision);
  return decision;
}

function replayValueIsPass(value: unknown): boolean {
  return isObject(value) && readValue(value, "pass") === true;
}

export class DecisionBroker {
  game: DecisionBrokerGamePort;
  mode: DecisionBrokerMode;
  nextDecisionId: number;
  replayDecisions: ReplayDecisionInput[];
  replayCursor: number;

  constructor(
    game: DecisionBrokerGamePort,
    options: DecisionBrokerOptions = {},
  ) {
    this.game = game;
    this.mode = options.mode || "live";
    this.nextDecisionId = 1;
    this.replayDecisions = [];
    this.replayCursor = 0;
  }

  loadReplayDecisions(decisions?: ReplayDecisionInput[]): void;
  loadReplayDecisions(decisions: unknown = []): void {
    this.mode = "replay";
    this.replayDecisions = Array.isArray(decisions)
      ? (decisions as ReplayDecisionInput[])
      : [];
    this.replayCursor = 0;
  }

  recordDecision<Kind extends DecisionKind>(
    input: DecisionRequest<Kind>,
    result?: DecisionResult<Kind> | null,
  ): RecordedDecision<Kind>;
  recordDecision(): RecordedDecision<"choice">;
  recordDecision(
    input: unknown = {},
    result: unknown = null,
  ): RecordedDecision {
    return recordRuntimeDecision(this, input as RuntimeDecisionInput, result);
  }

  requestDecision<Kind extends DecisionKind>(
    input: DecisionRequest<Kind>,
  ): Promise<DecisionResult<Kind>>;
  requestDecision(): Promise<SelectionResult | null>;
  async requestDecision(input: unknown = {}): Promise<unknown> {
    const runtimeInput = input as RuntimeDecisionInput;
    const candidates = Array.isArray(runtimeInput.candidates)
      ? runtimeInput.candidates
      : [];
    if (this.mode === "replay") {
      const recorded = this.replayDecisions[this.replayCursor++];
      if (!recorded || recorded.kind !== runtimeInput.kind) {
        throw new Error(
          `Replay decision mismatch at ${this.replayCursor}: expected ${runtimeInput.kind}.`,
        );
      }
      const result = typeof runtimeInput.deserializeReplayValue === "function"
        ? runtimeInput.deserializeReplayValue(recorded.value, candidates)
        : matchReplayValue(recorded.value, candidates);
      if (!replayValueIsPass(recorded.value) && result == null) {
        throw new Error(
          `Replay decision ${recorded.decisionId || this.replayCursor} is no longer legal.`,
        );
      }
      return result;
    }

    const resolver = runtimeInput.actor?.controllerType === "ai"
      ? runtimeInput.resolveAI
      : runtimeInput.resolveHuman;
    let result = typeof resolver === "function" ? await resolver() : null;
    if (
      result != null &&
      runtimeInput.requireCandidate !== false &&
      !Array.isArray(result) &&
      candidates.length > 0 &&
      !candidates.includes(result)
    ) {
      result = candidates.find(
        (candidate) => candidateKey(candidate) === candidateKey(result),
      ) || null;
      if (!result) {
        this.game?.notify?.("decision_rejected", {
          kind: runtimeInput.kind || "choice",
          reason: "choice_not_in_candidate_list",
        });
      }
    }
    recordRuntimeDecision(this, runtimeInput, result);
    return result;
  }
}

export function createDecisionBroker(
  game: DecisionBrokerGamePort,
  options: DecisionBrokerOptions = {},
): DecisionBroker {
  return new DecisionBroker(game, options);
}
