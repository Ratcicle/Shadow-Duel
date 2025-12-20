import BaseStrategy from "./BaseStrategy.js";
import {
  applySimulatedActions,
  estimateCardValue,
  estimateMonsterValue,
  hasArchetype,
  selectSimulatedTargets,
} from "./StrategyUtils.js";

export default class LuminarchStrategy extends BaseStrategy {
  evaluateBoard(gameOrState, perspectivePlayer) {
    const perspective = perspectivePlayer?.id
      ? perspectivePlayer
      : gameOrState.bot;
    const opponent = this.getOpponent(gameOrState, perspective);
    const archetype = "Luminarch";
    const fieldSpell = perspective?.fieldSpell || null;
    const preferDefense = true;

    let score = 0;
    score += ((perspective?.lp || 0) - (opponent?.lp || 0)) / 900;

    const ownMonstersValue = (perspective?.field || []).reduce(
      (sum, monster) =>
        sum +
        estimateMonsterValue(monster, {
          archetype,
          fieldSpell,
          preferDefense,
        }),
      0
    );
    const oppMonstersValue = (opponent?.field || []).reduce(
      (sum, monster) =>
        sum +
        estimateMonsterValue(monster, {
          fieldSpell: opponent?.fieldSpell || null,
          preferDefense: false,
        }),
      0
    );
    score += ownMonstersValue - oppMonstersValue;

    const opponentStrongest = (opponent?.field || []).reduce((max, monster) => {
      if (!monster || monster.cardKind !== "monster" || monster.isFacedown) {
        return max;
      }
      return Math.max(max, monster.atk || 0);
    }, 0);
    const exposedAttackers = (perspective?.field || []).filter(
      (monster) =>
        monster &&
        monster.cardKind === "monster" &&
        monster.position === "attack" &&
        (monster.atk || 0) + (monster.tempAtkBoost || 0) <
          Math.max(500, opponentStrongest - 200)
    ).length;
    score -= exposedAttackers * 0.25;

    const tauntValue = (perspective?.field || []).reduce((sum, monster) => {
      if (!monster || !monster.mustBeAttacked) return sum;
      return sum + (monster.def || 0) / 2000 + 0.3;
    }, 0);
    score += tauntValue;

    const overfillPenalty =
      Math.max(0, (perspective?.field || []).length - 3) * 0.3;
    score -= overfillPenalty;

    score += fieldSpell ? 0.9 : 0;
    score -= opponent?.fieldSpell ? 0.6 : 0;

    score += (perspective?.spellTrap || []).length * 0.2;
    score -= (opponent?.spellTrap || []).length * 0.15;

    score +=
      ((perspective?.hand || []).length -
        (opponent?.hand || []).length) *
      0.25;

    const handValue = (perspective?.hand || []).reduce(
      (sum, card) =>
        sum +
        estimateCardValue(card, {
          archetype,
          fieldSpell,
          preferDefense,
        }),
      0
    );
    score += handValue * 0.2;

    const gyValue = (perspective?.graveyard || []).reduce((sum, card) => {
      if (!card || card.cardKind !== "monster") return sum;
      if (!hasArchetype(card, archetype)) return sum;
      const value = (card.atk || 0) / 2000 + (card.level || 0) * 0.08;
      return sum + value;
    }, 0);
    score += gyValue * 0.2;

    if ((perspective?.field || []).length === 0 && opponentStrongest > 0) {
      score -= 0.4;
    }

    return score;
  }

  generateMainPhaseActions(game) {
    const actions = [];
    const bot = this.bot;
    const activationContext = {
      autoSelectSingleTarget: true,
      logTargets: false,
    };

    if (bot.summonCount < 1) {
      bot.hand.forEach((card, index) => {
        if (card.cardKind !== "monster") return;
        const tributeInfo = this.getTributeRequirementFor(card, bot);
        if (bot.field.length < tributeInfo.tributesNeeded) return;
        if (bot.field.length >= 5) return;

        const preferredPosition = this.chooseSummonPosition(card, game);
        const facedown = this.shouldSetFacedown(card, preferredPosition);
        actions.push({
          type: "summon",
          index,
          position: preferredPosition,
          facedown,
        });
      });
    }

    bot.hand.forEach((card, index) => {
      if (card.cardKind !== "spell") return;

      if (
        game.effectEngine?.canActivateSpellFromHandPreview &&
        typeof game.effectEngine.canActivateSpellFromHandPreview === "function"
      ) {
        const preview = game.effectEngine.canActivateSpellFromHandPreview(
          card,
          bot,
          { activationContext }
        );
        if (preview && preview.ok === false) return;
      } else {
        const check = game.effectEngine?.canActivate?.(card, bot);
        if (check && !check.ok) return;
      }

      actions.push({ type: "spell", index });
    });

    if (bot.fieldSpell) {
      const effect = (bot.fieldSpell.effects || []).find(
        (e) => e.timing === "on_field_activate"
      );
      if (effect) {
        const preview = game.effectEngine?.canActivateFieldSpellEffectPreview?.(
          bot.fieldSpell,
          bot,
          null,
          { activationContext }
        );
        if (!preview || preview.ok) {
          actions.push({ type: "fieldEffect" });
        }
      }
    }

    return this.sequenceActions(actions);
  }

  sequenceActions(actions) {
    const typePriority = {
      fieldEffect: 0,
      spell: 1,
      summon: 2,
    };
    return [...actions].sort((a, b) => {
      const priorityA = typePriority[a.type] ?? 9;
      const priorityB = typePriority[b.type] ?? 9;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return 0;
    });
  }

