// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/DragonStrategy.js
// Dragon deck AI strategy — orchestrates dragon/* modules.
//
// DRAGON DECK PHILOSOPHY:
// - Mid-range Dragon beatdown with powerful singletons
// - Early game: Armored Dragon search, Luminescent revive, field presence
// - Mid game: Jagged Peak counters, Hellkite recursion, Boneflame GY pump
// - Late game: Radiant/Tech fusion, Awakening bosses, and GY resource loops
// - Key constraint: Only 1 face-up Extreme Dragon on field at a time
// - Key constraint: Extreme Dragons in GY are useful resources, not an automatic win plan
// ─────────────────────────────────────────────────────────────────────────────

import BaseStrategy from "./BaseStrategy.js";
import {
  applyMacroAndSafety,
  buildPrioritizedAction,
} from "./common/actionGeneration.js";
import { getGenericSetBackrowActions } from "./common/backrowPlanning.js";
import { sequenceActionsByPriority } from "./common/actionSequencing.js";
import {
  findIgnitionEffect,
  findIgnitionEffects,
  hasOncePerTurnEffect,
} from "./common/effectDiscovery.js";
import { effectTargetsAvailable } from "./common/targetAvailability.js";
import {
  canActivateFieldSpellEffect,
  canActivateMonsterEffect,
  canActivateSpellFromHand,
  canActivateSpellTrapEffect,
  checkOncePerTurnIfRealGame,
} from "./common/previewGuards.js";
import { buildAutoActivationContext } from "./common/preferencePolicy.js";
import {
  detectLethalOpportunity,
  detectDefensiveNeed,
  detectComeback,
  decideMacroStrategy,
  calculateMacroPriorityBonus,
} from "./MacroPlanning.js";
import {
  evaluateActionBlockingRisk,
  assessActionSafety,
} from "./ChainAwareness.js";

import {
  CARD_KNOWLEDGE,
  isExtremeDragon,
} from "./dragon/knowledge.js";
import { COMBO_DATABASE, detectAvailableCombos } from "./dragon/combos.js";
import {
  shouldPlaySpell,
  shouldSummonMonster,
  getTributeRequirementFor as dragonGetTributeRequirementFor,
  selectBestTributes,
  evaluateTributeTrade,
} from "./dragon/priorities.js";
import {
  assessDragonExtremeResourcePolicy,
  analyzeExtremeDragonEconomy,
  evaluateBoardDragon,
} from "./dragon/scoring.js";
import { analyzeDragonState } from "./dragon/stateAnalysis.js";
import { rankDragonSearchCandidates } from "./dragon/searchPolicy.js";
import {
  buildDragonCostPreferences,
  buildDragonTargetCostPreferences,
} from "./dragon/costPolicy.js";
import {
  buildDragonBanishTargetPreferences,
  shouldUsePurifiedBanishSummon,
  shouldUseStelyaBanishSummon,
} from "./dragon/banishPolicy.js";
import {
  evaluateDragonGraveyardIgnition,
  evaluateDragonHandIgnition,
  evaluateDragonRecruitCandidate,
} from "./dragon/actionPolicy.js";
import {
  DRAGON_BOSS_POLICY_NAMES,
  buildDragonBossPreferenceMap,
  buildDragonBossTargetPreference,
  rankDragonBossCandidates,
  selectBestDragonBoss,
} from "./dragon/bossPolicy.js";
import {
  buildDragonExtraDeckActionContext,
  chooseDragonAscensionPosition,
  selectDragonAscensionChoice,
  selectDragonFusionPlan,
} from "./dragon/extraDeckPolicy.js";
import { getEffectiveAtk } from "./common/cardStats.js";
import {
  getProjectedBoneflameAtk,
  getValidBoneflameCostCandidates,
} from "./dragon/boneflamePolicy.js";
import { simulateMainPhaseAction as simulateDragonAction } from "./dragon/simulation.js";
import {
  applyDragonSimulatedBattleRewards,
  applyDragonRetentionPriorities,
  buildDragonPlanningProfile,
  describeDragonPlannedLine,
  scoreDragonBattleAttackCandidate,
  scoreDragonLineMilestones,
  scoreDragonLineTerminal,
} from "./dragon/linePlanning.js";

const DRAGON_COST_PREFER_NAMES = [
  "Solar Eclipse Dragon",
  "Voltaic Dragon",
  "Stelya, Dragon Tamer",
  "Lunar Eclipse Dragon",
  "Grey Dragon",
  "Luminescent Dragon",
  "Armored Dragon",
];

const DRAGON_COST_PRESERVE_NAMES = [
  "Fire Extreme Dragon",
  "Volcanic Extreme Dragon",
  "Luminous Dragon",
  "Black Bull Dragon",
  "Purified Crystal Dragon",
  "Hellkite Dragon",
  "Majestic Silver Dragon",
  "Polymerization",
  "Extreme Dragon Awakening",
  "Jagged Peak of the Dragons",
  "Dragon Spirit Sanctuary",
  "Call of the Haunted",
];

const AWAKENING_TARGET_ORDER = [...DRAGON_BOSS_POLICY_NAMES];

const EXTREME_GY_SEND_ORDER = [
  "Volcanic Extreme Dragon",
  "Fire Extreme Dragon",
];

function uniqueNames(names = []) {
  return [...new Set((names || []).filter(Boolean))];
}

function mergePreferenceArrays(...arrays) {
  return [
    ...new Set(
      arrays
        .flatMap((value) => value || [])
        .filter((value) => value !== undefined && value !== null && value !== ""),
    ),
  ];
}

function mergeCostPreferences(base = {}, patch = {}) {
  return {
    ...(base || {}),
    ...(patch || {}),
    preferNames: mergePreferenceArrays(base.preferNames, patch.preferNames),
    forceNames: mergePreferenceArrays(base.forceNames, patch.forceNames),
    preserveNames: mergePreferenceArrays(base.preserveNames, patch.preserveNames),
    avoidNames: mergePreferenceArrays(base.avoidNames, patch.avoidNames),
    preferredInstanceIds: mergePreferenceArrays(
      base.preferredInstanceIds,
      patch.preferredInstanceIds,
    ),
    avoidInstanceIds: mergePreferenceArrays(
      base.avoidInstanceIds,
      patch.avoidInstanceIds,
    ),
    offensivePayoffNames: mergePreferenceArrays(
      base.offensivePayoffNames,
      patch.offensivePayoffNames,
    ),
  };
}

function mergeTargetPreference(base = {}, patch = {}) {
  return {
    ...(base || {}),
    ...(patch || {}),
    preferNames: mergePreferenceArrays(base.preferNames, patch.preferNames),
    preferredNames: mergePreferenceArrays(
      base.preferredNames,
      patch.preferredNames,
    ),
    forceNames: mergePreferenceArrays(base.forceNames, patch.forceNames),
    preserveNames: mergePreferenceArrays(base.preserveNames, patch.preserveNames),
    avoidNames: mergePreferenceArrays(base.avoidNames, patch.avoidNames),
    preferredInstanceIds: mergePreferenceArrays(
      base.preferredInstanceIds,
      patch.preferredInstanceIds,
    ),
    avoidInstanceIds: mergePreferenceArrays(
      base.avoidInstanceIds,
      patch.avoidInstanceIds,
    ),
  };
}

function mergeTargetPreferenceMaps(base = {}, patch = {}) {
  const merged = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    merged[key] = mergeTargetPreference(merged[key] || {}, value || {});
  }
  return merged;
}

function isDragonMonster(card) {
  return card?.cardKind === "monster" && card.type === "Dragon";
}

function isFaceupDragon(card) {
  return isDragonMonster(card) && !card.isFacedown;
}

function cardArchetypes(card) {
  if (!card) return [];
  if (Array.isArray(card.archetypes)) return card.archetypes;
  return card.archetype ? [card.archetype] : [];
}

function hasArchetype(card, archetype) {
  return cardArchetypes(card).includes(archetype);
}

function cardStrategicValue(card) {
  if (!card) return 0;
  const knowledge = CARD_KNOWLEDGE[card.name] || {};
  let score = knowledge.value || knowledge.priority || 0;
  score += (card.level || 0) * 0.25;
  score += Math.max(card.atk || 0, card.def || 0) / 1000;
  if (isExtremeDragon(card)) score += 4;
  if (card.monsterType === "fusion" || card.monsterType === "ascension") {
    score += 5;
  }
  return score;
}

