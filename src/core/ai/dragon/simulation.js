// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/dragon/simulation.js
// Lookahead simulation for Dragon deck (BeamSearch / greedy).
// ─────────────────────────────────────────────────────────────────────────────

import { CARD_KNOWLEDGE, isExtremeDragon } from "./knowledge.js";
import { getTributeRequirementFor, selectBestTributes } from "./priorities.js";

const ARMORY_SEARCH_ORDER = [
  "Voltaic Dragon",
  "Grey Dragon",
  "Luminescent Dragon",
  "Armored Dragon",
];

const AWAKENING_TARGET_ORDER = [
  "Black Bull Dragon",
  "Purified Crystal Dragon",
  "Volcanic Extreme Dragon",
  "Galaxy Extreme Dragon",
  "Forest Extreme Dragon",
];

const CONVERGING_SUMMON_ORDER = [
  "Darkness Dragon",
  "Abyssal Serpent Dragon",
  "Majestic Silver Dragon",
  "Black Bull Dragon",
  "Purified Crystal Dragon",
  "Volcanic Extreme Dragon",
  "Galaxy Extreme Dragon",
  "Forest Extreme Dragon",
  "Fire Extreme Dragon",
  "Mist Extreme Dragon",
];

const EXTREME_GY_SEND_ORDER = [
  "Volcanic Extreme Dragon",
  "Forest Extreme Dragon",
  "Galaxy Extreme Dragon",
  "Fire Extreme Dragon",
  "Mist Extreme Dragon",
];

/**
 * Simulates a main-phase action on a cloned game state.
 * @param {Object} state - Cloned game state
 * @param {Object} action - Action to simulate
 * @returns {Object} Modified state
 */
export function simulateMainPhaseAction(state, action) {
  if (!action || !state?.bot) return state;

  switch (action.type) {
    case "summon": {
      const player = state.bot;
      const card = player.hand[action.index];
      if (!card) break;

      const tributeInfo = getTributeRequirementFor(card, player);

      if (tributeInfo.tributesNeeded > 0 && player.field.length < tributeInfo.tributesNeeded) {
        break; // Can't tribute summon
      }

      // Remove tributes
      if (tributeInfo.tributesNeeded > 0) {
        const tributeIndices = selectBestTributes(player.field, tributeInfo.tributesNeeded, card);
        tributeIndices.sort((a, b) => b - a);
        tributeIndices.forEach((idx) => {
          const t = player.field[idx];
          if (t) {
            player.graveyard.push(t);
            player.field.splice(idx, 1);
          }
        });
      }

      // Move card from hand to field
      player.hand.splice(action.index, 1);
      player.field.push({
        ...card,
        position: action.position || "attack",
        isFacedown: action.facedown || false,
        hasAttacked: false,
        cannotAttackThisTurn: true,
      });
      player.summonCount = (player.summonCount || 0) + 1;
      const summoned = player.field[player.field.length - 1];
      simulateDragonAfterSummonEffects(state, summoned, {
        method: tributeInfo.tributesNeeded > 0 ? "tribute" : "normal",
      });
      break;
    }

    case "spell": {
      const player = state.bot;
      const card = player.hand[action.index];
      if (!card) break;

      player.hand.splice(action.index, 1);

      simulateDragonSpellEffect(state, card, action);

      if (card.subtype === "field") {
        player.fieldSpell = { ...card };
      } else if (card.subtype === "continuous" || card.subtype === "equip") {
        if (!player.spellTrap) player.spellTrap = [];
        if (player.spellTrap.length < 5) player.spellTrap.push({ ...card });
        else player.graveyard.push({ ...card });
      } else {
        player.graveyard.push({ ...card });
      }
      break;
    }

    case "handIgnition": {
      const player = state.bot;
      const card = player.hand[action.index];
      if (!card) break;

      simulateDragonHandIgnition(state, card, action);
      break;
    }

    case "graveyardMonsterEffect": {
      const player = state.bot;
      const graveyardIndex = Number.isInteger(action.graveyardIndex)
        ? action.graveyardIndex
        : (player.graveyard || []).findIndex(
            (card) =>
              card &&
              (card.id === action.cardId ||
                (!action.cardId && card.name === action.cardName)),
          );
      const card = player.graveyard?.[graveyardIndex];
      if (!card) break;

      simulateDragonGraveyardMonsterEffect(state, card, action);
      break;
    }

    case "spellTrapEffect": {
      const player = state.bot;
      const zoneIndex = Number.isInteger(action.zoneIndex)
        ? action.zoneIndex
        : action.index;
      const card = player.spellTrap?.[zoneIndex];
      if (!card) break;
      simulateDragonSpellTrapIgnition(state, card, action, zoneIndex);
      break;
    }

    case "fieldEffect": {
      const player = state.bot;
      const card = player.fieldSpell;
      if (!card) break;
      simulateDragonFieldSpellEffect(state, card, action);
      break;
    }

    case "monsterEffect": {
      const player = state.bot;
      const fieldIndex = Number.isInteger(action.fieldIndex)
        ? action.fieldIndex
        : (player.field || []).findIndex(
            (card) =>
              card &&
              (card.id === action.cardId ||
                (!action.cardId && card.name === action.cardName)),
          );
      const card = player.field?.[fieldIndex];
      if (!card) break;
      simulateDragonFieldMonsterEffect(state, card, action, fieldIndex);
      break;
    }

    case "graveyardSpellEffect": {
      const player = state.bot;
      const graveyardIndex = Number.isInteger(action.graveyardIndex)
        ? action.graveyardIndex
        : (player.graveyard || []).findIndex(
            (card) =>
              card &&
              (card.id === action.cardId ||
                (!action.cardId && card.name === action.cardName)),
          );
      const card = player.graveyard?.[graveyardIndex];
      if (!card) break;
      simulateDragonGraveyardSpellEffect(state, card, action, graveyardIndex);
      break;
    }

    case "set_spell_trap": {
      const player = state.bot;
      const card = player.hand[action.index];
      if (!card) break;
      if (card.cardKind === "spell" && card.subtype === "field") break;
      player.hand.splice(action.index, 1);
      player.spellTrap = player.spellTrap || [];
      if (player.spellTrap.length < 5) {
        player.spellTrap.push({ ...card, isFacedown: true });
      } else {
        player.graveyard.push({ ...card });
      }
      break;
    }

    case "position_change": {
      const player = state.bot;
      const target = (player.field || []).find(
        (c) => c && (c.id === action.cardId || c.name === action.cardName),
      );
      if (!target || target.isFacedown || target.positionChangedThisTurn || target.hasAttacked) break;
      const newPos = action.toPosition === "defense" ? "defense" : "attack";
      if (target.position === newPos) break;
      target.position = newPos;
      target.positionChangedThisTurn = true;
      target.cannotAttackThisTurn = newPos === "defense";
      break;
    }

    case "ascension": {
      simulateDragonAscension(state, action);
      break;
    }
  }

  return state;
}

