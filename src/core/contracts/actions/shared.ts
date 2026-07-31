import type { BattlePositionInput, CardKind, MonsterType } from "../cards.js";
import type {
  CardFilter,
  EffectCondition,
  EffectTarget,
} from "../effects.js";
import type { CardAction } from "../actions.js";
import type { ZoneInput } from "../zones.js";

export type ActionPlayer = "self" | "opponent";
export type ActionPlayerScope = ActionPlayer | "both";
export type ActionOwner = ActionPlayerScope | "any" | "either";

export interface SelectionCount {
  readonly min?: number;
  readonly max?: number;
  readonly cap?: number;
  readonly maxFrom?: ContextNumberSource | string;
}

export interface ContextNumberSource {
  readonly key: string;
  readonly multiplier?: number;
  readonly divideBy?: number;
  readonly round?: "floor" | "ceil" | "round";
}

export interface ActionTargetScope {
  readonly owner?: ActionOwner;
  readonly player?: ActionPlayerScope;
  readonly zone?: ZoneInput;
  readonly zones?: readonly ZoneInput[];
  readonly filters?: CardFilter;
  readonly excludeSelf?: boolean;
  readonly requireFaceup?: boolean;
}

export interface ActionCase {
  readonly id?: string;
  readonly label?: string;
  readonly description?: string;
  readonly filters?: CardFilter;
  readonly conditions?: readonly EffectCondition[];
  readonly targets?: readonly EffectTarget[];
  readonly actions: readonly CardAction[];
}

export interface AddedCardMarker {
  readonly key: string;
  readonly duration?: string;
  readonly bindToSource?: boolean;
  readonly sourceEffectId?: string;
}

export interface ConditionalSummonMarker {
  readonly key: string;
  readonly min?: number;
  readonly bindToFieldPresence?: boolean;
  readonly costFilters?: CardFilter;
}

export interface SummonStatus {
  readonly status: string;
  readonly value?: boolean | number | string;
  readonly restoreOnFieldExit?: boolean;
}

export interface ActionReplacementEffect {
  readonly type: "destruction" | "negate_destruction" | "send_to_grave";
  readonly auto?: boolean;
  readonly reason?: string;
  readonly logMessage?: string;
  readonly targetOwner?: ActionOwner;
  readonly targetZones?: readonly ZoneInput[];
  readonly targetRequireFaceup?: boolean;
  readonly targetFilters?: CardFilter;
  readonly targetMustBeEquippedToSource?: boolean;
  readonly targetMustBeSource?: boolean;
  readonly targetMustNotBeSource?: boolean;
  readonly costFilters?: CardFilter;
  readonly costZone?: ZoneInput;
  readonly costOwner?: ActionOwner | "source";
  readonly costCount?: number;
  readonly costDestination?: ZoneInput;
  readonly prompt?: string;
  readonly selectionMessage?: string;
  readonly costActions?: readonly CardAction[];
}

export interface DestroyDamageEntry {
  readonly targetRef: string;
  readonly multiplier?: number;
  readonly damagePlayer?: ActionPlayer | "owner";
  readonly actions?: readonly CardAction[];
}

export interface EmbeddedMonsterDefinition {
  readonly type: string;
  readonly attribute?: string;
  readonly atk: number;
  readonly def: number;
  readonly level: number;
}

export interface TokenDefinition {
  readonly name: string;
  readonly description?: string;
  readonly image?: string;
  readonly archetype?: string;
  readonly type?: string;
  readonly attribute?: string;
  readonly atk: number;
  readonly def: number;
  readonly level?: number;
}

export interface TieredCostOption {
  readonly minCost?: number;
  readonly maxCost?: number;
  readonly atkBoost?: number;
  readonly costFilters?: CardFilter;
}

