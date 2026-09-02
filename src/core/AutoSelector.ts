import {
  estimateCardValue,
  estimateTemporaryCombatDebuffTargetValue,
  estimateMonsterValue,
  estimateOffensiveTemporaryBuffValue,
} from "./ai/StrategyUtils.js";
import { getEffectiveAtk, getEffectiveDef } from "./ai/common/cardStats.js";
import type {
  ActionRuntimeCard,
  ActionRuntimePlayer,
} from "./contracts/actionRuntime.js";
import type {
  NormalizedSelectionContract,
  RawSelectionCandidate,
  RawSelectionContract,
  RawSelectionRequirement,
  SelectionCandidate,
  SelectionIntent,
  SelectionRequirement,
  SelectionResult,
  SelectionStrategy,
} from "./contracts/selection.js";
import type { SelectionCandidateKey } from "./contracts/primitives.js";

interface AutoSelectorCard extends ActionRuntimeCard {
  fieldPresenceId?: string | number | null;
  goodDiscard?: boolean;
  cannotBeNormalSummonedOrSet?: boolean;
  usedEffectThisTurn?: boolean;
  mustBeAttacked?: boolean;
  piercing?: boolean;
}

interface AutoSelectorScorableCard {
  id?: string | number;
  instanceId?: string | number;
  fieldPresenceId?: string | number | null;
  name?: string;
  cardKind?: string;
  atk?: number | null;
  def?: number | null;
  level?: number | null;
  position?: string | null;
  archetype?: string | null;
  archetypes?: string[];
  goodDiscard?: boolean;
  cannotBeNormalSummonedOrSet?: boolean;
  usedEffectThisTurn?: boolean;
  hasAttacked?: boolean;
  mustBeAttacked?: boolean;
  cannotAttackThisTurn?: boolean;
  tempAtkBoost?: number;
  equipAtkBonus?: number;
  tempDefBoost?: number;
  equipDefBonus?: number;
  piercing?: boolean;
  isFacedown?: boolean;
}

interface AutoSelectorPlayer extends ActionRuntimePlayer {
  field: AutoSelectorCard[];
  hand: AutoSelectorCard[];
  deck: AutoSelectorCard[];
}

interface AutoSelectorGamePort {
  player?: AutoSelectorPlayer | null;
  bot?: AutoSelectorPlayer | null;
  getOpponent?(player: AutoSelectorPlayer): AutoSelectorPlayer | null;
}

type AutoSelectionCandidate = (RawSelectionCandidate | SelectionCandidate) & {
  cardRef?: AutoSelectorCard | null;
  card?: AutoSelectorCard | null;
  instanceId?: string | number;
  fieldPresenceId?: string | number | null;
  archetype?: string | null;
  archetypes?: string[];
  goodDiscard?: boolean;
  cannotBeNormalSummonedOrSet?: boolean;
  usedEffectThisTurn?: boolean;
  hasAttacked?: boolean;
  mustBeAttacked?: boolean;
  tempAtkBoost?: number;
  equipAtkBonus?: number;
  tempDefBoost?: number;
  equipDefBonus?: number;
};

interface AutoSelectionFilters {
  strategy?: SelectionStrategy;
  intent?: SelectionIntent;
}

type AutoSelectionRequirement = (
  | RawSelectionRequirement
  | SelectionRequirement
) & {
  filters?: (RawSelectionRequirement["filters"] & AutoSelectionFilters) | null;
  strategy?: SelectionStrategy;
  intent?: SelectionIntent;
  candidates?: AutoSelectionCandidate[];
};

type AutoSelectionContract = (
  | RawSelectionContract
  | NormalizedSelectionContract
) & {
  requirements?: AutoSelectionRequirement | AutoSelectionRequirement[];
};

type AutoSelectorRole =
  | "cost"
  | "removal"
  | "named_preference"
  | "temporary_stat_debuff"
  | "recursion"
  | "temporary_stat_buff"
  | "stance_dance_buff";

