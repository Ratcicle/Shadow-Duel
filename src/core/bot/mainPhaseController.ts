import { beamSearchTurn, greedySearchWithEvalV2 } from "../ai/BeamSearch.js";
import { turnLineSearch } from "../ai/TurnLineSearch.js";
import {
  compactPlanningDiffs,
  diffPlanningSummaries,
  fingerprintAction,
  isMeaningfulPlanningDiff,
  summarizePlanningState,
} from "../ai/common/planningDiagnostics.js";
import {
  filterAiActionsForCurrentPhase,
  isMain2Phase,
} from "../ai/common/phaseTiming.js";
import { runMainPhaseSession, type MainPhaseSession } from "./mainPhaseSession.js";
import { selectAutomaticAscensionAction } from "./ascensionController.js";
import { botLogger } from "../BotLogger.js";
import type { BotRuntimePort, BotGamePort } from "../contracts/bot.js";
import type {
  AIAction,
  AIPlannedAction,
  AIPlanningContext,
  AIPlanningProfile,
  TurnLineSearchResult,
} from "../contracts/ai.js";

function hasValue(value: unknown) {
  return value !== undefined && value !== null;
}

function resolvePlannerMode(
  game: BotGamePort,
  profile: Partial<AIPlanningProfile> = {},
) {
  const configuredMode = game?.turnLineSearchMode ?? game?.arenaPlannerMode;
  if (configuredMode === "off") return "off";
  if (configuredMode === "always") return "always";
  if (configuredMode === "critical") return "critical";
  if (game?.turnLineSearchEnabled === true) return "always";
  if (profile?.mode) return profile.mode;
  return profile?.enabled === true ? "critical" : "off";
}

export function playBotMainPhase(bot: BotRuntimePort, game: BotGamePort): Promise<void> {
  return runMainPhaseSession(bot, game, session => runMainPhase(bot, game, session));
}

