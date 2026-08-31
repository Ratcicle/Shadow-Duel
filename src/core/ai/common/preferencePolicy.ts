import type { AIActivationContext } from "../../contracts/ai.js";
import type { CanonicalZone } from "../../contracts/zones.js";

interface NamedPreferenceCard {
  readonly name?: string | null;
}

export interface CostPreferences {
  archetype: string | null;
  preferNames: string[];
  preserveNames: string[];
  offensivePayoffNames: string[];
  preserveLastOffensivePayoff: boolean;
  availableOffensivePayoffs: number;
  forceNames?: string[];
}

export interface BuildCostPreferencesOptions<Extra extends object = object> {
  archetype?: string | null;
  hand?: readonly NamedPreferenceCard[] | null;
  field?: readonly NamedPreferenceCard[] | null;
  protectedNames?: readonly string[];
  preferNames?: readonly string[] | null;
  preserveNames?: readonly string[] | null;
  forceNames?: readonly string[] | null;
  offensivePayoffNames?: readonly string[] | null;
  preserveLastOffensivePayoff?: boolean;
  availableOffensivePayoffs?: number;
  extra?: Extra | null;
}

export function buildCostPreferences<Extra extends object = object>({
  archetype = null,
  hand = [],
  field = [],
  protectedNames = [],
  preferNames = [],
  preserveNames = [],
  forceNames = [],
  offensivePayoffNames = [],
  preserveLastOffensivePayoff = true,
  availableOffensivePayoffs,
  extra = {} as Extra,
}: BuildCostPreferencesOptions<Extra> = {}): CostPreferences & Extra {
  const preferSet = new Set(preferNames || []);
  const preserveSet = new Set(preserveNames || []);

  for (const card of [...(hand || []), ...(field || [])]) {
    if (card?.name && protectedNames.includes(card.name)) {
      preserveSet.add(card.name);
    }
  }

  const payoffNames = [...(offensivePayoffNames || [])];
  const computedPayoffs = [...(hand || []), ...(field || [])].filter((card) =>
    payoffNames.includes(card?.name as string),
  ).length;

  const result = {
    archetype,
    preferNames: [...preferSet],
    preserveNames: [...preserveSet],
    offensivePayoffNames: payoffNames,
    preserveLastOffensivePayoff,
    availableOffensivePayoffs: Number.isFinite(
      availableOffensivePayoffs as number,
    )
      ? (availableOffensivePayoffs as number)
      : computedPayoffs,
    ...extra,
  } as CostPreferences & Extra;

  if (Array.isArray(forceNames) && forceNames.length > 0) {
    result.forceNames = [...forceNames];
  }

  return result;
}

type TargetProfileFactory<CostPreferencesType> = (
  costPreferences: CostPreferencesType | null,
) => unknown;

type ResolvedTargetProfile<Profile> = Profile extends TargetProfileFactory<
  infer _CostPreferencesType
>
  ? Exclude<ReturnType<Profile>, false | null | undefined>
  : Exclude<Profile, false | null | undefined>;

export type ResolvedTargetPreferences<TargetProfiles extends object> = Partial<{
  [Key in keyof TargetProfiles]: ResolvedTargetProfile<TargetProfiles[Key]>;
}>;

type ResolvedTargetPreferenceValue<TargetProfiles extends object> =
  ResolvedTargetPreferences<TargetProfiles>[keyof TargetProfiles];

export interface BuildTargetPreferencesOptions<
  CostPreferencesType,
  TargetProfiles extends object,
> {
  costPreferences?: CostPreferencesType | null;
  targetProfiles?: TargetProfiles | null;
}

export function buildTargetPreferences<
  CostPreferencesType = unknown,
  TargetProfiles extends object = object,
>(
  {
    costPreferences = null,
    targetProfiles = {} as TargetProfiles,
  }: BuildTargetPreferencesOptions<CostPreferencesType, TargetProfiles> = {},
): ResolvedTargetPreferences<TargetProfiles> {
  const preferences: ResolvedTargetPreferences<TargetProfiles> = {};
  for (const [key, profile] of Object.entries(targetProfiles || {})) {
    const resolved =
      typeof profile === "function" ? profile(costPreferences) : profile;
    if (resolved)
      preferences[key as keyof TargetProfiles] =
        resolved as ResolvedTargetPreferenceValue<TargetProfiles>;
  }
  return preferences;
}