interface AutoSelectorPreference {
  intent?: SelectionIntent;
  role?: AutoSelectorRole;
  purpose?: string;
  preferredNames?: string[];
  avoidNames?: string[];
  defensiveNames?: string[];
  offensiveNames?: string[];
  preferredInstanceIds?: Array<string | number>;
  avoidInstanceIds?: Array<string | number>;
  preferNames?: string[];
  forceNames?: string[];
  preserveNames?: string[];
  attackers?: AutoSelectorCard[];
  opponentLp?: number;
  atkReduction?: number;
  defReduction?: number;
  destroyIfAtkZeroedByThisEffect?: boolean;
  destroyIfDefZeroedByThisEffect?: boolean;
  atkBoost?: number;
  sourceCardId?: string | number | null;
  preferredName?: string;
  archetype?: string;
  availableOffensivePayoffs?: number;
  preserveLastOffensivePayoff?: boolean;
  offensivePayoffNames?: string[];
  stableDefense?: boolean;
}

interface AutoSelectorActionContext {
  targetPreferences?: {
    [requirementId: string]: AutoSelectorPreference | undefined;
  };
  targetPreference?: AutoSelectorPreference | null;
  costPreferences?: AutoSelectorPreference | null;
}

interface AutoSelectorActivationContext {
  actionContext?: AutoSelectorActionContext | null;
  costPreferences?: AutoSelectorPreference | null;
}

interface AutoSelectorContext {
  selectionContract?: AutoSelectionContract | null;
  requirement?: AutoSelectionRequirement | null;
  owner?: AutoSelectorPlayer | null;
  player?: AutoSelectorPlayer | null;
  activationContext?: AutoSelectorActivationContext | null;
}

interface AutoSelectorLimits {
  min: number;
  max: number;
}

interface TriggerOrderCandidate {
  collectorOrder?: number;
  occurrenceId?: number;
  sourceOrder?: number;
  effectOrder?: number;
  candidateId?: number;
}

export type AutoSelectionResult =
  | { ok: false; reason: string }
  | { ok: true; selections: SelectionResult };

function hasCanonicalCandidateKey(
  candidate: AutoSelectionCandidate,
): candidate is AutoSelectionCandidate & { key: SelectionCandidateKey } {
  return typeof candidate.key === "string" && candidate.key.length > 0;
}

function isAutoSelectionRequirementArray(
  value: AutoSelectionContract["requirements"],
): value is AutoSelectionRequirement[] {
  return Array.isArray(value);
}

function scoreTemporaryCombatDebuff(
  card: AutoSelectorScorableCard,
  options: {
    attackers: AutoSelectorCard[];
    opponentLp: number;
    atkReduction?: number;
    defReduction?: number;
    destroyIfAtkZeroedByThisEffect?: boolean;
    destroyIfDefZeroedByThisEffect?: boolean;
  },
): number {
  const result: unknown = Reflect.apply(
    estimateTemporaryCombatDebuffTargetValue,
    undefined,
    [card, options],
  );
  return typeof result === "number" ? result : 0;
}

function scoreOffensiveTemporaryBuff(
  card: AutoSelectorScorableCard,
  options: {
    atkBoost: number;
    opponentField: AutoSelectorCard[];
    opponentLp: number;
  },
): number {
  const result: unknown = Reflect.apply(
    estimateOffensiveTemporaryBuffValue,
    undefined,
    [card, options],
  );
  return typeof result === "number" ? result : 0;
}

export default class AutoSelector {
  readonly game: AutoSelectorGamePort;

  constructor(game: AutoSelectorGamePort) {
    this.game = game;
  }

