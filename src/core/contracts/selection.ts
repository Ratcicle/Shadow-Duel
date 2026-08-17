import type { CardKind } from "./cards.js";
import type { CardFilter, EffectZone } from "./effects.js";
import type {
  DuelCardId,
  PlayerId,
  SelectionCandidateKey,
} from "./primitives.js";
import type { LegacyZoneAlias } from "./zones.js";

/** Runtime selection modes currently produced by Game, EffectEngine and Chain. */
export const SELECTION_KINDS = Object.freeze([
  "target",
  "choice",
  "cost",
  "position_select",
  "fusion_select",
  "fusion_materials",
  "synchro",
  "synchro_extra_deck",
  "ascension",
  "attack",
  "custom",
  "chain",
  "destruction_negation",
  "destruction_replacement_target",
  "extra_deck_summon",
  "extra_deck_material",
  "extra_deck_materials",
  "activation",
  "triggered",
  "monsterEffect",
  "graveyardEffect",
  "spellTrapEffect",
  "fieldSpell",
  "optional_target_actions",
] as const);

export type SelectionKind = (typeof SELECTION_KINDS)[number];

export const SELECTION_PURPOSES = Object.freeze([
  "cost",
  "target",
  "resolution",
] as const);

export type SelectionPurpose = (typeof SELECTION_PURPOSES)[number];

/**
 * Zones used only while presenting a choice are intentionally separate from
 * canonical card locations. "extra" is the legacy display alias used by the
 * Fusion picker, while "choice" represents a non-card option.
 */
export type SelectionZone =
  | EffectZone
  | LegacyZoneAlias
  | "choice"
  | "extra";

export type SelectionOwnerInput =
  | "player"
  | "opponent"
  | "either"
  | "any"
  | "self";

export type SelectionOwner = "player" | "opponent" | "either";

export type SelectionStrategy =
  | "highest_atk"
  | "lowest_atk"
  | "highest_def"
  | "lowest_def";

export type SelectionIntent =
  | "benefit"
  | "cost"
  | "declare"
  | "discard"
  | "harm";

export interface SelectionEffectReference {
  id?: string;
}

/** Optional capabilities consumed by deterministic selection scoring. */
export interface SelectionScoringCapabilities {
  instanceId?: number | string;
  fieldPresenceId?: number | string | null;
  archetype?: string | null;
  archetypes?: string[];
  goodDiscard?: boolean;
  cannotBeNormalSummonedOrSet?: boolean;
  usedEffectThisTurn?: boolean;
  hasAttacked?: boolean;
  mustBeAttacked?: boolean;
  tempAtkBoost?: number;
  tempDefBoost?: number;
  equipAtkBonus?: number;
  equipDefBonus?: number;
  cannotAttackThisTurn?: boolean;
  piercing?: boolean;
}

/** Minimal mutable card projection needed by selection and replay identity. */
export interface SelectionCardReference extends SelectionScoringCapabilities {
  id?: string | number;
  duelCardId?: DuelCardId | number;
  name?: string;
  label?: string;
  description?: string;
  image?: string;
  cardKind?: CardKind | string;
  owner?: PlayerId | string;
  controller?: PlayerId | string;
  position?: string | null;
  atk?: number | null;
  def?: number | null;
  level?: number | null;
  effects?: readonly SelectionEffectReference[];
}

/** Minimal player projection used to identify the actor and inspect zones. */
export interface SelectionPlayerReference {
  id: PlayerId | string;
  controllerType?: string;
  field: SelectionCardReference[];
  spellTrap: SelectionCardReference[];
  hand: SelectionCardReference[];
  graveyard?: SelectionCardReference[];
  deck?: SelectionCardReference[];
  extraDeck?: SelectionCardReference[];
  banished?: SelectionCardReference[];
  fieldSpell: SelectionCardReference | null;
}

interface SelectionCandidateFields extends SelectionScoringCapabilities {
  idx?: number;
  candidateKey?: string | null;
  candidateId?: string | number | null;
  id?: string | number;
  cardRef?: SelectionCardReference | null;
  card?: SelectionCardReference | null;
  effectId?: string | null;
  effect?: SelectionEffectReference | null;
  controller?: PlayerId | string;
  owner?: SelectionOwnerInput | PlayerId | string;
  zone?: SelectionZone;
  zoneName?: SelectionZone;
  zoneIndex?: number;
  name?: string;
  label?: string;
  description?: string;
  image?: string | null;
  position?: string | null;
  atk?: number | null;
  def?: number | null;
  level?: number | null;
  cardKind?: CardKind | string;
  isDirectAttack?: boolean;
}

