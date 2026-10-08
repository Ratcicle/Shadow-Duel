/** Category adapters preserve Shadow-Heart policy order and candidate metadata. */
import type ShadowHeartStrategy from "../ShadowHeartStrategy.js";
import type { AIAction, AIActionOf, AIState, AIStrategyBotPort, AIActivationContext } from "../../contracts/ai.js";
import type { SimulatedCardState, SimulatedPlayerState } from "../../contracts/aiState.js";
import type { GameCard } from "../../contracts/cards.js";
import type { PreviewGamePort, PreviewGuardResult } from "../common/previewGuards.js";
import { validateHandIgnitionCandidate } from "../common/actionValidation.js";
import { applyMacroAndSafety, buildPrioritizedAction, getGenericGraveyardSpellTrapActions, getGenericHandSpellActions, getGenericNormalSummonActions, getGenericIgnitionEffectActions } from "../common/actionGeneration.js";
import { getGenericSetBackrowActions } from "../common/backrowPlanning.js";
import { withFusionPreferences } from "../common/fusionPlanning.js";
import { calculateMacroPriorityBonus } from "../MacroPlanning.js";
import { evaluateActionBlockingRisk, assessActionSafety } from "../ChainAwareness.js";
import { fieldHasTributeValue } from "../../game/summon/tributeValue.js";
import { CARD_KNOWLEDGE, isShadowHeart, isShadowHeartByName } from "./knowledge.js";
import { shouldPlaySpell, shouldSummonMonster, evaluateTributeTrade, getTributeRequirementFor, buildShadowHeartCostPreferences, buildShadowHeartTargetPreferences, evaluateShadowHeartFusionPlan, pickInfusionEmergencyRevive, evaluateCathedralActivation, estimateShadowHeartCathedralCounterGain } from "./priorities.js";
import { buildShadowHeartPlanningProfile, applyShadowHeartCandidateRetention } from "./linePlanning.js";

type StrategyCard = (GameCard | SimulatedCardState) & { cannotBeDestroyedByBattle?: boolean | undefined };
type PolicyAnalysis = NonNullable<Parameters<typeof shouldPlaySpell>[1]>;
type ShadowGamePort = PreviewGamePort & { canActivatePolymerization?(): boolean; devModeEnabled?: boolean };
type StrategyGame = Parameters<ShadowHeartStrategy["generateMainPhaseActions"]>[0];
type CounterCard = { getCounter?(key: string): number; counters?: Map<string, number> | Record<string, number>; counter?: Map<string, number> | Record<string, number> };

const COURT_OF_THE_DEAD = "Court of the Dead";
const COURT_REVIVE_TARGET_ID = "court_revive_target";

function getCounterValue(card: CounterCard | null | undefined, counterType: string) {
  if (!card || !counterType) return 0;
  if (typeof card.getCounter === "function") return card.getCounter(counterType) || 0;
  const counters = card.counters || card.counter || null;
  if (!counters) return 0;
  if (counters instanceof Map) return counters.get(counterType) || 0;
  return counters[counterType] || 0;
}

function getCourtReviveCandidates(bot: AIStrategyBotPort, opponent: AIStrategyBotPort | null) {
  return [
    ...(bot?.graveyard || []),
    ...(opponent?.graveyard || []),
  ].filter((card) => card?.cardKind === "monster" && !card.cannotBeSpecialSummoned);
}