  select(
    selectionContract: AutoSelectionContract | null | undefined,
    context: AutoSelectorContext = {},
  ): AutoSelectionResult {
    if (
      !selectionContract ||
      !isAutoSelectionRequirementArray(selectionContract.requirements) ||
      selectionContract.requirements.length === 0
    ) {
      return { ok: false, reason: "Selection contract is missing requirements." };
    }

    const selections: SelectionResult = {};
    const contextWithContract: AutoSelectorContext = {
      ...context,
      selectionContract,
    };

    for (const requirement of selectionContract.requirements) {
      const candidates = Array.isArray(requirement.candidates)
        ? requirement.candidates
        : [];
      const min = Number(requirement.min ?? 0);
      const max = Number(requirement.max ?? min);
      if (candidates.length < min) {
        return {
          ok: false,
          reason: `Not enough candidates for ${requirement.id}.`,
        };
      }

      const ordered = this.orderCandidates(
        requirement,
        candidates,
        contextWithContract
      );
      const desiredCount = this.getDesiredCount(
        requirement,
        ordered,
        { min, max },
        contextWithContract
      );
      const chosen = ordered.slice(0, desiredCount);
      selections[requirement.id ?? "undefined"] = chosen
        .filter(hasCanonicalCandidateKey)
        .map((candidate) => candidate.key);
    }

    return { ok: true, selections };
  }

  /**
   * Legal, deterministic SEGOC policy for AI-controlled players.
   * All eligible optional Trigger Effects are accepted; strategy scoring is
   * deliberately outside Phase 3.
   */
  orderTriggerCandidates<Candidate extends TriggerOrderCandidate>(
    candidates: Candidate[] = [],
  ): Candidate[] {
    return candidates.slice().sort(
      (a, b) =>
        Number(a?.collectorOrder || 0) - Number(b?.collectorOrder || 0) ||
        Number(a?.occurrenceId || 0) - Number(b?.occurrenceId || 0) ||
        Number(a?.sourceOrder || 0) - Number(b?.sourceOrder || 0) ||
        Number(a?.effectOrder || 0) - Number(b?.effectOrder || 0) ||
        Number(a?.candidateId || 0) - Number(b?.candidateId || 0),
    );
  }

  orderCandidates(
    requirement: AutoSelectionRequirement,
    candidates: AutoSelectionCandidate[],
    context: AutoSelectorContext,
  ): AutoSelectionCandidate[] {
    const strategy =
      requirement.filters?.strategy ||
      requirement.strategy ||
      selectionContractIntent(context) ||
      null;

    if (strategy === "highest_atk") {
      return candidates.slice().sort((a, b) => (b.atk || 0) - (a.atk || 0));
    }
    if (strategy === "lowest_atk") {
      return candidates.slice().sort((a, b) => (a.atk || 0) - (b.atk || 0));
    }
    if (strategy === "highest_def") {
      return candidates.slice().sort((a, b) => (b.def || 0) - (a.def || 0));
    }
    if (strategy === "lowest_def") {
      return candidates.slice().sort((a, b) => (a.def || 0) - (b.def || 0));
    }

    const intent = this.getRequirementIntent(
      requirement,
      context,
      candidates
    );
    if (!intent) {
      return candidates;
    }

    const scored = candidates.map((candidate) => ({
      candidate,
      score: this.getCandidateScore(candidate, intent, {
        ...context,
        requirement,
      }),
    }));

    scored.sort((a, b) => {
      if (intent === "cost") return a.score - b.score;
      return b.score - a.score;
    });

    return scored.map((entry) => entry.candidate);
  }

  getDesiredCount(
    requirement: AutoSelectionRequirement,
    candidates: AutoSelectionCandidate[],
    limits: AutoSelectorLimits,
    context: AutoSelectorContext,
  ): number {
    const min = Number(limits.min ?? 0);
    const max = Number(limits.max ?? min);
    const available = Array.isArray(candidates) ? candidates.length : 0;
    if (available <= 0) return 0;

    if (min > 0) {
      return Math.min(min, max, available);
    }

    const shouldSelectOptional = this.shouldSelectOptional(
      requirement,
      candidates,
      context
    );
    if (!shouldSelectOptional || max <= 0) {
      return 0;
    }

    return Math.min(1, max, available);
  }

