/**
 * resolution.js
 *
 * Chain resolution extracted from ChainSystem.js.
 * Resolves the chain stack in LIFO order. The 181-line `resolveChainLink`
 * monolith was split into three private phases for readability:
 *
 *   prepareForResolution(cs, link) → bool ("can we resolve?")
 *   applyChainEffect(cs, link, activationZone) → void
 *   cleanupAfterResolution(cs, link) → void
 *
 * Public methods (bound via prototype on ChainSystem):
 *  - resolveChain
 *  - resolveChainLink
 *  - isCardStillValid
 *  - determineCardZone
 */

import { isAI } from "../Player.js";
import { cardMatchesKind } from "../Card.js";
import { isQuickSpell } from "../game/spellTrap/quickSpellRules.js";
import {
  applySpellTrapFinalizationOverride,
  finalizeNegatedSpellTrapActivation,
} from "../game/spellTrap/finalization.js";

export async function resolveChain() {
  if (this.chainStack.length === 0) {
    this.log("No chain to resolve");
    return { success: true, needsSelection: false };
  }

  this.isResolving = true;
  this.log(`Resolving chain with ${this.chainStack.length} links`);

  const ui = this.getUI();
  let result = { success: true, needsSelection: false };

  try {
    while (this.chainStack.length > 0) {
      const link = this.chainStack.pop();

      if (!link) continue;

      this.log(`Resolving Chain Link ${link.chainLevel}: ${link.card.name}`);

      if (ui?.log) {
        ui.log(`Resolving: ${link.card.name}`);
      }

      try {
        result = await this.resolveChainLink(link);
        if (result?.needsSelection) {
          this.pendingChainSelection = {
            link,
            selectionContract: result.selectionContract || null,
            selectionSource: result.selectionSource || "actions",
            baseTargets: result.baseTargets || null,
          };
          this.log(
            `${link.card.name} paused chain resolution for target selection.`,
          );
          return {
            ...result,
            success: false,
            needsSelection: true,
            pendingChainSelection: true,
          };
        }
      } catch (error) {
        console.error(
          `[ChainSystem] Error resolving ${link.card.name}:`,
          error,
        );
        result = {
          success: false,
          needsSelection: false,
          reason: error.message || "Chain link failed.",
          error,
        };
      }
    }
  } finally {
    this.isResolving = false;
  }

  this.log("Chain resolution complete");
  return result || { success: true, needsSelection: false };
}

export async function resolveChainLink(link) {
  const { card, player, effect } = link;

  if (!card || !player || !effect) {
    this.log("Invalid chain link, skipping");
    return;
  }

  this.cardsBeingResolved.add(card);

  const activationZone = link.zone || "spellTrap";

  try {
    if (link.negated || link.context?.negatedLink === link) {
      const ui = this.getUI();
      this.log(`${card.name}'s activation was negated.`);
      ui?.log?.(`${card.name}'s activation was negated.`);
      await finalizeNegatedSpellTrapActivation(
        this.game,
        card,
        player,
        activationZone,
        { activationContext: link.activationContext || link.context || null },
      );
      const negatedResult = {
        success: true,
        needsSelection: false,
        negated: true,
      };
      await completePreparedPipeline(link, negatedResult);
      return negatedResult;
    }
    const shouldPresentSpellTrapFlip =
      activationZone === "spellTrap" &&
      card.isFacedown === true &&
      (card.cardKind === "spell" || card.cardKind === "trap");
    if (!(await prepareForResolution(this, link, activationZone))) {
      const fizzledResult = {
        success: false,
        needsSelection: false,
        fizzled: true,
      };
      await completePreparedPipeline(link, fizzledResult);
      return fizzledResult;
    }
    if (shouldPresentSpellTrapFlip) {
      await this.game?.presentSpellTrapActivationFlip?.(
        card,
        player,
        activationZone,
      );
    }
    const applyResult = await applyChainEffect(this, link, activationZone);
    if (applyResult?.needsSelection) {
      return {
        ...applyResult,
        success: false,
        needsSelection: true,
        activationZone,
      };
    }
    await cleanupAfterResolution(this, link, {
      actionSucceeded: applyResult?.success !== false,
      activationContext: applyResult?.activationContext || link.activationContext,
    });
    const completedResult = applyResult || {
      success: true,
      needsSelection: false,
    };
    await completePreparedPipeline(link, completedResult);
    return completedResult;
  } catch (error) {
    await completePreparedPipeline(link, {
      success: false,
      needsSelection: false,
      reason: error?.message || "Chain link failed.",
      error,
    });
    throw error;
  } finally {
    this.cardsBeingResolved.delete(card);
  }
}