/**
 * Simulates spell-specific effects on the cloned state.
 * @param {Object} state
 * @param {Object} card
 * @param {Object} action
 */
function simulateDragonSpellEffect(state, card, action) {
  const player = state.bot;

  switch (card.name) {
    case "Extreme Dragon Awakening": {
      const target = selectDeckSearchTarget(
        player,
        (candidate) =>
          isDragonMonster(candidate) &&
          (candidate.level || 0) >= 8,
        AWAKENING_TARGET_ORDER,
      );

      if (target) {
        const searched = player.deck.splice(target.index, 1)[0];
        player.hand.push(searched);
      }
      break;
    }

    case "Converging Stars": {
      // Step 1: discard 1 card from hand.
      if (player.hand.length > 0) {
        const discardIdx = pickWorstDiscard(player.hand);
        discardHandCardToGraveyard(state, player, discardIdx);
      }

      // Step 2: Reduce all hand monster levels by 2
      player.hand = player.hand.map((c) => {
        if (c.cardKind === "monster" && (c.level || 0) > 1) {
          return { ...c, level: Math.max(1, (c.level || 0) - 2) };
        }
        return c;
      });

      // Step 3: approximate the immediate normal summon that the level reduction unlocks.
      simulateBestConvergingSummon(state, player, action);
      break;
    }

    case "Polymerization": {
      const materialEntries = getFusionMaterialEntries(player);
      const radiantMaterials = selectRadiantCosmicMaterials(materialEntries);
      const techVoidMaterials = selectTechVoidMaterials(materialEntries);
      const canPlaceRadiant =
        radiantMaterials.length === 3 &&
        (player.field.length < 5 || radiantMaterials.some((entry) => entry.zone === "field"));
      const canPlaceTechVoid =
        techVoidMaterials.length === 2 &&
        (player.field.length < 5 || techVoidMaterials.some((entry) => entry.zone === "field"));
      const preferTechVoid = shouldPreferTechVoidFusion(state, techVoidMaterials, radiantMaterials);

      if (canPlaceTechVoid && preferTechVoid) {
        moveFusionMaterialsToGY(player, techVoidMaterials);
        const techVoidCard = takeExtraDeckCard(player, "Tech-Void Dragon", {
          name: "Tech-Void Dragon",
          atk: 2500,
          def: 1000,
          level: 8,
          cardKind: "monster",
          type: "Dragon",
          monsterType: "fusion",
        });
        const summoned = specialSummonToField(state, player, techVoidCard, action, {
          method: "fusion",
        });
        if (summoned) simulateTechVoidAfterSummon(player, summoned);
        break;
      }

      if (canPlaceRadiant) {
        moveFusionMaterialsToGY(player, radiantMaterials);
        const radiantCard = takeExtraDeckCard(player, "Radiant Cosmic Dragon", {
          name: "Radiant Cosmic Dragon",
          atk: 3300,
          def: 2700,
          level: 9,
          cardKind: "monster",
          type: "Dragon",
          attribute: "Light",
          monsterType: "fusion",
        });
        const summoned = specialSummonToField(state, player, radiantCard, action, {
          method: "fusion",
        });
        if (summoned) {
          summoned.simFutureRevive = (player.graveyard || []).some(
            (candidate) =>
              isDragonMonster(candidate) && candidate.name !== "Radiant Cosmic Dragon",
          );
          simulateRadiantCosmicRefund(player);
        }
        break;
      }

      if (canPlaceTechVoid) {
        moveFusionMaterialsToGY(player, techVoidMaterials);
        const techVoidCard = takeExtraDeckCard(player, "Tech-Void Dragon", {
          name: "Tech-Void Dragon",
          atk: 2500,
          def: 1000,
          level: 8,
          cardKind: "monster",
          type: "Dragon",
          monsterType: "fusion",
        });
        const summoned = specialSummonToField(state, player, techVoidCard, action, {
          method: "fusion",
        });
        if (summoned) simulateTechVoidAfterSummon(player, summoned);
      }
      break;
    }

    case "Jagged Peak of the Dragons": {
      // Field spell — placement already handled by caller
      // Simulate GY recovery: add 1 lv4- Dragon from GY to hand
      const lv4GYIdx = (player.graveyard || []).findIndex(
        (c) => c.cardKind === "monster" && (c.level || 0) <= 4 && (c.type === "Dragon" || c.cardKind === "monster")
      );
      if (lv4GYIdx >= 0) {
        const recovered = player.graveyard.splice(lv4GYIdx, 1)[0];
        player.hand.push(recovered);
      }
      break;
    }

    case "Hellkite Roar": {
      // Destroy up to 1 opp spell/trap - approximate by removing one backrow from state.
      const opp = state.player;
      if (opp?.spellTrap?.length > 0) {
        const destroyed = opp.spellTrap.shift();
        if (destroyed) putSimulatedCard(opp, destroyed, "graveyard");
      } else if (opp?.fieldSpell) {
        const destroyed = opp.fieldSpell;
        opp.fieldSpell = null;
        putSimulatedCard(opp, destroyed, "graveyard");
      }
      break;
    }

    default:
      break;
  }
}

function isDragonMonster(card) {
  return card?.cardKind === "monster" && card.type === "Dragon";
}

function getFusionMaterialEntries(player) {
  const entries = [];
  for (const zone of ["hand", "field"]) {
    const cards = player?.[zone] || [];
    for (let index = 0; index < cards.length; index++) {
      const card = cards[index];
      if (isDragonMonster(card)) {
        entries.push({ zone, index, card });
      }
    }
  }
  return entries;
}

function materialValue(entry) {
  const card = entry?.card || {};
  const knowledge = CARD_KNOWLEDGE[card.name] || {};
  return (
    (knowledge.value || 0) +
    (card.level || 0) * 0.2 +
    (card.atk || 0) / 1000 +
    (entry.zone === "field" ? 1 : 0)
  );
}

