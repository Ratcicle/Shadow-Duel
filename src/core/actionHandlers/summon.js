/**
 * summon.js
 *
 * Handlers for special summon effects.
 * Moved from ActionHandlers.js with identical behavior.
 */

import { isAI } from "../Player.js";
import {
  getUI,
  resolveTargetCards,
  sendCardsToGraveyard,
  collectZoneCandidates,
  buildFieldSelectionCandidates,
  selectCardsFromZone,
  selectCards,
  payCostAndThen,
  summonFromHandCore,
} from "./shared.js";

/**
 * Generic handler for special summoning from any zone with filters
 * UNIFIED HANDLER - Replaces both single and multi-card summon patterns
 *
 * Action properties:
 * - zone: "deck" | "hand" | "graveyard" | "banished" (default: "deck")
 * - filters: { archetype, name, level, levelOp, cardKind, excludeSelf }
 * - count: { min, max } - for multi-card selection (default: { min: 1, max: 1 })
 * - position: "attack" | "defense" | "choice" (default: "choice")
 * - cannotAttackThisTurn: boolean
 * - negateEffects: boolean (default: false)
 * - promptPlayer: boolean (default: true for human player)
 * - requireSource: boolean (default: false) - if true, summon source card from zone
 * - banishCost: boolean (default: false) - if true, banish source as cost before summoning
 */