  shouldSelectOptional(
    requirement: AutoSelectionRequirement,
    candidates: AutoSelectionCandidate[],
    context: AutoSelectorContext,
  ): boolean {
    const strategy =
      requirement.filters?.strategy ||
      requirement.strategy ||
      selectionContractIntent(context) ||
      null;
    if (strategy) {
      return candidates.length > 0;
    }

    const intent = this.getRequirementIntent(
      requirement,
      context,
      candidates
    );
    if (!intent || intent === "cost") {
      return false;
    }

    const best = candidates[0];
    const score = this.getCandidateScore(best, intent, {
      ...context,
      requirement,
    });
    const threshold =
      intent === "harm" ? 0.5 : intent === "benefit" ? 0.6 : 0.7;

    return score >= threshold;
  }

  getRequirementIntent(
    requirement: AutoSelectionRequirement,
    context: AutoSelectorContext,
    candidates: AutoSelectionCandidate[],
  ): SelectionIntent | null {
    const targetPreference = getTargetPreference({
      ...context,
      requirement,
    });
    if (targetPreference?.intent) return targetPreference.intent;
    if (targetPreference?.role === "cost") return "cost";

    const explicit =
      requirement.intent ||
      requirement.filters?.intent ||
      selectionContractIntent(context) ||
      null;
    if (explicit) return explicit;

    const contractKind = context?.selectionContract?.kind;
    if (contractKind === "cost") return "cost";

    if (requirement.owner === "opponent") return "harm";
    if (requirement.owner === "player") return "benefit";

    if (Array.isArray(candidates) && candidates.length > 0) {
      const owner = context?.owner || context?.player || null;
      const opponent =
        owner && typeof this.game?.getOpponent === "function"
          ? this.game.getOpponent(owner)
          : null;
      const hasOpponentCandidate = candidates.some((candidate) => {
        const ownerPlayer = this.resolveCandidateOwner(candidate, context);
        return ownerPlayer && opponent && ownerPlayer === opponent;
      });
      if (hasOpponentCandidate) return "harm";
    }

    return "benefit";
  }

  resolveCandidateOwner(
    candidate: AutoSelectionCandidate | null | undefined,
    context: AutoSelectorContext,
  ): AutoSelectorPlayer | null {
    if (!candidate) return null;
    if (candidate.controller === "player") return this.game?.player || null;
    if (candidate.controller === "bot") return this.game?.bot || null;

    const owner = context?.owner || context?.player || null;
    if (!owner) return null;
    if (candidate.owner === "player") return owner;
    if (candidate.owner === "opponent") {
      return typeof this.game?.getOpponent === "function"
        ? this.game.getOpponent(owner)
        : null;
    }
    return null;
  }