function cardStrategicSimValue(card) {
  const knowledge = CARD_KNOWLEDGE[card?.name] || {};
  return (
    (knowledge.value || knowledge.priority || 0) +
    (card?.level || 0) * 0.25 +
    Math.max(card?.atk || 0, card?.def || 0) / 1000 +
    (isExtremeDragon(card) ? 4 : 0) +
    (card?.monsterType === "fusion" || card?.monsterType === "ascension" ? 5 : 0)
  );
}

function rankSimThreats(cards = []) {
  return (cards || [])
    .filter((card) => card && card.cardKind === "monster")
    .slice()
    .sort((a, b) => {
      const score = (card) =>
        Math.max(card?.atk || 0, card?.def || 0) / 500 +
        (card?.level || 0) * 0.35 +
        (card?.monsterType === "fusion" || card?.monsterType === "ascension" ? 5 : 0);
      return score(b) - score(a);
    });
}

function isFaceupDragon(card) {
  return isDragonMonster(card) && !card.isFacedown;
}

function hasNamedCard(cards = [], name) {
  return (cards || []).some((card) => card?.name === name);
}

function cardArchetypes(card) {
  if (!card) return [];
  if (Array.isArray(card.archetypes)) return card.archetypes;
  return card.archetype ? [card.archetype] : [];
}

function hasArchetype(card, archetype) {
  return cardArchetypes(card).includes(archetype);
}

function hasRainbowGyFollowUp(player) {
  if (hasNamedCard(player?.hand, "Call of the Haunted")) return true;
  if (hasNamedCard(player?.spellTrap, "Call of the Haunted")) return true;
  if ((player?.field || []).some((card) => card?.name === "Luminous Dragon" && !card.isFacedown)) {
    return true;
  }
  if (
    hasNamedCard(player?.graveyard, "Boneflame Dragon") &&
    (player?.field || []).some(isFaceupDragon)
  ) {
    return true;
  }
  if (player?.fieldSpell?.name === "Jagged Peak of the Dragons") return true;
  return hasNamedCard(player?.hand, "Hellkite Dragon");
}

function orderBonus(card, order = [], step = 12) {
  const index = order.indexOf(card?.name);
  return index >= 0 ? (order.length - index) * step : 0;
}

function getPlayerId(state, owner) {
  if (owner?.id === "player" || owner?.id === "bot") return owner.id;
  return owner === state?.player ? "player" : "bot";
}

function readMapLike(value, key) {
  if (!value) return 0;
  if (typeof value.get === "function") return value.get(key) || 0;
  return value[key] || value[String(key)] || 0;
}

function getMaterialEffectActivationCount(state, owner, materialId) {
  const playerId = getPlayerId(state, owner);
  const realGame = state?._gameRef || state;
  return (
    readMapLike(
      realGame?.materialDuelStats?.[playerId]?.effectActivationsByMaterialId,
      materialId,
    ) +
    readMapLike(
      state?._simMaterialEffectActivationsByMaterialId?.[playerId],
      materialId,
    ) +
    readMapLike(owner?._simMaterialEffectActivationsByMaterialId, materialId)
  );
}

function recordSimulatedMaterialEffectActivation(state, owner, sourceCard) {
  if (!state || !owner || !sourceCard || sourceCard.cardKind !== "monster") return;
  if (typeof sourceCard.id !== "number") return;
  const playerId = getPlayerId(state, owner);
  if (!state._simMaterialEffectActivationsByMaterialId) {
    state._simMaterialEffectActivationsByMaterialId = { player: {}, bot: {} };
  }
  const bucket =
    state._simMaterialEffectActivationsByMaterialId[playerId] ||
    (state._simMaterialEffectActivationsByMaterialId[playerId] = {});
  bucket[sourceCard.id] = (bucket[sourceCard.id] || 0) + 1;
}

function useSimulatedOnce(state, owner, key) {
  if (!state || !key) return true;
  const playerId = getPlayerId(state, owner);
  if (!state._dragonSimOnce) state._dragonSimOnce = { player: {}, bot: {} };
  const bucket = state._dragonSimOnce[playerId] || (state._dragonSimOnce[playerId] = {});
  if (bucket[key]) return false;
  bucket[key] = true;
  return true;
}

function putSimulatedCard(owner, card, toZone) {
  if (!owner || !card || !toZone) return;
  const destination = toZone === "banish" ? "banished" : toZone;
  const zone =
    destination === "deck" &&
    (card.monsterType === "fusion" || card.monsterType === "ascension")
      ? "extraDeck"
      : destination;

  if (zone === "fieldSpell") {
    owner.fieldSpell = card;
    return;
  }

  if (!owner[zone]) owner[zone] = [];
  owner[zone].push(card);
}

function moveFieldIndexToGraveyard(player, index) {
  const card = player?.field?.[index];
  if (!card) return null;
  player.field.splice(index, 1);
  putSimulatedCard(player, card, "graveyard");
  return card;
}

function discardHandCardToGraveyard(state, player, handIndex) {
  const discarded = player?.hand?.[handIndex];
  if (!discarded) return null;
  player.hand.splice(handIndex, 1);
  putSimulatedCard(player, discarded, "graveyard");
  applyDragonHandToGraveyardTriggers(state, player, discarded);
  return discarded;
}

function applyDragonHandToGraveyardTriggers(state, player, discarded) {
  if (!state || !player || !discarded || !isDragonMonster(discarded)) return;
  const opponent = player === state.player ? state.bot : state.player;

  if (
    discarded.name === "Voltaic Dragon" &&
    useSimulatedOnce(state, player, "voltaic_dragon_discard_damage")
  ) {
    opponent.lp = (opponent.lp ?? 8000) - 800;
  }

  const hasFaceupLuminous = (player.field || []).some(
    (card) => card?.name === "Luminous Dragon" && !card.isFacedown,
  );
  if (
    hasFaceupLuminous &&
    useSimulatedOnce(state, player, "luminous_dragon_discard_recover")
  ) {
    const recoverEntry = (player.graveyard || [])
      .map((candidate, index) => ({ candidate, index }))
      .filter(
        ({ candidate }) =>
          isDragonMonster(candidate) && candidate.name !== discarded.name,
      )
      .sort((a, b) => cardStrategicSimValue(b.candidate) - cardStrategicSimValue(a.candidate))[0];

    if (recoverEntry) {
      const liveIndex = player.graveyard.indexOf(recoverEntry.candidate);
      if (liveIndex >= 0) {
        player.hand.push(player.graveyard.splice(liveIndex, 1)[0]);
      }
    }
  }
}