export async function handleSpecialSummonFromZone(
  action,
  ctx,
  targets,
  engine
) {
  const { player, source, destroyed } = ctx;
  const game = engine.game;
  const promptPlayer = action.promptPlayer !== false && !isAI(player);

  if (!player || !game) return false;

  const zoneSpec = action.zone || "deck";
  const zoneNames = Array.isArray(zoneSpec) ? zoneSpec : [zoneSpec];

  const zoneEntries = zoneNames
    .filter((name) => typeof name === "string")
    .map((name) => ({ name, list: player[name] }))
    .filter((entry) => Array.isArray(entry.list));

  const selectionMap =
    ctx?.selections ||
    ctx?.activationContext?.selections ||
    ctx?.actionContext?.selections ||
    null;

  const resolveSelectionKeys = (requirementId) => {
    if (!selectionMap) return null;
    if (Array.isArray(selectionMap)) return selectionMap;
    if (typeof selectionMap !== "object") return null;
    if (requirementId && Array.isArray(selectionMap[requirementId])) {
      return selectionMap[requirementId];
    }
    return null;
  };

  const allowsPositionChoice = !action.position || action.position === "choice";

  const resolvePositionChoice = () => {
    const raw = resolveSelectionKeys("special_summon_position");
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === "attack" || value === "defense") {
      return value;
    }
    return null;
  };

  const buildPositionSelectionContract = (cardRef) => ({
    kind: "position_select",
    message: "Choose Special Summon position",
    requirements: [
      {
        id: "special_summon_position",
        min: 1,
        max: 1,
        zone: "field",
        candidates: [
          { id: "attack", label: "Attack", position: "attack" },
          { id: "defense", label: "Defense", position: "defense" },
        ],
      },
    ],
    metadata: {
      cardData: {
        cardId: cardRef?.id ?? null,
        name: cardRef?.name ?? "Special Summon",
        image: cardRef?.image ?? null,
        cardKind: cardRef?.cardKind ?? "monster",
        atk: cardRef?.atk ?? null,
        def: cardRef?.def ?? null,
        level: cardRef?.level ?? null,
      },
    },
  });

  // Check for targetRef - use pre-resolved targets if available
  if (action.targetRef && targets?.[action.targetRef]) {
    const resolved = targets[action.targetRef];
    const cardsToSummon = Array.isArray(resolved) ? resolved : [resolved];

    if (cardsToSummon.length === 0) {
      getUI(game)?.log("No valid targets for Special Summon.");
      return false;
    }

    // Verify cards are in the specified zone(s)
    const validCards = cardsToSummon.filter((card) => {
      const inAnyZone = zoneEntries.some((entry) => entry.list.includes(card));
      if (!inAnyZone) {
        // Card might have been moved to hand by a previous action
        for (const zoneName of zoneNames) {
          if (player[zoneName]?.includes(card)) {
            return true;
          }
        }
        return false;
      }
      return true;
    });

    if (validCards.length === 0) {
      getUI(game)?.log("Target cards are no longer in the specified zone.");
      return false;
    }

    return await summonCards(validCards, zoneEntries, player, action, engine);
  }

  const zoneHasCards = zoneEntries.some((entry) => entry.list.length > 0);

  if (!zoneHasCards) {
    getUI(game)?.log(
      `No cards in ${Array.isArray(zoneSpec) ? zoneSpec.join("/") : zoneSpec}.`
    );
    return false;
  }

  // Handle banish cost (before finding candidates)
  if (action.banishCost && source) {
    for (const entry of zoneEntries) {
      const idx = entry.list.indexOf(source);
      if (idx !== -1) {
        entry.list.splice(idx, 1);
        player.banished = player.banished || [];
        player.banished.push(source);
        getUI(game)?.log(`${source.name} was banished as cost.`);
        break;
      }
    }
  }

  // Determine candidates
  let candidates = [];

  if (action.requireSource) {
    // Summon the source/destroyed card itself
    const card = source || destroyed;
    const inAnyZone = zoneEntries.some((entry) => entry.list.includes(card));

    if (!card || !inAnyZone) {
      getUI(game)?.log("Card not in specified zone.");
      return false;
    }

    candidates = [card];
  } else {
    // Apply filters to find candidates
    const filters = action.filters || {};
    const excludeSummonRestrict = action.excludeSummonRestrict || [];

    // Map action-level properties to filters
    if (action.cardName) {
      filters.name = action.cardName;
    }

    if (action.archetype) {
      filters.archetype = action.archetype;
    }

    if (action.cardKind) {
      filters.cardKind = action.cardKind;
    }

    // Use monsterType for filtering by monster type (e.g., "Dragon")
    // to avoid conflict with action.type which is the handler type
    if (action.monsterType) {
      filters.type = action.monsterType;
    }

    if (Number.isFinite(action.minLevel)) {
      filters.minLevel = action.minLevel;
    }

    if (Number.isFinite(action.maxLevel)) {
      filters.maxLevel = action.maxLevel;
    }

    if (action.matchLevelRef) {
      const levelCard = ctx?.[action.matchLevelRef] || null;
      const levelValue = levelCard?.level;

      if (!levelValue) {
        getUI(game)?.log("Cannot match level: no level on reference card.");
        return false;
      }

      filters.level = levelValue;
      filters.levelOp = filters.levelOp || action.levelOp || "eq";
    }

    candidates = zoneEntries.flatMap((entry) =>
      collectZoneCandidates(entry.list, filters, {
        source,
        excludeSummonRestrict,
      })
    );
  }

  // ? FASE 1: Filtrar cartas que não podem ser special summoned
  candidates = candidates.filter((card) => {
    if (card.cannotBeSpecialSummoned) {
      const ui = getUI(game);
      if (ui && ui.log) {
        ui.log(`${card.name} cannot be Special Summoned.`);
      }
      return false;
    }
    return true;
  });

  if (candidates.length === 0) {
    getUI(game)?.log(
      `No valid cards in ${
        Array.isArray(zoneSpec) ? zoneSpec.join("/") : zoneSpec
      } matching filters.`
    );
    return false;
  }

  // Determine how many cards to summon
  const count = action.count || { min: 1, max: 1 };
  const dynamicSource = count.maxFrom;

  let dynamicMax = null;
  if (dynamicSource === "opponentFieldCount") {
    const opponent = ctx?.opponent || engine.game?.getOpponent?.(player);
    dynamicMax = opponent?.field ? opponent.field.length : 0;
  }

  const dynamicCap = Number.isFinite(count.cap)
    ? count.cap
    : Number.isFinite(count.maxCap)
    ? count.maxCap
    : 5;

  const baseMax = Number.isFinite(count.max) ? count.max : 1;

  const resolvedMax =
    dynamicMax !== null ? Math.min(dynamicMax, dynamicCap, baseMax) : baseMax;

  const maxSelect = Math.min(
    resolvedMax,
    candidates.length,
    5 - player.field.length
  );

  if (maxSelect === 0) {
    getUI(game)?.log("Field is full, cannot Special Summon.");
    return false;
  }

  // Single card summon (original behavior)
  if (count.max === 1 || maxSelect === 1) {
    const selection = await selectCardsFromZone({
      game,
      player,
      candidates,
      maxSelect: 1,
      promptPlayer: action.promptPlayer !== false,
      botSelect: (cards) => [
        cards.reduce((top, card) => {
          const cardAtk = card.atk || 0;
          const topAtk = top.atk || 0;
          return cardAtk >= topAtk ? card : top;
        }, cards[0]),
      ],
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
    });

    if (!selection.selected || selection.selected.length === 0) {
      return false;
    }

    return await summonCards(
      selection.selected,
      zoneEntries,
      player,
      action,
      engine
    );
  }

  // Multi-card summon (graveyard revival pattern)
  // Bot: auto-select best cards (highest ATK)
  const minRequired = Number(count.min ?? 0);

  const dynamicMaxSelect =
    dynamicMax !== null
      ? Math.min(dynamicMax, dynamicCap, 5 - player.field.length)
      : maxSelect;

  const selection = await selectCardsFromZone({
    game,
    player,
    candidates,
    maxSelect: dynamicMaxSelect,
    minSelect: minRequired,
    botSelect: (cards, max) =>
      cards
        .slice()
        .sort((a, b) => (b.atk || 0) - (a.atk || 0))
        .slice(0, max),
    selectMulti: (cards, range) => {
      if (!getUI(game)?.showMultiSelectModal) {
        return cards
          .slice()
          .sort((a, b) => (b.atk || 0) - (a.atk || 0))
          .slice(0, range.max);
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

  const selected = selection.selected || [];

  if (selected.length === 0) {
    if (minRequired === 0) {
      getUI(game)?.log("No cards selected (optional).");
      if (typeof game.updateBoard === "function") {
        game.updateBoard();
      }
      return true;
    }

    getUI(game)?.log("No cards selected.");
    return false;
  }

  return await summonCards(selected, zoneEntries, player, action, engine);
}

/**
 * Helper function to summon one or more cards
 * Unified to handle both single and multi-card summons
 */
async function summonCards(cards, sourceZoneEntries, player, action, engine) {
  const game = engine.game;
  let summoned = 0;

  const setAtkToZero = action.setAtkToZeroAfterSummon === true;
  const setDefToZero = action.setDefToZeroAfterSummon === true;

  const canUseMoveCard = game && typeof game.moveCard === "function";

  const fromZoneSpec =
    action.fromZone || action.zone || action.summonZone || "deck";
  const fromZoneName = Array.isArray(fromZoneSpec)
    ? null
    : typeof fromZoneSpec === "string"
    ? fromZoneSpec
    : null;

  for (const card of cards) {
    if (!card || player.field.length >= 5) break;

    const resolvedFromZone =
      typeof action.fromZone === "string"
        ? action.fromZone
        : typeof engine.findCardZone === "function"
        ? engine.findCardZone(player, card)
        : fromZoneName;

    // Unified semantics: delegate to unified resolver
    const position = await engine.chooseSpecialSummonPosition(card, player, {
      position: action.position,
    });

    let usedMoveCard = false;
    if (canUseMoveCard) {
      const moveResult = await game.moveCard(card, player, "field", {
        fromZone: resolvedFromZone || undefined,
        position,
        isFacedown: false,
        resetAttackFlags: true,
      });

      if (moveResult?.success === false) {
        continue;
      }

      usedMoveCard = true;
    } else {
      // Remove from source zone (fallback)
      const fallbackZoneName =
        resolvedFromZone ||
        (Array.isArray(sourceZoneEntries) && sourceZoneEntries.length > 0
          ? sourceZoneEntries[0].name
          : null);

      const fallbackArr =
        (fallbackZoneName && player[fallbackZoneName]) || player.deck || [];

      const cardIndex = fallbackArr.indexOf(card);
      if (cardIndex !== -1) {
        fallbackArr.splice(cardIndex, 1);
      }

      card.position = position;
      card.isFacedown = false;
      card.hasAttacked = false;
      card.attacksUsedThisTurn = 0;
      card.owner = player.id;
      card.controller = player.id;

      player.field.push(card);
    }

    card.cannotAttackThisTurn = action.cannotAttackThisTurn || false;

    if (action.negateEffects) {
      card.effectsNegated = true;
    }

    if (setAtkToZero) {
      if (card.originalAtk == null) {
        card.originalAtk = card.atk;
      }
      card.atk = 0;
    }

    if (setDefToZero) {
      if (card.originalDef == null) {
        card.originalDef = card.def;
      }
      card.def = 0;
    }

    if (!usedMoveCard) {
      await game.emit("after_summon", {
        card: card,
        player: player,
        method: "special",
        fromZone: resolvedFromZone || fromZoneName || "deck",
      });
    }

    summoned++;
  }

  if (summoned > 0) {
    // Log message
    const zoneName = Array.isArray(action.zone)
      ? action.zone.join("/")
      : action.zone || "deck";
    const cardText = summoned === 1 ? cards[0].name : `${summoned} cards`;
    const positionText =
      action.position === "defense"
        ? "Defense"
        : action.position === "attack"
        ? "Attack"
        : "";
    const restrictText = action.cannotAttackThisTurn
      ? " (cannot attack this turn)"
      : "";
    const negateText = action.negateEffects ? " (effects negated)" : "";

    getUI(game)?.log(
      `${
        player.name || player.id
      } Special Summoned ${cardText} from ${zoneName}${
        positionText ? ` in ${positionText} Position` : ""
      }${restrictText}${negateText}.`
    );

    game.updateBoard();
  }

  return summoned > 0;
}

/**
 * Send a monster you control to the Graveyard, then Special Summon
 * 1 monster from your Graveyard with the same Level.
 *
 * Action properties:
 * - targetRef / costTargetRef: reference to the cost selection
 * - summonZone: zone to summon from (default: "graveyard")
 * - summonFilters: additional summon filters (archetype, name, etc.)
 * - position: "attack" | "defense" | "choice" (default: "choice")
 * - cannotAttackThisTurn: boolean (default: false)
 * - negateEffects: boolean (default: false)
 * - promptPlayer: boolean (default: true for human player)
 */
export async function handleTransmutate(action, ctx, targets, engine) {
  const { player } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const costRef = action.costTargetRef || action.targetRef;
  const costCards = resolveTargetCards(action, ctx, targets, {
    targetRef: costRef ?? undefined,
  });

  if (costCards.length === 0) {
    getUI(game)?.log("No valid cost selected for Transmutate.");
    return false;
  }

  const costCard = costCards[0];
  const costLevel = costCard?.level ?? 0;

  if (!costLevel) {
    getUI(game)?.log("Transmutate requires a monster with a Level.");
    return false;
  }

  const fromZone =
    (typeof engine.findCardZone === "function" &&
      engine.findCardZone(player, costCard)) ||
    action.costFromZone ||
    "field";

  await sendCardsToGraveyard([costCard], player, engine, {
    fromZone,
    fallbackZone: "field",
    pushIfMissing: true,
  });

  if (typeof game.updateBoard === "function") {
    game.updateBoard();
  }

  const summonFilters = {
    ...(action.summonFilters || action.filters || {}),
  };

  if (!summonFilters.cardKind) {
    summonFilters.cardKind = "monster";
  }

  summonFilters.level = costLevel;
  summonFilters.levelOp = action.levelOp || "eq";

  const summonAction = {
    zone: action.summonZone || action.zone || "graveyard",
    filters: summonFilters,
    count: action.count || { min: 1, max: 1 },
    position: action.position || "choice",
    cannotAttackThisTurn: action.cannotAttackThisTurn || false,
    negateEffects: action.negateEffects || false,
    promptPlayer: action.promptPlayer,
    excludeSummonRestrict: action.excludeSummonRestrict || [],
  };

  return await handleSpecialSummonFromZone(summonAction, ctx, targets, engine);
}

/**
 * Generic handler for special summon from hand with cost
 * Replaces: applyVoidHaunterSpecialSummon, applyVoidForgottenKnightSpecialSummon, etc.
 *
 * Action properties:
 * - costTargetRef: reference to target definition for cost
 * - position: "attack" | "defense" | "choice"
 * - cannotAttackThisTurn: boolean
 */
export async function handleSpecialSummonFromHandWithCost(
  action,
  ctx,
  targets,
  engine
) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !source || !game) {
    return false;
  }

  if (!player.hand?.includes(source)) {
    getUI(game)?.log("Card must be in hand to activate this effect.");
    return false;
  }

  if (player.field.length >= 5) {
    getUI(game)?.log("Field is full.");
    return false;
  }

  const performSummon = async () => {
    const summonResult = await summonFromHandCore({
      card: source,
      player,
      engine,
      game,
      position: action.position || "choice",
      cannotAttackThisTurn: action.cannotAttackThisTurn || false,
    });
    return summonResult.success;
  };

  const isTiered =
    action.type === "special_summon_from_hand_with_tiered_cost" ||
    action.useTieredCost === true ||
    Array.isArray(action.tierOptions);

  if (!isTiered) {
    // Validate cost was paid
    const costTargets = resolveTargetCards(action, ctx, targets, {
      targetRef: action.costTargetRef,
      requireArray: true,
    });

    if (!costTargets || costTargets.length === 0) {
      getUI(game)?.log("No cost paid for special summon.");
      return false;
    }

    // ? Process cost cards based on destination
    const costDestination = action.costDestination || "graveyard";

    if (costDestination === "banish") {
      // BANISH = REMOVE FROM GAME (not move to zone)
      for (const costCard of costTargets) {
        if (!costCard) continue;

        // Find the zone where the cost card is
        const fromZone =
          typeof engine.findCardZone === "function"
            ? engine.findCardZone(player, costCard)
            : null;

        if (fromZone && Array.isArray(player[fromZone])) {
          const idx = player[fromZone].indexOf(costCard);
          if (idx > -1) {
            player[fromZone].splice(idx, 1);
          }
        }

        // Track banished cards (read-only, not accessible by effects)
        if (!game.banishedCards) {
          game.banishedCards = [];
        }
        game.banishedCards.push(costCard);
      }

      getUI(game)?.log(
        `Banished ${costTargets.length} card(s) (removed from game).`
      );
    } else {
      // Default: Move cost cards to graveyard
      await sendCardsToGraveyard(costTargets, player, engine, {
        resolveFromZone: (costCard) =>
          typeof engine.findCardZone === "function"
            ? engine.findCardZone(player, costCard) || "field"
            : "field",
        fallbackZone: "field",
        useResolvedZoneOnFallback: false,
      });
    }

    const success = await performSummon();

    if (!success) {
      return false;
    }

    getUI(game)?.log(
      `${player.name || player.id} Special Summoned ${source.name} from hand.`
    );

    game.updateBoard();
    return true;
  }

  const filters = action.costFilters || {
    name: "Void Hollow",
    cardKind: "monster",
  };

  const matchesFilters = (card) => {
    if (!card) return false;
    if (filters.cardKind && card.cardKind !== filters.cardKind) return false;
    if (filters.name && card.name !== filters.name) return false;

    if (filters.archetype) {
      const hasArc =
        card.archetype === filters.archetype ||
        (Array.isArray(card.archetypes) &&
          card.archetypes.includes(filters.archetype));
      if (!hasArc) return false;
    }

    return true;
  };

  const costCandidates = player.field.filter(matchesFilters);
  const minCost = action.minCost ?? 1;
  const maxCost = action.maxCost ?? 3;
  const allowedMax = Math.min(maxCost, costCandidates.length);

  if (allowedMax < minCost) {
    getUI(game)?.log("Not enough cost monsters to Special Summon.");
    return false;
  }

  const defaultTierOptions = [
    {
      count: 1,
      label: "Tier 1",
      description: "+300 ATK até o final do turno",
    },
    {
      count: 2,
      label: "Tier 2",
      description: "+300 ATK e não pode ser destruída em batalha",
    },
    {
      count: 3,
      label: "Tier 3",
      description:
        "+300 ATK, indestrutível em batalha e destrói 1 carta do oponente",
    },
  ];

  const tierOptions = (action.tierOptions || defaultTierOptions).filter(
    (opt) => opt.count >= minCost && opt.count <= allowedMax
  );

  let chosenCount = null;

  if (isAI(player)) {
    chosenCount = allowedMax;
  } else if (getUI(game)?.showTierChoiceModal) {
    chosenCount = await getUI(game).showTierChoiceModal({
      title: action.tierTitle || source.name,
      options: tierOptions,
    });
  } else if (getUI(game)?.showNumberPrompt) {
    const parsed = getUI(game).showNumberPrompt(
      `Choose how many Void Hollow to send (1-${allowedMax}):`,
      String(allowedMax)
    );

    if (parsed !== null && parsed >= minCost && parsed <= allowedMax) {
      chosenCount = parsed;
    }
  }

  if (!chosenCount) {
    return false;
  }

  const costPaid = await payCostAndThen(
    {
      player,
      engine,
      sendOptions: { fromZone: "field", fallbackZone: "field" },
      selectCost: async () => {
        const selection = await selectCardsFromZone({
          game,
          player,
          candidates: costCandidates,
          maxSelect: chosenCount,
          minSelect: chosenCount,
          botSelect: (cards, max) =>
            cards
              .slice()
              .sort((a, b) => (a.atk || 0) - (b.atk || 0))
              .slice(0, max),
          selectionContractBuilder: (cards) => {
            const requirementId = "tier_cost";
            const decorated = buildFieldSelectionCandidates(
              player,
              game,
              cards,
              { ownerLabel: player.id }
            );

            return {
              kind: "cost",
              requirementId,
              decorated,
              selectionContract: {
                kind: "cost",
                message:
                  "Select the Void Hollow cards to send to the Graveyard.",
                requirements: [
                  {
                    id: requirementId,
                    min: chosenCount,
                    max: chosenCount,
                    zones: ["field"],
                    owner: "player",
                    filters: { cardKind: "monster", name: "Void Hollow" },
                    allowSelf: true,
                    distinct: true,
                    candidates: decorated,
                  },
                ],
                ui: { useFieldTargeting: true },
                metadata: { context: "tier_cost" },
              },
            };
          },
        });

        if (selection.cancelled || selection.selected.length !== chosenCount) {
          return null;
        }

        return selection.selected;
      },
    },
    async () => {
      const success = await performSummon();

      if (!success) {
        return false;
      }

      getUI(game)?.log(
        `${
          player.name || player.id
        } enviou ${chosenCount} custo(s) para invocar ${source.name}.`
      );

      const buffAmount = action.tier1AtkBoost ?? 300;
      if (chosenCount >= 1 && buffAmount !== 0) {
        engine.applyBuffAtkTemp(
          { targetRef: "tier_self", amount: buffAmount },
          { tier_self: [source] }
        );
      }

      if (chosenCount >= 2) {
        source.battleIndestructible = true;
      }

      if (chosenCount >= 3) {
        const opponent = game.getOpponent(player);

        const opponentCards = [
          ...(opponent.field || []),
          ...(opponent.spellTrap || []),
          opponent.fieldSpell,
        ].filter(Boolean);

        if (opponentCards.length > 0) {
          const requirementId = "tier_destroy";
          const decorated = buildFieldSelectionCandidates(
            opponent,
            game,
            opponentCards,
            { ownerLabel: opponent.id }
          );

          const selectionContract = {
            kind: "target",
            message: "Select a card to destroy.",
            requirements: [
              {
                id: requirementId,
                min: 1,
                max: 1,
                zones: ["field", "spellTrap", "fieldSpell"],
                owner: "opponent",
                filters: {},
                allowSelf: true,
                distinct: true,
                candidates: decorated,
              },
            ],
            ui: { useFieldTargeting: true },
            metadata: { context: "tier_destroy" },
          };

          const selectedKeys = await selectCards({
            game,
            player,
            selectionContract,
            requirementId,
            kind: "target",
            autoSelectKeys: () =>
              decorated
                .slice()
                .sort((a, b) => (b.atk || 0) - (a.atk || 0))
                .slice(0, 1)
                .map((cand) => cand.key),
          });

          const chosenKey = selectedKeys?.[0];
          const targetToDestroy =
            decorated.find((cand) => cand.key === chosenKey)?.cardRef || null;

          if (targetToDestroy) {
            // Check immunity before destroying
            if (engine.isImmuneToOpponentEffects(targetToDestroy, player)) {
              getUI(game)?.log(
                `${targetToDestroy.name} is immune to opponent's effects.`
              );
            } else {
              const result = await game.destroyCard(targetToDestroy, {
                cause: "effect",
                sourceCard: source,
                opponent: player,
              });

              if (result?.destroyed) {
                getUI(game)?.log(
                  `${source.name} destruiu ${targetToDestroy.name}.`
                );
              }
            }
          }
        }
      }

      game.updateBoard();
      return true;
    }
  );

  return costPaid;
}

/**
 * Handler for Abyssal Serpent Dragon delayed summon effect
 */
export async function handleAbyssalSerpentDelayedSummon(
  action,
  ctx,
  targets,
  engine
) {
  const { player, source } = ctx;
  const game = engine?.game;
  const ui = getUI(game);

  if (!player || !source || !game) {
    return false;
  }

  // Extrair target do monstro oponente selecionado
  const targetRef = action.targetRef || "abyssal_target";
  const targetCards = targets?.[targetRef];

  if (!Array.isArray(targetCards) || targetCards.length === 0) {
    ui?.log?.("No target selected for Abyssal Serpent effect.");
    return false;
  }

  const target = targetCards[0]; // Efeito opera com 1 target
  const opponent = ctx?.opponent || game.getOpponent?.(player);

  if (!opponent) {
    ui?.log?.("Cannot determine opponent.");
    return false;
  }

  // Verificar se ambas cartas estão no campo
  if (!player.field.includes(source)) {
    ui?.log?.("Source card is not on field.");
    return false;
  }

  if (!opponent.field.includes(target)) {
    ui?.log?.("Target card is not on field.");
    return false;
  }

  // Detectar se target é Fusion ou Ascension
  const isFusionOrAscension =
    target.monsterType === "fusion" || target.monsterType === "ascension";

  // Enviar ambas cartas ao GY
  await game.moveCard(source, player, "graveyard");
  await game.moveCard(target, opponent, "graveyard");

  ui?.log?.(
    `${source.name} and ${target.name} are sent to the GY. They will be special summoned during the opponent's next Standby Phase.`
  );

  // Agendar delayed summon para próxima standby phase do oponente
  const summonPayload = {
    summons: [
      {
        card: source,
        owner: "player",
        fromZone: "graveyard",
        getsBuffIfTargetWasFusionOrAscension: isFusionOrAscension, // Flag para aplicar buff ao source
      },
      {
        card: target,
        owner: "bot",
        fromZone: "graveyard",
        getsBuffIfTargetWasFusionOrAscension: false, // Target nunca ganha buff
      },
    ],
  };

  // Determinar qual é a próxima standby phase do oponente
  const opponentPlayerId =
    opponent.id || (player.id === "player" ? "bot" : "player");

  game.scheduleDelayedAction(
    "delayed_summon",
    {
      phase: "standby",
      player: opponentPlayerId,
    },
    summonPayload,
    1 // Prioridade 1 para processar antes de outros efeitos
  );

  return true;
}

/**
 * Generic handler for drawing and conditionally summoning from hand
 * Draws N cards, checks if the drawn card matches a condition, and optionally summons it
 *
 * Action properties:
 * - player: "self" | "opponent" - player to draw for
 * - drawAmount: number - how many cards to draw
 * - condition: { type, typeName, maxLevel, cardKind } - condition for drawn card
 * - position: "attack" | "defense" | "choice" (default: "choice")
 * - optional: boolean - if true, prompts player; if false, auto-summons (default: true)
 */
export async function handleDrawAndSummon(action, ctx, targets, engine) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const drawAmount = action.drawAmount || 1;
  const condition = action.condition || {};
  const optional = action.optional !== false;

  // Draw the cards
  const drawn = game.drawCards(player, drawAmount);

  if (!drawn || !drawn.ok || !drawn.drawn || drawn.drawn.length === 0) {
    return false;
  }

  const drawnCard = drawn.drawn[0]; // Take first drawn card
  if (!drawnCard) return false;

  // Update board to show the drawn card visually
  game.updateBoard();

  // Add a small delay to let the user see the card being drawn
  await new Promise((resolve) => setTimeout(resolve, 400));

  // Check condition against drawn card
  let conditionMet = false;

  if (condition.type === "match_card_props") {
    const typeName = condition.typeName || null;
    const minLevel = Number.isFinite(condition.minLevel)
      ? condition.minLevel
      : null;
    const maxLevel = Number.isFinite(condition.maxLevel)
      ? condition.maxLevel
      : null;
    const requireKind = condition.cardKind || null;

    let ok = true;

    if (typeName) {
      const types = Array.isArray(drawnCard.types) ? drawnCard.types : null;
      const cardType = drawnCard.type || null;
      ok = types ? types.includes(typeName) : cardType === typeName;
    }

    if (ok && requireKind) {
      ok = drawnCard.cardKind === requireKind;
    }

    if (ok && minLevel !== null) {
      ok = (drawnCard.level || 0) >= minLevel;
    }

    if (ok && maxLevel !== null) {
      ok = (drawnCard.level || 0) <= maxLevel;
    }

    conditionMet = ok;
  } else {
    conditionMet = true;
  }

  if (!conditionMet) {
    return false;
  }

  // Check field space
  if (player.field.length >= 5) {
    getUI(game)?.log("Field is full, cannot Special Summon.");
    return false;
  }

  // Get the index of the card in hand
  const handIndex = player.hand.indexOf(drawnCard);
  if (handIndex === -1) {
    return false;
  }

  // For AI, auto-summon if not optional
  if (isAI(player)) {
    if (!optional) {
      return await performSummonFromHand(
        drawnCard,
        handIndex,
        player,
        action,
        engine
      );
    }
    // Bot chooses to summon (always optimal)
    return await performSummonFromHand(
      drawnCard,
      handIndex,
      player,
      action,
      engine
    );
  }

  // For human player
  if (optional) {
    const wantsToSummon =
      getUI(game)?.showConfirmPrompt?.(
        `You drew "${drawnCard.name}". Do you want to Special Summon it from your hand?`,
        { kind: "draw_and_summon", cardName: drawnCard.name }
      ) ?? false;

    if (!wantsToSummon) {
      return false;
    }
  }

  return await performSummonFromHand(
    drawnCard,
    handIndex,
    player,
    action,
    engine
  );
}

