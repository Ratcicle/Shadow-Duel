// ---------------------------------------------------------------------------
// src/core/ai/shadowheart/simulation.js
// Shadow-Heart simulation layer for lookahead/beam/planner clones.
// ---------------------------------------------------------------------------

import {
  applyGenericSimulatedMainPhaseAction,
  resolveSimulatedHandIndex,
  simulateGenericSpellEffect,
} from "../common/simulation.js";
import { cardMatchesFilter } from "../common/cardFilters.js";
import { getCounterCount } from "../common/counters.js";
import { isShadowHeart, isShadowHeartByName } from "./knowledge.js";
import {
  buildShadowHeartTargetPreferences,
  buildShadowHeartCostPreferences,
  chooseCathedralSummonTarget,
  chooseImpSpecialTargetName,
  evaluateShadowHeartFusionPlan,
  evaluateShadowHeartRecruitCandidate,
  getTributeRequirementFor,
  rankShadowHeartSearchCandidates,
  selectBestTributes,
} from "./priorities.js";
import {
  fieldHasTributeValue,
  getTributeCardsFromIndices,
  getTributeValueTotal,
} from "../../game/summon/tributeValue.js";

const SH = {
  arctroth: "Shadow-Heart Demon Arctroth",
  battleHymn: "Shadow-Heart Battle Hymn",
  cathedral: "Shadow-Heart Cathedral",
  covenant: "Shadow-Heart Covenant",
  demonDragon: "Shadow-Heart Demon Dragon",
  gecko: "Shadow-Heart Gecko",
  imp: "Shadow-Heart Imp",
  infusion: "Shadow-Heart Infusion",
  leviathan: "Shadow-Heart Leviathan",
  purge: "Shadow-Heart Purge",
  rage: "Shadow-Heart Rage",
  scale: "Shadow-Heart Scale Dragon",
  valley: "Darkness Valley",
  voidMage: "Shadow-Heart Void Mage",
};

function normalizeOptions(placeSpellCardOrOptions = null) {
  if (typeof placeSpellCardOrOptions === "function") {
    return { placeSpellCard: placeSpellCardOrOptions };
  }
  return placeSpellCardOrOptions || {};
}

function ensureZones(player = {}) {
  player.hand = player.hand || [];
  player.field = player.field || [];
  player.spellTrap = player.spellTrap || [];
  player.graveyard = player.graveyard || [];
  player.deck = player.deck || [];
  player.extraDeck = player.extraDeck || [];
  player.banished = player.banished || [];
  return player;
}

function isDragonType(card) {
  if (!card) return false;
  if (Array.isArray(card.types)) {
    return card.types.some(
      (type) => String(type || "").toLowerCase() === "dragon",
    );
  }
  return String(card.type || "").toLowerCase() === "dragon";
}

function isShadowHeartDragon(card) {
  return (
    card?.cardKind === "monster" &&
    !card.isFacedown &&
    isDragonType(card) &&
    (isShadowHeart(card) || isShadowHeartByName(card.name))
  );
}

function buildSimAnalysis(state = {}) {
  const player = ensureZones(state.bot || {});
  const opponent = ensureZones(state.player || {});
  return {
    hand: player.hand,
    field: player.field,
    graveyard: player.graveyard,
    spellTrap: player.spellTrap,
    fieldSpell: player.fieldSpell?.name || null,
    deck: player.deck,
    extraDeck: player.extraDeck,
    lp: player.lp || 8000,
    summonCount: player.summonCount || 0,
    phase: state.phase || state.currentPhase || "main1",
    game: state,
    player,
    opponent,
    oppField: opponent.field || [],
    oppLp: opponent.lp || 8000,
  };
}

