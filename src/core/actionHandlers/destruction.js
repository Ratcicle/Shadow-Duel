/**
 * destruction.js
 *
 * Handlers for banishment and destruction effects.
 * Moved from ActionHandlers.js with identical behavior.
 */

import { isAI } from "../Player.js";
import {
  getUI,
  resolveTargetCards,
  buildFieldSelectionCandidates,
  selectCards,
} from "./shared.js";

function resolveDamagePlayerKey(entry, card, player, opponent) {
  const damagePlayer = entry?.damagePlayer || entry?.player || "opponent";
  if (damagePlayer === "self" || damagePlayer === "opponent") {
    return damagePlayer;
  }
  if (damagePlayer === "owner" || damagePlayer === "target_owner") {
    if (card?.owner === player?.id) return "self";
    if (card?.owner === opponent?.id) return "opponent";
  }
  return "opponent";
}

function resolveDamageAmount(entry, card) {
  if (Number.isFinite(entry?.amount)) {
    return Math.max(0, Math.floor(entry.amount));
  }
  const multiplier = Number.isFinite(entry?.multiplier) ? entry.multiplier : 1;
  const damageFrom = entry?.damageFrom || "target_atk";
  let base = 0;
  if (damageFrom === "target_def") {
    base = card?.def || 0;
  } else if (damageFrom === "target_level") {
    base = card?.level || 0;
  } else {
    base = card?.atk || 0;
  }
  return Math.max(0, Math.floor(base * multiplier));
}

function shouldSkipDamage(action, ctx, engine, playerKey) {
  const conditions = action?.skipDamageIf?.[playerKey];
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return false;
  }
  const targetPlayer = playerKey === "self" ? ctx.player : ctx.opponent;
  const targetOpponent = playerKey === "self" ? ctx.opponent : ctx.player;
  const condCtx = {
    ...ctx,
    player: targetPlayer,
    opponent: targetOpponent,
  };
  const result = engine.evaluateConditions(conditions, condCtx);
  return result.ok;
}

export async function handleDestroyAndDamageByTargetAtk(
  action,
  ctx,
  targets,
  engine
) {
  const { player, opponent, source } = ctx;
  const game = engine.game;

  if (!player || !opponent || !game) return false;

  const entries =
    Array.isArray(action?.entries) && action.entries.length > 0
      ? action.entries
      : action?.targetRef
      ? [{ targetRef: action.targetRef, damagePlayer: action.player }]
      : [];

  if (entries.length === 0) return false;

  const damageTotals = { self: 0, opponent: 0 };
  let destroyedAny = false;

  for (const entry of entries) {
    const targetCards = resolveTargetCards(action, ctx, targets, {
      targetRef: entry.targetRef,
      requireArray: true,
    });
    if (!targetCards.length) continue;

    const { allowed } = engine.filterCardsListByImmunity(targetCards, player, {
      actionType: action.type,
      effectType: entry.effectType || "destruction",
    });

    for (const card of allowed) {
      const result = await game.destroyCard(card, {
        cause: "effect",
        sourceCard: source || null,
        opponent,
      });

      if (!result?.destroyed) continue;

      destroyedAny = true;
      const damageKey = resolveDamagePlayerKey(entry, card, player, opponent);
      const amount = resolveDamageAmount(entry, card);
      if (amount > 0 && damageKey in damageTotals) {
        damageTotals[damageKey] += amount;
      }
    }
  }

  let dealtDamage = false;
  for (const playerKey of ["self", "opponent"]) {
    const amount = damageTotals[playerKey] || 0;
    if (amount <= 0) continue;
    if (shouldSkipDamage(action, ctx, engine, playerKey)) {
      getUI(game)?.log("Damage prevented by effect.");
      continue;
    }
    await engine.applyDamage({ player: playerKey, amount }, ctx);
    dealtDamage = true;
  }

  if ((destroyedAny || dealtDamage) && typeof game.updateBoard === "function") {
    game.updateBoard();
  }

  return destroyedAny || dealtDamage;
}

