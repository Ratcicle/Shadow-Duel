import { isAI } from "../Player.js";

/**
 * Check if an effect requires target selection
 * @param {Object} effect
 * @returns {boolean}
 */
export function effectRequiresTargets(effect) {
  return (
    effect?.targets &&
    Array.isArray(effect.targets) &&
    effect.targets.length > 0
  );
}

export function getActivationCostTargetDefinitions(effect) {
  return (effect?.targets || []).filter((target) => target?.intent === "cost");
}

export function getDeclaredTargetDefinitions(effect) {
  return (effect?.targets || []).filter((target) => target?.intent !== "cost");
}

export async function getPlayerSelectionsForDefinitions(
  card,
  definitions,
  player,
  context,
  options = {},
) {
  if (!Array.isArray(definitions) || definitions.length === 0) return {};
  const effectEngine = this.game?.effectEngine;
  if (!effectEngine) return null;
  const purpose = options.purpose === "cost" ? "cost" : "target";
  const allowCancel = options.allowCancel !== false;
  const ctx = {
    source: card,
    sourceCard: card,
    player,
    opponent: this.getOpponent(player),
    defender: context?.defender || context?.target,
    target: context?.target || context?.defender || null,
    attacker: context?.attacker,
    attackerOwner: context?.attackerOwner,
    defenderOwner: context?.defenderOwner,
    activationZone: options.activationZone || context?.activationZone || null,
    activationContext: {
      ...(context?.activationContext || {}),
      timing: "activation",
      purpose,
      autoSelectSingleTarget: isAI(player),
      autoSelectTargets: isAI(player),
    },
  };
  const targetResult = effectEngine.resolveTargets(definitions, ctx, null);
  const baseTargets = targetResult?.targets || {};
  if (targetResult?.ok === false && !targetResult?.needsSelection) return null;
  if (!targetResult?.needsSelection) return baseTargets;
  const contract = targetResult.selectionContract;
  if (!contract) return null;
  contract.kind = purpose;
  contract.timing = "activation";
  contract.purpose = purpose;
  contract.ui = {
    ...(contract.ui || {}),
    allowCancel,
    preventCancel: !allowCancel,
  };

  if (isAI(player) && this.game?.autoSelector) {
    const autoResult = this.game.autoSelector.select(contract, {
      owner: player,
      selectionContract: contract,
      selectionKind: purpose,
    });
    if (!autoResult?.ok) return null;
    return {
      ...baseTargets,
      ...this.resolveSelectionsToCards(
        autoResult.selections || {},
        contract.requirements || [],
        player,
      ),
    };
  }

  if (!this.game?.startTargetSelectionSession) return null;
  return new Promise((resolve) => {
    this.game.startTargetSelectionSession({
      selectionContract: contract,
      message:
        contract.message ||
        (purpose === "cost"
          ? `Select activation cost for ${card.name}`
          : `Select target(s) for ${card.name}`),
      kind: purpose,
      allowCancel,
      preventCancel: !allowCancel,
      execute: (selections) => {
        resolve({
          ...baseTargets,
          ...this.resolveSelectionsToCards(
            selections,
            contract.requirements || [],
            player,
          ),
        });
        return { success: true, needsSelection: false };
      },
      onCancel: allowCancel ? () => resolve(null) : null,
    });
  });
}

/**
 * Get player selections for an effect that requires targets
 * @param {Object} card
 * @param {Object} effect
 * @param {Object} player
 * @param {ChainContext} context
 * @returns {Promise<Object|null>}
 */