function selectDeckSearchTarget(player, predicate, order = []) {
  return (player.deck || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => predicate(candidate))
    .sort((a, b) => {
      const score = (entry) =>
        orderBonus(entry.candidate, order) + cardStrategicSimValue(entry.candidate);
      return score(b) - score(a);
    })[0];
}

function selectFieldDragonCosts(player, count, options = {}) {
  const preserveNames = new Set(options.preserveNames || []);
  return (player.field || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => isFaceupDragon(candidate))
    .sort((a, b) => {
      const score = (entry) => {
        let value = materialValue({ card: entry.candidate, zone: "field" });
        if (isExtremeDragon(entry.candidate)) value += 1000;
        if (entry.candidate.monsterType === "fusion" || entry.candidate.monsterType === "ascension") {
          value += 80;
        }
        if (preserveNames.has(entry.candidate.name)) value += 50;
        if (entry.candidate.hasAttacked) value -= 1;
        return value;
      };
      return score(a) - score(b);
    })
    .slice(0, count);
}

function selectGraveyardDragonCosts(player, count) {
  return (player.graveyard || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => isDragonMonster(candidate))
    .sort((a, b) => {
      const score = (entry) => {
        let value = cardStrategicSimValue(entry.candidate);
        if (isExtremeDragon(entry.candidate)) value += 40;
        if (entry.candidate.name === "Hellkite Roar") value += 20;
        if (entry.candidate.name === "Boneflame Dragon") value += 12;
        return value;
      };
      return score(a) - score(b);
    })
    .slice(0, count);
}

function selectHandDragonDiscardCosts(player, sourceCard, count) {
  const sourceIndex = player.hand.indexOf(sourceCard);
  const preferNames = ["Voltaic Dragon", "Grey Dragon", "Boneflame Dragon"];
  const preserveNames = new Set([
    "Luminous Dragon",
    "Black Bull Dragon",
    "Purified Crystal Dragon",
    "Hellkite Dragon",
    "Polymerization",
    "Extreme Dragon Awakening",
    "Jagged Peak of the Dragons",
  ]);
  return (player.hand || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate, index }) => isDragonMonster(candidate) && index !== sourceIndex)
    .sort((a, b) => {
      const score = (entry) => {
        let value = cardStrategicSimValue(entry.candidate);
        value -= orderBonus(entry.candidate, preferNames, 8);
        if (preserveNames.has(entry.candidate.name)) value += 50;
        return value;
      };
      return score(a) - score(b);
    })
    .slice(0, count);
}

function specialSummonToField(state, player, card, action = {}, options = {}) {
  if (!player || !card || (player.field || []).length >= 5) return null;
  const requestedPosition = action.position || options.position || "attack";
  const summoned = {
    ...card,
    position: requestedPosition === "choice" ? "attack" : requestedPosition,
    isFacedown: false,
    hasAttacked: false,
    cannotAttackThisTurn: options.cannotAttackThisTurn === true,
  };
  applySimulatedPassiveBuffs(summoned, player);
  player.field.push(summoned);
  simulateDragonAfterSummonEffects(state, summoned, {
    method: options.method || "special",
  });
  return summoned;
}

function normalSummonFromHandIndex(state, player, handIndex, action = {}) {
  const card = player?.hand?.[handIndex];
  if (!card || (player.summonCount || 0) >= 1) return null;
  const tributeInfo = getTributeRequirementFor(card, player);
  if ((player.field || []).length < tributeInfo.tributesNeeded) return null;
  if (tributeInfo.tributesNeeded === 0 && (player.field || []).length >= 5) return null;

  if (tributeInfo.tributesNeeded > 0) {
    const tributeIndices = selectBestTributes(player.field, tributeInfo.tributesNeeded, card)
      .sort((a, b) => b - a);
    for (const index of tributeIndices) moveFieldIndexToGraveyard(player, index);
  }

  const liveIndex = player.hand.indexOf(card);
  if (liveIndex < 0) return null;
  const summonedCard = player.hand.splice(liveIndex, 1)[0];
  const summoned = {
    ...summonedCard,
    position: action.position || "attack",
    isFacedown: false,
    hasAttacked: false,
    cannotAttackThisTurn: true,
  };
  player.field.push(summoned);
  player.summonCount = (player.summonCount || 0) + 1;
  simulateDragonAfterSummonEffects(state, summoned, {
    method: tributeInfo.tributesNeeded > 0 ? "tribute" : "normal",
  });
  return summoned;
}

function simulateDragonAfterSummonEffects(state, summoned, meta = {}) {
  const player = state.bot;
  if (!summoned || summoned.isFacedown) return;

  if (summoned.name === "Armored Dragon" && meta.method === "normal") {
    simulateArmoredDragonSearch(state, player);
    recordSimulatedMaterialEffectActivation(state, player, summoned);
  }

  if (summoned.name === "Darkness Dragon") {
    const otherDragonIndices = (player.field || [])
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate !== summoned && isFaceupDragon(candidate))
      .map(({ index }) => index)
      .sort((a, b) => b - a);
    let destroyed = 0;
    for (const index of otherDragonIndices) {
      const sent = moveFieldIndexToGraveyard(player, index);
      if (sent) destroyed++;
    }
    if (destroyed > 0) {
      summoned.tempAtkBoost = (summoned.tempAtkBoost || 0) + destroyed * 300;
    }
  }

  if (summoned.name === "Grey Dragon" && meta.method === "special") {
    const target = (player.field || [])
      .filter((candidate) => candidate !== summoned && isFaceupDragon(candidate))
      .sort((a, b) => cardStrategicSimValue(b) - cardStrategicSimValue(a))[0];
    if (target) {
      target.tempAtkBoost = (target.tempAtkBoost || 0) + 500;
    }
  }
}

function simulateArmoredDragonSearch(state, player) {
  const target = selectDeckSearchTarget(
    player,
    (candidate) =>
      isDragonMonster(candidate) &&
      (candidate.level || 0) <= 4,
    ARMORY_SEARCH_ORDER,
  );
  if (!target) return;
  const liveIndex = player.deck.indexOf(target.candidate);
  if (liveIndex >= 0) player.hand.push(player.deck.splice(liveIndex, 1)[0]);
}