/**
 * Generic handler for conditional summon from hand
 * Offers to summon a card if a condition is met (e.g., controlling a specific card)
 *
 * Action properties:
 * - targetRef: reference to the card to potentially summon (must be in hand)
 * - condition: { type, cardName, zone } - condition to check
 * - position: "attack" | "defense" | "choice" (default: "choice")
 * - optional: boolean - if true, prompts player; if false, auto-summons (default: true)
 */
export async function handleConditionalSummonFromHand(
  action,
  ctx,
  targets,
  engine
) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  // Get the card(s) to potentially summon
  const targetRef = action.targetRef;
  let targetCards = [];

  if (targetRef === "self" && source) {
    targetCards = [source];
  } else if (targetRef && targets?.[targetRef]) {
    targetCards = targets?.[targetRef];
  } else if (action.cardName) {
    const named = player.hand.find((c) => c && c.name === action.cardName);
    if (named) {
      targetCards = [named];
    }
  }

  if (!targetCards || targetCards.length === 0) return false;

  const card = Array.isArray(targetCards) ? targetCards[0] : targetCards;

  // Find card in hand (might be different reference if moved by previous action)
  const handCard = player.hand.find((c) => c === card || c.name === card.name);
  if (!handCard) {
    return false;
  }

  // Check condition
  const condition = action.condition || {};
  let conditionMet = false;

  if (condition.type === "control_card") {
    const zoneName = condition.zone || "fieldSpell";
    const cardName = condition.cardName;

    if (zoneName === "fieldSpell") {
      conditionMet = player.fieldSpell?.name === cardName;
    } else {
      const zone = player[zoneName] || [];
      conditionMet = zone.some((c) => c && c.name === cardName);
    }
  } else if (condition.type === "control_card_type") {
    // Check if player controls a card of a specific type (e.g., Dragon)
    const zoneName = condition.zone || "field";
    const typeName = condition.typeName || condition.cardType;

    if (!typeName) {
      conditionMet = false;
    } else {
      const zone = player[zoneName] || [];
      conditionMet = zone.some((c) => {
        if (!c || c.isFacedown) return false;
        if (Array.isArray(c.types)) {
          return c.types.includes(typeName);
        }
        return c.type === typeName;
      });
    }
  } else {
    // Additional generic condition: match properties of the card itself
    if (condition.type === "match_card_props") {
      const typeName =
        condition.typeName || condition.typeFilter || condition.type || null;
      const minLevel = Number.isFinite(condition.minLevel)
        ? condition.minLevel
        : null;
      const maxLevel = Number.isFinite(condition.maxLevel)
        ? condition.maxLevel
        : null;
      const requireKind = condition.cardKind || null;

      let ok = true;

      if (typeName) {
        const types = Array.isArray(handCard.types) ? handCard.types : null;
        const cardType = handCard.type || null;
        ok = types ? types.includes(typeName) : cardType === typeName;
      }

      if (ok && requireKind) {
        ok = handCard.cardKind === requireKind;
      }

      if (ok && minLevel !== null) {
        ok = (handCard.level || 0) >= minLevel;
      }

      if (ok && maxLevel !== null) {
        ok = (handCard.level || 0) <= maxLevel;
      }

      conditionMet = ok;
    } else {
      // Default to true if no condition specified
      conditionMet = true;
    }
  }

  if (!conditionMet) {
    return false;
  }

  // Check field space
  if (player.field.length >= 5) {
    getUI(game)?.log("Field is full, cannot Special Summon.");
    return false;
  }

  // Get the index of the card in hand
  const handIndex = player.hand.indexOf(handCard);
  if (handIndex === -1) {
    return false;
  }

  const optional = action.optional !== false;

  // For AI, auto-summon if not optional
  if (isAI(player)) {
    if (!optional) {
      return await performSummonFromHand(
        handCard,
        handIndex,
        player,
        action,
        engine
      );
    }
    // Bot chooses to summon (always optimal)
    return await performSummonFromHand(
      handCard,
      handIndex,
      player,
      action,
      engine
    );
  }

  // For human player
  if (optional) {
    const conditionText = condition.cardName
      ? `You control "${condition.cardName}".`
      : "Condition met.";

    const wantsToSummon =
      getUI(game)?.showConfirmPrompt?.(
        `${conditionText} Do you want to Special Summon "${handCard.name}" from your hand?`,
        { kind: "conditional_summon", cardName: handCard.name }
      ) ?? false;

    if (!wantsToSummon) {
      return false;
    }
  }

  return await performSummonFromHand(
    handCard,
    handIndex,
    player,
    action,
    engine
  );
}