/**
 * Generic handler for banishing cards
 */
export async function handleBanish(action, ctx, targets, engine) {
  const { player } = ctx;

  const game = engine.game;

  if (!game) return false;

  const targetRef = action.targetRef;

  let resolved = targetRef ? targets?.[targetRef] : [];

  const useDestroyed =
    action.useDestroyed === true || action.type === "banish_destroyed_monster";

  if ((!Array.isArray(resolved) || resolved.length === 0) && useDestroyed) {
    resolved = ctx?.destroyed ? [ctx.destroyed] : [];
  }

  // Allow banishing the source card when targetRef is "self" and no targets were pre-resolved

  if (
    (!Array.isArray(resolved) || resolved.length === 0) &&
    targetRef === "self" &&
    ctx?.source
  ) {
    resolved = [ctx.source];
  }

  if (!Array.isArray(resolved) || resolved.length === 0) {
    getUI(game)?.log("Nenhum alvo válido para banish.");

    return false;
  }

  function removeCardFromOwnerZones(owner, card) {
    const zones = [
      "hand",

      "field",

      "graveyard",

      "deck",

      "spellTrap",

      "fieldSpell",

      "banished",
    ];

    for (const z of zones) {
      const zoneArr = owner?.[z];

      if (!Array.isArray(zoneArr)) continue;

      const idx = zoneArr.findIndex((c) => c === card);

      if (idx !== -1) {
        zoneArr.splice(idx, 1);

        return true;
      }
    }

    return false;
  }

  let banishedCount = 0;

  const opponent =
    player && typeof engine.getOpponent === "function"
      ? engine.getOpponent(player)
      : null;

  for (const tgt of resolved) {
    if (!tgt) continue;

    const fallbackOwner =
      tgt.ownerPlayer ||
      (opponent &&
      (tgt.owner === opponent.id ||
        tgt.controller === opponent.id ||
        tgt.owner === "opponent" ||
        tgt.controller === "opponent")
        ? opponent
        : player);

    const ownerPlayer =
      typeof engine.getOwnerOfCard === "function"
        ? engine.getOwnerOfCard(tgt)
        : fallbackOwner;

    if (!ownerPlayer) {
      getUI(game)?.log(`Não foi possível determinar o dono de ${tgt.name}.`);

      continue;
    }

    if (action.fromZone && !ownerPlayer[action.fromZone]?.includes(tgt)) {
      getUI(game)?.log(
        `${tgt.name} não está mais em ${action.fromZone}; não pode ser banida.`
      );

      continue;
    }

    removeCardFromOwnerZones(ownerPlayer, tgt);

    ownerPlayer.banished = ownerPlayer.banished || [];

    ownerPlayer.banished.push(tgt);

    tgt.location = "banished";

    if (ownerPlayer?.id) {
      tgt.owner = ownerPlayer.id;

      tgt.controller = ownerPlayer.id;
    }

    banishedCount += 1;

    getUI(game)?.log(`${tgt.name} foi banida.`);
  }

  if (banishedCount > 0) {
    game.updateBoard();

    return true;
  }

  return false;
}

/**
 * Handler for banishing a specific card from the graveyard as a cost.
 * This is used for destruction negation costs and similar effects.
 *
 * Action properties:
 * - cardName: name of the card to banish (required)
 * - count: number of cards to banish (default: 1)
 * - cardType: optional type filter (e.g., "Dragon")
 * - promptPlayer: whether to let player choose (default: true for multiple matches)
 */
