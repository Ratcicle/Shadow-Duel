import ChainSystem from "../../src/core/ChainSystem.js";
import NullChainSystem from "../../src/core/NullChainSystem.js";
import {
  CHAIN_ATTACHMENT_GROUPS,
  CHAIN_METHOD_MANIFEST,
} from "../../src/core/chain/attachments.js";
import type { ChainAttachedMethods } from "../../src/core/chain/attachments.js";
import type {
  ChainFinalizationStatus,
  ChainPreparationStatus,
  ChainResolutionStatus,
  FastEffectOrigin,
  FastEffectStateName,
  SegocGroup,
  SpellSpeed,
  TriggerEligibilityStatus,
} from "../../src/core/contracts/chain.js";
import {
  hasChainFastEffectTransitionCapability,
  hasChainLinkMutationCapability,
  hasChainSourceMovementCapability,
  hasChainTurnPlayerCapability,
} from "../../src/core/contracts/chainRuntime.js";
import type {
  ChainCard,
  ChainContext,
  ChainContextInput,
  ChainLink,
  ChainPlayer,
  ChainRuntimePort,
  FastEffectContextInput,
  FullChainHost,
  PreparedActivationInput,
} from "../../src/core/contracts/chainRuntime.js";
import type {
  ChainId,
  ChainLinkId,
} from "../../src/core/contracts/primitives.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;

type Expect<Value extends true> = Value;

declare const chainSystem: ChainSystem;
declare const nullChainSystem: NullChainSystem;
declare const runtimePort: ChainRuntimePort;
declare const unknownChain: unknown;
declare const card: ChainCard;
declare const player: ChainPlayer;
declare const link: ChainLink;
declare const chainId: ChainId;
declare const chainLinkId: ChainLinkId;

const realRuntimePort: ChainRuntimePort = chainSystem;
const nullRuntimePort: ChainRuntimePort = nullChainSystem;
const fullHost: FullChainHost = chainSystem;

// contract-negative: the Null facade intentionally lacks real Chain internals.
// @ts-expect-error
const invalidNullFullHost: FullChainHost = nullChainSystem;

// contract-negative: the common port does not expose source-movement mutation.
// @ts-expect-error
runtimePort.recordChainSourceMovement(card);

// contract-negative: the common port does not expose raw link mutation.
// @ts-expect-error
runtimePort.markChainLinkActivationNegated(link);

if (hasChainSourceMovementCapability(unknownChain)) {
  const locationVersion: number = unknownChain.recordChainSourceMovement(card, {
    toPlayer: player,
    toZone: "graveyard",
  });
  void locationVersion;
}

if (hasChainFastEffectTransitionCapability(unknownChain)) {
  const transitionedState = unknownChain.transitionFastEffectState(
    "trigger_check",
    { priorityPlayer: player },
  );
  const stateName: FastEffectStateName = transitionedState.state;
  void stateName;
}

if (hasChainTurnPlayerCapability(unknownChain)) {
  const currentTurnPlayer: ChainPlayer | null =
    unknownChain.getCurrentTurnPlayer();
  void currentTurnPlayer;
}

if (hasChainLinkMutationCapability(unknownChain)) {
  const negatedLink: ChainLink | null =
    unknownChain.markChainLinkEffectNegated(link, { negatedBy: card });
  void negatedLink;
}

const rawChainId: number = chainId;
const rawChainLinkId: number = chainLinkId;

// contract-negative: raw numbers have not crossed the Chain ID allocator.
// @ts-expect-error
const unvalidatedChainId: ChainId = 1;

// contract-negative: raw numbers have not crossed the Chain Link ID allocator.
// @ts-expect-error
const unvalidatedChainLinkId: ChainLinkId = 1;

// contract-negative: distinct deterministic ID brands are not interchangeable.
// @ts-expect-error
const wrongLinkId: ChainLinkId = chainId;

const registeredContext: ChainContext = { type: "attack_declaration" };
const eventTimingContext: FastEffectContextInput = { type: "after_summon" };
const fastEffectOrigin: FastEffectOrigin = "summon_attempt";
const fastEffectState: FastEffectStateName = "fast_effect_window";
const segocGroup: SegocGroup = "turn_player_mandatory";
const eligibilityStatus: TriggerEligibilityStatus = "eligible";
const preparationStatus: ChainPreparationStatus = "prepared";
const resolutionStatus: ChainResolutionStatus = "resolved";
const finalizationStatus: ChainFinalizationStatus = "completed";
const spellSpeed: SpellSpeed = 2;
const emptyContextInput: ChainContextInput = {};

const emptyFastEffectContext: FastEffectContextInput = {};

// contract-negative: response-window contexts are a closed union.
// @ts-expect-error
const unknownRegisteredContext: ChainContext = { type: "legacy_window" };

const unknownFastEffectContext: FastEffectContextInput = {
  // contract-negative: Fast Effect timing labels are a closed union.
  // @ts-expect-error
  type: "legacy_timing",
};

// contract-negative: Fast Effect origins reject historical free-form labels.
// @ts-expect-error
const unknownFastEffectOrigin: FastEffectOrigin = "legacy_origin";

// contract-negative: Fast Effect states reject historical free-form labels.
// @ts-expect-error
const unknownFastEffectState: FastEffectStateName = "waiting";

// contract-negative: SEGOC groups are tied to their canonical ordering buckets.
// @ts-expect-error
const unknownSegocGroup: SegocGroup = "mandatory";

