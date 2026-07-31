import type {
  BattlePosition,
  BattlePositionInput,
  CardInstance,
  CardKind,
  MonsterType,
  RawCardDefinition,
  ValidatedCardDefinition,
} from "../../src/core/contracts/cards.js";
import type {
  ChainActivationKind,
  ChainEffectKind,
  ChainResponseContextType,
} from "../../src/core/contracts/chain.js";
import type {
  DamageStepTiming,
  DuelEventName,
  EffectTiming,
  TriggerRequirement,
  TriggerTiming,
  UsagePolicy,
} from "../../src/core/contracts/effects.js";
import type {
  CardDefinitionId,
  ChainId,
  ChainLinkId,
  ControllerType,
  DamageStepId,
  DecisionId,
  DuelCardId,
  PlayerId,
  RawCardDefinitionId,
  SelectionCandidateKey,
  SummonId,
} from "../../src/core/contracts/primitives.js";
import type {
  SummonMethod,
  SummonOrigin,
} from "../../src/core/contracts/summon.js";
import type {
  CanonicalZone,
  ZoneInput,
} from "../../src/core/contracts/zones.js";

declare const cardDefinitionId: CardDefinitionId;
declare const duelCardId: DuelCardId;
declare const chainId: ChainId;
declare const chainLinkId: ChainLinkId;
declare const summonId: SummonId;
declare const damageStepId: DamageStepId;
declare const decisionId: DecisionId;
declare const selectionCandidateKey: SelectionCandidateKey;

const rawCardDefinitionId: RawCardDefinitionId = 12;
const playerId: PlayerId = "player";
const controllerType: ControllerType = "ai";

// contract-negative: raw definition ids must be validated before becoming branded ids
// @ts-expect-error
const brandedDefinitionFromRaw: CardDefinitionId = rawCardDefinitionId;

// contract-negative: deterministic duel card ids are not card definition ids
// @ts-expect-error
const definitionFromDuelCard: CardDefinitionId = duelCardId;

// contract-negative: chain ids are not deterministic duel card ids
// @ts-expect-error
const duelCardFromChain: DuelCardId = chainId;

// contract-negative: chain link ids are not chain ids
// @ts-expect-error
const chainFromLink: ChainId = chainLinkId;

// contract-negative: summon ids are not chain link ids
// @ts-expect-error
const linkFromSummon: ChainLinkId = summonId;

// contract-negative: damage step ids are not summon ids
// @ts-expect-error
const summonFromDamageStep: SummonId = damageStepId;

// contract-negative: decision ids are not damage step ids
// @ts-expect-error
const damageStepFromDecision: DamageStepId = decisionId;

// contract-negative: selection candidate keys are not decision ids
// @ts-expect-error
const decisionFromCandidate: DecisionId = selectionCandidateKey;

// contract-negative: unvalidated strings are not selection candidate keys
// @ts-expect-error
const candidateFromString: SelectionCandidateKey = "candidate";

// contract-negative: unvalidated numbers are not selection candidate keys
// @ts-expect-error
const candidateFromNumber: SelectionCandidateKey = 1;

// contract-negative: player ids form a closed union
// @ts-expect-error
const unknownPlayerId: PlayerId = "opponent";

// contract-negative: controller types form a closed union
// @ts-expect-error
const unknownControllerType: ControllerType = "bot";

const canonicalZone: CanonicalZone = "banished";
const legacyZoneInput: ZoneInput = "banish";

// contract-negative: the legacy alias is accepted only at input boundaries
// @ts-expect-error
const canonicalLegacyAlias: CanonicalZone = "banish";

// contract-negative: zones form a closed union
// @ts-expect-error
const unknownZone: ZoneInput = "void";

const battlePosition: BattlePosition = "defense";
const battlePositionInput: BattlePositionInput = "choice";

// contract-negative: choice is an input sentinel and never persisted state
// @ts-expect-error
const choiceAsBattleState: BattlePosition = "choice";

// contract-negative: battle position inputs form a closed union
// @ts-expect-error
const unknownBattlePosition: BattlePositionInput = "faceup";

const cardKind: CardKind = "monster";
const monsterType: MonsterType = "synchro";
const summonMethod: SummonMethod = "ascension";
const summonOrigin: SummonOrigin = "effect_resolution";
const effectTiming: EffectTiming = "on_event";
const duelEventName: DuelEventName = "after_summon";
const usagePolicy: UsagePolicy = "activate";
const triggerRequirement: TriggerRequirement = "mandatory";
const triggerTiming: TriggerTiming = "when";
const damageStepTiming: DamageStepTiming = "damage_calculation";
const activationKind: ChainActivationKind = "monster_effect_activation";
const effectKind: ChainEffectKind = "trigger_effect";
const responseContext: ChainResponseContextType = "effect_activation";