export async function handleBanishCardFromGraveyard(
  action,

  ctx,

  targets,

  engine
) {
  const { player } = ctx;

  const game = engine.game;

  if (!player || !game) return false;

  const cardName = action.cardName;

  const cardType = action.cardType || action.type;

  const count = action.count || 1;

  // Find matching cards in the graveyard

  const graveyard = player.graveyard || [];

  let candidates = graveyard.filter((card) => {
    if (!card) return false;

    if (cardName && card.name !== cardName) return false;

    if (cardType && card.type !== cardType) return false;

    return true;
  });

  if (candidates.length < count) {
    const filterDesc = cardName || cardType || "matching card";

    getUI(game)?.log(
      `Not enough ${filterDesc} in graveyard to banish (need ${count}, found ${candidates.length}).`
    );

    return false;
  }

  // Select cards to banish

  let toBanish = [];

  if (candidates.length === count) {
    // Exactly enough cards, no choice needed

    toBanish = candidates.slice(0, count);
  } else if (action.promptPlayer !== false && player === game.player) {
    // Player can choose which cards to banish

    const ui = getUI(game);

    if (ui?.showCardSelectionPrompt) {
      const selected = await ui.showCardSelectionPrompt({
        cards: candidates,

        min: count,

        max: count,

        message: `Select ${count} card(s) to banish from graveyard as cost`,

        zone: "graveyard",
      });

      toBanish = selected || [];
    } else {
      toBanish = candidates.slice(0, count);
    }
  } else {
    // Bot or auto-select: take first matching cards

    toBanish = candidates.slice(0, count);
  }

  if (toBanish.length < count) {
    getUI(game)?.log(`Cost not paid: not enough cards selected to banish.`);

    return false;
  }

  // Perform the banish

  let banishedCount = 0;

  for (const card of toBanish) {
    const idx = player.graveyard.indexOf(card);

    if (idx !== -1) {
      player.graveyard.splice(idx, 1);

      player.banished = player.banished || [];

      player.banished.push(card);

      card.location = "banished";

      banishedCount++;

      getUI(game)?.log(`${card.name} was banished from the graveyard.`);
    }
  }

  if (banishedCount > 0) {
    game.updateBoard();

    return true;
  }

  return false;
}

/**
 * Generic handler for selective field destruction based on highest ATK
 * Implements effects like "Void Lost Throne"
 *
 * Action properties:
 * - keepPerSide: number of highest ATK monsters to keep per side (default: 1)
 * - allowTieBreak: boolean - if true, player chooses which to keep on ties (default: true)
 * - modalTitle: string - custom modal title (default: "Choose Survivor")
 * - modalSubtitle: string - custom subtitle template (default: auto-generated)
 * - modalInfoText: string - custom info text (default: "All other monsters will be destroyed.")
 *
 * Effect: Destroys all monsters on field except keepPerSide highest ATK monsters per side.
 * If there's a tie for highest ATK, the card's controller chooses which to keep.
 */
