import { isAI } from "../../Player.js";
import { getCardDisplayName, getUIText } from "../../i18n.js";
import {
  getUI,
  collectZoneCandidates,
  normalizeNegateEffectsDuration,
  resolveTargetCards,
  selectCardsFromZone,
} from "../shared.js";
import {
  buildSourceZoneEntries,
  findSourceEntryForCard,
  getSourceOwners,
} from "./sourceZones.js";

function applyStatusesOnSummon(card, statuses) {
  if (!card || !statuses) return;
  const statusEntries = Array.isArray(statuses) ? statuses : [statuses];
  for (const entry of statusEntries) {
    if (!entry) continue;
    const status =
      typeof entry === "string"
        ? entry
        : typeof entry.status === "string"
          ? entry.status
          : null;
    if (!status) continue;
    const value =
      typeof entry === "object" &&
      Object.prototype.hasOwnProperty.call(entry, "value")
        ? entry.value
        : true;
    card[status] = value;
  }
}

function getCardDistinctName(card) {
  return card?.name || `id:${card?.id ?? "unknown"}`;
}

function keepOneCardPerName(cards = []) {
  const seenNames = new Set();
  const unique = [];
  for (const card of cards) {
    const name = getCardDistinctName(card);
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    unique.push(card);
  }
  return unique;
}

function storeActionResultCards(action, ctx, targets, cards, fallbackKey = null) {
  const resultKey = action?.resultRef || action?.storeResultAs || fallbackKey;
  if (!resultKey) return;
  const storedCards = Array.isArray(cards) ? cards.filter(Boolean) : [];
  if (!ctx || typeof ctx !== "object") return;
  if (!ctx._actionTargets || typeof ctx._actionTargets !== "object") {
    ctx._actionTargets = {};
  }
  ctx._actionTargets[resultKey] = storedCards;
  if (targets && typeof targets === "object") {
    targets[resultKey] = storedCards;
  }
}

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
 * - distinctNames: boolean (default: false) - if true, selectable cards must have different names
 */