function simulateBestConvergingSummon(state, player, action) {
  if ((player.summonCount || 0) >= 1) return null;

  const candidates = (player.hand || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => {
      if (!isDragonMonster(candidate)) return false;
      const tributeInfo = getTributeRequirementFor(candidate, player);
      if ((player.field || []).length < tributeInfo.tributesNeeded) return false;
      if (tributeInfo.tributesNeeded === 0 && (player.field || []).length >= 5) return false;
      return CONVERGING_SUMMON_ORDER.includes(candidate.name) || (candidate.level || 0) >= 5;
    })
    .sort((a, b) => {
      const score = (entry) =>
        orderBonus(entry.candidate, CONVERGING_SUMMON_ORDER, 18) +
        cardStrategicSimValue(entry.candidate);
      return score(b) - score(a);
    });

  const selected = candidates[0];
  if (!selected) return null;
  return normalSummonFromHandIndex(state, player, selected.index, action);
}

function takeExtraDeckCard(player, name, fallback) {
  const extraIndex = (player.extraDeck || []).findIndex(
    (candidate) => candidate?.name === name,
  );
  if (extraIndex >= 0) {
    return player.extraDeck.splice(extraIndex, 1)[0];
  }
  return { ...fallback };
}

function shouldPreferTechVoidFusion(state, techVoidMaterials, radiantMaterials) {
  if ((techVoidMaterials || []).length !== 2) return false;
  const opponent = state.player || {};
  const canRadiant = (radiantMaterials || []).length === 3;
  const materialCost = (entries) =>
    (entries || []).reduce((sum, entry) => sum + materialValue(entry), 0);
  const techCost = materialCost(techVoidMaterials);
  const radiantCost = materialCost(radiantMaterials);
  const pressureNeed =
    (opponent.lp || 8000) <= 2500 ||
    (opponent.field || []).length >= 2 ||
    (opponent.field || []).some((card) => (card?.atk || 0) >= 2500);
  const muchCheaper = canRadiant && techCost + 3 < radiantCost;
  return pressureNeed || muchCheaper || !canRadiant;
}