// contract-negative: trigger eligibility lifecycle values are closed.
// @ts-expect-error
const unknownEligibilityStatus: TriggerEligibilityStatus = "ready";

// contract-negative: preparation lifecycle values are closed.
// @ts-expect-error
const unknownPreparationStatus: ChainPreparationStatus = "created";

// contract-negative: resolution lifecycle values are closed.
// @ts-expect-error
const unknownResolutionStatus: ChainResolutionStatus = "cancelled";

// contract-negative: finalization lifecycle values are closed.
// @ts-expect-error
const unknownFinalizationStatus: ChainFinalizationStatus = "pending_move";

// contract-negative: Spell Speed is restricted to the three canonical levels.
// @ts-expect-error
const unknownSpellSpeed: SpellSpeed = 4;

const legacyPlayerPreparation: PreparedActivationInput = {
  // contract-negative: PreparedActivation no longer accepts the player alias.
  // @ts-expect-error
  player: null,
};

const legacyZonePreparation: PreparedActivationInput = {
  // contract-negative: PreparedActivation no longer accepts the zone alias.
  // @ts-expect-error
  zone: "field",
};

const legacyActivationTypePreparation: PreparedActivationInput = {
  // contract-negative: PreparedActivation uses activationKind, not activationType.
  // @ts-expect-error
  activationType: "effect",
};

const legacyNegatedPreparation: PreparedActivationInput = {
  // contract-negative: activation and effect negation are distinct fields.
  // @ts-expect-error
  negated: true,
};

const legacySelectionsPreparation: PreparedActivationInput = {
  // contract-negative: cost, target and resolution selections stay separate.
  // @ts-expect-error
  selections: {},
};

const legacyUsagePreparation: PreparedActivationInput = {
  // contract-negative: usage registration is controlled by the canonical policy.
  // @ts-expect-error
  skipUsageRegistration: true,
};

const legacyAttemptPreparation: PreparedActivationInput = {
  activationAttempt: {
    // contract-negative: nested activation attempts no longer accept player.
    // @ts-expect-error
    player: null,
  },
};

const legacyContextPreparation: PreparedActivationInput = {
  activationContext: {
    // contract-negative: activationContext no longer merges selection channels.
    // @ts-expect-error
    selections: {},
  },
};

type ManifestKey = keyof typeof CHAIN_METHOD_MANIFEST;
type AttachedKey = keyof ChainAttachedMethods;
type AttachmentHostSurface = Pick<FullChainHost, ManifestKey>;
type AttachmentSignatureMismatch = {
  [Key in ManifestKey]: ChainAttachedMethods[Key] extends
    AttachmentHostSurface[Key]
    ? never
    : Key;
}[ManifestKey];
type AttachmentGroupId = (typeof CHAIN_ATTACHMENT_GROUPS)[number]["id"];

type ExactAttachmentKeys = Expect<Equal<ManifestKey, AttachedKey>>;
type ExactAttachmentSignatures = Expect<
  Equal<AttachmentSignatureMismatch, never>
>;
type ExactAttachmentGroups = Expect<
  Equal<
    AttachmentGroupId,
    | "link"
    | "usage"
    | "finalization"
    | "timing"
    | "segoc"
    | "spellSpeed"
    | "effectMatching"
    | "activationDiscovery"
    | "activation"
    | "responseWindow"
    | "botResponsePolicy"
    | "playerResponse"
    | "selection"
    | "stack"
    | "resolution"
  >
>;

const attachedMethods: ChainAttachedMethods = CHAIN_METHOD_MANIFEST;
const hostAttachmentSurface: AttachmentHostSurface = attachedMethods;
const attachmentName: keyof ChainAttachedMethods = "createChainLink";

// contract-negative: attachment names are an exact closed keyset.
// @ts-expect-error
const unknownAttachmentName: keyof ChainAttachedMethods = "legacyChainMethod";

// contract-negative: attachment consumers cannot depend on an unregistered method.
// @ts-expect-error
attachedMethods.legacyChainMethod();

void realRuntimePort;
void nullRuntimePort;
void fullHost;
void invalidNullFullHost;
void rawChainId;
void rawChainLinkId;
void unvalidatedChainId;
void unvalidatedChainLinkId;
void wrongLinkId;
void registeredContext;
void eventTimingContext;
void fastEffectOrigin;
void fastEffectState;
void segocGroup;
void eligibilityStatus;
void preparationStatus;
void resolutionStatus;
void finalizationStatus;
void spellSpeed;
void emptyContextInput;
void emptyFastEffectContext;
void unknownRegisteredContext;
void unknownFastEffectContext;
void unknownFastEffectOrigin;
void unknownFastEffectState;
void unknownSegocGroup;
void unknownEligibilityStatus;
void unknownPreparationStatus;
void unknownResolutionStatus;
void unknownFinalizationStatus;
void unknownSpellSpeed;
void legacyPlayerPreparation;
void legacyZonePreparation;
void legacyActivationTypePreparation;
void legacyNegatedPreparation;
void legacySelectionsPreparation;
void legacyUsagePreparation;
void legacyAttemptPreparation;
void legacyContextPreparation;
void hostAttachmentSurface;
void attachmentName;
void unknownAttachmentName;
void (null as ExactAttachmentKeys | null);
void (null as ExactAttachmentSignatures | null);
void (null as ExactAttachmentGroups | null);
