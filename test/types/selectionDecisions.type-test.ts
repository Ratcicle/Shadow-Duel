import type {
  ChainResponseDecisionCandidate,
  DecisionRequest,
  SegocOrderDecisionCandidate,
  TriggerOrderPromptContract,
} from "../../src/core/contracts/decisions.js";
import type { SelectionCandidateKey } from "../../src/core/contracts/primitives.js";
import type {
  CanonicalSelectionState,
  NormalizedSelectionContract,
  RawSelectionContract,
  SelectionCandidate,
  SelectionKind,
  SelectionResult,
} from "../../src/core/contracts/selection.js";

function assertSelectionDecisionTypes(selectionKey: SelectionCandidateKey): void {

const rawContract: RawSelectionContract = {
  kind: "target",
  timing: "activation",
  purpose: "target",
  requirements: {
    id: "target",
    count: { min: 1, max: 1 },
    zone: "banish",
    owner: "any",
    strategy: "highest_atk",
    intent: "harm",
    candidates: [{ key: "raw", zone: "banish" }],
  },
  ui: { message: "raw-only" },
};

const normalizedCandidate: SelectionCandidate = {
  key: selectionKey,
  zone: "field",
};

const normalizedContract: NormalizedSelectionContract = {
  kind: "target",
  message: null,
  requirements: [
    {
      id: "target",
      label: null,
      min: 1,
      max: 1,
      zones: ["field"],
      owner: "player",
      filters: {},
      allowSelf: true,
      distinct: true,
      candidates: [normalizedCandidate],
    },
  ],
  ui: { allowCancel: true, preventCancel: false },
  metadata: {},
};

// contract-negative: normalized contracts cannot retain raw timing
// @ts-expect-error
normalizedContract.timing = "activation";

// contract-negative: normalized contracts cannot retain raw purpose
// @ts-expect-error
normalizedContract.purpose = "target";

// contract-negative: ui.message is input-only and not canonical output
// @ts-expect-error
normalizedContract.ui.message = "not normalized";

// contract-negative: normalized requirements use zones, not legacy zone
// @ts-expect-error
normalizedContract.requirements[0].zone = "field";

// contract-negative: normalized candidates require a branded key
// @ts-expect-error
const candidateWithRawKey: SelectionCandidate = { key: "raw", zone: "field" };

const selections: SelectionResult = { target: [selectionKey] };
const phaseSelections: CanonicalSelectionState = {
  costSelections: { payment: [selectionKey] },
  targetSelections: selections,
  resolutionSelections: { followup: [selectionKey] },
};

// contract-negative: selection result values are always arrays of branded keys
// @ts-expect-error
const scalarSelection: SelectionResult = { target: selectionKey };

const selectionKind: SelectionKind = "fusion_materials";

// contract-negative: selection kinds are a closed runtime union
// @ts-expect-error
const unknownSelectionKind: SelectionKind = "effect_choice";

const chainCandidate: ChainResponseDecisionCandidate = {
  candidateKey: "chain:card:effect",
  card: {},
  effect: { id: "effect" },
};
const chainRequest: DecisionRequest<"chain_response"> = {
  kind: "chain_response",
  candidates: [chainCandidate],
  resolveHuman: () => chainCandidate,
  serializeResult: (result) =>
    result === null
      ? { pass: true }
      : {
          pass: false,
          candidateKey: result.candidateKey,
          effectId: result.effect.id ?? null,
        },
};

const wrongChainResult: DecisionRequest<"chain_response"> = {
  kind: "chain_response",
  candidates: [chainCandidate],
  // contract-negative: chain response cannot return a selection map
  // @ts-expect-error
  resolveHuman: () => selections,
};

const segocCandidate: SegocOrderDecisionCandidate = {
  candidateId: 1,
  controller: { id: "player", controllerType: "human" },
  card: {},
  effect: { id: "trigger" },
};
const segocRequest: DecisionRequest<"segoc_order"> = {
  kind: "segoc_order",
  candidates: [segocCandidate],
  resolveHuman: () => [1],
};

const wrongSegocResult: DecisionRequest<"segoc_order"> = {
  kind: "segoc_order",
  candidates: [segocCandidate],
  // contract-negative: SEGOC ordering cannot return a chain response candidate
  // @ts-expect-error
  resolveHuman: () => chainCandidate,
};

const choiceRequest: DecisionRequest<"choice"> = {
  kind: "choice",
  candidates: [normalizedCandidate],
  requireCandidate: false,
  resolveHuman: () => selections,
  deserializeReplayValue: () => selections,
};

const wrongChoiceResult: DecisionRequest<"choice"> = {
  kind: "choice",
  candidates: [normalizedCandidate],
  // contract-negative: a selection decision cannot return a SEGOC order
  // @ts-expect-error
  resolveHuman: () => [segocCandidate],
};

const triggerPrompt: TriggerOrderPromptContract = {
  kind: "trigger_order",
  group: "turn_player_optional",
  optional: true,
  candidates: [{}],
};

void rawContract;
void normalizedContract;
void candidateWithRawKey;
void selections;
void phaseSelections;
void scalarSelection;
void selectionKind;
void unknownSelectionKind;
void chainRequest;
void wrongChainResult;
void segocRequest;
void wrongSegocResult;
void choiceRequest;
void wrongChoiceResult;
void triggerPrompt;
}

void assertSelectionDecisionTypes;