function simulateTechVoidAfterSummon(player, summoned) {
  const target = (player.graveyard || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(
      ({ candidate }) =>
        isDragonMonster(candidate) &&
        (candidate.level || 0) <= 4,
    )
    .sort((a, b) => (b.candidate.atk || 0) - (a.candidate.atk || 0))[0];

  if (!target) return;
  const liveIndex = player.graveyard.indexOf(target.candidate);
  if (liveIndex < 0) return;
  const banished = player.graveyard.splice(liveIndex, 1)[0];
  if (!player.banished) player.banished = [];
  player.banished.push(banished);
  const buff = banished.atk || 0;
  summoned.tempAtkBoost = (summoned.tempAtkBoost || 0) + buff;
}

function selectRadiantCosmicMaterials(entries) {
  const dragons = (entries || []).filter((entry) => isDragonMonster(entry.card));
  if (dragons.length < 3) return [];

  const lightMaterials = dragons
    .filter((entry) => String(entry.card.attribute || "").toLowerCase() === "light")
    .sort((a, b) => materialValue(a) - materialValue(b));
  if (lightMaterials.length === 0) return [];

  const selected = [lightMaterials[0]];
  const remaining = dragons
    .filter((entry) => entry !== selected[0])
    .sort((a, b) => materialValue(a) - materialValue(b));
  selected.push(...remaining.slice(0, 2));

  return selected.length === 3 ? selected : [];
}

function selectTechVoidMaterials(entries) {
  const voltaic = (entries || [])
    .filter((entry) => entry.card?.name === "Voltaic Dragon")
    .sort((a, b) => materialValue(a) - materialValue(b))[0];
  if (!voltaic) return [];

  const lv5Dragon = (entries || [])
    .filter(
      (entry) =>
        entry !== voltaic &&
        isDragonMonster(entry.card) &&
        entry.card.name !== "Voltaic Dragon" &&
        (entry.card.level || 0) >= 5,
    )
    .sort((a, b) => materialValue(a) - materialValue(b))[0];

  return lv5Dragon ? [voltaic, lv5Dragon] : [];
}

function moveFusionMaterialsToGY(player, entries) {
  const sortedEntries = [...(entries || [])].sort((a, b) => {
    if (a.zone !== b.zone) return a.zone === "field" ? -1 : 1;
    return b.index - a.index;
  });

  for (const entry of sortedEntries) {
    const zoneCards = player?.[entry.zone] || [];
    const card = zoneCards[entry.index];
    if (!card) continue;
    zoneCards.splice(entry.index, 1);
    putSimulatedCard(player, card, "graveyard");
  }
}

function simulateRadiantCosmicRefund(player) {
  if ((player.graveyard || []).length > 0) {
    const recycleIdx = pickWorstDeckRefund(player.graveyard);
    const recycled = player.graveyard.splice(recycleIdx, 1)[0];
    if (recycled) {
      putSimulatedCard(player, recycled, "deck");
    }
  }

  if ((player.deck || []).length > 0) {
    player.hand.push(player.deck.shift());
  }
}

function pickWorstDeckRefund(graveyard) {
  let worstIdx = 0;
  let worstScore = Infinity;

  for (let i = 0; i < graveyard.length; i++) {
    const card = graveyard[i];
    const knowledge = CARD_KNOWLEDGE[card.name] || {};
    let score = knowledge.value || 0;

    if (isDragonMonster(card)) score += 6;
    if (isExtremeDragon(card)) score += 8;
    if (card.name === "Hellkite Roar") score += 10;
    if (card.name === "Radiant Cosmic Dragon") score += 12;

    if (score < worstScore) {
      worstScore = score;
      worstIdx = i;
    }
  }

  return worstIdx;
}

/**
 * Simulates hand ignition effects for Dragon monsters.
 */
function simulateDragonHandIgnition(state, card, action) {
  const player = state.bot;

  if (card.name === "Luminous Dragon") {
    if (player.field.length === 0 && player.field.length < 5) {
      player.hand.splice(action.index, 1);
      const summoned = specialSummonToField(state, player, card, action, {
        method: "special",
      });
      if (summoned) recordSimulatedMaterialEffectActivation(state, player, summoned);
    }
    return;
  }

  if (card.name === "Voltaic Dragon") {
    // SS if control Dragon — just place it on field
    if (player.field.some(isFaceupDragon) && player.field.length < 5) {
      player.hand.splice(action.index, 1);
      const summoned = specialSummonToField(state, player, card, action, {
        method: "special",
      });
      if (summoned) recordSimulatedMaterialEffectActivation(state, player, summoned);
    }
    return;
  }

  if (card.name === "Hellkite Dragon") {
    // Send field Dragon to GY → SS Hellkite from hand
    const cost = selectFieldDragonCosts(player, 1, {
      preserveNames: ["Luminous Dragon", "Purified Crystal Dragon"],
    })[0];
    if (cost && player.field.length < 5) {
      moveFieldIndexToGraveyard(player, cost.index);
      const liveIndex = player.hand.indexOf(card);
      if (liveIndex >= 0) {
        player.hand.splice(liveIndex, 1);
        const summoned = specialSummonToField(state, player, card, action, {
          method: "special",
        });
        if (summoned) recordSimulatedMaterialEffectActivation(state, player, summoned);
      }
    }
    return;
  }

  if (card.name === "Black Bull Dragon") {
    // Discard 2 Dragons → SS Black Bull (can't attack this turn)
    const toDiscard = selectHandDragonDiscardCosts(player, card, 2);
    if (toDiscard.length >= 2 && player.field.length < 5) {
      const discardIndices = toDiscard.map(({ index }) => index).sort((a, b) => b - a);
      for (const index of discardIndices) {
        discardHandCardToGraveyard(state, player, index);
      }
      const liveIndex = player.hand.indexOf(card);
      if (liveIndex >= 0) {
        player.hand.splice(liveIndex, 1);
        const summoned = specialSummonToField(state, player, card, action, {
          method: "special",
          cannotAttackThisTurn: true,
        });
        if (summoned) {
          summoned.simMultiAttackPressure = true;
          recordSimulatedMaterialEffectActivation(state, player, summoned);
        }
      }
    }
    return;
  }

  if (card.name === "Purified Crystal Dragon") {
    // Banish 3 GY Dragons → SS
    const gyCost = selectGraveyardDragonCosts(player, 3);
    if (gyCost.length >= 3 && player.field.length < 5) {
      const costIndices = gyCost.map(({ index }) => index).sort((a, b) => b - a);
      for (const index of costIndices) {
        const banished = player.graveyard.splice(index, 1)[0];
        if (!player.banished) player.banished = [];
        if (banished) player.banished.push(banished);
      }
      const liveIndex = player.hand.indexOf(card);
      if (liveIndex >= 0) {
        player.hand.splice(liveIndex, 1);
        const summoned = specialSummonToField(state, player, card, action, {
          method: "special",
        });
        if (summoned) recordSimulatedMaterialEffectActivation(state, player, summoned);
      }
    }
    return;
  }
}

function simulateDragonSpellTrapIgnition(state, card, action, zoneIndex) {
  const player = state.bot;
  if (card.name !== "Extreme Dragon Awakening") return;

  const fieldDragonEntries = selectFieldDragonCosts(player, 2, {
    preserveNames: ["Luminous Dragon", "Purified Crystal Dragon", "Radiant Cosmic Dragon"],
  });
  if (fieldDragonEntries.length < 2) return;

  const hasExtremeFaceup = (player.field || []).some(isExtremeDragon);
  const handTargetEntry = (player.hand || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(
      ({ candidate }) =>
        isDragonMonster(candidate) &&
        (candidate.level || 0) >= 8 &&
        (!hasExtremeFaceup || !isExtremeDragon(candidate)),
    )
    .sort((a, b) => {
      const score = (entry) =>
        orderBonus(entry.candidate, AWAKENING_TARGET_ORDER) +
        cardStrategicSimValue(entry.candidate);
      return score(b) - score(a);
    })[0];
  if (!handTargetEntry) return;

  const costIndices = fieldDragonEntries.slice(0, 2).map(({ index }) => index).sort((a, b) => b - a);
  for (const index of costIndices) {
    moveFieldIndexToGraveyard(player, index);
  }

  const targetIndex = player.hand.indexOf(handTargetEntry.candidate);
  if (targetIndex >= 0 && player.field.length < 5) {
    const summoned = player.hand.splice(targetIndex, 1)[0];
    specialSummonToField(state, player, summoned, action, {
      method: "special",
    });
  }
}

function simulateDragonFieldSpellEffect(state, card, action) {
  const player = state.bot;
  if (card.name !== "Jagged Peak of the Dragons") return;
  if ((card.counters?.dragon_peak || 0) < 5) return;
  if ((player.field || []).length >= 5) return;

  player.fieldSpell = null;
  putSimulatedCard(player, card, "graveyard");

  const zones = ["hand", "deck", "graveyard"];
  const candidates = [];
  for (const zone of zones) {
    (player[zone] || []).forEach((candidate, index) => {
      if (isDragonMonster(candidate)) candidates.push({ candidate, zone, index });
    });
  }
  candidates.sort((a, b) => cardStrategicSimValue(b.candidate) - cardStrategicSimValue(a.candidate));
  const selected = candidates[0];
  if (!selected) return;
  const sourceZone = player[selected.zone] || [];
  const liveIndex = sourceZone.indexOf(selected.candidate);
  if (liveIndex < 0) return;
  const summoned = sourceZone.splice(liveIndex, 1)[0];
  specialSummonToField(state, player, summoned, action, {
    method: "special",
  });
}

function simulateDragonFieldMonsterEffect(state, card, action, fieldIndex) {
  const player = state.bot;
  const opponent = state.player;

  if (card.name === "Abyssal Serpent Dragon") {
    const target = rankSimThreats(opponent.field || [])[0];
    if (!target) return;
    player.field.splice(fieldIndex, 1);
    putSimulatedCard(player, card, "graveyard");
    const targetIndex = opponent.field.indexOf(target);
    if (targetIndex >= 0) {
      opponent.field.splice(targetIndex, 1);
      putSimulatedCard(opponent, target, "graveyard");
    }
    recordSimulatedMaterialEffectActivation(state, player, card);
    return;
  }

  if (card.name === "Darkness Dragon") {
    if ((player.hand || []).length > 0) {
      const discardIdx = pickWorstDiscard(player.hand);
      discardHandCardToGraveyard(state, player, discardIdx);
    }
    const target = rankSimThreats(opponent.field || [])[0];
    if (target) target.effectsNegated = true;
    recordSimulatedMaterialEffectActivation(state, player, card);
    return;
  }

  if (card.name === "Majestic Silver Dragon") {
    const target = rankSimThreats(opponent.field || [])[0];
    if (target) {
      target.position = target.position === "defense" ? "attack" : "defense";
      recordSimulatedMaterialEffectActivation(state, player, card);
    }
    return;
  }

  if (card.name === "Purified Crystal Dragon") {
    const target = (player.field || [])
      .filter((candidate) => candidate !== card && isFaceupDragon(candidate))
      .sort((a, b) => cardStrategicSimValue(b) - cardStrategicSimValue(a))[0];
    if (!target) return;
    target.simEffectDestructionProtected = true;
    target.simProtectedBy = "Purified Crystal Dragon";
    recordSimulatedMaterialEffectActivation(state, player, card);
    return;
  }

  if (card.name === "Rainbow Cosmic Dragon") {
    const target = (player.field || [])
      .filter(isFaceupDragon)
      .sort((a, b) => cardStrategicSimValue(b) - cardStrategicSimValue(a))[0];
    if (!target) return;
    target.simBattleDestructionProtected = true;
    target.simEffectDestructionProtected = true;
    target.simProtectedUntilNextTurn = true;
    target.simProtectedBy = "Rainbow Cosmic Dragon";
    recordSimulatedMaterialEffectActivation(state, player, card);
    return;
  }

  if (card.name === "Hellkite Dragon") {
    const gyTarget = (player.graveyard || [])
      .filter((candidate) => isDragonMonster(candidate) && (candidate.level || 0) <= 7)
      .sort((a, b) => cardStrategicSimValue(b) - cardStrategicSimValue(a))[0];
    if (!gyTarget) return;
    player.field.splice(fieldIndex, 1);
    putSimulatedCard(player, card, "graveyard");
    const gyIndex = player.graveyard.indexOf(gyTarget);
    if (gyIndex >= 0 && player.field.length < 5) {
      const summoned = player.graveyard.splice(gyIndex, 1)[0];
      specialSummonToField(state, player, summoned, action, {
        method: "special",
      });
      recordSimulatedMaterialEffectActivation(state, player, card);
    }
    return;
  }

  if (card.name === "Volcanic Extreme Dragon") {
    if (!useSimulatedOnce(state, player, "volcanic_extreme_dragon_banish_burn")) return;
    const totalGy = (player.graveyard || []).length + (opponent.graveyard || []).length;
    if (totalGy <= 0) return;
    opponent.lp -= totalGy * 100;
    player.banished = [...(player.banished || []), ...(player.graveyard || [])];
    opponent.banished = [...(opponent.banished || []), ...(opponent.graveyard || [])];
    player.graveyard = [];
    opponent.graveyard = [];
    recordSimulatedMaterialEffectActivation(state, player, card);
  }
}

function simulateDragonGraveyardSpellEffect(state, card, action, graveyardIndex) {
  const player = state.bot;
  if (card.name !== "Hellkite Roar") return;
  const liveIndex = Number.isInteger(graveyardIndex)
    ? graveyardIndex
    : player.graveyard.indexOf(card);
  if (liveIndex >= 0) {
    const banished = player.graveyard.splice(liveIndex, 1)[0];
    putSimulatedCard(player, banished, "banished");
  }
  const deckIndex = (player.deck || []).findIndex(
    (candidate) => candidate?.name === "Jagged Peak of the Dragons",
  );
  if (deckIndex >= 0) {
    player.hand.push(player.deck.splice(deckIndex, 1)[0]);
  }
}

function simulateDragonGraveyardMonsterEffect(state, card, action) {
  const player = state.bot;
  const opponent = state.player;
  if (card.name === "Rainbow Cosmic Dragon" && !hasRainbowGyFollowUp(player)) {
    return;
  }
  const effect = (card.effects || []).find(
    (entry) =>
      entry && entry.timing === "ignition" && entry.requireZone === "graveyard",
  );
  if (!effect) return;

  const targetSelections = {};
  let resolvedAnyAction = false;
  for (const target of effect.targets || []) {
    const owner = target.owner === "opponent" ? opponent : player;
    const zoneName = target.zone || "field";
    const zone =
      zoneName === "fieldSpell"
        ? owner?.fieldSpell
          ? [owner.fieldSpell]
          : []
        : owner?.[zoneName] || [];
    const candidates = (zone || [])
      .map((candidate, index) => ({ candidate, index, owner, zoneName }))
      .filter(({ candidate }) => matchesEffectTarget(candidate, target));
    if (candidates.length < (target.count?.min ?? 1)) return;

    candidates.sort((a, b) => {
      if (target.id === "rainbow_cosmic_extreme_send_targets") {
        const score = (entry) =>
          orderBonus(entry.candidate, EXTREME_GY_SEND_ORDER, 30) +
          cardStrategicSimValue(entry.candidate);
        return score(b) - score(a);
      }
      const score = (entry) => {
        let value = cardStrategicSimValue(entry.candidate);
        if (isExtremeDragon(entry.candidate)) value += 100000;
        return value;
      };
      return score(a) - score(b);
    });

    targetSelections[target.id] = candidates.slice(0, target.count?.max || 1);
  }

  for (const effectAction of effect.actions || []) {
    if (effectAction.type === "move" && effectAction.targetRef) {
      const selections = targetSelections[effectAction.targetRef] || [];
      for (const selection of selections) {
        moveSimulatedCard(
          selection.owner,
          selection.candidate,
          selection.zoneName,
          effectAction.to || "graveyard",
          state,
        );
        resolvedAnyAction = true;
      }
      continue;
    }

    if (effectAction.type === "banish" && effectAction.targetRef === "self") {
      const fromZone = effectAction.fromZone || "graveyard";
      const sourceZone = player[fromZone] || [];
      const sourceIndex = sourceZone.indexOf(card);
      if (sourceIndex >= 0) {
        const banished = sourceZone.splice(sourceIndex, 1)[0];
        if (!player.banished) player.banished = [];
        player.banished.push(banished);
        resolvedAnyAction = true;
      }
      continue;
    }

    if (effectAction.type === "add_from_zone_to_hand") {
      const zoneName = effectAction.zone || "deck";
      const sourceZone = player[zoneName] || [];
      const candidates = sourceZone
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate }) => matchesActionFilters(candidate, effectAction));
      if (effectAction.requireSource === true) {
        const sourceIndex = sourceZone.indexOf(card);
        if (sourceIndex >= 0 && matchesActionFilters(card, effectAction)) {
          candidates.unshift({ candidate: card, index: sourceIndex });
        }
      }
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => cardStrategicSimValue(b.candidate) - cardStrategicSimValue(a.candidate));
      const selected = candidates[0];
      const liveIndex = sourceZone.indexOf(selected.candidate);
      if (liveIndex >= 0) {
        player.hand.push(sourceZone.splice(liveIndex, 1)[0]);
        resolvedAnyAction = true;
      }
      continue;
    }

    if (
      effectAction.type === "special_summon_from_zone" &&
      effectAction.zone === "graveyard" &&
      effectAction.requireSource === true
    ) {
      const sourceIndex = (player.graveyard || []).indexOf(card);
      if (sourceIndex < 0 || (player.field?.length || 0) >= 5) continue;
      player.graveyard.splice(sourceIndex, 1);
      const summoned = {
        ...card,
        position: action.position || "attack",
        isFacedown: false,
        hasAttacked: false,
        cannotAttackThisTurn: false,
      };
      applySimulatedPassiveBuffs(summoned, player);
      player.field.push(summoned);
      simulateDragonAfterSummonEffects(state, summoned, { method: "special" });
      resolvedAnyAction = true;
    }
  }

  if (resolvedAnyAction) {
    recordSimulatedMaterialEffectActivation(state, player, card);
  }
}

