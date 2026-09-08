interface ResourceFlags {
  shouldPreserve?: boolean;
  bahamutReady?: boolean;
  critical?: boolean;
  needsRecovery?: boolean;
}

interface ResourceThresholds {
  preserveAt?: number;
  useful?: number;
  criticalAt?: number;
  critical?: number;
  recoveryStrandedMin?: number;
}

interface ResourceEconomyView {
  countsByZone?: Partial<Record<string, number>>;
  flags?: ResourceFlags;
  resourceName?: string;
  totalAccessibleResources?: number;
  totalStrandedResources?: number;
  totalAccessible?: number;
  totalStranded?: number;
  resourceEconomy?: ResourceEconomyView;
}

interface ResourceModePolicy {
  zone?: string;
  amount?: number;
  baseDelta?: number;
  usePressurePreserve?: boolean;
  preservePenalty?: number;
  penaltyPerResource?: number;
  penalizeWhenRecovering?: boolean;
  recoveryPenalty?: number;
  blockWhenPreserving?: boolean;
  recoveryBonus?: number;
  bonusWhenPreserving?: boolean;
  preserveBonus?: number;
}

interface ResourcePolicy {
  resourceName?: string;
  primaryZone?: string;
  thresholds?: ResourceThresholds;
  recoveryStrandedMin?: number;
  minAccessible?: number;
  defaultPreservePenalty?: number;
  penaltyPerResource?: number;
  recoverySpendPenalty?: number;
  spendModes?: Partial<Record<string, ResourceModePolicy>>;
  defaultRecoveryBonus?: number;
  recoveryPreserveBonus?: number;
  recoveryModes?: Partial<Record<string, ResourceModePolicy>>;
}

interface ResourcePressureContext {
  preserveForPayoff?: boolean;
  preserve?: boolean;
}

interface ResourceSpend {
  mode?: string;
  zone?: string;
  amount?: number;
  baseDelta?: number;
  preservePenalty?: number;
  penaltyPerResource?: number;
  blockWhenCritical?: boolean;
}

interface ResourceRecovery {
  mode?: string;
  baseDelta?: number;
  recoveryBonus?: number;
}

interface ResourceSpendInput {
  economy?: ResourceEconomyView;
  spend?: ResourceSpend;
  policy?: ResourcePolicy;
  context?: ResourcePressureContext;
}

interface ResourceRecoveryInput {
  economy?: ResourceEconomyView;
  recovery?: ResourceRecovery;
  policy?: ResourcePolicy;
  context?: ResourcePressureContext;
}

function getCountsByZone(
  economy: ResourceEconomyView = {},
): Partial<Record<string, number>> {
  return economy.countsByZone || economy.resourceEconomy?.countsByZone || {};
}

function getFlags(economy: ResourceEconomyView = {}): ResourceFlags {
  return economy.flags || economy.resourceEconomy?.flags || {};
}

function getResourceName(
  economy: ResourceEconomyView = {},
  policy: ResourcePolicy = {},
): string {
  return policy.resourceName || economy.resourceName || economy.resourceEconomy?.resourceName || "resource";
}

function getZoneCount(
  economy: ResourceEconomyView = {},
  zone = "graveyard",
): number {
  return Number(getCountsByZone(economy)[zone] || 0);
}

function getTotalAccessible(economy: ResourceEconomyView = {}): number {
  return Number(
    economy.totalAccessibleResources ??
      economy.resourceEconomy?.totalAccessibleResources ??
      economy.totalAccessible ??
      0,
  );
}

function getTotalStranded(economy: ResourceEconomyView = {}): number {
  return Number(
    economy.totalStrandedResources ??
      economy.resourceEconomy?.totalStrandedResources ??
      economy.totalStranded ??
      0,
  );
}