/** Candidate before it crosses the canonical key-building boundary. */
export interface RawSelectionCandidate extends SelectionCandidateFields {
  key?: string;
}

/** Candidate after normalization. The object itself remains mutable by design. */
export interface SelectionCandidate extends SelectionCandidateFields {
  key: SelectionCandidateKey;
}

export interface RawSelectionCount {
  min?: number;
  max?: number;
}

export interface RawSelectionRequirement {
  id?: string;
  label?: string | null;
  title?: string | null;
  min?: number;
  max?: number;
  count?: RawSelectionCount;
  zone?: SelectionZone;
  zones?: SelectionZone[];
  owner?: SelectionOwnerInput;
  filters?: SelectionFilter;
  strategy?: SelectionStrategy;
  intent?: SelectionIntent | null;
  allowSelf?: boolean;
  distinct?: boolean;
  candidates?: RawSelectionCandidate[];
}

export interface SelectionRequirement {
  id: string;
  label: string | null;
  min: number;
  max: number;
  zones: SelectionZone[];
  owner: SelectionOwner;
  filters: SelectionFilter;
  allowSelf: boolean;
  distinct: boolean;
  candidates: SelectionCandidate[];
}

/** Input-only UI fields. `message` is intentionally not normalized. */
export interface RawSelectionUIConfig {
  allowCancel?: boolean;
  preventCancel?: boolean;
  useFieldTargeting?: boolean;
  allowEmpty?: boolean;
  message?: string | null;
}

/** Exact UI keyset emitted by normalizeSelectionContract. */
export interface SelectionUIConfig {
  allowCancel: boolean;
  preventCancel: boolean;
  useFieldTargeting?: boolean;
  allowEmpty?: boolean;
}

export interface SelectionFilter extends CardFilter {
  /** Legacy selection contracts use this spelling without runtime normalization. */
  faceUp?: boolean;
  strategy?: SelectionStrategy;
  intent?: SelectionIntent;
  requireThisCard?: boolean;
  battleParticipant?: boolean;
  tags?: readonly string[];
}

export interface SelectionCardDisplayData {
  cardId: string | number | null;
  name: string;
  image: string | null;
  cardKind: CardKind | string;
  atk: number | null;
  def: number | null;
  level: number | null;
}

/** Known metadata passed through the selection boundary without interpretation. */
export interface SelectionMetadata {
  context?: string;
  intent?: SelectionIntent;
  sourceCard?: SelectionCardReference | string | null;
  sourceCardName?: string | null;
  sourceCardId?: string | number | null;
  sourceZone?: SelectionZone;
  effectId?: string | null;
  cardData?: SelectionCardDisplayData;
}

/** Authoring/runtime input. Legacy aliases remain accepted only here. */
export interface RawSelectionContract {
  kind?: SelectionKind;
  timing?: string;
  purpose?: SelectionPurpose;
  message?: string | null;
  requirements?: RawSelectionRequirement | RawSelectionRequirement[];
  ui?: RawSelectionUIConfig;
  metadata?: SelectionMetadata;
}

/**
 * Canonical runtime form. Deliberately excludes raw `timing`, `purpose` and
 * `ui.message`, matching the existing normalizer's observable output.
 */
export interface NormalizedSelectionContract {
  kind: SelectionKind;
  message: string | null;
  requirements: SelectionRequirement[];
  ui: SelectionUIConfig;
  metadata: SelectionMetadata;
}

export type SelectionNormalizationResult =
  | { ok: true; contract: NormalizedSelectionContract }
  | { ok: false; reason: string };

export interface SelectionNormalizationOverrides {
  kind?: SelectionKind;
  message?: string | null;
  ui?: RawSelectionUIConfig;
}

/** The only intentionally dynamic result dictionary in the selection layer. */
export interface SelectionResult {
  [requirementId: string]: SelectionCandidateKey[];
}

export interface SelectionCardEnvelope {
  card: SelectionCardReference;
}

export type CanonicalSelectionValue =
  | SelectionCandidateKey[]
  | SelectionCardReference
  | SelectionCardReference[]
  | SelectionCardEnvelope
  | string
  | number
  | boolean
  | null
  | undefined;

