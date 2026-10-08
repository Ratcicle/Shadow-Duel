import type BaseStrategy from "../BaseStrategy.js";
import type { AIAction, AIActionOf, AIState } from "../../contracts/ai.js";
import type { SimulatedCardState, SimulatedPlayerState } from "../../contracts/aiState.js";
import type { BattlePosition } from "../../contracts/cards.js";
import type { FinisherPlan } from "../common/finisherPlans.js";
import type { StrategyCard, VoidPlayer, VoidGame, VoidAnalysisInput, VoidCompleteAnalysis, VoidActivationContext } from "./types.js";
import type { buildVoidCostPreferences } from "./costPolicy.js";
import { canUseNormalSummonForCard } from "../../Player.js";
import { getTributeValueTotal } from "../../game/summon/tributeValue.js";
import { buildPrioritizedAction, getGenericHandSpellActions, getGenericNormalSummonActions, getGenericIgnitionEffectActions } from "../common/actionGeneration.js";
import { findIgnitionEffect, findSpellActivationEffect } from "../common/effectDiscovery.js";
import { getGenericAscensionActions } from "../common/ascensionPlanning.js";
import { validateFieldIgnitionCandidate as validateVoidFieldIgnitionCandidate, validateHandIgnitionCandidate as validateVoidHandIgnitionCandidate } from "../common/actionValidation.js";
import { getFusionPreferenceScore, withFusionPreferences } from "../common/fusionPlanning.js";
import { VOID_IDS } from "./combos.js";
import { isVoid, getVoidCardKnowledge } from "./knowledge.js";
import { assessVoidNormalSummonEntry, evaluateVoidFusionPriority, evaluateVoidFusionRemovalPriority, shouldPlayVoidSpell, shouldSummonVoidMonster } from "./priorities.js";
import { assessVoidHollowResourcePolicy } from "./scoring.js";
import { buildVoidActivationContext } from "./costPolicy.js";
import { shouldPreserveArcturusSoloBuff, getSimulatedVoidAscensionCandidates, evaluateMirrorDimensionSetup, getMaterialEffectActivationCount, isMaliciousAscensionReady, getThousandArmsMaliciousSetup } from "./analysis.js";
export interface VoidActionGenerationHost extends Pick<BaseStrategy, "getOpponent" | "getTributeRequirementFor" | "getPositionChangeActions" | "integrateP2IntoActionSelection"> {
    bot: VoidPlayer;
    analyzeGameState(game: AIState): VoidCompleteAnalysis;
    chooseVoidAscensionPosition(card: StrategyCard | undefined, material: StrategyCard | undefined, game: AIState | undefined, plan?: FinisherPlan | null | undefined): BattlePosition;
    calculateComboBoosts(analysis: VoidAnalysisInput): Partial<Record<number, number>>;
    evaluateGravitationalPull(bot: VoidPlayer, opponent: VoidPlayer | null): {
        shouldActivate: boolean;
        priority: number;
        reason: string;
    };
    evaluateFusionOpportunity(analysis: VoidAnalysisInput): number;
    evaluateConjurerGraveyardRevive(analysis: VoidAnalysisInput, game: VoidGame, bot: VoidPlayer, card: StrategyCard): {
        shouldActivate: boolean;
        priority: number;
    };
    selectBestTributes(field: StrategyCard[], amount: number, card: StrategyCard, context?: {
        game?: AIState;
        oppField?: StrategyCard[];
    }): number[];
    sequenceActions(actions: AIAction[]): AIAction[];
}
export function generateVoidMainPhaseActions(this: VoidActionGenerationHost, gameInput: AIState): AIAction[] {
    const game = gameInput as VoidGame;
    const actions: AIAction[] = [];
    const analysis = this.analyzeGameState(game);
    const voidActivationContext = buildVoidActivationContext(analysis) as VoidActivationContext;
    const bot = game._isPerspectiveState ? game.bot : this.bot || game.bot;
    const opponent = this.getOpponent(game, bot);
    const isSimulatedState = game._isPerspectiveState === true;
    const handIds = (bot.hand || []).map((card) => card?.id).filter(Boolean);
    const hollowFieldCount = analysis.hollowCount;
    const voidFieldCount = analysis.voidCount;
    const macroStrategy = analysis.macroStrategy;
    const swarmPayoffs: Partial<NonNullable<VoidAnalysisInput["swarmPayoffs"]>> = analysis.swarmPayoffs || {};
    const bestFinisherPlan = analysis.bestFinisherPlan || null;
    const hollowResourcePolicy: Partial<ReturnType<typeof assessVoidHollowResourcePolicy>> = analysis.hollowResourcePolicy || {};
    const preserveHollowsForFinisher = hollowResourcePolicy.preserveHollowsInGY === true ||
        (bestFinisherPlan?.preserveHollowsInGY === true &&
            String(game?.phase || "").toLowerCase().includes("main1"));
    const preserveArcturusSoloBuff = shouldPreserveArcturusSoloBuff(bot, opponent, analysis);
    // ═══════════════════════════════════════════════════════════════════════════
    // ASCENSION CHECK
    // ═══════════════════════════════════════════════════════════════════════════
    const getAscensionFinisherPlan = (ascensionCard: StrategyCard) => (analysis.finisherPlans || []).find((plan) => plan.targetName === ascensionCard.name);
    actions.push(...getGenericAscensionActions({ game, bot, opponent, analysis, isSimulatedState }, {
        getSimulatedAscensionCandidates: getSimulatedVoidAscensionCandidates,
        shouldSkipAscension: (ascensionCard) => {
            const ascensionFinisherPlan = getAscensionFinisherPlan(ascensionCard);
            return (ascensionCard.id === VOID_IDS.MALICIOUS_DEMON &&
                (!ascensionFinisherPlan || ascensionFinisherPlan.score100 < 60));
        },
        evaluateAscensionPriority: (ascensionCard) => {
            const ascensionFinisherPlan = getAscensionFinisherPlan(ascensionCard);
            let ascensionPriority: number;
            if (ascensionCard.id === VOID_IDS.COSMIC_WALKER) {
                ascensionPriority = 11;
            }
            else if (ascensionCard.id === VOID_IDS.MALICIOUS_DEMON) {
                // Multi-attack escala com Hollows no GY (cada Hollow = +1 ataque)
                const hollowsInGY = (bot.graveyard || []).filter((c) => c?.id === VOID_IDS.HOLLOW).length;
                ascensionPriority = 10 + Math.min(hollowsInGY, 4) * 0.5;
            }
            else {
                ascensionPriority = 9 + (ascensionCard.atk || 0) / 1000;
            }
            if (ascensionFinisherPlan) {
                ascensionPriority = Math.max(ascensionPriority, ascensionFinisherPlan.actionPriority || 0);
                if (ascensionFinisherPlan.preserveHollowsInGY) {
                    ascensionPriority += 0.4;
                }
            }
            return ascensionPriority;
        },
        chooseAscensionPosition: (ascensionCard, material) => this.chooseVoidAscensionPosition(ascensionCard, material, game, getAscensionFinisherPlan(ascensionCard)),
        decorateAction: (action, ascensionCard) => ({
            ...action,
            finisherPlanRank: getAscensionFinisherPlan(ascensionCard)?.score100,
        }),
    }));
    // ═══════════════════════════════════════════════════════════════════════════
    // COMBO-AWARE ACTION GENERATION
    // ═══════════════════════════════════════════════════════════════════════════
    // Boost de prioridade baseado em combos detectados
    const comboBoosts = this.calculateComboBoosts(analysis);
    if (bot.hand && bot.hand.length > 0) {
        bot.hand.forEach((card, index) => {
            if (!card)
                return;
            // ─────────────────────────────────────────────────────────────────────
            // SPELLS
            // ─────────────────────────────────────────────────────────────────────
            if (card.cardKind === "spell") {
                let hasFusionAction = false;
                let fusionHint: string | null | undefined = null;
                let activationContext = voidActivationContext;
                let spellExtra: Partial<AIActionOf<"spell">> = {};
                actions.push(...getGenericHandSpellActions({
                    game, player: bot, analysis, entries: [{ card, sourceIndex: index }],
                    shouldPlay: () => {
                        hasFusionAction = (card.effects || []).some((effect) => (effect.actions || []).some((action) => action && action.type === "polymerization_fusion_summon"));
                        const activationEffect = game?.effectEngine?.getSpellTrapActivationEffect?.(card, {
                            fromHand: true,
                        }) ||
                            findSpellActivationEffect(card, null, { timings: ["on_play", "on_activate", "on_field_activate"] });
                        if (!isSimulatedState &&
                            activationEffect?.oncePerTurn &&
                            typeof game?.effectEngine?.checkOncePerTurn === "function") {
                            const optCheck = game.effectEngine.checkOncePerTurn(card, bot, activationEffect);
                            if (optCheck?.ok === false)
                                return { yes: false };
                        }
                        if (!isSimulatedState && hasFusionAction) {
                            const canActivate = game.canActivatePolymerization?.();
                            if (!canActivate)
                                return { yes: false };
                        }
                        let decision = shouldPlayVoidSpell(card, game, bot, opponent);
                        fusionHint = null;
                        activationContext = voidActivationContext;
                        if (card.id === VOID_IDS.GRAVITATIONAL) {
                            const gravitationalEval = this.evaluateGravitationalPull(bot, opponent);
                            if (!gravitationalEval.shouldActivate)
                                return { yes: false };
                            decision = {
                                yes: true,
                                priority: gravitationalEval.priority,
                                reason: gravitationalEval.reason,
                            };
                        }
                        if (card.id === VOID_IDS.THE_VOID &&
                            (bot.field || []).length === 0 &&
                            handIds.includes(VOID_IDS.LOST_THRONE) &&
                            (bot.deck || []).some((candidate) => candidate?.id === VOID_IDS.HOLLOW)) {
                            decision = {
                                ...decision,
                                priority: Math.min(decision.priority || 0, 7.8),
                                reason: "Lost Throne deve liderar a linha starter com Hollow",
                            };
                        }
                        if (hasFusionAction) {
                            const fusionPlan = (analysis.finisherPlans || []).find((plan) => plan.kind === "fusion");
                            const finisherFusionEval = fusionPlan
                                ? {
                                    priority: fusionPlan.actionPriority,
                                    target: fusionPlan.targetName,
                                    reason: fusionPlan.reason,
                                    preserveHollowsInGY: fusionPlan.preserveHollowsInGY,
                                    plan: fusionPlan,
                                }
                                : evaluateVoidFusionPriority(bot);
                            const removalFusionEval = evaluateVoidFusionRemovalPriority(bot, opponent, game, analysis);
                            const fusionEval = removalFusionEval.priority > 0 &&
                                removalFusionEval.priority >=
                                    (finisherFusionEval.priority || 0) - 0.3
                                ? removalFusionEval
                                : finisherFusionEval;
                            fusionHint = fusionEval.target;
                            if (fusionEval.priority <= 0)
                                return { yes: false };
                            activationContext = withFusionPreferences(voidActivationContext, fusionEval) as VoidActivationContext;
                            // Usar calculateFusionValue para prioridade mais precisa
                            const fusionValue = this.evaluateFusionOpportunity(analysis);
                            decision = {
                                yes: true,
                                priority: Math.max(decision.priority, fusionEval.priority, fusionValue),
                            };
                            // Se macro strategy é fusion, boost extra
                            if (macroStrategy.mode === "fusion") {
                                decision.priority += 2.0;
                            }
                        }
                        if (!decision.yes)
                            return { yes: false };
                        const fusionPreferenceScore = getFusionPreferenceScore(activationContext, fusionHint);
                        spellExtra = {
                            priority: hasFusionAction ? Math.max(8.5, decision.priority) : decision.priority,
                            extraDeck: hasFusionAction,
                            fusionTargetHint: fusionHint,
                            finisherPlanRank: hasFusionAction
                                ? Number.isFinite(fusionPreferenceScore) ? fusionPreferenceScore! * 10 : undefined
                                : undefined,
                        };
                        return { yes: true };
                    },
                    buildActivationContext: () => activationContext,
                    extra: () => spellExtra,
                }));
                return;
            }
            if (card.cardKind === "trap" && card.id === VOID_IDS.MIRROR_DIMENSION) {
                const hasSpace = (bot.spellTrap || []).length < 5;
                const alreadySet = (bot.spellTrap || []).some((setCard) => setCard?.id === VOID_IDS.MIRROR_DIMENSION);
                const mirrorSetup = evaluateMirrorDimensionSetup(bot, opponent, card);
                if (!hasSpace || alreadySet || !mirrorSetup.ok) {
                    return;
                }
                actions.push(buildPrioritizedAction({ type: "set_spell_trap", index, card, priority: mirrorSetup.priority }));
                return;
            }
            // ─────────────────────────────────────────────────────────────────────
            // NORMAL SUMMON (com sequenciamento de combo)
            // ─────────────────────────────────────────────────────────────────────
            if (card.cardKind === "monster" && canUseNormalSummonForCard(bot, card)) {
                let summonExtra: Partial<AIActionOf<"summon">> = {};
                const normalActions = getGenericNormalSummonActions({
                    player: bot, summonPlayer: bot, analysis: { canNormalSummon: true },
                    entries: [{ card, sourceIndex: index }],
                    shouldSummon: () => {
                        const summonDecision = shouldSummonVoidMonster(card, game, bot, opponent);
                        if (!summonDecision.yes)
                            return { yes: false };
                        // Combo boost baseado na análise
                        let comboBoost = comboBoosts[card.id!] || 0;
                        // ═══════════════════════════════════════════════════════════════════
                        // CONJURER: Só vale combo completo se tem PAYOFF
                        // Swarm sem payoff = campo fraco que será destruído
                        // ═══════════════════════════════════════════════════════════════════
                        if (card.id === VOID_IDS.CONJURER) {
                            const hasPayoff = swarmPayoffs.hasBossPayoff ||
                                swarmPayoffs.hasFusionPayoff ||
                                swarmPayoffs.totalPayoffValue! >= 2.0;
                            if (hasPayoff) {
                                comboBoost += 3.0; // Base boost alto COM payoff
                                // COMBO COMPLETO: Conjurer + Hollow na mão + payoff
                                if (handIds.includes(VOID_IDS.HOLLOW)) {
                                    comboBoost += 2.5; // Combo perfeito!
                                    // Bônus adicional baseado no tipo de payoff
                                    if (swarmPayoffs.hasFusionPayoff) {
                                        comboBoost += 1.5; // Fusão é o melhor payoff
                                    }
                                    if (handIds.includes(VOID_IDS.HAUNTER)) {
                                        comboBoost += 1.5; // Haunter tributa Hollow → 2100 ATK
                                    }
                                    if (handIds.includes(VOID_IDS.SLAYER_BRUTE)) {
                                        comboBoost += 1.5; // Slayer tributa 2 → 2500 ATK
                                    }
                                    if (handIds.includes(VOID_IDS.SERPENT_DRAKE)) {
                                        comboBoost += 1.0; // Drake usa Hollow como custo
                                    }
                                }
                                else {
                                    // Conjurer sem Hollow ainda é ok (recruta qualquer Void lv4-)
                                    comboBoost += 1.0;
                                }
                            }
                            else {
                                // SEM PAYOFF: Conjurer ainda é ok mas não prioriza combo
                                comboBoost += 1.0; // Boost menor
                                // Não faz o combo completo, só recruta um corpo
                            }
                        }
                        // ═══════════════════════════════════════════════════════════════════
                        // HOLLOW: NUNCA normal summon se tem opção melhor
                        // ═══════════════════════════════════════════════════════════════════
                        if (card.id === VOID_IDS.HOLLOW) {
                            if (handIds.includes(VOID_IDS.CONJURER)) {
                                comboBoost -= 5.0; // NUNCA - Conjurer traz Walker que desce Hollow
                            }
                            else if (handIds.includes(VOID_IDS.WALKER)) {
                                comboBoost -= 2.0; // Prefere Walker para descer Hollow da mão
                            }
                            else {
                                // Sem opção melhor, Hollow sozinho é fraco mas é alguma coisa
                                comboBoost += 0.0;
                            }
                        }
                        // ═══════════════════════════════════════════════════════════════════
                        // ARCTURUS: Lord of the Void — 2 tributos para 2800 ATK + lock de BP
                        // Escala com Voids no GY (boost passive se for único monstro)
                        // ═══════════════════════════════════════════════════════════════════
                        if (card.id === VOID_IDS.ARCTURUS) {
                            const monstersOnField = (bot.field || []).filter((m) => m && m.cardKind === "monster").length;
                            if (monstersOnField >= 2) {
                                const voidsInGY = (bot.graveyard || []).filter(isVoid).length;
                                comboBoost += 3.0; // Boss máximo: prioridade alta
                                comboBoost += Math.min(voidsInGY, 6) * 0.3; // Scaling do GY
                                // Cada par de Voids no GY = 1 vida extra via replacementEffect
                                if (voidsInGY >= 2)
                                    comboBoost += 0.6;
                            }
                            else {
                                // Sem tributos suficientes: penalizar para não ser escolhido
                                comboBoost -= 5.0;
                            }
                        }
                        // ═══════════════════════════════════════════════════════════════════
                        // WALKER: Bom se tem Hollow na mão (e não tem Conjurer)
                        // ═══════════════════════════════════════════════════════════════════
                        if (card.id === VOID_IDS.WALKER) {
                            if (handIds.includes(VOID_IDS.CONJURER)) {
                                comboBoost -= 3.0; // Conjurer recruta Walker do deck
                            }
                            else if (handIds.includes(VOID_IDS.HOLLOW)) {
                                // Walker + Hollow é bom combo se tem payoff
                                const hasPayoff = swarmPayoffs.hasBossPayoff || swarmPayoffs.hasFusionPayoff;
                                comboBoost += hasPayoff ? 2.5 : 1.0;
                            }
                            else {
                                const otherVoidsInHand = (bot.hand || []).filter((c) => isVoid(c) && c.id !== VOID_IDS.WALKER && (c.level || 0) <= 4).length;
                                if (otherVoidsInHand > 0) {
                                    comboBoost += 0.5;
                                }
                            }
                        }
                        const tributeInfo = this.getTributeRequirementFor(card as SimulatedCardState, bot as SimulatedPlayerState) || {
                            tributesNeeded: 0,
                        };
                        const tributeIndices = tributeInfo.tributesNeeded > 0
                            ? this.selectBestTributes(bot.field || [], tributeInfo.tributesNeeded, card, { oppField: opponent?.field || [], game })
                            : [];
                        const tributeCards = (tributeIndices || [])
                            .map((fieldIndex) => bot.field?.[fieldIndex])
                            .filter((tribute): tribute is StrategyCard => Boolean(tribute));
                        const tributesNeeded = Math.max(0, Number(tributeInfo.tributesNeeded) || 0);
                        if (getTributeValueTotal(tributeCards, card) < tributesNeeded)
                            return { yes: false };
                        if ((bot.field || []).length - tributeCards.length + 1 > 5)
                            return { yes: false };
                        const normalSummonAssessment = assessVoidNormalSummonEntry(card, {
                            game,
                            player: bot,
                            opponent,
                            analysis,
                            tributeCards,
                            tributeCount: tributesNeeded,
                        });
                        if (!normalSummonAssessment.shouldSummon)
                            return { yes: false };
                        const position = normalSummonAssessment.position || "attack";
                        let normalSummonPriority = summonDecision.priority +
                            comboBoost +
                            (normalSummonAssessment.scoreDelta || 0);
                        if (bestFinisherPlan?.targetName === card.name) {
                            normalSummonPriority = Math.max(normalSummonPriority, bestFinisherPlan!.actionPriority || 0);
                        }
                        summonExtra = {
                            facedown: normalSummonAssessment.facedown === true,
                            priority: normalSummonPriority,
                            finisherPlanRank: bestFinisherPlan?.targetName === card.name ? bestFinisherPlan!.score100 : undefined,
                        };
                        return { yes: true, position };
                    },
                    extra: () => summonExtra,
                });
                // Preserve the original per-card return before hand ignition.
                if (normalActions.length === 0)
                    return;
                actions.push(...normalActions);
            }
            // ─────────────────────────────────────────────────────────────────────
            // HAND IGNITION (com sequenciamento)
            // ─────────────────────────────────────────────────────────────────────
            if (card.cardKind === "monster") {
                actions.push(...getGenericIgnitionEffectActions({
                    game, player: bot, analysis, type: "handIgnition", sourceZone: "hand",
                    entries: [{ card, sourceIndex: index }], includeEffectId: true,
                    cardFilter: candidate => candidate.cardKind === "monster",
                    findEffect: candidate => findIgnitionEffect(candidate, "hand"),
                    validateCandidate: ({ card: candidate, effect }) => validateVoidHandIgnitionCandidate({
                        card: candidate, effect, player: bot, game, isSimulatedState,
                        activationContext: voidActivationContext,
                    }),
                    shouldActivate: () => {
                        const knowledge = getVoidCardKnowledge(card);
                        let ignitionPriority = knowledge?.role === "boss" ? 7 : 5.5;
                        // Haunter: prioriza se tem Hollows para tributar E se tem mais no GY
                        if (card.id === VOID_IDS.HAUNTER) {
                            if (hollowFieldCount >= 1) {
                                ignitionPriority += 2.5;
                                // Bônus extra se tem Haunter no GY (pode reviver Hollows depois)
                                const haunterInGY = (bot.graveyard || []).some((c) => c?.id === VOID_IDS.HAUNTER);
                                if (haunterInGY) {
                                    ignitionPriority += 1.0;
                                }
                            }
                        }
                        // Slayer Brute: prioriza se tem 2+ Voids E se queremos boss
                        if (card.id === VOID_IDS.SLAYER_BRUTE) {
                            if (voidFieldCount >= 2) {
                                const costPrefs: Partial<ReturnType<typeof buildVoidCostPreferences>> = voidActivationContext?.actionContext?.costPreferences || {};
                                const preserveNames = new Set(costPrefs.preserveNames || []);
                                const payoffNames = new Set(costPrefs.offensivePayoffNames || []);
                                const availablePayoffs = Number.isFinite(costPrefs.availableOffensivePayoffs)
                                    ? costPrefs.availableOffensivePayoffs!
                                    : 0;
                                const viableCosts = (bot.field || []).filter((candidate) => {
                                    if (!candidate ||
                                        candidate.cardKind !== "monster" ||
                                        !isVoid(candidate)) {
                                        return false;
                                    }
                                    if (preserveNames.has(candidate.name!))
                                        return false;
                                    if (costPrefs.preserveLastOffensivePayoff &&
                                        payoffNames.has(candidate.name!) &&
                                        availablePayoffs <= 1) {
                                        return false;
                                    }
                                    return true;
                                });
                                const hollowCostAvailable = viableCosts.some((candidate) => candidate?.id === VOID_IDS.HOLLOW);
                                const viableCostCount = viableCosts.length;
                                if (viableCostCount < 2)
                                    return { yes: false };
                                ignitionPriority += 2.5;
                                if (hollowCostAvailable) {
                                    ignitionPriority += 0.8;
                                }
                                // Extra se temos Poly para Berserker depois
                                if (handIds.includes(VOID_IDS.POLYMERIZATION)) {
                                    ignitionPriority += 1.5;
                                }
                            }
                        }
                        // Serpent Drake: prioriza quando há Hollow disponível como custo
                        if (card.id === VOID_IDS.SERPENT_DRAKE) {
                            if (hollowFieldCount >= 1) {
                                ignitionPriority += 2.0;
                            }
                        }
                        // Forgotten Knight
                        if (card.id === VOID_IDS.FORGOTTEN_KNIGHT && voidFieldCount >= 1) {
                            ignitionPriority += 1.5;
                        }
                        // Thousand-Arms: tributa 1 Void e depois bounce-revive Hollows do GY
                        if (card.id === VOID_IDS.THOUSAND_ARMS) {
                            if (voidFieldCount >= 1) {
                                ignitionPriority += 2.5;
                                const hollowsInGY = (bot.graveyard || []).filter((c) => c?.id === VOID_IDS.HOLLOW).length;
                                if (hollowsInGY >= 1) {
                                    // Cada Hollow no GY = corpo extra via bounce-revive
                                    ignitionPriority += 1.0 + Math.min(hollowsInGY, 2) * 0.5;
                                }
                                // Caminho para Malicious Demon (precisa 2 ativações)
                                if ((bot.extraDeck || []).some((c) => c?.id === VOID_IDS.MALICIOUS_DEMON)) {
                                    const materialActivations = getMaterialEffectActivationCount(game, bot, VOID_IDS.THOUSAND_ARMS);
                                    ignitionPriority += materialActivations >= 2 ? 4.0 : 0.8;
                                    if (materialActivations === 1) {
                                        ignitionPriority += 1.0;
                                    }
                                }
                            }
                        }
                        return { yes: true, priority: ignitionPriority };
                    },
                    buildActivationContext: () => voidActivationContext,
                }));
            }
        });
    }
    let spellTrapPriority = 5.5;
    actions.push(...getGenericIgnitionEffectActions({
        game, player: bot, analysis, cards: bot.spellTrap || [],
        type: "spellTrapEffect", sourceZone: "spellTrap", indexFields: ["zoneIndex"],
        cardFilter: card => card.cardKind === "spell",
        findEffect: card => findIgnitionEffect(card),
        validateCandidate: ({ card, effect }) => isSimulatedState || game.effectEngine?.checkOncePerTurn?.(card, bot, effect)?.ok !== false,
        shouldActivate: card => {
            if (card.id === VOID_IDS.GRAVITATIONAL) {
                const evaluation = this.evaluateGravitationalPull(bot, opponent);
                spellTrapPriority = evaluation.priority;
                return { yes: evaluation.shouldActivate, priority: evaluation.priority };
            }
            spellTrapPriority = 5.5;
            return { yes: true, priority: 5.5 };
        },
        buildActivationContext: () => voidActivationContext,
        extra: () => ({ priority: spellTrapPriority }),
    }));
    // ═══════════════════════════════════════════════════════════════════════════
    // FIELD MONSTER IGNITIONS
    // Cobre Conjurer (recruta deck), Walker (bounce + SS), Bone Spider (lock),
    // Ghost Wolf (direct), Thousand-Arms (bounce-revive), Cosmic Walker (summon Hollow).
    // ═══════════════════════════════════════════════════════════════════════════
    actions.push(...getGenericIgnitionEffectActions({
        game, player: bot, analysis, cards: bot.field || [], type: "monsterEffect",
        sourceZone: "field", indexFields: ["fieldIndex"], includeEffectId: true,
        cardFilter: card => card.cardKind === "monster" && !card.isFacedown && !card.effectsNegated,
        findEffect: card => findIgnitionEffect(card, "field"),
        validateCandidate: ({ card, effect }) => {
            if (!isSimulatedState) {
                const preview = game?.effectEngine?.canActivateMonsterEffectPreview?.(card, bot, "field", null, {});
                if (preview && preview.ok === false)
                    return false;
            }
            else {
                // Em simulação, validar OPT manualmente para evitar duplicar ações
                const optCheck = game.effectEngine?.checkOncePerTurn?.(card, bot, effect);
                if (optCheck?.ok === false)
                    return false;
            }
            const effectValidation = validateVoidFieldIgnitionCandidate({
                card,
                effect: effect,
                player: bot,
            });
            if (!effectValidation.ok)
                return false;
            return true;
        },
        shouldActivate: card => {
            const oppFieldCount = analysis.oppFieldCount || 0;
            const oppStrongestAtk = analysis.oppStrongestAtk || 0;
            const hollowsInGY = (bot.graveyard || []).filter((c) => c?.id === VOID_IDS.HOLLOW).length;
            const hollowsInHand = (bot.hand || []).filter((c) => c?.id === VOID_IDS.HOLLOW).length;
            const hollowsOnField = (bot.field || []).filter((c) => c?.id === VOID_IDS.HOLLOW && !c.isFacedown).length;
            const voidsInGY = (bot.graveyard || []).filter(isVoid).length;
            const fieldHasSpace = (bot.field || []).length < 5;
            let priority = 0;
            switch (card.id) {
                case VOID_IDS.CONJURER: {
                    // Engine principal: recruta Void lv4- do deck
                    if (!fieldHasSpace)
                        break;
                    priority = 8.5;
                    if (handIds.includes(VOID_IDS.HOLLOW))
                        priority += 1.0;
                    // Reciclar via Gravitational depois é payoff extra
                    if (handIds.includes(VOID_IDS.GRAVITATIONAL))
                        priority += 0.3;
                    break;
                }
                case VOID_IDS.WALKER: {
                    // Bounce self → SS Void lv4- da mão (não Walker)
                    if (handIds.includes(VOID_IDS.HOLLOW)) {
                        priority = 9.0; // Walker into Hollow é o melhor combo de extensão
                    }
                    else {
                        const otherVoidLv4 = (bot.hand || []).filter((c) => isVoid(c) &&
                            c.id !== VOID_IDS.WALKER &&
                            c.id !== VOID_IDS.RAVEN &&
                            (c.level || 0) <= 4 &&
                            (c.atk || 0) > 0).length;
                        priority = otherVoidLv4 > 0 ? 6.0 : 0;
                    }
                    break;
                }
                case VOID_IDS.THOUSAND_ARMS: {
                    // Bounce self → SS até 2 Hollows do GY
                    const maliciousSetup = getThousandArmsMaliciousSetup(game, bot, card);
                    if (isMaliciousAscensionReady(game, bot, card) ||
                        maliciousSetup.shouldHoldForAscension ||
                        maliciousSetup.shouldDelayFreshBounce) {
                        break;
                    }
                    if (hollowsInGY < 1)
                        break;
                    priority = 7.0;
                    priority += Math.min(hollowsInGY, 2) * 0.75; // até +1.5
                    // Caminho para Malicious Demon ascension (precisa 2 ativações)
                    if (maliciousSetup.hasMalicious) {
                        priority += maliciousSetup.activations >= 1 ? 0.8 : 1.5;
                    }
                    priority +=
                        hollowResourcePolicy.spend?.thousandArmsRevive?.scoreDelta ??
                            (preserveHollowsForFinisher ? -3.0 : 0);
                    break;
                }
                case VOID_IDS.COSMIC_WALKER: {
                    // Summon 1 Void Hollow da mao ou GY.
                    const hollowsAccessible = hollowsInHand + hollowsInGY;
                    if (!fieldHasSpace || hollowsAccessible < 1)
                        break;
                    priority = 7.0 + Math.min(hollowsAccessible, 2) * 0.5;
                    if (swarmPayoffs.hasFusionPayoff || swarmPayoffs.hasBossPayoff) {
                        priority += 0.5;
                    }
                    priority +=
                        hollowResourcePolicy.spend?.cosmicWalkerRevive?.scoreDelta ??
                            (preserveHollowsForFinisher ? -2.5 : 0);
                    break;
                }
                case VOID_IDS.BONE_SPIDER: {
                    // Envia Hollow como custo para lockar 1 monstro inimigo até o próximo turno.
                    const hasHollowCost = (bot.hand || []).some((c) => c?.id === VOID_IDS.HOLLOW) ||
                        (bot.field || []).some((c) => c?.id === VOID_IDS.HOLLOW);
                    if (oppFieldCount === 0)
                        break;
                    if (!hasHollowCost)
                        break;
                    priority = 4.0;
                    if (oppStrongestAtk >= 2000)
                        priority += 1.5;
                    if (oppStrongestAtk >= 2500)
                        priority += 1.0;
                    break;
                }
                case VOID_IDS.GHOST_WOLF: {
                    // Halve ATK + direct attack para contornar ameaça ou fechar pressão.
                    const phase = String(game?.phase || "").toLowerCase();
                    const isPostBattle = phase.includes("main2") ||
                        phase.includes("main_2") ||
                        phase.includes("end");
                    if (isPostBattle ||
                        card.hasAttacked ||
                        card.cannotAttackThisTurn ||
                        card.position === "defense") {
                        break;
                    }
                    const halvedDamage = Math.floor((card.atk || 0) / 2);
                    const oppLP = analysis.oppLP || 8000;
                    const canClearThreat = oppStrongestAtk > 0 && (card.atk || 0) > oppStrongestAtk;
                    const fieldIsHard = oppFieldCount > 0 && !canClearThreat;
                    if (halvedDamage >= oppLP) {
                        priority = 12.0; // letal
                    }
                    else if (fieldIsHard && oppLP <= 2500) {
                        priority = 6.5;
                    }
                    else if (fieldIsHard && oppStrongestAtk >= (card.atk || 0)) {
                        priority = 4.8;
                    }
                    else if (oppLP <= 2000) {
                        priority = 6.5;
                    }
                    else if (oppFieldCount === 0) {
                        priority = 3.5;
                    }
                    else {
                        priority = 0;
                    }
                    break;
                }
                default: {
                    // Outros monstros Void com ignition genérico — fallback baixo
                    const knowledge = getVoidCardKnowledge(card);
                    priority = knowledge?.role === "boss" ? 5.0 : 4.0;
                }
            }
            return { yes: priority > 0, priority };
        },
        buildActivationContext: () => voidActivationContext,
    }));
    // ═══════════════════════════════════════════════════════════════════════════
    // GRAVEYARD MONSTER IGNITIONS
    // Cobre Conjurer GY-revive, Tenebris Horn revive limitado por duelo,
    // Forgotten Knight banish-to-destroy, Haunter banish-to-revive Hollows.
    // ═══════════════════════════════════════════════════════════════════════════
    actions.push(...getGenericIgnitionEffectActions({
        game, player: bot, analysis, cards: bot.graveyard || [], type: "graveyardMonsterEffect",
        sourceZone: "graveyard", indexFields: ["graveyardIndex"], includeEffectId: true,
        cardFilter: card => card.cardKind === "monster",
        findEffect: card => findIgnitionEffect(card, "graveyard"),
        validateCandidate: ({ card, effect }) => {
            if (!isSimulatedState) {
                const preview = game?.effectEngine?.canActivateMonsterEffectPreview?.(card, bot, "graveyard", null, {});
                if (preview && preview.ok === false)
                    return false;
            }
            else {
                const optCheck = game.effectEngine?.checkOncePerTurn?.(card, bot, effect);
                if (optCheck?.ok === false)
                    return false;
                const opdCheck = game.effectEngine?.checkOncePerDuel?.(card, bot, effect);
                if (opdCheck?.ok === false)
                    return false;
            }
            return true;
        },
        shouldActivate: card => {
            const fieldHasSpace = (bot.field || []).length < 5;
            const hollowsInGY = (bot.graveyard || []).filter((c) => c?.id === VOID_IDS.HOLLOW).length;
            const hollowsOnField = (bot.field || []).filter((c) => c?.id === VOID_IDS.HOLLOW).length;
            const voidsInGY = (bot.graveyard || []).filter(isVoid).length;
            const oppFaceUpST = ((opponent?.spellTrap || []).filter((c) => c && !c.isFacedown).length || 0) + (opponent?.fieldSpell ? 1 : 0);
            let priority = 0;
            switch (card.id) {
                case VOID_IDS.CONJURER: {
                    // Tributa 1 Void do campo → SS Conjurer do GY
                    const revivePlan = this.evaluateConjurerGraveyardRevive(analysis, game, bot, card);
                    if (!revivePlan.shouldActivate)
                        break;
                    priority = revivePlan.priority;
                    break;
                }
                case VOID_IDS.TENEBRIS_HORN: {
                    // OPT, ate 3 vezes por duelo: SS self do GY com 2+ Hollows campo/GY.
                    if (!fieldHasSpace)
                        break;
                    if (hollowsOnField + hollowsInGY < 2)
                        break;
                    if (preserveArcturusSoloBuff)
                        break;
                    priority = 6.5;
                    // Cada Void no campo proprio/GY aumenta valor (passive scaling)
                    priority +=
                        Math.min((analysis.voidCount || 0) + voidsInGY, 5) * 0.4;
                    break;
                }
                case VOID_IDS.FORGOTTEN_KNIGHT: {
                    // Banir self do GY → destruir 1 face-up S/T do oponente
                    if (oppFaceUpST < 1)
                        break;
                    priority = 7.0;
                    if (opponent?.fieldSpell)
                        priority += 1.0; // field spells são valiosos
                    break;
                }
                case VOID_IDS.HAUNTER: {
                    // Banir self do GY → SS até 3 Hollows do GY com ATK/DEF 0
                    if (hollowsInGY < 1 || !fieldHasSpace)
                        break;
                    if (preserveArcturusSoloBuff)
                        break;
                    priority = 8.0;
                    priority += Math.min(hollowsInGY, 3) * 0.5; // até +1.5
                    // Payoffs para os Hollows revividos
                    const hasPoly = handIds.includes(VOID_IDS.POLYMERIZATION);
                    const extraIds = (bot.extraDeck || [])
                        .map((c) => c?.id)
                        .filter(Boolean);
                    if (hasPoly && extraIds.includes(VOID_IDS.HOLLOW_KING)) {
                        priority += 1.5; // Hollow King fusion fica disponível
                    }
                    if (hasPoly && extraIds.includes(VOID_IDS.HYDRA_TITAN)) {
                        priority += 1.0; // material para Hydra
                    }
                    priority +=
                        hollowResourcePolicy.spend?.haunterRevive?.scoreDelta ??
                            (preserveHollowsForFinisher ? -3.0 : 0);
                    break;
                }
                default: {
                    // Outros GY ignitions desconhecidos — fallback conservador
                    priority = 3.0;
                }
            }
            return { yes: priority > 0, priority };
        },
        buildActivationContext: () => voidActivationContext,
    }));
    const fieldSpellActions = getGenericIgnitionEffectActions({
        game, player: bot, analysis, cards: bot.fieldSpell ? [bot.fieldSpell] : [],
        type: "fieldEffect", sourceZone: "fieldSpell", indexFields: [],
        cardFilter: () => true,
        findEffect: card => findSpellActivationEffect(card, null, { timings: ["on_field_activate"] }),
        validateCandidate: ({ card, effect }) => {
            if (!isSimulatedState && game.effectEngine?.checkOncePerTurn?.(card, bot, effect)?.ok === false)
                return false;
            if (effect.requireEmptyField && bot.field && bot.field.length > 0)
                return false;
            if (card.id === VOID_IDS.THE_VOID) {
                return (bot.graveyard || []).some(candidate => candidate?.cardKind === "monster" && isVoid(candidate) && (candidate.level || 0) <= 4);
            }
            return true;
        },
        shouldActivate: () => ({ yes: true, priority: 6 }),
        buildActivationContext: () => voidActivationContext,
    });
    for (const action of fieldSpellActions) {
        // This action historically binds the field slot without a cardId.
        const { cardId: _cardId, ...fieldAction } = action;
        actions.push(fieldAction);
    }
    const positionActions = this.getPositionChangeActions(game, bot as SimulatedPlayerState, opponent);
    if (positionActions.length > 0) {
        actions.push(...positionActions);
    }
    return this.integrateP2IntoActionSelection(game, this.sequenceActions(actions));
}
export function sequenceVoidActions(actions: AIAction[]) {
    // Sequenciamento inteligente baseado em combos
    const sorted = actions.sort((a, b) => {
        const planA = Number.isFinite(a.finisherPlanRank)
            ? a.finisherPlanRank!
            : -1;
        const planB = Number.isFinite(b.finisherPlanRank)
            ? b.finisherPlanRank!
            : -1;
        if (planA !== planB)
            return planB - planA;
        // 1. Extra deck actions (fusão/ascensão) têm prioridade especial
        const extraA = a.extraDeck ? 1 : 0;
        const extraB = b.extraDeck ? 1 : 0;
        if (extraA !== extraB)
            return extraB - extraA;
        // 2. Dentro de mesma categoria, ordenar por prioridade
        const priorityA = a.priority ?? 0;
        const priorityB = b.priority ?? 0;
        // 3. Desempate: preferir summons antes de spells (setup antes de payoff)
        if (priorityA === priorityB) {
            const typeOrder: Partial<Record<AIAction["type"], number>> = {
                summon: 3,
                handIgnition: 2,
                spell: 1,
                position_change: 0,
            };
            return (typeOrder[b.type] || 0) - (typeOrder[a.type] || 0);
        }
        return priorityB - priorityA;
    });
    return sorted;
}