export function startPendingChainSelection(result = {}) {
  const pending = this.pendingChainSelection;
  const contract = result.selectionContract || pending?.selectionContract;
  if (!pending || !contract || !this.game?.startTargetSelectionSession) {
    return false;
  }

  const link = pending.link;
  return new Promise((resolve) => {
    let finished = false;
    const finishOnce = (value) => {
      if (finished) return;
      finished = true;
      resolve(value);
    };

    this.game.startTargetSelectionSession({
      kind: contract.kind || "chain",
      card: link.card,
      owner: link.player,
      selectionContract: contract,
      message:
        contract.message ||
        `Select target(s) for ${link.card?.name || "chain"}`,
      preventCancel: contract.ui?.preventCancel,
      allowCancel: contract.ui?.allowCancel,
      execute: async (selections) => {
        const nextResult = await this.resumePendingChainSelection(selections);
        if (!nextResult?.needsSelection) {
          finishOnce(nextResult);
        }
        return nextResult;
      },
      onResult: (nextResult) => {
        if (nextResult?.needsSelection) {
          const nested = this.startPendingChainSelection(nextResult);
          if (nested && typeof nested.then === "function") {
            nested.then(finishOnce);
          }
          return;
        }
        finishOnce(nextResult);
      },
      onCancel: () => {
        this.pendingChainSelection = null;
        this.isResolving = false;
        this.chainWindowOpen = false;
        this.chainWindowContext = null;
        this.chainStack = [];
        this.currentChainLevel = 0;
        this.cardsBeingResolved.clear();
        this.chainEventCompletions = [];
        finishOnce({
          success: false,
          needsSelection: false,
          cancelled: true,
          reason: "Chain selection cancelled.",
        });
      },
    });
  });
}

export async function resumePendingChainSelection(selections = {}) {
  const pending = this.pendingChainSelection;
  if (!pending?.link) {
    return {
      success: false,
      needsSelection: false,
      reason: "No pending chain selection.",
    };
  }

  this.pendingChainSelection = null;
  const link = pending.link;

  if (pending.selectionSource === "chain_targets") {
    const resolvedSelections = resolveChainSelectionCards(
      this,
      selections,
      pending.selectionContract,
      link.player,
    );
    link.selections = {
      ...(pending.baseTargets || {}),
      ...resolvedSelections,
    };
  } else if (
    pending.selectionSource === "effect_targeted" &&
    this.game?.pendingEventSelection &&
    typeof this.game.resumePendingEventSelection === "function"
  ) {
    const eventResult = await this.game.resumePendingEventSelection(selections);
    if (eventResult?.needsSelection) {
      this.pendingChainSelection = {
        link,
        selectionContract: eventResult.selectionContract || null,
        selectionSource: "effect_targeted",
        baseTargets: pending.baseTargets || null,
      };
      return {
        ...eventResult,
        success: false,
        needsSelection: true,
        pendingChainSelection: true,
      };
    }
    link.effectTargetedResolved = true;
  } else {
    link.selections = link.selections || selections;
  }

  const linkResult = await this.resolveChainLink(link);
  if (linkResult?.needsSelection) {
    this.pendingChainSelection = {
      link,
      selectionContract: linkResult.selectionContract || null,
      selectionSource: linkResult.selectionSource || "actions",
      baseTargets: linkResult.baseTargets || null,
    };
    return {
      ...linkResult,
      success: false,
      needsSelection: true,
      pendingChainSelection: true,
    };
  }

  const remainingResult =
    this.chainStack.length > 0
      ? await this.resolveChain()
      : { success: true, needsSelection: false };
  if (remainingResult?.needsSelection) {
    return remainingResult;
  }

  await this.completeActivationTriggerPackages?.();

  this.chainWindowOpen = false;
  this.chainWindowContext = null;
  this.chainStack = [];
  this.currentChainLevel = 0;
  this.cardsBeingResolved.clear();
  this.log("Chain resolution complete after selection");
  if (typeof this.game?.flushPendingChainEvents === "function") {
    const eventFlushResult = await this.game.flushPendingChainEvents({
      reason: "chain_selection_resolved",
    });
    if (eventFlushResult?.needsSelection) {
      return eventFlushResult;
    }
  }
  return remainingResult;
}