function getSimOptBucket(state, selfId = "bot") {
  if (!state._simOncePerTurn) state._simOncePerTurn = {};
  if (Array.isArray(state._simOncePerTurn[selfId])) {
    state._simOncePerTurn[selfId] = new Set(state._simOncePerTurn[selfId]);
  }
  if (!state._simOncePerTurn[selfId]) {
    state._simOncePerTurn[selfId] = new Set();
  }
  return state._simOncePerTurn[selfId];
}

function canUseSimOpt(state, key, selfId = "bot") {
  if (!key) return true;
  return !getSimOptBucket(state, selfId).has(key);
}

function markSimOpt(state, key, selfId = "bot") {
  if (!key) return;
  getSimOptBucket(state, selfId).add(key);
}

function removeFromZone(list, card) {
  const index = list?.indexOf(card) ?? -1;
  if (index < 0) return false;
  list.splice(index, 1);
  return true;
}

function moveToZone(player, card, zone) {
  if (!player || !card) return false;
  for (const key of [
    "hand",
    "field",
    "graveyard",
    "spellTrap",
    "deck",
    "extraDeck",
    "banished",
  ]) {
    const cards = player[key];
    if (Array.isArray(cards) && removeFromZone(cards, card)) break;
  }
  if (player.fieldSpell === card) player.fieldSpell = null;
  if (zone === "fieldSpell") {
    if (player.fieldSpell) player.graveyard.push(player.fieldSpell);
    player.fieldSpell = card;
  } else {
    player[zone] = player[zone] || [];
    player[zone].push(card);
  }
  return true;
}

function applyDarknessValleyBuffToCard(card, player = null) {
  if (player && player.fieldSpell?.name !== SH.valley) return;
  if (!card || card.cardKind !== "monster" || card.isFacedown) return;
  if (!isShadowHeart(card)) return;
  if (card._simDarknessValleyBuff) return;
  card.tempAtkBoost = (card.tempAtkBoost || 0) + 300;
  card._simDarknessValleyBuff = true;
}

function applyDarknessValleyBuffs(player) {
  if (player?.fieldSpell?.name !== SH.valley) return;
  (player.field || []).forEach((card) =>
    applyDarknessValleyBuffToCard(card, player)
  );
}

function defaultPlaceSpellCard(state, card) {
  const player = ensureZones(state.bot || {});
  if (card.subtype === "field") {
    if (player.fieldSpell) player.graveyard.push(player.fieldSpell);
    player.fieldSpell = card;
    return { placed: true, zone: "fieldSpell" };
  }
  if (card.subtype === "continuous" || card.subtype === "equip") {
    player.spellTrap.push(card);
    return { placed: true, zone: "spellTrap" };
  }
  return { placed: false, zone: null };
}

function placeShadowHeartSpellCard(state, card, options = {}) {
  const placeSpellCard = options.placeSpellCard || defaultPlaceSpellCard;
  const result = placeSpellCard(state, card);
  if (card?.name === SH.valley) {
    applyDarknessValleyBuffs(state.bot);
  }
  return result;
}

function buildActionFilter(action = {}) {
  return {
    ...(action.filters || {}),
    cardKind: action.cardKind ?? action.filters?.cardKind,
    archetype: action.archetype ?? action.filters?.archetype,
    archetypes: action.archetypes ?? action.filters?.archetypes,
    cardName: action.cardName ?? action.name ?? action.filters?.cardName,
    name: action.name ?? action.filters?.name,
    minLevel: action.minLevel ?? action.filters?.minLevel,
    maxLevel: action.maxLevel ?? action.filters?.maxLevel,
    minAtk: action.minAtk ?? action.filters?.minAtk,
    maxAtk: action.maxAtk ?? action.filters?.maxAtk,
    subtype: action.subtype ?? action.filters?.subtype,
  };
}