/**
 * Helper function to perform the summon for conditional summon handler
 */
async function performSummonFromHand(card, handIndex, player, action, engine) {
  const game = engine.game;

  // Unified semantics: use EffectEngine resolver with action.position
  const position = await engine.chooseSpecialSummonPosition(card, player, {
    position: action.position,
  });

  const moveResult =
    typeof game.moveCard === "function"
      ? game.moveCard(card, player, "field", {
          fromZone: "hand",
          position,
          isFacedown: false,
          resetAttackFlags: true,
        })
      : null;

  if (moveResult && moveResult.success === false) {
    return false;
  }

  if (moveResult == null) {
    player.hand.splice(handIndex, 1);

    card.position = position;
    card.isFacedown = false;
    card.hasAttacked = false;
    card.owner = player.id;
    card.controller = player.id;

    player.field.push(card);
  }

  card.cannotAttackThisTurn =
    action.restrictAttackThisTurn || action.cannotAttackThisTurn || false;

  getUI(game)?.log(
    `${player.name || player.id} Special Summoned ${card.name} from hand.`
  );

  game.updateBoard();

  return true;
}

/**
 * Special summon from deck with counter limit
 * Summons a monster from deck with ATK <= (counter count * multiplier)
 *
 * Action properties:
 * - counterType: name of the counter to check (default: "judgment_marker")
 * - counterMultiplier: ATK limit per counter (default: 500)
 * - filters: additional filters for candidates
 * - position: "attack" | "defense" | "choice"
 * - sendSourceToGraveAfter: boolean - if true, send source to GY after summon
 */