// contract-negative: card kinds form a closed union
// @ts-expect-error
const unknownCardKind: CardKind = "skill";

// contract-negative: normal monsters omit monsterType instead of using normal
// @ts-expect-error
const normalMonsterType: MonsterType = "normal";

// contract-negative: summon methods form a closed union
// @ts-expect-error
const unknownSummonMethod: SummonMethod = "ritual";

// contract-negative: summon origins form a closed union
// @ts-expect-error
const unknownSummonOrigin: SummonOrigin = "effect";

// contract-negative: effect timings form a closed union
// @ts-expect-error
const unknownEffectTiming: EffectTiming = "on_draw";

// contract-negative: duel trigger events are limited to validator events
// @ts-expect-error
const unknownDuelEvent: DuelEventName = "duel_started";

// contract-negative: usage policies form a closed union
// @ts-expect-error
const unknownUsagePolicy: UsagePolicy = "resolve";

// contract-negative: trigger requirements form a closed union
// @ts-expect-error
const unknownTriggerRequirement: TriggerRequirement = "forced";

// contract-negative: trigger timings form a closed union
// @ts-expect-error
const unknownTriggerTiming: TriggerTiming = "after";

// contract-negative: damage step timings form a closed union
// @ts-expect-error
const unknownDamageStepTiming: DamageStepTiming = "during_damage_step";

// contract-negative: chain activation kinds form a closed union
// @ts-expect-error
const unknownActivationKind: ChainActivationKind = "spell_activation";

// contract-negative: chain effect kinds form a closed union
// @ts-expect-error
const unknownEffectKind: ChainEffectKind = "continuous_effect";

// contract-negative: chain response contexts form a closed union
// @ts-expect-error
const unknownResponseContext: ChainResponseContextType = "summon";

const rawDefinition: RawCardDefinition = {
  id: rawCardDefinitionId,
  name: "Raw",
  cardKind: "monster",
  image: "assets/raw.png",
  description: "Unvalidated definition",
};

const validatedDefinition: ValidatedCardDefinition = {
  ...rawDefinition,
  id: cardDefinitionId,
};

const rawProjectionFromValidated: RawCardDefinition = validatedDefinition;

const cardInstance: CardInstance = {
  instanceId: 1,
  duelCardId,
  id: cardDefinitionId,
  name: "Instance",
  cardKind: "monster",
  monsterType: "fusion",
  owner: "player",
  originalOwner: "player",
  controller: "player",
  position: "attack",
  isFacedown: false,
  locationVersion: 0,
};

// contract-negative: raw definitions require validation before assignment
// @ts-expect-error
const validatedFromRaw: ValidatedCardDefinition = rawDefinition;

// contract-negative: runtime instances are not raw database definitions
// @ts-expect-error
const rawFromInstance: RawCardDefinition = cardInstance;

// contract-negative: database definitions are not runtime card instances
// @ts-expect-error
const instanceFromValidated: CardInstance = validatedDefinition;

void canonicalZone;
void playerId;
void controllerType;
void legacyZoneInput;
void battlePosition;
void battlePositionInput;
void cardKind;
void monsterType;
void summonMethod;
void summonOrigin;
void effectTiming;
void duelEventName;
void usagePolicy;
void triggerRequirement;
void triggerTiming;
void damageStepTiming;
void activationKind;
void effectKind;
void responseContext;
void rawProjectionFromValidated;
void brandedDefinitionFromRaw;
void definitionFromDuelCard;
void duelCardFromChain;
void chainFromLink;
void linkFromSummon;
void summonFromDamageStep;
void damageStepFromDecision;
void decisionFromCandidate;
void candidateFromString;
void candidateFromNumber;
void unknownPlayerId;
void unknownControllerType;
void canonicalLegacyAlias;
void unknownZone;
void choiceAsBattleState;
void unknownBattlePosition;
void unknownCardKind;
void normalMonsterType;
void unknownSummonMethod;
void unknownSummonOrigin;
void unknownEffectTiming;
void unknownDuelEvent;
void unknownUsagePolicy;
void unknownTriggerRequirement;
void unknownTriggerTiming;
void unknownDamageStepTiming;
void unknownActivationKind;
void unknownEffectKind;
void unknownResponseContext;
void validatedFromRaw;
void rawFromInstance;
void instanceFromValidated;
