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

    return candidates;
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
    const intent =
      requirement.intent ||
      requirement.filters?.intent ||
      requirement.filters?.strategy ||
      requirement.strategy ||
      selectionContractIntent(context) ||
      null;
    if (intent) return true;

    return false;
  }
}

function selectionContractIntent(context) {
  const intent = context?.selectionContract?.metadata?.intent;
  return typeof intent === "string" ? intent : null;
}