export async function handleSpecialSummonFromDeckWithCounterLimit(
  action,
  ctx,
  targets,
  engine
) {
  const { player, source } = ctx;
  const game = engine.game;

  if (!player || !source || !game) return false;

  const counterType = action.counterType || "judgment_marker";
  const counterMultiplier = action.counterMultiplier || 500;
  const filters = action.filters || {};
  const position = action.position || "choice";

  // Calculate max ATK based on counters
  const counterCount = source[counterType] || 0;
  const maxAtk = counterCount * counterMultiplier;

  if (maxAtk === 0) {
    getUI(game)?.log(
      `No ${counterType} counters on ${source.name}. Cannot summon.`
    );
    return false;
  }

  // Filter deck by ATK limit
  const deck = player.deck || [];

  const candidates = deck.filter((card) => {
    if (!card || card.cardKind !== "monster") return false;
    if (card.atk > maxAtk) return false;

    // Apply archetype filter
    if (filters.archetype) {
      const hasArchetype =
        card.archetype === filters.archetype ||
        (Array.isArray(card.archetypes) &&
          card.archetypes.includes(filters.archetype));
      if (!hasArchetype) return false;
    }

    return true;
  });

  if (candidates.length === 0) {
    getUI(game)?.log(`No monsters in deck with ATK <= ${maxAtk} to summon.`);
    return false;
  }

  // AI: auto-select best card (highest ATK)
  if (isAI(player)) {
    const chosen = candidates.reduce((best, card) =>
      card.atk > best.atk ? card : best
    );

    return await performSummonFromDeck(
      chosen,
      deck,
      player,
      action,
      engine,
      source
    );
  }

  // Human player: show selection modal with counter info
  return new Promise((resolve) => {
    const modalConfig = {
      title: `Select 1 monster (Max ATK: ${maxAtk}, ${counterCount}x ${counterType})`,
      subtitle: `Monsters with ATK ≤ ${maxAtk}`,
      infoText: `You have ${counterCount} ${counterType} counters. After summoning, this card will be sent to the Graveyard.`,
    };

    getUI(game)?.showCardSelectionModal(
      candidates,
      modalConfig.title,
      1,
      async (selected) => {
        if (!selected || selected.length === 0) {
          resolve(false);
          return;
        }

        const chosen = selected[0];

        const result = await performSummonFromDeck(
          chosen,
          deck,
          player,
          action,
          engine,
          source
        );

        resolve(result);
      }
    );
  });
}