async function destroySelectiveField(action, ctx, targets, engine) {
  const { player, source } = ctx;

  const game = engine.game;

  if (!player || !game) return false;

  const opponent = game.getOpponent(player);

  if (!opponent) return false;

  const keepPerSide = Number.isFinite(action.keepPerSide)
    ? action.keepPerSide
    : 1;

  const allowTieBreak = action.allowTieBreak !== false;

  // Get all monsters on both sides

  const playerMonsters = (player.field || []).filter(
    (card) => card && card.cardKind === "monster" && !card.isFacedown
  );

  const opponentMonsters = (opponent.field || []).filter(
    (card) => card && card.cardKind === "monster" && !card.isFacedown
  );

  if (playerMonsters.length === 0 && opponentMonsters.length === 0) {
    getUI(game)?.log("No monsters on the field to destroy.");

    return false;
  }

  // Helper function to find highest ATK monsters

  const findHighestAtkMonsters = (monsters) => {
    if (monsters.length === 0) return [];

    const maxAtk = Math.max(...monsters.map((m) => m.atk || 0));

    return monsters.filter((m) => (m.atk || 0) === maxAtk);
  };

  // Find highest ATK monsters on each side

  const playerHighest = findHighestAtkMonsters(playerMonsters);

  const opponentHighest = findHighestAtkMonsters(opponentMonsters);

  // Determine which monsters to keep

  let playerToKeep = [];

  let opponentToKeep = [];

  // Custom modal text from action properties

  const modalConfig = {
    title: action.modalTitle || "Choose Survivor",

    subtitle: action.modalSubtitle || null, // null means auto-generate

    infoText: action.modalInfoText || "All other monsters will be destroyed.",
  };

  if (keepPerSide > 0) {
    // Handle player's side

    if (playerHighest.length <= keepPerSide) {
      playerToKeep = playerHighest;
    } else if (allowTieBreak) {
      if (isAI(player)) {
        playerToKeep = playerHighest.slice(0, keepPerSide);
      } else {
        const tieBreakerResult = await promptTieBreaker(
          game,

          playerHighest,

          keepPerSide,

          "your",

          modalConfig
        );
        // Check if this is a needsSelection result (network mode)
        if (tieBreakerResult?.needsSelection) {
          return {
            ...tieBreakerResult,
            actionType: action.type,
            activationContext: ctx?.activationContext || null,
          };
        }
        playerToKeep = tieBreakerResult;
      }
    } else {
      playerToKeep = playerHighest.slice(0, keepPerSide);
    }

    // Handle opponent's side

    if (opponentHighest.length <= keepPerSide) {
      opponentToKeep = opponentHighest;
    } else if (allowTieBreak) {
      if (isAI(player)) {
        opponentToKeep = opponentHighest.slice(0, keepPerSide);
      } else {
        const opponentTieBreakerResult = await promptTieBreaker(
          game,

          opponentHighest,

          keepPerSide,

          "opponent's",

          modalConfig
        );
        // Check if this is a needsSelection result (network mode)
        if (opponentTieBreakerResult?.needsSelection) {
          return {
            ...opponentTieBreakerResult,
            actionType: action.type,
            activationContext: ctx?.activationContext || null,
          };
        }
        opponentToKeep = opponentTieBreakerResult;
      }
    } else {
      opponentToKeep = opponentHighest.slice(0, keepPerSide);
    }
  }

  // Determine which monsters to destroy

  const toDestroy = [];

  for (const monster of playerMonsters) {
    if (!playerToKeep.includes(monster)) {
      toDestroy.push({ card: monster, owner: player });
    }
  }

  for (const monster of opponentMonsters) {
    if (!opponentToKeep.includes(monster)) {
      toDestroy.push({ card: monster, owner: opponent });
    }
  }

  if (toDestroy.length === 0) {
    getUI(game)?.log("No monsters were destroyed.");

    return false;
  }

  // Filter out immune monsters before destroying

  // For each entry, check if the card is immune to the source player's effects

  const toDestroyFiltered = toDestroy.filter(({ card, owner }) => {
    // Only filter opponent's monsters - player's own monsters are not protected by opponent immunity

    if (owner.id === player.id) return true;

    // Check if opponent's monster is immune to player's effect

    const isImmune = engine.isImmuneToOpponentEffects(card, player);

    if (isImmune && getUI(game)?.log) {
      getUI(game)?.log(
        `${card.name} is immune to opponent's effects and was not destroyed.`
      );
    }

    return !isImmune;
  });

  if (toDestroyFiltered.length === 0) {
    getUI(game)?.log("No monsters were destroyed (all targets are immune).");

    return false;
  }

  // Destroy all marked monsters

  getUI(game)?.log(
    `Destroying ${toDestroyFiltered.length} monster(s) on the field...`
  );

  for (const { card, owner } of toDestroyFiltered) {
    await game.destroyCard(card, {
      cause: "effect",

      sourceCard: source,

      opponent: game.getOpponent(owner),
    });
  }

  // Log which monsters survived

  const survivorNames = [
    ...playerToKeep.map((m) => m.name),

    ...opponentToKeep.map((m) => m.name),
  ];

  if (survivorNames.length > 0) {
    getUI(game)?.log(`${survivorNames.join(", ")} survived with highest ATK.`);
  }

  game.updateBoard();

  return true;
}

