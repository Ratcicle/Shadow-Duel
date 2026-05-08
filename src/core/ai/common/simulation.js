import {
  applySimulatedActions,
  selectSimulatedTargets,
} from "../StrategyUtils.js";

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
  return {
    archetype: options.archetype,
    preferDefense: options.preferDefense,
  };
}

export function simulateGenericSpellEffect(state, card, options = {}) {
  if (!card || !Array.isArray(card.effects)) return;
  const effect = card.effects.find(
    (entry) => entry && entry.timing === "on_play",
  );
  if (!effect) return;

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
    options: selectionOptions,
  });
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

  const selectionOptions = buildSelectionOptions(options);

  switch (action.type) {
    case "summon": {
      const player = state.bot;
      const handIndex = resolveSimulatedHandIndex(player, action, "monster");
      const card = player.hand[handIndex];
      if (!card) break;
      const tributeInfo = options.getTributeRequirementFor?.(card, player) || {
        tributesNeeded: 0,
      };
      const tributesNeeded = tributeInfo.tributesNeeded;

      const tributeIndices =
        options.selectBestTributes?.(player.field, tributesNeeded, card, {
          botState: player,
          oppField: state.player?.field || [],
          game: state,
        }) || [];

      tributeIndices.sort((a, b) => b - a);
      tributeIndices.forEach((idx) => {
        const tribute = player.field[idx];
        if (tribute) {
          player.graveyard.push(tribute);
          player.field.splice(idx, 1);
        }
      });

      player.hand.splice(handIndex, 1);
      const newCard = { ...card };
      newCard.position = action.position;
      newCard.isFacedown = action.facedown;
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
      if (target.isFacedown) break;
      if (target.positionChangedThisTurn) break;
      if (target.hasAttacked) break;
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
        options: selectionOptions,
      });
      break;
    }

    case "spell": {
      const player = state.bot;
      const handIndex = resolveSimulatedHandIndex(player, action, "spell");
      const card = player.hand[handIndex];
      if (!card) break;
      player.hand.splice(handIndex, 1);
      const placedCard = { ...card };
      simulateGenericSpellEffect(state, placedCard, options);
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

      const effect = (card.effects || []).find(
        (entry) =>
          entry &&
          (entry.timing === "ignition" || entry.timing === "on_play"),
      );
      if (effect) {
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
          options: selectionOptions,
        });
      }

      if (
        card.cardKind === "spell" &&
        (card.subtype === "normal" ||
          card.subtype === "quick" ||
          card.subtype === "quick-play")
      ) {
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
      const effect = (fieldSpell.effects || []).find(
        (entry) => entry && entry.timing === "on_field_activate",
      );
      if (!effect) break;
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
        options: selectionOptions,
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
