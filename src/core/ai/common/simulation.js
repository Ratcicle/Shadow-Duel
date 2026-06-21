import {
  applySimulatedActions,
  evaluateSimulatedConditions,
  moveCardToZone,
  selectSimulatedTargets,
} from "../StrategyUtils.js";
import {
  fieldHasTributeValue,
  getTributeCardsFromIndices,
  getTributeValueTotal,
} from "../../game/summon/tributeValue.js";

export function resolveSimulatedHandIndex(player, action, expectedKind = null) {
  const hand = player?.hand || [];
  const matches = (card) => {
    if (!card) return false;
    if (expectedKind) {
      const kinds = Array.isArray(expectedKind) ? expectedKind : [expectedKind];
      if (!kinds.includes(card.cardKind)) return false;
    }
    if (typeof action.cardId === "number" && card.id === action.cardId) {
      return true;
    }
    if (action.cardName && card.name === action.cardName) return true;
    return false;
  };

  if (Number.isInteger(action.index) && matches(hand[action.index])) {
    return action.index;
  }
  return hand.findIndex(matches);
}

export function resolveSimulatedFieldIndex(player, action, predicate = null) {
  const field = player?.field || [];
  const matches = (card) => {
    if (!card) return false;
    if (typeof predicate === "function" && !predicate(card)) return false;
    if (typeof action.cardId === "number" && card.id === action.cardId) {
      return true;
    }
    if (action.cardName && card.name === action.cardName) return true;
    return !action.cardId && !action.cardName;
  };

  if (Number.isInteger(action.fieldIndex) && matches(field[action.fieldIndex])) {
    return action.fieldIndex;
  }
  if (
    Number.isInteger(action.materialIndex) &&
    matches(field[action.materialIndex])
  ) {
    return action.materialIndex;
  }
  return field.findIndex(matches);
}

function buildSelectionOptions(options = {}) {
  const actionContext =
    options.actionContext ||
    options.activationContext?.actionContext ||
    {};
  return {
    ...options,
    archetype: options.archetype,
    preferDefense: options.preferDefense,
    actionContext,
    activationContext: options.activationContext,
    targetPreferences:
      options.targetPreferences || actionContext.targetPreferences || {},
    specialSummonPositions:
      options.specialSummonPositions || actionContext.specialSummonPositions || {},
  };
}

function getSimOncePerTurnKey(effect, sourceCard) {
  if (!effect) return null;
  return (
    effect.oncePerTurnName ||
    (sourceCard?.name && effect.id ? `${sourceCard.name}:${effect.id}` : null) ||
    effect.id ||
    null
  );
}

function getSimOptBucket(state, selfId = "bot") {
  if (!state) return null;
  if (!state._simOncePerTurn) state._simOncePerTurn = {};
  const key = selfId || "bot";
  if (Array.isArray(state._simOncePerTurn[key])) {
    state._simOncePerTurn[key] = new Set(state._simOncePerTurn[key]);
  }
  if (!state._simOncePerTurn[key]) state._simOncePerTurn[key] = new Set();
  return state._simOncePerTurn[key];
}

function canUseSimulatedEffect(state, effect, sourceCard, selfId = "bot") {
  if (!effect?.oncePerTurn && !effect?.oncePerTurnName) return true;
  const key = getSimOncePerTurnKey(effect, sourceCard);
  if (!key) return true;
  const bucket = getSimOptBucket(state, selfId);
  return !bucket?.has(key);
}

function markSimulatedEffectUsed(state, effect, sourceCard, selfId = "bot") {
  if (!effect?.oncePerTurn && !effect?.oncePerTurnName) return;
  const key = getSimOncePerTurnKey(effect, sourceCard);
  if (!key) return;
  const bucket = getSimOptBucket(state, selfId);
  bucket?.add(key);
}

function effectConditionsPass(state, effect, sourceCard, options = {}) {
  if (!effect?.conditions) return true;
  return evaluateSimulatedConditions(effect.conditions, {
    state,
    selfId: options.selfId || "bot",
    options,
    sourceCard,
  });
}