function rankSearchCandidates(candidates, action, state, sourceCard, options = {}) {
  const player = ensureZones(state.bot || {});
  const opponent = ensureZones(state.player || {});
  const ranker =
    options.rankSearchCandidates ||
    options.strategy?.rankSearchCandidates?.bind(options.strategy) ||
    rankShadowHeartSearchCandidates;
  const ranked = ranker(candidates, action, {
    game: state,
    player,
    opponent,
    source: sourceCard,
  });
  return Array.isArray(ranked) && ranked.length > 0 ? ranked : candidates;
}

function searchDeck(state, action, sourceCard, options = {}) {
  const player = ensureZones(state.bot || {});
  const filter = buildActionFilter(action);
  const candidates = player.deck.filter((card) => cardMatchesFilter(card, filter));
  if (candidates.length === 0) return null;
  const chosen = rankSearchCandidates(candidates, action, state, sourceCard, options)[0];
  if (!chosen) return null;
  removeFromZone(player.deck, chosen);
  player.hand.push(chosen);
  return chosen;
}

function findEffect(card, timings = []) {
  const effects = Array.isArray(card?.effects) ? card.effects : [];
  return effects.find(
    (effect) =>
      effect &&
      (timings.length === 0 || timings.includes(effect.timing)),
  );
}

function buildActivationContext(state, sourceCard, effect, options = {}) {
  if (!sourceCard) return null;
  if (typeof options.buildActivationContextForEffect === "function") {
    const built = options.buildActivationContextForEffect({
      sourceCard,
      effect,
      player: state.bot,
      game: state,
    });
    if (built) return built;
  }
  if (typeof options.strategy?.buildActivationContextForEffect === "function") {
    const built = options.strategy.buildActivationContextForEffect({
      sourceCard,
      effect,
      player: state.bot,
      game: state,
    });
    if (built) return built;
  }

  const preferences = buildShadowHeartTargetPreferences(
    sourceCard,
    effect,
    buildSimAnalysis(state),
  );
  return {
    autoSelectTargets: true,
    autoSelectSingleTarget: true,
    logTargets: false,
    actionContext: {
      costPreferences: buildShadowHeartCostPreferences(buildSimAnalysis(state)),
      targetPreferences: preferences.targetPreferences || {},
      specialSummonPositions: preferences.specialSummonPositions || {},
    },
  };
}

function getSourceCardForAction(state, action) {
  const player = ensureZones(state.bot || {});
  if (action.type === "spell") {
    const index = resolveSimulatedHandIndex(player, action, "spell");
    return player.hand[index] || null;
  }
  if (action.type === "handIgnition") {
    const index = resolveSimulatedHandIndex(player, action, "monster");
    return player.hand[index] || null;
  }
  if (action.type === "spellTrapEffect") {
    const index = Number.isInteger(action.zoneIndex) ? action.zoneIndex : action.index;
    return player.spellTrap?.[index] || null;
  }
  if (action.type === "fieldEffect") return player.fieldSpell || null;
  if (action.type === "monsterEffect") {
    return player.field?.[action.fieldIndex] || null;
  }
  return null;
}

function prepareAction(state, action, options = {}) {
  const prepared = { ...action };
  const sourceCard = getSourceCardForAction(state, action);
  const effect = sourceCard
    ? findEffect(sourceCard, action.type === "handIgnition" ? ["ignition"] : [])
    : null;
  if (!prepared.activationContext && sourceCard) {
    const activationContext = buildActivationContext(
      state,
      sourceCard,
      effect,
      options,
    );
    if (activationContext) prepared.activationContext = activationContext;
  }
  if (sourceCard?.name === "Polymerization" && !prepared.fusionTargetHint) {
    const fusionPlan = evaluateShadowHeartFusionPlan(buildSimAnalysis(state));
    if (fusionPlan?.targetName) prepared.fusionTargetHint = fusionPlan.targetName;
  }
  return prepared;
}

