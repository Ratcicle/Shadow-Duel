import type {
  ActiveSelectionSession,
  SelectionCandidate,
  SelectionKind,
  SelectionResult,
  SerializedSelectionValue,
} from "./selection.js";
import type { DecisionId } from "./primitives.js";

export type MaybePromise<Value> = Value | PromiseLike<Value>;

export type DecisionBrokerMode = "live" | "replay";

export interface DecisionActor {
  id: string;
  controllerType?: string;
}

export type DecisionCandidateIdentity = string | number;

export interface DecisionCandidateBase {
  candidateKey?: DecisionCandidateIdentity | null;
  key?: DecisionCandidateIdentity | null;
  candidateId?: DecisionCandidateIdentity | null;
  id?: DecisionCandidateIdentity | null;
  effectId?: string | null;
  effect?: { id?: string } | null;
}

export interface ChainResponseDecisionCandidate extends DecisionCandidateBase {
  candidateKey: string;
  card: object;
  effect: { id?: string };
}

export interface SegocOrderDecisionCandidate extends DecisionCandidateBase {
  candidateId: number;
  controller: DecisionActor;
  card: object;
  effect: { id?: string };
}

export interface ChainResponseDecisionContext {
  type: string | null;
  chainId: string | number | null;
  respondingToLinkId: string | number | null;
}

export interface SegocOrderDecisionContext {
  group: string | null;
  optional: boolean;
}

export interface SelectionDecisionContext {
  session?: ActiveSelectionSession;
}

export interface PassDecisionValue {
  pass: true;
}

export interface CandidateDecisionValue {
  pass: false;
  candidateKey: DecisionCandidateIdentity | null;
  effectId: string | null;
}

export interface OrderedDecisionValue {
  orderedCandidateKeys: DecisionCandidateIdentity[];
}

export interface RawDecisionValue {
  raw: unknown;
}

export type DefaultDecisionValue =
  | PassDecisionValue
  | CandidateDecisionValue
  | OrderedDecisionValue;

/** Human SEGOC currently returns numeric ids before normalization. */
export type SegocOrderDecisionResult =
  | Array<SegocOrderDecisionCandidate | number>
  | null;

export interface DecisionSpec<
  Candidate,
  Result,
  ReplayValue,
  Context,
> {
  readonly candidate: Candidate;
  readonly result: Result;
  readonly replayValue: ReplayValue;
  readonly context: Context;
}

export type SelectionDecisionKind = SelectionKind | "target_selection";

type SelectionDecisionByKind = {
  [Kind in SelectionDecisionKind]: DecisionSpec<
    SelectionCandidate,
    SelectionResult | null,
    SerializedSelectionValue | DefaultDecisionValue,
    SelectionDecisionContext | null
  >;
};

/** Compile-time source linking each runtime kind to its full decision contract. */
export type DecisionByKind = SelectionDecisionByKind & {
  chain_response: DecisionSpec<
    ChainResponseDecisionCandidate,
    ChainResponseDecisionCandidate | null,
    PassDecisionValue | CandidateDecisionValue,
    ChainResponseDecisionContext | null
  >;
  segoc_order: DecisionSpec<
    SegocOrderDecisionCandidate,
    SegocOrderDecisionResult,
    OrderedDecisionValue | PassDecisionValue,
    SegocOrderDecisionContext | null
  >;
};

export type DecisionKind = keyof DecisionByKind;
export type DecisionCandidate<Kind extends DecisionKind> =
  DecisionByKind[Kind]["candidate"];
export type DecisionResult<Kind extends DecisionKind> =
  DecisionByKind[Kind]["result"];
export type DecisionReplayValue<Kind extends DecisionKind> =
  DecisionByKind[Kind]["replayValue"];
export type DecisionContext<Kind extends DecisionKind> =
  DecisionByKind[Kind]["context"];

export interface DecisionRequest<Kind extends DecisionKind> {
  kind: Kind;
  actor?: DecisionActor | null;
  actorId?: string | null;
  candidates?: DecisionCandidate<Kind>[];
  requireCandidate?: boolean;
  contextSnapshot?: DecisionContext<Kind>;
  resolveAI?: () => MaybePromise<DecisionResult<Kind>>;
  resolveHuman?: () => MaybePromise<DecisionResult<Kind>>;
  serializeResult?: (
    result: DecisionResult<Kind>,
  ) => DecisionReplayValue<Kind>;
  deserializeReplayValue?: (
    value: DecisionReplayValue<Kind>,
    candidates: DecisionCandidate<Kind>[],
  ) => DecisionResult<Kind>;
}

export interface RecordedDecision<Kind extends DecisionKind = DecisionKind> {
  decisionId: DecisionId;
  kind: Kind;
  actorId: string | null;
  candidateKeys: DecisionCandidateIdentity[];
  value: DecisionReplayValue<Kind>;
  context: DecisionContext<Kind>;
}

/** Unvalidated replay input remains a compatibility boundary until Stage 6. */
export interface ReplayDecisionInput {
  decisionId?: DecisionId | number;
  kind: string;
  actorId?: string | null;
  candidateKeys?: DecisionCandidateIdentity[];
  value?: unknown;
  context?: object | null;
}

export interface DecisionBrokerOptions {
  mode?: DecisionBrokerMode;
}

export interface DecisionBrokerGamePort {
  recordReplayDecision?(decision: RecordedDecision): void;
  notify?(eventName: "decision_made" | "decision_rejected", payload: object): void;
}

export interface DecisionBrokerPort {
  mode: DecisionBrokerMode;
  replayCursor: number;
  loadReplayDecisions(decisions?: ReplayDecisionInput[]): void;
  recordDecision(): RecordedDecision<"choice">;
  recordDecision<Kind extends DecisionKind>(
    input: DecisionRequest<Kind>,
    result?: DecisionResult<Kind> | null,
  ): RecordedDecision<Kind>;
  requestDecision(): Promise<SelectionResult | null>;
  requestDecision<Kind extends DecisionKind>(
    input: DecisionRequest<Kind>,
  ): Promise<DecisionResult<Kind>>;
}

export interface TriggerOrderPromptContract {
  kind: "trigger_order";
  group: string | null;
  optional: boolean;
  candidates: object[];
}
