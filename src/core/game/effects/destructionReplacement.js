/**
 * destructionReplacement.js
 *
 * Destruction replacement-effect resolution extracted from Game.js.
 * Original `resolveDestructionWithReplacement` was 370 lines with three
 * inner closures (`formatReplacementText`, `matchesTargetFilters`,
 * `tryReplacement`). Those have been lifted to module-private helpers
 * that receive a destruction context object instead of capturing scope.
 *
 * Public method (bound via prototype on Game):
 *  - resolveDestructionWithReplacement
 */

import {
  canUseOncePerDuelEffect,
  markOncePerDuelEffectUsed,
} from "../../effects/triggers/registration.js";
import { getCardDisplayName, getUIText } from "../../i18n.js";

function getCostKindLabel(cardKind = "card", count = 1) {
  const plurality = count > 1 ? "Plural" : "Singular";
  const key =
    cardKind === "monster"
      ? `ui.replacement.monster${plurality}`
      : cardKind === "spell"
        ? `ui.replacement.spell${plurality}`
        : cardKind === "trap"
          ? `ui.replacement.trap${plurality}`
          : `ui.replacement.card${plurality}`;
  return getUIText(key);
}

function getCostTypeDescription(costFilters, count) {
  if (costFilters.archetype) {
    const baseType = getCostKindLabel(costFilters.cardKind || "card", count);
    return `"${costFilters.archetype}" ${baseType}`;
  }

  if (costFilters.cardKind) {
    return getCostKindLabel(costFilters.cardKind, count);
  }

  return getCostKindLabel("card", count);
}

function formatReplacementText(text, targetCardName, sourceCardName) {
  if (!text) return text;
  return text
    .replace("{target}", targetCardName)
    .replace("{source}", sourceCardName || "");
}

function getReplacementTargetKey(card) {
  if (!card) return null;
  if (card.instanceId !== undefined && card.instanceId !== null) {
    return `instance:${card.instanceId}`;
  }
  if (card.fieldPresenceId !== undefined && card.fieldPresenceId !== null) {
    return `presence:${card.fieldPresenceId}`;
  }
  return null;
}

