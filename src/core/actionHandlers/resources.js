/**
 * resources.js
 *
 * Handlers for resource management (LP, draw, search, upkeep).
 * Moved from ActionHandlers.js with identical behavior.
 */

import { isAI } from "../Player.js";
import { getUI, collectZoneCandidates, selectCardsFromZone } from "./shared.js";

/**
 * Generic handler for paying Life Points as a cost
 *
 * Action properties:
 * - amount: LP to pay
 * - fraction: alternative, pay a fraction of current LP (0.5 = half)
 */
export async function handlePayLP(action, ctx, targets, engine) {
  const { player } = ctx;

  const game = engine.game;

  if (!player || !game) {
    console.log("[handlePayLP] Missing player or game");
    return false;
  }

  let amount = action.amount || 0;

  if (action.fraction) {
    amount = Math.floor(player.lp * action.fraction);
  }

  if (amount <= 0) {
    console.log("[handlePayLP] Amount is zero or negative:", amount);
    return false;
  }

  if (player.lp < amount) {
    console.log(`[handlePayLP] Not enough LP: ${player.lp} < ${amount}`);
    getUI(game)?.log("Not enough LP to pay cost.");
    return false;
  }

  player.lp -= amount;
  console.log(
    `[handlePayLP] SUCCESS: Paid ${amount} LP, remaining ${player.lp}`
  );

  getUI(game)?.log(`${player.name || player.id} paid ${amount} LP.`);

  game.updateBoard();

  return true;
}

/**
 * Generic handler for adding cards from any zone to hand
 * Supports multi-select with filters
 *
 * Action properties:
 * - zone: source zone (default: "graveyard")
 * - filters: { archetype, name, level, cardKind, excludeSelf }
 * - count: { min, max } for selection count
 * - promptPlayer: boolean (default: true for human player)
 */
