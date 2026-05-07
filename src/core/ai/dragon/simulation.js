// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/dragon/simulation.js
// Lookahead simulation for Dragon deck (BeamSearch / greedy).
// ─────────────────────────────────────────────────────────────────────────────

import { CARD_KNOWLEDGE, isExtremeDragon } from "./knowledge.js";
import { getTributeRequirementFor, selectBestTributes } from "./priorities.js";

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
    case "Converging Stars": {
      // Step 1: Discard 1 card (pick least valuable from remaining hand)
      if (player.hand.length > 0) {
        const discardIdx = pickWorstDiscard(player.hand);
        const discarded = player.hand.splice(discardIdx, 1)[0];
        player.graveyard.push(discarded);
      }

      // Step 2: Reduce all hand monster levels by 1
      player.hand = player.hand.map((c) => {
        if (c.cardKind === "monster" && (c.level || 0) > 1) {
          return { ...c, level: (c.level || 0) - 1 };
        }
        return c;
      });

      // Step 3: Simulate the best summon now unlocked (combined action)
      // This is critical so the state hash changes and beam search doesn't skip us.
      // Priority: Darkness Dragon (lv4 = 0 tributes)
      const darknessIdx = player.hand.findIndex(
        (c) => c.name === "Darkness Dragon" && (c.level || 0) <= 4,
      );
      if (darknessIdx >= 0 && (player.summonCount || 0) < 1 && player.field.length < 5) {
        const dd = player.hand.splice(darknessIdx, 1)[0];
        // Darkness Dragon destroys other field dragons but that's hard to simulate cleanly.
        // Approximate: just place with 2000 ATK as floor.
        const fieldDragons = player.field.filter((c) => c.type === "Dragon" || c.cardKind === "monster");
        const gainedATK = Math.min(fieldDragons.length, 3) * 300;
        player.field.push({
          ...dd,
          atk: 2000 + gainedATK,
          position: "attack",
          isFacedown: false,
          hasAttacked: false,
          cannotAttackThisTurn: true,
        });
        player.summonCount = (player.summonCount || 0) + 1;
        break;
      }

      // Priority: Abyssal Serpent Dragon (lv6 = 1 tribute, if have tribute)
      const abyssalIdx = player.hand.findIndex(
        (c) => c.name === "Abyssal Serpent Dragon" && (c.level || 0) <= 6,
      );
      if (abyssalIdx >= 0 && (player.summonCount || 0) < 1 && player.field.length >= 1) {
        const abyssal = player.hand.splice(abyssalIdx, 1)[0];
        // Tribute 1 monster (the worst one)
        const tributeIndices = selectBestTributes(player.field, 1, abyssal);
        tributeIndices.sort((a, b) => b - a);
        tributeIndices.forEach((idx) => {
          const t = player.field[idx];
          if (t) { player.graveyard.push(t); player.field.splice(idx, 1); }
        });
        player.field.push({
          ...abyssal,
          level: 6,
          position: "attack",
          isFacedown: false,
          hasAttacked: false,
          cannotAttackThisTurn: true,
        });
        player.summonCount = (player.summonCount || 0) + 1;
        break;
      }

      // Priority: Majestic Silver Dragon (lv6 = 1 tribute)
      const majesticIdx = player.hand.findIndex(
        (c) => c.name === "Majestic Silver Dragon" && (c.level || 0) <= 6,
      );
      if (majesticIdx >= 0 && (player.summonCount || 0) < 1 && player.field.length >= 1) {
        const majestic = player.hand.splice(majesticIdx, 1)[0];
        const tributeIndices = selectBestTributes(player.field, 1, majestic);
        tributeIndices.sort((a, b) => b - a);
        tributeIndices.forEach((idx) => {
          const t = player.field[idx];
          if (t) { player.graveyard.push(t); player.field.splice(idx, 1); }
        });
        player.field.push({
          ...majestic,
          level: 6,
          atk: 2500,
          position: "attack",
          isFacedown: false,
          hasAttacked: false,
          cannotAttackThisTurn: true,
        });
        player.summonCount = (player.summonCount || 0) + 1;
      }
      break;
    }

    case "Polymerization": {
      // Check for Bahamut first (5 Extreme Dragons in GY)
      const extremeInGY = (player.graveyard || []).filter((c) => isExtremeDragon(c));
      if (extremeInGY.length >= 5) {
        // Simulate Bahamut summon — clear other monsters (can't control others)
        player.graveyard.push(...player.field);
        player.field = [];
        // Banish 5 extreme dragons from GY
        const toKeep = player.graveyard.filter((c) => !isExtremeDragon(c));
        const extremes = player.graveyard.filter((c) => isExtremeDragon(c));
        player.graveyard = [...toKeep, ...extremes.slice(5)]; // keep any extras
        player.field.push({
          name: "Supreme Bahamut Dragon",
          atk: 4000,
          def: 4000,
          level: 12,
          cardKind: "monster",
          type: "Dragon",
          position: "attack",
          hasAttacked: false,
        });
        break;
      }

      // Tech-Void Dragon: Voltaic + lv5+ Dragon
      const allCards = [...player.hand, ...player.field];
      const voltaicHandIdx = player.hand.findIndex((c) => c.name === "Voltaic Dragon");
      const voltaicFieldIdx = player.field.findIndex((c) => c.name === "Voltaic Dragon");
      const hasVoltaic = voltaicHandIdx >= 0 || voltaicFieldIdx >= 0;

      const lv5Idx = [...player.hand, ...player.field].findIndex(
        (c) => (c.type === "Dragon" || c.cardKind === "monster") && (c.level || 0) >= 5 && c.name !== "Voltaic Dragon"
      );

      if (hasVoltaic && lv5Idx >= 0 && player.field.length < 5) {
        // Remove materials
        if (voltaicHandIdx >= 0) {
          player.graveyard.push(player.hand[voltaicHandIdx]);
          player.hand.splice(voltaicHandIdx, 1);
        } else {
          player.graveyard.push(player.field[voltaicFieldIdx]);
          player.field.splice(voltaicFieldIdx, 1);
        }
        player.field.push({
          name: "Tech-Void Dragon",
          atk: 2500,
          def: 1000,
          level: 8,
          cardKind: "monster",
          type: "Dragon",
          position: "attack",
          hasAttacked: false,
        });
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
      // Destroy up to 2 opp spell/trap — approximate by removing backrow from state
      const opp = state.player;
      if (opp?.spellTrap?.length > 0) {
        opp.spellTrap = opp.spellTrap.slice(Math.min(2, opp.spellTrap.length));
      }
      break;
    }

    default:
      break;
  }
}