function resolveChainSelectionCards(cs, selections, contract, player) {
  const hasCardArrays = Object.values(selections || {}).some(
    (value) =>
      Array.isArray(value) &&
      value.some((entry) => entry && typeof entry === "object"),
  );
  if (hasCardArrays) {
    return selections || {};
  }

  if (typeof cs.resolveSelectionsToCards === "function") {
    return cs.resolveSelectionsToCards(
      selections || {},
      contract?.requirements || [],
      player,
    );
  }
  return selections || {};
}

/**
 * Phase 1 — preparation.
 * Verifies effect engine + card validity, reveals face-down spells/traps,
 * relocates Quick Spells from hand to spellTrap zone.
 * Returns false if resolution must abort (fizzle).
 */
async function prepareForResolution(cs, link, activationZone) {
  const { card, player } = link;
  const effectEngine = cs.game?.effectEngine;

  if (!effectEngine) {
    cs.log("No effect engine available");
    return false;
  }

  const requiresSource =
    link.prepared === true
      ? link.requiresSourceAtResolution === true
      : true;
  if (
    requiresSource &&
    !cs.isCardStillValid(card, player, activationZone)
  ) {
    cs.log(
      `${card.name} is no longer valid in ${activationZone}, effect fizzles`,
    );
    const ui = cs.getUI();
    if (ui?.log) {
      ui.log(`${card.name}'s effect fizzles (card is no longer available).`);
    }
    return false;
  }

  if (link.prepared !== true && card.cardKind === "trap" && card.isFacedown) {
    card.isFacedown = false;
  }
  if (
    link.prepared !== true &&
    card.cardKind === "spell" &&
    card.isFacedown &&
    activationZone === "spellTrap"
  ) {
    card.isFacedown = false;
  }

  if (
    link.prepared !== true &&
    isQuickSpell(card) &&
    activationZone === "hand"
  ) {
    const moveResult = await cs.game?.moveCard?.(card, player, "spellTrap", {
      fromZone: "hand",
      sourceCard: card,
      effectId: link.effect?.id || null,
      contextLabel: "chain_activation",
    });
    if (moveResult?.success === false || !player.spellTrap?.includes(card)) {
      cs.log(`${card.name} could not enter the Spell/Trap Zone.`);
      return false;
    }
  }

  return true;
}

/**
 * Phase 2 — effect application.
 * Builds resolution context, resolves targets if not pre-selected,
 * and runs the action list. Errors are logged but do not propagate
 * (chain resolution must continue for remaining links).
 */
