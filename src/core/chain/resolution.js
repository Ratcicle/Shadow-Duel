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

export async function resolveChain() {
  if (this.chainStack.length === 0) {
    this.log("No chain to resolve");
    return;
  }

  this.isResolving = true;
  this.log(`Resolving chain with ${this.chainStack.length} links`);

  const ui = this.getUI();

  while (this.chainStack.length > 0) {
    const link = this.chainStack.pop();

    if (!link) continue;

    this.log(`Resolving Chain Link ${link.chainLevel}: ${link.card.name}`);

    if (ui?.log) {
      ui.log(`Resolving: ${link.card.name}`);
    }

    try {
      await this.resolveChainLink(link);
    } catch (error) {
      console.error(
        `[ChainSystem] Error resolving ${link.card.name}:`,
        error,
      );
    }
  }

  this.isResolving = false;
  this.log("Chain resolution complete");
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
      return;
    }
    if (!prepareForResolution(this, link, activationZone)) {
      return;
    }
    await applyChainEffect(this, link, activationZone);
    cleanupAfterResolution(this, link);
  } finally {
    this.cardsBeingResolved.delete(card);
  }
}

/**
 * Phase 1 — preparation.
 * Verifies effect engine + card validity, reveals face-down spells/traps,
 * relocates quick-play spells from hand to spellTrap zone.
 * Returns false if resolution must abort (fizzle).
 */
function prepareForResolution(cs, link, activationZone) {
  const { card, player } = link;
  const effectEngine = cs.game?.effectEngine;

  if (!effectEngine) {
    cs.log("No effect engine available");
    return false;
  }

  if (!cs.isCardStillValid(card, player, activationZone)) {
    cs.log(
      `${card.name} is no longer valid in ${activationZone}, effect fizzles`,
    );
    const ui = cs.getUI();
    if (ui?.log) {
      ui.log(`${card.name}'s effect fizzles (card is no longer available).`);
    }
    return false;
  }

  if (card.cardKind === "trap" && card.isFacedown) {
    card.isFacedown = false;
  }
  if (
    card.cardKind === "spell" &&
    card.isFacedown &&
    activationZone === "spellTrap"
  ) {
    card.isFacedown = false;
  }

  if (
    card.cardKind === "spell" &&
    card.subtype === "quick" &&
    activationZone === "hand"
  ) {
    const handIdx = player.hand?.indexOf(card);
    if (handIdx !== -1) {
      player.hand.splice(handIdx, 1);
      player.spellTrap = player.spellTrap || [];
      player.spellTrap.push(card);
      cs.game?._arenaTracker?.recordZoneMove?.(
        card,
        player,
        "spellTrap",
        {
          fromZone: "hand",
          sourceCard: card,
          effectId: link.effect?.id || null,
          contextLabel: "chain_activation",
        },
        { success: true, fromZone: "hand", toZone: "spellTrap" },
      );
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

  const ctx = {
    source: card,
    sourceCard: card,
    effect,
    effectId: effect?.id || null,
    player,
    opponent: cs.getOpponent(player),
    activationZone,
    defender: link.context?.defender || link.context?.target,
    attacker: link.context?.attacker,
    attackerOwner: link.context?.attackerOwner,
    defenderOwner: link.context?.defenderOwner,
    summonedCard: link.context?.summonedCard || link.context?.card || null,
    summonMethod: link.context?.method || link.context?.summonMethod || null,
    summonFromZone: link.context?.fromZone || null,
    activationContext: {
      chainLevel: link.chainLevel,
      effectId: effect?.id || null,
      sourceZone: activationZone,
      chainContext: link.context?.type || null,
      event: link.context?.event || null,
      autoSelectSingleTarget: true,
      autoSelectTargets: isAI(player),
    },
  };

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
      resolvedSelections = {};
    }
  }

  notifyChainActivation(cs, link, activationZone, resolvedSelections);

  if (Array.isArray(effect.actions)) {
    try {
      await effectEngine.applyActions(
        effect.actions,
        ctx,
        resolvedSelections || {},
      );
    } catch (error) {
      const linkContext = {
        cardName: card?.name || "Unknown",
        cardId: card?.id,
        effectId: effect?.id || "unknown",
        effectTiming: effect?.timing,
        chainLevel: link.chainLevel,
        activationZone,
        player: player?.id,
        actionsCount: effect.actions?.length || 0,
        actionTypes: effect.actions?.map((a) => a?.type).filter(Boolean),
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
}

/**
 * Chain activation telemetry.
 * Emits compact strategic events for chain-resolved activations.
 */
function getChainActivationEventName(card) {
  if (card?.cardKind === "spell") return "spell_activated";
  if (card?.cardKind === "trap") return "trap_activated";
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
 * Sends non-continuous traps and quick-play spells to graveyard,
 * registers once-per-turn usage, and refreshes the board.
 */
function cleanupAfterResolution(cs, link) {
  const { card, player, effect } = link;
  const effectEngine = cs.game.effectEngine;

  if (card.cardKind === "trap" && card.subtype !== "continuous") {
    const idx = player.spellTrap?.indexOf(card);
    if (idx !== -1) {
      player.spellTrap.splice(idx, 1);
      player.graveyard = player.graveyard || [];
      player.graveyard.push(card);
      cs.game?._arenaTracker?.recordZoneMove?.(
        card,
        player,
        "graveyard",
        {
          fromZone: "spellTrap",
          sourceCard: card,
          effectId: effect?.id || null,
          contextLabel: "chain_resolution_cleanup",
        },
        { success: true, fromZone: "spellTrap", toZone: "graveyard" },
      );
      cs.log(`${card.name} sent to graveyard after resolution`);
    }
  }

  if (card.cardKind === "spell" && card.subtype === "quick") {
    const idx = player.spellTrap?.indexOf(card);
    if (idx !== -1) {
      player.spellTrap.splice(idx, 1);
      player.graveyard = player.graveyard || [];
      player.graveyard.push(card);
      cs.game?._arenaTracker?.recordZoneMove?.(
        card,
        player,
        "graveyard",
        {
          fromZone: "spellTrap",
          sourceCard: card,
          effectId: effect?.id || null,
          contextLabel: "chain_resolution_cleanup",
        },
        { success: true, fromZone: "spellTrap", toZone: "graveyard" },
      );
      cs.log(`${card.name} sent to graveyard after resolution`);
    }
  }

  if (effect.oncePerTurn) {
    if (cs.game?.registerOncePerTurnUsage) {
      cs.game.registerOncePerTurnUsage(card, player, effect);
    } else if (effectEngine?.registerOncePerTurnUsage) {
      effectEngine.registerOncePerTurnUsage(card, player, effect);
    }
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

  return true;
}

export function determineCardZone(card, player) {
  if (!card || !player) return "unknown";

  if (player.hand?.includes(card)) return "hand";
  if (player.field?.includes(card)) return "field";
  if (player.spellTrap?.includes(card)) return "spellTrap";
  if (player.graveyard?.includes(card)) return "graveyard";
  if (player.banished?.includes(card)) return "banished";

  return "unknown";
}