interface ActivationPreferenceContext {
  costPreferences?: unknown;
  targetPreferences?: unknown;
  specialSummonPositions?: unknown;
  fusionPositions?: unknown;
  fusionPreferences?: unknown;
}

export interface BuildAutoActivationContextOptions<
  Extra extends object = object,
> {
  zone?: CanonicalZone | null;
  fromHand?: boolean;
  sourceZone?: CanonicalZone | null;
  activationZone?: CanonicalZone | null;
  autoSelectTargets?: boolean;
  autoSelectSingleTarget?: boolean;
  includeAutoSelectTargets?: boolean;
  includeActionContext?: boolean;
  logTargets?: boolean;
  actionContext?: object | null;
  costPreferences?: unknown;
  targetPreferences?: unknown;
  specialSummonPositions?: unknown;
  fusionPositions?: unknown;
  fusionPreferences?: unknown;
  extra?: Extra | null;
}

export function buildAutoActivationContext<Extra extends object = object>({
  zone = null,
  fromHand = false,
  sourceZone = zone,
  activationZone = zone,
  autoSelectTargets = true,
  autoSelectSingleTarget = true,
  includeAutoSelectTargets = true,
  includeActionContext = true,
  logTargets = false,
  actionContext = {},
  costPreferences = null,
  targetPreferences = null,
  specialSummonPositions = null,
  fusionPositions = null,
  fusionPreferences = null,
  extra = {} as Extra,
}: BuildAutoActivationContextOptions<Extra> = {}): AIActivationContext & Extra {
  const mergedActionContext: ActivationPreferenceContext = {
    ...(actionContext || {}),
  };

  if (costPreferences) mergedActionContext.costPreferences = costPreferences;
  if (targetPreferences) mergedActionContext.targetPreferences = targetPreferences;
  if (specialSummonPositions) {
    mergedActionContext.specialSummonPositions = specialSummonPositions;
  }
  if (fusionPositions) mergedActionContext.fusionPositions = fusionPositions;
  if (fusionPreferences) mergedActionContext.fusionPreferences = fusionPreferences;

  const result = {
    fromHand,
    activationZone,
    sourceZone,
    autoSelectSingleTarget,
    logTargets,
    ...extra,
  } as AIActivationContext & Extra;

  if (includeAutoSelectTargets) {
    result.autoSelectTargets = autoSelectTargets;
  }

  if (includeActionContext) {
    result.actionContext = mergedActionContext;
  }

  return result;
}

type ActivationContextWithObject = AIActivationContext & {
  actionContext?: object | null;
};

export function mergeActivationActionContext(
  baseContext: ActivationContextWithObject | null = {},
  patch: object | null = {},
): AIActivationContext & { actionContext: object } {
  return {
    ...(baseContext || {}),
    actionContext: {
      ...(baseContext?.actionContext || {}),
      ...(patch || {}),
    },
  };
}

export interface BuildActivationContextOptions
  extends Omit<AIActivationContext, "actionContext" | "targetPreferences"> {
  costPreferences?: unknown;
  targetPreferences?: unknown;
  specialSummonPositions?: unknown;
  fusionPositions?: unknown;
  fusionPreferences?: unknown;
  autoSelectTargets?: boolean;
  autoSelectSingleTarget?: boolean;
  includeAutoSelectTargets?: boolean;
  actionContext?: object | null;
}

export function buildActivationContext({
  costPreferences,
  targetPreferences = {},
  specialSummonPositions = null,
  fusionPositions = null,
  fusionPreferences = null,
  autoSelectTargets = true,
  autoSelectSingleTarget = true,
  includeAutoSelectTargets = true,
  actionContext = {},
  ...rest
}: BuildActivationContextOptions = {}): AIActivationContext {
  const mergedActionContext: ActivationPreferenceContext = {
    ...actionContext,
    costPreferences,
    targetPreferences,
  };

  if (specialSummonPositions) {
    mergedActionContext.specialSummonPositions = specialSummonPositions;
  }
  if (fusionPositions) mergedActionContext.fusionPositions = fusionPositions;
  if (fusionPreferences) mergedActionContext.fusionPreferences = fusionPreferences;

  const result: AIActivationContext = {
    autoSelectSingleTarget,
    ...rest,
    actionContext: mergedActionContext,
  };

  if (includeAutoSelectTargets) {
    result.autoSelectTargets = autoSelectTargets;
  }

  return result;
}