export async function getPlayerSelectionsForEffect(card, effect, player, context) {
  const definitions = this.getDeclaredTargetDefinitions?.(effect) || [];
  if (definitions.length === 0) return {};

  if (typeof this.getPlayerSelectionsForDefinitions === "function") {
    return this.getPlayerSelectionsForDefinitions(
      card,
      definitions,
      player,
      context,
      { purpose: "target", allowCancel: true },
    );
  }

  const effectEngine = this.game?.effectEngine;
  const ui = this.getUI();

  if (!effectEngine || !ui) {
    return null;
  }

  // Build context with attack info if available
  const ctx = {
    source: card,
    player,
    opponent: this.getOpponent(player),
    defender: context?.defender || context?.target,
    attacker: context?.attacker,
    attackerOwner: context?.attackerOwner,
    defenderOwner: context?.defenderOwner,
    activationContext: { autoSelectSingleTarget: isAI(player) },
  };

  // Use resolveTargets to check what selections are needed
  const targetResult = effectEngine.resolveTargets(effect.targets, ctx, null);
  const baseTargets = targetResult.targets || {};

  if (targetResult.ok === false) {
    this.log(`Target resolution failed: ${targetResult.reason}`);
    return null;
  }

  // If targets were auto-resolved (e.g., targetFromContext), return them
  if (!targetResult.needsSelection && targetResult.targets) {
    return targetResult.targets;
  }

  // If selection is needed, show selection UI
  if (targetResult.needsSelection && targetResult.selectionContract) {
    const contract = targetResult.selectionContract;

    // Bot must never open the human selection UI — auto-select from candidates
    if (isAI(player) && this.game?.autoSelector) {
      const autoResult = this.game.autoSelector.select(contract, {
        owner: player,
        selectionContract: contract,
        selectionKind: "target",
      });
      const fallbackSelections = {};
      for (const req of contract.requirements || []) {
        const candidates = Array.isArray(req.candidates) ? req.candidates : [];
        const min = Number(req.min ?? 0);
        const max = Number(req.max ?? min);
        const pickCount = Math.min(
          autoResult?.ok && autoResult.selections?.[req.id]?.length >= min
            ? max
            : min,
          candidates.length,
        );
        const keys =
          autoResult?.ok && autoResult.selections?.[req.id]
            ? autoResult.selections[req.id]
            : candidates.slice(0, pickCount).map((c) => c.key).filter(Boolean);
        fallbackSelections[req.id] = keys;
      }
      const resolvedFallback = this.resolveSelectionsToCards(
        fallbackSelections,
        contract.requirements,
        player,
      );
      return { ...baseTargets, ...resolvedFallback };
    }

    // Use the game's target selection system
    if (this.game?.startTargetSelectionSession) {
      return new Promise((resolve) => {
        this.game.startTargetSelectionSession({
          selectionContract: contract,
          message: contract.message || `Select target(s) for ${card.name}`,
          kind: "target",
          allowCancel: true,
          execute: (selections) => {
            // Convert selection keys to actual card references
            const resolvedSelections = this.resolveSelectionsToCards(
              selections,
              contract.requirements,
              player,
            );
            // Merge auto-resolved targets (e.g., targetFromContext) so they
            // are preserved alongside player-chosen selections.
            const mergedSelections = {
              ...baseTargets,
              ...resolvedSelections,
            };
            resolve(mergedSelections);
            return { success: true, needsSelection: false };
          },
          onCancel: () => {
            resolve(null);
          },
        });
      });
    }
  }

  // No selection flow available; return any auto-resolved targets we have.
  return baseTargets;
}

/**
 * Convert selection keys to actual card references
 * @param {Object} selections - Map of requirement id to selected keys
 * @param {Array} requirements - Selection requirements with candidates
 * @param {Object} player
 * @returns {Object} Map of requirement id to card arrays
 */
export function resolveSelectionsToCards(selections, requirements, player) {
  const resolved = {};

  for (const req of requirements || []) {
    const selectedKeys = selections[req.id] || [];
    const cards = [];

    for (const key of selectedKeys) {
      // Find the candidate by key
      const candidate = req.candidates?.find((c) => c.key === key);
      if (candidate?.cardRef) {
        cards.push(candidate.cardRef);
      }
    }

    resolved[req.id] = cards;
  }

  return resolved;
}