function resolveEffectForAction(card, action, allowedTimings = []) {
  const effects = Array.isArray(card?.effects) ? card.effects : [];
  const effectId = action?.effectId || action?.effect?.id || null;
  if (effectId) {
    const exact = effects.find((entry) => entry?.id === effectId);
    if (exact) return exact;
  }
  return effects.find(
    (entry) =>
      entry &&
      (allowedTimings.length === 0 || allowedTimings.includes(entry.timing)),
  );
}

export function simulateGenericSpellEffect(state, card, options = {}) {
  if (!card || !Array.isArray(card.effects)) return;
  const effect = card.effects.find(
    (entry) => entry && entry.timing === "on_play",
  );
  if (!effect) return;
  if (!effectConditionsPass(state, effect, card, options)) return;
  if (!canUseSimulatedEffect(state, effect, card, options.selfId || "bot")) {
    return;
  }

  const selectionOptions = buildSelectionOptions(options);
  const selections = selectSimulatedTargets({
    targets: effect.targets || [],
    actions: effect.actions || [],
    state,
    sourceCard: card,
    selfId: options.selfId || "bot",
    options: selectionOptions,
  });
  applySimulatedActions({
    actions: effect.actions || [],
    selections,
    state,
    selfId: options.selfId || "bot",
    options: { ...selectionOptions, sourceCard: card },
  });
  markSimulatedEffectUsed(state, effect, card, options.selfId || "bot");
}

function resolvesToGraveyardAfterActivation(card) {
  if (!card || card.cardKind !== "spell") return false;
  return (
    card.subtype === "normal" ||
    card.subtype === "quick" ||
    card.subtype === "quick-play" ||
    card.subtype === "quickplay"
  );
}

function setSimulatedSpellTrapAfterResolution(player, card, state) {
  if (!player || !card) return false;
  player.spellTrap = player.spellTrap || [];
  if (player.spellTrap.length >= 5 && !player.spellTrap.includes(card)) {
    return false;
  }
  card.isFacedown = true;
  if (typeof state.turnCounter === "number") {
    card.turnSetOn = state.turnCounter;
    card.setTurn = state.turnCounter;
  }
  delete card.__simSetAfterResolution;
  if (!player.spellTrap.includes(card)) {
    player.spellTrap.push(card);
  }
  return true;
}

function runActionOverride(state, action, options) {
  const override = options.actionOverrides?.[action.type];
  if (typeof override !== "function") return false;
  const result = override({
    state,
    action,
    options,
    resolveSimulatedHandIndex,
    resolveSimulatedFieldIndex,
  });
  return result === true || result?.handled === true;
}