async function runMainPhase(bot: BotRuntimePort, game: BotGamePort, session: MainPhaseSession): Promise<void> {
  session.recordProgress("bot_main_phase_enter", game, { actor: bot.id });
  const useV2Evaluation = true;
  const useAutomaticAscension = bot.strategy?.shouldUseAutomaticAscensionShortcut?.(game, bot) !== false;
  while (await session.waitUntilReady()) {
    if (!session.beginDecision()) return;
    const totalAttempts = session.counts.decisions;
    const stateBeforeDecision = session.capture();
    const suppressedBeforeDecision = session.counts.repetitionsSuppressed;
    if (useAutomaticAscension && !isMain2Phase(game)) {
      const ascension = selectAutomaticAscensionAction(bot, game,
        action => bot.filterValidActionsForCurrentState([action], game).length > 0 &&
          session.allowed(stateBeforeDecision, action));
      if (ascension) {
        const accepted = await session.execute(ascension, stateBeforeDecision);
        if (!session.active() || session.stopReason) return;
        if (accepted && !await session.presentationDelay()) return;
        continue;
      }
    }
    const planningStrategy = bot.strategy || bot;
    const rawActions = bot.generateMainPhaseActions(game);
    const sequencedActions = bot.sequenceActions(rawActions);
    const phaseFilteredActions = filterAiActionsForCurrentPhase(
      sequencedActions,
      {
        game,
        bot,
        player: bot,
        strategy: planningStrategy,
      },
    );

    const isPermitted = (action: AIPlannedAction): boolean => {
      const valid = action.type === "simulatedBattle" ? game.phase === "main1" :
        filterAiActionsForCurrentPhase([action], { game, bot, player: bot, strategy: planningStrategy }).length > 0 &&
          bot.filterValidActionsForCurrentState([action], game).length > 0;
      return valid && session.allowed(stateBeforeDecision, action);
    };
    const actions = phaseFilteredActions.filter(isPermitted);
    const fallbackActions = actions;
    session.recordProgress("ai_decision_before", game, {
      actor: bot.id, attempt: totalAttempts, rawActions: rawActions.length,
      sequencedActions: sequencedActions.length, actions: actions.length,
      fallbackActions: fallbackActions.length,
    });
    if (!actions.length) {
      session.stopReason = phaseFilteredActions.length || session.counts.repetitionsSuppressed > suppressedBeforeDecision
        ? "alternatives_exhausted" : "no_candidates";
      return;
    }
    let bestAction: AIPlannedAction | null = null;
    let pendingPlannerTrace: TurnLineSearchResult | null = null;

    const planningContext: AIPlanningContext & {
      game: BotGamePort;
      bot: BotRuntimePort;
      strategy: typeof planningStrategy;
      actions: AIAction[];
      fallbackActions: AIAction[];
      attempt: number;
      useV2Evaluation: boolean;
    } = {
      game,
      bot: bot,
      strategy: planningStrategy,
      actions,
      fallbackActions,
      attempt: totalAttempts,
      useV2Evaluation,
    };
    const planningProfile: Partial<AIPlanningProfile> =
      typeof planningStrategy.getPlanningProfile === "function"
        ? planningStrategy.getPlanningProfile(game, planningContext) || {}
        : {};
    planningContext.profile = planningProfile;
    const plannerMode = resolvePlannerMode(game, planningProfile);
    const plannerForced = plannerMode === "always";
    const explicitPlannerOptIn =
      plannerMode !== "off" &&
      (plannerForced || planningProfile.enabled === true);
    const shouldUsePlanner =
      explicitPlannerOptIn &&
      (plannerForced ||
        (typeof planningStrategy.shouldUseDeepPlanning === "function"
          ? planningStrategy.shouldUseDeepPlanning(game, planningContext)
          : true));

    if (shouldUsePlanner && actions.length > 0) {
      const plannerBeamWidth =
        (hasValue(game.turnLineSearchBeamWidth)
          ? game.turnLineSearchBeamWidth
          : undefined) ??
        planningProfile.beamWidth ??
        game.arenaPlannerBeamWidth ??
        game.turnLineSearchBeamWidth ??
        game.arenaBeamWidth ??
        2;
      const plannerMaxDepth =
        (hasValue(game.turnLineSearchMaxDepth)
          ? game.turnLineSearchMaxDepth
          : undefined) ??
        planningProfile.maxDepth ??
        game.arenaPlannerMaxDepth ??
        game.turnLineSearchMaxDepth ??
        game.arenaMaxDepth ??
        2;
      const plannerNodeBudget =
        (hasValue(game.turnLineSearchNodeBudget)
          ? game.turnLineSearchNodeBudget
          : undefined) ??
        planningProfile.nodeBudget ??
        game.arenaPlannerNodeBudget ??
        game.turnLineSearchNodeBudget ??
        game.arenaNodeBudget ??
        100;
      const plannerCandidateLimit =
        (hasValue(game.turnLineSearchCandidateLimit)
          ? game.turnLineSearchCandidateLimit
          : undefined) ??
        planningProfile.candidateLimit ??
        game.arenaPlannerCandidateLimit ??
        game.turnLineSearchCandidateLimit ??
        actions.length;
      const plannerTurnMode =
        game.turnLineSearchTurnMode ||
        planningProfile.turnMode ||
        game.arenaPlannerTurnMode ||
        "mainOnly";
      const plannerBattleStepLimit =
        (hasValue(game.turnLineSearchBattleStepLimit)
          ? game.turnLineSearchBattleStepLimit
          : undefined) ??
        planningProfile.battleStepLimit ??
        game.arenaPlannerBattleStepLimit ??
        1;

      console.log(
        `[Bot.playMainPhase] Running TurnLineSearch with ${actions.length} actions (width=${plannerBeamWidth}, depth=${plannerMaxDepth}, budget=${plannerNodeBudget}, battleSteps=${plannerBattleStepLimit})...`,
      );
      const plannerResult = await turnLineSearch(game, planningStrategy, {
        beamWidth: plannerBeamWidth,
        maxDepth: plannerMaxDepth,
        nodeBudget: plannerNodeBudget,
        candidateLimit: plannerCandidateLimit,
        turnMode: plannerTurnMode,
        battleStepLimit: plannerBattleStepLimit,
        useV2Evaluation,
        preGeneratedActions: actions,
        profile: planningProfile,
        planningContext,
      });

      session.recordProgress("ai_turn_line_search", game, {
        actor: bot.id,
        plannerMode,
        plannerTurnMode,
        plannerBattleStepLimit,
        plannerUsed: Boolean(plannerResult?.action),
        plannedLineLength: plannerResult?.sequence?.length || 0,
        plannedNodesEvaluated: plannerResult?.nodesEvaluated || 0,
        plannedScore: plannerResult?.score ?? null,
        plannedBaseScore: plannerResult?.baseScore ?? null,
        plannedMilestoneScore: plannerResult?.milestoneScore ?? null,
        plannedMilestones: (plannerResult?.milestones || []).slice(0, 8),
        plannedFirstAction: fingerprintAction(plannerResult?.action),
        selectedFirstAction: fingerprintAction(plannerResult?.action),
        plannedTerminalDigest:
          plannerResult?.diagnostics?.terminalSummary || null,
        plannerReason: plannerResult?.reason || "no_plan",
      });

      console.log(`[Bot.playMainPhase] TurnLineSearch result:`, plannerResult);
      if (!await session.waitUntilReady()) return;
      if (session.capture() !== stateBeforeDecision) continue;
      if (plannerResult?.action && isPermitted(plannerResult.action)) {
        bestAction = plannerResult.action;
        pendingPlannerTrace = plannerResult;
        console.log(`[Bot.playMainPhase] ✅ TurnLineSearch chose:`, bestAction);
      } else {
        console.log(`[Bot.playMainPhase] ❌ TurnLineSearch returned no action`);
      }
    }

    // DECISÃO: Usar beam search ou greedy?
    // Se tem 2+ opções, usa beam search. Senão, greedy.
    if (!bestAction && actions.length >= 2) {
      // Beam search com parâmetros do Arena (ou defaults)
      const beamWidth = game.arenaBeamWidth ?? 2;
      const maxDepth = game.arenaMaxDepth ?? 2;
      const nodeBudget = game.arenaNodeBudget ?? 100;

      console.log(
        `[Bot.playMainPhase] Running beam search with ${actions.length} actions (width=${beamWidth}, depth=${maxDepth}, budget=${nodeBudget})...`,
      );
      const searchResult = await beamSearchTurn(game, bot, {
        beamWidth,
        maxDepth,
        nodeBudget,
        useV2Evaluation,
        preGeneratedActions: actions, // BUGFIX: Pass pre-generated actions as fallback
      });

      console.log(`[Bot.playMainPhase] Beam search result:`, searchResult);
      if (!await session.waitUntilReady()) return;
      if (session.capture() !== stateBeforeDecision) continue;
      if (searchResult?.action && isPermitted(searchResult.action)) {
        bestAction = searchResult.action;
        console.log(`[Bot.playMainPhase] ✅ Beam search chose:`, bestAction);
      } else {
        console.log(`[Bot.playMainPhase] ❌ Beam search returned no action`);
      }
    }

    // Fallback: se beam search não retornou nada, ou só tem 1 opção, usa greedy
    if (!bestAction) {
      console.log(`[Bot.playMainPhase] Running greedy search...`);
      const greedyResult = await greedySearchWithEvalV2(game, bot, {
        useV2Evaluation,
        preGeneratedActions: actions, // BUGFIX: Pass pre-generated actions as fallback
      });

      console.log(`[Bot.playMainPhase] Greedy search result:`, greedyResult);
      if (!await session.waitUntilReady()) return;
      if (session.capture() !== stateBeforeDecision) continue;
      if (greedyResult?.action && isPermitted(greedyResult.action)) {
        bestAction = greedyResult.action;
        console.log(`[Bot.playMainPhase] ✅ Greedy chose:`, bestAction);
      } else {
        console.log(`[Bot.playMainPhase] ❌ Greedy returned no action`);

        // 🔧 EMERGENCY FIX: Se greedy falhou mas temos ações, forçar primeira
        if (!bestAction && actions.length > 0) {
          bestAction = fallbackActions.find(isPermitted) || null;
          console.warn(
            `[Bot.playMainPhase] 🚨 EMERGENCY FALLBACK: Forcing first action to avoid pass`,
          );
        }
      }
    }

    // BUGFIX: Ultimate fallback - Se search falhou mas temos ações, usar a primeira
    if (!bestAction) {
      let finalFallback = fallbackActions;
      if (!finalFallback.length && actions.length > 0) {
        const regenerated = bot.sequenceActions(
          bot.generateMainPhaseActions(game),
        );
        const phaseValidRegenerated = filterAiActionsForCurrentPhase(
          regenerated,
          {
            game,
            bot,
            player: bot,
            strategy: planningStrategy,
          },
        );
        finalFallback = bot.filterValidActionsForCurrentState(
          phaseValidRegenerated,
          game,
        ).filter(isPermitted);
      }

      if (finalFallback.length > 0) {
        bestAction = finalFallback.find(isPermitted) || null;
        console.log(
          `[Bot.playMainPhase] ?? Using ultimate fallback: first valid action`,
          bestAction,
        );
      }
    }

    // Se ainda não tem ação, break
    if (!bestAction) {
      console.log(`[Bot.playMainPhase] ⚠️ No action selected, breaking loop`);
      session.recordProgress("ai_decision_after", game, {
        actor: bot.id,
        attempt: totalAttempts,
        selected: false,
        reason: "no_action_selected",
      });
      session.stopReason = "alternatives_exhausted";
      return;
    }

    if (!await session.waitUntilReady()) return;
    if (session.capture() !== stateBeforeDecision) continue;
    if (!isPermitted(bestAction)) {
      session.rejectCandidate(stateBeforeDecision, bestAction);
      continue;
    }

    session.recordProgress("ai_decision_after", game, {
      actor: bot.id,
      attempt: totalAttempts,
      selected: true,
      actionType: bestAction.type || null,
      card:
        (bestAction as AIAction).card?.name ||
        (bestAction as AIAction).cardName ||
        null,
    });

    if (bestAction.type === "simulatedBattle") {
      console.log(
        `[Bot.playMainPhase] Planner selected battle bridge; advancing to Battle Phase`,
        bestAction,
      );
      session.recordProgress("ai_plan_phase_bridge", game, {
        actor: bot.id,
        attempt: totalAttempts,
        plannedAction: fingerprintAction(bestAction),
        plannedMilestones: (pendingPlannerTrace?.milestones || []).slice(0, 8),
        plannerReason: pendingPlannerTrace?.reason || null,
      });
      session.stopReason = "planner_transition";
      return;
    }

    // 📊 Log de decisão (ranking e coerência)
    if (botLogger && actions.length > 0) {
      const sorted = [...actions].sort(
        (a, b) => (b.priority || 0) - (a.priority || 0),
      );
      let ranking = -1;
      for (let i = 0; i < sorted.length; i++) {
        if (
          sorted[i]!.type === bestAction.type &&
          sorted[i]!.index === (bestAction as AIAction).index
        ) {
          ranking = i;
          break;
        }
      }
      if (ranking >= 0) {
        let coherence = ranking === 0 ? 1.0 : ranking < 3 ? 0.7 : 0.4;
        botLogger.logDecision(
          bot.id,
          game.turnCounter || 0,
          game.phase || "unknown",
          actions.length,
          ranking,
          coherence,
          bestAction,
        );
      }
    }

    const actionSuccess = await session.execute(bestAction, stateBeforeDecision);
    if (!session.active() || session.stopReason) return;
    if (pendingPlannerTrace) {
      const expectedSummary =
        pendingPlannerTrace.diagnostics?.firstStepSummary || null;
      const actualSummary = summarizePlanningState(game, {
        bot: bot,
        strategy: planningStrategy,
      });
      const diff = diffPlanningSummaries(expectedSummary, actualSummary);
      const meaningfulDiff = isMeaningfulPlanningDiff(diff);
      const comparePayload = {
        actor: bot.id,
        actionSuccess: !!actionSuccess,
        plannedAction: fingerprintAction(pendingPlannerTrace.action),
        actualAction: fingerprintAction(bestAction),
        selectedFirstAction: fingerprintAction(pendingPlannerTrace.action),
        executedFirstAction: fingerprintAction(bestAction),
        matched: !!actionSuccess && !meaningfulDiff,
        diffSeverity: actionSuccess ? diff.severity : "action_failed",
        mismatchReason: actionSuccess ? diff.severity : "action_failed",
        diffs: compactPlanningDiffs(diff.diffs || [], 6),
        plannedMilestones: (pendingPlannerTrace.milestones || []).slice(0, 8),
        plannerReason: pendingPlannerTrace.reason || null,
      };
      session.recordProgress(
        actionSuccess
          ? "ai_plan_execution_compare"
          : "ai_plan_execution_failed",
        game,
        comparePayload,
      );
    }
    if (!actionSuccess) {
      continue;
    }
    if (!await session.presentationDelay()) return;
  }
}