function matchesTargetFilters(game, target, filters) {
  if (!filters || Object.keys(filters).length === 0) return true;
  if (game.effectEngine?.cardMatchesFilters) {
    return game.effectEngine.cardMatchesFilters(target, filters);
  }

  const nameFilter = filters.name || filters.cardName;
  if (nameFilter && target.name !== nameFilter) return false;
  if (filters.cardKind) {
    const requiredKinds = Array.isArray(filters.cardKind)
      ? filters.cardKind
      : [filters.cardKind];
    if (!requiredKinds.includes(target.cardKind)) return false;
  }
  if (filters.subtype) {
    const requiredSubtypes = Array.isArray(filters.subtype)
      ? filters.subtype
      : [filters.subtype];
    if (!requiredSubtypes.includes(target.subtype)) return false;
  }
  if (filters.archetype) {
    const archetypes = Array.isArray(target.archetypes)
      ? target.archetypes
      : target.archetype
        ? [target.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  return true;
}

function getRelativePlayer(game, sourceOwner, ownerRule) {
  if (!sourceOwner || !ownerRule || ownerRule === "any") return null;
  if (ownerRule === "self") return sourceOwner;
  if (ownerRule === "opponent") {
    return typeof game.getOpponent === "function"
      ? game.getOpponent(sourceOwner)
      : null;
  }
  return null;
}

function matchesReplacementSourceOwner(game, replacement, sourceOwner, ctx) {
  const ownerRule =
    replacement.sourceOwner ||
    replacement.sourceController ||
    replacement.causedByOwner ||
    replacement.destroyedByOwner ||
    "any";
  if (ownerRule === "any") return true;

  const destructionSourcePlayer = ctx?.sourcePlayer || null;
  if (!destructionSourcePlayer) return false;

  const expectedOwner = getRelativePlayer(game, sourceOwner, ownerRule);
  return expectedOwner ? destructionSourcePlayer === expectedOwner : false;
}

function getReplacementStrategy(game, player) {
  if (!player) return null;
  if (player.strategy) return player.strategy;
  if (game?.bot === player) return game.bot?.strategy || null;
  if (game?.player === player) return game.player?.strategy || null;
  return null;
}

async function shouldUseAiReplacementEffect({
  game,
  player,
  sourceCard,
  effect,
  replacementEffect,
  targetCard,
  cause,
  fromZone,
  context,
  kind,
}) {
  if (player?.controllerType === "human") return true;
  const strategy = getReplacementStrategy(game, player);
  if (typeof strategy?.shouldUseReplacementEffect !== "function") return true;

  const decision = await strategy.shouldUseReplacementEffect({
    game,
    player,
    sourceCard,
    effect,
    replacementEffect,
    targetCard,
    cause,
    fromZone,
    context,
    kind,
  });

  if (decision === false) return false;
  if (decision && typeof decision === "object") {
    if (decision.use === false || decision.shouldUse === false) return false;
  }
  return true;
}

function getCardZoneIndex(game, owner, zoneName, card) {
  if (!owner || !zoneName || !card) return -1;
  if (zoneName === "fieldSpell") {
    return owner.fieldSpell === card ? 0 : -1;
  }
  const zone = game.getZone?.(owner, zoneName) || owner[zoneName] || [];
  return Array.isArray(zone) ? zone.indexOf(card) : -1;
}

function decorateSelectionCandidates(game, owner, candidates, zones) {
  return candidates.map((card, idx) => {
    const zone =
      zones.find(
        (zoneName) => getCardZoneIndex(game, owner, zoneName, card) >= 0,
      ) || "field";
    const zoneIndex = getCardZoneIndex(game, owner, zone, card);
    return {
      idx,
      name: card.name,
      owner: card.owner === "player" ? "player" : "opponent",
      controller: card.controller || card.owner || owner.id,
      zone,
      zoneIndex,
      position: card.position,
      atk: card.atk,
      def: card.def,
      cardKind: card.cardKind,
      cardRef: card,
    };
  });
}

function getReplacementCostZones(replacement) {
  if (Array.isArray(replacement.costZones) && replacement.costZones.length > 0) {
    return replacement.costZones;
  }
  if (Array.isArray(replacement.costZone) && replacement.costZone.length > 0) {
    return replacement.costZone;
  }
  return [replacement.costZone || "field"];
}

function collectReplacementCostCandidates(
  game,
  costOwner,
  costZones,
  filterCandidates,
) {
  const entries = [];
  const seen = new Set();

  for (const zoneName of costZones) {
    const zoneCards =
      zoneName === "fieldSpell"
        ? costOwner.fieldSpell
          ? [costOwner.fieldSpell]
          : []
        : game.getZone?.(costOwner, zoneName) || costOwner[zoneName] || [];

    if (!Array.isArray(zoneCards)) continue;

    for (const card of zoneCards) {
      if (!filterCandidates(card)) continue;
      const key = getReplacementTargetKey(card) || card;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ card, zone: zoneName });
    }
  }

  return entries;
}

function getSelectedReplacementCostZone(
  game,
  costOwner,
  costZones,
  candidateEntries,
  costCard,
) {
  const entry = candidateEntries.find((candidate) => candidate.card === costCard);
  if (entry?.zone) return entry.zone;

  return (
    costZones.find(
      (zoneName) => getCardZoneIndex(game, costOwner, zoneName, costCard) >= 0,
    ) ||
    costZones[0] ||
    "field"
  );
}

function getCostActionText(costDestination) {
  if (costDestination === "banished" || costDestination === "banish") {
    return {
      verb: getUIText("ui.replacement.actions.banish.verb"),
      suffix: getUIText("ui.replacement.actions.banish.suffix"),
      selectionVerb: getUIText(
        "ui.replacement.actions.banish.selectionVerb",
      ),
      logVerb: getUIText("ui.replacement.actions.banish.logVerb"),
      logDestination: getUIText(
        "ui.replacement.actions.banish.logDestination",
      ),
    };
  }
  if (costDestination === "hand") {
    return {
      verb: getUIText("ui.replacement.actions.hand.verb"),
      suffix: getUIText("ui.replacement.actions.hand.suffix"),
      selectionVerb: getUIText("ui.replacement.actions.hand.selectionVerb"),
      logVerb: getUIText("ui.replacement.actions.hand.logVerb"),
      logDestination: getUIText(
        "ui.replacement.actions.hand.logDestination",
      ),
    };
  }
  return {
    verb: getUIText("ui.replacement.actions.graveyard.verb"),
    suffix: getUIText("ui.replacement.actions.graveyard.suffix"),
    selectionVerb: getUIText(
      "ui.replacement.actions.graveyard.selectionVerb",
    ),
    logVerb: getUIText("ui.replacement.actions.graveyard.logVerb"),
    logDestination: getUIText(
      "ui.replacement.actions.graveyard.logDestination",
    ),
  };
}