function chooseSpecialSummonPosition(card, action, state, options = {}) {
  if (action.position && action.position !== "choice") return action.position;
  const chooser =
    options.chooseSpecialSummonPosition ||
    options.strategy?.chooseSpecialSummonPosition?.bind(options.strategy);
  if (typeof chooser === "function") {
    const choice = chooser(card, {
      game: state,
      player: state.bot,
      opponent: state.player,
      source: action.sourceCard || null,
      action,
      activationContext: action.activationContext,
    });
    if (choice === "attack" || choice === "defense") return choice;
  }
  return "attack";
}

function applySummonState(card, action, state, options = {}) {
  card.position = chooseSpecialSummonPosition(card, action, state, options);
  card.isFacedown = action.facedown || false;
  card.hasAttacked = false;
  card.attacksUsedThisTurn = 0;
  if (action.cannotAttackThisTurn) card.cannotAttackThisTurn = true;
  else card.cannotAttackThisTurn = false;
}

function destroyBestOpponentCard(state) {
  const opponent = ensureZones(state.player || {});
  const candidates = [
    ...(opponent.field || []),
    opponent.fieldSpell,
    ...(opponent.spellTrap || []),
  ].filter(Boolean);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aMonster = a.cardKind === "monster" ? 1 : 0;
    const bMonster = b.cardKind === "monster" ? 1 : 0;
    if (aMonster !== bMonster) return bMonster - aMonster;
    return (b.atk || 0) - (a.atk || 0);
  });
  const target = candidates[0];
  moveToZone(opponent, target, "graveyard");
  return target;
}

function handleAfterSummon({ state, player, card, method, action, options = {} }) {
  if (!card || card.isFacedown) return;
  applyDarknessValleyBuffToCard(card, player);

  if (
    card.name === SH.arctroth &&
    method === "tribute" &&
    (state.player?.field || []).length > 0
  ) {
    const target = (state.player.field || [])
      .filter((candidate) => candidate?.cardKind === "monster")
      .slice()
      .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
    if (target) {
      moveToZone(state.player, target, "graveyard");
      card.destroyedOpponentMonstersByEffect =
        (card.destroyedOpponentMonstersByEffect || 0) + 1;
    }
  }

  if (card.name === SH.voidMage && method === "normal") {
    searchDeck(
      state,
      {
        type: "search_any",
        sourceName: SH.voidMage,
        archetype: "Shadow-Heart",
        cardKind: ["spell", "trap"],
      },
      card,
      options,
    );
  }

  if (
    card.name === SH.imp &&
    method === "normal" &&
    canUseSimOpt(state, "shadow_heart_imp_on_summon")
  ) {
    const analysis = buildSimAnalysis(state);
    const candidates = (player.hand || []).filter(
      (candidate) =>
        candidate &&
        candidate.cardKind === "monster" &&
        isShadowHeart(candidate) &&
        (candidate.level || 0) <= 4 &&
        candidate.name !== SH.imp,
    );
    const plan = chooseImpSpecialTargetName(analysis, candidates);
    const chosen =
      candidates.find((candidate) => candidate.name === plan.name) ||
      candidates[0] ||
      null;
    if (chosen && (player.field || []).length < 5) {
      removeFromZone(player.hand, chosen);
      applySummonState(
        chosen,
        {
          ...action,
          position: plan.name === SH.gecko || plan.name === "Shadow-Heart Abyssal Eel"
            ? "attack"
            : "choice",
        },
        state,
        options,
      );
      chosen.lastSummonMethod = "special";
      chosen.lastSummonedFromZone = "hand";
      chosen.sourceCard = SH.imp;
      player.field.push(chosen);
      markSimOpt(state, "shadow_heart_imp_on_summon");
      handleAfterSummon({
        state,
        player,
        card: chosen,
        method: "special",
        action,
        options,
      });
    }
  }

  if (
    card.name === SH.gecko &&
    method === "special" &&
    canUseSimOpt(state, "shadow_heart_gecko_special_search")
  ) {
    const chosen = searchDeck(
      state,
      {
        type: "search_any",
        sourceName: SH.gecko,
        archetype: "Shadow-Heart",
        cardKind: "monster",
        minLevel: 8,
        maxLevel: 8,
      },
      card,
      options,
    );
    if (chosen) markSimOpt(state, "shadow_heart_gecko_special_search");
  }
}