export async function handleSpecialSummonFromZone(
  action,
  ctx,
  targets,
  engine,
) {
  const { player, source, destroyed } = ctx;
  const game = engine.game;
  const promptPlayer = action.promptPlayer !== false && !isAI(player);
  const optName = action.oncePerTurnName;
  const optEffect = optName
    ? {
        oncePerTurn: true,
        oncePerTurnName: optName,
        oncePerTurnScope: action.oncePerTurnScope,
      }
    : null;

  if (!player || !game) return false;

  if (optEffect && typeof game.canUseOncePerTurn === "function") {
    const optCheck = game.canUseOncePerTurn(source, player, optEffect);
    if (!optCheck.ok) {
      getUI(game)?.log(optCheck.reason || "Effect already used this turn.");
      return false;
    }
  }

  const zoneSpec = action.zone || action.sourceZone || "deck";
  const zoneNames = Array.isArray(zoneSpec) ? zoneSpec : [zoneSpec];
  const sourceOwners = getSourceOwners(action, ctx, player);
  const count = action.count || { min: 1, max: 1 };
  const minRequired = Number(count.min ?? 1);
  const isOptionalSelection = Number.isFinite(minRequired) && minRequired <= 0;
  const requireDistinctNames = action.distinctNames === true;

  const zoneEntries = buildSourceZoneEntries(zoneNames, sourceOwners);

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
    message: getUIText("ui.summon.choosePositionTitle"),
    requirements: [
      {
        id: "special_summon_position",
        min: 1,
        max: 1,
        zone: "field",
        candidates: [
          {
            id: "attack",
            label: getUIText("ui.summon.attack"),
            position: "attack",
          },
          {
            id: "defense",
            label: getUIText("ui.summon.defense"),
            position: "defense",
          },
        ],
      },
    ],
    metadata: {
      cardData: {
        cardId: cardRef?.id ?? null,
        name:
          (cardRef && getCardDisplayName(cardRef)) ||
          cardRef?.name ||
          getUIText("ui.summon.special"),
        image: cardRef?.image ?? null,
        cardKind: cardRef?.cardKind ?? "monster",
        atk: cardRef?.atk ?? null,
        def: cardRef?.def ?? null,
        level: cardRef?.level ?? null,
      },
    },
  });

  const payBanishCost = async () => {
    if (!action.banishCost) return true;
    if (!source) {
      getUI(game)?.log("No source card available to banish as cost.");
      return false;
    }

    const sourceEntry = findSourceEntryForCard(zoneEntries, source);
    if (!sourceEntry) {
      getUI(game)?.log(`${source.name} is not in the cost zone.`);
      return false;
    }

    const moveResult = await game.moveCard(source, sourceEntry.owner, "banished", {
      fromZone: sourceEntry.name,
      contextLabel: action.contextLabel || "special_summon_banish_cost",
      sourceCard: source,
      effectId: ctx?.effect?.id || null,
      movedByEffect: false,
      awaitCardMovedEvent: true,
    });

    if (moveResult === false || moveResult?.success === false) {
      getUI(game)?.log(`${source.name} could not be banished as cost.`);
      return false;
    }

    getUI(game)?.log(`${source.name} was banished as cost.`);
    return true;
  };

  // Check for targetRef - use pre-resolved targets or context refs.
  if (action.targetRef) {
    const resolved =
      targets?.[action.targetRef] ??
      resolveTargetCards(action, ctx, targets, {
        game,
        targetRef: action.targetRef,
      });
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
        for (const entry of zoneEntries) {
          if (entry.list?.includes(card)) {
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

    if (!(await payBanishCost())) {
      return false;
    }

    return await summonCards(
      validCards,
      zoneEntries,
      player,
      action,
      engine,
      ctx,
      targets,
    );
  }

  const zoneHasCards = zoneEntries.some((entry) => entry.list.length > 0);

  if (!zoneHasCards) {
    if (isOptionalSelection) {
      getUI(game)?.log("No optional Special Summon targets available.");
      if (optEffect && typeof game.markOncePerTurnUsed === "function") {
        game.markOncePerTurnUsed(source, player, optEffect);
      }
      return true;
    }
    getUI(game)?.log(
      `No cards in ${Array.isArray(zoneSpec) ? zoneSpec.join("/") : zoneSpec}.`,
    );
    return false;
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
    const filters = { ...(action.filters || {}) };
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

    if (Number.isFinite(action.minAtk)) {
      filters.minAtk = action.minAtk;
    }

    if (Number.isFinite(action.maxAtk)) {
      filters.maxAtk = action.maxAtk;
    }

    if (Number.isFinite(action.minDef)) {
      filters.minDef = action.minDef;
    }

    if (Number.isFinite(action.maxDef)) {
      filters.maxDef = action.maxDef;
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
      }),
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

  if (requireDistinctNames) {
    candidates = keepOneCardPerName(candidates);
  }

  if (candidates.length === 0) {
    if (isOptionalSelection) {
      getUI(game)?.log("No optional Special Summon targets available.");
      if (optEffect && typeof game.markOncePerTurnUsed === "function") {
        game.markOncePerTurnUsed(source, player, optEffect);
      }
      return true;
    }
    getUI(game)?.log(
      `No valid cards in ${
        Array.isArray(zoneSpec) ? zoneSpec.join("/") : zoneSpec
      } matching filters.`,
    );
    return false;
  }

  // Determine how many cards to summon
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
    5 - player.field.length,
  );

  if (maxSelect === 0) {
    getUI(game)?.log("Field is full, cannot Special Summon.");
    return false;
  }

  if (!isOptionalSelection && maxSelect < minRequired) {
    getUI(game)?.log(
      `Need ${minRequired} valid Special Summon target(s), but only ${maxSelect} available.`,
    );
    return false;
  }

  if (!(await payBanishCost())) {
    return false;
  }

  // Helper: Escolhe carta usando estratégia do bot se disponível
  if (action.requireSource && candidates.length === 1) {
    const success = await summonCards(
      candidates,
      zoneEntries,
      player,
      action,
      engine,
      ctx,
      targets,
    );
    if (
      success &&
      optEffect &&
      typeof game.markOncePerTurnUsed === "function"
    ) {
      game.markOncePerTurnUsed(source, player, optEffect);
    }
    return success;
  }

  const smartBotSelect = (cards) => {
    // Tentar usar estratégia específica do bot se existir
    const strategy = player?.strategy;

    if (
      strategy &&
      typeof strategy.evaluateRecruitCandidate === "function"
    ) {
      const evaluation = strategy.evaluateRecruitCandidate(cards, {
        game,
        player,
        source,
        action,
      });
      if (evaluation?.blockedAll) {
        return [];
      }
      if (evaluation?.best) {
        return [evaluation.best];
      }
    }

    // Fallback: maior ATK
    return [
      cards.reduce((top, card) => {
        const cardAtk = card.atk || 0;
        const topAtk = top.atk || 0;
        return cardAtk >= topAtk ? card : top;
      }, cards[0]),
    ];
  };

  // Single card summon (original behavior)
  if (count.max === 1 || maxSelect === 1) {
    const selection = await selectCardsFromZone({
      game,
      player,
      candidates,
      maxSelect: 1,
      promptPlayer: action.promptPlayer !== false,
      botSelect: smartBotSelect,
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
            },
          );
        });
      },
    });

    if (!selection.selected || selection.selected.length === 0) {
      return false;
    }

    const success = await summonCards(
      selection.selected,
      zoneEntries,
      player,
      action,
      engine,
      ctx,
      targets,
    );
    if (
      success &&
      optEffect &&
      typeof game.markOncePerTurnUsed === "function"
    ) {
      game.markOncePerTurnUsed(source, player, optEffect);
    }
    return success;
  }

  // Multi-card summon (graveyard revival pattern)
  // Bot: usar estratégia se disponível, senão maior ATK
  const multiMinRequired = Number(count.min ?? 0);

  const dynamicMaxSelect =
    dynamicMax !== null
      ? Math.min(dynamicMax, dynamicCap, 5 - player.field.length)
      : maxSelect;

  // Helper para multi-select inteligente
  const smartBotSelectMulti = (cards, max) => {
    const strategy = player?.strategy;

    if (
      strategy &&
      typeof strategy.evaluateRecruitCandidate === "function"
    ) {
      const evaluation = strategy.evaluateRecruitCandidate(cards, {
        game,
        player,
        source,
        action,
      });
      if (evaluation?.blockedAll) {
        return [];
      }
      // Ordenar pelos scores e pegar os melhores
      const sorted = evaluation.scores
        .sort((a, b) => b.score - a.score)
        .map((s) => s.card);
      return sorted.slice(0, max);
    }

    // Fallback: maior ATK
    return cards
      .slice()
      .sort((a, b) => (b.atk || 0) - (a.atk || 0))
      .slice(0, max);
  };

  const selection = await selectCardsFromZone({
    game,
    player,
    candidates,
    maxSelect: dynamicMaxSelect,
    minSelect: multiMinRequired,
    botSelect: smartBotSelectMulti,
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
          },
        );
      });
    },
  });

  const selected = selection.selected || [];

  if (selected.length === 0) {
    if (multiMinRequired === 0) {
      getUI(game)?.log("No cards selected (optional).");
      if (typeof game.updateBoard === "function") {
        game.updateBoard();
      }
      return true;
    }

    getUI(game)?.log("No cards selected.");
    return false;
  }

  const success = await summonCards(
    selected,
    zoneEntries,
    player,
    action,
    engine,
    ctx,
    targets,
  );
  if (success && optEffect && typeof game.markOncePerTurnUsed === "function") {
    game.markOncePerTurnUsed(source, player, optEffect);
  }
  return success;
}

