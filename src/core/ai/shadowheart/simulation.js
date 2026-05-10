// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/shadowheart/simulation.js
// Simulação de ações para lookahead (BeamSearch/GameTree).
// ─────────────────────────────────────────────────────────────────────────────

import { isShadowHeart } from "./knowledge.js";
import {
  selectBestTributes,
  getTributeRequirementFor,
  chooseCathedralSummonTarget,
} from "./priorities.js";

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
      const opponent = state.player;
      const card = player.hand[action.index];
      if (!card) break;

      const tributeInfo = getTributeRequirementFor(card, player);
      let tributeIndices = [];
      const tributes = [];

      // Só seleciona tributos se necessário E há monstros suficientes
      if (
        tributeInfo.tributesNeeded > 0 &&
        player.field.length >= tributeInfo.tributesNeeded
      ) {
        tributeIndices = selectBestTributes(
          player.field,
          tributeInfo.tributesNeeded,
          card,
        );
      } else if (tributeInfo.tributesNeeded > 0) {
        // Não pode summon (falta tributos)
        break;
      }

      // Remove tributos (do maior índice para o menor)
      tributeIndices.sort((a, b) => b - a);
      tributeIndices.forEach((idx) => {
        const t = player.field[idx];
        if (t) {
          tributes.push(t);
          player.graveyard.push(t);
          player.field.splice(idx, 1);
        }
      });

      // Remove carta da mão e adiciona ao campo
      player.hand.splice(action.index, 1);
      const newCard = { ...card };
      newCard.position = action.position || "attack";
      newCard.isFacedown = action.facedown || false;
      newCard.hasAttacked = false;
      newCard.attacksUsedThisTurn = 0;
      newCard.cannotAttackThisTurn = true; // Normal summon não ataca no turno
      newCard.lastSummonMethod =
        tributeInfo.tributesNeeded > 0 ? "tribute" : "normal";
      newCard.lastSummonedFromZone = "hand";
      newCard.lastTributeMaterialNames = tributes.map((tribute) => tribute.name);
      newCard.lastTributeMaterialCount = tributes.length;
      player.field.push(newCard);
      player.summonCount = (player.summonCount || 0) + 1;

      if (
        newCard.name === "Shadow-Heart Demon Arctroth" &&
        newCard.lastSummonMethod === "tribute"
      ) {
        const target = (opponent.field || [])
          .filter((c) => c && c.cardKind === "monster")
          .slice()
          .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
        if (target) {
          opponent.field.splice(opponent.field.indexOf(target), 1);
          opponent.graveyard = opponent.graveyard || [];
          opponent.graveyard.push(target);
          newCard.destroyedOpponentMonstersByEffect =
            (newCard.destroyedOpponentMonstersByEffect || 0) + 1;
        }
      }
      break;
    }
    case "spell": {
      const player = state.bot;
      const card = player.hand[action.index];
      if (!card) break;

      // Remove da mão
      player.hand.splice(action.index, 1);
      const placedCard = { ...card };

      // Simula efeito (inclui LP costs)
      const effectResult = simulateSpellEffect(state, placedCard);

      // Spell placement (field spell fica no campo, resto vai pro GY)
      if (placedCard.subtype === "field") {
        player.fieldSpell = placedCard;
      } else if (
        placedCard.subtype === "continuous" ||
        placedCard.subtype === "equip"
      ) {
        // Continuous/Equip ficam na spell/trap zone
        if (!player.spellTrap) player.spellTrap = [];
        if (player.spellTrap.length < 5) {
          player.spellTrap.push(placedCard);
        } else {
          player.graveyard.push(placedCard);
        }
      } else {
        // Normal spells vão direto pro GY
        player.graveyard.push(placedCard);
      }
      break;
    }
    case "position_change": {
      const player = state.bot;
      const target = (player.field || []).find(
        (c) =>
          c &&
          (c.id === action.cardId ||
            (!action.cardId && c.name === action.cardName)),
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
    case "spellTrapEffect": {
      const player = state.bot;
      const zoneIndex = Number.isInteger(action.zoneIndex)
        ? action.zoneIndex
        : action.index;
      const card = player.spellTrap?.[zoneIndex];
      if (!card || card.isFacedown) break;

      if (card.name === "Shadow-Heart Cathedral") {
        if ((player.field || []).length >= 5) break;
        const counterCount = action.cathedralPlan?.counterCount || getCounterCount(card);
        if (counterCount <= 0) break;
        const maxAtk = counterCount * 500;
        const candidates = (player.deck || []).filter(
          (candidate) =>
            candidate &&
            candidate.cardKind === "monster" &&
            isShadowHeart(candidate) &&
            (candidate.atk || 0) <= maxAtk,
        );
        const targetName = action.cathedralPlan?.targetName || null;
        const chosen =
          candidates.find((candidate) => candidate.name === targetName) ||
          chooseCathedralSummonTarget(candidates, {
            ...state,
            hand: player.hand || [],
            field: player.field || [],
            spellTrap: player.spellTrap || [],
            graveyard: player.graveyard || [],
            deck: player.deck || [],
            oppField: state.player?.field || [],
            oppLp: state.player?.lp || 8000,
          }).card;
        if (!chosen) break;

        const deckIndex = player.deck.indexOf(chosen);
        if (deckIndex >= 0) player.deck.splice(deckIndex, 1);
        const summoned = { ...chosen };
        summoned.position = "attack";
        summoned.isFacedown = false;
        summoned.hasAttacked = false;
        summoned.attacksUsedThisTurn = 0;
        summoned.cannotAttackThisTurn = false;
        summoned.lastSummonMethod = "special";
        summoned.lastSummonedFromZone = "deck";
        summoned.sourceCard = "Shadow-Heart Cathedral";
        player.field.push(summoned);

        player.spellTrap.splice(zoneIndex, 1);
        player.graveyard.push(card);
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
    case "handIgnition": {
      // Simula ativação de efeito ignition de monstro da mão
      const player = state.bot;
      const card = player.hand[action.index];
      if (!card) break;

      // Caso específico: Shadow-Heart Leviathan (envia Eel ao GY, special summon Leviathan)
      if (card.name === "Shadow-Heart Leviathan") {
        // Encontrar Abyssal Eel no campo para usar como custo
        const eelIdx = player.field.findIndex(
          (c) => c.name === "Shadow-Heart Abyssal Eel",
        );
        if (eelIdx === -1 || player.field.length >= 5) break; // Sem custo válido ou campo cheio

        // Enviar Eel ao GY
        const eel = player.field[eelIdx];
        player.graveyard.push(eel);
        player.field.splice(eelIdx, 1);

        // Remover Leviathan da mão e special summon
        player.hand.splice(action.index, 1);
        const newCard = { ...card };
        newCard.position = "attack";
        newCard.isFacedown = false;
        newCard.hasAttacked = false;
        newCard.attacksUsedThisTurn = 0;
        newCard.cannotAttackThisTurn = false; // Special summon pode atacar
        player.field.push(newCard);
      }
      // Adicionar outros monstros com hand ignition aqui conforme necessário
      break;
    }
  }

  return state;
}

function getCounterCount(card, counterType = "judgment_marker") {
  if (!card) return 0;
  if (typeof card.getCounter === "function") return card.getCounter(counterType) || 0;
  if (card.counters instanceof Map) return card.counters.get(counterType) || 0;
  if (card.counters && typeof card.counters === "object") {
    return card.counters[counterType] || 0;
  }
  return 0;
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
        (c) => c.name === "Shadow-Heart Scale Dragon",
      );
      const materialIdx = player.field.findIndex(
        (c, i) => i !== scaleIdx && isShadowHeart(c) && (c.level || 0) >= 5,
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
    case "Shadow-Heart Covenant": {
      if (
        (player.field?.length || 0) > 0 ||
        (player.spellTrap?.length || 0) > 0 ||
        player.fieldSpell
      ) {
        break;
      }

      // Searcher: Paga 800 LP, adiciona 1 Shadow-Heart da deck à mão
      player.lp = Math.max(0, (player.lp || 8000) - 800);

      // Simula adicionar melhor carta Shadow-Heart (placeholder)
      player.hand.push({
        placeholder: true,
        archetype: "Shadow-Heart",
        name: "Shadow-Heart (searched)",
      });
      break;
    }
    case "Shadow-Heart Infusion": {
      // Revive: Descarta 2, special summon Shadow-Heart do GY
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
          target.cannotAttackThisTurn = true; // Special summon restriction
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
      const discard = player.hand.find(
        (c) =>
          c &&
          c !== card &&
          (c.archetype === "Shadow-Heart" ||
            (Array.isArray(c.archetypes) &&
              c.archetypes.includes("Shadow-Heart"))),
      );
      const target = opponent.field
        .filter((c) => c && !c.isFacedown)
        .slice()
        .sort((a, b) => {
          const aDestroyed = (a.atk || 0) > 0 && (a.atk || 0) <= 1000;
          const bDestroyed = (b.atk || 0) > 0 && (b.atk || 0) <= 1000;
          if (aDestroyed !== bDestroyed) return bDestroyed - aDestroyed;
          return (b.atk || 0) - (a.atk || 0);
        })[0];
      if (discard && target) {
        player.hand.splice(player.hand.indexOf(discard), 1);
        player.graveyard.push(discard);
        const previousAtk = target.atk || 0;
        target.atk = Math.max(0, previousAtk - 1000);
        target.tempAtkBoost = (target.tempAtkBoost || 0) + target.atk - previousAtk;
        if (previousAtk > 0 && target.atk === 0) {
          opponent.field.splice(opponent.field.indexOf(target), 1);
          opponent.graveyard.push(target);
        }
      }
      break;
    }
    case "Shadow-Heart Battle Hymn": {
      // Buff: +500 ATK para todos Shadow-Heart
      player.field.forEach((m) => {
        if (isShadowHeart(m)) {
          m.tempAtkBoost = (m.tempAtkBoost || 0) + 500;
        }
      });
      break;
    }
    case "Shadow-Heart Rage": {
      // OTK spell: Se Scale Dragon está sozinho, +700/+700 e 1 ataque extra
      const scale = player.field.find(
        (c) => c.name === "Shadow-Heart Scale Dragon",
      );
      if (scale && player.field.length === 1) {
        scale.tempAtkBoost = (scale.tempAtkBoost || 0) + 700;
        scale.tempDefBoost = (scale.tempDefBoost || 0) + 700;
        scale.canMakeSecondAttackThisTurn = true;
        scale.secondAttackUsedThisTurn = false;
        player.forbidDirectAttacksThisTurn = true;
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