function rankCourtReviveTargetNames(bot: AIStrategyBotPort, opponent: AIStrategyBotPort | null) {
  const bossNames = new Set([
    "Shadow-Heart Scale Dragon",
    "Shadow-Heart Demon Arctroth",
    "Shadow-Heart Death Wyrm",
    "Shadow-Heart Demon Dragon",
    "Shadow-Heart Arctroth Pursuer",
    "Shadow-Heart Warlord",
    "Shadow-Heart Devastation Dragon",
  ]);
  return getCourtReviveCandidates(bot, opponent)
    .map((card) => {
      let score = Math.max(card.atk || 0, card.def || 0);
      if (isShadowHeartByName(card.name)) score += 500;
      if (bossNames.has(card.name!)) score += 900;
      return { name: card.name, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.name)
    .filter((name, index, names) => name && names.indexOf(name) === index);
}

function buildCourtActivationContext(card: StrategyCard, bot: AIStrategyBotPort, opponent: AIStrategyBotPort | null): AIActivationContext {
  const preferredNames = rankCourtReviveTargetNames(bot, opponent);
  return {
    sourceZone: "spellTrap",
    activationZone: "spellTrap",
    trapActivationFromSet: card?.cardKind === "trap" && card.isFacedown === true,
    autoSelectTargets: true,
    autoSelectSingleTarget: true,
    actionContext: {
      targetPreferences: {
        [COURT_REVIVE_TARGET_ID]: {
          role: "named_preference",
          purpose: "offense",
          preferredNames,
        },
      },
    },
  };
}

function canActivateShadowHeartSpell(game: AIState, card: StrategyCard, bot: AIStrategyBotPort, activationContext: AIActivationContext = {}) {
  if (!game || game._isPerspectiveState === true) return { ok: true };
  const actualGame = (game._gameRef || game) as ShadowGamePort;

  if (
    actualGame.effectEngine &&
    typeof actualGame.effectEngine.canActivateSpellFromHandPreview === "function"
  ) {
    return actualGame.effectEngine.canActivateSpellFromHandPreview(card, bot, {
      activationContext,
    });
  }

  if (actualGame.effectEngine && typeof actualGame.effectEngine.canActivate === "function") {
    return actualGame.effectEngine.canActivate(card, bot);
  }

  return { ok: true };
}

function withShadowHeartFusionPreferences(baseContext: AIActivationContext, card: StrategyCard, analysis: PolicyAnalysis): AIActivationContext {
  if (card?.name !== "Polymerization") return baseContext;
  const fusionPlan = evaluateShadowHeartFusionPlan(analysis);
  if (!fusionPlan?.targetName) return baseContext;
  return withFusionPreferences(baseContext as Parameters<typeof withFusionPreferences>[0], {
    target: fusionPlan.targetName,
    priority: fusionPlan.actionPriority,
    reason: fusionPlan.reason,
    plan: fusionPlan,
  }) as AIActivationContext;
}

function buildShadowHeartSpellActivationContext(card: StrategyCard, bot: AIStrategyBotPort, opponent: AIStrategyBotPort | null, analysis: PolicyAnalysis) {
  const costPreferences = buildShadowHeartCostPreferences(analysis) as ReturnType<typeof buildShadowHeartCostPreferences> & { forceNames?: Array<string | undefined> };

  if (card?.name === "Shadow-Heart Infusion") {
    // Always force a SH monster from hand into the discards so SSZ always finds
    // a valid GY target regardless of:
    //   a) DV/triggers claiming the GY monster before activation resolves
    //   b) AutoSelector picking all-spell discards when GY had no SH monster
    const hand = analysis?.hand || [];
    const nonInfusionHand = hand.filter(
      (c) => c?.name !== "Shadow-Heart Infusion",
    );
    const reviveMonster = pickInfusionEmergencyRevive(nonInfusionHand, analysis);
    if (reviveMonster) {
      const secondPool = nonInfusionHand.filter(
        (c) => c?.name !== reviveMonster.name,
      );
      const secondDiscard =
        secondPool.length > 0
          ? secondPool.slice().sort(
              (a, b) =>
                (CARD_KNOWLEDGE[a?.name!]?.value || 0) -
                (CARD_KNOWLEDGE[b?.name!]?.value || 0),
            )[0]
          : null;
      costPreferences.forceNames = secondDiscard
        ? [reviveMonster.name, secondDiscard.name]
        : [reviveMonster.name];
      const toPreserve = ["Polymerization"];
      if (reviveMonster.name !== "Shadow-Heart Scale Dragon") {
        toPreserve.push("Shadow-Heart Scale Dragon");
      }
      costPreferences.preserveNames = [
        ...new Set([
          ...(costPreferences.preserveNames || []).filter(
            (n) => !costPreferences.forceNames!.includes(n as string),
          ),
          ...toPreserve,
        ]),
      ];
      if (bot?.debug || analysis?.game?.devModeEnabled) {
        console.log(
          `[ShadowHeart Infusion] Forçando descarte: ${reviveMonster.name}` +
            `${secondDiscard ? ` + ${secondDiscard.name}` : ""}`,
        );
      }
    }
    // No hand SH monster: rely on GY having one (shouldPlaySpell validated this).
    // AutoSelector picks cheapest 2 hand cards; GY monster stays intact.
  }
  const strategicPreferences = buildShadowHeartTargetPreferences(
    card,
    (card?.effects || [])[0] || null,
    analysis,
  );
  const actionContext = {
    costPreferences,
    targetPreferences: strategicPreferences.targetPreferences,
    specialSummonPositions: strategicPreferences.specialSummonPositions,
  };

  if (card?.name !== "Shadow-Heart Purge") {
    return withShadowHeartFusionPreferences({
      autoSelectTargets: true,
      autoSelectSingleTarget: true,
      actionContext,
    }, card, analysis);
  }

  const attackers = (bot?.field || []).filter(
    (monster) =>
      monster &&
      monster.cardKind === "monster" &&
      isShadowHeart(monster) &&
      !monster.isFacedown &&
      monster.position === "attack" &&
      !monster.cannotAttackThisTurn &&
      !monster.hasAttacked,
  );

  return withShadowHeartFusionPreferences({
    autoSelectSingleTarget: true,
    logTargets: false,
    actionContext: {
      ...actionContext,
      targetPreferences: {
        purge_target_monster: {
          role: "temporary_stat_debuff",
          purpose: "combat",
          attackers,
          opponentLp: opponent?.lp || 0,
          atkReduction: 1000,
          defReduction: 0,
        },
      },
    },
  }, card, analysis);
}


export function generateShadowHeartMainPhaseActions(this: ShadowHeartStrategy, game: StrategyGame): AIAction[] {
  const analysis = this.analyzeGameState(game);
  const actions: AIAction[] = [];

  // FIDELIDADE: Usar bot do game/state para simulação correta
  const isSimulatedState = game._isPerspectiveState === true;
  const bot = (isSimulatedState ? game.bot : this.bot || game.bot) as AIStrategyBotPort;
  const actualGame = (game._gameRef || game) as ShadowGamePort;
  const opponent = this.getOpponent(actualGame as AIState, bot);

  // Logging reduzido em simulação para performance
  const shouldLog = !isSimulatedState;
  const log = (msg: string) => shouldLog && this.think(msg);

  log(`\n🧠 Gerando ações possíveis...`);

  // === P1: MACRO PLANNING ===
  const macroStrategy = this.evaluateMacroStrategy(game, analysis);
  log(
    `  📊 Macro Strategy: ${macroStrategy.strategy} (Priority: ${macroStrategy.priority})`,
  );

  // === P1: CHAIN AWARENESS ===
  const chainRisks = {
    spell: evaluateActionBlockingRisk(
      { bot, player: opponent },
      bot,
      opponent,
      "spell",
    ),
    summon: evaluateActionBlockingRisk(
      { bot, player: opponent },
      bot,
      opponent,
      "summon",
    ),
    attack: evaluateActionBlockingRisk(
      { bot, player: opponent },
      bot,
      opponent,
      "attack",
    ),
  };

  // === PRIORIDADE 1: COMBOS DE ALTA PRIORIDADE ===
  for (const combo of analysis.availableCombos.sort(
    (a, b) => b.priority! - a.priority!,
  )) {
    log(
      `  📌 Considerando combo: ${combo.name} (prioridade ${combo.priority})`,
    );
  }

  // === GERAR AÇÕES DE SPELL ===
  // Em simulação, não verificar canActivate (não temos effectEngine)
  // Track spells already added to avoid duplicates (for 1/turn effects)
  const addedSpellNames = new Set();

  let spellCandidate: AIActionOf<"spell"> | null = null;
  const decideSpell = (card: StrategyCard, index: number): AIActionOf<"spell"> | null => {
    if (card.cardKind !== "spell") return null;

    // BUGFIX: Só adicionar uma cópia de cada spell (evitar duplicatas com 1/turn)
    // Spells com efeitos 1/turn não devem ter múltiplas ações geradas
    const hasOncePerTurn = (card.effects || []).some(
      (e) => e.oncePerTurn || e.oncePerTurnName,
    );
    if (hasOncePerTurn && addedSpellNames.has(card.name)) {
      log(`  ⏭️ Skipping duplicate 1/turn spell: ${card.name}`);
      return null;
    }

    // Só verificar canActivate em game real (não simulado)
    const activationContext = buildShadowHeartSpellActivationContext(
      card,
      bot,
      opponent,
      analysis,
    );

    if (!isSimulatedState) {
      const actualGame = (game._gameRef || game) as ShadowGamePort;
      const check = canActivateShadowHeartSpell(
        game,
        card,
        bot,
        activationContext,
      );
      if (!(check as PreviewGuardResult | null | undefined)?.ok) return null;

      // VALIDAÇÃO EXTRA: Polymerization requer materiais válidos
      if (card.name === "Polymerization") {
        const canActivate = actualGame.canActivatePolymerization?.() ?? false;
        if (!canActivate) {
          log(`  ⚠️ Polymerization bloqueado: sem materiais válidos`);
          return null;
        }
      }
    }

    const decision = shouldPlaySpell(card, analysis);
    if (
      card.name === "Shadow-Heart Cathedral" &&
      (bot?.debug || actualGame?.devModeEnabled)
    ) {
      const predicted = estimateShadowHeartCathedralCounterGain(analysis);
      console.log(
        `[ShadowHeart Cathedral] hand=true predicted=${predicted.count} ` +
          `decision=${decision.yes ? "place" : "hold"} reason=${decision.reason}`,
      );
    }

    if (decision.yes) {
      log(`  ✅ Spell válida: ${card.name} - ${decision.reason}`);

      // Mark spell as added if it has 1/turn effect
      if (hasOncePerTurn) {
        addedSpellNames.add(card.name);
      }

      let offensiveBonus = 0;
      const offensivePlan =
        (activationContext?.actionContext as { costPreferences?: ReturnType<typeof buildShadowHeartCostPreferences> } | undefined)?.costPreferences?.offensivePlan;
      if (offensivePlan?.hasMajorSwing) {
        if (card.name === "Shadow-Heart Purge" && offensivePlan.purgeWindow) {
          offensiveBonus += 5;
        } else if (
          card.name === "Shadow-Heart Battle Hymn" &&
          (offensivePlan.battleHymnLethal || offensivePlan.attackers?.length >= 2)
        ) {
          offensiveBonus += offensivePlan.battleHymnLethal ? 7 : 3;
        } else if (card.name === "Shadow-Heart Rage" && offensivePlan.rageLive) {
          offensiveBonus += 7;
        } else if (card.name === "Polymerization" && offensivePlan.fusionNear) {
          offensiveBonus += 4;
        }
      }

      const spellSafety = assessActionSafety(
        { bot, player: opponent },
        bot,
        opponent,
        "spell",
        card,
      );
      const { priority: finalPriority, macroBuff, safetyScore } =
        applyMacroAndSafety({
          basePriority: decision.priority! + offensiveBonus,
          actionType: "spell",
          card,
          macroStrategy,
          safety: spellSafety,
          macroBonusFn: calculateMacroPriorityBonus,
          safetyPolicy: {
            very_risky: -15,
            risky: -8,
          },
        });
      if (spellSafety.recommendation === "very_risky") {
        log(`    ⚠️  Very risky (chain blocking): -15 priority`);
      }

      return buildPrioritizedAction({
          type: "spell",
          index,
          card,
          priority: finalPriority,
          activationContext,
          extra: {
            macroBuff,
            safetyScore,
          },
        });
    } else {
      log(`  ❌ Spell descartada: ${card.name} - ${decision.reason}`);
    }
    return null;
  };
  actions.push(...getGenericHandSpellActions({
    game, player: bot, analysis,
    shouldPlay: (card, _analysis, context) => {
      spellCandidate = decideSpell(card, context.index);
      return { yes: spellCandidate !== null, priority: spellCandidate?.priority };
    },
    buildActivationContext: () => spellCandidate?.activationContext || null,
    extra: () => spellCandidate || {},
  }));

  const usedHandIndices = new Set(
    actions
      .filter((action) => Number.isInteger(action.index))
      .map((action) => action.index),
  );
  const courtSetActions = getGenericSetBackrowActions({
    bot,
    game,
    opponent,
    analysis,
    alreadyUsedHandIndices: usedHandIndices,
    basePriority: 7,
    defaultReason: "setup_court_of_the_dead",
    policy: {
      acceptsCard: (card) => card?.cardKind === "trap",
      skipIfAlreadySet: (card) =>
        card?.name === COURT_OF_THE_DEAD &&
        (bot.spellTrap || []).some((setCard) => setCard?.name === COURT_OF_THE_DEAD),
      shouldSet: (card) =>
        card?.name === COURT_OF_THE_DEAD
          ? { yes: true, priority: 10, reason: "set Court of the Dead engine" }
          : false,
      getPriority: (_card, { setDecision }) => (setDecision as { priority?: number } | undefined)?.priority || 7,
      getReason: (_card, { setDecision }) => (setDecision as { reason?: string } | undefined)?.reason || "setup_court_of_the_dead",
    },
  });
  actions.push(...courtSetActions);

  // === GERAR AÇÕES DE SUMMON ===
  let normalCandidate: AIActionOf<"summon"> | null = null;
  const decideNormal = (card: StrategyCard, index: number): AIActionOf<"summon"> | null => {
      if (card.cardKind !== "monster") return null;

      const tributeInfo = this.getTributeRequirementFor(card, bot);
      if (!fieldHasTributeValue(bot.field || [], tributeInfo.tributesNeeded, card)) return null;
      if (analysis.fieldCapacity <= 0 && tributeInfo.tributesNeeded <= 0) return null;

      const decision = shouldSummonMonster(card, analysis, tributeInfo, {
        field: bot.field || [],
        oppField: opponent?.field || [],
      });

      if (decision.yes) {
        log(`  ✅ Summon válido: ${card.name} - ${decision.reason}`);

        let offensiveBonus = 0;
        const offensivePlan = buildShadowHeartCostPreferences(analysis).offensivePlan;
        if (
          card.name === "Shadow-Heart Scale Dragon" &&
          offensivePlan?.hasMajorSwing
        ) {
          offensiveBonus += 3;
        }

        const summonSafety = assessActionSafety(
          { bot, player: opponent },
          bot,
          opponent,
          "summon",
          card,
        );
        const { priority: finalPriority, macroBuff, safetyScore } =
          applyMacroAndSafety({
            basePriority: decision.priority! + offensiveBonus,
            actionType: "summon",
            card,
            macroStrategy,
            safety: summonSafety,
            macroBonusFn: calculateMacroPriorityBonus,
            safetyPolicy: {
              very_risky: -10,
            },
          });

        return buildPrioritizedAction({
            type: "summon",
            index,
            card,
            priority: finalPriority,
            extra: {
              position: decision.position as "attack" | "defense" | undefined,
              // Respect explicit facedown decision from priorities.js
              // Default to facedown only if position is defense AND no explicit decision
              facedown:
                (decision as typeof decision & { facedown?: boolean }).facedown !== undefined
                  ? (decision as typeof decision & { facedown?: boolean }).facedown
                  : decision.position === "defense",
              macroBuff,
              safetyScore,
            },
          });
      }
    return null;
  };
  actions.push(...getGenericNormalSummonActions({
    player: bot, analysis,
    getTributeRequirement: (card, player) => this.getTributeRequirementFor(card, player),
    shouldSummon: (card, _analysis, context) => {
      normalCandidate = decideNormal(card, bot.hand.indexOf(card));
      return { yes: normalCandidate !== null, priority: normalCandidate?.priority };
    },

    extra: () => normalCandidate || {},
  }));

  // === GERAR AÇÕES DE IGNITION DA MÃO ===
  // Monstros com efeito ignition ativável da mão (ex: Leviathan)
  let handIgnitionCandidate: AIActionOf<"handIgnition"> | null = null;
  const decideHandIgnition = (card: StrategyCard, index: number): AIActionOf<"handIgnition"> | null => {
    if (card.cardKind !== "monster") return null;

    // Verificar se o monstro tem efeito ignition ativável da mão.
    const handIgnitionEffect = (card.effects || []).find(
      (e) =>
        e && e.timing === "ignition" && e.activationZones?.includes("hand"),
    );
    if (!handIgnitionEffect) return null;

    // Verificar se pode ativar (tem alvos válidos no campo)
    // Para Leviathan: precisa de Abyssal Eel no campo
    const validation = validateHandIgnitionCandidate({
      card,
      effect: handIgnitionEffect,
      player: bot,
      game: actualGame as NonNullable<Parameters<typeof validateHandIgnitionCandidate>[0]>["game"],
      isSimulatedState,
      activationContext: {
        actionContext: {
          costPreferences: buildShadowHeartCostPreferences(analysis),
        },
      },
    });
    if (!validation.ok) {
      log(
        `  Hand ignition ${card.name}: ${
          validation.reason || "blocked"
        }`,
      );
      return null;
    }

    // Calcular prioridade baseada no valor do monstro
    let priority = 8; // Base alta para efeitos que geram vantagem

    // Bonus se for combo conhecido (Eel -> Leviathan)
    if (card.name === "Shadow-Heart Leviathan") {
      priority = 9; // Combo forte: 2200 ATK + burn
      log(`  ✅ Hand ignition: ${card.name} (Eel -> Leviathan combo)`);
    } else {
      log(`  ✅ Hand ignition: ${card.name}`);
    }

    const macroBuff = calculateMacroPriorityBonus(
      "handIgnition",
      card,
      macroStrategy,
    );
    priority += macroBuff;

    return {
      type: "handIgnition",
      index,
      cardId: card.id,
      priority,
      cardName: card.name,
      effectId: handIgnitionEffect.id,
      macroBuff,
    };
  };
  actions.push(...getGenericIgnitionEffectActions({
    game, player: bot, analysis, cards: bot.hand, type: "handIgnition", sourceZone: "hand",
    cardFilter: card => card.cardKind === "monster",
    findEffect: card => card.effects?.find(effect => effect.timing === "ignition" && effect.activationZones?.includes("hand")) || null,
    shouldActivate: (card, _analysis, context) => {
      handIgnitionCandidate = decideHandIgnition(card, context.sourceIndex);
      return { yes: handIgnitionCandidate !== null, priority: handIgnitionCandidate?.priority };
    },
    buildActivationContext: () => handIgnitionCandidate?.activationContext || null,
    extra: () => handIgnitionCandidate || {},
  }));

  // === GERAR EFEITOS DE CONTINUOUS SPELL/TRAP EM CAMPO ===
  let spellTrapCandidate: AIActionOf<"spellTrapEffect"> | null = null;
  const decideSpellTrap = (card: StrategyCard, zoneIndex: number): AIActionOf<"spellTrapEffect"> | null => {
    if (!card || (card.cardKind !== "spell" && card.cardKind !== "trap")) return null;
    const isSetCourt = card.name === COURT_OF_THE_DEAD && card.isFacedown === true;
    if (card.isFacedown && !isSetCourt) return null;
    const ignitionEffect = (card.effects || []).find(
      (effect) => effect && effect.timing === "ignition",
    );

    if (card.name === COURT_OF_THE_DEAD) {
      const courtActivationContext = buildCourtActivationContext(card, bot, opponent);
      if (card.isFacedown) {
        if (!isSimulatedState) {
          const check = actualGame.effectEngine?.canActivateSpellTrapEffectPreview?.(
            card,
            bot,
            "spellTrap",
            null,
            { activationContext: courtActivationContext },
          );
          if ((check as PreviewGuardResult | null | undefined)?.ok === false) return null;
        }
        return {
          type: "spellTrapEffect",
          zoneIndex,
          cardId: card.id,
          cardName: card.name,
          priority: 10,
          activationContext: courtActivationContext,
        };
        return null;
      }

      const counters = getCounterValue(card, "funeral");
      const reviveCandidates = getCourtReviveCandidates(bot, opponent);
      if (!ignitionEffect || counters < 8 || reviveCandidates.length === 0 || (bot.field || []).length >= 5) {
        return null;
      }
      if (!isSimulatedState) {
        const check = actualGame.effectEngine?.canActivateSpellTrapEffectPreview?.(
          card,
          bot,
          "spellTrap",
          null,
          { activationContext: courtActivationContext },
        );
        if ((check as PreviewGuardResult | null | undefined)?.ok === false) return null;
      }
      return {
        type: "spellTrapEffect",
        zoneIndex,
        cardId: card.id,
        cardName: card.name,
        priority: 14,
        effectId: ignitionEffect.id,
        activationContext: courtActivationContext,
      };
    }

    if (card.cardKind !== "spell" || card.isFacedown) return null;
    if (!ignitionEffect) return null;

    if (card.name === "Shadow-Heart Cathedral") {
      const cathedralPlan = evaluateCathedralActivation(card, analysis);
      const predicted = estimateShadowHeartCathedralCounterGain(analysis);
      if (bot?.debug || actualGame?.devModeEnabled) {
        const candidateText = (cathedralPlan.candidateScores || [])
          .map(
            (entry) =>
              `${entry.name}:${entry.score} (${entry.plan || "no plan"})`,
          )
          .join(" | ");
        console.log(
          `[ShadowHeart Cathedral] field=true counters=${cathedralPlan.counterCount || 0} ` +
            `predicted=${predicted.count} target=${
              cathedralPlan.target?.name || "none"
            } specialTrigger=${!!cathedralPlan.hasRelevantSpecialTrigger} ` +
            `candidates=[${candidateText || (cathedralPlan.candidateNames || []).join(", ") || "none"}] ` +
            `plan=${cathedralPlan.expectedPlan || "none"} ` +
            `decision=${cathedralPlan.shouldActivate ? "use" : "hold"} reason=${
              cathedralPlan.reason
            }`,
        );
      }
      if (!cathedralPlan.shouldActivate) {
        log(`  ⏭️ Cathedral segura: ${cathedralPlan.reason}`);
        return null;
      }

      if (!isSimulatedState) {
        const check =
          actualGame.effectEngine?.canActivateSpellTrapEffectPreview?.(
            card,
            bot,
            "spellTrap",
          );
        if ((check as PreviewGuardResult | null | undefined)?.ok === false) {
          log(`  ⏭️ Cathedral bloqueada: ${(check as PreviewGuardResult).reason}`);
          return null;
        }
      }

      log(
        `  ✅ Cathedral effect: ${cathedralPlan.target?.name || "target"} ` +
          `(${cathedralPlan.reason})`,
      );
      return {
        type: "spellTrapEffect",
        zoneIndex,
        cardId: card.id,
        cardName: card.name,
        priority: cathedralPlan.priority,
        effectId: ignitionEffect.id,
        cathedralPlan: {
          targetName: cathedralPlan.target?.name || null,
          counterCount: cathedralPlan.counterCount || 0,
          reason: cathedralPlan.reason,
          expectedPlan: cathedralPlan.expectedPlan || null,
          candidateNames: cathedralPlan.candidateNames || [],
          candidateScores: cathedralPlan.candidateScores || [],
        },
        activationContext: {
          sourceZone: "spellTrap",
          actionContext: {
            cathedral: {
              counterCount: cathedralPlan.counterCount || 0,
              predictedCounters: predicted.count,
              targetName: cathedralPlan.target?.name || null,
              reason: cathedralPlan.reason,
              expectedPlan: cathedralPlan.expectedPlan || null,
              candidateNames: cathedralPlan.candidateNames || [],
              candidateScores: cathedralPlan.candidateScores || [],
            },
          },
        },
      };
    }

    if (!isSimulatedState) {
      const check = actualGame.effectEngine?.canActivateSpellTrapEffectPreview?.(
        card,
        bot,
        "spellTrap",
      );
      if ((check as PreviewGuardResult | null | undefined)?.ok === false) return null;
    }

    return {
      type: "spellTrapEffect",
      zoneIndex,
      cardId: card.id,
      cardName: card.name,
      priority: 5,
      effectId: ignitionEffect.id,
    };
  };
  actions.push(...getGenericIgnitionEffectActions({
    game, player: bot, analysis, cards: bot.spellTrap, type: "spellTrapEffect", sourceZone: "spellTrap", indexFields: ["zoneIndex"],
    cardFilter: card => (card.cardKind === "spell" || card.cardKind === "trap") && (!card.isFacedown || card.name === COURT_OF_THE_DEAD),
    findEffect: card => card.effects?.find(effect => effect.timing === "ignition") || null,
    shouldActivate: (card, _analysis, context) => {
      spellTrapCandidate = decideSpellTrap(card, context.sourceIndex);
      return { yes: spellTrapCandidate !== null, priority: spellTrapCandidate?.priority };
    },
    buildActivationContext: () => spellTrapCandidate?.activationContext || null,
    extra: () => spellTrapCandidate || {},
  }));

  actions.push(...getGenericGraveyardSpellTrapActions(game, bot));

  // === STALEMATE BREAKER ===
  // Se não há ações e há capacidade de campo, forçar summon mesmo que já tenha invocado
  // Isso evita que o jogo fique travado quando o bot acumula cartas na mão
  // BUGFIX: Skip durante simulação (BeamSearch lookahead) - não é um stalemate real
  // BUGFIX: Só ativar se summon ainda está disponível (evita tentar invocar em Main2 após já ter invocado)
  if (
    actions.length === 0 &&
    !isSimulatedState &&
    analysis.canNormalSummon
  ) {
    // CRITICAL: Usar estado REAL (this.bot) para fallback, não simulado
    const realBot = this.bot || bot;

    // Log para debug
    if (bot?.debug) {
      console.log(
        `[ShadowHeartStrategy] ⚠️ STALEMATE BREAKER ativado! Hand=${realBot.hand?.length}, Field=${realBot.field?.length}`,
      );
    }
    log(`  ⚠️ STALEMATE BREAKER: Forçando summon alternativo...`);
    let monstersChecked = 0;
    let monstersBlocked = 0;

    let FallbacknormalCandidate: AIActionOf<"summon"> | null = null;
    const decideFallbackNormal = (card: StrategyCard, index: number): AIActionOf<"summon"> | null => {
      if (card.cardKind !== "monster") return null;
      monstersChecked++;

      const tributeInfo = this.getTributeRequirementFor(card, realBot);
      if (!fieldHasTributeValue(realBot.field || [], tributeInfo.tributesNeeded, card)) {
        monstersBlocked++;
        if (bot?.debug) {
          console.log(
            `[ShadowHeartStrategy] ❌ ${card.name} requer ${
              tributeInfo.tributesNeeded
            } tributos (tenho ${realBot.field?.length || 0})`,
          );
        }
        log(
          `    ❌ ${card.name} requer ${
            tributeInfo.tributesNeeded
          } tributos (tenho ${realBot.field?.length || 0})`,
        );
        return null;
      }
      if (analysis.fieldCapacity <= 0 && tributeInfo.tributesNeeded <= 0) {
        return null;
      }

      if (tributeInfo.tributesNeeded > 0) {
        const tradeCheck = evaluateTributeTrade(
          card,
          realBot.field || [],
          tributeInfo.tributesNeeded,
          { oppField: opponent?.field || [] },
        );
        if (!tradeCheck.ok) {
          if (bot?.debug) {
            console.log(
              `[ShadowHeartStrategy] ❌ Tribute ruim: ${card.name} (${tradeCheck.reason})`,
            );
          }
          log(`    ❌ Tribute ruim: ${card.name} (${tradeCheck.reason})`);
          return null;
        }
      }

      // Forcar summon com prioridade baixa. Cartas com remocao ao invocar
      // precisam entrar face-up, ou o fallback desperdiça o proprio payoff.
      const mustResolveOnSummonFaceUp =
        this.cardClearsOpponentBoardOnSummon(card);
      const fallbackPosition = mustResolveOnSummonFaceUp
        ? "attack"
        : "defense";
      const fallbackFacedown = fallbackPosition === "defense";

      if (bot?.debug) {
        console.log(
          `[ShadowHeartStrategy] 🔧 Fallback summon: ${card.name} em ${fallbackPosition}`,
        );
      }
      log(`    🔧 Fallback summon: ${card.name} em ${fallbackPosition}`);
      return {
        type: "summon",
        index,
        cardId: card.id,
        position: fallbackPosition,
        facedown: fallbackFacedown,
        priority: 1,
        cardName: card.name,
        isStalemateBreaker: true,
      };

    };
    actions.push(...getGenericNormalSummonActions({
      player: realBot, analysis,
      getTributeRequirement: (card, player) => this.getTributeRequirementFor(card, player),
      shouldSummon: (card, _analysis, context) => {
        FallbacknormalCandidate = decideFallbackNormal(card, realBot.hand.indexOf(card));
        return { yes: FallbacknormalCandidate !== null, priority: FallbacknormalCandidate?.priority };
      },

      extra: () => FallbacknormalCandidate || {},
    }));

    if (monstersChecked > 0 && monstersBlocked === monstersChecked) {
      if (bot?.debug) {
        console.log(
          `[ShadowHeartStrategy] ⚠️ Todos ${monstersChecked} monstros na mão requerem tributos!`,
        );
      }
      log(
        `  ⚠️ Todos ${monstersChecked} monstros na mão requerem tributos! Tentando spells...`,
      );
    }
  }

  // === FALLBACK SECUNDÁRIO: Forçar qualquer spell se ainda não há ações ===
  // BUGFIX: Skip durante simulação (BeamSearch lookahead) - usar lógica normal
  if (actions.length === 0 && !isSimulatedState) {
    const realBot2 = this.bot || bot;
    // BUGFIX: Garantir que LP está sempre definido (buscar do game se necessário)
    const botLP = realBot2.lp ?? this.game?.bot?.lp ?? 8000;
    if ((realBot2.hand?.length || 0) > 3) {
      // Log para debug
      if (bot?.debug) {
        console.log(
          `[ShadowHeartStrategy] 🚨 FALLBACK CRÍTICO! Hand=${realBot2.hand?.length}, Field=${realBot2.field?.length}, LP=${botLP}`,
        );
      }
      log(
        `  🆘 FALLBACK CRÍTICO: ${realBot2.hand.length} cartas na mão, 0 ações! Forçando spell...`,
      );

      let spellsFound = 0;
      const canUseFallbackSpell = (card: StrategyCard) => {
        const activationContext = buildShadowHeartSpellActivationContext(
          card,
          realBot2,
          opponent,
          analysis,
        );
        const preview = canActivateShadowHeartSpell(
          game,
          card,
          realBot2,
          activationContext,
        );
        return {
          ok: !!(preview as PreviewGuardResult | null | undefined)?.ok,
          reason: (preview as PreviewGuardResult | null | undefined)?.reason || "preview failed",
          activationContext,
        };
      };
    let FallbackspellCandidate: AIActionOf<"spell"> | null = null;
    const decideFallbackSpell = (card: StrategyCard, index: number): AIActionOf<"spell"> | null => {
        if (card.cardKind !== "spell") return null;

        const fallbackCheck = canUseFallbackSpell(card);
        if (!fallbackCheck.ok) {
          log(
            `    Fallback spell bloqueada: ${card.name} (${fallbackCheck.reason})`,
          );
          return null;
        }

        // VALIDAÇÃO: Polymerization só pode ser ativado se tiver materiais válidos
        if (card.name === "Polymerization") {
          const canActivate =
            actualGame.canActivatePolymerization?.() ?? false;
          if (!canActivate) {
            if (bot?.debug) {
              console.log(
                `[ShadowHeartStrategy] ⚠️ Polymerization bloqueado: sem materiais válidos`,
              );
            }
            return null; // Skip Polymerization sem materiais
          }
        }

        if (
          card.name === "Shadow-Heart Purge" ||
          card.name === "Shadow-Heart Infusion"
        ) {
          const decision = shouldPlaySpell(card, analysis);
          if (!decision.yes) return null;
        }

        spellsFound++;
        const activationContext = fallbackCheck.activationContext;

        // Tentar qualquer spell, mesmo sem validação prévia
        if (bot?.debug) {
          console.log(
            `[ShadowHeartStrategy] 🔧 Fallback spell: ${card.name} (prioridade 0.5)`,
          );
        }
        log(`    🔧 Fallback spell: ${card.name} (prioridade forçada: 0.5)`);
        return {
          type: "spell",
          index,
          cardId: card.id,
          priority: 0.5,
          cardName: card.name,
          isCriticalFallback: true,
          ...(activationContext ? { activationContext } : {}),
        };

    };
    actions.push(...getGenericHandSpellActions({
      game, player: realBot2, analysis,

      shouldPlay: (card, _analysis, context) => {
        FallbackspellCandidate = decideFallbackSpell(card, context.index);
        return { yes: FallbackspellCandidate !== null, priority: FallbackspellCandidate?.priority };
      },
      buildActivationContext: () => FallbackspellCandidate?.activationContext || null,
      extra: () => FallbackspellCandidate || {},
    }));

      // Se ainda não há ações e não há spells, reportar situação crítica
      if (spellsFound === 0 && actions.length === 0) {
        const monsterCount = (realBot2.hand || []).filter(
          (c) => c.cardKind === "monster",
        ).length;
        const trapCount = (realBot2.hand || []).filter(
          (c) => c.cardKind === "trap",
        ).length;

        if (bot?.debug) {
          console.log(
            `[ShadowHeartStrategy] ⚠️ Situação crítica: ${monsterCount}M ${trapCount}T`,
          );
          console.log(
            `[ShadowHeartStrategy] Mão completa: ${(realBot2.hand || [])
              .map((c) => c.name)
              .join(", ")}`,
          );
        }
        log(
          `  ⚠️ Situação crítica: ${monsterCount} monstros (todos precisam tributos?), ${trapCount} traps na mão`,
        );
        log(
          `  📋 Mão: ${(realBot2.hand || []).map((c) => c.name).join(", ")}`,
        );
      }
    }
  }

  // === EFEITOS DE CAMPO ===
  // Em simulação, não verificar checkOncePerTurn
  actions.push(...getGenericIgnitionEffectActions({
    game, player: bot, analysis, cards: bot.fieldSpell ? [bot.fieldSpell] : [],
    type: "fieldEffect", sourceZone: "fieldSpell", indexFields: [],
    cardFilter: () => !isSimulatedState,
    findEffect: card => card.effects?.find(effect => effect.timing === "on_field_activate") || null,
    shouldActivate: (card, _analysis, { effect }) => ({
      yes: actualGame.effectEngine?.checkOncePerTurn?.(card, bot, effect)?.ok === true,
      priority: 5,
    }),
  }).map(() => ({ type: "fieldEffect" as const, priority: 5 })));

  const positionActions = this.getPositionChangeActions(game, bot as SimulatedPlayerState, opponent!);
  if (positionActions.length > 0) {
    actions.push(...positionActions);
  }

  const planningProfile = buildShadowHeartPlanningProfile(analysis, {
    game,
    strategy: this,
  });
  const retainedActions = applyShadowHeartCandidateRetention(actions, analysis, {
    game,
    strategy: this,
    profile: planningProfile,
    isSimulatedState,
  });

  // === P2: GAME TREE SEARCH (OPCIONAL) ===
  // Desativar P2 em simulação para evitar recursão infinita
  if (isSimulatedState) {
    return this.sequenceActions(retainedActions);
  }

  const finalActions = this.integrateP2IntoActionSelection(
    game,
    this.sequenceActions(retainedActions),
    analysis,
  );

  return finalActions;
}
