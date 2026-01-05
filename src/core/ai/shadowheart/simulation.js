// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/shadowheart/simulation.js
// Simulação de ações para lookahead (BeamSearch/GameTree).
// ─────────────────────────────────────────────────────────────────────────────

import { isShadowHeart } from "./knowledge.js";
import { selectBestTributes, getTributeRequirementFor } from "./priorities.js";

/**
 * Simula uma ação de main phase no estado clonado.
 * @param {Object} state - Estado clonado do jogo
 * @param {Object} action - Ação a simular
 * @param {Function} placeSpellCard - Função para posicionar spell
 * @returns {Object} Estado modificado
 */
export function simulateMainPhaseAction(state, action, placeSpellCard) {
  if (!action) return state;

  switch (action.type) {
    case "summon": {
      const player = state.bot;
      const card = player.hand[action.index];
      if (!card) break;

      const tributeInfo = getTributeRequirementFor(card, player);
      const tributeIndices = selectBestTributes(
        player.field,
        tributeInfo.tributesNeeded,
        card
      );

      // Remove tributos
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
      simulateSpellEffect(state, placedCard);
      const placement = placeSpellCard(state, placedCard);
      if (!placement.placed) {
        player.graveyard.push(placedCard);
      }
      break;
    }
    case "fieldEffect": {
      const player = state.bot;
      if (player.fieldSpell?.name === "Darkness Valley") {
        player.field.forEach((m) => {
          if (isShadowHeart(m)) {
            m.atk = (m.atk || 0) + 300;
          }
        });
      }
      break;
    }
  }

  return state;
}

/**
 * Simula efeito de uma spell específica.
 * @param {Object} state
 * @param {Object} card
 */
export function simulateSpellEffect(state, card) {
  const player = state.bot;
  const opponent = state.player;

  switch (card.name) {
    case "Polymerization": {
      // Simula fusão
      const scaleIdx = player.field.findIndex(
        (c) => c.name === "Shadow-Heart Scale Dragon"
      );
      const materialIdx = player.field.findIndex(
        (c, i) =>
          i !== scaleIdx && isShadowHeart(c) && (c.level || 0) >= 5
      );

      if (scaleIdx !== -1) {
        player.graveyard.push(player.field[scaleIdx]);
        player.field.splice(scaleIdx, 1);
      }
      if (materialIdx !== -1 && materialIdx !== scaleIdx) {
        const adjustedIdx =
          materialIdx > scaleIdx ? materialIdx - 1 : materialIdx;
        player.graveyard.push(player.field[adjustedIdx]);
        player.field.splice(adjustedIdx, 1);
      }

      if (player.field.length < 5) {
        player.field.push({
          name: "Shadow-Heart Demon Dragon",
          atk: 3000,
          def: 3000,
          level: 10,
          position: "attack",
          hasAttacked: false,
          cardKind: "monster",
          archetypes: ["Shadow-Heart"],
        });
      }
      break;
    }
    case "Shadow-Heart Infusion": {
      if (player.hand.length >= 2 && player.field.length < 5) {
        const discards = player.hand.splice(0, 2);
        player.graveyard.push(...discards);

        const target = player.graveyard
          .filter((c) => isShadowHeart(c) && c.cardKind === "monster")
          .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];

        if (target) {
          const idx = player.graveyard.indexOf(target);
          player.graveyard.splice(idx, 1);
          target.position = "attack";
          target.cannotAttackThisTurn = true;
          player.field.push(target);
        }
      }
      break;
    }
    case "Darkness Valley": {
      player.fieldSpell = { ...card };
      player.field.forEach((m) => {
        if (isShadowHeart(m)) {
          m.atk = (m.atk || 0) + 300;
        }
      });
      break;
    }
    case "Shadow-Heart Purge": {
      const target = opponent.field
        .slice()
        .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
      if (target) {
        opponent.field.splice(opponent.field.indexOf(target), 1);
        opponent.graveyard.push(target);
      }
      break;
    }
    case "Shadow-Heart Battle Hymn": {
      player.field.forEach((m) => {
        if (isShadowHeart(m)) {
          m.atk = (m.atk || 0) + 500;
          m.tempAtkBoost = (m.tempAtkBoost || 0) + 500;
        }
      });
      break;
    }
    case "Shadow-Heart Rage": {
      const scale = player.field.find(
        (c) => c.name === "Shadow-Heart Scale Dragon"
      );
      if (scale && player.field.length === 1) {
        scale.atk = (scale.atk || 0) + 700;
        scale.def = (scale.def || 0) + 700;
        scale.extraAttacks = 1;
      }
      break;
    }
    case "Monster Reborn": {
      if (player.field.length >= 5) break;
      const pool = [...player.graveyard, ...opponent.graveyard];
      const best = pool
        .filter((c) => c.cardKind === "monster")
        .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
      if (best) {
        const grave = player.graveyard.includes(best)
          ? player.graveyard
          : opponent.graveyard;
        grave.splice(grave.indexOf(best), 1);
        best.position = "attack";
        player.field.push(best);
      }
      break;
    }
    case "Arcane Surge": {
      player.hand.push({ placeholder: true }, { placeholder: true });
      break;
    }
    case "Infinity Searcher": {
      player.hand.push({ placeholder: true });
      break;
    }
  }
}
