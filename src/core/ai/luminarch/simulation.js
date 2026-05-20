import { estimateCardValue } from "../StrategyUtils.js";
import { buildStrategyAnalysis } from "../common/analysis.js";
import { getStrongestAttackThreat } from "../common/cardStats.js";
import {
  applyGenericSimulatedMainPhaseAction,
  simulateGenericSpellEffect,
} from "../common/simulation.js";
import { isLuminarch } from "./knowledge.js";
import { shouldPlaySpell } from "./priorities.js";

export function rankLuminarchSearchCandidates(cards, action = {}, ctx = {}) {
  if (!Array.isArray(cards) || cards.length <= 1) return cards || [];
  const player = ctx.player || ctx.strategy?.bot || {};
  const opponent =
    ctx.opponent || ctx.getOpponent?.(ctx.game || {}, player) || {};
  const hand = player.hand || [];
  const field = player.field || [];
  const spellTrap = player.spellTrap || [];
  const graveyard = player.graveyard || [];
  const isCitadel = (card) => (card?.name || "").includes("Citadel");
  const hasActiveCitadel = isCitadel(player.fieldSpell);
  const hasCitadelInHand = hand.some(isCitadel);
  const hasTank = field.some(
    (card) =>
      card?.name === "Luminarch Aegisbearer" ||
      card?.name === "Luminarch Sanctum Protector" ||
      card?.name === "Luminarch Fortress Aegis",
  );
  const hasProtection = [...hand, ...spellTrap].some(
    (card) =>
      card?.name === "Luminarch Holy Shield" ||
      card?.name === "Luminarch Crescent Shield" ||
      card?.name === "Luminarch Moonlit Blessing",
  );
  const oppStrongest = getStrongestAttackThreat(opponent.field || [], {
    facedownValue: 1500,
    includeBoosts: false,
  });
  const underPressure =
    oppStrongest >= 2200 || (opponent.field || []).length >= 2;
  const namesInHand = new Set(hand.map((card) => card?.name).filter(Boolean));

  const analysis = buildStrategyAnalysis({
    bot: player,
    opponent,
    game: ctx.game,
  });

  const scoreCard = (card) => {
    if (!card) return -999;
    let score = estimateCardValue(card, {
      archetype: "Luminarch",
      fieldSpell: player.fieldSpell || null,
      preferDefense: true,
    });
    if (!isLuminarch(card)) score -= 20;
    if (namesInHand.has(card.name)) score -= 4;

    if (card.cardKind === "monster") {
      if (card.name === "Luminarch Aegisbearer" && !hasTank) score += 60;
      if (
        card.name === "Luminarch Sanctified Arbiter" &&
        !hasActiveCitadel &&
        !hasCitadelInHand
      ) {
        score += 45;
      }
      if (card.name === "Luminarch Enchanted Halberd") score += 18;
      if (card.name === "Luminarch Magic Sickle") {
        score += underPressure ? 10 : 2;
      }
      if (underPressure && !hasTank && card.def >= 2000) score += 20;
      return score;
    }

    if (isCitadel(card)) {
      score += hasActiveCitadel || hasCitadelInHand ? -120 : 90;
    }
    if (card.name === "Luminarch Holy Shield") {
      score += underPressure && !hasProtection ? 55 : 24;
    }
    if (card.name === "Luminarch Moonlit Blessing") {
      score += graveyard.some((entry) => entry && isLuminarch(entry)) ? 35 : 8;
    }
    if (card.name === "Luminarch Radiant Wave") {
      score += shouldPlaySpell(card, analysis).yes ? 32 : -35;
    }
    if (card.name === "Luminarch Holy Ascension") {
      score += shouldPlaySpell(card, analysis).yes ? 28 : -30;
    }
    if (card.name === "Luminarch Knights Convocation") {
      const convocationDecision = shouldPlaySpell(card, analysis);
      score += convocationDecision.yes
        ? convocationDecision.priority * 4
        : -40;
    }
    return score;
  };

  return cards.slice().sort((a, b) => scoreCard(b) - scoreCard(a));
}

