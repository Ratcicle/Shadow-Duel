// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/DragonStrategy.js
// Dragon deck AI strategy — orchestrates dragon/* modules.
//
// DRAGON DECK PHILOSOPHY:
// - Mid-range Dragon beatdown with powerful singletons
// - Early game: Armored Dragon search, Luminescent revive, field presence
// - Mid game: Jagged Peak counters, Hellkite recursion, Boneflame GY pump
// - Late game: Supreme Bahamut Dragon WIN CONDITION (5 Extreme Dragons in GY)
// - Key constraint: Only 1 face-up Extreme Dragon on field at a time
// - Key constraint: Preserve Extreme Dragons in GY for Bahamut — avoid banishing them
// ─────────────────────────────────────────────────────────────────────────────

import BaseStrategy from "./BaseStrategy.js";
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
  countExtremeInGY,
  selectBestExtremeDragon,
} from "./dragon/knowledge.js";
import { COMBO_DATABASE, detectAvailableCombos } from "./dragon/combos.js";
import {
  shouldPlaySpell,
  shouldSummonMonster,
  getTributeRequirementFor as dragonGetTributeRequirementFor,
  selectBestTributes,
  evaluateTributeTrade,
} from "./dragon/priorities.js";
import { evaluateBoardDragon } from "./dragon/scoring.js";
import { simulateMainPhaseAction as simulateDragonAction } from "./dragon/simulation.js";

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
    const extremeInGY = countExtremeInGY(gyCards);
    const bahamutReady = extremeInGY >= 5;

    const analysis = {
      hand: (bot.hand || []).map((c) => ({
        name: c.name,
        cardKind: c.cardKind,
        type: c.type,
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

      canNormalSummon: (bot.summonCount || 0) < 1,
      fieldCapacity: 5 - (bot.field?.length || 0),

      // Dragon-specific
      extremeInGY,
      bahamutReady,
      hasJaggedPeak: bot.fieldSpell?.name === "Jagged Peak of the Dragons",
      jaggedPeakCounters: bot.fieldSpell?.counters?.dragon_peak || 0,

      availableCombos: [],
    };

    this.think(`📊 Dragon AI: ${bot.lp} LP vs ${opponent?.lp} LP`);
    this.think(`🃏 Hand: ${analysis.hand.map((c) => c.name).join(", ") || "empty"}`);
    this.think(`⚔️ Field: ${analysis.field.map((c) => c.name).join(", ") || "empty"}`);
    this.think(`☠️ GY Extreme Dragons: ${extremeInGY}/5${bahamutReady ? " ← BAHAMUT READY!" : ""}`);

    analysis.availableCombos = detectAvailableCombos(analysis, (msg) => this.think(msg));

    this.currentAnalysis = analysis;
    return analysis;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Macro planning
  // ─────────────────────────────────────────────────────────────────────────

  evaluateMacroStrategy(game, analysis) {
    const actualGame = game._gameRef || game;
    const bot = this.bot;
    const opponent = this.getOpponent(actualGame, bot);

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
    const opponent = this.getOpponent(actualGame, bot);

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

      const hasOncePerTurn = (card.effects || []).some((e) => e.oncePerTurn || e.oncePerTurnName);
      if (hasOncePerTurn && addedSpellNames.has(card.name)) {
        log(`  ⏭️ Skipping duplicate 1/turn spell: ${card.name}`);
        return;
      }

      // Validate activatability in real game
      if (!isSimulatedState) {
        const check = actualGame.effectEngine?.canActivate?.(card, bot);
        if (!check?.ok) return;

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

        let finalPriority = decision.priority || 5;
        const macroBuff = calculateMacroPriorityBonus("spell", card, macroStrategy);
        finalPriority += macroBuff;

        const safety = assessActionSafety({ bot, player: opponent }, bot, opponent, "spell", card);
        if (safety.recommendation === "very_risky") finalPriority -= 15;
        else if (safety.recommendation === "risky") finalPriority -= 8;

        actions.push({
          type: "spell",
          index,
          cardId: card.id,
          priority: finalPriority,
          cardName: card.name,
          macroBuff,
          safetyScore: safety.riskScore,
        });
      } else {
        log(`  ❌ Spell: ${card.name} — ${decision.reason}`);
      }
    });

    // === TRAP SET ACTIONS ===
    const canSetTrap = (bot.spellTrap || []).length < 5;
    if (canSetTrap) {
      const activatedIndices = new Set(actions.map((a) => a.index));
      (bot.hand || []).forEach((card, index) => {
        if (card.cardKind !== "trap") return;
        if (activatedIndices.has(index)) return;

        let priority = 6;

        if (card.name === "Call of the Haunted") {
          const gyMonsters = (bot.graveyard || []).filter(
            (c) => c && c.cardKind === "monster"
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
            (c) => c && c.cardKind === "monster"
          );
          priority = fieldDragons.length > 0 ? 8 : 5;
        }

        log(`  📥 Set trap: ${card.name} (priority ${priority})`);
        actions.push({
          type: "set_spell_trap",
          index,
          cardId: card.id,
          priority,
          cardName: card.name,
          reason: "setup_backrow",
        });
      });
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

          let finalPriority = decision.priority || 5;
          const macroBuff = calculateMacroPriorityBonus("summon", card, macroStrategy);
          finalPriority += macroBuff;

          const safety = assessActionSafety({ bot, player: opponent }, bot, opponent, "summon", card);
          if (safety.recommendation === "very_risky") finalPriority -= 10;

          actions.push({
            type: "summon",
            index,
            cardId: card.id,
            position: decision.position,
            facedown: decision.facedown !== undefined
              ? decision.facedown
              : decision.position === "defense",
            priority: finalPriority,
            cardName: card.name,
            macroBuff,
            safetyScore: safety.riskScore,
          });
        } else {
          log(`  ❌ Summon: ${card.name} — ${decision.reason}`);
        }
      });
    }

    // === HAND IGNITION ACTIONS ===
    // Monsters with ignition effects activatable from hand
    // (Voltaic Dragon, Hellkite Dragon, Black Bull Dragon, Purified Crystal Dragon)
    (bot.hand || []).forEach((card, index) => {
      if (card.cardKind !== "monster") return;

      const handIgnitionEffect = (card.effects || []).find(
        (e) => e && e.timing === "ignition" && e.requireZone === "hand",
      );
      if (!handIgnitionEffect) return;

      // Check if cost targets exist in field
      const targets = handIgnitionEffect.targets || [];
      const costTarget = targets.find((t) => t.zone === "field");
      if (costTarget) {
        const fieldCards = bot.field || [];
        const hasValidCost = fieldCards.some((fieldCard) => {
          if (fieldCard.cardKind !== "monster") return false;
          if (costTarget.cardName && fieldCard.name !== costTarget.cardName) return false;
          if (costTarget.archetype && fieldCard.archetype !== costTarget.archetype) return false;
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

        // Purified Crystal Dragon: avoid banishing Extreme Dragons if building Bahamut
        if (card.name === "Purified Crystal Dragon") {
          const { extremeInGY } = analysis;
          const nonExtremeInGY = gyMatches.filter((c) => !isExtremeDragon(c));
          if (nonExtremeInGY.length < minCount) {
            // Would have to banish Extreme Dragons
            if (extremeInGY >= 3) {
              // Too important for Bahamut
              log(`  ⏭️ Purified Crystal: would banish Extreme Dragons needed for Bahamut (${extremeInGY} in GY)`);
              return;
            }
          }
        }
      }

      // Check once-per-turn
      if (!isSimulatedState && actualGame.effectEngine) {
        const optCheck = actualGame.effectEngine.checkOncePerTurn(card, bot, handIgnitionEffect);
        if (!optCheck?.ok) {
          log(`  ⏭️ Hand ignition ${card.name}: already used this turn`);
          return;
        }
      }

      if (analysis.fieldCapacity <= 0 && !gyCostTarget) {
        // Might be trying to SS itself — check field capacity
        log(`  ⏭️ Hand ignition ${card.name}: field full`);
        return;
      }

      // Calculate priority
      let priority = 7;

      if (card.name === "Hellkite Dragon") {
        // Only worthwhile if there's a field Dragon weaker than Hellkite (2300) to sacrifice
        const fieldDragons = (bot.field || []).filter(
          (c) => c && c.cardKind === "monster" && c.type === "Dragon"
        );
        const hasCheapCost = fieldDragons.some((c) => (c.atk || 0) < (card.atk || 2300));
        if (!hasCheapCost) {
          log(`  ⏭️ Hand ignition: Hellkite Dragon — all field Dragons (${fieldDragons.map((c) => `${c.name} ${c.atk}`).join(", ")}) are >= Hellkite's 2300 ATK (bad trade)`);
          return;
        }
        priority = 8;
        log(`  ✅ Hand ignition: Hellkite Dragon → 2300 ATK, GY setup`);
      } else if (card.name === "Voltaic Dragon") {
        priority = 7;
        log(`  ✅ Hand ignition: Voltaic Dragon → free body on field`);
      } else if (card.name === "Black Bull Dragon") {
        // Only if we have enough discard fodder
        const handDragons = (bot.hand || []).filter(
          (c) => c.type === "Dragon" && c.name !== "Black Bull Dragon"
        );
        if (handDragons.length >= 2) {
          priority = 9;
          log(`  ✅ Hand ignition: Black Bull Dragon → 2500 ATK (discard 2 Dragons)`);
        } else {
          log(`  ⏭️ Hand ignition: Black Bull Dragon — insufficient hand Dragons to discard`);
          return;
        }
      } else if (card.name === "Purified Crystal Dragon") {
        priority = 8;
        log(`  ✅ Hand ignition: Purified Crystal Dragon → 2500 ATK (banish GY Dragons)`);
      } else {
        log(`  ✅ Hand ignition: ${card.name}`);
      }

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
      });
    });

    // === SPELL/TRAP-ZONE IGNITION ACTIONS ===
    // Face-up continuous spells with ignition effects (e.g. Extreme Dragon Awakening).
    (bot.spellTrap || []).forEach((card, zoneIndex) => {
      if (!card || card.isFacedown || card.cardKind !== "spell") return;
      const ignition = (card.effects || []).find(
        (e) => e && e.timing === "ignition" && e.requireZone === "spellTrap"
      );
      if (!ignition) return;

      if (!isSimulatedState && actualGame.effectEngine) {
        const opt = actualGame.effectEngine.checkOncePerTurn(card, bot, ignition);
        if (!opt?.ok) return;
      }

      if (card.name === "Extreme Dragon Awakening") {
        const fieldDragons = (bot.field || []).filter(
          (c) => c?.cardKind === "monster" && !c.isFacedown && c.type === "Dragon"
        );
        const nonExtreme = fieldDragons.filter((c) => !isExtremeDragon(c));
        const extremeInHand = (bot.hand || []).filter((c) => isExtremeDragon(c));
        const hasExtremeFaceup = fieldDragons.some(isExtremeDragon);
        if (nonExtreme.length < 2 || extremeInHand.length === 0 || hasExtremeFaceup) return;

        const oppStrongest = (opponent?.field || []).reduce(
          (m, c) => Math.max(m, c.atk || 0),
          0
        );
        const bestExtreme = selectBestExtremeDragon(extremeInHand, analysis);
        let priority = 12;
        if ((bestExtreme?.atk || 0) > oppStrongest) priority = 14;

        if (
          analysis.canNormalSummon &&
          (bot.hand || []).some(
            (c) => c.name === "Armored Dragon" || c.name === "Luminescent Dragon"
          )
        ) {
          priority += 1;
        }

        log(
          `  ✅ Awakening ignition: SS ${bestExtreme?.name} via 2 Dragon cost (priority ${priority})`
        );
        actions.push({
          type: "spellTrapEffect",
          zoneIndex,
          cardId: card.id,
          cardName: card.name,
          priority,
          effectId: ignition.id,
        });
      }
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
            isCriticalFallback: true,
          });
        });
      }
    }

    log(`  📋 Total actions generated: ${actions.length}`);
    return actions;
  }
}
