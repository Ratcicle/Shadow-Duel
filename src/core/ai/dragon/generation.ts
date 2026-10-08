// Dragon candidate policies composed with shared action generation.
import { getNormalSummonTributeOptions } from "../../game/summon/tributeValue.js";
import { getCounterCount } from "../common/counters.js";
import { canUseSimulatedEffectUsage } from "../common/simStateUtils.js";
import type { AIAction, AIActivationContext, AIState, AIStrategyBotPort } from "../../contracts/ai.js";
import type { CanonicalZone } from "../../contracts/zones.js";
import type { DragonCard, DragonPlayer, DragonGame, DragonAnalysis, DragonPolicyContext, DragonPreference } from "./contracts.js";
import type { PreviewGamePort } from "../common/previewGuards.js";
import { applyMacroAndSafety, buildPrioritizedAction, getGenericCostlessHandSummonActions, getGenericNormalSummonActions, getGenericHandSpellActions, getGenericIgnitionEffectActions } from "../common/actionGeneration.js";
import { getGenericSetBackrowActions } from "../common/backrowPlanning.js";
import { findIgnitionEffect, findIgnitionEffects, hasOncePerTurnEffect } from "../common/effectDiscovery.js";
import { effectTargetsAvailable } from "../common/targetAvailability.js";
import { canActivateFieldSpellEffect, canActivateMonsterEffect, canActivateSpellFromHand, canActivateSpellTrapEffect, checkOncePerTurnIfRealGame } from "../common/previewGuards.js";
import { buildAutoActivationContext } from "../common/preferencePolicy.js";
import { calculateMacroPriorityBonus } from "../MacroPlanning.js";
import { evaluateActionBlockingRisk, assessActionSafety } from "../ChainAwareness.js";
import { getDragonStrategicCardValue, CURRENT_AWAKENING_TARGET_NAMES, isExtremeDragon, isOutOfPlanDragonCardName } from "./knowledge.js";
import { shouldPlaySpell, shouldSummonMonster, selectBestTributes, evaluateTributeTrade } from "./priorities.js";
import { buildDragonCostPreferences, buildDragonTargetCostPreferences } from "./costPolicy.js";
import { buildDragonBanishTargetPreferences, shouldUsePurifiedBanishSummon, shouldUseStelyaBanishSummon } from "./banishPolicy.js";
import { evaluateDragonGraveyardIgnition, evaluateDragonHandIgnition } from "./actionPolicy.js";
import { DRAGON_BOSS_POLICY_NAMES, buildDragonBossPreferenceMap, buildDragonBossTargetPreference, rankDragonBossCandidates, selectBestDragonBoss } from "./bossPolicy.js";
import { buildDragonExtraDeckActionContext, selectDragonFusionPlan } from "./extraDeckPolicy.js";
import { buildDragonDefenseTargetPreferences, getLuminescentBattleDebuffPlan, getMajesticBattlePositionPlan, scoreDragonBackrowSet, shouldRecheckBossBeforeBattle } from "./battleDefensePolicy.js";
import { getEffectiveAtk } from "../common/cardStats.js";
import { getProjectedBoneflameAtk, getValidBoneflameCostCandidates } from "./boneflamePolicy.js";
import { applyDragonRetentionPriorities } from "./linePlanning.js";
import type DragonStrategy from "../DragonStrategy.js";
export interface DragonStrategyGame extends Omit<DragonGame, "player" | "bot" | "opponent" | "_gameRef"> {
    bot: AIStrategyBotPort;
    player: AIStrategyBotPort;
    opponent?: AIStrategyBotPort | null;
    _gameRef?: DragonStrategyGame;
    effectEngine?: NonNullable<PreviewGamePort["effectEngine"]> & {
        usedThisTurn?: ReadonlyMap<string, number>;
    } | null;
    canActivatePolymerization?(): boolean;
}
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
const AWAKENING_TARGET_ORDER = [...CURRENT_AWAKENING_TARGET_NAMES];
const EXTREME_GY_SEND_ORDER = [
    "Volcanic Extreme Dragon",
    "Fire Extreme Dragon",
];
function isCurrentDragonListMode(analysis: DragonAnalysis = {}) {
    return analysis?.currentDragonBotList !== false;
}
function uniqueNames(names: Array<string | undefined> = []): string[] {
    return [...new Set((names || []).filter(Boolean))] as string[];
}
function mergePreferenceArrays<Value>(...arrays: Array<Value[] | null | undefined>) {
    return [
        ...new Set(arrays
            .flatMap((value) => value || [])
            .filter((value) => value !== undefined && value !== null && value !== "")),
    ];
}
function mergeCostPreferences(base: DragonPreference = {}, patch: DragonPreference = {}) {
    return {
        ...(base || {}),
        ...(patch || {}),
        preferNames: mergePreferenceArrays(base.preferNames, patch.preferNames),
        forceNames: mergePreferenceArrays(base.forceNames, patch.forceNames),
        preserveNames: mergePreferenceArrays(base.preserveNames, patch.preserveNames),
        avoidNames: mergePreferenceArrays(base.avoidNames, patch.avoidNames),
        preferredInstanceIds: mergePreferenceArrays(base.preferredInstanceIds, patch.preferredInstanceIds),
        avoidInstanceIds: mergePreferenceArrays(base.avoidInstanceIds, patch.avoidInstanceIds),
        offensivePayoffNames: mergePreferenceArrays(base.offensivePayoffNames, patch.offensivePayoffNames),
    };
}
function mergeTargetPreference(base: DragonPreference = {}, patch: DragonPreference = {}) {
    return {
        ...(base || {}),
        ...(patch || {}),
        preferNames: mergePreferenceArrays(base.preferNames, patch.preferNames),
        preferredNames: mergePreferenceArrays(base.preferredNames, patch.preferredNames),
        forceNames: mergePreferenceArrays(base.forceNames, patch.forceNames),
        preserveNames: mergePreferenceArrays(base.preserveNames, patch.preserveNames),
        avoidNames: mergePreferenceArrays(base.avoidNames, patch.avoidNames),
        preferredInstanceIds: mergePreferenceArrays(base.preferredInstanceIds, patch.preferredInstanceIds),
        avoidInstanceIds: mergePreferenceArrays(base.avoidInstanceIds, patch.avoidInstanceIds),
    };
}
function mergeTargetPreferenceMaps(base: Record<string, DragonPreference | undefined> = {}, patch: Record<string, DragonPreference | undefined> = {}) {
    const merged = { ...(base || {}) };
    for (const [key, value] of Object.entries(patch || {})) {
        merged[key] = mergeTargetPreference(merged[key] || {}, value || {});
    }
    return merged;
}
function isDragonMonster(card: DragonCard) {
    return card?.cardKind === "monster" && card.type === "Dragon";
}
function isFaceupDragon(card: DragonCard) {
    return isDragonMonster(card) && !card.isFacedown;
}
function cardArchetypes(card: DragonCard) {
    if (!card)
        return [];
    if (Array.isArray(card.archetypes))
        return card.archetypes;
    return card.archetype ? [card.archetype] : [];
}
function hasArchetype(card: DragonCard, archetype: string) {
    return cardArchetypes(card).includes(archetype);
}
const cardStrategicValue = getDragonStrategicCardValue;
function threatScore(card: DragonCard) {
    if (!card)
        return 0;
    let score = Math.max(card.atk || 0, card.def || 0) / 500;
    score += (card.level || 0) * 0.35;
    if (card.monsterType === "fusion" || card.monsterType === "ascension") {
        score += 5;
    }
    if ((card.effects || []).length > 0)
        score += 1;
    return score;
}
function rankCardsByThreat(cards: readonly DragonCard[] = []) {
    return (cards || [])
        .filter((card) => card && card.cardKind === "monster")
        .slice()
        .sort((a, b) => threatScore(b) - threatScore(a));
}
function rankOwnDragonsByValue(cards: readonly DragonCard[] = []) {
    return (cards || [])
        .filter(isFaceupDragon)
        .slice()
        .sort((a, b) => cardStrategicValue(b) - cardStrategicValue(a));
}
function countCards(cards: readonly DragonCard[] = [], predicate: (card: DragonCard) => boolean = () => true) {
    return (cards || []).filter((card) => card && predicate(card)).length;
}
function hasNamedCard(cards: readonly DragonCard[] = [], name: string) {
    return (cards || []).some((card) => card?.name === name);
}
function getCardInstanceId(card: DragonCard) {
    return (card?.instanceId ??
        card?._instanceId ??
        card?.uuid ??
        card?.simInstanceId ??
        null);
}
export function buildDragonActionContext(extra: DragonPolicyContext = {}) {
    const dynamicCostPreferences = buildDragonCostPreferences(extra);
    let costPreferences = mergeCostPreferences(dynamicCostPreferences, extra.costPreferences || {});
    const extraDeckContext = buildDragonExtraDeckActionContext({
        ...extra,
        costPreferences,
    });
    costPreferences = mergeCostPreferences(costPreferences, extraDeckContext.costPreferences || {});
    const baseTargetPreferences = mergeTargetPreferenceMaps(mergeTargetPreferenceMaps(mergeTargetPreferenceMaps(buildDragonTargetCostPreferences({
        ...extra,
        costPreferences,
    }), buildDragonBanishTargetPreferences({
        ...extra,
        costPreferences,
    })), buildDragonDefenseTargetPreferences({
        ...extra,
        costPreferences,
    })), buildDragonBossPreferenceMap({
        ...extra,
        costPreferences,
    }));
    const targetPreferences = mergeTargetPreferenceMaps(mergeTargetPreferenceMaps(baseTargetPreferences, extraDeckContext.targetPreferences || {}), extra.targetPreferences || {});
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
export function buildActivationContext(zone: CanonicalZone, actionContext: ReturnType<typeof buildDragonActionContext> | null = null, extra: Partial<AIActivationContext> = {}) {
    return buildAutoActivationContext({
        zone,
        fromHand: zone === "hand",
        actionContext: actionContext || {},
        includeActionContext: !!actionContext,
        extra,
    });
}
function hasLuminousFollowUp(bot: DragonPlayer) {
    const names = new Set((bot.hand || []).map((card) => card?.name!));
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
function hasRainbowGyFollowUp(bot: DragonPlayer) {
    if (hasNamedCard(bot.hand, "Call of the Haunted"))
        return true;
    if (hasNamedCard(bot.spellTrap, "Call of the Haunted"))
        return true;
    if ((bot.field || []).some((card) => card?.name === "Luminous Dragon" && !card.isFacedown)) {
        return true;
    }
    const hasFieldDragon = (bot.field || []).some(isFaceupDragon);
    const hasEclipseRevive = hasNamedCard(bot.graveyard, "Solar Eclipse Dragon") ||
        hasNamedCard(bot.graveyard, "Lunar Eclipse Dragon");
    const hasStelyaRevive = hasNamedCard(bot.graveyard, "Stelya, Dragon Tamer") && hasFieldDragon;
    if (hasEclipseRevive || hasStelyaRevive)
        return true;
    if (bot.fieldSpell?.name === "Jagged Peak of the Dragons")
        return true;
    return hasNamedCard(bot.hand, "Hellkite Dragon");
}
function getFieldDragonCostNames(bot: DragonPlayer, { preserveExtremes = true } = {}) {
    return (bot.field || [])
        .filter((card) => isFaceupDragon(card) && (!preserveExtremes || !isExtremeDragon(card)))
        .slice()
        .sort((a, b) => cardStrategicValue(a) - cardStrategicValue(b))
        .map((card) => card.name!);
}
function getBestAwakeningTarget(bot: DragonPlayer, opponent: DragonPlayer, analysis: DragonAnalysis) {
    const fieldDragons = (bot.field || []).filter(isFaceupDragon);
    const hasExtremeFaceup = fieldDragons.some(isExtremeDragon);
    const candidates = (bot.hand || []).filter((card) => isDragonMonster(card) &&
        (card.level || 0) >= 8 &&
        (!hasExtremeFaceup || !isExtremeDragon(card)));
    if (candidates.length === 0)
        return null;
    return selectBestDragonBoss(candidates, {
        analysis,
        player: bot,
        bot,
        opponent,
        routeKind: "awakening",
        fieldCostCount: 2,
    });
}
function hasUsefulJaggedPeakSearch(bot: DragonPlayer) {
    if (bot.fieldSpell?.name === "Jagged Peak of the Dragons")
        return false;
    return (bot.deck || []).some((card) => card?.name === "Jagged Peak of the Dragons");
}
export function generateDragonMainPhaseActions(this: DragonStrategy, gameInput: AIState): AIAction[] {
    const game = gameInput as DragonStrategyGame;
    const analysis = this.analyzeGameState(game);
    const actions: AIAction[] = [];
    const isSimulatedState = game._isPerspectiveState === true;
    const bot = isSimulatedState ? game.bot : this.bot || game.bot;
    const actualGame = game;
    const opponent = this.getOpponent(isSimulatedState ? game : actualGame, bot);
    const shouldLog = !isSimulatedState;
    const log = (msg: string) => shouldLog && this.think(msg);
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
    const addedSpellNames = new Set<string>();
    (bot.hand || []).forEach((card, index) => {
        let spellActivationContext: AIActivationContext | null = null;
        let extras: {
            macroBuff: number;
            safetyScore: number | null;
        } | undefined;
        actions.push(...getGenericHandSpellActions({
            game: gameInput, player: bot, entries: [{ card, sourceIndex: index }], analysis,
            shouldPlay: card => {
                const extraDeckPlan = card.name === "Polymerization"
                    ? selectDragonFusionPlan({
                        analysis,
                        player: bot,
                        bot,
                        opponent,
                        game: actualGame,
                    })
                    : null;
                if (card.name === "Polymerization" && !extraDeckPlan?.ok) {
                    log(`  ⏭️ Polymerization held: ${extraDeckPlan?.reason || "no approved Extra Deck payoff"}`);
                    return { yes: false };
                }
                spellActivationContext = {
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
                if (hasOncePerTurn && addedSpellNames.has(card.name!)) {
                    log(`  ⏭️ Skipping duplicate 1/turn spell: ${card.name}`);
                    return { yes: false };
                }
                // Validate activatability in real game
                if (!isSimulatedState) {
                    if (!canActivateSpellFromHand(actualGame, card, bot, spellActivationContext)) {
                        return { yes: false };
                    }
                    if (card.name === "Polymerization") {
                        const canActivate = actualGame.canActivatePolymerization?.() ?? false;
                        if (!canActivate) {
                            log(`  ⚠️ Polymerization blocked: no valid fusion materials`);
                            return { yes: false };
                        }
                    }
                }
                const decision = card.name === "Polymerization" && extraDeckPlan?.ok
                    ? {
                        yes: true,
                        priority: extraDeckPlan.priority! +
                            (shouldRecheckBossBeforeBattle({
                                analysis,
                                player: bot,
                                bot,
                                opponent,
                                game: actualGame,
                            })
                                ? 2
                                : 0),
                        reason: extraDeckPlan.reason,
                    }
                    : shouldPlaySpell(card, analysis);
                if (decision.yes) {
                    log(`  ✅ Spell: ${card.name} — ${decision.reason}`);
                    if (hasOncePerTurn)
                        addedSpellNames.add(card.name!);
                    const safety = assessActionSafety({ bot, player: opponent }, bot, opponent, "spell", card);
                    const { priority: finalPriority, macroBuff, safetyScore } = applyMacroAndSafety({
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
                    extras = { macroBuff, safetyScore };
                    return { yes: true, priority: finalPriority };
                }
                else {
                    log(`  ❌ Spell: ${card.name} — ${decision.reason}`);
                }
                return { yes: false };
            },
            buildActivationContext: () => spellActivationContext,
            extra: () => extras || {},
        }));
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
                const dragonBackrow = scoreDragonBackrowSet(card, {
                    analysis,
                    player: bot,
                    bot,
                    opponent,
                    game: actualGame,
                });
                return dragonBackrow?.priority ?? 6;
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
                if (!isExtremeDragon(card))
                    return;
                if (card.cannotBeNormalSummonedOrSet)
                    return;
                if (getNormalSummonTributeOptions(bot, card).length === 0)
                    return;
                // Level 10 → 2 tributes (standard lv7+ rule)
                const tributesNeeded = this.getTributeRequirementFor(card, bot).tributesNeeded;
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
                const tributedCards = tributeIndices
                    .flatMap((i) => {
                    const tribute = fieldMonsters[i];
                    return tribute ? [tribute] : [];
                });
                if (tributedCards.length === 0)
                    return;
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
                if (beatsThreat && oppHasMultipleThreats)
                    priority = 15;
                else if (beatsThreat)
                    priority = Math.max(priority, 14);
                else if (oppHasMultipleThreats)
                    priority = Math.max(priority, 12);
                if (fieldMonsters.length === tributesNeeded)
                    priority += 2;
                log(`  ✅ Extreme Tribute: ${card.name} (${extremeATK} ATK) — tributing ${tributedCards.map((m) => m.name!).join(", ")} (priority ${priority})`);
                const macroBuff = calculateMacroPriorityBonus("summon", card, macroStrategy);
                actions.push(buildPrioritizedAction({
                    type: "summon", index, card, priority: priority + macroBuff,
                    sourceBinding: { controllerId: bot.id, zone: "hand", game },
                    extra: { position: "attack", facedown: false, macroBuff, isExtremeTribute: true },
                }));
            });
        }
    }
    // === NORMAL SUMMON ACTIONS ===
    if (analysis.canNormalSummon) {
        (bot.hand || []).forEach((card, index) => {
            if (card.cardKind !== "monster")
                return;
            if (card.cannotBeNormalSummonedOrSet)
                return;
            // Extreme Dragons are handled in the dedicated tribute section above
            if (isExtremeDragon(card))
                return;
            const summonMetadata: {
                position?: "attack" | "defense";
                facedown?: boolean;
                macroBuff?: number;
                safetyScore?: number | null;
            } = {};
            const generated = getGenericNormalSummonActions({
                player: bot, summonPlayer: bot, entries: [{ card, sourceIndex: index }], analysis: { canNormalSummon: true },
                getTributeRequirement: () => this.getTributeRequirementFor(card, bot),
                shouldSummon: () => {
                    const tributeInfo = this.getTributeRequirementFor(card, bot);
                    const decision = shouldSummonMonster(card, analysis, tributeInfo, {
                        field: bot.field || [],
                        oppField: opponent?.field || [],
                    });
                    const bossRank = DRAGON_BOSS_POLICY_NAMES.includes(card.name!)
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
                        return { yes: false };
                    }
                    if (decision.yes) {
                        log(`  ✅ Summon: ${card.name} — ${decision.reason}`);
                        const safety = assessActionSafety({ bot, player: opponent }, bot, opponent, "summon", card);
                        const { priority: finalPriority, macroBuff, safetyScore } = applyMacroAndSafety({
                            basePriority: (decision.priority || 5) +
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
                        Object.assign(summonMetadata, {
                            position: decision.position,
                            facedown: decision.facedown !== undefined ? decision.facedown : decision.position === "defense",
                            macroBuff, safetyScore,
                        });
                        return { yes: true, priority: finalPriority };
                    }
                    else {
                        log(`  ❌ Summon: ${card.name} — ${decision.reason}`);
                        return { yes: false };
                    }
                },
                extra: summonMetadata,
            });
            actions.push(...generated);
        });
    }
    // === HAND IGNITION ACTIONS ===
    // Monsters with ignition effects activatable from hand.
    // This layer only decides when the bot should offer the declarative effect.
    (bot.hand || []).forEach((card, index) => {
        if (card.cardKind !== "monster")
            return;
        const effectMetadata = new Map<string, {
            activationContext: AIActivationContext;
            macroBuff: number;
        }>();
        const generated = getGenericIgnitionEffectActions({
            game: gameInput, player: bot, entries: [{ card, sourceIndex: index }], analysis,
            type: "handIgnition", sourceZone: "hand", includeEffectId: true,
            findEffects: () => findIgnitionEffects(card, "hand"),
            validateCandidate: () => true,
            shouldActivate: (_source, _analysis, { effect: handIgnitionEffect }) => {
                // Check if cost targets exist in field
                const targets = handIgnitionEffect.targets || [];
                const costTarget = targets.find((t) => t.zone === "field");
                if (costTarget) {
                    const fieldCards = bot.field || [];
                    const hasValidCost = fieldCards.some((fieldCard) => {
                        if (fieldCard.cardKind !== "monster")
                            return false;
                        if (costTarget.cardName && fieldCard.name !== costTarget.cardName)
                            return false;
                        if (costTarget.archetype && !hasArchetype(fieldCard, costTarget.archetype))
                            return false;
                        if (costTarget.filters?.type && fieldCard.type !== costTarget.filters.type)
                            return false;
                        return true;
                    });
                    if (!hasValidCost) {
                        log(`  ⏭️ Hand ignition ${card.name}: no valid field cost`);
                        return { yes: false };
                    }
                }
                // Check GY cost targets (Purified Crystal Dragon: banish 3 GY dragons)
                const gyCostTarget = targets.find((t) => t.zone === "graveyard");
                if (gyCostTarget) {
                    const gyCards = bot.graveyard || [];
                    const minCount = gyCostTarget.count?.min || 1;
                    const gyMatches = gyCards.filter((c) => {
                        if (gyCostTarget.cardKind && c.cardKind !== gyCostTarget.cardKind)
                            return false;
                        if (gyCostTarget.type && c.type !== gyCostTarget.type)
                            return false;
                        return true;
                    });
                    if (gyMatches.length < minCount) {
                        log(`  ⏭️ Hand ignition ${card.name}: insufficient GY targets (need ${minCount}, have ${gyMatches.length})`);
                        return { yes: false };
                    }
                }
                // Check once-per-turn
                if (!isSimulatedState) {
                    const optCheck = checkOncePerTurnIfRealGame(actualGame, card, bot, handIgnitionEffect);
                    if (!optCheck?.ok) {
                        log(`  ⏭️ Hand ignition ${card.name}: already used this turn`);
                        return { yes: false };
                    }
                }
                const needsMonsterZone = (handIgnitionEffect.actions || []).some((action) => action?.type === "special_summon_from_zone");
                const freesMonsterZone = (handIgnitionEffect.actions || []).some((action) => Number((action as {
                    fieldSlotsFreedBeforeSummon?: number;
                })?.fieldSlotsFreedBeforeSummon || 0) > 0);
                if (analysis.fieldCapacity <= 0 && needsMonsterZone && !freesMonsterZone && !gyCostTarget && !costTarget) {
                    // Might be trying to SS itself without first freeing a field slot.
                    log(`  ⏭️ Hand ignition ${card.name}: field full`);
                    return { yes: false };
                }
                // Calculate priority
                let priority = 7;
                let targetPreferences: Record<string, DragonPreference | undefined> = {};
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
                        return { yes: false };
                    }
                    priority = policyDecision.priority ?? priority;
                    targetPreferences = {
                        ...targetPreferences,
                        ...(policyDecision.targetPreferences || {}),
                    };
                    log(`  ✅ Hand ignition: ${card.name} → ${policyDecision.reason}`);
                }
                else if (card.name === "Hellkite Dragon") {
                    // Only worthwhile if there's a field Dragon weaker than Hellkite (2300) to sacrifice
                    const fieldDragons = (bot.field || []).filter(isFaceupDragon);
                    const hasCheapCost = fieldDragons.some((c) => !isExtremeDragon(c) && (c.atk || 0) < (card.atk || 2300));
                    if (!hasCheapCost) {
                        log(`  ⏭️ Hand ignition: Hellkite Dragon — no expendable Dragon cost`);
                        return { yes: false };
                    }
                    priority = 8 + ((bot.graveyard || []).some(isDragonMonster) ? 1 : 0);
                    targetPreferences.hellkite_cost_field_dragon = {
                        role: "cost",
                        preferNames: getFieldDragonCostNames(bot),
                        preserveNames: DRAGON_COST_PRESERVE_NAMES,
                    };
                    log(`  ✅ Hand ignition: Hellkite Dragon → 2300 ATK, GY setup`);
                }
                else if (card.name === "Purified Crystal Dragon") {
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
                        return { yes: false };
                    }
                    priority = purifiedDecision.priority!;
                    targetPreferences.purified_banish_cost = purifiedDecision.targetPreference;
                    log(`  ✅ Hand ignition: Purified Crystal Dragon → 2500 ATK (banish GY Dragons)`);
                }
                else {
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
                effectMetadata.set(handIgnitionEffect.id, { activationContext, macroBuff });
                return { yes: true, priority };
            },
            buildActivationContext: (_source, _analysis, { effect }) => effectMetadata.get(effect.id)?.activationContext || null,
        });
        for (const action of generated) {
            const metadata = action.effectId ? effectMetadata.get(action.effectId) : undefined;
            actions.push({ ...action, ...(metadata ? { macroBuff: metadata.macroBuff } : {}) });
        }
    });
    for (const action of getGenericCostlessHandSummonActions(gameInput)) {
        if (action.cardName !== "Luminous Dragon")
            continue;
        const priority = (hasLuminousFollowUp(bot) ? 10 : 6) + ((opponent?.field || []).length > 0 ? 1 : 0);
        actions.push({ ...action, priority });
    }
    // === FIELD MONSTER IGNITION ACTIONS ===
    (bot.field || []).forEach((card, fieldIndex) => {
        let activationContext: AIActivationContext | null = null;
        let macroBuff = 0;
        actions.push(...getGenericIgnitionEffectActions({
            game: gameInput, player: bot, entries: [{ card, sourceIndex: fieldIndex }], analysis,
            type: "monsterEffect", sourceZone: "field", indexFields: ["fieldIndex"], includeEffectId: true,
            cardFilter: candidate => candidate.cardKind === "monster" && !candidate.isFacedown,
            validateCandidate: () => true,
            findEffect: candidate => findIgnitionEffect(candidate, "field"),
            shouldActivate: (card, _analysis, { effect: ignition }) => {
                if (isCurrentDragonListMode(analysis) && isOutOfPlanDragonCardName(card.name!))
                    return { yes: false };
                if (isSimulatedState && ignition.oncePerTurnScope === "card" &&
                    !canUseSimulatedEffectUsage(gameInput, ignition, card, bot.id, true))
                    return { yes: false };
                let priority: number | null = null;
                const targetPreferences: Record<string, DragonPreference | undefined> = {};
                const oppTargets = rankCardsByThreat(opponent?.field || []);
                const bestOwnDragons = rankOwnDragonsByValue(bot.field || []);
                if (card.name === "Abyssal Serpent Dragon") {
                    if (oppTargets.length === 0)
                        return { yes: false };
                    const topTarget = oppTargets[0];
                    if (!topTarget)
                        return { yes: false };
                    priority = 7 + (topTarget.monsterType === "fusion" || topTarget.monsterType === "ascension" ? 3 : 0);
                    if ((topTarget.atk || 0) >= (card.atk || 0))
                        priority += 2;
                    targetPreferences.abyssal_target = {
                        role: "removal",
                        preferredNames: oppTargets.slice(0, 3).map((target) => target.name!),
                    };
                }
                else if (card.name === "Darkness Dragon") {
                    if ((bot.hand || []).length === 0 || oppTargets.length === 0)
                        return { yes: false };
                    const topTarget = oppTargets[0];
                    if (!topTarget)
                        return { yes: false };
                    priority = 6 + (threatScore(topTarget) >= 8 ? 2 : 0);
                    targetPreferences.darkness_dragon_discard_cost = {
                        role: "cost",
                        preferNames: DRAGON_COST_PREFER_NAMES,
                        preserveNames: DRAGON_COST_PRESERVE_NAMES,
                    };
                    targetPreferences.darkness_dragon_negate_target = {
                        role: "removal",
                        preferredNames: oppTargets.slice(0, 3).map((target) => target.name!),
                    };
                }
                else if (card.name === "Majestic Silver Dragon") {
                    const majesticPlan = getMajesticBattlePositionPlan({
                        source: card,
                        opponentField: oppTargets,
                        bot,
                        opponent,
                        analysis,
                    });
                    if (!majesticPlan?.ok)
                        return { yes: false };
                    priority = 7 + majesticPlan.priorityBonus;
                    targetPreferences.majestic_position_target = {
                        role: "removal",
                        preferredNames: majesticPlan.preferredNames,
                    };
                }
                else if (card.name === "Hellkite Dragon") {
                    const gyTargets = (bot.graveyard || [])
                        .filter((candidate) => isDragonMonster(candidate) && (candidate.level || 0) <= 7)
                        .sort((a, b) => {
                        const bossDiff = (rankDragonBossCandidates([b], {
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
                    const topTarget = gyTargets[0];
                    if (!topTarget)
                        return { yes: false };
                    const bossPref = buildDragonBossTargetPreference(gyTargets, { analysis, player: bot, bot, opponent, routeKind: "recursion" }, "recursion");
                    priority = 8 + (topTarget.atk || 0) / 1000;
                    if (topTarget.name && bossPref.preferredNames?.includes(topTarget.name))
                        priority += 2;
                    targetPreferences.hellkite_dragon_field_revive = {
                        role: "recursion",
                        purpose: "pressure",
                        preferredNames: uniqueNames([
                            ...(bossPref.preferredNames || []),
                            ...gyTargets.slice(0, 4).map((target) => target.name!),
                        ]),
                        offensiveNames: uniqueNames([
                            ...(bossPref.offensiveNames || []),
                            ...gyTargets.slice(0, 4).map((target) => target.name!),
                        ]),
                        preferredInstanceIds: bossPref.preferredInstanceIds,
                    };
                }
                else if (card.name === "Purified Crystal Dragon") {
                    const protectTargets = bestOwnDragons.filter((target) => target !== card);
                    if (protectTargets.length === 0)
                        return { yes: false };
                    const protectTarget = protectTargets[0];
                    if (!protectTarget)
                        return { yes: false };
                    priority = 7 + (protectTarget.atk || 0) / 1200;
                    targetPreferences.purified_protection_target = {
                        role: "named_preference",
                        preferredNames: protectTargets.slice(0, 4).map((target) => target.name!),
                    };
                }
                else if (card.name === "Rainbow Cosmic Dragon") {
                    if (bestOwnDragons.length === 0)
                        return { yes: false };
                    priority = 9 + ((opponent?.field || []).length > 0 ? 2 : 0);
                    targetPreferences.rainbow_cosmic_protection_target = {
                        role: "named_preference",
                        preferredNames: bestOwnDragons.slice(0, 4).map((target) => target.name!),
                    };
                }
                else if (card.name === "Volcanic Extreme Dragon") {
                    const ownGyCount = (bot.graveyard || []).length;
                    const oppGyCount = (opponent?.graveyard || []).length;
                    const totalGyCount = ownGyCount + oppGyCount;
                    const projectedBurn = totalGyCount * 100;
                    const ownGyResourceCount = countCards(bot.graveyard || [], (candidate) => isDragonMonster(candidate) || candidate?.name === "Hellkite Roar");
                    const lethalBurn = projectedBurn >= (opponent?.lp || 8000);
                    if (!lethalBurn && oppGyCount < 5 && totalGyCount < 8)
                        return { yes: false };
                    if (!lethalBurn && ownGyResourceCount >= ownGyCount - 1 && oppGyCount < 5)
                        return { yes: false };
                    priority = lethalBurn ? 15 : 8 + Math.min(4, Math.floor(projectedBurn / 400));
                }
                else {
                    return { yes: false };
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
                activationContext = buildActivationContext("field", actionContext);
                if (!isSimulatedState && actualGame.effectEngine) {
                    if (!canActivateMonsterEffect(actualGame, card, bot, "field", activationContext)) {
                        return { yes: false };
                    }
                }
                else if (!effectTargetsAvailable(ignition, {
                    player: bot,
                    opponent,
                    source: card,
                    activationContext,
                })) {
                    return { yes: false };
                }
                macroBuff = calculateMacroPriorityBonus("monsterEffect", card, macroStrategy);
                log(`  Field ignition: ${card.name} (priority ${priority + macroBuff})`);
                return { yes: true, priority: priority + macroBuff };
            },
            buildActivationContext: () => activationContext,
            extra: () => ({ macroBuff }),
        }));
    });
    // === GRAVEYARD MONSTER IGNITION ACTIONS ===
    (bot.graveyard || []).forEach((card, graveyardIndex) => {
        let activationContext: AIActivationContext | null = null;
        actions.push(...getGenericIgnitionEffectActions({
            game: gameInput, player: bot, entries: [{ card, sourceIndex: graveyardIndex }], analysis,
            type: "graveyardMonsterEffect", sourceZone: "graveyard", indexFields: ["graveyardIndex"], includeEffectId: true,
            cardFilter: candidate => candidate.cardKind === "monster",
            validateCandidate: () => true,
            findEffect: candidate => findIgnitionEffect(candidate, "graveyard"),
            shouldActivate: (card, _analysis, { effect: graveyardIgnitionEffect }) => {
                if (isCurrentDragonListMode(analysis) && isOutOfPlanDragonCardName(card.name!))
                    return { yes: false };
                let targetPreferences: Record<string, DragonPreference | undefined> = {};
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
                        return { yes: false };
                    }
                    priority = policyDecision.priority ?? priority;
                    targetPreferences = {
                        ...targetPreferences,
                        ...(policyDecision.targetPreferences || {}),
                    };
                }
                else if (card.name === "Luminescent Dragon") {
                    const debuffPlan = getLuminescentBattleDebuffPlan({
                        bot,
                        player: bot,
                        opponent,
                        analysis,
                    });
                    if (!debuffPlan?.ok) {
                        log(`  Skipping Graveyard ignition: Luminescent Dragon - debuff does not change battle`);
                        return { yes: false };
                    }
                    priority = 7 + debuffPlan.priorityBonus;
                    targetPreferences.luminescent_debuff_target = {
                        role: "temporary_stat_debuff",
                        purpose: "combat",
                        atkReduction: 600,
                        defReduction: 600,
                        preferredNames: debuffPlan.preferredNames,
                        attackers: [debuffPlan.attacker],
                    };
                }
                else if (card.name === "Grey Dragon") {
                    const discardableDragons = (bot.hand || []).filter(isDragonMonster);
                    if (discardableDragons.length === 0)
                        return { yes: false };
                    const usefulDiscard = discardableDragons.some((candidate) => [
                        "Solar Eclipse Dragon",
                        "Lunar Eclipse Dragon",
                        "Stelya, Dragon Tamer",
                        "Voltaic Dragon",
                    ].includes(candidate.name!));
                    const luminousRecovery = (bot.field || []).some((candidate) => candidate?.name === "Luminous Dragon" && !candidate.isFacedown) &&
                        discardableDragons.some((discard) => (bot.graveyard || []).some((candidate) => isDragonMonster(candidate) && candidate.name !== discard.name));
                    if (!usefulDiscard && !luminousRecovery)
                        return { yes: false };
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
                                .map((candidate) => candidate.name!),
                        ]),
                        preserveNames: DRAGON_COST_PRESERVE_NAMES,
                    };
                }
                else if (card.name === "Black Bull Dragon") {
                    const searchTargets = (bot.deck || []).filter((candidate) => isDragonMonster(candidate) &&
                        (candidate.level || 0) >= 7 &&
                        (candidate.level || 0) <= 8);
                    if (searchTargets.length === 0)
                        return { yes: false };
                    priority = 8 + Math.min(2, searchTargets.length);
                }
                else if (card.name === "Stelya, Dragon Tamer") {
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
                        return { yes: false };
                    }
                    priority = stelyaDecision.priority! + 1;
                    targetPreferences.stelya_graveyard_banish_cost = stelyaDecision.targetPreference;
                }
                else if (card.name === "Boneflame Dragon") {
                    const validBoneflameCosts = getValidBoneflameCostCandidates(card, bot).sort((a, b) => getEffectiveAtk(a) - getEffectiveAtk(b) ||
                        cardStrategicValue(a) - cardStrategicValue(b));
                    if (validBoneflameCosts.length === 0) {
                        log(`  Skipping Graveyard ignition: Boneflame Dragon - no ATK-upgrade cost`);
                        return { yes: false };
                    }
                    const boneflameCost = validBoneflameCosts[0];
                    if (!boneflameCost)
                        return { yes: false };
                    const invalidCostIds = (bot.field || [])
                        .filter((candidate) => isFaceupDragon(candidate) &&
                        !validBoneflameCosts.includes(candidate))
                        .map(getCardInstanceId)
                        .filter((id) => id !== null);
                    const projectedAtk = getProjectedBoneflameAtk(card, boneflameCost, bot);
                    priority = 7 + Math.min(3, countCards(bot.graveyard || [], isDragonMonster));
                    priority += Math.min(2, Math.max(0, projectedAtk - getEffectiveAtk(boneflameCost)) /
                        600);
                    targetPreferences.boneflame_cost_target = {
                        role: "cost",
                        preferNames: uniqueNames(validBoneflameCosts.map((candidate) => candidate.name!)),
                        preferredInstanceIds: validBoneflameCosts
                            .map(getCardInstanceId)
                            .filter((id) => id !== null),
                        avoidInstanceIds: invalidCostIds,
                        preserveNames: uniqueNames([
                            ...DRAGON_COST_PRESERVE_NAMES,
                            "Supreme Bahamut Dragon",
                        ]),
                    };
                }
                else if (card.name === "Rainbow Cosmic Dragon") {
                    if (!hasRainbowGyFollowUp(bot))
                        return { yes: false };
                    const extremeDeckTargets = (bot.deck || []).filter((candidate) => isDragonMonster(candidate) && hasArchetype(candidate, "Extreme Dragons"));
                    if (extremeDeckTargets.length === 0)
                        return { yes: false };
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
                activationContext = buildActivationContext("graveyard", actionContext);
                if (!isSimulatedState && actualGame.effectEngine) {
                    const optCheck = checkOncePerTurnIfRealGame(actualGame, card, bot, graveyardIgnitionEffect);
                    if (!optCheck?.ok)
                        return { yes: false };
                    if (!canActivateMonsterEffect(actualGame, card, bot, "graveyard", activationContext)) {
                        return { yes: false };
                    }
                }
                else if ((graveyardIgnitionEffect.oncePerTurnScope === "card" &&
                    !canUseSimulatedEffectUsage(gameInput, graveyardIgnitionEffect, card, bot.id, true)) ||
                    !effectTargetsAvailable(graveyardIgnitionEffect, {
                        player: bot,
                        opponent,
                        source: card,
                        activationContext,
                    })) {
                    return { yes: false };
                }
                if ((graveyardIgnitionEffect.actions || []).some((action) => action?.type === "special_summon_from_zone" &&
                    action.zone === "graveyard" &&
                    action.requireSource === true)) {
                    priority += 2;
                }
                priority += calculateMacroPriorityBonus("graveyardMonsterEffect", card, macroStrategy);
                log(`  Graveyard ignition: ${card.name}`);
                return { yes: true, priority };
            },
            buildActivationContext: () => activationContext,
        }));
    });
    // === SPELL/TRAP-ZONE IGNITION ACTIONS ===
    (bot.spellTrap || []).forEach((card, zoneIndex) => {
        let activationContext: AIActivationContext | null = null;
        actions.push(...getGenericIgnitionEffectActions({
            game: gameInput, player: bot, entries: [{ card, sourceIndex: zoneIndex }], analysis,
            type: "spellTrapEffect", sourceZone: "spellTrap", indexFields: ["zoneIndex"], includeEffectId: true,
            cardFilter: candidate => candidate.cardKind === "spell" && !candidate.isFacedown,
            validateCandidate: () => true,
            findEffect: candidate => findIgnitionEffect(candidate, "spellTrap"),
            shouldActivate: (card, _analysis, { effect: ignition }) => {
                if (!isSimulatedState && actualGame.effectEngine) {
                    const opt = checkOncePerTurnIfRealGame(actualGame, card, bot, ignition);
                    if (!opt?.ok)
                        return { yes: false };
                }
                if (card.name === "Extreme Dragon Awakening") {
                    const fieldDragons = (bot.field || []).filter((c) => c?.cardKind === "monster" && !c.isFacedown && c.type === "Dragon");
                    const nonExtreme = fieldDragons.filter((c) => !isExtremeDragon(c));
                    const bestDragon = getBestAwakeningTarget(bot, opponent!, analysis);
                    if (nonExtreme.length < 2 || !bestDragon)
                        return { yes: false };
                    let priority = 12;
                    const bossRank = rankDragonBossCandidates([bestDragon], {
                        analysis,
                        player: bot,
                        bot,
                        opponent,
                        routeKind: "awakening",
                        fieldCostCount: 2,
                    })[0];
                    const oppStrongest = (opponent?.field || []).reduce((m, c) => Math.max(m, c.atk || 0), 0);
                    if ((bestDragon?.atk || 0) > oppStrongest)
                        priority = 14;
                    if (bestDragon.name === "Black Bull Dragon")
                        priority += 1;
                    if (bestDragon.name === "Purified Crystal Dragon" && analysis.lpRatio < 0.65)
                        priority += 1;
                    if (bestDragon.name === "Volcanic Extreme Dragon" && (opponent?.graveyard || []).length >= 4)
                        priority += 1;
                    if (bossRank)
                        priority += Math.min(3, Math.max(0, bossRank.score) / 45);
                    if (fieldDragons.length === 2 && isExtremeDragon(bestDragon))
                        priority += 2;
                    if (shouldRecheckBossBeforeBattle({
                        analysis,
                        player: bot,
                        bot,
                        opponent,
                        game: actualGame,
                    })) {
                        priority += 2;
                    }
                    if (analysis.canNormalSummon &&
                        (bot.hand || []).some((c) => c.name === "Armored Dragon" || c.name === "Luminescent Dragon")) {
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
                                    ...fieldDragons.filter(isExtremeDragon).map((candidate) => candidate.name!),
                                ]),
                            },
                            awakening_summon_dragon: {
                                role: "named_preference",
                                preferredNames: uniqueNames([
                                    bestDragon.name!,
                                    ...(buildDragonBossTargetPreference((bot.hand || []).filter((candidate) => isDragonMonster(candidate) &&
                                        (candidate.level || 0) >= 8), {
                                        analysis,
                                        player: bot,
                                        bot,
                                        opponent,
                                        routeKind: "awakening",
                                        fieldCostCount: 2,
                                    }).preferredNames || []),
                                    ...AWAKENING_TARGET_ORDER,
                                ]),
                            },
                        },
                    });
                    activationContext = buildActivationContext("spellTrap", actionContext);
                    if (!isSimulatedState && actualGame.effectEngine) {
                        if (!canActivateSpellTrapEffect(actualGame, card, bot, "spellTrap", activationContext)) {
                            return { yes: false };
                        }
                    }
                    log(`  Awakening ignition: SS ${bestDragon?.name} via 2 Dragon cost (priority ${priority})`);
                    return { yes: true, priority };
                }
                return { yes: false };
            },
            buildActivationContext: () => activationContext,
        }));
    });
    // === FIELD SPELL IGNITION ACTIONS ===
    const fieldSpell = bot.fieldSpell;
    if (fieldSpell?.name === "Jagged Peak of the Dragons") {
        let activationContext: AIActivationContext | null = null;
        actions.push(...getGenericIgnitionEffectActions({
            game: gameInput, player: bot, entries: [{ card: fieldSpell, sourceIndex: 0 }], analysis,
            type: "fieldEffect", sourceZone: "fieldSpell", indexFields: [], includeEffectId: true,
            cardFilter: () => true,
            validateCandidate: () => true,
            findEffect: card => findIgnitionEffect(card, "fieldSpell"),
            shouldActivate: (_card, _analysis, { effect: ignition }) => {
                const counters = getCounterCount(fieldSpell, "dragon_peak");
                if (counters >= 7 && (!isSimulatedState || ignition.oncePerTurnScope !== "card" ||
                    canUseSimulatedEffectUsage(gameInput, ignition, fieldSpell, bot.id, true))) {
                    const dragonCandidates = [
                        ...rankOwnDragonsByValue(bot.hand || []),
                        ...(bot.deck || []).filter(isDragonMonster).sort((a, b) => cardStrategicValue(b) - cardStrategicValue(a)),
                        ...(bot.graveyard || []).filter(isDragonMonster).sort((a, b) => cardStrategicValue(b) - cardStrategicValue(a)),
                    ];
                    const bossPref = buildDragonBossTargetPreference(dragonCandidates, {
                        analysis,
                        player: bot,
                        bot,
                        opponent,
                        routeKind: "jaggedPeak",
                    }, "recursion");
                    const preferredDragons = [
                        ...dragonCandidates
                            .filter((candidate) => bossPref.preferredNames?.includes(candidate.name!))
                            .sort((a, b) => bossPref.preferredNames.indexOf(a.name!) -
                            bossPref.preferredNames.indexOf(b.name!)),
                        ...dragonCandidates.filter((candidate) => !bossPref.preferredNames?.includes(candidate.name!)),
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
                                preferredNames: uniqueNames([
                                    ...(bossPref.preferredNames || []),
                                    ...preferredDragons.slice(0, 6).map((candidate) => candidate.name!),
                                ]),
                                offensiveNames: uniqueNames([
                                    ...(bossPref.offensiveNames || []),
                                    ...preferredDragons.slice(0, 6).map((candidate) => candidate.name!),
                                ]),
                                preferredInstanceIds: bossPref.preferredInstanceIds,
                            },
                        },
                    });
                    activationContext = buildActivationContext("fieldSpell", actionContext);
                    let canUsePeak = true;
                    if (!isSimulatedState && actualGame.effectEngine) {
                        canUsePeak = canActivateFieldSpellEffect(actualGame, fieldSpell, bot, activationContext);
                    }
                    else {
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
                        log(`  Field spell ignition: Jagged Peak cashout (priority ${priority})`);
                        return { yes: true, priority };
                    }
                }
                return { yes: false };
            },
            buildActivationContext: () => activationContext,
        }));
    }
    // === GRAVEYARD SPELL IGNITION ACTIONS ===
    (bot.graveyard || []).forEach((card, graveyardIndex) => {
        let activationContext: AIActivationContext | null = null;
        actions.push(...getGenericIgnitionEffectActions({
            game: gameInput, player: bot, entries: [{ card, sourceIndex: graveyardIndex }], analysis,
            type: "graveyardSpellEffect", sourceZone: "graveyard", indexFields: ["graveyardIndex"], includeEffectId: true,
            cardFilter: candidate => candidate.cardKind === "spell",
            validateCandidate: () => true,
            findEffect: candidate => findIgnitionEffect(candidate, "graveyard"),
            shouldActivate: (card, _analysis, { effect: ignition }) => {
                if (card.name !== "Hellkite Roar")
                    return { yes: false };
                if (!hasUsefulJaggedPeakSearch(bot))
                    return { yes: false };
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
                activationContext = buildActivationContext("graveyard", actionContext);
                if (!isSimulatedState && actualGame.effectEngine) {
                    if (!canActivateSpellTrapEffect(actualGame, card, bot, "graveyard", activationContext)) {
                        return { yes: false };
                    }
                }
                else if (!effectTargetsAvailable(ignition, {
                    player: bot,
                    opponent,
                    source: card,
                    activationContext,
                })) {
                    return { yes: false };
                }
                const priority = bot.fieldSpell ? 6 : 9;
                log(`  Graveyard spell ignition: Hellkite Roar -> Jagged Peak`);
                return { yes: true, priority };
            },
            buildActivationContext: () => activationContext,
        }));
    });
    // === STALEMATE BREAKER ===
    if (actions.length === 0 &&
        analysis.fieldCapacity > 0 &&
        !isSimulatedState &&
        (bot.summonCount || 0) < 1) {
        const realBot = this.bot || bot;
        log(`  ⚠️ STALEMATE BREAKER: forcing fallback summon...`);
        (realBot.hand || []).forEach((card, index) => {
            if (card.cardKind !== "monster")
                return;
            if (card.cannotBeNormalSummonedOrSet)
                return;
            if (isExtremeDragon(card))
                return; // Skip Extreme Dragons for normal stalemate
            const tributeInfo = this.getTributeRequirementFor(card, realBot);
            if ((realBot.field?.length || 0) < tributeInfo.tributesNeeded)
                return;
            if (tributeInfo.tributesNeeded > 0) {
                const tradeCheck = evaluateTributeTrade(card, realBot.field || [], tributeInfo.tributesNeeded, { oppField: opponent?.field || [] });
                if (!tradeCheck.ok)
                    return;
            }
            log(`    🔧 Fallback summon: ${card.name}`);
            actions.push(buildPrioritizedAction({
                type: "summon", index, card, priority: 1,
                sourceBinding: { controllerId: realBot.id, zone: "hand", game },
                extra: { position: "defense", facedown: true, isStalemateBreaker: true },
            }));
        });
    }
    // === SECONDARY FALLBACK: Force any spell if still no actions ===
    if (actions.length === 0 && !isSimulatedState) {
        const realBot2 = this.bot || bot;
        if ((realBot2.hand?.length || 0) > 3) {
            log(`  🆘 CRITICAL FALLBACK: forcing spell...`);
            (realBot2.hand || []).forEach((card, index) => {
                if (card.cardKind !== "spell")
                    return;
                const preview = actualGame.effectEngine?.canActivateSpellFromHandPreview?.(card, realBot2, {
                    activationContext: {
                        autoSelectTargets: true,
                        autoSelectSingleTarget: true,
                        logTargets: false,
                    },
                });
                if (preview && (preview as {
                    ok?: boolean;
                }).ok === false)
                    return;
                if (card.name === "Polymerization") {
                    const canActivate = actualGame.canActivatePolymerization?.() ?? false;
                    if (!canActivate)
                        return;
                    const extraDeckPlan = selectDragonFusionPlan({
                        analysis,
                        player: realBot2,
                        bot: realBot2,
                        opponent,
                        game: actualGame,
                    });
                    if (!extraDeckPlan?.ok)
                        return;
                }
                actions.push(buildPrioritizedAction({
                    type: "spell", index, card, priority: 0.5,
                    sourceBinding: { controllerId: realBot2.id, zone: "hand", game },
                    activationContext: {
                        autoSelectTargets: true,
                        autoSelectSingleTarget: true,
                        logTargets: false,
                    },
                    extra: { isCriticalFallback: true },
                }));
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