async function applyChainEffect(cs, link, activationZone) {
  const { card, player, effect, selections } = link;
  const effectEngine = cs.game.effectEngine;
  const inheritedActivationContext = link.context?.activationContext || {};

  const ctx = {
    source: card,
    sourceCard: card,
    effect,
    effectId: effect?.id || null,
    player,
    opponent: cs.getOpponent(player),
    activationZone,
    defender: link.context?.defender || link.context?.target,
    target: link.context?.target || link.context?.defender || null,
    attacker: link.context?.attacker,
    attackerOwner: link.context?.attackerOwner,
    defenderOwner: link.context?.defenderOwner,
    targetOwner: link.context?.targetOwner,
    destroyed: link.context?.destroyed || null,
    destroyedOwner: link.context?.destroyedOwner || null,
    destroyedOwnerId: link.context?.destroyedOwnerId || null,
    destroyedPosition: link.context?.destroyedPosition || null,
    battleDestroyer: link.context?.battleDestroyer || link.context?.attacker || null,
    battleDestroyers: Array.isArray(link.context?.battleDestroyers)
      ? link.context.battleDestroyers
      : [link.context?.battleDestroyer || link.context?.attacker].filter(Boolean),
    summonedCard: link.context?.summonedCard || link.context?.card || null,
    summonMethod: link.context?.method || link.context?.summonMethod || null,
    summonFromZone: link.context?.fromZone || null,
    actionContext: link.context || null,
    activationContext: {
      ...inheritedActivationContext,
      chainLevel: link.chainLevel,
      effectId: effect?.id || null,
      sourceZone: activationZone,
      chainContext: link.context?.type || null,
      context: link.context || null,
      event: link.context?.event || null,
      autoSelectSingleTarget: true,
      autoSelectTargets: isAI(player),
      _effectTargetedResolved: link.effectTargetedResolved === true,
      actionContext: {
        ...(inheritedActivationContext.actionContext || {}),
        chainContext: link.context?.type || null,
        event: link.context?.event || null,
      },
    },
  };
  link.activationContext = ctx.activationContext;

  let resolvedSelections = selections;
  if (!resolvedSelections || Object.keys(resolvedSelections).length === 0) {
    const targetResult = effectEngine.resolveTargets(
      effect.targets || [],
      ctx,
      null,
    );
    if (targetResult.ok !== false && targetResult.targets) {
      resolvedSelections = targetResult.targets;
    } else if (targetResult.needsSelection) {
      cs.log(
        `${card.name} requires selection but none provided, effect may fail`,
      );
      return {
        success: false,
        needsSelection: true,
        selectionContract: targetResult.selectionContract,
        selectionSource: "chain_targets",
        baseTargets: targetResult.targets || {},
        reason: "Chain link requires target selection.",
      };
    } else {
      return {
        success: false,
        reason: targetResult.reason || "Chain link targets are invalid.",
      };
    }
  }

  notifyChainActivation(cs, link, activationZone, resolvedSelections);

  const resolutionActions =
    typeof cs.getEffectResolutionActions === "function"
      ? cs.getEffectResolutionActions(effect)
      : effect.actions || [];
  if (Array.isArray(resolutionActions)) {
    try {
      const actionsResult = await effectEngine.applyActions(
        resolutionActions,
        ctx,
        resolvedSelections || {},
      );
      if (actionsResult?.needsSelection) {
        return {
          ...actionsResult,
          success: false,
          selectionSource: actionsResult.selectionSource || "actions",
        };
      }
      if (
        actionsResult &&
        typeof actionsResult === "object" &&
        actionsResult.success === false
      ) {
        cs.log(
          `Chain resolution failed for ${card.name} (CL${link.chainLevel}): ${
            actionsResult.reason || "effect actions failed"
          }`,
        );
        return {
          ...actionsResult,
          selectionSource:
            actionsResult.selectionSource ||
            (actionsResult.needsSelection ? "actions" : null),
        };
      }
    } catch (error) {
      const linkContext = {
        cardName: card?.name || "Unknown",
        cardId: card?.id,
        effectId: effect?.id || "unknown",
        effectTiming: effect?.timing,
        chainLevel: link.chainLevel,
        activationZone,
        player: player?.id,
        actionsCount: resolutionActions.length,
        actionTypes: resolutionActions.map((a) => a?.type).filter(Boolean),
      };
      console.error(
        `[ChainSystem] Action error resolving chain link:`,
        linkContext,
        error,
      );
      cs.log(
        `Chain resolution failed for ${linkContext.cardName} (CL${linkContext.chainLevel}):`,
        error.message,
      );
      return {
        success: false,
        reason: error.message || "Chain link actions failed.",
        error,
      };
    }
  }

  if (
    card.cardKind === "spell" &&
    typeof effectEngine.handleBlueprintStorageAfterResolution === "function"
  ) {
    await effectEngine.handleBlueprintStorageAfterResolution(
      card,
      effect,
      ctx,
    );
  }

  cs.game?.checkWinCondition?.();

  return { success: true, activationContext: ctx.activationContext };
}

/**
 * Chain activation telemetry.
 * Emits compact strategic events for chain-resolved activations.
 */
function getChainActivationEventName(card) {
  if (cardMatchesKind(card, "spell")) return "spell_activated";
  if (cardMatchesKind(card, "trap")) return "trap_activated";
  return "effect_activated";
}

function flattenSelectionCards(selections) {
  const cards = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === "object" && value.card) {
      visit(value.card);
      return;
    }
    if (typeof value === "object" && (value.name || value.cardName)) {
      cards.push(value);
    }
  };

  for (const value of Object.values(selections || {})) {
    visit(value);
  }
  return cards;
}

function compactSelectedTarget(card) {
  if (!card) return null;
  return {
    id: card.id ?? null,
    name: card.name || card.cardName || null,
    owner: card.owner || null,
    zone: card.zone || null,
    position: card.position || null,
  };
}