export async function handleAddFromZoneToHand(action, ctx, targets, engine) {
  const { player, source } = ctx;
  const game = engine.game;
  // Online sempre deve pedir seleção para o seat humano, mesmo se o id legado for "bot".
  // Auto-seleção só deve ocorrer quando o controllerType é IA.
  const promptPlayer = action.promptPlayer !== false && !isAI(player);

  if (!player || !game) return false;

  const inferredSearch =
    action?.type === "search_any" || action?.mode === "search_any";
  const sourceZone = action.zone || (inferredSearch ? "deck" : "graveyard");
  const zone = player[sourceZone];

  if (!zone || zone.length === 0) {
    getUI(game)?.log(`No cards in ${sourceZone}.`);
    return false;
  }

  // Apply filters
  const baseFilters = action.filters || {};
  const filters = { ...baseFilters };
  if (inferredSearch) {
    if (action.archetype && !filters.archetype) {
      filters.archetype = action.archetype;
    }
    if (action.cardKind && !filters.cardKind) {
      filters.cardKind = action.cardKind;
    }
    if (action.cardName && !filters.name) {
      filters.name = action.cardName;
    }
  }

  const extraFilter = (card) => {
    if (!card) return false;
    if (Array.isArray(filters.cardKind)) {
      if (!filters.cardKind.includes(card.cardKind)) return false;
    }
    if (Array.isArray(filters.name)) {
      if (!filters.name.includes(card.name)) return false;
    }
    if (action.cardName) {
      const field = player.field || [];

      const hasBoss = field.some((c) =>
        [
          "Shadow-Heart Scale Dragon",
          "Shadow-Heart Demon Arctroth",
          "Shadow-Heart Demon Dragon",
        ].includes(c?.name)
      );

      const strongBody = field.some((c) => (c?.atk || 0) >= 1800);

      const hasBoard = field.length > 0;

      // Heurística de manutenção: pagar só se o benefício justificar o custo
      const lpAfterPay = player.lp - lpCost;

      const shouldPay =
        player.lp >= lpCost &&
        ((hasBoss && lpAfterPay >= 1200) ||
          (strongBody && lpAfterPay >= 2000) ||
          (hasBoard && lpAfterPay >= 3000));

      // Se não vamos pagar (LP insuficiente ou heurística decide largar), envia
      if (!shouldPay) {
        const sourceZone =
          typeof engine.findCardZone === "function"
            ? engine.findCardZone(player, source)
            : null;

        if (sourceZone) {
          if (
            failureZone === "graveyard" &&
            typeof game.moveCard === "function"
          ) {
            game.moveCard(source, player, "graveyard", {
              fromZone: sourceZone,
            });
          } else {
            const zoneArr = player[sourceZone] || [];

            const idx = zoneArr.indexOf(source);

            if (idx !== -1) {
              zoneArr.splice(idx, 1);

              if (failureZone === "graveyard") {
                player.graveyard = player.graveyard || [];

                player.graveyard.push(source);
              } else if (failureZone === "banished") {
                player.banished = player.banished || [];
                player.banished.push(source);
              }
            }
          }
        }

        game.updateBoard();

        return true;
      }

      // Pagar LP
      player.lp -= lpCost;

      game.updateBoard();

      return true;
      const match = action.cardName.toLowerCase();
      if ((card.name || "").toLowerCase() !== match) return false;
    }
    if (typeof action.cardId === "number" && card.id !== action.cardId) {
      return false;
    }
    if (
      typeof action.minLevel === "number" &&
      (card.level || 0) < action.minLevel
    ) {
      return false;
    }
    if (
      typeof action.maxLevel === "number" &&
      (card.level || 0) > action.maxLevel
    ) {
      return false;
    }
    return true;
  };

  const candidates = collectZoneCandidates(zone, filters, {
    source,
    extraFilter,
  });

  console.log(
    `[handleAddFromZoneToHand] Zone: ${sourceZone}, Candidates: ${candidates.length}, Filters:`,
    filters
  );

  if (candidates.length === 0) {
    console.log(
      `[handleAddFromZoneToHand] No candidates found in ${sourceZone}`
    );
    getUI(game)?.log(`No valid cards in ${sourceZone} matching filters.`);
    return false;
  }

  const count = action.count || { min: 1, max: 1 };
  const maxSelect = Math.min(count.max, candidates.length);
  const minSelect = Math.max(count.min || 0, 0);

  if (maxSelect === 0) {
    getUI(game)?.log("No cards available to add.");
    return false;
  }

  const finalizeSelection = (selectedCards) => {
    const selected = Array.isArray(selectedCards) ? selectedCards : [];
    if (selected.length === 0) {
      if (minSelect === 0) {
        getUI(game)?.log("No cards selected (optional).");
        game.updateBoard();
        return true;
      }
      getUI(game)?.log("No cards selected.");
      return false;
    }

    for (const card of selected) {
      if (typeof game.moveCard === "function") {
        game.moveCard(card, player, "hand", { fromZone: sourceZone });
      } else {
        const idx = zone.indexOf(card);
        if (idx !== -1) {
          zone.splice(idx, 1);
          player.hand.push(card);
        }
      }
    }

    const addedText =
      player.id === "bot"
        ? `${player.name || player.id} added ${
            selected.length
          } card(s) to hand from ${sourceZone}.`
        : selected.length === 1
        ? `Added ${selected[0].name} to hand from ${sourceZone}.`
        : `Added ${selected.length} card(s) to hand from ${sourceZone}.`;
    getUI(game)?.log(addedText);
    game.updateBoard();
    return true;
  };

  console.log(
    `[handleAddFromZoneToHand] Calling selectCardsFromZone: maxSelect=${maxSelect}, minSelect=${minSelect}, promptPlayer=${
      promptPlayer !== false
    }`
  );

  const selection = await selectCardsFromZone({
    game,
    player,
    zone,
    source,
    filters,
    candidates,
    maxSelect,
    minSelect,
    promptPlayer: promptPlayer !== false,
    botSelect: (cards, max) =>
      cards[0]?.cardKind === "monster"
        ? cards
            .slice()
            .sort((a, b) => (b.atk || 0) - (a.atk || 0))
            .slice(0, max)
        : cards.slice(0, max),
    selectSingle: (cards) => {
      const renderer = getUI(game);
      const searchModal = renderer?.getSearchModalElements?.();
      const defaultCardName = cards[0]?.name || "";

      if (!searchModal) {
        return cards[0];
      }

      return new Promise((resolve) => {
        game.isResolvingEffect = true;
        renderer.showSearchModalVisual(
          searchModal,
          cards,
          defaultCardName,
          (selectedName) => {
            const chosen =
              cards.find((c) => c && c.name === selectedName) || cards[0];
            game.isResolvingEffect = false;
            resolve(chosen);
          }
        );
      });
    },
    selectMulti: (cards, range) => {
      if (!getUI(game)?.showMultiSelectModal) {
        return cards.slice(0, range.max);
      }
      return new Promise((resolve) => {
        getUI(game).showMultiSelectModal(
          cards,
          { min: range.min, max: range.max },
          (selected) => {
            resolve(selected || []);
          }
        );
      });
    },
  });

  console.log(`[handleAddFromZoneToHand] Selection result:`, {
    selected: selection.selected?.length || 0,
    cancelled: selection.cancelled,
  });
  const result = finalizeSelection(selection.selected || []);
  console.log(`[handleAddFromZoneToHand] finalizeSelection returned:`, result);
  return result;
}

/**
 * Generic handler for healing based on destroyed monster's ATK
 *
 * Action properties:
 * - fraction: fraction of ATK to heal (default: 1.0)
 * - multiplier: alternative name for fraction
 */
export async function handleHealFromDestroyedAtk(action, ctx, targets, engine) {
  const { player, destroyed } = ctx;

  const game = engine.game;

  if (!player || !game || !destroyed) return false;

  const fraction = action.fraction || action.multiplier || 1.0;

  const healAmount = Math.floor((destroyed.atk || 0) * fraction);

  if (healAmount <= 0) return false;

  player.gainLP(healAmount);

  getUI(game)?.log(
    `${player.name || player.id} gained ${healAmount} LP from ${
      destroyed.name
    }'s ATK.`
  );

  game.updateBoard();

  return true;
}