  getCandidateScore(
    candidate: AutoSelectionCandidate,
    intent: SelectionIntent,
    context: AutoSelectorContext,
  ): number {
    const ownerPlayer = this.resolveCandidateOwner(candidate, context);
    const baseCard =
      candidate?.cardRef ||
      {
        name: candidate?.name,
        cardKind: candidate?.cardKind,
        atk: candidate?.atk,
        def: candidate?.def,
        level: candidate?.level,
        position: candidate?.position,
        archetype: candidate?.archetype,
        archetypes: candidate?.archetypes,
        goodDiscard: candidate?.goodDiscard,
        cannotBeNormalSummonedOrSet: candidate?.cannotBeNormalSummonedOrSet,
        usedEffectThisTurn: candidate?.usedEffectThisTurn,
        hasAttacked: candidate?.hasAttacked,
        mustBeAttacked: candidate?.mustBeAttacked,
        tempAtkBoost: candidate?.tempAtkBoost,
        equipAtkBonus: candidate?.equipAtkBonus,
        tempDefBoost: candidate?.tempDefBoost,
        equipDefBonus: candidate?.equipDefBonus,
      };
    const options = {
      fieldSpell: ownerPlayer?.fieldSpell || null,
      preferDefense: false,
    };

    const baseValue =
      baseCard?.cardKind === "monster"
        ? estimateMonsterValue(baseCard, options)
        : estimateCardValue(baseCard, options);

    const self = context?.owner || context?.player || null;
    const isSelf = self && ownerPlayer === self;
    if (intent === "harm") {
      const targetPreference = getTargetPreference(context);
      if (
        targetPreference?.role === "removal" ||
        targetPreference?.role === "named_preference" ||
        targetPreference?.preferredNames?.length
      ) {
        return (
          getNamedPreferenceTargetScore(baseCard, targetPreference, candidate) +
          (isSelf ? -0.4 : 0.4)
        );
      }
      if (
        targetPreference?.role === "temporary_stat_debuff" &&
        targetPreference?.purpose === "combat"
      ) {
        return (
          scoreTemporaryCombatDebuff(baseCard, {
            attackers: targetPreference.attackers || [],
            opponentLp:
              targetPreference.opponentLp ??
              this.resolveCandidateOwner(candidate, context)?.lp ??
              0,
            atkReduction: targetPreference.atkReduction,
            defReduction: targetPreference.defReduction,
            destroyIfAtkZeroedByThisEffect:
              targetPreference.destroyIfAtkZeroedByThisEffect,
            destroyIfDefZeroedByThisEffect:
              targetPreference.destroyIfDefZeroedByThisEffect,
          }) + (isSelf ? -0.4 : 0.4)
        );
      }
      return baseValue + (isSelf ? -0.6 : 0.6);
    }
    if (intent === "benefit") {
      const targetPreference = getTargetPreference(context);
      if (
        targetPreference?.role === "named_preference" ||
        targetPreference?.preferredNames?.length
      ) {
        return (
          getNamedPreferenceTargetScore(baseCard, targetPreference, candidate) +
          (isSelf ? 0.2 : -0.4)
        );
      }
      if (targetPreference?.role === "recursion") {
        return (
          getRecursionTargetScore(baseCard, targetPreference) +
          (isSelf ? 0.2 : -0.4)
        );
      }
      if (
        targetPreference?.role === "temporary_stat_buff" &&
        targetPreference?.purpose === "offense"
      ) {
        return (
          this.getOffensiveTemporaryBuffScore(baseCard, context, targetPreference) +
          (isSelf ? 0.2 : -0.4)
        );
      }
      if (targetPreference?.role === "stance_dance_buff") {
        return (
          this.getStanceDanceBuffScore(
            baseCard,
            candidate,
            context,
            targetPreference,
          ) + (isSelf ? 0.2 : -0.4)
        );
      }
      return baseValue + (isSelf ? 0.4 : -0.4);
    }
    if (intent === "cost") {
      // Prefer cards that are cheap to lose from hand:
      // - goodDiscard: has a beneficial effect when sent to GY (e.g. Voltaic burn)
      // - cannotBeNormalSummonedOrSet: no hand utility, only useful from GY (e.g. Boneflame)
      // Lower score = picked first as cost
      let costScore = baseValue;
      if (baseCard?.goodDiscard === true) costScore -= 1.5;
      if (baseCard?.cannotBeNormalSummonedOrSet === true) costScore -= 2.0;
      // Preserve Extreme Dragons — needed for Bahamut win condition (5 in GY)
      if (
        baseCard?.archetype === "Extreme Dragons" ||
        baseCard?.archetypes?.includes?.("Extreme Dragons")
      ) {
        costScore += 100;
      }
      const costPreferences = mergeCostPreference(
        getTargetPreference(context),
        context?.activationContext?.actionContext?.costPreferences ||
          context?.activationContext?.costPreferences ||
          null,
      );
      const isPreferredArchetype =
        costPreferences?.archetype &&
        (baseCard?.archetype === costPreferences.archetype ||
          baseCard?.archetypes?.includes?.(costPreferences.archetype));
      if (costPreferences) {
        const preferNames = costPreferences.preferNames || [];
        const forceNames = costPreferences.forceNames || [];
        const preserveNames = costPreferences.preserveNames || [];
        if (baseCard.name && forceNames.includes(baseCard.name)) costScore -= 30;
        if (baseCard.name && preferNames.includes(baseCard.name)) costScore -= 2.5;
        if (baseCard.name && preserveNames.includes(baseCard.name)) costScore += 18;
        const candidateIds = getCandidateInstanceIds(baseCard, candidate);
        if (
          listIncludesInstance(
            costPreferences.preferredInstanceIds,
            candidateIds,
          )
        ) {
          costScore -= 60;
        }
        if (
          listIncludesInstance(costPreferences.avoidInstanceIds, candidateIds)
        ) {
          costScore += 60;
        }
        if (
          baseCard.name &&
          (costPreferences.avoidNames || []).includes(baseCard.name)
        ) {
          costScore += 20;
        }
        if (
          costPreferences.preserveLastOffensivePayoff &&
          isOffensivePayoffCost(
            baseCard,
            costPreferences.offensivePayoffNames || [],
          )
        ) {
          const configuredPayoffs = costPreferences.availableOffensivePayoffs;
          const availablePayoffs =
            typeof configuredPayoffs === "number" &&
            Number.isFinite(configuredPayoffs)
            ? configuredPayoffs
            : countAvailableOffensivePayoffs(
                ownerPlayer,
                costPreferences.offensivePayoffNames || [],
              );
          if (availablePayoffs <= 1) costScore += 80;
        }
      }
      if (isPreferredArchetype) {
        const preferNames = costPreferences.preferNames || [];
        const preserveNames = costPreferences.preserveNames || [];
        const offensivePayoffNames = costPreferences.offensivePayoffNames || [];
        if (
          costPreferences.preserveLastOffensivePayoff &&
          isOffensivePayoffCost(baseCard, offensivePayoffNames)
        ) {
          const configuredPayoffs = costPreferences.availableOffensivePayoffs;
          const availablePayoffs =
            typeof configuredPayoffs === "number" &&
            Number.isFinite(configuredPayoffs)
            ? configuredPayoffs
            : countAvailableOffensivePayoffs(ownerPlayer, offensivePayoffNames);
          if (availablePayoffs <= 1) costScore += 80;
          else if (costPreferences.stableDefense) costScore += 8;
        }
        if (baseCard?.usedEffectThisTurn || baseCard?.hasAttacked) {
          costScore -= 1.5;
        }
        if (baseCard?.mustBeAttacked) costScore += 4;
        if (
          baseCard?.name === "Luminarch Radiant Lancer" &&
          ((baseCard?.atk || 0) +
            (baseCard?.tempAtkBoost || 0) +
            (baseCard?.equipAtkBonus || 0) >
            2200 ||
            baseCard?.hasAttacked)
        ) {
          costScore += 5;
        }
        if ((baseCard?.def || 0) + (baseCard?.tempDefBoost || 0) >= 2500) {
          costScore += 3;
        }
      }
      return costScore;
    }
    return baseValue;
  }