/**
 * Helper function to prompt player for tie-breaker selection
 * @param {Object} modalConfig - Configuration for modal text (title, subtitle, infoText)
 */
async function promptTieBreaker(
  game,

  candidates,

  keepCount,

  sideDescription,

  modalConfig = {}
) {
  if (!getUI(game)?.showCardGridSelectionModal) {
    // Fallback: auto-select first N

    return candidates.slice(0, keepCount);
  }

  return new Promise((resolve) => {
    const maxAtk = candidates[0]?.atk || 0;

    // Use custom subtitle or generate default one

    const subtitle =
      modalConfig.subtitle ||
      `Multiple monsters on ${sideDescription} side have ${maxAtk} ATK. Choose ${keepCount} to keep on the field.`;

    const baseOptions = {
      title: modalConfig.title || "Choose Survivor",

      subtitle,

      cards: candidates,

      keepCount,

      infoText: modalConfig.infoText || "All other monsters will be destroyed.",

      onConfirm: (selected) => {
        resolve(selected || candidates.slice(0, keepCount));
      },

      onCancel: () => {
        resolve(candidates.slice(0, keepCount));
      },
    };

    if (typeof getUI(game).showTieBreakerSelection === "function") {
      getUI(game).showTieBreakerSelection(baseOptions);

      return;
    }

    getUI(game).showCardGridSelectionModal({
      title: baseOptions.title,

      subtitle: baseOptions.subtitle,

      cards: baseOptions.cards,

      minSelect: keepCount,

      maxSelect: keepCount,

      confirmLabel: "Confirm",

      cancelLabel: "Cancel",

      overlayClass: "tie-breaker-overlay",

      modalClass: "tie-breaker-modal",

      gridClass: "tie-breaker-grid",

      cardClass: "tie-breaker-card",

      infoText: baseOptions.infoText,

      onConfirm: baseOptions.onConfirm,

      onCancel: baseOptions.onCancel,
    });
  });
}

/**
 * Generic handler for destroying targeted cards with optional selective field mode
 */