function simulateNormalSummon(state, action, options = {}) {
  const player = ensureZones(state.bot || {});
  const handIndex = resolveSimulatedHandIndex(player, action, "monster");
  const card = player.hand[handIndex];
  if (!card) return true;

  const tributeInfo = getTributeRequirementFor(card, player);
  const tributesNeeded = tributeInfo.tributesNeeded || 0;
  if (!fieldHasTributeValue(player.field || [], tributesNeeded, card)) {
    return true;
  }

  const tributeIndices =
    tributesNeeded > 0
      ? selectBestTributes(player.field, tributesNeeded, card, {
          botState: player,
          oppField: state.player?.field || [],
          game: state,
        })
      : [];
  const tributeCards = getTributeCardsFromIndices(
    player.field || [],
    tributeIndices,
  );
  if (getTributeValueTotal(tributeCards, card) < tributesNeeded) return true;

  const tributes = [];
  tributeIndices
    .slice()
    .sort((a, b) => b - a)
    .forEach((idx) => {
      const tribute = player.field[idx];
      if (!tribute) return;
      tributes.push(tribute);
      player.field.splice(idx, 1);
      player.graveyard.push(tribute);
    });

  player.hand.splice(handIndex, 1);
  const summoned = { ...card };
  summoned.position = action.position || "attack";
  summoned.isFacedown = action.facedown || false;
  summoned.hasAttacked = false;
  summoned.attacksUsedThisTurn = 0;
  summoned.cannotAttackThisTurn = action.cannotAttackThisTurn === true;
  summoned.lastSummonMethod = tributesNeeded > 0 ? "tribute" : "normal";
  summoned.lastSummonedFromZone = "hand";
  summoned.lastTributeMaterialNames = tributes.map((tribute) => tribute.name);
  summoned.lastTributeMaterialCount = tributes.length;
  player.field.push(summoned);
  player.summonCount = (player.summonCount || 0) + 1;

  handleAfterSummon({
    state,
    player,
    card: summoned,
    method: summoned.lastSummonMethod,
    action,
    options,
  });
  return true;
}

function simulateCathedralEffect(state, action, options = {}) {
  const player = ensureZones(state.bot || {});
  const zoneIndex = Number.isInteger(action.zoneIndex) ? action.zoneIndex : action.index;
  const card = player.spellTrap?.[zoneIndex];
  if (!card || card.name !== SH.cathedral) return false;
  if (card.isFacedown) return true;
  if ((player.field || []).length >= 5) return true;

  const counterCount = action.cathedralPlan?.counterCount || getCounterCount(card);
  if (counterCount <= 0) return true;
  const maxAtk = counterCount * 500;
  const candidates = player.deck.filter(
    (candidate) =>
      candidate &&
      candidate.cardKind === "monster" &&
      isShadowHeart(candidate) &&
      (candidate.atk || 0) <= maxAtk,
  );
  const targetName = action.cathedralPlan?.targetName || null;
  const chosen =
    candidates.find((candidate) => candidate.name === targetName) ||
    chooseCathedralSummonTarget(candidates, buildSimAnalysis(state)).card;
  if (!chosen) return true;

  removeFromZone(player.deck, chosen);
  applySummonState(chosen, { ...action, position: "attack" }, state, options);
  chosen.lastSummonMethod = "special";
  chosen.lastSummonedFromZone = "deck";
  chosen.sourceCard = SH.cathedral;
  player.field.push(chosen);

  player.spellTrap.splice(zoneIndex, 1);
  player.graveyard.push(card);

  handleAfterSummon({
    state,
    player,
    card: chosen,
    method: "special",
    action,
    options,
  });
  return true;
}