/**
 * Handler for healing LP based on the Level of the monster destroyed in battle
 *
 * Action properties:
 * - multiplier: how much to multiply the level (default: 100)
 * - player: who gains LP ("self" default)
 */
export async function handleHealFromDestroyedLevel(
  action,

  ctx,

  targets,

  engine
) {
  const { player, destroyed } = ctx;

  const game = engine.game;

  if (!player || !game || !destroyed) return false;

  const multiplier = action.multiplier || 100;

  const level = destroyed.level || 0;

  const healAmount = Math.floor(level * multiplier);

  if (healAmount <= 0) {
    getUI(game)?.log(`${destroyed.name} has Level 0, no LP gained.`);

    return true; // Still valid execution, just 0 heal
  }

  player.gainLP(healAmount);

  getUI(game)?.log(
    `${
      player.name || player.id
    } gained ${healAmount} LP from destroying a Level ${level} monster!`
  );

  game.updateBoard();

  return true;
}

/**
 * Handler for healing LP based on count of matching cards on field
 *
 * Action properties:
 * - amountPerCard: LP to heal per matching card (required)
 * - filters: { owner, zone, cardKind, archetype, type, etc. }
 * - player: who gains LP ("self" default)
 */
export async function handleHealPerFieldCount(action, ctx, targets, engine) {
  const { player, opponent } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const amountPerCard = action.amountPerCard || 0;
  if (amountPerCard <= 0) return false;

  const filters = action.filters || {};
  const ownerFilter = filters.owner || "self";
  const zoneFilter = filters.zone || "field";

  // Determine which player's zone to check
  const targetPlayer = ownerFilter === "opponent" ? opponent : player;
  if (!targetPlayer) return false;

  const zone = targetPlayer[zoneFilter];
  if (!Array.isArray(zone)) return false;

  // Count matching cards
  let count = 0;
  for (const card of zone) {
    if (!card) continue;
    if (filters.cardKind && card.cardKind !== filters.cardKind) continue;
    if (filters.archetype && card.archetype !== filters.archetype) continue;
    if (filters.type && card.type !== filters.type) continue;
    if (filters.name && card.name !== filters.name) continue;
    if (filters.requireFaceup && card.isFacedown) continue;
    count++;
  }

  if (count === 0) {
    getUI(game)?.log("No matching cards found on field.");
    return true; // Valid execution, just 0 heal
  }

  const healAmount = count * amountPerCard;
  player.gainLP(healAmount);

  getUI(game)?.log(
    `${
      player.name || player.id
    } gained ${healAmount} LP (${count} card(s) x ${amountPerCard} LP).`
  );

  game.updateBoard();
  return true;
}

/**
 * Generic handler for granting additional normal summons
 *
 * Action properties:
 * - count: number of additional normal summons to grant (default: 1)
 */
export async function handleGrantAdditionalNormalSummon(
  action,

  ctx,

  targets,

  engine
) {
  const { player } = ctx;

  const game = engine.game;

  if (!player || !game) return false;

  const count = action.count || 1;

  player.additionalNormalSummons += count;

  const summonText = count === 1 ? "Normal Summon" : "Normal Summons";

  getUI(game)?.log(
    `You can conduct ${count} additional ${summonText} this turn.`
  );

  game.updateBoard();

  return true;
}

/**
 * Generic handler for upkeep cost: pay LP or send card to graveyard
 * Implements the "Shadow-Heart Shield" upkeep effect pattern
 *
 * Action properties:
 * - lpCost: amount of LP to pay (default: 800)
 * - failureZone: zone to send if LP insufficient or player chooses not to pay (default: "graveyard")
 */
export async function handleUpkeepPayOrSendToGrave(
  action,

  ctx,

  targets,

  engine
) {
  const { player, source } = ctx;

  const game = engine.game;

  if (!player || !source || !game) return false;

  const lpCost = action.lpCost || 800;

  const failureZone = action.failureZone || "graveyard";

  // Check if LP is available

  if (player.lp < lpCost) {
    // Send source to graveyard

    const sourceZone =
      typeof engine.findCardZone === "function"
        ? engine.findCardZone(player, source)
        : null;

    if (sourceZone) {
      if (failureZone === "graveyard" && typeof game.moveCard === "function") {
        game.moveCard(source, player, "graveyard", { fromZone: sourceZone });
      } else {
        const zoneArr = player[sourceZone] || [];

        const idx = zoneArr.indexOf(source);

        if (idx !== -1) {
          zoneArr.splice(idx, 1);

          if (failureZone === "graveyard") {
            player.graveyard = player.graveyard || [];

            player.graveyard.push(source);
          } else if (failureZone === "banished") {
            player.banished = player.banished || [];

            player.banished.push(source);
          }
        }
      }
    }

    getUI(game)?.log(
      `${source.name} sent to ${failureZone} (insufficient LP for upkeep).`
    );

    game.updateBoard();

    return true; // Effect resolved, just couldn't pay
  }

  // Can pay LP, deduct it

  player.lp -= lpCost;

  getUI(game)?.log(`Paid ${lpCost} LP to maintain ${source.name}.`);

  game.updateBoard();

  return true;
}