type StringActionProperty =
  | "affectedTargetRef"
  | "amountPrompt"
  | "applyMode"
  | "archetype"
  | "attributeSource"
  | "attributeSourceRef"
  | "bindEventTargetRef"
  | "buffSource"
  | "buffSourceName"
  | "buffTarget"
  | "buffType"
  | "cancelLabel"
  | "cardName"
  | "cardRef"
  | "cause"
  | "choiceImage"
  | "choiceTextKey"
  | "chooser"
  | "conditionType"
  | "confirmLabel"
  | "confirmationId"
  | "contextKey"
  | "contextLabel"
  | "costTargetRef"
  | "counterSourceRef"
  | "counterType"
  | "declaredValueRef"
  | "declaredValueStateKey"
  | "deferFinalizationUntil"
  | "deferUntil"
  | "destroyTargetRef"
  | "effectChoiceKey"
  | "effectId"
  | "effectType"
  | "equippedCard"
  | "event"
  | "excludeCardName"
  | "excludeName"
  | "excludeNameRef"
  | "excludeTargetRef"
  | "firstTargetRef"
  | "gainTargetRef"
  | "logMessage"
  | "matchLevelRef"
  | "matchMode"
  | "modalInfoText"
  | "modalTitle"
  | "nameSource"
  | "oncePerTurnName"
  | "opponentTargetRef"
  | "phase"
  | "promptMessage"
  | "promptMessageKey"
  | "promptTitle"
  | "promptTitleKey"
  | "property"
  | "protectionType"
  | "reason"
  | "requirementId"
  | "resultKey"
  | "resultRef"
  | "returnPhase"
  | "reviveContextLabel"
  | "secondTargetRef"
  | "selectionId"
  | "selectionKind"
  | "selectionLabel"
  | "selectionMessage"
  | "selectionMessageKey"
  | "sourceName"
  | "sourceRef"
  | "stateKey"
  | "status"
  | "storeAs"
  | "storeLevelSumAs"
  | "storeNegatedCardAs"
  | "storeResultAs"
  | "summonMethod"
  | "summonPlayer"
  | "summonProcedure"
  | "synchroSummonContextId"
  | "targetARef"
  | "targetBRef"
  | "targetRef"
  | "targetRestriction"
  | "timing"
  | "typeName"
  | "uniqueKey";

type NumberActionProperty =
  | "amount"
  | "amountPerCard"
  | "amountPerCounter"
  | "amountPerMonster"
  | "atk"
  | "atkBonus"
  | "atkBoost"
  | "atkBoostAfterSummon"
  | "atkBoostPerCounter"
  | "atkChange"
  | "atkDifferenceMax"
  | "atkFactor"
  | "atkPerCounter"
  | "atkPerDestroyed"
  | "baseAtk"
  | "baseDef"
  | "buffMultiplier"
  | "buffValue"
  | "cardId"
  | "counterMultiplier"
  | "damagePerCard"
  | "damagePerCounter"
  | "def"
  | "defBonus"
  | "defBoost"
  | "defBoostAfterSummon"
  | "defBoostPerCounter"
  | "defChange"
  | "defFactor"
  | "defPerCounter"
  | "defaultAmount"
  | "delayTurns"
  | "drawAmount"
  | "drawPerDestroyed"
  | "durationTurns"
  | "expiresOnTurn"
  | "extraAttacks"
  | "fieldSlotsFreedBeforeSummon"
  | "fraction"
  | "keepPerSide"
  | "lpCost"
  | "maxAmount"
  | "maxAtk"
  | "maxCost"
  | "maxDef"
  | "maxDifference"
  | "maxLevel"
  | "maxTargets"
  | "minAmount"
  | "minAtk"
  | "minAttacks"
  | "minCost"
  | "minCounters"
  | "minDef"
  | "minLevel"
  | "minTargets"
  | "multiplier"
  | "priority"
  | "tier1AtkBoost"
  | "turns"
  | "uses";

type BooleanActionProperty =
  | "allowCancel"
  | "allowEmpty"
  | "allowExtraDeckMonsterToHand"
  | "allowTieBreak"
  | "applyToAllField"
  | "banishCost"
  | "battleIndestructible"
  | "bounceSource"
  | "cannotAttackThisTurn"
  | "confirmOnly"
  | "costMovedByEffect"
  | "cumulative"
  | "destroyIfAtkZeroedByThisEffect"
  | "destroyIfDefZeroedByThisEffect"
  | "destroySummonedAtEndPhase"
  | "distinctNames"
  | "filterAvailableCases"
  | "grantCrescentShieldGuard"
  | "haltOnFailure"
  | "isFacedown"
  | "isToken"
  | "isTuner"
  | "lockBattlePosition"
  | "log"
  | "logIfSkipped"
  | "markChanged"
  | "negateEffects"
  | "optional"
  | "permanent"
  | "preservePosition"
  | "promptPlayer"
  | "promptUser"
  | "remove"
  | "removeFromAllField"
  | "removeOnLeave"
  | "requireBoundTargetLeavesField"
  | "requireConfirmation"
  | "requireFaceup"
  | "requireSource"
  | "resetAttackFlags"
  | "restrictAttackThisTurn"
  | "sendSourceToGraveAfter"
  | "setAtkToZero"
  | "setAtkToZeroAfterSummon"
  | "setDefToZero"
  | "setDefToZeroAfterSummon"
  | "skipSendToGraveActionReplacement"
  | "skipSendToGraveReplacement"
  | "stopOnFailure"
  | "unlimitedUses"
  | "untilEndOfTurn"
  | "updateCurrentStats"
  | "useBaseAtk"
  | "usesPerTarget"
  | "variableAmount";