function handleEffectActivated({ state, card }) {
  const player = ensureZones(state.bot || {});
  if (card?.name === SH.rage) {
    const rageTarget = (player.field || [])
      .filter(isShadowHeartDragon)
      .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
    if (rageTarget) {
      rageTarget.tempAtkBoost = (rageTarget.tempAtkBoost || 0) + 700;
      rageTarget.tempDefBoost = (rageTarget.tempDefBoost || 0) + 700;
      rageTarget.canMakeSecondAttackThisTurn = true;
      rageTarget.secondAttackUsedThisTurn = false;
      player.forbidDirectAttacksThisTurn = true;
    }
  }
}

function buildGenericOptions(state, action, baseOptions = {}) {
  const options = {
    ...baseOptions,
    guardLabel: "ShadowHeartSimulation",
    strategy: baseOptions.strategy,
    getTributeRequirementFor,
    selectBestTributes,
    rankSearchCandidates: baseOptions.rankSearchCandidates || rankShadowHeartSearchCandidates,
    evaluateRecruitCandidate:
      baseOptions.evaluateRecruitCandidate || evaluateShadowHeartRecruitCandidate,
    chooseSpecialSummonPosition: baseOptions.chooseSpecialSummonPosition,
    placeSpellCard: (simState, card) =>
      placeShadowHeartSpellCard(simState, card, baseOptions),
    actionOverrides: {
      summon: ({ state: simState, action: simAction, options: simOptions }) =>
        simulateNormalSummon(simState, simAction, simOptions),
      spellTrapEffect: ({ state: simState, action: simAction, options: simOptions }) =>
        simulateCathedralEffect(simState, simAction, simOptions),
      fieldEffect: ({ state: simState }) => {
        if (simState.bot?.fieldSpell?.name !== SH.valley) return false;
        applyDarknessValleyBuffs(simState.bot);
        return true;
      },
    },
    onAfterSpecialSummon: ({ state: simState, player, card, action: simAction }) => {
      handleAfterSummon({
        state: simState,
        player,
        card,
        method: "special",
        action: simAction,
        options,
      });
    },
    onFusionSummon: ({ state: simState, fusionCard }) => {
      applyDarknessValleyBuffToCard(fusionCard, simState.bot);
      if (fusionCard?.name === SH.demonDragon) {
        destroyBestOpponentCard(simState);
      }
    },
    onEffectActivated: (ctx) => handleEffectActivated(ctx),
  };

  if (!options.chooseSpecialSummonPosition && options.strategy?.chooseSpecialSummonPosition) {
    options.chooseSpecialSummonPosition =
      options.strategy.chooseSpecialSummonPosition.bind(options.strategy);
  }

  return options;
}

export function simulateMainPhaseAction(state, action, placeSpellCardOrOptions = null) {
  if (!action) return state;
  ensureZones(state.bot || {});
  ensureZones(state.player || {});
  const baseOptions = normalizeOptions(placeSpellCardOrOptions);
  const preparedAction = prepareAction(state, action, baseOptions);
  const options = buildGenericOptions(state, preparedAction, baseOptions);
  applyGenericSimulatedMainPhaseAction(state, preparedAction, options);
  return state;
}

export function simulateSpellEffect(state, card, placeSpellCardOrOptions = null) {
  if (!card) return state;
  ensureZones(state.bot || {});
  ensureZones(state.player || {});
  const baseOptions = normalizeOptions(placeSpellCardOrOptions);
  const effect = findEffect(card, ["on_play"]);
  const activationContext = buildActivationContext(state, card, effect, baseOptions);
  const options = buildGenericOptions(state, { type: "spell", cardName: card.name }, {
    ...baseOptions,
    activationContext,
  });
  simulateGenericSpellEffect(state, card, {
    ...options,
    sourceCard: card,
    activationContext,
  });
  handleEffectActivated({ state, card });
  return state;
}