export async function handleDestroyTargetedCards(action, ctx, targets, engine) {
  const { player, opponent, source } = ctx;

  const game = engine.game;

  if (!player || !opponent || !source) return false;

  const useSelectiveField =
    action?.type === "selective_field_destruction" ||
    action?.mode === "selective_field" ||
    Number.isFinite(action?.keepPerSide);

  if (useSelectiveField) {
    return await destroySelectiveField(action, ctx, targets, engine);
  }

  // Build candidate list based on optional zone and kind filters

  const zones = Array.isArray(action.zones)
    ? action.zones
    : ["field", "spellTrap", "fieldSpell"];

  let opponentCards = [];

  for (const z of zones) {
    if (z === "field") {
      opponentCards.push(...(opponent.field || []));
    } else if (z === "spellTrap") {
      opponentCards.push(...(opponent.spellTrap || []));
    } else if (z === "fieldSpell") {
      if (opponent.fieldSpell) opponentCards.push(opponent.fieldSpell);
    }
  }

  // Filter by cardKind when provided (supports array)

  if (action.cardKind) {
    const allowedKinds = Array.isArray(action.cardKind)
      ? action.cardKind
      : [action.cardKind];

    opponentCards = opponentCards.filter(
      (c) => c && allowedKinds.includes(c.cardKind)
    );
  }

  // Optional subtype filter (e.g., field, equip)

  if (action.subtype) {
    const allowedSubtypes = Array.isArray(action.subtype)
      ? action.subtype
      : [action.subtype];

    opponentCards = opponentCards.filter(
      (c) => c && c.subtype && allowedSubtypes.includes(c.subtype)
    );
  }

  if (opponentCards.length === 0) {
    getUI(game)?.log("Opponent has no cards to destroy.");

    return false;
  }

  // action.maxTargets: how many cards to target (default 1)

  const maxTargets = Math.min(action.maxTargets || 1, opponentCards.length);

  getUI(game)?.log(
    `${source.name}: Select up to ${maxTargets} opponent cards to destroy.`
  );

  // Build candidates list for selection contract

  const candidates = buildFieldSelectionCandidates(
    opponent,

    game,

    opponentCards
  );

  const selectionContract = {
    kind: "target",

    message: `Select ${maxTargets} opponent card(s) to destroy.`,

    requirements: [
      {
        id: "destroy_targets",

        min: maxTargets,

        max: maxTargets,

        zones: [...new Set(zones)],

        owner: "opponent",

        filters: {},

        allowSelf: true,

        distinct: true,

        candidates,
      },
    ],

    ui: { useFieldTargeting: true },

    metadata: { context: "destroy_targets" },
  };

  const selectedKeys = await selectCards({
    game,

    player,

    selectionContract,

    requirementId: "destroy_targets",

    kind: "target",

    autoSelectorOptions: {
      owner: player,

      activationContext: ctx.activationContext,

      selectionKind: "target",
    },

    autoSelectKeys: () =>
      candidates.slice(0, maxTargets).map((cand) => cand.key),
  });

  if (selectedKeys === null) {
    getUI(game)?.log("Target selection cancelled.");

    return false;
  }

  const targetCards = selectedKeys

    .map((key) => candidates.find((cand) => cand.key === key)?.cardRef)

    .filter(Boolean);

  if (targetCards.length === 0) {
    getUI(game)?.log("No cards selected.");

    return false;
  }

  // Filter out immune cards before destroying

  const { allowed: nonImmuneTargets } = engine.filterCardsListByImmunity(
    targetCards,

    player,

    { actionType: "destroy_targeted_cards" }
  );

  if (nonImmuneTargets.length === 0) {
    getUI(game)?.log("All selected targets are immune to effects.");

    return false;
  }

  for (const card of nonImmuneTargets) {
    const result = await game.destroyCard(card, {
      cause: "effect",

      sourceCard: source,

      opponent: player,
    });

    if (result?.destroyed) {
      getUI(game)?.log(`${source.name} destroyed ${card.name}!`);
    }
  }

  game.updateBoard();

  return true;
}

/**
 * Handler for destroying the attacker when an archetype monster is destroyed in battle
 */
export async function handleDestroyAttackerOnArchetypeDestruction(
  action,

  ctx,

  targets,

  engine
) {
  const { destroyed, attacker } = ctx;

  const game = engine.game;

  if (!destroyed || !attacker || !game) return false;

  const archetype = action.archetype;
  if (!archetype) {
    console.warn("[handleDestroyAttackerOnArchetypeDestruction] archetype is required in action");
    return false;
  }

  const minLevel = action.minLevel || 1;

  // Validate destroyed card archetype and level

  const destroyedArchetypes = Array.isArray(destroyed.archetypes)
    ? destroyed.archetypes
    : destroyed.archetype
    ? [destroyed.archetype]
    : [];

  if (!destroyedArchetypes.includes(archetype)) return false;

  const destroyedLevel = destroyed.level || 0;

  if (destroyedLevel < minLevel) return false;

  // Validate attacker is opponent's monster

  const attackerOwner = engine.getOwnerByCard(attacker);

  if (!attackerOwner || attackerOwner.id === ctx.player.id) return false;

  // Check if attacker is immune to opponent's effects

  if (engine.isImmuneToOpponentEffects(attacker, ctx.player)) {
    getUI(game)?.log(`${attacker.name} is immune to opponent's effects.`);

    return false;
  }

  const result = await game.destroyCard(attacker, {
    cause: "effect",

    sourceCard: ctx.source || destroyed,

    opponent: ctx.player,
  });

  if (!result?.destroyed) return false;

  getUI(game)?.log(`${attacker.name} was sent to the Graveyard as punishment!`);

  game.updateBoard();

  return true;
}