/**
 * Simulates hand ignition effects for Dragon monsters.
 */
function simulateDragonHandIgnition(state, card, action) {
  const player = state.bot;

  if (card.name === "Voltaic Dragon") {
    // SS if control Dragon — just place it on field
    if (player.field.some((c) => c.type === "Dragon" || c.cardKind === "monster") && player.field.length < 5) {
      player.hand.splice(action.index, 1);
      player.field.push({
        ...card,
        position: "attack",
        isFacedown: false,
        hasAttacked: false,
        cannotAttackThisTurn: false,
      });
    }
    return;
  }

  if (card.name === "Hellkite Dragon") {
    // Send field Dragon to GY → SS Hellkite from hand
    const costIdx =
      player.field
        .map((candidate, index) => ({ candidate, index }))
        .filter(
          ({ candidate }) =>
            candidate &&
            (candidate.type === "Dragon" || candidate.cardKind === "monster") &&
            !isExtremeDragon(candidate),
        )
        .sort(
          (a, b) =>
            (a.candidate.atk || 0) +
            (a.candidate.level || 0) * 50 -
            ((b.candidate.atk || 0) + (b.candidate.level || 0) * 50),
        )[0]?.index ?? -1;
    if (costIdx >= 0 && player.field.length < 5) {
      const cost = player.field.splice(costIdx, 1)[0];
      player.graveyard.push(cost);
      player.hand.splice(action.index, 1);
      player.field.push({
        ...card,
        position: "attack",
        isFacedown: false,
        hasAttacked: false,
        cannotAttackThisTurn: false,
      });
    }
    return;
  }

  if (card.name === "Black Bull Dragon") {
    // Discard 2 Dragons → SS Black Bull (can't attack this turn)
    const handDragons = player.hand
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => (c.type === "Dragon" || c.cardKind === "monster") && i !== action.index);
    if (handDragons.length >= 2 && player.field.length < 5) {
      // Discard Voltaic first (triggers 800 burn in real game)
      const voltaicEntry = handDragons.find(({ c }) => c.name === "Voltaic Dragon");
      const toDiscard = voltaicEntry
        ? [voltaicEntry, ...handDragons.filter(({ c }) => c.name !== "Voltaic Dragon")].slice(0, 2)
        : handDragons.slice(0, 2);
      const discardIndices = toDiscard.map(({ i }) => i).sort((a, b) => b - a);
      discardIndices.forEach((idx) => {
        const discarded = player.hand.splice(idx, 1)[0];
        player.graveyard.push(discarded);
      });
      // Account for the shifted index after discards
      const bbd = player.hand.find((c) => c.name === "Black Bull Dragon");
      if (bbd) {
        const bbdIdx = player.hand.indexOf(bbd);
        player.hand.splice(bbdIdx, 1);
        player.field.push({
          ...card,
          position: "attack",
          isFacedown: false,
          hasAttacked: false,
          cannotAttackThisTurn: true, // Can't attack this turn
        });
      }
    }
    return;
  }

  if (card.name === "Purified Crystal Dragon") {
    // Banish 3 GY Dragons → SS
    const gyDragons = (player.graveyard || []).filter(
      (c) => c.cardKind === "monster" && !isExtremeDragon(c),
    );
    if (gyDragons.length >= 3 && player.field.length < 5) {
      // Banish 3 non-extreme GY dragons
      let banished = 0;
      player.graveyard = player.graveyard.filter((c) => {
        if (banished < 3 && c.cardKind === "monster" && !isExtremeDragon(c)) {
          banished++;
          return false;
        }
        return true;
      });
      player.hand.splice(action.index, 1);
      player.field.push({
        ...card,
        position: "attack",
        isFacedown: false,
        hasAttacked: false,
        cannotAttackThisTurn: false,
      });
    }
    return;
  }
}

function simulateDragonGraveyardMonsterEffect(state, card, action) {
  const player = state.bot;
  const opponent = state.player;
  const effect = (card.effects || []).find(
    (entry) =>
      entry && entry.timing === "ignition" && entry.requireZone === "graveyard",
  );
  if (!effect) return;

  const targetSelections = {};
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
      const aExtreme = isExtremeDragon(a.candidate) ? 100000 : 0;
      const bExtreme = isExtremeDragon(b.candidate) ? 100000 : 0;
      const aValue =
        aExtreme + (a.candidate.atk || 0) + (a.candidate.level || 0) * 50;
      const bValue =
        bExtreme + (b.candidate.atk || 0) + (b.candidate.level || 0) * 50;
      return aValue - bValue;
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
        );
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
    }
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

function moveSimulatedCard(owner, card, fromZone, toZone) {
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
  if (!owner[toZone]) owner[toZone] = [];
  owner[toZone].push(card);
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