export function scoreResourcePressure(
  economy: ResourceEconomyView = {},
  policy: ResourcePolicy = {},
  context: ResourcePressureContext = {},
) {
  const primaryZone = policy.primaryZone || "graveyard";
  const zoneCount = getZoneCount(economy, primaryZone);
  const totalAccessible = getTotalAccessible(economy);
  const totalStranded = getTotalStranded(economy);
  const flags = getFlags(economy);
  const thresholds = policy.thresholds || {};
  const preserveAt = Number(thresholds.preserveAt ?? thresholds.useful ?? Infinity);
  const criticalAt = Number(thresholds.criticalAt ?? thresholds.critical ?? Infinity);
  const recoveryStrandedMin = Number(
    thresholds.recoveryStrandedMin ?? policy.recoveryStrandedMin ?? Infinity,
  );

  const preserveForPayoff = context.preserveForPayoff === true;
  const shouldPreserve =
    preserveForPayoff ||
    zoneCount >= preserveAt ||
    flags.shouldPreserve === true ||
    flags.bahamutReady === true;
  const isCritical = preserveForPayoff || zoneCount >= criticalAt || flags.critical === true;
  const shouldRecover =
    flags.needsRecovery === true ||
    totalStranded >= recoveryStrandedMin ||
    (policy.minAccessible != null && totalAccessible < policy.minAccessible);

  const reasons: string[] = [];
  if (preserveForPayoff) reasons.push("payoff");
  if (zoneCount >= criticalAt) reasons.push("critical_threshold");
  else if (zoneCount >= preserveAt) reasons.push("preserve_threshold");
  if (shouldRecover) reasons.push("recovery_needed");

  return {
    resourceName: getResourceName(economy, policy),
    primaryZone,
    zoneCount,
    totalAccessible,
    totalStranded,
    shouldPreserve,
    isCritical,
    shouldRecover,
    pressureScore:
      (shouldPreserve ? 1 : 0) +
      (isCritical ? 1 : 0) +
      (shouldRecover ? 0.5 : 0),
    reasons,
  };
}

export function assessResourceSpend({
  economy = {},
  spend = {},
  policy = {},
  context = {},
}: ResourceSpendInput = {}) {
  const mode = spend.mode || "cost";
  const modePolicy = policy.spendModes?.[mode] || {};
  const zone = spend.zone || modePolicy.zone || policy.primaryZone || "graveyard";
  const amount = Number(spend.amount ?? modePolicy.amount ?? 1);
  const zoneCount = getZoneCount(economy, zone);
  const pressure = scoreResourcePressure(economy, policy, context);
  const shouldPreserve =
    context.preserve === true ||
    context.preserveForPayoff === true ||
    (modePolicy.usePressurePreserve !== false && pressure.shouldPreserve);
  const insufficient = zoneCount < amount;

  let scoreDelta = Number(spend.baseDelta ?? modePolicy.baseDelta ?? 0);

  if (shouldPreserve) {
    const preservePenalty = Number(
      spend.preservePenalty ??
        modePolicy.preservePenalty ??
        policy.defaultPreservePenalty ??
        0,
    );
    const perResourcePenalty = Number(
      spend.penaltyPerResource ??
        modePolicy.penaltyPerResource ??
        policy.penaltyPerResource ??
        0,
    );
    scoreDelta -= preservePenalty + amount * perResourcePenalty;
  }

  if (pressure.shouldRecover && modePolicy.penalizeWhenRecovering !== false) {
    scoreDelta -= Number(modePolicy.recoveryPenalty ?? policy.recoverySpendPenalty ?? 0);
  }

  const allow =
    !insufficient &&
    !(modePolicy.blockWhenPreserving === true && shouldPreserve) &&
    !(spend.blockWhenCritical === true && pressure.isCritical);

  return {
    allow,
    scoreDelta,
    shouldPreserve,
    shouldRecover: pressure.shouldRecover,
    pressure,
    reason: insufficient
      ? "insufficient_resource"
      : shouldPreserve
        ? "preserve_resource"
        : "spend_allowed",
  };
}

export function assessResourceRecovery({
  economy = {},
  recovery = {},
  policy = {},
  context = {},
}: ResourceRecoveryInput = {}) {
  const pressure = scoreResourcePressure(economy, policy, context);
  const mode = recovery.mode || "recovery";
  const modePolicy = policy.recoveryModes?.[mode] || {};
  let scoreDelta = Number(recovery.baseDelta ?? modePolicy.baseDelta ?? 0);

  if (pressure.shouldRecover) {
    scoreDelta += Number(
      recovery.recoveryBonus ??
        modePolicy.recoveryBonus ??
        policy.defaultRecoveryBonus ??
        0,
    );
  }

  if (pressure.shouldPreserve && modePolicy.bonusWhenPreserving !== false) {
    scoreDelta += Number(modePolicy.preserveBonus ?? policy.recoveryPreserveBonus ?? 0);
  }

  return {
    scoreDelta,
    shouldRecover: pressure.shouldRecover,
    shouldPreserve: pressure.shouldPreserve,
    pressure,
    reason: pressure.shouldRecover ? "recovery_needed" : "recovery_optional",
  };
}