function notifyChainActivation(cs, link, activationZone, resolvedSelections) {
  if (link?.activationPublished === true) return;
  const game = cs.game;
  if (typeof game?.notify !== "function") return;

  const { card, player, effect } = link;
  const selectedCards = flattenSelectionCards(resolvedSelections);
  const selectedTargets = selectedCards.map(compactSelectedTarget).filter(Boolean);
  const eventName = getChainActivationEventName(card);

  game.notify(eventName, {
    card,
    source: card,
    sourceCard: card,
    player,
    owner: player,
    effect,
    effectId: effect?.id || null,
    effectType: effect?.timing || "chain",
    activationZone,
    fromZone: activationZone,
    fromHand: activationZone === "hand",
    chainLevel: link.chainLevel,
    chainContext: link.context?.type || null,
    trigger: link.context?.event || null,
    target: selectedCards[0] || null,
    targets: selectedCards,
    selectedTargets,
    selectedCount: selectedTargets.length,
    activationContext: {
      chainLevel: link.chainLevel,
      effectId: effect?.id || null,
      sourceZone: activationZone,
      chainContext: link.context?.type || null,
      event: link.context?.event || null,
    },
  });

  if (selectedTargets.length > 0) {
    game.notify("target_selected", {
      player,
      source: card,
      sourceCard: card,
      effect,
      effectId: effect?.id || null,
      targets: selectedCards,
      selectedTargets,
      selectedCount: selectedTargets.length,
    });
  }
}

/**
 * Sends non-continuous traps and Quick Spells to graveyard,
 * registers once-per-turn usage, and refreshes the board.
 */
async function cleanupAfterResolution(
  cs,
  link,
  { actionSucceeded = true, activationContext = null } = {},
) {
  const { card, player, effect } = link;
  const effectEngine = cs.game.effectEngine;
  const finalizationOverridden =
    link.skipDefaultFinalization !== true &&
    actionSucceeded &&
    applySpellTrapFinalizationOverride.call(
      cs.game,
      card,
      player,
      "spellTrap",
      { activationContext },
    );

  if (
    link.skipDefaultFinalization !== true &&
    !finalizationOverridden &&
    card.cardKind === "trap" &&
    card.subtype !== "continuous"
  ) {
    if (player.spellTrap?.includes(card)) {
      await cs.game?.moveCard?.(card, player, "graveyard", {
        fromZone: "spellTrap",
        sourceCard: card,
        effectId: effect?.id || null,
        contextLabel: "chain_resolution_cleanup",
      });
      cs.log(`${card.name} sent to graveyard after resolution`);
    }
  }

  if (
    link.skipDefaultFinalization !== true &&
    !finalizationOverridden &&
    isQuickSpell(card)
  ) {
    if (player.spellTrap?.includes(card)) {
      await cs.game?.moveCard?.(card, player, "graveyard", {
        fromZone: "spellTrap",
        sourceCard: card,
        effectId: effect?.id || null,
        contextLabel: "chain_resolution_cleanup",
      });
      cs.log(`${card.name} sent to graveyard after resolution`);
    }
  }

  if (
    link.skipUsageRegistration !== true &&
    effect.oncePerTurn &&
    actionSucceeded
  ) {
    if (cs.game?.registerOncePerTurnUsage) {
      cs.game.registerOncePerTurnUsage(card, player, effect);
    } else if (effectEngine?.registerOncePerTurnUsage) {
      effectEngine.registerOncePerTurnUsage(card, player, effect);
    }
  } else if (
    link.skipUsageRegistration !== true &&
    effect.oncePerTurn &&
    !actionSucceeded
  ) {
    cs.log(
      `${card.name}'s once-per-turn use was not registered because resolution failed.`,
    );
  }

  cs.game?.updateBoard?.();
}

export function isCardStillValid(card, player, zone) {
  if (!card || !player) return false;

  const checkZone = zone || "spellTrap";

  if (checkZone === "spellTrap") {
    return player.spellTrap?.includes(card) === true;
  }
  if (checkZone === "hand") {
    return player.hand?.includes(card) === true;
  }
  if (checkZone === "field") {
    return player.field?.includes(card) === true;
  }
  if (checkZone === "graveyard") {
    return player.graveyard?.includes(card) === true;
  }
  if (checkZone === "fieldSpell") {
    return player.fieldSpell === card;
  }
  if (checkZone === "banished" || checkZone === "banish") {
    return player.banished?.includes(card) === true;
  }

  return true;
}

async function completePreparedPipeline(link, result) {
  if (
    link?.pipelineCompletionDone === true ||
    typeof link?.pipelineCompletion !== "function"
  ) {
    return;
  }
  link.pipelineCompletionDone = true;
  await link.pipelineCompletion(result);
}

export function determineCardZone(card, player) {
  if (!card || !player) return "unknown";

  if (player.hand?.includes(card)) return "hand";
  if (player.field?.includes(card)) return "field";
  if (player.spellTrap?.includes(card)) return "spellTrap";
  if (player.graveyard?.includes(card)) return "graveyard";
  if (player.banished?.includes(card)) return "banished";
  if (player.fieldSpell === card) return "fieldSpell";

  return "unknown";
}