function simulateDragonAscension(state, action) {
  const player = state.bot;
  if (!player) return;

  const materialIndex = Number.isInteger(action.materialIndex)
    ? action.materialIndex
    : (player.field || []).findIndex(
        (candidate) =>
          candidate &&
          candidate.cardKind === "monster" &&
          !candidate.isFacedown &&
          (
            candidate.id === action.materialId ||
            candidate.id === action.ascensionCard?.ascension?.materialId
          ),
      );
  const material = player.field?.[materialIndex];
  if (!material || material.isFacedown) return;

  const extraIndex = (player.extraDeck || []).findIndex(
    (candidate) =>
      candidate &&
      candidate.monsterType === "ascension" &&
      (
        candidate.id === action.ascensionCard?.id ||
        candidate.name === action.cardName ||
        candidate.name === action.ascensionCard?.name
      ),
  );
  const ascensionCard =
    extraIndex >= 0 ? player.extraDeck[extraIndex] : action.ascensionCard;
  if (!ascensionCard || ascensionCard.monsterType !== "ascension") return;
  if (ascensionCard.ascension?.materialId !== material.id) return;

  const requirements = ascensionCard.ascension?.requirements || [];
  const requirementsMet = requirements.every((requirement) => {
    if (requirement?.type !== "material_effect_activations") return true;
    const required = Number(requirement.count || requirement.min || 0);
    return getMaterialEffectActivationCount(state, player, material.id) >= required;
  });
  if (!requirementsMet) return;

  player.field.splice(materialIndex, 1);
  putSimulatedCard(player, material, "graveyard");
  if (extraIndex >= 0) player.extraDeck.splice(extraIndex, 1);
  const summoned = specialSummonToField(state, player, ascensionCard, action, {
    method: "ascension",
    position: action.position || ascensionCard.ascension?.position || "attack",
  });
  if (summoned?.id === 260 || summoned?.name === "Rainbow Cosmic Dragon") {
    summoned.simBattleDestructionProtected = true;
  }
}