/** Dynamic references are confined to the three explicit selection channels. */
export interface CanonicalSelectionMap {
  [selectionReference: string]: CanonicalSelectionValue;
}

/** Named channels retain the three independent phases of an effect. */
export interface CostSelections extends CanonicalSelectionMap {}
export interface TargetSelections extends CanonicalSelectionMap {}
export interface ResolutionSelections extends CanonicalSelectionMap {}

export interface CanonicalSelectionState {
  costSelections?: CostSelections | null;
  targetSelections?: TargetSelections | null;
  resolutionSelections?: ResolutionSelections | null;
}

/** Compatibility input for contexts not yet converted from their object port. */
export interface SelectionChannelSource {
  costSelections?: object | null;
  targetSelections?: object | null;
  resolutionSelections?: object | null;
}

export type SelectionSessionState =
  | "idle"
  | "selecting"
  | "confirming"
  | "resolving";

export interface SelectionActivationContext {
  committed?: boolean;
}

export interface SelectionExecutionResult {
  success?: boolean;
  ok?: boolean;
  needsSelection?: boolean;
  reason?: string | null;
  selectionContract?: RawSelectionContract;
  executed?: boolean;
  cancelled?: boolean;
}

export interface NormalizedSelectionExecutionResult {
  success: boolean;
  ok?: boolean;
  needsSelection: boolean;
  reason?: string | null;
  selectionContract?: RawSelectionContract;
  executed?: boolean;
  cancelled?: boolean;
}

export type SelectionExecutionReturn =
  | SelectionExecutionResult
  | boolean
  | null
  | undefined;

type SelectionSessionResolverValue =
  | SelectionResult
  | SelectionCardReference[]
  | null;

/** Callback is bivariant because legacy sessions resolve different result views. */
export type SelectionSessionResolver = {
  bivarianceHack(value: SelectionSessionResolverValue): void;
}["bivarianceHack"];

export interface SelectionSessionInput {
  kind?: SelectionKind;
  selectionContract: RawSelectionContract;
  owner?: SelectionPlayerReference | null;
  player?: SelectionPlayerReference | null;
  controller?: SelectionPlayerReference | null;
  card?: SelectionCardReference | null;
  attacker?: SelectionCardReference | null;
  message?: string | null;
  allowCancel?: boolean;
  preventCancel?: boolean;
  useFieldTargeting?: boolean;
  allowEmpty?: boolean;
  autoAdvanceOnMax?: boolean;
  activationContext?: SelectionActivationContext | null;
  replayCommandDescriptor?: object | null;
  resolve?: SelectionSessionResolver;
  execute?: (
    selections: SelectionResult,
  ) => SelectionExecutionReturn | PromiseLike<SelectionExecutionReturn>;
  rollback?: () => void;
  onResult?: (
    result: NormalizedSelectionExecutionResult,
  ) => unknown;
  onCancel?: () => void;
}

export interface SelectionControlsState {
  selected: number;
  min: number;
  max: number;
  allowEmpty: boolean;
}

export interface SelectionControlsHandle {
  updateState?(state: SelectionControlsState): void;
}

export interface ActiveSelectionSession extends SelectionSessionInput {
  selectionContract: NormalizedSelectionContract;
  requirements: SelectionRequirement[];
  selections: SelectionResult;
  currentRequirement: number;
  sessionId: number;
  usingFieldTargeting: boolean;
  allowCancel: boolean;
  allowEmpty: boolean;
  autoAdvanceOnMax: boolean;
  state?: SelectionSessionState;
  controlsHandle?: SelectionControlsHandle | null;
  closeModal?: () => void;
  confirmOnRepeatedTarget?: boolean;
}

export interface FullSerializedSelectionCandidateIdentity {
  duelCardId: DuelCardId | number | null;
  cardId: string | number | null;
  effectId: string | null;
  candidateKey: string | null;
  key: string | number | null;
}

export interface SerializedSelectionKeyIdentity {
  key: string | number;
}

export type SerializedSelectionCandidateIdentity =
  | FullSerializedSelectionCandidateIdentity
  | SerializedSelectionKeyIdentity;

/** Local decision value only; the canonical replay schema remains Stage 6. */
export interface SerializedSelectionValue {
  selections: {
    [requirementId: string]: SerializedSelectionCandidateIdentity[];
  };
}