  getOffensiveTemporaryBuffScore(
    card: AutoSelectorScorableCard | null | undefined,
    context: AutoSelectorContext,
    preference: AutoSelectorPreference,
  ): number {
    if (!card || card.cardKind !== "monster") return -100;
    const configuredAtkBoost = preference.atkBoost;
    const atkBoost =
      typeof configuredAtkBoost === "number" &&
      Number.isFinite(configuredAtkBoost)
      ? configuredAtkBoost
      : 0;
    if (atkBoost <= 0) return -100;
    if (card.position !== "attack") return -80 + getEffectiveAtk(card) / 10000;
    if (card.cannotAttackThisTurn || card.hasAttacked) {
      return -40 + getEffectiveAtk(card) / 10000;
    }

    const self = context?.owner || context?.player || null;
    const opponent =
      self && typeof this.game?.getOpponent === "function"
        ? this.game.getOpponent(self)
        : null;
    const opponentMonsters = (opponent?.field || []).filter(
      (monster) => monster && monster.cardKind === "monster",
    );
    return scoreOffensiveTemporaryBuff(card, {
      atkBoost,
      opponentField: opponentMonsters,
      opponentLp: opponent?.lp || 0,
    });
  }

  getStanceDanceBuffScore(
    card: AutoSelectorScorableCard | null | undefined,
    candidate: AutoSelectionCandidate,
    context: AutoSelectorContext,
    preference: AutoSelectorPreference,
  ): number {
    if (!card || card.cardKind !== "monster") return -100;
    const configuredAtkBoost = preference.atkBoost;
    const atkBoost =
      typeof configuredAtkBoost === "number" &&
      Number.isFinite(configuredAtkBoost)
      ? configuredAtkBoost
      : 0;
    const sourceCardId =
      preference?.sourceCardId ??
      context?.selectionContract?.metadata?.sourceCardId;
    const isSource =
      sourceCardId != null &&
      (candidate?.cardRef?.id === sourceCardId || candidate?.id === sourceCardId);
    const expectedAtk = getEffectiveAtk(card) + atkBoost;
    let score = -10;

    if (isSource) score += 80;
    if (preference?.preferredName && card.name === preference.preferredName) {
      score += 35;
    }
    if (card.position === "defense") score += 25;
    if (card.position === "attack") score -= 35;
    if (card.cannotAttackThisTurn && card.position !== "defense") score -= 30;
    if (card.hasAttacked) score -= 40;

    const self = context?.owner || context?.player || null;
    const opponent =
      self && typeof this.game?.getOpponent === "function"
        ? this.game.getOpponent(self)
        : null;
    const opponentMonsters = (opponent?.field || []).filter(
      (monster) => monster && monster.cardKind === "monster",
    );
    const bestTargetStat = opponentMonsters.reduce((max, monster) => {
      const stat = monster.isFacedown
        ? 1500
        : monster.position === "defense"
          ? getEffectiveDef(monster)
          : getEffectiveAtk(monster);
      return Math.max(max, stat);
    }, 0);

    if (opponentMonsters.length === 0) score += 20;
    if (expectedAtk >= (opponent?.lp || 8000)) score += 45;
    if (bestTargetStat > 0 && expectedAtk > bestTargetStat) score += 30;
    score += expectedAtk / 1000;
    return score;
  }
}