export function simulateLuminarchSearch(
  player,
  sourceCard,
  action,
  state,
  options = {},
) {
  if (!player || !Array.isArray(player.deck) || player.deck.length === 0) {
    return null;
  }
  const isValiant =
    sourceCard?.name === "Luminarch Valiant - Knight of the Dawn";
  const isArbiter = sourceCard?.name === "Luminarch Sanctified Arbiter";
  if (!isValiant && !isArbiter) return null;

  const candidates = player.deck.filter((card) => {
    if (!card || !isLuminarch(card)) return false;
    if (isValiant) {
      return card.cardKind === "monster" && (card.level || 0) <= 4;
    }
    return card.cardKind === "spell" || card.cardKind === "trap";
  });
  const ranked = rankLuminarchSearchCandidates(candidates, action, {
    player,
    opponent: state?.player,
    game: state,
    source: sourceCard,
    strategy: options.strategy,
    getOpponent: options.getOpponent,
  });
  const chosen = ranked[0];
  if (!chosen) return null;
  const deckIndex = player.deck.indexOf(chosen);
  if (deckIndex < 0) return null;
  const [moved] = player.deck.splice(deckIndex, 1);
  player.hand.push({ ...moved });
  return moved;
}

function handleLuminarchAfterSummon({ state, action, player, card, newCard, options }) {
  if (
    card.name === "Luminarch Valiant - Knight of the Dawn" &&
    !action.facedown
  ) {
    const searched = simulateLuminarchSearch(
      player,
      newCard,
      action,
      state,
      options,
    );
    if (searched) {
      newCard._searchedAegis = true;
    }
  }

  if (card.name === "Luminarch Sanctified Arbiter" && !action.facedown) {
    const searched = simulateLuminarchSearch(
      player,
      newCard,
      action,
      state,
      options,
    );
    if (searched) {
      newCard._searchedSpell = true;
    }
  }
}

function handleSanctumProtectorShortcut({
  state,
  action,
  resolveSimulatedHandIndex,
  resolveSimulatedFieldIndex,
}) {
  const player = state.bot;
  const handIndex = resolveSimulatedHandIndex(
    player,
    {
      ...action,
      cardName: action.cardName || "Luminarch Sanctum Protector",
    },
    "monster",
  );
  if (handIndex < 0) return true;
  const materialIndex = resolveSimulatedFieldIndex(
    player,
    { materialIndex: action.materialIndex },
    (card) => card.name === "Luminarch Aegisbearer" && !card.isFacedown,
  );
  if (materialIndex < 0) return true;

  const material = player.field[materialIndex];
  if (material) {
    player.field.splice(materialIndex, 1);
    player.graveyard.push(material);
  }

  const protector = player.hand[handIndex];
  player.hand.splice(handIndex, 1);
  const newCard = { ...protector };
  newCard.position = action.position || "defense";
  newCard.isFacedown = false;
  newCard.hasAttacked = false;
  newCard.attacksUsedThisTurn = 0;
  if (newCard.cardKind !== "monster") {
    console.error(
      `[LuminarchStrategy] BLOCKED sim protector: ${newCard.cardKind} "${newCard.name}" tried to enter field!`,
    );
    player.graveyard.push(newCard);
  } else {
    player.field.push(newCard);
  }
  return true;
}

function handleLuminarchMonsterEffect({ card, options }) {
  if (card.name !== "Luminarch Megashield Barbarias") return false;
  const target = card.position === "defense" ? card : null;
  if (!target) return true;
  const stanceDance = options.barbariasStanceDance || { atkBoost: 800 };
  target.position = "attack";
  target.cannotAttackThisTurn = false;
  target.tempAtkBoost = (target.tempAtkBoost || 0) + stanceDance.atkBoost;
  target.atk = (target.atk || 0) + stanceDance.atkBoost;
  target._simulatedBarbariasBoost = true;
  return true;
}

function getLuminarchFieldEffectTargetPreference({ fieldSpell, options }) {
  return fieldSpell.name?.includes("Citadel") ? options.citadelTempBuff : null;
}

export function simulateLuminarchMainPhaseAction(
  state,
  action,
  options = {},
) {
  return applyGenericSimulatedMainPhaseAction(state, action, {
    archetype: "Luminarch",
    preferDefense: true,
    selfId: "bot",
    guardLabel: "LuminarchStrategy.simulateMainPhaseAction",
    ...options,
    onAfterSummon: handleLuminarchAfterSummon,
    onMonsterEffect: handleLuminarchMonsterEffect,
    getFieldEffectTargetPreference: getLuminarchFieldEffectTargetPreference,
    actionOverrides: {
      ...(options.actionOverrides || {}),
      special_summon_sanctum_protector: handleSanctumProtectorShortcut,
    },
  });
}

export function simulateLuminarchSpellEffect(state, card, options = {}) {
  return simulateGenericSpellEffect(state, card, {
    archetype: "Luminarch",
    preferDefense: true,
    selfId: "bot",
    ...options,
  });
}
