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
  hasOncePerTurnEffect,
} from "./common/effectDiscovery.js";
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
  "Voltaic Dragon",
  "Grey Dragon",
  "Boneflame Dragon",
  "Luminescent Dragon",
  "Armored Dragon",
];

const DRAGON_COST_PRESERVE_NAMES = [
  "Luminous Dragon",
  "Black Bull Dragon",
  "Purified Crystal Dragon",
  "Hellkite Dragon",
  "Polymerization",
  "Extreme Dragon Awakening",
  "Jagged Peak of the Dragons",
];

const AWAKENING_TARGET_ORDER = [
  "Black Bull Dragon",
  "Purified Crystal Dragon",
  "Volcanic Extreme Dragon",
  "Galaxy Extreme Dragon",
  "Forest Extreme Dragon",
];

const EXTREME_GY_SEND_ORDER = [
  "Volcanic Extreme Dragon",
  "Forest Extreme Dragon",
  "Galaxy Extreme Dragon",
  "Fire Extreme Dragon",
  "Mist Extreme Dragon",
];

function uniqueNames(names = []) {
  return [...new Set((names || []).filter(Boolean))];
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

function buildDragonActionContext(extra = {}) {
  const costPreferences = {
    preferNames: DRAGON_COST_PREFER_NAMES,
    preserveNames: DRAGON_COST_PRESERVE_NAMES,
    offensivePayoffNames: [
      "Black Bull Dragon",
      "Purified Crystal Dragon",
      "Hellkite Dragon",
      "Radiant Cosmic Dragon",
      "Rainbow Cosmic Dragon",
    ],
    preserveLastOffensivePayoff: true,
    ...(extra.costPreferences || {}),
  };

  costPreferences.preferNames = uniqueNames(costPreferences.preferNames);
  costPreferences.preserveNames = uniqueNames(costPreferences.preserveNames);
  costPreferences.offensivePayoffNames = uniqueNames(
    costPreferences.offensivePayoffNames,
  );

  return {
    costPreferences,
    targetPreferences: extra.targetPreferences || {},
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
    "Voltaic Dragon",
    "Black Bull Dragon",
    "Hellkite Dragon",
    "Polymerization",
    "Extreme Dragon Awakening",
    "Converging Stars",
  ].some((name) => names.has(name));
}

function hasRainbowGyFollowUp(bot) {
  if (hasNamedCard(bot.hand, "Call of the Haunted")) return true;
  if (hasNamedCard(bot.spellTrap, "Call of the Haunted")) return true;
  if ((bot.field || []).some((card) => card?.name === "Luminous Dragon" && !card.isFacedown)) {
    return true;
  }
  const hasBoneflame = hasNamedCard(bot.graveyard, "Boneflame Dragon");
  const hasFieldDragon = (bot.field || []).some(isFaceupDragon);
  if (hasBoneflame && hasFieldDragon) return true;
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

  const oppStrongest = (opponent?.field || []).reduce(
    (max, card) => Math.max(max, card?.atk || 0),
    0,
  );
  const ranked = candidates.slice().sort((a, b) => {
    const orderA = AWAKENING_TARGET_ORDER.indexOf(a.name);
    const orderB = AWAKENING_TARGET_ORDER.indexOf(b.name);
    const rankA = orderA >= 0 ? 100 - orderA * 8 : 0;
    const rankB = orderB >= 0 ? 100 - orderB * 8 : 0;
    const pressureA = (a.atk || 0) > oppStrongest ? 10 : 0;
    const pressureB = (b.atk || 0) > oppStrongest ? 10 : 0;
    const defenseA = analysis?.lpRatio < 0.55 && a.name === "Purified Crystal Dragon" ? 8 : 0;
    const defenseB = analysis?.lpRatio < 0.55 && b.name === "Purified Crystal Dragon" ? 8 : 0;
    return (
      rankB + pressureB + defenseB + cardStrategicValue(b) -
      (rankA + pressureA + defenseA + cardStrategicValue(a))
    );
  });

  return ranked[0] || null;
}

function hasUsefulJaggedPeakSearch(bot) {
  if (bot.fieldSpell?.name === "Jagged Peak of the Dragons") return false;
  return (bot.deck || []).some((card) => card?.name === "Jagged Peak of the Dragons");
}

function targetRequirementAvailable(target, bot, opponent) {
  const owner = target.owner === "opponent" ? opponent : bot;
  const zones = target.zones || [target.zone || "field"];
  const minCount = target.count?.min ?? 1;
  const candidates = [];

  for (const zoneName of zones) {
    const zoneCards =
      zoneName === "fieldSpell"
        ? owner?.fieldSpell
          ? [owner.fieldSpell]
          : []
        : owner?.[zoneName] || [];
    for (const candidate of zoneCards || []) {
      if (!candidate) continue;
      if (target.cardKind && candidate.cardKind !== target.cardKind) continue;
      if (target.type && candidate.type !== target.type) continue;
      if (target.filters?.type && candidate.type !== target.filters.type) continue;
      if (target.archetype && !hasArchetype(candidate, target.archetype)) continue;
      if (target.cardName && candidate.name !== target.cardName) continue;
      if (target.filters?.name && candidate.name !== target.filters.name) continue;
      if (target.requireFaceup && candidate.isFacedown) continue;
      if (target.faceup === true && candidate.isFacedown) continue;
      if (Number.isFinite(target.minLevel) && (candidate.level || 0) < target.minLevel) continue;
      if (Number.isFinite(target.maxLevel) && (candidate.level || 0) > target.maxLevel) continue;
      candidates.push(candidate);
    }
  }

  return candidates.length >= minCount;
}

function effectTargetsAvailable(effect, bot, opponent) {
  return (effect?.targets || []).every((target) =>
    targetRequirementAvailable(target, bot, opponent)
  );
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

  selectBestTributes(field, tributesNeeded, cardToSummon) {
    return selectBestTributes(field, tributesNeeded, cardToSummon);
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
      const spellActivationContext = {
        autoSelectTargets: true,
        autoSelectSingleTarget: true,
        logTargets: false,
        actionContext: buildDragonActionContext(),
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

      const decision = shouldPlaySpell(card, analysis);

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

      if (!hasExtremeOnField && fieldMonsters.length >= 2) {
        const oppField = opponent?.field || [];
        const oppStrongestATK = oppField.reduce((max, m) => Math.max(max, m.atk || 0), 0);

        (bot.hand || []).forEach((card, index) => {
          if (!isExtremeDragon(card)) return;
          if (card.cannotBeNormalSummonedOrSet) return;
          if ((bot.summonCount || 0) >= 1) return;

          // Level 10 → 2 tributes (standard lv7+ rule)
          const tributesNeeded = 2;
          if (fieldMonsters.length < tributesNeeded) return;

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
          const tributeIndices = selectBestTributes(fieldMonsters, tributesNeeded, card);
          const tributedCards = tributeIndices.map((i) => fieldMonsters[i]).filter(Boolean);
          if (tributedCards.some((m) => isExtremeDragon(m))) {
            log(`  ❌ Extreme Tribute: ${card.name} — would tribute another Extreme Dragon`);
            return;
          }

          // High priority: extreme dragon tribute is almost always the best play when available
          let priority = 13;
          if (beatsThreat && oppHasMultipleThreats) priority = 15;
          else if (beatsThreat) priority = 14;
          else if (oppHasMultipleThreats) priority = 12;

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

        if (decision.yes) {
          log(`  ✅ Summon: ${card.name} — ${decision.reason}`);

          const safety = assessActionSafety({ bot, player: opponent }, bot, opponent, "summon", card);
          const { priority: finalPriority, macroBuff, safetyScore } =
            applyMacroAndSafety({
              basePriority: decision.priority || 5,
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

      const handIgnitionEffect = findIgnitionEffect(card, "hand");
      if (!handIgnitionEffect) return;

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
          return;
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
          return;
        }

        // Purified can spend any Dragon from the GY in this bot version.
        // Extreme Dragons remain useful resources, but no longer block the action by themselves.
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
          return;
        }
      }

      if (analysis.fieldCapacity <= 0 && !gyCostTarget && !costTarget) {
        // Might be trying to SS itself without first freeing a field slot.
        log(`  ⏭️ Hand ignition ${card.name}: field full`);
        return;
      }

      // Calculate priority
      let priority = 7;
      const targetPreferences = {};

      if (card.name === "Luminous Dragon") {
        if ((bot.field || []).some((fieldCard) => fieldCard?.cardKind === "monster")) {
          log(`  ⏭️ Hand ignition: Luminous Dragon — field is not empty`);
          return;
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
          return;
        }
        priority = 8 + ((bot.graveyard || []).some(isDragonMonster) ? 1 : 0);
        targetPreferences.hellkite_cost_field_dragon = {
          role: "cost",
          preferNames: getFieldDragonCostNames(bot),
          preserveNames: DRAGON_COST_PRESERVE_NAMES,
        };
        log(`  ✅ Hand ignition: Hellkite Dragon → 2300 ATK, GY setup`);
      } else if (card.name === "Voltaic Dragon") {
        const controlsDragon = (bot.field || []).some(isFaceupDragon);
        if (!controlsDragon) {
          log(`  ⏭️ Hand ignition: Voltaic Dragon — no face-up Dragon controlled`);
          return;
        }
        priority = (bot.field || []).some((c) => c?.name === "Luminous Dragon" && !c.isFacedown)
          ? 9
          : 7;
        log(`  ✅ Hand ignition: Voltaic Dragon → free body on field`);
      } else if (card.name === "Black Bull Dragon") {
        // Only if we have enough discard fodder
        const handDragons = (bot.hand || []).filter(
          (c) => isDragonMonster(c) && c !== card
        );
        if (handDragons.length >= 2) {
          const usefulDiscards = handDragons.filter((candidate) =>
            ["Voltaic Dragon", "Grey Dragon", "Boneflame Dragon"].includes(candidate.name),
          );
          const needsPressure =
            (bot.field || []).length === 0 ||
            (opponent?.field || []).some((candidate) => (candidate?.atk || 0) >= 2200);
          if (usefulDiscards.length === 0 && !needsPressure && handDragons.length <= 2) {
            log(`  ⏭️ Hand ignition: Black Bull Dragon — discard cost has no payoff`);
            return;
          }
          priority = usefulDiscards.length > 0 ? 10 : 7;
          targetPreferences.bbd_cost = {
            role: "cost",
            preferNames: uniqueNames([
              "Voltaic Dragon",
              "Grey Dragon",
              "Boneflame Dragon",
              ...handDragons
                .slice()
                .sort((a, b) => cardStrategicValue(a) - cardStrategicValue(b))
                .map((candidate) => candidate.name),
            ]),
            preserveNames: DRAGON_COST_PRESERVE_NAMES,
          };
          log(`  ✅ Hand ignition: Black Bull Dragon → 2500 ATK (discard 2 Dragons)`);
        } else {
          log(`  ⏭️ Hand ignition: Black Bull Dragon — insufficient hand Dragons to discard`);
          return;
        }
      } else if (card.name === "Purified Crystal Dragon") {
        const gyDragons = (bot.graveyard || []).filter(isDragonMonster);
        const nonExtremeGy = gyDragons.filter((candidate) => !isExtremeDragon(candidate));
        if (nonExtremeGy.length < 3 && (opponent?.field || []).length === 0) {
          log(`  ⏭️ Hand ignition: Purified Crystal Dragon — mostly Extreme GY cost without pressure`);
          return;
        }
        priority = nonExtremeGy.length >= 3 ? 8 : 6;
        if ((opponent?.field || []).some((candidate) => (candidate?.atk || 0) >= 2400)) {
          priority += 1;
        }
        targetPreferences.purified_banish_cost = {
          role: "cost",
          preferNames: nonExtremeGy
            .slice()
            .sort((a, b) => cardStrategicValue(a) - cardStrategicValue(b))
            .map((candidate) => candidate.name),
          preserveNames: EXTREME_GY_SEND_ORDER,
        };
        log(`  ✅ Hand ignition: Purified Crystal Dragon → 2500 ATK (banish GY Dragons)`);
      } else {
        log(`  ✅ Hand ignition: ${card.name}`);
      }

      const actionContext = buildDragonActionContext({ targetPreferences });
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
          .sort((a, b) => cardStrategicValue(b) - cardStrategicValue(a));
        if (gyTargets.length === 0) return;
        priority = 8 + (gyTargets[0].atk || 0) / 1000;
        targetPreferences.hellkite_dragon_field_revive = {
          role: "recursion",
          purpose: "pressure",
          preferredNames: gyTargets.slice(0, 4).map((target) => target.name),
          offensiveNames: gyTargets.slice(0, 4).map((target) => target.name),
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

      const actionContext = buildDragonActionContext({ targetPreferences });
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
      } else if (!effectTargetsAvailable(ignition, bot, opponent)) {
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

      const targetPreferences = {};
      let priority = 7;

      if (card.name === "Grey Dragon") {
        const discardableDragons = (bot.hand || []).filter(isDragonMonster);
        if (discardableDragons.length === 0) return;
        const usefulDiscard = discardableDragons.some((candidate) =>
          ["Voltaic Dragon", "Boneflame Dragon"].includes(candidate.name)
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
            "Voltaic Dragon",
            "Boneflame Dragon",
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
      } else if (card.name === "Boneflame Dragon") {
        const expendableFieldDragons = (bot.field || []).filter(
          (candidate) => isFaceupDragon(candidate) && !isExtremeDragon(candidate),
        );
        if (expendableFieldDragons.length === 0) return;
        priority = 7 + Math.min(3, countCards(bot.graveyard || [], isDragonMonster));
        targetPreferences.boneflame_cost_target = {
          role: "cost",
          preferNames: getFieldDragonCostNames(bot),
          preserveNames: uniqueNames([
            ...DRAGON_COST_PRESERVE_NAMES,
            ...rankOwnDragonsByValue(bot.field || []).slice(0, 2).map((candidate) => candidate.name),
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

      const actionContext = buildDragonActionContext({ targetPreferences });
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
      } else if (!effectTargetsAvailable(graveyardIgnitionEffect, bot, opponent)) {
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
        const oppStrongest = (opponent?.field || []).reduce(
          (m, c) => Math.max(m, c.atk || 0),
          0
        );
        if ((bestDragon?.atk || 0) > oppStrongest) priority = 14;
        if (bestDragon.name === "Black Bull Dragon") priority += 1;
        if (bestDragon.name === "Purified Crystal Dragon" && analysis.lpRatio < 0.65) priority += 1;
        if (bestDragon.name === "Volcanic Extreme Dragon" && (opponent?.graveyard || []).length >= 4) priority += 1;

        if (
          analysis.canNormalSummon &&
          (bot.hand || []).some(
            (c) => c.name === "Armored Dragon" || c.name === "Luminescent Dragon"
          )
        ) {
          priority += 1;
        }

        const actionContext = buildDragonActionContext({
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
        const preferredDragons = [
          ...rankOwnDragonsByValue(bot.hand || []),
          ...(bot.deck || []).filter(isDragonMonster).sort((a, b) => cardStrategicValue(b) - cardStrategicValue(a)),
          ...(bot.graveyard || []).filter(isDragonMonster).sort((a, b) => cardStrategicValue(b) - cardStrategicValue(a)),
        ];
        const actionContext = buildDragonActionContext({
          targetPreferences: {
            dragon_peak_ignite_summon: {
              role: "recursion",
              purpose: "pressure",
              preferredNames: uniqueNames(
                preferredDragons.slice(0, 6).map((candidate) => candidate.name),
              ),
              offensiveNames: uniqueNames(
                preferredDragons.slice(0, 6).map((candidate) => candidate.name),
              ),
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
          canUsePeak = effectTargetsAvailable(ignition, bot, opponent);
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
      } else if (!effectTargetsAvailable(ignition, bot, opponent)) {
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