function threatScore(card) {
  if (!card) return 0;
  let score = Math.max(card.atk || 0, card.def || 0) / 500;
  score += (card.level || 0) * 0.35;
  if (card.monsterType === "fusion" || card.monsterType === "ascension") {
    score += 5;
  }
  if ((card.effects || []).length > 0) score += 1;
  return score;
}

function rankCardsByThreat(cards = []) {
  return (cards || [])
    .filter((card) => card && card.cardKind === "monster")
    .slice()
    .sort((a, b) => threatScore(b) - threatScore(a));
}

function rankOwnDragonsByValue(cards = []) {
  return (cards || [])
    .filter(isFaceupDragon)
    .slice()
    .sort((a, b) => cardStrategicValue(b) - cardStrategicValue(a));
}

function countCards(cards = [], predicate = () => true) {
  return (cards || []).filter((card) => card && predicate(card)).length;
}

function hasNamedCard(cards = [], name) {
  return (cards || []).some((card) => card?.name === name);
}

function getCardInstanceId(card) {
  return (
    card?.instanceId ??
    card?._instanceId ??
    card?.uuid ??
    card?.simInstanceId ??
    null
  );
}

function buildDragonActionContext(extra = {}) {
  const dynamicCostPreferences = buildDragonCostPreferences(extra);
  let costPreferences = mergeCostPreferences(
    dynamicCostPreferences,
    extra.costPreferences || {},
  );
  const extraDeckContext = buildDragonExtraDeckActionContext({
    ...extra,
    costPreferences,
  });
  costPreferences = mergeCostPreferences(
    costPreferences,
    extraDeckContext.costPreferences || {},
  );
  const baseTargetPreferences = mergeTargetPreferenceMaps(
    mergeTargetPreferenceMaps(
      buildDragonTargetCostPreferences({
        ...extra,
        costPreferences,
      }),
      buildDragonBanishTargetPreferences({
        ...extra,
        costPreferences,
      }),
    ),
    buildDragonBossPreferenceMap({
      ...extra,
      costPreferences,
    }),
  );
  const targetPreferences = mergeTargetPreferenceMaps(
    mergeTargetPreferenceMaps(
      baseTargetPreferences,
      extraDeckContext.targetPreferences || {},
    ),
    extra.targetPreferences || {},
  );

  return {
    costPreferences,
    targetPreferences,
    ...(extraDeckContext.fusionPreferences
      ? { fusionPreferences: extraDeckContext.fusionPreferences }
      : {}),
    ...(extraDeckContext.fusionPositions
      ? { fusionPositions: extraDeckContext.fusionPositions }
      : {}),
    ...(extraDeckContext.dragonExtraDeckPlan
      ? { dragonExtraDeckPlan: extraDeckContext.dragonExtraDeckPlan }
      : {}),
    ...(extra.other || {}),
  };
}

function buildActivationContext(zone, actionContext = null, extra = {}) {
  return buildAutoActivationContext({
    zone,
    fromHand: zone === "hand",
    actionContext: actionContext || {},
    includeActionContext: !!actionContext,
    extra,
  });
}

function hasLuminousFollowUp(bot) {
  const names = new Set((bot.hand || []).map((card) => card?.name));
  return [
    "Solar Eclipse Dragon",
    "Lunar Eclipse Dragon",
    "Stelya, Dragon Tamer",
    "Voltaic Dragon",
    "Black Bull Dragon",
    "Hellkite Dragon",
    "Polymerization",
    "Extreme Dragon Awakening",
    "Jagged Peak of the Dragons",
  ].some((name) => names.has(name));
}

function hasRainbowGyFollowUp(bot) {
  if (hasNamedCard(bot.hand, "Call of the Haunted")) return true;
  if (hasNamedCard(bot.spellTrap, "Call of the Haunted")) return true;
  if ((bot.field || []).some((card) => card?.name === "Luminous Dragon" && !card.isFacedown)) {
    return true;
  }
  const hasFieldDragon = (bot.field || []).some(isFaceupDragon);
  const hasEclipseRevive =
    hasNamedCard(bot.graveyard, "Solar Eclipse Dragon") ||
    hasNamedCard(bot.graveyard, "Lunar Eclipse Dragon");
  const hasStelyaRevive =
    hasNamedCard(bot.graveyard, "Stelya, Dragon Tamer") && hasFieldDragon;
  if (hasEclipseRevive || hasStelyaRevive) return true;
  if (bot.fieldSpell?.name === "Jagged Peak of the Dragons") return true;
  return hasNamedCard(bot.hand, "Hellkite Dragon");
}

function getFieldDragonCostNames(bot, { preserveExtremes = true } = {}) {
  return (bot.field || [])
    .filter((card) => isFaceupDragon(card) && (!preserveExtremes || !isExtremeDragon(card)))
    .slice()
    .sort((a, b) => cardStrategicValue(a) - cardStrategicValue(b))
    .map((card) => card.name);
}

function getBestAwakeningTarget(bot, opponent, analysis) {
  const fieldDragons = (bot.field || []).filter(isFaceupDragon);
  const hasExtremeFaceup = fieldDragons.some(isExtremeDragon);
  const candidates = (bot.hand || []).filter(
    (card) =>
      isDragonMonster(card) &&
      (card.level || 0) >= 8 &&
      (!hasExtremeFaceup || !isExtremeDragon(card)),
  );
  if (candidates.length === 0) return null;

  return selectBestDragonBoss(candidates, {
    analysis,
    player: bot,
    bot,
    opponent,
    routeKind: "awakening",
    fieldCostCount: 2,
  });
}

function hasUsefulJaggedPeakSearch(bot) {
  if (bot.fieldSpell?.name === "Jagged Peak of the Dragons") return false;
  return (bot.deck || []).some((card) => card?.name === "Jagged Peak of the Dragons");
}

export default class DragonStrategy extends BaseStrategy {
  constructor(bot) {
    super(bot);
    this.cardKnowledge = CARD_KNOWLEDGE;
    this.knownCombos = COMBO_DATABASE;
    this.currentAnalysis = null;
    this.thoughtProcess = [];
  }

  simulateMainPhaseAction(state, action) {
    return simulateDragonAction(state, action);
  }

  rankSearchCandidates(cards, action, context = {}) {
    const game = context.game || null;
    const player = context.player || this.bot || game?.bot || {};
    const opponent =
      context.opponent ||
      (game && player ? this.getOpponent(game?._gameRef || game, player) : null) ||
      {};
    return rankDragonSearchCandidates(cards, action, {
      ...context,
      player,
      opponent,
      game,
      analysis: context.analysis || this.currentAnalysis,
      fallbackValue: cardStrategicValue,
    });
  }

  evaluateRecruitCandidate(candidates, context = {}) {
    const game = context.game || null;
    const player = context.player || this.bot || game?.bot || {};
    const opponent =
      context.opponent ||
      (game && player ? this.getOpponent(game?._gameRef || game, player) : null) ||
      {};
    return evaluateDragonRecruitCandidate(candidates, {
      ...context,
      player,
      opponent,
      game,
      analysis: context.analysis || this.currentAnalysis,
      fallbackValue: cardStrategicValue,
    });
  }

  buildActivationContextForEffect({
    sourceCard,
    effect,
    player,
    game,
    activationZone,
  } = {}) {
    const owner = player || this.bot || game?.bot || {};
    const opponent =
      game && owner ? this.getOpponent(game?._gameRef || game, owner) || {} : {};
    const zone = activationZone || "field";
    const actionContext = buildDragonActionContext({
      analysis: this.currentAnalysis,
      player: owner,
      bot: owner,
      opponent,
      game,
      source: sourceCard,
      sourceCard,
      effect,
    });
    return buildActivationContext(zone, actionContext, {
      logTargets: false,
    });
  }

  getPlanningProfile(game, context = {}) {
    if (!game) return super.getPlanningProfile(game, context);
    const analysis = context.analysis || this.analyzeGameState(game);
    return buildDragonPlanningProfile(analysis, {
      ...context,
      game,
      bot: context.bot || this.bot || game.bot,
    });
  }

  shouldUseDeepPlanning(game, context = {}) {
    const profile =
      context.profile || this.getPlanningProfile(game, context) || {};
    return game?.turnLineSearchEnabled === true || profile.enabled === true;
  }

  scoreLineMilestones(context = {}) {
    return scoreDragonLineMilestones(context);
  }

  scoreLineTerminal(context = {}) {
    return scoreDragonLineTerminal(context);
  }

  describePlannedLine(context = {}) {
    return describeDragonPlannedLine(context);
  }

