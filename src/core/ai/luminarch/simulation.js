import { estimateCardValue } from "../StrategyUtils.js";
import { buildStrategyAnalysis } from "../common/analysis.js";
import { getStrongestAttackThreat } from "../common/cardStats.js";
import {
  applyGenericSimulatedMainPhaseAction,
  simulateGenericSpellEffect,
} from "../common/simulation.js";
import { isLuminarch } from "./knowledge.js";
import { shouldPlaySpell } from "./priorities.js";

const BARBARIAS_NAME = "Luminarch Megashield Barbarias";
const CITADEL_NAME = "Sanctum of the Luminarch Citadel";
const CELESTIAL_MARSHAL_NAME = "Luminarch Celestial Marshal";
const ENCHANTED_HALBERD_NAME = "Luminarch Enchanted Halberd";
const FORTRESS_AEGIS_NAME = "Luminarch Fortress Aegis";
const MAGIC_SICKLE_NAME = "Luminarch Magic Sickle";
const PURE_KNIGHT_NAME = "Luminarch Pure Knight";

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
      card?.name === FORTRESS_AEGIS_NAME,
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
  const preferredSearchNames =
    ctx.ctx?.activationContext?.actionContext?.preferredSearchNames ||
    ctx.activationContext?.actionContext?.preferredSearchNames ||
    [];

  const scoreCard = (card) => {
    if (!card) return -999;
    let score = estimateCardValue(card, {
      archetype: "Luminarch",
      fieldSpell: player.fieldSpell || null,
      preferDefense: true,
    });
    if (!isLuminarch(card)) score -= 20;
    if (namesInHand.has(card.name)) score -= 4;
    if (preferredSearchNames.includes(card.name)) score += 100;

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
      if (card.name === MAGIC_SICKLE_NAME) {
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

function ensureLuminarchSimMeta(state) {
  if (!state._simLuminarch) {
    state._simLuminarch = {
      lpPayments: [],
      milestones: [],
    };
  }
  if (!Array.isArray(state._simLuminarch.lpPayments)) {
    state._simLuminarch.lpPayments = [];
  }
  if (!Array.isArray(state._simLuminarch.milestones)) {
    state._simLuminarch.milestones = [];
  }
  return state._simLuminarch;
}

function getOpponentStrongestAttack(state) {
  return getStrongestAttackThreat(state?.player?.field || [], {
    facedownValue: 1500,
    includeBoosts: false,
  });
}

function hasOpenMonsterZone(player) {
  return (player?.field || []).length < 5;
}

function chooseLuminarchSpecialSummonPosition(card, context = {}) {
  const actionPosition = context.action?.position;
  if (actionPosition && actionPosition !== "choice") return actionPosition;

  const sourceAction = context.sourceAction || null;
  const byName =
    sourceAction?.activationContext?.actionContext?.fusionPositions?.byName ||
    context.activationContext?.actionContext?.fusionPositions?.byName ||
    {};
  if (card?.name && byName[card.name]) return byName[card.name];

  if (
    card?.name === BARBARIAS_NAME ||
    card?.name === PURE_KNIGHT_NAME ||
    card?.name === FORTRESS_AEGIS_NAME
  ) {
    return "defense";
  }

  if (card?.name === CELESTIAL_MARSHAL_NAME) {
    return getOpponentStrongestAttack(context.state || {}) > 0
      ? "defense"
      : "attack";
  }

  const strategyChooser =
    context.options?.chooseSummonPosition ||
    context.options?.strategy?.chooseSummonPosition?.bind(context.options.strategy);
  if (typeof strategyChooser === "function") {
    const choice = strategyChooser(card, context.game || context.state);
    if (choice === "attack" || choice === "defense") return choice;
  }

  const opponentStrongest = getOpponentStrongestAttack(context.state || {});
  const atk = card?.atk || 0;
  const def = card?.def || 0;
  if (opponentStrongest > atk && def >= atk) return "defense";
  return "attack";
}

function pushSimulatedFieldMonster(player, card, position, extra = {}) {
  const newCard = {
    ...card,
    position,
    isFacedown: false,
    hasAttacked: false,
    attacksUsedThisTurn: 0,
    ...extra,
  };
  player.field.push(newCard);
  return newCard;
}

function simulateEnchantedHalberdFollowUp(state, player, reason = "special_summon") {
  const meta = ensureLuminarchSimMeta(state);
  if (meta.halberdSummonedThisTurn) return null;
  if (!hasOpenMonsterZone(player)) return null;

  const halberdIndex = (player.hand || []).findIndex(
    (card) => card?.name === ENCHANTED_HALBERD_NAME,
  );
  if (halberdIndex < 0) return null;

  const [halberd] = player.hand.splice(halberdIndex, 1);
  const summoned = pushSimulatedFieldMonster(player, halberd, "defense", {
    cannotAttackThisTurn: true,
    _simulatedHalberdFollowUp: true,
    _simulatedHalberdReason: reason,
  });
  meta.halberdSummonedThisTurn = true;
  meta.milestones.push("halberd_followup");
  return summoned;
}

function recordLuminarchLpPayment(
  state,
  { cardName, cost, beforeLp, afterLp, createsWall = false, createsPayoff = false },
) {
  const meta = ensureLuminarchSimMeta(state);
  const opponentThreat = getOpponentStrongestAttack(state);
  const risky =
    afterLp > 0 &&
    opponentThreat >= afterLp &&
    createsWall !== true &&
    createsPayoff !== true;
  meta.lpPayments.push({
    cardName,
    cost,
    beforeLp,
    afterLp,
    opponentThreat,
    createsWall,
    createsPayoff,
    risky,
  });
  if (risky) meta.milestones.push("risky_lp_payment");
  else if (createsWall) meta.milestones.push("lp_payment_created_wall");
  else if (createsPayoff) meta.milestones.push("lp_payment_created_payoff");
}

function simulateCelestialMarshalHandIgnition({
  state,
  action,
  options,
  resolveSimulatedHandIndex,
}) {
  const player = state.bot;
  if (!player || !hasOpenMonsterZone(player)) return { handled: true };

  const handIndex = resolveSimulatedHandIndex(player, action, "monster");
  const marshal = player.hand?.[handIndex];
  if (!marshal || marshal.name !== CELESTIAL_MARSHAL_NAME) return false;

  const beforeLp = player.lp || 0;
  if (beforeLp <= 2000) return { handled: true };

  player.lp = Math.max(0, beforeLp - 2000);
  player.hand.splice(handIndex, 1);

  const position = chooseLuminarchSpecialSummonPosition(marshal, {
    state,
    game: state,
    action,
    sourceAction: action,
    options,
    activationContext: action.activationContext,
  });
  const summoned = pushSimulatedFieldMonster(player, marshal, position, {
    _simulatedMarshalSelfSummon: true,
  });

  const opponentStrongest = getOpponentStrongestAttack(state);
  const createsWall =
    summoned.position === "defense" &&
    ((summoned.def || 0) >= opponentStrongest ||
      summoned.battleIndestructibleOncePerTurn === true);
  const createsPayoff = simulateEnchantedHalberdFollowUp(
    state,
    player,
    "marshal_self_summon",
  );

  recordLuminarchLpPayment(state, {
    cardName: CELESTIAL_MARSHAL_NAME,
    cost: 2000,
    beforeLp,
    afterLp: player.lp || 0,
    createsWall,
    createsPayoff: !!createsPayoff,
  });
  ensureLuminarchSimMeta(state).milestones.push("marshal_self_summon");
  return { handled: true };
}

function handleLuminarchHandIgnitionOverride(args) {
  const player = args.state?.bot;
  const handIndex = args.resolveSimulatedHandIndex(player, args.action, "monster");
  const card = player?.hand?.[handIndex];
  if (card?.name === CELESTIAL_MARSHAL_NAME) {
    return simulateCelestialMarshalHandIgnition(args);
  }
  return false;
}

function handleLuminarchMonsterEffect({ card, options }) {
  if (card.name !== BARBARIAS_NAME) return false;
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

function simulatePureKnightSearch(player, pureKnight) {
  const citadelIndex = (player.deck || []).findIndex(
    (card) => card?.name === CITADEL_NAME,
  );
  if (citadelIndex < 0) return false;
  const [citadel] = player.deck.splice(citadelIndex, 1);
  player.hand.push(citadel);
  pureKnight._simulatedCitadelSearch = true;
  return true;
}

function handleLuminarchFusionSummon({
  state,
  player,
  fusionCard,
  materials,
  options,
}) {
  if (!fusionCard || !player) return;

  const meta = ensureLuminarchSimMeta(state);
  const position = chooseLuminarchSpecialSummonPosition(fusionCard, {
    state,
    game: state,
    action: options?.sourceAction,
    sourceAction: options?.sourceAction,
    options,
    activationContext: options?.activationContext,
  });
  fusionCard.position = position;
  fusionCard.isFacedown = false;

  if (fusionCard.name === PURE_KNIGHT_NAME) {
    const searchedCitadel = simulatePureKnightSearch(player, fusionCard);
    fusionCard._simulatedRole = "citadel_access";
    fusionCard._simulatedLpCostReductionAvailable = true;
    fusionCard._simulatedMaterialsUsed = (materials || []).map(
      (card) => card?.name,
    );
    meta.pureKnightDiscountAvailable = true;
    meta.milestones.push("pure_knight_fusion");
    if (searchedCitadel) meta.milestones.push("citadel_access");
    simulateEnchantedHalberdFollowUp(state, player, "fusion_summon");
    return;
  }

  if (fusionCard.name === BARBARIAS_NAME) {
    fusionCard._simulatedRole = "defensive_wall";
    fusionCard._simulatedLpPayoff = true;
    fusionCard._simulatedMaterialsUsed = (materials || []).map(
      (card) => card?.name,
    );
    meta.barbariasLpPayoff = true;
    meta.milestones.push("barbarias_fusion_wall");
    simulateEnchantedHalberdFollowUp(state, player, "fusion_summon");
  }
}

function handleLuminarchAfterSpecialSummon({ state, player, card, sourceCard }) {
  if (!card || !isLuminarch(card)) return;
  if (card.name === ENCHANTED_HALBERD_NAME) return;
  simulateEnchantedHalberdFollowUp(
    state,
    player,
    sourceCard?.name === FORTRESS_AEGIS_NAME ? "fortress_revive" : "special_summon",
  );
}

function handleLuminarchEffectActivated({ state, player, card, effect }) {
  if (!card || !effect || !player) return;
  if (card.name === MAGIC_SICKLE_NAME) {
    ensureLuminarchSimMeta(state).milestones.push("sickle_spell_recovery");
  }

  const lpCost = (effect.actions || []).reduce((sum, action) => {
    if (action?.type !== "pay_lp") return sum;
    return sum + (Number.isFinite(action.amount) ? action.amount : 0);
  }, 0);
  if (lpCost <= 0) return;

  const beforeLp = (player.lp || 0) + lpCost;
  const hasWall = (player.field || []).some(
    (entry) =>
      entry &&
      entry.cardKind === "monster" &&
      !entry.isFacedown &&
      (entry.mustBeAttacked ||
        entry.battleIndestructibleOncePerTurn ||
        (entry.position === "defense" && (entry.def || 0) >= getOpponentStrongestAttack(state))),
  );
  const createsPayoff =
    card.name === FORTRESS_AEGIS_NAME ||
    card.name === MAGIC_SICKLE_NAME ||
    card.name === BARBARIAS_NAME ||
    card.name === PURE_KNIGHT_NAME;

  recordLuminarchLpPayment(state, {
    cardName: card.name,
    cost: lpCost,
    beforeLp,
    afterLp: player.lp || 0,
    createsWall: hasWall,
    createsPayoff,
  });
  if (card.name === FORTRESS_AEGIS_NAME) {
    ensureLuminarchSimMeta(state).milestones.push("fortress_revive");
  }
}

function getLuminarchFieldEffectTargetPreference({ fieldSpell, options }) {
  return fieldSpell.name?.includes("Citadel") ? options.citadelTempBuff : null;
}

function prepareLuminarchAction(action) {
  if (!action) return action;
  const prepared = { ...action };
  if (
    prepared.type === "spell" &&
    prepared.cardName === "Polymerization" &&
    !prepared.fusionTargetHint
  ) {
    prepared.fusionTargetHint = prepared.fusionTarget || null;
  }
  return prepared;
}

export function simulateLuminarchMainPhaseAction(
  state,
  action,
  options = {},
) {
  const preparedAction = prepareLuminarchAction(action);
  return applyGenericSimulatedMainPhaseAction(state, preparedAction, {
    archetype: "Luminarch",
    preferDefense: true,
    selfId: "bot",
    guardLabel: "LuminarchStrategy.simulateMainPhaseAction",
    ...options,
    onAfterSummon: handleLuminarchAfterSummon,
    onAfterSpecialSummon: handleLuminarchAfterSpecialSummon,
    onEffectActivated: handleLuminarchEffectActivated,
    onFusionSummon: handleLuminarchFusionSummon,
    onMonsterEffect: handleLuminarchMonsterEffect,
    getFieldEffectTargetPreference: getLuminarchFieldEffectTargetPreference,
    chooseSpecialSummonPosition: (card, context) =>
      chooseLuminarchSpecialSummonPosition(card, {
        state,
        game: context?.game || state,
        action: context?.action,
        sourceAction: preparedAction,
        options,
        activationContext: context?.activationContext,
      }),
    actionOverrides: {
      ...(options.actionOverrides || {}),
      handIgnition: handleLuminarchHandIgnitionOverride,
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
