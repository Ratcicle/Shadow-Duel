import { estimateCardValue, estimateMonsterValue } from "./ai/StrategyUtils.js";

export default class AutoSelector {
  constructor(game) {
    this.game = game;
  }

  select(selectionContract, context = {}) {
    if (
      !selectionContract ||
      !Array.isArray(selectionContract.requirements) ||
      selectionContract.requirements.length === 0
    ) {
      return { ok: false, reason: "Selection contract is missing requirements." };
    }

    const selections = {};
    const contextWithContract = {
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
      selections[requirement.id] = chosen
        .map((cand) => cand.key)
        .filter(Boolean);
    }

    return { ok: true, selections };
  }

  orderCandidates(requirement, candidates, context) {
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
      score: this.getCandidateScore(candidate, intent, context),
    }));

    scored.sort((a, b) => {
      if (intent === "cost") return a.score - b.score;
      return b.score - a.score;
    });

    return scored.map((entry) => entry.candidate);
  }

  getDesiredCount(requirement, candidates, limits, context) {
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

  shouldSelectOptional(requirement, candidates, context) {
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
    const score = this.getCandidateScore(best, intent, context);
    const threshold =
      intent === "harm" ? 0.5 : intent === "benefit" ? 0.6 : 0.7;

    return score >= threshold;
  }

  getRequirementIntent(requirement, context, candidates) {
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

  resolveCandidateOwner(candidate, context) {
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

  getCandidateScore(candidate, intent, context) {
    const ownerPlayer = this.resolveCandidateOwner(candidate, context);
    const baseCard =
      candidate?.cardRef ||
      {
        cardKind: candidate?.cardKind,
        atk: candidate?.atk,
        def: candidate?.def,
        level: candidate?.level,
        position: candidate?.position,
        archetype: candidate?.archetype,
        archetypes: candidate?.archetypes,
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
      return baseValue + (isSelf ? -0.6 : 0.6);
    }
    if (intent === "benefit") {
      return baseValue + (isSelf ? 0.4 : -0.4);
    }
    return baseValue;
  }
}

function selectionContractIntent(context) {
  const intent = context?.selectionContract?.metadata?.intent;
  return typeof intent === "string" ? intent : null;
}