  scoreBattleAttackCandidate(context = {}) {
    return scoreDragonBattleAttackCandidate(context);
  }

  applySimulatedBattleRewards(context = {}) {
    return applyDragonSimulatedBattleRewards(context);
  }

  sequenceActions(actions = []) {
    return sequenceActionsByPriority(actions);
  }

  selectAutomaticAscension({ choices = [], game, bot = this.bot, opponent } = {}) {
    const selected = selectDragonAscensionChoice(choices, {
      game,
      player: bot,
      bot,
      opponent,
      analysis: this.currentAnalysis,
    });
    if (!selected) return { skip: true };
    return {
      material: selected.material,
      ascensionCard: selected.ascensionCard,
      position: selected.position,
    };
  }

  chooseAutomaticAscensionPosition({
    ascensionCard,
    material,
    game,
    bot = this.bot,
    opponent,
  } = {}) {
    return chooseDragonAscensionPosition({
      ascensionCard,
      material,
      game,
      bot,
      opponent,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Board evaluation
  // ─────────────────────────────────────────────────────────────────────────

  evaluateBoard(gameOrState, perspectivePlayer) {
    return evaluateBoardDragon(
      gameOrState,
      perspectivePlayer,
      this.getOpponent.bind(this),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tribute override — Dragon altTribute logic
  // ─────────────────────────────────────────────────────────────────────────

  getTributeRequirementFor(card, playerState) {
    return dragonGetTributeRequirementFor(card, playerState);
  }

  selectBestTributes(field, tributesNeeded, cardToSummon, context = {}) {
    return selectBestTributes(field, tributesNeeded, cardToSummon, context);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Logging
  // ─────────────────────────────────────────────────────────────────────────

  think(thought) {
    this.thoughtProcess.push(thought);
    if (!this.bot?.debug) return;
    console.log(`[Dragon AI] ${thought}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Game state analysis
  // ─────────────────────────────────────────────────────────────────────────

  analyzeGameState(game) {
    this.thoughtProcess = [];

    const isSimulatedState = game._isPerspectiveState === true;
    const bot = isSimulatedState ? game.bot : this.bot || game.bot;
    const opponent = this.getOpponent(game, bot);

    const gyCards = bot.graveyard || [];
    const extremeDragonEconomy = analyzeExtremeDragonEconomy({ graveyard: gyCards });
    const extremeInGY = extremeDragonEconomy.extremeInGY;
    const dragonState = analyzeDragonState({
      game: isSimulatedState ? game._gameRef || game : game,
      bot,
      opponent,
      isSimulatedState,
    });

    const analysis = {
      hand: (bot.hand || []).map((c) => ({
        name: c.name,
        cardKind: c.cardKind,
        type: c.type,
        attribute: c.attribute,
        level: c.level,
        atk: c.atk,
        def: c.def,
        archetype: c.archetype,
        archetypes: c.archetypes,
      })),
      field: (bot.field || []).map((c) => ({
        name: c.name,
        atk: c.atk,
        def: c.def,
        level: c.level,
        cardKind: c.cardKind,
        type: c.type,
        attribute: c.attribute,
        position: c.position,
        isFacedown: c.isFacedown,
        hasAttacked: c.hasAttacked,
        battleIndestructible: c.battleIndestructible,
        cannotBeDestroyedByBattle: c.cannotBeDestroyedByBattle,
        archetype: c.archetype,
      })),
      graveyard: gyCards,
      fieldSpell: bot.fieldSpell || null,
      spellTrap: (bot.spellTrap || []).map((c) => ({
        name: c.name,
        cardKind: c.cardKind,
        isFacedown: c.isFacedown,
      })),
      lp: bot.lp,
      summonCount: bot.summonCount || 0,
      phase: game.phase || "main1",
      turnCounter: game.turnCounter || 0,

      oppField: (opponent?.field || []).map((c) => ({
        name: c.name,
        atk: c.atk,
        def: c.def,
        level: c.level,
        cardKind: c.cardKind,
        position: c.position,
        isFacedown: c.isFacedown,
        battleIndestructible: c.battleIndestructible,
        cannotBeDestroyedByBattle: c.cannotBeDestroyedByBattle,
      })),
      oppBackrow: opponent?.spellTrap?.length || 0,
      oppHand: opponent?.hand?.length || 0,
      oppLp: opponent?.lp || 0,
      lpRatio: opponent?.lp ? bot.lp / opponent.lp : 1,

      canNormalSummon: (bot.summonCount || 0) < 1,
      fieldCapacity: 5 - (bot.field?.length || 0),

      // Dragon-specific
      extremeInGY,
      extremeDragonEconomy,
      extremeResourcePolicy: assessDragonExtremeResourcePolicy({ extremeDragonEconomy }),
      hasJaggedPeak: bot.fieldSpell?.name === "Jagged Peak of the Dragons",
      jaggedPeakCounters: bot.fieldSpell?.counters?.dragon_peak || 0,
      dragonState,
      hasSolarInHand: dragonState.hasSolarInHand,
      hasSolarInGY: dragonState.hasSolarInGY,
      hasLunarInHand: dragonState.hasLunarInHand,
      hasLunarInDeck: dragonState.hasLunarInDeck,
      hasLunarInGY: dragonState.hasLunarInGY,
      hasStelyaInHand: dragonState.hasStelyaInHand,
      hasStelyaInDeck: dragonState.hasStelyaInDeck,
      hasStelyaInGY: dragonState.hasStelyaInGY,
      hasUsefulLunarDiscard: dragonState.hasUsefulLunarDiscard,
      hasDragonFieldBodyForStelya: dragonState.hasDragonFieldBodyForStelya,
      hasTwoDragonsForAwakening: dragonState.hasTwoDragonsForAwakening,
      hasLevel7PlusForRoar: dragonState.hasLevel7PlusForRoar,
      hasVoltaicForTechVoid: dragonState.hasVoltaicForTechVoid,
      hasLuminousForRadiant: dragonState.hasLuminousForRadiant,
      hasThreeSafeGYDragonsForPurified: dragonState.hasThreeSafeGYDragonsForPurified,
      hasExtremeDragonFaceup: dragonState.hasExtremeDragonFaceup,

      availableCombos: [],
    };

    this.think(`📊 Dragon AI: ${bot.lp} LP vs ${opponent?.lp} LP`);
    this.think(`🃏 Hand: ${analysis.hand.map((c) => c.name).join(", ") || "empty"}`);
    this.think(`⚔️ Field: ${analysis.field.map((c) => c.name).join(", ") || "empty"}`);
    this.think(`☠️ GY Extreme Dragons: ${extremeInGY} resource(s)`);

    analysis.availableCombos = detectAvailableCombos(analysis, (msg) => this.think(msg));

    this.currentAnalysis = analysis;
    return analysis;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Macro planning
  // ─────────────────────────────────────────────────────────────────────────

  evaluateMacroStrategy(game, analysis) {
    const isSimulatedState = game?._isPerspectiveState === true;
    const actualGame = game._gameRef || game;
    const bot = isSimulatedState ? game.bot : this.bot || game.bot;
    const opponent = this.getOpponent(isSimulatedState ? game : actualGame, bot);

    const lethal = detectLethalOpportunity({ bot, player: opponent, field: {} }, bot, opponent, 2);
    const defensive = detectDefensiveNeed({ bot, player: opponent }, bot, opponent);
    const comeback = detectComeback({ bot, player: opponent }, bot, opponent);
    const macro = decideMacroStrategy({ bot, player: opponent }, bot, opponent);

    return macro;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Main phase action generation
  // ─────────────────────────────────────────────────────────────────────────

  generateMainPhaseActions(game) {
    const analysis = this.analyzeGameState(game);
    const actions = [];

    const isSimulatedState = game._isPerspectiveState === true;
    const bot = isSimulatedState ? game.bot : this.bot || game.bot;
    const actualGame = game._gameRef || game;
    const opponent = this.getOpponent(isSimulatedState ? game : actualGame, bot);

    const shouldLog = !isSimulatedState;
    const log = (msg) => shouldLog && this.think(msg);

    log(`\n🧠 Dragon AI generating actions...`);

    // === MACRO PLANNING ===
    const macroStrategy = this.evaluateMacroStrategy(game, analysis);
    log(`  📊 Macro: ${macroStrategy.strategy}`);

    // === CHAIN AWARENESS ===
    const chainRisks = {
      spell: evaluateActionBlockingRisk({ bot, player: opponent }, bot, opponent, "spell"),
      summon: evaluateActionBlockingRisk({ bot, player: opponent }, bot, opponent, "summon"),
    };

    // === COMBO PRIORITIES ===
    for (const combo of analysis.availableCombos.sort((a, b) => b.priority - a.priority)) {
      log(`  📌 Combo available: ${combo.name} (priority ${combo.priority})`);
    }

    // === SPELL ACTIONS ===
    const addedSpellNames = new Set();

    (bot.hand || []).forEach((card, index) => {
      if (card.cardKind !== "spell" && card.cardKind !== "trap") return;

      // Traps are handled in the dedicated trap-set section below
      if (card.cardKind === "trap") return;
      const extraDeckPlan =
        card.name === "Polymerization"
          ? selectDragonFusionPlan({
              analysis,
              player: bot,
              bot,
              opponent,
              game: actualGame,
            })
          : null;
      if (card.name === "Polymerization" && !extraDeckPlan?.ok) {
        log(
          `  ⏭️ Polymerization held: ${
            extraDeckPlan?.reason || "no approved Extra Deck payoff"
          }`,
        );
        return;
      }
      const spellActivationContext = {
        autoSelectTargets: true,
        autoSelectSingleTarget: true,
        logTargets: false,
        actionContext: buildDragonActionContext({
          analysis,
          player: bot,
          bot,
          opponent,
          game: actualGame,
          source: card,
          sourceCard: card,
          extraDeckPlan,
        }),
      };

      const hasOncePerTurn = hasOncePerTurnEffect(card);
      if (hasOncePerTurn && addedSpellNames.has(card.name)) {
        log(`  ⏭️ Skipping duplicate 1/turn spell: ${card.name}`);
        return;
      }

      // Validate activatability in real game
      if (!isSimulatedState) {
        if (
          !canActivateSpellFromHand(
            actualGame,
            card,
            bot,
            spellActivationContext,
          )
        ) {
          return;
        }

        if (card.name === "Polymerization") {
          const canActivate = actualGame.canActivatePolymerization?.() ?? false;
          if (!canActivate) {
            log(`  ⚠️ Polymerization blocked: no valid fusion materials`);
            return;
          }
        }
      }

      const decision =
        card.name === "Polymerization" && extraDeckPlan?.ok
          ? {
              yes: true,
              priority: extraDeckPlan.priority,
              reason: extraDeckPlan.reason,
            }
          : shouldPlaySpell(card, analysis);

      if (decision.yes) {
        log(`  ✅ Spell: ${card.name} — ${decision.reason}`);

        if (hasOncePerTurn) addedSpellNames.add(card.name);

        const safety = assessActionSafety({ bot, player: opponent }, bot, opponent, "spell", card);
        const { priority: finalPriority, macroBuff, safetyScore } =
          applyMacroAndSafety({
            basePriority: decision.priority || 5,
            actionType: "spell",
            card,
            macroStrategy,
            safety,
            macroBonusFn: calculateMacroPriorityBonus,
            safetyPolicy: {
              very_risky: -15,
              risky: -8,
            },
          });

        actions.push(
          buildPrioritizedAction({
            type: "spell",
            index,
            card,
            priority: finalPriority,
            activationContext: spellActivationContext,
            extra: {
              macroBuff,
              safetyScore,
            },
          }),
        );
      } else {
        log(`  ❌ Spell: ${card.name} — ${decision.reason}`);
      }
    });

    // === TRAP SET ACTIONS ===
    const activatedIndices = new Set(actions.map((a) => a.index));
    const trapSetActions = getGenericSetBackrowActions({
      bot,
      game,
      opponent,
      analysis,
      alreadyUsedHandIndices: activatedIndices,
      basePriority: 6,
      defaultReason: "setup_backrow",
      policy: {
        acceptsCard: (card) => card?.cardKind === "trap",
        getPriority: (card) => {
          let priority = 6;

          if (card.name === "Call of the Haunted") {
            const gyMonsters = (bot.graveyard || []).filter(
              (c) => c && c.cardKind === "monster",
            );
            if (gyMonsters.length > 0) {
              priority = 9;
              if ((opponent?.field || []).length >= 2 || analysis.lpRatio < 0.6) {
                priority = 11;
              }
            } else {
              priority = 4;
            }
          } else if (card.name === "Dragon Spirit Sanctuary") {
            const fieldDragons = (bot.field || []).filter(
              (c) => c && c.cardKind === "monster",
            );
            const handDragons = (bot.hand || []).filter(isDragonMonster);
            priority = fieldDragons.length > 0 && handDragons.length > 0 ? 8 : 4;
          }

          return priority;
        },
      },
    });
    for (const action of trapSetActions) {
      log(`  📥 Set trap: ${action.cardName} (priority ${action.priority})`);
      actions.push(action);
    }

    // === EXTREME DRAGON TRIBUTE SUMMON ===
    // Evaluate tributing 2 field monsters for an Extreme Dragon (level 10 = 2 tributes).
    // This must be checked BEFORE normal summons so it can outbid lower-priority summons.
    if (analysis.canNormalSummon) {
      const fieldMonsters = (bot.field || []).filter((c) => c && c.cardKind === "monster");
      const hasExtremeOnField = fieldMonsters.some((c) => isExtremeDragon(c));

      if (!hasExtremeOnField) {
        const oppField = opponent?.field || [];
        const oppStrongestATK = oppField.reduce((max, m) => Math.max(max, m.atk || 0), 0);

        (bot.hand || []).forEach((card, index) => {
          if (!isExtremeDragon(card)) return;
          if (card.cannotBeNormalSummonedOrSet) return;
          if ((bot.summonCount || 0) >= 1) return;

          // Level 10 → 2 tributes (standard lv7+ rule)
          const tributesNeeded = 2;
          const bossRank = rankDragonBossCandidates([card], {
            analysis,
            player: bot,
            bot,
            opponent,
            routeKind: "tribute",
            tributeCount: tributesNeeded,
          })[0];
          if (!bossRank || bossRank.score < 55) {
            log(`  ❌ Extreme Tribute: ${card.name} — boss policy does not value it now`);
            return;
          }

          const tributeIndices = selectBestTributes(fieldMonsters, tributesNeeded, card, {
            analysis,
            opponent,
            routeKind: "tribute",
          });
          const tributedCards = tributeIndices.map((i) => fieldMonsters[i]).filter(Boolean);
          if (tributedCards.length === 0) return;

          // Don't waste the tribute summon if extreme dragon's ATK won't dominate
          const extremeATK = card.atk || 0;

          // Always worth it if ATK beats opponent's strongest, or opp field is dangerous (2+ threats)
          const beatsThreat = extremeATK > oppStrongestATK;
          const oppHasMultipleThreats = oppField.length >= 2;
          const oppHasBigThreat = oppStrongestATK >= 2000;

          if (!beatsThreat && !oppHasMultipleThreats && !oppHasBigThreat) {
            log(`  ❌ Extreme Tribute: ${card.name} — no pressure justifies the cost`);
            return;
          }

          // Don't tribute another Extreme Dragon
          if (tributedCards.some((m) => isExtremeDragon(m))) {
            log(`  ❌ Extreme Tribute: ${card.name} — would tribute another Extreme Dragon`);
            return;
          }

          // High priority: extreme dragon tribute is almost always the best play when available
          let priority = 11 + Math.min(5, Math.max(0, bossRank.score) / 35);
          if (beatsThreat && oppHasMultipleThreats) priority = 15;
          else if (beatsThreat) priority = Math.max(priority, 14);
          else if (oppHasMultipleThreats) priority = Math.max(priority, 12);
          if (fieldMonsters.length === tributesNeeded) priority += 2;

          log(`  ✅ Extreme Tribute: ${card.name} (${extremeATK} ATK) — tributing ${tributedCards.map((m) => m.name).join(", ")} (priority ${priority})`);

          const macroBuff = calculateMacroPriorityBonus("summon", card, macroStrategy);
          actions.push({
            type: "summon",
            index,
            cardId: card.id,
            position: "attack",
            facedown: false,
            priority: priority + macroBuff,
            cardName: card.name,
            macroBuff,
            isExtremeTribute: true,
          });
        });
      }
    }

    // === NORMAL SUMMON ACTIONS ===
    if (analysis.canNormalSummon) {
      (bot.hand || []).forEach((card, index) => {
        if (card.cardKind !== "monster") return;
        if (card.cannotBeNormalSummonedOrSet) return;
        if ((bot.summonCount || 0) >= 1) return;

        // Extreme Dragons are handled in the dedicated tribute section above
        if (isExtremeDragon(card)) return;

        const tributeInfo = this.getTributeRequirementFor(card, bot);
        if ((bot.field?.length || 0) < tributeInfo.tributesNeeded) return;
        if (analysis.fieldCapacity <= 0) return;

        const decision = shouldSummonMonster(card, analysis, tributeInfo, {
          field: bot.field || [],
          oppField: opponent?.field || [],
        });
        const bossRank = DRAGON_BOSS_POLICY_NAMES.includes(card.name)
          ? rankDragonBossCandidates([card], {
              analysis,
              player: bot,
              bot,
              opponent,
              routeKind: "tribute",
              tributeCount: tributeInfo.tributesNeeded,
            })[0]
          : null;
        if (bossRank && tributeInfo.tributesNeeded > 0 && bossRank.score < 45) {
          log(`  ❌ Summon: ${card.name} — boss policy prefers holding it`);
          return;
        }

        if (decision.yes) {
          log(`  ✅ Summon: ${card.name} — ${decision.reason}`);

          const safety = assessActionSafety({ bot, player: opponent }, bot, opponent, "summon", card);
          const { priority: finalPriority, macroBuff, safetyScore } =
            applyMacroAndSafety({
              basePriority:
                (decision.priority || 5) +
                (bossRank ? Math.min(4, Math.max(0, bossRank.score) / 45) : 0),
              actionType: "summon",
              card,
              macroStrategy,
              safety,
              macroBonusFn: calculateMacroPriorityBonus,
              safetyPolicy: {
                very_risky: -10,
              },
            });

          actions.push(
            buildPrioritizedAction({
              type: "summon",
              index,
              card,
              priority: finalPriority,
              extra: {
                position: decision.position,
                facedown:
                  decision.facedown !== undefined
                    ? decision.facedown
                    : decision.position === "defense",
                macroBuff,
                safetyScore,
              },
            }),
          );
        } else {
          log(`  ❌ Summon: ${card.name} — ${decision.reason}`);
        }
      });
    }

    // === HAND IGNITION ACTIONS ===
    // Monsters with ignition effects activatable from hand.
    // This layer only decides when the bot should offer the declarative effect.
    (bot.hand || []).forEach((card, index) => {
      if (card.cardKind !== "monster") return;

      const handIgnitionEffects = findIgnitionEffects(card, "hand");
      if (handIgnitionEffects.length === 0) return;

      for (const handIgnitionEffect of handIgnitionEffects) {
        // Check if cost targets exist in field
        const targets = handIgnitionEffect.targets || [];
        const costTarget = targets.find((t) => t.zone === "field");
        if (costTarget) {
          const fieldCards = bot.field || [];
          const hasValidCost = fieldCards.some((fieldCard) => {
            if (fieldCard.cardKind !== "monster") return false;
            if (costTarget.cardName && fieldCard.name !== costTarget.cardName) return false;
            if (costTarget.archetype && !hasArchetype(fieldCard, costTarget.archetype)) return false;
            if (costTarget.filters?.type && fieldCard.type !== costTarget.filters.type) return false;
            return true;
          });
          if (!hasValidCost) {
            log(`  ⏭️ Hand ignition ${card.name}: no valid field cost`);
            continue;
          }
        }

        // Check GY cost targets (Purified Crystal Dragon: banish 3 GY dragons)
        const gyCostTarget = targets.find((t) => t.zone === "graveyard");
        if (gyCostTarget) {
          const gyCards = bot.graveyard || [];
          const minCount = gyCostTarget.count?.min || 1;
          const gyMatches = gyCards.filter((c) => {
            if (gyCostTarget.cardKind && c.cardKind !== gyCostTarget.cardKind) return false;
            if (gyCostTarget.type && c.type !== gyCostTarget.type) return false;
            return true;
          });
          if (gyMatches.length < minCount) {
            log(`  ⏭️ Hand ignition ${card.name}: insufficient GY targets (need ${minCount}, have ${gyMatches.length})`);
            continue;
          }
        }

        // Check once-per-turn
        if (!isSimulatedState) {
          const optCheck = checkOncePerTurnIfRealGame(
            actualGame,
            card,
            bot,
            handIgnitionEffect,
          );
          if (!optCheck?.ok) {
            log(`  ⏭️ Hand ignition ${card.name}: already used this turn`);
            continue;
          }
        }

        const needsMonsterZone = (handIgnitionEffect.actions || []).some(
          (action) => action?.type === "special_summon_from_zone",
        );
        const freesMonsterZone = (handIgnitionEffect.actions || []).some(
          (action) => Number(action?.fieldSlotsFreedBeforeSummon || 0) > 0,
        );
        if (analysis.fieldCapacity <= 0 && needsMonsterZone && !freesMonsterZone && !gyCostTarget && !costTarget) {
          // Might be trying to SS itself without first freeing a field slot.
          log(`  ⏭️ Hand ignition ${card.name}: field full`);
          continue;
        }

        // Calculate priority
        let priority = 7;
        let targetPreferences = {};
        const policyDecision = evaluateDragonHandIgnition(card, handIgnitionEffect, {
          analysis,
          player: bot,
          bot,
          opponent,
          game: actualGame,
          source: card,
          sourceCard: card,
          effect: handIgnitionEffect,
        });

        if (policyDecision?.handled) {
          if (!policyDecision.ok) {
            log(`  ⏭️ Hand ignition: ${card.name} — ${policyDecision.reason}`);
            continue;
          }
          priority = policyDecision.priority ?? priority;
          targetPreferences = {
            ...targetPreferences,
            ...(policyDecision.targetPreferences || {}),
          };
          log(`  ✅ Hand ignition: ${card.name} → ${policyDecision.reason}`);
        } else if (card.name === "Luminous Dragon") {
          if ((bot.field || []).some((fieldCard) => fieldCard?.cardKind === "monster")) {
            log(`  ⏭️ Hand ignition: Luminous Dragon — field is not empty`);
            continue;
          }
          const hasFollowUp = hasLuminousFollowUp(bot);
          priority = hasFollowUp ? 10 : 6;
          if ((opponent?.field || []).length > 0) priority += 1;
          log(`  ✅ Hand ignition: Luminous Dragon → empty-field starter${hasFollowUp ? " with follow-up" : ""}`);
        } else if (card.name === "Hellkite Dragon") {
          // Only worthwhile if there's a field Dragon weaker than Hellkite (2300) to sacrifice
          const fieldDragons = (bot.field || []).filter(isFaceupDragon);
          const hasCheapCost = fieldDragons.some(
            (c) => !isExtremeDragon(c) && (c.atk || 0) < (card.atk || 2300),
          );
          if (!hasCheapCost) {
            log(`  ⏭️ Hand ignition: Hellkite Dragon — no expendable Dragon cost`);
            continue;
          }
          priority = 8 + ((bot.graveyard || []).some(isDragonMonster) ? 1 : 0);
          targetPreferences.hellkite_cost_field_dragon = {
            role: "cost",
            preferNames: getFieldDragonCostNames(bot),
            preserveNames: DRAGON_COST_PRESERVE_NAMES,
          };
          log(`  ✅ Hand ignition: Hellkite Dragon → 2300 ATK, GY setup`);
        } else if (card.name === "Purified Crystal Dragon") {
          const purifiedDecision = shouldUsePurifiedBanishSummon({
            analysis,
            player: bot,
            bot,
            opponent,
            game: actualGame,
            source: card,
            sourceCard: card,
            effect: handIgnitionEffect,
          });
          if (!purifiedDecision.ok) {
            log(`  ⏭️ Hand ignition: Purified Crystal Dragon — ${purifiedDecision.reason}`);
            continue;
          }
          priority = purifiedDecision.priority;
          targetPreferences.purified_banish_cost = purifiedDecision.targetPreference;
          log(`  ✅ Hand ignition: Purified Crystal Dragon → 2500 ATK (banish GY Dragons)`);
        } else {
          log(`  ✅ Hand ignition: ${card.name}`);
        }

        const actionContext = buildDragonActionContext({
          analysis,
          player: bot,
          bot,
          opponent,
          game: actualGame,
          source: card,
          sourceCard: card,
          effect: handIgnitionEffect,
          targetPreferences,
        });
        const activationContext = buildActivationContext("hand", actionContext);
        const macroBuff = calculateMacroPriorityBonus("handIgnition", card, macroStrategy);
        priority += macroBuff;

        actions.push({
          type: "handIgnition",
          index,
          cardId: card.id,
          priority,
          cardName: card.name,
          effectId: handIgnitionEffect.id,
          macroBuff,
          activationContext,
        });
      }
    });

    // === FIELD MONSTER IGNITION ACTIONS ===
    (bot.field || []).forEach((card, fieldIndex) => {
      if (!card || card.cardKind !== "monster" || card.isFacedown) return;
      const ignition = findIgnitionEffect(card, "field");
      if (!ignition) return;

      let priority = null;
      const targetPreferences = {};
      const oppTargets = rankCardsByThreat(opponent?.field || []);
      const bestOwnDragons = rankOwnDragonsByValue(bot.field || []);

      if (card.name === "Abyssal Serpent Dragon") {
        if (oppTargets.length === 0) return;
        const topTarget = oppTargets[0];
        priority = 7 + (topTarget.monsterType === "fusion" || topTarget.monsterType === "ascension" ? 3 : 0);
        if ((topTarget.atk || 0) >= (card.atk || 0)) priority += 2;
        targetPreferences.abyssal_target = {
          role: "removal",
          preferredNames: oppTargets.slice(0, 3).map((target) => target.name),
        };
      } else if (card.name === "Darkness Dragon") {
        if ((bot.hand || []).length === 0 || oppTargets.length === 0) return;
        priority = 6 + (threatScore(oppTargets[0]) >= 8 ? 2 : 0);
        targetPreferences.darkness_dragon_discard_cost = {
          role: "cost",
          preferNames: DRAGON_COST_PREFER_NAMES,
          preserveNames: DRAGON_COST_PRESERVE_NAMES,
        };
        targetPreferences.darkness_dragon_negate_target = {
          role: "removal",
          preferredNames: oppTargets.slice(0, 3).map((target) => target.name),
        };
      } else if (card.name === "Majestic Silver Dragon") {
        const usefulTargets = oppTargets.filter((target) => {
          if (target.position === "attack" && (target.atk || 0) >= (card.atk || 0)) return true;
          if (target.position === "defense" && (target.def || 0) < (card.atk || 0)) return true;
          return target.monsterType === "fusion" || target.monsterType === "ascension";
        });
        if (usefulTargets.length === 0) return;
        priority = 6 + (usefulTargets[0].monsterType ? 2 : 0);
        targetPreferences.majestic_position_target = {
          role: "removal",
          preferredNames: usefulTargets.slice(0, 3).map((target) => target.name),
        };
      } else if (card.name === "Hellkite Dragon") {
        const gyTargets = (bot.graveyard || [])
          .filter((candidate) => isDragonMonster(candidate) && (candidate.level || 0) <= 7)
          .sort((a, b) => {
            const bossDiff =
              (rankDragonBossCandidates([b], {
                analysis,
                player: bot,
                bot,
                opponent,
                routeKind: "recursion",
              })[0]?.score || 0) -
              (rankDragonBossCandidates([a], {
                analysis,
                player: bot,
                bot,
                opponent,
                routeKind: "recursion",
              })[0]?.score || 0);
            return bossDiff || cardStrategicValue(b) - cardStrategicValue(a);
          });
        if (gyTargets.length === 0) return;
        const bossPref = buildDragonBossTargetPreference(
          gyTargets,
          { analysis, player: bot, bot, opponent, routeKind: "recursion" },
          "recursion",
        );
        priority = 8 + (gyTargets[0].atk || 0) / 1000;
        if (bossPref.preferredNames?.includes(gyTargets[0].name)) priority += 2;
        targetPreferences.hellkite_dragon_field_revive = {
          role: "recursion",
          purpose: "pressure",
          preferredNames: uniqueNames([
            ...(bossPref.preferredNames || []),
            ...gyTargets.slice(0, 4).map((target) => target.name),
          ]),
          offensiveNames: uniqueNames([
            ...(bossPref.offensiveNames || []),
            ...gyTargets.slice(0, 4).map((target) => target.name),
          ]),
          preferredInstanceIds: bossPref.preferredInstanceIds,
        };
      } else if (card.name === "Purified Crystal Dragon") {
        const protectTargets = bestOwnDragons.filter((target) => target !== card);
        if (protectTargets.length === 0) return;
        priority = 7 + (protectTargets[0].atk || 0) / 1200;
        targetPreferences.purified_protection_target = {
          role: "named_preference",
          preferredNames: protectTargets.slice(0, 4).map((target) => target.name),
        };
      } else if (card.name === "Rainbow Cosmic Dragon") {
        if (bestOwnDragons.length === 0) return;
        priority = 9 + ((opponent?.field || []).length > 0 ? 2 : 0);
        targetPreferences.rainbow_cosmic_protection_target = {
          role: "named_preference",
          preferredNames: bestOwnDragons.slice(0, 4).map((target) => target.name),
        };
      } else if (card.name === "Volcanic Extreme Dragon") {
        const ownGyCount = (bot.graveyard || []).length;
        const oppGyCount = (opponent?.graveyard || []).length;
        const totalGyCount = ownGyCount + oppGyCount;
        const projectedBurn = totalGyCount * 100;
        const ownGyResourceCount = countCards(bot.graveyard || [], (candidate) =>
          isDragonMonster(candidate) || candidate?.name === "Hellkite Roar"
        );
        const lethalBurn = projectedBurn >= (opponent?.lp || 8000);
        if (!lethalBurn && oppGyCount < 5 && totalGyCount < 8) return;
        if (!lethalBurn && ownGyResourceCount >= ownGyCount - 1 && oppGyCount < 5) return;
        priority = lethalBurn ? 15 : 8 + Math.min(4, Math.floor(projectedBurn / 400));
      } else {
        return;
      }

      const actionContext = buildDragonActionContext({
        analysis,
        player: bot,
        bot,
        opponent,
        game: actualGame,
        source: card,
        sourceCard: card,
        effect: ignition,
        targetPreferences,
      });
      const activationContext = buildActivationContext("field", actionContext);

      if (!isSimulatedState && actualGame.effectEngine) {
        if (
          !canActivateMonsterEffect(
            actualGame,
            card,
            bot,
            "field",
            activationContext,
          )
        ) {
          return;
        }
      } else if (
        !effectTargetsAvailable(ignition, {
          player: bot,
          opponent,
          source: card,
          activationContext,
        })
      ) {
        return;
      }

      const macroBuff = calculateMacroPriorityBonus("monsterEffect", card, macroStrategy);
      actions.push({
        type: "monsterEffect",
        fieldIndex,
        cardId: card.id,
        cardName: card.name,
        effectId: ignition.id,
        priority: priority + macroBuff,
        macroBuff,
        activationContext,
      });
      log(`  Field ignition: ${card.name} (priority ${priority + macroBuff})`);
    });

    // === GRAVEYARD MONSTER IGNITION ACTIONS ===
    (bot.graveyard || []).forEach((card, graveyardIndex) => {
      if (!card || card.cardKind !== "monster") return;
      const graveyardIgnitionEffect = findIgnitionEffect(card, "graveyard");
      if (!graveyardIgnitionEffect) return;

      let targetPreferences = {};
      let priority = 7;
      const policyDecision = evaluateDragonGraveyardIgnition(card, graveyardIgnitionEffect, {
        analysis,
        player: bot,
        bot,
        opponent,
        game: actualGame,
        source: card,
        sourceCard: card,
        effect: graveyardIgnitionEffect,
      });

      if (policyDecision?.handled) {
        if (!policyDecision.ok) {
          log(`  Skipping Graveyard ignition: ${card.name} - ${policyDecision.reason}`);
          return;
        }
        priority = policyDecision.priority ?? priority;
        targetPreferences = {
          ...targetPreferences,
          ...(policyDecision.targetPreferences || {}),
        };
      } else if (card.name === "Grey Dragon") {
        const discardableDragons = (bot.hand || []).filter(isDragonMonster);
        if (discardableDragons.length === 0) return;
        const usefulDiscard = discardableDragons.some((candidate) =>
          [
            "Solar Eclipse Dragon",
            "Lunar Eclipse Dragon",
            "Stelya, Dragon Tamer",
            "Voltaic Dragon",
          ].includes(candidate.name)
        );
        const luminousRecovery =
          (bot.field || []).some(
            (candidate) => candidate?.name === "Luminous Dragon" && !candidate.isFacedown,
          ) &&
          discardableDragons.some((discard) =>
            (bot.graveyard || []).some(
              (candidate) =>
                isDragonMonster(candidate) && candidate.name !== discard.name,
            ),
          );
        if (!usefulDiscard && !luminousRecovery) return;
        priority = 8;
        targetPreferences.grey_dragon_discard_cost = {
          role: "cost",
          preferNames: uniqueNames([
            "Solar Eclipse Dragon",
            "Lunar Eclipse Dragon",
            "Stelya, Dragon Tamer",
            "Voltaic Dragon",
            ...discardableDragons
              .slice()
              .sort((a, b) => cardStrategicValue(a) - cardStrategicValue(b))
              .map((candidate) => candidate.name),
          ]),
          preserveNames: DRAGON_COST_PRESERVE_NAMES,
        };
      } else if (card.name === "Black Bull Dragon") {
        const searchTargets = (bot.deck || []).filter(
          (candidate) =>
            isDragonMonster(candidate) &&
            (candidate.level || 0) >= 7 &&
            (candidate.level || 0) <= 8,
        );
        if (searchTargets.length === 0) return;
        priority = 8 + Math.min(2, searchTargets.length);
      } else if (card.name === "Stelya, Dragon Tamer") {
        const stelyaDecision = shouldUseStelyaBanishSummon({
          analysis,
          player: bot,
          bot,
          opponent,
          game: actualGame,
          source: card,
          sourceCard: card,
          effect: graveyardIgnitionEffect,
        });
        if (!stelyaDecision.ok) {
          log(`  Skipping Graveyard ignition: Stelya, Dragon Tamer - ${stelyaDecision.reason}`);
          return;
        }
        priority = stelyaDecision.priority + 1;
        targetPreferences.stelya_graveyard_banish_cost = stelyaDecision.targetPreference;
      } else if (card.name === "Boneflame Dragon") {
        const validBoneflameCosts = getValidBoneflameCostCandidates(
          card,
          bot,
        ).sort(
          (a, b) =>
            getEffectiveAtk(a) - getEffectiveAtk(b) ||
            cardStrategicValue(a) - cardStrategicValue(b),
        );
        if (validBoneflameCosts.length === 0) {
          log(`  Skipping Graveyard ignition: Boneflame Dragon - no ATK-upgrade cost`);
          return;
        }
        const invalidCostIds = (bot.field || [])
          .filter(
            (candidate) =>
              isFaceupDragon(candidate) &&
              !validBoneflameCosts.includes(candidate),
          )
          .map(getCardInstanceId)
          .filter((id) => id !== null);
        const projectedAtk = getProjectedBoneflameAtk(
          card,
          validBoneflameCosts[0],
          bot,
        );
        priority = 7 + Math.min(3, countCards(bot.graveyard || [], isDragonMonster));
        priority += Math.min(
          2,
          Math.max(0, projectedAtk - getEffectiveAtk(validBoneflameCosts[0])) /
            600,
        );
        targetPreferences.boneflame_cost_target = {
          role: "cost",
          preferNames: uniqueNames(validBoneflameCosts.map((candidate) => candidate.name)),
          preferredInstanceIds: validBoneflameCosts
            .map(getCardInstanceId)
            .filter((id) => id !== null),
          avoidInstanceIds: invalidCostIds,
          preserveNames: uniqueNames([
            ...DRAGON_COST_PRESERVE_NAMES,
            "Supreme Bahamut Dragon",
          ]),
        };
      } else if (card.name === "Rainbow Cosmic Dragon") {
        if (!hasRainbowGyFollowUp(bot)) return;
        const extremeDeckTargets = (bot.deck || []).filter((candidate) =>
          isDragonMonster(candidate) && hasArchetype(candidate, "Extreme Dragons")
        );
        if (extremeDeckTargets.length === 0) return;
        priority = 7 + Math.min(3, extremeDeckTargets.length);
        targetPreferences.rainbow_cosmic_extreme_send_targets = {
          role: "named_preference",
          preferredNames: EXTREME_GY_SEND_ORDER,
        };
      }

      const actionContext = buildDragonActionContext({
        analysis,
        player: bot,
        bot,
        opponent,
        game: actualGame,
        source: card,
        sourceCard: card,
        effect: graveyardIgnitionEffect,
        targetPreferences,
      });
      const activationContext = buildActivationContext("graveyard", actionContext);

      if (!isSimulatedState && actualGame.effectEngine) {
        const optCheck = checkOncePerTurnIfRealGame(
          actualGame,
          card,
          bot,
          graveyardIgnitionEffect,
        );
        if (!optCheck?.ok) return;

        if (
          !canActivateMonsterEffect(
            actualGame,
            card,
            bot,
            "graveyard",
            activationContext,
          )
        ) {
          return;
        }
      } else if (
        !effectTargetsAvailable(graveyardIgnitionEffect, {
          player: bot,
          opponent,
          source: card,
          activationContext,
        })
      ) {
        return;
      }

      if (
        (graveyardIgnitionEffect.actions || []).some(
          (action) =>
            action?.type === "special_summon_from_zone" &&
            action.zone === "graveyard" &&
            action.requireSource === true,
        )
      ) {
        priority += 2;
      }
      priority += calculateMacroPriorityBonus(
        "graveyardMonsterEffect",
        card,
        macroStrategy,
      );

      actions.push({
        type: "graveyardMonsterEffect",
        graveyardIndex,
        cardId: card.id,
        cardName: card.name,
        effectId: graveyardIgnitionEffect.id,
        priority,
        activationContext,
      });
      log(`  âœ… Graveyard ignition: ${card.name}`);
    });

    // === SPELL/TRAP-ZONE IGNITION ACTIONS ===
    // Face-up continuous spells with ignition effects (e.g. Extreme Dragon Awakening).
    (bot.spellTrap || []).forEach((card, zoneIndex) => {
      if (!card || card.isFacedown || card.cardKind !== "spell") return;
      const ignition = findIgnitionEffect(card, "spellTrap");
      if (!ignition) return;

      if (!isSimulatedState && actualGame.effectEngine) {
        const opt = checkOncePerTurnIfRealGame(actualGame, card, bot, ignition);
        if (!opt?.ok) return;
      }

      if (card.name === "Extreme Dragon Awakening") {
        const fieldDragons = (bot.field || []).filter(
          (c) => c?.cardKind === "monster" && !c.isFacedown && c.type === "Dragon"
        );
        const nonExtreme = fieldDragons.filter((c) => !isExtremeDragon(c));
        const bestDragon = getBestAwakeningTarget(bot, opponent, analysis);
        if (nonExtreme.length < 2 || !bestDragon) return;

        let priority = 12;
        const bossRank = rankDragonBossCandidates([bestDragon], {
          analysis,
          player: bot,
          bot,
          opponent,
          routeKind: "awakening",
          fieldCostCount: 2,
        })[0];
        const oppStrongest = (opponent?.field || []).reduce(
          (m, c) => Math.max(m, c.atk || 0),
          0
        );
        if ((bestDragon?.atk || 0) > oppStrongest) priority = 14;
        if (bestDragon.name === "Black Bull Dragon") priority += 1;
        if (bestDragon.name === "Purified Crystal Dragon" && analysis.lpRatio < 0.65) priority += 1;
        if (bestDragon.name === "Volcanic Extreme Dragon" && (opponent?.graveyard || []).length >= 4) priority += 1;
        if (bossRank) priority += Math.min(3, Math.max(0, bossRank.score) / 45);
        if (fieldDragons.length === 2 && isExtremeDragon(bestDragon)) priority += 2;

        if (
          analysis.canNormalSummon &&
          (bot.hand || []).some(
            (c) => c.name === "Armored Dragon" || c.name === "Luminescent Dragon"
          )
        ) {
          priority += 1;
        }

        const actionContext = buildDragonActionContext({
          analysis,
          player: bot,
          bot,
          opponent,
          game: actualGame,
          source: card,
          sourceCard: card,
          effect: ignition,
          targetPreferences: {
            awakening_cost_dragons: {
              role: "cost",
              preferNames: getFieldDragonCostNames(bot),
              preserveNames: uniqueNames([
                ...DRAGON_COST_PRESERVE_NAMES,
                ...fieldDragons.filter(isExtremeDragon).map((candidate) => candidate.name),
              ]),
            },
            awakening_summon_dragon: {
              role: "named_preference",
              preferredNames: uniqueNames([
                bestDragon.name,
                ...(buildDragonBossTargetPreference(
                  (bot.hand || []).filter(
                    (candidate) =>
                      isDragonMonster(candidate) &&
                      (candidate.level || 0) >= 8,
                  ),
                  {
                    analysis,
                    player: bot,
                    bot,
                    opponent,
                    routeKind: "awakening",
                    fieldCostCount: 2,
                  },
                ).preferredNames || []),
                ...AWAKENING_TARGET_ORDER,
              ]),
            },
          },
        });
        const activationContext = buildActivationContext("spellTrap", actionContext);

        if (!isSimulatedState && actualGame.effectEngine) {
          if (
            !canActivateSpellTrapEffect(
              actualGame,
              card,
              bot,
              "spellTrap",
              activationContext,
            )
          ) {
            return;
          }
        }

        log(
          `  Awakening ignition: SS ${bestDragon?.name} via 2 Dragon cost (priority ${priority})`
        );
        actions.push({
          type: "spellTrapEffect",
          zoneIndex,
          cardId: card.id,
          cardName: card.name,
          priority,
          effectId: ignition.id,
          activationContext,
        });
      }
    });

    // === FIELD SPELL IGNITION ACTIONS ===
    const fieldSpell = bot.fieldSpell;
    if (fieldSpell?.name === "Jagged Peak of the Dragons") {
      const counters = fieldSpell.counters?.dragon_peak || 0;
      const ignition = findIgnitionEffect(fieldSpell, "fieldSpell");
      if (ignition && counters >= 5) {
        const dragonCandidates = [
          ...rankOwnDragonsByValue(bot.hand || []),
          ...(bot.deck || []).filter(isDragonMonster).sort((a, b) => cardStrategicValue(b) - cardStrategicValue(a)),
          ...(bot.graveyard || []).filter(isDragonMonster).sort((a, b) => cardStrategicValue(b) - cardStrategicValue(a)),
        ];
        const bossPref = buildDragonBossTargetPreference(
          dragonCandidates,
          {
            analysis,
            player: bot,
            bot,
            opponent,
            routeKind: "jaggedPeak",
          },
          "recursion",
        );
        const preferredDragons = [
          ...dragonCandidates
            .filter((candidate) => bossPref.preferredNames?.includes(candidate.name))
            .sort(
              (a, b) =>
                bossPref.preferredNames.indexOf(a.name) -
                bossPref.preferredNames.indexOf(b.name),
            ),
          ...dragonCandidates.filter(
            (candidate) => !bossPref.preferredNames?.includes(candidate.name),
          ),
        ];
        const actionContext = buildDragonActionContext({
          analysis,
          player: bot,
          bot,
          opponent,
          game: actualGame,
          source: fieldSpell,
          sourceCard: fieldSpell,
          effect: ignition,
          targetPreferences: {
            dragon_peak_ignite_summon: {
              role: "recursion",
              purpose: "pressure",
              preferredNames: uniqueNames(
                [
                  ...(bossPref.preferredNames || []),
                  ...preferredDragons.slice(0, 6).map((candidate) => candidate.name),
                ],
              ),
              offensiveNames: uniqueNames(
                [
                  ...(bossPref.offensiveNames || []),
                  ...preferredDragons.slice(0, 6).map((candidate) => candidate.name),
                ],
              ),
              preferredInstanceIds: bossPref.preferredInstanceIds,
            },
          },
        });
        const activationContext = buildActivationContext("fieldSpell", actionContext);
        let canUsePeak = true;
        if (!isSimulatedState && actualGame.effectEngine) {
          canUsePeak = canActivateFieldSpellEffect(
            actualGame,
            fieldSpell,
            bot,
            activationContext,
          );
        } else {
          canUsePeak = effectTargetsAvailable(ignition, {
            player: bot,
            opponent,
            source: fieldSpell,
            activationContext,
          });
        }
        if (canUsePeak) {
          const bestTarget = preferredDragons[0];
          const priority = 13 + (bestTarget ? Math.min(3, cardStrategicValue(bestTarget) / 6) : 0);
          actions.push({
            type: "fieldEffect",
            cardId: fieldSpell.id,
            cardName: fieldSpell.name,
            priority,
            effectId: ignition.id,
            activationContext,
          });
          log(`  Field spell ignition: Jagged Peak cashout (priority ${priority})`);
        }
      }
    }

    // === GRAVEYARD SPELL IGNITION ACTIONS ===
    (bot.graveyard || []).forEach((card, graveyardIndex) => {
      if (!card || card.cardKind !== "spell") return;
      const ignition = findIgnitionEffect(card, "graveyard");
      if (!ignition) return;
      if (card.name !== "Hellkite Roar") return;
      if (!hasUsefulJaggedPeakSearch(bot)) return;

      const actionContext = buildDragonActionContext({
        analysis,
        player: bot,
        bot,
        opponent,
        game: actualGame,
        source: card,
        sourceCard: card,
        effect: ignition,
        targetPreferences: {
          hellkite_roar_gy_search_peak: {
            role: "named_preference",
            preferredNames: ["Jagged Peak of the Dragons"],
          },
        },
      });
      const activationContext = buildActivationContext("graveyard", actionContext);

      if (!isSimulatedState && actualGame.effectEngine) {
        if (
          !canActivateSpellTrapEffect(
            actualGame,
            card,
            bot,
            "graveyard",
            activationContext,
          )
        ) {
          return;
        }
      } else if (
        !effectTargetsAvailable(ignition, {
          player: bot,
          opponent,
          source: card,
          activationContext,
        })
      ) {
        return;
      }

      const priority = bot.fieldSpell ? 6 : 9;
      actions.push({
        type: "graveyardSpellEffect",
        graveyardIndex,
        cardId: card.id,
        cardName: card.name,
        priority,
        effectId: ignition.id,
        activationContext,
      });
      log(`  Graveyard spell ignition: Hellkite Roar -> Jagged Peak`);
    });

    // === STALEMATE BREAKER ===
    if (
      actions.length === 0 &&
      analysis.fieldCapacity > 0 &&
      !isSimulatedState &&
      (bot.summonCount || 0) < 1
    ) {
      const realBot = this.bot || bot;

      log(`  ⚠️ STALEMATE BREAKER: forcing fallback summon...`);

      (realBot.hand || []).forEach((card, index) => {
        if (card.cardKind !== "monster") return;
        if (card.cannotBeNormalSummonedOrSet) return;
        if (isExtremeDragon(card)) return;  // Skip Extreme Dragons for normal stalemate

        const tributeInfo = this.getTributeRequirementFor(card, realBot);
        if ((realBot.field?.length || 0) < tributeInfo.tributesNeeded) return;

        if (tributeInfo.tributesNeeded > 0) {
          const tradeCheck = evaluateTributeTrade(
            card, realBot.field || [], tributeInfo.tributesNeeded,
            { oppField: opponent?.field || [] }
          );
          if (!tradeCheck.ok) return;
        }

        log(`    🔧 Fallback summon: ${card.name}`);
        actions.push({
          type: "summon",
          index,
          cardId: card.id,
          position: "defense",
          facedown: true,
          priority: 1,
          cardName: card.name,
          isStalemateBreaker: true,
        });
      });
    }

    // === SECONDARY FALLBACK: Force any spell if still no actions ===
    if (actions.length === 0 && !isSimulatedState) {
      const realBot2 = this.bot || bot;

      if ((realBot2.hand?.length || 0) > 3) {
        log(`  🆘 CRITICAL FALLBACK: forcing spell...`);

        (realBot2.hand || []).forEach((card, index) => {
          if (card.cardKind !== "spell") return;
          const preview = actualGame.effectEngine?.canActivateSpellFromHandPreview?.(
            card,
            realBot2,
            {
              activationContext: {
                autoSelectTargets: true,
                autoSelectSingleTarget: true,
                logTargets: false,
              },
            },
          );
          if (preview && preview.ok === false) return;

          if (card.name === "Polymerization") {
            const canActivate = actualGame.canActivatePolymerization?.() ?? false;
            if (!canActivate) return;
            const extraDeckPlan = selectDragonFusionPlan({
              analysis,
              player: realBot2,
              bot: realBot2,
              opponent,
              game: actualGame,
            });
            if (!extraDeckPlan?.ok) return;
          }

          actions.push({
            type: "spell",
            index,
            cardId: card.id,
            priority: 0.5,
            cardName: card.name,
            activationContext: {
              autoSelectTargets: true,
              autoSelectSingleTarget: true,
              logTargets: false,
            },
            isCriticalFallback: true,
          });
        });
      }
    }

    const retainedActions = applyDragonRetentionPriorities(actions, {
      analysis,
      game: isSimulatedState ? game : actualGame,
      bot,
      opponent,
    });

    log(`  📋 Total actions generated: ${retainedActions.length}`);
    return this.integrateP2IntoActionSelection(game, retainedActions, analysis);
  }
}