function selectionContractIntent(
  context: AutoSelectorContext,
): SelectionIntent | null {
  const intent = context?.selectionContract?.metadata?.intent;
  return typeof intent === "string" ? intent : null;
}

function getTargetPreference(
  context: AutoSelectorContext,
): AutoSelectorPreference | null {
  const requirementId = context?.requirement?.id || null;
  const actionContext = context?.activationContext?.actionContext || {};
  const byTarget = actionContext.targetPreferences || {};
  if (requirementId && byTarget[requirementId]) return byTarget[requirementId];
  return actionContext.targetPreference || null;
}

function mergeCostPreference(
  targetPreference: AutoSelectorPreference | null | undefined,
  costPreference: AutoSelectorPreference | null | undefined,
): AutoSelectorPreference | null {
  if (!costPreference && !targetPreference) return null;
  if (!costPreference) return targetPreference || null;
  if (!targetPreference) return costPreference || null;
  return {
    ...costPreference,
    ...targetPreference,
    preferNames: [
      ...(costPreference.preferNames || []),
      ...(targetPreference.preferNames || []),
    ],
    forceNames: [
      ...(costPreference.forceNames || []),
      ...(targetPreference.forceNames || []),
    ],
    preserveNames: [
      ...(costPreference.preserveNames || []),
      ...(targetPreference.preserveNames || []),
    ],
    preferredInstanceIds: [
      ...(costPreference.preferredInstanceIds || []),
      ...(targetPreference.preferredInstanceIds || []),
    ],
    avoidInstanceIds: [
      ...(costPreference.avoidInstanceIds || []),
      ...(targetPreference.avoidInstanceIds || []),
    ],
    avoidNames: [
      ...(costPreference.avoidNames || []),
      ...(targetPreference.avoidNames || []),
    ],
  };
}