function matchesEffectTarget(card, target) {
  if (!card) return false;
  if (target.cardKind && card.cardKind !== target.cardKind) return false;
  if (target.type && card.type !== target.type) return false;
  if (target.filters?.type && card.type !== target.filters.type) return false;
  if (target.cardName && card.name !== target.cardName) return false;
  if (target.requireFaceup && card.isFacedown) return false;
  if (target.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(target.archetype)) return false;
  }
  return true;
}

function matchesActionFilters(card, action) {
  if (!card) return false;
  const filters = action.filters || {};
  if (action.cardKind && card.cardKind !== action.cardKind) return false;
  if (filters.cardKind && card.cardKind !== filters.cardKind) return false;
  if (filters.name && card.name !== filters.name) return false;
  if (filters.type && card.type !== filters.type) return false;
  if (Number.isFinite(action.minLevel) && (card.level || 0) < action.minLevel) return false;
  if (Number.isFinite(action.maxLevel) && (card.level || 0) > action.maxLevel) return false;
  return true;
}

function moveSimulatedCard(owner, card, fromZone, toZone, state = null) {
  if (!owner || !card) return;
  const sourceZone =
    fromZone === "fieldSpell"
      ? owner.fieldSpell
        ? [owner.fieldSpell]
        : []
      : owner[fromZone] || [];
  const sourceIndex = sourceZone.indexOf(card);
  if (sourceIndex < 0) return;
  if (fromZone === "fieldSpell") {
    owner.fieldSpell = null;
  } else {
    sourceZone.splice(sourceIndex, 1);
  }
  putSimulatedCard(owner, card, toZone);
  if (state && fromZone === "hand" && toZone === "graveyard") {
    applyDragonHandToGraveyardTriggers(state, owner, card);
  }
}

function applySimulatedPassiveBuffs(card, owner) {
  for (const effect of card.effects || []) {
    const passive = effect?.passive;
    if (passive?.type !== "graveyard_type_count_buff") continue;
    const count = (owner.graveyard || []).filter(
      (candidate) =>
        candidate &&
        candidate.cardKind === "monster" &&
        candidate.type === passive.monsterType,
    ).length;
    const amount = (passive.amountPerCard || 0) * count;
    if ((passive.stats || []).includes("atk")) {
      card.atk = (card.atk || 0) + amount;
    }
    if ((passive.stats || []).includes("def")) {
      card.def = (card.def || 0) + amount;
    }
  }
}

/**
 * Picks the worst card to discard (least valuable for the Dragon strategy).
 */
function pickWorstDiscard(hand) {
  if (!hand || hand.length === 0) return 0;

  let worstIdx = 0;
  let worstScore = Infinity;

  for (let i = 0; i < hand.length; i++) {
    const c = hand[i];
    const knowledge = CARD_KNOWLEDGE[c.name] || {};
    let score = knowledge.value || 0;

    // Prefer to discard Voltaic Dragon (its discard effect gives 800 burn)
    if (c.name === "Voltaic Dragon") score -= 5; // lower = more "worth" discarding
    // Never discard high-priority cards
    if (knowledge.role === "win_condition") score += 100;
    if (knowledge.role === "boss") score += 20;
    if (c.name === "Polymerization") score += 30; // Very valuable

    if (score < worstScore) {
      worstScore = score;
      worstIdx = i;
    }
  }

  return worstIdx;
}