/**
 * Helper function to perform the summon for handleSpecialSummonFromDeckWithCounterLimit
 */
async function performSummonFromDeck(
  card,
  deck,
  player,
  action,
  engine,
  source
) {
  const game = engine.game;

  if (!card || !deck.includes(card)) return false;

  // Check field space
  if (player.field.length >= 5) {
    getUI(game)?.log("Field is full. Cannot summon.");
    return false;
  }

  // Unified semantics: use EffectEngine resolver with action.position
  const summonPosition = await engine.chooseSpecialSummonPosition(
    card,
    player,
    { position: action.position }
  );

  let usedMoveCard = false;
  if (typeof game.moveCard === "function") {
    const moveResult = await game.moveCard(card, player, "field", {
      fromZone: "deck",
      position: summonPosition,
      isFacedown: false,
      resetAttackFlags: true,
    });

    if (moveResult?.success === false) {
      return false;
    }

    usedMoveCard = true;
  } else {
    // Remove from deck (fallback)
    const idx = deck.indexOf(card);
    if (idx !== -1) {
      deck.splice(idx, 1);
    }

    card.position = summonPosition;
    card.isFacedown = false;
    card.hasAttacked = false;
    card.attacksUsedThisTurn = 0;
    card.owner = player.id;
    card.controller = player.id;

    player.field.push(card);
  }

  card.cannotAttackThisTurn = action.cannotAttackThisTurn || false;

  getUI(game)?.log(
    `${player.name} Special Summoned ${card.name} from deck in ${
      summonPosition === "defense" ? "Defense" : "Attack"
    } Position.`
  );

  if (!usedMoveCard) {
    await game.emit("after_summon", {
      card: card,
      player: player,
      method: "special",
      fromZone: "deck",
    });
  }

  // Send source to graveyard if specified
  if (action.sendSourceToGraveAfter && source) {
    const sourceZone =
      typeof engine.findCardZone === "function"
        ? engine.findCardZone(player, source)
        : null;

    if (sourceZone) {
      if (typeof game.moveCard === "function") {
        game.moveCard(source, player, "graveyard", { fromZone: sourceZone });
      } else {
        const sourceIdx = sourceZone.indexOf(source);
        if (sourceIdx !== -1) {
          sourceZone.splice(sourceIdx, 1);
          player.graveyard = player.graveyard || [];
          player.graveyard.push(source);

          await game.emit("card_to_grave", {
            card: source,
            fromZone: sourceZone,
            player: player,
          });
        }
      }

      getUI(game)?.log(`${source.name} was sent to the Graveyard.`);
    }
  }

  game.updateBoard();

  return true;
}