function isOffensivePayoffCost(
  card: AutoSelectorScorableCard | null | undefined,
  payoffNames: string[] = [],
): boolean {
  if (!card || card.cardKind !== "monster") return false;
  if (card.name && (payoffNames || []).includes(card.name)) return true;
  return (card.level || 0) >= 7 && getEffectiveAtk(card) >= 2400;
}

function countAvailableOffensivePayoffs(
  player: AutoSelectorPlayer | null | undefined,
  payoffNames: string[] = [],
): number {
  if (!player) return 0;
  return [...(player.hand || []), ...(player.deck || [])].filter((card) =>
    isOffensivePayoffCost(card, payoffNames)
  ).length;
}

function getCandidateInstanceIds(
  card: AutoSelectorScorableCard | null | undefined,
  candidate: AutoSelectionCandidate | null | undefined,
): Array<string | number> {
  return [
    candidate?.instanceId,
    candidate?.fieldPresenceId,
    candidate?.cardRef?.instanceId,
    candidate?.cardRef?.fieldPresenceId,
    card?.instanceId,
    card?.fieldPresenceId,
  ].filter((id) => id !== null && id !== undefined);
}

function listIncludesInstance(
  ids: Array<string | number> = [],
  candidateIds: Array<string | number> = [],
): boolean {
  if (!Array.isArray(ids) || ids.length === 0) return false;
  const normalized = new Set(ids.map((id) => String(id)));
  return candidateIds.some((id) => normalized.has(String(id)));
}

function getNamedPreferenceTargetScore(
  card: AutoSelectorScorableCard | null | undefined,
  preference: AutoSelectorPreference = {},
  candidate: AutoSelectionCandidate | null = null,
): number {
  if (!card) return -100;
  const preferredNames = preference.preferredNames || [];
  const avoidNames = preference.avoidNames || [];
  const candidateIds = getCandidateInstanceIds(card, candidate);
  let score = estimateCardValue(card);
  if (card.name && preferredNames.includes(card.name)) score += 40;
  if (card.name && avoidNames.includes(card.name)) score -= 30;
  if (listIncludesInstance(preference.preferredInstanceIds, candidateIds)) {
    score += 55;
  }
  if (listIncludesInstance(preference.avoidInstanceIds, candidateIds)) {
    score -= 45;
  }
  return score;
}

function getRecursionTargetScore(
  card: AutoSelectorScorableCard | null | undefined,
  preference: AutoSelectorPreference = {},
): number {
  if (!card || card.cardKind !== "monster") return -100;
  const atk = getEffectiveAtk(card);
  const def = getEffectiveDef(card);
  const purpose = preference.purpose || "value";
  const defensiveNames = preference.defensiveNames || [];
  const offensiveNames = preference.offensiveNames || [];
  const preferredNames = preference.preferredNames || [];
  let score = (card.level || 0) * 0.2 + Math.max(atk, def) / 1000;
  if (card.name && preferredNames.includes(card.name)) score += 6;

  if (purpose === "stabilize" || purpose === "defense") {
    score += def / 450;
    if (def >= atk + 500 || card.mustBeAttacked) score += 2;
    if (card.name && defensiveNames.includes(card.name)) score += 3;
    if (card.name && offensiveNames.includes(card.name) && def < 2000) score -= 1;
  } else if (purpose === "pressure" || purpose === "offense") {
    score += atk / 450;
    if (atk >= 2000 || card.piercing) score += 2;
    if (card.name && offensiveNames.includes(card.name)) score += 2;
    if (card.name && defensiveNames.includes(card.name) && atk < 1800) score -= 3;
  } else {
    if (card.name && defensiveNames.includes(card.name)) score += 0.8;
    if (card.name && offensiveNames.includes(card.name)) score += 0.8;
  }

  return score;
}