export function applyGenericSimulatedMainPhaseAction(
  state,
  action,
  options = {},
) {
  if (!action) return state;

  if (!state._isPerspectiveState && state.player && state.bot) {
    console.error(
      `[${options.guardLabel || "Simulation"}] CRITICAL: Simulating on REAL game state!`,
      {
        action: action.type,
        card: action.cardName || state.bot?.hand?.[action.index]?.name,
      },
    );
  }

  if (runActionOverride(state, action, options)) {
    return state;
  }

  const selectionOptions = buildSelectionOptions({
    ...options,
    activationContext: action.activationContext || options.activationContext,
    sourceAction: action,
  });

  switch (action.type) {
    case "summon": {
      const player = state.bot;
      const handIndex = resolveSimulatedHandIndex(player, action, "monster");
      const card = player.hand[handIndex];
      if (!card) break;
      if (card.cardKind !== "monster") break;
      if (card.cannotBeNormalSummonedOrSet) break;
      if (card.summonRestrict === "shadow_heart_invocation_only") break;
      const tributeInfo = options.getTributeRequirementFor?.(card, player) || {
        tributesNeeded: 0,
      };
      const tributesNeeded = Math.max(0, Number(tributeInfo.tributesNeeded) || 0);
      if (!fieldHasTributeValue(player.field || [], tributesNeeded, card)) break;

      const tributeIndices =
        options.selectBestTributes?.(player.field, tributesNeeded, card, {
          botState: player,
          oppField: state.player?.field || [],
          game: state,
        }) || [];
      const validTributeIndices = [...new Set(tributeIndices)].filter(
        (idx) =>
          Number.isInteger(idx) &&
          idx >= 0 &&
          idx < (player.field || []).length,
      );
      const tributeCards = getTributeCardsFromIndices(
        player.field || [],
        validTributeIndices,
      );
      if (getTributeValueTotal(tributeCards, card) < tributesNeeded) break;
      if ((player.field || []).length - validTributeIndices.length + 1 > 5) break;

      validTributeIndices.sort((a, b) => b - a);
      validTributeIndices.forEach((idx) => {
        const tribute = player.field[idx];
        if (tribute) {
          moveCardToZone(player, tribute, "graveyard");
        }
      });

      player.hand.splice(handIndex, 1);
      const newCard = { ...card };
      const summonPosition = action.position === "defense" ? "defense" : "attack";
      newCard.position = summonPosition;
      newCard.isFacedown = action.facedown === true || summonPosition === "defense";
      newCard.hasAttacked = false;
      newCard.attacksUsedThisTurn = 0;
      if (newCard.cardKind !== "monster") {
        console.error(
          `[${options.guardLabel || "Simulation"}] BLOCKED sim: ${newCard.cardKind} "${newCard.name}" tried to enter field!`,
        );
        player.graveyard.push(newCard);
      } else {
        player.field.push(newCard);
        options.onAfterSummon?.({ state, action, player, card, newCard, options });
      }
      player.summonCount = (player.summonCount || 0) + 1;
      break;
    }

    case "position_change": {
      const player = state.bot;
      const target = (player.field || []).find(
        (card) =>
          card &&
          (card.id === action.cardId ||
            (!action.cardId && card.name === action.cardName)),
      );
      if (!target) break;
      if (target.positionChangedThisTurn) break;
      if (target.hasAttacked) break;
      if (target.isFacedown) {
        target.isFacedown = false;
        target.position = "attack";
        target.positionChangedThisTurn = true;
        target.cannotAttackThisTurn = false;
        break;
      }
      const newPosition =
        action.toPosition === "defense" ? "defense" : "attack";
      if (target.position === newPosition) break;
      target.position = newPosition;
      target.positionChangedThisTurn = true;
      target.cannotAttackThisTurn = newPosition === "defense";
      break;
    }

    case "monsterEffect": {
      const player = state.bot;
      const fieldIndex = Number.isInteger(action.fieldIndex)
        ? action.fieldIndex
        : player.field.findIndex(
            (card) =>
              card &&
              (card.id === action.cardId ||
                (!action.cardId && card.name === action.cardName)),
          );
      const card = player.field?.[fieldIndex];
      if (!card || card.cardKind !== "monster" || card.isFacedown) break;
      const effect = (card.effects || []).find(
        (entry) =>
          entry &&
          entry.timing === "ignition" &&
          (!entry.requireZone || entry.requireZone === "field"),
      );
      if (!effect) break;
      if (!effectConditionsPass(state, effect, card, selectionOptions)) break;
      if (!canUseSimulatedEffect(state, effect, card, options.selfId || "bot")) {
        break;
      }

      const handled = options.onMonsterEffect?.({
        state,
        action,
        player,
        card,
        fieldIndex,
        effect,
        options,
      });
      if (handled) break;

      const selections = selectSimulatedTargets({
        targets: effect.targets || [],
        actions: effect.actions || [],
        state,
        sourceCard: card,
        selfId: options.selfId || "bot",
        options: selectionOptions,
      });
      applySimulatedActions({
        actions: effect.actions || [],
        selections,
        state,
        selfId: options.selfId || "bot",
        options: { ...selectionOptions, sourceCard: card },
      });
      markSimulatedEffectUsed(state, effect, card, options.selfId || "bot");
      options.onEffectActivated?.({
        state,
        action,
        player,
        card,
        effect,
        zone: "field",
        options,
      });
      break;
    }

    case "handIgnition": {
      const player = state.bot;
      const handIndex = resolveSimulatedHandIndex(player, action, "monster");
      const card = player.hand?.[handIndex];
      if (!card || card.cardKind !== "monster") break;
      const effect = resolveEffectForAction(card, action, ["ignition"]);
      if (!effect || effect.requireZone !== "hand") break;
      if (!effectConditionsPass(state, effect, card, selectionOptions)) break;
      if (!canUseSimulatedEffect(state, effect, card, options.selfId || "bot")) {
        break;
      }
      const selections = selectSimulatedTargets({
        targets: effect.targets || [],
        actions: effect.actions || [],
        state,
        sourceCard: card,
        selfId: options.selfId || "bot",
        options: selectionOptions,
      });
      applySimulatedActions({
        actions: effect.actions || [],
        selections,
        state,
        selfId: options.selfId || "bot",
        options: { ...selectionOptions, sourceCard: card },
      });
      markSimulatedEffectUsed(state, effect, card, options.selfId || "bot");
      options.onEffectActivated?.({
        state,
        action,
        player,
        card,
        effect,
        zone: "hand",
        options,
      });
      break;
    }

    case "spell": {
      const player = state.bot;
      const handIndex = resolveSimulatedHandIndex(player, action, "spell");
      const card = player.hand[handIndex];
      if (!card) break;
      const onPlayEffect = resolveEffectForAction(card, action, ["on_play"]);
      if (
        onPlayEffect &&
        (!effectConditionsPass(state, onPlayEffect, card, selectionOptions) ||
          !canUseSimulatedEffect(
            state,
            onPlayEffect,
            card,
            options.selfId || "bot",
          ))
      ) {
        break;
      }
      player.hand.splice(handIndex, 1);
      const placedCard = { ...card };
      simulateGenericSpellEffect(state, placedCard, selectionOptions);
      if (placedCard.__simSetAfterResolution) {
        if (!setSimulatedSpellTrapAfterResolution(player, placedCard, state)) {
          delete placedCard.__simSetAfterResolution;
          player.graveyard.push(placedCard);
        }
        break;
      }
      if (resolvesToGraveyardAfterActivation(placedCard)) {
        player.graveyard.push(placedCard);
        break;
      }
      const placement = options.placeSpellCard?.(state, placedCard) || {
        placed: false,
      };
      if (!placement.placed) {
        player.graveyard.push(placedCard);
      }
      break;
    }

    case "set_spell_trap": {
      const player = state.bot;
      const handIndex = resolveSimulatedHandIndex(player, action, [
        "spell",
        "trap",
      ]);
      const card = player.hand[handIndex];
      if (!card) break;
      if (card.cardKind === "spell" && card.subtype === "field") break;
      player.hand.splice(handIndex, 1);
      const setCard = { ...card, isFacedown: true };
      if (typeof state.turnCounter === "number") {
        setCard.turnSetOn = state.turnCounter;
      }
      player.spellTrap = player.spellTrap || [];
      if (player.spellTrap.length < 5) {
        player.spellTrap.push(setCard);
      } else {
        player.graveyard.push(setCard);
      }
      break;
    }

    case "spellTrapEffect": {
      const player = state.bot;
      const zoneIndex = Number.isInteger(action.zoneIndex)
        ? action.zoneIndex
        : action.index;
      const card = player.spellTrap?.[zoneIndex];
      if (!card) break;
      card.isFacedown = false;

      const effect = resolveEffectForAction(card, action, [
        "ignition",
        "on_play",
      ]);
      if (effect) {
        if (!effectConditionsPass(state, effect, card, selectionOptions)) break;
        if (!canUseSimulatedEffect(state, effect, card, options.selfId || "bot")) {
          break;
        }
        const selections = selectSimulatedTargets({
          targets: effect.targets || [],
          actions: effect.actions || [],
          state,
          sourceCard: card,
          selfId: options.selfId || "bot",
          options: selectionOptions,
        });
        applySimulatedActions({
          actions: effect.actions || [],
          selections,
          state,
          selfId: options.selfId || "bot",
          options: { ...selectionOptions, sourceCard: card },
        });
        markSimulatedEffectUsed(state, effect, card, options.selfId || "bot");
        options.onEffectActivated?.({
          state,
          action,
          player,
          card,
          effect,
          zone: "spellTrap",
          options,
        });
      }

      if (resolvesToGraveyardAfterActivation(card)) {
        if (card.__simSetAfterResolution) {
          setSimulatedSpellTrapAfterResolution(player, card, state);
          break;
        }
        player.graveyard.push(card);
        if (Array.isArray(player.spellTrap)) {
          player.spellTrap.splice(zoneIndex, 1);
        }
      }
      break;
    }

    case "fieldEffect": {
      const player = state.bot;
      const fieldSpell = player.fieldSpell;
      if (!fieldSpell) break;
      const effect =
        resolveEffectForAction(fieldSpell, action, ["on_field_activate"]) ||
        (fieldSpell.effects || []).find(
          (entry) =>
            entry &&
            entry.timing === "ignition" &&
            entry.requireZone === "fieldSpell",
        );
      if (!effect) break;
      if (!effectConditionsPass(state, effect, fieldSpell, selectionOptions)) {
        break;
      }
      if (!canUseSimulatedEffect(state, effect, fieldSpell, options.selfId || "bot")) {
        break;
      }
      const targetPreference =
        options.getFieldEffectTargetPreference?.({
          state,
          action,
          player,
          fieldSpell,
          effect,
          options,
        }) || null;
      const selections = selectSimulatedTargets({
        targets: effect.targets || [],
        actions: effect.actions || [],
        state,
        sourceCard: fieldSpell,
        selfId: options.selfId || "bot",
        options: {
          ...selectionOptions,
          preferDefense: !targetPreference,
          targetPreference,
          opponentField: state.player?.field || [],
          opponentLp: state.player?.lp || 0,
        },
      });
      applySimulatedActions({
        actions: effect.actions || [],
        selections,
        state,
        selfId: options.selfId || "bot",
        options: {
          ...selectionOptions,
          sourceCard: fieldSpell,
          targetPreference,
        },
      });
      markSimulatedEffectUsed(state, effect, fieldSpell, options.selfId || "bot");
      options.onEffectActivated?.({
        state,
        action,
        player,
        card: fieldSpell,
        effect,
        zone: "fieldSpell",
        options,
      });
      break;
    }

    case "graveyardMonsterEffect": {
      const player = state.bot;
      const graveyardIndex = Number.isInteger(action.graveyardIndex)
        ? action.graveyardIndex
        : player.graveyard?.findIndex(
            (card) =>
              card &&
              card.cardKind === "monster" &&
              (card.id === action.cardId ||
                (!action.cardId && card.name === action.cardName)),
          );
      const card = player.graveyard?.[graveyardIndex];
      if (!card || card.cardKind !== "monster") break;
      const effect = resolveEffectForAction(card, action, ["ignition"]);
      if (!effect || effect.requireZone !== "graveyard") break;
      if (!effectConditionsPass(state, effect, card, selectionOptions)) break;
      if (!canUseSimulatedEffect(state, effect, card, options.selfId || "bot")) {
        break;
      }
      const selections = selectSimulatedTargets({
        targets: effect.targets || [],
        actions: effect.actions || [],
        state,
        sourceCard: card,
        selfId: options.selfId || "bot",
        options: selectionOptions,
      });
      applySimulatedActions({
        actions: effect.actions || [],
        selections,
        state,
        selfId: options.selfId || "bot",
        options: { ...selectionOptions, sourceCard: card },
      });
      markSimulatedEffectUsed(state, effect, card, options.selfId || "bot");
      options.onEffectActivated?.({
        state,
        action,
        player,
        card,
        effect,
        zone: "graveyard",
        options,
      });
      break;
    }

    case "ascension": {
      const player = state.bot;
      const materialIndex = resolveSimulatedFieldIndex(
        player,
        { materialIndex: action.materialIndex },
        (card) => card.cardKind === "monster" && !card.isFacedown,
      );
      const material = player.field?.[materialIndex];
      if (!material) break;
      const extraIndex = (player.extraDeck || []).findIndex(
        (card) =>
          card &&
          (card.id === action.ascensionCard?.id ||
            card.name === action.cardName ||
            card.name === action.ascensionCard?.name),
      );
      const ascensionCard =
        extraIndex >= 0 ? player.extraDeck[extraIndex] : action.ascensionCard;
      if (!ascensionCard) break;
      player.field.splice(materialIndex, 1);
      player.graveyard.push(material);
      if (extraIndex >= 0) player.extraDeck.splice(extraIndex, 1);
      player.field.push({
        ...ascensionCard,
        position:
          action.position || ascensionCard.ascension?.position || "attack",
        isFacedown: false,
        hasAttacked: false,
        attacksUsedThisTurn: 0,
      });
      break;
    }

    default:
      break;
  }

  return state;
}