/**
 * Helper function to summon one or more cards
 * Unified to handle both single and multi-card summons
 */
async function summonCards(
  cards,
  sourceZoneEntries,
  player,
  action,
  engine,
  ctx = null,
  targets = null,
) {
  const game = engine.game;
  let summoned = 0;
  const summonPlayer =
    action.summonToOwner === "opponent"
      ? game?.getOpponent?.(player) ||
        (player?.id === "player" ? game?.bot : game?.player)
      : player;

  const setAtkToZero = action.setAtkToZeroAfterSummon === true;
  const setDefToZero = action.setDefToZeroAfterSummon === true;
  const atkBoostAfterSummon = Number.isFinite(action.atkBoostAfterSummon) ? action.atkBoostAfterSummon : 0;
  const defBoostAfterSummon = Number.isFinite(action.defBoostAfterSummon) ? action.defBoostAfterSummon : 0;
  const statusesOnSummon = action.statusesOnSummon || null;

  const canUseMoveCard = game && typeof game.moveCard === "function";
  const summonedCards = [];

  const fromZoneSpec =
    action.fromZone ||
    action.zone ||
    action.sourceZone ||
    action.summonZone ||
    "deck";
  const fromZoneName = Array.isArray(fromZoneSpec)
    ? null
    : typeof fromZoneSpec === "string"
      ? fromZoneSpec
      : null;

  for (const card of cards) {
    if (!card || !summonPlayer || summonPlayer.field.length >= 5) break;
    const sourceEntry = findSourceEntryForCard(sourceZoneEntries, card);

    // 🚨 CRITICAL VALIDATION: Only monsters can be special summoned to field
    if (card.cardKind !== "monster") {
      console.error(
        `[handleSpecialSummonFromZone] ❌ BLOCKED: Attempted to summon non-monster "${card.name}" (kind: ${card.cardKind}) from zone: ${fromZoneName}`,
      );
      continue; // Skip this card, continue with others
    }

    if (card.cannotBeSpecialSummoned) {
      getUI(game)?.log(`${card.name} cannot be Special Summoned.`);
      continue;
    }

    const resolvedFromZone =
      typeof action.fromZone === "string"
        ? action.fromZone
        : sourceEntry?.name ||
          (typeof engine.findCardZone === "function"
            ? engine.findCardZone(player, card)
            : fromZoneName);

    // The effect controller chooses the position even when the summon lands on
    // another player's field.
    const position = await engine.chooseSpecialSummonPosition(card, player, {
      position: action.position,
    });

    let usedMoveCard = false;
    const previousEffectsNegated = card.effectsNegated;
    const previousEffectsNegatedDuration = card.effectsNegatedDuration;
    const negateEffectsDuration = normalizeNegateEffectsDuration(action);
    if (action.negateEffects) {
      card.effectsNegated = true;
      card.effectsNegatedDuration = negateEffectsDuration;
    }

    if (canUseMoveCard) {
      const moveResult = await game.moveCard(card, summonPlayer, "field", {
        fromZone: resolvedFromZone || undefined,
        position,
        isFacedown: false,
        resetAttackFlags: true,
        statusesOnSummon,
      });

      if (moveResult?.success === false) {
        card.effectsNegated = previousEffectsNegated;
        card.effectsNegatedDuration = previousEffectsNegatedDuration;
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
        sourceEntry?.list ||
        (fallbackZoneName && player[fallbackZoneName]) ||
        player.deck ||
        [];

      const cardIndex = fallbackArr.indexOf(card);
      if (cardIndex !== -1) {
        fallbackArr.splice(cardIndex, 1);
      }

      card.position = position;
      card.isFacedown = false;
      card.hasAttacked = false;
      card.attacksUsedThisTurn = 0;
      card.owner = summonPlayer.id;
      card.controller = summonPlayer.id;

      summonPlayer.field.push(card);
    }

    if (!usedMoveCard) {
      applyStatusesOnSummon(card, statusesOnSummon);
    }

    card.cannotAttackThisTurn = action.cannotAttackThisTurn || false;

    card.effectsNegated = action.negateEffects
      ? true
      : previousEffectsNegated || false;
    card.effectsNegatedDuration = action.negateEffects
      ? negateEffectsDuration
      : previousEffectsNegatedDuration || null;

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

    if (atkBoostAfterSummon !== 0) {
      card.tempAtkBoost = (card.tempAtkBoost || 0) + atkBoostAfterSummon;
      card.atk = (card.atk || 0) + atkBoostAfterSummon;
    }

    if (defBoostAfterSummon !== 0) {
      card.tempDefBoost = (card.tempDefBoost || 0) + defBoostAfterSummon;
      card.def = (card.def || 0) + defBoostAfterSummon;
    }

    if (!usedMoveCard) {
      game.updateBoard?.();
      await game.waitForBoardPresentation?.();
      await game.emit("after_summon", {
        card: card,
        player: summonPlayer,
        method: "special",
        fromZone: resolvedFromZone || fromZoneName || "deck",
      });
    }

    summoned++;
    summonedCards.push(card);
  }

  if (summoned > 0) {
    if (ctx && typeof ctx === "object") {
      ctx.lastSpecialSummonedCards = summonedCards;
      ctx.lastSpecialSummonedCard = summonedCards[0] || null;
      storeActionResultCards(action, ctx, targets, summonedCards);
    }

    // Log message
    const zoneName = Array.isArray(action.zone)
      ? action.zone.join("/")
      : action.zone || "deck";
    const cardText =
      summonedCards.length === 1 ? summonedCards[0].name : `${summoned} cards`;
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
        summonPlayer.name || summonPlayer.id
      } Special Summoned ${cardText} from ${zoneName}${
        positionText ? ` in ${positionText} Position` : ""
      }${restrictText}${negateText}.`,
    );

    game.updateBoard();
  }

  return summoned > 0;
}