  getTributeRequirementFor(card, playerState) {
    let tributesNeeded = 0;
    if (card.level >= 5 && card.level <= 6) tributesNeeded = 1;
    else if (card.level >= 7) tributesNeeded = 2;

    let usingAlt = false;
    const alt = card.altTribute;
    if (
      alt?.type === "no_tribute_if_empty_field" &&
      (playerState.field?.length || 0) === 0 &&
      tributesNeeded > 0
    ) {
      tributesNeeded = 0;
      usingAlt = true;
    }
    if (alt && playerState.field?.some((c) => c.name === alt.requiresName)) {
      if (alt.tributes < tributesNeeded) {
        tributesNeeded = alt.tributes;
        usingAlt = true;
      }
    }

    return { tributesNeeded, usingAlt, alt };
  }

  selectBestTributes(field, tributesNeeded, cardToSummon) {
    if (tributesNeeded <= 0 || !field || field.length < tributesNeeded) {
      return [];
    }

    const monstersWithValue = field.map((monster, index) => {
      const value = estimateMonsterValue(monster, {
        archetype: "Luminarch",
        fieldSpell: this.bot.fieldSpell,
        preferDefense: true,
      });
      return { monster, index, value };
    });

    monstersWithValue.sort((a, b) => a.value - b.value);
    return monstersWithValue.slice(0, tributesNeeded).map((t) => t.index);
  }

  chooseSummonPosition(card, game) {
    const opponent = game?.player || { field: [] };
    const opponentStrongest = (opponent.field || []).reduce((max, monster) => {
      if (!monster || monster.cardKind !== "monster" || monster.isFacedown) {
        return max;
      }
      return Math.max(max, monster.atk || 0);
    }, 0);

    const atk = card.atk || 0;
    const def = card.def || 0;
    const isTaunt = !!card.mustBeAttacked;
    const canPierce = !!card.piercing;

    if (opponentStrongest <= 0) return "attack";
    if (isTaunt && def >= atk) return "defense";
    if (def >= opponentStrongest + 300) return "defense";
    if (atk >= opponentStrongest + 200) return "attack";
    if (canPierce && atk >= opponentStrongest) return "attack";
    if (def >= atk && opponentStrongest > atk) return "defense";
    return "attack";
  }

  shouldSetFacedown(card, position) {
    if (position !== "defense") return false;
    if (!card) return true;
    if (card.mustBeAttacked || card.battleIndestructibleOncePerTurn) {
      return false;
    }
    const effects = Array.isArray(card.effects) ? card.effects : [];
    const hasSummonEffect = effects.some(
      (effect) => effect && effect.timing === "on_event" && effect.event
    );
    const hasIgnition = effects.some(
      (effect) => effect && effect.timing === "ignition"
    );
    return !(hasSummonEffect || hasIgnition);
  }

  getOpponent(gameOrState, perspectivePlayer) {
    if (typeof gameOrState.getOpponent === "function") {
      return gameOrState.getOpponent(perspectivePlayer);
    }
    return gameOrState.player && perspectivePlayer?.id === "bot"
      ? gameOrState.player
      : gameOrState.bot;
  }

  simulateMainPhaseAction(state, action) {
    if (!action) return state;

    switch (action.type) {
      case "summon": {
        const player = state.bot;
        const card = player.hand[action.index];
        if (!card) break;
        const tributeInfo = this.getTributeRequirementFor(card, player);
        const tributesNeeded = tributeInfo.tributesNeeded;

        const tributeIndices = this.selectBestTributes(
          player.field,
          tributesNeeded,
          card
        );

        tributeIndices.sort((a, b) => b - a);
        tributeIndices.forEach((idx) => {
          const t = player.field[idx];
          if (t) {
            player.graveyard.push(t);
            player.field.splice(idx, 1);
          }
        });

        player.hand.splice(action.index, 1);
        const newCard = { ...card };
        newCard.position = action.position;
        newCard.isFacedown = action.facedown;
        newCard.hasAttacked = false;
        newCard.attacksUsedThisTurn = 0;
        player.field.push(newCard);
        player.summonCount = (player.summonCount || 0) + 1;
        break;
      }
      case "spell": {
        const player = state.bot;
        const card = player.hand[action.index];
        if (!card) break;
        player.hand.splice(action.index, 1);
        const placedCard = { ...card };
        this.simulateSpellEffect(state, placedCard);
        const placement = this.placeSpellCard(state, placedCard);
        if (!placement.placed) {
          player.graveyard.push(placedCard);
        }
        break;
      }
      case "fieldEffect": {
        const player = state.bot;
        const fieldSpell = player.fieldSpell;
        if (!fieldSpell) break;
        const effect = (fieldSpell.effects || []).find(
          (entry) => entry && entry.timing === "on_field_activate"
        );
        if (!effect) break;
        const selections = selectSimulatedTargets({
          targets: effect.targets || [],
          actions: effect.actions || [],
          state,
          sourceCard: fieldSpell,
          selfId: "bot",
          options: { archetype: "Luminarch", preferDefense: true },
        });
        applySimulatedActions({
          actions: effect.actions || [],
          selections,
          state,
          selfId: "bot",
          options: { archetype: "Luminarch", preferDefense: true },
        });
        break;
      }
      default:
        break;
    }

    return state;
  }

  simulateSpellEffect(state, card) {
    if (!card || !Array.isArray(card.effects)) return;
    const effect = card.effects.find(
      (entry) => entry && entry.timing === "on_play"
    );
    if (!effect) return;
    const selections = selectSimulatedTargets({
      targets: effect.targets || [],
      actions: effect.actions || [],
      state,
      sourceCard: card,
      selfId: "bot",
      options: { archetype: "Luminarch", preferDefense: true },
    });
    applySimulatedActions({
      actions: effect.actions || [],
      selections,
      state,
      selfId: "bot",
      options: { archetype: "Luminarch", preferDefense: true },
    });
  }
}