type StringActionProperties = {
  readonly [Key in StringActionProperty]: string;
};

type NumberActionProperties = {
  readonly [Key in NumberActionProperty]: number;
};

type BooleanActionProperties = {
  readonly [Key in BooleanActionProperty]: boolean;
};

export interface ComplexActionProperties {
  readonly actions: readonly CardAction[];
  readonly defaultActions: readonly CardAction[];
  readonly targets: readonly EffectTarget[];
  readonly conditions: readonly EffectCondition[];
  readonly condition: EffectCondition;
  readonly summonCondition: EffectCondition | { readonly type: "empty_field" };
  readonly cases: readonly ActionCase[];
  readonly filters: CardFilter;
  readonly candidateFilters: CardFilter;
  readonly allowedFilters: CardFilter;
  readonly restrictedCardFilters: CardFilter;
  readonly costFilters: CardFilter;
  readonly targetScope: ActionTargetScope;
  readonly amountFromContext: ContextNumberSource;
  readonly amountFromFieldCount: ActionTargetScope & {
    readonly baseAmount?: number;
  };
  readonly atkBoostFromContext: ContextNumberSource;
  readonly defBoostFromContext: ContextNumberSource;
  readonly atkFromContext: ContextNumberSource;
  readonly defFromContext: ContextNumberSource;
  readonly maxLevelFromContext: ContextNumberSource;
  readonly targetCountFromContext: ContextNumberSource;
  readonly atkBoostFromTarget: {
    readonly targetRef: string;
    readonly stat:
      | "atk"
      | "def"
      | "baseAtk"
      | "baseDef"
      | "level"
      | "originalLevel";
    readonly multiplier?: number;
  };
  readonly count: number | SelectionCount;
  readonly zone: ZoneInput | readonly ZoneInput[];
  readonly zones: readonly ZoneInput[];
  readonly sourceZone: ZoneInput;
  readonly fromZone: ZoneInput;
  readonly to: ZoneInput;
  readonly costDestination: ZoneInput;
  readonly failureZone: ZoneInput;
  readonly position: BattlePositionInput;
  readonly player: ActionPlayerScope;
  readonly owner: ActionOwner;
  readonly sourceOwner: ActionOwner;
  readonly summonToOwner: ActionPlayer;
  readonly triggerPlayer: ActionPlayer | "current";
  readonly drawPlayer: ActionPlayer;
  readonly scope: ActionPlayerScope;
  readonly cardKind: CardKind | readonly CardKind[];
  readonly monsterType: MonsterType | readonly MonsterType[];
  readonly subtype: string | readonly string[];
  readonly choices: string | readonly string[];
  readonly value: boolean | number | string;
  readonly cardIds: readonly number[];
  readonly cardNames: readonly string[];
  readonly blockedNames: readonly string[];
  readonly names: readonly string[];
  readonly excludeCardNames: readonly string[];
  readonly excludeTargetRefs: readonly string[];
  readonly excludeSummonRestrict: readonly string[];
  readonly allowedAttributes: readonly string[];
  readonly attributes: readonly string[];
  readonly stats: readonly ("atk" | "def" | "baseAtk" | "baseDef")[];
  readonly treatedAsCardKinds: CardKind | readonly CardKind[];
  readonly conditionalMarkersOnSummon: readonly ConditionalSummonMarker[];
  readonly statusesOnSummon: readonly SummonStatus[];
  readonly markAddedCards: AddedCardMarker;
  readonly replacementEffect: ActionReplacementEffect;
  readonly entries: readonly DestroyDamageEntry[];
  readonly skipDamageIf: {
    readonly self?: boolean | readonly EffectCondition[];
  };
  readonly allowExtraDeckMonsterToHandIf: EffectCondition;
  readonly previewPendingSummon: {
    readonly zone?: ZoneInput;
    readonly filters?: CardFilter;
  };
  readonly monster: EmbeddedMonsterDefinition;
  readonly token: TokenDefinition;
  readonly tierOptions: readonly TieredCostOption[];
  readonly duration: string;
  readonly negateEffectsDuration: string;
  readonly effectChoiceKey: string;
  readonly triggerRequirement: "mandatory" | "optional";
  readonly triggerTiming: "if" | "when";
}

export type ActionProperties = StringActionProperties &
  NumberActionProperties &
  BooleanActionProperties &
  ComplexActionProperties;

export type DefineAction<
  Type extends string,
  Required extends keyof ActionProperties = never,
  Optional extends keyof ActionProperties = never,
> = Readonly<
  { type: Type } & Pick<ActionProperties, Required> &
    Partial<Pick<ActionProperties, Optional>>
>;