function normalizeReplacementCostDestination(costDestination) {
  return costDestination === "banish"
    ? "banished"
    : costDestination || "graveyard";
}

async function moveReplacementCostCards({
  game,
  cards,
  costOwner,
  costZones,
  candidateEntries,
  costDestination,
  sourceCard,
  effect,
}) {
  if (!game || typeof game.moveCard !== "function") {
    return { success: false };
  }

  const normalizedDestination =
    normalizeReplacementCostDestination(costDestination);

  for (const costCard of cards) {
    const fromZone = getSelectedReplacementCostZone(
      game,
      costOwner,
      costZones,
      candidateEntries,
      costCard,
    );
    const moveResult = await game.moveCard(
      costCard,
      costOwner,
      normalizedDestination,
      {
        fromZone,
        awaitEvents: true,
        sourceCard,
        effectId: effect?.id || null,
        contextLabel: "destruction_replacement_cost",
      },
    );
    if (moveResult?.needsSelection) {
      return { ...moveResult, success: false };
    }
    if (moveResult === false || moveResult?.success === false) {
      return { success: false };
    }
  }

  return { success: true };
}

function askHumanToSelectReplacementTargets({
  game,
  sourceCard,
  targetSpec,
  targetOwner,
  candidates,
  zones,
  minCount,
  maxCount,
}) {
  if (
    !game ||
    typeof game.startTargetSelectionSession !== "function" ||
    typeof game.buildSelectionCandidateKey !== "function"
  ) {
    return Promise.resolve([]);
  }

  const decorated = decorateSelectionCandidates(
    game,
    targetOwner,
    candidates,
    zones,
  ).map((candidate, idx) => ({
    ...candidate,
    key: game.buildSelectionCandidateKey(candidate, idx),
  }));

  const requirement = {
    id: targetSpec.id,
    min: minCount,
    max: maxCount,
    zones,
    owner: targetSpec.owner || "opponent",
    filters: {},
    allowSelf: true,
    distinct: true,
    candidates: decorated,
  };

  const message =
    targetSpec.message ||
    getUIText("ui.replacement.chooseToBanish", {
      countText:
        maxCount > 1
          ? getUIText("ui.replacement.cardPlural")
          : `1 ${getUIText("ui.replacement.cardSingular")}`,
    });

  return new Promise((resolve) => {
    game.startTargetSelectionSession({
      kind: "destruction_replacement_target",
      card: sourceCard,
      selectionContract: {
        kind: "target",
        message,
        requirements: [requirement],
        ui: {
          useFieldTargeting: true,
          allowCancel: false,
          preventCancel: true,
        },
        metadata: {
          context: "destruction_replacement",
          sourceCard: sourceCard?.name || null,
        },
      },
      resolve,
      autoAdvanceOnMax: true,
      preventCancel: true,
      execute: (selections) => {
        const chosenKeys = selections[requirement.id] || [];
        const chosen = chosenKeys
          .map((key) => requirement.candidates.find((cand) => cand.key === key))
          .map((candidate) => candidate?.cardRef)
          .filter(Boolean);
        resolve(chosen);
        return { success: true, needsSelection: false };
      },
    });
  });
}

/**
 * Attempt to apply a replacement effect from a source card to prevent
 * destruction of `ctx.card`. Returns `{ replaced: boolean }`.
 *
 * @param {Game} game
 * @param {Object} sourceCard
 * @param {Object} sourceOwner
 * @param {Object} effect — must have `replacementEffect` payload
 * @param {{ card, cause, fromZone, ownerPlayer, sourceCard, sourcePlayer }} ctx
 */
async function tryReplacement(game, sourceCard, sourceOwner, effect, ctx) {
  const { card, cause, fromZone, ownerPlayer } = ctx;

  if (!sourceCard || !effect?.replacementEffect) {
    return { replaced: false };
  }

  const replacement = effect.replacementEffect;
  if (replacement.type && replacement.type !== "destruction") {
    return { replaced: false };
  }

  const sourceRequireFaceup = effect.requireFaceup !== false;
  if (sourceRequireFaceup && sourceCard.isFacedown) {
    return { replaced: false };
  }

  if (effect.requireZone) {
    const sourceZone =
      game.effectEngine?.findCardZone?.(sourceOwner, sourceCard) || null;
    if (sourceZone !== effect.requireZone) {
      return { replaced: false };
    }
  }

  if (replacement.targetMustBeSource === true && card !== sourceCard) {
    return { replaced: false };
  }

  if (replacement.targetMustBeEquippedToSource === true) {
    const targetEquips = Array.isArray(card.equips) ? card.equips : [];
    const sourceEquipsTarget =
      sourceCard.equippedTo === card ||
      sourceCard.equipTarget === card ||
      targetEquips.includes(sourceCard);
    if (!sourceEquipsTarget) {
      return { replaced: false };
    }
  }

  const targetOwnerKey =
    replacement.targetOwner ||
    replacement.appliesTo ||
    (sourceCard === card ? "self" : null);
  if (!targetOwnerKey) {
    return { replaced: false };
  }

  if (targetOwnerKey !== "any") {
    const expectedOwner =
      targetOwnerKey === "self"
        ? sourceOwner
        : game.getOpponent(sourceOwner);
    if (expectedOwner !== ownerPlayer) {
      return { replaced: false };
    }
  }

  const targetZones = replacement.targetZones
    ? replacement.targetZones
    : replacement.targetZone
      ? [replacement.targetZone]
      : null;
  if (targetZones && targetZones.length > 0) {
    if (!fromZone || !targetZones.includes(fromZone)) {
      return { replaced: false };
    }
  }

  const allowFacedown = replacement.allowFacedown === true;
  const targetRequireFaceup =
    replacement.targetRequireFaceup !== false && !allowFacedown;
  if (targetRequireFaceup && card.isFacedown) {
    return { replaced: false };
  }

  const targetFilters = replacement.targetFilters || null;
  if (targetFilters && !matchesTargetFilters(game, card, targetFilters)) {
    return { replaced: false };
  }

  const scopedTargetIds = Array.isArray(replacement.targetInstanceIds)
    ? replacement.targetInstanceIds
    : [];
  const scopedTargetCards = Array.isArray(replacement.targetCards)
    ? replacement.targetCards
    : [];
  if (scopedTargetIds.length > 0 || scopedTargetCards.length > 0) {
    const targetKey = getReplacementTargetKey(card);
    const matchesScopedId =
      targetKey && scopedTargetIds.includes(targetKey);
    const matchesScopedRef = scopedTargetCards.includes(card);
    if (!matchesScopedId && !matchesScopedRef) {
      return { replaced: false };
    }
  }

  if (
    cause === "battle" &&
    typeof game.isBattleDestructionPreventionNegated === "function" &&
    game.isBattleDestructionPreventionNegated(card, {
      owner: ownerPlayer,
      preventionSourceOwner: sourceOwner,
      preventionSourceCard: sourceCard,
      fromZone,
    })
  ) {
    return { replaced: false };
  }

  const onceCheck = game.canUseOncePerTurn(sourceCard, sourceOwner, effect);
  if (!onceCheck.ok) {
    return { replaced: false };
  }

  // Once-per-Duel usage persists across turns and can allow a fixed number of uses.
  const duelCheck = canUseOncePerDuelEffect(sourceCard, sourceOwner, effect);
  if (!duelCheck.ok) {
    return { replaced: false };
  }

  if (
    replacement.reason &&
    replacement.reason !== "any" &&
    replacement.reason !== cause
  ) {
    return { replaced: false };
  }

  if (!matchesReplacementSourceOwner(game, replacement, sourceOwner, ctx)) {
    return { replaced: false };
  }

  const strategyAllowsReplacement = await shouldUseAiReplacementEffect({
    game,
    player: sourceOwner,
    sourceCard,
    effect,
    replacementEffect: replacement,
    targetCard: card,
    cause,
    fromZone,
    context: ctx,
    kind: "destruction",
  });
  if (!strategyAllowsReplacement) {
    return { replaced: false };
  }

  const markOncePerDuelUsedIfNeeded = () => {
    markOncePerDuelEffectUsed(sourceCard, sourceOwner, effect);
  };

  const buildActionCostCtx = (extra = {}) => {
    const opponent =
      typeof game.getOpponent === "function"
        ? game.getOpponent(sourceOwner)
        : null;
    return {
      player: sourceOwner,
      opponent,
      source: sourceCard,
      destroyed: card,
      destroyedOwner: ownerPlayer,
      cause,
      activationContext: {
        source: sourceCard,
        player: sourceOwner,
      },
      ...extra,
    };
  };

  const runReplacementCostActions = async () => {
    const costActions = Array.isArray(replacement.costActions)
      ? replacement.costActions
      : [];
    if (costActions.length === 0) return true;

    const engine = game.effectEngine;
    if (!engine || typeof engine.applyActions !== "function") {
      return false;
    }

    const previewCtx = buildActionCostCtx({
      preview: true,
      isPreview: true,
      activationContext: {
        source: sourceCard,
        player: sourceOwner,
        preview: true,
        isPreview: true,
      },
    });
    const previewResult =
      typeof engine.checkActionPreviewRequirements === "function"
        ? engine.checkActionPreviewRequirements(costActions, previewCtx)
        : { ok: true };
    if (previewResult && previewResult.ok === false) {
      return false;
    }

    const sourceIsHuman = sourceOwner?.controllerType === "human";
    if (sourceIsHuman && replacement.auto !== true) {
      const targetName = getCardDisplayName(card) || card.name;
      const sourceName = getCardDisplayName(sourceCard) || sourceCard.name;
      const prompt =
        formatReplacementText(replacement.prompt, targetName, sourceName) ||
        getUIText("ui.replacement.confirmActionCost", {
          sourceName,
          cardName: targetName,
        });
      const wantsToReplace =
        (await game.ui?.showConfirmPrompt?.(prompt, {
          kind: "destruction_replacement",
          cardName: targetName,
        })) ?? false;
      if (!wantsToReplace) {
        return false;
      }
    }

    const costCtx = buildActionCostCtx();
    const costResult = await engine.applyActions(costActions, costCtx, {});
    if (costResult?.needsSelection) {
      return { ...costResult, success: false };
    }
    return (
      costResult === true ||
      (costResult &&
        typeof costResult === "object" &&
        costResult.success !== false)
    );
  };

  const runFollowUpActions = async () => {
    const followUpActions = Array.isArray(effect.actions) ? effect.actions : [];
    if (followUpActions.length === 0) return;
    const engine = game.effectEngine;
    if (!engine || typeof engine.applyActions !== "function") return;
    const opponent =
      typeof game.getOpponent === "function"
        ? game.getOpponent(sourceOwner)
        : null;
    const followUpCtx = {
      player: sourceOwner,
      opponent,
      source: sourceCard,
      destroyed: card,
      destroyedOwner: ownerPlayer,
      cause,
      activationContext: { source: sourceCard, player: sourceOwner },
    };

    const resolvedTargets = {};
    const declaredTargets = Array.isArray(effect.targets) ? effect.targets : [];

    // Resolve declared targets for the follow-up actions. Replacement effects
    // are not eligible to use the standard chain selection flow, so we run a
    // simplified, synchronous-ish selection here:
    //  - bot/AI source: auto-pick from candidates (deterministic).
    //  - human source: open a manual field-targeting prompt.
    for (const targetSpec of declaredTargets) {
      if (!targetSpec || !targetSpec.id) continue;

      const ownerKey = targetSpec.owner || "self";
      const targetOwner =
        ownerKey === "opponent"
          ? opponent
          : ownerKey === "self"
            ? sourceOwner
            : null;
      if (!targetOwner) continue;

      const zones = Array.isArray(targetSpec.zones)
        ? targetSpec.zones
        : targetSpec.zone
          ? [targetSpec.zone]
          : ["field"];

      const candidates = [];
      for (const zoneName of zones) {
        if (zoneName === "fieldSpell") {
          if (targetOwner.fieldSpell) candidates.push(targetOwner.fieldSpell);
          continue;
        }
        const arr = targetOwner[zoneName];
        if (Array.isArray(arr)) candidates.push(...arr);
      }

      const filtered = candidates.filter((cand) => {
        if (!cand) return false;
        if (targetSpec.requireFaceup && cand.isFacedown) return false;
        if (targetSpec.cardKind && cand.cardKind !== targetSpec.cardKind) return false;
        return true;
      });

      const minCount = targetSpec.count?.min ?? 1;
      const maxCount = targetSpec.count?.max ?? minCount;

      if (filtered.length < minCount) {
        resolvedTargets[targetSpec.id] = [];
        continue;
      }

      let chosen;
      const sourceIsHuman = sourceOwner?.controllerType === "human";
      if (sourceIsHuman) {
        chosen = await askHumanToSelectReplacementTargets({
          game,
          sourceCard,
          targetSpec,
          targetOwner,
          candidates: filtered,
          zones,
          minCount,
          maxCount: Math.min(maxCount, filtered.length),
        });
      } else if (ownerKey === "opponent") {
        chosen = [...filtered]
          .sort((a, b) => (b.atk || 0) - (a.atk || 0))
          .slice(0, Math.min(maxCount, filtered.length));
      } else {
        chosen = filtered.slice(0, Math.min(maxCount, filtered.length));
      }

      resolvedTargets[targetSpec.id] = chosen;
    }

    try {
      await engine.applyActions(followUpActions, followUpCtx, resolvedTargets);
    } catch (err) {
      console.error("[tryReplacement] Follow-up actions failed:", err);
    }
  };

  const costCount = replacement.costCount ?? 0;
  const hasActionCosts =
    Array.isArray(replacement.costActions) &&
    replacement.costActions.length > 0;
  if (hasActionCosts && costCount === 0) {
    const costPaid = await runReplacementCostActions();
    if (costPaid?.needsSelection) {
      return {
        ...costPaid,
        replaced: false,
      };
    }
    if (!costPaid) {
      return { replaced: false };
    }

    game.markOncePerTurnUsed(sourceCard, sourceOwner, effect);
    markOncePerDuelUsedIfNeeded();
    const logMessage = formatReplacementText(
      replacement.logMessage,
      card.name,
      sourceCard.name,
    );
    if (logMessage) {
      game.ui?.log?.(logMessage);
    } else {
      game.ui?.log?.(
        `${card.name} avoided destruction due to ${sourceCard.name}.`,
      );
    }
    await runFollowUpActions();
    return { replaced: true };
  }

  if (replacement.auto === true || costCount === 0) {
    game.markOncePerTurnUsed(sourceCard, sourceOwner, effect);
    markOncePerDuelUsedIfNeeded();
    const logMessage = formatReplacementText(
      replacement.logMessage,
      card.name,
      sourceCard.name,
    );
    if (logMessage) {
      game.ui?.log?.(logMessage);
    } else {
      game.ui?.log?.(
        `${card.name} avoided destruction due to ${sourceCard.name}.`,
      );
    }
    await runFollowUpActions();
    return { replaced: true };
  }

  const costOwnerKey = replacement.costOwner || "source";
  const costOwner = costOwnerKey === "target" ? ownerPlayer : sourceOwner;

  if (!costOwner) {
    return { replaced: false };
  }

  const costFilters = replacement.costFilters || {};
  const filterCandidates = (candidate) => {
    if (!candidate || candidate === card) return false;

    if (costFilters.cardKind && candidate.cardKind !== costFilters.cardKind)
      return false;

    if (costFilters.archetype) {
      const hasArchetype =
        candidate.archetype === costFilters.archetype ||
        (Array.isArray(candidate.archetypes) &&
          candidate.archetypes.includes(costFilters.archetype));
      if (!hasArchetype) return false;
    }

    if (costFilters.name && candidate.name !== costFilters.name)
      return false;

    return true;
  };

  const costZones = getReplacementCostZones(replacement);
  const candidateEntries = collectReplacementCostCandidates(
    game,
    costOwner,
    costZones,
    filterCandidates,
  );
  const candidates = candidateEntries.map((entry) => entry.card);

  if (candidates.length < costCount) {
    return { replaced: false };
  }

  const costDestination = normalizeReplacementCostDestination(
    replacement.costDestination,
  );
  const costActionText = getCostActionText(costDestination);

  // AI auto-selection (lowest ATK for cost). Bot Arena can place an AI in the
  // "player" seat, so controllerType is the reliable human/AI boundary.
  if (costOwner.controllerType !== "human") {
    const chosen = [...candidates]
      .sort((a, b) => (a.atk || 0) - (b.atk || 0))
      .slice(0, costCount);

    const costMoveResult = await moveReplacementCostCards({
      game,
      cards: chosen,
      costOwner,
      costZones,
      candidateEntries,
      costDestination,
      sourceCard,
      effect,
    });
    if (costMoveResult?.needsSelection) {
      return {
        ...costMoveResult,
        replaced: false,
      };
    }
    if (!costMoveResult.success) {
      return { replaced: false };
    }

    game.markOncePerTurnUsed(sourceCard, sourceOwner, effect);
    markOncePerDuelUsedIfNeeded();

    const costNames = chosen.map((c) => c.name).join(", ");
    const logMessage = formatReplacementText(
      replacement.logMessage,
      card.name,
      sourceCard.name,
    );
    if (logMessage) {
      game.ui?.log?.(logMessage);
    } else {
      game.ui?.log?.(
        `${card.name} avoided destruction by ${costActionText.logVerb} ${costNames}${costActionText.logDestination}.`,
      );
    }
    return { replaced: true };
  }

  const costDescription = getCostTypeDescription(costFilters, costCount);
  const targetName = getCardDisplayName(card) || card.name;
  const sourceName = getCardDisplayName(sourceCard) || sourceCard.name;
  const prompt =
    formatReplacementText(replacement.prompt, targetName, sourceName) ||
    getUIText("ui.replacement.confirmCost", {
      verb: costActionText.verb,
      count: costCount,
      costDescription,
      suffix: costActionText.suffix,
      cardName: targetName,
    });

  const wantsToReplace =
    (await game.ui?.showConfirmPrompt?.(prompt, {
      kind: "destruction_replacement",
      cardName: targetName,
    })) ?? false;
  if (!wantsToReplace) {
    return { replaced: false };
  }

  const selectionMessage =
    formatReplacementText(
      replacement.selectionMessage,
      targetName,
      sourceName,
    ) ||
    getUIText("ui.replacement.chooseCost", {
      count: costCount,
      cardWord: getCostKindLabel("card", costCount),
      selectionVerb: costActionText.selectionVerb,
      cardName: targetName,
    });

  let selections = [];
  if (
    typeof game.startTargetSelectionSession === "function" &&
    typeof game.buildSelectionCandidateKey === "function"
  ) {
    selections = await askHumanToSelectReplacementTargets({
      game,
      sourceCard,
      targetSpec: {
        id: "replacement_cost",
        owner: "self",
        message: selectionMessage,
      },
      targetOwner: costOwner,
      candidates,
      zones: costZones,
      minCount: costCount,
      maxCount: costCount,
    });
  } else if (
    costZones.length === 1 &&
    typeof game.askPlayerToSelectCards === "function"
  ) {
    selections = await game.askPlayerToSelectCards({
      owner: "player",
      zone: costZones[0],
      min: costCount,
      max: costCount,
      filter: filterCandidates,
      message: selectionMessage,
    });
  }

  if (!selections || selections.length < costCount) {
    game.ui.log(getUIText("ui.replacement.protectionCancelled"));
    return { replaced: false };
  }

  const costMoveResult = await moveReplacementCostCards({
    game,
    cards: selections,
    costOwner,
    costZones,
    candidateEntries,
    costDestination,
    sourceCard,
    effect,
  });
  if (costMoveResult?.needsSelection) {
    return {
      ...costMoveResult,
      replaced: false,
    };
  }
  if (!costMoveResult.success) {
    return { replaced: false };
  }

  game.markOncePerTurnUsed(sourceCard, sourceOwner, effect);
  markOncePerDuelUsedIfNeeded();

  const costNames = selections.map((c) => c.name).join(", ");
  const logMessage = formatReplacementText(
    replacement.logMessage,
    card.name,
    sourceCard.name,
  );
  if (logMessage) {
    game.ui?.log?.(logMessage);
  } else {
    game.ui.log(
      `${card.name} avoided destruction by ${costActionText.logVerb} ${costNames}${costActionText.logDestination}.`,
    );
  }
  return { replaced: true };
}

function collectSources(player) {
  if (!player) return [];
  const field = Array.isArray(player.field) ? player.field : [];
  const spellTrap = Array.isArray(player.spellTrap) ? player.spellTrap : [];
  const fieldSpell = player.fieldSpell ? [player.fieldSpell] : [];
  const hand = Array.isArray(player.hand)
    ? player.hand.filter((card) =>
        (card?.effects || []).some(
          (effect) => effect?.replacementEffect && effect.requireZone === "hand",
        ),
      )
    : [];
  return [...field, ...spellTrap, ...fieldSpell, ...hand].filter(Boolean);
}

export async function resolveDestructionWithReplacement(card, options = {}) {
  if (!card) {
    return { replaced: false };
  }

  const ownerPlayer = card.owner === "player" ? this.player : this.bot;
  if (!ownerPlayer) {
    return { replaced: false };
  }

  const cause = options.cause || options.reason || "effect";
  const fromZone =
    options.fromZone ||
    this.effectEngine?.findCardZone?.(ownerPlayer, card) ||
    null;
  const destructionSourceCard = options.sourceCard || options.source || null;
  const destructionSourcePlayer =
    options.sourcePlayer ||
    (destructionSourceCard?.owner === "player"
      ? this.player
      : destructionSourceCard?.owner === "bot"
        ? this.bot
        : null);

  // Check for Equip Spell protection (e.g., Crescent Shield Guard)
  if (cause === "battle" && card.cardKind === "monster") {
    const guardEquip = (card.equips || []).find(
      (equip) =>
        equip && equip.grantsCrescentShieldGuard && equip.equippedTo === card,
    );

    if (guardEquip) {
      this.ui.log(
        `${guardEquip.name} was destroyed to protect ${card.name}.`,
      );
      const guardResult = await this.destroyCard(guardEquip, {
        cause,
        sourceCard: card,
        opponent: this.getOpponent(ownerPlayer),
        fromZone: "spellTrap",
      });
      if (guardResult?.destroyed) {
        guardEquip.grantsCrescentShieldGuard = false;
        return { replaced: true };
      }
      return { replaced: false };
    }
  }

  const ctx = {
    card,
    cause,
    fromZone,
    ownerPlayer,
    sourceCard: destructionSourceCard,
    sourcePlayer: destructionSourcePlayer,
  };

  const sourcePool = [
    ...collectSources(ownerPlayer),
    ...collectSources(this.getOpponent(ownerPlayer)),
  ];

  const currentTurn = this.turnCounter;
  if (Array.isArray(this.temporaryReplacementEffects)) {
    this.temporaryReplacementEffects =
      this.temporaryReplacementEffects.filter((entry) => {
        if (!entry) return false;
        if (
          Number.isFinite(entry.expiresOnTurn) &&
          currentTurn > entry.expiresOnTurn
        ) {
          return false;
        }
        if (
          Number.isFinite(entry.usesRemaining) &&
          entry.usesRemaining <= 0
        ) {
          return false;
        }
        return true;
      });

    for (const entry of this.temporaryReplacementEffects) {
      const sourceOwner =
        entry.ownerId === this.player.id ? this.player : this.bot;
      if (!sourceOwner) continue;
      const sourceCard = {
        name: entry.sourceName || "Temporary Effect",
        owner: sourceOwner.id,
        isFacedown: false,
      };
      const effect = {
        replacementEffect: entry.replacementEffect,
        requireFaceup: false,
      };
      const targetKey = getReplacementTargetKey(card);
      if (
        entry.usesPerTarget === true &&
        ((targetKey &&
          Array.isArray(entry.usedTargetKeys) &&
          entry.usedTargetKeys.includes(targetKey)) ||
          (!targetKey &&
            Array.isArray(entry.usedTargetCards) &&
            entry.usedTargetCards.includes(card)))
      ) {
        continue;
      }
      const result = await tryReplacement(this, sourceCard, sourceOwner, effect, ctx);
      if (result?.replaced) {
        if (entry.usesPerTarget === true) {
          if (!Array.isArray(entry.usedTargetKeys)) {
            entry.usedTargetKeys = [];
          }
          if (!Array.isArray(entry.usedTargetCards)) {
            entry.usedTargetCards = [];
          }
          if (targetKey) {
            entry.usedTargetKeys.push(targetKey);
          } else {
            entry.usedTargetCards.push(card);
          }
        } else if (Number.isFinite(entry.usesRemaining)) {
          entry.usesRemaining -= 1;
        }
        if (
          Number.isFinite(entry.usesRemaining) &&
          entry.usesRemaining <= 0
        ) {
          this.temporaryReplacementEffects =
            this.temporaryReplacementEffects.filter((e) => e !== entry);
        }
        return result;
      }
    }
  }

  for (const sourceCard of sourcePool) {
    const sourceOwner =
      sourceCard.owner === "player" ? this.player : this.bot;
    if (!sourceOwner) continue;
    const effects = sourceCard.effects || [];
    for (const effect of effects) {
      if (!effect?.replacementEffect) continue;
      const result = await tryReplacement(this, sourceCard, sourceOwner, effect, ctx);
      if (result?.replaced) {
        return result;
      }
    }
  }

  return { replaced: false };
}
